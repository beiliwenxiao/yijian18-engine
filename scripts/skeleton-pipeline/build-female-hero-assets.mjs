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
 * build-female-hero-assets.mjs —— 把 Female Hero 像素素材接成整帧角色资产。
 *
 * 源素材：D:/游戏资源/Female_Hero_Pixel_Art_v1.1（320×320 / 角色 ~85×220 / 地面 y=272 / 中心 x=160）
 *   License: 免费商用，可修改，不可转售转分发（见该目录 README.txt）。
 *
 * 产物：
 *   assets/images/player/female-hero/sheet.png      整帧大图（按「动作 × 方向」分行排布）
 *   assets/skeletons/female-hero.json               整帧骨架（1 骨 1 槽 sequence 附件 + meta.clipFrames）
 *
 * 与 player-lpc.json 同构（meta.frameMode + meta.clipFrames），由 PlayerLpcFrameMapper 驱动：
 *   - 连续状态：idle_/walk_ × 7 向（8 向素材全部利用，斜向不再回退）
 *   - 离散动作：jump / attack / death / climb_back（4 向，斜向回退正/背视）
 *   - 无对应素材的剪辑（gather/logging/mining/fishing/sleep/stretcher/soul）复用 Stand 帧占位
 *
 * 用法：node scripts/skeleton-pipeline/build-female-hero-assets.mjs
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = 'D:/游戏资源/Female_Hero_Pixel_Art_v1.1';
const OUT_IMG_DIR = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/female-hero');
const OUT_SKELETON = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/female-hero.json');
const SKELETON_ID = 'skeleton.female-hero';
const SHEET_ASSET_ID = 'player.female-hero.frames';

const meta = JSON.parse(readFileSync(path.join(SRC, 'metadata.json'), 'utf8'));
const GROUND_Y = meta.ground_y;      // 272
const CENTER_X = meta.center_x;      // 160

/** 引擎 7 向 → 源素材方向目录名。 */
const DIR_OF_KEY = {
  down: 'south',
  side: null,            // left/right 分开
  left: 'west',
  right: 'east',
  up: 'north',
  SE: 'south-east',
  SW: 'south-west',
  NE: 'north-east',
  NW: 'north-west'
};

/** 引擎 8 向形态键（左右为独立手绘帧，斜向为独立手绘帧，均不做镜像）。 */
const EIGHT_DIRS = ['down', 'left', 'right', 'up', 'SE', 'SW', 'NE', 'NW'];

/** 动作表：clipFrames 名字 → { state, keys }。素材每个动作都有 8 向。 */
const PLAN = [
  // 连续状态
  { action: 'idle', state: 'Idle', keys: EIGHT_DIRS },
  { action: 'walk', state: 'Walk', keys: EIGHT_DIRS },
  // 离散动作（原先只取 4 向，斜向由 mapper 回退；现全部 8 向）
  { action: 'jump', state: 'Jump', keys: EIGHT_DIRS },
  { action: 'attack', state: 'Attack', keys: EIGHT_DIRS },
  { action: 'death', state: 'Death', keys: EIGHT_DIRS },
  { action: 'climb', state: 'Climb', keys: EIGHT_DIRS },
  { action: 'stand', state: 'Stand', keys: EIGHT_DIRS }
];

/** 收集某动作某方向的所有帧路径。 */
function framesOf(state, dirName) {
  const st = meta.states[state];
  if (!st) throw new Error(`metadata 缺少状态 ${state}`);
  const raw = st.frames[dirName];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

const abs = p => path.join(SRC, p);

/** 量测单帧内容包围盒（用于求统一裁切窗口）。 */
async function bboxOfFrame(p) {
  const { data, info } = await sharp(abs(p)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] < 16) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { x0, x1, y0, y1 };
}

