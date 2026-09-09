/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * Xbox360Profile.js
 *
 * Xbox 360（以及所有遵循 W3C "standard" 映射的兼容手柄）的按键档案。
 *
 * 包含三部分：
 *   1. BUTTON / AXIS 索引常量（W3C Standard Gamepad 布局）
 *   2. DEFAULT_BINDINGS —— 手柄按钮 → 项目已有虚拟键名的映射
 *   3. PAD_LAYOUT —— 手柄 UI 的绘制布局（归一化坐标，供 GamepadPanel 画图）
 *
 * 虚拟键名必须与 InputManager.keyMap 的输出保持一致，否则按下没反应：
 *   移动    up / down / left / right
 *   药水    skill1(红) / skill2(蓝)
 *   技能    skill3 / skill4 / skill5 / skill6 / skill7
 *   拾取    e        面板  c(属性) / b(背包) / v(装备)
 *   格挡    q        取消  escape
 *
 * authority: 'client'  // 纯输入映射，无游戏逻辑
 */

/** W3C Standard Gamepad 按钮索引（Xbox 360 实体按键） */
export const PadButton = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  LS: 10,          // 左摇杆按下
  RS: 11,          // 右摇杆按下
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  GUIDE: 16        // 中间的 Xbox 灯圈键（部分驱动不上报）
};

/** W3C Standard Gamepad 轴索引 */
export const PadAxis = {
  LEFT_X: 0,
  LEFT_Y: 1,
  RIGHT_X: 2,
  RIGHT_Y: 3
};

/** 按钮显示名（UI 用） */
export const PAD_BUTTON_LABELS = {
  [PadButton.A]: 'A',
  [PadButton.B]: 'B',
  [PadButton.X]: 'X',
  [PadButton.Y]: 'Y',
  [PadButton.LB]: 'LB',
  [PadButton.RB]: 'RB',
  [PadButton.LT]: 'LT',
  [PadButton.RT]: 'RT',
  [PadButton.BACK]: 'Back',
  [PadButton.START]: 'Start',
  [PadButton.LS]: 'LS',
  [PadButton.RS]: 'RS',
  [PadButton.DPAD_UP]: '↑',
  [PadButton.DPAD_DOWN]: '↓',
  [PadButton.DPAD_LEFT]: '←',
  [PadButton.DPAD_RIGHT]: '→',
  [PadButton.GUIDE]: 'Xbox'
};

/** 攻击动作标记：绑定值为此时，该按钮走手柄攻击流程（按住瞄准+释放攻击），不作为普通虚拟键 */
export const ATTACK_ACTION = 'attack';
/** 空绑定标记：该按钮不做任何事 */
export const NONE_ACTION = '';

// ---- 手柄专用动作标记（不映射为虚拟键，由 GamepadCombatController 解释） ----
export const SKILL_RELEASE_ACTION = 'skillRelease';   // RB：释放当前技能
export const SKILL_SWITCH_ACTION = 'skillSwitch';     // LB：切换技能（环形轮盘）
export const JUMP_ACTION = 'jump';                    // 可重绑：独立跳跃
export const FLIGHT_ACTION = 'flight';                // 兼容旧配置；新方案通过技能轮盘施展轻功
export const THROW_ACTION = 'throw';                  // 兼容旧配置；新方案通过技能轮盘施展投掷
export const BLOCK_ACTION = 'block';                  // LT 按住：格挡
export const SETTINGS_ACTION = 'settings';            // 系统设置/标题菜单

/**
 * 默认绑定：RT攻击 / RB释放所选技能 / LB选择技能 / Y按住蓄力、松开起跳 / LT格挡。
 * 轻功与投掷作为技能轮盘选项，由 LB 选择、RB 瞄准并释放。
 */
export const DEFAULT_BINDINGS = {
  [PadButton.A]: 'e',                   // 拾取/交互/确认对话
  [PadButton.B]: NONE_ACTION,           // 不再直连投掷
  [PadButton.X]: 'e',                   // 拾取/交互/确认对话（与A一致）
  [PadButton.Y]: JUMP_ACTION,           // 按住蓄力，松开起跳
  [PadButton.LB]: SKILL_SWITCH_ACTION,  // 切换技能（按住弹环形轮盘）
  [PadButton.RB]: SKILL_RELEASE_ACTION, // 释放当前选中技能
  [PadButton.LT]: BLOCK_ACTION,         // 格挡（按住生效）
  [PadButton.RT]: ATTACK_ACTION,        // 普通攻击（按住+右摇杆方向+释放）
  [PadButton.BACK]: 'b',               // 背包（属性+装备+物品）
  [PadButton.START]: SETTINGS_ACTION,   // 系统设置/标题菜单
  [PadButton.LS]: NONE_ACTION,          // 空出
  [PadButton.RS]: 'escape',             // 取消选中
  [PadButton.DPAD_UP]: 'skill1',        // 红药水
  [PadButton.DPAD_DOWN]: 'skill2',      // 蓝药水
  [PadButton.DPAD_LEFT]: NONE_ACTION,
  [PadButton.DPAD_RIGHT]: NONE_ACTION,
  [PadButton.GUIDE]: NONE_ACTION
};

/**
 * 可绑定动作清单（供编辑器下拉 + 运行时校验）。
 * value 是写进 bindings 的动作标记，label 是中文显示名。
 * value 必须与各系统实际读取的虚拟键名一致（见 InputManager.keyMap / CombatSystem.skillKeyMap）。
 */
