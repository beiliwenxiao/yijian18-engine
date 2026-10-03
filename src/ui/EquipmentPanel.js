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
 * EquipmentPanel.js
 * 装备栏UI组件 - 显示和管理角色装备
 */

import { UIElement } from './UIElement.js';
import { QualityColors } from '../data/EquipmentData.js';
import { ItemIconRenderer } from './ItemIconRenderer.js';

/**
 * 装备栏面板
 */
export class EquipmentPanel extends UIElement {
  /**
   * @param {Object} options - 配置选项
   */
  constructor(options = {}) {
    super({
      x: options.x || 50,
      y: options.y || 50,
      width: options.width || 300,
      height: options.height || 400,
      visible: options.visible || false,
      zIndex: options.zIndex || 100
    });

    this.title = '装备栏';
    this.entity = null; // 当前显示装备的实体
    this.slotSize = 48; // 装备槽大小
    this.slotPadding = 8; // 装备槽间距
    
    // 装备槽位布局 - 相对于面板的位置，居中对齐
    // 面板宽度 180px，槽位 48px，三列布局
    const centerX = this.width / 2; // 90
    const slotWithPadding = this.slotSize + this.slotPadding; // 56
    
    this.slotLayout = {
      helmet:     { x: centerX - this.slotSize / 2, y: 50 },  // 顶部居中
      weapon:     { x: centerX - slotWithPadding - this.slotSize / 2, y: 106 },  // 左
      armor:      { x: centerX - this.slotSize / 2, y: 106 },  // 中
      gloves:     { x: centerX + this.slotPadding + this.slotSize / 2, y: 106 },  // 右
      boots:      { x: centerX - this.slotSize / 2, y: 162 },  // 底部居中
      accessory1: { x: centerX - slotWithPadding - this.slotSize / 2, y: 218 },  // 左
      accessory2: { x: centerX - this.slotSize / 2, y: 218 },  // 中
      accessory3: { x: centerX + this.slotPadding + this.slotSize / 2, y: 218 }   // 右
    };

    // 鼠标交互
    this.hoveredSlot = null;
    this.selectedSlot = null;
    this.draggedItem = null;
    this.mouseX = 0;
    this.mouseY = 0;
    
    // 事件回调
    this.onEquipmentChange = options.onEquipmentChange || null;
    this.onSlotClick = options.onSlotClick || null;
  }

  /**
   * 设置显示的实体
   * @param {Entity} entity - 实体对象
   */
  setEntity(entity) {
    this.entity = entity;
  }

  /**
   * 更新装备面板
   * @param {number} deltaTime - 帧间隔时间
   */
  update(deltaTime) {
    if (!this.visible || !this.entity) return;

    // 这里可以添加动画更新逻辑
  }

