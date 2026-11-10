/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-11-10
 ************************************************************/

/**
 * M3 内容契约测试：3A 随行小队规则 / 3B 战略指令表 + 运行态 schema、项目字段声明。
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContentValidator } from './validation/ContentValidator.js';
import {
  CANONICAL_SCHEMAS,
  CANONICAL_SCHEMA_VERSION,
  COMPANION_SQUAD_SCHEMA,
  ARMY_STATE_SCHEMA,
  GAME_PROJECT_SCHEMA
} from '../data/schema/CanonicalSchemas.js';
import { ARMY_ORDER_TYPES } from '../systems/ArmyOrderSystem.js';

const ROOT = 'example/sanguo_zhangjiao';
const loadJson = relative => JSON.parse(fs.readFileSync(path.resolve(ROOT, relative), 'utf8'));

const library = loadJson('project/library.json');
const project = loadJson('game.project.json');

const validator = new ContentValidator({
  schemas: Object.fromEntries(CANONICAL_SCHEMAS.map(schema => [schema.id, schema])),
  supportedVersion: CANONICAL_SCHEMA_VERSION
});

describe('M3 3A · 随行小队规则', () => {
  it('companionRule 声明统率来源 / 初始官职 / 补位与冲锋计时 / 士气表', () => {
    const rule = project.companionRule;
    expect(rule).toBeTruthy();
    expect(typeof rule.heroId).toBe('string');
    expect(typeof rule.initialRankId).toBe('string');
    expect(rule.capacityMax).toBe(100);
    expect(rule.reinforceDelayMs).toBeGreaterThan(0);
    expect(rule.chargeDurationMs).toBeGreaterThan(0);
    for (const key of ['initial', 'deathPenalty', 'deathCapPerBattle', 'victoryBonus',
      'fleePenalty', 'restBonus', 'campBonus', 'idleDaysBeforeDecay', 'decayPerDay', 'floor', 'lowThreshold']) {
      expect(typeof rule.morale[key]).toBe('number');
    }
    expect(rule.morale.floor).toBeLessThan(rule.morale.lowThreshold);
    expect(rule.morale.lowThreshold).toBeLessThan(rule.morale.initial);
    expect(rule.morale.deathCapPerBattle).toBe(rule.morale.deathPenalty * 5);
  });

  it('统率来源 hero 与初始官职 rank 均可在内容库解析', () => {
    const hero = library.heroes.find(entry => entry.id === project.companionRule.heroId);
    expect(hero).toBeTruthy();
    expect(Number(hero.stats.command)).toBeGreaterThan(0);
    const rank = library.ranks.find(entry => entry.id === project.companionRule.initialRankId);
    expect(rank).toBeTruthy();
    expect(Number(rank.value)).toBeGreaterThanOrEqual(0);
  });
});

describe('M3 3A · 随行/军团运行态 schema', () => {
  it('companionSquad 快照通过 schema；非法档位被拒', () => {
    const snapshot = {
      unitIds: ['c1', 'c2'],
      stance: 'charge',
      morale: 60,
      moraleLedger: { lastRestDay: 3 },
      armyPool: { troops: 4, cap: 10 },
      members: [{ unitId: 'c1', state: 'active', hpRatio: 1 }],
      startDay: 3
    };
    expect(validator.validate(snapshot, COMPANION_SQUAD_SCHEMA.id).errors).toEqual([]);
    const invalid = validator.validate({ ...snapshot, stance: 'dance' }, COMPANION_SQUAD_SCHEMA.id);
    expect(invalid.errors.length).toBeGreaterThan(0);
  });

  it('armyState 运行态通过 schema', () => {
    expect(validator.validate({ stance: 'escort', morale: 42, updatedDay: 5 }, ARMY_STATE_SCHEMA.id).errors)
      .toEqual([]);
    expect(validator.validate({ stance: 'dance' }, ARMY_STATE_SCHEMA.id).errors.length).toBeGreaterThan(0);
  });

  it('gameProject 声明 companionRule / armyOrders', () => {
    expect(GAME_PROJECT_SCHEMA.fields.companionRule).toBeTruthy();
    expect(GAME_PROJECT_SCHEMA.fields.armyOrders).toBeTruthy();
  });
});

describe('M3 3D · 倒地掉落与 NPC 拾取', () => {
  it('downedDrop 声明 1~3 件 / 零损耗 / 剧情豁免 / 2 游戏日归属 / NPC 拾取半径', () => {
    const config = project.downedDrop;
    expect(config).toBeTruthy();
    expect(config.minItems).toBe(1);
    expect(config.maxItems).toBe(3);
    expect(config.lossRatio).toBe(0);
    expect(config.includeCurrency).toBe(false);
    expect(config.plotExempt).toBe(true);
    expect(config.ownerExpiryDays).toBe(2);
    expect(config.npcPickupRadius).toBeGreaterThan(0);
    expect(GAME_PROJECT_SCHEMA.fields.downedDrop).toBeTruthy();
  });
});

describe('M3 3B · 武装单位战略指令', () => {
  it('armyOrders 声明 500ms 战略刻 / 战术撤军士气 / 五指令执行器', () => {
    const config = project.armyOrders;
    expect(config).toBeTruthy();
    expect(config.tickMs).toBe(500);
    expect(config.tacticalRetreatMorale).toBe(3);
    expect(config.orders.map(entry => entry.key)).toEqual([...ARMY_ORDER_TYPES]);
    for (const entry of config.orders) {
      expect(typeof entry.label).toBe('string');
      expect(typeof entry.executor).toBe('string');
    }
    const alert = config.orders.find(entry => entry.key === 'attack');
    expect(alert.requiresTarget).toBe(true);
    const defend = config.orders.find(entry => entry.key === 'defend');
    expect(defend.requiresTarget).toBe(false);
    expect(defend.persistent).toBe(true);
  });

  it('armyState 全字段（类别/名册/部署/指令/将令）通过 schema；非法类别被拒', () => {
    const state = {
      id: 'army.s02.guard',
      kind: 'army',
      factionId: 'yellow-turban',
      sceneId: 'S02',
      position: { x: 120, y: 80 },
      roster: { unitIds: ['u1', 'u2'], dead: [] },
      commanderHeroId: 'hero.zhangjiao',
      formationId: 'line',
      deployment: {
        committed: true,
        committedAt: 1000,
        roster: { unitIds: ['u1'] },
        formationId: 'line',
        commanderSlot: 'mid',
        deputySlots: ['front'],
        lockedBattleId: null
      },
      order: { type: 'move', target: { x: 300, y: 0 }, issuedDay: 7, state: 'executing', progress: 0.2 },
      battleDeployment: {},
      battleOrder: { battleId: 'battle.s02', kind: 'stance', stance: 'assault', targetId: null },
      supply: {},
      morale: 77,
      updatedDay: 7
    };
    expect(validator.validate(state, ARMY_STATE_SCHEMA.id).errors).toEqual([]);
    expect(validator.validate({ ...state, kind: 'fleet' }, ARMY_STATE_SCHEMA.id).errors.length)
      .toBeGreaterThan(0);
    // 无指令时 order 允许 null（读档空态）
    expect(validator.validate({ ...state, order: null, battleOrder: null }, ARMY_STATE_SCHEMA.id).errors)
      .toEqual([]);
  });

  it('阵法可解析（formationExists 数据源）', () => {
    expect(Array.isArray(library.formations)).toBe(true);
    expect(library.formations.length).toBeGreaterThan(0);
    for (const formation of library.formations) expect(typeof formation.id).toBe('string');
  });
});
