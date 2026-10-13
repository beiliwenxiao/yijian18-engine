/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-02-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * EnhancementPanel.js
 * 装备强化UI组件
 */

import { Logger } from '../core/Logger.js';
import { UIElement } from './UIElement.js';
import { EnhancementResult } from '../systems/EnhancementSystem.js';

/**
 * 装备强化面板
 */
export class EnhancementPanel extends UIElement {
  /**
   * @param {Object} options - 配置选项
   */
  constructor(options = {}) {
    super({
      x: options.x || 100,
      y: options.y || 100,
      width: options.width || 500,
      height: options.height || 600,
      visible: options.visible || false,
      zIndex: options.zIndex || 150
    });

    this.title = '装备强化';
    this.enhancementSystem = options.enhancementSystem;
    this.entity = null;
    
    // 当前选中的装备
    this.selectedEquipment = null;
    this.selectedSlotType = null;
    
    // 强化材料槽位
    this.materialSlots = [
      { x: 50, y: 200, width: 40, height: 40, material: null },
      { x: 100, y: 200, width: 40, height: 40, material: null },
      { x: 150, y: 200, width: 40, height: 40, material: null }
    ];
    
    // 强化按钮
    this.enhanceButton = {
      x: 200,
      y: 350,
      width: 100,
      height: 40,
      enabled: false
    };
    
    // 预览信息
    this.previewInfo = null;
    
    // 动画状态
    this.animationState = {
      isAnimating: false,
      type: null, // 'success', 'failure', 'destroyed'
      progress: 0,
      duration: 2000
    };
    
    // 事件回调
    this.onEnhancementComplete = options.onEnhancementComplete || null;
  }

  /**
   * 设置显示的实体
   * @param {Entity} entity - 实体对象
   */
  setEntity(entity) {
    this.entity = entity;
    this.updatePreview();
  }

  /**
   * 设置选中的装备
   * @param {Object} equipment - 装备数据
   * @param {string} slotType - 槽位类型
   */
  setSelectedEquipment(equipment, slotType) {
    this.selectedEquipment = equipment;
    this.selectedSlotType = slotType;
    this.clearMaterials();
    this.updatePreview();
  }

  /**
   * 更新强化面板
   * @param {number} deltaTime - 帧间隔时间
   */
  update(deltaTime) {
    if (!this.visible) return;

    // 更新动画
    if (this.animationState.isAnimating) {
      this.animationState.progress += deltaTime;
      if (this.animationState.progress >= this.animationState.duration) {
        this.animationState.isAnimating = false;
        this.animationState.progress = 0;
      }
    }

    // 更新预览信息
    this.updatePreview();
  }

