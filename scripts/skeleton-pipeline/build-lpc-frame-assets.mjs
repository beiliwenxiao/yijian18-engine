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
 * build-lpc-frame-assets.mjs —— LPC 整帧角色素材接入（切片 → 帧表 → 整帧骨架资产）。
 *
 * ## 素材来源与许可
 *   Universal LPC Sprite Male 01（OpenGameArt node/32390）
 *   原作 Stephen Challener (Redshrike)，生成器 Gaurav Munjal，
 *   许可 CC-BY-SA 3.0 + GPL3 —— 署名与相同方式共享见 assets/images/player/lpc/CREDITS.txt。
 *
 * ## LPC 整帧图布局（已实测）
 *   832×1344 = 13 列 × 21 行，每格 64×64；
 *   每 4 行 = 一个方向（up / left / down / right），共 5 个动作组 + 末行：
 *     行 0-3   idle（站立微动）
 *     行 4-7   walk（行走）
 *     行 8-11  spellcast（施法/举手）
 *     行 12-15 thrust（刺击/前伸）
 *     行 16-19 slash（挥砍）
 *     行 20    第 6 组 up（备用）
 *
 * ## 产物
 *   assets/images/player/lpc/frames.png          整帧大图（直接复用整图，不切散图）
 *   assets/skeletons/player-lpc.frames.json      帧表：动作 → 方向 → frames 矩形 + fps
 *   assets/skeletons/player-lpc.json             整帧骨架（1 骨 1 槽，sequence 附件）
 *
 * ## 运行时用法
 *   mapper 按「动作 + 方向」算出 frames 矩形列表 → skeletonComponent.setSlotOverride(
 *   'frame', { frames, fps })；SkeletonComponent 自动按 fps 循环推进帧游标
 *   （src/ecs/components/SkeletonComponent.js），SkeletonRenderer 直接绘制序列帧当前帧。
 *
 * ## 启用方式
 *   玩家外观在 example/sanguo_zhangjiao/data/CharactersConfig.js 的 spriteSheet
 *   指向 'skeleton.player-lpc' 即切到整帧模式（当前已切）。
 *   显示尺寸：presentation.json actors.player.visual = 64×64（1:1，像素锐利；
 *   改 128 即 2 倍整数放大，角色更高且像素等比放大仍锐利）。
 *
 * ## 已知限制
 *   LPC 整帧内不含武器/背挂/职业装饰 → 部件骨骼模式的武器槽联动与背挂在整帧模式下不生效。
 *
 * 用法：node scripts/skeleton-pipeline/build-lpc-frame-assets.mjs
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = path.join(root, 'Temp/lpc/male_full.png');
const LPC_DIR = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/lpc');
const SKELETON_DIR = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons');
const OUT_SHEET = path.join(LPC_DIR, 'frames.png');
const OUT_TABLE = path.join(SKELETON_DIR, 'player-lpc.frames.json');
const OUT_SKELETON = path.join(SKELETON_DIR, 'player-lpc.json');

if (!existsSync(SOURCE)) {
  throw new Error(`缺少 LPC 源图：${SOURCE}（先用 curl 下载 universal-lpc-sprite_male_01_full.png 到 Temp/lpc/）`);
}
mkdirSync(LPC_DIR, { recursive: true });

const CELL = 64;
const COLS = 13;
const ROWS = 21;

/**
 * 动作组定义：起始行 + 每方向行偏移（up/left/down/right）+ 帧率 + **有效帧数**。
 * 有效帧数由像素实测（每组第 8-13 列多为空帧，按 13 帧取会渲染空白帧 → 角色周期性消失）。
 */
const ACTIONS = [
  { id: 'idle',      row: 0,  fps: 6,  frames: 7 },
  { id: 'walk',      row: 4,  fps: 12, frames: 8 },
  { id: 'spellcast', row: 8,  fps: 10, frames: 9 },
  { id: 'thrust',    row: 12, fps: 12, frames: 6 },
  { id: 'slash',     row: 16, fps: 12, frames: 13 }
];
const DIR_ROWS = { up: 0, left: 1, down: 2, right: 3 };

/** LPC 各帧的脚底线（像素行，实测 60~63，站立帧恒为 61）→ 地面线基准。 */
const GROUND_Y = 61;
/** 附件以锚点为中心绘制（SkeletonRenderer: drawImage(-w/2,-h/2)）→ 需把地面线移到锚点上。 */
const FRAME_ANCHOR_Y = -(GROUND_Y - CELL / 2);

/**
 * 剪辑清单：名字对齐旧 player.json 的语义动作（引擎/内容侧靠 clip 名驱动，
 * 如 JumpSystem playClip('jump')、旧 mapper 的 idle_ / walk_ 命名约定），
 * 每个剪辑在 meta.clipFrames 里带该动作的帧表（4 方向）。
 * LPC 原生动作：idle / walk / spellcast / thrust / slash。
 */
