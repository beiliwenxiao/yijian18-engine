/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-17
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

// 程序化生成「三头身短裙女」主角骨骼资产：25 张 64×64 部件 PNG（5 视角 × head/torso/skirt/arm/leg）
// + skirt-girl-chibi.json + manifest 自动登记（幂等）。纯 node（zlib 内置）。
//   node scripts/gen-skirt-girl-chibi-skeleton.mjs
//
// 比例（2026-11-17 用户裁定：三头身 Q 版，总高 96px）：
//   头 32px（头顶 y-96 → 下巴 y-64）/ 躯干+裙 32px（下巴 → 髋 y-32）/ 腿 32px（髋 → 脚 y0）。
//   与现有 skirt-girl.json（2.5 头身 / 76px）区分，作为主角候选资产（usage=player-skeleton）。
//
// 动作集（2026-11-17 用户裁定：与动作最多的 player-female 同款，共 30 clips）：
//   idle/walk/jump/attack 各 down+side+up（attack 额外覆盖 player-female 的裸名 attack），
//   walk 另有 SE/SW/NE/NW 斜向（复用 down/up 轨迹，只换方向形态图），
//   生产动作 gather/logging/mining/fishing（节奏与 player-female 对齐，幅度适配单段臂），
//   climb_back（背面攀爬）、sit/sit_up/lie/lie_up（坐卧过渡 once）、sleep/stretcher（躺姿 loop）、
//   soul（死亡灵魂漂浮 loop）、hurt（refugee 系列通用受击，player-female 无此动作，保留）。
//
// 方向形态约定（与 skirt-girl 同款 A 方案：一套骨骼 + 按形态换图，7 方向只需 5 套美术）：
//   front → down（基准图）        side → side（朝右，左侧靠引擎 flipX 镜像）
//   up    → up（背面）             se   → SE（朝右，SW 由引擎镜像复用同一套）
//                                  ne   → NE（朝右后方，NW 由引擎镜像复用同一套）
// skeleton JSON 只配 down（基准）/side/up/SE/NE 五个形态，SW/NW 走镜像回退。
//
// 美术替换位置（保持文件名即可零改 JSON）：
//   example/sanguo_zhangjiao/assets/images/skirt-girl-chibi/parts/<part>-<view>.png
//   part ∈ head|torso|skirt|arm|leg，view ∈ front|side|up|se|ne
//   资产 ID 与文件名同构：skirt-girl-chibi.parts.head-front 等。
//   画布语义：64×64，图片中心 (32,32) = 骨骼挂点（渲染器以锚点居中绘制）：
//     head  内容 y16~48（头顶 y16 / 下巴 y48，头高 32px）
//     torso 内容 y2~32（肩 y2 → 腰 y32=骨点）
//     skirt 内容 y32~48（腰 y32 → 裙摆 y48，膝上短裙）
//     arm   内容 y32~56（肩 y32 → 手 y56，臂长 24px）
//     leg   内容 y32~64（髋 y32 → 鞋底 y64，腿长 32px）
// 超出内容区的发梢/裙摆少量溢出可接受，但骨点 (32,32) 必须对准。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';

const SIZE = 64;
const ID = 'skirt-girl-chibi';
const IMG_ROOT = 'example/sanguo_zhangjiao/assets/images';
const OUT_DIR = 'example/sanguo_zhangjiao/assets/skeletons';
const MANIFEST = 'example/sanguo_zhangjiao/assets/manifests/assets.json';

// 真美术保护：parts 目录存在 .real-art 标记时占位生成整体跳过——
// 防止重跑本脚本把手绘部件图冲回占位默认。开始手绘前删除本脚本生成的 PNG、
// 放入手绘图后写入空文件 .real-art 即可锁定。
const REAL_ART_MARKER = `${IMG_ROOT}/${ID}/parts/.real-art`;
if (existsSync(REAL_ART_MARKER)) {
  console.log(`检测到真美术标记 ${REAL_ART_MARKER}，跳过占位美术生成`);
  process.exit(0);
}

/* ---------------- PNG 编码（与 gen-skirt-girl-skeleton.mjs 同款） ---------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePNG(pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 4 + 1)] = 0;
    pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function newPixels() { return Buffer.alloc(SIZE * SIZE * 4); }

function put(pixels, x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const offset = (y * SIZE + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3] ?? 255;
}

const rgb = hex => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16)
];

function fillEllipse(pixels, cx, cy, rx, ry, fill, outline) {
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y += 1) {
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x += 1) {
      const nx = (x + 0.5 - cx) / (rx + 0.5);
      const ny = (y + 0.5 - cy) / (ry + 0.5);
      if (nx * nx + ny * ny <= 1) put(pixels, x, y, outline ? rgb(outline) : rgb(fill));
    }
  }
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny <= 1) put(pixels, x, y, rgb(fill));
    }
  }
}

function fillRect(pixels, x0, y0, x1, y1, fill, outline) {
  if (outline) {
    for (let y = y0 - 1; y <= y1 + 1; y += 1) {
      for (let x = x0 - 1; x <= x1 + 1; x += 1) {
        if (x < x0 || x > x1 || y < y0 || y > y1) put(pixels, x, y, rgb(outline));
      }
    }
  }
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) put(pixels, x, y, rgb(fill));
  }
}

/** 逐行梯形填充（衣服/裙摆的锥形轮廓）。宽度函数返回半宽。 */
function fillRows(pixels, y0, y1, cx, halfWidthOf, fill, outline) {
  for (let y = y0; y <= y1; y += 1) {
    const half = Math.max(1, Math.round(halfWidthOf((y - y0) / Math.max(1, y1 - y0))));
    fillRect(pixels, cx - half, y, cx + half, y, fill, outline);
  }
}

/* ---------------- 配色（与 skirt-girl 同色系：深棕长发 + 青上衣 + 玫红短裙，保持角色色彩身份） ---------------- */

