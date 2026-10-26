/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-26
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

// 程序化生成 Q 版三头身骨骼资产（黄巾小兵）：6 张 64×64 部件 PNG + chibi.json。
// 纯 node（zlib 内置），可重复执行：node scripts/gen-chibi-skeleton.mjs
// 比例：总高 96px ≈ 3 头身（头 34 / 躯干 32 / 腿 30）。
// 配色对齐 config/presentation.json palette（黄巾 #d8aa32 / 描边 #2d2412）。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const SIZE = 64;
const IMG_DIR = 'example/sanguo_zhangjiao/assets/images/chibi/parts';
const OUT_DIR = 'example/sanguo_zhangjiao/assets/skeletons';

/* ---------------- PNG 编码（与 gen-skill-icons.mjs 同款） ---------------- */

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
  pixels[offset + 3] = color[3] ?? 255;
}

/** 颜色：'#rrggbb' → [r,g,b] */
const rgb = hex => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16)
];

/** 实心椭圆（1px 描边：先画放大轮廓椭圆再覆盖填充椭圆） */
function fillEllipse(pixels, cx, cy, rx, ry, fill, outline) {
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y += 1) {
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x += 1) {
      const nx = (x + 0.5 - cx) / (rx + 0.5);
      const ny = (y + 0.5 - cy) / (ry + 0.5);
      if (nx * nx + ny * ny <= 1) put(pixels, x, y, outline ? rgb(outline) : rgb(fill));
    }
  }
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny <= 1) put(pixels, x, y, rgb(fill));
    }
  }
}

/** 实心矩形（1px 描边） */
function fillRect(pixels, x0, y0, x1, y1, fill, outline) {
  if (outline) {
    for (let y = y0 - 1; y <= y1 + 1; y += 1) {
      for (let x = x0 - 1; x <= x1 + 1; x += 1) {
        if (x < x0 || x > x1 || y < y0 || y > y1) put(pixels, x, y, rgb(outline));
      }
    }
  }
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) put(pixels, x, y, rgb(fill));
  }
}

/* ---------------- 部件绘制（64×64，Q 版三头身黄巾兵） ---------------- */

// 主题色（对齐 config/presentation.json palette）
const SKIN = '#f2c9a2';       // 肤色
const SKIN_LINE = '#8a5c3a';  // 肤描边
const CLOTH = '#7a6a50';      // 杂色布衣
const CLOTH_LINE = '#3a2f1e'; // 布衣描边
const PANTS = '#5d5344';      // 裤
const TURBAN = '#d8aa32';     // 黄巾（palette.yellowTurbanFill）
const DARK = '#2d2412';       // 深描边/鞋（palette.yellowTurbanOutline）

// pivot 约定（manifest 同步登记）：
//   向上生长（head/torso）：内容贴图底（底边 y=60），pivot=(32,46)，attachment 偏移 (0,-14) → 内容底=骨点
//   向下生长（arm/leg）  ：内容贴图顶（顶边 y=4），pivot=(32,18)，attachment 偏移 (0,14)  → 内容顶=骨点

/** 头：黄巾 + 圆脸大眼（内容 x14~50 y26~60，36×34） */
function drawHead(pixels) {
  fillEllipse(pixels, 32, 45, 16, 13, SKIN, SKIN_LINE);      // 脸
  fillEllipse(pixels, 32, 32, 16, 8, TURBAN, DARK);           // 黄巾包顶
  fillRect(pixels, 16, 34, 48, 38, TURBAN, DARK);             // 黄巾头带
  fillRect(pixels, 46, 30, 50, 34, TURBAN, DARK);             // 巾角
  put(pixels, 26, 46, rgb(DARK)); put(pixels, 26, 47, rgb(DARK));   // 左眼
  put(pixels, 27, 46, rgb(DARK)); put(pixels, 27, 47, rgb(DARK));
  put(pixels, 38, 46, rgb(DARK)); put(pixels, 38, 47, rgb(DARK));   // 右眼
  put(pixels, 39, 46, rgb(DARK)); put(pixels, 39, 47, rgb(DARK));
  put(pixels, 32, 52, rgb(SKIN_LINE)); put(pixels, 32, 53, rgb(SKIN_LINE)); // 嘴
  put(pixels, 21, 49, rgb('#e8a87c')); put(pixels, 22, 49, rgb('#e8a87c')); // 腮红
  put(pixels, 42, 49, rgb('#e8a87c')); put(pixels, 43, 49, rgb('#e8a87c'));
}