  /**
   * 渲染强化面板
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  render(ctx) {
    if (!this.visible) return;

    ctx.save();

    // 绘制面板背景
    this.renderBackground(ctx);
    
    // 绘制标题
    this.renderTitle(ctx);
    
    // 绘制装备信息
    this.renderEquipmentInfo(ctx);
    
    // 绘制材料槽位
    this.renderMaterialSlots(ctx);
    
    // 绘制预览信息
    this.renderPreviewInfo(ctx);
    
    // 绘制强化按钮
    this.renderEnhanceButton(ctx);
    
    // 绘制动画效果
    this.renderAnimation(ctx);

    ctx.restore();
  }

  /**
   * 渲染背景
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderBackground(ctx) {
    // 背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
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
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(this.title, this.x + this.width / 2, this.y + 30);
  }

  /**
   * 渲染装备信息
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderEquipmentInfo(ctx) {
    if (!this.selectedEquipment) {
      ctx.fillStyle = '#cccccc';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('请选择要强化的装备', this.x + this.width / 2, this.y + 100);
      return;
    }

    const equipment = this.selectedEquipment;
    const startY = this.y + 70;

    // 装备名称和强化等级
    ctx.fillStyle = this.getQualityColor(equipment.quality);
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    const enhancementText = equipment.enhancement > 0 ? ` +${equipment.enhancement}` : '';
    ctx.fillText(`${equipment.name}${enhancementText}`, this.x + 20, startY);

    // 装备属性
    let yOffset = startY + 25;
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';

    if (equipment.stats.attack) {
      ctx.fillText(`攻击力: ${equipment.stats.attack}`, this.x + 20, yOffset);
      yOffset += 15;
    }
    if (equipment.stats.defense) {
      ctx.fillText(`防御力: ${equipment.stats.defense}`, this.x + 20, yOffset);
      yOffset += 15;
    }
    if (equipment.stats.maxHp) {
      ctx.fillText(`生命值: +${equipment.stats.maxHp}`, this.x + 20, yOffset);
      yOffset += 15;
    }
    if (equipment.stats.maxMp) {
      ctx.fillText(`魔法值: +${equipment.stats.maxMp}`, this.x + 20, yOffset);
      yOffset += 15;
    }
  }

  /**
   * 渲染材料槽位
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderMaterialSlots(ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('强化材料:', this.x + 20, this.y + 190);

    for (let i = 0; i < this.materialSlots.length; i++) {
      const slot = this.materialSlots[i];
      const slotX = this.x + slot.x;
      const slotY = this.y + slot.y;

      // 槽位背景
      ctx.fillStyle = slot.material ? 'rgba(100, 150, 255, 0.3)' : 'rgba(100, 100, 100, 0.3)';
      ctx.fillRect(slotX, slotY, slot.width, slot.height);
      
      // 槽位边框
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 1;
      ctx.strokeRect(slotX, slotY, slot.width, slot.height);

      // 材料图标
      if (slot.material) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(slot.material.name.substring(0, 2), slotX + slot.width / 2, slotY + slot.height / 2 + 3);
      } else {
        ctx.fillStyle = '#666';
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('+', slotX + slot.width / 2, slotY + slot.height / 2 + 7);
      }
    }
  }

  /**
   * 渲染预览信息
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderPreviewInfo(ctx) {
    if (!this.previewInfo) return;

    const startY = this.y + 260;
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('强化预览:', this.x + 20, startY);

    let yOffset = startY + 20;
    ctx.font = '12px Arial';

    // 强化等级
    ctx.fillText(`等级: ${this.previewInfo.currentLevel} → ${this.previewInfo.nextLevel}`, this.x + 20, yOffset);
    yOffset += 15;

    // 费用
    ctx.fillText(`费用: ${this.previewInfo.cost} 金币`, this.x + 20, yOffset);
    yOffset += 15;

    // 成功率
    const successPercent = Math.round(this.previewInfo.successRate * 100);
    ctx.fillStyle = successPercent > 50 ? '#00ff00' : successPercent > 20 ? '#ffff00' : '#ff0000';
    ctx.fillText(`成功率: ${successPercent}%`, this.x + 20, yOffset);
    yOffset += 15;

    // 损坏率
    if (this.previewInfo.destructionRate > 0) {
      const destructionPercent = Math.round(this.previewInfo.destructionRate * 100);
      ctx.fillStyle = '#ff0000';
      ctx.fillText(`损坏率: ${destructionPercent}%`, this.x + 20, yOffset);
      yOffset += 15;
    }

    // 属性变化预览
    ctx.fillStyle = '#ffffff';
    ctx.fillText('属性变化:', this.x + 20, yOffset);
    yOffset += 15;

    const currentStats = this.previewInfo.currentStats;
    const previewStats = this.previewInfo.previewStats;

    for (const stat in currentStats) {
      if (typeof currentStats[stat] === 'number' && previewStats[stat] !== currentStats[stat]) {
        const change = previewStats[stat] - currentStats[stat];
        ctx.fillStyle = change > 0 ? '#00ff00' : '#ff0000';
        ctx.fillText(`${stat}: ${currentStats[stat]} → ${previewStats[stat]} (+${change})`, this.x + 30, yOffset);
        yOffset += 15;
      }
    }
  }

  /**
   * 渲染强化按钮
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderEnhanceButton(ctx) {
    const button = this.enhanceButton;
    const buttonX = this.x + button.x;
    const buttonY = this.y + button.y;

    // 按钮背景
    ctx.fillStyle = button.enabled ? 'rgba(255, 100, 100, 0.8)' : 'rgba(100, 100, 100, 0.5)';
    ctx.fillRect(buttonX, buttonY, button.width, button.height);
    
    // 按钮边框
    ctx.strokeStyle = button.enabled ? '#ff6464' : '#666';
    ctx.lineWidth = 2;
    ctx.strokeRect(buttonX, buttonY, button.width, button.height);
    
    // 按钮文字
    ctx.fillStyle = button.enabled ? '#ffffff' : '#999';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('强化', buttonX + button.width / 2, buttonY + button.height / 2 + 5);
  }

  /**
   * 渲染动画效果
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderAnimation(ctx) {
    if (!this.animationState.isAnimating) return;

    const progress = this.animationState.progress / this.animationState.duration;
    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;

    ctx.save();
    ctx.globalAlpha = 1 - progress;

    switch (this.animationState.type) {
      case 'success':
        // 成功光效
        ctx.fillStyle = '#00ff00';
        ctx.beginPath();
        ctx.arc(centerX, centerY, progress * 100, 0, Math.PI * 2);
        ctx.fill();
        break;
      
      case 'failure':
        // 失败效果
        ctx.fillStyle = '#ffff00';
        ctx.fillRect(this.x, this.y, this.width, this.height);
        break;
      
      case 'destroyed':
        // 损坏效果
        ctx.fillStyle = '#ff0000';
        for (let i = 0; i < 10; i++) {
          const angle = (i / 10) * Math.PI * 2;
          const distance = progress * 150;
          const x = centerX + Math.cos(angle) * distance;
          const y = centerY + Math.sin(angle) * distance;
          ctx.fillRect(x - 5, y - 5, 10, 10);
        }
        break;
    }

    ctx.restore();
  }

  /**
   * 更新预览信息
   */
  updatePreview() {
    if (!this.selectedEquipment || !this.enhancementSystem) {
      this.previewInfo = null;
      this.enhanceButton.enabled = false;
      return;
    }

    const materials = this.materialSlots
      .filter(slot => slot.material)
      .map(slot => slot.material);

    this.previewInfo = this.enhancementSystem.getEnhancementPreview(this.selectedEquipment, materials);
    this.enhanceButton.enabled = this.previewInfo.canEnhance && materials.length > 0;
  }

