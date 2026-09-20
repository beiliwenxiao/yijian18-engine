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
 * UIEditor - 界面 UI 编辑器
 *
 * 可视化编辑游戏 UI 组件（按钮、面板、摇杆等）的位置和大小，
 * 分 PC、Android 游戏 UI 与 PC/Android 登录页面四套布局，保存为 JSON 配置文件：
 *   - config/UILayout.desktop.json
 *   - config/UILayout.mobile.json
 *   - config/LoginLayout.desktop.json
 *   - config/LoginLayout.mobile.json
 *
 * 保存通过 Vite dev server 的 /api/save-file 写入实际文件。
 * 游戏入口运行时根据平台加载对应 JSON 动态应用布局。
 */

// 各平台默认组件定义（与游戏实际 UI 对齐）
// 坐标系：以“逻辑画布”左上角为原点；锚点说明见各组件 anchor 字段
const DEFAULT_COMPONENTS = {
  desktop: {
    // 画布逻辑尺寸（仅用于编辑器预览参考）
    canvas: { width: 1280, height: 720 },
    components: [
      // 右侧 Canvas HUD：Android/PC 共用稳定 ID，运行时按当前平台布局加载。
      { id: 'minimap', label: '小地图', x: 1120, y: 10, width: 150, height: 150, anchor: 'topleft', kind: 'panel' },
      { id: 'timeWeatherBadge', label: '时间/天气', x: 960, y: 10, width: 150, height: 54, fontSize: 0, textOffsetX: 0, textOffsetY: 0, anchor: 'topleft', kind: 'panel' },
      { id: 'combatStateBadge', label: '战斗/灵魂状态', x: 1030, y: 72, width: 80, height: 30, fontSize: 0, textOffsetX: 0, textOffsetY: 0, anchor: 'topleft', kind: 'panel' },
      { id: 'taskTracker', label: '任务追踪', x: 18, y: 86, width: 340, height: 150, anchor: 'topleft', kind: 'panel' },
      // 统一背包外框（属性、装备和物品栏的内部部件由 PanelEditor 编辑）
      { id: 'backpackPanel', label: '背包', x: 190, y: 100, width: 900, height: 520, anchor: 'topleft', kind: 'panel' },
      // 底部控制栏拆分为独立小控件（血球/蓝球/2药水/5技能）
      { id: 'pc-hp-orb', label: '血球', x: 397, y: 625, width: 70, height: 70, anchor: 'topleft', kind: 'button' },
      { id: 'pc-potion1', label: '红瓶', x: 482, y: 640, width: 40, height: 40, anchor: 'topleft', kind: 'button' },
      { id: 'pc-potion2', label: '蓝瓶', x: 528, y: 640, width: 40, height: 40, anchor: 'topleft', kind: 'button' },
      { id: 'pc-skill1', label: '技能1', x: 574, y: 640, width: 40, height: 40, anchor: 'topleft', kind: 'button' },
      { id: 'pc-skill2', label: '技能2', x: 620, y: 640, width: 40, height: 40, anchor: 'topleft', kind: 'button' },
      { id: 'pc-skill3', label: '技能3', x: 666, y: 640, width: 40, height: 40, anchor: 'topleft', kind: 'button' },
      { id: 'pc-skill4', label: '技能4', x: 712, y: 640, width: 40, height: 40, anchor: 'topleft', kind: 'button' },
      { id: 'pc-skill5', label: '技能5', x: 758, y: 640, width: 40, height: 40, anchor: 'topleft', kind: 'button' },
      { id: 'pc-mp-orb', label: '蓝球', x: 813, y: 625, width: 70, height: 70, anchor: 'topleft', kind: 'button' },
      // 格挡 / 跳跃 / 轻功 / 投掷
      { id: 'pc-block', label: '格挡', x: 666, y: 640, width: 50, height: 50, anchor: 'topleft', kind: 'button' },
      { id: 'pc-jump', label: '跳跃', x: 722, y: 640, width: 50, height: 50, anchor: 'topleft', kind: 'button' },
      { id: 'pc-flight', label: '轻功', x: 778, y: 640, width: 50, height: 50, anchor: 'topleft', kind: 'button' },
      { id: 'pc-throw', label: '投掷', x: 834, y: 640, width: 50, height: 50, anchor: 'topleft', kind: 'button' },
      // 统一背包入口 + 系统设置
      { id: 'pc-bag', label: '背包', x: 890, y: 640, width: 50, height: 50, anchor: 'topleft', kind: 'button' },
      { id: 'pc-settings', label: '系统设置', x: 946, y: 640, width: 50, height: 50, anchor: 'topleft', kind: 'button' }
    ]
  },
  mobile: {
    canvas: { width: 1280, height: 600 },
    components: [
      { id: 'minimap', label: '小地图', x: 1120, y: 10, width: 150, height: 150, anchor: 'topleft', kind: 'panel' },
      { id: 'timeWeatherBadge', label: '时间/天气', x: 960, y: 10, width: 150, height: 54, fontSize: 0, textOffsetX: 0, textOffsetY: 0, anchor: 'topleft', kind: 'panel' },
      { id: 'combatStateBadge', label: '战斗/灵魂状态', x: 1030, y: 72, width: 80, height: 30, fontSize: 0, textOffsetX: 0, textOffsetY: 0, anchor: 'topleft', kind: 'panel' },
      { id: 'taskTracker', label: '任务追踪', x: 18, y: 82, width: 340, height: 140, anchor: 'topleft', kind: 'panel' },
      { id: 'backpackPanel', label: '背包', x: 190, y: 40, width: 900, height: 500, anchor: 'topleft', kind: 'panel' },
      { id: 'joystick', label: '摇杆区', x: 0, y: 270, width: 384, height: 330, anchor: 'topleft', kind: 'zone' },
      { id: 'hud-avatar', label: 'HUD头像', x: 10, y: 10, width: 56, height: 56, anchor: 'topleft', kind: 'button' },
      { id: 'hud-name', label: 'HUD昵称', x: 78, y: 10, width: 140, height: 20, anchor: 'topleft', kind: 'panel' },
      { id: 'hud-hp', label: 'HUD血条', x: 78, y: 32, width: 140, height: 14, anchor: 'topleft', kind: 'panel' },
      { id: 'hud-mp', label: 'HUD蓝条', x: 78, y: 52, width: 140, height: 14, anchor: 'topleft', kind: 'panel' },
      { id: 'act-attack', label: '攻击', x: 1126, y: 510, width: 78, height: 78, anchor: 'topleft', kind: 'button' },
      { id: 'act-block', label: '格挡', x: 1126, y: 544, width: 56, height: 56, anchor: 'topleft', kind: 'button' },
      { id: 'act-skill3', label: '技能3', x: 1102, y: 452, width: 62, height: 62, anchor: 'topleft', kind: 'button' },
      { id: 'act-skill4', label: '技能4', x: 1062, y: 386, width: 62, height: 62, anchor: 'topleft', kind: 'button' },
      { id: 'act-skill5', label: '技能5', x: 986, y: 380, width: 62, height: 62, anchor: 'topleft', kind: 'button' },
      { id: 'act-flight', label: '轻功', x: 956, y: 476, width: 56, height: 56, anchor: 'topleft', kind: 'button' },
      { id: 'act-jump', label: '跳跃', x: 956, y: 544, width: 56, height: 56, anchor: 'topleft', kind: 'button' },
      { id: 'act-interact', label: '交互', x: 1176, y: 544, width: 56, height: 56, anchor: 'topleft', kind: 'button' },
      { id: 'act-throw', label: '投掷', x: 1244, y: 544, width: 56, height: 56, anchor: 'topleft', kind: 'button' },
      { id: 'act-axe', label: '采集', x: 1312, y: 544, width: 56, height: 56, anchor: 'topleft', kind: 'button' },
      { id: 'hb-hp', label: '红瓶', x: 440, y: 540, width: 56, height: 56, anchor: 'topleft', kind: 'button' },
      { id: 'hb-mp', label: '蓝瓶', x: 510, y: 540, width: 56, height: 56, anchor: 'topleft', kind: 'button' },
      { id: 'hb-bag', label: '背包', x: 650, y: 540, width: 56, height: 56, anchor: 'topleft', kind: 'button' },
      { id: 'hb-settings', label: '系统设置', x: 580, y: 540, width: 56, height: 56, anchor: 'topleft', kind: 'button' },
      { id: 'hb-skill6', label: '回血', x: 720, y: 540, width: 56, height: 56, anchor: 'topleft', kind: 'button' },
      { id: 'hb-skill7', label: '打坐', x: 790, y: 540, width: 56, height: 56, anchor: 'topleft', kind: 'button' }
    ]
  },
  login: {
    canvas: { width: 1280, height: 720 },
    components: [
      { id: 'login-panel', label: '登录布局容器', x: 460, y: 263, width: 460, height: 266, anchor: 'topleft', kind: 'login-panel' },
      { id: 'login-title', label: '标题', x: 280, y: 80, width: 720, height: 56, anchor: 'topleft', kind: 'login-title' },
      { id: 'login-subtitle', label: '副标题', x: 360, y: 155, width: 560, height: 32, anchor: 'topleft', kind: 'login-subtitle' },
      { id: 'login-description', label: '文字描述', x: 400, y: 200, width: 480, height: 34, anchor: 'topleft', kind: 'login-description' },
      { id: 'login-actions', label: '主操作区', x: 570, y: 297, width: 230, height: 162, anchor: 'topleft', kind: 'login-actions' }
    ]
  }
};

const EDITABLE_LAYOUT_PLATFORMS = ['desktop', 'mobile', 'loginDesktop', 'loginMobile'];
const LOGIN_LAYOUT_PLATFORMS = new Set(['loginDesktop', 'loginMobile']);
const BADGE_TEXT_LAYOUT_IDS = new Set(['timeWeatherBadge', 'combatStateBadge']);
const BADGE_TEXT_LAYOUT_FIELDS = ['fontSize', 'textOffsetX', 'textOffsetY'];
const PANEL_LAYOUT_PLATFORMS = new Set(['desktop', 'mobile']);
const MOBILE_TOUCH_BUTTON_IDS = new Set([
  'act-attack', 'act-block', 'act-skill3', 'act-skill4', 'act-skill5',
  'act-flight', 'act-jump', 'act-interact', 'act-throw', 'act-axe',
  'hb-hp', 'hb-mp', 'hb-bag', 'hb-settings', 'hb-skill6', 'hb-skill7'
]);
const EDITABLE_PANEL_PART_IDS = new Set(['bagTitle', 'bagSeparator']);
const PANEL_PART_MIN_SIZE = 16;
const PANEL_LINE_HIT_HEIGHT = 8;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function layoutFileName(platform) {
  if (platform === 'desktop') return 'UILayout.desktop.json';
  if (platform === 'mobile') return 'UILayout.mobile.json';
  return platform === 'loginMobile' ? 'LoginLayout.mobile.json' : 'LoginLayout.desktop.json';
}