/** 躯干：布衣 + 黄巾腰带（内容 x19~45 y28~60，26×32） */
function drawTorso(pixels) {
  fillEllipse(pixels, 32, 32, 13, 5, CLOTH, CLOTH_LINE);      // 肩
  fillRect(pixels, 20, 32, 44, 58, CLOTH, CLOTH_LINE);        // 衣身
  fillRect(pixels, 20, 50, 44, 54, TURBAN, DARK);             // 腰带
  fillRect(pixels, 29, 33, 35, 42, '#665941', CLOTH_LINE);    // 对襟
}

/** 臂：布袖 + 肤色手（内容 x28~36 y4~34，8×30） */
function drawArm(pixels) {
  fillRect(pixels, 28, 6, 36, 22, CLOTH, CLOTH_LINE);         // 袖
  fillEllipse(pixels, 32, 27, 4, 6, SKIN, SKIN_LINE);         // 手
}

/** 腿：裤 + 鞋（内容 x27~37 y4~34，10×30） */
function drawLeg(pixels) {
  fillRect(pixels, 27, 6, 37, 24, PANTS, DARK);               // 裤
  fillRect(pixels, 26, 26, 38, 33, DARK, DARK);               // 鞋
}

const PARTS = [
  { file: 'head', draw: drawHead, pivotY: 46 },
  { file: 'torso', draw: drawTorso, pivotY: 46 },
  { file: 'arm-l', draw: drawArm, pivotY: 18 },
  { file: 'arm-r', draw: drawArm, pivotY: 18 },
  { file: 'leg-l', draw: drawLeg, pivotY: 18 },
  { file: 'leg-r', draw: drawLeg, pivotY: 18 }
];

/* ---------------- 骨骼资产 ---------------- */

function loopTrack(bone, durationMs, samples) {
  const keys = samples.map((value, index) => ({ t: Math.round((index / samples.length) * durationMs), ...value }));
  return { bone, keys };
}

function clip(name, durationMs, loop, tracks) {
  return { name, durationMs, loop, tracks };
}

/* 骨骼树（root(0,0)=脚底中心，y 向下为正；世界总高 96 ≈ 3 头身）：
 *   root(0,0)
 *   └─ hips(0,-32)                      髋（腿 30px → 脚底 0）
 *      ├─ torso(0,0)     → 世界-32      躯干底（布衣向上 32px → 颈 -64）
 *      │  ├─ head(0,-32) → 世界-64      颈（头 34px → 头顶 -98）
 *      │  ├─ armL(-11,-26) → 世界(-11,-58) 肩（臂向下 30px）
 *      │  └─ armR(11,-26)  → 世界(11,-58)  肩
 *      ├─ legL(-6,2)     → 世界(-6,-30) 髋关节（腿向下 30px → 脚底 0）
 *      └─ legR(6,2)      → 世界(6,-30)
 * 附件偏移：att = (32-px, 32-py)；统一 pivot=(32,46)向上生长 / (32,18)向下生长。
 */
