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
 * migrate-player-to-humanoid.mjs —— 旧 player 骨架（12 骨简化树）→ 规范人形骨架（15+1 骨）全量迁移。
 *
 * ## 迁移内容（写入 player.json，skeletonId 不变，游戏引用零改动）
 *   1. 骨架：新 15 骨拓扑（build-humanoid-skeleton.mjs 产物）+ 补 back 骨
 *      —— back 骨是 PlayerSkeletonStateMapper 背挂判定的硬依赖（slot.bone==='back'），
 *         世界高度与旧 back 对齐（≈-44），背挂武器挂点无需换算。
 *   2. 槽位：旧 26 槽全保留（武器 6 槽/背挂 2 槽/头部三态 6 槽是运行时机制的依赖），
 *      新增 neckSlot/footR/footL（新骨架才有颈/脚部件）。
 *      部件图分工：躯干四肢用新图（player.humanoid.*，挂点=新骨设计值）；
 *      头/发/裙背/武器/背挂沿用旧图（player.parts.*，新图无这些资产）。
 *   3. 剪辑：旧 21 剪辑按骨映射搬运，键值原样（绝对局部值语义，rest 布局差异由骨架承担）。
 *
 * ## 挂点换算模型
 *   - 身体主干 10 槽（四肢/躯干/裙前）：新图挂新骨，直接用 build 脚本的槽位设计值。
 *   - 头/发 6 槽：重画为 7 头身目标尺寸（1:1 原尺寸渲染），按 PNG 实测内容 bbox 直接定位——
 *     内容顶边=颅顶（脸 -100 / 发冠 -101.5），内容中心 x=头骨正中。
 *   - skirtBack：旧挂 torso（链式 rot=0），解挂改挂 hips，y = torso.y + att.y。
 *   - 武器 6 槽（挂臂）：跟手语义，局部偏移原样搬。
 *   - 背挂 2 槽（挂 back）：新 back 骨世界高度守恒，原样搬。
 *
 * ## 剪辑骨映射
 *   hips→hips  torso→spine  head→head  armUR→upperArmR  armUL→upperArmL
 *   armFR→forearmR  armFL→forearmL  thighR→thighR  thighL→thighL
 *   calfR→shinR  calfL→shinL  back→back
 *
 * 用法：node scripts/migrate-player-to-humanoid.mjs
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms, sampleClip } from '../src/animation/SkeletonPose.js';
import { SKELETON_HEAD_SLOT_PLAN } from '../src/animation/SkeletonDirection.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD_FILE = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/player.json');
const TPL_FILE = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/player-humanoid.json');
const PARTS_OLD = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts');
const PARTS_NEW = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts-humanoid');
const TEMP = path.join(root, 'Temp');

const oldDoc = JSON.parse(readFileSync(OLD_FILE, 'utf8'));
const tplDoc = JSON.parse(readFileSync(TPL_FILE, 'utf8'));

// 防呆：迁移源必须是旧 12 骨骨架（含 torso）——脚本会覆盖写回，重复跑前需从迁移前提交恢复
if (!oldDoc.bones.some(b => b.id === 'torso')) {
  throw new Error('player.json 已是新骨架（迁移产物）。重跑前先恢复旧版：git checkout 0f6a784 -- example/sanguo_zhangjiao/assets/skeletons/player.json（0f6a784=骨架迁移前最后提交）');
}

/* ---------------- 1. 骨架：新 15 骨 + back ---------------- */

const bones = [
  ...tplDoc.bones.map(b => ({ ...b })),
  // 背挂骨：挂 spine（rest origin 世界 -62）下，世界高度与旧 back 守恒（≈-70，胸背中段）
  { id: 'back', parent: 'spine', x: 0, y: -8, rot: 0, scaleX: 1, scaleY: 1, length: 10 }
];

/* ---------------- 2. 槽位重建（26 旧 + 3 新） ---------------- */

const OLD_BY_ID = Object.fromEntries(oldDoc.slots.map(s => [s.id, s]));
const BONE_MAP = {
  hips: 'hips', torso: 'spine', head: 'head',
  armUR: 'upperArmR', armUL: 'upperArmL', armFR: 'forearmR', armFL: 'forearmL',
  thighR: 'thighR', thighL: 'thighL', calfR: 'shinR', calfL: 'shinL', back: 'back'
};

// 新图槽位设计值（build-humanoid-skeleton.mjs v2 槽位表，槽名映射到旧槽名）
const NEW_BODY_SLOTS = {
  torsoSlot:    { bone: 'chest',     part: 'chest',    x: 0, y: -1,  z: 21 },
  skirtFront:   { bone: 'spine',     part: 'waist',    x: 0, y: 4,   z: 22 },
  armUR:        { bone: 'upperArmR', part: 'upper-arm', x: 0, y: 8,  z: 23 },
  armUL:        { bone: 'upperArmL', part: 'upper-arm', x: 0, y: 8,  z: 14 },
  armFR:        { bone: 'forearmR',  part: 'forearm',  x: 0, y: 9,   z: 24 },
  armFL:        { bone: 'forearmL',  part: 'forearm',  x: 0, y: 9,   z: 15 },
  legThighR:    { bone: 'thighR',    part: 'thigh',    x: 0, y: 13,  z: 4 },
  legThighL:    { bone: 'thighL',    part: 'thigh',    x: 0, y: 13,  z: 5 },
  'part-calf-r': { bone: 'shinR',    part: 'shin',     x: 0, y: 10,  z: 11 },
  legCalfL:     { bone: 'shinL',     part: 'shin',     x: 0, y: 10,  z: 6 }
};

// 头/发 6 槽 + 裙背：按「实测内容 bbox」锚定迁移。重画后的头/发图内容 1:1 绘制，
// 中心/顶边直接从 PNG 实测（alpha>32），杜绝手工表格与图片脱节。
const CONTENT_IDS = [
  'player.parts.head-front',
  'player.parts.head-side',
  'player.parts.head-back',
  'player.parts.hair-heroine-front',
  'player.parts.hair-heroine-side',
  'player.parts.hair-heroine-back',
  'player.parts.skirt-back'
];
async function measureContent(assetId) {
  const name = assetId.replace('player.parts.', '') + '.png';
  const { data, info } = await sharp(path.join(PARTS_OLD, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 32) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX === Infinity) throw new Error(`${name}: 全图透明，无法测内容 bbox`);
  return {
    img: [info.width, info.height],
    c: [Math.round(((minX + maxX + 1) / 2) * 100) / 100, Math.round(((minY + maxY + 1) / 2) * 100) / 100],
    top: minY,
    h: maxY - minY + 1
  };
}
const CONTENT = {};
for (const id of CONTENT_IDS) CONTENT[id] = await measureContent(id);
console.log('内容 bbox 实测:', JSON.stringify(CONTENT));
const K_SKIRT = 0.85; // 裙背（旧图）缩小退到裙摆后侧，避免与新黄裙两层撞色显乱

