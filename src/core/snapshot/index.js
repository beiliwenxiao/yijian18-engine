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

/**
 * core/snapshot/index.js
 * 原子检查点系统导出入口。
 */

export { SnapshotManager, SNAPSHOT_VERSION } from './SnapshotManager.js';
export { LocalStorageAdapter } from './LocalStorageAdapter.js';
export { IndexedDBAdapter } from './IndexedDBAdapter.js';
export { SaveGameService, DEFAULT_VISIBLE_SLOTS, MAX_MANUAL_SAVE_SLOTS, AUTO_SAVE_SLOT_COUNT } from './SaveGameService.js';
