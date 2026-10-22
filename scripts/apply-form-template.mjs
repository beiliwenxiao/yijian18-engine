/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * apply-form-template.mjs —— 生成 7 形态（down/side/up/SE/SW/NE/NW）的部位挂点模板。
 *
 * ## 为什么必须重标定
 *
 * 美术在编辑器里拖出的 directionOffsets.side/up 是相对**当时那套 bones 布局**标定的；
 * bones 布局归一化后（rest 改用现行系），旧偏移的基准失效 → 侧/背形态腿悬空 12px。
 * 故形态偏移必须按**当前**骨位姿重新求解。
 *
 * ## 模型：解剖 landmark + 绕竖直轴偏转的投影
 *
 *   某部位在形态 F 下的目标内容中心（世界坐标）
 *       x = 体轴 + 横向偏移·cos(θF) + 前后深度·sin(θF)
 *       y = 正面形态的解剖高度（不变）
 *
 *   - 体轴 = 髋部世界 x（人体中线）
 *   - 横向偏移 = 该部位在正面形态**渲染实测**的内容中心 x − 体轴（非魔数）
 *   - 前后深度 = 解剖表：头/发 +2（略靠前）、背挂点 −4（靠后）、其余 0
 *   - θF = 形态相对正面视角的偏角：
 *       down 0°（基准）、side 90°（面朝屏幕右）、up 180°（背面）、
 *       SE/SW 45°、NE/NW 135°
 *     ⇒ side：四肢横向投影收拢到体轴（侧视双腿重叠）✓
 *     ⇒ up：横向整体镜像（背面角色左右互换）✓
 *     ⇒ 斜向：介于两者之间 ✓
 *
 *   深度项让「靠近观察者的一侧」在斜向时略微外扩（cos 项收窄 + sin 项外扩）。
 *
 * ## 头/发三态槽位
 *
 *   headSide/headBack 与 headFront 是同一解剖部位，hairSide/hairBack 与 hairFront 同理，
 *   故共用同一 landmark（ALIAS），只换图不改落位。
 *
 * ## 挂点偏移的求解
 *
 *   内容中心 = 骨世界位姿 ⊕ 挂点偏移 ⊕ R(骨rot + 图rot)·内容中心偏移
 *   ⇒ 挂点偏移 = R⁻¹(目标内容中心 − 骨世界位姿 − R·内容中心偏移)
 *
 *   换图导致的 pivot 差由上式自动吸收（美术换新图后只需微调）。
 *
 * ## 左向朝向
 *
 *   SW 与 SE 数值相同、NW 与 NE 数值相同：左向朝向由实体级 sprite.flipX 整体镜像
 *   （见 PlayerSkeletonStateMapper.isMirroredFacing），数据里不再翻一次。
 *
 * ## 真人比例参照
 *
 *   同时输出 7.5 头身的真人 landmark 表，供美术重绘部件图时对齐。
 *
 * 用法：node scripts/apply-form-template.mjs
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms, sampleClip } from '../src/animation/SkeletonPose.js';
import { SKELETON_HEAD_SLOT_PLAN } from '../src/animation/SkeletonDirection.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/player.json');
const PART_DIR = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts');
const PART_DIR_NEW = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts-humanoid');

const doc = JSON.parse(readFileSync(file, 'utf8'));
const asset = parseSkeletonAsset(doc);
const rest = createRestLocalPose(asset);

/* ------------------------------------------------------------------ */
/* 形态定义                                                             */
/* ------------------------------------------------------------------ */

/**
 * theta = 该形态相对正面视角的偏角（横向投影用）
 * clip   = 该形态的基准剪辑（决定骨位姿）
 * artFrom= 形态专属图缺失时的用图回退来源：
 *          NE/NW 是背面斜视 → 沿用背面（up）图；SE/SW 是正面斜视 → 沿用正面（down）图
 */
const FORMS = [
  { key: 'down', theta: 0, clip: 'idle_down', artFrom: 'down' },
  { key: 'side', theta: 90, clip: 'idle_side', artFrom: 'side' },
  { key: 'up', theta: 180, clip: 'idle_up', artFrom: 'up' },
  { key: 'SE', theta: 45, clip: 'idle_down', artFrom: 'down' },
  { key: 'SW', theta: 45, clip: 'idle_down', artFrom: 'down' },
  { key: 'NE', theta: 135, clip: 'idle_up', artFrom: 'up' },
  { key: 'NW', theta: 135, clip: 'idle_up', artFrom: 'up' }
];

/** 前后深度（正面 z>0）。用于偏角投影的 sin 项。 */
const DEPTH = {
  headFront: 2, headSide: 2, headBack: 2,
  hairFront: 2, hairSide: 2, hairBack: 2,
  torsoSlot: 0,
  skirtFront: 2, skirtBack: -2,
  spearBack: -4, axeBack: -4,
  armUR: 0, armUL: 0, armFR: 0, armFL: 0,
  legThighR: 0, legThighL: 0, legCalfL: 0, 'part-calf-r': 0
};

