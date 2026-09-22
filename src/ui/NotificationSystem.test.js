import { describe, expect, it } from 'vitest';
import { NotificationSystem } from './NotificationSystem.js';

function createMockCtx() {
  const calls = { fillRect: [], strokeRect: [], fillText: [] };
  return {
    calls,
    font: '',
    globalAlpha: 1,
    textAlign: '',
    textBaseline: '',
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    measureText: () => ({ width: 50 }),
    fillRect: (x, y, w, h) => calls.fillRect.push({ x, y, w, h }),
    strokeRect: (x, y, w, h) => calls.strokeRect.push({ x, y, w, h }),
    fillText: (text, x, y) => calls.fillText.push({ text, x, y }),
    save: () => {},
    restore: () => {}
  };
}

describe('NotificationSystem 通知位置', () => {
  it('未设置 anchorBottom 时维持旧行为：从 this.y 向下堆叠', () => {
    const system = new NotificationSystem({ x: 10, y: 96 });
    system.addNotification('旧位置提示', 'success');
    const ctx = createMockCtx();
    system.render(ctx);
    expect(ctx.calls.fillRect[0].y).toBe(96);
  });

  it('anchorBottom 模式：单条通知底边贴住锚点', () => {
    const system = new NotificationSystem({ x: 10, anchorBottom: 500 });
    system.addNotification('获得 荒野酸果 ×2', 'success');
    const ctx = createMockCtx();
    system.render(ctx);
    // 通知高 30：底边 = 500 → 顶 y = 470
    expect(ctx.calls.fillRect[0].y).toBe(470);
    expect(ctx.calls.fillRect[0].y + ctx.calls.fillRect[0].h).toBe(500);
  });

  it('anchorBottom 模式：多条通知最新在最下、向上生长', () => {
    const system = new NotificationSystem({ x: 10, anchorBottom: 500 });
    system.addNotification('第一条', 'success');
    system.addNotification('第二条', 'info');
    const ctx = createMockCtx();
    system.render(ctx);
    // 行距 = 30 + 5 = 35：两条占 70 → 首条顶 y = 500 - 70 + 5 = 435，第二条顶 y = 470（底边恰贴 500）
    expect(ctx.calls.fillRect[0].y).toBe(435);
    expect(ctx.calls.fillRect[1].y).toBe(470);
    expect(ctx.calls.fillText[1].text).toBe('第二条');
  });

  it('通知数量增长时顶部上移、底边不变', () => {
    const system = new NotificationSystem({ x: 10, anchorBottom: 500 });
    system.addNotification('A', 'success');
    const ctx1 = createMockCtx();
    system.render(ctx1);
    system.addNotification('B', 'success');
    const ctx2 = createMockCtx();
    system.render(ctx2);
    // 第二条（B）渲染位置 = 单条时 A 的位置（底边不动）
    expect(ctx2.calls.fillRect[1].y).toBe(ctx1.calls.fillRect[0].y);
  });
});
