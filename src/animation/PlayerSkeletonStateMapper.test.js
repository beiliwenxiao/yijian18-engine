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

import { describe, it, expect } from 'vitest';
import { parseSkeletonAsset } from './SkeletonAsset.js';
import { createPlayerSkeletonStateMapper } from './PlayerSkeletonStateMapper.js';
import { SkeletonComponent } from '../ecs/components/SkeletonComponent.js';

/** 构造带武器槽位的骨骼：weapon-axe 手持（挂 armFR）、axe-back/spear-back 背挂（挂 back）。 */
function buildWeaponSkeleton({ extraClips = [] } = {}) {
  return parseSkeletonAsset({
    schemaVersion: 1,
    skeletonId: 'skeleton.weapon-test',
    meta: { width: 64, height: 64 },
    defaultClip: 'idle_down',
    bones: [
      { id: 'root', parent: null, x: 0, y: 0 },
      { id: 'armFR', parent: 'root', x: 7, y: -16 },
      { id: 'back', parent: 'root', x: 0, y: -14 }
    ],
    slots: [
      { id: 'toolHand', bone: 'armFR', z: 3, attachment: { type: 'image', assetId: 'player.parts.weapon-axe', visible: false } },
      { id: 'axeBack', bone: 'back', z: 1, attachment: { type: 'image', assetId: 'player.parts.weapon-axe', visible: false } },
      { id: 'spearBack', bone: 'back', z: 1, attachment: { type: 'image', assetId: 'player.parts.weapon-spear', visible: false } }
    ],
    clips: [
      { name: 'idle_down', durationMs: 1000, loop: true, tracks: [] },
      ...extraClips
    ]
  });
}

/** 构造带头部三态槽位的骨骼：headFront/headSide/headBack 挂 head，body 挂 root。 */
function buildHeadSkeleton() {
  return parseSkeletonAsset({
    schemaVersion: 1,
    skeletonId: 'skeleton.head-test',
    meta: { width: 64, height: 64 },
    defaultClip: 'idle_down',
    bones: [
      { id: 'root', parent: null, x: 0, y: 0 },
      { id: 'head', parent: 'root', x: 0, y: -20 },
      { id: 'back', parent: 'root', x: 0, y: -14 }
    ],
    slots: [
      { id: 'headFront', bone: 'head', z: 5, attachment: { type: 'image', assetId: 'player.parts.head-front' } },
      { id: 'headSide', bone: 'head', z: 4, attachment: { type: 'image', assetId: 'player.parts.head-side' } },
      { id: 'headBack', bone: 'head', z: 3, attachment: { type: 'image', assetId: 'player.parts.head-back' } },
      { id: 'spearBack', bone: 'back', z: 1, attachment: { type: 'image', assetId: 'player.parts.weapon-spear' } }
    ],
    clips: [
      { name: 'idle_down', durationMs: 1000, loop: true, tracks: [] },
      { name: 'idle_up', durationMs: 1000, loop: true, tracks: [] },
      { name: 'idle_side', durationMs: 1000, loop: true, tracks: [] }
    ]
  });
}

/** 构造实体 mock：sprite/equipment/inventory 三组件 + _weaponDrawn 战斗持握标志。
 *  equipState 可变引用：测试中途改装备（模拟穿/脱），签名守卫下一帧自动捕捉。 */
function buildEntity({
  mainhand = null, offhand = null, bag = [], drawn = false, direction = 'down',
  armor = null, helmet = null, pants = null, boots = null, accessory = null
} = {}) {
  const sprite = { direction, flipX: false, isWalking: false, isStopping: false };
  const equipState = { mainhand, offhand, armor, helmet, pants, boots, accessory };
  const equipment = { getEquipment: slot => equipState[slot] ?? null };
  const inventory = { slots: bag.map(item => ({ item, quantity: 1 })) };
  const entity = {
    isDead: false, isDying: false, isSoulState: false, _climbing: false,
    getComponent(name) {
      if (name === 'sprite') return sprite;
      if (name === 'equipment') return equipment;
      if (name === 'inventory') return inventory;
      return null;
    },
    _equipState: equipState
  };
  entity._weaponDrawn = drawn; // CombatSystem.enterCombat/exitCombat 维护
  return entity;
}

/** 构造真实 SkeletonComponent：运行时状态落在实体本地覆盖层（共享资产只读）。 */
function buildSkeletonComponent(asset) {
  const component = new SkeletonComponent({ skeletonId: asset.id });
  component.setSkeletonAsset(asset);
  component.currentClip = 'idle_down';
  return component;
}

