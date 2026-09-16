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
 * LocalStorageAdapter.js
 * 快照存储适配器：localStorage 读写与槽位管理。
 *
 * 只负责持久化，不参与业务状态恢复。
 * 读取失败或 JSON 非法时返回错误，不抛异常，
 * 由 SnapshotManager 决定是否放弃恢复。
 */

export class LocalStorageAdapter {
  /**
   * @param {Object} [config]
   * @param {string} [config.prefix] - 键名前缀
   * @param {Object} [config.storage] - 可注入的存储实现，便于测试
   */
  constructor(config = {}) {
    this.prefix = config.prefix || 'yijian18_snapshot';
    this.storage = config.storage
      || (typeof localStorage !== 'undefined' ? localStorage : null);
  }

  /** @private */
  _key(slot) {
    return `${this.prefix}:${slot}`;
  }

  /** 读取槽位原始文本；用于事务覆盖前保留损坏 JSON 的原始字节。 */
  readRaw(slot) {
    if (!this.storage) return { ok: false, exists: false, raw: null, errors: [{ code: 'noStorage', path: slot, message: '存储不可用' }] };
    try {
      const raw = this.storage.getItem(this._key(slot));
      return { ok: true, exists: raw !== null, raw, errors: [] };
    } catch (error) {
      return { ok: false, exists: false, raw: null, errors: [{ code: 'loadFailed', path: slot, message: error?.message || String(error) }] };
    }
  }

  /** 原样恢复槽位文本；不解析、不规范化损坏 JSON。 */
  writeRaw(slot, raw) {
    if (!this.storage) return { ok: false, errors: [{ code: 'noStorage', path: slot, message: '存储不可用' }] };
    try {
      if (raw === null || raw === undefined) this.storage.removeItem(this._key(slot));
      else this.storage.setItem(this._key(slot), String(raw));
      return { ok: true, errors: [] };
    } catch (error) {
      return { ok: false, errors: [{ code: 'saveFailed', path: slot, message: error?.message || String(error) }] };
    }
  }

  /**
   * 保存快照
   * @param {string} slot
   * @param {Object} snapshot
   * @returns {{ok: boolean, errors: Array<Object>}}
   */
  save(slot, snapshot) {
    if (!this.storage) {
      return { ok: false, errors: [{ code: 'noStorage', path: slot, message: '存储不可用' }] };
    }

    try {
      this.storage.setItem(this._key(slot), JSON.stringify(snapshot));
      return { ok: true, errors: [] };
    } catch (e) {
      return {
        ok: false,
        errors: [{ code: 'saveFailed', path: slot, message: String(e && e.message ? e.message : e) }]
      };
    }
  }

  /**
   * 读取快照
   * @param {string} slot
   * @returns {{ok: boolean, snapshot?: Object, errors: Array<Object>}}
   */
  load(slot) {
    if (!this.storage) {
      return { ok: false, errors: [{ code: 'noStorage', path: slot, message: '存储不可用' }] };
    }

    let raw;
    try {
      raw = this.storage.getItem(this._key(slot));
    } catch (e) {
      return {
        ok: false,
        errors: [{ code: 'loadFailed', path: slot, message: String(e && e.message ? e.message : e) }]
      };
    }

    if (raw === null || raw === undefined) {
      return { ok: false, errors: [{ code: 'notFound', path: slot, message: '存档不存在' }] };
    }

    try {
      return { ok: true, snapshot: JSON.parse(raw), errors: [] };
    } catch (e) {
      // 存档损坏时原样保留，便于人工排查
      return {
        ok: false,
        errors: [{ code: 'invalidJson', path: slot, message: String(e && e.message ? e.message : e) }]
      };
    }
  }

  /**
   * 是否存在存档
   * @param {string} slot
   * @returns {boolean}
   */
  has(slot) {
    if (!this.storage) return false;
    try {
      return this.storage.getItem(this._key(slot)) !== null;
    } catch (e) {
      return false;
    }
  }

  /**
   * 删除存档
   * @param {string} slot
   * @returns {boolean}
   */
  remove(slot) {
    if (!this.storage) return false;
    try {
      this.storage.removeItem(this._key(slot));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 读取存档摘要，不做完整恢复
   * @param {string} slot
   * @returns {Object|null}
   */
  getInfo(slot) {
    const loaded = this.load(slot);
    if (!loaded.ok) return null;

    const snapshot = loaded.snapshot;
    return {
      slot,
      version: snapshot.version,
      createdAt: snapshot.createdAt,
      meta: snapshot.meta || {},
      sections: snapshot.data ? Object.keys(snapshot.data) : []
    };
  }
}

export default LocalStorageAdapter;
