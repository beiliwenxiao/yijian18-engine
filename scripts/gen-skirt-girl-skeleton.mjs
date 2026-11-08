/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-08
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

// 程序化生成「短裙女」骨骼资产：25 张 64×64 部件 PNG（5 视角 × head/torso/skirt/arm/leg）
// + skirt-girl.json + manifest 自动登记（幂等）。纯 node（zlib 内置）。
//   node scripts/gen-skirt-girl-skeleton.mjs
//
// 方向形态约定（A 方案：一套骨骼 + 按形态换图，7 个方向只需 5 套美术）：
//   front → down（基准图）        side → side（朝右，左侧靠引擎 flipX 镜像）
//   up    → up（背面）             se   → SE（朝右，SW 由引擎镜像复用同一套）
//                                  ne   → NE（朝右后方，NW 由引擎镜像复用同一套）
// 因此 skeleton JSON 只配 down（基准）/side/up/SE/NE 五个形态，SW/NW 走镜像回退。
//
// 美术替换位置（保持文件名即可零改 JSON）：
//   example/sanguo_zhangjiao/assets/images/skirt-girl/parts/<part>-<view>.png
//   part ∈ head|torso|skirt|arm|leg，view ∈ front|side|up|se|ne
//   资产 ID 与文件名同构：skirt-girl.parts.head-front 等。
//   命名即编辑器「批量导入方向图」契约：主干 = 基准图 assetId 去方向后缀，-front 为基准。
//   画布语义：图片中心 = 骨骼挂点（渲染器以锚点居中绘制），
//     head 内容 y10~40（下巴≈40）/ torso 内容 y16~44（肩到腰）/ skirt 内容 y32~48（腰到膝上）/
//     arm 内容 y32~53（肩到手）/ leg 内容 y32~62（髋到鞋）。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, readFileSync, existsSync, unlinkSync } from 'node:fs';

const SIZE = 64;
const ID = 'skirt-girl';
const IMG_ROOT = 'example/sanguo_zhangjiao/assets/images';
const OUT_DIR = 'example/sanguo_zhangjiao/assets/skeletons';
const MANIFEST = 'example/sanguo_zhangjiao/assets/manifests/assets.json';

/* ---------------- PNG 编码（与 gen-refugee-skeletons.mjs 同款） ---------------- */

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

/* ---------------- 配色（短裙女：浅肤色 + 深棕长发 + 青上衣 + 玫红短裙） ---------------- */

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

/* ---------------- 部件绘制（中心 = 骨点） ---------------- */

/** 头部：内容 y10~40（下巴 y40），后发 y12~42。 */
function drawHead(pixels, view) {
  const cx = view.cx;
  const hairCy = 26 + (view.face === 'back' ? 1 : 0);
  // 后发（先画，脸盖在上面）
  fillEllipse(pixels, cx, hairCy, w(12, view), 13, PALETTE.hair, PALETTE.hairLine);
  if (view.face !== 'back') {
    // 脸
    const faceCx = cx + (view.face === 'side' ? 1 : 0);
    fillEllipse(pixels, faceCx, 29, w(9, view), 9, PALETTE.skin, PALETTE.skinLine);
    // 刘海
    fillEllipse(pixels, faceCx, 22, w(10, view), 5, PALETTE.hair, PALETTE.hairLine);
    fillRect(pixels, faceCx - w(9, view), 22, faceCx - w(6, view), 30, PALETTE.hair, PALETTE.hairLine);
    if (view.face === 'side') {
      // 侧脸：单眼 + 鼻尖
      put(pixels, cx + 5, 30, rgb(DARK)); put(pixels, cx + 5, 31, rgb(DARK));
      put(pixels, cx + 9, 32, rgb(PALETTE.skinLine));
      put(pixels, cx + 8, 33, rgb(PALETTE.skinLine));
      fillRect(pixels, cx + 3, 35, cx + 6, 35, PALETTE.mouth);
    } else {
      // 正/斜前：双眼 + 嘴 + 腮红
      const eyeDx = view.face === 'quarter' ? 2 : 4;
      put(pixels, faceCx - eyeDx, 30, rgb(DARK)); put(pixels, faceCx - eyeDx, 31, rgb(DARK));
      put(pixels, faceCx + eyeDx - 1, 30, rgb(DARK)); put(pixels, faceCx + eyeDx - 1, 31, rgb(DARK));
      fillRect(pixels, faceCx - 1, 35, faceCx + 1, 35, PALETTE.mouth);
      put(pixels, faceCx - 6, 33, rgb('#e8a98c')); put(pixels, faceCx + 6, 33, rgb('#e8a98c'));
    }
  } else {
    // 背面：发髻 + 发带
    fillRect(pixels, cx - 11, 30, cx + 11, 38, PALETTE.hair, PALETTE.hairLine);
    fillRect(pixels, cx - w(11, view), 24, cx + w(11, view), 25, PALETTE.ribbon);
  }
}

