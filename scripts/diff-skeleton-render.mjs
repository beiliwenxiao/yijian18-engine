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
 * diff-skeleton-render.mjs —— 逐帧像素对比两份 player.json 的渲染结果（只读）。
 *
 * 用法：node scripts/diff-skeleton-render.mjs <旧> <新>
 * 输出每个剪辑/形态的差异像素数与差异率。
 */

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms, sampleClip } from '../src/animation/SkeletonPose.js';
import { SKELETON_HEAD_SLOT_PLAN } from '../src/animation/SkeletonDirection.js';

const PART_DIR = 'example/sanguo_zhangjiao/assets/images/player/parts/';
const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath) {
  console.error('用法：node scripts/diff-skeleton-render.mjs <旧> <新>');
  process.exit(1);
}

const CW = 140, CH = 160, OX = CW / 2, OY = CH - 12;
const imgCache = new Map();

async function loadPart(name) {
  if (imgCache.has(name)) return imgCache.get(name);
  const { data, info } = await sharp(PART_DIR + name).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const entry = { data, w: info.width, h: info.height };
  imgCache.set(name, entry);
  return entry;
}

async function renderFrame(doc, clipName, timeMs, formKey) {
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
    const bone = world.get(slot.bone);
    if (!bone) continue;
    const file = (ov?.assetId || att.assetId).replace('player.parts.', '') + '.png';
    let img;
    try { img = await loadPart(file); } catch { continue; }
    const lx = ov?.x ?? att.x ?? 0;
    const ly = ov?.y ?? att.y ?? 0;
    const rot = (ov?.rot ?? att.rot ?? 0) * Math.PI / 180;
    const cos = Math.cos(bone.rad), sin = Math.sin(bone.rad);
    const ax = bone.x + lx * cos - ly * sin;
    const ay = bone.y + lx * sin + ly * cos;
    const dw = ov?.width || att.width || img.w;
    const dh = ov?.height || att.height || img.h;
    const sx = dw / img.w, sy = dh / img.h;
    const total = bone.rad + rot;
    const ct = Math.cos(total), st = Math.sin(total);
    const left = OX + ax - img.w * sx / 2;
    const top = OY + ay - img.h * sy / 2;
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        const a = img.data[(y * img.w + x) * 4 + 3];
        if (a < 8) continue;
        const px = left + x * sx;
        const py = top + y * sy;
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
  ['idle_down', 0, 'down'], ['idle_down', 900, 'down'],
  ['idle_side', 0, 'side'], ['idle_up', 0, 'up'],
  ['walk_down', 0, 'down'], ['walk_down', 155, 'down'],
  ['walk_side', 0, 'side'], ['walk_up', 0, 'up'],
  ['gather', 0, 'down'], ['attack', 160, 'down'],
  ['logging', 0, 'down'], ['mining', 0, 'down'], ['fishing', 0, 'down'],
  ['jump', 260, 'down'], ['climb_back', 175, 'down'],
  ['death', 380, 'down'], ['sleep', 0, 'down'], ['stretcher', 0, 'down'], ['soul', 0, 'down']
];

console.log('剪辑'.padEnd(16) + '形态'.padEnd(6) + '差异像素'.padStart(9) + '差异率'.padStart(9) + '  判定');
let same = 0;
for (const [clip, t, form] of CASES) {
  const a = await renderFrame(oldDoc, clip, t, form);
  const b = await renderFrame(newDoc, clip, t, form);
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) diff++;
  }
  const rate = (diff / (CW * CH) * 100);
  const tag = diff === 0 ? '✓ 像素不变' : (rate < 3 ? '△ 微调' : '✗ 变化');
  if (diff === 0) same++;
  console.log(`${clip}@${t}`.padEnd(16) + form.padEnd(6) + String(diff).padStart(9) + rate.toFixed(2).padStart(8) + '%' + '  ' + tag);
}
console.log(`\n${CASES.length} 项中 ${same} 项像素完全不变`);
