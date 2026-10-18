/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 ************************************************************/

/**
 * SceneEquipmentFlow - 装备与物品流程（框架级）
 *
 * 覆盖三块纯逻辑：
 *   1. 槽位映射：内容侧的 subType（weapon/shield/ammo/ring）→ EquipmentComponent 真实槽位
 *   2. 属性对比：装备前后差值计算（预览用与实际变化文案用）
 *   3. 装备执行：从背包移除 → 装备 → 旧装备回背包 → 产出结构化变更信息
 *
 * 不含 UI 与事件派发：弹窗队列、通知、触发器 fire 由调用方处理。
 * 这样同一套装备语义可以被 demo 场景、AI、存档回放等多处复用。
 */

/** 内容侧 subType → EquipmentComponent 真实槽位 */
export const SLOT_MAP = {
  weapon: 'mainhand',
  shield: 'offhand',
  ammo: 'offhand',
  ring: 'ring1',
  tool: 'mainhand',
  pants: 'pants',
  skirt: 'pants',
  trinket: 'trinket1'
};

/** 参与对比展示的属性字段与中文名 */
export const COMPARE_STATS = {
  attack: '攻击',
  defense: '防御',
  maxHp: '生命',
  maxMp: '魔法',
  speed: '速度'
};

export class SceneEquipmentFlow {
  /**
   * @param {Object} [options]
   * @param {Object} [options.equipmentSystem] - EquipmentSystem 实例（走它才会重算属性）
   */
  constructor(options = {}) {
    this.equipmentSystem = options.equipmentSystem || null;
  }

  /**
   * 解析物品应装备到的真实槽位。
   * @param {Object} item
   * @returns {string}
   */
  static resolveSlot(item) {
    if (!item) return '';
    return SLOT_MAP[item.subType] || item.subType;
  }

  /**
   * 计算「装备该物品 vs 当前对应槽位」的属性差值（预览，不真正装备）。
   * @param {Object} item
   * @param {Object} player - 玩家实体
   * @returns {Array<{name:string, diff:number}>}
   */
  static computeComparison(item, player) {
    const eq = player && player.getComponent && player.getComponent('equipment');
    if (!eq) return [];

    const targetSlot = this.resolveSlot(item);
    const current = eq.getEquipment ? eq.getEquipment(targetSlot) : null;
    const curStats = (current && current.stats) || {};
    const newStats = item.stats || {};

    const out = [];
    for (const k of Object.keys(COMPARE_STATS)) {
      const diff = (newStats[k] || 0) - (curStats[k] || 0);
      if (diff !== 0) out.push({ name: COMPARE_STATS[k], diff });
    }
    return out;
  }

  /**
   * 生成属性变化文案（涨用 +，跌保留负号）。
   * @param {Object} oldStats - 变化前快照
   * @param {Object} newStats - 变化后的 stats 组件（或快照）
   * @returns {string} 如 "攻击 +5  防御 -2"，无变化返回空串
   */
  static statChangeText(oldStats, newStats) {
    if (!oldStats || !newStats) return '';
    const parts = [];
    for (const k of Object.keys(COMPARE_STATS)) {
      const diff = (newStats[k] || 0) - (oldStats[k] || 0);
      if (diff !== 0) parts.push(`${COMPARE_STATS[k]} ${diff > 0 ? '+' : ''}${diff}`);
    }
    return parts.join('  ');
  }

  /** @private 抓取参与对比的属性快照 */
  static _snapshotStats(stats) {
    if (!stats) return null;
    const snap = {};
    for (const k of Object.keys(COMPARE_STATS)) snap[k] = stats[k];
    return snap;
  }