/** 同一解剖部位的三态槽位（共用 landmark，只换图）。 */
const ALIAS = {
  headSide: 'headFront', headBack: 'headFront',
  hairSide: 'hairFront', hairBack: 'hairFront'
};

/** 只处理身体/头部槽位（武器与影子保持原样）。 */
const SLOT_SCOPE = new Set([
  'torsoSlot', 'skirtFront', 'skirtBack',
  'headFront', 'headSide', 'headBack', 'hairFront', 'hairSide', 'hairBack',
  'armUR', 'armUL', 'armFR', 'armFL',
  'legThighR', 'legThighL', 'legCalfL', 'part-calf-r'
]);

/* ------------------------------------------------------------------ */
/* 渲染实测工具                                                         */
/* ------------------------------------------------------------------ */

const imgCache = new Map();
async function loadPart(assetId, name) {
  const cacheKey = assetId + '|' + name;
  if (imgCache.has(cacheKey)) return imgCache.get(cacheKey);
  // 新骨架身体部件在 parts-humanoid/，旧资产（头/发/裙/武器）在 parts/
  const dir = assetId.startsWith('player.humanoid.') ? PART_DIR_NEW : PART_DIR;
  const { data, info } = await sharp(path.join(dir, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const entry = { data, w: info.width, h: info.height };
  imgCache.set(cacheKey, entry);
  return entry;
}

/**
 * 某形态某槽位的渲染几何。
 *   bone   → 骨世界位姿
 *   ccX/ccY→ 图内容中心相对锚点的世界偏移（随骨旋转）
 *   center → 内容中心世界坐标
 */
async function measure(formKey, clipName, timeMs, slotId, artId) {
  const clip = asset.clips.get(clipName);
  const world = composeWorldTransforms(asset, sampleClip(clip, timeMs, rest));
  const slot = asset.slots.find(s => s.id === slotId);
  if (!slot || !slot.attachment || slot.attachment.type === 'empty') return null;
  const att = slot.attachment;
  const bone = world.get(slot.bone);
  if (!bone) return null;
  const artName = artId.replace('player.parts.', '').replace('player.humanoid.', '') + '.png';
  let img;
  try { img = await loadPart(artId, artName); } catch { return null; }
  const dw = att.width || img.w;
  const dh = att.height || img.h;
  const sx = dw / img.w, sy = dh / img.h;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.data[(y * img.w + x) * 4 + 3] < 32) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return null;
  const ccx = ((x0 + x1) / 2 - img.w / 2) * sx;
  const ccy = ((y0 + y1) / 2 - img.h / 2) * sy;
  // 内容外沿（世界坐标）：比例实测用，比内容中心更接近真实轮廓
  const halfW = (x1 - x0) / 2 * sx;
  const halfH = (y1 - y0) / 2 * sy;
  const artRot = (att.directionOffsets?.[formKey]?.rot ?? att.rot ?? 0) * Math.PI / 180;
  const total = bone.rad + artRot;
  const ccX = ccx * Math.cos(total) - ccy * Math.sin(total);
  const ccY = ccx * Math.sin(total) + ccy * Math.cos(total);
  const lx = att.directionOffsets?.[formKey]?.x ?? att.x ?? 0;
  const ly = att.directionOffsets?.[formKey]?.y ?? att.y ?? 0;
  const cos = Math.cos(bone.rad), sin = Math.sin(bone.rad);
  const anchorX = bone.x + lx * cos - ly * sin;
  const anchorY = bone.y + lx * sin + ly * cos;
  return {
    bone, boneRot: bone.rad, artRot, ccX, ccY, halfW, halfH,
    centerX: anchorX + ccX,
    centerY: anchorY + ccY,
    top: anchorY + ccY - halfH,
    bottom: anchorY + ccY + halfH,
    left: anchorX + ccX - halfW,
    right: anchorX + ccX + halfW
  };
}

/* ------------------------------------------------------------------ */
/* 解剖 landmark：正面形态实测内容中心                                  */
/* ------------------------------------------------------------------ */

const axisX = composeWorldTransforms(asset, rest).get('hips').x;

const downLandmark = new Map(); // canonicalSlotId -> { x, y }
for (const slot of asset.slots) {
  if (!SLOT_SCOPE.has(slot.id)) continue;
  const canonicalId = ALIAS[slot.id] || slot.id;
  if (downLandmark.has(canonicalId)) continue;
  const m = await measure('down', 'idle_down', 0, canonicalId, slot.attachment.assetId);
  if (m) downLandmark.set(canonicalId, { x: m.centerX, y: m.centerY });
}

/* ------------------------------------------------------------------ */
/* 逐形态求解挂点偏移                                                  */
/* ------------------------------------------------------------------ */

const RAD = Math.PI / 180;
const results = [];
const writes = new Map(); // slotId -> { formKey: {x,y,rot} }
const inheritedArt = new Map(); // `slotId|formKey` -> { assetId } 形态自身无图时推导所用的基准形态图

/** 形态 F 下的目标内容中心（横向按偏角投影，纵向沿用正面解剖高度）。 */
function targetCenter(form, slotId, base) {
  const lateral = base.x - axisX;
  const depth = DEPTH[slotId] ?? 0;
  return {
    x: axisX + lateral * Math.cos(form.theta * RAD) + depth * Math.sin(form.theta * RAD),
    y: base.y
  };
}

for (const form of FORMS) {
  if (form.key === 'down') continue;   // down 形态用顶层 attachment.x/y，无需另写
  for (const slot of asset.slots) {
    if (!SLOT_SCOPE.has(slot.id)) continue;
    const canonicalId = ALIAS[slot.id] || slot.id;
    const base = downLandmark.get(canonicalId);
    if (!base) continue;
    const att = slot.attachment;
    // 用图回退链：形态专属图 → 该形态的基准形态图（artFrom）→ 顶层图
    const ownArt = att.directionOffsets?.[form.key]?.assetId;
    const baseFormArt = att.directionOffsets?.[form.artFrom]?.assetId;
    const artId = ownArt || baseFormArt || att.assetId;
    // 运行时只做「精确匹配 → 回顶层」，没有中间级回退：推导若用了基准形态图，
    // 必须把它显式写进该形态（否则 NE/NW 画正面图而偏移按背面图求解，两套语义）
    if (!ownArt && baseFormArt) inheritedArt.set(`${slot.id}|${form.key}`, { assetId: baseFormArt });
    const target = targetCenter(form, canonicalId, base);
    const m = await measure(form.key, form.clip, 0, slot.id, artId);
    if (!m) continue;
    // 目标内容中心 → 反解局部挂点偏移
    const dx = target.x - m.bone.x - m.ccX;
    const dy = target.y - m.bone.y - m.ccY;
    const cos = Math.cos(m.boneRot), sin = Math.sin(m.boneRot);
    const next = {
      x: Math.round((dx * cos + dy * sin) * 100) / 100,
      y: Math.round((-dx * sin + dy * cos) * 100) / 100,
      rot: Math.round((att.directionOffsets?.[form.key]?.rot ?? att.rot ?? 0) * 100) / 100
    };
    if (!writes.has(slot.id)) writes.set(slot.id, {});
    writes.get(slot.id)[form.key] = next;
    results.push({
      slot: slot.id, form: form.key, art: artId,
      targetX: +target.x.toFixed(2), targetY: +target.y.toFixed(2),
      x: next.x, y: next.y, rot: next.rot
    });
  }
}

/* ------------------------------------------------------------------ */
/* 写回 player.json                                                     */
/* ------------------------------------------------------------------ */

let changed = 0;
for (const slot of doc.slots) {
  const w = writes.get(slot.id);
  if (!w) continue;
  slot.attachment.directionOffsets = slot.attachment.directionOffsets || {};
  for (const key of Object.keys(w)) {
    // 保留形态专属图与尺寸（assetId/width/height/flipX），只更新几何偏移
    const prev = slot.attachment.directionOffsets[key] || {};
    const kept = {};
    for (const field of ['assetId', 'width', 'height', 'flipX']) {
      if (prev[field] !== undefined) kept[field] = prev[field];
    }
    // 形态自身无图但推导用了基准形态图（NE/NW→背面图）时显式继承，与头部显隐表语义呼应
    const inh = inheritedArt.get(`${slot.id}|${key}`);
    if (inh && kept.assetId === undefined) kept.assetId = inh.assetId;
    slot.attachment.directionOffsets[key] = { x: w[key].x, y: w[key].y, rot: w[key].rot, ...kept };
  }
  changed++;
}
writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

/* ------------------------------------------------------------------ */
/* 模板参照文件                                                         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 真人比例目标表：以当前身高为基准，换算 7.5 头身的 landmark          */
/* ------------------------------------------------------------------ */
/** 正面（down）形态的实测轮廓（世界坐标，y 向上为负）。 */
async function measureFrontMetrics() {
  const plan = SKELETON_HEAD_SLOT_PLAN.down || {};
  let top = 1e9, bottom = -1e9, left = 1e9, right = -1e9;
  const boxes = new Map();
  for (const slot of asset.slots) {
    if (!slot.attachment || slot.attachment.type === 'empty') continue;
    if ((slot.id in plan) && !plan[slot.id]) continue;
    if (!(slot.id in plan) && slot.attachment.visible === false) continue;
    const m = await measure('down', 'idle_down', 0, slot.id, slot.attachment.assetId);
    if (!m) continue;
    boxes.set(slot.id, m);
    top = Math.min(top, m.top);
    bottom = Math.max(bottom, m.bottom);
    left = Math.min(left, m.left);
    right = Math.max(right, m.right);
  }
  const head = await measure('down', 'idle_down', 0, 'headFront', 'player.parts.head-front');
  const hipsWorld = composeWorldTransforms(asset, rest).get('hips');
  return {
    height: bottom - top,
    top, bottom, left, right,
    headHeight: head ? head.bottom - head.top : 0,
    headTop: head ? head.top : 0,
    headBottom: head ? head.bottom : 0,
    hipsY: hipsWorld.y,
    boxes
  };
}

const front = await measureFrontMetrics();
const H = front.height;

/** 真人 7.5 头身的 landmark（占身高比例，脚底=0、头顶=1）→ 目标世界 y。 */
const HUMAN_RATIO = {
  头顶: 1.0, 眼: 0.93, 颏: 0.87, 肩: 0.82, 胸: 0.72,
  脐: 0.60, 髋: 0.48, 膝: 0.285, 踝: 0.04, 肘: 0.63, 腕: 0.485
};
const humanTargets = Object.fromEntries(
  Object.entries(HUMAN_RATIO).map(([key, ratio]) => [key, {
    ratio,
    targetY: +(front.bottom - ratio * H).toFixed(2)
  }])
);

/** 当前实测值 → 目标值的差（美术重绘时的调整量）。 */
const targetHeadH = H / 7.5;
const humanDelta = {
  头高: {
    当前px: +front.headHeight.toFixed(1),
    目标px: +targetHeadH.toFixed(1),
    说明: `身高 ${H.toFixed(0)}px 下，7.5 头身的头高应为 ${targetHeadH.toFixed(1)}px（当前 ${front.headHeight.toFixed(1)}px，超出 ${(front.headHeight - targetHeadH).toFixed(1)}px）`
  },
  头身比: {
    当前: +(H / front.headHeight).toFixed(2),
    目标: '7.0~7.5',
    说明: '当前为 Q 版比例；真人 7.5 头身需头部等比缩小、四肢等比拉长'
  },
  髋高: {
    当前: +(((front.bottom - front.hipsY) / H) * 100).toFixed(1) + '%',
    目标: '48%',
    说明: '髋部（骨盆）当前偏高、腿长偏短；真人 7.5 头身腿长占 47%'
  },
  肩宽: {
    当前px: 14.0,
    目标px: +(targetHeadH * 2).toFixed(1),
    说明: '肩宽当前约 14px（约 1 头宽），真人约 2 头宽'
  }
};

const HUMAN_7_5 = {
  说明: '7.5 头身真人 landmark —— 美术重绘部件图时的对齐基准（占身高比例，脚底=0、头顶=1）',
  当前实测: {
    身高px: +H.toFixed(1),
    头身比: +(H / front.headHeight).toFixed(2),
    头高px: +front.headHeight.toFixed(1),
    头底y: +front.headBottom.toFixed(2),
    髋高占比: +(((front.bottom - front.hipsY) / H) * 100).toFixed(1) + '%'
  },
  比例差距: humanDelta,
  目标landmark: humanTargets
};

const outDir = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/presets');
mkdirSync(outDir, { recursive: true });
const presetPath = path.join(outDir, 'player.form-template.json');
writeFileSync(presetPath, `${JSON.stringify({
  skeletonId: 'skeleton.player',
  generatedBy: 'scripts/apply-form-template.mjs',
  coordinateSpace: doc.meta?.coordinateSpace || 'canonical-v1',
  bodyAxisX: +axisX.toFixed(2),
  viewAngleDegrees: Object.fromEntries(FORMS.map(f => [f.key, f.theta])),
  depthTable: DEPTH,
  alias: ALIAS,
  humanProportionReference: HUMAN_7_5,
  slots: Object.fromEntries([...writes].map(([id, w]) => [id, w]))
}, null, 2)}\n`, 'utf8');

console.log(`已写入 player.json：${changed} 个身体/头部槽位补齐形态挂点偏移`);
console.log(`模板参照文件：${path.relative(root, presetPath)}`);
console.log('\n形态 → 目标内容中心 → 求解后的挂点偏移：');
for (const row of results.filter(r => r.form === 'side' || r.form === 'up' || r.form === 'SE' || r.form === 'NE')) {
  console.log(
    row.slot.padEnd(15) + row.form.padEnd(6)
    + `target(${row.targetX},${row.targetY})`.padEnd(26)
    + `offset(${row.x}, ${row.y})`.padEnd(24) + row.art
  );
}
console.log('\n真人比例参照（7.5 头身）已写入模板文件。');