const PALETTE = {
  skin: '#f2cdac', skinLine: '#8f5f40',
  hair: '#3a2a22', hairLine: '#1d1410',
  cloth: '#5fb3c9', clothLine: '#2b5f6d',
  skirt: '#d86f7a', skirtLine: '#7d3a44',
  shoe: '#4a3a30',
  ribbon: '#ffd479',
  mouth: '#b8515c'
};
const DARK = '#2a201a';

/** 视角参数：front 正视 / side 侧视（朝右）/ up 背视 / se 右斜前 / ne 右斜后。 */
const VIEWS = {
  front: { cx: 32, narrow: 1, face: 'front', turn: 0 },
  side: { cx: 33, narrow: 0.62, face: 'side', turn: 2 },
  up: { cx: 32, narrow: 1, face: 'back', turn: 0 },
  se: { cx: 34, narrow: 0.84, face: 'quarter', turn: 3 },
  ne: { cx: 34, narrow: 0.86, face: 'back', turn: 3 }
};

const w = (value, view) => Math.max(1, Math.round(value * view.narrow));

/* ---------------- 部件绘制（中心 (32,32) = 骨点；三头身放大版） ---------------- */

/** 头部：内容 y16~48（头顶 y16 / 下巴 y48，头高 32px），后发可溢出到 y14~50。 */
function drawHead(pixels, view) {
  const cx = view.cx;
  const hairCy = 30 + (view.face === 'back' ? 1 : 0);
  // 后发（先画，脸盖在上面）：大头是三头身观感的核心
  fillEllipse(pixels, cx, hairCy, w(16, view), 17, PALETTE.hair, PALETTE.hairLine);
  if (view.face !== 'back') {
    // 脸
    const faceCx = cx + (view.face === 'side' ? 1 : 0);
    fillEllipse(pixels, faceCx, 37, w(12, view), 11, PALETTE.skin, PALETTE.skinLine);
    // 刘海 + 侧发
    fillEllipse(pixels, faceCx, 27, w(13, view), 6, PALETTE.hair, PALETTE.hairLine);
    fillRect(pixels, faceCx - w(12, view), 27, faceCx - w(8, view), 36, PALETTE.hair, PALETTE.hairLine);
    fillRect(pixels, faceCx + w(8, view), 27, faceCx + w(12, view), 36, PALETTE.hair, PALETTE.hairLine);
    if (view.face === 'side') {
      // 侧脸：单眼 + 鼻尖
      put(pixels, cx + 7, 39, rgb(DARK)); put(pixels, cx + 7, 40, rgb(DARK));
      put(pixels, cx + 12, 41, rgb(PALETTE.skinLine));
      put(pixels, cx + 11, 42, rgb(PALETTE.skinLine));
      fillRect(pixels, cx + 4, 45, cx + 8, 45, PALETTE.mouth);
    } else {
      // 正/斜前：双眼 + 嘴 + 腮红
      const eyeDx = view.face === 'quarter' ? 3 : 5;
      fillRect(pixels, faceCx - eyeDx, 39, faceCx - eyeDx, 40, DARK);
      fillRect(pixels, faceCx - eyeDx + 1, 39, faceCx - eyeDx + 1, 40, DARK);
      fillRect(pixels, faceCx + eyeDx - 1, 39, faceCx + eyeDx - 1, 40, DARK);
      fillRect(pixels, faceCx + eyeDx, 39, faceCx + eyeDx, 40, DARK);
      fillRect(pixels, faceCx - 1, 45, faceCx + 1, 45, PALETTE.mouth);
      fillRect(pixels, faceCx - 8, 43, faceCx - 8, 44, rgb('#e8a98c'));
      fillRect(pixels, faceCx + 8, 43, faceCx + 8, 44, rgb('#e8a98c'));
    }
  } else {
    // 背面：满后发 + 发带
    fillRect(pixels, cx - 14, 34, cx + 14, 44, PALETTE.hair, PALETTE.hairLine);
    fillRect(pixels, cx - w(14, view), 24, cx + w(14, view), 26, PALETTE.ribbon);
  }
}

/** 躯干（上衣）：肩 y2 → 腰 y32（骨点）。 */
function drawTorso(pixels, view) {
  const cx = view.cx;
  const shoulder = 2;
  const waist = 32;
  fillRows(pixels, shoulder, waist - 4, cx, progress => w(10 + progress * 2, view), PALETTE.cloth, PALETTE.clothLine);
  // 腰封
  fillRect(pixels, cx - w(11, view), waist - 4, cx + w(11, view), waist, PALETTE.skirt, PALETTE.skirtLine);
  if (view.face !== 'back') {
    // 领口 + 系带
    fillRect(pixels, cx - w(4, view), shoulder, cx + w(4, view), shoulder + 4, PALETTE.skin, PALETTE.skinLine);
    fillRect(pixels, cx - 2, waist - 10, cx + 2, waist - 1, PALETTE.ribbon);
  } else {
    // 背面：系带蝴蝶结
    fillRect(pixels, cx - 3, waist - 9, cx + 3, waist - 7, PALETTE.ribbon);
  }
  if (view.face === 'side') {
    // 侧视胸廓外轮廓
    fillEllipse(pixels, cx + 5, 18, 6, 6, PALETTE.cloth, PALETTE.clothLine);
  }
}

/** 短裙：腰 y32 → 裙摆 y48（膝上短裙；裙摆盖在腰封之上，z 高于上衣）。 */
function drawSkirt(pixels, view) {
  const cx = view.cx;
  fillRows(pixels, 32, 48, cx, progress => w(9 + progress * 4, view), PALETTE.skirt, PALETTE.skirtLine);
  // 褶线（弱对比，随裙摆略展开）
  for (let i = -2; i <= 2; i += 1) {
    const topX = cx + i * 3;
    const bottomX = cx + i * 4;
    fillRect(pixels, topX, 34, bottomX, 47, '#cb6470');
  }
  // 裙摆亮边（薄）
  fillRect(pixels, cx - w(13, view), 47, cx + w(13, view), 48, '#f0909a');
}