export class UIEditor {
  /**
   * @param {HTMLElement} container - 编辑器挂载容器
   * @param {Object} options
   * @param {string} [options.gameId='sanguo_zhangjiao']
   */
  constructor(container, options = {}) {
    this.container = container;
    this.gameId = options.gameId || 'sanguo_zhangjiao';
    // 配置文件相对仓库根目录的路径
    this.configBase = `example/${this.gameId}/config/`;

    this.platform = 'mobile'; // 当前编辑平台
    this.layouts = {
      desktop: this._cloneDefault('desktop'),
      mobile: this._cloneDefault('mobile'),
      loginDesktop: this._cloneDefault('loginDesktop'),
      loginMobile: this._cloneDefault('loginMobile')
    };
    this.selectedId = null;
    this.selectedPanelPart = null;
    this.scale = 1; // 预览缩放

    this._dragState = null;
    this._initialized = false;
    this._loginBackgroundImage = '';
    this._panelLayoutDocument = null;
    this._panelLayouts = {};
    this._onboardingUiDocument = null;

    // 手柄绑定编辑器数据（与 Xbox360Profile.DEFAULT_BINDINGS 同构）
    this._defaultGamepadBindings = null; // 异步加载
    this._gamepadBindings = {};
    this._gamepadDeadzone = 0.22;
    this._gamepadTriggerThreshold = 0.5;
    this._gamepadMeta = null; // { PadButton, PAD_BUTTON_LABELS, BINDABLE_ACTIONS, ... }
  }

  _cloneDefault(platform) {
    const defaultPlatform = LOGIN_LAYOUT_PLATFORMS.has(platform) ? 'login' : platform;
    return JSON.parse(JSON.stringify(DEFAULT_COMPONENTS[defaultPlatform]));
  }

  /** 初始化（首次显示时调用） */
  async init() {
    if (this._initialized) return;
    this._initialized = true;
    this._buildUI();
    await this._loadFromFiles();
    await this._loadLoginBackgroundConfig();
    await this._loadPanelLayout();
    // 面板的内外框比例由面板编辑器维护，这里先把历史数据规范到该比例
    this._normalizePanelAspects();
    await this._loadGamepadConfig();
    await this._loadHintsConfig();
    await this._loadOnboardingUiConfig();
    this._render();
  }

  /** 从项目配置读取登录页背景，保持编辑器预览与游戏运行时一致。 */
  async _loadLoginBackgroundConfig() {
    this._loginBackgroundImage = '';
    try {
      const projectFile = `example/${this.gameId}/game.project.json`;
      const response = await fetch('/api/read-file?path=' + encodeURIComponent(projectFile));
      if (!response.ok) return;
      const data = await response.json();
      if (!data || !data.ok || !data.content) return;
      const project = JSON.parse(data.content);
      const imagePath = project?.system?.login?.backgroundImage;
      if (typeof imagePath !== 'string' || !imagePath.trim()) return;

      const normalizedPath = imagePath.trim().replace(/\\/g, '/').replace(/^(\.\.\/)+/, '');
      this._loginBackgroundImage = normalizedPath.startsWith('assets/')
        ? `../example/${this.gameId}/${normalizedPath}`
        : normalizedPath;
    } catch (e) {
      console.warn('UIEditor: 登录背景配置加载失败', e);
    }
  }

  /**
   * 加载操作提示文案表（内置默认 + config/InputHints.json 覆盖）。
   * 文案表由框架的 InputHints 提供，编辑器只做展示与写回，避免两处维护默认值。
   */
  async _loadHintsConfig() {
    try {
      const mod = await import('../src/core/input/InputHints.js');
      this._inputHints = mod.InputHints;
      this._hintDefaults = this._inputHints.getDefaultActions();
      // 先叠加项目已保存的覆盖，再取全量表
      const file = this.configBase + 'InputHints.json';
      try {
        const res = await fetch('/api/read-file?path=' + encodeURIComponent(file));
        if (res.ok) {
          const data = await res.json();
          if (data && data.ok && data.content) {
            const parsed = JSON.parse(data.content);
            this._inputHints.merge(parsed && parsed.actions ? parsed.actions : parsed);
          }
        }
      } catch (e) {
        // 没有覆盖文件，用默认表
      }
      this._hintActions = this._inputHints.getActions();
    } catch (e) {
      console.warn('UIEditor: InputHints 加载失败，提示文案编辑器不可用', e);
      this._inputHints = null;
      this._hintActions = null;
    }
  }

  /** 保存提示文案覆盖到 config/InputHints.json */
  async _saveHintsConfig() {
    if (!this._hintActions) throw new Error('提示文案配置尚未加载');
    const file = this.configBase + 'InputHints.json';
    const content = JSON.stringify({ actions: this._hintActions }, null, 2);
    const res = await fetch('/api/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: file, content })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return true;
  }

  /**
   * 三套方案下该动作的短语预览。
   * 把编辑中的文案表和手柄绑定灌进 InputHints 再强制方案取值，
   * 保证预览与游戏内实际显示完全同源。
   * @private
   */
  _previewHint(action, scheme) {
    if (!this._inputHints) return '';
    const hints = this._inputHints;
    hints.merge(this._hintActions);
    hints.setInputManager({
      gamepad: { isConnected: () => true, bindings: this._gamepadBindings }
    });
    hints.setScheme(scheme);
    const text = hints.phrase(action);
    hints.setScheme(null);
    return text;
  }

  /**
   * 取组件被锁定的宽高比（来自面板编辑器的面板尺寸）。
   * @param {Object} comp - UI 布局组件
   * @returns {number|null} 宽/高比，无约束时返回 null
   */
  _getLockedAspect(comp) {
    const panel = comp && this._panelLayouts ? this._panelLayouts[comp.id] : null;
    if (!panel || !panel.width || !panel.height) return null;
    return panel.width / panel.height;
  }

  /**
   * 把面板类组件的尺寸规范到面板编辑器定义的比例。
   * 取放大方向（面积不缩小），符合"等比时尽量最大化"。
   */
  _normalizePanelAspects() {
    for (const platform of EDITABLE_LAYOUT_PLATFORMS) {
      const layout = this.layouts[platform];
      if (!layout || !Array.isArray(layout.components)) continue;
      for (const comp of layout.components) {
        const aspect = this._getLockedAspect(comp);
        if (!aspect) continue;
        const byWidth = comp.width;
        const byHeight = Math.round(comp.height * aspect);
        const width = Math.max(byWidth, byHeight);
        comp.width = width;
        comp.height = Math.round(width / aspect);
      }
    }
  }

  /** 加载并保留完整面板布局文档，映射项与 panels[] 共用同一对象引用。 */
  async _loadPanelLayout() {
    this._panelLayoutDocument = null;
    this._panelLayouts = {};
    try {
      const file = this.configBase + 'PanelLayout.json';
      const res = await fetch('/api/read-file?path=' + encodeURIComponent(file));
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.ok && data.content) {
        const parsed = JSON.parse(data.content);
        if (parsed && Array.isArray(parsed.panels)) {
          this._panelLayoutDocument = parsed;
          for (const panel of parsed.panels) {
            this._panelLayouts[panel.id] = panel;
          }
        }
      }
    } catch (e) {
      console.warn('UIEditor: PanelLayout 加载失败，面板子部件编辑不可用', e);
    }
  }

  /** 从 JSON 文件加载已保存布局（覆盖默认值）。旧 LoginLayout.json 仅兼容为 PC 登录布局回退。 */
  async _loadFromFiles() {
    for (const platform of EDITABLE_LAYOUT_PLATFORMS) {
      const fileNames = [layoutFileName(platform)];
      if (platform === 'loginDesktop') fileNames.push('LoginLayout.json');
      for (const fileName of fileNames) {
        const file = this.configBase + fileName;
        try {
          const res = await fetch('/api/read-file?path=' + encodeURIComponent(file));
          if (!res.ok) continue;
          const data = await res.json();
          if (!data?.ok || !data.content) continue;
          const parsed = JSON.parse(data.content);
          // 合并：以文件为准，但保留默认组件中文件缺失的项
          this.layouts[platform] = this._mergeLayout(this._cloneDefault(platform), parsed, {
            preserveExactComponents: platform === 'mobile'
          });
          break;
        } catch (e) {
          console.warn('UIEditor: 加载布局失败', platform, e);
        }
      }
    }
  }

  /** 合并已存布局到默认结构（优先用百分比还原到当前编辑器画布像素） */
  _mergeLayout(base, saved, { preserveExactComponents = false } = {}) {
    if (!saved || !Array.isArray(saved.components)) return base;
    if (saved.canvas) base.canvas = saved.canvas;
    const cw = base.canvas.width;
    const ch = base.canvas.height;
    const savedMap = new Map(saved.components
      .filter(component => component && typeof component.id === 'string' && component.id)
      .map(component => [component.id, component]));
    const restoreComponent = (template, source) => {
      const component = { ...template, ...source };
      if (source.xPct !== undefined) {
        component.x = Math.round(source.xPct * cw);
        component.y = Math.round(source.yPct * ch);
        component.width = Math.round(source.wPct * cw);
        component.height = Math.round(source.hPct * ch);
      } else {
        component.x = source.x;
        component.y = source.y;
        component.width = source.width;
        component.height = source.height;
      }
      for (const field of BADGE_TEXT_LAYOUT_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
        const value = Number(source[field]);
        if (Number.isFinite(value)) component[field] = value;
      }
      return component;
    };

    if (preserveExactComponents) {
      const defaultsById = new Map(base.components.map(component => [component.id, component]));
      base.components = [...savedMap.values()].map(component => restoreComponent(
        defaultsById.get(component.id) || {},
        component
      ));
      return base;
    }

    for (const comp of base.components) {
      const savedComponent = savedMap.get(comp.id);
      if (!savedComponent) continue;
      Object.assign(comp, restoreComponent(comp, savedComponent));
    }
    return base;
  }

