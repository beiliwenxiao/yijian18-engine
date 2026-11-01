/**
 * ProgressiveTipsConditions - 渐进式提示条件判断器
 * 
 * 定义所有渐进式提示的触发条件判断函数。
 * 每个条件函数接收场景实例作为参数，返回布尔值。
 * 
 * 条件函数命名规范：
 * - 触发条件：{tipId}_trigger
 * 
 * 共11个渐进式提示的触发条件
 */

export class ProgressiveTipsConditions {
  /**
   * 提示1 - 醒来（S01：等开场对话播完后再提示，避免与旁白框重叠）
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static progressive_tip_1_trigger(scene) {
    return scene.tutorialPhase === 'character_creation' && 
           scene.wakeDialogueDone &&
           !scene.tutorialsCompleted.progressive_tip_1;
  }

  /**
   * 提示2 - 移动
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static progressive_tip_2_trigger(scene) {
    return scene.tutorialsCompleted.progressive_tip_1 && 
           !scene.tutorialsCompleted.progressive_tip_2;
  }

  /**
   * 提示3 - 发现火堆
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static progressive_tip_3_trigger(scene) {
    return scene.tutorialsCompleted.progressive_tip_2 && 
           !scene.campfire.lit && 
           !scene.tutorialsCompleted.progressive_tip_3;
  }

  /**
   * 提示4 - 发现物品
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static progressive_tip_4_trigger(scene) {
    return scene.campfire.lit && 
           scene.pickupItems && 
           scene.pickupItems.length > 0 && 
           !scene.tutorialsCompleted.progressive_tip_4;
  }

  /**
   * 提示5 - 查看背包
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static progressive_tip_5_trigger(scene) {
    return scene.tutorialPhase === 'view_inventory' && 
           !scene.tutorialsCompleted.progressive_tip_5;
  }

  /**
   * 提示6 - 查看属性
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static progressive_tip_6_trigger(scene) {
    return scene.tutorialPhase === 'view_stats' && 
           !scene.tutorialsCompleted.progressive_tip_6;
  }

  /**
   * 提示7 - 使用消耗品
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static progressive_tip_7_trigger(scene) {
    return scene.tutorialPhase === 'consumable' && 
           !scene.tutorialsCompleted.progressive_tip_7;
  }

  /**
   * 提示7.1 - 关闭属性面板和背包面板
   * 完成 tip_7 后立即触发，提示玩家关闭面板
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static progressive_tip_7_1_trigger(scene) {
    // 必须完成提示7，且还没完成 7.1
    return scene.tutorialsCompleted.progressive_tip_7 && 
           !scene.tutorialsCompleted.progressive_tip_7_1;
  }

  /**
   * 提示8 - 又发现物品
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static progressive_tip_8_trigger(scene) {
    return scene.tutorialPhase === 'pickup_equipment' && 
           scene.equipmentItems && 
           scene.equipmentItems.length > 0 &&
           !scene.tutorialsCompleted.progressive_tip_8;
  }

  /**
   * 提示9 - 装备物品
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static progressive_tip_9_trigger(scene) {
    // 必须完成 tip_8（拾取装备），且背包中有装备物品
    const inventory = scene.playerEntity?.getComponent('inventory');
    let hasEquipment = false;
    
    if (inventory) {
      const items = inventory.getAllItems();
      hasEquipment = items.some(({ slot }) => 
        slot.item.type === 'equipment'
      );
    }
    
    return scene.tutorialsCompleted.progressive_tip_8 && 
           hasEquipment &&
           !scene.tutorialsCompleted.progressive_tip_9;
  }

  /**
   * 提示10 - 砍些干柴（S01：装备斧头后进入砍柴阶段）
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static progressive_tip_10_trigger(scene) {
    return scene.tutorialPhase === 'chop_wood' && 
           !scene.tutorialsCompleted.progressive_tip_10;
  }

  /**
   * 提示10.5 - 给火堆添柴（S01：拾到干柴后进入添柴阶段）
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static progressive_tip_10_5_trigger(scene) {
    return scene.tutorialPhase === 'refuel' && 
           !scene.tutorialsCompleted.progressive_tip_10_5;
  }

  /**
   * 提示10.6 - 饿狼来了（S01：添柴完成，饿狼已刷出）
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static progressive_tip_10_6_trigger(scene) {
    return scene.tutorialPhase === 'combat' && 
           scene.combatWave === 0 && 
           scene.enemyEntities && scene.enemyEntities.length > 0 &&
           !scene.tutorialsCompleted.progressive_tip_10_6;
  }

  /**
   * 提示11 - 按N键穿过枯树林（饿狼打完后）
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static progressive_tip_11_trigger(scene) {
    return scene.combatComplete && !scene.tutorialsCompleted.progressive_tip_11;
  }

  /**
   * 根据条件ID获取条件函数
   * @param {string} conditionId - 条件ID
   * @returns {Function|null}
   */
  static getCondition(conditionId) {
    if (typeof this[conditionId] === 'function') {
      return this[conditionId].bind(this);
    }
    
    console.warn(`ProgressiveTipsConditions: 未找到条件函数 - ${conditionId}`);
    return null;
  }

  /**
   * 执行条件判断
   * @param {string} conditionId - 条件ID
   * @param {Object} scene - 场景实例
   * @returns {boolean}
   */
  static evaluate(conditionId, scene) {
    const condition = this.getCondition(conditionId);
    
    if (!condition) {
      return false;
    }
    
    try {
      return condition(scene);
    } catch (error) {
      console.error(`ProgressiveTipsConditions: 条件判断出错 - ${conditionId}`, error);
      return false;
    }
  }
}

export default ProgressiveTipsConditions;
