/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://github.com/coderaaa/yijian18-engine
 ************************************************************/

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STANDARD_REGISTRY_KINDS, createStandardRegistries } from './Registry.js';
import { DefinitionRepository } from './DefinitionRepository.js';
import { ContentValidator } from './validation/ContentValidator.js';
import {
  CANONICAL_SCHEMAS,
  FORMATION_SCHEMA,
  RANK_SCHEMA,
  RECIPE_SCHEMA,
  UNIT_SCHEMA
} from '../data/schema/CanonicalSchemas.js';

const M0_KINDS = ['recipes', 'unitTypes', 'formations', 'heroes', 'ranks'];

function createValidator() {
  const validator = new ContentValidator();
  CANONICAL_SCHEMAS.forEach(schema => validator.registerSchema(schema));
  return validator;
}

function buildRepository(definitions) {
  const snapshot = {
    revision: 1,
    definitionRevision: 1,
    project: {},
    definitions
  };
  return DefinitionRepository.fromSnapshot(snapshot);
}

function danglingWarnings(repository) {
  return repository.warnings.filter(warning => String(warning.message || '').includes('悬空引用'));
}

function loadLibrary() {
  const file = path.resolve('example/sanguo_zhangjiao/project/library.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('M0 · Registry 五类新 kind', () => {
  it('STANDARD_REGISTRY_KINDS 含 recipes/unitTypes/formations/heroes/ranks', () => {
    for (const kind of M0_KINDS) expect(STANDARD_REGISTRY_KINDS).toContain(kind);
  });

  it('空库也能创建 5 个 Registry 实例且不抛错', () => {
    const registries = createStandardRegistries();
    for (const kind of M0_KINDS) {
      expect(registries[kind]).toBeTruthy();
      expect(typeof registries[kind].all).toBe('function');
      expect(registries[kind].all()).toEqual([]);
      expect(registries[kind].size).toBe(0);
    }
  });
});

describe('M0 · Schema（必填报错 / 新字段可选）', () => {
  const validator = createValidator();

  it('必填缺失报错', () => {
    expect(validator.validate({ id: 'x' }, 'formation').ok).toBe(false);      // 缺 name/unitIds
    expect(validator.validate({ id: 'x', title: '伍长' }, 'rank').ok).toBe(false); // 缺 value
    expect(validator.validate({ id: 'x', name: '配方' }, 'recipe').ok).toBe(false); // 缺 station/inputs/outputs
  });

  it('新可选字段缺省即通过（旧数据零影响）', () => {
    expect(validator.validate({
      schemaVersion: 2,
      id: 'unit.u1',
      name: '甲',
      unitType: 'unit.spear',
      factionId: 'yellow_turban'
    }, 'unit').ok).toBe(true);
  });

  it('新字段合法值通过、非法值被拒', () => {
    const formation = {
      schemaVersion: 2,
      id: 'formation.t',
      name: '测试阵',
      unitIds: ['unit.spear'],
      modifiers: { attack: 1.15, defense: 0.95 }
    };
    expect(validator.validate(formation, 'formation').ok).toBe(true);
    expect(validator.validate({ ...formation, modifiers: 'bad' }, 'formation').ok).toBe(false);

    const rank = { schemaVersion: 2, id: 'rank.t', title: '伍长', value: 5, kind: 'post' };
    expect(validator.validate(rank, 'rank').ok).toBe(true);
    expect(validator.validate({ ...rank, value: 101 }, 'rank').ok).toBe(false);
    expect(validator.validate({ ...rank, kind: 'title' }, 'rank').ok).toBe(false);
  });

  it('UNIT_SCHEMA 的克制/升级字段是可选扩面', () => {
    expect(UNIT_SCHEMA.fields.dealMultiplier.required).toBeFalsy();
    expect(UNIT_SCHEMA.fields.damageTakenFrom.required).toBeFalsy();
    expect(UNIT_SCHEMA.fields.upgradeFrom.required).toBeFalsy();
    expect(FORMATION_SCHEMA.fields.modifiers.required).toBeFalsy();
    expect(RECIPE_SCHEMA.fields.kind.enum).toEqual(['craft', 'forge', 'repair']);
    expect(RANK_SCHEMA.fields.kind.enum).toEqual(['post']);
  });
});

