/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-18
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

// 防具槽位对位计算：按「内容中心对齐」自动求防具槽位 attachment 偏移与旋转，写回骨架 JSON。
//   node scripts/tune-armor-slot-offsets.mjs [骨架路径] [--apply]
// 不带 --apply 只打印计算结果（dry-run）；骨架路径缺省 player.json。
//
// 变换链（与 SkeletonRenderer._attachmentAnchor 一致）：
//   锚点世界 = 骨骼世界位置 + R(骨骼世界旋转) · 附件偏移(x,y)
//   内容中心世界 = 锚点世界 + R(骨骼世界旋转 + 附件 rot) · (内容bbox中心 − 图片中心)
// 对齐规则：防具内容中心 = 被覆盖本体部件的内容中心（静止姿态）。
//   armorTorso(狼皮背心) ← torsoSlot 的 chest 部件（同挂 chest 骨）
//   armorSkirt(狼皮裙)   ← skirtFront 的 waist 部件（同挂 spine 骨）
//   armorBootL/R(狼皮靴) ← footL/footR 的 foot-down 部件（脚骨自带 rot=-90°，
//                          防具附件 rot=+90 抵消 → 靴图直立绘制）
// 部件图换新美术 / 骨骼重标（player-girl-001 方案 A）后重跑本脚本即可重新对位（零手工）。
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms } from '../src/animation/SkeletonPose.js';

const APPLY = process.argv.includes('--apply');
const SKELETON = process.argv.find(arg => arg.endsWith('.json'))
  || 'example/sanguo_zhangjiao/assets/skeletons/player.json';
const IMG_ROOT = 'example/sanguo_zhangjiao/';
const DEG2RAD = Math.PI / 180;

/** alpha 内容包围盒 + 图片尺寸。 */
async function alphaBBox(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return {
    cx: (minX + maxX + 1) / 2,
    cy: (minY + maxY + 1) / 2,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    imgW: info.width,
    imgH: info.height
  };
}

const doc = JSON.parse(readFileSync(SKELETON, 'utf8'));
const asset = parseSkeletonAsset(doc);
const rest = createRestLocalPose(asset);
const world = composeWorldTransforms(asset, rest);
const slotById = id => doc.slots.find(slot => slot.id === id);
const manifest = JSON.parse(readFileSync('example/sanguo_zhangjiao/assets/manifests/assets.json', 'utf8'));
const pathOf = assetId => IMG_ROOT + (manifest.assets.find(entry => entry.assetId === assetId)?.runtime2D?.path || '');

const rotate = (rad, x, y) => [x * Math.cos(rad) - y * Math.sin(rad), x * Math.sin(rad) + y * Math.cos(rad)];

/** 被覆盖本体部件的内容世界中心（完整变换链）。 */
async function bodyContentCenter(slotId) {
  const slot = slotById(slotId);
  const att = slot.attachment;
  const bone = world.get(slot.bone);
  const box = await alphaBBox(pathOf(att.assetId));
  if (!box) throw new Error(`本体部件无内容: ${slotId}`);
  const [ax, ay] = rotate(bone.rad, att.x || 0, att.y || 0);
  const netRad = bone.rad + (att.rot || 0) * DEG2RAD;
  const [rx, ry] = rotate(netRad, box.cx - box.imgW / 2, box.cy - box.imgH / 2);
  return {
    file: att.assetId, box,
    worldCx: bone.x + ax + rx,
    worldCy: bone.y + ay + ry
  };
}

/** 计算防具槽位 attachment：内容中心对齐目标本体部件；附件 rot 抵消骨骼自转（图直立）。 */
async function solveArmorSlot(slotId, targetSlotId, armorFile) {
  const slot = slotById(slotId);
  const bone = world.get(slot.bone);
  const target = await bodyContentCenter(targetSlotId);
  const box = await alphaBBox(IMG_ROOT + armorFile);
  if (!box) throw new Error(`防具部件无内容: ${armorFile}`);
  // 防具附件 rot：抵消骨骼世界旋转，让防具图始终直立
  const attRotDeg = Math.round(-bone.rad / DEG2RAD) % 360;
  const attRad = attRotDeg * DEG2RAD;
  const netRad = bone.rad + attRad; // ≡ 0（脚骨 -90° + 附件 +90°）
  const relX = box.cx - box.imgW / 2;
  const relY = box.cy - box.imgH / 2;
  const [qx, qy] = rotate(netRad, relX, relY); // netRad≈0 → 即 rel 本身
  // R(bone.rad)·(x,y) = 目标 − 骨骼 − q → (x,y) = R(−bone.rad)·(Δ)
  const dx = target.worldCx - bone.x - qx;
  const dy = target.worldCy - bone.y - qy;
  const [x, y] = rotate(-bone.rad, dx, dy);
  return {
    slotId, bone: slot.bone, file: armorFile, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, rot: attRotDeg,
    armorBox: box, target
  };
}

const jobs = [
  { slotId: 'armorTorso', target: 'torsoSlot', file: 'assets/images/player/parts/wolf-hide-vest.png' },
  { slotId: 'armorSkirt', target: 'skirtFront', file: 'assets/images/player/parts/wolf-hide-skirt.png' },
  { slotId: 'armorBootL', target: 'footL', file: 'assets/images/player/parts/wolf-hide-boots.png' },
  { slotId: 'armorBootR', target: 'footR', file: 'assets/images/player/parts/wolf-hide-boots.png' },
  { slotId: 'armorWristL', target: 'armFL', file: 'assets/images/player/parts/wolf-hide-bracers.png' },
  { slotId: 'armorWristR', target: 'armFR', file: 'assets/images/player/parts/wolf-hide-bracers.png' }
];

const results = [];
for (const job of jobs) {
  results.push(await solveArmorSlot(job.slotId, job.target, job.file));
}

console.log('防具槽位对位计算（静止姿态，内容中心对齐）:');
for (const r of results) {
  console.log(`  ${r.slotId} (bone ${r.bone}, 骨骼rot ${Math.round(world.get(r.bone).rad / DEG2RAD)}°): ` +
    `x=${r.x} y=${r.y} rot=${r.rot}  防具内容 ${Math.round(r.armorBox.w)}x${Math.round(r.armorBox.h)}  ` +
    `目标世界中心(${Math.round(r.target.worldCx * 10) / 10}, ${Math.round(r.target.worldCy * 10) / 10})`);
}

if (APPLY) {
  for (const r of results) {
    const att = slotById(r.slotId).attachment;
    att.x = r.x;
    att.y = r.y;
    att.rot = r.rot;
    // 附件指向防具部件图（64×64，图片中心=挂点）：编辑器所见即所得；
    // 运行时由防具槽位联动接管（未装备 → 覆盖层隐藏，装备 → 按物品部件图换图）
    att.type = 'image';
    att.assetId = manifest.assets.find(entry => entry.runtime2D?.path === r.file)?.assetId
      || att.assetId;
    att.width = 64;
    att.height = 64;
    att.visible = true;
  }
  writeFileSync(SKELETON, `${JSON.stringify(doc, null, 2)}\n`);
  console.log('已写回', SKELETON);
} else {
  console.log('(dry-run，加 --apply 写回)');
}
