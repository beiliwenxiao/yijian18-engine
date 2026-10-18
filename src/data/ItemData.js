/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * ItemData.js
 * 物品数据定义和管理
 */

/**
 * 物品类型枚举
 */
export const ItemType = {
  CONSUMABLE: 'consumable',  // 消耗品
  MATERIAL: 'material',      // 材料
  QUEST: 'quest',            // 任务物品
  EQUIPMENT: 'equipment'     // 装备（引用装备系统）
};

/**
 * 物品稀有度枚举
 */
export const ItemRarity = {
  COMMON: 0,
  UNCOMMON: 1,
  RARE: 2,
  EPIC: 3,
  LEGENDARY: 4
};

/**
 * 物品数据管理类
 */
export class ItemData {
  constructor() {
    this.itemTemplates = this.initItemTemplates();
  }

  /**
   * 初始化物品模板
   */
  initItemTemplates() {
    return {
      // 工具（与 library.json tool.skinning_knife 同源——掉落拾取链路需要本地模板）
      tool_skinning_knife: {
        id: 'tool.skinning_knife',
        name: '旧剥皮刀',
        type: ItemType.EQUIPMENT,
        rarity: ItemRarity.COMMON,
        description: '刃口磨损的旧剥皮刀。攻击 +5，攻击间隔缩短 1.5 秒。持有即可剥皮。',
        icon: 's01.tool.skinningKnife',
        maxStack: 1,
        subType: 'tool',
        toolType: 'skinningKnife',
        imageId: 's01.tool.skinningKnife',
        stats: { attack: 5 },
        attackSpeedReduce: { minSec: 1.5, reduceSec: 1.5, thresholdSec: 1 },
        skeletonPart: {
          bone: 'armFR',
          offset: { rot: 0, x: 0, y: 26 },
          partId: 'part.weapon.skinningKnife',
          slotId: 'weaponSkinningKnife',
          weaponKey: 'skinningKnife'
        },
        value: 15
      },
      // 消耗品
      health_potion: {
        id: 'health_potion',
        name: '生命药水',
        type: ItemType.CONSUMABLE,
        rarity: ItemRarity.COMMON,
        description: '恢复50点生命值',
        icon: 'icon_health_potion',
        maxStack: 20,
        usable: true,
        effect: {
          type: 'heal',
          value: 50
        },
        value: 10
      },
      mana_potion: {
        id: 'mana_potion',
        name: '魔法药水',
        type: ItemType.CONSUMABLE,
        rarity: ItemRarity.COMMON,
        description: '恢复30点魔法值',
        icon: 'icon_mana_potion',
        maxStack: 20,
        usable: true,
        effect: {
          type: 'restore_mana',
          value: 30
        },
        value: 8
      },
      greater_health_potion: {
        id: 'greater_health_potion',
        name: '强效生命药水',
        type: ItemType.CONSUMABLE,
        rarity: ItemRarity.UNCOMMON,
        description: '恢复150点生命值',
        icon: 'icon_greater_health_potion',
        maxStack: 10,
        usable: true,
        effect: {
          type: 'heal',
          value: 150
        },
        value: 30
      },
      speed_elixir: {
        id: 'speed_elixir',
        name: '迅捷药剂',
        type: ItemType.CONSUMABLE,
        rarity: ItemRarity.RARE,
        description: '提升30%移动速度，持续60秒',
        icon: 'icon_speed_elixir',
        maxStack: 5,
        usable: true,
        effect: {
          type: 'buff',
          stat: 'speed',
          value: 0.3,
          duration: 60
        },
        value: 50
      },
      strength_elixir: {
        id: 'strength_elixir',
        name: '力量药剂',
        type: ItemType.CONSUMABLE,
        rarity: ItemRarity.RARE,
        description: '提升20%攻击力，持续60秒',
        icon: 'icon_strength_elixir',
        maxStack: 5,
        usable: true,
        effect: {
          type: 'buff',
          stat: 'attack',
          value: 0.2,
          duration: 60
        },
        value: 50
      },

      // 材料
      slime_gel: {
        id: 'slime_gel',
        name: '史莱姆凝胶',
        type: ItemType.MATERIAL,
        rarity: ItemRarity.COMMON,
        description: '从史莱姆身上获得的粘稠物质',
        icon: 'icon_slime_gel',
        maxStack: 99,
        usable: false,
        value: 2
      },
      goblin_ear: {
        id: 'goblin_ear',
        name: '哥布林耳朵',
        type: ItemType.MATERIAL,
        rarity: ItemRarity.COMMON,
        description: '哥布林的耳朵，可以作为战利品',
        icon: 'icon_goblin_ear',
        maxStack: 99,
        usable: false,
        value: 5
      },
      bone: {
        id: 'bone',
        name: '骨头',
        type: ItemType.MATERIAL,
        rarity: ItemRarity.COMMON,
        description: '骷髅掉落的骨头',
        icon: 'icon_bone',
        maxStack: 99,
        usable: false,
        value: 3
      },
      iron_ore: {
        id: 'iron_ore',
        name: '铁矿石',
        type: ItemType.MATERIAL,
        rarity: ItemRarity.UNCOMMON,
        description: '可以用来锻造武器和护甲',
        icon: 'icon_iron_ore',
        maxStack: 50,
        usable: false,
        value: 10
      },
      magic_crystal: {
        id: 'magic_crystal',
        name: '魔法水晶',
        type: ItemType.MATERIAL,
        rarity: ItemRarity.RARE,
        description: '蕴含魔力的水晶，用于强化装备',
        icon: 'icon_magic_crystal',
        maxStack: 20,
        usable: false,
        value: 50
      },
      dragon_scale: {
        id: 'dragon_scale',
        name: '龙鳞',
        type: ItemType.MATERIAL,
        rarity: ItemRarity.EPIC,
        description: '稀有的龙鳞，极其坚硬',
        icon: 'icon_dragon_scale',
        maxStack: 10,
        usable: false,
        value: 200
      },

      // 强化材料
      basic_stone: {
        id: 'basic_stone',
        name: '基础强化石',
        type: ItemType.MATERIAL,
        rarity: ItemRarity.COMMON,
        description: '用于强化+1到+3的装备',
        icon: 'icon_basic_stone',
        maxStack: 99,
        usable: false,
        value: 20
      },
      intermediate_stone: {
        id: 'intermediate_stone',
        name: '中级强化石',
        type: ItemType.MATERIAL,
        rarity: ItemRarity.UNCOMMON,
        description: '用于强化+4到+6的装备',
        icon: 'icon_intermediate_stone',
        maxStack: 99,
        usable: false,
        value: 50
      },
      advanced_stone: {
        id: 'advanced_stone',
        name: '高级强化石',
        type: ItemType.MATERIAL,
        rarity: ItemRarity.RARE,
        description: '用于强化+7到+9的装备',
        icon: 'icon_advanced_stone',
        maxStack: 99,
        usable: false,
        value: 100
      },
      protection_scroll: {
        id: 'protection_scroll',
        name: '保护符',
        type: ItemType.MATERIAL,
        rarity: ItemRarity.RARE,
        description: '防止装备在强化失败时损坏',
        icon: 'icon_protection_scroll',
        maxStack: 20,
        usable: false,
        value: 200
      },
      blessing_scroll: {
        id: 'blessing_scroll',
        name: '祝福符',
        type: ItemType.MATERIAL,
        rarity: ItemRarity.RARE,
        description: '提高强化成功率',
        icon: 'icon_blessing_scroll',
        maxStack: 20,
        usable: false,
        value: 150
      },

      // 任务物品
      mysterious_letter: {
        id: 'mysterious_letter',
        name: '神秘信件',
        type: ItemType.QUEST,
        rarity: ItemRarity.COMMON,
        description: '一封密封的信件，需要交给村长',
        icon: 'icon_letter',
        maxStack: 1,
        usable: false,
        value: 0
      },
      ancient_key: {
        id: 'ancient_key',
        name: '古老的钥匙',
        type: ItemType.QUEST,
        rarity: ItemRarity.UNCOMMON,
        description: '一把古老的钥匙，似乎能打开某个宝箱',
        icon: 'icon_ancient_key',
        maxStack: 1,
        usable: false,
        value: 0
      }
    };
  }