/**
 * 取槽位的最终可见性（共享 attachment + 实体本地覆盖层合并后的结果）。
 * @param {SkeletonComponent} skeleton
 * @param {string} slotId
 */
function slotVisible(skeleton, slotId) {
  const slot = skeleton.skeletonAsset.slots.find(candidate => candidate.id === slotId);
  return skeleton.resolveSlotAttachment(slot)?.visible;
}

/**
 * 取槽位的最终水平翻转（共享 attachment + 实体本地覆盖层合并后的结果）。
 * @param {SkeletonComponent} skeleton
 * @param {string} slotId
 */
function slotFlipX(skeleton, slotId) {
  const slot = skeleton.skeletonAsset.slots.find(candidate => candidate.id === slotId);
  return skeleton.resolveSlotAttachment(slot)?.flipX;
}

describe('武器槽位联动（战斗=手持，非战斗=背挂，采集=手持）', () => {
  it('背包为空且无装备：手持/背挂位全隐藏', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity();
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(false);
    expect(slotVisible(skeleton, 'axeBack')).toBe(false);
    expect(slotVisible(skeleton, 'spearBack')).toBe(false);
  });

  it('背包有 spear 但未装备（非战斗）：spear 背挂显示，手持隐藏', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({ bag: [{ id: 'weapon.spear', weaponKey: 'spear' }] });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(false);   // axe 手持隐藏
    expect(slotVisible(skeleton, 'spearBack')).toBe(true);    // spear 背挂显示
  });

  it('非战斗装备 axe（收刀回背）：手持隐藏，axeBack 显示（装备移出背包仍计入背挂来源）', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'tool.worn_axe', toolType: 'axe' },
      bag: []
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(false);    // 非战斗不持握
    expect(slotVisible(skeleton, 'axeBack')).toBe(true);     // 斧头背在背上
  });

  it('战斗装备 axe（拔出）：手持显示，axeBack 隐藏', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'tool.worn_axe', toolType: 'axe' },
      drawn: true                                          // CombatSystem.enterCombat
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(true);     // 拿在手上
    expect(slotVisible(skeleton, 'axeBack')).toBe(false);    // 背上收起
  });

  it('脱战收刀：装备 axe 从战斗转非战斗，手持/背挂翻转', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'tool.worn_axe', toolType: 'axe' },
      drawn: true
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(true);

    entity._weaponDrawn = false;                           // CombatSystem.exitCombat
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(false);    // 收刀
    expect(slotVisible(skeleton, 'axeBack')).toBe(true);      // 回背
  });

  it('非战斗装备 spear：spear 背挂显示（收枪回背）；背包另有 axe 也背挂', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'weapon.spear', weaponKey: 'spear' },
      bag: [{ id: 'tool.worn_axe', toolType: 'axe' }]
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'spearBack')).toBe(true);    // 已装备 spear 非战斗回背
    expect(slotVisible(skeleton, 'axeBack')).toBe(true);     // 背包 axe 背挂
  });

  it('战斗装备 spear：spear 背挂隐藏（已上手），axe 手持隐藏', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'weapon.spear', weaponKey: 'spear' },
      bag: [{ id: 'tool.worn_axe', toolType: 'axe' }],
      drawn: true
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(false);    // axe 手持隐藏（未装备）
    expect(slotVisible(skeleton, 'spearBack')).toBe(false);   // spear 背挂隐藏（已上手）
    expect(slotVisible(skeleton, 'axeBack')).toBe(true);      // axe 仍在背上（背包有）
  });

  it('战斗态但主手为空：背包有斧头则自动上手（攻击时手持斧头）', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      bag: [{ id: 'tool.worn_axe', toolType: 'axe' }],
      drawn: true
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(true);     // 背包有斧头：攻击时拿在手上
    expect(slotVisible(skeleton, 'axeBack')).toBe(false);     // 拿在手上 → 背挂隐藏
  });

  it('战斗态且没有任何武器：手持不显示（不凭空持握）', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({ bag: [], drawn: true });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(false);    // 无装备无背包武器：不显示
    expect(slotVisible(skeleton, 'axeBack')).toBe(false);     // 背包无斧头：背挂也隐藏
  });

  it('装备变化驱动状态切换：战斗中卸下 axe 后手持隐藏、背挂显示（武器回背包）', () => {
    const asset = buildWeaponSkeleton();
    const mainhandBox = { current: { id: 'tool.worn_axe', toolType: 'axe' } };
    const entity = buildEntity({ mainhand: mainhandBox.current, drawn: true });
    // 卸下时背包接收该武器
    const bag = [];
    const equipment = { getEquipment: slot => (slot === 'mainhand' ? mainhandBox.current : null) };
    const inventory = { slots: bag };
    entity.getComponent = name => {
      if (name === 'sprite') return { direction: 'down', flipX: false, isWalking: false };
      if (name === 'equipment') return equipment;
      if (name === 'inventory') return inventory;
      return null;
    };
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);

    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(true);     // 战斗中已装备 axe

    mainhandBox.current = null;                            // 卸下
    bag.push({ item: { id: 'tool.worn_axe', toolType: 'axe' }, quantity: 1 });
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(false);    // 手持隐藏
    expect(slotVisible(skeleton, 'axeBack')).toBe(true);     // 回背包 → 背挂显示
  });

  it('采集自动手持：非战斗下 _handToolOverride 使手持位显示（采集开始）', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({ bag: [{ id: 'tool.worn_axe', toolType: 'axe' }] });
    entity._handToolOverride = 'axe';                      // GatheringSystem.start 设置
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(true);     // 手上出现斧头
    expect(slotVisible(skeleton, 'axeBack')).toBe(false);    // 背上收起
  });

  it('采集结束：_handToolOverride 清除后手持隐藏、回背挂（工具消失/装备则回背）', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({ bag: [{ id: 'tool.worn_axe', toolType: 'axe' }] });
    entity._handToolOverride = 'axe';
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(true);

    entity._handToolOverride = null;                       // _finish 清除
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(false);    // 手持隐藏
    expect(slotVisible(skeleton, 'axeBack')).toBe(true);     // 背包有 axe → 回背挂
  });

  it('采集 override 优先于战斗收刀：非战斗下 override 压过主手装备判断', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'weapon.spear', weaponKey: 'spear' },
      bag: [{ id: 'tool.worn_axe', toolType: 'axe' }]
    });
    entity._handToolOverride = 'axe';                      // 砍树：手里是斧头不是长矛
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(true);     // axe 手持（override）
    expect(slotVisible(skeleton, 'spearBack')).toBe(true);   // spear 未持握 → 背挂
  });

  it('离散剪辑保持（mapperHold）期间武器联动仍执行：砍伐 logging 剪辑中 override 上手', () => {
    const asset = buildWeaponSkeleton({
      extraClips: [{ name: 'logging', durationMs: 1000, loop: true, tracks: [] }]
    });
    const entity = buildEntity({
      mainhand: { id: 'tool.worn_axe', toolType: 'axe' }   // 非战斗：斧头应在背上
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'axeBack')).toBe(true);

    // 开始砍伐：GatheringSystem 设置 override + 播放 logging 离散剪辑（循环保持）
    entity._handToolOverride = 'axe';
    skeleton.currentClip = 'logging';
    skeleton.clipTime = 0;
    hook(skeleton);
    expect(slotVisible(skeleton, 'toolHand')).toBe(true);     // mapperHold return 前已上手
    expect(slotVisible(skeleton, 'axeBack')).toBe(false);    // 背上收起
  });
});

