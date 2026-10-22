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
 * apply-7head-proportion.mjs —— 玩家骨骼 → 7 头身 + 脚贴地（先只动 idle_down）。
 *
 * ## v2 设计（v1 教训：断颈 + 腿占比失衡）
 *
 * 原资产事实（渲染实测）：
 *   - idle_down 播放中（hips 键下坠 + 腿骨键下移）脚本来贴地（0.67px），
 *     悬空的只有 rest/装配姿态（脚底 -25.72）——rest 与剪辑键值不同源。
 *   - 头部部件图无颈/锁骨内容，头图内容底（颏）直接悬在肩线上方 ~7px，
 *     头骨上移量受「颈缝」硬约束，不能按头顶目标无脑抬。
 *
 * ## v2 步骤
 *   A. 缩头：头部六槽位绘制尺寸 ×s（s = 站立身高/7/站立头高），
 *      挂点按「颏底锚定」重算（Δy=(ccY+halfH)(1−s)，Δx=ccX(1−s)，全形态同 Δ）。
 *   B. 脚贴地：hips rest y += 脚底悬空量（骨链整体下移对齐挂图）；
 *      idle_down 的 hips/thigh/calf 键值改平到 rest（呼吸交给 torso/head/arms）。
 *      —— 腿部挂图不动（腿长保持 47% 达标，避免 v1 腿占比失衡）。
 *   C. 头骨上移：shift = min(头顶目标shift, 颈缝允许shift)——
 *      头顶目标 = 保持原站立身高 110.36；
 *      颈缝约束 = 颏底最多上移到肩线上方 4px（部件图无脖子内容）。
 *      idle_down 的 head 键随 shift 同步平移（保留呼吸相对量）。
 *
 * ## 渲染实测口径
 *   世界 y 向下为正、0=地平线；内容像素 alpha≥32；肩线 = armUR/UL 槽内容 top。
 *
 * 用法：
 *   node scripts/apply-7head-proportion.mjs           # dry-run
 *   node scripts/apply-7head-proportion.mjs --apply   # 写盘
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms, sampleClip } from '../src/animation/SkeletonPose.js';

const APPLY = process.argv.includes('--apply');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/player.json');
const PART_DIR = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts');

const doc = JSON.parse(readFileSync(file, 'utf8'));
const asset = parseSkeletonAsset(doc);
const rest = createRestLocalPose(asset);

/* ---------------- 渲染实测 ---------------- */

