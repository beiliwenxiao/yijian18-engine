/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * @project YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 ************************************************************/

import { SnapshotManager } from './SnapshotManager.js';
import { LocalStorageAdapter } from './LocalStorageAdapter.js';
import { IndexedDBAdapter } from './IndexedDBAdapter.js';

/** 默认显示的手动存档位数，满后仍可继续新建。 */
export const DEFAULT_VISIBLE_SLOTS = 9;
/** 最大手动存档位数，自动存档位不计入该上限。 */
export const MAX_MANUAL_SAVE_SLOTS = 100;
/** 自动存档固定保留最近三份。 */
export const AUTO_SAVE_SLOT_COUNT = 3;

/**
 * 多栏位存档服务：三个轮换自动存档位 + 最多 100 个手动存档位。
 * 业务层只提供 capture / validate / restore；原子校验和回滚继续由
 * SnapshotManager 与存储适配器负责。
 * 
 * 支持两种存储后端：
 * - IndexedDB（推荐）：配额大，适合大型存档
 * - localStorage（兼容）：配额小，适合小型存档或降级场景
 */
export class SaveGameService {
  constructor({
    gameId = 'game',
    slotCount = MAX_MANUAL_SAVE_SLOTS,
    autoSlotCount = AUTO_SAVE_SLOT_COUNT,
    autoSlotPrefix = null,
    autoSlotId = 'autosave',
    migrateLegacyAutoSlot = true,
    storage = null,
    useIndexedDB = true,
    now = null
  } = {}) {
    this.gameId = gameId;
    this.slotCount = Math.min(MAX_MANUAL_SAVE_SLOTS, Math.max(1, slotCount | 0));
    this.autoSlotCount = Math.min(AUTO_SAVE_SLOT_COUNT, Math.max(1, autoSlotCount | 0));
    this.autoSlotPrefix = autoSlotPrefix || autoSlotId || 'autosave';
    
    // 选择存储后端
    if (storage) {
      this.storage = storage;
    } else if (useIndexedDB && typeof indexedDB !== 'undefined') {
      this.storage = new IndexedDBAdapter({ prefix: `yijian18:${gameId}:save` });
      this._isIndexedDB = true;
    } else {
      this.storage = new LocalStorageAdapter({ prefix: `yijian18:${gameId}:save` });
      this._isIndexedDB = false;
    }
    
    this.manager = new SnapshotManager({ storage: this.storage, now: now || (() => Date.now()) });
    this._providerOff = null;
    this._autoSaveExecutor = null;
    this._checkpointLoadExecutor = null;
    
    // IndexedDB 需要异步初始化
    if (this._isIndexedDB && this.storage.init) {
      this._initPromise = this.storage.init();
    }
    
    if (migrateLegacyAutoSlot) this._migrateLegacyAutoSlot();
  }

  /** 等待存储后端初始化完成 */
  async ready() {
    if (this._initPromise) await this._initPromise;
  }

  /** 是否使用 IndexedDB */
  isUsingIndexedDB() {
    return this._isIndexedDB === true;
  }

  setAutoSaveExecutor(executor) {
    this._autoSaveExecutor = typeof executor === 'function' ? executor : null;
  }

  requestAutoSave(meta = {}) {
    return this._autoSaveExecutor
      ? Promise.resolve(this._autoSaveExecutor(meta))
      : Promise.resolve(this.saveAuto(meta));
  }

  setCheckpointLoadExecutor(executor) {
    this._checkpointLoadExecutor = typeof executor === 'function' ? executor : null;
  }

  loadCheckpoint(checkpointId) {
    if (!this._checkpointLoadExecutor) return Promise.resolve({ ok: false, code: 'checkpointLoadUnavailable' });
    return Promise.resolve(this._checkpointLoadExecutor({ checkpointId }));
  }

