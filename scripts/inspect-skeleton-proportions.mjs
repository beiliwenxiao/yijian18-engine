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
 * inspect-skeleton-proportions.mjs —— player.json 骨架投影实测（真人比例对照）。
 *
 * 复用引擎真实渲染语义（SkeletonRenderer + PlayerSkeletonStateMapper 方向规则）：
 *   - 挂图以「附件盒中心」为锚点绘制，盒尺寸取 attachment.width/height
 *   - 方向形态：directionOffsets[形态键] 覆盖偏移/换图/翻转
 *   - 头部三态可见性按 SKELETON_HEAD_SLOT_PLAN；背面形态背挂武器水平换边
 *
 * 产出：Temp/skeleton-proportions.png（down/side/up 三格，2 倍放大）
 *      + 控制台输出各形态实测比例与真人基准对照表。
 *
 * 只读脚本：不修改任何资产。
 */

import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms } from '../src/animation/SkeletonPose.js';
import { SKELETON_HEAD_SLOT_PLAN } from '../src/animation/SkeletonDirection.js';

const ROOT = 'example/sanguo_zhangjiao/assets/';
const PART_DIR = ROOT + 'images/player/parts/';
const OUT_SCALE = 3;

const doc = JSON.parse(readFileSync(ROOT + 'skeletons/player.json', 'utf8'));
const asset = parseSkeletonAsset(doc);
const world = composeWorldTransforms(asset, createRestLocalPose(asset));

/** 部件图 → 原始 RGBA 缓冲（缓存）。 */
const imgCache = new Map();
async function loadPart(file) {
  if (imgCache.has(file)) return imgCache.get(file);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const entry = { data, w: info.width, h: info.height };
  imgCache.set(file, entry);
  return entry;
}

/** 源图 → 按附件盒尺寸缩放 + 旋转 + 镜像后的 RGBA 缓冲。 */
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

/** 某形态下每个槽位的有效渲染参数（含可见性与方向覆盖）。 */
function resolveSlots(formKey) {
  const plan = SKELETON_HEAD_SLOT_PLAN[formKey] || {};
  const out = [];
  for (const slot of asset.slots) {
    const att = slot.attachment;
    if (!att || att.type === 'empty') continue;
    const override = att.directionOffsets ? att.directionOffsets[formKey] : null;
    // 可见性：头部三态槽位按形态计划覆盖（对齐运行时 setSlotOverride），其余用 JSON 值
    const visible = (slot.id in plan) ? plan[slot.id] : att.visible !== false;
    if (!visible) continue;
    const bone = world.get(slot.bone);
    if (!bone) continue;
    const lx = override?.x ?? att.x ?? 0;
    const ly = override?.y ?? att.y ?? 0;
    const rot = override?.rot ?? att.rot ?? 0;
    const cos = Math.cos(bone.rad), sin = Math.sin(bone.rad);
    const ax = bone.x + lx * cos - ly * sin;
    const ay = bone.y + lx * sin + ly * cos;
    const assetId = override?.assetId || att.assetId;
    let flip = (override?.flipX ?? att.flipX) === true;
    // 背面/斜后形态：背挂武器水平换边
    if (slot.bone === 'back' && (formKey === 'up' || formKey === 'NE' || formKey === 'NW')) flip = !flip;
    out.push({
      id: slot.id,
      file: PART_DIR + assetId.replace('player.parts.', '') + '.png',
      x: ax, y: ay,
      rot: bone.rad * 180 / Math.PI + rot,
      width: override?.width || att.width || 0,
      height: override?.height || att.height || 0,
      flip
    });
  }
  return out;
}

/** 渲染某形态，返回 {canvas(RGBA), bbox, perSlot}。 */
async function renderForm(formKey, cw, ch, ox, oy) {
  const canvas = Buffer.alloc(cw * ch * 4);
  const bbox = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
  const perSlot = {};
  for (const slot of resolveSlots(formKey)) {
    let file = slot.file;
    try { await loadPart(file); } catch { continue; }
    const sprite = await buildSprite(file, slot.width, slot.height, slot.rot, slot.flip);
    const cx = ox + slot.x;
    const cy = oy + slot.y;
    const left = Math.round(cx - sprite.w / 2);
    const top = Math.round(cy - sprite.h / 2);
    // 手工 alpha 合成（旋转后贴图可能超出画布，手写可裁剪）+ 量测该槽位像素包围盒
    let sx0 = 1e9, sy0 = 1e9, sx1 = -1e9, sy1 = -1e9;
    for (let y = 0; y < sprite.h; y++) {
      for (let x = 0; x < sprite.w; x++) {
        const a = sprite.data[(y * sprite.w + x) * 4 + 3];
        if (a < 8) continue;
        const px = left + x, py = top + y;
        if (px < 0 || py < 0 || px >= cw || py >= ch) continue;
        if (px < sx0) sx0 = px; if (px > sx1) sx1 = px;
        if (py < sy0) sy0 = py; if (py > sy1) sy1 = py;
        const d = (py * cw + px) * 4;
        const inv = 255 - a;
        canvas[d] = Math.round(sprite.data[(y * sprite.w + x) * 4] * a / 255 + canvas[d] * inv / 255);
        canvas[d + 1] = Math.round(sprite.data[(y * sprite.w + x) * 4 + 1] * a / 255 + canvas[d + 1] * inv / 255);
        canvas[d + 2] = Math.round(sprite.data[(y * sprite.w + x) * 4 + 2] * a / 255 + canvas[d + 2] * inv / 255);
        canvas[d + 3] = Math.min(255, canvas[d + 3] + a);
      }
    }
    if (sx1 > sx0) {
      perSlot[slot.id] = { x0: sx0, y0: sy0, x1: sx1, y1: sy1 };
      if (sx0 < bbox.x0) bbox.x0 = sx0;
      if (sx1 > bbox.x1) bbox.x1 = sx1;
      if (sy0 < bbox.y0) bbox.y0 = sy0;
      if (sy1 > bbox.y1) bbox.y1 = sy1;
    }
  }
  return { canvas, bbox, perSlot };
}

