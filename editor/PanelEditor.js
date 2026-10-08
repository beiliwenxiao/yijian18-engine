/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

/**
 * PanelEditor.js - 面板编辑器
 *
 * 可视化编辑游戏 UI 面板（属性面板、装备面板、背包面板等）的内部组成部件。
 * 每个面板是一个 tab，支持新增/修改/删除面板。
 * 面板内的每个部件（标题、装备槽、属性行、物品格子等）都可以：
 *   - 调整名称、位置、大小
 *   - 修改属性（颜色、字体、边框等）
 *   - 拖拽移动、缩放手柄调整大小
 *
 * 保存为 config/PanelLayout.json，游戏运行时由面板组件读取并应用。
 */

import { replaceCanonicalFile } from './CanonicalTransactionClient.js';

// 旧三面板定义仅保留作为历史参考；实际回退默认值使用下方的统一背包定义。
const LEGACY_DEFAULT_PANELS = [
  {
    id: 'playerInfoPanel',
    name: '属性面板',
    width: 320,
    height: 300,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderColor: '#4a9eff',
    borderWidth: 2,
    parts: [
      { id: 'title', type: 'text', label: '标题', x: 15, y: 15, width: 290, height: 24, text: '属性', fontSize: 18, fontWeight: 'bold', color: '#4a9eff', align: 'left' },
      { id: 'separator1', type: 'line', label: '分隔线', x: 15, y: 40, width: 290, height: 1, color: '#4a9eff' },
      { id: 'className', type: 'text', label: '角色名', x: 15, y: 50, width: 290, height: 20, text: '{className}', fontSize: 16, fontWeight: 'bold', color: '#ffffff', align: 'left' },
      { id: 'classLabel', type: 'text', label: '职业标签', x: 15, y: 75, width: 40, height: 18, text: '职业:', fontSize: 14, color: '#aaaaaa', align: 'left' },
      { id: 'classValue', type: 'text', label: '职业值', x: 65, y: 75, width: 80, height: 18, text: '{class}', fontSize: 14, fontWeight: 'bold', color: '#ff6b6b', align: 'left' },
      { id: 'levelLabel', type: 'text', label: '等级标签', x: 165, y: 75, width: 40, height: 18, text: '等级:', fontSize: 14, color: '#aaaaaa', align: 'left' },
      { id: 'levelValue', type: 'text', label: '等级值', x: 205, y: 75, width: 40, height: 18, text: '{level}', fontSize: 14, color: '#ffffff', align: 'left' },
      { id: 'attrTitle', type: 'text', label: '属性标题', x: 15, y: 105, width: 40, height: 18, text: '属性', fontSize: 14, fontWeight: 'bold', color: '#4a9eff', align: 'left' },
      { id: 'attrAllocBtn', type: 'button', label: '加点按钮', x: 65, y: 96, width: 24, height: 16, text: '+', fontSize: 12, color: '#ffffff', bgColor: '#2a5a8f', borderColor: '#4a9eff' },
      { id: 'attrHP', type: 'attr-row', label: 'HP', x: 15, y: 125, width: 270, height: 20, attrLabel: 'HP', attrColor: '#ff4444', labelColor: '#aaaaaa', fontSize: 13 },
      { id: 'attrMP', type: 'attr-row', label: 'MP', x: 15, y: 145, width: 270, height: 20, attrLabel: 'MP', attrColor: '#4444ff', labelColor: '#aaaaaa', fontSize: 13 },
      { id: 'attrAttack', type: 'attr-row', label: '攻击', x: 15, y: 165, width: 270, height: 20, attrLabel: '攻击', attrColor: '#ffaa00', labelColor: '#aaaaaa', fontSize: 13 },
      { id: 'attrDefense', type: 'attr-row', label: '防御', x: 15, y: 185, width: 270, height: 20, attrLabel: '防御', attrColor: '#00aaff', labelColor: '#aaaaaa', fontSize: 13 },
      { id: 'attrSpeed', type: 'attr-row', label: '速度', x: 15, y: 205, width: 270, height: 20, attrLabel: '速度', attrColor: '#00ff00', labelColor: '#aaaaaa', fontSize: 13 }
    ]
  },
  {
    id: 'equipmentPanel',
    name: '装备面板',
    width: 260,
    height: 330,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderColor: '#4a9eff',
    borderWidth: 2,
    parts: [
      { id: 'title', type: 'text', label: '标题', x: 15, y: 15, width: 230, height: 24, text: '装备', fontSize: 18, fontWeight: 'bold', color: '#4a9eff', align: 'left' },
      { id: 'separator1', type: 'line', label: '分隔线', x: 15, y: 40, width: 230, height: 1, color: '#4a9eff' },
      { id: 'slot_accessory', type: 'equip-slot', label: '饰品', x: 35, y: 55, width: 50, height: 50, slotType: 'accessory', slotLabel: '饰品', slotBgColor: 'rgba(50,50,50,0.8)', slotBorderColor: '#666666' },
      { id: 'slot_helmet', type: 'equip-slot', label: '头盔', x: 105, y: 55, width: 50, height: 50, slotType: 'helmet', slotLabel: '头盔', slotBgColor: 'rgba(50,50,50,0.8)', slotBorderColor: '#666666' },
      { id: 'slot_necklace', type: 'equip-slot', label: '项链', x: 175, y: 55, width: 50, height: 50, slotType: 'necklace', slotLabel: '项链', slotBgColor: 'rgba(50,50,50,0.8)', slotBorderColor: '#666666' },
      { id: 'slot_mainhand', type: 'equip-slot', label: '主手', x: 35, y: 115, width: 50, height: 50, slotType: 'mainhand', slotLabel: '主手武器', slotBgColor: 'rgba(50,50,50,0.8)', slotBorderColor: '#666666' },
      { id: 'slot_armor', type: 'equip-slot', label: '胸甲', x: 105, y: 115, width: 50, height: 50, slotType: 'armor', slotLabel: '胸甲', slotBgColor: 'rgba(50,50,50,0.8)', slotBorderColor: '#666666' },
      { id: 'slot_offhand', type: 'equip-slot', label: '副手', x: 175, y: 115, width: 50, height: 50, slotType: 'offhand', slotLabel: '副手武器', slotBgColor: 'rgba(50,50,50,0.8)', slotBorderColor: '#666666' },
      { id: 'slot_ring1', type: 'equip-slot', label: '戒指1', x: 35, y: 175, width: 50, height: 50, slotType: 'ring1', slotLabel: '戒指', slotBgColor: 'rgba(50,50,50,0.8)', slotBorderColor: '#666666' },
      { id: 'slot_belt', type: 'equip-slot', label: '腰带', x: 105, y: 175, width: 50, height: 50, slotType: 'belt', slotLabel: '腰带', slotBgColor: 'rgba(50,50,50,0.8)', slotBorderColor: '#666666' },
      { id: 'slot_ring2', type: 'equip-slot', label: '戒指2', x: 175, y: 175, width: 50, height: 50, slotType: 'ring2', slotLabel: '戒指', slotBgColor: 'rgba(50,50,50,0.8)', slotBorderColor: '#666666' },
      { id: 'slot_instrument', type: 'equip-slot', label: '器械', x: 35, y: 235, width: 50, height: 50, slotType: 'instrument', slotLabel: '器械', slotBgColor: 'rgba(50,50,50,0.8)', slotBorderColor: '#666666' },
      { id: 'slot_boots', type: 'equip-slot', label: '鞋子', x: 105, y: 235, width: 50, height: 50, slotType: 'boots', slotLabel: '鞋子', slotBgColor: 'rgba(50,50,50,0.8)', slotBorderColor: '#666666' },
      { id: 'slot_mount', type: 'equip-slot', label: '坐骑', x: 175, y: 235, width: 50, height: 50, slotType: 'mount', slotLabel: '坐骑', slotBgColor: 'rgba(50,50,50,0.8)', slotBorderColor: '#666666' }
    ]
  },
  {
    id: 'inventoryPanel',
    name: '背包面板',
    width: 360,
    height: 340,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderColor: '#666666',
    borderWidth: 2,
    parts: [
      { id: 'title', type: 'text', label: '标题', x: 20, y: 12, width: 100, height: 20, text: '背包', fontSize: 16, fontWeight: 'bold', color: '#ffffff', align: 'left' },
      { id: 'slotCount', type: 'text', label: '槽位数', x: 250, y: 14, width: 100, height: 16, text: '0/30', fontSize: 12, color: '#cccccc', align: 'right' },
      { id: 'filterAll', type: 'button', label: '全部', x: 20, y: 45, width: 60, height: 25, text: '全部', fontSize: 11, color: '#ffffff', bgColor: 'rgba(100,150,255,0.8)', borderColor: '#6496ff' },
      { id: 'filterEquip', type: 'button', label: '装备', x: 90, y: 45, width: 60, height: 25, text: '装备', fontSize: 11, color: '#ffffff', bgColor: 'rgba(100,100,100,0.5)', borderColor: '#888888' },
      { id: 'filterConsume', type: 'button', label: '消耗品', x: 160, y: 45, width: 60, height: 25, text: '消耗品', fontSize: 11, color: '#ffffff', bgColor: 'rgba(100,100,100,0.5)', borderColor: '#888888' },
      { id: 'filterMaterial', type: 'button', label: '材料', x: 230, y: 45, width: 60, height: 25, text: '材料', fontSize: 11, color: '#ffffff', bgColor: 'rgba(100,100,100,0.5)', borderColor: '#888888' },
      { id: 'filterQuest', type: 'button', label: '任务', x: 300, y: 45, width: 60, height: 25, text: '任务', fontSize: 11, color: '#ffffff', bgColor: 'rgba(100,100,100,0.5)', borderColor: '#888888' },
      { id: 'slotGrid', type: 'slot-grid', label: '物品格子', x: 20, y: 80, width: 330, height: 220, cols: 6, rows: 4, slotSize: 50, slotPadding: 5, slotBgColor: 'rgba(50,50,50,0.8)', slotBorderColor: '#666666' },
      { id: 'scrollbar', type: 'scrollbar', label: '滚动条', x: 344, y: 80, width: 8, height: 220, trackColor: 'rgba(255,255,255,0.12)', thumbColor: 'rgba(180,180,180,0.8)' },
      { id: 'goldRow', type: 'text', label: '金币', x: 16, y: 344, width: 120, height: 20, text: '💰 0 金币', fontSize: 13, fontWeight: 'bold', color: '#FFD700', align: 'left' }
    ]
  }
];