  /** 切换当前运行时状态提供者；同一时刻只允许一个游戏状态参与者。 */
  setStateProvider(provider) {
    this._providerOff?.();
    this._providerOff = null;
    if (!provider) return;
    this._providerOff = this.manager.register('game', {
      required: true,
      snapshot: () => provider.capture(),
      validate: data => provider.validate ? provider.validate(data) : this._validateGameState(data),
      restore: data => provider.restore(data)
    });
  }

  _validateGameState(data) {
    const errors = [];
    if (!data || typeof data !== 'object') {
      errors.push({ code: 'missingField', path: '', message: '游戏状态为空' });
    } else if (!data.player || typeof data.player !== 'object') {
      errors.push({ code: 'missingField', path: 'player', message: '缺少玩家状态' });
    }
    return { ok: errors.length === 0, errors };
  }

  /** 手动槽位的存储标识。 */
  slotId(index) {
    const value = Number(index);
    if (!Number.isInteger(value) || value < 1 || value > this.slotCount) {
      throw new RangeError(`无效手动存档槽: ${index}`);
    }
    return `slot-${value}`;
  }

  /** 自动槽位的存储标识。 */
  autoSlotId(index) {
    const value = Number(index);
    if (!Number.isInteger(value) || value < 1 || value > this.autoSlotCount) {
      throw new RangeError(`无效自动存档槽: ${index}`);
    }
    return `${this.autoSlotPrefix}-${value}`;
  }

  /** 列出三个自动栏位，按栏位编号稳定排序。 */
  getAutoSlots() {
    const slots = [];
    for (let index = 1; index <= this.autoSlotCount; index++) {
      const id = this.autoSlotId(index);
      slots.push({ type: 'auto', index, id, exists: this.storage.has(id), info: this.storage.getInfo(id) });
    }
    return slots;
  }

  /** 兼容单自动槽查询；默认返回自动栏位 1。 */
  getAutoSlot(index = 1) {
    return this.getAutoSlots()[Number(index) - 1] || null;
  }

  /** 获取最新的自动存档摘要；无存档时返回 null。 */
  getLatestAutoSlot() {
    return this.getAutoSlots()
      .filter(slot => slot.exists)
      .sort((a, b) => (Number(b.info?.createdAt) || 0) - (Number(a.info?.createdAt) || 0))[0] || null;
  }

  /** 自动存档先填空位，全部占用后覆盖创建时间最早的一位。 */
  getNextAutoSlot() {
    const slots = this.getAutoSlots();
    return slots.find(slot => !slot.exists)
      || slots.slice().sort((a, b) => {
        const delta = (Number(a.info?.createdAt) || 0) - (Number(b.info?.createdAt) || 0);
        return delta || a.index - b.index;
      })[0];
  }

  /** 列出全部手动栏位（1 至 slotCount）。 */
  listSlots() {
    const slots = [];
    for (let index = 1; index <= this.slotCount; index++) {
      const id = this.slotId(index);
      slots.push({ type: 'manual', index, id, exists: this.storage.has(id), info: this.storage.getInfo(id) });
    }
    return slots;
  }

  /**
   * 异步列出全部手动栏位（推荐用于 IndexedDB）。
   * @returns {Promise<Array<{type: string, index: number, id: string, exists: boolean, info: Object|null}>>}
   */
  async listSlotsAsync() {
    const slots = [];
    for (let index = 1; index <= this.slotCount; index++) {
      const id = this.slotId(index);
      const exists = this.storage.hasAsync ? await this.storage.hasAsync(id) : this.storage.has(id);
      const info = this.storage.getInfoAsync ? await this.storage.getInfoAsync(id) : this.storage.getInfo(id);
      slots.push({ type: 'manual', index, id, exists, info });
    }
    return slots;
  }

