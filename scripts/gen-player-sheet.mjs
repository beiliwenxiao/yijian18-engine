// 程序化像素生成玩家角色表：衣着破烂、穿短裙的女子（柔弱女子·难民形象）。
// 布局 256×512 = 4 列×8 行，每帧 64×64，脚底锚点 (32, 60)，与 player.animated
// manifest 网格（4×8）和 PlayerSkeletonStateMapper 方向行（down:7/up:6/left:4/right:5）对齐。
// 用法：node scripts/gen-player-sheet.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

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

function encodePNG(pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W * COLS, 0);
  ihdr.writeUInt32BE(H * ROWS, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(H * ROWS * (W * COLS * 4 + 1));
  for (let y = 0; y < H * ROWS; y += 1) {
    raw[y * (W * COLS * 4 + 1)] = 0;
    pixels.copy(raw, y * (W * COLS * 4 + 1) + 1, y * W * COLS * 4, (y + 1) * W * COLS * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const pixels = Buffer.alloc(W * COLS * H * ROWS * 4);
let ox = 0, oy = 0; // 当前帧原点

function put(x, y, [r, g, b, a = 255]) {
  const px = Math.round(x + ox), py = Math.round(y + oy);
  if (px < 0 || py < 0 || px >= W * COLS || py >= H * ROWS) return;
  const offset = (py * W * COLS + px) * 4;
  pixels[offset] = r; pixels[offset + 1] = g; pixels[offset + 2] = b; pixels[offset + 3] = a;
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

/** 破烂布边：下摆锯齿（随机缺口由确定性伪随机驱动，跨帧一致） */
function tatteredHem(x, y, width, color, seed) {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < width; i += 1) {
    put(x + i, y, color);
    if (rand() < 0.45) put(x + i, y + 1, color);   // 垂下的布丝
    if (rand() < 0.15) { put(x + i, y, [0, 0, 0, 0]); put(x + i, y - 1, color); } // 破洞缺口
  }
}

// 调色板：难民破烂风
const SKIN = [232, 176, 136];
const SKIN_DARK = [198, 142, 108];
const HAIR = [74, 48, 32];
const HAIR_DARK = [54, 34, 22];
const RAG_TOP = [122, 108, 88];      // 破烂短褂（灰褐）
const RAG_TOP_DARK = [96, 84, 68];
const SKIRT = [154, 90, 58];         // 赭红短裙
const SKIRT_DARK = [122, 70, 44];
const SHOE = [140, 116, 78];         // 草鞋
const EYE = [40, 30, 26];
const OUTLINE = [44, 34, 30];

/**
 * 绘制单帧角色。
 * @param {string} facing 'down'|'up'|'left'|'right'
 * @param {number} walkPhase 0..3 行走相位（0/2 站立过渡）
 * @param {number} dx 水平微偏（斜向区分）
 */
function drawFrame(facing, walkPhase, dx = 0) {
  ox += dx; // 帧偏移由外层（col*W, row*H）设定，这里只加方向微偏
  const bob = walkPhase === 2 ? 1 : 0;               // 换重心下沉
  const legSwing = walkPhase === 1 ? 1 : walkPhase === 3 ? -1 : 0; // 1 左前 3 右前
  const groundY = 60 - bob;
  const cx = 32;

  // ---- 腿（先画，被裙摆压住）----
  const legLift = phase => (phase === 1 ? -2 : phase === 3 ? 2 : 0); // 抬腿侧脚跟离地
  if (facing === 'left' || facing === 'right') {
    // 侧面：前后腿
    const frontX = cx + (facing === 'right' ? 3 : -3) + legSwing * 4;
    const backX = cx - (facing === 'right' ? 2 : -2) - legSwing * 3;
    rect(backX - 1, groundY - 14, 3, 14, SKIN_DARK);
    rect(backX - 2, groundY - 2, 4, 2, SHOE);
    rect(frontX - 1, groundY - 14 + (legSwing !== 0 ? 1 : 0), 3, 14, SKIN);
    rect(frontX - 2, groundY - 2, 4, 2, SHOE);
  } else {
    // 正/背/斜向：左右腿，行走时交替提脚
    const liftL = legLift(legSwing >= 0 ? 1 : 0);
    const liftR = legLift(legSwing <= 0 ? 3 : 0);
    rect(cx - 6, groundY - 14 + (legSwing === 1 ? liftL : 0), 3, 14, SKIN);
    rect(cx + 3, groundY - 14 + (legSwing === 3 ? liftR : 0), 3, 14, SKIN_DARK);
    rect(cx - 7, groundY - 2, 5, 2, SHOE);
    rect(cx + 2, groundY - 2, 5, 2, SHOE);
  }

  // ---- 短裙（A 形，破烂下摆）----
  const skirtTop = groundY - 24;
  rect(cx - 8, skirtTop, 16, 6, SKIRT);
  rect(cx - 9, skirtTop + 6, 18, 3, SKIRT);
  tatteredHem(cx - 9, skirtTop + 9, 18, SKIRT_DARK, 77 + (facing === 'up' ? 13 : 0));
  // 裙面补丁与撕裂纹
  rect(cx - 4, skirtTop + 2, 3, 2, SKIRT_DARK);
  put(cx + 5, skirtTop + 5, SKIRT_DARK);

  // ---- 躯干（破烂短褂，露腰）----
  const torsoTop = groundY - 34;
  rect(cx - 7, torsoTop, 14, 8, RAG_TOP);
  tatteredHem(cx - 7, torsoTop + 8, 14, RAG_TOP_DARK, 31 + (facing === 'left' ? 7 : 0));
  // 肩部布条 + 破洞
  rect(cx - 7, torsoTop, 3, 2, RAG_TOP_DARK);
  put(cx + 2, torsoTop + 4, [0, 0, 0, 0]);
  put(cx + 2, torsoTop + 3, RAG_TOP_DARK);
  if (facing !== 'up') {
    // 锁骨/领口
    put(cx - 1, torsoTop, SKIN);
    put(cx, torsoTop, SKIN);
  }

  // ---- 手臂（摆动与腿相位相反）----
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

  // ---- 头 ----
  const headCy = torsoTop - 9;
  disc(cx, headCy, 9, SKIN);
  // 乱发：蓬乱轮廓（锯齿边缘）+ 发髻散落
  disc(cx, headCy - 3, 9, HAIR);
  for (let i = -9; i <= 9; i += 1) {
    const droop = Math.abs(i) % 3 === 0 ? 2 : 1;
    put(cx + i, headCy - 3 - 9 - (droop - 1), HAIR_DARK); // 翘起的乱发
  }
  rect(cx - 9, headCy - 3, 3, 7, HAIR);            // 侧发
  rect(cx + 6, headCy - 3, 3, 7, HAIR);
  put(cx - 11, headCy + 1, HAIR_DARK);             // 散落发丝
  put(cx + 10, headCy - 1, HAIR_DARK);
  // 发簪草枝（难民感）
  put(cx + 7, headCy - 8, [106, 128, 66]);

  if (facing === 'down') {
    rect(cx - 4, headCy + 1, 2, 3, EYE);
    rect(cx + 2, headCy + 1, 2, 3, EYE);
    put(cx - 1, headCy + 5, SKIN_DARK);            // 鼻
    put(cx - 2, headCy + 7, [176, 108, 96]);       // 嘴（憔悴）
    put(cx + 1, headCy + 7, [176, 108, 96]);
    // 脸颊污渍
    put(cx + 4, headCy + 4, SKIN_DARK);
  } else if (facing === 'left' || facing === 'right') {
    const eyeX = facing === 'right' ? cx + 3 : cx - 5;
    rect(eyeX, headCy + 1, 2, 3, EYE);
    put(eyeX + (facing === 'right' ? 3 : -2), headCy + 5, SKIN_DARK);
    put(eyeX + (facing === 'right' ? 2 : -3), headCy + 7, [176, 108, 96]);
  }
  // up：全后脑勺（无脸）
  rect(cx - 6, headCy + 4, 12, 5, HAIR);           // 后脑发际
  put(cx - 3, headCy + 2, HAIR_DARK);

  // ---- 轮廓描边（可选暗色点：头部下缘与裙摆阴影）----
  put(cx - 8, groundY - 1, [0, 0, 0, 36]);
  put(cx + 7, groundY - 1, [0, 0, 0, 36]);
  ox -= dx;
}

// 8 行方向（与 SpriteComponent directionRowMap 一致）：
// 0 down-left  1 up-right  2 up-left  3 down-right  4 left  5 right  6 up  7 down
// 斜向用正面/背面变体 + 水平微偏移区分（P1 简化）
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

for (let row = 0; row < ROWS; row += 1) {
  const plan = rowPlan[row];
  for (let col = 0; col < COLS; col += 1) {
    ox = col * W;
    oy = row * H;
    drawFrame(plan.facing, col, plan.dx);
  }
}

const out = 'example/sanguo_zhangjiao/assets/images/player/refugee-girl.png';
writeFileSync(out, encodePNG(pixels));
console.log(`written: ${out} (${W * COLS}x${H * ROWS})`);
