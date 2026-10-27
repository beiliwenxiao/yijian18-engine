/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * S02 M3：扎营（army.camp）+ 操控张角（army.possess）+ 兵败溃退（army.raid.defeat）
 * 协调器层单测——mock scene/system，验证编排语义与绑定交换/还原。
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { S02ArmyRescueCoordinator } from '../example/sanguo_zhangjiao/systems/S02ArmyRescueFlow.js';

function makeEntity({ x = 0, y = 0, hp = 50, maxHp = 100 } = {}) {
  return {
    id: `entity-${Math.random().toString(36).slice(2, 8)}`,
    plotDowned: false,
    isDead: false,
    isDying: false,
    _components: {
      transform: { position: { x, y } },
      movement: { velocity: { x: 1, y: 1 } },
      stats: { hp, maxHp },
      commandState: { stance: 'escort', post: null, goal: null },
      sprite: { playAnimation: () => {} }
    },
    getComponent(key) { return this._components[key] || null; }
  };
}

function makeScene() {
  const calls = { bind: [], melee: [], fired: [], tips: [], floating: [], tombstoned: [] };
  const protagonist = makeEntity({ x: 400, y: 300, maxHp: 100, hp: 80 });
  const zhangjiao = makeEntity({ x: 448, y: 316, maxHp: 120, hp: 120 });
  zhangjiao.id = 'zhangjiao-possessed';
  zhangjiao.name = '张角';
  const scene = {
    playerEntity: protagonist,
    currentSceneId: 'S02',
    _possessionActive: false,
    meleeAttackSystem: { setPlayerEntity: entity => calls.melee.push(entity) },
    floatingTextManager: { add: payload => calls.floating.push(payload) },
    _showScreenTip: (text, opts) => calls.tips.push({ text, ...opts }),
    _worldLoadResult: { worldIndex: { getOffset: () => ({ x: 7000, y: 3000 }) } },
    context: {
      player: { entity: protagonist },
      entities: { add: () => {} },
      services: {
        placements: {
          placements: [
            { id: 'S02-raid-vanguard-1', group: 'S02-raid-vanguard' },
            { id: 'S02-raid-main-1', group: 'S02-raid-mainforce' },
            { id: 'S02-camp-decor', group: 'S02-camp-decor' }
          ],
          tombstonePlacement: (id, meta) => calls.tombstoned.push({ id, meta })
        }
      },
      ui: {
        layout: {
          bindPlayer: entity => calls.bind.push(entity)
        }
      }
    },
    entityFactory: { createPlayer: () => zhangjiao },
    gameLoader: {
      triggerSystem: { fire: (type, params) => calls.fired.push({ type, params }) }
    },
    armyCommandFlow: { system: null },
    __calls: calls
  };
  return { scene, protagonist, zhangjiao };
}

function makeSystem(units) {
  const state = {
    constructionCalls: [],
    completeHandler: null,
    constructionResult: { ok: true }
  };
  const system = {
    units: new Map(units.map((entity, index) => [`u${index}`, { entity }])),
    startConstruction(commandKey, pos, buildUnits) {
      state.constructionCalls.push({ commandKey, pos, units: buildUnits });
      return state.constructionResult;
    },
    __state: state
  };
  return system;
}

describe('S02ArmyRescueCoordinator - M3 扎营', () => {
  let scene, protagonist, coordinator;
  beforeEach(() => {
    ({ scene, protagonist } = makeScene());
    coordinator = new S02ArmyRescueCoordinator(scene);
    scene.armyCommandFlow.system = makeSystem([makeEntity(), makeEntity()]);
  });

  it('campArmy：全军切 hold 驻营地中心，startConstruction 用世界坐标', () => {
    const result = coordinator.campArmy({ x: 590, y: 368 });
    assert.equal(result.ok, true);
    const system = scene.armyCommandFlow.system;
    for (const unit of system.units.values()) {
      const command = unit.entity.getComponent('commandState');
      assert.equal(command.stance, 'hold');
      assert.deepEqual(command.post, { x: 7590, y: 3368 });
      assert.equal(command.goal, null);
    }
    assert.equal(system.__state.constructionCalls.length, 1);
    const call = system.__state.constructionCalls[0];
    assert.equal(call.commandKey, 'camp');
    assert.deepEqual(call.pos, { x: 7590, y: 3368 });
    assert.equal(call.units.length, 2);
  });

  it('campArmy：施工完成回调 fire armyCampLaid 且幂等复位', () => {
    coordinator.campArmy({ x: 590, y: 368 });
    const system = scene.armyCommandFlow.system;
    system.onConstructionComplete?.('camp', { x: 7590, y: 3368 });
    assert.equal(scene.__calls.fired.some(({ type }) => type === 'armyCampLaid'), true);
    assert.equal(coordinator._campActive, false);
    // 重入不被 _campActive 挡（已复位），再次下令可开新作业
    assert.equal(coordinator.campArmy({ x: 590, y: 368 }).ok, true);
  });

  it('campArmy：施工失败不复位 _campActive 且返回失败码', () => {
    const system = scene.armyCommandFlow.system;
    system.__state.constructionResult = { ok: false, code: 'unsupportedCommand' };
    const result = coordinator.campArmy({ x: 590, y: 368 });
    assert.equal(result.ok, false);
    assert.equal(coordinator._campActive, false);
  });

  it('campArmy：进行中重入幂等不重复下令', () => {
    coordinator.campArmy({ x: 590, y: 368 });
    const second = coordinator.campArmy({ x: 590, y: 368 });
    assert.equal(second.ok, true);
    assert.equal(second.idempotent, true);
    assert.equal(scene.armyCommandFlow.system.__state.constructionCalls.length, 1);
  });
});

