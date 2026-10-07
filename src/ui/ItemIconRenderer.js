/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-02-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * ItemIconRenderer.js
 * 物品/装备图标绘制工具类
 * 统一管理所有物品和装备的图标绘制逻辑，供各UI面板复用
 */

export class ItemIconRenderer {

  /** 稳定 imageId/assetId → 已就绪图片的解析器，由宿主注入（表现层，无业务状态）。 */
  static _imageResolver = null;

  /** 图标位图缓存（key: stableId|id|effect|size）：首帧把几十次矢量路径绘制降为 drawImage 复用。 */
  static _iconCache = new Map();
  static _iconCacheLimit = 256;

  /**
   * 注入稳定资源 ID 的图片解析器；传入非函数即关闭图片图标，回到手绘画法。
   * @param {?function(string, Object): (HTMLImageElement|HTMLCanvasElement|null)} resolver
   */
  static setImageResolver(resolver) {
    ItemIconRenderer._imageResolver = typeof resolver === 'function' ? resolver : null;
    ItemIconRenderer._iconCache.clear();
    return ItemIconRenderer._imageResolver;
  }

  /** 解析物品的稳定图片：{ stableId, image, pending }——image 仅在已就绪时非空。 */
  static _resolveStableImage(item) {
    const sprite = item?.sprite || {};
    const stableId = item?.iconImageId || item?.imageId || item?.assetId || sprite.imageId || sprite.assetId || null;
    if (!stableId) return { stableId: null, image: null, pending: false };
    const resolver = ItemIconRenderer._imageResolver;
    const image = resolver ? resolver(stableId, item) : null;
    if (!image || image.complete === false) return { stableId, image: null, pending: true };
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    if (width <= 0 || height <= 0) return { stableId, image: null, pending: true };
    return { stableId, image, pending: false };
  }

  /** 用内容定义的稳定资源 ID 绘制图标，等比缩放并在格子内居中。 */
  static drawStableImage(ctx, item, cx, cy, slotSize) {
    const { image } = ItemIconRenderer._resolveStableImage(item);
    if (!image) return false;
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const scale = Math.min(slotSize / width, slotSize / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    ctx.drawImage(image, cx - drawWidth / 2, cy - drawHeight / 2, drawWidth, drawHeight);
    return true;
  }

  /** 图标缓存键；图片仍在加载（pending）时返回 null——不缓存，保证图就绪后自然切换。 */
  static _iconKey(item, size) {
    const id = item?.id || '';
    const effectType = item?.effect?.type || '';
    const { stableId, pending } = ItemIconRenderer._resolveStableImage(item);
    if (pending) return null;
    return `${stableId || ''}|${id}|${effectType}|${size}`;
  }

  /** 把图标渲染到独立离屏画布（DPR 感知）；无法渲染返回 null。 */
  static _renderIconToCanvas(item, size) {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(size * dpr));
    canvas.height = canvas.width;
    const c = canvas.getContext('2d');
    c.scale(dpr, dpr);
    c.translate(size / 2, size / 2);
    const { image } = ItemIconRenderer._resolveStableImage(item);
    if (image) {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const scale = Math.min(size / width, size / height);
      c.drawImage(image, -width * scale / 2, -height * scale / 2, width * scale, height * scale);
      return canvas;
    }
    const drawer = ItemIconRenderer._resolveVectorDrawer(item);
    if (!drawer) return null;
    c.scale(size / 32, size / 32);
    drawer(c);
    return canvas;
  }

  /** 手绘矢量图标分派（id/效果类型 → 具体绘制函数）。 */
  static _resolveVectorDrawer(item) {
    const id = item?.id || '';
    const effectType = item?.effect?.type || '';
    switch (true) {
      case id === 'leftover_food': return c => ItemIconRenderer.drawLeftoverFood(c);
      case id === 'ragged_clothes': return c => ItemIconRenderer.drawRaggedClothes(c);
      case id === 'wooden_sword': return c => ItemIconRenderer.drawWoodenSword(c);
      case id === 'cloth_armor': return c => ItemIconRenderer.drawClothArmor(c);
      case id === 'wooden_bow': return c => ItemIconRenderer.drawWoodenBow(c);
      case id === 'wooden_arrow': return c => ItemIconRenderer.drawWoodenArrow(c);
      case id === 'talisman_water': return c => ItemIconRenderer.drawTalismanWater(c);
      case id === 'cloth_belt': return c => ItemIconRenderer.drawClothBelt(c);
      case id === 'straw_sandals': return c => ItemIconRenderer.drawStrawSandals(c);
      case id === 'coin_sword': return c => ItemIconRenderer.drawCoinSword(c);
      case id.includes('health_potion') || (item.type === 'consumable' && effectType === 'heal'):
        return c => ItemIconRenderer.drawPotion(c, '#ff3333', '#ff6666', '#cc0000');
      case id.includes('mana_potion') || (item.type === 'consumable' && effectType === 'restore_mana'):
        return c => ItemIconRenderer.drawPotion(c, '#3366ff', '#6699ff', '#0033cc');
      default: return null;
    }
  }

