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
 * ShapeRenderer - 统一形状渲染器（编辑器 / 游戏共用）
 *
 * 支持 shapeType：rect | ellipse | circle | polygon | path
 * 支持 fillMode：color | gradient | image | slice | pattern
 * 支持 edgeFade（边缘淡化）与 stroke（描边）
 *
 * 渲染逻辑只此一份，编辑器 SceneEditorCanvas 与游戏侧地形都调用它。
 * 通过 resolver 注入资源获取（图片/切片），使本模块不依赖具体编辑器或游戏环境。
 *
 * shape 数据结构见 .kiro_old/steering/editor-architecture.md §3。
 *
 * resolver 接口（可选，image/slice 模式需要）：
 *   getImage(keyOrSrc): HTMLImageElement | null   // imageId 或 imageSrc
 *   getSliceSource(shape): { img, sx, sy, sw, sh } | null
 */
export class ShapeRenderer {
  /**
   * 计算 shape 的包围盒与中心
   * @param {Object} shape
   * @returns {{x:number,y:number,w:number,h:number,cx:number,cy:number}}
   */
  static getBBox(shape) {
    if ((shape.shapeType === 'polygon' || shape.shapeType === 'path') && Array.isArray(shape.points) && shape.points.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of shape.points) {
        minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
      }
      const x = minX, y = minY, w = maxX - minX, h = maxY - minY;
      return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
    }
    const x = shape.x || 0, y = shape.y || 0;
    const w = shape.width || 0, h = shape.height || 0;
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  }

  /**
   * 在 ctx 上构建 shape 的路径（不填充、不描边）
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} shape
   */
  static buildPath(ctx, shape) {
    const bb = ShapeRenderer.getBBox(shape);
    ctx.beginPath();
    switch (shape.shapeType) {
      case 'rect':
        ctx.rect(bb.x, bb.y, bb.w, bb.h);
        break;
      case 'circle': {
        const r = Math.min(bb.w, bb.h) / 2 || (shape.radius || 0);
        ctx.arc(bb.cx, bb.cy, r, 0, Math.PI * 2);
        break;
      }
      case 'polygon':
      case 'path': {
        const pts = shape.points || [];
        if (pts.length) {
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          if (shape.shapeType === 'polygon') ctx.closePath();
        }
        break;
      }
      case 'ellipse':
      default:
        ctx.ellipse(bb.cx, bb.cy, bb.w / 2, bb.h / 2, 0, 0, Math.PI * 2);
        break;
    }
  }

  /**
   * 渲染一个 shape
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} shape
   * @param {Object} [resolver] - { getImage, getSliceSource }
   * @param {Object} [opts] - { showLabel }
   */
  static render(ctx, shape, resolver = null, opts = {}) {
    if (!shape) return;
    const bb = ShapeRenderer.getBBox(shape);

    ctx.save();
    if (shape.opacity !== undefined) ctx.globalAlpha = shape.opacity;

    // 裁剪到形状内
    ctx.save();
    ShapeRenderer.buildPath(ctx, shape);
    ctx.clip();

    ShapeRenderer._fill(ctx, shape, bb, resolver);
    ShapeRenderer._edgeFade(ctx, shape, bb);

    ctx.restore(); // 退出裁剪

    // 描边（沿路径）
    if (shape.stroke && (shape.strokeWidth || 0) > 0) {
      ShapeRenderer.buildPath(ctx, shape);
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.strokeWidth;
      ctx.stroke();
    }

    // 名称标签（编辑器用）
    if (opts.showLabel && shape.name) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#fff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(shape.name, bb.cx, bb.cy);
    }

    ctx.restore();
  }
}

/**
 * 填充逻辑（在裁剪区内按 fillMode 填充包围盒）
 * @private
 */
ShapeRenderer._fill = function (ctx, shape, bb, resolver) {
  const { x, y, w, h } = bb;
  const fillMode = shape.fillMode || 'color';

  if (fillMode === 'gradient') {
    ShapeRenderer._fillGradient(ctx, shape, bb);
  } else if (fillMode === 'image') {
    const img = resolver && resolver.getImage
      ? resolver.getImage(shape.imageId || shape.imageSrc)
      : null;
    if (img && img.complete !== false && (img.naturalWidth === undefined || img.naturalWidth)) {
      ShapeRenderer._drawImageInBox(ctx, img, x, y, w, h, shape.imageMode || 'cover');
    } else {
      ctx.fillStyle = shape.fill || shape.fillColor || '#2a2a2a';
      ctx.fillRect(x, y, w, h);
    }
  } else if (fillMode === 'slice') {
    const src = resolver && resolver.getSliceSource ? resolver.getSliceSource(shape) : null;
    if (src && src.img) {
      ShapeRenderer._drawSlice(ctx, src, x, y, w, h, shape.sliceMode || 'tile');
    } else {
      ctx.fillStyle = shape.fill || '#3a5a2a';
      ctx.fillRect(x, y, w, h);
    }
  } else if (fillMode === 'pattern') {
    ShapeRenderer._fillPattern(ctx, shape, bb);
  } else {
    // color
    ctx.fillStyle = shape.fill || shape.fillColor || '#3a5a2a';
    ctx.fillRect(x, y, w, h);
  }
};