// 头/发 6 槽挂载目标（head 骨 local，y 负向上；head origin=颏，世界 -86）：
//   top = 内容 bbox 顶边目标世界 y（脸顶=颅顶 -100；发冠略高出 1.5px）
//   cx  = 内容中心 x 目标（0=头骨正中；侧脸/侧发按朝向微调）
const HEAD_MOUNT = {
  'player.parts.head-front':         { top: -100, cx: 0 },
  'player.parts.head-side':          { top: -100, cx: -0.5 },
  'player.parts.head-back':          { top: -100, cx: 0 },
  'player.parts.hair-heroine-front': { top: -101.5, cx: 0 },
  'player.parts.hair-heroine-side':  { top: -101.5, cx: 0.5 },
  'player.parts.hair-heroine-back':  { top: -101.5, cx: 0 }
};

/**
 * 头/发槽新挂点：按实测内容 bbox 直接定位——内容顶边放到 HEAD_MOUNT.top、
 * 内容中心 x 放到 HEAD_MOUNT.cx（原尺寸渲染，不写 width/height）。
 * HEAD_MOUNT 是世界 y（rest 姿态），换算成 head 骨 local：head 骨 rest origin 在世界 -86。
 * 挂点反解：内容中心世界位 = att + (c - 图中心) → att = 目标local - (c - 图中心)。
 */
const HEAD_ORIGIN_WORLD = -86;

function headSlotRemount(att) {
  const meta = CONTENT[att.assetId];
  const m = HEAD_MOUNT[att.assetId];
  const targetCenter = { x: m.cx, y: m.top + meta.h / 2 - HEAD_ORIGIN_WORLD };
  return {
    x: Math.round((targetCenter.x - (meta.c[0] - meta.img[0] / 2)) * 100) / 100,
    y: Math.round((targetCenter.y - (meta.c[1] - meta.img[1] / 2)) * 100) / 100
  };
}

const slots = [];
const NEW_PART_PREFIX = 'player.humanoid.';

for (const old of oldDoc.slots) {
  const att = old.attachment || { type: 'empty' };

  // —— 身体主干：新图 + 新骨 + 设计值 ——
  const bodySpec = NEW_BODY_SLOTS[old.id];
  if (bodySpec && att.type === 'image') {
    slots.push({
      id: old.id, bone: bodySpec.bone, z: bodySpec.z,
      attachment: {
        type: 'image',
        assetId: NEW_PART_PREFIX + bodySpec.part,
        partId: 'part.humanoid.' + bodySpec.part,
        x: bodySpec.x, y: bodySpec.y, rot: 0,
        visible: att.visible !== false
      }
    });
    continue;
  }

  // —— 头/发三态：实测内容 bbox 顶边锚定（头图 1:1 原尺寸，直接定位） ——
  if ((old.id === 'headFront' || old.id === 'headSide' || old.id === 'headBack'
    || old.id === 'hairFront' || old.id === 'hairSide' || old.id === 'hairBack') && att.type === 'image') {
    const r = headSlotRemount(att);
    // 形态偏移一律丢弃：旧 rig 的 directionOffsets 是「旧 30px 头/发图 + 旧挂点」的绝对标定值
    // （旧画布留白 18px 全算在里面），而运行时 resolveAttachmentOffset 会**整体替换**
    // attachment.x/y（SkeletonRenderer._attachmentAnchor），直接搬会让背视/侧视的头与发
    // 拉离颅顶（实测背视：头 y=+1.9、发 y=-19.17 → 头掉 8.9px、发飘高 12.7px）。
    // 新图的每个形态都已按 bbox 锚定到同一颅顶基准，形态差异由「哪个三态槽可见」表达
    // （SKELETON_HEAD_SLOT_PLAN），不再需要方向偏移。
    slots.push({
      id: old.id, bone: 'head', z: old.z,
      attachment: {
        type: 'image', assetId: att.assetId, partId: att.partId,
        x: r.x, y: r.y, rot: att.rot || 0,
        visible: att.visible !== false,
        ...(att.flipX !== undefined ? { flipX: att.flipX } : {})
      }
    });
    continue;
  }

  // —— skirtBack：解挂 torso → hips，内容中心锚定（K_SKIRT 微放大） ——
  if (old.id === 'skirtBack' && att.type === 'image') {
    const meta = CONTENT[att.assetId];
    const s = (att.width || meta.img[0]) / meta.img[0];
    const torso = oldDoc.bones.find(b => b.id === 'torso');
    const oldContent = {
      x: att.x + (meta.c[0] - meta.img[0] / 2) * s,
      y: torso.y + att.y + (meta.c[1] - meta.img[1] / 2) * s
    };
    const target = { x: oldContent.x * K_SKIRT, y: oldContent.y * K_SKIRT };
    slots.push({
      id: old.id, bone: 'hips', z: old.z,
      attachment: {
        type: 'image', assetId: att.assetId, partId: att.partId,
        x: Math.round((target.x - (meta.c[0] - meta.img[0] / 2) * s * K_SKIRT) * 100) / 100,
        y: Math.round((target.y - (meta.c[1] - meta.img[1] / 2) * s * K_SKIRT) * 100) / 100,
        rot: att.rot || 0,
        width: Math.round((att.width || meta.img[0]) * K_SKIRT * 100) / 100,
        height: Math.round((att.height || meta.img[1]) * K_SKIRT * 100) / 100,
        visible: att.visible !== false,
        // 形态偏移同样丢弃：旧值是「旧 torso 挂点 + 旧画布留白」的绝对标定，
        // 运行时 resolveAttachmentOffset 会整体替换 attachment.x/y，直接搬会让裙背在各形态
        // 跳位（旧 y=15.2 vs 新基线 8.98 → 差 6.2px）。新图各形态共用同一 bbox 锚定，无需偏移。
        ...(att.directionOffsets ? { directionOffsets: {} } : {})
      }
    });
    continue;
  }

  // —— 手持武器 6 槽：握柄点贴合 forearmR 骨段（旧前臂段 13px → 新 15px，偏移向量按段长比例归一，
//     避免武器悬空离手；rot/缩放/形态偏移原样保留） ——
  if (old.id.startsWith('weapon') && att.type === 'image') {
    const k = 15 / 13;
    slots.push({
      id: old.id, bone: 'forearmR', z: old.z,
      attachment: {
        type: 'image', assetId: att.assetId, partId: att.partId,
        x: Math.round(att.x * k * 100) / 100,
        y: Math.round(att.y * k * 100) / 100,
        rot: att.rot || 0,
        ...(att.width ? { width: att.width } : {}), ...(att.height ? { height: att.height } : {}),
        visible: att.visible !== false,
        ...(att.directionOffsets ? { directionOffsets: att.directionOffsets } : {})
      }
    });
    continue;
  }

  // —— 其余槽位：换骨后原样搬（背挂世界高度守恒 / shadow 空槽） ——
  const bone = BONE_MAP[old.bone];
  if (!bone) { console.warn(`[skip] 槽位 ${old.id} 挂未知骨 ${old.bone}`); continue; }
  slots.push({ id: old.id, bone, z: old.z, attachment: JSON.parse(JSON.stringify(att)) });
}

