// 程序化生成 5 个对话头像（128×128 像素风，与 gen-zhangjiao-portrait.mjs 同基建）：
//   黄巾信使 huangjin_messenger / 黄巾斥候 huangjin_scout / 黄巾残兵 huangjin_soldier /
//   妇人 refugee_woman / 断臂饥民 one_armed_refugee
// 纯 node（zlib 内置）产出 PNG，可重复执行：node scripts/gen-dialogue-portraits.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 128;

// ── PNG 最小编码（与 gen-zhangjiao-portrait.mjs 同款） ──
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

const OUTLINE = [24, 18, 14, 255];
const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

/**
 * 参数化头像绘制。
 * spec = {
 *   bg: [topRGB, bottomRGB]            背景垂直渐变
 *   cloth, clothDark, inner            衣服/暗部/领口
 *   skin, skinDark                     肤色/暗部
 *   headwear: 'yellow'|'yellowBand'|'bandage'|'bun'|'ragged'
 *   eyeStyle: 'normal'|'narrow'|'halfClosed'|'round'
 *   browStyle: 'flat'|'raised'|'droop'|'thin'
 *   mouthStyle: 'flat'|'downturn'|'small'
 *   faceThin: bool                     消瘦（颊侧阴影）
 *   scar: bool                         左颊伤疤
 *   strap: bool                        斜挎背带
 *   emptySleeve: 'left'|null           空袖管（左肩塌）
 * }
 */
