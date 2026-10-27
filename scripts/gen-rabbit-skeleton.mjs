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

// 程序化生成兔子骨骼资产：6 张 64×64 部件 PNG + rabbit.json + manifest 登记（幂等）。
// 纯 node（zlib 内置），可重复执行：node scripts/gen-rabbit-skeleton.mjs
// 猎物语义：无 attack 剪辑——动作 = idle（嗅探）/ hop（蹦跳移动）/ flee（狂奔）/
// hurt（挨打）/ death（侧倒）。耳骨独立（情绪表达核心：竖耳/后掠/贴背/垂地）。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const SIZE = 64;
const IMG_DIR = 'example/sanguo_zhangjiao/assets/images/rabbit/parts';
const OUT_DIR = 'example/sanguo_zhangjiao/assets/skeletons';
const MANIFEST = 'example/sanguo_zhangjiao/assets/manifests/assets.json';

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

/* ---------------- 部件绘制（64×64，野兔灰褐，侧视头朝 -x） ---------------- */

const FUR = '#9a8a74';       // 兔毛
const FUR_DARK = '#6e5f4c';  // 背部深毛
const FUR_LINE = '#4a4034';  // 描边
const FUR_BELLY = '#d8d0c0'; // 腹白
const EAR_PINK = '#d8a0a0';  // 耳内粉
const DARK = '#26201a';      // 眼/深描边

/** 身体：短圆椭圆 + 白腹 + 背深毛（骨点=体轴中心=图中心，att(0,0)） */
function drawBody(pixels) {
  fillEllipse(pixels, 32, 32, 16, 11, FUR, FUR_LINE);
  fillEllipse(pixels, 30, 37, 12, 6, FUR_BELLY);
  fillRect(pixels, 22, 23, 44, 25, FUR_DARK);
}

/** 头：圆头 + 吻 + 粉鼻（骨点=颈根(33,40)，att(-1,-8)） */
function drawHead(pixels) {
  fillEllipse(pixels, 26, 33, 11, 10, FUR, FUR_LINE);
  fillEllipse(pixels, 21, 38, 6, 4, FUR_BELLY);            // 颊白
  put(pixels, 15, 32, rgb(EAR_PINK)); put(pixels, 16, 32, rgb(EAR_PINK)); // 鼻
  put(pixels, 20, 29, rgb(DARK)); put(pixels, 20, 30, rgb(DARK));         // 眼
  put(pixels, 20, 31, rgb(DARK));
}

/** 双耳：长耳×2 侧视近叠 + 耳内粉（骨点=耳根(32,44)，att(0,-12)） */
function drawEars(pixels) {
  fillEllipse(pixels, 27, 28, 4, 13, FUR, FUR_LINE);       // 后耳（偏右）
  fillEllipse(pixels, 27, 28, 1.8, 9, EAR_PINK);
  fillEllipse(pixels, 35, 28, 4, 13, FUR, FUR_LINE);       // 前耳（偏左）
  fillEllipse(pixels, 35, 28, 1.8, 9, EAR_PINK);
  fillRect(pixels, 24, 40, 30, 43, FUR);                   // 耳根（窄条，分别贴耳）
  fillRect(pixels, 32, 40, 38, 43, FUR);
}

/** 尾：绒球（骨点=球心=图中心，att(0,0)） */
function drawTail(pixels) {
  fillEllipse(pixels, 32, 32, 6, 5.5, FUR_BELLY, FUR_LINE);
}

/** 后腿：折叠大腿 + 小腿 + 长脚掌（骨点=髋(26,19)，att(6,13)） */
function drawHindLeg(pixels) {
  fillEllipse(pixels, 27, 21, 8, 6.5, FUR, FUR_LINE);      // 大腿
  fillRect(pixels, 29, 26, 34, 37, FUR, FUR_LINE);         // 小腿
  fillRect(pixels, 27, 36, 41, 40, FUR_DARK, FUR_LINE);    // 长脚掌
}

/** 前腿：短柱 + 小脚（骨点=腿根(32,14)，att(0,18)） */
function drawForeLeg(pixels) {
  fillRect(pixels, 29, 14, 35, 30, FUR, FUR_LINE);
  fillRect(pixels, 27, 30, 37, 34, FUR_DARK, FUR_LINE);
}

