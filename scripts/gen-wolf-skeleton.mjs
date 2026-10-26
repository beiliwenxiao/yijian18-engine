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

// 程序化生成带部件化骨骼 rig 的狼：5 张 64×64 部件 PNG + wolf.json。
// 纯 node（zlib 内置），可重复执行：node scripts/gen-wolf-skeleton.mjs
// 形态：侧视灰狼（头朝 -x），体长 ~52px、肩高 ~40px；四足 trot 步态。
// 与 wolf-demo.json（整图 sequence 帧表）不同：本资产是真正的多部件骨骼动画。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const SIZE = 64;
const IMG_DIR = 'example/sanguo_zhangjiao/assets/images/wolf/parts';
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

const rgb = hex => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16)
];

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

/* ---------------- 部件绘制（64×64，灰狼） ---------------- */

const FUR = '#8a8a92';        // 灰毛
const FUR_DARK = '#5a5a64';   // 背部深毛
const FUR_LINE = '#3a3a42';   // 描边
const FUR_BELLY = '#c8c8d0';  // 腹部浅毛
const CLAW = '#26262e';       // 爪/鼻

/** 躯干：水平椭圆 + 白腹 + 背部深毛（内容 x6~58 y21~43；骨点=体轴中心，pivot 图中心） */
function drawBody(pixels) {
  fillEllipse(pixels, 32, 32, 26, 11, FUR, FUR_LINE);
  fillEllipse(pixels, 32, 36, 22, 6, FUR_BELLY);              // 白腹
  fillRect(pixels, 14, 24, 44, 26, FUR_DARK);                 // 背部鬃毛
  fillEllipse(pixels, 10, 30, 5, 8, FUR, FUR_LINE);           // 胸前
}

/** 头：吻尖 + 立耳（内容 x28~58 y20~44；骨点=颈根(34,42)，吻朝 -x） */
function drawHead(pixels) {
  fillEllipse(pixels, 42, 32, 9, 8, FUR, FUR_LINE);           // 头颅
  fillRect(pixels, 28, 29, 38, 36, FUR, FUR_LINE);            // 吻部
  fillRect(pixels, 26, 31, 30, 34, FUR_DARK);                 // 鼻尖
  put(pixels, 25, 32, rgb(CLAW)); put(pixels, 25, 33, rgb(CLAW)); // 鼻
  put(pixels, 44, 30, rgb(CLAW)); put(pixels, 44, 31, rgb(CLAW)); // 眼
  // 双耳（三角，逐像素）
  for (let i = 0; i < 5; i += 1) {
    fillRect(pixels, 44 + i, 22 + i, 45 + i, 22 + i, FUR_DARK, FUR_LINE);
    fillRect(pixels, 48 + i, 22 + i, 49 + i, 22 + i, FUR_DARK, FUR_LINE);
  }
  fillEllipse(pixels, 33, 35, 6, 3, FUR_BELLY);               // 下颌浅毛
}

/** 尾：弯月上翘（内容 x36~58 y24~40；骨点=尾根(36,32)，向 +x 延伸） */
function drawTail(pixels) {
  fillEllipse(pixels, 45, 33, 10, 4, FUR, FUR_LINE);
  fillEllipse(pixels, 54, 29, 5, 5, FUR, FUR_LINE);           // 尾尖上翘
  put(pixels, 56, 26, rgb(FUR_BELLY)); put(pixels, 55, 27, rgb(FUR_BELLY)); // 尾尖白毛
}

/** 前腿：直腿 + 爪（内容 x28~36 y4~32；骨点=腿根(32,4)） */
function drawForeLeg(pixels) {
  fillRect(pixels, 28, 6, 36, 26, FUR, FUR_LINE);
  fillRect(pixels, 28, 26, 36, 30, CLAW);                     // 爪
}

/** 后腿：大腿粗壮 + 爪（内容 x26~38 y4~32；骨点=腿根(32,4)） */
function drawHindLeg(pixels) {
  fillEllipse(pixels, 32, 12, 7, 8, FUR, FUR_LINE);           // 大腿
  fillRect(pixels, 28, 16, 36, 26, FUR, FUR_LINE);            // 小腿
  fillRect(pixels, 28, 26, 36, 30, CLAW);                     // 爪
}

const PARTS = [
  { file: 'body', draw: drawBody, pivot: [32, 32] },
  { file: 'head', draw: drawHead, pivot: [34, 42] },
  { file: 'tail', draw: drawTail, pivot: [36, 32] },
  { file: 'fore-leg', draw: drawForeLeg, pivot: [32, 4] },
  { file: 'hind-leg', draw: drawHindLeg, pivot: [32, 4] }
];

/* ---------------- 骨骼资产 ---------------- */

function loopTrack(bone, durationMs, samples) {
  const keys = samples.map((value, index) => ({ t: Math.round((index / samples.length) * durationMs), ...value }));
  return { bone, keys };
}

