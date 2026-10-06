/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { PlaceholderAssets } from './PlaceholderAssets.js';
import { AudioManager } from './AudioManager.js';
import { parseSkeletonAsset } from '../animation/SkeletonAsset.js';

/**
 * 资源管理器
 * 负责加载和管理游戏资源（图片、音频等）
 */
export class AssetManager {
    constructor(config = {}) {
        // 资源缓存
        this.images = new Map();
        this.audio = new Map();

        // 加载队列
        this.loadQueue = [];
        this.loadedCount = 0;
        this.totalCount = 0;

        // 加载状态
        this.isLoading = false;
        this.loadProgress = 0;

        // 精灵图集数据
        this.spriteSheets = new Map();

        // 稳定资源 Manifest：条目可同时由 assetId 和 imageId 查询。
        this.manifestEntries = new Map();
        this.manifestAliases = new Map();
        this._manifestQueuedKeys = new Set();
        this._inflightAssets = new Map();
        this._inflightImages = new Map();
        this._failedImageLoads = new Set();
        // 骨骼动画资产缓存：stableId -> parseSkeletonAsset 产物（懒加载）
        this.skeletonAssets = new Map();
        this._inflightSkeletons = new Map();
        this._failedSkeletonLoads = new Set();
        this._activeLoadBatches = 0;
        this._loadGeneration = 0;
        this._loadProgressListeners = new Set();

        // 占位符资源生成器
        this.placeholderAssets = new PlaceholderAssets();

        // 音频管理器
        this.audioManager = new AudioManager();

        // 资源基础路径（默认空字符串，所有路径相对于 HTML 页面）
        this.assetBasePath = '';
        this.setAssetBasePath(config.assetBasePath || '');
    }

    /**
     * 设置资源基础路径
     * 用于 demo/示例项目隔离引擎代码中的硬编码路径
     * @param {string} basePath - 基础路径，如 'assets/' 或 'assets/images/'
     */
    setAssetBasePath(basePath) {
        // 保证以 / 结尾
        if (basePath && !basePath.endsWith('/')) {
            basePath += '/';
        }
        this.assetBasePath = basePath || '';
    }

    /**
     * 拼接资源完整路径。若 Manifest 已给出带基础目录的工程路径，不重复拼接。
     * @param {string} relativePath - 相对路径
     * @returns {string} 完整路径
     */
    resolveAssetPath(relativePath) {
        if (!relativePath) return relativePath;
        if (/^(https?:|data:|blob:|\/)/.test(relativePath)) return relativePath;
        if (this.assetBasePath && relativePath.startsWith(this.assetBasePath)) return relativePath;
        return this.assetBasePath + relativePath;
    }

    /**
     * 注册经过内容校验的 Asset Manifest。默认只建立稳定 ID 索引，不触发 I/O；
     * 旧调用方如确需全量队列，必须显式传入 enqueueImages:true。
     * @param {{assets:Array<Object>}} manifest
     * @param {{basePath?:string,enqueueImages?:boolean}} options
     * @returns {{registered:number,indexed:number,queued:number}}
     */
    registerManifest(manifest, { basePath = '', enqueueImages = false } = {}) {
        if (!manifest || !Array.isArray(manifest.assets)) {
            throw new TypeError('AssetManager.registerManifest: manifest.assets 必须是数组');
        }
        if (!this._multiBackendAssets) this._multiBackendAssets = new Map();

        let registered = 0;
        let indexed = 0;
        let queued = 0;
        for (const entry of manifest.assets) {
            if (!entry?.assetId) continue;
            const ids = [entry.assetId, entry.imageId].filter(Boolean);
            const key = entry.imageId || entry.assetId;
            for (const id of ids) {
                this.manifestEntries.set(id, entry);
                this.manifestAliases.set(id, key);
                indexed++;
            }
            registered++;

            if (entry.runtime2D?.mode !== 'image' || !entry.runtime2D.path) continue;
            const rawPath = `${basePath || ''}${entry.runtime2D.path}`;
            const url = this.resolveAssetPath(rawPath);
            const descriptor = { name: key, key, type: 'image', url, backends: ['2d', '3d'], manifestEntry: entry };
            for (const id of ids) this._multiBackendAssets.set(id, [descriptor]);

            if (!enqueueImages) continue;
            const alreadyQueued = this._manifestQueuedKeys.has(key)
                || this.loadQueue.some(asset => asset.type === 'image' && asset.key === key);
            if (!this.images.has(key) && !alreadyQueued) {
                this.addImage(key, url);
                this._manifestQueuedKeys.add(key);
                queued++;
            }
        }
        return { registered, indexed, queued };
    }

