/**
 * S01TriggerRunner - 2D 触发器执行桥（M1）
 *
 * 载入 project/triggers.json 的 S01 触发器，按事件类型+参数匹配触发，
 * 逐条执行 do[] 命令链。命令通过宿主注入的 handlers.executeAction 分发：
 *
 *   fire('sceneEnter', { sceneId: 'S01' })
 *   fire('interact')                     // 绑定交互（triggerId 直达）
 *   fire('itemPickup', { placementId })
 *   fire('gathering.completed', { itemId, resourceType })
 *   fire('state.transaction', { definitionId })   // 事实提交后内部派生
 *   fireTrigger('trg_s01_light_campfire')          // 交互绑定按 triggerId 直达
 *
 * when.params 匹配语义：params 中给出的键必须全部相等（2D 同口径）。
 * once / cooldown 防重入；执行为顺序 await（2D do[] 同构）。
 */

export class S01TriggerRunner {
  constructor({ triggers, handlers }) {
    this.triggers = triggers || [];
    this.handlers = handlers;
    this._firedOnce = new Set();
    this._cooldownUntil = new Map();
    this._byId = new Map(this.triggers.map(t => [t.id, t]));
  }

  /** 按事件类型触发全部匹配触发器 */
  fire(eventType, params = {}, eventContext = {}) {
    for (const trg of this.triggers) {
      const when = trg.when || {};
      if (when.type !== eventType) continue;
      if (!this._paramsMatch(when.params || {}, params)) continue;
      this._run(trg, eventContext);
    }
  }

  /** 按 triggerId 直接触发（交互绑定 / state.transaction 链） */
  fireTrigger(triggerId, eventContext = {}) {
    const trg = this._byId.get(triggerId);
    if (!trg) return false;
    this._run(trg, eventContext);
    return true;
  }

  _paramsMatch(whenParams, params) {
    for (const key of Object.keys(whenParams)) {
      const expected = whenParams[key];
      const actual = params[key];
      if (expected === undefined) continue;
      if (actual !== expected) return false;
    }
    return true;
  }

  _run(trg, eventContext) {
    if (trg.once && this._firedOnce.has(trg.id)) return;
    if (trg.cooldown) {
      const until = this._cooldownUntil.get(trg.id) || 0;
      if (Date.now() < until) return;
      this._cooldownUntil.set(trg.id, Date.now() + trg.cooldown * 1000);
    }
    if (trg.once) this._firedOnce.add(trg.id);

    this.handlers.onTriggerStart?.(trg, eventContext);
    const steps = trg.do || [];
    (async () => {
      for (const step of steps) {
        try {
          await this.handlers.executeAction(step, eventContext, trg);
        } catch (err) {
          console.error(`S01TriggerRunner: 命令执行失败 ${trg.id}/${step.stepId}`, err);
        }
      }
      this.handlers.onTriggerEnd?.(trg, eventContext);
    })();
  }
}

export default S01TriggerRunner;
