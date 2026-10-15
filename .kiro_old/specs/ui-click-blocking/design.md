# 设计文档：UI 点击阻止角色移动

## 概述

本设计文档描述了如何实现 UI 点击事件阻止角色移动的功能。当前系统中，所有鼠标点击事件都会被移动系统处理，导致玩家在操作 UI 时角色会意外移动。

解决方案的核心思想是：**在点击事件传递到移动系统之前，先检查点击位置是否在任何可见的 UI 元素范围内。如果是，则阻止事件传播到游戏世界层。**

## 架构

### 系统层次结构

```
用户点击
    ↓
InputManager（捕获原始输入）
    ↓
UIClickHandler（新增）- 检查 UI 碰撞
    ↓
    ├─→ UI 元素处理（如果命中）→ 阻止传播
    └─→ 游戏世界处理（如果未命中）→ MovementSystem
```

### 关键组件

1. **UIClickHandler**（新增）
   - 负责管理所有 UI 元素的点击检测
   - 维护 UI 元素列表（按 z-index 排序）
   - 执行碰撞检测（Hit Test）
   - 决定是否阻止事件传播

2. **InputManager**（修改）
   - 添加事件处理标记
   - 提供清除点击状态的方法
   - 支持查询事件是否已被处理

3. **UI 元素**（修改）
   - 实现统一的碰撞检测接口
   - 返回点击处理结果

4. **Scene**（修改）
   - 在 update 循环中优先调用 UIClickHandler
   - 根据处理结果决定是否调用 MovementSystem

## 组件和接口

### UIClickHandler

```javascript
class UIClickHandler {
  constructor() {
    this.uiElements = [];  // UI 元素列表
    this.sortedElements = [];  // 按 z-index 排序的元素
    this.needsSort = false;  // 是否需要重新排序
  }

  /**
   * 注册 UI 元素
   * @param {UIElement} element - UI 元素
   */
  registerElement(element) {
    this.uiElements.push(element);
    this.needsSort = true;
  }

  /**
   * 注销 UI 元素
   * @param {UIElement} element - UI 元素
   */
  unregisterElement(element) {
    const index = this.uiElements.indexOf(element);
    if (index > -1) {
      this.uiElements.splice(index, 1);
      this.needsSort = true;
    }
  }

  /**
   * 按 z-index 排序 UI 元素
   */
  sortElements() {
    this.sortedElements = [...this.uiElements].sort((a, b) => {
      return (b.zIndex || 0) - (a.zIndex || 0);
    });
    this.needsSort = false;
  }

  /**
   * 处理点击事件
   * @param {number} x - 点击 X 坐标（Canvas 坐标）
   * @param {number} y - 点击 Y 坐标（Canvas 坐标）
   * @param {string} button - 鼠标按钮（'left' 或 'right'）
   * @returns {boolean} - 是否有 UI 元素处理了该点击
   */
  handleClick(x, y, button) {
    // 如果需要，重新排序
    if (this.needsSort) {
      this.sortElements();
    }

    // 按 z-index 从高到低检查每个可见的 UI 元素
    for (const element of this.sortedElements) {
      if (!element.visible) continue;

      // 检查点击是否在元素范围内
      if (this.hitTest(element, x, y)) {
        // 让元素处理点击
        const handled = element.handleMouseClick(x, y, button);
        if (handled) {
          return true;  // 事件已被处理，阻止传播
        }
      }
    }

    return false;  // 没有 UI 元素处理该点击
  }

  /**
   * 碰撞检测
   * @param {UIElement} element - UI 元素
   * @param {number} x - 点击 X 坐标
   * @param {number} y - 点击 Y 坐标
   * @returns {boolean} - 是否命中
   */
  hitTest(element, x, y) {
    return x >= element.x &&
           x <= element.x + element.width &&
           y >= element.y &&
           y <= element.y + element.height;
  }

  /**
   * 检查是否有任何 UI 元素在指定位置
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @returns {boolean}
   */
  isUIAtPosition(x, y) {
    if (this.needsSort) {
      this.sortElements();
    }

    for (const element of this.sortedElements) {
      if (!element.visible) continue;
      if (this.hitTest(element, x, y)) {
        return true;
      }
    }

    return false;
  }
}
```

### InputManager 扩展

```javascript
class InputManager {
  constructor(canvas) {
    // ... 现有代码 ...
    
    // 添加事件处理标记
    this.mouse.handled = false;  // 标记点击事件是否已被处理
  }

  /**
   * 标记鼠标点击已被处理
   */
  markMouseClickHandled() {
    this.mouse.handled = true;
    this.mouse.clicked = false;  // 清除点击状态
  }

  /**
   * 检查鼠标点击是否已被处理
   * @returns {boolean}
   */
  isMouseClickHandled() {
    return this.mouse.handled;
  }

  /**
   * 更新输入状态（每帧调用）
   */
  update() {
    // 清除本帧的按键状态
    this.keysPressed.clear();
    this.keysReleased.clear();
    
    // 清除鼠标点击状态
    this.mouse.clicked = false;
    this.mouse.handled = false;  // 重置处理标记
  }
}
```