/** 某形态下参与测量的头部槽位 id（该形态显示的那个）。 */
function headSlotOf(formKey) {
  const plan = SKELETON_HEAD_SLOT_PLAN[formKey] || {};
  for (const id of ['headFront', 'headSide', 'headBack']) if (plan[id]) return id;
  return 'headFront';
}

const CW = 150, CH = 150, OX = CW / 2, OY = CH - 14;
const forms = ['down', 'side', 'up'];
const results = {};
for (const form of forms) results[form] = await renderForm(form, CW, CH, OX, OY);

/** 真人基准（占身高比例）：7.5 头身 */
const HUMAN = {
  headTop: 1.00, chin: 0.87, eye: 0.93, shoulder: 0.82, chest: 0.72, navel: 0.60,
  hip: 0.48, knee: 0.285, ankle: 0.04, elbow: 0.63, wrist: 0.485,
  headH: 0.133, shoulderW: 0.25, hipW: 0.19
};

for (const form of forms) {
  const { bbox, perSlot } = results[form];
  const H = bbox.y1 - bbox.y0 + 1;
  const headId = headSlotOf(form);
  const head = perSlot[headId];
  const headH = head ? head.y1 - head.y0 + 1 : 0;
  const headW = head ? head.x1 - head.x0 + 1 : 0;
  const torso = perSlot.torsoSlot;
  const torsoW = torso ? torso.x1 - torso.x0 + 1 : 0;
  const footY = bbox.y1;
  const topY = bbox.y0;
  const pct = v => (((v - topY) / H) * 100).toFixed(1) + '%';
  console.log(`--- ${form} ---`);
  console.log(`  整体投影 高 ${H}px 宽 ${bbox.x1 - bbox.x0 + 1}px  (顶 y=${topY} 底 y=${footY})`);
  console.log(`  头(${headId}) 高 ${headH}px 宽 ${headW}px → 头身比 ${(H / Math.max(1, headH)).toFixed(2)} (真人 7.0~7.5)`);
  console.log(`  躯干宽 ${torsoW}px → 肩宽/头宽 ${(torsoW / Math.max(1, headW)).toFixed(2)} (真人 ≈2)`);
  console.log(`  头高占身高 ${(headH / H * 100).toFixed(1)}% (真人 13.3%)`);
  const hips = world.get('hips');
  console.log(`  髋骨世界 y=${hips.y.toFixed(1)} → 投影高度占比 ${pct(hips.y + OY)} (真人 48%)`);
  console.log(`  脚底占 ${pct(footY)} / 头顶占 ${pct(topY)}`);
  console.log(`  骨骼世界坐标：hips y=${hips.y.toFixed(1)}  torso y=${world.get('torso').y.toFixed(1)}  head y=${world.get('head').y.toFixed(1)}`);
}

// 输出 PNG：down / side / up 三格
const OUT_W = CW * forms.length, OUT_H = CH;
const big = Buffer.alloc(OUT_W * OUT_H * 4);
forms.forEach((form, i) => {
  const src = results[form].canvas;
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const s = (y * CW + x) * 4, d = (y * OUT_W + i * CW + x) * 4;
      big[d] = src[s]; big[d + 1] = src[s + 1]; big[d + 2] = src[s + 2]; big[d + 3] = src[s + 3];
    }
  }
});
mkdirSync('Temp', { recursive: true });
await sharp(big, { raw: { width: OUT_W, height: OUT_H, channels: 4 } })
  .resize(OUT_W * OUT_SCALE, OUT_H * OUT_SCALE, { kernel: 'nearest' })
  .png().toFile('Temp/skeleton-proportions.png');
console.log('\n已写出 Temp/skeleton-proportions.png（左→右：down / side / up）');
console.log('真人基准（7.5 头身）：头高 13.3%、髋 48%、膝 28.5%、踝 4%、肩宽≈2 头宽');
