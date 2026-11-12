/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-12
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * S02BattleFlow - S02 两场战斗的刷兵逻辑（⑨ 起事 / 围剿）
 *
 * 两场机制刻意不复用：
 * - ⑨ 起事：县尉 100 兵由 placement（count:100）整组一次性入场，无补员池、无 BOSS；
 *   全灭由触发器 waveCleared 结算，本类只负责激活/收尾。
 * - 围剿：总兵力池 1000、同屏上限 100、占位补员（死 1 补 1）；累计击破 500 时
 *   傅燮登场（自带 8 护兵、不计入池）；斩将即停补员、余部溃散。
 *
 * 补员使用 EntityFactory 直接重建（与 SceneGameplaySystemAssembler 友军补位同源），
 * 不写入 canonical placement 账本——补员单位是战斗运行态，不入档。
 */

import { normalizeBattleScale } from '../../../src/systems/BattleScale.js';

/**
 * 围剿规模：走全局 scale 语义（pool/screen），S02 自实现仍按 1000 池 / 同屏 100。
 * 与 S13 `battle.scale` 共用同一套归一规则，只是 S02 不走 battle 定义。
 */
const RAID_SCALE = normalizeBattleScale({ pool: 1000, screen: 100 });

const RAID = {
  total: RAID_SCALE.pool,
  screenCap: RAID_SCALE.screen,
  bossThreshold: 500,
  bossId: 'S02-raid-boss',
  guardPrefix: 'S02-raid-boss-guard',
  soldierId: 'enemy.s02_lu_mainforce',
  faction: 'han_government',
  entries: [{ x: 60, y: 300 }, { x: 60, y: 480 }]
};

export class S02BattleFlow {
  constructor(scene) {
    if (!scene) throw new TypeError('S02BattleFlow requires scene');
    this.scene = scene;
    this.raid = null;
    this.sequence = 0;
    this._accumulator = 0;
    this._lastAlive = 0;
    this._defeatFired = false;
    this._victoryFired = false;
  }

  _story() {
    return this.scene.gameLoader?.blackboard?.get?.('storyState') || {};
  }

  _offset() {
    return this.scene._worldLoadResult?.worldIndex?.getOffset?.(this.scene.currentSceneId) || { x: 0, y: 0 };
  }

  _submit(definitionId, payload = {}) {
    const gateway = this.scene.sceneRuntime?.commandGateway;
    const actorRef = this.scene.playerEntity?.id;
    if (!gateway || !actorRef) return { ok: false, code: 'commandGatewayUnavailable' };
    return gateway.execute({
      intentType: 'state.transaction',
      actorRef,
      operationId: `story:${definitionId}:s02battle:${++this.sequence}`,
      payload: { definitionId, ...payload }
    });
  }

  _tip(text, title = '战况') {
    this.scene._showScreenTip?.(text, { title });
  }

  _activateGroup(group) {
    for (const entity of this.scene.entityStore?.enemies || []) {
      if (String(entity?.placementId || '').startsWith(group)) {
        this.scene.aiSystem?.activateAI?.(entity, entity.aiType || 'aggressive');
      }
    }
  }

  _isAlive(entity) {
    if (!entity || entity.isDead === true) return false;
    const stats = entity.getComponent?.('stats');
    if (stats?.isAlive) return stats.isAlive() !== false;
    return (Number(stats?.hp) || 1) > 0;
  }

  /** ⑨ 起事开战：激活县尉 100 兵与张角 20 黄巾（整组一次性入场，无补员）。 */
  startRevolt() {
    if (this._story().s02RevoltConfirmed === true) return { ok: true, idempotent: true };
    this._activateGroup('S02-revolt-county');
    this._activateGroup('S02-revolt-leader');
    this._activateGroup('S02-army-column');
    this._tip('县尉的一百官兵压了上来。你操控张角，带二十名黄巾死战——这一战没有退路。', '⑨ 起事');
    return { ok: true };
  }