/**
 * 构造女骑士式骨架（槽位约定与 player-female.json 一致）：
 * weapon-sword 手持刀（armFR）、weapon-shield 手持盾（armFL）、
 * weapon-sword-waist 腰挂刀（hips，单手短兵器收纳）、weapon-shield-back 背挂盾（back，盾牌收纳）。
 */
function buildFemaleWeaponSkeleton() {
  return parseSkeletonAsset({
    schemaVersion: 1,
    skeletonId: 'skeleton.female-weapon-test',
    meta: { width: 64, height: 64 },
    defaultClip: 'idle_down',
    bones: [
      { id: 'hips', parent: null, x: 0, y: 0 },
      { id: 'armFR', parent: 'hips', x: 7, y: -16 },
      { id: 'armFL', parent: 'hips', x: -7, y: -16 },
      { id: 'back', parent: 'hips', x: 0, y: -14 }
    ],
    slots: [
      { id: 'weapon-sword', bone: 'armFR', z: 3, attachment: { type: 'image', assetId: 'player.female.sword', visible: true } },
      { id: 'weapon-shield', bone: 'armFL', z: 3, attachment: { type: 'image', assetId: 'player.female.shield', visible: true } },
      { id: 'weapon-sword-waist', bone: 'hips', z: 2, attachment: { type: 'image', assetId: 'player.female.sword', visible: false } },
      { id: 'weapon-shield-back', bone: 'back', z: 1, attachment: { type: 'image', assetId: 'player.female.shield', visible: false } }
    ],
    clips: [
      { name: 'idle_down', durationMs: 1000, loop: true, tracks: [] }
    ]
  });
}