// —— 新骨架独有部件：颈 / 双脚（颈图 6×6 原尺寸；脚图 12×5 覆盖 踝-5 → 地面 0） ——
// 脚槽 rot=+90：脚骨 rest rot=-90（脚从踝向前 +x 伸出），鞋图本身也是「朝 +x」，
//   不抵消的话鞋会被整体转成竖直；抵消后「鞋图世界角=0」即鞋底水平贴地、鞋头朝前。
// 挂点是脚骨局部系（+y 沿脚尖，+x 在 rest 下朝上）→ 世界偏移 = 踝 + (ly 前, −lx 下)。
//   取 (lx=-2.5, ly=2.8) → 鞋图中心落在踝下 2.5 / 前 2.8；
//   鞋底 = 图心下方 2.5（鞋底条占图像最后一整行 y=5.0），
//   故踝 y=-5 时鞋底恰好落在地面 y=0；鞋的踝包位置（图 x≈3）正对踝关节。
const newSlot = (id, bone, z, part, x, y, extra = {}) => ({
  id, bone, z,
  attachment: { type: 'image', assetId: NEW_PART_PREFIX + part, partId: 'part.humanoid.' + part, x, y, rot: 0, visible: true, ...extra }
});
slots.push(newSlot('neckSlot', 'neck', 20, 'neck', 0, -1));
slots.push(newSlot('footR', 'footR', 12, 'foot', -2.5, 2.8, { rot: 90 }));
slots.push(newSlot('footL', 'footL', 12, 'foot', -2.5, 2.8, { rot: 90 }));

/* ---------------- 3. 剪辑迁移（delta 换算：键值 = 新 rest + 旧偏移量） ----------------
 * 剪辑键值是绝对局部值（sampleClip 整列替换 rest）——旧键值的 x/y 是旧 rest 布局下的
 * 绝对局部坐标，直接搬会破坏新 rest（腿穿地/头飞移）。因此 x/y 只迁移「相对旧 rest 的
 * 偏移量」，叠加到新 rest 上；rot 同理补 rest 差（保住新骨架的肢体设计角，如上臂外张 4°）。
 * 键值缺省字段保持缺省（沿用各自 rest）。
 *
 * 四肢键值分剪辑处理（实测旧动画机制后的定案）：
 *   - walk_* / jump / climb_back：四肢 x/y 是「迈步/蹬腿/攀爬」的摆动语义（实测 walk_down
 *     迈腿=thigh y ±1.5px 平移 + calf rot ±10°；walk_side=thigh rot ±30° 大步幅）——
 *     delta 迁移保留；删掉会导致正面行走腿完全不动（已踩坑）。
 *   - 其余剪辑（idle 系列/attack/gather 等）：四肢 x/y 是静态拉伸坏数据（idle_down@0
 *     shinR y=37.25 腿拉长 15px）——删除归 rest，只留 rot。
 *   - hips/spine/head 的 x/y 任何剪辑都保留 delta（呼吸/位移语义）。
 *
 * 正面系行走增强：旧 walk_down/up/SE/SW/NE/NW 迈步幅度极小（小短腿蹭步，thigh y ±1.5px），
 * 照搬在新长腿上观感仍是「没迈开」——thigh y 摆幅 ×2、calf rot 摆幅 ×1.2（绕中位放大，
 * 保持循环首尾相接）。×3/×2 实测过高（抬脚 16px 高抬腿行军感，2026-10-24 收敛）。
 * walk_side：旧 thigh rot ±30° 是旧短腿（27px）比例，新长腿（45px）同角扫弧翻倍——
 * 双脚悬空 10-18px 呈劈叉/滑冰感（2026-10-24 实测）。rot 绕中位压缩 ×0.6（±30→±18，
 * 几何上脚回落到离地 ≤2px）。 */
const SIDE_WALK = /^walk_side$/;

const LIMB_OLD_BONES = new Set(['thighR', 'thighL', 'calfR', 'calfL', 'armUR', 'armUL', 'armFR', 'armFL']);
const KEEP_LIMB_XY = /^(walk_|jump$|climb_back$)/;
const FRONT_WALK = /^(walk_down|walk_up|walk_SE|walk_SW|walk_NE|walk_NW)$/;

/** 绕中位放大某字段的摆动幅度（保持循环对称）。 */
function amplifySwing(keys, field, gain) {
  const vals = keys.map(k => k[field]).filter(v => typeof v === 'number');
  if (vals.length < 2 || gain === 1) return;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  for (const k of keys) {
    if (typeof k[field] === 'number') k[field] = Math.round((mid + (k[field] - mid) * gain) * 100) / 100;
  }
}

const oldAssetPre = parseSkeletonAsset(oldDoc);
const oldRestPose = createRestLocalPose(oldAssetPre);
const newAssetPre = parseSkeletonAsset({ schemaVersion: 1, bones, slots, clips: [], meta: {}, defaultClip: '' });
const newRestPose = createRestLocalPose(newAssetPre);

