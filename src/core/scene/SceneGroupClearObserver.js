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

/**
 * Finds enemy groups that transitioned to fully cleared state.
 * The caller owns state commitment and any domain/trigger notification.
 */
export class SceneGroupClearObserver {
  static findCleared({ groups = {}, clearedGroups = new Set(), isEntityDead } = {}) {
    if (!groups || typeof groups !== 'object' || typeof isEntityDead !== 'function') return [];
    const cleared = [];
    for (const [group, entities] of Object.entries(groups)) {
      if (clearedGroups.has(group) || !Array.isArray(entities) || entities.length === 0) continue;
      if (entities.every(entity => isEntityDead(entity))) cleared.push(group);
    }
    return cleared;
  }
}

export default SceneGroupClearObserver;
