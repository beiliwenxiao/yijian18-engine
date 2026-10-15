---
inclusion: manual
---

# 操作提示文案分版本（pc / android / gamepad）

所有面向玩家的操作说明（对话、教程、提示条、通知、UI 上的热键角标）都必须按输入方案取文案，**禁止写死单一平台的说法**。

## 三套输入方案

| scheme | 场景 | 移动 | 攻击 | 跳跃 | 轻功 |
|---|---|---|---|---|---|
| `pc` | 键盘鼠标 | W/A/S/D | 鼠标左键 | 空格 | Ctrl |
| `android` | 触屏 | 虚拟摇杆 | 攻击按钮 | 跳跃按钮 | 轻功按钮 |
| `gamepad` | Xbox 360 手柄 | 左摇杆 | RT（默认） | Y（按下即跳跃） | LB 选择“轻功”后按 RB 释放 |

判定优先级：**手柄已连接 > `PlatformProfile.isMobile` > pc**。手柄插上就切手柄文案，因为那是玩家当下实际在用的设备。

## 在哪里编辑

**UIEditor → 「💬 提示文案」标签页**（与 PC UI / Android UI / 登录页面 UI / 手柄 并列）。

表格每行一个动作，可编辑：PC 按键、PC 句式（按X键 / 点击X）、Android 控件名、手柄绑定动作。最后一列实时显示三套方案的预览。点「💾 保存到文件」写入 `example/{game}/config/InputHints.json`；「恢复默认」回到框架内置表。

- 手柄列选的是**绑定动作**（虚拟键名），不是按钮名。按钮名由手柄绑定表反查，改绑定后提示自动变。
- 摇杆类动作（move/aim）显示为「固定：左摇杆」，不参与绑定反查，不可改。
- 预览用的是框架的 `InputHints.phrase()`，与游戏内同源，不是编辑器另写一套。

数据流：
```
框架内置 DEFAULT_ACTIONS  →  config/InputHints.json 覆盖  →  运行时 InputHints
        （代码）                （UIEditor 保存）          （BaseGameScene 启动时 load）
```
运行时在 `BaseGameScene._applyUILayout()` 开头 `await InputHints.load('config/')`。文件不存在就沿用内置默认表，不报错。

## 唯一入口：src/core/input/InputHints.js

```js
import { InputHints } from '../../../src/core/input/InputHints.js';

InputHints.setInputManager(this.inputManager);   // 场景创建 InputManager 后调一次

InputHints.key('bag')      // 'B' / '背包按钮' / 'Back'
InputHints.key('settings') // 'Esc' / '系统设置按钮' / 当前绑定按钮（默认 Start）
InputHints.phrase('bag')   // '按 B 键' / '点击背包按钮' / '按手柄 Back 键'
InputHints.format('{bag}打开背包，使用符水')      // 整句替换
InputHints.formatHtml('{bag}打开背包')            // 按键名包 <span class="key">
InputHints.scheme          // 'pc' | 'android' | 'gamepad'
InputHints.schemeLabel     // '键鼠' | '触屏' | '手柄'
```

占位符两种：
- `{action}` → 完整短语（含"按/点击"动词）
- `{key:action}` → 只要按键名，用于自己拼句式（如 `{key:skillTree}/{key:attribute}` 并列）

未注册的动作名原样保留，不会抛错也不会吞掉文本。

## 写法约定

**正确**：文案只写一份，动词由 InputHints 生成。
```js
this.showHint(InputHints.formatHtml('{bag}打开背包，使用符水'));
```

**错误**：按平台分叉，且永远漏掉手柄。
```js
if (this.isMobileLayout) this.showHint('点击背包...');
else this.showHint('按 B 键...');
```

UI 热键角标同样走它，不要写字面量：
```js
new IconButton({ icon: '🎒', label: '背包', hotkey: InputHints.key('bag') })
```

触发器数据（`game.project.json` 的 `showTip.text`）里直接写占位符，`TriggerActions.showTip` 会调 `InputHints.format` 替换。

## 手柄文案自动跟随绑定

动作定义里 `padKey` 是**虚拟键名**（如 `'e'`、`'skill1'`、`ATTACK_ACTION`），不是按钮名。取文案时用 `gamepad.bindings` 反查按钮索引，再查 `PAD_BUTTON_LABELS`。

这样玩家在 UIEditor 手柄标签页改了绑定，提示会自动变。**不要在文案里写死 'A'、'Start' 这类按钮名。**

某动作在手柄上没有绑定时，退回触屏/键鼠说法，不会显示空白。

## 新增动作

在 `DEFAULT_ACTIONS` 里加一项，三套都要给：
```js
harvest: { pc: { key: 'F', kind: 'key' }, android: '采集按钮', padKey: 'f' }
```
- `pc.kind`：`'key'` → "按 X 键"；`'raw'` → "点击X"（鼠标类用这个）
- `android`：控件名。若本身带动作语义（如"点击地面"），不会再叠加"点击"
- `padFixed` + `padKind:'raw'`：摇杆等非按钮部件，生成"推动左摇杆"

项目侧可用 `InputHints.merge({...})` 覆盖，不必改框架默认表。

## 调试

调试面板「手柄」分组显示当前 `提示方案`。`InputHints.setScheme('gamepad')` 可强制某方案验证文案，传 `null` 恢复自动判定。
