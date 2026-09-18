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
 * SnapshotManager.js
 * 原子检查点：聚合各系统状态，先整体校验再一次提交。
 *
 * 每个参与者提供三个能力：
 *   snapshot()          产出可序列化状态
 *   validate(data)      校验状态合法性，不修改运行状态
 *   restore(data)       写入运行状态
 *
 * 加载流程严格分两段：
 *   1. 校验全部参与者的数据；任一失败则整体放弃，运行状态保持不变
 *   2. 全部通过后依次 restore；若某个 restore 抛错，回滚到加载前快照
 *
 * 这样可避免"部分系统已恢复、部分失败"的半成品状态。
 */

/** 快照格式版本 */
export const SNAPSHOT_VERSION = 1;

export class SnapshotManager {
  /**
   * @param {Object} [config]
   * @param {Object} [config.storage] - 存储适配器，需实现 save/load/remove/has
   * @param {Function} [config.now] - 时间源
   * @param {Object} [config.migrations] - 版本迁移器 { [fromVersion]: (data) => data }
   */
  constructor(config = {}) {
    /** @type {Map<string, Object>} 参与者：key -> provider */
    this.providers = new Map();
    this.storage = config.storage || null;
    this.now = config.now || (() => Date.now());
    this.migrations = config.migrations || {};
  }

  /**
   * 注册参与者
   *
   * @param {string} key - 快照中的字段名
   * @param {Object} provider
   * @param {Function} provider.snapshot - () => Object
   * @param {Function} [provider.validate] - (data) => {ok, errors}
   * @param {Function} provider.restore - (data) => void | {ok, errors}
   * @param {boolean} [provider.required] - 加载时是否必须存在该字段
   * @returns {Function} 注销函数
   */
  register(key, provider) {
    if (!key || !provider || typeof provider.snapshot !== 'function' || typeof provider.restore !== 'function') {
      console.warn('SnapshotManager: 参与者必须提供 snapshot 与 restore', key);
      return () => {};
    }

    this.providers.set(key, {
      required: provider.required !== false,
      snapshot: provider.snapshot,
      validate: typeof provider.validate === 'function' ? provider.validate : null,
      restore: provider.restore
    });

    return () => this.providers.delete(key);
  }

  /** 注销参与者 */
  unregister(key) {
    return this.providers.delete(key);
  }

  /** 已注册的参与者字段名 */
  getKeys() {
    return Array.from(this.providers.keys());
  }

  /**
   * 采集完整快照。
   *
   * 全部参与者在同一时点采集，避免不同系统状态错位。
   *
   * @param {Object} [meta] - 附加元信息，如 sceneId、label
   * @returns {{ok: boolean, snapshot?: Object, errors: Array<Object>}}
   */
  capture(meta = {}) {
    const data = {};
    const errors = [];

    for (const [key, provider] of this.providers) {
      try {
        data[key] = provider.snapshot();
      } catch (e) {
        errors.push({
          code: e?.code || 'snapshotFailed',
          path: key,
          message: String(e && e.message ? e.message : e),
          ...(Array.isArray(e?.operationIds) ? { operationIds: [...e.operationIds] } : {}),
          ...(Array.isArray(e?.eventIds) ? { eventIds: [...e.eventIds] } : {}),
          ...(Array.isArray(e?.triggerIds) ? { triggerIds: [...e.triggerIds] } : {})
        });
      }
    }

    if (errors.length > 0) return { ok: false, errors };

    return {
      ok: true,
      errors: [],
      snapshot: {
        version: SNAPSHOT_VERSION,
        createdAt: this.now(),
        meta: { ...meta },
        data
      }
    };
  }

  /**
   * 校验快照，不修改任何运行状态。
   *
   * @param {Object} snapshot
   * @returns {{ok: boolean, errors: Array<Object>}}
   */
  validate(snapshot) {
    const errors = [];

    if (!snapshot || typeof snapshot !== 'object') {
      return { ok: false, errors: [{ code: 'missingField', path: '', message: '快照为空' }] };
    }
    if (typeof snapshot.version !== 'number') {
      errors.push({ code: 'missingField', path: 'version', message: '缺少快照版本' });
    } else if (snapshot.version > SNAPSHOT_VERSION) {
      errors.push({
        code: 'versionMismatch',
        path: 'version',
        message: `快照版本 ${snapshot.version} 高于当前支持版本 ${SNAPSHOT_VERSION}`
      });
    }
    if (!snapshot.data || typeof snapshot.data !== 'object') {
      errors.push({ code: 'missingField', path: 'data', message: '缺少 data 段' });
    }

    if (errors.length > 0) return { ok: false, errors };

    for (const [key, provider] of this.providers) {
      const section = snapshot.data[key];

      if (section === undefined) {
        if (provider.required) {
          errors.push({ code: 'missingField', path: `data.${key}`, message: '缺少必填快照段' });
        }
        continue;
      }

      if (!provider.validate) continue;

      let result;
      try {
        result = provider.validate(section);
      } catch (e) {
        errors.push({ code: 'validateFailed', path: `data.${key}`, message: String(e && e.message ? e.message : e) });
        continue;
      }

      if (result && result.ok === false) {
        const sub = Array.isArray(result.errors) ? result.errors : [];
        if (sub.length === 0) {
          errors.push({ code: 'invalidSection', path: `data.${key}`, message: '快照段校验失败' });
        } else {
          errors.push(...sub.map(e => ({ ...e, path: `data.${key}.${e.path || ''}`.replace(/\.$/, '') })));
        }
      }
    }

    return { ok: errors.length === 0, errors };
  }

