/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-08
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * slice-skirt-girl-art - 短裙女真美术切片管线
 *
 * 输入：example/sanguo_zhangjiao/assets/images/skirt-girl/src/view-<view>.jpg
 *       （AI 生成的 5 视角全身像素立绘，纯品红 #FF00FF 底，view ∈ front/side/up/se/ne）
 * 输出：example/sanguo_zhangjiao/assets/images/skirt-girl/parts/<part>-<view>.png
 *       （6 部件 × 5 视角：head/skirt/arm/armL 64×64、torso 64×80、leg 64×96——图片中心 = 骨骼挂点；
 *        arm=右臂、armL=左臂，A-pose 张开姿态左右不对称需分开切）
 * 同时：把 skirt-girl.json 的臂/腿/头骨骼枢轴校正到美术真实位置（肩/髋/颈）。
 *
 * 切片语义（世界坐标，feet=0，身高 76）：
 *   身体统一缩放 s = 76 / 裁剪后身高；骨骼枢轴 = 美术上对应的世界高度：
 *   head -59（颈）/ torso -30（髋）/ skirt -28 / arm ±10,-58（肩）/ leg ±5,-44（髋关节）
 * 地标自动检测：裙红行 → 腰/裙摆；白衬衫行 → 肩；窄肤色游程 → 颈；肤色带游程 → 手臂；
 * 腿间隙 → 单腿切分。AI 各视角比例漂移大，禁用固定人体比例，全部走颜色地标。
 *
 * 用法：node scripts/slice-skirt-girl-art.mjs
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'example/sanguo_zhangjiao/assets/images/skirt-girl/src');
const PARTS_DIR = join(ROOT, 'example/sanguo_zhangjiao/assets/images/skirt-girl/parts');
const SKELETON = join(ROOT, 'example/sanguo_zhangjiao/assets/skeletons/skirt-girl.json');
const MANIFEST = join(ROOT, 'example/sanguo_zhangjiao/assets/manifests/assets.json');

/** 目标身高（世界 px，feet=0 → 头顶 -76）。 */
const BODY_HEIGHT = 76;
/** 骨骼枢轴世界高度（负=向上）。 */
const BONE = { head: -59, torso: -30, skirt: -28, arm: -58, leg: -44 };
/** 人体解剖比例（占身高，自头顶向下）。 */
// 颈/手位置不再用固定比例——AI 各视角比例漂移大（下巴 0.17~0.23），改为颜色地标检测。

/** 视角配置：dualArms=左右臂是否都在场可各切一条（side 只有一条可见臂），legSide=取哪条腿。 */
const VIEWS = {
  front: { file: 'view-front.jpg', dualArms: true, legSide: 'right' },
  side: { file: 'view-side.jpg', dualArms: false, legSide: 'left' },
  up: { file: 'view-up.jpg', dualArms: true, legSide: 'right' },
  se: { file: 'view-se.jpg', dualArms: true, legSide: 'right' },
  ne: { file: 'view-ne.jpg', dualArms: true, legSide: 'right' }
};

/* ---------------- 像素工具 ---------------- */

function loadRaw(file) {
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => ({ data, w: info.width, h: info.height }));
}

/** 从边缘泛洪抠底：与角点参考色相近（品红底 + JPEG 边缘过渡）→ 透明。 */
function keyBackground(img) {
  const { data, w, h } = img;
  const ref = [0, 0];
  for (const [cx, cy] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) {
    const i = (cy * w + cx) * 4;
    ref[0] += data[i]; ref[1] += data[i + 1];
  }
  ref[0] /= 4; ref[1] /= 4;
  const TOL = 118;
  const isBg = i => {
    const dr = data[i] - ref[0], dg = data[i + 1] - ref[1], db = data[i + 2] - 255;
    // 品红参考 (refR, refG, 255)：距离 + 品红特征双条件
    const magentaish = data[i] > 165 && data[i + 2] > 165 && data[i + 1] < 150;
    return (dr * dr + dg * dg + db * db) < TOL * TOL || magentaish;
  };
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const push = (x, y) => {
    const p = y * w + x;
    if (visited[p]) return;
    visited[p] = 1;
    if (!isBg(p * 4)) return;
    data[p * 4 + 3] = 0;
    queue[tail++] = p;
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  // 全局品红清扫：泛洪只够到连通背景，手臂与身体之间等封闭区残留品红，这里全图扫掉。
  // 裙红 B 通道低、肤色 B 偏低，均不满足品红特征，安全。
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (data[i + 3] && data[i] > 165 && data[i + 2] > 165 && data[i + 1] < 150) data[i + 3] = 0;
  }
  return img;
}

