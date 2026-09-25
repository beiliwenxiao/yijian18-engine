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
 * SceneArmyCommandFlow - 军团指挥场景装配流（M1）
 *
 * 职责：
 * - 装配 ArmyCommandSystem + ArmyCommandHUD（编组条经 uiClickHandler 接管点击）
 * - 扫描 entityStore 中带 SquadMemberComponent 的实体并注册进编组
 * - 三端输入接线：
 *     PC   —— 左键按住拖拽=框选、左键单击=点选单位（空地单击=清选择）、右键=移动下令
 *             （右键经 MovementSystem.armyCommandSystem 钩子接管，见 ArmyCommandSystem.tryHandleMoveOrder）
 *     手柄 —— LB/RB 循环切换选择槽位；移动仍由左摇杆控制武将（ARPG 自主权）
 *     触屏 —— 点选单位；选中编组时点空地=移动下令
 * - 帧更新：命令倒计时推进
 * - 特殊命令已收口：无 HUD 下令入口；建造作业由任务/触发器经
 *   ArmyCommandSystem.startConstruction() 驱动，完成后经 onConstructionComplete 生成工程物实体。
 */
import { FramePhase } from './GameSceneRuntime.js';
import { ArmyCommandSystem } from '../../systems/ArmyCommandSystem.js';
import { ArmyCommandHUD } from '../../ui/ArmyCommandHUD.js';
import { ARMY_STANCES } from '../../ecs/components/CommandStateComponent.js';

const DRAG_THRESHOLD_PX = 8;
const GAMEPAD_CYCLE_FORWARD = 4;   // LB：循环切换选择槽位
const GAMEPAD_CYCLE_BACKWARD = 5;  // RB：循环切换待确认姿态（M2）
const GAMEPAD_CONFIRM = 0;         // A：应用待确认姿态（M2，仅编组选择激活时）

export class SceneArmyCommandFlow {
  /**
   * @param {Object} scene - 游戏场景（需 entityStore/inputManager/camera/uiClickHandler/sceneRuntime/movementSystem）
   */
  constructor(scene) {
    this.scene = scene;
    this.system = new ArmyCommandSystem({ camera: scene.camera || null });
    this.dragState = { active: false, started: false, startX: 0, startY: 0, currentX: 0, currentY: 0, touch: false };
    this.hud = new ArmyCommandHUD({
      system: this.system,
      camera: scene.camera || null,
      dragState: this.dragState
    });
    this._prevLeftHeld = false;
    this._prevPadButtons = new Set();
    this._attached = false;
  }

  /** 系统就绪后调用一次：注册 HUD 点击、帧更新钩子，并接管 MovementSystem 右键。 */
  attach() {
    if (this._attached) return this;
    this._attached = true;
    const scene = this.scene;
    this.system.setInputManager?.(scene.inputManager || null);
    this.system.setCombatSystem?.(scene.combatSystem || null);
    this._enableBuildingCollision(scene);
    this.system.onConstructionComplete = (commandKey, pos, def) => this._spawnConstructionEntity(commandKey, pos, def);
    this.onResize(scene.logicalWidth || 1280, scene.logicalHeight || 720);
    scene.uiClickHandler?.registerElement?.(this.hud);
    scene.movementSystem && (scene.movementSystem.armyCommandSystem = this.system);
    scene.sceneRuntime?.onFramePhase?.(FramePhase.AFTER_SCENE, deltaTime => this.update(deltaTime));
    return this;
  }

  /** 工程物阻挡：把 building 层加入实体碰撞（既有建筑实体获得正确的"建筑挡人"语义）。 */
  _enableBuildingCollision(scene) {
    const collision = scene.collisionSystem;
    if (!collision?.collidableLayers || collision.collidableLayers.includes('building')) return;
    collision.collidableLayers.push('building');
    collision._collidableLayers?.add?.('building');
  }

