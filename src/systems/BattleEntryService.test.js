import { describe, it, expect } from 'vitest';
import {
  BattleEntryService,
  BATTLE_IDENTITIES,
  normalizeIdentity,
  canIssueBattleOrder
} from './BattleEntryService.js';

function makeService() {
  const events = [];
  const service = new BattleEntryService({
    now: () => 1000,
    onEvent: (event, payload) => events.push({ event, payload })
  });
  return { service, events };
}

describe('BattleEntryService 身份与术语', () => {
  it('三种身份 + command 兼容别名', () => {
    expect(BATTLE_IDENTITIES).toEqual(['takeover', 'support', 'observe']);
    expect(normalizeIdentity('command')).toBe('takeover');
    expect(normalizeIdentity('takeover')).toBe('takeover');
    expect(normalizeIdentity('nope')).toBe(null);
    expect(canIssueBattleOrder('takeover')).toBe(true);
    expect(canIssueBattleOrder('command')).toBe(true);
    expect(canIssueBattleOrder('support')).toBe(false);
    expect(canIssueBattleOrder('observe')).toBe(false);
  });
});

describe('BattleEntryService 进入战斗', () => {
  it('接管（现场）：possess 为空、部署可编辑、光环挂载', () => {
    const { service, events } = makeService();
    const result = service.joinBattle({
      battleId: 'battle.s04',
      armyId: 'army.s02.guard',
      identity: 'command',
      mode: 'onsite',
      playerOnsite: true,
      commanderHeroId: 'hero.zhangjiao'
    });
    expect(result.ok).toBe(true);
    expect(result.identity).toBe('takeover');
    expect(result.plan.possess).toBe(null);
    expect(result.plan.enterBattle.mode).toBe('INTERVENE');
    expect(result.plan.deployment.editable).toBe(true);
    expect(events[0].event).toBe('battle.join');
  });

  it('接管（远程）：possess 主将', () => {
    const { service } = makeService();
    const result = service.joinBattle({
      battleId: 'battle.s04',
      armyId: 'army.s02.guard',
      identity: 'takeover',
      mode: 'remote',
      commanderHeroId: 'hero.zhangjiao'
    });
    expect(result.ok).toBe(true);
    expect(result.plan.possess).toEqual({ armyId: 'army.s02.guard', heroId: 'hero.zhangjiao' });
  });

  it('支援必须本人抵达；成功后 spawnSupportSquad 且无将令', () => {
    const { service } = makeService();
    const rejected = service.joinBattle({ battleId: 'b1', identity: 'support', playerOnsite: false, arrived: false });
    expect(rejected.ok).toBe(false);
    expect(rejected.code).toBe('supportMustArriveInPerson');
    const ok = service.joinBattle({ battleId: 'b1', identity: 'support', playerOnsite: true, arrived: true });
    expect(ok.ok).toBe(true);
    expect(ok.plan.spawnSupportSquad.independent).toBe(true);
    expect(ok.plan.battleOrders).toBe(false);
    expect(service.canIssueBattleOrder('b1')).toBe(false);
  });

  it('支援每场限一次（离开后不能再支援）', () => {
    const { service } = makeService();
    service.joinBattle({ battleId: 'b1', identity: 'support', playerOnsite: true, arrived: true });
    const left = service.leaveBattle({ battleId: 'b1', reason: 'supportLeft' });
    expect(left.ok).toBe(true);
    expect(left.effects.supportEnded).toBe(true);
    const again = service.joinBattle({ battleId: 'b1', identity: 'support', playerOnsite: true, arrived: true });
    expect(again.ok).toBe(false);
    expect(again.code).toBe('supportUsed');
  });

  it('预演已判负：只能旁观', () => {
    const { service } = makeService();
    expect(service.joinBattle({ battleId: 'b1', identity: 'takeover', previewDefeated: true }).code).toBe('previewDefeated');
    expect(service.joinBattle({ battleId: 'b1', identity: 'observe', previewDefeated: true }).ok).toBe(true);
  });
});

