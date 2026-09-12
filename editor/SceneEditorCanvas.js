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

import { ShapeRenderer } from '../src/rendering/ShapeRenderer.js';

/**
 * SceneEditorCanvas - 场景编辑器渲染模块
 * 负责所有 Canvas 绘制逻辑
 */
export class SceneEditorCanvas {
  /**
   * @param {import('./SceneEditor.js').SceneEditor} editor - 主编辑器实例
   */
  constructor(editor) {
    this.editor = editor;
  }

  /**
   * 渲染场景
   */
  render() {
    const editor = this.editor;
    const canvas = document.getElementById('editor-canvas');
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(editor.viewport.offsetX, editor.viewport.offsetY);
    ctx.scale(editor.viewport.scale, editor.viewport.scale);

    // 计算场景可见区域（从原点开始）
    const sceneW = editor.sceneData.width;
    const sceneH = editor.sceneData.height;
    const sceneX = 0;
    const sceneY = 0;

    // 绘制背景（辅助用的长方形纯色背景）
    if (editor.options.showBackground) {
      ctx.fillStyle = editor.sceneData.backgroundColor || '#1a2a1a';
      ctx.fillRect(sceneX, sceneY, sceneW, sceneH);
    }

    // === 相邻场景参考层（半透明，不可交互）===
    if (editor.showNeighbors && editor.neighborScenes.length > 0) {
      this._renderNeighborScenes(ctx);
    }

    // === 按图层顺序渲染，地形效果穿插在对应图层位置 ===
    const data = editor.sceneData;
    const hasTerrain = !!data.terrain;

    for (let i = 0; i < data.layers.length; i++) {
      const layer = data.layers[i];
      if (!layer.visible) continue;

      // 背景填充层：仅室内场景画网格辅助（户外椭圆由 shape 对象自身渲染）
      if (layer.id === 'layer_fill' && hasTerrain) {
        this._renderTerrainBackground(ctx);
      }
      // 遮罩层不再自动画森林环带椭圆：边缘透明由地形椭圆 shape 的 edgeFade 提供

      // 渲染该图层的当前视图对象
      for (const obj of layer.objects) {
        if (editor.layers.isObjectVisible(layer, obj)) this._renderObject(ctx, obj);
      }
    }

    // 绘制网格和辅助方框（在所有图层之上）
    if (editor.options.showGrid) this._renderGrid(ctx, sceneX, sceneY, sceneW, sceneH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1 / editor.viewport.scale;
    ctx.strokeRect(sceneX, sceneY, sceneW, sceneH);

    ctx.restore();
    this._renderTriggerLinks();
    this._renderSelection();
  }

  /**
   * 渲染网格
   * @private
   */
  _renderGrid(ctx, startX, startY, width, height) {
    const editor = this.editor;
    const gridSize = editor.options.gridSize;
    const sx = startX !== undefined ? startX : 0;
    const sy = startY !== undefined ? startY : 0;
    const w = width !== undefined ? width : editor.sceneData.width;
    const h = height !== undefined ? height : editor.sceneData.height;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1 / editor.viewport.scale;

    const gridStartX = Math.ceil(sx / gridSize) * gridSize;
    const gridStartY = Math.ceil(sy / gridSize) * gridSize;

    for (let x = gridStartX; x <= sx + w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, sy);
      ctx.lineTo(x, sy + h);
      ctx.stroke();
    }

    for (let y = gridStartY; y <= sy + h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(sx, y);
      ctx.lineTo(sx + w, y);
      ctx.stroke();
    }
  }

