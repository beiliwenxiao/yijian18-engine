// 程序化像素生成玩家角色资产（三国黄巾女兵 · 完整全身骨骼方案）：
// 整身（历史兼容）：refugee-girl.png (full) / refugee-girl-core.png
// 全身部件（image 附件挂独立骨骼，Spine 式 rig）：
//   parts/head-front.png   正面头（脸+眼嘴+黄巾+丸子头髻）pivot 底中 (32,24)
//   parts/head-side.png    侧面头（单眼+鼻）        pivot 底中 (32,24)
//   parts/head-back.png    背面头（后脑全发+巾结）  pivot 底中 (32,24)
//   parts/torso.png        躯干（短打+腰带+黄符+腰包）pivot 底中 (32,30)
//   parts/upper-arm-l.png  左上臂（袖+裸臂）        pivot 顶中 (32,4)
//   parts/upper-arm-r.png  右上臂（暗色）           pivot 顶中 (32,4)
//   parts/fore-arm-l.png   左前臂+手（绑带护腕）    pivot 顶中 (32,4)
//   parts/fore-arm-r.png   右前臂+手（暗色）        pivot 顶中 (32,4)
//   parts/thigh-l.png      左大腿                   pivot 顶中 (32,4)
//   parts/thigh-r.png      右大腿（暗色）           pivot 顶中 (32,4)
//   parts/calf-l.png       左小腿+靴（绑腿）        pivot 顶中 (32,4)
//   parts/calf-r.png       右小腿+靴（暗色）        pivot 顶中 (32,4)
//   parts/skirt-front.png  裙前片（沿用）           pivot 顶中 (32,6)
//   parts/skirt-back.png   裙后片（沿用）           pivot 顶中 (32,6)
//   parts/weapon-axe.png   砍柴斧（沿用）           pivot 握点 (32,10)
//   parts/weapon-spear.png 背背长矛（沿用）         pivot 中心 (32,32)
// 部件世界坐标公式：世界 = 骨骼 + (图内 - pivot)。详见 gen-player-skeleton.mjs 骨骼树注释。
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

/** 交叉绑带纹（护腕/绑腿质感） */
function wrapCross(x, y, w, h, dark) {
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      if ((i + j) % 3 === 0) put(x + i, y + j, dark);
    }
  }
}

// 调色板：三国黄巾女兵
const SKIN = [232, 178, 132];
const SKIN_DARK = [196, 144, 106];
const HAIR = [52, 38, 26];
const HAIR_DARK = [36, 26, 18];
const BAND = [222, 180, 64];
const BAND_DARK = [182, 142, 44];
const TOP = [74, 78, 90];
const TOP_DARK = [56, 60, 70];
const SASH = [162, 74, 52];
const SASH_DARK = [124, 54, 40];
const SKIRT = [196, 166, 84];
const SKIRT_DARK = [158, 130, 60];
const SKIRT_BACK = [148, 122, 56];
const UNDERWEAR = [92, 86, 80];
const WRAP = [138, 106, 72];
const WRAP_DARK = [106, 80, 54];
const BOOT = [92, 66, 44];
const BOOT_DARK = [68, 48, 32];
const CHARM = [232, 214, 140];
const POUCH = [110, 80, 52];
const SPEAR_WOOD = [112, 84, 50];
const SPEAR_TIP = [178, 176, 170];
const SPEAR_TIP_LIGHT = [210, 208, 200];
const TASSEL = [190, 58, 48];
const EYE = [40, 30, 26];
const MOUTH = [176, 108, 96];

/** 部件：以 pivot 为锚绘制到独立 64×64 单帧（image 附件整图绘制） */
function drawPart(drawFn) {
  const buf = Buffer.alloc(64 * 64 * 4);
  target = { buf, w: 64, h: 64 };
  ox = 0; oy = 0;
  drawFn();
  target = null;
  return encodePNG(buf, 64, 64);
}

