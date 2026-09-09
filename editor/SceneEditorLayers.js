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
 * SceneEditorLayers - 场景编辑器图层管理模块
 * 负责图层的增删改查、排序、对象移动
 */
export class SceneEditorLayers {
  /**
   * @param {import('./SceneEditor.js').SceneEditor} editor - 主编辑器实例
   */
  constructor(editor) {
    this.editor = editor;
    this.expandedLayerIds = new Set();
  }

  /** 返回对象所属图层；对象不在当前场景图层时返回 null。 */
  getObjectLayer(object) {
    if (!object) return null;
    return this.editor.sceneData?.layers?.find(layer => layer?.objects?.includes(object)) || null;
  }

  /** 编辑器专用对象状态，缺失字段按可见且未锁定处理。 */
  getObjectEditorState(object) {
    const state = object?.editor;
    return state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  }

  isObjectEditorVisible(object) {
    return this.getObjectEditorState(object).visible !== false;
  }

  isObjectEditorLocked(object) {
    return this.getObjectEditorState(object).locked === true;
  }

  isObjectVisible(layer, object) {
    return layer?.visible !== false
      && this.isObjectEditorVisible(object)
      && this.editor.eventFilter?.isObjectVisible(object) !== false;
  }

  isObjectVisibleFor(object) {
    const layer = this.getObjectLayer(object);
    return !!layer && this.isObjectVisible(layer, object);
  }

  isObjectEditable(layer, object) {
    return this.isObjectVisible(layer, object)
      && layer?.locked !== true
      && !this.isObjectEditorLocked(object);
  }

  isObjectEditableFor(object) {
    const layer = this.getObjectLayer(object);
    return !!layer && this.isObjectEditable(layer, object);
  }

  /**
   * 记录编辑器专用对象状态；该命名空间不参与游戏运行时的对象语义。
   */
  setObjectEditorState(object, key, value) {
    if (!object || !['visible', 'locked'].includes(key)) return false;
    const current = this.getObjectEditorState(object);
    if (current[key] === value) return false;
    object.editor = { ...current, [key]: value };
    return true;
  }

  /** 隐藏对象时同步取消当前编辑器交互，防止残留选择框或拖拽继续改动它。 */
  sanitizeObjectInteractionState() {
    const editor = this.editor;
    editor.selectedObjects = (editor.selectedObjects || []).filter(object => this.isObjectVisibleFor(object));
    Object.assign(editor.interaction, {
      isDragging: false,
      isResizing: false,
      isLinking: false,
      isPickingTarget: false,
      isBoxSelecting: false,
      draggingVertex: null,
      resizeTarget: null,
      resizeStart: null,
      linkSource: null,
      linkEnd: null,
      pickSource: null,
      boxSelectStart: null,
      boxSelectEnd: null,
      allObjectStarts: null
    });
    editor.interactionModule?._clearArrowKeyState?.();
  }

  /**
   * 添加图层
   */
  addLayer(name) {
    const editor = this.editor;
    const layer = {
      id: 'layer_' + Date.now(),
      name: name || `图层 ${editor.sceneData.layers.length + 1}`,
      visible: true,
      locked: false,
      objects: []
    };
    editor.sceneData.layers.push(layer);
    this.updateLayerList();
    editor.history.saveHistory();
    return layer;
  }

  /**
   * 在用户明确执行放置操作时按稳定 ID 取得或创建图层。
   * 本方法不写 history、不刷新 UI，调用方应把创建图层与对象放置合并为一次历史提交。
   */
  ensureLayer(id, name, { beforeId = 'layer_entity' } = {}) {
    const editor = this.editor;
    if (!Array.isArray(editor.sceneData?.layers)) {
      throw new Error('当前场景缺少 layers 数组');
    }
    const matches = editor.sceneData.layers.filter(layer => layer?.id === id);
    if (matches.length > 1) throw new Error(`场景包含重复图层 ID: ${id}`);
    if (matches[0]) {
      if (!Array.isArray(matches[0].objects)) matches[0].objects = [];
      return matches[0];
    }

    const layer = {
      id,
      name: name || id,
      visible: true,
      locked: false,
      objects: []
    };
    const beforeIndex = editor.sceneData.layers.findIndex(candidate => candidate?.id === beforeId);
    editor.sceneData.layers.splice(beforeIndex >= 0 ? beforeIndex : editor.sceneData.layers.length, 0, layer);
    return layer;
  }

