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
 * IndexedDBAdapter.js
 * 快照存储适配器：IndexedDB 读写与槽位管理。
 *
 * 相比 localStorage，IndexedDB 支持更大的存储配额（通常 50MB+），
 * 适合存储大型游戏存档。
 *
 * 只负责持久化，不参与业务状态恢复。
 */

const DB_NAME = 'yijian18_saves';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';

export class IndexedDBAdapter {
  /**
   * @param {Object} [config]
   * @param {string} [config.prefix] - 键名前缀
   * @param {string} [config.dbName] - 数据库名称
   * @param {string} [config.storeName] - 存储库名称
   */
  constructor(config = {}) {
    this.prefix = config.prefix || 'yijian18_snapshot';
    this.dbName = config.dbName || DB_NAME;
    this.storeName = config.storeName || STORE_NAME;
    this._db = null;
    this._dbPromise = null;
  }

  /**
   * 获取数据库连接（懒加载）
   * @returns {Promise<IDBDatabase>}
   * @private
   */
  async _getDb() {
    if (this._db) return this._db;
    
    if (this._dbPromise) return this._dbPromise;

    this._dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB 不可用'));
        return;
      }

      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onerror = () => {
        reject(new Error(`打开数据库失败: ${request.error?.message || '未知错误'}`));
      };

