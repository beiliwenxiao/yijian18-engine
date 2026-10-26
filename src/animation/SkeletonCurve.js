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
 * SkeletonCurve.js - 动画曲线采样核心（纯函数，与 DOM 解耦）
 *
 * schema v2 把「一帧 = 一整份姿态快照」改为「按属性分轨」：
 *   x / y / rot / scaleX / scaleY 各一条独立曲线，每条曲线只包含该属性被打了帧的键。
 * 好处：可以只给旋转打帧而不污染位移；每条曲线可独立插值。
 *
 * 插值模型（Unity AnimationCurve / Spine 切线约定）：
 *   段 A→B 的控制点为 P0=(0,0) P1=(A.out.x, A.out.y) P2=(1-B.in.x, 1-B.in.y) P3=(1,1)，
 *   在「归一化时间 u」与「归一化值域」间做三次贝塞尔映射：
 *   先由 u 反解参数 s（贝塞尔 x 分量单调，二分求解），再用 s 求值 y 分量。
 *   控制点缺省时 P1=(1/3,1/3) P2=(2/3,2/3) —— 此时 x(s)=s 且 y(s)=s，结果恰为线性。
 *
 *   控制点语义（与 Unity 一致，两个切线都按「正向时间」表达）：
 *     - out = 本键出向切线 (dx,dy)：dx 为控制点沿时间的偏移比例，dy 为该处斜率比例。
 *     - in  = 本键入向切线 (dx,dy)：控制点位于 (1-dx, 1-dy)，
 *             即 dx 表示「从本键往回退多少时间比例」，dy 表示「回退时值变化多少比例」。
 *     - 两者的 dy 都按正向时间方向：正值 = 该处仍在上升。
 *   等价 CSS 写法对照（便于美术理解）：
 *     cubic-bezier(x1,y1,x2,y2) ≡ out={x:x1,y:y1}, in={x:1-x2,y:1-y2}
 *     例：CSS ease-in-out cubic-bezier(0.42,0,0.58,1) ≡ out={x:0.42,y:0}, in={x:0.42,y:0}
 *         CSS ease-out     cubic-bezier(0,0,0.58,1)   ≡ out={x:0,y:0},      in={x:0.42,y:0}
 *         CSS ease-in      cubic-bezier(0.42,0,1,1)     ≡ out={x:0.42,y:0},   in={x:0,y:0}
 *
 * 缓动优先级（段 A→B）：
 *   1. A.hold 为真 → 该段为「保持」插值（阶跃，值恒为 A.v）
 *   2. A.out 或 B.in 任一存在 → 走贝塞尔（显式曲线优先）
 *   3. 否则用命名缓动：ease = B.ease || A.ease（与 v1 采样规则一致）
 *   4. 都没有 → 线性
 *
 * 关键帧键结构：
 *   { t, v, ease?, in?: {x,y}, out?: {x,y}, hold?: boolean }
 *   t = 时间(ms)；v = 数值（离散曲线则是任意值）；
 *   ease = 命名缓动（linear / easeInOut），作用于「结束于本键」的段；
 *   out = 本键出向控制点（作用于本键→下一键的段）；
 *   in  = 本键入向控制点（作用于上一键→本键的段）；
 *   hold = 本键→下一键段为「保持」插值（阶跃，常用于阶跃动作/不连续切换）。
 */

/** 命名缓动类型（与 SkeletonAsset / SkeletonAssetValidator 保持一致）。 */
export const CURVE_EASE_TYPES = Object.freeze(['linear', 'easeInOut']);

/** 关键帧时间匹配容差（毫秒）。 */
export const CURVE_TIME_EPSILON = 5;

/** 线性插值。 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * 命名缓动：linear 线性；easeInOut 平滑（smoothstep）。
 * @param {string} ease - 缓动名
 * @param {number} t - 归一化时间 [0,1]
 * @returns {number}
 */
export function applyEase(ease, t) {
  if (ease === 'easeInOut') return t * t * (3 - 2 * t);
  return t;
}

/** 三次贝塞尔 x 分量（控制点 x 坐标序列）。 */
function bezierX(s, x1, x2) {
  const ms = 1 - s;
  return 3 * ms * ms * s * x1 + 3 * ms * s * s * x2 + s * s * s;
}

/** 三次贝塞尔 y 分量（控制点 y 坐标序列）。 */
function bezierY(s, y1, y2) {
  const ms = 1 - s;
  return 3 * ms * ms * s * y1 + 3 * ms * s * s * y2 + s * s * s;
}

/**
 * 由归一化时间 u 反解贝塞尔参数 s（二分法：x(s) 单调递增，20 次迭代精度足够）。
 * @param {number} u - 归一化时间 [0,1]
 * @param {number} x1 - 第一控制点 x
 * @param {number} x2 - 第二控制点 x
 * @returns {number} 参数 s [0,1]
 */