  /**
   * 删除当前激活图层
   */
  deleteLayer() {
    const editor = this.editor;
    if (editor.sceneData.layers.length <= 1) {
      editor.ui.showToast('至少保留一个图层', 'error');
      return;
    }

    const layer = editor.sceneData.layers[editor.activeLayerIndex];
    const objCount = layer.objects.length;

    if (objCount > 0) {
      if (!confirm(`图层"${layer.name}"中有 ${objCount} 个对象，删除后不可恢复。确认删除？`)) {
        return;
      }
    }

    editor.sceneData.layers.splice(editor.activeLayerIndex, 1);
    if (editor.activeLayerIndex >= editor.sceneData.layers.length) {
      editor.activeLayerIndex = editor.sceneData.layers.length - 1;
    }

    editor.selectedObjects = [];
    this.updateLayerList();
    editor.ui.updateObjectCount();
    editor.ui.updateObjectProperties();
    editor.history.saveHistory();
    editor.render();
  }

  /**
   * 将当前激活图层上移一层（提高遮挡优先级）
   */
  moveLayerUp() {
    const editor = this.editor;
    const idx = editor.activeLayerIndex;
    if (idx >= editor.sceneData.layers.length - 1) return;

    const layers = editor.sceneData.layers;
    [layers[idx], layers[idx + 1]] = [layers[idx + 1], layers[idx]];
    editor.activeLayerIndex = idx + 1;

    this.updateLayerList();
    editor.history.saveHistory();
    editor.render();
  }

  /**
   * 将当前激活图层下移一层
   */
  moveLayerDown() {
    const editor = this.editor;
    const idx = editor.activeLayerIndex;
    if (idx <= 0) return;

    const layers = editor.sceneData.layers;
    [layers[idx], layers[idx - 1]] = [layers[idx - 1], layers[idx]];
    editor.activeLayerIndex = idx - 1;

    this.updateLayerList();
    editor.history.saveHistory();
    editor.render();
  }

  /**
   * 将当前选中对象移动到当前激活图层
   */
  moveSelectedObjectToActiveLayer() {
    const editor = this.editor;
    if (editor.selectedObjects.length === 0) {
      editor.ui.showToast('请先选中一个对象', 'error');
      return;
    }

    const targetLayer = editor.sceneData.layers[editor.activeLayerIndex];
    if (!targetLayer) return;
    if (targetLayer.locked) {
      editor.ui.showToast(`目标图层「${targetLayer.name}」已锁定`, 'error');
      return;
    }

    let movedCount = 0;

    for (const obj of editor.selectedObjects) {
      if (!this.isObjectEditableFor(obj)) {
        editor.ui.showToast('已跳过锁定或隐藏的对象', 'warn');
        continue;
      }
      if (obj.type === 'decoration') {
        editor.ui.showToast('装饰物暂不支持跨层移动', 'error');
        continue;
      }

      let removed = false;
      for (const layer of editor.sceneData.layers) {
        const index = layer.objects.indexOf(obj);
        if (index !== -1) {
          if (layer === targetLayer) break;
          layer.objects.splice(index, 1);
          removed = true;
          break;
        }
      }

      if (removed) {
        targetLayer.objects.push(obj);
        movedCount++;
      }
    }

    if (movedCount > 0) {
      editor.ui.showToast(`已将 ${movedCount} 个对象移入"${targetLayer.name}"`);
      this.updateLayerList();
      editor.ui.updateObjectCount();
      editor.history.saveHistory();
      editor.render();
    }
  }