  /** 构建编辑器 DOM 结构 */
  _buildUI() {
    this.container.innerHTML = `
      <div class="uie-root">
        <div class="uie-toolbar">
          <div class="uie-platform-switch">
            <button data-platform="mobile" class="active">📱 Android UI</button>
            <button data-platform="desktop">🖥️ PC UI</button>
            <button data-platform="loginDesktop">🖥️ PC UI 登录页面</button>
            <button data-platform="loginMobile">📱 Android UI 登录页面</button>
            <button data-platform="gamepad">🎮 手柄</button>
            <button data-platform="hints">💬 提示文案</button>
            <button data-platform="onboarding">🪜 引导显示</button>
          </div>
          <div class="uie-actions">
            <div class="uie-mobile-button-actions" id="uie-mobile-button-actions" hidden>
              <select id="uie-mobile-button-template" aria-label="选择要添加的 Android 按钮"></select>
              <button id="uie-mobile-button-add" type="button">＋ 添加按钮</button>
              <button id="uie-mobile-button-delete" type="button">🗑 删除选中</button>
            </div>
            <button id="uie-reset">恢复默认</button>
            <button id="uie-save" class="primary">💾 保存到文件</button>
          </div>
        </div>
        <div class="uie-main">
          <div class="uie-stage-wrap">
            <div class="uie-stage" id="uie-stage"></div>
          </div>
          <div class="uie-props" id="uie-props">
            <h4>属性</h4>
            <div class="uie-prop-empty">选择一个组件</div>
          </div>
        </div>
        <div class="uie-status" id="uie-status"></div>
        <div class="uie-save-feedback" id="uie-save-feedback" role="status" aria-live="polite"></div>
      </div>
    `;
    this._injectStyles();

    // 平台切换
    this.container.querySelectorAll('.uie-platform-switch button').forEach(btn => {
      btn.addEventListener('click', () => {
        this.platform = btn.dataset.platform;
        this.container.querySelectorAll('.uie-platform-switch button')
          .forEach(b => b.classList.toggle('active', b === btn));
        this.selectedId = null;
        this.selectedPanelPart = null;
        this._render();
      });
    });

    this.container.querySelector('#uie-mobile-button-add').addEventListener('click', () => this._addMobileTouchButton());
    this.container.querySelector('#uie-mobile-button-delete').addEventListener('click', () => this._deleteSelectedMobileTouchButton());

    this.container.querySelector('#uie-save').addEventListener('click', async () => {
      try {
        await this.save();
      } catch (error) {
        const message = `保存失败：${error?.message || String(error)}`;
        this._setStatus(message, true);
        this._showSaveFeedback(message, true);
      }
    });
    this.container.querySelector('#uie-reset').addEventListener('click', () => {
      if (this.platform === 'onboarding') {
        if (this._onboardingUiDocument && confirm('恢复 S01 引导显示规则为当前文件重载前状态？(未保存)')) {
          void this._loadOnboardingUiConfig().then(() => this._render());
        }
        return;
      }
      if (this.platform === 'hints') {
        if (this._hintDefaults && confirm('恢复提示文案为默认？(未保存)')) {
          this._hintActions = JSON.parse(JSON.stringify(this._hintDefaults));
          this._render();
        }
        return;
      }
      if (this.platform === 'gamepad') {
        if (confirm('恢复手柄绑定为默认？(未保存)')) {
          this._gamepadBindings = { ...this._defaultGamepadBindings };
          this._gamepadDeadzone = 0.22;
          this._gamepadTriggerThreshold = 0.5;
          this._render();
        }
        return;
      }
      if (confirm('恢复当前平台为默认布局？(未保存)')) {
        this.layouts[this.platform] = this._cloneDefault(this.platform);
        this.selectedId = null;
        this.selectedPanelPart = null;
        this._render();
      }
    });
  }

  _mobileButtonTemplates() {
    return DEFAULT_COMPONENTS.mobile.components
      .filter(component => component.kind === 'button' && MOBILE_TOUCH_BUTTON_IDS.has(component.id));
  }

  _updateMobileButtonControls() {
    const controls = this.container.querySelector('#uie-mobile-button-actions');
    const selector = this.container.querySelector('#uie-mobile-button-template');
    const deleteButton = this.container.querySelector('#uie-mobile-button-delete');
    if (!controls || !selector || !deleteButton) return;

    const isMobile = this.platform === 'mobile';
    controls.hidden = !isMobile;
    if (!isMobile) return;

    const layout = this.layouts.mobile;
    const existingIds = new Set(layout?.components?.map(component => component.id) || []);
    const missing = this._mobileButtonTemplates().filter(component => !existingIds.has(component.id));
    selector.innerHTML = missing.length
      ? missing.map(component => `<option value="${escapeHtml(component.id)}">${escapeHtml(component.label)}（${escapeHtml(component.id)}）</option>`).join('')
      : '<option value="">没有可添加的 Android 按钮</option>';
    const addButton = this.container.querySelector('#uie-mobile-button-add');
    if (addButton) addButton.disabled = missing.length === 0;
    const selected = layout?.components?.find(component => component.id === this.selectedId);
    deleteButton.disabled = !selected || selected.kind !== 'button' || !MOBILE_TOUCH_BUTTON_IDS.has(selected.id);
  }

  _addMobileTouchButton() {
    if (this.platform !== 'mobile') return;
    const selector = this.container.querySelector('#uie-mobile-button-template');
    const componentId = String(selector?.value || '');
    const template = this._mobileButtonTemplates().find(component => component.id === componentId);
    if (!template) {
      this._setStatus('没有可添加的 Android 按钮', true);
      return;
    }
    const layout = this.layouts.mobile;
    if (layout.components.some(component => component.id === componentId)) {
      this._setStatus(`Android 按钮已存在：${componentId}`, true);
      return;
    }
    layout.components.push(structuredClone(template));
    this.selectedId = componentId;
    this.selectedPanelPart = null;
    this._setStatus(`已添加 Android 按钮：${template.label}（未保存）`);
    this._render();
  }

  _deleteSelectedMobileTouchButton() {
    if (this.platform !== 'mobile') return;
    const layout = this.layouts.mobile;
    const index = layout.components.findIndex(component => component.id === this.selectedId);
    const component = index >= 0 ? layout.components[index] : null;
    if (!component || component.kind !== 'button' || !MOBILE_TOUCH_BUTTON_IDS.has(component.id)) {
      this._setStatus('请选择要删除的 Android 触屏按钮', true);
      return;
    }
    if (!confirm(`删除 Android 按钮“${component.label}”？保存后运行时将不再显示它。`)) return;
    layout.components.splice(index, 1);
    this.selectedId = null;
    this._setStatus(`已删除 Android 按钮：${component.label}（未保存）`);
    this._render();
  }

  _injectStyles() {
    if (document.getElementById('uie-styles')) return;
    const style = document.createElement('style');
    style.id = 'uie-styles';
    style.textContent = `
      .uie-root { position:relative; display:flex; flex-direction:column; height:100%; background:#0d1326; color:#fff; }
      .uie-toolbar { display:flex; justify-content:space-between; align-items:center; padding:10px 16px; background:#16213e; border-bottom:1px solid #2a3a5e; }
      .uie-platform-switch button { padding:8px 14px; margin-right:8px; background:#3a4a7e; border:none; border-radius:4px; color:#fff; cursor:pointer; }
      .uie-platform-switch button.active { background:#4CAF50; color:#000; }
      .uie-actions { display:flex; align-items:center; gap:8px; }
      .uie-actions button { padding:8px 14px; margin-left:0; background:#3a4a7e; border:none; border-radius:4px; color:#fff; cursor:pointer; }
      .uie-actions button:disabled { opacity:0.45; cursor:not-allowed; }
      .uie-actions button.primary { background:#4CAF50; color:#000; font-weight:bold; }
      .uie-mobile-button-actions { display:flex; align-items:center; gap:6px; padding-right:8px; border-right:1px solid #41547e; }
      .uie-mobile-button-actions select { max-width:180px; background:#0a1020; border:1px solid #2a3a5e; border-radius:4px; color:#fff; padding:7px; }
      .uie-main { flex:1; display:flex; overflow:hidden; }
      .uie-stage-wrap { flex:1; display:flex; align-items:center; justify-content:center; overflow:auto; padding:20px; background:#070b18; }
      .uie-stage { position:relative; background:#1a2238; border:2px solid #4CAF50; box-shadow:0 0 30px rgba(0,0,0,0.6); }
      .uie-stage.login-stage { background-color:#211613; background-image:none; background-position:center; background-size:cover; background-repeat:no-repeat; }
      .uie-stage.no-bg { background-image:none !important; }
      .uie-comp { position:absolute; box-sizing:border-box; border:1.5px solid rgba(120,180,255,0.8); background:rgba(80,140,255,0.18); color:#cfe3ff; font-size:11px; display:flex; align-items:center; justify-content:center; cursor:move; user-select:none; overflow:hidden; }
      .uie-comp.zone { border-style:dashed; background:rgba(255,200,80,0.12); border-color:rgba(255,200,80,0.7); color:#ffe7a8; }
      .uie-comp.button { border-radius:50%; }
      .uie-comp.login-panel { border:1.5px dashed rgba(231,199,120,0.7); border-radius:12px; background:transparent; color:#f0d997; box-shadow:none; }
      .uie-comp.login-title { border-color:rgba(231,199,120,0.8); background:rgba(25,15,8,0.25); color:#f0d997; font-size:13px; font-weight:bold; }
      .uie-comp.login-subtitle, .uie-comp.login-description { border-color:rgba(255,255,255,0.5); background:rgba(0,0,0,0.2); color:#eee; }
      .uie-comp.login-actions { display:grid; grid-template-rows:repeat(3, 1fr); gap:10px; padding:0; border:0; background:transparent; overflow:visible; }
      .uie-login-preview-action { display:flex; align-items:center; justify-content:center; border:1px solid rgba(255,255,255,0.18); border-radius:6px; background:#4b6728; color:#fff; font-size:12px; pointer-events:none; }
      .uie-comp.selected { border-color:#ff5; background:rgba(255,255,100,0.25); z-index:10; }
      .uie-comp .uie-handle { position:absolute; z-index:12; right:-5px; bottom:-5px; width:12px; height:12px; background:#ff5; border:1px solid #000; cursor:nwse-resize; }
      .uie-panel-part-frame { position:absolute; z-index:6; box-sizing:border-box; border:1px dashed rgba(255,220,80,0.95); background:rgba(255,220,80,0.08); cursor:move; pointer-events:auto; overflow:visible; }
      .uie-panel-part-frame.line { background:rgba(255,145,70,0.1); border-color:rgba(255,160,80,0.98); }
      .uie-panel-part-frame.selected { z-index:11; border-color:#7dffad; background:rgba(80,255,145,0.16); box-shadow:0 0 0 1px rgba(0,0,0,0.65), 0 0 8px rgba(80,255,145,0.7); }
      .uie-panel-part-handle { position:absolute; right:-5px; bottom:-5px; width:10px; height:10px; box-sizing:border-box; border:1px solid #06150c; background:#7dffad; cursor:nwse-resize; opacity:0; pointer-events:none; }
      .uie-panel-part-frame.selected .uie-panel-part-handle { opacity:1; pointer-events:auto; }
      .uie-panel-part-meta { margin:0 0 12px; padding:8px; border:1px solid #2a3a5e; border-radius:4px; background:#0a1020; color:#8fa7bf; font-size:11px; line-height:1.6; }
      .uie-prop-row select { flex:1; background:#0a1020; border:1px solid #2a3a5e; color:#fff; padding:5px; border-radius:3px; min-width:0; }
      .uie-prop-row input[type="text"] { min-width:0; }
      .uie-props { width:240px; background:#111a30; border-left:1px solid #2a3a5e; padding:14px; overflow-y:auto; }
      .uie-props h4 { color:#4CAF50; margin-bottom:10px; }
      .uie-prop-empty { color:#778; font-size:13px; }
      .uie-prop-row { display:flex; align-items:center; margin-bottom:8px; }
      .uie-prop-row label { width:50px; font-size:12px; color:#9ab; }
      .uie-prop-row input { flex:1; background:#0a1020; border:1px solid #2a3a5e; color:#fff; padding:5px; border-radius:3px; width:60px; }
      .uie-prop-name { font-weight:bold; color:#fff; margin-bottom:12px; font-size:14px; }
      .uie-status { padding:6px 16px; font-size:12px; color:#8aa; background:#0a1020; min-height:24px; }
      .uie-save-feedback { position:absolute; z-index:100; top:64px; left:50%; max-width:min(640px, calc(100% - 48px)); padding:12px 20px; border:1px solid #63d471; border-radius:6px; background:rgba(18,72,38,0.96); color:#eaffee; font-size:14px; font-weight:bold; text-align:center; box-shadow:0 8px 28px rgba(0,0,0,0.45); opacity:0; pointer-events:none; transform:translate(-50%, -12px); transition:opacity 160ms ease, transform 160ms ease; }
      .uie-save-feedback.visible { opacity:1; transform:translate(-50%, 0); }
      .uie-save-feedback.error { border-color:#ff7777; background:rgba(105,28,35,0.97); color:#fff1f1; }
    `;
    document.head.appendChild(style);
  }

