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
import {
  SCENE_OBJECT_SELECTOR_MODES,
  sceneObjectMatchesSelector,
  sceneObjectSelectorValues
} from '../src/core/scene/SceneObjectSelector.js';

/**
 * SceneEditorInteraction - 场景编辑器交互模块
 * 负责鼠标/键盘事件处理、右键菜单、对象拾取
 */
export class SceneEditorInteraction {
  /**
   * @param {import('./SceneEditor.js').SceneEditor} editor - 主编辑器实例
   */
  constructor(editor) {
    this.editor = editor;
    // 方向键持续移动状态
    this._arrowKeyState = null; // { key, startTime, moved, intervalId }
  }

  /** 返回对象可供触发器关联的全部真实字段值。 */
  getLinkTargetKeys(object) {
    return sceneObjectSelectorValues(object, 'auto');
  }

  /** 按触发器当前选择方式拾取目标；未指定时默认精确对象 ID。 */
  getPreferredLinkTargetKey(object, source = null) {
    let mode = SCENE_OBJECT_SELECTOR_MODES.includes(source?.targetMode) ? source.targetMode : 'id';
    let values = sceneObjectSelectorValues(object, mode);
    if (values.length === 0) {
      mode = 'id';
      values = sceneObjectSelectorValues(object, mode);
    }
    if (source) source.targetMode = mode;
    return values[0] || '';
  }

  matchesLinkTarget(object, target, targetMode = 'auto') {
    return sceneObjectMatchesSelector(object, { mode: targetMode, value: target });
  }

  /**
   * 屏幕坐标转场景坐标
   */
  screenToScene(screenX, screenY) {
    const editor = this.editor;
    return {
      x: (screenX - editor.viewport.offsetX) / editor.viewport.scale,
      y: (screenY - editor.viewport.offsetY) / editor.viewport.scale
    };
  }

  /**
   * 获取指定位置的对象（遍历所有可见未锁定图层）
   */
  getObjectAt(x, y) {
    const editor = this.editor;
    for (let li = editor.sceneData.layers.length - 1; li >= 0; li--) {
      const layer = editor.sceneData.layers[li];
      if (!layer?.objects) continue;

      for (let i = layer.objects.length - 1; i >= 0; i--) {
        const obj = layer.objects[i];
        if (!editor.layers.isObjectEditable(layer, obj)) continue;

        if (obj.type === 'rect' || obj.type === 'image' || obj.type === 'slice' || obj.type === 'fill' || obj.type === 'deco') {
          if (x >= obj.x && x <= obj.x + obj.width && y >= obj.y && y <= obj.y + obj.height) {
            editor.activeLayerIndex = li;
            return obj;
          }
        } else if (obj.type === 'ellipse') {
          // 椭圆点击检测：判断点是否在椭圆内
          const cx = obj.x + obj.width / 2;
          const cy = obj.y + obj.height / 2;
          const rx = obj.width / 2;
          const ry = obj.height / 2;
          const dx = (x - cx) / rx;
          const dy = (y - cy) / ry;
          if (dx * dx + dy * dy <= 1) {
            editor.activeLayerIndex = li;
            return obj;
          }
        } else if (obj.type === 'circle') {
          if (Math.hypot(x - obj.x, y - obj.y) <= obj.radius) {
            editor.activeLayerIndex = li;
            return obj;
          }
        } else if (obj.type === 'shape') {
          if (this._pointInShape(obj, x, y)) {
            editor.activeLayerIndex = li;
            return obj;
          }
        } else if (obj.type === 'region' || obj.type === 'trigger') {
          // 区域/触发器：矩形命中
          if (x >= obj.x && x <= obj.x + obj.width && y >= obj.y && y <= obj.y + obj.height) {
            editor.activeLayerIndex = li;
            return obj;
          }
        } else if (obj.type === 'buffZone') {
          // Buff 区域：根据 shapeType 检测命中
          let hit = false;
          if (obj.shapeType === 'rect') {
            hit = x >= obj.x && x <= obj.x + obj.width && y >= obj.y && y <= obj.y + obj.height;
          } else if (obj.shapeType === 'ellipse') {
            const cx = obj.x + obj.width / 2, cy = obj.y + obj.height / 2;
            const rx = obj.width / 2, ry = obj.height / 2;
            hit = rx > 0 && ry > 0 && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
          } else if (obj.points && obj.points.length >= 3) {
            hit = this._pointInPolygon(obj.points, x, y);
          }
          if (hit) {
            editor.activeLayerIndex = li;
            return obj;
          }
        } else if (obj.type === 'effectZone') {
          // 特效区域多边形：用多边形命中检测
          if (obj.points && obj.points.length >= 3 && this._pointInPolygon(obj.points, x, y)) {
            editor.activeLayerIndex = li;
            return obj;
          }
        } else if (obj.type === 'ref') {
          const visual = editor.assets.resolvePlacementVisual?.(obj);
          const bounds = visual?.image ? visual.bounds : null;
          const hitVisual = bounds
            && x >= bounds.x && x <= bounds.right
            && y >= bounds.y && y <= bounds.bottom;
          // 图片主体可直接命中，同时保留脚点附近的小范围精确拖放入口。
          if (hitVisual || Math.hypot(x - obj.x, y - obj.y) <= 8) {
            editor.activeLayerIndex = li;
            return obj;
          }
        } else if (obj.type === 'spawn' || obj.type === 'portal' || obj.type === 'npc') {
          // 点状逻辑对象：18px 半径命中
          if (Math.hypot(x - obj.x, y - obj.y) <= 18) {
            editor.activeLayerIndex = li;
            return obj;
          }
        }
      }
    }
    return null;
  }

  /**
   * 判断点是否落在 shape 内（按 shapeType）
   * @private
   */
  _pointInShape(shape, x, y) {
    const bb = ShapeRenderer.getBBox(shape);
    switch (shape.shapeType) {
      case 'rect':
        return x >= bb.x && x <= bb.x + bb.w && y >= bb.y && y <= bb.y + bb.h;
      case 'circle': {
        const r = Math.min(bb.w, bb.h) / 2;
        return Math.hypot(x - bb.cx, y - bb.cy) <= r;
      }
      case 'polygon':
        return this._pointInPolygon(shape.points || [], x, y);
      case 'path':
        return x >= bb.x && x <= bb.x + bb.w && y >= bb.y && y <= bb.y + bb.h;
      case 'ellipse':
      default: {
        const dx = (x - bb.cx) / (bb.w / 2 || 1);
        const dy = (y - bb.cy) / (bb.h / 2 || 1);
        return dx * dx + dy * dy <= 1;
      }
    }
  }