function solveBezierParam(u, x1, x2) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 20; i += 1) {
    const mid = (low + high) / 2;
    if (bezierX(mid, x1, x2) < u) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * 段 A→B 的插值：返回归一化进度 [0,1]（已含缓动/贝塞尔形变）。
 *
 * 本函数是「段插值语义」的单一来源：hold → 贝塞尔 → 命名缓动 → 线性。
 * SkeletonPose.sampleField 与编辑器曲线面板都必须复用它（或经 sampleNumericCurve
 * 间接复用），禁止另写一份插值——语义漂移会导致编辑器预览与运行时表现不一致。
 *
 * @param {Object} keyA - 起始键
 * @param {Object} keyB - 结束键
 * @param {number} u - 段内归一化时间 [0,1]
 * @returns {number}
 */
export function segmentProgress(keyA, keyB, u) {
  if (keyA?.hold === true) return 0; // 保持插值：值恒为 A.v
  const hasHandles = !!(keyA?.out || keyB?.in);
  if (hasHandles) {
    const x1 = keyA?.out?.x ?? 1 / 3;
    const y1 = keyA?.out?.y ?? 1 / 3;
    const x2 = 1 - (keyB?.in?.x ?? 1 / 3);
    const y2 = 1 - (keyB?.in?.y ?? 1 / 3);
    const s = solveBezierParam(u, x1, x2);
    return bezierY(s, y1, y2);
  }
  const ease = keyB?.ease || keyA?.ease || 'linear';
  return applyEase(ease, u);
}

/**
 * 采样数值曲线。
 *
 * 时间在首键之前 → 保持首值；在末键之后：
 *   - 循环剪辑 → 与首键之间按段插值（首尾衔接处平滑回绕）；
 *   - 非循环 → 保持末值（一次性动作 hold 语义）。
 *
 * @param {Array<Object>} keys - 曲线键（按 t 升序）
 * @param {number} timeMs - 剪辑内时间
 * @param {boolean} [loop] - 剪辑是否循环
 * @param {number} [durationMs] - 剪辑时长（循环回绕用）
 * @returns {number} 采样值
 */
export function sampleNumericCurve(keys, timeMs, loop = false, durationMs = 0) {
  if (!keys || !keys.length) return 0;
  const first = keys[0];
  const last = keys[keys.length - 1];
  const time = Math.max(0, Math.min(Number(timeMs) || 0, durationMs > 0 ? durationMs : Number(timeMs) || 0));
  if (time <= first.t) return first.v;
  if (time >= last.t) {
    // 循环回绕段：末键 → 首键，在 [last.t, durationMs] 区间内插值（首尾姿态一致处无跳变）
    if (loop === true && durationMs > last.t) {
      const span = durationMs - last.t;
      const ratio = span > 0 ? (time - last.t) / span : 0;
      return lerp(last.v, first.v, segmentProgress(last, first, ratio));
    }
    return last.v;
  }
  let upper = 1;
  while (upper < keys.length && keys[upper].t < time) upper += 1;
  const keyA = keys[upper - 1];
  const keyB = keys[upper];
  const span = keyB.t - keyA.t;
  const u = span > 0 ? (time - keyA.t) / span : 0;
  return lerp(keyA.v, keyB.v, segmentProgress(keyA, keyB, u));
}

/**
 * 采样离散曲线（附件 assetId 切换等）：保持上一键的值直到下一键（阶跃插值）。
 *
 * @param {Array<Object>} keys - 曲线键（按 t 升序）
 * @param {number} timeMs - 剪辑内时间
 * @param {boolean} [loop] - 剪辑是否循环
 * @param {number} [durationMs] - 剪辑时长
 * @returns {*} 采样值（键不存在时返回 null）
 */
export function sampleDiscreteCurve(keys, timeMs, loop = false, durationMs = 0) {
  if (!keys || !keys.length) return null;
  const first = keys[0];
  const last = keys[keys.length - 1];
  const time = Math.max(0, Math.min(Number(timeMs) || 0, durationMs > 0 ? durationMs : Number(timeMs) || 0));
  if (time <= first.t) return first.v;
  if (time >= last.t) {
    // 循环回绕段：末键 → 首键，离散值在末键时刻即切回首键
    if (loop === true && durationMs > last.t) return first.v;
    return last.v;
  }
  let upper = 1;
  while (upper < keys.length && keys[upper].t < time) upper += 1;
  return keys[upper - 1].v;
}

/**
 * 把「帧属性」采样为数值（离散曲线转 0/1，用于 visible 这类布尔量）。
 * @param {Array<Object>} keys - 曲线键
 * @param {number} timeMs - 时间
 * @param {boolean} [loop]
 * @param {number} [durationMs]
 * @returns {number}
 */
export function sampleBooleanCurve(keys, timeMs, loop = false, durationMs = 0) {
  const value = sampleDiscreteCurve(keys, timeMs, loop, durationMs);
  return value === null ? 0 : (value ? 1 : 0);
}
