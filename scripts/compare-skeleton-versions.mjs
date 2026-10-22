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
 * compare-skeleton-versions.mjs —— 同一渲染器渲染两份 player.json，输出上下对照图。
 *
 * 用法：node scripts/compare-skeleton-versions.mjs <旧文件> <新文件> <输出png>
 * 上排 = 旧文件，下排 = 新文件。
 */

import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms, sampleClip } from '../src/animation/SkeletonPose.js';
import { SKELETON_HEAD_SLOT_PLAN } from '../src/animation/SkeletonDirection.js';

const PART_DIR = 'example/sanguo_zhangjiao/assets/images/player/parts/';
const [oldPath, newPath, outPath] = process.argv.slice(2);
if (!oldPath || !newPath || !outPath) {
  console.error('用法：node scripts/compare-skeleton-versions.mjs <旧> <新> <输出png>');
  process.exit(1);
}

const CW = 120, CH = 140, OX = CW / 2, OY = CH - 10;
const imgCache = new Map();

async function loadPart(name) {
  if (imgCache.has(name)) return imgCache.get(name);
  const { data, info } = await sharp(PART_DIR + name).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const entry = { data, w: info.width, h: info.height };
  imgCache.set(name, entry);
  return entry;
}

/** 渲染某剪辑某帧于某形态。 */
async function render(doc, clipName, timeMs, formKey) {
  const asset = parseSkeletonAsset(doc);
  const rest = createRestLocalPose(asset);
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

const oldDoc = JSON.parse(readFileSync(oldPath, 'utf8'));
const newDoc = JSON.parse(readFileSync(newPath, 'utf8'));

const CASES = [
  ['idle_down', 0, 'down', 'idle 正面'],
  ['idle_side', 0, 'side', 'idle 侧面'],
  ['idle_up', 0, 'up', 'idle 背面'],
  ['walk_down', 0, 'down', 'walk 正面'],
  ['gather', 0, 'down', 'gather 弯腰'],
  ['attack', 160, 'down', 'attack 挥砍'],
  ['mining', 0, 'down', 'mining 挖矿'],
  ['fishing', 0, 'down', 'fishing 钓鱼'],
  ['climb_back', 175, 'down', 'climb 攀爬'],
  ['walk_side', 0, 'side', 'walk 侧面'],
  ['walk_up', 0, 'up', 'walk 背面']
];

const rows = [];
for (const [clip, t, form, label] of CASES) {
  rows.push({ label, old: await render(oldDoc, clip, t, form), new: await render(newDoc, clip, t, form) });
}

const COLS = CASES.length;
const OUT_W = CW * COLS, OUT_H = CH * 2;
const big = Buffer.alloc(OUT_W * OUT_H * 4);
rows.forEach((row, i) => {
  for (const [src, dy] of [[row.old, 0], [row.new, CH]]) {
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        const s = (y * CW + x) * 4, d = ((dy + y) * OUT_W + i * CW + x) * 4;
        big[d] = src[s]; big[d + 1] = src[s + 1]; big[d + 2] = src[s + 2]; big[d + 3] = src[s + 3];
      }
    }
  }
});

mkdirSync('Temp', { recursive: true });
await sharp(big, { raw: { width: OUT_W, height: OUT_H, channels: 4 } })
  .resize(OUT_W * 2, OUT_H * 2, { kernel: 'nearest' })
  .png().toFile(outPath);

console.log('对照图已写出：', outPath);
console.log('顺序：', rows.map(r => r.label).join(' | '));
console.log('上排 = 旧文件，下排 = 新文件');