const PARTS = [
  { file: 'body', draw: drawBody, pivot: [32, 32] },
  { file: 'head', draw: drawHead, pivot: [32, 32] },
  { file: 'ears', draw: drawEars, pivot: [32, 32] },
  { file: 'tail', draw: drawTail, pivot: [32, 32] },
  { file: 'leg-hind', draw: drawHindLeg, pivot: [32, 32] },
  { file: 'leg-fore', draw: drawForeLeg, pivot: [32, 32] }
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
 *   └─ body(0,-24)                        体轴中心（体椭圆 ry11 → 体底 -13）
 *      ├─ head(-12,-8)  → 世界(-12,-32)   颈根
 *      │  └─ ear(1,-8)  → 世界(-11,-40)   耳根（双耳贴图，独立耳骨做情绪）
 *      ├─ tail(18,1)    → 世界(18,-23)    尾根（绒球画在 body 上层）
 *      ├─ legHL(12,4)   → 世界(12,-20)    后左（近侧，折叠大腿+长脚掌 20px）
 *      ├─ legHR(10,4)   → 世界(10,-20)    后右（远侧）
 *      ├─ legFL(-15,8)  → 世界(-15,-16)   前左（近侧，短柱 16px）
 *      └─ legFR(-12,8)  → 世界(-12,-16)   前右（远侧）
 */
function buildRabbitDoc() {
  const bones = [
    { id: 'root', parent: null, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 12 },
    { id: 'body', parent: 'root', x: 0, y: -24, rot: 0, scaleX: 1, scaleY: 1, length: 20 },
    { id: 'head', parent: 'body', x: -12, y: -8, rot: 0, scaleX: 1, scaleY: 1, length: 16 },
    { id: 'ear', parent: 'head', x: 1, y: -8, rot: 0, scaleX: 1, scaleY: 1, length: 22 },
    { id: 'tail', parent: 'body', x: 18, y: 1, rot: 0, scaleX: 1, scaleY: 1, length: 8 },
    { id: 'legHL', parent: 'body', x: 12, y: 4, rot: 0, scaleX: 1, scaleY: 1, length: 18 },
    { id: 'legHR', parent: 'body', x: 10, y: 4, rot: 0, scaleX: 1, scaleY: 1, length: 18 },
    { id: 'legFL', parent: 'body', x: -15, y: 8, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'legFR', parent: 'body', x: -12, y: 8, rot: 0, scaleX: 1, scaleY: 1, length: 14 }
  ];
  const img = (assetId, x, y) => (
    { type: 'image', assetId, x, y, rot: 0, width: 64, height: 64, visible: true }
  );
  const slots = [
    { id: 'shadow', bone: 'root', z: 0, attachment: { type: 'empty' } },
    { id: 'legHR', bone: 'legHR', z: 2, attachment: img('rabbit.parts.leg-hind', 6, 13) },
    { id: 'legFR', bone: 'legFR', z: 2, attachment: img('rabbit.parts.leg-fore', 0, 18) },
    { id: 'bodySlot', bone: 'body', z: 3, attachment: img('rabbit.parts.body', 0, 0) },
    { id: 'tail', bone: 'tail', z: 3, attachment: img('rabbit.parts.tail', 0, 0) },
    { id: 'legHL', bone: 'legHL', z: 4, attachment: img('rabbit.parts.leg-hind', 6, 13) },
    { id: 'legFL', bone: 'legFL', z: 4, attachment: img('rabbit.parts.leg-fore', 0, 18) },
    { id: 'headSlot', bone: 'head', z: 5, attachment: img('rabbit.parts.head', -1, -8) },
    { id: 'ears', bone: 'ear', z: 6, attachment: img('rabbit.parts.ears', 0, -12) }
  ];
  const clips = [
    // 待机：嗅探张望（头慢动 + 耳微转 + 尾巴快抖 + 呼吸）
    clip('idle_side', 2600, true, [
      loopTrack('body', 2600, [
        { y: -24 }, { y: -25.2, ease: 'easeInOut' }, { y: -24, ease: 'easeInOut' }
      ]),
      loopTrack('head', 2600, [
        { rot: 0 }, { rot: 4, ease: 'easeInOut' }, { rot: 3, ease: 'easeInOut' },
        { rot: -3, ease: 'easeInOut' }, { rot: -4, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('ear', 2600, [
        { rot: 0 }, { rot: 5, ease: 'easeInOut' }, { rot: -4, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('tail', 2600, [
        { rot: -4 }, { rot: 4 }, { rot: -4 }, { rot: 4 }, { rot: -4 }, { rot: 4 }, { rot: -4 }, { rot: 4 }, { rot: -4 }
      ])
    ]),
    // 蹦跳移动：一循环一跳——后腿双蹬 + 腾空弧线 + 前腿缓冲 + 拉伸压扁（squash & stretch）
    clip('hop_side', 480, true, [
      loopTrack('root', 480, [
        { y: 0 }, { y: -12, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }, { y: 0 }
      ]),
      loopTrack('legHL', 480, [
        { rot: 10 }, { rot: -28, ease: 'easeInOut' }, { rot: 18, ease: 'easeInOut' }, { rot: 10, ease: 'easeInOut' }
      ]),
      loopTrack('legHR', 480, [
        { rot: 10 }, { rot: -28, ease: 'easeInOut' }, { rot: 18, ease: 'easeInOut' }, { rot: 10, ease: 'easeInOut' }
      ]),
      loopTrack('legFL', 480, [
        { rot: 0 }, { rot: 18, ease: 'easeInOut' }, { rot: -8, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('legFR', 480, [
        { rot: 0 }, { rot: 18, ease: 'easeInOut' }, { rot: -8, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('ear', 480, [
        { rot: 0 }, { rot: -20, ease: 'easeInOut' }, { rot: 6, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('body', 480, [
        { rot: 0, scaleX: 1, scaleY: 1 },
        { rot: -6, scaleX: 1.08, scaleY: 0.94, ease: 'easeInOut' },
        { rot: 4, scaleX: 0.94, scaleY: 1.05, ease: 'easeInOut' },
        { rot: 0, scaleX: 1, scaleY: 1, ease: 'easeInOut' }
      ])
    ]),
    // 狂奔：高频大跳 + 耳贴背 + 体前倾拉伸（循环，播速由业务侧倍速控制）
    clip('flee_side', 320, true, [
      loopTrack('root', 320, [
        { y: 0 }, { y: -16, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }, { y: 0 }
      ]),
      loopTrack('legHL', 320, [
        { rot: 12 }, { rot: -40, ease: 'easeInOut' }, { rot: 22, ease: 'easeInOut' }, { rot: 12, ease: 'easeInOut' }
      ]),
      loopTrack('legHR', 320, [
        { rot: 12 }, { rot: -40, ease: 'easeInOut' }, { rot: 22, ease: 'easeInOut' }, { rot: 12, ease: 'easeInOut' }
      ]),
      loopTrack('legFL', 320, [
        { rot: 0 }, { rot: 24, ease: 'easeInOut' }, { rot: -10, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('legFR', 320, [
        { rot: 0 }, { rot: 24, ease: 'easeInOut' }, { rot: -10, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('ear', 320, [
        { rot: -6 }, { rot: -36, ease: 'easeInOut' }, { rot: -10, ease: 'easeInOut' }, { rot: -6, ease: 'easeInOut' }
      ]),
      loopTrack('body', 320, [
        { rot: -4, scaleX: 1.02, scaleY: 1 },
        { rot: -8, scaleX: 1.12, scaleY: 0.9, ease: 'easeInOut' },
        { rot: -2, scaleX: 0.96, scaleY: 1.04, ease: 'easeInOut' },
        { rot: -4, scaleX: 1.02, scaleY: 1, ease: 'easeInOut' }
      ])
    ]),
    // 挨打：缩体后仰 + 耳炸后倒（非循环）
    clip('hurt', 260, false, [
      { bone: 'body', keys: [
        { t: 0, rot: 0, scaleX: 1, scaleY: 1 },
        { t: 90, rot: -13, scaleX: 0.92, scaleY: 1.04, ease: 'easeInOut' },
        { t: 260, rot: -3, scaleX: 1, scaleY: 1, ease: 'easeInOut' }
      ] },
      { bone: 'ear', keys: [
        { t: 0, rot: 0 }, { t: 90, rot: -30, ease: 'easeInOut' }, { t: 260, rot: -6, ease: 'easeInOut' }
      ] },
      { bone: 'head', keys: [
        { t: 0, rot: 0 }, { t: 90, rot: -9, ease: 'easeInOut' }, { t: 260, rot: -2, ease: 'easeInOut' }
      ] },
      { bone: 'root', keys: [
        { t: 0, x: 0 }, { t: 90, x: -3, ease: 'easeInOut' }, { t: 260, x: 0, ease: 'easeInOut' }
      ] },
      { bone: 'tail', keys: [
        { t: 0, rot: 0 }, { t: 90, rot: 14, ease: 'easeInOut' }, { t: 260, rot: 2, ease: 'easeInOut' }
      ] }
    ]),
    // 倒地：侧倒蹬腿 + 耳垂地（非循环）
    clip('death', 560, false, [
      { bone: 'body', keys: [
        { t: 0, rot: 0, y: -24 }, { t: 420, rot: 85, y: -8, ease: 'easeInOut' }, { t: 560, rot: 85, y: -8 }
      ] },
      { bone: 'legHL', keys: [ { t: 0, rot: 10 }, { t: 420, rot: 46, ease: 'easeInOut' }, { t: 560, rot: 46 } ] },
      { bone: 'legHR', keys: [ { t: 0, rot: 10 }, { t: 420, rot: 34, ease: 'easeInOut' }, { t: 560, rot: 34 } ] },
      { bone: 'legFL', keys: [ { t: 0, rot: 0 }, { t: 420, rot: -26, ease: 'easeInOut' }, { t: 560, rot: -26 } ] },
      { bone: 'legFR', keys: [ { t: 0, rot: 0 }, { t: 420, rot: -18, ease: 'easeInOut' }, { t: 560, rot: -18 } ] },
      { bone: 'ear', keys: [ { t: 0, rot: 0 }, { t: 420, rot: -70, ease: 'easeInOut' }, { t: 560, rot: -70 } ] },
      { bone: 'head', keys: [ { t: 0, rot: 0 }, { t: 420, rot: 12, ease: 'easeInOut' }, { t: 560, rot: 12 } ] },
      { bone: 'tail', keys: [ { t: 0, rot: 0 }, { t: 420, rot: 16, ease: 'easeInOut' }, { t: 560, rot: 16 } ] }
    ])
  ];
  return {
    schemaVersion: 1,
    skeletonId: 'skeleton.rabbit',
    meta: { width: 64, height: 72 },
    defaultClip: 'idle_side',
    bones,
    slots,
    clips
  };
}

/* ---------------- manifest 登记（幂等 upsert） ---------------- */

function upsertManifest(entries) {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (!Array.isArray(manifest.assets)) throw new Error('manifest.assets 缺失');
  const byId = new Map(manifest.assets.map(asset => [asset.assetId, asset]));
  for (const entry of entries) byId.set(entry.assetId, entry);
  manifest.assets = [...byId.values()];
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  return entries.length;
}

/* ---------------- 写盘 ---------------- */

mkdirSync(IMG_DIR, { recursive: true });
const manifestEntries = [];
for (const part of PARTS) {
  const pixels = newPixels();
  part.draw(pixels);
  const file = `${IMG_DIR}/${part.file}.png`;
  writeFileSync(file, encodePNG(pixels));
  manifestEntries.push({
    assetId: `rabbit.parts.${part.file}`,
    imageId: `rabbit.parts.${part.file}`,
    category: 'character-part',
    usage: ['rabbit-skeleton-part'],
    sourceFile: `assets/images/rabbit/parts/${part.file}.png`,
    runtime2D: { path: `assets/images/rabbit/parts/${part.file}.png`, mode: 'image' },
    runtime3D: { mode: 'billboard', sourceAssetId: `rabbit.parts.${part.file}` },
    pivot: {
      x: Number((part.pivot[0] / SIZE).toFixed(5)),
      y: Number((part.pivot[1] / SIZE).toFixed(5))
    },
    bounds: { width: SIZE, height: SIZE },
    grid: { columns: 1, rows: 1, cellWidth: SIZE, cellHeight: SIZE },
    animations: [],
    targetPhase: 'P1',
    status: 'ai-generated',
    revision: 1
  });
  console.log(`written: ${file}`);
}

const doc = buildRabbitDoc();
writeFileSync(`${OUT_DIR}/skeleton.rabbit.json`, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`written: ${OUT_DIR}/skeleton.rabbit.json (bones=${doc.bones.length} clips=${doc.clips.length})`);

// 骨骼资产 manifest 登记（幂等 upsert；编辑器资产下拉列表 = Manifest 中 runtime2D.mode==='skeleton' 的条目）
{
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (!Array.isArray(manifest.assets)) throw new Error('manifest.assets 缺失');
  const entry = {
    assetId: 'skeleton.rabbit',
    imageId: 'skeleton.rabbit',
    category: 'character-skeleton',
    usage: ['rabbit-skeleton'],
    sourceFile: 'assets/skeletons/skeleton.rabbit.json',
    runtime2D: { path: 'assets/skeletons/skeleton.rabbit.json', mode: 'skeleton' },
    runtime3D: { mode: 'billboard', sourceAssetId: 'skeleton.rabbit' },
    pivot: { x: 0.5, y: 1 },
    bounds: { width: doc.meta.width, height: doc.meta.height },
    animations: [],
    targetPhase: 'P1',
    status: 'ai-generated',
    revision: 1
  };
  const byId = new Map(manifest.assets.map(asset => [asset.assetId, asset]));
  byId.set(entry.assetId, entry);
  manifest.assets = [...byId.values()];
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('manifest upserted: skeleton.rabbit');
}
const count = upsertManifest(manifestEntries);
console.log(`manifest upserted: ${count} rabbit part entries`);
