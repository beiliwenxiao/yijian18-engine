/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 ************************************************************/

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorldRouteLayer, validateWorldLogic } from './WorldRouteLayer.js';

const PROJECT_PATH = path.resolve(process.cwd(), 'example/sanguo_zhangjiao/game.project.json');

function loadProject() {
  return JSON.parse(fs.readFileSync(PROJECT_PATH, 'utf8'));
}

function knownFactionsOf(project) {
  const factions = new Set();
  for (const city of project?.variables?.cityStates || []) {
    if (city?.factionId != null) factions.add(String(city.factionId));
  }
  for (const node of project?.worldLogic?.nodes || []) {
    if (node?.ownerFactionId != null) factions.add(String(node.ownerFactionId));
  }
  return factions;
}

describe('M4 内容 · worldLogic 契约', () => {
  it('game.project.json.worldLogic 结构合法（id 唯一 / 端点存在 / crossing 合法 / 权重为正）', () => {
    const project = loadProject();
    const logic = project.worldLogic;
    expect(logic).toBeTruthy();
    const result = validateWorldLogic(logic, { knownFactions: knownFactionsOf(project) });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('combat 必填键齐（4C 公式按这些键取值，不硬编码）', () => {
    const { combat } = loadProject().worldLogic;
    expect(combat).toBeTruthy();
    for (const key of [
      'baseStrength',
      'attackerBonus',
      'commanderWeight',
      'armyCountWeight',
      'militiaWeight',
      'winThreshold',
      'lossRatio',
      'retreatLossRatio'
    ]) {
      expect(Number.isFinite(Number(combat[key])), `combat.${key}`).toBe(true);
    }
    expect(combat.terrainDefense && typeof combat.terrainDefense === 'object').toBe(true);
  });

  it('combat 4C 公式键齐（spec §7 全量；winThreshold=1=比分制）', () => {
    const { combat } = loadProject().worldLogic;
    for (const key of [
      'unitStrengthScale',
      'attackerModifier',
      'defeatLossRatio',
      'victorLossRatio',
      'spoilsRatio',
      'heroScale',
      'moraleBase',
      'moraleScale',
      'routMorale',
      'routMoraleFloor',
      'cityDefensePerLevel',
      'passDefensePerLevel',
      'garrisonPerLevel',
      'defenderInFort',
      'defenderField',
      'stackBonus',
      'stackLimit',
      'stackPenalty',
      'ambushBonus',
      'engageRadius',
      'decisionTimeoutMs',
      'decisionHoldTicks'
    ]) {
      expect(Number.isFinite(Number(combat[key])), `combat.${key}`).toBe(true);
    }
    expect(combat.winThreshold).toBe(1);
    expect(['ambush', 'detour', 'fight', 'retreat']).toContain(combat.autoPolicy);
    expect(combat.terrainModifiers.bridge.attacker).toBeLessThan(1);
    expect(combat.terrainModifiers.mountainPath.defender).toBeGreaterThan(1);
    expect(combat.retreat.moraleCost).toBeGreaterThan(0);
    expect(combat.retreat.cooldownTicks).toBeGreaterThan(0);
  });

  it('tariff 日结口径齐（资源与常规税收分离）且关隘有 tollRate', () => {
    const { tariff, nodes } = loadProject().worldLogic;
    expect(tariff).toMatchObject({ resource: 'food', sweepToCity: true });
    expect(Number(tariff.rate)).toBeGreaterThan(0);
    expect(Number(tariff.defaultRate)).toBeGreaterThan(0);
    expect(Number(tariff.defaultCargoValue)).toBeGreaterThan(0);

    const passes = (nodes || []).filter(node => node.kind === 'pass' && node.ownerFactionId);
    expect(passes.length).toBeGreaterThan(0);
    for (const pass of passes) {
      expect(Number(pass.tollRate), `${pass.id}.tollRate`).toBeGreaterThan(0);
    }
  });

  it('内容既能被 4A 旧别名（weight / 顶层 crossingNodeId）驱动，也给出敌对关隘状态', () => {
    const project = loadProject();
    const layer = new WorldRouteLayer({
      logic: project.worldLogic,
      moverFactionId: 'yellow_turban'
    });
    // 桥为中立 → 可过；关隘属汉军 → 敌对（边状态 hostile）
    expect(layer.getSnapshot().edges['edge.bridge_s10']).toMatchObject({ passable: true });
    expect(layer.getSnapshot().edges['edge.junction_pass']).toMatchObject({
      passable: false,
      status: 'hostile'
    });
    // 存在绕行路线（经 s04/s05/渡口），最短路按 weight 累加
    const path = layer.shortestPath('city.s09', 'city.s07');
    expect(path.ok).toBe(true);
    expect(path.cost).toBeGreaterThan(0);
  });

  it('旧档容错：没有 worldLogic 时构造/快照/校验都不抛异常', () => {
    const layer = new WorldRouteLayer({ logic: null });
    expect(layer.getSnapshot()).toMatchObject({ revision: expect.any(Number) });
    expect(layer.shortestPath('a', 'b')).toMatchObject({ ok: false, code: 'unknownNode' });
    const result = validateWorldLogic({ nodes: [], edges: [] });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('nodesEmpty');
  });
});
