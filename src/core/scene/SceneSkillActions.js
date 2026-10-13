/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * @project YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 ************************************************************/

import { Logger } from '../Logger.js';
import { SceneAimController } from './SceneAimController.js';

/** 统一处理技能释放、可用性检查及 PC 瞄准状态。 */
export class SceneSkillActions {
  constructor(scene, options = {}) {
    if (!scene) throw new TypeError('SceneSkillActions requires scene');
    this.scene = scene;
    this.AimControllerClass = options.AimControllerClass || SceneAimController;
    this.controller = null;
  }

  get isAiming() {
    return this.controller?.isAiming === true;
  }

  onSkillClicked(skill) {
    const scene = this.scene;
    if (scene.isPlayerActionLocked?.()) return false;
    Logger.log('BaseGameScene: 技能点击', skill);
    if (!scene.playerEntity || !scene.combatSystem) return;

    if (skill.id === 'meditation') {
      if (scene.combatSystem.isInCombat()) {
        const transform = scene.playerEntity.getComponent('transform');
        if (transform && scene.floatingTextManager) {
          scene.floatingTextManager.addText(
            transform.position.x, transform.position.y - 50, '战斗中无法打坐', '#ff6666');
        }
        return;
      }
      if (scene.meditationSystem.isActive()) scene.meditationSystem.stop();
      else scene.meditationSystem.start(scene.playerEntity);
      return;
    }

    if (skill.id === 'heal') {
      const combat = scene.playerEntity.getComponent('combat');
      const currentTime = performance.now();
      if (combat?.canUseSkill(skill.id, currentTime)) {
        scene.combatSystem.tryUseSkillAtPosition(
          scene.playerEntity,
          skill,
          scene.playerEntity.getComponent('transform').position,
          currentTime,
          scene.entities
        );
      }
      return;
    }

    if (!scene.isMobileLayout) {
      const skills = scene.playerEntity.getComponent('combat')?.skills;
      const index = skills?.findIndex(candidate => candidate?.id === skill.id) ?? -1;
      if (index >= 0) {
        this.enterPCAimMode('skill', index);
        return;
      }
    }

    const targetPosition = scene.inputManager.getMouseWorldPosition(scene.camera);
    if (this._useCanonicalAbility(skill, targetPosition)) return;
    scene.combatSystem.tryUseSkillAtPosition(
      scene.playerEntity,
      skill,
      targetPosition,
      performance.now(),
      scene.entities
    );
  }

  checkSkillUsable(skill) {
    const scene = this.scene;
    if (scene.isPlayerActionLocked?.()) return false;
    if (!scene.playerEntity) return false;
    const ability = scene.abilitySystem;
    if (ability?.skillRegistry?.has?.(skill?.id)) {
      const check = ability.canUse(scene.playerEntity, skill.id, {
        currentTime: performance.now(),
        skipTargeting: true,
        context: { scene }
      });
      if (check.ok) return true;
      const transform = scene.playerEntity.getComponent('transform');
      scene.floatingTextManager?.addText?.(
        transform?.position?.x || 0,
        (transform?.position?.y || 0) - 50,
        check.message || '技能不可用',
        '#888888'
      );
      return false;
    }

    const stats = scene.playerEntity.getComponent('stats');
    const combat = scene.playerEntity.getComponent('combat');
    if (!stats || !combat) return false;
    if (!combat.canUseSkill(skill.id, performance.now())) {
      const transform = scene.playerEntity.getComponent('transform');
      if (transform && scene.floatingTextManager) {
        scene.floatingTextManager.addText(
          transform.position.x, transform.position.y - 50, '技能冷却中', '#888888');
      }
      return false;
    }
    if (skill.manaCost && stats.mp < skill.manaCost) {
      const transform = scene.playerEntity.getComponent('transform');
      if (transform && scene.floatingTextManager) {
        scene.floatingTextManager.addText(
          transform.position.x, transform.position.y - 50,
          `蓝量不足(需${skill.manaCost})`, '#6666ff');
      }
      return false;
    }
    return true;
  }

