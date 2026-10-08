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

/** Shared entity-state predicates for scene projections and observers. */
export class SceneEntityState {
  static isDead(entity, entities = null) {
    if (!entity || entity.isDead || entity.isDying || entity.active === false) return true;
    const stats = entity.getComponent?.('stats');
    if (stats && Number(stats.hp) <= 0) return true;
    return Array.isArray(entities) && !entities.includes(entity);
  }
}

export default SceneEntityState;
