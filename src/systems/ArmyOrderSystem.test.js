/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-11-10
 ************************************************************/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArmyOrderSystem,
  ARMY_ORDER_TYPES,
  ARMY_TACTICAL_RETREAT,
  DEPLOYMENT_LOCKED
} from './ArmyOrderSystem.js';
import { BattleMode } from './BattleSystem.js';

/** 构造带事件收集的系统。 */
function makeSystem(options = {}) {
  const events = [];
  const system = new ArmyOrderSystem({
    now: () => 1000,
    getDay: () => 7,
    onEvent: (event, payload) => events.push({ event, payload }),
    ...options
  });
  return { system, events };
}

function registerArmy(system, overrides = {}) {
  return system.registerUnit({
    id: 'army.s02.guard',
    kind: 'army',
    factionId: 'yellow-turban',
    sceneId: 'S02',
    position: { x: 0, y: 0 },
    roster: { unitIds: ['u1', 'u2'], dead: [] },
    formationId: 'line',
    ...overrides
  });
}

describe('ArmyOrderSystem 战略指令（M3 3B）', () => {
  let system;
  let events;

  beforeEach(() => {
    ({ system, events } = makeSystem());
    registerArmy(system);
    events.length = 0;
  });

  it('armyStates：四 kind 注册/幂等补齐/disband 事件', () => {
    const again = registerArmy(system);
    expect(again.ok).toBe(true);
    expect(again.created).toBe(false); // 已注册 → 只补齐
    const city = system.registerUnit({ id: 'city.s12', kind: 'city' });
    expect(city.created).toBe(true);
    expect(system.getUnit('city.s12').kind).toBe('city');
    const formed = system.registerUnit({ id: 'pass.s03', kind: 'pass' });
    expect(formed.created).toBe(true);
    expect(system.getUnit('pass.s03').kind).toBe('pass');
    expect(events.some(entry => entry.event === 'army.formed')).toBe(true);
    expect(system.disbandUnit('pass.s03').ok).toBe(true);
    expect(events.some(entry => entry.event === 'army.disbanded')).toBe(true);
    expect(system.disbandUnit('pass.s03').code).toBe('unknownUnit');
  });

  it('五指令：attack/move 需目标、defend/camp 免目标、未知指令拒绝', () => {
    expect(ARMY_ORDER_TYPES).toEqual(['attack', 'defend', 'transport', 'move', 'camp']);
    expect(system.issueOrder({ unitId: 'army.s02.guard', order: 'attack' }).code).toBe('targetRequired');
    expect(system.issueOrder({ unitId: 'army.s02.guard', order: 'attack', target: { x: 100, y: 0 } }).ok)
      .toBe(true);
    expect(system.issueOrder({ unitId: 'army.s02.guard', order: 'defend' }).ok).toBe(true);
    expect(system.issueOrder({ unitId: 'army.s02.guard', order: 'camp', target: { x: 30, y: 0 } }).ok)
      .toBe(true);
    expect(system.issueOrder({ unitId: 'army.s02.guard', order: 'dance' }).code).toBe('unknownOrder');
    expect(system.issueOrder({ unitId: 'no.such', order: 'defend' }).code).toBe('unknownUnit');
  });

  it('同单位单指令：新指令覆盖旧指令（replaced=true）', () => {
    system.issueOrder({ unitId: 'army.s02.guard', order: 'attack', target: { x: 100, y: 0 } });
    const second = system.issueOrder({
      unitId: 'army.s02.guard', order: 'move', target: { x: 200, y: 50 }
    });
    expect(second.ok).toBe(true);
    expect(second.order.type).toBe('move');
    expect(second.order.target).toEqual({ x: 200, y: 50 });
    const state = system.getUnit('army.s02.guard');
    expect(state.order.type).toBe('move');
    expect(events.filter(entry => entry.event === 'unit.orderIssued').length).toBe(2);
  });

  it('500ms 战略刻：按 deltaMs 累积推进、抵达发 orderCompleted', () => {
    system.issueOrder({ unitId: 'army.s02.guard', order: 'move', target: { x: 300, y: 0 } });
    // 不足一刻：不推进
    expect(system.tick(200).steps).toBe(0);
    expect(system.getUnit('army.s02.guard').position.x).toBe(0);
    // 补满一刻：120px/s × 0.5s = 60
    expect(system.tick(300).steps).toBe(1);
    expect(system.getUnit('army.s02.guard').position.x).toBeCloseTo(60);
    expect(system.getUnit('army.s02.guard').order.progress).toBeCloseTo(0.2);
    // 走完全程（再 4 刻）→ 完成事件
    system.tick(2000);
    expect(system.getUnit('army.s02.guard').order).toBeNull();
    const completed = events.find(entry => entry.event === 'unit.orderCompleted');
    expect(completed).toBeTruthy();
    expect(completed.payload.order.type).toBe('move');
    expect(system.getUnit('army.s02.guard').position.x).toBeCloseTo(300);
  });

  it('遭遇：encounterDetector 命中只发一次 unit.encounterResolved', () => {
    const { system: encounterSystem, events: encounterEvents } = makeSystem({
      encounterDetector: () => ({ type: 'battle', enemyCount: 3 })
    });
    registerArmy(encounterSystem);
    encounterSystem.issueOrder({ unitId: 'army.s02.guard', order: 'move', target: { x: 300, y: 0 } });
    encounterSystem.tick(500);
    encounterSystem.tick(500);
    expect(encounterEvents.filter(entry => entry.event === 'unit.encounterResolved').length).toBe(1);
  });

  it('取消指令：ok 后回到无指令；重复取消 noOrder', () => {
    system.issueOrder({ unitId: 'army.s02.guard', order: 'defend' });
    expect(system.cancelOrder({ unitId: 'army.s02.guard' }).ok).toBe(true);
    expect(system.getUnit('army.s02.guard').order).toBeNull();
    expect(system.cancelOrder({ unitId: 'army.s02.guard' }).code).toBe('noOrder');
  });

  it('执行器缺失（transport/camp 未注入）→ orderFailed executorUnavailable', () => {
    system.issueOrder({
      unitId: 'army.s02.guard', order: 'transport', target: { convoyId: 'c1', orderId: 'po1' }
    });
    system.tick(500);
    const failed = events.find(entry => entry.event === 'unit.orderFailed');
    expect(failed.payload.code).toBe('executorUnavailable');
    expect(system.getUnit('army.s02.guard').order).toBeNull();
  });

  it('transport 执行器（场景注入 convoy 适配器）→ 完成', () => {
    const load = vi.fn(() => ({ ok: true }));
    const dispatch = vi.fn(() => ({ ok: true }));
    const { system: transportSystem, events: transportEvents } = makeSystem({
      executors: {
        transport: ({ state, order }) => {
          const loaded = load({ convoyId: order.target.convoyId, orderId: order.target.orderId });
          if (!loaded.ok) return { status: 'failed', code: 'loadFailed' };
          const dispatched = dispatch({ convoyId: order.target.convoyId });
          if (!dispatched.ok) return { status: 'failed', code: 'dispatchFailed' };
          return { status: 'completed', progress: 1, position: state.position };
        }
      }
    });
    registerArmy(transportSystem);
    transportSystem.issueOrder({
      unitId: 'army.s02.guard', order: 'transport', target: { convoyId: 'convoy.1', orderId: 'po.1' }
    });
    transportSystem.tick(500);
    expect(load).toHaveBeenCalledWith({ convoyId: 'convoy.1', orderId: 'po.1' });
    expect(dispatch).toHaveBeenCalledWith({ convoyId: 'convoy.1' });
    expect(transportEvents.some(entry => entry.event === 'unit.orderCompleted')).toBe(true);
  });

  it('战术撤军：按 tacticalRetreatMorale 扣士气', () => {
    system.issueOrder({
      unitId: 'army.s02.guard', order: ARMY_TACTICAL_RETREAT, target: { x: -100, y: 0 }
    });
    expect(system.getUnit('army.s02.guard').morale).toBe(77);
    expect(system.getUnit('army.s02.guard').order.type).toBe(ARMY_TACTICAL_RETREAT);
  });

  it('部署：非战斗可改 → 接战锁后 commit/temp/setFormation 一律 DEPLOYMENT_LOCKED', () => {
    const formationExists = formationId => ['line', 'wedge'].includes(formationId);
    const { system: deploySystem } = makeSystem({ formationExists });
    registerArmy(deploySystem);

    expect(deploySystem.commitDeployment({
      armyId: 'army.s02.guard', roster: { unitIds: ['u1'] }, formationId: 'wedge', commanderSlot: 'front'
    }).ok).toBe(true);
    expect(deploySystem.getUnit('army.s02.guard').deployment.committed).toBe(true);
    expect(deploySystem.getUnit('army.s02.guard').deployment.formationId).toBe('wedge');

    const locked = deploySystem.lockDeployment({ battleId: 'battle.s02', unitIds: ['army.s02.guard'] });
    expect(locked.ok).toBe(true);
    expect(deploySystem.isDeployLocked('army.s02.guard')).toBe(true);

    expect(deploySystem.commitDeployment({ armyId: 'army.s02.guard', formationId: 'line' }).code)
      .toBe(DEPLOYMENT_LOCKED);
    expect(deploySystem.applyTempDeployment({ battleId: 'battle.s02', armyId: 'army.s02.guard', formationId: 'line' }).code)
      .toBe(DEPLOYMENT_LOCKED);
    expect(deploySystem.setFormation({ armyId: 'army.s02.guard', formationId: 'line' }).code)
      .toBe(DEPLOYMENT_LOCKED);
    // 已接战不可改战略指令
    expect(deploySystem.issueOrder({ armyId: 'army.s02.guard', order: 'defend' }).code).toBe('BATTLE_ACTIVE');

    deploySystem.releaseDeployment('battle.s02');
    expect(deploySystem.isDeployLocked('army.s02.guard')).toBe(false);
    expect(deploySystem.commitDeployment({ armyId: 'army.s02.guard', formationId: 'line' }).ok).toBe(true);
  });

  it('阵法校验：未知阵法拒绝；deploy.temp 的 setAsDefault 回写默认值', () => {
    const formationExists = formationId => formationId === 'line';
    const { system: deploySystem, events: deployEvents } = makeSystem({ formationExists });
    registerArmy(deploySystem);

    expect(deploySystem.setFormation({ armyId: 'army.s02.guard', formationId: 'nope' }).code)
      .toBe('unknownFormation');
    expect(deploySystem.commitDeployment({ armyId: 'army.s02.guard', formationId: 'nope' }).code)
      .toBe('unknownFormation');

    const temp = deploySystem.applyTempDeployment({
      battleId: 'battle.s03', armyId: 'army.s02.guard', formationId: 'line', setAsDefault: true
    });
    expect(temp.ok).toBe(true);
    expect(deploySystem.getUnit('army.s02.guard').battleDeployment['battle.s03'].formationId).toBe('line');
    expect(deploySystem.getUnit('army.s02.guard').deployment.formationId).toBe('line');
    expect(deploySystem.getUnit('army.s02.guard').deployment.committed).toBe(true);
    expect(deployEvents.some(entry => entry.event === 'army.deployLocked')).toBe(false);
  });

  it('将令：仅 takeover 身份受理、只写 battleOrder 不写 order', () => {
    const battleAgent = {
      getActiveBattleId: () => 'battle.s02',
      getBattleState: battleId => (battleId === 'battle.s02'
        ? { battleId, mode: BattleMode.INTERVENE }
        : null)
    };
    // 接管战：受理
    const { system: takeoverSystem, events: takeoverEvents } = makeSystem({ battleAgent });
    registerArmy(takeoverSystem);
    takeoverSystem.issueOrder({ armyId: 'army.s02.guard', order: 'defend' });
    const issued = takeoverSystem.issueBattleOrder({
      armyId: 'army.s02.guard', kind: 'stance', stance: 'assault'
    });
    expect(issued.ok).toBe(true);
    expect(issued.battleOrder.identity).toBe('takeover');
    expect(takeoverSystem.getUnit('army.s02.guard').battleOrder.stance).toBe('assault');
    expect(takeoverSystem.getUnit('army.s02.guard').order.type).toBe('defend');
    expect(takeoverEvents.some(entry => entry.event === 'army.battleOrderIssued')).toBe(true);

    // 观战战：拒绝
    const observeAgent = {
      getActiveBattleId: () => 'battle.s04',
      getBattleState: () => ({ battleId: 'battle.s04', mode: BattleMode.OBSERVE })
    };
    const { system: observeSystem } = makeSystem({ battleAgent: observeAgent });
    registerArmy(observeSystem);
    expect(observeSystem.issueBattleOrder({ armyId: 'army.s02.guard', kind: 'stance', stance: 'hold' }).code)
      .toBe('commandNotAllowed');

    // 无战斗：拒绝；未知将令/非法姿态拒绝
    expect(takeoverSystem.issueBattleOrder({ armyId: 'army.s02.guard', kind: 'dance' }).code)
      .toBe('unknownBattleOrder');
    expect(takeoverSystem.issueBattleOrder({ armyId: 'army.s02.guard', kind: 'stance', stance: 'dance' }).code)
      .toBe('unknownStance');
    const noBattle = makeSystem();
    registerArmy(noBattle.system);
    expect(noBattle.system.issueBattleOrder({ armyId: 'army.s02.guard', kind: 'stance', stance: 'hold' }).code)
      .toBe('commandNotAllowed');
  });

  it('operationId 幂等：同 payload 复用结果、异 payload 冲突', () => {
    const first = system.issueOrder({
      unitId: 'army.s02.guard', order: 'move', target: { x: 10, y: 10 }, operationId: 'op-1'
    });
    expect(first.ok).toBe(true);
    const replay = system.issueOrder({
      unitId: 'army.s02.guard', order: 'move', target: { x: 10, y: 10 }, operationId: 'op-1'
    });
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(events.filter(entry => entry.event === 'unit.orderIssued').length).toBe(1);
    const conflict = system.issueOrder({
      unitId: 'army.s02.guard', order: 'move', target: { x: 99, y: 10 }, operationId: 'op-1'
    });
    expect(conflict.code).toBe('operationIdConflict');
  });

  it('快照：serialize/restore 保留名册/指令/部署锁；版本不符拒绝', () => {
    system.issueOrder({ unitId: 'army.s02.guard', order: 'move', target: { x: 100, y: 0 } });
    system.lockDeployment({ battleId: 'battle.s02', unitIds: ['army.s02.guard'] });
    const snapshot = system.serialize();
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.deployLocks).toHaveLength(1);

    const restored = new ArmyOrderSystem({ now: () => 1000 });
    expect(restored.restore(snapshot).ok).toBe(true);
    const state = restored.getUnit('army.s02.guard');
    expect(state.roster.unitIds).toEqual(['u1', 'u2']);
    expect(state.order.type).toBe('move');
    expect(state.order.target).toEqual({ x: 100, y: 0 });
    expect(restored.isDeployLocked('army.s02.guard', 'battle.s02')).toBe(true);
    expect(restored.restore({ schemaVersion: 9 }).code).toBe('unsupportedVersion');
  });
});
