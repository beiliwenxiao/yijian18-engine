import { describe, it, expect } from 'vitest';
import {
  FORMATION_STRATEGIES,
  STRATEGY_TEMPLATES,
  resolveFormation,
  buildDeploySlots,
  assignDeploySlots,
  resolveStanceForRole,
  resolveTerrainFit,
  normalizeStrategy,
  validateFormation
} from './FormationResolver.js';

const wedgeDef = {
  id: 'formation.s03.yellow_turban.vanguard',
  name: '黄巾先军·锋矢',
  unitIds: ['unit.spear', 'unit.shield', 'unit.archer'],
  leaderHeroId: 'hero.zhangjiao',
  rows: 3,
  columns: 3,
  strategy: 'wedge',
  modifiers: { attack: 1.15, defense: 0.95 }
};

describe('FormationResolver.normalizeStrategy', () => {
  it('六种规范策略原样返回', () => {
    expect(FORMATION_STRATEGIES).toEqual(['line', 'wedge', 'crane', 'fishscale', 'circle', 'echelon']);
    for (const strategy of FORMATION_STRATEGIES) {
      expect(normalizeStrategy(strategy)).toEqual({ strategy, code: null });
    }
  });

  it('历史策略走别名并保留请求值', () => {
    expect(normalizeStrategy('pursuit')).toEqual({ strategy: 'echelon', code: null, alias: 'pursuit' });
    expect(normalizeStrategy('siege').strategy).toBe('fishscale');
    expect(normalizeStrategy('hold').strategy).toBe('circle');
  });

  it('未知策略回落 line 并给出告警码', () => {
    expect(normalizeStrategy('phalanx')).toEqual({ strategy: 'line', code: 'unknownStrategy', requested: 'phalanx' });
  });
});

describe('FormationResolver.resolveFormation', () => {
  it('旧内容（rows:number + unitIds）按兵种顺序铺成多行', () => {
    const resolved = resolveFormation(wedgeDef);
    expect(resolved.strategy).toBe('wedge');
    expect(resolved.rows).toHaveLength(3);
    expect(resolved.rows.flatMap(row => row.slots)).toEqual(['unit.spear', 'unit.shield', 'unit.archer']);
    // 旧内容的 columns 只是历史提示：实际列宽取行内最大槽位数
    expect(resolved.columns).toBe(1);
    expect(resolved.warnings).toEqual([]);
  });

  it('rowSlots 与 rows 数组同义（schema 里 rows 仍是 INTEGER）', () => {
    const resolved = resolveFormation({
      id: 'f1b',
      strategy: 'line',
      unitIds: ['unit.spear'],
      rowSlots: [{ line: 0, role: 'front', slots: ['unit.spear', 'unit.archer'] }]
    });
    expect(resolved.rows).toHaveLength(1);
    expect(resolved.columns).toBe(2);
  });

  it('显式 rows 数组优先于 unitIds', () => {
    const resolved = resolveFormation({
      id: 'f1',
      strategy: 'crane',
      unitIds: ['unit.spear'],
      rows: [
        { line: 0, role: 'front', slots: ['unit.spear', 'unit.shield'] },
        { line: 1, role: 'rear', slots: ['unit.archer', 'unit.archer'] }
      ]
    });
    expect(resolved.rows).toHaveLength(2);
    expect(resolved.rows[0].slots).toEqual(['unit.spear', 'unit.shield']);
    expect(resolved.columns).toBe(2);
  });

  it('没有 rows 与 unitIds 时按策略模板生成，槽位总数=unitCount', () => {
    const resolved = resolveFormation({ id: 'f2', strategy: 'echelon' }, { unitCount: 6 });
    const total = resolved.rows.reduce((sum, row) => sum + row.slots.length, 0);
    expect(total).toBe(6);
    expect(resolved.rows.map(row => row.role)).toEqual(['front', 'mid', 'rear']);
  });

  it('内容 modifiers 透传为 combat；缺失时取模板默认', () => {
    const custom = resolveFormation(wedgeDef);
    expect(custom.combat.attack).toBe(1.15);
    expect(custom.combat.defense).toBe(0.95);
    const template = resolveFormation({ id: 'f3', strategy: 'circle' });
    expect(template.combat.defense).toBe(STRATEGY_TEMPLATES.circle.combat.defense);
    expect(template.combat.speed).toBeLessThan(1);
  });

  it('别名策略不告警，未知策略告警', () => {
    expect(resolveFormation({ id: 'f4', strategy: 'ambush' }).warnings).toEqual([]);
    const unknown = resolveFormation({ id: 'f5', strategy: 'phalanx' });
    expect(unknown.strategy).toBe('line');
    expect(unknown.warnings.map(w => w.code)).toContain('unknownStrategy');
  });

  it('空定义不抛错并给出空阵型', () => {
    const resolved = resolveFormation(null);
    expect(resolved.strategy).toBe('line');
    expect(Array.isArray(resolved.rows)).toBe(true);
    expect(resolveFormation({}).warnings).toEqual([]);
  });

  it('行宽与 columns 不一致时给出提醒', () => {
    const resolved = resolveFormation({
      id: 'f6',
      columns: 3,
      strategy: 'line',
      rows: [{ line: 0, role: 'front', slots: ['unit.spear'] }]
    });
    expect(resolved.warnings.map(w => w.code)).toContain('rowWidthMismatch');
  });
});

