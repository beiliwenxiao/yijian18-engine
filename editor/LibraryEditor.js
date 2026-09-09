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

import { LibraryItemImageCommandService } from './LibraryItemImageCommandService.js';
import {
  buildManifestImageOptions,
  manifestProjectRoot,
  resolveManifestImageUrl
} from './ManifestImageCatalog.js';

/**
 * LibraryEditor - 内容库编辑器（P2-2）
 *
 * 读写 GameProject（example/<game>/game.project.json）的 library.{类}。
 * 库存“定义(definition)”，场景 objects 引用库 id → 运行时实例化（§1 库与实例分离）。
 * 覆盖：NPC / 敌人 / 物品 / 装备 / 商店 / 职业 / 技能 / 载具 / 建筑。
 *
 * 每条定义 = 通用字段(id/name) + 该类专属字段(JSON)。保存前 JSON 实时校验。
 * 通过 Vite dev server 的受限 canonical transaction endpoint 读写（保留其它字段）。
 */

// 库分类定义（内容库仅保留角色养成类全局定义；可放置内容 NPC/敌人/物品/装备/商店/载具/建筑
// 已移到场景编辑器「资源库·内容」Tab 就地定义+放置）。
const CATEGORIES = [
  // ==== 可放置内容（与场景编辑器「资源库·内容」分类一一对应）====
  { key: 'items', label: '物品', tpl: {
    name: '新物品', type: 'material', imageId: '', maxStack: 99, effect: {}
  }},
  { key: 'equipment', label: '装备', tpl: {
    name: '新装备', slot: 'weapon', icon: '', stats: { attack: 0, defense: 0 }, rarity: 1
  }},
  { key: 'npcs', label: 'NPC', tpl: {
    name: '新NPC',
    title: '',
    portrait: '',
    faction: 'friendly',
    renderStyle: '',
    sprite: { src: '', frameWidth: 64, frameHeight: 64, cols: 4, rows: 4 },
    animations: { idle: { row: 0, frames: 4, speed: 0.2 } },
    baseStats: { maxHp: 100 },
    dialogueId: '',
    shopId: '',
    questId: '',
    interaction: { radius: 60, prompt: '按 E 对话', trigger: 'interact' }
  }},
  { key: 'enemies', label: '敌人/Boss', tpl: {
    name: '新敌人',
    sprite: { src: '', frameWidth: 64, frameHeight: 64, cols: 4, rows: 4 },
    animations: { idle: { row: 0, frames: 4, speed: 0.15 }, walk: { row: 1, frames: 4, speed: 0.1 }, attack: { row: 2, frames: 4, speed: 0.08 }, death: { row: 3, frames: 4, speed: 0.12 } },
    baseStats: { maxHp: 200, attack: 15, defense: 8, speed: 80 },
    ai: { type: 'melee', aggroRange: 200, attackRange: 50 },
    loot: []
  }},
  { key: 'resourceNodes', label: '资源节点', tpl: {
    name: '新资源节点', schemaVersion: 1, resourceType: 'wood', itemId: '',
    remaining: 10, maxRemaining: 10, yieldPerGather: 2, gatherDuration: 1.5,
    interactionRadius: 72, requiredToolType: null, refreshDays: 0,
    guardUnitIds: [], damageRatio: 0
  }},
  { key: 'shops', label: '商店', tpl: { name: '新商店', goods: [] } },
  { key: 'vehicles', label: '载具', tpl: {
    name: '新载具', vehicleType: 'horse', speed: 200, hp: 100,
    seats: [{ id: 'drv', role: 'driver', offset: [0, 0] }]
  }},
  { key: 'buildings', label: '建筑', tpl: {
    name: '新建筑', buildingType: 'gate', maxHp: 1000, colliderRadius: 40, controllable: false, onDestroyed: []
  }},
  // ==== 角色养成全局定义 ====
  { key: 'players', label: '玩家', tpl: {
    name: '新玩家',
    sprite: { src: '', frameWidth: 64, frameHeight: 64, cols: 4, rows: 4 },
    animations: { idle: { row: 0, frames: 4, speed: 0.15 }, walk: { row: 1, frames: 4, speed: 0.1 }, attack: { row: 2, frames: 4, speed: 0.08 }, death: { row: 3, frames: 4, speed: 0.12 } },
    baseStats: { maxHp: 100, maxMp: 50, attack: 10, defense: 5, speed: 150 }
  }},
  { key: 'classes', label: '职业', tpl: { name: '新职业', baseStats: { maxHp: 100, maxMp: 50, attack: 10, defense: 5, speed: 100 }, startSkills: [] } },
  { key: 'combatSkills', label: '战斗技能', tpl: { name: '新战斗技能', skillType: 'combat', cooldown: 3, castTime: 0, manaCost: 10, damage: 0, element: 0, range: 100 } },
  { key: 'gatherSkills', label: '采集技能', tpl: { name: '新采集技能', skillType: 'gather', resource: '', gatherTime: 2, level: 1, yield: 1 } },
  { key: 'craftSkills', label: '生产技能', tpl: { name: '新生产技能', skillType: 'craft', product: '', materials: [], craftTime: 3, level: 1 } },
  { key: 'talents', label: '天赋', tpl: { name: '新天赋', tier: 1, maxRank: 3, effects: [] } }
];

// 通用主键字段（不进 JSON 专属区，单独用输入框编辑）
const COMMON_FIELDS = ['id', 'name'];
const ITEM_MANAGED_FIELDS = ['id', 'name', 'type', 'imageId', 'assetId'];
const STABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const ITEM_TYPE_LABELS = Object.freeze({
  material: '材料',
  consumable: '消耗品',
  equipment: '装备',
  tool: '工具',
  quest: '任务物品',
  resource: '资源',
  currency: '货币',
  key: '钥匙',
  miscellaneous: '杂项'
});

