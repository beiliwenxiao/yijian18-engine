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

import { UILayoutLoader } from '../../ui/UILayoutLoader.js';
import { PanelLayoutLoader } from '../../ui/PanelLayoutLoader.js';
import { ItemIconRenderer } from '../../ui/ItemIconRenderer.js';
import { InteractionChoiceView } from '../../ui/InteractionChoiceView.js';
import { InputHints } from '../input/InputHints.js';

/**
 * ScenePanelLayout - 场景 Canvas UI 布局协调器（框架级）
 *
 * 负责编辑器配置的加载、窗口缩放重排、PC 功能按钮定位与背包打开时
 * DOM 触屏控件的让位。面板实例和具体 UI 回调仍由调用场景持有。
 */
export class ScenePanelLayout {
  /**
   * @param {Object} scene
   * @param {Object} [hudDependencies] HUD 组合所需的 UI 类和项目数据依赖。
   */
  constructor(scene, hudDependencies = {}) {
    this.scene = scene;
    this.hudDependencies = hudDependencies;
    this._requestedIconKeys = new Set();
    this._screenHudRects = {
      timeWeatherBadge: null,
      combatStateBadge: null
    };
    this._onboardingComponentStates = new Map();
  }

  /**
   * 让所有物品图标（背包、装备槽、拾取弹窗、快捷栏）能使用内容定义的稳定资源 ID。
   * 图片缺失时按需加载一次，本帧仍回退到既有手绘画法，避免闪烁或重复请求。
   */
  installItemIconResolver() {
    const scene = this.scene;
    const requested = this._requestedIconKeys;
    ItemIconRenderer.setImageResolver(stableId => {
      const manager = scene.assetManager;
      if (!manager || !stableId) return null;
      const resolved = manager.resolveManifestAsset?.(stableId, '2d') || null;
      const key = resolved?.key || stableId;
      const asset = manager.getAsset?.(key);
      if (asset) return asset;
      const url = resolved?.url;
      if (url && !requested.has(key) && typeof manager.loadImage === 'function') {
        requested.add(key);
        Promise.resolve(manager.loadImage(key, url)).catch(() => requested.delete(key));
      }
      return null;
    });
    return () => {
      ItemIconRenderer.setImageResolver(null);
      requested.clear();
    };
  }

