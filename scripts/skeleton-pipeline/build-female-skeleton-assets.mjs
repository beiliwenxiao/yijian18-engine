/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * build-female-skeleton-assets.mjs —— 由 Female Hero 站立帧切片出 7 头身骨骼版角色（路线 A）。
 *
 * ## 原理：按骨骼分区切片，静止姿态像素级还原
 *   1. 取 Stand/south（正）、Stand/east（侧）、Stand/north（背）三张站立帧；
 *   2. 逐像素归到「最近骨段」→ 每个部位拿到一块像素；
 *   3. 每个部位的挂点 = 该块内容中心相对骨起点的偏移（换算成骨骼单位）；
 *   4. 骨骼静止姿态下所有块拼回原图，动画时各块绕各自关节转动。
 *   规则：颈线以上一律归头（马尾/发冠离头骨线很远，按最近段会误判）。
 *   侧视两腿/双臂在画面里重叠，只切一套（R），L 复用同一份切片。
 *   分区前先擦除原图左髋的剑鞘/皮袋（见 SCABBARD_ERASE）：最近邻分区会把它误归入手臂切片，
 *   摆臂时整条甩出（装备表现由 weapon-sword-waist/weapon-shield 槽承担）。
 *
 * ## 产物
 *   assets/images/player/female/parts.png    部件图集（正/侧/背 三套切片）
 *   assets/skeletons/player-female.json      16 骨女性骨架（directionOffsets 按形态换切片）
 *
 * 剪辑数据来源：player.json（同拓扑），只保留 rot；四肢 x/y 布局归新骨架的 rest，
 * 腿部按「脚贴地 + 整腿平移抬脚」重算（与 rebuild-player-legs.mjs 同款模型）。
 *
 * 用法：node scripts/skeleton-pipeline/build-female-skeleton-assets.mjs
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { partitionSheet, packBlocks, composeAtlasPixels } from './lib/sheet-partition.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = 'D:/游戏资源/Female_Hero_Pixel_Art_v1.1/Stand';
const NOUNCE = path.join(root, 'example/sanguo_zhangjiao');
const OUT_ATLAS = path.join(NOUNCE, 'assets/images/player/female/parts.png');
const OUT_SKELETON = path.join(NOUNCE, 'assets/skeletons/player-female.json');
const BASE_SKELETON = path.join(NOUNCE, 'assets/skeletons/player.json');
const SKELETON_ID = 'skeleton.player-female';
const ATLAS_ID = 'player.female.parts';

const GROUND_Y = 272;
const CENTER_X = 159;
const PX_PER_UNIT = 2.18;      // 角色高 218px ↔ 100 骨骼单位（7 头身）

const toUnitY = py => (py - GROUND_Y) / PX_PER_UNIT;
const toUnitX = px => (px - CENTER_X) / PX_PER_UNIT;

/** 8 个形态对应的站立帧文件。sideL=左侧面（西），与右侧面（东）各自独立，彻底不靠镜像。 */
const FORM_FILES = {
  down: 'south.png', side: 'east.png', sideL: 'west.png', up: 'north.png',
  SE: 'south-east.png', SW: 'south-west.png', NE: 'north-east.png', NW: 'north-west.png'
};
const FORM_KEYS = Object.keys(FORM_FILES);

/** 各形态轮廓 bbox 中心 x（实测，供镜像派生形态换算）。 */
const CENTER = {};
for (const [form, file] of Object.entries(FORM_FILES)) {
  const { data, info } = await sharp(path.join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = 1e9, maxX = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] < 16) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  CENTER[form] = (minX + maxX) / 2;
}

/** 直接量测得到的五个形态关键点（正/右/背/斜前右/斜后右）；其余三向由镜像派生。 */
const BASE_JOINTS = {
  down: {
    headTop: [159, 54], neck: [159, 88],
    chest: [159, 112], waist: [159, 142], hip: [159, 168],
    shoulderR: [127.5, 96], elbowR: [127.5, 150], wristR: [127.5, 192],
    shoulderL: [191, 96], elbowL: [191, 150], wristL: [191, 192],
    hipR: [143.5, 168], kneeR: [143.5, 211], ankleR: [143.5, 259], toeR: [143.5, 272],
    hipL: [174.5, 168], kneeL: [174.5, 211], ankleL: [174.5, 259], toeL: [174.5, 272]
  },
  side: {
    headTop: [165, 52], neck: [165, 86],
    chest: [165, 110], waist: [165, 140], hip: [165, 166],
    shoulderR: [178, 94], elbowR: [178, 148], wristR: [178, 190],
    shoulderL: [178, 94], elbowL: [178, 148], wristL: [178, 190],
    hipR: [166, 166], kneeR: [166, 212], ankleR: [166, 258], toeR: [166, 272],
    hipL: [166, 166], kneeL: [166, 212], ankleL: [166, 258], toeL: [166, 272]
  },
  up: {
    headTop: [159, 56], neck: [159, 90],
    chest: [159, 114], waist: [159, 144], hip: [159, 170],
    shoulderR: [192, 98], elbowR: [192, 152], wristR: [192, 194],
    shoulderL: [127, 98], elbowL: [127, 152], wristL: [127, 194],
    hipR: [174.5, 170], kneeR: [174.5, 213], ankleR: [174.5, 261], toeR: [174.5, 272],
    hipL: [143.5, 170], kneeL: [143.5, 213], ankleL: [143.5, 261], toeL: [143.5, 272]
  },
  SE: {
    headTop: [162, 50], neck: [162, 88],
    chest: [162, 112], waist: [162, 142], hip: [162, 170],
    shoulderR: [139, 96], elbowR: [137, 150], wristR: [136, 192],
    shoulderL: [184, 96], elbowL: [187, 150], wristL: [190, 192],
    hipR: [146, 170], kneeR: [145, 213], ankleR: [143, 259], toeR: [143, 272],
    hipL: [173, 170], kneeL: [175, 213], ankleL: [181, 259], toeL: [181, 272]
  },
  NE: {
    headTop: [161, 54], neck: [161, 90],
    chest: [161, 114], waist: [161, 144], hip: [161, 172],
    shoulderR: [140, 98], elbowR: [140, 152], wristR: [141, 194],
    shoulderL: [183, 98], elbowL: [184, 152], wristL: [185, 194],
    hipR: [146, 172], kneeR: [146, 214], ankleR: [145, 260], toeR: [145, 272],
    hipL: [172, 172], kneeL: [174, 214], ankleL: [178, 260], toeL: [178, 272]
  }
};

