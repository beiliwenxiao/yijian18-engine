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
 * render-player-forms.mjs —— 渲染 7 形态并排对照图（只读）。
 *
 * 用法：node scripts/render-player-forms.mjs [player.json路径] [输出png]
 */

import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms, sampleClip } from '../src/animation/SkeletonPose.js';
import { SKELETON_HEAD_SLOT_PLAN } from '../src/animation/SkeletonDirection.js';

const PART_DIR = 'example/sanguo_zhangjiao/assets/images/player/parts/';
const file = process.argv[2] || 'example/sanguo_zhangjiao/assets/skeletons/player.json';
const out = process.argv[3] || 'Temp/player-forms-7.png';

const doc = JSON.parse(readFileSync(file, 'utf8'));
const asset = parseSkeletonAsset(doc);
const rest = createRestLocalPose(asset);

const CW = 120, CH = 140, OX = CW / 2, OY = CH - 12;

const imgCache = new Map();
async function loadPart(name) {
  if (imgCache.has(name)) return imgCache.get(name);
  const { data, info } = await sharp(PART_DIR + name).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const entry = { data, w: info.width, h: info.height };
  imgCache.set(name, entry);
  return entry;
}

/** 渲染某剪辑某帧于某形态。 */
async function render(clipName, timeMs, formKey) {
  const clip = asset.clips.get(clipName);
  const world = composeWorldTransforms(asset, sampleClip(clip, timeMs, rest));
  const plan = SKELETON_HEAD_SLOT_PLAN[formKey] || {};
  const canvas = Buffer.alloc(CW * CH * 4);
  const slots = asset.slots.filter(slot => {
    const att = slot.attachment;
    if (!att || att.type === 'empty') return false;
    return (slot.id in plan) ? plan[slot.id] : att.visible !== false;
  }).sort((a, b) => a.z - b.z);
  for (const slot of slots) {
    const att = slot.attachment;
    const ov = att.directionOffsets ? att.directionOffsets[formKey] : null;
    const file = PART_DIR + (ov?.assetId || att.assetId).replace('player.parts.', '') + '.png';
    let img;
    try { img = await loadPart(file.replace(PART_DIR, '')); } catch { continue; }
    const bone = world.get(slot.bone);
    if (!bone) continue;
    const lx = ov?.x ?? att.x ?? 0;
    const ly = ov?.y ?? att.y ?? 0;
    const rot = ov?.rot ?? att.rot ?? 0;
    const cos = Math.cos(bone.rad), sin = Math.sin(bone.rad);
    const ax = bone.x + lx * cos - ly * sin;
    const ay = bone.y + lx * sin + ly * cos;
    let flip = (ov?.flipX ?? att.flipX) === true;
    if (slot.bone === 'back' && (formKey === 'up' || formKey === 'NE' || formKey === 'NW')) flip = !flip;
    const dw = ov?.width || att.width || img.w;
    const dh = ov?.height || att.height || img.h;
    const sx = dw / img.w, sy = dh / img.h;
    const total = bone.rad + rot * Math.PI / 180;
    const ct = Math.cos(total), st = Math.sin(total);
    const left = Math.round(OX + ax - img.w * sx / 2);
    const top = Math.round(OY + ay - img.h * sy / 2);
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        const a = img.data[(y * img.w + x) * 4 + 3];
        if (a < 8) continue;
        const px = left + Math.round(x * sx);
        const py = top + Math.round(y * sy);
        if (px < 0 || py < 0 || px >= CW || py >= CH) continue;
        const d = (py * CW + px) * 4;
        const inv = 255 - a;
        canvas[d] = Math.round(img.data[(y * img.w + x) * 4] * a / 255 + canvas[d] * inv / 255);
        canvas[d + 1] = Math.round(img.data[(y * img.w + x) * 4 + 1] * a / 255 + canvas[d + 1] * inv / 255);
        canvas[d + 2] = Math.round(img.data[(y * img.w + x) * 4 + 2] * a / 255 + canvas[d + 2] * inv / 255);
        canvas[d + 3] = Math.min(255, canvas[d + 3] + a);
      }
    }
  }
  return canvas;
}

const CASES = [
  ['idle_down', 0, 'down'],
  ['idle_side', 0, 'side'],
  ['idle_up', 0, 'up'],
  ['walk_SE', 0, 'SE'],
  ['walk_SW', 0, 'SW'],
  ['walk_NE', 0, 'NE'],
  ['walk_NW', 0, 'NW']
];

const frames = [];
for (const [clip, t, form] of CASES) frames.push(await render(clip, t, form));

const OUT_W = CW * frames.length, OUT_H = CH;
const big = Buffer.alloc(OUT_W * OUT_H * 4);
frames.forEach((src, i) => {
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const s = (y * CW + x) * 4, d = (y * OUT_W + i * CW + x) * 4;
      big[d] = src[s]; big[d + 1] = src[s + 1]; big[d + 2] = src[s + 2]; big[d + 3] = src[s + 3];
    }
  }
});
mkdirSync('Temp', { recursive: true });
await sharp(big, { raw: { width: OUT_W, height: OUT_H, channels: 4 } })
  .resize(OUT_W * 2, OUT_H * 2, { kernel: 'nearest' })
  .png().toFile(out);
console.log('已写出', out);
console.log('顺序：down / side / up / SE / SW / NE / NW');
