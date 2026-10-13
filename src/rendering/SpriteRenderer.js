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

import { Logger } from '../core/Logger.js';

/**
 * SpriteRenderer.js
 * 精灵渲染器 - 负责渲染精灵图和动画
 */

/**
 * 精灵渲染器
 * 处理精灵的绘制、翻转和调试显示
 */
export class SpriteRenderer {
  /**
   * @param {AssetManager} assetManager - 资源管理器
   */
  constructor(assetManager) {
    this.assetManager = assetManager;
    this.debugMode = false;
    // elevation → 屏幕 Y 偏移的系数
    // 为保持"elevation===0 时视觉与改造前逐像素一致"，默认 0（由外部开启）
    this.elevationScale = 0;
  }

  /**
   * 设置 elevation 视觉缩放系数（0 即禁用）
   * @param {number} k
   */
  setElevationScale(k) {
    this.elevationScale = k;
  }

  /**
   * 设置调试模式
   * @param {boolean} enabled - 是否启用
   */
  setDebugMode(enabled) {
    this.debugMode = enabled;
  }

  /**
   * 渲染精灵
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   * @param {Entity} entity - 实体
   * @param {TransformComponent} transform - 变换组件
   * @param {SpriteComponent} sprite - 精灵组件
   */
  render(ctx, entity, transform, sprite) {
    if (!sprite.visible) return;

    // 保存上下文状态
    ctx.save();

    // 计算 elevation 视觉偏移（2D 后端把高度映射为屏幕上移）
    const elevation = transform.position?.elevation ?? 0;
    const kIso = this.elevationScale ?? 1;
    const elevationOffset = elevation * kIso;

    // 应用变换
    ctx.translate(transform.position.x, transform.position.y - elevationOffset);
    ctx.rotate(transform.rotation);

    // 应用翻转
    const scaleX = sprite.flipX ? -transform.scale.x : transform.scale.x;
    const scaleY = sprite.flipY ? -transform.scale.y : transform.scale.y;
    ctx.scale(scaleX, scaleY);

    // 应用透明度
    ctx.globalAlpha = sprite.alpha;

    // 应用颜色叠加
    if (sprite.tint) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = sprite.tint;
    }

    // 获取精灵图资源
    const image = this.assetManager ? this.assetManager.getAsset(sprite.spriteSheet) : null;

    // 调试：检查精灵图是否加载
    if (entity.type === 'player' && !image) {
      console.warn('SpriteRenderer: 玩家精灵图未找到', sprite.spriteSheet);
    }

    if (image && image.complete) {
      // 渲染精灵图
      this.renderSprite(ctx, image, sprite);
    } else {
      // 渲染占位符
      this.renderPlaceholder(ctx, sprite);
    }

    // 恢复上下文状态
    ctx.restore();

    // 渲染名字（如果有）
    this.renderName(ctx, entity, transform, sprite);

