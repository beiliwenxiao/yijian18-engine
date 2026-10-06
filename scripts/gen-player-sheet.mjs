// 程序化像素生成玩家角色资产（最小拆件方案）：
//   1. refugee-girl.png        完整版整身 4×8（保留兼容，manifest 已不引用）
//   2. refugee-girl-core.png   核心版整身 4×8（去手臂/裙：头+躯干+内裤+腿，body 槽位引用）
//   3. parts/arm-l.png         左臂（pivot 肩点 (32,6)）
//   4. parts/arm-r.png         右臂（暗色调，pivot 肩点 (32,6)）
//   5. parts/weapon-axe.png    砍柴斧（pivot 握点 (32,10)）
//   6. parts/skirt-front.png   裙前片（pivot 顶中 (32,6)）
//   7. parts/skirt-back.png    裙后片（更宽更暗）
// 用法：node scripts/gen-player-sheet.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const W = 64, H = 64, COLS = 4, ROWS = 8;

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

function encodePNG(buf, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    buf.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const pixels = Buffer.alloc(W * COLS * H * ROWS * 4);
let ox = 0, oy = 0;
// 部件绘制目标：null=共享整身画布；否则写入独立 64×64 缓冲
let target = null;

function put(x, y, [r, g, b, a = 255]) {
  const buf = target ? target.buf : pixels;
  const w = target ? target.w : W * COLS;
  const h = target ? target.h : H * ROWS;
  const px = Math.round(x + ox), py = Math.round(y + oy);
  if (px < 0 || py < 0 || px >= w || py >= h) return;
  const offset = (py * w + px) * 4;
  buf[offset] = r; buf[offset + 1] = g; buf[offset + 2] = b; buf[offset + 3] = a;
}

function rect(x, y, w, h, color) {
  for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) put(x + i, y + j, color);
}

function disc(cx, cy, radius, color) {
  for (let j = -radius; j <= radius; j += 1) {
    for (let i = -radius; i <= radius; i += 1) {
      if (i * i + j * j <= radius * radius) put(cx + i, cy + j, color);
    }
  }
}

/** 破烂布边：下摆锯齿（确定性伪随机，跨帧一致） */
function tatteredHem(x, y, width, color, seed) {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < width; i += 1) {
    put(x + i, y, color);
    if (rand() < 0.45) put(x + i, y + 1, color);
    if (rand() < 0.15) { put(x + i, y, [0, 0, 0, 0]); put(x + i, y - 1, color); }
  }
}

// 调色板：难民破烂风
const SKIN = [232, 176, 136];
const SKIN_DARK = [198, 142, 108];
const HAIR = [74, 48, 32];
const HAIR_DARK = [54, 34, 22];
const RAG_TOP = [122, 108, 88];
const RAG_TOP_DARK = [96, 84, 68];
const SKIRT = [154, 90, 58];
const SKIRT_DARK = [122, 70, 44];
const UNDERWEAR = [92, 86, 80];
const SHOE = [140, 116, 78];
const EYE = [40, 30, 26];

/**
 * 绘制单帧角色（整身）。
 * @param {'full'|'core'} mode full=完整版；core=去手臂/裙（拆件模式下由部件槽位补）
 */