  /**
   * 复刻 BackpackPanel 的内容缩放与居中规则。
   * UILayout 只定义外框，PanelLayout 始终保留自己的设计坐标。
   */
  _getPanelContentTransform(comp, panelDef) {
    const panelWidth = Number(panelDef?.width);
    const panelHeight = Number(panelDef?.height);
    const componentWidth = Number(comp?.width);
    const componentHeight = Number(comp?.height);
    if (!(panelWidth > 0) || !(panelHeight > 0) || !(componentWidth > 0) || !(componentHeight > 0)) {
      return {
        contentScale: 1,
        frameWidth: Math.max(0, componentWidth || 0),
        frameHeight: Math.max(0, componentHeight || 0),
        offsetX: 0,
        offsetY: 0
      };
    }

    const contentScale = Math.min(componentWidth / panelWidth, componentHeight / panelHeight);
    const frameWidth = Math.round(panelWidth * contentScale);
    const frameHeight = Math.round(panelHeight * contentScale);
    return {
      contentScale,
      frameWidth,
      frameHeight,
      offsetX: Math.round((componentWidth - frameWidth) / 2),
      offsetY: Math.round((componentHeight - frameHeight) / 2)
    };
  }

  _getSelectedPanelPart() {
    const selection = this.selectedPanelPart;
    if (!selection) return null;
    const panelDef = this._panelLayouts?.[selection.panelId];
    const part = panelDef?.parts?.find(candidate => candidate.id === selection.partId);
    return panelDef && part ? { panelDef, part } : null;
  }

  /** 把共用 PanelLayout 子部件投影成当前平台可交互的虚线框。 */
  _appendEditablePanelParts(element, comp, panelDef) {
    if (!PANEL_LAYOUT_PLATFORMS.has(this.platform) || !Array.isArray(panelDef?.parts)) return;
    const transform = this._getPanelContentTransform(comp, panelDef);

    for (const part of panelDef.parts) {
      if (part.section !== 'inventory' || !EDITABLE_PANEL_PART_IDS.has(part.id)) continue;
      const actualLeft = (transform.offsetX + part.x * transform.contentScale) * this.scale;
      const actualTop = (transform.offsetY + part.y * transform.contentScale) * this.scale;
      const actualWidth = Math.max(1, part.width * transform.contentScale * this.scale);
      const actualHeight = Math.max(1, part.height * transform.contentScale * this.scale);
      const frameHeight = part.type === 'line'
        ? Math.max(PANEL_LINE_HIT_HEIGHT, actualHeight)
        : actualHeight;

      const frame = document.createElement('div');
      frame.className = `uie-panel-part-frame ${part.type || ''}`;
      if (this.selectedPanelPart?.panelId === comp.id && this.selectedPanelPart?.partId === part.id) {
        frame.classList.add('selected');
      }
      frame.style.left = `${actualLeft}px`;
      frame.style.top = `${actualTop - (frameHeight - actualHeight) / 2}px`;
      frame.style.width = `${actualWidth}px`;
      frame.style.height = `${frameHeight}px`;
      frame.dataset.panelId = comp.id;
      frame.dataset.partId = part.id;
      frame.title = `${part.label || part.id}（${part.id}，PC/Android 共用）`;
      frame.addEventListener('mousedown', event => {
        this._startPanelPartDrag(event, comp, panelDef, part, 'move');
      });

      const handle = document.createElement('div');
      handle.className = 'uie-panel-part-handle';
      handle.title = '缩放 PanelLayout 子部件';
      handle.addEventListener('mousedown', event => {
        this._startPanelPartDrag(event, comp, panelDef, part, 'resize');
      });
      frame.appendChild(handle);
      element.appendChild(frame);
    }
  }