/** alpha 收缩 1px（去 JPEG 边缘品红描边）。 */
function erodeAlpha(img) {
  const { data, w, h } = img;
  const src = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) src[p] = data[p * 4 + 3];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!src[p]) continue;
      let min = 255;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        min = Math.min(min, src[p + dy * w + dx]);
      }
      data[p * 4 + 3] = min;
    }
  }
  return img;
}

/** 去噪：小于 minArea 的不透明连通块清掉。 */
function despeckle(img, minArea = 60) {
  const { data, w, h } = img;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const comp = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !data[start * 4 + 3]) continue;
    let top = 0, n = 0;
    stack[top++] = start; seen[start] = 1;
    while (top > 0) {
      const p = stack[--top]; comp[n++] = p;
      const x = p % w, y = (p / w) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!seen[q] && data[q * 4 + 3]) { seen[q] = 1; stack[top++] = q; }
      }
      if (n > minArea) break;
    }
    if (n <= minArea) for (let k = 0; k < n; k++) data[comp[k] * 4 + 3] = 0;
    comp.length = 0;
  }
  return img;
}

function alphaBounds(img) {
  const { data, w, h } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 8) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1 };
}

/** 行统计：predicate(r,g,b,a) 命中数。 */
function rowProfile(img, y, predicate) {
  const { data, w } = img;
  let count = 0;
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (data[i + 3] > 8 && predicate(data[i], data[i + 1], data[i + 2])) count++;
  }
  return count;
}

function columnProfile(img, y0, y1, x0, x1) {
  const { data, w } = img;
  const profile = new Float32Array(x1 - x0 + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (data[(y * w + x) * 4 + 3] > 8) profile[x - x0] += 1;
  }
  return profile;
}

function centroidX(img, y0, y1, x0, x1) {
  const { data, w } = img;
  let sum = 0, n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (data[(y * w + x) * 4 + 3] > 8) { sum += x; n++; }
  }
  return n ? sum / n : (x0 + x1) / 2;
}

const isRed = (r, g, b) => r > 170 && g < 90 && b < 95 && r - g > 90 && r - b > 85; // 裙亮红；嘴/鞋棕/膝盖抓痕均排除
const isWhite = (r, g, b) => r > 222 && g > 222 && b > 222;
const isSkin = (r, g, b) => r > 195 && g > 140 && b > 110 && r > g && g >= b && r - b > 40;

/* ---------------- 部件光栅化 ---------------- */

/**
 * 把源图 band（行 [yBand0..yBand1] × 列窗口）按统一缩放 s 贴到画布：
 * 源锚点 (ax, ay) ↔ 画布锚点 (32, anchorCanvasY)，最近邻逆映射（无空洞）。
 */
function rasterize(img, { yBand0, yBand1, xWin, ax, ay, canvasW = 64, canvasH = 64, anchorCanvasY = 32, s, filterPx }) {
  const { data, w } = img;
  const out = Buffer.alloc(canvasW * canvasH * 4);
  const xs = xWin ? [xWin[0], xWin[1]] : [0, w - 1];
  // 画布目标包围盒 = band 四角逆映射
  const corners = [[xs[0], yBand0], [xs[1], yBand0], [xs[0], yBand1], [xs[1], yBand1]];
  let cx0 = 1e9, cy0 = 1e9, cx1 = -1e9, cy1 = -1e9;
  for (const [sx, sy] of corners) {
    const px = 32 + (sx - ax) * s, py = anchorCanvasY + (sy - ay) * s;
    cx0 = Math.min(cx0, px); cy0 = Math.min(cy0, py);
    cx1 = Math.max(cx1, px); cy1 = Math.max(cy1, py);
  }
  cx0 = Math.max(0, Math.floor(cx0) - 1); cy0 = Math.max(0, Math.floor(cy0) - 1);
  cx1 = Math.min(canvasW - 1, Math.ceil(cx1) + 1); cy1 = Math.min(canvasH - 1, Math.ceil(cy1) + 1);
  for (let cy = cy0; cy <= cy1; cy++) {
    const sy = Math.round(ay + (cy - anchorCanvasY) / s);
    if (sy < yBand0 || sy > yBand1) continue;
    for (let cx = cx0; cx <= cx1; cx++) {
      const sx = Math.round(ax + (cx - 32) / s);
      if (sx < xs[0] || sx > xs[1]) continue;
      const si = (sy * w + sx) * 4;
      if (data[si + 3] < 8) continue;
      if (filterPx && !filterPx(data[si], data[si + 1], data[si + 2])) continue;
      const di = (cy * canvasW + cx) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
    }
  }
  return { data: out, w: canvasW, h: canvasH };
}