  /**
   * 射线法判断点在多边形内
   * @private
   */
  _pointInPolygon(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /**
   * 同步 buffZone 的 x/y/width/height 包围盒（顶点变化后调用）
   * @private
   */
  _syncBuffZoneBBox(obj) {
    if (!obj.points || obj.points.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of obj.points) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    obj.x = minX;
    obj.y = minY;
    obj.width = maxX - minX;
    obj.height = maxY - minY;
  }

  /**
   * 检测点是否命中 polygon/path 的某个顶点，返回顶点索引或 -1
   * @private
   */
  getVertexAt(shape, x, y) {
    if (!shape.points) return -1;
    const r = 8 / this.editor.viewport.scale;
    for (let i = 0; i < shape.points.length; i++) {
      const p = shape.points[i];
      if (Math.hypot(x - p[0], y - p[1]) <= r) return i;
    }
    return -1;
  }

  /**
   * 检测点是否命中多边形的某条边（用于右键"在边上插入顶点"）。
   * 返回边起点索引，或 -1。判定：点到线段距离 ≤ 6px（编辑器坐标）。
   * @private
   */
  _getEdgeAt(shape, x, y) {
    if (!shape.points || shape.points.length < 2) return -1;
    const threshold = 6 / this.editor.viewport.scale;
    const pts = shape.points;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      if (this._distToSegment(x, y, pts[i][0], pts[i][1], pts[j][0], pts[j][1]) <= threshold) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 点到线段的距离
   * @private
   */
  _distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  /**
   * 顶点增删后同步 buffZone 的 x/y/width/height 包围盒
   * @private
   */
  _syncBoundingBox(obj) {
    if (obj.type !== 'buffZone' || !Array.isArray(obj.points) || obj.points.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of obj.points) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    obj.x = minX; obj.y = minY;
    obj.width = maxX - minX; obj.height = maxY - minY;
  }

  /**
   * 检查指定位置是否在选中对象的右下角缩放手柄上
   */
  getResizeHandleAt(x, y) {
    const editor = this.editor;
    const handleSize = 12 / editor.viewport.scale;

    for (const obj of editor.selectedObjects) {
      if (!editor.layers.isObjectEditableFor(obj)) continue;
      let hx, hy;
      if (obj.type === 'rect' || obj.type === 'image' || obj.type === 'slice' || obj.type === 'fill' || obj.type === 'deco' || obj.type === 'ellipse' || obj.type === 'trigger' || obj.type === 'region' || (obj.type === 'buffZone' && (obj.shapeType === 'rect' || obj.shapeType === 'ellipse'))) {
        hx = obj.x + obj.width + 2;
        hy = obj.y + obj.height + 2;
      } else {
        continue;
      }
      if (Math.abs(x - hx) <= handleSize && Math.abs(y - hy) <= handleSize) {
        return obj;
      }
    }
    return null;
  }

  /**
   * 处理鼠标按下
   */
  handleMouseDown(e) {
    const editor = this.editor;
    const pos = this.screenToScene(e.offsetX, e.offsetY);

    if (editor.interaction.mode === 'pan' || e.button === 1) {
      editor.interaction.isDragging = true;
      editor.interaction.dragStart = {
        x: e.offsetX - editor.viewport.offsetX,
        y: e.offsetY - editor.viewport.offsetY
      };
      return;
    }

    if (editor.interaction.mode === 'select') {
      // 选中单个多边形/路径/buffZone时，优先检测顶点拖拽
      if (editor.selectedObjects.length === 1) {
        const sel = editor.selectedObjects[0];
        if (editor.layers.isObjectEditableFor(sel)
          && ((sel.type === 'shape' && (sel.shapeType === 'polygon' || sel.shapeType === 'path')) || sel.type === 'buffZone' || sel.type === 'effectZone')) {
          const vi = this.getVertexAt(sel, pos.x, pos.y);
          if (vi !== -1) {
            editor.interaction.isDragging = true;
            editor.interaction.draggingVertex = { obj: sel, index: vi };
            editor.interaction.dragStart = { x: pos.x, y: pos.y };
            return;
          }
        }
      }

      // 检查是否点击了缩放手柄
      if (editor.selectedObjects.length > 0) {
        const resizeTarget = this.getResizeHandleAt(pos.x, pos.y);
        if (resizeTarget) {
          editor.interaction.isResizing = true;
          editor.interaction.isDragging = true;
          editor.interaction.dragStart = { x: pos.x, y: pos.y };
          editor.interaction.resizeTarget = resizeTarget;
          editor.interaction.resizeStart = {
            width: resizeTarget.width || 64,
            height: resizeTarget.height || 64
          };
          return;
        }
      }

      const clicked = this.getObjectAt(pos.x, pos.y);

      if (clicked) {
        // Shift+从触发器拖拽 → 开始连线（关联目标）
        if (e.shiftKey && clicked.type === 'trigger') {
          editor.interaction.isDragging = true;
          editor.interaction.isLinking = true;
          editor.interaction.linkSource = clicked;
          editor.interaction.linkEnd = { x: pos.x, y: pos.y };
          editor.selectedObjects = [clicked];
          editor.ui.updateObjectProperties();
          editor.render();
          return;
        }

        // 拾取模式：点击目标对象完成关联
        if (editor.interaction.isPickingTarget) {
          const source = editor.interaction.pickSource;
          if (source && clicked !== source) {
            source.target = this.getPreferredLinkTargetKey(clicked, source);
            editor.interaction.isPickingTarget = false;
            editor.interaction.pickSource = null;
            editor.selectedObjects = [source];
            editor.ui.updateObjectProperties();
            editor.render();
            editor.ui.showToast('已关联: ' + source.target);
            const canvas = document.getElementById('editor-overlay') || document.getElementById('editor-canvas');
            if (canvas) canvas.style.cursor = '';
          }
          return;
        }

        if (e.shiftKey) {
          const index = editor.selectedObjects.indexOf(clicked);
          if (index === -1) editor.selectedObjects.push(clicked);
          else editor.selectedObjects.splice(index, 1);
        } else {
          if (!editor.selectedObjects.includes(clicked)) editor.selectedObjects = [clicked];
        }

        editor.interaction.isDragging = true;
        editor.interaction.dragStart = { x: pos.x, y: pos.y };
        editor.interaction.objectStart = { x: clicked.x || 0, y: clicked.y || 0 };
        // 记录所有选中对象的起始位置（多对象拖动）
        editor.interaction.allObjectStarts = editor.selectedObjects.map(o => ({
          x: o.x || 0, y: o.y || 0,
          sortY: Number.isFinite(o.sortY) ? o.sortY : null,
          points: ((o.type === 'shape' || o.type === 'buffZone' || o.type === 'effectZone') && Array.isArray(o.points)) ? o.points.map(p => [p[0], p[1]]) : null
        }));
        // 多边形/路径/buffZone 移动：记录顶点起始快照
        if ((clicked.type === 'shape' || clicked.type === 'buffZone' || clicked.type === 'effectZone') && Array.isArray(clicked.points)) {
          editor.interaction.pointsStart = clicked.points.map(p => [p[0], p[1]]);
        } else {
          editor.interaction.pointsStart = null;
        }
      } else {
        // 空白处按下：开始框选
        if (!e.shiftKey) editor.selectedObjects = [];
        editor.interaction.isDragging = true;
        editor.interaction.isBoxSelecting = true;
        editor.interaction.boxSelectStart = { x: pos.x, y: pos.y };
        editor.interaction.boxSelectEnd = { x: pos.x, y: pos.y };
      }

      editor.ui.updateObjectProperties();
      editor.render();
    }
  }

  /**
   * 处理鼠标移动
   */
  handleMouseMove(e) {
    const editor = this.editor;

    // 更新光标样式
    if (!editor.interaction.isDragging && editor.interaction.mode === 'select' && editor.selectedObjects.length > 0) {
      const pos = this.screenToScene(e.offsetX, e.offsetY);
      const onHandle = this.getResizeHandleAt(pos.x, pos.y);
      const canvas = document.getElementById('editor-overlay') || document.getElementById('editor-canvas');
      if (canvas) {
        canvas.style.cursor = onHandle ? 'nwse-resize' : '';
      }
    }

    if (!editor.interaction.isDragging) return;

    // 顶点拖拽（多边形/路径）
    if (editor.interaction.draggingVertex) {
      const pos = this.screenToScene(e.offsetX, e.offsetY);
      const { obj, index } = editor.interaction.draggingVertex;
      if (obj.points && obj.points[index]) {
        obj.points[index] = [Math.round(pos.x), Math.round(pos.y)];
        // buffZone: 同步 x/y/width/height 包围盒
        if (obj.type === 'buffZone' || obj.type === 'effectZone') {
          this._syncBuffZoneBBox(obj);
        }
        editor.ui.updateObjectProperties();
        editor.render();
      }
      return;
    }

    if (editor.interaction.mode === 'pan') {
      editor.viewport.offsetX = e.offsetX - editor.interaction.dragStart.x;
      editor.viewport.offsetY = e.offsetY - editor.interaction.dragStart.y;
      editor.render();
    } else if (editor.interaction.isResizing) {
      const pos = this.screenToScene(e.offsetX, e.offsetY);
      const dx = pos.x - editor.interaction.dragStart.x;
      const dy = pos.y - editor.interaction.dragStart.y;
      const obj = editor.interaction.resizeTarget;

      const newWidth = Math.max(8, editor.interaction.resizeStart.width + dx);
      const newHeight = Math.max(8, editor.interaction.resizeStart.height + dy);

      obj.width = Math.round(newWidth);
      obj.height = Math.round(newHeight);

      if (obj.type === 'decoration' && obj._decoRef) {
        const origWidth = obj._origWidth || editor.interaction.resizeStart.width;
        obj._decoRef.scale = obj.width / origWidth;
        obj.scale = obj._decoRef.scale;
      }

      editor.ui.updateObjectProperties();
      editor.render();
    } else if (editor.interaction.mode === 'select' && editor.interaction.isBoxSelecting) {
      // 框选：更新选择框终点并重绘
      const pos = this.screenToScene(e.offsetX, e.offsetY);
      editor.interaction.boxSelectEnd = { x: pos.x, y: pos.y };
      editor.render();
      this._renderBoxSelection();
    } else if (editor.interaction.mode === 'select' && editor.interaction.isLinking) {
      // 连线模式：更新连线终点
      const pos = this.screenToScene(e.offsetX, e.offsetY);
      editor.interaction.linkEnd = { x: pos.x, y: pos.y };
      editor.render();
      this._renderLinkLine();
    } else if (editor.interaction.mode === 'select' && editor.selectedObjects.length > 0) {
      const pos = this.screenToScene(e.offsetX, e.offsetY);
      const dx = pos.x - editor.interaction.dragStart.x;
      const dy = pos.y - editor.interaction.dragStart.y;

      const starts = editor.interaction.allObjectStarts || [];
      for (let i = 0; i < editor.selectedObjects.length; i++) {
        const obj = editor.selectedObjects[i];
        if (!editor.layers.isObjectEditableFor(obj)) continue;
        const start = starts[i];
        if (!start) continue;
        // 多边形/路径：整体偏移所有顶点
        if (obj.type === 'shape' && Array.isArray(obj.points) && start.points) {
          obj.points = start.points.map(p => [Math.round(p[0] + dx), Math.round(p[1] + dy)]);
          continue;
        }
        // Buff/特效 多边形：整体偏移所有顶点 + 同步包围盒
        if ((obj.type === 'buffZone' || obj.type === 'effectZone') && Array.isArray(obj.points) && start.points) {
          obj.points = start.points.map(p => [Math.round(p[0] + dx), Math.round(p[1] + dy)]);
          this._syncBuffZoneBBox(obj);
          if (start.sortY !== null) obj.sortY = start.sortY + dy;
          continue;
        }
        obj.x = start.x + dx;
        obj.y = start.y + dy;
        if (start.sortY !== null) obj.sortY = start.sortY + dy;

        if (obj.type === 'decoration' && obj._decoRef) {
          obj._decoRef.x = obj.x;
          obj._decoRef.y = obj.y;
        }
      }

      editor.ui.updateObjectProperties();
      editor.render();
    }
  }

  /**
   * 处理鼠标松开
   */
  handleMouseUp(e) {
    const editor = this.editor;

    // 连线完成：查找松开位置的目标对象
    if (editor.interaction.isLinking) {
      const pos = this.screenToScene(e.offsetX, e.offsetY);
      const target = this.getObjectAt(pos.x, pos.y);
      const source = editor.interaction.linkSource;
      if (target && target !== source && source) {
        source.target = this.getPreferredLinkTargetKey(target, source);
        editor.ui.showToast('已关联: ' + source.name + ' → ' + source.target);
      }
      editor.interaction.isLinking = false;
      editor.interaction.linkSource = null;
      editor.interaction.linkEnd = null;
      editor.interaction.isDragging = false;
      editor.history.saveHistory();
      editor.ui.updateObjectProperties();
      editor.render();
      return;
    }

    // 框选完成：选中框内对象
    if (editor.interaction.isBoxSelecting) {
      this._finishBoxSelection(e.shiftKey);
      editor.interaction.isBoxSelecting = false;
      editor.interaction.boxSelectStart = null;
      editor.interaction.boxSelectEnd = null;
      editor.interaction.isDragging = false;
      editor.render();
      editor.ui.updateObjectProperties();
      return;
    }

    if (editor.interaction.isDragging &&
        (editor.selectedObjects.length > 0 || editor.interaction.isResizing || editor.interaction.draggingVertex)) {
      editor.history.saveHistory();
    }
    editor.interaction.isDragging = false;
    editor.interaction.isResizing = false;
    editor.interaction.resizeTarget = null;
    editor.interaction.resizeStart = null;
    editor.interaction.draggingVertex = null;
    editor.interaction.pointsStart = null;
    editor.interaction.allObjectStarts = null;
  }

  /**
   * 处理右键菜单
   */
  handleContextMenu(e) {
    e.preventDefault();
    const editor = this.editor;
    const pos = this.screenToScene(e.offsetX, e.offsetY);
    const clicked = this.getObjectAt(pos.x, pos.y);

    this.removeContextMenu();
    if (!clicked) return;

    // 如果右键点击的对象不在当前选中集合中，则替换选中为该对象
    // 如果已在集合中，保持多选不变
    if (!editor.selectedObjects.includes(clicked)) {
      editor.selectedObjects = [clicked];
      editor.ui.updateObjectProperties();
      editor.render();
    }

    const isDecoration = clicked.type === 'decoration';

    let layerIndex = -1;
    if (!isDecoration) {
      for (let i = 0; i < editor.sceneData.layers.length; i++) {
        if (editor.sceneData.layers[i].objects.includes(clicked)) {
          layerIndex = i;
          break;
        }
      }
    }

    const menu = document.createElement('div');
    const ensureClickedObjectEditable = () => {
      if (isDecoration || editor.layers.isObjectEditableFor(clicked)) return true;
      editor.ui.showToast('对象或图层已隐藏或锁定，无法修改', 'warn');
      return false;
    };
    menu.id = 'editor-context-menu';
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;background:#16213e;border:1px solid #3a4a7e;border-radius:4px;padding:4px 0;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.4);font-size:13px;min-width:140px;`;

    const items = [];

    // 对齐功能（选中物体时总是显示）
    if (editor.selectedObjects.length > 0) {
      items.push({ label: '左对齐', action: () => this._alignObjects('left') });
      items.push({ label: '右对齐', action: () => this._alignObjects('right') });
      items.push({ label: '水平居中对齐', action: () => this._alignObjects('centerX') });
      items.push({ label: '上对齐', action: () => this._alignObjects('top') });
      items.push({ label: '下对齐', action: () => this._alignObjects('bottom') });
      items.push({ label: '垂直居中对齐', action: () => this._alignObjects('centerY') });
      items.push({ separator: true });
    }

    if (isDecoration) {
      items.push({ label: '上移一层', action: () => this._moveDecorationOrder(clicked, 'up') });
      items.push({ label: '下移一层', action: () => this._moveDecorationOrder(clicked, 'down') });
      items.push({ separator: true });
      items.push({ label: '置于顶层', action: () => this._moveDecorationOrder(clicked, 'top') });
      items.push({ label: '置于底层', action: () => this._moveDecorationOrder(clicked, 'bottom') });
      items.push({ separator: true });
    } else if (layerIndex !== -1) {
      const curLayer = editor.sceneData.layers[layerIndex];
      // 跨图层移动
      items.push({ label: '⬆ 移到上一图层', action: () => this._moveObjectToAdjacentLayer(clicked, 1) });
      items.push({ label: '⬇ 移到下一图层', action: () => this._moveObjectToAdjacentLayer(clicked, -1) });
      items.push({ separator: true });
      // 层内深度调整
      items.push({ label: '层内上移', action: () => this._moveObjectInLayer(clicked, curLayer, 'up') });
      items.push({ label: '层内下移', action: () => this._moveObjectInLayer(clicked, curLayer, 'down') });
      items.push({ label: '层内置顶', action: () => this._moveObjectInLayer(clicked, curLayer, 'top') });
      items.push({ label: '层内置底', action: () => this._moveObjectInLayer(clicked, curLayer, 'bottom') });
      items.push({ separator: true });
    }

    items.push({ label: '删除对象', action: () => editor.ui.deleteSelectedObjects() });

    // ─── 多边形/Buff多边形 顶点编辑 ────────────────────────
    const isVertexShape = (clicked.type === 'shape' && (clicked.shapeType === 'polygon' || clicked.shapeType === 'path'))
      || (clicked.type === 'buffZone' && Array.isArray(clicked.points))
      || (clicked.type === 'effectZone' && Array.isArray(clicked.points));

    if (isVertexShape && Array.isArray(clicked.points) && clicked.points.length >= 3) {
      // 判断右键命中的是某个顶点还是某条边
      const hitVertex = this.getVertexAt(clicked, pos.x, pos.y);
      const hitEdge = hitVertex === -1 ? this._getEdgeAt(clicked, pos.x, pos.y) : -1;

      if (hitVertex !== -1) {
        items.push({ separator: true });
        items.push({
          label: `🔴 删除顶点 #${hitVertex}`,
          disabled: clicked.points.length <= 3, // 三角形不能再删
          action: () => {
            if (!ensureClickedObjectEditable() || clicked.points.length <= 3) return;
            clicked.points.splice(hitVertex, 1);
            this._syncBoundingBox(clicked);
            editor.history.saveHistory();
            editor.ui.updateObjectProperties();
            editor.render();
            editor.ui.showToast(`已删除顶点 #${hitVertex}，剩余 ${clicked.points.length} 个`);
          }
        });
        items.push({
          label: `➕ 在顶点 #${hitVertex} 后插入`,
          action: () => {
            if (!ensureClickedObjectEditable()) return;
            const cur = clicked.points[hitVertex];
            const next = clicked.points[(hitVertex + 1) % clicked.points.length];
            const mid = [Math.round((cur[0] + next[0]) / 2), Math.round((cur[1] + next[1]) / 2)];
            clicked.points.splice(hitVertex + 1, 0, mid);
            this._syncBoundingBox(clicked);
            editor.history.saveHistory();
            editor.ui.updateObjectProperties();
            editor.render();
            editor.ui.showToast(`已在 #${hitVertex} 后插入顶点，共 ${clicked.points.length} 个`);
          }
        });
      } else if (hitEdge !== -1) {
        items.push({ separator: true });
        items.push({
          label: `➕ 在边 #${hitEdge}→#${(hitEdge + 1) % clicked.points.length} 中间插入顶点`,
          action: () => {
            if (!ensureClickedObjectEditable()) return;
            const a = clicked.points[hitEdge];
            const b = clicked.points[(hitEdge + 1) % clicked.points.length];
            const mid = [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
            clicked.points.splice(hitEdge + 1, 0, mid);
            this._syncBoundingBox(clicked);
            editor.history.saveHistory();
            editor.ui.updateObjectProperties();
            editor.render();
            editor.ui.showToast(`已在边上插入顶点，共 ${clicked.points.length} 个`);
          }
        });
      }
    }

    // 触发器相关：如果选中的是触发器且有关联目标，显示「断开关联」
    if (clicked.type === 'trigger' && clicked.target) {
      items.push({ separator: true });
      items.push({ label: '断开触发器关联', action: () => {
        if (!ensureClickedObjectEditable()) return;
        clicked.target = '';
        editor.history.saveHistory();
        editor.ui.updateObjectProperties();
        editor.render();
        editor.ui.showToast('已断开关联');
      }});
    }
    // 如果选中的是普通对象，且有触发器关联到它，显示「断开触发器」
    if (clicked.type !== 'trigger') {
      const linkedTriggers = [];
      for (const layer of editor.sceneData.layers) {
        for (const obj of (layer.objects || [])) {
          if (obj.type === 'trigger' && obj.target
              && editor.layers.isObjectEditable(layer, obj)
              && this.matchesLinkTarget(clicked, obj.target, obj.targetMode)) {
            linkedTriggers.push(obj);
          }
        }
      }
      if (linkedTriggers.length > 0) {
        items.push({ separator: true });
        items.push({ label: `断开触发器 (${linkedTriggers.length}个)`, action: () => {
          const editableTriggers = linkedTriggers.filter(trigger => editor.layers.isObjectEditableFor(trigger));
          if (editableTriggers.length === 0) {
            editor.ui.showToast('关联触发器已隐藏或锁定，无法断开', 'warn');
            return;
          }
          for (const trg of editableTriggers) trg.target = '';
          editor.history.saveHistory();
          editor.render();
          editor.ui.showToast(`已断开 ${editableTriggers.length} 个触发器关联`);
        }});
      }
    }

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:#3a4a7e;margin:4px 0;';
        menu.appendChild(sep);
        continue;
      }
      const el = document.createElement('div');
      el.textContent = item.label;
      const disabled = item.disabled;
      el.style.cssText = `padding:6px 16px;cursor:${disabled ? 'default' : 'pointer'};color:${disabled ? '#666' : '#fff'};white-space:nowrap;`;
      if (!disabled) {
        el.addEventListener('mouseenter', () => el.style.background = '#3a4a7e');
        el.addEventListener('mouseleave', () => el.style.background = 'transparent');
        el.addEventListener('click', () => { item.action(); this.removeContextMenu(); });
      }
      menu.appendChild(el);
    }

    document.body.appendChild(menu);

    // ─── 自动定位：如果菜单超出视口边界则翻转方向 ───
    // 必须在 appendChild 之后才能拿到实际渲染尺寸
    const menuRect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let menuX = e.clientX;
    let menuY = e.clientY;
    // 右边溢出 → 向左展开
    if (menuX + menuRect.width > vw - 4) {
      menuX = Math.max(4, menuX - menuRect.width);
    }
    // 下边溢出 → 向上展开
    if (menuY + menuRect.height > vh - 4) {
      menuY = Math.max(4, menuY - menuRect.height);
    }
    menu.style.left = menuX + 'px';
    menu.style.top = menuY + 'px';

    this._contextMenuCloser = (ev) => {
      if (!menu.contains(ev.target)) this.removeContextMenu();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', this._contextMenuCloser);
    }, 0);
  }

