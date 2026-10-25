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
 *
 * ## 产物
 *   assets/images/player/female/parts.png    部件图集（正/侧/背 三套切片）
 *   assets/skeletons/player-female.json      16 骨女性骨架（directionOffsets 按形态换切片）
 *
 * 剪辑数据来源：player.json（同拓扑），只保留 rot；四肢 x/y 布局归新骨架的 rest，
 * 腿部按「脚贴地 + 整腿平移抬脚」重算（与 rebuild-player-legs.mjs 同款模型）。
 *
 * 用法：node scripts/build-female-skeleton-assets.mjs
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

function distToSeg(px, py, a, b) {
  const [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/* ---------------- 1. 分区切片 ---------------- */
const pieces = {};   // `${part}|${form}` -> { px, w, h, x0, y0 }
for (const [form, file] of Object.entries(FORM_FILES)) {
  const { data, info } = await sharp(path.join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const segs = segmentsOf(JOINTS[form]);
  const parts = SHARED_LIMBS[form]
    ? Object.keys(segs).filter(n => !/L$/.test(n))
    : Object.keys(segs);
  const neckY = JOINTS[form].neck[1];
  const assign = new Int16Array(info.width * info.height).fill(-1);
  const bounds = new Map(parts.map(p => [p, { x0: 1e9, y0: 1e9, x1: -1, y1: -1 }]));
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const idx = y * info.width + x;
      if (data[idx * 4 + 3] < 16) continue;
      let best, bestD = Infinity;
      if (y < neckY) best = 'headAll';
      else {
        for (const p of parts) {
          const d = distToSeg(x, y, segs[p][0], segs[p][1]);
          if (d < bestD) { bestD = d; best = p; }
        }
      }
      const pi = parts.indexOf(best);
      if (pi < 0) continue;
      assign[idx] = pi;
      const b = bounds.get(best);
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
    }
  }
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    const b = bounds.get(part);
    if (b.x1 < b.x0) continue;
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
    const buf = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const src = (b.y0 + y) * info.width + (b.x0 + x);
        if (assign[src] !== pi) continue;
        const dst = (y * w + x) * 4;
        buf[dst] = data[src * 4]; buf[dst + 1] = data[src * 4 + 1];
        buf[dst + 2] = data[src * 4 + 2]; buf[dst + 3] = data[src * 4 + 3];
      }
    }
    const emit = (name) => {
      pieces[`${name}|${form}`] = { buf, w, h, x0: b.x0, y0: b.y0 };
    };
    emit(part);
    // 共享四肢：L 部位写一份同内容
    if (SHARED_LIMBS[form] && /R$/.test(part)) emit(part.replace(/R$/, 'L'));
  }
}

/* ---------------- 2. 打包图集 ---------------- */
const SHEET_W = 512;
const PAD = 2;
const order = Object.keys(pieces).sort();
let cx = PAD, cy = PAD, rowH = 0;
for (const key of order) {
  const p = pieces[key];
  if (cx + p.w + PAD > SHEET_W) { cx = PAD; cy += rowH + PAD; rowH = 0; }
  p.sx = cx; p.sy = cy;
  cx += p.w + PAD;
  rowH = Math.max(rowH, p.h);
}
const SHEET_H = cy + rowH + PAD;
const sheet = Buffer.alloc(SHEET_W * SHEET_H * 4);
for (const key of order) {
  const p = pieces[key];
  for (let y = 0; y < p.h; y++) {
    const dstRow = ((p.sy + y) * SHEET_W + p.sx) * 4;
    p.buf.copy(sheet, dstRow, y * p.w * 4, (y + 1) * p.w * 4);
  }
}
mkdirSync(path.dirname(OUT_ATLAS), { recursive: true });
await sharp(sheet, { raw: { width: SHEET_W, height: SHEET_H, channels: 4 } })
  .png({ compressionLevel: 9 }).toFile(OUT_ATLAS);
console.log(`部件图集：${SHEET_W}×${SHEET_H}，${order.length} 块 → ${path.relative(root, OUT_ATLAS)}`);