// 默认统一背包定义：外框由 UIEditor 编辑，部件按 section 在组合面板中分区渲染。
const DEFAULT_PANELS = [
  {
    id: 'backpackPanel', name: '背包', width: 900, height: 520,
    backgroundColor: 'rgba(0, 0, 0, 0.88)', borderColor: '#4a9eff', borderWidth: 2,
    parts: [
      { id: 'characterTitle', section: 'character', type: 'text', label: '角色装备标题', x: 20, y: 18, width: 260, height: 24, text: '角色装备', fontSize: 18, fontWeight: 'bold', color: '#4a9eff', align: 'left' },
      { id: 'characterSeparator', section: 'character', type: 'line', label: '角色分隔线', x: 20, y: 47, width: 270, height: 1, color: '#4a9eff' },
      { id: 'className', section: 'character', type: 'text', label: '角色名', x: 20, y: 60, width: 260, height: 20, text: '{className}', fontSize: 16, fontWeight: 'bold', color: '#ffffff', align: 'left' },
      { id: 'classLabel', section: 'character', type: 'text', label: '职业标签', x: 20, y: 87, width: 40, height: 18, text: '职业:', fontSize: 14, color: '#aaaaaa', align: 'left' },
      { id: 'classValue', section: 'character', type: 'text', label: '职业值', x: 65, y: 87, width: 80, height: 18, text: '{class}', fontSize: 14, fontWeight: 'bold', color: '#ff6b6b', align: 'left' },
      { id: 'levelLabel', section: 'character', type: 'text', label: '等级标签', x: 165, y: 87, width: 40, height: 18, text: '等级:', fontSize: 14, color: '#aaaaaa', align: 'left' },
      { id: 'levelValue', section: 'character', type: 'text', label: '等级值', x: 210, y: 87, width: 40, height: 18, text: '{level}', fontSize: 14, color: '#ffffff', align: 'left' },
      { id: 'attrTitle', section: 'character', type: 'text', label: '属性标题', x: 20, y: 120, width: 40, height: 18, text: '属性', fontSize: 14, fontWeight: 'bold', color: '#4a9eff', align: 'left' },
      { id: 'attrAllocBtn', section: 'character', type: 'button', label: '加点按钮', x: 65, y: 116, width: 24, height: 18, text: '+', fontSize: 12, color: '#ffffff', bgColor: '#2a5a8f', borderColor: '#4a9eff' },
      { id: 'attrHP', section: 'character', type: 'attr-row', label: 'HP', x: 20, y: 145, width: 260, height: 20, attrLabel: 'HP', attrColor: '#ff4444', labelColor: '#aaaaaa', fontSize: 13 },
      { id: 'attrMP', section: 'character', type: 'attr-row', label: 'MP', x: 20, y: 165, width: 260, height: 20, attrLabel: 'MP', attrColor: '#4444ff', labelColor: '#aaaaaa', fontSize: 13 },
      { id: 'attrAttack', section: 'character', type: 'attr-row', label: '攻击', x: 20, y: 185, width: 260, height: 20, attrLabel: '攻击', attrColor: '#ffaa00', labelColor: '#aaaaaa', fontSize: 13 },
      { id: 'attrDefense', section: 'character', type: 'attr-row', label: '防御', x: 20, y: 205, width: 260, height: 20, attrLabel: '防御', attrColor: '#00aaff', labelColor: '#aaaaaa', fontSize: 13 },
      { id: 'attrSpeed', section: 'character', type: 'attr-row', label: '速度', x: 20, y: 225, width: 260, height: 20, attrLabel: '速度', attrColor: '#00ff00', labelColor: '#aaaaaa', fontSize: 13 },
      { id: 'equipmentTitle', section: 'character', type: 'text', label: '装备标题', x: 20, y: 258, width: 120, height: 18, text: '装备', fontSize: 14, fontWeight: 'bold', color: '#4a9eff', align: 'left' },
      { id: 'slot_accessory', section: 'character', type: 'equip-slot', label: '饰品', x: 20, y: 285, width: 50, height: 50, slotType: 'accessory', slotLabel: '饰品' },
      { id: 'slot_helmet', section: 'character', type: 'equip-slot', label: '头盔', x: 105, y: 285, width: 50, height: 50, slotType: 'helmet', slotLabel: '头盔' },
      { id: 'slot_necklace', section: 'character', type: 'equip-slot', label: '项链', x: 190, y: 285, width: 50, height: 50, slotType: 'necklace', slotLabel: '项链' },
      { id: 'slot_mainhand', section: 'character', type: 'equip-slot', label: '主手', x: 20, y: 340, width: 50, height: 50, slotType: 'mainhand', slotLabel: '主手' },
      { id: 'slot_armor', section: 'character', type: 'equip-slot', label: '胸甲', x: 105, y: 340, width: 50, height: 50, slotType: 'armor', slotLabel: '胸甲' },
      { id: 'slot_offhand', section: 'character', type: 'equip-slot', label: '副手', x: 190, y: 340, width: 50, height: 50, slotType: 'offhand', slotLabel: '副手' },
      { id: 'slot_ring1', section: 'character', type: 'equip-slot', label: '戒指1', x: 20, y: 395, width: 50, height: 50, slotType: 'ring1', slotLabel: '戒指' },
      { id: 'slot_belt', section: 'character', type: 'equip-slot', label: '腰带', x: 105, y: 395, width: 50, height: 50, slotType: 'belt', slotLabel: '腰带' },
      { id: 'slot_ring2', section: 'character', type: 'equip-slot', label: '戒指2', x: 190, y: 395, width: 50, height: 50, slotType: 'ring2', slotLabel: '戒指' },
      { id: 'slot_instrument', section: 'character', type: 'equip-slot', label: '器械', x: 20, y: 450, width: 50, height: 50, slotType: 'instrument', slotLabel: '器械' },
      { id: 'slot_boots', section: 'character', type: 'equip-slot', label: '鞋子', x: 105, y: 450, width: 50, height: 50, slotType: 'boots', slotLabel: '鞋子' },
      { id: 'slot_mount', section: 'character', type: 'equip-slot', label: '坐骑', x: 190, y: 450, width: 50, height: 50, slotType: 'mount', slotLabel: '坐骑' },
      { id: 'bagTitle', section: 'inventory', type: 'text', label: '背包标题', x: 340, y: 18, width: 160, height: 24, text: '背包', fontSize: 18, fontWeight: 'bold', color: '#4a9eff', align: 'left' },
      { id: 'bagSlotCount', section: 'inventory', type: 'text', label: '槽位数', x: 750, y: 21, width: 130, height: 16, text: '0/30', fontSize: 12, color: '#cccccc', align: 'right' },
      { id: 'filterAll', section: 'inventory', type: 'button', label: '全部', x: 340, y: 60, width: 74, height: 26, text: '全部' },
      { id: 'filterEquip', section: 'inventory', type: 'button', label: '装备', x: 420, y: 60, width: 74, height: 26, text: '装备' },
      { id: 'filterConsume', section: 'inventory', type: 'button', label: '消耗品', x: 500, y: 60, width: 74, height: 26, text: '消耗品' },
      { id: 'filterMaterial', section: 'inventory', type: 'button', label: '材料', x: 580, y: 60, width: 74, height: 26, text: '材料' },
      { id: 'filterQuest', section: 'inventory', type: 'button', label: '任务', x: 660, y: 60, width: 74, height: 26, text: '任务' },
      { id: 'slotGrid', section: 'inventory', type: 'slot-grid', label: '物品格子', x: 340, y: 100, width: 490, height: 380, cols: 9, rows: 7, slotSize: 50, slotPadding: 5 },
      { id: 'scrollbar', section: 'inventory', type: 'scrollbar', label: '滚动条', x: 842, y: 100, width: 12, height: 380 },
      { id: 'bagGoldRow', section: 'inventory', type: 'text', label: '金币', x: 340, y: 500, width: 180, height: 20, text: '💰 0 金币', fontSize: 13, fontWeight: 'bold', color: '#FFD700', align: 'left' }
    ]
  }
];