function clip(name, durationMs, loop, tracks) {
  return { name, durationMs, loop, tracks };
}

/* 骨骼树（root(0,0)=脚底中心，y 向下为正；头朝 -x）：
 *   root(0,0)
 *   └─ body(0,-30)                        体轴中心（躯干椭圆 rx26 ry11 → 体 x-26~26 y-19~-41）
 *      ├─ head(-32,2)   → 世界(-32,-28)   颈根（头向 -x 前伸，内容 -60~-36）
 *      ├─ tail(28,0)    → 世界(28,-30)    尾根（尾向 +x 延伸 22px）
 *      ├─ legFL(-24,2)  → 世界(-24,-28)   前左（近侧，腿 28px → 脚底 0）
 *      ├─ legFR(-19,2)  → 世界(-19,-28)   前右（远侧，x 略偏制造纵深）
 *      ├─ legHL(24,2)   → 世界(24,-28)    后左（近侧）
 *      └─ legHR(19,2)   → 世界(19,-28)    后右（远侧）
 * 附件偏移 att = (32-px, 32-py)，锚点像素 = 骨点。
 */
function buildWolfSkeleton() {
  const bones = [
    { id: 'root', parent: null, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 16 },
    { id: 'body', parent: 'root', x: 0, y: -30, rot: 0, scaleX: 1, scaleY: 1, length: 26 },
    { id: 'head', parent: 'body', x: -32, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: 18 },
    { id: 'tail', parent: 'body', x: 28, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'legFL', parent: 'body', x: -24, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: 24 },
    { id: 'legFR', parent: 'body', x: -19, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: 24 },
    { id: 'legHL', parent: 'body', x: 24, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: 24 },
    { id: 'legHR', parent: 'body', x: 19, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: 24 }
  ];
  const img = (assetId, x, y) => (
    { type: 'image', assetId, x, y, rot: 0, width: 64, height: 64, visible: true }
  );
  const slots = [
    { id: 'shadow', bone: 'root', z: 0, attachment: { type: 'empty' } },
    { id: 'tail', bone: 'tail', z: 1, attachment: img('wolf.parts.tail', -4, 0) },
    { id: 'legFR', bone: 'legFR', z: 2, attachment: img('wolf.parts.fore-leg', 0, 28) },
    { id: 'legHL', bone: 'legHL', z: 2, attachment: img('wolf.parts.hind-leg', 0, 28) },
    { id: 'bodySlot', bone: 'body', z: 3, attachment: img('wolf.parts.body', 0, 0) },
    { id: 'legFL', bone: 'legFL', z: 4, attachment: img('wolf.parts.fore-leg', 0, 28) },
    { id: 'legHR', bone: 'legHR', z: 4, attachment: img('wolf.parts.hind-leg', 0, 28) },
    { id: 'headSlot', bone: 'head', z: 5, attachment: img('wolf.parts.head', -2, -10) }
  ];
  const clips = [];
  // 待机：呼吸起伏 + 尾巴摇摆 + 头微抬
  clips.push(clip('idle_side', 2000, true, [
    loopTrack('body', 2000, [
      { y: -30 }, { y: -31.5, ease: 'easeInOut' }, { y: -30, ease: 'easeInOut' }
    ]),
    loopTrack('tail', 2000, [
      { rot: -8 }, { rot: 8, ease: 'easeInOut' }, { rot: -8, ease: 'easeInOut' }
    ]),
    loopTrack('head', 2000, [
      { rot: 0 }, { rot: -4, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
    ])
  ]));
  // 行走：trot 对角步态（FL+HR 同组、FR+HL 反相）+ 体起伏 + 尾摆
  clips.push(clip('walk_side', 560, true, [
    loopTrack('root', 560, [
      { y: 0 }, { y: -2.5, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }, { y: -2.5, ease: 'easeInOut' }
    ]),
    loopTrack('legFL', 560, [
      { rot: -20 }, { rot: 0, ease: 'easeInOut' }, { rot: 20, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
    ]),
    loopTrack('legHR', 560, [
      { rot: -20 }, { rot: 0, ease: 'easeInOut' }, { rot: 20, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
    ]),
    loopTrack('legFR', 560, [
      { rot: 20 }, { rot: 0, ease: 'easeInOut' }, { rot: -20, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
    ]),
    loopTrack('legHL', 560, [
      { rot: 20 }, { rot: 0, ease: 'easeInOut' }, { rot: -20, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
    ]),
    loopTrack('body', 560, [
      { rot: -2 }, { rot: 2, ease: 'easeInOut' }, { rot: -2, ease: 'easeInOut' }
    ]),
    loopTrack('tail', 560, [
      { rot: -6 }, { rot: 6, ease: 'easeInOut' }, { rot: -6, ease: 'easeInOut' }
    ])
  ]));
  // 奔跑：步幅加大 + 腾空（非循环单段，业务可 loop 播放）
  clips.push(clip('run_side', 420, true, [
    loopTrack('root', 420, [
      { y: 0 }, { y: -6, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }, { y: -6, ease: 'easeInOut' }
    ]),
    loopTrack('legFL', 420, [
      { rot: -34 }, { rot: 10, ease: 'easeInOut' }, { rot: 34, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
    ]),
    loopTrack('legHR', 420, [
      { rot: -34 }, { rot: 10, ease: 'easeInOut' }, { rot: 34, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
    ]),
    loopTrack('legFR', 420, [
      { rot: 34 }, { rot: -10, ease: 'easeInOut' }, { rot: -34, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
    ]),
    loopTrack('legHL', 420, [
      { rot: 34 }, { rot: -10, ease: 'easeInOut' }, { rot: -34, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
    ]),
    loopTrack('body', 420, [
      { rot: -4 }, { rot: 4, ease: 'easeInOut' }, { rot: -4, ease: 'easeInOut' }
    ]),
    loopTrack('head', 420, [
      { rot: 3 }, { rot: -3, ease: 'easeInOut' }, { rot: 3, ease: 'easeInOut' }
    ]),
    loopTrack('tail', 420, [
      { rot: 12 }, { rot: -8, ease: 'easeInOut' }, { rot: 12, ease: 'easeInOut' }
    ])
  ]));
  // 扑咬攻击：蓄力后仰 → 前扑下咬（非循环）
  clips.push(clip('attack_side', 480, false, [
    { bone: 'body', keys: [
      { t: 0, rot: 0, x: 0 }, { t: 140, rot: 6, x: 4, ease: 'easeInOut' },
      { t: 280, rot: -8, x: -10, ease: 'easeInOut' }, { t: 480, rot: 0, x: 0, ease: 'easeInOut' }
    ] },
    { bone: 'head', keys: [
      { t: 0, rot: 0 }, { t: 140, rot: 8 }, { t: 280, rot: 18, ease: 'easeInOut' }, { t: 480, rot: 0, ease: 'easeInOut' }
    ] },
    { bone: 'legFL', keys: [
      { t: 0, rot: 0 }, { t: 140, rot: 14 }, { t: 280, rot: -30, ease: 'easeInOut' }, { t: 480, rot: 0, ease: 'easeInOut' }
    ] },
    { bone: 'legFR', keys: [
      { t: 0, rot: 0 }, { t: 140, rot: 14 }, { t: 280, rot: -24, ease: 'easeInOut' }, { t: 480, rot: 0, ease: 'easeInOut' }
    ] },
    { bone: 'tail', keys: [
      { t: 0, rot: 0 }, { t: 280, rot: -16, ease: 'easeInOut' }, { t: 480, rot: 0, ease: 'easeInOut' }
    ] }
  ]));
  // 死亡：侧倒（非循环）
  clips.push(clip('death', 560, false, [
    { bone: 'body', keys: [
      { t: 0, rot: 0, y: -30 }, { t: 420, rot: 0, y: -10, ease: 'easeInOut' }, { t: 560, rot: 0, y: -10 }
    ] },
    { bone: 'head', keys: [
      { t: 0, rot: 0 }, { t: 420, rot: 16, ease: 'easeInOut' }, { t: 560, rot: 16 }
    ] },
    { bone: 'legFL', keys: [
      { t: 0, rot: 0 }, { t: 420, rot: 40, ease: 'easeInOut' }, { t: 560, rot: 40 }
    ] },
    { bone: 'legFR', keys: [
      { t: 0, rot: 0 }, { t: 420, rot: 28, ease: 'easeInOut' }, { t: 560, rot: 28 }
    ] },
    { bone: 'legHL', keys: [
      { t: 0, rot: 0 }, { t: 420, rot: 34, ease: 'easeInOut' }, { t: 560, rot: 34 }
    ] },
    { bone: 'legHR', keys: [
      { t: 0, rot: 0 }, { t: 420, rot: 22, ease: 'easeInOut' }, { t: 560, rot: 22 }
    ] },
    { bone: 'tail', keys: [
      { t: 0, rot: 0 }, { t: 420, rot: 24, ease: 'easeInOut' }, { t: 560, rot: 24 }
    ] }
  ]));
  return {
    schemaVersion: 1,
    skeletonId: 'skeleton.wolf',
    meta: { width: 96, height: 64 },
    defaultClip: 'idle_side',
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
  console.log(`written: ${out} (pivot ${part.pivot[0] / SIZE},${part.pivot[1] / SIZE})`);
}

const doc = buildWolfSkeleton();
writeFileSync(`${OUT_DIR}/wolf.json`, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`written: ${OUT_DIR}/wolf.json (bones=${doc.bones.length} slots=${doc.slots.length} clips=${doc.clips.length})`);
