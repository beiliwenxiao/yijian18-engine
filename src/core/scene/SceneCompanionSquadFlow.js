/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * SceneCompanionSquadFlow - 随行小队场景装配流（模块 3 3A）
 *
 * 职责：
 * - 装配 CompanionGridHud（五档按钮 + 10×10 方格阵，uiClickHandler 接管点击）
 * - 扫描 SquadMemberComponent（armyId='companion'）同步名册与 ArmyCommandSystem 注册
 * - 五档：PC 数字键 1-5 / HUD 点选 → CompanionSquadSystem.setStance
 *   → ArmyCommandSystem.applyStanceToArmy('companion', stance)（姿态机执行跟随/接敌）
 * - 冲锋 4s 自动转进攻（CompanionSquadSystem.tick）
 * - 玩家倒地自动防守、起立恢复原档
 * - 阵亡补位：spawnMember → 从入场点复活/置位（无实体则放弃，兵源枯竭由领域层记账）
 * - 入档：storyState.companionSquad（变更即写，单一事实源）
 */
import { FramePhase } from './GameSceneRuntime.js';
import { COMPANION_ARMY_ID, COMPANION_STANCES } from '../../systems/CompanionSquadSystem.js';
import { CompanionGridHud } from '../../ui/CompanionGridHud.js';

/** PC 五档快捷键（1-5 → COMPANION_STANCES 顺序）。 */
const STANCE_HOTKEYS = ['1', '2', '3', '4', '5'];

export class SceneCompanionSquadFlow {
  /**
   * @param {Object} scene - 游戏场景
   * @param {Object} options
   * @param {Object} options.system - CompanionSquadSystem
   */
  constructor(scene, { system = null } = {}) {
    this.scene = scene;
    this.system = system;
    this.hud = new CompanionGridHud({ system });
    this.hud.visible = false;
    this._attached = false;
    this._prevDowned = false;
    this._appliedStance = system?.getStance?.() || 'escort';
    this._prevHotkeys = STANCE_HOTKEYS.map(() => false);
    this._dirty = true;
    this._lastLayoutSize = null;
    this._restored = false;
    /** @type {Map<string, Object>} 成员蓝图（补位实体被清理后按此重建） */
    this._blueprints = new Map();
  }

  /** 系统就绪后调用一次：注册 HUD 点击、帧更新与补位回调，并恢复入档名册。 */
  attach() {
    if (this._attached) return this;
    this._attached = true;
    const scene = this.scene;
    scene.uiClickHandler?.registerElement?.(this.hud);
    scene.sceneRuntime?.onFramePhase?.(FramePhase.AFTER_SCENE, deltaTime => this.update(deltaTime), 'companionSquad');
    this.onResize(scene.logicalWidth || 1280, scene.logicalHeight || 720);
    if (this.system) {
      this.system.spawnMember = (unitId, entry) => this._spawnReinforcement(unitId, entry);
    }
    this._restoreFromStoryState();
    this._dirty = true;
    return this;
  }

  /** 布局同步（ScenePanelLayout.onResize / applyUILayout 调用）。 */
  onResize(width, height) {
    this._lastLayoutSize = { width, height };
    this.hud.layout?.(width, height);
  }

  /** 面板编辑器矩形（与军队操作面板同款机制）。 */
  applyPanelDefinition(panelDefinition) {
    if (!panelDefinition) return false;
    this.hud?.setPanelDefinition?.(panelDefinition);
    if (this._lastLayoutSize) this.onResize(this._lastLayoutSize.width, this._lastLayoutSize.height);
    return true;
  }

  /** 渲染入口（SceneRenderPipeline overlay 回调）。 */
  render(ctx) {
    this.hud.render(ctx);
  }

  /** @param {number} deltaTime - 毫秒 */
  update(deltaTime = 0) {
    if (!this.system) return;
    this.syncRoster();
    this._handleHotkeys();
    this._handlePlayerDowned();
    const tick = this.system.tick(deltaTime);
    if (tick.chargeConverted || tick.reinforced.length > 0) this._dirty = true;
    this._forwardStance();
    this.hud.visible = this.system.getMemberCount() > 0;
    if (this._dirty) this._persist();
  }

  /**
   * 扫描实体仓库同步随行名册：新增成员注册进 ArmyCommandSystem 并加入名册，
   * 消失成员从名册移出；倒地/死亡状态回写领域层。
   */
  syncRoster() {
    const entities = this.scene.entityStore?.all || [];
    const present = new Set();
    const army = this._armySystem();
    for (const entity of entities) {
      const member = entity?.getComponent?.('squadMember');
      if (!member || member.armyId !== COMPANION_ARMY_ID) continue;
      present.add(entity.id);
      if (!this._blueprints.has(entity.id)) {
        this._blueprints.set(entity.id, {
          definitionId: entity.definitionId || entity.contentId || null,
          faction: entity.faction || null,
          name: entity.name || null,
          squadMember: {
            armyId: member.armyId,
            squadId: member.squadId || 'companion',
            formationIndex: member.formationIndex ?? 0
          }
        });
      }
      if (!this.system.unitIds.includes(entity.id)) {
        const assigned = this.system.assign([entity.id]);
        if (!assigned.ok) continue;
        this._dirty = true;
      }
      army?.registerUnit?.(entity, { ...member, armyId: COMPANION_ARMY_ID, squadId: 'companion' });
      if (entity.isDead === true) this.system.reportMemberKilled(entity.id);
      else if (entity.isDying === true || entity.isDowned === true) {
        this.system.reportMemberDowned(entity.id, { battleId: this._currentBattleId() });
      }
    }
    let removed = false;
    for (const id of [...this.system.unitIds]) {
      if (present.has(id)) continue;
      // 倒地成员实体被清理时保留在名册：8s 后由补位回调按蓝图重建（3B 接线）。
      // 永久阵亡/非倒地消失才真正移出名册。
      if (this.system.members?.get?.(id)?.state === 'downed') continue;
      this.system.dismiss([id]);
      this._blueprints.delete(id);
      removed = true;
    }
    if (removed) this._dirty = true;
  }