      request.onsuccess = () => {
        this._db = request.result;
        resolve(this._db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' });
        }
      };
    });

    return this._dbPromise;
  }

  /** @private */
  _key(slot) {
    return `${this.prefix}:${slot}`;
  }

  /**
   * 保存快照（同步兼容 API）
   * @param {string} slot
   * @param {Object} snapshot
   * @returns {{ok: boolean, errors: Array<Object>, pending?: boolean}}
   */
  save(slot, snapshot) {
    // 如果数据库已经初始化，尝试同步写入
    if (this._db) {
      try {
        const transaction = this._db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const key = this._key(slot);
        
        store.put({
          key,
          snapshot,
          updatedAt: Date.now()
        });
        
        return { ok: true, errors: [] };
      } catch (e) {
        return {
          ok: false,
          errors: [{ code: 'saveFailed', path: slot, message: e?.message || String(e) }]
        };
      }
    }

    // 数据库未初始化时，启动异步初始化并返回 pending
    this._getDb().then(() => {
      this.save(slot, snapshot);
    }).catch(e => {
      console.error('[IndexedDBAdapter] 初始化失败:', e);
    });

    return { ok: true, errors: [], pending: true };
  }

  /**
   * 异步保存快照
   * @param {string} slot
   * @param {Object} snapshot
   * @returns {Promise<{ok: boolean, errors: Array<Object>}>}
   */
  async saveAsync(slot, snapshot) {
    try {
      const db = await this._getDb();
      return new Promise((resolve) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const key = this._key(slot);
        
        const request = store.put({
          key,
          snapshot,
          updatedAt: Date.now()
        });

        request.onsuccess = () => {
          resolve({ ok: true, errors: [] });
        };

        request.onerror = () => {
          resolve({
            ok: false,
            errors: [{ code: 'saveFailed', path: slot, message: request.error?.message || '保存失败' }]
          });
        };
      });
    } catch (e) {
      return {
        ok: false,
        errors: [{ code: 'saveFailed', path: slot, message: e?.message || String(e) }]
      };
    }
  }

  /**
   * 读取快照
   * @param {string} slot
   * @returns {{ok: boolean, snapshot?: Object, errors: Array<Object>}}
   */
  load(slot) {
    // 如果数据库已初始化，同步读取
    if (this._db) {
      try {
        const transaction = this._db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const key = this._key(slot);
        const request = store.get(key);

        // 注意：IndexedDB 是异步的，这里返回 pending 状态
        // 实际使用时应使用 loadAsync
        return { ok: true, pending: true, errors: [] };
      } catch (e) {
        return {
          ok: false,
          errors: [{ code: 'loadFailed', path: slot, message: e?.message || String(e) }]
        };
      }
    }

    // 数据库未初始化
    return { ok: false, errors: [{ code: 'notFound', path: slot, message: '存档不存在' }] };
  }

  /**
   * 异步读取快照
   * @param {string} slot
   * @returns {Promise<{ok: boolean, snapshot?: Object, errors: Array<Object>}>}
   */
  async loadAsync(slot) {
    try {
      const db = await this._getDb();
      return new Promise((resolve) => {
        const transaction = db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const key = this._key(slot);
        const request = store.get(key);

        request.onsuccess = () => {
          const result = request.result;
          if (!result) {
            resolve({ ok: false, errors: [{ code: 'notFound', path: slot, message: '存档不存在' }] });
            return;
          }
          resolve({ ok: true, snapshot: result.snapshot, errors: [] });
        };

        request.onerror = () => {
          resolve({
            ok: false,
            errors: [{ code: 'loadFailed', path: slot, message: request.error?.message || '读取失败' }]
          });
        };
      });
    } catch (e) {
      return {
        ok: false,
        errors: [{ code: 'loadFailed', path: slot, message: e?.message || String(e) }]
      };
    }
  }

  /**
   * 是否存在存档
   * @param {string} slot
   * @returns {boolean}
   */
  has(slot) {
    if (!this._db) return false;
    try {
      const transaction = this._db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const key = this._key(slot);
      const request = store.get(key);
      // 同步 API 无法获取结果，返回 false 让调用方使用 hasAsync
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * 异步检查是否存在存档
   * @param {string} slot
   * @returns {Promise<boolean>}
   */
  async hasAsync(slot) {
    try {
      const db = await this._getDb();
      return new Promise((resolve) => {
        const transaction = db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const key = this._key(slot);
        const request = store.get(key);

        request.onsuccess = () => {
          resolve(request.result !== undefined);
        };

        request.onerror = () => {
          resolve(false);
        };
      });
    } catch (e) {
      return false;
    }
  }

  /**
   * 删除存档
   * @param {string} slot
   * @returns {Promise<boolean>}
   */
  async removeAsync(slot) {
    try {
      const db = await this._getDb();
      return new Promise((resolve) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const key = this._key(slot);
        const request = store.delete(key);

        request.onsuccess = () => {
          resolve(true);
        };

        request.onerror = () => {
          resolve(false);
        };
      });
    } catch (e) {
      return false;
    }
  }

  /**
   * 同步删除（兼容旧 API）
   * @param {string} slot
   * @returns {boolean}
   */
  remove(slot) {
    if (!this._db) {
      this._getDb().then(() => this.removeAsync(slot)).catch(() => {});
      return true;
    }

    try {
      const transaction = this._db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const key = this._key(slot);
      store.delete(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 异步读取存档摘要
   * @param {string} slot
   * @returns {Promise<Object|null>}
   */
  async getInfoAsync(slot) {
    const loaded = await this.loadAsync(slot);
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

  /**
   * 读取存档摘要（兼容旧 API）
   * @param {string} slot
   * @returns {Object|null}
   */
  getInfo(slot) {
    return null; // 异步 API，同步调用返回 null
  }

  /**
   * 读取槽位原始文本
   * @param {string} slot
   * @returns {{ok: boolean, exists: boolean, raw: string|null, errors: Array<Object>}}
   */
  readRaw(slot) {
    return { ok: false, exists: false, raw: null, errors: [{ code: 'notSupported', path: slot, message: 'IndexedDB 不支持原始文本读取' }] };
  }

  /**
   * 原样恢复槽位文本
   * @param {string} slot
   * @param {string} raw
   * @returns {{ok: boolean, errors: Array<Object>}}
   */
  writeRaw(slot, raw) {
    return { ok: false, errors: [{ code: 'notSupported', path: slot, message: 'IndexedDB 不支持原始文本写入' }] };
  }

  /**
   * 列出所有存档槽位
   * @returns {Promise<Array<{key: string, slot: string, snapshot: Object}>>}
   */
  async listAllSlots() {
    try {
      const db = await this._getDb();
      return new Promise((resolve) => {
        const transaction = db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.getAll();

        request.onsuccess = () => {
          const results = request.result || [];
          const slots = results
            .filter(item => item.key.startsWith(this.prefix))
            .map(item => ({
              key: item.key,
              slot: item.key.replace(`${this.prefix}:`, ''),
              snapshot: item.snapshot,
              updatedAt: item.updatedAt
            }));
          resolve(slots);
        };

        request.onerror = () => {
          resolve([]);
        };
      });
    } catch (e) {
      return [];
    }
  }

  /**
   * 初始化数据库连接
   * @returns {Promise<boolean>}
   */
  async init() {
    try {
      await this._getDb();
      return true;
    } catch (e) {
      console.error('[IndexedDBAdapter] 初始化失败:', e);
      return false;
    }
  }
}

export default IndexedDBAdapter;
