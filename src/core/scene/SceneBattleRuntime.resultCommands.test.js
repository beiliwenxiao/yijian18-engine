import { describe, it, expect } from 'vitest';
import { SceneBattleRuntime } from './SceneBattleRuntime.js';

/** 用原型对象避开完整运行时装配，只验证战果卡命令转发的接线契约。 */
function makeRuntime({ warLogistics = null, snapshot = null, battleId = 'battle.s03' } = {}) {
  const runtime = Object.create(SceneBattleRuntime.prototype);
  runtime.warLogistics = warLogistics;
  runtime.resultView = { snapshot, close() { this.closed = true; } };
  runtime.battleSystem = { definition: { battleId }, state: {} };
  runtime.notified = [];
  runtime.notify = (message, type) => runtime.notified.push({ message, type });
  return runtime;
}

describe('SceneBattleRuntime 战果卡军需命令', () => {
  it('追回辎重：转发 cacheId + army，成功后从快照移除该辎重', () => {
    const calls = [];
    const runtime = makeRuntime({
      snapshot: { supplyCaches: [{ cacheId: 'cache.1' }, { cacheId: 'cache.2' }] },
      warLogistics: {
        resolveArmy: armyId => ({ id: armyId || 'army.a', armyId }),
        recoverSupply: params => {
          calls.push(params);
          return { ok: true, recovered: { food: 30 } };
        }
      }
    });
    const result = runtime.handleResultCommand({ type: 'recover', cacheId: 'cache.1' });
    expect(result.ok).toBe(true);
    expect(calls[0]).toMatchObject({ cacheId: 'cache.1', army: { id: 'army.a' } });
    expect(runtime.resultView.snapshot.supplyCaches).toEqual([{ cacheId: 'cache.2' }]);
    expect(runtime.notified[0]).toMatchObject({ message: '已追回辎重', type: 'success' });
  });

  it('收拢散兵：按 returned 递减快照散兵数', () => {
    const calls = [];
    const runtime = makeRuntime({
      snapshot: { scattered: { count: 9 } },
      warLogistics: {
        resolveArmy: () => ({ id: 'army.a' }),
        regroup: params => {
          calls.push(params);
          return { ok: true, returned: 4, remain: 20 };
        }
      }
    });
    runtime.handleResultCommand({ type: 'regroup' });
    expect(calls[0]).toEqual({ armyId: 'army.a' });
    expect(runtime.resultView.snapshot.scattered).toEqual({ count: 5 });
  });

  it('接管身份切换：转发 battleId/identity，成功后更新快照身份', () => {
    const calls = [];
    const runtime = makeRuntime({
      snapshot: { identity: 'observe' },
      warLogistics: {
        joinBattle: params => {
          calls.push(params);
          return { ok: true, identity: params.identity };
        }
      }
    });
    runtime.handleResultCommand({ type: 'entry', identity: 'takeover' });
    expect(calls[0]).toMatchObject({ battleId: 'battle.s03', identity: 'takeover', entry: 'battleResult' });
    expect(runtime.resultView.snapshot.identity).toBe('takeover');
  });

  it('服务未装配或失败：不抛错，回传错误码并提示', () => {
    const runtime = makeRuntime({ snapshot: { supplyCaches: [] } });
    const result = runtime.handleResultCommand({ type: 'recover', cacheId: 'cache.1' });
    expect(result).toEqual({ ok: false, code: 'warLogisticsUnavailable' });
    expect(runtime.notified[0].type).toBe('error');

    const failing = makeRuntime({
      snapshot: {},
      warLogistics: { regroup: () => ({ ok: false, code: 'unknownArmy' }) }
    });
    expect(failing.handleResultCommand({ type: 'regroup' })).toEqual({ ok: false, code: 'unknownArmy' });
  });

  it('close 关闭面板；未知命令回传错误码', () => {
    const runtime = makeRuntime({ snapshot: {} });
    expect(runtime.handleResultCommand({ type: 'close' })).toEqual({ ok: true });
    expect(runtime.resultView.closed).toBe(true);
    expect(runtime.handleResultCommand({ type: 'nope' })).toEqual({ ok: false, code: 'unknownCommand' });
  });
});
