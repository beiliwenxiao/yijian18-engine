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
 * SkeletonEditor - 骨骼动画编辑器（独立页面）
 *
 * 布局：左（骨骼树 + 槽位） / 中（画布 gizmo + 附件预览） / 右（属性检查器） / 底（关键帧时间轴）。
 * 编辑模型：this.doc 为骨骼 JSON 文档（authoring 形态）；预览与 gizmo 使用
 * parseSkeletonAsset + evaluateSkeletonPose（与游戏运行时同一套采样代码）。
 * gizmo 拖拽语义：骨骼有轨道 → 实时 upsert 播放头处的关键帧；无轨道 → 编辑静止姿态。
 * 保存：/api/skeleton-asset-transaction 原子事务（骨骼 JSON + Manifest）。
 */

import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { evaluateSkeletonPose } from '../src/animation/SkeletonPose.js';
import { validateSkeletonAsset } from '../src/core/validation/SkeletonAssetValidator.js';
import { SkeletonEditorCommandService } from './SkeletonEditorCommandService.js';

const DEG2RAD = Math.PI / 180;

export class SkeletonEditor {
  constructor(container, { gameId, projectPath }) {
    this.container = container;
    this.gameId = gameId;
    this.projectPath = projectPath;
    this.gameRoot = projectPath.replace(/\/game\.project\.json$/, '');
    this.commands = new SkeletonEditorCommandService();

    // 文档与运行时
    this.doc = null;              // 骨骼 JSON 文档（authoring）
    this.runtime = null;          // parseSkeletonAsset 产物（预览/gizmo）
    this.dirty = false;
    this.imageCatalog = new Map();   // assetId -> { entry, url, element|null }
    this._selectedImageId = '';      // 图片库当前选中
    this.skeletonEntries = [];       // manifest 中 mode==='skeleton' 的条目

    // 选择与预览状态
    this.selectedBone = null;
    this.selectedSlot = null;
    this.selectedKey = null;         // { bone, index }
    this.currentClip = null;
    this.previewTime = 0;
    this.playing = false;
    this._lastFrameAt = 0;

    // 画布视图
    this.view = { scale: 1, ox: 0, oy: 0 };
    this._drag = null;               // { kind: 'move'|'rotate'|'attach-move'|'attach-rotate'|'pan', ... }
    this._alphaBoundsCache = new Map(); // 附件非透明像素包围盒缓存（key: assetId|srcRect）
    this._alphaSampleCanvas = null;     // alpha 扫描离屏画布
    // 图层式编辑辅助（会话态，不写入骨骼 JSON）：
    //   隐藏=仅编辑器预览不画（对齐场景编辑器物品级 👁 语义）；锁定=画布点选/拖拽跳过（防误触）。
    //   骨骼级按钮级联作用于子孙骨骼。
    this._hiddenSlots = new Set();
    this._lockedSlots = new Set();
    this._hiddenBones = new Set();
    this._lockedBones = new Set();
    // 撤销/重做：doc JSON 快照栈（编辑器会话内，最多 50 步）
    this._undoStack = [];
    this._redoStack = [];
    this._contextMenuCloser = null;
    // 半自动装配：切件模式（在整图上拖框切片 → slice 附件挂骨骼，零文件 IO）
    this._sliceMode = null;      // { assetId, width, height, rect:{x,y,w,h}|null }
    this._sliceSelecting = null; // { startX, startY } 屏幕坐标
    this._slicePanel = null;
  }

  /* ---------------- 初始化 ---------------- */

  async init() {
    this._bindDom();
    await this._loadManifest();
    this._newDoc();
    this._refreshAssetSelect();
    this._loop();
  }