const clips = oldDoc.clips.map(clip => {
  const keepXY = KEEP_LIMB_XY.test(clip.name);
  const isFrontWalk = FRONT_WALK.test(clip.name);
  return {
    ...clip,
    tracks: clip.tracks.map(track => {
      const newBone = BONE_MAP[track.bone];
      if (!newBone) throw new Error(`剪辑 ${clip.name} 的 track 骨 ${track.bone} 无映射`);
      const isLimb = LIMB_OLD_BONES.has(track.bone);
      const o = oldRestPose.get(track.bone);
      const n = newRestPose.get(newBone);
      const dx = o && n ? n.x - o.x : 0;
      const dy = o && n ? n.y - o.y : 0;
      const dr = o && n ? n.rot - o.rot : 0;   // rest 姿态字段是 rot（度数），不是 rad
      const keys = track.keys.map(k => {
        const next = { ...k };
        if (isLimb && !keepXY) {
          delete next.x; delete next.y;          // 静态拉伸坏数据归 rest
        } else {
          if (k.x !== undefined) next.x = Math.round((k.x + dx) * 100) / 100;
          if (k.y !== undefined) next.y = Math.round((k.y + dy) * 100) / 100;
        }
        if (k.rot !== undefined) {
          const rv = k.rot === null ? null : Math.round((k.rot + dr) * 100) / 100;
          if (rv === null || Number.isFinite(rv)) next.rot = rv;
          // 非有限值（NaN 防线）保持缺省回退 rest，绝不写入 null/NaN
        }
        return next;
      });
      // 行走迈步增强/收敛（delta 之后绕中位缩放摆动分量）
      if (isFrontWalk && isLimb) {
        if (track.bone.startsWith('thigh')) amplifySwing(keys, 'y', 2);
        if (track.bone.startsWith('calf')) amplifySwing(keys, 'rot', 1.2);
      }
      if (SIDE_WALK.test(clip.name) && isLimb) amplifySwing(keys, 'rot', 0.6);
      return { bone: newBone, keys };
    })
  };
});

/* ---------------- 3.5 idle 系呼吸剪辑重采样为 4 关键帧（0/450/900/1350，平分时长） ----------------
 * 循环动画约定：4 组可见关键帧把时长平分为 4 份（1800ms → 每 450ms 一组），第 4 组值回到
 * 第 1 组（首尾闭合），末尾隐含的循环帧（t=1800）省略不写。ease 统一 easeInOut。 */

const IDLE_KEY_TIMES = [0, 450, 900, 1350];
for (const clip of clips) {
  if (!/^idle_/.test(clip.name)) continue;
  for (const track of clip.tracks) {
    const src = track.keys;
    const first = src[0];
    track.keys = IDLE_KEY_TIMES.map(t => {
      const base = { ...first, t, ease: t === 0 ? undefined : 'easeInOut' };
      for (const field of ['x', 'y', 'rot']) {
        // 第 4 组（1350）回到第 1 组值（循环闭合）；其余按时间线性重采样
        if (t === IDLE_KEY_TIMES[IDLE_KEY_TIMES.length - 1] && typeof first[field] === 'number') {
          base[field] = first[field];
          continue;
        }
        const vals = src.filter(k => typeof k[field] === 'number').map(k => [k.t, k[field]]);
        if (!vals.length) { delete base[field]; continue; }
        let v;
        if (t <= vals[0][0]) v = vals[0][1];
        else if (t >= vals[vals.length - 1][0]) v = vals[vals.length - 1][1];
        else {
          let i = 0;
          while (i < vals.length - 2 && vals[i + 1][0] < t) i++;
          const [t0, v0] = vals[i];
          const [t1, v1] = vals[i + 1];
          v = t1 === t0 ? v1 : v0 + (v1 - v0) * (t - t0) / (t1 - t0);
        }
        base[field] = Math.round(v * 100) / 100;
      }
      if (base.ease === undefined) delete base.ease;
      return base;
    });
  }
}

/* ---------------- 3.6 行走动画打磨：躯干起伏 + 手臂对侧摆动 ----------------
 * 旧 walk 动画只有腿在动，躯干僵直、手臂不摆（观感"溜冰"）。补两件事：
 *   1. 躯干上下起伏：hips 轨 y 叠加步频起伏（每步 1 周期，幅度 ±1.2px）
 *   2. 手臂对侧摆动：上臂 rot 与同侧腿反相（右腿前摆时左臂前摆），幅度 ±7°
 * 走侧面（walk_side）已有 ±30° 大步幅腿摆，沿用其手臂幅度即可。 */

const WALK_CLIP = /^walk_/;
for (const clip of clips) {
  if (!WALK_CLIP.test(clip.name)) continue;
  const duration = clip.durationMs;
  const isSide = clip.name === 'walk_side';
  const armSwing = isSide ? 8 : 7;       // 手臂摆幅（度）——侧面配 ±18° 步幅（2026-10-24）
  const bodyBob = isSide ? 0.8 : 1.2;    // 躯干起伏幅度（px）

  // 躯干起伏：给 hips（无轨则建）叠加 4 关键帧的起伏
  let hipsTrack = clip.tracks.find(t => t.bone === 'hips');
  if (!hipsTrack) {
    hipsTrack = { bone: 'hips', keys: [] };
    clip.tracks.push(hipsTrack);
  }
  const hipsKeys = hipsTrack.keys.length ? hipsTrack.keys : [{ t: 0, x: 0, y: -50, rot: 0 }];
  const bobTimes = [0, Math.round(duration / 4), Math.round(duration / 2), Math.round(duration * 3 / 4)];
  const bobPattern = [1, -1, 1, -1];       // 每步 1 周期（两腿各 1 次起伏）
  hipsTrack.keys = hipsKeys.map((k, index) => {
    const t = bobTimes[index] ?? k.t;
    const baseY = Number.isFinite(k.y) ? k.y : -50;
    return { ...k, t, y: Math.round((baseY + bobPattern[index % 4] * bodyBob) * 100) / 100 };
  });

  // 手臂对侧摆动：重建上臂 rot（与同侧腿反相），保留原 x/y
  for (const [armBone, phase] of [['upperArmR', 0], ['upperArmL', 1]]) {
    const track = clip.tracks.find(t => t.bone === armBone);
    if (!track) continue;
    const src = track.keys;
    const mid = (() => {
      const vals = src.map(k => (typeof k.rot === 'number' ? k.rot : null)).filter(v => v !== null);
      if (!vals.length) return 0;
      const sorted = [...vals].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    })();
    const times = [0, Math.round(duration / 4), Math.round(duration / 2), Math.round(duration * 3 / 4)];
    // 与腿反相：右臂（phase 0）初始向后、左臂（phase 1）初始向前
    const swing = [1, -1, 1, -1].map(v => v * (phase === 0 ? 1 : -1));
    track.keys = times.map((t, index) => {
      const srcKey = src[index] || src[src.length - 1] || {};
      return {
        ...srcKey,
        t,
        rot: Math.round((mid + swing[index] * armSwing) * 100) / 100
      };
    });
  }
}