  /**
   * 创建并注册场景 HUD。具体 UI 类型与项目配置均通过依赖注入提供，
   * 保持框架层不依赖任何示例项目。
   * @param {Object} [hudDependencies] 可选的本次组合依赖，会覆盖构造时传入的同名依赖。
   */
  composeHud(hudDependencies = {}) {
    const scene = this.scene;
    const {
      BackpackPanel,
      BottomControlBar,
      PlayerStatusHUD,
      IconButton,
      DialogueBox,
      NotificationSystem,
      ItemGainedPopup,
      GamepadPanel,
      GamepadCombatController,
      SkillWheelOverlay,
      Minimap,
      SelectedCharacterStore,
      PortraitsConfig
    } = { ...this.hudDependencies, ...hudDependencies };

    // 统一背包面板：属性、装备槽和物品栏均由同一外框承载。
    // 内部操作继续复用原有 PlayerInfoPanel / InventoryPanel 的事件流。
    const invOpts = scene.uiStrategy.getInventoryOptions ? scene.uiStrategy.getInventoryOptions() : null;
    scene.backpackPanel = new BackpackPanel({
      x: Math.round((scene.logicalWidth - 900) / 2),
      y: Math.max(10, scene.logicalHeight - 100 - 520),
      width: 900,
      height: 520,
      visible: false,
      inventoryOptions: invOpts,
      isMobileLayout: scene.isMobileLayout === true || invOpts?.showTooltip === false,
      onAttributeAllocate: () => {
        console.log('BaseGameScene: 属性加点按钮被点击');
      },
      onEquipmentClick: (slotType, button) => scene._handleEquipmentSlotClick(slotType, button),
      onItemUse: (item, healAmount, manaAmount) => scene.onItemUsed(item, healAmount, manaAmount),
      onEquipmentChange: (messages, info) => scene.onEquipmentChanged(messages, info),
      canUseItem: () => {
        const player = scene.playerEntity;
        const allowed = scene.canPerformPlayerAction?.('item.use', player)
          ?? (player?.isDead !== true && player?.isSoulState !== true);
        if (!allowed) {
          const soulState = player?.isSoulState === true || Boolean(scene.playerSoulRespawn?.pending);
          scene._showScreenTip?.(soulState ? '灵魂状态无法使用物品' : '当前状态无法使用物品');
        }
        return allowed;
      },
      onIntent: (intentType, payload, options) => scene.submitItemIntent(intentType, payload, options),
      getProjection: () => scene.getItemLifecycleProjection?.()
    });
    // 保持旧场景和物品弹窗的调用兼容：三个入口均控制同一个组合面板。
    scene.inventoryPanel = scene.backpackPanel;
    scene.playerInfoPanel = scene.backpackPanel;
    scene.equipmentPanel = scene.backpackPanel;
    if (scene.uiStrategy.layoutBackpackPanel) {
      scene.uiStrategy.layoutBackpackPanel(scene.backpackPanel, scene.logicalWidth, scene.logicalHeight);
    }

    // 底部控制栏
    const barOptions = scene.uiStrategy.getBottomControlBarOptions();
    scene.bottomControlBar = new BottomControlBar({
      x: 0,
      y: scene.logicalHeight - 100,
      width: scene.logicalWidth,
      height: 100,
      visible: scene.uiStrategy.isBottomControlBarVisible(),
      // 平台差异由 UI 策略决定（移动端隐藏血球/蓝球和数字快捷键）
      showOrbs: barOptions.showOrbs,
      showHotkeyNumbers: barOptions.showHotkeyNumbers,
      now: () => scene.simulationClock?.now?.() ?? performance.now(),
      onSkillClick: (skill) => {
        scene.onSkillClicked(skill);
      },
      onPotionUse: (potionType) => {
        scene.usePotionFromHotbar(potionType);
      }
    });

    // 玩家状态 HUD（左上角：头像 + 昵称 + 血条 + 蓝条）——由 UI 策略决定是否显示
    const selectedChar = SelectedCharacterStore.get();
    let avatarSrc = null;
    if (selectedChar && (selectedChar.previewImage || selectedChar.assetImage)) {
      const rel = selectedChar.previewImage ||
        (selectedChar.assetImage && selectedChar.assetImage.path);
      if (rel) {
        avatarSrc = scene.assetManager && scene.assetManager.resolveAssetPath
          ? scene.assetManager.resolveAssetPath(rel.replace(/^assets\//, ''))
          : rel;
      }
    }
    scene.playerStatusHUD = new PlayerStatusHUD({
      x: 10,
      y: 10,
      width: 230,
      height: 78,
      visible: scene.uiStrategy.isPlayerStatusHUDVisible(),
      avatarSrc
    });

    // 对话框 - 居中显示（移动端缩小宽度）
    const dialogueBoxWidth = scene.isMobileLayout ? 500 : 700;
    const dialogueBoxHeight = scene.isMobileLayout ? 170 : 230;
    scene.dialogueBox = new DialogueBox({
      x: (scene.logicalWidth - dialogueBoxWidth) / 2,
      y: scene.isMobileLayout
        ? (scene.logicalHeight - dialogueBoxHeight - 60)
        : (scene.logicalHeight - dialogueBoxHeight) / 2,
      width: dialogueBoxWidth,
      height: dialogueBoxHeight,
      visible: false,
      zIndex: 200,
      dialogueSystem: scene.dialogueSystem,
      portraits: PortraitsConfig,
      onDialogueEnd: () => {
        console.log('BaseGameScene: 对话结束');
      }
    });

    // PC 端只保留一个背包按钮；属性与装备已在背包内合并展示。
    if (!scene.isMobileLayout) {
      scene.bagButton = new IconButton({
        x: 946, y: 640, width: 50, height: 50,
        icon: '🎒', label: '背包', hintAction: 'bag',
        onClick: () => { if (scene.backpackPanel) scene.backpackPanel.toggle(); }
      });
      scene.settingsButton = new IconButton({
        x: 1002, y: 640, width: 50, height: 50,
        icon: '⚙️', label: '系统设置', hintAction: 'settings',
        onClick: () => scene.openSystemMenu?.()
      });
      // 跳跃：读取当前键盘/摇杆方向，未输入方向时原地起跳
      scene.jumpButton = new IconButton({
        x: 666, y: 640, width: 50, height: 50,
        icon: '⬆️', label: '跳跃', hintAction: 'jump',
        onClick: () => { scene.enqueueLocomotionInput?.('jump'); }
      });
      // 轻功（按下进入瞄准，左键在射程内确认瞬移）
      scene.flightButton = new IconButton({
        x: 722, y: 640, width: 50, height: 50,
        icon: '💨', label: '轻功', hintAction: 'flight',
        onClick: () => { scene.enterPCAimMode('flight'); }
      });
      // 投掷（按下进入瞄准，左键在射程内确认投掷）
      scene.throwButton = new IconButton({
        x: 778, y: 640, width: 50, height: 50,
        icon: '🎯', label: '投掷', hintAction: 'throw',
        onClick: () => { scene.enterPCAimMode('throw'); }
      });
      // 格挡（按下激活格挡防护）
      scene.blockButton = new IconButton({
        x: 666, y: 640, width: 50, height: 50,
        icon: '🛡', label: '格挡', hintAction: 'block',
        onClick: () => { scene.activateBlock(); }
      });
    }

    // 左侧系统文字提示（拾取/装备等）
    scene.notificationSystem = new NotificationSystem({
      x: 10,
      y: 96,
      width: 300,
      height: 200
    });

    // 获得物品弹窗（食物/装备：图标 + 属性对比 + 装备/放入背包）
    const popupW = 320;
    scene.itemGainedPopup = new ItemGainedPopup({
      x: (scene.logicalWidth - popupW) / 2,
      width: popupW,
      // 底边紧贴底部控制栏（栏顶 = logicalHeight - 100）上方
      anchorBottom: scene.logicalHeight - 100
    });

    // 同一位置存在多个空间交互时使用独立的底部选择窗，不复用物品弹窗业务状态。
    scene.interactionChoiceView = new InteractionChoiceView({
      x: Math.round((scene.logicalWidth - 420) / 2),
      width: 420,
      anchorBottom: scene.logicalHeight - 100
    });

    // 手柄面板（Xbox 360）：HUD 常驻指示 + 完整映射图（调试面板的手柄按钮打开）
    scene.gamepadPanel = new GamepadPanel({
      inputManager: scene.inputManager,
      x: (scene.logicalWidth - 460) / 2,
      y: (scene.logicalHeight - 360) / 2,
      width: 460,
      height: 360,
      visible: false
    });

    // 手柄战斗控制器：处理 RT攻击/RB技能/LB轮盘/Y轻按跳跃与长按轻功/B投掷/LT格挡
    scene.gamepadCombat = new GamepadCombatController();
    // 环形技能轮盘（LB 按住弹出）
    scene.skillWheelOverlay = new SkillWheelOverlay({
      canvasWidth: scene.logicalWidth,
      canvasHeight: scene.logicalHeight
    });

    // 注册 UI 元素到 UIClickHandler
    scene.uiClickHandler.registerElement(scene.skillWheelOverlay);
    scene.uiClickHandler.registerElement(scene.interactionChoiceView);
    scene.uiClickHandler.registerElement(scene.itemGainedPopup);
    scene.uiClickHandler.registerElement(scene.gamepadPanel);
    scene.uiClickHandler.registerElement(scene.backpackPanel);
    scene.uiClickHandler.registerElement(scene.bottomControlBar);
    scene.uiClickHandler.registerElement(scene.dialogueBox);
    if (scene.bagButton) scene.uiClickHandler.registerElement(scene.bagButton);
    if (scene.settingsButton) scene.uiClickHandler.registerElement(scene.settingsButton);
    if (scene.jumpButton) scene.uiClickHandler.registerElement(scene.jumpButton);
    if (scene.flightButton) scene.uiClickHandler.registerElement(scene.flightButton);
    if (scene.throwButton) scene.uiClickHandler.registerElement(scene.throwButton);
    if (scene.blockButton) scene.uiClickHandler.registerElement(scene.blockButton);
    const interactionChoiceView = scene.interactionChoiceView;
    scene.resourceScope?.track(() => {
      interactionChoiceView.close();
      scene.uiClickHandler?.unregisterElement?.(interactionChoiceView);
      if (scene.interactionChoiceView === interactionChoiceView) scene.interactionChoiceView = null;
    });

    // 注册面板到 UISystem（统一管理悬停；倒计时由 SceneHudUpdater 逐帧驱动）
    scene.uiSystem.registerPanel('itemGainedPopup', scene.itemGainedPopup);
    scene.uiSystem.registerPanel('backpack', scene.backpackPanel);
    scene.uiSystem.registerPanel('bottomControl', scene.bottomControlBar);
    scene.uiSystem.registerPanel('dialogue', scene.dialogueBox);

    // PC 功能按钮初始居中（随屏幕宽度自动对齐）
    this.layoutPCFunctionButtons(scene.logicalWidth, scene.logicalHeight);

    // 右侧小地图（以真实地图为基础，缩小到10%）
    const minimapSize = 150;
    scene.minimap = new Minimap({
      x: scene.logicalWidth - minimapSize - 10,
      y: 10,
      width: minimapSize,
      height: minimapSize,
      scale: 0.1,
      visible: true
    });
    // 记录右边锚点（resize 后重新定位用）
    scene.minimap._anchorRight = scene.logicalWidth - 10;
    // HUD 组合只同步引用和世界边界；静态缩略图由区域激活提交后显式建立。
    scene._terrainBinding.updateMinimap(scene.minimap);
    if (scene._worldIndex) {
      scene.minimap.setWorldIndex(scene._worldIndex, scene._worldRegion?.id);
    }

    // 应用 UI 编辑器保存的布局（百分比 → 逻辑坐标），覆盖默认位置/大小
    scene._applyUILayout();
    // HUD 组合是异步布局加载前的首个稳定表现出口；重放已派生投影，
    // 避免配置先加载完成时新建控件短暂以默认状态闪现。
    this.applyOnboardingUiProjection(scene._lastOnboardingUiProjection);
  }

  /** 将相机、核心系统和 HUD 面板绑定到当前玩家实体。 */
  bindPlayer(player = this.scene.playerEntity, options = {}) {
    const scene = this.scene;
    const { syncCameraPosition = true, log = true } = options || {};
    scene.playerEntity = player || null;

    if (player) {
      const transform = player.getComponent?.('transform');
      if (transform && scene.camera) {
        scene.camera.setTarget?.(transform);
        if (syncCameraPosition) {
          const position = transform.position || transform;
          scene.camera.setPosition?.(position.x, position.y);
        }
      }
    } else {
      scene.camera?.setTarget?.(null);
    }

    scene.combatSystem?.setPlayerEntity?.(player || null);
    scene.movementSystem?.setPlayerEntity?.(player || null);
    scene.backpackPanel?.setEntity?.(player || null);
    scene.backpackPanel?.setInputManager?.(scene.inputManager || null);
    scene.bottomControlBar?.setEntity?.(player || null);
    scene.playerStatusHUD?.setPlayer?.(player || null);

    if (player && log) console.log('BaseGameScene: UI面板已绑定到玩家实体');
    return Boolean(player);
  }

  async applyUILayout() {
    const scene = this.scene;
    try {
      await InputHints.load('config/');
      scene.uiLayoutLoader = new UILayoutLoader({ basePath: 'config/' });
      const loaded = await scene.uiLayoutLoader.load();
      if (loaded) {
        const width = scene.logicalWidth;
        const height = scene.logicalHeight;
        const loader = scene.uiLayoutLoader;

        if (scene.backpackPanel) loader.applyToCanvasPanel('backpackPanel', scene.backpackPanel, width, height);

        const buttons = this._pcFunctionButtons();
        scene._pcFnFromEditor = Object.keys(buttons).some(id => loader.getPct(id));
        if (scene._pcFnFromEditor) {
          for (const [id, button] of Object.entries(buttons)) {
            if (button) loader.applyToCanvasPanel(id, button, width, height);
          }
        }

        this._applyBottomControlLayout(loader, width, height);
        this._applyHudLayout(loader, width, height);
        this._applyScreenHudLayout(loader, width, height);
      }
    } catch (error) {
      console.warn('BaseGameScene: 应用 UI 布局失败', error);
    }

    scene.backpackPanel?.layout();
    if (!scene._pcFnFromEditor) this.layoutPCFunctionButtons(scene.logicalWidth, scene.logicalHeight);
    await this.applyPanelLayout();
  }

  async applyPanelLayout() {
    const scene = this.scene;
    try {
      const loader = new PanelLayoutLoader({ basePath: 'config/' });
      const loaded = await loader.load();
      const definition = loaded ? loader.getPanel('backpackPanel') : null;
      if (definition && scene.backpackPanel?.applyPanelLayout) {
        scene.backpackPanel.applyPanelLayout(definition);
      }
    } catch (error) {
      console.warn('BaseGameScene: 面板布局加载失败，使用默认', error);
    }
  }

  layoutPCFunctionButtons(width, height) {
    const buttons = Object.values(this._pcFunctionButtons()).filter(Boolean);
    if (buttons.length === 0) return;
    const buttonWidth = buttons[0].width || 50;
    const gap = 6;
    let x = Math.round((width - (buttons.length * buttonWidth + (buttons.length - 1) * gap)) / 2);
    const y = Math.round(height - 80);
    for (const button of buttons) {
      button.x = x;
      button.y = y;
      x += buttonWidth + gap;
    }
  }

  /** 返回只读使用的屏幕 HUD 像素矩形；矩形只在布局加载或 resize 时更新。 */
  getScreenHudRect(id) {
    return this._screenHudRects[id] || null;
  }

  /** 渐进 UI 状态仅控制表现与 UI 点击，不保存任何任务或剧情事实。 */
  applyOnboardingUiProjection(projection = {}) {
    const scene = this.scene;
    const states = projection?.states || {};
    this._onboardingComponentStates.clear();
    for (const [componentId, state] of Object.entries(states)) {
      this._onboardingComponentStates.set(componentId, {
        visible: state?.visible !== false,
        enabled: state?.enabled !== false,
        highlighted: state?.highlighted === true,
        hintAction: state?.hintAction || null
      });
    }

    const getState = componentId => this._onboardingComponentStates.get(componentId) || {
      visible: true, enabled: true, highlighted: false, hintAction: null
    };
    const canvasButtons = {
      'pc-block': scene.blockButton,
      'pc-jump': scene.jumpButton,
      'pc-flight': scene.flightButton,
      'pc-throw': scene.throwButton,
      'pc-bag': scene.bagButton,
      'pc-settings': scene.settingsButton
    };
    for (const [componentId, button] of Object.entries(canvasButtons)) {
      if (!button) continue;
      const state = getState(componentId);
      button.visible = state.visible;
      button.onboardingEnabled = state.enabled;
      button.onboardingHighlighted = state.highlighted;
      button.onboardingHintAction = state.hintAction || null;
    }

    const hudComponentIds = ['hud-avatar', 'hud-name', 'hud-hp', 'hud-mp'];
    for (const componentId of hudComponentIds) {
      scene.playerStatusHUD?.setOnboardingComponentState?.(componentId, getState(componentId));
    }
    if (scene.playerStatusHUD && !scene.playerStatusHUD.setOnboardingComponentState) {
      scene.playerStatusHUD.visible = hudComponentIds.some(componentId => getState(componentId).visible);
    }
    if (scene.minimap) scene.minimap.visible = getState('minimap').visible;
    for (const componentId of [
      'pc-hp-orb', 'pc-mp-orb', 'pc-potion1', 'pc-potion2', 'pc-skill1', 'pc-skill2', 'pc-skill3', 'pc-skill4', 'pc-skill5'
    ]) {
      scene.bottomControlBar?.setOnboardingComponentState?.(componentId, getState(componentId));
    }

    // Android Web 使用 DOM 事件接收同一投影；微信小游戏没有 DOM 时只保留 Canvas 路径。
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('yijian18:onboarding-ui', { detail: { states } }));
    }
    return true;
  }

