import { RNG } from '../core/RNG.js';

function stableSeed(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 单活动采集会话；库存、节点与工具只在结算点提交。 */
export class GatheringSystem {
  constructor({ inventoryTransactions, itemResolver = null, onEvent = null, rngFactory = null,
    riskResolver = null, effectResolver = null, settlementPolicy = null, stateCheckers = null } = {}) {
    if (!inventoryTransactions) throw new TypeError('GatheringSystem requires inventoryTransactions');
    this.inventoryTransactions = inventoryTransactions;
    this.itemResolver = typeof itemResolver === 'function' ? itemResolver : id => ({ id, name: id, type: 'material', maxStack: 99 });
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.rngFactory = typeof rngFactory === 'function' ? rngFactory : seed => new RNG(seed);
    this.riskResolver = typeof riskResolver === 'function' ? riskResolver : null;
    this.effectResolver = effectResolver || null;
    this.settlementPolicy = typeof settlementPolicy === 'function' ? settlementPolicy : null;
    // 状态准入校验：node.requiredState → (actor) => boolean（如 climbing：必须攀爬中才能采集）
    this.stateCheckers = stateCheckers && typeof stateCheckers === 'object' ? stateCheckers : {};
    this.nextOperationSequence = 1;
    this.completedOperations = new Map();
    this.session = null;
  }

  setEffectResolver(effectResolver) {
    this.effectResolver = effectResolver || null;
    return this;
  }

  setSettlementPolicy(settlementPolicy) {
    this.settlementPolicy = typeof settlementPolicy === 'function' ? settlementPolicy : null;
    return this;
  }

  isActive() { return this.session !== null; }
  isActiveFor(entity) { return !!entity && this.session?.actor === entity; }
  isOwnedBy(entity) { return !!entity && this.session?.owner === entity; }
  getActivePlayer() { return this.session?.owner || null; }
  getActiveActor() { return this.session?.actor || null; }

  serialize() {
    return {
      schemaVersion: 1,
      nextOperationSequence: this.nextOperationSequence,
      completedOperations: [...this.completedOperations.entries()].map(([operationId, result]) => ({
        operationId,
        result: JSON.parse(JSON.stringify(result))
      }))
    };
  }

  deserialize(data = {}) {
    this.session = null;
    const sequence = Math.floor(Number(data.nextOperationSequence));
    this.nextOperationSequence = Number.isInteger(sequence) && sequence > 0 ? sequence : 1;
    this.completedOperations = new Map((data.completedOperations || [])
      .filter(entry => typeof entry?.operationId === 'string' && entry.result?.ok === true)
      .slice(-256)
      .map(entry => [entry.operationId, JSON.parse(JSON.stringify(entry.result))]));
  }

  start({ player, owner = player, actor = player, nodeEntity, operationId = null, elapsed = 0 } = {}) {
    if (this.session) return { ok: false, code: 'gatheringBusy' };
    if (operationId && this.completedOperations.has(operationId)) {
      const result = { ...this.completedOperations.get(operationId), idempotent: true };
      this.onEvent(result.terminalEvent || 'completed', result);
      return result;
    }
    const node = nodeEntity?.getComponent?.('resourceNode');
    const inventory = owner?.getComponent?.('inventory');
    const actorTransform = actor?.getComponent?.('transform');
    const nodeTransform = nodeEntity?.getComponent?.('transform');
    if (!node || !inventory || !actorTransform || !nodeTransform) return { ok: false, code: 'invalidTarget' };
    if (node.depleted || node.remaining <= 0) return { ok: false, code: 'nodeDepleted' };
    const distance = Math.hypot(
      actorTransform.position.x - nodeTransform.position.x,
      actorTransform.position.y - nodeTransform.position.y
    );
    if (distance > node.interactionRadius) return { ok: false, code: 'outOfRange' };

    const tool = this._findTool(inventory, node.requiredToolType);
    if (node.requiredToolType && !tool) return { ok: false, code: 'toolRequired', toolType: node.requiredToolType };
    // 状态准入（如苹果丛 requiredState: "climbing"——必须攀爬中才能采摘）
    if (node.requiredState) {
      const checker = this.stateCheckers[node.requiredState];
      if (checker && checker(actor) !== true) {
        return { ok: false, code: 'stateRequired', requiredState: node.requiredState };
      }
    }
    const effectDuration = this.effectResolver
      ? this.effectResolver.getValue(owner.id, 'gather.duration', node.gatherDuration, {
        player: owner, owner, actor, nodeEntity, node, resourceType: node.resourceType
      })
      : node.gatherDuration;
    const normalizedEffectDuration = Math.max(0.1, Number(effectDuration) || node.gatherDuration);
    const toolGatherSpeed = Number(tool?.gatherSpeed) > 0 ? Number(tool.gatherSpeed) : 1;
    const playerSpeed = Number(owner.getComponent?.('stats')?.speed);
    const normalizedPlayerSpeed = playerSpeed > 0 ? playerSpeed : 100;
    const playerSpeedMultiplier = normalizedPlayerSpeed / 100;
    const resolvedDuration = Math.max(0.1, normalizedEffectDuration / toolGatherSpeed / playerSpeedMultiplier);
    this.session = {
      player: owner, owner, actor, nodeEntity, node, inventory, tool,
      effectDuration: normalizedEffectDuration, toolGatherSpeed, playerSpeed: normalizedPlayerSpeed, playerSpeedMultiplier,
      elapsed: Math.min(resolvedDuration, Math.max(0, Number(elapsed) || 0)),
      duration: resolvedDuration,
      startPosition: { x: actorTransform.position.x, y: actorTransform.position.y },
      operationId: operationId || `gather-${this.nextOperationSequence++}`
    };
    // 随机产量：节点配置 gatherYieldRange 时在 start 时按确定性 RNG（operationId 种子，
    // 重放一致）roll 本次产量，HUD 预期与结算使用同一值。
    this.session.yieldAmount = this._rollSessionYield(this.session);
    this.onEvent('started', this.describe());
    return { ok: true, session: this.describe() };
  }

  /** 本次采集产量：gatherYieldRange 区间内随机，否则回退固定 yieldPerGather。 */
  _rollSessionYield(session) {
    const range = session.node.gatherYieldRange;
    if (!range || range.max < range.min) return session.node.yieldPerGather;
    const rng = this.rngFactory(stableSeed(`${session.operationId}:yield`));
    const rolled = typeof rng?.int === 'function'
      ? rng.int(range.min, range.max)
      : range.min + Math.floor((typeof rng?.next === 'function' ? rng.next() : 0) * (range.max - range.min + 1));
    return Math.min(range.max, Math.max(range.min, Math.floor(rolled)));
  }

  update(deltaTime) {
    const session = this.session;
    if (!session) return null;
    const transform = session.actor.getComponent('transform');
    if (!transform || Math.hypot(
      transform.position.x - session.startPosition.x,
      transform.position.y - session.startPosition.y
    ) > 2) return this.interrupt('moved');

    session.elapsed = Math.min(session.duration, session.elapsed + Math.max(0, Number(deltaTime) || 0));
    this.onEvent('progress', this.describe());
    if (session.elapsed < session.duration) return null;
    return this._settle(1, 'completed', 'completed');
  }

  interrupt(reason = 'interrupted', { yieldRatio = 0, silent = false } = {}) {
    if (!this.session) return { ok: false, code: 'noActiveGathering' };
    return yieldRatio > 0
      ? this._settle(yieldRatio, reason, 'interrupted', !silent)
      : this._finish({ ok: false, code: reason, accepted: 0 }, 'interrupted', !silent);
  }

  interruptByDamage() {
    return this.interrupt('damaged', { yieldRatio: 0.5 });
  }

  describe() {
    if (!this.session) return null;
    const { owner, actor, nodeEntity, node, inventory, tool, elapsed, duration, operationId,
      effectDuration, toolGatherSpeed, playerSpeed, playerSpeedMultiplier } = this.session;
    const requestedYield = Math.min(node.remaining, this.session.yieldAmount ?? node.yieldPerGather);
    const item = this.itemResolver(node.itemId, node.resourceType);
    const capacity = this.inventoryTransactions.previewAdd(inventory, item, requestedYield).accepted;
    return {
      operationId,
      ownerId: owner?.id || null,
      actorId: actor?.id || null,
      nodeId: nodeEntity.id,
      resourceType: node.resourceType,
      itemId: node.itemId,
      elapsed,
      duration,
      progress: duration > 0 ? elapsed / duration : 1,
      effectDuration,
      toolGatherSpeed,
      playerSpeed,
      playerSpeedMultiplier,
      requestedYield,
      capacity,
      expectedYield: Math.min(requestedYield, capacity),
      toolDurability: tool ? Number(tool.durability) || 0 : null,
      toolMaxDurability: tool ? Number(tool.maxDurability) || Number(tool.durability) || 0 : null
    };
  }

  _settle(yieldRatio, reason, terminalEvent = 'completed', emitEvent = true) {
    const session = this.session;
    const completed = this.completedOperations.get(session.operationId);
    if (completed) {
      return this._finish(
        { ...completed, idempotent: true },
        completed.terminalEvent || terminalEvent,
        emitEvent
      );
    }
    const requested = Math.min(
      session.node.remaining,
      Math.floor((session.yieldAmount ?? session.node.yieldPerGather) * Math.max(0, yieldRatio))
    );
    if (requested <= 0) {
      return this._finish({ ok: false, code: reason, reason, accepted: 0 }, terminalEvent, emitEvent);
    }
    const item = this.itemResolver(session.node.itemId, session.node.resourceType);
    const policy = this._prepareSettlementPolicy(session, { requested, item, reason, terminalEvent });
    if (policy?.ok === false) {
      return this._finish({ ok: false, code: policy.code || 'policyRejected', reason, accepted: 0 }, 'interrupted', emitEvent);
    }
    if (policy?.idempotent === true) {
      return this._finish({
        ok: true, code: 'alreadySettled', reason, operationId: session.operationId,
        accepted: 0, remainder: requested, idempotent: true
      }, terminalEvent, emitEvent);
    }

    const settleOperationId = `${session.operationId}:settle`;
    const inventoryBefore = session.inventory.exportItems?.();
    const nodeBefore = { remaining: session.node.remaining, depleted: session.node.depleted };
    const toolDurabilityBefore = session.tool ? session.tool.durability : null;
    const result = this.inventoryTransactions.commit({
      type: 'add', inventory: session.inventory, item, quantity: requested, allowPartial: true,
      operationId: settleOperationId
    });
    if (!result.ok || result.accepted <= 0) {
      return this._finish({ ...result, code: result.code || 'inventoryFull', reason }, 'interrupted', emitEvent);
    }

    session.node.remaining -= result.accepted;
    session.node.depleted = session.node.remaining <= 0;
    // 采空打上 30 秒消失/刷新时间戳（墙钟）；尸体衰减由 corpseRuntime 全权负责，不在此打标。
    if (session.node.depleted && session.nodeEntity?.isCorpse !== true) session.node.beginDepletion?.();
    let toolBroken = false;
    if (session.tool) {
      session.tool.durability = Math.max(0, Number(session.tool.durability) - 1);
      toolBroken = session.tool.durability === 0;
    }

    try {
      const committed = policy?.commit?.({ accepted: result.accepted, remainder: result.remainder });
      if (committed === false || committed?.ok === false) throw new Error(committed?.code || 'policyCommitFailed');
    } catch (error) {
      try { policy?.rollback?.(); } catch (_) { /* policy rollback best effort */ }
      if (inventoryBefore && session.inventory.loadItems) session.inventory.loadItems(inventoryBefore);
      session.node.remaining = nodeBefore.remaining;
      session.node.depleted = nodeBefore.depleted;
      if (!session.node.depleted) session.node.revokeDepletion?.();
      if (session.tool) session.tool.durability = toolDurabilityBefore;
      this.inventoryTransactions.forgetOperation?.(settleOperationId);
      return this._finish({ ok: false, code: 'policyCommitFailed', reason, accepted: 0, error }, 'interrupted', emitEvent);
    }

    const risk = this._resolveRisk(session, terminalEvent);
    const success = {
      ok: true, committed: true, code: terminalEvent === 'completed' ? null : reason, reason, terminalEvent,
      operationId: session.operationId, accepted: result.accepted,
      itemName: item?.name || null,
      remainder: result.remainder, nodeRemaining: session.node.remaining,
      toolBroken, toolInstanceId: session.tool?.instanceId || null, risk
    };
    this._rememberCompletedOperation(session.operationId, success);
    return this._finish(success, terminalEvent, emitEvent);
  }

  _prepareSettlementPolicy(session, details) {
    if (!this.settlementPolicy) return null;
    try {
      return this.settlementPolicy({
        operationId: session.operationId,
        owner: session.owner,
        actor: session.actor,
        nodeEntity: session.nodeEntity,
        node: session.node,
        inventory: session.inventory,
        tool: session.tool,
        ...details
      }) || null;
    } catch (error) {
      return { ok: false, code: error?.code || 'policyPrepareFailed', error };
    }
  }

  _rememberCompletedOperation(operationId, result) {
    if (!operationId || !result?.ok) return;
    this.completedOperations.delete(operationId);
    this.completedOperations.set(operationId, JSON.parse(JSON.stringify(result)));
    while (this.completedOperations.size > 256) {
      this.completedOperations.delete(this.completedOperations.keys().next().value);
    }
  }

  _finish(result, terminalEvent = (result.ok ? 'completed' : 'interrupted'), emitEvent = true) {
    const details = this.describe();
    this.session = null;
    const payload = { ...details, ...result };
    if (emitEvent) this.onEvent(terminalEvent, payload);
    if (emitEvent && result.risk?.triggered) {
      this.onEvent('riskTriggered', { ...payload, ...result.risk, risk: result.risk });
    }
    return result;
  }

  _resolveRisk(session, terminalEvent) {
    if (terminalEvent !== 'completed') return null;
    const context = {
      operationId: session.operationId,
      nodeId: session.nodeEntity.id,
      resourceType: session.node.resourceType,
      risks: Array.isArray(session.node.riskEvents) ? session.node.riskEvents : []
    };
    if (this.riskResolver) {
      const resolved = this.riskResolver(context);
      return resolved?.triggered === true ? { ...resolved, nodeId: context.nodeId, operationId: context.operationId } : null;
    }
    for (const risk of context.risks) {
      const chance = Math.min(1, Math.max(0, Number(risk?.chance) || 0));
      if (!risk?.id || chance <= 0) continue;
      const rng = this.rngFactory(stableSeed(`${context.operationId}:${context.nodeId}:${risk.id}`));
      const triggered = typeof rng?.chance === 'function'
        ? rng.chance(chance)
        : (typeof rng?.next === 'function' && rng.next() < chance);
      if (!triggered) continue;
      return {
        triggered: true,
        id: risk.id,
        type: risk.type || 'generic',
        message: risk.message || '',
        payload: risk.payload && typeof risk.payload === 'object' ? { ...risk.payload } : {},
        nodeId: context.nodeId,
        operationId: context.operationId
      };
    }
    return null;
  }

  _findTool(inventory, requiredToolType) {
    if (!requiredToolType) return null;
    for (const stack of inventory.slots || []) {
      const item = stack?.item;
      if (!item || item.toolType !== requiredToolType) continue;
      if (Number(item.durability) > 0) return item;
    }
    return null;
  }
}

export default GatheringSystem;