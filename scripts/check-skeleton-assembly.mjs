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
 * check-skeleton-assembly.mjs —— 装配自洽性数值校验（只读）。
 *
 * 校验项（世界坐标，原点=实体锚点/脚下）：
 *   1. 颈部间隙：头部内容底 vs 躯干内容顶 —— 负值=重叠(正常)，正值=脱节空洞
 *   2. 肩→肘：上臂内容底 vs 前臂内容顶 —— 应接近 0
 *   3. 髋→膝：大腿内容底 vs 小腿内容顶 —— 应接近 0
 *   4. 脚底高度：全身最低像素 —— 应接近 0（贴地）
 *
 * 用法：node scripts/check-skeleton-assembly.mjs [player.json路径]
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

/** 某槽位在指定姿态下的内容包围盒（世界坐标）。 */
async function slotBox(clip, timeMs, formKey, slotId) {
  const world = composeWorldTransforms(asset, sampleClip(clip, timeMs, rest));
  const slot = asset.slots.find(s => s.id === slotId);
  if (!slot) return null;
  const att = slot.attachment;
  if (!att || att.type === 'empty') return null;
  const override = att.directionOffsets ? att.directionOffsets[formKey] : null;
  const file = PART_DIR + (override?.assetId || att.assetId).replace('player.parts.', '') + '.png';
  let img;
  try { img = await loadPart(file.replace(PART_DIR, '')); } catch { return null; }
  const bone = world.get(slot.bone);
  if (!bone) return null;
  const lx = override?.x ?? att.x ?? 0;
  const ly = override?.y ?? att.y ?? 0;
  const rot = (override?.rot ?? att.rot ?? 0) * Math.PI / 180;
  const ax = bone.x + lx, ay = bone.y + ly;
  // 图像内容 bbox（未旋转，画布中心对齐锚点）
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.data[(y * img.w + x) * 4 + 3] < 32) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return null;
  // 画布中心 (w/2,h/2) 对齐锚点 → 内容中心相对锚点的偏移，再随骨旋转
  const ccx = (x0 + x1) / 2 - img.w / 2;
  const ccy = (y0 + y1) / 2 - img.h / 2;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const rx = ccx * cos - ccy * sin;
  const ry = ccx * sin + ccy * cos;
  const half = { x: (x1 - x0) / 2, y: (y1 - y0) / 2 };
  return {
    top: ay + ry - half.y,
    bottom: ay + ry + half.y,
    left: ax + rx - half.x,
    right: ax + rx + half.x,
    cx: ax + rx
  };
}

/** 姿态 → 头部槽位 id。 */
function headSlotOf(formKey) {
  const plan = SKELETON_HEAD_SLOT_PLAN[formKey] || {};
  for (const id of ['headFront', 'headSide', 'headBack']) if (plan[id]) return id;
  return 'headFront';
}

const CASES = [
  ['idle_down', 0, 'down'],
  ['idle_up', 0, 'up'],
  ['idle_side', 0, 'side'],
  ['walk_down', 0, 'down'],
  ['walk_side', 0, 'side'],
  ['walk_up', 0, 'up'],
  ['gather', 0, 'down'],
  ['attack', 160, 'down'],
  ['logging', 0, 'down'],
  ['mining', 0, 'down'],
  ['fishing', 0, 'down'],
  ['jump', 260, 'down'],
  ['climb_back', 175, 'down'],
  ['death', 380, 'down'],
  ['sleep', 0, 'down'],
  ['stretcher', 0, 'down'],
  ['soul', 0, 'down'],
  ['walk_SE', 0, 'SE']
];

console.log(`装配校验：${file}`);
console.log('剪辑'.padEnd(12) + '颈间隙'.padStart(9) + '肩肘'.padStart(9) + '髋膝'.padStart(9) + '脚底'.padStart(9) + '  判定');

let failures = 0;
for (const [clipName, t, formKey] of CASES) {
  const clip = asset.clips.get(clipName);
  if (!clip) { console.log(`${clipName} 缺失`); continue; }
  const head = await slotBox(clip, t, formKey, headSlotOf(formKey));
  const torso = await slotBox(clip, t, formKey, 'torsoSlot');
  const armU = await slotBox(clip, t, formKey, 'armUR');
  const armF = await slotBox(clip, t, formKey, 'armFR');
  const thigh = await slotBox(clip, t, formKey, 'legThighR');
  const calf = await slotBox(clip, t, formKey, 'part-calf-r');
  const calfL = await slotBox(clip, t, formKey, 'legCalfL');

  const neck = head && torso ? head.bottom - torso.top : null;   // >0 为空洞
  const shoulder = armU && armF ? armF.top - armU.bottom : null;
  const hip = thigh && calf ? calf.top - thigh.bottom : null;
  const feet = [calf, calfL].filter(Boolean).map(b => b.bottom);
  const ground = feet.length ? Math.max(...feet) : null;

  const bad = [];
  if (neck !== null && neck > 3) bad.push(`颈空洞${neck.toFixed(1)}`);
  if (shoulder !== null && Math.abs(shoulder) > 4) bad.push(`肩肘错位${shoulder.toFixed(1)}`);
  if (hip !== null && Math.abs(hip) > 4) bad.push(`髋膝错位${hip.toFixed(1)}`);
  if (ground !== null && ground > 6) bad.push(`离地${ground.toFixed(1)}`);
  if (bad.length) failures++;

  const fmt = v => (v === null ? '   —' : v.toFixed(1).padStart(5));
  console.log(
    clipName.padEnd(12) + fmt(neck) + fmt(shoulder) + fmt(hip) + fmt(ground)
    + '  ' + (bad.length ? '✗ ' + bad.join(' ') : '✓')
  );
}
console.log(`\n合计：${CASES.length} 项检查，${failures} 项异常`);