### UIElement 接口扩展

```javascript
class UIElement {
  constructor(options = {}) {
    this.x = options.x || 0;
    this.y = options.y || 0;
    this.width = options.width || 100;
    this.height = options.height || 100;
    this.visible = options.visible !== undefined ? options.visible : true;
    this.zIndex = options.zIndex || 0;
  }

  /**
   * 处理鼠标点击
   * @param {number} x - 点击 X 坐标
   * @param {number} y - 点击 Y 坐标
   * @param {string} button - 鼠标按钮（'left' 或 'right'）
   * @returns {boolean} - 是否处理了该点击
   */
  handleMouseClick(x, y, button) {
    // 默认实现：如果点击在元素范围内，就认为已处理
    // 子类可以重写此方法以实现更复杂的逻辑
    return this.isPointInside(x, y);
  }

  /**
   * 检查点是否在元素内部
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @returns {boolean}
   */
  isPointInside(x, y) {
    return x >= this.x &&
           x <= this.x + this.width &&
           y >= this.y &&
           y <= this.y + this.height;
  }
}
```

### Scene 更新逻辑

```javascript
class Act1SceneECS {
  constructor() {
    // ... 现有代码 ...
    
    // 添加 UI 点击处理器
    this.uiClickHandler = new UIClickHandler();
  }

  enter(data = null) {
    // ... 现有代码 ...
    
    // 注册所有 UI 元素
    this.uiClickHandler.registerElement(this.inventoryPanel);
    this.uiClickHandler.registerElement(this.equipmentPanel);
    this.uiClickHandler.registerElement(this.playerInfoPanel);
  }

  update(deltaTime) {
    // ... 现有代码 ...
    
    // 处理 UI 点击（在移动系统之前）
    if (this.inputManager.isMouseClicked() && !this.inputManager.isMouseClickHandled()) {
      const mousePos = this.inputManager.getMousePosition();
      const button = this.inputManager.getMouseButton() === 2 ? 'right' : 'left';
      
      // 检查 UI 是否处理了点击
      const uiHandled = this.uiClickHandler.handleClick(mousePos.x, mousePos.y, button);
      
      if (uiHandled) {
        // UI 处理了点击，标记为已处理
        this.inputManager.markMouseClickHandled();
      }
    }
    
    // 更新移动系统（会检查点击是否已被处理）
    this.movementSystem.update(deltaTime, this.entities);
    
    // ... 其他更新逻辑 ...
  }
}
```

### MovementSystem 修改

```javascript
class MovementSystem {
  update(deltaTime, entities) {
    // ... 现有代码 ...
    
    // 处理鼠标点击移动
    if (this.inputManager.isMouseClicked() && !this.inputManager.isMouseClickHandled()) {
      // 只有当点击未被 UI 处理时，才响应移动
      const worldPos = this.inputManager.getMouseWorldPosition();
      // ... 移动逻辑 ...
    }
  }
}
```

## 数据模型

### UIElement 数据结构

```javascript
{
  x: number,           // X 坐标（Canvas 坐标系）
  y: number,           // Y 坐标（Canvas 坐标系）
  width: number,       // 宽度
  height: number,      // 高度
  visible: boolean,    // 是否可见
  zIndex: number       // 层级（越大越在上层）
}
```

### 鼠标状态扩展

```javascript
{
  x: number,           // 屏幕 X 坐标
  y: number,           // 屏幕 Y 坐标
  worldX: number,      // 世界 X 坐标
  worldY: number,      // 世界 Y 坐标
  isDown: boolean,     // 是否按下
  button: number,      // 按钮（0=左键, 1=中键, 2=右键）
  clicked: boolean,    // 是否点击
  handled: boolean     // 是否已被处理（新增）
}
```

## 正确性属性

*属性是一个特征或行为，应该在系统的所有有效执行中保持为真——本质上是关于系统应该做什么的正式陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### 属性 1：UI 点击阻止传播

*对于任何*可见的 UI 元素和任何点击位置，如果点击位置在 UI 元素范围内，则该点击事件不应传播到移动系统。

**验证：需求 1.1, 1.2**

### 属性 2：非 UI 点击正常传播

*对于任何*点击位置，如果该位置不在任何可见 UI 元素范围内，则该点击事件应正常传播到移动系统。

**验证：需求 1.3**

### 属性 3：Z-Index 优先级

*对于任何*两个重叠的 UI 元素 A 和 B，如果 A 的 z-index 大于 B 的 z-index，则点击重叠区域时应优先检查 A。

**验证：需求 1.4, 4.4**

### 属性 4：不可见元素不参与检测

