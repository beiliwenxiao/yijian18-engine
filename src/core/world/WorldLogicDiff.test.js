import { describe, expect, it } from 'vitest';
import {
  adoptAllOfCategory,
  adoptAuto,
  buildDiff
} from './WorldLogicDiff.js';

function manualLogic() {
  return {
    nodes: [
      {
        id: 'city.a', kind: 'city', name: '甲城',
        position: { x: 100, y: 100 }, ownerFactionId: 'x', level: 1,
        ref: { id: 'city.a_state' }
      },
      {
        id: 'pass.b', kind: 'pass', name: '乙关',
        position: { x: 300, y: 100 }, level: 1, tollRate: 0.05,
        ref: { id: 'pass.b' }
      },
      { id: 'bridge.c', kind: 'bridge', position: { x: 200, y: 100 } }
    ],
    edges: [
      { id: 'e1', from: 'city.a', to: 'pass.b', weight: 200, mode: 'road', bidirectional: true },
      { id: 'e2', from: 'pass.b', to: 'bridge.c', cost: 100, mode: 'road' }
    ]
  };
}

function autoLayer() {
  return {
    revision: 7,
    nodes: [
      {
        id: 'city.a', kind: 'city', name: '甲城（自动名）',
        position: { x: 100, y: 100 }, ownerFactionId: 'y', level: 2,
        ref: { id: 'city.a_state' }
      },
      {
        id: 'pass.b', kind: 'pass', name: '乙关',
        position: { x: 300, y: 100 }, level: 1, tollRate: 0.05,
        ref: { id: 'pass.b' }
      },
      { id: 'ferry.d', kind: 'ferry', name: '丙渡', position: { x: 500, y: 100 } }
    ],
    edges: [
      { id: 'auto.e1', from: 'city.a', to: 'ferry.d', cost: 400, mode: 'ferry' },
      { id: 'auto.e2', from: 'pass.b', to: 'city.a', weight: 200, mode: 'road' }
    ]
  };
}

describe('WorldLogicDiff 三类差异', () => {
  it('分出 autoOnly / manualOnly / changed 三类', () => {
    const diff = buildDiff(autoLayer(), manualLogic());
    expect(diff.counts.autoOnly).toBe(2); // ferry.d 节点 + auto.e1 边
    expect(diff.counts.manualOnly).toBe(2); // bridge.c 节点 + e2 边
    expect(diff.counts.changed).toBe(1); // city.a 归属/等级变化
    expect(diff.total).toBe(5);
    expect(diff.autoRevision).toBe(7);
  });

  it('changed 只列变化字段，name 不参与判定', () => {
    const diff = buildDiff(autoLayer(), manualLogic());
    const entry = diff.categories.changed[0];
    const names = entry.fields.map(field => field.name);
    expect(names).toContain('ownerFactionId');
    expect(names).toContain('level');
    expect(names).not.toContain('name');
    const byName = Object.fromEntries(entry.fields.map(field => [field.name, field]));
    expect(byName.ownerFactionId.autoValue).toBe('y');
    expect(byName.ownerFactionId.manualValue).toBe('x');
  });

  it('autoOnly / manualOnly 也并排给出两侧值（缺的一侧为 null）', () => {
    const diff = buildDiff(autoLayer(), manualLogic());
    const autoNode = diff.categories.autoOnly.find(entry => entry.target === 'node');
    expect(autoNode.fields.every(field => field.manualValue === null)).toBe(true);
    expect(autoNode.fields.find(field => field.name === 'kind').autoValue).toBe('ferry');
    const manualNode = diff.categories.manualOnly.find(entry => entry.target === 'node');
    expect(manualNode.fields.every(field => field.autoValue === null)).toBe(true);
  });

  it('边按端点匹配：id 不同但连通关系一致不算差异（weight/cost 同口径）', () => {
    const diff = buildDiff(autoLayer(), manualLogic());
    expect(diff.categories.changed.some(entry => entry.target === 'edge')).toBe(false);
    expect(diff.categories.autoOnly.some(entry => entry.id === 'auto.e2')).toBe(false);
  });

  it('边 id 相同但端点/权重变化 → changed 列出 from/to/cost', () => {
    const auto = autoLayer();
    auto.edges.push({ id: 'e1', from: 'city.a', to: 'ferry.d', cost: 260, mode: 'road' });
    const diff = buildDiff(auto, manualLogic());
    const edgeEntry = diff.categories.changed.find(entry => entry.target === 'edge');
    const names = edgeEntry.fields.map(field => field.name);
    expect(names).toContain('to');
    expect(names).toContain('cost');
  });

  it('忽略/保留的 key 从列表隐藏但不改原始逻辑', () => {
    const manual = manualLogic();
    const before = JSON.stringify(manual);
    const diff = buildDiff(autoLayer(), manual, { ignoredKeys: ['node:auto:ferry.d'] });
    expect(diff.categories.autoOnly.some(entry => entry.key === 'node:auto:ferry.d')).toBe(false);
    expect(diff.hidden).toBe(1);
    expect(JSON.stringify(manual)).toBe(before);
  });
});

