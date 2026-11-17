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
    getRankValue: () => 100,
    getRankLabel: () => '大贤良师'
  });
  system.setRoster({ unitIds: ['a', 'b', 'c'] });
  const hud = new CompanionGridHud({ system });
  hud.layout(1280, 720);
  return { hud, system };
}

describe('亲卫队团队框 · 三行布局（军团体系 v2 §8）', () => {
  it('第1行五档按钮 / 第2行状态行 / 第3行成员网格：行序正确且落在面板内', () => {
    const layout = computeCompanionHudLayout({ viewportWidth: 1280, viewportHeight: 720 });
    expect(layout.grid.cols).toBe(10);
    expect(layout.grid.visibleRows).toBe(5);
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
    // 第 2 行状态行在第 1 行命令行之下
    expect(layout.statusRow.y).toBeGreaterThan(layout.stanceRow.y + layout.stanceRow.height);
    // 第 3 行网格在状态行之下，右侧有滚动条
    expect(layout.grid.y).toBeGreaterThan(layout.statusRow.y + layout.statusRow.height);
    expect(layout.scrollbar.x).toBeGreaterThan(layout.grid.x + layout.grid.width);
    expect(layout.grid.y + layout.grid.height).toBeLessThanOrEqual(layout.y + layout.height);
    // 默认最左侧置顶
    expect(layout.x).toBe(10);
    expect(layout.y).toBe(10);
  });

  it('单元格中心按行优先展开，第 10 格换行；滚动一行后第 11 格进入窗口顶部', () => {
    const layout = computeCompanionHudLayout();
    const first = companionCellCenter(layout, 0);
    const tenth = companionCellCenter(layout, 9);
    const eleventh = companionCellCenter(layout, 10);
    expect(tenth.y).toBeCloseTo(first.y, 5);
    expect(tenth.x).toBeGreaterThan(first.x);
    expect(eleventh.y).toBeGreaterThan(first.y);
    expect(eleventh.x).toBeCloseTo(first.x, 5);
    // 未滚动时第 51 格（第 6 行）在可视窗口外
    expect(companionCellCenter(layout, 50)).toBeNull();
    // 滚动一行后第 11 格（第 2 行）回到窗口顶部第 1 行
    const scrolled = companionCellCenter(layout, 10, 1);
    expect(scrolled).not.toBeNull();
    expect(scrolled.y).toBeCloseTo(first.y, 5);
  });

  it('面板编辑器三部件行高驱动行高（groupBar/comboRow/stancePanel）', () => {
    const hud = new CompanionGridHud({ system: new CompanionSquadSystem({ now: () => 0 }) });
    hud.layout(1280, 720);
    hud.setPanelDefinition({
      parts: [
        { id: 'groupBar', height: 44 },
        { id: 'comboRow', height: 30 },
        { id: 'stancePanel', height: 267 }
      ]
    });
    hud.layout(1280, 720);
    const layout = hud.getLayout();
    expect(layout.stanceRow.height).toBe(44);
    expect(layout.statusRow.height).toBe(30);
    expect(layout.grid.visibleRows).toBe(10); // 267 → floor((267+3)/27) = 10
  });
});

describe('亲卫队团队框 · 命中与滚动', () => {
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

  it('滚动：滚轮/轨道点击改变滚动行，越界钳制；容量≤一屏时无滑块', () => {
    const { hud, system } = createHud();
    const layout = hud.getLayout();
    const capacity = system.getCapacity(); // command 100 + rank 100 → 容量 100 → 10 行
    expect(capacity).toBe(100);
    // 滚轮向下一行
    expect(hud.handleWheel(120)).toBe(true);
    expect(hud._scrollRow).toBe(1);
    // 滚到尽头后钳制（10 行 - 5 可视 = 最多滚 5 行）
    for (let i = 0; i < 10; i += 1) hud.handleWheel(120);
    expect(hud._scrollRow).toBe(5);
    for (let i = 0; i < 10; i += 1) hud.handleWheel(120);
    expect(hud._scrollRow).toBe(5);
    // 向上滚回顶部
    for (let i = 0; i < 10; i += 1) hud.handleWheel(-120);
    expect(hud._scrollRow).toBe(0);
    // 轨道点击翻行
    hud._scrollRow = 0;
    expect(hud.handleMouseClick(layout.scrollbar.x + 2, layout.scrollbar.y + layout.scrollbar.height - 2)).toBe(true);
    expect(hud._scrollRow).toBe(1);
    // 容量 ≤ 一屏（50）时无滑块
    const smallSystem = new CompanionSquadSystem({ now: () => 0, getCommand: () => 0, getRankValue: () => 0 });
    const smallHud = new CompanionGridHud({ system: smallSystem });
    smallHud.layout(1280, 720);
    expect(smallHud._scrollThumbRect(smallHud.getLayout(), smallSystem.getCapacity())).toBeNull();
  });
});
