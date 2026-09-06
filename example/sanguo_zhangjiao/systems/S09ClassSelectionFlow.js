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
import { InputHints } from '../../../src/core/input/InputHints.js';
import { PadButton } from '../../../src/core/input/Xbox360Profile.js';
import { ClassType, ClassNames } from '../../../src/systems/ClassSystem.js';

const SUPPORTED_CLASSES = Object.freeze([ClassType.WARRIOR, ClassType.ARCHER, ClassType.STRATEGIST]);
const STARTER_NODES = Object.freeze({
  warrior: { graphId: 'warrior-skill', nodeId: 'cleave', passiveStart: 'start_warrior' },
  archer: { graphId: 'archer-skill', nodeId: 'arrow_shot', passiveStart: 'start_archer' },
  strategist: { graphId: 'strategist-skill', nodeId: 'talisman_water', passiveStart: 'start_strategist' }
});
const STARTER_POINT_TOTALS = Object.freeze({ skill: 8, talent: 4, unit: 4, passive: 4 });
const clone = value => JSON.parse(JSON.stringify(value));

const reject = (scene, message, code) => {
  scene._showScreenTip(message, { title: '无法选择职业' });
  return { ok: false, code, message };
};

const methods = {
  async selectClass(payload = {}) {
    const classType = payload.classId || payload.class || ClassType.WARRIOR;
    if (!SUPPORTED_CLASSES.includes(classType) || this._classSelectionBusy) {
      return { ok: false, code: 'invalidClassSelection' };
    }

    const player = this.playerEntity;
    const playerId = player?.id;
    const stats = player?.getComponent?.('stats');
    const inventory = player?.getComponent?.('inventory');
    const blackboard = this.gameLoader?.blackboard;
    const storyState = blackboard?.get?.('storyState');
    const progression = this.gameLoader?.progressionSystem;
    const classSystem = this._ensureClassSystem();
    if (this.currentSceneId !== 'S09' || !playerId || !stats || !inventory || !blackboard
      || !progression || !classSystem || storyState?.joinedYellowTurban !== true) {
      return reject(this, '职业选择前置状态不完整', 'classSelectionPreconditionFailed');
    }

    if (storyState.classSelectionCommitted === true) {
      if (storyState.selectedClass !== classType) {
        return reject(this, '职业已经固定，不能改选', 'classAlreadyCommitted');
      }
      classSystem.restoreClass(playerId, classType);
      this._classSelected = true;
      this.selectedClass = classType;
      this._syncUnlockedClassSkills();
      return { ok: true, idempotent: true, classType };
    }
    if (classSystem.getCharacterClass(playerId)) {
      return reject(this, '检测到未完成的职业运行状态，请重新读取检查点', 'classRuntimeConflict');
    }

    const classData = classSystem.getClassData(classType);
    const itemRegistry = this.gameLoader.getRegistry?.('items');
    const equipmentEntries = classSystem.getStartingEquipment(classType).map(spec => ({
      item: itemRegistry?.get?.(spec.id),
      quantity: Math.max(1, Math.floor(Number(spec.quantity) || 1))
    }));
    if (!classData || equipmentEntries.length === 0 || equipmentEntries.some(entry => !entry.item?.id)) {
      return reject(this, '职业初始装备定义缺失', 'classEquipmentDefinitionMissing');
    }
    const inventoryPreview = this.inventoryTransactions.previewBatchAdd(inventory, equipmentEntries);
    if (!inventoryPreview.valid || inventoryPreview.remainder > 0) {
      return reject(this, '背包空间不足，整理后再确认职业', 'classInventoryCapacityExceeded');
    }

    const initial = STARTER_NODES[classType];
    if (!progression.getGraph(initial.graphId)?.getNode?.(initial.nodeId)
      || !progression.getGraph('global-passive')?.getNode?.(initial.passiveStart)) {
      return reject(this, `职业初始能力或天赋盘起点不存在：${initial.nodeId}`, 'classProgressionDefinitionMissing');
    }

    const inventoryBefore = clone(inventory.exportItems());
    const blackboardBefore = clone(blackboard.serialize());
    const progressionBefore = clone(progression.serializeCharacter(playerId));
    const statsBefore = { class: stats.class, skillPoints: stats.skillPoints, unitType: stats.unitType };
    const playerClassBefore = player.class;
    const operationId = payload.operationId || `class-select:${playerId}:${classType}`;
    this._classSelectionBusy = true;

    try {
      const equipmentResult = this.inventoryTransactions.commit({
        type: 'batchAdd', inventory, entries: equipmentEntries, allowPartial: false, operationId
      });
      if (!equipmentResult.ok) throw new Error(equipmentResult.code || '初始装备提交失败');
      if (!classSystem.selectClass(playerId, classType)) throw new Error('职业系统拒绝选择');

      player.class = classType;
      stats.class = classType;
      if (typeof stats.setUnitType === 'function') stats.setUnitType(classData.baseUnitType);
      else stats.unitType = classData.baseUnitType;

      const ledger = progression.getLedger(playerId);
      for (const [pool, targetTotal] of Object.entries(STARTER_POINT_TOTALS)) {
        const currentTotal = ledger.getAvailable(pool) + ledger.getSpent(pool);
        if (currentTotal < targetTotal) progression.grantPoints(playerId, pool, targetTotal - currentTotal);
      }
      if (progression.getRank(playerId, initial.graphId, initial.nodeId) === 0) {
        const allocated = progression.allocateNode(playerId, initial.graphId, initial.nodeId, {
          characterLevel: Number(stats.level) || 1
        });
        if (!allocated.ok) throw new Error(allocated.message || `无法解锁 ${initial.nodeId}`);
      }
      if (progression.getRank(playerId, 'global-passive', initial.passiveStart) === 0) {
        const allocated = progression.allocateNode(playerId, 'global-passive', initial.passiveStart, {
          characterLevel: Number(stats.level) || 1
        });
        if (!allocated.ok) throw new Error(allocated.message || `无法激活 ${initial.passiveStart}`);
      }
      stats.skillPoints = progression.getLedger(playerId).getAvailable('skill');
      blackboard.set('storyState', {
        ...storyState,
        joinedYellowTurban: true,
        classSelectionCommitted: true,
        selectedClass: classType,
        lastCheckpointId: 'checkpoint.S09.classSelected'
      });
      blackboard.set('joinedYellowTurban', true);
      blackboard.set('selectedClass', classType);
      blackboard.set('classSelected', true);
      this._classSelected = true;
      this.selectedClass = classType;
      this._syncUnlockedClassSkills();

      const checkpoint = await this._executeScenarioCommand('checkpoint.request', {
        reason: 'checkpoint', checkpointId: 'checkpoint.S09.classSelected', sceneId: 'S09'
      }, `${operationId}:checkpoint`);
      if (!checkpoint?.ok || !checkpoint.committed) throw new Error(checkpoint?.error?.message || '职业检查点未提交');
      // 初始装备只有在职业与检查点都提交后才进入统一获得物品弹窗；表现失败不回滚领域事实。
      try {
        for (const entry of equipmentResult.entries || []) {
          if (Number(entry.accepted) <= 0 || !entry.item) continue;
          this.onItemGained({
            ...entry.item,
            quantity: entry.accepted,
            operationId,
            classSelectionCommitted: true
          }, player);
        }
      } catch (presentationError) {
        console.warn('[S09ClassSelectionCoordinator] starter equipment presentation failed', presentationError);
      }
      return { ok: true, classType };
    } catch (error) {
      inventory.loadItems(inventoryBefore);
      this.inventoryTransactions.forgetOperation?.(operationId);
      progression.deserializeCharacter(playerId, progressionBefore);
      classSystem.clearClass(playerId);
      player.class = playerClassBefore;
      for (const [key, value] of Object.entries(statsBefore)) {
        if (value === undefined) delete stats[key];
        else stats[key] = value;
      }
      blackboard.deserialize(blackboardBefore);
      this._classSelected = false;
      this.selectedClass = null;
      this.gatheringPuppetSystem?.cancelActive?.('classRollback');
      if (this.gatheringPuppetSystem) this.gatheringPuppetSystem.chargesRemaining = null;
      this._syncUnlockedClassSkills();
      this._showScreenTip(`职业提交失败：${error.message || error}。状态已回滚，可重试。`, { title: '检查点失败' });
      return { ok: false, code: error.code || 'classSelectionFailed', message: error.message || String(error) };
    } finally {
      this._classSelectionBusy = false;
    }
  },

  showConfirmation(payload = {}) {
    const classId = payload.classId || payload.class || ClassType.WARRIOR;
    if (!SUPPORTED_CLASSES.includes(classId)) {
      console.warn('[S09ClassSelectionCoordinator] confirmClass: 不支持的职业', classId);
      return false;
    }
    const storyState = this.gameLoader?.blackboard?.get?.('storyState');
    if (this.currentSceneId !== 'S09' || storyState?.joinedYellowTurban !== true) {
      this._showScreenTip('先在 S09 与张角交谈并加入黄巾', { title: '尚未入伍' });
      return false;
    }
    if (storyState.classSelectionCommitted === true || this._classSelected) {
      this._showScreenTip(`职业已经固定为${ClassNames[storyState.selectedClass || this.selectedClass] || '当前职业'}`);
      return false;
    }
    const descriptions = {
      warrior: '采集速度更快，但可携带的资源总量较低。',
      archer: '采集速度较慢，可用远程攻击引开守卫。',
      strategist: '可召唤一次采集傀儡协助获取资源。'
    };
    this._classConfirm = {
      classId,
      className: ClassNames[classId] || classId,
      description: descriptions[classId] || '',
      confirmHover: false,
      cancelHover: false
    };
    console.log(`[S09ClassSelectionCoordinator] 显示职业确认窗口: ${this._classConfirm.className}`);
    return true;
  },

  getConfirmationLayout() {
    const w = 460;
    const h = 220;
    const px = (this.logicalWidth - w) / 2;
    const py = (this.logicalHeight - h) / 2;
    const btnW = 140;
    const btnH = 40;
    const btnY = py + h - 58;
    return {
      w, h, px, py, btnW, btnH, btnY,
      confirmX: px + w / 2 - btnW - 14,
      cancelX: px + w / 2 + 14
    };
  },

  updateConfirmationHover() {
    const confirmation = this._classConfirm;
    if (!confirmation || !this.inputManager) return;
    const layout = this.getConfirmationLayout();
    const mouse = this.inputManager.getMousePosition();
    confirmation.confirmHover = mouse.x >= layout.confirmX && mouse.x <= layout.confirmX + layout.btnW
      && mouse.y >= layout.btnY && mouse.y <= layout.btnY + layout.btnH;
    confirmation.cancelHover = mouse.x >= layout.cancelX && mouse.x <= layout.cancelX + layout.btnW
      && mouse.y >= layout.btnY && mouse.y <= layout.btnY + layout.btnH;
  },

  handleConfirmationInput({ inputManager, gamepad } = {}) {
    const confirmation = this._classConfirm;
    if (!confirmation || !inputManager) return false;
    this.updateConfirmationHover();
    const clicked = inputManager.isMouseClicked?.() === true && !inputManager.isMouseClickHandled?.();
    const confirmPressed = inputManager.isKeyPressed?.('e')
      || inputManager.isKeyPressed?.('enter') || inputManager.isKeyPressed?.('Enter');
    const cancelPressed = inputManager.isKeyPressed?.('escape')
      || gamepad?.isButtonPressed?.(PadButton.B) === true;
    if (clicked) inputManager.markMouseClickHandled?.();
    if (!this._classSelectionBusy && (confirmPressed || (clicked && confirmation.confirmHover))) {
      void this.confirmSelection(confirmation.classId);
    } else if (!this._classSelectionBusy && (cancelPressed || (clicked && confirmation.cancelHover))) {
      this._classConfirm = null;
      console.log('[S09ClassSelectionCoordinator] 取消职业选择');
    }
    return true;
  },

  updateConfirmation() {
    this.updateConfirmationHover();
  },

  async confirmSelection(classId) {
    const result = await this._executeScenarioCommand('scenario.command', {
      operation: 'class.select',
      classId
    }, `class-select:${this.playerEntity?.id || 'unknown'}:${classId}`);
    if (!result?.ok) return false;
    this._classConfirm = null;
    this.presentSelectionCommitted(result.value?.classType || classId);
    return true;
  },

  presentSelectionCommitted(classType) {
    this._syncPlayerClassAppearance(classType);
    this._s09AudioDirector?.playFeedback?.('classSelected');
    const className = ClassNames[classType] || classType;
    this.notificationSystem?.addNotification?.(`你选择了${className}，初始能力和装备已发放`, 'success');
    this.gameLoader?.triggerSystem?.fire('classSelected', { class: classType, className });
    console.log('%c[S09ClassSelectionCoordinator] S09 职业检查点已提交:', 'color:#4CAF50', className);
  },

  executeAbility(context = {}) {
    const { skillId, caster, targetPosition, params = {}, view = {} } = context;
    if (skillId === 'gathering_puppet') {
      const nodeEntity = this.findResourceNodeNear(targetPosition, 72);
      const result = this.gatheringPuppetSystem?.summon?.({
        nodeEntity,
        duration: params.duration,
        backlashDamage: params.backlashDamage || 15
      });
      if (!result?.ok) {
        this._showScreenTip(`无法召唤采集傀儡：${result?.code || '目标无效'}`);
        return false;
      }
      return true;
    }
    const resolver = this.gameLoader?.progressionSystem?.effectResolver;
    const isRangedLure = resolver?.hasRuleOverride?.(
      caster?.id, 'gather.rangedGuardLure', { scene: this.$scene, targetPosition }
    ) === true;
    if (isRangedLure && view.tags?.includes?.('ranged') && this.currentSceneId === 'S09') {
      const guard = this.findGuardNear(targetPosition, 180);
      if (guard && this.aiSystem?.lureToPosition?.(guard, targetPosition, { duration: 8 })) {
        this._showScreenTip('箭矢声响引开了粮仓哨兵，抓紧时间行动。');
        return true;
      }
    }
    return null;
  },

  findResourceNodeNear(position, radius = 72) {
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return null;
    let nearest = null;
    let nearestDistance = radius;
    for (const entity of this.entities || []) {
      if (!entity?.getComponent?.('resourceNode')) continue;
      const transform = entity.getComponent('transform');
      if (!transform) continue;
      const distance = Math.hypot(position.x - transform.position.x, position.y - transform.position.y);
      if (distance <= nearestDistance) {
        nearest = entity;
        nearestDistance = distance;
      }
    }
    return nearest;
  },

  findGuardNear(position, radius = 180) {
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return null;
    let nearest = null;
    let nearestDistance = radius;
    for (const enemy of this.enemies || []) {
      if (!enemy?.tags?.includes?.('s09GranaryGuard') || this._isEntityDead(enemy)) continue;
      const transform = enemy.getComponent?.('transform');
      if (!transform) continue;
      const distance = Math.hypot(position.x - transform.position.x, position.y - transform.position.y);
      if (distance <= nearestDistance) {
        nearest = enemy;
        nearestDistance = distance;
      }
    }
    return nearest;
  },

  handleGatheringPuppetEvent(event) {
    if (event === 'summoned') this._showScreenTip('采集傀儡已开始工作，本检查点仅可召唤一次。');
    else if (event === 'destroyed' || event === 'expired') {
      this._showScreenTip('采集傀儡被摧毁，产物取消并受到反噬。');
    }
  },

  /** 将 EffectResolver 的职业技能投影到兼容快捷栏；定义仍由 SkillRegistry 拥有。 */
  syncUnlockedClassSkills() {
    const player = this.playerEntity;
    const combat = player?.getComponent?.('combat');
    const resolver = this.gameLoader?.progressionSystem?.effectResolver;
    const registry = this.gameLoader?.skillRegistry;
    if (!combat || !resolver || !registry || !player?.id) return false;
    const canonicalIds = new Set(['cleave', 'arrow_shot', 'talisman_water', 'gathering_puppet', 'power_jump']);
    const removedLegacyIds = new Set(['flame_palm', 'ice_finger', 'inferno_palm', 'heal', 'meditation']);
    const unlockedIds = new Set(resolver.getUnlockedSkills(player.id).filter(id => canonicalIds.has(id)));
    const previousCooldowns = new Map(combat.skillCooldowns || []);
    combat.skills = (combat.skills || []).filter(skill =>
      !canonicalIds.has(skill?.id) && !removedLegacyIds.has(skill?.id)
    );
    for (const skillId of [...canonicalIds, ...removedLegacyIds]) {
      combat.skillCooldowns.delete(skillId);
    }
    for (const skillId of unlockedIds) {
      const definition = registry.get(skillId);
      if (!definition) continue;
      const view = definition.resolveVariant(null);
      combat.addSkill({
        id: view.id,
        name: view.name,
        description: view.description,
        type: view.category,
        category: view.category,
        targeting: view.targeting,
        ...view.params,
        manaCost: view.costs.mp || 0,
        staminaCost: view.costs.stamina || 0,
        effectType: view.vfx?.effect || view.id
      });
      if (previousCooldowns.has(skillId)) {
        combat.skillCooldowns.set(skillId, previousCooldowns.get(skillId));
      }
    }
    this.gatheringPuppetSystem?.configure?.({ effectResolver: resolver, owner: player });
    this.gatheringPuppetSystem?.initializeCharges?.();
    return true;
  },

  ensureClassSystem() {
    const system = this.context?.systems?.classes
      || this._gameplaySystemAssembler?.getSharedSystems?.()?.classSystem
      || null;
    if (system) this.classSystem = system;
    return system;
  },

  syncPlayerClassAppearance(classId = null) {
    return this._playerFactory?.applyClassAppearance?.(this.$scene, this.playerEntity, classId) === true;
  },

  renderConfirmation(ctx) {
    const confirmation = this._classConfirm;
    if (!confirmation) return;
    const { w, h, px, py, btnW, btnH, btnY, confirmX, cancelX } = this.getConfirmationLayout();
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
    ctx.fillStyle = 'rgba(16,24,40,0.97)';
    ctx.strokeStyle = '#d6b85f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(px, py, w, h, 10);
    ctx.fill();
    ctx.stroke();

    const classIcon = this.assetManager?.getAsset?.(`s09.ui.class.${confirmation.classId}`);
    const classIconReady = classIcon && classIcon.complete !== false
      && (classIcon.naturalWidth || classIcon.width || 0) > 0;
    if (classIconReady) ctx.drawImage(classIcon, px + 16, py + 12, 38, 38);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('确认职业选择', px + w / 2, py + 18);
    ctx.fillStyle = '#ffffff';
    ctx.font = '15px Arial';
    ctx.fillText(`确定选择「${confirmation.className}」吗？选择后不可更改。`, px + w / 2, py + 57);
    ctx.fillStyle = '#d6d9df';
    ctx.font = '14px Arial';
    ctx.fillText(confirmation.description, px + w / 2, py + 88);
    if (this._classSelectionBusy) {
      ctx.fillStyle = '#f0cf77';
      ctx.fillText('正在创建职业检查点……', px + w / 2, py + 116);
    }

    ctx.fillStyle = confirmation.confirmHover ? '#5dba68' : '#4CAF50';
    ctx.beginPath();
    ctx.roundRect(confirmX, btnY, btnW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(`确认（${InputHints.key('confirm')}）`, confirmX + btnW / 2, btnY + 11);

    ctx.fillStyle = confirmation.cancelHover ? '#555' : '#3a3a3a';
    ctx.beginPath();
    ctx.roundRect(cancelX, btnY, btnW, btnH, 6);
    ctx.fill();
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(`取消（${InputHints.key('modalCancel')}）`, cancelX + btnW / 2, btnY + 11);
    ctx.restore();
  }
};

export class S09ClassSelectionCoordinator extends SceneFlowCoordinator {
  constructor(scene) { super(scene, methods, { name: 'S09ClassSelectionCoordinator' }); }
}

export default S09ClassSelectionCoordinator;