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
 * AttributePanel.js
 * 属性分配面板UI组件
 */

export class AttributePanel {
  /**
   * @param {HTMLElement} container - 容器元素
   * @param {Object} attributeSystem - 属性系统实例
   */
  constructor(container, attributeSystem, config = {}) {
    this.container = container;
    this.attributeSystem = attributeSystem;
    this.characterId = null;
    this.isVisible = false;
    // 属性变化回调（供引擎侧 DOM-free 订阅；document 事件仅为外部兼容保留）
    this.onAttributeChanged = typeof config.onAttributeChanged === 'function' ? config.onAttributeChanged : null;

    this.createPanel();
    this.bindEvents();
  }

  /**
   * 创建面板UI
   */
  createPanel() {
    this.panel = document.createElement('div');
    this.panel.className = 'attribute-panel';
    this.panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 500px;
      background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
      border: 2px solid #3498db;
      border-radius: 10px;
      padding: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      z-index: 10000;
      display: none;
      font-family: Arial, sans-serif;
      color: white;
    `;

    // 标题栏
    const header = document.createElement('div');
    header.className = 'attribute-header';
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 1px solid #3498db;
    `;

    const title = document.createElement('h2');
    title.textContent = '属性分配';
    title.style.cssText = `
      margin: 0;
      color: #3498db;
      font-size: 24px;
    `;

    this.closeButton = document.createElement('button');
    this.closeButton.textContent = '×';
    this.closeButton.style.cssText = `
      background: #e74c3c;
      border: none;
      color: white;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 18px;
      font-weight: bold;
    `;

    header.appendChild(title);
    header.appendChild(this.closeButton);

    // 可用点数显示
    this.pointsDisplay = document.createElement('div');
    this.pointsDisplay.className = 'points-display';
    this.pointsDisplay.style.cssText = `
      text-align: center;
      margin-bottom: 20px;
      padding: 10px;
      background: rgba(52, 152, 219, 0.2);
      border-radius: 5px;
      font-size: 18px;
      font-weight: bold;
    `;

    // 属性列表容器
    this.attributeList = document.createElement('div');
    this.attributeList.className = 'attribute-list';
    this.attributeList.style.cssText = `
      margin-bottom: 20px;
    `;

    // 按钮区域
    const buttonArea = document.createElement('div');
    buttonArea.className = 'button-area';
    buttonArea.style.cssText = `
      display: flex;
      justify-content: space-between;
      gap: 10px;
    `;

    this.resetButton = document.createElement('button');
    this.resetButton.textContent = '重置属性';
    this.resetButton.style.cssText = `
      flex: 1;
      padding: 10px;
      background: #e67e22;
      border: none;
      color: white;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
      font-weight: bold;
    `;

    this.confirmButton = document.createElement('button');
    this.confirmButton.textContent = '确认';
    this.confirmButton.style.cssText = `
      flex: 1;
      padding: 10px;
      background: #27ae60;
      border: none;
      color: white;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
      font-weight: bold;
    `;

    buttonArea.appendChild(this.resetButton);
    buttonArea.appendChild(this.confirmButton);

    // 组装面板
    this.panel.appendChild(header);
    this.panel.appendChild(this.pointsDisplay);
    this.panel.appendChild(this.attributeList);
    this.panel.appendChild(buttonArea);

    this.container.appendChild(this.panel);

    // 创建属性项
    this.createAttributeItems();
  }

  /**
   * 创建属性项
   */
  createAttributeItems() {
    const descriptions = this.attributeSystem.getAllAttributeDescriptions();
    this.attributeItems = {};

    for (const [attributeType, description] of Object.entries(descriptions)) {
      const item = this.createAttributeItem(attributeType, description);
      this.attributeList.appendChild(item);
      this.attributeItems[attributeType] = item;
    }
  }

