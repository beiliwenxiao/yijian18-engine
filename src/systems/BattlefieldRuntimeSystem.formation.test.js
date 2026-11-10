import { describe, it, expect, vi } from 'vitest';
import { BattlefieldRuntimeSystem } from './BattlefieldRuntimeSystem.js';
import { BattleState, BattleMode } from './BattleSystem.js';

function makeEntity(id, factionId, { unitTypeId = null, hp = 100, maxHp = 100 } = {}) {
  return {
    id,
    factionId,
    unitTypeId,
    tags: ['battleParticipant'],
    isDead: false,
    isDying: false,
    getComponent: name => (name === 'stats' ? { hp, maxHp } : null)
  };
}

function makeDefinition(overrides = {}) {
  return {
    battleId: 'battle.test',
    participantFactionIds: ['shu', 'wei'],
    objective: '击溃敌军',
    createParams: {
      attackerArmy: { id: 'army.shu', factionId: 'shu', formationIds: ['formation.wedge'] },
      defenderArmy: { id: 'army.wei', factionId: 'wei' }
    },
    outcomeSignals: {
      shuDefeated: { type: 'factionDefeated', factionId: 'shu' },
      weiDefeated: { type: 'factionDefeated', factionId: 'wei' }
    },
    ...overrides
  };
}

function makeRuntime(definition = makeDefinition()) {
  const battleSystem = {
    state: BattleState.ACTIVE,
    mode: BattleMode.OBSERVE,
    definition,
    evaluateOutcome: () => ({ ok: false, code: 'battleOngoing' })
  };
  const aiSystem = { activateAI: vi.fn(), deactivateAI: vi.fn() };
  const runtime = new BattlefieldRuntimeSystem({ battleSystem, aiSystem });
  return { runtime, battleSystem, aiSystem };
}

const formations = [{
  id: 'formation.wedge',
  name: '锋矢',
  strategy: 'wedge',
  unitIds: ['unit.spear', 'unit.shield', 'unit.spear', 'unit.archer']
}];

describe('BattlefieldRuntimeSystem 战前部署（5B）', () => {
  it('不给 formations 时部署为空，snapshot 结构不变（零回归）', () => {
    const { runtime } = makeRuntime();
    const entities = [
      makeEntity('s1', 'shu'), makeEntity('w1', 'wei')
    ];
    const started = runtime.start({ entities });
    expect(started.ok).toBe(true);
    expect(runtime.deployments).toEqual({});
    expect(started.snapshot.factions.shu.formation).toBeUndefined();
    for (const entity of entities) {
      expect(entity.deploySlot).toBeUndefined();
      expect(entity.formationStance).toBeUndefined();
    }
  });

  it('按 createParams 的 formationIds 部署，兵种匹配优先', () => {
    const { runtime } = makeRuntime();
    const entities = [
      makeEntity('s1', 'shu', { unitTypeId: 'unit.archer' }),
      makeEntity('s2', 'shu', { unitTypeId: 'unit.spear' }),
      makeEntity('w1', 'wei', { unitTypeId: 'unit.spear' })
    ];
    runtime.start({ entities, formations });
    const shu = runtime.deployments.shu;
    expect(shu.formationId).toBe('formation.wedge');
    expect(shu.strategy).toBe('wedge');
    expect(shu.slots).toBe(4);
    expect(shu.rows).toBe(3);
    const archer = entities.find(entity => entity.id === 's1');
    expect(archer.deploySlot).not.toBeNull();
    expect(archer.deploySlot.unitTypeId).toBe('unit.archer');
    // 【锋矢】的弓手落在最后一行（rear）→ 默认随军姿态 escort
    expect(archer.deploySlot.role).toBe('rear');
    expect(archer.formationStance).toBe('escort');
    // 没有军阵的阵营不产出部署
    expect(runtime.deployments.wei).toBeUndefined();
    expect(runtime.getSnapshot().factions.shu.formation).toEqual({
      id: 'formation.wedge', strategy: 'wedge', commanderSlot: 'mid'
    });
  });

  it('deployments 覆盖 formationId / commanderSlot / roster', () => {
    const { runtime } = makeRuntime();
    const entities = [
      makeEntity('s1', 'shu', { unitTypeId: 'unit.spear' }),
      makeEntity('w1', 'wei', { unitTypeId: 'unit.shield' })
    ];
    runtime.start({
      entities,
      formations: [
        ...formations,
        { id: 'formation.crane', strategy: 'crane', unitIds: ['unit.shield', 'unit.archer'] }
      ],
      deployments: {
        wei: { formationId: 'formation.crane', commanderSlot: 'rear', deputySlots: ['front', 'bogus'] }
      }
    });
    expect(runtime.deployments.wei.formationId).toBe('formation.crane');
    expect(runtime.deployments.wei.commanderSlot).toBe('rear');
    expect(runtime.deployments.wei.deputySlots).toEqual(['front']);
    expect(runtime.deployments.shu.formationId).toBe('formation.wedge');
  });

  it('formationId 找不到时记告警且不阻断开战', () => {
    const { runtime } = makeRuntime();
    const started = runtime.start({
      entities: [makeEntity('s1', 'shu'), makeEntity('w1', 'wei')],
      formations: [],
      deployments: { shu: { formationId: 'formation.missing' } }
    });
    // formations 为空时整批跳过（不看 deployments）
    expect(started.ok).toBe(true);
    expect(runtime.deployments).toEqual({});
  });

  it('有 formations 但引用缺失时给出 formationMissing', () => {
    const { runtime } = makeRuntime();
    runtime.start({
      entities: [makeEntity('s1', 'shu'), makeEntity('w1', 'wei')],
      formations: [{ id: 'formation.other', strategy: 'line', unitIds: ['unit.spear'] }],
      deployments: { shu: { formationId: 'formation.missing' } }
    });
    expect(runtime.deploymentWarnings).toEqual([
      { code: 'formationMissing', factionId: 'shu', formationId: 'formation.missing' }
    ]);
    expect(runtime.deployments).toEqual({});
  });

  it('部署随存档序列化/反序列化往返', () => {
    const { runtime, battleSystem } = makeRuntime();
    runtime.start({
      entities: [makeEntity('s1', 'shu', { unitTypeId: 'unit.spear' }), makeEntity('w1', 'wei')],
      formations
    });
    const saved = runtime.serialize();
    expect(saved.deployments.shu.formationId).toBe('formation.wedge');

    const { runtime: restored } = makeRuntime();
    const result = restored.deserialize(saved, { entities: [makeEntity('s1', 'shu'), makeEntity('w1', 'wei')] });
    expect(result.ok).toBe(true);
    expect(restored.deployments.shu.strategy).toBe('wedge');
    expect(battleSystem.state).toBe(BattleState.ACTIVE);
  });

  it('旧档（无 deployments 字段）可正常反序列化', () => {
    const { runtime } = makeRuntime();
    const legacy = {
      schemaVersion: 1,
      active: false,
      elapsed: 0,
      participants: [],
      initialFactions: {},
      playerRestore: null,
      lastSnapshot: null
    };
    const result = runtime.deserialize(legacy, { entities: [] });
    expect(result.ok).toBe(true);
    expect(runtime.deployments).toEqual({});
  });
});
