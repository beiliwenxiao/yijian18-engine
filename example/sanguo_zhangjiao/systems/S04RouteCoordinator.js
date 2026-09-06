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
 * 三国张角传 - S04 豫州互斥路线事务协调器
 ************************************************************/

export const S04_BATTLE_ID = 'battle.s04.changshe';
export const S04_ROUTE_CONFIGS = Object.freeze({
  nanyang: Object.freeze({
    id: 'nanyang', label: '南阳路线', entrySceneId: 'S05', sceneIds: ['S05', 'S06'],
    consequences: ['前往宛城外围与矿坑战线', '后续可救援张曼成', '放弃西华 S07–S08 路线']
  }),
  xihua: Object.freeze({
    id: 'xihua', label: '西华路线', entrySceneId: 'S07', sceneIds: ['S07', 'S08'],
    consequences: ['前往西华平原与余部战线', '采用不同的资源与战场机制', '放弃南阳 S05–S06 路线']
  })
});

const ROUTE_SCENE_IDS = Object.freeze(['S05', 'S06', 'S07', 'S08']);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

/** 只拥有路线领域事务；UI、场景传送和历史演出由调用方编排。 */
export class S04RouteCoordinator {
  constructor(config = {}) {
    this.readState = config.readState || (() => ({}));
    this.writeStoryState = config.writeStoryState || (() => false);
    this.hasTarget = config.hasTarget || (() => false);
    this.createCheckpoint = config.createCheckpoint || (async () => ({ ok: false }));
    this.onCommitted = config.onCommitted || (() => {});
    this.busy = false;
  }

  getRoute(routeId) { return S04_ROUTE_CONFIGS[routeId] || null; }

  getCommittedRoute() {
    const route = this.readState()?.storyState?.yuzhouRoute;
    return route?.status === 'committed' ? clone(route) : null;
  }

  validateOpen({ rescueActive = false } = {}) {
    const state = this.readState() || {};
    const committed = state.storyState?.yuzhouRoute;
    if (committed?.status === 'committed') {
      return { ok: true, committed: true, route: clone(committed) };
    }
    const battleFact = state.warState?.battles?.[S04_BATTLE_ID];
    if (!battleFact?.resultId || !(state.appliedBattleResultIds || []).includes(battleFact.resultId)) {
      return { ok: false, code: 'battleResultNotApplied' };
    }
    if (rescueActive) return { ok: false, code: 'rescueActive' };
    const missing = Object.values(S04_ROUTE_CONFIGS).find(route => !this.hasTarget(route.entrySceneId));
    if (missing) return { ok: false, code: 'routeTargetMissing', sceneId: missing.entrySceneId };
    return { ok: true };
  }

  validateSelection(routeId, options = {}) {
    const route = this.getRoute(routeId);
    if (!route) return { ok: false, code: 'invalidRoute' };
    const availability = this.validateOpen(options);
    if (!availability.ok) return availability;
    if (availability.committed) {
      return availability.route.routeId === routeId
        ? { ok: true, idempotent: true, route }
        : { ok: false, code: 'routeLocked', routeId: availability.route.routeId };
    }
    return { ok: true, route };
  }

  async commit(routeId, options = {}) {
    if (this.busy) return { ok: false, code: 'routeBusy' };
    const validation = this.validateSelection(routeId, options);
    if (!validation.ok || validation.idempotent) return validation;

    const route = validation.route;
    const before = clone(this.readState()?.storyState || {});
    const operationId = `route:S04:${routeId}`;
    const unlockedScenes = (before.unlockedScenes || [])
      .filter(sceneId => !ROUTE_SCENE_IDS.includes(sceneId));
    const storyTags = (before.storyTags || [])
      .filter(tag => tag !== 'route.nanyang' && tag !== 'route.xihua');
    const draft = {
      ...before,
      unlockedScenes: [...new Set([...unlockedScenes, route.entrySceneId])],
      storyTags: [...new Set([...storyTags, `route.${routeId}`])],
      yuzhouRoute: {
        routeId,
        entrySceneId: route.entrySceneId,
        selectedAtSceneId: 'S04',
        operationId,
        status: 'committed'
      },
      lastCheckpointId: `checkpoint.S04.route.${routeId}`
    };

    this.busy = true;
    try {
      try {
        if (this.writeStoryState(clone(draft)) === false) throw new Error('storyCommitRejected');
        const checkpoint = await this.createCheckpoint({
          checkpointId: draft.lastCheckpointId,
          sceneId: 'S04',
          routeId,
          operationId
        });
        if (checkpoint?.ok === false) throw new Error(checkpoint.message || 'checkpointRejected');
      } catch (error) {
        this.writeStoryState(before);
        return { ok: false, code: 'routeCommitRolledBack', message: String(error?.message || error) };
      }

      const committed = { ok: true, route: clone(route), operationId, storyState: clone(draft) };
      try {
        await this.onCommitted({ route: clone(route), operationId, storyState: clone(draft) });
      } catch (error) {
        return { ...committed, eventError: String(error?.message || error) };
      }
      return committed;
    } finally {
      this.busy = false;
    }
  }
}

export default S04RouteCoordinator;