const imgCache = new Map();
async function loadPart(name) {
  if (imgCache.has(name)) return imgCache.get(name);
  const { data, info } = await sharp(path.join(PART_DIR, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const entry = { data, w: info.width, h: info.height };
  imgCache.set(name, entry);
  return entry;
}

async function measure(pose, slotId) {
  const world = composeWorldTransforms(asset, pose);
  const slot = asset.slots.find(s => s.id === slotId);
  if (!slot || slot.attachment.type === 'empty') return null;
  const att = slot.attachment;
  const bone = world.get(slot.bone);
  if (!bone) return null;
  const artName = att.assetId.replace('player.parts.', '') + '.png';
  const img = await loadPart(artName);
  const dw = att.width ?? img.w, dh = att.height ?? img.h;
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
  const halfH = (y1 - y0) / 2 * sy;
  const artRot = (att.rot ?? 0) * Math.PI / 180;
  const total = bone.rad + artRot;
  const ccX = ccx * Math.cos(total) - ccy * Math.sin(total);
  const ccY = ccx * Math.sin(total) + ccy * Math.cos(total);
  const lx = att.x ?? 0, ly = att.y ?? 0;
  const cos = Math.cos(bone.rad), sin = Math.sin(bone.rad);
  const anchorY = bone.y + lx * sin + ly * cos;
  const anchorX = bone.x + lx * cos - ly * sin;
  return {
    ccX, ccY, halfH,
    top: anchorY + ccY - halfH,
    bottom: anchorY + ccY + halfH
  };
}

const HEAD_SLOTS = ['headFront', 'headSide', 'headBack', 'hairFront', 'hairSide', 'hairBack'];
const FOOT_SLOTS = ['legCalfL', 'part-calf-r'];
const BODY_SLOTS = [
  'torsoSlot', 'skirtFront', 'skirtBack', 'headFront', 'hairFront',
  'armUR', 'armUL', 'armFR', 'armFL',
  'legThighR', 'legThighL', 'legCalfL', 'part-calf-r'
];

async function union(pose, slots) {
  let top = 1e9, bottom = -1e9;
  for (const id of slots) {
    const m = await measure(pose, id);
    if (!m) continue;
    if (m.top < top) top = m.top;
    if (m.bottom > bottom) bottom = m.bottom;
  }
  return { top, bottom, height: bottom - top };
}

const r3 = v => Math.round(v * 1000) / 1000;
const r2 = v => Math.round(v * 100) / 100;

/* ---------------- 实测当前 ---------------- */

const idlePose0 = sampleClip(asset.clips.get('idle_down'), 0, rest);
const idleBody = await union(idlePose0, BODY_SLOTS);
const idleHead = await union(idlePose0, ['headFront', 'hairFront']);
const restFoot = await union(rest, FOOT_SLOTS);

const TARGET_HEADS = 7;
const s = idleBody.height / TARGET_HEADS / idleHead.height;

console.log('===== 实测 =====');
console.log(`站立(idle@0) 身高=${r2(idleBody.height)} 头高=${r2(idleHead.height)} 头身比=${r2(idleBody.height / idleHead.height)} 头顶=${r2(idleBody.top)}`);
console.log(`rest 脚底=${r2(restFoot.bottom)}（悬空 ${r2(-restFoot.bottom)}）`);
console.log(`计划：s=${r3(s)} 新头高=${r2(idleHead.height * s)}`);

if (!APPLY) { console.log('\n[dry-run] 加 --apply 应用。'); process.exit(0); }

/* ---------------- A. 缩头（颏底锚定） ----------------
 * 注意：必须改 doc.slots（写盘源），parseSkeletonAsset 的产物是解析副本，
 * 改它不落盘（v3 教训）。Δ 先用解析副本按原尺寸实测，再写回 doc。
 */

if (doc.meta.headProportionApplied === true) {
  console.log('[A] 已应用过缩头（meta.headProportionApplied），跳过防二次缩放');
} else {
  for (const slotId of HEAD_SLOTS) {
    const docSlot = doc.slots.find(sl => sl.id === slotId);
    if (!docSlot) continue;
    const att = docSlot.attachment;
    const m = await measure(rest, slotId);          // 解析副本：原尺寸实测
    if (!m) continue;
    att.width = r2((att.width ?? 64) * s);
    att.height = r2((att.height ?? 64) * s);
    const dy = (m.ccY + m.halfH) * (1 - s);
    const dx = m.ccX * (1 - s);
    att.x = r2((att.x ?? 0) + dx);
    att.y = r2((att.y ?? 0) + dy);
    for (const off of Object.values(att.directionOffsets ?? {})) {
      off.x = r2((off.x ?? 0) + dx);
      off.y = r2((off.y ?? 0) + dy);
    }
    console.log(`[A] ${slotId}: size→${att.width}×${att.height} Δ=(${r2(dx)}, ${r2(dy)})`);
  }
  doc.meta.headProportionApplied = true;
}

/* ---------------- B. 脚贴地（仅 hips rest 下移，剪辑键值一律不动） ----------------
 *
 * v3 关键修正：idle_down 原键值本就贴地自洽（t=0 脚底 0.67px），与其他剪辑同在
 * hips≈-47~-54 的高度域。v2 曾把键值改平到新 rest（-27.42）导致 idle_down 矮
 * 20px、与其他剪辑混播跳变——已废弃。剪辑键值是绝对局部值，与 rest 无关；
 * hips rest 下移只影响装配视图（编辑器 rest 姿态）的贴地显示。
 */

const footDelta = -restFoot.bottom;                     // 悬空量（正数）
const hipsBone = doc.bones.find(b => b.id === 'hips');
hipsBone.y = r2(hipsBone.y + footDelta);                // 骨链整体下移对齐挂图（仅 rest 视图）
console.log(`[B] hips rest y → ${hipsBone.y}（下移 ${r2(footDelta)}，仅装配视图；剪辑键值未动）`);

/* ---------------- C. 头骨上移（颈缝约束） ---------------- */

// 改完 A/B 后重新解析资产，用 rest（=改平后的站姿）实测颈缝
const doc2 = JSON.parse(JSON.stringify(doc));
const asset2 = parseSkeletonAsset(doc2);
const rest2 = createRestLocalPose(asset2);
const headM = await measure2(rest2, 'headFront');
const shoulderM = await measure2(rest2, 'armUR');
const headTopM = await union2(rest2, ['headFront', 'hairFront']);
const neckGap0 = headM.bottom - shoulderM.top;          // 当前颏底到肩线顶（正=在肩下方，负=悬空高度）
const shiftTop = idleBody.height - headTopM.height;     // 头顶目标：身高保持 → shift = 原身高 - 现身高
const shiftNeck = neckGap0 - 4;                         // 颏底最多上移到肩线上方 4px
const shift = Math.max(0, Math.min(shiftTop, shiftNeck));

async function measure2(pose, slotId) {
  const world = composeWorldTransforms(asset2, pose);
  const slot = asset2.slots.find(s => s.id === slotId);
  if (!slot || slot.attachment.type === 'empty') return null;
  const att = slot.attachment;
  const bone = world.get(slot.bone);
  const img = await loadPart(att.assetId.replace('player.parts.', '') + '.png');
  const dw = att.width ?? img.w, dh = att.height ?? img.h;
  const sx = dw / img.w, sy = dh / img.h;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.data[(y * img.w + x) * 4 + 3] < 32) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const ccx = ((x0 + x1) / 2 - img.w / 2) * sx;
  const ccy = ((y0 + y1) / 2 - img.h / 2) * sy;
  const halfH = (y1 - y0) / 2 * sy;
  const total = bone.rad + (att.rot ?? 0) * Math.PI / 180;
  const ccX = ccx * Math.cos(total) - ccy * Math.sin(total);
  const ccY = ccx * Math.sin(total) + ccy * Math.cos(total);
  const cos = Math.cos(bone.rad), sin = Math.sin(bone.rad);
  const anchorY = bone.y + (att.x ?? 0) * sin + (att.y ?? 0) * cos;
  return { top: anchorY + ccY - halfH, bottom: anchorY + ccY + halfH };
}
async function union2(pose, slots) {
  let top = 1e9, bottom = -1e9;
  for (const id of slots) {
    const m = await measure2(pose, id);
    if (!m) continue;
    if (m.top < top) top = m.top;
    if (m.bottom > bottom) bottom = m.bottom;
  }
  return { top, bottom, height: bottom - top };
}

const headBone = doc.bones.find(b => b.id === 'head');
headBone.y = r2(headBone.y - shift);
headBone.length = r2((headBone.length ?? 16) * s);
console.log(`[C] 颈缝原值=${r2(neckGap0)} 头顶目标shift=${r2(shiftTop)} 颈缝允许shift=${r2(shiftNeck)} → 实际上移=${r2(shift)}`);
if (shift < shiftTop - 0.5) {
  console.log(`[C][warn] 颈缝约束限制头骨上移：头顶只能到 ${r2(headTopM.top - shift)}（目标 ${r2(-idleBody.height)}）。`);
  console.log('          头部部件图无颈/锁骨内容——要完整 7 头身需补颈部部件（可自动生成），当前取约束内最大值。');
}

/* ---------------- 写盘 ---------------- */

writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`\n[apply] 已写盘 ${path.relative(root, file)}。渲染验证：node scripts/render-player-forms.mjs`);
