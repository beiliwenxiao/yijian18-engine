/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-18
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

// 从「主角女1b 三视图」生成 skeleton.player-girl-001：动画剪辑 100% 复制
// skeleton.player（不动原资产），骨骼挂点按素材解剖比例重标（2026-11-18 用户裁定方案 A：
// 素材是短腿日系比例——腿占 29% vs 骨架写实 52%，保美术零变形、骨骼重定位、剪辑数据原样）。
//   node scripts/gen-player-girl-001.mjs
//
// 输入素材（d:/游戏资源/）：
//   主角女1.png  素体三视图（光头裸身）→ 本体槽切片（脱装备=素体）
//   主角女4.png  丸子头三视图 → hair 三槽切片（发型独立，随 head 三态显隐）
//   主角女2.png  狼皮四件套三视图 → 与素体像素差分 → 贴合她身形的装备部件
//     （骨架 meta.armorSkinByAsset 映射接管映射器换图——装备尺寸随角色体型，不再套用旧角色大图）
//   （主角女1b 基础装已弃用：基础装焊在本体会导致「脱装备露出另一套衣服」）
// 输出：
//   assets/images/player-girl-001/parts/<slot>-<form>.png（64×64，挂点=图片中心 (32,32)）
//   assets/skeletons/player-girl-001.json（骨骼位置按 LANDMARK_BONES 重标、剪辑/约束原样；
//     本体 20 槽部件换新图 + 三方向部件 side/up 用侧/背切片、NE/NW 同 up、SE/SW 同 front（镜像复用）；
//     hair 三槽置 empty（1b 头含丸子头，head 三态用各视角切片））
//   manifest 幂等登记；末尾输出静止姿态合成预览 Temp/player-girl-001-preview.png
//
// 切片方法（Voronoi 像素分派）：
//   ① 绿幕键控去背（G 显著高于 R/B 判透明，半透明边缘去绿边）
//   ② 列 alpha 直方图自动分三段 → 各段 bbox 缩放到 96px 高（骨骼设计空间：脚底=96）
//   ③ 骨骼挂点（LANDMARK_BONES，按素材解剖量得）把每个不透明像素归最近挂点 → 部件像素
//   ④ 8 邻域 1px 膨胀补缝（相邻部件交界处无透明裂缝）
// 挂点 = 图片中心 (32,32)：每部件 64×64 画布，挂点像素置于中心，内容围绕挂点。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms } from '../src/animation/SkeletonPose.js';
import { SKELETON_HEAD_SLOT_PLAN } from '../src/animation/SkeletonDirection.js';

const OUT_DIR = 'example/sanguo_zhangjiao/assets/images/player-girl-001/parts';
const SKELETON_IN = 'example/sanguo_zhangjiao/assets/skeletons/player.json';
const SKELETON_OUT = 'example/sanguo_zhangjiao/assets/skeletons/player-girl-001.json';
const MANIFEST = 'example/sanguo_zhangjiao/assets/manifests/assets.json';
const DESIGN_H = 96;   // 骨骼设计空间高度（meta.height，脚底=96）
const CANVAS = 64;     // 部件画布

/* ---------------- 素材解剖骨骼挂点（方案 A：骨骼按素材比例重标） ----------------
 * 量自缩放后 96px 图的行列分布（脚底=0，y 向上为负）：
 *   头 8~26（中心 17）/ 颈 27 / 肩 30 / 胸 38 / 腰 52 / 胯 68 / 膝 80 / 踝 93（图 y，脚底=96）
 *   肩宽 ±11（上臂块中心）/ 肘 ±15.5 / 胯腿柱 ±11 / 小腿柱 ±8.5 / 脚柱 ±8.5（图 x 离中轴）
 * 骨骼 rot 沿用原骨架（上臂 ±4° 垂臂、脚 -90°）。 */
const LANDMARK_BONES = {
  hips: [0, -28],
  spine: [0, -44],
  chest: [0, -58],
  neck: [0, -69],
  head: [0, -79],
  back: [0, -50],
  upperArmR: [-11, -66],
  upperArmL: [11, -66],
  forearmR: [-15.5, -48],
  forearmL: [15.5, -48],
  thighR: [-11, -28],
  thighL: [11, -28],
  shinR: [-8.5, -16],
  shinL: [8.5, -16],
  footR: [-8.5, -3],
  footL: [8.5, -3]
};

/* 槽位→骨骼映射（与 player.json 本体槽一致）；ANCHORS 图坐标由 LANDMARK_BONES 派生
 *（挂点图 y = 96 + 世界y；挂点图 x = 人物中轴 + 世界x，96px 图与世界 1:1）。 */
const SLOT_BONE = {
  headFront: 'head',
  neckSlot: 'neck',
  torsoSlot: 'chest',
  skirtFront: 'spine',
  skirtBack: 'hips',
  armUR: 'upperArmR',
  armFR: 'forearmR',
  armUL: 'upperArmL',
  armFL: 'forearmL',
  legThighR: 'thighR',
  legThighL: 'thighL',
  legCalfL: 'shinL',
  'part-calf-r': 'shinR',
  footR: 'footR',
  footL: 'footL'
};
const ANCHORS = Object.fromEntries(Object.entries(SLOT_BONE)
  .map(([slotId, boneId]) => [slotId, {
    bone: boneId,
    point: [LANDMARK_BONES[boneId][0], 96 + LANDMARK_BONES[boneId][1]],
    // y 区域约束：素体头颈分界（head 锚点 y17 / neck 锚点 y27）——防止下半脸被 neck 抢走
    yRange: boneId === 'head' ? [0, 26] : boneId === 'neck' ? [27, 40] : null
  }]));

