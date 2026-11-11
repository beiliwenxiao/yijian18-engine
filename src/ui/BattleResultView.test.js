import { describe, it, expect } from 'vitest';
import {
  BattleResultView,
  buildBattleResultLines,
  buildBattleResultActions,
  resolveBattleIdentityLabel
} from './BattleResultView.js';

const snapshot = {
  title: '长社之战结算',
  mode: 'intervene',
  identity: 'takeover',
  identityOptions: ['takeover', 'observe'],
  winnerName: '黄巾军',
  worldChanges: { month: 4 },
  result: {
    winnerFactionId: 'yellow_turban',
    cityDamage: 0.12,
    resourceTransfer: { resources: { food: 120, gold: 0 } }
  },
  ledgers: {
    defeat: { 兵力: 18, 粮草: 40, 散兵: 9 },
    fled: { 兵力: 6, 粮草: 0, 散兵: 0 }
  },
  scattered: { count: 9 },
  supplyCaches: [{ cacheId: 'cache.1', armyId: 'army.a' }, { cacheId: 'cache.2' }]
};

describe('BattleResultView 军需扩展', () => {
  it('两本账与散兵/辎重写入结果文本', () => {
    const lines = buildBattleResultLines(snapshot);
    expect(lines).toContain('接管身份：接管');
    expect(lines).toContain('资源转移：food +120');
    expect(lines).toContain('战败账：兵力 18 · 粮草 40 · 散兵 9');
    expect(lines).toContain('逃亡账：兵力 6');
    expect(lines).toContain('散兵可收拢：9');
    expect(lines).toContain('可追回辎重：2 处');
    expect(lines).toContain('时间推进：4月');
  });

  it('随军身份标注不可发将令', () => {
    const lines = buildBattleResultLines({ ...snapshot, identity: 'support' });
    expect(lines).toContain('接管身份：随军（随军，不可发将令）');
    expect(resolveBattleIdentityLabel('observe')).toBe('观战');
  });

  it('旧快照（无军需字段）保持原行数与文案', () => {
    const lines = buildBattleResultLines({
      mode: 'observe',
      result: { cityDamage: 0, resourceTransfer: {} },
      worldChanges: {},
      message: '战果已冻结'
    });
    expect(lines).toHaveLength(6);
    expect(lines).toContain('资源转移：无资源转移');
    expect(lines).toContain('战果已冻结');
  });

  it('操作按钮：追回辎重取首个 cacheId，收拢散兵，非当前身份可切换', () => {
    const actions = buildBattleResultActions(snapshot);
    expect(actions.find(action => action.type === 'recover')).toMatchObject({
      cacheId: 'cache.1', label: '追回辎重'
    });
    expect(actions.find(action => action.type === 'regroup')).toMatchObject({ label: '收拢散兵' });
    const entry = actions.filter(action => action.type === 'entry');
    expect(entry).toHaveLength(1);
    expect(entry[0]).toMatchObject({ identity: 'observe', label: '以观战入场' });
  });

  it('点击操作按钮发出 onCommand，继续按钮仍发 close', () => {
    const commands = [];
    const view = new BattleResultView({ onCommand: command => commands.push(command) });
    view.open(snapshot);
    const layout = view._layout(1280, 720);
    const makeInput = (x, y) => ({
      isKeyPressed: () => false,
      isMouseClicked: () => true,
      isMouseClickHandled: () => false,
      markMouseClickHandled: () => {},
      getMousePosition: () => ({ x, y })
    });
    const button = layout.buttons[0];
    view.handleInput({
      inputManager: makeInput(button.x + 2, button.y + 2),
      gamepad: null,
      viewWidth: 1280,
      viewHeight: 720
    });
    expect(commands[0]).toMatchObject({ type: 'recover', cacheId: 'cache.1' });

    view.handleInput({
      inputManager: makeInput(layout.closeButton.x + 2, layout.closeButton.y + 2),
      gamepad: null,
      viewWidth: 1280,
      viewHeight: 720
    });
    expect(commands[1]).toEqual({ type: 'close' });
  });

  it('无军需数据时没有操作按钮', () => {
    expect(buildBattleResultActions({ identity: 'takeover' })).toEqual([]);
  });
});