describe('BattleEntryService 离开战斗与边界', () => {
  it('接管逃亡：写逃亡结算 + 声望扣减 + 不可再接管', () => {
    const { service, events } = makeService();
    service.joinBattle({ battleId: 'b1', armyId: 'army.a', identity: 'takeover', mode: 'remote', commanderHeroId: 'hero.h' });
    const left = service.leaveBattle({ battleId: 'b1', reason: 'commanderFled' });
    expect(left.ok).toBe(true);
    expect(left.effects.settlementEvent).toBe('fled');
    expect(left.effects.reputationPenalty).toBe(-6);
    expect(left.effects.canRejoin).toBe(false);
    const rejoin = service.joinBattle({ battleId: 'b1', identity: 'takeover', mode: 'remote' });
    expect(rejoin.code).toBe('rejoinForbidden');
    expect(events.some(entry => entry.event === 'battle.leave')).toBe(true);
  });

  it('主将阵亡：士气事件而不是逃亡结算', () => {
    const { service } = makeService();
    service.joinBattle({ battleId: 'b1', armyId: 'army.a', identity: 'takeover', mode: 'remote' });
    const left = service.leaveBattle({ battleId: 'b1', reason: 'commanderKilled' });
    expect(left.effects.moraleEvent).toBe('commanderKilled');
    expect(left.effects.settlementEvent).toBe(null);
    expect(left.effects.canRejoin).toBe(false);
  });

  it('支援离开不算逃亡、不扣声望', () => {
    const { service } = makeService();
    service.joinBattle({ battleId: 'b1', identity: 'support', playerOnsite: true, arrived: true });
    const left = service.leaveBattle({ battleId: 'b1', reason: 'leftScene' });
    expect(left.effects.settlementEvent).toBe(null);
    expect(left.effects.reputationPenalty).toBe(0);
  });

  it('现场接管越过边界需确认，未确认夹回边界内', () => {
    const { service } = makeService();
    service.joinBattle({ battleId: 'b1', identity: 'takeover', mode: 'onsite', playerOnsite: true });
    const bounds = { left: 0, top: 0, width: 200, height: 100 };
    const inside = service.boundaryCheck({ battleId: 'b1', position: { x: 50, y: 50 }, bounds });
    expect(inside.inside).toBe(true);
    expect(inside.confirmRequired).toBe(false);
    const outside = service.boundaryCheck({ battleId: 'b1', position: { x: 260, y: 50 }, bounds });
    expect(outside.inside).toBe(false);
    expect(outside.confirmRequired).toBe(true);
    expect(outside.position).toEqual({ x: 200, y: 50 });
    const refused = service.leaveBattle({ battleId: 'b1', reason: 'leftScene' });
    expect(refused.code).toBe('boundaryConfirmRequired');
    const confirmed = service.leaveBattle({ battleId: 'b1', reason: 'leftScene', confirmed: true });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.effects.settlementEvent).toBe('fled');
  });

  it('部署判据只看战斗状态不看身份', () => {
    const { service } = makeService();
    expect(service.canAdjustDeployment({ battleStatus: null })).toBe(true);
    expect(service.canAdjustDeployment({ battleStatus: 'PRE_BATTLE' })).toBe(true);
    expect(service.canAdjustDeployment({ battleStatus: 'DEPLOYED' })).toBe(false);
  });

  it('serialize/restore 保留会话账', () => {
    const { service } = makeService();
    service.joinBattle({ battleId: 'b1', identity: 'takeover', mode: 'remote', commanderHeroId: 'hero.h' });
    const snapshot = service.serialize();
    const restored = new BattleEntryService({ now: () => 1000 });
    expect(restored.restore(snapshot).ok).toBe(true);
    expect(restored.getIdentity('b1')).toBe('takeover');
    expect(restored.canIssueBattleOrder('b1')).toBe(true);
  });
});
