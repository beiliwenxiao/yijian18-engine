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
 * ArmyCommandSystem - 军团指挥系统
 *
 * M1：编组选择 + 点地移动 + 命令达成倒计时。
 * M2：攻击命令姿态机——6 姿态（全速进攻/原地防守/缓慢推进/稳步撤退/抢救伤员/快速逃命）
 *     的移动与接敌行为；士兵攻击经 CombatSystem.performAttack 走正规击杀链
 *     （伤害数字/尸体/战利品/enemy.killed 事件全自动）。
 * M4：抢救伤员搬运编排（setRescueTarget + rescue 姿态 → 拖运回营地/遇敌中断）。
 * 设计文档：.kiro/steering/army-command-design.md
 *
 * - 编制与选择两层分离：Army→Squad（前/后/左/中/右军）→Unit 为编制；
 *   武将(自己)/全军/五军 为选择过滤器；武将不编入 Squad、不响应军团命令（ARPG 自主权）。
 * - 命令达成倒计时：所有命令非瞬时生效——下令后进入执行窗口（倒计时），
 *   全部单位到位或倒计时归零后命令达成。
 * - 移动下令不改姿态，仅设临时阵型目标点；姿态决定途中行为与接敌规则。
 * - 特殊命令已收口：玩家 HUD 不再提供建造下令入口；鹿角/挖坑/筑城/扎营由
 *   场景触发器/任务经 startConstruction() 编程驱动（未来接入 scenario.command）。
 */
import { SquadMemberComponent } from '../ecs/components/SquadMemberComponent.js';
import { CommandStateComponent, ARMY_STANCES } from '../ecs/components/CommandStateComponent.js';

/** 选择槽位（编组条顺序，手柄循环切换顺序与此一致）。 */
export const ARMY_SELECTION_SLOTS = Object.freeze([
  { key: 'commander', label: '武将' },
  { key: 'all', label: '全军' },
  { key: 'qian', label: '前军' },
  { key: 'hou', label: '后军' },
  { key: 'zuo', label: '左军' },
  { key: 'zhong', label: '中军' },
  { key: 'you', label: '右军' }
]);

const FORMATION_SPACING_X = 44;
const FORMATION_SPACING_Y = 28;   // 2.5D y 压缩
const ARRIVE_RADIUS = 26;
const PICK_RADIUS = 30;
const SOLDIER_BASE_SPEED = 90;    // 士兵 stats.speed 缺省回退基准（搬运/姿态机速度用）

// ─── 战前预设（M5-3，设计文档 §11.1.6）─────────────────────
/** 预设可选姿态：跟随武将 + 玩家可见 4 姿态（§11.1.5 姿态收敛；flee=紧急按钮、rescue=剧情专用，不入预设）。 */
export const SQUAD_PRESET_OPTIONS = Object.freeze([
  { key: 'escort', label: '跟随' },
  { key: 'assault', label: '全速进攻' },
  { key: 'hold', label: '原地防守' },
  { key: 'advance', label: '缓慢推进' },
  { key: 'retreat', label: '稳步撤退' }
]);
const PRESET_STANCE_KEYS = new Set(SQUAD_PRESET_OPTIONS.map(option => option.key));

// ─── 搬运玩法（M4，设计文档 §2.3）─────────────────────────
const CARRY_FORM_RADIUS = 34;     // 搬运者需贴近伤员的担架位半径
const CARRY_MIN_CARRIERS = 2;     // 至少 2 名救援士兵到位才能抬运
const CARRY_SPEED_MULTIPLIER = 0.45; // 搬运慢速（速度锁定）
const CARRY_GOAL_RADIUS = 30;     // 伤员抵达救援目标点判定半径

/**
 * 姿态行为参数表（语义见设计文档 §2.2）：
 * - speedMultiplier  移动速度系数
 * - aggroRadius      接敌警戒半径（Infinity=全图索敌；0=不索敌）
 * - leashRadius      脱离追击半径（相对驻守点；Infinity=不脱锁）
 * - engageWhileMove  是否移动中反击（边撤边战）
 */
const STANCE_PROFILES = Object.freeze({
  assault: { speedMultiplier: 1.25, aggroRadius: Infinity, leashRadius: Infinity, engageWhileMove: false },
  hold:    { speedMultiplier: 1.0,  aggroRadius: 220,       leashRadius: 320,       engageWhileMove: false },
  advance: { speedMultiplier: 0.6,  aggroRadius: 260,       leashRadius: Infinity,  engageWhileMove: false },
  retreat: { speedMultiplier: 0.8,  aggroRadius: 160,       leashRadius: Infinity,  engageWhileMove: true },
  rescue:  { speedMultiplier: 0.9,  aggroRadius: 160,       leashRadius: Infinity,  engageWhileMove: false },
  garrison: { speedMultiplier: 1.0, aggroRadius: 260,       leashRadius: 480,       engageWhileMove: false },
  escort:  { speedMultiplier: 1.05, aggroRadius: 240,       leashRadius: 320,       engageWhileMove: false },
  flee:    { speedMultiplier: 1.5,  aggroRadius: 0,         leashRadius: 0,         engageWhileMove: false }
});

/** Tab 循环选择序列（M5，用户裁定含武将：军队无命令时快速切回武将本身）。 */
const SQUAD_SELECTION_CYCLE = Object.freeze(['commander', 'all', 'qian', 'zuo', 'zhong', 'you', 'hou']);

/** 意图指令的"集结"判定半径：右键点武将附近 = 回归跟随。 */
const INTENT_REGROUP_RADIUS = 80;
/** 跟随武将的最小距离（用户裁定 2-3 个身位，不贴身；身位≈士兵碰撞体 24-30px）。 */
const ESCORT_FOLLOW_MIN_DIST = 64;

/**
 * 特殊命令建造定义（收口后无玩家 HUD 入口）：
 * 由场景触发器/任务经 startConstruction() 编程驱动（放置点由任务数据给出）。
 */
