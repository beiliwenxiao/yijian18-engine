import { describe, it, expect } from 'vitest';
import {
  SupplyStatusBar,
  SUPPLY_WARN_DAYS,
  normalizeSupplyEntries,
  resolveSupplyTone,
  formatSupplyText
} from './SupplyStatusBar.js';
import { CityStateSummaryPanel } from './CityStateSummaryPanel.js';

function makeCtx() {
  const texts = [];
  const ctx = {
    texts,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    save() {},
    restore() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    stroke() {},
    fillText(text) { texts.push(String(text)); }
  };
  return ctx;
}

describe('SupplyStatusBar', () => {
  it('归一化条目：过滤非法项，识别军团/军营', () => {
    const entries = normalizeSupplyEntries([
      { armyId: 'army.a', name: '前军', days: 4, state: 'normal' },
      { campId: 'camp.1', stock: 120 },
      null,
      { foo: 1 }
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'army', id: 'army.a', name: '前军', days: 4 });
    expect(entries[1]).toMatchObject({ kind: 'camp', id: 'camp.1', stock: 120 });
  });

  it('告警阈值：<3 日或非 normal 转红，军营空库存转红', () => {
    expect(SUPPLY_WARN_DAYS).toBe(3);
    expect(resolveSupplyTone({ kind: 'army', days: 2, state: 'normal' })).toBe('#e05a5a');
    expect(resolveSupplyTone({ kind: 'army', days: 3, state: 'normal' })).toBe('#eee4cf');
    expect(resolveSupplyTone({ kind: 'army', days: 99, state: 'tight' })).toBe('#e05a5a');
    expect(resolveSupplyTone({ kind: 'camp', stock: 0 })).toBe('#e05a5a');
    expect(resolveSupplyTone({ kind: 'camp', stock: 50 })).toBe('#eee4cf');
  });

  it('文本格式：军团剩 N 日/充足，军营存粮 N', () => {
    expect(formatSupplyText({ kind: 'army', days: 4.8 })).toBe('还剩 4 日');
    expect(formatSupplyText({ kind: 'army', days: Infinity })).toBe('粮草充足');
    expect(formatSupplyText({ kind: 'camp', stock: 12.9 })).toBe('存粮 12');
  });

  it('渲染条目并在超高时显示折叠数量', () => {
    const bar = new SupplyStatusBar({ width: 232, height: 76, visible: true });
    bar.setEntries([
      { armyId: 'army.a', name: '前军', days: 10 },
      { armyId: 'army.b', name: '后军', days: 2 },
      { armyId: 'army.c', name: '左军', days: 5 }
    ]);
    const ctx = makeCtx();
    bar.render(ctx);
    expect(ctx.texts[0]).toBe('军需');
    expect(ctx.texts).toContain('前军  还剩 10 日');
    expect(ctx.texts.some(text => text.startsWith('+'))).toBe(true);

    const hidden = new SupplyStatusBar({ visible: false });
    hidden.setEntries([{ armyId: 'army.a' }]);
    const emptyCtx = makeCtx();
    hidden.render(emptyCtx);
    expect(emptyCtx.texts).toHaveLength(0);
  });
});

describe('CityStateSummaryPanel 城况行', () => {
  it('提供 siegeStatus/stockDays 时渲染城况，旧快照不渲染', () => {
    const panel = new CityStateSummaryPanel({ visible: true });
    panel.setSnapshot({
      cityName: '广宗',
      currentDay: 3,
      resources: { food: 1, wood: 2, herb: 3, iron: 4 },
      morale: 70,
      reputation: 12,
      siegeStatus: 'siege',
      stockDays: 5
    });
    const ctx = makeCtx();
    panel.render(ctx);
    expect(ctx.texts.some(text => text.includes('围城中') && text.includes('存粮 5 日'))).toBe(true);

    panel.setSnapshot({ cityName: '广宗', currentDay: 3, resources: {} });
    const plainCtx = makeCtx();
    panel.render(plainCtx);
    expect(plainCtx.texts.some(text => text.startsWith('城况'))).toBe(false);
  });
});
