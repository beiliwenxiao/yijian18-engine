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
 * inspect-skeleton-fit.mjs —— 玩家骨架全剪辑贴合度检查（只读，不写盘）。
 *
 * 对 player.json 全部剪辑采样关键帧，输出：
 *   1. 全剪辑渲染拼图 Temp/fit-inspect.png（每剪辑 2 帧：起 / 中，缩略 96×120）
 *   2. 自动规则检查：
 *      a. 脚贴地：循环系剪辑（idle/walk）的 footR/footL 世界 y 应在 [-8, +4]（踝≈-4，穿地为正）
 *      b. 端点覆盖：手（forearm 末端）/脚（shin 末端）世界点是否落在某槽图矩形内（悬空=绑定缺失）
 *      c. 槽位偏离：图中心 vs 所挂骨段中点 >15px 的槽（过滤已知构图性偏心：武器/大图发）
 *
 * 用法：node scripts/inspect-skeleton-fit.mjs
 */

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms, sampleClip } from '../src/animation/SkeletonPose.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/player.json');
const PARTS_OLD = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts');
const PARTS_NEW = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts-humanoid');
const TEMP = path.join(root, 'Temp');

const doc = JSON.parse(readFileSync(FILE, 'utf8'));
const asset = parseSkeletonAsset(doc);
const rest = createRestLocalPose(asset);

// 已知构图性偏心（长武器/斜握/大图发），过滤出噪声
const COMPOSITIONAL = new Set(['weaponWolfFang', 'weaponAxe', 'headFront', 'hairFront', 'skirtBack', 'spearBack']);

const imgCache = new Map();
async function loadArt(assetId) {
  if (imgCache.has(assetId)) return imgCache.get(assetId);
  const name = assetId.replace('player.parts.', '').replace('player.humanoid.', '') + '.png';
  const dir = assetId.startsWith('player.humanoid.') ? PARTS_NEW : PARTS_OLD;
  const img = await sharp(path.join(dir, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const entry = { img, dir, name };
  imgCache.set(assetId, entry);
  return entry;
}

/** 骨段端点世界坐标（t=0 起点 / t=1 末端，方向由 length 的 y 符号近似）。 */
function boneEnds(world, boneId, doc2) {
  const b = world.get(boneId);
  const def = doc2.bones.find(x => x.id === boneId);
  if (!b || !def) return null;
  const len = def.length || 0;
  const dirY = def.y < 0 ? -1 : 1;
  return { start: { x: b.x, y: b.y }, end: { x: b.x, y: b.y + len * dirY } };
}

/** 一帧渲染 + 诊断采集。 */
async function renderFrame(clipName, timeMs) {
  const clip = asset.clips.get(clipName);
  if (!clip) return null;
  const world = composeWorldTransforms(asset, sampleClip(clip, timeMs, rest));
  world.__doc = doc;
  const W = 96, H = 120, CX = 48, GROUND = 108;
  const layers = [];
  const issues = [];
  const boxes = [];
  for (const s of [...asset.slots].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))) {
    const att = s.attachment;
    if (!att || att.type !== 'image' || att.visible === false) continue;
    const { dir, name } = await loadArt(att.assetId);
    let pipe = sharp(path.join(dir, name));
    if (att.flipX) pipe = pipe.flop();
    const bone = world.get(s.bone);
    if (!bone) continue;
    const deg = (bone.rad * 180 / Math.PI) + (att.rot ?? 0);
    // 引擎是 ctx.rotate(+rad)（canvas y 向下 → 正角顺时针）→ 等价 sharp.rotate(+deg)
    let buf = await (deg ? pipe.rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }) : pipe).png().toBuffer();
    const rm = await sharp(buf).metadata();
    if (att.width && att.height && (Math.abs(att.width - rm.width) > 0.5 || Math.abs(att.height - rm.height) > 0.5)) {
      buf = await sharp(buf).resize(Math.max(1, Math.round(att.width)), Math.max(1, Math.round(att.height))).png().toBuffer();
    }
    const m = await sharp(buf).metadata();
    const cos = Math.cos(bone.rad), sin = Math.sin(bone.rad);
    const lx = att.x ?? 0, ly = att.y ?? 0;
    const ax = bone.x + lx * cos - ly * sin;
    const ay = bone.y + lx * sin + ly * cos;
    layers.push({
      input: buf,
      left: Math.round(CX + ax - m.width / 2),
      top: Math.round(GROUND + ay - m.height / 2)
    });
    boxes.push({ id: s.id, bone: s.bone, cx: ax, cy: ay, w: m.width, h: m.height });
    // 槽位偏离
    if (!COMPOSITIONAL.has(s.id)) {
      const def = doc.bones.find(x => x.id === s.bone);
      const dirY = def && def.y < 0 ? -1 : 1;
      const midY = bone.y + (def?.length || 0) / 2 * dirY;
      const dist = Math.hypot(ax - bone.x, ay - midY);
      if (dist > 15) issues.push(`${s.id} 偏离 ${s.bone} 段中点 ${dist.toFixed(1)}px`);
    }
  }
  // 脚贴地
  if (/^(idle_|walk_)/.test(clipName)) {
    for (const footId of ['footR', 'footL']) {
      const b = world.get(footId);
      if (!b) continue;
      if (b.y > 4) issues.push(`${footId} 穿地 ${b.y.toFixed(1)}px`);
      if (b.y < -10) issues.push(`${footId} 悬空 ${(-b.y).toFixed(1)}px`);
    }
  }
  // 端点覆盖：手/脚末端是否有图覆盖
  for (const [label, boneId] of [['右手', 'forearmR'], ['左手', 'forearmL'], ['右脚踝', 'shinR'], ['左脚踝', 'shinL']]) {
    const ends = boneEnds(world, boneId, doc);
    if (!ends) continue;
    const covered = boxes.some(b => Math.abs(ends.end.x - b.cx) <= b.w / 2 + 2 && Math.abs(ends.end.y - b.cy) <= b.h / 2 + 2);
    if (!covered) issues.push(`${label}（${boneId} 末端）无部件覆盖`);
  }
  const frame = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 26, g: 26, b: 30, alpha: 255 } } })
    .composite(layers).png().toBuffer();
  return { frame, issues };
}

