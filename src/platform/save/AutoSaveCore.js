// 自动存档核心：串行队列/检查点调度/checkpoint 恢复。抽取自 example/sanguo_zhangjiao/index.html，跨模块状态经 shell 宿主读写。
export function createAutoSaveCore(shell) {
let autoSaveInFlight = null;
let autoSaveRequestSequence = 0;
let autoSaveQueueDraining = false;
const autoSaveQueue = [];
const autoSaveRequests = new Map();
const scheduledCheckpointIds = new Set();

/** 自动存档状态只通过游戏画面的 NotificationSystem 显示，不写入登录/系统菜单。 */
function showAutoSaveStatus(message, type = 'info') {
    const current = shell.sceneManager?.getCurrentScene?.() || shell.scene;
    const notifier = current?.notificationSystem || shell.notificationSystem;
    if (!notifier) return;
    if (type === 'success') notifier.addSuccess(message);
    else if (type === 'error') notifier.addError(message);
    else notifier.addNotification(message, 'info', 4500);
}

async function performAutoSave({ reason = 'unknown', checkpointId = null, sceneId = null, checkpointMode = 'bestEffort' } = {}) {
    showAutoSaveStatus('自动存档保存中...');
    try {
        await shell.captureFreshSavePreview();
    } catch (error) {
        // 缩略图只属于表现层；采集失败不能阻断业务事务或自动存档尝试。
        console.warn('自动存档预览采集失败，将继续保存状态', { reason, checkpointId, error });
    }
    const meta = shell.currentSaveMeta();
    meta.reason = reason;
    meta.checkpointMode = checkpointMode;
    if (checkpointId) meta.checkpointId = checkpointId;
    if (sceneId) meta.currentSceneId = sceneId;
    await shell.saveStorageReady;
    const result = await shell.saveGames.saveAutoAsync(meta);
    if (!result.ok) {
        // Snapshot 失败时 saveAuto 不会覆盖目标槽位；调用方决定该 checkpoint 是否可阻断流程。
        if (checkpointMode !== 'bestEffort') showAutoSaveStatus('自动存档保存失败', 'error');
        console.warn('自动保存失败，保留原自动槽位内容', { reason, checkpointId, errors: result.errors });
        return {
            ...result,
            ok: false,
            nonBlocking: checkpointMode === 'bestEffort',
            saved: false,
            checkpointSkipped: true,
            autoSaveFailed: true,
            errors: result.errors || []
        };
    }
    const fileResult = await shell.persistSaveFiles(result.autoSlotId, result.snapshot);
    const completed = {
        ...result,
        ok: true, // 文件镜像失败不阻断游戏流程，IndexedDB 已成功保存
        saved: true,
        filePersisted: fileResult.ok,
        errors: [...result.errors, ...fileResult.errors]
    };
    if (fileResult.ok) showAutoSaveStatus('自动存档保存成功', 'success');
    else {
        showAutoSaveStatus('自动存档已写入 IndexedDB', 'info');
        console.warn('自动存档文件镜像失败，但浏览器缓存已成功', {
            reason, checkpointId, errors: fileResult.errors
        });
    }
    return completed;
}

function checkpointSaveIdentity(options = {}) {
    const checkpointId = String(options.checkpointId || '').trim();
    if (!checkpointId) return null;
    const originOperationId = String(
        options.originOperationId || options.operationId || `checkpoint:${checkpointId}`
    ).trim();
    return `${originOperationId}:${checkpointId}`;
}

function isAuthorityBusySaveResult(result) {
    const busyCodes = new Set([
        'authoritySnapshotBusy',
        'authorityEventJournalBusy',
        'authorityNotificationDispatchBusy',
        'scenarioExecutionBusy',
        'rollbackUnavailable'
    ]);
    return (result?.errors || []).some(error => busyCodes.has(error?.code));
}

async function waitForCheckpointConsumers() {
    const runtime = shell.scene?.sceneRuntime;
    await runtime?.notificationBus?.waitForIdle?.();
    await shell.scene?.gameLoader?.triggerSystem?.waitForIdle?.();
}

async function performQueuedAutoSave(options = {}) {
    const checkpointId = String(options.checkpointId || '').trim();
    const retryDelays = checkpointId ? [0, 500, 1000, 2000] : [0];
    let result = null;
    for (const delay of retryDelays) {
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        if (checkpointId) await waitForCheckpointConsumers();
        result = await performAutoSave(options);
        if (result?.ok === true || !isAuthorityBusySaveResult(result)) return result;
    }
    return result;
}

async function drainAutoSaveQueue() {
    if (autoSaveQueueDraining) return;
    autoSaveQueueDraining = true;
    try {
        while (autoSaveQueue.length > 0) {
            const request = autoSaveQueue.shift();
            try {
                autoSaveInFlight = performQueuedAutoSave(request.options);
                const result = await autoSaveInFlight;
                request.resolve(result);
            } catch (error) {
                request.resolve({
                    ok: false,
                    saved: false,
                    code: error?.code || 'autoSaveFailed',
                    errors: [{
                        code: error?.code || 'autoSaveFailed',
                        path: 'game',
                        message: error?.message || String(error)
                    }]
                });
            } finally {
                autoSaveInFlight = null;
                if (request.identity && autoSaveRequests.get(request.identity) === request.promise) {
                    autoSaveRequests.delete(request.identity);
                }
            }
        }
    } finally {
        autoSaveQueueDraining = false;
        if (autoSaveQueue.length > 0) queueMicrotask(() => { void drainAutoSaveQueue(); });
    }
}

function enqueueAutoSave(options = {}) {
    const checkpointIdentity = checkpointSaveIdentity(options);
    const identity = checkpointIdentity || `auto-save:${++autoSaveRequestSequence}`;
    if (checkpointIdentity && autoSaveRequests.has(identity)) {
        return autoSaveRequests.get(identity);
    }
    let resolveRequest;
    const promise = new Promise(resolve => { resolveRequest = resolve; });
    const request = {
        identity,
        options: { ...options, deferUntilIdle: false },
        promise,
        resolve: resolveRequest
    };
    autoSaveRequests.set(identity, promise);
    autoSaveQueue.push(request);
    queueMicrotask(() => { void drainAutoSaveQueue(); });
    return promise;
}

function scheduleCheckpointSave(options = {}) {
    const identity = checkpointSaveIdentity(options);
    if (!identity) return enqueueAutoSave(options);
    if (scheduledCheckpointIds.has(identity) || autoSaveRequests.has(identity)) {
        return Promise.resolve({
            ok: true,
            saved: false,
            checkpointDeferred: true,
            idempotent: true,
            checkpointRequestId: identity,
            code: 'checkpointAlreadyScheduled'
        });
    }
    scheduledCheckpointIds.add(identity);
    setTimeout(() => {
        void enqueueAutoSave({
            ...options,
            originOperationId: options.originOperationId || options.operationId || null,
            checkpointMode: options.checkpointMode === 'bestEffort' ? 'bestEffort' : 'required'
        }).then(result => {
            if (result?.ok === false) {
                showAutoSaveStatus('检查点保存失败，请尽快手动保存。', 'error');
                console.warn('封账后 checkpoint 保存失败', {
                    checkpointRequestId: identity,
                    errors: result.errors || []
                });
            }
        }).finally(() => scheduledCheckpointIds.delete(identity));
    }, 0);
    return Promise.resolve({
        ok: true,
        saved: false,
        checkpointDeferred: true,
        nonBlocking: true,
        checkpointRequestId: identity,
        code: 'checkpointScheduledAfterCommit'
    });
}

/** 定时、剧情和地图切换共享串行队列；不同 checkpoint 绝不共享保存结果。 */
function autoSaveCurrentGame(options = {}) {
    if (!shell.gameStarted || !shell.scene?.playerEntity) return Promise.resolve(null);
    if (options.reason === 'checkpoint' && options.deferUntilIdle !== false) {
        return scheduleCheckpointSave(options);
    }
    return enqueueAutoSave(options);
}

async function waitForAutoSaveQueueIdle() {
    while (scheduledCheckpointIds.size > 0 || autoSaveQueue.length > 0 || autoSaveInFlight) {
        const pending = [...autoSaveRequests.values()];
        if (pending.length > 0) await Promise.allSettled(pending);
        else await new Promise(resolve => setTimeout(resolve, 0));
    }
}

/** 只恢复精确匹配 checkpointId 的最新自动存档，不猜测普通自动位。 */
async function loadCheckpointAutoSave({ checkpointId } = {}) {
    const targetId = String(checkpointId || '');
    if (!targetId) return { ok: false, code: 'checkpointIdMissing' };
    await waitForAutoSaveQueueIdle();
    await shell.saveStorageReady;
    const candidate = (await shell.saveGames.getAutoSlotsAsync())
        .filter(slot => slot.exists && slot.info?.meta?.checkpointId === targetId)
        .sort((a, b) => (Number(b.info?.createdAt) || 0) - (Number(a.info?.createdAt) || 0))[0];
    if (!candidate) return { ok: false, code: 'checkpointNotFound', checkpointId: targetId };

    const inspected = await shell.saveGames.inspectAutoAsync(candidate.index);
    if (!inspected.ok) return { ...inspected, code: 'checkpointInspectFailed' };
    const savedState = inspected.snapshot?.data?.game;
    const prepared = await shell.scene?.prepareRestoreRegion?.(savedState);
    if (prepared?.ok === false) {
        return {
            ok: false,
            code: 'checkpointRegionPrepareFailed',
            errors: prepared.errors || []
        };
    }
    const loaded = await shell.saveGames.loadAutoAsync(candidate.index);
    return loaded.ok
        ? { ...loaded, checkpointId: targetId, autoSlotIndex: candidate.index }
        : { ...loaded, code: 'checkpointRestoreFailed' };
}
globalThis.__loadCheckpointAutoSave = loadCheckpointAutoSave;

    return {
        autoSaveCurrentGame,
        waitForAutoSaveQueueIdle,
        loadCheckpointAutoSave
    };
}
