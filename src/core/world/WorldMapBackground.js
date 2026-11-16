/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-15
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * WorldMapBackground - 世界地图底图的唯一来源。
 *
 * Region 的 `backgroundImage`（编辑器标签「背景图位置」）支持两种取值：
 *   1. 整图文件（.png/.jpg/...）：整张 2560×1440 底图，一次加载、一次绘制；
 *   2. 按格切图目录：文件名约定由本模块唯一维护 —
 *      tile_r{row}_c{col}.jpg，row/col 从 1 开始、两位补零、行在前列在后。
 *      例如 (row=0, col=0) → tile_r01_c01.jpg，(row=19, col=19) → tile_r20_c20.jpg。
 *
 * 编辑器大地图预览与游戏内 M 键大地图都经由本模块取同一路径、用同一份缓存加载，
 * 因此两端底图来源与尺寸完全一致，不存在第二套命名或第二套底图。
 */

/** 底图文件的命名约定（1-based、两位补零）。 */
export const WORLD_MAP_BACKGROUND_TILE_PATTERN = 'tile_r{row:02}_c{col:02}.jpg';

const IMAGE_FILE_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/i;

/** 归一化 Region 的底图目录：去空白、统一分隔符、去尾斜杠；非法值视为未配置。 */
export function normalizeWorldMapBackgroundPath(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

/** backgroundImage 指向整张底图文件（而非按格切图目录）时返回 true。 */
export function isWorldMapBackgroundFile(value) {
  return IMAGE_FILE_PATTERN.test(normalizeWorldMapBackgroundPath(value));
}

/**
 * 某一格的底图路径（工程相对路径，如 assets/images/map_tiles/tile_r01_c01.jpg）。
 * 未配置 backgroundImage 或坐标非法时返回空串。
 * @param {string} backgroundImage - region.backgroundImage（底图目录）
 * @param {number} row - 0-based 行
 * @param {number} col - 0-based 列
 * @returns {string}
 */
export function resolveWorldMapBackgroundTilePath(backgroundImage, row, col) {
  const dir = normalizeWorldMapBackgroundPath(backgroundImage);
  if (!dir) return '';
  const r = Number(row);
  const c = Number(col);
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0) return '';
  const rowLabel = String(r + 1).padStart(2, '0');
  const colLabel = String(c + 1).padStart(2, '0');
  return `${dir}/tile_r${rowLabel}_c${colLabel}.jpg`;
}

/**
 * 底图贴图路径列表：目录 → 按格拼出的 400 条路径；整图文件 → 仅该文件。
 * @param {string} backgroundImage - region.backgroundImage
 * @param {number} rows
 * @param {number} cols
 * @returns {string[]}
 */
export function resolveWorldMapBackgroundPaths(backgroundImage, rows, cols) {
  const value = normalizeWorldMapBackgroundPath(backgroundImage);
  if (!value) return [];
  if (isWorldMapBackgroundFile(value)) return [value];
  const paths = [];
  for (let row = 0; row < Math.max(0, Number(rows) || 0); row += 1) {
    for (let col = 0; col < Math.max(0, Number(cols) || 0); col += 1) {
      paths.push(resolveWorldMapBackgroundTilePath(value, row, col));
    }
  }
  return paths;
}

/**
 * 整图底图上某格（或连续多格 footprint）的裁剪矩形。
 * 整图被拉伸铺满 rows×cols 网格，格子内容即该格的等比裁剪；
 * 切图目录模式下没有整图，调用方直接整张拉伸单格贴图。
 * @param {number} imageWidth - 已加载整图的像素宽
 * @param {number} imageHeight - 已加载整图的像素高
 * @param {number} rows - region 总行数
 * @param {number} cols - region 总列数
 * @param {number} row - 起始行（0-based）
 * @param {number} col - 起始列（0-based）
 * @param {number} [spanRows=1] - 跨格行数（场景 footprint）
 * @param {number} [spanCols=1] - 跨格列数
 * @returns {{sx:number, sy:number, sw:number, sh:number}}
 */
export function computeWorldMapCellCropRect(
  imageWidth, imageHeight, rows, cols, row, col, spanRows = 1, spanCols = 1
) {
  const totalRows = Math.max(1, Number(rows) || 1);
  const totalCols = Math.max(1, Number(cols) || 1);
  const cellW = imageWidth / totalCols;
  const cellH = imageHeight / totalRows;
  return {
    sx: Number(col) * cellW,
    sy: Number(row) * cellH,
    sw: Math.max(1, Number(spanCols) || 1) * cellW,
    sh: Math.max(1, Number(spanRows) || 1) * cellH
  };
}

/**
 * 底图图片缓存：按 URL 去重加载，编辑器与游戏内共用同一套「加载 → 可绘制」语义。
 * 未加载完成时 get() 返回 null，调用方先画回退底色，加载完成后再整体重绘。
 */
export class WorldMapBackgroundImageCache {
  /**
   * @param {Object} [options]
   * @param {(src:string)=>string} [options.resolveUrl] - 工程路径 → 实际 URL
   */
  constructor({ resolveUrl = src => src } = {}) {
    this._resolveUrl = typeof resolveUrl === 'function' ? resolveUrl : src => src;
    /** @type {Map<string, {image:any, ready:boolean, failed:boolean}>} */
    this._entries = new Map();
    this._pending = 0;
    /** @type {Array<Function>} */
    this._waiters = [];
  }

  _url(src) {
    return this._resolveUrl(String(src || ''));
  }

  /** 已就绪的图片；未加载/加载失败返回 null。 */
  get(src) {
    const entry = this._entries.get(this._url(src));
    return entry?.ready ? entry.image : null;
  }

  /**
   * 确保这批底图已开始加载；有未就绪的图时在所有加载完成后回调一次。
   * @param {string[]} sources - 工程相对路径列表
   * @param {Function} [onReady] - 全部加载完成（含失败）后的回调
   * @returns {number} 当前仍未完成的加载数
   */
  ensure(sources, onReady = null) {
    const list = Array.isArray(sources) ? sources : [];
    let waiting = 0;
    for (const src of list) {
      if (!src) continue;
      const url = this._url(src);
      const entry = this._entries.get(url);
      if (entry) {
        if (!entry.ready && !entry.failed) waiting += 1;
        continue;
      }
      this._startLoad(url);
      waiting += 1;
    }
    if (waiting > 0 && typeof onReady === 'function' && !this._waiters.includes(onReady)) {
      this._waiters.push(onReady);
    }
    return waiting;
  }

  _startLoad(url) {
    const entry = { image: null, ready: false, failed: false };
    this._entries.set(url, entry);
    if (typeof Image === 'undefined') {
      entry.failed = true;
      return;
    }
    this._pending += 1;
    const image = new Image();
    image.onload = () => {
      entry.image = image;
      entry.ready = true;
      this._settle();
    };
    image.onerror = () => {
      entry.failed = true;
      this._settle();
    };
    image.src = url;
  }

  _settle() {
    this._pending = Math.max(0, this._pending - 1);
    if (this._pending > 0) return;
    const waiters = this._waiters;
    this._waiters = [];
    for (const waiter of waiters) {
      try {
        waiter();
      } catch (error) {
        console.warn('[WorldMapBackground] 底图加载完成回调失败', error);
      }
    }
  }

  /** 清空缓存（切换工程时使用）。 */
  clear() {
    this._entries.clear();
    this._waiters = [];
    this._pending = 0;
  }
}

export default resolveWorldMapBackgroundTilePath;