  /**
   * 批量设置深度
   */
  batchSetDepth() {
    const editor = this.editor;
    const layer = editor.sceneData.layers[editor.activeLayerIndex];
    if (!layer) return;
    if (editor.eventFilter?.isFiltering()) {
      editor.ui.showToast('事件筛选状态下禁止批量调整深度，请先选择“全部”', 'warn');
      return;
    }

    const editableObjects = layer.objects.filter(object => this.isObjectEditable(layer, object));
    if (editableObjects.length === 0) {
      editor.ui.showToast(`图层"${layer.name}"中没有可编辑对象`, 'warn');
      return;
    }

    const keys = new Set();
    for (const obj of editableObjects) {
      if (obj.decoKey) keys.add(obj.decoKey);
      if (obj.sliceKey) keys.add(obj.sliceKey);
      if (obj.name) keys.add(obj.name);
      if (!obj.decoKey && !obj.sliceKey && !obj.name) keys.add(obj.type);
    }

    const keyList = [...keys].sort().join(', ');
    const filter = prompt(`当前图层"${layer.name}"中的可编辑对象标识:\n${keyList}\n\n输入要筛选的名称（如 grass1）：`);
    if (!filter || !filter.trim()) return;

    const depthStr = prompt(`将所有"${filter}"对象设置到可编辑深度（0=最底）：`, '20');
    if (depthStr === null) return;
    const targetDepth = parseInt(depthStr);
    if (isNaN(targetDepth) || targetDepth < 0) {
      editor.ui.showToast('深度必须是非负整数', 'error');
      return;
    }

    const filterKey = filter.trim();
    const matchObj = (obj) => (
      obj.decoKey === filterKey
      || obj.sliceKey === filterKey
      || obj.name === filterKey
      || (!obj.decoKey && !obj.sliceKey && !obj.name && obj.type === filterKey)
    );
    const matched = editableObjects.filter(matchObj);

    if (matched.length === 0) {
      editor.ui.showToast(`未找到名称为"${filterKey}"的可编辑对象`, 'error');
      return;
    }

    const remaining = editableObjects.filter(object => !matchObj(object));
    const insertAt = Math.min(targetDepth, remaining.length);
    remaining.splice(insertAt, 0, ...matched);
    const reorderedEditable = remaining[Symbol.iterator]();

    // 隐藏或锁定对象作为固定深度锚点，批量排序绝不跨越或改写它们。
    layer.objects = layer.objects.map(object => (
      this.isObjectEditable(layer, object) ? reorderedEditable.next().value : object
    ));

    editor.ui.showToast(`已将 ${matched.length} 个"${filterKey}"对象设置到可编辑深度 ${insertAt}`);
    this.updateLayerList();
    editor.ui.updateObjectProperties();
    editor.history.saveHistory();
    editor.render();
  }

  /**
   * 去重
   */
  deduplicateObjects() {
    const editor = this.editor;
    const layer = editor.sceneData.layers[editor.activeLayerIndex];
    if (!layer) return;

    const filteredObjects = editor.eventFilter?.filterObjects(layer.objects) || layer.objects;
    const candidates = filteredObjects.filter(object => this.isObjectEditable(layer, object));
    if (candidates.length === 0) {
      editor.ui.showToast(`图层"${layer.name}"中没有当前可编辑对象`, 'warn');
      return;
    }
    const candidateSet = new Set(candidates);
    const seen = new Set();
    const unique = [];
    let removed = 0;

    for (const obj of layer.objects) {
      if (!candidateSet.has(obj)) {
        unique.push(obj);
        continue;
      }
      const key = obj.decoKey || obj.sliceKey || obj.name || obj.type;
      const posKey = `${key}_${Math.round(obj.x)}_${Math.round(obj.y)}`;
      if (seen.has(posKey)) {
        removed++;
      } else {
        seen.add(posKey);
        unique.push(obj);
      }
    }

    if (removed === 0) {
      editor.ui.showToast(`图层"${layer.name}"中无重复对象`);
      return;
    }

    layer.objects = unique;
    editor.selectedObjects = [];
    editor.eventFilter?.rebuild({ preserveSelection: true });
    editor.ui.showToast(`已去除 ${removed} 个重复对象`);
    this.updateLayerList();
    editor.ui.updateObjectCount();
    editor.ui.updateObjectProperties();
    editor.history.saveHistory();
    editor.render();
  }

