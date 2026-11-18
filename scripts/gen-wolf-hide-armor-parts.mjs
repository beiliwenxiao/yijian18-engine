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

// 程序化生成「狼皮护具」装备部件图：4 张 64×64 PNG（vest 胸甲 / skirt 皮裙 / boots 靴 / bracers 护腕）
// + manifest 自动登记（幂等）。纯 node（zlib 内置）。
//   node scripts/gen-wolf-hide-armor-parts.mjs
//
// 画布约定（与角色部件一致）：64×64，图片中心 (32,32) = 骨骼挂点，渲染器以挂点居中绘制：
//   vest    内容 y14~48（覆盖躯干区，肩带宽横贯）
//   skirt   内容 y28~52（腰 y28 → 裙摆 y52，挂点=腰）
//   boots   内容 y46~62（靴筒 y46 → 鞋底 y62，挂点=脚踝）
//   bracers 内容 y26~40（环状护腕横贯前臂中段，挂点=前臂中心；左右腕共用同一张图）
// P1 先出 down 基准图（斜向自动回退基准）；5 方向美术后续按批量导入流程补。
import { deflateSync } from 'node:zlib';
import { writeFileSync, readFileSync } from 'node:fs';

const SIZE = 64;
const OUT_DIR = 'example/sanguo_zhangjiao/assets/images/player/parts';
const MANIFEST = 'example/sanguo_zhangjiao/assets/manifests/assets.json';

/* ---------------- PNG 编码（与 gen-skirt-girl-chibi-skeleton.mjs 同款） ---------------- */

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

/** 确定性伪随机（皮毛斑点纹理位置），种子固定 → 重复生成结果一致。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 狼皮配色（灰狼毛 + 深色斑点 + 皮绳） ---------------- */

const PALETTE = {
  hide: '#8a7f6e', hideDark: '#6b6154', hideLight: '#a39885',
  spot: '#4a4238', spotLight: '#5c5348',
  line: '#2e2820',
  strap: '#5a4632', strapLine: '#3a2e20',
  fur: '#b7ad9c',
  claw: '#d9d2c4'
};

/** 在矩形区域内撒毛皮斑点（确定性）。 */
function sprinkleSpots(pixels, x0, y0, x1, y1, count, seed, colors) {
  const rand = mulberry32(seed);
  for (let i = 0; i < count; i += 1) {
    const x = x0 + Math.floor(rand() * (x1 - x0 + 1));
    const y = y0 + Math.floor(rand() * (y1 - y0 + 1));
    const color = colors[Math.floor(rand() * colors.length)];
    put(pixels, x, y, rgb(color));
    if (rand() > 0.6) put(pixels, x + 1, y, rgb(color));
  }
}

/** 毛边（部件顶/底缘的锯齿状毛须）。 */
function furEdge(pixels, y, x0, x1, color) {
  const rand = mulberry32(y * 1000 + x0);
  for (let x = x0; x <= x1; x += 1) {
    if (rand() > 0.45) put(pixels, x, y, rgb(color));
    if (rand() > 0.75) put(pixels, x, y + (rand() > 0.5 ? 1 : -1), rgb(color));
  }
}

/* ---------------- 三件部件绘制 ---------------- */

/** 狼皮背心（胸甲）：肩带横贯 + 躯干皮块 + 毛边。 */
function drawVest(pixels) {
  // 肩带（两条竖带从肩到胸）
  fillRect(pixels, 22, 14, 26, 34, PALETTE.strap, PALETTE.strapLine);
  fillRect(pixels, 37, 14, 41, 34, PALETTE.strap, PALETTE.strapLine);
  // 躯干皮块（胸口到腰）
  fillRect(pixels, 18, 24, 45, 46, PALETTE.hide, PALETTE.line);
  fillRect(pixels, 18, 24, 45, 28, PALETTE.hideLight);
  fillRect(pixels, 18, 42, 45, 46, PALETTE.hideDark);
  // 中缝系带
  fillRect(pixels, 31, 26, 32, 44, PALETTE.strap);
  for (let y = 28; y <= 42; y += 4) fillRect(pixels, 28, y, 35, y + 1, PALETTE.strapLine);
  // 毛边（领口与下摆）
  furEdge(pixels, 23, 18, 45, PALETTE.fur);
  furEdge(pixels, 47, 18, 45, PALETTE.fur);
  sprinkleSpots(pixels, 19, 29, 44, 41, 26, 7, [PALETTE.spot, PALETTE.spotLight, PALETTE.hideDark]);
}