// ---------- 整身帧（历史兼容：refugee-girl.png / refugee-girl-core.png） ----------
function drawFrame(facing, walkPhase, dx = 0, mode = 'full') {
  ox += dx;
  const bob = walkPhase === 2 ? 1 : 0;
  const legSwing = walkPhase === 1 ? 1 : walkPhase === 3 ? -1 : 0;
  const groundY = 60 - bob;
  const cx = 32;
  const drawLeg = (x, dark) => {
    const thigh = dark ? SKIN_DARK : SKIN;
    const wrapBase = dark ? WRAP_DARK : WRAP;
    rect(x - 1, groundY - 14, 3, 6, thigh);
    rect(x - 1, groundY - 8, 3, 5, wrapBase);
    wrapCross(x - 1, groundY - 8, 3, 5, dark ? [86, 64, 44] : WRAP_DARK);
    rect(x - 2, groundY - 3, 4, 2, dark ? BOOT_DARK : BOOT);
    rect(x - 2, groundY - 1, 4, 1, dark ? BOOT_DARK : BOOT);
  };
  if (facing === 'left' || facing === 'right') {
    const frontX = cx + (facing === 'right' ? 3 : -3) + legSwing * 4;
    const backX = cx - (facing === 'right' ? 2 : -2) - legSwing * 3;
    drawLeg(backX, true);
    drawLeg(frontX, false);
  } else {
    drawLeg(cx - 5, false);
    drawLeg(cx + 5, true);
  }
  const skirtTop = groundY - 24;
  if (mode === 'core') {
    rect(cx - 7, skirtTop + 2, 14, 7, UNDERWEAR);
    put(cx - 2, skirtTop + 4, [70, 64, 60]);
  }
  const torsoTop = groundY - 34;
  rect(cx - 7, torsoTop, 14, 8, TOP);
  tatteredHem(cx - 7, torsoTop + 8, 14, TOP_DARK, 31 + (facing === 'left' ? 7 : 0));
  rect(cx - 9, torsoTop, 3, 4, TOP);
  rect(cx + 6, torsoTop, 3, 4, TOP);
  rect(cx - 8, torsoTop + 7, 16, 3, SASH);
  rect(cx - 1, torsoTop + 7, 2, 3, SASH_DARK);
  rect(cx + 3, torsoTop + 10, 2, 3, CHARM);
  rect(cx + 3, torsoTop + 9, 2, 1, SASH_DARK);
  rect(cx - 6, torsoTop + 10, 3, 2, POUCH);
  if (facing !== 'up') {
    put(cx - 1, torsoTop, SKIN); put(cx, torsoTop, SKIN); put(cx + 1, torsoTop, SKIN);
    for (let i = 0; i < 3; i += 1) {
      put(cx - 1 - i, torsoTop + 1 + i, TOP_DARK);
      put(cx + 1 + i, torsoTop + 1 + i, TOP_DARK);
    }
    put(cx, torsoTop + 4, TOP_DARK);
  } else {
    put(cx - 2, torsoTop + 2, TOP_DARK); put(cx - 3, torsoTop + 3, TOP_DARK);
    put(cx + 2, torsoTop + 2, TOP_DARK); put(cx + 3, torsoTop + 3, TOP_DARK);
    rect(cx - 1, torsoTop + 10, 2, 3, SASH_DARK);
  }
  if (mode === 'full') {
    const armSwing = -legSwing * 3;
    const drawArm = (x, dark) => {
      const skin = dark ? SKIN_DARK : SKIN;
      const wrapBase = dark ? WRAP_DARK : WRAP;
      rect(x - 1, torsoTop + 1, 3, 3, dark ? TOP_DARK : TOP);
      rect(x - 1, torsoTop + 4, 3, 4, skin);
      rect(x - 1, torsoTop + 8, 3, 4, wrapBase);
      wrapCross(x - 1, torsoTop + 8, 3, 4, dark ? [86, 64, 44] : WRAP_DARK);
      rect(x - 1, torsoTop + 12, 3, 2, dark ? SKIN_DARK : skin);
    };
    if (facing === 'left' || facing === 'right') {
      drawArm(cx + (facing === 'right' ? -4 : 4) + armSwing, false);
      drawArm(cx + (facing === 'right' ? 5 : -5), true);
    } else {
      drawArm(cx - 9, false);
      drawArm(cx + 9, true);
    }
  }
  const headCy = torsoTop - 9;
  disc(cx, headCy - 1, 8, HAIR);
  disc(cx, headCy + 2, 6, SKIN);
  rect(cx - 6, headCy - 3, 12, 1, HAIR);
  rect(cx - 8, headCy - 1, 2, 6, HAIR);
  rect(cx + 6, headCy - 1, 2, 6, HAIR);
  rect(cx - 8, headCy - 6, 16, 3, BAND);
  rect(cx + 8, headCy - 3, 1, 4, BAND_DARK);
  put(cx + 8, headCy + 1, BAND);
  disc(cx, headCy - 11, 3, HAIR);
  rect(cx - 2, headCy - 10, 4, 3, HAIR);
  put(cx - 1, headCy - 13, HAIR_DARK); put(cx + 1, headCy - 12, HAIR_DARK);
  if (facing === 'down') {
    rect(cx - 3, headCy + 1, 2, 2, EYE);
    rect(cx + 1, headCy + 1, 2, 2, EYE);
    rect(cx - 2, headCy + 6, 4, 1, MOUTH);
  } else if (facing === 'left' || facing === 'right') {
    const eyeX = facing === 'right' ? cx + 1 : cx - 3;
    rect(eyeX, headCy + 1, 2, 2, EYE);
    put(eyeX + (facing === 'right' ? 3 : -2), headCy + 4, SKIN_DARK);
    rect(eyeX + (facing === 'right' ? 1 : -1), headCy + 6, 2, 1, MOUTH);
  } else {
    disc(cx, headCy, 7, HAIR);
    rect(cx - 7, headCy - 6, 14, 3, BAND);
    rect(cx - 2, headCy - 3, 4, 3, BAND_DARK);
    put(cx - 5, headCy - 3, BAND); put(cx + 4, headCy - 3, BAND);
  }
  put(cx - 8, groundY - 1, [0, 0, 0, 36]);
  put(cx + 7, groundY - 1, [0, 0, 0, 36]);
  ox -= dx;
}

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