/* ---------------- 3.7 walk_side 侧面行走：重写腿部为「人膝」方向 ----------------
 * 旧 walk_side 的小腿局部角与大腿**同向**（膝相对角 −24°）：小腿继续朝前转，
 * 膝盖关节朝前凸出 = 反关节（外翻）。人膝只能向后弯（脚跟朝臀）→ 小腿局部角必须恒为正。
 * 旧 rig 腿短（大腿 13 + 小腿 14 = 27px）且贴纸腿看不出关节，新 rig 腿长 45px 且部件分节，
 * 反关节直接可见。同时旧 rig 无脚骨，新 rig 的脚骨需在步态中保持鞋底贴地。
 * 故此处不迁移旧步态，直接按「世界角步态表 + 髋高落地约束」重算局部角。
 *
 * 世界角约定（与 SkeletonPose 一致）：骨局部 +y 指向子骨；子骨世界偏移 = (−L·sinθ, L·cosθ)
 *   θ=0 竖直向下；θ<0 子骨朝 +x（角色前方）；θ>0 朝 −x（后方）。
 * 步态表（世界角，0.62s 一循环）：
 *   t=0   右腿前伸触地（膝微屈、脚跟先着地）、左腿后蹬（膝大屈、脚跟提起）
 *   t=155 右腿垂直支撑（鞋底平贴地）、左腿前摆（膝屈、脚抬起）
 *   t=310 与 t=0 镜像；t=465 与 t=155 镜像
 *
 * 侧视时两腿必须落在同一竖线上（新 rig 髋间距 ±3.5px 是为正视视角设计的），
 * 否则侧行会出现「两腿左右分开、膝盖外翻」的观感——这正是用户反馈的问题。
 * 故本剪辑内把 thighR/thighL 的 x 偏移归零（clip 键值整体替换 rest 的 x）。
 */
const SIDE_WALK_POSE = [
  { t: 0, R: { th: -18, sh: -8, ft: 2 }, L: { th: 14, sh: 40, ft: 28 } },
  { t: 155, R: { th: 0, sh: 2, ft: 0 }, L: { th: -24, sh: 22, ft: -20 } },
  { t: 310, R: { th: 14, sh: 40, ft: 28 }, L: { th: -18, sh: -8, ft: 2 } },
  { t: 465, R: { th: -24, sh: 22, ft: -20 }, L: { th: 0, sh: 2, ft: 0 } }
];
// 鞋图内容包围盒（12×5 画布，实测 alpha bbox x[1,11] y[1,4]；画布中心 6,2.5）
// → 相对图心：x∈[-5,5]、y∈[-1.5,1.5]；但鞋底深色条占到图像最后一整行（y=5.0），
//   故「鞋底」按图心下方 2.5 算（视觉接地线），避免整只鞋悬空 1px。
const SHOE_BOX = { xMin: -5, xMax: 5, yMin: -1.5, yMax: 2.5 };
// 脚槽挂点（脚骨局部系：+y 沿脚尖，+x 在 rest 下朝上）→ 世界偏移 = 踝 + (ly 前, −lx 下)
const FOOT_ATT = { lx: -2.5, ly: 2.8 };

/** 鞋图在渲染角 φ 下的最低点（相对锚点，世界 y 向下为正） */
function shoeLowest(phi) {
  const th = phi * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  let lo = -Infinity;
  for (const x of [SHOE_BOX.xMin, SHOE_BOX.xMax]) {
    for (const y of [SHOE_BOX.yMin, SHOE_BOX.yMax]) lo = Math.max(lo, x * s + y * c);
  }
  return lo;
}

{
  const L1 = 26, L2 = 19;   // 大腿 / 小腿骨长（新骨架定值）
  // 侧视两腿同轴：髋 x 归零（rest 的 ±3.5 是为正视视角的站姿宽度设计的）
  const HIPX = { R: 0, L: 0 };
  const sideWalk = clips.find(c => c.name === 'walk_side');
  if (sideWalk) {
    const frames = SIDE_WALK_POSE.map(p => {
      const legOf = (side) => {
        const q = p[side];
        const th = q.th * Math.PI / 180, sh = q.sh * Math.PI / 180;
        const kneeX = HIPX[side] - L1 * Math.sin(th);
        const kneeY = L1 * Math.cos(th);
        const ankX = kneeX - L2 * Math.sin(sh);
        const ankY = kneeY + L2 * Math.cos(sh);
        // 脚骨世界角 = 鞋图渲染角 − 槽 rot(90)
        const footBone = q.ft - 90;
        const fb = footBone * Math.PI / 180;
        const ax = ankX + (FOOT_ATT.lx * Math.cos(fb) - FOOT_ATT.ly * Math.sin(fb));
        const ay = ankY + (FOOT_ATT.lx * Math.sin(fb) + FOOT_ATT.ly * Math.cos(fb));
        return { q, sole: ay + shoeLowest(q.ft) };
      };
      const R = legOf('R'), L = legOf('L');
      // 髋高：让「最低的那只鞋」鞋底 = 0（另一只脚此时离地或刚好触地）
      const hipsY = -Math.max(R.sole, L.sole);
      return { t: p.t, R, L, hipsY };
    });

    const setTrack = (bone, keys) => {
      const tr = sideWalk.tracks.find(x => x.bone === bone);
      if (tr) tr.keys = keys; else sideWalk.tracks.push({ bone, keys });
    };
    setTrack('hips', frames.map(f => ({ t: f.t, x: 0, y: Math.round(f.hipsY * 100) / 100, rot: 0 })));
    for (const [side, bones] of [['R', ['thighR', 'shinR', 'footR']], ['L', ['thighL', 'shinL', 'footL']]]) {
      for (const bone of bones) {
        setTrack(bone, frames.map(f => {
          const q = f[side].q;
          const local = bone.startsWith('thigh') ? q.th
            : bone.startsWith('shin') ? q.sh - q.th
              : (q.ft - 90) - q.sh;
          // 大腿 x=0：侧视两腿同轴（clip 键值整体替换 rest 的 x，缺省会回落到 rest 的 ±3.5）
          return bone.startsWith('thigh')
            ? { t: f.t, x: 0, rot: Math.round(local * 100) / 100 }
            : { t: f.t, rot: Math.round(local * 100) / 100 };
        }));
      }
    }
  }
}

/* ---------------- 3.8 形态差异化（正面/侧面/背面）+ 全剪辑人膝修正 ----------------
 * 用户反馈（2026-10-24）：
 *   ① jump 膝盖是反关节 → 全剪辑统一「膝相对角 > 0（膝向后弯，脚跟朝臀）」。
 *      膝相对角 = shin 轨的局部 rot 值（shin 是 thigh 的子骨，父子旋转直接相减）。
 *   ② 正面/侧面/背面的身体应做对应变化 → 躯干/腰/脚按形态换图（directionOffsets.assetId）
 *      + 侧视收拢、背视左右互换的肢体布局（clip 轨写 x）。
 *   ③ 脚步应按朝向变化，不是都向右歪 → 脚分三态图：down=脚尖朝下、side=朝前(+x)、up=脚跟朝下。
 *
 * 形态几何（attachment x/y 挂在骨局部系）：
 *   脚挂点 = (P_img.y, −P_img.x)，P_img = 图像内踝孔像素 − 图心。
 *   down/up 踝孔在图内 (6,0)、12×5 图 → (−2.5, 0)；side 踝孔在 (3.2,0) → (−2.5, 2.8)。
 *   鞋底 = 图底边（距踝 5px）→ 世界踝 y=−5 → 鞋底 y=0 恰好接地。
 */