function buildPortrait(spec) {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const CX = 64;

  const setPx = (x, y, color) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const offset = (y * SIZE + x) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = color[3];
  };

  // ── 背景垂直渐变 ──
  for (let y = 0; y < SIZE; y += 1) {
    const ratio = y / SIZE;
    const base = [
      Math.round(spec.bg[0][0] + (spec.bg[1][0] - spec.bg[0][0]) * ratio),
      Math.round(spec.bg[0][1] + (spec.bg[1][1] - spec.bg[0][1]) * ratio),
      Math.round(spec.bg[0][2] + (spec.bg[1][2] - spec.bg[0][2]) * ratio),
      255
    ];
    for (let x = 0; x < SIZE; x += 1) setPx(x, y, base);
  }

  // ── 肩/衣（底部） + 中衣领 V ──
  for (let y = 96; y < SIZE; y += 1) {
    for (let x = 8; x < SIZE - 8; x += 1) {
      const shoulderRise = (y - 96) * 0.9;
      const leftEdge = 22 - shoulderRise;
      const rightEdge = 106 + shoulderRise;
      if (x < leftEdge || x > rightEdge) continue;
      const collarHalf = (y - 96) / 2;
      const isCollar = Math.abs(x - CX) < collarHalf;
      const isCollarEdge = Math.abs(Math.abs(x - CX) - collarHalf) < 2;
      // 衣纹：每 10px 一道暗纹
      const isFold = (y % 10 === 0) && !isCollar;
      setPx(x, y, isCollar ? spec.inner : (isCollarEdge ? OUTLINE : (isFold ? spec.clothDark : spec.cloth)));
    }
  }

  // ── 斜挎信使背带（右肩到左腰） ──
  if (spec.strap) {
    for (let y = 96; y < SIZE; y += 1) {
      const bx = Math.round(92 - (y - 96) * 0.62);
      for (let w = 0; w < 5; w += 1) setPx(bx + w, y, w === 0 || w === 4 ? OUTLINE : spec.clothDark);
    }
  }

  // ── 空袖管（左肩塌陷扎结） ──
  if (spec.emptySleeve === 'left') {
    for (let y = 100; y < 118; y += 1) {
      for (let x = 12; x < 34; x += 1) {
        if (inEllipse(x, y, 23, 109, 11, 9)) {
          const isEdge = !inEllipse(x, y, 23, 109, 9.6, 7.6);
          // 扎结口在右上，其余为塌陷空管（暗色）
          const isKnot = x >= 27 && y <= 108;
          setPx(x, y, isEdge ? OUTLINE : (isKnot ? spec.cloth : spec.clothDark));
        }
      }
    }
  }

  // ── 脸（椭圆，含描边）；消瘦则加颊侧阴影 ──
  for (let y = 34; y < 92; y += 1) {
    for (let x = 30; x < 98; x += 1) {
      if (inEllipse(x, y, 64, 60, 27, 28)) {
        const isEdge = !inEllipse(x, y, 64, 60, 25.4, 26.4);
        const isSunken = spec.faceThin && (x <= 42 || x >= 86) && y >= 52 && y <= 84
          && !inEllipse(x, y, 64, 60, 24, 25);
        setPx(x, y, isEdge ? OUTLINE : (isSunken ? spec.skinDark : spec.skin));
      }
    }
  }

  // ── 耳朵 ──
  for (const side of [-1, 1]) {
    for (let y = 54; y < 72; y += 1) {
      for (let x = 0; x < 10; x += 1) {
        const ex = 64 + side * (27 + x - 4);
        if (inEllipse(x, y, 4, 9, 4, 9)) setPx(ex, y, x === 0 ? OUTLINE : spec.skinDark);
      }
    }
  }

  // ── 头饰 ──
  if (spec.headwear === 'yellow' || spec.headwear === 'yellowBand') {
    // 黄巾头巾（同张角：上半椭圆覆盖头顶）
    for (let y = 10; y < 42; y += 1) {
      for (let x = 28; x < 100; x += 1) {
        if (inEllipse(x, y, 64, 34, 34, 25)) {
          const isEdge = !inEllipse(x, y, 64, 34, 32.5, 23.5);
          const isBand = spec.headwear === 'yellowBand' && y >= 33 && y <= 39;
          setPx(x, y, isEdge ? OUTLINE : (isBand ? [201, 161, 46, 255] : (y < 24 ? [224, 183, 63, 255] : [186, 146, 40, 255])));
        }
      }
    }
    // 左侧短结垂布
    for (let y = 30; y < 52; y += 1) {
      const width = 8 - Math.floor((y - 30) / 8);
      for (let x = 20; x < 20 + width; x += 1) {
        setPx(x, y, (x === 20 || y === 51) ? OUTLINE : [186, 146, 40, 255]);
      }
    }
  } else if (spec.headwear === 'bandage') {
    // 灰白绷带缠头（横条交替明暗 + 外缘描边）
    for (let y = 14; y < 46; y += 1) {
      for (let x = 28; x < 100; x += 1) {
        if (inEllipse(x, y, 64, 34, 34, 25)) {
          const isEdge = !inEllipse(x, y, 64, 34, 32.5, 23.5);
          const band = Math.floor((y - 14) / 6) % 2 === 0;
          setPx(x, y, isEdge ? OUTLINE : (band ? [214, 210, 198, 255] : [184, 178, 164, 255]));
        }
      }
    }
    // 绷带头尾垂带（右侧）
    for (let y = 40; y < 66; y += 1) {
      for (let x = 90; x < 100; x += 1) {
        setPx(x, y, (x === 90 || y === 65) ? OUTLINE : [184, 178, 164, 255]);
      }
    }
  } else if (spec.headwear === 'bun') {
    // 妇人：深发包头 + 圆髻
    for (let y = 8; y < 16; y += 1) {
      for (let x = 48; x < 80; x += 1) {
        if (inEllipse(x, y, 64, 12, 15, 7)) {
          const isEdge = !inEllipse(x, y, 64, 12, 13.4, 5.4);
          setPx(x, y, isEdge ? OUTLINE : spec.hairColor);
        }
      }
    }
    for (let y = 12; y < 44; y += 1) {
      for (let x = 28; x < 100; x += 1) {
        if (inEllipse(x, y, 64, 34, 34, 25)) {
          const isEdge = !inEllipse(x, y, 64, 34, 32.5, 23.5);
          setPx(x, y, isEdge ? OUTLINE : spec.hairColor);
        }
      }
    }
    // 布巾系带（额头横带，暖红）
    for (let y = 33; y < 40; y += 1) {
      for (let x = 32; x < 96; x += 1) {
        if (inEllipse(x, y, 64, 34, 34, 25)) setPx(x, y, [168, 88, 68, 255]);
      }
    }
  } else if (spec.headwear === 'ragged') {
    // 破布头巾（灰黄、歪斜、边缘锯齿缺口）
    for (let y = 10; y < 42; y += 1) {
      for (let x = 28; x < 100; x += 1) {
        const notch = (x + y * 3) % 17 === 0 && y < 22; // 顶部锯齿缺口
        if (inEllipse(x, y, 64, 34, 34, 25) && !notch) {
          const isEdge = !inEllipse(x, y, 64, 34, 32.5, 23.5);
          const patch = (x >= 40 && x <= 54 && y >= 14 && y <= 22); // 补丁块
          setPx(x, y, isEdge ? OUTLINE : (patch ? [148, 132, 96, 255] : (y < 24 ? [172, 156, 116, 255] : [146, 130, 96, 255])));
        }
      }
    }
  }

  // ── 眉 ──
  const browTops = {
    flat: inward => 49,
    raised: inward => 48 - Math.floor(inward / 4),       // 外端上挑（警惕）
    droop: inward => 49 + Math.floor(inward / 5),        // 外端下垂（疲惫）
    thin: inward => 50                                    // 细弯（妇人稍低粗一点）
  };
  const browThick = spec.browStyle === 'thin' ? 2 : 4;
  for (const [x0, x1] of [[40, 58], [70, 88]]) {
    for (let x = x0; x < x1; x += 1) {
      const inward = x <= 64 ? x - x0 : x1 - 1 - x;
      const top = browTops[spec.browStyle](inward);
      for (let y = top; y <= top + browThick; y += 1) setPx(x, y, spec.hairColor);
    }
  }

  // ── 眼 ──
  for (const [ex0, ex1] of [[46, 58], [70, 82]]) {
    const eyeCx = (ex0 + ex1) / 2;
    if (spec.eyeStyle === 'halfClosed') {
      // 半闭：上眼皮遮盖上半，只留下半细缝
      for (let y = 60; y < 66; y += 1) {
        for (let x = ex0; x < ex1; x += 1) {
          if (inEllipse(x, y, eyeCx, 62, (ex1 - ex0) / 2, 4.5)) {
            const isPupil = Math.abs(x - eyeCx) <= 3 && y >= 62 && y <= 65;
            setPx(x, y, isPupil ? spec.hairColor : [214, 198, 178, 255]);
          }
        }
      }
      for (let x = ex0; x < ex1; x += 1) setPx(x, 59, spec.skinDark); // 垂睑
    } else {
      const ry = spec.eyeStyle === 'narrow' ? 3.2 : (spec.eyeStyle === 'round' ? 5.5 : 4.5);
      for (let y = 58; y < 67; y += 1) {
        for (let x = ex0; x < ex1; x += 1) {
          if (inEllipse(x, y, eyeCx, 62, (ex1 - ex0) / 2, ry)) {
            const isPupil = Math.abs(x - eyeCx) <= 3 && y >= 60 && y <= 65;
            setPx(x, y, isPupil ? spec.hairColor : [232, 226, 214, 255]);
          }
        }
      }
    }
  }

  // ── 鼻 ──
  for (let y = 62; y < 76; y += 1) {
    setPx(61, y, spec.skinDark);
    setPx(67, y, spec.skinDark);
  }
  for (let x = 59; x < 70; x += 1) setPx(x, 75, spec.skinDark);

  // ── 唇 ──
  const mouthColor = OUTLINE;
  if (spec.mouthStyle === 'downturn') {
    // 下撇（愁苦）：两端下弯
    for (let x = 56; x < 72; x += 1) {
      const dy = Math.abs(x - 64) > 5 ? 1 : 0;
      setPx(x, 81 + dy, mouthColor);
    }
  } else if (spec.mouthStyle === 'small') {
    for (let x = 59; x < 69; x += 1) setPx(x, 81, mouthColor);
    for (let y = 82; y < 84; y += 1) setPx(64, y, [178, 96, 88, 255]); // 下唇淡色
  } else {
    for (let x = 56; x < 72; x += 1) setPx(x, 81, mouthColor);
  }

  // ── 颧骨阴影（消瘦） ──
  if (spec.faceThin) {
    for (let y = 66; y < 74; y += 1) {
      for (let x = 44; x < 50; x += 1) {
        if (inEllipse(x, y, 47, 70, 4, 4)) setPx(x, y, spec.skinDark);
      }
      for (let x = 78; x < 84; x += 1) {
        if (inEllipse(x, y, 81, 70, 4, 4)) setPx(x, y, spec.skinDark);
      }
    }
  }

  // ── 伤疤（左颊斜线） ──
  if (spec.scar) {
    for (let i = 0; i < 12; i += 1) {
      setPx(44 + Math.floor(i / 3), 56 + i, [156, 84, 72, 255]);
      if (i % 3 === 0) setPx(45 + Math.floor(i / 3), 56 + i, [178, 104, 88, 255]);
    }
  }

  return pixels;
}

