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
 * 《三国张角传》放置点生成后的剧情索引协调器。
 * 通用生成、恢复与实体清理由 ScenePlacementRuntime 拥有。
 */
import { SceneGroupClearObserver } from '../../../src/core/scene/SceneGroupClearObserver.js';

export class SanguoPlacementCoordinator {
  constructor({ getNpcEntities, getGroupEnemies } = {}) {
    this.getNpcEntities = getNpcEntities || (() => []);
    this.getGroupEnemies = getGroupEnemies || (() => ({}));
  }

  handleSpawn({ entity, kind, group, placement } = {}) {
    if (!entity) return false;
    if (Array.isArray(placement?.tags)) {
      entity.tags = [...new Set([...(entity.tags || []), ...placement.tags])];
    }
    if (kind === 'npc') {
      const npcs = this.getNpcEntities();
      if (!npcs.includes(entity)) npcs.push(entity);
    } else if (kind === 'enemy') {
      const groups = this.getGroupEnemies();
      const key = group || placement?.group || 'default';
      const members = groups[key] = groups[key] || [];
      if (!members.includes(entity)) members.push(entity);
    }
    return true;
  }

  /**
   * 将已经全灭的放置点敌人组转换为 canonical waveCleared 事件。
   * 已清理集合与触发器由宿主注入，协调器不拥有 StoryState 或实体生命周期。
   */
  checkWaveEvents({ clearedGroups, isEntityDead, triggerSystem, logger = console } = {}) {
    if (!(clearedGroups instanceof Set) || typeof isEntityDead !== 'function') return 0;
    const cleared = SceneGroupClearObserver.findCleared({
      groups: this.getGroupEnemies(),
      clearedGroups,
      isEntityDead
    });
    for (const group of cleared) {
      clearedGroups.add(group);
      triggerSystem?.fire?.('waveCleared', { group });
      logger?.log?.('[SanguoPlacementCoordinator] waveCleared:', group);
    }
    return cleared.length;
  }

  removeValues(values = []) {
    const targets = values instanceof Set ? values : new Set(values || []);
    if (targets.size === 0) return 0;
    const npcs = this.getNpcEntities();
    let removed = 0;
    for (let index = npcs.length - 1; index >= 0; index--) {
      if (!targets.has(npcs[index])) continue;
      npcs.splice(index, 1);
      removed++;
    }
    for (const members of Object.values(this.getGroupEnemies())) {
      for (let index = members.length - 1; index >= 0; index--) {
        if (!targets.has(members[index])) continue;
        members.splice(index, 1);
        removed++;
      }
    }
    return removed;
  }
}

export default SanguoPlacementCoordinator;