/**
 * 渐变填充（兼容新 gradient:{type,angle,stops} 与旧 gradientType/gradientAngle/gradientStops）
 * @private
 */
ShapeRenderer._fillGradient = function (ctx, shape, bb) {
  const { x, y, w, h } = bb;
  const g = shape.gradient || {};
  const type = g.type || shape.gradientType || 'linear';
  const angle = (g.angle !== undefined ? g.angle : (shape.gradientAngle || 0)) * Math.PI / 180;
  const stops = g.stops || shape.gradientStops || [
    { offset: 0, color: '#000000' }, { offset: 1, color: '#333333' }
  ];
  let grad;
  if (type === 'radial') {
    const cx = x + w / 2, cy = y + h / 2, r = Math.max(w, h) / 2;
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  } else {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    grad = ctx.createLinearGradient(
      x + w / 2 - cos * w / 2, y + h / 2 - sin * h / 2,
      x + w / 2 + cos * w / 2, y + h / 2 + sin * h / 2
    );
  }
  for (const s of stops) grad.addColorStop(s.offset, s.color);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
};

/**
 * 图案填充（grid/dots/diagonal/crosshatch）
 * @private
 */
ShapeRenderer._fillPattern = function (ctx, shape, bb) {
  const { x, y, w, h } = bb;
  const patternType = shape.patternType || 'grid';
  const patternColor = shape.patternColor || '#444444';
  const patternBg = shape.patternBg || '#222222';
  const size = shape.patternSize || 32;

  ctx.fillStyle = patternBg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = patternColor;
  ctx.fillStyle = patternColor;
  ctx.lineWidth = 1;

  if (patternType === 'grid') {
    for (let px = x; px < x + w; px += size) { ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + h); ctx.stroke(); }
    for (let py = y; py < y + h; py += size) { ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x + w, py); ctx.stroke(); }
  } else if (patternType === 'dots') {
    for (let px = x + size / 2; px < x + w; px += size)
      for (let py = y + size / 2; py < y + h; py += size) { ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill(); }
  } else if (patternType === 'diagonal') {
    ctx.beginPath();
    for (let d = -h; d < w + h; d += size) { ctx.moveTo(x + d, y); ctx.lineTo(x + d + h, y + h); }
    ctx.stroke();
  } else if (patternType === 'crosshatch') {
    ctx.beginPath();
    for (let d = -h; d < w + h; d += size) {
      ctx.moveTo(x + d, y); ctx.lineTo(x + d + h, y + h);
      ctx.moveTo(x + d + h, y); ctx.lineTo(x + d, y + h);
    }
    ctx.stroke();
  }
};

/**
 * 边缘淡化（destination-out 径向渐变，从内向外擦除）
 * 椭圆/圆用缩放贴合形状；其它用包围盒内切椭圆近似
 * @private
 */
ShapeRenderer._edgeFade = function (ctx, shape, bb) {
  const edgeFade = Math.max(0, Math.min(1, shape.edgeFade || 0));
  if (edgeFade <= 0) return;
  const { cx, cy, w, h } = bb;
  const rx = w / 2, ry = h / 2;
  if (rx <= 0 || ry <= 0) return;
  const fadeStart = 1 - edgeFade;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const grad = ctx.createRadialGradient(0, 0, rx * fadeStart, 0, 0, rx);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

/**
 * 图片按模式绘制到矩形框（stretch/cover/contain/tile）
 * @private
 */
ShapeRenderer._drawImageInBox = function (ctx, img, x, y, w, h, mode) {
  if (mode === 'stretch') {
    ctx.drawImage(img, x, y, w, h);
  } else if (mode === 'contain') {
    const ir = img.width / img.height, br = w / h;
    let dw, dh, dx, dy;
    if (ir > br) { dw = w; dh = w / ir; dx = x; dy = y + (h - dh) / 2; }
    else { dh = h; dw = h * ir; dx = x + (w - dw) / 2; dy = y; }
    ctx.drawImage(img, dx, dy, dw, dh);
  } else if (mode === 'tile') {
    const pattern = ctx.createPattern(img, 'repeat');
    ctx.fillStyle = pattern;
    ctx.save(); ctx.translate(x, y); ctx.fillRect(0, 0, w, h); ctx.restore();
  } else {
    // cover
    const ir = img.width / img.height, br = w / h;
    let sw, sh, sx, sy;
    if (ir > br) { sh = img.height; sw = sh * br; sx = (img.width - sw) / 2; sy = 0; }
    else { sw = img.width; sh = sw / br; sx = 0; sy = (img.height - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }
};

/**
 * 切片按模式绘制到矩形框（tile 平铺 / stretch 拉伸）
 * @param {{img,sx,sy,sw,sh}} src
 * @private
 */
ShapeRenderer._drawSlice = function (ctx, src, x, y, w, h, mode) {
  const { img, sx, sy, sw, sh } = src;
  if (mode === 'stretch') {
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    return;
  }
  // tile：单切片画到离屏 canvas 再平铺
  const tile = document.createElement('canvas');
  tile.width = sw; tile.height = sh;
  tile.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const pattern = ctx.createPattern(tile, 'repeat');
  ctx.fillStyle = pattern;
  ctx.save(); ctx.translate(x, y); ctx.fillRect(0, 0, w, h); ctx.restore();
};

export default ShapeRenderer;