/** 手臂：肩 y32 → 手 y56（臂长 24px）；短袖 + 皮肤（腕不过腰）。 */
function drawArm(pixels, view) {
  const cx = view.cx;
  const sleeveEnd = 42;
  fillRect(pixels, cx - w(4, view), 32, cx + w(4, view), sleeveEnd, PALETTE.cloth, PALETTE.clothLine);
  fillRect(pixels, cx - w(3, view), sleeveEnd + 1, cx + w(3, view), 53, PALETTE.skin, PALETTE.skinLine);
  fillEllipse(pixels, cx, 55, w(3, view), 3, PALETTE.skin, PALETTE.skinLine); // 手
}

/** 腿：髋 y32 → 鞋底 y64（腿长 32px）；裸腿 + 短靴。 */
function drawLeg(pixels, view) {
  const cx = view.cx;
  fillRect(pixels, cx - w(4, view), 32, cx + w(4, view), 58, PALETTE.skin, PALETTE.skinLine);
  fillRect(pixels, cx - w(4, view), 58, cx + w(5, view), 63, PALETTE.shoe, DARK);
  if (view.face !== 'back') put(pixels, cx + w(4, view) + 1, 63, rgb(DARK)); // 鞋尖
}

/* ---------------- 骨骼资产 ---------------- */

/** 视角 → 形态键（down 为基准图，不写入 directionOffsets）。
 * 注意 view 名同时构成 assetId/文件名后缀——up 形态必须用 'up'（沿用 skirt-girl 教训）。 */
const VIEW_FORMS = [
  { view: 'side', form: 'side' },
  { view: 'up', form: 'up' },
  { view: 'se', form: 'SE' },
  { view: 'ne', form: 'NE' }
];

const partAssetId = (part, view) => `${ID}.parts.${part}-${view}`;

/** 基准图（down）+ 方向形态覆盖（side/up/SE/NE；SW/NW 由引擎镜像回退）。 */
function attachmentFor(part) {
  const base = {
    type: 'image', assetId: partAssetId(part, 'front'),
    x: 0, y: 0, rot: 0, width: SIZE, height: SIZE, visible: true
  };
  const directionOffsets = {};
  for (const { view, form } of VIEW_FORMS) {
    directionOffsets[form] = {
      assetId: partAssetId(part, view),
      x: 0, y: 0, rot: 0, width: SIZE, height: SIZE
    };
  }
  return { ...base, directionOffsets };
}

function loopTrack(bone, durationMs, samples) {
  return {
    bone,
    keys: samples.map((value, index) => ({ t: Math.round((index / samples.length) * durationMs), ...value }))
  };
}

function clip(name, durationMs, loop, tracks) { return { name, durationMs, loop, tracks }; }

/**
 * 骨骼树（root=脚底中心，y 向下为正；总高 96px 三头身）：
 *   root └ hips(0,-32) ─ torso(0,0) ─ head(0,-48)   头骨点世界 -80，头图 32px → 头顶 -96 / 下巴 -64
 *                       ├ skirt(0,2)
 *                       ├ armL(-10,-30)  ├ armR(10,-30)   肩世界 -62
 *          ├ legL(-5,0) └ legR(5,0)                        髋 -32 → 脚 0
 */
