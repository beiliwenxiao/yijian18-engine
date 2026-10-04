/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * SkillArea.js
 * 技能影响区域（AOE 形状）的归一化与命中判定。
 *
 * 形状由技能 params（或编排 paramsOverride）描述：
 *   { shape: 'circle', radius: 120 }                          —— 圆形（缺省）
 *   { shape: 'rect', shapeData: { width: 160, height: 90 } }  —— 轴对齐矩形（中心对称）
 *   { shape: 'polygon', shapeData: { points: [[x,y],...] } }  —— 多边形（顶点相对中心）
 *
 * 顶点/宽高均以技能落点（中心）为原点、世界坐标轴对齐；
 * 消费方：CombatSystem.applyAOEDamage（伤害命中）、telegraph 预警渲染、
 * 内容库/场景编辑器的形状编辑画布。
 */

/** 兜底最小外接半径（与 applyAOEDamage 历史 fallback 一致）。 */
export const SKILL_AREA_FALLBACK_RADIUS = 150;

/**
 * 从技能参数归一化形状描述。
 * 非法/缺失数据一律回退圆形，保证判定与渲染永不悬空。
 * @param {Object} params - 技能参数（可含 shape/shapeData/radius）
 * @param {number} [fallbackRadius=150] - 未配置 radius 时的圆形兜底
 * @returns {{shape:'circle'|'rect'|'polygon', radius:number, width?:number, height?:number, points?:Array<number[]>}}
 */
export function resolveSkillArea(params = {}, fallbackRadius = SKILL_AREA_FALLBACK_RADIUS) {
  const shape = params?.shape === 'rect' || params?.shape === 'polygon' ? params.shape : 'circle';
  const shapeData = params?.shapeData && typeof params.shapeData === 'object' ? params.shapeData : {};

  if (shape === 'rect') {
    const width = Math.round(Number(shapeData.width) || 0);
    const height = Math.round(Number(shapeData.height) || 0);
    if (width >= 16 && height >= 16) {
      return { shape, width, height, radius: Math.ceil(Math.hypot(width, height) / 2) };
    }
  }

  if (shape === 'polygon') {
    const points = Array.isArray(shapeData.points)
      ? shapeData.points
        .filter(point => Array.isArray(point) && point.length >= 2
          && Number.isFinite(point[0]) && Number.isFinite(point[1]))
        .map(point => [point[0], point[1]])
      : [];
    if (points.length >= 3) {
      const radius = Math.ceil(Math.max(...points.map(point => Math.hypot(point[0], point[1]))));
      return { shape, points, radius: Math.max(8, radius) };
    }
  }

  const radius = Math.max(8, Math.round(Number(shapeData?.radius ?? params?.radius) || fallbackRadius));
  return { shape: 'circle', radius };
}

/**
 * 判定相对中心偏移 (dx, dy) 是否在技能区域内。
 * @param {{shape:string, radius:number, width?:number, height?:number, points?:Array<number[]>}} area
 */
export function isPointInSkillArea(area, dx, dy) {
  if (!area) return false;
  if (area.shape === 'rect') {
    return Math.abs(dx) <= area.width / 2 && Math.abs(dy) <= area.height / 2;
  }
  if (area.shape === 'polygon') {
    // 射线法：顶点为相对中心的坐标
    const points = area.points || [];
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      const crosses = (yi > dy) !== (yj > dy);
      if (!crosses) continue;
      const intersectX = xi + (dy - yi) / ((yj - yi) || 1e-9) * (xj - xi);
      if (dx < intersectX) inside = !inside;
    }
    return inside;
  }
  return dx * dx + dy * dy <= area.radius * area.radius;
}