  /** ⑨ 收尾：县尉兵败逃走（不打死），留作围剿与官军线的引线。 */
  finishRevolt() {
    const runtime = this.scene.context?.services?.placements;
    runtime?.despawn?.({ group: 'S02-revolt-leader' });
    runtime?.despawn?.({ group: 'S02-revolt-county' });
    return { ok: true };
  }

  /**
   * 围剿开战：初始化兵力池，激活场上先头 100，按分支增援我方。
   * @param {{branch?: 'joined'|'independent', assist?: boolean}} params
   */
  startRaid({ branch = 'joined', assist = true } = {}) {
    if (this.raid?.active) return { ok: true, idempotent: true };
    this.raid = {
      active: true,
      branch,
      assist: branch === 'joined' ? true : assist !== false,
      total: RAID.total,
      reserve: RAID.total - RAID.screenCap,
      defeated: 0,
      bossSpawned: false,
      bossDead: false
    };
    // 先头 100 由 placement（spawnWhen=s02RaidFight）生成，可能晚于本调用一帧落地；
    // 以实际存活数为基线，避免把「尚未出现」误判成 100 人阵亡。
    this._lastAlive = this._countAlive('S02-raid-legion');
    this._defeatFired = false;
    this._victoryFired = false;
    this._zhangjiaoFallen = false;
    this._activateGroup('S02-raid-legion');
    const runtime = this.scene.context?.services?.placements;
    if (branch === 'joined') {
      runtime?.spawn?.({ group: 'S02-army-yellow80', authoritative: true });
      runtime?.spawn?.({ group: 'S02-army-guard', authoritative: true });
      this._tip('傅燮亲率一千人压境。场上最多一百，死一个补一个——击破五百，主将才会现身。', '围剿');
    } else if (this.raid.assist) {
      runtime?.spawn?.({ group: 'S02-army-guard', authoritative: true });
      this._tip('傅燮的大军压境。你率亲卫从侧翼入场，张角率黄巾正面迎敌。', '围剿');
    } else {
      this._tip('傅燮的大军压境。你留守村口，张角率黄巾独自迎战。', '围剿');
    }
    return { ok: true, raid: { ...this.raid } };
  }

  /** 读档恢复：不重置兵力池，只重新激活场上单位。 */
  resumeRaid() {
    if (!this.raid) {
      const story = this._story();
      if (story.s02RaidFight !== true) return { ok: true, notApplicable: true };
      this.raid = {
        active: true,
        branch: story.s02AllegianceJoined === true ? 'joined' : 'independent',
        assist: story.s02RaidAssist !== false,
        total: RAID.total,
        reserve: 0,
        defeated: Number(story.s02RaidDefeated) || 0,
        bossSpawned: story.s02RaidBossSpawned === true,
        bossDead: false
      };
    }
    this._activateGroup('S02-raid-legion');
    return { ok: true };
  }

  /** 每帧（SceneLifecycle 的 S02 分支）推进补员与斩将判定。 */
  update(deltaTime) {
    const raid = this.raid;
    if (!raid?.active) return;
    this._accumulator += Number(deltaTime) || 0;
    if (this._accumulator < 0.2) return;
    this._accumulator = 0;

    if (this._victoryFired) return;
    this._checkZhangjiaoFallen();
    if (this._victoryFired) return;
    const boss = this.scene.entityStore?.getById?.(RAID.bossId) || null;
    // 傅燮死亡后实体可能已从敌人表移除（getById 返回 null），因此「已登场且取不到/已死」即斩将
    if (raid.bossSpawned && (!boss || !this._isAlive(boss))) {
      this._victory('傅燮阵亡');
      return;
    }

    const alive = this._countAlive('S02-raid-legion');
    if (alive === 0 && raid.defeated === 0 && raid.reserve === RAID.total - RAID.screenCap) {
      // 场上先头尚未落地：等 placement 生成，不补员也不计阵亡
      return;
    }
    if (alive > this._lastAlive) this._lastAlive = alive;
    if (alive < this._lastAlive) {
      const deaths = this._lastAlive - alive;
      raid.defeated += deaths;
      this._lastAlive = alive;
      this._maybeSpawnBoss(raid);
    }

    if (raid.reserve > 0 && alive < RAID.screenCap) {
      const spawnCount = Math.min(RAID.screenCap - alive, raid.reserve);
      for (let index = 0; index < spawnCount; index += 1) this._spawnSoldier(raid.defeated + index);
      raid.reserve -= spawnCount;
      this._lastAlive = alive + spawnCount;
    }

    if (raid.defeated >= RAID.total) {
      this._victory('一千官军尽没');
    }
  }

