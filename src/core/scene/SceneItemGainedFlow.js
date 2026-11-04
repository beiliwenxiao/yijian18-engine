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
 * SceneItemGainedFlow - 拾取/奖励后的物品提示与 FIFO 决策流。
 *
 * 物品必须已由调用方加入背包。本类只协调通知、弹窗和后续装备/使用，
 * 不直接依赖任何 Demo 类型；场景通过约定提供 UI 与装备服务。
 */
import { SceneEquipmentFlow } from './SceneEquipmentFlow.js';

export class SceneItemGainedFlow {
  /**
   * @param {Object} scene 提供 popup、notificationSystem、backpackPanel 等场景服务
   * @param {Object} [options]
   * @param {() => SceneEquipmentFlow} [options.getEquipmentFlow]
   * @param {(Array<string>, Object) => void} [options.onEquipmentChanged]
   * @param {(Object) => void} [options.onQueueDrained]
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    this.getEquipmentFlow = options.getEquipmentFlow || (() => null);
    this.onEquipmentChanged = options.onEquipmentChanged || (() => {});
    this.executeIntent = typeof options.executeIntent === 'function' ? options.executeIntent : null;
    this.onQueueDrained = options.onQueueDrained || (() => {});
    this.queue = [];
    this.disposed = false;
  }

  /**
   * 将一件已入背包的物品加入待处理队列。
   * 武器/装备类与药品/药水类（可用消耗品）弹窗决策；其余物品仅发通知，不再弹确认。
   */
  onItemGained(item, player = null) {
    if (this.disposed || !item) return;

    const scene = this.scene;
    const quantity = item.quantity && item.quantity > 1 ? ` ×${item.quantity}` : '';
    scene.notificationSystem?.addNotification(
      `获得 ${item.name || '物品'}${quantity}`,
      item.type === 'equipment' ? 'info' : 'success'
    );

    const needsDecision = item.type === 'equipment'
      || (item.type === 'consumable' && item.usable);
    if (!scene.itemGainedPopup || !needsDecision) return;
    this.queue.push({ item, player: player || scene.playerEntity });
    if (!scene.itemGainedPopup.visible) this.showNext();
  }

  /** 显示队首物品；队列处理完毕时派发完成回调。 */
  showNext() {
    if (this.disposed || !this.scene) return;
    const scene = this.scene;
    const popup = scene.itemGainedPopup;
    if (this.queue.length === 0) {
      popup?.hide();
      this.onQueueDrained();
      return;
    }

    const { item, player } = this.queue.shift();
    const isEquipment = item.type === 'equipment';
    const primaryLabel = isEquipment ? '立即装备'
      : (item.type === 'consumable' && item.usable ? '立即使用' : null);
    const comparison = isEquipment
      ? SceneEquipmentFlow.computeComparison(item, player)
      : [];
    const advance = operation => this._advanceAfterDecision(operation);
    const actions = [];
    if (primaryLabel) {
      actions.push({
        id: 'primary',
        label: primaryLabel,
        color: '#3a7d3a',
        onClick: () => advance(() => this.handlePrimary(item, player))
      });
    }
    actions.push({
      id: 'store',
      label: '放入背包',
      color: '#4a4a55',
      autoTriggerSeconds: 5,
      onClick: () => advance()
    });

    // 用户约定：默认选项=立即装备/立即使用（手柄焦点默认落在这里）。
    // 5 秒自动入包兜底保留（防弹窗久挂，不自动换装）。
    const defaultActionId = primaryLabel ? 'primary' : 'store';
    popup.show({
      item,
      comparison,
      actions,
      defaultActionId,
      remaining: this.queue.length
    });
  }

  /** 当前弹窗的一个决策完成后，再显示 FIFO 中的下一件，避免并发命令交叠。 */
  async _advanceAfterDecision(operation = null) {
    if (this.disposed || !this.scene) return;
    this.scene.itemGainedPopup?.hide();
    if (typeof operation === 'function') await Promise.resolve(operation());
    if (!this.disposed) this.showNext();
  }

  cancel() {
    this.queue.length = 0;
    this.scene?.itemGainedPopup?.hide();
  }

  dispose() {
    if (this.disposed) return false;
    this.cancel();
    this.disposed = true;
    this.scene = null;
    return true;
  }

  /** 保留给场景兼容入口的装备预览计算。 */
  computeEquipComparison(item, player) {
    return SceneEquipmentFlow.computeComparison(item, player);
  }

  /** 处理弹窗主操作：装备或使用。 */
  handlePrimary(item, player) {
    if (!player) {
      this.scene.itemGainedPopup?.hide();
      return;
    }
    if (item.type === 'equipment') this._equip(item, player);
    else if (item.type === 'consumable' && item.usable) this._useConsumable(item, player);
  }

  _equip(item, player) {
    const scene = this.scene;
    if (!this.executeIntent) return Promise.resolve({ ok: false, code: 'unavailable' });
    return Promise.resolve(this.executeIntent('item.equip', {
      itemId: item.id,
      instanceId: item.instanceId || null
    })).then(result => {
      if (!result?.ok) {
        if (result?.code === 'invalidEquipmentSlot') {
          scene.notificationSystem?.addWarning(`${item.name} 无法装备到该槽位`);
        }
        return result;
      }
      scene.notificationSystem?.addNotification(`装备了 ${item.name}`, 'success');
      scene._refreshEquipmentPanels?.(player);
      return result;
    });
  }

  _useConsumable(item) {
    if (!this.executeIntent) return Promise.resolve({ ok: false, code: 'unavailable' });
    return Promise.resolve(this.executeIntent('item.use', {
      itemId: item.id,
      instanceId: item.instanceId || null,
      quantity: 1
    })).then(result => {
      if (result?.ok) this.scene.notificationSystem?.addNotification(`使用了 ${item.name}`, 'success');
      return result;
    });
  }
}

export default SceneItemGainedFlow;