  /**
   * 列出已存在的手动存档栏位（动态显示用）。
   * @returns {Promise<Array<{type: string, index: number, id: string, exists: boolean, info: Object|null}>>}
   */
  async listExistingSlotsAsync() {
    if (!this.storage.listAllSlots) {
      // localStorage 后端，使用传统方式
      return this.listSlots().filter(slot => slot.exists);
    }

    // IndexedDB 后端，直接查询所有存档
    const allSlots = await this.storage.listAllSlots();
    const manualSlots = allSlots
      .filter(item => item.slot.startsWith('slot-'))
      .map(item => {
        const index = parseInt(item.slot.replace('slot-', ''), 10);
        return {
          type: 'manual',
          index,
          id: item.slot,
          exists: true,
          info: {
            slot: item.slot,
            version: item.snapshot?.version,
            createdAt: item.snapshot?.createdAt,
            meta: item.snapshot?.meta || {},
            sections: item.snapshot?.data ? Object.keys(item.snapshot.data) : []
          }
        };
      })
      .sort((a, b) => a.index - b.index);

    return manualSlots;
  }

  /**
   * 获取下一个可用的存档槽位编号。
   * 如果前 9 个槽位未满，返回最小的空位。
   * 如果前 9 个已满，返回最大编号 + 1。
   * @returns {Promise<number>}
   */
  async getNextAvailableSlotIndex() {
    const existingSlots = await this.listExistingSlotsAsync();
    const usedIndices = new Set(existingSlots.map(s => s.index));

    // 先检查前 9 个位置
    for (let i = 1; i <= DEFAULT_VISIBLE_SLOTS; i++) {
      if (!usedIndices.has(i)) return i;
    }

    // 前 9 个已满，找最大编号 + 1
    const maxIndex = existingSlots.length > 0 ? Math.max(...existingSlots.map(s => s.index)) : 0;
    const nextIndex = maxIndex + 1;
    
    if (nextIndex > this.slotCount) {
      throw new RangeError(`已达到最大存档数量 ${this.slotCount}`);
    }

    return nextIndex;
  }

  hasAny() {
    return this.getAutoSlots().some(slot => slot.exists) || this.listSlots().some(slot => slot.exists);
  }

  /** 只读检查手动栏位：执行迁移与校验，但不修改任何运行状态。 */
  inspect(index) {
    return this._inspectSlot(this.slotId(index));
  }

  /** 只读检查自动栏位：执行迁移与校验，但不修改任何运行状态。 */
  inspectAuto(index = 1) {
    return this._inspectSlot(this.autoSlotId(index));
  }

  _inspectSlot(slot) {
    const loaded = this.storage.load(slot);
    if (!loaded || loaded.ok === false) {
      return { ok: false, errors: loaded?.errors || [{ code: 'loadFailed', path: slot, message: '读取存档失败' }] };
    }
    const raw = loaded.snapshot !== undefined ? loaded.snapshot : loaded;
    const migrated = this.manager.migrate(raw);
    if (!migrated.ok) return migrated;
    const validation = this.manager.validate(migrated.snapshot);
    if (!validation.ok) return validation;
    return { ok: true, errors: [], snapshot: migrated.snapshot };
  }

  /** 写入手动栏位。 */
  save(index, meta = {}) {
    return this.manager.save(this.slotId(index), { gameId: this.gameId, kind: 'manual', slot: Number(index), ...meta });
  }