describe('副手（盾）装备联动：战斗上手、非战斗收背挂，不参与战斗拔刀', () => {
  it('战斗 offhand 装盾：盾上手；主手无刀时刀槽/腰挂隐藏', () => {
    const asset = buildFemaleWeaponSkeleton();
    const entity = buildEntity({ offhand: { id: 'wooden_shield', weaponKey: 'shield', subType: 'shield' }, drawn: true });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'weapon-shield')).toBe(true);      // 战斗中盾上手
    expect(slotVisible(skeleton, 'weapon-shield-back')).toBe(false);// 不在背上
    expect(slotVisible(skeleton, 'weapon-sword')).toBe(false);      // 没有刀
    expect(slotVisible(skeleton, 'weapon-sword-waist')).toBe(false);// 背包也没刀
  });

  it('非战斗 offhand 装盾：盾收背挂（战斗才上手）', () => {
    const asset = buildFemaleWeaponSkeleton();
    const entity = buildEntity({ offhand: { id: 'wooden_shield', weaponKey: 'shield', subType: 'shield' } });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'weapon-shield')).toBe(false);     // 手上没盾
    expect(slotVisible(skeleton, 'weapon-shield-back')).toBe(true); // 盾背在背上
  });

  it('非战斗主手刀 + offhand 盾：刀收腰挂、盾收背挂', () => {
    const asset = buildFemaleWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'iron_sword', weaponKey: 'sword' },
      offhand: { id: 'wooden_shield', weaponKey: 'shield', subType: 'shield' }
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'weapon-sword')).toBe(false);       // 手上没刀
    expect(slotVisible(skeleton, 'weapon-sword-waist')).toBe(true);  // 刀挂腰间
    expect(slotVisible(skeleton, 'weapon-shield')).toBe(false);      // 手上没盾
    expect(slotVisible(skeleton, 'weapon-shield-back')).toBe(true);  // 盾背在背上
  });

  it('战斗中卸下盾（卸入背包）：手持盾隐、盾回背挂', () => {
    const asset = buildFemaleWeaponSkeleton();
    const offhandBox = { current: { id: 'wooden_shield', weaponKey: 'shield', subType: 'shield' } };
    const bagBox = { slots: [] };
    const equipment = { getEquipment: slot => (slot === 'offhand' ? offhandBox.current : null) };
    const entity = {
      isDead: false, isDying: false, isSoulState: false, _climbing: false,
      getComponent(name) {
        if (name === 'sprite') return { direction: 'down', flipX: false, isWalking: false, isStopping: false };
        if (name === 'equipment') return equipment;
        if (name === 'inventory') return bagBox;
        return null;
      }
    };
    entity._weaponDrawn = true;                                      // 战斗中
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'weapon-shield')).toBe(true);
    expect(slotVisible(skeleton, 'weapon-shield-back')).toBe(false);

    offhandBox.current = null;                                       // unequipItem → 卸入背包
    bagBox.slots = [{ item: { id: 'wooden_shield', weaponKey: 'shield', subType: 'shield' }, quantity: 1 }];
    hook(skeleton);
    expect(slotVisible(skeleton, 'weapon-shield')).toBe(false);      // 手上没盾了
    expect(slotVisible(skeleton, 'weapon-shield-back')).toBe(true);  // 盾收回背上
  });

  it('盾在背包未装备：盾槽隐藏、回背挂，且不会被战斗自动上手（拔刀不含盾）', () => {
    const asset = buildFemaleWeaponSkeleton();
    const entity = buildEntity({
      offhand: null,
      bag: [{ id: 'wooden_shield', weaponKey: 'shield', subType: 'shield' }],
      drawn: true                                                // 进战斗，主手空
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'weapon-shield')).toBe(false);      // 盾不是拔出对象
    expect(slotVisible(skeleton, 'weapon-shield-back')).toBe(true);  // 盾挂在背上
    expect(slotVisible(skeleton, 'weapon-sword')).toBe(false);
  });

  it('主手刀 + offhand 盾（战斗）：刀上手、盾同持、刀腰挂隐藏', () => {
    const asset = buildFemaleWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'iron_sword', weaponKey: 'sword' },
      offhand: { id: 'wooden_shield', weaponKey: 'shield', subType: 'shield' },
      drawn: true
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'weapon-sword')).toBe(true);        // 刀拔出
    expect(slotVisible(skeleton, 'weapon-shield')).toBe(true);       // 盾持握（双持表现）
    expect(slotVisible(skeleton, 'weapon-sword-waist')).toBe(false); // 刀已上手不挂腰
  });

  it('非战斗主手空 + 背包有刀 + offhand 盾：刀回腰挂、盾回背挂', () => {
    const asset = buildFemaleWeaponSkeleton();
    const entity = buildEntity({
      offhand: { id: 'wooden_shield', weaponKey: 'shield', subType: 'shield' },
      bag: [{ id: 'iron_sword', weaponKey: 'sword' }]
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'weapon-sword')).toBe(false);       // 非战斗收刀
    expect(slotVisible(skeleton, 'weapon-sword-waist')).toBe(true);  // 刀挂腰间
    expect(slotVisible(skeleton, 'weapon-shield')).toBe(false);      // 非战斗盾不持握
    expect(slotVisible(skeleton, 'weapon-shield-back')).toBe(true);  // 盾背在背上
  });

  it('长兵器（spear）非战斗：回背挂而非腰挂', () => {
    const asset = parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.spear-test',
      meta: { width: 64, height: 64 },
      defaultClip: 'idle_down',
      bones: [{ id: 'hips', parent: null, x: 0, y: 0 }, { id: 'armFR', parent: 'hips', x: 7, y: -16 }, { id: 'back', parent: 'hips', x: 0, y: -14 }],
      slots: [
        { id: 'weapon-spear', bone: 'armFR', z: 3, attachment: { type: 'image', assetId: 'player.parts.weapon-spear', visible: true } },
        { id: 'weapon-spear-back', bone: 'back', z: 1, attachment: { type: 'image', assetId: 'player.parts.weapon-spear', visible: false } },
        { id: 'weapon-spear-waist', bone: 'hips', z: 2, attachment: { type: 'image', assetId: 'player.parts.weapon-spear', visible: false } }
      ],
      clips: [{ name: 'idle_down', durationMs: 1000, loop: true, tracks: [] }]
    });
    const entity = buildEntity({ bag: [{ id: 'weapon.s07.pursuit_spear', weaponKey: 'spear' }] });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'weapon-spear-back')).toBe(true);   // 长兵器挂背
    expect(slotVisible(skeleton, 'weapon-spear-waist')).toBe(false); // 不挂腰
  });

  it('offhand 装无 weaponKey 的物品（法符等）：盾槽不亮', () => {
    const asset = buildFemaleWeaponSkeleton();
    const entity = buildEntity({ offhand: { id: 'equipment.s12.taiping_scripture', subType: 'talisman' } });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'weapon-shield')).toBe(false);
  });
});

