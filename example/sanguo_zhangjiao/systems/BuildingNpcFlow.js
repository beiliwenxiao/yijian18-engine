/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-13
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * BuildingNpcFlow - 建筑前 NPC 交互骨架（场景交互 + 大地图点选共用）
 *
 * 形态：
 *   placement(NPC) + layer_logic interact 绑定 → trigger → scenario.command bnp.interact
 *   → 本 Flow 改写同一份对话数据并 startDialogue（不新造面板）。
 *   对话框返回 dialogueChoice → trigger → scenario.command bnp.execute
 *   → 本 Flow 调用同一 role.execute（结算/幂等/拒绝话术唯一实现）。
 *
 * 大地图：
 *   - 首次在场景内交互成功后写 storyState.buildingNpcUnlocked[npcId]（持久事实）。
 *   - 大地图标记只读该事实：未解锁置灰，点击给出「先到实地找人」提示；
 *     已解锁点选走同一个 interact({npcId, source:'map'})。
 */

import { resolveCompanionCapacity } from '../../../src/systems/CompanionSquadSystem.js';
import { createBuildingNpcRoles } from './BuildingNpcRoles.js';

const DEFAULT_COST = Object.freeze({
  recruit: Object.freeze({ foodPerHead: 1 }),
  muster: Object.freeze({ foodPerHead: 1 }),
  rank: Object.freeze({ foodPerRank: 8 })
});

const CAMP_BY_SCENE = Object.freeze({
  S02: 'camp.s02.field',
  S10: 'camp.s10.creek'
});

const toInt = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

export class BuildingNpcFlow {
  constructor(scene, { roles = null } = {}) {
    if (!scene) throw new TypeError('BuildingNpcFlow requires scene');
    this.scene = scene;
    /** @type {Map<string, Object>} npcId → role */
    this.roles = new Map();
    this._seq = 0;
    this._active = null;
    for (const role of (Array.isArray(roles) ? roles : createBuildingNpcRoles())) this.registerRole(role);
  }

  registerRole(role) {
    if (!role?.id || !role.dialogueId) return false;
    this.roles.set(String(role.id), role);
    return true;
  }

  // ─── 持久解锁事实 ───────────────────────────────────────

  _blackboard() {
    return this.scene.gameLoader?.blackboard || null;
  }

  storyState() {
    return this._blackboard()?.get?.('storyState') || {};
  }

  isUnlocked(npcId) {
    return Boolean(this.storyState()?.buildingNpcUnlocked?.[String(npcId)]);
  }

  /** 首次实地交互后写持久标记（按 NPC 唯一 id，不按建筑类型）。 */
  unlock(npcId, sceneId = null) {
    const board = this._blackboard();
    const id = String(npcId || '');
    if (!board?.get || !board?.set || !id) return false;
    const story = board.get('storyState') || {};
    if (story?.buildingNpcUnlocked?.[id]) return true;
    board.set('storyState', {
      ...story,
      buildingNpcUnlocked: {
        ...(story.buildingNpcUnlocked || {}),
        [id]: { sceneId: sceneId || this.scene.currentSceneId || null }
      }
    });
    return true;
  }

  // ─── 大地图标记 ─────────────────────────────────────────

  _worldIndex() {
    return this.scene._worldIndex
      || this.scene.context?.world?.worldIndex
      || this.scene._worldLoadResult?.worldIndex
      || null;
  }

  /** 大地图 NPC 标记（全部返回，未解锁由面板置灰）。 */
  getMapMarkers() {
    const index = this._worldIndex();
    const story = this.storyState();
    const markers = [];
    for (const role of this.roles.values()) {
      if (!role.mapPosition && !role.mapPositions) continue;
      const unlockedInfo = story?.buildingNpcUnlocked?.[role.id];
      const unlocked = Boolean(unlockedInfo);
      const sceneId = (unlockedInfo && typeof unlockedInfo === 'object' && unlockedInfo.sceneId)
        || role.sceneId;
      if (!sceneId) continue;
      const anchor = index?.findScene?.(sceneId) || null;
      const offset = anchor?.offset || { x: 0, y: 0 };
      const local = role.mapPositions?.[sceneId] || role.mapPosition || { x: 0, y: 0 };
      markers.push({
        id: `npc:${role.id}`,
        npcId: role.id,
        kind: 'npc',
        name: role.name || role.id,
        title: role.title || '',
        sceneId,
        unlocked,
        x: Number(offset.x || 0) + Number(local.x || 0),
        y: Number(offset.y || 0) + Number(local.y || 0)
      });
    }
    return markers;
  }