  /** 渲染当前平台的舞台和组件 */
  _render() {
    this._updateMobileButtonControls();
    if (this.platform === 'hints') {
      this._renderHintsEditor();
      return;
    }
    if (this.platform === 'gamepad') {
      this._renderGamepadEditor();
      return;
    }
    if (this.platform === 'onboarding') {
      this._renderOnboardingEditor();
      return;
    }
    const layout = this.layouts[this.platform];
    const stage = this.container.querySelector('#uie-stage');
    if (!stage) return;
    const isLoginPreview = LOGIN_LAYOUT_PLATFORMS.has(this.platform);
    stage.classList.toggle('login-stage', isLoginPreview);
    stage.classList.toggle('no-bg', this.platform === 'gamepad' || this.platform === 'hints');
    const safeLoginBackground = isLoginPreview
      ? this._loginBackgroundImage.replace(/["'()]/g, '')
      : '';
    stage.style.backgroundImage = safeLoginBackground ? `url("${safeLoginBackground}")` : '';

    // 计算预览缩放（适配舞台容器宽度）
    const wrap = this.container.querySelector('.uie-stage-wrap');
    // 布局画布需要居中展示
    if (wrap) wrap.style.alignItems = 'center';
    const maxW = (wrap.clientWidth || 800) - 40;
    const maxH = (wrap.clientHeight || 500) - 40;
    const cw = layout.canvas.width;
    const ch = layout.canvas.height;
    this.scale = Math.min(maxW / cw, maxH / ch, 1);

    stage.style.width = (cw * this.scale) + 'px';
    stage.style.height = (ch * this.scale) + 'px';
    stage.innerHTML = '';

    for (const comp of layout.components) {
      const el = document.createElement('div');
      el.className = 'uie-comp ' + (comp.kind || '');
      if (comp.id === this.selectedId) el.classList.add('selected');
      el.style.left = (comp.x * this.scale) + 'px';
      el.style.top = (comp.y * this.scale) + 'px';
      el.style.width = (comp.width * this.scale) + 'px';
      el.style.height = (comp.height * this.scale) + 'px';
      el.dataset.id = comp.id;

      // 面板类型：用 canvas 绘制真实预览
      const panelDef = this._panelLayouts && this._panelLayouts[comp.id];
      if (comp.kind === 'panel' && panelDef) {
        el.textContent = '';
        el.style.background = 'none';
        el.style.border = comp.id === this.selectedId ? '2px solid #ff5' : '1px solid rgba(76,175,80,0.4)';
        el.style.overflow = 'hidden';
        const cvs = document.createElement('canvas');
        const canvasWidth = Math.round(comp.width * this.scale);
        const canvasHeight = Math.round(comp.height * this.scale);
        cvs.width = canvasWidth;
        cvs.height = canvasHeight;
        cvs.style.width = '100%';
        cvs.style.height = '100%';
        cvs.style.pointerEvents = 'none';
        this._drawPanelPreview(cvs, panelDef, comp);
        el.appendChild(cvs);
        this._appendEditablePanelParts(el, comp, panelDef);
      } else if (LOGIN_LAYOUT_PLATFORMS.has(this.platform) && comp.kind === 'login-actions') {
        el.textContent = '';
        for (const label of ['开始游戏', '读取存档', '退出游戏']) {
          const action = document.createElement('span');
          action.className = 'uie-login-preview-action';
          action.textContent = label;
          el.appendChild(action);
        }
      } else {
        el.textContent = comp.label;
      }

      // 拖拽
      el.addEventListener('mousedown', (e) => this._startDrag(e, comp, 'move'));

      // 缩放手柄
      const handle = document.createElement('div');
      handle.className = 'uie-handle';
      handle.addEventListener('mousedown', (e) => { e.stopPropagation(); this._startDrag(e, comp, 'resize'); });
      el.appendChild(handle);

      stage.appendChild(el);
    }

    this._renderProps();
  }

  _startDrag(e, comp, mode) {
    e.preventDefault();
    this.selectedId = comp.id;
    this.selectedPanelPart = null;
    this._dragState = {
      target: 'component',
      mode,
      comp,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: comp.x,
      startY: comp.y,
      startW: comp.width,
      startH: comp.height
    };
    const onMove = event => this._onDragMove(event);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      this._dragState = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    this._render();
  }

  _startPanelPartDrag(e, comp, panelDef, part, mode) {
    e.preventDefault();
    e.stopPropagation();
    const transform = this._getPanelContentTransform(comp, panelDef);
    this.selectedId = null;
    this.selectedPanelPart = { panelId: comp.id, partId: part.id };
    this._dragState = {
      target: 'panelPart',
      mode,
      comp,
      panelDef,
      part,
      editorScale: this.scale,
      contentScale: transform.contentScale,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: part.x,
      startY: part.y,
      startW: part.width,
      startH: part.height
    };
    const onMove = event => this._onDragMove(event);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      this._dragState = null;
      this._setStatus(`PanelLayout.${part.id} 已修改，PC/Android 将共用此内部坐标（未保存）`);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    this._render();
  }

  _onDragMove(e) {
    if (!this._dragState) return;
    const ds = this._dragState;

    if (ds.target === 'panelPart') {
      const interactionScale = Math.max(0.0001, ds.editorScale * ds.contentScale);
      const dx = (e.clientX - ds.startMouseX) / interactionScale;
      const dy = (e.clientY - ds.startMouseY) / interactionScale;
      const panelWidth = Number(ds.panelDef.width) || 0;
      const panelHeight = Number(ds.panelDef.height) || 0;

      if (ds.mode === 'move') {
        const maxX = Math.max(0, panelWidth - ds.startW);
        const maxY = Math.max(0, panelHeight - ds.startH);
        ds.part.x = Math.min(maxX, Math.max(0, Math.round(ds.startX + dx)));
        ds.part.y = Math.min(maxY, Math.max(0, Math.round(ds.startY + dy)));
      } else {
        const availableWidth = Math.max(1, panelWidth - ds.startX);
        const availableHeight = Math.max(1, panelHeight - ds.startY);
        const requestedMinWidth = ds.part.type === 'line' ? 1 : PANEL_PART_MIN_SIZE;
        const requestedMinHeight = ds.part.type === 'line' ? 1 : PANEL_PART_MIN_SIZE;
        const minWidth = Math.min(requestedMinWidth, availableWidth);
        const minHeight = Math.min(requestedMinHeight, availableHeight);
        ds.part.width = Math.min(
          availableWidth,
          Math.max(minWidth, Math.round(ds.startW + dx))
        );
        ds.part.height = Math.min(
          availableHeight,
          Math.max(minHeight, Math.round(ds.startH + dy))
        );
      }
      this._render();
      return;
    }

    const dx = (e.clientX - ds.startMouseX) / this.scale;
    const dy = (e.clientY - ds.startMouseY) / this.scale;
    if (ds.mode === 'move') {
      ds.comp.x = Math.round(ds.startX + dx);
      ds.comp.y = Math.round(ds.startY + dy);
    } else {
      const aspect = this._getLockedAspect(ds.comp);
      if (aspect) {
        // 面板只允许等比缩放：取水平/垂直中更大的推进量，既跟手又保持比例
        const scale = Math.max((ds.startW + dx) / ds.startW, (ds.startH + dy) / ds.startH);
        const width = Math.max(16, Math.round(ds.startW * scale));
        ds.comp.width = width;
        ds.comp.height = Math.max(16, Math.round(width / aspect));
      } else {
        ds.comp.width = Math.max(16, Math.round(ds.startW + dx));
        ds.comp.height = Math.max(16, Math.round(ds.startH + dy));
      }
    }
    this._render();
  }

  _updatePanelPartNumber(panelDef, part, key, rawValue) {
    if (!Number.isFinite(rawValue)) return;
    const value = Math.round(rawValue);
    const panelWidth = Number(panelDef.width) || 0;
    const panelHeight = Number(panelDef.height) || 0;
    const minSize = part.type === 'line' ? 1 : PANEL_PART_MIN_SIZE;

    if (key === 'x') {
      part.x = Math.min(Math.max(0, panelWidth - part.width), Math.max(0, value));
    } else if (key === 'y') {
      part.y = Math.min(Math.max(0, panelHeight - part.height), Math.max(0, value));
    } else if (key === 'width') {
      const available = Math.max(1, panelWidth - part.x);
      part.width = Math.min(available, Math.max(Math.min(minSize, available), value));
    } else if (key === 'height') {
      const available = Math.max(1, panelHeight - part.y);
      part.height = Math.min(available, Math.max(Math.min(minSize, available), value));
    } else if (key === 'fontSize') {
      part.fontSize = Math.max(1, value);
    }
  }

  _renderPanelPartProps(props, panelDef, part) {
    const numberFields = [
      { key: 'x', label: 'x' },
      { key: 'y', label: 'y' },
      { key: 'width', label: 'width' },
      { key: 'height', label: 'height' }
    ];
    if (part.type === 'text') numberFields.push({ key: 'fontSize', label: '字号' });
    const alignOptions = ['left', 'center', 'right']
      .map(value => `<option value="${value}"${part.align === value ? ' selected' : ''}>${value}</option>`)
      .join('');

    props.innerHTML = `
      <h4>PanelLayout 属性</h4>
      <div class="uie-prop-name">${escapeHtml(part.label || part.id)} <span style="color:#778;font-size:11px">(${escapeHtml(part.id)})</span></div>
      <div class="uie-panel-part-meta">
        面板：${escapeHtml(panelDef.id)}<br>
        section：${escapeHtml(part.section)}<br>
        type：${escapeHtml(part.type)}
      </div>
      <div class="uie-prop-row">
        <label>名称</label>
        <input type="text" data-part-text="label" value="${escapeHtml(part.label || '')}">
      </div>
      ${numberFields.map(({ key, label }) => `
        <div class="uie-prop-row">
          <label>${label}</label>
          <input type="number" data-part-number="${key}" value="${Number.isFinite(part[key]) ? part[key] : 0}" min="${key === 'fontSize' || key === 'width' || key === 'height' ? 1 : 0}">
        </div>
      `).join('')}
      ${part.type === 'text' ? `
        <div class="uie-prop-row">
          <label>文本</label>
          <input type="text" data-part-text="text" value="${escapeHtml(part.text || '')}">
        </div>
        <div class="uie-prop-row">
          <label>字重</label>
          <input type="text" data-part-text="fontWeight" value="${escapeHtml(part.fontWeight || 'normal')}">
        </div>
        <div class="uie-prop-row">
          <label>颜色</label>
          <input type="text" data-part-text="color" value="${escapeHtml(part.color || '#ffffff')}">
        </div>
        <div class="uie-prop-row">
          <label>对齐</label>
          <select data-part-select="align">${alignOptions}</select>
        </div>
      ` : `
        <div class="uie-prop-row">
          <label>颜色</label>
          <input type="text" data-part-text="color" value="${escapeHtml(part.color || '#4a9eff')}">
        </div>
      `}
      <div class="uie-prop-empty" style="margin-top:10px;line-height:1.6">
        此部件使用 PanelLayout 的 ${panelDef.width}×${panelDef.height} 内部坐标；PC 与 Android 只投影不同外框，保存后两端共用本次修改。分隔线虚线框会扩大命中高度，但不会改写真实 height。
      </div>
    `;

    props.querySelectorAll('input[data-part-number]').forEach(input => {
      input.addEventListener('change', () => {
        this._updatePanelPartNumber(panelDef, part, input.dataset.partNumber, Number(input.value));
        this._setStatus(`PanelLayout.${part.id} 属性已修改（未保存）`);
        this._render();
      });
    });
    props.querySelectorAll('input[data-part-text]').forEach(input => {
      input.addEventListener('change', () => {
        part[input.dataset.partText] = input.value;
        this._setStatus(`PanelLayout.${part.id} 属性已修改（未保存）`);
        this._render();
      });
    });
    props.querySelectorAll('select[data-part-select]').forEach(select => {
      select.addEventListener('change', () => {
        part[select.dataset.partSelect] = select.value;
        this._setStatus(`PanelLayout.${part.id} 属性已修改（未保存）`);
        this._render();
      });
    });
  }

  _renderProps() {
    const props = this.container.querySelector('#uie-props');
    const layout = this.layouts[this.platform];
    const selectedPanelPart = this._getSelectedPanelPart();
    if (selectedPanelPart && PANEL_LAYOUT_PLATFORMS.has(this.platform)) {
      this._renderPanelPartProps(props, selectedPanelPart.panelDef, selectedPanelPart.part);
      return;
    }

    const comp = layout.components.find(c => c.id === this.selectedId);
    if (!comp) {
      props.innerHTML = '<h4>属性</h4><div class="uie-prop-empty">选择一个组件或背包内部虚线框</div>';
      return;
    }
    const propertyDefinitions = [
      { key: 'x', label: 'x' },
      { key: 'y', label: 'y' },
      { key: 'width', label: 'width' },
      { key: 'height', label: 'height' }
    ];
    if (BADGE_TEXT_LAYOUT_IDS.has(comp.id)) {
      propertyDefinitions.push(
        { key: 'fontSize', label: '字号', min: 0, title: '0 表示按徽章尺寸自动计算' },
        { key: 'textOffsetX', label: '文字 X', title: '文字相对徽章默认位置的水平偏移' },
        { key: 'textOffsetY', label: '文字 Y', title: '文字相对徽章默认位置的垂直偏移' }
      );
    }
    props.innerHTML = `
      <h4>属性</h4>
      <div class="uie-prop-name">${comp.label} <span style="color:#778;font-size:11px">(${comp.id})</span></div>
      ${propertyDefinitions.map(({ key, label, min, title }) => `
        <div class="uie-prop-row"${title ? ` title="${title}"` : ''}>
          <label>${label}</label>
          <input type="number" data-k="${key}" value="${Number.isFinite(comp[key]) ? comp[key] : 0}"${min !== undefined ? ` min="${min}"` : ''}>
        </div>
      `).join('')}
      ${BADGE_TEXT_LAYOUT_IDS.has(comp.id)
        ? '<div class="uie-prop-empty" style="margin-top:6px">字号设为 0 时沿用运行时自动字号；文字 X/Y 只移动框内文字，不改变徽章位置。</div>'
        : ''}
      ${this._getLockedAspect(comp)
        ? '<div class="uie-prop-empty" style="margin-top:6px">比例由面板编辑器维护，仅支持等比缩放（改宽或高会自动联动）。</div>'
        : ''}
      <div class="uie-prop-empty" style="margin-top:10px">画布: ${layout.canvas.width}×${layout.canvas.height}</div>
    `;
    props.querySelectorAll('input[data-k]').forEach(input => {
      input.addEventListener('input', () => {
        const k = input.dataset.k;
        const v = Number(input.value);
        if (!Number.isFinite(v)) return;
        const aspect = this._getLockedAspect(comp);
        if (aspect && k === 'width') {
          comp.width = v;
          comp.height = Math.max(16, Math.round(v / aspect));
        } else if (aspect && k === 'height') {
          comp.height = v;
          comp.width = Math.max(16, Math.round(v * aspect));
        } else {
          comp[k] = k === 'fontSize' ? Math.max(0, v) : v;
        }
        this._render();
      });
    });
  }

  _setStatus(msg, isError = false) {
    const el = this.container.querySelector('#uie-status');
    if (el) {
      el.textContent = msg;
      el.style.color = isError ? '#ff8888' : '#9edb9e';
    }
  }

  /** 显示醒目但不阻塞编辑流程的保存结果。 */
  _showSaveFeedback(msg, isError = false) {
    const el = this.container.querySelector('#uie-save-feedback');
    if (!el) return;
    clearTimeout(this._saveFeedbackTimer);
    el.textContent = `${isError ? '❌' : '✅'} ${msg}`;
    el.classList.toggle('error', isError);
    el.classList.add('visible');
    this._saveFeedbackTimer = setTimeout(() => {
      el.classList.remove('visible');
    }, isError ? 5000 : 2800);
  }

  /** 读取独立的渐进 UI 规则；布局文件只描述位置，本文件只描述何时显示。 */
  async _loadOnboardingUiConfig() {
    const file = this.configBase + 'OnboardingUI.json';
    const res = await fetch('/api/read-file?path=' + encodeURIComponent(file));
    if (!res.ok) throw new Error(`无法读取 ${file}: HTTP ${res.status}`);
    const data = await res.json();
    if (data?.ok !== true || !data.content) throw new Error(data?.error || `${file} 没有可编辑内容`);
    const document = JSON.parse(data.content);
    if (!Array.isArray(document?.controlledComponentIds) || !Array.isArray(document?.rules)) {
      throw new TypeError('OnboardingUI.json 必须包含 controlledComponentIds 和 rules 数组');
    }
    this._onboardingUiDocument = document;
    return document;
  }

  async _saveOnboardingUiConfig() {
    if (!this._onboardingUiDocument) throw new Error('OnboardingUI 配置尚未加载');
    const file = this.configBase + 'OnboardingUI.json';
    const content = JSON.stringify(this._onboardingUiDocument, null, 2);
    const res = await fetch('/api/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: file, content })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok !== true) throw new Error(data?.error || `HTTP ${res.status}`);
    return true;
  }

  _getOnboardingComponentOptions() {
    const components = [
      ...DEFAULT_COMPONENTS.desktop.components,
      ...DEFAULT_COMPONENTS.mobile.components
    ];
    const labels = new Map(components.map(component => [component.id, component.label]));
    for (const componentId of this._onboardingUiDocument?.controlledComponentIds || []) {
      if (!labels.has(componentId)) labels.set(componentId, '配置中的稳定组件');
    }
    return [...labels.entries()].map(([id, label]) => ({ id, label }));
  }

  /** 渲染独立 OnboardingUI 规则表，不把教程条件复制进 PC/Android 布局。 */
  _renderOnboardingEditor() {
    const stage = this.container.querySelector('#uie-stage');
    const props = this.container.querySelector('#uie-props');
    if (!stage || !props) return;
    const wrap = this.container.querySelector('.uie-stage-wrap');
    if (wrap) wrap.style.alignItems = 'flex-start';
    stage.style.width = '1120px';
    stage.style.height = 'auto';
    stage.style.minHeight = '400px';
    stage.style.overflow = 'auto';
    stage.style.padding = '16px 20px 24px';
    stage.style.display = 'block';
    stage.classList.remove('login-stage', 'no-bg');
    stage.style.backgroundImage = '';

    const document = this._onboardingUiDocument;
    if (!document) {
      stage.innerHTML = '<div style="padding:40px;color:#ff8888;text-align:center;">OnboardingUI.json 加载失败，无法编辑引导显示规则</div>';
      props.innerHTML = '';
      return;
    }

    const options = this._getOnboardingComponentOptions();
    const componentSelect = (field, selectedIds = []) => `
      <select data-onboarding-components="${field}" multiple size="5" style="width:100%;min-width:190px;background:#0a1020;color:#fff;border:1px solid #2a3a5e;padding:4px;border-radius:3px;">
        ${options.map(option => `<option value="${escapeHtml(option.id)}"${selectedIds.includes(option.id) ? ' selected' : ''}>${escapeHtml(option.label)} (${escapeHtml(option.id)})</option>`).join('')}
      </select>`;
    const inputStyle = 'width:100%;min-width:120px;background:#0a1020;color:#fff;border:1px solid #2a3a5e;padding:6px 8px;border-radius:3px;font-size:12px;';
    const componentIds = document.controlledComponentIds || [];
    let html = `
      <h3 style="color:#8fc7ff;margin:0 0 10px">S01 渐进 UI 显示与按钮提示</h3>
      <p style="color:#9ab;font-size:12px;line-height:1.7;margin:0 0 14px;">
        规则由已提交的教程/剧情事实只读投影到 Canvas、Android DOM 与微信 Canvas。布局仍在 PC/Android 标签维护；本页不创建第二份任务进度。
      </p>
      <p style="color:#778;font-size:11px;margin:0 0 14px;">受控稳定组件：${componentIds.map(id => `<code style="color:#8fc">${escapeHtml(id)}</code>`).join('、')}</p>
      <div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;line-height:1.45;">
        <thead><tr style="border-bottom:1px solid #2a3a5e;color:#4CAF50;vertical-align:bottom;">
          <th style="text-align:left;padding:8px;width:135px;">规则 ID / 场景</th>
          <th style="text-align:left;padding:8px;width:145px;">触发条件</th>
          <th style="text-align:left;padding:8px;min-width:190px;">显示组件</th>
          <th style="text-align:left;padding:8px;min-width:190px;">可用组件</th>
          <th style="text-align:left;padding:8px;min-width:190px;">高亮组件 / 提示动作</th>
          <th style="padding:8px;"></th>
        </tr></thead><tbody>`;
    document.rules.forEach((rule, index) => {
      const when = rule.when || { type: 'always' };
      const conditionValue = when.type === 'storyPath' ? (when.path || '') : (when.tutorialId || '');
      const conditionPlaceholder = when.type === 'storyPath'
        ? 'Story 路径，例如 s01Survival.xxx'
        : (when.type === 'always' ? '可留空（始终显示）' : '教程 ID，例如 s01.attack');
      const highlights = rule.highlightComponentIds || (rule.highlightComponentId ? [rule.highlightComponentId] : []);
      html += `<tr data-onboarding-rule="${index}" style="border-bottom:1px solid #1a2540;vertical-align:top;">
        <td style="padding:8px;"><input data-onboarding-text="id" value="${escapeHtml(rule.id || '')}" style="${inputStyle}"><input data-onboarding-text="sceneIds" value="${escapeHtml((rule.scope?.sceneIds || []).join(', '))}" placeholder="S01, S02" style="${inputStyle};margin-top:6px"></td>
        <td style="padding:8px;"><select data-onboarding-when style="${inputStyle}">${['always', 'tutorialCurrent', 'tutorialCompleted', 'storyPath'].map(type => `<option value="${type}"${when.type === type ? ' selected' : ''}>${type}</option>`).join('')}</select><input data-onboarding-text="conditionValue" value="${escapeHtml(conditionValue)}" placeholder="${conditionPlaceholder}" style="${inputStyle};margin-top:6px;"><input data-onboarding-text="conditionEquals" value="${escapeHtml(Object.prototype.hasOwnProperty.call(when, 'equals') ? String(when.equals) : '')}" placeholder="storyPath equals（可选）" style="${inputStyle};margin-top:6px"></td>
        <td style="padding:8px;">${componentSelect('revealComponentIds', rule.revealComponentIds || [])}</td>
        <td style="padding:8px;">${componentSelect('enabledComponentIds', rule.enabledComponentIds || [])}</td>
        <td style="padding:8px;">${componentSelect('highlightComponentIds', highlights)}<input data-onboarding-text="hintAction" value="${escapeHtml(rule.hintAction || '')}" placeholder="InputHints action，例如 interact" style="${inputStyle};margin-top:6px"></td>
        <td style="padding:8px;"><button type="button" data-onboarding-delete style="background:#713540;color:#fff;border:0;border-radius:3px;padding:6px 8px;cursor:pointer;">删除</button></td>
      </tr>`;
    });
    html += '</tbody></table></div><button id="uie-onboarding-add" type="button" style="margin-top:14px;background:#3a4a7e;color:#fff;border:0;border-radius:4px;padding:8px 12px;cursor:pointer;">＋ 添加规则</button>';
    stage.innerHTML = html;

    const readSelectedIds = element => [...element.selectedOptions].map(option => option.value);
    const updateRule = element => {
      const row = element.closest('[data-onboarding-rule]');
      const index = Number(row?.dataset.onboardingRule);
      const rule = document.rules[index];
      if (!rule) return;
      if (element.dataset.onboardingComponents) {
        rule[element.dataset.onboardingComponents] = readSelectedIds(element);
        if (element.dataset.onboardingComponents === 'highlightComponentIds') delete rule.highlightComponentId;
      } else if (element.dataset.onboardingWhen) {
        rule.when ||= {};
        rule.when.type = element.value;
      } else {
        const field = element.dataset.onboardingText;
        if (field === 'id' || field === 'hintAction') rule[field] = element.value.trim();
        if (field === 'sceneIds') rule.scope = { ...(rule.scope || {}), sceneIds: element.value.split(',').map(value => value.trim()).filter(Boolean) };
        if (field === 'conditionValue') {
          rule.when ||= { type: 'always' };
          // 引导式：在 always 下填写教程 ID/路径，自动升级为教程完成条件，避免填了被静默丢弃
          if (rule.when.type === 'always' && element.value.trim()) {
            rule.when.type = 'tutorialCompleted';
            const whenSelect = row?.querySelector('[data-onboarding-when]');
            if (whenSelect) whenSelect.value = 'tutorialCompleted';
            this._setStatus('检测到教程 ID，条件已自动切换为 tutorialCompleted（教程完成后显示）；记得「💾 保存到文件」');
          }
          if (rule.when.type === 'storyPath') rule.when.path = element.value.trim();
          else if (rule.when.type !== 'always') rule.when.tutorialId = element.value.trim();
        }
        if (field === 'conditionEquals') {
          rule.when ||= { type: 'always' };
          const rawValue = element.value.trim();
          if (!rawValue) {
            delete rule.when.equals;
          } else {
            try {
              rule.when.equals = JSON.parse(rawValue);
            } catch {
              rule.when.equals = rawValue;
            }
          }
        }
      }
      // 就地同步输入框提示文字，不整表重绘（避免滚动/焦点丢失被误认为页面刷新）
      const whenType = rule.when?.type || 'always';
      const conditionValueInput = row?.querySelector('[data-onboarding-text="conditionValue"]');
      if (conditionValueInput) {
        conditionValueInput.placeholder = whenType === 'storyPath'
          ? 'Story 路径，例如 s01Survival.xxx'
          : (whenType === 'always' ? '可留空（始终显示）' : '教程 ID，例如 s01.attack');
      }
      this._setStatus('OnboardingUI 规则已修改，记得点「💾 保存到文件」');
    };
    stage.querySelectorAll('[data-onboarding-text], [data-onboarding-when], [data-onboarding-components]').forEach(element => {
      element.addEventListener('change', () => updateRule(element));
    });
    stage.querySelectorAll('[data-onboarding-delete]').forEach(button => {
      button.addEventListener('click', () => {
        const index = Number(button.closest('[data-onboarding-rule]')?.dataset.onboardingRule);
        document.rules.splice(index, 1);
        this._setStatus('已删除 OnboardingUI 规则（未保存）');
        this._renderOnboardingEditor();
      });
    });
    stage.querySelector('#uie-onboarding-add')?.addEventListener('click', () => {
      document.rules.push({
        id: `s01-ui-rule-${document.rules.length + 1}`,
        scope: { sceneIds: ['S01'] },
        when: { type: 'always' },
        revealComponentIds: [],
        enabledComponentIds: [],
        highlightComponentIds: [],
        hintAction: ''
      });
      this._setStatus('已添加 OnboardingUI 规则（未保存）');
      this._renderOnboardingEditor();
    });
    props.innerHTML = `<h4>引导规则</h4><div class="uie-prop-empty" style="line-height:1.7">多选组件时按住 Ctrl 或 Shift。<br><br>条件只读取 SceneTutorialFlow 与已提交 StoryState；<code style="color:#8fc">hintAction</code> 必须使用 InputHints 中的动作 ID。<br><br>保存位置：<br><code style="color:#8aa">${this.configBase}OnboardingUI.json</code></div>`;
  }

  /** 保存当前完整 PanelLayout 文档，避免只写回可编辑白名单而丢失其他部件。 */
  async _savePanelLayout() {
    if (!this._panelLayoutDocument) throw new Error('PanelLayout 配置尚未加载');
    const file = this.configBase + 'PanelLayout.json';
    const content = JSON.stringify(this._panelLayoutDocument, null, 2);
    const res = await fetch('/api/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: file, content })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok !== true) throw new Error(data?.error || `HTTP ${res.status}`);
    return true;
  }

  /** 保存 PC、Android 游戏 UI、共用 PanelLayout 与两套登录页面布局。 */
  async save() {
    if (this._saveInFlight) return;
    this._saveInFlight = true;
    const saveButton = this.container.querySelector('#uie-save');
    const previousButtonText = saveButton?.textContent || '💾 保存到文件';
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = '保存中…';
    }
    this._setStatus('正在保存布局、PanelLayout、手柄绑定、提示文案和引导规则…');

    const saved = [];
    const failures = [];
    const savePart = async (label, operation) => {
      try {
        await operation();
        saved.push(label);
      } catch (error) {
        failures.push({ label, message: error?.message || String(error) });
      }
    };

    try {
      await savePart('手柄绑定', () => this._saveGamepadConfig());
      await savePart('提示文案', () => this._saveHintsConfig());
      if (this._onboardingUiDocument) {
        await savePart('OnboardingUI.json', () => this._saveOnboardingUiConfig());
      }
      if (this._panelLayoutDocument) {
        await savePart('PanelLayout.json', () => this._savePanelLayout());
      }

      for (const platform of EDITABLE_LAYOUT_PLATFORMS) {
        const fileName = layoutFileName(platform);
        const file = this.configBase + fileName;
        const layout = this.layouts[platform];
        const cw = layout.canvas.width;
        const ch = layout.canvas.height;
        const out = {
          ...(LOGIN_LAYOUT_PLATFORMS.has(platform) ? { version: 1 } : {}),
          canvas: layout.canvas,
          components: layout.components.map(c => ({
            id: c.id,
            label: c.label,
            kind: c.kind,
            anchor: c.anchor || 'topleft',
            x: c.x,
            y: c.y,
            width: c.width,
            height: c.height,
            ...(BADGE_TEXT_LAYOUT_IDS.has(c.id) ? {
              fontSize: Number.isFinite(c.fontSize) ? c.fontSize : 0,
              textOffsetX: Number.isFinite(c.textOffsetX) ? c.textOffsetX : 0,
              textOffsetY: Number.isFinite(c.textOffsetY) ? c.textOffsetY : 0
            } : {}),
            xPct: +(c.x / cw).toFixed(5),
            yPct: +(c.y / ch).toFixed(5),
            wPct: +(c.width / cw).toFixed(5),
            hPct: +(c.height / ch).toFixed(5)
          }))
        };
        const content = JSON.stringify(out, null, 2);
        await savePart(fileName, async () => {
          const res = await fetch('/api/save-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: file, content })
          });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        });
      }

      if (failures.length > 0) {
        const detail = failures.map(item => `${item.label}: ${item.message}`).join('；');
        const message = `部分文件保存失败（已成功 ${saved.length} 项）：${detail}`;
        this._setStatus(message, true);
        this._showSaveFeedback(message, true);
        return;
      }

      const message = `保存成功，共写入 ${saved.length} 项到 ${this.configBase}`;
      this._setStatus(`✅ ${message}`);
      this._showSaveFeedback(message);
    } finally {
      this._saveInFlight = false;
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = previousButtonText;
      }
    }
  }

  /**
   * 在 Canvas 上绘制面板真实预览。
   * 变换与 BackpackPanel._applyScaledLayout() 一致：等比缩放后在 UILayout 外框中居中。
   * @param {HTMLCanvasElement} cvs
   * @param {Object} panelDef - 面板定义（来自 PanelLayout.json）
   * @param {Object} comp - 当前平台 UILayout 外框
   */
  _drawPanelPreview(cvs, panelDef, comp) {
    const ctx = cvs.getContext('2d');
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    const transform = this._getPanelContentTransform(comp, panelDef);
    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.translate(transform.offsetX, transform.offsetY);
    ctx.scale(transform.contentScale, transform.contentScale);

    ctx.fillStyle = panelDef.backgroundColor || 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, panelDef.width, panelDef.height);
    ctx.strokeStyle = panelDef.borderColor || '#4a9eff';
    ctx.lineWidth = panelDef.borderWidth || 2;
    ctx.strokeRect(0, 0, panelDef.width, panelDef.height);

    for (const part of panelDef.parts || []) {
      const { x, y, width, height } = part;
      switch (part.type) {
        case 'text':
          ctx.fillStyle = part.color || '#ffffff';
          ctx.font = `${part.fontWeight || 'normal'} ${part.fontSize || 14}px Arial`;
          ctx.textAlign = part.align || 'left';
          ctx.textBaseline = 'top';
          const tx = part.align === 'center' ? x + width / 2 : part.align === 'right' ? x + width : x;
          ctx.fillText(part.text || '', tx, y);
          ctx.textAlign = 'left';
          break;
        case 'line':
          ctx.strokeStyle = part.color || '#4a9eff';
          ctx.lineWidth = height || 1;
          ctx.beginPath();
          ctx.moveTo(x, y + height / 2);
          ctx.lineTo(x + width, y + height / 2);
          ctx.stroke();
          break;
        case 'button':
          ctx.fillStyle = part.bgColor || '#3a4a7e';
          ctx.fillRect(x, y, width, height);
          ctx.strokeStyle = part.borderColor || '#666';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, width, height);
          ctx.fillStyle = part.color || '#ffffff';
          ctx.font = `${part.fontSize || 12}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(part.text || '', x + width / 2, y + height / 2);
          ctx.textAlign = 'left';
          break;
        case 'equip-slot':
          ctx.fillStyle = part.slotBgColor || 'rgba(30,30,30,0.9)';
          ctx.fillRect(x, y, width, height);
          ctx.strokeStyle = part.slotBorderColor || '#555';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x, y, width, height);
          ctx.fillStyle = '#888';
          ctx.font = '10px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(part.slotLabel || '', x + width / 2, y + height / 2);
          ctx.textAlign = 'left';
          break;
        case 'slot-grid': {
          const cols = part.cols || 6;
          const rows = part.rows || 4;
          const sz = part.slotSize || 50;
          const pad = part.slotPadding || 5;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const gx = x + c * (sz + pad);
              const gy = y + r * (sz + pad);
              ctx.fillStyle = part.slotBgColor || 'rgba(50,50,50,0.8)';
              ctx.fillRect(gx, gy, sz, sz);
              ctx.strokeStyle = part.slotBorderColor || '#666';
              ctx.lineWidth = 1;
              ctx.strokeRect(gx, gy, sz, sz);
            }
          }
          break;
        }
        case 'attr-row':
          ctx.fillStyle = part.labelColor || '#aaaaaa';
          ctx.font = `${part.fontSize || 13}px Arial`;
          ctx.textBaseline = 'top';
          ctx.fillText(`${part.attrLabel || ''}:`, x, y);
          ctx.fillStyle = part.attrColor || '#ffffff';
          ctx.fillText('999/999', x + 60, y);
          break;
        case 'scrollbar':
          ctx.fillStyle = part.trackColor || 'rgba(255,255,255,0.1)';
          ctx.fillRect(x, y, width, height);
          ctx.fillStyle = part.thumbColor || 'rgba(255,255,255,0.4)';
          ctx.fillRect(x, y, width, height * 0.4);
          break;
        case 'icon':
          ctx.font = `${part.fontSize || 24}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(part.icon || '⚔️', x + width / 2, y + height / 2);
          ctx.textAlign = 'left';
          break;
        case 'progress-bar':
          ctx.fillStyle = part.bgColor || '#333';
          ctx.fillRect(x, y, width, height);
          ctx.fillStyle = part.fillColor || '#4CAF50';
          ctx.fillRect(x, y, width * (part.value || 0.5), height);
          ctx.strokeStyle = part.borderColor || '#666';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, width, height);
          break;
      }
    }
    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════════
  // 手柄绑定编辑器
  // ═══════════════════════════════════════════════════════════════════

  /** 加载手柄绑定配置（从 config/gamepad.json）和 Xbox360Profile 元数据 */
  async _loadGamepadConfig() {
    // 动态 import Xbox360Profile（编辑器不在 src 下，用相对路径）
    try {
      const mod = await import('../src/core/input/Xbox360Profile.js');
      this._gamepadMeta = {
        PadButton: mod.PadButton,
        PAD_BUTTON_LABELS: mod.PAD_BUTTON_LABELS,
        BINDABLE_ACTIONS: mod.BINDABLE_ACTIONS,
        ACTION_LABELS: mod.ACTION_LABELS,
        DEFAULT_BINDINGS: mod.DEFAULT_BINDINGS,
        ATTACK_ACTION: mod.ATTACK_ACTION,
        NONE_ACTION: mod.NONE_ACTION,
        BINDING_DESCRIPTIONS: mod.BINDING_DESCRIPTIONS
      };
      this._defaultGamepadBindings = { ...mod.DEFAULT_BINDINGS };
      this._gamepadBindings = { ...mod.DEFAULT_BINDINGS };
    } catch (e) {
      console.warn('UIEditor: 无法加载 Xbox360Profile，手柄编辑器不可用', e);
      return;
    }

    // 尝试加载已保存的配置
    const file = this.configBase + 'gamepad.json';
    try {
      const res = await fetch('/api/read-file?path=' + encodeURIComponent(file));
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok && data.content) {
          const cfg = JSON.parse(data.content);
          if (cfg.bindings) {
            for (const [k, v] of Object.entries(cfg.bindings)) {
              this._gamepadBindings[Number(k)] = v;
            }
          }
          if (cfg.deadzone != null) this._gamepadDeadzone = cfg.deadzone;
          if (cfg.triggerThreshold != null) this._gamepadTriggerThreshold = cfg.triggerThreshold;
        }
      }
    } catch (e) {
      // 无配置文件，用默认绑定
    }
  }

  /** 保存手柄绑定配置到 config/gamepad.json */
  async _saveGamepadConfig() {
    if (!this._gamepadMeta) throw new Error('手柄配置尚未加载');
    const file = this.configBase + 'gamepad.json';
    const cfg = {
      bindings: this._gamepadBindings,
      deadzone: this._gamepadDeadzone,
      triggerThreshold: this._gamepadTriggerThreshold
    };
    const content = JSON.stringify(cfg, null, 2);
    const res = await fetch('/api/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: file, content })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return true;
  }

  /** 渲染操作提示文案编辑界面（pc / android / gamepad 三套） */
  _renderHintsEditor() {
    const stage = this.container.querySelector('#uie-stage');
    const props = this.container.querySelector('#uie-props');
    if (!stage || !props) return;

    // 文案表格很长，取消垂直居中避免内容被裁切到容器外
    const wrap = this.container.querySelector('.uie-stage-wrap');
    if (wrap) wrap.style.alignItems = 'flex-start';

    if (!this._hintActions) {
      stage.innerHTML = '<div style="padding:40px;color:#ff8888;text-align:center;">InputHints 加载失败，提示文案编辑器不可用</div>';
      props.innerHTML = '';
      return;
    }

    stage.style.width = '980px';
    stage.style.height = 'auto';
    stage.style.minHeight = '400px';
    stage.style.overflow = 'auto';
    stage.style.padding = '12px 20px 20px';
    stage.style.display = 'block';

    // 手柄列用绑定动作下拉：文案跟随绑定，不写死按钮名
    const bindable = (this._gamepadMeta && this._gamepadMeta.BINDABLE_ACTIONS) || [];

    let html = `
      <h3 style="color:#8fc7ff;margin:0 0 16px">操作提示文案（三套输入方案）</h3>
      <p style="color:#778;font-size:12px;margin-bottom:16px;">
        游戏里的提示、教程、按钮角标都从这里取文案。写一份模板如
        <code style="color:#8fc">{bag}打开背包</code>，运行时按玩家当前设备替换。
        手柄列选的是"绑定动作"，实际按钮名由手柄绑定表反查，改绑定后提示自动跟着变。
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:12px;line-height:2.2;">
        <thead>
          <tr style="border-bottom:1px solid #2a3a5e;">
            <th style="text-align:left;padding:10px 8px;color:#4CAF50;width:110px;">动作</th>
            <th style="text-align:left;padding:10px 8px;color:#4CAF50;width:120px;">PC 按键</th>
            <th style="text-align:left;padding:10px 8px;color:#4CAF50;width:90px;">PC 句式</th>
            <th style="text-align:left;padding:10px 8px;color:#4CAF50;width:130px;">Android 控件</th>
            <th style="text-align:left;padding:10px 8px;color:#4CAF50;width:150px;">手柄绑定动作</th>
            <th style="text-align:left;padding:10px 8px;color:#4CAF50;">预览（键鼠 / 触屏 / 手柄）</th>
          </tr>
        </thead>
        <tbody>
    `;

    const inputStyle = 'width:100%;background:#0a1020;color:#fff;border:1px solid #2a3a5e;padding:6px 8px;border-radius:3px;font-size:12px;';

    for (const [action, def] of Object.entries(this._hintActions)) {
      const pcKey = (def.pc && def.pc.key) || '';
      const pcKind = (def.pc && def.pc.kind) || 'key';
      const android = def.android || '';
      const padKey = def.padKey || '';
      const padFixed = def.padFixed || '';

      let padCell;
      if (padFixed) {
        // 摇杆等固定部件不参与绑定反查
        padCell = `<span style="color:#8aa;">固定：${padFixed}</span>`;
      } else {
        let options = `<option value="">（未绑定）</option>`;
        for (const a of bindable) {
          if (!a.value) continue;
          const sel = a.value === padKey ? 'selected' : '';
          options += `<option value="${a.value}" ${sel}>${a.label}（${a.value}）</option>`;
        }
        padCell = `<select data-hint-pad="${action}" style="${inputStyle}">${options}</select>`;
      }

      const preview = [
        this._previewHint(action, 'pc'),
        this._previewHint(action, 'android'),
        this._previewHint(action, 'gamepad')
      ].join(' / ');

      html += `
        <tr style="border-bottom:1px solid #1a2540;">
          <td style="padding:10px 8px;font-weight:bold;color:#cfe3ff;">${action}</td>
          <td style="padding:10px 8px;">
            <input type="text" data-hint-pckey="${action}" value="${pcKey}" style="${inputStyle}">
          </td>
          <td style="padding:10px 8px;">
            <select data-hint-pckind="${action}" style="${inputStyle}">
              <option value="key" ${pcKind === 'key' ? 'selected' : ''}>按X键</option>
              <option value="raw" ${pcKind === 'raw' ? 'selected' : ''}>点击X</option>
            </select>
          </td>
          <td style="padding:10px 8px;">
            <input type="text" data-hint-android="${action}" value="${android}" style="${inputStyle}">
          </td>
          <td style="padding:10px 8px;">${padCell}</td>
          <td style="padding:10px 8px;color:#9fb;">${preview}</td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    stage.innerHTML = html;

    const onEdit = () => {
      this._renderHintsEditor();
      this._setStatus('提示文案已修改，记得点「💾 保存到文件」');
    };

    stage.querySelectorAll('input[data-hint-pckey]').forEach(el => {
      el.addEventListener('change', () => {
        const action = el.dataset.hintPckey;
        this._hintActions[action].pc = { ...(this._hintActions[action].pc || {}), key: el.value };
        onEdit();
      });
    });
    stage.querySelectorAll('select[data-hint-pckind]').forEach(el => {
      el.addEventListener('change', () => {
        const action = el.dataset.hintPckind;
        this._hintActions[action].pc = { ...(this._hintActions[action].pc || {}), kind: el.value };
        onEdit();
      });
    });
    stage.querySelectorAll('input[data-hint-android]').forEach(el => {
      el.addEventListener('change', () => {
        this._hintActions[el.dataset.hintAndroid].android = el.value;
        onEdit();
      });
    });
    stage.querySelectorAll('select[data-hint-pad]').forEach(el => {
      el.addEventListener('change', () => {
        this._hintActions[el.dataset.hintPad].padKey = el.value;
        onEdit();
      });
    });

    props.innerHTML = `
      <h4>提示文案</h4>
      <div class="uie-prop-empty" style="line-height:1.7">
        占位符两种写法：<br>
        <code style="color:#8fc">{bag}</code> → 完整短语（含按/点击）<br>
        <code style="color:#8fc">{key:bag}</code> → 只要按键名<br><br>
        Android 控件名若本身带动作词（如"点击地面"），不会再叠加"点击"。<br><br>
        保存位置：<br><code style="color:#8aa">${this.configBase}InputHints.json</code>
      </div>
    `;
  }

  /** 渲染手柄绑定编辑界面 */
  _renderGamepadEditor() {
    const stage = this.container.querySelector('#uie-stage');
    const props = this.container.querySelector('#uie-props');
    if (!stage || !props) return;

    // 表格长列表，取消垂直居中
    const wrap = this.container.querySelector('.uie-stage-wrap');
    if (wrap) wrap.style.alignItems = 'flex-start';

    if (!this._gamepadMeta) {
      stage.innerHTML = '<div style="padding:40px;color:#ff8888;text-align:center;">Xbox360Profile 加载失败，手柄编辑器不可用</div>';
      props.innerHTML = '';
      return;
    }

    const { PadButton, PAD_BUTTON_LABELS, BINDABLE_ACTIONS, ACTION_LABELS, ATTACK_ACTION, NONE_ACTION } = this._gamepadMeta;

    // 舞台：手柄按键绑定列表（表格形式，每行一个按钮 + 下拉选择动作）
    stage.style.width = '600px';
    stage.style.height = 'auto';
    stage.style.minHeight = '400px';
    stage.style.overflow = 'auto';
    stage.style.padding = '20px';
    stage.style.display = 'block';

    const buttonIndices = Object.keys(PadButton).map(k => PadButton[k]).filter(v => typeof v === 'number');

    let html = `
      <h3 style="color:#8fc7ff;margin:0 0 16px">Xbox 360 手柄按键绑定</h3>
      <p style="color:#778;font-size:12px;margin-bottom:16px;">为每个手柄按钮选择对应的游戏动作。左摇杆固定为移动、右摇杆固定为瞄准，不可更改。</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid #2a3a5e;">
            <th style="text-align:left;padding:8px;color:#4CAF50;width:100px;">按钮</th>
            <th style="text-align:left;padding:8px;color:#4CAF50;">绑定动作</th>
            <th style="text-align:left;padding:8px;color:#4CAF50;width:100px;">默认</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const idx of buttonIndices) {
      if (idx === PadButton.GUIDE) continue; // Guide 键大多驱动不上报，不让用户绑
      const btnLabel = PAD_BUTTON_LABELS[idx] || `按钮${idx}`;
      const currentAction = this._gamepadBindings[idx] != null ? this._gamepadBindings[idx] : NONE_ACTION;
      const defaultAction = this._defaultGamepadBindings[idx] != null ? this._defaultGamepadBindings[idx] : NONE_ACTION;
      const defaultLabel = ACTION_LABELS[defaultAction] || (defaultAction === ATTACK_ACTION ? '攻击' : '—');

      // 按分组渲染 options
      const groups = {};
      for (const a of BINDABLE_ACTIONS) {
        if (!groups[a.group]) groups[a.group] = [];
        groups[a.group].push(a);
      }

      let options = '';
      for (const [groupName, actions] of Object.entries(groups)) {
        options += `<optgroup label="${groupName}">`;
        for (const a of actions) {
          const sel = a.value === currentAction ? 'selected' : '';
          options += `<option value="${a.value}" ${sel}>${a.label}</option>`;
        }
        options += '</optgroup>';
      }

      const isDefault = currentAction === defaultAction;
      const rowColor = isDefault ? '' : 'background:rgba(76,175,80,0.08);';

      html += `
        <tr style="border-bottom:1px solid #1a2540;${rowColor}">
          <td style="padding:6px 8px;font-weight:bold;color:#cfe3ff;">${btnLabel}</td>
          <td style="padding:6px 8px;">
            <select data-btn="${idx}" style="width:100%;background:#0a1020;color:#fff;border:1px solid #2a3a5e;padding:5px;border-radius:3px;">
              ${options}
            </select>
          </td>
          <td style="padding:6px 8px;color:#556;font-size:11px;">${defaultLabel}</td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    stage.innerHTML = html;

    // 绑定下拉事件
    stage.querySelectorAll('select[data-btn]').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.dataset.btn);
        this._gamepadBindings[idx] = sel.value;
        this._setStatus('已修改（未保存）');
      });
    });

    // 右侧属性面板：死区 + 扳机阈值
    props.innerHTML = `
      <h4 style="color:#4CAF50;">手柄参数</h4>
      <div class="uie-prop-row">
        <label style="width:80px;">摇杆死区</label>
        <input type="number" id="gp-deadzone" value="${this._gamepadDeadzone}" step="0.01" min="0" max="0.5" style="width:70px;background:#0a1020;border:1px solid #2a3a5e;color:#fff;padding:5px;border-radius:3px;">
      </div>
      <div class="uie-prop-empty" style="margin-bottom:8px;font-size:11px;">推荐 0.15~0.3，越大松手回归越灵敏</div>
      <div class="uie-prop-row">
        <label style="width:80px;">扳机阈值</label>
        <input type="number" id="gp-trigger" value="${this._gamepadTriggerThreshold}" step="0.05" min="0.1" max="0.9" style="width:70px;background:#0a1020;border:1px solid #2a3a5e;color:#fff;padding:5px;border-radius:3px;">
      </div>
      <div class="uie-prop-empty" style="margin-bottom:16px;font-size:11px;">LT/RT 超过此值视为按下</div>
      <div style="border-top:1px solid #2a3a5e;padding-top:12px;margin-top:12px;">
        <h4 style="color:#778;font-size:12px;">固定映射（不可更改）</h4>
        <p style="color:#556;font-size:11px;line-height:1.6;">
          左摇杆 → 移动（模拟量）<br>
          右摇杆 → 瞄准准星<br>
          十字键 → 方向移动（数字）
        </p>
      </div>
    `;

    const dzInput = props.querySelector('#gp-deadzone');
    const tgInput = props.querySelector('#gp-trigger');
    if (dzInput) dzInput.addEventListener('input', () => {
      const v = parseFloat(dzInput.value);
      if (!isNaN(v) && v >= 0 && v <= 0.5) this._gamepadDeadzone = v;
    });
    if (tgInput) tgInput.addEventListener('input', () => {
      const v = parseFloat(tgInput.value);
      if (!isNaN(v) && v >= 0.1 && v <= 0.9) this._gamepadTriggerThreshold = v;
    });
  }
}
export default UIEditor;
