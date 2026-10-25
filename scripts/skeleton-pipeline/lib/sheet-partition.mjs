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
 * sheet-partition.mjs —— 按骨段分区 + 行式图集打包（纯函数，无写盘副作用）。
 *
 * 供两处共用：
 *   1. scripts/skeleton-pipeline/build-female-skeleton-assets.mjs（素材管线脚本）
 *   2. src/dev/SkeletonBindService.js（dev server 绑骨端点）
 *
 * 分区规则（与旧版 female 管线完全一致）：
 *   - 每个 alpha >= 阈值 的像素归到「距离最近的骨段」；
 *   - 指定 headCutoffY 时，颈线以上像素一律归 headKey（马尾/发冠离头骨线很远，按最近段会误判）；
 *   - 每个部位按归属像素的包围盒裁剪，只搬运被归属的像素（其余保持透明）。
 *
 * 坐标均为源图像素坐标；像素原样搬运 RGBA。
 */

const DEFAULT_ALPHA_THRESHOLD = 16;
const DEFAULT_ATLAS_WIDTH = 512;
const DEFAULT_PAD = 2;

/** 点到线段距离（像素坐标系）。 */
function distToSeg(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** 解析「头」段索引：优先显式 headKey，其次常见命名。 */
function resolveHeadIndex(segments, headKey) {
  if (headKey) {
    const index = segments.findIndex(segment => segment.key === headKey);
    if (index >= 0) return index;
  }
  for (const name of ['head', 'headAll', 'Head', 'HEAD']) {
    const index = segments.findIndex(segment => segment.key === name);
    if (index >= 0) return index;
  }
  return -1;
}

/** 校验像素输入（宽高与数据长度匹配）。 */
function assertPixels(pixels) {
  if (!pixels || !pixels.data) throw new Error('pixels.data 不能为空');
  const width = Math.round(Number(pixels.width));
  const height = Math.round(Number(pixels.height));
  if (!(width > 0) || !(height > 0)) throw new Error('pixels.width/height 必须大于 0');
  if (pixels.data.length < width * height * 4) throw new Error('pixels.data 长度与宽高不匹配（需 RGBA）');
  return { width, height };
}

/**
 * 行式图集打包（与旧管线同一算法：按 key 字典序逐块放行，超出宽度换行）。
 * @param {Array<{key:string,w:number,h:number}>} blocks
 * @param {{atlasWidth?:number, pad?:number}} [options]
 * @returns {{atlas:{width:number,height:number,placements:Array<{key,sx,sy,sw,sh}>}, stats:Object}}
 */
export function packBlocks(blocks, { atlasWidth = DEFAULT_ATLAS_WIDTH, pad = DEFAULT_PAD } = {}) {
  const list = Array.isArray(blocks) ? blocks : [];
  const padValue = Math.max(0, Math.round(Number(pad) || 0));
  let width = Math.max(1, Math.round(Number(atlasWidth) || DEFAULT_ATLAS_WIDTH));
  const maxW = list.reduce((max, block) => Math.max(max, Math.max(0, Math.round(Number(block.w) || 0))), 0);
  width = Math.max(width, maxW + padValue * 2);
  // 与旧脚本一致：默认 Array#sort() 的字典序（UTF-16 码元），保证产物逐字节一致
  const sorted = [...list].sort((a, b) => (String(a.key) < String(b.key) ? -1 : String(a.key) > String(b.key) ? 1 : 0));
  const placements = [];
  let cx = padValue;
  let cy = padValue;
  let rowH = 0;
  for (const block of sorted) {
    const w = Math.max(0, Math.round(Number(block.w) || 0));
    const h = Math.max(0, Math.round(Number(block.h) || 0));
    if (cx + w + padValue > width) {
      cx = padValue;
      cy += rowH + padValue;
      rowH = 0;
    }
    placements.push({ key: block.key, sx: cx, sy: cy, sw: w, sh: h });
    cx += w + padValue;
    rowH = Math.max(rowH, h);
  }
  return {
    atlas: { width, height: cy + rowH + padValue, placements },
    stats: { atlasWidth: width, atlasHeight: cy + rowH + padValue, blockCount: placements.length }
  };
}

/**
 * 把各块像素按打包结果合成一张 RGBA 图集像素缓冲（供 sharp 编码 PNG）。
 * @param {Array<{key:string,w:number,h:number,pixels:Buffer|Uint8ClampedArray}>} blocks
 * @param {{width:number,height:number,placements:Array}} atlas
 * @returns {Buffer}
 */
export function composeAtlasPixels(blocks, atlas) {
  const width = Math.max(1, Math.round(Number(atlas?.width) || 1));
  const height = Math.max(1, Math.round(Number(atlas?.height) || 1));
  const sheet = Buffer.alloc(width * height * 4);
  const byKey = new Map((Array.isArray(blocks) ? blocks : []).map(block => [String(block.key), block]));
  for (const placement of atlas?.placements || []) {
    const block = byKey.get(String(placement.key));
    if (!block || !block.pixels) continue;
    const blockW = Math.max(0, Math.round(Number(block.w) || 0));
    const copyW = Math.min(blockW, Math.max(0, Number(placement.sw) || 0));
    if (copyW <= 0) continue;
    for (let y = 0; y < Number(placement.sh || 0); y += 1) {
      const row = Math.min(y, Math.max(0, Math.round(Number(block.h) || 0) - 1));
      const srcStart = (row * blockW) * 4;
      const dstStart = ((placement.sy + y) * width + placement.sx) * 4;
      if (srcStart + copyW * 4 > block.pixels.length) continue;
      sheet.set(block.pixels.subarray(srcStart, srcStart + copyW * 4), dstStart);
    }
  }
  return sheet;
}

/**
 * 按骨段分区并打包。
 *
 * @param {Object} params
 * @param {{data:Uint8ClampedArray|Buffer, width:number, height:number}} params.pixels 源图 RGBA
 * @param {Array<{key:string,a:{x:number,y:number},b:{x:number,y:number},priority?:number}>} params.segments
 *        骨段列表：a=骨起点、b=骨末端（通常为子骨起点），均为源图像素坐标
 * @param {number} [params.headCutoffY] 颈线像素 y：以上一律归 headKey
 * @param {string} [params.headKey] 头部段 key（缺省取 head/headAll）
 * @param {number} [params.atlasWidth=512] 图集行宽
 * @param {number} [params.pad=2] 块间距
 * @param {number} [params.alphaThreshold=16] 非透明判定阈值
 * @returns {{
 *   blocks: Array<{key:string,x:number,y:number,w:number,h:number,pixels:Buffer}>,
 *   atlas: {width:number,height:number,placements:Array<{key:string,sx:number,sy:number,sw:number,sh:number}>},
 *   stats: Object
 * }}
 */
export function partitionSheet({
  pixels,
  segments,
  headCutoffY = undefined,
  headKey = '',
  atlasWidth = DEFAULT_ATLAS_WIDTH,
  pad = DEFAULT_PAD,
  alphaThreshold = DEFAULT_ALPHA_THRESHOLD
} = {}) {
  const { width, height } = assertPixels(pixels);
  const data = pixels.data;
  if (!Array.isArray(segments) || segments.length === 0) throw new Error('segments 不能为空');
  const list = segments
    .filter(segment => segment && segment.key && segment.a && segment.b)
    .map((segment, order) => ({
      key: String(segment.key),
      a: { x: Number(segment.a.x), y: Number(segment.a.y) },
      b: { x: Number(segment.b.x), y: Number(segment.b.y) },
      priority: Number.isFinite(Number(segment.priority)) ? Number(segment.priority) : 0,
      order
    }));
  if (list.length === 0) throw new Error('segments 中没有合法的骨段');
  const headIndex = resolveHeadIndex(list, headKey);
  const cutoff = Number.isFinite(Number(headCutoffY)) ? Number(headCutoffY) : null;
  const threshold = Number.isFinite(Number(alphaThreshold)) ? Number(alphaThreshold) : DEFAULT_ALPHA_THRESHOLD;

  const assign = new Int16Array(width * height).fill(-1);
  const bounds = list.map(() => ({ x0: width, y0: height, x1: -1, y1: -1 }));
  const counts = list.map(() => 0);
  let opaquePixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      if (data[pixelIndex * 4 + 3] < threshold) continue;
      opaquePixels += 1;
      let best = -1;
      let bestDistance = Infinity;
      let bestPriority = -Infinity;
      // 颈线以上一律归头（找不到头段时退回最近骨段）
      if (cutoff != null && y < cutoff && headIndex >= 0) {
        best = headIndex;
      } else {
        for (const segment of list) {
          const distance = distToSeg(x, y, segment.a, segment.b);
          // 距离优先；完全等距时用 priority 高者（旧脚本无 priority → 保持先到先得）
          if (distance < bestDistance || (distance === bestDistance && segment.priority > bestPriority)) {
            bestDistance = distance;
            bestPriority = segment.priority;
            best = segment.order;
          }
        }
      }
      if (best < 0) continue;
      assign[pixelIndex] = best;
      counts[best] += 1;
      const box = bounds[best];
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
    }
  }

  const blocks = [];
  let assignedPixels = 0;
  for (const segment of list) {
    const box = bounds[segment.order];
    if (box.x1 < box.x0) continue;
    const w = box.x1 - box.x0 + 1;
    const h = box.y1 - box.y0 + 1;
    const buffer = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      const srcRow = (box.y0 + y) * width;
      for (let x = 0; x < w; x += 1) {
        const sourceIndex = srcRow + box.x0 + x;
        if (assign[sourceIndex] !== segment.order) continue;
        const destination = (y * w + x) * 4;
        buffer[destination] = data[sourceIndex * 4];
        buffer[destination + 1] = data[sourceIndex * 4 + 1];
        buffer[destination + 2] = data[sourceIndex * 4 + 2];
        buffer[destination + 3] = data[sourceIndex * 4 + 3];
      }
    }
    assignedPixels += counts[segment.order];
    blocks.push({ key: segment.key, x: box.x0, y: box.y0, w, h, pixels: buffer });
  }

  const packed = packBlocks(blocks, { atlasWidth, pad });
  return {
    blocks,
    atlas: packed.atlas,
    stats: {
      width,
      height,
      opaquePixels,
      assignedPixels,
      segmentCount: list.length,
      blockCount: blocks.length,
      counts: Object.fromEntries(list.map(segment => [segment.key, counts[segment.order]])),
      ...packed.stats
    }
  };
}

export default partitionSheet;