/* ---------------- 全剪辑扫描 ---------------- */

const CELL_W = 96, CELL_H = 120, COLS = 6;
const clipNames = [...asset.clips.keys()];
const cells = [];
const allIssues = [];

for (const clipName of clipNames) {
  const clip = asset.clips.get(clipName);
  const times = clip.loop ? [0, Math.round(clip.durationMs / 2)] : [0, Math.round(clip.durationMs * 0.6)];
  let label = clipName;
  for (let i = 0; i < 2; i++) {
    const r = await renderFrame(clipName, times[i]);
    if (!r) { console.warn(`[skip] 剪辑 ${clipName} 不存在`); break; }
    cells.push({ input: r.frame, left: 0, top: 0, clipName, phase: i, label });
    if (i === 0) {
      if (r.issues.length) allIssues.push(`【${clipName}】\n  ` + r.issues.join('\n  '));
    } else if (r.issues.length) {
      allIssues.push(`【${clipName}@${times[1]}ms】\n  ` + r.issues.join('\n  '));
    }
  }
}

const rows = Math.ceil(cells.length / COLS);
const sheet = sharp({ create: { width: CELL_W * COLS, height: (CELL_H + 14) * rows, channels: 4, background: { r: 16, g: 16, b: 18, alpha: 255 } } });
const comps = [];
for (let i = 0; i < cells.length; i++) {
  const col = i % COLS, row = Math.floor(i / COLS);
  comps.push({ input: cells[i].input, left: col * CELL_W, top: row * (CELL_H + 14) + 14 });
  const svg = Buffer.from(`<svg width="${CELL_W}" height="14"><text x="4" y="11" font-size="10" fill="#8ac">${cells[i].label}${cells[i].phase ? ' mid' : ''}</text></svg>`);
  comps.push({ input: svg, left: col * CELL_W, top: row * (CELL_H + 14) });
}
await sheet.composite(comps).png().toFile(path.join(TEMP, 'fit-inspect.png'));
console.log(`拼图: Temp/fit-inspect.png（${clipNames.length} 剪辑 × 2 帧）`);

console.log('\n=== 自动规则检查 ===');
if (allIssues.length === 0) {
  console.log('全部通过：脚贴地 / 四肢末端覆盖 / 槽位贴合 均无异常');
} else {
  for (const line of allIssues) console.log(line);
}
