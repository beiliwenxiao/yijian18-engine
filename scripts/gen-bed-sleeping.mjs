// 程序化生成「被窝」过夜贴图（165×82：草铺木床上鼓起的蓝白布被 + 露出发顶 + 枕头）。
// 纯 node（zlib 内置）产出 PNG，可重复执行：node scripts/gen-bed-sleeping.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const W = 165, H = 82;

// ── PNG 最小编码 ──
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
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
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
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(H * (W * 4 + 1));
  for (let y = 0; y < H; y += 1) {
    raw[y * (W * 4 + 1)] = 0;
    pixels.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── 调色 ──
const C = {
  blanket: [64, 92, 140, 255], blanketDark: [48, 72, 116, 255],   // 蓝布被
  blanketLight: [88, 120, 170, 255],
  stripe: [206, 210, 220, 255],                                    // 白布纹
  pillow: [226, 218, 198, 255], pillowDark: [190, 180, 156, 255],  // 草枕
  hair: [38, 30, 24, 255],                                          // 露出的发顶
  bedFrame: [122, 92, 58, 255], bedFrameDark: [90, 66, 40, 255],   // 木床沿
  outline: [28, 22, 16, 255]
};

const pixels = Buffer.alloc(W * H * 4);
function setPx(x, y, color) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const offset = (y * W + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

// 被窝轮廓：鼓起的圆弧（上缘中央最高），覆盖 y 18~66
const blanketTop = x => 22 + Math.round(10 * Math.sin((x / W) * Math.PI));      // 中央鼓起
const blanketBottom = x => 58 + Math.round(6 * Math.sin((x / W) * Math.PI));    // 下缘随垂坠
// 枕头位置（左侧）：x 18~52, y 24~40
const inPillow = (x, y) => x >= 18 && x <= 52 && y >= 24 && y <= 40
  && ((x - 35) / 17) ** 2 + ((y - 32) / 8) ** 2 <= 1;
// 露出的发顶（枕上）：x 40~62, y 20~38 椭圆
const inHair = (x, y) => x >= 40 && x <= 62 && y >= 20 && y <= 38
  && ((x - 51) / 11) ** 2 + ((y - 30) / 9) ** 2 <= 1;

for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    let color = null;
    const top = blanketTop(x);
    const bottom = blanketBottom(x);
    // 木床沿（最底 4 行 + 被下露出的床架两侧）
    if (y >= H - 5) color = (y === H - 5 || x <= 3 || x >= W - 4) ? C.bedFrameDark : C.bedFrame;
    else if (y >= top && y <= bottom) {
      if (inHair(x, y)) color = C.hair;
      else if (inPillow(x, y)) color = (x + y) % 9 === 0 ? C.pillowDark : C.pillow;
      else {
        // 被面：斜向布纹 + 竖条纹
        const isStripe = (x - y) % 26 === 0 || (x - y) % 26 === 1;
        const isFold = (y - top) % 12 === 0 && y > top + 4; // 折痕
        color = isStripe ? C.stripe : (isFold ? C.blanketDark : C.blanket);
      }
      // 被缘描边
      if (y === top || y === top + 1 || y === bottom || x <= 4 || x >= W - 5) color = C.outline;
    }
    if (color) setPx(x, y, color);
  }
}

const out = 'example/sanguo_zhangjiao/assets/images/s01/bed-sleeping.png';
writeFileSync(out, encodePNG(pixels));
console.log(`written: ${out} (${W}x${H})`);
