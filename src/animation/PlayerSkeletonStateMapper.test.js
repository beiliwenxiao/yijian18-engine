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

/** 构造实体 mock：sprite/equipment/inventory 三组件 + _weaponDrawn 战斗持握标志。 */
function buildEntity({ mainhand = null, bag = [], drawn = false } = {}) {
  const sprite = { direction: 'down', flipX: false, isWalking: false, isStopping: false };
  const equipment = { getEquipment: slot => (slot === 'mainhand' ? mainhand : null) };
  const inventory = { slots: bag.map(item => ({ item, quantity: 1 })) };
  const entity = {
    isDead: false, isDying: false, isSoulState: false, _climbing: false,
    getComponent(name) {
      if (name === 'sprite') return sprite;
      if (name === 'equipment') return equipment;
      if (name === 'inventory') return inventory;
      return null;
    }
  };
  entity._weaponDrawn = drawn; // CombatSystem.enterCombat/exitCombat 维护
  return entity;
}

function buildSkeletonComponent(asset) {
  return { skeletonAsset: asset, currentClip: 'idle_down', clipTime: 0, playClip() {} };
}

function slotVisible(asset, slotId) {
  return asset.slots.find(slot => slot.id === slotId)?.attachment?.visible;
}

describe('武器槽位联动（战斗=手持，非战斗=背挂，采集=手持）', () => {
  it('背包为空且无装备：手持/背挂位全隐藏', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity();
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'toolHand')).toBe(false);
    expect(slotVisible(asset, 'axeBack')).toBe(false);
    expect(slotVisible(asset, 'spearBack')).toBe(false);
  });

  it('背包有 spear 但未装备（非战斗）：spear 背挂显示，手持隐藏', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({ bag: [{ id: 'weapon.spear', weaponKey: 'spear' }] });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'toolHand')).toBe(false);   // axe 手持隐藏
    expect(slotVisible(asset, 'spearBack')).toBe(true);    // spear 背挂显示
  });

  it('非战斗装备 axe（收刀回背）：手持隐藏，axeBack 显示（装备移出背包仍计入背挂来源）', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'tool.worn_axe', toolType: 'axe' },
      bag: []
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'toolHand')).toBe(false);    // 非战斗不持握
    expect(slotVisible(asset, 'axeBack')).toBe(true);     // 斧头背在背上
  });

  it('战斗装备 axe（拔出）：手持显示，axeBack 隐藏', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'tool.worn_axe', toolType: 'axe' },
      drawn: true                                          // CombatSystem.enterCombat
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'toolHand')).toBe(true);     // 拿在手上
    expect(slotVisible(asset, 'axeBack')).toBe(false);    // 背上收起
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
    expect(slotVisible(asset, 'toolHand')).toBe(true);

    entity._weaponDrawn = false;                           // CombatSystem.exitCombat
    hook(skeleton);
    expect(slotVisible(asset, 'toolHand')).toBe(false);    // 收刀
    expect(slotVisible(asset, 'axeBack')).toBe(true);      // 回背
  });

  it('非战斗装备 spear：spear 背挂显示（收枪回背）；背包另有 axe 也背挂', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'weapon.spear', weaponKey: 'spear' },
      bag: [{ id: 'tool.worn_axe', toolType: 'axe' }]
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'spearBack')).toBe(true);    // 已装备 spear 非战斗回背
    expect(slotVisible(asset, 'axeBack')).toBe(true);     // 背包 axe 背挂
  });

  it('战斗装备 spear：spear 背挂隐藏（已上手），axe 手持隐藏', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'weapon.spear', weaponKey: 'spear' },
      bag: [{ id: 'tool.worn_axe', toolType: 'axe' }],
      drawn: true
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'toolHand')).toBe(false);    // axe 手持隐藏（未装备）
    expect(slotVisible(asset, 'spearBack')).toBe(false);   // spear 背挂隐藏（已上手）
    expect(slotVisible(asset, 'axeBack')).toBe(true);      // axe 仍在背上（背包有）
  });

  it('战斗态但主手为空：背包有斧头则自动上手（攻击时手持斧头）', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      bag: [{ id: 'tool.worn_axe', toolType: 'axe' }],
      drawn: true
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'toolHand')).toBe(true);     // 背包有斧头：攻击时拿在手上
    expect(slotVisible(asset, 'axeBack')).toBe(false);     // 拿在手上 → 背挂隐藏
  });

  it('战斗态且没有任何武器：手持不显示（不凭空持握）', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({ bag: [], drawn: true });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'toolHand')).toBe(false);    // 无装备无背包武器：不显示
    expect(slotVisible(asset, 'axeBack')).toBe(false);     // 背包无斧头：背挂也隐藏
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
    expect(slotVisible(asset, 'toolHand')).toBe(true);     // 战斗中已装备 axe

    mainhandBox.current = null;                            // 卸下
    bag.push({ item: { id: 'tool.worn_axe', toolType: 'axe' }, quantity: 1 });
    hook(skeleton);
    expect(slotVisible(asset, 'toolHand')).toBe(false);    // 手持隐藏
    expect(slotVisible(asset, 'axeBack')).toBe(true);     // 回背包 → 背挂显示
  });

  it('采集自动手持：非战斗下 _handToolOverride 使手持位显示（采集开始）', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({ bag: [{ id: 'tool.worn_axe', toolType: 'axe' }] });
    entity._handToolOverride = 'axe';                      // GatheringSystem.start 设置
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'toolHand')).toBe(true);     // 手上出现斧头
    expect(slotVisible(asset, 'axeBack')).toBe(false);    // 背上收起
  });

  it('采集结束：_handToolOverride 清除后手持隐藏、回背挂（工具消失/装备则回背）', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({ bag: [{ id: 'tool.worn_axe', toolType: 'axe' }] });
    entity._handToolOverride = 'axe';
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);
    hook(skeleton);
    expect(slotVisible(asset, 'toolHand')).toBe(true);

    entity._handToolOverride = null;                       // _finish 清除
    hook(skeleton);
    expect(slotVisible(asset, 'toolHand')).toBe(false);    // 手持隐藏
    expect(slotVisible(asset, 'axeBack')).toBe(true);     // 背包有 axe → 回背挂
  });

  it('采集 override 优先于战斗收刀：非战斗下 override 压过主手装备判断', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'weapon.spear', weaponKey: 'spear' },
      bag: [{ id: 'tool.worn_axe', toolType: 'axe' }]
    });
    entity._handToolOverride = 'axe';                      // 砍树：手里是斧头不是长矛
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'toolHand')).toBe(true);     // axe 手持（override）
    expect(slotVisible(asset, 'spearBack')).toBe(true);   // spear 未持握 → 背挂
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
    expect(slotVisible(asset, 'axeBack')).toBe(true);

    // 开始砍伐：GatheringSystem 设置 override + 播放 logging 离散剪辑（循环保持）
    entity._handToolOverride = 'axe';
    skeleton.currentClip = 'logging';
    skeleton.clipTime = 0;
    hook(skeleton);
    expect(slotVisible(asset, 'toolHand')).toBe(true);     // mapperHold return 前已上手
    expect(slotVisible(asset, 'axeBack')).toBe(false);    // 背上收起
  });
});
