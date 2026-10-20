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

import { SceneFlowCoordinator } from '../../../src/core/scene/SceneFlowCoordinator.js';

/**
 * 成长效果 → 战斗属性投影层。
 *
 * 职责：EffectResolver 来源变化（加点/升级/职业变更）时，把 ClassSystem.calculateFinalStats
 * 的结算结果以「增量差量」应用到玩家 live StatsComponent——不重置装备与出生初始值，
 * 与 EquipmentSystem.updateEntityStats 的差量语义互补：
 *   live = 出生初始值 + 装备差量 + 成长差量
 *
 * 首次投影只建立基线快照（lastFinal），不改写当前属性；此后每次重算 final，
 * 仅把 (final - lastFinal) 的变化量叠加进 stats，hp/mp 按比例保持。
 */

/** 参与差量投影的属性字段（与 calculateFinalStats 产出对齐） */
const PROJECTION_STAT_TARGETS = ['maxHp', 'maxMp', 'attack', 'defense', 'speed'];

const methods = {
  /**
   * 注册 effectResolver.onChange 并建立基线；GameLoader ready 后调用一次。
   * @param {Object} gameLoader
   * @returns {boolean} 是否装配成功
   */
  installProgressionStatsProjection(gameLoader) {
    const effectResolver = gameLoader?.progressionSystem?.effectResolver;
    if (!effectResolver) return false;
    // 不在此处依赖 playerEntity：GameLoader ready 可能早于场景 enter（玩家实体创建），
    // onChange 回调与 projectProgressionStats 均实时读取 this.playerEntity。
    this._progressionStatsProjection = { effectResolver, lastFinal: null };

    const previousOnChange = effectResolver.onChange;
    effectResolver.onChange = entityId => {
      if (typeof previousOnChange === 'function') {
        try {
          previousOnChange(entityId);
        } catch (e) {
          console.warn('[SanguoProgressionStatsFlow] 前置 onChange 回调出错', e);
        }
      }
      if (entityId !== this.playerEntity?.id) return;
      this.projectProgressionStats('effectSourceChange');
      this._syncUnlockedClassSkills();
    };

    this.projectProgressionStats('install');

    this.resourceScope?.track(() => {
      effectResolver.onChange = previousOnChange || null;
      this._progressionStatsProjection = null;
    });
    return true;
  },

  /**
   * 差量投影成长结算结果到玩家 stats 组件。
   * 无职业时清空基线（等待职业选定后重建），首次仅建立基线不修改属性。
   * @param {string} cause - 触发来源（install / effectSourceChange / classSkillsSync / levelUp / restore）
   * @returns {boolean} 是否执行了结算
   */
  projectProgressionStats(cause) {
    const projection = this._progressionStatsProjection;
    // 读档恢复：stats 已含存档时的成长效果，重建基线防差量双算
    if (cause === 'restore' && projection) projection.lastFinal = null;
    const player = this.playerEntity;
    const stats = player?.getComponent?.('stats');
    const classSystem = this._ensureClassSystem?.();
    if (!projection || !player || !stats || !classSystem) return false;

    if (!classSystem.getCharacterClassData?.(player.id)) {
      // 未选定职业：无结算意义，清空基线待职业提交后重建
      projection.lastFinal = null;
      return false;
    }

    const character = {
      level: Number(stats.level) || 1,
      hp: stats.hp,
      mp: stats.mp
    };
    const finalStats = classSystem.calculateFinalStats(player.id, character);
    if (!finalStats || typeof finalStats !== 'object') return false;

    const next = {};
    for (const key of PROJECTION_STAT_TARGETS) {
      next[key] = Math.floor(Number(finalStats[key]) || 0);
    }

    const previous = projection.lastFinal;
    projection.lastFinal = next;
    if (!previous) {
      // 首次投影只建立基线，保持出生初始值与装备加成不变
      return true;
    }

    const hpRatio = stats.maxHp > 0 ? stats.hp / stats.maxHp : 1;
    const mpRatio = stats.maxMp > 0 ? stats.mp / stats.maxMp : 1;
    const oldMaxHp = stats.maxHp;
    const oldMaxMp = stats.maxMp;

    for (const key of PROJECTION_STAT_TARGETS) {
      const delta = next[key] - (Number(previous[key]) || 0);
      if (delta === 0) continue;
      stats[key] = Math.max(0, Math.floor((Number(stats[key]) || 0) + delta));
    }

    if (stats.maxHp !== oldMaxHp) stats.hp = Math.floor(stats.maxHp * hpRatio);
    if (stats.maxMp !== oldMaxMp) stats.mp = Math.floor(stats.maxMp * mpRatio);

    return true;
  }
};

export class SanguoProgressionStatsFlow extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, methods, { name: 'SanguoProgressionStatsFlow' });
  }
}

export default SanguoProgressionStatsFlow;