describe('S02ArmyRescueCoordinator - M3 possession 附身/解除', () => {
  let scene, protagonist, coordinator;
  beforeEach(() => {
    ({ scene, protagonist } = makeScene());
    coordinator = new S02ArmyRescueCoordinator(scene);
  });

  it('possessCommander：创建张角 + bindPlayer/melee 切换 + 主角 plotDowned 观战', () => {
    const result = coordinator.possessCommander();
    assert.equal(result.ok, true);
    const calls = scene.__calls;
    // bindPlayer 恰好一次，绑定对象是张角玩家形实体
    assert.equal(calls.bind.length, 1);
    assert.equal(calls.bind[0].id, 'zhangjiao-possessed');
    assert.equal(calls.melee.length, 1);
    assert.equal(calls.melee[0].id, 'zhangjiao-possessed');
    assert.equal(protagonist.plotDowned, true);
    assert.equal(scene._possessionActive, true);
    assert.ok(calls.floating.some(payload => payload.text.includes('张角')));
  });

  it('releaseCommander：绑定还原主角，张角实体保留', () => {
    coordinator.possessCommander();
    const result = coordinator.releaseCommander();
    assert.equal(result.ok, true);
    const calls = scene.__calls;
    assert.equal(calls.bind.length, 2);
    assert.equal(calls.bind[1], protagonist);
    assert.equal(calls.melee[1], protagonist);
    assert.equal(protagonist.plotDowned, false);
    assert.equal(scene._possessionActive, false);
    assert.equal(coordinator._possession, null);
  });

  it('possession 幂等：重复 possess 不重复创建/绑定', () => {
    coordinator.possessCommander();
    coordinator.possessCommander();
    assert.equal(scene.__calls.bind.length, 1);
  });

  it('releaseCommander：未附身时幂等返回', () => {
    const result = coordinator.releaseCommander();
    assert.equal(result.ok, true);
    assert.equal(result.idempotent, true);
  });

  it('possession：再次附身复用已创建张角实体（实体工厂只调一次）', () => {
    let created = 0;
    scene.entityFactory.createPlayer = () => { created++; return makeEntity({ maxHp: 120 }); };
    coordinator.possessCommander();
    coordinator.releaseCommander();
    coordinator.possessCommander();
    assert.equal(created, 1);
  });
});

describe('S02ArmyRescueCoordinator - M3 兵败溃退', () => {
  let scene, coordinator;
  beforeEach(() => {
    ({ scene } = makeScene());
    coordinator = new S02ArmyRescueCoordinator(scene);
    scene.armyCommandFlow.system = makeSystem([
      makeEntity({ hp: 10, maxHp: 90 }),
      makeEntity({ hp: 0, maxHp: 90, x: 1, y: 1 })
    ]);
    scene.armyCommandFlow.system.units.get('u1').entity.isDead = true;
  });

  it('handleRaidDefeat：两波敌组全部墓碑化（带 refreshAt），非敌组不碰', () => {
    const result = coordinator.handleRaidDefeat();
    assert.equal(result.ok, true);
    const tombstoned = scene.__calls.tombstoned;
    assert.equal(tombstoned.length, 2);
    const ids = tombstoned.map(entry => entry.id).sort();
    assert.deepEqual(ids, ['S02-raid-main-1', 'S02-raid-vanguard-1']);
    for (const entry of tombstoned) {
      assert.ok(entry.meta.refreshAt > Date.now() + 5000);
    }
  });

  it('handleRaidDefeat：存活单位回满血并收拢回营地中心；阵亡单位不动', () => {
    coordinator.handleRaidDefeat({ regroupX: 590, regroupY: 368 });
    const alive = scene.armyCommandFlow.system.units.get('u0').entity;
    assert.equal(alive.getComponent('stats').hp, 90);
    const command = alive.getComponent('commandState');
    assert.deepEqual(command.goal, { x: 7590, y: 3368 });
    assert.deepEqual(command.post, { x: 7590, y: 3368 });
    const dead = scene.armyCommandFlow.system.units.get('u1').entity;
    assert.equal(dead.getComponent('stats').hp, 0);
  });
});