  /**
   * 获取物品模板
   * @param {string} itemId - 物品ID
   * @returns {Object|null}
   */
  getItemTemplate(itemId) {
    return this.itemTemplates[itemId] || null;
  }

  /**
   * 获取所有物品模板
   * @returns {Object}
   */
  getAllItemTemplates() {
    return this.itemTemplates;
  }

  /**
   * 根据类型获取物品
   * @param {string} type - 物品类型
   * @returns {Array}
   */
  getItemsByType(type) {
    return Object.values(this.itemTemplates).filter(item => item.type === type);
  }

  /**
   * 根据稀有度获取物品
   * @param {number} rarity - 稀有度
   * @returns {Array}
   */
  getItemsByRarity(rarity) {
    return Object.values(this.itemTemplates).filter(item => item.rarity === rarity);
  }

  /**
   * 创建物品实例
   * @param {string} itemId - 物品ID
   * @param {number} quantity - 数量
   * @returns {Object|null}
   */
  createItem(itemId, quantity = 1) {
    const template = this.getItemTemplate(itemId);
    if (!template) {
      console.warn(`Item template not found: ${itemId}`);
      return null;
    }

    return {
      ...template,
      instanceId: `${itemId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      quantity: Math.min(quantity, template.maxStack)
    };
  }

  /**
   * 使用物品效果
   * @param {Object} item - 物品数据
   * @param {Entity} target - 目标实体
   * @returns {boolean} 是否成功使用
   */
  useItemEffect(item, target) {
    if (!item.usable || !item.effect) return false;

    const statsComponent = target.getComponent('stats');
    if (!statsComponent) return false;

    switch (item.effect.type) {
      case 'heal':
        statsComponent.heal(item.effect.value);
        return true;
      
      case 'restore_mana':
        statsComponent.restoreMana(item.effect.value);
        return true;
      
      case 'buff':
        // 这里需要状态效果系统支持
        // 暂时简化处理
        return true;
      
      default:
        return false;
    }
  }
}