  /**
   * 创建单个属性项
   * @param {string} attributeType - 属性类型
   * @param {Object} description - 属性描述
   * @returns {HTMLElement}
   */
  createAttributeItem(attributeType, description) {
    const item = document.createElement('div');
    item.className = 'attribute-item';
    item.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 15px;
      margin-bottom: 10px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    `;

    // 左侧信息
    const leftInfo = document.createElement('div');
    leftInfo.style.cssText = `
      flex: 1;
      margin-right: 20px;
    `;

    const nameElement = document.createElement('div');
    nameElement.textContent = description.name;
    nameElement.style.cssText = `
      font-size: 18px;
      font-weight: bold;
      color: #3498db;
      margin-bottom: 5px;
    `;

    const descElement = document.createElement('div');
    descElement.textContent = description.description;
    descElement.style.cssText = `
      font-size: 14px;
      color: #bdc3c7;
      margin-bottom: 8px;
    `;

    const effectsElement = document.createElement('div');
    effectsElement.style.cssText = `
      font-size: 12px;
      color: #95a5a6;
    `;
    effectsElement.innerHTML = description.effects.map(effect => `• ${effect}`).join('<br>');

    leftInfo.appendChild(nameElement);
    leftInfo.appendChild(descElement);
    leftInfo.appendChild(effectsElement);

    // 右侧控制
    const rightControl = document.createElement('div');
    rightControl.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
    `;

    // 减少按钮
    const decreaseBtn = document.createElement('button');
    decreaseBtn.textContent = '-';
    decreaseBtn.style.cssText = `
      width: 30px;
      height: 30px;
      background: #e74c3c;
      border: none;
      color: white;
      border-radius: 5px;
      cursor: pointer;
      font-size: 18px;
      font-weight: bold;
    `;
    decreaseBtn.disabled = true; // 暂时禁用，因为不支持减少属性点

    // 属性值显示
    const valueDisplay = document.createElement('div');
    valueDisplay.style.cssText = `
      min-width: 60px;
      text-align: center;
      font-size: 18px;
      font-weight: bold;
      color: #f39c12;
    `;

    // 增加按钮
    const increaseBtn = document.createElement('button');
    increaseBtn.textContent = '+';
    increaseBtn.style.cssText = `
      width: 30px;
      height: 30px;
      background: #27ae60;
      border: none;
      color: white;
      border-radius: 5px;
      cursor: pointer;
      font-size: 18px;
      font-weight: bold;
    `;

    // 绑定增加按钮事件
    increaseBtn.addEventListener('click', () => {
      this.allocateAttribute(attributeType, 1);
    });

    rightControl.appendChild(decreaseBtn);
    rightControl.appendChild(valueDisplay);
    rightControl.appendChild(increaseBtn);

    item.appendChild(leftInfo);
    item.appendChild(rightControl);

    // 存储引用
    item.valueDisplay = valueDisplay;
    item.increaseBtn = increaseBtn;
    item.decreaseBtn = decreaseBtn;

    return item;
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    // 关闭按钮
    this.closeButton.addEventListener('click', () => {
      this.hide();
    });

    // 重置按钮
    this.resetButton.addEventListener('click', () => {
      this.resetAttributes();
    });

    // 确认按钮
    this.confirmButton.addEventListener('click', () => {
      this.hide();
    });

    // 点击面板外部关闭
    this.panel.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    document.addEventListener('click', (e) => {
      if (this.isVisible && !this.panel.contains(e.target)) {
        this.hide();
      }
    });

    // ESC键关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });
  }

  /**
   * 显示面板
   * @param {string} characterId - 角色ID
   */
  show(characterId) {
    console.log('AttributePanel: 尝试显示面板，角色ID:', characterId);
    
    this.characterId = characterId;
    this.isVisible = true;
    this.panel.style.display = 'block';
    this.panel.style.zIndex = '10000'; // 确保z-index足够高
    
    console.log('AttributePanel: 面板样式已设置');
    console.log('AttributePanel: display =', this.panel.style.display);
    console.log('AttributePanel: z-index =', this.panel.style.zIndex);
    
    this.updateDisplay();
    
    // 强制重绘
    this.panel.offsetHeight;
    
    console.log('AttributePanel: 面板显示完成');
  }

  /**
   * 隐藏面板
   */
  hide() {
    this.isVisible = false;
    this.panel.style.display = 'none';
    this.characterId = null;
  }

  /**
   * 更新显示
   */
  updateDisplay() {
    if (!this.characterId) return;

    const attributeData = this.attributeSystem.getCharacterAttributes(this.characterId);
    if (!attributeData) return;

    // 更新可用点数
    this.pointsDisplay.textContent = `可用属性点: ${attributeData.availablePoints}`;

    // 更新各属性值
    for (const [attributeType, item] of Object.entries(this.attributeItems)) {
      const value = attributeData.getAttribute(attributeType);
      item.valueDisplay.textContent = value;
      
      // 更新按钮状态
      item.increaseBtn.disabled = attributeData.availablePoints <= 0;
    }
  }

  /**
   * 分配属性点
   * @param {string} attributeType - 属性类型
   * @param {number} points - 点数
   */
  allocateAttribute(attributeType, points) {
    if (!this.characterId) return;

    const success = this.attributeSystem.allocateAttribute(this.characterId, attributeType, points);
    if (success) {
      this.updateDisplay();
      
      // 触发属性变化事件
      this.dispatchAttributeChangeEvent();
    }
  }

  /**
   * 重置属性
   */
  resetAttributes() {
    if (!this.characterId) return;

    // 确认对话框
    if (confirm('确定要重置所有属性点吗？这将返还所有已分配的属性点。')) {
      const success = this.attributeSystem.resetCharacterAttributes(this.characterId);
      if (success) {
        this.updateDisplay();
        
        // 触发属性变化事件
        this.dispatchAttributeChangeEvent();
      }
    }
  }

  /**
   * 触发属性变化事件
   */
  dispatchAttributeChangeEvent() {
    const detail = {
      characterId: this.characterId,
      attributeData: this.attributeSystem.getCharacterAttributes(this.characterId),
      effects: this.attributeSystem.calculateCharacterEffects(this.characterId)
    };
    this.onAttributeChanged?.(detail);

    const event = new CustomEvent('attributeChanged', { detail });
    document.dispatchEvent(event);
  }

  /**
   * 检查是否可见
   * @returns {boolean}
   */
  isOpen() {
    return this.isVisible;
  }

  /**
   * 获取当前角色ID
   * @returns {string|null}
   */
  getCurrentCharacterId() {
    return this.characterId;
  }
}