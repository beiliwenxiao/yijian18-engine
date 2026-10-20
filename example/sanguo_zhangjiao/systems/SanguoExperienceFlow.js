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
 * ARPG 击杀经验流。
 *
 * 链路：CombatSystem handleDeath → scene.onEnemyKilled → 本流
 *   → enemy 库定义 experience → StatsComponent.gainExperience（阈值自动升级）
 *   → 升级时：发成长点（progression.levelUpPoints）+ 通知 + character.levelUp 触发器事件
 *   + 技能与属性重投影（等级变化改变 attributeGrowth 与节点解锁面）。
 *
 * 经验归属不区分击杀者：军团/傀儡击杀同样滋养主角成长。
 */

const methods = {
  /**
   * 敌人死亡结算经验；由 DataDrivenPrologueScene.onEnemyKilled 转发。
   * @param {Object} entity - 死亡的敌人实体（definitionId 反查 enemies 注册表）
   * @returns {boolean} 是否结算了经验
   */
  handleEnemyKilled(entity) {
    const player = this.playerEntity;
    const stats = player?.getComponent?.('stats');
    if (!player || !stats || !entity || entity.type === 'player') return false;
    if (entity._expGranted) return false;

    const definitionId = entity.definitionId;
    if (!definitionId) return false;
    const definition = this.gameLoader?.getRegistry?.('enemies')?.get?.(definitionId);
    const experience = Math.max(0, Math.floor(Number(definition?.experience) || 0));
    if (experience <= 0) return false;

    entity._expGranted = true;
    const result = stats.gainExperience(experience);
    if (result?.levelsGained > 0) this._onCharacterLevelUp(result);
    return true;
  },

  /**
   * 升级结算：发成长点、通知、触发器事件、技能与属性重投影。
   * @param {{gained:number, levelsGained:number, level:number}} result - gainExperience 结算结果
   * @private
   */
  _onCharacterLevelUp(result) {
    const progression = this.gameLoader?.progressionSystem;
    const playerId = this.playerEntity?.id;
    const config = this.gameLoader?.project?.progression?.levelUpPoints;
    const pool = config?.pool || 'skill';
    const perLevel = Math.max(1, Math.floor(Number(config?.amount) || 1));
    const gainedPoints = perLevel * result.levelsGained;

    if (progression && playerId) {
      progression.grantPoints(playerId, pool, gainedPoints);
    }
    // 升级视觉反馈：玩家位置双层金色粒子环爆发 + 头顶飘字
    const transform = this.playerEntity?.getComponent?.('transform');
    const particles = this.particleSystem;
    if (transform?.position && typeof particles?.emit === 'function') {
      const rings = [
        { count: 16, speed: 90, size: 3, color: '#ffd479' },
        { count: 10, speed: 50, size: 4.5, color: '#fff3c4' }
      ];
      for (const ring of rings) {
        for (let i = 0; i < ring.count; i++) {
          const angle = (Math.PI * 2 * i) / ring.count;
          particles.emit({
            position: { x: transform.position.x, y: transform.position.y },
            velocity: { x: Math.cos(angle) * ring.speed, y: Math.sin(angle) * ring.speed },
            life: 0.6,
            size: ring.size + Math.random() * 2,
            color: ring.color,
            alpha: 0.9
          });
        }
      }
    }
    this.floatingTextManager?.addText?.(
      transform?.position?.x ?? 0,
      (transform?.position?.y ?? 0) - 60,
      `升级！Lv.${result.level}`,
      '#ffd479'
    );
    this.notificationSystem?.addNotification?.(`升到 ${result.level} 级，获得 ${gainedPoints} 成长点`, 'success');
    this.gameLoader?.triggerSystem?.fire?.('character.levelUp', {
      level: result.level,
      levelsGained: result.levelsGained,
      gainedPoints,
      pool
    });
    // 等级变化 → attributeGrowth 生效 + 新等级可能解锁技能节点：走统一重投影出口
    this._syncUnlockedClassSkills?.();
  }
};

export class SanguoExperienceFlow extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, methods, { name: 'SanguoExperienceFlow' });
  }
}

export default SanguoExperienceFlow;