  /** 建造完成：生成工程物建筑实体（BuildingComponent 碰撞 + flow 自绘外观）。 */
  _spawnConstructionEntity(commandKey, pos, def) {
    const scene = this.scene;
    const factory = scene.entityFactory;
    try {
      const entity = factory?.createBuilding?.({
        id: `construction-${commandKey}-${Date.now()}`,
        buildingType: 'generic',
        name: def.label,
        position: { x: pos.x, y: pos.y },
        footprint: def.footprint,
        colliderRadius: def.footprint / 2,
        team: 'friendly',
        width: def.footprint + 14,
        height: def.footprint + 14
      });
      if (entity) {
        entity.constructionKind = commandKey;
        scene.entityStore?.add?.(entity);
      }
    } catch (error) {
      console.warn('[SceneArmyCommandFlow] 工程物实体生成失败', error?.message || error);
    }
  }

  /** 布局同步（ScenePanelLayout.onResize 调用）。 */
  onResize(width, height) {
    this.hud.layout?.(width, height);
  }

  update(deltaTime = 0) {
    this.system.setEnemies(this.scene.enemyEntities || []);
    this.system.update(deltaTime);
    this._syncUnits();
    this._handlePointer();
    this._handleGamepad();
  }

  /** 渲染入口（SceneRenderPipeline overlay 回调）：工程物自绘 + HUD。 */
  render(ctx) {
    this._drawConstructions(ctx);
    this.hud.render(ctx);
  }

