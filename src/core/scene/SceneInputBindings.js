/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * @project YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 ************************************************************/

import { ARMY_COMMAND_ACTION } from '../input/Xbox360Profile.js';

/** 统一注册场景级热键、手柄连接订阅和手柄配置。 */
export class SceneInputBindings {
  constructor({
    inputManager,
    resourceScope,
    configUrl = 'config/gamepad.json',
    toggleBackpack,
    toggleSettings,
    toggleArmyCommand,
    togglePerformance,
    onGamepadConnected,
    onGamepadDisconnected,
    logger
  } = {}) {
    if (!inputManager) throw new TypeError('SceneInputBindings requires inputManager');
    if (!resourceScope) throw new TypeError('SceneInputBindings requires resourceScope');
    this.inputManager = inputManager;
    this.resourceScope = resourceScope;
    this.configUrl = configUrl;
    this.toggleBackpack = toggleBackpack;
    this.toggleSettings = toggleSettings;
    this.toggleArmyCommand = toggleArmyCommand;
    this.togglePerformance = togglePerformance;
    this.onGamepadConnected = onGamepadConnected;
    this.onGamepadDisconnected = onGamepadDisconnected;
    this.logger = logger;
    this._registered = false;
    this._configLoadStarted = false;
  }

  register() {
    if (this._registered) return this;
    this._registered = true;

    const toggleBackpack = () => this.toggleBackpack?.();
    this.inputManager.registerHotkey('toggle_playerinfo', ['c', 'C'], toggleBackpack, { cooldown: 300 });
    this.inputManager.registerHotkey('toggle_inventory', ['b', 'B'], toggleBackpack, { cooldown: 300 });
    this.inputManager.registerHotkey('toggle_equipment', ['v', 'V'], toggleBackpack, { cooldown: 300 });
    this.inputManager.registerHotkey(
      'toggle_system_settings', ['escape', 'Escape', 'settings'], () => this.toggleSettings?.(), { cooldown: 300 });
    // 军队操作条开关：PC 热键 F（fight）+ 手柄 LS/B（armyCommand 动作，见 Xbox360Profile）
    this.inputManager.registerHotkey(
      'toggle_army_command', ['f', 'F', ARMY_COMMAND_ACTION], () => this.toggleArmyCommand?.(), { cooldown: 300 });
    this.inputManager.registerHotkey(
      'toggle_performance', ['p', 'P'], () => this.togglePerformance?.(), { cooldown: 300 });

    const gamepad = this.inputManager.gamepad;
    if (gamepad) {
      const offConnect = gamepad.onConnect((info) => this.onGamepadConnected?.(info));
      const offDisconnect = gamepad.onDisconnect((info) => this.onGamepadDisconnected?.(info));
      this.resourceScope.track(offConnect);
      this.resourceScope.track(offDisconnect);
    }

    this.loadGamepadConfig();
    return this;
  }

  loadGamepadConfig() {
    const gamepad = this.inputManager.gamepad;
    if (!gamepad || this._configLoadStarted) return Promise.resolve(null);
    this._configLoadStarted = true;
    const guard = (callback) => this.resourceScope.guard(callback);

    return fetch(this.configUrl)
      .then(guard((response) => response.ok ? response.json() : null))
      .then(guard((config) => {
        if (!config) return null;
        gamepad.applyConfig(config);
        if (typeof this.logger === 'function') this.logger();
        else this.logger?.log?.();
        return config;
      }))
      .catch(guard(() => null));
  }
}

export default SceneInputBindings;