  /**
   * 执行装备：校验槽位 → 从背包移除 → 装备 → 旧装备回背包。
   *
   * 不发通知、不刷 UI、不 fire 事件，全部交给调用方，
   * 便于同一逻辑被不同 UI 路径（拾取弹窗 / 背包点击）复用。
   *
   * @param {Object} player - 玩家实体
   * @param {Object} item - 要装备的物品（已在背包中）
   * @returns {{ok:boolean, reason?:string, slot?:string, item?:Object, oldItem?:Object, changeText?:string}}
   */
  equip(player, item) {
    if (!player || !item) return { ok: false, reason: 'invalid' };

    const eq = player.getComponent('equipment');
    const stats = player.getComponent('stats');
    const inv = player.getComponent('inventory');
    let targetSlot = SceneEquipmentFlow.resolveSlot(item);

    // 多栏自动顺延：首选槽已占用且备选栏为空时装备到备选栏
    // - 饰品（accessory）：饰品栏 → 饰品栏1 → 饰品栏2
    // - 饰物（trinket）：饰品栏1 → 饰品栏2
    if (eq) {
      if (targetSlot === 'accessory' && eq.getEquipment('accessory')
        && !eq.getEquipment('trinket1')) targetSlot = 'trinket1';
      if ((targetSlot === 'accessory' || targetSlot === 'trinket1')
        && eq.getEquipment(targetSlot) && !eq.getEquipment('trinket2')) {
        targetSlot = 'trinket2';
      }
    }

    if (eq && eq.isValidEquipmentForSlot && !eq.isValidEquipmentForSlot(item, targetSlot)) {
      return { ok: false, reason: 'invalidSlot', slot: targetSlot };
    }

    const oldStats = SceneEquipmentFlow._snapshotStats(stats);

    // 从背包移除（弹药按整组移除）
    if (inv) {
      inv.removeItem(item.id, item.subType === 'ammo' ? (item.quantity || 1) : 1);
    }

    // 走 EquipmentSystem 才会重算属性；退化路径直接用组件
    const oldItem = this.equipmentSystem
      ? this.equipmentSystem.equipItem(player, targetSlot, item)
      : (eq ? eq.equip(targetSlot, item) : null);

    // 被替换下来的旧装备回背包
    if (oldItem && inv) inv.addItem(oldItem, oldItem.quantity || 1);

    return {
      ok: true,
      slot: targetSlot,
      item,
      oldItem,
      changeText: SceneEquipmentFlow.statChangeText(oldStats, stats)
    };
  }

  /**
   * 执行卸下：从槽位取下 → 放回背包（背包满则撤销卸下）。
   * @param {Object} player
   * @param {string} slotType - 真实槽位名
   * @returns {{ok:boolean, reason?:string, slot?:string, oldItem?:Object, changeText?:string}}
   */
  unequip(player, slotType) {
    if (!player || !slotType) return { ok: false, reason: 'invalid' };

    const eq = player.getComponent('equipment');
    const stats = player.getComponent('stats');
    const inv = player.getComponent('inventory');
    if (!eq) return { ok: false, reason: 'noEquipment' };

    const current = eq.getEquipment ? eq.getEquipment(slotType) : null;
    if (!current) return { ok: false, reason: 'empty', slot: slotType };

    const oldStats = SceneEquipmentFlow._snapshotStats(stats);

    const removed = this.equipmentSystem
      ? this.equipmentSystem.unequipItem(player, slotType)
      : eq.unequip(slotType);
    if (!removed) return { ok: false, reason: 'unequipFailed', slot: slotType };

    // 背包放不下就撤销卸下，避免装备凭空消失
    if (inv) {
      const added = inv.addItem(removed, removed.quantity || 1);
      if (!added) {
        if (this.equipmentSystem) this.equipmentSystem.equipItem(player, slotType, removed);
        else eq.equip(slotType, removed);
        return { ok: false, reason: 'inventoryFull', slot: slotType };
      }
    }

    return {
      ok: true,
      slot: slotType,
      oldItem: removed,
      changeText: SceneEquipmentFlow.statChangeText(oldStats, stats)
    };
  }
}

export default SceneEquipmentFlow;