  // ─── 交互入口（场景 / 大地图） ──────────────────────────

  /**
   * 打开某个建筑 NPC 的对话。
   * @param {{npcId?:string, source?:'scene'|'map'}} params
   */
  interact({ npcId = null, source = 'scene' } = {}) {
    const scene = this.scene;
    const role = this.roles.get(String(npcId || ''));
    if (!role) {
      scene._showScreenTip?.('这里没有可交谈的人。', { title: '交互' });
      return { ok: false, code: 'unknownBuildingNpc', npcId };
    }
    if (source === 'map' && !this.isUnlocked(role.id)) {
      scene._showScreenTip?.(
        `${role.name || role.id}还没在大地图上露面。先到 ${role.sceneId || '实地'} 找到本人，谈过一次后这里才能直接点选。`,
        { title: '尚未结识' }
      );
      return { ok: false, code: 'npcNotUnlocked', npcId: role.id };
    }
    const system = scene.dialogueSystem || null;
    const dialogue = system?.dialogues?.get?.(role.dialogueId) || null;
    if (!dialogue?.nodes?.get) {
      scene._showScreenTip?.(`${role.name || role.id}的对话数据缺失，暂时无法交谈。`, { title: '对话' });
      return { ok: false, code: 'buildingNpcDialogueMissing', dialogueId: role.dialogueId };
    }

    const ctx = this._buildContext(role);
    const view = role.buildView(ctx);
    ctx.view = view;

    const startNode = dialogue.nodes.get('start');
    const doneNode = dialogue.nodes.get('done');
    const cancelNode = dialogue.nodes.get('cancel');
    if (startNode) {
      startNode.text = view.intro;
      startNode.choices = view.canConfirm === false
        ? [{ id: 'cancel', text: '知道了', nextNode: 'cancel' }]
        : [
          { id: 'confirm', text: view.confirmText, nextNode: 'done' },
          { id: 'cancel', text: '再说', nextNode: 'cancel' }
        ];
    }
    if (doneNode) doneNode.text = view.donePlaceholder || '';
    if (cancelNode && !cancelNode.text) cancelNode.text = '那人见你无意，便不再多言。';

    const started = system.startDialogue(role.dialogueId) !== false;
    if (!started) {
      scene._showScreenTip?.('现在无法开始对话。', { title: '对话' });
      return { ok: false, code: 'buildingNpcDialogueStartFailed', dialogueId: role.dialogueId };
    }
    this._active = { npcId: role.id, role, dialogueId: role.dialogueId, ctx, view };
    if (source === 'scene') this.unlock(role.id, this.scene.currentSceneId || role.sceneId);
    return { ok: true, npcId: role.id, dialogueId: role.dialogueId };
  }

  /**
   * 对话选项确认后的唯一执行业务入口。
   * 无论成功/拒绝都返回 ok:true 并改写 done 节点，让对话推进显示可读结果；
   * 失败只写话术，不扣资源、不写事实。
   */
  async execute({ npcId = null } = {}) {
    const active = this._active;
    const role = this.roles.get(String(npcId || ''));
    if (!role || !active || active.npcId !== role.id) {
      return { ok: false, code: 'buildingNpcSessionMissing' };
    }
    const ctx = { ...active.ctx, view: active.view };
    const result = await role.execute(ctx);
    const dialogue = this.scene.dialogueSystem?.dialogues?.get?.(active.dialogueId) || null;
    const doneNode = dialogue?.nodes?.get?.('done');
    if (doneNode) doneNode.text = result?.message || '事情没有办成。';
    if (result?.ok !== true) {
      this.scene._showScreenTip?.(result?.message || '事情没有办成。', { title: role.title || role.name || '交互' });
    }
    return { ok: true, accepted: result?.ok === true, message: result?.message || '' };
  }

  // ─── 视图上下文 ─────────────────────────────────────────

  _project() {
    return this.scene.gameLoader?.project || {};
  }

  _costConfig() {
    const config = this._project()?.buildingNpc || {};
    return {
      recruit: { ...DEFAULT_COST.recruit, ...(config.recruit || {}) },
      muster: { ...DEFAULT_COST.muster, ...(config.muster || {}) },
      rank: { ...DEFAULT_COST.rank, ...(config.rank || {}) }
    };
  }