  /**
   * 渲染装备面板
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  render(ctx) {
    if (!this.visible) return;

    ctx.save();

    // 绘制面板背景
    this.renderBackground(ctx);
    
    // 绘制标题
    this.renderTitle(ctx);
    
    // 绘制装备槽位
    this.renderEquipmentSlots(ctx);
    
    // 绘制装备
    this.renderEquipment(ctx);
    
    // 绘制悬停效果
    this.renderHoverEffect(ctx);

    ctx.restore();
  }

  /**
   * 渲染背景
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderBackground(ctx) {
    // 背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    
    // 边框
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.strokeRect(this.x, this.y, this.width, this.height);
  }

  /**
   * 渲染标题
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderTitle(ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(this.title, this.x + this.width / 2, this.y + 25);
  }

  /**
   * 渲染装备槽位
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderEquipmentSlots(ctx) {
    for (const slotType in this.slotLayout) {
      const slot = this.slotLayout[slotType];
      const slotX = this.x + slot.x;
      const slotY = this.y + slot.y;

      // 槽位背景
      ctx.fillStyle = this.hoveredSlot === slotType ? 'rgba(255, 255, 255, 0.2)' : 'rgba(100, 100, 100, 0.5)';
      ctx.fillRect(slotX, slotY, this.slotSize, this.slotSize);
      
      // 槽位边框
      ctx.strokeStyle = this.selectedSlot === slotType ? '#ffff00' : '#888';
      ctx.lineWidth = 1;
      ctx.strokeRect(slotX, slotY, this.slotSize, this.slotSize);

      // 槽位标签
      ctx.fillStyle = '#cccccc';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(this.getSlotLabel(slotType), slotX + this.slotSize / 2, slotY + this.slotSize + 12);
    }
  }

  /**
   * 渲染装备
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderEquipment(ctx) {
    if (!this.entity) return;

    const equipmentComponent = this.entity.getComponent('equipment');
    if (!equipmentComponent) return;

    for (const slotType in this.slotLayout) {
      const equipment = equipmentComponent.getEquipment(slotType);
      if (equipment) {
        const slot = this.slotLayout[slotType];
        const slotX = this.x + slot.x;
        const slotY = this.y + slot.y;

        this.renderEquipmentItem(ctx, equipment, slotX, slotY);
      }
    }
  }

  /**
   * 渲染装备物品
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} equipment - 装备数据
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   */
  renderEquipmentItem(ctx, equipment, x, y) {
    // 装备背景（根据品质显示颜色）
    ctx.fillStyle = QualityColors[equipment.quality] || '#ffffff';
    ctx.globalAlpha = 0.3;
    ctx.fillRect(x + 2, y + 2, this.slotSize - 4, this.slotSize - 4);
    ctx.globalAlpha = 1.0;

    // 尝试绘制装备图标
    const iconDrawn = this.drawEquipmentIcon(ctx, equipment, x, y);

    if (!iconDrawn) {
      // 没有专用图标，使用文字
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(equipment.name.substring(0, 2), x + this.slotSize / 2, y + this.slotSize / 2 + 4);
    }

    // 强化等级
    if (equipment.enhancement > 0) {
      ctx.fillStyle = '#00ff00';
      ctx.font = '10px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(`+${equipment.enhancement}`, x + this.slotSize - 2, y + 12);
    }

    // 耐久度条
    if (equipment.durability < 100) {
      const durabilityWidth = (this.slotSize - 4) * (equipment.durability / 100);
      ctx.fillStyle = equipment.durability > 50 ? '#00ff00' : equipment.durability > 20 ? '#ffff00' : '#ff0000';
      ctx.fillRect(x + 2, y + this.slotSize - 6, durabilityWidth, 2);
    }

    // 数量显示（箭矢等可堆叠装备）
    if (equipment.quantity != null && equipment.quantity > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${equipment.quantity}`, x + this.slotSize - 3, y + this.slotSize - 3);
      ctx.textBaseline = 'alphabetic';
    }
  }

  /**
   * 绘制装备图标
   */
  drawEquipmentIcon(ctx, equipment, x, y) {
    const cx = x + this.slotSize / 2;
    const cy = y + this.slotSize / 2;
    return ItemIconRenderer.drawIcon(ctx, equipment, cx, cy, this.slotSize);
  }

  /**
   * 渲染悬停效果
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderHoverEffect(ctx) {
    if (this.hoveredSlot && this.entity) {
      const equipmentComponent = this.entity.getComponent('equipment');
      if (equipmentComponent) {
        const equipment = equipmentComponent.getEquipment(this.hoveredSlot);
        if (equipment) {
          this.renderTooltip(ctx, equipment);
        }
      }
    }
  }

  /**
   * 渲染装备提示框
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} equipment - 装备数据
   */
  renderTooltip(ctx, equipment) {
    const tooltipWidth = 250;
    const tooltipHeight = 150;
    
    // 获取canvas尺寸
    const canvas = document.getElementById('gameCanvas');
    const canvasWidth = canvas ? canvas.width : 800;
    const canvasHeight = canvas ? canvas.height : 600;
    
    // 默认显示在鼠标右侧
    let tooltipX = this.mouseX + 15;
    let tooltipY = this.mouseY - 20;
    
    // 如果超出右边界，显示在鼠标左侧
    if (tooltipX + tooltipWidth > canvasWidth) {
      tooltipX = this.mouseX - tooltipWidth - 15;
    }
    
    // 如果左侧也超出，显示在装备面板右侧
    if (tooltipX < 0) {
      tooltipX = this.x + this.width + 10;
      // 如果装备面板右侧也超出，显示在装备面板左侧
      if (tooltipX + tooltipWidth > canvasWidth) {
        tooltipX = this.x - tooltipWidth - 10;
      }
    }
    
    // 如果超出下边界，向上调整
    if (tooltipY + tooltipHeight > canvasHeight) {
      tooltipY = canvasHeight - tooltipHeight - 10;
    }
    
    // 如果超出上边界，向下调整
    if (tooltipY < 0) {
      tooltipY = 10;
    }

    // 提示框背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
    
    // 提示框边框
    ctx.strokeStyle = QualityColors[equipment.quality] || '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);

    // 装备名称
    ctx.fillStyle = QualityColors[equipment.quality] || '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(equipment.name, tooltipX + 10, tooltipY + 20);

    // 装备等级和品质
    ctx.fillStyle = '#cccccc';
    ctx.font = '11px Arial';
    const qualityNames = ['普通', '不凡', '稀有', '史诗', '传说'];
    const qualityText = qualityNames[equipment.quality] || '未知';
    ctx.fillText(`等级 ${equipment.level} | ${qualityText}`, tooltipX + 10, tooltipY + 35);

    // 装备描述
    if (equipment.description) {
      ctx.fillStyle = '#aaaaaa';
      ctx.font = '10px Arial';
      this.wrapText(ctx, equipment.description, tooltipX + 10, tooltipY + 50, tooltipWidth - 20, 12);
    }

    // 装备属性
    let yOffset = 75;
    ctx.fillStyle = '#ffffff';
    ctx.font = '11px Arial';
    
    if (equipment.stats) {
      ctx.fillStyle = '#ffff00';
      ctx.fillText('属性:', tooltipX + 10, tooltipY + yOffset);
      yOffset += 15;
      
      ctx.fillStyle = '#ffffff';
      if (equipment.stats.attack) {
        ctx.fillText(`攻击力: +${equipment.stats.attack}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      if (equipment.stats.defense) {
        ctx.fillText(`防御力: +${equipment.stats.defense}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      if (equipment.stats.maxHp) {
        ctx.fillText(`生命值: +${equipment.stats.maxHp}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      if (equipment.stats.maxMp) {
        ctx.fillText(`魔法值: +${equipment.stats.maxMp}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      if (equipment.stats.speed) {
        ctx.fillText(`速度: +${equipment.stats.speed}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      
      // 特殊属性（穿刺、多重箭等）
      if (equipment.pierce) {
        ctx.fillStyle = '#ff8800';
        ctx.fillText(`穿刺: ${equipment.pierce}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      if (equipment.multishot) {
        ctx.fillStyle = '#ff8800';
        ctx.fillText(`多重箭: ${equipment.multishot}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      // 条件加速词条（如狼牙：攻击间隔慢于1秒时缩短1.5秒）
      if (equipment.attackSpeedReduce && equipment.attackSpeedReduce.reduceSec > 0) {
        const threshold = equipment.attackSpeedReduce.thresholdSec ?? 1;
        ctx.fillStyle = '#66ffcc';
        ctx.fillText(`攻速强化: 攻击间隔慢于${threshold}秒时，缩短${equipment.attackSpeedReduce.reduceSec}秒`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }

      // 元素属性
      if (equipment.stats.elementAttack) {
        const elementNames = ['火', '爆', '水', '冰', '风', '电', '暴风', '雷电', '雷暴', '土', '滚石', '木', '落木'];
        for (const elementType in equipment.stats.elementAttack) {
          const value = equipment.stats.elementAttack[elementType];
          const elementName = elementNames[elementType] || `元素${elementType}`;
          ctx.fillStyle = '#ff8800';
          ctx.fillText(`${elementName}攻击: +${value}`, tooltipX + 15, tooltipY + yOffset);
          yOffset += 12;
        }
      }
    } else {
      ctx.fillStyle = '#ff0000';
      ctx.fillText('无属性数据', tooltipX + 15, tooltipY + yOffset);
    }
  }

  /**
   * 文字换行
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {string} text - 文本
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} maxWidth - 最大宽度
   * @param {number} lineHeight - 行高
   */
  wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split('');
    let line = '';
    let currentY = y;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i];
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;

      if (testWidth > maxWidth && i > 0) {
        ctx.fillText(line, x, currentY);
        line = words[i];
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
  }

  /**
   * 获取槽位标签
   * @param {string} slotType - 槽位类型
   * @returns {string}
   */
  getSlotLabel(slotType) {
    const labels = {
      weapon: '武器',
      armor: '护甲',
      helmet: '头盔',
      boots: '靴子',
      gloves: '手套',
      accessory1: '饰品1',
      accessory2: '饰品2',
      accessory3: '饰品3'
    };
    return labels[slotType] || slotType;
  }

  /**
   * 处理鼠标移动事件
   * @param {number} x - 鼠标X坐标
   * @param {number} y - 鼠标Y坐标
   */
  handleMouseMove(x, y) {
    if (!this.visible) return;

    // 保存鼠标位置
    this.mouseX = x;
    this.mouseY = y;

    this.hoveredSlot = null;

    // 检查是否悬停在装备槽上
    for (const slotType in this.slotLayout) {
      const slot = this.slotLayout[slotType];
      const slotX = this.x + slot.x;
      const slotY = this.y + slot.y;

      if (x >= slotX && x <= slotX + this.slotSize &&
          y >= slotY && y <= slotY + this.slotSize) {
        this.hoveredSlot = slotType;
        break;
      }
    }
  }

  /**
   * 处理鼠标点击事件
   * @param {number} x - 鼠标X坐标
   * @param {number} y - 鼠标Y坐标
   * @returns {boolean} 是否处理了点击事件
   */
  handleMouseClick(x, y) {
    if (!this.visible || !this.containsPoint(x, y)) return false;

    // 检查是否点击了装备槽
    for (const slotType in this.slotLayout) {
      const slot = this.slotLayout[slotType];
      const slotX = this.x + slot.x;
      const slotY = this.y + slot.y;

      if (x >= slotX && x <= slotX + this.slotSize &&
          y >= slotY && y <= slotY + this.slotSize) {
        this.selectedSlot = slotType;
        
        // 尝试卸下装备
        if (this.entity) {
          const equipmentComponent = this.entity.getComponent('equipment');
          const inventoryComponent = this.entity.getComponent('inventory');
          
          if (equipmentComponent && inventoryComponent) {
            const equipment = equipmentComponent.getEquipment(slotType);
            
            if (equipment) {
              console.log(`尝试卸下装备: ${equipment.name} 从 ${slotType} 槽位`);
              
              // 保存卸下前的属性
              const statsComponent = this.entity.getComponent('stats');
              const oldStats = statsComponent ? {
                attack: statsComponent.attack,
                defense: statsComponent.defense,
                maxHp: statsComponent.maxHp,
                maxMp: statsComponent.maxMp,
                speed: statsComponent.speed
              } : null;
              
              // 卸下装备
              const unequippedItem = equipmentComponent.unequip(slotType);
              
              if (unequippedItem) {
                // 放回背包（箭矢等弹药类需要传入 quantity）
                const addQuantity = unequippedItem.quantity || 1;
                const added = inventoryComponent.addItem(unequippedItem, addQuantity);
                
                if (added > 0) {
                  console.log(`成功卸下装备: ${unequippedItem.name}，已放回背包`);
                  
                  // 更新玩家属性（移除装备加成）
                  if (statsComponent) {
                    this.updateEntityStats(equipmentComponent, statsComponent);
                    
                    // 计算属性变化并显示提示
                    const statChanges = this.calculateStatChanges(oldStats, statsComponent);
                    this.showEquipmentNotification(null, unequippedItem.name, statChanges);
                  }
                } else {
                  console.warn(`背包已满，无法卸下装备: ${unequippedItem.name}`);
                  // 如果背包满了，重新装备
                  equipmentComponent.equip(slotType, unequippedItem);
                }
              }
            }
          }
        }
        
        if (this.onSlotClick) {
          this.onSlotClick(slotType);
        }
        return true;
      }
    }

    return true; // 阻止事件传播
  }

  /**
   * 切换面板显示状态
   */
  toggle() {
    this.visible = !this.visible;
  }

  /**
   * 显示面板
   */
  show() {
    this.visible = true;
  }

  /**
   * 隐藏面板
   */
  hide() {
    this.visible = false;
  }

  /**
   * 更新实体属性（应用装备加成）
   * @param {Object} equipmentComponent - 装备组件
   * @param {Object} statsComponent - 属性组件
   */
  updateEntityStats(equipmentComponent, statsComponent) {
    if (!equipmentComponent || !statsComponent) return;

    // 先重置到基础属性
    statsComponent.resetToBaseStats();

    // 获取装备属性加成
    const bonusStats = equipmentComponent.getBonusStats();
    
    // 保存当前HP/MP比例
    const hpRatio = statsComponent.maxHp > 0 ? statsComponent.hp / statsComponent.maxHp : 1;
    const mpRatio = statsComponent.maxMp > 0 ? statsComponent.mp / statsComponent.maxMp : 1;
    
    // 应用装备加成
    if (bonusStats.attack) {
      statsComponent.attack += bonusStats.attack;
    }
    if (bonusStats.defense) {
      statsComponent.defense += bonusStats.defense;
    }
    if (bonusStats.maxHp) {
      statsComponent.maxHp += bonusStats.maxHp;
      statsComponent.hp = Math.floor(statsComponent.maxHp * hpRatio);
    }
    if (bonusStats.maxMp) {
      statsComponent.maxMp += bonusStats.maxMp;
      statsComponent.mp = Math.floor(statsComponent.maxMp * mpRatio);
    }
    if (bonusStats.speed) {
      statsComponent.speed += bonusStats.speed;
    }
    
    console.log('EquipmentPanel: 更新实体属性', {
      attack: statsComponent.attack,
      defense: statsComponent.defense,
      maxHp: statsComponent.maxHp,
      speed: statsComponent.speed
    });
  }

  /**
   * 计算属性变化
   * @param {Object} oldStats - 旧属性
   * @param {Object} newStats - 新属性组件
   * @returns {Object} 属性变化对象
   */
  calculateStatChanges(oldStats, newStats) {
    if (!oldStats || !newStats) return {};
    
    const changes = {};
    const statNames = {
      attack: '攻击',
      defense: '防御',
      maxHp: '生命',
      maxMp: '魔法',
      speed: '速度'
    };
    
    for (const stat in statNames) {
      const diff = newStats[stat] - oldStats[stat];
      if (diff !== 0) {
        changes[stat] = {
          name: statNames[stat],
          value: diff
        };
      }
    }
    
    return changes;
  }

  /**
   * 显示装备通知
   * @param {string} equipName - 装备的物品名称
   * @param {string} unequipName - 卸下的物品名称
   * @param {Object} statChanges - 属性变化
   */
  showEquipmentNotification(equipName, unequipName, statChanges) {
    // 构建通知消息
    let messages = [];
    
    if (unequipName) {
      messages.push(`卸下了 ${unequipName}`);
    }
    
    // 添加属性变化
    const changeTexts = [];
    for (const stat in statChanges) {
      const change = statChanges[stat];
      if (change.value > 0) {
        changeTexts.push(`${change.name} +${change.value}`);
      } else {
        changeTexts.push(`${change.name} ${change.value}`);
      }
    }
    
    if (changeTexts.length > 0) {
      messages.push(changeTexts.join(' '));
    }
    
    // 输出到控制台
    console.log('装备变化:', messages.join(' | '));
    
    // 触发通知回调
    if (this.onEquipmentChange) {
      this.onEquipmentChange(messages);
    }
  }
}