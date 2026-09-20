// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TaskGraphProjectionView } from './TaskGraphProjectionView.js';

function createCtx() {
  const calls = { fillRect: [], fillText: [] };
  const ctx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    fillRect: (...args) => calls.fillRect.push(args),
    strokeRect: () => {},
    fillText: (text, ...rest) => calls.fillText.push([text, ...rest]),
    fillStyle: null,
    strokeStyle: null,
    lineWidth: 0,
    font: '',
    textAlign: 'left',
    textBaseline: 'middle'
  };
  ctx._calls = calls;
  return ctx;
}

function createView(nodeCount = 2) {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    nodeId: `node-${index}`,
    label: `目标 ${index + 1}`,
    status: index === 0 ? 'active' : 'available',
    isObjective: true,
    currentCount: 0,
    requiredCount: 1
  }));
  return new TaskGraphProjectionView({
    getTaskGraph: () => ({
      getProjection: () => [{
        instanceId: 'task:1',
        title: '荒原求生',
        currentCount: 0,
        requiredCount: nodeCount,
        nodes
      }]
    }),
    getActorId: () => 'player-1'
  });
}

describe('TaskGraphProjectionView 任务框自适应高度', () => {
  const contentLinesOf = ctx => ctx._calls.fillText
    .filter(([text]) => !/^\d+\/\d+$/.test(String(text))).length;

  it('框高贴合内容行数，不占满布局矩形、不留空行', () => {
    const view = createView(2); // 标题 + 任务 + 2 个节点 = 4 行内容
    const ctx = createCtx();
    const rect = { x: 20, y: 20, width: 260, height: 400 };
    expect(view.render(ctx, rect)).toBe(true);
    const [, , , paintedHeight] = ctx._calls.fillRect[0];
    // lineHeight = max(16, min(22, 400/7=57)) = 22；paddingY = max(6, min(12, 400/14=28)) = 12
    // boxHeight = 12*2 + 4*22 = 112，远小于矩形 400
    expect(paintedHeight).toBe(112);
    expect(paintedHeight).toBeLessThan(rect.height);
    // 文本行数 = 内容 4 行（进度数字是每行的第二次 fillText，不计）
    expect(contentLinesOf(ctx)).toBe(4);
  });

  it('内容超出布局矩形时按矩形高度截断，不越界绘制', () => {
    const view = createView(20); // 标题 + 任务 + 20 节点（每任务最多渲染 3 个节点）
    const ctx = createCtx();
    const rect = { x: 20, y: 20, width: 260, height: 120 };
    expect(view.render(ctx, rect)).toBe(true);
    const [, , , paintedHeight] = ctx._calls.fillRect[0];
    expect(paintedHeight).toBeLessThanOrEqual(rect.height);
    // 内容行 = 标题 + 任务 + min(20, 3) 个节点 = 5 行，未超出 6 行的矩形容量
    expect(contentLinesOf(ctx)).toBe(5);
    expect(paintedHeight).toBe(Math.min(rect.height, 18 + 5 * 17));
  });
});