  _ranks() {
    const list = this.scene.gameLoader?.getRegistry?.('ranks')?.all?.() || [];
    return [...list].sort((a, b) => toInt(a?.value) - toInt(b?.value));
  }

  _heroCommand() {
    const rule = this._project()?.companionRule || {};
    const hero = this.scene.gameLoader?.getRegistry?.('heroes')?.get?.(rule.heroId) || null;
    return toInt(hero?.stats?.command);
  }

  rankValue(story = this.storyState()) {
    const rank = story?.playerRank;
    if (rank && Number.isFinite(Number(rank.value))) return Number(rank.value);
    const rankId = rank?.rankId || this._project()?.companionRule?.initialRankId;
    return toInt(this._ranks().find(entry => entry.id === rankId)?.value);
  }

  resolveCapacity(rankValue = this.rankValue()) {
    const command = this._heroCommand();
    const squadCapacity = Number(this.scene.companionSquadSystem?.getCapacity?.());
    if (Number.isFinite(squadCapacity) && squadCapacity > 0) {
      // 当前上限（官职未变时与 domain 系统一致）；只有晋升时需要换 rankValue 重算。
      if (Math.abs(this.rankValue() - Number(rankValue)) < 1e-6) return squadCapacity;
    }
    return resolveCompanionCapacity({
      command,
      rankValue: Number(rankValue) || 0,
      capacityMax: this._project()?.companionRule?.capacityMax || 100
    });
  }

  _campIdFor(sceneId) {
    const key = String(sceneId || this.scene.currentSceneId || '').replace(/-C\d{2}$/, '');
    const preferred = CAMP_BY_SCENE[key] || null;
    const ledger = this.scene.foodLedgerSystem;
    if (preferred && ledger?.getCamp?.(preferred)) return preferred;
    if (ledger?.getCamp?.('camp.s02.field')) return 'camp.s02.field';
    return preferred || 'camp.s02.field';
  }

  /**
   * 亲卫实兵数：以场景内 squadMember.armyId='companion' 的存活实体为准。
   * storyState.s02RecruitCount 只作镜像写入，出现偏差时以本函数为准。
   */
  liveCompanionCount() {
    const entities = this.scene.entityStore?.all || [];
    let count = 0;
    for (const entity of entities) {
      if (!entity || entity.isDead === true) continue;
      if (entity.getComponent?.('squadMember')?.armyId === 'companion') count += 1;
    }
    return count;
  }

  _spawnAnchor() {
    const player = this.scene.playerEntity;
    const playerPosition = player?.getComponent?.('transform')?.position || player?.position || null;
    if (playerPosition) return { x: Number(playerPosition.x) || 0, y: (Number(playerPosition.y) || 0) + 48 };
    const entry = this.scene.companionEntryPoint;
    if (entry && Number.isFinite(Number(entry.x)) && Number.isFinite(Number(entry.y))) {
      return { x: Number(entry.x), y: Number(entry.y) };
    }
    return { x: 0, y: 0 };
  }

  /**
   * 按缺口生成可战斗亲卫实体（EntityFactory 友军管线 + squadMember）。
   * 稳定 id：companion.bnp.<持久序号>；重试时跳过已存在实体，避免翻倍。
   * 任一实体生成失败 → 回滚本次已生成实体，返回失败（不扣资源）。
   * @returns {{ok:boolean, code?:string, created?:Object[], seq?:number, liveCount?:number}}
   */
  spawnCompanionBatch(count = 0) {
    const total = Math.max(0, toInt(count));
    if (total <= 0) return { ok: true, created: [], seq: toInt(this.storyState()?.bnpSpawnSeq), liveCount: this.liveCompanionCount() };
    const spawn = this.scene.spawnCompanionMember;
    if (typeof spawn !== 'function') return { ok: false, code: 'companionSpawnUnavailable' };
    const store = this.scene.entityStore;
    const anchor = this._spawnAnchor();
    const created = [];
    let seq = toInt(this.storyState()?.bnpSpawnSeq);
    for (let index = 0; index < total; index += 1) {
      let unitId = '';
      do {
        seq += 1;
        unitId = `companion.bnp.${seq}`;
      } while (store?.getById?.(unitId));
      const entity = spawn.call(this.scene, {
        unitId,
        blueprint: {
          definitionId: 'enemy.s02_militia',
          faction: 'ally',
          name: '亲卫',
          squadMember: { armyId: 'companion', squadId: 'companion', formationIndex: index }
        },
        position: { x: anchor.x + ((index % 5) - 2) * 22, y: anchor.y + Math.floor(index / 5) * 22 }
      });
      if (!entity) {
        this.rollbackCompanionBatch({ created });
        return { ok: false, code: 'companionSpawnFailed', spawned: created.length };
      }
      created.push(entity);
    }
    this.scene.companionSquadFlow?.syncRoster?.();
    return { ok: true, created, seq, liveCount: this.liveCompanionCount() };
  }

