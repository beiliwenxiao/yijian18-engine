import { describe, it, expect } from 'vitest';
import { weaponKeyOf, partIdOfItem, resolvePart, resolveItemPart, buildPartRegistry } from './SkeletonPartResolver.js';

const parts = buildPartRegistry([
  { id: 'part.weapon.axe', category: 'weapon', weaponKey: 'axe', assetId: 'player.parts.weapon-axe', width: 64, height: 64 },
  { id: 'part.head.front', category: 'head', direction: 'front', assetId: 'player.parts.head-front', width: 64, height: 64, tags: ['body'] }
]);

describe('SkeletonPartResolver', () => {
  it('weaponKeyOf 优先级：skeletonPart.weaponKey > weaponKey > toolType', () => {
    expect(weaponKeyOf({ skeletonPart: { weaponKey: 'spear' }, weaponKey: 'axe', toolType: 'pickaxe' })).toBe('spear');
    expect(weaponKeyOf({ weaponKey: 'axe', toolType: 'pickaxe' })).toBe('axe');
    expect(weaponKeyOf({ toolType: 'axe' })).toBe('axe');
    expect(weaponKeyOf({})).toBeNull();
  });

  it('partIdOfItem 读 skeletonPart.partId', () => {
    expect(partIdOfItem({ skeletonPart: { partId: 'part.weapon.axe' } })).toBe('part.weapon.axe');
    expect(partIdOfItem({})).toBeNull();
  });

  it('resolvePart 从注册表解析部件', () => {
    const part = resolvePart('part.weapon.axe', parts);
    expect(part.assetId).toBe('player.parts.weapon-axe');
    expect(part.weaponKey).toBe('axe');
    expect(part.width).toBe(64);
    expect(resolvePart('part.missing', parts)).toBeNull();
  });

  it('resolveItemPart 解析装备部件绑定配置', () => {
    const item = { skeletonPart: { partId: 'part.weapon.axe', bone: 'armFR', slotId: 'toolHand', offset: { x: 17.8, y: -7.2 } } };
    const resolved = resolveItemPart(item, parts);
    expect(resolved.bone).toBe('armFR');
    expect(resolved.slotId).toBe('toolHand');
    expect(resolved.weaponKey).toBe('axe'); // 从 part.weaponKey 继承
    expect(resolved.offset.x).toBe(17.8);
    expect(resolveItemPart({}, parts)).toBeNull();
  });

  it('buildPartRegistry 跳过无 id 项', () => {
    const registry = buildPartRegistry([{ id: 'a' }, { assetId: 'no-id' }, null]);
    expect(registry.size).toBe(1);
    expect(registry.has('a')).toBe(true);
  });
});
