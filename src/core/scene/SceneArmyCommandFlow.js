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
 * SceneArmyCommandFlow - 武装单位行为内核装配流（军团体系 v2 两层级）
 *
 * 职责（2026-11-17 收敛：旧 M5 编组玩家入口退役，以新随行小队五档为准）：
 * - 装配 ArmyCommandSystem 行为内核（阵型偏移/姿态机/搬运/建造/命令倒计时）
 * - 扫描 entityStore 中带 SquadMemberComponent 的实体并注册（玩家军）
 * - 玩家指挥入口 = 随行小队五档（CompanionGridHud，SceneCompanionSquadFlow）；
 *   旧编组选择槽循环（Tab/手柄 LB/框选/点选/编组 HUD）已退役
 * - 建造作业由任务/触发器经 ArmyCommandSystem.startConstruction() 驱动，
 *   完成后经 onConstructionComplete 生成工程物实体（渲染层自绘外观）
 */
import { FramePhase } from './GameSceneRuntime.js';
import { ArmyCommandSystem } from '../../systems/ArmyCommandSystem.js';

export class SceneArmyCommandFlow {
  /**
   * @param {Object} scene - 游戏场景（需 entityStore/inputManager/camera/sceneRuntime/movementSystem）
   */
  constructor(scene) {
    this.scene = scene;
    this.system = new ArmyCommandSystem({ camera: scene.camera || null });
    /** 已套用内容库 defaultStance 的分队（避免每帧覆盖）。 */
    this._defaultStanceApplied = new Set();
    this._prevInCombat = false;
    this._attached = false;
  }

  /** 系统就绪后调用一次：帧更新钩子，并接管 MovementSystem 右键。 */
  attach() {
    if (this._attached) return this;
    this._attached = true;
    const scene = this.scene;
    this.system.setInputManager?.(scene.inputManager || null);
    this.system.setCombatSystem?.(scene.combatSystem || null);
    this.system.setCommanderProvider?.(() => scene.playerEntity || null);
    // 旧编组 HUD 已退役：可见性门控恒放行（内核行为不再依赖 HUD 状态）
    this.system.setHudVisibleProvider?.(() => true);
    this._enableBuildingCollision(scene);
    this.system.onConstructionComplete = (commandKey, pos, def) => this._spawnConstructionEntity(commandKey, pos, def);
    scene.movementSystem && (scene.movementSystem.armyCommandSystem = this.system);
    scene.sceneRuntime?.onFramePhase?.(FramePhase.AFTER_SCENE, deltaTime => this.update(deltaTime), 'armyCommand');
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

  update(deltaTime = 0) {
    this.system.setEnemies(this.scene.enemyEntities || []);
    this._handleCombatEdge();
    this.system.update(deltaTime);
    this.syncUnits();
  }

  /**
   * 战斗态沿检测（战前预设）：开战瞬间应用内容库 per 军预设姿态，
   * 战斗结束全员回归跟随武将。无预设（全跟随）时应用为幂等无感。
   */
  _handleCombatEdge() {
    const inCombat = this.system.combatSystem?.isInCombat?.() === true;
    if (inCombat === this._prevInCombat) return;
    this._prevInCombat = inCombat;
    if (inCombat) this.system.applySquadPresets();
    else this.system.resetSquadsToEscort();
  }

  /** 渲染入口（SceneRenderPipeline overlay 回调）：工程物自绘（HUD 已由随行小队团队框接管）。 */
  render(ctx) {
    this._drawConstructions(ctx);
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

  /** 扫描实体仓库，把带 SquadMemberComponent 的未注册实体登记进编组（幂等，可外部提前调用）。 */
  syncUnits() {
    const entities = this.scene.entityStore?.all || [];
    const armies = this.scene.gameLoader?.registries?.armies;
    for (const entity of entities) {
      const member = entity?.getComponent?.('squadMember');
      if (!member) continue;
      // 归属过滤：owner 缺省＝玩家军；显式声明非 player 的编制（如张角亲军）不进入玩家指挥
      const owner = armies?.get?.(member.armyId)?.owner;
      if (typeof owner === 'string' && owner !== 'player') continue;
      this.system.registerUnit(entity, member);
    }
    this._applyArmyDefaultStances();
  }

  /**
   * 内容库 armies 定义的 defaultStance → 该军各分队的战前预设姿态
   * （预设机制的默认值来源，开战沿检测时由 applySquadPresets 应用）。
   * 规则：只在该分队预设仍是初始「跟随」时套用。
   */
  _applyArmyDefaultStances() {
    const armies = this.scene.gameLoader?.registries?.armies;
    if (!armies?.get) return;
    for (const unit of this.system.units.values()) {
      const squadId = unit.squadId;
      if (!squadId || this._defaultStanceApplied.has(squadId)) continue;
      this._defaultStanceApplied.add(squadId);
      if (this.system.getSquadPreset(squadId) !== 'escort') continue;
      const stance = unit.armyId ? armies.get(unit.armyId)?.defaultStance : null;
      if (typeof stance !== 'string' || stance.length === 0) continue;
      const result = this.system.setSquadPreset(squadId, stance);
      if (result?.ok !== true) {
        console.warn('[SceneArmyCommandFlow] armies.defaultStance 非法，未套用', unit.armyId, stance, result?.code || '');
      }
    }
  }
}

export default SceneArmyCommandFlow;