const toPng = (img, file) => sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } }).png().toFile(file);

/* ---------------- 单视角处理 ---------------- */

function detectLandmarks(img, view) {
  const { w } = img;
  const { x0, y0, x1, y1 } = alphaBounds(img);
  const H = y1 - y0;
  const bodyW = x1 - x0;
  const cx = (x0 + x1) / 2;
  const minCount = Math.max(4, Math.round(bodyW * 0.05));
  // 地标按依赖顺序检测（结构化守卫，避免嘴部深红/鞋棕混入裙红判定）：
  // 肩 = 全图最高白衬衫行（眼白/高光行命中数远低于 minCount）→ 腰 = 肩以下首条裙红行
  // → 裙摆 = 腰以下末条裙红行
  let shoulderRow = -1;
  for (let y = y0; y <= y1; y++) {
    if (rowProfile(img, y, isWhite) >= minCount) { shoulderRow = y; break; }
  }
  if (shoulderRow < 0) throw new Error(`${view}: 未检测到白衬衫行`);
  let waistRow = -1, hemRow = -1;
  for (let y = shoulderRow + 2; y <= y1; y++) {
    if (rowProfile(img, y, isRed) >= minCount) { if (waistRow < 0) waistRow = y; hemRow = y; }
  }
  if (waistRow < 0) throw new Error(`${view}: 未检测到裙红行`);
  // 颈：领口上方 8% 身高带内最靠下的窄肤色游程（脸宽游程被排除；
  // 带宽收窄防头发浅棕高光误命中；遮颈时回退肩线上方 4% 身高）
  const lo = Math.max(y0, shoulderRow - Math.round(H * 0.08));
  let neckRow = -1, neckX = cx;
  for (let y = shoulderRow - 2; y >= lo; y--) {
    const runs = skinRunsInRow(img, y, x0, x1);
    const narrow = runs.find(r => r[1] - r[0] >= 3 && r[1] - r[0] < bodyW * 0.18);
    if (narrow) { neckRow = y; neckX = (narrow[0] + narrow[1]) / 2; break; }
  }
  if (neckRow < 0) { neckRow = shoulderRow - Math.round(H * 0.04); }
  const rowFor = worldY => y1 - Math.round((-worldY / BODY_HEIGHT) * H); // 骨骼世界高度 → 源图行
  const s = BODY_HEIGHT / H;
  return { x0, y0, x1, y1, H, s, cx, bodyW, waistRow, hemRow, shoulderRow, neckRow, neckX, rowFor };
}

/** 单行肤色游程（颈部定位）。 */
function skinRunsInRow(img, y, x0, x1) {
  const runs = [];
  let start = -1;
  for (let x = x0; x <= x1 + 1; x++) {
    let hit = false;
    if (x <= x1) {
      const i = (y * img.w + x) * 4;
      hit = img.data[i + 3] > 8 && isSkin(img.data[i], img.data[i + 1], img.data[i + 2]);
    }
    if (hit) { if (start < 0) start = x; }
    else if (start >= 0) { runs.push([start, x - 1]); start = -1; }
  }
  return runs;
}

/** 窗口内某行是否存在命中色的像素。 */
function rowHasColor(img, y, x0, x1, predicate) {
  const { w } = img;
  for (let x = x0; x <= x1; x++) {
    const i = (y * w + x) * 4;
    if (data(img, i) && predicate(img.data[i], img.data[i + 1], img.data[i + 2])) return true;
  }
  return false;
}

