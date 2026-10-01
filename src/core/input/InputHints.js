/**
 * InputHints - 按输入方案分版本的操作提示文案（框架级）
 *
 * 三套输入方案：
 *   pc       键盘鼠标
 *   android  触屏（虚拟摇杆 + DOM 按钮）
 *   gamepad  手柄（Xbox 360 / W3C standard）
 *
 * 方案判定优先级：手柄已连接 > PlatformProfile.isMobile > pc。
 * 手柄接上就切到手柄文案，符合玩家当下实际在用的设备。
 *
 * 手柄按键名不写死，而是用当前绑定表反查按钮标签，
 * 这样在 UIEditor 里改过绑定后提示会自动跟随。
 *
 * 用法：
 *   InputHints.setInputManager(inputManager);        // 一次即可，用于手柄检测与绑定反查
 *   InputHints.phrase('bag')                         // '按 B 键' / '点击背包按钮' / '按手柄 Back 键'
 *   InputHints.key('settings')                      // 'Esc' / '系统设置按钮' / 'Start'
 *   InputHints.key('bag')                           // 'B' / '背包按钮' / 'Back'
 *   InputHints.format('{bag}打开背包，使用符水')      // 整句按当前方案替换
 *   InputHints.format('{bag}打开背包', { keyWrapper: k => `<span class="key">${k}</span>` })
 */

import { PlatformProfile } from '../PlatformProfile.js';
import {
  PAD_BUTTON_LABELS,
  ATTACK_ACTION,
  JUMP_ACTION,
  SKILL_RELEASE_ACTION
} from './Xbox360Profile.js';

/**
 * 动作定义。
 *   pc.key      键盘/鼠标按键名
 *   pc.kind     'key' 按键（生成"按 X 键"）| 'raw' 直接用（生成"点击X"）
 *   android     触屏控件名（生成"点击X"）
 *   padKey      手柄侧要反查的虚拟键名；ATTACK_ACTION 表示攻击动作
 *   padFixed    固定的手柄部件名（摇杆等非按钮，无法从绑定反查）
 */
const DEFAULT_ACTIONS = {
  move: { pc: { key: 'W/A/S/D', kind: 'key' }, android: '虚拟摇杆', padFixed: '左摇杆', padKind: 'raw' },
  moveTo: { pc: { key: '鼠标右键', kind: 'raw' }, android: '点击地面', padFixed: '左摇杆', padKind: 'raw' },
  aim: { pc: { key: '鼠标', kind: 'raw' }, android: '拖动技能按钮', padFixed: '右摇杆', padKind: 'raw' },
  attack: { pc: { key: '鼠标左键', kind: 'raw' }, android: '攻击按钮', padKey: ATTACK_ACTION },
  pickup: { pc: { key: 'E', kind: 'key' }, android: '交互按钮', padKey: 'e' },
  interact: { pc: { key: 'E', kind: 'key' }, android: '交互按钮', padKey: 'e' },
  bag: { pc: { key: 'B', kind: 'key' }, android: '背包按钮', padKey: 'b' },
  settings: { pc: { key: 'Esc', kind: 'key' }, android: '系统设置按钮', padKey: 'settings', padFallback: 'Start' },
  playerInfo: { pc: { key: 'C', kind: 'key' }, android: '背包按钮', padKey: 'b' },
  block: { pc: { key: 'Q', kind: 'key' }, android: '格挡按钮', padFixed: 'LT', padKind: 'key' },
  flight: { pc: { key: 'Ctrl', kind: 'key' }, android: '轻功按钮', padKey: SKILL_RELEASE_ACTION, padFallback: '未绑定' },
  jump: { pc: { key: '空格', kind: 'key' }, android: '跳跃按钮', padKey: JUMP_ACTION, padFallback: '未绑定' },
  powerJump: { pc: { key: '技能快捷键', kind: 'raw' }, android: '用力跳技能按钮', padKey: SKILL_RELEASE_ACTION, padFallback: '未绑定' },
  climb: { pc: { key: '空格（靠近攀爬面）', kind: 'key' }, android: '靠近攀爬面后点击跳跃按钮', padKey: JUMP_ACTION, padFallback: '未绑定' },
  throw: { pc: { key: 'Shift', kind: 'key' }, android: '投掷按钮', padKey: SKILL_RELEASE_ACTION, padFallback: '未绑定' },
  harvest: { pc: { key: 'E', kind: 'key' }, android: '交互按钮', padKey: 'e' },
  potionHp: { pc: { key: '1', kind: 'key' }, android: '红瓶按钮', padFixed: '十字键↑', padKind: 'key' },
  potionMp: { pc: { key: '2', kind: 'key' }, android: '蓝瓶按钮', padFixed: '十字键↓', padKind: 'key' },
  skill1: { pc: { key: '3', kind: 'key' }, android: '技能按钮', padFixed: 'RB', padKind: 'key' },
  skill2: { pc: { key: '4', kind: 'key' }, android: '技能按钮', padFixed: 'RB', padKind: 'key' },
  skill3: { pc: { key: '5', kind: 'key' }, android: '技能按钮', padFixed: 'RB', padKind: 'key' },
  heal: { pc: { key: '6', kind: 'key' }, android: '回血按钮', padFixed: 'RB', padKind: 'key' },
  meditation: { pc: { key: '7', kind: 'key' }, android: '打坐按钮', padFixed: 'RB', padKind: 'key' },
  nextAct: { pc: { key: 'N', kind: 'key' }, android: '交互按钮', padKey: 'n' },
  dialogueContinue: { pc: { key: 'E', kind: 'key' }, android: '点击对话框', padKey: 'e', padFallback: 'X' },
  confirm: { pc: { key: 'E/回车', kind: 'key' }, android: '确认按钮', padKey: 'e', padFallback: 'A' },
  modalCancel: { pc: { key: 'Esc', kind: 'key' }, android: '取消按钮', padFixed: 'B', padKind: 'key' },
  modalNavigate: { pc: { key: '方向键', kind: 'key' }, android: '点击选项', padFixed: '十字键', padKind: 'key' },
  modalDecrease: { pc: { key: '-', kind: 'key' }, android: '减量按钮', padFixed: 'LB', padKind: 'key' },
  modalIncrease: { pc: { key: '+', kind: 'key' }, android: '加量按钮', padFixed: 'RB', padKind: 'key' },
  cancel: { pc: { key: 'Esc', kind: 'key' }, android: '返回', padKey: 'escape' },
  skillTree: { pc: { key: 'T', kind: 'key' }, android: '技能树按钮', padKey: 't' },
  attribute: { pc: { key: 'P', kind: 'key' }, android: '背包按钮', padKey: 'p' },
  unitInfo: { pc: { key: 'U', kind: 'key' }, android: '兵种按钮', padKey: 'u' },
  map: { pc: { key: 'M', kind: 'key' }, android: '地图按钮', padKey: 'm' }
};