// 部件类型注册表（用于新增部件时的选项）
const PART_TYPES = {
  'text': { label: '文本', defaults: { text: '文本', fontSize: 14, color: '#ffffff', align: 'left', fontWeight: 'normal' } },
  'line': { label: '分隔线', defaults: { color: '#4a9eff' } },
  'button': { label: '按钮', defaults: { text: '按钮', fontSize: 12, color: '#ffffff', bgColor: '#3a4a7e', borderColor: '#666' } },
  'equip-slot': { label: '装备槽', defaults: { slotType: 'accessory', slotLabel: '装备槽', slotBgColor: 'rgba(30,30,30,0.9)', slotBorderColor: '#555' } },
  'slot-grid': { label: '物品格子', defaults: { cols: 6, rows: 4, slotSize: 50, slotPadding: 5, slotBgColor: 'rgba(50,50,50,0.8)', slotBorderColor: '#666' } },
  'attr-row': { label: '属性行', defaults: { attrLabel: '属性', attrColor: '#ffffff', labelColor: '#aaaaaa', fontSize: 13 } },
  'scrollbar': { label: '滚动条', defaults: { trackColor: 'rgba(255,255,255,0.1)', thumbColor: 'rgba(255,255,255,0.4)' } },
  'icon': { label: '图标', defaults: { icon: '⚔️', fontSize: 24 } },
  'progress-bar': { label: '进度条', defaults: { fillColor: '#4CAF50', bgColor: '#333', borderColor: '#666', value: 0.7 } },
  'image': { label: '图片', defaults: { src: '', imageMode: 'contain' } }
};

export class PanelEditor {
  /**
   * @param {HTMLElement} container - 编辑器挂载容器
   * @param {Object} options
   * @param {string} [options.gameId='sanguo_zhangjiao']
   */
  constructor(container, options = {}) {
    this.container = container;
    this.gameId = options.gameId || 'sanguo_zhangjiao';
    this.configPath = `example/${this.gameId}/config/PanelLayout.json`;

    // 面板列表
    this.panels = JSON.parse(JSON.stringify(DEFAULT_PANELS));
    // 当前选中的面板 tab 索引
    this.activePanelIndex = 0;
    // 当前选中的主部件（用于属性编辑/单部件缩放）
    this.selectedPartId = null;
    // 多选集合；单选时也保持与 selectedPartId 同步。
    this.selectedPartIds = new Set();
    // 拖拽状态（单选/多选移动、框选或面板缩放）
    this._dragState = null;
    // 方向键按住状态：每个方向独立计时，支持斜向微调。
    this._arrowKeyHolds = new Map();
    this._arrowHistorySnapshot = null;
    this._arrowHistoryChanged = false;
    // 与场景编辑器一致的快照历史：仅保存真实布局数据，不保存选中/拖拽临时状态。
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistorySize = 50;
    // 画布缩放
    this.scale = 1;

    this._initialized = false;
  }

  /** 获取当前激活的面板 */
  get activePanel() {
    return this.panels[this.activePanelIndex] || null;
  }

  _createHistorySnapshot() {
    return JSON.stringify({ panels: this.panels, activePanelIndex: this.activePanelIndex });
  }