  /**
   * 移除右键菜单
   */
  removeContextMenu() {
    const existing = document.getElementById('editor-context-menu');
    if (existing) existing.remove();
    if (this._contextMenuCloser) {
      document.removeEventListener('mousedown', this._contextMenuCloser);
      this._contextMenuCloser = null;
    }
  }

  /**
   * 对齐选中对象
   * 单个对象时以场景边缘为基准；多个对象时以最边缘对象为基准。
   * @param {'left'|'right'|'centerX'|'top'|'bottom'|'centerY'} direction
   */
  _alignObjects(direction) {
    const editor = this.editor;
    const objs = editor.selectedObjects.filter(object => editor.layers.isObjectEditableFor(object));
    if (objs.length === 0) {
      editor.ui.showToast('选中对象已隐藏或锁定，无法对齐', 'warn');
      return;
    }

    editor.history.saveHistory();

    // 获取对象包围盒
    const getBBox = (obj) => {
      if (obj.type === 'circle') {
        return { x: obj.x - obj.radius, y: obj.y - obj.radius, w: obj.radius * 2, h: obj.radius * 2 };
      }
      if ((obj.type === 'shape' || obj.type === 'buffZone' || obj.type === 'effectZone') && Array.isArray(obj.points) && obj.points.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of obj.points) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      }
      if (obj.type === 'spawn' || obj.type === 'portal' || obj.type === 'npc') {
        return { x: obj.x - 16, y: obj.y - 16, w: 32, h: 32 };
      }
      return { x: obj.x || 0, y: obj.y || 0, w: obj.width || 0, h: obj.height || 0 };
    };

