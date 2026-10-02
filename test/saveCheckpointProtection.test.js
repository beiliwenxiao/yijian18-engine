import { describe, it, expect } from 'vitest';
import { SaveGameService } from '../src/core/snapshot/SaveGameService.js';
import { LocalStorageAdapter } from '../src/core/snapshot/LocalStorageAdapter.js';
import { EndingPresentationView } from '../src/ui/EndingPresentationView.js';
import { SanguoSceneStateFlow } from '../example/sanguo_zhangjiao/systems/SanguoSceneStateFlow.js';

/**
 * 存档完整性回归（对应修复）：
 * - checkpoint 存档防轮换覆盖（读检查点回滚到旧状态/结局读档失败的根源）
 * - 结局界面 E 确认→命令派发链路
 * - 玩家位于无场景世界格时拒绝固化自动存档（读档踢回标题的根源）
 */

class MemoryStorage extends LocalStorageAdapter {
  constructor() {
    super({ prefix: 'diag', storage: (() => {
      const map = new Map();
      return {
        getItem: k => map.has(k) ? map.get(k) : null,
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k),
        key: i => [...map.keys()][i] ?? null,
        get length() { return map.size; }
      };
    })() });
  }
}

function makeService() {
  return new SaveGameService({ gameId: 'diag', useIndexedDB: false, storage: new MemoryStorage() });
}

describe('存档完整性：checkpoint 防轮换覆盖', () => {
  it('普通自动存档不覆盖 checkpoint 槽', async () => {
    const service = makeService();
    await service.ready();
    await service.saveAutoAsync({ checkpointId: 'checkpoint.S14.preEnding', label: 'pre' });
    await service.saveAutoAsync({ label: 'periodic-1' });
    await service.saveAutoAsync({ label: 'periodic-2' });
    await service.saveAutoAsync({ label: 'periodic-3' });
    const slots = await service.getAutoSlotsAsync();
    const byId = new Map(slots.map(slot => [slot.id, slot]));
    const checkpointSlot = [...byId.values()].find(slot => slot.info?.meta?.checkpointId === 'checkpoint.S14.preEnding');
    expect(checkpointSlot, 'checkpoint 槽仍存在').toBeTruthy();
    const periodicSlots = [...byId.values()].filter(slot => slot.info?.meta?.label?.startsWith('periodic'));
    // 3 槽 = 1 checkpoint + 2 普通轮换；普通档只覆盖非 checkpoint 槽（periodic-1 被 periodic-3 覆盖）
    expect(periodicSlots.length).toBe(2);
  });

  it('checkpoint 超过槽位数时按最旧轮换（保留最近 3 个）', async () => {
    const service = makeService();
    await service.ready();
    for (const id of ['cp.1', 'cp.2', 'cp.3', 'cp.4']) {
      await service.saveAutoAsync({ checkpointId: id });
    }
    const slots = await service.getAutoSlotsAsync();
    const ids = slots.filter(slot => slot.exists).map(slot => slot.info?.meta?.checkpointId).sort();
    expect(ids).toEqual(['cp.2', 'cp.3', 'cp.4']);
  });

  it('loadCheckpointAutoSave 语义：按 meta.checkpointId 找到未被覆盖的快照', async () => {
    const service = makeService();
    await service.ready();
    await service.saveAutoAsync({ checkpointId: 'checkpoint.S14.preEnding' });
    await service.saveAutoAsync({ label: 'noise' });
    const records = await service.getAutoSlotsAsync();
    const hit = records.find(slot => slot.exists && slot.info?.meta?.checkpointId === 'checkpoint.S14.preEnding');
    expect(hit).toBeTruthy();
  });
});