export const ARMY_CONSTRUCTION_DEFS = Object.freeze([
  { key: 'caltrops', label: '鹿角', buildTime: 2, footprint: 26 },
  { key: 'pit', label: '挖坑', buildTime: 2.5, footprint: 30 },
  { key: 'fortify', label: '筑城', buildTime: 5, footprint: 44 },
  { key: 'camp', label: '扎营', buildTime: 4, footprint: 40 }
]);

const ATTACK_RANGE_PADDING = 8;

export class ArmyCommandSystem {
  /**
   * @param {Object} [config]
   * @param {Object|null} [config.camera] - 相机（worldToScreen 由 HUD 使用）
   */
  constructor({ camera = null } = {}) {
    this.camera = camera;
    this.combatSystem = null;
    /** @type {Array<Object>} 敌对实体候选（每帧由场景同步） */
    this.enemies = [];
    /** @type {Map<string, {entity: Object, armyId: string, squadId: string, formationIndex: number}>} */
    this.units = new Map();
    this.selectionSlot = 'commander';
    /** @type {Set<string>|null} 框选/点选的自定义单位集（entityId） */
    this.customSelection = null;
    /** @type {null|{goal:{x,y}, duration:number, countdown:number, unitIds:string[], done:boolean}} */
    this.activeOrder = null;
    /** 手柄命令面板的待确认姿态（RB 循环、A 确认） */
    this.pendingStance = null;
    /** 已完成的工程物（{id,commandKey,pos,footprint}）——isBlockedAt 阻挡源 */
    this.constructions = [];
    /** @type {null|{commandKey,def,pos:{x,y},phase:'moving'|'building',countdown,total,builders:string[],done:boolean}} */
    this.constructionJob = null;
    this._constructionSequence = 0;
    this.onConstructionComplete = null; // (commandKey,pos,def) => void，由场景注入生成工程物实体
    /** @type {null|{entity:Object, goal:{x,y}|null, regionId:string|null, carrying:boolean, velocity:{x,y}}} 搬运目标（倒地伤员，M4） */
    this.rescueTarget = null;
    /** 搬运完成/中断回调：(payload) => void，由场景注入（触发 enterRegion / 提示） */
    this.onRescueComplete = null;
    this.onRescueInterrupt = null;
    /** 武将实体提供器（escort 跟随锚点；场景装配注入，M5） */
    this._commanderProvider = null;
    /** @type {Record<string, string>} 战前预设：per 军默认战术姿态（M5-3，开战自动应用） */
    this.squadPresets = { qian: 'escort', zuo: 'escort', zhong: 'escort', you: 'escort', hou: 'escort' };
    /** 战斗态中预设是否已应用（战斗结束回 escort 时清位） */
    this.presetsActive = false;
  }

  setCombatSystem(combatSystem) { this.combatSystem = combatSystem || null; }

  /** 注入武将实体提供器（escort 跟随锚点；由场景装配设置）。 */
  setCommanderProvider(provider) { this._commanderProvider = typeof provider === 'function' ? provider : null; }

  _getCommander() {
    try {
      return this._commanderProvider?.() || null;
    } catch (error) {
      return null;
    }
  }

  /** 每帧由场景同步敌对实体候选（SceneArmyCommandFlow）。 */
  setEnemies(enemies) { this.enemies = Array.isArray(enemies) ? enemies : []; }

  /** 注册军团单位（placement soldier 生成后调用；幂等）。缺命令状态组件时补默认 hold。 */
  registerUnit(entity, { armyId = '', squadId = '', formationIndex = 0 } = {}) {
    if (!entity?.id || this.units.has(entity.id)) return false;
    this.units.set(entity.id, {
      entity,
      armyId: armyId || 'army.default',
      squadId: squadId || 'zhong',
      formationIndex: Math.max(0, Math.floor(Number(formationIndex) || 0))
    });
    if (entity.getComponent && !entity.getComponent('commandState')) {
      entity.addComponent(new CommandStateComponent({ stance: 'escort' }));
    }
    return true;
  }

  getUnitCount() { return this.units.size; }

  setSelection(slotKey) {
    if (!ARMY_SELECTION_SLOTS.some(slot => slot.key === slotKey)) return false;
    this.selectionSlot = slotKey;
    this.customSelection = null;
    return true;
  }

  getSelectionSlot() { return this.selectionSlot; }

  getSelectionLabel() {
    if (this.isCustomSelection()) return `已选 ${this.customSelection.size}`;
    return ARMY_SELECTION_SLOTS.find(slot => slot.key === this.selectionSlot)?.label || '武将';
  }

  /** 手柄切换单位键：沿槽位循环（step=1 正向 / -1 反向）。 */
  cycleSelection(step = 1) {
    const index = ARMY_SELECTION_SLOTS.findIndex(slot => slot.key === this.selectionSlot);
    const next = ((index === -1 ? 0 : index) + step + ARMY_SELECTION_SLOTS.length) % ARMY_SELECTION_SLOTS.length;
    this.setSelection(ARMY_SELECTION_SLOTS[next].key);
    return this.selectionSlot;
  }

  isCustomSelection() { return !!this.customSelection?.size; }

  /** 当前选中的单位实体列表（武将槽位返回空数组）。 */
  getSelectedUnits() {
    if (this.customSelection) {
      return [...this.customSelection].map(id => this.units.get(id)?.entity).filter(Boolean);
    }
    if (this.selectionSlot === 'commander') return [];
    if (this.selectionSlot === 'all') return [...this.units.values()].map(unit => unit.entity);
    return [...this.units.values()].filter(unit => unit.squadId === this.selectionSlot).map(unit => unit.entity);
  }

  /** 是否存在可受命的非武将选择。 */
  hasSquadSelection() { return this.getSelectedUnits().length > 0; }