mkdirSync('example/sanguo_zhangjiao/assets/images/player/parts', { recursive: true });
const OUT = 'example/sanguo_zhangjiao/assets/images/player';

// ---------- 整身（历史兼容） ----------
writeFileSync(`${OUT}/refugee-girl.png`, drawSheet('full'));
console.log('written: refugee-girl.png (full)');
writeFileSync(`${OUT}/refugee-girl-core.png`, drawSheet('core'));
console.log('written: refugee-girl-core.png (core)');

// ---------- 全身部件 ----------
// 头部（16px 颅 + 3px 髻；pivot 底中 (32,24)：颈部钉点）
// 正面：脸+双眼+嘴+黄巾+髻
writeFileSync(`${OUT}/parts/head-front.png`, drawPart(() => {
  disc(32, 6, 3, HAIR);                            // 丸子头髻
  rect(30, 7, 4, 2, HAIR);
  put(31, 4, HAIR_DARK); put(33, 5, HAIR_DARK);
  disc(32, 16, 8, HAIR);                           // 颅发盘（y8..24）
  disc(32, 19, 6, SKIN);                           // 脸盘（y13..25）
  rect(26, 12, 12, 1, HAIR);                       // 刘海
  rect(24, 15, 2, 6, HAIR);                        // 鬓发
  rect(38, 15, 2, 6, HAIR);
  rect(24, 10, 16, 3, BAND);                       // 黄头巾
  rect(40, 13, 1, 4, BAND_DARK);                   // 巾角垂带
  put(40, 17, BAND);
  rect(29, 20, 2, 2, EYE);                         // 双眼
  rect(33, 20, 2, 2, EYE);
  rect(30, 24, 4, 1, MOUTH);                       // 嘴
  put(35, 22, SKIN_DARK);                          // 腮影
}));

// 侧面：单眼+鼻（朝右；左向由 flipX 镜像）
writeFileSync(`${OUT}/parts/head-side.png`, drawPart(() => {
  disc(31, 6, 3, HAIR);
  rect(29, 7, 4, 2, HAIR);
  put(30, 4, HAIR_DARK);
  disc(31, 16, 8, HAIR);
  disc(33, 19, 6, SKIN);                           // 脸偏前
  rect(25, 12, 12, 1, HAIR);
  rect(23, 15, 3, 7, HAIR);                        // 脑后发
  rect(23, 10, 17, 3, BAND);                       // 头巾（侧视稍宽）
  rect(40, 13, 1, 3, BAND_DARK);
  rect(35, 20, 2, 2, EYE);                         // 单眼
  put(40, 22, SKIN_DARK);                          // 鼻尖
  rect(36, 24, 3, 1, MOUTH);
  put(37, 21, SKIN_DARK);                          // 眼窝影
}));

// 背面：后脑全发+巾带后沿+带结
writeFileSync(`${OUT}/parts/head-back.png`, drawPart(() => {
  disc(32, 6, 3, HAIR);
  rect(30, 7, 4, 2, HAIR);
  disc(32, 16, 8, HAIR);
  put(28, 14, HAIR_DARK); put(35, 17, HAIR_DARK); put(30, 20, HAIR_DARK);   // 发纹
  rect(24, 10, 16, 3, BAND);                       // 巾带后沿
  rect(30, 13, 4, 3, BAND_DARK);                   // 带结
  rect(29, 16, 1, 6, BAND);                        // 垂带
  rect(34, 16, 1, 6, BAND_DARK);
}));

