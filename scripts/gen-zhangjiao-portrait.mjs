// 程序化生成「张角」对话头像（128×128 像素风：黄巾头冠 + 络腮长须 + 道袍领）。
// 纯 node（zlib 内置）产出 PNG，可重复执行：node scripts/gen-zhangjiao-portrait.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 128;

// ── PNG 最小编码（与 gen-wolf-fang-icon.mjs 同款） ──
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

// ── 调色 ──
const C = {
  bgTop: [46, 38, 58, 255], bgColor: [58, 46, 66, 255],      // 暗紫背景（上深下浅）
  scarf: [224, 183, 63, 255], scarfDark: [186, 146, 40, 255], // 黄巾
  scarfBand: [201, 161, 46, 255],
  skin: [217, 168, 120, 255], skinDark: [186, 136, 92, 255],  // 肤色
  hair: [42, 32, 24, 255], beard: [52, 40, 30, 255],          // 须发
  eye: [28, 22, 18, 255], eyeWhite: [232, 226, 214, 255],
  robe: [46, 42, 58, 255], inner: [228, 220, 202, 255],       // 道袍/中衣
  outline: [24, 18, 14, 255]
};

const pixels = Buffer.alloc(SIZE * SIZE * 4);
const CX = 64;

function setPx(x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const offset = (y * SIZE + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

// ── 背景：暗紫垂直渐变 ──
for (let y = 0; y < SIZE; y += 1) {
  const ratio = y / SIZE;
  const base = [
    Math.round(C.bgTop[0] + (C.bgColor[0] - C.bgTop[0]) * ratio),
    Math.round(C.bgTop[1] + (C.bgColor[1] - C.bgTop[1]) * ratio),
    Math.round(C.bgTop[2] + (C.bgColor[2] - C.bgTop[2]) * ratio),
    255
  ];
  for (let x = 0; x < SIZE; x += 1) setPx(x, y, base);
}

// ── 肩/道袍（底部两侧） + 白色中衣领 V ──
for (let y = 96; y < SIZE; y += 1) {
  for (let x = 8; x < SIZE - 8; x += 1) {
    const shoulderRise = (y - 96) * 0.9; // 越往下肩越宽
    const leftEdge = 22 - shoulderRise;
    const rightEdge = 106 + shoulderRise;
    if (x < leftEdge || x > rightEdge) continue;
    // V 形领：|x-64| < (y-96)/2 → 中衣
    const collarHalf = (y - 96) / 2;
    const isCollar = Math.abs(x - CX) < collarHalf;
    const isCollarEdge = Math.abs(Math.abs(x - CX) - collarHalf) < 2;
    setPx(x, y, isCollar ? C.inner : (isCollarEdge ? C.outline : C.robe));
  }
}

// ── 脸（椭圆，含描边） ──
for (let y = 34; y < 92; y += 1) {
  for (let x = 30; x < 98; x += 1) {
    if (inEllipse(x, y, 64, 60, 27, 28)) {
      const isEdge = !inEllipse(x, y, 64, 60, 25.4, 26.4);
      setPx(x, y, isEdge ? C.outline : C.skin);
    }
  }
}

// ── 耳朵 ──
for (const side of [-1, 1]) {
  for (let y = 54; y < 72; y += 1) {
    for (let x = 0; x < 10; x += 1) {
      const ex = 64 + side * (27 + x - 4);
      if (inEllipse(x, y, 4, 9, 4, 9)) setPx(ex, y, x === 0 ? C.outline : C.skinDark);
    }
  }
}

// ── 黄巾头冠（覆盖头顶 y 12~40，包住脸的上沿） ──
for (let y = 10; y < 42; y += 1) {
  for (let x = 28; x < 100; x += 1) {
    // 头巾外轮廓：上半椭圆（中心 64,34 半径 34×26）
    if (inEllipse(x, y, 64, 34, 34, 25)) {
      const isEdge = !inEllipse(x, y, 64, 34, 32.5, 23.5);
      // 额头系带（y 34~40 横带，稍深）
      const isBand = y >= 33 && y <= 39;
      setPx(x, y, isEdge ? C.outline : (isBand ? C.scarfBand : (y < 24 ? C.scarf : C.scarfDark)));
    }
  }
}
// 头巾右侧垂布（x 92~104，y 34~72，随深度收窄）
for (let y = 34; y < 74; y += 1) {
  const width = 12 - Math.floor((y - 34) / 10);
  for (let x = 92; x < 92 + width; x += 1) {
    setPx(x, y, (x === 92 || y === 73 || x === 91 + width) ? C.outline : C.scarfDark);
  }
}

// ── 眉（粗黑，怒态内压：内端高外端低） ──
for (const [x0, x1] of [[40, 58], [70, 88]]) {
  for (let x = x0; x < x1; x += 1) {
    const inward = x <= 64 ? x - x0 : x1 - 1 - x;   // 距内端的距离
    const top = 48 + Math.floor(inward / 6);        // 内端 48，外端 51
    for (let y = top; y <= top + 4; y += 1) setPx(x, y, C.hair);
  }
}

// ── 眼（深目：左 46~58 / 右 70~82，y 58~67） ──
for (const [ex0, ex1] of [[46, 58], [70, 82]]) {
  for (let y = 58; y < 67; y += 1) {
    for (let x = ex0; x < ex1; x += 1) {
      if (inEllipse(x, y, (ex0 + ex1) / 2, 62, (ex1 - ex0) / 2, 4.5)) {
        const isPupil = Math.abs(x - (ex0 + ex1) / 2) <= 3 && y >= 60 && y <= 65;
        setPx(x, y, isPupil ? C.eye : C.eyeWhite);
      }
    }
  }
}

// ── 鼻（暗影：竖梁 + 鼻头） ──
for (let y = 62; y < 76; y += 1) {
  setPx(61, y, C.skinDark);
  setPx(67, y, C.skinDark);
}
for (let x = 59; x < 70; x += 1) setPx(x, 75, C.skinDark);

// ── 人中/唇缝（y 80） ──
for (let x = 56; x < 72; x += 1) setPx(x, 81, C.outline);

// ── 胡须：络腮（两颊）+ 下巴长须（渐收至 y 112） ──
for (let y = 70; y < 112; y += 1) {
  for (let x = 28; x < 100; x += 1) {
    const inFace = inEllipse(x, y, 64, 60, 27, 28);
    const isCheek = y >= 70 && y <= 92 && (x <= 46 || x >= 82) && inFace;
    const chinHalf = Math.max(0, 17 - (y - 88) * 0.5);   // 下巴/长须宽度渐收
    const isChin = y >= 84 && Math.abs(x - CX) < chinHalf;
    if (isCheek || isChin) {
      setPx(x, y, C.beard);
    }
  }
}
// 唇上髭（横向两撇）
for (let y = 78; y < 82; y += 1) {
  for (let x = 48; x < 80; x += 1) {
    if (Math.abs(x - 64) > 5 && inEllipse(x, y, 64, 60, 27, 28)) setPx(x, y, C.beard);
  }
}

// ── 描边补强：脸侧缘（耳前）已由椭圆 edge 处理；输出 ──
const out = 'example/sanguo_zhangjiao/assets/images/zhangjiao.png';
writeFileSync(out, encodePNG(pixels));
console.log(`written: ${out} (${SIZE}x${SIZE})`);
