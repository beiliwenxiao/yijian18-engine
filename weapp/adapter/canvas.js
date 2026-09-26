/**
 * Canvas 适配
 *
 * 小游戏全局有且仅有一个主画布（wx.createCanvas() 首次调用），
 * 后续调用返回离屏画布。引擎代码中 document.createElement('canvas') 统一映射。
 */

// 主画布（首次 createCanvas）
export const mainCanvas = wx.createCanvas();

/** 主画布 2D 上下文（getContext 属平台边界，业务入口不直接调用） */
export function getMainContext() {
  return mainCanvas.getContext('2d');
}

// 计数：第一次 createElement('canvas') 返回主画布，后续返回离屏画布
let _canvasCount = 0;

/**
 * document.createElement 的 shim（只处理 canvas / image / audio）
 */
function createElement(tag) {
  const t = (tag || '').toLowerCase();
  if (t === 'canvas') {
    if (_canvasCount === 0) {
      _canvasCount++;
      return mainCanvas;
    }
    // 离屏画布
    return wx.createOffscreenCanvas
      ? wx.createOffscreenCanvas({ type: '2d', width: 1, height: 1 })
      : wx.createCanvas();
  }
  if (t === 'image' || t === 'img') {
    return wx.createImage();
  }
  // 其他标签返回空对象（不崩溃）
  console.warn('[WeApp Adapter] createElement 未适配的标签:', tag);
  return { tagName: tag, style: {}, children: [], appendChild() {}, addEventListener() {} };
}

export function shimCanvas(_global) {
  // document shim（精简版：只提供引擎实际用到的方法）
  if (!_global.document) {
    _global.document = {};
  }
  _global.document.createElement = createElement;
  _global.document.createElementNS = (ns, tag) => createElement(tag);

  // getElementById 返回 null（引擎不应在小游戏模式下读 DOM）
  if (!_global.document.getElementById) {
    _global.document.getElementById = () => null;
  }
  if (!_global.document.querySelector) {
    _global.document.querySelector = () => null;
  }
  if (!_global.document.querySelectorAll) {
    _global.document.querySelectorAll = () => [];
  }
  if (!_global.document.body) {
    _global.document.body = { appendChild() {}, classList: { add() {}, remove() {}, contains() { return false; } } };
  }
  if (!_global.document.head) {
    _global.document.head = { appendChild() {} };
  }
  if (!_global.document.documentElement) {
    _global.document.documentElement = { style: {} };
  }

  // HTMLCanvasElement（部分引擎代码用 instanceof 检查）
  if (!_global.HTMLCanvasElement) {
    _global.HTMLCanvasElement = mainCanvas.constructor || class HTMLCanvasElement {};
  }
}
