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
 * IndexedDB 快照存储适配器。
 *
 * IndexedDB 没有同步 API；所有存档读写必须等待对应 Promise 完成，
 * 不能将请求已提交误判为存档已经存在或已经保存。
 */

const DB_NAME = 'yijian18_saves';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';

export class IndexedDBAdapter {
  constructor({ prefix = 'yijian18_snapshot', dbName = DB_NAME, storeName = STORE_NAME } = {}) {
    this.prefix = prefix;
    this.dbName = dbName;
    this.storeName = storeName;
    this._db = null;
    this._dbPromise = null;
  }

  _key(slot) {
    return `${this.prefix}:${slot}`;
  }

  async init() {
    await this._getDb();
    return true;
  }

  async _getDb() {
    if (this._db) return this._db;
    if (this._dbPromise) return this._dbPromise;
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB 不可用');

    this._dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);
      request.onerror = () => reject(request.error || new Error('无法打开 IndexedDB'));
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) {
          database.createObjectStore(this.storeName, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        this._db = request.result;
        this._db.onversionchange = () => {
          this._db?.close();
          this._db = null;
          this._dbPromise = null;
        };
        resolve(this._db);
      };
    });

    return this._dbPromise;
  }

  async saveAsync(slot, snapshot) {
    try {
      const database = await this._getDb();
      return await new Promise(resolve => {
        const transaction = database.transaction(this.storeName, 'readwrite');
        transaction.objectStore(this.storeName).put({
          key: this._key(slot),
          snapshot,
          updatedAt: Date.now()
        });
        transaction.oncomplete = () => resolve({ ok: true, errors: [] });
        transaction.onerror = () => resolve({
          ok: false,
          errors: [{ code: 'saveFailed', path: slot, message: transaction.error?.message || 'IndexedDB 写入失败' }]
        });
        transaction.onabort = transaction.onerror;
      });
    } catch (error) {
      return {
        ok: false,
        errors: [{ code: 'saveFailed', path: slot, message: error?.message || String(error) }]
      };
    }
  }

  async loadAsync(slot) {
    try {
      const database = await this._getDb();
      return await new Promise(resolve => {
        const transaction = database.transaction(this.storeName, 'readonly');
        const request = transaction.objectStore(this.storeName).get(this._key(slot));
        request.onsuccess = () => {
          const record = request.result;
          resolve(record
            ? { ok: true, snapshot: record.snapshot, errors: [] }
            : { ok: false, errors: [{ code: 'notFound', path: slot, message: '存档不存在' }] });
        };
        request.onerror = () => resolve({
          ok: false,
          errors: [{ code: 'loadFailed', path: slot, message: request.error?.message || 'IndexedDB 读取失败' }]
        });
      });
    } catch (error) {
      return {
        ok: false,
        errors: [{ code: 'loadFailed', path: slot, message: error?.message || String(error) }]
      };
    }
  }

  async removeAsync(slot) {
    try {
      const database = await this._getDb();
      return await new Promise(resolve => {
        const transaction = database.transaction(this.storeName, 'readwrite');
        transaction.objectStore(this.storeName).delete(this._key(slot));
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = transaction.onabort = () => resolve(false);
      });
    } catch {
      return false;
    }
  }

  async listAllSlots() {
    try {
      const database = await this._getDb();
      return await new Promise(resolve => {
        const transaction = database.transaction(this.storeName, 'readonly');
        const request = transaction.objectStore(this.storeName).getAll();
        request.onsuccess = () => resolve((request.result || [])
          .filter(record => record.key.startsWith(`${this.prefix}:`))
          .map(record => ({
            key: record.key,
            slot: record.key.slice(this.prefix.length + 1),
            snapshot: record.snapshot,
            updatedAt: record.updatedAt
          })));
        request.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }
}

export default IndexedDBAdapter;
