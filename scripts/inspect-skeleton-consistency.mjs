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
 * inspect-skeleton-consistency.mjs —— 对比「静息(rest)姿势」与「各剪辑实际姿势」是否同构。
 *
 * 背景：剪辑关键帧的 x/y 是**绝对局部值**（采样时替换 rest），
 * 因此 rest 的 bones 坐标与剪辑键值可能属于两套坐标系 → 缺轨道的骨骼会跳位。
 *
 * 产出：Temp/skeleton-consistency.png（rest / idle_down / gather / walk_down 四格）
 *      + 控制台列出各姿势下关键骨骼的世界坐标差异。
 *
 * 用法：node scripts/inspect-skeleton-consistency.mjs
 */

import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms, sampleClip } from '../src/animation/SkeletonPose.js';
import { SKELETON_HEAD_SLOT_PLAN } from '../src/animation/SkeletonDirection.js';

const ROOT = 'example/sanguo_zhangjiao/assets/';
const PART_DIR = ROOT + 'images/player/parts/';

const doc = JSON.parse(readFileSync(ROOT + 'skeletons/player.json', 'utf8'));
const asset = parseSkeletonAsset(doc);
const rest = createRestLocalPose(asset);

async function buildSprite(file, width, height, rotDeg, flipX) {
  let pipe = sharp(file).ensureAlpha();
  if (width > 0 && height > 0) pipe = pipe.resize(width, height, { fit: 'fill' });
  const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true });
  if (flipX) {
    const flipped = Buffer.alloc(data.length);
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const s = (y * info.width + x) * 4;
        const d = (y * info.width + (info.width - 1 - x)) * 4;
        flipped[d] = data[s]; flipped[d + 1] = data[s + 1]; flipped[d + 2] = data[s + 2]; flipped[d + 3] = data[s + 3];
      }
    }
    return { data: flipped, w: info.width, h: info.height };
  }
  if (rotDeg) {
    const pad = Math.ceil(Math.max(info.width, info.height) * 0.5);
    const cw = info.width + pad * 2, ch = info.height + pad * 2;
    const merged = await sharp({ create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: data, raw: { width: info.width, height: info.height, channels: 4 }, left: pad, top: pad }])
      .png().toBuffer();
    const rot = await sharp(merged).rotate(rotDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw().toBuffer({ resolveWithObject: true });
    return { data: rot.data, w: rot.info.width, h: rot.info.height };
  }
  return { data, w: info.width, h: info.height };
}

async function renderFrame(clip, timeMs, formKey, cw, ch, ox, oy) {
  const world = composeWorldTransforms(asset, sampleClip(clip, timeMs, rest));
  const plan = SKELETON_HEAD_SLOT_PLAN[formKey] || {};
  const canvas = Buffer.alloc(cw * ch * 4);
  const slots = asset.slots.filter(slot => {
    const att = slot.attachment;
    if (!att || att.type === 'empty') return false;
    return (slot.id in plan) ? plan[slot.id] : att.visible !== false;
  }).sort((a, b) => a.z - b.z);
  for (const slot of slots) {
    const att = slot.attachment;
    const override = att.directionOffsets ? att.directionOffsets[formKey] : null;
    const file = PART_DIR + (override?.assetId || att.assetId).replace('player.parts.', '') + '.png';
    try { await sharp(file).metadata(); } catch { continue; }
    const bone = world.get(slot.bone);
    if (!bone) continue;
    const lx = override?.x ?? att.x ?? 0;
    const ly = override?.y ?? att.y ?? 0;
    const rot = override?.rot ?? att.rot ?? 0;
    const cos = Math.cos(bone.rad), sin = Math.sin(bone.rad);
    const ax = bone.x + lx * cos - ly * sin;
    const ay = bone.y + lx * sin + ly * cos;
    let flip = (override?.flipX ?? att.flipX) === true;
    if (slot.bone === 'back' && (formKey === 'up' || formKey === 'NE' || formKey === 'NW')) flip = !flip;
    const sprite = await buildSprite(file, override?.width || att.width || 0, override?.height || att.height || 0, bone.rad * 180 / Math.PI + rot, flip);
    const left = Math.round(ox + ax - sprite.w / 2);
    const top = Math.round(oy + ay - sprite.h / 2);
    for (let y = 0; y < sprite.h; y++) {
      for (let x = 0; x < sprite.w; x++) {
        const a = sprite.data[(y * sprite.w + x) * 4 + 3];
        if (a < 8) continue;
        const px = left + x, py = top + y;
        if (px < 0 || py < 0 || px >= cw || py >= ch) continue;
        const d = (py * cw + px) * 4;
        const inv = 255 - a;
        canvas[d] = Math.round(sprite.data[(y * sprite.w + x) * 4] * a / 255 + canvas[d] * inv / 255);
        canvas[d + 1] = Math.round(sprite.data[(y * sprite.w + x) * 4 + 1] * a / 255 + canvas[d + 1] * inv / 255);
        canvas[d + 2] = Math.round(sprite.data[(y * sprite.w + x) * 4 + 2] * a / 255 + canvas[d + 2] * inv / 255);
        canvas[d + 3] = Math.min(255, canvas[d + 3] + a);
      }
    }
  }
  return { canvas, world };
}

const CW = 130, CH = 150, OX = CW / 2, OY = CH - 10;

const poses = [
  { name: 'rest', clip: null, t: 0 },
  { name: 'idle_down', clip: asset.clips.get('idle_down'), t: 0 },
  { name: 'gather', clip: asset.clips.get('gather'), t: 0 },
  { name: 'walk_down', clip: asset.clips.get('walk_down'), t: 0 }
];
const rendered = [];
for (const p of poses) rendered.push(await renderFrame(p.clip, p.t, 'down', CW, CH, OX, OY));

// 世界坐标差异表
const KEY_BONES = ['hips', 'torso', 'head', 'armUR', 'armUL', 'armFR', 'armFL', 'thighR', 'calfR', 'back'];
console.log('骨骼世界坐标（rest 为基准，其余为剪辑首帧）');
console.log('bone'.padEnd(8) + poses.map(p => p.name.padEnd(14)).join(''));
for (const bone of KEY_BONES) {
  const cells = rendered.map(r => {
    const w = r.world.get(bone);
    return `${w.x.toFixed(1)},${w.y.toFixed(1)}`.padEnd(14);
  });
  console.log(bone.padEnd(8) + cells.join(''));
}

const COLS = poses.length;
const OUT_W = CW * COLS, OUT_H = CH;
const big = Buffer.alloc(OUT_W * OUT_H * 4);
rendered.forEach((r, i) => {
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const s = (y * CW + x) * 4, d = (y * OUT_W + i * CW + x) * 4;
      big[d] = r.canvas[s]; big[d + 1] = r.canvas[s + 1]; big[d + 2] = r.canvas[s + 2]; big[d + 3] = r.canvas[s + 3];
    }
  }
});
mkdirSync('Temp', { recursive: true });
await sharp(big, { raw: { width: OUT_W, height: OUT_H, channels: 4 } })
  .resize(OUT_W * 2, OUT_H * 2, { kernel: 'nearest' })
  .png().toFile('Temp/skeleton-consistency.png');
console.log('\n已写出 Temp/skeleton-consistency.png（左→右：rest / idle_down / gather / walk_down）');
