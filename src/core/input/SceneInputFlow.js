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

import { InputEventType, InputHandler } from './InputEvent.js';

const NOOP = () => false;
const DEFAULT_KEYS = ['e', 'space', 'jump', 'skill1', 'skill2', 'skill3', 'skill4'];

function wasHandled(value, inputManager) {
  if (value === true || value?.handled === true || value?.consumed === true) return true;
  return inputManager?.isMouseClickHandled?.() === true;
}

/** 帧输入编排：轮询、优先消费、意图更新、路由、清帧。 */
export class SceneInputFlow {
  constructor({
    inputManager = null,
    runtime = null,
    router = null,
    gamepadManager = null,
    gamepadCombat = null,
    onModalInput = NOOP,
    onPopupConfirm = NOOP,
    onGamepadCombat = NOOP,
    onGamepadCombatCancel = NOOP,
    onLocomotionInput = NOOP,
    dialogue = null,
    aiming = null,
    chargedJump = null,
    triggerBindings = null,
    npcInteraction = null,
    getNpcInteraction = null,
    worldInteraction = null
  } = {}) {
    this.inputManager = inputManager;
    this.runtime = runtime;
    this.router = router || runtime?.inputRouter || null;
    this.gamepadManager = gamepadManager || inputManager?.gamepad || null;
    this.gamepadCombat = gamepadCombat;
    this.onModalInput = typeof onModalInput === 'function' ? onModalInput : NOOP;
    this.onPopupConfirm = typeof onPopupConfirm === 'function' ? onPopupConfirm : NOOP;
    this.onGamepadCombat = typeof onGamepadCombat === 'function' ? onGamepadCombat : NOOP;
    this.onGamepadCombatCancel = typeof onGamepadCombatCancel === 'function'
      ? onGamepadCombatCancel
      : NOOP;
    this.onLocomotionInput = typeof onLocomotionInput === 'function' ? onLocomotionInput : NOOP;
    this.dialogue = dialogue;
    this.aiming = aiming;
    this.chargedJump = chargedJump;
    this.triggerBindings = triggerBindings;
    this.npcInteraction = npcInteraction;
    this.getNpcInteraction = typeof getNpcInteraction === 'function' ? getNpcInteraction : null;
    this.worldInteraction = worldInteraction;
    this._disposers = [];
    this._registered = false;
    this._frameStarted = false;
    this._disposed = false;
    this._modalConsumed = false;
    this._modalAllowsMovement = false;
    this._popupConsumed = false;
  }

  registerDefaults() {
    if (this._registered || this._disposed) return this;
    const register = this.router?.register?.bind(this.router);
    if (!register) return this;

    this._disposers.push(register(InputHandler.MODAL_UI, {
      id: 'scene-input-modal',
      constraint: null,
      handle: event => {
        if (this._modalConsumed || this._popupConsumed) return true;
        return wasHandled(this.onPopupConfirm(event), this.inputManager);
      }
    }));
    this._disposers.push(register(InputHandler.PANEL_UI, {
      id: 'scene-input-panel',
      constraint: null,
      handle: event => this._invokeHandled(
        this.worldInteraction,
        ['handlePanelInput', 'handleUIInput', 'handleUIClick'],
        event
      )
    }));
    this._disposers.push(register(InputHandler.AIMING, {
      id: 'scene-input-charged-jump',
      constraint: null,
      canHandle: event => this.chargedJump?.canHandle?.(event) === true,
      handle: event => wasHandled(this.chargedJump?.handleInput?.(event), this.inputManager)
    }));
    this._disposers.push(register(InputHandler.AIMING, {
      id: 'scene-input-aiming',
      constraint: null,
      canHandle: event => this._isAiming(event),
      handle: event => this._invokeHandled(
        this.aiming,
        ['handleInput', 'routeInput', 'updatePCAimMode', 'update'],
        event
      )
    }));
    this._disposers.push(register(InputHandler.PICKUP, {
      id: 'scene-gathering-cancel',
      handle: event => this.worldInteraction?.handleGatheringCancel?.(event) === true
    }));
    this._disposers.push(register(InputHandler.PICKUP, {
      id: 'scene-trigger-interact',
      handle: event => this.triggerBindings?.handleInteract?.(event) === true
    }));
    this._disposers.push(register(InputHandler.PICKUP, {
      id: 'scene-npc-interact',
      handle: event => (this.getNpcInteraction?.() || this.npcInteraction)?.handleInput?.(event) === true
    }));
    this._disposers.push(register(InputHandler.PICKUP, {
      id: 'scene-input-pickup',
      handle: event => this._invokeHandled(
        this.worldInteraction,
        ['handlePickupInput', 'handlePickupEvent', 'handlePickupClick', 'pickup'],
        event
      )
    }));
    this._disposers.push(register(InputHandler.SKILL, {
      id: 'scene-input-locomotion',
      constraint: null,
      canHandle: event => event.type === InputEventType.KEY_PRESS && (event.key === 'space' || event.key === 'jump'),
      handle: event => wasHandled(this.onLocomotionInput(event), this.inputManager)
    }));
    this._registered = true;
    return this;
  }

