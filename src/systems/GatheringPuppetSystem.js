/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

/**
 * 采集傀儡领域状态机。产物结算委托 GatheringSystem，避免复制库存/节点事务。
 */
export class GatheringPuppetSystem {
  constructor({ gatheringSystem, createPuppet, addEntity, removeEntity,
    damageOwner, onEvent = null } = {}) {
    if (!gatheringSystem) throw new TypeError('GatheringPuppetSystem requires gatheringSystem');
    this.gatheringSystem = gatheringSystem;
    this.createPuppet = typeof createPuppet === 'function' ? createPuppet : null;
    this.addEntity = typeof addEntity === 'function' ? addEntity : () => {};
    this.removeEntity = typeof removeEntity === 'function' ? removeEntity : () => {};
    this.damageOwner = typeof damageOwner === 'function' ? damageOwner : () => {};
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.effectResolver = null;
    this.owner = null;
    this.chargesRemaining = null;
    this.nextSequence = 1;
    this.active = null;
  }

  configure({ effectResolver = null, owner = null } = {}) {
    this.effectResolver = effectResolver || null;
    this.owner = owner || null;
    return this;
  }

  initializeCharges() {
    if (this.chargesRemaining !== null) return this.chargesRemaining;
    const maximum = this._maximumCharges();
    if (maximum > 0) this.chargesRemaining = maximum;
    return this.chargesRemaining ?? 0;
  }

  _maximumCharges() {
    if (!this.owner?.id || !this.effectResolver) return 0;
    const value = this.effectResolver.getRuleValue(
      this.owner.id, 'gather.puppetCharges', 0, { owner: this.owner }
    );
    return Math.max(0, Math.floor(Number(value) || 0));
  }

  canSummon(nodeEntity, { requireCharge = true } = {}) {
    if (!this.owner || !this.effectResolver) return { ok: false, code: 'puppetUnavailable' };
    if (!this.effectResolver.getUnlockedSkills(this.owner.id).includes('gathering_puppet')) {
      return { ok: false, code: 'puppetLocked' };
    }
    if (this.active || this.gatheringSystem.isActive()) return { ok: false, code: 'gatheringBusy' };
    if (requireCharge && this.initializeCharges() <= 0) return { ok: false, code: 'noPuppetCharges' };
    const node = nodeEntity?.getComponent?.('resourceNode');
    const transform = nodeEntity?.getComponent?.('transform');
    if (!node || !transform || node.depleted || node.remaining <= 0) {
      return { ok: false, code: 'invalidTarget' };
    }
    return { ok: true, node, transform };
  }

  summon({ nodeEntity, operationId = null, elapsed = 0, puppetId = null,
    duration = 20, backlashDamage = 15, consumeCharge = true } = {}) {
    const check = this.canSummon(nodeEntity, { requireCharge: consumeCharge });
    if (!check.ok) return check;
    if (!this.createPuppet) return { ok: false, code: 'puppetFactoryUnavailable' };

    const id = puppetId || `gathering-puppet-${this.nextSequence++}`;
    const position = { x: check.transform.position.x, y: check.transform.position.y };
    const puppet = this.createPuppet({ id, position, duration, backlashDamage });
    if (!puppet) return { ok: false, code: 'puppetCreateFailed' };
    this.addEntity(puppet);

    const gatherOperationId = operationId || `puppet-gather-${this.nextSequence++}`;
    const started = this.gatheringSystem.start({
      player: this.owner,
      owner: this.owner,
      actor: puppet,
      nodeEntity,
      operationId: gatherOperationId,
      elapsed
    });
    if (!started.ok || started.idempotent) {
      this._removePuppet(puppet);
      return started;
    }

    if (consumeCharge) this.chargesRemaining = Math.max(0, this.initializeCharges() - 1);
    this.active = {
      puppet,
      puppetId: id,
      nodeId: nodeEntity.id,
      operationId: gatherOperationId,
      duration: Math.max(0.1, Number(duration) || 20),
      elapsedLifetime: 0,
      backlashDamage: Math.max(0, Number(backlashDamage) || 0)
    };
    this.onEvent('summoned', this.describe());
    return { ok: true, active: this.describe() };
  }