describe('WorldLogicDiff 采纳动作', () => {
  it('采纳 autoOnly 节点：写 source=manual + autoRevision', () => {
    const diff = buildDiff(autoLayer(), manualLogic());
    const entry = diff.categories.autoOnly.find(item => item.target === 'node');
    const result = adoptAuto(autoLayer(), manualLogic(), entry);
    expect(result.ok).toBe(true);
    const added = result.logic.nodes.find(node => node.id === 'ferry.d');
    expect(added).toMatchObject({ source: 'manual', autoRevision: 7, kind: 'ferry' });
  });

  it('采纳 autoOnly 边：端点缺失时拒绝，补节点后成功', () => {
    const diff = buildDiff(autoLayer(), manualLogic());
    const edgeEntry = diff.categories.autoOnly.find(item => item.target === 'edge');
    const rejected = adoptAuto(autoLayer(), manualLogic(), edgeEntry);
    expect(rejected.ok).toBe(false);
    expect(rejected.code).toBe('missingEndpoint');
    expect(rejected.missing).toEqual(['ferry.d']);

    const nodeEntry = diff.categories.autoOnly.find(item => item.target === 'node');
    const withNode = adoptAuto(autoLayer(), manualLogic(), nodeEntry).logic;
    const accepted = adoptAuto(autoLayer(), withNode, edgeEntry);
    expect(accepted.ok).toBe(true);
    expect(accepted.logic.edges.some(edge => edge.id === 'auto.e1')).toBe(true);
  });

  it('采纳 changed 节点：覆盖比较字段，保留人工 id/name', () => {
    const diff = buildDiff(autoLayer(), manualLogic());
    const entry = diff.categories.changed.find(item => item.target === 'node');
    const result = adoptAuto(autoLayer(), manualLogic(), entry);
    expect(result.ok).toBe(true);
    const node = result.logic.nodes.find(item => item.id === 'city.a');
    expect(node.ownerFactionId).toBe('y');
    expect(node.level).toBe(2);
    expect(node.name).toBe('甲城');
    expect(node.source).toBe('manual');
  });

  it('采纳 manualOnly 节点：删除节点并级联删边', () => {
    const diff = buildDiff(autoLayer(), manualLogic());
    const entry = diff.categories.manualOnly.find(item => item.target === 'node');
    const result = adoptAuto(autoLayer(), manualLogic(), entry);
    expect(result.ok).toBe(true);
    expect(result.logic.nodes.some(node => node.id === 'bridge.c')).toBe(false);
    expect(result.logic.edges.some(edge => edge.id === 'e2')).toBe(false);
    expect(result.removedEdgeIds).toEqual(['e2']);
  });

  it('单类全部采纳：节点先于边，只处理该类别', () => {
    const diff = buildDiff(autoLayer(), manualLogic());
    const result = adoptAllOfCategory(autoLayer(), manualLogic(), 'autoOnly', diff.categories.autoOnly);
    expect(result.ok).toBe(true);
    expect(result.applied.length).toBe(2);
    expect(result.skipped).toEqual([]);
    const ids = result.logic.nodes.map(node => node.id);
    expect(ids).toContain('ferry.d');
    expect(ids).toContain('bridge.c'); // 其它类别未被吞掉
    expect(result.logic.edges.some(edge => edge.id === 'e1')).toBe(true);
  });

  it('原地对象不被修改（返回新 logic）', () => {
    const manual = manualLogic();
    const before = JSON.stringify(manual);
    const diff = buildDiff(autoLayer(), manual);
    adoptAuto(autoLayer(), manual, diff.categories.autoOnly[0]);
    expect(JSON.stringify(manual)).toBe(before);
  });
});
