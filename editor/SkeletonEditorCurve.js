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

/**
 * SkeletonEditorCurve - 时间轴曲线编辑器纯函数助手（贝塞尔手柄 / 按属性分轨）
 *
 * 操作对象是骨骼 JSON 文档的 clip.tracks[]（authoring 形态）：
 *   { bone, keys: [{ t, x, y, rot, scaleX, scaleY, ease?, in?: {x,y}, out?: {x,y}, hold? }] }
 *
 * 「按属性分轨」：一条骨骼轨道的 x/y/rot/scaleX/scaleY 各自独立成曲线，
 * 键的某字段非 null 即该属性在此时刻有键（listPropertyKeys 分列提取）。
 *
 * 贝塞尔控制点语义与 src/animation/SkeletonCurve.js 严格一致（Unity 切线约定，
 * 两端切线都按正向时间表达）——段 A→B 的控制点在绝对 t/v 空间为：
 *   P1 = (A.t + out.x·span, A.v + out.y·delta)
 *   P2 = (B.t − in.x·span,  B.v − in.y·delta)
 * 其中 span=B.t−A.t、delta=B.v−A.v。曲线采样直接复用引擎 sampleNumericCurve
 * （与运行时同一插值语义，不另写插值），编辑器预览 = 运行时表现。
 */

import { sampleNumericCurve } from '../src/animation/SkeletonCurve.js';

/** 曲线面板可编辑的属性分轨（field 与关键帧字段名一致）。 */
export const CURVE_PROPERTIES = Object.freeze([
  { field: 'x', label: 'X 位移', color: '#4fc3f7' },
  { field: 'y', label: 'Y 位移', color: '#aed581' },
  { field: 'rot', label: '旋转', color: '#ffd479' },
  { field: 'scaleX', label: '缩放X', color: '#f48fb1' },
  { field: 'scaleY', label: '缩放Y', color: '#ce93d8' }
]);

/** 拖拽手柄时切线 y 的钳制范围（|y|>1 = overshoot 回弹，放开到 ±2 覆盖预备/跟随动作）。 */
export const HANDLE_Y_LIMIT = 2;

/**
 * 提取某属性的键序列（按属性分轨的分列视图）。
 * @param {Object} track - 轨道 { bone, keys }
 * @param {string} field - 属性字段名（x/y/rot/scaleX/scaleY）
 * @returns {Array<{key: Object, index: number, t: number, v: number}>}
 *          index 是 track.keys 里的原始下标（与时间轴 dope sheet 的 data-index 对齐）
 */
export function listPropertyKeys(track, field) {
  const keys = Array.isArray(track?.keys) ? track.keys : [];
  return keys
    .map((key, index) => ({ key, index, t: key.t, v: key[field] }))
    .filter(entry => entry.v != null)
    .sort((a, b) => a.t - b.t);
}

/**
 * 值域计算：min/max 各向外扩 padRatio；全等值（零跨度）时给 ±1 假跨度，
 * 保证单键/平直曲线也能画出可读的坐标网格。
 * @param {Array<{v: number}>} entries - 属性键序列
 * @param {number} [padRatio] - 外扩比例（默认 0.15）
 * @returns {{min: number, max: number}}
 */
