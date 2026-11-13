/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * WorldMapDisplayMetrics - 世界地图显示尺寸的唯一来源。
 *
 * 编辑器（editor/WorldMapEditor.js）与游戏内 M 键大地图（src/ui/WorldMapPanel.js）
 * 都从 region 的「格数 × 格尺寸」换算显示尺寸，不再各自硬编码一套宽高：
 *   cols / rows / chunkWidth / chunkHeight  →  cellWidth / cellHeight / mapWidth / mapHeight
 *
 * 显示比例是唯一的 UI 常量（显示像素 / 世界像素），默认 0.2 = 256 / 1280；
 * 两端的格子尺度、长宽比与地图边界因此天然一致。
 */

/** 显示像素 / 世界像素（0.2 → 1280×720 的 chunk 显示为 256×144）。 */
export const WORLD_MAP_DISPLAY_SCALE = 0.2;

/** 一格 chunk 的基准显示宽度（1280 × 0.2 = 256）。 */
export const WORLD_MAP_DISPLAY_CELL_WIDTH = 1280 * WORLD_MAP_DISPLAY_SCALE;

export const DEFAULT_WORLD_MAP_CHUNK_WIDTH = 1280;
export const DEFAULT_WORLD_MAP_CHUNK_HEIGHT = 720;

/**
 * 由 Region 推导显示尺寸。
 * @param {Object} region - worldMap.regions[]（至少含 cols/rows/chunkWidth/chunkHeight）
 * @param {Object} [options]
 * @param {number} [options.scale] - 显示像素 / 世界像素，缺省用 WORLD_MAP_DISPLAY_SCALE
 * @returns {{scale:number, chunkWidth:number, chunkHeight:number, cols:number, rows:number,
 *            cellWidth:number, cellHeight:number, mapWidth:number, mapHeight:number, aspect:number}}
 */
export function computeWorldMapDisplayMetrics(region, { scale = WORLD_MAP_DISPLAY_SCALE } = {}) {
  const validScale = Number.isFinite(scale) && scale > 0 ? scale : WORLD_MAP_DISPLAY_SCALE;
  const chunkWidth = Number(region?.chunkWidth) > 0
    ? Number(region.chunkWidth)
    : DEFAULT_WORLD_MAP_CHUNK_WIDTH;
  const chunkHeight = Number(region?.chunkHeight) > 0
    ? Number(region.chunkHeight)
    : DEFAULT_WORLD_MAP_CHUNK_HEIGHT;
  const cols = Math.max(0, Math.floor(Number(region?.cols) || 0));
  const rows = Math.max(0, Math.floor(Number(region?.rows) || 0));
  const cellWidth = chunkWidth * validScale;
  const cellHeight = chunkHeight * validScale;
  return {
    scale: validScale,
    chunkWidth,
    chunkHeight,
    cols,
    rows,
    cellWidth,
    cellHeight,
    mapWidth: cols * cellWidth,
    mapHeight: rows * cellHeight,
    aspect: cols > 0 && rows > 0 ? (cols * chunkWidth) / (rows * chunkHeight) : 0
  };
}

export default computeWorldMapDisplayMetrics;