/* ---------------- 1. 求统一裁切窗口 ---------------- */
const allGroups = [];
let ux0 = 1e9, ux1 = -1e9, uy0 = 1e9;
for (const plan of PLAN) {
  for (const key of plan.keys) {
    const dirName = key === 'side' ? null : DIR_OF_KEY[key];
    if (!dirName) continue;
    const list = framesOf(plan.state, dirName);
    if (!list.length) continue;
    allGroups.push({ plan, key, dirName, list });
    for (const f of list) {
      const b = await bboxOfFrame(f);
      if (b.x0 < ux0) ux0 = b.x0;
      if (b.x1 > ux1) ux1 = b.x1;
      if (b.y0 < uy0) uy0 = b.y0;
    }
  }
}
const BOTTOM = GROUND_Y + 8;                       // 地面下留 8px（影子/落脚）
const halfW = Math.max(CENTER_X - ux0, ux1 - CENTER_X) + 2;
const RAW_W = Math.ceil(halfW * 2);
const RAW_H = BOTTOM - (uy0 - 2);
const CROP_X = Math.round(CENTER_X - RAW_W / 2);
const CROP_Y = BOTTOM - RAW_H;
// 源码 320×320 全尺寸，角色 ~220px 高；游戏内主角只画到 ~64px 高，
// 原尺寸整帧大图会到 20M+ 像素（解码慢/占内存），故按 SCALE 预缩。
const SCALE = 0.5;
const W = Math.round(RAW_W * SCALE);
const H = Math.round(RAW_H * SCALE);
const GROUND_LOCAL = Math.round((GROUND_Y - CROP_Y) * SCALE);
console.log(`统一裁切窗口：源 ${RAW_W}×${RAW_H} @ (${CROP_X},${CROP_Y}) → 缩放 ${SCALE} → ${W}×${H}，地面在窗口内 y=${GROUND_LOCAL}`);

/* ---------------- 2. 排布 + 合成整帧大图 ---------------- */
const MAX_COLS = Math.max(...allGroups.map(g => g.list.length));
const ROWS = allGroups.length;
const SHEET_W = MAX_COLS * W;
const SHEET_H = ROWS * H;
const sheet = Buffer.alloc(SHEET_W * SHEET_H * 4);   // 透明底

const clipFrames = {};
let row = 0;
for (const group of allGroups) {
  const { plan, key, list } = group;
  const st = meta.states[plan.state];
  const fps = st.fps || meta.suggested_fps?.[plan.state] || 8;
  const entry = clipFrames[plan.action] || (clipFrames[plan.action] = { fps, action: plan.action, dirs: {} });
  const rects = [];
  for (let i = 0; i < list.length; i++) {
    const { data, info } = await sharp(abs(list[i]))
      .extract({ left: CROP_X, top: CROP_Y, width: RAW_W, height: RAW_H })
      .resize({ width: W, height: H, kernel: 'nearest' })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== W || info.height !== H) {
      throw new Error(`裁切尺寸不符：${list[i]} → ${info.width}×${info.height}`);
    }
    for (let y = 0; y < H; y++) {
      const srcRow = y * W;
      const dstRow = ((row * H + y) * SHEET_W + i * W) * 4;
      data.copy(sheet, dstRow, srcRow * 4, (srcRow + W) * 4);
    }
    rects.push({ sx: i * W, sy: row * H, sw: W, sh: H });
  }
  entry.dirs[key] = rects;
  row++;
}