    if (objs.length === 1) {
      // 单个对象：以场景边缘对齐
      const obj = objs[0];
      const bb = getBBox(obj);
      const sw = editor.sceneData.width;
      const sh = editor.sceneData.height;

      const setPos = (newX, newY) => {
        const deltaY = newY - bb.y;
        if (obj.type === 'circle') { obj.x = newX + obj.radius; obj.y = newY + obj.radius; }
        else if ((obj.type === 'shape' || obj.type === 'buffZone' || obj.type === 'effectZone') && Array.isArray(obj.points)) {
          const dx = newX - bb.x, dy = deltaY;
          obj.points = obj.points.map(p => [p[0] + dx, p[1] + dy]);
          if (obj.x != null) { obj.x += dx; obj.y += dy; }
        } else if (obj.type === 'spawn' || obj.type === 'portal' || obj.type === 'npc') {
          obj.x = newX + 16; obj.y = newY + 16;
        } else { obj.x = newX; obj.y = newY; }
        if (Number.isFinite(obj.sortY)) obj.sortY += deltaY;
      };

      if (direction === 'left') setPos(0, bb.y);
      else if (direction === 'right') setPos(sw - bb.w, bb.y);
      else if (direction === 'centerX') setPos((sw - bb.w) / 2, bb.y);
      else if (direction === 'top') setPos(bb.x, 0);
      else if (direction === 'bottom') setPos(bb.x, sh - bb.h);
      else if (direction === 'centerY') setPos(bb.x, (sh - bb.h) / 2);
    } else {
      // 多个对象：以最边缘对象为基准
      const boxes = objs.map(o => ({ obj: o, bb: getBBox(o) }));

      let target;
      if (direction === 'left') {
        target = Math.min(...boxes.map(b => b.bb.x));
      } else if (direction === 'right') {
        target = Math.max(...boxes.map(b => b.bb.x + b.bb.w));
      } else if (direction === 'centerX') {
        const minX = Math.min(...boxes.map(b => b.bb.x));
        const maxX = Math.max(...boxes.map(b => b.bb.x + b.bb.w));
        target = (minX + maxX) / 2;
      } else if (direction === 'top') {
        target = Math.min(...boxes.map(b => b.bb.y));
      } else if (direction === 'bottom') {
        target = Math.max(...boxes.map(b => b.bb.y + b.bb.h));
      } else if (direction === 'centerY') {
        const minY = Math.min(...boxes.map(b => b.bb.y));
        const maxY = Math.max(...boxes.map(b => b.bb.y + b.bb.h));
        target = (minY + maxY) / 2;
      }

      for (const { obj, bb } of boxes) {
        let dx = 0, dy = 0;
        if (direction === 'left') dx = target - bb.x;
        else if (direction === 'right') dx = target - (bb.x + bb.w);
        else if (direction === 'centerX') dx = target - (bb.x + bb.w / 2);
        else if (direction === 'top') dy = target - bb.y;
        else if (direction === 'bottom') dy = target - (bb.y + bb.h);
        else if (direction === 'centerY') dy = target - (bb.y + bb.h / 2);

        if (dx === 0 && dy === 0) continue;

        if (obj.type === 'circle') { obj.x += dx; obj.y += dy; }
        else if ((obj.type === 'shape' || obj.type === 'buffZone' || obj.type === 'effectZone') && Array.isArray(obj.points)) {
          obj.points = obj.points.map(p => [p[0] + dx, p[1] + dy]);
          if (obj.x != null) { obj.x += dx; obj.y += dy; }
        } else if (obj.type === 'spawn' || obj.type === 'portal' || obj.type === 'npc') {
          obj.x += dx; obj.y += dy;
        } else {
          obj.x = (obj.x || 0) + dx; obj.y = (obj.y || 0) + dy;
        }
        if (Number.isFinite(obj.sortY)) obj.sortY += dy;
      }
    }