// 躯干（20px，世界 -48..-28；pivot 底中 (32,30)=髋部钉点）
writeFileSync(`${OUT}/parts/torso.png`, drawPart(() => {
  rect(24, 10, 15, 18, TOP);                       // 短打主体（y10..28）
  tatteredHem(24, 26, 15, TOP_DARK, 31);
  rect(22, 10, 3, 5, TOP);                         // 短袖肩（盖臂根）
  rect(39, 10, 3, 5, TOP);
  put(30, 11, TOP_DARK); put(31, 12, TOP_DARK); put(32, 13, TOP_DARK);   // V 领交线
  put(34, 11, TOP_DARK); put(33, 12, TOP_DARK);
  put(32, 14, TOP_DARK);
  rect(23, 28, 17, 3, SASH);                       // 锈红腰带（y28..30）
  rect(31, 28, 2, 3, SASH_DARK);                   // 带结
  rect(35, 30, 2, 3, CHARM);                       // 黄纸符（腰带下垂）
  put(35, 27, SASH_DARK);                          // 符挂绳
  rect(26, 30, 3, 3, POUCH);                       // 腰包
}));

// 上臂（12px，世界 -44..-32；pivot 顶中 (32,4)=肩点）
writeFileSync(`${OUT}/parts/upper-arm-l.png`, drawPart(() => {
  rect(29, 4, 6, 4, TOP);                          // 肩袖
  rect(29, 8, 6, 1, TOP_DARK);
  rect(30, 9, 4, 7, SKIN);                         // 裸臂
}));
writeFileSync(`${OUT}/parts/upper-arm-r.png`, drawPart(() => {
  rect(29, 4, 6, 4, TOP_DARK);
  rect(29, 8, 6, 1, [44, 48, 56]);
  rect(30, 9, 4, 7, SKIN_DARK);
}));

// 前臂+手（13px，世界 -32..-19；pivot 顶中 (32,4)=肘点）
writeFileSync(`${OUT}/parts/fore-arm-l.png`, drawPart(() => {
  rect(30, 4, 4, 9, WRAP);                         // 绑带护腕
  wrapCross(30, 4, 4, 9, WRAP_DARK);
  rect(30, 13, 4, 4, SKIN_DARK);                   // 手
}));
writeFileSync(`${OUT}/parts/fore-arm-r.png`, drawPart(() => {
  rect(30, 4, 4, 9, WRAP_DARK);
  wrapCross(30, 4, 4, 9, [82, 62, 42]);
  rect(30, 13, 4, 4, [172, 124, 94]);
}));

// 大腿（13px，世界 -27..-14；pivot 顶中 (32,4)=髋点）
writeFileSync(`${OUT}/parts/thigh-l.png`, drawPart(() => {
  rect(30, 4, 5, 13, SKIN);
  put(34, 8, SKIN_DARK); put(34, 12, SKIN_DARK);
}));
writeFileSync(`${OUT}/parts/thigh-r.png`, drawPart(() => {
  rect(30, 4, 5, 13, SKIN_DARK);
}));

// 小腿+靴（14px，世界 -14..0；pivot 顶中 (32,4)=膝点）
writeFileSync(`${OUT}/parts/calf-l.png`, drawPart(() => {
  rect(30, 4, 4, 10, WRAP);                        // 绑腿
  wrapCross(30, 4, 4, 10, WRAP_DARK);
  rect(29, 14, 6, 3, BOOT);                        // 靴
  rect(29, 17, 6, 1, BOOT_DARK);
}));
writeFileSync(`${OUT}/parts/calf-r.png`, drawPart(() => {
  rect(30, 4, 4, 10, WRAP_DARK);
  wrapCross(30, 4, 4, 10, [82, 62, 42]);
  rect(29, 14, 6, 3, BOOT_DARK);
  rect(29, 17, 6, 1, [52, 38, 26]);
}));

console.log('written: parts/head-front/side/back.png, torso.png, upper-arm-l/r.png, fore-arm-l/r.png, thigh-l/r.png, calf-l/r.png');
console.log('(skirt-front/back, weapon-spear 沿用既有部件图)');

// 砍柴斧：刃高举（刃 y2..9、握点 y12 在柄上部），柄尾 y28 不插地
writeFileSync(`${OUT}/parts/weapon-axe.png`, drawPart(() => {
  rect(30, 6, 4, 23, [112, 84, 50]);                 // 木柄（y6..28）
  rect(30, 27, 4, 2, [86, 64, 40]);
  rect(26, 2, 12, 8, [168, 166, 160]);               // 铁刃（y2..9）
  rect(26, 2, 12, 2, [204, 202, 196]);
  rect(27, 9, 10, 2, [126, 122, 116]);
  put(31, 12, [74, 56, 36]);                         // 绑绳（握点）
  put(33, 12, [74, 56, 36]);
}));
console.log('written: parts/weapon-axe.png（刃高举型，握点 y12）');
