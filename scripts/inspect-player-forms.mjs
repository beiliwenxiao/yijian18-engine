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
 * inspect-player-forms.mjs —— 逐形态逐槽位量测 player.json 的实际投影（诊断用，只读）。
 *
 * 输出：
 *   1) Temp/player-forms.png —— down/side/up 三态渲染对照（含世界坐标网格与原点十字）
 *   2) 控制台：每形态下每个槽位的「内容 bbox（世界坐标）」与「相对脚底 y=0 的偏移」
 *      —— 用于识别偏移与骨坐标系是否错位（如 side 形态脚底不落在 y=0）。
 *
 * 用法：node scripts/inspect-player-forms.mjs
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

/** 某形态下参与渲染的槽位（可见性按方向计划 + JSON visible）。 */
function visibleSlots(formKey) {
  const plan = SKELETON_HEAD_SLOT_PLAN[formKey] || {};
  return asset.slots.filter(slot => {
    const att = slot.attachment;
    if (!att || att.type === 'empty') return false;
    return (slot.id in plan) ? plan[slot.id] : att.visible !== false;
  }).sort((a, b) => a.z - b.z);
}

async function renderForm(formKey, clip, timeMs, cw, ch, ox, oy) {
  const world = composeWorldTransforms(asset, sampleClip(clip, timeMs, rest));
  const canvas = Buffer.alloc(cw * ch * 4);
  const perSlot = {};
  for (const slot of visibleSlots(formKey)) {
    const att = slot.attachment;
    const override = att.directionOffsets ? att.directionOffsets[formKey] : null;
    const file = PART_DIR + (override?.assetId || att.assetId).replace('player.parts.', '') + '.png';
    let sprite;
    try { sprite = await buildSprite(file, override?.width || att.width || 0, override?.height || att.height || 0, 0, false); }
    catch { continue; }
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
    const spriteRot = bone.rad * 180 / Math.PI + rot;
    const rotated = spriteRot ? await buildSprite(file, override?.width || att.width || 0, override?.height || att.height || 0, spriteRot, flip) : sprite;
    const left = Math.round(ox + ax - rotated.w / 2);
    const top = Math.round(oy + ay - rotated.h / 2);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let y = 0; y < rotated.h; y++) {
      for (let x = 0; x < rotated.w; x++) {
        const a = rotated.data[(y * rotated.w + x) * 4 + 3];
        if (a < 8) continue;
        const px = left + x, py = top + y;
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
        if (px < 0 || py < 0 || px >= cw || py >= ch) continue;
        const d = (py * cw + px) * 4;
        const inv = 255 - a;
        canvas[d] = Math.round(rotated.data[(y * rotated.w + x) * 4] * a / 255 + canvas[d] * inv / 255);
        canvas[d + 1] = Math.round(rotated.data[(y * rotated.w + x) * 4 + 1] * a / 255 + canvas[d + 1] * inv / 255);
        canvas[d + 2] = Math.round(rotated.data[(y * rotated.w + x) * 4 + 2] * a / 255 + canvas[d + 2] * inv / 255);
        canvas[d + 3] = Math.min(255, canvas[d + 3] + a);
      }
    }
    if (x1 > x0) perSlot[slot.id] = { x0, y0, x1, y1 };
  }
  return { canvas, perSlot };
}

const CW = 140, CH = 160, OX = CW / 2, OY = CH - 12;
const forms = [
  { key: 'down', clip: asset.clips.get('idle_down') },
  { key: 'side', clip: asset.clips.get('idle_side') },
  { key: 'up', clip: asset.clips.get('idle_up') }
];
const rendered = [];
for (const f of forms) rendered.push(await renderForm(f.key, f.clip, 0, CW, CH, OX, OY));

// 逐形态逐槽位量测（世界坐标：脚底原点 = 实体锚点 y=0）
for (let i = 0; i < forms.length; i++) {
  const { key } = forms[i];
  const { perSlot } = rendered[i];
  console.log(`--- ${key}（世界坐标，原点=实体锚点 y=0）---`);
  for (const [id, b] of Object.entries(perSlot)) {
    console.log(`  ${id.padEnd(18)} x[${(b.x0 - OX).toFixed(0)}..${(b.x1 - OX).toFixed(0)}]  y[${(b.y0 - OY).toFixed(0)}..${(b.y1 - OY).toFixed(0)}]  高 ${b.y1 - b.y0 + 1}`);
  }
  const all = Object.values(perSlot);
  if (all.length) {
    const top = Math.min(...all.map(b => b.y0)) - OY;
    const bottom = Math.max(...all.map(b => b.y1)) - OY;
    console.log(`  ▸ 整体：顶 y=${top}  底 y=${bottom}  高 ${bottom - top}`);
  }
}

// 渲染对照图（含网格）
const OUT_W = CW * forms.length, OUT_H = CH;
const big = Buffer.alloc(OUT_W * OUT_H * 4);
forms.forEach((f, i) => {
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const s = (y * CW + x) * 4, d = (y * OUT_W + i * CW + x) * 4;
      big[d] = rendered[i].canvas[s]; big[d + 1] = rendered[i].canvas[s + 1];
      big[d + 2] = rendered[i].canvas[s + 2]; big[d + 3] = rendered[i].canvas[s + 3];
    }
  }
});
// 网格：每 16px 一条浅线，原点处画红十字
for (let i = 0; i < forms.length; i++) {
  const gx = i * CW + OX, gy = OY;
  for (let x = 0; x < CW; x++) {
    for (const yy of [gy]) {
      const d = (yy * OUT_W + gx + x) * 4;
      big[d] = 255; big[d + 1] = 80; big[d + 2] = 80; big[d + 3] = 255;
    }
  }
  for (let y = 0; y < CH; y++) {
    const d = (y * OUT_W + gx) * 4;
    big[d] = 255; big[d + 1] = 80; big[d + 2] = 80; big[d + 3] = 255;
  }
  for (let x = 0; x < CW; x += 16) {
    for (let y = 0; y < CH; y++) {
      const d = (y * OUT_W + i * CW + x) * 4;
      if (big[d + 3] === 0) { big[d] = 210; big[d + 1] = 210; big[d + 2] = 220; big[d + 3] = 255; }
    }
  }
  for (let y = 0; y < CH; y += 16) {
    for (let x = 0; x < CW; x++) {
      const d = (y * OUT_W + i * CW + x) * 4;
      if (big[d + 3] === 0) { big[d] = 210; big[d + 1] = 210; big[d + 2] = 220; big[d + 3] = 255; }
    }
  }
}
mkdirSync('Temp', { recursive: true });
await sharp(big, { raw: { width: OUT_W, height: OUT_H, channels: 4 } })
  .resize(OUT_W * 2, OUT_H * 2, { kernel: 'nearest' })
  .png().toFile('Temp/player-forms.png');
console.log('\n已写出 Temp/player-forms.png（左→右：down / side / up；网格 16px，红十字=实体锚点）');