  update(deltaTime) {
    if (!this.active) return null;
    this.active.elapsedLifetime += Math.max(0, Number(deltaTime) || 0);
    if (this.active.elapsedLifetime >= this.active.duration) {
      return this.destroyActive('expired');
    }
    if (!this.gatheringSystem.isActiveFor(this.active.puppet)) {
      const completed = this.describe();
      this._removePuppet(this.active.puppet);
      this.active = null;
      this.onEvent('completed', completed);
      return { ok: true, code: 'completed' };
    }
    return null;
  }

  handleDamage(target, { isDead = false } = {}) {
    if (!this.active || target !== this.active.puppet || !isDead) return false;
    // CombatSystem 仍需在当前伤害调用栈内读取实体组件完成死亡表现，销毁延后到微任务。
    this.destroyActive('destroyed', { deferDestroy: true });
    return true;
  }

  destroyActive(reason = 'destroyed', { deferDestroy = false } = {}) {
    if (!this.active) return { ok: false, code: 'noActivePuppet' };
    const snapshot = this.describe();
    if (this.gatheringSystem.isActiveFor(this.active.puppet)) {
      this.gatheringSystem.interrupt('puppetDestroyed', { yieldRatio: 0 });
    }
    const damage = this.active.backlashDamage;
    this._removePuppet(this.active.puppet, { deferDestroy });
    this.active = null;
    if (damage > 0) this.damageOwner(damage, reason);
    this.onEvent(reason, snapshot);
    return { ok: true, code: reason, backlashDamage: damage };
  }

  cancelActive(reason = 'cancelled', { silent = false } = {}) {
    if (!this.active) return false;
    if (this.gatheringSystem.isActiveFor(this.active.puppet)) {
      this.gatheringSystem.interrupt(reason, { yieldRatio: 0, silent });
    }
    const snapshot = this.describe();
    this._removePuppet(this.active.puppet);
    this.active = null;
    if (!silent) this.onEvent(reason, snapshot);
    return true;
  }

  describe() {
    if (!this.active) return null;
    const transform = this.active.puppet?.getComponent?.('transform');
    const gathering = this.gatheringSystem.isActiveFor(this.active.puppet)
      ? this.gatheringSystem.describe()
      : null;
    return {
      puppetId: this.active.puppetId,
      nodeId: this.active.nodeId,
      operationId: this.active.operationId,
      duration: this.active.duration,
      elapsedLifetime: this.active.elapsedLifetime,
      backlashDamage: this.active.backlashDamage,
      position: transform ? { x: transform.position.x, y: transform.position.y } : null,
      gathering
    };
  }

  serialize() {
    return {
      schemaVersion: 1,
      chargesRemaining: this.chargesRemaining,
      nextSequence: this.nextSequence,
      active: this.describe()
    };
  }

  deserialize(data = {}, { owner = this.owner, resolveNode = null } = {}) {
    this.cancelActive('snapshotReplace', { silent: true });
    this.owner = owner || null;
    const charges = Number(data.chargesRemaining);
    this.chargesRemaining = Number.isInteger(charges) && charges >= 0 ? charges : null;
    const sequence = Math.floor(Number(data.nextSequence));
    this.nextSequence = Number.isInteger(sequence) && sequence > 0 ? sequence : 1;
    const active = data.active;
    if (!active) return { ok: true };
    const nodeEntity = typeof resolveNode === 'function' ? resolveNode(active.nodeId) : null;
    if (!nodeEntity) return { ok: false, code: 'puppetNodeMissing', nodeId: active.nodeId };
    const result = this.summon({
      nodeEntity,
      operationId: active.operationId,
      elapsed: active.gathering?.elapsed || 0,
      puppetId: active.puppetId,
      duration: active.duration,
      backlashDamage: active.backlashDamage,
      consumeCharge: false
    });
    if (result.ok && this.active) {
      this.active.elapsedLifetime = Math.max(0, Number(active.elapsedLifetime) || 0);
    }
    return result;
  }

  dispose() {
    this.cancelActive('disposed', { silent: true });
    this.owner = null;
    this.effectResolver = null;
  }

  _removePuppet(puppet, { deferDestroy = false } = {}) {
    this.removeEntity(puppet);
    const destroy = () => {
      try { puppet?.destroy?.(); } catch (_) { /* entity cleanup is best effort */ }
    };
    if (deferDestroy && typeof queueMicrotask === 'function') queueMicrotask(destroy);
    else if (deferDestroy) Promise.resolve().then(destroy);
    else destroy();
  }
}

export default GatheringPuppetSystem;