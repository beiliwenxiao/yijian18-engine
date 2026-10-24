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
 *   - 头/发 6 槽：旧 5 头身头图缩到 7.5 头身——缩放比 s = 新头图高/旧头图高；
 *     正面头图中心锚定新 head 骨段中点，其余头部槽 = 头图挂点 + 旧相对偏移 × s。
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
  // 背挂骨：挂 spine 下，世界高度与旧 back 守恒（旧 hips -53.14 + back -16.64 = -69.78，胸背中段）
  { id: 'back', parent: 'spine', x: 0, y: -17.78, rot: 0, scaleX: 1, scaleY: 1, length: 10 }
];

/* ---------------- 2. 槽位重建（26 旧 + 3 新） ---------------- */

const OLD_BY_ID = Object.fromEntries(oldDoc.slots.map(s => [s.id, s]));
const BONE_MAP = {
  hips: 'hips', torso: 'spine', head: 'head',
  armUR: 'upperArmR', armUL: 'upperArmL', armFR: 'forearmR', armFL: 'forearmL',
  thighR: 'thighR', thighL: 'thighL', calfR: 'shinR', calfL: 'shinL', back: 'back'
};

// 新图槽位设计值（build-humanoid-skeleton.mjs 的槽位表，槽名映射到旧槽名）
const NEW_BODY_SLOTS = {
  torsoSlot:    { bone: 'chest',     part: 'chest',    x: 0, y: -8,  z: 21 },
  skirtFront:   { bone: 'spine',     part: 'waist',    x: 0, y: 0,   z: 22 },
  armUR:        { bone: 'upperArmR', part: 'upper-arm', x: 0, y: 2,  z: 23 },
  armUL:        { bone: 'upperArmL', part: 'upper-arm', x: 0, y: 2,  z: 14 },
  armFR:        { bone: 'forearmR',  part: 'forearm',  x: 0, y: 1,   z: 24 },
  armFL:        { bone: 'forearmL',  part: 'forearm',  x: 0, y: 1,   z: 15 },
  legThighR:    { bone: 'thighR',    part: 'thigh',    x: 0, y: 10,  z: 4 },
  legThighL:    { bone: 'thighL',    part: 'thigh',    x: 0, y: 10,  z: 5 },
  'part-calf-r': { bone: 'shinR',    part: 'shin',     x: 0, y: 12,  z: 11 },
  legCalfL:     { bone: 'shinL',     part: 'shin',     x: 0, y: 12,  z: 6 }
};

// 头/发 6 槽 + 裙背：按「内容中心」锚定迁移（部件图透明边大，图几何中心 ≠ 内容中心）。
// CONTENT = 原图内容中心（px，实测 alpha>32 的 bbox 中心）。
const CONTENT = {
  'player.parts.head-front':         { img: [64, 64], c: [32, 14] },
  'player.parts.head-side':          { img: [64, 64], c: [31, 14] },
  'player.parts.head-back':          { img: [64, 64], c: [32, 14] },
  'player.parts.hair-heroine-front': { img: [64, 64], c: [32, 23] },
  'player.parts.hair-heroine-side':  { img: [64, 64], c: [31, 25.5] },
  'player.parts.hair-heroine-back':  { img: [64, 64], c: [32, 27] },
  'player.parts.skirt-back':         { img: [64, 64], c: [31, 13] }
};
const K_HEAD = 0.85;   // 旧头内容实际显示 24px（HEAD 版头部槽无 width 字段，s=1）→ 新头段 20px 观感
const K_SKIRT = 0.85; // 裙背（旧图）缩小退到裙摆后侧，避免与新黄裙两层撞色显乱
// 发图目标显示尺寸（旧发图为满幅爆炸头，原尺寸渲染远大于脸；压到合理发型比例）
const HAIR_SIZE = {
  'player.parts.hair-heroine-front': [34, 34],
  'player.parts.hair-heroine-side':  [33, 33],
  'player.parts.hair-heroine-back':  [34, 34]
};
const HAIR_LIFT = -8;  // 发系槽相对基准额外上移（新发图刘海压眉，上移露额）

/** 旧内容中心相对旧 head 骨起点的局部坐标（rot 均 0，直接加）。 */
function contentLocal(att) {
  const meta = CONTENT[att.assetId];
  const s = (att.width || meta.img[0]) / meta.img[0];
  return {
    x: att.x + (meta.c[0] - meta.img[0] / 2) * s,
    y: att.y + (meta.c[1] - meta.img[1] / 2) * s
  };
}