mkdirSync(OUT_IMG_DIR, { recursive: true });
const sheetPath = path.join(OUT_IMG_DIR, 'sheet.png');
await sharp(sheet, { raw: { width: SHEET_W, height: SHEET_H, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(sheetPath);
const sheetStat = (await import('node:fs')).statSync(sheetPath);
console.log(`整帧大图：${SHEET_W}×${SHEET_H}（${ROWS} 行 × 最多 ${MAX_COLS} 帧），${(sheetStat.size / 1024 / 1024).toFixed(2)} MB`);

/* ---------------- 3. 组装骨架资产 ---------------- */
const CLIP_NAMES = [
  'idle_down', 'idle_side', 'idle_up', 'idle_SE', 'idle_SW', 'idle_NE', 'idle_NW',
  'walk_down', 'walk_side', 'walk_up', 'walk_SE', 'walk_SW', 'walk_NE', 'walk_NW',
  'jump', 'attack', 'death', 'climb_back',
  'gather', 'logging', 'mining', 'fishing', 'sleep', 'stretcher', 'soul'
];
/** 引擎剪辑名 → 素材动作。连续状态按朝向取 8 向；离散动作只有 4 向（mapper 回退）。 */
const CLIP_ACTION = {
  idle_down: 'idle', idle_side: 'idle', idle_up: 'idle',
  idle_SE: 'idle', idle_SW: 'idle', idle_NE: 'idle', idle_NW: 'idle',
  walk_down: 'walk', walk_side: 'walk', walk_up: 'walk',
  walk_SE: 'walk', walk_SW: 'walk', walk_NE: 'walk', walk_NW: 'walk',
  jump: 'jump', attack: 'attack', death: 'death', climb_back: 'climb',
  gather: 'stand', logging: 'stand', mining: 'stand', fishing: 'stand',
  sleep: 'stand', stretcher: 'stand', soul: 'stand'
};

const frameAssetDir = { ...clipFrames };
const finalFrames = {};
for (const [clipName, action] of Object.entries(CLIP_ACTION)) {
  const src = frameAssetDir[action];
  if (!src) throw new Error(`动作 ${action} 未生成帧表`);
  finalFrames[clipName] = { fps: src.fps, action, dirs: src.dirs };
}

const firstRect = finalFrames.idle_down.dirs.down[0];
const doc = {
  schemaVersion: 1,
  skeletonId: SKELETON_ID,
  meta: {
    width: W,
    height: H,
    coordinateSpace: 'frame-v1',
    frameMode: true,
    frameAssetId: SHEET_ASSET_ID,
    // 地面在窗口内 y = GROUND_Y - CROP_Y；槽位挂在 root(0,0)，帧中心需抬到 H/2 - groundLocal
    clipFrames: finalFrames
  },
  defaultClip: 'idle_down',
  bones: [{ id: 'root', parent: null, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 0 }],
  slots: [{
    id: 'frame',
    bone: 'root',
    z: 0,
    attachment: {
      type: 'sequence',
      assetId: SHEET_ASSET_ID,
      spriteSheet: SHEET_ASSET_ID,
      x: 0,
      y: Math.round((H / 2 - GROUND_LOCAL) * 100) / 100,
      rot: 0,
      width: W,
      height: H,
      visible: true,
      fps: finalFrames.idle_down.fps,
      frames: [firstRect]
    }
  }],
  clips: CLIP_NAMES.map(name => ({ name, durationMs: null, loop: true, tracks: [] }))
};

writeFileSync(OUT_SKELETON, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

/* ---------------- 4. 校验：解析 + 帧矩形越界检查 ---------------- */
const { parseSkeletonAsset } = await import(pathToFileURL(path.join(root, 'src/animation/SkeletonAsset.js')).href);
const asset = parseSkeletonAsset(doc);
if (!asset) throw new Error('parseSkeletonAsset 失败');
for (const [clipName, entry] of Object.entries(finalFrames)) {
  for (const [dir, rects] of Object.entries(entry.dirs)) {
    for (const r of rects) {
      if (r.sx + r.sw > SHEET_W || r.sy + r.sh > SHEET_H) {
        throw new Error(`帧矩形越界 ${clipName}/${dir}: ${JSON.stringify(r)}`);
      }
    }
  }
}
console.log(`已写入 ${path.relative(root, OUT_SKELETON)}：${CLIP_NAMES.length} 剪辑 / ${ROWS} 方向组`);
console.log(`槽位 y=${doc.slots[0].attachment.y}（地面贴 root 原点）`);
