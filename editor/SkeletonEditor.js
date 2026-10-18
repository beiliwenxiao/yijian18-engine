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
import { buildPartRegistry } from '../src/animation/SkeletonPartResolver.js';
import { validateSkeletonAsset } from '../src/core/validation/SkeletonAssetValidator.js';
import { SkeletonEditorCommandService } from './SkeletonEditorCommandService.js';

const DEG2RAD = Math.PI / 180;

/** 引擎内置骨架模板（assets/skeletons/templates/<id>.json，tpl.* 约定前缀；生成脚本 scripts/generate-skeleton-templates.mjs）。 */
const SKELETON_TEMPLATES = [
  'tpl.humanoid', 'tpl.wolf', 'tpl.horse', 'tpl.mounted',
  'tpl.siege_ram', 'tpl.siege_catapult', 'tpl.siege_tower'
];

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
    this.partCatalog = new Map();    // partId -> skeletonPart 定义（内容库 skeletonParts）
    this._selectedImageId = '';      // 图片库当前选中
    this._selectedPartId = '';       // 部件库当前选中
    this.skeletonEntries = [];       // manifest 中 mode==='skeleton' 的条目

    // 选择与预览状态（多选集合先于 selectedBone/selectedSlot 初始化——后者 setter 会同步集合）
    this.selectedBones = new Set();
    this.selectedSlots = new Set();
    this._selectedBoneId = null;
    this._selectedSlotId = null;
    this.selectedBone = null;
    this.selectedSlot = null;
    this.selectedKey = null;         // { bone, index }
    this._multiSelectedKeys = new Map(); // 时间线关键帧多选：boneId -> Set(index)
    this.currentClip = null;
    this.previewTime = 0;
    this.playing = false;
    this._lastFrameAt = 0;

    // 画布视图
    this.view = { scale: 1, ox: 0, oy: 0 };
    this._drag = null;               // 拖拽态：{ kind: 'move'|'attach-move'|'attach-scale'|'bone-scale'|'object-rotate'|'tip-length'|'pan'|'marquee', ... }
    this._mirrorPreview = false;     // 镜像预览：沿角色中轴翻转画布（模拟 sprite.flipX 左向渲染）
    this._hideWeaponSlots = false;   // 武器装备预览开关：true=编辑器画布隐藏手持+背挂武器（纯预览，不写数据）
    this._hideDirGhosts = false;     // 辅助线开关：true=隐藏方向幽灵预览框（正/侧/背虚线框），侧背视图调试时降噪
    this._libDrag = null;            // 库条目拖入画布的组合预览态：{ partId, assetId, mx, my, dropWorld, hoverBone }
    this._partCheckResult = null;    // 部件体检结果（会话态）：{ rows, at }
    this._alphaBoundsCache = new Map(); // 附件非透明像素包围盒缓存（key: assetId|srcRect）
    this._alphaSampleCanvas = null;     // alpha 扫描离屏画布
    // 图层式编辑辅助（会话态，不写入骨骼 JSON）：
    //   隐藏=仅编辑器预览不画（对齐场景编辑器物品级 👁 语义）；锁定=画布点选/拖拽跳过（防误触）。
    //   骨骼级按钮级联作用于子孙骨骼。
    this._hiddenSlots = new Set();
    this._lockedSlots = new Set();
    this._hiddenBones = new Set();
    this._lockedBones = new Set();
    // 骨骼树折叠状态（会话态，不写入骨骼 JSON）
    this._collapsedBones = new Set();
    // 编辑模式（会话态）：'animate' 动画（骨骼驱动图片+实时打关键帧）| 'setup' 装配（移骨骼图片不动，反算挂点）
    this.editMode = 'animate';
    // 方向预览（会话态）：'down'|'side'|'up'——按运行时 HEAD_SLOTS 规则切头部三态槽位预览可见性
    this.previewDirection = 'down';
    // 显示模式（会话态）：'all' 图片+骨架 | 'bones' 仅骨架（调动作） | 'images' 仅图片（查外观）
    this.displayMode = 'all';
    // 统一手势状态（取代移动/旋转/缩放模式切换）：
    // _rotPivot：用户点选的小方框（旋转圆心）{ targetId, handleKey }；_hoverRotCorner：悬停的角手柄（画旋转箭头）
    this._rotPivot = null;
    this._hoverRotCorner = null;
    // 编辑操作状态：抓手平移模式（开启后左键拖动画布）与挂件复制剪贴板
    this._panMode = false;
    this._clipboard = null;
    // 模板编辑态：true=当前打开的是 tpl.* 模板文档（保存写回 templates/，不动 Manifest）
    this.editingTemplate = false;
    // 动作模板索引（anim-presets/index.json，懒加载）与拓扑骨集缓存
    this.presetIndex = null;
    this._tplBoneSets = null;
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

  // 主选中 getter/setter：直接赋值 = 单选语义（同步多选集合），兼容既有代码
  get selectedBone() { return this._selectedBoneId; }
  set selectedBone(id) {
    this._selectedBoneId = id || null;
    this.selectedBones = id ? new Set([id]) : new Set();
  }
  get selectedSlot() { return this._selectedSlotId; }
  set selectedSlot(id) {
    this._selectedSlotId = id || null;
    this.selectedSlots = id ? new Set([id]) : new Set();
  }

  /** Ctrl 加选/减选骨骼（返回是否新选中）。 */
  _toggleBoneInSelection(id) {
    if (this.selectedBones.has(id)) {
      this.selectedBones.delete(id);
      if (this._selectedBoneId === id) this._selectedBoneId = [...this.selectedBones].at(-1) || null;
      return false;
    }
    this.selectedBones.add(id);
    this._selectedBoneId = id;
    return true;
  }

  /** Ctrl 加选/减选槽位。 */
  _toggleSlotInSelection(id) {
    if (this.selectedSlots.has(id)) {
      this.selectedSlots.delete(id);
      if (this._selectedSlotId === id) this._selectedSlotId = [...this.selectedSlots].at(-1) || null;
      return false;
    }
    this.selectedSlots.add(id);
    this._selectedSlotId = id;
    return true;
  }

  /** 清空多选集合与主选中。 */
  _clearSelection() {
    this.selectedBones.clear();
    this.selectedSlots.clear();
    this._selectedBoneId = null;
    this._selectedSlotId = null;
    this._rotPivot = null;
    this._hoverRotCorner = null;
  }

  async init() {
    this._bindDom();
    await this._loadManifest();
    this._newDoc();
    this._refreshAssetSelect();
    this._refreshTemplateSelect();
    this._loop();
    // 初始化按钮高亮状态
    this._refreshModeButtons();
    this._refreshDirectionButtons();
    this._setLibTab('parts'); // 默认显示部件库
  }

  _bindDom() {
    const $ = id => document.getElementById(id);
    this.el = {
      assetSelect: $('se-asset-select'), skeletonId: $('se-skeleton-id'),
      templateSelect: $('se-template-select'),
      metaWidth: $('se-meta-width'), metaHeight: $('se-meta-height'),
      dirty: $('se-dirty'), toast: $('se-toast'), save: $('se-save'),
      boneTree: $('se-bone-tree'), slotList: $('se-slot-list'),
      inspectorTitle: $('se-inspector-title'), inspectorBody: $('se-inspector-body'),
      canvas: $('se-canvas'),
      clipSelect: $('se-clip-select'), clipDuration: $('se-clip-duration'), clipLoop: $('se-clip-loop'),
      tlBody: $('se-tl-body'), trackBoneSelect: $('se-track-bone-select')
    };

    this.el.assetSelect.addEventListener('change', () => this._onAssetSelect());
    this.el.templateSelect.addEventListener('change', () => {
      // 选中模板即直接打开模板文档（可编辑，保存写回 templates/，改模板不影响已创建对象）
      if (this.el.templateSelect.value) this._onTemplateSelect();
      else this._refreshAssetSelect();
    });
    $('se-new-from-template').addEventListener('click', () => this._newFromTemplate());
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
    // 部件库 / 素材 Tab 切换
    $('se-tab-parts').addEventListener('click', () => this._setLibTab('parts'));
    $('se-tab-assets').addEventListener('click', () => this._setLibTab('assets'));
    $('se-tab-presets').addEventListener('click', () => this._setLibTab('presets'));
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
    $('se-mode-setup').addEventListener('click', () => this._setEditMode('setup'));
    $('se-mode-animate').addEventListener('click', () => this._setEditMode('animate'));
    $('se-dir-down').addEventListener('click', () => this._setPreviewDirection('down'));
    $('se-dir-side').addEventListener('click', () => this._setPreviewDirection('side'));
    $('se-dir-up').addEventListener('click', () => this._setPreviewDirection('up'));
    $('se-disp-all').addEventListener('click', () => this._setDisplayMode('all'));
    $('se-disp-bones').addEventListener('click', () => this._setDisplayMode('bones'));
    $('se-disp-images').addEventListener('click', () => this._setDisplayMode('images'));
    // 编辑操作按钮组（对齐场景编辑器）：全选/复制/粘贴/撤销/重做/适配视图/抓手
    $('se-select-all').addEventListener('click', () => this._selectAll());
    $('se-copy').addEventListener('click', () => this._copySelection());
    $('se-paste').addEventListener('click', () => this._pasteSelection());
    $('se-undo').addEventListener('click', () => this._undo());
    $('se-redo').addEventListener('click', () => this._redo());
    $('se-fit').addEventListener('click', () => this._fitView());
    // 工具模式（对齐场景编辑器）：↖ 选择（默认）与 🖐️ 抓手平移互斥
    $('se-select').addEventListener('click', () => this._setPanMode(false));
    $('se-pan').addEventListener('click', () => this._setPanMode(!this._panMode));
    this._refreshToolButtons();
    $('se-align-ground').addEventListener('click', () => this._alignFeetToGround());
    $('se-reload-data').addEventListener('click', () => this._reloadDocFromDisk());
    // 镜像预览：换算层翻转（_worldToScreen/_screenToWorld），绘制/手柄/命中自动跟随
    $('se-mirror-preview').addEventListener('click', () => {
      this._mirrorPreview = !this._mirrorPreview;
      const button = $('se-mirror-preview');
      button.style.background = this._mirrorPreview ? '#2a4a3e' : '';
      button.style.borderColor = this._mirrorPreview ? '#3fbf7f' : '';
      this._draw();
    });
    // 武器装备预览开关：编辑器画布隐藏/显示手持+背挂武器（纯预览，不影响骨骼数据）
    $('se-disp-weapons').addEventListener('click', () => {
      this._hideWeaponSlots = !this._hideWeaponSlots;
      const button = $('se-disp-weapons');
      button.style.background = this._hideWeaponSlots ? '#4a3a2a' : '';
      button.style.borderColor = this._hideWeaponSlots ? '#bf8f3f' : '';
      button.style.textDecoration = this._hideWeaponSlots ? 'line-through' : '';
      this._draw();
    });
    // 辅助线开关：隐藏方向幽灵预览框（正/侧/背虚线框）——侧面/背面视图虚线过多时降噪
    $('se-aux-lines').addEventListener('click', () => {
      this._hideDirGhosts = !this._hideDirGhosts;
      const button = $('se-aux-lines');
      button.style.background = this._hideDirGhosts ? '#4a3a2a' : '';
      button.style.borderColor = this._hideDirGhosts ? '#bf8f3f' : '';
      button.style.textDecoration = this._hideDirGhosts ? 'line-through' : '';
      this._draw();
    });
    // 逐帧步进（步长 = 剪辑时长 / 12）：单击走一帧；按住 300ms 后连续逐帧播放。
    // 步进会暂停自动播放，否则 previewTime 被播放循环每帧覆盖、步进无效。
    this._bindFrameStepper($('se-frame-prev'), -1);
    this._bindFrameStepper($('se-frame-next'), +1);
    $('se-time-input').addEventListener('change', event => {
      this.previewTime = Math.max(0, Math.min(this._clipDuration(), Number(event.target.value) || 0));
      this._renderTimeline();
    });
    $('se-keyframe').addEventListener('click', () => this._keySelectedBone());
    $('se-loop-tie').addEventListener('click', () => this._appendLoopTieKeys());
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
      this._libDrag = null;
    });
    window.addEventListener('keydown', event => this._onKeyDown(event));
    canvas.addEventListener('wheel', event => this._onCanvasWheel(event), { passive: false });
    // 右键画布：命中图片附件或骨骼 → 选中并弹出右键菜单（模式切换 + 图片操作，对齐场景编辑器交互）
    canvas.addEventListener('contextmenu', event => {
      event.preventDefault();
      this._removeContextMenu();
      if (!this.runtime) return;
      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const world = this._boneWorldTransforms();
      const hitSlotId = this._hitAttachment(mx, my, world);
      const hitBone = hitSlotId ? null : this._pickBone(mx, my, world);
      if (!hitSlotId && !hitBone) return;
      if (hitSlotId) {
        const slot = this._slotById(hitSlotId);
        const assetId = slot?.attachment?.assetId || '';
        this.selectedSlot = hitSlotId;
        this._renderBoneTree();
        this._renderSlotList();
        this._renderInspector();
        // 图层序操作（对齐场景编辑器）：置顶/上一层/下一层/置底
        const items = [...this._buildZOrderMenuItems(hitSlotId), { separator: true }];
        if (assetId && this.imageCatalog.has(assetId)) {
          items.push(...this._buildImageMenuItems(assetId));
          this._showContextMenu(event, items, this._imageEntryPath(assetId));
        } else {
          this._showContextMenu(event, items, slot?.id || '');
        }
        return;
      }
      // 右键骨骼：仅选中（变换已统一为直接手势：拖=移动/方框=缩放/角外圈=旋转，无菜单项）
      this.selectedBone = hitBone.id;
      this.selectedSlot = null;
      this._rotPivot = null;
      this._renderBoneTree();
      this._renderSlotList();
      this._renderInspector();
    });

    // 拖拽组合：库条目拖入画布 → ghost 预览跟随鼠标 + 最近骨骼吸附高亮，松手即组合（落点=挂点位置）
    canvas.addEventListener('dragover', event => {
      if (!this._libDrag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      const rect = canvas.getBoundingClientRect();
      this._libDrag.mx = event.clientX - rect.left;
      this._libDrag.my = event.clientY - rect.top;
      this._libDrag.dropWorld = this._screenToWorld(this._libDrag.mx, this._libDrag.my);
      this._libDrag.hoverBone = this._pickBoneOrigin(this._libDrag.mx, this._libDrag.my, this._boneWorldTransforms(), 64)
        || this.selectedBone
        || this.doc.bones?.[0]?.id
        || null;
    });
    canvas.addEventListener('drop', event => {
      const drag = this._libDrag;
      this._libDrag = null;
      if (!drag) return;
      event.preventDefault();
      const boneId = drag.hoverBone || this.selectedBone || this.doc.bones?.[0]?.id;
      if (!boneId) { this._toast('画布上没有骨骼可挂', true); return; }
      const partId = event.dataTransfer.getData('text/se-part');
      if (partId && this.partCatalog.has(partId)) {
        this._bindPartAt(partId, boneId, drag.dropWorld);
        return;
      }
      const assetId = drag.assetId || event.dataTransfer.getData('text/se-asset');
      if (assetId) this._bindAssetAt(assetId, boneId, drag.dropWorld);
    });
    canvas.addEventListener('dragleave', () => { this._libDrag = null; });

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
      // Ctrl+C / Ctrl+V：挂件复制粘贴（对齐场景编辑器快捷键习惯）
      if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
        this._copySelection();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'v' || event.key === 'V')) {
        this._pasteSelection();
        return;
      }
      if (event.key === 'Escape' && this._sliceMode) {
        this._exitSliceMode();
        return;
      }
      // Esc 退出抓手平移模式（回到选择）
      if (event.key === 'Escape' && this._panMode) {
        this._setPanMode(false);
        return;
      }
      // Esc 取消进行中的拖拽（附件跟随中按 Esc 立即放手）
      if (event.key === 'Escape' && this._drag) {
        this._drag = null;
        return;
      }
      if (event.key === 'k' || event.key === 'K') this._keySelectedBone();
      if (event.key === ' ') { event.preventDefault(); this._togglePlay(); }
      // Delete/Backspace 统一由 _onKeyDown 处理（含关键帧优先与多选），避免双重触发
    });
    window.addEventListener('resize', () => this._fitView());
  }

  async _loadManifest() {
    try {
      const [manifest, library] = await Promise.all([
        this.commands.fetchManifest(this.gameRoot),
        this.commands.fetchLibrary(this.gameRoot).catch(() => null) // 内容库缺失不阻塞
      ]);
      this.partCatalog = buildPartRegistry(library?.skeletonParts || []);
      this.skeletonEntries.length = 0;   // 可重入（刷新数据时重建清单），防重复累积
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
      this._renderPartLib();
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
      }).join('')
      + '<optgroup label="骨架模板（tpl.*，可编辑）">'
      + SKELETON_TEMPLATES.map(id => `<option value="${id}">${id}</option>`).join('')
      + '</optgroup>';
    if (current && [...select.options].some(option => option.value === current)) select.value = current;
  }

  /* ---------------- 骨架模板（tpl.*：纯便利起点，使用即深拷贝，零数据关联） ---------------- */

  /** 模板下拉（与资产下拉同列表，独立高亮）。 */
  _refreshTemplateSelect() {
    const select = this.el.templateSelect;
    select.innerHTML = '<option value="">选择模板…</option>'
      + SKELETON_TEMPLATES.map(id => `<option value="${id}">${id}</option>`).join('');
  }

  /** 拉取模板 JSON。 */
  async _fetchTemplate(templateId) {
    const response = await fetch(`/${this.gameRoot}/assets/skeletons/templates/${templateId}.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /** 资产下拉选中 tpl.* → 打开模板文档（直接编辑模板本身）。 */
  async _onTemplateSelect() {
    const templateId = this.el.templateSelect.value;
    if (this.dirty && !confirm('当前骨骼未保存，切换将丢失修改，确定？')) {
      this._refreshTemplateSelect();
      return;
    }
    if (!templateId) return;
    try {
      const doc = await this._fetchTemplate(templateId);
      this._adoptDoc(doc, { template: true });
      this._toast(`已打开模板 ${templateId}（可编辑；保存写回模板文件，不影响已创建的骨骼）`);
    } catch (error) {
      this._toast(`模板读取失败：${error.message}`, true);
    }
  }

  /** 「＋新建自模板」：模板深拷贝 → 改新 ID → 标脏待保存（保存后才落盘为新资产）。 */
  async _newFromTemplate() {
    if (this.dirty && !confirm('当前骨骼未保存，切换将丢失修改，确定？')) return;
    const templateId = this.el.templateSelect.value;
    if (!templateId) {
      this._toast('请先在上拉框选择一个骨架模板', true);
      return;
    }
    let template;
    try {
      template = await this._fetchTemplate(templateId);
    } catch (error) {
      this._toast(`模板读取失败：${error.message}`, true);
      return;
    }
    const suggested = `skeleton.${templateId.replace(/^tpl\./, '')}`;
    const newId = (prompt('新骨骼资产 ID（保存后即文件名）：', suggested) || '').trim();
    if (!newId) return;
    if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(newId)) {
      this._toast('ID 只能包含字母、数字、点、下划线、短横线，且以字母开头', true);
      return;
    }
    if (newId === templateId) {
      this._toast('新 ID 不能与模板 ID 相同', true);
      return;
    }
    // 使用即深拷贝：此后 doc 与模板无任何引用/关联
    const doc = structuredClone(template);
    doc.skeletonId = newId;
    this._adoptDoc(doc, { newId });
    this.dirty = true;
    if (this.el.dirty) this.el.dirty.style.display = '';
    this._toast(`已从模板 ${templateId} 创建 ${newId}（深拷贝，与模板无关联）——点「保存」落盘`);
  }

  /** 文档接管统一入口：重置选择/播放态，刷新面板与输入框。options.template=模板编辑态。 */
  _adoptDoc(doc, { template = false, newId = null } = {}) {
    this.doc = doc;
    this.editingTemplate = template;
    this._clearSelection();
    this.selectedBone = doc.bones?.[0]?.id || null;
    this._selectedBoneId = this.selectedBone;
    this.selectedSlot = null;
    this.selectedKey = null;
    this.currentClip = doc.defaultClip || doc.clips?.[0]?.name || null;
    this.previewTime = 0;
    this.playing = false;
    this.dirty = false;
    if (this.el.dirty) this.el.dirty.style.display = 'none';
    if (newId) this.doc.skeletonId = newId;
    this._afterDocChange();
    this.el.skeletonId.value = this.doc.skeletonId || '';
    this.el.metaWidth.value = this.doc.meta?.width ?? 100;
    this.el.metaHeight.value = this.doc.meta?.height ?? 160;
    this.el.skeletonId.disabled = !newId; // 保存过/模板：ID 固定（文件名即 ID）；新资产可改
  }

  /* ---------------- 文档管理 ---------------- */

  _newDoc() {
    this.editingTemplate = false;
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
      this._adoptDoc(doc); // 普通资产：非模板编辑态
      this._toast(`已加载 ${skeletonId}`);
    } catch (error) {
      this._toast(`骨骼资产读取失败：${error.message}`, true);
    }
  }

  /**
   * 从磁盘重新加载当前骨骼资产（绕过浏览器缓存），丢弃本地未保存修改。
   * 场景：外部脚本改动骨骼 JSON 后，点此立即生效，无需硬刷新页面。
   */
  async _reloadDocFromDisk() {
    if (!this.doc?.skeletonId) { this._toast('当前没有骨骼文档可刷新', true); return; }
    const entry = this.skeletonEntries.find(candidate => (candidate.imageId || candidate.assetId) === this.doc.skeletonId);
    if (!entry) { this._toast('当前文档不是已保存的资产（模板/新建），无法刷新', true); return; }
    if (this.dirty && !confirm('当前有未保存修改，刷新数据将被磁盘内容覆盖，确定？')) return;
    try {
      await this._loadManifest();   // 同步重建图片/部件/骨骼清单（外部新增的资产登记一并生效）
      const response = await fetch(`/${this.gameRoot}/${entry.runtime2D.path}?t=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const doc = await response.json();
      this._adoptDoc(doc); // 内部已重置 dirty / 撤销栈语义并全面板刷新
      this._toast(`已从磁盘刷新 ${this.doc.skeletonId}`);
    } catch (error) {
      this._toast(`刷新数据失败：${error.message}`, true);
    }
  }

  _onAssetSelect() {
    const value = this.el.assetSelect.value;
    if (this.dirty && !confirm('当前骨骼未保存，切换将丢失修改，确定？')) {
      this._refreshAssetSelect();
      return;
    }
    if (value.startsWith('tpl.')) {
      this.el.templateSelect.value = value; // 两处下拉联动
      this._onTemplateSelect();
    } else if (value) {
      this._loadDoc(value);
    } else {
      this._newDoc();
    }
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

  /** 拖拽首次产生移动时才快照历史（纯点击不入撤销栈，撤销不再被无效点击塞满）。 */
  _ensureDragHistory() {
    if (!this._drag || this._drag.historyPushed) return;
    this._drag.historyPushed = true;
    this._pushHistory();
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

  /* ---------------- 编辑操作（对齐场景编辑器）：全选 / 复制 / 粘贴 / 抓手 ---------------- */

  /** 全选：所有未锁定未隐藏骨骼 + 可交互可见挂件槽位。 */
  _selectAll() {
    if (!this.doc) return;
    const bones = (this.doc.bones || [])
      .filter(bone => !this._isBoneLocked(bone.id) && !this._isBoneHidden(bone.id));
    this.selectedBones = new Set(bones.map(bone => bone.id));
    this._selectedBoneId = bones[0]?.id || null;
    const slots = (this.runtime?.slots || []).filter(slot => {
      const attachment = slot.attachment;
      if (!attachment || attachment.type === 'empty' || attachment.visible === false) return false;
      return !this._isSlotInteractiveLocked(slot.id, slot.bone) && !this._isSlotPreviewHidden(slot.id, slot.bone);
    });
    this.selectedSlots = new Set(slots.map(slot => slot.id));
    this._selectedSlotId = slots[0]?.id || null;
    this._rotPivot = null;
    this._renderBoneTree();
    this._renderSlotList();
    this._renderInspector();
    this._toast(`已全选 ${this.selectedBones.size} 根骨骼、${this.selectedSlots.size} 个挂件`);
  }

  /** 复制选中挂件槽位（深拷贝 attachment 与绑定信息到内部剪贴板）。 */
  _copySelection() {
    const slots = [...this.selectedSlots]
      .map(id => this._slotById(id))
      .filter(slot => slot?.attachment && slot.attachment.type !== 'empty');
    if (!slots.length) { this._toast('请先选中要复制的挂件', true); return; }
    this._clipboard = {
      kind: 'slots',
      items: slots.map(slot => ({
        id: slot.id,
        bone: slot.bone,
        z: slot.z ?? 0,
        attachment: structuredClone(slot.attachment)
      }))
    };
    this._toast(`已复制 ${slots.length} 个挂件（粘贴到当前选中骨骼）`);
  }

  /** 粘贴：挂件挂到当前选中骨骼（无选中则原骨骼），偏移 +6px 防重叠，槽位 ID 与 z 自动去重。 */
  _pasteSelection() {
    if (!this.doc || this._clipboard?.kind !== 'slots' || !this._clipboard.items.length) {
      this._toast('剪贴板没有可粘贴的挂件', true);
      return;
    }
    this._pushHistory();
    const bones = this.doc.bones || [];
    const slots = this.doc.slots || [];
    let maxZ = slots.reduce((z, slot) => Math.max(z, slot.z ?? 0), 0);
    const existing = new Set(slots.map(slot => slot.id));
    const targetBone = this.selectedBone || this._clipboard.items[0].bone;
    if (!bones.some(bone => bone.id === targetBone)) { this._toast('粘贴目标骨骼不存在', true); return; }
    let index = 1;
    for (const item of this._clipboard.items) {
      let newId = `${item.id}_copy${index > 1 ? index : ''}`;
      while (existing.has(newId)) newId = `${item.id}_copy${++index}`;
      existing.add(newId);
      const attachment = structuredClone(item.attachment);
      attachment.x = Math.round(((attachment.x || 0) + 6) * 10) / 10;
      attachment.y = Math.round(((attachment.y || 0) + 6) * 10) / 10;
      slots.push({
        id: newId,
        bone: targetBone,
        z: ++maxZ,
        attachment
      });
      index++;
    }
    this._markDirty();
    this.selectedSlots = new Set(slots.slice(-this._clipboard.items.length).map(slot => slot.id));
    this._selectedSlotId = slots[slots.length - 1]?.id || null;
    this._afterDocChange();
    this._toast(`已粘贴 ${this._clipboard.items.length} 个挂件到 ${SkeletonEditor._displayName(targetBone)}`);
  }

  /** 工具模式切换：select（默认，点选/拖动骨骼与挂件）与 pan（抓手平移）互斥，两按钮同步高亮。 */
  _setPanMode(active) {
    this._panMode = active === true;
    this._refreshToolButtons();
    this.el.canvas.style.cursor = this._panMode ? 'grab' : '';
    this._toast(this._panMode ? '抓手模式：左键拖动画布平移' : '选择模式：点选/拖动骨骼与挂件');
  }

  /** 选择/抓手按钮高亮同步（与场景编辑器工具组同款式）。 */
  _refreshToolButtons() {
    const selectButton = document.getElementById('se-select');
    const panButton = document.getElementById('se-pan');
    if (selectButton) {
      selectButton.style.background = this._panMode ? '' : '#2a4a3e';
      selectButton.style.borderColor = this._panMode ? '' : '#3fbf7f';
    }
    if (panButton) {
      panButton.style.background = this._panMode ? '#2a4a3e' : '';
      panButton.style.borderColor = this._panMode ? '#3fbf7f' : '';
    }
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
    // 武器装备预览开关：手持武器（id 以 weapon 开头）+ 背挂武器（挂 back 骨骼）可整体隐藏，
    // 纯编辑器预览态，不写骨骼数据、不影响游戏实际显示（运行时由 mapper 按背包/装备驱动）
    if (this._hideWeaponSlots && (slotId.startsWith('weapon') || boneId === 'back')) return true;
    return this._hiddenSlots.has(slotId) || this._isBoneHidden(boneId);
  }

  /** 槽位是否被锁定不可点选（槽位级锁定 或 所属骨骼链被锁定）。 */
  _isSlotInteractiveLocked(slotId, boneId) {
    return this._lockedSlots.has(slotId) || this._isBoneLocked(boneId);
  }

  /** flat bones → 树节点数组 [{ bone, children }]，保持 bones 数组内的相对顺序。 */
  _buildBoneTree() {
    const nodes = new Map();
    const roots = [];
    for (const bone of this.doc.bones || []) nodes.set(bone.id, { bone, children: [] });
    for (const bone of this.doc.bones || []) {
      const node = nodes.get(bone.id);
      const parentNode = bone.parent ? nodes.get(bone.parent) : null;
      if (parentNode) parentNode.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /** 骨骼有效状态：自身 + 祖先继承（树面板级联图标用）。 */
  _boneEffectiveState(boneId) {
    const selfHidden = this._hiddenBones.has(boneId);
    const selfLocked = this._lockedBones.has(boneId);
    let inheritedHiddenFrom = '';
    let inheritedLockedFrom = '';
    let cursor = this._boneById(boneId)?.parent || null;
    while (cursor) {
      if (!inheritedHiddenFrom && this._hiddenBones.has(cursor)) inheritedHiddenFrom = cursor;
      if (!inheritedLockedFrom && this._lockedBones.has(cursor)) inheritedLockedFrom = cursor;
      cursor = this._boneById(cursor)?.parent || null;
    }
    return {
      selfHidden, selfLocked,
      hidden: selfHidden || !!inheritedHiddenFrom,
      locked: selfLocked || !!inheritedLockedFrom,
      inheritedHiddenFrom, inheritedLockedFrom
    };
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
    // 剪辑名带方向后缀（walk_down 等）→ 联动方向预览，美术所见 = 运行时所得
    const dir = this._directionFromClip(name);
    if (dir) this._setPreviewDirection(dir);
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
    // 按方向分组（down/up/side/无方向）：策划一眼看清六向剪辑缺哪个
    const groups = [['down', '正面'], ['up', '背面'], ['side', '侧面'], ['', '通用']];
    const clips = this.doc.clips || [];
    select.innerHTML = groups.map(([key, label]) => {
      const list = key === ''
        ? clips.filter(clip => !this._directionFromClip(clip.name))
        : clips.filter(clip => this._directionFromClip(clip.name) === key);
      if (!list.length) return '';
      return `<optgroup label="${label}">`
        + list.map(clip => `<option value="${clip.name}">${SkeletonEditor._displayName(clip.name)}</option>`).join('')
        + '</optgroup>';
    }).join('');
    if (this.currentClip) select.value = this.currentClip;
    const clip = this._clip();
    this.el.clipDuration.value = clip?.durationMs ?? 1000;
    this.el.clipLoop.checked = clip?.loop !== false;
    // 轨道骨骼下拉：所有骨骼
    this.el.trackBoneSelect.innerHTML = (this.doc.bones || [])
      .map(bone => `<option value="${bone.id}">${SkeletonEditor._displayName(bone.id)}</option>`).join('');
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
    this._multiSelectedKeys.clear(); // 结构变化：多选 index 失效，清空
    this._markDirty();
    this._afterDocChange();
  }

  _upsertKey(track, key) {
    const existing = track.keys.find(candidate => Math.abs(candidate.t - key.t) <= 5);
    if (existing) {
      Object.assign(existing, Object.fromEntries(Object.entries(key).filter(([, value]) => value !== null)));
      return;
    }
    // 新键补全为完整姿态快照：未显式给出的字段取当前采样值（所见即所得）。
    // 半字段键（如骨骼缩放手柄只写 scale、旋转只写 rot）会让缺省字段在采样时
    // 整段保持另一键的值或回退静止姿态——「调一帧、整段变形」的根因；
    // 补全后每帧只影响相邻两键之间的插值，帧间互不牵连。
    const sampled = this._sampledBoneLocal(track.bone) || {};
    track.keys.push({
      ...key,
      x: key.x ?? sampled.x ?? 0,
      y: key.y ?? sampled.y ?? 0,
      rot: key.rot ?? sampled.rot ?? 0,
      scaleX: key.scaleX ?? sampled.sx ?? 1,
      scaleY: key.scaleY ?? sampled.sy ?? 1
    });
    track.keys.sort((a, b) => a.t - b.t);
  }

  /**
   * 补循环尾帧：在剪辑结尾（t=durationMs）为所有已有轨道补一帧循环闭合帧，
   * 姿态=各自首帧（运行时 sampleField 在末帧贴结尾时 hold 末帧 → 回绕首帧无跳变）。
   * 支撑完整循环动作结构（静止→迈左→交叉→迈右→交叉），替代「尾段隐式回插首帧」
   * 只能做出半步循环的限制；已有结尾帧的轨道跳过（±5ms 容差，不覆盖美术已调姿态）。
   */
  _appendLoopTieKeys() {
    const clip = this._clip();
    if (!clip) { this._toast('无剪辑', true); return; }
    if (clip.loop === false) { this._toast('当前剪辑未开启循环，先勾选「循环」', true); return; }
    const tracks = clip.tracks || [];
    if (!tracks.length) { this._toast('当前剪辑无轨道，先打关键帧建轨道', true); return; }
    const duration = clip.durationMs;
    this._pushHistory();
    let added = 0;
    let skipped = 0;
    for (const track of tracks) {
      const keys = track.keys || [];
      if (!keys.length) { skipped++; continue; }
      if (duration - keys[keys.length - 1].t <= 5) { skipped++; continue; }
      const first = keys[0];
      track.keys.push({
        t: duration,
        x: first.x ?? 0,
        y: first.y ?? 0,
        rot: first.rot ?? 0,
        scaleX: first.scaleX ?? null,
        scaleY: first.scaleY ?? null,
        ease: 'linear'
      });
      added++;
    }
    this._markDirty();
    this._afterDocChange();
    this._toast(added > 0
      ? `已补循环尾帧（t=${duration}ms，姿态=首帧）：新增 ${added} 轨，跳过 ${skipped} 轨（已有结尾帧）`
      : '所有轨道已有结尾帧，无需补');
  }

  _deleteSelectedKey() {
    // 多选：一次删除整组关键帧（按 index 降序删避免位移）
    if (this._multiSelectedKeys.size > 0) {
      this._pushHistory();
      const clip = this._clip();
      let removed = 0;
      for (const [boneId, indices] of this._multiSelectedKeys.entries()) {
        const track = clip?.tracks?.find(candidate => candidate.bone === boneId);
        if (!track) continue;
        const doomed = [...indices].sort((left, right) => right - left)
          .filter(index => index >= 0 && index < track.keys.length);
        for (const index of doomed) {
          track.keys.splice(index, 1);
          removed += 1;
        }
        // 注意：只删关键帧，不删轨道/骨骼/槽位——轨道保留，方便后续继续打帧
      }
      this._multiSelectedKeys.clear();
      this.selectedKey = null;
      if (removed > 0) {
        this._markDirty();
        this._afterDocChange();
        this._toast(`已删除 ${removed} 个关键帧`);
      }
      return;
    }
    if (!this.selectedKey) return;
    this._pushHistory();
    const clip = this._clip();
    const track = clip?.tracks?.find(candidate => candidate.bone === this.selectedKey.bone);
    if (!track) return;
    track.keys = track.keys.filter((key, index) => index !== this.selectedKey.index);
    this.selectedKey = null;
    this._markDirty();
    this._afterDocChange();
    this._toast('已删除 1 个关键帧');
  }

  /**
   * 复制当前选中的关键帧（单/多选）到播放头：以选中锚点帧为基准整体平移，
   * 保持组内相对时序；目标位置 ±5ms 内已有帧则按 upsert 语义合并。
   */
  _copySelectedKeysToPlayhead() {
    const clip = this._clip();
    const duration = clip?.durationMs || 0;
    // 多选整组：以 selectedKey 为锚点计算偏移
    if (this._multiSelectedKeys.size > 0) {
      const anchorTrack = clip?.tracks?.find(candidate => candidate.bone === this.selectedKey?.bone);
      const anchorKey = anchorTrack?.keys?.[this.selectedKey?.index];
      if (!anchorKey) { this._toast('未选中锚点关键帧', true); return; }
      const delta = Math.round(this.previewTime) - anchorKey.t;
      if (delta === 0) { this._toast('播放头位于锚点关键帧上，请先移动播放头再复制', true); return; }
      this._pushHistory();
      const copies = [];
      for (const [boneId, indices] of this._multiSelectedKeys.entries()) {
        const track = clip?.tracks?.find(candidate => candidate.bone === boneId);
        if (!track) continue;
        for (const index of indices) {
          const source = track.keys[index];
          if (!source) continue;
          copies.push({ track, key: { ...source, t: Math.max(0, Math.min(duration, source.t + delta)) } });
        }
      }
      for (const copy of copies) this._upsertKey(copy.track, copy.key);
      this._multiSelectedKeys.clear();
      this.selectedKey = null;
      this._markDirty();
      this._afterDocChange();
      this._toast(`已复制 ${copies.length} 个关键帧到播放头`);
      return;
    }
    if (!this.selectedKey) return;
    const track = clip?.tracks?.find(candidate => candidate.bone === this.selectedKey.bone);
    const source = track?.keys?.[this.selectedKey.index];
    if (!source) return;
    const targetT = Math.round(this.previewTime);
    if (Math.abs(targetT - source.t) <= 5) {
      this._toast('播放头位于源关键帧上，请先移动播放头再复制', true);
      return;
    }
    this._pushHistory();
    this._upsertKey(track, { ...source, t: Math.max(0, Math.min(duration, targetT)) });
    this._markDirty();
    this._afterDocChange();
    this._toast(`已复制关键帧到 t=${targetT}ms`);
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

  /** 当前预览方向的附件有效偏移：down=顶层基准；side/up 读 directionOffsets 覆盖（缺字段回退顶层）。 */
  _effectiveAttachmentOffset(attachment) {
    const override = attachment && this.previewDirection !== 'down'
      ? attachment.directionOffsets?.[this.previewDirection] : null;
    return {
      x: override?.x ?? attachment?.x ?? 0,
      y: override?.y ?? attachment?.y ?? 0,
      rot: override?.rot ?? attachment?.rot ?? 0,
      // 方向换图（身体三态）：side/up 覆盖可声明 assetId/width/height，整体替换部件图
      assetId: override?.assetId ?? null,
      width: override?.width ?? null,
      height: override?.height ?? null
    };
  }

  /** 预览方向下的有效附件：offset 声明了 assetId 时返回换图后的附件（对齐运行时渲染）。 */
  _effectiveAttachment(attachment) {
    const offset = this._effectiveAttachmentOffset(attachment);
    if (!offset?.assetId || !attachment) return attachment;
    return {
      ...attachment,
      assetId: offset.assetId,
      ...(offset.width > 0 ? { width: offset.width } : {}),
      ...(offset.height > 0 ? { height: offset.height } : {})
    };
  }

  /** 写当前预览方向的附件偏移：down 写顶层基准；side/up 写覆盖（首次以顶层基准初始化，美术从当前位置微调）。 */
  _writeAttachmentOffset(slot, { x = null, y = null, rot = null } = {}) {
    const attachment = slot?.attachment;
    if (!attachment) return;
    const round10 = value => Math.round(value * 10) / 10;
    if (this.previewDirection === 'down') {
      if (x !== null) attachment.x = round10(x);
      if (y !== null) attachment.y = round10(y);
      if (rot !== null) attachment.rot = round10(rot);
      return;
    }
    if (!attachment.directionOffsets) attachment.directionOffsets = {};
    let override = attachment.directionOffsets[this.previewDirection];
    if (!override) {
      override = { x: attachment.x ?? 0, y: attachment.y ?? 0, rot: attachment.rot ?? 0 };
      attachment.directionOffsets[this.previewDirection] = override;
    }
    if (x !== null) override.x = round10(x);
    if (y !== null) override.y = round10(y);
    if (rot !== null) override.rot = round10(rot);
  }

  /**
   * 附件锚点世界坐标（与运行时 SkeletonRenderer 完全一致）：
   * 骨骼世界变换（平移+旋转+缩放）后应用挂点偏移。
   * 编辑器画布预览/命中/拖拽必须都用本方法，否则骨骼带旋转时图与游戏内对不上。
   */
  _attachmentAnchorWorld(boneWorld, attachment) {
    return this._anchorWorldForOffset(boneWorld, this._effectiveAttachmentOffset(attachment));
  }

  /** 按显式挂点偏移求世界锚点（_attachmentAnchorWorld 的可复用内核，供方向洋葱皮 ghosts 使用）。 */
  _anchorWorldForOffset(boneWorld, offset) {
    const cos = Math.cos(boneWorld.rad);
    const sin = Math.sin(boneWorld.rad);
    const lx = (offset.x || 0) * (boneWorld.sx || 1);
    const ly = (offset.y || 0) * (boneWorld.sy || 1);
    return { x: boneWorld.x + lx * cos - ly * sin, y: boneWorld.y + lx * sin + ly * cos };
  }

  /**
   * 脚底贴地：按静止姿态（rest pose，与当前剪辑/播放头无关）测量所有可见挂件内容的
   * 最低非透明像素，移动 root 骨骼使其落在地平面 y=0——确立「原点=水平中心+脚底」锚点。
   * 只写 root 的静止 y（装配层数据），剪辑关键帧不动；Ctrl+Z 可撤销。
   */
  _alignFeetToGround() {
    if (!this.runtime) return;
    if (this.displayMode === 'bones') { this._toast('仅骨架模式无法测量脚底，先切到「图片+骨架」', true); return; }
    const rest = evaluateSkeletonPose(this.runtime, null, 0).world;
    let maxBottom = null;
    for (const slot of this.runtime.slots) {
      const attachment = slot.attachment;
      if (!attachment || attachment.type === 'empty' || attachment.visible === false) continue;
      if (this._isHeadSlotVisibleInPreview(slot.id) === false) continue;
      if (this._isSlotPreviewHidden(slot.id, slot.bone)) continue;
      const boneWorld = rest.get(slot.bone);
      if (!boneWorld) continue;
      const source = this._attachmentSource(attachment);
      if (!source) continue;
      const box = this._attachmentHitBox(attachment, source);
      if (!box || !(box.hw > 0)) continue;
      // 源像素 → 绘制像素比例（挂件可被绘制宽高缩放）
      const drawW = attachment.width > 0 ? attachment.width : source.sw;
      const drawH = attachment.height > 0 ? attachment.height : source.sh;
      const ux = (boneWorld.sx || 1) * (source.sw > 0 ? drawW / source.sw : 1);
      const uy = (boneWorld.sy || 1) * (source.sh > 0 ? drawH / source.sh : 1);
      // 挂点（基准偏移，正面语义）经骨骼旋转缩放落到世界
      const cosB = Math.cos(boneWorld.rad);
      const sinB = Math.sin(boneWorld.rad);
      const sxB = boneWorld.sx || 1;
      const syB = boneWorld.sy || 1;
      const ax = boneWorld.x + ((attachment.x || 0) * cosB - (attachment.y || 0) * sinB) * sxB;
      const ay = boneWorld.y + ((attachment.x || 0) * sinB + (attachment.y || 0) * cosB) * syB;
      // 内容盒四角经「附件旋转 ⊕ 绘制缩放」变换，取世界 y 最大者（附件带旋转时底边斜置）
      const rad = boneWorld.rad + (attachment.rot || 0) * DEG2RAD;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      for (const [cx, cy] of [
        [box.ox - box.hw, box.oy - box.hh], [box.ox + box.hw, box.oy - box.hh],
        [box.ox - box.hw, box.oy + box.hh], [box.ox + box.hw, box.oy + box.hh]
      ]) {
        const lx = cx * ux;
        const ly = cy * uy;
        const wy = ay + lx * sin + ly * cos;
        if (maxBottom === null || wy > maxBottom) maxBottom = wy;
      }
    }
    if (maxBottom === null) { this._toast('没有可测量的可见挂件', true); return; }
    const root = this._boneById(this.doc.bones?.[0]?.id);
    if (!root) return;
    const delta = -maxBottom; // 最低点目标 y=0
    if (Math.abs(delta) < 0.05) { this._toast('脚底已贴地（y=0），无需调整'); return; }
    this._pushHistory();
    root.y = Math.round((root.y + delta) * 10) / 10;
    this._markDirty();
    this._afterDocChange();
    this._toast(`已${delta > 0 ? '下' : '上'}移 root ${Math.abs(delta).toFixed(1)}px，脚底贴地（y=0）；Ctrl+Z 可撤销`);
  }

  /**
   * 方向偏移洋葱皮预览：预览非正面方向且挂件存在 directionOffsets 时，
   * 把其他方向的有效偏移位置以「低透明图像 + 方向色虚线盒 + 角标」画出
   * （正面=基准蓝 / 侧面=绿 / 背面=紫），便于跨方向对齐背挂武器等挂件。
   * 背面 ghost 与实绘同样应用 spearBack 水平翻转，保证与运行时表现一致。
   */
  _drawDirectionOffsetGhosts(ctx, slot, attachment, boneWorld, source, drawW, drawH) {
    if (this.previewDirection === 'down') return;
    if (this._hideDirGhosts) return; // 辅助线开关：隐藏正/侧/背幽灵虚线框
    const overrides = attachment.directionOffsets;
    if (!overrides) return;
    const GHOSTS = [
      { key: 'down', label: '正', color: 'rgba(126,200,255,0.9)' },
      { key: 'side', label: '侧', color: 'rgba(120,255,180,0.9)' },
      { key: 'up', label: '背', color: 'rgba(200,160,255,0.9)' }
    ];
    for (const ghost of GHOSTS) {
      if (ghost.key === this.previewDirection) continue;
      const offset = ghost.key === 'down'
        ? { x: attachment.x ?? 0, y: attachment.y ?? 0, rot: attachment.rot ?? 0 }
        : overrides[ghost.key];
      if (!offset) continue;
      const anchorWorld = this._anchorWorldForOffset(boneWorld, offset);
      const anchor = this._worldToScreen(anchorWorld.x, anchorWorld.y);
      const previewFlipX = slot.id === 'spearBack' && ghost.key === 'up';
      const flipX = (attachment.flipX === true) !== previewFlipX ? -1 : 1;
      ctx.save();
      ctx.translate(anchor.x, anchor.y);
      ctx.rotate(boneWorld.rad + (offset.rot || 0) * DEG2RAD);
      if (flipX < 0) ctx.scale(-1, 1);
      if (source.element) {
        ctx.globalAlpha = 0.22;
        ctx.drawImage(source.element, source.sx, source.sy, source.sw, source.sh,
          -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = ghost.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(-drawW / 2 - 2, -drawH / 2 - 2, drawW + 4, drawH + 4);
      ctx.setLineDash([]);
      ctx.fillStyle = ghost.color;
      ctx.font = '10px sans-serif';
      ctx.fillText(ghost.label, -drawW / 2 - 2, -drawH / 2 - 6);
      ctx.restore();
    }
  }

  _togglePlay() {
    this.playing = !this.playing;
    const clip = this._clip();
    if (this.playing && clip && this.previewTime >= clip.durationMs) this.previewTime = 0;
    const button = document.getElementById('se-play');
    if (button) button.textContent = this.playing ? '⏸ 暂停' : '▶ 播放';
  }

  /**
   * 逐帧步进按钮：单击走一帧；按住 300ms 后连续逐帧播放（松开即停）。
   * 步进前先暂停自动播放（否则 previewTime 被播放循环覆盖）。
   * @param {HTMLButtonElement} button - 步进按钮
   * @param {number} direction - +1 向后（时间正方向）/ -1 向前
   */
  _bindFrameStepper(button, direction) {
    if (!button) return;
    const stepOnce = () => {
      if (this.playing) {
        this.playing = false;
        const playButton = document.getElementById('se-play');
        if (playButton) playButton.textContent = '▶ 播放';
      }
      const duration = this._clipDuration();
      const frameStep = duration / 12;
      this.previewTime = Math.max(0, Math.min(duration, this.previewTime + direction * frameStep));
      this._renderTimeline();
    };
    let repeatTimer = null;
    let repeatInterval = null;
    let longPressed = false;
    const stopRepeat = () => {
      if (repeatTimer) { clearTimeout(repeatTimer); repeatTimer = null; }
      if (repeatInterval) { clearInterval(repeatInterval); repeatInterval = null; }
    };
    button.addEventListener('click', () => {
      if (!longPressed) stepOnce();
      longPressed = false;
      stopRepeat();
    });
    button.addEventListener('pointerdown', () => {
      longPressed = false;
      stopRepeat();
      repeatTimer = setTimeout(() => {
        longPressed = true;
        repeatInterval = setInterval(stepOnce, 90);
      }, 300);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(type => button.addEventListener(type, stopRepeat));
    window.addEventListener('blur', stopRepeat);
  }

  /* ---------------- 键盘 ---------------- */

  _onKeyDown(event) {
    // 输入框内不拦截
    if (event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA')) return;
    const hasKeySelection = this.selectedKey != null || this._multiSelectedKeys.size > 0;
    const hasSelection = this.selectedBones.size > 0 || this.selectedSlots.size > 0 || hasKeySelection;
    if (!hasSelection && event.key !== 'Escape') return;

    switch (event.key) {
      case 'Escape':
        this._clearSelection();
        this.selectedKey = null;
        this._multiSelectedKeys.clear();
        this._drag = null;
        this._renderBoneTree();
        this._renderSlotList();
        this._renderInspector();
        this._renderTimeline();
        event.preventDefault();
        break;
      case 'Delete':
      case 'Backspace':
        // 关键帧优先：选中了关键帧（单/多选）时，Delete 只删关键帧，不动骨骼/槽位
        if (this.selectedKey || this._multiSelectedKeys.size > 0) {
          this._deleteSelectedKey();
          event.preventDefault();
          break;
        }
        this._pushHistory();
        // 多选删除：先删槽位再删骨骼
        for (const id of [...this.selectedSlots]) {
          this.doc.slots = (this.doc.slots || []).filter(slot => slot.id !== id);
        }
        const bonesToDel = [...this.selectedBones].filter(id => id !== this.doc.bones?.[0]?.id);
        for (const boneId of bonesToDel) {
          const bone = this._boneById(boneId);
          if (!bone) continue;
          for (const other of this.doc.bones) {
            if (other.parent === boneId) other.parent = bone.parent;
          }
          for (const slot of this.doc.slots) {
            if (slot.bone === boneId) slot.bone = bone.parent;
          }
          for (const clip of this.doc.clips) {
            clip.tracks = (clip.tracks || []).filter(track => track.bone !== boneId);
          }
        }
        this.doc.bones = this.doc.bones.filter(candidate => !bonesToDel.includes(candidate.id));
        this.selectedSlots.clear();
        for (const id of bonesToDel) this.selectedBones.delete(id);
        this._selectedSlotId = [...this.selectedSlots].at(-1) || null;
        this._selectedBoneId = [...this.selectedBones].at(-1) || null;
        this._markDirty();
        this.runtime = parseSkeletonAsset(structuredClone(this.doc));
        this._renderBoneTree();
        this._renderSlotList();
        this._renderInspector();
        this._renderTimeline();
        event.preventDefault();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const step = (event.shiftKey ? 10 : 1) / this.view.scale; // 屏幕像素 → 世界单位
        const dx = (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0);
        const dy = (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
        this._nudgeSelection(dx, dy);
        event.preventDefault();
        break;
      }
      default:
        break;
    }
  }

  /** 方向键微移：多选骨骼+槽位整体位移（装配模式直接改 rest；动画模式打关键帧）。 */
  _nudgeSelection(dx, dy) {
    this._pushHistory();
    const clip = this._clip();
    // 骨骼微移
    for (const boneId of this.selectedBones) {
      if (this._isBoneLocked(boneId)) continue;
      const bone = this._boneById(boneId);
      if (!bone) continue;
      const parent = this._parentWorldTransform(this._boneWorldTransforms(), bone);
      const cos = Math.cos(-parent.rad);
      const sin = Math.sin(-parent.rad);
      const localDx = (dx * cos - dy * sin) / (parent.sx || 1);
      const localDy = (dx * sin + dy * cos) / (parent.sy || 1);
      if (this.editMode === 'setup') {
        bone.x = Math.round((bone.x + localDx) * 10) / 10;
        bone.y = Math.round((bone.y + localDy) * 10) / 10;
        this._markDirty();
        this.runtime = parseSkeletonAsset(structuredClone(this.doc));
        this._keepAttachmentsWorldFixed(boneId, dx, dy);
      } else {
        const sampled = this._sampledBoneLocal(boneId) || bone;
        this._ensureTrackAndKey(boneId, clip, { x: sampled.x + localDx, y: sampled.y + localDy });
      }
    }
    // 槽位微移
    for (const slotId of this.selectedSlots) {
      const slot = this._slotById(slotId);
      if (!slot || this._isSlotInteractiveLocked(slot.id, slot.bone)) continue;
      const boneWorld = this._boneWorldTransforms().get(slot.bone);
      this._applyAttachMove(slot, boneWorld, { x: slot.attachment?.x || 0, y: slot.attachment?.y || 0 }, dx, dy);
      this._markDirty();
    }
    this.runtime = parseSkeletonAsset(structuredClone(this.doc));
    this._renderInspector();
    this._renderTimeline();
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
    // 镜像预览：沿角色中轴（世界 x=0）水平翻转——模拟游戏里 sprite.flipX 左向渲染，
    // 调背挂武器/装备位置时所见即背面/左向所得；手柄与命中测试共用换算自动跟随
    const mx = this._mirrorPreview ? -x : x;
    return { x: this.view.ox + mx * this.view.scale, y: this.view.oy + y * this.view.scale };
  }

  _screenToWorld(x, y) {
    const sign = this._mirrorPreview ? -1 : 1;
    return { x: (sign * (x - this.view.ox)) / this.view.scale, y: (y - this.view.oy) / this.view.scale };
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
    // 原点/地平面标注：确立「原点=水平中心+脚底、绿线=地平面 y=0」的可读性
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255,90,90,0.85)';
    ctx.fillText('原点·脚底 (0,0)', origin.x + 9, origin.y + 12);
    ctx.fillStyle = 'rgba(76,175,80,0.85)';
    ctx.fillText('地平面 y=0', topLeft.x + 4, origin.y - 4);

    if (!this.runtime) { ctx.restore(); return; }
    const world = this._boneWorldTransforms();

    // 槽位附件预览（z 顺序；隐藏/锁定的槽位不画；attachment.visible=false 不画——对齐运行时三方向切换语义）
    // 仅骨架模式（displayMode='bones'）：隐藏全部挂件，便于调骨骼动作
    for (const slot of this.runtime.slots) {
      if (this.displayMode === 'bones') break;
      const attachment = slot.attachment;
      if (!attachment || attachment.type === 'empty') continue;
      // 方向预览：三态头部槽位按 previewDirection 覆盖可见性（不覆写 JSON，对齐运行时 HEAD_SLOTS）
      const headVisible = this._isHeadSlotVisibleInPreview(slot.id);
      if (headVisible === false) continue;
      if (headVisible !== true && attachment.visible === false) continue;
      if (this._isSlotPreviewHidden(slot.id, slot.bone)) continue;
      const boneWorld = world.get(slot.bone);
      if (!boneWorld) continue;
      // 方向换图（身体三态）：side/up 预览用 offset.assetId 的部件图（对齐运行时渲染）
      const effAttachment = this._effectiveAttachment(attachment);
      const source = this._attachmentSource(effAttachment);
      if (!source) continue;
      const anchorWorld = this._attachmentAnchorWorld(boneWorld, attachment);
      const anchor = this._worldToScreen(anchorWorld.x, anchorWorld.y);
      const drawW = (effAttachment.width > 0 ? effAttachment.width : source.sw) * boneWorld.sx * this.view.scale;
      const drawH = (effAttachment.height > 0 ? effAttachment.height : source.sh) * boneWorld.sy * this.view.scale;
      ctx.save();
      ctx.translate(anchor.x, anchor.y);
      // 旋转用有效偏移 rot（side/up 方向覆盖），与运行时 SkeletonRenderer 的 directionOverride.rot 一致
      ctx.rotate(boneWorld.rad + (this._effectiveAttachmentOffset(attachment).rot || 0) * DEG2RAD);
      // 背面预览：spearBack 槽位水平翻转（对齐运行时 PlayerSkeletonStateMapper 的 flipX 规则）
      const previewFlipX = slot.id === 'spearBack' && this.previewDirection === 'up';
      const flipX = (attachment.flipX === true) !== previewFlipX ? -1 : 1; // 数据翻转 ⊕ 预览翻转
      if (flipX < 0) ctx.scale(-1, 1);
      if (source.element) {
        ctx.drawImage(source.element, source.sx, source.sy, source.sw, source.sh,
          -drawW / 2, -drawH / 2, drawW, drawH);
      } else {
        ctx.fillStyle = 'rgba(126,200,255,0.25)';
        ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
      }
      ctx.restore();
      // 方向偏移洋葱皮：其他方向的挂件偏移位置（虚线盒 + 低透明图）
      this._drawDirectionOffsetGhosts(ctx, slot, attachment, boneWorld, source, drawW, drawH);
    }

    // 骨骼骨形（Spine/火柴人式）：骨条画向子骨骼原点（叶子骨骼沿身体方向），首尾相接
    // 仅图片模式（displayMode='images'）：只画选中骨骼的细骨形（保持可见所选），其余隐藏
    for (const bone of this.doc.bones || []) {
      const boneWorld = world.get(bone.id);
      if (!boneWorld) continue;
      const isSelectedBone = this.selectedBones.has(bone.id);
      if (this.displayMode === 'images' && !isSelectedBone) continue;
      const tip = this._boneTip(bone, world);
      if (!tip) continue;
      const start = this._worldToScreen(boneWorld.x, boneWorld.y);
      const end = this._worldToScreen(tip.x, tip.y);
      const selected = isSelectedBone;
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

    // 仅骨架模式：骨骼名标注（骨条中点），方便按名字找骨调动
    if (this.displayMode === 'bones') {
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const bone of this.doc.bones || []) {
        const boneWorld = world.get(bone.id);
        if (!boneWorld) continue;
        const tip = this._boneTip(bone, world);
        if (!tip) continue;
        const start = this._worldToScreen(boneWorld.x, boneWorld.y);
        const end = this._worldToScreen(tip.x, tip.y);
        const selected = this.selectedBones.has(bone.id);
        ctx.fillStyle = selected ? '#ffd479' : 'rgba(154,165,192,0.95)';
        ctx.fillText(SkeletonEditor._displayName(bone.id), (start.x + end.x) / 2, (start.y + end.y) / 2 - 9);
      }
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }

    // 多选槽位附件高亮：描边盒 + 骨骼原点→附件中心偏移连线（Spine 式挂点可视化）
    // 仅骨架模式下挂件不可见，高亮一并跳过
    if (this.displayMode !== 'bones') for (const slotId of this.selectedSlots) {
      const runtimeSlot = this.runtime?.slots.find(candidate => candidate.id === slotId);
      const attachment = runtimeSlot?.attachment;
      const boneWorld = runtimeSlot ? world.get(runtimeSlot.bone) : null;
      if (attachment && attachment.type !== 'empty' && boneWorld
        && !this._isSlotPreviewHidden(runtimeSlot.id, runtimeSlot.bone)) {
        const source = this._attachmentSource(attachment);
        if (source) {
          const anchorWorld = this._attachmentAnchorWorld(boneWorld, attachment);
      const anchor = this._worldToScreen(anchorWorld.x, anchorWorld.y);
          const drawW = (attachment.width > 0 ? attachment.width : source.sw) * boneWorld.sx * this.view.scale;
          const drawH = (attachment.height > 0 ? attachment.height : source.sh) * boneWorld.sy * this.view.scale;
          const angle = boneWorld.rad + this._effectiveAttachmentOffset(attachment).rot * DEG2RAD;
          ctx.save();
          ctx.translate(anchor.x, anchor.y);
          ctx.rotate(angle);
          ctx.strokeStyle = slotId === this.selectedSlot ? '#ffd479' : 'rgba(255,212,121,0.55)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(-drawW / 2 - 2, -drawH / 2 - 2, drawW + 4, drawH + 4);
          ctx.restore();
          // 偏移连线：骨骼原点 → 绑定点（未偏移时不画线，避免与骨骼点重叠干扰）
          const boneAnchor = this._worldToScreen(boneWorld.x, boneWorld.y);
          const effectiveOffset = this._effectiveAttachmentOffset(attachment);
          if (Math.abs(effectiveOffset.x) + Math.abs(effectiveOffset.y) > 0.5) {
            ctx.strokeStyle = 'rgba(255,212,121,0.75)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(boneAnchor.x, boneAnchor.y);
            ctx.lineTo(anchor.x, anchor.y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          // 绑定点标记（黄菱形 = 图片与骨骼的连接点，拖动图片即调整它；常显）
          ctx.save();
          ctx.translate(anchor.x, anchor.y);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = slotId === this.selectedSlot ? '#ffd479' : 'rgba(255,212,121,0.55)';
          ctx.fillRect(-3.5, -3.5, 7, 7);
          ctx.strokeStyle = '#0d1226';
          ctx.lineWidth = 1;
          ctx.strokeRect(-3.5, -3.5, 7, 7);
          ctx.restore();
        }
      }
    }

    // 选中对象统一变换盒：虚线外框 + 8 方框手柄（4 角 + 4 边中点）+ 旋转圆心高亮 + 悬停角旋转箭头
    // 手势：按住小方框=缩放；点击小方框（不拖）=设为旋转圆心；按住角手柄外圈=绕圆心旋转
    const selBox = this._selectedObjectBox(world);
    if (selBox) {
      ctx.strokeStyle = '#7ec8ff';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.save();
      ctx.translate(selBox.cx, selBox.cy);
      ctx.rotate(selBox.angle);
      ctx.strokeRect(-selBox.w / 2, -selBox.h / 2, selBox.w, selBox.h);
      ctx.restore();
      ctx.setLineDash([]);
      for (const handle of selBox.handles) {
        const isPivot = this._rotPivot?.targetId === selBox.id && this._rotPivot?.handleKey === handle.key;
        ctx.fillStyle = isPivot ? '#ffd479' : '#0d1226';
        ctx.fillRect(handle.x - 4, handle.y - 4, 8, 8);
        ctx.strokeStyle = isPivot ? '#ff9c3c' : '#7ec8ff';
        ctx.strokeRect(handle.x - 4, handle.y - 4, 8, 8);
      }
      // 悬停角手柄：外侧显示圆形旋转箭头（按住即绕圆心旋转）
      if (this._hoverRotCorner) {
        const corner = selBox.handles.find(handle => handle.key === this._hoverRotCorner.key) || this._hoverRotCorner;
        const dirX = corner.x - selBox.cx;
        const dirY = corner.y - selBox.cy;
        const dirLen = Math.hypot(dirX, dirY) || 1;
        const ax = corner.x + (dirX / dirLen) * 20;
        const ay = corner.y + (dirY / dirLen) * 20;
        ctx.strokeStyle = '#ffd479';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ax, ay, 7, 0.5 * Math.PI, 2.15 * Math.PI);
        ctx.stroke();
        const endX = ax + Math.cos(2.15 * Math.PI) * 7;
        const endY = ay + Math.sin(2.15 * Math.PI) * 7;
        ctx.fillStyle = '#ffd479';
        ctx.beginPath();
        ctx.moveTo(endX + 4, endY - 1);
        ctx.lineTo(endX - 2, endY - 4);
        ctx.lineTo(endX - 1, endY + 3);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 骨骼长度调整预览：沿骨骼自身方向的长度线 + 数值标注
    if (this._drag?.kind === 'tip-length') {
      const bone = this._boneById(this._drag.boneId);
      const boneWorld = world.get(this._drag.boneId);
      if (bone && boneWorld) {
        const origin = this._worldToScreen(boneWorld.x, boneWorld.y);
        const tipWorld = {
          x: boneWorld.x + Math.cos(boneWorld.rad) * bone.length * boneWorld.sx,
          y: boneWorld.y + Math.sin(boneWorld.rad) * bone.length * boneWorld.sy
        };
        const tipPoint = this._worldToScreen(tipWorld.x, tipWorld.y);
        ctx.strokeStyle = '#ffd479';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(tipPoint.x, tipPoint.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffd479';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`长度 ${bone.length}`, tipPoint.x + 10, tipPoint.y - 8);
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

    // 拖拽组合预览：库条目拖入画布时 ghost 跟随鼠标，吸附骨骼高亮 + 挂点连线
    if (this._libDrag && this._libDrag.mx != null) {
      const entry = this.imageCatalog.get(this._libDrag.assetId);
      if (entry?.element) {
        const scale = this.view.scale;
        const drawW = (entry.width || entry.element.naturalWidth || 64) * scale;
        const drawH = (entry.height || entry.element.naturalHeight || 64) * scale;
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.drawImage(entry.element, this._libDrag.mx - drawW / 2, this._libDrag.my - drawH / 2, drawW, drawH);
        ctx.globalAlpha = 1;
        if (this._libDrag.hoverBone) {
          const boneWorld = this._boneWorldTransforms().get(this._libDrag.hoverBone);
          if (boneWorld) {
            const origin = this._worldToScreen(boneWorld.x, boneWorld.y);
            ctx.strokeStyle = 'rgba(126,200,255,0.9)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(origin.x, origin.y);
            ctx.lineTo(this._libDrag.mx, this._libDrag.my);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(origin.x, origin.y, 10, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // 框选矩形（marquee）
    if (this._drag?.kind === 'marquee') {
      const x = Math.min(this._drag.startX, this._drag.currentX);
      const y = Math.min(this._drag.startY, this._drag.currentY);
      const w = Math.abs(this._drag.currentX - this._drag.startX);
      const h = Math.abs(this._drag.currentY - this._drag.startY);
      ctx.fillStyle = 'rgba(76,175,80,0.12)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#4CAF50';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
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
    if (event.button === 1 || event.button === 2 || (event.button === 0 && this._panMode)) {
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
    const additive = event.ctrlKey || event.metaKey;
    // 统一手势（无模式）：① 骨点 10px=选中+移动（骨点是骨骼最可靠抓点，优先于图片遮挡）
    // ② 角手柄盒外环带=旋转（骨骼绕自身关节，图片绕已点选的小方框或盒中心）③ 小方框=缩放 ④ 图片/骨身按住=移动 ⑤ 空白=框选
    if (!additive && !event.altKey) {
      const originHit = this._pickBoneOrigin(mx, my, world, 10, null);
      if (originHit && !this._isBoneLocked(originHit) && !this._isBoneHidden(originHit)) {
        const originBone = this._boneById(originHit);
        if (originBone) {
          if (!this.selectedBones.has(originHit)) {
            this.selectedBone = originHit;
            this.selectedSlot = null;
          }
          if (this._rotPivot?.targetId !== originHit) this._rotPivot = null;
          this._renderBoneTree();
          this._renderSlotList();
          this._renderInspector();
          this._beginBoneMove(originBone, mx, my, world);
          return;
        }
      }
    }
    const box = this._selectedObjectBox(world);
    if (box && !additive && !event.altKey) {
      const rotHit = this._hitRotateZone(mx, my, box);
      if (rotHit) {
        this._beginObjectRotate(box, mx, my, world);
        return;
      }
      const handleHit = this._hitBoxHandles(mx, my, box);
      if (handleHit) {
        this._beginHandleScale(box, handleHit, mx, my, world);
        return;
      }
    }
    // 命中槽位附件（alpha 精确命中；Alt+点击穿透选骨骼；Ctrl=加选/减选）。
    // 按住拖动 = 移动（Shift+拖 = 允许拖放换绑，拖到目标骨骼原点附近松手重挂）
    if (!event.altKey) {
      const hitSlotId = this._hitAttachment(mx, my, world)
        // 绑定点热区：主选中槽位黄菱形 8px 内即使图片像素透明也命中（点绑定点=可靠抓图）
        || this._hitSelectedAnchorZone(mx, my, world);
      if (hitSlotId) {
        const slot = this._slotById(hitSlotId);
        if (additive) {
          // Ctrl+点击：加选/减选，不开始拖拽
          this._toggleSlotInSelection(hitSlotId);
          this._selectedImageId = slot?.attachment?.assetId || this._selectedImageId;
          this._renderBoneTree();
          this._renderSlotList();
          this._renderInspector();
          this._renderImageLib();
          return;
        }
        // Shift+拖 = 允许拖放换绑（拖到目标骨骼原点附近松手重挂）；
        // 默认拖拽只调绑定点偏移，绝不换绑——避免扫过其他骨点时「一点一拖就全乱」
        this._beginAttachMove(hitSlotId, mx, my, world, event.shiftKey === true);
        return;
      }
    }
    // 命中骨骼骨身/关节（原点优先评分；锁定的骨骼跳过；Ctrl=加选/减选）。
    // 按住拖动 = 移动骨骼（动画模式自动打关键帧）
    const hit = this._pickBone(mx, my, world);
    if (hit) {
      if (additive) {
        this._toggleBoneInSelection(hit.id);
        this._renderBoneTree();
        this._renderSlotList();
        this._renderInspector();
        return;
      }
      // 叶子骨骼末端 7px 内：拖动调整骨骼长度（Shift=X 轴缩放）
      const leafTip = this._boneTip(hit, world);
      const leafTipScreen = leafTip ? this._worldToScreen(leafTip.x, leafTip.y) : null;
      const hasChild = (this.doc.bones || []).some(candidate => candidate.parent === hit.id);
      if (!event.altKey && !hasChild && leafTipScreen
        && Math.hypot(mx - leafTipScreen.x, my - leafTipScreen.y) <= 7) {
        if (!this.selectedBones.has(hit.id)) {
          this.selectedBone = hit.id;
          this.selectedSlot = null;
        }
        this._renderBoneTree();
        this._renderSlotList();
        this._renderInspector();
        this._drag = { kind: 'tip-length', boneId: hit.id };
        return;
      }
      if (!this.selectedBones.has(hit.id)) {
        this.selectedBone = hit.id;
        this.selectedSlot = null;
      }
      if (this._rotPivot?.targetId !== hit.id) this._rotPivot = null;
      this._renderBoneTree();
      this._renderSlotList();
      this._renderInspector();
      this._beginBoneMove(hit, mx, my, world);
      return;
    }
    // 空白：框选（Ctrl=在现有选择上叠加）；无 Ctrl 先清空选择
    if (!additive) this._clearSelection();
    this._drag = { kind: 'marquee', startX: mx, startY: my, currentX: mx, currentY: my, additive };
    this._renderBoneTree();
    this._renderSlotList();
    this._renderInspector();
  }

  /** 开始骨骼移动拖拽（骨点/骨身共用）：动画模式写关键帧，装配模式改静止姿态；子孙骨骼关节跟随。 */
  _beginBoneMove(bone, mx, my, world) {
    const boneWorld = world.get(bone.id);
    if (!boneWorld) return;
    const anchor = this._worldToScreen(boneWorld.x, boneWorld.y);
    // 多选骨骼：记录集合内其余骨骼的初始姿态，拖动时整体位移
    const extraBones = [...this.selectedBones]
      .filter(id => id !== bone.id && !this._isBoneLocked(id))
      .map(id => {
        const candidate = this._boneById(id);
        return candidate
          ? { id, startLocal: { ...(this._sampledBoneLocal(id) || candidate) }, parent: this._parentWorldTransform(world, candidate) }
          : null;
      })
      .filter(Boolean);
    this._drag = {
      kind: 'move', // 按住骨点/骨身 = 位移（子骨骼树关节跟随）
      boneId: bone.id,
      startX: mx, startY: my,
      startLocal: { ...(this._sampledBoneLocal(bone.id) || bone) },
      startWorldRot: Math.atan2(my - anchor.y, mx - anchor.x),
      parent: this._parentWorldTransform(world, bone),
      extraBones
    };
  }

  /** 主选中槽位附件的 8 手柄变换框数据（屏幕坐标）。无有效附件返回 null。 */
  _attachmentHandles(world) {
    const slotId = this.selectedSlot;
    if (!slotId || this._sliceMode) return null;
    const runtimeSlot = this.runtime?.slots.find(candidate => candidate.id === slotId);
    const attachment = runtimeSlot?.attachment;
    const boneWorld = runtimeSlot ? world.get(runtimeSlot.bone) : null;
    if (!attachment || attachment.type === 'empty' || !boneWorld) return null;
    if (this._isSlotPreviewHidden(runtimeSlot.id, runtimeSlot.bone)) return null;
    if (this._isSlotInteractiveLocked(runtimeSlot.id, runtimeSlot.bone)) return null;
    const source = this._attachmentSource(attachment);
    if (!source) return null;
    const anchorWorld = this._attachmentAnchorWorld(boneWorld, attachment);
      const anchor = this._worldToScreen(anchorWorld.x, anchorWorld.y);
    const drawW = (attachment.width > 0 ? attachment.width : source.sw) * boneWorld.sx * this.view.scale;
    const drawH = (attachment.height > 0 ? attachment.height : source.sh) * boneWorld.sy * this.view.scale;
    if (drawW < 2 || drawH < 2) return null;
    const angle = boneWorld.rad + (this._effectiveAttachmentOffset(attachment).rot || 0) * DEG2RAD;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const pt = (lx, ly) => ({ x: anchor.x + lx * cos - ly * sin, y: anchor.y + lx * sin + ly * cos });
    const hw = drawW / 2;
    const hh = drawH / 2;
    return {
      slotId, anchor, angle, drawW, drawH, boneWorld,
      handles: [
        { key: 'nw', ...pt(-hw, -hh) }, { key: 'n', ...pt(0, -hh) },
        { key: 'ne', ...pt(hw, -hh) }, { key: 'e', ...pt(hw, 0) },
        { key: 'se', ...pt(hw, hh) }, { key: 's', ...pt(0, hh) },
        { key: 'sw', ...pt(-hw, hh) }, { key: 'w', ...pt(-hw, 0) }
      ]
    };
  }

  /** 附件命中测试：从最上层槽位向下找鼠标点所在的附件内容盒（与 _draw 同变换）。
   *  命中盒按图片非透明像素包围盒（alpha 扫描缓存），避免透明区域遮挡下层图片的点选。
   *  返回 doc 槽位 ID。 */
  _hitAttachment(mx, my, world) {
    // 仅骨架模式：挂件不可见也不可点（点击穿透到骨骼）
    if (this.displayMode === 'bones') return null;
    const slots = [...(this.runtime?.slots || [])].reverse();
    for (const runtimeSlot of slots) {
      const attachment = runtimeSlot.attachment;
      if (!attachment || attachment.type === 'empty') continue;
      // 隐藏（side/back 方向组或手动隐藏）/方向预览不可见/锁定的槽位不参与命中（所见即可点）
      // 三态头/发槽（head*/hair*）数据 visible=false 仅表示默认朝向不可见——
      // 以当前预览方向为准：预览中显示即可命中（对齐渲染逻辑），否则侧面/背面选不中侧发/背发
      const headVisible = this._isHeadSlotVisibleInPreview(runtimeSlot.id);
      if (headVisible === false) continue;
      if (headVisible !== true && attachment.visible === false) continue;
      if (this._isSlotPreviewHidden(runtimeSlot.id, runtimeSlot.bone)) continue;
      if (this._isSlotInteractiveLocked(runtimeSlot.id, runtimeSlot.bone)) continue;
      const boneWorld = world.get(runtimeSlot.bone);
      if (!boneWorld) continue;
      // 命中盒按预览方向的有效附件（方向换图后以 side/back 图计算，所见即可点）
      const effAttachment = this._effectiveAttachment(attachment);
      const source = this._attachmentSource(effAttachment);
      if (!source) continue;
      const drawW = (effAttachment.width > 0 ? effAttachment.width : source.sw) * boneWorld.sx * this.view.scale;
      const drawH = (effAttachment.height > 0 ? effAttachment.height : source.sh) * boneWorld.sy * this.view.scale;
      if (drawW < 2 || drawH < 2) continue;
      const anchorWorld = this._attachmentAnchorWorld(boneWorld, attachment);
      const anchor = this._worldToScreen(anchorWorld.x, anchorWorld.y);
      const angle = boneWorld.rad + (this._effectiveAttachmentOffset(attachment).rot || 0) * DEG2RAD;
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

  /** 绑定点热区命中：主选中槽位锚点（黄菱形）8px 内即使图片像素透明也算命中。
   *  解决「图片几何中心是透明像素（如斧头中心）点不到」的问题——点绑定点=可靠抓图。 */
  _hitSelectedAnchorZone(mx, my, world) {
    const slotId = this.selectedSlot;
    if (!slotId || this._sliceMode) return null;
    const slot = this._slotById(slotId);
    const attachment = slot?.attachment;
    const boneWorld = slot ? world.get(slot.bone) : null;
    if (!attachment || attachment.type === 'empty' || !boneWorld) return null;
    if (this._isSlotInteractiveLocked(slot.id, slot.bone)) return null;
    if (this._isHeadSlotVisibleInPreview(slot.id) === false) return null;
    const anchor = this._worldToScreen(
      boneWorld.x + (attachment.x || 0) * boneWorld.sx,
      boneWorld.y + (attachment.y || 0) * boneWorld.sy
    );
    return Math.hypot(mx - anchor.x, my - anchor.y) <= 8 ? slotId : null;
  }

  /** 开始附件拖拽：单选该槽位（或保留多选集合并整体拖动），记录初始偏移。 */
  _beginAttachMove(hitSlotId, mx, my, world, rebindEnabled = false) {
    const slot = this._slotById(hitSlotId);
    // 已处在多选集合中：保持集合整体拖动；否则单选
    if (!this.selectedSlots.has(hitSlotId)) this.selectedSlot = hitSlotId;
    this._selectedImageId = slot?.attachment?.assetId || this._selectedImageId;
    this._renderBoneTree();
    this._renderSlotList();
    this._renderInspector();
    this._renderImageLib();
    // 选中即开始拖拽：直接调整附件偏移/绑定点（所见即所得）；多选集合同步拖动。
    // rebindEnabled=true（Shift+拖）才会在拖到目标骨骼原点附近时换绑，默认关闭防误换绑
    this._drag = {
      kind: 'attach-move',
      slotId: hitSlotId,
      rebindEnabled,
      startX: mx, startY: my,
      startOffset: this._effectiveAttachmentOffset(slot?.attachment),
      boneWorld: world.get(slot?.bone) || null,
      extraSlots: [...this.selectedSlots]
        .filter(id => id !== hitSlotId)
        .map(id => {
          const candidate = this._slotById(id);
          return candidate && !this._isSlotInteractiveLocked(candidate.id, candidate.bone)
            ? { id, startOffset: this._effectiveAttachmentOffset(candidate.attachment), boneWorld: world.get(candidate.bone) || null }
            : null;
        })
        .filter(Boolean)
    };
  }

  /* ---------------- 统一手势：变换盒 / 缩放 / 旋转 ---------------- */

  /**
   * 当前选中对象的变换盒（统一手势数据源）：
   * - 选中图片槽位 → 附件盒（挂点中心、随骨骼旋转；仅骨架模式不显示）
   * - 选中骨骼 → 骨条盒（原点→末端方向对齐的细长盒）
   * 返回 { kind:'slot'|'bone', id, cx, cy, angle, w, h, handles:[{key,x,y}], ... } 或 null。
   */
  _selectedObjectBox(world) {
    if (this.displayMode !== 'bones') {
      const slotBox = this._attachmentHandles(world);
      if (slotBox) {
        return {
          kind: 'slot', id: slotBox.slotId,
          cx: slotBox.anchor.x, cy: slotBox.anchor.y,
          angle: slotBox.angle, w: slotBox.drawW, h: slotBox.drawH,
          anchor: slotBox.anchor, boneWorld: slotBox.boneWorld,
          handles: slotBox.handles
        };
      }
    }
    const boneId = this.selectedBone;
    if (!boneId || this._sliceMode) return null;
    const bone = this._boneById(boneId);
    const boneWorld = world.get(boneId);
    if (!bone || !boneWorld || this._isBoneLocked(boneId) || this._isBoneHidden(boneId)) return null;
    const tip = this._boneTip(bone, world);
    const o = this._worldToScreen(boneWorld.x, boneWorld.y);
    const t = tip ? this._worldToScreen(tip.x, tip.y) : o;
    const angle = Math.atan2(t.y - o.y, t.x - o.x);
    const w = Math.max(28, Math.hypot(t.x - o.x, t.y - o.y));
    const h = 26;
    const cx = (o.x + t.x) / 2;
    const cy = (o.y + t.y) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const pt = (lx, ly) => ({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });
    const hw = w / 2;
    const hh = h / 2;
    return {
      kind: 'bone', id: boneId, cx, cy, angle, w, h, origin: o, tip: t, bone, boneWorld,
      handles: [
        { key: 'nw', ...pt(-hw, -hh) }, { key: 'n', ...pt(0, -hh) },
        { key: 'ne', ...pt(hw, -hh) }, { key: 'e', ...pt(hw, 0) },
        { key: 'se', ...pt(hw, hh) }, { key: 's', ...pt(0, hh) },
        { key: 'sw', ...pt(-hw, hh) }, { key: 'w', ...pt(-hw, 0) }
      ]
    };
  }

  /** 角手柄外圈旋转区命中（仅 4 角；只认「远离盒心」的外侧半边环带，内侧留给骨点/骨身移动）。 */
  _hitRotateZone(mx, my, box) {
    for (const handle of box.handles) {
      if (handle.key.length !== 2) continue; // 只看 4 角
      const d = Math.hypot(mx - handle.x, my - handle.y);
      if (d <= 9 || d > 22) continue;
      const outX = handle.x - box.cx;
      const outY = handle.y - box.cy;
      if ((mx - handle.x) * outX + (my - handle.y) * outY > 0) return { corner: handle };
    }
    return null;
  }

  /** 8 方框手柄命中（9px 半径）。 */
  _hitBoxHandles(mx, my, box) {
    for (const handle of box.handles) {
      if (Math.hypot(mx - handle.x, my - handle.y) <= 9) return { handle };
    }
    return null;
  }

  /** 开始旋转拖拽：骨骼 = 绕自身关节（原点）纯旋转；图片 = 圆心（已点选的小方框或盒中心）。 */
  _beginObjectRotate(box, mx, my, world) {
    if (box.kind === 'bone') {
      // 骨骼旋转固定绕自身关节：原点不动、只写 rot——肘/膝关节不飘移，
      // 父骨条（画向子骨骼原点）长度稳定，避免整条手臂视觉伸缩
      const bone = box.bone;
      this._drag = {
        kind: 'object-rotate',
        boxKind: 'bone',
        id: box.id,
        pivotX: box.origin.x, pivotY: box.origin.y,
        startAngle: Math.atan2(my - box.origin.y, mx - box.origin.x),
        moved: false,
        startRot: (this._sampledBoneLocal(box.id) || bone).rot || 0,
        // 装配模式补偿：绑定到该骨骼的挂图保持世界位置与朝向（操作骨骼时图片不动）
        startSlotAnchors: (this.editMode === 'setup')
          ? (this.doc.slots || [])
            .filter(slot => slot.bone === box.id && !this.selectedSlots.has(slot.id)
              && slot.attachment && slot.attachment.type !== 'empty')
            .map(slot => ({
              id: slot.id,
              rot: this._effectiveAttachmentOffset(slot.attachment).rot || 0,
              anchorWorld: this._attachmentAnchorWorld(box.boneWorld, slot.attachment)
            }))
          : []
      };
      return;
    }
    const pivotHandle = this._rotPivot?.targetId === box.id
      ? box.handles.find(handle => handle.key === this._rotPivot.handleKey)
      : null;
    const pivot = pivotHandle || { x: box.cx, y: box.cy };
    const slot = this._slotById(box.id);
    const attachment = slot?.attachment;
    if (!attachment) return;
    this._drag = {
      kind: 'object-rotate',
      boxKind: box.kind,
      id: box.id,
      pivotX: pivot.x, pivotY: pivot.y,
      startAngle: Math.atan2(my - pivot.y, mx - pivot.x),
      moved: false,
      startRot: this._effectiveAttachmentOffset(attachment).rot || 0,
      startAnchorWorld: this._attachmentAnchorWorld(box.boneWorld, attachment),
      boneWorld: box.boneWorld
    };
  }

  /** 开始手柄缩放：图片 → 8 手柄改宽高；骨骼 → 距原点比例改 scaleX/Y（角=等比，边=单轴）。 */
  _beginHandleScale(box, handleHit, mx, my, world) {
    if (box.kind === 'slot') {
      const slot = this._slotById(box.id);
      const attachment = slot?.attachment;
      if (!attachment) return;
      const source = this._attachmentSource(attachment);
      this._drag = {
        kind: 'attach-scale',
        slotId: box.id,
        handle: handleHit.handle.key,
        startX: mx, startY: my,
        startW: attachment.width > 0 ? attachment.width : (source?.sw || 1),
        startH: attachment.height > 0 ? attachment.height : (source?.sh || 1),
        angle: box.angle,
        boneWorld: box.boneWorld
      };
      return;
    }
    const sampled = this._sampledBoneLocal(box.id) || box.bone;
    const key = handleHit.handle.key;
    this._drag = {
      kind: 'bone-scale',
      boneId: box.id,
      handle: key,
      anchorX: box.origin.x, anchorY: box.origin.y,
      clickX: mx, clickY: my,
      startDist: Math.max(8, Math.hypot(mx - box.origin.x, my - box.origin.y)),
      startScaleX: sampled.sx ?? box.bone.scaleX ?? 1,
      startScaleY: sampled.sy ?? box.bone.scaleY ?? 1,
      axis: key.length === 2 ? 'uniform' : ((key.includes('e') || key.includes('w')) ? 'x' : 'y')
    };
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
    const rect = this.el.canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    // 无拖拽：更新悬停状态（角手柄外圈 → 旋转箭头图标+grab 光标；手柄 → 缩放光标）
    if (!this._drag) {
      this._hoverRotCorner = null;
      let cursor = '';
      if (this.runtime && !this._sliceMode) {
        const hoverWorld = this._boneWorldTransforms();
        const hoverBox = this._selectedObjectBox(hoverWorld);
        if (hoverBox) {
          const rotHit = this._hitRotateZone(mx, my, hoverBox);
          if (rotHit) {
            this._hoverRotCorner = rotHit.corner;
            cursor = 'grab';
          } else if (this._hitBoxHandles(mx, my, hoverBox)) {
            cursor = 'nwse-resize';
          }
        }
      }
      if (this.el.canvas.style.cursor !== cursor) this.el.canvas.style.cursor = cursor;
      return;
    }
    // 拖拽首次实际移动才入历史（纯点击不污染撤销栈）；pan/marquee 不改文档不入栈
    if (this._drag.kind !== 'pan' && this._drag.kind !== 'marquee') this._ensureDragHistory();
    // 骨骼长度调整：叶子骨骼末端拖动 = 鼠标世界位置到骨骼原点的距离，沿骨骼自身方向投影
    // Shift+拖 = 骨骼 scaleX 缩放（保持 length 不变，整体缩放该骨骼及其子树/挂图）
    if (this._drag.kind === 'tip-length') {
      const bone = this._boneById(this._drag.boneId);
      const boneWorld = this._boneWorldTransforms().get(this._drag.boneId);
      if (!bone || !boneWorld) return;
      const mouseWorld = this._screenToWorld(mx, my);
      const dx = mouseWorld.x - boneWorld.x;
      const dy = mouseWorld.y - boneWorld.y;
      const cos = Math.cos(-boneWorld.rad);
      const sin = Math.sin(-boneWorld.rad);
      const along = dx * cos - dy * sin; // 骨骼自身 x 轴分量
      if (event.shiftKey) {
        const parentSx = (boneWorld.sx || 1) / (bone.scaleX || 1);
        bone.scaleX = Math.max(0.1, Math.round((along / Math.max(1, bone.length) / parentSx) * 100) / 100);
      } else {
        bone.length = Math.max(2, Math.round(along / (boneWorld.sx || 1)));
      }
      this._markDirty();
      return;
    }
    if (this._drag.kind === 'pan') {
      this.view.ox = this._drag.ox + (mx - this._drag.startX);
      this.view.oy = this._drag.oy + (my - this._drag.startY);
      return;
    }
    // 框选：更新选框
    if (this._drag.kind === 'marquee') {
      this._drag.currentX = mx;
      this._drag.currentY = my;
      return;
    }
    // 附件缩放：8 手柄拖拽 → 按手柄方向改 attachment.width/height（角=双向，边=单向，Shift+角=等比）
    if (this._drag.kind === 'attach-scale') {
      const slot = this._slotById(this._drag.slotId);
      if (!slot?.attachment) { this._drag = null; return; }
      const boneWorld = this._drag.boneWorld;
      const cos = Math.cos(-this._drag.angle);
      const sin = Math.sin(-this._drag.angle);
      const unitX = (boneWorld?.sx || 1) * this.view.scale;
      const unitY = (boneWorld?.sy || 1) * this.view.scale;
      const lx = ((mx - this._drag.startX) * cos - (my - this._drag.startY) * sin) / unitX;
      const ly = ((mx - this._drag.startX) * sin + (my - this._drag.startY) * cos) / unitY;
      const key = this._drag.handle;
      let width = this._drag.startW;
      let height = this._drag.startH;
      if (key.includes('e')) width = this._drag.startW + lx;
      if (key.includes('w')) width = this._drag.startW - lx;
      if (key.includes('s')) height = this._drag.startH + ly;
      if (key.includes('n')) height = this._drag.startH - ly;
      width = Math.max(1, width);
      height = Math.max(1, height);
      if (event.shiftKey && key.length === 2) {
        // 角手柄+Shift=等比：取变化比例较大者
        const ratio = Math.max(width / this._drag.startW, height / this._drag.startH);
        width = Math.max(1, this._drag.startW * ratio);
        height = Math.max(1, this._drag.startH * ratio);
      }
      slot.attachment.width = Math.round(width);
      slot.attachment.height = Math.round(height);
      this._markDirty();
      this.runtime = parseSkeletonAsset(structuredClone(this.doc));
      this._renderInspector();
      return;
    }
    // 附件拖拽：移动 = 世界位移→骨骼局部空间写入 attachment.x/y
    if (this._drag.kind === 'attach-move') {
      const slot = this._slotById(this._drag.slotId);
      if (!slot?.attachment) { this._drag = null; return; }
      if (this._isSlotInteractiveLocked(slot.id, slot.bone)) { this._drag = null; return; }
      {
        const worldDx = (mx - this._drag.startX) / this.view.scale;
        const worldDy = (my - this._drag.startY) / this.view.scale;
        // 拖放换绑探测：仅 Shift+拖（rebindEnabled）时启用——鼠标靠近其他骨骼原点（16px）
        // 记录目标，松手重挂（保持世界位置）；默认拖拽永不换绑，防「一点一拖就全乱」
        this._drag.rebindTarget = this._drag.rebindEnabled === true
          ? this._pickBoneOrigin(mx, my, this._boneWorldTransforms(), 16, slot.bone)
          : null;
        if (this._drag.rebindTarget) return; // 悬停目标骨骼上时冻结偏移预览，松手换绑
        this._applyAttachMove(slot, this._drag.boneWorld, this._drag.startOffset, worldDx, worldDy);
        // 多选槽位同步拖动
        for (const extra of this._drag.extraSlots || []) {
          const extraSlot = this._slotById(extra.id);
          if (extraSlot?.attachment) this._applyAttachMove(extraSlot, extra.boneWorld, extra.startOffset, worldDx, worldDy);
        }
      }
      this._markDirty();
      this.runtime = parseSkeletonAsset(structuredClone(this.doc));
      this._renderInspector();
      return;
    }
    // 统一旋转：图片 = 锚点绕圆心公转 + 自转（rot）；骨骼 = 原点公转 + 自转（装配模式挂图世界固定补偿）
    if (this._drag.kind === 'object-rotate') {
      const deltaRad = Math.atan2(my - this._drag.pivotY, mx - this._drag.pivotX) - this._drag.startAngle;
      const deltaDeg = Math.round((deltaRad / DEG2RAD) * 10) / 10;
      const cos = Math.cos(deltaRad);
      const sin = Math.sin(deltaRad);
      const orbit = point => {
        const dx = point.x - this._drag.pivotX;
        const dy = point.y - this._drag.pivotY;
        return { x: this._drag.pivotX + dx * cos - dy * sin, y: this._drag.pivotY + dx * sin + dy * cos };
      };
      if (this._drag.boxKind === 'slot') {
        const slot = this._slotById(this._drag.id);
        if (!slot?.attachment) { this._drag = null; return; }
        // 锚点屏幕坐标绕圆心公转 → 世界坐标 → 骨骼局部空间反算 attachment.x/y；rot 自转
        const startAnchorScreen = this._worldToScreen(this._drag.startAnchorWorld.x, this._drag.startAnchorWorld.y);
        const nextAnchorWorld = this._screenToWorld(orbit(startAnchorScreen).x, orbit(startAnchorScreen).y);
        const boneWorld = this._boneWorldTransforms().get(slot.bone) || this._drag.boneWorld;
        const vx = nextAnchorWorld.x - boneWorld.x;
        const vy = nextAnchorWorld.y - boneWorld.y;
        const invCos = Math.cos(-boneWorld.rad);
        const invSin = Math.sin(-boneWorld.rad);
        this._writeAttachmentOffset(slot, {
          x: ((vx * invCos - vy * invSin) / (boneWorld.sx || 1)),
          y: ((vx * invSin + vy * invCos) / (boneWorld.sy || 1)),
          rot: Math.round((this._drag.startRot + deltaDeg) * 10) / 10
        });
        this._markDirty();
        this.runtime = parseSkeletonAsset(structuredClone(this.doc));
        this._renderInspector();
        return;
      }
      const bone = this._boneById(this._drag.id);
      if (!bone) { this._drag = null; return; }
      // 绕自身关节纯旋转：只写 rot，x/y 不动——关节不飘移，父骨条（画向子骨骼原点）不伸缩
      const nextRot = Math.round((this._drag.startRot + deltaDeg) * 10) / 10;
      const clip = this._clip();
      if (this.editMode === 'setup' || !clip) {
        // 装配模式（或无当前剪辑兜底）：改静止姿态 rot；绑定挂图世界固定补偿（锚点反算 x/y，rot 还原）
        bone.rot = nextRot;
        this._markDirty();
        this.runtime = parseSkeletonAsset(structuredClone(this.doc));
        const world2 = this._boneWorldTransforms();
        const boneWorld2 = world2.get(bone.id);
        if (boneWorld2) {
          for (const saved of this._drag.startSlotAnchors || []) {
            const slot = this._slotById(saved.id);
            if (!slot?.attachment) continue;
            const vx = saved.anchorWorld.x - boneWorld2.x;
            const vy = saved.anchorWorld.y - boneWorld2.y;
            const invCos = Math.cos(-boneWorld2.rad);
            const invSin = Math.sin(-boneWorld2.rad);
            this._writeAttachmentOffset(slot, {
              x: ((vx * invCos - vy * invSin) / (boneWorld2.sx || 1)),
              y: ((vx * invSin + vy * invCos) / (boneWorld2.sy || 1)),
              rot: saved.rot
            });
          }
        }
        this.runtime = parseSkeletonAsset(structuredClone(this.doc));
      } else {
        // 动画模式：只打 rot 关键帧（与移动只写 x/y 同模式；无轨道自动建轨）
        this._ensureTrackAndKey(bone.id, clip, { rot: nextRot });
      }
      this._renderInspector();
      this._renderTimeline();
      return;
    }
    const bone = this._boneById(this._drag.boneId);
    if (!bone) return;
    if (this._isBoneLocked(bone.id)) { this._drag = null; return; }
    const clip = this._clip();
    const track = clip?.tracks?.find(candidate => candidate.bone === bone.id) || null;
    const parent = this._drag.parent;

    // 手柄缩放骨骼：距骨骼原点的屏幕距离比例 → scaleX/scaleY（角手柄=等比，e/w=scaleX，n/s=scaleY；
    // 装配改静止姿态，动画打关键帧）
    if (this._drag.kind === 'bone-scale') {
      const ratio = Math.max(8, Math.hypot(mx - this._drag.anchorX, my - this._drag.anchorY)) / this._drag.startDist;
      const nextScaleX = Math.max(0.05, Math.round(this._drag.startScaleX * ratio * 100) / 100);
      const nextScaleY = Math.max(0.05, Math.round(this._drag.startScaleY * ratio * 100) / 100);
      const applyX = this._drag.axis !== 'y';
      const applyY = this._drag.axis !== 'x';
      const partial = {};
      if (applyX) partial.scaleX = nextScaleX;
      if (applyY) partial.scaleY = nextScaleY;
      if (this.editMode === 'setup') {
        if (applyX) bone.scaleX = nextScaleX;
        if (applyY) bone.scaleY = nextScaleY;
        this._markDirty();
        this.runtime = parseSkeletonAsset(structuredClone(this.doc));
      } else if (track) {
        this._upsertKey(track, { t: Math.round(this.previewTime), ...partial });
        this._markDirty();
        this.runtime = parseSkeletonAsset(structuredClone(this.doc)); // 重建采样：连续缩放每帧都要新姿态
        this._renderTimeline();
      } else {
        this._ensureTrackAndKey(bone.id, clip, partial);
        this._renderTimeline();
      }
      this._renderInspector();
      return;
    }

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
      if (this.editMode === 'setup' || !clip) {
        // 装配模式（或无当前剪辑兜底）：直接改静止姿态，不打关键帧；未显式同选的挂图保持世界位置（反算偏移）
        bone.x = Math.round(nextX * 10) / 10;
        bone.y = Math.round(nextY * 10) / 10;
        this._markDirty();
        this.runtime = parseSkeletonAsset(structuredClone(this.doc));
        this._keepAttachmentsWorldFixed(bone.id, worldDx, worldDy);
        // 多选骨骼：整体移动，各自反算挂图
        for (const extra of this._drag.extraBones || []) this._setupMoveExtraBone(extra, worldDx, worldDy);
        this.runtime = parseSkeletonAsset(structuredClone(this.doc));
      } else {
        if (track) {
          this._upsertKey(track, { t: Math.round(this.previewTime), x: nextX, y: nextY });
          this._markDirty();
          this.runtime = parseSkeletonAsset(structuredClone(this.doc)); // 重建采样：连续拖拽每帧都要新姿态
        } else {
          // 所见即所得：拖动无轨道骨骼 = 自动建轨道并在当前时间打关键帧（摆姿势即录入）
          this._ensureTrackAndKey(bone.id, clip, { x: nextX, y: nextY });
        }
        // 多选骨骼：整体移动（打关键帧）
        for (const extra of this._drag.extraBones || []) this._animateMoveExtraBone(extra, worldDx, worldDy, clip);
      }
    }
    this._renderInspector();
    this._renderTimeline();
  }

  /** 附件移动应用：世界位移 → 该槽位骨骼局部空间写入 attachment.x/y。 */
  _applyAttachMove(slot, boneWorld, startOffset, worldDx, worldDy) {
    let localDx = worldDx;
    let localDy = worldDy;
    if (boneWorld) {
      const cos = Math.cos(-boneWorld.rad);
      const sin = Math.sin(-boneWorld.rad);
      localDx = (worldDx * cos - worldDy * sin) / (boneWorld.sx || 1);
      localDy = (worldDx * sin + worldDy * cos) / (boneWorld.sy || 1);
    }
    this._writeAttachmentOffset(slot, { x: startOffset.x + localDx, y: startOffset.y + localDy });
  }

  /** 装配模式：骨骼平移后，未显式同选的挂图反算偏移，保持图片世界位置不动。 */
  _keepAttachmentsWorldFixed(boneId, worldDx, worldDy) {
    const boneWorld = this.runtime ? this._boneWorldTransforms().get(boneId) : null;
    const sx = boneWorld?.sx || 1;
    const sy = boneWorld?.sy || 1;
    for (const slot of this.doc.slots || []) {
      if (slot.bone !== boneId || this.selectedSlots.has(slot.id)) continue;
      if (!slot.attachment || slot.attachment.type === 'empty') continue;
      const offset = this._effectiveAttachmentOffset(slot.attachment);
      this._writeAttachmentOffset(slot, { x: offset.x - worldDx / sx, y: offset.y - worldDy / sy });
    }
  }

  /** 装配模式多选骨骼：整体移动 + 各自挂图反算。 */
  _setupMoveExtraBone(extra, worldDx, worldDy) {
    const bone = this._boneById(extra.id);
    if (!bone) return;
    const cos = Math.cos(-extra.parent.rad);
    const sin = Math.sin(-extra.parent.rad);
    bone.x = Math.round((extra.startLocal.x + (worldDx * cos - worldDy * sin) / (extra.parent.sx || 1)) * 10) / 10;
    bone.y = Math.round((extra.startLocal.y + (worldDx * sin + worldDy * cos) / (extra.parent.sy || 1)) * 10) / 10;
    this._markDirty();
    this.runtime = parseSkeletonAsset(structuredClone(this.doc));
    this._keepAttachmentsWorldFixed(extra.id, worldDx, worldDy);
  }

  /** 动画模式多选骨骼：整体移动（走关键帧路径）。 */
  _animateMoveExtraBone(extra, worldDx, worldDy, clip) {
    if (!clip) return;
    const bone = this._boneById(extra.id);
    if (!bone) return;
    const cos = Math.cos(-extra.parent.rad);
    const sin = Math.sin(-extra.parent.rad);
    const nextX = extra.startLocal.x + (worldDx * cos - worldDy * sin) / (extra.parent.sx || 1);
    const nextY = extra.startLocal.y + (worldDx * sin + worldDy * cos) / (extra.parent.sy || 1);
    const track = (clip.tracks || []).find(candidate => candidate.bone === extra.id);
    if (track) {
      this._upsertKey(track, { t: Math.round(this.previewTime), x: nextX, y: nextY });
      this._markDirty();
    } else {
      this._ensureTrackAndKey(extra.id, clip, { x: nextX, y: nextY });
    }
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
    // 递归树展开（折叠节点不展开子级），rows 顺序 = bones 数组的树序
    const rows = [];
    const walk = (node, depth) => {
      rows.push({ node, depth });
      if (this._collapsedBones.has(node.bone.id)) return;
      for (const child of node.children) walk(child, depth + 1);
    };
    for (const root of this._buildBoneTree()) walk(root, 0);

    container.innerHTML = rows.map(({ node, depth }) => {
      const bone = node.bone;
      const state = this._boneEffectiveState(bone.id);
      const hasChildren = node.children.length > 0;
      const collapsed = this._collapsedBones.has(bone.id);
      const eyeTitle = state.selfHidden
        ? '自身已隐藏（级联子骨骼），点击显示'
        : state.inheritedHiddenFrom
          ? `继承自父级 ${state.inheritedHiddenFrom} 的隐藏（点击切自身状态）`
          : '点击隐藏（级联子骨骼）';
      const lockTitle = state.selfLocked
        ? '自身已锁定：画布不可点选/拖拽，点击解锁'
        : state.inheritedLockedFrom
          ? `继承自父级 ${state.inheritedLockedFrom} 的锁定（点击切自身状态）`
          : '未锁定：点击锁定防误触（级联子骨骼）';
      const eyeStyle = state.selfHidden
        ? 'background:#3a3a3a;border-color:#666;opacity:.75;'
        : `background:#254830;border-color:#4a8a4a;${state.inheritedHiddenFrom ? 'opacity:.35;' : ''}`;
      const lockStyle = state.selfLocked
        ? 'background:#5a2a2a;border-color:#c0504a;'
        : `background:#26365f;border-color:#5574ad;${state.inheritedLockedFrom ? 'opacity:.35;' : ''}`;
      return `
      <div class="se-bone-item ${this.selectedBones.has(bone.id) ? 'selected' : ''}" data-id="${bone.id}" draggable="true"
        style="padding-left:${4 + depth * 16}px;">
        <span class="se-collapse" data-collapse="${hasChildren ? '1' : ''}" title="${collapsed ? '展开子骨骼' : '折叠子骨骼'}"
          style="flex:none;width:14px;font-size:10px;color:#9aa5c0;text-align:center;cursor:${hasChildren ? 'pointer' : 'default'};">${hasChildren ? (collapsed ? '▸' : '▾') : ''}</span>
        <button class="se-tgl" data-kind="vis" title="${eyeTitle}"
          style="flex:none;width:20px;height:18px;padding:0;font-size:10px;line-height:1;border-radius:3px;border:1px solid;cursor:pointer;${eyeStyle}">${state.selfHidden ? '🚫' : '👁'}</button>
        <button class="se-tgl" data-kind="lock" title="${lockTitle}"
          style="flex:none;width:20px;height:18px;padding:0;font-size:10px;line-height:1;border-radius:3px;border:1px solid;cursor:pointer;${lockStyle}">${state.selfLocked ? '🔒' : '🔓'}</button>
        <span class="name">${SkeletonEditor._displayName(bone.id)}</span>
      </div>`;
    }).join('');

    for (const item of container.querySelectorAll('.se-bone-item')) {
      item.addEventListener('click', event => {
        if (event.ctrlKey || event.metaKey) return; // Ctrl 点击走 mousedown 加选
        const boneId = item.dataset.id;
        if (event.target.closest('[data-collapse="1"]')) {
          if (this._collapsedBones.has(boneId)) this._collapsedBones.delete(boneId);
          else this._collapsedBones.add(boneId);
          this._renderBoneTree();
          return;
        }
        const button = event.target.closest('.se-tgl');
        if (button) {
          if (button.dataset.kind === 'vis') {
            if (this._hiddenBones.has(boneId)) this._hiddenBones.delete(boneId);
            else this._hiddenBones.add(boneId);
          } else if (this._lockedBones.has(boneId)) this._lockedBones.delete(boneId);
          else this._lockedBones.add(boneId);
          this._renderBoneTree();
          this._renderSlotList(); // 槽位继承骨骼链状态，同步刷新
          return;
        }
        this.selectedBone = boneId;
        this.selectedSlot = null;
        this._renderBoneTree();
        this._renderSlotList();
        this._renderInspector();
      });

      // Ctrl+点击 = 加选/减选骨骼（不开始拖拽）
      item.addEventListener('mousedown', event => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        this._toggleBoneInSelection(item.dataset.id);
        this._renderBoneTree();
        this._renderInspector();
      });

      // 拖拽改父子/排序：行中部 50% = 设为目标子级；上/下 25% = 插到目标前/后（同级）
      item.addEventListener('dragstart', event => {
        event.dataTransfer.setData('text/se-bone', item.dataset.id);
        event.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragover', event => {
        if (![...(event.dataTransfer.types || [])].includes('text/se-bone')) return;
        event.preventDefault();
        const zone = this._dropZoneOf(item, event.clientY);
        event.dataTransfer.dropEffect = 'move';
        item.style.outline = zone === 'child' ? '1px dashed #ffd479' : '1px solid #2a4a3e';
        item.style.borderTop = zone === 'before' ? '2px solid #4CAF50' : '';
        item.style.borderBottom = zone === 'after' ? '2px solid #4CAF50' : '';
      });
      item.addEventListener('dragleave', () => this._clearDropHint(item));
      item.addEventListener('drop', event => {
        event.preventDefault();
        this._clearDropHint(item);
        const boneId = event.dataTransfer.getData('text/se-bone');
        const targetId = item.dataset.id;
        if (!boneId || boneId === targetId) return;
        const zone = this._dropZoneOf(item, event.clientY);
        const target = this._boneById(targetId);
        if (zone === 'child') {
          if (!this._reparentBone(boneId, targetId)) this._toast('禁止投放：目标是自身/子孙或根骨骼不可移动', true);
        } else {
          // 同级插入：父 = 目标的父；before = 目标（上区）或目标的下一个同级（下区）
          let beforeId = targetId;
          if (zone === 'after') {
            const list = this.doc.bones;
            const at = list.indexOf(target);
            const next = list.slice(at + 1).find(candidate => (candidate.parent || null) === (target.parent || null));
            beforeId = next ? next.id : null;
          }
          if (!this._reparentBone(boneId, target.parent || null, beforeId)) this._toast('禁止投放：目标是自身/子孙或根骨骼不可移动', true);
        }
      });
    }
  }

  /** 行内投放区域：上 25% = before，下 25% = after，中间 = child。 */
  _dropZoneOf(item, clientY) {
    const rect = item.getBoundingClientRect();
    const ratio = (clientY - rect.top) / Math.max(1, rect.height);
    if (ratio < 0.25) return 'before';
    if (ratio > 0.75) return 'after';
    return 'child';
  }

  _clearDropHint(item) {
    item.style.outline = '';
    item.style.borderTop = '';
    item.style.borderBottom = '';
  }

  /** 拖拽改父子/排序（防环；根骨骼不可动）。beforeId 非空 = 插到该同级之前。 */
  _reparentBone(boneId, newParentId, beforeId = null) {
    const bone = this._boneById(boneId);
    if (!bone || boneId === this.doc.bones[0]?.id) return false;
    let cursor = newParentId || null;
    while (cursor) {
      if (cursor === boneId) return false; // 目标父是自身或子孙
      cursor = this._boneById(cursor)?.parent || null;
    }
    this._pushHistory();
    bone.parent = newParentId || null;
    const list = this.doc.bones;
    list.splice(list.indexOf(bone), 1);
    if (beforeId) {
      const at = list.findIndex(candidate => candidate.id === beforeId);
      if (at >= 0) list.splice(at, 0, bone);
      else list.push(bone);
    } else if (newParentId) {
      let at = list.findIndex(candidate => candidate.id === newParentId) + 1;
      while (at < list.length && list[at].parent === newParentId) at += 1;
      list.splice(at, 0, bone);
    } else {
      list.push(bone);
    }
    this._markDirty();
    this._renderBoneTree();
    this._renderInspector();
    return true;
  }

  /* ---------------- 编辑模式 & 方向预览 ---------------- */

  _setEditMode(mode) {
    if (this.editMode === mode) return;
    this.editMode = mode;
    this._refreshModeButtons();
    this._toast(this.editMode === 'setup' ? '装配模式：移动骨骼时图片保持不动（反算挂点）' : '动画模式：骨骼带动图片，拖拽实时打关键帧');
  }

  _refreshModeButtons() {
    const $ = id => document.getElementById(id);
    const setup = $('se-mode-setup');
    const animate = $('se-mode-animate');
    if (setup) setup.style.background = this.editMode === 'setup' ? '#2a4a3e' : '';
    if (animate) animate.style.background = this.editMode === 'animate' ? '#2a4a3e' : '';
  }

  _setPreviewDirection(dir) {
    this.previewDirection = dir;
    this._refreshDirectionButtons();
    this._draw();
  }

  _refreshDirectionButtons() {
    for (const d of ['down', 'side', 'up']) {
      const btn = document.getElementById(`se-dir-${d}`);
      if (btn) btn.style.background = this.previewDirection === d ? '#2a4a3e' : '';
    }
  }

  /** 显示模式切换：'all' 图片+骨架 | 'bones' 仅骨架 | 'images' 仅图片。 */
  _setDisplayMode(mode) {
    if (this.displayMode === mode) return;
    this.displayMode = mode;
    this._refreshDisplayButtons();
    this._draw();
    const labels = { all: '图片+骨架', bones: '仅骨架（挂件已隐藏，骨骼名已标注）', images: '仅图片（骨骼线已隐藏）' };
    this._toast(`显示：${labels[mode] || mode}`);
  }

  _refreshDisplayButtons() {
    for (const mode of ['all', 'bones', 'images']) {
      const btn = document.getElementById(`se-disp-${mode}`);
      if (btn) btn.style.background = this.displayMode === mode ? '#2a4a3e' : '';
    }
  }

  /** 剪辑名后缀推断方向：_down/_up/_side → 方向；无后缀返回 null。 */
  _directionFromClip(clipName) {
    const str = String(clipName || '');
    if (str.endsWith('_down')) return 'down';
    if (str.endsWith('_up')) return 'up';
    if (str.endsWith('_side')) return 'side';
    return null;
  }

  /** 当前预览方向下，三态头部槽位是否应显示。仅影响编辑器画布预览，不覆写 JSON。 */
  _isHeadSlotVisibleInPreview(slotId) {
    const plan = {
      down: { headFront: true, headSide: false, headBack: false, hairFront: true, hairSide: false, hairBack: false },
      side: { headFront: false, headSide: true, headBack: false, hairFront: false, hairSide: true, hairBack: false },
      up: { headFront: false, headSide: false, headBack: true, hairFront: false, hairSide: false, hairBack: true }
    }[this.previewDirection];
    if (!plan || !(slotId in plan)) return null; // 非三态槽位 = 不干涉
    return plan[slotId];
  }

  _renderSlotList() {
    const container = this.el.slotList;
    // 图层栈显示：z 降序 = 最上层在列表最顶（与 Photoshop 图层面板同惯例）
    const slots = [...(this.doc.slots || [])].sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
    container.innerHTML = slots.length > 0 ? slots.map((slot, index) => {
      const selfHidden = this._hiddenSlots.has(slot.id);
      const selfLocked = this._lockedSlots.has(slot.id);
      // 继承：所属骨骼链被隐藏/锁定（画布交互同样生效，此处补图标提示）
      const boneHidden = this._isBoneHidden(slot.bone);
      const boneLocked = this._isBoneLocked(slot.bone);
      const inheritedHidden = !selfHidden && boneHidden;
      const inheritedLocked = !selfLocked && boneLocked;
      const eyeStyle = selfHidden
        ? 'background:#3a3a3a;border-color:#666;opacity:.85;'
        : `background:#254830;border-color:#4a8a4a;${inheritedHidden ? 'opacity:.35;' : ''}`;
      const lockStyle = selfLocked
        ? 'background:#5a2a2a;border-color:#c0504a;'
        : `background:#26365f;border-color:#5574ad;${inheritedLocked ? 'opacity:.35;' : ''}`;
      const eyeTitle = selfHidden ? '仅在编辑器中显示此槽位附件'
        : inheritedHidden ? `继承自骨骼 ${slot.bone} 链的隐藏（点击切自身状态）`
        : '仅在编辑器中隐藏此槽位附件';
      const lockTitle = selfLocked ? '已锁定：画布不可点选/拖拽，点击解锁'
        : inheritedLocked ? `继承自骨骼 ${slot.bone} 链的锁定（点击切自身状态）`
        : '未锁定：点击锁定防误触';
      return `
      <div class="se-slot-item ${this.selectedSlots.has(slot.id) ? 'selected' : ''}" data-id="${slot.id}"
        draggable="true" title="拖动调整图层顺序（z）；右键=置顶/上一层/下一层/置底"
        style="${selfHidden || boneHidden ? 'opacity:.55;' : ''}">
        <button class="se-tgl" data-kind="vis" title="${eyeTitle}"
          style="flex:none;width:20px;height:18px;padding:0;font-size:10px;line-height:1;border-radius:3px;border:1px solid;cursor:pointer;${eyeStyle}">${selfHidden ? '🚫' : '👁'}</button>
        <button class="se-tgl" data-kind="lock" title="${lockTitle}"
          style="flex:none;width:20px;height:18px;padding:0;font-size:10px;line-height:1;border-radius:3px;border:1px solid;cursor:pointer;${lockStyle}">${selfLocked ? '🔒' : '🔓'}</button>
        <span class="name">${SkeletonEditor._displayName(slot.id)} · ${SkeletonEditor._attachmentType(slot.attachment?.type)} · 骨骼(bone):${SkeletonEditor._displayName(slot.bone)} · z${slot.z}</span>
      </div>`;
    }).join('') : '<div class="se-empty">暂无槽位</div>';
    for (const item of container.querySelectorAll('.se-slot-item')) {
      item.addEventListener('click', event => {
        const toggle = event.target.closest('.se-tgl');
        const slotId = item.dataset.id;
        if (toggle) {
          if (toggle.dataset.kind === 'vis') {
            if (this._hiddenSlots.has(slotId)) this._hiddenSlots.delete(slotId);
            else this._hiddenSlots.add(slotId);
          } else if (this._lockedSlots.has(slotId)) this._lockedSlots.delete(slotId);
          else this._lockedSlots.add(slotId);
          this._renderSlotList();
          return;
        }
        if (event.ctrlKey || event.metaKey) {
          // Ctrl+点击 = 加选/减选槽位（不抢占骨骼选中）
          this._toggleSlotInSelection(slotId);
        } else {
          this.selectedSlot = slotId; // 单选语义：不再联动改 selectedBone
        }
        // 图片库联动高亮：选中槽位时同步高亮其引用图片
        this._selectedImageId = this._slotById(slotId)?.attachment?.assetId || this._selectedImageId;
        this._renderSlotList();
        this._renderBoneTree();
        this._renderInspector();
        this._renderImageLib();
      });
    }
    // 拖拽排序（z）+ 右键层序菜单（置顶/上一层/下一层/置底，与画布右键同款）
    for (const item of container.querySelectorAll('.se-slot-item')) {
      const slotId = item.dataset.id;
      item.addEventListener('contextmenu', event => {
        event.preventDefault();
        event.stopPropagation();
        if (this.selectedSlot !== slotId) {
          this.selectedSlot = slotId;
          this._renderSlotList();
          this._renderInspector();
        }
        this._showContextMenu(event, this._buildZOrderMenuItems(slotId), SkeletonEditor._displayName(slotId));
      });
      item.addEventListener('dragstart', event => {
        this._slotDrag = { id: slotId, overId: null, position: null };
        event.dataTransfer.setData('text/se-slot-order', slotId);
        event.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        this._slotDrag = null;
        this._clearSlotDropIndicators(container);
      });
      item.addEventListener('dragover', event => {
        if (!this._slotDrag || this._slotDrag.id === slotId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = item.getBoundingClientRect();
        const position = (event.clientY - rect.top) < rect.height / 2 ? 'above' : 'below';
        if (this._slotDrag.overId !== slotId || this._slotDrag.position !== position) {
          this._slotDrag.overId = slotId;
          this._slotDrag.position = position;
          this._clearSlotDropIndicators(container);
          item.classList.add(position === 'above' ? 'drop-above' : 'drop-below');
        }
      });
    }
    // 容器级 drop 监听只绑一次（innerHTML 重渲染不清除容器自身监听，避免重复叠加）
    if (!container._slotOrderDropBound) {
      container._slotOrderDropBound = true;
      container.addEventListener('drop', event => {
        event.preventDefault();
        const drag = this._slotDrag;
        if (!drag?.overId) return;
        this._reorderSlotByDrag(drag.id, drag.overId, drag.position);
      });
      container.addEventListener('dragover', event => {
        if (this._slotDrag) event.preventDefault();
      });
    }
  }

  /** 清除槽位列表的拖放插入指示线。 */
  _clearSlotDropIndicators(container) {
    for (const row of container.querySelectorAll('.se-slot-item.drop-above, .se-slot-item.drop-below')) {
      row.classList.remove('drop-above', 'drop-below');
    }
  }

  /**
   * 拖拽排序落点：把拖动槽位插到目标槽位上/下沿，随后全量重排 z 为 0..n-1。
   * 列表为 z 降序显示（上=最上层），因此「视觉上方」= 更高层。
   */
  _reorderSlotByDrag(dragId, overId, position) {
    const slots = [...(this.doc.slots || [])].sort((a, b) => (b.z ?? 0) - (a.z ?? 0)); // [0]=最上层
    const from = slots.findIndex(slot => slot.id === dragId);
    if (from < 0 || !slots.some(slot => slot.id === overId) || dragId === overId) return;
    this._pushHistory();
    const [moved] = slots.splice(from, 1);
    let target = slots.findIndex(slot => slot.id === overId);
    if (position === 'below') target += 1; // 视觉下方 = 更低层 = 插到目标之后
    slots.splice(target, 0, moved);
    // 降序数组反写 z：数组越靠前 z 越大（最上层）
    slots.forEach((slot, slotIndex) => { slot.z = slots.length - 1 - slotIndex; });
    this._markDirty();
    this.runtime = parseSkeletonAsset(structuredClone(this.doc));
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

  /** 命名 → 中文(英文) 显示文本（骨骼/槽位/图片通用）。 */
  static _displayName(id) {
    const map = {
      // 骨骼
      root: '根(root)', hips: '胯(hips)', torso: '躯干(torso)', head: '头(head)',
      armUL: '左上臂(armUL)', armUR: '右上臂(armUR)', armFL: '左前臂(armFL)', armFR: '右前臂(armFR)',
      thighL: '左大腿(thighL)', thighR: '右大腿(thighR)', calfL: '左小腿(calfL)', calfR: '右小腿(calfR)',
      back: '背(back)',
      // 部件分类
      arm: '手臂(arm)', leg: '腿部(leg)', skirt: '裙(skirt)', weapon: '武器(weapon)',
      // weaponKey / direction
      axe: '斧(axe)', spear: '枪(spear)',
      front: '正面(front)', side: '侧面(side)',
      // 槽位
      shadow: '影子(shadow)', spearBack: '背枪(spearBack)', skirtBack: '背裙(skirtBack)',
      toolHand: '手持(toolHand)', torsoSlot: '躯干图(torsoSlot)', skirtFront: '前裙(skirtFront)',
      headFront: '正面头(headFront)', headSide: '侧面头(headSide)', headBack: '背面头(headBack)',
      weaponSpear: '手持枪(weaponSpear)', weaponSkinningKnife: '手持剥皮刀(weaponSkinningKnife)',
      weaponWolfFang: '手持狼牙(weaponWolfFang)', weaponBow: '手持弓(weaponBow)', weaponStaff: '手持符杖(weaponStaff)',
      weaponAxe: '手持斧(weaponAxe)', axeBack: '背斧(axeBack)',
      armor: '护甲(armor)',
      // 剪辑
      idle_down: '待机-下(idle_down)', idle_up: '待机-上(idle_up)', idle_side: '待机-侧(idle_side)',
      walk_down: '行走-下(walk_down)', walk_up: '行走-上(walk_up)', walk_side: '行走-侧(walk_side)',
      walk_SE: '行走-右下(walk_SE)', walk_SW: '行走-左下(walk_SW)',
      walk_NE: '行走-右上(walk_NE)', walk_NW: '行走-左上(walk_NW)',
      jump: '跳跃(jump)', attack: '攻击(attack)',
      gather: '采集(gather)', logging: '砍伐(logging)', mining: '挖矿(mining)', fishing: '钓鱼(fishing)',
      climb_back: '攀爬(climb_back)', sleep: '睡觉(sleep)', stretcher: '担架(stretcher)',
      death: '死亡(death)', soul: '灵魂(soul)',
      legThighL: '左大腿(legThighL)', legThighR: '右大腿(legThighR)',
      legCalfL: '左小腿(legCalfL)', legCalfR: '右小腿(legCalfR)',
      // 图片 assetId 通用部件名（剥离 player.parts. 前缀后的 key）
      'head-front': '正面头(head-front)', 'head-side': '侧面头(head-side)', 'head-back': '背面头(head-back)',
      'torso-front': '正面躯干(torso-front)', 'torso-side': '侧面躯干(torso-side)', 'torso-back': '背面躯干(torso-back)',
      'upper-arm-l': '左上臂(upper-arm-l)', 'upper-arm-r': '右上臂(upper-arm-r)',
      'fore-arm-l': '左前臂(fore-arm-l)', 'fore-arm-r': '右前臂(fore-arm-r)',
      'thigh-l': '左大腿(thigh-l)', 'thigh-r': '右大腿(thigh-r)',
      'calf-l': '左小腿(calf-l)', 'calf-r': '右小腿(calf-r)',
      'skirt-front': '前裙(skirt-front)', 'skirt-back': '背裙(skirt-back)',
      'weapon-spear': '枪(weapon-spear)', 'weapon-axe': '斧(weapon-axe)',
      'weapon-skinningKnife': '剥皮刀(weapon-skinningKnife)', 'weapon-wolfFang': '狼牙(weapon-wolfFang)',
      'weapon-bow': '短弓(weapon-bow)', 'weapon-staff': '符杖(weapon-staff)',
      'weapon-front': '正面武器(weapon-front)', 'weapon-side': '侧面武器(weapon-side)', 'weapon-back': '背面武器(weapon-back)',
      'armor-leather': '皮甲(armor-leather)', 'armor-iron': '铁甲(armor-iron)',
      // 方向 / 朝向 / 左右（部件 direction / side 字段）
      back: '背面(back)', left: '左(left)', right: '右(right)',
      // 部件分类（未收录的种族/器械）
      wolf: '狼(wolf)', horse: '马(horse)', rider: '骑手(rider)', ram: '冲车(ram)',
      catapult: '投石机(catapult)', tower: '塔楼(tower)',
      // 坐骑 / NPC / 器械完整 assetId（物种前缀区分同名词，如狼头 vs 马头）
      'wolf.parts.body': '狼身(body)', 'wolf.parts.neck': '狼颈(neck)', 'wolf.parts.head': '狼头(head)',
      'wolf.parts.jaw': '狼颚(jaw)', 'wolf.parts.tail': '狼尾(tail)',
      'wolf.parts.leg-upper': '狼大腿(leg-upper)', 'wolf.parts.leg-lower': '狼小腿(leg-lower)',
      'horse.parts.body': '马身(body)', 'horse.parts.neck': '马颈(neck)', 'horse.parts.head': '马头(head)',
      'horse.parts.tail': '马尾(tail)', 'horse.parts.saddle': '马鞍(saddle)',
      'horse.parts.leg-upper': '马大腿(leg-upper)', 'horse.parts.leg-lower': '马小腿(leg-lower)',
      'rider.parts.torso': '骑手躯干(torso)', 'rider.parts.head': '骑手头(head)',
      'rider.parts.arm-upper': '骑手上臂(arm-upper)', 'rider.parts.arm-fore': '骑手前臂(arm-fore)',
      'ram.parts.base': '冲车底座(base)', 'ram.parts.roof': '冲车顶棚(roof)', 'ram.parts.cover': '冲车护板(cover)',
      'ram.parts.arm': '冲车撞杆(arm)', 'ram.parts.head': '冲车头锤(head)', 'ram.parts.wheel': '冲车轮(wheel)',
      'ram.parts.pusher': '冲车推手(pusher)',
      'catapult.parts.base': '投石机底座(base)', 'catapult.parts.wheel': '投石机轮(wheel)',
      'catapult.parts.frame': '投石机框架(frame)', 'catapult.parts.arm': '投石机投臂(arm)',
      'catapult.parts.sling': '投石机弹兜(sling)', 'catapult.parts.weight': '投石机配重(weight)',
      'catapult.parts.stone': '投石机石弹(stone)',
      'tower.parts.base': '塔楼底座(base)', 'tower.parts.wheel': '塔楼轮(wheel)',
      'tower.parts.body-1': '塔楼身1(body-1)', 'tower.parts.body-2': '塔楼身2(body-2)', 'tower.parts.body-3': '塔楼身3(body-3)',
      'tower.parts.platform': '塔楼平台(platform)', 'tower.parts.ladder': '塔楼梯(ladder)', 'tower.parts.shield': '塔楼盾板(shield)'
    };
    // 先精确匹配
    if (map[id]) return map[id];
    // 图片 assetId 格式：xxx.parts.xxx-name，取最后一段再精确匹配
    const lastPart = String(id).split('.').pop();
    if (map[lastPart]) return map[lastPart];
    // 兜底：原样返回（自定义命名未收录时保持英文）
    return id;
  }

  /** 附件类型 → 中文(英文) 显示文本（槽位列表用）。 */
  static _attachmentType(type) {
    const map = {
      empty: '空(empty)', image: '图片(image)', slice: '切片(slice)', sequence: '序列帧(sequence)'
    };
    return map[type || 'empty'] || type || '空(empty)';
  }

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
      .map(bone => `<option value="${bone.id}">${SkeletonEditor._displayName(bone.id)}</option>`).join('');
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

  /**
   * 槽位图层序（z）调整：'top' 置顶 | 'up' 上一层 | 'down' 下一层 | 'bottom' 置底。
   * 绘制顺序 = z 升序；调整后全量重排 z 为 0..n-1，保持序号连续。
   * @returns {boolean} 是否发生移动
   */
  _adjustSlotZ(slotId, action) {
    const slots = [...(this.doc.slots || [])].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    const index = slots.findIndex(slot => slot.id === slotId);
    if (index < 0) return false;
    let target = index;
    if (action === 'top') target = slots.length - 1;
    else if (action === 'bottom') target = 0;
    else if (action === 'up') target = Math.min(slots.length - 1, index + 1);
    else if (action === 'down') target = Math.max(0, index - 1);
    if (target === index) return false;
    this._pushHistory();
    const [moved] = slots.splice(index, 1);
    slots.splice(target, 0, moved);
    slots.forEach((slot, slotIndex) => { slot.z = slotIndex; });
    this._markDirty();
    this.runtime = parseSkeletonAsset(structuredClone(this.doc));
    this._renderSlotList();
    this._renderInspector();
    return true;
  }

  /** 右键菜单的图层序操作项：置顶/上一层/下一层/置底（边界自动禁用）。 */
  _buildZOrderMenuItems(slotId) {
    const slot = this._slotById(slotId);
    if (!slot) return [];
    const slots = [...(this.doc.slots || [])].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    const index = slots.findIndex(candidate => candidate.id === slotId);
    const isTop = index >= slots.length - 1;
    const isBottom = index <= 0;
    return [
      { label: '⤒ 置顶', disabled: isTop, action: () => this._adjustSlotZ(slotId, 'top') },
      { label: '↑ 上一层', disabled: isTop, action: () => this._adjustSlotZ(slotId, 'up') },
      { label: '↓ 下一层', disabled: isBottom, action: () => this._adjustSlotZ(slotId, 'down') },
      { label: '⤓ 置底', disabled: isBottom, action: () => this._adjustSlotZ(slotId, 'bottom') }
    ];
  }

  /** 某骨骼的主挂件槽位（按 z 最小取）；无挂件返回 null。时间轴行右键的层序操作目标。 */
  _primarySlotOfBone(boneId) {
    return (this.doc.slots || [])
      .filter(slot => slot.bone === boneId)
      .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))[0] || null;
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

  /* ---------------- 部件库 ---------------- */

  _setLibTab(tab) {
    const partsEl = document.getElementById('se-part-lib');
    const assetsEl = document.getElementById('se-image-lib');
    const presetsEl = document.getElementById('se-preset-lib');
    const partsBtn = document.getElementById('se-tab-parts');
    const assetsBtn = document.getElementById('se-tab-assets');
    const presetsBtn = document.getElementById('se-tab-presets');
    if (!partsEl || !assetsEl || !presetsEl) return;
    partsEl.style.display = tab === 'parts' ? '' : 'none';
    assetsEl.style.display = tab === 'assets' ? '' : 'none';
    presetsEl.style.display = tab === 'presets' ? '' : 'none';
    if (partsBtn) partsBtn.style.background = tab === 'parts' ? '#2a4a3e' : '';
    if (assetsBtn) assetsBtn.style.background = tab === 'assets' ? '#2a4a3e' : '';
    if (presetsBtn) presetsBtn.style.background = tab === 'presets' ? '#2a4a3e' : '';
    if (tab === 'presets') this._renderPresetLib();
  }

  /* ---------------- 动作模板（animation presets：套用即深拷贝，零数据关联） ---------------- */

  /** 当前文档拓扑识别：与各模板的骨名集合求重合度，取最高分（缓存模板骨集）。 */
  async _detectTopology() {
    if (!this.doc) return null;
    if (!this._tplBoneSets) {
      this._tplBoneSets = new Map();
      for (const templateId of SKELETON_TEMPLATES) {
        try {
          const tpl = await this._fetchTemplate(templateId);
          this._tplBoneSets.set(templateId.replace(/^tpl\./, ''), new Set(tpl.bones.map(b => b.id)));
        } catch { /* 模板缺失跳过 */ }
      }
    }
    const docBones = new Set((this.doc.bones || []).map(b => b.id));
    let best = null;
    let bestScore = 0;
    for (const [topology, bones] of this._tplBoneSets.entries()) {
      let score = 0;
      for (const id of bones) if (docBones.has(id)) score++;
      const ratio = score / bones.size;
      if (ratio > bestScore) { bestScore = ratio; best = topology; }
    }
    return bestScore >= 0.6 ? best : null;
  }

  /** 动作模板面板：按拓扑分组列出预设；顶部「存为预设」。 */
  async _renderPresetLib() {
    const container = document.getElementById('se-preset-lib');
    if (!container) return;
    if (!this.presetIndex) {
      try {
        const res = await fetch(`/${this.gameRoot}/assets/skeletons/anim-presets/index.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.presetIndex = await res.json();
      } catch (error) {
        container.innerHTML = `<div style="padding:8px;color:#e08080;font-size:12px;">预设索引读取失败：${error.message}</div>`;
        return;
      }
    }
    const topology = await this._detectTopology();
    const groups = new Map();
    for (const preset of this.presetIndex) {
      if (!groups.has(preset.topology)) groups.set(preset.topology, []);
      groups.get(preset.topology).push(preset);
    }
    const html = [
      '<div style="padding:6px 8px;border-bottom:1px solid #26355c;display:flex;gap:4px;align-items:center;">',
      `<span style="font-size:11px;color:#9aa5c0;">当前拓扑：${topology ? `<b style="color:#8fd0a8;">${topology}</b>` : '未识别（全部列出）'}</span>`,
      '<span style="flex:1;"></span>',
      '<button id="se-preset-save" style="flex:none;font-size:11px;padding:2px 6px;" title="把当前剪辑序列化为预设 JSON（可新建或覆盖）">💾 存为预设</button>',
      '</div>'
    ];
    for (const [presetTopology, presets] of groups) {
      if (topology && presetTopology !== topology) continue;
      html.push(`<div style="padding:4px 8px;font-size:11px;color:#5a6a90;border-bottom:1px solid #1c2742;">${presetTopology}</div>`);
      for (const preset of presets) {
        html.push(`<div class="se-preset-item" data-preset-id="${preset.presetId}" style="padding:3px 8px;font-size:12px;cursor:pointer;border-bottom:1px solid #1c2742;display:flex;justify-content:space-between;">`
          + `<span>${preset.clipName}</span><span style="color:#5a6a90;">${preset.durationMs}ms${preset.loop === false ? ' ⏹' : ' ↻'}</span></div>`);
      }
    }
    container.innerHTML = html.join('');
    container.querySelectorAll('.se-preset-item').forEach(item => {
      item.addEventListener('click', () => this._applyPreset(item.dataset.presetId));
      item.addEventListener('mouseenter', () => { item.style.background = '#1c2a4a'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
    });
    document.getElementById('se-preset-save')?.addEventListener('click', () => this._saveClipAsPreset());
  }

  /** 套用预设：按骨名匹配写入轨道（匹配不到的骨跳过），可撤销；同名剪辑需确认覆盖。 */
  async _applyPreset(presetId) {
    if (!this.doc) return;
    let preset;
    try {
      const res = await fetch(`/${this.gameRoot}/assets/skeletons/anim-presets/${presetId}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      preset = await res.json();
    } catch (error) {
      this._toast(`预设读取失败：${error.message}`, true);
      return;
    }
    const docBones = new Set((this.doc.bones || []).map(b => b.id));
    const matchedTracks = (preset.tracks || []).filter(track => docBones.has(track.bone));
    if (matchedTracks.length === 0) {
      this._toast(`预设 ${presetId} 没有任何轨道匹配当前骨架，未套用`, true);
      return;
    }
    const existing = (this.doc.clips || []).find(clip => clip.name === preset.clipName);
    if (existing && !confirm(`剪辑「${preset.clipName}」已存在，覆盖？（可 Ctrl+Z 撤销）`)) return;
    this._pushHistory();
    const clip = {
      name: preset.clipName,
      durationMs: preset.durationMs || 1000,
      loop: preset.loop !== false,
      tracks: structuredClone(matchedTracks)
    };
    if (existing) {
      const index = this.doc.clips.indexOf(existing);
      this.doc.clips[index] = clip;
    } else {
      this.doc.clips.push(clip);
    }
    this.currentClip = clip.name;
    this.previewTime = 0;
    this._afterDocChange();
    this._markDirty();
    const skipped = (preset.tracks || []).length - matchedTracks.length;
    this._toast(`已套用 ${presetId}（匹配 ${matchedTracks.length} 条轨道${skipped > 0 ? `，跳过 ${skipped} 条` : ''}）——深拷贝写入，与预设无关联`);
  }

  /** 当前剪辑 → 预设 JSON（保存经 /api/skeleton-asset-transaction 的 presets 通道写 anim-presets/）。 */
  async _saveClipAsPreset() {
    const clip = this._clip();
    if (!clip) { this._toast('当前没有剪辑', true); return; }
    const topology = await this._detectTopology();
    const suggested = `${topology || 'custom'}.${clip.name}`;
    const presetId = (prompt('预设 ID（拓扑.动作名）：', suggested) || '').trim();
    if (!presetId) return;
    if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(presetId)) { this._toast('预设 ID 不合法', true); return; }
    const preset = {
      presetId, topology: topology || 'custom', clipName: clip.name,
      durationMs: clip.durationMs || 1000, loop: clip.loop !== false,
      tracks: structuredClone(clip.tracks || [])
    };
    const result = await this.commands.savePreset(this.projectPath, preset);
    if (result.ok) {
      if (!this.presetIndex.some(item => item.presetId === presetId)) {
        this.presetIndex.push({ presetId, topology: preset.topology, clipName: preset.clipName, durationMs: preset.durationMs, loop: preset.loop });
        this._renderPresetLib();
      }
      this._toast(`预设已保存：anim-presets/${presetId}.json（只影响之后的套用）`);
    } else {
      this._toast(`预设保存失败：${result.error || '未知错误'}`, true);
    }
  }

  /** 部件库：按 category 分组显示，点击「挂骨骼」一键创建槽位（含 partId）。 */
  _renderPartLib() {
    const container = document.getElementById('se-part-lib');
    if (!container) return;
    const slots = this.doc?.slots || [];
    const usedPartIds = new Set(slots.map(slot => slot.attachment?.partId).filter(Boolean));
    const categories = new Map();
    for (const [id, part] of this.partCatalog) {
      const cat = part.category || '其他';
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat).push({ id, part });
    }
    const sortedCats = [...categories.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    // 部件体检面板：扫描灰盒/缺图部件，结果行可点击定位（已绑槽位同时选中）
    const checkRows = this._partCheckResult?.rows || [];
    const checkPanel = `
      <div style="display:flex;align-items:center;gap:6px;padding:0 2px 6px;">
        <button id="se-part-check" style="flex:none;font-size:11px;padding:2px 8px;cursor:pointer;">🔍 部件体检</button>
        <span style="font-size:10px;color:#9aa5c0;">扫描灰盒/缺图部件</span>
      </div>
      ${this._partCheckResult ? `<div style="max-height:140px;overflow:auto;border:1px solid #26355c;border-radius:4px;margin:0 2px 6px;">
        ${checkRows.map(row => `
        <div class="se-part-check-row" data-id="${row.id}" title="${row.detail || ''}${row.boundSlotId ? '（已绑槽位 ' + row.boundSlotId + '）' : ''}"
          style="display:flex;gap:6px;align-items:center;padding:2px 6px;font-size:11px;cursor:pointer;${row.warn ? 'color:#ff9a9a;' : 'color:#9aa5c0;'}">
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${row.name}</span>
          <span style="flex:none;">${row.detail || ''}</span>
          <span style="flex:none;font-weight:bold;">${row.verdict}</span>
        </div>`).join('')}
      </div>` : ''}`;
    container.innerHTML = checkPanel + (sortedCats.map(([cat, list]) => {
      const rows = list.map(({ id, part }) => {
        const used = usedPartIds.has(id);
        const img = this.imageCatalog.get(part.assetId);
        const display = SkeletonEditor._displayName(part.assetId);
        const dirTag = part.direction ? `<span style="color:#5a6a90;font-size:10px;">${SkeletonEditor._displayName(part.direction)}</span>` : '';
        const sideTag = part.side ? `<span style="color:#5a6a90;font-size:10px;">${SkeletonEditor._displayName(part.side)}</span>` : '';
        return `
        <div class="se-img-item ${id === this._selectedPartId ? 'selected' : ''}" data-id="${id}" style="${used ? 'opacity:.55;' : ''}">
          <img src="${img?.url || ''}" loading="lazy" alt="${id}" style="width:32px;height:32px;object-fit:contain;border-radius:3px;background:#1a2440;">
          <span class="name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${display}${dirTag ? ' ' + dirTag : ''}${sideTag ? ' ' + sideTag : ''}</span>
          <button data-bind="1" style="flex:none;font-size:10px;padding:1px 4px;" title="作为部件挂到推荐骨骼（${SkeletonEditor._displayName(part.bone || '')}）">→挂骨骼</button>
        </div>`;
      }).join('');
      return `
      <div style="margin-bottom:6px;">
        <div style="font-size:11px;color:#7ec8ff;padding:2px 4px;border-bottom:1px solid #26355c;">${SkeletonEditor._displayName(cat)}</div>
        ${rows}
      </div>`;
    }).join('') || '<div class="se-empty">内容库无部件定义</div>');
    for (const item of container.querySelectorAll('.se-img-item')) {
      item.addEventListener('click', () => {
        this._selectedPartId = item.dataset.id;
        this._renderPartLib();
      });
    }
    // 体检：运行扫描 + 结果行点击定位（选中部件；已绑槽位时同时选中槽位）
    container.querySelector('#se-part-check')?.addEventListener('click', () => { this._runPartCheck(); });
    for (const row of container.querySelectorAll('.se-part-check-row')) {
      row.addEventListener('click', () => {
        const partId = row.dataset.id;
        this._selectedPartId = partId;
        const slot = (this.doc.slots || []).find(candidate => candidate.attachment?.partId === partId);
        if (slot) {
          this.selectedSlot = slot.id;
          this.selectedBone = slot.bone;
        }
        this._renderSlotList();
        this._renderBoneTree();
        this._renderInspector();
        this._renderPartLib();
      });
    }
    for (const button of container.querySelectorAll('button[data-bind]')) {
      button.addEventListener('click', event => {
        event.stopPropagation();
        this._bindPartToSelectedBone(event.target.closest('.se-img-item').dataset.id);
      });
    }
    // 拖拽组合：按住部件拖进画布 → 落到哪根骨骼就挂到哪，松手位置=挂点（所见即所得）
    for (const item of container.querySelectorAll('.se-img-item')) {
      item.draggable = true;
      item.addEventListener('dragstart', event => {
        const part = this.partCatalog.get(item.dataset.id);
        if (!part) return;
        event.dataTransfer.setData('text/se-part', item.dataset.id);
        event.dataTransfer.effectAllowed = 'copy';
        this._libDrag = { partId: item.dataset.id, assetId: part.assetId, mx: null, my: null, dropWorld: null, hoverBone: null };
      });
      item.addEventListener('dragend', () => { this._libDrag = null; });
    }
  }

  /** 确保图片元素已加载（体检 alpha 扫描前置）；返回元素或 null。 */
  _ensureImageLoaded(assetId) {
    const entry = this.imageCatalog.get(assetId);
    if (!entry) return Promise.resolve(null);
    if (entry.element?.complete && entry.element.naturalWidth > 0) return Promise.resolve(entry.element);
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        entry.width = img.naturalWidth;
        entry.height = img.naturalHeight;
        entry.element = img;
        // 图片元素替换后清掉该资源的 alpha 缓存，避免读到旧扫描结果
        for (const key of [...this._alphaBoundsCache.keys()]) {
          if (key.startsWith(`${assetId}|`)) this._alphaBoundsCache.delete(key);
        }
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = entry.url;
    });
  }

  /**
   * 部件体检：扫描全部部件图的非透明内容占比。
   * 内容占画布 <12% 判定为灰盒/内容过小（⚠），结果按问题优先排序，行点击可定位槽位。
   */
  async _runPartCheck() {
    this._toast('部件体检中…');
    const rows = [];
    for (const [id, part] of this.partCatalog) {
      const name = SkeletonEditor._displayName(part.assetId || id);
      const entry = this.imageCatalog.get(part.assetId);
      if (!entry) {
        rows.push({ id, name, verdict: '缺图', detail: 'Manifest 无此资源', warn: true });
        continue;
      }
      const element = await this._ensureImageLoaded(part.assetId);
      if (!element) {
        rows.push({ id, name, verdict: '加载失败', detail: entry.url, warn: true });
        continue;
      }
      const attachment = { assetId: part.assetId, type: 'image' };
      const source = this._attachmentSource(attachment);
      const bounds = source ? this._alphaBounds(attachment, source) : null;
      if (!bounds) {
        rows.push({ id, name, verdict: '—', detail: '整图不透明（无 alpha 可扫）', warn: false });
        continue;
      }
      const contentW = Math.round(bounds.x1 - bounds.x0);
      const contentH = Math.round(bounds.y1 - bounds.y0);
      const ratio = (contentW * contentH) / Math.max(1, source.sw * source.sh);
      const warn = ratio < 0.12;
      rows.push({
        id, name,
        verdict: warn ? '⚠ 灰盒' : '✓',
        detail: `内容 ${contentW}×${contentH}（${Math.round(ratio * 100)}%）`,
        warn,
        boundSlotId: (this.doc.slots || []).find(slot => slot.attachment?.partId === id)?.id || null
      });
    }
    rows.sort((a, b) => (b.warn ? 1 : 0) - (a.warn ? 1 : 0));
    this._partCheckResult = { rows, at: Date.now() };
    this._renderPartLib();
    this._toast(`体检完成：${rows.filter(row => row.warn).length}/${rows.length} 个部件需要处理`);
  }

  /** 部件绑定：读取 part 定义，创建含 partId 的槽位，自动挂上推荐骨骼。 */
  _bindPartToSelectedBone(partId) {
    const part = this.partCatalog.get(partId);
    if (!part) { this._toast('部件未找到', true); return; }
    this._pushHistory();
    // 部件自带推荐挂点优先；用户想挂别的骨骼可先选中该骨骼再挂（此时 selectedBone 覆盖 part.bone 需清空选中）
    const boneId = part.bone || this.selectedBone || this.doc.bones?.[0]?.id;
    if (!boneId) { this._toast('先选中一个骨骼', true); return; }
    // 已挂载同 partId 到同骨骼 → 直接选中并点亮（预置槽位 visible:false 是运行时联动初始态）
    const existing = (this.doc.slots || []).find(slot => slot.attachment?.partId === partId && slot.bone === boneId);
    if (existing) {
      this.selectedSlot = existing.id;
      if (existing.attachment && existing.attachment.visible === false) {
        this._pushHistory();
        existing.attachment.visible = true;
        this._markDirty();
        this.runtime = parseSkeletonAsset(structuredClone(this.doc));
      }
      this._toast('该骨骼已挂此部件，已选中其槽位');
      this._renderSlotList();
      this._renderInspector();
      this._renderPartLib();
      return;
    }
    const attachment = {
      type: 'image',
      assetId: part.assetId,
      partId,
      x: 0, y: 0, rot: 0,
      width: Number(part.width) || 0,
      height: Number(part.height) || 0
    };
    const index = (this.doc.slots || []).length;
    const slotId = partId.replace(/\./g, '-');
    const uniqueId = (this.doc.slots || []).some(s => s.id === slotId) ? `${slotId}-${index}` : slotId;
    const slot = {
      id: uniqueId,
      bone: boneId,
      z: (this.doc.slots || []).reduce((max, candidate) => Math.max(max, candidate.z), 0) + 1,
      attachment
    };
    this.doc.slots = this.doc.slots || [];
    this.doc.slots.push(slot);
    this.selectedSlot = slot.id;
    this.selectedBone = boneId;
    this._markDirty();
    this.runtime = parseSkeletonAsset(structuredClone(this.doc)); // 重建 runtime 让画布立即渲染新槽位
    this._renderSlotList();
    this._renderBoneTree();
    this._renderInspector();
    this._renderPartLib();
    this._renderImageLib();
    this._toast(`已挂载 ${SkeletonEditor._displayName(part.assetId)} → 骨骼 ${SkeletonEditor._displayName(boneId)}`);
  }

  /** 拖拽组合的落点反算：附件中心对齐世界坐标 worldPos（挂点偏移=世界坐标→骨骼局部，需按骨骼旋转逆转，与 _attachmentAnchorWorld 互逆）。 */
  _applyAttachmentDropOffset(slot, boneId, worldPos) {
    if (!worldPos) return;
    const boneWorld = this._boneWorldTransforms().get(boneId);
    if (!boneWorld) return;
    const dx = worldPos.x - boneWorld.x;
    const dy = worldPos.y - boneWorld.y;
    const cos = Math.cos(-boneWorld.rad);
    const sin = Math.sin(-boneWorld.rad);
    this._writeAttachmentOffset(slot, {
      x: ((dx * cos - dy * sin) / (boneWorld.sx || 1)),
      y: ((dx * sin + dy * cos) / (boneWorld.sy || 1))
    });
  }

  /**
   * 拖拽组合核心（部件库 → 画布）：把部件挂到骨骼 boneId，附件中心落在松手点（所见即所得）。
   * 同部件已挂载时复用其槽位：换绑到目标骨骼并把位置挪到落点（Fireworks 式「放下即就位」）。
   */
  _bindPartAt(partId, boneId, worldPos = null) {
    const part = this.partCatalog.get(partId);
    if (!part) { this._toast('部件未找到', true); return; }
    if (!this._boneById(boneId)) { this._toast('目标骨骼不存在', true); return; }
    this._pushHistory();
    const existing = (this.doc.slots || []).find(slot => slot.attachment?.partId === partId);
    let slot = existing;
    if (existing) {
      existing.bone = boneId;
      if (existing.attachment) existing.attachment.visible = true;
      this.selectedSlot = existing.id;
    } else {
      const attachment = {
        type: 'image', assetId: part.assetId, partId, x: 0, y: 0, rot: 0,
        width: Number(part.width) || 0, height: Number(part.height) || 0
      };
      const index = (this.doc.slots || []).length;
      const baseId = partId.replace(/\./g, '-');
      const uniqueId = (this.doc.slots || []).some(candidate => candidate.id === baseId) ? `${baseId}-${index}` : baseId;
      slot = {
        id: uniqueId,
        bone: boneId,
        z: (this.doc.slots || []).reduce((max, candidate) => Math.max(max, candidate.z), 0) + 1,
        attachment
      };
      this.doc.slots = this.doc.slots || [];
      this.doc.slots.push(slot);
      this.selectedSlot = slot.id;
    }
    this._applyAttachmentDropOffset(slot, boneId, worldPos);
    this.selectedBone = boneId;
    this._markDirty();
    this.runtime = parseSkeletonAsset(structuredClone(this.doc));
    this._renderSlotList();
    this._renderBoneTree();
    this._renderInspector();
    this._renderPartLib();
    this._renderImageLib();
    this._toast(`已组合 ${SkeletonEditor._displayName(part.assetId)} → ${SkeletonEditor._displayName(boneId)}${worldPos ? '（落点即位置）' : ''}${this.displayMode === 'bones' ? '（仅骨架视图，切「图片+骨架」查看）' : ''}`);
  }

  /**
   * 拖拽组合（图片库 → 画布）：把图片作为 image 附件挂到骨骼 boneId，附件中心落在松手点。
   * 同图片已挂载时复用其首个槽位（换绑 + 挪到落点）。
   */
  _bindAssetAt(assetId, boneId, worldPos = null) {
    if (!this.imageCatalog.has(assetId)) { this._toast('图片未找到', true); return; }
    if (!this._boneById(boneId)) { this._toast('目标骨骼不存在', true); return; }
    this._pushHistory();
    const existing = (this.doc.slots || []).find(slot => slot.attachment?.assetId === assetId);
    let slot = existing;
    if (existing) {
      existing.bone = boneId;
      this.selectedSlot = existing.id;
    } else {
      const attachment = { type: 'image', assetId, x: 0, y: 0, rot: 0, ...this._defaultAttachmentSize(assetId) };
      const index = (this.doc.slots || []).length;
      slot = {
        id: `slot_${assetId.replace(/[^a-zA-Z0-9-]/g, '-').slice(-24)}_${index}`,
        bone: boneId,
        z: (this.doc.slots || []).reduce((max, candidate) => Math.max(max, candidate.z), 0) + 1,
        attachment
      };
      this.doc.slots = this.doc.slots || [];
      this.doc.slots.push(slot);
      this.selectedSlot = slot.id;
    }
    this._applyAttachmentDropOffset(slot, boneId, worldPos);
    this.selectedBone = boneId;
    this._markDirty();
    this.runtime = parseSkeletonAsset(structuredClone(this.doc));
    this._renderSlotList();
    this._renderBoneTree();
    this._renderInspector();
    this._renderImageLib();
    this._renderPartLib();
    this._toast(`已组合 ${SkeletonEditor._displayName(assetId)} → ${SkeletonEditor._displayName(boneId)}${worldPos ? '（落点即位置）' : ''}${this.displayMode === 'bones' ? '（仅骨架视图，切「图片+骨架」查看）' : ''}`);
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
        <span class="name" title="${assetId}${path ? '（' + path + '）' : ''}">${SkeletonEditor._displayName(assetId)}</span>
        ${boundBadge}
        ${action}
      </div>`;
    }).join('') : '<div class="se-empty">Manifest 无图片资产</div>';
    for (const item of container.querySelectorAll('.se-img-item')) {
      item.addEventListener('click', () => {
        this._selectedImageId = item.dataset.id;
        this._renderImageLib();
      });
      // 拖拽组合：按住图片拖进画布 → 落到哪根骨骼就挂到哪
      item.draggable = true;
      item.addEventListener('dragstart', event => {
        if (!this.imageCatalog.has(item.dataset.id)) return;
        event.dataTransfer.setData('text/se-asset', item.dataset.id);
        event.dataTransfer.effectAllowed = 'copy';
        this._libDrag = { partId: null, assetId: item.dataset.id, mx: null, my: null, dropWorld: null, hoverBone: null };
      });
      item.addEventListener('dragend', () => { this._libDrag = null; });
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
    this.runtime = parseSkeletonAsset(structuredClone(this.doc)); // 重建 runtime 让画布立即移除槽位
    this._renderSlotList();
    this._renderImageLib();
    this._toast(`已解绑 ${assetId}：移除槽位 ${detail}`);
  }

  /**
   * 新建 image 附件的默认绘制尺寸：sprite sheet 按 manifest 网格取单帧；
   * 普通图取原尺寸，超出设计盒时等比缩小到盒内（不放大小图）——
   * 避免「挂上即巨大且难缩放」，且检查器立即可见具体数值可微调。
   */
  _defaultAttachmentSize(assetId) {
    const item = this.imageCatalog.get(assetId);
    const grid = item?.entry?.grid;
    const naturalWidth = item?.element?.naturalWidth || item?.width || 0;
    const naturalHeight = item?.element?.naturalHeight || item?.height || 0;
    let width = 0;
    let height = 0;
    if (grid?.columns > 0 && grid?.rows > 0 && naturalWidth && naturalHeight) {
      width = Math.round(naturalWidth / grid.columns);
      height = Math.round(naturalHeight / grid.rows);
    } else if (naturalWidth && naturalHeight) {
      const meta = this.doc?.meta || { width: 100, height: 160 };
      const fit = Math.min(1, meta.width / naturalWidth, meta.height / naturalHeight);
      width = Math.max(1, Math.round(naturalWidth * fit));
      height = Math.max(1, Math.round(naturalHeight * fit));
    }
    return { width, height };
  }

  /** 把图片库中的图片绑定到选中骨骼：自动创建槽位（z 置顶）+ image 附件。 */
  _bindImageToSelectedBone(assetId) {
    this._pushHistory();
    const boneId = this.selectedBone || this.doc.bones?.[0]?.id;
    if (!boneId) { this._toast('先选中一个骨骼', true); return; }
    const existing = (this.doc.slots || []).find(slot => slot.attachment?.assetId === assetId && slot.bone === boneId);
    if (existing) { this.selectedSlot = existing.id; this._toast('该骨骼已挂此图片，已选中其槽位'); this._renderSlotList(); return; }
    const attachment = { type: 'image', assetId, x: 0, y: 0, rot: 0, ...this._defaultAttachmentSize(assetId) };
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
    this.runtime = parseSkeletonAsset(structuredClone(this.doc)); // 重建 runtime 让画布立即渲染新槽位
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
    this.el.inspectorTitle.textContent = `骨骼 · ${SkeletonEditor._displayName(bone.id)}`;
    const parentOptions = (this.doc.bones || [])
      .filter(candidate => candidate.id !== bone.id && !this._isDescendant(bone.id, candidate.id))
      .map(candidate => `<option value="${candidate.id}" ${bone.parent === candidate.id ? 'selected' : ''}>${SkeletonEditor._displayName(candidate.id)}</option>`)
      .join('');
    // 关联挂件：绑定到本骨骼的槽位列表（哪根骨头挂哪张图，双向可见的第一半）
    const boundSlots = (this.doc.slots || []).filter(slot => slot.bone === bone.id);
    const boundRows = boundSlots.map(slot => {
      const att = slot.attachment || {};
      const imageName = att.assetId ? SkeletonEditor._displayName(att.assetId) : (att.type || 'empty');
      return `<div class="se-img-item se-bound-slot-row" data-slot="${slot.id}" title="点击选中该槽位（可改绑定骨骼/偏移/尺寸）">
        <span class="name">${SkeletonEditor._displayName(slot.id)}</span>
        <span style="flex:none;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7ec8ff;">${imageName}</span>
        ${att.visible === false ? '<span style="flex:none;color:#5a6a90;" title="不可见（运行时联动初始态）">隐</span>' : ''}
      </div>`;
    }).join('');
    body.innerHTML = `
      <div class="row"><label>ID</label><input type="text" id="se-bone-id" value="${bone.id}"></div>
      <div class="row"><label>父骨骼</label><select id="se-bone-parent"><option value="">(根)</option>${parentOptions}</select></div>
      <div class="row"><label>X</label><input type="number" id="se-bone-x" step="1" value="${bone.x}"></div>
      <div class="row"><label>Y</label><input type="number" id="se-bone-y" step="1" value="${bone.y}"></div>
      <div class="row"><label>旋转°</label><input type="number" id="se-bone-rot" step="1" value="${bone.rot}"></div>
      <div class="row"><label>缩放X</label><input type="number" id="se-bone-sx" step="0.1" value="${bone.scaleX ?? 1}"></div>
      <div class="row"><label>缩放Y</label><input type="number" id="se-bone-sy" step="0.1" value="${bone.scaleY ?? 1}"></div>
      <div class="row"><label>长度</label><input type="number" id="se-bone-length" min="0" step="1" value="${bone.length ?? 0}"></div>
      <div class="se-attachment-box">
        <div style="font-size:12px;color:#7ec8ff;margin-bottom:4px;">关联挂件（${boundSlots.length}）<span style="color:#5a6a90;font-size:10px;">— 点击行选中槽位，可改绑定骨骼/偏移/尺寸</span></div>
        ${boundRows || '<div class="se-empty" style="text-align:left;">无挂件——左侧部件库/图片库「→挂骨骼」，或直接拖图进画布落到本骨骼</div>'}
      </div>
      <div class="se-empty" style="text-align:left;">画布：拖骨身=移动 / 黄环/角外圈=绕关节旋转 / 叶子骨骼末端拖=调长度（Shift=X缩放）/ Alt+点击=穿透图片选骨骼 / 滚轮缩放 / 右键平移</div>
    `;
    // 关联挂件行点击 → 选中该槽位（检查器切到槽位属性，骨骼下拉可换绑且保持世界位置）
    for (const row of body.querySelectorAll('.se-bound-slot-row')) {
      row.addEventListener('click', () => {
        if (!this._slotById(row.dataset.slot)) return;
        this.selectedSlot = row.dataset.slot;
        this._renderSlotList();
        this._renderInspector();
      });
    }
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
    bar.querySelector('#se-ov-bone').textContent = SkeletonEditor._displayName(bone.id);
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
    this.el.inspectorTitle.textContent = `槽位 · ${SkeletonEditor._displayName(slot.id)}`;
    const attachment = slot.attachment || { type: 'empty' };
    const imageOptions = [...this.imageCatalog.keys()]
      .map(id => `<option value="${id}" ${attachment.assetId === id ? 'selected' : ''}>${SkeletonEditor._displayName(id)}</option>`)
      .join('');
    const boneOptions = (this.doc.bones || [])
      .map(bone => `<option value="${bone.id}" ${slot.bone === bone.id ? 'selected' : ''}>${SkeletonEditor._displayName(bone.id)}</option>`)
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
      ${attachment.partId ? `<div class="row"><label>部件</label><span style="flex:1;min-width:0;font-size:11px;color:#7ec8ff;">${SkeletonEditor._displayName(attachment.partId)}</span></div>` : ''}
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
        ${(() => {
          const offset = this._effectiveAttachmentOffset(attachment);
          const dirLabel = { down: '正面（基准）', side: '侧面', up: '背面' }[this.previewDirection] || '正面';
          const dirTag = this.previewDirection === 'down'
            ? '<span style="font-size:11px;color:#9aa5c0;">正面基准</span>'
            : `<span style="font-size:11px;color:#4CAF50;" title="切换到正面可编辑基准位">✎ ${dirLabel}专用偏移</span>`;
          return `<div class="row"><label style="min-width:auto;">偏移</label>${dirTag}</div>
        <div class="row"><label>偏移X</label><input type="number" id="se-att-x" step="1" value="${offset.x}"></div>
        <div class="row"><label>偏移Y</label><input type="number" id="se-att-y" step="1" value="${offset.y}"></div>
        <div class="row"><label>旋转°</label><input type="number" id="se-att-rot" step="1" value="${offset.rot}"></div>`;
        })()}
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
      <div class="se-empty" style="text-align:left;">画布：拖动图片=改绑定点偏移（黄菱形，即与骨骼的相对位置）/ 右键=切 移动·旋转·缩放 模式 / Shift+拖图片=拖到骨点换绑 / 偏移X·Y·旋转=精确数值 / Alt+点击=穿透选骨骼 / Ctrl+点击=加选 / 方向键=微移</div>
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
      const assetId = attachment.assetId || [...this.imageCatalog.keys()][0] || '';
      // image 类型按图片库默认尺寸自适应设计盒（同挂载路径）；slice/sequence 保持各自默认
      const size = type === 'image' ? this._defaultAttachmentSize(assetId) : { width: 0, height: 0 };
      slot.attachment = type === 'empty'
        ? { type, x: 0, y: 0, rot: 0 }
        : { type, assetId, x: 0, y: 0, rot: 0, ...size };
      if (type === 'slice') Object.assign(slot.attachment, { sx: 0, sy: 0, sw: 32, sh: 32 });
      if (type === 'sequence') Object.assign(slot.attachment, { fps: 8, frames: [] });
      this._markDirty();
      this._afterDocChange();
    });
    const bindAttachment = (id, field, transform = Number) => {
      const element = $(id);
      if (!element) return;
      element.addEventListener('change', event => {
        const value = transform(event.target.value);
        // 偏移三件套按当前预览方向写入（down=基准；side/up=该方向专用覆盖），其余字段恒写顶层
        if (field === 'x' || field === 'y' || field === 'rot') {
          this._writeAttachmentOffset(slot, { [field]: value });
        } else {
          slot.attachment[field] = value;
        }
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
    // 全量轨道：按骨骼树顺序列出所有骨骼——没打过关键帧的骨骼也显示（置灰空行），
    // 与左侧骨骼树一一对应，避免「时间轴看起来比骨骼树少腿」；双击空行 = 建轨道并以当前姿态打关键帧
    const trackByBone = new Map((clip.tracks || []).map(track => [track.bone, track]));
    const orderedBones = [];
    const walkTree = node => {
      orderedBones.push(node.bone);
      for (const child of node.children) walkTree(child);
    };
    for (const root of this._buildBoneTree()) walkTree(root);
    const rows = orderedBones.map(bone => {
      const track = trackByBone.get(bone.id) || null;
      // 循环衔接提示：最后关键帧 → 剪辑结尾与首帧自动插值（隐式首帧），
      // 画虚线 + 右端空心菱形，美术一眼看出结尾会平滑回到开头姿态。
      // 末帧已贴剪辑结尾（补过循环尾帧）时不画：循环直接闭环，无隐式回插段。
      let loopTie = '';
      if (track && clip.loop !== false && (track.keys || []).length > 0
        && clip.durationMs - track.keys[track.keys.length - 1].t > 5) {
        const lastLeft = ((track.keys[track.keys.length - 1].t / clip.durationMs) * 100).toFixed(3);
        const firstT = track.keys[0].t;
        loopTie = `<div class="se-tl-loop-tie" style="left:${lastLeft}%" title="循环衔接：此段自动插值回首帧姿态（t=${firstT}ms）"></div>`
          + '<div class="se-tl-key se-tl-key-ghost" title="隐式首帧：剪辑结尾自动衔接到这里对应的姿态"></div>';
      }
      const keys = track ? (track.keys || []).map((key, index) => {
        const left = (key.t / clip.durationMs) * 100;
        const selected = this.selectedKey?.bone === track.bone && this.selectedKey?.index === index;
        const multiSelected = this._multiSelectedKeys.get(track.bone)?.has(index) === true;
        return `<div class="se-tl-key ${selected ? 'selected' : ''} ${multiSelected ? 'multi-selected' : ''}" data-bone="${track.bone}" data-index="${index}" style="left:${left}%" title="t=${key.t}ms"></div>`;
      }).join('') : '';
      const hint = track ? '' : ' title="无轨道：双击建轨道并以当前姿态打关键帧"';
      const rowSelected = this.selectedBone === bone.id ? 'selected' : '';
      return `<div class="se-tl-row ${rowSelected} ${track ? '' : 'no-track'}" data-bone="${bone.id}"${hint}>
        <div class="label" title="点击选中骨骼及其挂件；右键行=图层序操作">${SkeletonEditor._displayName(bone.id)}</div>
        <div class="lane">${loopTie}${keys}<div id="se-tl-playhead" style="left:${(this.previewTime / clip.durationMs) * 100}%"></div></div>
      </div>`;
    }).join('');
    body.innerHTML = rows || '<div class="se-empty">骨骼树为空</div>';
    const duration = clip.durationMs;

    for (const row of body.querySelectorAll('.se-tl-row')) {
      const lane = row.querySelector('.lane');
      const boneId = row.dataset.bone;
      // 行标签点击 = 选中该骨骼及其主挂件槽位（与左侧骨骼树/检查器联动）；lane 点击仍是拖动播放头
      row.querySelector('.label').addEventListener('click', () => {
        const slot = this._primarySlotOfBone(boneId);
        this.selectedBone = boneId;
        this.selectedSlot = slot?.id || null;
        this._renderBoneTree();
        this._renderSlotList();
        this._renderInspector();
        this._renderTimeline();
      });
      // 行右键 = 图层序操作（作用于该骨骼的主挂件槽位；无挂件时给出禁用提示）
      row.addEventListener('contextmenu', event => {
        event.preventDefault();
        this._removeContextMenu();
        const slot = this._primarySlotOfBone(boneId);
        this.selectedBone = boneId;
        this.selectedSlot = slot?.id || null;
        this._renderBoneTree();
        this._renderSlotList();
        this._renderInspector();
        this._renderTimeline();
        const items = slot
          ? this._buildZOrderMenuItems(slot.id)
          : [{ label: '该骨骼没有挂件槽位', disabled: true }];
        this._showContextMenu(event, items, SkeletonEditor._displayName(boneId));
      });
      lane.addEventListener('mousedown', event => {
        if (event.target.classList.contains('se-tl-key')) return;
        // Alt/Shift/Ctrl+拖动 = 直接框选关键帧（Shift/Ctrl = 追加现有选区）
        if (event.altKey || event.shiftKey || event.ctrlKey) {
          event.preventDefault();
          this._beginKeyMarquee(event, body, event.shiftKey || event.ctrlKey);
          return;
        }
        const laneRect = lane.getBoundingClientRect();
        const seek = clientX => {
          this.previewTime = Math.max(0, Math.min(duration, ((clientX - laneRect.left) / laneRect.width) * duration));
        };
        // 按在播放头竖条附近（±6px）= 抓住播放头拖动扫动（先于 seek 取位置）
        const playheadX = laneRect.left + (this.previewTime / duration) * laneRect.width;
        const grabPlayhead = Math.abs(event.clientX - playheadX) <= 6;
        // 空白定位播放头时清空关键帧多选（常规 dope sheet 行为）
        if (this._multiSelectedKeys.size > 0) {
          this._multiSelectedKeys.clear();
          this._renderTimeline();
        }
        seek(event.clientX);
        this._renderTimeline();
        // 普通左键双职责：抓住播放头 = 纯扫动；空白处拖动超阈值 = 框选关键帧
        const startX = event.clientX;
        const startY = event.clientY;
        let marqueeBegan = false;
        const onMove = moveEvent => {
          if (grabPlayhead) {
            seek(moveEvent.clientX);
            this._renderTimeline();
            return;
          }
          if (!marqueeBegan
            && Math.abs(moveEvent.clientX - startX) <= 4
            && Math.abs(moveEvent.clientY - startY) <= 4) {
            seek(moveEvent.clientX);
            this._renderTimeline();
            return;
          }
          if (!marqueeBegan) {
            marqueeBegan = true;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            this._beginKeyMarquee(moveEvent, body, false);
          }
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
      // 无轨道行：双击建轨道并以当前姿态（静止姿态采样）在该时间打关键帧
      if (row.classList.contains('no-track')) {
        lane.addEventListener('dblclick', event => {
          if (event.target.classList.contains('se-tl-key')) return;
          const laneRect = lane.getBoundingClientRect();
          this.previewTime = Math.max(0, Math.min(duration,
            ((event.clientX - laneRect.left) / laneRect.width) * duration));
          const rest = this._boneById(boneId) || {};
          this._pushHistory();
          this._ensureTrackAndKey(boneId, this._clip(), { x: rest.x ?? 0, y: rest.y ?? 0, rot: rest.rot ?? 0 });
          this._markDirty();
          this._renderTimeline();
          this._toast(`已为 ${SkeletonEditor._displayName(boneId)} 建轨道并打关键帧`);
        });
      }
    }
    for (const keyElement of body.querySelectorAll('.se-tl-key')) {
      keyElement.addEventListener('mousedown', event => {
        if (keyElement.classList.contains('se-tl-key-ghost')) return; // 循环衔接的隐式首帧不可操作
        event.stopPropagation();
        const boneName = keyElement.dataset.bone;
        const keyIndex = Number(keyElement.dataset.index);
        const alreadyMulti = this._multiSelectedKeys.get(boneName)?.has(keyIndex) === true;
        // Ctrl/Shift 点击 = 加入多选（不进入拖动）
        if ((event.ctrlKey || event.shiftKey) && !alreadyMulti) {
          this.selectedKey = { bone: boneName, index: keyIndex };
          if (!this._multiSelectedKeys.has(boneName)) this._multiSelectedKeys.set(boneName, new Set());
          this._multiSelectedKeys.get(boneName).add(keyIndex);
          document.getElementById('se-key-del').disabled = false;
          this._renderTimeline();
          return;
        }
        // 普通点击未选中帧 = 替换为单选（清多选）；点击已选帧 = 保持多选并整组拖动
        if (!alreadyMulti) {
          this.selectedKey = { bone: boneName, index: keyIndex };
          this._multiSelectedKeys.clear();
          document.getElementById('se-key-del').disabled = false;
        }
        // 注意：先取 lane 矩形再 _renderTimeline()——重建 innerHTML 会分离 keyElement
        const laneRect = keyElement.parentElement.getBoundingClientRect();
        this._renderTimeline();
        const clip = this._clip();
        // 拖动组：多选非空时整组移动（同屏 dope sheet 惯例），否则单帧
        const dragItems = [];
        if (this._multiSelectedKeys.size > 0) {
          for (const [boneId, indices] of this._multiSelectedKeys.entries()) {
            const track = clip?.tracks?.find(candidate => candidate.bone === boneId);
            if (!track) continue;
            for (const index of indices) {
              const key = track.keys[index];
              if (key) dragItems.push({ track, boneId, key, startT: key.t });
            }
          }
        }
        const selectedTrack = clip?.tracks?.find(candidate => candidate.bone === boneName);
        const selectedKeyObj = selectedTrack?.keys?.[keyIndex];
        if (dragItems.length === 0 && selectedKeyObj) {
          dragItems.push({ track: selectedTrack, boneId: boneName, key: selectedKeyObj, startT: selectedKeyObj.t });
        }
        if (dragItems.length === 0) return;
        this._pushHistory();
        const startXMs = Math.max(0, Math.min(1, (event.clientX - laneRect.left) / laneRect.width)) * duration;
        const onMove = moveEvent => {
          const currentXMs = Math.max(0, Math.min(1, (moveEvent.clientX - laneRect.left) / laneRect.width)) * duration;
          const delta = Math.round(currentXMs - startXMs);
          for (const item of dragItems) {
            item.key.t = Math.max(0, Math.min(duration, item.startT + delta));
          }
          this._renderTimeline();
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          // 排序后 index 全变：用 key 对象引用重算单选与多选的新 index
          const touchedTracks = new Set(dragItems.map(item => item.track));
          for (const track of touchedTracks) track.keys.sort((left, right) => left.t - right.t);
          if (this.selectedKey?.bone === boneName && selectedKeyObj) {
            this.selectedKey.index = Math.max(0, selectedTrack.keys.indexOf(selectedKeyObj));
          }
          const nextIndices = new Map();
          for (const item of dragItems) {
            if (!nextIndices.has(item.boneId)) nextIndices.set(item.boneId, new Set());
            const nextIndex = item.track.keys.indexOf(item.key);
            if (nextIndex >= 0) nextIndices.get(item.boneId).add(nextIndex);
          }
          for (const [boneId, indices] of nextIndices) this._multiSelectedKeys.set(boneId, indices);
          this._markDirty();
          this._renderTimeline();
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
      // 关键帧右键菜单：复制到播放头 / 删除（多选组右键 = 菜单作用于整组）
      keyElement.addEventListener('contextmenu', event => {
        if (keyElement.classList.contains('se-tl-key-ghost')) return; // 隐式首帧无菜单
        event.preventDefault();
        event.stopPropagation(); // 不冒泡到行级图层序菜单
        const boneName = keyElement.dataset.bone;
        const keyIndex = Number(keyElement.dataset.index);
        const inMulti = this._multiSelectedKeys.get(boneName)?.has(keyIndex) === true;
        if (!inMulti) {
          this.selectedKey = { bone: boneName, index: keyIndex };
          this._multiSelectedKeys.clear();
        }
        document.getElementById('se-key-del').disabled = false;
        this._renderTimeline();
        const groupSize = [...this._multiSelectedKeys.values()].reduce((sum, set) => sum + set.size, 0);
        const header = groupSize > 1 ? `关键帧 ×${groupSize}` : SkeletonEditor._displayName(boneName);
        this._showContextMenu(event, [
          { label: '⧉ 复制到播放头', action: () => this._copySelectedKeysToPlayhead() },
          { label: '✕ 删除', action: () => this._deleteSelectedKey() }
        ], header);
      });
    }
    if (!this.selectedKey && this._multiSelectedKeys.size === 0) {
      document.getElementById('se-key-del').disabled = true;
    }
    // 当前时间输入框同步
    const timeInput = document.getElementById('se-time-input');
    if (timeInput && document.activeElement !== timeInput) timeInput.value = Math.round(this.previewTime);
  }

  /**
   * 时间线框选关键帧：按住 Alt 拖出矩形（跨轨道），松开时命中矩形的关键帧进入多选。
   * additive=true 时在现有选区上追加；框选过程直接改 DOM 高亮，松开后重建渲染。
   */
  _beginKeyMarquee(startEvent, body, additive) {
    const bodyRect = body.getBoundingClientRect();
    const startX = startEvent.clientX - bodyRect.left;
    const startY = startEvent.clientY - bodyRect.top;
    const baseSelection = additive ? new Map([...this._multiSelectedKeys].map(([bone, set]) => [bone, new Set(set)])) : new Map();
    const marquee = document.createElement('div');
    marquee.className = 'se-tl-marquee';
    body.appendChild(marquee);
    const apply = event => {
      const x = event.clientX - bodyRect.left;
      const y = event.clientY - bodyRect.top;
      const left = Math.min(startX, x);
      const top = Math.min(startY, y);
      marquee.style.left = `${left}px`;
      marquee.style.top = `${top}px`;
      marquee.style.width = `${Math.abs(x - startX)}px`;
      marquee.style.height = `${Math.abs(y - startY)}px`;
      const next = new Map([...baseSelection].map(([bone, set]) => [bone, new Set(set)]));
      for (const keyEl of body.querySelectorAll('.se-tl-key:not(.se-tl-key-ghost)')) {
        const rect = keyEl.getBoundingClientRect();
        const hit = rect.left + rect.width >= bodyRect.left + left
          && rect.left <= bodyRect.left + left + Math.abs(x - startX)
          && rect.top + rect.height >= bodyRect.top + top
          && rect.top <= bodyRect.top + top + Math.abs(y - startY);
        if (!hit) continue;
        const bone = keyEl.dataset.bone;
        if (!next.has(bone)) next.set(bone, new Set());
        next.get(bone).add(Number(keyEl.dataset.index));
      }
      this._multiSelectedKeys = next;
      for (const keyEl of body.querySelectorAll('.se-tl-key:not(.se-tl-key-ghost)')) {
        keyEl.classList.toggle('multi-selected',
          this._multiSelectedKeys.get(keyEl.dataset.bone)?.has(Number(keyEl.dataset.index)) === true);
      }
      document.getElementById('se-key-del').disabled = !(this.selectedKey || this._multiSelectedKeys.size > 0);
    };
    const onMove = moveEvent => apply(moveEvent);
    const onUp = () => {
      marquee.remove();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      this._renderTimeline();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    apply(startEvent);
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
    const invCos = Math.cos(-newBone.rad);
    const invSin = Math.sin(-newBone.rad);
    const r1 = value => Math.round(value * 10) / 10;
    // 局部(旧骨) → 世界 → 局部(新骨)；基准与各方向覆盖分别换算，保证换绑后每个方向的摆位都不变
    const rebase = offset => {
      const worldX = oldBone.x + (offset.x || 0) * cos - (offset.y || 0) * sin;
      const worldY = oldBone.y + (offset.x || 0) * sin + (offset.y || 0) * cos;
      const dx = worldX - newBone.x;
      const dy = worldY - newBone.y;
      return {
        x: r1(dx * invCos - dy * invSin),
        y: r1(dx * invSin + dy * invCos),
        rot: r1((oldBone.rad + (offset.rot || 0) * Math.PI / 180 - newBone.rad) * 57.29578)
      };
    };
    const rebased = rebase({ x: att.x ?? 0, y: att.y ?? 0, rot: att.rot ?? 0 });
    att.x = rebased.x;
    att.y = rebased.y;
    att.rot = rebased.rot;
    if (att.directionOffsets) {
      for (const key of Object.keys(att.directionOffsets)) {
        const next = rebase(att.directionOffsets[key]);
        att.directionOffsets[key].x = next.x;
        att.directionOffsets[key].y = next.y;
        att.directionOffsets[key].rot = next.rot;
      }
    }
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
    // 图片手柄点击（按下到松开几乎未移动）= 设为旋转圆心：之后按住角手柄外圈即绕该点旋转
    // （骨骼旋转固定绕自身关节，不使用手柄圆心）
    if (this._drag && this._drag.kind === 'attach-scale') {
      const rect = this.el.canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      if (Math.hypot(mx - this._drag.startX, my - this._drag.startY) < 4) {
        this._rotPivot = {
          targetId: this._drag.slotId,
          handleKey: this._drag.handle
        };
        this._toast(`旋转圆心已设为手柄 ${this._drag.handle.toUpperCase()}（按住角手柄外圈即绕它旋转）`);
      }
    }
    this.el.canvas.style.cursor = '';
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
    // 骨骼长度拖拽结束：同步检查器 length 字段
    if (this._drag?.kind === 'tip-length') this._renderInspector();
    // 框选完成：选中框内骨骼原点与附件中心（additive=叠加到现有选择）
    if (this._drag?.kind === 'marquee') {
      const x0 = Math.min(this._drag.startX, this._drag.currentX);
      const x1 = Math.max(this._drag.startX, this._drag.currentX);
      const y0 = Math.min(this._drag.startY, this._drag.currentY);
      const y1 = Math.max(this._drag.startY, this._drag.currentY);
      if (x1 - x0 >= 3 && y1 - y0 >= 3 && this.runtime) {
        const world = this._boneWorldTransforms();
        for (const bone of this.doc.bones || []) {
          if (this._isBoneLocked(bone.id) || this._isBoneHidden(bone.id)) continue;
          const boneWorld = world.get(bone.id);
          if (!boneWorld) continue;
          const point = this._worldToScreen(boneWorld.x, boneWorld.y);
          if (point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1) {
            this.selectedBones.add(bone.id);
            this._selectedBoneId = bone.id;
          }
        }
        for (const slot of this.runtime.slots || []) {
          if (this._isSlotInteractiveLocked(slot.id, slot.bone) || this._isSlotPreviewHidden(slot.id, slot.bone)) continue;
          const attachment = slot.attachment;
          if (!attachment || attachment.type === 'empty') continue;
          if (this._isHeadSlotVisibleInPreview(slot.id) === false) continue;
          const boneWorld = world.get(slot.bone);
          if (!boneWorld) continue;
          const point = this._worldToScreen(
            boneWorld.x + (attachment.x || 0) * boneWorld.sx,
            boneWorld.y + (attachment.y || 0) * boneWorld.sy
          );
          if (point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1) {
            this.selectedSlots.add(slot.id);
            this._selectedSlotId = slot.id;
          }
        }
        this._renderBoneTree();
        this._renderSlotList();
        this._renderInspector();
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
      // 模板编辑态：写回 assets/skeletons/templates/，不动 Manifest（改模板不影响已创建对象）
      const result = this.editingTemplate
        ? await this.commands.saveSkeleton(this.projectPath, structuredClone(this.doc), { template: true })
        : await this.commands.saveSkeleton(this.projectPath, structuredClone(this.doc));
      if (result.ok) {
        this.dirty = false;
        this.el.dirty.style.display = 'none';
        this.el.skeletonId.disabled = true;
        if (!this.editingTemplate && !this.skeletonEntries.some(entry => (entry.imageId || entry.assetId) === this.doc.skeletonId)) {
          this.skeletonEntries.push({
            assetId: this.doc.skeletonId, imageId: this.doc.skeletonId,
            runtime2D: { mode: 'skeleton', path: `assets/skeletons/${this.doc.skeletonId}.json` }
          });
          this._refreshAssetSelect();
        }
        this._toast(this.editingTemplate ? '模板已写回 templates/（不影响已创建的骨骼资产）' : '已保存：骨骼 JSON + Manifest 已落盘');
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