function buildDoc() {
  const bones = [
    { id: 'root', parent: null, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 10 },
    { id: 'hips', parent: 'root', x: 0, y: -32, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'torso', parent: 'hips', x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 18 },
    { id: 'head', parent: 'torso', x: 0, y: -48, rot: 0, scaleX: 1, scaleY: 1, length: 16 },
    { id: 'skirt', parent: 'hips', x: 0, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: 16 },
    { id: 'armL', parent: 'torso', x: -10, y: -30, rot: 0, scaleX: 1, scaleY: 1, length: 18 },
    { id: 'armR', parent: 'torso', x: 10, y: -30, rot: 0, scaleX: 1, scaleY: 1, length: 18 },
    { id: 'legL', parent: 'hips', x: -5, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 22 },
    { id: 'legR', parent: 'hips', x: 5, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 22 }
  ];
  const slots = [
    { id: 'shadow', bone: 'root', z: 0, attachment: { type: 'empty' } },
    { id: 'legR', bone: 'legR', z: 2, attachment: attachmentFor('leg') },
    { id: 'legL', bone: 'legL', z: 3, attachment: attachmentFor('leg') },
    { id: 'torsoSlot', bone: 'torso', z: 4, turnDelayMs: 40, turnFadeMs: 90, attachment: attachmentFor('torso') },
    // 裙摆盖在腰封上：z 高于上衣（短裙就是穿在衣服外面）
    { id: 'skirtSlot', bone: 'skirt', z: 6, turnDelayMs: 70, turnFadeMs: 90, attachment: attachmentFor('skirt') },
    { id: 'armL', bone: 'armL', z: 7, attachment: attachmentFor('arm') },
    { id: 'armR', bone: 'armR', z: 8, attachment: attachmentFor('arm') },
    { id: 'headFront', bone: 'head', z: 9, turnFadeMs: 90, attachment: attachmentFor('head') }
  ];
  const stride = 15;
  // 正/背视行走轨迹（walk_down/walk_up 与斜向 walk_SE/SW/NE/NW 共用，斜向只换方向形态图）
  const walkDownTracks = () => [
    loopTrack('root', 640, [{ y: 0 }, { y: -2, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }, { y: -2, ease: 'easeInOut' }]),
    loopTrack('torso', 640, [{ rot: -1.5 }, { rot: 1.5, ease: 'easeInOut' }, { rot: -1.5, ease: 'easeInOut' }]),
    loopTrack('skirt', 640, [{ rot: -5 }, { rot: 5, ease: 'easeInOut' }, { rot: -5, ease: 'easeInOut' }]),
    loopTrack('legL', 640, [{ rot: -3 }, { rot: 6, ease: 'easeInOut' }, { rot: -3, ease: 'easeInOut' }, { rot: 6, ease: 'easeInOut' }]),
    loopTrack('legR', 640, [{ rot: 6 }, { rot: -3, ease: 'easeInOut' }, { rot: 6, ease: 'easeInOut' }, { rot: -3, ease: 'easeInOut' }]),
    loopTrack('armL', 640, [{ rot: 8 }, { rot: -8, ease: 'easeInOut' }, { rot: 8, ease: 'easeInOut' }]),
    loopTrack('armR', 640, [{ rot: -8 }, { rot: 8, ease: 'easeInOut' }, { rot: -8, ease: 'easeInOut' }])
  ];
  const walkUpTracks = () => [
    loopTrack('root', 640, [{ y: 0 }, { y: -2, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }, { y: -2, ease: 'easeInOut' }]),
    loopTrack('torso', 640, [{ rot: -1.5 }, { rot: 1.5, ease: 'easeInOut' }, { rot: -1.5, ease: 'easeInOut' }]),
    loopTrack('skirt', 640, [{ rot: -5 }, { rot: 5, ease: 'easeInOut' }, { rot: -5, ease: 'easeInOut' }]),
    loopTrack('legL', 640, [{ rot: -3 }, { rot: 6, ease: 'easeInOut' }, { rot: -3, ease: 'easeInOut' }, { rot: 6, ease: 'easeInOut' }]),
    loopTrack('legR', 640, [{ rot: 6 }, { rot: -3, ease: 'easeInOut' }, { rot: 6, ease: 'easeInOut' }, { rot: -3, ease: 'easeInOut' }]),
    loopTrack('armL', 640, [{ rot: 8 }, { rot: -8, ease: 'easeInOut' }, { rot: 8, ease: 'easeInOut' }]),
    loopTrack('armR', 640, [{ rot: -8 }, { rot: 8, ease: 'easeInOut' }, { rot: -8, ease: 'easeInOut' }])
  ];
  const clips = [
    // 正面待机：呼吸起伏 + 裙摆微摆
    clip('idle_down', 1400, true, [
      loopTrack('root', 1400, [{ y: 0 }, { y: -1, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }]),
      loopTrack('torso', 1400, [{ rot: -1 }, { rot: 1, ease: 'easeInOut' }, { rot: -1, ease: 'easeInOut' }]),
      loopTrack('skirt', 1400, [{ rot: -1.5 }, { rot: 1.5, ease: 'easeInOut' }, { rot: -1.5, ease: 'easeInOut' }]),
      loopTrack('head', 1400, [{ rot: 0 }, { rot: 1, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }])
    ]),
    // 侧面待机
    clip('idle_side', 1400, true, [
      loopTrack('root', 1400, [{ y: 0 }, { y: -1, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }]),
      loopTrack('torso', 1400, [{ rot: -1.5 }, { rot: 0.5, ease: 'easeInOut' }, { rot: -1.5, ease: 'easeInOut' }]),
      loopTrack('skirt', 1400, [{ rot: -2 }, { rot: 2, ease: 'easeInOut' }, { rot: -2, ease: 'easeInOut' }])
    ]),
    // 背面待机
    clip('idle_up', 1400, true, [
      loopTrack('root', 1400, [{ y: 0 }, { y: -1, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }]),
      loopTrack('torso', 1400, [{ rot: -1 }, { rot: 1, ease: 'easeInOut' }, { rot: -1, ease: 'easeInOut' }]),
      loopTrack('skirt', 1400, [{ rot: -1.5 }, { rot: 1.5, ease: 'easeInOut' }, { rot: -1.5, ease: 'easeInOut' }])
    ]),
    // 正面走（斜向 SE/SW 复用同一轨迹，只换方向形态图）
    clip('walk_down', 640, true, walkDownTracks()),
    clip('walk_SE', 640, true, walkDownTracks()),
    clip('walk_SW', 640, true, walkDownTracks()),
    // 侧面走：标准对侧摆臂
    clip('walk_side', 620, true, [
      loopTrack('root', 620, [{ y: 0 }, { y: -2.5, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }, { y: -2.5, ease: 'easeInOut' }]),
      loopTrack('torso', 620, [{ rot: -2 }, { rot: 2, ease: 'easeInOut' }, { rot: -2, ease: 'easeInOut' }]),
      loopTrack('skirt', 620, [{ rot: -6 }, { rot: 6, ease: 'easeInOut' }, { rot: -6, ease: 'easeInOut' }]),
      loopTrack('legL', 620, [
        { rot: -stride }, { rot: 0, ease: 'easeInOut' }, { rot: stride, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('legR', 620, [
        { rot: stride }, { rot: 0, ease: 'easeInOut' }, { rot: -stride, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('armL', 620, [
        { rot: stride * 0.7 }, { rot: 0, ease: 'easeInOut' }, { rot: -stride * 0.7, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('armR', 620, [
        { rot: -stride * 0.7 }, { rot: 0, ease: 'easeInOut' }, { rot: stride * 0.7, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ])
    ]),
    // 背面走（斜向 NE/NW 复用同一轨迹，只换方向形态图）
    clip('walk_up', 640, true, walkUpTracks()),
    clip('walk_NE', 640, true, walkUpTracks()),
    clip('walk_NW', 640, true, walkUpTracks()),
    // 跳跃（正/背视）：下蹲 → 腾空收腿 → 落地缓冲
    clip('jump_down', 500, false, [
      { bone: 'root', keys: [
        { t: 0, y: 0 }, { t: 120, y: 2, ease: 'easeInOut' }, { t: 200, y: -12, ease: 'easeOut' },
        { t: 320, y: -12 }, { t: 420, y: 3, ease: 'easeIn' }, { t: 500, y: 0, ease: 'easeInOut' }
      ] },
      { bone: 'legL', keys: [
        { t: 0, rot: 0 }, { t: 120, rot: 8, ease: 'easeInOut' }, { t: 200, rot: -10, ease: 'easeInOut' },
        { t: 320, rot: -10 }, { t: 420, rot: 8, ease: 'easeInOut' }, { t: 500, rot: 0 }
      ] },
      { bone: 'legR', keys: [
        { t: 0, rot: 0 }, { t: 120, rot: -8, ease: 'easeInOut' }, { t: 200, rot: 10, ease: 'easeInOut' },
        { t: 320, rot: 10 }, { t: 420, rot: -8, ease: 'easeInOut' }, { t: 500, rot: 0 }
      ] },
      { bone: 'skirt', keys: [
        { t: 0, rot: 0 }, { t: 200, rot: -8, ease: 'easeInOut' }, { t: 320, rot: 6 }, { t: 500, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: 0 }, { t: 120, rot: -20, ease: 'easeInOut' }, { t: 320, rot: -30 }, { t: 500, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armR', keys: [
        { t: 0, rot: 0 }, { t: 120, rot: 20, ease: 'easeInOut' }, { t: 320, rot: 30 }, { t: 500, rot: 0, ease: 'easeInOut' }
      ] }
    ]),
    // 跳跃（背视）
    clip('jump_up', 500, false, [
      { bone: 'root', keys: [
        { t: 0, y: 0 }, { t: 120, y: 2, ease: 'easeInOut' }, { t: 200, y: -12, ease: 'easeOut' },
        { t: 320, y: -12 }, { t: 420, y: 3, ease: 'easeIn' }, { t: 500, y: 0, ease: 'easeInOut' }
      ] },
      { bone: 'legL', keys: [
        { t: 0, rot: 0 }, { t: 120, rot: 8, ease: 'easeInOut' }, { t: 200, rot: -10, ease: 'easeInOut' },
        { t: 320, rot: -10 }, { t: 420, rot: 8, ease: 'easeInOut' }, { t: 500, rot: 0 }
      ] },
      { bone: 'legR', keys: [
        { t: 0, rot: 0 }, { t: 120, rot: -8, ease: 'easeInOut' }, { t: 200, rot: 10, ease: 'easeInOut' },
        { t: 320, rot: 10 }, { t: 420, rot: -8, ease: 'easeInOut' }, { t: 500, rot: 0 }
      ] },
      { bone: 'skirt', keys: [
        { t: 0, rot: 0 }, { t: 200, rot: 8, ease: 'easeInOut' }, { t: 320, rot: -6 }, { t: 500, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: 0 }, { t: 120, rot: 20, ease: 'easeInOut' }, { t: 320, rot: 30 }, { t: 500, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armR', keys: [
        { t: 0, rot: 0 }, { t: 120, rot: -20, ease: 'easeInOut' }, { t: 320, rot: -30 }, { t: 500, rot: 0, ease: 'easeInOut' }
      ] }
    ]),
    // 跳跃（侧视）：腿前后分 → 收 → 落
    clip('jump_side', 500, false, [
      { bone: 'root', keys: [
        { t: 0, y: 0 }, { t: 120, y: 2, ease: 'easeInOut' }, { t: 200, y: -12, ease: 'easeOut' },
        { t: 320, y: -12 }, { t: 420, y: 3, ease: 'easeIn' }, { t: 500, y: 0, ease: 'easeInOut' }
      ] },
      { bone: 'legL', keys: [
        { t: 0, rot: 0 }, { t: 120, rot: 10, ease: 'easeInOut' }, { t: 200, rot: -18, ease: 'easeInOut' },
        { t: 320, rot: -18 }, { t: 420, rot: 12, ease: 'easeInOut' }, { t: 500, rot: 0 }
      ] },
      { bone: 'legR', keys: [
        { t: 0, rot: 0 }, { t: 120, rot: -10, ease: 'easeInOut' }, { t: 200, rot: 18, ease: 'easeInOut' },
        { t: 320, rot: 18 }, { t: 420, rot: -12, ease: 'easeInOut' }, { t: 500, rot: 0 }
      ] },
      { bone: 'skirt', keys: [
        { t: 0, rot: 0 }, { t: 200, rot: -7, ease: 'easeInOut' }, { t: 320, rot: 5 }, { t: 500, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: 0 }, { t: 200, rot: -25, ease: 'easeInOut' }, { t: 500, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armR', keys: [
        { t: 0, rot: 0 }, { t: 200, rot: 25, ease: 'easeInOut' }, { t: 500, rot: 0, ease: 'easeInOut' }
      ] }
    ]),
    // 正面攻击：右臂挥击 + 躯干前顶 + 裙摆滞后
    clip('attack_down', 340, false, [
      { bone: 'armR', keys: [
        { t: 0, rot: -55 }, { t: 150, rot: 45, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'torso', keys: [
        { t: 0, rot: -4 }, { t: 150, rot: 7, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'skirt', keys: [
        { t: 0, rot: 0 }, { t: 150, rot: -6, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: 8 }, { t: 150, rot: -12, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] }
    ]),
    // 侧面攻击：大幅前后挥砍
    clip('attack_side', 340, false, [
      { bone: 'armR', keys: [
        { t: 0, rot: -70 }, { t: 150, rot: 50, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'torso', keys: [
        { t: 0, rot: -5 }, { t: 150, rot: 8, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'skirt', keys: [
        { t: 0, rot: 0 }, { t: 150, rot: -7, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: 10 }, { t: 150, rot: -15, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] }
    ]),
    // 背面攻击
    clip('attack_up', 340, false, [
      { bone: 'armR', keys: [
        { t: 0, rot: -50 }, { t: 150, rot: 40, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'torso', keys: [
        { t: 0, rot: 4 }, { t: 150, rot: -7, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'skirt', keys: [
        { t: 0, rot: 0 }, { t: 150, rot: 6, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: -8 }, { t: 150, rot: 12, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] }
    ]),
    // 挨打：后仰缩肩
    clip('hurt', 260, false, [
      { bone: 'torso', keys: [
        { t: 0, rot: 0 }, { t: 90, rot: -13, ease: 'easeInOut' }, { t: 260, rot: -3, ease: 'easeInOut' }
      ] },
      { bone: 'head', keys: [
        { t: 0, rot: 0 }, { t: 90, rot: -9, ease: 'easeInOut' }, { t: 260, rot: -2, ease: 'easeInOut' }
      ] },
      { bone: 'root', keys: [
        { t: 0, x: 0 }, { t: 90, x: -3, ease: 'easeInOut' }, { t: 260, x: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: 0 }, { t: 90, rot: 16, ease: 'easeInOut' }, { t: 260, rot: 4, ease: 'easeInOut' }
      ] },
      { bone: 'armR', keys: [
        { t: 0, rot: 0 }, { t: 90, rot: 16, ease: 'easeInOut' }, { t: 260, rot: 4, ease: 'easeInOut' }
      ] }
    ]),
    // 倒地
    clip('death', 520, false, [
      { bone: 'hips', keys: [
        { t: 0, rot: 0, y: -32 }, { t: 380, rot: 85, y: -12, ease: 'easeInOut' }, { t: 520, rot: 85, y: -12 }
      ] },
      { bone: 'torso', keys: [
        { t: 0, rot: 0 }, { t: 260, rot: 12, ease: 'easeInOut' }, { t: 520, rot: 4 }
      ] },
      { bone: 'head', keys: [
        { t: 0, rot: 0 }, { t: 380, rot: 12, ease: 'easeInOut' }, { t: 520, rot: 12 }
      ] },
      { bone: 'skirt', keys: [
        { t: 0, rot: 0 }, { t: 380, rot: 18, ease: 'easeInOut' }, { t: 520, rot: 18 }
      ] },
      { bone: 'legL', keys: [
        { t: 0, rot: 0 }, { t: 380, rot: 10, ease: 'easeInOut' }, { t: 520, rot: 10 }
      ] },
      { bone: 'legR', keys: [
        { t: 0, rot: 0 }, { t: 380, rot: -8, ease: 'easeInOut' }, { t: 520, rot: -8 }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: 0 }, { t: 380, rot: 28, ease: 'easeInOut' }, { t: 520, rot: 28 }
      ] },
      { bone: 'armR', keys: [
        { t: 0, rot: 0 }, { t: 380, rot: -28, ease: 'easeInOut' }, { t: 520, rot: -28 }
      ] }
    ]),
    // 灵魂升起（death 后漂浮）：悬空循环 + 微摆（语义对齐 player-female soul）
    clip('soul', 2200, true, [
      { bone: 'hips', keys: [
        { t: 0, y: -55 }, { t: 550, y: -59, ease: 'easeInOut' }, { t: 1100, y: -63, ease: 'easeInOut' }, { t: 1650, y: -59, ease: 'easeInOut' }
      ] },
      loopTrack('torso', 2200, [{ rot: -3 }, { rot: 0, ease: 'easeInOut' }, { rot: 3, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }]),
      loopTrack('head', 2200, [{ rot: -2 }, { rot: 0, ease: 'easeInOut' }, { rot: 2, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }]),
      loopTrack('skirt', 2200, [{ rot: -2 }, { rot: 2, ease: 'easeInOut' }, { rot: -2, ease: 'easeInOut' }])
    ]),
    // 采集（弯腰伸手循环，语义对齐 player-female gather 900ms）
    clip('gather', 900, true, [
      loopTrack('root', 900, [{ y: 0 }, { y: -2, ease: 'easeInOut' }, { y: -3, ease: 'easeInOut' }, { y: -2, ease: 'easeInOut' }]),
      loopTrack('torso', 900, [{ rot: 0 }, { rot: 14, ease: 'easeInOut' }, { rot: 28, ease: 'easeInOut' }, { rot: 14, ease: 'easeInOut' }]),
      loopTrack('armR', 900, [{ rot: 0 }, { rot: -25, ease: 'easeInOut' }, { rot: -50, ease: 'easeInOut' }, { rot: -25, ease: 'easeInOut' }]),
      loopTrack('armL', 900, [{ rot: 0 }, { rot: -6, ease: 'easeInOut' }, { rot: -12, ease: 'easeInOut' }, { rot: -6, ease: 'easeInOut' }]),
      loopTrack('legL', 900, [{ rot: 0 }, { rot: -5, ease: 'easeInOut' }, { rot: -5, ease: 'easeInOut' }]),
      loopTrack('legR', 900, [{ rot: 0 }, { rot: 5, ease: 'easeInOut' }, { rot: 5, ease: 'easeInOut' }])
    ]),
    // 伐木（高举劈斧循环，对齐 logging 1100ms：99→16.5→-66→16.5）
    clip('logging', 1100, true, [
      loopTrack('root', 1100, [{ y: 0 }, { y: -1, ease: 'easeInOut' }, { y: -2, ease: 'easeInOut' }, { y: -1, ease: 'easeInOut' }]),
      loopTrack('torso', 1100, [{ rot: -6 }, { rot: 5, ease: 'easeInOut' }, { rot: 16, ease: 'easeInOut' }, { rot: 5, ease: 'easeInOut' }]),
      loopTrack('armR', 1100, [{ rot: 99, ease: 'easeInOut' }, { rot: 16.5, ease: 'easeInOut' }, { rot: -66, ease: 'easeInOut' }, { rot: 16.5, ease: 'easeInOut' }]),
      loopTrack('armL', 1100, [{ rot: 0 }, { rot: -10, ease: 'easeInOut' }, { rot: -18, ease: 'easeInOut' }, { rot: -10, ease: 'easeInOut' }])
    ]),
    // 采矿（凿击循环，对齐 mining 800ms：74→11.5→-51→11.5）
    clip('mining', 800, true, [
      loopTrack('root', 800, [{ y: 0 }, { y: -1, ease: 'easeInOut' }, { y: -2, ease: 'easeInOut' }, { y: -1, ease: 'easeInOut' }]),
      loopTrack('armR', 800, [{ rot: 74, ease: 'easeInOut' }, { rot: 11.5, ease: 'easeInOut' }, { rot: -51, ease: 'easeInOut' }, { rot: 11.5, ease: 'easeInOut' }]),
      loopTrack('armL', 800, [{ rot: 20, ease: 'easeInOut' }, { rot: 10, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }, { rot: 10, ease: 'easeInOut' }]),
      loopTrack('torso', 800, [{ rot: 0 }, { rot: 4, ease: 'easeInOut' }, { rot: 9, ease: 'easeInOut' }, { rot: 4, ease: 'easeInOut' }])
    ]),
    // 钓鱼（持竿静立 + 偶发提竿，对齐 fishing 2200ms：44→9→-26→-5）
    clip('fishing', 2200, true, [
      loopTrack('torso', 2200, [{ rot: 0 }, { rot: 2, ease: 'easeInOut' }, { rot: 4, ease: 'easeInOut' }, { rot: 3, ease: 'easeInOut' }]),
      loopTrack('armR', 2200, [{ rot: 44, ease: 'easeInOut' }, { rot: 9, ease: 'easeInOut' }, { rot: -26, ease: 'easeInOut' }, { rot: -5, ease: 'easeInOut' }]),
      loopTrack('armL', 2200, [{ rot: -10 }, { rot: -10, ease: 'easeInOut' }, { rot: -8, ease: 'easeInOut' }, { rot: -10, ease: 'easeInOut' }])
    ]),
    // 背面攀爬（双臂交替上举 + 双腿交替 + 缓慢爬升，对齐 climb_back 700ms）
    clip('climb_back', 700, true, [
      { bone: 'hips', keys: [
        { t: 0, y: -32 }, { t: 175, y: -34, ease: 'easeInOut' }, { t: 350, y: -36, ease: 'easeInOut' }, { t: 525, y: -34, ease: 'easeInOut' }
      ] },
      loopTrack('torso', 700, [{ rot: 3 }, { rot: 0, ease: 'easeInOut' }, { rot: -3, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }]),
      loopTrack('armR', 700, [{ rot: 174 }, { rot: 141.5, ease: 'easeInOut' }, { rot: 109, ease: 'easeInOut' }, { rot: 141.5, ease: 'easeInOut' }]),
      loopTrack('armL', 700, [{ rot: -115 }, { rot: -147.5, ease: 'easeInOut' }, { rot: -180, ease: 'easeInOut' }, { rot: -147.5, ease: 'easeInOut' }]),
      loopTrack('legL', 700, [{ rot: 0 }, { rot: 12, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }, { rot: -12, ease: 'easeInOut' }]),
      loopTrack('legR', 700, [{ rot: 0 }, { rot: -12, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }, { rot: 12, ease: 'easeInOut' }])
    ]),
    // 坐下（站→坐过渡，坐姿为屈膝盘坐：hips 半降 + 双腿外撇对折）
    clip('sit', 480, false, [
      { bone: 'hips', keys: [
        { t: 0, y: -32 }, { t: 480, y: -16, ease: 'easeInOut' }
      ] },
      { bone: 'legL', keys: [
        { t: 0, rot: 0 }, { t: 480, rot: -55, ease: 'easeInOut' }
      ] },
      { bone: 'legR', keys: [
        { t: 0, rot: 0 }, { t: 480, rot: 55, ease: 'easeInOut' }
      ] },
      { bone: 'torso', keys: [
        { t: 0, rot: 0 }, { t: 480, rot: 4, ease: 'easeInOut' }
      ] },
      { bone: 'head', keys: [
        { t: 0, rot: 0 }, { t: 480, rot: -3, ease: 'easeInOut' }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: 0 }, { t: 480, rot: 14, ease: 'easeInOut' }
      ] },
      { bone: 'armR', keys: [
        { t: 0, rot: 0 }, { t: 480, rot: 14, ease: 'easeInOut' }
      ] },
      { bone: 'skirt', keys: [
        { t: 0, rot: 0 }, { t: 480, rot: 3, ease: 'easeInOut' }
      ] }
    ]),
    // 起身（坐→站，sit 的逆过程）
    clip('sit_up', 480, false, [
      { bone: 'hips', keys: [
        { t: 0, y: -16 }, { t: 480, y: -32, ease: 'easeInOut' }
      ] },
      { bone: 'legL', keys: [
        { t: 0, rot: -55 }, { t: 480, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'legR', keys: [
        { t: 0, rot: 55 }, { t: 480, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'torso', keys: [
        { t: 0, rot: 4 }, { t: 480, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'head', keys: [
        { t: 0, rot: -3 }, { t: 480, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: 14 }, { t: 480, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armR', keys: [
        { t: 0, rot: 14 }, { t: 480, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'skirt', keys: [
        { t: 0, rot: 3 }, { t: 480, rot: 0, ease: 'easeInOut' }
      ] }
    ]),
    // 躺下（站→平躺过渡：hips 倒转 -90，语义对齐 player-female lie）
    clip('lie', 640, false, [
      { bone: 'hips', keys: [
        { t: 0, y: -32, rot: 0 }, { t: 320, y: -22, rot: -45, ease: 'easeInOut' }, { t: 640, y: -8, rot: -90, ease: 'easeInOut' }
      ] },
      { bone: 'torso', keys: [
        { t: 0, rot: 0 }, { t: 320, rot: 10, ease: 'easeInOut' }, { t: 640, rot: 10, ease: 'easeInOut' }
      ] },
      { bone: 'head', keys: [
        { t: 0, rot: 0 }, { t: 320, rot: 4, ease: 'easeInOut' }, { t: 640, rot: 4, ease: 'easeInOut' }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: 0 }, { t: 320, rot: -14, ease: 'easeInOut' }, { t: 640, rot: -14, ease: 'easeInOut' }
      ] },
      { bone: 'armR', keys: [
        { t: 0, rot: 0 }, { t: 320, rot: -14, ease: 'easeInOut' }, { t: 640, rot: -14, ease: 'easeInOut' }
      ] },
      { bone: 'skirt', keys: [
        { t: 0, rot: 0 }, { t: 640, rot: 8, ease: 'easeInOut' }
      ] }
    ]),
    // 起床（躺→站，lie 的逆过程）
    clip('lie_up', 640, false, [
      { bone: 'hips', keys: [
        { t: 0, y: -8, rot: -90 }, { t: 320, y: -22, rot: -45, ease: 'easeInOut' }, { t: 640, y: -32, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'torso', keys: [
        { t: 0, rot: 10 }, { t: 320, rot: 10, ease: 'easeInOut' }, { t: 640, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'head', keys: [
        { t: 0, rot: 4 }, { t: 320, rot: 4, ease: 'easeInOut' }, { t: 640, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: -14 }, { t: 320, rot: -14, ease: 'easeInOut' }, { t: 640, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armR', keys: [
        { t: 0, rot: -14 }, { t: 320, rot: -14, ease: 'easeInOut' }, { t: 640, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'skirt', keys: [
        { t: 0, rot: 8 }, { t: 640, rot: 0, ease: 'easeInOut' }
      ] }
    ]),
    // 睡觉（躺姿呼吸循环，起始即躺姿；方向与 lie 末帧一致）
    clip('sleep', 2400, true, [
      { bone: 'hips', keys: [
        { t: 0, y: -8, rot: -90 }, { t: 600, y: -8.5, rot: -89.5, ease: 'easeInOut' }, { t: 1200, y: -9, rot: -89, ease: 'easeInOut' }, { t: 1800, y: -8.5, rot: -89.5, ease: 'easeInOut' }
      ] },
      loopTrack('head', 2400, [{ rot: 4 }, { rot: 5, ease: 'easeInOut' }, { rot: 6, ease: 'easeInOut' }, { rot: 5, ease: 'easeInOut' }]),
      { bone: 'legL', keys: [{ t: 0, rot: -6 }] },
      { bone: 'legR', keys: [{ t: 0, rot: 6 }] },
      { bone: 'armL', keys: [{ t: 0, rot: -25 }] },
      { bone: 'armR', keys: [{ t: 0, rot: 19 }] },
      { bone: 'skirt', keys: [{ t: 0, rot: 8 }] }
    ]),
    // 担架（平躺被抬，微颤循环；对齐 stretcher 1200ms）
    clip('stretcher', 1200, true, [
      { bone: 'hips', keys: [
        { t: 0, y: -10, rot: -88 }, { t: 300, y: -11.5, rot: -87, ease: 'easeInOut' }, { t: 600, y: -13, rot: -86, ease: 'easeInOut' }, { t: 900, y: -11.5, rot: -87, ease: 'easeInOut' }
      ] },
      { bone: 'legL', keys: [{ t: 0, rot: -6 }] },
      { bone: 'legR', keys: [{ t: 0, rot: 6 }] },
      { bone: 'skirt', keys: [{ t: 0, rot: 8 }] },
      { bone: 'head', keys: [{ t: 0, rot: 3 }] }
    ])
  ];
  return {
    schemaVersion: 1,
    skeletonId: `skeleton.${ID}`,
    meta: { width: 64, height: 96 },
    defaultClip: 'idle_down',
    bones,
    slots,
    constraints: [],
    clips
  };
}

/* ---------------- manifest 登记（幂等：按 assetId 去重） ---------------- */

function upsertManifest(entries) {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (!Array.isArray(manifest.assets)) throw new Error('manifest.assets 缺失');
  const byId = new Map(manifest.assets.map(asset => [asset.assetId, asset]));
  for (const entry of entries) byId.set(entry.assetId, entry);
  manifest.assets = [...byId.values()];
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  return entries.length;
}

/* ---------------- 写盘 ---------------- */

const PARTS = [
  { part: 'head', draw: drawHead },
  { part: 'torso', draw: drawTorso },
  { part: 'skirt', draw: drawSkirt },
  { part: 'arm', draw: drawArm },
  { part: 'leg', draw: drawLeg }
];

mkdirSync(`${IMG_ROOT}/${ID}/parts`, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const manifestEntries = [];
for (const { part, draw } of PARTS) {
  for (const [viewName, view] of Object.entries(VIEWS)) {
    const pixels = newPixels();
    draw(pixels, view);
    const fileName = `${part}-${viewName}.png`;
    const relative = `assets/images/${ID}/parts/${fileName}`;
    writeFileSync(`${IMG_ROOT}/${ID}/parts/${fileName}`, encodePNG(pixels));
    const assetId = partAssetId(part, viewName);
    manifestEntries.push({
      assetId,
      imageId: assetId,
      category: 'character-part',
      usage: [`${ID}-skeleton-part`],
      sourceFile: relative,
      runtime2D: { path: relative, mode: 'image' },
      runtime3D: { mode: 'billboard', sourceAssetId: assetId },
      pivot: { x: 0.5, y: 0.5 },
      bounds: { width: SIZE, height: SIZE },
      grid: { columns: 1, rows: 1, cellWidth: SIZE, cellHeight: SIZE },
      animations: [],
      targetPhase: 'P1',
      status: 'ai-generated',
      revision: 1
    });
  }
}

const doc = buildDoc();
// 关键帧 ease 补全：显式 ease（easeInOut）保留，缺省补 'linear'——与运行时
// segmentProgress 的缺省一致（行为零变化），旧/新版 SkeletonAssetValidator 都能过。
// 背景：2026-11-17 编辑器保存报 keys[N].ease 缺少必填项 linear/easeInOut（旧版校验器必填）
for (const clipEntry of doc.clips) {
  for (const track of clipEntry.tracks) {
    for (const key of track.keys) {
      if (key.ease === undefined) key.ease = 'linear';
    }
  }
}
const outFile = `${OUT_DIR}/${ID}.json`;
writeFileSync(outFile, `${JSON.stringify(doc, null, 2)}\n`);

manifestEntries.push({
  assetId: `skeleton.${ID}`,
  imageId: `skeleton.${ID}`,
  category: 'character-skeleton',
  usage: ['player-skeleton'],
  sourceFile: `assets/skeletons/${ID}.json`,
  runtime2D: { path: `assets/skeletons/${ID}.json`, mode: 'skeleton' },
  runtime3D: { mode: 'billboard', sourceAssetId: `skeleton.${ID}` },
  pivot: { x: 0.5, y: 1 },
  bounds: { width: SIZE, height: doc.meta.height },
  animations: [],
  targetPhase: 'P1',
  status: 'ai-generated',
  revision: 1
});

const count = upsertManifest(manifestEntries);
console.log(`written: ${outFile} (bones=${doc.bones.length} slots=${doc.slots.length} clips=${doc.clips.length})`);
console.log(`images: ${PARTS.length * Object.keys(VIEWS).length} png under ${IMG_ROOT}/${ID}/parts/`);
console.log(`manifest upserted: ${count} entries`);
