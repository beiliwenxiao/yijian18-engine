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
 * SceneAimPresentation - 统一技能、轻功和投掷的瞄准预览状态。
 *
 * 输入确认仍由 SceneAimController / SceneCombatActions 负责。本类仅处理预览
 * 状态及绘制，复用 AimPreviewRenderer 的统一 5px 虚线风格。
 */
import { AimPreviewRenderer } from '../../rendering/AimPreviewRenderer.js';

export class SceneAimPresentation {
  constructor(scene, { renderer = AimPreviewRenderer } = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.preview = null;
    this.directionX = 0;
    this.directionY = 0;
    this.distanceRatio = 0;
    this.lastWorldX = 0;
    this.lastWorldY = 0;
  }

  /** 设置预览并保存方向、距离比例。 */
  set(index, dirX, dirY, distRatio, anchorPosition) {
    const scene = this.scene;
    const transform = scene.playerEntity?.getComponent('transform');
    if (!transform) {
      this.preview = null;
      return null;
    }

    const skill = this._resolveSkill(index);
    if (!skill) {
      this.preview = null;
      return null;
    }
    const range = skill.range || 300;
    const magnitude = Math.hypot(dirX, dirY);
    const dx = magnitude > 0 ? dirX / magnitude : 0;
    const dy = magnitude > 0 ? dirY / magnitude : 0;
    const ratio = Math.min(distRatio, 1.5);
    const baseX = anchorPosition ? anchorPosition.x : transform.position.x;
    const baseY = anchorPosition ? anchorPosition.y : transform.position.y;

    this.directionX = dx;
    this.directionY = dy;
    this.distanceRatio = ratio;
    this.preview = {
      skill,
      targetX: baseX + dx * ratio * range,
      targetY: baseY + dy * ratio * range,
      startX: transform.position.x,
      startY: transform.position.y,
      inRange: distRatio <= 1,
      color: distRatio <= 1 ? '#00ff00' : '#ff4444'
    };
    return this.preview;
  }

  clear() {
    this.preview = null;
    this.directionX = 0;
    this.directionY = 0;
    this.distanceRatio = 0;
    this.lastWorldX = 0;
    this.lastWorldY = 0;
    return null;
  }

  /** 用当前玩家位置重算并绘制预览落点。 */
  render(ctx) {
    const position = this.scene.playerEntity?.getComponent('transform')?.position;
    if (!this.preview || !position) return null;
    const landing = this.renderer.render(
      ctx, this.preview, position, this.directionX, this.directionY, this.distanceRatio
    );
    if (landing) {
      this.lastWorldX = landing.x;
      this.lastWorldY = landing.y;
    }
    return landing;
  }

  _resolveSkill(index) {
    const scene = this.scene;
    if (index === -1) {
      if (!scene.meleeAttackSystem?.checkIsRangedWeapon()) return null;
      const mainhand = scene.playerEntity?.getComponent('equipment')?.getEquipment('mainhand');
      return {
        id: 'ranged_attack',
        name: '远程攻击',
        range: mainhand?.attackDistance ?? scene.meleeAttackSystem.sliceAttackRange ?? 100,
        aoeRadius: 20
      };
    }
    if (index === -2) {
      return { id: 'throw', name: '投掷', range: scene.weaponRenderer?.getThrowRange?.(scene.playerEntity) || 480, aoeRadius: 16 };
    }
    if (index === -3) {
      return { id: 'flight', name: '轻功', range: scene.flightSystem?.config?.maxDistance || 400, aoeRadius: 24 };
    }
    const skill = scene.playerEntity?.getComponent('combat')?.skills?.[index];
    return skill && skill.id !== 'heal' && skill.id !== 'meditation' ? skill : null;
  }
}

export default SceneAimPresentation;