function itemTypeLabel(type) {
  return ITEM_TYPE_LABELS[type] || `自定义类型（${type}）`;
}

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export class LibraryEditor {
  /**
   * @param {HTMLElement} container
   * @param {Object} options - { gameId }
   */
  constructor(container, options = {}) {
    this.container = container;
    this.gameId = options.gameId || 'sanguo_zhangjiao';
    this.canonicalSession = options.canonicalSession || null;
    this.schemaFields = this.canonicalSession?.fields || null;
    this.imageCommandService = options.imageCommandService || new LibraryItemImageCommandService();
    this.projectPath = `example/${this.gameId}/game.project.json`;
    this.project = null;
    this.library = null;
    this.activeCategory = CATEGORIES[0].key;
    this.selectedIndex = -1;
    this._manifestImageOptions = [];
    this._manifestImageOptionsById = new Map();
    this._manifestImageOptionsPromise = null;
    this._manifestError = null;
    this._pendingImageUpdates = new Map();
    this._pendingImagePreviewUrls = new Map();
    this._itemDraftSequence = 0;
    this._initialized = false;
  }

  async init() {
    if (!this._initialized) {
      this._initialized = true;
      this._buildUI();
      this._injectStyles();
    }
    await this._load();
    try {
      await this._ensureManifestImageOptions();
    } catch (error) {
      this._manifestError = error;
      console.warn('[LibraryEditor] Manifest 图片目录加载失败:', error);
    }
    this._renderCategories();
    this._renderList();
    this._renderDetail();
  }

  /** 加载共享 canonical candidate。 */
  async _load() {
    if (!this.canonicalSession) {
      throw new TypeError('LibraryEditor requires a shared CanonicalEditorSession');
    }
    this.project = this.canonicalSession.getValue();
    if (!this.project || typeof this.project !== 'object') {
      throw new Error('LibraryEditor: canonical project candidate 不可用');
    }
    if (!this.project.library || typeof this.project.library !== 'object') this.project.library = {};
    // 确保每个分类数组存在
    for (const c of CATEGORIES) {
      if (!Array.isArray(this.project.library[c.key])) this.project.library[c.key] = [];
    }
    this.library = this.project.library;
  }

  async _ensureManifestImageOptions() {
    if (this._manifestImageOptions.length > 0) return this._manifestImageOptions;
    if (this._manifestImageOptionsPromise) return this._manifestImageOptionsPromise;

    const projectPath = this.canonicalSession?.sourceUri || this.projectPath;
    const projectRoot = manifestProjectRoot(projectPath);
    if (!projectRoot) throw new Error('当前游戏工程路径为空');
    const request = fetch(`/${projectRoot}/assets/manifests/assets.json`)
      .then(async response => {
        if (!response.ok) throw new Error(`Manifest 请求失败: ${response.status}`);
        return response.json();
      })
      .then(manifest => {
        const options = buildManifestImageOptions(manifest, projectPath);
        this._manifestImageOptions = options;
        this._manifestImageOptionsById = new Map(options.map(option => [option.imageId, option]));
        this._manifestError = null;
        return options;
      });
    this._manifestImageOptionsPromise = request;
    try {
      return await request;
    } finally {
      if (this._manifestImageOptionsPromise === request) this._manifestImageOptionsPromise = null;
    }
  }

  _itemTypeOptions() {
    const types = new Set(['material']);
    for (const item of this.library?.items || []) {
      const type = typeof item?.type === 'string' ? item.type.trim() : '';
      if (type) types.add(type);
    }
    return [...types].sort((left, right) => left.localeCompare(right, 'en'));
  }

  _manifestImageOption(imageId) {
    return this._manifestImageOptionsById.get(String(imageId || '').trim()) || null;
  }

  /** 保存回工程文件（保留其它字段） */
  async save() {
    if (this._validateDetailJson()) {
      this._toast('JSON 格式错误，请修正后再保存（红框处）', 'error');
      this._status('❌ JSON 格式错误，未保存', 'err');
      return { ok: false, committed: false, status: 'rejected', code: 'invalidJson' };
    }
    this._commitDetail();
    if (this._validateItemLibrary()) {
      this._toast('物品定义校验失败，请修正后再保存', 'error');
      return { ok: false, committed: false, status: 'rejected', code: 'invalidItemDefinition' };
    }
    this.project.library = this.library;
    try {
      const data = this._pendingImageUpdates.size > 0
        ? await this.imageCommandService.save(this.canonicalSession.sourceUri || this.projectPath, {
          library: this.library,
          imageUpdates: [...this._pendingImageUpdates.values()]
        })
        : await this._saveLibraryOnly();
      if (data?.ok === true && data.committed === true) {
        if (this._pendingImageUpdates.size > 0) this._acceptImageTransaction(data);
        const n = this._current().length;
        if (data.degraded) {
          const warning = '磁盘已提交，但缓存/通知同步降级';
          this._status('⚠️ ' + warning, 'warn');
          this._toast(warning, 'warn');
        } else {
          this._status('✅ 已保存到 ' + this.projectPath, 'ok');
          this._toast('保存成功（' + this._catLabel() + ' ' + n + ' 条）', 'success');
        }
        return data;
      }
      const firstError = data?.errors?.[0];
      const message = [firstError?.path, firstError?.message || firstError?.reason]
        .filter(Boolean)
        .join(': ') || data?.error?.message || data?.error || '未知';
      this._status('❌ 保存失败: ' + message, 'err');
      this._toast('保存失败: ' + message, 'error');
      return data;
    } catch (error) {
      const result = error.result || { ok: false, committed: false, status: 'failed', error };
      this._status('❌ 保存失败: ' + error.message, 'err');
      this._toast('保存失败: ' + error.message, 'error');
      return result;
    }
  }

  async _saveLibraryOnly() {
    this.canonicalSession.patch('library', this.library);
    return this.canonicalSession.save();
  }

  _acceptImageTransaction(data) {
    if (!data?.project || !data?.manifest) throw new Error('内容库图片事务未返回完整项目或 Manifest');
    this.canonicalSession.acceptExternalProjectCommit(data.project);
    this.project = data.project;
    this.library = data.project.library;
    this._manifestImageOptions = buildManifestImageOptions(data.manifest, this.canonicalSession.sourceUri || this.projectPath);
    this._manifestImageOptionsById = new Map(this._manifestImageOptions.map(option => [option.imageId, option]));
    this._clearPendingImageUpdates();
    this._renderList();
    this._renderDetail();
  }

  _clearPendingImageUpdates() {
    for (const url of this._pendingImagePreviewUrls.values()) URL.revokeObjectURL(url);
    this._pendingImagePreviewUrls.clear();
    this._pendingImageUpdates.clear();
  }

  // ---- 数据辅助 ----
  _current() { return this.library[this.activeCategory] || []; }
  _catDef() { return CATEGORIES.find(c => c.key === this.activeCategory); }
  _catLabel() { return (this._catDef() || {}).label || this.activeCategory; }

  // ---- UI 构建 ----
  _buildUI() {
    const catBtns = CATEGORIES.map(c =>
      `<button class="lib-cat" data-cat="${c.key}">${c.label}</button>`).join('');
    this.container.innerHTML = `
      <div class="lib-root">
        <div class="lib-cats">${catBtns}</div>
        <div class="lib-toolbar">
          <button id="lib-add">+ 新增</button>
          <button id="lib-del">🗑 删除</button>
          <button id="lib-save" class="primary">💾 保存到工程</button>
          <span class="lib-hint">数据 → ${this.projectPath} · library</span>
        </div>
        <div class="lib-main">
          <div class="lib-list" id="lib-list"></div>
          <div class="lib-detail" id="lib-detail"></div>
        </div>
        <div class="lib-status" id="lib-status"></div>
      </div>`;
    this.container.querySelector('#lib-add').addEventListener('click', () => this._addEntry());
    this.container.querySelector('#lib-del').addEventListener('click', () => this._deleteEntry());
    this.container.querySelector('#lib-save').addEventListener('click', async () => {
      await this.save();
    });
    this.container.querySelectorAll('.lib-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        this._commitDetail();
        this.activeCategory = btn.dataset.cat;
        this.selectedIndex = -1;
        this._renderCategories();
        this._renderList();
        this._renderDetail();
      });
    });
  }

  _injectStyles() {
    if (document.getElementById('lib-styles')) return;
    const s = document.createElement('style');
    s.id = 'lib-styles';
    s.textContent = `
      .lib-root{display:flex;flex-direction:column;height:100%;background:#0d1326;color:#fff;}
      .lib-cats{display:flex;flex-wrap:wrap;gap:4px;padding:8px 12px;background:#101a30;border-bottom:1px solid #2a3a5e;}
      .lib-cat{padding:6px 12px;background:#26304e;border:none;border-radius:14px;color:#bcd;cursor:pointer;font-size:12px;}
      .lib-cat.active{background:#4a6ad0;color:#fff;font-weight:bold;}
      .lib-toolbar{display:flex;align-items:center;gap:8px;padding:8px 16px;background:#16213e;border-bottom:1px solid #2a3a5e;}
      .lib-toolbar button{padding:6px 12px;background:#3a4a7e;border:none;border-radius:4px;color:#fff;cursor:pointer;}
      .lib-toolbar button.primary{background:#4CAF50;color:#000;font-weight:bold;}
      .lib-hint{margin-left:auto;color:#8aa;font-size:12px;}
      .lib-main{flex:1;display:flex;overflow:hidden;}
      .lib-list{width:220px;background:#111a30;border-right:1px solid #2a3a5e;overflow-y:auto;}
      .lib-item{padding:9px 14px;border-bottom:1px solid #1e2b47;cursor:pointer;}
      .lib-item:hover{background:#1a2540;}
      .lib-item.active{background:#2a3a6e;}
      .lib-item .li-name{font-weight:bold;font-size:13px;word-break:break-all;}
      .lib-item .li-id,.lib-item .li-meta{font-size:11px;color:#9ab;word-break:break-all;}
      .lib-item .li-item-row{display:flex;gap:8px;align-items:flex-start;}
      .lib-item .li-preview{width:36px;height:36px;border:1px solid #2a3a5e;border-radius:4px;object-fit:contain;background:#080d1a;flex:none;}
      .lib-detail{flex:1;padding:16px;overflow-y:auto;}
      .lib-detail .row{margin-bottom:10px;}
      .lib-detail label{display:block;font-size:12px;color:#9ab;margin-bottom:3px;}
      .lib-detail input[type=text],.lib-detail select,.lib-detail textarea{width:100%;box-sizing:border-box;background:#0a1020;border:1px solid #2a3a5e;color:#fff;padding:6px;border-radius:3px;font-family:monospace;font-size:12px;}
      .lib-detail input[readonly]{background:#11182d;color:#b9c7e6;}
      .lib-detail textarea{min-height:180px;resize:vertical;}
      .lib-empty{color:#778;padding:40px;text-align:center;}
      .lib-status{padding:6px 16px;font-size:12px;min-height:22px;background:#0a1020;}
      .lib-status.ok{color:#6c6;} .lib-status.err{color:#e66;}
    `;
    document.head.appendChild(s);
  }

  _status(msg, kind) {
    const el = this.container.querySelector('#lib-status');
    if (el) { el.textContent = msg; el.className = 'lib-status ' + (kind || ''); }
  }

  _toast(msg, type = 'success') {
    let t = document.getElementById('lib-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'lib-toast';
      t.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);' +
        'padding:12px 28px;border-radius:8px;color:#fff;font-size:15px;font-weight:bold;' +
        'z-index:100000;pointer-events:none;transition:opacity 0.3s;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
      document.body.appendChild(t);
    }
    const tone = type === true ? 'success' : type === false ? 'error' : type;
    const presentations = {
      success: { icon: '✅ ', background: '#2e7d32' },
      warn: { icon: '⚠️ ', background: '#9a6700' },
      error: { icon: '❌ ', background: '#c62828' }
    };
    const presentation = presentations[tone] || presentations.success;
    t.textContent = presentation.icon + msg;
    t.dataset.type = tone;
    t.style.background = presentation.background;
    t.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2200);
  }

  // ---- 渲染 ----
  _renderCategories() {
    this.container.querySelectorAll('.lib-cat').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === this.activeCategory);
    });
  }

  _renderList() {
    const list = this.container.querySelector('#lib-list');
    if (!list) return;
    const entries = this._current();
    if (entries.length === 0) {
      list.innerHTML = '<div class="lib-empty">暂无' + this._catLabel() + '<br>点击「+ 新增」</div>';
      return;
    }
    list.innerHTML = '';
    entries.forEach((e, i) => {
      const item = document.createElement('div');
      item.className = 'lib-item' + (i === this.selectedIndex ? ' active' : '');
      if (this.activeCategory === 'items') {
        const imageId = String(e.imageId || e.assetId || '').trim();
        const image = this._manifestImageOption(imageId);
        const preview = image?.url
          ? `<img class="li-preview" src="${escapeHtml(image.url)}" alt="${escapeHtml(e.name || e.id || '物品图片')}">`
          : `<div class="li-preview" style="display:flex;align-items:center;justify-content:center;color:#ff9a9a;font-size:10px;">缺图</div>`;
        item.innerHTML = `<div class="li-item-row">${preview}<div style="min-width:0;flex:1;"><div class="li-name">${escapeHtml(e.name || '(未命名)')}</div><div class="li-id">${escapeHtml(e.id || '')}</div><div class="li-meta">类型: ${escapeHtml(e.type ? itemTypeLabel(e.type) : '未设置')}</div></div></div>`;
      } else {
        item.innerHTML = `<div class="li-name">${escapeHtml(e.name || '(未命名)')}</div><div class="li-id">${escapeHtml(e.id || '')}</div>`;
      }
      item.addEventListener('click', () => {
        this._commitDetail();
        this.selectedIndex = i;
        this._renderList();
        this._renderDetail();
      });
      list.appendChild(item);
    });
  }

  _renderDetail() {
    const panel = this.container.querySelector('#lib-detail');
    if (!panel) return;
    const e = this._current()[this.selectedIndex];
    if (!e) {
      panel.innerHTML = '<div class="lib-empty">选择或新增一个' + this._catLabel() + '定义</div>';
      return;
    }

    // 玩家/敌人/NPC 使用结构化面板
    const cat = this.activeCategory;
    if (cat === 'players' || cat === 'enemies' || cat === 'npcs') {
      this._renderSpriteDetail(panel, e, cat);
      return;
    }
    if (cat === 'items') {
      this._renderItemDetail(panel, e);
      return;
    }

    // 其余类别使用通用 JSON 编辑
    const rest = {};
    for (const k of Object.keys(e)) {
      if (!COMMON_FIELDS.includes(k)) rest[k] = e[k];
    }
    panel.innerHTML = `
      <div class="row"><label>ID（库主键，场景对象用它引用）</label><input type="text" id="l-id" value="${e.id || ''}"></div>
      <div class="row"><label>名称 name</label><input type="text" id="l-name" value="${e.name || ''}"></div>
      <div class="row"><label>专属属性（JSON）</label><textarea id="l-props">${this._json(rest, 2)}</textarea></div>
    `;
    this._bindJsonValidation(panel.querySelector('#l-props'));
  }

  _renderItemDetail(panel, entry) {
    const selectedType = String(entry.type || 'material').trim() || 'material';
    const itemTypes = this._itemTypeOptions();
    if (!itemTypes.includes(selectedType)) itemTypes.push(selectedType);
    const selectedImageId = String(entry.imageId || entry.assetId || '').trim();
    const selectedImage = this._manifestImageOption(selectedImageId);
    const selectedDisplay = this._imageDisplay(selectedImageId);
    const imageOptions = [...this._manifestImageOptions];
    const hasCurrentImage = imageOptions.some(option => option.imageId === selectedImageId);
    const rest = {};
    for (const key of Object.keys(entry)) {
      if (!ITEM_MANAGED_FIELDS.includes(key)) rest[key] = entry[key];
    }
    panel.innerHTML = `
      <div class="row"><label>ID（库主键，场景对象用它引用）</label><input type="text" id="l-id" value="${escapeHtml(entry.id || '')}"></div>
      <div class="row"><label>名称 name</label><input type="text" id="l-name" value="${escapeHtml(entry.name || '')}"></div>
      <div class="row"><label>物品类型</label><select id="l-item-type">${itemTypes
        .sort((left, right) => left.localeCompare(right, 'en'))
        .map(type => `<option value="${escapeHtml(type)}" ${type === selectedType ? 'selected' : ''}>${escapeHtml(itemTypeLabel(type))}</option>`)
        .join('')}</select></div>
      <div class="row"><label>图片资源 ID（稳定 ID）</label><select id="l-image-id" ${imageOptions.length ? '' : 'disabled'}><option value="">选择 Manifest 图片资源</option>${!hasCurrentImage && selectedImageId ? `<option value="${escapeHtml(selectedImageId)}" selected>当前 ID 无效：${escapeHtml(selectedImageId)}</option>` : ''}${imageOptions
        .map(option => `<option value="${escapeHtml(option.imageId)}" ${option.imageId === selectedImageId ? 'selected' : ''}>${escapeHtml(option.imageId)} · ${escapeHtml(option.path)}</option>`)
        .join('')}</select><small style="display:block;margin-top:4px;color:#9ab;font-size:11px;line-height:1.45;">选择其他稳定 ID 会更换本物品的图片引用；不会修改资源本身的稳定 ID。</small></div>
      <div class="row"><label>图片路径（Manifest）</label><input type="text" id="l-image-path" value="${escapeHtml(selectedDisplay.path)}" placeholder="assets/images/...png"><small style="display:block;margin-top:4px;color:#9ab;font-size:11px;line-height:1.45;">仅修改当前稳定 ID 对应的 Manifest 映射；路径必须是 assets/images/ 下的 .png。</small></div>
      <div class="row"><label>从本机导入 PNG（替换当前稳定 ID 的图片文件）</label><input type="file" id="l-image-file" accept=".png,image/png"><small style="display:block;margin-top:4px;color:#9ab;font-size:11px;line-height:1.45;">文件会先作为草稿预览，点击保存后才与 library、Manifest 一次性提交。</small></div>
      <div class="row" style="display:flex;gap:10px;align-items:center;"><div style="width:72px;height:72px;border:1px solid #2a3a5e;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#080d1a;flex:none;"><img id="l-image-preview" alt="物品图片预览" src="${escapeHtml(selectedDisplay.url)}" style="display:${selectedDisplay.url ? 'block' : 'none'};width:100%;height:100%;object-fit:contain;"><span id="l-image-empty" style="display:${selectedDisplay.url ? 'none' : ''};padding:6px;text-align:center;color:#ff9a9a;font-size:11px;">${this._manifestError ? '图片目录加载失败' : '未选择有效图片资源'}</span></div><small id="l-image-status" style="color:#9ab;font-size:11px;line-height:1.45;">${escapeHtml(selectedDisplay.status)}</small></div>
      <div class="row"><label>专属属性（JSON）</label><textarea id="l-props">${escapeHtml(this._json(rest, 2))}</textarea></div>
    `;
    this._bindJsonValidation(panel.querySelector('#l-props'));
    panel.querySelector('#l-image-id')?.addEventListener('change', () => this._updateItemImagePreview(panel));
    panel.querySelector('#l-image-path')?.addEventListener('change', () => this._queueImagePathUpdate(panel));
    panel.querySelector('#l-image-file')?.addEventListener('change', async event => {
      await this._queueImportedPng(panel, event.currentTarget.files?.[0]);
    });
    this._updateItemImagePreview(panel);
  }

  _imageDisplay(imageId) {
    const pending = this._pendingImageUpdates.get(imageId);
    const image = this._manifestImageOption(imageId);
    const path = pending?.runtimePath || image?.path || '';
    const url = pending?.mode === 'importPng'
      ? this._pendingImagePreviewUrls.get(imageId) || ''
      : path
        ? resolveManifestImageUrl({ runtime2D: { path } }, this.canonicalSession?.sourceUri || this.projectPath)
        : image?.url || '';
    const source = pending?.mode === 'importPng'
      ? '本机 PNG 草稿，保存后导入'
      : pending?.mode === 'existingPath'
        ? 'Manifest 路径草稿，保存后生效'
        : image?.status
          ? `稳定 ID：${imageId} · ${image.status}`
          : '物品只保存稳定 imageId/assetId；路径由 Manifest 映射。';
    return { imageId, path, url, status: source };
  }

  _updateItemImagePreview(panel) {
    const imageId = String(panel.querySelector('#l-image-id')?.value || '').trim();
    const display = this._imageDisplay(imageId);
    const pathInput = panel.querySelector('#l-image-path');
    const preview = panel.querySelector('#l-image-preview');
    const empty = panel.querySelector('#l-image-empty');
    const status = panel.querySelector('#l-image-status');
    if (!pathInput || !preview || !empty || !status) return;
    pathInput.value = display.path;
    if (display.url) {
      preview.src = display.url;
      preview.style.display = 'block';
      empty.style.display = 'none';
    } else {
      preview.removeAttribute('src');
      preview.style.display = 'none';
      empty.style.display = '';
    }
    status.textContent = display.status;
  }

  _queueImagePathUpdate(panel) {
    const imageId = String(panel.querySelector('#l-image-id')?.value || '').trim();
    const runtimePath = String(panel.querySelector('#l-image-path')?.value || '').trim();
    const originalPath = this._manifestImageOption(imageId)?.path || '';
    if (!imageId) {
      this._status('❌ 请先选择图片资源 ID', 'err');
      return;
    }
    const pending = this._pendingImageUpdates.get(imageId);
    if (pending?.mode === 'importPng') {
      this._pendingImageUpdates.set(imageId, { ...pending, runtimePath });
    } else if (runtimePath === originalPath) {
      this._pendingImageUpdates.delete(imageId);
    } else {
      this._pendingImageUpdates.set(imageId, { imageId, runtimePath, mode: 'existingPath' });
    }
    this._updateItemImagePreview(panel);
  }

  async _queueImportedPng(panel, file) {
    if (!file) return;
    const imageId = String(panel.querySelector('#l-image-id')?.value || '').trim();
    const pathInput = panel.querySelector('#l-image-path');
    const runtimePath = this._projectImagePathForLocalFile(file.name, pathInput?.value);
    if (!imageId || !this._manifestImageOption(imageId)) {
      this._status('❌ 请先选择有效的 Manifest 图片资源', 'err');
      return;
    }
    if (!/\.png$/i.test(file.name) || (file.type && file.type !== 'image/png')) {
      this._status('❌ 只允许选择 PNG 图片', 'err');
      return;
    }
    if (file.size <= 0 || file.size > 15 * 1024 * 1024) {
      this._status('❌ PNG 文件必须介于 1B 和 15MB', 'err');
      return;
    }
    if (!runtimePath) {
      this._status('❌ 无法从所选文件生成项目内图片路径', 'err');
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = this._bytesToBase64(bytes);
    const oldUrl = this._pendingImagePreviewUrls.get(imageId);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    this._pendingImagePreviewUrls.set(imageId, URL.createObjectURL(file));
    this._pendingImageUpdates.set(imageId, {
      imageId,
      runtimePath,
      mode: 'importPng',
      base64,
      replaceExisting: true
    });
    if (pathInput) pathInput.value = runtimePath;
    this._updateItemImagePreview(panel);
    this._status(`🖼️ 已选择 ${file.name}，路径已更新为 ${runtimePath}；点击保存后原子提交`, 'warn');
  }

  _projectImagePathForLocalFile(fileName, currentPath) {
    const baseName = String(fileName || '').trim().replace(/\\/g, '/').split('/').pop();
    if (!baseName || !/\.png$/i.test(baseName)) return '';
    const current = String(currentPath || '').trim().replace(/\\/g, '/');
    const lastSlash = current.lastIndexOf('/');
    const directory = current.startsWith('assets/images/') && lastSlash >= 'assets/images'.length
      ? current.slice(0, lastSlash)
      : 'assets/images';
    return `${directory}/${baseName}`;
  }

  _bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  /**
   * 渲染 玩家/敌人/NPC 结构化编辑面板（sprite + animations + 属性）
   */
  _renderSpriteDetail(panel, e, cat) {
    const sprite = e.sprite || {};
    const anims = e.animations || {};
    const stats = e.baseStats || {};
    const ai = e.ai || {};

    let animRows = '';
    for (const [name, anim] of Object.entries(anims)) {
      animRows += `<tr>
        <td><input type="text" value="${name}" data-anim-key="${name}" class="anim-name" style="width:60px;"></td>
        <td><input type="number" value="${anim.row != null ? anim.row : 0}" data-anim="${name}" data-field="row" min="0" style="width:40px;"></td>
        <td><input type="number" value="${anim.frames || 4}" data-anim="${name}" data-field="frames" min="1" style="width:40px;"></td>
        <td><input type="number" value="${anim.speed || 0.1}" data-anim="${name}" data-field="speed" min="0.01" step="0.01" style="width:50px;"></td>
        <td><button class="anim-del" data-anim="${name}" style="padding:2px 6px;cursor:pointer;">×</button></td>
      </tr>`;
    }

    let statsHtml = '';
    for (const [k, v] of Object.entries(stats)) {
      statsHtml += `<div style="display:inline-block;margin:2px 6px 2px 0;"><label style="font-size:11px;color:#9ab;">${k}</label><input type="number" value="${v}" data-stat="${k}" style="width:50px;margin-left:4px;"></div>`;
    }

    let aiHtml = '';
    if (cat === 'enemies') {
      aiHtml = `
        <div class="row"><label>AI 类型</label><select id="l-ai-type">
          <option value="melee" ${ai.type === 'melee' ? 'selected' : ''}>近战</option>
          <option value="ranged" ${ai.type === 'ranged' ? 'selected' : ''}>远程</option>
          <option value="patrol" ${ai.type === 'patrol' ? 'selected' : ''}>巡逻</option>
          <option value="boss" ${ai.type === 'boss' ? 'selected' : ''}>Boss</option>
          <option value="passive" ${ai.type === 'passive' ? 'selected' : ''}>被动</option>
        </select></div>
        <div class="row"><label>仇恨范围</label><input type="number" id="l-ai-aggro" value="${ai.aggroRange || 200}" min="0"></div>
        <div class="row"><label>攻击范围</label><input type="number" id="l-ai-atkrange" value="${ai.attackRange || 50}" min="0"></div>
        <div class="row"><label>掉落表(JSON)</label><textarea id="l-loot" style="min-height:60px;">${this._json(e.loot || [], 2)}</textarea></div>
      `;
    }

    let npcHtml = '';
    if (cat === 'npcs') {
      const it = e.interaction || {};
      npcHtml = `
        <hr style="border-color:#2a3a5e;margin:10px 0;">
        <div class="row"><label style="font-weight:bold;">NPC 配置</label></div>
        <div class="row"><label>称号（名字上方显示，可选）</label><input type="text" id="l-title" value="${e.title || ''}" placeholder="如 太平道创始人"></div>
        <div class="row"><label>立绘 key（对话框显示，可选）</label><input type="text" id="l-portrait" value="${e.portrait || ''}" placeholder="如 zhangjiao"></div>
        <div class="row"><label>内置立绘样式 renderStyle（无序列帧图片时用，可选）</label><input type="text" id="l-renderstyle" value="${e.renderStyle || ''}" placeholder="如 zhangjiao / cook"></div>
        <div class="row"><label>阵营</label><select id="l-faction">
          <option value="friendly" ${(e.faction || 'friendly') === 'friendly' ? 'selected' : ''}>友好 friendly</option>
          <option value="neutral" ${e.faction === 'neutral' ? 'selected' : ''}>中立 neutral</option>
          <option value="hostile" ${e.faction === 'hostile' ? 'selected' : ''}>敌对 hostile</option>
        </select></div>
        <div class="row"><label>对话ID</label><input type="text" id="l-dialogue" value="${e.dialogueId || ''}" placeholder="dialogues 中的 id"></div>
        <div class="row"><label>商店ID</label><input type="text" id="l-shop" value="${e.shopId || ''}" placeholder="留空表示无商店"></div>
        <div class="row"><label>任务ID</label><input type="text" id="l-quest" value="${e.questId || ''}" placeholder="留空表示无任务"></div>
        <div class="row" style="display:flex;gap:8px;align-items:flex-end;">
          <div style="flex:1;"><label>交互半径</label><input type="number" id="l-it-radius" value="${it.radius != null ? it.radius : 60}" min="0" style="width:100%;"></div>
          <div style="flex:1;"><label>触发方式</label><select id="l-it-trigger" style="width:100%;">
            <option value="interact" ${(it.trigger || 'interact') === 'interact' ? 'selected' : ''}>按 E/点击</option>
            <option value="approach" ${it.trigger === 'approach' ? 'selected' : ''}>靠近自动</option>
          </select></div>
        </div>
        <div class="row"><label>交互提示文字</label><input type="text" id="l-it-prompt" value="${it.prompt || '按 E 对话'}"></div>
      `;
    }

    panel.innerHTML = `
      <div class="row"><label>ID（库主键）</label><input type="text" id="l-id" value="${e.id || ''}"></div>
      <div class="row"><label>名称</label><input type="text" id="l-name" value="${e.name || ''}"></div>
      <hr style="border-color:#2a3a5e;margin:10px 0;">
      <div class="row"><label style="font-weight:bold;">序列帧（Sprite Sheet）</label></div>
      <div class="row"><label>图片路径</label><input type="text" id="l-sprite-src" value="${sprite.src || ''}" placeholder="assets/images/player.png"></div>
      <div class="row" style="display:flex;gap:8px;">
        <div><label>帧宽</label><input type="number" id="l-sprite-fw" value="${sprite.frameWidth || 64}" min="1" style="width:60px;"></div>
        <div><label>帧高</label><input type="number" id="l-sprite-fh" value="${sprite.frameHeight || 64}" min="1" style="width:60px;"></div>
        <div><label>列数</label><input type="number" id="l-sprite-cols" value="${sprite.cols || 4}" min="1" style="width:50px;"></div>
        <div><label>行数</label><input type="number" id="l-sprite-rows" value="${sprite.rows || 4}" min="1" style="width:50px;"></div>
      </div>
      <hr style="border-color:#2a3a5e;margin:10px 0;">
      <div class="row"><label style="font-weight:bold;">动画定义</label> <button id="l-anim-add" style="padding:2px 8px;cursor:pointer;margin-left:8px;">+ 添加动画</button></div>
      <table style="width:100%;font-size:11px;border-collapse:collapse;">
        <thead><tr style="color:#9ab;"><th>名称</th><th>行</th><th>帧数</th><th>速度</th><th></th></tr></thead>
        <tbody id="l-anim-table">${animRows}</tbody>
      </table>
      <hr style="border-color:#2a3a5e;margin:10px 0;">
      <div class="row"><label style="font-weight:bold;">基础属性</label> <button id="l-stat-add" style="padding:2px 8px;cursor:pointer;margin-left:8px;">+ 属性</button></div>
      <div id="l-stats-area">${statsHtml}</div>
      ${aiHtml}
      ${npcHtml}
    `;

    // 绑定事件
    panel.querySelector('#l-anim-add')?.addEventListener('click', () => {
      const name = 'anim_' + Object.keys(anims).length;
      anims[name] = { row: Object.keys(anims).length, frames: 4, speed: 0.1 };
      e.animations = anims;
      this._renderSpriteDetail(panel, e, cat);
    });
    panel.querySelectorAll('.anim-del').forEach(btn => {
      btn.addEventListener('click', () => {
        delete anims[btn.dataset.anim];
        e.animations = anims;
        this._renderSpriteDetail(panel, e, cat);
      });
    });
    panel.querySelector('#l-stat-add')?.addEventListener('click', () => {
      const name = prompt('属性名（如 maxHp, attack, speed）:');
      if (name && !stats[name]) {
        stats[name] = 0;
        e.baseStats = stats;
        this._renderSpriteDetail(panel, e, cat);
      }
    });
    if (panel.querySelector('#l-loot')) {
      this._bindJsonValidation(panel.querySelector('#l-loot'));
    }
  }

  _bindJsonValidation(el) {
    if (!el) return;
    const check = () => {
      const v = el.value.trim();
      if (!v) { el.style.borderColor = '#2a3a5e'; el.title = ''; return true; }
      try { JSON.parse(v); el.style.borderColor = '#4a8a4a'; el.title = 'JSON 格式正确'; return true; }
      catch (err) { el.style.borderColor = '#e05252'; el.title = 'JSON 格式错误: ' + err.message; return false; }
    };
    el.addEventListener('input', check);
    check();
  }

  _validateDetailJson() {
    const el = this.container.querySelector('#l-props');
    if (el) {
      const value = el.value.trim();
      if (value) {
        try {
          const parsed = JSON.parse(value);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('专属属性必须是 JSON 对象');
        } catch (error) {
          el.style.borderColor = '#e05252';
          return true;
        }
      }
    }
    if (this.activeCategory !== 'items') return false;
    const panel = this.container.querySelector('#lib-detail');
    const id = String(panel?.querySelector('#l-id')?.value || '').trim();
    const current = this._current()[this.selectedIndex];
    const type = String(panel?.querySelector('#l-item-type')?.value || '').trim();
    const imageId = String(panel?.querySelector('#l-image-id')?.value || '').trim();
    if (!STABLE_ID_PATTERN.test(id) || id.startsWith('draft.items.') || this._current().some(item => item !== current && item?.id === id)) {
      this._status('❌ 物品 ID 必须为未重复的稳定 ID，不能保留草稿 ID', 'err');
      return true;
    }
    if (!type || !this._manifestImageOption(imageId)) {
      this._status('❌ 物品必须选择有效的类型和 Manifest 图片资源', 'err');
      return true;
    }
    return false;
  }

  _validateItemLibrary() {
    const ids = new Set();
    for (const item of this.library?.items || []) {
      const id = String(item?.id || '').trim();
      const imageId = String(item?.imageId || item?.assetId || '').trim();
      if (!STABLE_ID_PATTERN.test(id) || id.startsWith('draft.items.') || ids.has(id)) {
        this._status(`❌ 物品 ID 无效或重复：${id || '（空）'}`, 'err');
        return true;
      }
      if (!String(item?.name || '').trim() || !String(item?.type || '').trim() || !this._manifestImageOption(imageId)) {
        this._status(`❌ 物品缺少有效类型或 Manifest 图片资源：${id}`, 'err');
        return true;
      }
      ids.add(id);
    }
    return false;
  }

  _commitDetail() {
    const e = this._current()[this.selectedIndex];
    const panel = this.container.querySelector('#lib-detail');
    if (!e || !panel || !panel.querySelector('#l-id')) return;
    e.id = panel.querySelector('#l-id').value.trim() || e.id;
    e.name = panel.querySelector('#l-name').value.trim() || e.name;

    const cat = this.activeCategory;
    // 结构化面板（玩家/敌人/NPC）
    if (cat === 'players' || cat === 'enemies' || cat === 'npcs') {
      // sprite
      const srcEl = panel.querySelector('#l-sprite-src');
      if (srcEl) {
        e.sprite = {
          ...(e.sprite || {}),
          src: srcEl.value.trim(),
          frameWidth: parseInt(panel.querySelector('#l-sprite-fw')?.value) || 64,
          frameHeight: parseInt(panel.querySelector('#l-sprite-fh')?.value) || 64,
          cols: parseInt(panel.querySelector('#l-sprite-cols')?.value) || 4,
          rows: parseInt(panel.querySelector('#l-sprite-rows')?.value) || 4
        };
      }
      // animations
      const anims = {};
      panel.querySelectorAll('#l-anim-table tr').forEach(tr => {
        const nameInput = tr.querySelector('.anim-name');
        if (!nameInput) return;
        const name = nameInput.value.trim();
        const key = nameInput.dataset.animKey;
        const row = parseInt(tr.querySelector(`[data-anim="${key}"][data-field="row"]`)?.value) || 0;
        const frames = parseInt(tr.querySelector(`[data-anim="${key}"][data-field="frames"]`)?.value) || 4;
        const speed = parseFloat(tr.querySelector(`[data-anim="${key}"][data-field="speed"]`)?.value) || 0.1;
        if (name) anims[name] = { ...(e.animations?.[key] || {}), row, frames, speed };
      });
      e.animations = anims;
      // baseStats
      const stats = {};
      panel.querySelectorAll('[data-stat]').forEach(input => {
        stats[input.dataset.stat] = parseFloat(input.value) || 0;
      });
      e.baseStats = stats;
      // AI (enemies)
      if (cat === 'enemies') {
        e.ai = {
          ...(e.ai || {}),
          type: panel.querySelector('#l-ai-type')?.value || 'melee',
          aggroRange: Number(panel.querySelector('#l-ai-aggro')?.value),
          attackRange: Number(panel.querySelector('#l-ai-atkrange')?.value)
        };
        e.loot = this._parseJson(panel.querySelector('#l-loot')?.value, []);
      }
      // NPC fields
      if (cat === 'npcs') {
        e.title = panel.querySelector('#l-title')?.value.trim() || '';
        e.portrait = panel.querySelector('#l-portrait')?.value.trim() || '';
        e.renderStyle = panel.querySelector('#l-renderstyle')?.value.trim() || '';
        e.faction = panel.querySelector('#l-faction')?.value || 'friendly';
        e.dialogueId = panel.querySelector('#l-dialogue')?.value.trim() || '';
        e.shopId = panel.querySelector('#l-shop')?.value.trim() || '';
        e.questId = panel.querySelector('#l-quest')?.value.trim() || '';
        e.interaction = {
          ...(e.interaction || {}),
          radius: Number(panel.querySelector('#l-it-radius')?.value),
          trigger: panel.querySelector('#l-it-trigger')?.value || 'interact',
          prompt: panel.querySelector('#l-it-prompt')?.value.trim() || '按 E 对话'
        };
      }
      return;
    }

    if (cat === 'items') {
      const rest = this._parseJson(panel.querySelector('#l-props')?.value, {});
      for (const key of ITEM_MANAGED_FIELDS) delete rest[key];
      for (const key of Object.keys(e)) {
        if (!ITEM_MANAGED_FIELDS.includes(key)) delete e[key];
      }
      Object.assign(e, rest);
      e.type = panel.querySelector('#l-item-type')?.value.trim() || e.type;
      const imageId = panel.querySelector('#l-image-id')?.value.trim() || '';
      if (imageId) {
        e.imageId = imageId;
        e.assetId = imageId;
        this._queueImagePathUpdate(panel);
      }
      return;
    }

    // 通用 JSON 面板
    const rest = this._parseJson(panel.querySelector('#l-props').value, {});
    // 用专属字段覆盖（保留 id/name）
    for (const k of Object.keys(e)) {
      if (!COMMON_FIELDS.includes(k)) delete e[k];
    }
    Object.assign(e, rest);
  }

  _nextItemDraftId() {
    let id;
    do {
      this._itemDraftSequence += 1;
      id = `draft.items.${this._itemDraftSequence}`;
    } while (this._current().some(entry => entry?.id === id));
    return id;
  }

  _addEntry() {
    this._commitDetail();
    const cat = this._catDef();
    const tpl = JSON.parse(JSON.stringify(cat.tpl || {}));
    const id = this.activeCategory === 'items'
      ? this._nextItemDraftId()
      : this.activeCategory.replace(/s$/, '') + '_' + Date.now().toString(36);
    const entry = { id, name: tpl.name || id, ...tpl };
    this._current().push(entry);
    this.selectedIndex = this._current().length - 1;
    this._renderList();
    this._renderDetail();
  }

  _deleteEntry() {
    if (this.selectedIndex < 0) return;
    this._current().splice(this.selectedIndex, 1);
    this.selectedIndex = Math.min(this.selectedIndex, this._current().length - 1);
    this._renderList();
    this._renderDetail();
  }

  _json(v, indent) {
    if (v == null) return '';
    try { return JSON.stringify(v, null, indent || 0); } catch (e) { return ''; }
  }

  _parseJson(str, fallback) {
    if (!str || !str.trim()) return fallback;
    try { return JSON.parse(str); } catch (e) { this._status('JSON 解析错误: ' + e.message, 'err'); return fallback; }
  }
}

export default LibraryEditor;