  _bindDom() {
    const $ = id => document.getElementById(id);
    this.el = {
      assetSelect: $('se-asset-select'), skeletonId: $('se-skeleton-id'),
      metaWidth: $('se-meta-width'), metaHeight: $('se-meta-height'),
      dirty: $('se-dirty'), toast: $('se-toast'), save: $('se-save'),
      boneTree: $('se-bone-tree'), slotList: $('se-slot-list'),
      inspectorTitle: $('se-inspector-title'), inspectorBody: $('se-inspector-body'),
      canvas: $('se-canvas'),
      clipSelect: $('se-clip-select'), clipDuration: $('se-clip-duration'), clipLoop: $('se-clip-loop'),
      tlBody: $('se-tl-body'), trackBoneSelect: $('se-track-bone-select')
    };

    this.el.assetSelect.addEventListener('change', () => this._onAssetSelect());
    this.el.skeletonId.addEventListener('change', () => {
      if (!this.doc) return;
      this.doc.skeletonId = this.el.skeletonId.value.trim() || this.doc.skeletonId;
      this._markDirty();
    });
    for (const [key, field] of [['metaWidth', 'width'], ['metaHeight', 'height']]) {
      this.el[key].addEventListener('change', () => {
        if (!this.doc) return;
        this.doc.meta[field] = Math.max(8, Number(this.el[key].value) || 8);
        this._fitView();
        this._markDirty();
      });
    }
    this.el.save.addEventListener('click', () => this._save());
    $('se-bone-add').addEventListener('click', () => this._addBone());
    $('se-bone-del').addEventListener('click', () => this._deleteBone());
    $('se-bone-template').addEventListener('click', () => this._applyHumanoidTemplate());
    $('se-image-import').addEventListener('click', () => $('se-image-import-file').click());
    $('se-image-import-file').addEventListener('change', event => {
      const file = event.target.files?.[0];
      event.target.value = ''; // 允许重复导入同一文件
      if (file) this._importImageFromFile(file);
    });
    $('se-slot-add').addEventListener('click', () => this._addSlot());
    $('se-slot-del').addEventListener('click', () => this._deleteSlot());

    this.el.clipSelect.addEventListener('change', () => this._selectClip(this.el.clipSelect.value));
    $('se-clip-add').addEventListener('click', () => this._addClip());
    $('se-clip-del').addEventListener('click', () => this._deleteClip());
    this.el.clipDuration.addEventListener('change', () => this._setClipDuration());
    this.el.clipLoop.addEventListener('change', () => this._setClipLoop());
    $('se-play').addEventListener('click', () => this._togglePlay());
    $('se-rewind').addEventListener('click', () => { this.previewTime = 0; this._renderTimeline(); });
    // 帧步进 + 当前时间输入（步长 = 剪辑时长 / 12）
    $('se-frame-prev').addEventListener('click', () => {
      this.previewTime = Math.max(0, this.previewTime - this._clipDuration() / 12);
      this._renderTimeline();
    });
    $('se-frame-next').addEventListener('click', () => {
      this.previewTime = Math.min(this._clipDuration(), this.previewTime + this._clipDuration() / 12);
      this._renderTimeline();
    });
    $('se-time-input').addEventListener('change', event => {
      this.previewTime = Math.max(0, Math.min(this._clipDuration(), Number(event.target.value) || 0));
      this._renderTimeline();
    });
    $('se-keyframe').addEventListener('click', () => this._keySelectedBone());
    $('se-key-del').addEventListener('click', () => this._deleteSelectedKey());
    $('se-track-add').addEventListener('click', () => this._addTrack());
    $('se-track-del').addEventListener('click', () => this._removeTrack());

    // 检查器输入开始编辑前记录历史快照（focusin 冒泡委托，innerHTML 重建不影响）
    this.el.inspectorBody.addEventListener('focusin', () => this._pushHistory());

    const canvas = this.el.canvas;
    canvas.addEventListener('mousedown', event => this._onCanvasDown(event));
    window.addEventListener('mousemove', event => this._onCanvasMove(event));
    window.addEventListener('mouseup', event => this._onCanvasUp(event));
    // 拖拽防呆：窗口失焦（拖拽中切窗口导致 mouseup 丢失）时释放拖拽/选区状态
    window.addEventListener('blur', () => {
      this._drag = null;
      this._sliceSelecting = null;
    });
    canvas.addEventListener('wheel', event => this._onCanvasWheel(event), { passive: false });
    // 右键画布：命中图片附件 → 选中槽位并弹出图片右键菜单（对齐场景编辑器交互）
    canvas.addEventListener('contextmenu', event => {
      event.preventDefault();
      this._removeContextMenu();
      if (!this.runtime) return;
      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const hitSlotId = this._hitAttachment(mx, my, this._boneWorldTransforms());
      if (!hitSlotId) return;
      const slot = this._slotById(hitSlotId);
      const assetId = slot?.attachment?.assetId || '';
      this.selectedSlot = hitSlotId;
      this.selectedBone = slot?.bone || this.selectedBone;
      this._renderBoneTree();
      this._renderSlotList();
      this._renderInspector();
      if (assetId && this.imageCatalog.has(assetId)) {
        this._showContextMenu(event, this._buildImageMenuItems(assetId), this._imageEntryPath(assetId));
      }
    });

    // 悬浮变换工具条（Spine 式）：选中骨骼时显示 X/Y/旋转 精确输入
    const overlayBar = document.createElement('div');
    overlayBar.id = 'se-overlay-bar';
    canvas.parentElement.style.position = 'relative';
    overlayBar.style.cssText = 'position:absolute;left:50%;bottom:12px;transform:translateX(-50%);'
      + 'display:none;align-items:center;gap:6px;padding:6px 12px;background:rgba(16,24,48,0.92);'
      + 'border:1px solid #3a4a7e;border-radius:6px;font-size:12px;color:#e0e0e0;z-index:20;white-space:nowrap;';
    overlayBar.innerHTML = '<span id="se-ov-bone" style="color:#ffd479;font-weight:bold;"></span>'
      + '<label style="color:#9aa5c0;">X</label><input type="number" id="se-ov-x" step="1" style="width:64px;">'
      + '<label style="color:#9aa5c0;">Y</label><input type="number" id="se-ov-y" step="1" style="width:64px;">'
      + '<label style="color:#9aa5c0;">旋转°</label><input type="number" id="se-ov-rot" step="1" style="width:64px;">'
      + '<span style="color:#5a6a90;font-size:10px;">Enter 应用（自动打关键帧）</span>';
    canvas.parentElement.appendChild(overlayBar);
    for (const [field, axis] of [['se-ov-x', 'x'], ['se-ov-y', 'y'], ['se-ov-rot', 'rot']]) {
      overlayBar.querySelector(`#${field}`).addEventListener('change', event => {
        const boneId = this.selectedBone;
        if (!boneId || !this._clip()) return;
        this._pushHistory();
        const partial = {};
        partial[axis] = Number(event.target.value) || 0;
        this._ensureTrackAndKey(boneId, this._clip(), partial);
        this._markDirty();
        this._renderTimeline();
      });
    }

    window.addEventListener('keydown', event => {
      // 焦点在输入控件时不响应快捷键（避免输入空格/删除键误触发编辑器动作）；Esc 例外：先失焦再走取消逻辑
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        if (event.key !== 'Escape') return;
        document.activeElement.blur?.();
      }
      // 撤销 / 重做（Blender 惯例：Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y）
      if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault();
        if (event.shiftKey) this._redo();
        else this._undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || event.key === 'Y')) {
        event.preventDefault();
        this._redo();
        return;
      }
      if (event.key === 'Escape' && this._sliceMode) {
        this._exitSliceMode();
        return;
      }
      // Esc 取消进行中的拖拽（附件跟随中按 Esc 立即放手）
      if (event.key === 'Escape' && this._drag) {
        this._drag = null;
        return;
      }
      if (event.key === 'k' || event.key === 'K') this._keySelectedBone();
      if (event.key === ' ') { event.preventDefault(); this._togglePlay(); }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (this.selectedSlot) this._deleteSlot();
        else if (this.selectedBone && this.selectedBone !== this.doc.bones?.[0]?.id) this._deleteBone();
      }
    });
    window.addEventListener('resize', () => this._fitView());
  }

  async _loadManifest() {
    try {
      const manifest = await this.commands.fetchManifest(this.gameRoot);
      const entries = Array.isArray(manifest?.assets) ? manifest.assets : [];
      for (const entry of entries) {
        const mode = entry?.runtime2D?.mode;
        const path = entry?.runtime2D?.path;
        if (!path) continue;
        if (mode === 'image') {
          this.imageCatalog.set(entry.imageId || entry.assetId, {
            entry, url: `/${this.gameRoot}/${path}`, element: null
          });
        } else if (mode === 'skeleton') {
          this.skeletonEntries.push(entry);
        }
      }
      this._refreshAssetSelect();
      this._renderImageLib();
    } catch (error) {
      this._toast(`Manifest 读取失败：${error.message}`, true);
    }
  }

  _refreshAssetSelect() {
    const select = this.el.assetSelect;
    const current = select.value;
    select.innerHTML = '<option value="">➕ 新建骨骼…</option>'
      + this.skeletonEntries.map(entry => {
        const id = entry.imageId || entry.assetId;
        return `<option value="${id}">${id}</option>`;
      }).join('');
    if (current && [...select.options].some(option => option.value === current)) select.value = current;
  }

  /* ---------------- 文档管理 ---------------- */

  _newDoc() {
    this.doc = {
      schemaVersion: 1,
      skeletonId: 'skeleton.new',
      meta: { width: 100, height: 160 },
      defaultClip: 'idle',
      bones: [{ id: 'root', parent: null, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 30 }],
      slots: [],
      clips: [{
        name: 'idle', durationMs: 1000, loop: true,
        tracks: [{ bone: 'root', keys: [{ t: 0, x: 0, y: 0, rot: 0, scaleX: null, scaleY: null, ease: 'linear' }] }]
      }]
    };
    this.selectedBone = 'root';
    this.selectedSlot = null;
    this.selectedKey = null;
    this.currentClip = 'idle';
    this.previewTime = 0;
    this.playing = false;
    this.dirty = false;
    this._afterDocChange();
    this.el.skeletonId.value = this.doc.skeletonId;
    this.el.metaWidth.value = this.doc.meta.width;
    this.el.metaHeight.value = this.doc.meta.height;
    this.el.skeletonId.disabled = false;
  }

  async _loadDoc(skeletonId) {
    const entry = this.skeletonEntries.find(candidate => (candidate.imageId || candidate.assetId) === skeletonId);
    if (!entry) return;
    try {
      const doc = await this.commands.fetchSkeletonDocument(`/${this.gameRoot}/${entry.runtime2D.path}`);
      this.doc = doc;
      this.selectedBone = doc.bones?.[0]?.id || null;
      this.selectedSlot = null;
      this.selectedKey = null;
      this.currentClip = doc.defaultClip || doc.clips?.[0]?.name || null;
      this.previewTime = 0;
      this.playing = false;
      this.dirty = false;
      this._afterDocChange();
    this.el.skeletonId.value = doc.skeletonId || '';
    this.el.metaWidth.value = doc.meta?.width ?? 100;
    this.el.metaHeight.value = doc.meta?.height ?? 160;
    this.el.skeletonId.disabled = true; // 保存后 ID 固定（文件名即 ID）
    this._toast(`已加载 ${skeletonId}`);
    } catch (error) {
      this._toast(`骨骼资产读取失败：${error.message}`, true);
    }
  }

  _onAssetSelect() {
    const value = this.el.assetSelect.value;
    if (this.dirty && !confirm('当前骨骼未保存，切换将丢失修改，确定？')) {
      this._refreshAssetSelect();
      return;
    }
    if (value) this._loadDoc(value);
    else this._newDoc();
  }

  /** 文档任何变更后的统一入口：重建运行时 + 刷新面板。 */
  _afterDocChange() {
    this.el.save.disabled = !this.doc; // 有文档即可保存（修复初始 disabled 死锁）
    this.runtime = parseSkeletonAsset(structuredClone(this.doc));
    if (this.currentClip && !this.runtime?.clips.has(this.currentClip)) {
      this.currentClip = this.runtime?.defaultClip || null;
    }
    this.previewTime = Math.max(0, Math.min(this.previewTime, this._clipDuration()));
    if (!this._sliceMode) this._fitView(); // 切件模式保持源图视图
    this._renderBoneTree();
    this._renderSlotList();
    this._renderInspector();
    this._refreshClipToolbar();
    this._renderTimeline();
  }

  _markDirty() {
    this.dirty = true;
    this.el.dirty.style.display = '';
  }

  /* ---------------- 撤销 / 重做 ---------------- */

  /** 推入当前 doc 快照（在交互开始/破坏性操作前调用；redo 栈清空）。 */
  _pushHistory() {
    if (!this.doc) return;
    this._undoStack.push(JSON.stringify(this.doc));
    if (this._undoStack.length > 50) this._undoStack.shift();
    this._redoStack.length = 0;
  }

  _restoreHistory(json) {
    this.doc = JSON.parse(json);
    if (this.selectedBone && !this._boneById(this.selectedBone)) {
      this.selectedBone = this.doc.bones?.[0]?.id || null;
    }
    if (this.selectedSlot && !this._slotById(this.selectedSlot)) this.selectedSlot = null;
    this.selectedKey = null;
    this.dirty = true;
    this.el.dirty.style.display = '';
    this._afterDocChange();
  }

  _undo() {
    if (!this._undoStack.length) { this._toast('没有可撤销的操作'); return; }
    this._redoStack.push(JSON.stringify(this.doc));
    this._restoreHistory(this._undoStack.pop());
    this._toast('已撤销');
  }

  _redo() {
    if (!this._redoStack.length) { this._toast('没有可重做的操作'); return; }
    this._undoStack.push(JSON.stringify(this.doc));
    this._restoreHistory(this._redoStack.pop());
    this._toast('已重做');
  }

  _toast(message, isError = false) {
    this.el.toast.textContent = message;
    this.el.toast.style.color = isError ? '#ff7a7a' : '#ffd479';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.el.toast.textContent = ''; }, 4000);
  }

  /* ---------------- 骨骼操作 ---------------- */

  _boneById(id) {
    return this.doc.bones.find(bone => bone.id === id) || null;
  }

  /** 骨骼（或其祖先）是否被隐藏预览：隐藏骨骼级联隐藏子孙骨骼上的附件。 */
  _isBoneHidden(boneId) {
    let cursor = boneId || null;
    while (cursor) {
      if (this._hiddenBones.has(cursor)) return true;
      cursor = this._boneById(cursor)?.parent || null;
    }
    return false;
  }

  /** 骨骼（或其祖先）是否被锁定：画布点选/拖拽跳过。 */
  _isBoneLocked(boneId) {
    let cursor = boneId || null;
    while (cursor) {
      if (this._lockedBones.has(cursor)) return true;
      cursor = this._boneById(cursor)?.parent || null;
    }
    return false;
  }

  /** 槽位预览是否被隐藏（槽位级隐藏 或 所属骨骼链被隐藏）。 */
  _isSlotPreviewHidden(slotId, boneId) {
    return this._hiddenSlots.has(slotId) || this._isBoneHidden(boneId);
  }

  /** 槽位是否被锁定不可点选（槽位级锁定 或 所属骨骼链被锁定）。 */
  _isSlotInteractiveLocked(slotId, boneId) {
    return this._lockedSlots.has(slotId) || this._isBoneLocked(boneId);
  }

  _addBone() {
    this._pushHistory();
    const parent = this.selectedBone || this.doc.bones[0]?.id;
    if (!parent) { this._toast('请先选择父骨骼', true); return; }
    let index = 1;
    while (this._boneById(`bone_${index}`)) index += 1;
    const bone = { id: `bone_${index}`, parent, x: 0, y: -30, rot: 0, scaleX: 1, scaleY: 1, length: 24 };
    this.doc.bones.push(bone);
    this.selectedBone = bone.id;
    this._markDirty();
    this._afterDocChange();
  }

  _deleteBone() {
    const id = this.selectedBone;
    if (!id) return;
    this._pushHistory();
    if (id === this.doc.bones[0]?.id) { this._toast('根骨骼不可删除', true); return; }
    // 子骨骼提升为被删骨骼的父；引用清理
    const bone = this._boneById(id);
    for (const other of this.doc.bones) {
      if (other.parent === id) other.parent = bone.parent;
    }
    for (const slot of this.doc.slots) {
      if (slot.bone === id) slot.bone = bone.parent;
    }
    for (const clip of this.doc.clips) {
      clip.tracks = (clip.tracks || []).filter(track => track.bone !== id);
    }
    this.doc.bones = this.doc.bones.filter(candidate => candidate.id !== id);
    this.selectedBone = bone.parent;
    this._markDirty();
    this._afterDocChange();
  }

  _renameBone(oldId, newId) {
    if (!newId || oldId === newId || this._boneById(newId)) return;
    const bone = this._boneById(oldId);
    if (!bone) return;
    bone.id = newId;
    for (const other of this.doc.bones) {
      if (other.parent === oldId) other.parent = newId;
    }
    for (const slot of this.doc.slots) {
      if (slot.bone === oldId) slot.bone = newId;
    }
    for (const clip of this.doc.clips) {
      for (const track of clip.tracks || []) {
        if (track.bone === oldId) track.bone = newId;
      }
    }
    if (this.selectedBone === oldId) this.selectedBone = newId;
    this._markDirty();
    this._afterDocChange();
  }

  /* ---------------- 槽位操作 ---------------- */

  _slotById(id) {
    return this.doc.slots.find(slot => slot.id === id) || null;
  }

  _addSlot() {
    this._pushHistory();
    const bone = this.selectedBone || this.doc.bones[0]?.id;
    if (!bone) { this._toast('请先选择骨骼', true); return; }
    let index = 1;
    while (this._slotById(`slot_${index}`)) index += 1;
    const slot = { id: `slot_${index}`, bone, z: this.doc.slots.length, attachment: { type: 'empty', x: 0, y: 0, rot: 0 } };
    this.doc.slots.push(slot);
    this.selectedSlot = slot.id;
    this.selectedBone = bone;
    this._markDirty();
    this._afterDocChange();
  }

  _deleteSlot() {
    if (!this.selectedSlot) return;
    this._pushHistory();
    const removed = this._slotById(this.selectedSlot);
    this.doc.slots = this.doc.slots.filter(slot => slot.id !== this.selectedSlot);
    this.selectedSlot = null;
    this._markDirty();
    this._afterDocChange();
    if (removed) this._toast(`已删除槽位 ${removed.id}（不保存即可恢复）`);
  }

  /* ---------------- 剪辑 / 轨道 / 关键帧 ---------------- */

  _clip() {
    return this.doc.clips?.find(clip => clip.name === this.currentClip) || null;
  }

  _clipDuration() {
    return this._clip()?.durationMs || 1000;
  }

  _selectClip(name) {
    this.currentClip = name;
    this.previewTime = 0;
    this.selectedKey = null;
    this._refreshClipToolbar();
    this._renderTimeline();
  }

  _addClip() {
    this._pushHistory();
    const name = prompt('剪辑名称（如 idle/walk/attack）：');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (this.doc.clips.some(clip => clip.name === trimmed)) { this._toast('剪辑名已存在', true); return; }
    this.doc.clips.push({ name: trimmed, durationMs: 1000, loop: true, tracks: [] });
    this.currentClip = trimmed;
    this.previewTime = 0;
    this._markDirty();
    this._afterDocChange();
  }

  _deleteClip() {
    if (!this.currentClip) return;
    this._pushHistory();
    if (this.doc.clips.length <= 1) { this._toast('至少保留一个剪辑', true); return; }
    this.doc.clips = this.doc.clips.filter(clip => clip.name !== this.currentClip);
    this.currentClip = this.doc.clips[0].name;
    this._markDirty();
    this._afterDocChange();
  }

  _setClipDuration() {
    this._pushHistory();
    const clip = this._clip();
    if (!clip) return;
    clip.durationMs = Math.max(50, Number(this.el.clipDuration.value) || 1000);
    for (const track of clip.tracks || []) {
      for (const key of track.keys || []) key.t = Math.min(key.t, clip.durationMs);
    }
    this.previewTime = Math.min(this.previewTime, clip.durationMs);
    this._markDirty();
    this._afterDocChange();
  }

  _setClipLoop() {
    const clip = this._clip();
    if (!clip) return;
    clip.loop = this.el.clipLoop.checked;
    this._markDirty();
  }

  _refreshClipToolbar() {
    const select = this.el.clipSelect;
    select.innerHTML = (this.doc.clips || []).map(clip => `<option value="${clip.name}">${clip.name}</option>`).join('');
    if (this.currentClip) select.value = this.currentClip;
    const clip = this._clip();
    this.el.clipDuration.value = clip?.durationMs ?? 1000;
    this.el.clipLoop.checked = clip?.loop !== false;
    // 轨道骨骼下拉：所有骨骼
    this.el.trackBoneSelect.innerHTML = (this.doc.bones || [])
      .map(bone => `<option value="${bone.id}">${bone.id}</option>`).join('');
  }

  _addTrack() {
    this._pushHistory();
    const clip = this._clip();
    const boneId = this.el.trackBoneSelect.value;
    if (!clip || !boneId) return;
    if ((clip.tracks || []).some(track => track.bone === boneId)) { this._toast('该骨骼已有轨道', true); return; }
    clip.tracks = clip.tracks || [];
    const rest = this._boneById(boneId) || {};
    clip.tracks.push({
      bone: boneId,
      keys: [{ t: 0, x: rest.x ?? 0, y: rest.y ?? 0, rot: rest.rot ?? 0, scaleX: null, scaleY: null, ease: 'linear' }]
    });
    this._markDirty();
    this._afterDocChange();
  }

  _removeTrack() {
    this._pushHistory();
    const clip = this._clip();
    const boneId = this.selectedKey?.bone || this.el.trackBoneSelect.value;
    if (!clip || !boneId) return;
    clip.tracks = (clip.tracks || []).filter(track => track.bone !== boneId);
    if (this.selectedKey?.bone === boneId) this.selectedKey = null;
    this._markDirty();
    this._afterDocChange();
  }

  /** 在当前时间 upsert 选中骨骼的关键帧（记录当前采样姿态）。 */
  _keySelectedBone() {
    this._pushHistory();
    const clip = this._clip();
    const boneId = this.selectedBone;
    if (!clip || !boneId) { this._toast('请先选择骨骼', true); return; }
    let track = (clip.tracks || []).find(candidate => candidate.bone === boneId);
    if (!track) {
      clip.tracks = clip.tracks || [];
      track = { bone: boneId, keys: [] };
      clip.tracks.push(track);
    }
    const rest = this._boneById(boneId) || {};
    const sampled = this._sampledBoneLocal(boneId);
    const key = {
      t: Math.round(this.previewTime),
      x: sampled?.x ?? rest.x ?? 0,
      y: sampled?.y ?? rest.y ?? 0,
      rot: sampled?.rot ?? rest.rot ?? 0,
      scaleX: null, scaleY: null,
      ease: 'linear'
    };
    this._upsertKey(track, key);
    this._markDirty();
    this._afterDocChange();
  }

  _upsertKey(track, key) {
    const existing = track.keys.find(candidate => Math.abs(candidate.t - key.t) <= 5);
    if (existing) {
      Object.assign(existing, Object.fromEntries(Object.entries(key).filter(([, value]) => value !== null)));
    } else {
      track.keys.push(key);
      track.keys.sort((a, b) => a.t - b.t);
    }
  }

  _deleteSelectedKey() {
    if (!this.selectedKey) return;
    this._pushHistory();
    const clip = this._clip();
    const track = clip?.tracks?.find(candidate => candidate.bone === this.selectedKey.bone);
    if (!track) return;
    track.keys = track.keys.filter((key, index) => index !== this.selectedKey.index);
    this.selectedKey = null;
    this._markDirty();
    this._afterDocChange();
  }

  /* ---------------- 预览采样 ---------------- */

  _currentClipRuntime() {
    return this.runtime?.clips.get(this.currentClip) || null;
  }

  _sampledBoneLocal(boneId) {
    if (!this.runtime) return null;
    const { local } = evaluateSkeletonPose(this.runtime, this._currentClipRuntime(), this.previewTime);
    return local.get(boneId) || null;
  }

  _boneWorldTransforms() {
    if (!this.runtime) return new Map();
    return evaluateSkeletonPose(this.runtime, this._currentClipRuntime(), this.previewTime).world;
  }

  _togglePlay() {
    this.playing = !this.playing;
    const clip = this._clip();
    if (this.playing && clip && this.previewTime >= clip.durationMs) this.previewTime = 0;
    const button = document.getElementById('se-play');
    if (button) button.textContent = this.playing ? '⏸ 暂停' : '▶ 播放';
  }

  /* ---------------- 画布 ---------------- */

  _fitView() {
    const canvas = this.el.canvas;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const meta = this.doc?.meta || { width: 100, height: 160 };
    const scale = Math.min((rect.width - 80) / meta.width, (rect.height - 80) / meta.height, 4);
    this.view.scale = Math.max(0.1, scale);
    this.view.ox = rect.width / 2;
    this.view.oy = (rect.height + meta.height * this.view.scale) / 2;
    this._sizeCanvas();
  }

  _sizeCanvas() {
    const canvas = this.el.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
  }

  _worldToScreen(x, y) {
    return { x: this.view.ox + x * this.view.scale, y: this.view.oy + y * this.view.scale };
  }

  _screenToWorld(x, y) {
    return { x: (x - this.view.ox) / this.view.scale, y: (y - this.view.oy) / this.view.scale };
  }

  _imageElement(assetId) {
    const item = this.imageCatalog.get(assetId);
    if (!item) return null;
    if (item.element) return item.element.complete && item.element.naturalWidth > 0 ? item.element : null;
    const element = new Image();
    element.src = item.url;
    element.onload = () => { this.imageCatalog.get(assetId).width = element.naturalWidth; this.imageCatalog.get(assetId).height = element.naturalHeight; };
    item.element = element;
    return null;
  }

  _draw() {
    const ctx = this.el.canvas.getContext('2d');
    this._sizeCanvas();
    ctx.save();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    const rect = this.el.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    // 切件模式：源图视图（不画骨骼/附件）
    if (this._sliceMode) {
      this._drawSliceMode(ctx, { x: 0, y: 0 });
      ctx.restore();
      return;
    }

    const meta = this.doc?.meta || { width: 100, height: 160 };
    const topLeft = this._worldToScreen(-meta.width / 2, -meta.height);
    // 设计盒
    ctx.strokeStyle = 'rgba(90,106,144,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(topLeft.x, topLeft.y, meta.width * this.view.scale, meta.height * this.view.scale);
    // 地面线 + 原点
    const origin = this._worldToScreen(0, 0);
    ctx.strokeStyle = 'rgba(76,175,80,0.7)';
    ctx.beginPath();
    ctx.moveTo(topLeft.x, origin.y);
    ctx.lineTo(topLeft.x + meta.width * this.view.scale, origin.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,90,90,0.9)';
    ctx.beginPath();
    ctx.moveTo(origin.x - 6, origin.y);
    ctx.lineTo(origin.x + 6, origin.y);
    ctx.moveTo(origin.x, origin.y - 6);
    ctx.lineTo(origin.x, origin.y + 6);
    ctx.stroke();

    if (!this.runtime) { ctx.restore(); return; }
    const world = this._boneWorldTransforms();

    // 槽位附件预览（z 顺序；隐藏/锁定的槽位不画；attachment.visible=false 不画——对齐运行时三方向切换语义）
    for (const slot of this.runtime.slots) {
      const attachment = slot.attachment;
      if (!attachment || attachment.type === 'empty') continue;
      if (attachment.visible === false) continue;
      if (this._isSlotPreviewHidden(slot.id, slot.bone)) continue;
      const boneWorld = world.get(slot.bone);
      if (!boneWorld) continue;
      const source = this._attachmentSource(attachment);
      if (!source) continue;
      const anchor = this._worldToScreen(
        boneWorld.x + attachment.x * boneWorld.sx,
        boneWorld.y + attachment.y * boneWorld.sy
      );
      const drawW = (attachment.width > 0 ? attachment.width : source.sw) * boneWorld.sx * this.view.scale;
      const drawH = (attachment.height > 0 ? attachment.height : source.sh) * boneWorld.sy * this.view.scale;
      ctx.save();
      ctx.translate(anchor.x, anchor.y);
      ctx.rotate(boneWorld.rad + (attachment.rot || 0) * DEG2RAD);
      if (source.element) {
        ctx.drawImage(source.element, source.sx, source.sy, source.sw, source.sh,
          -drawW / 2, -drawH / 2, drawW, drawH);
      } else {
        ctx.fillStyle = 'rgba(126,200,255,0.25)';
        ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
      }
      ctx.restore();
    }

    // 骨骼骨形（Spine/火柴人式）：骨条画向子骨骼原点（叶子骨骼沿身体方向），首尾相接
    for (const bone of this.doc.bones || []) {
      const boneWorld = world.get(bone.id);
      if (!boneWorld) continue;
      const tip = this._boneTip(bone, world);
      if (!tip) continue;
      const start = this._worldToScreen(boneWorld.x, boneWorld.y);
      const end = this._worldToScreen(tip.x, tip.y);
      const selected = bone.id === this.selectedBone;
      const locked = this._isBoneLocked(bone.id);
      const hidden = this._isBoneHidden(bone.id);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lenPx = Math.hypot(dx, dy);
      if (lenPx > 2) {
        const ux = dx / lenPx;
        const uy = dy / lenPx;
        const nx = -uy;
        const ny = ux;
        const w0 = selected ? 4.5 : 3.5;
        const w1 = 0.6;
        ctx.beginPath();
        ctx.moveTo(start.x + nx * w0, start.y + ny * w0);
        ctx.lineTo(end.x + nx * w1, end.y + ny * w1);
        ctx.lineTo(end.x - nx * w1, end.y - ny * w1);
        ctx.lineTo(start.x - nx * w0, start.y - ny * w0);
        ctx.closePath();
        ctx.fillStyle = selected
          ? 'rgba(255,96,60,0.95)'
          : (hidden ? 'rgba(160,170,200,0.3)' : (locked ? 'rgba(200,160,255,0.75)' : 'rgba(214,224,248,0.9)'));
        ctx.fill();
      }
      // 起点关节环
      ctx.strokeStyle = selected ? '#ff603c' : (locked ? 'rgba(200,160,255,0.9)' : 'rgba(226,234,252,0.95)');
      ctx.lineWidth = selected ? 2.5 : 1.8;
      ctx.beginPath();
      ctx.arc(start.x, start.y, selected ? 6 : 5, 0, Math.PI * 2);
      ctx.stroke();
      // 末端小点
      ctx.fillStyle = selected ? '#ff603c' : 'rgba(226,234,252,0.85)';
      ctx.beginPath();
      ctx.arc(end.x, end.y, selected ? 3 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 选中的槽位附件高亮：描边盒 + 骨骼原点→附件中心偏移连线（Spine 式挂点可视化）
    if (this.selectedSlot) {
      const runtimeSlot = this.runtime?.slots.find(candidate => candidate.id === this.selectedSlot);
      const attachment = runtimeSlot?.attachment;
      const boneWorld = runtimeSlot ? world.get(runtimeSlot.bone) : null;
      if (attachment && attachment.type !== 'empty' && boneWorld
        && !this._isSlotPreviewHidden(runtimeSlot.id, runtimeSlot.bone)) {
        const source = this._attachmentSource(attachment);
        if (source) {
          const anchor = this._worldToScreen(
            boneWorld.x + attachment.x * boneWorld.sx,
            boneWorld.y + attachment.y * boneWorld.sy
          );
          const drawW = (attachment.width > 0 ? attachment.width : source.sw) * boneWorld.sx * this.view.scale;
          const drawH = (attachment.height > 0 ? attachment.height : source.sh) * boneWorld.sy * this.view.scale;
          const angle = boneWorld.rad + (attachment.rot || 0) * DEG2RAD;
          ctx.save();
          ctx.translate(anchor.x, anchor.y);
          ctx.rotate(angle);
          ctx.strokeStyle = '#ffd479';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(-drawW / 2 - 2, -drawH / 2 - 2, drawW + 4, drawH + 4);
          ctx.restore();
          // 偏移连线：骨骼原点 → 附件中心（未偏移时不画，避免与骨骼点重叠干扰）
          const boneAnchor = this._worldToScreen(boneWorld.x, boneWorld.y);
          if (Math.abs(attachment.x) + Math.abs(attachment.y) > 0.5) {
            ctx.strokeStyle = 'rgba(255,212,121,0.75)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(boneAnchor.x, boneAnchor.y);
            ctx.lineTo(anchor.x, anchor.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#ffd479';
            ctx.beginPath();
            ctx.arc(anchor.x, anchor.y, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    // 拖放换绑目标高亮：附件拖拽悬停在骨骼原点附近时提示「松手换绑」
    if (this._drag?.kind === 'attach-move' && this._drag.rebindTarget) {
      const targetWorld = world.get(this._drag.rebindTarget);
      if (targetWorld) {
        const anchor = this._worldToScreen(targetWorld.x, targetWorld.y);
        ctx.strokeStyle = '#ffd479';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffd479';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`松手换绑 → ${this._drag.rebindTarget}`, anchor.x + 18, anchor.y - 10);
      }
    }

    // 选中骨骼旋转手柄环
    if (this.selectedBone) {
      const boneWorld = world.get(this.selectedBone);
      if (boneWorld) {
        const anchor = this._worldToScreen(boneWorld.x, boneWorld.y);
        ctx.strokeStyle = this.selectedSlot ? 'rgba(126,200,255,0.9)' : 'rgba(255,212,121,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, 24, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _attachmentSource(attachment) {
    const assetId = attachment.assetId || attachment.spriteSheet;
    if (!assetId || !this.imageCatalog.has(assetId)) return null;
    const element = this._imageElement(assetId);
    const item = this.imageCatalog.get(assetId);
    if (attachment.type === 'image') {
      const sw = element ? element.naturalWidth : (item.width || 64);
      const sh = element ? element.naturalHeight : (item.height || 64);
      return { element, sx: 0, sy: 0, sw, sh };
    }
    if (attachment.type === 'slice') {
      return { element, sx: attachment.sx, sy: attachment.sy, sw: attachment.sw, sh: attachment.sh };
    }
    if (attachment.type === 'sequence') {
      let frames = attachment.frames || [];
      if (frames.length === 0) {
        // 运行时由状态映射器按方向行计算帧表：编辑器用 Manifest 网格兜底显示
        frames = this._fallbackSequenceFrames(assetId, item);
        if (frames.length === 0) return null;
      }
      const slotFrame = this._sequenceFrameIndex(attachment);
      const rect = frames[slotFrame % frames.length];
      return { element, sx: rect.sx, sy: rect.sy, sw: rect.sw, sh: rect.sh };
    }
    return null;
  }

  /** sequence 帧表为空时的显示兜底：Manifest grid 首格 → 整图。 */
  _fallbackSequenceFrames(assetId, item) {
    const grid = item?.entry?.grid;
    const element = this._imageElement(assetId);
    const naturalWidth = element?.naturalWidth || item?.width || 0;
    const naturalHeight = element?.naturalHeight || item?.height || 0;
    if (!naturalWidth || !naturalHeight) return [];
    if (grid?.columns > 0 && grid?.rows > 0) {
      const cellWidth = naturalWidth / grid.columns;
      const cellHeight = naturalHeight / grid.rows;
      return [{ sx: 0, sy: 0, sw: cellWidth, sh: cellHeight }];
    }
    return [{ sx: 0, sy: 0, sw: naturalWidth, sh: naturalHeight }];
  }

  // 序列帧预览帧游标：预览播放时按 fps 推进（编辑器内独立于运行时状态）
  _sequenceFrameIndex(attachment) {
    if (!this.playing) return 0;
    const frameDuration = 1000 / (attachment.fps > 0 ? attachment.fps : 8);
    return Math.floor(this._previewClock / frameDuration);
  }

  /* ---------------- 画布交互 ---------------- */

  _onCanvasDown(event) {
    const rect = this.el.canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    if (event.button === 1 || event.button === 2) {
      this._drag = { kind: 'pan', startX: mx, startY: my, ox: this.view.ox, oy: this.view.oy };
      return;
    }
    // 切件模式：左键拖框选区
    if (this._sliceMode) {
      if (event.button !== 0) return;
      this._exitSlicePanel();
      const world = this._screenToWorld(mx, my);
      this._sliceSelecting = { startX: world.x, startY: world.y };
      this._sliceMode.rect = { x: world.x, y: world.y, w: 0, h: 0 };
      return;
    }
    if (!this.runtime) return;
    const world = this._boneWorldTransforms();
    // 旋转环优先判定（仅对当前选中骨骼/槽位：环带 16~38px，避免与原点命中半径重叠）
    // 选中槽位时环旋转附件 rot，选中骨骼时旋转骨骼 rot
    if (this.selectedBone) {
      const bone = this._boneById(this.selectedBone);
      const boneWorld = world.get(this.selectedBone);
      if (bone && boneWorld) {
        const anchor = this._worldToScreen(boneWorld.x, boneWorld.y);
        const distance = Math.hypot(mx - anchor.x, my - anchor.y);
        if (distance > 12 && distance < 38) {
          if (this.selectedSlot) {
            const slot = this._slotById(this.selectedSlot);
            if (slot?.attachment && slot.attachment.type !== 'empty') {
              this._pushHistory();
          this._drag = {
                kind: 'attach-rotate',
                slotId: slot.id,
                boneId: bone.id,
                startRot: slot.attachment.rot || 0,
                startWorldRot: Math.atan2(my - anchor.y, mx - anchor.x)
              };
              return;
            }
          }
          this._drag = {
            kind: 'rotate',
            boneId: bone.id,
            startX: mx, startY: my,
            startLocal: { ...(this._sampledBoneLocal(bone.id) || bone) },
            startWorldRot: Math.atan2(my - anchor.y, mx - anchor.x),
            parent: this._parentWorldTransform(world, bone)
          };
          return;
        }
      }
    }
    // 命中槽位附件（Spine 式：点图片即选中其槽位；Alt+点击跳过附件强制选骨骼）
    if (!event.altKey) {
      const hitSlotId = this._hitAttachment(mx, my, world);
      if (hitSlotId) {
        const slot = this._slotById(hitSlotId);
        this.selectedSlot = hitSlotId;
        this.selectedBone = slot?.bone || this.selectedBone;
        this._selectedImageId = slot?.attachment?.assetId || this._selectedImageId;
        this._renderBoneTree();
        this._renderSlotList();
        this._renderInspector();
        this._renderImageLib();
        // 选中即开始拖拽：直接调整附件偏移（所见即所得）
        this._pushHistory();
        this._drag = {
          kind: 'attach-move',
          slotId: hitSlotId,
          startX: mx, startY: my,
          startOffset: { x: slot?.attachment?.x ?? 0, y: slot?.attachment?.y ?? 0 },
          boneWorld: world.get(slot?.bone) || null
        };
        return;
      }
    }
    // 命中骨骼骨身/关节（Spine 式拾取；锁定的骨骼跳过——防误选误拖）
    const hit = this._pickBone(mx, my, world);
    if (hit) {
      this._pushHistory();
      this.selectedBone = hit.id;
      this.selectedSlot = null;
      this._renderBoneTree();
      this._renderSlotList();
      this._renderInspector();
      const boneWorld = world.get(hit.id);
      const anchor = this._worldToScreen(boneWorld.x, boneWorld.y);
      this._drag = {
        kind: 'move', // 旋转由上方环带判定处理，骨身/原点命中一律为移动
        boneId: hit.id,
        startX: mx, startY: my,
        startLocal: { ...(this._sampledBoneLocal(hit.id) || hit) },
        startWorldRot: Math.atan2(my - anchor.y, mx - anchor.x),
        parent: this._parentWorldTransform(world, hit)
      };
      return;
    }
    // 空白：点选槽位附件（用于检查器定位）
    this._drag = null;
  }

  /** 附件命中测试：从最上层槽位向下找鼠标点所在的附件内容盒（与 _draw 同变换）。
   *  命中盒按图片非透明像素包围盒（alpha 扫描缓存），避免透明区域遮挡下层图片的点选。
   *  返回 doc 槽位 ID。 */
  _hitAttachment(mx, my, world) {
    const slots = [...(this.runtime?.slots || [])].reverse();
    for (const runtimeSlot of slots) {
      const attachment = runtimeSlot.attachment;
      if (!attachment || attachment.type === 'empty') continue;
      // 隐藏/锁定的槽位（或其骨骼链）不参与命中
      if (this._isSlotPreviewHidden(runtimeSlot.id, runtimeSlot.bone)) continue;
      if (this._isSlotInteractiveLocked(runtimeSlot.id, runtimeSlot.bone)) continue;
      const boneWorld = world.get(runtimeSlot.bone);
      if (!boneWorld) continue;
      const source = this._attachmentSource(attachment);
      if (!source) continue;
      const drawW = (attachment.width > 0 ? attachment.width : source.sw) * boneWorld.sx * this.view.scale;
      const drawH = (attachment.height > 0 ? attachment.height : source.sh) * boneWorld.sy * this.view.scale;
      if (drawW < 2 || drawH < 2) continue;
      const anchor = this._worldToScreen(
        boneWorld.x + attachment.x * boneWorld.sx,
        boneWorld.y + attachment.y * boneWorld.sy
      );
      const angle = boneWorld.rad + (attachment.rot || 0) * DEG2RAD;
      const dx = mx - anchor.x;
      const dy = my - anchor.y;
      const cos = Math.cos(-angle);
      const sin = Math.sin(-angle);
      const localX = dx * cos - dy * sin;
      const localY = dx * sin + dy * cos;
      // 命中盒：附件盒（整图/帧）内非透明像素包围盒（局部单位=源像素）
      const box = this._attachmentHitBox(attachment, source);
      const unitX = boneWorld.sx * this.view.scale;
      const unitY = boneWorld.sy * this.view.scale;
      if (Math.abs(localX / unitX - box.ox) <= box.hw && Math.abs(localY / unitY - box.oy) <= box.hh) {
        return runtimeSlot.id;
      }
    }
    return null;
  }

  /** 附件内容命中盒（相对附件中心的偏移与半宽/高，单位=源像素）。 */
  _attachmentHitBox(attachment, source) {
    const bounds = this._alphaBounds(attachment, source);
    if (!bounds) return { ox: 0, oy: 0, hw: source.sw / 2, hh: source.sh / 2 };
    return {
      ox: (bounds.x0 + bounds.x1) / 2 - source.sx - source.sw / 2,
      oy: (bounds.y0 + bounds.y1) / 2 - source.sy - source.sh / 2,
      hw: Math.max(1, (bounds.x1 - bounds.x0) / 2),
      hh: Math.max(1, (bounds.y1 - bounds.y0) / 2)
    };
  }

  /** 扫描附件帧区域的非透明像素包围盒（按附件+源矩形缓存；图片未加载返回 null）。 */
  _alphaBounds(attachment, source) {
    const assetId = attachment.assetId || attachment.spriteSheet || '';
    const key = `${assetId}|${source.sx}|${source.sy}|${source.sw}|${source.sh}`;
    if (this._alphaBoundsCache.has(key)) return this._alphaBoundsCache.get(key);
    const element = source.element;
    let bounds = null;
    if (element && source.sw > 0 && source.sh > 0) {
      try {
        const sampler = this._alphaSampleCanvas || (this._alphaSampleCanvas = document.createElement('canvas'));
        sampler.width = source.sw;
        sampler.height = source.sh;
        const sctx = sampler.getContext('2d', { willReadFrequently: true });
        sctx.clearRect(0, 0, source.sw, source.sh);
        sctx.drawImage(element, source.sx, source.sy, source.sw, source.sh, 0, 0, source.sw, source.sh);
        const data = sctx.getImageData(0, 0, source.sw, source.sh).data;
        let x0 = source.sw, y0 = source.sh, x1 = -1, y1 = -1;
        for (let y = 0; y < source.sh; y += 1) {
          for (let x = 0; x < source.sw; x += 1) {
            if (data[(y * source.sw + x) * 4 + 3] > 8) {
              if (x < x0) x0 = x;
              if (y < y0) y0 = y;
              if (x > x1) x1 = x;
              if (y > y1) y1 = y;
            }
          }
        }
        if (x1 >= 0) bounds = { x0, y0, x1: x1 + 1, y1: y1 + 1 };
      } catch {
        bounds = null; // 跨域污染等异常：兜底整盒
      }
    }
    this._alphaBoundsCache.set(key, bounds);
    return bounds;
  }

  /** 骨形端点（火柴人视觉，纯绘制层——不改动画数据）：
   *  有子骨骼 → 画向第一个子骨骼原点（骨条首尾相接）；
   *  叶子骨骼 → rest 末端绕原点 +90°（腿/臂/头等沿身体方向延伸）。 */
  _boneTip(bone, world) {
    const boneWorld = world.get(bone.id);
    if (!boneWorld) return null;
    const child = this.doc.bones.find(candidate => candidate.parent === bone.id);
    if (child) {
      const childWorld = world.get(child.id);
      if (childWorld) return { x: childWorld.x, y: childWorld.y };
    }
    const rad = boneWorld.rad + Math.PI / 2;
    return {
      x: boneWorld.x + Math.cos(rad) * (bone.length || 0) * boneWorld.sx,
      y: boneWorld.y + Math.sin(rad) * (bone.length || 0) * boneWorld.sy
    };
  }

  /** 骨骼拾取（Spine 式）：骨身（点到骨条线段距离）或起点关节环均可命中，优先近者。
   *  骨形端点与 _draw 一致（_boneTip 火柴人骨链）。 */
  _pickBone(mx, my, world) {
    let hit = null;
    let best = 8; // 屏幕像素阈值
    for (const bone of this.doc.bones || []) {
      if (this._isBoneLocked(bone.id)) continue;
      const boneWorld = world.get(bone.id);
      if (!boneWorld) continue;
      const tip = this._boneTip(bone, world);
      if (!tip) continue;
      const start = this._worldToScreen(boneWorld.x, boneWorld.y);
      const end = this._worldToScreen(tip.x, tip.y);
      const distOrigin = Math.hypot(mx - start.x, my - start.y);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq > 0 ? ((mx - start.x) * dx + (my - start.y) * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const distBody = Math.hypot(mx - (start.x + dx * t), my - (start.y + dy * t));
      const score = Math.min(distOrigin, Math.max(distBody - 2, 0)); // 关节环略优先
      if (score < best) { hit = bone; best = score; }
    }
    return hit;
  }

  _parentWorldTransform(world, bone) {
    if (!bone.parent) return { x: 0, y: 0, rad: 0, sx: 1, sy: 1, rot: 0 };
    return world.get(bone.parent) || { x: 0, y: 0, rad: 0, sx: 1, sy: 1, rot: 0 };
  }

  _onCanvasMove(event) {
    // 切件模式：更新选区矩形
    if (this._sliceMode && this._sliceSelecting) {
      const rect = this.el.canvas.getBoundingClientRect();
      const world = this._screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const startX = this._sliceSelecting.startX;
      const startY = this._sliceSelecting.startY;
      this._sliceMode.rect = {
        x: Math.min(startX, world.x),
        y: Math.min(startY, world.y),
        w: Math.abs(world.x - startX),
        h: Math.abs(world.y - startY)
      };
      return;
    }
    if (!this._drag) return;
    const rect = this.el.canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    if (this._drag.kind === 'pan') {
      this.view.ox = this._drag.ox + (mx - this._drag.startX);
      this.view.oy = this._drag.oy + (my - this._drag.startY);
      return;
    }
    // 附件拖拽：移动 = 世界位移→骨骼局部空间写入 attachment.x/y；旋转 = 角度差写入 attachment.rot
    if (this._drag.kind === 'attach-move' || this._drag.kind === 'attach-rotate') {
      const slot = this._slotById(this._drag.slotId);
      if (!slot?.attachment) { this._drag = null; return; }
      if (this._isSlotInteractiveLocked(slot.id, slot.bone)) { this._drag = null; return; }
      if (this._drag.kind === 'attach-move') {
        const boneWorld = this._drag.boneWorld;
        const worldDx = (mx - this._drag.startX) / this.view.scale;
        const worldDy = (my - this._drag.startY) / this.view.scale;
        // 拖放换绑探测：鼠标靠近其他骨骼原点（16px）时记录目标，松手重挂（保持世界位置）
        this._drag.rebindTarget = this._pickBoneOrigin(mx, my, this._boneWorldTransforms(), 16, slot.bone);
        if (this._drag.rebindTarget) return; // 悬停目标骨骼上时冻结偏移预览，松手换绑
        let localDx = worldDx;
        let localDy = worldDy;
        if (boneWorld) {
          const cos = Math.cos(-boneWorld.rad);
          const sin = Math.sin(-boneWorld.rad);
          localDx = (worldDx * cos - worldDy * sin) / (boneWorld.sx || 1);
          localDy = (worldDx * sin + worldDy * cos) / (boneWorld.sy || 1);
        }
        slot.attachment.x = Math.round((this._drag.startOffset.x + localDx) * 10) / 10;
        slot.attachment.y = Math.round((this._drag.startOffset.y + localDy) * 10) / 10;
      } else {
        const boneWorld = this._boneWorldTransforms().get(this._drag.boneId);
        if (!boneWorld) { this._drag = null; return; }
        const anchor = this._worldToScreen(boneWorld.x, boneWorld.y);
        const deltaDeg = (Math.atan2(my - anchor.y, mx - anchor.x) - this._drag.startWorldRot) / DEG2RAD;
        slot.attachment.rot = Math.round((this._drag.startRot + deltaDeg) * 10) / 10;
      }
      this._markDirty();
      this.runtime = parseSkeletonAsset(structuredClone(this.doc));
      this._renderInspector();
      return;
    }
    const bone = this._boneById(this._drag.boneId);
    if (!bone) return;
    if (this._isBoneLocked(bone.id)) { this._drag = null; return; }
    const clip = this._clip();
    const track = clip?.tracks?.find(candidate => candidate.bone === bone.id) || null;
    const parent = this._drag.parent;

    if (this._drag.kind === 'move') {
      // 屏幕位移 → 世界位移 → 父空间局部位移
      const worldDx = (mx - this._drag.startX) / this.view.scale;
      const worldDy = (my - this._drag.startY) / this.view.scale;
      const cos = Math.cos(-parent.rad);
      const sin = Math.sin(-parent.rad);
      const localDx = (worldDx * cos - worldDy * sin) / (parent.sx || 1);
      const localDy = (worldDx * sin + worldDy * cos) / (parent.sy || 1);
      const nextX = this._drag.startLocal.x + localDx;
      const nextY = this._drag.startLocal.y + localDy;
      if (track) {
        this._upsertKey(track, { t: Math.round(this.previewTime), x: nextX, y: nextY });
        this._markDirty();
      } else {
        // 所见即所得：拖动无轨道骨骼 = 自动建轨道并在当前时间打关键帧（摆姿势即录入）
        this._ensureTrackAndKey(bone.id, clip, { x: nextX, y: nextY });
      }
    } else if (this._drag.kind === 'rotate') {
      const boneWorld = this._boneWorldTransforms().get(bone.id);
      const anchor = this._worldToScreen(boneWorld.x, boneWorld.y);
      const angle = Math.atan2(my - anchor.y, mx - anchor.x);
      const deltaDeg = (angle - this._drag.startWorldRot) / DEG2RAD;
      const nextRot = Math.round((this._drag.startLocal.rot + deltaDeg) * 10) / 10;
      if (track) {
        this._upsertKey(track, { t: Math.round(this.previewTime), rot: nextRot });
        this._markDirty();
      } else {
        // 所见即所得：旋转无轨道骨骼 = 自动建轨道并打关键帧
        this._ensureTrackAndKey(bone.id, clip, { rot: nextRot });
      }
    }
    this._renderInspector();
    this._renderTimeline();
  }

  /** 为当前剪辑确保骨骼轨道存在并打关键帧（拖拽摆姿势路径）。 */
  _ensureTrackAndKey(boneId, clip, partial) {
    if (!clip) return;
    clip.tracks = clip.tracks || [];
    let track = clip.tracks.find(candidate => candidate.bone === boneId);
    if (!track) {
      const rest = this._boneById(boneId) || {};
      track = { bone: boneId, keys: [{ t: 0, x: rest.x ?? 0, y: rest.y ?? 0, rot: rest.rot ?? 0 }] };
      clip.tracks.push(track);
    }
    this._upsertKey(track, { t: Math.round(this.previewTime), ...partial });
    this._markDirty();
    this.runtime = parseSkeletonAsset(structuredClone(this.doc));
  }

  _onCanvasWheel(event) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.9;
    const rect = this.el.canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const before = this._screenToWorld(mx, my);
    this.view.scale = Math.max(0.05, Math.min(12, this.view.scale * factor));
    const after = this._screenToWorld(mx, my);
    this.view.ox += (after.x - before.x) * this.view.scale;
    this.view.oy += (after.y - before.y) * this.view.scale;
  }

  /* ---------------- 面板渲染 ---------------- */

  _renderBoneTree() {
    const container = this.el.boneTree;
    const depthOf = new Map();
    const bones = this.doc.bones || [];
    const parentOf = new Map(bones.map(bone => [bone.id, bone.parent]));
    const depth = id => {
      if (!depthOf.has(id)) {
        const parent = parentOf.get(id);
        depthOf.set(id, parent ? depth(parent) + 1 : 0);
      }
      return depthOf.get(id);
    };
    container.innerHTML = bones.map(bone => {
      const hidden = this._hiddenBones.has(bone.id);
      const locked = this._lockedBones.has(bone.id);
      return `
      <div class="se-bone-item ${bone.id === this.selectedBone ? 'selected' : ''}" data-id="${bone.id}">
        <button class="se-tgl" data-kind="vis" title="${hidden ? '仅在编辑器中显示（级联子骨骼）' : '仅在编辑器中隐藏（级联子骨骼）'}"
          style="flex:none;width:20px;height:18px;padding:0;font-size:10px;line-height:1;border-radius:3px;border:1px solid;cursor:pointer;${hidden ? 'background:#3a3a3a;border-color:#666;opacity:.75;' : 'background:#254830;border-color:#4a8a4a;'}">${hidden ? '🚫' : '👁'}</button>
        <button class="se-tgl" data-kind="lock" title="${locked ? '已锁定：画布不可点选/拖拽，点击解锁' : '未锁定：点击锁定防误触（级联子骨骼）'}"
          style="flex:none;width:20px;height:18px;padding:0;font-size:10px;line-height:1;border-radius:3px;border:1px solid;cursor:pointer;${locked ? 'background:#5a2a2a;border-color:#c0504a;' : 'background:#26365f;border-color:#5574ad;'}">${locked ? '🔒' : '🔓'}</button>
        <span class="depth">${'· '.repeat(depth(bone.id))}</span>
        <span class="name">${bone.id}${bone.parent ? ` ⇐ ${bone.parent}` : ' (根)'}</span>
      </div>`;
    }).join('');
    for (const item of container.querySelectorAll('.se-bone-item')) {
      item.addEventListener('click', event => {
        const button = event.target.closest('.se-tgl');
        if (button) {
          const boneId = item.dataset.id;
          if (button.dataset.kind === 'vis') {
            if (this._hiddenBones.has(boneId)) this._hiddenBones.delete(boneId);
            else this._hiddenBones.add(boneId);
          } else if (this._lockedBones.has(boneId)) this._lockedBones.delete(boneId);
          else this._lockedBones.add(boneId);
          this._renderBoneTree();
          return;
        }
        this.selectedBone = item.dataset.id;
        this.selectedSlot = null;
        this._renderBoneTree();
        this._renderSlotList();
        this._renderInspector();
      });
    }
  }

  _renderSlotList() {
    const container = this.el.slotList;
    const slots = [...(this.doc.slots || [])].sort((a, b) => a.z - b.z);
    container.innerHTML = slots.length > 0 ? slots.map((slot, index) => {
      const hidden = this._hiddenSlots.has(slot.id);
      const locked = this._lockedSlots.has(slot.id);
      return `
      <div class="se-slot-item ${slot.id === this.selectedSlot ? 'selected' : ''}" data-id="${slot.id}"
        style="${hidden ? 'opacity:.55;' : ''}">
        <button class="se-tgl" data-kind="vis" title="${hidden ? '仅在编辑器中显示此槽位附件' : '仅在编辑器中隐藏此槽位附件'}"
          style="flex:none;width:20px;height:18px;padding:0;font-size:10px;line-height:1;border-radius:3px;border:1px solid;cursor:pointer;${hidden ? 'background:#3a3a3a;border-color:#666;opacity:.85;' : 'background:#254830;border-color:#4a8a4a;'}">${hidden ? '🚫' : '👁'}</button>
        <button class="se-tgl" data-kind="lock" title="${locked ? '已锁定：画布不可点选/拖拽，点击解锁' : '未锁定：点击锁定防误触'}"
          style="flex:none;width:20px;height:18px;padding:0;font-size:10px;line-height:1;border-radius:3px;border:1px solid;cursor:pointer;${locked ? 'background:#5a2a2a;border-color:#c0504a;' : 'background:#26365f;border-color:#5574ad;'}">${locked ? '🔒' : '🔓'}</button>
        <button class="zbtn" data-dir="-1" ${index === 0 ? 'disabled' : ''} title="上移图层">▲</button>
        <button class="zbtn" data-dir="1" ${index === slots.length - 1 ? 'disabled' : ''} title="下移图层">▼</button>
        <span class="name">${slot.id} · ${slot.attachment?.type || 'empty'} · bone:${slot.bone} · z${slot.z}</span>
      </div>`;
    }).join('') : '<div class="se-empty">暂无槽位</div>';
    for (const item of container.querySelectorAll('.se-slot-item')) {
      item.addEventListener('click', event => {
        const toggle = event.target.closest('.se-tgl');
        if (toggle) {
          const slotId = item.dataset.id;
          if (toggle.dataset.kind === 'vis') {
            if (this._hiddenSlots.has(slotId)) this._hiddenSlots.delete(slotId);
            else this._hiddenSlots.add(slotId);
          } else if (this._lockedSlots.has(slotId)) this._lockedSlots.delete(slotId);
          else this._lockedSlots.add(slotId);
          this._renderSlotList();
          return;
        }
        this.selectedSlot = item.dataset.id;
        this.selectedBone = this._slotById(this.selectedSlot)?.bone || this.selectedBone;
        // 图片库联动高亮：选中槽位时同步高亮其引用图片
        this._selectedImageId = this._slotById(this.selectedSlot)?.attachment?.assetId || this._selectedImageId;
        this._renderSlotList();
        this._renderBoneTree();
        this._renderInspector();
        this._renderImageLib();
      });
    }
    for (const button of container.querySelectorAll('.zbtn')) {
      button.addEventListener('click', event => {
        event.stopPropagation();
        this._moveSlotZ(event.target.closest('.se-slot-item').dataset.id, Number(event.target.dataset.dir));
      });
    }
  }

  /** 图层栈排序：与相邻槽位交换 z（绘制顺序即时生效）。 */
  _moveSlotZ(slotId, direction) {
    this._pushHistory();
    const slots = [...(this.doc.slots || [])].sort((a, b) => a.z - b.z);
    const index = slots.findIndex(slot => slot.id === slotId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= slots.length) return;
    const current = slots[index];
    const neighbor = slots[targetIndex];
    const z = current.z;
    current.z = neighbor.z;
    neighbor.z = z;
    this._markDirty();
    this._renderSlotList();
    this._renderInspector();
  }

  /** 图片库条目/画布图片的 manifest 路径（sourceFile）。 */
  _imageEntryPath(assetId) {
    return this.imageCatalog.get(assetId)?.entry?.sourceFile || '';
  }

  /* ---------------- 半自动装配：切件模式 ---------------- */

  /** 命名 → 骨骼自动映射（人形装配约定；匹配不到回落当前选中骨骼）。 */
  static RIG_PART_MAP = {
    head: 'head', 'head-front': 'head', 'head-side': 'head', 'head-back': 'head',
    torso: 'torso', body: 'torso', pelvis: 'hips',
    'upper-arm-l': 'armUL', 'upper-arm-r': 'armUR', armul: 'armUL', armur: 'armUR',
    'fore-arm-l': 'armFL', 'fore-arm-r': 'armFR', arml: 'armFL', armr: 'armFR',
    'thigh-l': 'thighL', 'thigh-r': 'thighR', thighl: 'thighL', thighr: 'thighR',
    'calf-l': 'calfL', 'calf-r': 'calfR', calfl: 'calfL', calfr: 'calfR',
    'skirt-front': 'torso', 'skirt-back': 'torso', skirt: 'torso',
    weapon: 'armFR', 'weapon-axe': 'armFR', 'weapon-spear': 'back'
  };

  static RIG_PART_NAMES = [
    'head', 'head-front', 'head-side', 'head-back',
    'torso', 'torso-front', 'torso-side', 'torso-back', 'pelvis',
    'upper-arm-l', 'upper-arm-r', 'fore-arm-l', 'fore-arm-r',
    'thigh-l', 'thigh-r', 'calf-l', 'calf-r',
    'skirt-front', 'skirt-back', 'weapon', 'weapon-front', 'weapon-side', 'weapon-back'
  ];

  /** 部件名 → 骨骼解析：先查全名，再剥离 -front/-side/-back 方向后缀查表。 */
  static _resolvePartBone(name) {
    const lower = (name || '').trim().toLowerCase();
    if (SkeletonEditor.RIG_PART_MAP[lower]) return SkeletonEditor.RIG_PART_MAP[lower];
    const stripped = lower.replace(/-(front|side|back)$/, '');
    return SkeletonEditor.RIG_PART_MAP[stripped] || null;
  }

  /** 进入切件模式：画布切换为源图视图，拖框切片。
   *  大图懒加载竞态防护：图片未加载完（width 缺省）时先适配，加载完成后重新适配坐标系。 */
  _enterSliceMode(assetId) {
    const item = this.imageCatalog.get(assetId);
    if (!item) return;
    this._removeContextMenu();
    this._exitSlicePanel();
    this._sliceMode = { assetId, width: item.width || 0, height: item.height || 0, rect: null };
    const applyView = () => {
      if (!this._sliceMode || this._sliceMode.assetId !== assetId) return;
      if (item.width > 0 && (this._sliceMode.width !== item.width || this._sliceMode.height !== item.height)) {
        this._sliceMode.width = item.width;
        this._sliceMode.height = item.height;
        this._sliceMode.rect = null; // 坐标系更新后旧选区无效
      }
      if (this._sliceMode.width > 0 && this._sliceMode.height > 0) {
        this._fitViewToSliceSource();
        this._draw();
      }
    };
    applyView();
    if (item.element && !item.element.complete) {
      item.element.addEventListener('load', applyView, { once: true });
    } else if (!item.element || !item.width) {
      // 预热完整加载（元素缺失，或懒加载缩略图尚未请求主图）
      const element = new Image();
      element.onload = () => {
        item.width = item.width || element.naturalWidth;
        item.height = item.height || element.naturalHeight;
        if (!item.element?.complete) item.element = element;
        applyView();
      };
      element.src = item.url;
    }
    this._toast(`切件模式：在 ${assetId} 上拖框选择部件区域，Esc 退出`);
  }

  _exitSliceMode() {
    this._sliceMode = null;
    this._sliceSelecting = null;
    this._exitSlicePanel();
    this._fitView();
  }

  /** 视图适配到切件源图（源图世界原点 (0,0)，留 40px 边距）。 */
  _fitViewToSliceSource() {
    const canvas = this.el.canvas;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const source = this._sliceMode;
    this.view.scale = Math.max(0.1, Math.min(
      (rect.width - 80) / source.width,
      (rect.height - 80) / source.height,
      6
    ));
    this.view.ox = rect.width / 2 - (source.width / 2) * this.view.scale;
    this.view.oy = rect.height / 2 - (source.height / 2) * this.view.scale;
    this._sizeCanvas();
  }

  /** 切件模式画布绘制：源图 + 已建切片框 + 当前选区。 */
  _drawSliceMode(ctx, viewRect) {
    const source = this._sliceMode;
    const img = this._imageElement(source.assetId);
    const topLeft = this._worldToScreen(0, 0);
    if (img) {
      ctx.drawImage(img, topLeft.x, topLeft.y, source.width * this.view.scale, source.height * this.view.scale);
    } else {
      ctx.fillStyle = 'rgba(126,200,255,0.15)';
      ctx.fillRect(topLeft.x, topLeft.y, source.width * this.view.scale, source.height * this.view.scale);
    }
    ctx.strokeStyle = 'rgba(255,212,121,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(topLeft.x, topLeft.y, source.width * this.view.scale, source.height * this.view.scale);
    // 已建切片框（当前源图引用中的 slice 附件）
    for (const slot of this.doc?.slots || []) {
      const att = slot.attachment;
      if (att?.type !== 'slice' || att.assetId !== source.assetId) continue;
      const box = this._worldToScreen(att.sx, att.sy);
      ctx.strokeStyle = 'rgba(126,200,255,0.9)';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(box.x, box.y, att.sw * this.view.scale, att.sh * this.view.scale);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(126,200,255,0.9)';
      ctx.font = '10px sans-serif';
      ctx.fillText(slot.id, box.x, box.y - 3);
    }
    // 当前选区
    if (source.rect) {
      const rect = this._worldToScreen(source.rect.x, source.rect.y);
      ctx.strokeStyle = '#ffd479';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(rect.x, rect.y, source.rect.w * this.view.scale, source.rect.h * this.view.scale);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,212,121,0.12)';
      ctx.fillRect(rect.x, rect.y, source.rect.w * this.view.scale, source.rect.h * this.view.scale);
      ctx.fillStyle = '#ffd479';
      ctx.font = '11px sans-serif';
      ctx.fillText(`${Math.round(source.rect.w)}×${Math.round(source.rect.h)}`, rect.x, rect.y - 4);
    }
    // 模式提示条
    ctx.fillStyle = 'rgba(16,24,48,0.92)';
    ctx.fillRect(viewRect.x + 8, viewRect.y + 8, 320, 26);
    ctx.strokeStyle = 'rgba(58,74,126,0.9)';
    ctx.strokeRect(viewRect.x + 8, viewRect.y + 8, 320, 26);
    ctx.fillStyle = '#ffd479';
    ctx.font = '12px sans-serif';
    ctx.fillText(`✂ 切件：${source.assetId} — 命名 head / head-side / head-back 区分三方向（side/back 自动隐藏），Esc 退出`, viewRect.x + 16, viewRect.y + 25);
  }

  /** 切片确认面板：部件命名（约定 datalist）+ 目标骨骼 → 创建 slice 附件槽位。 */
  _showSlicePanel(screenX, screenY) {
    this._exitSlicePanel();
    const rect = this._sliceMode.rect;
    if (!rect || rect.w < 2 || rect.h < 2) return;
    const panel = document.createElement('div');
    panel.id = 'se-slice-panel';
    Object.assign(panel.style, {
      position: 'fixed', zIndex: '10001', background: '#1a2440', border: '1px solid #3a4a7e',
      borderRadius: '6px', padding: '8px', fontSize: '12px', color: '#e0e0e0',
      display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '230px',
      boxShadow: '0 6px 18px rgba(0,0,0,0.55)'
    });
    const boneOptions = (this.doc?.bones || [])
      .map(bone => `<option value="${bone.id}">${bone.id}</option>`).join('');
    const nameList = SkeletonEditor.RIG_PART_NAMES
      .map(name => `<option value="${name}">`).join('');
    panel.innerHTML = `
      <div style="color:#ffd479;">✂ 新部件切片（${Math.round(rect.w)}×${Math.round(rect.h)}）</div>
      <div style="display:flex;gap:4px;align-items:center;">
        <label style="color:#9aa5c0;">名称</label>
        <input id="se-slice-name" list="se-rig-part-names" placeholder="如 head / upper-arm-l" style="flex:1;min-width:0;">
        <datalist id="se-rig-part-names">${nameList}</datalist>
      </div>
      <div style="display:flex;gap:4px;align-items:center;">
        <label style="color:#9aa5c0;">骨骼</label>
        <select id="se-slice-bone" style="flex:1;min-width:0;">${boneOptions}</select>
      </div>
      <div style="display:flex;gap:6px;justify-content:flex-end;">
        <button id="se-slice-cancel">取消</button>
        <button id="se-slice-create" class="primary" style="background:#4CAF50;color:#000;font-weight:bold;">创建切片附件</button>
      </div>`;
    document.body.appendChild(panel);
    this._slicePanel = panel;
    const nameInput = panel.querySelector('#se-slice-name');
    const boneSelect = panel.querySelector('#se-slice-bone');
    // 命名 → 骨骼自动映射（支持 -front/-side/-back 方向后缀剥离）
    nameInput.addEventListener('input', () => {
      const mapped = SkeletonEditor._resolvePartBone(nameInput.value);
      if (mapped && [...boneSelect.options].some(option => option.value === mapped)) {
        boneSelect.value = mapped;
      }
    });
    const close = () => {
      panel.remove();
      if (this._slicePanel === panel) this._slicePanel = null;
    };
    panel.querySelector('#se-slice-cancel').addEventListener('click', close);
    panel.querySelector('#se-slice-create').addEventListener('click', () => {
      const name = nameInput.value.trim().replace(/\s+/g, '-').toLowerCase();
      if (!name) { this._toast('请输入部件名', true); return; }
      this._createSliceAttachment(name, boneSelect.value, rect);
      close();
    });
    // 定位到选区旁（视口内收拢）
    const panelRect = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(4, Math.min(screenX, window.innerWidth - panelRect.width - 8))}px`;
    panel.style.top = `${Math.max(4, Math.min(screenY, window.innerHeight - panelRect.height - 8))}px`;
    nameInput.focus();
  }

  _exitSlicePanel() {
    document.getElementById('se-slice-panel')?.remove();
    this._slicePanel = null;
  }

  /** 由选区创建 slice 附件槽位（源图矩形区域，零文件 IO）。
   *  三方向约定：名称以 -front 结尾或无后缀 → 可见；-side / -back → 默认隐藏（运行时按朝向切换）。 */
  _createSliceAttachment(name, boneId, rect) {
    if (!boneId || !this._boneById(boneId)) { this._toast('目标骨骼不存在', true); return; }
    this._pushHistory();
    let slotId = `slice_${name}`;
    let index = 1;
    while (this._slotById(slotId)) slotId = `slice_${name}_${index++}`;
    const maxZ = (this.doc.slots || []).reduce((max, candidate) => Math.max(max, candidate.z || 0), 0);
    const directionHidden = /-(side|back)$/.test(name);
    this.doc.slots = this.doc.slots || [];
    this.doc.slots.push({
      id: slotId,
      bone: boneId,
      z: maxZ + 1,
      attachment: {
        type: 'slice',
        assetId: this._sliceMode.assetId,
        sx: Math.round(rect.x), sy: Math.round(rect.y),
        sw: Math.round(rect.w), sh: Math.round(rect.h),
        x: 0, y: 0, rot: 0,
        width: Math.round(rect.w), height: Math.round(rect.h),
        visible: !directionHidden
      }
    });
    this.selectedSlot = slotId;
    this.selectedBone = boneId;
    this._markDirty();
    this._afterDocChange();
    this._renderImageLib();
    this._toast(`已创建切片槽位 ${slotId} → ${boneId}${directionHidden ? '（side/back 方向默认隐藏）' : ''}（可拖动微调挂点）`);
  }

  /** 导入外部图片（三方向设定图等）：统一转 PNG 落盘 + manifest 事务登记 + 图片库刷新。 */
  async _importImageFromFile(file) {
    if (!file || !this.projectPath) { this._toast('未加载项目，无法导入', true); return; }
    const baseName = (file.name.replace(/\.[^.]+$/, '') || 'character')
      .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'character';
    const nameInput = prompt('登记图片 ID（图片库标识；建议带角色名，如 wanderer-girl）：', baseName);
    if (!nameInput?.trim()) return;
    const imageId = nameInput.trim().replace(/\s+/g, '-');
    try {
      // 解码并统一转 PNG（登记端点校验 .png 后缀与 PNG 头）
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsDataURL(file);
      });
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('图片解码失败'));
        element.src = dataUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      const pngBase64 = canvas.toDataURL('image/png').split(',')[1];
      const runtimePath = `assets/images/characters/${imageId}.png`;
      const saved = await fetch('/api/save-file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `${this.gameRoot}/${runtimePath}`, content: pngBase64, encoding: 'base64' })
      }).then(response => response.json());
      if (!saved?.ok) { this._toast(`图片落盘失败：${saved?.error || saved?.message || ''}`, true); return; }
      const registered = await fetch('/api/scene-image-asset-transaction', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: this.projectPath,
          imageAssets: [{ imageId, runtimePath, sceneId: 'skeleton-editor' }]
        })
      }).then(response => response.json());
      if (!registered?.ok) { this._toast(`Manifest 登记失败：${registered?.error || registered?.message || ''}`, true); return; }
      await this._loadManifest();
      this._toast(`已导入 ${imageId}（${canvas.width}×${canvas.height}），可在切件模式中装配`);
    } catch (error) {
      this._toast(`导入失败：${error.message}`, true);
    }
  }

  /** 人形 rig 模板：一键生成标准 13 骨骼火柴人骨架（关节坐标式，与 player.json 布局一致）。 */
  _applyHumanoidTemplate() {
    if (this.dirty && !confirm('应用模板将替换当前骨骼树（槽位清空），未保存修改将丢失，确定？')) return;
    this._pushHistory();
    const B = (id, parent, x, y, length) => ({ id, parent, x, y, rot: 0, scaleX: 1, scaleY: 1, length });
    this.doc.bones = [
      B('root', null, 0, 0, 16),
      B('hips', 'root', 0, -26, 14),
      B('torso', 'hips', 0, -2, 20),
      B('head', 'torso', 0, -20, 16),
      B('armUL', 'torso', -7, -16, 12),
      B('armUR', 'torso', 7, -16, 12),
      B('armFL', 'armUL', 0, 12, 13),
      B('armFR', 'armUR', 0, 12, 13),
      B('thighL', 'hips', -5, -1, 13),
      B('thighR', 'hips', 5, -1, 13),
      B('calfL', 'thighL', 0, 13, 14),
      B('calfR', 'thighR', 0, 13, 14),
      B('back', 'hips', 0, -14, 10)
    ];
    this.doc.slots = [
      { id: 'shadow', bone: 'root', z: 0, attachment: { type: 'empty' } }
    ];
    if (!this.doc.defaultClip) this.doc.defaultClip = 'idle_down';
    if (!this.doc.clips?.length) {
      this.doc.clips = [{ name: 'idle_down', durationMs: 1000, loop: true, tracks: [] }];
    }
    this.selectedBone = 'root';
    this.selectedSlot = null;
    this._hiddenBones.clear();
    this._lockedBones.clear();
    this._hiddenSlots.clear();
    this._lockedSlots.clear();
    this._markDirty();
    this._afterDocChange();
    this._toast('已应用人形模板：13 骨骼，可进入切件模式装配部件');
  }

  /** 图片库条目/画布图片的 manifest 路径（sourceFile）。 */
  _imageEntryPath(assetId) {
    return this.imageCatalog.get(assetId)?.entry?.sourceFile || '';
  }

  /** 通用右键菜单（对齐场景编辑器交互：items 数组 + fixed DOM + 越界翻转 + 外点关闭）。 */
  _showContextMenu(event, items, header = '') {
    this._removeContextMenu();
    const menu = document.createElement('div');
    menu.id = 'editor-context-menu';
    Object.assign(menu.style, {
      position: 'fixed', zIndex: '10000', minWidth: '190px', maxWidth: '340px',
      background: '#1a2440', border: '1px solid #3a4a7e', borderRadius: '6px',
      padding: '4px', boxShadow: '0 6px 18px rgba(0,0,0,0.55)', fontSize: '12px', color: '#e0e0e0',
      userSelect: 'none'
    });
    if (header) {
      const head = document.createElement('div');
      head.textContent = header;
      head.title = header;
      Object.assign(head.style, {
        padding: '3px 8px 5px', color: '#9aa5c0', fontSize: '11px',
        borderBottom: '1px solid #26355c', marginBottom: '3px',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
      });
      menu.appendChild(head);
    }
    for (const item of items) {
      if (item.separator) {
        const hr = document.createElement('div');
        Object.assign(hr.style, { height: '1px', background: '#26355c', margin: '3px 4px' });
        menu.appendChild(hr);
        continue;
      }
      const row = document.createElement('div');
      row.textContent = item.label;
      Object.assign(row.style, {
        padding: '5px 10px', borderRadius: '4px', cursor: item.disabled ? 'default' : 'pointer',
        color: item.disabled ? '#5a6a90' : '#e0e0e0', whiteSpace: 'nowrap'
      });
      if (!item.disabled) {
        row.addEventListener('mouseenter', () => { row.style.background = '#2a4a3e'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        row.addEventListener('click', () => {
          this._removeContextMenu();
          item.action();
        });
      }
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(4, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`;
    this._contextMenuCloser = mouseEvent => {
      if (!menu.contains(mouseEvent.target)) this._removeContextMenu();
    };
    setTimeout(() => document.addEventListener('mousedown', this._contextMenuCloser), 0);
  }

  _removeContextMenu() {
    document.getElementById('editor-context-menu')?.remove();
    if (this._contextMenuCloser) {
      document.removeEventListener('mousedown', this._contextMenuCloser);
      this._contextMenuCloser = null;
    }
  }

  /** 图片右键菜单项：绑定/定位/删除 + 复制路径 + 缓存重载。 */
  _buildImageMenuItems(assetId) {
    const bound = (this.doc?.slots || []).filter(slot => slot.attachment?.assetId === assetId);
    const path = this._imageEntryPath(assetId);
    const item = this.imageCatalog.get(assetId);
    const items = [];
    if (bound.length > 0) {
      items.push({
        label: `🎯 选中引用槽位（${bound.map(slot => slot.id).join('、')}）`,
        action: () => {
          this.selectedSlot = bound[0].id;
          this.selectedBone = bound[0].bone;
          this._renderSlotList();
          this._renderBoneTree();
          this._renderInspector();
        }
      });
      items.push({ label: '🗑 删除引用槽位', action: () => this._unbindImage(assetId) });
    } else {
      items.push({
        label: '🔗 挂到当前骨骼',
        disabled: !this.selectedBone,
        action: () => this._bindImageToSelectedBone(assetId)
      });
    }
    items.push({ separator: true });
    items.push({ label: '✂ 在切件模式中打开（拖框切片挂骨骼）', action: () => this._enterSliceMode(assetId) });
    items.push({
      label: '📋 复制图片路径',
      action: () => {
        navigator.clipboard?.writeText(path).then(
          () => this._toast(`已复制路径 ${path}`),
          () => this._toast('复制失败（剪贴板不可用）', true)
        );
      }
    });
    items.push({
      label: `🔄 重新加载图片${item ? `（${item.width || '?'}×${item.height || '?'}）` : ''}`,
      action: () => this._reloadImageElement(assetId)
    });
    return items;
  }

  /** 缓存穿透重载图片元素并清理派生缓存（alpha 命中盒等）。 */
  _reloadImageElement(assetId) {
    const entry = this.imageCatalog.get(assetId);
    if (!entry) return;
    const element = new Image();
    element.onload = () => {
      entry.width = element.naturalWidth;
      entry.height = element.naturalHeight;
    };
    element.src = `${entry.url}${entry.url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    entry.element = element;
    for (const key of [...this._alphaBoundsCache.keys()]) {
      if (key.startsWith(`${assetId}|`)) this._alphaBoundsCache.delete(key);
    }
    this._toast(`已重载图片 ${assetId}`);
  }

  /** 图片库（Spine 式）：缩略图列表；「→骨骼」挂图、「解绑」移除该图片的所有槽位。 */
  _renderImageLib() {
    const container = document.getElementById('se-image-lib');
    if (!container) return;
    const slots = this.doc?.slots || [];
    const boundBonesOf = assetId => slots
      .filter(slot => slot.attachment?.assetId === assetId)
      .map(slot => `${slot.id}@${slot.bone}`);
    const items = [...this.imageCatalog.entries()];
    container.innerHTML = items.length > 0 ? items.map(([assetId, item]) => {
      const bound = boundBonesOf(assetId);
      const path = this._imageEntryPath(assetId);
      const boundBadge = bound.length > 0
        ? `<span class="bound-badge" data-slot="${bound[0].split('@')[0]}" style="color:#7ec8ff;font-size:10px;flex:none;cursor:pointer;" title="点击选中引用槽位 ${bound.join(', ')}">已绑×${bound.length}</span>`
        : '';
      const action = bound.length > 0
        ? `<button data-unbind="1" class="danger" title="移除引用该图片的所有槽位">解绑</button>`
        : `<button data-bind="1" title="作为 image 附件挂到当前选中骨骼">→骨骼</button>`;
      return `
      <div class="se-img-item ${assetId === this._selectedImageId ? 'selected' : ''}" data-id="${assetId}">
        <img src="${item.url}" loading="lazy" alt="${assetId}">
        <span class="name" title="${assetId}${path ? '（' + path + '）' : ''}">${assetId}</span>
        ${boundBadge}
        ${action}
      </div>`;
    }).join('') : '<div class="se-empty">Manifest 无图片资产</div>';
    for (const item of container.querySelectorAll('.se-img-item')) {
      item.addEventListener('click', () => {
        this._selectedImageId = item.dataset.id;
        this._renderImageLib();
      });
      // 右键图片库条目：弹出该图片的右键菜单（路径/绑定/重载）
      item.addEventListener('contextmenu', event => {
        event.preventDefault();
        event.stopPropagation();
        this._selectedImageId = item.dataset.id;
        this._renderImageLib();
        this._showContextMenu(event, this._buildImageMenuItems(item.dataset.id), this._imageEntryPath(item.dataset.id));
      });
    }
    // 点击「已绑×N」徽标：定位选中引用槽位（画布高亮 + 检查器）
    for (const badge of container.querySelectorAll('.bound-badge')) {
      badge.addEventListener('click', event => {
        event.stopPropagation();
        const slotId = badge.dataset.slot;
        if (!this._slotById(slotId)) return;
        this.selectedSlot = slotId;
        this.selectedBone = this._slotById(slotId)?.bone || this.selectedBone;
        this._renderSlotList();
        this._renderBoneTree();
        this._renderInspector();
      });
    }
    for (const button of container.querySelectorAll('button[data-bind]')) {
      button.addEventListener('click', event => {
        event.stopPropagation();
        this._bindImageToSelectedBone(event.target.closest('.se-img-item').dataset.id);
      });
    }
    for (const button of container.querySelectorAll('button[data-unbind]')) {
      button.addEventListener('click', event => {
        event.stopPropagation();
        this._unbindImage(event.target.closest('.se-img-item').dataset.id);
      });
    }
  }

  /** 解绑：移除引用该图片的所有槽位（含 sequence，body 等核心槽位也会被移除，操作可撤销=不保存）。 */
  _unbindImage(assetId) {
    this._pushHistory();
    const slots = this.doc?.slots || [];
    const bound = slots.filter(slot => slot.attachment?.assetId === assetId);
    if (bound.length === 0) { this._toast('该图片未绑定任何骨骼', true); return; }
    const detail = bound.map(slot => `${slot.id}(${slot.bone})`).join('、');
    this.doc.slots = slots.filter(slot => slot.attachment?.assetId !== assetId);
    if (bound.some(slot => slot.id === this.selectedSlot)) {
      this.selectedSlot = null;
      this._renderInspector();
    }
    this._markDirty();
    this._renderSlotList();
    this._renderImageLib();
    this._toast(`已解绑 ${assetId}：移除槽位 ${detail}`);
  }

  /** 把图片库中的图片绑定到选中骨骼：自动创建槽位（z 置顶）+ image 附件。 */
  _bindImageToSelectedBone(assetId) {
    this._pushHistory();
    const boneId = this.selectedBone || this.doc.bones?.[0]?.id;
    if (!boneId) { this._toast('先选中一个骨骼', true); return; }
    const existing = (this.doc.slots || []).find(slot => slot.attachment?.assetId === assetId && slot.bone === boneId);
    if (existing) { this.selectedSlot = existing.id; this._toast('该骨骼已挂此图片，已选中其槽位'); this._renderSlotList(); return; }
    // sprite sheet 按 manifest 网格取单帧尺寸，避免整图铺满画布
    const item = this.imageCatalog.get(assetId);
    const grid = item?.entry?.grid;
    const attachment = { type: 'image', assetId, x: 0, y: 0, rot: 0, width: 0, height: 0 };
    if (grid?.columns > 0 && grid?.rows > 0 && item) {
      const naturalWidth = item.element?.naturalWidth || item.width || 0;
      const naturalHeight = item.element?.naturalHeight || item.height || 0;
      if (naturalWidth && naturalHeight) {
        attachment.width = Math.round(naturalWidth / grid.columns);
        attachment.height = Math.round(naturalHeight / grid.rows);
      }
    }
    const index = (this.doc.slots || []).length;
    const slot = {
      id: `slot_${assetId.replace(/[^a-zA-Z0-9-]/g, '-').slice(-24)}_${index}`,
      bone: boneId,
      z: (this.doc.slots || []).reduce((max, candidate) => Math.max(max, candidate.z), 0) + 1,
      attachment
    };
    this.doc.slots = this.doc.slots || [];
    this.doc.slots.push(slot);
    this.selectedSlot = slot.id;
    this.selectedBone = boneId;
    this._markDirty();
    this._renderSlotList();
    this._renderBoneTree();
    this._renderInspector();
    this._renderImageLib();
    this._toast(`已挂载 ${assetId} → 骨骼 ${boneId}（可在检查器改偏移/尺寸/绑定）`);
  }

  _renderInspector() {
    const body = this.el.inspectorBody;
    if (this.selectedSlot) {
      this._renderSlotInspector(body);
      return;
    }
    const bone = this._boneById(this.selectedBone);
    if (!bone) {
      this.el.inspectorTitle.textContent = '属性';
      body.innerHTML = '<div class="se-empty">选中骨骼或槽位以编辑属性</div>';
      return;
    }
    this.el.inspectorTitle.textContent = `骨骼 · ${bone.id}`;
    const parentOptions = (this.doc.bones || [])
      .filter(candidate => candidate.id !== bone.id && !this._isDescendant(bone.id, candidate.id))
      .map(candidate => `<option value="${candidate.id}" ${bone.parent === candidate.id ? 'selected' : ''}>${candidate.id}</option>`)
      .join('');
    body.innerHTML = `
      <div class="row"><label>ID</label><input type="text" id="se-bone-id" value="${bone.id}"></div>
      <div class="row"><label>父骨骼</label><select id="se-bone-parent"><option value="">(根)</option>${parentOptions}</select></div>
      <div class="row"><label>X</label><input type="number" id="se-bone-x" step="1" value="${bone.x}"></div>
      <div class="row"><label>Y</label><input type="number" id="se-bone-y" step="1" value="${bone.y}"></div>
      <div class="row"><label>旋转°</label><input type="number" id="se-bone-rot" step="1" value="${bone.rot}"></div>
      <div class="row"><label>缩放X</label><input type="number" id="se-bone-sx" step="0.1" value="${bone.scaleX ?? 1}"></div>
      <div class="row"><label>缩放Y</label><input type="number" id="se-bone-sy" step="0.1" value="${bone.scaleY ?? 1}"></div>
      <div class="row"><label>长度</label><input type="number" id="se-bone-length" min="0" step="1" value="${bone.length ?? 0}"></div>
      <div class="se-empty" style="text-align:left;">画布：拖原点移动 / 沿黄环拖旋转 / 点图片或拖动=编辑附件 / Alt+点击=选骨骼 / 滚轮缩放 / 右键平移</div>
    `;
    const bindValue = (id, field, transform = value => value) => {
      document.getElementById(id).addEventListener('change', event => {
        bone[field] = transform(event.target.value);
        this._markDirty();
        this._afterDocChange();
      });
    };
    document.getElementById('se-bone-id').addEventListener('change', event => {
      this._renameBone(bone.id, event.target.value.trim());
    });
    document.getElementById('se-bone-parent').addEventListener('change', event => {
      bone.parent = event.target.value || null;
      this._markDirty();
      this._afterDocChange();
    });
    bindValue('se-bone-x', 'x', Number);
    bindValue('se-bone-y', 'y', Number);
    bindValue('se-bone-rot', 'rot', Number);
    bindValue('se-bone-sx', 'scaleX', Number);
    bindValue('se-bone-sy', 'scaleY', Number);
    bindValue('se-bone-length', 'length', Number);
    this._syncOverlayToolbar();
  }

  /** 悬浮工具条同步：显示当前采样姿态（拖拽/点选时实时刷新）。 */
  _syncOverlayToolbar() {
    const bar = document.getElementById('se-overlay-bar');
    if (!bar) return;
    const bone = this._boneById(this.selectedBone);
    if (!bone || this.selectedSlot) {
      bar.style.display = 'none';
      return;
    }
    const sampled = this._sampledBoneLocal(bone.id) || {};
    bar.style.display = 'flex';
    bar.querySelector('#se-ov-bone').textContent = bone.id;
    bar.querySelector('#se-ov-x').value = (sampled.x ?? bone.x ?? 0).toFixed(1);
    bar.querySelector('#se-ov-y').value = (sampled.y ?? bone.y ?? 0).toFixed(1);
    bar.querySelector('#se-ov-rot').value = (sampled.rot ?? bone.rot ?? 0).toFixed(1);
  }

  _isDescendant(boneId, candidateId) {
    let cursor = this._boneById(candidateId);
    const seen = new Set();
    while (cursor?.parent) {
      if (cursor.parent === boneId) return true;
      if (seen.has(cursor.parent)) break;
      seen.add(cursor.parent);
      cursor = this._boneById(cursor.parent);
    }
    return false;
  }

  _renderSlotInspector(body) {
    const slot = this._slotById(this.selectedSlot);
    if (!slot) return;
    this._syncOverlayToolbar(); // 槽位选中时隐藏骨骼悬浮工具条
    this.el.inspectorTitle.textContent = `槽位 · ${slot.id}`;
    const attachment = slot.attachment || { type: 'empty' };
    const imageOptions = [...this.imageCatalog.keys()]
      .map(id => `<option value="${id}" ${attachment.assetId === id ? 'selected' : ''}>${id}</option>`)
      .join('');
    const boneOptions = (this.doc.bones || [])
      .map(bone => `<option value="${bone.id}" ${slot.bone === bone.id ? 'selected' : ''}>${bone.id}</option>`)
      .join('');
    const isSequence = attachment.type === 'sequence';
    const seAttPath = attachment.assetId ? this._imageEntryPath(attachment.assetId) : '';
    body.innerHTML = `
      <div class="row"><label>ID</label><input type="text" id="se-slot-id" value="${slot.id}"></div>
      <div class="row"><label>骨骼</label>
        <button id="se-slot-bone-prev" title="换绑到骨骼树中的上一个骨骼（保持部件位置）" style="flex:none;">‹</button>
        <select id="se-slot-bone" style="flex:1;min-width:0;">${boneOptions}</select>
        <button id="se-slot-bone-next" title="换绑到骨骼树中的下一个骨骼（保持部件位置）" style="flex:none;">›</button>
      </div>
      <div class="row"><label>z 序</label><input type="number" id="se-slot-z" step="1" value="${slot.z}"></div>
      <div class="se-attachment-box">
        <div class="row"><label>附件类型</label>
          <select id="se-att-type">
            ${['empty', 'image', 'slice', 'sequence'].map(type => `<option value="${type}" ${attachment.type === type ? 'selected' : ''}>${type}</option>`).join('')}
          </select>
          <label style="flex:none;margin-left:8px;"><input type="checkbox" id="se-att-visible" ${attachment.visible === false ? '' : 'checked'}> 可见</label>
        </div>
        ${attachment.type === 'empty' ? '' : `
        <div class="row"><label>图片ID</label><select id="se-att-asset">${imageOptions}</select></div>
        <div class="row"><label>路径</label><span id="se-att-path" title="${seAttPath}" style="flex:1;min-width:0;font-size:11px;color:#9aa5c0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${seAttPath || '(未登记路径)'}</span></div>
        <div class="row"><label>偏移X</label><input type="number" id="se-att-x" step="1" value="${attachment.x ?? 0}"></div>
        <div class="row"><label>偏移Y</label><input type="number" id="se-att-y" step="1" value="${attachment.y ?? 0}"></div>
        <div class="row"><label>旋转°</label><input type="number" id="se-att-rot" step="1" value="${attachment.rot ?? 0}"></div>
        <div class="row"><label>绘制宽</label><input type="number" id="se-att-width" min="0" step="1" value="${attachment.width ?? 0}"></div>
        <div class="row"><label>绘制高</label><input type="number" id="se-att-height" min="0" step="1" value="${attachment.height ?? 0}"></div>`}
        ${attachment.type === 'slice' ? `
        <div class="row"><label>源矩形</label>
          <input type="number" id="se-att-sx" step="1" value="${attachment.sx ?? 0}" style="width:52px;">
          <input type="number" id="se-att-sy" step="1" value="${attachment.sy ?? 0}" style="width:52px;">
          <input type="number" id="se-att-sw" step="1" value="${attachment.sw ?? 32}" style="width:52px;">
          <input type="number" id="se-att-sh" step="1" value="${attachment.sh ?? 32}" style="width:52px;">
        </div>` : ''}
        ${isSequence ? `
        <div class="row"><label>帧率fps</label><input type="number" id="se-att-fps" min="1" step="1" value="${attachment.fps ?? 8}"></div>
        <div class="row"><label>切帧</label>
          <input type="number" id="se-seq-columns" min="1" step="1" value="${this._seqColumns || 2}" style="width:52px;" title="列数">
          <input type="number" id="se-seq-count" min="1" step="1" value="${attachment.frames?.length || 2}" style="width:52px;" title="帧数">
          <button id="se-seq-generate">按行切帧</button>
        </div>
        <div class="se-empty" style="text-align:left;">按图片行优先切出 ${attachment.frames?.length || 0} 帧（等分整图）</div>` : ''}
      </div>
      <div class="se-empty" style="text-align:left;">画布：点选/拖动图片=调偏移 / 蓝环拖=旋转图片 / Delete=解绑 / Alt+点击=选骨骼</div>
    `;
    const $ = id => document.getElementById(id);
    $('se-slot-id').addEventListener('change', event => {
      const next = event.target.value.trim();
      if (next && !this._slotById(next)) {
        slot.id = next;
        this.selectedSlot = next;
        this._markDirty();
        this._afterDocChange();
      }
    });
    // 换绑骨骼（下拉/‹›快捷）统一保持部件世界位置不变
    const rotateSlotBone = direction => {
      const index = this.doc.bones.findIndex(candidate => candidate.id === slot.bone);
      const next = this.doc.bones[(index + direction + this.doc.bones.length) % this.doc.bones.length];
      if (!next || next.id === slot.bone) return;
      this._rebindSlotKeepWorld(slot.id, next.id);
      this._markDirty();
      this._afterDocChange();
      this._toast(`已换绑到骨骼 ${next.id}`);
    };
    $('se-slot-bone-prev').addEventListener('click', () => rotateSlotBone(-1));
    $('se-slot-bone-next').addEventListener('click', () => rotateSlotBone(1));
    $('se-slot-bone').addEventListener('change', event => {
      this._rebindSlotKeepWorld(slot.id, event.target.value);
      this._markDirty();
      this._afterDocChange();
    });
    $('se-slot-z').addEventListener('change', event => { slot.z = Number(event.target.value) || 0; this._markDirty(); this._afterDocChange(); });
    $('se-att-visible').addEventListener('change', event => {
      attachment.visible = event.target.checked;
      this._markDirty();
      this._afterDocChange();
    });
    $('se-att-type').addEventListener('change', event => {
      const type = event.target.value;
      slot.attachment = type === 'empty'
        ? { type, x: 0, y: 0, rot: 0 }
        : { type, assetId: attachment.assetId || [...this.imageCatalog.keys()][0] || '', x: 0, y: 0, rot: 0, width: 0, height: 0 };
      if (type === 'slice') Object.assign(slot.attachment, { sx: 0, sy: 0, sw: 32, sh: 32 });
      if (type === 'sequence') Object.assign(slot.attachment, { fps: 8, frames: [] });
      this._markDirty();
      this._afterDocChange();
    });
    const bindAttachment = (id, field, transform = Number) => {
      const element = $(id);
      if (!element) return;
      element.addEventListener('change', event => {
        slot.attachment[field] = transform(event.target.value);
        this._markDirty();
        this._afterDocChange();
      });
    };
    const assetSelect = $('se-att-asset');
    if (assetSelect) assetSelect.addEventListener('change', event => {
      slot.attachment.assetId = event.target.value;
      if (slot.attachment.type === 'sequence') slot.attachment.frames = [];
      this._markDirty();
      this._afterDocChange();
    });
    bindAttachment('se-att-x', 'x');
    bindAttachment('se-att-y', 'y');
    bindAttachment('se-att-rot', 'rot');
    bindAttachment('se-att-width', 'width');
    bindAttachment('se-att-height', 'height');
    bindAttachment('se-att-sx', 'sx');
    bindAttachment('se-att-sy', 'sy');
    bindAttachment('se-att-sw', 'sw');
    bindAttachment('se-att-sh', 'sh');
    bindAttachment('se-att-fps', 'fps');
    const generate = $('se-seq-generate');
    if (generate) generate.addEventListener('click', () => {
      const columns = Math.max(1, Number($('se-seq-columns').value) || 1);
      const count = Math.max(1, Number($('se-seq-count').value) || 1);
      this._seqColumns = columns;
      const item = this.imageCatalog.get(slot.attachment.assetId);
      const sw = (item?.width || 64) / columns;
      const sh = (item?.height || 32) / Math.max(1, Math.ceil(count / columns));
      slot.attachment.frames = Array.from({ length: count }, (_, index) => ({
        sx: Math.round((index % columns) * sw),
        sy: Math.round(Math.floor(index / columns) * sh),
        sw: Math.round(sw),
        sh: Math.round(sh)
      }));
      this._markDirty();
      this._afterDocChange();
    });
  }

  /* ---------------- 时间轴 ---------------- */

  _renderTimeline() {
    const body = this.el.tlBody;
    const clip = this._clip();
    if (!clip) { body.innerHTML = '<div class="se-empty">无剪辑</div>'; return; }
    const rows = (clip.tracks || []).map(track => {
      const keys = (track.keys || []).map((key, index) => {
        const left = (key.t / clip.durationMs) * 100;
        const selected = this.selectedKey?.bone === track.bone && this.selectedKey?.index === index;
        return `<div class="se-tl-key ${selected ? 'selected' : ''}" data-bone="${track.bone}" data-index="${index}" style="left:${left}%" title="t=${key.t}ms"></div>`;
      }).join('');
      return `<div class="se-tl-row" data-bone="${track.bone}">
        <div class="label">${track.bone}</div>
        <div class="lane">${keys}<div id="se-tl-playhead" style="left:${(this.previewTime / clip.durationMs) * 100}%"></div></div>
      </div>`;
    }).join('');
    body.innerHTML = rows || '<div class="se-empty">当前剪辑没有轨道——选择骨骼后点「✚ 轨道」</div>';
    const duration = clip.durationMs;

    for (const row of body.querySelectorAll('.se-tl-row')) {
      const lane = row.querySelector('.lane');
      const boneId = row.dataset.bone;
      lane.addEventListener('mousedown', event => {
        if (event.target.classList.contains('se-tl-key')) return;
        const laneRect = lane.getBoundingClientRect();
        const seek = clientX => {
          this.previewTime = Math.max(0, Math.min(duration, ((clientX - laneRect.left) / laneRect.width) * duration));
        };
        seek(event.clientX);
        this._renderTimeline();
        // 播放头拖拽（按住 lane 持续扫动）
        const onMove = moveEvent => {
          seek(moveEvent.clientX);
          this._renderTimeline();
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    }
    for (const keyElement of body.querySelectorAll('.se-tl-key')) {
      keyElement.addEventListener('mousedown', event => {
        event.stopPropagation();
        const boneName = keyElement.dataset.bone;
        const keyIndex = Number(keyElement.dataset.index);
        this.selectedKey = { bone: boneName, index: keyIndex };
        document.getElementById('se-key-del').disabled = false;
        // 注意：先取 lane 矩形再 _renderTimeline()——重建 innerHTML 会分离 keyElement
        const laneRect = keyElement.parentElement.getBoundingClientRect();
        this._renderTimeline();
        // 关键帧拖动：水平拖改 t（Blender/Spine dope sheet 惯例）
        const track = this._clip()?.tracks?.find(candidate => candidate.bone === boneName);
        const key = track?.keys?.[keyIndex];
        if (!key) return;
        this._pushHistory();
        const onMove = moveEvent => {
          const ratio = Math.max(0, Math.min(1, (moveEvent.clientX - laneRect.left) / laneRect.width));
          key.t = Math.round(ratio * duration);
          this._renderTimeline();
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          track.keys.sort((left, right) => left.t - right.t);
          this.selectedKey.index = track.keys.indexOf(key);
          this._markDirty();
          this._renderTimeline();
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    }
    if (!this.selectedKey) document.getElementById('se-key-del').disabled = true;
    // 当前时间输入框同步
    const timeInput = document.getElementById('se-time-input');
    if (timeInput && document.activeElement !== timeInput) timeInput.value = Math.round(this.previewTime);
  }

  /** 换绑槽位到目标骨骼并保持部件世界位置/角度不变（拖放换绑与检查器换绑共用）。 */
  _rebindSlotKeepWorld(slotId, newBoneId) {
    const slot = this._slotById(slotId);
    if (!slot || !this._boneById(newBoneId)) return false;
    const att = slot.attachment;
    if (!att || att.type === 'empty') {
      slot.bone = newBoneId;
      return true;
    }
    const world = this._boneWorldTransforms();
    const oldBone = world.get(slot.bone);
    const newBone = world.get(newBoneId);
    if (!oldBone || !newBone) {
      slot.bone = newBoneId;
      return true;
    }
    const cos = Math.cos(oldBone.rad);
    const sin = Math.sin(oldBone.rad);
    const worldX = oldBone.x + att.x * cos - att.y * sin;
    const worldY = oldBone.y + att.x * sin + att.y * cos;
    const invCos = Math.cos(-newBone.rad);
    const invSin = Math.sin(-newBone.rad);
    const dx = worldX - newBone.x;
    const dy = worldY - newBone.y;
    const r1 = value => Math.round(value * 10) / 10;
    att.x = r1(dx * invCos - dy * invSin);
    att.y = r1(dx * invSin + dy * invCos);
    const worldRot = oldBone.rad + (att.rot || 0) * Math.PI / 180;
    att.rot = r1((worldRot - newBone.rad) * 57.29578);
    slot.bone = newBoneId;
    return true;
  }

  /** 拾取鼠标附近的骨骼原点（拖放换绑的目标探测；排除自身骨骼）。 */
  _pickBoneOrigin(mx, my, world, radius = 16, excludeBoneId = null) {
    let hit = null;
    let best = radius;
    for (const bone of this.doc.bones || []) {
      if (this._isBoneLocked(bone.id) || bone.id === excludeBoneId) continue;
      const boneWorld = world.get(bone.id);
      if (!boneWorld) continue;
      const anchor = this._worldToScreen(boneWorld.x, boneWorld.y);
      const distance = Math.hypot(anchor.x - mx, anchor.y - my);
      if (distance < best) { hit = bone.id; best = distance; }
    }
    return hit;
  }

  /** mouseup：切件选区完成 → 弹确认面板；所有拖拽统一在此释放。 */
  _onCanvasUp(event) {
    // 拖放换绑：附件拖到目标骨骼原点附近松手 → 重挂到该骨骼（保持世界位置）
    if (this._drag?.kind === 'attach-move' && this._drag.rebindTarget) {
      const slotId = this._drag.slotId;
      const target = this._drag.rebindTarget;
      if (this._rebindSlotKeepWorld(slotId, target)) {
        this._toast(`已换绑到骨骼 ${target}（部件位置保持不变）`);
        this._renderSlotList();
        this._renderBoneTree();
        this._renderInspector();
      }
      this._drag = null;
      return;
    }
    if (this._sliceMode && this._sliceSelecting) {
      this._sliceSelecting = null;
      const rect = this._sliceMode.rect;
      if (rect && rect.w >= 2 && rect.h >= 2) {
        this._showSlicePanel(event.clientX, event.clientY);
      } else {
        this._sliceMode.rect = null;
      }
    }
    // 任何拖拽（骨骼/附件/旋转/平移）松开即结束
    this._drag = null;
  }

  /* ---------------- 保存 ---------------- */

  async _save() {
    if (!this.doc) return;
    this.doc.skeletonId = this.el.skeletonId.value.trim() || this.doc.skeletonId;
    const validation = validateSkeletonAsset(structuredClone(this.doc));
    if (!validation.ok) {
      const messages = validation.errors.map(error => `${error.path || ''}: ${error.message || error.reason || ''}`).join('\n');
      this._toast(`校验失败，未保存`, true);
      alert(`骨骼资产校验失败：\n${messages}`);
      return;
    }
    this.el.save.disabled = true;
    try {
      const result = await this.commands.saveSkeleton(this.projectPath, structuredClone(this.doc));
      if (result.ok) {
        this.dirty = false;
        this.el.dirty.style.display = 'none';
        this.el.skeletonId.disabled = true;
        if (!this.skeletonEntries.some(entry => (entry.imageId || entry.assetId) === this.doc.skeletonId)) {
          this.skeletonEntries.push({
            assetId: this.doc.skeletonId, imageId: this.doc.skeletonId,
            runtime2D: { mode: 'skeleton', path: `assets/skeletons/${this.doc.skeletonId}.json` }
          });
          this._refreshAssetSelect();
        }
        this._toast('已保存：骨骼 JSON + Manifest 已落盘');
      } else {
        this._toast(`保存失败：${result.error || '未知错误'}`, true);
      }
    } finally {
      this.el.save.disabled = false;
    }
  }

  /* ---------------- 主循环 ---------------- */

  _loop() {
    const now = performance.now();
    const delta = this._lastFrameAt ? now - this._lastFrameAt : 0;
    this._lastFrameAt = now;
    this._previewClock = (this._previewClock || 0) + delta;

    const clip = this._clip();
    if (this.playing && clip) {
      this.previewTime += delta;
      if (clip.loop !== false) {
        if (this.previewTime > clip.durationMs) this.previewTime %= clip.durationMs;
      } else if (this.previewTime > clip.durationMs) {
        this.previewTime = clip.durationMs;
        this.playing = false;
        document.getElementById('se-play').textContent = '▶ 播放';
      }
      this._renderTimeline();
    }
    this._draw();
    requestAnimationFrame(() => this._loop());
  }
}

export default SkeletonEditor;