    /** @returns {Object|null} */
    getManifestEntry(assetIdOrImageId) {
        return this.manifestEntries.get(assetIdOrImageId) || null;
    }

    /**
     * 将稳定 ID 解析为可加载的运行时描述符，不把 ID 当作 URL。
     * @param {string} assetIdOrImageId
     * @param {'2d'|'3d'} mode
     * @returns {Object|null}
     */
    resolveManifestAsset(assetIdOrImageId, mode = '2d') {
        const entry = this.getManifestEntry(assetIdOrImageId);
        if (!entry) return null;
        if (mode === '3d' && entry.runtime3D?.mode === 'model' && entry.runtime3D.path) {
            return {
                key: entry.assetId,
                assetId: entry.assetId,
                imageId: entry.imageId || null,
                type: 'gltf',
                mode: '3d',
                url: this.resolveAssetPath(entry.runtime3D.path),
                entry
            };
        }
        const runtime = entry.runtime2D;
        if (!runtime?.path) return null;
        return {
            key: entry.imageId || entry.assetId,
            assetId: entry.assetId,
            imageId: entry.imageId || null,
            type: runtime.mode,
            mode: '2d',
            url: this.resolveAssetPath(runtime.path),
            entry
        };
    }

    /**
     * 添加图片资源到加载队列
     * @param {string} key - 资源键名
     * @param {string} url - 资源URL
     */
    addImage(key, url) {
        this.loadQueue.push({
            type: 'image',
            key,
            url
        });
        this.totalCount++;
    }

    /**
     * 添加音频资源到加载队列
     * @param {string} key - 资源键名
     * @param {string} url - 资源URL
     */
    addAudio(key, url) {
        this.loadQueue.push({
            type: 'audio',
            key,
            url
        });
        this.totalCount++;
    }

    /**
     * 添加精灵图集
     * @param {string} key - 图集键名
     * @param {object} data - 图集数据
     */
    addSpriteSheet(key, data) {
        this.spriteSheets.set(key, data);
    }

    /**
     * 加载所有队列中的资源
     * @returns {Promise<void>}
     */
    async loadAll() {
        if (this.loadQueue.length === 0) {
            console.log('AssetManager: No assets to load');
            return;
        }

        const batch = this.loadQueue.splice(0, this.loadQueue.length);
        this._beginLoadBatch(batch.length);

        console.log(`AssetManager: Loading ${batch.length} queued assets...`);

        const promises = batch.map(async asset => {
            await this.loadAssetWithFallback(asset);
            this._markLoadItemComplete();
        });

        try {
            await Promise.all(promises);
            console.log('AssetManager: All queued assets loaded successfully');
        } catch (error) {
            console.error('AssetManager: Failed to load some assets', error);

            // 尝试加载占位符资源作为降级方案
            console.warn('AssetManager: Loading placeholder assets as fallback');
            this.loadPlaceholderAssets();
        } finally {
            this._endLoadBatch();
        }
    }

    /**
     * 加载资源并提供降级方案
     * @param {object} asset - 资源对象
     * @returns {Promise<void>}
     */
    async loadAssetWithFallback(asset) {
        try {
            await this.loadAsset(asset);
        } catch (error) {
            console.warn(`AssetManager: Failed to load ${asset.key}, using fallback`, error);
            
            // 为失败的资源创建占位符
            if (asset.type === 'image') {
                this.createFallbackImage(asset.key);
            }
            
            // 继续加载，不抛出错误；批次进度由调用方统一提交。
        }
    }

    /**
     * 为失败的图片创建降级占位符
     * @param {string} key - 资源键名
     */
    createFallbackImage(key) {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        
        // 绘制简单的占位符
        ctx.fillStyle = '#ff6b6b';
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Missing', 32, 28);
        ctx.fillText('Asset', 32, 42);
        
        this.images.set(key, canvas);
        console.log(`AssetManager: Created fallback image for ${key}`);
    }