  /** 选中单位们的公共姿态（一致才返回该姿态，否则 null）。 */
  getSelectedStance() {
    const units = this.getSelectedUnits();
    if (!units.length) return null;
    const first = units[0].getComponent?.('commandState')?.stance || 'hold';
    return units.every(unit => (unit.getComponent?.('commandState')?.stance || 'hold') === first) ? first : null;
  }

  /** 应用姿态命令到选中单位（hold 记录当前位置为驻守点）。发完自动回武将（M5 瞬态选择）。返回受命单位数。 */
  applyStance(stanceKey) {
    if (!STANCE_PROFILES[stanceKey]) return { ok: false, code: 'unknownStance' };
    const units = this.getSelectedUnits();
    if (!units.length) return { ok: false, code: 'noSelection' };
    for (const entity of units) {
      const command = entity.getComponent?.('commandState');
      if (!command) continue;
      command.stance = stanceKey;
      if (stanceKey === 'hold') {
        const transform = entity.getComponent?.('transform');
        command.post = transform ? { x: transform.position.x, y: transform.position.y } : null;
        command.goal = null;
      } else if (stanceKey === 'escort') {
        // 跟随武将：清残留目标/驻点，锚点由武将位置每帧驱动
        command.goal = null;
        command.post = null;
      }
    }
    this.clearSelection();
    return { ok: true, count: units.length, stance: stanceKey };
  }

  /** 点选单位：命中半径内最近的军团单位（无则 null）。 */
  pickUnitAt(worldPos, radius = PICK_RADIUS) {
    let best = null;
    let bestDist = Infinity;
    for (const unit of this.units.values()) {
      const transform = unit.entity.getComponent?.('transform');
      if (!transform) continue;
      const dist = Math.hypot(transform.position.x - worldPos.x, transform.position.y - worldPos.y);
      if (dist <= radius && dist < bestDist) { best = unit.entity; bestDist = dist; }
    }
    return best;
  }

  /** 框选：世界坐标矩形内命中的单位进入自定义选择；空框清空选择。返回命中数。 */
  selectUnitsInRect(rect) {
    const hit = [];
    for (const unit of this.units.values()) {
      const transform = unit.entity.getComponent?.('transform');
      if (!transform) continue;
      const { x, y } = transform.position;
      if (x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY) hit.push(unit.entity.id);
    }
    if (!hit.length) { this.clearSelection(); return 0; }
    this.customSelection = new Set(hit);
    return hit.length;
  }

  /** 单位点选：命中则进入自定义单选。返回是否命中。 */
  selectUnitAt(worldPos) {
    const entity = this.pickUnitAt(worldPos);
    if (!entity) return false;
    this.customSelection = new Set([entity.id]);
    return true;
  }

  /** 清空选择回到武将（默认态；含清除手柄待确认姿态）。 */
  clearSelection() {
    this.selectionSlot = 'commander';
    this.customSelection = null;
    this.pendingStance = null;
  }

  /**
   * 移动下令：为选中单位设置阵型偏移目标点（姿态机驱动移动）。
   * 不改姿态；命令达成=全部到位（用户裁定取消倒计时延迟）。
   * @returns {{ok: boolean, code?: string, count?: number}}
   */
  orderMove(worldPos) {
    const units = this.getSelectedUnits();
    if (!units.length) return { ok: false, code: 'noSelection' };
    const goal = { x: Number(worldPos?.x) || 0, y: Number(worldPos?.y) || 0 };
    const points = this._formationPoints(goal, units);
    units.forEach((entity, index) => {
      const command = entity.getComponent?.('commandState');
      const transform = entity.getComponent?.('transform');
      if (!command || !transform) return;
      const point = points[index] || goal;
      command.goal = { x: point.x, y: point.y };
    });
    this.activeOrder = {
      goal,
      unitIds: units.map(entity => entity.id),
      done: false
    };
    return { ok: true, count: units.length };
  }

  /** 帧更新：搬运编排 + 姿态机 + 命令达成判定 + 建造作业。 */
  update(deltaTime = 0, now = Date.now()) {
    this.updateStances(now, deltaTime);
    this.updateOrderProgress(deltaTime);
    this.updateConstruction(deltaTime);
  }

  // ─── 语义化意图指令（M5：点敌=进攻 / 点地=移动驻守 / 点武将=集结回归跟随） ──

  /** 点选敌人：点击世界坐标半径内最近的敌对实体（无则 null）。 */
  pickEnemyAt(worldPos, radius = 60) {
    let best = null;
    let bestDist = Infinity;
    for (const enemy of this.enemies) {
      if (!enemy || enemy.isDead || enemy.isDying) continue;
      if (enemy.faction === 'ally' || enemy.faction === 'friendly') continue;
      const transform = enemy.getComponent?.('transform');
      if (!transform) continue;
      const dist = Math.hypot(transform.position.x - worldPos.x, transform.position.y - worldPos.y);
      if (dist <= radius && dist < bestDist) { best = enemy; bestDist = dist; }
    }
    return best;
  }

