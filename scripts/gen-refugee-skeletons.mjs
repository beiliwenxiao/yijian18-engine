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

// 程序化生成 5 个饥民骨骼资产（年幼/中年男/中年女/老年男/老年女）：
// 每角色 6 张 64×64 部件 PNG + refugee-*.json + manifest 自动登记（幂等）。
// 纯 node（zlib 内置），可重复执行：node scripts/gen-refugee-skeletons.mjs
// 要求：身高差异明显（幼童 2.4 头身 / 成人 4.7 头身 / 老人略矮佝偻）、衣服破烂
//（补丁/破洞/锯齿底摆/裸脚）、基本动作 = walk / attack / hurt / death。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const SIZE = 64;
const IMG_ROOT = 'example/sanguo_zhangjiao/assets/images';
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

/** 挖透明（锯齿底摆/破洞用）：alpha 置 0。 */
function clearRect(pixels, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      const offset = (y * SIZE + x) * 4;
      pixels[offset + 3] = 0;
    }
  }
}

/* ---------------- 部件绘制（参数化：按 cfg 的比例/配色/破烂细节） ---------------- */

const DARK = '#26201a'; // 深描边

/**
 * 头：内容宽 headW 高 headH，底边 y=54（pivot (32,54)，内容底=骨点=颈）。
 * 发型 hairStyle：child 短碎发 / short 男短发 / long 长发垂两侧 / bun 灰发髻 / sparse 老年稀疏白发。
 */
function drawHead(pixels, cfg) {
  const cx = 32;
  const bottom = 54;
  const top = bottom - cfg.headH;
  const rx = cfg.headW / 2;
  fillEllipse(pixels, cx, top + cfg.headH * 0.6, rx, cfg.headH * 0.55, cfg.skin, cfg.skinLine); // 脸
  // 发型
  if (cfg.hairStyle === 'child') {
    fillEllipse(pixels, cx, top + 5, rx + 1, 6, cfg.hair, DARK);
    put(pixels, cx - rx + 2, top + 9, rgb(cfg.hair)); put(pixels, cx + rx - 3, top + 9, rgb(cfg.hair));
  } else if (cfg.hairStyle === 'short') {
    fillEllipse(pixels, cx, top + 4, rx + 1, 5, cfg.hair, DARK);
  } else if (cfg.hairStyle === 'long') {
    fillEllipse(pixels, cx, top + 4, rx + 1, 5, cfg.hair, DARK);
    fillRect(pixels, cx - rx - 2, top + 5, cx - rx + 1, bottom - 4, cfg.hair, DARK); // 左长发
    fillRect(pixels, cx + rx - 2, top + 5, cx + rx + 1, bottom - 4, cfg.hair, DARK); // 右长发
  } else if (cfg.hairStyle === 'bun') {
    fillEllipse(pixels, cx, top + 4, rx + 1, 4, cfg.hair, DARK);
    fillEllipse(pixels, cx, top + 1, 4, 3, cfg.hair, DARK); // 发髻
  } else { // sparse 老年稀疏
    fillRect(pixels, cx - rx + 1, top + 2, cx - rx + 5, top + 5, cfg.hair, DARK);
    fillRect(pixels, cx + rx - 6, top + 2, cx + rx - 2, top + 5, cfg.hair, DARK);
    fillRect(pixels, cx - 3, top, cx + 2, top + 2, cfg.hair, DARK);
  }
  if (cfg.headscarf) { // 头巾（包住发际线）
    fillEllipse(pixels, cx, top + 4, rx + 2, 5, cfg.headscarf, DARK);
    fillRect(pixels, cx - rx - 2, top + 6, cx + rx + 1, top + 8, cfg.headscarf, DARK);
  }
  // 五官（憔悴：眼点 + 下撇嘴 + 颊凹）
  const eyeY = top + Math.floor(cfg.headH * 0.62);
  put(pixels, cx - 4, eyeY, rgb(DARK)); put(pixels, cx - 4, eyeY + 1, rgb(DARK));
  put(pixels, cx + 3, eyeY, rgb(DARK)); put(pixels, cx + 3, eyeY + 1, rgb(DARK));
  const mouthY = top + Math.floor(cfg.headH * 0.82);
  put(pixels, cx - 1, mouthY, rgb(cfg.skinLine)); put(pixels, cx, mouthY, rgb(cfg.skinLine)); put(pixels, cx + 1, mouthY, rgb(cfg.skinLine));
  put(pixels, cx - 8, eyeY + 3, rgb(cfg.skinLine)); put(pixels, cx + 7, eyeY + 3, rgb(cfg.skinLine)); // 颊凹
}