describe('头部三态可见性（正面/侧面/背面按朝向切换）', () => {
  it('朝下：headFront 显示，headSide/headBack 隐藏', () => {
    const asset = buildHeadSkeleton();
    const entity = buildEntity({ direction: 'down' });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'headFront')).toBe(true);
    expect(slotVisible(skeleton, 'headSide')).toBe(false);
    expect(slotVisible(skeleton, 'headBack')).toBe(false);
  });

  it('朝上：headBack 显示，headFront/headSide 隐藏', () => {
    const asset = buildHeadSkeleton();
    const entity = buildEntity({ direction: 'up' });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'headBack')).toBe(true);
    expect(slotVisible(skeleton, 'headFront')).toBe(false);
    expect(slotVisible(skeleton, 'headSide')).toBe(false);
  });

  it('朝侧面：headSide 显示，headFront/headBack 隐藏', () => {
    const asset = buildHeadSkeleton();
    const entity = buildEntity({ direction: 'right' });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(skeleton, 'headSide')).toBe(true);
    expect(slotVisible(skeleton, 'headFront')).toBe(false);
    expect(slotVisible(skeleton, 'headBack')).toBe(false);
  });

  it('背挂武器随朝向换边：朝上翻转，朝下不翻转', () => {
    const asset = buildHeadSkeleton();
    const entity = buildEntity({ direction: 'up' });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotFlipX(skeleton, 'spearBack')).toBe(true);

    entity.getComponent('sprite').direction = 'down';
    hook(skeleton);
    expect(slotFlipX(skeleton, 'spearBack')).toBe(false);
  });
});