  /**
   * 语义化意图指令：右键目标决定行为（M5 §11.1-2 + M4 救援）。
   * - 点倒地搬运目标（rescueTarget）→ 士兵切救援姿态去拖（≥2 贴身自动抬向营地）
   * - 点敌人 → 全速进攻冲向该敌
   * - 点武将附近（INTENT_REGROUP_RADIUS）→ 回归跟随（escort 集结）
   * - 点空地 → 移动到该点并原地驻守
   * 已处于 rescue 的单位不受影响（搬运任务优先，§11.2）。
   * 指令成功后自动清除选择回到武将（§11.1-3）。
   * @returns {{ok:boolean, code?:string, intent?:string, count?:number, duration?:number}}
   */
  orderIntent(worldPos) {
    const units = this.getSelectedUnits()
      .filter(entity => entity.getComponent?.('commandState')?.stance !== 'rescue');
    if (!units.length) return { ok: false, code: 'noSelection' };
    const goal = { x: Number(worldPos?.x) || 0, y: Number(worldPos?.y) || 0 };
    const rescueBodyTransform = this.rescueTarget?.entity?.getComponent?.('transform') || null;
    const rescueHit = rescueBodyTransform
      && Math.hypot(rescueBodyTransform.position.x - goal.x, rescueBodyTransform.position.y - goal.y) <= 60;
    const enemy = rescueHit ? null : this.pickEnemyAt(goal);
    const commander = this._getCommander();
    const commanderPos = commander?.getComponent?.('transform')?.position || null;
    let intent;
    let stance;
    let targetPoint;
    if (rescueHit) {
      intent = 'rescue';
      stance = 'rescue';
      targetPoint = { x: rescueBodyTransform.position.x, y: rescueBodyTransform.position.y };
    } else if (enemy) {
      intent = 'assault';
      stance = 'assault';
      const enemyTransform = enemy.getComponent?.('transform');
      targetPoint = enemyTransform ? { x: enemyTransform.position.x, y: enemyTransform.position.y } : { ...goal };
    } else if (commanderPos && Math.hypot(commanderPos.x - goal.x, commanderPos.y - goal.y) <= INTENT_REGROUP_RADIUS) {
      intent = 'regroup';
      stance = 'escort';
      targetPoint = null;
    } else {
      intent = 'hold';
      stance = 'hold';
      targetPoint = { ...goal };
    }
    units.forEach(entity => {
      const command = entity.getComponent?.('commandState');
      const transform = entity.getComponent?.('transform');
      if (!command || !transform) return;
      command.stance = stance;
      command.carryState = null;
      if (targetPoint) {
        command.goal = { ...targetPoint };
        if (stance === 'hold') command.post = { ...targetPoint };
      } else {
        command.goal = null;
        command.post = null; // escort：跟随点由武将位置每帧驱动
      }
    });
    if (intent !== 'regroup' && intent !== 'rescue') {
      this.activeOrder = {
        goal: { ...targetPoint },
        unitIds: units.map(entity => entity.id),
        done: false
      };
    }
    // 发完指令自动回武将（瞬态选择）
    this.clearSelection();
    return { ok: true, intent, count: units.length };
  }

  /** Tab 循环选择：全军→前军→左军→中军→右军→后军（武将是默认态不在序列内）。 */
  cycleSquadSelection() {
    const index = SQUAD_SELECTION_CYCLE.indexOf(this.selectionSlot);
    const next = SQUAD_SELECTION_CYCLE[(index + 1) % SQUAD_SELECTION_CYCLE.length];
    this.selectionSlot = next;
    this.customSelection = null;
    this.pendingStance = null;
    return next;
  }

  /** 命令达成判定（用户裁定取消倒计时延迟：仅以全部到位为达成）。 */
  updateOrderProgress(_deltaTime = 0) {
    const order = this.activeOrder;
    if (!order || order.done) return;
    if (this._allArrived(order)) order.done = true;
  }

  // ─── 战前预设（M5-3）：per 军默认战术姿态，开战自动应用 ──

  /**
   * 设置某军的战前预设姿态。
   * @returns {{ok: boolean, code?: string}}
   */
  setSquadPreset(squadId, stanceKey) {
    if (!(squadId in this.squadPresets)) return { ok: false, code: 'unknownSquad' };
    if (!PRESET_STANCE_KEYS.has(stanceKey)) return { ok: false, code: 'invalidPresetStance' };
    this.squadPresets[squadId] = stanceKey;
    return { ok: true };
  }

  getSquadPreset(squadId) { return this.squadPresets[squadId] || 'escort'; }

  getSquadPresets() { return { ...this.squadPresets }; }

  /** 预设应用时跳过忙碌单位：搬运任务优先（§11.2）、建造作业中不扰动。 */
  _isUnitBusyForPreset(unit) {
    const command = unit.entity.getComponent?.('commandState');
    if (!command) return true;
    if (command.stance === 'rescue' || command.carryState) return true;
    if (this.constructionJob && this.constructionJob.phase !== 'complete'
      && this.constructionJob.builders?.includes(unit.entity.id)) return true;
    return false;
  }

  /**
   * 开战瞬间应用战前预设：各军按预设切姿态（玩家手动指令仍是更高优先级覆盖，
   * 应用后玩家随时可下令改变个别单位行为）。
   * @returns {{ok: boolean, applied: number}}
   */
  applySquadPresets() {
    let applied = 0;
    for (const unit of this.units.values()) {
      if (this._isUnitBusyForPreset(unit)) continue;
      const command = unit.entity.getComponent?.('commandState');
      if (!command) continue;
      const stance = this.squadPresets[unit.squadId] || 'escort';
      command.stance = stance;
      command.carryState = null;
      if (stance === 'escort') {
        // 跟随：锚点由武将位置每帧驱动
        command.goal = null;
        command.post = null;
      } else if (stance === 'hold') {
        // 原地防守：就地驻守（开战位置即驻守点）
        const transform = unit.entity.getComponent?.('transform');
        command.goal = null;
        command.post = transform ? { x: transform.position.x, y: transform.position.y } : null;
      } else {
        // assault/advance/retreat：无固定目标，进入姿态机模式（assault 全图索敌自动迎敌）
        command.goal = null;
        command.post = null;
      }
      applied++;
    }
    this.presetsActive = true;
    return { ok: true, applied };
  }

  /** 战斗结束：所有空闲单位回归跟随武将（预设待下次开战再应用）。 */
  resetSquadsToEscort() {
    for (const unit of this.units.values()) {
      if (this._isUnitBusyForPreset(unit)) continue;
      const command = unit.entity.getComponent?.('commandState');
      if (!command) continue;
      command.stance = 'escort';
      command.goal = null;
      command.post = null;
    }
    this.presetsActive = false;
  }

  getActiveOrder() { return this.activeOrder; }