// ── 5 个角色 spec ──
const PORTRAITS = [
  {
    file: 'huangjin-messenger',
    spec: {
      bg: [[52, 62, 78, 255], [66, 78, 94, 255]],
      cloth: [86, 104, 122, 255], clothDark: [64, 80, 96, 255], inner: [222, 216, 200, 255],
      skin: [219, 172, 124, 255], skinDark: [188, 140, 96, 255],
      hairColor: [36, 28, 22, 255],
      headwear: 'yellow', eyeStyle: 'normal', browStyle: 'flat', mouthStyle: 'flat',
      strap: true
    }
  },
  {
    file: 'huangjin-scout',
    spec: {
      bg: [[74, 60, 44, 255], [90, 74, 54, 255]],
      cloth: [122, 92, 60, 255], clothDark: [96, 70, 44, 255], inner: [196, 172, 136, 255],
      skin: [196, 146, 98, 255], skinDark: [162, 116, 74, 255],
      hairColor: [30, 24, 18, 255],
      headwear: 'yellowBand', eyeStyle: 'narrow', browStyle: 'raised', mouthStyle: 'flat'
    }
  },
  {
    file: 'huangjin-soldier',
    spec: {
      bg: [[56, 46, 46, 255], [70, 56, 54, 255]],
      cloth: [96, 72, 66, 255], clothDark: [72, 54, 50, 255], inner: [204, 196, 182, 255],
      skin: [206, 158, 112, 255], skinDark: [172, 126, 86, 255],
      hairColor: [32, 26, 20, 255],
      headwear: 'bandage', eyeStyle: 'halfClosed', browStyle: 'droop', mouthStyle: 'downturn',
      scar: true
    }
  },
  {
    file: 'refugee-woman',
    spec: {
      bg: [[76, 62, 58, 255], [92, 76, 68, 255]],
      cloth: [138, 104, 82, 255], clothDark: [110, 82, 64, 255], inner: [226, 214, 196, 255],
      skin: [224, 178, 134, 255], skinDark: [192, 146, 104, 255],
      hairColor: [38, 28, 22, 255],
      headwear: 'bun', eyeStyle: 'round', browStyle: 'thin', mouthStyle: 'small'
    }
  },
  {
    file: 'one-armed-refugee',
    spec: {
      bg: [[58, 56, 52, 255], [72, 68, 62, 255]],
      cloth: [118, 110, 92, 255], clothDark: [92, 86, 72, 255], inner: [198, 188, 168, 255],
      skin: [212, 162, 116, 255], skinDark: [178, 132, 90, 255],
      hairColor: [34, 26, 20, 255],
      headwear: 'ragged', eyeStyle: 'narrow', browStyle: 'droop', mouthStyle: 'downturn',
      faceThin: true, emptySleeve: 'left'
    }
  }
];

for (const { file, spec } of PORTRAITS) {
  const out = `example/sanguo_zhangjiao/assets/images/${file}.png`;
  writeFileSync(out, encodePNG(buildPortrait(spec)));
  console.log(`written: ${out} (${SIZE}x${SIZE})`);
}
