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

// 存档持久化核心：缩略图采集/存档元数据/文件镜像/手动保存。抽取自 example/sanguo_zhangjiao/index.html，跨模块状态经 shell 宿主读写。
export function createSaveStorageCore(shell) {
const SAVE_FILES_ROOT = 'example/sanguo_zhangjiao/saves';
const SAVE_SLOT_ID_PATTERN = /^(?:autosave-[1-3]|slot-(?:[1-9]\d?|100))$/;
let lastRenderedSavePreview = null;
let savePreviewCaptureInFlight = null;
let savePreviewCaptureGeneration = 0;
const renderedPreviewWaiters = new Set();

/** 生成不依赖主画布的保底缩略图，保证每个磁盘存档目录始终有图片文件。 */
function createFallbackSavePreview() {
    const preview = document.createElement('canvas');
    preview.width = 240;
    preview.height = 135;
    const previewContext = preview.getContext('2d');
    const gradient = previewContext.createLinearGradient(0, 0, preview.width, preview.height);
    gradient.addColorStop(0, '#6b4c27');
    gradient.addColorStop(1, '#182920');
    previewContext.fillStyle = gradient;
    previewContext.fillRect(0, 0, preview.width, preview.height);
    previewContext.fillStyle = 'rgba(255,255,255,.72)';
    previewContext.font = 'bold 18px sans-serif';
    previewContext.fillText('三国张角传', 18, 65);
    previewContext.font = '12px sans-serif';
    previewContext.fillText('存档缩略图', 18, 88);
    return preview.toDataURL('image/jpeg', 0.45);
}

/** 从主画布异步编码预览；仅由真实保存请求或首帧等待器调用。 */
async function encodeCanvasSavePreview() {
    if (!shell.canvas?.width || !shell.canvas?.height) return null;
    try {
        const preview = document.createElement('canvas');
        preview.width = 240;
        preview.height = 135;
        preview.getContext('2d').drawImage(shell.canvas, 0, 0, preview.width, preview.height);
        if (typeof preview.toBlob !== 'function') {
            return preview.toDataURL('image/jpeg', 0.45);
        }
        const blob = await new Promise(resolve => preview.toBlob(resolve, 'image/jpeg', 0.45));
        if (!blob) return null;
        return await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch (_error) {
        return null;
    }
}

/** 淡黑转场与首帧前的 Canvas 都不能作为存档封面来源。 */
function canUseCurrentFrameForSavePreview() {
    const current = shell.sceneManager?.getCurrentScene?.() || shell.scene;
    return !!(shell.gameStarted && current && !current._fadeOverlayTransition?.active);
}

/**
 * 主画布复制会触发同步缩放/GPU 回读，必须避开游戏 RAF。
 * requestIdleCallback 不可用时延后一个任务队列；保存仍等待同一 in-flight Promise。
 */
function deferSavePreviewCapture() {
    return new Promise(resolve => {
        const run = () => resolve();
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(run, { timeout: 750 });
        } else {
            setTimeout(run, 0);
        }
    });
}

/** 按需异步缓存有效画面，并唤醒等待首帧存档的调用方。 */
function updateRenderedSavePreview() {
    if (!canUseCurrentFrameForSavePreview()) return Promise.resolve(null);
    if (savePreviewCaptureInFlight) return savePreviewCaptureInFlight;
    const generation = savePreviewCaptureGeneration;
    const capture = deferSavePreviewCapture()
        .then(() => generation === savePreviewCaptureGeneration ? encodeCanvasSavePreview() : null)
        .then(preview => {
            if (!preview || generation !== savePreviewCaptureGeneration) return null;
            lastRenderedSavePreview = preview;
            for (const resolve of renderedPreviewWaiters) resolve(preview);
            renderedPreviewWaiters.clear();
            return preview;
        });
    const pending = capture.finally(() => {
        if (savePreviewCaptureInFlight === pending) savePreviewCaptureInFlight = null;
    });
    savePreviewCaptureInFlight = pending;
    return pending;
}

/** 保存发生时才刷新缩略图；转场期间复用上一张有效画面。 */
async function captureFreshSavePreview() {
    const preview = await updateRenderedSavePreview();
    return preview || lastRenderedSavePreview || createFallbackSavePreview();
}

/** 等待一张实际渲染的非转场画面；超时则由保底缩略图保证不出现黑图。 */
function waitForRenderedSavePreview(timeoutMs = 1500) {
    if (lastRenderedSavePreview) return Promise.resolve(lastRenderedSavePreview);
    return new Promise(resolve => {
        const onPreview = preview => {
            clearTimeout(timeout);
            renderedPreviewWaiters.delete(onPreview);
            resolve(preview);
        };
        const timeout = setTimeout(() => {
            renderedPreviewWaiters.delete(onPreview);
            resolve(lastRenderedSavePreview || createFallbackSavePreview());
        }, timeoutMs);
        renderedPreviewWaiters.add(onPreview);
    });
}

/** 优先复用最后一张完整帧，杜绝把透明首帧或淡黑遮罩写入存档。 */
function captureSavePreview() {
    return lastRenderedSavePreview || createFallbackSavePreview();
}

function currentSaveMeta() {
    const current = shell.sceneManager?.getCurrentScene?.() || shell.scene;
    const player = current?.playerEntity;
    const stats = player?.getComponent?.('stats');
    const name = player?.getComponent?.('name');
    const storySceneId = current?.gameLoader?.blackboard?.get?.('storyState')?.currentSceneId;
    const currentSceneId = current?.currentSceneId || storySceneId || 'S01';
    return {
        characterName: name?.name || name?.displayName || player?.name || '张角',
        level: stats?.level || 1,
        currentSceneId,
        location: current?.locationName || `${currentSceneId} 区域`,
        preview: captureSavePreview()
    };
}

function saveFilePath(slotId, fileName) {
    if (!SAVE_SLOT_ID_PATTERN.test(slotId)) throw new RangeError(`无效存档文件栏位: ${slotId}`);
    return `${SAVE_FILES_ROOT}/${slotId}/${fileName}`;
}

async function writeSaveFile(path, content, encoding = 'utf8') {
    try {
        const response = await fetch('/api/save-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, content, encoding })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
            return {
                ok: false,
                errors: [{ code: 'fileWriteFailed', path, message: payload.error || `文件保存失败 (${response.status})` }]
            };
        }
        return { ok: true, errors: [] };
    } catch (error) {
        return {
            ok: false,
            errors: [{ code: 'fileWriteUnavailable', path, message: String(error?.message || error) }]
        };
    }
}

/** 将完整快照和对应缩略图镜像到 Demo 存档目录；浏览器 IndexedDB 是运行时存档权威。 */
async function persistSaveFiles(slotId, snapshot) {
    if (!snapshot) {
        return { ok: false, errors: [{ code: 'missingSnapshot', path: slotId, message: '没有可写入文件的存档快照' }] };
    }
    const diskSnapshot = JSON.parse(JSON.stringify(snapshot));
    const preview = diskSnapshot.meta?.preview;
    const previewMatch = typeof preview === 'string'
        ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(preview)
        : null;
    if (!previewMatch) {
        return { ok: false, errors: [{ code: 'missingPreview', path: slotId, message: '当前画面缩略图不可用，未写入存档文件' }] };
    }

    const extension = previewMatch[1] === 'jpeg' ? 'jpg' : previewMatch[1];
    delete diskSnapshot.meta.preview;
    diskSnapshot.meta.previewFile = `thumbnail.${extension}`;
    const snapshotPath = saveFilePath(slotId, 'snapshot.json');
    const thumbnailPath = saveFilePath(slotId, diskSnapshot.meta.previewFile);
    const thumbnailWrite = await writeSaveFile(thumbnailPath, previewMatch[2], 'base64');
    if (!thumbnailWrite.ok) return thumbnailWrite;
    const snapshotWrite = await writeSaveFile(snapshotPath, JSON.stringify(diskSnapshot, null, 2));
    if (!snapshotWrite.ok) return snapshotWrite;
    return { ok: true, errors: [], snapshotPath, thumbnailPath };
}

async function saveCurrentGame({ silent = false } = {}) {
    if (!shell.gameStarted || !shell.scene?.playerEntity) return null;
    await shell.saveStorageReady;
    await captureFreshSavePreview();
    const result = await shell.saveGames.saveAsync(shell.activeSaveSlot, currentSaveMeta());
    if (!result.ok) {
        if (!silent) shell.setLoginMessage('手动保存失败，请稍后重试。');
        console.warn('手动保存失败', result.errors);
        return result;
    }
    const fileResult = await persistSaveFiles(shell.saveGames.slotId(shell.activeSaveSlot), result.snapshot);
    const completed = { ...result, ok: fileResult.ok, filePersisted: fileResult.ok, errors: [...result.errors, ...fileResult.errors] };
    if (!silent) {
        shell.setLoginMessage(fileResult.ok
            ? `已手动保存到栏位 ${shell.activeSaveSlot}`
            : '手动存档已写入 IndexedDB，但存档文件或缩略图保存失败。');
    }
    if (!fileResult.ok) console.warn('手动存档文件保存失败', fileResult.errors);
    return completed;
}

    /** initGame 重置缩略图管线：与原内联脚本 4 行重置逐行等价。 */
    function resetSavePreviewState() {
        lastRenderedSavePreview = null;
        savePreviewCaptureGeneration++;
        savePreviewCaptureInFlight = null;
        renderedPreviewWaiters.clear();
    }

    function hasRenderedPreviewWaiters() {
        return renderedPreviewWaiters.size > 0;
    }

    function isSavePreviewCaptureInFlight() {
        return Boolean(savePreviewCaptureInFlight);
    }

    return {
        resetSavePreviewState,
        hasRenderedPreviewWaiters,
        isSavePreviewCaptureInFlight,
        updateRenderedSavePreview,
        waitForRenderedSavePreview,
        captureFreshSavePreview,
        currentSaveMeta,
        persistSaveFiles,
        saveCurrentGame
    };
}