/**
 * 躯干：内容宽 torsoW 高 torsoLen，底边 y=54（pivot (32,54)，内容底=骨点=髋）。
 * 破烂：底摆锯齿 + 两块补丁 + 破洞横线 + 草绳腰；女性加裙摆（底部加宽）；
 * 老年驼背（hunched：肩背隆起弧）。
 */
function drawTorso(pixels, cfg) {
  const cx = 32;
  const bottom = 54;
  const top = bottom - cfg.torsoLen;
  const half = Math.floor(cfg.torsoW / 2);
  const skirtHalf = cfg.skirt ? half + 5 : half;
  // 衣身：上窄下宽（裙）或直筒
  for (let y = top; y <= bottom; y += 1) {
    const progress = (y - top) / Math.max(1, cfg.torsoLen);
    const width = cfg.skirt ? Math.round(half * (0.55 + progress * 0.75)) : half;
    fillRect(pixels, cx - width, y, cx + width, y, cfg.cloth, cfg.clothLine);
  }
  if (cfg.hunched) { // 驼背：背上部隆起
    fillEllipse(pixels, cx, top + 4, half, 6, cfg.cloth, cfg.clothLine);
  }
  // 草绳腰带
  fillRect(pixels, cx - skirtHalf - 1, bottom - 8, cx + skirtHalf + 1, bottom - 7, DARK);
  // 补丁两块（异色方块）
  fillRect(pixels, cx - half + 2, top + 4, cx - half + 8, top + 10, cfg.patch, DARK);
  fillRect(pixels, cx + 1, bottom - 16, cx + 8, bottom - 10, cfg.patch, DARK);
  // 破洞（深色短横线 ×2）
  fillRect(pixels, cx - half + 1, top + 13, cx - half + 5, top + 13, DARK);
  fillRect(pixels, cx + 2, top + 8, cx + 6, top + 8, DARK);
  // 底摆锯齿（去角，挖透明）
  for (let i = 0; i < 4; i += 1) {
    const segWidth = Math.ceil((skirtHalf * 2) / 4);
    const x0 = cx - skirtHalf + i * segWidth;
    if (i % 2 === 0) clearRect(pixels, x0, bottom - 2, x0 + segWidth - 1, bottom);
  }
}

/** 臂：内容宽 8 高 armLen，顶 y=6（pivot (32,6)，内容顶=骨点=肩）。破袖（袖长 60%，露肤）。 */
function drawArm(pixels, cfg) {
  const sleeveEnd = 6 + Math.floor(cfg.armLen * 0.6);
  fillRect(pixels, 28, 6, 36, sleeveEnd, cfg.cloth, DARK);
  fillRect(pixels, 28, sleeveEnd + 1, 36, 6 + cfg.armLen, cfg.skin, cfg.skinLine); // 露臂
  fillRect(pixels, 27, 6 + cfg.armLen - 3, 37, 6 + cfg.armLen - 3, DARK);          // 肘部破洞
}

/** 腿：内容宽 10 高 legLen，顶 y=6（pivot (32,6)，内容顶=骨点=髋）。膝盖补丁；裸脚或草鞋。 */
function drawLeg(pixels, cfg) {
  fillRect(pixels, 27, 6, 37, 6 + cfg.legLen - 4, cfg.pants || cfg.cloth, DARK);
  fillRect(pixels, 28, 6 + Math.floor(cfg.legLen * 0.4), 34, 6 + Math.floor(cfg.legLen * 0.4) + 4, cfg.patch, DARK); // 膝补丁
  if (cfg.barefoot) {
    fillRect(pixels, 27, 6 + cfg.legLen - 4, 37, 6 + cfg.legLen, cfg.skin, cfg.skinLine); // 裸脚
  } else {
    fillRect(pixels, 26, 6 + cfg.legLen - 4, 38, 6 + cfg.legLen, DARK, DARK); // 草鞋/破鞋
  }
}