  /**
   * 批量偏移
   */
  batchOffset() {
    const editor = this.editor;
    const layer = editor.sceneData.layers[editor.activeLayerIndex];
    if (!layer) return;

    const filteredObjects = editor.eventFilter?.filterObjects(layer.objects) || layer.objects;
    const candidates = filteredObjects.filter(object => this.isObjectEditable(layer, object));
    if (candidates.length === 0) {
      editor.ui.showToast(`图层"${layer.name}"中没有当前可编辑对象`, 'warn');
      return;
    }

    const dx = parseInt(prompt('X 方向偏移（正=右，负=左）：', '0'));
    const dy = parseInt(prompt('Y 方向偏移（正=下，负=上）：', '50'));

    if (isNaN(dx) && isNaN(dy)) return;
    const offsetX = isNaN(dx) ? 0 : dx;
    const offsetY = isNaN(dy) ? 0 : dy;

    if (offsetX === 0 && offsetY === 0) return;

    editor.history.saveHistory();
    for (const obj of candidates) {
      if (Number.isFinite(obj.x)) obj.x = Math.round(obj.x + offsetX);
      if (Number.isFinite(obj.y)) obj.y = Math.round(obj.y + offsetY);
      if (Array.isArray(obj.points)) {
        obj.points = obj.points.map(point => [
          Math.round(point[0] + offsetX),
          Math.round(point[1] + offsetY)
        ]);
      }
      if (Number.isFinite(obj.sortY)) obj.sortY += offsetY;
    }

    editor.ui.showToast(`已偏移"${layer.name}"中 ${candidates.length} 个可编辑对象 (${offsetX}, ${offsetY})`);
    editor.ui.updateObjectProperties();
    editor.render();
  }

