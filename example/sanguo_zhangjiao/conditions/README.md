<!--

Copyright (c) 2026 Liu Xiao (beiliwenxiao)

@project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
@author    刘枭 (beiliwenxiao)
@email     beiliwenxiao@qq.com
@date      2026-01-14
@blog      https://blog.csdn.net/beiliwenxiao
@repo      https://github.com/beiliwenxiao/yijian18-engine
           https://gitee.com/coderaaa/yijian18-engine

-->

# 教程条件判断器

## 概述

条件判断器负责实现教程和提示的触发条件和完成条件判断逻辑。所有条件函数都是静态方法，接收场景实例作为参数，返回布尔值。

## 文件说明

### TutorialConditions.js

实现基础教程的条件判断：
- 移动教程（movement）
- 拾取教程（pickup）
- 装备教程（equipment）
- 战斗教程（combat）

每个教程有两个条件函数：
- `{tutorialId}_trigger`：触发条件
- `{tutorialId}_complete`：完成条件

### ProgressiveTipsConditions.js

实现渐进式提示的条件判断：
- 10个连续的提示（progressive_tip_1 到 progressive_tip_10）

每个提示只有一个条件函数：
- `{tipId}_trigger`：触发条件

## 使用方法

### 直接调用条件函数

```javascript
import { TutorialConditions } from './TutorialConditions.js';

// 检查移动教程是否应该触发
const shouldTrigger = TutorialConditions.movement_trigger(scene, gameState);

// 检查移动教程是否已完成
const isComplete = TutorialConditions.movement_complete(scene, gameState);
```

### 使用 evaluate 方法

```javascript
import { TutorialConditions } from './TutorialConditions.js';

// 通过条件ID执行判断
const shouldTrigger = TutorialConditions.evaluate('movement_trigger', scene, gameState);
const isComplete = TutorialConditions.evaluate('movement_complete', scene, gameState);
```

### 在配置中使用

```javascript
import { TutorialConfig } from '../config/TutorialConfig.js';
import { TutorialConditions } from '../conditions/TutorialConditions.js';

// 注册教程时使用条件判断器
for (const tutorialId in TutorialConfig) {
  const config = TutorialConfig[tutorialId];
  
  this.tutorialSystem.registerTutorial(tutorialId, {
    ...config,
    triggerCondition: (gameState) => {
      return TutorialConditions.evaluate(
        config.triggerConditionId,
        this,
        gameState
      );
    }
  });
}
```

## 条件函数编写规范

### 函数签名

```javascript
/**
 * 教程/提示名称 - 条件类型
 * @param {Object} scene - 场景实例
 * @param {Object} gameState - 游戏状态（可选，仅基础教程需要）
 * @returns {boolean}
 */
static condition_name(scene, gameState) {
  // 实现条件判断逻辑
  return true/false;
}
```

### 编写原则

1. **纯函数**：不修改传入的参数，不产生副作用
2. **明确返回**：必须返回布尔值
3. **异常处理**：使用 try-catch 包裹可能出错的代码
4. **清晰注释**：说明条件的含义和判断逻辑
5. **性能优化**：避免复杂计算，优先使用简单判断

### 示例

```javascript
/**
 * 移动教程 - 触发条件
 * 当教程阶段为移动且教程未完成时触发
 */
static movement_trigger(scene, gameState) {
  return scene.tutorialPhase === 'movement' && 
         !scene.tutorialsCompleted.movement;
}

/**
 * 移动教程 - 完成条件
 * 当玩家移动距离达到100像素时完成
 */
static movement_complete(scene, gameState) {
  return scene.playerMovedDistance >= 100;
}
```

## 常见场景访问模式

### 访问场景状态

```javascript
static some_trigger(scene, gameState) {
  // 访问教程阶段
  const phase = scene.tutorialPhase;
  
  // 访问完成标记
  const completed = scene.tutorialsCompleted.some_tutorial;
  
  // 访问玩家实体
  const player = scene.player;
  
  // 访问其他场景属性
  const items = scene.pickupItems;
  const campfire = scene.campfire;
  
  return /* 条件判断 */;
}
```

### 访问组件数据

```javascript
static equipment_complete(scene, gameState) {
  // 获取玩家实体
  if (!scene.player) {
    return false;
  }
  
  // 获取装备组件
  const equipment = scene.player.getComponent('equipment');
  if (!equipment) {
    return false;
  }
  
  // 检查是否装备了武器
  return equipment.weapon !== null;
}
```

### 复杂条件判断

```javascript
static progressive_tip_10_trigger(scene) {
  // 获取装备组件
  const equipment = scene.playerEntity?.getComponent('equipment');
  
  // 计算已装备物品数量
  const equippedCount = equipment && equipment.slots ? 
    Object.keys(equipment.slots).filter(slot => equipment.slots[slot]).length : 0;
  
  // 必须装备两件物品且提示未完成
  return equippedCount >= 2 && !scene.tutorialsCompleted.progressive_tip_10;
}
```

## 错误处理

条件判断器内置了错误处理机制：

```javascript
static evaluate(conditionId, scene, gameState) {
  const condition = this.getCondition(conditionId);
  
  if (!condition) {
    return false; // 条件函数不存在
  }
  
  try {
    return condition(scene, gameState);
  } catch (error) {
    console.error(`条件判断出错 - ${conditionId}`, error);
    return false; // 出错时返回 false
  }
}
```

## 调试技巧

### 添加日志

```javascript
static movement_trigger(scene, gameState) {
  const result = scene.tutorialPhase === 'movement' && 
                 !scene.tutorialsCompleted.movement;
  
  // 调试时可以添加日志
  if (result) {
    console.log('移动教程触发条件满足');
  }
  
  return result;
}
```

### 分步检查

```javascript
static complex_condition(scene, gameState) {
  // 分步检查，便于调试
  const step1 = scene.tutorialPhase === 'some_phase';
  const step2 = !scene.tutorialsCompleted.some_tutorial;
  const step3 = scene.someValue >= 100;
  
  console.log('条件检查:', { step1, step2, step3 });
  
  return step1 && step2 && step3;
}
```

## 最佳实践

1. **保持简单**：条件判断应该简单明了，避免复杂逻辑
2. **提前返回**：使用提前返回模式，避免深层嵌套
3. **空值检查**：访问对象属性前先检查对象是否存在
4. **使用可选链**：使用 `?.` 操作符简化空值检查
5. **避免副作用**：不要在条件函数中修改场景状态
6. **性能优先**：条件函数会频繁调用，注意性能优化