/** 躯干（上衣）：肩 y16 → 腰 y44。 */
function drawTorso(pixels, view) {
  const cx = view.cx;
  const shoulder = 16;
  const waist = 44;
  fillRows(pixels, shoulder, waist - 4, cx, progress => w(9 + progress * 3, view), PALETTE.cloth, PALETTE.clothLine);
  // 腰封
  fillRect(pixels, cx - w(11, view), waist - 4, cx + w(11, view), waist, PALETTE.skirt, PALETTE.skirtLine);
  if (view.face !== 'back') {
    // 领口 + 系带
    fillRect(pixels, cx - w(4, view), shoulder, cx + w(4, view), shoulder + 3, PALETTE.skin, PALETTE.skinLine);
    fillRect(pixels, cx - 2, waist - 10, cx + 2, waist - 1, PALETTE.ribbon);
  } else {
    // 背面：系带蝴蝶结
    fillRect(pixels, cx - 3, waist - 9, cx + 3, waist - 7, PALETTE.ribbon);
  }
  if (view.face === 'side') {
    // 侧视胸廓外轮廓
    fillEllipse(pixels, cx + 4, 26, 5, 5, PALETTE.cloth, PALETTE.clothLine);
  }
}

/** 短裙：腰 y32 → 裙摆 y48（膝上短裙；裙摆盖在腰封之上，故 z 高于上衣）。 */
function drawSkirt(pixels, view) {
  const cx = view.cx;
  fillRows(pixels, 32, 48, cx, progress => w(8 + progress * 5, view), PALETTE.skirt, PALETTE.skirtLine);
  // 褶线（弱对比，随裙摆略展开）
  for (let i = -2; i <= 2; i += 1) {
    const topX = cx + i * 3;
    const bottomX = cx + i * 4;
    fillRect(pixels, topX, 34, bottomX, 47, '#cb6470');
  }
  // 裙摆亮边（薄）
  fillRect(pixels, cx - w(13, view), 47, cx + w(13, view), 48, '#f0909a');
}

/** 手臂：肩 y32 → 手 y54；短袖 + 皮肤（腕不过腰，避免遮挡裙腰）。 */
function drawArm(pixels, view) {
  const cx = view.cx;
  const sleeveEnd = 40;
  fillRect(pixels, cx - w(4, view), 32, cx + w(4, view), sleeveEnd, PALETTE.cloth, PALETTE.clothLine);
  fillRect(pixels, cx - w(3, view), sleeveEnd + 1, cx + w(3, view), 52, PALETTE.skin, PALETTE.skinLine);
  fillEllipse(pixels, cx, 53, w(3, view), 3, PALETTE.skin, PALETTE.skinLine); // 手
}

/** 腿：髋 y32 → 脚 y62；裸腿 + 短靴。 */
function drawLeg(pixels, view) {
  const cx = view.cx;
  fillRect(pixels, cx - w(4, view), 32, cx + w(4, view), 56, PALETTE.skin, PALETTE.skinLine);
  fillRect(pixels, cx - w(4, view), 56, cx + w(5, view), 61, PALETTE.shoe, DARK);
  if (view.face !== 'back') put(pixels, cx + w(4, view) + 1, 61, rgb(DARK)); // 鞋尖
}