/* ---------------- 3.5 武器部件图（刀 / 盾） ----------------
 * 素材包没有独立武器图，按女骑士配色（钢蓝 #9aa4b4 / 深蓝 #4a5262 / 金 #c9963c / 皮革 #6b4a2f）程序化绘制。
 * 画布 64×64，握把在画布中心：挂到 forearmR/forearmL 后刀柄正落在手上。
 * 刀槽 id `weapon-sword` 会被 PlayerSkeletonStateMapper 当武器管理（只有装备时才显示）；
 * 盾槽 id `shieldL` 不含 weapon- 前缀 → 不受武器逻辑管理，恒定挂在左手。
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
    const p = pieces[`${part}|${form}`] || base;
    const o = localOffset(p);
    att.directionOffsets[form] = {
      ...rectOf(p), x: o.x, y: o.y, rot: -(REST_ROT[bone] || 0),
      width: r2(p.w / PX_PER_UNIT), height: r2(p.h / PX_PER_UNIT)
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
// 刀：槽 id 与 assetId 都不含 weapon- → 不受武器槽显隐逻辑管理，恒持握（要接装备系统时改回 weapon- 前缀）
slots.push({
  id: 'swordR', bone: 'forearmR', z: 26,
  attachment: {
    type: 'image', assetId: 'player.female.sword',
    x: 0, y: HAND_Y, rot: 0, width: 56, height: 56, visible: true,
    directionOffsets: weaponDirOffsets({ x: 0, y: HAND_Y, rot: 0 })
  }
});
// 盾：左手恒挂（盾不是背包武器）
slots.push({
  id: 'shieldL', bone: 'forearmL', z: 25,
  attachment: {
    type: 'image', assetId: 'player.female.shield',
    x: SHIELD_OUT, y: SHIELD_Y, rot: 0, width: 22, height: 26, visible: true,
    directionOffsets: weaponDirOffsets({ x: SHIELD_OUT, y: SHIELD_Y, rot: 0 })
  }
});
// 背挂位：留给后续「收刀」状态
slots.push({
  id: 'swordBack', bone: 'back', z: 2,
  attachment: {
    type: 'image', assetId: 'player.female.sword',
    x: -8, y: -6, rot: -70, width: 56, height: 56, visible: false,
    directionOffsets: weaponDirOffsets({ x: -8, y: -6, rot: -70 })
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

/** 重写一条腿的三节轨（正/背视：整腿平移抬脚，膝角恒 0）。 */
function putLeg(clip, side, hipX, frames) {
  const set = (bone, keys) => {
    const tr = clip.tracks.find(t => t.bone === bone);
    if (tr) tr.keys = keys; else clip.tracks.push({ bone, keys });
  };
  set(`thigh${side}`, frames.map((f, i) => ({ t: f.t, x: r2(hipX), y: r2(-f.lift), rot: 0, ease: i === frames.length - 1 ? undefined : 'easeInOut' })));
  set(`shin${side}`, frames.map((f, i) => ({ t: f.t, rot: 0, ease: i === frames.length - 1 ? undefined : 'easeInOut' })));
  set(`foot${side}`, frames.map((f, i) => ({ t: f.t, rot: -90, ease: i === frames.length - 1 ? undefined : 'easeInOut' })));
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
// 正/背/斜视行走：交替抬脚（单支撑）。腿的横向位置恒用 rest（∓hipX）——
// 背/斜视的左右镜像由切片的 directionOffsets 偏移承担，若这里再交换一次会双重镜像（腿被甩到体外）。
for (const [name, times] of [
  ['walk_down', [0, 155, 310, 465]],
  ['walk_up', [0, 155, 310, 465]],
  ['walk_SE', [0, 200, 400, 600]],
  ['walk_SW', [0, 200, 400, 600]],
  ['walk_NE', [0, 200, 400, 600]],
  ['walk_NW', [0, 200, 400, 600]]
]) {
  const clip = getClip(name);
  if (!clip) continue;
  const liftR = [LIFT, 0, 0, 0];
  const liftL = [0, 0, LIFT, 0];
  putLeg(clip, 'R', hipX_R, times.map((t, i) => ({ t, lift: liftR[i] })));
  putLeg(clip, 'L', hipX_L, times.map((t, i) => ({ t, lift: liftL[i] })));
}
// 正/背视跳跃：起落贴地 + 空中收腿
for (const name of ['jump_down', 'jump_up']) {
  const clip = getClip(name);
  if (!clip) continue;
  const frames = [{ t: 0, lift: 0 }, { t: 120, lift: 6 / PX_PER_UNIT }, { t: 300, lift: 4 / PX_PER_UNIT }, { t: 420, lift: 0 }];
  putLeg(clip, 'R', hipX_R, frames);
  putLeg(clip, 'L', hipX_L, frames);
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