export function computeValueRange(entries, padRatio = 0.15) {
  let min = Infinity;
  let max = -Infinity;
  for (const entry of entries || []) {
    if (entry.v < min) min = entry.v;
    if (entry.v > max) max = entry.v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (max - min < 1e-9) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * padRatio;
  return { min: min - pad, max: max + pad };
}

/**
 * 段 A→B 的两个贝塞尔控制点（绝对 t/v 空间）。
 * 某端无手柄返回 null（渲染时该侧不画手柄；插值端缺省按 (1/3,1/3) 补齐）。
 * span<=0（同刻键）时控制点无定义，两侧都返回 null。
 * @param {{t:number, v:number, key:Object}} a - 段起点 entry
 * @param {{t:number, v:number, key:Object}} b - 段终点 entry
 * @returns {{p1: {t:number,v:number}|null, p2: {t:number,v:number}|null}}
 */
export function segmentControlPoints(a, b) {
  const span = b.t - a.t;
  if (!(span > 0)) return { p1: null, p2: null };
  const delta = b.v - a.v;
  const p1 = a.key?.out
    ? { t: a.t + a.key.out.x * span, v: a.v + a.key.out.y * delta }
    : null;
  const p2 = b.key?.in
    ? { t: b.t - b.key.in.x * span, v: b.v - b.key.in.y * delta }
    : null;
  return { p1, p2 };
}

/**
 * 第 i 个键的入/出手柄绝对坐标（画布渲染与命中测试共用）。
 * out 手柄挂在「本键→下一键」段上，in 手柄挂在「上一键→本键」段上；
 * 边界键（无邻键）或邻段 span<=0 时对应侧为 null。
 * @param {Array<{key:Object, t:number, v:number}>} entries - listPropertyKeys 产物
 * @param {number} i - entries 下标
 * @returns {{in: {t:number,v:number}|null, out: {t:number,v:number}|null}}
 */
export function keyHandlePoints(entries, i) {
  const entry = entries[i];
  if (!entry) return { in: null, out: null };
  const prev = entries[i - 1] || null;
  const next = entries[i + 1] || null;
  const result = { in: null, out: null };
  if (prev) {
    const { p2 } = segmentControlPoints(prev, entry);
    result.in = p2;
  }
  if (next) {
    const { p1 } = segmentControlPoints(entry, next);
    result.out = p1;
  }
  return result;
}

/**
 * 拖拽手柄写回：把鼠标点（绝对 t/v）归一化为控制点坐标并写进键。
 *
 * - x 按「相对锚键的时间占比」钳制 [0,1]（保证时间单调，段内控制点不越过键）；
 * - y 按「相对锚键的值变化占比」计算并钳制 ±HANDLE_Y_LIMIT；
 * - delta≈0（水平段）时 y 无效果（整段斜率恒 0），保留原 y 不被拖拽破坏。
 *
 * 只写受拖拽的一侧；段另一端的手柄不动（缺省侧插值时按 (1/3,1/3) 补齐）。
 *
 * @param {{key:Object, t:number, v:number}} a - 段起点 entry
 * @param {{key:Object, t:number, v:number}} b - 段终点 entry
 * @param {'in'|'out'} which - 拖拽的手柄（out=起点出向 / in=终点入向）
 * @param {number} pointT - 鼠标时间坐标（ms）
 * @param {number} pointV - 鼠标值坐标
 * @returns {{x:number,y:number}|null} 写入的控制点（span<=0 时返回 null 不写）
 */
export function applyHandleDrag(a, b, which, pointT, pointV) {
  const span = b.t - a.t;
  if (!(span > 0)) return null;
  const delta = b.v - a.v;
  let x;
  let y;
  let prevY;
  if (which === 'out') {
    // out：控制点 = (a.t + x·span, a.v + y·delta) → y=(pointV−a.v)/delta
    x = Math.max(0, Math.min(1, (pointT - a.t) / span));
    prevY = a.key.out?.y;
    y = (pointV - a.v) / delta;
  } else {
    // in：控制点 = (b.t − x·span, b.v − y·delta) → y=(b.v−pointV)/delta（与 out 侧符号相反）
    x = Math.max(0, Math.min(1, (b.t - pointT) / span));
    prevY = b.key.in?.y;
    y = (b.v - pointV) / delta;
  }
  // delta≈0（水平段）：整段斜率恒 0，y 无效果——保留原 y 不被拖拽破坏
  const clampedY = Math.abs(delta) < 1e-9
    ? (prevY ?? 1 / 3)
    : Math.max(-HANDLE_Y_LIMIT, Math.min(HANDLE_Y_LIMIT, y));
  const handle = { x, y: clampedY };
  if (which === 'out') a.key.out = handle;
  else b.key.in = handle;
  return handle;
}

/** 缓动预设（作用于选中键的「出向段」= 本键→下一键；控制点取值见 SkeletonCurve 头注释的 CSS 对照）。 */
export const HANDLE_PRESETS = Object.freeze([
  { id: 'linear', label: '线性', title: '删除本段两端手柄，回到匀速直线' },
  { id: 'easeIn', label: '缓入', title: '慢起快收（CSS ease-in）' },
  { id: 'easeOut', label: '缓出', title: '快起慢收（CSS ease-out）' },
  { id: 'easeInOut', label: '缓入缓出', title: '两端减速（CSS ease-in-out）' },
  { id: 'hold', label: '保持', title: '阶跃：本键到下一键值恒为本键值' },
  { id: 'clear', label: '清除手柄', title: '删除本键出向手柄与 hold（回命名缓动/线性）' }
]);

/**
 * 应用缓动预设到段 A→B（A=选中键，B=下一键）。直接改写 entry.key（就地变更）。
 *
 * 预设按「整段形状」写两端控制点：
 *   easeIn  → A.out={0.42,0}  B.in={0,0}     （对应 cubic-bezier(0.42,0,1,1)）
 *   easeOut → A.out={0,0}     B.in={0.42,0}  （对应 cubic-bezier(0,0,0.58,1)）
 *   easeInOut → A.out={0.42,0} B.in={0.42,0} （对应 cubic-bezier(0.42,0,0.58,1)）
 * linear/clear 会同时清掉段上的 hold。
 *
 * @param {{key:Object}} a - 段起点 entry（选中键）
 * @param {{key:Object}|null} b - 段终点 entry（下一键；null 时仅 hold/clear/linear 有意义）
 * @param {string} presetId - HANDLE_PRESETS 的 id
 * @returns {boolean} 是否有写入
 */
export function applyOutPreset(a, b, presetId) {
  if (!a?.key) return false;
  const keyA = a.key;
  switch (presetId) {
    case 'linear':
      delete keyA.out;
      delete keyA.hold;
      if (b?.key) delete b.key.in;
      return true;
    case 'easeIn':
      if (!b) return false;
      keyA.out = { x: 0.42, y: 0 };
      b.key.in = { x: 0, y: 0 };
      return true;
    case 'easeOut':
      if (!b) return false;
      keyA.out = { x: 0, y: 0 };
      b.key.in = { x: 0.42, y: 0 };
      return true;
    case 'easeInOut':
      if (!b) return false;
      keyA.out = { x: 0.42, y: 0 };
      b.key.in = { x: 0.42, y: 0 };
      return true;
    case 'hold':
      keyA.hold = true;
      return true;
    case 'clear':
      delete keyA.out;
      delete keyA.hold;
      return true;
    default:
      return false;
  }
}

/**
 * 采样曲线折线（画布渲染用）：直接复用引擎 sampleNumericCurve，
 * 与运行时逐帧采样同一插值语义（hold / 贝塞尔 / 命名缓动），预览即所得。
 *
 * @param {Array<{key:Object, t:number, v:number}>} entries - listPropertyKeys 产物
 * @param {number} durationMs - 剪辑时长
 * @param {boolean} loop - 剪辑是否循环（循环时末段自动回插首键）
 * @param {number} [steps] - 采样步数（默认 120）
 * @returns {Array<{t:number, v:number}>}
 */
export function sampleCurvePolyline(entries, durationMs, loop, steps = 120) {
  if (!entries || entries.length === 0 || !(durationMs > 0)) return [];
  const keys = entries.map(entry => ({
    t: entry.t,
    v: entry.v,
    ease: entry.key?.ease,
    in: entry.key?.in,
    out: entry.key?.out,
    hold: entry.key?.hold
  }));
  const points = [];
  const stepMs = durationMs / Math.max(1, steps);
  for (let i = 0; i <= steps; i += 1) {
    const time = Math.min(durationMs, i * stepMs);
    points.push({ t: time, v: sampleNumericCurve(keys, time, loop === true, durationMs) });
  }
  return points;
}