const FORM_ART = {
  torsoSlot:  { down: 'chest',      side: 'chest-side', up: 'chest-up' },
  skirtFront: { down: 'waist',      side: 'waist-side', up: 'waist-up' },
  footR:      { down: 'foot-down',  side: 'foot',      up: 'foot-up' },
  footL:      { down: 'foot-down',  side: 'foot',      up: 'foot-up' }
};
// 形态挂点偏移（骨局部系）；躯干/腰各形态同画布同锚点 → 偏移不变
const FORM_OFFSET = {
  footR: { down: { x: -2.5, y: 0, rot: 90 }, side: { x: -2.5, y: 2.8, rot: 90 }, up: { x: -2.5, y: 0, rot: 90 } },
  footL: { down: { x: -2.5, y: 0, rot: 90 }, side: { x: -2.5, y: 2.8, rot: 90 }, up: { x: -2.5, y: 0, rot: 90 } }
};
// 斜向形态：SE/SW=前向（用正面图/前向布局），NE/NW=后向（用背面图/后向布局）
const FORM_ALIAS = { SE: 'down', SW: 'down', NE: 'up', NW: 'up' };

for (const slot of slots) {
  const art = FORM_ART[slot.id];
  if (!art) continue;
  const base = art.down;
  const basePart = base.replace(/-side$|-up$|-down$/, '');
  if (basePart !== 'chest' && basePart !== 'waist' && basePart !== 'foot') {
    // down 基准图名不带后缀（chest/waist）时直接沿用；foot 的 down 基准图带 -down 后缀
  }
  if (slot.id === 'footR' || slot.id === 'footL') {
    slot.attachment.assetId = NEW_PART_PREFIX + 'foot-down';
    slot.attachment.partId = 'part.humanoid.foot-down';
    const o = FORM_OFFSET[slot.id].down;
    slot.attachment.x = o.x;
    slot.attachment.y = o.y;
    slot.attachment.rot = o.rot;
  }
  // 逐形态覆盖：方向键 → { assetId, x, y, rot }
  const offsets = {};
  for (const [form, kind] of Object.entries({ side: 'side', up: 'up', SE: 'SE', SW: 'SW', NE: 'NE', NW: 'NW' })) {
    const base2 = FORM_ALIAS[form] || form;
    const assetId = NEW_PART_PREFIX + art[base2];
    const o = FORM_OFFSET[slot.id]?.[base2];
    offsets[form] = {
      x: o ? o.x : slot.attachment.x,
      y: o ? o.y : slot.attachment.y,
      rot: o ? o.rot : (slot.attachment.rot || 0),
      assetId
    };
  }
  slot.attachment.directionOffsets = offsets;
}

/* ---------------- 3.9 肢体布局按形态（侧视收拢、背视左右互换） ----------------
 * clip 轨的 x 值整体替换 rest 的 x（缺省回落 rest）→ 直接在对应 clip 的键上写 x。
 *   侧视：四肢收拢到体轴附近（近侧略前，远侧略后）
 *   背视：左右互换（背面看到的是角色的另一侧）
 *   前视：保持 rest 的 ±3.5/±8.5（正面即标准站姿宽度）
 */
const FORM_LAYOUT = {
  side: { thighR: -2, thighL: 2, upperArmR: 2.5, upperArmL: -2.5 },
  up:   { thighR: 3.5, thighL: -3.5, upperArmR: 8.5, upperArmL: -8.5 },
  NE:   { thighR: 3.5, thighL: -3.5, upperArmR: 8.5, upperArmL: -8.5 },
  NW:   { thighR: 3.5, thighL: -3.5, upperArmR: 8.5, upperArmL: -8.5 }
};
const CLIP_FORM = {
  walk_side: 'side', idle_side: 'side',
  walk_up: 'up', idle_up: 'up',
  walk_NE: 'NE', walk_NW: 'NW'
};
for (const [clipName, form] of Object.entries(CLIP_FORM)) {
  const clip = clips.find(c => c.name === clipName);
  if (!clip) continue;
  const layout = FORM_LAYOUT[form];
  for (const [bone, x] of Object.entries(layout)) {
    let track = clip.tracks.find(t => t.bone === bone);
    if (!track) {
      // 无轨 → 建一条只写 x 的轨（y/rot 缺省回落 rest）
      const times = clip.loop ? [0, Math.round(clip.durationMs / 2)] : [0];
      track = { bone, keys: times.map(t => ({ t, x })) };
      clip.tracks.push(track);
      continue;
    }
    for (const key of track.keys) key.x = x;
  }
}

/* ---------------- 3.10 正/背/斜视的小腿角度归零（修「膝盖外翻 / 两腿交叉」） ----------------
 * 关节约定（composeBoneWorld：world.rot = parent.rot + local.rot）：
 *   踝的 x 偏移 = −L·sin(shin 世界角)，小腿世界角 = 大腿世界角 + shin 局部角。
 * 正/背/斜视的 x 轴是「左右」，膝盖的弯在前后平面（画面里看不见）→ 小腿应保持竖直
 * （世界角 0，即 shin 局部角 = −大腿局部角）。旧数据把「膝盖弯」错译成了左右外撇
 * （walk_down 的 shinR −20 / shinL +20）→ 两踝向身体中线交叉，看着就是膝盖外翻。
 * 侧视（walk_side）另见 3.7：那里 x 轴是「前后」，膝盖弯看得见 → 用「膝相对角 > 0」表达人膝。
 * 静止（idle_down/idle_up）的小腿微屈（±6.4）本就在正确外侧，不动。
 */
const FRONT_VIEW_CLIPS = ['walk_down', 'walk_up', 'walk_SE', 'walk_SW', 'walk_NE', 'walk_NW'];
for (const clipName of FRONT_VIEW_CLIPS) {
  const clip = clips.find(c => c.name === clipName);
  if (!clip) continue;
  for (const bone of ['shinR', 'shinL']) {
    const track = clip.tracks.find(t => t.bone === bone);
    if (!track) continue;
    for (const key of track.keys) {
      if (typeof key.rot !== 'number') continue;
      key.rot = 0;   // 小腿竖直：膝弯不可见，不做左右外撇
    }
  }
}

