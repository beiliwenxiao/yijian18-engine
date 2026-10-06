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
import { replaceCanonicalFile } from './CanonicalTransactionClient.js';

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
// sections：多 section 合并分类——列表聚合展示，条目按所属 section 参与 UI 合并（数据不合并）。
const CATEGORIES = [
  // ==== 可放置内容（与场景编辑器「资源库·内容」分类一一对应）====
  {
    key: 'items', label: '物品与装备', sections: ['items', 'equipment'],
    addButtons: [
      { label: '+ 新增物品', section: 'items' },
      { label: '+ 新增装备', section: 'equipment' }
    ],
    tpl: { name: '新物品', type: 'material', imageId: '', maxStack: 99, effect: {} },
    tpls: {
      items: { name: '新物品', type: 'material', imageId: '', maxStack: 99, effect: {} },
      equipment: { name: '新装备', subType: 'mainhand', imageId: '', stats: { attack: 0, defense: 0, maxHp: 0 }, rarity: 1 }
    }
  },
  {
    key: 'npcs', label: 'NPC', sections: ['npcs', 'enemies'],
    addButtons: [
      { label: '+ 新增NPC', section: 'npcs', npcType: 'ally_npc' },
      { label: '+ 新增怪物', section: 'enemies', npcType: 'monster' },
      { label: '+ 新增敌人', section: 'enemies', npcType: 'enemy' }
    ],
    tpl: {
      name: '新NPC',
      npcType: 'ally_npc',
      imageId: '',
      title: '',
      portrait: '',
      faction: 'friendly',
      renderStyle: '',
      sprite: { width: 64, height: 64, isStatic: true },
      stats: { maxHp: 100 },
      dialogueId: '',
      shopId: '',
      questId: '',
      interaction: { radius: 60, prompt: '按 E 对话', trigger: 'interact' }
    },
    tpls: {
      npcs: {
        name: '新NPC', npcType: 'ally_npc', imageId: '',
        title: '', portrait: '', faction: 'friendly', renderStyle: '',
        sprite: { width: 64, height: 64, isStatic: true },
        stats: { maxHp: 100 },
        dialogueId: '', shopId: '', questId: '',
        interaction: { radius: 60, prompt: '按 E 对话', trigger: 'interact' }
      },
      enemies: {
        name: '新怪物', npcType: 'monster', imageId: '', level: 1,
        sprite: { width: 64, height: 64, isStatic: true },
        stats: { maxHp: 60, attack: 5, defense: 1, speed: 70 },
        aiType: 'aggressive', attackRange: 60, lootTable: [], ai: {}
      }
    }
  },
  { key: 'resourceNodes', label: '资源节点', tpl: {
    name: '新资源节点', schemaVersion: 1, resourceType: 'wood', itemId: '',
    imageId: '', sprite: { width: 48, height: 48, isStatic: true },
    remaining: 10, maxRemaining: 10, yieldPerGather: 2, gatherDuration: 1.5,
    interactionRadius: 72, requiredToolType: null, refreshDays: 0,
    guardUnitIds: [], damageRatio: 0
  }},
  { key: 'shops', label: '商店', tpl: { name: '新商店', goods: [] } },
  { key: 'vehicles', label: '载具', tpl: {
    name: '新载具', vehicleType: 'horse', imageId: '', width: 64, height: 64,
    speed: 200, hp: 100,
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

// 无图条目的列表占位小图标（有 Manifest 图片则显示真实缩略图）。
const LIST_THUMB_ICONS = Object.freeze({
  resourceNodes: '⛏️',
  vehicles: '🐎',
  combatSkills: '✨'
});

// 战斗技能（config/skills.json）新增条目模板：与运行时 SkillDefinition/SkillRegistry 字段对齐
const SKILL_TPL = {
  id: '', name: '新技能', description: '',
  category: 'attack', targeting: 'area',
  imageId: '',
  params: { damage: 20, range: 120, radius: 100, cooldown: 5 },
  costs: {}, tags: [], vfx: { effect: 'slash' }
};

/** NPC 类型体系：npcs/enemies 两个 section 的统一类型门面（数据不合并）。 */
const NPC_TYPES = Object.freeze({
  ally_npc: { label: '同阵营NPC', section: 'npcs' },
  enemy: { label: '敌人', section: 'enemies' },
  enemy_boss: { label: '敌人BOSS', section: 'enemies' },
  monster: { label: '怪物', section: 'enemies' },
  monster_boss: { label: '怪物BOSS', section: 'enemies' }
});

/** 装备槽位（与 EquipmentComponent.isValidEquipmentForSlot 的 subType 值域一致）。 */
const EQUIPMENT_SUBTYPES = Object.freeze([
  'mainhand', 'offhand', 'armor', 'helmet', 'boots',
  'accessory', 'necklace', 'ring', 'belt', 'instrument', 'mount'
]);

/**
 * 幂等推导条目 npcType：npcs → ally_npc；enemies 按 isBoss 与 imageId 路径段
 * （.enemy. 图（狼等野兽）→ 怪物；.character./.unit. 等人形 → 敌人；无图回退敌人）。
 */
function deriveNpcType(entry, section) {
  if (section === 'npcs') return 'ally_npc';
  const isBoss = entry?.isBoss === true || String(entry?.npcType || '').endsWith('_boss');
  const monsterLike = String(entry?.imageId || '').includes('.enemy.');
  if (isBoss) return monsterLike ? 'monster_boss' : 'enemy_boss';
  return monsterLike ? 'monster' : 'enemy';
}

function ensureNpcTypes(library) {
  for (const section of ['npcs', 'enemies']) {
    for (const entry of library?.[section] || []) {
      if (!entry || typeof entry !== 'object') continue;
      const known = Object.keys(NPC_TYPES).includes(entry.npcType);
      // boss 类型的推导以 isBoss 优先：条目已有 npcType 但 isBoss 与之矛盾时重新推导
      if (!known || (section === 'enemies' && ((entry.isBoss === true) !== entry.npcType.endsWith('_boss')))) {
        entry.npcType = deriveNpcType(entry, section);
      }
    }
  }
}

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
    // 多 section 合并分类的类型筛选（'' = 全部）；combatSkills 走 config/skills.json
    this._typeFilter = '';
    this._skills = null;
    this._skillsDirty = false;
    this._skillsError = null;
    this._skillsLoadPromise = null;
    this._skillDraftSequence = 0;
  }

  async init() {
    if (!this._initialized) {
      this._initialized = true;
      this._buildUI();
      this._injectStyles();
    }
    await this._load();
    await this._ensureSkillsLoaded();
    try {
      await this._ensureManifestImageOptions();
    } catch (error) {
      this._manifestError = error;
      console.warn('[LibraryEditor] Manifest 图片目录加载失败:', error);
    }
    this._renderCategories();
    this._renderToolbar();
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
    // npcType 幂等推导：npcs/enemies 条目补齐统一类型字段（随保存自然落盘）
    ensureNpcTypes(this.library);
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
    // 战斗技能：数据源是 config/skills.json，走整文件原子替换而非 library patch
    if (this.activeCategory === 'combatSkills') {
      const invalidSkill = this._validateSkills();
      if (invalidSkill) {
        this._toast(invalidSkill, 'error');
        return { ok: false, committed: false, status: 'rejected', code: 'invalidSkillDefinition' };
      }
      try {
        // 技能面板里改过 Manifest 图片路径映射时：先走图片事务提交 library+manifest，再写 skills.json
        if (this._pendingImageUpdates.size > 0) {
          const imageResult = await this.imageCommandService.save(this.canonicalSession.sourceUri || this.projectPath, {
            library: this.library,
            imageUpdates: [...this._pendingImageUpdates.values()]
          });
          if (imageResult?.ok !== true || imageResult?.committed !== true) {
            const firstError = imageResult?.errors?.[0];
            const message = [firstError?.path, firstError?.message || firstError?.reason]
              .filter(Boolean).join(': ') || imageResult?.error?.message || imageResult?.error || '图片事务失败';
            throw new Error(message);
          }
          this._acceptImageTransaction(imageResult);
        }
        await this._saveSkillsOnly();
        this._status('✅ 已保存到 ' + this._skillsFilePath(), 'ok');
        this._toast('战斗技能已保存（' + this._skills.length + ' 条）', 'success');
        return { ok: true, committed: true };
      } catch (error) {
        this._status('❌ 保存失败: ' + error.message, 'err');
        this._toast('保存失败: ' + error.message, 'error');
        return { ok: false, committed: false, status: 'failed', error };
      }
    }
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
  /**
   * 当前分类聚合条目（稳定顺序）。合并分类按 sections 顺序拼接，返回的是
   * library 内的真实对象引用（不注入任何标记字段）；selectedIndex 恒为
   * 本数组下标，显示层过滤走 _visibleEntries()。
   */
  _current() {
    if (this.activeCategory === 'combatSkills') return this._skills || [];
    const cat = this._catDef();
    const sections = cat?.sections || [this.activeCategory];
    if (sections.length <= 1) return this.library[this.activeCategory] || [];
    const merged = [];
    for (const section of sections) {
      for (const entry of this.library[section] || []) merged.push(entry);
    }
    return merged;
  }

  _catDef() { return CATEGORIES.find(c => c.key === this.activeCategory); }
  _catLabel() { return (this._catDef() || {}).label || this.activeCategory; }

  /** 条目所属 section（按引用反查；找不到回退主 section）。 */
  _sectionOf(entry) {
    const cat = this._catDef();
    for (const section of cat?.sections || [this.activeCategory]) {
      if ((this.library[section] || []).includes(entry)) return section;
    }
    return cat?.sections?.[0] || this.activeCategory;
  }

  /** 类型筛选后的可见条目（_renderList 用；selectedIndex 仍是 _current() 下标）。 */
  _visibleEntries() {
    const entries = this._current();
    if (!this._typeFilter) return entries;
    return entries.filter(entry => this._entryTypeValue(entry) === this._typeFilter);
  }

  /** 条目在类型筛选下拉里的取值（NPC 分类=npcType；物品与装备=type/section 区分）。 */
  _entryTypeValue(entry) {
    if (this.activeCategory === 'npcs') return entry?.npcType || deriveNpcType(entry, this._sectionOf(entry));
    if (this.activeCategory === 'items') {
      if (this._sectionOf(entry) === 'equipment') return 'equipment';
      return String(entry?.type || '').trim() || 'material';
    }
    return '';
  }

  _trueIndexOf(entry) {
    return this._current().indexOf(entry);
  }

  // ---- 战斗技能（config/skills.json）：独立文件读写，不进 library canonical 会话 ----
  _skillsFilePath() { return `example/${this.gameId}/config/skills.json`; }

  async _ensureSkillsLoaded() {
    if (Array.isArray(this._skills)) return this._skills;
    if (this._skillsLoadPromise) return this._skillsLoadPromise;
    const request = fetch(`/${this._skillsFilePath()}`)
      .then(async response => {
        if (!response.ok) throw new Error(`skills.json 请求失败: ${response.status}`);
        return response.json();
      })
      .then(data => {
        const skills = Array.isArray(data?.skills) ? data.skills : [];
        this._skills = skills;
        this._skillsError = null;
        return skills;
      })
      .catch(error => {
        this._skillsError = error;
        console.warn('[LibraryEditor] skills.json 加载失败:', error);
        this._skills = [];
        return this._skills;
      });
    this._skillsLoadPromise = request;
    try {
      return await request;
    } finally {
      if (this._skillsLoadPromise === request) this._skillsLoadPromise = null;
    }
  }

  async _saveSkillsOnly() {
    if (!Array.isArray(this._skills)) return { ok: false, committed: false, error: 'skills 未加载' };
    // 整文件原子替换（绕过 canonical 会话：skills.json 是 $ref 外部文件，patch 不覆盖它）
    const content = JSON.stringify({
      version: 1,
      description: '技能定义。params 为基线值，variants 为形态替换，均可被 skill.modify 效果调整。',
      skills: this._skills
    }, null, 2);
    JSON.parse(content); // 保存前自校验
    await replaceCanonicalFile(this._skillsFilePath(), content);
    this._skillsDirty = false;
    return { ok: true, committed: true };
  }

  // ---- UI 构建 ----
  _buildUI() {
    const catBtns = CATEGORIES.map(c =>
      `<button class="lib-cat" data-cat="${c.key}">${c.label}</button>`).join('');
    this.container.innerHTML = `
      <div class="lib-root">
        <div class="lib-cats">${catBtns}</div>
        <div class="lib-toolbar">
          <span id="lib-add-buttons"></span>
          <button id="lib-del">🗑 删除</button>
          <button id="lib-save" class="primary">💾 保存到工程</button>
          <select id="lib-type-filter" title="按类型筛选列表"><option value="">全部类型</option></select>
          <span class="lib-hint">数据 → ${this.projectPath} · library</span>
        </div>
        <div class="lib-main">
          <div class="lib-list" id="lib-list"></div>
          <div class="lib-detail" id="lib-detail"></div>
        </div>
        <div class="lib-status" id="lib-status"></div>
      </div>`;
    this.container.querySelector('#lib-del').addEventListener('click', () => this._deleteEntry());
    this.container.querySelector('#lib-save').addEventListener('click', async () => {
      await this.save();
    });
    this.container.querySelector('#lib-type-filter').addEventListener('change', event => {
      this._typeFilter = event.currentTarget.value || '';
      this._renderList();
    });
    this.container.querySelectorAll('.lib-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        this._commitDetail();
        this.activeCategory = btn.dataset.cat;
        this.selectedIndex = -1;
        this._typeFilter = '';
        this._renderCategories();
        this._renderToolbar();
        this._renderList();
        this._renderDetail();
      });
    });
    this._renderToolbar();
  }

  /** 工具栏动态区：按分类渲染新增按钮与类型筛选选项。 */
  _renderToolbar() {
    const cat = this._catDef();
    const addHost = this.container.querySelector('#lib-add-buttons');
    if (addHost) {
      const buttons = cat?.addButtons || [{ label: '+ 新增', section: cat?.sections?.[0] || cat?.key }];
      addHost.innerHTML = buttons.map((button, index) =>
        `<button data-add-section="${escapeHtml(button.section)}"${button.npcType ? ` data-add-npctype="${escapeHtml(button.npcType)}"` : ''} class="${index === 0 ? '' : 'secondary'}">${escapeHtml(button.label)}</button>`
      ).join('');
      addHost.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          this._addEntry(btn.dataset.addSection, btn.dataset.addNpctype || null);
        });
      });
    }
    const filter = this.container.querySelector('#lib-type-filter');
    if (filter) {
      const options = this._filterOptions();
      filter.innerHTML = `<option value="">全部类型</option>${options
        .map(option => `<option value="${escapeHtml(option.value)}" ${option.value === this._typeFilter ? 'selected' : ''}>${escapeHtml(option.label)}</option>`)
        .join('')}`;
      filter.style.display = options.length > 1 ? '' : 'none';
    }
  }

  /** 类型筛选选项：NPC 分类=五种 npcType；物品与装备=物品类型 + 装备；其余分类无筛选。 */
  _filterOptions() {
    if (this.activeCategory === 'npcs') {
      return Object.entries(NPC_TYPES).map(([value, def]) => ({ value, label: def.label }));
    }
    if (this.activeCategory === 'items') {
      const options = new Map([['equipment', { value: 'equipment', label: '装备' }]]);
      for (const type of this._itemTypeOptions()) {
        if (!options.has(type)) options.set(type, { value: type, label: itemTypeLabel(type) });
      }
      return [...options.values()];
    }
    return [];
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
      .lib-toolbar button.secondary{background:#2a3a5e;font-size:12px;}
      .lib-toolbar select{background:#0a1020;border:1px solid #2a3a5e;color:#fff;padding:6px;border-radius:4px;font-size:12px;}
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
    const entries = this._visibleEntries();
    if (entries.length === 0) {
      list.innerHTML = '<div class="lib-empty">' + (this._typeFilter ? '该类型下暂无条目' : '暂无' + this._catLabel() + '<br>点击「新增」') + '</div>';
      return;
    }
    list.innerHTML = '';
    for (const e of entries) {
      const trueIndex = this._trueIndexOf(e);
      const item = document.createElement('div');
      item.className = 'lib-item' + (trueIndex === this.selectedIndex ? ' active' : '');
      item.innerHTML = this._listItemHtml(e);
      item.addEventListener('click', () => {
        this._commitDetail();
        this.selectedIndex = trueIndex;
        this._renderList();
        this._renderDetail();
      });
      list.appendChild(item);
    }
  }

  /** 列表行 HTML：合并分类与有图分类显示缩略图 + 类型徽标；无图回退分类小图标。 */
  _listItemHtml(e) {
    const section = this._sectionOf(e);
    const thumbIcon = LIST_THUMB_ICONS[this.activeCategory] || '';
    const showsThumb = ['items', 'npcs', 'resourceNodes', 'vehicles', 'combatSkills'].includes(this.activeCategory)
      || ['items', 'equipment', 'npcs', 'enemies'].includes(section);
    const metaParts = [];
    if (this.activeCategory === 'npcs') {
      const npcType = e.npcType || deriveNpcType(e, section);
      metaParts.push('类型: ' + (NPC_TYPES[npcType]?.label || npcType));
      if (section === 'enemies' && e.faction === 'friendly') metaParts.push('友军');
    } else if (this.activeCategory === 'items') {
      if (section === 'equipment') metaParts.push('装备');
      if (e.type) metaParts.push(itemTypeLabel(e.type));
    }
    const metaHtml = metaParts.length ? `<div class="li-meta">${escapeHtml(metaParts.join(' · '))}</div>` : '';
    if (!showsThumb) {
      return `<div class="li-name">${escapeHtml(e.name || '(未命名)')}</div><div class="li-id">${escapeHtml(e.id || '')}</div>${metaHtml}`;
    }
    const imageId = String(e.imageId || e.assetId || '').trim();
    const image = this._manifestImageOption(imageId);
    const preview = image?.url
      ? `<img class="li-preview" src="${escapeHtml(image.url)}" alt="${escapeHtml(e.name || e.id || '图片')}">`
      : (thumbIcon
        ? `<div class="li-preview" style="display:flex;align-items:center;justify-content:center;font-size:18px;" title="未配置图片，显示分类图标">${thumbIcon}</div>`
        : `<div class="li-preview" style="display:flex;align-items:center;justify-content:center;color:#ff9a9a;font-size:10px;">缺图</div>`);
    return `<div class="li-item-row">${preview}<div style="min-width:0;flex:1;"><div class="li-name">${escapeHtml(e.name || '(未命名)')}</div><div class="li-id">${escapeHtml(e.id || '')}</div>${metaHtml}</div></div>`;
  }

  _renderDetail() {
    const panel = this.container.querySelector('#lib-detail');
    if (!panel) return;
    const e = this._current()[this.selectedIndex];
    if (!e) {
      panel.innerHTML = '<div class="lib-empty">选择或新增一个' + this._catLabel() + '定义</div>';
      return;
    }

    // 玩家保留序列帧表单；合并后的 NPC 分类走真实 schema 结构化面板
    const cat = this.activeCategory;
    if (cat === 'players') {
      this._renderSheetSpriteDetail(panel, e, cat);
      return;
    }
    if (cat === 'npcs') {
      this._renderNpcDetail(panel, e);
      return;
    }
    if (cat === 'items') {
      if (this._sectionOf(e) === 'equipment') this._renderEquipmentDetail(panel, e);
      else this._renderItemDetail(panel, e);
      return;
    }
    if (cat === 'combatSkills') {
      this._renderSkillDetail(panel, e);
      return;
    }
    if (cat === 'resourceNodes') {
      this._renderResourceNodeDetail(panel, e);
      return;
    }
    if (cat === 'vehicles') {
      this._renderVehicleDetail(panel, e);
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
        .map(option => `<option value="${escapeHtml(option.imageId)}" ${option.imageId === selectedImageId ? 'selected' : ''}>${option.mode === 'skeleton' ? '[骨骼] ' : ''}${escapeHtml(option.imageId)} · ${escapeHtml(option.path)}</option>`)
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

  /**
   * 图片引用编辑区 HTML（物品/NPC/资源节点/载具/技能详情共用）：
   * Manifest 稳定 ID 选择 + 路径映射修改 + 预览。DOM id 与 _updateItemImagePreview 对齐。
   */
  _imageSectionHtml(imageId) {
    const imageOptions = this._manifestImageOptions;
    const hasCurrentImage = imageOptions.some(option => option.imageId === imageId);
    const display = this._imageDisplay(imageId);
    return `
      <div class="row"><label>图片资源 ID</label><select id="l-image-id" ${imageOptions.length ? '' : 'disabled'}><option value="">选择 Manifest 图片资源</option>${!hasCurrentImage && imageId ? `<option value="${escapeHtml(imageId)}" selected>当前 ID 无效：${escapeHtml(imageId)}</option>` : ''}${imageOptions
        .map(option => `<option value="${escapeHtml(option.imageId)}" ${option.imageId === imageId ? 'selected' : ''}>${option.mode === 'skeleton' ? '[骨骼] ' : ''}${escapeHtml(option.imageId)} · ${escapeHtml(option.path)}</option>`)
        .join('')}</select></div>
      <div class="row"><label>图片路径（Manifest 映射）</label><input type="text" id="l-image-path" value="${escapeHtml(display.path)}" placeholder="assets/images/...png"><small style="display:block;margin-top:4px;color:#9ab;font-size:11px;line-height:1.45;">修改路径只改当前稳定 ID 的 Manifest 映射，保存时随工程一并提交。</small></div>
      <div class="row" style="display:flex;gap:10px;align-items:center;"><div style="width:72px;height:72px;border:1px solid #2a3a5e;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#080d1a;flex:none;"><img id="l-image-preview" alt="图片预览" src="${escapeHtml(display.url)}" style="display:${display.url ? 'block' : 'none'};width:100%;height:100%;object-fit:contain;"><span id="l-image-empty" style="display:${display.url ? 'none' : ''};padding:6px;text-align:center;color:#ff9a9a;font-size:11px;">${this._manifestError ? '图片目录加载失败' : '未选择图片'}</span></div><small id="l-image-status" style="color:#9ab;font-size:11px;line-height:1.45;">${escapeHtml(display.status)}</small></div>
      <div class="row"><label>图片尺寸</label><input type="text" id="l-image-dim" readonly value="读取中…" style="flex:1;color:#88ccff;"><button type="button" id="l-image-refresh" title="源图片文件被外部修改后，穿透缓存重新加载并显示最新尺寸">🔄 刷新图片</button></div>
    `;
  }

  /** 绑定图片引用编辑区事件并初始化预览。 */
  _bindImageSection(panel) {
    panel.querySelector('#l-image-id')?.addEventListener('change', () => {
      this._updateItemImagePreview(panel);
      this._loadLibraryImageDims(panel);
    });
    panel.querySelector('#l-image-path')?.addEventListener('change', () => this._queueImagePathUpdate(panel));
    panel.querySelector('#l-image-refresh')?.addEventListener('click', async () => {
      const button = panel.querySelector('#l-image-refresh');
      button.disabled = true;
      try {
        await this._loadLibraryImageDims(panel, true);
      } finally {
        button.disabled = false;
      }
    });
    this._updateItemImagePreview(panel);
    this._loadLibraryImageDims(panel);
  }

  /**
   * 读取图片资源的实际尺寸（图片尺寸可能随源文件修改而变化，Manifest bounds 未必最新）。
   * @param {HTMLElement} panel
   * @param {boolean} [bust] - true 时穿透 HTTP 缓存重载（刷新图片按钮用）
   */
  async _loadLibraryImageDims(panel, bust = false) {
    const imageId = String(panel.querySelector('#l-image-id')?.value || '').trim();
    const dimInput = panel.querySelector('#l-image-dim');
    if (!dimInput) return;
    if (!imageId) { dimInput.value = '未选择图片'; return; }
    const display = this._imageDisplay(imageId);
    if (!display.url) { dimInput.value = '无可加载图片'; return; }
    if (this._manifestImageOption(imageId)?.mode === 'skeleton') {
      dimInput.value = '骨骼资产（无图片尺寸）';
      return;
    }
    const url = bust
      ? `${display.url}${display.url.includes('?') ? '&' : '?'}imgRefresh=${Date.now()}`
      : display.url;
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = url;
      });
      dimInput.value = `${image.naturalWidth}×${image.naturalHeight}`;
      if (bust) {
        const preview = panel.querySelector('#l-image-preview');
        if (preview) {
          preview.src = url;
          preview.style.display = 'block';
          const empty = panel.querySelector('#l-image-empty');
          if (empty) empty.style.display = 'none';
        }
      }
    } catch {
      dimInput.value = '加载失败';
    }
  }

  _queueImagePathUpdate(panel) {
    const imageId = String(panel.querySelector('#l-image-id')?.value || '').trim();
    const runtimePath = String(panel.querySelector('#l-image-path')?.value || '').trim();
    const originalPath = this._manifestImageOption(imageId)?.path || '';
    if (!imageId) {
      this._status('❌ 请先选择图片资源 ID', 'err');
      return;
    }
    if (this._manifestImageOption(imageId)?.mode === 'skeleton') {
      this._status('❌ 骨骼资产请在「🦴 骨骼」编辑器中维护，不能替换图片文件', 'err');
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
    if (this._manifestImageOption(imageId)?.mode === 'skeleton') {
      this._status('❌ 骨骼资产请在「🦴 骨骼」编辑器中维护，不能替换图片文件', 'err');
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
   * 渲染 玩家 序列帧编辑面板（sprite.src sheet + animations + baseStats）。
   * 仅 players 分类使用——npcs/enemies 真实数据是 imageId + 静态 sprite，走 _renderNpcDetail。
   */
  _renderSheetSpriteDetail(panel, e, cat) {
    const sprite = e.sprite || {};
    const anims = e.animations || {};
    const baseStatsView = e.baseStats || {};

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
    for (const [k, v] of Object.entries(baseStatsView)) {
      statsHtml += `<div style="display:inline-block;margin:2px 6px 2px 0;"><label style="font-size:11px;color:#9ab;">${k}</label><input type="number" value="${v}" data-stat="${k}" style="width:50px;margin-left:4px;"></div>`;
    }

    // 玩家序列帧表单不再承担敌人/NPC 编辑（真实 schema 走 _renderNpcDetail）

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
    `;

    // 绑定事件
    panel.querySelector('#l-anim-add')?.addEventListener('click', () => {
      const name = 'anim_' + Object.keys(anims).length;
      anims[name] = { row: Object.keys(anims).length, frames: 4, speed: 0.1 };
      e.animations = anims;
      this._renderSheetSpriteDetail(panel, e, cat);
    });
    panel.querySelectorAll('.anim-del').forEach(btn => {
      btn.addEventListener('click', () => {
        delete anims[btn.dataset.anim];
        e.animations = anims;
        this._renderSheetSpriteDetail(panel, e, cat);
      });
    });
    panel.querySelector('#l-stat-add')?.addEventListener('click', () => {
      const name = prompt('属性名（如 maxHp, attack, speed）:');
      if (name && !baseStatsView[name]) {
        baseStatsView[name] = 0;
        e.baseStats = baseStatsView;
        this._renderSheetSpriteDetail(panel, e, cat);
      }
    });
  }

  // ==== 合并后的 NPC 结构化面板（真实 schema：imageId + sprite{w,h} + stats + lootTable + ai）====

  /**
   * 资源节点结构化面板：图片引用 + 贴图尺寸 + 专属 JSON。
   * 运行时契约（EntityFactory.createResourceNode）：顶层 imageId/assetId → sprite.imageId，
   * 显示尺寸读 sprite.width/height（回退 data.width/48）。
   */
  _renderResourceNodeDetail(panel, e) {
    const imageId = String(e.imageId || '').trim();
    const sprite = e.sprite || {};
    const rest = {};
    for (const key of Object.keys(e)) {
      if (!['id', 'name', 'imageId', 'sprite'].includes(key)) rest[key] = e[key];
    }
    panel.innerHTML = `
      <div class="row"><label>ID（库主键，场景对象用它引用）</label><input type="text" id="l-id" value="${escapeHtml(e.id || '')}"></div>
      <div class="row"><label>名称 name</label><input type="text" id="l-name" value="${escapeHtml(e.name || '')}"></div>
      <div class="row"><label style="font-weight:bold;">图片（Manifest 稳定 ID）</label></div>
      ${this._imageSectionHtml(imageId)}
      <div class="row" style="display:flex;gap:8px;">
        <div style="flex:1;"><label>贴图宽 sprite.width</label><input type="number" id="l-sprite-w" value="${escapeHtml(sprite.width ?? 48)}" min="1" style="width:100%;"></div>
        <div style="flex:1;"><label>贴图高 sprite.height</label><input type="number" id="l-sprite-h" value="${escapeHtml(sprite.height ?? 48)}" min="1" style="width:100%;"></div>
      </div>
      <div class="row"><label>专属属性（JSON）</label><textarea id="l-props">${escapeHtml(this._json(rest, 2))}</textarea></div>
    `;
    this._bindImageSection(panel);
    this._bindJsonValidation(panel.querySelector('#l-props'));
  }

  /**
   * 载具结构化面板：图片引用 + 显示宽高（顶层 width/height）+ 专属 JSON。
   * 运行时契约（EntityFactory.createVehicle）：图片读顶层 imageId/assetId，尺寸读顶层 width/height。
   */
  _renderVehicleDetail(panel, e) {
    const imageId = String(e.imageId || '').trim();
    const rest = {};
    for (const key of Object.keys(e)) {
      if (!['id', 'name', 'imageId', 'width', 'height'].includes(key)) rest[key] = e[key];
    }
    panel.innerHTML = `
      <div class="row"><label>ID（库主键，场景对象用它引用）</label><input type="text" id="l-id" value="${escapeHtml(e.id || '')}"></div>
      <div class="row"><label>名称 name</label><input type="text" id="l-name" value="${escapeHtml(e.name || '')}"></div>
      <div class="row"><label style="font-weight:bold;">图片（Manifest 稳定 ID）</label></div>
      ${this._imageSectionHtml(imageId)}
      <div class="row" style="display:flex;gap:8px;">
        <div style="flex:1;"><label>显示宽 width</label><input type="number" id="l-veh-w" value="${escapeHtml(e.width ?? 64)}" min="1" style="width:100%;"></div>
        <div style="flex:1;"><label>显示高 height</label><input type="number" id="l-veh-h" value="${escapeHtml(e.height ?? 64)}" min="1" style="width:100%;"></div>
      </div>
      <div class="row"><label>专属属性（JSON）</label><textarea id="l-props">${escapeHtml(this._json(rest, 2))}</textarea></div>
    `;
    this._bindImageSection(panel);
    this._bindJsonValidation(panel.querySelector('#l-props'));
  }

  /** 资源节点/载具通用提交：专属 JSON 合并 + 图片引用 + 尺寸字段（sizeMode 'sprite'=sprite{w,h}，'top'=顶层 width/height）。 */
  _commitPlacedEntryDetail(panel, e, sizeMode) {
    const rest = this._parseJson(panel.querySelector('#l-props')?.value, {});
    for (const k of Object.keys(e)) {
      if (!COMMON_FIELDS.includes(k)) delete e[k];
    }
    Object.assign(e, rest);
    const imageId = String(panel.querySelector('#l-image-id')?.value || '').trim();
    if (imageId) e.imageId = imageId; else delete e.imageId;
    if (sizeMode === 'sprite') {
      const sprite = { ...(e.sprite || {}) };
      const width = parseInt(panel.querySelector('#l-sprite-w')?.value, 10);
      const height = parseInt(panel.querySelector('#l-sprite-h')?.value, 10);
      if (width > 0) sprite.width = width; else delete sprite.width;
      if (height > 0) sprite.height = height; else delete sprite.height;
      if (Object.keys(sprite).length > 0) e.sprite = sprite; else delete e.sprite;
    } else {
      const width = parseInt(panel.querySelector('#l-veh-w')?.value, 10);
      const height = parseInt(panel.querySelector('#l-veh-h')?.value, 10);
      if (width > 0) e.width = width; else delete e.width;
      if (height > 0) e.height = height; else delete e.height;
    }
  }

  _renderNpcDetail(panel, e) {
    const section = this._sectionOf(e);
    const isEnemy = section === 'enemies';
    const npcType = e.npcType || deriveNpcType(e, section);
    const sprite = e.sprite || {};
    const stats = e.stats || {};
    const ai = e.ai || {};
    const imageId = String(e.imageId || '').trim();
    const imageOptions = this._manifestImageOptions;
    const hasCurrentImage = imageOptions.some(option => option.imageId === imageId);
    const display = this._imageDisplay(imageId);
    const itemOptions = (this.library.items || []);
    const skillOptions = this._skills || [];

    let statsHtml = '';
    for (const [k, v] of Object.entries(stats)) {
      statsHtml += `<div style="display:inline-block;margin:2px 6px 2px 0;"><label style="font-size:11px;color:#9ab;">${escapeHtml(k)}</label><input type="number" value="${escapeHtml(v)}" data-stat="${escapeHtml(k)}" style="width:56px;margin-left:4px;"></div>`;
    }

    const typeOptions = Object.entries(NPC_TYPES)
      .map(([value, def]) => `<option value="${value}" ${value === npcType ? 'selected' : ''}>${def.label}</option>`)
      .join('');

    let enemyHtml = '';
    if (isEnemy) {
      const aiType = e.aiType || 'aggressive';
      enemyHtml = `
        <hr style="border-color:#2a3a5e;margin:10px 0;">
        <div class="row"><label style="font-weight:bold;">战斗配置</label></div>
        <div class="row" style="display:flex;gap:8px;">
          <div style="flex:1;"><label>AI 类型</label><select id="l-ai-type">
            <option value="aggressive" ${aiType === 'aggressive' ? 'selected' : ''}>激进（主动追击）</option>
            <option value="defensive" ${aiType === 'defensive' ? 'selected' : ''}>防守</option>
            <option value="support" ${aiType === 'support' ? 'selected' : ''}>支援</option>
            <option value="battleFormation" ${aiType === 'battleFormation' ? 'selected' : ''}>军团编队</option>
          </select></div>
          <div style="flex:1;"><label>攻击范围 attackRange</label><input type="number" id="l-atk-range" value="${escapeHtml(e.attackRange ?? 60)}" min="0"></div>
          <div style="flex:1;"><label>等级 level</label><input type="number" id="l-level" value="${escapeHtml(e.level ?? 1)}" min="1"></div>
        </div>
        <div class="row"><label>参与 AI 调度 aiActive（勾选=激活战斗 AI）</label><input type="checkbox" id="l-ai-active" ${e.aiActive === true ? 'checked' : ''}></div>
        <div class="row"><label>掉落表 lootTable（运行时按此字段结算掉落）</label>${this._lootTableEditorHtml(e.lootTable || [])}</div>
      `;
    }

    let npcHtml = '';
    if (!isEnemy) {
      const it = e.interaction || {};
      npcHtml = `
        <hr style="border-color:#2a3a5e;margin:10px 0;">
        <div class="row"><label style="font-weight:bold;">NPC 配置</label></div>
        <div class="row"><label>称号（名字上方显示，可选）</label><input type="text" id="l-title" value="${escapeHtml(e.title || '')}" placeholder="如 太平道创始人"></div>
        <div class="row"><label>立绘 key（对话框显示，可选）</label><input type="text" id="l-portrait" value="${escapeHtml(e.portrait || '')}" placeholder="如 zhangjiao"></div>
        <div class="row"><label>内置立绘样式 renderStyle（无图片时用，可选）</label><input type="text" id="l-renderstyle" value="${escapeHtml(e.renderStyle || '')}" placeholder="如 zhangjiao / cook"></div>
        <div class="row"><label>阵营 faction</label><select id="l-faction">
          <option value="friendly" ${(e.faction || 'friendly') === 'friendly' ? 'selected' : ''}>友好 friendly</option>
          <option value="neutral" ${e.faction === 'neutral' ? 'selected' : ''}>中立 neutral</option>
          <option value="hostile" ${e.faction === 'hostile' ? 'selected' : ''}>敌对 hostile</option>
        </select></div>
        <div class="row"><label>对话ID</label><input type="text" id="l-dialogue" value="${escapeHtml(e.dialogueId || '')}" placeholder="dialogues 中的 id"></div>
        <div class="row"><label>商店ID</label><input type="text" id="l-shop" value="${escapeHtml(e.shopId || '')}" placeholder="留空表示无商店"></div>
        <div class="row"><label>任务ID</label><input type="text" id="l-quest" value="${escapeHtml(e.questId || '')}" placeholder="留空表示无任务"></div>
        <div class="row" style="display:flex;gap:8px;align-items:flex-end;">
          <div style="flex:1;"><label>交互半径</label><input type="number" id="l-it-radius" value="${escapeHtml(it.radius != null ? it.radius : 60)}" min="0" style="width:100%;"></div>
          <div style="flex:1;"><label>触发方式</label><select id="l-it-trigger" style="width:100%;">
            <option value="interact" ${(it.trigger || 'interact') === 'interact' ? 'selected' : ''}>按 E/点击</option>
            <option value="approach" ${it.trigger === 'approach' ? 'selected' : ''}>靠近自动</option>
          </select></div>
        </div>
        <div class="row"><label>交互提示文字</label><input type="text" id="l-it-prompt" value="${escapeHtml(it.prompt || '按 E 对话')}"></div>
      `;
    }

    panel.innerHTML = `
      <div class="row"><label>ID（库主键，场景对象用它引用）</label><input type="text" id="l-id" value="${escapeHtml(e.id || '')}"></div>
      <div class="row"><label>名称</label><input type="text" id="l-name" value="${escapeHtml(e.name || '')}"></div>
      <div class="row"><label>NPC 类型（切换会在 同阵营NPC/敌人/怪物 间迁移数据）</label><select id="l-npc-type">${typeOptions}</select></div>
      <hr style="border-color:#2a3a5e;margin:10px 0;">
      <div class="row"><label style="font-weight:bold;">图片（Manifest 稳定 ID）</label></div>
      <div class="row"><label>图片资源 ID</label><select id="l-image-id" ${imageOptions.length ? '' : 'disabled'}><option value="">选择 Manifest 图片资源</option>${!hasCurrentImage && imageId ? `<option value="${escapeHtml(imageId)}" selected>当前 ID 无效：${escapeHtml(imageId)}</option>` : ''}${imageOptions
        .map(option => `<option value="${escapeHtml(option.imageId)}" ${option.imageId === imageId ? 'selected' : ''}>${option.mode === 'skeleton' ? '[骨骼] ' : ''}${escapeHtml(option.imageId)} · ${escapeHtml(option.path)}</option>`)
        .join('')}</select></div>
      <div class="row"><label>图片路径（Manifest 映射）</label><input type="text" id="l-image-path" value="${escapeHtml(display.path)}" placeholder="assets/images/...png"></div>
      <div class="row" style="display:flex;gap:10px;align-items:flex-start;">
        <div style="width:72px;height:72px;border:1px solid #2a3a5e;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#080d1a;flex:none;"><img id="l-image-preview" alt="图片预览" src="${escapeHtml(display.url)}" style="display:${display.url ? 'block' : 'none'};width:100%;height:100%;object-fit:contain;"><span id="l-image-empty" style="display:${display.url ? 'none' : ''};padding:6px;text-align:center;color:#ff9a9a;font-size:11px;">未选择图片</span></div>
        <div style="display:flex;gap:8px;align-items:flex-end;">
          <div><label>贴图宽 sprite.width</label><input type="number" id="l-sprite-w" value="${escapeHtml(sprite.width || 64)}" min="1" style="width:70px;"></div>
          <div><label>贴图高 sprite.height</label><input type="number" id="l-sprite-h" value="${escapeHtml(sprite.height || 64)}" min="1" style="width:70px;"></div>
        </div>
      </div>
      <div class="row"><label>图片尺寸</label><input type="text" id="l-image-dim" readonly value="读取中…" style="flex:1;color:#88ccff;"><button type="button" id="l-image-refresh" title="源图片文件被外部修改后，穿透缓存重新加载并显示最新尺寸">🔄 刷新图片</button></div>
      <hr style="border-color:#2a3a5e;margin:10px 0;">
      <div class="row"><label style="font-weight:bold;">基础属性 stats</label> <button id="l-stat-add" style="padding:2px 8px;cursor:pointer;margin-left:8px;">+ 属性</button></div>
      <div id="l-stats-area">${statsHtml}</div>
      ${enemyHtml}
      ${npcHtml}
      <hr style="border-color:#2a3a5e;margin:10px 0;">
      <div class="row"><label style="font-weight:bold;">战斗技能与攻击编排</label><small style="color:#9ab;margin-left:8px;">技能数据来自 内容库→战斗技能（config/skills.json）</small></div>
      ${this._skillRefEditorHtml(ai.attackActions || [], skillOptions, itemOptions)}
      ${isEnemy ? `<div class="row"><label>AI 高级配置 JSON（telegraph 预警/击退等，attackActions 之外的字段）</label><textarea id="l-ai-json" style="min-height:90px;">${this._json((({ attackActions, ...rest }) => rest)(ai), 2)}</textarea></div>` : ''}
    `;

    // 绑定事件
    panel.querySelector('#l-image-id')?.addEventListener('change', () => {
      this._updateItemImagePreview(panel);
      this._loadLibraryImageDims(panel);
    });
    panel.querySelector('#l-image-path')?.addEventListener('change', () => this._queueImagePathUpdate(panel));
    panel.querySelector('#l-image-refresh')?.addEventListener('click', async () => {
      const button = panel.querySelector('#l-image-refresh');
      button.disabled = true;
      try {
        await this._loadLibraryImageDims(panel, true);
      } finally {
        button.disabled = false;
      }
    });
    this._loadLibraryImageDims(panel);
    panel.querySelector('#l-npc-type')?.addEventListener('change', event => {
      this._commitNpcDetail(panel, e);
      this._switchNpcType(e, event.currentTarget.value);
    });
    panel.querySelector('#l-stat-add')?.addEventListener('click', () => {
      const name = prompt('属性名（如 maxHp, attack, defense, speed）:');
      if (name && !stats[name]) {
        e.stats = { ...stats, [name]: 0 };
        this._renderNpcDetail(panel, e);
      }
    });
    this._bindSkillRefEditor(panel, e);
    if (isEnemy) {
      panel.querySelector('.loot-add')?.addEventListener('click', () => {
        e.lootTable = [...(e.lootTable || []), { chance: 1, itemId: '', minQuantity: 1, maxQuantity: 1 }];
        this._renderNpcDetail(panel, e);
      });
      panel.querySelectorAll('.loot-del').forEach(btn => {
        btn.addEventListener('click', () => {
          e.lootTable = (e.lootTable || []).filter((_, index) => index !== Number(btn.dataset.row));
          this._renderNpcDetail(panel, e);
        });
      });
      this._bindJsonValidation(panel.querySelector('#l-ai-json'));
    }
  }

  /** 切换 NPC 类型：按需在 npcs/enemies section 间迁移条目并补齐缺省字段。 */
  _switchNpcType(entry, newType) {
    const def = NPC_TYPES[newType];
    if (!entry || !def) return;
    const fromSection = this._sectionOf(entry);
    const toSection = def.section;
    entry.npcType = newType;
    if (toSection !== fromSection) {
      const fromArray = this.library[fromSection] || [];
      const index = fromArray.indexOf(entry);
      if (index >= 0) fromArray.splice(index, 1);
      if (!Array.isArray(this.library[toSection])) this.library[toSection] = [];
      this.library[toSection].push(entry);
      if (toSection === 'enemies') {
        entry.stats = { maxHp: 100, attack: 10, defense: 2, speed: 70, ...(entry.stats || {}) };
        entry.aiType ||= 'aggressive';
        entry.attackRange ??= 60;
        entry.level ??= 1;
        entry.lootTable ||= [];
        entry.ai ||= {};
        entry.isBoss = newType.endsWith('_boss');
      } else {
        entry.faction ||= 'friendly';
        entry.interaction ||= { radius: 60, prompt: '按 E 对话', trigger: 'interact' };
        entry.sprite = { ...(entry.sprite || {}), isStatic: true };
        delete entry.isBoss;
      }
      this._toast(`已迁移到 ${toSection} section`, 'success');
    } else if (toSection === 'enemies') {
      entry.isBoss = newType.endsWith('_boss');
    }
    // 迁移改变聚合顺序（npcs 在前 enemies 在后），selectedIndex 必须按引用重算
    this.selectedIndex = this._trueIndexOf(entry);
    this._renderList();
    this._renderDetail();
  }

  /** 掉落表行编辑 HTML：chance / itemId（取 library.items）/ min / max。 */
  _lootTableEditorHtml(lootTable) {
    const itemOptions = (this.library.items || [])
      .map(item => `<option value="${escapeHtml(item.id || '')}">${escapeHtml(item.id || '')}${item.name ? ' · ' + escapeHtml(item.name) : ''}</option>`)
      .join('');
    const rows = (lootTable || []).map((row, index) => `
      <tr data-row="${index}">
        <td><input type="number" class="loot-chance" value="${escapeHtml(row.chance ?? 1)}" min="0" max="1" step="0.05" style="width:60px;"></td>
        <td><select class="loot-item" style="max-width:180px;"><option value="">选择物品</option>${itemOptions.replace(`value="${escapeHtml(row.itemId || '')}"`, `value="${escapeHtml(row.itemId || '')}" selected`)}${row.itemId && !(this.library.items || []).some(item => item.id === row.itemId) ? `<option value="${escapeHtml(row.itemId)}" selected>当前无效：${escapeHtml(row.itemId)}</option>` : ''}</select></td>
        <td><input type="number" class="loot-min" value="${escapeHtml(row.minQuantity ?? 1)}" min="0" style="width:54px;"></td>
        <td><input type="number" class="loot-max" value="${escapeHtml(row.maxQuantity ?? 1)}" min="0" style="width:54px;"></td>
        <td><button class="loot-del" data-row="${index}" style="padding:2px 6px;cursor:pointer;">×</button></td>
      </tr>`).join('');
    return `
      <table style="width:100%;font-size:11px;border-collapse:collapse;">
        <thead><tr style="color:#9ab;"><th>概率</th><th>物品</th><th>最小</th><th>最大</th><th></th></tr></thead>
        <tbody class="loot-rows">${rows}</tbody>
      </table>
      <button class="loot-add" style="padding:2px 8px;cursor:pointer;margin-top:4px;">+ 添加掉落</button>
    `;
  }

  /**
   * 技能形状编辑区 HTML（NPC 编排卡与战斗技能详情共用；数据宿主由 _bindSkillShapeCanvas 绑定）。
   * @param {Object} params - 当前形状数据宿主（params/paramsOverride）
   */
  _skillShapeFieldsHtml(params = {}) {
    const radius = Number(params.radius);
    const radiusRaw = radius > 0 ? radius : '';
    const shapeType = ['circle', 'rect', 'polygon'].includes(params.shape) ? params.shape : 'circle';
    const shapeData = params.shapeData || {};
    return `
      <div><label>技能形状</label><select class="aa-shape-type" style="width:100%;">
        <option value="circle" ${shapeType === 'circle' ? 'selected' : ''}>圆形</option>
        <option value="rect" ${shapeType === 'rect' ? 'selected' : ''}>矩形</option>
        <option value="polygon" ${shapeType === 'polygon' ? 'selected' : ''}>多边形（五点）</option>
      </select></div>
      <div class="aa-circle-fields" style="display:${shapeType === 'circle' ? 'block' : 'none'};">
        <label>范围半径 radius</label><input type="number" class="aa-radius" value="${escapeHtml(radiusRaw)}" min="24" step="1" placeholder="库默认" style="width:80px;" title="留空=用技能定义 params.radius；拖动画布手柄或直接填数均可">
      </div>
      <div class="aa-rect-fields" style="display:${shapeType === 'rect' ? 'block' : 'none'};">
        <div><label>宽度 width</label><input type="number" class="aa-width" value="${escapeHtml(shapeData.width ?? '')}" min="16" step="1" placeholder="库默认" style="width:80px;"></div>
        <div style="margin-top:4px;"><label>高度 height</label><input type="number" class="aa-height" value="${escapeHtml(shapeData.height ?? '')}" min="16" step="1" placeholder="库默认" style="width:80px;"></div>
      </div>
      <small class="aa-shape-hint" style="color:#9ab;display:block;line-height:1.6;">${shapeType === 'polygon'
        ? '拖动五个顶点勾出任意多边形区域（相对落点中心）。'
        : (shapeType === 'rect'
          ? '拖动四个角手柄对称调整宽高。'
          : '拖动圆周手柄调整半径。')}清空数值 = 恢复技能定义默认。画布 1:1 实际像素，中央为怪物参照。</small>`;
  }

  /**
   * 战斗技能引用 + 攻击编排编辑（动作卡片：type/skillId/interval + 链式 afterSkillId/
   * delayAfterSkillSeconds + 技能形状 paramsOverride 小画布）。
   * 链式语义与运行时 EnemySkillDirector 一致：前置动作触发后按延迟计时，与自身间隔取先到。
   */
  _skillRefEditorHtml(attackActions, skillOptions) {
    const cards = (attackActions || []).map((action, index) => {
      const type = action.type === 'basic' ? 'basic' : 'skill';
      const skillId = action.skillId || '';
      const skillOptionsHtml = (skillOptions || [])
        .map(skill => `<option value="${escapeHtml(skill.id || '')}" ${skill.id === skillId ? 'selected' : ''}>${escapeHtml(skill.id || '')}${skill.name ? ' · ' + escapeHtml(skill.name) : ''}</option>`)
        .join('');
      const invalidOption = skillId && !(skillOptions || []).some(skill => skill.id === skillId)
        ? `<option value="${escapeHtml(skillId)}" selected>当前无效：${escapeHtml(skillId)}</option>` : '';
      // 链式前置动作候选：其他动作且带稳定 id（运行时按 id 匹配触发锚点）
      const chainOptions = (attackActions || [])
        .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(({ candidate, candidateIndex }) => candidateIndex !== index
          && candidate && typeof candidate.id === 'string' && candidate.id.trim());
      const chainOptionsHtml = chainOptions
        .map(({ candidate, candidateIndex }) => `<option value="${escapeHtml(candidate.id.trim())}" ${candidate.id.trim() === (action.afterSkillId || '') ? 'selected' : ''}>${escapeHtml(candidate.id)} · #${candidateIndex + 1} ${escapeHtml(candidate.skillId || (candidate.type === 'basic' ? '普攻' : '技能'))}</option>`)
        .join('');
      const invalidChain = action.afterSkillId
        && !chainOptions.some(({ candidate }) => candidate.id.trim() === action.afterSkillId)
        ? `<option value="${escapeHtml(action.afterSkillId)}" selected>当前无效：${escapeHtml(action.afterSkillId)}</option>` : '';
      return `
      <div class="aa-card" data-row="${index}" style="border:1px solid #2a3a5e;border-radius:4px;padding:6px;margin-bottom:6px;font-size:11px;">
        <div style="display:flex;gap:6px;align-items:center;">
          <select class="aa-type" title="动作类型"><option value="skill" ${type === 'skill' ? 'selected' : ''}>技能</option><option value="basic" ${type === 'basic' ? 'selected' : ''}>普攻</option></select>
          <select class="aa-skill" ${type === 'basic' ? 'disabled' : ''} style="flex:1;min-width:0;"><option value="">选择技能</option>${skillOptionsHtml}${invalidOption}</select>
        </div>
        <div style="display:flex;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap;">
          <label style="color:#9ab;flex:none;">间隔</label><input type="number" class="aa-interval" value="${escapeHtml(action.intervalSeconds ?? 5)}" min="0" step="0.5" style="width:50px;" title="间隔秒数（兼作接敌开场延迟；0=冷却就绪即放）">
          <label style="color:#9ab;flex:none;" title="链式：前置动作触发成功后，本动作按延迟计时（与自身间隔取先到）">前置于</label>
          <select class="aa-chain" style="flex:1;min-width:80px;" title="前置动作触发成功后，本动作按延迟计时（与自身间隔取先到）"><option value="">（无 · 按间隔）</option>${chainOptionsHtml}${invalidChain}</select>
          <label style="color:#9ab;flex:none;">延迟</label><input type="number" class="aa-delay" value="${escapeHtml(action.delayAfterSkillSeconds ?? 0)}" min="0" step="0.5" style="width:48px;" ${action.afterSkillId ? '' : 'disabled'} title="前置动作触发后 x 秒（与自身间隔取先到）；仅选择了前置动作时生效">
        </div>
        ${type === 'skill' ? `
        <div class="aa-skill-only" style="display:flex;gap:10px;margin-top:6px;align-items:flex-start;">
          <canvas class="aa-shape" width="300" height="300" style="flex:none;cursor:crosshair;border:1px solid #2a3a5e;border-radius:4px;background:#080d1a;" title="拖动手柄调整技能影响区域（1:1 实际像素，中央为怪物参照；运行时伤害与预警按此形状结算/渲染）"></canvas>
          <div style="min-width:0;flex:1;display:flex;flex-direction:column;gap:6px;">${this._skillShapeFieldsHtml(action.paramsOverride || {})}</div>
        </div>` : ''}
        <div style="text-align:right;margin-top:4px;"><button class="aa-del" data-row="${index}" style="padding:1px 8px;cursor:pointer;">× 删除</button></div>
      </div>`;
    }).join('');
    return `
      ${cards || '<div style="color:#9ab;font-size:11px;margin-bottom:6px;">尚未配置攻击编排。点击「+ 添加编排」新增动作；运行时按数组顺序每帧至多触发一个。</div>'}
      <button class="aa-add" style="padding:2px 8px;cursor:pointer;">+ 添加编排</button>
    `;
  }

  /** 把编排卡片/掉落行的 DOM 读回 entry（_commitNpcDetail 内调用）。 */
  _bindSkillRefEditor(panel, e) {
    panel.querySelector('.aa-add')?.addEventListener('click', () => {
      const ai = e.ai || (e.ai = {});
      // 生成不与现有动作冲突的稳定 id（运行时链式按 id 匹配）
      const existingIds = new Set((ai.attackActions || []).map(action => action?.id).filter(Boolean));
      let counter = (ai.attackActions?.length || 0) + 1;
      let newId = `action_${counter}`;
      while (existingIds.has(newId)) newId = `action_${++counter}`;
      ai.attackActions = [...(ai.attackActions || []), { id: newId, type: 'skill', skillId: '', intervalSeconds: 5 }];
      this._renderNpcDetail(panel, e);
    });
    panel.querySelectorAll('.aa-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const ai = e.ai || (e.ai = {});
        ai.attackActions = (ai.attackActions || []).filter((_, index) => index !== Number(btn.dataset.row));
        this._renderNpcDetail(panel, e);
      });
    });
    panel.querySelectorAll('.aa-card').forEach(card => {
      // 类型切换：普攻隐藏技能选择与范围编辑；清空链式时禁用延迟输入
      card.querySelector('.aa-type')?.addEventListener('change', event => {
        const isBasic = event.currentTarget.value === 'basic';
        const skillSelect = card.querySelector('.aa-skill');
        if (skillSelect) skillSelect.disabled = isBasic;
        const skillOnly = card.querySelector('.aa-skill-only');
        if (skillOnly) skillOnly.style.display = isBasic ? 'none' : 'flex';
        this._refreshChainOptionLabels(panel, e);
      });
      // 换技能后同步刷新其他卡片链式下拉里的动作标签（如「#1 技能」→「#1 cleave」）
      card.querySelector('.aa-skill')?.addEventListener('change', () => this._refreshChainOptionLabels(panel, e));
      card.querySelector('.aa-chain')?.addEventListener('change', event => {
        const delayInput = card.querySelector('.aa-delay');
        if (delayInput) delayInput.disabled = !event.currentTarget.value;
      });
      card.querySelectorAll('canvas.aa-shape').forEach(canvas => {
        this._bindSkillShapeCanvas(canvas, {
          host: card,
          getParams: () => {
            const action = (e.ai?.attackActions || [])[Number(card.dataset.row)];
            if (!action) return null;
            action.paramsOverride = action.paramsOverride && typeof action.paramsOverride === 'object'
              ? action.paramsOverride : {};
            return action.paramsOverride;
          },
          imageUrl: this._imageDisplay(String(e.imageId || '')).url
        });
      });
    });
  }

  /** 链式前置下拉的动作标签实时刷新（按当前 type/skillId 生成，不触碰「当前无效」占位项）。 */
  _refreshChainOptionLabels(panel, entry) {
    const actions = entry?.ai?.attackActions || [];
    panel.querySelectorAll('.aa-card').forEach(card => {
      const chainSelect = card.querySelector('.aa-chain');
      if (!chainSelect) return;
      chainSelect.querySelectorAll('option').forEach(option => {
        if (!option.value) return;
        const sourceIndex = actions.findIndex(action => action?.id === option.value);
        if (sourceIndex < 0) return;
        const source = actions[sourceIndex];
        option.textContent = `${source.id} · #${sourceIndex + 1} ${source.skillId || (source.type === 'basic' ? '普攻' : '技能')}`;
      });
    });
  }

  /**
   * 技能形状编辑画布（300×300，1:1 实际像素）：按「技能形状」下拉在 圆形/矩形/多边形 间切换，
   * 拖动手柄直接勾出技能影响区域（运行时 applyAOEDamage 与 telegraph 预警按同形状结算/渲染）。
   * options.getParams 返回形状数据宿主（编排卡=paramsOverride，技能详情=params），拖动/输入实时写回；
   * options.imageUrl 提供怪物参照图（半透明绘制在落点中心，直观感受覆盖范围）；
   * options.host 为形状数值字段（.aa-radius/.aa-width/.aa-height/.aa-shape-type）所在容器，
   * 编排卡传 .aa-card、技能详情传 panel；不传则不联动数值输入。
   * @private
   */
  _bindSkillShapeCanvas(canvas, { getParams, imageUrl = '', host = null } = {}) {
    const CANVAS_SIZE = 300;
    const CENTER = CANVAS_SIZE / 2;
    const MIN_RADIUS = 24;
    const MIN_SIDE = 16;
    const HANDLE_HIT = 10;
    this._shapeRefImageCache = this._shapeRefImageCache || new Map();
    // 只读视图：缺 shape 时按 circle 呈现但不写回（避免打开详情就污染技能 params）
    const viewOf = () => {
      const params = getParams?.();
      if (!params) return null;
      const shape = params.shape === 'rect' || params.shape === 'polygon' ? params.shape : 'circle';
      const shapeData = params.shapeData && typeof params.shapeData === 'object' ? params.shapeData : {};
      return { ...params, shape, shapeData };
    };
    // 编辑视图：用户实际编辑（拖动/切形状/输入）时才归一化写回宿主
    const ensureOf = () => {
      const params = getParams?.();
      if (!params) return null;
      if (params.shape !== 'rect' && params.shape !== 'polygon') {
        params.shape = 'circle';
        const radius = Number(params.shapeData?.radius ?? params.radius);
        params.shapeData = { radius: radius > 0 ? radius : 150 };
      }
      return params;
    };

    /** 形状切换/初始化：从当前外接半径派生新形状数据。 */
    const applyShape = shapeType => {
      const params = ensureOf();
      if (!params) return;
      const baseRadius = Math.max(MIN_RADIUS, Number(params.shapeData?.radius ?? params.radius) || 150);
      params.shape = shapeType;
      if (shapeType === 'circle') {
        params.shapeData = { radius: baseRadius };
        params.radius = baseRadius;
      } else if (shapeType === 'rect') {
        params.shapeData = { width: Math.round(baseRadius * 1.6), height: baseRadius };
        delete params.radius;
      } else {
        const points = [];
        for (let i = 0; i < 5; i++) {
          const angle = -Math.PI / 2 + i * (2 * Math.PI / 5);
          points.push([Math.round(baseRadius * Math.cos(angle)), Math.round(baseRadius * Math.sin(angle))]);
        }
        params.shapeData = { points };
        delete params.radius;
      }
    };

    const getRefImage = onReady => {
      if (!imageUrl) return null;
      const cached = this._shapeRefImageCache.get(imageUrl);
      if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
      const image = new Image();
      image.onload = () => onReady();
      image.src = imageUrl;
      this._shapeRefImageCache.set(imageUrl, image);
      return null;
    };

    const draw = () => {
      const params = viewOf();
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      if (!params) return;

      // 淡网格（50px 世界间隔，1:1 像素）
      ctx.strokeStyle = 'rgba(90,110,160,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let offset = 50; CENTER - offset >= 0; offset += 50) {
        ctx.moveTo(CENTER - offset, 0); ctx.lineTo(CENTER - offset, CANVAS_SIZE);
        ctx.moveTo(CENTER + offset, 0); ctx.lineTo(CENTER + offset, CANVAS_SIZE);
        ctx.moveTo(0, CENTER - offset); ctx.lineTo(CANVAS_SIZE, CENTER - offset);
        ctx.moveTo(0, CENTER + offset); ctx.lineTo(CANVAS_SIZE, CENTER + offset);
      }
      ctx.stroke();

      // 怪物参照图（半透明，脚底对齐落点下方 40px，直观感受覆盖范围）
      const refImage = getRefImage(draw);
      if (refImage) {
        const drawHeight = Math.min(120, refImage.naturalHeight || 96);
        const drawWidth = drawHeight * ((refImage.naturalWidth || 64) / (refImage.naturalHeight || 96));
        ctx.globalAlpha = 0.55;
        ctx.drawImage(refImage, CENTER - drawWidth / 2, CENTER + 40 - drawHeight, drawWidth, drawHeight);
        ctx.globalAlpha = 1;
      }

      // 中心十字（落点）
      ctx.strokeStyle = 'rgba(200,220,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(CENTER - 6, CENTER); ctx.lineTo(CENTER + 6, CENTER);
      ctx.moveTo(CENTER, CENTER - 6); ctx.lineTo(CENTER, CENTER + 6);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,120,220,0.10)';
      ctx.strokeStyle = '#ff78dc';
      ctx.lineWidth = 1.6;
      const handles = [];
      if (params.shape === 'rect') {
        const hw = (Number(params.shapeData?.width) || 0) / 2;
        const hh = (Number(params.shapeData?.height) || 0) / 2;
        ctx.beginPath();
        ctx.rect(CENTER - hw, CENTER - hh, hw * 2, hh * 2);
        ctx.fill(); ctx.stroke();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          handles.push({ px: CENTER + hw * sx, py: CENTER + hh * sy });
        }
      } else if (params.shape === 'polygon') {
        const points = params.shapeData?.points || [];
        ctx.beginPath();
        points.forEach(([px, py], index) => {
          if (index === 0) ctx.moveTo(CENTER + px, CENTER + py);
          else ctx.lineTo(CENTER + px, CENTER + py);
        });
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        points.forEach(point => {
          handles.push({ px: CENTER + point[0], py: CENTER + point[1] });
        });
      } else {
        const displayRadius = Number(params.shapeData?.radius) || Number(params.radius) || 150;
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.arc(CENTER, CENTER, displayRadius, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
        for (let i = 0; i < 5; i++) {
          const angle = -Math.PI / 2 + i * (2 * Math.PI / 5);
          handles.push({ px: CENTER + displayRadius * Math.cos(angle), py: CENTER + displayRadius * Math.sin(angle) });
        }
      }
      // 手柄
      ctx.fillStyle = '#ff78dc';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      for (const handle of handles) {
        ctx.fillRect(handle.px - 4, handle.py - 4, 8, 8);
        ctx.strokeRect(handle.px - 4, handle.py - 4, 8, 8);
      }
      // 标注（固定画布顶部）
      const label = params.shape === 'rect'
        ? `${params.shapeData?.width}×${params.shapeData?.height}`
        : (params.shape === 'polygon' ? `多边形 ${params.shapeData?.points?.length ?? 0} 点` : `半径 ${params.shapeData?.radius ?? params.radius ?? 150}`);
      ctx.fillStyle = '#ff78dc';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, CENTER, 16);
      ctx.textAlign = 'left';
    };

    // 手柄命中（画布像素 = 世界像素，1:1）
    const hitHandle = (mouseX, mouseY) => {
      const params = viewOf();
      if (!params) return -1;
      let handles = [];
      if (params.shape === 'rect') {
        const hw = (Number(params.shapeData?.width) || 0) / 2;
        const hh = (Number(params.shapeData?.height) || 0) / 2;
        handles = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({ px: CENTER + hw * sx, py: CENTER + hh * sy }));
      } else if (params.shape === 'polygon') {
        handles = (params.shapeData?.points || []).map(point => ({ px: CENTER + point[0], py: CENTER + point[1] }));
      } else {
        const displayRadius = Number(params.shapeData?.radius) || Number(params.radius) || 150;
        for (let i = 0; i < 5; i++) {
          const angle = -Math.PI / 2 + i * (2 * Math.PI / 5);
          handles.push({ px: CENTER + displayRadius * Math.cos(angle), py: CENTER + displayRadius * Math.sin(angle) });
        }
      }
      for (let index = 0; index < handles.length; index++) {
        if (Math.hypot(mouseX - handles[index].px, mouseY - handles[index].py) <= HANDLE_HIT) return index;
      }
      return -1;
    };

    canvas.addEventListener('mousedown', event => {
      event.preventDefault();
      const params = ensureOf();
      if (!params) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const handleIndex = hitHandle(mouseX, mouseY);
      const isCircle = params.shape === 'circle';
      if (!isCircle && handleIndex < 0) return; // 矩形/多边形需命中手柄

      const applyFromPointer = pointerEvent => {
        const px = pointerEvent.clientX - rect.left;
        const py = pointerEvent.clientY - rect.top;
        const dx = px - CENTER;
        const dy = py - CENTER;
        if (params.shape === 'rect') {
          if (handleIndex < 0) return;
          params.shapeData = {
            width: Math.max(MIN_SIDE, Math.round(Math.abs(dx) * 2)),
            height: Math.max(MIN_SIDE, Math.round(Math.abs(dy) * 2))
          };
          const widthInput = host?.querySelector('.aa-width');
          const heightInput = host?.querySelector('.aa-height');
          if (widthInput) widthInput.value = String(params.shapeData.width);
          if (heightInput) heightInput.value = String(params.shapeData.height);
        } else if (params.shape === 'polygon') {
          if (handleIndex < 0) return;
          const points = Array.isArray(params.shapeData?.points) ? params.shapeData.points : [];
          if (!points[handleIndex]) return;
          points[handleIndex] = [Math.round(dx), Math.round(dy)];
          params.shapeData = { points };
        } else {
          const radius = Math.max(MIN_RADIUS, Math.round(Math.hypot(dx, dy)));
          params.shapeData = { radius };
          params.radius = radius;
          const radiusInput = host?.querySelector('.aa-radius');
          if (radiusInput) radiusInput.value = String(radius);
        }
        draw();
      };
      applyFromPointer(event);
      const onMove = pointerEvent => applyFromPointer(pointerEvent);
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    // 形状切换：派生新形状数据 + 切换数值字段显隐 + 回填派生数值
    host?.querySelector('.aa-shape-type')?.addEventListener('change', event => {
      applyShape(event.currentTarget.value);
      const shapeType = event.currentTarget.value;
      host.querySelector('.aa-circle-fields').style.display = shapeType === 'circle' ? 'block' : 'none';
      host.querySelector('.aa-rect-fields').style.display = shapeType === 'rect' ? 'block' : 'none';
      const params = ensureOf();
      if (params) {
        if (shapeType === 'circle') {
          const radiusInput = host.querySelector('.aa-radius');
          if (radiusInput) radiusInput.value = String(params.shapeData?.radius ?? '');
        } else if (shapeType === 'rect') {
          const widthInput = host.querySelector('.aa-width');
          const heightInput = host.querySelector('.aa-height');
          if (widthInput) widthInput.value = String(params.shapeData?.width ?? '');
          if (heightInput) heightInput.value = String(params.shapeData?.height ?? '');
        }
      }
      draw();
    });

    // 数值输入实时写回（与拖动同通道）；circle 清空 = 删除形状覆盖恢复库默认
    host?.querySelector('.aa-radius')?.addEventListener('input', event => {
      const params = ensureOf();
      if (!params || params.shape !== 'circle') return;
      const raw = event.currentTarget.value;
      if (raw === '') {
        delete params.shapeData;
        delete params.shape;
        delete params.radius;
      } else {
        const radius = Math.max(MIN_RADIUS, Math.round(Number(raw) || 0));
        params.shapeData = { radius };
        params.radius = radius;
      }
      draw();
    });
    const bindRectInput = selector => {
      host?.querySelector(selector)?.addEventListener('input', () => {
        const params = ensureOf();
        if (!params || params.shape !== 'rect') return;
        const width = Math.max(MIN_SIDE, Math.round(Number(host.querySelector('.aa-width')?.value) || 0));
        const height = Math.max(MIN_SIDE, Math.round(Number(host.querySelector('.aa-height')?.value) || 0));
        params.shapeData = { width, height };
        draw();
      });
    };
    bindRectInput('.aa-width');
    bindRectInput('.aa-height');

    draw();
  }


  /** 装备结构化面板（subType 槽位 + stats + rarity + Manifest 图片）。 */
  _renderEquipmentDetail(panel, e) {
    const subType = String(e.subType || 'mainhand');
    const subtypeOptions = EQUIPMENT_SUBTYPES
      .map(type => `<option value="${type}" ${type === subType ? 'selected' : ''}>${type}</option>`)
      .join('');
    const stats = e.stats || {};
    const imageId = String(e.imageId || e.assetId || '').trim();
    const imageOptions = this._manifestImageOptions;
    const hasCurrentImage = imageOptions.some(option => option.imageId === imageId);
    const display = this._imageDisplay(imageId);
    const rest = {};
    for (const key of Object.keys(e)) {
      if (!['id', 'name', 'subType', 'imageId', 'assetId', 'stats', 'rarity'].includes(key)) rest[key] = e[key];
    }
    panel.innerHTML = `
      <div class="row"><label>ID（库主键）</label><input type="text" id="l-id" value="${escapeHtml(e.id || '')}"></div>
      <div class="row"><label>名称 name</label><input type="text" id="l-name" value="${escapeHtml(e.name || '')}"></div>
      <div class="row"><label>槽位 subType</label><select id="l-eq-subtype">${subtypeOptions}</select></div>
      <div class="row"><label>稀有度 rarity</label><input type="number" id="l-eq-rarity" value="${escapeHtml(e.rarity ?? 1)}" min="1" max="5"></div>
      <div class="row" style="display:flex;gap:8px;">
        ${['attack', 'defense', 'maxHp'].map(key => `<div><label>${key}</label><input type="number" id="l-eq-${key}" value="${escapeHtml(stats[key] ?? 0)}" style="width:70px;"></div>`).join('')}
      </div>
      <div class="row"><label>图片资源 ID（Manifest）</label><select id="l-image-id" ${imageOptions.length ? '' : 'disabled'}><option value="">选择 Manifest 图片资源</option>${!hasCurrentImage && imageId ? `<option value="${escapeHtml(imageId)}" selected>当前 ID 无效：${escapeHtml(imageId)}</option>` : ''}${imageOptions
        .map(option => `<option value="${escapeHtml(option.imageId)}" ${option.imageId === imageId ? 'selected' : ''}>${option.mode === 'skeleton' ? '[骨骼] ' : ''}${escapeHtml(option.imageId)} · ${escapeHtml(option.path)}</option>`)
        .join('')}</select></div>
      <div class="row" style="display:flex;gap:10px;align-items:center;"><div style="width:72px;height:72px;border:1px solid #2a3a5e;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#080d1a;flex:none;"><img id="l-image-preview" alt="装备图片预览" src="${escapeHtml(display.url)}" style="display:${display.url ? 'block' : 'none'};width:100%;height:100%;object-fit:contain;"><span id="l-image-empty" style="display:${display.url ? 'none' : ''};padding:6px;text-align:center;color:#ff9a9a;font-size:11px;">未选择图片</span></div><small id="l-image-status" style="color:#9ab;font-size:11px;">${escapeHtml(display.status)}</small></div>
      <div class="row"><label>专属属性（JSON）</label><textarea id="l-props">${escapeHtml(this._json(rest, 2))}</textarea></div>
    `;
    this._bindJsonValidation(panel.querySelector('#l-props'));
    panel.querySelector('#l-image-id')?.addEventListener('change', () => this._updateItemImagePreview(panel));
    this._updateItemImagePreview(panel);
  }

  /** 战斗技能结构化面板（读写 config/skills.json 内存副本）。 */
  _renderSkillDetail(panel, skill) {
    const params = skill.params || {};
    const costs = skill.costs || {};
    const categories = ['attack', 'heal', 'utility', 'locomotion'];
    const targetings = ['direction', 'position', 'area', 'entity', 'self'];
    const paramFields = ['damage', 'range', 'radius', 'cooldown', 'castTime', 'healAmount', 'projectileCount'];
    panel.innerHTML = `
      <div class="row"><label>技能 ID（NPC 编排与技能树引用它）</label><input type="text" id="l-id" value="${escapeHtml(skill.id || '')}"></div>
      <div class="row"><label>名称 name</label><input type="text" id="l-name" value="${escapeHtml(skill.name || '')}"></div>
      <div class="row"><label>描述 description</label><input type="text" id="l-skill-desc" value="${escapeHtml(skill.description || '')}"></div>
      <div class="row" style="display:flex;gap:8px;">
        <div style="flex:1;"><label>类别 category</label><select id="l-skill-category">${categories.map(c => `<option value="${c}" ${(skill.category || 'attack') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div style="flex:1;"><label>目标类型 targeting</label><select id="l-skill-targeting">${targetings.map(t => `<option value="${t}" ${(skill.targeting || 'area') === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>
      <div class="row"><label style="font-weight:bold;">参数 params（留空 = 不写该字段）</label></div>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;">
        ${paramFields.map(key => `<div><label>${key}</label><input type="number" id="l-param-${key}" value="${params[key] != null ? escapeHtml(params[key]) : ''}" step="any" style="width:80px;"></div>`).join('')}
      </div>
      <div class="row" style="display:flex;gap:8px;">
        <div style="flex:1;"><label>消耗 mp</label><input type="number" id="l-cost-mp" value="${costs.mp != null ? escapeHtml(costs.mp) : ''}" style="width:70px;"></div>
        <div style="flex:1;"><label>消耗 stamina</label><input type="number" id="l-cost-stamina" value="${costs.stamina != null ? escapeHtml(costs.stamina) : ''}" style="width:70px;"></div>
        <div style="flex:2;"><label>特效 vfx.effect</label><input type="text" id="l-skill-vfx" value="${escapeHtml(skill.vfx?.effect || '')}" placeholder="slash / flame_palm / whirlwind"></div>
      </div>
      <div class="row"><label>标签 tags（逗号分隔）</label><input type="text" id="l-skill-tags" value="${escapeHtml((skill.tags || []).join(', '))}"></div>
      <div class="row"><label style="font-weight:bold;">图片（Manifest 稳定 ID，列表缩略图/图标引用）</label></div>
      ${this._imageSectionHtml(String(skill.imageId || '').trim())}
      <div class="row"><label style="font-weight:bold;">技能形状（AOE 影响区域）</label><small style="color:#9ab;margin-left:8px;">拖动手柄调整；1:1 实际像素</small></div>
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <canvas class="aa-shape" width="300" height="300" style="flex:none;cursor:crosshair;border:1px solid #2a3a5e;border-radius:4px;background:#080d1a;" title="拖动手柄调整技能影响区域；运行时伤害与预警按此形状结算/渲染"></canvas>
        <div style="min-width:0;flex:1;display:flex;flex-direction:column;gap:6px;">${this._skillShapeFieldsHtml(params)}</div>
      </div>
      <div class="row"><label style="color:#9ab;">提示：variants（形态替换）与 progression 技能树不在本面板编辑范围，直接改 skills.json 或对应 config。</label></div>
    `;
    // 形状画布：宿主为技能 params（shape/shapeData/radius 直写 params，随保存落盘 skills.json）
    panel.querySelectorAll('canvas.aa-shape').forEach(canvas => {
      this._bindSkillShapeCanvas(canvas, {
        host: panel,
        getParams: () => {
          skill.params = skill.params && typeof skill.params === 'object' ? skill.params : {};
          return skill.params;
        }
      });
    });
    this._bindImageSection(panel);
  }

  _commitSkillDetail(panel, skill) {
    skill.id = panel.querySelector('#l-id')?.value.trim() || skill.id;
    skill.name = panel.querySelector('#l-name')?.value.trim() || skill.name;
    skill.description = panel.querySelector('#l-skill-desc')?.value.trim() || '';
    skill.category = panel.querySelector('#l-skill-category')?.value || 'attack';
    skill.targeting = panel.querySelector('#l-skill-targeting')?.value || 'area';
    const params = { ...(skill.params || {}) };
    for (const key of ['damage', 'range', 'radius', 'cooldown', 'castTime', 'healAmount', 'projectileCount']) {
      const raw = panel.querySelector(`#l-param-${key}`)?.value ?? '';
      if (raw === '') delete params[key];
      else params[key] = Number(raw);
    }
    skill.params = params;
    const costs = { ...(skill.costs || {}) };
    const mp = panel.querySelector('#l-cost-mp')?.value ?? '';
    const stamina = panel.querySelector('#l-cost-stamina')?.value ?? '';
    if (mp === '') delete costs.mp; else costs.mp = Number(mp);
    if (stamina === '') delete costs.stamina; else costs.stamina = Number(stamina);
    skill.costs = costs;
    const vfx = panel.querySelector('#l-skill-vfx')?.value.trim() || '';
    if (vfx) skill.vfx = { ...(skill.vfx || {}), effect: vfx };
    else delete skill.vfx;
    skill.tags = (panel.querySelector('#l-skill-tags')?.value || '')
      .split(',').map(tag => tag.trim()).filter(Boolean);
    const skillImageId = String(panel.querySelector('#l-image-id')?.value || '').trim();
    if (skillImageId) skill.imageId = skillImageId; else delete skill.imageId;
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
    const imageId = String(panel?.querySelector('#l-image-id')?.value || '').trim();
    if (!STABLE_ID_PATTERN.test(id) || id.startsWith('draft.items.') || this._current().some(item => item !== current && item?.id === id)) {
      this._status('❌ 条目 ID 必须为未重复的稳定 ID，不能保留草稿 ID', 'err');
      return true;
    }
    // 装备条目没有 #l-item-type；物品才校验类型字段
    if (this._sectionOf(current) !== 'equipment') {
      const type = String(panel?.querySelector('#l-item-type')?.value || '').trim();
      if (!type || !this._manifestImageOption(imageId)) {
        this._status('❌ 物品必须选择有效的类型和 Manifest 图片资源', 'err');
        return true;
      }
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

  /** 战斗技能保存前校验：ID 稳定唯一、名称非空、skill 型编排引用的技能存在。 */
  _validateSkills() {
    const ids = new Set();
    for (const skill of this._skills || []) {
      const id = String(skill?.id || '').trim();
      if (!STABLE_ID_PATTERN.test(id) || ids.has(id)) {
        this._status(`❌ 技能 ID 无效或重复：${id || '（空）'}`, 'err');
        return `技能 ID 无效或重复：${id || '（空）'}`;
      }
      if (!String(skill?.name || '').trim()) {
        this._status(`❌ 技能缺少名称：${id}`, 'err');
        return `技能缺少名称：${id}`;
      }
      ids.add(id);
    }
    return null;
  }

  _commitDetail() {
    const e = this._current()[this.selectedIndex];
    const panel = this.container.querySelector('#lib-detail');
    if (!e || !panel || !panel.querySelector('#l-id')) return;
    e.id = panel.querySelector('#l-id').value.trim() || e.id;
    e.name = panel.querySelector('#l-name').value.trim() || e.name;

    const cat = this.activeCategory;
    // 玩家：保留序列帧面板提交
    if (cat === 'players') {
      this._commitSheetSpriteDetail(panel, e);
      return;
    }
    // 合并 NPC 分类：真实 schema 提交
    if (cat === 'npcs') {
      this._commitNpcDetail(panel, e);
      return;
    }
    if (cat === 'combatSkills') {
      this._commitSkillDetail(panel, e);
      this._skillsDirty = true;
      return;
    }

    if (cat === 'items') {
      if (this._sectionOf(e) === 'equipment') {
        this._commitEquipmentDetail(panel, e);
        return;
      }
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

    if (cat === 'resourceNodes') {
      this._commitPlacedEntryDetail(panel, e, 'sprite');
      return;
    }
    if (cat === 'vehicles') {
      this._commitPlacedEntryDetail(panel, e, 'top');
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

  _commitSheetSpriteDetail(panel, e) {
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
    const baseStatsView = {};
    panel.querySelectorAll('[data-stat]').forEach(input => {
      baseStatsView[input.dataset.stat] = parseFloat(input.value) || 0;
    });
    e.baseStats = baseStatsView;
  }

  /**
   * NPC/敌人合并面板提交：真实 schema（imageId/sprite{w,h}/stats/aiType/attackRange/
   * lootTable/npcType），并清理旧表单写入的遗留字段（loot/baseStats/ai.type 等模板形态）。
   */
  _commitNpcDetail(panel, e) {
    const section = this._sectionOf(e);
    const isEnemy = section === 'enemies';
    e.npcType = panel.querySelector('#l-npc-type')?.value || e.npcType;
    const imageId = panel.querySelector('#l-image-id')?.value.trim() || '';
    if (imageId) {
      e.imageId = imageId;
      this._queueImagePathUpdate(panel);
    }
    const spriteW = parseInt(panel.querySelector('#l-sprite-w')?.value) || e.sprite?.width || 64;
    const spriteH = parseInt(panel.querySelector('#l-sprite-h')?.value) || e.sprite?.height || 64;
    e.sprite = { ...(e.sprite || {}), width: spriteW, height: spriteH, isStatic: e.sprite?.isStatic !== false };

    const statsView = {};
    panel.querySelectorAll('[data-stat]').forEach(input => {
      statsView[input.dataset.stat] = Number(input.value) || 0;
    });
    if (Object.keys(statsView).length > 0) e.stats = statsView;

    if (isEnemy) {
      e.aiType = panel.querySelector('#l-ai-type')?.value || e.aiType || 'aggressive';
      const attackRange = Number(panel.querySelector('#l-atk-range')?.value);
      if (Number.isFinite(attackRange)) e.attackRange = attackRange;
      const level = Number(panel.querySelector('#l-level')?.value);
      if (Number.isFinite(level)) e.level = level;
      e.aiActive = panel.querySelector('#l-ai-active')?.checked === true;
      // 掉落表：运行时消费 lootTable（修复旧表单写 e.loot 的字段错位）
      e.lootTable = Array.from(panel.querySelectorAll('.loot-rows tr')).map(tr => {
        const original = (e.lootTable || [])[Number(tr.dataset.row)] || {};
        const itemId = tr.querySelector('.loot-item')?.value.trim() || original.itemId || '';
        return {
          ...(original.id ? { id: original.id } : {}),
          chance: Number(tr.querySelector('.loot-chance')?.value) || 0,
          itemId,
          minQuantity: Math.max(0, Math.floor(Number(tr.querySelector('.loot-min')?.value) || 0)),
          maxQuantity: Math.max(0, Math.floor(Number(tr.querySelector('.loot-max')?.value) || 0))
        };
      }).filter(row => row.itemId);
      // 攻击编排：存 ai.attackActions（与 telegraph 同级，aiProfile 直通运行时）
      const restAi = this._parseJson(panel.querySelector('#l-ai-json')?.value, null);
      const preservedAi = restAi && typeof restAi === 'object' && !Array.isArray(restAi)
        ? restAi
        : { ...(e.ai || {}) };
      delete preservedAi.attackActions;
      const attackActions = Array.from(panel.querySelectorAll('.aa-card')).map((card, index) => {
        const original = (e.ai?.attackActions || [])[index] || {};
        const type = card.querySelector('.aa-type')?.value || 'skill';
        const action = {
          id: original.id || `action_${index + 1}`,
          type,
          ...(type === 'skill' ? { skillId: card.querySelector('.aa-skill')?.value.trim() || original.skillId || '' } : {}),
          intervalSeconds: Math.max(0, Number(card.querySelector('.aa-interval')?.value) || 0)
        };
        // 链式：选择了前置动作才写 afterSkillId/delayAfterSkillSeconds（与运行时语义一致）
        const chainAfter = card.querySelector('.aa-chain')?.value.trim() || '';
        if (chainAfter) {
          action.afterSkillId = chainAfter;
          action.delayAfterSkillSeconds = Math.max(0, Number(card.querySelector('.aa-delay')?.value) || 0);
        }
        // paramsOverride：形状编辑（画布拖动/数值输入）实时写 action 对象，提交时原样保留。
        // 空覆盖不写字段；普攻与技能同规则（拖动通道已含清空语义）。
        const originalOverride = original.paramsOverride && typeof original.paramsOverride === 'object'
          ? original.paramsOverride : null;
        if (originalOverride && Object.keys(originalOverride).length > 0) {
          action.paramsOverride = JSON.parse(JSON.stringify(originalOverride));
        }
        return action;
      });
      e.ai = { ...preservedAi, ...(attackActions.length > 0 ? { attackActions } : {}) };
    } else {
      e.title = panel.querySelector('#l-title')?.value.trim() || '';
      e.portrait = panel.querySelector('#l-portrait')?.value.trim() || '';
      e.renderStyle = panel.querySelector('#l-renderstyle')?.value.trim() || '';
      e.faction = panel.querySelector('#l-faction')?.value || e.faction || 'friendly';
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

    // 遗留字段清理：旧表单把模板形态字段写进真实数据，提交时统一删除
    delete e.loot;
    delete e.baseStats;
  }

  _commitEquipmentDetail(panel, e) {
    e.subType = panel.querySelector('#l-eq-subtype')?.value || e.subType || 'mainhand';
    const rarity = Number(panel.querySelector('#l-eq-rarity')?.value);
    if (Number.isFinite(rarity)) e.rarity = rarity;
    e.stats = {
      ...(e.stats || {}),
      attack: Number(panel.querySelector('#l-eq-attack')?.value) || 0,
      defense: Number(panel.querySelector('#l-eq-defense')?.value) || 0,
      maxHp: Number(panel.querySelector('#l-eq-maxHp')?.value) || 0
    };
    const imageId = panel.querySelector('#l-image-id')?.value.trim() || '';
    if (imageId) {
      e.imageId = imageId;
      e.assetId = imageId;
    }
    const rest = this._parseJson(panel.querySelector('#l-props')?.value, {});
    const managed = ['id', 'name', 'subType', 'imageId', 'assetId', 'stats', 'rarity'];
    for (const key of managed) delete rest[key];
    for (const key of Object.keys(e)) {
      if (!managed.includes(key)) delete e[key];
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

  _addEntry(section = null, npcType = null) {
    this._commitDetail();
    const cat = this._catDef();
    const targetSection = section || cat?.sections?.[0] || this.activeCategory;
    // combatSkills：数据源是 config/skills.json 而非 library
    if (this.activeCategory === 'combatSkills') {
      let id;
      do {
        this._skillDraftSequence += 1;
        id = `skill_${Date.now().toString(36)}_${this._skillDraftSequence}`;
      } while ((this._skills || []).some(entry => entry?.id === id));
      const entry = { ...JSON.parse(JSON.stringify(SKILL_TPL)), id };
      (this._skills ||= []).push(entry);
      this.selectedIndex = this._skills.length - 1;
      this._renderList();
      this._renderDetail();
      return;
    }
    const tplSource = cat?.tpls?.[targetSection] || cat?.tpl || {};
    const tpl = JSON.parse(JSON.stringify(tplSource));
    const id = targetSection === 'items'
      ? this._nextItemDraftId()
      : targetSection.replace(/s$/, '') + '_' + Date.now().toString(36);
    const entry = { id, name: tpl.name || id, ...tpl };
    if (npcType && NPC_TYPES[npcType]) entry.npcType = npcType;
    if (!Array.isArray(this.library[targetSection])) this.library[targetSection] = [];
    this.library[targetSection].push(entry);
    // 合并分类聚合顺序按 section，新增到非主 section 时末尾下标不等于新条目位置
    this.selectedIndex = this._trueIndexOf(entry);
    this._renderList();
    this._renderDetail();
  }

  _deleteEntry() {
    if (this.selectedIndex < 0) return;
    const current = this._current();
    const entry = current[this.selectedIndex];
    if (this.activeCategory === 'combatSkills') {
      this._skills.splice(this.selectedIndex, 1);
      this._skillsDirty = true;
    } else if (entry) {
      const section = this._sectionOf(entry);
      const array = this.library[section] || [];
      const index = array.indexOf(entry);
      if (index >= 0) array.splice(index, 1);
    }
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