describe('多实体隔离：共享资产只读，运行时状态落在实体本地覆盖层', () => {
  it('两个实体共用同一资产：各自朝向的头部可见性互不干扰', () => {
    const asset = buildHeadSkeleton();
    const entityA = buildEntity({ direction: 'down' });
    const entityB = buildEntity({ direction: 'up' });
    const hookA = createPlayerSkeletonStateMapper(entityA, {});
    const hookB = createPlayerSkeletonStateMapper(entityB, {});
    const skeletonA = buildSkeletonComponent(asset);
    const skeletonB = buildSkeletonComponent(asset);

    hookA(skeletonA);
    hookB(skeletonB);

    // 甲朝下 → 正面头；乙朝上 → 背面头
    expect(slotVisible(skeletonA, 'headFront')).toBe(true);
    expect(slotVisible(skeletonA, 'headBack')).toBe(false);
    expect(slotVisible(skeletonB, 'headFront')).toBe(false);
    expect(slotVisible(skeletonB, 'headBack')).toBe(true);
  });

  it('两个实体共用同一资产：背挂武器翻转状态互不干扰', () => {
    const asset = buildHeadSkeleton();
    const entityA = buildEntity({ direction: 'up' });
    const entityB = buildEntity({ direction: 'down' });
    const hookA = createPlayerSkeletonStateMapper(entityA, {});
    const hookB = createPlayerSkeletonStateMapper(entityB, {});
    const skeletonA = buildSkeletonComponent(asset);
    const skeletonB = buildSkeletonComponent(asset);

    hookA(skeletonA);
    hookB(skeletonB);

    expect(slotFlipX(skeletonA, 'spearBack')).toBe(true);
    expect(slotFlipX(skeletonB, 'spearBack')).toBe(false);
  });

  it('两个实体共用同一资产：武器上手/背挂状态互不干扰', () => {
    const asset = buildWeaponSkeleton();
    // 甲背包有斧头 → 斧头背挂显示；乙什么都没有 → 斧头背挂隐藏
    const entityA = buildEntity({ bag: [{ id: 'tool.worn_axe', toolType: 'axe' }] });
    const entityB = buildEntity({});
    const hookA = createPlayerSkeletonStateMapper(entityA, {});
    const hookB = createPlayerSkeletonStateMapper(entityB, {});
    const skeletonA = buildSkeletonComponent(asset);
    const skeletonB = buildSkeletonComponent(asset);

    hookA(skeletonA);
    hookB(skeletonB);

    expect(slotVisible(skeletonA, 'axeBack')).toBe(true);
    expect(slotVisible(skeletonB, 'axeBack')).toBe(false);
  });

  it('映射器不改写共享资产本身（attachment 保持原始值）', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({ bag: [{ id: 'tool.worn_axe', toolType: 'axe' }] });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);

    const sharedToolHand = asset.slots.find(slot => slot.id === 'toolHand');
    expect(sharedToolHand.attachment.visible).toBe(false);   // 共享数据未被改写
    expect(slotVisible(skeleton, 'axeBack')).toBe(true);     // 实体本地覆盖层生效
  });
});