/* ---------------- 3.11 跳跃剪辑按形态拆分（jump_down / jump_side / jump_up） ----------------
 * 根因：旧 rig 腿是整块贴图、膝关节无真实转角，jump 单一剪辑即可；
 * 新 rig 腿是「大腿/小腿/脚」三节骨链，膝关节有真实转角，而 jump 是全朝向共用剪辑
 *   → 同一组 rot 在侧视是「前后摆」、在正/背视是「左右外撇」，两者无法同时成立
 *   （用户反馈 2026-10-24：跳跃膝盖是反关节、脚步全朝右）。
 * 对齐 walk_ 与 idle_ 系列的既有做法：按形态拆三份，运行时由映射器按朝向选（斜向回退正/背视）。
 *
 * 关节约定（composeBoneWorld：world.rot = parent.rot + local.rot）：
 *   膝相对角 = shin 局部 rot = shin 世界角 − thigh 世界角
 *   人膝（脚跟朝臀、膝不外翻）= 侧视 shin 局部 rot > 0
 *   正/背视膝盖在前后平面（画面不可见）→ 用小腿世界角 0（胫垂直）+ 大腿微外张表达
 */
{
  const oldJump = clips.find(c => c.name === 'jump');
  const hipsKeys = oldJump?.tracks.find(t => t.bone === 'hips')?.keys.map(k => ({ ...k })) ?? [];
  const jumpIdx = clips.findIndex(c => c.name === 'jump');
  if (jumpIdx >= 0) clips.splice(jumpIdx, 1);

  /** 世界角表 → 局部角轨（thigh 局部=世界；shin 局部=世界差；foot 局部=世界差） */
  function legTracks(pose, thighX) {
    return {
      thigh: pose.map(p => ({ t: p.t, x: thighX, rot: p.th })),
      shin: pose.map(p => ({ t: p.t, rot: p.sh - p.th })),
      foot: pose.map(p => ({ t: p.t, rot: (p.ft - 90) - p.sh }))
    };
  }
  /** 手臂世界角表 → 局部角轨（肩部世界 rot=0，局部=世界） */
  function armTracks(pose, armX, side) {
    return pose.map(p => ({ t: p.t, x: armX[side], rot: p[side] }));
  }

  // 侧视：两腿同相位（腾空并拢），膝盖向后弯（人膝）；手臂上举前摆
  const SIDE_LEGS = [
    { t: 0,   th: -8,  sh: 6,   ft: 0 },
    { t: 120, th: -95, sh: 0,   ft: 0 },
    { t: 300, th: -45, sh: -18, ft: 25 },
    { t: 420, th: -18, sh: -6,  ft: 10 }
  ];
  const SIDE_ARMS = [
    { t: 0,   R: -30,  L: -38 },
    { t: 120, R: -118, L: -108 },
    { t: 300, R: -100, L: -92 },
    { t: 420, R: -40,  L: -46 }
  ];
  // 正/背视：膝盖在前后平面不可见 → 大腿微外张 + 小腿保持垂直（左右镜像）
  const FRONT_LEGS = [
    { t: 0,   th: 6,  sh: 0, ft: 0 },
    { t: 120, th: 10, sh: 0, ft: 0 },
    { t: 300, th: 8,  sh: 0, ft: 0 },
    { t: 420, th: 5,  sh: 0, ft: 0 }
  ];
  const DOWN_ARMS = [
    { t: 0,   R: 12,  L: 8 },
    { t: 120, R: 165, L: 195 },
    { t: 300, R: 172, L: 188 },
    { t: 420, R: 14,  L: 10 }
  ];
  const UP_ARMS = [
    { t: 0,   R: 8,   L: 12 },
    { t: 120, R: 195, L: 165 },
    { t: 300, R: 188, L: 172 },
    { t: 420, R: 10,  L: 14 }
  ];

  /** 组装一个形态跳跃剪辑 */
  function buildJump(name, legsR, legsL, armsR, armsL, armXR, armXL) {
    return {
      name,
      durationMs: 420,
      loop: false,
      tracks: [
        { bone: 'hips', keys: hipsKeys },
        { bone: 'upperArmR', keys: armsR },
        { bone: 'upperArmL', keys: armsL },
        { bone: 'thighR', keys: legsR.thigh },
        { bone: 'thighL', keys: legsL.thigh },
        { bone: 'shinR', keys: legsR.shin },
        { bone: 'shinL', keys: legsL.shin },
        { bone: 'footR', keys: legsR.foot },
        { bone: 'footL', keys: legsL.foot }
      ]
    };
  }

  // 侧视：两腿同姿态（x 略错开表现前后层次）
  const sideR = legTracks(SIDE_LEGS, -2);
  const sideL = legTracks(SIDE_LEGS, 2);
  clips.push(buildJump('jump_side',
    sideR, sideL,
    armTracks(SIDE_ARMS, { R: 2.5, L: -2.5 }, 'R'),
    armTracks(SIDE_ARMS, { R: 2.5, L: -2.5 }, 'L'),
    null, null));

  // 正视：右腿向左外张、左腿向右外张（左右镜像）
  const downR = legTracks(FRONT_LEGS.map(p => ({ ...p, th: p.th })), -3.5);
  const downL = legTracks(FRONT_LEGS.map(p => ({ ...p, th: -p.th })), 3.5);
  clips.push(buildJump('jump_down',
    downR, downL,
    armTracks(DOWN_ARMS, { R: -8.5, L: 8.5 }, 'R'),
    armTracks(DOWN_ARMS, { R: -8.5, L: 8.5 }, 'L'),
    null, null));

  // 背视：整体左右镜像（角色右侧出现在画面右）
  const upR = legTracks(FRONT_LEGS.map(p => ({ ...p, th: -p.th })), 3.5);
  const upL = legTracks(FRONT_LEGS.map(p => ({ ...p, th: p.th })), -3.5);
  clips.push(buildJump('jump_up',
    upR, upL,
    armTracks(UP_ARMS, { R: 8.5, L: -8.5 }, 'R'),
    armTracks(UP_ARMS, { R: 8.5, L: -8.5 }, 'L'),
    null, null));
}

/* ---------------- 4. 组装写入 ---------------- */

const doc = {
  schemaVersion: 1,
  skeletonId: oldDoc.skeletonId,
  meta: { ...tplDoc.meta },
  defaultClip: oldDoc.defaultClip,
  bones,
  slots,
  clips
};

writeFileSync(OLD_FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`已写入 ${path.relative(root, OLD_FILE)}：${bones.length} 骨 / ${slots.length} 槽 / ${clips.length} 剪辑`);

/* ---------------- 5. 校验：解析 + 全剪辑采样 ---------------- */