    // 渲染调试信息
    if (this.debugMode) {
      this.renderDebug(ctx, entity, transform, sprite);
    }
  }

  /**
   * 渲染实体名字
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   * @param {Entity} entity - 实体
   * @param {TransformComponent} transform - 变换组件
   * @param {SpriteComponent} sprite - 精灵组件
   */
  renderName(ctx, entity, transform, sprite) {
    // 检查是否有名字组件
    const nameComponent = entity.getComponent('name');
    
    // 调试日志
    if (entity.type === 'enemy' || entity.type === 'loot') {
      Logger.log('renderName 被调用:', {
        entityId: entity.id,
        entityType: entity.type,
        hasNameComponent: !!nameComponent,
        nameComponent: nameComponent
      });
    }
    
    // 如果没有名字组件或不可见，则不渲染
    if (!nameComponent || !nameComponent.visible) {
      if (entity.type === 'enemy' || entity.type === 'loot') {
        Logger.log('名字不渲染，原因:', !nameComponent ? '没有名字组件' : '不可见');
      }
      return;
    }
    
    const name = nameComponent.name;
    if (!name) return;
    
    const halfHeight = sprite.height / 2;
    const nameY = transform.position.y - halfHeight + (nameComponent.offsetY || -10);
    
    ctx.save();
    ctx.font = `bold ${nameComponent.fontSize || 14}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    
    // 测量文字宽度
    const textWidth = ctx.measureText(name).width;
    const padding = 4;
    
    // 绘制背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(
      transform.position.x - textWidth / 2 - padding,
      nameY - 16,
      textWidth + padding * 2,
      18
    );
    
    // 绘制文字阴影
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    
    // 使用名字组件中的颜色
    ctx.fillStyle = nameComponent.color || '#ffffff';
    
    Logger.log('渲染名字:', name, '颜色:', nameComponent.color, '位置:', transform.position);
    
    ctx.fillText(name, transform.position.x, nameY);
    ctx.restore();
  }

  /**
   * 渲染精灵图
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   * @param {HTMLImageElement} image - 精灵图
   * @param {SpriteComponent} sprite - 精灵组件
   */
  renderSprite(ctx, image, sprite) {
    const frameIndex = sprite.getCurrentFrame();
    const halfWidth = sprite.width / 2;
    const halfHeight = sprite.height / 2;

    // 计算源矩形（从精灵图集中裁剪）
    // 假设精灵图集是水平排列的
    const framesPerRow = Math.floor(image.width / sprite.width) || 1;
    const row = Math.floor(frameIndex / framesPerRow);
    const col = frameIndex % framesPerRow;

    const sx = col * sprite.width;
    const sy = row * sprite.height;
    const sw = sprite.width;
    const sh = sprite.height;

    // 目标矩形（绘制位置）
    const dx = -halfWidth + sprite.offsetX;
    const dy = -halfHeight + sprite.offsetY;
    const dw = sprite.width;
    const dh = sprite.height;

    // 绘制精灵
    ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  /**
   * 渲染占位符
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   * @param {SpriteComponent} sprite - 精灵组件
   */
  renderPlaceholder(ctx, sprite) {
    const halfWidth = sprite.width / 2;
    const halfHeight = sprite.height / 2;
    const offsetX = sprite.offsetX || 0;
    const offsetY = sprite.offsetY || 0;

    // 使用 sprite.color 如果存在，否则使用默认颜色
    ctx.fillStyle = sprite.color || '#4a9eff';
    ctx.fillRect(
      -halfWidth + offsetX,
      -halfHeight + offsetY,
      sprite.width,
      sprite.height
    );

    // 绘制边框
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      -halfWidth + offsetX,
      -halfHeight + offsetY,
      sprite.width,
      sprite.height
    );

    // 绘制X标记（仅在没有自定义颜色时）
    if (!sprite.color) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-halfWidth + offsetX, -halfHeight + offsetY);
      ctx.lineTo(halfWidth + offsetX, halfHeight + offsetY);
      ctx.moveTo(halfWidth + offsetX, -halfHeight + offsetY);
      ctx.lineTo(-halfWidth + offsetX, halfHeight + offsetY);
      ctx.stroke();
    }
  }

  /**
   * 渲染调试信息
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   * @param {Entity} entity - 实体
   * @param {TransformComponent} transform - 变换组件
   * @param {SpriteComponent} sprite - 精灵组件
   */
  renderDebug(ctx, entity, transform, sprite) {
    const halfWidth = sprite.width / 2;
    const halfHeight = sprite.height / 2;

    // 绘制碰撞盒
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      transform.position.x - halfWidth,
      transform.position.y - halfHeight,
      sprite.width,
      sprite.height
    );

    // 绘制中心点
    ctx.fillStyle = '#00ff00';
    ctx.beginPath();
    ctx.arc(transform.position.x, transform.position.y, 3, 0, Math.PI * 2);
    ctx.fill();

    // 绘制方向指示器（显示翻转状态）
    const dirX = sprite.flipX ? -1 : 1;
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(transform.position.x, transform.position.y);
    ctx.lineTo(transform.position.x + dirX * 20, transform.position.y);
    ctx.stroke();

    // 绘制坐标文本
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(
      `(${Math.round(transform.position.x)}, ${Math.round(transform.position.y)})`,
      transform.position.x + halfWidth + 5,
      transform.position.y - halfHeight
    );

    // 绘制实体ID和动画信息
    ctx.fillText(
      `${entity.id} [${sprite.currentAnimation}:${sprite.frame}]`,
      transform.position.x - halfWidth,
      transform.position.y - halfHeight - 5
    );

    // 绘制翻转状态
    if (sprite.flipX || sprite.flipY) {
      const flipText = `Flip: ${sprite.flipX ? 'X' : ''}${sprite.flipY ? 'Y' : ''}`;
      ctx.fillText(
        flipText,
        transform.position.x - halfWidth,
        transform.position.y + halfHeight + 15
      );
    }
  }

  /**
   * 批量渲染精灵（优化性能）
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   * @param {Array} renderList - 渲染列表 [{entity, transform, sprite}]
   */
  batchRender(ctx, renderList) {
    // 按精灵图集分组
    const batches = new Map();

    for (const item of renderList) {
      const { sprite } = item;
      if (!sprite.visible) continue;

      const sheetName = sprite.spriteSheet;
      if (!batches.has(sheetName)) {
        batches.set(sheetName, []);
      }
      batches.get(sheetName).push(item);
    }

    // 按批次渲染
    for (const [sheetName, items] of batches) {
      for (const item of items) {
        this.render(ctx, item.entity, item.transform, item.sprite);
      }
    }
  }
}