function drawFrame(facing, walkPhase, dx = 0, mode = 'full') {
  ox += dx;
  const bob = walkPhase === 2 ? 1 : 0;
  const legSwing = walkPhase === 1 ? 1 : walkPhase === 3 ? -1 : 0;
  const groundY = 60 - bob;
  const cx = 32;

  // ---- 腿 ----
  if (facing === 'left' || facing === 'right') {
    const frontX = cx + (facing === 'right' ? 3 : -3) + legSwing * 4;
    const backX = cx - (facing === 'right' ? 2 : -2) - legSwing * 3;
    rect(backX - 1, groundY - 14, 3, 14, SKIN_DARK);
    rect(backX - 2, groundY - 2, 4, 2, SHOE);
    rect(frontX - 1, groundY - 14 + (legSwing !== 0 ? 1 : 0), 3, 14, SKIN);
    rect(frontX - 2, groundY - 2, 4, 2, SHOE);
  } else {
    rect(cx - 6, groundY - 14 + (legSwing === 1 ? -2 : 0), 3, 14, SKIN);
    rect(cx + 3, groundY - 14 + (legSwing === 3 ? -2 : 0), 3, 14, SKIN_DARK);
    rect(cx - 7, groundY - 2, 5, 2, SHOE);
    rect(cx + 2, groundY - 2, 5, 2, SHOE);
  }

  // ---- 下装：full=裙片；core=简陋内裤 ----
  const skirtTop = groundY - 24;
  if (mode === 'full') {
    rect(cx - 8, skirtTop, 16, 6, SKIRT);
    rect(cx - 9, skirtTop + 6, 18, 3, SKIRT);
    tatteredHem(cx - 9, skirtTop + 9, 18, SKIRT_DARK, 77 + (facing === 'up' ? 13 : 0));
    rect(cx - 4, skirtTop + 2, 3, 2, SKIRT_DARK);
    put(cx + 5, skirtTop + 5, SKIRT_DARK);
  } else {
    rect(cx - 7, skirtTop + 2, 14, 6, UNDERWEAR);
    put(cx - 2, skirtTop + 4, [70, 64, 60]);
  }

  // ---- 躯干（破烂短褂）----
  const torsoTop = groundY - 34;
  rect(cx - 7, torsoTop, 14, 8, RAG_TOP);
  tatteredHem(cx - 7, torsoTop + 8, 14, RAG_TOP_DARK, 31 + (facing === 'left' ? 7 : 0));
  rect(cx - 7, torsoTop, 3, 2, RAG_TOP_DARK);
  put(cx + 2, torsoTop + 4, [0, 0, 0, 0]);
  put(cx + 2, torsoTop + 3, RAG_TOP_DARK);
  if (facing !== 'up') {
    put(cx - 1, torsoTop, SKIN);
    put(cx, torsoTop, SKIN);
  }

  // ---- 手臂（仅 full；core 由部件槽位骨骼驱动）----
  if (mode === 'full') {
    const armSwing = -legSwing * 3;
    if (facing === 'left' || facing === 'right') {
      const nearX = cx + (facing === 'right' ? -4 : 4);
      rect(nearX - 1, torsoTop + 2, 3, 10, SKIN);
      rect(nearX - 1 + (facing === 'right' ? -1 : 1), torsoTop + 10, 3, 3, SKIN_DARK);
      const farX = cx + (facing === 'right' ? 5 : -5) + armSwing;
      rect(farX - 1, torsoTop + 2, 3, 9, SKIN_DARK);
    } else {
      rect(cx - 10, torsoTop + 2 + (legSwing === 1 ? 1 : 0), 3, 10, SKIN);
      rect(cx + 7, torsoTop + 2 + (legSwing === 3 ? 1 : 0), 3, 10, SKIN_DARK);
    }
  }

  // ---- 头 ----
  const headCy = torsoTop - 9;
  disc(cx, headCy, 9, SKIN);
  disc(cx, headCy - 3, 9, HAIR);
  for (let i = -9; i <= 9; i += 1) {
    const droop = Math.abs(i) % 3 === 0 ? 2 : 1;
    put(cx + i, headCy - 3 - 9 - (droop - 1), HAIR_DARK);
  }
  rect(cx - 9, headCy - 3, 3, 7, HAIR);
  rect(cx + 6, headCy - 3, 3, 7, HAIR);
  put(cx - 11, headCy + 1, HAIR_DARK);
  put(cx + 10, headCy - 1, HAIR_DARK);
  put(cx + 7, headCy - 8, [106, 128, 66]);

  if (facing === 'down') {
    rect(cx - 4, headCy + 1, 2, 3, EYE);
    rect(cx + 2, headCy + 1, 2, 3, EYE);
    put(cx - 1, headCy + 5, SKIN_DARK);
    put(cx - 2, headCy + 7, [176, 108, 96]);
    put(cx + 1, headCy + 7, [176, 108, 96]);
    put(cx + 4, headCy + 4, SKIN_DARK);
  } else if (facing === 'left' || facing === 'right') {
    const eyeX = facing === 'right' ? cx + 3 : cx - 5;
    rect(eyeX, headCy + 1, 2, 3, EYE);
    put(eyeX + (facing === 'right' ? 3 : -2), headCy + 5, SKIN_DARK);
    put(eyeX + (facing === 'right' ? 2 : -3), headCy + 7, [176, 108, 96]);
  }
  rect(cx - 6, headCy + 4, 12, 5, HAIR);
  put(cx - 3, headCy + 2, HAIR_DARK);

  put(cx - 8, groundY - 1, [0, 0, 0, 36]);
  put(cx + 7, groundY - 1, [0, 0, 0, 36]);
  ox -= dx;
}

