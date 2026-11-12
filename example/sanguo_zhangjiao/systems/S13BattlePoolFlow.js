/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-01-14
 ************************************************************/

import { resolveBattleScale } from '../../../src/systems/BattleScale.js';
import { createBattlePool, isPoolExhausted, planRefill, recordPoolDeaths } from '../../../src/systems/BattlePoolReserve.js';

const S13_BATTLE_ID = 'battle.s13.jingshan';
const HAN_GROUP = 'S13-han-army';
const HAN_GROUP_PREFIX = 'S13-han-';
const HAN_SOLDIER_ID = 'enemy.s03_han_soldier';
const BOSS_GROUP = 'S13-sun-xia';
const BOSS_ID = 'S13-sun-xia';
const BOSS_GUARD_PREFIX = 'S13-sun-xia-guard';
const SPAWN_ENTRIES = Object.freeze([
  { x: 760, y: 245 }, { x: 845, y: 300 }, { x: 925, y: 355 }
]);

/**
 * B6 S13 精山兵力池：按 battle.scale 的 screen 入场、pool 作总池，死一个补一个；
 * 孙夏阵亡后停补并让残部溃散。补员算术复用 BattlePoolReserve（与 S02 围剿同源）。
 */
export class S13BattlePoolFlow {
  constructor(scene) {
    if (!scene) throw new TypeError('S13BattlePoolFlow requires scene');
    this.scene = scene;
    this.pool = null;
    this.started = false;
    this.routed = false;
    this.exhausted = false;
    this.accumulator = 0;
    this.sequence = 0;
    this.lastAlive = 0;
  }

  /** 介入开战：初始化池并按同屏上限入场；已结算或已启动则幂等返回。 */
  start() {
    const story = this.scene.gameLoader?.blackboard?.get?.('storyState') || {};
    if (story.s13Resolved === true) return { ok: true, notApplicable: true };
    if (this.started) return { ok: true, idempotent: true };
    const definition = this.scene.s03s14BattleCoordinator?.getDefinition?.(S13_BATTLE_ID) || null;
    const scale = resolveBattleScale(definition);
    const alive = this._countAlive();
    this.pool = createBattlePool({
      total: scale.pool,
      screen: scale.screen,
      defeated: 0,
      reserve: Math.max(0, scale.pool - alive)
    });
    this.started = true;
    this.routed = false;
    this.exhausted = false;
    this.lastAlive = alive;
    const spawned = this._fillToScreen(alive);
    this.scene._showScreenTip?.(
      `汉军 ${scale.pool} 人压向精山，同屏最多 ${scale.screen} 人——死一个补一个，斩孙夏则余部自溃。`,
      { title: '精山战局' }
    );
    return { ok: true, scale, spawned };
  }

  /** 每帧推进（挂在 S13 场景 update 上）。 */
  update(deltaTime) {
    if (!this.pool || this.routed) return;
    this.accumulator += Number(deltaTime) || 0;
    if (this.accumulator < 0.2) return;
    this.accumulator = 0;

    // 斩将：孙夏阵亡/不在场 → 停补员并转溃逃
    const boss = this._findEntity(BOSS_ID);
    if (!boss || !this._isAlive(boss)) {
      this._rout();
      return;
    }

    const alive = this._countAlive();
    if (alive < this.lastAlive) recordPoolDeaths(this.pool, this.lastAlive - alive);
    this.lastAlive = alive;

    // 总池打空后不再补员，只剩孙夏亲兵；胜负仍由斩将决定
    if (this.exhausted) return;
    const spawnCount = planRefill(this.pool, alive);
    if (spawnCount > 0) {
      for (let index = 0; index < spawnCount; index += 1) this._spawnSoldier(this.pool.defeated + index);
      this.lastAlive = alive + spawnCount;
    }

    if (isPoolExhausted(this.pool)) {
      this.exhausted = true;
      // 状态事实：供台词/HUD 读取「后援已尽」，不参与胜负判定（胜负仍由斩将/战果冻结决定）
      this._submit('story.s13.hanReserveExhausted');
      this.scene._showScreenTip?.('汉军后援已尽，阵前只剩孙夏亲兵。', { title: '精山战况' });
    }
  }

