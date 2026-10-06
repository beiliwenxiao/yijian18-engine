// 程序化生成玩家技能图标（64×64 PNG ×3：火焰掌/寒冰指/烈焰爆）。
// 纯 node（zlib 内置），可重复执行：node scripts/gen-skill-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const SIZE = 64;

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
  pixels[offset + 3] = color[3];
}

/** 深色圆底 + 径向渐变，作为图标底。 */
function drawBase(pixels, rimColor, innerColor) {
  const cx = SIZE / 2, cy = SIZE / 2, radius = 29;
  for (let py = 0; py < SIZE; py += 1) {
    for (let px = 0; px < SIZE; px += 1) {
      const dist = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
      if (dist > radius) continue;
      const t = dist / radius;
      const color = [
        Math.round(rimColor[0] + (innerColor[0] - rimColor[0]) * t),
        Math.round(rimColor[1] + (innerColor[1] - rimColor[1]) * t),
        Math.round(rimColor[2] + (innerColor[2] - rimColor[2]) * t),
        235
      ];
      put(pixels, px, py, dist > radius - 2 ? [color[0] * 0.5, color[1] * 0.5, color[2] * 0.5, 255] : color);
    }
  }
}

/** 火苗（水滴形，摆动边） */
function drawFlame(pixels, cx, baseY, height, halfWidth, hot) {
  for (let row = 0; row < height; row += 1) {
    const t = row / height;                       // 0 底 → 1 顶
    const sway = Math.sin(t * Math.PI * 1.6) * halfWidth * 0.35 * (hot ? 1.2 : 0.8);
    const width = halfWidth * (1 - t * 0.75);
    const temperature = 1 - t;
    for (let px = 0; px < SIZE; px += 1) {
      const dx = px + 0.5 - (cx + sway);
      if (Math.abs(dx) > width) continue;
      const edge = Math.abs(dx) / width;
      const color = hot
        ? [255, Math.round(120 + 120 * temperature), Math.round(40 * temperature), 255]
        : [Math.round(255 * temperature + 60), Math.round(200 * temperature), 255, 255];
      put(pixels, px, baseY - row, edge > 0.6
        ? [Math.round(color[0] * 0.75), Math.round(color[1] * 0.75), Math.round(color[2] * 0.75), color[3]]
        : color);
    }
  }
  // 焰芯
  for (let py = 0; py < height * 0.4; py += 1) {
    for (let px = 0; px < SIZE; px += 1) {
      const dist = Math.hypot(px + 0.5 - cx, baseY - py - 4);
      if (dist < halfWidth * 0.28) put(pixels, px, baseY - py, [255, 246, 210, 255]);
    }
  }
}

/** 冰晶（六向雪晶） */
function drawCrystal(pixels, cx, cy, radius, innerColor, outerColor) {
  for (let py = 0; py < SIZE; py += 1) {
    for (let px = 0; px < SIZE; px += 1) {
      const dx = px + 0.5 - cx, dy = py + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      const angle = Math.atan2(dy, dx);
      // 六主枝：角周期 π/3，靠枝心加粗
      const branch = Math.abs(((angle / (Math.PI / 3)) % 1 + 1) % 1 - 0.5) * 2; // 0 枝心 → 1 枝间
      const lineWidth = 0.12 + 0.1 * (1 - dist / radius);
      const alpha = branch < lineWidth ? 255 : 0;
      // 主枝旁的小分叉
      const forkDist = Math.abs(dist - radius * 0.55);
      const fork = branch < lineWidth * 1.6 && forkDist < radius * 0.12 && dist > radius * 0.3;
      if (alpha > 0 || (fork && branch < lineWidth * 1.4)) {
        const t = dist / radius;
        put(pixels, px, py, [
          Math.round(outerColor[0] + (innerColor[0] - outerColor[0]) * (1 - t)),
          Math.round(outerColor[1] + (innerColor[1] - outerColor[1]) * (1 - t)),
          Math.round(outerColor[2] + (innerColor[2] - outerColor[2]) * (1 - t)),
          255
        ]);
      }
    }
  }
  // 中心冰核
  for (let py = 0; py < SIZE; py += 1) {
    for (let px = 0; px < SIZE; px += 1) {
      if (Math.hypot(px + 0.5 - cx, py + 0.5 - cy) < radius * 0.18) put(pixels, px, py, [235, 250, 255, 255]);
    }
  }
}

/** 爆炸星芒（八向尖刺） */
function drawBurst(pixels, cx, cy, radius, coreColor, spikeColor) {
  for (let py = 0; py < SIZE; py += 1) {
    for (let px = 0; px < SIZE; px += 1) {
      const dx = px + 0.5 - cx, dy = py + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      const angle = Math.atan2(dy, dx);
      // 八向星芒：半径随角度收缩
      const spike = Math.pow(Math.abs(Math.cos(angle * 4)), 3);
      const effective = radius * (0.42 + 0.58 * spike);
      if (dist <= effective) {
        const t = dist / effective;
        const color = t < 0.4
          ? coreColor
          : [
            Math.round(coreColor[0] + (spikeColor[0] - coreColor[0]) * (t - 0.4) / 0.6),
            Math.round(coreColor[1] + (spikeColor[1] - coreColor[1]) * (t - 0.4) / 0.6),
            Math.round(coreColor[2] + (spikeColor[2] - coreColor[2]) * (t - 0.4) / 0.6),
            255
          ];
        put(pixels, px, py, color);
      }
    }
  }
}

// 火焰掌：暖红底 + 橙红火苗
{
  const pixels = newPixels();
  drawBase(pixels, [122, 40, 22], [58, 22, 14]);
  drawFlame(pixels, SIZE / 2, SIZE - 14, 40, 15, true);
  const out = 'example/sanguo_zhangjiao/assets/images/skills/skill-flame-palm.png';
  mkdirSync('example/sanguo_zhangjiao/assets/images/skills', { recursive: true });
  writeFileSync(out, encodePNG(pixels));
  console.log(`written: ${out}`);
}

// 寒冰指：冰蓝底 + 六向雪晶
{
  const pixels = newPixels();
  drawBase(pixels, [40, 78, 110], [16, 30, 48]);
  drawCrystal(pixels, SIZE / 2, SIZE / 2, 24, [235, 250, 255], [110, 180, 225]);
  const out = 'example/sanguo_zhangjiao/assets/images/skills/skill-ice-finger.png';
  writeFileSync(out, encodePNG(pixels));
  console.log(`written: ${out}`);
}

// 烈焰爆：深橙底 + 八向爆裂星芒
{
  const pixels = newPixels();
  drawBase(pixels, [130, 62, 16], [52, 24, 10]);
  drawBurst(pixels, SIZE / 2, SIZE / 2, 26, [255, 240, 190], [255, 120, 40]);
  const out = 'example/sanguo_zhangjiao/assets/images/skills/skill-inferno-palm.png';
  writeFileSync(out, encodePNG(pixels));
  console.log(`written: ${out}`);
}