  /** 失败收尾（由任务 raidDefeat 分支调用）：停补员、清场、写失败事实。 */
  defeat(reason = '阵线崩溃') {
    this._defeat(reason);
    return { ok: true };
  }

  _countAlive(prefix) {
    let alive = 0;
    for (const entity of this.scene.entityStore?.enemies || []) {
      if (!String(entity?.placementId || '').startsWith(prefix)) continue;
      if (this._isAlive(entity)) alive += 1;
    }
    return alive;
  }

  _maybeSpawnBoss(raid) {
    if (raid.bossSpawned || raid.defeated < RAID.bossThreshold) return;
    raid.bossSpawned = true;
    this._spawnBoss();
    this._submit('story.s02.raid.boss.spawned');
    this._tip('官军阵中竖起了大纛——傅燮亲率八名护兵压阵而来。斩将，则余部自溃！', '傅燮登场');
  }

  _spawnDefinition(ref) {
    const definition = this.scene.gameLoader?.getRegistry?.('enemies')?.get?.(ref);
    if (!definition || typeof this.scene.entityFactory?.createEnemy !== 'function') return null;
    return definition;
  }

  _spawnSoldier(index) {
    const definition = this._spawnDefinition(RAID.soldierId);
    if (!definition) return null;
    const offset = this._offset();
    const entry = RAID.entries[index % RAID.entries.length];
    const jitter = (index % 7) * 14;
    const entity = this.scene.entityFactory.createEnemy({
      ...JSON.parse(JSON.stringify(definition)),
      id: `S02-raid-legion-r${++this.sequence}`,
      contentId: definition.id,
      templateId: definition.templateId || definition.id,
      position: { x: entry.x + (offset.x || 0) + jitter, y: entry.y + (offset.y || 0) + jitter },
      faction: RAID.faction
    });
    if (!entity) return null;
    entity.placementId = 'S02-raid-legion';
    entity.faction = RAID.faction;
    if (typeof this.scene.entityStore?.addEnemy === 'function') this.scene.entityStore.addEnemy(entity);
    else this.scene.entityStore?.add?.(entity);
    this.scene.aiSystem?.activateAI?.(entity, entity.aiType || 'aggressive');
    return entity;
  }

  _spawnBoss() {
    const definition = this._spawnDefinition('enemy.s02_lu_commander');
    if (!definition) return null;
    const offset = this._offset();
    const position = { x: 110 + (offset.x || 0), y: 280 + (offset.y || 0) };
    const boss = this.scene.entityFactory.createEnemy({
      ...JSON.parse(JSON.stringify(definition)),
      id: RAID.bossId,
      contentId: definition.id,
      templateId: definition.templateId || definition.id,
      position,
      faction: RAID.faction
    });
    if (boss) {
      boss.placementId = RAID.bossId;
      boss.faction = RAID.faction;
      if (typeof this.scene.entityStore?.addEnemy === 'function') this.scene.entityStore.addEnemy(boss);
      else this.scene.entityStore?.add?.(boss);
      this.scene.aiSystem?.activateAI?.(boss, boss.aiType || 'aggressive');
    }
    for (let index = 0; index < 8; index += 1) {
      const guardDefinition = this._spawnDefinition(RAID.soldierId);
      if (!guardDefinition) break;
      const angle = (Math.PI * 2 * index) / 8;
      const guard = this.scene.entityFactory.createEnemy({
        ...JSON.parse(JSON.stringify(guardDefinition)),
        id: `${RAID.guardPrefix}-${index + 1}`,
        contentId: guardDefinition.id,
        templateId: guardDefinition.templateId || guardDefinition.id,
        position: {
          x: position.x + Math.cos(angle) * 46,
          y: position.y + Math.sin(angle) * 46
        },
        faction: RAID.faction
      });
      if (!guard) continue;
      guard.placementId = `${RAID.guardPrefix}-${index + 1}`;
      guard.faction = RAID.faction;
      if (typeof this.scene.entityStore?.addEnemy === 'function') this.scene.entityStore.addEnemy(guard);
      else this.scene.entityStore?.add?.(guard);
      this.scene.aiSystem?.activateAI?.(guard, guard.aiType || 'aggressive');
    }
    return boss;
  }

