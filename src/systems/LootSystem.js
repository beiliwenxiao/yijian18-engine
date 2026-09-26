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
 * LootSystem.js
 * 掉落系统 - 管理物品掉落和拾取
 */

import { RNG } from '../core/RNG.js';

/**
 * 掉落表项
 */
class LootTableEntry {
  constructor(itemId, chance, minQuantity = 1, maxQuantity = 1, rng = null) {
    this.itemId = itemId;
    this.chance = chance; // 掉落概率 (0-1)
    this.minQuantity = minQuantity;
    this.maxQuantity = maxQuantity;
    // 掉落随机：注入 rng（RNG 实例）时走确定性序列，否则默认内部非权威 RNG
    this.rng = rng || new RNG();
  }

  /** [0,1) 掉落随机 */
  _rng() {
    return this.rng.next();
  }

  /**
   * 检查是否掉落
   * @returns {boolean}
   */
  shouldDrop() {
    return this._rng() < this.chance;
  }

  /**
   * 获取掉落数量
   * @returns {number}
   */
  getDropQuantity() {
    return this.rng.int(this.minQuantity, this.maxQuantity);
  }
}

/**
 * 掉落表
 */
class LootTable {
  constructor(entries = [], rng = null) {
    this.rng = rng;
    this.entries = entries.map(entry => {
      if (entry instanceof LootTableEntry) {
        return entry;
      }
      return new LootTableEntry(entry.itemId, entry.chance, entry.minQuantity, entry.maxQuantity, rng);
    });
  }

  /**
   * 添加掉落项
   * @param {string} itemId - 物品ID
   * @param {number} chance - 掉落概率
   * @param {number} minQuantity - 最小数量
   * @param {number} maxQuantity - 最大数量
   */
  addEntry(itemId, chance, minQuantity = 1, maxQuantity = 1) {
    this.entries.push(new LootTableEntry(itemId, chance, minQuantity, maxQuantity, this.rng));
  }

  /**
   * 生成掉落物品
   * @returns {Array} 掉落的物品列表
   */
  generateLoot() {
    const loot = [];
    
    for (const entry of this.entries) {
      if (entry.shouldDrop()) {
        loot.push({
          itemId: entry.itemId,
          quantity: entry.getDropQuantity()
        });
      }
    }
    
    return loot;
  }
}

/**
 * 地面物品实体
 */
