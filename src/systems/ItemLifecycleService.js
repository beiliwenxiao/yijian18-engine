import { LootResolver } from './resolvers/LootResolver.js';
import { SceneEquipmentFlow } from '../core/scene/SceneEquipmentFlow.js';
import { normalizeCapabilities } from './items/CapabilityStrategyRegistry.js';

export const ITEM_LIFECYCLE_COMMANDS = Object.freeze({
  PICKUP: 'item.pickup',
  USE: 'item.use',
  DROP: 'item.drop',
  EQUIP: 'item.equip',
  UNEQUIP: 'item.unequip',
  TRANSFER: 'item.transfer',
  DEATH_DROP: 'item.deathDrop'
});

const clone = value => value == null ? value : (typeof structuredClone === 'function'
  ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
const quantityOf = value => Math.max(0, Math.floor(Number(value) || 0));
const mutableStateOf = item => {
  const mutable = {};
  for (const key of ['durability', 'binding', 'charges', 'container']) {
    if (item?.[key] !== undefined) mutable[key] = clone(item[key]);
  }
  return mutable;
};
const rejected = (command, code, error = null) => ({
  ok: false, operationId: command.operationId, status: 'rejected', committed: false,
  code, stateId: null, stateRevision: null, eventFrom: null, eventTo: null,
  value: null, error: error || { message: code }
});

function inventorySnapshot(inventory) {
  return clone(inventory?.exportItems?.() || []);
}

function restoreInventory(inventory, snapshot) {
  inventory?.loadItems?.(clone(snapshot || []));
}

function equipmentSnapshot(equipment) {
  return clone(equipment?.exportRuntimeState?.() || equipment?.exportEquipment?.() || {});
}

function restoreEquipment(equipment, snapshot) {
  if (!equipment?.slots) return;
  for (const slot of Object.keys(equipment.slots)) equipment.slots[slot] = null;
  equipment.loadEquipment?.(clone(snapshot || {}));
  equipment.recalculateBonusStats?.();
}

function actorSnapshot(actor) {
  const stats = actor?.getComponent?.('stats');
  const transform = actor?.getComponent?.('transform');
  return {
    stats: stats ? clone(Object.fromEntries(Object.entries(stats).filter(([, value]) => (
      value == null || ['string', 'number', 'boolean'].includes(typeof value)
      || Array.isArray(value) || value?.constructor === Object
    )))) : null,
    transform: transform ? {
      position: clone(transform.position), rotation: transform.rotation, scale: clone(transform.scale), floorId: transform.floorId
    } : null
  };
}

function restoreActor(actor, snapshot) {
  const stats = actor?.getComponent?.('stats');
  const transform = actor?.getComponent?.('transform');
  if (stats && snapshot?.stats) Object.assign(stats, clone(snapshot.stats));
  if (transform && snapshot?.transform) {
    Object.assign(transform.position, clone(snapshot.transform.position));
    transform.rotation = snapshot.transform.rotation;
    if (snapshot.transform.scale) Object.assign(transform.scale, clone(snapshot.transform.scale));
    transform.floorId = snapshot.transform.floorId;
  }
}

/** pickup/use/drop/equip/unequip/transfer/death-drop 的唯一普通 command handler。 */
export class ItemLifecycleService {
  constructor(config = {}) {
    if (!config.inventoryTransactions) throw new TypeError('ItemLifecycleService requires inventoryTransactions');
    if (!config.equipmentSystem) throw new TypeError('ItemLifecycleService requires EquipmentSystem');
    this.inventoryTransactions = config.inventoryTransactions;
    this.equipmentSystem = config.equipmentSystem;
    this.effectResolver = config.effectResolver || null;
    this.lootResolver = config.lootResolver || LootResolver;
    this.resolveActor = config.resolveActor || (() => null);
    this.resolveInventory = config.resolveInventory || (() => null);
    this.resolveWorldItem = config.resolveWorldItem || (() => null);
    this.resolveDefinition = config.resolveDefinition || (() => null);
    this.createGroundDrop = config.createGroundDrop || (() => null);
    this.addWorldEntity = config.addWorldEntity || (() => false);
    this.removeWorldEntity = config.removeWorldEntity || (() => false);
    this.createCheckpoint = config.createCheckpoint || (async () => ({ ok: true, skipped: true }));
    this.playerDefeatService = config.playerDefeatService || null;
    this.canUseItem = typeof config.canUseItem === 'function' ? config.canUseItem : () => true;
    this.onEquipmentChanged = config.onEquipmentChanged || (() => {});
    this.onItemUsed = config.onItemUsed || (() => {});
    this.onItemGained = config.onItemGained || (() => {});
    this.stateType = 'itemLifecycle';
    this.stateId = command => `item-lifecycle:${command.actorId}`;
  }

  async execute(command, context) {
    const actor = this.resolveActor(command.actorId, command);
    if (!actor) return rejected(command, 'actorMissing');
    let prepared;
    try { prepared = this._prepare(command, actor, context); }
    catch (error) { return rejected(command, error.code || 'validationFailed', { message: error.message }); }
    if (!prepared?.ok) return rejected(command, prepared?.code || 'validationFailed', prepared?.error);

    let committed;
    try { committed = await prepared.commit(); }
    catch (error) { committed = { ok: false, code: 'commitFailed', error }; }
    if (!committed?.ok) {
      await prepared.rollback?.();
      this._forget(prepared.transactionIds);
      return rejected(command, committed?.code || 'commitFailed', {
        message: committed?.error?.message || committed?.message || committed?.code || 'commitFailed'
      });
    }

    const checkpoint = await this._checkpoint(command, committed.value);
    if (!checkpoint.ok) {
      await prepared.rollback?.();
      this._forget(prepared.transactionIds);
      return rejected(command, checkpoint.code, { message: checkpoint.message || checkpoint.code });
    }

    const revision = context.commitStateRevision(context.preparedStateRevision);
    if (!revision.ok) {
      await prepared.rollback?.();
      this._forget(prepared.transactionIds);
      return rejected(command, revision.code);
    }

    // 装备反馈可能同步触发内容逻辑；只能在 authority 校验、事件发布和账本封账后执行。
    const postCommit = typeof committed.finalize === 'function'
      ? () => committed.finalize()
      : null;

    const stateId = context.preparedStateRevision.stateId;
    const value = { ...clone(committed.value), projection: this._project(actor) };
    const result = {
      ok: true, operationId: command.operationId, status: 'committed', committed: true,
      code: null, stateId, stateRevision: revision.stateRevision,
      eventFrom: null, eventTo: null, value, error: null
    };
    const eventBase = { stateId, stateType: this.stateType, stateRevision: revision.stateRevision };
    return {
      result,
      committedEvents: [{ ...eventBase, type: `${command.commandType}.committed`, payload: value }],
      applicationEvents: (committed.applicationEvents || []).map(event => ({ ...eventBase, ...event })),
      postCommit
    };
  }

  _prepare(command, actor, context) {
    const inventory = actor.getComponent?.('inventory');
    const handlers = {
      [ITEM_LIFECYCLE_COMMANDS.PICKUP]: () => this._preparePickup(command, actor, inventory),
      [ITEM_LIFECYCLE_COMMANDS.USE]: () => this._prepareUse(command, actor, inventory),
      [ITEM_LIFECYCLE_COMMANDS.DROP]: () => this._prepareDrop(command, actor, inventory),
      [ITEM_LIFECYCLE_COMMANDS.EQUIP]: () => this._prepareEquip(command, actor, inventory),
      [ITEM_LIFECYCLE_COMMANDS.UNEQUIP]: () => this._prepareUnequip(command, actor, inventory),
      [ITEM_LIFECYCLE_COMMANDS.TRANSFER]: () => this._prepareTransfer(command, actor),
      [ITEM_LIFECYCLE_COMMANDS.DEATH_DROP]: () => this._prepareDeathDrop(command, actor, context)
    };
    return handlers[command.commandType]?.() || { ok: false, code: 'unsupportedItemCommand' };
  }

  _definition(definitionId) {
    return definitionId ? this.resolveDefinition(definitionId) : null;
  }

  _hasCapability(definition, capabilityId, legacyPredicate = false) {
    const capabilities = normalizeCapabilities(definition);
    return capabilities.length ? capabilities.some(value => (value?.id || value?.capabilityId) === capabilityId) : legacyPredicate;
  }

  _itemFromInventory(inventory, itemId, instanceId = null) {
    const stack = (inventory?.slots || []).find(value => value?.item?.id === itemId
      && (!instanceId || value.item.instanceId === instanceId));
    return stack ? { stack, item: stack.item } : null;
  }

  _preparePickup(command, actor, inventory) {
    const worldItem = this.resolveWorldItem(command.payload.groundId, command);
    if (!inventory || !worldItem) return { ok: false, code: inventory ? 'groundItemMissing' : 'missingInventory' };
    const deathDrop = worldItem.getComponent?.('deathDrop');
    const projection = worldItem.getComponent?.('itemProjection');
    const beforeInventory = inventorySnapshot(inventory);
    const beforeWorld = deathDrop?.serialize?.() || clone({
      quantity: worldItem.quantity,
      picked: worldItem.picked,
      projection: projection?.serialize?.() || null
    });
    const transactionIds = [];

    if (deathDrop) {
      const entries = deathDrop.stacks.map(stack => ({ item: stack.item, quantity: stack.quantity })).filter(entry => entry.item);
      if (!entries.length) return { ok: false, code: 'emptyDeathDrop' };
      const preview = this.inventoryTransactions.previewBatchAdd(inventory, entries);
      if (preview.accepted <= 0) return { ok: false, code: preview.reason || 'inventoryFull' };
      return {
        ok: true, transactionIds,
        commit: () => {
          const transactionId = `${command.operationId}:inventory`;
          transactionIds.push(transactionId);
          const result = this.inventoryTransactions.commit({
            type: 'batchAdd', inventory, entries, allowPartial: true, operationId: transactionId
          });
          if (!result.ok) return result;
          const picked = [];
          result.entries.forEach(entry => {
            const stack = deathDrop.stacks.find(value => value.definitionId === (entry.item.definitionId || entry.item.id)
              && (!entry.item.instanceId || value.instanceId === entry.item.instanceId));
            if (stack) {
              deathDrop.take(stack.id, entry.accepted);
              picked.push({
                definitionId: stack.definitionId,
                item: clone(entry.item),
                quantity: entry.accepted
              });
            }
          });
          worldItem.picked = deathDrop.isEmpty();
          return {
            ok: true,
            value: { action: 'pickup', groundId: command.payload.groundId, accepted: result.accepted,
              remainder: deathDrop.stacks.reduce((sum, stack) => sum + stack.quantity, 0), picked },
            applicationEvents: this._createPickupEvents({
              worldItem,
              picked,
              complete: worldItem.picked,
              groundId: command.payload.groundId
            }),
            finalize: () => this._finalizePickup({
              worldItem,
              actor,
              picked,
              complete: worldItem.picked,
              operationId: command.operationId,
              groundId: command.payload.groundId
            })
          };
        },
        rollback: () => {
          restoreInventory(inventory, beforeInventory);
          deathDrop.deserialize(beforeWorld);
          worldItem.picked = false;
        }
      };
    }

    const definitionId = projection?.definitionId || worldItem.definitionId || worldItem.itemId || worldItem.itemData?.id || worldItem.id;
    const definition = this._definition(definitionId);
    if (!definition) return { ok: false, code: 'itemDefinitionMissing' };
    const requested = Math.min(quantityOf(command.payload.quantity) || Infinity,
      quantityOf(projection?.quantity ?? worldItem.quantity) || 1);
    const rawInstanceId = projection?.instanceId ?? worldItem.instanceId ?? null;
    if (rawInstanceId !== null && (typeof rawInstanceId !== 'string' || !rawInstanceId.trim())) {
      return { ok: false, code: 'invalidInstanceId' };
    }
    const instanceId = typeof rawInstanceId === 'string' ? rawInstanceId.trim() : null;
    if (instanceId && requested !== 1) return { ok: false, code: 'invalidInstanceQuantity' };
    if (instanceId && (inventory.slots || []).some(stack => stack?.item?.instanceId === instanceId)) {
      return { ok: false, code: 'duplicateInstanceId' };
    }
    const runtimeItem = {
      ...definition,
      definitionId,
      ...(worldItem.imageId !== undefined ? { imageId: worldItem.imageId } : {}),
      ...(worldItem.assetId !== undefined ? { assetId: worldItem.assetId } : {}),
      ...(worldItem.sprite !== undefined ? { sprite: clone(worldItem.sprite) } : {}),
      ...mutableStateOf(definition),
      ...mutableStateOf(worldItem),
      ...mutableStateOf(projection?.mutable),
      ...(instanceId ? { instanceId } : {})
    };
    const preview = this.inventoryTransactions.previewAdd(inventory, runtimeItem, requested);
    if (preview.accepted <= 0) return { ok: false, code: preview.reason || 'inventoryFull' };
    return {
      ok: true, transactionIds,
      commit: () => {
        const transactionId = `${command.operationId}:inventory`;
        transactionIds.push(transactionId);
        const result = this.inventoryTransactions.commit({
          type: 'add', inventory, item: runtimeItem, quantity: requested,
          allowPartial: true, operationId: transactionId
        });
        if (!result.ok) return result;
        const remainder = requested - result.accepted;
        if (projection) {
          projection.quantity -= result.accepted;
          projection.pickupState = projection.quantity <= 0 ? 'picked' : 'available';
        }
        worldItem.quantity = Math.max(0, quantityOf(worldItem.quantity || requested) - result.accepted);
        worldItem.picked = (projection ? projection.quantity : worldItem.quantity) <= 0;
        const picked = [{ definitionId, item: clone(runtimeItem), quantity: result.accepted }];
        return {
          ok: true,
          value: { action: 'pickup', groundId: command.payload.groundId,
            accepted: result.accepted, remainder, picked },
          applicationEvents: this._createPickupEvents({
            worldItem,
            picked,
            complete: worldItem.picked,
            groundId: command.payload.groundId
          }),
          finalize: () => this._finalizePickup({
            worldItem,
            actor,
            picked,
            complete: worldItem.picked,
            operationId: command.operationId,
            groundId: command.payload.groundId
          })
        };
      },
      rollback: () => {
        restoreInventory(inventory, beforeInventory);
        if (projection && beforeWorld.projection) {
          projection.quantity = beforeWorld.projection.runtimeState?.quantity || 1;
          projection.pickupState = beforeWorld.projection.pickupState || 'available';
        }
        worldItem.quantity = beforeWorld.quantity;
        worldItem.picked = beforeWorld.picked;
      }
    };
  }

  _createPickupEvents({ worldItem, picked, complete, groundId }) {
    const placementId = worldItem?.placementId || null;
    const entityId = worldItem?.entityId || worldItem?.id || null;
    const position = worldItem?.getComponent?.('transform')?.position || worldItem;
    const worldPosition = Number.isFinite(position?.x) && Number.isFinite(position?.y)
      ? { x: position.x, y: position.y }
      : null;
    return (picked || []).map(entry => {
      const runtimeItem = entry.item || {};
      const definitionId = entry.definitionId || runtimeItem.definitionId || runtimeItem.id;
      return {
        type: 'item.picked',
        payload: {
          groundId,
          placementId,
          entityId,
          complete: complete === true,
          definitionId,
          itemId: runtimeItem.id || definitionId,
          instanceId: runtimeItem.instanceId || null,
          name: runtimeItem.name || definitionId,
          imageId: runtimeItem.imageId || runtimeItem.assetId || null,
          quantity: entry.quantity,
          position: worldPosition,
          worldPosition,
          tutorialSignal: 'itemPicked',
          item: {
            id: runtimeItem.id || definitionId,
            definitionId,
            instanceId: runtimeItem.instanceId || null,
            name: runtimeItem.name || definitionId,
            type: runtimeItem.type || null,
            subType: runtimeItem.subType || null,
            imageId: runtimeItem.imageId || null,
            assetId: runtimeItem.assetId || null,
            quantity: entry.quantity,
            ...mutableStateOf(runtimeItem)
          }
        }
      };
    });
  }

  _finalizePickup({ worldItem, actor, picked, complete, operationId, groundId }) {
    const placementId = worldItem?.placementId || null;
    const entityId = worldItem?.entityId || worldItem?.id || null;
    if (complete) this.removeWorldEntity(worldItem);
    for (let index = 0; index < picked.length; index++) {
      const entry = picked[index];
      const definition = this._definition(entry.definitionId) || {};
      const runtimeItem = entry.item ? clone(entry.item) : {};
      const definitionId = entry.definitionId || runtimeItem.definitionId || runtimeItem.id;
      const item = {
        ...definition,
        ...runtimeItem,
        definitionId,
        quantity: entry.quantity,
        pickupCommitted: true,
        operationId,
        pickupEventId: `${operationId}:${definitionId}:${index}`,
        groundId,
        placementId,
        entityId,
        picked: complete === true
      };
      try { this.onItemGained(item, actor); } catch (error) { console.warn('Item gained presentation failed', error); }
    }
  }

  _prepareUse(command, actor, inventory) {
    const permission = this.canUseItem(actor, command);
    if (permission === false || permission?.ok === false) {
      return {
        ok: false,
        code: permission?.code || 'itemUseBlocked',
        error: permission?.message ? { message: permission.message } : undefined
      };
    }
    const found = this._itemFromInventory(inventory, command.payload.itemId, command.payload.instanceId);
    if (!found) return { ok: false, code: 'itemMissing' };
    const definition = this._definition(found.item.definitionId || found.item.id) || found.item;
    if (!this._hasCapability(definition, 'consumable', found.item.usable === true)) return { ok: false, code: 'itemNotConsumable' };
    const stats = actor.getComponent?.('stats');
    if (!stats) return { ok: false, code: 'statsMissing' };
    const beforeInventory = inventorySnapshot(inventory);
    const beforeActor = actorSnapshot(actor);
    const transactionIds = [];
    return {
      ok: true, transactionIds,
      commit: () => {
        const effect = definition.effect || found.item.effect || {};
        const baseAmount = Number(effect.value) || 0;
        const amount = this.effectResolver?.getValue?.(actor.id, `item.${definition.id}.effect.${effect.type}`, baseAmount,
          { actor, item: definition }) ?? baseAmount;
        let heal = 0;
        let mana = 0;
        if (effect.type === 'heal') {
          const old = stats.hp;
          stats.hp = Math.min(stats.maxHp, stats.hp + amount);
          heal = stats.hp - old;
        } else if (effect.type === 'restore_mana') {
          const old = stats.mp;
          stats.mp = Math.min(stats.maxMp, stats.mp + amount);
          mana = stats.mp - old;
        }
        const transactionId = `${command.operationId}:inventory`;
        transactionIds.push(transactionId);
        const removed = this.inventoryTransactions.commit({ type: 'remove', inventory,
          itemId: found.item.id, quantity: 1, allowPartial: false, operationId: transactionId });
        if (!removed.ok) return removed;
        return { ok: true, value: { action: 'use', itemId: definition.id, quantity: 1, heal, mana },
          finalize: () => this.onItemUsed({ item: definition, actor, heal, mana }) };
      },
      rollback: () => { restoreInventory(inventory, beforeInventory); restoreActor(actor, beforeActor); }
    };
  }

  _prepareDrop(command, actor, inventory) {
    const found = this._itemFromInventory(inventory, command.payload.itemId, command.payload.instanceId);
    if (!found) return { ok: false, code: 'itemMissing' };
    const definitionId = found.item.definitionId || found.item.id;
    const definition = this._definition(definitionId) || found.item;
    if (this._hasCapability(definition, 'questBound', found.item.questBound === true)) {
      return { ok: false, code: 'itemQuestBound' };
    }
    const requested = Math.min(quantityOf(command.payload.quantity) || 1, found.stack.quantity);
    const position = command.payload.position || actor.getComponent?.('transform')?.position;
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
      return { ok: false, code: 'dropPositionMissing' };
    }
    const runtimeState = found.item.instanceId
      ? { definitionId, instanceId: found.item.instanceId, mutable: mutableStateOf(found.item) }
      : { definitionId, quantity: requested };
    const draft = this.createGroundDrop({
      entityId: command.payload.groundId || `ground-drop-${command.operationId}`,
      runtimeState,
      transform: { x: position.x, y: position.y },
      pickupState: 'available'
    });
    if (!draft) return { ok: false, code: 'dropCreationFailed' };
    const beforeInventory = inventorySnapshot(inventory);
    const transactionIds = [];
    let added = false;
    return {
      ok: true,
      transactionIds,
      commit: () => {
        const transactionId = `${command.operationId}:inventory`;
        transactionIds.push(transactionId);
        const removed = this.inventoryTransactions.commit({
          type: 'remove', inventory, itemId: found.item.id, quantity: requested,
          allowPartial: false, operationId: transactionId
        });
        if (!removed.ok) return removed;
        added = this.addWorldEntity(draft) !== false;
        if (!added) return { ok: false, code: 'worldCommitFailed' };
        return {
          ok: true,
          value: {
            action: 'drop', groundId: draft.id, definitionId,
            instanceId: found.item.instanceId || null, quantity: requested,
            position: { x: position.x, y: position.y }
          },
          applicationEvents: [{
            type: 'item.dropped',
            payload: {
              groundId: draft.id,
              entityId: draft.id,
              definitionId,
              itemId: found.item.id || definitionId,
              instanceId: found.item.instanceId || null,
              name: found.item.name || definition.name || definitionId,
              quantity: requested,
              position: { x: position.x, y: position.y },
              reason: command.payload.reason || 'manualDrop'
            }
          }]
        };
      },
      rollback: () => {
        if (added) this.removeWorldEntity(draft);
        restoreInventory(inventory, beforeInventory);
      }
    };
  }

  _prepareEquip(command, actor, inventory) {
    const found = this._itemFromInventory(inventory, command.payload.itemId, command.payload.instanceId);
    if (!found) return { ok: false, code: 'itemMissing' };
    const definition = this._definition(found.item.definitionId || found.item.id) || found.item;
    if (!this._hasCapability(definition, 'equippable', found.item.type === 'equipment')) {
      return { ok: false, code: 'itemNotEquippable' };
    }
    const equipment = actor.getComponent?.('equipment');
    if (!equipment) return { ok: false, code: 'equipmentMissing' };
    const item = found.item.instanceId ? found.item : { ...found.item };
    const slot = command.payload.slot || SceneEquipmentFlow.resolveSlot(item);
    if (!slot || !equipment.isValidEquipmentForSlot?.(item, slot)) {
      return { ok: false, code: 'invalidEquipmentSlot' };
    }
    const equipQuantity = item.subType === 'ammo' ? found.stack.quantity : 1;
    if (item.subType === 'ammo') item.quantity = equipQuantity;
    const oldItem = equipment.getEquipment?.(slot) || null;
    const autoAmmo = slot === 'mainhand' && !item.ranged
      ? equipment.getEquipment?.('offhand') : null;
    const autoUnequipAmmo = autoAmmo?.subType === 'ammo' ? autoAmmo : null;
    const beforeInventory = inventorySnapshot(inventory);
    const beforeEquipment = equipmentSnapshot(equipment);
    const beforeActor = actorSnapshot(actor);
    const transactionIds = [];
    const oldStats = SceneEquipmentFlow._snapshotStats(actor.getComponent?.('stats'));
    const addBack = (value, suffix) => {
      if (!value) return { ok: true };
      const transactionId = `${command.operationId}:${suffix}`;
      transactionIds.push(transactionId);
      return this.inventoryTransactions.commit({
        type: 'add', inventory, item: value, quantity: value.quantity || 1,
        allowPartial: false, operationId: transactionId
      });
    };
    return {
      ok: true,
      transactionIds,
      commit: () => {
        const removeId = `${command.operationId}:remove`;
        transactionIds.push(removeId);
        const removed = this.inventoryTransactions.commit({
          type: 'remove', inventory, itemId: found.item.id, quantity: equipQuantity,
          allowPartial: false, operationId: removeId
        });
        if (!removed.ok) return removed;
        const replaced = this.equipmentSystem.equipItem(actor, slot, item);
        if (equipment.getEquipment?.(slot) !== item) return { ok: false, code: 'equipFailed' };
        const oldResult = addBack(replaced, 'old-item');
        if (!oldResult.ok) return { ...oldResult, code: oldResult.code || 'inventoryFull' };
        let removedAmmo = null;
        if (autoUnequipAmmo) {
          removedAmmo = this.equipmentSystem.unequipItem(actor, 'offhand');
          if (!removedAmmo) return { ok: false, code: 'ammoUnequipFailed' };
          const ammoResult = addBack(removedAmmo, 'auto-ammo');
          if (!ammoResult.ok) return { ...ammoResult, code: ammoResult.code || 'inventoryFull' };
        }
        const changeText = SceneEquipmentFlow.statChangeText(oldStats, actor.getComponent?.('stats'));
        const messages = [`装备了 ${item.name || definition.name || definition.id}`];
        if (replaced) messages.push(`卸下了 ${replaced.name || replaced.id}`);
        if (removedAmmo) messages.push(`卸下了 ${removedAmmo.name || removedAmmo.id}`);
        if (changeText) messages.push(changeText);
        const info = { slot, item, oldItem: replaced || null, action: 'equip' };
        return {
          ok: true,
          value: { action: 'equip', slot, itemId: definition.id || item.id, oldItemId: replaced?.id || null },
          applicationEvents: [{ type: 'item.equipped', payload: { messages, info } }],
          finalize: () => this.onEquipmentChanged(messages, info)
        };
      },
      rollback: () => {
        restoreInventory(inventory, beforeInventory);
        restoreEquipment(equipment, beforeEquipment);
        restoreActor(actor, beforeActor);
      }
    };
  }

  _prepareUnequip(command, actor, inventory) {
    const equipment = actor.getComponent?.('equipment');
    if (!inventory || !equipment) return { ok: false, code: inventory ? 'equipmentMissing' : 'missingInventory' };
    const slot = command.payload.slot;
    const item = slot ? equipment.getEquipment?.(slot) : null;
    if (!item) return { ok: false, code: 'equipmentSlotEmpty' };
    const quantity = item.quantity || 1;
    const preview = this.inventoryTransactions.previewAdd(inventory, item, quantity);
    if (preview.accepted !== quantity) return { ok: false, code: preview.reason || 'inventoryFull' };
    const beforeInventory = inventorySnapshot(inventory);
    const beforeEquipment = equipmentSnapshot(equipment);
    const beforeActor = actorSnapshot(actor);
    const oldStats = SceneEquipmentFlow._snapshotStats(actor.getComponent?.('stats'));
    const transactionIds = [];
    return {
      ok: true,
      transactionIds,
      commit: () => {
        const removed = this.equipmentSystem.unequipItem(actor, slot);
        if (!removed) return { ok: false, code: 'unequipFailed' };
        const transactionId = `${command.operationId}:inventory`;
        transactionIds.push(transactionId);
        const added = this.inventoryTransactions.commit({
          type: 'add', inventory, item: removed, quantity,
          allowPartial: false, operationId: transactionId
        });
        if (!added.ok) return { ...added, code: added.code || 'inventoryFull' };
        const changeText = SceneEquipmentFlow.statChangeText(oldStats, actor.getComponent?.('stats'));
        const messages = [`卸下了 ${removed.name || removed.id}`];
        if (changeText) messages.push(changeText);
        const info = { slot, item: null, oldItem: removed, action: 'unequip' };
        return {
          ok: true,
          value: { action: 'unequip', slot, itemId: removed.definitionId || removed.id },
          applicationEvents: [{ type: 'item.unequipped', payload: { messages, info } }],
          finalize: () => this.onEquipmentChanged(messages, info)
        };
      },
      rollback: () => {
        restoreInventory(inventory, beforeInventory);
        restoreEquipment(equipment, beforeEquipment);
        restoreActor(actor, beforeActor);
      }
    };
  }

  _prepareTransfer(command) {
    const source = this.resolveInventory(command.payload.sourceId, command);
    const target = this.resolveInventory(command.payload.targetId, command);
    if (!source || !target || source === target) return { ok: false, code: 'invalidTransfer' };
    const found = this._itemFromInventory(source, command.payload.itemId, command.payload.instanceId);
    if (!found) return { ok: false, code: 'itemMissing' };
    let requested = quantityOf(command.payload.quantity) || 1;
    if (typeof target.getAvailableCapacity === 'function') {
      requested = Math.min(requested, target.getAvailableCapacity());
    }
    if (requested <= 0) return { ok: false, code: 'cargoCapacityFull' };
    const preview = this.inventoryTransactions.previewTransfer(source, target, found.item, requested);
    if (preview.accepted <= 0) return { ok: false, code: preview.reason || 'transferRejected' };
    const beforeSource = inventorySnapshot(source);
    const beforeTarget = inventorySnapshot(target);
    const transactionIds = [];
    return {
      ok: true,
      transactionIds,
      commit: () => {
        const transactionId = `${command.operationId}:inventory`;
        transactionIds.push(transactionId);
        const result = this.inventoryTransactions.commit({
          type: 'transfer', source, target, item: found.item, quantity: requested,
          allowPartial: true, operationId: transactionId
        });
        if (!result.ok) return result;
        return {
          ok: true,
          value: {
            action: 'transfer', sourceId: command.payload.sourceId, targetId: command.payload.targetId,
            itemId: found.item.definitionId || found.item.id,
            accepted: result.accepted, remainder: result.remainder
          }
        };
      },
      rollback: () => {
        restoreInventory(source, beforeSource);
        restoreInventory(target, beforeTarget);
      }
    };
  }

  _prepareDeathDrop(command, actor, context) {
    if (!this.playerDefeatService) return { ok: false, code: 'defeatServiceMissing' };
    const inventory = actor.getComponent?.('inventory');
    const beforeInventory = inventorySnapshot(inventory);
    const beforeActor = actorSnapshot(actor);
    const beforeResolved = new Set(this.playerDefeatService.resolvedDeathIds || []);
    const beforeSequence = this.playerDefeatService.nextDeathSequence;
    const deathId = command.payload.deathId || `player-death-${beforeSequence}`;
    const resolution = command.payload.resolution || { type: 'normalDeath' };
    const loot = this.lootResolver?.roll?.(command.payload.lootTable || [], { rng: context.rng }) || [];
    const transactionIds = [`death:${deathId}:remove`];
    let result = null;
    return {
      ok: true,
      transactionIds,
      commit: () => {
        result = this.playerDefeatService.resolve({
          player: actor, deathId, resolution, deferFinalize: true,
          deferRespawn: command.payload.deferRespawn === true
        });
        if (!result?.ok) return result || { ok: false, code: 'defeatCommitFailed' };
        const dropPosition = result.drop?.getComponent?.('transform')?.position
          || result.drop?.position
          || null;
        return {
          ok: true,
          value: {
            action: 'deathDrop', type: result.type, deathId: result.deathId,
            dropId: result.drop?.id || null, stacks: clone(result.stacks || []), loot,
            respawnPosition: clone(result.respawnPosition || null)
          },
          applicationEvents: [{
            type: result.type === 'specialFaint' ? 'item.specialFaintResolved' : 'item.deathDropCreated',
            payload: {
              deathId: result.deathId,
              dropId: result.drop?.id || null,
              entityId: result.drop?.id || null,
              name: '遗失物资',
              loot,
              stacks: clone(result.stacks || []),
              position: dropPosition ? { x: dropPosition.x, y: dropPosition.y } : null,
              reason: result.type === 'specialFaint' ? 'specialFaint' : 'deathDrop',
              announce: result.type !== 'specialFaint'
            }
          }],
          finalize: () => result.finalize?.()
        };
      },
      rollback: () => {
        if (result?.drop) this.removeWorldEntity(result.drop);
        restoreInventory(inventory, beforeInventory);
        restoreActor(actor, beforeActor);
        this.playerDefeatService.resolvedDeathIds = new Set(beforeResolved);
        this.playerDefeatService.nextDeathSequence = beforeSequence;
      }
    };
  }

  async _checkpoint(command, value) {
    const checkpointId = command.payload?.checkpointId;
    if (!checkpointId) return { ok: true, skipped: true };
    try {
      const result = await this.createCheckpoint({
        checkpointId, command, value, operationId: command.operationId
      });
      if (result === false || result?.ok === false) {
        return { ok: false, code: result?.code || 'checkpointFailed', message: result?.message };
      }
      return { ok: true, result };
    } catch (error) {
      return { ok: false, code: 'checkpointFailed', message: error?.message || String(error) };
    }
  }

  _forget(transactionIds = []) {
    for (const operationId of transactionIds) this.inventoryTransactions.forgetOperation?.(operationId);
  }

  _project(actor) {
    const inventory = actor?.getComponent?.('inventory');
    const equipment = actor?.getComponent?.('equipment');
    const stats = actor?.getComponent?.('stats');
    const projectedStats = {};
    for (const key of ['level', 'hp', 'maxHp', 'mp', 'maxMp', 'attack', 'defense', 'speed', 'gold']) {
      if (stats?.[key] !== undefined) projectedStats[key] = stats[key];
    }
    return {
      actorId: actor?.id || null,
      inventory: {
        maxSlots: inventory?.maxSlots || 0,
        slots: (inventory?.slots || []).map(stack => stack
          ? { item: clone(stack.item), quantity: stack.quantity }
          : null)
      },
      equipment: clone(equipment?.getAllEquipment?.() || equipment?.slots || {}),
      stats: projectedStats
    };
  }

  seedProjection(actor) {
    return this._project(actor);
  }
}

export default ItemLifecycleService;