const SCHEME_LABELS = { pc: '键鼠', android: '触屏', gamepad: '手柄' };

class InputHintsRegistry {
  constructor() {
    this.actions = JSON.parse(JSON.stringify(DEFAULT_ACTIONS));
    this._inputManager = null;
    /** 强制方案（调试用），null 表示自动判定 */
    this._forcedScheme = null;
    /** 最后活跃的输入设备：'pc' | 'gamepad'，用于桌面端在鼠标与手柄之间自动切换 */
    this._lastInputDevice = 'pc';
  }

  /** 绑定 InputManager，用于手柄连接检测与按键绑定反查 */
  setInputManager(inputManager) {
    this._inputManager = inputManager;
  }

  /** 当前动作表（编辑器列出全部动作用），返回深拷贝避免外部误改 */
  getActions() {
    return JSON.parse(JSON.stringify(this.actions));
  }

  /** 内置默认动作表（编辑器"恢复默认"用） */
  getDefaultActions() {
    return JSON.parse(JSON.stringify(DEFAULT_ACTIONS));
  }

  /**
   * 从项目配置加载文案覆盖（UIEditor 的「提示文案」标签页保存的文件）。
   * 文件不存在时静默沿用内置默认表。
   * @param {string} [basePath='config/'] - 配置目录（相对游戏入口）
   * @returns {Promise<boolean>} 是否成功加载
   */
  async load(basePath = 'config/') {
    const url = `${basePath}InputHints.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const data = await res.json();
      this.merge(data && data.actions ? data.actions : data);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 合并项目侧的动作覆盖（可来自 config JSON），只覆盖给出的字段。
   * @param {Object} overrides - { actionName: { pc, android, padKey, ... } }
   */
  merge(overrides) {
    if (!overrides) return;
    for (const [name, def] of Object.entries(overrides)) {
      this.actions[name] = { ...(this.actions[name] || {}), ...def };
    }
  }

  /** 强制使用某方案；传 null 恢复自动判定 */
  setScheme(scheme) {
    this._forcedScheme = (scheme === 'pc' || scheme === 'android' || scheme === 'gamepad') ? scheme : null;
  }

  /**
   * 通知有鼠标/键盘输入发生：切回 PC 方案。
   * 由 InputManager 在检测到鼠标点击或键盘按键时调用。
   */
  notifyMouseOrKeyboard() {
    this._lastInputDevice = 'pc';
  }

  /**
   * 通知有手柄按钮输入发生：切到手柄方案。
   * 由 InputManager 在手柄有按键活动时调用。
   */
  notifyGamepad() {
    this._lastInputDevice = 'gamepad';
  }

  /** 当前输入方案：'pc' | 'android' | 'gamepad' */
  get scheme() {
    if (this._forcedScheme) return this._forcedScheme;
    // 移动端固定为 android
    if (PlatformProfile.isMobile) return 'android';
    // PC/手柄桌面端：按最后使用的设备切换
    if (this._lastInputDevice === 'gamepad') {
      const gamepad = this._inputManager && this._inputManager.gamepad;
      if (gamepad && typeof gamepad.isConnected === 'function' && gamepad.isConnected()) {
        return 'gamepad';
      }
    }
    return 'pc';
  }

  /** 当前方案的中文名（调试面板等处显示） */
  get schemeLabel() {
    return SCHEME_LABELS[this.scheme] || this.scheme;
  }

  /**
   * 动作对应的按键/控件名（不含"按""点击"等动词）
   * @param {string} action
   * @returns {string}
   */
  key(action) {
    const def = this.actions[action];
    if (!def) return action;
    const scheme = this.scheme;
    if (scheme === 'gamepad') return this._padKey(def);
    if (scheme === 'android') return def.android || (def.pc && def.pc.key) || action;
    return (def.pc && def.pc.key) || action;
  }

  /**
   * 动作的完整操作短语
   * @param {string} action
   * @param {Object} [options]
   * @param {Function} [options.keyWrapper] - 包裹按键名（如加 HTML 高亮）
   * @returns {string}
   */
  phrase(action, options = {}) {
    const def = this.actions[action];
    if (!def) return action;
    const scheme = this.scheme;
    const rawKey = this.key(action);
    const wrap = options.keyWrapper || ((k) => k);
    const wrapped = wrap(rawKey);

    if (scheme === 'gamepad') {
      if (rawKey === '未绑定') return `（手柄未绑定${def.android || action}）`;
      const kind = def.padKind || 'key';
      return kind === 'raw' ? `推动${wrapped}` : `按手柄 ${wrapped} 键`;
    }
    if (scheme === 'android') {
      // 控件名本身就带动作语义时（如"点击地面"）不再叠加动词
      return /^(点击|拖动|长按|滑动)/.test(rawKey) ? wrapped : `点击${wrapped}`;
    }
    const kind = (def.pc && def.pc.kind) || 'key';
    return kind === 'raw' ? `点击${wrapped}` : `按 ${wrapped} 键`;
  }

  /**
   * 替换模板里的动作占位符。
   *   {action}      → 完整短语
   *   {key:action}  → 仅按键/控件名
   * @param {string} template
   * @param {Object} [options] - 同 phrase 的 options
   * @returns {string}
   */
  format(template, options = {}) {
    if (typeof template !== 'string') return template;
    return template.replace(/\{(key:)?([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, keyOnly, action) => {
      if (!this.actions[action]) return match;
      return keyOnly ? (options.keyWrapper || ((k) => k))(this.key(action)) : this.phrase(action, options);
    });
  }

  /**
   * 便捷方法：按 HTML 高亮包裹按键名（配合 demo 的 .key 样式）。
   * 多键组合（如 PC 的 'W/A/S/D'）拆分为各自独立外框，便于区分单个按键；
   * 含中文（'空格/E'、'E/回车'）的组合保持单框，避免把中文短语切开。
   */
  formatHtml(template, className = 'key') {
    return this.format(template, { keyWrapper: (k) => {
      const tokens = /^[A-Z0-9][A-Z0-9/]*$/.test(String(k))
        ? String(k).split('/').filter(Boolean)
        : [k];
      return tokens.map(token => `<span class="${className}">${token}</span>`).join('');
    } });
  }

  /**
   * 从当前手柄绑定表反查按钮标签，绑定改了提示也跟着改。
   * @private
   */
  _padKey(def) {
    if (def.padFixed) return def.padFixed;
    if (!def.padKey) return def.android || (def.pc && def.pc.key) || '';
    const gamepad = this._inputManager && this._inputManager.gamepad;
    const bindings = (gamepad && gamepad.bindings) || null;
    if (bindings) {
      for (const [index, bound] of Object.entries(bindings)) {
        if (bound === def.padKey) {
          const label = PAD_BUTTON_LABELS[index] || PAD_BUTTON_LABELS[Number(index)];
          if (label) return label;
        }
      }
    }
    // 该动作在手柄上没有绑定：优先用 padFallback，不退回 android 说法（那是触屏的）
    return def.padFallback || (def.pc && def.pc.key) || '';
  }
}

/** 全局单例：文案表是全局共享的展示配置 */
export const InputHints = new InputHintsRegistry();

export default InputHints;