  /**
   * 绘制物品图标（通用入口）。命中位图缓存时仅一次 drawImage；
   * 缓存未就绪（图片加载中/不可渲染物品）回退即时绘制。
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} item - 物品对象（需要 id, effect 等属性）
   * @param {number} cx - 中心X
   * @param {number} cy - 中心Y
   * @param {number} slotSize - 格子尺寸，用于缩放
   * @returns {boolean} 是否成功绘制了图标
   */
  static drawIcon(ctx, item, cx, cy, slotSize) {
    const size = Math.max(1, Math.round(slotSize));
    const key = ItemIconRenderer._iconKey(item, size);
    if (key) {
      let cached = ItemIconRenderer._iconCache.get(key);
      if (!cached) {
        cached = ItemIconRenderer._renderIconToCanvas(item, size);
        if (cached) {
          if (ItemIconRenderer._iconCache.size >= ItemIconRenderer._iconCacheLimit) {
            ItemIconRenderer._iconCache.clear();
          }
          ItemIconRenderer._iconCache.set(key, cached);
        }
      }
      if (cached) {
        ctx.drawImage(cached, cx - slotSize / 2, cy - slotSize / 2, slotSize, slotSize);
        return true;
      }
    }
    // 未缓存兜底：stable image 优先，其次手绘矢量
    if (ItemIconRenderer.drawStableImage(ctx, item, cx, cy, slotSize)) return true;
    const drawer = ItemIconRenderer._resolveVectorDrawer(item);
    if (!drawer) return false;
    const scale = slotSize / 32;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    drawer(ctx);
    ctx.restore();
    return true;
  }