  useSkillByIndex(index) {
    const scene = this.scene;
    if (!scene.playerEntity || !scene.combatSystem) return;
    const skill = scene.playerEntity.getComponent('combat')?.skills?.[index];
    if (!skill || !this.checkSkillUsable(skill)) return;
    if (skill.id === 'heal' || skill.id === 'meditation') {
      this.onSkillClicked(skill);
      return;
    }
    if (!scene.isMobileLayout) {
      this.enterPCAimMode('skill', index);
      return;
    }
    const transform = scene.playerEntity.getComponent('transform');
    if (!transform) return;
    const direction = scene.getPlayerFacingVector();
    const range = skill.range || 300;
    const targetPosition = {
      x: transform.position.x + direction.x * range,
      y: transform.position.y + direction.y * range
    };
    if (this._useCanonicalAbility(skill, targetPosition)) return;
    scene.combatSystem.tryUseSkillAtPosition(
      scene.playerEntity,
      skill,
      targetPosition,
      performance.now(),
      scene.entities
    );
  }

  useSkillByDirection(index, dirX, dirY, distRatio, targetWorldPos) {
    const scene = this.scene;
    if (!scene.playerEntity || !scene.combatSystem) return;
    const skill = scene.playerEntity.getComponent('combat')?.skills?.[index];
    if (!skill || !this.checkSkillUsable(skill)) return;
    if (skill.id === 'heal' || skill.id === 'meditation') {
      this.onSkillClicked(skill);
      return;
    }
    const transform = scene.playerEntity.getComponent('transform');
    if (!transform) return;

    let target;
    if (targetWorldPos) {
      target = { x: targetWorldPos.x, y: targetWorldPos.y };
    } else {
      const magnitude = Math.hypot(dirX, dirY);
      const dx = magnitude > 0 ? dirX / magnitude : 1;
      const dy = magnitude > 0 ? dirY / magnitude : 0;
      const distance = Math.min(distRatio ?? 1, 1) * (skill.range || 300);
      target = {
        x: transform.position.x + dx * distance,
        y: transform.position.y + dy * distance
      };
    }
    if (this._useCanonicalAbility(skill, target)) return;
    scene.combatSystem.tryUseSkillAtPosition(
      scene.playerEntity, skill, target, performance.now(), scene.entities);
  }

  _useCanonicalAbility(skill, targetPosition) {
    const scene = this.scene;
    const ability = scene.abilitySystem;
    if (!ability?.skillRegistry?.has?.(skill?.id)) return false;
    const result = ability.use(scene.playerEntity, skill.id, {
      targetPosition,
      currentTime: performance.now(),
      context: { scene },
      entities: scene.entities
    });
    if (!result.ok) {
      const transform = scene.playerEntity?.getComponent?.('transform');
      scene.floatingTextManager?.addText?.(
        transform?.position?.x || 0,
        (transform?.position?.y || 0) - 50,
        result.message || '技能释放失败',
        '#ff8888'
      );
    }
    return true;
  }

  setAimPreview(index, dirX, dirY, distRatio, anchorPos) {
    const scene = this.scene;
    const presentation = scene._ensureAimPresentation();
    scene.skillAimPreview = presentation.set(index, dirX, dirY, distRatio, anchorPos);
    scene._aimDirX = presentation.directionX;
    scene._aimDirY = presentation.directionY;
    scene._aimDistRatio = presentation.distanceRatio;
    if (scene.skillAimPreview && scene._aimDisplayX === 0 && scene._aimDisplayY === 0) {
      scene._aimDisplayX = scene.skillAimPreview.targetX;
      scene._aimDisplayY = scene.skillAimPreview.targetY;
    }
    return scene.skillAimPreview;
  }

  clearAimPreview() {
    const scene = this.scene;
    scene._aimPresentation?.clear();
    scene.skillAimPreview = null;
    scene._aimDisplayX = 0;
    scene._aimDisplayY = 0;
    scene._lastAimWorldX = 0;
    scene._lastAimWorldY = 0;
    // 延迟解锁，确保当前帧 performSectorAttack 的方向不被覆盖。
    if (scene.meleeAttackSystem) {
      scene.resourceScope?.setTimeout(() => {
        if (scene.meleeAttackSystem) scene.meleeAttackSystem.sectorDirectionLocked = false;
      }, 50);
    }
  }