*对于任何*不可见的 UI 元素，该元素不应参与点击检测。

**验证：需求 1.5**

### 属性 5：事件处理标记一致性

*对于任何*被 UI 处理的点击事件，InputManager 的 handled 标记应为 true，且 clicked 标记应被清除。

**验证：需求 5.1, 5.2**

### 属性 6：坐标转换正确性

*对于任何*Canvas 坐标 (x, y)，转换后的坐标应准确反映鼠标在 Canvas 上的实际位置。

**验证：需求 6.1, 6.2**

### 属性 7：性能优化 - 早期退出

*对于任何*点击事件，一旦有 UI 元素处理了该事件，系统应立即停止检查后续 UI 元素。

**验证：需求 7.3**

### 属性 8：教程提示框阻止传播

*对于任何*可见的教程提示框和任何点击位置，如果点击位置在教程提示框范围内，则该点击事件不应传播到移动系统。

**验证：需求 2.1, 2.2**

## 错误处理

### 错误场景 1：UI 元素未注册

**问题**：UI 元素创建后未注册到 UIClickHandler。

**处理**：
- 在 Scene 的 enter 方法中自动注册所有 UI 元素
- 提供警告日志，提示开发者注册 UI 元素

### 错误场景 2：坐标系不一致

**问题**：某些 UI 元素使用 HTML DOM，坐标系与 Canvas 不同。

**处理**：
- 为 HTML DOM 元素提供专门的碰撞检测方法
- 在 hitTest 中根据元素类型选择合适的坐标系

### 错误场景 3：Z-Index 冲突

**问题**：多个 UI 元素具有相同的 z-index。

**处理**：
- 使用稳定排序算法，保持注册顺序
- 提供警告日志，建议开发者使用不同的 z-index

### 错误场景 4：性能问题

**问题**：UI 元素过多导致每帧检测性能下降。

**处理**：
- 只检查可见的 UI 元素
- 使用空间分区（如果 UI 元素数量超过阈值）
- 提供性能监控和警告

## 测试策略

### 单元测试

1. **UIClickHandler 测试**
   - 测试注册和注销 UI 元素
   - 测试 z-index 排序
   - 测试碰撞检测
   - 测试点击处理

2. **InputManager 扩展测试**
   - 测试事件处理标记
   - 测试标记清除
   - 测试状态查询

3. **UIElement 接口测试**
   - 测试点击处理方法
   - 测试点内检测

### 属性测试

1. **属性 1：UI 点击阻止传播**
   - 生成随机 UI 元素和点击位置
   - 验证点击在 UI 内时不传播到移动系统

2. **属性 2：非 UI 点击正常传播**
   - 生成随机 UI 元素和点击位置
   - 验证点击在 UI 外时正常传播

3. **属性 3：Z-Index 优先级**
   - 生成随机重叠的 UI 元素
   - 验证高 z-index 元素优先处理

4. **属性 5：事件处理标记一致性**
   - 生成随机点击事件
   - 验证处理后标记状态正确

### 集成测试

1. **完整场景测试**
   - 创建包含多个 UI 元素的场景
   - 模拟各种点击操作
   - 验证角色移动行为正确

2. **边界情况测试**
   - 测试 UI 边缘点击
   - 测试重叠 UI 点击
   - 测试快速连续点击

### 手动测试

1. **用户体验测试**
   - 打开背包面板，点击物品，验证角色不移动
   - 打开装备面板，点击装备槽，验证角色不移动
   - 打开人物信息面板，点击面板内容，验证角色不移动
   - 点击教程提示框，验证角色不移动
   - 点击 UI 外的游戏世界，验证角色正常移动

2. **性能测试**
   - 打开多个 UI 面板，测试帧率
   - 快速点击 UI，测试响应速度

## 实现注意事项

1. **向后兼容性**
   - 现有 UI 元素应自动继承新的接口
   - 如果 UI 元素未实现 handleMouseClick，使用默认实现

2. **性能优化**
   - 只在有点击事件时才进行碰撞检测
   - 缓存排序结果，只在 UI 元素变化时重新排序
   - 使用早期退出策略

3. **调试支持**
   - 提供可视化调试模式，显示 UI 碰撞框
   - 提供日志输出，记录点击处理流程

4. **扩展性**
   - 设计应支持未来添加更多 UI 元素
   - 支持自定义碰撞检测逻辑（如圆形、多边形）

## 实现顺序

1. 创建 UIClickHandler 类
2. 扩展 InputManager，添加事件处理标记
3. 修改 UIElement 基类，添加点击处理接口
4. 更新所有 UI 元素，实现点击处理方法
5. 修改 Scene，集成 UIClickHandler
6. 修改 MovementSystem，检查事件处理标记
7. 添加教程提示框的点击检测
8. 编写单元测试
9. 编写属性测试
10. 进行集成测试和手动测试