/** 窗口内某列是否存在命中色的像素。 */
function columnHasColor(img, x, y0, y1, predicate) {
  const { h } = img;
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
    const i = (y * img.w + x) * 4;
    if (data(img, i) && predicate(img.data[i], img.data[i + 1], img.data[i + 2])) return true;
  }
  return false;
}

/** 肤色列游程（手臂定位）：带内逐行累积皮肤命中列。run = [start, end, topRow]。 */
function skinRuns(img, y0, y1) {
  const { w } = img;
  const hits = new Uint8Array(w);
  for (let y = y0; y <= y1; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (data(img, i) && isSkin(img.data[i], img.data[i + 1], img.data[i + 2])) hits[x] = 1;
  }
  const runs = [];
  let start = -1;
  for (let x = 0; x <= w; x++) {
    if (x < w && hits[x]) { if (start < 0) start = x; }
    else if (start >= 0) { if (x - start > 6) runs.push([start, x - 1]); start = -1; }
  }
  // 每游程带内最高皮肤行：贴肩线即有皮肤 = 脸/颈/胸（se 低头大头的脸延伸到肩线以下，
  // 列投影无法与手臂区分，靠「从带顶就有皮肤」区分）
  for (const r of runs) {
    r[2] = -1;
    for (let y = y0; y <= y1 && r[2] < 0; y++) {
      for (let x = r[0]; x <= r[1]; x++) {
        const i = (y * w + x) * 4;
        if (img.data[i + 3] > 8 && isSkin(img.data[i], img.data[i + 1], img.data[i + 2])) { r[2] = y; break; }
      }
    }
  }
  return runs;
}
function data(img, i) { return img.data[i + 3] > 8; }

/** 手臂游程挑选：丢脸/颈/胸皮肤（贴肩线即有皮肤、或贴中轴）→ 合并小隙 → 宽度过滤 → 按 side 取。 */
function pickRun(runs, side, L) {
  if (runs.length === 0) return null;
  const cands = runs.filter(r => r[2] > L.shoulderRow + 2
    && Math.abs((r[0] + r[1]) / 2 - L.cx) >= L.bodyW * 0.15);
  if (cands.length === 0) return null;
  const merged = [cands[0].slice(0, 2)];
  for (let k = 1; k < cands.length; k++) {
    const last = merged[merged.length - 1];
    if (cands[k][0] - last[1] <= 10) last[1] = Math.max(last[1], cands[k][1]);
    else merged.push(cands[k].slice(0, 2));
  }
  const minW = Math.max(8, Math.round(L.bodyW * 0.04));
  const kept = merged.filter(r => r[1] - r[0] >= minW);
  if (kept.length === 0) return null;
  if (side === 'auto') return kept.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  const scored = kept.map(r => [r, side === 'right' ? r[1] : -r[0]]);
  scored.sort((a, b) => b[1] - a[1]);
  return scored[0][0];
}

/** 切单臂：side='right' 取最右肤色游程，'left' 取最左（装配按世界朝向分边，
 * 图像最左臂=世界左臂，背面视角同理成立）。臂顶 = 窗口内最高皮肤行（袖子归躯干图），
 * 手尖 = 窗口内皮肤最低行，锚点 = 臂顶质心（肩点），滤裙红碎片。 */
function sliceArm(img, L, s, side) {
  const H = L.H;
  const runs = skinRuns(img, L.shoulderRow, L.hemRow);
  const run = pickRun(runs, side, L);
  if (!run) throw new Error(`${side} 臂：未找到肤色游程`);
  const padW = Math.max(6, Math.round(H * 0.015));
  const wx0 = Math.max(L.x0, run[0] - padW), wx1 = Math.min(L.x1, run[1] + padW);
  let armTop = -1;
  for (let y = L.shoulderRow; y <= L.hemRow; y++) {
    if (rowHasColor(img, y, wx0, wx1, isSkin)) { armTop = y; break; }
  }
  if (armTop < 0) throw new Error(`${side} 臂：窗口内未找到皮肤行`);
  let handTip = armTop;
  for (let y = armTop; y <= L.hemRow + Math.round(H * 0.02); y++) {
    if (rowHasColor(img, y, wx0, wx1, isSkin)) handTip = y;
  }
  const armAX = centroidX(img, armTop, Math.min(armTop + 4, L.hemRow), wx0, wx1);
  return rasterize(img, {
    yBand0: armTop, yBand1: handTip + 4, xWin: [wx0, wx1],
    ax: armAX, ay: L.rowFor(BONE.arm), s,
    filterPx: (r, g, b) => !isRed(r, g, b)   // 窗口贴裙摆时去手旁裙红碎片
  });
}