  /** MovementSystem 右键钩子：编组选择激活时右键=语义化意图指令（M5 §11.1-2）。 */
  tryHandleMoveOrder(camera) {
    const input = this.inputManager;
    if (!this.hasSquadSelection()) return false;
    if (!input?.isMouseClicked?.() || input.getMouseButton?.() !== 2 || input.isMouseClickHandled?.()) return false;
    const screen = input.getMousePosition();
    const worldPos = camera?.screenToWorld
      ? camera.screenToWorld(screen.x, screen.y)
      : (input.getMouseWorldPosition?.() || screen);
    const result = this.orderIntent(worldPos);
    if (!result.ok) return false;
    input.markMouseClickHandled?.();
    return true;
  }

  /** 注入 InputManager（tryHandleMoveOrder 需要；由场景装配设置）。 */
  setInputManager(inputManager) { this.inputManager = inputManager; }

  // ─── 特殊命令建造（收口：编程入口，供场景触发器/任务驱动） ─────────────────────────────

  /**
   * 任务驱动的建造作业：指定命令与放置点，units 为施工士兵（缺省全军）。
   * 士兵获得环绕建造点的阵型目标 → 到位后施工倒计时 → onConstructionComplete 回调。
   * @param {string} commandKey - ARMY_CONSTRUCTION_DEFS 中的命令 key
   * @param {{x:number,y:number}} worldPos - 放置点（由任务/触发器数据给出）
   * @param {Array<Object>} [units] - 施工单位（缺省全军）
   * @returns {{ok:boolean, code?:string, count?:number, phase?:string}}
   */
  startConstruction(commandKey, worldPos, units = null) {
    const def = ARMY_CONSTRUCTION_DEFS.find(command => command.key === commandKey);
    if (!def) return { ok: false, code: 'unknownCommand' };
    const builders = (units && units.length ? units : this.getSelectedUnits())
      .filter(entity => entity?.getComponent?.('commandState'));
    if (!builders.length) return { ok: false, code: 'noSelection' };
    // 士兵环绕建造点分布（建筑半径外）
    const ring = (def.footprint / 2) + 24;
    const points = this._formationPoints(worldPos, builders).map(point => {
      const dx = point.x - worldPos.x;
      const dy = point.y - worldPos.y;
      const dist = Math.hypot(dx, dy) || 1;
      return { x: worldPos.x + (dx / dist) * ring, y: worldPos.y + (dy / dist) * ring };
    });
    builders.forEach((entity, index) => {
      const command = entity.getComponent('commandState');
      command.goal = { ...points[index] };
    });
    this.constructionJob = {
      commandKey: def.key,
      def,
      pos: { x: worldPos.x, y: worldPos.y },
      phase: 'moving',
      countdown: def.buildTime,
      total: def.buildTime,
      builders: builders.map(entity => entity.id),
      done: false
    };
    return { ok: true, phase: 'moving', count: builders.length };
  }

  /** 建造作业推进：moving（任一士兵到位）→ building（倒计时）→ 完成（回调生成工程物）。 */
  updateConstruction(deltaTime = 0) {
    const job = this.constructionJob;
    if (!job || job.done) return;
    if (job.phase === 'moving') {
      const arrived = job.builders.some(id => {
        const unit = this.units.get(id);
        const transform = unit?.entity.getComponent?.('transform');
        const goal = unit?.entity.getComponent?.('commandState')?.goal;
        if (!transform || !goal) return false;
        return Math.hypot(transform.position.x - goal.x, transform.position.y - goal.y) <= ARRIVE_RADIUS;
      });
      if (arrived) job.phase = 'building';
      return;
    }
    job.countdown = Math.max(0, job.countdown - deltaTime);
    if (job.countdown <= 0) {
      job.done = true;
      this.constructions.push({
        id: `construction-${++this._constructionSequence}`,
        commandKey: job.commandKey,
        pos: { ...job.pos },
        footprint: job.def.footprint
      });
      const callback = this.onConstructionComplete;
      this.constructionJob = null;
      try {
        callback?.(job.commandKey, job.pos, job.def);
      } catch (error) {
        console.warn('[ArmyCommandSystem] onConstructionComplete failed', error?.message || error);
      }
    }
  }

  /** 工程物阻挡查询：坐标落在任一工程物占地区域内。 */
  isBlockedAt(x, y, margin = 0) {
    for (const construction of this.constructions) {
      if (Math.hypot(construction.pos.x - x, construction.pos.y - y) <= construction.footprint / 2 + margin) {
        return true;
      }
    }
    return false;
  }

  // ─── 姿态机（M2）+ 搬运编排（M4） ─────────────────────────────

  /** 注册搬运目标（倒地伤员实体）与救援目标点；幂等覆盖。 */
  setRescueTarget(entity, { goal = null, regionId = null } = {}) {
    if (!entity?.id) return false;
    this.rescueTarget = {
      entity,
      goal: goal && Number.isFinite(goal.x) && Number.isFinite(goal.y) ? { x: goal.x, y: goal.y } : null,
      regionId: regionId || null,
      carrying: false,
      velocity: { x: 0, y: 0 }
    };
    return true;
  }

  clearRescueTarget() { this.rescueTarget = null; }

  getRescueTarget() { return this.rescueTarget; }

  /** 当前救援姿态单位列表。 */
  getRescuers() {
    return [...this.units.values()]
      .filter(unit => unit.entity?.getComponent?.('commandState')?.stance === 'rescue'
        && unit.entity.isDead !== true && unit.entity.isDying !== true);
  }

  /** 每帧驱动所有单位的姿态行为（搬运编排先行，保证本帧担架位一致）。 */
  updateStances(now = Date.now(), deltaTime = 0) {
    if (!this.units.size) return;
    this._updateRescueMission(deltaTime);
    for (const unit of this.units.values()) {
      this._updateUnitStance(unit, now);
    }
  }

