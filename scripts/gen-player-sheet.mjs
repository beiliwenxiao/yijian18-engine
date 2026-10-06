// 程序化像素生成玩家角色资产（三国黄巾女兵 · 最小拆件方案）：
//   1. refugee-girl.png        完整版整身 4×8（保留兼容，manifest 已不引用）
//   2. refugee-girl-core.png   核心版整身 4×8（去手臂/裙/矛：头+躯干+内裤+腿，body 槽位引用）
//   3. parts/arm-l.png         左臂（pivot 肩点 (32,6)：灰蓝短袖+裸臂+绑带小臂）
//   4. parts/arm-r.png         右臂（暗色调，pivot 肩点 (32,6)）
//   5. parts/weapon-axe.png    砍柴斧（pivot 握点 (32,10)，铁刃）
//   6. parts/weapon-spear.png  背背长矛（红缨枪，pivot 中心 (32,32)，挂 back 骨骼）
//   7. parts/skirt-front.png   卡其黄破裙前片（pivot 顶中 (32,6)）
//   8. parts/skirt-back.png    裙后片（更宽更暗）
// 参考：三国黄巾女兵设定图（黄头巾+丸子头 / 炭灰蓝短打 / 锈红腰带+黄符 / 破烂卡其短裙 / 绑腿短靴 / 背背长矛）
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

/** 交叉绑带纹：在 rect 区域画斜向绑带暗纹（护腕/绑腿质感） */
function wrapCross(x, y, w, h, dark) {
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      if ((i + j) % 3 === 0) put(x + i, y + j, dark);
    }
  }
}

// 调色板：三国黄巾女兵（参考三视图设定）
const SKIN = [232, 178, 132];
const SKIN_DARK = [196, 144, 106];
const HAIR = [52, 38, 26];          // 深棕发
const HAIR_DARK = [36, 26, 18];
const BAND = [222, 180, 64];        // 黄头巾
const BAND_DARK = [182, 142, 44];
const TOP = [74, 78, 90];           // 炭灰蓝短打
const TOP_DARK = [56, 60, 70];
const SASH = [162, 74, 52];         // 锈红腰带
const SASH_DARK = [124, 54, 40];
const SKIRT = [196, 166, 84];       // 卡其黄裙前片
const SKIRT_DARK = [158, 130, 60];
const SKIRT_BACK = [148, 122, 56];  // 裙后片更暗
const UNDERWEAR = [92, 86, 80];
const WRAP = [138, 106, 72];        // 绑腿/护腕棕
const WRAP_DARK = [106, 80, 54];
const BOOT = [92, 66, 44];          // 棕色短靴
const BOOT_DARK = [68, 48, 32];
const CHARM = [232, 214, 140];      // 黄纸符
const POUCH = [110, 80, 52];        // 腰包
const SPEAR_WOOD = [112, 84, 50];   // 矛柄
const SPEAR_TIP = [178, 176, 170];  // 枪头
const SPEAR_TIP_LIGHT = [210, 208, 200];
const TASSEL = [190, 58, 48];       // 红缨
const EYE = [40, 30, 26];

/**
 * 绘制单帧角色（整身 · 黄巾女兵）。
 * @param {'full'|'core'} mode full=完整版；core=去手臂/裙（拆件模式下由部件槽位补）
 */