/** head 三态：槽位显隐切换，各视角独立图（front=正面 / side=侧面 / up=背面）。 */
const HEAD_FORMS = { headFront: 'front', headSide: 'side', headBack: 'up' };
/** 三方向部件：side/up 配侧/背切片；SE/SW 同 front（镜像复用）、NE/NW 同 up。 */
const THREE_FORM_SLOTS = new Set(['torsoSlot', 'skirtFront', 'footR', 'footL']);
/** hair 三槽：丸子头（主角女4）三视角切片，随 head 三态显隐切换——发型独立于身体（脱装备=素体+发型）。 */
const HAIR_SLOTS = { hairFront: 'front', hairSide: 'side', hairBack: 'up' };

/* ---------------- 装备皮（狼皮四件套差分切片，贴合 girl-001 身形） ----------------
 * 主角女2.png = girl-001 穿狼皮四件套的三视图（身体为浅绿幽灵剪影，强化键控剔除）。
 * 差分素体得装备像素 → 按装备锚点 Voronoi 分派 → 挂点居中画布（与本体切片同约定）。
 * meta.armorSkinByAsset：全局装备 assetId → 本骨架专属三形态部件 id——映射器换图时
 * skin 接管（装备尺寸随角色体型，不再套用旧角色大图）；旧 player 骨架无此 meta 零回归。 */
const GEAR_PARTS = {
  // part 名 → { anchor: [x, y]（96px 图坐标，派生自 LANDMARK_BONES）, yRange: 装备区行约束, xMin?: 距中轴最小距（避开躯干柱） }
  'armor-vest': { anchor: [0, 96 + LANDMARK_BONES.chest[1]], yRange: [20, 50] },
  'armor-skirt': { anchor: [0, 96 + LANDMARK_BONES.spine[1]], yRange: [51, 80] },
  'armor-boots': { anchor: [LANDMARK_BONES.footR[0], 96 + LANDMARK_BONES.footR[1]], yRange: [81, DESIGN_H - 1] },
  'armor-bracers': { anchor: [LANDMARK_BONES.forearmR[0], 96 + LANDMARK_BONES.forearmR[1]], yRange: [42, 55], xMin: 9 }
};
// 分派专用镜像锚点（front/up 视图左右对称装备各归其侧；画布只取 R 侧——左右槽共用同一张图）
const GEAR_DISPATCH_ONLY = {
  bootL: { anchor: [LANDMARK_BONES.footL[0], 96 + LANDMARK_BONES.footL[1]], yRange: [81, DESIGN_H - 1] },
  bracerL: { anchor: [LANDMARK_BONES.forearmL[0], 96 + LANDMARK_BONES.forearmL[1]], yRange: [42, 55], xMin: 9 }
};
// 全局装备 assetId → 装备皮 part 名（library.json skeletonPart.assetId）
const GEAR_SKIN_SOURCES = {
  'player.parts.wolf-hide-vest': 'armor-vest',
  'player.parts.wolf-hide-skirt': 'armor-skirt',
  'player.parts.wolf-hide-boots': 'armor-boots',
  'player.parts.wolf-hide-bracers': 'armor-bracers'
};
// 防具槽位 → 装备皮 part（骨架基础附件换新图——编辑器所见=运行时所得）
const GEAR_SLOT_PART = {
  armorTorso: 'armor-vest',
  armorSkirt: 'armor-skirt',
  armorBootL: 'armor-boots',
  armorBootR: 'armor-boots',
  armorWristL: 'armor-bracers',
  armorWristR: 'armor-bracers'
};

/* ---------------- ① 背景键控（绿幕 / 白底通用） ---------------- */

function keyOutBackdrop(pixels, w, h) {
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    const r = pixels[o], g = pixels[o + 1], b = pixels[o + 2];
    const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
    // 白底（主角女4）：三通道全高且接近 → 透明；半透明白边 → 钳制去白
    if (minC > 205 && maxC - minC < 22) {
      pixels[o + 3] = 0;
    } else if (minC > 180 && maxC - minC < 30) {
      const keep = Math.max(0, minC - 30);
      pixels[o] = Math.min(r, keep); pixels[o + 1] = Math.min(g, keep); pixels[o + 2] = Math.min(b, keep);
    }
    // 绿幕（主角女1/2/3）：G 显著最高 → 透明；绿边 → G 钳制到 max(R,B) 去绿
    if (g > r + 22 && g > b + 22 && g > 60) {
      pixels[o + 3] = 0;
    } else if (g > r + 8 && g > b + 8) {
      pixels[o + 1] = Math.max(r, b);
    }
  }
  return pixels;
}