  /** 工程物自绘：施工中=脚手架+进度，完成=按命令类型的色块造型（建筑实体负责碰撞）。 */
  _drawConstructions(ctx) {
    const camera = this.scene.camera;
    if (!camera?.worldToScreen) return;
    const constructions = this.system.constructions || [];
    if (!constructions.length && !this.system.constructionJob) return;
    ctx.save();
    for (const construction of constructions) {
      const screen = camera.worldToScreen(construction.pos.x, construction.pos.y);
      if (!screen) continue;
      const size = construction.footprint;
      ctx.fillStyle = construction.commandKey === 'pit' ? 'rgba(40, 30, 20, 0.8)'
        : construction.commandKey === 'camp' ? 'rgba(120, 90, 50, 0.85)'
        : 'rgba(110, 85, 55, 0.92)';
      ctx.strokeStyle = 'rgba(201, 162, 39, 0.8)';
      ctx.lineWidth = 1.5;
      if (construction.commandKey === 'caltrops') {
        // 鹿角：交叉木桩
        ctx.beginPath();
        ctx.moveTo(screen.x - size / 2, screen.y + size / 4);
        ctx.lineTo(screen.x + size / 2, screen.y - size / 4);
        ctx.moveTo(screen.x - size / 2, screen.y - size / 4);
        ctx.lineTo(screen.x + size / 2, screen.y + size / 4);
        ctx.moveTo(screen.x, screen.y - size / 2);
        ctx.lineTo(screen.x, screen.y + size / 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(screen.x, screen.y, size / 2, size / 2 * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    // 施工中：脚手架 + 进度环
    const job = this.system.constructionJob;
    if (job && !job.done) {
      const screen = camera.worldToScreen(job.pos.x, job.pos.y);
      if (screen) {
        const ratio = job.total > 0 ? 1 - job.countdown / job.total : 0;
        ctx.strokeStyle = 'rgba(201, 162, 39, 0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 18, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(screen.x - job.def.footprint / 2, screen.y - job.def.footprint / 2, job.def.footprint, job.def.footprint);
      }
    }
    ctx.restore();
  }

  /** 扫描实体仓库，把带 SquadMemberComponent 的未注册实体登记进编组。 */
  _syncUnits() {
    const entities = this.scene.entityStore?.all || [];
    for (const entity of entities) {
      const member = entity?.getComponent?.('squadMember');
      if (!member) continue;
      this.system.registerUnit(entity, member);
    }
  }

  _handlePointer() {
    const input = this.scene.inputManager;
    const camera = this.scene.camera;
    if (!input || !camera?.screenToWorld) { this._prevLeftHeld = false; return; }

    const button = input.getMouseButton?.();
    const leftHeld = button === 0;
    const screen = input.getMousePosition?.() || { x: 0, y: 0 };

    const isTouch = input.mouse?.isTouch === true;
    const world = camera.screenToWorld(screen.x, screen.y);
    const drag = this.dragState;

    // 左键按下沿：未被 HUD/交互消费时开始拖拽跟踪（触屏无框选）
    if (leftHeld && !this._prevLeftHeld) {
      const consumed = input.isMouseClickHandled?.() === true;
      drag.started = !consumed && !isTouch;
      drag.active = false;
      drag.touch = isTouch;
      drag.startX = screen.x;
      drag.startY = screen.y;
      drag.currentX = screen.x;
      drag.currentY = screen.y;
    } else if (leftHeld && drag.started) {
      drag.currentX = screen.x;
      drag.currentY = screen.y;
      if (!isTouch && Math.hypot(drag.currentX - drag.startX, drag.currentY - drag.startY) > DRAG_THRESHOLD_PX) {
        drag.active = true;
      }
    }

    // 左键释放沿：框选 / 点选 / 触屏点地下令 / 空地清选择
    if (this._prevLeftHeld && !leftHeld) {
      const wasConsumed = input.isMouseClickHandled?.() === true;
      if (drag.started && !wasConsumed) {
        if (drag.active && !drag.touch) {
          const minScreen = { x: Math.min(drag.startX, drag.currentX), y: Math.min(drag.startY, drag.currentY) };
          const maxScreen = { x: Math.max(drag.startX, drag.currentX), y: Math.max(drag.startY, drag.currentY) };
          const min = camera.screenToWorld(minScreen.x, minScreen.y);
          const max = camera.screenToWorld(maxScreen.x, maxScreen.y);
          this.system.selectUnitsInRect({ minX: min.x, minY: min.y, maxX: max.x, maxY: max.y });
        } else if (!drag.active) {
          this._handleSceneClick(world, drag.touch);
        }
      }
      drag.started = false;
      drag.active = false;
    }
    this._prevLeftHeld = leftHeld;
  }

  _handleSceneClick(worldPos, isTouch) {
    // 点中单位 → 自定义单选
    if (this.system.selectUnitAt(worldPos)) return;
    if (isTouch) {
      // 安卓无右键：选中编组时点空地 = 移动下令
      if (this.system.hasSquadSelection()) this.system.orderMove(worldPos);
      return;
    }
    this.system.clearSelection();
  }

  _handleGamepad() {
    const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads
      ? navigator.getGamepads()
      : [];
    const pad = [...gamepads].find(candidate => candidate?.connected);
    if (!pad) return;
    const pressed = new Set();
    pad.buttons.forEach((button, index) => { if (button?.pressed) pressed.add(index); });
    // LB：循环切换选择槽位
    if (pressed.has(GAMEPAD_CYCLE_FORWARD) && !this._prevPadButtons.has(GAMEPAD_CYCLE_FORWARD)) {
      this.system.cycleSelection(1);
    }
    // RB：循环切换待确认姿态（仅编组选择激活时）
    if (this.system.hasSquadSelection()
      && pressed.has(GAMEPAD_CYCLE_BACKWARD) && !this._prevPadButtons.has(GAMEPAD_CYCLE_BACKWARD)) {
      const stances = ARMY_STANCES.map(entry => entry.key);
      const current = stances.indexOf(this.system.pendingStance);
      this.system.pendingStance = stances[(current + 1) % stances.length];
    }
    // A：应用待确认姿态（仅编组选择激活且有待确认姿态时）
    if (this.system.hasSquadSelection() && this.system.pendingStance
      && pressed.has(GAMEPAD_CONFIRM) && !this._prevPadButtons.has(GAMEPAD_CONFIRM)) {
      this.system.applyStance(this.system.pendingStance);
    }
    this._prevPadButtons = pressed;
  }
}

export default SceneArmyCommandFlow;