const CLIP_DEFS = [
  // 待机三向（斜向回退：斜前→down、斜后→up）
  { name: 'idle_down', action: 'idle', dir: 'down' },
  { name: 'idle_side', action: 'idle', dir: 'left' },
  { name: 'idle_up', action: 'idle', dir: 'up' },
  { name: 'idle_SE', action: 'idle', dir: 'down' },
  { name: 'idle_SW', action: 'idle', dir: 'down' },
  { name: 'idle_NE', action: 'idle', dir: 'up' },
  { name: 'idle_NW', action: 'idle', dir: 'up' },
  // 行走七向
  { name: 'walk_down', action: 'walk', dir: 'down' },
  { name: 'walk_side', action: 'walk', dir: 'left' },
  { name: 'walk_up', action: 'walk', dir: 'up' },
  { name: 'walk_SE', action: 'walk', dir: 'down' },
  { name: 'walk_SW', action: 'walk', dir: 'down' },
  { name: 'walk_NE', action: 'walk', dir: 'up' },
  { name: 'walk_NW', action: 'walk', dir: 'up' },
  // 离散动作（LPC 无同名动作，按语义映射到最接近的原生动作）
  // 采集/伐木/钓鱼/挖矿 → thrust（单臂前伸用工具，比 spellcast 双手举更像"干活"）
  { name: 'jump', action: 'idle', dir: 'down' },
  { name: 'attack', action: 'slash', dir: 'down' },
  { name: 'gather', action: 'thrust', dir: 'down' },
  { name: 'logging', action: 'thrust', dir: 'down' },
  { name: 'mining', action: 'thrust', dir: 'down' },
  { name: 'fishing', action: 'thrust', dir: 'down' },
  { name: 'climb_back', action: 'walk', dir: 'up' },
  { name: 'sleep', action: 'idle', dir: 'up' },
  { name: 'stretcher', action: 'idle', dir: 'down' },
  { name: 'death', action: 'idle', dir: 'down' },
  { name: 'soul', action: 'idle', dir: 'up' }
];

/** 复制整帧大图到资产目录（不切散图，运行时按矩形取帧）。 */
copyFileSync(SOURCE, OUT_SHEET);

/** 帧表：动作 → 方向 → frames 矩形列表。 */
const table = {
  sheetAssetId: 'player.lpc.frames',
  sourceFile: 'assets/images/player/lpc/frames.png',
  cell: CELL,
  sheetWidth: COLS * CELL,
  sheetHeight: ROWS * CELL,
  license: 'CC-BY-SA-3.0 AND GPL-3.0',
  credit: 'Universal LPC Sprite (Redshrike / Gaurav Munjal) — 见 assets/images/player/lpc/CREDITS.txt',
  actions: {}
};

for (const action of ACTIONS) {
  const dirs = {};
  for (const [dir, offset] of Object.entries(DIR_ROWS)) {
    const row = action.row + offset;
    if (row >= ROWS) continue;
    const frames = [];
    for (let col = 0; col < action.frames; col++) {
      frames.push({ sx: col * CELL, sy: row * CELL, sw: CELL, sh: CELL });
    }
    dirs[dir] = { row, frames };
  }
  table.actions[action.id] = { fps: action.fps, frameCount: action.frames, dirs };
}

writeFileSync(OUT_TABLE, JSON.stringify(table, null, 2) + '\n', 'utf8');

/* ---------------- 整帧骨架：1 骨 1 槽（sequence 附件） ---------------- */

const idleDown = table.actions.idle.dirs.down.frames;

/**
 * 剪辑帧表：clip 名 → { fps, dirs: {down,left,up,right} → frames }。
 * 斜向剪辑按语义回退（斜前→down、斜后→up），方向切换由 mapper/编辑器按实际朝向取 dirs。
 */
const clipFrames = {};
for (const def of CLIP_DEFS) {
  const action = table.actions[def.action];
  const dirs = {};
  for (const [dir, info] of Object.entries(action.dirs)) {
    dirs[dir] = info.frames;
  }
  clipFrames[def.name] = { fps: action.fps, action: def.action, dirs };
}

const clips = CLIP_DEFS.map(def => {
  const action = table.actions[def.action];
  return {
    name: def.name,
    durationMs: Math.round((action.frames / action.fps) * 1000),
    loop: true,
    tracks: []
  };
});

const skeleton = {
  schemaVersion: 1,
  skeletonId: 'skeleton.player-lpc',
  meta: {
    width: 64,
    height: 64,
    coordinateSpace: 'lpc-frame-v1',
    frameMode: true,
    frameAssetId: 'player.lpc.frames',
    displayScale: 2,
    // 动作表内嵌（运行时 mapper 直接读，无需额外资产加载）：动作 → 方向 → frames + fps
    lpcActions: Object.fromEntries(Object.entries(table.actions).map(([id, act]) => [id, {
      fps: act.fps,
      frameCount: act.frameCount,
      dirs: Object.fromEntries(Object.entries(act.dirs).map(([dir, info]) => [dir, {
        row: info.row,
        frames: info.frames
      }]))
    }])),
    // 剪辑帧表（clip 名 → 帧表）：引擎 mapper 与编辑器预览共用同一份事实源
    clipFrames
  },
  defaultClip: 'idle_down',
  bones: [
    { id: 'root', parent: null, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 0 }
  ],
  slots: [
    {
      id: 'frame',
      bone: 'root',
      z: 0,
      attachment: {
        type: 'sequence',
        assetId: 'player.lpc.frames',
        spriteSheet: 'player.lpc.frames',
        x: 0, y: FRAME_ANCHOR_Y, rot: 0,
        width: CELL, height: CELL,
        visible: true,
        fps: table.actions.idle.fps,
        frames: idleDown
      }
    }
  ],
  // 整帧模式不用骨骼剪辑（tracks 为空占位）：动作由 meta.clipFrames 的帧表驱动
  clips
};

writeFileSync(OUT_SKELETON, JSON.stringify(skeleton, null, 2) + '\n', 'utf8');

console.log(`整帧大图: ${path.relative(root, OUT_SHEET)}`);
console.log(`帧表: ${path.relative(root, OUT_TABLE)}（动作 ${Object.keys(table.actions).join('/')}，有效帧 ${ACTIONS.map(a => a.id + ':' + a.frames).join(' ')}，每动作 4 方向）`);
console.log(`整帧骨架: ${path.relative(root, OUT_SKELETON)}`);
