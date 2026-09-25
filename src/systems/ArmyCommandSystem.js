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
const ORDER_MIN_DURATION = 0.6;
const ORDER_MAX_DURATION = 5;
const SOLDIER_BASE_SPEED = 90;    // 与士兵 stats.speed 对齐的倒计时估算基准

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
  flee:    { speedMultiplier: 1.5,  aggroRadius: 0,         leashRadius: 0,         engageWhileMove: false }
});

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
  }

  setCombatSystem(combatSystem) { this.combatSystem = combatSystem || null; }

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
      entity.addComponent(new CommandStateComponent({ stance: 'hold' }));
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

  /** 应用姿态命令到选中单位（hold 记录当前位置为驻守点）。返回受命单位数。 */
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
      }
    }
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

  /** 清空选择回到武将。 */
  clearSelection() {
    this.selectionSlot = 'commander';
    this.customSelection = null;
  }

  /**
   * 移动下令：为选中单位设置阵型偏移目标点（姿态机驱动移动），
   * 并启动命令达成倒计时。不改姿态。
   * @returns {{ok: boolean, code?: string, count?: number, duration?: number}}
   */
  orderMove(worldPos) {
    const units = this.getSelectedUnits();
    if (!units.length) return { ok: false, code: 'noSelection' };
    const goal = { x: Number(worldPos?.x) || 0, y: Number(worldPos?.y) || 0 };
    const points = this._formationPoints(goal, units);
    let maxDist = 0;
    units.forEach((entity, index) => {
      const command = entity.getComponent?.('commandState');
      const transform = entity.getComponent?.('transform');
      if (!command || !transform) return;
      const point = points[index] || goal;
      command.goal = { x: point.x, y: point.y };
      const dist = Math.hypot(point.x - transform.position.x, point.y - transform.position.y);
      if (dist > maxDist) maxDist = dist;
    });
    const duration = Math.min(
      ORDER_MAX_DURATION,
      Math.max(ORDER_MIN_DURATION, maxDist / SOLDIER_BASE_SPEED + 0.5)
    );
    this.activeOrder = {
      goal,
      duration,
      countdown: duration,
      unitIds: units.map(entity => entity.id),
      done: false
    };
    return { ok: true, count: units.length, duration };
  }

  /** 帧更新：搬运编排 + 姿态机 + 命令倒计时 + 建造作业。 */
  update(deltaTime = 0, now = Date.now()) {
    this.updateStances(now, deltaTime);
    this.updateOrderCountdown(deltaTime);
    this.updateConstruction(deltaTime);
  }

  /** 命令倒计时推进 + 达成判定（全部到位或倒计时归零）。 */
  updateOrderCountdown(deltaTime = 0) {
    const order = this.activeOrder;
    if (!order || order.done) return;
    order.countdown = Math.max(0, order.countdown - deltaTime);
    if (order.countdown <= 0 || this._allArrived(order)) order.done = true;
  }

  getActiveOrder() { return this.activeOrder; }

  /** MovementSystem 右键钩子：编组选择激活时右键=移动下令。 */
  tryHandleMoveOrder(camera) {
    const input = this.inputManager;
    if (!this.hasSquadSelection()) return false;
    if (!input?.isMouseClicked?.() || input.getMouseButton?.() !== 2 || input.isMouseClickHandled?.()) return false;
    const screen = input.getMousePosition();
    const worldPos = camera?.screenToWorld
      ? camera.screenToWorld(screen.x, screen.y)
      : (input.getMouseWorldPosition?.() || screen);
    const result = this.orderMove(worldPos);
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