function buildChibiSkeleton() {
  const bones = [
    { id: 'root', parent: null, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 12 },
    { id: 'hips', parent: 'root', x: 0, y: -32, rot: 0, scaleX: 1, scaleY: 1, length: 16 },
    { id: 'torso', parent: 'hips', x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 30 },
    { id: 'head', parent: 'torso', x: 0, y: -32, rot: 0, scaleX: 1, scaleY: 1, length: 20 },
    { id: 'armL', parent: 'torso', x: -11, y: -26, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'armR', parent: 'torso', x: 11, y: -26, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'legL', parent: 'hips', x: -6, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: 28 },
    { id: 'legR', parent: 'hips', x: 6, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: 28 }
  ];
  const img = (assetId, x, y) => (
    { type: 'image', assetId, x, y, rot: 0, width: 64, height: 64, visible: true }
  );
  const slots = [
    { id: 'shadow', bone: 'root', z: 0, attachment: { type: 'empty' } },
    { id: 'armL', bone: 'armL', z: 3, attachment: img('chibi.parts.arm-l', 0, 14) },
    { id: 'armR', bone: 'armR', z: 4, attachment: img('chibi.parts.arm-r', 0, 14) },
    { id: 'torsoSlot', bone: 'torso', z: 5, attachment: img('chibi.parts.torso', 0, -14) },
    { id: 'legL', bone: 'legL', z: 5, attachment: img('chibi.parts.leg-l', 0, 14) },
    { id: 'legR', bone: 'legR', z: 5, attachment: img('chibi.parts.leg-r', 0, 14) },
    { id: 'headFront', bone: 'head', z: 7, attachment: img('chibi.parts.head', 0, -14) }
  ];
  const clips = [];
  // 待机（3 方向）：呼吸起伏——贝塞尔手柄缓动（缓出快吸缓呼：out(0.2,0.9) / in(0.5,0.1)）
  for (const dir of ['down', 'up', 'side']) {
    clips.push(clip(`idle_${dir}`, 1800, true, [
      loopTrack('torso', 1800, [
        { y: 0 },
        { y: -1.5, out: { x: 0.2, y: 0.9 }, in: { x: 0.5, y: 0.1 } },
        { y: 0, out: { x: 0.2, y: 0.9 }, in: { x: 0.5, y: 0.1 } }
      ]),
      loopTrack('head', 1800, [
        { rot: 0 }, { rot: dir === 'side' ? 2.5 : 3.5, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('armL', 1800, [
        { rot: 0 }, { rot: 2.5, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('armR', 1800, [
        { rot: 0 }, { rot: -2.5, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ])
    ]));
  }
  // 行走（3 方向）：4 组关键帧交替摆（末段由运行时隐式首帧回插闭环）
  for (const dir of ['down', 'up', 'side']) {
    const stride = dir === 'side' ? 26 : 20;
    clips.push(clip(`walk_${dir}`, 620, true, [
      loopTrack('root', 620, [
        { y: 0 }, { y: -3, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }, { y: -3, ease: 'easeInOut' }
      ]),
      loopTrack('torso', 620, [
        { rot: -2.5 }, { rot: 0, ease: 'easeInOut' }, { rot: 2.5, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('legL', 620, [
        { rot: -stride }, { rot: 0, ease: 'easeInOut' }, { rot: stride, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('legR', 620, [
        { rot: stride }, { rot: 0, ease: 'easeInOut' }, { rot: -stride, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('armL', 620, [
        { rot: stride * 0.8 }, { rot: 0, ease: 'easeInOut' }, { rot: -stride * 0.8, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('armR', 620, [
        { rot: -stride * 0.8 }, { rot: 0, ease: 'easeInOut' }, { rot: stride * 0.8, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ])
    ]));
  }
  // 跳跃：蓄力-腾空-落地（非循环）
  clips.push(clip('jump', 420, false, [
    { bone: 'root', keys: [
      { t: 0, y: 2 }, { t: 100, y: 3 }, { t: 260, y: -18, ease: 'easeInOut' }, { t: 380, y: 0, ease: 'easeInOut' }, { t: 420, y: 0 }
    ] },
    { bone: 'legL', keys: [ { t: 0, rot: 0 }, { t: 120, rot: 18 }, { t: 300, rot: 8 }, { t: 420, rot: 0 } ] },
    { bone: 'legR', keys: [ { t: 0, rot: 0 }, { t: 120, rot: -18 }, { t: 300, rot: -8 }, { t: 420, rot: 0 } ] },
    { bone: 'armL', keys: [ { t: 0, rot: 0 }, { t: 140, rot: -42 }, { t: 420, rot: 0 } ] },
    { bone: 'armR', keys: [ { t: 0, rot: 0 }, { t: 140, rot: 42 }, { t: 420, rot: 0 } ] }
  ]));
  // 攻击：右臂挥砍（非循环）
  clips.push(clip('attack', 400, false, [
    { bone: 'armR', keys: [ { t: 0, rot: -70 }, { t: 160, rot: 55, ease: 'easeInOut' }, { t: 400, rot: 0, ease: 'easeInOut' } ] },
    { bone: 'armL', keys: [ { t: 0, rot: 10 }, { t: 160, rot: -14, ease: 'easeInOut' }, { t: 400, rot: 0, ease: 'easeInOut' } ] },
    { bone: 'torso', keys: [ { t: 0, rot: -6 }, { t: 160, rot: 8, ease: 'easeInOut' }, { t: 400, rot: 0, ease: 'easeInOut' } ] },
    { bone: 'head', keys: [ { t: 0, rot: -4 }, { t: 160, rot: 6, ease: 'easeInOut' }, { t: 400, rot: 0, ease: 'easeInOut' } ] }
  ]));
  // 死亡倒下：前倾倒地（非循环）
  clips.push(clip('death', 520, false, [
    { bone: 'hips', keys: [ { t: 0, rot: 0, y: -32 }, { t: 380, rot: 85, y: -8, ease: 'easeInOut' }, { t: 520, rot: 85, y: -8 } ] },
    { bone: 'torso', keys: [ { t: 0, rot: 0 }, { t: 260, rot: 16, ease: 'easeInOut' }, { t: 380, rot: 4, ease: 'easeInOut' }, { t: 520, rot: 4 } ] },
    { bone: 'head', keys: [ { t: 0, rot: 0 }, { t: 380, rot: 14, ease: 'easeInOut' }, { t: 520, rot: 14 } ] },
    { bone: 'legL', keys: [ { t: 0, rot: 0 }, { t: 380, rot: 8, ease: 'easeInOut' }, { t: 520, rot: 8 } ] },
    { bone: 'legR', keys: [ { t: 0, rot: 0 }, { t: 380, rot: -6, ease: 'easeInOut' }, { t: 520, rot: -6 } ] },
    { bone: 'armL', keys: [ { t: 0, rot: 0 }, { t: 380, rot: 26, ease: 'easeInOut' }, { t: 520, rot: 26 } ] },
    { bone: 'armR', keys: [ { t: 0, rot: 0 }, { t: 380, rot: -26, ease: 'easeInOut' }, { t: 520, rot: -26 } ] },
    { bone: 'root', keys: [ { t: 0, y: 0 }, { t: 380, y: 2, ease: 'easeInOut' }, { t: 520, y: 2 } ] }
  ]));
  return {
    schemaVersion: 1,
    skeletonId: 'skeleton.chibi',
    meta: { width: 64, height: 96 },
    defaultClip: 'idle_down',
    bones,
    slots,
    clips
  };
}

/* ---------------- 写盘 ---------------- */

mkdirSync(IMG_DIR, { recursive: true });
for (const part of PARTS) {
  const pixels = newPixels();
  part.draw(pixels);
  const out = `${IMG_DIR}/${part.file}.png`;
  writeFileSync(out, encodePNG(pixels));
  console.log(`written: ${out} (pivot 0.5,${(part.pivotY / SIZE).toFixed(5)})`);
}

const doc = buildChibiSkeleton();
writeFileSync(`${OUT_DIR}/chibi.json`, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`written: ${OUT_DIR}/chibi.json (bones=${doc.bones.length} slots=${doc.slots.length} clips=${doc.clips.length})`);
