import { describe, expect, it, vi } from 'vitest';
import { CanonicalSnapshot } from '../core/CanonicalSnapshot.js';
import { DefinitionRepository } from '../core/DefinitionRepository.js';
import { CommandGateway } from '../core/command/CommandGateway.js';
import { LocalAuthorityAdapter } from '../core/command/LocalAuthorityAdapter.js';
import { CanonicalStateTransactionService } from './CanonicalStateTransactionService.js';
import { InventoryTransactionService } from './InventoryTransactionService.js';

class Board {
  constructor(values) { this.values = structuredClone(values); }
  get(key) { return this.values[key]; }
  set(key, value) { this.values[key] = structuredClone(value); }
  serialize() { return structuredClone(this.values); }
  deserialize(value) { this.values = structuredClone(value); }
}
class Inventory {
  constructor(items) { this.slots = items.map(item => ({ item: { id: item.id, type: 'resource', maxStack: 99 }, quantity: item.quantity })); }
  getItemCount(id) { return this.slots.filter(slot => slot?.item.id === id).reduce((sum, slot) => sum + slot.quantity, 0); }
  exportItems() { return structuredClone(this.slots); }
  loadItems(value) { this.slots = structuredClone(value); }
  removeItem(id, quantity) { const slot = this.slots.find(entry => entry?.item.id === id); if (!slot || slot.quantity < quantity) return 0; slot.quantity -= quantity; return quantity; }
  addItem(item, quantity) { const slot = this.slots.find(entry => entry?.item.id === item.id); if (slot) slot.quantity += quantity; else this.slots.push({ item: structuredClone(item), quantity }); return quantity; }
}
function repository() {
  return DefinitionRepository.fromSnapshot(CanonicalSnapshot.fromProject({ schemaVersion: 1, scenes: [], dialogues: [], quests: [], triggers: [], tutorials: [], rescues: [], battles: [], endings: [], scenarios: [],
    commands: [{ id: 'story.donate', commandType: 'state.transaction', transaction: {
      when: { all: [{ path: 'story.currentSceneId', equals: 'S09' }, { inventory: { itemId: 'resource.food', quantity: 20 } }] },
      writes: [{ target: 'city', cityId: 'city.one', path: 'morale', value: { $add: [{ $get: 'cityStates.0.morale' }, 5] } },
        { target: 'story', path: 'donated', value: true }],
      inventory: { type: 'batchRemove', entries: [{ itemId: 'resource.food', quantity: 20 }] },
      checkpoint: { checkpointId: 'checkpoint.donate', sceneId: 'S09' }
    }}]
  }, { revision: 7 }));
}
function setup(checkpoint = vi.fn(async () => ({ ok: true }))) {
  const board = new Board({ storyState: { currentSceneId: 'S09', donated: false }, cityStates: [{ id: 'city.one', morale: 35 }] });
  const inventory = new Inventory([{ id: 'resource.food', quantity: 20 }]);
  const service = new CanonicalStateTransactionService({ definitionRepository: repository(), getBlackboard: () => board,
    getInventory: () => inventory, inventoryTransactions: new InventoryTransactionService(), getItem: id => ({ id, type: 'resource', maxStack: 99 }), checkpoint });
  const authority = new LocalAuthorityAdapter({ handlers: { 'state.transaction': service }, authoritySeed: 913 });
  return { board, inventory, checkpoint, gateway: new CommandGateway({ authorityPort: authority, definitionRepository: repository() }) };
}

describe('CanonicalStateTransactionService', () => {
  it('通过 Gateway/Authority 原子提交库存、City、Story、checkpoint 和有序通知', async () => {
    const runtime = setup();
    const result = await runtime.gateway.execute({ intentType: 'state.transaction', actorRef: 'player', operationId: 'op-donate', payload: { definitionId: 'story.donate' } });
    expect(result).toMatchObject({ ok: true, committed: true, stateId: 'canonical:state', stateRevision: 1 });
    expect(result.eventFrom).toBeGreaterThanOrEqual(1);
    expect(result.eventTo).toBeGreaterThanOrEqual(result.eventFrom);
    expect(runtime.inventory.getItemCount('resource.food')).toBe(0);
    expect(runtime.board.get('cityStates')[0].morale).toBe(40);
    expect(runtime.board.get('storyState').donated).toBe(true);
    // checkpoint 钩子现行契约：第二参数携带命令上下文
    expect(runtime.checkpoint).toHaveBeenCalledWith(
      { checkpointId: 'checkpoint.donate', sceneId: 'S09' },
      expect.objectContaining({ commandType: 'state.transaction', operationId: 'op-donate' })
    );
    const replay = await runtime.gateway.execute({ intentType: 'state.transaction', actorRef: 'player', operationId: 'op-donate', payload: { definitionId: 'story.donate' } });
    expect(replay).toEqual(result);
    expect(runtime.inventory.getItemCount('resource.food')).toBe(0);
  });

  it('checkpoint 失败时回滚库存、City 和 Story', async () => {
    const runtime = setup(vi.fn(async () => ({ ok: false, code: 'diskFailed' })));
    const result = await runtime.gateway.execute({ intentType: 'state.transaction', actorRef: 'player', operationId: 'op-fail', payload: { definitionId: 'story.donate' } });
    expect(result).toMatchObject({ ok: false, committed: false, code: 'diskFailed' });
    expect(runtime.inventory.getItemCount('resource.food')).toBe(20);
    expect(runtime.board.get('cityStates')[0].morale).toBe(35);
    expect(runtime.board.get('storyState').donated).toBe(false);
  });
});