/** alpha 包围盒。 */
function alphaBBox(data, w, h, ch) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * ch + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** 列 alpha 直方图找两个最深谷 → 三段人物区域。 */
function splitThreeViews(data, w, h, ch) {
  const col = new Float64Array(w);
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) col[x] += data[(y * w + x) * ch + 3];
  }
  // 全宽扫描：收集「内容列」连续段（col > 阈值的区间），取最长的 3 段
  const threshold = col.reduce((a, b) => Math.max(a, b), 1) * 0.02;
  const ranges = [];
  let start = -1;
  for (let x = 0; x < w; x += 1) {
    if (col[x] > threshold) { if (start < 0) start = x; }
    else if (start >= 0) { ranges.push([start, x - 1]); start = -1; }
  }
  if (start >= 0) ranges.push([start, w - 1]);
  ranges.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  const top3 = ranges.slice(0, 3).sort((a, b) => a[0] - b[0]);
  if (top3.length < 3) throw new Error(`三视图分割失败（识别到 ${top3.length} 段）`);
  return top3;
}

/* ---------------- ② 单视图缩放 ---------------- */

/* ---------------- 主流程 ---------------- */

/** 加载一张三视图源图 → { front, side, up } 三个 96px 高 raw 视图。 */
async function loadViews(srcFile, label) {
  const { data, info } = await sharp(srcFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  keyOutBackdrop(data, W, H);
  const ranges = splitThreeViews(data, W, H, 4);
  console.log(`${label} 三视图分割:`, JSON.stringify(ranges));
  const FORMS = ['front', 'side', 'up'];
  const views = {};
  for (let i = 0; i < 3; i += 1) {
    const [x0, x1] = ranges[i];
    const w = x1 - x0 + 1;
    const seg = Buffer.alloc(w * H * 4);
    for (let y = 0; y < H; y += 1) data.copy(seg, y * w * 4, (y * W + x0) * 4, (y * W + x1 + 1) * 4);
    // 段内 bbox → 缩放：脚底 y=96 对齐，人物高=96
    const box = alphaBBox(seg, w, H, 4);
    if (!box) throw new Error(`[${label}] 第 ${i + 1} 段无内容`);
    const srcH = box.maxY - box.minY + 1;
    const scale = DESIGN_H / srcH;
    const newW = Math.max(1, Math.round(w * scale));
    const { data: scaled, info: scaledInfo } = await sharp(seg, { raw: { width: w, height: H, channels: 4 } })
      .extract({ left: 0, top: 0, width: w, height: box.maxY + 1 })
      .resize(newW, DESIGN_H, { kernel: 'lanczos3' })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    views[FORMS[i]] = {
      buffer: scaled, width: scaledInfo.width, height: scaledInfo.height,
      centerX: scaledInfo.width / 2, // 人物中轴 = 段中心（缩放后）
      srcSegW: w,                        // 段原始宽（水平缩放比 = width/srcSegW，含素体自身宽高失真）
      scaleY: DESIGN_H / (box.maxY + 1)  // 垂直缩放比（extract 图顶~脚底压到 96 高）
    };
    console.log(`  ${FORMS[i]}: 源高 ${srcH}px → ${DESIGN_H}px，宽 ${scaledInfo.width}px`);
  }
  return views;
}

/** 狼皮三视图加载（主角女2）：幽灵身体被基础键控剔除（浅绿 g>r+22）；按素体各 form 的实际
 *  缩放比缩放装备内容，脚底对齐 y95、中轴对齐 x48（96×96 画布）——与素体视图同一坐标系，
 *  差分/切片逐像素对齐（两源图人物大小不同，不能各自压满 96px）。 */
async function loadGearViews(bodyViews) {
  const { data, info } = await sharp('d:/游戏资源/主角女2.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  keyOutBackdrop(data, info.width, info.height);
  const ranges = splitThreeViews(data, info.width, info.height, 4);
  console.log('狼皮 三视图分割:', JSON.stringify(ranges));
  const FORMS_LOCAL = ['front', 'side', 'up'];
  const views = {};
  for (let i = 0; i < 3; i += 1) {
    const form = FORMS_LOCAL[i];
    const body = bodyViews[form];
    const scaleBX = body.width / body.srcSegW; // 水平跟随素体拉伸
    const scaleY = body.scaleY;                // 垂直跟随素体
    const [x0, x1] = ranges[i];
    const w = x1 - x0 + 1;
    // 段内装备内容 bbox（幽灵已剔 → 全是装备像素）
    let minY = info.height, maxY = -1;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (data[(y * info.width + x) * 4 + 3] > 8) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
    }
    if (maxY < 0) throw new Error(`[狼皮] 第 ${i + 1} 段无内容`);
    const srcH = maxY - minY + 1;
    const newW = Math.max(1, Math.round(w * scaleBX));
    const newH = Math.max(1, Math.round(srcH * scaleY));
    const { data: scaled, info: si } = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .extract({ left: x0, top: minY, width: w, height: srcH })
      .resize(newW, newH, { kernel: 'lanczos3' })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // 96×96 画布：脚底贴 y95、水平居中（中轴 x48）；强化键控剔幽灵残留绿边。
    // 阈值 12：幽灵实测 g−r>22，绿褐调毛皮 g−r≈0~10——阈值更低会把毛皮误杀（护腕只剩一撮的根因）
    const canvas = Buffer.alloc(DESIGN_H * DESIGN_H * 4);
    const putX = Math.round((DESIGN_H - newW) / 2);
    const putY = DESIGN_H - newH;
    for (let y = 0; y < si.height; y += 1) {
      for (let x = 0; x < si.width; x += 1) {
        const s = (y * si.width + x) * 4;
        if (scaled[s + 3] === 0) continue;
        const r = scaled[s], g = scaled[s + 1], b = scaled[s + 2];
        if (g > r + 12 && g > b + 12) continue;
        const to = ((putY + y) * DESIGN_H + (putX + x)) * 4;
        canvas[to] = r; canvas[to + 1] = g; canvas[to + 2] = b; canvas[to + 3] = scaled[s + 3];
      }
    }
    views[form] = { buffer: canvas, width: DESIGN_H, height: DESIGN_H, centerX: DESIGN_H / 2 };
    console.log(`  ${form}: 装备源高 ${srcH}px × scale(${scaleBX.toFixed(3)},${scaleY.toFixed(3)}) → ${newW}x${newH}，put(${putX},${putY})`);
  }
  return views;
}

/** 素体三视图（主角女1：光头裸身——本体槽切片源）。丸子头按 HAIR_SEG_SOURCE 原图分段（buildHairPart）。 */
const bodyViews = await loadViews('d:/游戏资源/主角女1.png', '素体');

/** 狼皮四件套三视图（主角女2）：幽灵身体键控剔除后，按素体缩放比 + 脚底/中轴对齐到同一坐标系。 */
const gearViews = await loadGearViews(bodyViews);

/* ---------------- ③ Voronoi 像素分派 ---------------- */

const anchorEntries = Object.entries(ANCHORS);

/** 素体某视角的头部 bbox（行 0~颈锚点之间；光头无发 → 即头部区域）。 */
function headBoxOf(view) {
  const neckY = 96 + LANDMARK_BONES.neck[1]; // 颈锚点图 y
  let minX = view.width, minY = neckY, maxX = -1, maxY = -1;
  for (let y = 0; y < neckY; y += 1) {
    for (let x = 0; x < view.width; x += 1) {
      if (view.buffer[(y * view.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('素体头部 bbox 测量失败');
  return {
    cx: (minX + maxX + 1) / 2,
    cy: (minY + maxY + 1) / 2,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    minY,
    maxY
  };
}

// 素体头部自动适配：素体头顶贴 y0（比 1b 短发高 ~8px），head/neck 锚点与骨骼 y 按
// 素体头 bbox 重定——部件切片、丸子头放置、骨骼位置三者共用同一份头颈分界。
{
  const hb = headBoxOf(bodyViews.front);
  LANDMARK_BONES.head = [0, hb.cy - 96];
  LANDMARK_BONES.neck = [0, hb.maxY + 2 - 96];
  for (const def of Object.values(ANCHORS)) {
    if (def.bone === 'head') { def.point[1] = 96 + LANDMARK_BONES.head[1]; def.yRange = [0, hb.maxY]; }
    if (def.bone === 'neck') { def.point[1] = 96 + LANDMARK_BONES.neck[1]; def.yRange = [hb.maxY + 1, hb.maxY + 14]; }
  }
  console.log(`素体头 bbox: 中心(${Math.round(hb.cx * 10) / 10}, ${Math.round(hb.cy * 10) / 10}) 尺寸 ${hb.w}x${hb.h} → head 锚点 y=${96 + LANDMARK_BONES.head[1]} neck y=${96 + LANDMARK_BONES.neck[1]}`);
}
/** 8 邻域 1px 膨胀补缝（只向透明像素扩张，不覆盖已分派像素）。 */
function dilateCanvas(pixels) {
  const copy = Buffer.from(pixels);
  for (let y = 1; y < CANVAS - 1; y += 1) {
    for (let x = 1; x < CANVAS - 1; x += 1) {
      const o = (y * CANVAS + x) * 4;
      if (copy[o + 3] > 0) continue;
      for (let k = 0; k < 8; k += 1) {
        const nx = x + [0, 1, 1, 1, 0, -1, -1, -1][k], ny = y + [-1, -1, 0, 1, 1, 1, 0, -1][k];
        const no = (ny * CANVAS + nx) * 4;
        if (copy[no + 3] > 0) {
          pixels[o] = copy[no]; pixels[o + 1] = copy[no + 1]; pixels[o + 2] = copy[no + 2]; pixels[o + 3] = Math.round(copy[no + 3] * 0.7);
          break;
        }
      }
    }
  }
}

function sliceParts(view) {
  const { buffer, width, height, centerX } = view;
  const parts = new Map(anchorEntries.map(([id]) => [id, Buffer.alloc(CANVAS * CANVAS * 4)]));
  const srcCenterX = centerX;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = buffer[(y * width + x) * 4 + 3];
      if (a <= 8) continue;
      // 骨骼空间坐标：挂点 x = srcCenterX + anchorX（挂点 x 相对中轴）
      let best = null, bestD = Infinity;
      for (const [id, { point, yRange }] of anchorEntries) {
        if (yRange && (y < yRange[0] || y > yRange[1])) continue; // 区域约束（头/颈分界）
        const ax = srcCenterX + point[0], ay = point[1];
        const d = (x - ax) * (x - ax) + (y - ay) * (y - ay);
        if (d < bestD) { bestD = d; best = id; }
      }
      // 挂点置于画布中心：画布坐标 = (32 + x - 挂点x, 32 + y - 挂点y)
      const { point } = ANCHORS[best];
      const dx = Math.round(32 + (x - (srcCenterX + point[0])));
      const dy = Math.round(32 + (y - point[1]));
      if (dx < 0 || dy < 0 || dx >= CANVAS || dy >= CANVAS) continue;
      const out = parts.get(best);
      const o = (dy * CANVAS + dx) * 4;
      const s = (y * width + x) * 4;
      out[o] = buffer[s]; out[o + 1] = buffer[s + 1]; out[o + 2] = buffer[s + 2]; out[o + 3] = a;
    }
  }
  // 8 邻域 1px 膨胀补缝（共享实现）
  for (const [, pixels] of parts) dilateCanvas(pixels);
  return parts;
}

/* ---------------- ③b 装备差分切片（主角女2 − 素体 → 贴合身形的装备像素） ---------------- */

/** 装备像素掩码：gear 视图像素「素体透明（装备出界）或颜色显著不同」→ 装备。
 *  两视图同为 96 高脚底对齐坐标系：y 直接同坐标；x 按中轴对齐采样（视图宽可不同）。
 *  阈值 40：贴身皮革（护腕/靴筒）与素体阴影皮肤 diff≈50~60——阈值再高会把贴身部分误剔
 *  （部件残缺偏心的根因）；再低会收进两图渲染噪声。 */
function gearPixelMask(gearView, bodyView) {
  const gw = gearView.width, gh = gearView.height, bw = bodyView.width, bh = bodyView.height;
  const mask = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y += 1) {
    for (let x = 0; x < gw; x += 1) {
      const o = (y * gw + x) * 4;
      if (gearView.buffer[o + 3] <= 8) continue;
      const by = Math.min(bh - 1, y);
      const bx = Math.min(bw - 1, Math.max(0, Math.round(bodyView.centerX + (x - gearView.centerX))));
      const bo = (by * bw + bx) * 4;
      const ba = bodyView.buffer[bo + 3];
      const diff = Math.abs(gearView.buffer[o] - bodyView.buffer[bo])
        + Math.abs(gearView.buffer[o + 1] - bodyView.buffer[bo + 1])
        + Math.abs(gearView.buffer[o + 2] - bodyView.buffer[bo + 2]);
      mask[y * gw + x] = (ba <= 8 || diff > 40) ? 1 : 0;
    }
  }
  return mask;
}

/** 装备切片：掩码像素按装备锚点 Voronoi 分派 → 挂点居中画布（R 侧落盘，L 侧仅分派抢像素）。 */
function sliceGear(view, mask) {
  const { buffer, width, height, centerX } = view;
  const dispatch = [...Object.entries(GEAR_PARTS), ...Object.entries(GEAR_DISPATCH_ONLY)];
  const parts = new Map(Object.keys(GEAR_PARTS).map(id => [id, Buffer.alloc(CANVAS * CANVAS * 4)]));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      let best = null, bestD = Infinity;
      for (const [id, def] of dispatch) {
        if (y < def.yRange[0] || y > def.yRange[1]) continue;
        if (def.xMin && Math.abs(x - centerX) < def.xMin) continue;
        const ax = centerX + def.anchor[0], ay = def.anchor[1];
        const d = (x - ax) * (x - ax) + (y - ay) * (y - ay);
        if (d < bestD) { bestD = d; best = id; }
      }
      const def = GEAR_PARTS[best];
      if (!def) continue; // dispatch-only 锚点（L 侧）只抢像素不落画布
      const dx = Math.round(32 + (x - (centerX + def.anchor[0])));
      const dy = Math.round(32 + (y - def.anchor[1]));
      if (dx < 0 || dy < 0 || dx >= CANVAS || dy >= CANVAS) continue;
      const s = (y * width + x) * 4;
      const out = parts.get(best);
      const o = (dy * CANVAS + dx) * 4;
      out[o] = buffer[s]; out[o + 1] = buffer[s + 1]; out[o + 2] = buffer[s + 2]; out[o + 3] = buffer[s + 3];
    }
  }
  for (const [, pixels] of parts) dilateCanvas(pixels);
  return parts;
}

/* ---------------- ④ 写盘 + JSON 生成 ---------------- */

mkdirSync(OUT_DIR, { recursive: true });
const FORMS = ['front', 'side', 'up'];
const assetIdOf = (slot, form) => `player-girl-001.parts.${slot}-${form}`;
const fileOf = (slot, form) => `${slot}-${form}.png`;
// 每个视图只做一次像素分派（side/up 形态图：三方向部件/头三态用各视角；单方向部件沿用 front）
const partsByForm = Object.fromEntries(FORMS.map(form => [form, sliceParts(bodyViews[form])]));
const written = new Map(); // slot -> { front: assetId, side: assetId, up: assetId }

/** 丸子头部件（主角女4 → 64×64 画布）：头发段缩放到素体头 bbox 尺寸（×蓬松系数），
 *  内容中心对齐头 bbox 中心（画布坐标 = head 锚点(32,17) + 头中心相对锚点偏移）。 */
async function buildHairPart(view, hairSegFile, form) {
  const headBox = headBoxOf(view);
  const { data, info } = await sharp(hairSegFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  keyOutBackdrop(data, info.width, info.height);
  const ranges = splitThreeViews(data, info.width, info.height, 4);
  const idx = FORMS.indexOf(form);
  const [x0, x1] = ranges[idx];
  const w = x1 - x0 + 1;
  const seg = Buffer.alloc(w * info.height * 4);
  for (let y = 0; y < info.height; y += 1) data.copy(seg, y * w * 4, (y * info.width + x0) * 4, (y * info.width + x1 + 1) * 4);
  const box = alphaBBox(seg, w, info.height, 4);
  if (!box) throw new Error(`丸子头 ${form} 段无内容`);
  // 缩放：丸子头蓬松（宽 ×1.0 / 高 ×1.05）——过高会盖住眼睛（刘海压到眼部）
  const tw = Math.max(1, Math.round(headBox.w * 1.0));
  const th = Math.max(1, Math.round(headBox.h * 1.05));
  const { data: sd, info: si } = await sharp(seg, { raw: { width: w, height: info.height, channels: 4 } })
    .extract({ left: 0, top: 0, width: w, height: box.maxY + 1 })
    .resize(tw, th, { kernel: 'lanczos3' })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // 放置：hair 内容中心 = 头 bbox 中心上移 50% 头高（发髻戴头顶，刘额头前不压眼）；
  // head 锚点画布坐标 = (32, 96+(-79)=17)。headBox.cx 是视图内坐标 → 换算为相对视图中心的偏移。
  const anchorY = 96 + LANDMARK_BONES.head[1];
  const putCx = Math.round(32 + (headBox.cx - view.centerX));
  const putCy = Math.round(32 + (headBox.cy - anchorY) - headBox.h * 0.5);
  const left = Math.round(putCx - si.width / 2);
  const top = Math.round(putCy - si.height / 2);
  const canvas = Buffer.alloc(CANVAS * CANVAS * 4);
  for (let y = 0; y < si.height; y += 1) {
    for (let x = 0; x < si.width; x += 1) {
      const px = left + x, py = top + y;
      if (px < 0 || py < 0 || px >= CANVAS || py >= CANVAS) continue;
      const so = (y * si.width + x) * 4, to = (py * CANVAS + px) * 4;
      canvas[to] = sd[so]; canvas[to + 1] = sd[so + 1]; canvas[to + 2] = sd[so + 2]; canvas[to + 3] = sd[so + 3];
    }
  }
  return canvas;
}

// hair 三槽：丸子头三视角（正面/侧面/背面），随 head 三态显隐切换
const HAIR_SEG_SOURCE = 'd:/游戏资源/主角女4.png';
const hairCanvases = {};
for (const [slotId, form] of Object.entries(HAIR_SLOTS)) {
  const canvas = await buildHairPart(bodyViews[form], HAIR_SEG_SOURCE, form);
  const file = fileOf(slotId, form);
  await sharp(canvas, { raw: { width: CANVAS, height: CANVAS, channels: 4 } }).png().toFile(`${OUT_DIR}/${file}`);
  hairCanvases[slotId] = assetIdOf(slotId, form);
}

for (const [id] of anchorEntries) {
  const entry = {};
  for (const form of FORMS) {
    const needForm = THREE_FORM_SLOTS.has(id) || HEAD_FORMS[id] ? form : 'front';
    const pixels = partsByForm[needForm].get(id);
    const file = fileOf(id, form);
    await sharp(pixels, { raw: { width: CANVAS, height: CANVAS, channels: 4 } })
      .png().toFile(`${OUT_DIR}/${file}`);
    entry[form] = assetIdOf(id, form);
  }
  written.set(id, entry);
}

// 装备皮部件：狼皮差分切片（贴合 girl-001 身形），每 part 三形态（挂点=装备锚点居中）
const gearPartsByForm = {};
for (const form of FORMS) {
  const mask = gearPixelMask(gearViews[form], bodyViews[form]);
  gearPartsByForm[form] = sliceGear(gearViews[form], mask);
}
const gearWritten = {}; // part -> { front, side, up } assetId
for (const part of Object.keys(GEAR_PARTS)) {
  const entry = {};
  for (const form of FORMS) {
    const pixels = gearPartsByForm[form].get(part);
    await sharp(pixels, { raw: { width: CANVAS, height: CANVAS, channels: 4 } })
      .png().toFile(`${OUT_DIR}/${fileOf(part, form)}`);
    entry[form] = assetIdOf(part, form);
  }
  gearWritten[part] = entry;
}

// JSON：复制 player.json 并替换本体部件
const doc = JSON.parse(readFileSync(SKELETON_IN, 'utf8'));
doc.skeletonId = 'skeleton.player-girl-001';
if (doc.meta) {
  doc.meta.note = '骨骼挂点按「主角女1」素体解剖比例重标（方案 A）；剪辑/约束原样复制 skeleton.player；装备皮为「主角女2」狼皮差分切片（gen-player-girl-001.mjs 生成）';
  // 骨架级装备皮映射：全局装备 assetId → 本骨架专属三形态部件（映射器换图时 skin 接管）
  doc.meta.armorSkinByAsset = Object.fromEntries(Object.entries(GEAR_SKIN_SOURCES).map(([assetId, part]) => [
    assetId, { front: gearWritten[part].front, side: gearWritten[part].side, up: gearWritten[part].up }
  ]));
}

// 骨骼位置重标：世界坐标取 LANDMARK_BONES，局部坐标 = 世界 − 父骨世界（层级沿用原骨架；rot/scale 不动）
{
  const worldOf = id => LANDMARK_BONES[id];
  const parentWorld = new Map();
  for (const bone of doc.bones) {
    const w = worldOf(bone.id);
    if (!w) throw new Error(`LANDMARK_BONES 缺骨骼 ${bone.id}`);
    parentWorld.set(bone.id, w);
  }
  for (const bone of doc.bones) {
    const [wx, wy] = parentWorld.get(bone.id);
    const [px, py] = bone.parent ? parentWorld.get(bone.parent) : [0, 0];
    bone.x = Math.round((wx - px) * 10) / 10;
    bone.y = Math.round((wy - py) * 10) / 10;
  }
}

for (const slot of doc.slots) {
  // hair 三槽：丸子头三视角（正面/侧面/背面），随 head 三态显隐切换；offset=0（内容已按素体头 bbox 对位放置）
  if (HAIR_SLOTS[slot.id]) {
    const form = HAIR_SLOTS[slot.id];
    slot.attachment = { type: 'image', x: 0, y: 0, rot: 0, assetId: hairCanvases[slot.id], width: CANVAS, height: CANVAS, visible: true };
    continue;
  }
  // 防具槽位基础附件换装备皮新图（编辑器所见=运行时所得；x/y 归零——挂点=图片中心；
  // rot 保留 tune 写入的骨骼自转补偿：foot 骨 -90° → 靴 +90 / 前臂 ±4° → 护腕 ∓4）
  if (GEAR_SLOT_PART[slot.id] && slot.attachment) {
    const part = GEAR_SLOT_PART[slot.id];
    const att = slot.attachment;
    delete att.partId;
    att.type = 'image';
    att.assetId = gearWritten[part].front;
    att.width = CANVAS;
    att.height = CANVAS;
    att.x = 0;
    att.y = 0;
    att.directionOffsets = {
      side: { assetId: gearWritten[part].side },
      up: { assetId: gearWritten[part].up }
    };
    continue;
  }
  const entry = written.get(slot.id);
  if (!entry) continue; // 武器/防具/背挂等槽位不动
  const att = slot.attachment;
  delete att.partId; // 新部件未注册部件库，防止误解析旧 part
  att.type = 'image';
  att.assetId = entry.front;
  att.width = CANVAS;
  att.height = CANVAS;
  // 新部件是「挂点=图片中心」的直立切片：清零旧美术的偏移；rot 抵消骨骼自转
  // （foot 骨 -90° → att +90；上臂/前臂 ±4° → ∓4），使渲染 net 旋转 = 0（内容直立）
  att.x = 0;
  att.y = 0;
  const boneRot = doc.bones.find(bone => bone.id === slot.bone)?.rot || 0;
  att.rot = Math.round(-boneRot) % 360;
  if (THREE_FORM_SLOTS.has(slot.id)) {
    att.directionOffsets = {
      side: { x: att.x, y: att.y, rot: att.rot || 0, assetId: entry.side },
      up: { x: att.x, y: att.y, rot: att.rot || 0, assetId: entry.up },
      SE: { x: att.x, y: att.y, rot: att.rot || 0, assetId: entry.front },
      SW: { x: att.x, y: att.y, rot: att.rot || 0, assetId: entry.front },
      NE: { x: att.x, y: att.y, rot: att.rot || 0, assetId: entry.up },
      NW: { x: att.x, y: att.y, rot: att.rot || 0, assetId: entry.up }
    };
  } else if (HEAD_FORMS[slot.id]) {
    att.assetId = entry[HEAD_FORMS[slot.id]];
    delete att.directionOffsets;
  } else {
    delete att.directionOffsets; // 单方向部件：沿用基准切片（与原资产结构一致）
  }
}

writeFileSync(SKELETON_OUT, `${JSON.stringify(doc, null, 2)}\n`);

// manifest 登记（幂等）
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));const byId = new Map(manifest.assets.map(a => [a.assetId, a]));
const register = (assetId, rel, extra = {}) => byId.set(assetId, {
  assetId, imageId: assetId,
  category: 'character-part',
  usage: ['player-girl-001-skeleton-part'],
  sourceFile: rel,
  runtime2D: { path: rel, mode: 'image' },
  runtime3D: { mode: 'billboard', sourceAssetId: assetId },
  pivot: { x: 0.5, y: 0.5 },
  bounds: { width: CANVAS, height: CANVAS },
  grid: { columns: 1, rows: 1, cellWidth: CANVAS, cellHeight: CANVAS },
  animations: [], targetPhase: 'P1', status: 'ai-generated', revision: 1, ...extra
});
for (const [slot, entry] of written) {
  for (const form of FORMS) {
    register(entry[form], `assets/images/player-girl-001/parts/${fileOf(slot, form)}`);
  }
}
for (const [part, entry] of Object.entries(gearWritten)) {
  for (const form of FORMS) {
    register(entry[form], `assets/images/player-girl-001/parts/${fileOf(part, form)}`);
  }
}
byId.set('skeleton.player-girl-001', {
  assetId: 'skeleton.player-girl-001', imageId: 'skeleton.player-girl-001',
  category: 'character-skeleton',
  usage: ['player-skeleton'],
  sourceFile: 'assets/skeletons/player-girl-001.json',
  runtime2D: { path: 'assets/skeletons/player-girl-001.json', mode: 'skeleton' },
  runtime3D: { mode: 'billboard', sourceAssetId: 'skeleton.player-girl-001' },
  pivot: { x: 0.5, y: 1 },
  bounds: { width: 96, height: 96 },
  animations: [], targetPhase: 'P1', status: 'ai-generated', revision: 1
});
manifest.assets = [...byId.values()];
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