  /** 异步写入手动栏位（推荐用于 IndexedDB）。 */
  async saveAsync(index, meta = {}) {
    await this.ready();
    const slotId = this.slotId(index);
    const snapshot = await this.manager.capture({ gameId: this.gameId, kind: 'manual', slot: Number(index), ...meta });
    if (!snapshot.ok) return snapshot;
    
    if (this.storage.save) {
      // IndexedDB 同步保存会返回 pending
      const result = this.storage.save(slotId, snapshot.snapshot);
      if (result.pending) {
        // 等待实际完成
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return result;
    }
    return { ok: false, errors: [{ code: 'saveFailed', message: '存储不可用' }] };
  }

  /** 读取手动栏位。 */
  load(index) {
    return this.manager.load(this.slotId(index));
  }

  /** 异步读取手动栏位（推荐用于 IndexedDB）。 */
  async loadAsync(index) {
    await this.ready();
    const slotId = this.slotId(index);
    
    if (this.storage.loadAsync) {
      const loaded = await this.storage.loadAsync(slotId);
      if (!loaded.ok) return loaded;
      
      const migrated = this.manager.migrate(loaded.snapshot);
      if (!migrated.ok) return migrated;
      
      const validation = this.manager.validate(migrated.snapshot);
      if (!validation.ok) return validation;
      
      return { ok: true, snapshot: migrated.snapshot, errors: [] };
    }
    
    return this.manager.load(slotId);
  }

  /**
   * 从 localStorage 清理旧存档，只保留指定范围的槽位。
   * @param {Object} options
   * @param {number} [options.keepFrom=1] - 保留起始槽位
   * @param {number} [options.keepTo=6] - 保留结束槽位
   * @returns {{removed: number, kept: number}}
   */
  clearOldLocalStorageSaves({ keepFrom = 1, keepTo = 6 } = {}) {
    if (typeof localStorage === 'undefined') return { removed: 0, kept: 0 };

    const prefix = `yijian18:${this.gameId}:save:`;
    const keysToRemove = [];
    let removed = 0;
    let kept = 0;

    // 收集所有存档键
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const slotPart = key.replace(prefix, '');
        
        // 检查是否为手动存档槽位
        const slotMatch = slotPart.match(/^slot-(\d+)$/);
        if (slotMatch) {
          const slotNum = parseInt(slotMatch[1], 10);
          if (slotNum >= keepFrom && slotNum <= keepTo) {
            kept++;
          } else {
            keysToRemove.push(key);
          }
        }
        
        // 检查是否为旧自动存档（不带数字后缀）
        if (slotPart === 'autosave' || slotPart === this.autoSlotPrefix) {
          keysToRemove.push(key);
        }
      }
    }

    // 执行删除
    for (const key of keysToRemove) {
      try {
        localStorage.removeItem(key);
        removed++;
      } catch (e) {
        console.warn(`[SaveGameService] 清理存档失败: ${key}`, e);
      }
    }

    console.log(`[SaveGameService] 清理 localStorage 完成: 移除 ${removed} 个，保留 ${kept} 个`);
    return { removed, kept };
  }

  clear(index) {
    return this.storage.remove(this.slotId(index));
  }

  /** 异步删除手动栏位（推荐用于 IndexedDB）。 */
  async clearAsync(index) {
    if (this.storage.removeAsync) {
      return this.storage.removeAsync(this.slotId(index));
    }
    return this.storage.remove(this.slotId(index));
  }

  /** 写入下一自动栏位，并返回本次实际覆盖的栏位信息。 */
  saveAuto(meta = {}) {
    const slot = this.getNextAutoSlot();
    const result = this.manager.save(slot.id, {
      gameId: this.gameId,
      kind: 'auto',
      autoSlot: slot.index,
      ...meta
    });
    return { ...result, autoSlotId: slot.id, autoSlotIndex: slot.index };
  }

  /** 读取指定自动栏位。 */
  loadAuto(index = 1) {
    return this.manager.load(this.autoSlotId(index));
  }

  /** 清理指定自动栏位；不传 index 时清理全部自动栏位。 */
  clearAuto(index = null) {
    if (index != null) return this.storage.remove(this.autoSlotId(index));
    return this.getAutoSlots().every(slot => this.storage.remove(slot.id));
  }

  /** 将旧单自动位迁移到第一个轮换自动位，避免已有进度丢失。 */
  _migrateLegacyAutoSlot() {
    const legacyId = this.autoSlotPrefix;
    if (!this.storage?.has?.(legacyId) || this.getAutoSlots().some(slot => slot.exists)) return;
    const loaded = this.storage.load(legacyId);
    if (!loaded.ok || !loaded.snapshot) return;
    const snapshot = {
      ...loaded.snapshot,
      meta: { ...(loaded.snapshot.meta || {}), kind: 'auto', autoSlot: 1, migratedLegacyAutoSlot: true }
    };
    const migrated = this.storage.save(this.autoSlotId(1), snapshot);
    if (migrated?.ok) this.storage.remove(legacyId);
  }
}

export default SaveGameService;