  /**
   * 渲染相邻场景参考层（半透明、带边框标注）
   * @private
   */
  _renderNeighborScenes(ctx) {
    const editor = this.editor;
    ctx.save();
    ctx.globalAlpha = 0.35;

    for (const neighbor of editor.neighborScenes) {
      const { sceneData, offsetX, offsetY } = neighbor;
      if (!sceneData || !sceneData.layers) continue;

      ctx.save();
      ctx.translate(offsetX, offsetY);

      // 背景
      ctx.fillStyle = sceneData.backgroundColor || '#1a2a1a';
      ctx.fillRect(0, 0, sceneData.width, sceneData.height);

      // 渲染所有可见图层的对象
      for (const layer of sceneData.layers) {
        if (!layer.visible || !layer.objects) continue;
        for (const obj of layer.objects) {
          if (editor.layers.isObjectEditorVisible(obj)) this._renderObject(ctx, obj);
        }
      }

      // 边框和标签
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2 / editor.viewport.scale;
      ctx.setLineDash([6 / editor.viewport.scale, 4 / editor.viewport.scale]);
      ctx.strokeRect(0, 0, sceneData.width, sceneData.height);
      ctx.setLineDash([]);

      // 场景名称标签
      ctx.fillStyle = '#ffaa00';
      ctx.font = `${14 / editor.viewport.scale}px Arial`;
      ctx.textAlign = 'left';
      ctx.fillText(sceneData.name || sceneData.id || '邻居场景', 8 / editor.viewport.scale, 20 / editor.viewport.scale);

      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * 编辑器中渲染 shape：透明度为 0 时用 0.5 显示，方便选中编辑
   * （不改动数据，仅渲染时替换；游戏侧仍按真实透明度 0 渲染=不可见）
   * @private
   */
  _renderShapeEditor(ctx, shape, showLabel) {
    const s = (shape.opacity !== undefined && shape.opacity <= 0)
      ? { ...shape, opacity: 0.5 }
      : shape;
    ShapeRenderer.render(ctx, s, this._shapeResolver(), { showLabel });
  }

  /**
   * 为 ShapeRenderer 提供资源解析器（图片/切片）
   * @private
   */
  _shapeResolver() {
    if (!this._shapeResolverObj) {
      const editor = this.editor;
      this._shapeResolverObj = {
        getImage: (key) => editor.loadedImages.get(key) || null,
        getSliceSource: (shape) => this._getEllipseSliceSource(shape)
      };
    }
    return this._shapeResolverObj;
  }

  /**
   * 渲染对象
   * @private
   */
  _renderObject(ctx, obj) {
    if (obj.type === 'shape') {
      this._renderShapeEditor(ctx, obj, true);
    } else if (obj.type === 'fill') {
      // 旧 fill = 矩形填充，交给统一 ShapeRenderer
      this._renderShapeEditor(ctx, { ...obj, shapeType: 'rect' }, false);
    } else if (obj.type === 'ellipse') {
      // 旧 ellipse = 椭圆 shape
      this._renderShapeEditor(ctx, { ...obj, shapeType: 'ellipse' }, true);
    } else if (obj.type === 'deco') {
      this._renderDecoObject(ctx, obj);
    } else if (obj.type === 'rect') {
      ctx.fillStyle = obj.fill || '#4a5a8e';
      ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
    } else if (obj.type === 'circle') {
      ctx.fillStyle = obj.fill || '#4a8e5a';
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, obj.radius, 0, Math.PI * 2);
      ctx.fill();
    } else if (obj.type === 'image') {
      const img = this.editor.loadedImages.get(obj.imageId);
      if (img) {
        ctx.save();
        ctx.translate(obj.x + obj.width / 2, obj.y + obj.height / 2);
        if (obj.rotation) ctx.rotate(obj.rotation * Math.PI / 180);
        ctx.drawImage(img, -obj.width / 2, -obj.height / 2, obj.width, obj.height);
        ctx.restore();
      }
      const asset = this.editor.sceneData.imageAssets?.[obj.imageId];
      const imageLabel = obj.name || asset?.name || obj.imageId || '未命名图片';
      this._drawLogicLabel(ctx, imageLabel, obj.x + 6, obj.y + 16, '#f4d35e');
      if (obj.depthSort === true) {
        const sortY = Number.isFinite(obj.sortY) ? obj.sortY : obj.y + obj.height;
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#55ddff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(obj.x, sortY);
        ctx.lineTo(obj.x + obj.width, sortY);
        ctx.stroke();
        ctx.setLineDash([]);
        this._drawLogicLabel(ctx, `Y-sort ${Math.round(sortY)}`, obj.x + 4, sortY - 4, '#55ddff');
        ctx.restore();
      }
    } else if (obj.type === 'slice') {
      this._renderSliceObject(ctx, obj);
    } else if (obj.type === 'region' || obj.type === 'spawn' || obj.type === 'portal' || obj.type === 'npc' || obj.type === 'trigger' || obj.type === 'buffZone' || obj.type === 'effectZone') {
      this._renderLogicObject(ctx, obj);
    } else if (obj.type === 'ref') {
      this._renderRefObject(ctx, obj);
    }
  }

  /**
   * 渲染内容库放置引用（type:'ref'）。
   * 优先使用内容定义 + placement overrides + Manifest 的稳定图片链；解析失败时保留诊断标记。
   * @private
   */
  _renderRefObject(ctx, obj) {
    const colors = {
      item: '#e0c040', equipment: '#c0a0e0', npc: '#50c88c',
      enemy: '#d05050', resourceNode: '#78a84f', shop: '#e08040',
      vehicle: '#5a78c0', building: '#a0885a'
    };
    const icons = {
      item: '道', equipment: '装', npc: '☺', enemy: '⚔', resourceNode: '资',
      shop: '$', vehicle: '车', building: '城'
    };
    const color = colors[obj.kind] || '#8888aa';
    const visual = this.editor.assets.resolvePlacementVisual?.(obj);
    const label = (obj.name || visual?.definition?.name || obj.ref) + (obj.group ? ` [${obj.group}]` : '');

    ctx.save();
    if (visual?.image && visual.bounds) {
      const { x, y, width, height } = visual.bounds;
      ctx.drawImage(visual.image, x, y, width, height);
      this._drawLogicLabel(ctx, label, x, y - 4, color);

      // placement 坐标是业务脚点；小十字仅辅助精确拖放，不覆盖主体图片。
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(obj.x - 3, obj.y);
      ctx.lineTo(obj.x + 3, obj.y);
      ctx.moveTo(obj.x, obj.y - 3);
      ctx.lineTo(obj.x, obj.y + 3);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const radius = 15;
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color + '44';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icons[obj.kind] || '?', obj.x, obj.y);
    this._drawLogicLabel(ctx, label, obj.x + radius + 3, obj.y + 4, color);
    ctx.restore();
  }

  /**
   * 渲染逻辑对象标记（region/spawn/portal/npc，P2-1）
   * 这些是编辑期可视化标记，游戏中不直接绘制（由系统实例化）。
   * @private
   */
  _renderLogicObject(ctx, obj) {
    ctx.save();
    if (obj.type === 'region') {
      ctx.fillStyle = 'rgba(80,140,255,0.12)';
      ctx.strokeStyle = '#5a8adf';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
      ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
      ctx.setLineDash([]);
      this._drawLogicLabel(ctx, obj.name || '区域', obj.x + 4, obj.y + 14, '#9cc0ff');
    } else if (obj.type === 'trigger') {
      const definition = this.editor.getProjectTrigger?.(obj.triggerId);
      const invalidSpatialEvent = !!definition && !['interact', 'approach', 'enter', 'leave'].includes(definition.when?.type);
      const dangling = !definition || invalidSpatialEvent;
      const color = dangling ? '#ef5350' : '#e0a020';
      const centerX = obj.x + (obj.width || 0) / 2;
      const centerY = obj.y + (obj.height || 0) / 2;
      // 运行时交互检测优先用 pointerRadius；画布统一用实际生效值显示交互范围。
      const effectiveRadius = obj.pointerRadius != null ? obj.pointerRadius : obj.radius;
      if (effectiveRadius > 0) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, effectiveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = dangling ? 'rgba(239,83,80,0.6)' : 'rgba(224,160,32,0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.stroke();
      }
      ctx.fillStyle = dangling ? 'rgba(239,83,80,0.12)' : 'rgba(255,200,50,0.1)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
      ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = '14px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(dangling ? '⚠' : '⚡', obj.x + 4, obj.y + 3);
      const identity = `${obj.triggerId || '未绑定'} · ${definition?.when?.type || obj.event || '?'}`;
      this._drawLogicLabel(ctx, identity, obj.x + 20, obj.y + 15, color);
      const summary = !definition
        ? '悬空引用：项目中不存在该触发器'
        : invalidSpatialEvent
          ? `无效空间事件：${definition.when?.type || '?'}`
          : this.editor.getTriggerSummary?.(obj.triggerId);
      this._drawLogicLabel(ctx, summary, obj.x + 4, obj.y + obj.height + 14, color);
      if (obj.target) this._drawLogicLabel(ctx, '→ ' + obj.target, obj.x + 4, obj.y + obj.height - 4, color);
    } else if (obj.type === 'buffZone') {
      // Buff 区域：根据 shapeType 渲染不同形状
      const fillColor = obj.fillColor || 'rgba(100, 0, 200, 0.2)';
      const borderColor = obj.borderColor || 'rgba(100, 0, 200, 0.5)';

      if (obj.shapeType === 'rect') {
        // 四边形
        ctx.fillStyle = fillColor;
        ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
        ctx.setLineDash([]);
      } else if (obj.shapeType === 'ellipse') {
        // 椭圆形
        const cx = obj.x + obj.width / 2, cy = obj.y + obj.height / 2;
        const rx = obj.width / 2, ry = obj.height / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // 多边形（默认）
        const points = obj.points || [];
        if (points.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(points[0][0], points[0][1]);
          for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
          ctx.closePath();
          ctx.fillStyle = fillColor;
          ctx.fill();
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      // 名称标签
      const labelX = (obj.x != null ? obj.x : (obj.points && obj.points[0] ? obj.points[0][0] : 0)) + 4;
      const labelY = (obj.y != null ? obj.y : (obj.points && obj.points[0] ? obj.points[0][1] : 0)) + 14;
      this._drawLogicLabel(ctx, obj.name || 'Buff区域', labelX, labelY, '#c080ff');
      // 效果类型小标签
      if (obj.effect) {
        const effText = `${obj.effect.stat || 'hp'} ${obj.effect.value > 0 ? '+' : ''}${obj.effect.value || 0}`;
        this._drawLogicLabel(ctx, effText, labelX, labelY + 14, '#a060d0');
      }
    } else if (obj.type === 'effectZone') {
      // 特效区域多边形：虚线边框 + 半透明填充 + 名称 + 特效类型
      const fillColor = obj.fillColor || 'rgba(255,120,30,0.15)';
      const borderColor = obj.borderColor || 'rgba(255,140,40,0.7)';
      const points = obj.points || [];
      if (points.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 标签
      const lx = (obj.x != null ? obj.x : (points[0] ? points[0][0] : 0)) + 4;
      const ly = (obj.y != null ? obj.y : (points[0] ? points[0][1] : 0)) + 14;
      const effectNames = { fire: '🔥火焰', water: '💧流水', lake: '🌊湖面', ice: '❄冰面', smoke: '💨烟雾', sparkle: '✨光粒' };
      this._drawLogicLabel(ctx, obj.name || '特效区域', lx, ly, '#ff9944');
      this._drawLogicLabel(ctx, effectNames[obj.effectType] || obj.effectType || '火焰', lx, ly + 14, '#ffbb66');
      if (obj.depthSort === true) {
        const sortY = Number.isFinite(obj.sortY) ? obj.sortY : (obj.y || 0) + (obj.height || 0);
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#55ddff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(obj.x || 0, sortY);
        ctx.lineTo((obj.x || 0) + (obj.width || 0), sortY);
        ctx.stroke();
        ctx.setLineDash([]);
        this._drawLogicLabel(ctx, `Y-sort ${Math.round(sortY)}`, (obj.x || 0) + 4, sortY - 4, '#55ddff');
        ctx.restore();
      }
    } else {
      // 点状标记：spawn/portal/npc
      const colors = {
        spawn: { fill: 'rgba(220,80,80,0.25)', stroke: '#d05050', icon: '⚔' },
        portal: { fill: 'rgba(180,80,220,0.25)', stroke: '#b450dc', icon: '🌀' },
        npc: { fill: 'rgba(80,200,140,0.25)', stroke: '#50c88c', icon: '☺' }
      };
      let c = colors[obj.type] || colors.spawn;
      // 玩家出生点使用 Presentation Profile 的脚底锚点样式。
      if (obj.type === 'spawn' && obj.ref === 'player') {
        c = { fill: 'rgba(80,180,255,0.3)', stroke: '#50b4ff', icon: '🧑' };
      }
      const isPlayerSpawn = obj.type === 'spawn' && obj.ref === 'player';
      // 玩家 Transform 使用脚底中心锚点；预览尺寸直接消费游戏级 Presentation Profile。
      if (isPlayerSpawn) {
        const playerProfile = this.editor.presentationProfile?.actors?.player || {};
        const visualWidth = Number(playerProfile.visual?.width) > 0 ? Number(playerProfile.visual.width) : 64;
        const visualHeight = Number(playerProfile.visual?.height) > 0 ? Number(playerProfile.visual.height) : 64;
        const footprintWidth = Number(playerProfile.footprint?.width) > 0 ? Number(playerProfile.footprint.width) : 28;
        const footprintHeight = Number(playerProfile.footprint?.height) > 0 ? Number(playerProfile.footprint.height) : 18;

        ctx.fillStyle = 'rgba(80,180,255,0.10)';
        ctx.strokeStyle = 'rgba(80,180,255,0.85)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.fillRect(obj.x - visualWidth / 2, obj.y - visualHeight, visualWidth, visualHeight);
        ctx.strokeRect(obj.x - visualWidth / 2, obj.y - visualHeight, visualWidth, visualHeight);
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.ellipse(obj.x, obj.y, footprintWidth / 2, footprintHeight / 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(80,180,255,0.18)';
        ctx.fill();
        ctx.strokeStyle = '#8dd4ff';
        ctx.stroke();
        this._drawLogicLabel(
          ctx,
          `玩家 ${visualWidth}×${visualHeight} / 占地 ${footprintWidth}×${footprintHeight}`,
          obj.x - visualWidth / 2,
          obj.y - visualHeight - 4,
          '#8dd4ff'
        );
      }

      const r = 16;
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, r, 0, Math.PI * 2);
      ctx.fillStyle = c.fill;
      ctx.fill();
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = 2;
      if (obj.type === 'spawn') ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      // 半径可视化（spawn 有 radius 时）
      if (obj.type === 'spawn' && obj.radius > 0) {
        ctx.beginPath();
        ctx.arc(obj.x, obj.y, obj.radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(220,80,80,0.4)';
        ctx.setLineDash([3, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = c.stroke;
      ctx.font = '13px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.icon, obj.x, obj.y);
      const label = obj.name || obj.type;
      this._drawLogicLabel(ctx, label, obj.x + r + 3, obj.y + 4, c.stroke);
    }
    ctx.restore();
  }

  /** 逻辑对象文字标签 */
  _drawLogicLabel(ctx, text, x, y, color) {
    ctx.font = '11px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    const w = ctx.measureText(text).width;
    ctx.fillRect(x - 2, y - 10, w + 4, 13);
    ctx.fillStyle = color || '#fff';
    ctx.fillText(text, x, y);
  }

  /**
   * 渲染切片对象
   * @private
   */
  _resolveSliceSource(obj) {
    const editor = this.editor;
    if (obj?.decoKey) {
      const atlas = (editor.getAvailableAtlases?.() || [])
        .find(candidate => candidate?.slices?.[obj.decoKey]);
      if (atlas) {
        const slice = editor.getAtlasSlice?.(atlas.id, obj.decoKey) || atlas.slices[obj.decoKey];
        return {
          img: editor.getAtlasImage?.(atlas.id) || editor.loadedImages.get(atlas.id) || null,
          sx: slice.sx,
          sy: slice.sy,
          sw: slice.sw,
          sh: slice.sh
        };
      }
      const sprite = editor.sceneData.decoSprites?.[obj.decoKey];
      if (!sprite) return null;
      return {
        img: editor.loadedImages.get('terrain_atlas') || null,
        sx: sprite.sx,
        sy: sprite.sy,
        sw: sprite.sw,
        sh: sprite.sh
      };
    }

    if (!obj?.atlasId || !obj?.sliceKey) return null;
    const atlas = editor.getAtlasDefinition?.(obj.atlasId);
    const slice = editor.getAtlasSlice?.(obj.atlasId, obj.sliceKey) || atlas?.slices?.[obj.sliceKey];
    if (!slice) return null;
    return {
      img: editor.getAtlasImage?.(obj.atlasId) || editor.loadedImages.get(obj.atlasId) || null,
      sx: slice.sx,
      sy: slice.sy,
      sw: slice.sw,
      sh: slice.sh
    };
  }

  _renderSliceObject(ctx, obj) {
    const source = this._resolveSliceSource(obj);
    if (source?.img) {
      ctx.drawImage(
        source.img,
        source.sx,
        source.sy,
        source.sw,
        source.sh,
        obj.x,
        obj.y,
        obj.width,
        obj.height
      );
    } else {
      ctx.fillStyle = '#3a5a3a';
      ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
      ctx.strokeStyle = '#5a8a5a';
      ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
    }
  }

  /**
   * 渲染装饰物对象（type:'deco'）
   * @private
   */
  _renderDecoObject(ctx, obj) {
    const key = obj.decoKey || obj.name;
    const source = this._resolveSliceSource({ decoKey: key });

    if (source?.img) {
      ctx.drawImage(
        source.img,
        source.sx,
        source.sy,
        source.sw,
        source.sh,
        obj.x,
        obj.y,
        obj.width,
        obj.height
      );
    } else {
      ctx.fillStyle = key?.includes('tree') ? '#2a5a2a' : '#5a8a4a';
      ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
      ctx.strokeStyle = '#4a8a4a';
      ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
      ctx.fillStyle = '#fff';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(key ? key.substring(0, 4) : '?', obj.x + obj.width / 2, obj.y + obj.height / 2);
      ctx.textAlign = 'left';
    }
  }

  /**
   * 渲染背景填充对象
   * @private
   */
  _renderFillObject(ctx, obj) {
    const editor = this.editor;
    const x = obj.x || 0;
    const y = obj.y || 0;
    const w = obj.width || editor.sceneData.width;
    const h = obj.height || editor.sceneData.height;

    ctx.save();
    if (obj.opacity !== undefined) {
      ctx.globalAlpha = obj.opacity;
    }

    const fillMode = obj.fillMode || 'color';

    if (fillMode === 'color') {
      ctx.fillStyle = obj.fillColor || '#333333';
      ctx.fillRect(x, y, w, h);
    } else if (fillMode === 'gradient') {
      let grad;
      if (obj.gradientType === 'radial') {
        const cx = x + w / 2;
        const cy = y + h / 2;
        const r = Math.max(w, h) / 2;
        grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      } else {
        const angle = (obj.gradientAngle || 0) * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        grad = ctx.createLinearGradient(
          x + w / 2 - cos * w / 2, y + h / 2 - sin * h / 2,
          x + w / 2 + cos * w / 2, y + h / 2 + sin * h / 2
        );
      }
      const stops = obj.gradientStops || [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#333333' }
      ];
      for (const stop of stops) {
        grad.addColorStop(stop.offset, stop.color);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    } else if (fillMode === 'image') {
      const img = editor.loadedImages.get(obj.imageId || obj.imageSrc);
      if (img) {
        const drawMode = obj.imageMode || 'stretch';
        if (drawMode === 'stretch') {
          ctx.drawImage(img, x, y, w, h);
        } else if (drawMode === 'cover') {
          const imgRatio = img.width / img.height;
          const boxRatio = w / h;
          let sw, sh, sx, sy;
          if (imgRatio > boxRatio) {
            sh = img.height; sw = sh * boxRatio; sx = (img.width - sw) / 2; sy = 0;
          } else {
            sw = img.width; sh = sw / boxRatio; sx = 0; sy = (img.height - sh) / 2;
          }
          ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
        } else if (drawMode === 'contain') {
          const imgRatio = img.width / img.height;
          const boxRatio = w / h;
          let dw, dh, dx, dy;
          if (imgRatio > boxRatio) {
            dw = w; dh = w / imgRatio; dx = x; dy = y + (h - dh) / 2;
          } else {
            dh = h; dw = h * imgRatio; dx = x + (w - dw) / 2; dy = y;
          }
          ctx.drawImage(img, dx, dy, dw, dh);
        } else if (drawMode === 'tile') {
          const pattern = ctx.createPattern(img, 'repeat');
          ctx.fillStyle = pattern;
          ctx.translate(x, y);
          ctx.fillRect(0, 0, w, h);
          ctx.translate(-x, -y);
        }
      } else {
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#5a5a5a';
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
        ctx.setLineDash([]);
        ctx.fillStyle = '#888';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🖼️ ' + (obj.imageSrc || '未设置图片'), x + w / 2, y + h / 2);
      }
    } else if (fillMode === 'pattern') {
      const patternType = obj.patternType || 'grid';
      const patternColor = obj.patternColor || '#444444';
      const patternBg = obj.patternBg || '#222222';
      const patternSize = obj.patternSize || 32;

      ctx.fillStyle = patternBg;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = patternColor;
      ctx.fillStyle = patternColor;
      ctx.lineWidth = 1;

      if (patternType === 'grid') {
        for (let px = x; px < x + w; px += patternSize) {
          ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + h); ctx.stroke();
        }
        for (let py = y; py < y + h; py += patternSize) {
          ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x + w, py); ctx.stroke();
        }
      } else if (patternType === 'dots') {
        for (let px = x + patternSize / 2; px < x + w; px += patternSize) {
          for (let py = y + patternSize / 2; py < y + h; py += patternSize) {
            ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
          }
        }
      } else if (patternType === 'diagonal') {
        ctx.beginPath();
        for (let d = -h; d < w + h; d += patternSize) {
          ctx.moveTo(x + d, y); ctx.lineTo(x + d + h, y + h);
        }
        ctx.stroke();
      } else if (patternType === 'crosshatch') {
        ctx.beginPath();
        for (let d = -h; d < w + h; d += patternSize) {
          ctx.moveTo(x + d, y); ctx.lineTo(x + d + h, y + h);
          ctx.moveTo(x + d + h, y); ctx.lineTo(x + d, y + h);
        }
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /**
   * 渲染地形背景效果（草地椭圆）
   * 注意：椭圆对象已独立为 type:'ellipse'，此处只渲染非椭圆的辅助效果
   * @private
   */
  _renderTerrainBackground(ctx) {
    const data = this.editor.sceneData;
    if (!data.terrain) return;

    const terrainType = data.terrain.type || 'basin';

    if (terrainType === 'indoor') {
      ctx.fillStyle = data.backgroundColor || '#2a2020';
      ctx.fillRect(0, 0, data.width, data.height);
      const tileSize = data.terrain?.tileSize || 48;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      for (let x = 0; x < data.width; x += tileSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, data.height); ctx.stroke();
      }
      for (let y = 0; y < data.height; y += tileSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(data.width, y); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(0, 0, data.width, 60);
      ctx.fillRect(0, 0, 40, data.height);
      ctx.fillRect(data.width - 40, 0, 40, data.height);
      ctx.fillRect(0, data.height - 40, data.width, 40);
    }
    // 非 indoor 场景：椭圆由 type:'ellipse' 对象渲染，此处不再自动画
  }

  /**
   * 渲染地形遮罩效果（森林环带渐变）
   * @private
   */
  _renderTerrainMask(ctx) {
    const data = this.editor.sceneData;
    if (!data.terrain) return;

    const terrainType = data.terrain.type || 'basin';
    if (terrainType === 'indoor') return;

    // 优先从 layer_fill 中的 ellipse 对象读取参数
    let centerX, centerY, radiusX, aspectY;
    const fillLayer = data.layers.find(l => l.id === 'layer_fill');
    const ellipseObj = fillLayer && fillLayer.objects.find(o =>
      o.type === 'ellipse' || (o.type === 'shape' && o.shapeType === 'ellipse'));
    if (ellipseObj) {
      centerX = ellipseObj.x + ellipseObj.width / 2;
      centerY = ellipseObj.y + ellipseObj.height / 2;
      radiusX = ellipseObj.width / 2;
      aspectY = ellipseObj.height / ellipseObj.width;
    } else {
      centerX = data.width / 2;
      centerY = data.height / 2 - 32;
      radiusX = data.basinRadius || 640;
      aspectY = data.basinAspectY || 0.65;
    }

    let forestColor = 'rgba(35, 58, 25, 1)';
    if (terrainType === 'battlefield') forestColor = 'rgba(50, 30, 25, 1)';
    else if (terrainType === 'mountain') forestColor = 'rgba(40, 45, 30, 1)';
    else if (terrainType === 'camp') forestColor = 'rgba(30, 50, 35, 1)';

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(1, aspectY);
    const grad = ctx.createRadialGradient(0, 0, radiusX - 10, 0, 0, radiusX + 110);
    grad.addColorStop(0, forestColor);
    grad.addColorStop(0.55, forestColor.replace('1)', '0.92)'));
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radiusX + 110, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 渲染椭圆对象
   * 支持填充模式：color（纯色）/ image（图片）/ slice（图集切片）
   * 支持边缘淡化特效 edgeFade（0~1）
   * @private
   */
  _renderEllipseObject(ctx, obj) {
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const rx = obj.width / 2;
    const ry = obj.height / 2;
    const fillMode = obj.fillMode || 'color';
    const bx = obj.x, by = obj.y, bw = obj.width, bh = obj.height;

    ctx.save();
    if (obj.opacity !== undefined) ctx.globalAlpha = obj.opacity;

    // 椭圆裁剪区
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();

    // 按填充模式绘制
    if (fillMode === 'image') {
      const img = this.editor.loadedImages.get(obj.imageId) ||
                  this.editor.loadedImages.get(obj.imageSrc);
      if (img) {
        this._drawImageInBox(ctx, img, bx, by, bw, bh, obj.imageMode || 'cover');
      } else {
        ctx.fillStyle = obj.fill || '#3a5a2a';
        ctx.fillRect(bx, by, bw, bh);
      }
    } else if (fillMode === 'slice') {
      const drawn = this._drawSliceInBox(ctx, obj, bx, by, bw, bh, obj.sliceMode || 'tile');
      if (!drawn) { ctx.fillStyle = obj.fill || '#3a5a2a'; ctx.fillRect(bx, by, bw, bh); }
    } else {
      ctx.fillStyle = obj.fillColor || obj.fill || '#3a5a2a';
      ctx.fillRect(bx, by, bw, bh);
    }

    // 边缘淡化：在裁剪区内用 destination-out 径向渐变擦除边缘
    const edgeFade = Math.max(0, Math.min(1, obj.edgeFade || 0));
    if (edgeFade > 0) {
      const fadeStart = 1 - edgeFade; // 从此比例处开始向边缘淡出
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx); // 让径向渐变呈椭圆形
      const grad = ctx.createRadialGradient(0, 0, rx * fadeStart, 0, 0, rx);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore(); // 退出裁剪

    // 边框（不裁剪）
    if (obj.stroke && (obj.strokeWidth || 0) > 0) {
      ctx.strokeStyle = obj.stroke;
      ctx.lineWidth = obj.strokeWidth;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 名称标签
    if (obj.name) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#fff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(obj.name, cx, cy);
    }

    ctx.restore();
  }

  /**
   * 将图片按指定模式绘制到矩形框内（stretch/cover/contain/tile）
   * @private
   */
  _drawImageInBox(ctx, img, x, y, w, h, mode) {
    if (mode === 'stretch') {
      ctx.drawImage(img, x, y, w, h);
    } else if (mode === 'contain') {
      const imgRatio = img.width / img.height;
      const boxRatio = w / h;
      let dw, dh, dx, dy;
      if (imgRatio > boxRatio) { dw = w; dh = w / imgRatio; dx = x; dy = y + (h - dh) / 2; }
      else { dh = h; dw = h * imgRatio; dx = x + (w - dw) / 2; dy = y; }
      ctx.drawImage(img, dx, dy, dw, dh);
    } else if (mode === 'tile') {
      const pattern = ctx.createPattern(img, 'repeat');
      ctx.fillStyle = pattern;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    } else {
      // cover（默认）
      const imgRatio = img.width / img.height;
      const boxRatio = w / h;
      let sw, sh, sx, sy;
      if (imgRatio > boxRatio) { sh = img.height; sw = sh * boxRatio; sx = (img.width - sw) / 2; sy = 0; }
      else { sw = img.width; sh = sw / boxRatio; sx = 0; sy = (img.height - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    }
  }

  /**
   * 获取椭圆填充切片的图源信息
   * @private
   * @returns {{img, sx, sy, sw, sh}|null}
   */
  _getEllipseSliceSource(obj) {
    const source = this._resolveSliceSource(obj);
    return source?.img ? source : null;
  }

  /**
   * 将图集切片平铺/拉伸绘制到矩形框内
   * @private
   * @returns {boolean} 是否成功绘制
   */
  _drawSliceInBox(ctx, obj, x, y, w, h, mode) {
    const src = this._getEllipseSliceSource(obj);
    if (!src) return false;
    const { img, sx, sy, sw, sh } = src;

    if (mode === 'stretch') {
      ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
      return true;
    }
    // tile（默认）：先把单个切片画到离屏 canvas，再平铺
    const tile = document.createElement('canvas');
    tile.width = sw;
    tile.height = sh;
    tile.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const pattern = ctx.createPattern(tile, 'repeat');
    ctx.fillStyle = pattern;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return true;
  }

  /**
   * 渲染触发器与目标之间的关联线（虚线箭头）
   * @private
   */
  _renderTriggerLinks() {
    const editor = this.editor;
    const canvas = document.getElementById('editor-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const allObjects = [];
    for (const layer of editor.sceneData.layers) {
      if (!layer.visible) continue;
      for (const obj of (layer.objects || [])) {
        if (editor.layers.isObjectVisible(layer, obj)) allObjects.push(obj);
      }
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const s = editor.viewport.scale;
    const ox = editor.viewport.offsetX;
    const oy = editor.viewport.offsetY;

    for (const obj of allObjects) {
      if (obj.type !== 'trigger' || !obj.target) continue;
      const targets = allObjects.filter(candidate => candidate !== obj &&
        editor.interactionModule?.matchesLinkTarget?.(candidate, obj.target, obj.targetMode)
      );

      for (const target of targets) {
        let srcX = (obj.x + (obj.width || 0) / 2) * s + ox;
        let srcY = (obj.y + (obj.height || 0) / 2) * s + oy;
        let tgtX, tgtY;
        if (target.width !== undefined) {
          tgtX = (target.x + (target.width || 0) / 2) * s + ox;
          tgtY = (target.y + (target.height || 0) / 2) * s + oy;
        } else {
          tgtX = target.x * s + ox;
          tgtY = target.y * s + oy;
        }
        // 空间 trigger 通常与目标重叠；从触发框边缘起笔，仍能看到关联箭头。
        if (Math.hypot(tgtX - srcX, tgtY - srcY) < 4) {
          srcX = (obj.x + (obj.width || 0)) * s + ox;
        }

        ctx.beginPath();
        ctx.moveTo(srcX, srcY);
        ctx.lineTo(tgtX, tgtY);
        ctx.strokeStyle = 'rgba(224, 160, 32, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        const angle = Math.atan2(tgtY - srcY, tgtX - srcX);
        const arrowLen = 10;
        ctx.beginPath();
        ctx.moveTo(tgtX, tgtY);
        ctx.lineTo(tgtX - arrowLen * Math.cos(angle - 0.4), tgtY - arrowLen * Math.sin(angle - 0.4));
        ctx.moveTo(tgtX, tgtY);
        ctx.lineTo(tgtX - arrowLen * Math.cos(angle + 0.4), tgtY - arrowLen * Math.sin(angle + 0.4));
        ctx.strokeStyle = 'rgba(224, 160, 32, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * 渲染选中框
   * @private
   */
  _renderSelection() {
    const editor = this.editor;
    const overlay = document.getElementById('editor-overlay');
    if (!overlay) return;

    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (editor.selectedObjects.length === 0) return;

    ctx.save();
    ctx.translate(editor.viewport.offsetX, editor.viewport.offsetY);
    ctx.scale(editor.viewport.scale, editor.viewport.scale);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 / editor.viewport.scale;
    ctx.setLineDash([6 / editor.viewport.scale, 4 / editor.viewport.scale]);

    const handleSize = 8 / editor.viewport.scale;

    for (const obj of editor.selectedObjects) {
      if (!editor.layers.isObjectVisibleFor(obj)) continue;
      let x, y, w, h;

      if (obj.type === 'decoration') {
        w = obj.width || 64;
        h = obj.height || 64;
        x = obj.x - w / 2 - 2;
        y = obj.y - h - 2;
        w += 4;
        h += 4;
        ctx.strokeRect(x, y, w, h);
      } else if (obj.type === 'rect' || obj.type === 'image' || obj.type === 'slice' || obj.type === 'fill' || obj.type === 'deco' || obj.type === 'ellipse' || obj.type === 'region' || obj.type === 'trigger') {
        x = obj.x - 2;
        y = obj.y - 2;
        w = (obj.width || 0) + 4;
        h = (obj.height || 0) + 4;
        ctx.strokeRect(x, y, w, h);
      } else if (obj.type === 'ref') {
        const visual = editor.assets.resolvePlacementVisual?.(obj);
        if (visual?.image && visual.bounds) {
          x = visual.bounds.x - 2;
          y = visual.bounds.y - 2;
          w = visual.bounds.width + 4;
          h = visual.bounds.height + 4;
          ctx.strokeRect(x, y, w, h);
        } else {
          ctx.beginPath();
          ctx.arc(obj.x, obj.y, 18, 0, Math.PI * 2);
          ctx.stroke();
        }
        const collision = obj.collision;
        if ((collision?.mode === 'block' || collision?.mode === 'walkable')
          && collision.shapeType === 'polygon' && Array.isArray(collision.points) && collision.points.length >= 3) {
          const points = collision.points.map(point => [obj.x + point[0], obj.y + point[1]]);
          const color = collision.mode === 'walkable' ? '#37d8cf' : '#ff8a4c';
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(points[0][0], points[0][1]);
          for (let index = 1; index < points.length; index++) ctx.lineTo(points[index][0], points[index][1]);
          ctx.closePath();
          ctx.fillStyle = collision.mode === 'walkable' ? 'rgba(55,216,207,0.18)' : 'rgba(255,138,76,0.18)';
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5 / editor.viewport.scale;
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = color;
          for (const point of points) {
            ctx.fillRect(point[0] - handleSize / 2, point[1] - handleSize / 2, handleSize, handleSize);
            ctx.strokeRect(point[0] - handleSize / 2, point[1] - handleSize / 2, handleSize, handleSize);
          }
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2 / editor.viewport.scale;
          ctx.setLineDash([6 / editor.viewport.scale, 4 / editor.viewport.scale]);
        }
        continue;
      } else if (obj.type === 'spawn' || obj.type === 'portal' || obj.type === 'npc') {
        // 点状逻辑对象：圆形选中框，无缩放手柄
        ctx.beginPath();
        ctx.arc(obj.x, obj.y, 18, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      } else if (obj.type === 'circle') {
        ctx.beginPath();
        ctx.arc(obj.x, obj.y, obj.radius + 2, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      } else if (obj.type === 'shape') {
        const bb = ShapeRenderer.getBBox(obj);
        x = bb.x - 2; y = bb.y - 2; w = bb.w + 4; h = bb.h + 4;
        ctx.strokeRect(x, y, w, h);
        // 多边形/路径：显示可拖拽的顶点手柄，不显示缩放手柄
        if ((obj.shapeType === 'polygon' || obj.shapeType === 'path') && Array.isArray(obj.points)) {
          ctx.setLineDash([]);
          ctx.fillStyle = '#ffdd44';
          ctx.strokeStyle = '#4a90d9';
          ctx.lineWidth = 1.5 / editor.viewport.scale;
          const vs = handleSize;
          for (const p of obj.points) {
            ctx.fillRect(p[0] - vs / 2, p[1] - vs / 2, vs, vs);
            ctx.strokeRect(p[0] - vs / 2, p[1] - vs / 2, vs, vs);
          }
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2 / editor.viewport.scale;
          ctx.setLineDash([6 / editor.viewport.scale, 4 / editor.viewport.scale]);
          continue;
        }
        // rect/ellipse/circle 形状：继续走下方缩放手柄
      } else if ((obj.type === 'buffZone' || obj.type === 'effectZone') && Array.isArray(obj.points)) {
        // Buff/特效 多边形：显示顶点手柄（与 shape polygon 一致）
        // 先画包围盒
        let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
        for (const p of obj.points) {
          if (p[0] < bMinX) bMinX = p[0]; if (p[0] > bMaxX) bMaxX = p[0];
          if (p[1] < bMinY) bMinY = p[1]; if (p[1] > bMaxY) bMaxY = p[1];
        }
        ctx.strokeRect(bMinX - 2, bMinY - 2, bMaxX - bMinX + 4, bMaxY - bMinY + 4);
        // 顶点手柄
        ctx.setLineDash([]);
        ctx.fillStyle = '#cc88ff';
        ctx.strokeStyle = '#8040c0';
        ctx.lineWidth = 1.5 / editor.viewport.scale;
        const vs = handleSize;
        for (const p of obj.points) {
          ctx.fillRect(p[0] - vs / 2, p[1] - vs / 2, vs, vs);
          ctx.strokeRect(p[0] - vs / 2, p[1] - vs / 2, vs, vs);
        }
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 / editor.viewport.scale;
        ctx.setLineDash([6 / editor.viewport.scale, 4 / editor.viewport.scale]);
        continue;
      } else if (obj.type === 'buffZone' && (obj.shapeType === 'rect' || obj.shapeType === 'ellipse')) {
        // Buff 四边形/椭圆：包围盒选中框 + 缩放手柄
        x = obj.x - 2;
        y = obj.y - 2;
        w = (obj.width || 0) + 4;
        h = (obj.height || 0) + 4;
        ctx.strokeRect(x, y, w, h);
      } else {
        continue;
      }

      // 绘制右下角缩放手柄
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#4a90d9';
      ctx.lineWidth = 1.5 / editor.viewport.scale;
      const hx = x + w - handleSize / 2;
      const hy = y + h - handleSize / 2;
      ctx.fillRect(hx, hy, handleSize, handleSize);
      ctx.strokeRect(hx, hy, handleSize, handleSize);

      // 恢复虚线样式
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 / editor.viewport.scale;
      ctx.setLineDash([6 / editor.viewport.scale, 4 / editor.viewport.scale]);
    }

    ctx.restore();
  }
}