  isOnboardingComponentVisible(componentId) {
    return this._onboardingComponentStates.get(componentId)?.visible !== false;
  }

  onResize(width, height) {
    const scene = this.scene;
    scene.logicalWidth = width;
    scene.logicalHeight = height;
    if (scene.isometricRenderer) {
      scene.isometricRenderer.canvasWidth = width;
      scene.isometricRenderer.canvasHeight = height;
    }
    if (scene.camera) {
      scene.camera.width = width;
      scene.camera.height = height;
    }
    this._resizeBottomControl(width, height);
    if (scene.itemGainedPopup) scene.itemGainedPopup.anchorBottom = height - 100;
    if (scene.interactionChoiceView) scene.interactionChoiceView.anchorBottom = height - 100;
    this._resizePCButtons(width, height);
    this._resizeBackpack(width, height);
    if (scene.playerStatusHUD && scene.uiStrategy?.layoutPlayerStatusHUD) {
      scene.uiStrategy.layoutPlayerStatusHUD(scene.playerStatusHUD, width, height);
    }
    this._resizeScreenHud(width, height);
  }

  syncTouchControlsForBackpack() {
    const scene = this.scene;
    if (typeof document === 'undefined' || !document.body) return;
    const isOpen = !!scene.backpackPanel?.visible;
    if (scene._touchControlsDimmed === isOpen) return;
    scene._touchControlsDimmed = isOpen;
    document.body.classList.toggle('backpack-open', isOpen);
  }