describe('FormationResolver.buildDeploySlots', () => {
  it('按行列生成坐标：后行 y 更小，窄行居中', () => {
    const resolved = resolveFormation({
      id: 'f7',
      strategy: 'wedge',
      rows: [
        { line: 0, role: 'front', slots: ['unit.spear'] },
        { line: 1, role: 'mid', slots: ['unit.shield', 'unit.shield', 'unit.shield'] }
      ],
      stackOffsets: { rowGap: 50, colGap: 40 }
    });
    const slots = buildDeploySlots(resolved, { originX: 100, originY: 200 });
    expect(slots).toHaveLength(4);
    const front = slots[0];
    const midFirst = slots[1];
    expect(front.role).toBe('front');
    // 窄行（1 槽）在 columns=3 里居中：偏移 (3-1)*40/2 = 40
    expect(front.x).toBe(140);
    expect(front.y).toBe(200);
    expect(midFirst.x).toBe(100);
    expect(midFirst.y).toBe(150);
    expect(slots.map(slot => slot.index)).toEqual([0, 1, 2, 3]);
  });
});

describe('FormationResolver.assignDeploySlots', () => {
  const slots = [
    { slotId: 's0', unitTypeId: 'unit.archer' },
    { slotId: 's1', unitTypeId: 'unit.spear' },
    { slotId: 's2', unitTypeId: 'unit.spear' }
  ];

  it('同兵种优先占位，无兵种的实体补剩余槽位', () => {
    const entities = [
      { id: 'e1', unitTypeId: 'unit.spear' },
      { id: 'e2', unitTypeId: 'unit.archer' },
      { id: 'e3' }
    ];
    const assigned = assignDeploySlots(slots, entities);
    expect(assigned.find(item => item.entity.id === 'e1').slot.slotId).toBe('s1');
    expect(assigned.find(item => item.entity.id === 'e2').slot.slotId).toBe('s0');
    expect(assigned.find(item => item.entity.id === 'e3').slot.slotId).toBe('s2');
  });

  it('实体多于槽位时多余实体 slot=null（不丢实体）', () => {
    const assigned = assignDeploySlots(slots, [1, 2, 3, 4].map(index => ({ id: `e${index}` })));
    expect(assigned).toHaveLength(4);
    expect(assigned[3].slot).toBeNull();
  });
});

describe('FormationResolver 角色与地形', () => {
  it('姿态默认 front=assault / rear=escort，定义可覆盖', () => {
    expect(resolveStanceForRole({}, 'front')).toBe('assault');
    expect(resolveStanceForRole({}, 'rear')).toBe('escort');
    expect(resolveStanceForRole({ stanceByRole: { front: 'garrison' } }, 'front')).toBe('garrison');
  });

  it('地形契合只做三态提示', () => {
    const resolved = resolveFormation({ id: 'f8', strategy: 'circle' });
    expect(resolveTerrainFit(resolved, ['pass'])).toBe('fit');
    expect(resolveTerrainFit(resolved, ['open'])).toBe('miss');
    expect(resolveTerrainFit(resolved, ['forest'])).toBe('neutral');
  });
});

describe('FormationResolver.validateFormation', () => {
  it('兵种不在 unitTypes 表 → unknownUnitType', () => {
    const result = validateFormation(wedgeDef, { unitTypeIds: ['unit.spear', 'unit.shield'] });
    expect(result.ok).toBe(true);
    expect(result.warnings.map(w => w.code)).toContain('unknownUnitType');
  });

  it('未知策略与行宽不一致同时告警，且不判失败', () => {
    const result = validateFormation({
      id: 'f9', strategy: 'phalanx', columns: 3, rows: [{ line: 0, role: 'front', slots: ['unit.spear'] }]
    });
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain('unknownStrategy');
    expect(codes).toContain('rowWidthMismatch');
    expect(result.ok).toBe(true);
  });
});