  /**
   * 绘制残羹图标（中国碗 + 米粒）
   */
  static drawLeftoverFood(ctx) {
    // 碗身（贝塞尔曲线，口大底小）
    ctx.fillStyle = '#8B7355';
    ctx.beginPath();
    ctx.moveTo(-13, -5);
    ctx.bezierCurveTo(-12, 0, -6, 6, -4, 8);
    ctx.lineTo(4, 8);
    ctx.bezierCurveTo(6, 6, 12, 0, 13, -5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#5a4a3a';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 碗底座
    ctx.fillStyle = '#7a6345';
    ctx.beginPath();
    ctx.ellipse(0, 8, 4, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5a4a3a';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // 碗口
    ctx.fillStyle = '#a08060';
    ctx.beginPath();
    ctx.ellipse(0, -5, 13, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5a4a3a';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 碗内部
    ctx.fillStyle = '#6b5a48';
    ctx.beginPath();
    ctx.ellipse(0, -5, 11, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 裂缝
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(7, -8);
    ctx.lineTo(9, -3);
    ctx.lineTo(10, 2);
    ctx.stroke();

    // 碗口缺口
    ctx.fillStyle = '#6b5a48';
    ctx.beginPath();
    ctx.arc(-9, -7, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 碗内米粒
    ctx.fillStyle = '#f5f0e0';
    const grains = [[-3, -5], [1, -6], [4, -5], [-1, -4], [2, -4]];
    for (const [gx, gy] of grains) {
      ctx.beginPath();
      ctx.ellipse(gx, gy, 1.5, 0.8, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 碗外散落米粒
    ctx.fillStyle = '#e8e0c8';
    ctx.beginPath();
    ctx.ellipse(-8, 2, 1.2, 0.7, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(10, 3, 1, 0.6, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * 绘制破旧衣服图标
   */
  static drawRaggedClothes(ctx) {
    ctx.fillStyle = '#8B6914';
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(-6, -10);
    ctx.lineTo(-12, -4);
    ctx.lineTo(-10, -2);
    ctx.lineTo(-7, -6);
    ctx.lineTo(-8, 10);
    ctx.lineTo(8, 10);
    ctx.lineTo(7, -6);
    ctx.lineTo(10, -2);
    ctx.lineTo(12, -4);
    ctx.lineTo(6, -10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#5a4a0a';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 领口
    ctx.fillStyle = '#6b5210';
    ctx.beginPath();
    ctx.ellipse(0, -11, 4, 2, 0, 0, Math.PI);
    ctx.fill();

    // 补丁
    ctx.fillStyle = '#6b5a10';
    ctx.fillRect(-5, 0, 4, 4);
    ctx.strokeStyle = '#4a3a08';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([1, 1]);
    ctx.strokeRect(-5, 0, 4, 4);
    ctx.setLineDash([]);

    // 破洞
    ctx.fillStyle = '#2a1a00';
    ctx.beginPath();
    ctx.ellipse(4, 3, 2, 1.5, 0.3, 0, Math.PI * 2);
    ctx.fill();

    // 撕裂痕迹
    ctx.strokeStyle = '#5a4a0a';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-6, 10);
    ctx.lineTo(-5, 12);
    ctx.moveTo(-2, 10);
    ctx.lineTo(-1, 11);
    ctx.moveTo(3, 10);
    ctx.lineTo(4, 12);
    ctx.stroke();
  }

  /**
   * 绘制木剑图标
   */
  static drawWoodenSword(ctx) {
    // 剑身（木质剑刃）
    ctx.fillStyle = '#a08030';
    ctx.beginPath();
    ctx.moveTo(0, -14);    // 剑尖
    ctx.lineTo(3, -10);
    ctx.lineTo(3, 2);
    ctx.lineTo(-3, 2);
    ctx.lineTo(-3, -10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#6b5210';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // 剑身高光
    ctx.fillStyle = '#c0a050';
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(1.5, -10);
    ctx.lineTo(1.5, 1);
    ctx.lineTo(0, 1);
    ctx.closePath();
    ctx.fill();

    // 护手（横条）
    ctx.fillStyle = '#5a4a0a';
    ctx.fillRect(-5, 2, 10, 2.5);

    // 剑柄
    ctx.fillStyle = '#8B6914';
    ctx.fillRect(-1.5, 4.5, 3, 8);

    // 剑柄缠绕纹理
    ctx.strokeStyle = '#6b5210';
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 3; i++) {
      const yy = 5.5 + i * 2.5;
      ctx.beginPath();
      ctx.moveTo(-1.5, yy);
      ctx.lineTo(1.5, yy + 1);
      ctx.stroke();
    }

    // 剑柄底部圆头
    ctx.fillStyle = '#5a4a0a';
    ctx.beginPath();
    ctx.arc(0, 13, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * 绘制药水瓶图标
   */
  static drawPotion(ctx, mainColor, lightColor, darkColor) {
    const isHealth = mainColor === '#ff3333';
    const bodyColor = isHealth ? '#ff3333' : '#3366ff';
    const liquidColor = isHealth ? '#cc0000' : '#0033cc';
    const highlightColor = isHealth ? '#ff8888' : '#88aaff';

    ctx.translate(0, 12);

    // 瓶身
    const bw = 12, bh = 16;
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(-bw/2, -4);
    ctx.quadraticCurveTo(-bw/2, -bh - 2, -3, -bh - 2);
    ctx.lineTo(3, -bh - 2);
    ctx.quadraticCurveTo(bw/2, -bh - 2, bw/2, -4);
    ctx.quadraticCurveTo(bw/2, 0, 0, 0);
    ctx.quadraticCurveTo(-bw/2, 0, -bw/2, -4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 液体
    ctx.fillStyle = liquidColor;
    ctx.fillRect(-bw/2 + 1, -bh/2, bw - 2, bh/2 - 1);

    // 高光
    ctx.fillStyle = highlightColor;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(-bw/2 + 2, -bh, 3, bh - 4);
    ctx.globalAlpha = 1.0;

    // 瓶口
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(-3, -bh - 6, 6, 5);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(-3, -bh - 6, 6, 5);

    // 瓶盖
    ctx.fillStyle = '#654321';
    ctx.fillRect(-4, -bh - 8, 8, 3);
  }

  /**
   * 绘制木剑图标
   */
  static drawWoodenSword(ctx) {
    // 剑身
    ctx.strokeStyle = '#a08030';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 13);
    ctx.lineTo(0, -11);
    ctx.stroke();

    // 剑尖
    ctx.fillStyle = '#c0a040';
    ctx.beginPath();
    ctx.moveTo(-2, -10);
    ctx.lineTo(2, -10);
    ctx.lineTo(0, -15);
    ctx.closePath();
    ctx.fill();

    // 护手（横档）
    ctx.strokeStyle = '#6b5210';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-8, 4);
    ctx.lineTo(8, 4);
    ctx.stroke();

    // 剑柄
    ctx.strokeStyle = '#5a3a0a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.lineTo(0, 13);
    ctx.stroke();

    // 剑柄缠绕纹
    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-3, 6 + i * 2.5);
      ctx.lineTo(3, 6 + i * 2.5);
      ctx.stroke();
    }

    // 剑身高光
    ctx.strokeStyle = '#d4b860';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-1, -8);
    ctx.lineTo(-1, 3);
    ctx.stroke();
  }

  /**
   * 绘制木弓图标
   */
  static drawWoodenBow(ctx) {
    // 弓身（弧形）
    ctx.strokeStyle = '#8B6914';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(4, 0, 14, Math.PI * 0.65, Math.PI * 1.35);
    ctx.stroke();

    // 弓身纹理
    ctx.strokeStyle = '#6b5210';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(4, 0, 13, Math.PI * 0.75, Math.PI * 0.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(4, 0, 13, Math.PI * 1.1, Math.PI * 1.2);
    ctx.stroke();

    // 弓弦
    ctx.strokeStyle = '#c8b88a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(4 + 14 * Math.cos(Math.PI * 0.65), 14 * Math.sin(Math.PI * 0.65));
    ctx.lineTo(4 + 14 * Math.cos(Math.PI * 1.35), 14 * Math.sin(Math.PI * 1.35));
    ctx.stroke();

    // 弓把缠绕
    ctx.strokeStyle = '#5a3a0a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(4, 0, 14, Math.PI * 0.95, Math.PI * 1.05);
    ctx.stroke();
  }

  /**
   * 绘制木箭图标
   */
  static drawWoodenArrow(ctx) {
    // 箭杆
    ctx.strokeStyle = '#8B6914';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 12);
    ctx.lineTo(0, -10);
    ctx.stroke();

    // 箭头（三角形）
    ctx.fillStyle = '#888888';
    ctx.beginPath();
    ctx.moveTo(-3, -9);
    ctx.lineTo(3, -9);
    ctx.lineTo(0, -15);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // 箭羽（两片）
    ctx.fillStyle = '#cc8844';
    ctx.beginPath();
    ctx.moveTo(-1, 10);
    ctx.lineTo(-5, 13);
    ctx.lineTo(-1, 7);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(1, 10);
    ctx.lineTo(5, 13);
    ctx.lineTo(1, 7);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * 绘制布衣图标
   */
  static drawClothArmor(ctx) {
    // 主体
    ctx.fillStyle = '#6B8E6B';
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(-7, -10);
    ctx.lineTo(-13, -4);
    ctx.lineTo(-11, -1);
    ctx.lineTo(-8, -5);
    ctx.lineTo(-9, 12);
    ctx.lineTo(9, 12);
    ctx.lineTo(8, -5);
    ctx.lineTo(11, -1);
    ctx.lineTo(13, -4);
    ctx.lineTo(7, -10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#4a6a4a';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 领口
    ctx.fillStyle = '#4a6a4a';
    ctx.beginPath();
    ctx.ellipse(0, -12, 4, 2, 0, 0, Math.PI);
    ctx.fill();

    // 腰带
    ctx.fillStyle = '#8B6914';
    ctx.fillRect(-9, 3, 18, 3);
    ctx.strokeStyle = '#5a4a0a';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(-9, 3, 18, 3);

    // 腰带扣
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(-2, 3, 4, 3);

    // 布纹线条
    ctx.strokeStyle = '#4a6a4a';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-4, -8);
    ctx.lineTo(-4, 2);
    ctx.moveTo(4, -8);
    ctx.lineTo(4, 2);
    ctx.stroke();
  }

  /**
   * 绘制符水图标（破碗+符纸）
   */
  static drawTalismanWater(ctx) {
    // 破碗 - 半圆形碗身
    ctx.fillStyle = '#8B7355';
    ctx.beginPath();
    ctx.ellipse(0, 4, 12, 8, 0, 0, Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#5a4a3a';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 碗口
    ctx.fillStyle = '#a08060';
    ctx.beginPath();
    ctx.ellipse(0, 4, 12, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5a4a3a';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // 碗中液体（淡黄色粥水）
    ctx.fillStyle = '#d4c090';
    ctx.beginPath();
    ctx.ellipse(0, 4, 10, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 碗的裂纹（表示破碗）
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-4, 4);
    ctx.lineTo(-6, 9);
    ctx.lineTo(-3, 11);
    ctx.stroke();

    // 符纸 - 斜插在碗中
    ctx.save();
    ctx.translate(3, -4);
    ctx.rotate(-0.3);

    // 符纸底色
    ctx.fillStyle = '#f5e6b8';
    ctx.fillRect(-4, -10, 8, 14);
    ctx.strokeStyle = '#c0a060';
    ctx.lineWidth = 0.6;
    ctx.strokeRect(-4, -10, 8, 14);

    // 符纸上的符文（红色笔画）
    ctx.strokeStyle = '#cc3333';
    ctx.lineWidth = 0.8;
    // 横
    ctx.beginPath();
    ctx.moveTo(-2, -7);
    ctx.lineTo(2, -7);
    ctx.stroke();
    // 竖
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(0, -3);
    ctx.stroke();
    // 点
    ctx.fillStyle = '#cc3333';
    ctx.beginPath();
    ctx.arc(-2, -3, 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(2, -3, 0.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * 绘制布腰带图标
   */
  static drawClothBelt(ctx) {
    // 腰带主体 - 弯曲的带状
    ctx.fillStyle = '#8B7355';
    ctx.beginPath();
    ctx.moveTo(-12, -2);
    ctx.quadraticCurveTo(0, 4, 12, -2);
    ctx.lineTo(12, 3);
    ctx.quadraticCurveTo(0, 9, -12, 3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#5a4a3a';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // 腰带纹理线
    ctx.strokeStyle = '#6a5a45';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.quadraticCurveTo(0, 5, 10, 0);
    ctx.stroke();

    // 腰带扣 - 方形金属扣
    ctx.fillStyle = '#c0a040';
    ctx.fillRect(-3, -4, 6, 9);
    ctx.strokeStyle = '#8a7030';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-3, -4, 6, 9);

    // 扣针
    ctx.fillStyle = '#d4b050';
    ctx.beginPath();
    ctx.arc(0, 0.5, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a7030';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // 腰带末端的装饰
    ctx.fillStyle = '#7a6345';
    ctx.fillRect(-13, -1, 3, 4);
    ctx.fillRect(10, -1, 3, 4);
  }

  /**
   * 绘制草鞋图标
   */
  static drawStrawSandals(ctx) {
    // 鞋底 - 椭圆形草编底
    ctx.fillStyle = '#c4a050';
    ctx.beginPath();
    ctx.ellipse(-1, 2, 10, 6, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a7030';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // 草编纹理 - 横线
    ctx.strokeStyle = '#a08840';
    ctx.lineWidth = 0.5;
    for (let i = -3; i <= 6; i += 3) {
      ctx.beginPath();
      ctx.moveTo(-9, i);
      ctx.lineTo(7, i);
      ctx.stroke();
    }

    // 鞋面绑带 - 交叉绳
    ctx.strokeStyle = '#8B7355';
    ctx.lineWidth = 1.2;
    // 左绑带
    ctx.beginPath();
    ctx.moveTo(-6, -2);
    ctx.quadraticCurveTo(-2, -6, 2, -2);
    ctx.stroke();
    // 右绑带
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.quadraticCurveTo(1, -5, 5, 0);
    ctx.stroke();

    // 鞋头部分 - 稍微翘起
    ctx.fillStyle = '#b89840';
    ctx.beginPath();
    ctx.ellipse(-9, 1, 3, 4, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a7030';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  /**
   * 绘制铜钱剑图标（多个铜钱组合成剑形）
   */
  static drawCoinSword(ctx) {
    // 单个铜钱绘制函数（圆形+方孔）
    const drawCoin = (cx, cy, r) => {
      // 铜钱外圈
      ctx.fillStyle = '#c8a030';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8a7020';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      // 方孔
      const h = r * 0.4;
      ctx.fillStyle = '#3a2a10';
      ctx.fillRect(cx - h, cy - h, h * 2, h * 2);
      // 铜钱高光
      ctx.strokeStyle = '#e0c050';
      ctx.lineWidth = 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.75, -0.8, 0.3);
      ctx.stroke();
    };

    // 剑尖 - 1枚铜钱
    drawCoin(0, -14, 3);

    // 剑身 - 竖排铜钱（稍微重叠）
    drawCoin(0, -9, 3.2);
    drawCoin(0, -4, 3.2);
    drawCoin(0, 1, 3.2);

    // 护手 - 横排3枚铜钱
    drawCoin(-6, 5.5, 2.8);
    drawCoin(0, 5.5, 2.8);
    drawCoin(6, 5.5, 2.8);

    // 剑柄 - 竖排铜钱
    drawCoin(0, 9.5, 2.8);
    drawCoin(0, 13.5, 2.8);
  }


}