describe('存档完整性：结局界面 E 确认链路', () => {
  it('review 相位按 E（confirm 动作）触发 loadPreEndingSave 命令', () => {
    const commands = [];
    const view = new EndingPresentationView({ onCommand: command => commands.push(command) });
    view.open({ snapshot: { endingId: 'e1' }, ending: { id: 'e1', title: '终局' }, reviewLines: ['a'] });
    view._showReview();
    // 模拟 _createEndingInputContext 的动作映射（S11S14SceneFlow）
    const pressed = new Set(['confirm']);
    view.handleInput({
      inputManager: null,
      isActionPressed: action => pressed.has(action),
      viewWidth: 1280,
      viewHeight: 720
    });
    // 默认焦点=第 1 个按钮「返回标题」：E 确认触发 returnTitle（组件链路通畅）
    expect(commands).toEqual([{ type: 'returnTitle', endingId: 'e1', endingSnapshotId: null }]);
    // 导航到第 2 个按钮「读取结局前存档」再确认
    commands.length = 0;
    pressed.clear();
    pressed.add('right');
    view.handleInput({ inputManager: null, isActionPressed: action => pressed.has(action), viewWidth: 1280, viewHeight: 720 });
    expect(view.selectedAction).toBe(1);
    pressed.clear();
    pressed.add('confirm');
    view.handleInput({ inputManager: null, isActionPressed: action => pressed.has(action), viewWidth: 1280, viewHeight: 720 });
    expect(commands).toEqual([{ type: 'loadPreEndingSave', endingId: 'e1', endingSnapshotId: null }]);
    // 导航：right 后 confirm → viewUnlockedEndings
    commands.length = 0;
    view.open({ snapshot: { endingId: 'e1' }, ending: { id: 'e1', title: '终局' }, reviewLines: [] });
    view._showReview();
    const state = { pressed: new Set() };
    view.handleInput({
      inputManager: null,
      isActionPressed: action => state.pressed.has(action),
      viewWidth: 1280,
      viewHeight: 720
    } ); // confirm 无 → 不触发
    state.pressed.add('right');
    view.handleInput({ inputManager: null, isActionPressed: action => state.pressed.has(action), viewWidth: 1280, viewHeight: 720 });
    expect(view.selectedAction).toBe(1);
    view.handleInput({ inputManager: null, isActionPressed: action => state.pressed.has(action), viewWidth: 1280, viewHeight: 720 });
    expect(view.selectedAction).toBe(2);
    state.pressed.delete('right');
    state.pressed.add('confirm');
    view.handleInput({ inputManager: null, isActionPressed: action => state.pressed.has(action), viewWidth: 1280, viewHeight: 720 });
    expect(commands[commands.length - 1]?.type).toBe('viewUnlockedEndings');
  });
});

describe('存档完整性：无场景世界格拒绝固化存档', () => {
  function makeStateFlow({ playerCell = { col: 6, row: 5 }, hasScene = true } = {}) {
    const scene = {
      context: {
        services: {
          placements: {
            getPendingStateSnapshot: () => ({ resourceNodes: [], placementStates: [] }),
            getPlacements: () => []
          },
          containerInventories: null,
          corpses: { capture: () => null },
          s01s02: null
        }
      },
      entities: [],
      pickupItems: [],
      equipmentItems: [],
      _deathDrops: { capture: () => [], validate: () => ({ ok: true }) },
      _groupEnemies: {},
      _firedPickups: new Set(),
      _clearedGroups: new Set(),
      _regionDynamicStates: new Map(),
      _campfireService: { snapshot: () => ({ lit: false }) },
      _gameplaySnapshots: { capture: () => ({}), validate: () => ({ ok: true }), restoreFoundations: () => ({ ok: true }), restoreActors: () => ({ ok: true }) },
      s03s14BattleCoordinator: { capture: () => ({}), validateSnapshot: () => ({ ok: true }) },
      rescueSystem: null,
      s09RefugeeCoordinator: { captureUnauthorizedHarvestOperations: () => [] },
      s10ConstructionCoordinator: { _captureS10StructureStates: () => [], _validateS10StructureStates: () => ({ ok: true }) },
      s11s14SceneCoordinator: { _captureS11S14SceneState: () => ({}), _validateS11S14SceneState: () => ({ ok: true }) },
      timeSystem: null,
      weatherSystem: null,
      playerEntity: {
        id: 'p1',
        getComponent: name => name === 'transform'
          ? { position: { x: playerCell.col * 1280 + 10, y: playerCell.row * 720 + 10 } }
          : null
      },
      worldStreamingManager: {
        chunkWidth: 1280,
        chunkHeight: 720,
        worldToChunk: (x, y) => ({ col: Math.floor(x / 1280), row: Math.floor(y / 720) }),
        getSceneId: (col, row) => (hasScene && col === playerCell.col && row === playerCell.row ? 'S01' : null),
        serialize: () => ({ schemaVersion: 1, current: playerCell, chunks: [] })
      }
    };
    return new SanguoSceneStateFlow(scene);
  }

  it('玩家所在格有场景：正常捕获', () => {
    const flow = makeStateFlow({ hasScene: true });
    const state = flow.captureSceneSaveState();
    expect(state.worldStreamingState).toBeTruthy();
  });

  it('玩家所在格无场景：抛 playerOutsideLoadableWorldCell，不生成存档', () => {
    const flow = makeStateFlow({ hasScene: false });
    expect(() => flow.captureSceneSaveState()).toThrowError(/无场景世界格/);
    try {
      flow.captureSceneSaveState();
    } catch (error) {
      expect(error.code).toBe('playerOutsideLoadableWorldCell');
    }
  });
});
