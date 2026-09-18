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

import { SnapshotManager } from './SnapshotManager.js';
import { IndexedDBAdapter } from './IndexedDBAdapter.js';
import { LocalStorageAdapter } from './LocalStorageAdapter.js';

export const DEFAULT_VISIBLE_SLOTS = 9;
export const MAX_MANUAL_SAVE_SLOTS = 100;
export const AUTO_SAVE_SLOT_COUNT = 3;

/**
 * 多栏位存档服务。
 *
 * IndexedDB 为默认后端。所有 IndexedDB 操作均为异步操作，只有事务
 * 完成后才向调用者报告保存、删除或读取成功。
 */
export class SaveGameService {
  constructor({
    gameId = 'game',
    slotCount = MAX_MANUAL_SAVE_SLOTS,
    autoSlotCount = AUTO_SAVE_SLOT_COUNT,
    autoSlotPrefix = 'autosave',
    storage = null,
    useIndexedDB = true,
    now = null
  } = {}) {
    this.gameId = gameId;
    this.slotCount = Math.min(MAX_MANUAL_SAVE_SLOTS, Math.max(1, Number(slotCount) || 1));
    this.autoSlotCount = Math.min(AUTO_SAVE_SLOT_COUNT, Math.max(1, Number(autoSlotCount) || 1));
    this.autoSlotPrefix = autoSlotPrefix || 'autosave';
    this.storage = storage || (useIndexedDB && typeof indexedDB !== 'undefined'
      ? new IndexedDBAdapter({ prefix: this._storagePrefix() })
      : new LocalStorageAdapter({ prefix: this._storagePrefix() }));
    this._isIndexedDB = this.storage instanceof IndexedDBAdapter;
    this.manager = new SnapshotManager({ storage: this.storage, now: now || (() => Date.now()) });
    this._providerOff = null;
    this._autoSaveExecutor = null;
    this._checkpointLoadExecutor = null;
    this._readyPromise = this.storage.init ? Promise.resolve(this.storage.init()) : Promise.resolve(true);
  }

  _storagePrefix() {
    return `yijian18:${this.gameId}:save`;
  }

  async ready() {
    await this._readyPromise;
  }

  isUsingIndexedDB() {
    return this._isIndexedDB;
  }

  slotId(index) {
    const value = Number(index);
    if (!Number.isInteger(value) || value < 1 || value > this.slotCount) {
      throw new RangeError(`无效手动存档槽: ${index}`);
    }
    return `slot-${value}`;
  }

  autoSlotId(index) {
    const value = Number(index);
    if (!Number.isInteger(value) || value < 1 || value > this.autoSlotCount) {
      throw new RangeError(`无效自动存档槽: ${index}`);
    }
    return `${this.autoSlotPrefix}-${value}`;
  }

  setAutoSaveExecutor(executor) {
    this._autoSaveExecutor = typeof executor === 'function' ? executor : null;
  }

  requestAutoSave(meta = {}) {
    return this._autoSaveExecutor
      ? Promise.resolve(this._autoSaveExecutor(meta))
      : this.saveAutoAsync(meta);
  }

  setCheckpointLoadExecutor(executor) {
    this._checkpointLoadExecutor = typeof executor === 'function' ? executor : null;
  }

