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

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

/**
 * 注册场景中具备独立库存的固定容器，并提供稳定的存档与操作序号。
 * 容器仍复用 InventoryComponent 与 ItemLifecycleService 的权威 transfer 命令。
 */
export class SceneContainerInventoryRegistry {
  constructor() {
    this.entries = new Map();
    // 易失容器：可统一 resolve / nextOperationId，但不参与存档校验与序列化
    // （军营粮草等权威数据在领域服务里，不能追加进旧档的 containerInventories 段）。
    this.volatile = new Map();
  }

  register(id, inventory) {
    if (!id || typeof inventory?.exportItems !== 'function' || typeof inventory?.loadItems !== 'function') {
      throw new TypeError('SceneContainerInventoryRegistry requires a stable id and inventory API');
    }
    const existing = this.entries.get(id);
    if (existing && existing.inventory !== inventory) throw new Error(`Container inventory already registered: ${id}`);
    if (!existing) this.entries.set(id, { inventory, operationSequence: 0 });
    return inventory;
  }

  /**
   * 注册不参与存档的容器（同一 id 重复注册同实例幂等）。
   * 与持久容器共享 resolve / nextOperationId，但不出现在 serialize/validate/restore 中，
   * 旧存档不会因新增易失容器而缺少条目。
   */
  registerVolatile(id, inventory) {
    if (!id || typeof inventory?.exportItems !== 'function' || typeof inventory?.loadItems !== 'function') {
      throw new TypeError('SceneContainerInventoryRegistry requires a stable id and inventory API');
    }
    if (this.entries.has(id)) throw new Error(`Container inventory id already registered as persistent: ${id}`);
    const existing = this.volatile.get(id);
    if (existing && existing.inventory !== inventory) throw new Error(`Volatile container inventory already registered: ${id}`);
    if (!existing) this.volatile.set(id, { inventory, operationSequence: 0 });
    return inventory;
  }

  resolve(id) {
    return this.entries.get(id)?.inventory || this.volatile.get(id)?.inventory || null;
  }

  nextOperationId(id, prefix = 'container-transfer') {
    const entry = this.entries.get(id) || this.volatile.get(id);
    if (!entry) throw new Error(`Unknown container inventory: ${id}`);
    entry.operationSequence += 1;
    return `${prefix}:${id}:${entry.operationSequence}`;
  }

  serialize() {
    return {
      schemaVersion: 1,
      entries: [...this.entries.entries()].map(([id, entry]) => ({
        id,
        items: clone(entry.inventory.exportItems()),
        operationSequence: entry.operationSequence
      }))
    };
  }

  validateSerialized(data) {
    if (data == null) return { ok: true, errors: [] };
    const errors = [];
    const seen = new Set();
    if (data.schemaVersion !== 1 || !Array.isArray(data.entries)) {
      return { ok: false, errors: [{ code: 'invalidContainerInventoryState', path: '', message: '容器库存状态格式无效' }] };
    }
    for (const [index, entry] of data.entries.entries()) {
      if (!this.entries.has(entry?.id) || seen.has(entry.id) || !Array.isArray(entry?.items) || !Number.isInteger(entry?.operationSequence) || entry.operationSequence < 0) {
        errors.push({ code: 'invalidContainerInventoryEntry', path: `entries[${index}]`, message: '容器库存条目无效、重复或未注册' });
        continue;
      }
      seen.add(entry.id);
    }
    for (const id of this.entries.keys()) {
      if (!seen.has(id)) {
        errors.push({ code: 'missingContainerInventoryEntry', path: 'entries', message: `缺少容器库存条目：${id}` });
      }
    }
    return { ok: errors.length === 0, errors };
  }

  restore(data) {
    const check = this.validateSerialized(data);
    if (!check.ok || data == null) return check;
    const before = [...this.entries.entries()].map(([id, entry]) => ({
      id, items: clone(entry.inventory.exportItems()), operationSequence: entry.operationSequence
    }));
    try {
      for (const source of data.entries) {
        const entry = this.entries.get(source.id);
        entry.inventory.loadItems(clone(source.items));
        entry.operationSequence = source.operationSequence;
      }
      return { ok: true };
    } catch (error) {
      for (const source of before) {
        const entry = this.entries.get(source.id);
        entry.inventory.loadItems(source.items);
        entry.operationSequence = source.operationSequence;
      }
      return { ok: false, errors: [{ code: 'containerInventoryRestoreFailed', path: '', message: error?.message || '容器库存恢复失败' }] };
    }
  }
}

export default SceneContainerInventoryRegistry;