  /**
   * 更新图层列表UI
   */
  updateLayerList() {
    const editor = this.editor;
    const list = document.getElementById('editor-layer-list');
    if (!list) return;

    list.replaceChildren();
    const selectedObject = editor.selectedObjects.length === 1 ? editor.selectedObjects[0] : null;

    const createControl = ({ action, title, text, style }) => {
      const control = document.createElement('button');
      control.type = 'button';
      control.dataset.action = action;
      control.title = title;
      control.textContent = text;
      control.style.cssText = style;
      return control;
    };
    const btnBase = 'display:inline-flex;align-items:center;justify-content:center;width:26px;height:22px;padding:0;border-radius:3px;cursor:pointer;margin-right:3px;font-size:13px;border:1px solid;flex-shrink:0;';

    // 从后往前显示：列表顶部与实际绘制最前景一致。
    for (let layerIndex = editor.sceneData.layers.length - 1; layerIndex >= 0; layerIndex--) {
      const layer = editor.sceneData.layers[layerIndex];
      const expanded = this.expandedLayerIds.has(layer.id);
      const item = document.createElement('div');
      const selectedInLayer = selectedObject && layer.objects.includes(selectedObject);
      item.className = 'layer-item'
        + (layerIndex === editor.activeLayerIndex ? ' active' : '')
        + (selectedInLayer ? ' has-selected' : '');
      item.dataset.index = String(layerIndex);

      const totalCount = layer.objects.length;
      const visibleCount = layer.objects.filter(object => this.isObjectVisible(layer, object)).length;
      const objCount = visibleCount === totalCount ? String(totalCount) : `${visibleCount}/${totalCount}`;
      const expandButton = createControl({
        action: 'toggle-objects',
        title: expanded ? '收起物品列表' : '展开物品列表',
        text: expanded ? '▾' : '▸',
        style: `${btnBase}background:#26365f;border-color:#5574ad;`
      });
      const visibilityButton = createControl({
        action: 'visibility',
        title: layer.visible ? '点击隐藏图层' : '点击显示图层',
        text: layer.visible ? '👁' : '🚫',
        style: layer.visible
          ? `${btnBase}background:#2a4a2a;border-color:#4a8a4a;`
          : `${btnBase}background:#3a3a3a;border-color:#666;opacity:.7;`
      });
      const lockButton = createControl({
        action: 'lock',
        title: layer.locked ? '已锁定，点击解锁图层' : '未锁定，点击锁定图层',
        text: layer.locked ? '🔒' : '🔓',
        style: layer.locked
          ? `${btnBase}background:#5a2a2a;border-color:#c0504a;`
          : `${btnBase}background:#2a3a5e;border-color:#4a8a4a;`
      });
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.dataset.action = 'select';
      name.textContent = layer.name;
      const count = document.createElement('span');
      count.className = 'layer-count';
      count.textContent = objCount;
      item.append(expandButton, visibilityButton, lockButton, name, count);
      if (selectedInLayer) {
        const marker = document.createElement('span');
        marker.className = 'layer-obj-marker';
        marker.title = '选中对象在此层';
        marker.textContent = '◆';
        item.appendChild(marker);
      }

      name.addEventListener('dblclick', event => {
        event.stopPropagation();
        const newName = prompt('图层名称:', layer.name);
        if (newName?.trim()) {
          layer.name = newName.trim();
          editor.history.saveHistory();
          this.updateLayerList();
        }
      });
      item.addEventListener('click', event => {
        const action = event.target.closest('[data-action]')?.dataset.action || 'select';
        if (action === 'toggle-objects') {
          if (expanded) this.expandedLayerIds.delete(layer.id);
          else this.expandedLayerIds.add(layer.id);
        } else if (action === 'visibility') {
          layer.visible = !layer.visible;
          editor.history.saveHistory();
          this.sanitizeObjectInteractionState();
          editor.render();
          editor.ui.updateObjectProperties();
        } else if (action === 'lock') {
          layer.locked = !layer.locked;
          editor.history.saveHistory();
          this.sanitizeObjectInteractionState();
          editor.render();
          editor.ui.updateObjectProperties();
        } else {
          editor.activeLayerIndex = layerIndex;
        }
        this.updateLayerList();
      });
      list.appendChild(item);

      if (!expanded) continue;
      const objectList = document.createElement('div');
      objectList.style.cssText = 'margin:0 0 4px 18px;padding:3px 0 2px;border-left:1px solid #40517f;';
      // 与绘制顺序一致：数组末尾（最前景）排在子列表最上方。
      for (let objectIndex = layer.objects.length - 1; objectIndex >= 0; objectIndex--) {
        const object = layer.objects[objectIndex];
        const objectVisible = this.isObjectEditorVisible(object);
        const objectLocked = this.isObjectEditorLocked(object);
        const objectItem = document.createElement('div');
        objectItem.style.cssText = `display:flex;align-items:center;gap:2px;margin:1px 0 1px 5px;padding:3px 4px;border-radius:3px;cursor:${objectVisible ? 'pointer' : 'default'};font-size:10px;background:${selectedObject === object ? '#42683c' : '#1d2a49'};opacity:${objectVisible ? '1' : '.52'};`;
        objectItem.title = `${object.id || object.type || '未命名对象'} · 深度 ${objectIndex}`;

        const objectVisibility = createControl({
          action: 'object-visibility',
          title: objectVisible ? '仅在编辑器中隐藏此物品' : '仅在编辑器中显示此物品',
          text: objectVisible ? '👁' : '🚫',
          style: `${btnBase}width:22px;height:19px;margin-right:0;font-size:11px;${objectVisible ? 'background:#254830;border-color:#4a8a4a;' : 'background:#3a3a3a;border-color:#666;'}`
        });
        const objectLock = createControl({
          action: 'object-lock',
          title: objectLocked ? '已锁定，点击解锁物品' : '未锁定，点击锁定物品',
          text: objectLocked ? '🔒' : '🔓',
          style: `${btnBase}width:22px;height:19px;margin-right:0;font-size:11px;${objectLocked ? 'background:#5a2a2a;border-color:#c0504a;' : 'background:#26365f;border-color:#5574ad;'}`
        });
        const objectName = document.createElement('span');
        objectName.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 2px;';
        objectName.textContent = object.name || object.ref || object.imageId || object.id || object.type || '未命名对象';
        const depth = document.createElement('span');
        depth.style.cssText = 'color:#8fa3ca;font-size:9px;flex-shrink:0;';
        depth.textContent = `#${objectIndex}`;
        objectItem.append(objectVisibility, objectLock, objectName, depth);
        objectItem.addEventListener('click', event => {
          const action = event.target.closest('[data-action]')?.dataset.action;
          if (action === 'object-visibility') {
            this.setObjectEditorState(object, 'visible', !objectVisible);
            editor.history.saveHistory();
            this.sanitizeObjectInteractionState();
          } else if (action === 'object-lock') {
            this.setObjectEditorState(object, 'locked', !objectLocked);
            editor.history.saveHistory();
            this.sanitizeObjectInteractionState();
          } else if (objectVisible) {
            editor.activeLayerIndex = layerIndex;
            editor.selectedObjects = [object];
          }
          editor.ui.updateObjectProperties();
          editor.render();
          this.updateLayerList();
        });
        objectList.appendChild(objectItem);
      }
      list.appendChild(objectList);
    }
  }

