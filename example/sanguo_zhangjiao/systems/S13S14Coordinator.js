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

 ************************************************************
 * 三国张角传 - S13/S14 内容协调器
 * 仅编排精山可选战场、终局资源分歧和 Demo 结局配置；不是通用 EndingSystem。
 ************************************************************/

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const isObject = value => value !== null && typeof value === 'object';

function getPath(source, path) {
  if (!path) return source;
  return String(path).split('.').reduce((value, key) => value == null ? undefined : value[key], source);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function stableHash(value) {
  const text = JSON.stringify(canonicalize(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function deepFreeze(value) {
  if (!isObject(value) || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function evaluateCondition(condition, snapshot) {
  if (condition === true || condition == null) return true;
  if (condition === false) return false;
  if (Array.isArray(condition.all)) return condition.all.every(entry => evaluateCondition(entry, snapshot));
  if (Array.isArray(condition.any)) return condition.any.some(entry => evaluateCondition(entry, snapshot));
  if (condition.not) return !evaluateCondition(condition.not, snapshot);
  const actual = getPath(snapshot, condition.path);
  switch (condition.op || 'truthy') {
    case 'eq': return actual === condition.value;
    case 'neq': return actual !== condition.value;
    case 'gt': return actual > condition.value;
    case 'gte': return actual >= condition.value;
    case 'lt': return actual < condition.value;
    case 'lte': return actual <= condition.value;
    case 'exists': return actual !== undefined && actual !== null;
    case 'falsy': return !actual;
    default: return !!actual;
  }
}
function normalizeHero(storyState, key, fallbackKey, visited) {
  const explicit = storyState.heroStates?.[key];
  const survived = explicit?.survived ?? storyState[fallbackKey];
  const normalizedSurvival = typeof survived === 'boolean' ? survived : (visited ? undefined : false);
  return {
    survived: normalizedSurvival,
    status: explicit?.status || (typeof survived === 'boolean' ? (survived ? 'alive' : 'dead') : (visited ? undefined : 'notVisited'))
  };
}

/** Demo 历史编排器；所有持久化、战果事务、检查点和演出均通过依赖注入。 */
export class S13S14Coordinator {
  constructor(config = {}) {
    this.readState = config.readState || (() => ({}));
    this.writeStoryState = config.writeStoryState || (() => false);
    this.applyS13Settlement = config.applyS13Settlement || (async () => ({ ok: true }));
    this.applyResourceDivergence = config.applyResourceDivergence || (async () => ({ ok: true }));
    this.createCheckpoint = config.createCheckpoint || (async () => ({ ok: true }));
    this.hasTarget = config.hasTarget || (() => true);
    this.onS13Committed = config.onS13Committed || (() => {});
    this.onEndingCommitted = config.onEndingCommitted || (() => {});
    this.endingSystem = config.endingSystem || null;
    this.busy = false;
  }

  resolvePostS12Target() {
    const story = this.readState()?.storyState || {};
    if (story.s12Resolved !== true) return { ok: false, code: 's12NotResolved' };
    const visited = Array.isArray(story.visitedScenes) ? story.visitedScenes : [];
    const routeId = story.yuzhouRoute?.routeId || story.routeId || null;
    const nanyangRoute = routeId === 'nanyang' || story.nanyangIntervened === true;
    const s05Intervened = story.battleModes?.['battle.s05_wancheng_outskirts'] === 'intervene'
      || (story.nanyangIntervened === true && story.battleModes?.['battle.s05_wancheng_outskirts'] == null);
    const eligible = nanyangRoute && s05Intervened
      && (visited.includes('S05') || visited.includes('S06'));
    const sceneId = eligible ? 'S13' : 'S14';
    if (!this.hasTarget(sceneId)) return { ok: false, code: 'targetMissing', sceneId };
    return { ok: true, sceneId, s13Eligible: eligible };
  }

  async commitS13Choice(choice, options = {}) {
    if (this.busy) return { ok: false, code: 'coordinatorBusy' };
    if (!choice || !['observe', 'intervene'].includes(choice.id)) return { ok: false, code: 'invalidS13Choice' };
    const route = this.resolvePostS12Target();
    if (!route.ok) return route;
    if (!route.s13Eligible) return { ok: false, code: 's13NotEligible', sceneId: 'S14' };
    const beforeState = clone(this.readState() || {});
    const beforeStory = clone(beforeState.storyState || {});
    const existing = beforeStory.s13Resolution;
    if (existing?.committed === true) {
      return existing.choiceId === choice.id
        ? { ok: true, idempotent: true, resolution: clone(existing) }
        : { ok: false, code: 's13ChoiceLocked', choiceId: existing.choiceId };
    }
    const checkpointId = options.checkpointId || 'checkpoint.S13.resolved';
    const operationId = `story:S13:${choice.id}`;
    const resolution = {
      committed: true, choiceId: choice.id, battleMode: choice.result?.battleMode || choice.id,
      resourceCost: clone(choice.resourceCost || {}), result: clone(choice.result || {}),
      operationId, nextSceneId: 'S14'
    };

    this.busy = true;
    let settlement = null;
    try {
      settlement = await this.applyS13Settlement({ choice: clone(choice), operationId, beforeState });
      if (settlement?.ok === false) throw new Error(settlement.message || settlement.code || 's13SettlementRejected');
      const committedStory = clone(this.readState()?.storyState || beforeStory);
      const draftStory = {
        ...committedStory,
        visitedScenes: [...new Set([...(committedStory.visitedScenes || []), 'S13'])],
        battleModes: { ...(committedStory.battleModes || {}), 'battle.s13.jingshan': resolution.battleMode },
        s13Resolution: resolution, s13Resolved: true, lastCheckpointId: checkpointId
      };
      if (this.writeStoryState(clone(draftStory)) === false) throw new Error('storyCommitRejected');
      const checkpoint = await this.createCheckpoint({ checkpointId, sceneId: 'S13', operationId });
      if (checkpoint?.ok === false) throw new Error(checkpoint.message || checkpoint.code || 'checkpointRejected');
    } catch (error) {
      this.writeStoryState(beforeStory);
      await settlement?.rollback?.();
      return { ok: false, code: 's13CommitRolledBack', message: String(error?.message || error) };
    } finally {
      this.busy = false;
    }
    const committed = { ok: true, operationId, resolution: clone(resolution), nextSceneId: 'S14' };
    try { await this.onS13Committed(committed); } catch (error) { committed.eventError = String(error?.message || error); }
    return committed;
  }
  normalizeEndingSnapshot() {
    const state = clone(this.readState() || {});
    const storyState = state.storyState || {};
    const visited = storyState.visitedScenes || [];
    const modes = storyState.battleModes || {};
    const modeValues = Object.values(modes).filter(mode => mode === 'observe' || mode === 'intervene');
    const eligibleBattleIds = state.battleModeStats?.eligibleBattleIds || storyState.endingInputs?.eligibleBattleIds;
    const allOptionalBattlesObserved = state.battleModeStats?.allOptionalBattlesObserved
      ?? (Array.isArray(eligibleBattleIds) && eligibleBattleIds.length > 0
        ? eligibleBattleIds.every(battleId => modes[battleId] === 'observe')
        : undefined);
    const coreCity = state.coreCityState || state.cityState
      || (state.cityStates || []).find(city => city?.id === 'city.s09_guangzong_camp');
    const hidden = state.hiddenInputs || storyState.endingInputs || {};
    const resourceState = state.resourceState || {
      ...(coreCity?.resources || {}),
      cart: clone(state.retreatCart || storyState.retreatCart)
    };
    return {
      storyState,
      cityState: { coreCityId: coreCity?.id, coreDamageRatio: coreCity?.damageRatio },
      warState: state.warState,
      heroes: {
        bocai: normalizeHero(storyState, 'bocai', 'bocaiSurvived', true),
        zhangMancheng: normalizeHero(storyState, 'zhangMancheng', 'zhangManchengSurvived', visited.includes('S05') || visited.includes('S06')),
        zhangLiang: normalizeHero(storyState, 'zhangLiang', 'zhangLiangSurvived', visited.includes('S11')),
        zhangBao: normalizeHero(storyState, 'zhangBao', 'zhangBaoSurvived', visited.includes('S12'))
      },
      battleModeStats: {
        byBattle: modes,
        yingchuan: modes['battle.s03.yingchuan'],
        observeCount: state.battleModeStats?.observeCount ?? modeValues.filter(mode => mode === 'observe').length,
        interventionCount: state.battleModeStats?.interventionCount ?? modeValues.filter(mode => mode === 'intervene').length,
        eligibleBattleIds: clone(eligibleBattleIds),
        allOptionalBattlesObserved
      },
      retreatReadiness: clone(state.retreatReadiness || storyState.retreatReadiness),
      hiddenInputs: {
        cumulativeGathering: clone(hidden.cumulativeGathering),
        cityMaintenanceLevel: hidden.cityMaintenanceLevel,
        allowedCityDestruction: hidden.allowedCityDestruction,
        resourceConstructionScore: hidden.resourceConstructionScore
      },
      resourceState
    };
  }

  createEndingSnapshot(endingConfig) {
    const snapshot = this.normalizeEndingSnapshot();
    const missingPaths = (endingConfig?.snapshot?.requiredPaths || [])
      .filter(path => getPath(snapshot, path) === undefined || getPath(snapshot, path) === null);
    if (missingPaths.length > 0) return { ok: false, code: 'endingSnapshotMissingFields', missingPaths };
    const endingSnapshotId = `${endingConfig?.snapshot?.stableIdPrefix || 'endingSnapshot'}:${stableHash(snapshot)}`;
    return { ok: true, endingSnapshotId, snapshot: deepFreeze(snapshot) };
  }

  resolveResourceDivergence(endingConfig, suppliedSnapshot = null) {
    const snapshot = suppliedSnapshot || this.normalizeEndingSnapshot();
    const config = endingConfig?.resourceDivergence;
    const missingPaths = (config?.requiredPaths || [])
      .filter(path => getPath(snapshot, path) === undefined || getPath(snapshot, path) === null);
    if (!config) return { ok: false, code: 'resourceDivergenceMissing' };
    if (missingPaths.length > 0) return { ok: false, code: 'resourceSnapshotMissingFields', missingPaths };
    const cart = evaluateCondition(config.cartBreakout.condition, snapshot) ? config.cartBreakout : config.cartLost;
    const catapult = evaluateCondition(config.catapultReady.condition, snapshot) ? config.catapultReady : config.catapultMissingWood;
    return { ok: true, id: config.id, cart: clone(cart), catapult: clone(catapult) };
  }

  async commitResourceDivergence(kind, endingConfig) {
    if (this.busy) return { ok: false, code: 'coordinatorBusy' };
    if (!['cart', 'catapult'].includes(kind)) return { ok: false, code: 'invalidResourceDivergenceKind' };
    const beforeState = clone(this.readState() || {});
    const beforeStory = clone(beforeState.storyState || {});
    const existing = beforeStory.s14ResourceDivergence?.[kind];
    if (existing) return { ok: true, idempotent: true, kind, result: clone(existing) };

    const frozenSnapshot = deepFreeze(this.normalizeEndingSnapshot());
    const divergence = this.resolveResourceDivergence(endingConfig, frozenSnapshot);
    if (!divergence.ok) return divergence;
    const selected = clone(divergence[kind]);
    const operationId = `story:S14:${divergence.id}:${kind}`;
    const result = { ...selected, operationId, committed: true };
    const resourceDivergence = {
      ...(beforeStory.s14ResourceDivergence || {}),
      id: divergence.id,
      [kind]: result
    };
    resourceDivergence.completed = !!resourceDivergence.cart && !!resourceDivergence.catapult;
    const draftStory = {
      ...beforeStory,
      visitedScenes: [...new Set([...(beforeStory.visitedScenes || []), 'S14'])],
      s14ResourceDivergence: resourceDivergence,
      lastCheckpointId: `checkpoint.S14.${kind}`
    };

    this.busy = true;
    let domain = null;
    try {
      domain = await this.applyResourceDivergence({
        kind, result: clone(result), operationId: `${operationId}:domain`,
        snapshot: clone(frozenSnapshot), beforeState: clone(beforeState)
      });
      if (domain?.ok === false) throw new Error(domain.message || domain.code || 'resourceDomainCommitRejected');
      if (this.writeStoryState(clone(draftStory)) === false) throw new Error('storyCommitRejected');
      const checkpoint = await this.createCheckpoint({
        checkpointId: draftStory.lastCheckpointId,
        sceneId: 'S14',
        operationId
      });
      if (checkpoint?.ok === false) throw new Error(checkpoint.message || checkpoint.code || 'checkpointRejected');
      try { await domain?.finalize?.(); }
      catch (error) { console.warn('[S13S14Coordinator] post-checkpoint finalize failed', error); }
      return { ok: true, kind, result: clone(result), completed: resourceDivergence.completed };
    } catch (error) {
      this.writeStoryState(beforeStory);
      await domain?.rollback?.();
      return { ok: false, code: 'resourceDivergenceRolledBack', message: String(error?.message || error) };
    } finally {
      this.busy = false;
    }
  }

  selectConfiguredEnding(endingConfig, snapshot) {
    const byId = new Map((endingConfig?.endings || []).map(ending => [ending.id, ending]));
    for (const endingId of endingConfig?.priority || []) {
      const ending = byId.get(endingId);
      if (ending && evaluateCondition(ending.condition, snapshot)) return clone(ending);
    }
    return null;
  }

  /**
   * @deprecated 结局选择与提交的正式权威是 EndingSystem。
   * 仅保留给旧调用方；不再在 coordinator 内复制结局优先级或持久化逻辑。
   */
  async commitEnding(_endingConfig) {
    if (!this.endingSystem?.resolveEnding) {
      return { ok: false, code: 'endingSystemUnavailable' };
    }
    return this.endingSystem.resolveEnding({
      checkpointId: 'checkpoint.S14.preEnding'
    });
  }
}

export { evaluateCondition as evaluateS13S14Condition, stableHash as createS13S14SnapshotHash };
export default S13S14Coordinator;