const asset = parseSkeletonAsset(doc);
if (!asset) throw new Error('parseSkeletonAsset 失败');
const rest = createRestLocalPose(asset);
let nanCount = 0;
for (const clip of asset.clips.values()) {
  for (const t of [0, clip.durationMs / 2, clip.durationMs - 1]) {
    const world = composeWorldTransforms(asset, sampleClip(clip, t, rest));
    for (const [, tr] of world) {
      if (!Number.isFinite(tr.x) || !Number.isFinite(tr.y) || !Number.isFinite(tr.rad)) nanCount++;
    }
  }
}
console.log(`校验：21 剪辑 × 3 时刻采样，非有限值 ${nanCount} 个`);
if (nanCount > 0) throw new Error('采样出现 NaN，终止');

/* ---------------- 6. 贴合诊断 + 渲染预览（上排旧版 / 下排新版对照） ---------------- */

const imgCache = new Map();
async function loadArt(assetId) {
  if (imgCache.has(assetId)) return imgCache.get(assetId);
  const name = assetId.replace('player.parts.', '').replace('player.humanoid.', '') + '.png';
  const dir = assetId.startsWith('player.humanoid.') ? PARTS_NEW : PARTS_OLD;
  const img = await sharp(path.join(dir, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const entry = { img, dir, name };
  imgCache.set(assetId, entry);
  return entry;
}

/** 骨段中点世界坐标（骨起点沿骨方向 length/2；方向由子骨/length 的 y 符号近似，预览用轴对齐）。 */
function boneMidpoint(world, boneId) {
  const b = world.get(boneId);
  if (!b) return null;
  const doc2 = world.__doc;
  const def = doc2.bones.find(x => x.id === boneId);
  const half = (def?.length || 0) / 2 * (def && def.y < 0 ? -1 : 1);
  return { x: b.x, y: b.y + half };
}

/**
 * 渲染一帧。同时可输出槽位贴合诊断：图中心世界坐标 vs 所挂骨段中点。
 * faceDown 形态（down 基准）不应用 directionOffsets。
 */
async function renderFrame(asset2, rest2, doc2, clipName, timeMs, { diag = false } = {}) {
  const clip = asset2.clips.get(clipName);
  if (!clip) throw new Error(`剪辑 ${clipName} 不存在`);
  const world = composeWorldTransforms(asset2, sampleClip(clip, timeMs, rest2));
  world.__doc = doc2;
  const W = 160, H = 200, CX = 80, GROUND = 180;
  const layers = [];
  const diagRows = [];
  for (const s of [...asset2.slots].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))) {
    const att = s.attachment;
    if (!att || att.type !== 'image') continue;
    if (att.visible === false) continue;  // 与引擎一致：隐藏槽不渲染
    const { dir, name } = await loadArt(att.assetId);
    let pipe = sharp(path.join(dir, name));
    if (att.flipX) pipe = pipe.flop();
    const bone = world.get(s.bone);
    if (!bone) continue;
    const lx = att.x ?? 0, ly = att.y ?? 0;
    // 真旋转：骨链姿态角 + 附件自身角（与引擎渲染几何一致，walk/attack 摆动帧不失真）
    // 引擎是 ctx.rotate(+rad)（canvas y 向下 → 正角顺时针）→ 等价 sharp.rotate(+deg)
    const deg = (bone.rad * 180 / Math.PI) + (att.rot ?? 0);
    let pngBuf = await (deg ? pipe.rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }) : pipe).png().toBuffer();
    // 旧图槽带 width/height 显示尺寸（引擎运行时按其缩放），预览同样缩放
    const rawMeta = await sharp(pngBuf).metadata();
    if (att.width && att.height && (Math.abs(att.width - rawMeta.width) > 0.5 || Math.abs(att.height - rawMeta.height) > 0.5)) {
      pngBuf = await sharp(pngBuf).resize(Math.max(1, Math.round(att.width)), Math.max(1, Math.round(att.height))).png().toBuffer();
    }
    const meta = await sharp(pngBuf).metadata();
    const cos = Math.cos(bone.rad), sin = Math.sin(bone.rad);
    const ax = bone.x + lx * cos - ly * sin;
    const ay = bone.y + lx * sin + ly * cos;
    layers.push({
      input: pngBuf,
      left: Math.round(CX + ax - meta.width / 2),
      top: Math.round(GROUND + ay - meta.height / 2)
    });
    if (diag) {
      const mid = boneMidpoint(world, s.bone);
      if (mid) {
        const dist = Math.hypot(ax - mid.x, ay - mid.y);
        if (dist > 12) diagRows.push(`${s.id.padEnd(20)} 挂 ${s.bone.padEnd(10)} 图中心离骨段中点 ${dist.toFixed(1)}px`);
      }
    }
  }
  if (diag && diagRows.length) {
    console.log(`--- [${clipName}@${timeMs}] 贴合诊断（偏离 >12px 的槽位） ---`);
    for (const row of diagRows) console.log('  ' + row);
  }
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers).png().toBuffer();
}

const FRAMES = [
  ['idle_down', 0], ['walk_down', 155],
  ['walk_side', 155], ['attack', 200]
];

// 旧版 asset（对照渲染用；写盘发生在第 4 步，此时 oldDoc 仍是迁移源）
const oldAsset = parseSkeletonAsset(oldDoc);
const oldRest = createRestLocalPose(oldAsset);

const oldBufs = [];
const newBufs = [];
for (const [clip, t] of FRAMES) {
  oldBufs.push(await renderFrame(oldAsset, oldRest, oldDoc, clip, t));
  newBufs.push(await renderFrame(asset, rest, doc, clip, t, { diag: true }));
}
const COLS = 4, CW = 160, CH = 200;
const rowLabel = async (text, x, y) => ({
  input: Buffer.from(`<svg width="${CW * COLS}" height="14"><text x="${x}" y="11" font-size="12" fill="#9ab">${text}</text></svg>`),
  left: 10, top: y
});
await sharp({
  create: { width: CW * COLS + 20, height: (CH + 20) * 2 + 40, channels: 4, background: { r: 24, g: 24, b: 28, alpha: 255 } }
})
  .composite([
    await rowLabel('OLD (12 bones)', 10, 8),
    ...oldBufs.map((input, i) => ({ input, left: 10 + i * (CW + 10), top: 24 })),
    await rowLabel('NEW humanoid (16 bones)', 10, CH + 40),
    ...newBufs.map((input, i) => ({ input, left: 10 + i * (CW + 10), top: CH + 56 }))
  ])
  .png().toFile(path.join(TEMP, 'migration-preview.png'));
console.log(`预览: Temp/migration-preview.png（上排旧版 / 下排新版：${FRAMES.map(f => `${f[0]}@${f[1]}`).join(' / ')}）`);
