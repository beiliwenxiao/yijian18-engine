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

# 序章音效系统使用指南

## 概述

序章音效系统基于游戏引擎的 `AudioManager`，提供了完整的音乐和音效管理功能。本指南说明如何在序章场景中使用音效系统。

## 音频配置

所有音频配置定义在 `src/prologue/data/AudioConfig.json` 文件中，包括：

- **音乐 (music)**: 背景音乐，循环播放
- **音效 (sfx)**: 短音效，用于游戏事件
- **场景音乐映射 (sceneMusic)**: 每一幕对应的背景音乐

## 在场景中使用音效

### 1. 通过 PrologueManager 播放音效

```javascript
// 在场景中获取 PrologueManager
const prologueManager = this.data.prologueManager;

// 播放音效
prologueManager.playSound('attack_sword');
prologueManager.playSound('pickup_item');
prologueManager.playSound('ui_click');

// 播放音效并设置音量
prologueManager.playSound('hit_critical', { volume: 0.9 });
```

### 2. 播放音乐

```javascript
// 播放指定音乐（带淡入效果）
prologueManager.playMusic('battle_theme', true);

// 播放战斗音乐（快捷方法）
prologueManager.playBattleMusic();

// 播放史诗战斗音乐
prologueManager.playEpicBattleMusic();

// 恢复场景音乐
prologueManager.resumeSceneMusic();

// 停止音乐（带淡出效果）
prologueManager.stopMusic(true);
```

### 3. 音量控制

```javascript
// 设置主音量
prologueManager.setVolume('master', 0.8);

// 设置音效音量
prologueManager.setVolume('sound', 0.7);

// 设置音乐音量
prologueManager.setVolume('music', 0.5);

// 获取音量
const masterVolume = prologueManager.getVolume('master');

// 切换静音
prologueManager.toggleMute();

// 检查是否静音
if (prologueManager.isMuted()) {
    console.log('音频已静音');
}
```

## 常用音效列表

### 战斗音效

- `attack_sword` - 剑类武器攻击
- `attack_bow` - 弓箭攻击
- `attack_magic` - 法术攻击
- `hit_normal` - 普通命中
- `hit_critical` - 暴击命中
- `player_hurt` - 玩家受伤
- `enemy_hurt` - 敌人受伤
- `player_death` - 玩家死亡
- `enemy_death` - 敌人死亡

### 物品音效

- `pickup_item` - 拾取物品
- `pickup_coin` - 拾取货币
- `equip_item` - 装备物品
- `unequip_item` - 卸下装备
- `enhance_success` - 强化成功
- `enhance_fail` - 强化失败
- `shop_buy` - 购买物品
- `shop_sell` - 出售物品

### UI 音效

- `ui_click` - UI 点击
- `ui_hover` - UI 悬停
- `ui_open` - UI 面板打开
- `ui_close` - UI 面板关闭
- `dialogue_open` - 对话框打开
- `dialogue_close` - 对话框关闭
- `dialogue_text` - 对话文字显示

### 游戏事件音效

- `skill_learn` - 学习技能
- `level_up` - 升级
- `quest_complete` - 任务完成
- `battle_start` - 战斗开始
- `battle_victory` - 战斗胜利
- `battle_defeat` - 战斗失败
- `general_appear` - 历史武将登场
- `npc_recruit` - NPC 招募
- `class_select` - 职业选择
- `prologue_complete` - 序章完成

### 环境音效

- `footstep` - 脚步声
- `door_open` - 门打开
- `ambient_wind` - 环境音 - 风声
- `ambient_crowd` - 环境音 - 人群声

## 音乐列表

- `prologue_theme` - 序章主题音乐
- `battle_theme` - 战斗音乐
- `peaceful_theme` - 和平场景音乐
- `epic_battle_theme` - 史诗战斗音乐
- `ending_theme` - 结局音乐

## 场景音乐自动切换

每一幕都有对应的背景音乐，在场景切换时会自动播放：

- 第一幕：`prologue_theme` - 序章主题
- 第二幕：`peaceful_theme` - 和平场景
- 第三幕：`peaceful_theme` - 和平场景
- 第四幕：`peaceful_theme` - 和平场景
- 第五幕：`epic_battle_theme` - 史诗战斗
- 第六幕：`ending_theme` - 结局音乐

## 使用示例

### 示例 1: 战斗场景

