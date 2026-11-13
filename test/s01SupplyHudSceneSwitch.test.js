/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 ************************************************************/

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { S09RefugeeCoordinator } from '../example/sanguo_zhangjiao/systems/S09RefugeeFlow.js';

const buildFlow = sceneDataByScene => {
  const calls = [];
  const flow = Object.create(S09RefugeeCoordinator.prototype);
  flow.scene = {
    currentSceneId: 'S01',
    supplyStatusBar: {
      hide: () => calls.push('hide'),
      show: () => calls.push('show'),
      setEntries: entries => calls.push(`entries:${entries.length}`)
    },
    foodLedgerSystem: {
      armies: new Map(),
      camps: new Map([['camp.s02.field', { name: 'S02 营地', stock: { food: 20 } }]])
    },
    _worldLoadSession: {
      getSceneData: sceneId => sceneDataByScene[sceneId] || null
    }
  };
  return { flow, calls };
};

describe('粮草/军需 HUD 的场景维度开关（S01 不显示）', () => {
  it('场景数据 gameplay.hud.supply=false → 隐藏且不渲染条目', () => {
    const { flow, calls } = buildFlow({ S01: { gameplay: { hud: { supply: false } } } });
    expect(flow.updateSupplyStatus()).toBe(false);
    expect(calls).toEqual(['hide']);
  });

  it('未声明开关的场景照常显示（S02 及之后）', () => {
    const { flow, calls } = buildFlow({ S02: { gameplay: {} } });
    flow.scene.currentSceneId = 'S02';
    expect(flow.updateSupplyStatus()).toBe(true);
    expect(calls).toEqual(['entries:1', 'show']);
  });

  it('无场景数据时按默认显示，不因开关缺失误隐藏', () => {
    const { flow, calls } = buildFlow({});
    expect(flow.updateSupplyStatus()).toBe(true);
    expect(calls).toEqual(['entries:1', 'show']);
  });

  it('S01-C01 与 S01 共用同一开关（小庇护所内同样隐藏）', () => {
    const { flow, calls } = buildFlow({
      S01: { gameplay: { hud: { supply: false } } },
      'S01-C01': { gameplay: { hud: { supply: false } } }
    });
    flow.scene.currentSceneId = 'S01-C01';
    expect(flow.updateSupplyStatus()).toBe(false);
    expect(calls).toEqual(['hide']);
  });

  it('切场景后按当前场景数据重新判定，S01 不残留', () => {
    const { flow, calls } = buildFlow({
      S01: { gameplay: { hud: { supply: false } } },
      S09: { gameplay: {} }
    });
    expect(flow.updateSupplyStatus()).toBe(false);
    flow.scene.currentSceneId = 'S09';
    expect(flow.updateSupplyStatus()).toBe(true);
    flow.scene.currentSceneId = 'S01';
    expect(flow.updateSupplyStatus()).toBe(false);
    expect(calls).toEqual(['hide', 'entries:1', 'show', 'hide']);
  });
});
