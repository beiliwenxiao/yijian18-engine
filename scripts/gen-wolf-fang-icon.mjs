// 程序化生成「狼牙」物品图标（64×64 像素风弯月獠牙）。
// 纯 node（zlib 内置）产出 PNG，可重复执行：node scripts/gen-wolf-fang-icon.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 64;

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

function encodePNG(pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter none
    pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── 像素画：弯月獠牙（二次贝塞尔中心线 + 渐变半宽） ──
const pixels = Buffer.alloc(SIZE * SIZE * 4);

// 二次贝塞尔中心线：根部(20,12) → 控制(34,24) → 尖端(48,50)
function bezier(t) {
  const mt = 1 - t;
  return {
    x: mt * mt * 20 + 2 * mt * t * 34 + t * t * 48,
    y: mt * mt * 12 + 2 * mt * t * 24 + t * t * 50
  };
}

// 到中心线的最近参数（粗采样 + 细化）
function closestT(px, py) {
  let bestT = 0, bestDist = Infinity;
  for (let i = 0; i <= 32; i += 1) {
    const t = i / 32;
    const p = bezier(t);
    const d = (px - p.x) ** 2 + (py - p.y) ** 2;
    if (d < bestDist) { bestDist = d; bestT = t; }
  }
  return { t: bestT, dist: Math.sqrt(bestDist) };
}

// 颜色插值
function lerpColor(a, b, ratio) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * ratio),
    Math.round(a[1] + (b[1] - a[1]) * ratio),
    Math.round(a[2] + (b[2] - a[2]) * ratio)
  ];
}

const OUTLINE = [58, 44, 26, 255];     // 深褐描边
const ROOT = [186, 166, 128, 255];     // 根部暗米色
const BODY = [245, 238, 214, 255];     // 牙身米白
const TIP = [255, 255, 250, 255];      // 尖端亮白
const EDGE = 1.6;                       // 描边宽度

for (let py = 0; py < SIZE; py += 1) {
  for (let px = 0; px < SIZE; px += 1) {
    const cx = px + 0.5, cy = py + 0.5;
    const { t, dist } = closestT(cx, cy);
    // 半宽：根部 9px 渐缩到尖端 1.5px（尖端 0.78 之后加速收窄成弯钩尖）
    const halfWidth = t < 0.78 ? 9 - 5.5 * (t / 0.78) : 3.5 * (1 - (t - 0.78) / 0.22) + 1.2;
    const color = [0, 0, 0, 0];
    if (dist <= halfWidth) {
      const ratio = Math.min(1, Math.max(0, t / 0.9));
      const base = ratio < 0.35 ? lerpColor(ROOT, BODY, ratio / 0.35) : lerpColor(BODY, TIP, (ratio - 0.35) / 0.65);
      color.splice(0, 4, ...base, 255);
      // 内侧高光：靠外弧一侧（距中心线略偏上）的细亮带
      if (dist < halfWidth - 3 && t > 0.2 && t < 0.8) {
        color.splice(0, 4, ...lerpColor(base, [255, 255, 248], 0.5), 255);
      }
    }
    if (dist > halfWidth && dist <= halfWidth + EDGE) {
      color.splice(0, 4, ...OUTLINE);
    }
    // 根部牙冠座：顶部短横台（第 8~12 行、x 12~30），与獠牙根部衔接
    if (py >= 8 && py <= 12 && px >= 12 && px <= 30) {
      const shade = py === 8 || py === 12 || px === 12 || px === 30;
      color.splice(0, 4, ...(shade ? OUTLINE : [204, 186, 148, 255]));
    }
    const offset = (py * SIZE + px) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = color[3];
  }
}

const out = 'example/sanguo_zhangjiao/assets/images/items/equipment-wolf-fang.png';
writeFileSync(out, encodePNG(pixels));
console.log(`written: ${out} (${SIZE}x${SIZE})`);
