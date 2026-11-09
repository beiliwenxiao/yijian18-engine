/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-11-09
 ************************************************************/

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConstructionSystem } from '../systems/ConstructionSystem.js';
import { getObjectiveTypes } from '../systems/quest/ObjectiveTypeRegistry.js';

const ROOT = 'example/sanguo_zhangjiao';
const loadJson = relative => JSON.parse(fs.readFileSync(path.resolve(ROOT, relative), 'utf8'));

const library = loadJson('project/library.json');
const project = loadJson('game.project.json');
const commands = loadJson('project/commands.json');

function createConstructionSystem() {
  return new ConstructionSystem({
    inventoryTransactions: {
      previewRemove: () => ({ remainder: 0 }),
      commit: () => ({ ok: true })
    }
  });
}

describe('M1 · 配方与物品内容', () => {
  it('recipes 至少含木箭/木盾两条，station 与产物/材料都能在物品库解析', () => {
    const itemIds = new Set(library.items.map(item => item.id));
    const recipes = library.recipes;
    expect(recipes.length).toBeGreaterThanOrEqual(2);
    const byId = new Map(recipes.map(recipe => [recipe.id, recipe]));

    expect(byId.get('recipe.wood_arrow')).toMatchObject({
      station: 'station.workshop.carpenter',
      outputs: [{ itemId: 'wooden_arrow', quantity: 10 }]
    });
    expect(byId.get('recipe.wooden_shield')).toMatchObject({
      station: 'station.workshop.carpenter',
      outputs: [{ itemId: 'equipment.workshop.wooden_shield', quantity: 1 }]
    });

    for (const recipe of recipes) {
      expect(typeof recipe.station).toBe('string');
      expect(recipe.station.startsWith('station.')).toBe(true);
      for (const entry of [...(recipe.inputs || []), ...(recipe.outputs || [])]) {
        expect(itemIds.has(entry.itemId)).toBe(true);
      }
    }
  });

  it('工坊木盾声明耐久折损配置，铜钱作为物品存在', () => {
    const shield = library.items.find(item => item.id === 'equipment.workshop.wooden_shield');
    expect(shield).toMatchObject({
      type: 'equipment',
      subType: 'armor',
      durabilityMax: 120,
      durabilityPerHit: 1,
      brokenMultiplier: 0.5
    });
    expect(library.items.some(item => item.id === 'currency.copper')).toBe(true);
  });

  it('每个配方的产出都有对应的 craft.production.<recipeId> 命令', () => {
    for (const recipe of library.recipes) {
      const command = commands.find(entry => entry.id === `craft.production.${recipe.id}`);
      expect(command, `缺少命令 craft.production.${recipe.id}`).toBeTruthy();
      const adds = command.transaction?.inventory?.addEntries || [];
      expect(command.transaction?.inventory?.type).toBe('batchAdd');
      for (const output of recipe.outputs) {
        expect(adds).toEqual(expect.arrayContaining([{ itemId: output.itemId, quantity: output.quantity }]));
      }
    }
  });
});

describe('M1 · 建筑工位 stations', () => {
  it('工坊/铁匠铺带 stations，木作台/铁砧/修复台 kind 正确', () => {
    const system = createConstructionSystem();
    expect(system.registerDefinitions(project.construction.definitions).ok).toBe(true);

    const workshop = system.getDefinition('construction.workshop');
    expect(workshop.stations).toEqual([
      expect.objectContaining({
        id: 'station.workshop.carpenter',
        kind: 'craft',
        recipes: expect.arrayContaining(['recipe.wood_arrow', 'recipe.wooden_shield'])
      })
    ]);

    const forge = system.getDefinition('construction.forge');
    const byId = new Map(forge.stations.map(station => [station.id, station]));
    expect(byId.get('station.forge.anvil').kind).toBe('forge');
    expect(byId.get('station.forge.repair').kind).toBe('repair');
  });

  it('未声明 stations 的旧建筑保持 null（零回归）', () => {
    const system = createConstructionSystem();
    system.registerDefinitions(project.construction.definitions);
    expect(system.getDefinition('construction.s01.small_shelter').stations).toBeNull();
  });

  it('非法 station kind / 重复 station id 被拒绝', () => {
    const base = { id: 'construction.test', name: '测试', costs: [{ itemId: 'resource.wood', quantity: 1 }] };

    const badKind = createConstructionSystem();
    expect(badKind.registerDefinitions([
      { ...base, stations: [{ id: 'station.bad', kind: 'blacksmith' }] }
    ])).toMatchObject({ ok: false, code: 'invalidStationKind' });

    const duplicated = createConstructionSystem();
    expect(duplicated.registerDefinitions([
      { ...base, stations: [{ id: 'station.dup' }, { id: 'station.dup' }] }
    ])).toMatchObject({ ok: false, code: 'invalidStations' });
  });
});

describe('M1 · craft.item 任务目标', () => {
  it('注册为 production.completed + quantity 计数，身份字段是 itemId', () => {
    const type = getObjectiveTypes().find(entry => entry.type === 'craft.item');
    expect(type).toMatchObject({ matcherType: 'production.completed', progressBy: 'quantity' });
    expect(type.identityFields.map(field => field.name)).toEqual(['itemId']);
  });
});