```javascript
class BattleScene extends PrologueScene {
    enter(data) {
        super.enter(data);
        
        // 播放战斗开始音效
        this.prologueManager.playSound('battle_start');
        
        // 切换到战斗音乐
        this.prologueManager.playBattleMusic();
    }
    
    onPlayerAttack() {
        // 根据武器类型播放攻击音效
        const weaponType = this.player.equipment.weapon?.type;
        if (weaponType === 'sword') {
            this.prologueManager.playSound('attack_sword');
        } else if (weaponType === 'bow') {
            this.prologueManager.playSound('attack_bow');
        }
    }
    
    onEnemyHit(isCritical) {
        // 播放命中音效
        if (isCritical) {
            this.prologueManager.playSound('hit_critical');
        } else {
            this.prologueManager.playSound('hit_normal');
        }
        
        this.prologueManager.playSound('enemy_hurt');
    }
    
    onBattleEnd(victory) {
        if (victory) {
            this.prologueManager.playSound('battle_victory');
        } else {
            this.prologueManager.playSound('battle_defeat');
        }
        
        // 恢复场景音乐
        setTimeout(() => {
            this.prologueManager.resumeSceneMusic();
        }, 2000);
    }
}
```

### 示例 2: 对话场景

```javascript
class DialogueScene extends PrologueScene {
    showDialogue(dialogue) {
        // 播放对话框打开音效
        this.prologueManager.playSound('dialogue_open');
        
        // 显示对话框
        this.dialogueBox.show(dialogue);
    }
    
    onDialogueTextUpdate() {
        // 打字机效果时播放文字音效
        this.prologueManager.playSound('dialogue_text', { volume: 0.3 });
    }
    
    closeDialogue() {
        // 播放对话框关闭音效
        this.prologueManager.playSound('dialogue_close');
        
        this.dialogueBox.hide();
    }
}
```

### 示例 3: 装备系统

```javascript
class EquipmentPanel extends UIElement {
    equipItem(item) {
        // 装备物品
        this.player.equipment[item.slot] = item;
        
        // 播放装备音效
        this.prologueManager.playSound('equip_item');
        
        this.render();
    }
    
    enhanceItem(item) {
        const result = this.enhancementSystem.enhance(item);
        
        if (result.success) {
            // 强化成功
            this.prologueManager.playSound('enhance_success');
        } else {
            // 强化失败
            this.prologueManager.playSound('enhance_fail');
        }
    }
}
```

## 注意事项

### 1. 音频文件占位符

当前 `assets/audio` 文件夹为空，音频配置作为占位符使用。实际使用时需要：

- 将真实的音频文件放入 `assets/audio/music` 和 `assets/audio/sfx` 目录
- 确保文件名与配置文件中的路径匹配
- 推荐使用 MP3 格式（兼容性好）

### 2. 优雅降级

如果音频文件不存在，`AudioManager` 会：

- 在控制台输出警告信息
- 继续正常运行，不影响游戏逻辑
- 不会抛出错误或中断游戏

### 3. 性能考虑

- 音效会创建多个实例以支持重叠播放
- 音乐只有一个实例，切换时会自动停止前一个
- 使用淡入淡出效果可以让音乐切换更平滑

### 4. 音量建议

- 主音量 (master): 0.8-1.0
- 音效音量 (sound): 0.6-0.8
- 音乐音量 (music): 0.4-0.6

### 5. 浏览器自动播放策略

现代浏览器可能会阻止自动播放音频，需要用户交互后才能播放。建议：

- 在用户点击"开始游戏"后初始化音频
- 提供静音选项
- 在设置中提供音量控制

## 扩展音效系统

如果需要添加新的音效：

1. 将音频文件放入 `assets/audio/sfx` 或 `assets/audio/music`
2. 在 `AudioConfig.json` 中添加配置
3. 在代码中使用 `prologueManager.playSound('new_sound_key')`

示例：

```json
{
  "sfx": {
    "new_sound": {
      "file": "assets/audio/sfx/new_sound.mp3",
      "volume": 0.7,
      "description": "新音效描述"
    }
  }
}
```

## 调试

查看音频系统状态：

```javascript
// 获取 AudioManager 统计信息
const stats = this.prologueManager.audioManager.getStats();
console.log('Audio Stats:', stats);

// 输出示例：
// {
//   totalSounds: 35,
//   totalMusic: 5,
//   activeSounds: 2,
//   currentMusic: 'battle_theme',
//   masterVolume: 1.0,
//   soundVolume: 0.7,
//   musicVolume: 0.5,
//   muted: false
// }
```

## 总结

序章音效系统提供了完整的音频管理功能，通过 `PrologueManager` 的辅助方法可以方便地在场景中使用。系统设计考虑了优雅降级和性能优化，即使音频文件缺失也不会影响游戏运行。