    /**
     * 加载单个资源。字符串参数按 Manifest 稳定 ID 解析；对象参数保留旧队列兼容。
     * @param {object|string} asset - 资源描述符或稳定 assetId/imageId
     * @param {{mode?:'2d'|'3d',signal?:AbortSignal,required?:boolean}} options
     * @returns {Promise<*>}
     */
    async loadAsset(asset, { mode = '2d', signal = null, required = true } = {}) {
        const manifestRequest = typeof asset === 'string';
        const descriptor = manifestRequest ? this.resolveManifestAsset(asset, mode) : asset;
        if (!descriptor?.key || !descriptor?.type || !descriptor?.url) {
            if (!required) return null;
            throw new Error(`AssetManager: 未找到可加载资源 ${String(asset)}`);
        }
        if (signal?.aborted) throw new Error(`AssetManager: 资源加载已取消 ${descriptor.key}`);

        const key = this.manifestAliases.get(descriptor.key) || descriptor.key;
        const cached = descriptor.type === 'audio' ? this.audio.get(key) : this.images.get(key);
        if (cached) return cached;

        const inflightKey = `${descriptor.type}:${key}`;
        let promise = this._inflightAssets.get(inflightKey);
        if (!promise) {
            promise = (async () => {
                if (descriptor.type === 'image' || descriptor.type === 'texture' || descriptor.type === 'atlas') {
                    return this.loadImage(key, descriptor.url);
                }
                if (descriptor.type === 'skeleton') return this.loadSkeletonAsset(key, descriptor.url);
                if (descriptor.type === 'audio') return this.loadAudioFile(key, descriptor.url);
                throw new Error(`AssetManager: 不支持按需加载类型 ${descriptor.type}`);
            })();
            this._inflightAssets.set(inflightKey, promise);
            promise.finally(() => {
                if (this._inflightAssets.get(inflightKey) === promise) this._inflightAssets.delete(inflightKey);
            }).catch(() => {});
        }

        try {
            const result = await promise;
            if (signal?.aborted) throw new Error(`AssetManager: 资源加载已取消 ${key}`);
            return result;
        } catch (error) {
            console.error(`AssetManager: Failed to load ${key}`, error);
            throw error;
        }
    }

    /** 按稳定 ID 并行加载一个 chunk 所需资源；不会扫描或加载整个 Manifest。 */
    async loadAssets(assetIds, options = {}) {
        const candidates = assetIds == null
            ? []
            : typeof assetIds[Symbol.iterator] === 'function'
                ? [...assetIds]
                : [];
        const ids = [...new Set(candidates
            .filter(id => typeof id === 'string' && id.trim())
            .map(id => id.trim()))];
        if (ids.length === 0) return { loaded: [], count: 0 };
        this._beginLoadBatch(ids.length);
        console.log(`AssetManager: Loading ${ids.length} targeted assets...`);
        try {
            const loaded = await Promise.all(ids.map(async id => {
                const result = await this.loadAsset(id, options);
                this._markLoadItemComplete();
                console.log(`AssetManager: Loaded ${id} (${this.loadedCount}/${this.totalCount})`);
                return result;
            }));
            console.log('AssetManager: Targeted assets loaded successfully');
            return { loaded, count: loaded.length };
        } finally {
            this._endLoadBatch();
        }
    }

    /**
     * 返回当前真实资源批次的只读快照。
     * @returns {{completed:number,total:number,progress:number,isLoading:boolean}}
     */
    getLoadSnapshot() {
        const completed = Math.max(0, Number(this.loadedCount) || 0);
        const total = Math.max(0, Number(this.totalCount) || 0);
        const progress = total > 0 ? Math.min(1, completed / total) : 0;
        return Object.freeze({
            completed,
            total,
            progress,
            isLoading: this.isLoading
        });
    }

