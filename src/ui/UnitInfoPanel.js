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
 * UnitInfoPanel.js
 * 兵种信息面板 - 显示兵种相克信息和升级选项
 */

import { Logger } from '../core/Logger.js';
import { UnitSystem, UnitTypes, UnitNames } from '../systems/UnitSystem.js';

/**
 * 兵种信息面板
 */
export class UnitInfoPanel {
  constructor() {
    this.unitSystem = new UnitSystem();
    this.visible = false;
    this.selectedEntity = null;
    
    // 面板配置
    this.panelConfig = {
      x: 20,
      y: 100,
      width: 300,
      height: 400,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: '#4a90e2',
      borderWidth: 2,
      padding: 15
    };
    
    // 文本配置
    this.textConfig = {
      titleFont: 'bold 18px Arial',
      headerFont: 'bold 14px Arial',
      bodyFont: '12px Arial',
      titleColor: '#ffffff',
      headerColor: '#4a90e2',
      bodyColor: '#cccccc',
      advantageColor: '#00ff00',
      disadvantageColor: '#ff6666',
      normalColor: '#ffffff'
    };
  }
  
  /**
   * 显示面板
   * @param {Entity} entity - 要显示信息的实体
   */
  show(entity) {
    this.selectedEntity = entity;
    this.visible = true;
  }
  
  /**
   * 隐藏面板
   */
  hide() {
    this.visible = false;
    this.selectedEntity = null;
  }
  
  /**
   * 切换面板显示状态
   * @param {Entity} entity - 实体（可选）
   */
  toggle(entity = null) {
    if (this.visible) {
      this.hide();
    } else if (entity) {
      this.show(entity);
    }
  }
  
  /**
   * 渲染面板
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  render(ctx) {
    if (!this.visible || !this.selectedEntity) return;
    
    const stats = this.selectedEntity.getComponent('stats');
    if (!stats) return;
    
    const { x, y, width, height } = this.panelConfig;
    
    // 绘制面板背景
    ctx.save();
    ctx.fillStyle = this.panelConfig.backgroundColor;
    ctx.fillRect(x, y, width, height);
    
    // 绘制边框
    ctx.strokeStyle = this.panelConfig.borderColor;
    ctx.lineWidth = this.panelConfig.borderWidth;
    ctx.strokeRect(x, y, width, height);
    
    // 绘制内容
    let currentY = y + this.panelConfig.padding;
    
    // 标题
    ctx.fillStyle = this.textConfig.titleColor;
    ctx.font = this.textConfig.titleFont;
    ctx.textAlign = 'left';
    ctx.fillText('兵种信息', x + this.panelConfig.padding, currentY);
    currentY += 30;
    
    // 当前兵种信息
    const unitType = stats.getUnitType();
    const unitName = this.unitSystem.getUnitName(unitType);
    const unitCategory = this.unitSystem.getUnitCategory(unitType);
    const unitTier = this.unitSystem.getUnitTier(unitType);
    
    ctx.fillStyle = this.textConfig.headerColor;
    ctx.font = this.textConfig.headerFont;
    ctx.fillText('当前兵种:', x + this.panelConfig.padding, currentY);
    currentY += 20;
    
    ctx.fillStyle = this.textConfig.bodyColor;
    ctx.font = this.textConfig.bodyFont;
    ctx.fillText(`${unitName} (等级 ${unitTier})`, x + this.panelConfig.padding + 10, currentY);
    currentY += 15;
    ctx.fillText(`类别: ${this.getCategoryName(unitCategory)}`, x + this.panelConfig.padding + 10, currentY);
    currentY += 25;
    
    // 升级选项
    if (this.unitSystem.canUpgradeUnit(unitType)) {
      ctx.fillStyle = this.textConfig.headerColor;
      ctx.font = this.textConfig.headerFont;
      ctx.fillText('升级选项:', x + this.panelConfig.padding, currentY);
      currentY += 20;
      
      const upgradeOptions = this.unitSystem.getUpgradeOptions(unitType);
      for (let i = 0; i < upgradeOptions.length; i++) {
        const upgradeName = this.unitSystem.getUnitName(upgradeOptions[i]);
        ctx.fillStyle = this.textConfig.bodyColor;
        ctx.font = this.textConfig.bodyFont;
        ctx.fillText(`${i + 1}. ${upgradeName}`, x + this.panelConfig.padding + 10, currentY);
        currentY += 15;
      }
      currentY += 10;
    } else {
      ctx.fillStyle = this.textConfig.bodyColor;
      ctx.font = this.textConfig.bodyFont;
      ctx.fillText('已达到最高等级', x + this.panelConfig.padding, currentY);
      currentY += 25;
    }
    
    // 相克关系
    ctx.fillStyle = this.textConfig.headerColor;
    ctx.font = this.textConfig.headerFont;
    ctx.fillText('相克关系:', x + this.panelConfig.padding, currentY);
    currentY += 20;
    
    // 克制的兵种
    const counteredUnits = this.unitSystem.getCounteredUnits(unitType);
    if (counteredUnits.length > 0) {
      ctx.fillStyle = this.textConfig.advantageColor;
      ctx.font = this.textConfig.bodyFont;
      ctx.fillText('克制:', x + this.panelConfig.padding + 10, currentY);
      currentY += 15;
      
      for (const counteredUnit of counteredUnits) {
        const counteredName = this.unitSystem.getUnitName(counteredUnit);
        ctx.fillText(`• ${counteredName}`, x + this.panelConfig.padding + 20, currentY);
        currentY += 15;
      }
    }
    
    // 被克制的兵种
    const counteringUnits = this.getCounteringUnits(unitType);
    if (counteringUnits.length > 0) {
      ctx.fillStyle = this.textConfig.disadvantageColor;
      ctx.font = this.textConfig.bodyFont;
      ctx.fillText('被克制:', x + this.panelConfig.padding + 10, currentY);
      currentY += 15;
      
      for (const counteringUnit of counteringUnits) {
        const counteringName = this.unitSystem.getUnitName(counteringUnit);
        ctx.fillText(`• ${counteringName}`, x + this.panelConfig.padding + 20, currentY);
        currentY += 15;
      }
    }
    
    // 重甲兵种特殊说明
    if (this.unitSystem.isHeavyUnit(unitType)) {
      currentY += 10;
      ctx.fillStyle = this.textConfig.advantageColor;
      ctx.font = this.textConfig.bodyFont;
      ctx.fillText('重甲兵种：无克制关系', x + this.panelConfig.padding + 10, currentY);
    }
    
    ctx.restore();
  }
  
  /**
   * 获取类别名称
   * @param {string} category - 类别
   * @returns {string} 中文名称
   */
  getCategoryName(category) {
    const categoryNames = {
      'infantry': '步兵',
      'ranged': '远程',
      'cavalry': '骑兵'
    };
    return categoryNames[category] || category;
  }
  