describe('M0 · 跨库引用校验只 warn 不阻断', () => {
  it('悬空 formationId / commanderHeroId / unitId / rankId 各 1 条 warn，且仓库仍成功创建', () => {
    const repository = buildRepository({
      battles: [{ id: 'b1', formationIds: ['formation.missing'], commanderHeroId: 'hero.missing' }],
      formations: [{ id: 'formation.f1', name: '阵', unitIds: ['unit.missing'], leaderHeroId: 'hero.missing2' }],
      heroes: [{ id: 'hero.h1', name: '将', rankId: 'rank.missing' }],
      unitTypes: [],
      ranks: []
    });
    const warnings = danglingWarnings(repository);
    expect(warnings).toHaveLength(5);
    const paths = warnings.map(warning => warning.path).join('\n');
    expect(paths).toContain('battles[0].formationIds[0]');
    expect(paths).toContain('battles[0].commanderHeroId');
    expect(paths).toContain('library.formations[0].unitIds[0]');
    expect(paths).toContain('library.formations[0].leaderHeroId');
    expect(paths).toContain('library.heroes[0].rankId');
  });

  it('引用齐全时零悬空告警', () => {
    const repository = buildRepository({
      battles: [{ id: 'b1', formationIds: ['formation.f1'], commanderHeroId: 'hero.h1' }],
      formations: [{ id: 'formation.f1', name: '阵', unitIds: ['unit.spear'], leaderHeroId: 'hero.h1' }],
      heroes: [{ id: 'hero.h1', name: '将', rankId: 'rank.r1' }],
      unitTypes: [{ id: 'unit.spear', name: '枪兵' }],
      ranks: [{ id: 'rank.r1', title: '伍长', value: 5 }]
    });
    expect(danglingWarnings(repository)).toHaveLength(0);
  });
});

describe('M0 · 真实内容库数据', () => {
  const library = loadLibrary();

  it('五类数据量与文档一致', () => {
    expect(library.formations).toHaveLength(14);
    expect(library.heroes).toHaveLength(14);
    expect(library.unitTypes).toHaveLength(7);
    expect(library.ranks).toHaveLength(21);
  });

  it('占位数据已标注（tags 含 m0.placeholder）', () => {
    for (const entry of [...library.formations, ...library.heroes, ...library.unitTypes]) {
      expect(entry.tags).toContain('m0.placeholder');
    }
  });

  it('14 份 battle 的 formationIds/commanderHeroId 全部可解析（28 处悬空已闭）', () => {
    const formations = new Set(library.formations.map(entry => entry.id));
    const heroes = new Set(library.heroes.map(entry => entry.id));
    const dir = path.resolve('example/sanguo_zhangjiao/config/battles');
    const missing = [];
    for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.json'))) {
      const battle = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      for (const army of [battle.attackerArmy, battle.defenderArmy]) {
        if (!army) continue;
        for (const id of army.formationIds || []) if (!formations.has(id)) missing.push(`${file}:${id}`);
        if (army.commanderHeroId && !heroes.has(army.commanderHeroId)) missing.push(`${file}:${army.commanderHeroId}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('formations→unitTypes、heroes→ranks 引用完整', () => {
    const unitTypes = new Set(library.unitTypes.map(entry => entry.id));
    const ranks = new Set(library.ranks.map(entry => entry.id));
    const heroes = new Set(library.heroes.map(entry => entry.id));
    for (const formation of library.formations) {
      for (const id of formation.unitIds) expect(unitTypes.has(id)).toBe(true);
      if (formation.leaderHeroId) expect(heroes.has(formation.leaderHeroId)).toBe(true);
    }
    for (const hero of library.heroes) {
      if (hero.rankId) expect(ranks.has(hero.rankId)).toBe(true);
    }
  });

  it('官职阶梯 21 级等距 +5、100 = 大将军唯一顶点、全部 kind=post', () => {
    const values = library.ranks.map(rank => rank.value);
    expect(values).toEqual(Array.from({ length: 21 }, (_, index) => index * 5));
    expect(library.ranks[0].value).toBe(0);
    expect(library.ranks.at(-1)).toMatchObject({ id: 'rank.dajiangjun', title: '大将军', value: 100 });
    expect(library.ranks.filter(rank => rank.value === 100)).toHaveLength(1);
    expect(library.ranks.every(rank => rank.kind === 'post')).toBe(true);
  });
});