/* ---------------- 骨骼资产 ---------------- */

/** 视角 → 形态键（down 为基准图，不写入 directionOffsets）。 */
const VIEW_FORMS = [
  { view: 'side', form: 'side' },
  { view: 'back', form: 'up' },
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
 * 骨骼树（root=脚底中心，y 向下为正）：
 *   root └ hips(0,-30) ─ torso(0,0) ─ head(0,-22)
 *                       ├ skirt(0,2)
 *                       ├ armL(-9,-18)  ├ armR(9,-18)
 *          ├ legL(-5,2) └ legR(5,2)
 */
function buildDoc() {
  const bones = [
    { id: 'root', parent: null, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 10 },
    { id: 'hips', parent: 'root', x: 0, y: -30, rot: 0, scaleX: 1, scaleY: 1, length: 12 },
    { id: 'torso', parent: 'hips', x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 16 },
    { id: 'head', parent: 'torso', x: 0, y: -22, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'skirt', parent: 'hips', x: 0, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'armL', parent: 'torso', x: -9, y: -18, rot: 0, scaleX: 1, scaleY: 1, length: 16 },
    { id: 'armR', parent: 'torso', x: 9, y: -18, rot: 0, scaleX: 1, scaleY: 1, length: 16 },
    { id: 'legL', parent: 'hips', x: -5, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: 22 },
    { id: 'legR', parent: 'hips', x: 5, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: 22 }
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
  const stride = 17;
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
    // 正面走：左右腿交替抬落（正面视角以腿交替 + 起伏读步频）
    clip('walk_down', 640, true, [
      loopTrack('root', 640, [{ y: 0 }, { y: -2, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }, { y: -2, ease: 'easeInOut' }]),
      loopTrack('torso', 640, [{ rot: -1.5 }, { rot: 1.5, ease: 'easeInOut' }, { rot: -1.5, ease: 'easeInOut' }]),
      loopTrack('skirt', 640, [{ rot: -5 }, { rot: 5, ease: 'easeInOut' }, { rot: -5, ease: 'easeInOut' }]),
      loopTrack('legL', 640, [{ rot: -3 }, { rot: 6, ease: 'easeInOut' }, { rot: -3, ease: 'easeInOut' }, { rot: 6, ease: 'easeInOut' }]),
      loopTrack('legR', 640, [{ rot: 6 }, { rot: -3, ease: 'easeInOut' }, { rot: 6, ease: 'easeInOut' }, { rot: -3, ease: 'easeInOut' }]),
      loopTrack('armL', 640, [{ rot: 8 }, { rot: -8, ease: 'easeInOut' }, { rot: 8, ease: 'easeInOut' }]),
      loopTrack('armR', 640, [{ rot: -8 }, { rot: 8, ease: 'easeInOut' }, { rot: -8, ease: 'easeInOut' }])
    ]),
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
        { t: 0, rot: 0, y: -30 }, { t: 380, rot: 85, y: -10, ease: 'easeInOut' }, { t: 520, rot: 85, y: -10 }
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
    ])
  ];
  return {
    schemaVersion: 1,
    skeletonId: `skeleton.${ID}`,
    meta: { width: 64, height: 76 },
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
  // 清理历史命名残留：-back 已并入 -up（同一张图不能挂两个 ID）
  for (const assetId of [...byId.keys()]) {
    if (assetId.startsWith(`${ID}.parts.`) && assetId.endsWith('-back')) byId.delete(assetId);
  }
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

// 清理历史命名残留文件（-back 已并入 -up）
for (const { part } of PARTS) {
  const stale = `${IMG_ROOT}/${ID}/parts/${part}-back.png`;
  if (existsSync(stale)) unlinkSync(stale);
}

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
const outFile = `${OUT_DIR}/${ID}.json`;
writeFileSync(outFile, `${JSON.stringify(doc, null, 2)}\n`);

manifestEntries.push({
  assetId: `skeleton.${ID}`,
  imageId: `skeleton.${ID}`,
  category: 'character-skeleton',
  usage: ['npc'],
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
