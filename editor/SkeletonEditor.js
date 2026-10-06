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
    this._drag = null;               // { kind: 'move'|'rotate'|'pan', ... }
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
    $('se-slot-add').addEventListener('click', () => this._addSlot());
    $('se-slot-del').addEventListener('click', () => this._deleteSlot());

    this.el.clipSelect.addEventListener('change', () => this._selectClip(this.el.clipSelect.value));
    $('se-clip-add').addEventListener('click', () => this._addClip());
    $('se-clip-del').addEventListener('click', () => this._deleteClip());
    this.el.clipDuration.addEventListener('change', () => this._setClipDuration());
    this.el.clipLoop.addEventListener('change', () => this._setClipLoop());
    $('se-play').addEventListener('click', () => this._togglePlay());
    $('se-rewind').addEventListener('click', () => { this.previewTime = 0; this._renderTimeline(); });
    $('se-keyframe').addEventListener('click', () => this._keySelectedBone());
    $('se-key-del').addEventListener('click', () => this._deleteSelectedKey());
    $('se-track-add').addEventListener('click', () => this._addTrack());
    $('se-track-del').addEventListener('click', () => this._removeTrack());

    const canvas = this.el.canvas;
    canvas.addEventListener('mousedown', event => this._onCanvasDown(event));
    window.addEventListener('mousemove', event => this._onCanvasMove(event));
    window.addEventListener('mouseup', () => { this._drag = null; });
    canvas.addEventListener('wheel', event => this._onCanvasWheel(event), { passive: false });
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('keydown', event => {
      if (event.key === 'k' || event.key === 'K') this._keySelectedBone();
      if (event.key === ' ') { event.preventDefault(); this._togglePlay(); }
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
    this._fitView();
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

  _addBone() {
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
    this.doc.slots = this.doc.slots.filter(slot => slot.id !== this.selectedSlot);
    this.selectedSlot = null;
    this._markDirty();
    this._afterDocChange();
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
    if (this.doc.clips.length <= 1) { this._toast('至少保留一个剪辑', true); return; }
    this.doc.clips = this.doc.clips.filter(clip => clip.name !== this.currentClip);
    this.currentClip = this.doc.clips[0].name;
    this._markDirty();
    this._afterDocChange();
  }

  _setClipDuration() {
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

    // 槽位附件预览（z 顺序）
    for (const slot of this.runtime.slots) {
      const attachment = slot.attachment;
      if (!attachment || attachment.type === 'empty') continue;
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

    // 骨骼线
    for (const bone of this.doc.bones || []) {
      const boneWorld = world.get(bone.id);
      if (!boneWorld) continue;
      const start = this._worldToScreen(boneWorld.x, boneWorld.y);
      const tipX = boneWorld.x + Math.cos(boneWorld.rad) * (bone.length || 0) * boneWorld.sx;
      const tipY = boneWorld.y + Math.sin(boneWorld.rad) * (bone.length || 0) * boneWorld.sy;
      const end = this._worldToScreen(tipX, tipY);
      const selected = bone.id === this.selectedBone;
      ctx.strokeStyle = selected ? '#4CAF50' : 'rgba(200,210,255,0.75)';
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.fillStyle = selected ? '#4CAF50' : '#7ec8ff';
      ctx.beginPath();
      ctx.arc(start.x, start.y, selected ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 选中骨骼旋转手柄环
    if (this.selectedBone) {
      const boneWorld = world.get(this.selectedBone);
      if (boneWorld) {
        const anchor = this._worldToScreen(boneWorld.x, boneWorld.y);
        ctx.strokeStyle = 'rgba(255,212,121,0.9)';
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
      const frames = attachment.frames || [];
      if (frames.length === 0) return null;
      const slotFrame = this._sequenceFrameIndex(attachment);
      const rect = frames[slotFrame % frames.length];
      return { element, sx: rect.sx, sy: rect.sy, sw: rect.sw, sh: rect.sh };
    }
    return null;
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
    if (!this.runtime) return;
    const world = this._boneWorldTransforms();
    // 旋转环优先判定（仅对当前选中骨骼：环带 16~32px，避免与原点命中半径重叠）
    if (this.selectedBone) {
      const bone = this._boneById(this.selectedBone);
      const boneWorld = world.get(this.selectedBone);
      if (bone && boneWorld) {
        const anchor = this._worldToScreen(boneWorld.x, boneWorld.y);
        const distance = Math.hypot(mx - anchor.x, my - anchor.y);
        if (distance > 15 && distance < 33) {
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
    // 命中骨骼原点（优先近者）
    let hit = null;
    let hitDistance = 14;
    for (const bone of this.doc.bones || []) {
      const boneWorld = world.get(bone.id);
      if (!boneWorld) continue;
      const anchor = this._worldToScreen(boneWorld.x, boneWorld.y);
      const distance = Math.hypot(anchor.x - mx, anchor.y - my);
      if (distance < hitDistance) { hit = bone; hitDistance = distance; }
    }
    if (hit) {
      this.selectedBone = hit.id;
      this.selectedSlot = null;
      this._renderBoneTree();
      this._renderSlotList();
      this._renderInspector();
      const boneWorld = world.get(hit.id);
      const anchor = this._worldToScreen(boneWorld.x, boneWorld.y);
      this._drag = {
        kind: 'move', // 旋转由上方环带判定处理，原点命中一律为移动
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

  _parentWorldTransform(world, bone) {
    if (!bone.parent) return { x: 0, y: 0, rad: 0, sx: 1, sy: 1, rot: 0 };
    return world.get(bone.parent) || { x: 0, y: 0, rad: 0, sx: 1, sy: 1, rot: 0 };
  }

  _onCanvasMove(event) {
    if (!this._drag) return;
    const rect = this.el.canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    if (this._drag.kind === 'pan') {
      this.view.ox = this._drag.ox + (mx - this._drag.startX);
      this.view.oy = this._drag.oy + (my - this._drag.startY);
      return;
    }
    const bone = this._boneById(this._drag.boneId);
    if (!bone) return;
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
        bone.x = nextX;
        bone.y = nextY;
        this._markDirty();
        this.runtime = parseSkeletonAsset(structuredClone(this.doc));
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
        bone.rot = nextRot;
        this._markDirty();
        this.runtime = parseSkeletonAsset(structuredClone(this.doc));
      }
    }
    this._renderInspector();
    this._renderTimeline();
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
    container.innerHTML = bones.map(bone => `
      <div class="se-bone-item ${bone.id === this.selectedBone ? 'selected' : ''}" data-id="${bone.id}">
        <span class="depth">${'· '.repeat(depth(bone.id))}</span>
        <span class="name">${bone.id}${bone.parent ? ` ⇐ ${bone.parent}` : ' (根)'}</span>
      </div>
    `).join('');
    for (const item of container.querySelectorAll('.se-bone-item')) {
      item.addEventListener('click', () => {
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
    container.innerHTML = slots.length > 0 ? slots.map(slot => `
      <div class="se-slot-item ${slot.id === this.selectedSlot ? 'selected' : ''}" data-id="${slot.id}">
        <span class="name">${slot.id} · ${slot.attachment?.type || 'empty'} · bone:${slot.bone} · z${slot.z}</span>
      </div>
    `).join('') : '<div class="se-empty">暂无槽位</div>';
    for (const item of container.querySelectorAll('.se-slot-item')) {
      item.addEventListener('click', () => {
        this.selectedSlot = item.dataset.id;
        this.selectedBone = this._slotById(this.selectedSlot)?.bone || this.selectedBone;
        this._renderSlotList();
        this._renderBoneTree();
        this._renderInspector();
      });
    }
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
      <div class="se-empty" style="text-align:left;">画布：拖原点移动 / 沿黄环拖旋转 / 滚轮缩放 / 右键平移</div>
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
    this.el.inspectorTitle.textContent = `槽位 · ${slot.id}`;
    const attachment = slot.attachment || { type: 'empty' };
    const imageOptions = [...this.imageCatalog.keys()]
      .map(id => `<option value="${id}" ${attachment.assetId === id ? 'selected' : ''}>${id}</option>`)
      .join('');
    const boneOptions = (this.doc.bones || [])
      .map(bone => `<option value="${bone.id}" ${slot.bone === bone.id ? 'selected' : ''}>${bone.id}</option>`)
      .join('');
    const isSequence = attachment.type === 'sequence';
    body.innerHTML = `
      <div class="row"><label>ID</label><input type="text" id="se-slot-id" value="${slot.id}"></div>
      <div class="row"><label>骨骼</label><select id="se-slot-bone">${boneOptions}</select></div>
      <div class="row"><label>z 序</label><input type="number" id="se-slot-z" step="1" value="${slot.z}"></div>
      <div class="se-attachment-box">
        <div class="row"><label>附件类型</label>
          <select id="se-att-type">
            ${['empty', 'image', 'slice', 'sequence'].map(type => `<option value="${type}" ${attachment.type === type ? 'selected' : ''}>${type}</option>`).join('')}
          </select>
        </div>
        ${attachment.type === 'empty' ? '' : `
        <div class="row"><label>图片ID</label><select id="se-att-asset">${imageOptions}</select></div>
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
    $('se-slot-bone').addEventListener('change', event => { slot.bone = event.target.value; this._markDirty(); this._afterDocChange(); });
    $('se-slot-z').addEventListener('change', event => { slot.z = Number(event.target.value) || 0; this._markDirty(); this._afterDocChange(); });
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
        this.previewTime = Math.max(0, Math.min(duration, ((event.clientX - laneRect.left) / laneRect.width) * duration));
        this._renderTimeline();
      });
    }
    for (const keyElement of body.querySelectorAll('.se-tl-key')) {
      keyElement.addEventListener('mousedown', event => {
        event.stopPropagation();
        this.selectedKey = { bone: keyElement.dataset.bone, index: Number(keyElement.dataset.index) };
        document.getElementById('se-key-del').disabled = false;
        this._renderTimeline();
      });
    }
    if (!this.selectedKey) document.getElementById('se-key-del').disabled = true;
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
