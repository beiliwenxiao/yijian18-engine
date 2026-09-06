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

# 教程配置系统

## 概述

教程配置系统将教程的配置信息和条件判断逻辑分离，提高代码的可维护性和可扩展性。

## 目录结构

```
src/prologue/
├── config/
│   ├── TutorialConfig.js           # 基础教程配置文件
│   ├── ProgressiveTipsConfig.js    # 渐进式提示配置文件
│   └── README.md                   # 本文档
├── conditions/
│   ├── TutorialConditions.js       # 基础教程条件判断器
│   └── ProgressiveTipsConditions.js # 渐进式提示条件判断器
└── scenes/
    ├── Act1Scene.js                # 简化场景（使用基础教程配置）
    └── Act1SceneECS.js             # 完整ECS场景（使用两种配置）
```

## 配置文件说明

### 1. TutorialConfig.js - 基础教程配置

定义基础教程（移动、拾取、装备、战斗）的配置信息。

### 2. ProgressiveTipsConfig.js - 渐进式提示配置

定义渐进式提示（10个连续提示）的配置信息，用于引导玩家完成序章。

## 条件判断器说明

### 1. TutorialConditions.js - 基础教程条件判断器

实现基础教程的触发条件和完成条件判断函数。

### 2. ProgressiveTipsConditions.js - 渐进式提示条件判断器

实现渐进式提示的触发条件判断函数。

## 使用方法

### 场景 1：Act1Scene.js（简化场景）

只使用基础教程配置：

```javascript
import { TutorialConfig } from '../config/TutorialConfig.js';
import { TutorialConditions } from '../conditions/TutorialConditions.js';

// 在 registerTutorials() 方法中
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
    },
    completionCondition: (gameState) => {
      return TutorialConditions.evaluate(
        config.completionConditionId,
        this,
        gameState
      );
    }
  });
}
```

### 场景 2：Act1SceneECS.js（完整ECS场景）

同时使用基础教程配置和渐进式提示配置：

```javascript
import { TutorialConfig } from '../config/TutorialConfig.js';
import { TutorialConditions } from '../conditions/TutorialConditions.js';
import { ProgressiveTipsConfig } from '../config/ProgressiveTipsConfig.js';
import { ProgressiveTipsConditions } from '../conditions/ProgressiveTipsConditions.js';

// 基础教程
getBasicTutorialsConfig() {
  const tutorials = [];
  for (const tutorialId in TutorialConfig) {
    const config = TutorialConfig[tutorialId];
    tutorials.push({
      ...config,
      triggerCondition: () => {
        return TutorialConditions.evaluate(
          config.triggerConditionId,
          this,
          this.getGameState()
        );
      }
    });
  }
  return tutorials;
}

// 渐进式提示
getProgressiveTipsConfig() {
  const tips = [];
  for (const tipId in ProgressiveTipsConfig) {
    const config = ProgressiveTipsConfig[tipId];
    tips.push({
      ...config,
      triggerCondition: () => {
        return ProgressiveTipsConditions.evaluate(
          config.triggerConditionId,
          this
        );
      }
    });
  }
  return tips;
}
```

## 添加新教程

### 添加基础教程

#### 步骤 1：在 TutorialConfig.js 中添加配置

```javascript
export const TutorialConfig = {
  // ... 现有教程 ...
  
  new_tutorial: {
    id: 'new_tutorial',
    title: '新教程标题',
    description: '新教程描述',
    steps: [
      { text: '步骤1', position: 'top' },
      { text: '步骤2', position: 'center' }
    ],
    triggerConditionId: 'new_tutorial_trigger',
    completionConditionId: 'new_tutorial_complete',
    pauseGame: false,
    canSkip: true,
    priority: 5
  }
};
```

#### 步骤 2：在 TutorialConditions.js 中添加条件函数

```javascript
export class TutorialConditions {
  // ... 现有条件 ...
  
  static new_tutorial_trigger(scene, gameState) {
    return scene.someCondition === true;
  }

  static new_tutorial_complete(scene, gameState) {
    return scene.someProgress >= 100;
  }
}
```

### 添加渐进式提示

#### 步骤 1：在 ProgressiveTipsConfig.js 中添加配置

```javascript
export const ProgressiveTipsConfig = {
  // ... 现有提示 ...
  
  progressive_tip_11: {
    id: 'progressive_tip_11',
    title: '提示',
    description: '新提示描述',
    text: '新提示文本内容',
    position: 'center',
    priority: 90,
    triggerConditionId: 'progressive_tip_11_trigger'
  }
};
```

#### 步骤 2：在 ProgressiveTipsConditions.js 中添加条件函数

```javascript
export class ProgressiveTipsConditions {
  // ... 现有条件 ...
  
  static progressive_tip_11_trigger(scene) {
    return scene.someCondition && !scene.tutorialsCompleted.progressive_tip_11;
  }
}
```

## 优势

1. **配置与逻辑分离**：教程配置和条件判断分别管理，职责清晰
2. **易于维护**：修改教程配置或条件时，只需修改对应文件
3. **可扩展性强**：添加新教程只需在配置文件中添加，场景自动加载
4. **代码复用**：条件判断函数可以在多个教程中复用
5. **便于测试**：条件函数独立，易于单元测试
6. **统一管理**：所有教程配置集中在配置文件中，便于查看和修改

## 条件函数参数

### TutorialConditions（基础教程）

所有条件函数接收两个参数：
- `scene`：场景实例，可以访问场景的所有属性和方法
- `gameState`：游戏状态对象，包含当前游戏的状态信息

### ProgressiveTipsConditions（渐进式提示）

所有条件函数接收一个参数：
- `scene`：场景实例，可以访问场景的所有属性和方法

## 命名规范

### 配置ID命名

- 基础教程：使用小写字母和下划线，如 `movement`, `pickup`, `equipment`
- 渐进式提示：使用 `progressive_tip_` 前缀加数字，如 `progressive_tip_1`, `progressive_tip_2`

### 条件函数命名

- 基础教程触发条件：`{tutorialId}_trigger`
- 基础教程完成条件：`{tutorialId}_complete`
- 渐进式提示触发条件：`{tipId}_trigger`

例如：
- `movement_trigger` - 移动教程的触发条件
- `movement_complete` - 移动教程的完成条件
- `progressive_tip_1_trigger` - 第1个渐进式提示的触发条件

## 注意事项

1. 确保 `triggerConditionId` 和 `completionConditionId` 对应的函数存在
2. 条件函数必须返回布尔值
3. 条件函数应该是纯函数，避免副作用
4. 如果条件判断出错，系统会返回 `false` 并在控制台输出错误信息
5. 渐进式提示只有触发条件，没有完成条件（通过玩家操作自动完成）
6. 基础教程同时有触发条件和完成条件