    /**
     * 订阅真实资源批次进度；返回的函数用于注销监听。
     * @param {(snapshot:{completed:number,total:number,progress:number,isLoading:boolean})=>void} listener
     * @returns {()=>void}
     */
    onLoadProgress(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('AssetManager.onLoadProgress: listener 必须是函数');
        }
        this._loadProgressListeners.add(listener);
        return () => this._loadProgressListeners.delete(listener);
    }

    _emitLoadProgress() {
        if (this._loadProgressListeners.size === 0) return;
        const snapshot = this.getLoadSnapshot();
        for (const listener of [...this._loadProgressListeners]) {
            try {
                listener(snapshot);
            } catch (error) {
                console.warn('AssetManager: load progress listener failed', error);
            }
        }
    }

    _beginLoadBatch(total) {
        if (this._activeLoadBatches === 0) {
            this.loadedCount = 0;
            this.totalCount = 0;
            this.loadProgress = 0;
        }
        this._activeLoadBatches++;
        this.totalCount += Math.max(0, Number(total) || 0);
        this.isLoading = true;
        this._emitLoadProgress();
    }

    _markLoadItemComplete() {
        this.loadedCount++;
        this.loadProgress = this.totalCount > 0 ? this.loadedCount / this.totalCount : 1;
        this._emitLoadProgress();
    }

    _endLoadBatch() {
        this._activeLoadBatches = Math.max(0, this._activeLoadBatches - 1);
        this.isLoading = this._activeLoadBatches > 0;
        if (!this.isLoading && this.totalCount > 0) {
            this.loadProgress = this.loadedCount / this.totalCount;
        }
        this._emitLoadProgress();
    }

    /**
     * 加载图片资源
     * @param {string} key - 资源键名
     * @param {string} url - 图片URL
     * @returns {Promise<HTMLImageElement>}
     */
    loadImage(key, url) {
        const resolvedKey = this.manifestAliases.get(key) || key;
        const cached = this.images.get(resolvedKey);
        if (cached) return Promise.resolve(cached);
        const existing = this._inflightImages.get(resolvedKey);
        if (existing) return existing;

        const generation = this._loadGeneration;
        const promise = new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                if (generation !== this._loadGeneration) {
                    reject(new Error(`AssetManager: 已取消过期图片加载 ${resolvedKey}`));
                    return;
                }
                this.images.set(resolvedKey, img);
                resolve(img);
            };

            img.onerror = () => {
                reject(new Error(`Failed to load image: ${url}`));
            };

            img.src = url;
        });
        this._inflightImages.set(resolvedKey, promise);
        promise.finally(() => {
            if (this._inflightImages.get(resolvedKey) === promise) this._inflightImages.delete(resolvedKey);
        }).catch(() => {});
        return promise;
    }

    /**
     * 加载音频资源
     * @param {string} key - 资源键名
     * @param {string} url - 音频URL
     * @returns {Promise<HTMLAudioElement>}
     */
    loadAudioFile(key, url) {
        return new Promise((resolve, reject) => {
            const audio = new Audio();
            
            audio.oncanplaythrough = () => {
                this.audio.set(key, audio);
                resolve(audio);
            };
            
            audio.onerror = () => {
                reject(new Error(`Failed to load audio: ${url}`));
            };
            
            audio.src = url;
        });
    }

    /**
     * 获取图片资源
     * @param {string} key - 资源键名
     * @returns {HTMLImageElement|null}
     */
    getImage(key) {
        const resolvedKey = this.manifestAliases.get(key) || key;
        const cached = this.images.get(resolvedKey);
        if (cached) return cached;
        // 清单已登记但尚未加载的图像按需补载（死亡掉落等运行期才首次渲染的资源）：
        // 本次仍返回 null 走手绘兜底，图到位后下一帧自然显示。
        // 已发起/进行中/已知失败的键不再重复告警（避免渲染期逐帧刷屏）；无法发起加载才告警。
        const requested = this._requestManifestImage(resolvedKey);
        if (!requested && !this._failedImageLoads.has(resolvedKey)) {
            console.warn(`AssetManager: Image '${key}' not found`);
        }
        return null;
    }

    /** 按 manifest 描述符按需加载图像（仅限 registerManifest 登记过的稳定 ID）。
     * @returns {Promise|null} 加载 Promise（已就位/进行中返回已完成 Promise）；无法发起时返回 null */
    _requestManifestImage(resolvedKey) {
        if (this._failedImageLoads.has(resolvedKey)) return null;
        if (this.images.has(resolvedKey)) return Promise.resolve();
        const inflight = this._inflightImages.get(resolvedKey);
        if (inflight) return inflight;
        const descriptor = this._multiBackendAssets?.get(resolvedKey)?.find(entry => entry?.type === 'image' && entry?.url);
        const url = descriptor?.url;
        if (!url) return null;
        const promise = this.loadImage(resolvedKey, url).catch(error => {
            this._failedImageLoads.add(resolvedKey);
            console.warn(`AssetManager: 图片按需加载失败 '${resolvedKey}'`, error?.message || error);
        });
        return promise;
    }

    /**
     * 获取骨骼动画资产（parseSkeletonAsset 产物）。
     * 未加载时触发异步加载，本帧返回 null（渲染走兜底，到位后自然显示）。
     * @param {string} assetIdOrImageId - 骨骼资产稳定 ID
     * @returns {Object|null}
     */
    getSkeletonAsset(assetIdOrImageId) {
        const resolvedKey = this.manifestAliases.get(assetIdOrImageId) || assetIdOrImageId;
        const cached = this.skeletonAssets.get(resolvedKey);
        if (cached) return cached;
        this._requestSkeletonAsset(resolvedKey);
        return null;
    }

    _requestSkeletonAsset(resolvedKey) {
        if (this._failedSkeletonLoads.has(resolvedKey)) return;
        if (this.skeletonAssets.has(resolvedKey) || this._inflightSkeletons.has(resolvedKey)) return;
        const entry = this.getManifestEntry(resolvedKey);
        if (entry?.runtime2D?.mode !== 'skeleton' || !entry.runtime2D.path) return;
        const url = this.resolveAssetPath(entry.runtime2D.path);
        const promise = this.loadSkeletonAsset(resolvedKey, url);
        this._inflightSkeletons.set(resolvedKey, promise);
        promise.finally(() => {
            if (this._inflightSkeletons.get(resolvedKey) === promise) this._inflightSkeletons.delete(resolvedKey);
        }).catch(() => {});
    }

    /** 拉取并解析骨骼 JSON；附件引用的图片全部热加载完成后才对外发布资产，
     *  保证首次渲染时部件/body 贴图必然就位（避免渲染期按需补载的首帧缺口）。 */
    async loadSkeletonAsset(key, url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const doc = await response.json();
            const parsed = parseSkeletonAsset(doc);
            if (!parsed) throw new Error('骨骼资产结构无效');
            const imageWaits = [];
            for (const slot of parsed.slots) {
                const ref = slot.attachment?.assetId || slot.attachment?.spriteSheet;
                if (!ref) continue;
                const alias = this.manifestAliases.get(ref) || ref;
                const pending = this._requestManifestImage(alias);
                if (pending) imageWaits.push(pending.catch(() => {}));
            }
            if (imageWaits.length > 0) await Promise.all(imageWaits);
            this.skeletonAssets.set(key, parsed);
            return parsed;
        } catch (error) {
            this._failedSkeletonLoads.add(key);
            console.error(`AssetManager: 骨骼资产加载失败 ${key}`, error);
            throw error;
        }
    }

    /**
     * 获取资源（getImage的别名，用于兼容）
     * 阶段 A：保持现有行为；支持可选 mode 参数用于多后端资源选择
     * @param {string} key - 资源键名
     * @param {'2d'|'3d'} [mode] - 期望的后端模式
     * @returns {HTMLImageElement|null}
     */
    getAsset(key, mode) {
        // 多后端注册表优先
        if (this._multiBackendAssets) {
            const entry = this._multiBackendAssets.get(key);
            if (entry) {
                const matched = this._pickBackendVariant(entry, mode);
                if (matched) return matched;
            }
        }
        return this.getImage(key);
    }

    /**
     * 注册多后端资源
     * @param {string} name
     * @param {{ type: 'image'|'texture'|'gltf'|'audio', url: string, backends?: ('2d'|'3d')[] }} desc
     */
    registerAsset(name, desc) {
        if (!desc) return;
        if (!this._multiBackendAssets) this._multiBackendAssets = new Map();
        const arr = this._multiBackendAssets.get(name) || [];
        arr.push({ ...desc, name, backends: desc.backends || ['2d', '3d'] });
        this._multiBackendAssets.set(name, arr);

        // 约定：image/texture 类型会在 loadAll 时加载到 this.images
        if (desc.type === 'image' || desc.type === 'texture') {
            this.addImage(name, desc.url);
        }
    }

    /**
     * 从注册表中选择一份与 mode 匹配的条目对应的已加载资源
     * @private
     */
    _pickBackendVariant(entries, mode) {
        if (!mode) return null;
        for (const entry of entries) {
            if (entry.backends.includes(mode)) {
                // 目前主要支持图像资源；后续 M6+ 可扩展 glTF/Texture
                if (entry.type === 'image' || entry.type === 'texture') {
                    return this.images.get(entry.url) || this.images.get(entry.name) || null;
                }
            }
        }
        return null;
    }

    /**
     * 获取音频资源
     * @param {string} key - 资源键名
     * @returns {HTMLAudioElement|null}
     */
    getAudio(key) {
        if (!this.audio.has(key)) {
            console.warn(`AssetManager: Audio '${key}' not found`);
            return null;
        }
        return this.audio.get(key);
    }

    /**
     * 获取精灵图集
     * @param {string} key - 图集键名
     * @returns {object|null}
     */
    getSpriteSheet(key) {
        if (!this.spriteSheets.has(key)) {
            console.warn(`AssetManager: Sprite sheet '${key}' not found`);
            return null;
        }
        return this.spriteSheets.get(key);
    }

    /**
     * 获取加载进度
     * @returns {number} 0-1之间的进度值
     */
    getProgress() {
        return this.loadProgress;
    }

    /**
     * 检查资源是否已加载
     * @param {string} key - 资源键名
     * @returns {boolean}
     */
    hasImage(key) {
        return this.images.has(this.manifestAliases.get(key) || key);
    }

    /**
     * 检查音频是否已加载
     * @param {string} key - 资源键名
     * @returns {boolean}
     */
    hasAudio(key) {
        return this.audio.has(key);
    }

    /**
     * 清除所有资源
     */
    clear() {
        this.images.clear();
        this.audio.clear();
        this.spriteSheets.clear();
        this.manifestEntries.clear();
        this.manifestAliases.clear();
        this._manifestQueuedKeys.clear();
        this._loadGeneration++;
        this._inflightAssets.clear();
        this._inflightImages.clear();
        this._activeLoadBatches = 0;
        this.isLoading = false;
        this._multiBackendAssets?.clear?.();
        this.loadQueue = [];
        this.loadedCount = 0;
        this.totalCount = 0;
        this.loadProgress = 0;
        this._emitLoadProgress();
        console.log('AssetManager: All assets cleared');
    }

    /**
     * 清除特定资源
     * @param {string} key - 资源键名
     */
    remove(key) {
        const resolvedKey = this.manifestAliases.get(key) || key;
        this.images.delete(resolvedKey);
        this.audio.delete(key);
        this.spriteSheets.delete(key);
        this._manifestQueuedKeys.delete(resolvedKey);
    }

    /**
     * 生成并加载占位符资源
     * 用于快速开发，无需外部图片文件
     */
    loadPlaceholderAssets() {
        console.log('AssetManager: Loading placeholder assets...');

        // 加载4x8动画精灵（玩家角色）
        this.loadAnimatedSpriteImage('player_animated', this.resolveAssetPath('images/girl.png'));

        // 九宫格方向精灵（用于玩家）
        const characterClasses = ['warrior', 'strategist', 'archer', 'refugee'];
        characterClasses.forEach(className => {
            // 尝试加载真实图片，如果失败则使用占位符
            const realImagePath = this.resolveAssetPath(`images/${className}.png`);
            this.loadDirectionalSpriteImage(className, realImagePath);
            
            // 保留旧的单帧精灵作为备用
            const sprite = this.placeholderAssets.createCharacterSprite(className, 64);
            this.images.set(`character_${className}`, sprite);
        });

        // 敌人精灵（4x8动画格式）
        const animatedEnemyTypes = ['wild_dog', 'soldier', 'government_soldier', 'bandit', 'starving', 'refugee'];
        animatedEnemyTypes.forEach(enemyType => {
            const sprite = this.placeholderAssets.createAnimatedEnemySprite(enemyType, 64);
            this.images.set(`enemy_animated_${enemyType}`, sprite);
        });

        // 敌人精灵（旧格式备用）
        const enemyTypes = ['slime', 'goblin', 'skeleton'];
        enemyTypes.forEach(enemyType => {
            const sprite = this.placeholderAssets.createEnemySprite(enemyType, 64);
            this.images.set(`enemy_${enemyType}`, sprite);
        });

        // 技能图标
        const skills = ['attack', 'fireball', 'heal', 'shield', 'arrow', 'frost'];
        skills.forEach(skillName => {
            const icon = this.placeholderAssets.createSkillIcon(skillName, 48);
            this.images.set(`skill_${skillName}`, icon);
        });

        // UI元素
        const uiElements = [
            { type: 'healthbar_bg', width: 200, height: 20 },
            { type: 'healthbar_fill', width: 196, height: 16 },
            { type: 'manabar_fill', width: 196, height: 16 },
            { type: 'button', width: 150, height: 40 },
            { type: 'panel', width: 300, height: 200 }
        ];
        uiElements.forEach(({ type, width, height }) => {
            const element = this.placeholderAssets.createUIElement(type, width, height);
            this.images.set(`ui_${type}`, element);
        });

        // 粒子纹理
        const particleTypes = ['fire', 'heal', 'frost', 'spark'];
        particleTypes.forEach(particleType => {
            const texture = this.placeholderAssets.createParticleTexture(particleType, 16);
            this.images.set(`particle_${particleType}`, texture);
        });

        console.log('AssetManager: Placeholder assets loaded successfully');
        console.log('AssetManager: 已加载的图片资源:', Array.from(this.images.keys()));
    }

    /**
     * 加载九宫格方向精灵图片
     * @param {string} className - 职业名称
     * @param {string} imagePath - 图片路径
     */
    loadDirectionalSpriteImage(className, imagePath) {
        const key = `directional_${className}`;
        
        // 先设置占位符
        const placeholder = this.placeholderAssets.createDirectionalSprite(className, 32);
        this.images.set(key, placeholder);
        
        // 尝试加载真实图片
        const img = new Image();
        img.onload = () => {
            this.images.set(key, img);
            console.log(`AssetManager: 成功加载真实精灵图 ${key} (${img.width}x${img.height})`);
        };
        img.onerror = () => {
            console.log(`AssetManager: 无法加载 ${imagePath}，使用占位符`);
        };
        img.src = imagePath;
    }

    /**
     * 加载4x9动画精灵图片
     * @param {string} key - 资源键名
     * @param {string} imagePath - 图片路径
     */
    loadAnimatedSpriteImage(key, imagePath) {
        // 先设置4x8占位符canvas，避免加载期间 getImage 返回 null
        const placeholder = this.placeholderAssets.createAnimatedEnemySprite('refugee', 64);
        this.images.set(key, placeholder);
        
        // 尝试加载真实图片
        const img = new Image();
        img.onload = () => {
            this.images.set(key, img);
            console.log(`AssetManager: 成功加载动画精灵图 ${key} (${img.width}x${img.height})`);
        };
        img.onerror = () => {
            console.log(`AssetManager: 无法加载 ${imagePath}，使用占位符渲染`);
        };
        img.src = imagePath;
    }

    /**
     * 获取占位符资源生成器
     * @returns {PlaceholderAssets}
     */
    getPlaceholderAssets() {
        return this.placeholderAssets;
    }

    /**
     * 获取音频管理器
     * @returns {AudioManager}
     */
    getAudioManager() {
        return this.audioManager;
    }

    /**
     * 加载占位符音效
     * 注意：这些是占位符，实际游戏应该使用真实的音频文件
     */
    loadPlaceholderSounds() {
        console.log('AudioManager: Placeholder sounds would be loaded here');
        console.log('Note: Actual audio files should be added to assets/audio/ directory');
        
        // 示例：如果有真实音频文件，可以这样加载
        // this.audioManager.addSound('attack', 'assets/audio/attack.mp3');
        // this.audioManager.addSound('skill', 'assets/audio/skill.mp3');
        // this.audioManager.addMusic('bgm', 'assets/audio/background.mp3');
    }
}