  /** 回滚一次生成（事务/资源失败时调用），保证不残留半截实体。 */
  rollbackCompanionBatch(spawned = null) {
    const created = Array.isArray(spawned?.created) ? spawned.created : [];
    for (const entity of created) this.scene.entityStore?.remove?.(entity);
    if (created.length > 0) this.scene.companionSquadFlow?.syncRoster?.();
    return { ok: true, removed: created.length };
  }

  _buildContext(role) {
    const story = this.storyState();
    const ledger = this.scene.foodLedgerSystem;
    const sceneId = this.scene.currentSceneId || role.sceneId;
    const campId = this._campIdFor(sceneId);
    const camp = ledger?.getCamp?.(campId) || null;
    const armyId = camp?.ownerArmyId || 'army.player.escort';
    const army = ledger?.getArmy?.(armyId) || null;
    const ranks = this._ranks();
    const currentRank = story?.playerRank?.rankId
      ? ranks.find(entry => entry.id === story.playerRank.rankId) || null
      : ranks.find(entry => toInt(entry.value) === this.rankValue(story)) || ranks[0] || null;
    const nextRank = currentRank
      ? ranks.find(entry => toInt(entry.value) > toInt(currentRank.value)) || null
      : null;
    const scattered = (ledger?.listScattered?.({ armyId }) || [])
      .reduce((sum, entry) => sum + Math.max(0, toInt(entry?.count)), 0);
    // 编制人数以实兵为准（story 计数只做镜像；读档/重进不翻倍）
    const count = this.liveCompanionCount();
    const npcId = role.id;
    const seq = () => ++this._seq;
    const operationId = kind => `bnp:${npcId}:${kind}:${seq()}`;
    return {
      story,
      sceneId,
      campId,
      armyId,
      camp,
      campFood: toInt(camp?.stock?.food),
      armyFood: toInt(army?.supply?.food),
      command: this._heroCommand(),
      rankValue: this.rankValue(story),
      ranks,
      currentRank,
      nextRank,
      count,
      cap: this.resolveCapacity(),
      scattered,
      config: this._costConfig(),
      liveCount: () => this.liveCompanionCount(),
      resolveCapacity: rankValue => this.resolveCapacity(rankValue),
      spawn: countToSpawn => this.spawnCompanionBatch(countToSpawn),
      rollbackSpawn: spawned => this.rollbackCompanionBatch(spawned),
      takeScattered: amount => ledger?.takeScattered?.({ armyId, count: amount }) || { ok: false, taken: 0, entries: [] },
      returnScattered: entries => ledger?.returnScattered?.(entries) || { ok: false },
      refund: entries => {
        try {
          return ledger?.deposit?.({ campId, armyId, entries, operationId: operationId('refund') }) || { ok: false };
        } catch {
          return { ok: false };
        }
      },
      preview: entries => ledger?.previewConsume?.({ campId, armyId, entries }) || { ok: false, code: 'logisticsUnavailable' },
      consume: entries => ledger?.consume?.({ campId, armyId, entries, operationId: operationId('consume') }) || { ok: false, code: 'logisticsUnavailable' },
      submit: (definitionId, payload = {}) => this._submit(definitionId, payload, operationId(`fact:${definitionId}`))
    };
  }

  _submit(definitionId, payload, operationId) {
    const gateway = this.scene.sceneRuntime?.commandGateway;
    const actorRef = this.scene.playerEntity?.id;
    if (!gateway?.execute || !actorRef) return { ok: false, code: 'commandGatewayUnavailable' };
    return gateway.execute({
      intentType: 'state.transaction',
      actorRef,
      operationId,
      payload: { definitionId, ...payload }
    }).then(result => result === false || result?.ok === false
      ? { ok: false, code: result?.code || 'transactionRejected', result }
      : { ok: true, result })
      .catch(error => ({ ok: false, code: error?.code || 'transactionError', error }));
  }
}

export default BuildingNpcFlow;
