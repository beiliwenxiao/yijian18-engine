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
 * audit-form-template.mjs —— 校验形态模板的解剖合理性（只读）。
 *
 * 校验项：
 *   1. 头/躯干中线对齐：各形态下头部与躯干内容中心的 x 差（应接近 0）
 *   2. 脚底贴地：各形态下最低像素 y（应接近 0）
 *   3. 头身比：整体高 / 头高（真人 7.0~7.5）
 *   4. 髋高占比：髋世界 y / 整体高（真人 ≈ 48%）
 *   5. 侧视收拢：side 形态下左右大腿中心距（应接近 0）
 *   6. 背视镜像：up 形态下左右大腿中心的 x 符号应与 down 相反
 *
 * 用法：node scripts/audit-form-template.mjs [player.json路径]
 */

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms, sampleClip } from '../src/animation/SkeletonPose.js';
import { SKELETON_HEAD_SLOT_PLAN } from '../src/animation/SkeletonDirection.js';

const PART_DIR = 'example/sanguo_zhangjiao/assets/images/player/parts/';
const file = process.argv[2] || 'example/sanguo_zhangjiao/assets/skeletons/player.json';

const doc = JSON.parse(readFileSync(file, 'utf8'));
const asset = parseSkeletonAsset(doc);
const rest = createRestLocalPose(asset);

const imgCache = new Map();
async function loadPart(name) {
  if (imgCache.has(name)) return imgCache.get(name);
  const { data, info } = await sharp(PART_DIR + name).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const entry = { data, w: info.width, h: info.height };
  imgCache.set(name, entry);
  return entry;
}

function headSlotOf(formKey) {
  const plan = SKELETON_HEAD_SLOT_PLAN[formKey] || {};
  for (const id of ['headFront', 'headSide', 'headBack']) if (plan[id]) return id;
  return 'headFront';
}

async function slotBox(formKey, clipName, slotId) {
  const clip = asset.clips.get(clipName);
  const world = composeWorldTransforms(asset, sampleClip(clip, 0, rest));
  const slot = asset.slots.find(s => s.id === slotId);
  if (!slot || !slot.attachment || slot.attachment.type === 'empty') return null;
  const att = slot.attachment;
  const ov = att.directionOffsets ? att.directionOffsets[formKey] : null;
  const bone = world.get(slot.bone);
  if (!bone) return null;
  let img;
  try { img = await loadPart((ov?.assetId || att.assetId).replace('player.parts.', '') + '.png'); } catch { return null; }
  const lx = ov?.x ?? att.x ?? 0;
  const ly = ov?.y ?? att.y ?? 0;
  const rot = (ov?.rot ?? att.rot ?? 0) * Math.PI / 180;
  const dw = ov?.width || att.width || img.w;
  const dh = ov?.height || att.height || img.h;
  const sx = dw / img.w, sy = dh / img.h;
  const total = bone.rad + rot;
  const cos = Math.cos(bone.rad), sin = Math.sin(bone.rad);
  const ax = bone.x + lx * cos - ly * sin;
  const ay = bone.y + lx * sin + ly * cos;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.data[(y * img.w + x) * 4 + 3] < 32) continue;
      const px = ax + (x - img.w / 2) * sx * Math.cos(total) - (y - img.h / 2) * sy * Math.sin(total);
      const py = ay + (x - img.w / 2) * sx * Math.sin(total) + (y - img.h / 2) * sy * Math.cos(total);
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
  }
  if (x1 < x0) return null;
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, h: y1 - y0 };
}

const FORMS = [
  ['down', 'idle_down'], ['side', 'idle_side'], ['up', 'idle_up'],
  ['SE', 'idle_down'], ['SW', 'idle_down'], ['NE', 'idle_up'], ['NW', 'idle_up']
];

console.log('形态   头高  整体高  头身比  中线差  髋高占比  脚底  左腿x  右腿x  腿距');
for (const [form, clip] of FORMS) {
  const head = await slotBox(form, clip, headSlotOf(form));
  const torso = await slotBox(form, clip, 'torsoSlot');
  const thighL = await slotBox(form, clip, 'legThighL');
  const thighR = await slotBox(form, clip, 'legThighR');
  const calfL = await slotBox(form, clip, 'legCalfL');
  const calfR = await slotBox(form, clip, 'part-calf-r');
  if (!head || !torso) { console.log(`${form}  数据缺失`); continue; }
  // 整体高：所有可见槽位的并集
  const plan = SKELETON_HEAD_SLOT_PLAN[form] || {};
  let top = 1e9, bottom = -1e9;
  for (const slot of asset.slots) {
    if (!slot.attachment || slot.attachment.type === 'empty') continue;
    if ((slot.id in plan) && !plan[slot.id]) continue;
    if (!(slot.id in plan) && slot.attachment.visible === false) continue;
    const b = await slotBox(form, clip, slot.id);
    if (!b) continue;
    top = Math.min(top, b.y0);
    bottom = Math.max(bottom, b.y1);
  }
  const totalH = bottom - top;
  const hips = composeWorldTransforms(asset, sampleClip(asset.clips.get(clip), 0, rest)).get('hips');
  const legGap = thighL && thighR ? Math.abs(thighL.cx - thighR.cx) : NaN;
  console.log(
    form.padEnd(6)
    + String(Math.round(head.h)).padStart(5)
    + String(Math.round(totalH)).padStart(7)
    + (totalH / head.h).toFixed(2).padStart(8)
    + (torso.cx - head.cx).toFixed(1).padStart(8)
    + ((hips.y - top) / totalH * 100).toFixed(1).padStart(10)
    + bottom.toFixed(1).padStart(7)
    + (thighL ? thighL.cx.toFixed(1) : '-').padStart(8)
    + (thighR ? thighR.cx.toFixed(1) : '-').padStart(8)
    + legGap.toFixed(1).padStart(7)
  );
}
console.log('\n目标：头身比 7.0~7.5、髋高占比 ≈48%、脚底 ≈0、side 腿距 ≈0、up 左右腿 x 与 down 相反');