export const BINDABLE_ACTIONS = [
  { value: NONE_ACTION, label: '（无）', group: '其它' },
  { value: ATTACK_ACTION, label: '攻击（按住瞄准）', group: '战斗' },
  { value: SKILL_RELEASE_ACTION, label: '释放技能', group: '战斗' },
  { value: SKILL_SWITCH_ACTION, label: '切换技能（轮盘）', group: '战斗' },
  { value: JUMP_ACTION, label: '跳跃（Y，按住蓄力，松开起跳）', group: '移动' },
  { value: BLOCK_ACTION, label: '格挡（按住生效）', group: '战斗' },
  { value: 'e', label: '拾取/交互/确认', group: '交互' },
  { value: 'skill1', label: '红药水', group: '快捷' },
  { value: 'skill2', label: '蓝药水', group: '快捷' },
  { value: 'b', label: '背包', group: '面板' },
  { value: SETTINGS_ACTION, label: '系统设置', group: '面板' },
  { value: 'escape', label: '取消选中', group: '其它' }
];

/** 动作 value → 中文名（快速查表） */
export const ACTION_LABELS = BINDABLE_ACTIONS.reduce((m, a) => { m[a.value] = a.label; return m; }, {});

/** 绑定的中文说明（UI 映射表用） */
export const BINDING_DESCRIPTIONS = {
  [PadButton.A]: '拾取/交互/确认',
  [PadButton.B]: '—',
  [PadButton.X]: '拾取/交互/确认',
  [PadButton.Y]: '跳跃（按住蓄力，松开起跳）',
  [PadButton.LB]: '切换技能（环形轮盘）',
  [PadButton.RB]: '释放技能',
  [PadButton.LT]: '格挡（按住生效）',
  [PadButton.RT]: '攻击（按住瞄准）',
  [PadButton.BACK]: '背包',
  [PadButton.START]: '系统设置',
  [PadButton.LS]: '—',
  [PadButton.RS]: '取消选中',
  [PadButton.DPAD_UP]: '红药水',
  [PadButton.DPAD_DOWN]: '蓝药水',
  [PadButton.DPAD_LEFT]: '—',
  [PadButton.DPAD_RIGHT]: '—',
  [PadButton.GUIDE]: '—'
};

/**
 * 手柄 UI 绘制布局。坐标为归一化值（0~1），相对面板的手柄绘制区。
 * shape: 'circle' 圆键 | 'round' 圆角矩形（肩键/扳机/Back/Start）
 */
export const PAD_LAYOUT = {
  /** 摇杆（cx, cy 为中心，r 为底盘半径） */
  sticks: [
    { axis: 'left', cx: 0.24, cy: 0.50, r: 0.085, clickButton: PadButton.LS, label: 'L' },
    { axis: 'right', cx: 0.62, cy: 0.68, r: 0.085, clickButton: PadButton.RS, label: 'R' }
  ],
  /** 按钮 */
  buttons: [
    { index: PadButton.Y, x: 0.855, y: 0.34, shape: 'circle', r: 0.045, color: '#d9b310' },
    { index: PadButton.B, x: 0.925, y: 0.44, shape: 'circle', r: 0.045, color: '#c0392b' },
    { index: PadButton.A, x: 0.855, y: 0.54, shape: 'circle', r: 0.045, color: '#27ae60' },
    { index: PadButton.X, x: 0.785, y: 0.44, shape: 'circle', r: 0.045, color: '#2980b9' },

    { index: PadButton.DPAD_UP, x: 0.40, y: 0.62, shape: 'round', w: 0.055, h: 0.075 },
    { index: PadButton.DPAD_DOWN, x: 0.40, y: 0.80, shape: 'round', w: 0.055, h: 0.075 },
    { index: PadButton.DPAD_LEFT, x: 0.33, y: 0.71, shape: 'round', w: 0.075, h: 0.055 },
    { index: PadButton.DPAD_RIGHT, x: 0.47, y: 0.71, shape: 'round', w: 0.075, h: 0.055 },

    { index: PadButton.LB, x: 0.22, y: 0.16, shape: 'round', w: 0.16, h: 0.07 },
    { index: PadButton.RB, x: 0.78, y: 0.16, shape: 'round', w: 0.16, h: 0.07 },
    { index: PadButton.LT, x: 0.22, y: 0.05, shape: 'round', w: 0.12, h: 0.06 },
    { index: PadButton.RT, x: 0.78, y: 0.05, shape: 'round', w: 0.12, h: 0.06 },

    { index: PadButton.BACK, x: 0.44, y: 0.38, shape: 'round', w: 0.075, h: 0.05 },
    { index: PadButton.START, x: 0.62, y: 0.38, shape: 'round', w: 0.075, h: 0.05 },
    { index: PadButton.GUIDE, x: 0.53, y: 0.31, shape: 'circle', r: 0.038, color: '#6f7d86' }
  ]
};

/** 该 gamepad 是否为 standard 映射（非 standard 时索引不可信） */
export function isStandardMapping(pad) {
  return !!pad && (pad.mapping === 'standard' || pad.mapping === '');
}

/** 从 gamepad.id 粗略判断是否 Xbox 系手柄（仅用于 UI 文案，不影响映射） */
export function looksLikeXboxPad(pad) {
  if (!pad || !pad.id) return false;
  const id = pad.id.toLowerCase();
  return id.includes('xbox') || id.includes('xinput') || id.includes('360');
}

export default { PadButton, PadAxis, DEFAULT_BINDINGS, PAD_LAYOUT };