    editor.ui.updateObjectProperties();
    editor.render();
  }

  /**
   * 调整装饰物层次
   * @private
   */
  _moveDecorationOrder(deco, position) {
    const editor = this.editor;
    const ref = deco._decoRef;
    if (!ref || !Array.isArray(editor.sceneData.decorations)) return;

    const sorted = [...editor.sceneData.decorations].sort((a, b) => a.y - b.y);
    const idx = sorted.indexOf(ref);
    if (idx === -1) return;

    if (position === 'up') {
      if (idx < sorted.length - 1) {
        const next = sorted[idx + 1];
        const t = ref.y; ref.y = next.y; next.y = t;
        if (ref.y === next.y) ref.y += 1;
      }
    } else if (position === 'down') {
      if (idx > 0) {
        const prev = sorted[idx - 1];
        const t = ref.y; ref.y = prev.y; prev.y = t;
        if (ref.y === prev.y) ref.y -= 1;
      }
    } else if (position === 'top') {
      const maxY = Math.max(...editor.sceneData.decorations.map(d => d.y));
      ref.y = maxY + 1;
    } else if (position === 'bottom') {
      const minY = Math.min(...editor.sceneData.decorations.map(d => d.y));
      ref.y = minY - 1;
    }

    if (deco.y !== undefined) deco.y = ref.y;
    editor.history.saveHistory();
    editor.render();
  }

  /**
   * 把对象移到相邻图层（跨图层移动）
   * @param {Object} obj - 要移动的对象
   * @param {number} delta - +1 上一图层（更上层），-1 下一图层（更底层）
   * @private
   */
  _moveObjectToAdjacentLayer(obj, delta) {
    const editor = this.editor;
    const layers = editor.sceneData.layers;
    let curLi = -1;
    for (let i = 0; i < layers.length; i++) {
      if (layers[i].objects && layers[i].objects.includes(obj)) { curLi = i; break; }
    }
    if (curLi === -1) return;

    const sourceLayer = layers[curLi];
    if (!editor.layers.isObjectEditable(sourceLayer, obj)) {
      editor.ui.showToast('源对象或图层已隐藏或锁定，无法移动', 'warn');
      return;
    }

    const targetLi = curLi + delta;
    if (targetLi < 0 || targetLi >= layers.length) {
      editor.ui.showToast(delta > 0 ? '已在最上图层' : '已在最下图层', 'error');
      return;
    }
    const targetLayer = layers[targetLi];
    if (targetLayer.locked) {
      editor.ui.showToast(`目标图层「${targetLayer.name}」已锁定`, 'error');
      return;
    }

    // 从当前层移除，加入目标层
    const idx = sourceLayer.objects.indexOf(obj);
    sourceLayer.objects.splice(idx, 1);
    targetLayer.objects.push(obj);
    editor.activeLayerIndex = targetLi;

    editor.history.saveHistory();
    editor.layers.updateLayerList();
    editor.ui.updateObjectCount();
    editor.ui.updateObjectProperties();
    editor.render();
    editor.ui.showToast(`已移到图层：${targetLayer.name}`);
  }

  /**
   * 在图层内调整对象的绘制顺序
   * @private
   */
  _moveObjectInLayer(obj, layer, position) {
    const editor = this.editor;
    if (!editor.layers.isObjectEditable(layer, obj)) {
      editor.ui.showToast('对象或图层已隐藏或锁定，无法调整深度', 'warn');
      return;
    }

    const editableIndexes = [];
    for (let index = 0; index < layer.objects.length; index++) {
      if (editor.layers.isObjectEditable(layer, layer.objects[index])) editableIndexes.push(index);
    }
    const editableIndex = editableIndexes.findIndex(index => layer.objects[index] === obj);
    if (editableIndex === -1) return;

    let targetEditableIndex = editableIndex;
    if (position === 'up') targetEditableIndex = Math.min(editableIndex + 1, editableIndexes.length - 1);
    else if (position === 'down') targetEditableIndex = Math.max(editableIndex - 1, 0);
    else if (position === 'top') targetEditableIndex = editableIndexes.length - 1;
    else if (position === 'bottom') targetEditableIndex = 0;
    if (targetEditableIndex === editableIndex) return;

    const reorderedObjects = editableIndexes.map(index => layer.objects[index]);
    reorderedObjects.splice(editableIndex, 1);
    reorderedObjects.splice(targetEditableIndex, 0, obj);
    for (let index = 0; index < editableIndexes.length; index++) {
      layer.objects[editableIndexes[index]] = reorderedObjects[index];
    }

    editor.history.saveHistory();
    editor.layers.updateLayerList();
    editor.ui.updateObjectProperties();
    editor.render();
  }

  /**
   * 处理键盘按下事件
   */
  handleKeyDown(e) {
    const editor = this.editor;

    // 焦点在输入框/文本域内时，不拦截快捷键，让浏览器原生行为生效
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') { e.preventDefault(); editor.history.undo(); }
      else if (e.key === 'y') { e.preventDefault(); editor.history.redo(); }
      else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); this._selectAll(); }
      else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); this._copySelection(); }
      else if (e.key === 'v' || e.key === 'V') { e.preventDefault(); this._pasteSelection(); }
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (editor.selectedObjects.length > 0) editor.ui.deleteSelectedObjects();
    }

    // 方向键微调选中对象位置
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      if (editor.selectedObjects.length > 0) {
        e.preventDefault();
        this._handleArrowKeyDown(e.key);
      }
      return;
    }

    if (e.key === 'v' || e.key === 'V') editor.ui.setMode('select');
    else if (e.key === 'h' || e.key === 'H') editor.ui.setMode('pan');
    else if (e.key === 'p' || e.key === 'P') editor.ui.setMode('place');
  }

  /**
   * 处理键盘松开事件
   */
  handleKeyUp(e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      this._handleArrowKeyUp(e.key);
    }
  }

  /**
   * 方向键按下：首次移动 1px，超过 1 秒后持续移动 20px/s
   * @private
   */
  _handleArrowKeyDown(key) {
    // 如果同一个键已经在处理中，忽略重复的 keydown（按住时浏览器会重复触发）
    if (this._arrowKeyState && this._arrowKeyState.key === key) return;

    // 清理之前的状态（如果有不同方向键）
    this._clearArrowKeyState();

    const editor = this.editor;
    const dx = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
    const dy = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;

    // 首次按下：移动 1px
    this._moveSelectedObjects(dx, dy);

    // 设置定时器：1 秒后开始持续移动
    const startTime = Date.now();
    const holdTimerId = setTimeout(() => {
      // 1 秒后开始持续移动，20px/s = 每 50ms 移动 1px
      const intervalId = setInterval(() => {
        this._moveSelectedObjects(dx, dy);
      }, 50);
      if (this._arrowKeyState) {
        this._arrowKeyState.intervalId = intervalId;
      }
    }, 1000);

    this._arrowKeyState = { key, startTime, holdTimerId, intervalId: null };
  }

  /**
   * 方向键松开：停止持续移动，保存历史
   * @private
   */
  _handleArrowKeyUp(key) {
    if (!this._arrowKeyState || this._arrowKeyState.key !== key) return;
    this._clearArrowKeyState();
    // 保存历史记录（一次方向键操作作为一个撤销步骤）
    this.editor.history.saveHistory();
  }

  /**
   * 清理方向键持续移动状态
   * @private
   */
  _clearArrowKeyState() {
    if (!this._arrowKeyState) return;
    if (this._arrowKeyState.holdTimerId) clearTimeout(this._arrowKeyState.holdTimerId);
    if (this._arrowKeyState.intervalId) clearInterval(this._arrowKeyState.intervalId);
    this._arrowKeyState = null;
  }

  /**
   * 移动所有选中对象指定像素
   * @private
   */
  _moveSelectedObjects(dx, dy) {
    const editor = this.editor;
    for (const obj of editor.selectedObjects) {
      if (!editor.layers.isObjectEditableFor(obj)) continue;
      if ((obj.type === 'shape' || obj.type === 'buffZone' || obj.type === 'effectZone') && Array.isArray(obj.points)) {
        obj.points = obj.points.map(p => [p[0] + dx, p[1] + dy]);
        if (obj.type === 'buffZone' || obj.type === 'effectZone') {
          if (obj.x !== undefined) obj.x += dx;
          if (obj.y !== undefined) obj.y += dy;
        }
      } else {
        if (obj.x !== undefined) obj.x += dx;
        if (obj.y !== undefined) obj.y += dy;
      }
      if (Number.isFinite(obj.sortY)) obj.sortY += dy;
    }
    editor.canvas.render();
    editor.ui.updateObjectProperties();
  }

  /**
   * 全选所有未锁定可见图层中的对象
   */
  _selectAll() {
    const editor = this.editor;
    const layers = editor.sceneData.layers;
    if (!layers || layers.length === 0) return;
    const allObjects = [];
    for (const layer of layers) {
      if (!layer?.objects) continue;
      for (const object of layer.objects) {
        if (editor.layers.isObjectEditable(layer, object)) allObjects.push(object);
      }
    }
    editor.selectedObjects = allObjects;
    editor.canvas.render();
    editor.ui.updateObjectProperties();
  }

  /**
   * 复制选中的对象到剪贴板
   */
  _copySelection() {
    const editor = this.editor;
    if (editor.selectedObjects.length === 0) return;
    // 深拷贝选中对象
    this._clipboard = JSON.parse(JSON.stringify(editor.selectedObjects));
    // 记录复制时的场景ID，用于跨场景粘贴时判断是否需要偏移
    this._clipboardSceneId = editor.sceneData.id || editor.sceneData.name;
    editor.ui.showToast(`已复制 ${this._clipboard.length} 个对象`);
  }

  /**
   * 粘贴剪贴板中的对象
   * 同场景粘贴偏移 20px 避免重叠，跨场景粘贴保持原始坐标
   */
  _pasteSelection() {
    const editor = this.editor;
    if (!this._clipboard || this._clipboard.length === 0) return;
    const layers = editor.sceneData.layers;
    if (!layers || layers.length === 0) return;
    const layer = layers[editor.activeLayerIndex];
    if (!layer || layer.locked) {
      editor.ui.showToast('当前图层已锁定，无法粘贴', true);
      return;
    }
    if (!layer.objects) layer.objects = [];

    // 跨场景粘贴保持原始坐标，同场景粘贴偏移 20px 避免重叠
    const currentSceneId = editor.sceneData.id || editor.sceneData.name;
    const isSameScene = this._clipboardSceneId === currentSceneId;
    const offset = isSameScene ? 20 : 0;

    // 收集当前场景全部对象 ID，确保随机后缀在场景内真正唯一
    const usedIds = new Set();
    for (const sceneLayer of layers) {
      for (const object of (sceneLayer.objects || [])) {
        if (object?.id) usedIds.add(object.id);
      }
    }

    const sourceIdCounts = new Map();
    for (const source of this._clipboard) {
      if (source?.id) sourceIdCounts.set(source.id, (sourceIdCounts.get(source.id) || 0) + 1);
    }

    const createUniqueId = sourceId => {
      const baseId = sourceId || `obj_${Date.now()}`;
      let nextId;
      do {
        const suffix = Math.floor(100 + Math.random() * 900);
        nextId = `${baseId}_${suffix}`;
      } while (usedIds.has(nextId));
      usedIds.add(nextId);
      return nextId;
    };

    // 第一遍先为每个实例生成新 ID；只有来源 ID 唯一时才能安全建立引用映射
    const pasted = this._clipboard.map(source => {
      const object = JSON.parse(JSON.stringify(source));
      const oldId = object.id || null;
      object.id = createUniqueId(oldId);
      return { object, oldId };
    });
    const referenceIdMap = new Map();
    for (const entry of pasted) {
      if (entry.oldId && sourceIdCounts.get(entry.oldId) === 1) {
        referenceIdMap.set(entry.oldId, entry.object.id);
      }
    }

    // 第二遍仅同步复制组内部的对象关联；内容库 ref、atlasId、imageId 保持不变
    const referenceFields = new Set([
      'target', 'targetId', 'parentId', 'objectId', 'sourceId'
    ]);
    const remapReferences = value => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(remapReferences);
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (referenceFields.has(key) && typeof child === 'string' && referenceIdMap.has(child)) {
          value[key] = referenceIdMap.get(child);
        } else if (child && typeof child === 'object') {
          remapReferences(child);
        }
      }
    };

    for (const entry of pasted) {
      const obj = entry.object;
      remapReferences(obj);
      if (offset > 0) {
        if (obj.x !== undefined) obj.x += offset;
        if (obj.y !== undefined) obj.y += offset;
        if (Array.isArray(obj.points)) {
          obj.points = obj.points.map(p => [p[0] + offset, p[1] + offset]);
        }
        if (Number.isFinite(obj.sortY)) obj.sortY += offset;
      }
      layer.objects.push(obj);
    }

    editor.selectedObjects = pasted.map(entry => entry.object);
    editor.history.saveHistory();
    editor.canvas.render();
    editor.ui.updateObjectProperties();
    editor.ui.showToast(`已粘贴 ${pasted.length} 个对象（ID 已重新生成）`);
  }

  /**
   * 渲染框选矩形（在 overlay canvas 上）
   * @private
   */
  _renderBoxSelection() {
    const editor = this.editor;
    const overlay = document.getElementById('editor-overlay');
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const start = editor.interaction.boxSelectStart;
    const end = editor.interaction.boxSelectEnd;
    if (!start || !end) return;

    // 转换场景坐标到屏幕坐标
    const sx = start.x * editor.viewport.scale + editor.viewport.offsetX;
    const sy = start.y * editor.viewport.scale + editor.viewport.offsetY;
    const ex = end.x * editor.viewport.scale + editor.viewport.offsetX;
    const ey = end.y * editor.viewport.scale + editor.viewport.offsetY;

    const x = Math.min(sx, ex);
    const y = Math.min(sy, ey);
    const w = Math.abs(ex - sx);
    const h = Math.abs(ey - sy);

    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(74, 158, 255, 0.1)';
    ctx.fillRect(x, y, w, h);
  }

  /**
   * 渲染连线（Shift+从触发器拖拽时的实时连线）
   * @private
   */
  _renderLinkLine() {
    const editor = this.editor;
    const overlay = document.getElementById('editor-overlay');
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const source = editor.interaction.linkSource;
    const end = editor.interaction.linkEnd;
    if (!source || !end) return;

    // 触发器中心
    const srcX = (source.x + (source.width || 0) / 2) * editor.viewport.scale + editor.viewport.offsetX;
    const srcY = (source.y + (source.height || 0) / 2) * editor.viewport.scale + editor.viewport.offsetY;
    const endX = end.x * editor.viewport.scale + editor.viewport.offsetX;
    const endY = end.y * editor.viewport.scale + editor.viewport.offsetY;

    // 虚线箭头
    ctx.beginPath();
    ctx.moveTo(srcX, srcY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = '#e0a020';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 箭头头部
    const angle = Math.atan2(endY - srcY, endX - srcX);
    const arrowLen = 12;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - arrowLen * Math.cos(angle - 0.4), endY - arrowLen * Math.sin(angle - 0.4));
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - arrowLen * Math.cos(angle + 0.4), endY - arrowLen * Math.sin(angle + 0.4));
    ctx.strokeStyle = '#e0a020';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 提示文字
    ctx.fillStyle = '#e0a020';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('关联目标', (srcX + endX) / 2, (srcY + endY) / 2 - 8);
  }

  /**
   * 进入拾取目标模式（属性面板「🎯」按钮调用）
   * @param {Object} triggerObj - 触发器对象
   */
  startPickTarget(triggerObj) {
    const editor = this.editor;
    editor.interaction.isPickingTarget = true;
    editor.interaction.pickSource = triggerObj;
    const canvas = document.getElementById('editor-overlay') || document.getElementById('editor-canvas');
    if (canvas) canvas.style.cursor = 'crosshair';
    editor.ui.showToast('点击场景中的目标对象完成关联…');
  }

  /**
   * 框选完成：选中矩形范围内的所有对象
   * @private
   */
  _finishBoxSelection(addToSelection) {
    const editor = this.editor;
    const start = editor.interaction.boxSelectStart;
    const end = editor.interaction.boxSelectEnd;
    if (!start || !end) return;

    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);

    // 框选范围太小（< 4px）视为点击空白
    if (right - left < 4 && bottom - top < 4) return;

    const selected = addToSelection ? [...editor.selectedObjects] : [];

    // 遍历所有可编辑对象
    for (const layer of editor.sceneData.layers) {
      if (!layer?.objects) continue;
      for (const obj of layer.objects) {
        if (!editor.layers.isObjectEditable(layer, obj)) continue;
        if (selected.includes(obj)) continue;
        if (this._isObjectInRect(obj, left, top, right, bottom)) {
          selected.push(obj);
        }
      }
    }

    editor.selectedObjects = selected;

    // 清除 overlay
    const overlay = document.getElementById('editor-overlay');
    if (overlay) {
      overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
    }
  }

  /**
   * 判断对象是否在矩形框选范围内（对象中心或对象边界与选框相交）
   * @private
   */
  _isObjectInRect(obj, left, top, right, bottom) {
    if (obj.type === 'shape' && Array.isArray(obj.points) && obj.points.length > 0) {
      // 多边形/路径：任一顶点在框内即选中
      return obj.points.some(p => p[0] >= left && p[0] <= right && p[1] >= top && p[1] <= bottom);
    }

    if (obj.type === 'circle') {
      // 圆形：圆心在框内
      return obj.x >= left && obj.x <= right && obj.y >= top && obj.y <= bottom;
    }

    if (obj.type === 'ref') {
      const visual = this.editor.assets.resolvePlacementVisual?.(obj);
      const bounds = visual?.image ? visual.bounds : null;
      if (bounds) {
        return !(bounds.x > right || bounds.right < left || bounds.y > bottom || bounds.bottom < top);
      }
      return obj.x >= left && obj.x <= right && obj.y >= top && obj.y <= bottom;
    }

    if (obj.type === 'spawn' || obj.type === 'portal' || obj.type === 'npc') {
      // 点状对象：位置在框内
      return obj.x >= left && obj.x <= right && obj.y >= top && obj.y <= bottom;
    }

    // 矩形类对象（rect/image/slice/fill/deco/ellipse/region）：边界框相交
    if (obj.x !== undefined && obj.width !== undefined) {
      const objRight = obj.x + obj.width;
      const objBottom = obj.y + obj.height;
      // 相交判定：不是完全不相交
      return !(obj.x > right || objRight < left || obj.y > bottom || objBottom < top);
    }

    return false;
  }
}