describe('防具槽位联动（有装备用配置上身，无装备隐藏）', () => {
  /** 构造带防具槽位的骨骼：armorTorso/armorSkirt/armorBootL/R/helmet（empty 附件，与 player.json 同约定）。 */
  function buildArmorSkeleton() {
    return parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.armor-test',
      meta: { width: 96, height: 96 },
      defaultClip: 'idle_down',
      bones: [
        { id: 'root', parent: null, x: 0, y: 0 },
        { id: 'chest', parent: 'root', x: 0, y: -30 },
        { id: 'spine', parent: 'root', x: 0, y: -24 },
        { id: 'footL', parent: 'root', x: -4, y: 0 },
        { id: 'footR', parent: 'root', x: 4, y: 0 },
        { id: 'head', parent: 'root', x: 0, y: -40 },
        { id: 'forearmL', parent: 'root', x: -10, y: -20 },
        { id: 'forearmR', parent: 'root', x: 10, y: -20 }
      ],
      slots: [
        { id: 'armorTorso', bone: 'chest', z: 25, attachment: { type: 'empty', x: 0, y: 0, rot: 0 } },
        { id: 'armorSkirt', bone: 'spine', z: 26, attachment: { type: 'empty', x: 0, y: 0, rot: 0 } },
        { id: 'armorBootL', bone: 'footL', z: 13, attachment: { type: 'empty', x: 0, y: 0, rot: 0 } },
        { id: 'armorBootR', bone: 'footR', z: 13, attachment: { type: 'empty', x: 0, y: 0, rot: 0 } },
        { id: 'helmet', bone: 'head', z: 14, attachment: { type: 'empty', x: 0, y: 0, rot: 0 } },
        { id: 'armorWristL', bone: 'forearmL', z: 16, attachment: { type: 'empty', x: 0, y: 0, rot: 0 } },
        { id: 'armorWristR', bone: 'forearmR', z: 25, attachment: { type: 'empty', x: 0, y: 0, rot: 0 } }
      ],
      clips: [{ name: 'idle_down', durationMs: 1000, loop: true, tracks: [] }]
    });
  }

  /** 取槽位合并后的附件（共享 attachment + 实体覆盖层）。 */
  function slotAttachment(skeleton, slotId) {
    const slot = skeleton.skeletonAsset.slots.find(candidate => candidate.id === slotId);
    return skeleton.resolveSlotAttachment(slot);
  }

  const wolfVest = {
    id: 'equipment.s01.wolf_hide_vest', subType: 'armor',
    skeletonPart: { assetId: 'player.parts.wolf-hide-vest', width: 64, height: 64 }
  };
  const wolfSkirt = {
    id: 'equipment.s01.wolf_hide_skirt', subType: 'skirt',
    skeletonPart: { assetId: 'player.parts.wolf-hide-skirt', width: 64, height: 64 }
  };
  const wolfBoots = {
    id: 'equipment.s01.wolf_hide_boots', subType: 'boots',
    skeletonPart: { assetId: 'player.parts.wolf-hide-boots', width: 64, height: 64 }
  };

  it('装备胸甲：armorTorso 槽位换图上身（visible+type:image+assetId），其余防具槽位隐藏', () => {
    const skeleton = buildSkeletonComponent(buildArmorSkeleton());
    const hook = createPlayerSkeletonStateMapper(buildEntity({ armor: wolfVest }), {});
    hook(skeleton);
    const torso = slotAttachment(skeleton, 'armorTorso');
    expect(torso.visible).toBe(true);
    expect(torso.type).toBe('image');
    expect(torso.assetId).toBe('player.parts.wolf-hide-vest');
    expect(torso.width).toBe(64);
    expect(slotAttachment(skeleton, 'armorSkirt').visible).toBe(false);
    expect(slotAttachment(skeleton, 'helmet').type).toBe('empty');
  });

  it('装备靴子：左右脚两个槽位共用同一件装备的部件图', () => {
    const skeleton = buildSkeletonComponent(buildArmorSkeleton());
    const hook = createPlayerSkeletonStateMapper(buildEntity({ boots: wolfBoots }), {});
    hook(skeleton);
    expect(slotAttachment(skeleton, 'armorBootL').assetId).toBe('player.parts.wolf-hide-boots');
    expect(slotAttachment(skeleton, 'armorBootR').assetId).toBe('player.parts.wolf-hide-boots');
    expect(slotAttachment(skeleton, 'armorBootL').visible).toBe(true);
    expect(slotAttachment(skeleton, 'armorTorso').visible).toBe(false);
  });

  it('卸下装备：槽位恢复隐藏（下一帧自动生效，无需事件）', () => {
    const skeleton = buildSkeletonComponent(buildArmorSkeleton());
    const hook = createPlayerSkeletonStateMapper(buildEntity({ armor: wolfVest, pants: wolfSkirt }), {});
    hook(skeleton);
    expect(slotAttachment(skeleton, 'armorTorso').visible).toBe(true);
    expect(slotAttachment(skeleton, 'armorSkirt').visible).toBe(true);
    // 卸下胸甲后（pants 不变）：新装备签名 → armorTorso 隐藏、armorSkirt 不受影响
    const skeleton2 = buildSkeletonComponent(buildArmorSkeleton());
    createPlayerSkeletonStateMapper(buildEntity({ pants: wolfSkirt }), {})(skeleton2);
    expect(slotAttachment(skeleton2, 'armorTorso').visible).toBe(false);
    expect(slotAttachment(skeleton2, 'armorSkirt').visible).toBe(true);
  });

  it('物品带 directionOffsets：5 方向形态覆盖透传到槽位附件', () => {
    const vest = {
      id: 'equipment.test.vest2', subType: 'armor',
      skeletonPart: {
        assetId: 'player.parts.wolf-hide-vest', width: 64, height: 64,
        directionOffsets: { side: { assetId: 'player.parts.wolf-hide-vest-side', width: 60, height: 60 } }
      }
    };
    const skeleton = buildSkeletonComponent(buildArmorSkeleton());
    createPlayerSkeletonStateMapper(buildEntity({ armor: vest }), {})(skeleton);
    const torso = slotAttachment(skeleton, 'armorTorso');
    expect(torso.directionOffsets?.side?.assetId).toBe('player.parts.wolf-hide-vest-side');
  });

  it('物品无 skeletonPart 绑定：不上身（槽位保持隐藏），零回归', () => {
    const skeleton = buildSkeletonComponent(buildArmorSkeleton());
    createPlayerSkeletonStateMapper(buildEntity({ armor: { id: 'equipment.x', subType: 'armor' } }), {})(skeleton);
    expect(slotAttachment(skeleton, 'armorTorso').visible).toBe(false);
    expect(slotAttachment(skeleton, 'armorTorso').type).toBe('empty');
  });

  it('骨架未预建防具槽位（旧资产）：装备防具不炸、不写覆盖', () => {
    const skeleton = buildSkeletonComponent(buildWeaponSkeleton());
    const hook = createPlayerSkeletonStateMapper(buildEntity({ armor: wolfVest }), {});
    expect(() => hook(skeleton)).not.toThrow();
    expect(skeleton.getSlotOverride('armorTorso')).toBe(null);
  });

  it('accessory 槽护腕（skeletonPart.slots 显式声明）：上身到声明槽位', () => {
    const bracers = {
      id: 'equipment.s01.wolf_hide_bracers', subType: 'accessory',
      skeletonPart: {
        assetId: 'player.parts.wolf-hide-bracers', width: 64, height: 64,
        slots: ['armorWristL', 'armorWristR']
      }
    };
    const skeleton = buildSkeletonComponent(buildArmorSkeleton());
    createPlayerSkeletonStateMapper(buildEntity({ accessory: bracers }), {})(skeleton);
    expect(slotAttachment(skeleton, 'armorWristL').assetId).toBe('player.parts.wolf-hide-bracers');
    expect(slotAttachment(skeleton, 'armorWristR').assetId).toBe('player.parts.wolf-hide-bracers');
    expect(slotAttachment(skeleton, 'armorWristL').visible).toBe(true);
    expect(slotAttachment(skeleton, 'armorTorso').visible).toBe(false);
  });

  it('accessory 无 skeletonPart（戒指/项链类）：不上身（零回归）', () => {
    const skeleton = buildSkeletonComponent(buildArmorSkeleton());
    createPlayerSkeletonStateMapper(buildEntity({ accessory: { id: 'equipment.ring', subType: 'accessory' } }), {})(skeleton);
    // 无绑定 → accessory 槽无映射表 → 不写覆盖，附件保持 empty（渲染器不画）
    expect(slotAttachment(skeleton, 'armorWristL').visible).not.toBe(true);
    expect(slotAttachment(skeleton, 'armorWristR').visible).not.toBe(true);
    expect(slotAttachment(skeleton, 'armorWristL').type).toBe('empty');
  });

  it('物品 slots 声明优先于装备槽 kind 映射表', () => {
    const vest = {
      id: 'equipment.test.vest3', subType: 'armor',
      skeletonPart: { assetId: 'player.parts.wolf-hide-vest', width: 64, height: 64, slots: ['armorTorso'] }
    };
    const skeleton = buildSkeletonComponent(buildArmorSkeleton());
    createPlayerSkeletonStateMapper(buildEntity({ armor: vest }), {})(skeleton);
    // 声明只列 armorTorso → armorTorso 换图上身（armorSkirt 由 pants 槽空置走映射表隐藏）
    expect(slotAttachment(skeleton, 'armorTorso').visible).toBe(true);
    expect(slotAttachment(skeleton, 'armorSkirt').visible).toBe(false);
  });

  it('卸下 slots 声明的装备：同会话内残留槽位清理隐藏（声明丢失也能恢复）', () => {
    const bracers = {
      id: 'equipment.s01.wolf_hide_bracers', subType: 'accessory',
      skeletonPart: { assetId: 'player.parts.wolf-hide-bracers', width: 64, height: 64, slots: ['armorWristL', 'armorWristR'] }
    };
    const skeleton = buildSkeletonComponent(buildArmorSkeleton());
    const entity = buildEntity({ accessory: bracers });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(skeleton);
    expect(slotAttachment(skeleton, 'armorWristL').visible).toBe(true);
    expect(slotAttachment(skeleton, 'armorWristR').visible).toBe(true);
    // 同会话卸下（换成无绑定的戒指）：装备签名变化 → 上轮声明的 armorWristL/R 被残留清理隐藏
    entity._equipState.accessory = { id: 'equipment.ring', subType: 'accessory' };
    hook(skeleton);
    expect(slotAttachment(skeleton, 'armorWristL').visible).toBe(false);
    expect(slotAttachment(skeleton, 'armorWristR').visible).toBe(false);
  });
});
