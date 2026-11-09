/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * M2 内容契约测试：押运队模板、配给配置与任务目标类型。
 * 只校验 M2 新增的内容面，避免对存量全库做与里程碑无关的断言。
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContentValidator } from './validation/ContentValidator.js';
import {
  CANONICAL_SCHEMAS,
  CANONICAL_SCHEMA_VERSION,
  CONVOY_SCHEMA
} from '../data/schema/CanonicalSchemas.js';
import { STANDARD_REGISTRY_KINDS } from './Registry.js';
import { getObjectiveTypes } from '../systems/quest/ObjectiveTypeRegistry.js';

const ROOT = 'example/sanguo_zhangjiao';
const loadJson = relative => JSON.parse(fs.readFileSync(path.resolve(ROOT, relative), 'utf8'));

const library = loadJson('project/library.json');
const project = loadJson('game.project.json');

const validator = new ContentValidator({
  schemas: Object.fromEntries(CANONICAL_SCHEMAS.map(schema => [schema.id, schema])),
  supportedVersion: CANONICAL_SCHEMA_VERSION
});

describe('M2 · 押运队模板', () => {
  it('convoys 通过 convoy schema 校验', () => {
    const result = validator.validateList(library.convoys, CONVOY_SCHEMA.id, 'library.convoys');
    expect(result.errors).toEqual([]);
    expect(library.convoys.length).toBeGreaterThanOrEqual(1);
  });

  it('轻车押运队引用可解析的载具/护卫并声明容量与速度', () => {
    const convoy = library.convoys.find(entry => entry.id === 'convoy.light_cart');
    expect(convoy).toMatchObject({
      name: '轻车押运队',
      vehicleRef: 'vehicle.s14.lastCart',
      escort: { count: 2, ref: 'enemy.s02_yellow_turban_soldier' }
    });

    expect(library.vehicles.some(vehicle => vehicle.id === convoy.vehicleRef)).toBe(true);
    expect(library.enemies.some(enemy => enemy.id === convoy.escort.ref)).toBe(true);
    expect(convoy.cargoCapacity).toBeGreaterThan(0);
    expect(convoy.speed.base).toBeGreaterThan(0);
    expect(convoy.speed.loadedMultiplier).toBeGreaterThan(0);
    expect(convoy.speed.loadedMultiplier).toBeLessThanOrEqual(1);
  });

  it('convoys 是标准注册表种类，Library 载入即可被解析', () => {
    expect(STANDARD_REGISTRY_KINDS).toContain('convoys');
  });
});

describe('M2 · 配给配置', () => {
  it('supply 块声明阵营 / 额度档位 / 负重 / 损失表', () => {
    const supply = project.supply;
    expect(supply).toBeTruthy();
    expect(typeof supply.playerFactionId).toBe('string');
    expect(supply.playerFactionId.length).toBeGreaterThan(0);

    expect(Array.isArray(supply.quotas)).toBe(true);
    expect(supply.quotas.length).toBeGreaterThanOrEqual(1);
    const ranks = supply.quotas.map(quota => quota.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    for (const quota of supply.quotas) {
      for (const key of ['food', 'wood', 'iron', 'herb']) {
        expect(quota.daily[key]).toBeGreaterThan(0);
      }
    }

    expect(supply.carryLimits.personalMaxWeight).toBeGreaterThan(0);
    expect(supply.ambush.baseChance).toBeGreaterThan(0);
    expect(supply.ambush.fleeLossRatio).toBeGreaterThan(0);
    expect(supply.ambush.defeatLossRatio).toBeGreaterThan(0);
    expect(supply.firstConvoySafe).toBe(true);
  });

  it('resourceItems 全部指向物品库内已有物品', () => {
    const itemIds = new Set(library.items.map(item => item.id));
    for (const itemId of Object.values(project.supply.resourceItems)) {
      expect(itemIds.has(itemId)).toBe(true);
    }
  });
});

describe('M2 · 任务目标类型', () => {
  it('supply.requisition 按 quantity 累计，可限定城池', () => {
    const type = getObjectiveTypes().find(entry => entry.type === 'supply.requisition');
    expect(type).toMatchObject({
      matcherType: 'supply.requisitioned',
      progressBy: 'quantity'
    });
    expect(type.identityFields.map(field => field.name)).toEqual(['cityId']);
  });

  it('supply.escort 以押运到达为完成条件，可限定寨仓', () => {
    const type = getObjectiveTypes().find(entry => entry.type === 'supply.escort');
    expect(type).toMatchObject({ matcherType: 'convoy.arrived', progressBy: null });
    expect(type.identityFields.map(field => field.name)).toEqual(['stashId']);
  });
});
