import { describe, it, expect } from 'vitest';
import { parseSkeletonAsset } from './SkeletonAsset.js';
import { createPlayerSkeletonStateMapper } from './PlayerSkeletonStateMapper.js';

/** 构造带武器槽位的骨骼：weapon-axe 手持（挂 armFR）、weapon-spear-back 背挂（挂 back）。 */
function buildWeaponSkeleton() {
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
      { id: 'spearBack', bone: 'back', z: 1, attachment: { type: 'image', assetId: 'player.parts.weapon-spear', visible: false } }
    ],
    clips: [{ name: 'idle_down', durationMs: 1000, loop: true, tracks: [] }]
  });
}

/** 构造实体 mock：sprite/equipment/inventory 三组件。 */
function buildEntity({ mainhand = null, bag = [] } = {}) {
  const sprite = { direction: 'down', flipX: false, isWalking: false, isStopping: false };
  const equipment = { getEquipment: slot => (slot === 'mainhand' ? mainhand : null) };
  const inventory = { slots: bag.map(item => ({ item, quantity: 1 })) };
  return {
    isDead: false, isDying: false, isSoulState: false, _climbing: false,
    getComponent(name) {
      if (name === 'sprite') return sprite;
      if (name === 'equipment') return equipment;
      if (name === 'inventory') return inventory;
      return null;
    }
  };
}

function buildSkeletonComponent(asset) {
  return { skeletonAsset: asset, currentClip: 'idle_down', clipTime: 0, playClip() {} };
}

function slotVisible(asset, slotId) {
  return asset.slots.find(slot => slot.id === slotId)?.attachment?.visible;
}

describe('武器槽位联动（装备=手持，卸下=背挂）', () => {
  it('背包为空且无装备：手持/背挂位全隐藏', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity();
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'toolHand')).toBe(false);
    expect(slotVisible(asset, 'spearBack')).toBe(false);
  });

  it('背包有 spear 但未装备：spear 背挂位显示，axe 手持位隐藏', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({ bag: [{ id: 'weapon.spear', weaponKey: 'spear' }] });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'toolHand')).toBe(false);   // axe 手持隐藏
    expect(slotVisible(asset, 'spearBack')).toBe(true);    // spear 背挂显示
  });

  it('装备 axe（拔斧）：axe 手持显示，spear 背挂保持（背包仍有 spear）', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'weapon.axe', weaponKey: 'axe' },
      bag: [{ id: 'weapon.spear', weaponKey: 'spear' }]
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'toolHand')).toBe(true);     // axe 手持显示
    expect(slotVisible(asset, 'spearBack')).toBe(true);    // spear 背挂显示（未装备但在背包）
  });

  it('装备 spear（拔枪）：spear 背挂隐藏（已上手），axe 手持隐藏', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({
      mainhand: { id: 'weapon.spear', weaponKey: 'spear' },
      bag: [{ id: 'weapon.axe', weaponKey: 'axe' }]
    });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'toolHand')).toBe(false);    // axe 手持隐藏（未装备）
    expect(slotVisible(asset, 'spearBack')).toBe(false);   // spear 背挂隐藏（已上手）
  });

  it('工具类装备用 toolType 兜底（tool.worn_axe toolType=axe → 匹配 weapon-axe）', () => {
    const asset = buildWeaponSkeleton();
    const entity = buildEntity({ mainhand: { id: 'tool.worn_axe', toolType: 'axe' } });
    const hook = createPlayerSkeletonStateMapper(entity, {});
    hook(buildSkeletonComponent(asset));
    expect(slotVisible(asset, 'toolHand')).toBe(true);     // axe 手持显示
  });

  it('装备变化驱动状态切换：先装备 axe 再卸下，槽位显隐随之翻转', () => {
    const asset = buildWeaponSkeleton();
    const mainhandBox = { current: { id: 'weapon.axe', weaponKey: 'axe' } };
    const entity = buildEntity({ mainhand: mainhandBox.current });
    // 卸下时背包接收该武器
    const equipment = { getEquipment: slot => (slot === 'mainhand' ? mainhandBox.current : null) };
    entity.getComponent = name => {
      if (name === 'sprite') return { direction: 'down', flipX: false, isWalking: false };
      if (name === 'equipment') return equipment;
      if (name === 'inventory') return { slots: [] };
      return null;
    };
    const hook = createPlayerSkeletonStateMapper(entity, {});
    const skeleton = buildSkeletonComponent(asset);

    hook(skeleton);
    expect(slotVisible(asset, 'toolHand')).toBe(true);     // 已装备 axe

    mainhandBox.current = null;                            // 卸下
    hook(skeleton);
    expect(slotVisible(asset, 'toolHand')).toBe(false);    // 手持隐藏
  });
});