/* ---------------- ⑤ 静止姿态合成预览（素体 / 穿装备两张） ---------------- */

const newDoc = JSON.parse(readFileSync(SKELETON_OUT, 'utf8'));
const asset = parseSkeletonAsset(newDoc);
const rest = createRestLocalPose(asset);
const world = composeWorldTransforms(asset, rest);
const DEG = Math.PI / 180;
const CW = 160, CH = 130, OX = 80, OY = 110;
const PREVIEW_DIRECTION = 'down'; // 预览朝向：头三态/hair 三态按 SKELETON_HEAD_SLOT_PLAN 显隐（对齐运行时映射器）
const plan = SKELETON_HEAD_SLOT_PLAN[PREVIEW_DIRECTION] || {};

/** 收集静止姿态合成图层。mode：body=素体（跳过防具槽）/ worn=穿戴 / armor-only=只画防具槽（落点诊断）。 */
async function buildLayers(mode) {
  const layers = [];
  for (const slot of newDoc.slots.slice().sort((a, b) => a.z - b.z)) {
    const att = slot.attachment;
    if (!att || att.type !== 'image' || att.visible === false) continue;
    const isArmor = slot.id.startsWith('armor') || slot.id === 'helmet';
    if (mode === 'body' && isArmor) continue;
    if (mode === 'armor-only' && !isArmor) continue;
    // 头三态/hair 三态：只画当前朝向可见的槽位（对齐运行时 head 槽显隐计划）
    if (slot.id in plan && plan[slot.id] !== true) continue;
    // 形态图：附件声明了 directionOffsets 时正面画 front 基准；head 三态用附件实际 assetId
    const assetId = slot.id in HEAD_FORMS ? att.assetId : (att.directionOffsets?.front?.assetId || att.assetId || '');
    const m = /^player-girl-001\.parts\.([A-Za-z0-9_-]+)-(front|side|up)$/.exec(assetId);
    if (!m) continue;
    const file = `${OUT_DIR}/${m[1]}-${m[2]}.png`;
    let img;
    try { img = await sharp(file).toBuffer(); } catch { continue; }
    const bone = world.get(slot.bone);
    const rad = bone.rad;
    const ax = (att.x || 0) * Math.cos(rad) - (att.y || 0) * Math.sin(rad);
    const ay = (att.x || 0) * Math.sin(rad) + (att.y || 0) * Math.cos(rad);
    const netDeg = bone.rad / DEG + (att.rot || 0);
    const rotated = await sharp(img).rotate(netDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const meta = await sharp(rotated).metadata();
    const dw = att.width > 0 ? att.width : meta.width;
    const dh = att.height > 0 ? att.height : meta.height;
    layers.push({
      input: await sharp(rotated).resize(Math.round(dw), Math.round(dh), { fit: 'fill' }).png().toBuffer(),
      left: Math.round(bone.x + ax - dw / 2 + OX),
      top: Math.round(bone.y + ay - dh / 2 + OY),
      _slot: slot.id
    });
    if (mode === 'armor-only') console.log(`  [armor] ${slot.id} z${slot.z} bone(${Math.round(bone.x * 10) / 10},${Math.round(bone.y * 10) / 10}) rot=${Math.round(bone.rad / DEG)}+${att.rot || 0} att(${att.x},${att.y}) asset=${att.assetId} -> @(${Math.round(bone.x + ax - dw / 2 + OX)},${Math.round(bone.y + ay - dh / 2 + OY)})`);
  }
  return layers;
}

async function composePreview(layers, outFile) {
  const base = await sharp({ create: { width: CW, height: CH, channels: 4, background: { r: 42, g: 46, b: 54, alpha: 1 } } })
    .composite(layers).png().toBuffer();
  await sharp(base).resize(CW * 4, CH * 4, { kernel: 'nearest' }).png().toFile(outFile);
}

const bodyLayers = await buildLayers('body');
console.log('素体预览图层:', bodyLayers.map(l => l._slot).join(' '));
await composePreview(bodyLayers, 'Temp/player-girl-001-preview.png');
const wornLayers = await buildLayers('worn');
console.log('穿戴预览图层:', wornLayers.map(l => `${l._slot}@(${l.left},${l.top})`).join(' '));
await composePreview(wornLayers, 'Temp/player-girl-001-worn-preview.png');
const armorLayers = await buildLayers('armor-only');
await composePreview(armorLayers, 'Temp/player-girl-001-armor-only-preview.png');
console.log(`written: ${SKELETON_OUT}（骨骼 ${doc.bones.length} / 槽 ${doc.slots.length} / 剪辑 ${doc.clips.length}）`);
console.log(`parts: ${written.size * 3} + gear ${Object.keys(gearWritten).length * 3} png under ${OUT_DIR}/`);
console.log('preview: Temp/player-girl-001-preview.png + Temp/player-girl-001-worn-preview.png');