  _armySystem() {
    return this.scene.armyCommandFlow?.system || null;
  }

  _currentBattleId() {
    return this.scene.battleSystem?.definition?.battleId || 'field';
  }

  /** 数字键 1-5 → 五档（按下沿，避免按住连续切档）。 */
  _handleHotkeys() {
    const input = this.scene.inputManager;
    if (!input?.isKeyPressed) return;
    for (let index = 0; index < STANCE_HOTKEYS.length; index += 1) {
      const pressed = input.isKeyPressed(STANCE_HOTKEYS[index]) === true;
      if (pressed && !this._prevHotkeys[index]) {
        const stanceKey = COMPANION_STANCES[index]?.key;
        const result = stanceKey ? this.system.setStance(stanceKey) : { ok: false };
        if (result.ok) this._dirty = true;
      }
      this._prevHotkeys[index] = pressed;
    }
  }

  _handlePlayerDowned() {
    const downed = this.scene.isPlayerDowned?.() === true;
    if (downed === this._prevDowned) return;
    this._prevDowned = downed;
    this.system.setPlayerDowned(downed);
    this._dirty = true;
  }

  /** 档位变化 → 姿态机整军应用（跟随/进攻/防守/冲锋/撤退）。 */
  _forwardStance() {
    const stance = this.system.getStance();
    if (stance === this._appliedStance) return;
    this._appliedStance = stance;
    this._armySystem()?.applyStanceToArmy?.(COMPANION_ARMY_ID, stance);
    this._dirty = true;
  }

  /**
   * 补位：优先复活同名实体；实体已被清理时按蓝图经场景适配器重建（3B 接线），
   * 仍无定义/工厂则返回 false（领域层保留待补位记账，不静默丢弃）。
   */
  _spawnReinforcement(unitId) {
    const scene = this.scene;
    const entities = scene.entityStore?.all || [];
    const entity = entities.find(item => item?.id === unitId) || null;
    if (!entity) {
      const blueprint = this._blueprints.get(unitId) || null;
      const spawn = scene.spawnCompanionMember;
      if (!blueprint || typeof spawn !== 'function') return false;
      const created = spawn({ unitId, blueprint, position: this._entryPoint() });
      if (!created) return false;
      this._armySystem()?.registerUnit?.(created, {
        armyId: COMPANION_ARMY_ID,
        squadId: blueprint.squadMember?.squadId || 'companion',
        formationIndex: blueprint.squadMember?.formationIndex ?? 0
      });
      this._dirty = true;
      return true;
    }
    if (typeof entity.revive === 'function') entity.revive();
    entity.isDead = false;
    entity.isDying = false;
    entity.isDowned = false;
    entity.isDyingState = false;
    const transform = entity.getComponent?.('transform');
    const entry = this._entryPoint();
    if (transform?.position && entry) {
      transform.position.x = entry.x;
      transform.position.y = entry.y;
    }
    return true;
  }

  _entryPoint() {
    const scene = this.scene;
    const configured = scene.companionEntryPoint;
    if (configured && Number.isFinite(Number(configured.x)) && Number.isFinite(Number(configured.y))) {
      return { x: Number(configured.x), y: Number(configured.y) };
    }
    const playerTransform = scene.playerEntity?.getComponent?.('transform');
    if (!playerTransform?.position) return null;
    return { x: playerTransform.position.x, y: playerTransform.position.y + 56 };
  }

  _storyBlackboard() {
    return this.scene.gameLoader?.blackboard || null;
  }

  _restoreFromStoryState() {
    if (this._restored) return;
    this._restored = true;
    const board = this._storyBlackboard();
    const story = board?.get?.('storyState');
    const snapshot = story?.companionSquad;
    if (!snapshot) return;
    this.system.restore(snapshot);
    this._appliedStance = this.system.getStance();
    this._armySystem()?.applyStanceToArmy?.(COMPANION_ARMY_ID, this._appliedStance);
  }

  /** 标记待入档（命令层改动后调用；下一帧写 storyState.companionSquad）。 */
  requestPersist() {
    this._dirty = true;
  }

  _persist() {
    this._dirty = false;
    const board = this._storyBlackboard();
    if (!board?.get || !board?.set) return;
    const story = board.get('storyState') || {};
    board.set('storyState', { ...story, companionSquad: this.system.serialize() });
  }
}

export default SceneCompanionSquadFlow;
