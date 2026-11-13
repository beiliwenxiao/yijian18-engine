// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { WorldMapRoadLayer } from './WorldMapRoadLayer.js';

const METRICS = Object.freeze({ thumbW: 100, thumbH: 50, labelH: 20, gap: 2 });

const REGION = Object.freeze({
  id: 'region.test',
  cols: 2,
  rows: 2,
  grid: [
    [{ terrain: 'plain', road: true, poi: 'pass' }, { terrain: 'plain', road: true }],
    [{ terrain: 'plain' }, { terrain: 'plain', poi: 'ferry' }]
  ],
  roadEdges: [[[0, 0], [0, 1]]]
});

function makeGrid(rows, cols) {
  const grid = document.createElement('div');
  grid.className = 'wme-grid';
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = document.createElement('div');
      cell.className = 'wme-cell';
      cell.dataset.r = String(row);
      cell.dataset.c = String(col);
      grid.appendChild(cell);
    }
  }
  document.body.appendChild(grid);
  return grid;
}

describe('WorldMapRoadLayer 路网图层', () => {
  it('把 roadEdges 画在相邻两格中心之间，并区分关隘/渡口标识', () => {
    const grid = makeGrid(2, 2);
    const layer = new WorldMapRoadLayer({ gridEl: grid });
    layer.setVisible(true).render(REGION, METRICS);

    const line = grid.querySelector('.wmr-edge');
    expect(line).toBeTruthy();
    expect(line.getAttribute('x1')).toBe('50');
    expect(line.getAttribute('y1')).toBe('45');
    expect(line.getAttribute('x2')).toBe('152');
    expect(line.getAttribute('y2')).toBe('45');
    expect(grid.querySelector('.wmr-poi-pass')).toBeTruthy();
    expect(grid.querySelector('.wmr-poi-ferry')).toBeTruthy();
  });

  it('删除模式点中命中线回报索引，连线模式两次点格回报端点', () => {
    const grid = makeGrid(2, 2);
    const onChange = vi.fn();
    const layer = new WorldMapRoadLayer({ gridEl: grid, onChange });

    layer.setVisible(true).setMode('delete').render(REGION, METRICS);
    grid.querySelector('[data-road-edge-index="0"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith({ type: 'delete', index: 0 });

    onChange.mockClear();
    layer.setMode('connect').render(REGION, METRICS);
    const cells = grid.querySelectorAll('.wme-cell');
    cells[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    cells[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith({ type: 'connect', a: [0, 0], b: [0, 1] });
  });

  it('关闭时隐藏且不响应格点击', () => {
    const grid = makeGrid(2, 2);
    const onChange = vi.fn();
    const layer = new WorldMapRoadLayer({ gridEl: grid, onChange });
    layer.render(REGION, METRICS);
    grid.querySelectorAll('.wme-cell')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