/* ---------------- 角色配置（身高/配色/发型差异） ---------------- */

const REFUGEES = [
  {
    id: 'refugee-child', name: '年幼饥民',
    skin: '#d9b48f', skinLine: '#8a5c3a', cloth: '#6a5d4a', clothLine: '#332b20',
    patch: '#7d6b52', hair: '#2b2118', hairStyle: 'child', barefoot: true,
    hipsY: -22, torsoLen: 18, legLen: 20, armLen: 14, headH: 28, headW: 26,
    torsoW: 20, armX: 7, legX: 5, stride: 24, height: 68
  },
  {
    id: 'refugee-man', name: '中年男性饥民',
    skin: '#d0a87e', skinLine: '#8a5c3a', cloth: '#55524a', clothLine: '#2a2822',
    patch: '#6b6558', hair: '#241c14', hairStyle: 'short', barefoot: false,
    hipsY: -28, torsoLen: 26, legLen: 26, armLen: 24, headH: 22, headW: 20,
    torsoW: 26, armX: 11, legX: 6, stride: 20, height: 76
  },
  {
    id: 'refugee-woman', name: '中年女性饥民',
    skin: '#d4ac86', skinLine: '#8a5c3a', cloth: '#7a6250', clothLine: '#3a2e22',
    patch: '#8a7260', hair: '#241c14', hairStyle: 'long', headscarf: '#8a7058',
    skirt: true, barefoot: false,
    hipsY: -28, torsoLen: 26, legLen: 26, armLen: 24, headH: 22, headW: 19,
    torsoW: 24, armX: 10, legX: 5, stride: 18, height: 74
  },
  {
    id: 'refugee-elder-man', name: '老年男性饥民',
    skin: '#c9a67e', skinLine: '#7a4e30', cloth: '#5c544a', clothLine: '#2a251e',
    patch: '#6e6456', hair: '#c9c4bc', hairStyle: 'sparse', hunched: true, barefoot: false,
    hipsY: -27, torsoLen: 24, legLen: 25, armLen: 22, headH: 20, headW: 18,
    torsoW: 24, armX: 10, legX: 6, stride: 16, height: 71
  },
  {
    id: 'refugee-elder-woman', name: '老年女性饥民',
    skin: '#cda87f', skinLine: '#7a4e30', cloth: '#66605a', clothLine: '#2c2822',
    patch: '#787066', hair: '#9a958d', hairStyle: 'bun', hunched: true,
    skirt: true, barefoot: false,
    hipsY: -26, torsoLen: 24, legLen: 24, armLen: 22, headH: 20, headW: 18,
    torsoW: 22, armX: 9, legX: 5, stride: 15, height: 70
  }
];

/* ---------------- 骨骼资产（参数化，同 8 骨 humanoid rig） ---------------- */

function loopTrack(bone, durationMs, samples) {
  const keys = samples.map((value, index) => ({ t: Math.round((index / samples.length) * durationMs), ...value }));
  return { bone, keys };
}

function clip(name, durationMs, loop, tracks) {
  return { name, durationMs, loop, tracks };
}

/**
 * 骨骼树（root(0,0)=脚底中心，y 向下为正；腿骨内容顶=骨点 → 脚底=hipsY+2+legLen=0）：
 *   root └ hips(0,hipsY) ─ torso(0,0) ─ head(0,-torsoLen)
 *                           ├ armL(-armX,-torsoLen+4)  ├ armR(armX,-torsoLen+4)
 *          ├ legL(-legX,2) └ legR(legX,2)
 * 部件锚点：head/torso 内容底=骨点 → att (0,0)；arm/leg 内容顶=骨点 → att (0,0)。
 */