  /** 场景退出时恢复由背包面板设置的 DOM 触控状态。 */
  clearTouchControlsForBackpack() {
    const scene = this.scene;
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.remove('backpack-open');
    }
    scene._touchControlsDimmed = false;
  }

  updatePanelHover() {
    const scene = this.scene;
    this.syncTouchControlsForBackpack();
    const mouse = scene.inputManager.getMousePosition();
    scene.uiSystem.updateHover(mouse.x, mouse.y);
    for (const button of Object.values(this._pcFunctionButtons())) {
      button?.handleMouseMove(mouse.x, mouse.y);
    }
    if (scene.backpackPanel?.visible) scene.backpackPanel.handleMouseMove(mouse.x, mouse.y);
    const isPressed = scene.inputManager.isMouseButtonDown
      ? scene.inputManager.isMouseButtonDown(0)
      : scene.inputManager.mouse?.isDown;
    if (!isPressed && scene.backpackPanel?.scrollbarDragging) scene.backpackPanel.endScrollbarDrag();
  }

  _pcFunctionButtons() {
    const scene = this.scene;
    return {
      'pc-block': scene.blockButton,
      'pc-jump': scene.jumpButton,
      'pc-flight': scene.flightButton,
      'pc-throw': scene.throwButton,
      'pc-bag': scene.bagButton,
      'pc-settings': scene.settingsButton
    };
  }

  _applyBottomControlLayout(loader, width, height) {
    const bar = this.scene.bottomControlBar;
    if (!bar) return;
    const definitions = {
      hpOrb: loader.getRect('pc-hp-orb', width, height),
      mpOrb: loader.getRect('pc-mp-orb', width, height),
      potion1: loader.getRect('pc-potion1', width, height),
      potion2: loader.getRect('pc-potion2', width, height),
      skill1: loader.getRect('pc-skill1', width, height),
      skill2: loader.getRect('pc-skill2', width, height),
      skill3: loader.getRect('pc-skill3', width, height),
      skill4: loader.getRect('pc-skill4', width, height),
      skill5: loader.getRect('pc-skill5', width, height)
    };
    if (Object.values(definitions).some(Boolean)) bar.applySubLayout(definitions);
    else loader.applyToCanvasPanel('bottomControlBar', bar, width, height);
  }

  _applyHudLayout(loader, width, height) {
    const hud = this.scene.playerStatusHUD;
    if (!hud) return;
    const definition = {
      avatarRect: loader.getRect('hud-avatar', width, height),
      nameRect: loader.getRect('hud-name', width, height),
      hpRect: loader.getRect('hud-hp', width, height),
      mpRect: loader.getRect('hud-mp', width, height)
    };
    if (Object.values(definition).some(Boolean)) hud.applySubLayout(definition);
  }

  _applyScreenHudLayout(loader, width, height) {
    const scene = this.scene;
    const minimap = scene.minimap;
    const minimapRect = loader?.getRect?.('minimap', width, height) || null;
    const isMinimapLayoutManaged = Boolean(minimap && minimapRect);

    minimap?.setLayoutManaged?.(isMinimapLayoutManaged);
    if (minimap) {
      if (isMinimapLayoutManaged) {
        loader.applyToCanvasPanel('minimap', minimap, width, height);
      } else {
        minimap._anchorRight = width - 10;
        minimap.x = width - minimap.width - 10;
        minimap.y = 10;
      }
    }

    const minimapX = Number.isFinite(minimap?.x) ? minimap.x : width - 160;
    const minimapY = Number.isFinite(minimap?.y) ? minimap.y : 10;
    this._screenHudRects.timeWeatherBadge = loader?.getRect?.('timeWeatherBadge', width, height) || {
      x: minimapX - 160,
      y: minimapY,
      width: 150,
      height: 54
    };
    this._screenHudRects.combatStateBadge = loader?.getRect?.('combatStateBadge', width, height) || {
      x: Math.max(4, minimapX - 90),
      y: minimapY + 62,
      width: 80,
      height: 30
    };
  }

  _resizeScreenHud(width, height) {
    this._applyScreenHudLayout(this.scene.uiLayoutLoader, width, height);
  }

  _resizeBottomControl(width, height) {
    const bar = this.scene.bottomControlBar;
    if (!bar) return;
    bar.width = width;
    bar.x = 0;
    bar.y = height - bar.height;
    const slotSize = bar.skillSlots[0]?.size || 40;
    const gap = 6;
    const totalWidth = bar.skillSlots.length * slotSize + (bar.skillSlots.length - 1) * gap;
    const startX = width / 2 - totalWidth / 2 + slotSize / 2;
    bar.skillSlots.forEach((slot, index) => { slot.x = startX + index * (slotSize + gap); });
    const radius = bar.hpOrb.radius;
    bar.hpOrb.x = width / 2 - totalWidth / 2 - 10 - radius;
    bar.mpOrb.x = width / 2 + totalWidth / 2 + 10 + radius;
  }

  _resizePCButtons(width, height) {
    const scene = this.scene;
    if (!scene._pcFnFromEditor || !scene.uiLayoutLoader) return this.layoutPCFunctionButtons(width, height);
    for (const [id, button] of Object.entries(this._pcFunctionButtons())) {
      if (button) scene.uiLayoutLoader.applyToCanvasPanel(id, button, width, height);
    }
  }

  _resizeBackpack(width, height) {
    const scene = this.scene;
    const panel = scene.backpackPanel;
    if (!panel) return;
    const loader = scene.uiLayoutLoader;
    if (loader?.getPct?.('backpackPanel')) loader.applyToCanvasPanel('backpackPanel', panel, width, height);
    else {
      panel.x = Math.max(10, Math.round((width - panel.width) / 2));
      panel.y = Math.max(10, height - 100 - panel.height);
    }
    panel.layout();
  }
}

export default ScenePanelLayout;