async function sliceViewAsync(view, cfg) {
  const img = despeckle(erodeAlpha(keyBackground(await loadRaw(join(SRC_DIR, cfg.file)), cfg)));
  const L = detectLandmarks(img, view);
  console.log(`  [${view}] 肩${L.shoulderRow} 颈${L.neckRow}@${Math.round(L.neckX)} 腰${L.waistRow} 摆${L.hemRow} 脚${L.y1} H${L.H}`);
  const { s, H } = L;
  const outputs = {};

  // 头：发顶 → 领口（肩+3），横锚 = 颈检测 x，纵锚 = 头骨世界高度 rowFor(-59)。
  // 纵锚不能用检测到的颈行——那是领口上方的可见颈（世界约 -66），头骨却在 -59：
  // 错位 ~7px 会让整颗头下沉叠到躯干上（小头视角被头发遮住看不出，se 大头脸穿帮）。
  // 下巴越过领口的部分留在躯干图，两段都按真实世界位摆放，天然无缝。
  outputs.head = rasterize(img, {
    yBand0: L.y0, yBand1: Math.min(L.shoulderRow + 3, L.neckRow + 6), ax: L.neckX, ay: L.rowFor(BONE.head), s
  });

  // 躯干：肩 → 腰（含双袖，静态袖），锚点 = 髋骨世界高度
  const torsoAY = L.rowFor(BONE.torso);
  const torsoX = centroidX(img, torsoAY - 3, torsoAY + 3, 0, img.w - 1);
  // 画布 64×80：肩点最高到世界 -66.5，64 高画布只容骨位(-30)±32=-62 会裁肩。
  // 渲染器以图心=挂点居中绘制（SkeletonRenderer drawImage -w/2,-h/2），
  // 故锚 = 40 = 80/2，上下各容 40px——锚非中值时内容会整体错位 8px。
  outputs.torso = rasterize(img, {
    yBand0: L.shoulderRow - 2, yBand1: L.waistRow + 2, ax: torsoX, ay: torsoAY, s,
    canvasH: 80, anchorCanvasY: 40
  });

  // 裙：腰 → 裙摆，锚点 = 裙骨世界高度。窗口按裙红列范围收紧（±2px）——A-pose 双手
  // 垂在裙摆两侧，isSkin 只滤皮肤填充、手的深色描边会残留成碎块，窗口收紧直接排除
  const skirtAY = L.rowFor(BONE.skirt);
  const skirtX = centroidX(img, L.waistRow - 2, L.waistRow + 2, 0, img.w - 1);
  let redX0 = -1, redX1 = -1;
  for (let x = L.x0; x <= L.x1; x++) {
    if (columnHasColor(img, x, L.waistRow, L.hemRow, isRed)) {
      if (redX0 < 0) redX0 = x;
      redX1 = x;
    }
  }
  if (redX0 < 0) throw new Error(`${view}: 未检测到裙红列范围`);
  outputs.skirt = rasterize(img, {
    yBand0: L.waistRow - 2, yBand1: L.hemRow + 2, xWin: [redX0 - 2, redX1 + 2], ax: skirtX, ay: skirtAY, s,
    filterPx: (r, g, b) => !isSkin(r, g, b)
  });

  // 双臂各切一份：A-pose 张开姿态左右不对称，armL 槽复用右臂图会指向身体内侧。
  // side 只有一条可见臂（dualArms=false）→ armL 复用右臂图；左臂游程缺失时同样兜底复用
  outputs.arm = sliceArm(img, L, s, 'right');
  if (cfg.dualArms) {
    try { outputs.armL = sliceArm(img, L, s, 'left'); }
    catch { console.log(`    ${view}: 左臂游程缺失，复用右臂图`); outputs.armL = outputs.arm; }
  } else {
    outputs.armL = outputs.arm;
  }

  // 腿：裙摆以下 alpha 列廓形找腿间隙 → 取单侧（裙摆以下起切，不含裙），
  // 画布 64×96，锚点 = 髋关节（髋→裙摆段的空档由裙子 z 序覆盖）
  const prof = columnProfile(img, L.hemRow + 3, L.y1 - 2, L.x0, L.x1);
  // 先按廓形 > 25% 峰值圈定最长「腿区」连续段（段外的裙摆缘/空白零列比真腿隙更小，
  // 全域找最小值会切在裙缘 → front 切出双腿、ne 切出 1px）；再在段内找最小间隙为腿缝；
  // 无真隙（侧视并腿/交叉腿，minV > 0.5*maxP）时取段中心切分
  let maxP = 0;
  for (let i = 0; i < prof.length; i++) maxP = Math.max(maxP, prof[i]);
  const th = maxP * 0.25;
  let best = null, cur0 = -1;
  for (let i = 0; i <= prof.length; i++) {
    if (i < prof.length && prof[i] > th) { if (cur0 < 0) cur0 = i; }
    else if (cur0 >= 0) {
      if (!best || i - 1 - cur0 > best[1] - best[0]) best = [cur0, i - 1];
      cur0 = -1;
    }
  }
  if (!best) throw new Error(`${view}: 裙摆以下未检测到腿区`);
  // 段两端各缩 1px 再找最小（段边界列本来就低，取边界当最小会切到腿外缘）
  const lo = best[0] + 1, hi = best[1] - 1;
  let splitIdx = Math.round((best[0] + best[1]) / 2), minV = Infinity;
  for (let i = lo; i <= hi; i++) {
    if (prof[i] < minV) { minV = prof[i]; splitIdx = i; }
  }
  if (minV > maxP * 0.5) splitIdx = Math.round((lo + hi) / 2);
  const splitX = L.x0 + splitIdx;
  console.log(`    腿区[${best[0]},${best[1]}] maxP${Math.round(maxP)} minV${Math.round(minV)} split@${splitX}`);
  const legX0 = cfg.legSide === 'right' ? splitX + 1 : L.x0;
  const legX1 = cfg.legSide === 'right' ? L.x1 : splitX - 1;
  const legAY = L.rowFor(BONE.leg);
  const legAX = centroidX(img, legAY - 4, legAY + 4, legX0, legX1);
  outputs.leg = rasterize(img, {
    yBand0: L.hemRow - 2, yBand1: L.y1, xWin: [legX0, legX1],
    ax: legAX, ay: legAY, canvasH: 96, anchorCanvasY: 48, s
  });

  return outputs;
}

