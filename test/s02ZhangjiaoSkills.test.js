/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-30
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

/**
 * S02 M3.6：附身张角技能继承（_syncZhangjiaoSkills）单测。
 * 验证：主角已解锁攻击技能全量继承、打坐/疗伤排除、缓存复用刷新、容错。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { S02ArmyRescueCoordinator } from '../example/sanguo_zhangjiao/systems/S02ArmyRescueFlow.js';

const skillView = id => ({ id, name: id, type: 'active', targeting: 'position', range: 300, manaCost: 10 });

function makeEntity({ withCombat = true, withEquipment = true, skills = [], loadout = null, available = [] } = {}) {
  return {
    id: `entity-${Math.random().toString(36).slice(2, 8)}`,
    availableSkillIds: available,
    _components: {
      transform: { position: { x: 0, y: 0 } },
      movement: { velocity: { x: 0, y: 0 } },
      stats: { hp: 100, maxHp: 100, speed: 100 },
      ...(withEquipment ? {
        equipment: {
          equips: [],
          equip(slot, item) { this.equips.push({ slot, item }); return null; },
          getEquipment(slot) { return this.equips.filter(e => e.slot === slot).pop()?.item || null; }
        }
      } : {}),
      ...(withCombat ? {
        combat: {
          skills: skills.map(skillView),
          skillCooldowns: new Map([['flame_palm', 123]]),
          skillLoadout: loadout,
          addSkill(skill) { this.skills.push(skill); }
        }
      } : {})
    },
    getComponent(key) { return this._components[key] || null; }
  };
}

function makeScene(protagonist) {
  return {
    playerEntity: protagonist,
    currentSceneId: 'S02',
    context: { player: { entity: protagonist }, entities: { add: () => {} }, ui: { layout: { bindPlayer: () => {} } } },
    _playerFactory: { configurePlayer: () => {} },
    entityFactory: { createPlayer: () => makeEntity({ withCombat: true }) },
    gameLoader: { blackboard: { get: () => null }, triggerSystem: { fire: () => {} } },
    floatingTextManager: { add: () => {} },
    _showScreenTip: () => {}
  };
}

describe('S02 附身张角技能继承（M3.6）', () => {
  it('新建路径：主角已解锁攻击技能全量继承，打坐/疗伤排除，冷却表独立', () => {
    const protagonist = makeEntity({
      skills: ['flame_palm', 'ice_finger', 'inferno_palm', 'meditation', 'heal'],
      loadout: ['flame_palm', 'ice_finger', null],
      available: ['flame_palm', 'ice_finger', 'inferno_palm', 'meditation']
    });
    const scene = makeScene(protagonist);
    const coordinator = new S02ArmyRescueCoordinator(scene);
    const zhangjiao = coordinator._ensureZhangjiaoEntity(protagonist);
    const combat = zhangjiao.getComponent('combat');
    assert.deepEqual(combat.skills.map(s => s.id), ['flame_palm', 'ice_finger', 'inferno_palm']);
    assert.deepEqual(combat.skillLoadout, ['flame_palm', 'ice_finger', null]);
    assert.deepEqual(zhangjiao.availableSkillIds, ['flame_palm', 'ice_finger', 'inferno_palm', 'meditation']);
    assert.equal(combat.skillCooldowns.size, 0, '冷却表独立重置');
    // 视图隔离：改张角技能对象不影响主角
    combat.skills[0].range = 999;
    assert.equal(protagonist.getComponent('combat').skills[0].range, 300);
  });

  it('缓存复用路径：主角中途解锁新技能后再次附身即时跟进', () => {
    const protagonist = makeEntity({ skills: ['flame_palm'], loadout: ['flame_palm', null, null] });
    const scene = makeScene(protagonist);
    const coordinator = new S02ArmyRescueCoordinator(scene);
    const zhangjiao = coordinator._ensureZhangjiaoEntity(protagonist);
    assert.deepEqual(zhangjiao.getComponent('combat').skills.map(s => s.id), ['flame_palm']);
    // 主角解锁寒冰指并重配快捷栏
    protagonist.getComponent('combat').skills.push(skillView('ice_finger'));
    protagonist.getComponent('combat').skillLoadout = ['ice_finger', 'flame_palm', null];
    protagonist.availableSkillIds = ['flame_palm', 'ice_finger'];
    const reused = coordinator._ensureZhangjiaoEntity(protagonist);
    assert.equal(reused, zhangjiao, '同一缓存实体');
    assert.deepEqual(reused.getComponent('combat').skills.map(s => s.id), ['flame_palm', 'ice_finger']);
    assert.deepEqual(reused.getComponent('combat').skillLoadout, ['ice_finger', 'flame_palm', null]);
  });

  it('主角无 combat 组件：返回 false 不崩溃', () => {
    const protagonist = makeEntity({ withCombat: false });
    const scene = makeScene(protagonist);
    const coordinator = new S02ArmyRescueCoordinator(scene);
    assert.equal(coordinator._syncZhangjiaoSkills(protagonist, makeEntity()), false);
  });

  it('桃木杖注入：创建路径 equip mainhand（subType weapon，attack +2）', () => {
    const protagonist = makeEntity({ skills: ['flame_palm'] });
    const scene = makeScene(protagonist);
    const coordinator = new S02ArmyRescueCoordinator(scene);
    const zhangjiao = coordinator._ensureZhangjiaoEntity(protagonist);
    const mainhand = zhangjiao.getComponent('equipment').getEquipment('mainhand');
    assert.equal(mainhand?.id, 'weapon.peachwood_staff');
    assert.equal(mainhand?.subType, 'weapon');
    assert.deepEqual(mainhand?.stats, { attack: 2 });
  });
});