  /**
   * 规范化图层结构
   */
  normalizeLayers(layers) {
    const standard = [
      { id: 'layer_bg', name: '背景层' },
      { id: 'layer_fill', name: '背景填充层' },
      { id: 'layer_deco', name: '装饰层' },
      { id: 'layer_entity', name: '实体层' }
    ];

    const input = Array.isArray(layers) ? layers : [];
    const byId = new Map();
    for (const l of input) {
      if (l && l.id) byId.set(l.id, l);
    }

    const result = [];

    for (const std of standard) {
      const existing = byId.get(std.id);
      result.push({
        id: std.id,
        name: existing?.name || std.name,
        visible: existing?.visible !== false,
        locked: existing?.locked === true,
        objects: Array.isArray(existing?.objects) ? existing.objects : []
      });
      byId.delete(std.id);
    }

    for (const l of input) {
      if (l && l.id && byId.has(l.id)) {
        result.push({
          id: l.id,
          name: l.name || l.id,
          visible: l.visible !== false,
          locked: l.locked === true,
          objects: Array.isArray(l.objects) ? l.objects : []
        });
        byId.delete(l.id);
      }
    }

    return result;
  }

  /**
   * 将 decorations 数组转换合并到装饰层 objects 中
   */
  mergeDecorationsToLayer() {
    const editor = this.editor;
    const decorations = editor.sceneData.decorations;
    if (!decorations || decorations.length === 0) return;

    const decoLayer = editor.sceneData.layers.find(l => l.id === 'layer_deco');
    if (!decoLayer) return;

    if (decoLayer.objects.some(o => o.type === 'deco' || o.type === 'slice')) return;

    const atlasRegistry = editor.getAtlasRegistry?.();
    const legacySprites = editor.sceneData.decoSprites || {};

    for (const deco of decorations) {
      const atlas = atlasRegistry?.findAtlasBySliceKey(deco.key) || null;
      const sprite = atlas?.slices?.[deco.key] || legacySprites[deco.key];
      const scale = (deco.scale || 1) * (sprite?.scale || 1);
      const sw = sprite?.sw || 64;
      const sh = sprite?.sh || 64;
      const w = sw * scale;
      const h = sh * scale;

      const obj = {
        id: 'deco_' + Math.floor(Math.random() * 100000000),
        type: atlas ? 'slice' : 'deco',
        x: Math.round(deco.x - w / 2),
        y: Math.round(deco.y - h),
        width: Math.round(w),
        height: Math.round(h),
        scale: deco.scale || 1,
        name: sprite?.name || deco.key
      };
      if (atlas) {
        obj.atlasId = atlas.id;
        obj.sliceKey = deco.key;
      } else {
        obj.decoKey = deco.key;
      }

      if (deco.belowEntities) obj.belowEntities = true;
      decoLayer.objects.push(obj);
    }

    editor.sceneData.decorations = [];
  }
}