/** 狼皮短裙：腰带 + 梯形裙摆 + 毛边下摆。 */
function drawSkirt(pixels) {
  // 腰带
  fillRect(pixels, 20, 28, 43, 33, PALETTE.strap, PALETTE.strapLine);
  // 扣环
  fillRect(pixels, 30, 29, 33, 32, PALETTE.claw);
  // 裙摆（逐行外扩的梯形）
  for (let y = 34; y <= 50; y += 1) {
    const progress = (y - 34) / 16;
    const half = Math.round(10 + progress * 4);
    fillRect(pixels, 32 - half, y, 32 + half, y, PALETTE.hide);
    if (y === 34 || y === 35) fillRect(pixels, 32 - half, y, 32 + half, y, PALETTE.hideLight);
  }
  // 裙摆描边（左右斜线）
  for (let y = 34; y <= 50; y += 1) {
    const progress = (y - 34) / 16;
    const half = Math.round(10 + progress * 4);
    put(pixels, 32 - half - 1, y, rgb(PALETTE.line));
    put(pixels, 32 + half + 1, y, rgb(PALETTE.line));
  }
  // 下摆毛边
  furEdge(pixels, 51, 20, 44, PALETTE.fur);
  sprinkleSpots(pixels, 24, 36, 40, 49, 22, 21, [PALETTE.spot, PALETTE.spotLight]);
}

/** 狼皮靴（单只，左右脚共用同图）：靴筒 + 鞋头 + 白爪纹。 */
function drawBoots(pixels) {
  // 靴筒
  fillRect(pixels, 26, 46, 37, 54, PALETTE.hide, PALETTE.line);
  fillRect(pixels, 26, 46, 37, 49, PALETTE.hideLight);
  // 翻毛靴口
  furEdge(pixels, 45, 25, 38, PALETTE.fur);
  // 鞋头（脚尖朝右）
  fillRect(pixels, 24, 54, 40, 61, PALETTE.hideDark, PALETTE.line);
  fillRect(pixels, 37, 55, 40, 60, PALETTE.hide);
  // 爪纹
  for (let x = 33; x <= 39; x += 2) fillRect(pixels, x, 56, x, 59, PALETTE.claw);
  // 鞋底
  fillRect(pixels, 24, 61, 40, 62, PALETTE.line);
  sprinkleSpots(pixels, 27, 50, 36, 53, 10, 33, [PALETTE.spot, PALETTE.spotLight]);
}

/** 狼皮护腕（环状，左右腕共用同图）：横贯前臂的皮环 + 上下毛边 + 系带扣。 */
function drawBracers(pixels) {
  // 皮环主体（横条带）
  fillRect(pixels, 22, 26, 41, 39, PALETTE.hide, PALETTE.line);
  fillRect(pixels, 22, 26, 41, 29, PALETTE.hideLight);
  fillRect(pixels, 22, 36, 41, 39, PALETTE.hideDark);
  // 系带（竖带 + 扣结）
  fillRect(pixels, 30, 26, 33, 39, PALETTE.strap);
  fillRect(pixels, 29, 31, 34, 34, PALETTE.strapLine);
  fillRect(pixels, 30, 32, 33, 33, PALETTE.claw);
  // 上下毛边（毛口）
  furEdge(pixels, 25, 22, 41, PALETTE.fur);
  furEdge(pixels, 40, 22, 41, PALETTE.fur);
  sprinkleSpots(pixels, 23, 30, 40, 35, 14, 55, [PALETTE.spot, PALETTE.spotLight]);
}

/* ---------------- 写盘 + manifest 登记（幂等） ---------------- */

const PARTS = [
  { file: 'wolf-hide-vest.png', draw: drawVest },
  { file: 'wolf-hide-skirt.png', draw: drawSkirt },
  { file: 'wolf-hide-boots.png', draw: drawBoots },
  { file: 'wolf-hide-bracers.png', draw: drawBracers }
];

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (!Array.isArray(manifest.assets)) throw new Error('manifest.assets 缺失');
const byId = new Map(manifest.assets.map(asset => [asset.assetId, asset]));

for (const { file, draw } of PARTS) {
  const pixels = newPixels();
  draw(pixels);
  const relative = `assets/images/player/parts/${file}`;
  writeFileSync(`${OUT_DIR}/${file}`, encodePNG(pixels));
  const assetId = `player.parts.${file.replace('.png', '')}`;
  byId.set(assetId, {
    assetId,
    imageId: assetId,
    category: 'character-part',
    usage: ['equipment-part'],
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

manifest.assets = [...byId.values()];
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`written: ${PARTS.length} parts under ${OUT_DIR}/, manifest upserted`);