/** 以目标形态自身的轮廓中心为镜轴，把来源形态的关键点水平镜像过去。 */
function mirrorJoints(src, target) {
  const sum = CENTER[target] + CENTER[src];
  const out = {};
  for (const [k, [x, y]] of Object.entries(BASE_JOINTS[src])) out[k] = [sum - x, y];
  return out;
}

const JOINTS = {
  ...BASE_JOINTS,
  sideL: mirrorJoints('side', 'sideL'),
  SW: mirrorJoints('SE', 'SW'),
  NW: mirrorJoints('NE', 'NW')
};

/** 侧视（含左侧面）四肢在画面里重叠：L 复用 R 的切片与偏移。 */
const SHARED_LIMBS = {
  down: false, side: true, sideL: true, up: false,
  SE: false, SW: false, NE: false, NW: false
};

const PART_BONE = {
  headAll: 'head', chestAll: 'chest', waistAll: 'spine',
  upperArmR: 'upperArmR', forearmR: 'forearmR',
  upperArmL: 'upperArmL', forearmL: 'forearmL',
  thighR: 'thighR', shinR: 'shinR', footR: 'footR',
  thighL: 'thighL', shinL: 'shinL', footL: 'footL'
};

function segmentsOf(j) {
  const S = (a, b) => [a, b];
  return {
    headAll: S(j.neck, j.headTop),
    chestAll: S(j.chest, j.waist),
    waistAll: S(j.waist, j.hip),
    upperArmR: S(j.shoulderR, j.elbowR), forearmR: S(j.elbowR, j.wristR),
    upperArmL: S(j.shoulderL, j.elbowL), forearmL: S(j.elbowL, j.wristL),
    thighR: S(j.hipR, j.kneeR), shinR: S(j.kneeR, j.ankleR), footR: S(j.ankleR, j.toeR),
    thighL: S(j.hipL, j.kneeL), shinL: S(j.kneeL, j.ankleL), footL: S(j.ankleL, j.toeL)
  };
}

/* ---------------- 0.5 剑鞘/皮袋擦除（2026-10-26 实机验证「异常绑定图」修复） ----------------
 * 美术站立帧髋部挂有剑鞘/皮袋（皮革棕）。最近邻分区时这些像素被误归入手臂切片
 * （upperArmL/forearmL），摆臂时整条鞘被甩出体外。装备表现由 weapon-sword-waist /
 * weapon-shield 槽承担（PlayerSkeletonStateMapper 联动），原图混画属于重复——
 * 分区前按「矩形 + 皮革色判定」把鞘从原图擦除（矩形限域防止误伤腰带/头发/裙摆，
 * 蓝甲 B / 银甲 S / 亮金 G / 高亮发色 H 均不在判定区间）。
 * 矩形按 8 张站立帧逐一标定（diag-color-map/diag-arm-crops 两个标定脚本可复核）。
 * up 视角的袋子落在躯干切片（随腰微动、不甩臂）——保留不擦。
 */
const SCABBARD_ERASE = {
  down:  { rect: [177, 147, 200, 170], test: 'brown' },  // 左髋皮袋 + 带尾流苏（x184-198 y152-165）
  SE:    { rect: [177, 136, 194, 168], test: 'brown' },  // 皮袋带体 x178-190 y143-152 + 垂带 x189-192
  side:  { rect: [171, 141, 184, 149], test: 'navy' },   // 剑鞘上端残段（主体经 forearm 重定向不再绘制；金扣 x≤170 在判定外）
  NE:    { rect: [171, 155, 193, 181], test: 'brown' },  // 背斜视皮袋 x174-186 y160-178
  NW:    { rect: [126, 157, 142, 176], test: 'brown' },  // NE 镜像
  sideL: { rect: [138, 141, 151, 147], test: 'brown' },  // side 镜像（剑带残段；圆扣 y≥148 在判定外）
  SW:    { rect: [146, 136, 158, 168], test: 'brown' }   // SE 镜像（亮金高光 r>195 判定外，残留读作腰带饰扣）
};
/** 色判定：brown=皮革棕（暖棕 r>g>b）；navy=深钢蓝剑鞘/金边（b−r≥10 或金 trim）——
 * 正/斜视的腰甲、腰带与侧视金扣都是中性/暖色，均不命中。 */
const SCABBARD_TESTS = {
  brown: (r, g, b) => r > g && g > b && r - b >= 12 && r >= 30 && r <= 200 && b <= 150,
  navy: (r, g, b) => (b - r >= 10 && b >= 30) || (r > 150 && g > 100 && b < 130 && r - b > 60)
};

function eraseScabbard(data, info, form) {
  const cfg = SCABBARD_ERASE[form];
  if (!cfg) return;
  const [x0, y0, x1, y1] = cfg.rect;
  const test = SCABBARD_TESTS[cfg.test];
  let erased = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] === 0) continue;
      if (test(data[i], data[i + 1], data[i + 2])) {
        data[i + 3] = 0;
        erased++;
      }
    }
  }
  if (erased === 0) console.warn(`[scabbard] ${form}: 矩形内未擦除任何像素，请校准 SCABBARD_ERASE`);
  else console.log(`[scabbard] ${form}: 擦除 ${erased} px`);
}