/* ---------------- 骨骼枢轴校正 + 预览 ---------------- */

/** armL 左臂部件 manifest 登记（幂等 upsert，条目形状与 gen 脚本一致）。 */
function upsertArmLManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const byId = new Map(manifest.assets.map(a => [a.assetId, a]));
  for (const view of Object.keys(VIEWS)) {
    const assetId = `skirt-girl.parts.armL-${view}`;
    const relative = `assets/images/skirt-girl/parts/armL-${view}.png`;
    byId.set(assetId, {
      assetId, imageId: assetId, category: 'character-part',
      usage: ['skirt-girl-skeleton-part'],
      sourceFile: relative,
      runtime2D: { path: relative, mode: 'image' },
      runtime3D: { mode: 'billboard', sourceAssetId: assetId },
      pivot: { x: 0.5, y: 0.5 },
      bounds: { width: 64, height: 64 },
      grid: { columns: 1, rows: 1, cellWidth: 64, cellHeight: 64 },
      animations: [], targetPhase: 'P1', status: 'ai-generated', revision: 1
    });
  }
  manifest.assets = [...byId.values()];
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

function updateSkeleton() {
  const doc = JSON.parse(readFileSync(SKELETON, 'utf8'));
  const moves = { head: [0, -29], armL: [-10, -28], armR: [10, -28], legL: [-5, -14], legR: [5, -14] };
  for (const bone of doc.bones) {
    if (moves[bone.id]) { [bone.x, bone.y] = moves[bone.id]; }
  }
  // 部件画布加高：leg 64×96 / torso 64×80（其余 64×64）——渲染器以图心=挂点居中绘制
  const ATT_HEIGHT = { legR: 96, legL: 96, torsoSlot: 80 };
  for (const slot of doc.slots) {
    if (!ATT_HEIGHT[slot.id]) continue;
    const att = slot.attachment;
    att.height = ATT_HEIGHT[slot.id];
    for (const off of Object.values(att.directionOffsets || {})) off.height = att.height;
  }
  // 附件引用修正（全槽位）：
  // ① armL 槽换左臂部件（armL-*）——A-pose 左右臂不对称，右臂图挂左臂会指向内侧；
  // ② up 形态历史 -back 引用改指 -up（gen VIEW_FORMS 旧错把 view 名 'back' 写进 assetId，
  //    而文件/manifest 均以 -up 命名 → 背面躯干/裙/臂丢图）
  for (const slot of doc.slots) {
    const offs = [slot.attachment, ...Object.values(slot.attachment?.directionOffsets || {})];
    for (const off of offs) {
      if (!off || !off.assetId) continue;
      if (slot.id === 'armL') off.assetId = off.assetId.replace('.parts.arm-', '.parts.armL-');
      off.assetId = off.assetId.replace(/\.parts\.([a-zA-Z]+)-back$/, '.parts.$1-up');
    }
  }
  writeFileSync(SKELETON, `${JSON.stringify(doc, null, 2)}\n`);
}