  loadCheckpoint(checkpointId) {
    return this._checkpointLoadExecutor
      ? Promise.resolve(this._checkpointLoadExecutor({ checkpointId }))
      : Promise.resolve({ ok: false, code: 'checkpointLoadUnavailable' });
  }

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
    if (!data || typeof data !== 'object' || !data.player || typeof data.player !== 'object') {
      return { ok: false, errors: [{ code: 'missingField', path: 'player', message: '缺少玩家状态' }] };
    }
    return { ok: true, errors: [] };
  }

  _toInfo(slot, snapshot) {
    return {
      slot,
      version: snapshot?.version,
      createdAt: snapshot?.createdAt,
      meta: snapshot?.meta || {},
      sections: snapshot?.data ? Object.keys(snapshot.data) : []
    };
  }

  async _allStoredSlots() {
    await this.ready();
    if (this.storage.listAllSlots) return this.storage.listAllSlots();
    const slots = [];
    for (let index = 1; index <= this.slotCount; index++) {
      const id = this.slotId(index);
      const loaded = this.storage.load(id);
      if (loaded?.ok) slots.push({ slot: id, snapshot: loaded.snapshot });
    }
    for (let index = 1; index <= this.autoSlotCount; index++) {
      const id = this.autoSlotId(index);
      const loaded = this.storage.load(id);
      if (loaded?.ok) slots.push({ slot: id, snapshot: loaded.snapshot });
    }
    return slots;
  }

  async getAutoSlotsAsync() {
    const records = await this._allStoredSlots();
    const bySlot = new Map(records.map(record => [record.slot, record.snapshot]));
    return Array.from({ length: this.autoSlotCount }, (_, offset) => {
      const index = offset + 1;
      const id = this.autoSlotId(index);
      const snapshot = bySlot.get(id);
      return { type: 'auto', index, id, exists: Boolean(snapshot), info: snapshot ? this._toInfo(id, snapshot) : null };
    });
  }

  async getLatestAutoSlotAsync() {
    return (await this.getAutoSlotsAsync())
      .filter(slot => slot.exists)
      .sort((left, right) => (Number(right.info?.createdAt) || 0) - (Number(left.info?.createdAt) || 0))[0] || null;
  }

  async getNextAutoSlotAsync() {
    const slots = await this.getAutoSlotsAsync();
    return slots.find(slot => !slot.exists) || slots.slice().sort((left, right) => {
      const timestamp = (Number(left.info?.createdAt) || 0) - (Number(right.info?.createdAt) || 0);
      return timestamp || left.index - right.index;
    })[0];
  }

  async listExistingSlotsAsync() {
    const records = await this._allStoredSlots();
    return records
      .filter(record => /^slot-\d+$/.test(record.slot))
      .map(record => {
        const index = Number(record.slot.slice(5));
        return { type: 'manual', index, id: record.slot, exists: true, info: this._toInfo(record.slot, record.snapshot) };
      })
      .filter(slot => Number.isInteger(slot.index) && slot.index >= 1 && slot.index <= this.slotCount)
      .sort((left, right) => left.index - right.index);
  }

  async getNextAvailableSlotIndex() {
    const used = new Set((await this.listExistingSlotsAsync()).map(slot => slot.index));
    for (let index = 1; index <= DEFAULT_VISIBLE_SLOTS; index++) {
      if (!used.has(index)) return index;
    }
    const highest = Math.max(DEFAULT_VISIBLE_SLOTS, ...used);
    if (highest >= this.slotCount) throw new RangeError(`已达到最大存档数量 ${this.slotCount}`);
    return highest + 1;
  }

  async hasAnyAsync() {
    const [autoSlots, manualSlots] = await Promise.all([this.getAutoSlotsAsync(), this.listExistingSlotsAsync()]);
    return autoSlots.some(slot => slot.exists) || manualSlots.length > 0;
  }

  async inspectAsync(index) {
    return this._inspectSlotAsync(this.slotId(index));
  }

  async inspectAutoAsync(index = 1) {
    return this._inspectSlotAsync(this.autoSlotId(index));
  }

  async _inspectSlotAsync(slot) {
    await this.ready();
    const loaded = this.storage.loadAsync
      ? await this.storage.loadAsync(slot)
      : this.storage.load(slot);
    if (!loaded?.ok) {
      return { ok: false, errors: loaded?.errors || [{ code: 'loadFailed', path: slot, message: '读取存档失败' }] };
    }
    const migrated = this.manager.migrate(loaded.snapshot);
    if (!migrated.ok) return migrated;
    const validation = this.manager.validate(migrated.snapshot);
    return validation.ok
      ? { ok: true, errors: [], snapshot: migrated.snapshot }
      : validation;
  }

  async saveAsync(index, meta = {}) {
    return this._saveSlotAsync(this.slotId(index), { gameId: this.gameId, kind: 'manual', slot: Number(index), ...meta });
  }

  async saveAutoAsync(meta = {}) {
    const slot = await this.getNextAutoSlotAsync();
    const result = await this._saveSlotAsync(slot.id, {
      gameId: this.gameId,
      kind: 'auto',
      autoSlot: slot.index,
      ...meta
    });
    return { ...result, autoSlotId: slot.id, autoSlotIndex: slot.index };
  }

  async _saveSlotAsync(slot, meta) {
    await this.ready();
    const captured = this.manager.capture(meta);
    if (!captured.ok) return captured;
    const saved = this.storage.saveAsync
      ? await this.storage.saveAsync(slot, captured.snapshot)
      : this.storage.save(slot, captured.snapshot);
    return saved?.ok
      ? { ok: true, errors: [], snapshot: captured.snapshot }
      : (saved || { ok: false, errors: [{ code: 'saveFailed', path: slot, message: '存储不可用' }] });
  }

  async loadAsync(index) {
    return this._loadSlotAsync(this.slotId(index));
  }

  async loadAutoAsync(index = 1) {
    return this._loadSlotAsync(this.autoSlotId(index));
  }

  async _loadSlotAsync(slot) {
    const inspected = await this._inspectSlotAsync(slot);
    if (!inspected.ok) return inspected;
    return this.manager.restore(inspected.snapshot);
  }

  async clearAsync(index) {
    return this._removeAsync(this.slotId(index));
  }

  async clearAutoAsync(index = null) {
    if (index != null) return this._removeAsync(this.autoSlotId(index));
    const results = await Promise.all(Array.from({ length: this.autoSlotCount }, (_, offset) => this._removeAsync(this.autoSlotId(offset + 1))));
    return results.every(Boolean);
  }

  async _removeAsync(slot) {
    await this.ready();
    return this.storage.removeAsync ? this.storage.removeAsync(slot) : this.storage.remove(slot);
  }

  /**
   * 将指定范围的旧 localStorage 手动存档迁入 IndexedDB，并清除其余旧栏位。
   * 已存在的 IndexedDB 槽位不会被旧缓存覆盖；复制失败的保留栏位不会被删除。
   */
  async migrateLegacyLocalStorage({ keepFrom = 1, keepTo = 6 } = {}) {
    if (!this.isUsingIndexedDB() || typeof localStorage === 'undefined') {
      return { ok: true, migrated: 0, removed: 0, errors: [] };
    }

    await this.ready();
    const legacy = new LocalStorageAdapter({ prefix: this._storagePrefix(), storage: localStorage });
    const legacyKeys = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${this._storagePrefix()}:`)) legacyKeys.push(key);
    }

    const errors = [];
    let migrated = 0;
    let removed = 0;
    for (const key of legacyKeys) {
      const slot = key.slice(this._storagePrefix().length + 1);
      const manualMatch = /^slot-(\d+)$/.exec(slot);
      const manualIndex = Number(manualMatch?.[1]);
      const shouldKeep = Number.isInteger(manualIndex) && manualIndex >= keepFrom && manualIndex <= keepTo;

      if (!shouldKeep) {
        localStorage.removeItem(key);
        removed++;
        continue;
      }

      const legacySnapshot = legacy.load(slot);
      if (!legacySnapshot.ok) {
        errors.push(...legacySnapshot.errors);
        continue;
      }
      const existing = await this.storage.loadAsync(slot);
      const stored = existing.ok ? { ok: true } : await this.storage.saveAsync(slot, legacySnapshot.snapshot);
      if (!stored.ok) {
        errors.push(...(stored.errors || []));
        continue;
      }
      if (!existing.ok) migrated++;
      localStorage.removeItem(key);
      removed++;
    }

    return { ok: errors.length === 0, migrated, removed, errors };
  }
}

export default SaveGameService;
