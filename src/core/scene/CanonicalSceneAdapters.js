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

import { ContentErrorCategory } from '../validation/ContentOperationResult.js';

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/** 基于 fetch 的只读磁盘适配器；响应正文留给 CanonicalCandidatePipeline 解析。 */
export class FetchDiskSceneAdapter {
  constructor({
    projectUrl = 'game.project.json',
    sceneBaseUrl = 'assets/scenes/',
    fetchImpl
  } = {}) {
    const boundFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch?.bind?.(globalThis);
    if (typeof boundFetch !== 'function') throw new TypeError('FetchDiskSceneAdapter requires fetch');
    this.projectUrl = projectUrl;
    this.sceneBaseUrl = sceneBaseUrl.endsWith('/') ? sceneBaseUrl : `${sceneBaseUrl}/`;
    this.fetchImpl = boundFetch;
  }

  readProject(options) { return this._read(this.projectUrl, options); }
  readSceneOrder(options) { return this._read(`${this.sceneBaseUrl}_scene_order.json`, options); }
  readScene(sceneId, options) { return this._read(`${this.sceneBaseUrl}${encodeURIComponent(sceneId)}.json`, options); }

  async _read(source, { signal = null } = {}) {
    let response;
    try {
      response = await this.fetchImpl(source, { cache: 'no-store', signal });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      return { ok: false, source, category: ContentErrorCategory.UNREADABLE, error };
    }
    if (!response?.ok) {
      const category = response?.status === 404
        ? ContentErrorCategory.MISSING
        : ContentErrorCategory.UNREADABLE;
      return { ok: false, source, category, status: response?.status ?? null };
    }
    try {
      const content = await response.text();
      const headerRevision = response.headers?.get?.('etag') || response.headers?.get?.('last-modified');
      return { ok: true, source, content, revision: headerRevision || hashText(content) };
    } catch (error) {
      return { ok: false, source, category: ContentErrorCategory.UNREADABLE, error };
    }
  }
}

/** 带 provenance 的 localStorage 缓存；旧编辑器场景数组不会被当作 canonical cache。 */
export class LocalStorageSceneCacheAdapter {
  constructor({ gameId, storage = globalThis.localStorage, keyPrefix = 'yijian18-engine_canonical_scene_cache_' } = {}) {
    if (!gameId) throw new TypeError('LocalStorageSceneCacheAdapter requires gameId');
    this.gameId = gameId;
    this.storage = storage;
    this.key = `${keyPrefix}${gameId}`;
  }

  get(sceneId) { return clone(this._read()[sceneId] || null); }
  keys() { return Object.keys(this._read()); }

  set(sceneId, entry) {
    const state = this._read();
    state[sceneId] = clone(entry);
    this._write(state);
  }

  delete(sceneId) {
    const state = this._read();
    if (!Object.prototype.hasOwnProperty.call(state, sceneId)) return false;
    delete state[sceneId];
    this._write(state);
    return true;
  }

  markIneligible(sceneId, reason) {
    const state = this._read();
    if (!state[sceneId]) return false;
    state[sceneId] = { ...state[sceneId], eligible: false, ineligibleReason: reason };
    this._write(state);
    return true;
  }
  _read() {
    if (!this.storage) return {};
    try {
      const parsed = JSON.parse(this.storage.getItem(this.key) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  _write(value) {
    if (!this.storage) throw new Error('localStorage is unavailable');
    this.storage.setItem(this.key, JSON.stringify(value));
  }
}

/** 测试、宿主或编辑器可注入的内存缓存实现。 */
export class MemorySceneCacheAdapter {
  constructor(entries = {}) { this.entries = clone(entries); }
  get(sceneId) { return clone(this.entries[sceneId] || null); }
  keys() { return Object.keys(this.entries); }
  set(sceneId, entry) { this.entries[sceneId] = clone(entry); }
  delete(sceneId) { const found = sceneId in this.entries; delete this.entries[sceneId]; return found; }
  markIneligible(sceneId, reason) {
    if (!this.entries[sceneId]) return false;
    this.entries[sceneId].eligible = false;
    this.entries[sceneId].ineligibleReason = reason;
    return true;
  }
}