/** 头部槽新挂点与显示尺寸：头图 64×K_HEAD，发图用 HAIR_SIZE 独立压制；挂点按实际显示 scale 反解。 */
function headSlotRemount(att, baseLocal) {
  const meta = CONTENT[att.assetId];
  const isHair = att.assetId.includes('hair');
  const [dw, dh] = isHair
    ? HAIR_SIZE[att.assetId]
    : [meta.img[0] * K_HEAD, meta.img[1] * K_HEAD];
  const sx = dw / meta.img[0], sy = dh / meta.img[1];
  const old = contentLocal(att);
  const lift = isHair ? HAIR_LIFT : 0;
  const target = { x: (old.x - baseLocal.x) * K_HEAD, y: -5 + lift + (old.y - baseLocal.y) * K_HEAD };
  return {
    x: Math.round((target.x - (meta.c[0] - meta.img[0] / 2) * sx) * 100) / 100,
    y: Math.round((target.y - (meta.c[1] - meta.img[1] / 2) * sy) * 100) / 100,
    width: Math.round(dw * 100) / 100,
    height: Math.round(dh * 100) / 100
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

  // —— 头/发三态：内容中心锚定迁移（K_HEAD 放大到新头段） ——
  if ((old.id === 'headFront' || old.id === 'headSide' || old.id === 'headBack'
    || old.id === 'hairFront' || old.id === 'hairSide' || old.id === 'hairBack') && att.type === 'image') {
    const r = headSlotRemount(att, contentLocal(OLD_BY_ID['headFront'].attachment));
    slots.push({
      id: old.id, bone: 'head', z: old.z,
      attachment: {
        type: 'image', assetId: att.assetId, partId: att.partId,
        x: r.x, y: r.y, rot: att.rot || 0, width: r.width, height: r.height,
        visible: att.visible !== false,
        ...(att.flipX !== undefined ? { flipX: att.flipX } : {}),
        ...(att.directionOffsets ? { directionOffsets: att.directionOffsets } : {})
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
        ...(att.directionOffsets ? { directionOffsets: att.directionOffsets } : {})
      }
    });
    continue;
  }

  // —— 手持武器 6 槽：握柄点贴合 forearmR 骨段（旧前臂段 13px → 新 17px，偏移向量按段长比例归一，
  //     避免武器悬空离手；rot/缩放/形态偏移原样保留） ——
  if (old.id.startsWith('weapon') && att.type === 'image') {
    const k = 17 / 13;
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

// —— 新骨架独有部件：颈 / 双脚（颈图放大 12×12 填充头胸衔接） ——
const newSlot = (id, bone, z, part, x, y, extra = {}) => ({
  id, bone, z,
  attachment: { type: 'image', assetId: NEW_PART_PREFIX + part, partId: 'part.humanoid.' + part, x, y, rot: 0, visible: true, ...extra }
});
slots.push(newSlot('neckSlot', 'neck', 20, 'neck', 0, -2, { width: 12, height: 12 }));
slots.push(newSlot('footR', 'footR', 12, 'foot', -2, -1));
slots.push(newSlot('footL', 'footL', 12, 'foot', 2, -1));

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
 * 照搬在新长腿上观感仍是「没迈开」——thigh y 摆幅 ×3、calf rot 摆幅 ×2（绕中位放大，
 * 保持循环首尾相接）。walk_side rot ±30° 已是大步幅不动。 */

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
      // 正面系行走迈步增强（delta 之后绕中位放大摆动分量）
      if (isFrontWalk && isLimb) {
        if (track.bone.startsWith('thigh')) amplifySwing(keys, 'y', 3);
        if (track.bone.startsWith('calf')) amplifySwing(keys, 'rot', 2);
      }
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
  const armSwing = isSide ? 6 : 7;       // 手臂摆幅（度）
  const bodyBob = isSide ? 0.8 : 1.2;    // 躯干起伏幅度（px）

  // 躯干起伏：给 hips（无轨则建）叠加 4 关键帧的起伏
  let hipsTrack = clip.tracks.find(t => t.bone === 'hips');
  if (!hipsTrack) {
    hipsTrack = { bone: 'hips', keys: [] };
    clip.tracks.push(hipsTrack);
  }
  const hipsKeys = hipsTrack.keys.length ? hipsTrack.keys : [{ t: 0, x: 0, y: -53, rot: 0 }];
  const bobTimes = [0, Math.round(duration / 4), Math.round(duration / 2), Math.round(duration * 3 / 4)];
  const bobPattern = [1, -1, 1, -1];       // 每步 1 周期（两腿各 1 次起伏）
  hipsTrack.keys = hipsKeys.map((k, index) => {
    const t = bobTimes[index] ?? k.t;
    const baseY = Number.isFinite(k.y) ? k.y : -53;
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
    const deg = (bone.rad * 180 / Math.PI) + (att.rot ?? 0);
    let pngBuf = await (deg ? pipe.rotate(-deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }) : pipe).png().toBuffer();
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