  /**
   * 添加材料到槽位
   * @param {Object} material - 材料数据
   * @returns {boolean} 是否成功添加
   */
  addMaterial(material) {
    for (const slot of this.materialSlots) {
      if (!slot.material) {
        slot.material = material;
        this.updatePreview();
        return true;
      }
    }
    return false;
  }

  /**
   * 移除材料
   * @param {number} slotIndex - 槽位索引
   */
  removeMaterial(slotIndex) {
    if (slotIndex >= 0 && slotIndex < this.materialSlots.length) {
      this.materialSlots[slotIndex].material = null;
      this.updatePreview();
    }
  }

  /**
   * 清空所有材料
   */
  clearMaterials() {
    for (const slot of this.materialSlots) {
      slot.material = null;
    }
    this.updatePreview();
  }

  /**
   * 执行强化
   */
  performEnhancement() {
    if (!this.enhanceButton.enabled || !this.selectedEquipment || !this.enhancementSystem) {
      return;
    }

    const materials = this.materialSlots
      .filter(slot => slot.material)
      .map(slot => slot.material);

    // 这里需要获取玩家金币，暂时使用固定值
    const playerGold = 10000;

    const result = this.enhancementSystem.enhanceEquipment(this.selectedEquipment, materials, playerGold);
    
    // 播放动画
    this.playAnimation(result.result);
    
    // 触发回调
    if (this.onEnhancementComplete) {
      this.onEnhancementComplete(result);
    }
    
    // 更新装备
    if (result.result === EnhancementResult.SUCCESS) {
      this.selectedEquipment = result.equipment;
    } else if (result.result === EnhancementResult.DESTROYED) {
      this.selectedEquipment = null;
    }
    
    // 清空材料
    this.clearMaterials();
    
    Logger.log(result.message);
  }

  /**
   * 播放动画
   * @param {string} type - 动画类型
   */
  playAnimation(type) {
    this.animationState = {
      isAnimating: true,
      type: type,
      progress: 0,
      duration: 2000
    };
  }

  /**
   * 获取品质颜色
   * @param {number} quality - 品质等级
   * @returns {string}
   */
  getQualityColor(quality) {
    const colors = ['#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000'];
    return colors[quality] || '#ffffff';
  }

  /**
   * 处理鼠标点击事件
   * @param {number} x - 鼠标X坐标
   * @param {number} y - 鼠标Y坐标
   * @returns {boolean} 是否处理了点击事件
   */
  handleMouseClick(x, y) {
    if (!this.visible || !this.containsPoint(x, y)) return false;

    // 检查强化按钮点击
    const button = this.enhanceButton;
    const buttonX = this.x + button.x;
    const buttonY = this.y + button.y;
    
    if (x >= buttonX && x <= buttonX + button.width &&
        y >= buttonY && y <= buttonY + button.height) {
      if (button.enabled) {
        this.performEnhancement();
      }
      return true;
    }

    // 检查材料槽位点击
    for (let i = 0; i < this.materialSlots.length; i++) {
      const slot = this.materialSlots[i];
      const slotX = this.x + slot.x;
      const slotY = this.y + slot.y;
      
      if (x >= slotX && x <= slotX + slot.width &&
          y >= slotY && y <= slotY + slot.height) {
        if (slot.material) {
          this.removeMaterial(i);
        }
        return true;
      }
    }

    return true;
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
}