/** 拼装 5 视角 rest pose 预览（×6 放大）。 */
async function composePreview(parts) {
  const SCALE = 6, CELL_W = 64 * SCALE, CELL_H = 96 * SCALE, BASE = CELL_H - 8 * SCALE;
  const ORDER = [['legR', 'leg', 5, -44], ['legL', 'leg', -5, -44], ['torsoSlot', 'torso', 0, -30],
    ['skirtSlot', 'skirt', 0, -28], ['armL', 'armL', -10, -58], ['armR', 'arm', 10, -58], ['headFront', 'head', 0, -59]];
  const canvas = Buffer.alloc(CELL_W * 5 * CELL_H * 4);
  for (let v = 0; v < 5; v++) {
    const view = Object.keys(VIEWS)[v];
    const ox = v * CELL_W;
    for (const [, part, bx, by] of ORDER) {
      const img = parts[view][part];
      const iw = img.w * SCALE, ih = img.h * SCALE;
      const dx = Math.round(ox + CELL_W / 2 + bx * SCALE - iw / 2);
      const dy = Math.round(BASE + by * SCALE - ih / 2);
      for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
        const si = (((y / SCALE) | 0) * img.w + ((x / SCALE) | 0)) * 4;
        if (img.data[si + 3] < 8) continue;
        const px = dx + x, py = dy + y;
        if (px < 0 || py < 0 || px >= CELL_W * 5 || py >= CELL_H) continue;
        const di = (py * CELL_W * 5 + px) * 4;
        canvas[di] = img.data[si]; canvas[di + 1] = img.data[si + 1];
        canvas[di + 2] = img.data[si + 2]; canvas[di + 3] = 255;
      }
    }
  }
  await sharp(canvas, { raw: { width: CELL_W * 5, height: CELL_H, channels: 4 } })
    .png().toFile(join(ROOT, '.tmp-skirt-preview.png'));
}

/* ---------------- 主流程 ---------------- */

console.log('切片短裙女真美术…');
const parts = {};
for (const [view, cfg] of Object.entries(VIEWS)) {
  parts[view] = await sliceViewAsync(view, cfg);
  for (const [part, img] of Object.entries(parts[view])) {
    await toPng(img, join(PARTS_DIR, `${part}-${view}.png`));
  }
  console.log(`  ${view}: head/torso/skirt/arm/leg ✓`);
}
updateSkeleton();
upsertArmLManifest();
await composePreview(parts);
// 真美术保护标记：gen-skirt-girl-skeleton.mjs 见此标记即跳过占位美术生成（防覆盖）
writeFileSync(join(PARTS_DIR, '.real-art'), '真美术切片产物标记（slice-skirt-girl-art.mjs）\n');
console.log('完成：30 张部件图（含 armL 左臂×5）+ manifest 登记 + skirt-girl.json 枢轴校正 + .tmp-skirt-preview.png');