function drawFrame(facing, walkPhase, dx = 0, mode = 'full') {
  ox += dx;
  const bob = walkPhase === 2 ? 1 : 0;
  const legSwing = walkPhase === 1 ? 1 : walkPhase === 3 ? -1 : 0;
  const groundY = 60 - bob;
  const cx = 32;

  // ---- 腿：大腿皮肤 + 小腿交叉绑带 + 棕色短靴 ----
  const drawLeg = (x, dark) => {
    const thigh = dark ? SKIN_DARK : SKIN;
    const wrapBase = dark ? WRAP_DARK : WRAP;
    rect(x - 1, groundY - 14, 3, 6, thigh);            // 大腿（裙下露出）
    rect(x - 1, groundY - 8, 3, 5, wrapBase);          // 绑腿
    wrapCross(x - 1, groundY - 8, 3, 5, dark ? [86, 64, 44] : WRAP_DARK);
    rect(x - 2, groundY - 3, 4, 2, dark ? BOOT_DARK : BOOT);   // 靴
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

  // ---- 下装：full=裙片由部件渲染；core=简陋内裤 ----
  const skirtTop = groundY - 24;
  if (mode === 'core') {
    rect(cx - 7, skirtTop + 2, 14, 7, UNDERWEAR);
    put(cx - 2, skirtTop + 4, [70, 64, 60]);
  }

  // ---- 躯干：炭灰蓝交叉领短打 + 锈红腰带 + 黄符/腰包 ----
  const torsoTop = groundY - 34;
  rect(cx - 7, torsoTop, 14, 8, TOP);                     // 短打主体
  tatteredHem(cx - 7, torsoTop + 8, 14, TOP_DARK, 31 + (facing === 'left' ? 7 : 0));
  rect(cx - 9, torsoTop, 3, 4, TOP);                      // 短袖（盖臂根）
  rect(cx + 6, torsoTop, 3, 4, TOP);
  rect(cx - 8, torsoTop + 7, 16, 3, SASH);                // 锈红宽腰带
  rect(cx - 1, torsoTop + 7, 2, 3, SASH_DARK);            // 带结
  rect(cx + 3, torsoTop + 10, 2, 3, CHARM);               // 黄纸符垂条
  rect(cx + 3, torsoTop + 9, 2, 1, SASH_DARK);            // 符挂绳
  rect(cx - 6, torsoTop + 10, 3, 2, POUCH);               // 腰包
  if (facing !== 'up') {
    // 交叉领 V 口 + 脖颈 + 明显交领斜线
    put(cx - 1, torsoTop, SKIN); put(cx, torsoTop, SKIN); put(cx + 1, torsoTop, SKIN);
    for (let i = 0; i < 3; i += 1) {
      put(cx - 1 - i, torsoTop + 1 + i, TOP_DARK);
      put(cx + 1 + i, torsoTop + 1 + i, TOP_DARK);
    }
    put(cx, torsoTop + 4, TOP_DARK);                      // V 底
  } else {
    // 背面：交叠布纹 + 腰带打结垂带
    put(cx - 2, torsoTop + 2, TOP_DARK); put(cx - 3, torsoTop + 3, TOP_DARK);
    put(cx + 2, torsoTop + 2, TOP_DARK); put(cx + 3, torsoTop + 3, TOP_DARK);
    rect(cx - 1, torsoTop + 10, 2, 3, SASH_DARK);
  }

  // ---- 手臂（仅 full；core 由部件槽位骨骼驱动）----
  if (mode === 'full') {
    const armSwing = -legSwing * 3;
    const drawArm = (x, dark) => {
      const skin = dark ? SKIN_DARK : SKIN;
      const wrapBase = dark ? WRAP_DARK : WRAP;
      rect(x - 1, torsoTop + 1, 3, 3, dark ? TOP_DARK : TOP);   // 短袖
      rect(x - 1, torsoTop + 4, 3, 4, skin);                    // 裸臂
      rect(x - 1, torsoTop + 8, 3, 4, wrapBase);                // 护腕绑带
      wrapCross(x - 1, torsoTop + 8, 3, 4, dark ? [86, 64, 44] : WRAP_DARK);
      rect(x - 1, torsoTop + 12, 3, 2, dark ? SKIN_DARK : skin); // 手
    };
    if (facing === 'left' || facing === 'right') {
      drawArm(cx + (facing === 'right' ? -4 : 4) + armSwing, false);
      drawArm(cx + (facing === 'right' ? 5 : -5), true);
    } else {
      drawArm(cx - 9, false);
      drawArm(cx + 9, true);
    }
  }

  // ---- 头：丸子头 + 黄头巾 + 五官（分层：颅发→脸→刘海鬓发→头巾→发髻）----
  const headCy = torsoTop - 9;
  disc(cx, headCy - 1, 8, HAIR);                          // 头颅发盘
  disc(cx, headCy + 2, 6, SKIN);                          // 脸盘（偏下露下巴）
  rect(cx - 6, headCy - 3, 12, 1, HAIR);                  // 刘海
  rect(cx - 8, headCy - 1, 2, 6, HAIR);                   // 鬓发（贴脸两侧）
  rect(cx + 6, headCy - 1, 2, 6, HAIR);
  rect(cx - 8, headCy - 6, 16, 3, BAND);                  // 黄头巾额带（贴合颅形）
  rect(cx + 8, headCy - 3, 1, 4, BAND_DARK);              // 右侧巾角垂带
  put(cx + 8, headCy + 1, BAND);
  disc(cx, headCy - 11, 3, HAIR);                         // 丸子头髻
  rect(cx - 2, headCy - 10, 4, 3, HAIR);
  put(cx - 1, headCy - 13, HAIR_DARK); put(cx + 1, headCy - 12, HAIR_DARK);

  if (facing === 'down') {
    rect(cx - 3, headCy + 1, 2, 2, EYE);
    rect(cx + 1, headCy + 1, 2, 2, EYE);
    rect(cx - 2, headCy + 6, 4, 1, [176, 108, 96]);       // 嘴
  } else if (facing === 'left' || facing === 'right') {
    const eyeX = facing === 'right' ? cx + 1 : cx - 3;
    rect(eyeX, headCy + 1, 2, 2, EYE);
    put(eyeX + (facing === 'right' ? 3 : -2), headCy + 4, SKIN_DARK);   // 鼻
    rect(eyeX + (facing === 'right' ? 1 : -1), headCy + 6, 2, 1, [176, 108, 96]);
  } else {
    // 背面：后脑全发 + 头巾后沿带结
    disc(cx, headCy, 7, HAIR);
    rect(cx - 7, headCy - 6, 14, 3, BAND);                // 巾带后沿
    rect(cx - 2, headCy - 3, 4, 3, BAND_DARK);            // 带结
    put(cx - 5, headCy - 3, BAND); put(cx + 4, headCy - 3, BAND);
  }

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

// 3. 左臂：肩 pivot (32,6)——灰蓝短袖 + 裸臂 + 绑带护腕 + 手
writeFileSync(`${OUT}/parts/arm-l.png`, drawPart(() => {
  rect(29, 6, 6, 4, TOP);                            // 短袖
  rect(29, 9, 6, 1, TOP_DARK);
  rect(30, 10, 4, 6, SKIN);                          // 裸臂
  rect(30, 16, 4, 8, WRAP);                          // 绑带护腕
  wrapCross(30, 16, 4, 8, WRAP_DARK);
  rect(30, 24, 4, 4, SKIN_DARK);                     // 手
}));

// 4. 右臂（暗色调：远侧）
writeFileSync(`${OUT}/parts/arm-r.png`, drawPart(() => {
  rect(29, 6, 6, 4, TOP_DARK);
  rect(29, 9, 6, 1, [44, 48, 56]);
  rect(30, 10, 4, 6, SKIN_DARK);
  rect(30, 16, 4, 8, WRAP_DARK);
  wrapCross(30, 16, 4, 8, [82, 62, 42]);
  rect(30, 24, 4, 4, [172, 124, 94]);
}));

// 5. 砍柴斧：握点 pivot (32,10)——木柄下垂 + 铁刃 + 绑绳
writeFileSync(`${OUT}/parts/weapon-axe.png`, drawPart(() => {
  rect(30, 10, 4, 22, [112, 84, 50]);                // 木柄
  rect(30, 31, 4, 2, [86, 64, 40]);
  rect(26, 7, 12, 8, [168, 166, 160]);               // 铁刃
  rect(26, 7, 12, 2, [204, 202, 196]);
  rect(27, 14, 10, 2, [126, 122, 116]);
  put(31, 10, [74, 56, 36]);                         // 绑绳
  put(33, 10, [74, 56, 36]);
}));

// 6. 背背长矛（红缨枪）：pivot 中心 (32,32)——对角线柄，枪头右上，红缨
writeFileSync(`${OUT}/parts/weapon-spear.png`, drawPart(() => {
  for (let i = 0; i <= 32; i += 1) {
    const sx = 13 + i, sy = 52 - i;
    rect(sx, sy, 2, 2, SPEAR_WOOD);                  // 对角矛柄（左下→右上）
    if (i % 7 === 0) put(sx, sy + 1, [92, 68, 40]);  // 柄节
  }
  rect(44, 16, 5, 5, SPEAR_TIP);                     // 枪头
  put(46, 15, SPEAR_TIP_LIGHT); put(47, 16, SPEAR_TIP_LIGHT);
  put(48, 19, [128, 126, 120]);
  rect(41, 20, 4, 3, TASSEL);                        // 红缨
  put(40, 22, TASSEL); put(44, 23, [150, 44, 38]);
  rect(12, 52, 3, 3, [86, 64, 40]);                  // 柄尾缠绳
}));

// 7. 裙前片：顶中 pivot (32,6)——卡其黄 A 形 + 中缝开衩 + 破边
writeFileSync(`${OUT}/parts/skirt-front.png`, drawPart(() => {
  rect(22, 6, 20, 5, SKIRT);
  rect(21, 11, 22, 6, SKIRT);
  rect(23, 17, 18, 3, SKIRT_DARK);
  tatteredHem(21, 20, 22, SKIRT_DARK, 133);
  rect(31, 6, 2, 13, [124, 100, 46]);                // 中缝开衩
  rect(26, 9, 3, 2, SKIRT_DARK);                     // 补丁
  put(36, 13, SKIRT_DARK);
  rect(29, 16, 2, 2, [176, 148, 66]);                // 磨损亮部
}));

// 8. 裙后片：稍宽更暗（腿后层）
writeFileSync(`${OUT}/parts/skirt-back.png`, drawPart(() => {
  rect(21, 6, 22, 6, SKIRT_BACK);
  rect(20, 12, 24, 7, [128, 104, 48]);
  tatteredHem(20, 19, 24, [106, 86, 40], 199);
  rect(25, 8, 4, 2, [106, 86, 40]);
}));

console.log('written: parts/arm-l.png, arm-r.png, weapon-axe.png, weapon-spear.png, skirt-front.png, skirt-back.png');
