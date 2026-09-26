import { describe, expect, it } from 'vitest';
import { ScenePlacementRuntime, getPlacementSignature } from './ScenePlacementRuntime.js';

function createRuntime(placement) {
  return new ScenePlacementRuntime({
    entityStore: {
      all: [], pickups: [], equipmentItems: [],
      removeMany: values => values
    }
  });
}

const placement = {
  id: 'S01-pickup-worn-axe', sceneId: 'S01', type: 'ref', kind: 'item',
  ref: 'tool.worn_axe', group: 'S01-worn-axe',
  overrides: { instanceId: 'S01-tool-axe-1' },
  spawnWhen: { blackboardKey: 'storyState', path: 's01Survival.axeDropped', equals: true },
  x: 643, y: 506, _localX: 643, _localY: 506
};

describe('ScenePlacementRuntime placement definition signatures', () => {
  it('应用签名匹配的动态状态', () => {
    const runtime = createRuntime(placement);
    runtime.setProjection([placement]);
    runtime.addPendingPlacementState(placement.id, {
      kind: 'item', quantity: 2, placementSignature: getPlacementSignature(placement)
    });
    const item = { placementId: placement.id, quantity: 1 };

    runtime.applyPendingToExisting([item]);

    expect(item.quantity).toBe(2);
    expect(runtime.pendingPlacementStates.has(placement.id)).toBe(false);
  });

  it('签名缺失的旧状态按当前 canonical placement 补签并应用', () => {
    // 现行契约：addPendingPlacementState 为缺失签名自动补当前签名（旧存档兼容）
    const runtime = createRuntime(placement);
    runtime.setProjection([placement]);
    runtime.addPendingPlacementState(placement.id, { kind: 'item', quantity: 2, placementSignature: undefined });
    const item = { placementId: placement.id, quantity: 1 };

    runtime.applyPendingToExisting([item]);

    expect(item.quantity).toBe(2);
    expect(runtime.pendingPlacementStates.has(placement.id)).toBe(false);
  });

  it('坐标已编辑的旧状态不会覆盖当前 canonical placement', () => {
    const runtime = createRuntime(placement);
    runtime.setProjection([placement]);
    runtime.addPendingPlacementState(placement.id, {
      kind: 'item', quantity: 2,
      placementSignature: getPlacementSignature({ ...placement, _localX: 500, _localY: 480, x: 500, y: 480 })
    });
    const item = { placementId: placement.id, quantity: 1 };

    runtime.applyPendingToExisting([item]);

    expect(item.quantity).toBe(1);
    expect(runtime.pendingPlacementStates.has(placement.id)).toBe(false);
  });
});