  beforeFrame(dt = 0) {
    if (this._disposed || this._frameStarted) return [];
    this._frameStarted = true;
    this._modalConsumed = false;
    this._modalAllowsMovement = false;
    this._popupConsumed = false;

    if (typeof this.inputManager?.pollGamepads === 'function') {
      this.inputManager.pollGamepads();
    } else {
      this.gamepadManager?.poll?.();
    }

    const modalResult = this.onModalInput({
      dt,
      inputManager: this.inputManager,
      gamepad: this.gamepadManager
    });
    this._modalConsumed = wasHandled(modalResult, this.inputManager);
    this._modalAllowsMovement = this._modalConsumed && modalResult?.allowMovement === true;
    if (!this._modalConsumed) {
      this._popupConsumed = wasHandled(
        this.onPopupConfirm({ dt, inputManager: this.inputManager, gamepad: this.gamepadManager }),
        this.inputManager
      );
    }

    if (this._modalConsumed || this._popupConsumed) {
      this.onGamepadCombatCancel({
        reason: this._modalConsumed ? 'modal-consumed' : 'popup-consumed',
        dt,
        inputManager: this.inputManager,
        gamepad: this.gamepadManager,
        combat: this.gamepadCombat
      });
    } else {
      this._updateGamepadCombat(dt);
    }

    if (!this.router?.update) return [];
    return this.router.update(DEFAULT_KEYS);
  }

  /** 当前帧是否由模态 UI 或物品弹窗接管，供世界动作停止驱动玩家。 */
  isWorldInputBlocked() {
    return !this._disposed && (this._modalConsumed || this._popupConsumed);
  }

  /**
   * 当前帧是否应停止持续移动输入。
   * 已消费的 modal 可以显式允许移动；此时输入路由仍会吞掉攻击、技能、拾取与交互。
   */
  isMovementInputBlocked() {
    return !this._disposed && (this._popupConsumed || (this._modalConsumed && !this._modalAllowsMovement));
  }

  afterSystems() {
    if (this._disposed || !this.dialogue) return false;
    for (const name of ['checkContinue', 'checkDialogueContinue', 'handleContinueInput']) {
      if (typeof this.dialogue[name] === 'function') {
        return this.dialogue[name]() === true;
      }
    }
    return false;
  }

  flush() {
    if (this._disposed) return;
    if (typeof this.runtime?.flushInput === 'function') this.runtime.flushInput();
    else this.inputManager?.update?.();
    this.releaseFrame();
  }

  /** 结束本次编排但不清输入，供转场提前返回路径使用。 */
  releaseFrame() {
    this._frameStarted = false;
    this._modalConsumed = false;
    this._modalAllowsMovement = false;
    this._popupConsumed = false;
  }

  dispose() {
    if (this._disposed) return;
    this.onGamepadCombatCancel({
      reason: 'dispose',
      inputManager: this.inputManager,
      gamepad: this.gamepadManager,
      combat: this.gamepadCombat
    });
    this._disposed = true;
    for (let index = this._disposers.length - 1; index >= 0; index--) {
      try { this._disposers[index]?.(); } catch (_) { /* disposer 必须彼此隔离 */ }
    }
    this._disposers.length = 0;
    this._registered = false;
  }

  _updateGamepadCombat(dt) {
    const callbackResult = this.onGamepadCombat({
      dt,
      inputManager: this.inputManager,
      gamepad: this.gamepadManager,
      combat: this.gamepadCombat
    });
    if (callbackResult !== false) return callbackResult;
    return this.gamepadCombat?.update?.(this.gamepadManager);
  }

  _isAiming(event) {
    if (!this.aiming) return false;
    if (typeof this.aiming.canHandle === 'function') return this.aiming.canHandle(event) === true;
    if (typeof this.aiming.isAiming === 'function') return this.aiming.isAiming() === true;
    return this.aiming.isAiming === true || this.aiming.state != null;
  }

  _invokeHandled(target, names, event) {
    if (!target) return false;
    for (const name of names) {
      if (typeof target[name] !== 'function') continue;
      return wasHandled(target[name](event), this.inputManager);
    }
    return false;
  }
}

export default SceneInputFlow;