  /** 提交状态事实：沿用既有一事一命令与 operationId 幂等，不自建账本。 */
  _submit(definitionId) {
    const gateway = this.scene.sceneRuntime?.commandGateway;
    const actorRef = this.scene.playerEntity?.id;
    if (!gateway?.execute || !actorRef) return { ok: false, code: 'commandGatewayUnavailable' };
    return gateway.execute({
      intentType: 'state.transaction',
      actorRef,
      operationId: `story:${definitionId}:s13battle:1`,
      payload: { definitionId }
    });
  }

  _fillToScreen(alive) {
    const spawnCount = planRefill(this.pool, alive);
    for (let index = 0; index < spawnCount; index += 1) this._spawnSoldier(this.pool.defeated + index);
    this.lastAlive = alive + spawnCount;
    return spawnCount;
  }

  /** 斩将收场：余部（含补员单位与孙夏护兵）溃散离场，并 tombstone 放置点；不再补员。 */
  _rout() {
    if (this.routed) return 0;
    this.routed = true;
    const removed = [];
    for (const entity of [...(this.scene.entityStore?.enemies || [])]) {
      const placementId = String(entity?.placementId || '');
      if (!placementId.startsWith(HAN_GROUP_PREFIX) && !placementId.startsWith(BOSS_GUARD_PREFIX)) continue;
      if (!this._isAlive(entity)) continue;
      this.scene.entityStore?.remove?.(entity);
      removed.push(entity);
    }
    const runtime = this.scene.context?.services?.placements;
    runtime?.despawn?.({ group: HAN_GROUP });
    runtime?.despawn?.({ group: BOSS_GROUP });
    this.scene._showScreenTip?.('孙夏阵亡，汉军残部溃散——不再补员。', { title: '斩将' });
    return removed.length;
  }

  _countAlive() {
    let alive = 0;
    for (const entity of this.scene.entityStore?.enemies || []) {
      if (!String(entity?.placementId || '').startsWith(HAN_GROUP_PREFIX)) continue;
      if (this._isAlive(entity)) alive += 1;
    }
    return alive;
  }

  _findEntity(placementId) {
    for (const entity of this.scene.entityStore?.enemies || []) {
      if (String(entity?.id || '') === placementId || String(entity?.placementId || '') === placementId) return entity;
    }
    return null;
  }

  _isAlive(entity) {
    if (!entity || entity.isDead === true) return false;
    const stats = entity.getComponent?.('stats');
    if (stats?.isAlive) return stats.isAlive() !== false;
    return (Number(stats?.hp) || 1) > 0;
  }

  _spawnSoldier(index) {
    const scene = this.scene;
    const definition = scene.gameLoader?.getRegistry?.('enemies')?.get?.(HAN_SOLDIER_ID);
    if (!definition || typeof scene.entityFactory?.createEnemy !== 'function') return null;
    const offset = scene._worldLoadResult?.worldIndex?.getOffset?.(scene.currentSceneId) || { x: 0, y: 0 };
    const entry = SPAWN_ENTRIES[index % SPAWN_ENTRIES.length];
    const jitter = (index % 9) * 12;
    const entity = scene.entityFactory.createEnemy({
      ...JSON.parse(JSON.stringify(definition)),
      id: `${HAN_GROUP_PREFIX}pool-r${++this.sequence}`,
      contentId: definition.id,
      templateId: definition.templateId || definition.id,
      position: {
        x: entry.x + (offset.x || 0) + jitter,
        y: entry.y + (offset.y || 0) + jitter
      },
      faction: 'han_government'
    });
    if (!entity) return null;
    entity.placementId = `${HAN_GROUP_PREFIX}pool-r${this.sequence}`;
    entity.faction = 'han_government';
    if (typeof scene.entityStore?.addEnemy === 'function') scene.entityStore.addEnemy(entity);
    else scene.entityStore?.add?.(entity);
    scene.aiSystem?.activateAI?.(entity, entity.aiType || 'aggressive');
    return entity;
  }
}

export default S13BattlePoolFlow;
