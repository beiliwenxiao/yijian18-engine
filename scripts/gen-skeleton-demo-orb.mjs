// 程序化生成「骨骼动画 demo 序列帧」小图（64×32 PNG，两帧 32×32 脉冲光球）。
// 纯 node（zlib 内置）产出 PNG，可重复执行：node scripts/gen-skeleton-demo-orb.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const W = 64, H = 32;

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

const pixels = Buffer.alloc(W * H * 4);

// 两帧 32×32 光球：小暗金 → 大亮金（呼吸脉冲）
function drawOrb(frame, cx, cy, radius, coreColor, rimColor) {
  for (let py = 0; py < 32; py += 1) {
    for (let px = 0; px < 32; px += 1) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      let color = null;
      if (dist <= radius * 0.45) color = coreColor;
      else if (dist <= radius) {
        const t = (dist - radius * 0.45) / (radius * 0.55);
        color = [
          Math.round(coreColor[0] + (rimColor[0] - coreColor[0]) * t),
          Math.round(coreColor[1] + (rimColor[1] - coreColor[1]) * t),
          Math.round(coreColor[2] + (rimColor[2] - coreColor[2]) * t),
          Math.round(255 * (1 - t * 0.55))
        ];
      }
      if (!color) continue;
      const offset = ((frame * 32 + py) * W + frame * 32 + px) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }
}

drawOrb(0, 16, 16, 9, [255, 236, 170], [201, 162, 39]);   // 帧1：小而收敛
drawOrb(1, 16, 16, 14, [255, 250, 220], [232, 199, 110]); // 帧2：大而发散

const out = 'example/sanguo_zhangjiao/assets/images/skeleton/demo-orb.png';
writeFileSync(out, encodePNG(pixels));
console.log(`written: ${out} (${W}x${H})`);
