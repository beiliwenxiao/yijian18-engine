/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-11-10
 ************************************************************/

import { describe, expect, it } from 'vitest';
import { CompanionGridHud, computeCompanionHudLayout, companionCellCenter } from './CompanionGridHud.js';
import { CompanionSquadSystem, COMPANION_STANCES } from '../systems/CompanionSquadSystem.js';

function createHud() {
  const system = new CompanionSquadSystem({
    now: () => 0,
    getCommand: () => 100,
    getRankValue: () => 100
  });
  system.setRoster({ unitIds: ['a', 'b', 'c'] });
  const hud = new CompanionGridHud({ system });
  hud.layout(1280, 720);
  return { hud, system };
}

describe('M3 3A · CompanionGridHud 布局（纯函数）', () => {
  it('10×10 网格 + 五档按钮：按钮等宽不重叠，全部落在面板内', () => {
    const layout = computeCompanionHudLayout({ viewportWidth: 1280, viewportHeight: 720 });
    expect(layout.grid.cols).toBe(10);
    expect(layout.grid.rows).toBe(10);
    expect(layout.buttons).toHaveLength(COMPANION_STANCES.length);
    for (let index = 0; index < layout.buttons.length; index += 1) {
      const button = layout.buttons[index];
      expect(button.x).toBeGreaterThanOrEqual(layout.x);
      expect(button.x + button.width).toBeLessThanOrEqual(layout.x + layout.width);
      expect(button.y).toBeGreaterThanOrEqual(layout.y);
      if (index > 0) {
        const previous = layout.buttons[index - 1];
        expect(button.x).toBeGreaterThanOrEqual(previous.x + previous.width);
      }
    }
    expect(layout.grid.y).toBeGreaterThan(layout.stanceRow.y + layout.stanceRow.height);
    expect(layout.grid.y + layout.grid.height).toBeLessThanOrEqual(layout.y + layout.height);
  });

  it('单元格中心按行优先展开，第 10 格换行', () => {
    const layout = computeCompanionHudLayout();
    const first = companionCellCenter(layout, 0);
    const tenth = companionCellCenter(layout, 9);
    const eleventh = companionCellCenter(layout, 10);
    expect(tenth.y).toBeCloseTo(first.y, 5);
    expect(tenth.x).toBeGreaterThan(first.x);
    expect(eleventh.y).toBeGreaterThan(first.y);
    expect(eleventh.x).toBeCloseTo(first.x, 5);
  });
});

describe('M3 3A · CompanionGridHud 命中', () => {
  it('五档按钮优先命中并派发 setStance', () => {
    const { hud, system } = createHud();
    const layout = hud.getLayout();
    const charge = layout.buttons.find(button => button.key === 'charge');
    const hit = hud.hitTest(charge.x + charge.width / 2, charge.y + charge.height / 2);
    expect(hit).toMatchObject({ type: 'stance', key: 'charge' });
    expect(hud.handleMouseClick(charge.x + 1, charge.y + 1)).toBe(true);
    expect(system.getStance()).toBe('charge');
  });

  it('成员格可命中；面板外点击不消费', () => {
    const { hud } = createHud();
    const layout = hud.getLayout();
    const center = companionCellCenter(layout, 2);
    expect(hud.hitTest(center.x, center.y)).toMatchObject({ type: 'cell', index: 2 });
    expect(hud.handleMouseClick(-10, -10)).toBe(false);
  });
});