  /**
   * 获取克制当前兵种的兵种列表
   * @param {number} unitType - 兵种类型
   * @returns {Array<number>} 克制当前兵种的兵种列表
   */
  getCounteringUnits(unitType) {
    const counteringUnits = [];
    
    // 遍历所有兵种，查找克制当前兵种的
    for (let i = 0; i < 9; i++) {
      if (this.unitSystem.isUnitCountering(i, unitType)) {
        counteringUnits.push(i);
      }
    }
    
    return counteringUnits;
  }
  
  /**
   * 处理键盘输入
   * @param {string} key - 按键
   * @returns {boolean} 是否处理了输入
   */
  handleKeyInput(key) {
    if (!this.visible || !this.selectedEntity) return false;
    
    const stats = this.selectedEntity.getComponent('stats');
    if (!stats) return false;
    
    const unitType = stats.getUnitType();
    
    // 处理升级输入
    if (this.unitSystem.canUpgradeUnit(unitType)) {
      const upgradeOptions = this.unitSystem.getUpgradeOptions(unitType);
      
      // 数字键1-9对应升级选项
      const keyNum = parseInt(key);
      if (keyNum >= 1 && keyNum <= upgradeOptions.length) {
        const newUnitType = upgradeOptions[keyNum - 1];
        stats.setUnitType(newUnitType);
        
        Logger.log(`兵种升级: ${this.unitSystem.getUnitName(unitType)} -> ${this.unitSystem.getUnitName(newUnitType)}`);
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * 处理鼠标点击
   * @param {number} mouseX - 鼠标X坐标
   * @param {number} mouseY - 鼠标Y坐标
   * @returns {boolean} 是否处理了点击
   */
  handleMouseClick(mouseX, mouseY) {
    if (!this.visible) return false;
    
    const { x, y, width, height } = this.panelConfig;
    
    // 检查是否点击在面板内
    if (mouseX >= x && mouseX <= x + width && 
        mouseY >= y && mouseY <= y + height) {
      return true; // 阻止事件传播
    }
    
    // 点击面板外部，隐藏面板
    this.hide();
    return false;
  }
  
  /**
   * 获取面板是否可见
   * @returns {boolean}
   */
  isVisible() {
    return this.visible;
  }
  
  /**
   * 设置面板位置
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   */
  setPosition(x, y) {
    this.panelConfig.x = x;
    this.panelConfig.y = y;
  }
}