function buildRefugeeDoc(cfg) {
  const bones = [
    { id: 'root', parent: null, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 10 },
    { id: 'hips', parent: 'root', x: 0, y: cfg.hipsY, rot: 0, scaleX: 1, scaleY: 1, length: Math.max(10, Math.round(cfg.torsoLen * 0.6)) },
    { id: 'torso', parent: 'hips', x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: Math.max(10, cfg.torsoLen - 4) },
    { id: 'head', parent: 'torso', x: 0, y: -cfg.torsoLen, rot: 0, scaleX: 1, scaleY: 1, length: Math.max(8, Math.round(cfg.headH * 0.7)) },
    { id: 'armL', parent: 'torso', x: -cfg.armX, y: -cfg.torsoLen + 4, rot: 0, scaleX: 1, scaleY: 1, length: Math.max(8, cfg.armLen - 6) },
    { id: 'armR', parent: 'torso', x: cfg.armX, y: -cfg.torsoLen + 4, rot: 0, scaleX: 1, scaleY: 1, length: Math.max(8, cfg.armLen - 6) },
    { id: 'legL', parent: 'hips', x: -cfg.legX, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: Math.max(8, cfg.legLen - 4) },
    { id: 'legR', parent: 'hips', x: cfg.legX, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: Math.max(8, cfg.legLen - 4) }
  ];
  const img = assetId => (
    { type: 'image', assetId, x: 0, y: 0, rot: 0, width: 64, height: 64, visible: true }
  );
  const slots = [
    { id: 'shadow', bone: 'root', z: 0, attachment: { type: 'empty' } },
    { id: 'legR', bone: 'legR', z: 2, attachment: img(`${cfg.id}.parts.leg`) },
    { id: 'armL', bone: 'armL', z: 3, attachment: img(`${cfg.id}.parts.arm`) },
    { id: 'legL', bone: 'legL', z: 4, attachment: img(`${cfg.id}.parts.leg`) },
    { id: 'torsoSlot', bone: 'torso', z: 5, attachment: img(`${cfg.id}.parts.torso`) },
    { id: 'armR', bone: 'armR', z: 6, attachment: img(`${cfg.id}.parts.arm`) },
    { id: 'headFront', bone: 'head', z: 7, attachment: img(`${cfg.id}.parts.head`) }
  ];
  const stride = cfg.stride;
  const clips = [
    // 移动：4 帧对侧摆 + 起伏 + 躯干微摆
    clip('walk_side', 620, true, [
      loopTrack('root', 620, [
        { y: 0 }, { y: -2.5, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }, { y: -2.5, ease: 'easeInOut' }
      ]),
      loopTrack('torso', 620, [
        { rot: -2 }, { rot: 2, ease: 'easeInOut' }, { rot: -2, ease: 'easeInOut' }
      ]),
      loopTrack('legL', 620, [
        { rot: -stride }, { rot: 0, ease: 'easeInOut' }, { rot: stride, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('legR', 620, [
        { rot: stride }, { rot: 0, ease: 'easeInOut' }, { rot: -stride, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('armL', 620, [
        { rot: stride * 0.7 }, { rot: 0, ease: 'easeInOut' }, { rot: -stride * 0.7, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('armR', 620, [
        { rot: -stride * 0.7 }, { rot: 0, ease: 'easeInOut' }, { rot: stride * 0.7, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ])
    ]),
    // 攻击：右臂抡挥 + 躯干前顶（虚弱的挥拳）
    clip('attack_side', 340, false, [
      { bone: 'armR', keys: [
        { t: 0, rot: -55 }, { t: 150, rot: 45, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'torso', keys: [
        { t: 0, rot: -4 }, { t: 150, rot: 7, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: 8 }, { t: 150, rot: -12, ease: 'easeInOut' }, { t: 340, rot: 0, ease: 'easeInOut' }
      ] }
    ]),
    // 挨打：后仰缩肩 + 头后甩（非循环）
    clip('hurt', 260, false, [
      { bone: 'torso', keys: [
        { t: 0, rot: 0 }, { t: 90, rot: -13, ease: 'easeInOut' }, { t: 260, rot: -3, ease: 'easeInOut' }
      ] },
      { bone: 'head', keys: [
        { t: 0, rot: 0 }, { t: 90, rot: -9, ease: 'easeInOut' }, { t: 260, rot: -2, ease: 'easeInOut' }
      ] },
      { bone: 'root', keys: [
        { t: 0, x: 0 }, { t: 90, x: -3, ease: 'easeInOut' }, { t: 260, x: 0, ease: 'easeInOut' }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: 0 }, { t: 90, rot: 16, ease: 'easeInOut' }, { t: 260, rot: 4, ease: 'easeInOut' }
      ] },
      { bone: 'armR', keys: [
        { t: 0, rot: 0 }, { t: 90, rot: 16, ease: 'easeInOut' }, { t: 260, rot: 4, ease: 'easeInOut' }
      ] }
    ]),
    // 倒地：瘫倒（非循环，hips 转平 + 下沉）
    clip('death', 520, false, [
      { bone: 'hips', keys: [
        { t: 0, rot: 0, y: cfg.hipsY }, { t: 380, rot: 85, y: -8, ease: 'easeInOut' }, { t: 520, rot: 85, y: -8 }
      ] },
      { bone: 'torso', keys: [
        { t: 0, rot: 0 }, { t: 260, rot: 12, ease: 'easeInOut' }, { t: 520, rot: 4 }
      ] },
      { bone: 'head', keys: [
        { t: 0, rot: 0 }, { t: 380, rot: 12, ease: 'easeInOut' }, { t: 520, rot: 12 }
      ] },
      { bone: 'legL', keys: [
        { t: 0, rot: 0 }, { t: 380, rot: 10, ease: 'easeInOut' }, { t: 520, rot: 10 }
      ] },
      { bone: 'legR', keys: [
        { t: 0, rot: 0 }, { t: 380, rot: -8, ease: 'easeInOut' }, { t: 520, rot: -8 }
      ] },
      { bone: 'armL', keys: [
        { t: 0, rot: 0 }, { t: 380, rot: 28, ease: 'easeInOut' }, { t: 520, rot: 28 }
      ] },
      { bone: 'armR', keys: [
        { t: 0, rot: 0 }, { t: 380, rot: -28, ease: 'easeInOut' }, { t: 520, rot: -28 }
      ] }
    ])
  ];
  return {
    schemaVersion: 1,
    skeletonId: `skeleton.${cfg.id}`,
    meta: { width: 64, height: cfg.height },
    defaultClip: 'walk_side',
    bones,
    slots,
    clips
  };
}

/* ---------------- manifest 登记（幂等：按 assetId 去重） ---------------- */

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

mkdirSync(OUT_DIR, { recursive: true });
const manifestEntries = [];
for (const cfg of REFUGEES) {
  const imgDir = `${IMG_ROOT}/${cfg.id}/parts`;
  mkdirSync(imgDir, { recursive: true });
  const parts = [
    { file: 'head', draw: drawHead, pivotY: 54 },
    { file: 'torso', draw: drawTorso, pivotY: 54 },
    { file: 'arm', draw: drawArm, pivotY: 6 },
    { file: 'leg', draw: drawLeg, pivotY: 6 }
  ];
  for (const part of parts) {
    const pixels = newPixels();
    part.draw(pixels, cfg);
    const file = `${imgDir}/${part.file}.png`;
    writeFileSync(file, encodePNG(pixels));
    manifestEntries.push({
      assetId: `${cfg.id}.parts.${part.file}`,
      imageId: `${cfg.id}.parts.${part.file}`,
      category: 'character-part',
      usage: [`${cfg.id}-skeleton-part`],
      sourceFile: `assets/images/${cfg.id}/parts/${part.file}.png`,
      runtime2D: { path: `assets/images/${cfg.id}/parts/${part.file}.png`, mode: 'image' },
      runtime3D: { mode: 'billboard', sourceAssetId: `${cfg.id}.parts.${part.file}` },
      pivot: { x: 0.5, y: Number((part.pivotY / SIZE).toFixed(5)) },
      bounds: { width: SIZE, height: SIZE },
      grid: { columns: 1, rows: 1, cellWidth: SIZE, cellHeight: SIZE },
      animations: [],
      targetPhase: 'P1',
      status: 'ai-generated',
      revision: 1
    });
  }
  const doc = buildRefugeeDoc(cfg);
  const outFile = `${OUT_DIR}/${cfg.id}.json`;
  writeFileSync(outFile, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`written: ${outFile} (bones=${doc.bones.length} clips=${doc.clips.length} height=${cfg.height})`);
}
const count = upsertManifest(manifestEntries);
console.log(`manifest upserted: ${count} entries (total ${manifestEntries.length} refugee parts)`);