  /**
   * 搬运任务编排（M4 §2.3）：
   * - ≥2 名 rescue 姿态单位贴近伤员 → 进入搬运：伤员被拖向救援目标点（慢速）
   * - 任一救援单位警戒半径内遇敌 → 脱离搬运、放下伤员、全体切原地防守自动战斗
   * - 战后不自动恢复搬运（姿态已转 hold），需玩家重新下达抢救伤员
   * - 伤员抵达目标点 → onRescueComplete（场景触发 enterRegion 等剧情链）
   */
  _updateRescueMission(deltaTime = 0) {
    const rescue = this.rescueTarget;
    if (!rescue) return;
    const body = rescue.entity;
    const bodyTransform = body?.getComponent?.('transform');
    if (!body || body.isDead === true || body.isDying === true || !bodyTransform) {
      this.rescueTarget = null;
      return;
    }
    const rescuers = this.getRescuers();
    if (!rescuers.length) {
      if (rescue.carrying) rescue.carrying = false;
      return;
    }
    // 遇敌中断：搬运与接近阶段一致处理（放下伤员、切原地防守）
    for (const unit of rescuers) {
      const position = unit.entity.getComponent('transform')?.position;
      if (position && this._nearestEnemy(position, STANCE_PROFILES.rescue.aggroRadius)) {
        this._breakRescue(rescuers);
        return;
      }
    }
    const inPosition = rescuers.filter(unit => {
      const transform = unit.entity.getComponent('transform');
      return transform
        && Math.hypot(transform.position.x - bodyTransform.position.x, transform.position.y - bodyTransform.position.y) <= CARRY_FORM_RADIUS;
    });
    if (inPosition.length < CARRY_MIN_CARRIERS) {
      if (rescue.carrying) {
        // 人手不足（伤亡/被调离）：放下伤员，等待重新凑齐
        rescue.carrying = false;
        rescue.velocity = { x: 0, y: 0 };
        this._clearCarryStates();
      }
      return;
    }
    rescue.carrying = true;
    for (const unit of inPosition) {
      const command = unit.entity.getComponent('commandState');
      if (command) command.carryState = 'carrying';
    }
    if (!rescue.goal) { rescue.velocity = { x: 0, y: 0 }; return; }
    const dx = rescue.goal.x - bodyTransform.position.x;
    const dy = rescue.goal.y - bodyTransform.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= CARRY_GOAL_RADIUS) {
      this._completeRescue();
      return;
    }
    // 拖动伤员：直接驱动 transform（AFTER_SCENE 阶段写入，下一帧相机跟随）
    const speed = SOLDIER_BASE_SPEED * CARRY_SPEED_MULTIPLIER;
    const step = Math.min(dist, speed * Math.max(0, deltaTime));
    rescue.velocity = { x: (dx / dist) * speed, y: (dy / dist) * speed };
    bodyTransform.position.x += (dx / dist) * step;
    bodyTransform.position.y += (dy / dist) * step;
  }

  /** 遇敌中断：放下伤员（留在原地），全体救援单位切原地防守自动战斗。 */
  _breakRescue(rescuers) {
    for (const unit of rescuers) {
      const command = unit.entity.getComponent?.('commandState');
      if (!command) continue;
      const transform = unit.entity.getComponent?.('transform');
      command.stance = 'hold';
      command.goal = null;
      command.carryState = null;
      command.post = transform ? { x: transform.position.x, y: transform.position.y } : command.post;
    }
    if (this.rescueTarget) this.rescueTarget.carrying = false;
    const payload = { regionId: this.rescueTarget?.regionId || null };
    try {
      this.onRescueInterrupt?.(payload);
    } catch (error) {
      console.warn('[ArmyCommandSystem] onRescueInterrupt failed', error?.message || error);
    }
  }

  /** 搬运完成：伤员抵达目标点，救援单位就地驻守，清空搬运任务并回调剧情。 */
  _completeRescue() {
    const rescue = this.rescueTarget;
    for (const unit of this.getRescuers()) {
      const command = unit.entity.getComponent?.('commandState');
      if (!command) continue;
      const transform = unit.entity.getComponent?.('transform');
      command.stance = 'hold';
      command.goal = null;
      command.carryState = null;
      command.post = transform ? { x: transform.position.x, y: transform.position.y } : command.post;
    }
    if (rescue) {
      const bodyMovement = rescue.entity?.getComponent?.('movement');
      if (bodyMovement) bodyMovement.velocity = { x: 0, y: 0 };
      this.rescueTarget = null;
    }
    const payload = { regionId: rescue?.regionId || null, goal: rescue?.goal ? { ...rescue.goal } : null };
    try {
      this.onRescueComplete?.(payload);
    } catch (error) {
      console.warn('[ArmyCommandSystem] onRescueComplete failed', error?.message || error);
    }
  }

  _clearCarryStates() {
    for (const unit of this.units.values()) {
      const command = unit.entity?.getComponent?.('commandState');
      if (command?.carryState) command.carryState = null;
    }
  }

  _updateUnitStance(unit, now) {
    const { entity } = unit;
    const command = entity.getComponent?.('commandState');
    const transform = entity.getComponent?.('transform');
    const movement = entity.getComponent?.('movement');
    if (!command || !transform || !movement) return;
    const stance = command.stance;
    const profile = STANCE_PROFILES[stance] || STANCE_PROFILES.hold;

    // 建造作业优先：builder 在施工期间忽略姿态（moving 朝建造点，building 站定施工）
    const job = this.constructionJob;
    if (job && !job.done && job.builders.includes(entity.id)) {
      if (job.phase === 'moving' && command.goal) {
        this._moveTowards(entity, command.goal, 1.0);
      } else {
        this._stop(entity);
      }
      return;
    }

    // 到达移动下令点 → 清除 goal（hold/rescue 记为驻守点）
    if (command.goal) {
      const d = Math.hypot(command.goal.x - transform.position.x, command.goal.y - transform.position.y);
      if (d <= ARRIVE_RADIUS) {
        if (stance === 'hold' || stance === 'rescue') command.post = { ...command.goal };
        command.goal = null;
      }
    }

    // 快速逃命：远离最近敌人，永不接战；无威胁时执行移动目标
    if (stance === 'flee') {
      const threat = this._nearestEnemy(transform.position, Infinity);
      if (threat) {
        this._moveAwayFrom(entity, threat.getComponent('transform').position, profile.speedMultiplier);
        return;
      }
      if (command.goal) { this._moveTowards(entity, command.goal, profile.speedMultiplier); return; }
      this._stop(entity);
      return;
    }

    // 抢救伤员（M4）：接近倒地单位；搬运中担架位贴行跟随
    if (stance === 'rescue') {
      this._updateRescueBehaviour(entity, command, transform, movement, profile, now);
      return;
    }

    // 跟随武将（M5 默认态）：阵型偏移锚点=武将位置，敌进警戒范围接战，脱离回归
    if (stance === 'escort') {
      this._updateEscortBehaviour(entity, command, transform, movement, profile, now);
      return;
    }

    const target = this._nearestEnemy(transform.position, profile.aggroRadius);

    // 原地防守：敌超出驻守点脱离半径 → 无视威胁，回到驻守点
    if (stance === 'hold' && target && command.post) {
      const enemyTransform = target.getComponent?.('transform');
      const enemyLeash = enemyTransform
        ? Math.hypot(enemyTransform.position.x - command.post.x, enemyTransform.position.y - command.post.y)
        : Infinity;
      if (enemyLeash > profile.leashRadius) {
        this._holdBehaviour(entity, command, transform, movement, profile, now, false);
        return;
      }
    }

    // 接敌：攻击范围内 → 停下攻击（retreat 边撤边战：攻击不打断移动）
    if (target) {
      const targetTransform = target.getComponent?.('transform');
      const attackRange = (entity.getComponent?.('combat')?.attackRange || 40) + ATTACK_RANGE_PADDING;
      const enemyDist = targetTransform
        ? Math.hypot(targetTransform.position.x - transform.position.x, targetTransform.position.y - transform.position.y)
        : Infinity;
      if (enemyDist <= attackRange) {
        if (!profile.engageWhileMove) this._stop(entity);
        else if (command.goal) this._moveTowards(entity, command.goal, profile.speedMultiplier);
        this._performAttackIfReady(entity, target, now);
        return;
      }
      // 警戒范围内但未接敌：assault/advance 主动追击
      if (stance === 'assault' || stance === 'advance') {
        const chaseGoal = targetTransform.position;
        this._moveTowards(entity, chaseGoal, profile.speedMultiplier);
        return;
      }
      // retreat：有移动目标继续撤（engageWhileMove 已处理攻击）；无敌情目标 → 撤
    }

    // 无敌情：执行移动目标或回驻守点
    if (command.goal) {
      this._moveTowards(entity, command.goal, profile.speedMultiplier);
      return;
    }
    if (stance === 'assault' || stance === 'advance') {
      // 无敌无目标：原地待命
      this._stop(entity);
      return;
    }
    this._holdBehaviour(entity, command, transform, movement, profile, now, false);
  }

  /** 驻守行为：偏离驻守点则回归，否则停止。 */
  _holdBehaviour(entity, command, transform, movement, profile, now, engageWhileMove = false) {
    if (command.goal) {
      this._moveTowards(entity, command.goal, profile.speedMultiplier);
      return;
    }
    if (!command.post) {
      command.post = { x: transform.position.x, y: transform.position.y };
      return;
    }
    const dist = Math.hypot(command.post.x - transform.position.x, command.post.y - transform.position.y);
    if (dist > ARRIVE_RADIUS) {
      this._moveTowards(entity, command.post, profile.speedMultiplier);
      return;
    }
    this._stop(entity);
  }

  /** 抢救伤员行为（M4）：无任务目标时保位；有目标则接近，搬运中担架位贴行。 */
  _updateRescueBehaviour(entity, command, transform, movement, profile, now) {
    const rescue = this.rescueTarget;
    const bodyTransform = rescue?.entity?.getComponent?.('transform');
    if (!rescue || !bodyTransform) {
      this._holdBehaviour(entity, command, transform, movement, profile, now, true);
      return;
    }
    const dist = Math.hypot(bodyTransform.position.x - transform.position.x, bodyTransform.position.y - transform.position.y);
    if (rescue.carrying && dist <= CARRY_FORM_RADIUS + 12) {
      // 担架位：跟随伤员移动方向行走，保持抬运队形
      const velocity = rescue.velocity || { x: 0, y: 0 };
      if (Math.hypot(velocity.x, velocity.y) > 1) {
        movement.velocity = { x: velocity.x, y: velocity.y };
        entity.getComponent?.('sprite')?.playAnimation?.('walk');
      } else {
        this._stop(entity);
      }
      return;
    }
    this._moveTowards(entity, bodyTransform.position, profile.speedMultiplier);
  }

  /**
   * 跟随武将行为（M5 默认态）：武将位置为阵型锚点，敌入警戒范围且未脱离锚点 leash 时接战，
   * 其余时间回到个人跟随点（武将位置 + 阵型偏移）；无武将时退化为驻守。
   */
  _updateEscortBehaviour(entity, command, transform, movement, profile, now) {
    const commander = this._getCommander();
    const commanderTransform = commander?.getComponent?.('transform');
    if (!commanderTransform) {
      this._holdBehaviour(entity, command, transform, movement, profile, now, false);
      return;
    }
    const anchor = commanderTransform.position;
    const target = this._nearestEnemy(transform.position, profile.aggroRadius);
    if (target) {
      const enemyTransform = target.getComponent?.('transform');
      const attackRange = (entity.getComponent?.('combat')?.attackRange || 40) + ATTACK_RANGE_PADDING;
      const enemyDist = enemyTransform
        ? Math.hypot(enemyTransform.position.x - transform.position.x, enemyTransform.position.y - transform.position.y)
        : Infinity;
      const anchorLeash = enemyTransform
        ? Math.hypot(enemyTransform.position.x - anchor.x, enemyTransform.position.y - anchor.y)
        : Infinity;
      // 敌已进入攻击范围且未把战线拉离武将 → 站定接战
      if (enemyDist <= attackRange && anchorLeash <= profile.leashRadius) {
        this._stop(entity);
        this._performAttackIfReady(entity, target, now);
        return;
      }
    }
    const followPoint = this._escortFollowPoint(entity);
    const dist = Math.hypot(followPoint.x - transform.position.x, followPoint.y - transform.position.y);
    if (dist > ARRIVE_RADIUS) {
      this._moveTowards(entity, followPoint, profile.speedMultiplier);
      return;
    }
    this._stop(entity);
  }

  /** 个人跟随点：武将位置周围按 escort 单位注册序展开的阵型偏移，
   *  并保持最小跟随距离（用户裁定：士兵跟随武将时隔 2-3 个身位，不贴身）。 */
  _escortFollowPoint(entity) {
    const commander = this._getCommander();
    const anchor = commander?.getComponent?.('transform')?.position || { x: 0, y: 0 };
    const escorts = [...this.units.values()]
      .filter(unit => unit.entity?.getComponent?.('commandState')?.stance === 'escort'
        && unit.entity.isDead !== true && unit.entity.isDying !== true)
      .map(unit => unit.entity);
    const index = Math.max(0, escorts.indexOf(entity));
    const points = this._formationPoints(anchor, escorts);
    const point = points[index] || anchor;
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    const dist = Math.hypot(dx, dy);
    if (dist < ESCORT_FOLLOW_MIN_DIST) {
      // 阵型点贴着武将时沿自身方向外推到最小跟随距离；正中者默认落在武将身后
      const dirX = dist > 0.01 ? dx / dist : 0;
      const dirY = dist > 0.01 ? dy / dist : 1;
      return { x: anchor.x + dirX * ESCORT_FOLLOW_MIN_DIST, y: anchor.y + dirY * ESCORT_FOLLOW_MIN_DIST };
    }
    return point;
  }

  _moveTowards(entity, target, speedMultiplier = 1) {
    const movement = entity.getComponent?.('movement');
    const transform = entity.getComponent?.('transform');
    if (!movement || !transform) return;
    const dx = target.x - transform.position.x;
    const dy = target.y - transform.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) { this._stop(entity); return; }
    const speed = (movement.speed || SOLDIER_BASE_SPEED) * speedMultiplier;
    movement.velocity = { x: (dx / dist) * speed, y: (dy / dist) * speed };
    entity.getComponent?.('sprite')?.playAnimation?.('walk');
  }

  _moveAwayFrom(entity, threatPos, speedMultiplier = 1) {
    const movement = entity.getComponent?.('movement');
    const transform = entity.getComponent?.('transform');
    if (!movement || !transform) return;
    const dx = transform.position.x - threatPos.x;
    const dy = transform.position.y - threatPos.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = (movement.speed || SOLDIER_BASE_SPEED) * speedMultiplier;
    movement.velocity = { x: (dx / dist) * speed, y: (dy / dist) * speed };
    entity.getComponent?.('sprite')?.playAnimation?.('walk');
  }

  _stop(entity) {
    const movement = entity.getComponent?.('movement');
    if (movement) movement.velocity = { x: 0, y: 0 };
    entity.getComponent?.('sprite')?.playAnimation?.('idle');
  }

  _nearestEnemy(position, maxRadius) {
    if (maxRadius <= 0) return null;
    let best = null;
    let bestDist = Infinity;
    for (const enemy of this.enemies) {
      if (!enemy || enemy.isDead || enemy.isDying) continue;
      if (enemy.faction === 'ally' || enemy.faction === 'friendly') continue;
      const transform = enemy.getComponent?.('transform');
      if (!transform) continue;
      const dist = Math.hypot(transform.position.x - position.x, transform.position.y - position.y);
      if (dist <= maxRadius && dist < bestDist) { best = enemy; bestDist = dist; }
    }
    return best;
  }

  /** 冷却与攻击动画由 CombatComponent/performAttack 内部管理；击杀链全自动触发。 */
  _performAttackIfReady(entity, target, now) {
    if (!this.combatSystem || !target) return;
    try {
      this.combatSystem.performAttack(entity, target, now);
    } catch (error) {
      console.warn('[ArmyCommandSystem] performAttack failed', error?.message || error);
    }
  }

  _allArrived(order) {
    for (const id of order.unitIds) {
      const unit = this.units.get(id);
      const transform = unit?.entity.getComponent?.('transform');
      if (!transform) continue;
      if (Math.hypot(transform.position.x - order.goal.x, transform.position.y - order.goal.y) > ARRIVE_RADIUS) {
        return false;
      }
    }
    return true;
  }

  /** 阵型偏移点：目标点为中心的网格分布，同分队相邻。 */
  _formationPoints(goal, units) {
    const count = units.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    const rows = Math.ceil(count / cols);
    const startX = goal.x - ((Math.min(count, cols) - 1) * FORMATION_SPACING_X) / 2;
    const startY = goal.y - ((rows - 1) * FORMATION_SPACING_Y) / 2;
    const sorted = [...units].sort((a, b) => {
      const memberA = a.getComponent?.('squadMember');
      const memberB = b.getComponent?.('squadMember');
      return (memberA?.squadId || '').localeCompare(memberB?.squadId || '')
        || (memberA?.formationIndex || 0) - (memberB?.formationIndex || 0);
    });
    return sorted.map((_, index) => ({
      x: startX + (index % cols) * FORMATION_SPACING_X,
      y: startY + Math.floor(index / cols) * FORMATION_SPACING_Y
    }));
  }
}

export { SquadMemberComponent, CommandStateComponent, ARMY_STANCES };
export default ArmyCommandSystem;
