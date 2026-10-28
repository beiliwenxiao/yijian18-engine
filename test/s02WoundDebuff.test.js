/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-28
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

/**
 * S02 M3.6：受伤 debuff 分档（applyWoundModifiers / treatWound）协调器层单测。
 * 验证：severe/light 系数、幂等重放（读档恢复）、无档位跳过、治疗还原。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { S02ArmyRescueCoordinator } from '../example/sanguo_zhangjiao/systems/S02ArmyRescueFlow.js';

function makeScene({ woundTier = null, hp = 80, maxHp = 100, speed = 100 } = {}) {
  const calls = { floating: [] };
  const player = {
    id: 'protagonist',
    plotDowned: false,
    _components: {
      transform: { position: { x: 620, y: 350 } },
      movement: { velocity: { x: 0, y: 0 } },
      stats: { hp, maxHp, speed },
      sprite: { playAnimation: () => {} }
    },
    getComponent(key) { return this._components[key] || null; }
  };
  const scene = {
    playerEntity: player,
    currentSceneId: 'S02',
    floatingTextManager: { add: payload => calls.floating.push(payload) },
    gameLoader: { blackboard: { get: key => (key === 'storyState' ? { s02Wounded: woundTier } : null) } },
    __calls: calls
  };
  return { scene, player, calls };
}

describe('S02 受伤 debuff 分档（M3.6）', () => {
  it('severe：HP 上限 ×0.75、移速 ×0.85，超出上限的当前 HP 被钳制，飘字带档位标签', () => {
    const { scene, player, calls } = makeScene({ woundTier: 'severe', hp: 80 });
    const coordinator = new S02ArmyRescueCoordinator(scene);
    const result = coordinator.applyWoundModifiers();
    assert.equal(result.ok, true);
    assert.equal(result.tier, 'severe');
    assert.equal(player.getComponent('stats').maxHp, 75);
    assert.equal(player.getComponent('stats').speed, 85);
    assert.equal(player.getComponent('stats').hp, 75);
    assert.deepEqual(player._woundBaseStats, { maxHp: 100, speed: 100 });
    assert.ok(calls.floating.some(f => String(f.text).includes('重伤在身')));
  });

  it('重放幂等：重复 apply 以首次快照为基准，不会二次衰减（读档恢复安全）', () => {
    const { scene, player } = makeScene({ woundTier: 'severe' });
    const coordinator = new S02ArmyRescueCoordinator(scene);
    coordinator.applyWoundModifiers();
    coordinator.applyWoundModifiers();
    coordinator.applyWoundModifiers();
    const stats = player.getComponent('stats');
    assert.equal(stats.maxHp, 75);
    assert.equal(stats.speed, 85);
    assert.deepEqual(player._woundBaseStats, { maxHp: 100, speed: 100 });
  });

  it('无档位（undefined/treated）自幂等跳过：属性不动、不建快照', () => {
    for (const tier of [undefined, 'treated']) {
      const { scene, player } = makeScene({ woundTier: tier });
      const coordinator = new S02ArmyRescueCoordinator(scene);
      const result = coordinator.applyWoundModifiers();
      assert.equal(result.ok, true);
      assert.equal(result.idempotent, true);
      const stats = player.getComponent('stats');
      assert.equal(stats.maxHp, 100);
      assert.equal(stats.speed, 100);
      assert.equal(player._woundBaseStats, undefined);
    }
  });

  it('severe→light 逐档恢复：以同一基准重乘（M4 赠药节点语义）', () => {
    const { scene, player } = makeScene({ woundTier: 'severe' });
    const coordinator = new S02ArmyRescueCoordinator(scene);
    coordinator.applyWoundModifiers();
    scene.gameLoader.blackboard.get = key => (key === 'storyState' ? { s02Wounded: 'light' } : null);
    const result = coordinator.applyWoundModifiers();
    assert.equal(result.tier, 'light');
    const stats = player.getComponent('stats');
    assert.equal(stats.maxHp, 90);
    assert.equal(stats.speed, 100);
  });

  it('treatWound：还原基准属性并清除快照（S09 军医治疗语义）', () => {
    const { scene, player } = makeScene({ woundTier: 'severe', hp: 60 });
    const coordinator = new S02ArmyRescueCoordinator(scene);
    coordinator.applyWoundModifiers();
    coordinator.treatWound();
    const stats = player.getComponent('stats');
    assert.equal(stats.maxHp, 100);
    assert.equal(stats.speed, 100);
    assert.equal(stats.hp, 60);
    assert.equal(player._woundBaseStats, null);
    assert.equal(coordinator._woundTier, null);
  });

  it('主角实体缺失：拒绝并返回 playerUnavailable', () => {
    const { scene } = makeScene({ woundTier: 'severe' });
    scene.playerEntity = null;
    const coordinator = new S02ArmyRescueCoordinator(scene);
    const result = coordinator.applyWoundModifiers();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'playerUnavailable');
  });
});