  /**
   * 围剿中张角倒下（①）：加入线走「出师未捷身先死」结局；不加入线重伤退场、不判负。
   * 主角阵亡走任务 raidDefeat 分支（②），不在此处触发结局。
   */
  async _checkZhangjiaoFallen() {
    if (this._zhangjiaoFallen === true) return;
    const zhangjiao = this.scene.s02ArmyRescueCoordinator?._zhangjiaoEntity;
    if (!zhangjiao || (zhangjiao.isDead !== true && zhangjiao.isDying !== true)) return;
    this._zhangjiaoFallen = true;
    this._submit('story.s02.zhangjiao.fallen');
    const joined = this._story().s02AllegianceJoined === true;
    if (joined) {
      this._victoryFired = true;
      if (this.raid) this.raid.active = false;
      this._clearRaidField();
      const endingCandidates = [this.scene.s11S14SceneFlow, this.scene.s11s14SceneCoordinator];
      let committed = false;
      for (const endingCoordinator of endingCandidates) {
        if (typeof endingCoordinator?.executeEndingCommand !== 'function') continue;
        try {
          committed = await endingCoordinator.executeEndingCommand({
            endingId: 'sanguo-zhangjiao-endings-v1',
            endingKey: 'expedition-failed',
            operation: 'commit',
            checkpointId: 'checkpoint.S02.ending.expeditionFailed'
          }) === true;
        } catch {
          committed = false;
        }
        if (committed) break;
      }
      if (!committed) {
        this.scene.endingFlowCoordinator?.commitEndingById?.('expedition-failed', {
          checkpointId: 'checkpoint.S02.ending.expeditionFailed'
        });
      }
      this._tip('张角力战而亡——「出师未捷身先死」。', '围剿');
      return;
    }
    // 不加入线：重伤退场，官军仍在压上，主线不判负
    zhangjiao.plotDowned = true;
    zhangjiao.getComponent?.('sprite')?.playAnimation?.('stretcher');
    const movement = zhangjiao.getComponent?.('movement');
    if (movement) movement.velocity = { x: 0, y: 0 };
    this._tip('张角力战重伤，被亲兵抬下战场。官军仍在压上——守住营地。', '围剿');
  }

  /** 斩将后清场：场上余部（含补员动态生成、不入 placement 账本的单位）一并溃散离场。 */
  _clearRaidField() {
    const store = this.scene.entityStore;
    const stragglers = (store?.enemies || []).filter(entity => {
      const id = String(entity?.placementId || '');
      return id.startsWith('S02-raid-legion') || id === RAID.bossId || id.startsWith(RAID.guardPrefix);
    });
    if (typeof store?.removeMany === 'function') store.removeMany(stragglers);
    else for (const entity of stragglers) store?.remove?.(entity);
    this.scene.context?.services?.placements?.despawn?.({ group: 'S02-raid-legion' });
  }

  _victory(reason) {
    if (this._victoryFired) return;
    this._victoryFired = true;
    if (this.raid) this.raid.active = false;
    this._clearRaidField();
    this._submit('story.s02.raid.repeled');
    this._tip(`${reason}——官军大纛倒下，余部丢盔弃甲，四散溃逃。`, '围剿结束');
  }

  _defeat(reason) {
    if (this._defeatFired) return;
    this._defeatFired = true;
    if (this.raid) this.raid.active = false;
    this._clearRaidField();
    this._submit('story.s02.raid.defeat');
    this._tip(`${reason}。营地被破，张角带残部转移——主线未断，来日再战。`, '围剿失败');
  }
}

export default S02BattleFlow;