// 8 行方向（SpriteComponent directionRowMap）：
// 0 down-left  1 up-right  2 up-left  3 down-right  4 left  5 right  6 up  7 down
const rowPlan = [
  { facing: 'down', dx: -3 },
  { facing: 'up', dx: 3 },
  { facing: 'up', dx: -3 },
  { facing: 'down', dx: 3 },
  { facing: 'left', dx: 0 },
  { facing: 'right', dx: 0 },
  { facing: 'up', dx: 0 },
  { facing: 'down', dx: 0 }
];

function drawSheet(mode) {
  pixels.fill(0);
  for (let row = 0; row < ROWS; row += 1) {
    const plan = rowPlan[row];
    for (let col = 0; col < COLS; col += 1) {
      ox = col * W;
      oy = row * H;
      drawFrame(plan.facing, col, plan.dx, mode);
    }
  }
  ox = 0; oy = 0;
  return encodePNG(pixels, W * COLS, H * ROWS);
}

/** 部件：以 pivot 为锚绘制到独立 64×64 单帧（image 附件整图绘制） */
function drawPart(drawFn) {
  const buf = Buffer.alloc(64 * 64 * 4);
  target = { buf, w: 64, h: 64 };
  ox = 0; oy = 0;
  drawFn();
  target = null;
  return encodePNG(buf, 64, 64);
}

mkdirSync('example/sanguo_zhangjiao/assets/images/player/parts', { recursive: true });
const OUT = 'example/sanguo_zhangjiao/assets/images/player';

// 1. 完整版整身（保留文件，历史兼容）
writeFileSync(`${OUT}/refugee-girl.png`, drawSheet('full'));
console.log('written: refugee-girl.png (full)');

// 2. 核心版整身（body 槽位引用：头+躯干+内裤+腿）
writeFileSync(`${OUT}/refugee-girl-core.png`, drawSheet('core'));
console.log('written: refugee-girl-core.png (core)');

// 3. 左臂：肩 pivot (32,6)，竖直下垂臂 + 破袖片
writeFileSync(`${OUT}/parts/arm-l.png`, drawPart(() => {
  rect(29, 6, 6, 9, RAG_TOP);                       // 破袖
  tatteredHem(29, 14, 6, RAG_TOP_DARK, 51);
  rect(30, 15, 4, 9, SKIN);                          // 上臂+前臂
  rect(30, 23, 4, 4, SKIN_DARK);                     // 手
  put(29, 8, RAG_TOP_DARK);
}));

// 4. 右臂（暗色调：远侧）
writeFileSync(`${OUT}/parts/arm-r.png`, drawPart(() => {
  rect(29, 6, 6, 9, RAG_TOP_DARK);
  tatteredHem(29, 14, 6, [78, 68, 56], 87);
  rect(30, 15, 4, 9, SKIN_DARK);
  rect(30, 23, 4, 4, [172, 124, 94]);
  put(34, 8, [78, 68, 56]);
}));

// 5. 砍柴斧：握点 pivot (32,10)，木柄下垂 + 石刃
writeFileSync(`${OUT}/parts/weapon-axe.png`, drawPart(() => {
  rect(30, 10, 4, 24, [122, 92, 58]);                // 木柄
  rect(30, 33, 4, 2, [96, 70, 44]);
  rect(26, 8, 12, 7, [150, 148, 142]);               // 石刃
  rect(26, 8, 12, 2, [186, 184, 176]);
  rect(27, 14, 10, 2, [116, 112, 106]);
  put(31, 10, [74, 56, 36]);                         // 绑绳
  put(33, 10, [74, 56, 36]);
}));

// 6. 裙前片：顶中 pivot (32,6)，A 形 + 中缝开衩
writeFileSync(`${OUT}/parts/skirt-front.png`, drawPart(() => {
  rect(22, 6, 20, 5, SKIRT);
  rect(21, 11, 22, 6, SKIRT);
  rect(24, 17, 16, 3, SKIRT_DARK);
  tatteredHem(21, 20, 22, SKIRT_DARK, 133);
  rect(31, 6, 2, 14, [110, 62, 40]);                 // 中缝开衩
  rect(26, 9, 3, 2, SKIRT_DARK);                     // 补丁
  put(36, 13, SKIRT_DARK);
}));

// 7. 裙后片：更宽更暗（腿后层）
writeFileSync(`${OUT}/parts/skirt-back.png`, drawPart(() => {
  rect(19, 6, 26, 6, SKIRT_DARK);
  rect(18, 12, 28, 7, [104, 60, 38]);
  tatteredHem(18, 19, 28, [88, 50, 32], 199);
  rect(24, 8, 4, 2, [88, 50, 32]);
}));

console.log('written: parts/arm-l.png, arm-r.png, weapon-axe.png, skirt-front.png, skirt-back.png');
