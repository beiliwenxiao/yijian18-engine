// 程序化生成「苹果丛」资源节点（68×58：绿色灌木丛 + 红苹果点缀）
// 与「苹果」物品图标（30×30：红苹果 + 果柄绿叶）。
// 纯 node（zlib 内置）产出 PNG，可重复执行：node scripts/gen-apple-thicket.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// ── PNG 最小编码（IHDR/IDAT/IEND + CRC32） ──
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

function encodePNG(pixels, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function lerpColor(a, b, ratio) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * ratio),
    Math.round(a[1] + (b[1] - a[1]) * ratio),
    Math.round(a[2] + (b[2] - a[2]) * ratio)
  ];
}

/** 画一个带描边与高光的实心椭圆 */
function fillEllipse(pixels, width, height, cx, cy, rx, ry, fill, outline, highlight = null) {
  for (let py = Math.max(0, Math.floor(cy - ry - 1)); py <= Math.min(height - 1, Math.ceil(cy + ry + 1)); py += 1) {
    for (let px = Math.max(0, Math.floor(cx - rx - 1)); px <= Math.min(width - 1, Math.ceil(cx + rx + 1)); px += 1) {
      const dx = (px + 0.5 - cx) / rx;
      const dy = (py + 0.5 - cy) / ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      const offset = (py * width + px) * 4;
      if (d <= 1) {
        const base = highlight && dy < -0.3 && dx < 0.2
          ? lerpColor(fill, highlight, Math.min(1, (-dy - 0.3) / 0.7))
          : fill;
        pixels[offset] = base[0]; pixels[offset + 1] = base[1];
        pixels[offset + 2] = base[2]; pixels[offset + 3] = 255;
      } else if (d <= 1 + 1.5 / Math.min(rx, ry)) {
        pixels[offset] = outline[0]; pixels[offset + 1] = outline[1];
        pixels[offset + 2] = outline[2]; pixels[offset + 3] = 255;
      }
    }
  }
}

// ── 1) 苹果丛 68×58：绿色灌木丛（三团叶簇）+ 6 个红苹果 ──
{
  const W = 68, H = 58;
  const pixels = Buffer.alloc(W * H * 4);
  const LEAF_DARK = [42, 92, 44, 255];
  const LEAF = [66, 128, 58, 255];
  const LEAF_LIGHT = [104, 164, 82, 255];
  const OUTLINE = [30, 54, 30, 255];
  const APPLE = [206, 48, 48, 255];
  const APPLE_DARK = [168, 32, 40, 255];
  const APPLE_LIGHT = [244, 120, 104, 255];
  const STEM = [92, 62, 32, 255];

  // 叶簇（左中右三团，底部收拢）
  fillEllipse(pixels, W, H, 22, 38, 17, 15, LEAF, OUTLINE, LEAF_LIGHT);
  fillEllipse(pixels, W, H, 46, 38, 17, 15, LEAF, OUTLINE, LEAF_LIGHT);
  fillEllipse(pixels, W, H, 34, 26, 19, 16, LEAF, OUTLINE, LEAF_LIGHT);
  fillEllipse(pixels, W, H, 34, 46, 22, 9, LEAF_DARK, OUTLINE);

  // 苹果：散布在叶簇上（每颗带果柄）
  const apples = [
    [18, 30, 5.5], [34, 20, 6], [50, 31, 5.5],
    [27, 40, 5], [43, 44, 5], [58, 42, 4.5]
  ];
  for (const [ax, ay, ar] of apples) {
    fillEllipse(pixels, W, H, ax, ay, ar, ar, APPLE, [110, 20, 24, 255], APPLE_LIGHT);
    // 果柄（2px 竖线）
    for (let sy = Math.floor(ay - ar) - 3; sy <= Math.floor(ay - ar); sy += 1) {
      const offset = (sy * W + ax) * 4;
      if (sy >= 0) { pixels[offset] = STEM[0]; pixels[offset + 1] = STEM[1]; pixels[offset + 2] = STEM[2]; pixels[offset + 3] = 255; }
    }
  }

  const out = 'example/sanguo_zhangjiao/assets/images/s01/apple-thicket.png';
  writeFileSync(out, encodePNG(pixels, W, H));
  console.log(`written: ${out} (${W}x${H})`);
}

// ── 2) 苹果图标 30×30 ──
{
  const S = 30;
  const pixels = Buffer.alloc(S * S * 4);
  fillEllipse(pixels, S, S, 12, 17, 9, 8.5, [206, 48, 48, 255], [110, 20, 24, 255], [244, 120, 104, 255]);
  fillEllipse(pixels, S, S, 19, 17, 8.5, 8.5, [206, 48, 48, 255], [110, 20, 24, 255], [248, 132, 112, 255]);
  // 果柄
  for (let y = 3; y <= 9; y += 1) {
    const offset = (y * S + 15) * 4;
    pixels[offset] = 92; pixels[offset + 1] = 62; pixels[offset + 2] = 32; pixels[offset + 3] = 255;
  }
  // 叶子（果柄右侧小椭圆）
  fillEllipse(pixels, S, S, 19.5, 6, 4, 2.2, [86, 150, 62, 255], [40, 78, 36, 255]);

  const out = 'example/sanguo_zhangjiao/assets/images/s01/apple.png';
  writeFileSync(out, encodePNG(pixels, S, S));
  console.log(`written: ${out} (${S}x${S})`);
}
