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

/** Region 地图类型：地形网格保存 terrain；场景网格只保存场景拓扑。 */
export const WORLD_MAP_REGION_TYPES = Object.freeze([
  'terrainGrid',
  'sceneGrid'
]);

export const DEFAULT_WORLD_MAP_REGION_TYPE = 'terrainGrid';

/** 判断 Region mapType 是否属于 canonical 枚举。 */
export function isWorldMapRegionType(mapType) {
  return typeof mapType === 'string' && WORLD_MAP_REGION_TYPES.includes(mapType);
}

/** 世界地图可声明的地形语义；业务通行规则由上层路线/场景系统消费。 */
export const WORLD_MAP_TERRAINS = Object.freeze([
  'mountain',
  'yellowRiver',
  'forest',
  'plain'
]);

/** 判断 terrain 是否为 canonical 世界地图地形。 */
export function isWorldMapTerrain(terrain) {
  return typeof terrain === 'string' && WORLD_MAP_TERRAINS.includes(terrain);
}

/** 判断单元是否仅用于规划展示、禁止运行时加载。 */
export function isReservedWorldMapCell(cell) {
  return Boolean(cell && typeof cell === 'object' && !Array.isArray(cell) && cell.reserved === true);
}

/** 读取地图单元的地形；字符串场景锚点和空单元不隐式伪造地形。 */
export function getWorldMapCellTerrain(cell) {
  if (!cell || typeof cell !== 'object' || Array.isArray(cell)) return null;
  return isWorldMapTerrain(cell.terrain) ? cell.terrain : null;
}

/**
 * 从世界地图单元解析 canonical sceneId。
 * 字符串保留为紧凑 anchor 表达；对象只接受 sceneId，避免 scene/id 别名制造第二份身份。
 * 默认排除 reserved 单元；编辑器可显式包含它们用于规划展示。
 */
export function getWorldMapCellSceneId(cell, { includeReserved = false } = {}) {
  if (typeof cell === 'string') return cell || null;
  if (!cell || typeof cell !== 'object' || Array.isArray(cell)) return null;
  if (!includeReserved && isReservedWorldMapCell(cell)) return null;
  return typeof cell.sceneId === 'string' && cell.sceneId.length > 0 ? cell.sceneId : null;
}

/** 判断单元是否声明了一个 scene anchor（覆盖格由 ProjectWorldIndex 派生，绝不写回 grid）。 */
export function isWorldMapSceneAnchor(cell, options = {}) {
  return getWorldMapCellSceneId(cell, options) !== null;
}

export default getWorldMapCellSceneId;