  _commitHistorySnapshot(snapshot) {
    if (!snapshot || snapshot === this._createHistorySnapshot()) return false;
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistorySize) this.undoStack.shift();
    this.redoStack = [];
    this._updateHistoryButtons();
    return true;
  }

  /** 保存当前变更前的状态；调用方应确保后续确实会修改布局。 */
  saveHistory() {
    this.undoStack.push(this._createHistorySnapshot());
    if (this.undoStack.length > this.maxHistorySize) this.undoStack.shift();
    this.redoStack = [];
    this._updateHistoryButtons();
    return true;
  }

  resetHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this._updateHistoryButtons();
  }

  _restoreHistorySnapshot(snapshot) {
    const state = JSON.parse(snapshot);
    this.panels = state.panels;
    this.activePanelIndex = Math.max(0, Math.min(state.activePanelIndex || 0, this.panels.length - 1));
    this._dragState = null;
    this._clearArrowKeyHolds(false);
    this._clearSelection();
    this._render();
  }

  undo() {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this._createHistorySnapshot());
    this._restoreHistorySnapshot(this.undoStack.pop());
    this._showToast('↶ 已撤销');
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this._createHistorySnapshot());
    this._restoreHistorySnapshot(this.redoStack.pop());
    this._showToast('↷ 已重做');
  }

  _updateHistoryButtons() {
    const undoButton = this.container?.querySelector('#pe-undo');
    const redoButton = this.container?.querySelector('#pe-redo');
    if (undoButton) undoButton.disabled = this.undoStack.length === 0;
    if (redoButton) redoButton.disabled = this.redoStack.length === 0;
  }

  /** 初始化 */
  async init() {
    if (this._initialized) return;
    this._initialized = true;
    await this._loadFromFile();
    this.resetHistory();
    this._buildUI();
    this._render();
  }

  /** 从文件加载 */
  async _loadFromFile() {
    try {
      const res = await fetch('/api/read-file?path=' + encodeURIComponent(this.configPath));
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.ok && data.content) {
        const parsed = JSON.parse(data.content);
        if (Array.isArray(parsed.panels) && parsed.panels.length > 0) {
          this.panels = parsed.panels;
        }
      }
    } catch (e) {
      console.warn('PanelEditor: 加载配置失败，使用默认值', e);
    }
  }

  /** 保存到文件 */
  async save() {
    const content = JSON.stringify({ panels: this.panels }, null, 2);
    try {
      await replaceCanonicalFile(this.configPath, content);
      this._showToast('✅ 已保存到 ' + this.configPath);
    } catch (e) {
      this._showToast('❌ 保存失败: ' + e.message, true);
    }
  }

  /** 构建 UI */
  _buildUI() {
    this.container.innerHTML = `
      <div class="pe-root">
        <div class="pe-toolbar">
          <div class="pe-tab-actions">
            <button id="pe-save" class="primary">💾 保存</button>
            <button id="pe-undo" title="撤销 (Ctrl/⌘+Z)">↶ 撤销</button>
            <button id="pe-redo" title="重做 (Ctrl/⌘+Shift+Z 或 Ctrl+Y)">↷ 重做</button>
            <button id="pe-add-panel" title="新增面板">＋面板</button>
          </div>
          <div class="pe-tabs" id="pe-tabs"></div>
        </div>
        <div class="pe-main">
          <div class="pe-canvas-wrap">
            <div class="pe-canvas-toolbar">
              <button id="pe-add-part">＋部件</button>
              <button id="pe-del-part">🗑️ 删除部件</button>
              <button id="pe-dup-part">📋 复制部件</button>
              <span class="pe-zoom-info" id="pe-zoom-info">100%</span>
            </div>
            <div class="pe-canvas-container" id="pe-canvas-container">
              <canvas id="pe-canvas"></canvas>
            </div>
          </div>
          <div class="pe-props" id="pe-props">
            <h4>属性</h4>
            <div class="pe-prop-empty">选择一个部件</div>
          </div>
        </div>
        <div class="pe-status" id="pe-status"></div>
      </div>
    `;
    this._injectStyles();
    this._bindEvents();
  }


  /** 注入样式 */
  _injectStyles() {
    if (document.getElementById('pe-styles')) return;
    const style = document.createElement('style');
    style.id = 'pe-styles';
    style.textContent = `
      .pe-root { display:flex; flex-direction:column; height:100%; background:#0d1326; color:#fff; }
      .pe-toolbar { display:flex; align-items:center; padding:8px 16px; background:#16213e; border-bottom:1px solid #2a3a5e; flex-wrap:wrap; gap:8px; }
      .pe-tabs { display:flex; gap:4px; flex-wrap:wrap; }
      .pe-tabs .pe-tab { padding:6px 14px; background:#3a4a7e; border:none; border-radius:4px 4px 0 0; color:#fff; cursor:pointer; font-size:12px; position:relative; }
      .pe-tabs .pe-tab.active { background:#4CAF50; color:#000; }
      .pe-tabs .pe-tab .pe-tab-close { position:absolute; top:2px; right:4px; font-size:10px; color:#f88; cursor:pointer; display:none; }
      .pe-tabs .pe-tab:hover .pe-tab-close { display:inline; }
      .pe-tab-actions button { padding:6px 12px; background:#3a4a7e; border:none; border-radius:4px; color:#fff; cursor:pointer; font-size:12px; }
      .pe-tab-actions button.primary { background:#4CAF50; color:#000; font-weight:bold; }
      .pe-tab-actions button:disabled { opacity:0.45; cursor:not-allowed; }
      .pe-main { flex:1; display:flex; overflow:hidden; }
      .pe-canvas-wrap { flex:1; display:flex; flex-direction:column; overflow:hidden; }
      .pe-canvas-toolbar { display:flex; gap:8px; padding:6px 12px; background:#111a30; border-bottom:1px solid #2a3a5e; align-items:center; }
      .pe-canvas-toolbar button { padding:4px 10px; background:#3a4a7e; border:none; border-radius:3px; color:#fff; cursor:pointer; font-size:12px; }
      .pe-canvas-toolbar button:hover { background:#4a5a9e; }
      .pe-zoom-info { font-size:11px; color:#8aa; margin-left:auto; }
      .pe-canvas-container { flex:1; overflow:auto; background:#070b18; padding:20px; }
      .pe-canvas-container canvas { border:1px solid #4CAF50; cursor:default; }
      .pe-props { width:280px; background:#111a30; border-left:1px solid #2a3a5e; padding:14px; overflow-y:auto; }
      .pe-props h4 { color:#4CAF50; margin-bottom:10px; }
      .pe-prop-empty { color:#778; font-size:13px; }
      .pe-prop-hint { font-size:11px; color:#7a8ca8; line-height:1.5; margin-top:4px; }
      .pe-prop-row input:disabled { opacity:0.6; cursor:not-allowed; }
      .pe-prop-section { margin-bottom:12px; border-bottom:1px solid #2a3a5e; padding-bottom:8px; }
      .pe-prop-section-title { font-size:11px; color:#6a8; margin-bottom:6px; text-transform:uppercase; }
      .pe-prop-row { display:flex; align-items:center; margin-bottom:6px; gap:6px; }
      .pe-prop-row label { width:60px; font-size:11px; color:#9ab; flex-shrink:0; }
      .pe-prop-row input, .pe-prop-row select { flex:1; background:#0a1020; border:1px solid #2a3a5e; color:#fff; padding:4px 6px; border-radius:3px; font-size:12px; min-width:0; }
      .pe-prop-row input[type="color"] { width:32px; height:24px; padding:0; border:none; }
      .pe-status { padding:6px 16px; font-size:12px; color:#8aa; background:#0a1020; min-height:24px; }
      .pe-toast { position:fixed; top:20px; right:20px; padding:10px 16px; background:#333; border:1px solid #4CAF50; border-radius:6px; color:#fff; font-size:13px; z-index:9999; transition:opacity 0.3s; }
      .pe-toast.error { border-color:#f44; }
    `;
    document.head.appendChild(style);
  }

  /** 绑定事件 */
  _bindEvents() {
    // 保存
    const saveButton = this.container.querySelector('#pe-save');
    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true;
      try {
        await this.save();
      } finally {
        saveButton.disabled = false;
      }
    });
    this.container.querySelector('#pe-undo').addEventListener('click', () => this.undo());
    this.container.querySelector('#pe-redo').addEventListener('click', () => this.redo());
    // 新增面板
    this.container.querySelector('#pe-add-panel').addEventListener('click', () => this._addPanel());
    // 新增部件
    this.container.querySelector('#pe-add-part').addEventListener('click', () => this._addPart());
    // 删除部件
    this.container.querySelector('#pe-del-part').addEventListener('click', () => this._deletePart());
    // 复制部件
    this.container.querySelector('#pe-dup-part').addEventListener('click', () => this._duplicatePart());

    // Canvas 交互
    const canvas = this.container.querySelector('#pe-canvas');
    canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    // 方向键微调：非表单输入焦点下由编辑器消费，防止页面滚动。
    this._onKeyDownBound = (e) => this._onKeyDown(e);
    this._onKeyUpBound = (e) => this._onKeyUp(e);
    this._onWindowBlurBound = () => this._clearArrowKeyHolds();
    window.addEventListener('keydown', this._onKeyDownBound);
    window.addEventListener('keyup', this._onKeyUpBound);
    window.addEventListener('blur', this._onWindowBlurBound);
    // mouseup 和拖拽中的 mousemove 绑在 window（见 _onMouseDown）
  }

  /** 渲染整个编辑器 */
  _render() {
    this._renderTabs();
    this._renderCanvas();
    this._renderProps();
    this._updateHistoryButtons();
  }

  /** 渲染面板 tab 栏 */
  _renderTabs() {
    const tabsEl = this.container.querySelector('#pe-tabs');
    tabsEl.innerHTML = this.panels.map((p, i) => `
      <button class="pe-tab ${i === this.activePanelIndex ? 'active' : ''}" data-index="${i}">
        ${p.name}
        <span class="pe-tab-close" data-close="${i}">×</span>
      </button>
    `).join('');

    // Tab 点击
    tabsEl.querySelectorAll('.pe-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (e.target.classList.contains('pe-tab-close')) return;
        this.activePanelIndex = parseInt(btn.dataset.index);
        this._clearSelection();
        this._render();
      });
    });
    // Tab 关闭(删除面板)
    tabsEl.querySelectorAll('.pe-tab-close').forEach(span => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(span.dataset.close);
        this._deletePanel(idx);
      });
    });
  }


  /** 渲染 Canvas 预览 */
  _renderCanvas() {
    const panel = this.activePanel;
    if (!panel) return;

    const canvas = this.container.querySelector('#pe-canvas');

    // 固定 100% 大小，不自动缩放，超出容器靠滚动
    this.scale = 1;

    const cw = panel.width;
    const ch = panel.height;
    canvas.width = cw;
    canvas.height = ch;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.scale(this.scale, this.scale);

    // 面板背景
    ctx.fillStyle = panel.backgroundColor || 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, panel.width, panel.height);
    ctx.strokeStyle = panel.borderColor || '#4a9eff';
    ctx.lineWidth = panel.borderWidth || 2;
    ctx.strokeRect(0, 0, panel.width, panel.height);

    // 渲染所有部件
    for (const part of panel.parts) {
      this._renderPart(ctx, part);
    }

    // 面板边缘拖拽手柄（右边/下边/右下角）
    const edgeSize = 6;
    ctx.fillStyle = 'rgba(76,175,80,0.5)';
    // 右边缘
    ctx.fillRect(panel.width - edgeSize, 0, edgeSize, panel.height);
    // 下边缘
    ctx.fillRect(0, panel.height - edgeSize, panel.width, edgeSize);
    // 右下角（更明显）
    ctx.fillStyle = '#4CAF50';
    ctx.fillRect(panel.width - 10, panel.height - 10, 10, 10);

    // 选中部件框（多选时逐个显示，单选才显示缩放手柄）
    const selectedParts = this._getSelectedParts();
    if (selectedParts.length > 0) {
      ctx.strokeStyle = '#ff0';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      for (const part of selectedParts) {
        ctx.strokeRect(part.x - 1, part.y - 1, part.width + 2, part.height + 2);
      }
      ctx.setLineDash([]);
      if (selectedParts.length === 1) {
        const sel = selectedParts[0];
        ctx.fillStyle = '#ff0';
        ctx.fillRect(sel.x + sel.width - 4, sel.y + sel.height - 4, 8, 8);
      }
    }

    // 鼠标左键在空白区按住拖动时显示虚线框选区域。
    if (this._dragState?.mode === 'marquee') {
      const rect = this._getMarqueeRect(this._dragState);
      ctx.fillStyle = 'rgba(76, 175, 80, 0.12)';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = '#4CAF50';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      ctx.setLineDash([]);
    }

    ctx.restore();
    this.container.querySelector('#pe-zoom-info').textContent = '100%';
  }

  /** 渲染单个部件 */
  _renderPart(ctx, part) {
    const { x, y, width, height } = part;

    switch (part.type) {
      case 'text':
        ctx.fillStyle = part.color || '#ffffff';
        ctx.font = `${part.fontWeight || 'normal'} ${part.fontSize || 14}px Arial`;
        ctx.textAlign = part.align || 'left';
        ctx.textBaseline = 'top';
        const tx = part.align === 'center' ? x + width / 2 : part.align === 'right' ? x + width : x;
        ctx.fillText(part.text || '', tx, y);
        ctx.textAlign = 'left';
        break;

      case 'line':
        ctx.strokeStyle = part.color || '#4a9eff';
        ctx.lineWidth = height || 1;
        ctx.beginPath();
        ctx.moveTo(x, y + height / 2);
        ctx.lineTo(x + width, y + height / 2);
        ctx.stroke();
        break;

      case 'button':
        ctx.fillStyle = part.bgColor || '#3a4a7e';
        ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = part.borderColor || '#666';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);
        ctx.fillStyle = part.color || '#ffffff';
        ctx.font = `${part.fontSize || 12}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(part.text || '', x + width / 2, y + height / 2);
        ctx.textAlign = 'left';
        break;

      case 'equip-slot':
        ctx.fillStyle = part.slotBgColor || 'rgba(30,30,30,0.9)';
        ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = part.slotBorderColor || '#555';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, width, height);
        // 槽位名称
        ctx.fillStyle = '#888';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(part.slotLabel || '', x + width / 2, y + height / 2);
        ctx.textAlign = 'left';
        break;

      case 'slot-grid': {
        const cols = part.cols || 6;
        const rows = part.rows || 4;
        const sz = part.slotSize || 50;
        const pad = part.slotPadding || 5;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const sx = x + c * (sz + pad);
            const sy = y + r * (sz + pad);
            ctx.fillStyle = part.slotBgColor || 'rgba(50,50,50,0.8)';
            ctx.fillRect(sx, sy, sz, sz);
            ctx.strokeStyle = part.slotBorderColor || '#666';
            ctx.lineWidth = 1;
            ctx.strokeRect(sx, sy, sz, sz);
          }
        }
        break;
      }

      case 'attr-row':
        ctx.fillStyle = part.labelColor || '#aaaaaa';
        ctx.font = `${part.fontSize || 13}px Arial`;
        ctx.textBaseline = 'top';
        ctx.fillText(`${part.attrLabel || ''}:`, x, y);
        ctx.fillStyle = part.attrColor || '#ffffff';
        ctx.fillText('999/999', x + 60, y);
        break;

      case 'scrollbar':
        ctx.fillStyle = part.trackColor || 'rgba(255,255,255,0.1)';
        ctx.fillRect(x, y, width, height);
        ctx.fillStyle = part.thumbColor || 'rgba(255,255,255,0.4)';
        ctx.fillRect(x, y, width, height * 0.4);
        break;

      case 'icon':
        ctx.font = `${part.fontSize || 24}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(part.icon || '⚔️', x + width / 2, y + height / 2);
        ctx.textAlign = 'left';
        break;

      case 'progress-bar':
        ctx.fillStyle = part.bgColor || '#333';
        ctx.fillRect(x, y, width, height);
        ctx.fillStyle = part.fillColor || '#4CAF50';
        ctx.fillRect(x, y, width, height * (part.value || 0.5));
        ctx.strokeStyle = part.borderColor || '#666';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);
        break;

      case 'image':
        // 图片占位：深色底 + 虚线框 + 名称（运行时按 imageMode 绘制实际资源）
        ctx.fillStyle = 'rgba(20, 20, 20, 0.6)';
        ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = '#8B7355';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x, y, width, height);
        ctx.setLineDash([]);
        ctx.fillStyle = '#8B7355';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(part.label || '图片', x + width / 2, y + height / 2);
        ctx.textAlign = 'left';
        break;

      default:
        // 未知类型画占位框
        ctx.strokeStyle = '#f88';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(x, y, width, height);
        ctx.setLineDash([]);
        ctx.fillStyle = '#f88';
        ctx.font = '10px Arial';
        ctx.fillText(part.type, x + 2, y + 12);
    }
  }


  /** 渲染属性面板 */
  _renderProps() {
    const propsEl = this.container.querySelector('#pe-props');
    const panel = this.activePanel;

    const selectedParts = this._getSelectedParts();
    if (panel && selectedParts.length > 1) {
      propsEl.innerHTML = `
        <h4>已选择 ${selectedParts.length} 个部件</h4>
        <div class="pe-prop-empty">拖动任一已选部件可整体移动。方向键单按移动 1px；按住 1/2/3 秒后分别以 10/50/100px 每秒移动。</div>
      `;
      return;
    }

    if (!this.selectedPartId || !panel) {
      // 显示面板属性
      if (panel) {
        propsEl.innerHTML = `
          <h4>面板属性</h4>
          <div class="pe-prop-section">
            <div class="pe-prop-section-title">基本</div>
            <div class="pe-prop-row"><label>ID</label><input type="text" data-panel-key="id" value="${panel.id}"></div>
            <div class="pe-prop-row"><label>名称</label><input type="text" data-panel-key="name" value="${panel.name}"></div>
            <div class="pe-prop-row"><label>宽度</label><input type="number" data-panel-key="width" value="${panel.width}"></div>
            <div class="pe-prop-row"><label>高度</label><input type="number" data-panel-key="height" value="${panel.height}"></div>
            <div class="pe-prop-hint">此处的宽高比就是背包的内外框比例，UI 编辑器只能等比缩放它。</div>
          </div>
          <div class="pe-prop-section">
            <div class="pe-prop-section-title">样式</div>
            <div class="pe-prop-row"><label>背景色</label><input type="text" data-panel-key="backgroundColor" value="${panel.backgroundColor || ''}"></div>
            <div class="pe-prop-row"><label>边框色</label><input type="color" data-panel-key="borderColor" value="${panel.borderColor || '#4a9eff'}"></div>
            <div class="pe-prop-row"><label>边框宽</label><input type="number" data-panel-key="borderWidth" value="${panel.borderWidth || 2}" step="1"></div>
          </div>
          <div class="pe-prop-section">
            <div class="pe-prop-section-title">部件列表 (${panel.parts.length})</div>
            ${panel.parts.map(p => `<div style="font-size:11px;color:#aaa;padding:2px 0;cursor:pointer;" data-select-part="${p.id}">• ${p.label || p.id} <span style="color:#666">(${p.type})</span></div>`).join('')}
          </div>
        `;
        // 面板属性输入
        propsEl.querySelectorAll('[data-panel-key]').forEach(input => {
          input.addEventListener('change', () => {
            const key = input.dataset.panelKey;
            let val = input.value;
            if (key === 'width' || key === 'height' || key === 'borderWidth') val = parseInt(val) || 0;
            if (panel[key] === val) return;
            const snapshot = this._createHistorySnapshot();
            panel[key] = val;
            this._commitHistorySnapshot(snapshot);
            this._renderTabs();
            this._renderCanvas();
          });
        });
        // 部件列表点击选中
        propsEl.querySelectorAll('[data-select-part]').forEach(el => {
          el.addEventListener('click', () => {
            const part = panel.parts.find(p => p.id === el.dataset.selectPart);
            this._setSelection(part ? [part] : []);
            this._renderCanvas();
            this._renderProps();
          });
        });
      } else {
        propsEl.innerHTML = '<h4>属性</h4><div class="pe-prop-empty">无面板</div>';
      }
      return;
    }

    // 部件属性
    const part = panel.parts.find(p => p.id === this.selectedPartId);
    if (!part) {
      propsEl.innerHTML = '<h4>属性</h4><div class="pe-prop-empty">部件未找到</div>';
      return;
    }

    const typeInfo = PART_TYPES[part.type] || { label: part.type };
    let html = `<h4>部件属性</h4>`;
    html += `<div class="pe-prop-section"><div class="pe-prop-section-title">基本</div>`;
    html += `<div class="pe-prop-row"><label>ID</label><input type="text" data-part-key="id" value="${part.id}"></div>`;
    html += `<div class="pe-prop-row"><label>名称</label><input type="text" data-part-key="label" value="${part.label || ''}"></div>`;
    html += `<div class="pe-prop-row"><label>类型</label><select data-part-key="type">${Object.entries(PART_TYPES).map(([k, v]) => `<option value="${k}" ${k === part.type ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>`;
    html += `<div class="pe-prop-row"><label>区域</label><select data-part-key="section"><option value="character" ${part.section === 'character' ? 'selected' : ''}>角色/装备</option><option value="inventory" ${part.section === 'inventory' ? 'selected' : ''}>背包物品</option></select></div>`;
    html += `</div>`;

    html += `<div class="pe-prop-section"><div class="pe-prop-section-title">位置/大小</div>`;
    html += `<div class="pe-prop-row"><label>X</label><input type="number" data-part-key="x" value="${part.x}"></div>`;
    html += `<div class="pe-prop-row"><label>Y</label><input type="number" data-part-key="y" value="${part.y}"></div>`;
    html += `<div class="pe-prop-row"><label>宽度</label><input type="number" data-part-key="width" value="${part.width}"></div>`;
    html += `<div class="pe-prop-row"><label>高度</label><input type="number" data-part-key="height" value="${part.height}"></div>`;
    html += `</div>`;

    // 按类型显示额外属性
    html += `<div class="pe-prop-section"><div class="pe-prop-section-title">类型属性</div>`;
    html += this._buildTypeProps(part);
    html += `</div>`;

    propsEl.innerHTML = html;

    // 绑定输入事件
    propsEl.querySelectorAll('[data-part-key]').forEach(input => {
      input.addEventListener('change', () => {
        const key = input.dataset.partKey;
        let val = input.value;
        // 数值字段
        if (['x', 'y', 'width', 'height', 'fontSize', 'cols', 'rows', 'slotSize', 'slotPadding', 'borderWidth', 'value'].includes(key)) {
          val = parseFloat(val) || 0;
        }
        if (part[key] === val) return;
        const snapshot = this._createHistorySnapshot();
        if (key === 'id') {
          // 同步主选中项与多选集合中的 id。
          this.selectedPartIds.delete(this.selectedPartId);
          this.selectedPartIds.add(val);
          this.selectedPartId = val;
        }
        part[key] = val;
        this._commitHistorySnapshot(snapshot);
        this._renderCanvas();
      });
    });
  }

  /** 根据部件类型生成额外属性表单 */
  _buildTypeProps(part) {
    let html = '';
    switch (part.type) {
      case 'text':
        html += this._propRow('text', '文本', part.text || '', 'text');
        html += this._propRow('fontSize', '字号', part.fontSize || 14, 'number');
        html += this._propRow('fontWeight', '粗体', part.fontWeight || 'normal', 'select', ['normal', 'bold']);
        html += this._propRow('color', '颜色', part.color || '#ffffff', 'color');
        html += this._propRow('align', '对齐', part.align || 'left', 'select', ['left', 'center', 'right']);
        break;
      case 'line':
        html += this._propRow('color', '颜色', part.color || '#4a9eff', 'color');
        break;
      case 'button':
        html += this._propRow('text', '文本', part.text || '', 'text');
        html += this._propRow('fontSize', '字号', part.fontSize || 12, 'number');
        html += this._propRow('color', '文字色', part.color || '#ffffff', 'color');
        html += this._propRow('bgColor', '背景色', part.bgColor || '#3a4a7e', 'color');
        html += this._propRow('borderColor', '边框色', part.borderColor || '#666', 'color');
        break;
      case 'equip-slot':
        html += this._propRow('slotType', '槽类型', part.slotType || '', 'text');
        html += this._propRow('slotLabel', '槽名', part.slotLabel || '', 'text');
        html += this._propRow('slotBgColor', '背景', part.slotBgColor || 'rgba(30,30,30,0.9)', 'text');
        html += this._propRow('slotBorderColor', '边框', part.slotBorderColor || '#555', 'color');
        break;
      case 'slot-grid':
        html += this._propRow('cols', '列数', part.cols || 6, 'number');
        html += this._propRow('rows', '行数', part.rows || 4, 'number');
        html += this._propRow('slotSize', '格子大小', part.slotSize || 50, 'number');
        html += this._propRow('slotPadding', '间距', part.slotPadding || 5, 'number');
        html += this._propRow('slotBgColor', '格子背景', part.slotBgColor || '', 'text');
        html += this._propRow('slotBorderColor', '格子边框', part.slotBorderColor || '#666', 'color');
        break;
      case 'attr-row':
        html += this._propRow('attrLabel', '属性名', part.attrLabel || '', 'text');
        html += this._propRow('attrColor', '值颜色', part.attrColor || '#ffffff', 'color');
        html += this._propRow('labelColor', '标签色', part.labelColor || '#aaaaaa', 'color');
        html += this._propRow('fontSize', '字号', part.fontSize || 13, 'number');
        break;
      case 'scrollbar':
        html += this._propRow('trackColor', '轨道色', part.trackColor || '', 'text');
        html += this._propRow('thumbColor', '滑块色', part.thumbColor || '', 'text');
        break;
      case 'icon':
        html += this._propRow('icon', '图标', part.icon || '', 'text');
        html += this._propRow('fontSize', '大小', part.fontSize || 24, 'number');
        break;
      case 'progress-bar':
        html += this._propRow('fillColor', '填充色', part.fillColor || '#4CAF50', 'color');
        html += this._propRow('bgColor', '背景色', part.bgColor || '#333', 'color');
        html += this._propRow('borderColor', '边框色', part.borderColor || '#666', 'color');
        html += this._propRow('value', '进度(0~1)', part.value || 0.5, 'number');
        break;
    }
    return html;
  }

  /** 生成属性行 HTML */
  _propRow(key, label, value, type, options) {
    if (type === 'select') {
      const opts = (options || []).map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('');
      return `<div class="pe-prop-row"><label>${label}</label><select data-part-key="${key}">${opts}</select></div>`;
    }
    if (type === 'color') {
      return `<div class="pe-prop-row"><label>${label}</label><input type="color" data-part-key="${key}" value="${value}"><input type="text" data-part-key="${key}" value="${value}" style="width:80px"></div>`;
    }
    return `<div class="pe-prop-row"><label>${label}</label><input type="${type}" data-part-key="${key}" value="${value}" ${type === 'number' ? 'step="1"' : ''}></div>`;
  }


  // ─── 交互：鼠标事件 ─────────────────────────────────────

  _getSelectedParts() {
    const panel = this.activePanel;
    if (!panel || this.selectedPartIds.size === 0) return [];
    return panel.parts.filter(part => this.selectedPartIds.has(part.id));
  }

  _setSelection(parts, primaryId = null) {
    const selected = parts || [];
    this.selectedPartIds = new Set(selected.map(part => part.id));
    this.selectedPartId = primaryId && this.selectedPartIds.has(primaryId)
      ? primaryId
      : (selected[selected.length - 1]?.id || null);
  }

  _clearSelection() {
    this.selectedPartIds.clear();
    this.selectedPartId = null;
  }

  _getMarqueeRect(state) {
    const x = Math.min(state.startX, state.currentX);
    const y = Math.min(state.startY, state.currentY);
    return {
      x,
      y,
      width: Math.abs(state.currentX - state.startX),
      height: Math.abs(state.currentY - state.startY)
    };
  }

  _getPartsInRect(rect) {
    const panel = this.activePanel;
    if (!panel) return [];
    return panel.parts.filter(part =>
      part.x < rect.x + rect.width &&
      part.x + part.width > rect.x &&
      part.y < rect.y + rect.height &&
      part.y + part.height > rect.y
    );
  }

  _isEditableTarget(target) {
    return target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable;
  }

  _moveSelectedParts(deltaX, deltaY) {
    const selectedParts = this._getSelectedParts();
    if (selectedParts.length === 0) return false;
    for (const part of selectedParts) {
      part.x = Math.round(part.x + deltaX);
      part.y = Math.round(part.y + deltaY);
    }
    this._renderCanvas();
    return true;
  }

  _onKeyDown(e) {
    const modifier = e.ctrlKey || e.metaKey;
    const lowerKey = e.key.toLowerCase();
    if (modifier && !this._isEditableTarget(e.target)) {
      if (lowerKey === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (lowerKey === 'y') {
        e.preventDefault();
        this.redo();
        return;
      }
    }

    if (this._isEditableTarget(e.target)) return;
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    }[e.key];
    if (!direction || this._getSelectedParts().length === 0) return;

    e.preventDefault();
    if (this._arrowKeyHolds.has(e.key)) return;

    if (this._arrowKeyHolds.size === 0) {
      this._arrowHistorySnapshot = this._createHistorySnapshot();
      this._arrowHistoryChanged = false;
    }
    const [dx, dy] = direction;
    // 首次按下立即精确移动 1px。
    this._arrowHistoryChanged = this._moveSelectedParts(dx, dy) || this._arrowHistoryChanged;
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      if (elapsed < 1000) return;
      // 每 100ms 移动一次，依次对应 10 / 50 / 100 px/s。
      const pixelsPerTick = elapsed >= 3000 ? 10 : (elapsed >= 2000 ? 5 : 1);
      this._arrowHistoryChanged = this._moveSelectedParts(dx * pixelsPerTick, dy * pixelsPerTick) || this._arrowHistoryChanged;
    }, 100);
    this._arrowKeyHolds.set(e.key, timer);
  }

  _onKeyUp(e) {
    const timer = this._arrowKeyHolds.get(e.key);
    if (timer === undefined) return;
    window.clearInterval(timer);
    this._arrowKeyHolds.delete(e.key);
    if (this._arrowKeyHolds.size === 0) {
      if (this._arrowHistoryChanged) this._commitHistorySnapshot(this._arrowHistorySnapshot);
      this._arrowHistorySnapshot = null;
      this._arrowHistoryChanged = false;
      this._renderProps();
    }
  }

  _clearArrowKeyHolds(commitHistory = true) {
    for (const timer of this._arrowKeyHolds.values()) {
      window.clearInterval(timer);
    }
    this._arrowKeyHolds.clear();
    if (commitHistory && this._arrowHistoryChanged) {
      this._commitHistorySnapshot(this._arrowHistorySnapshot);
    }
    this._arrowHistorySnapshot = null;
    this._arrowHistoryChanged = false;
  }

  _canvasXY(e) {
    const canvas = this.container.querySelector('#pe-canvas');
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / this.scale,
      y: (e.clientY - rect.top) / this.scale
    };
  }

  _getPartAt(x, y) {
    const panel = this.activePanel;
    if (!panel) return null;
    // 从后往前（上层优先）
    for (let i = panel.parts.length - 1; i >= 0; i--) {
      const p = panel.parts[i];
      if (x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height) {
        return p;
      }
    }
    return null;
  }

  _isOnResizeHandle(part, x, y) {
    if (!part) return false;
    const hx = part.x + part.width;
    const hy = part.y + part.height;
    return Math.abs(x - hx) < 8 && Math.abs(y - hy) < 8;
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const { x, y } = this._canvasXY(e);
    const panel = this.activePanel;
    if (!panel) return;

    const edgeThreshold = 8;
    const onRight = Math.abs(x - panel.width) < edgeThreshold && y >= 0 && y <= panel.height;
    const onBottom = Math.abs(y - panel.height) < edgeThreshold && x >= 0 && x <= panel.width;
    if (onRight || onBottom) {
      let mode = 'panel-resize-both';
      if (onRight && !onBottom) mode = 'panel-resize-right';
      else if (onBottom && !onRight) mode = 'panel-resize-bottom';
      this._dragState = {
        mode, startX: x, startY: y, startW: panel.width, startH: panel.height,
        historySnapshot: this._createHistorySnapshot()
      };
      this._clearSelection();
      this._renderProps();
      this._startGlobalDrag(e);
      return;
    }

    const selectedParts = this._getSelectedParts();
    const singleSelectedPart = selectedParts.length === 1 ? selectedParts[0] : null;
    if (singleSelectedPart && this._isOnResizeHandle(singleSelectedPart, x, y)) {
      this._dragState = {
        mode: 'resize', part: singleSelectedPart, startX: x, startY: y,
        startW: singleSelectedPart.width, startH: singleSelectedPart.height,
        historySnapshot: this._createHistorySnapshot()
      };
      this._startGlobalDrag(e);
      return;
    }

    const hit = this._getPartAt(x, y);
    if (hit) {
      if (e.ctrlKey || e.metaKey) {
        const next = this._getSelectedParts();
        const existingIndex = next.findIndex(part => part.id === hit.id);
        if (existingIndex >= 0) next.splice(existingIndex, 1);
        else next.push(hit);
        this._setSelection(next, hit.id);
        this._renderCanvas();
        this._renderProps();
        return;
      }
      if (!this.selectedPartIds.has(hit.id)) {
        this._setSelection([hit], hit.id);
      }
      const partsToMove = this._getSelectedParts();
      this._dragState = {
        mode: 'move-selection',
        startX: x,
        startY: y,
        positions: partsToMove.map(part => ({ part, x: part.x, y: part.y })),
        historySnapshot: this._createHistorySnapshot()
      };
      this._renderCanvas();
      this._renderProps();
      this._startGlobalDrag(e);
      return;
    }

    // 在空白区按住左键拖出虚线选框；按住 Ctrl/⌘/Shift 时叠加已有选择。
    this._dragState = {
      mode: 'marquee', startX: x, startY: y, currentX: x, currentY: y,
      additive: e.ctrlKey || e.metaKey || e.shiftKey
    };
    this._startGlobalDrag(e);
  }

  /** 开始拖拽时绑定全局 mousemove/mouseup，确保鼠标移出 canvas 也能跟踪 */
  _startGlobalDrag(e) {
    e.preventDefault();
    const onMove = (ev) => this._onGlobalMouseMove(ev);
    const onUp = (ev) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      this._onMouseUp(ev);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /** 全局拖拽 mousemove：用 canvas 的 boundingRect 换算坐标 */
  _onGlobalMouseMove(e) {
    if (!this._dragState) return;
    const canvas = this.container.querySelector('#pe-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.scale;
    const y = (e.clientY - rect.top) / this.scale;
    const panel = this.activePanel;
    if (!panel) return;
    const ds = this._dragState;

    if (ds.mode === 'marquee') {
      ds.currentX = x;
      ds.currentY = y;
      this._renderCanvas();
    } else if (ds.mode === 'move-selection') {
      const dx = Math.round(x - ds.startX);
      const dy = Math.round(y - ds.startY);
      for (const position of ds.positions) {
        position.part.x = position.x + dx;
        position.part.y = position.y + dy;
      }
      this._renderCanvas();
    } else if (ds.mode === 'resize') {
      ds.part.width = Math.max(10, Math.round(ds.startW + (x - ds.startX)));
      ds.part.height = Math.max(10, Math.round(ds.startH + (y - ds.startY)));
      this._renderCanvas();
    } else if (ds.mode === 'panel-resize-right') {
      panel.width = Math.max(100, Math.round(ds.startW + (x - ds.startX)));
      this._renderCanvas();
    } else if (ds.mode === 'panel-resize-bottom') {
      panel.height = Math.max(100, Math.round(ds.startH + (y - ds.startY)));
      this._renderCanvas();
    } else if (ds.mode === 'panel-resize-both') {
      panel.width = Math.max(100, Math.round(ds.startW + (x - ds.startX)));
      panel.height = Math.max(100, Math.round(ds.startH + (y - ds.startY)));
      this._renderCanvas();
    }
  }

  _onMouseMove(e) {
    if (this._dragState) return;
    const { x, y } = this._canvasXY(e);
    const panel = this.activePanel;
    if (!panel) return;
    const canvas = this.container.querySelector('#pe-canvas');
    const edgeThreshold = 8;
    const onRight = Math.abs(x - panel.width) < edgeThreshold && y >= 0 && y <= panel.height;
    const onBottom = Math.abs(y - panel.height) < edgeThreshold && x >= 0 && x <= panel.width;
    if (onRight && onBottom) canvas.style.cursor = 'nwse-resize';
    else if (onRight) canvas.style.cursor = 'ew-resize';
    else if (onBottom) canvas.style.cursor = 'ns-resize';
    else canvas.style.cursor = this._getPartAt(x, y) ? 'move' : 'crosshair';
  }

  _onMouseUp(e) {
    const ds = this._dragState;
    if (!ds) return;
    this._dragState = null;

    if (ds.mode === 'marquee') {
      const rect = this._getMarqueeRect(ds);
      if (rect.width > 2 && rect.height > 2) {
        const inRect = this._getPartsInRect(rect);
        const selected = ds.additive
          ? [...new Map([...this._getSelectedParts(), ...inRect].map(part => [part.id, part])).values()]
          : inRect;
        this._setSelection(selected);
      } else if (!ds.additive) {
        this._clearSelection();
      }
    }

    if (ds.historySnapshot) this._commitHistorySnapshot(ds.historySnapshot);
    this._renderCanvas();
    this._renderProps();
  }

  _onWheel(e) {
    // 固定100%，不支持缩放，滚轮留给容器自身滚动
  }

  // ─── 面板管理 ─────────────────────────────────────────

  _addPanel() {
    const id = 'panel_' + Date.now();
    const snapshot = this._createHistorySnapshot();
    this.panels.push({
      id,
      name: '新面板',
      width: 300,
      height: 400,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      borderColor: '#4a9eff',
      borderWidth: 2,
      parts: [
        { id: 'title', type: 'text', label: '标题', x: 15, y: 15, width: 270, height: 24, text: '新面板', fontSize: 18, fontWeight: 'bold', color: '#4a9eff', align: 'left' }
      ]
    });
    this.activePanelIndex = this.panels.length - 1;
    this._clearSelection();
    this._commitHistorySnapshot(snapshot);
    this._render();
  }

  _deletePanel(idx) {
    if (this.panels.length <= 1) {
      this._showToast('至少保留一个面板', true);
      return;
    }
    if (!confirm(`确认删除面板「${this.panels[idx].name}」？`)) return;
    const snapshot = this._createHistorySnapshot();
    this.panels.splice(idx, 1);
    if (this.activePanelIndex >= this.panels.length) {
      this.activePanelIndex = this.panels.length - 1;
    }
    this._clearSelection();
    this._commitHistorySnapshot(snapshot);
    this._render();
  }

  // ─── 部件管理 ─────────────────────────────────────────

  _addPart() {
    const panel = this.activePanel;
    if (!panel) return;

    // 弹出类型选择
    const typeKeys = Object.keys(PART_TYPES);
    const choice = prompt(
      '选择部件类型（输入序号）：\n' +
      typeKeys.map((k, i) => `${i + 1}. ${PART_TYPES[k].label} (${k})`).join('\n'),
      '1'
    );
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (idx < 0 || idx >= typeKeys.length) return;

    const typeKey = typeKeys[idx];
    const defaults = PART_TYPES[typeKey].defaults;
    const partId = typeKey + '_' + Date.now();
    const newPart = {
      id: partId,
      section: 'inventory',
      type: typeKey,
      label: PART_TYPES[typeKey].label,
      x: 20,
      y: 20,
      width: typeKey === 'slot-grid' ? 330 : typeKey === 'line' ? 270 : 80,
      height: typeKey === 'slot-grid' ? 220 : typeKey === 'line' ? 2 : 30,
      ...defaults
    };
    const snapshot = this._createHistorySnapshot();
    panel.parts.push(newPart);
    this._setSelection([newPart], partId);
    this._commitHistorySnapshot(snapshot);
    this._render();
  }

  _deletePart() {
    const panel = this.activePanel;
    const selectedParts = this._getSelectedParts();
    if (!panel || selectedParts.length === 0) return;
    const selectedIds = new Set(selectedParts.map(part => part.id));
    const snapshot = this._createHistorySnapshot();
    panel.parts = panel.parts.filter(part => !selectedIds.has(part.id));
    this._clearSelection();
    this._commitHistorySnapshot(snapshot);
    this._render();
  }

  _duplicatePart() {
    const panel = this.activePanel;
    if (!panel || !this.selectedPartId) return;
    const src = panel.parts.find(p => p.id === this.selectedPartId);
    if (!src) return;
    const dup = JSON.parse(JSON.stringify(src));
    dup.id = src.id + '_copy_' + Date.now();
    dup.label = (src.label || '') + ' (副本)';
    dup.x += 15;
    dup.y += 15;
    const snapshot = this._createHistorySnapshot();
    panel.parts.push(dup);
    this._setSelection([dup], dup.id);
    this._commitHistorySnapshot(snapshot);
    this._render();
  }

  // ─── Toast 提示 ────────────────────────────────────────

  _showToast(msg, isError = false) {
    const existing = document.querySelector('.pe-toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'pe-toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2500);
  }
}

export default PanelEditor;