  enterPCAimMode(kind, index = -1) {
    const scene = this.scene;
    if (scene.isPlayerActionLocked?.()) return false;
    if (scene.isMobileLayout || !scene.playerEntity) return;
    if (kind === 'skill') {
      const skill = scene.playerEntity.getComponent('combat')?.skills?.[index];
      if (!skill) {
        Logger.log('[PCAim] 技能不存在, index=', index);
        return;
      }
      if (!this.checkSkillUsable(skill)) {
        Logger.log('[PCAim] 技能不可用(冷却/蓝量):', skill.id);
        return;
      }
    } else if (kind === 'flight' && scene.flightSystem?.isPlayerFlying?.()) {
      return;
    } else if (kind === 'throw' && scene.weaponRenderer?.isWeaponThrown?.()) {
      return;
    }
    this.ensureController().enter(kind, index);
    Logger.log(`[PCAim] 进入瞄准: kind=${kind}, index=${index}`);
  }

  cancelPCAimMode() {
    this.controller?.cancel();
    this.clearAimPreview();
  }

  ensureController() {
    if (this.controller) return this.controller;
    const scene = this.scene;
    this.controller = new this.AimControllerClass({
      getPlayerPosition: () => scene.playerEntity?.getComponent('transform')?.position || null,
      getRange: (kind, index) => {
        if (kind === 'flight') return scene.flightSystem?.config?.maxDistance || 400;
        if (kind === 'throw') {
          return scene.weaponRenderer?.getThrowRange?.(scene.playerEntity) || 480;
        }
        const skill = scene.playerEntity?.getComponent('combat')?.skills?.[index];
        return skill ? (skill.range || 300) : 0;
      },
      onConfirm: (kind, index, aim) => {
        if (kind === 'flight') {
          scene.flightByDirection(aim.dirX, aim.dirY, aim.distRatio);
        } else if (kind === 'throw') {
          scene.throwByDirection(aim.dirX, aim.dirY, aim.distRatio);
        } else {
          this.useSkillByDirection(index, aim.dirX, aim.dirY, aim.distRatio, aim.worldTarget);
        }
      },
      onCancel: () => this.clearAimPreview()
    });
    // 迁移期兼容 SceneCombatActions 的手柄预览判断。
    scene._aimController = this.controller;
    return this.controller;
  }

  updatePCAimMode() {
    const scene = this.scene;
    const aim = this.controller;
    if (!aim?.isAiming || scene.isMobileLayout || !scene.inputManager) return;
    const mouseWorld = scene.inputManager.getMouseWorldPosition(scene.camera);
    const result = aim.aimAtWorldPoint(mouseWorld);
    if (!result) return;
    this.setAimPreview(result.previewIndex, result.dirX, result.dirY, result.distRatio);
    if (!scene.inputManager.isMouseClicked() || scene.inputManager.isMouseClickHandled()) return;

    const button = scene.inputManager.getMouseButton();
    const mouseScreen = scene.inputManager.getMousePosition();
    if (button === 0 && this.isMouseOverBottomUI(mouseScreen.x, mouseScreen.y)) return;
    scene.inputManager.markMouseClickHandled();
    if (button === 2) {
      this.cancelPCAimMode();
      return;
    }
    aim.confirm({ worldTarget: { x: mouseWorld.x, y: mouseWorld.y } });
    this.clearAimPreview();
  }

  isMouseOverBottomUI(sx, sy) {
    const scene = this.scene;
    const buttons = [scene.blockButton, scene.jumpButton, scene.flightButton, scene.throwButton, scene.bagButton, scene.settingsButton];
    for (const button of buttons) {
      if (button?.visible !== false && button?.containsPoint?.(sx, sy)) return true;
    }
    if (scene.bottomControlBar) {
      const barY = scene.bottomControlBar.y ?? (scene.logicalHeight - 100);
      if (sy >= barY) return true;
    }
    return false;
  }

  renderAimPreview(ctx) {
    const scene = this.scene;
    if (!scene.skillAimPreview) return;
    const landing = scene._ensureAimPresentation().render(ctx);
    if (landing) {
      scene._lastAimWorldX = landing.x;
      scene._lastAimWorldY = landing.y;
    }
  }

  reset() {
    if (this.controller) this.controller.state = null;
    this.controller = null;
    this.scene._aimController = null;
    this.scene._aimPresentation?.clear();
    this.scene.skillAimPreview = null;
    this.scene._aimDisplayX = 0;
    this.scene._aimDisplayY = 0;
    this.scene._aimDirX = 0;
    this.scene._aimDirY = 0;
    this.scene._aimDistRatio = 0;
  }
}

export default SceneSkillActions;