/* ---------------- 1. 分区切片（复用 sheet-partition 纯函数库） ---------------- */
const pieces = {};   // `${part}|${form}` -> { px, w, h, x0, y0 }
for (const [form, file] of Object.entries(FORM_FILES)) {
  const { data, info } = await sharp(path.join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  eraseScabbard(data, info, form);
  const segs = segmentsOf(JOINTS[form]);
  const parts = SHARED_LIMBS[form]
    ? Object.keys(segs).filter(n => !/L$/.test(n))
    : Object.keys(segs);
  // 骨段坐标从「关节对」转成库要求的 { key, a, b } 形态
  const segments = parts.map(part => ({
    key: part,
    a: { x: segs[part][0][0], y: segs[part][0][1] },
    b: { x: segs[part][1][0], y: segs[part][1][1] }
  }));
  const partitioned = partitionSheet({
    pixels: { data, width: info.width, height: info.height },
    segments,
    headCutoffY: JOINTS[form].neck[1],
    headKey: 'headAll',
    atlasWidth: 512,
    pad: 2
  });
  for (const block of partitioned.blocks) {
    const emit = (name) => {
      pieces[`${name}|${form}`] = { buf: block.pixels, w: block.w, h: block.h, x0: block.x, y0: block.y };
    };
    emit(block.key);
    // 共享四肢：L 部位写一份同内容
    if (SHARED_LIMBS[form] && /R$/.test(block.key)) emit(block.key.replace(/R$/, 'L'));
  }
}

// 斜向视野里被近侧腿遮挡的远脚只切到 2~3px 高的碎条（渲染成漂浮碎片）：置空不再绘制
const SLIVER_ZERO = new Set(['footL|SE', 'footR|NE', 'footR|NW']);
for (const key of SLIVER_ZERO) {
  const p = pieces[key];
  if (p) p.buf.fill(0);
}

/* ---------------- 2. 打包图集（复用 sheet-partition 的 packBlocks / composeAtlasPixels） ---------------- */
const SHEET_W = 512;
const PAD = 2;
const order = Object.keys(pieces).sort();
const allBlocks = order.map(key => {
  const p = pieces[key];
  return { key, w: p.w, h: p.h, pixels: p.buf };
});
const packed = packBlocks(allBlocks, { atlasWidth: SHEET_W, pad: PAD });
const SHEET_H = packed.atlas.height;
const sheet = composeAtlasPixels(allBlocks, packed.atlas);
const placements = new Map(packed.atlas.placements.map(placement => [placement.key, placement]));
for (const key of order) {
  const p = pieces[key];
  const placement = placements.get(key);
  p.sx = placement.sx;
  p.sy = placement.sy;
}
mkdirSync(path.dirname(OUT_ATLAS), { recursive: true });
await sharp(sheet, { raw: { width: packed.atlas.width, height: SHEET_H, channels: 4 } })
  .png({ compressionLevel: 9 }).toFile(OUT_ATLAS);
console.log(`部件图集：${packed.atlas.width}×${SHEET_H}，${order.length} 块 → ${path.relative(root, OUT_ATLAS)}`);

/* ---------------- 3.5 武器部件图（刀 / 盾） ----------------
 * ⚠️ 2026-10-26 起 sword.png / shield.png 已替换为 AI 生成像素图（美术资源），
 *    重跑本脚本会用下方的程序化绘制覆盖它们——如需保留美术图，重跑后请用 git 恢复：
 *    git checkout HEAD -- example/sanguo_zhangjiao/assets/images/player/female/sword.png
 *                                              .../shield.png
 * 素材包没有独立武器图，按女骑士配色（钢蓝 #9aa4b4 / 深蓝 #4a5262 / 金 #c9963c / 皮革 #6b4a2f）程序化绘制。
 * 画布 64×64，握把在画布中心：挂到 forearmR/forearmL 后刀柄正落在手上。
 * 刀槽 id `weapon-sword` / 盾槽 id `weapon-shield` 均由 PlayerSkeletonStateMapper 按装备联动管理：
 * 刀跟主手/背包（战斗拔出、非战斗回背腰挂），盾跟副手（战斗持握、非战斗背挂）。
 */
const SWORD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
  <g shape-rendering="crispEdges">
    <rect x="30" y="30" width="4" height="16" fill="#6b4a2f"/>
    <rect x="30" y="30" width="2" height="16" fill="#8a6440"/>
    <circle cx="32" cy="47" r="3" fill="#c9963c"/>
    <rect x="23" y="27" width="18" height="4" fill="#c9963c"/>
    <rect x="23" y="27" width="18" height="2" fill="#f0c060"/>
    <polygon points="29,27 35,27 33,3 31,3" fill="#9aa4b4"/>
    <polygon points="29,27 32,27 32,3 31,3" fill="#cfd6e2"/>
    <rect x="31.4" y="6" width="1.2" height="20" fill="#6d7789"/>
  </g>
</svg>`;
const SHIELD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="56">
  <g shape-rendering="crispEdges">
    <path d="M4 5 L44 5 L44 28 Q24 54 4 28 Z" fill="#4a5262" stroke="#c9963c" stroke-width="3"/>
    <path d="M8 9 L40 9 L40 27 Q24 48 8 27 Z" fill="#7f8aa0"/>
    <path d="M8 9 L24 9 L24 44 Q14 39 8 27 Z" fill="#9aa4b4"/>
    <rect x="21" y="12" width="6" height="26" fill="#c9963c"/>
    <rect x="12" y="20" width="24" height="6" fill="#c9963c"/>
    <circle cx="24" cy="22" r="5" fill="#f0c060" stroke="#8a6a20" stroke-width="1.5"/>
  </g>
</svg>`;
mkdirSync(path.dirname(path.join(NOUNCE, 'assets/images/player/female/weapon.png')), { recursive: true });
await sharp(Buffer.from(SWORD_SVG)).png().toFile(path.join(NOUNCE, 'assets/images/player/female/sword.png'));
await sharp(Buffer.from(SHIELD_SVG)).png().toFile(path.join(NOUNCE, 'assets/images/player/female/shield.png'));

/* ---------------- 4. 骨架（由正视关节换算） ---------------- */
const J = JOINTS.down;
const U = (px, py) => [toUnitX(px), toUnitY(py)];
const r2 = v => Math.round(v * 100) / 100;
const hipsY = toUnitY(J.hip[1]);
const spineY = toUnitY(J.waist[1]) - hipsY;
const chestY = toUnitY(J.chest[1]) - toUnitY(J.waist[1]);
const neckY = toUnitY(J.neck[1]) - toUnitY(J.chest[1]);
const shX_R = toUnitX(J.shoulderR[0]);
const shX_L = toUnitX(J.shoulderL[0]);
const shY = toUnitY(J.shoulderR[1]) - toUnitY(J.chest[1]);
const upperArmLen = toUnitY(J.elbowR[1]) - toUnitY(J.shoulderR[1]);
const forearmLen = toUnitY(J.wristR[1]) - toUnitY(J.elbowR[1]);
const hipX_R = toUnitX(J.hipR[0]);
const hipX_L = toUnitX(J.hipL[0]);
const thighLen = toUnitY(J.kneeR[1]) - toUnitY(J.hipR[1]);
const shinLen = toUnitY(J.ankleR[1]) - toUnitY(J.kneeR[1]);

const bones = [
  { id: 'hips', parent: null, x: 0, y: r2(hipsY), rot: 0, scaleX: 1, scaleY: 1, length: 10 },
  { id: 'spine', parent: 'hips', x: 0, y: r2(spineY), rot: 0, scaleX: 1, scaleY: 1, length: 10 },
  { id: 'chest', parent: 'spine', x: 0, y: r2(chestY), rot: 0, scaleX: 1, scaleY: 1, length: 8 },
  { id: 'neck', parent: 'chest', x: 0, y: r2(neckY), rot: 0, scaleX: 1, scaleY: 1, length: 3 },
  { id: 'head', parent: 'neck', x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: r2(toUnitY(J.headTop[1]) - toUnitY(J.neck[1])) },
  { id: 'upperArmR', parent: 'chest', x: r2(shX_R), y: r2(shY), rot: 0, scaleX: 1, scaleY: 1, length: r2(upperArmLen) },
  { id: 'upperArmL', parent: 'chest', x: r2(shX_L), y: r2(shY), rot: 0, scaleX: 1, scaleY: 1, length: r2(upperArmLen) },
  { id: 'forearmR', parent: 'upperArmR', x: 0, y: r2(upperArmLen), rot: 0, scaleX: 1, scaleY: 1, length: r2(forearmLen) },
  { id: 'forearmL', parent: 'upperArmL', x: 0, y: r2(upperArmLen), rot: 0, scaleX: 1, scaleY: 1, length: r2(forearmLen) },
  { id: 'thighR', parent: 'hips', x: r2(hipX_R), y: 0, rot: 0, scaleX: 1, scaleY: 1, length: r2(thighLen) },
  { id: 'thighL', parent: 'hips', x: r2(hipX_L), y: 0, rot: 0, scaleX: 1, scaleY: 1, length: r2(thighLen) },
  { id: 'shinR', parent: 'thighR', x: 0, y: r2(thighLen), rot: 0, scaleX: 1, scaleY: 1, length: r2(shinLen) },
  { id: 'shinL', parent: 'thighL', x: 0, y: r2(thighLen), rot: 0, scaleX: 1, scaleY: 1, length: r2(shinLen) },
  { id: 'footR', parent: 'shinR', x: 0, y: r2(shinLen), rot: -90, scaleX: 1, scaleY: 1, length: 7 },
  { id: 'footL', parent: 'shinL', x: 0, y: r2(shinLen), rot: -90, scaleX: 1, scaleY: 1, length: 7 },
  { id: 'back', parent: 'spine', x: 0, y: -8, rot: 0, scaleX: 1, scaleY: 1, length: 10 }
];

/** 骨骼静止世界位姿（仅用于把图内像素偏移换算成附件局部偏移）。 */
const restWorld = { x: 0, y: 0, rot: 0 };
const boneOrigin = {};   // boneId -> { x(px), y(px) }
{
  let y = 0;
  const set = (id, parentY, parentX, px, py) => { boneOrigin[id] = { x: px, y: py }; };
  const px = (ux) => CENTER_X + ux * PX_PER_UNIT;
  const py = (uy) => GROUND_Y + uy * PX_PER_UNIT;
  const hips = { x: 0, y: hipsY };
  const spine = { x: 0, y: hips.y + spineY };
  const chest = { x: 0, y: spine.y + chestY };
  const neck = { x: 0, y: chest.y + neckY };
  const head = { x: 0, y: neck.y };
  set('hips', 0, 0, px(hips.x), py(hips.y));
  set('spine', 0, 0, px(spine.x), py(spine.y));
  set('chest', 0, 0, px(chest.x), py(chest.y));
  set('neck', 0, 0, px(neck.x), py(neck.y));
  set('head', 0, 0, px(head.x), py(head.y));
  for (const [s, sx] of [['R', shX_R], ['L', shX_L]]) {
    set(`upperArm${s}`, 0, 0, px(sx), py(chest.y + shY));
    set(`forearm${s}`, 0, 0, px(sx), py(chest.y + shY + upperArmLen));
  }
  for (const [s, hx] of [['R', hipX_R], ['L', hipX_L]]) {
    set(`thigh${s}`, 0, 0, px(hx), py(hips.y));
    set(`shin${s}`, 0, 0, px(hx), py(hips.y + thighLen));
    set(`foot${s}`, 0, 0, px(hx), py(hips.y + thighLen + shinLen));
  }
  void restWorld;
}

/** 部件的形态偏移：内容中心相对骨起点的世界偏移 → 骨骼局部偏移（抵消骨 rest 旋转）。 */
const REST_ROT = { footR: -90, footL: -90 };
const forms = FORM_KEYS;

const slots = [];
for (const part of Object.keys(PART_BONE)) {
  const bone = PART_BONE[part];
  const base = pieces[`${part}|down`];
  if (!base) throw new Error(`缺少正视切片 ${part}`);
  const origin = boneOrigin[bone];
  const localOffset = (p) => {
    const cxp = p.x0 + p.w / 2;
    const cyp = p.y0 + p.h / 2;
    const dx = (cxp - origin.x) / PX_PER_UNIT;
    const dy = (cyp - origin.y) / PX_PER_UNIT;
    const th = (REST_ROT[bone] || 0) * Math.PI / 180;
    const cos = Math.cos(th), sin = Math.sin(th);
    return { x: r2(dx * cos + dy * sin), y: r2(-dx * sin + dy * cos) };
  };
  const rectOf = (p) => ({ sx: p.sx, sy: p.sy, sw: p.w, sh: p.h });
  const local = localOffset(base);
  const att = {
    type: 'slice',
    assetId: ATLAS_ID,
    ...rectOf(base),
    x: local.x, y: local.y,
    rot: -(REST_ROT[bone] || 0),
    width: r2(base.w / PX_PER_UNIT),
    height: r2(base.h / PX_PER_UNIT),
    visible: true,
    directionOffsets: {}
  };
  for (const form of forms) {
    // 侧视（side/sideL）前臂：east/west 站立帧的「前臂」区域画的其实是剑鞘/剑带
    // （真实手臂藏在身后，美术未画）——源矩形换用正面手臂切片，但**保留原侧视偏移**
    //（侧视画位相对正面骨骼 rest 整体右移，用正面偏移会让手臂漂出体外）。
    const sidePiece = pieces[`${part}|${form}`];
    const useDown = part.startsWith('forearm') && (form === 'side' || form === 'sideL') && sidePiece;
    const p = useDown ? base : (sidePiece || base);
    const o = localOffset(useDown ? sidePiece : p);
    att.directionOffsets[form] = {
      ...(useDown ? rectOf(base) : rectOf(p)), x: o.x, y: o.y, rot: -(REST_ROT[bone] || 0),
      width: r2((useDown ? base : p).w / PX_PER_UNIT), height: r2((useDown ? base : p).h / PX_PER_UNIT)
    };
  }
  slots.push({ id: part, bone, z: zOf(part), attachment: att });
}

function zOf(part) {
  const Z = {
    headAll: 40, chestAll: 21, waistAll: 22,
    upperArmR: 23, forearmR: 24, upperArmL: 14, forearmL: 15,
    thighR: 4, thighL: 5, shinR: 11, shinL: 6, footR: 12, footL: 12
  };
  return Z[part] ?? 10;
}

/* ---------------- 3.8 武器/盾槽（左右手独立，不靠镜像换手） ----------------
 * 刀挂右手（forearmR）：槽 id 含 weapon- 前缀 → 交给 PlayerSkeletonStateMapper 按装备状态显示；
 * 盾挂左手（forearmL）：槽 id 不含 weapon- → 恒显示（盾不是背包武器）；
 * 背挂刀位挂 back 骨：只在该武器不手持时显示。
 * 挂点取前臂 0.65 处 ≈ 手掌，画布中心 = 握把。
 */
const HAND_Y = r2(forearmLen * 0.65);
/** 背/斜后视里角色的左手出现在画面左侧，但骨骼仍固定在 +x → 用 directionOffsets 把武器镜像过去。 */
const WEAPON_MIRROR_X = r2(-2 * shX_L);
const weaponDirOffsets = (base) => {
  const out = {};
  for (const form of FORM_KEYS) {
    const mirror = form === 'up' || form === 'NE' || form === 'NW';
    out[form] = { x: mirror ? r2(base.x + WEAPON_MIRROR_X) : base.x, y: base.y, rot: base.rot };
  }
  return out;
};
/** 盾外挂偏移：从小臂轴线往外推，避免挡在胸前。 */
const SHIELD_OUT = 9;
const SHIELD_Y = r2(forearmLen * 0.55);
// 刀：槽 id 符合 weapon-{key} 约定 → 跟主手装备/背包武器联动（战斗拔出、非战斗回背）
slots.push({
  id: 'weapon-sword', bone: 'forearmR', z: 26,
  attachment: {
    type: 'image', assetId: 'player.female.sword',
    x: 0, y: HAND_Y, rot: 0, width: 56, height: 56, visible: true,
    directionOffsets: weaponDirOffsets({ x: 0, y: HAND_Y, rot: 0 })
  }
});
// 盾：槽 id 符合 weapon-{key} 约定 → 跟副手（offhand）装备联动，装备即持握
slots.push({
  id: 'weapon-shield', bone: 'forearmL', z: 25,
  attachment: {
    type: 'image', assetId: 'player.female.shield',
    x: SHIELD_OUT, y: SHIELD_Y, rot: 0, width: 22, height: 26, visible: true,
    directionOffsets: weaponDirOffsets({ x: SHIELD_OUT, y: SHIELD_Y, rot: 0 })
  }
});
// 刀腰挂（单手短兵器收纳）：挂 hips 骨骼右腰侧，刀斜插刃朝下、柄朝上露出一截；
// 槽 id `weapon-{key}-waist` → PlayerSkeletonStateMapper 按「单手短兵器收纳位」管理（未持握时显示）。
// 背/斜后视角色右手落在画面左侧 → x 取反镜像（不复用手持武器镜像公式，腰挂是相对髋部的固定偏移）。
const WAIST_X = 10, WAIST_Y = -2, WAIST_ROT = 165;
slots.push({
  id: 'weapon-sword-waist', bone: 'hips', z: 24,
  attachment: {
    type: 'image', assetId: 'player.female.sword',
    x: WAIST_X, y: WAIST_Y, rot: WAIST_ROT, width: 40, height: 40, visible: false,
    directionOffsets: (() => {
      const out = {};
      for (const form of FORM_KEYS) {
        const mirror = form === 'up' || form === 'NE' || form === 'NW';
        out[form] = { x: mirror ? r2(-WAIST_X) : WAIST_X, y: WAIST_Y, rot: mirror ? r2(-WAIST_ROT) : WAIST_ROT };
      }
      return out;
    })()
  }
});
// 盾背挂（盾牌收纳）：挂 back 骨骼背部中央，正/背对视角被躯干遮挡属物理遮挡；
// 槽 id `weapon-{key}-back` → mapper 按「盾牌收纳位」管理；背面视角 flipX 由 applyFacing 自动处理
slots.push({
  id: 'weapon-shield-back', bone: 'back', z: 2,
  attachment: {
    type: 'image', assetId: 'player.female.shield',
    x: 0, y: -2, rot: 0, width: 24, height: 28, visible: false,
    directionOffsets: (() => {
      const out = {};
      for (const form of FORM_KEYS) out[form] = { x: 0, y: -2, rot: 0 };
      return out;
    })()
  }
});

/* ---------------- 4. 剪辑（沿用 player.json 拓扑，重算腿/换髋高） ---------------- */
const baseDoc = JSON.parse(readFileSync(BASE_SKELETON, 'utf8'));
const HIPS_SHIFT = r2(toUnitY(J.hip[1]) - (-50));   // 新髋高 − 旧髋高（旧位置取自 player.json rest）
const LIMB = /^(thigh|shin|foot|upperArm|forearm)/;
const LEG_LEN = thighLen + shinLen;
const GROUND_ANKLE = hipsY + LEG_LEN;

const clips = baseDoc.clips.map(clip => ({
  name: clip.name,
  durationMs: clip.durationMs,
  loop: clip.loop,
  tracks: clip.tracks.map(tr => ({
    bone: tr.bone,
    keys: tr.keys.map(k => {
      const out = { t: k.t };
      if (LIMB.test(tr.bone)) {
        if (typeof k.rot === 'number') out.rot = k.rot;
      } else {
        for (const f of ['x', 'y', 'rot', 'scaleX', 'scaleY']) {
          if (typeof k[f] === 'number') out[f] = k[f];
        }
        if (tr.bone === 'hips' && typeof out.y === 'number') out.y = r2(out.y + HIPS_SHIFT);
      }
      if (k.ease) out.ease = k.ease;
      return out;
    })
  }))
}));

/** 重写一条腿的三节轨。lift=整腿平移抬脚（px→骨骼单位）；thigh/shin/foot 可选每帧
 * 髋/膝/踝角，缺省 thigh 0 / shin 0 / foot −90（站姿直腿）。
 * 2026-10-26 起背向/斜向行走不再与正向共用同一套节奏。 */
function putLimb(clip, side, hipX, frames) {
  const set = (bone, keys) => {
    const tr = clip.tracks.find(t => t.bone === bone);
    if (tr) tr.keys = keys; else clip.tracks.push({ bone, keys });
  };
  set(`thigh${side}`, frames.map((f, i) => ({ t: f.t, x: r2(hipX), y: r2(-f.lift), rot: f.thigh ?? 0, ease: i === frames.length - 1 ? undefined : 'easeInOut' })));
  set(`shin${side}`, frames.map((f, i) => ({ t: f.t, rot: f.shin ?? 0, ease: i === frames.length - 1 ? undefined : 'easeInOut' })));
  set(`foot${side}`, frames.map((f, i) => ({ t: f.t, rot: f.foot ?? -90, ease: i === frames.length - 1 ? undefined : 'easeInOut' })));
}

/** 重写/新增手臂与头颈轨（缺轨自动补；rot 值为最终值——本函数在 SHIELD_ARM 叠加之后调用，
 * 左臂取值需自行含持盾外展偏移）。vals 对齐 times 逐帧。 */
function putRotTracks(clip, times, values) {
  const set = (bone, keys) => {
    const tr = clip.tracks.find(t => t.bone === bone);
    if (tr) tr.keys = keys; else clip.tracks.push({ bone, keys });
  };
  for (const [bone, vals] of Object.entries(values)) {
    set(bone, times.map((t, i) => ({ t, rot: vals[i], ease: i === times.length - 1 ? undefined : 'easeInOut' })));
  }
}

const getClip = n => clips.find(c => c.name === n);

/* 持盾臂姿态：左臂略微外展（负 rot 让左骨朝 +x 外侧）+ 前臂内收，
 * 让盾贴在小臂外侧而不是挡在胸前。所有剪辑统一叠加，保证持盾姿势连贯。 */
const SHIELD_ARM = { upperArmL: -6, forearmL: -16 };
for (const clip of clips) {
  for (const [bone, delta] of Object.entries(SHIELD_ARM)) {
    const tr = clip.tracks.find(t => t.bone === bone);
    if (!tr) continue;
    for (const k of tr.keys) if (typeof k.rot === 'number') k.rot = r2(k.rot + delta);
  }
}

const LIFT = 6 / PX_PER_UNIT;
const JUMP_LIFTS = [0, 6 / PX_PER_UNIT, 4 / PX_PER_UNIT, 0];   // 起跳蹬地→收腿→下落预备→贴地
/* 行走剪辑（2026-10-26 重设计：正/背/斜各自动作独立，不再互为换皮）：
 *   walk_down 正视：交替抬脚 LIFT≈2.18，摆臂 ±11（沿用原节奏）。
 *   walk_up   背向：相位翻转（L 先抬）+ 抬脚更高（8px）+ 屈膝/落脚趾 + 躯干反扭 + 头部摆动
 *             ——背向行走是独立的动作设计，不是正向动画换贴图。
 *   walk_SE/SW/NE/NW 斜向：中幅抬脚（7px）+ 屈膝 + 小幅摆臂（斜视角摆臂被躯干遮挡大半）。
 * 腿的横向位置恒用 rest（∓hipX）——背/斜视的左右镜像由切片的 directionOffsets 偏移承担，
 * 若这里再交换一次会双重镜像（腿被甩到体外）。
 */
// 正视：沿用原节奏
for (const name of ['walk_down']) {
  const clip = getClip(name);
  if (!clip) continue;
  const times = [0, 155, 310, 465];
  putLimb(clip, 'R', hipX_R, times.map((t, i) => ({ t, lift: [LIFT, 0, 0, 0][i] })));
  putLimb(clip, 'L', hipX_L, times.map((t, i) => ({ t, lift: [0, 0, LIFT, 0][i] })));
}
// 背向：独立动作（相位翻转 + 高抬腿屈膝 + 躯干/头部反向摆）
{
  const clip = getClip('walk_up');
  if (clip) {
    const times = [0, 155, 310, 465];
    const LIFT_UP = 8 / PX_PER_UNIT;
    // R 腿在 t310 抬起，L 腿在 t0 抬起（与正视相反相位）
    putLimb(clip, 'R', hipX_R, [
      { t: 0, lift: 0 }, { t: 155, lift: 0 },
      { t: 310, lift: LIFT_UP, shin: 14, foot: -78 }, { t: 465, lift: 0 }]);
    putLimb(clip, 'L', hipX_L, [
      { t: 0, lift: LIFT_UP, shin: 14, foot: -78 }, { t: 155, lift: 0 },
      { t: 310, lift: 0 }, { t: 465, lift: 0 }]);
    // 手臂相位与正视相反；左臂已含持盾外展 −6/前臂 −16
    putRotTracks(clip, times, {
      spine: [-3, 0, 3, 0],
      head: [-2, 0, 2, 0],
      upperArmR: [-12, 4, -12, 4],
      upperArmL: [6, -10, 6, -10],
      forearmR: [10, -2, 10, -2],
      forearmL: [-26, -14, -26, -14]
    });
  }
}
// 斜向：中幅抬脚屈膝 + 小摆臂
for (const [name, firstIsR] of [['walk_SE', true], ['walk_SW', true], ['walk_NE', true], ['walk_NW', true]]) {
  const clip = getClip(name);
  if (!clip) continue;
  const times = [0, 200, 400, 600];
  const LIFT_D = 7 / PX_PER_UNIT;
  const fR = firstIsR
    ? [{ t: 0, lift: LIFT_D, shin: 12, foot: -80 }, { t: 200, lift: 0 }, { t: 400, lift: 0 }, { t: 600, lift: 0 }]
    : [{ t: 0, lift: 0 }, { t: 200, lift: 0 }, { t: 400, lift: LIFT_D, shin: 12, foot: -80 }, { t: 600, lift: 0 }];
  const fL = firstIsR
    ? [{ t: 0, lift: 0 }, { t: 200, lift: 0 }, { t: 400, lift: LIFT_D, shin: 12, foot: -80 }, { t: 600, lift: 0 }]
    : [{ t: 0, lift: LIFT_D, shin: 12, foot: -80 }, { t: 200, lift: 0 }, { t: 400, lift: 0 }, { t: 600, lift: 0 }];
  putLimb(clip, 'R', hipX_R, fR);
  putLimb(clip, 'L', hipX_L, fL);
  putRotTracks(clip, times, {
    upperArmR: [8, -2, 8, -2],
    upperArmL: [-14, -4, -14, -4],
    forearmR: [5, -1, 5, -1],
    forearmL: [-21, -15, -21, -15]
  });
}
// 正/背视跳跃：起落贴地 + 空中收腿 + 手臂上摆（原 base 手臂 rot 高达 172°/−195° 甩到体外，全轨重写）
for (const name of ['jump_down', 'jump_up']) {
  const clip = getClip(name);
  if (!clip) continue;
  const times = [0, 120, 300, 420];
  putLimb(clip, 'R', hipX_R, times.map((t, i) => ({ t, lift: JUMP_LIFTS[i] })));
  putLimb(clip, 'L', hipX_L, times.map((t, i) => ({ t, lift: JUMP_LIFTS[i] })));
  putRotTracks(clip, times, {
    upperArmR: [14, -40, -46, 6],
    upperArmL: [-20, 34, 40, -12],
    forearmR: [6, -12, -14, 2],
    forearmL: [-22, -4, -2, -18]
  });
}
// 侧视跳跃：腿部全轨重写（原 base thigh rot 深收 −95° 致腿骨断裂）——
// 空中前后开合收腿：前腿屈膝前抬、后腿微后摆，落地伸直。rot 负=前摆（面朝右）。
{
  const clip = getClip('jump_side');
  if (clip) {
    const times = [0, 120, 300, 420];
    putLimb(clip, 'R', hipX_R, [
      { t: 0, lift: 0, foot: -90 },
      { t: 120, lift: 6 / PX_PER_UNIT, thigh: -26, shin: 22, foot: -70 },
      { t: 300, lift: 4 / PX_PER_UNIT, thigh: -16, shin: 12, foot: -80 },
      { t: 420, lift: 0, foot: -90 }]);
    putLimb(clip, 'L', hipX_L, [
      { t: 0, lift: 0, foot: -90 },
      { t: 120, lift: 6 / PX_PER_UNIT, thigh: 12, shin: 8, foot: -85 },
      { t: 300, lift: 4 / PX_PER_UNIT, thigh: 6, shin: 4, foot: -88 },
      { t: 420, lift: 0, foot: -90 }]);
    putRotTracks(clip, times, {
      upperArmR: [18, -52, -44, 0],
      upperArmL: [-24, 46, 38, -6],
      forearmR: [8, -16, -12, 2],
      forearmL: [-24, 0, -4, -18]
    });
  }
}

/* ---------------- 4.5 坐下 / 起身 / 躺下 / 起身（占位剪辑，待美术补图） ----------------
 * 【状态：占位】素材包没有坐/卧动作，这里按骨骼直接摆姿态，仅保证状态机可跑通；
 * 实际观感有缺陷——部件是从站立帧切的，髋/膝转到 80~90° 时站立时被裙摆遮住的接缝会露出来。
 * 【后续】拿到「坐姿/卧姿」整帧素材后，用同一套切片流程替换本段：
 *   1. 把坐姿/卧姿站立图加进 FORM_FILES 之外的新 POSE_SRC 表；
 *   2. 用 build-female-skeleton-assets.mjs 的 segmentsOf 分区逻辑切同样的 13 个部位；
 *   3. 本段的 poseClip 改成读取切好的姿态切片。
 * 现姿态：坐 = 骨盆落地 + 双腿前伸；躺 = 骨盆整体转 −90°（躯干朝 +x、腿朝 −x）。
 * 相邻两段共用同一姿态表，保证「坐下」末帧 = 「起身」首帧，可无缝衔接。
 */
const POSE_STAND = { hipsY: r2(hipsY), hipsRot: 0, spine: 0, chest: 0, head: 0, armR: 0, armL: 0, thigh: 0, shin: 0, foot: -90 };
const POSE_SIT = { hipsY: -8, hipsRot: 0, spine: 8, chest: 2, head: -3, armR: 16, armL: 16, thigh: -84, shin: 0, foot: 0 };
const POSE_LIE = { hipsY: -7, hipsRot: -90, spine: 10, chest: 2, head: 4, armR: -14, armL: -14, thigh: 0, shin: 8, foot: 0 };

function poseKey(t, pose, ease) {
  return { t, pose, ease };
}

/** 由姿态表生成一个剪辑（每帧写全部骨，避免缺轨回落 rest 造成跳变）。 */
function poseClip(name, durationMs, keys) {
  const at = (k, bone) => {
    const p = k.pose;
    switch (bone) {
      case 'hips': return { t: k.t, x: 0, y: p.hipsY, rot: p.hipsRot, ease: k.ease };
      case 'spine': return { t: k.t, rot: p.spine, ease: k.ease };
      case 'chest': return { t: k.t, rot: p.chest, ease: k.ease };
      case 'head': return { t: k.t, rot: p.head, ease: k.ease };
      case 'upperArmR': return { t: k.t, x: shX_R, rot: p.armR, ease: k.ease };
      case 'upperArmL': return { t: k.t, x: shX_L, rot: p.armL, ease: k.ease };
      case 'thighR': return { t: k.t, x: hipX_R, rot: p.thigh, ease: k.ease };
      case 'thighL': return { t: k.t, x: hipX_L, rot: p.thigh, ease: k.ease };
      case 'shinR': case 'shinL': return { t: k.t, rot: p.shin, ease: k.ease };
      case 'footR': case 'footL': return { t: k.t, rot: p.foot, ease: k.ease };
      default: return null;
    }
  };
  const bones = ['hips', 'spine', 'chest', 'head', 'upperArmR', 'upperArmL',
    'thighR', 'thighL', 'shinR', 'shinL', 'footR', 'footL'];
  return {
    name,
    durationMs,
    loop: false,
    tracks: bones.map(bone => ({
      bone,
      keys: keys.map(k => {
        const out = at(k, bone);
        if (out.ease === undefined) delete out.ease;
        return out;
      })
    }))
  };
}

const E = 'easeInOut';
clips.push(poseClip('sit', 480, [poseKey(0, POSE_STAND), poseKey(480, POSE_SIT, E)]));
clips.push(poseClip('sit_up', 480, [poseKey(0, POSE_SIT), poseKey(480, POSE_STAND, E)]));
clips.push(poseClip('lie', 640, [poseKey(0, POSE_STAND), poseKey(320, { ...POSE_LIE, hipsY: -30, hipsRot: -45 }, E), poseKey(640, POSE_LIE, E)]));
clips.push(poseClip('lie_up', 640, [poseKey(0, POSE_LIE), poseKey(320, { ...POSE_LIE, hipsY: -30, hipsRot: -45 }, E), poseKey(640, POSE_STAND, E)]));

const doc = {
  schemaVersion: 1,
  skeletonId: SKELETON_ID,
  meta: {
    width: 96,
    height: 100,
    coordinateSpace: 'canonical-v1',
    headProportionApplied: true,
    noMirrorFacing: true,
    // 占位剪辑（素材无坐/卧动作，纯骨骼摆姿态）：拿到专属美术后按 §4.5 注释替换
    placeholderClips: ['sit', 'sit_up', 'lie', 'lie_up']
  },
  defaultClip: 'idle_down',
  bones,
  slots,
  clips
};
writeFileSync(OUT_SKELETON, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log(`已写入 ${path.relative(root, OUT_SKELETON)}：${bones.length} 骨 / ${slots.length} 槽 / ${clips.length} 剪辑`);
console.log(`髋高 ${r2(hipsY)}（偏移 ${HIPS_SHIFT}），腿长 ${r2(LEG_LEN)}，踝 ${r2(GROUND_ANKLE)}`);

/* ---------------- 5. 校验：解析 + 静止姿态回拼误差 ---------------- */
const { parseSkeletonAsset } = await import(pathToFileURL(path.join(root, 'src/animation/SkeletonAsset.js')).href);
const { createRestLocalPose, sampleClip, composeWorldTransforms } = await import(pathToFileURL(path.join(root, 'src/animation/SkeletonPose.js')).href);
const asset = parseSkeletonAsset(doc);
if (!asset) throw new Error('parseSkeletonAsset 失败');
const rest = createRestLocalPose(asset);
const world = composeWorldTransforms(asset, rest);
let maxErr = 0;
for (const slot of slots) {
  const p = pieces[`${slot.id}|down`];
  if (!p) continue;                 // 武器/盾槽不在图集切片里，跳过回拼校验
  const origin = boneOrigin[slot.bone];
  const b = world.get(slot.bone);
  // 附件中心应落回图内内容中心
  const th = b.rad;
  const lx = slot.attachment.x, ly = slot.attachment.y;
  const wx = b.x + lx * Math.cos(th) - ly * Math.sin(th);
  const wy = b.y + lx * Math.sin(th) + ly * Math.cos(th);
  const expectX = toUnitX(p.x0 + p.w / 2), expectY = toUnitY(p.y0 + p.h / 2);
  maxErr = Math.max(maxErr, Math.abs(wx - expectX), Math.abs(wy - expectY));
  void origin;
}
console.log(`回拼校验：附件中心与素材内容中心最大误差 ${maxErr.toFixed(3)} 单位（≈ ${(maxErr * PX_PER_UNIT).toFixed(2)}px）`);