class GroundItem {
  constructor(item, position, options = {}) {
    this.id = `ground_item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.item = item;
    this.quantity = options.quantity || 1;
    this.position = { ...position };
    this.createdTime = Date.now();
    this.lifetime = options.lifetime || 300000; // 5分钟默认生存时间
    this.pickupRange = options.pickupRange || 30;
    this.autoPickup = options.autoPickup || false;
    this.owner = options.owner || null; // 拾取权限所有者
    this.ownershipTime = options.ownershipTime || 10000; // 10秒所有权时间
  }

  /**
   * 检查是否过期
   * @returns {boolean}
   */
  isExpired() {
    return Date.now() - this.createdTime > this.lifetime;
  }

  /**
   * 检查是否可以被拾取
   * @param {Entity} entity - 拾取者
   * @returns {boolean}
   */
  canBePickedUp(entity) {
    // 检查所有权
    if (this.owner && Date.now() - this.createdTime < this.ownershipTime) {
      return entity.id === this.owner;
    }
    return true;
  }

  /**
   * 检查是否在拾取范围内
   * @param {Object} position - 位置
   * @returns {boolean}
   */
  isInRange(position) {
    const dx = position.x - this.position.x;
    const dy = position.y - this.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance <= this.pickupRange;
  }
}

/**
 * 掉落系统
 */
export class LootSystem {
  constructor(mockDataService, rng = null) {
    this.name = 'LootSystem';
    this.mockDataService = mockDataService;
    // 掉落随机：注入 rng（RNG 实例）时走确定性序列，否则默认内部非权威 RNG
    this.rng = rng || new RNG();
    this.groundItems = new Map(); // 地面物品
    this.lootTables = this.initLootTables();
    
    // 自动拾取设置
    this.autoPickupEnabled = true;
    this.autoPickupRange = 50;
  }

  /**
   * 初始化掉落表
   */
  initLootTables() {
    return {
      // 史莱姆掉落表
      slime: new LootTable([
        { itemId: 'slime_gel', chance: 0.8, minQuantity: 1, maxQuantity: 3 },
        { itemId: 'health_potion', chance: 0.2, minQuantity: 1, maxQuantity: 1 }
      ], this.rng),
      
      // 哥布林掉落表
      goblin: new LootTable([
        { itemId: 'goblin_ear', chance: 0.6, minQuantity: 1, maxQuantity: 2 },
        { itemId: 'iron_ore', chance: 0.3, minQuantity: 1, maxQuantity: 1 },
        { itemId: 'rusty_sword', chance: 0.1, minQuantity: 1, maxQuantity: 1 },
        { itemId: 'mana_potion', chance: 0.15, minQuantity: 1, maxQuantity: 1 }
      ], this.rng),
      
      // 骷髅掉落表
      skeleton: new LootTable([
        { itemId: 'bone', chance: 0.9, minQuantity: 2, maxQuantity: 4 },
        { itemId: 'iron_sword', chance: 0.15, minQuantity: 1, maxQuantity: 1 },
        { itemId: 'greater_health_potion', chance: 0.1, minQuantity: 1, maxQuantity: 1 },
        { itemId: 'magic_crystal', chance: 0.05, minQuantity: 1, maxQuantity: 1 }
      ], this.rng)
    };
  }

  /**
   * 更新掉落系统
   * @param {number} deltaTime - 帧间隔时间
   * @param {Array} entities - 实体数组
   */
  update(deltaTime, entities) {
    // 清理过期的地面物品
    this.cleanupExpiredItems();
    
    // 处理自动拾取
    if (this.autoPickupEnabled) {
      this.processAutoPickup(entities);
    }
  }

  /**
   * 渲染地面物品
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} camera - 相机对象
   */
  render(ctx, camera) {
    ctx.save();
    
    for (const groundItem of this.groundItems.values()) {
      this.renderGroundItem(ctx, groundItem, camera);
    }
    
    ctx.restore();
  }

  /**
   * 渲染单个地面物品
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {GroundItem} groundItem - 地面物品
   * @param {Object} camera - 相机对象
   */
  renderGroundItem(ctx, groundItem, camera) {
    const screenX = groundItem.position.x - (camera ? camera.x : 0);
    const screenY = groundItem.position.y - (camera ? camera.y : 0);
    
    // 物品背景光圈
    const time = Date.now() * 0.003;
    const pulseAlpha = 0.3 + 0.2 * Math.sin(time);
    
    ctx.globalAlpha = pulseAlpha;
    ctx.fillStyle = this.getItemRarityColor(groundItem.item);
    ctx.beginPath();
    ctx.arc(screenX, screenY, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
    
    // 物品图标（简化为文字）
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(groundItem.item.name.substring(0, 2), screenX, screenY + 4);
    
    // 数量显示
    if (groundItem.quantity > 1) {
      ctx.fillStyle = '#ffff00';
      ctx.font = 'bold 10px Arial';
      ctx.fillText(groundItem.quantity.toString(), screenX + 12, screenY - 8);
    }
    
    // 拾取提示
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px Arial';
    ctx.fillText(groundItem.item.name, screenX, screenY + 25);
  }

  /**
   * 获取物品稀有度颜色
   * @param {Object} item - 物品数据
   * @returns {string}
   */
  getItemRarityColor(item) {
    const colors = ['#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000'];
    return colors[item.rarity] || '#ffffff';
  }

  /**
   * 敌人死亡时掉落物品
   * @param {Entity} enemy - 敌人实体
   * @param {Entity} killer - 击杀者
   */
  dropLootFromEnemy(enemy, killer = null) {
    const templateId = enemy.templateId;
    const lootTable = this.lootTables[templateId];
    
    if (!lootTable) {
      console.warn(`No loot table found for enemy: ${templateId}`);
      return;
    }
    
    const loot = lootTable.generateLoot();
    const transform = enemy.getComponent('transform');
    const position = transform ? transform.position : { x: 0, y: 0 };
    
    // 在敌人位置周围散布掉落物品
    for (let i = 0; i < loot.length; i++) {
      const lootItem = loot[i];
      const item = this.mockDataService.getItemData(lootItem.itemId);
      
      if (item) {
        // 随机偏移位置
        const angle = (Math.PI * 2 * i) / loot.length + Math.random() * 0.5;
        const distance = 20 + Math.random() * 30;
        const dropPosition = {
          x: position.x + Math.cos(angle) * distance,
          y: position.y + Math.sin(angle) * distance
        };
        
        this.createGroundItem(item, dropPosition, {
          quantity: lootItem.quantity,
          owner: killer ? killer.id : null
        });
      }
    }
  }

  /**
   * 创建地面物品
   * @param {Object} item - 物品数据
   * @param {Object} position - 位置
   * @param {Object} options - 选项
   * @returns {GroundItem}
   */
  createGroundItem(item, position, options = {}) {
    const groundItem = new GroundItem(item, position, options);
    this.groundItems.set(groundItem.id, groundItem);
    return groundItem;
  }

  /**
   * 尝试拾取物品
   * @param {Entity} entity - 拾取者
   * @param {string} groundItemId - 地面物品ID
   * @returns {boolean} 是否成功拾取
   */
  pickupItem(entity, groundItemId) {
    const groundItem = this.groundItems.get(groundItemId);
    if (!groundItem) return false;
    
    const transform = entity.getComponent('transform');
    if (!transform) return false;
    
    // 检查距离
    if (!groundItem.isInRange(transform.position)) {
      return false;
    }
    
    // 检查拾取权限
    if (!groundItem.canBePickedUp(entity)) {
      return false;
    }
    
    // 尝试添加到背包
    const inventory = entity.getComponent('inventory');
    if (!inventory) return false;
    
    const addedQuantity = inventory.addItem(groundItem.item, groundItem.quantity);
    
    if (addedQuantity > 0) {
      // 更新地面物品数量
      groundItem.quantity -= addedQuantity;
      
      // 如果完全拾取，移除地面物品
      if (groundItem.quantity <= 0) {
        this.groundItems.delete(groundItemId);
      }
      
      console.log(`${entity.name || 'Entity'} 拾取了 ${addedQuantity} 个 ${groundItem.item.name}`);
      return true;
    }
    
    return false;
  }

  /**
   * 处理自动拾取
   * @param {Array} entities - 实体数组
   */
  processAutoPickup(entities) {
    const players = entities.filter(entity => entity.type === 'player');
    
    for (const player of players) {
      const transform = player.getComponent('transform');
      if (!transform) continue;
      
      // 查找范围内的地面物品
      for (const groundItem of this.groundItems.values()) {
        if (groundItem.autoPickup && groundItem.isInRange(transform.position)) {
          this.pickupItem(player, groundItem.id);
        }
      }
    }
  }

  /**
   * 获取范围内的地面物品
   * @param {Object} position - 位置
   * @param {number} range - 范围
   * @returns {Array} 地面物品列表
   */
  getGroundItemsInRange(position, range) {
    const items = [];
    
    for (const groundItem of this.groundItems.values()) {
      const dx = position.x - groundItem.position.x;
      const dy = position.y - groundItem.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= range) {
        items.push(groundItem);
      }
    }
    
    return items;
  }

  /**
   * 清理过期物品
   */
  cleanupExpiredItems() {
    for (const [id, groundItem] of this.groundItems.entries()) {
      if (groundItem.isExpired()) {
        this.groundItems.delete(id);
      }
    }
  }

  /**
   * 手动丢弃物品
   * @param {Entity} entity - 丢弃者
   * @param {Object} item - 物品数据
   * @param {number} quantity - 数量
   * @param {Object} position - 丢弃位置
   */
  dropItem(entity, item, quantity, position) {
    // 随机偏移位置避免重叠
    const angle = Math.random() * Math.PI * 2;
    const distance = 20 + Math.random() * 20;
    const dropPosition = {
      x: position.x + Math.cos(angle) * distance,
      y: position.y + Math.sin(angle) * distance
    };
    
    this.createGroundItem(item, dropPosition, {
      quantity: quantity,
      owner: entity.id,
      ownershipTime: 5000 // 5秒所有权
    });
  }

  /**
   * 获取所有地面物品
   * @returns {Array}
   */
  getAllGroundItems() {
    return Array.from(this.groundItems.values());
  }

  /**
   * 清理所有地面物品
   */
  clearAllGroundItems() {
    this.groundItems.clear();
  }

  /**
   * 设置自动拾取
   * @param {boolean} enabled - 是否启用
   * @param {number} range - 拾取范围
   */
  setAutoPickup(enabled, range = 50) {
    this.autoPickupEnabled = enabled;
    this.autoPickupRange = range;
  }
}