  /**
   * 应用迁移器把旧版本快照升级到当前版本
   * @param {Object} snapshot
   * @returns {{ok: boolean, snapshot?: Object, errors: Array<Object>}}
   */
  migrate(snapshot) {
    if (!snapshot || typeof snapshot.version !== 'number') {
      return { ok: false, errors: [{ code: 'missingField', path: 'version', message: '缺少快照版本' }] };
    }

    let current = snapshot;
    let guard = 0;

    while (current.version < SNAPSHOT_VERSION) {
      const migration = this.migrations[current.version];
      if (typeof migration !== 'function') {
        return {
          ok: false,
          errors: [{
            code: 'missingMigration',
            path: 'version',
            message: `缺少从版本 ${current.version} 升级的迁移器`
          }]
        };
      }

      try {
        current = migration(current);
      } catch (e) {
        return {
          ok: false,
          errors: [{ code: 'migrationFailed', path: 'version', message: String(e && e.message ? e.message : e) }]
        };
      }

      if (++guard > 32) {
        return { ok: false, errors: [{ code: 'migrationLoop', path: 'version', message: '迁移次数异常' }] };
      }
    }

    return { ok: true, snapshot: current, errors: [] };
  }

  /**
   * 原子恢复：先整体校验，再依次写入；任一 restore 失败则回滚。
   *
   * @param {Object} snapshot
   * @returns {{ok: boolean, errors: Array<Object>, restored?: Array<string>}}
   */
  restore(snapshot) {
    const migrated = this.migrate(snapshot);
    if (!migrated.ok) return { ok: false, errors: migrated.errors };

    const target = migrated.snapshot;

    // 第一段：只校验，不改运行状态
    const check = this.validate(target);
    if (!check.ok) return { ok: false, errors: check.errors };

    // 回滚快照：恢复失败时用它复原
    const rollback = this.capture({ label: 'rollback' });
    if (!rollback.ok) {
      return {
        ok: false,
        errors: [{ code: 'rollbackUnavailable', path: '', message: '无法采集回滚快照，已放弃恢复' }]
      };
    }

    // 第二段：写入运行状态
    const restored = [];
    for (const [key, provider] of this.providers) {
      const section = target.data[key];
      if (section === undefined) continue;

      let failure = null;
      try {
        const result = provider.restore(section);
        if (result && result.ok === false) {
          failure = Array.isArray(result.errors) && result.errors.length > 0
            ? result.errors
            : [{ code: 'restoreRejected', path: `data.${key}`, message: '恢复被拒绝' }];
        }
      } catch (e) {
        failure = [{ code: 'restoreFailed', path: `data.${key}`, message: String(e && e.message ? e.message : e) }];
      }

      if (failure) {
        // 当前 provider 可能在返回失败前已部分写入；必须连同它一起回滚。
        this._rollback(rollback.snapshot, [...restored, key]);
        return { ok: false, errors: failure };
      }

      restored.push(key);
    }

    return { ok: true, errors: [], restored };
  }

  /**
   * 回滚已写入的参与者
   * @private
   * @param {Object} snapshot - 加载前采集的快照
   * @param {Array<string>} restoredKeys
   */
  _rollback(snapshot, restoredKeys) {
    for (const key of [...restoredKeys].reverse()) {
      const provider = this.providers.get(key);
      const section = snapshot.data ? snapshot.data[key] : undefined;
      if (!provider || section === undefined) continue;

      try {
        provider.restore(section);
      } catch (e) {
        console.warn('SnapshotManager: 回滚失败', key, e);
      }
    }
  }

  // ---------------- 存储 ----------------

  /**
   * 保存到存储适配器
   * @param {string} slot - 存档槽标识
   * @param {Object} [meta]
   * @returns {{ok: boolean, errors: Array<Object>, snapshot?: Object}}
   */
  save(slot, meta = {}) {
    if (!this.storage) {
      return { ok: false, errors: [{ code: 'noStorage', path: '', message: '未配置存储适配器' }] };
    }

    const captured = this.capture(meta);
    if (!captured.ok) return captured;

    const result = this.storage.save(slot, captured.snapshot);
    if (result && result.ok === false) return result;

    return { ok: true, errors: [], snapshot: captured.snapshot };
  }

  /**
   * 从存储读取并原子恢复。
   * 校验失败时保留原存档且不修改运行状态。
   *
   * @param {string} slot
   * @returns {{ok: boolean, errors: Array<Object>, restored?: Array<string>}}
   */
  load(slot) {
    if (!this.storage) {
      return { ok: false, errors: [{ code: 'noStorage', path: '', message: '未配置存储适配器' }] };
    }

    const loaded = this.storage.load(slot);
    if (!loaded || loaded.ok === false) {
      return {
        ok: false,
        errors: (loaded && loaded.errors) || [{ code: 'loadFailed', path: slot, message: '读取存档失败' }]
      };
    }

    return this.restore(loaded.snapshot !== undefined ? loaded.snapshot : loaded);
  }
}

export default SnapshotManager;
