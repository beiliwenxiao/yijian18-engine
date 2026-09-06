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

import { BaseGameSceneBehaviors } from './BaseGameSceneBehaviors.js';

/**
 * 通用场景玩法兼容钩子。
 * 保持旧 Scene API，但将采集、死亡与世界交互从组合根分离。
 */
export class BaseGameSceneGameplayHooks extends BaseGameSceneBehaviors {
  /** 移除死亡实体（委托给 EntityLifecycleSystem）。 */
  removeDeadEntities() {
    const removed = this.entityLifecycleSystem.collectDeadEntities(this.entities);
    this.entityStore.removeMany(removed);
    return removed;
  }

  /** 处理 PC 左键点击地上物品的拾取。 */
  handlePickupClick() {
    return this._ensureWorldInteraction().handlePickupClick();
  }

  /** 移动端、手柄适配器和脚本统一交互入口。 */
  enqueueInteract(device = 'virtual') {
    return this.sceneRuntime?.inputRouter?.enqueueInteract?.(device) || null;
  }

  /** 子场景可覆盖死亡结算策略。 */
  resolvePlayerDefeatResolution() {
    return { type: 'normalDeath' };
  }

  /** 默认复活点使用当前 canonical 场景的玩家出生点；具体游戏可追加特殊营地规则。 */
  resolvePlayerRespawnPosition() {
    const sceneId = this.currentSceneId || this.editorSceneId || null;
    const spawn = sceneId
      ? this.context?.services?.placements?.getSpawnPoint?.(sceneId, 'player')
      : null;
    return spawn ? { x: spawn.x, y: spawn.y, label: `${sceneId}入口` } : null;
  }

  onPlayerDefeatResolved(result = {}) {
    const position = result.respawnPosition;
    const location = position?.label || (Number.isFinite(position?.x) && Number.isFinite(position?.y)
      ? `安全点（${Math.round(position.x)}, ${Math.round(position.y)}）`
      : '安全点');
    if (result.type === 'specialFaint') {
      this._showScreenTip(`你被救回并在${location}醒来，没有遗失物资`);
      return;
    }
    const lost = (result.stacks || []).reduce((sum, stack) => sum + stack.quantity, 0);
    this._showScreenTip(lost > 0
      ? `死亡后遗失 ${lost} 份资源，已在${location}复苏，可返回原地拾取`
      : `你在${location}重新醒来，没有遗失资源`);
  }

  /**
   * 仅表示所有世界动作都必须拒绝的硬锁；战斗状态不是硬锁，攻击和跳跃必须继续可用。
   */
  isPlayerActionLocked() {
    const player = this.playerEntity;
    return player?.isDead === true
      || player?.isSoulState === true
      || Boolean(this.playerSoulRespawn?.pending)
      || Boolean(this.playerDeathCountdown?.pending)
      || this.gatheringSystem?.isActiveFor?.(player) === true;
  }

  /**
   * 输入设备无关的玩家动作准入。具体攻击资格继续由 canPerformBasicAttack() 负责。
   */
  canPerformPlayerAction(action, actor = this.playerEntity) {
    if (!actor || actor?.isDead === true || actor?.isSoulState === true) return false;
    if (actor === this.playerEntity && this.isPlayerActionLocked()) return false;
    if (action === 'gather' && this.combatSystem?.isInCombat?.() === true) return false;
    return true;
  }

  /** 基础攻击默认只在战斗状态开放；具体场景可覆盖以支持训练或可破坏物。 */
  canPerformBasicAttack() {
    return this.canPerformDefaultBasicAttack();
  }

  /** 供内容 coordinator 组合训练、载具等规则时调用的框架默认攻击许可。 */
  canPerformDefaultBasicAttack() {
    return this.combatSystem?.isInCombat?.() === true;
  }

  harvestByFacing({ silent = false } = {}) {
    if (!this.playerEntity || !this.gatheringSystem) return false;
    if (!this.canPerformPlayerAction('gather')) {
      if (!silent) {
        const message = this.combatSystem?.isInCombat?.() === true
          ? '战斗状态下无法采集'
          : '当前状态无法采集';
        this._showScreenTip(message);
      }
      return false;
    }
    const playerPosition = this.playerEntity.getComponent('transform')?.position;
    if (!playerPosition) return false;
    const candidates = (this.entities || [])
      .filter(entity => entity?.getComponent?.('resourceNode'))
      .map(entity => {
        const position = entity.getComponent('transform')?.position;
        return { entity, distance: position ? Math.hypot(position.x - playerPosition.x, position.y - playerPosition.y) : Infinity };
      })
      .sort((left, right) => left.distance - right.distance);
    const result = this.gatheringSystem.start({ player: this.playerEntity, nodeEntity: candidates[0]?.entity });
    if (!result.ok && !silent) {
      const messages = {
        gatheringBusy: '正在采集中', nodeDepleted: '资源节点已经耗尽',
        outOfRange: '附近没有可采集资源', toolRequired: '需要可用的采集工具', invalidTarget: '附近没有可采集资源'
      };
      this._showScreenTip(messages[result.code] || '暂时无法采集');
    }
    return result.ok;
  }

  onGatheringEvent(event, data = {}) {
    this.context?.presentation?.gatheringProgress?.handleEvent?.(
      event,
      data,
      this.gatheringSystem?.session?.actor || null
    );
    // 采集进行态只使用玩家头顶世界进度条，不再占用全局文字提示槽。
    if (event === 'started' || event === 'progress') return;

    this._lastGatheringProgressPercent = null;
    this._hintPresenter?.hideScreen?.('gathering');
    if (event === 'riskTriggered') {
      this._showScreenTip(data.message || '采集产生了意外动静', { title: '采集风险' });
      return;
    }
    if ((event === 'completed' || event === 'interrupted')
      && data.committed === true
      && data.idempotent !== true
      && Number(data.accepted) > 0) {
      const definition = this.gameLoader?.getRegistry?.('items')?.get?.(data.itemId) || {};
      const gainedItem = {
        ...definition,
        id: definition.id || data.itemId,
        definitionId: definition.id || data.itemId,
        name: definition.name || data.itemName || data.itemId || '资源',
        type: definition.type || 'material',
        quantity: Math.max(1, Math.floor(Number(data.accepted) || 1)),
        operationId: data.operationId || null,
        gatheringCommitted: true
      };
      try {
        this.onItemGained(gainedItem, this.playerEntity);
      } catch (error) {
        console.warn('[BaseGameSceneGameplayHooks] gathering item presentation failed', error);
      }
    }
    if (event === 'completed') {
      const itemName = data.itemName || data.itemId || '资源';
      this._showScreenTip(data.toolBroken
        ? `获得 ${itemName} ×${data.accepted}，工具已损毁`
        : `获得 ${itemName} ×${data.accepted}`);
      return;
    }
    if (event !== 'interrupted') return;
    const itemName = data.itemName || data.itemId || '资源';
    const messages = {
      moved: '位置变化导致采集中断',
      damaged: data.accepted > 0 ? `受伤中断，获得 ${itemName} ×${data.accepted}` : '受伤导致采集中断',
      cancelled: '已取消采集',
      inventoryFull: '背包已满，采集未结算',
      insufficientCapacity: '背包容量不足，采集未结算'
    };
    this._showScreenTip(messages[data.code || data.reason] || '采集已中断');
  }

  /** 左键点击地上物品的拾取检测。 */
  tryClickPickup(worldX, worldY) {
    return this._ensureWorldInteraction().tryClickPickup(worldX, worldY);
  }
}

export default BaseGameSceneGameplayHooks;
