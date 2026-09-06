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
 * 三国张角传 - P3.2 批次 C：S05 宛城外围场景编排
 ************************************************************/

import { SceneFlowCoordinator } from '../../../src/core/scene/SceneFlowCoordinator.js';
import { BattleMode, BattleState } from '../../../src/systems/BattleSystem.js';
import { RescueStatus } from '../../../src/systems/RescueSystem.js';
import { S04_BOCAI_RESCUE_ID } from './S03S08SceneFlow.js';

export const S05_BATTLE_ID = 'battle.s05_wancheng_outskirts';
export const S05_ZHANG_MANCHENG_RESCUE_ID = 'rescue.s05.zhangMancheng';

const cloneData = value => value == null ? value : JSON.parse(JSON.stringify(value));

const s05Methods = {
  _prepareS05MineGatheringSettlement(context = {}) {
    const { operationId, nodeEntity, node, inventory, tool } = context;
    const blackboard = this.gameLoader?.blackboard;
    const storyBefore = cloneData(blackboard?.get?.('storyState') || {});
    const mineState = storyBefore.s05Mine || {};
    if (!blackboard || nodeEntity?.id !== 'S05-iron-ore') return { ok: false, code: 'invalidS05MineNode' };
    if (mineState.prepared !== true) return { ok: false, code: 's05MineNotPrepared' };
    if (mineState.collapseCommitted === true) return { ok: false, code: 's05MineCollapsed' };
    if (!tool || tool.toolType !== 'pickaxe' || Number(tool.durability) !== 1) {
      return { ok: false, code: 's05WornPickaxeRequired' };
    }
    if (!operationId || this._s05MinePendingSettlements.has(operationId)) {
      return { ok: false, code: 's05MineSettlementBusy' };
    }

    const inventoryBefore = inventory?.exportItems?.();
    const nodeBefore = node.serialize?.();
    if (!inventoryBefore || !nodeBefore) return { ok: false, code: 's05MineSnapshotUnavailable' };
    return {
      ok: true,
      commit: ({ accepted }) => {
        if (Number(tool.durability) !== 0 || Number(accepted) <= 0) {
          throw new Error('s05PickaxeDidNotBreak');
        }
        const draftStory = {
          ...storyBefore,
          s05Mine: {
            ...mineState,
            prepared: true,
            status: 'collapsed',
            toolBroken: true,
            collapseCommitted: true,
            ambushActivated: true,
            retreatCompleted: false,
            gatheredIron: Math.max(0, Number(mineState.gatheredIron) || 0) + Number(accepted),
            settlementOperationId: operationId
          },
          lastCheckpointId: 'checkpoint.S05.mineCollapse'
        };
        blackboard.set('storyState', draftStory);
        this._s05MinePendingSettlements.set(operationId, {
          storyBefore, inventory, inventoryBefore, node, nodeBefore,
          inventoryOperationId: `${operationId}:settle`
        });
        return { ok: true };
      },
      rollback: () => {
        blackboard.set('storyState', storyBefore);
        this._s05MinePendingSettlements.delete(operationId);
      }
    };
  },

  async _finalizeS05MineCollapse(data = {}) {
    const operationId = data.operationId;
    const pending = this._s05MinePendingSettlements.get(operationId);
    if (!pending || this._s05MineBusy) return false;
    this._s05MineBusy = true;
    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: 'checkpoint.S05.mineCollapse', sceneId: 'S05'
      });
      if (!saved?.ok) throw new Error(saved?.message || 'checkpointFailed');
      this._s05MinePendingSettlements.delete(operationId);
      await this._syncS05MineWorldState();
      this._grantGatheringProficiency(data);
      this._showScreenTip(
        '鹤嘴镐已经折断，碎石封住近路，官军伏兵同时现身。带着铁矿无法开路，只能前往西侧撤退区徒手突围。',
        { title: '矿坑塌方' }
      );
      return true;
    } catch (error) {
      this.gameLoader?.blackboard?.set?.('storyState', pending.storyBefore);
      pending.inventory?.loadItems?.(pending.inventoryBefore);
      pending.node?.deserialize?.(pending.nodeBefore);
      this.gatheringSystem?.completedOperations?.delete?.(operationId);
      this.inventoryTransactions?.forgetOperation?.(pending.inventoryOperationId);
      this._s05MinePendingSettlements.delete(operationId);
      this._showScreenTip(`矿坑检查点失败：${error?.message || error}。铁矿、工具、节点与剧情状态已回滚，可重新尝试。`, {
        title: '保存失败'
      });
      return false;
    } finally {
      this._s05MineBusy = false;
    }
  },

  async prepareS05Mine() {
    if (this.currentSceneId !== 'S05' || this._s05MineBusy) return false;
    const blackboard = this.gameLoader?.blackboard;
    const beforeStory = cloneData(blackboard?.get?.('storyState') || {});
    const existing = beforeStory.s05Mine || {};
    if (existing.prepared === true) {
      this.showS05MineStatus();
      return true;
    }
    const placements = this.context.services.placements?.getPlacements?.() || [];
    const nodePlacement = placements.find(entry => entry.id === 'S05-iron-ore');
    const toolPlacement = placements.find(entry => entry.id === 'S05-worn-pickaxe');
    if (!blackboard || !nodePlacement || !toolPlacement) {
      this._showScreenTip('矿坑铁矿或破旧铁镐配置缺失。', { title: '矿坑不可用' });
      return false;
    }
    this._s05MineBusy = true;
    blackboard.set('storyState', {
      ...beforeStory,
      s05Mine: {
        ...existing,
        prepared: true,
        status: 'prepared',
        toolBroken: false,
        collapseCommitted: false,
        ambushActivated: false,
        retreatCompleted: false,
        gatheredIron: 0,
        ironDiscarded: 0
      },
      lastCheckpointId: 'checkpoint.S05.minePrepared'
    });
    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: 'checkpoint.S05.minePrepared', sceneId: 'S05'
      });
      if (!saved?.ok) throw new Error(saved?.message || 'checkpointFailed');
      await this.context.services.placements?.spawn({
        placementIds: ['S05-worn-pickaxe', 'S05-iron-ore']
      });
      this._showScreenTip('矿坑边只剩一把耐久 1 的破旧铁镐。拾取后采下一批铁矿；镐一旦折断，近路会被塌方封死。', {
        title: '矿坑准备完成'
      });
      return true;
    } catch (error) {
      blackboard.set('storyState', beforeStory);
      this._showScreenTip(`矿坑准备失败：${error?.message || error}，剧情状态已回滚。`, { title: '保存失败' });
      return false;
    } finally {
      this._s05MineBusy = false;
    }
  },

  showS05MineStatus() {
    if (this.currentSceneId !== 'S05') return false;
    const mine = this.gameLoader?.blackboard?.get?.('storyState')?.s05Mine || {};
    const inventory = this.playerEntity?.getComponent?.('inventory');
    const hasPickaxe = (inventory?.slots || []).some(stack => (
      stack?.item?.id === 'tool.worn_pickaxe' && Number(stack.item.durability) > 0
    ));
    if (mine.prepared !== true) {
      this._showScreenTip('先检查矿坑入口，确认铁镐、塌方风险与撤退路线。', { title: '矿坑尚未准备' });
    } else if (mine.collapseCommitted !== true) {
      this._showScreenTip(
        hasPickaxe ? '靠近铁矿使用 {harvest} 开采。破旧铁镐只够完成一次结算。' : '先拾取矿坑边的破旧铁镐。',
        { title: '矿坑开采' }
      );
    } else if (mine.retreatCompleted !== true) {
      this._showScreenTip('近路已被碎石封死，官军伏兵已激活。前往西侧撤退区，丢下本次铁矿后徒手撤退。', {
        title: '必须撤退'
      });
    } else {
      this._showScreenTip('矿坑撤退已完成。现在可以介入宛城外围战役并救援张曼成。', { title: '矿坑事件完成' });
    }
    return true;
  },

  async completeS05MineRetreat() {
    if (this.currentSceneId !== 'S05' || this._s05MineBusy) return false;
    const blackboard = this.gameLoader?.blackboard;
    const beforeStory = cloneData(blackboard?.get?.('storyState') || {});
    const mine = beforeStory.s05Mine || {};
    if (mine.retreatCompleted === true) {
      this._showScreenTip('你已经从塌方矿坑撤出，本次铁矿不会重复丢弃。', { title: '撤退已完成' });
      return true;
    }
    if (mine.collapseCommitted !== true || mine.ambushActivated !== true) {
      this._showScreenTip('铁镐尚未损毁，当前不需要从矿坑徒手撤退。', { title: '撤退条件未满足' });
      return false;
    }
    const inventory = this.playerEntity?.getComponent?.('inventory');
    if (!blackboard || !inventory || this.gatheringSystem?.isActive?.()) return false;
    const inventoryBefore = inventory.exportItems?.();
    const discardRequested = Math.max(0, Math.floor(Number(mine.gatheredIron) || 0));
    const discardQuantity = discardRequested > 0
      ? this.inventoryTransactions.previewRemove(inventory, 'resource.iron', discardRequested).accepted
      : 0;
    const operationId = 'story:S05:mine-retreat';
    let removal = { ok: true, accepted: 0 };
    if (discardQuantity > 0) {
      removal = this.inventoryTransactions.commit({
        type: 'remove', inventory, itemId: 'resource.iron', quantity: discardQuantity,
        allowPartial: false, operationId
      });
      if (!removal.ok) return false;
    }
    blackboard.set('storyState', {
      ...beforeStory,
      s05Mine: {
        ...mine,
        status: 'retreated',
        retreatCompleted: true,
        ironDiscarded: removal.accepted || 0,
        retreatOperationId: operationId
      },
      lastCheckpointId: 'checkpoint.S05.mineRetreat'
    });
    this._s05MineBusy = true;
    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: 'checkpoint.S05.mineRetreat', sceneId: 'S05'
      });
      if (!saved?.ok) throw new Error(saved?.message || 'checkpointFailed');
      this._showScreenTip(
        `你丢下 ${removal.accepted || 0} 份铁矿，从伏兵夹缝中徒手撤出。矿坑近路永久关闭，张曼成救援入口已经开放。`,
        { title: '徒手撤退完成' }
      );
      return true;
    } catch (error) {
      inventory.loadItems?.(inventoryBefore);
      blackboard.set('storyState', beforeStory);
      if (discardQuantity > 0) this.inventoryTransactions.forgetOperation?.(operationId);
      this._showScreenTip(`撤退检查点失败：${error?.message || error}，库存与剧情状态已回滚。`, { title: '保存失败' });
      return false;
    } finally {
      this._s05MineBusy = false;
    }
  },

  async _syncS05MineWorldState() {
    const mine = this.gameLoader?.blackboard?.get?.('storyState')?.s05Mine || {};
    const collapsed = mine.collapseCommitted === true;
    const placement = (this.context.services.placements?.getPlacements?.() || [])
      .find(entry => entry.id === 'S05-mine-collapse');
    const collider = placement?.overrides?.collision;
    if (placement && collider) {
      this._terrainBinding?.setDynamicCollider?.({
        sceneId: 'S05', id: 'S05-mine-collapse', enabled: collapsed,
        shape: {
          type: 'rect',
          x: Number(placement.x) + Number(collider.x),
          y: Number(placement.y) + Number(collider.y),
          width: Number(collider.width),
          height: Number(collider.height)
        }
      });
    }
    if (!collapsed || this.currentSceneId !== 'S05') return collapsed;
    await this.context.services.placements?.spawn({ group: 'S05-mine-collapse' });
    await this.context.services.placements?.spawn({ group: 'S05-mine-ambush' });
    for (const enemy of this._groupEnemies?.['S05-mine-ambush'] || []) {
      if (!this._isEntityDead(enemy)) this.aiSystem?.activateAI?.(enemy, enemy.aiType || 'aggressive');
    }
    return true;
  },

  startS05ZhangManchengRescue() {
    const battleCoordinator = this.s03s14BattleCoordinator;
    const rescueDefinition = battleCoordinator?.getRescueDefinition?.(S05_ZHANG_MANCHENG_RESCUE_ID);
    const battleSession = battleCoordinator?.getSessionState?.() || {};
    if (this.currentSceneId !== 'S05' || !this.rescueSystem || !rescueDefinition) {
      this._showScreenTip('张曼成救援只可在 S05 宛城外围启动。', { title: '救援不可用' });
      return false;
    }
    if (battleSession.mode !== BattleMode.INTERVENE
      || battleSession.battleId !== S05_BATTLE_ID
      || battleSession.state !== BattleState.ACTIVE
      || battleSession.battlefieldActive !== true) {
      this._showScreenTip('先在宛城外围战役选择介入并让实时战场进入进行中状态。', { title: '救援不可用' });
      return false;
    }
    const mineState = this.gameLoader?.blackboard?.get?.('storyState')?.s05Mine || {};
    if (mineState.retreatCompleted !== true) {
      this._showScreenTip('必须先经历铁镐损毁、矿坑塌方与徒手撤退，才能赶到张曼成身边。', { title: '救援路线尚未打通' });
      return false;
    }
    const zhangMancheng = (this.entities || []).find(entity => entity?.id === 'S05-zhang-mancheng');
    const qinJie = (this.entities || []).find(entity => entity?.id === 'S05-qin-jie');
    if (!zhangMancheng || !qinJie) {
      this._showScreenTip('张曼成或秦颉实体尚未生成，无法启动致命一击事件。', { title: '救援配置错误' });
      return false;
    }

    const existing = this.rescueSystem.getState();
    if (existing.status !== RescueStatus.IDLE) {
      if (existing.definitionId === S05_ZHANG_MANCHENG_RESCUE_ID) {
        battleCoordinator.setRescueObjectiveTitle(S05_ZHANG_MANCHENG_RESCUE_ID);
        this.rescueObjectiveView?.setSnapshot?.(existing);
        this._showScreenTip(
          existing.status === RescueStatus.ACTIVE ? '张曼成救援正在进行。' : '张曼成救援结果已经冻结。',
          { title: '救援状态' }
        );
        return true;
      }
      const storyState = this.gameLoader?.blackboard?.get?.('storyState') || {};
      const s04Persisted = !!storyState.rescueResults?.[S04_BOCAI_RESCUE_ID];
      const s04Terminal = existing.definitionId === S04_BOCAI_RESCUE_ID
        && [RescueStatus.SUCCEEDED, RescueStatus.FAILED].includes(existing.status);
      if (s04Terminal && s04Persisted) {
        this.rescueSystem.reset();
      } else {
        this._showScreenTip(
          existing.status === RescueStatus.ACTIVE
            ? '上一项救援仍在进行，不能启动张曼成救援。'
            : '上一项救援结果尚未写入检查点，不能切换救援目标。',
          { title: '救援状态冲突' }
        );
        return false;
      }
    }

    const started = this.rescueSystem.start(rescueDefinition, {
      mode: battleSession.mode,
      operationId: `start:${S05_ZHANG_MANCHENG_RESCUE_ID}`
    });
    if (!started.ok) {
      this._showScreenTip(`救援未启动：${started.message || started.code}`, { title: '救援失败' });
      return false;
    }
    battleCoordinator.setRescueObjectiveTitle(S05_ZHANG_MANCHENG_RESCUE_ID);
    this.rescueObjectiveView?.setSnapshot?.(started.state);
    this._showScreenTip('60 秒内以远程攻击、远程技能或投掷命中秦颉，打断对张曼成的致命一击。', {
      title: '张曼成限时救援'
    });
    return true;
  },

  _handleS05CombatDamage(event = {}) {
    const rescueState = this.rescueSystem?.getState?.();
    if (this.currentSceneId !== 'S05'
      || rescueState?.definitionId !== S05_ZHANG_MANCHENG_RESCUE_ID
      || rescueState.status !== RescueStatus.ACTIVE
      || event.target?.id !== 'S05-qin-jie'
      || event.sourceEntityId !== this.playerEntity?.id
      || !['ranged', 'skill-ranged', 'throw'].includes(event.attackKind)) return false;
    const beforeRescueState = this.rescueSystem.serialize();
    const outcome = this.rescueSystem.completeStage('interrupt-lethal-strike', {
      operationId: `complete:${S05_ZHANG_MANCHENG_RESCUE_ID}:interrupt-lethal-strike`
    });
    this.s03s14BattleCoordinator.setRescueObjectiveTitle(S05_ZHANG_MANCHENG_RESCUE_ID);
    this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem.getState());
    if (!outcome?.completed || !outcome.result) return false;
    void this._settleS05ZhangManchengRescue(outcome.result, beforeRescueState);
    return true;
  },

  _updateS05ZhangManchengRescue(deltaTime) {
    const rescueState = this.rescueSystem?.getState?.();
    if (this.currentSceneId !== 'S05'
      || rescueState?.definitionId !== S05_ZHANG_MANCHENG_RESCUE_ID
      || rescueState.status !== RescueStatus.ACTIVE
      || this._s05RescueBusy) return;
    const targetId = this.s03s14BattleCoordinator
      ?.getRescueDefinition?.(S05_ZHANG_MANCHENG_RESCUE_ID)?.targetEntityId;
    const target = (this.entities || []).find(entity => entity?.id === targetId);
    const stats = target?.getComponent?.('stats');
    const beforeRescueState = this.rescueSystem.serialize();
    let outcome;
    let targetHpRollback = null;
    if (!target || !stats || Number(stats.hp) <= 0) {
      outcome = this.rescueSystem.fail('targetDefeated', {
        operationId: `fail:${S05_ZHANG_MANCHENG_RESCUE_ID}:target`
      });
    } else {
      outcome = this.rescueSystem.update();
      if (outcome?.completed && outcome.result?.failureReason === 'deadlineExceeded') {
        targetHpRollback = { targetId, hp: Number(stats.hp) };
        const qinJie = (this.entities || []).find(entity => entity?.id === 'S05-qin-jie');
        this.combatSystem?.applyDamage?.(
          target,
          Math.max(1, Number(stats.hp)),
          null,
          '致命一击',
          { sourceEntity: qinJie || null, attackKind: 'scripted-lethal', deferDeathEffects: true }
        );
      }
    }
    this.s03s14BattleCoordinator.setRescueObjectiveTitle(S05_ZHANG_MANCHENG_RESCUE_ID);
    this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem.getState());
    if (outcome?.completed && outcome.result) {
      void this._settleS05ZhangManchengRescue(outcome.result, beforeRescueState, targetHpRollback);
    }
  },

  async _settleS05ZhangManchengRescue(result, beforeRescueState, targetHpRollback = null) {
    if (this._s05RescueBusy || result?.rescueId !== S05_ZHANG_MANCHENG_RESCUE_ID) return false;
    this._s05RescueBusy = true;
    const blackboard = this.gameLoader?.blackboard;
    const beforeStory = cloneData(blackboard?.get?.('storyState') || {});
    const survived = result.survived === true;
    const storyTags = new Set(beforeStory.storyTags || []);
    storyTags.delete(survived ? 'rescue.zhangMancheng.failed' : 'rescue.zhangMancheng.survived');
    storyTags.add(survived ? 'rescue.zhangMancheng.survived' : 'rescue.zhangMancheng.failed');
    const draftStory = {
      ...beforeStory,
      rescueResults: {
        ...(beforeStory.rescueResults || {}),
        [S05_ZHANG_MANCHENG_RESCUE_ID]: cloneData(result)
      },
      zhangManchengSurvived: survived,
      wanchengDefenseExtendedMonths: survived
        ? Math.max(1, Number(beforeStory.wanchengDefenseExtendedMonths) || 0)
        : Math.max(0, Number(beforeStory.wanchengDefenseExtendedMonths) || 0),
      s06AvailableUntilMonth: survived ? 9 : (beforeStory.s06AvailableUntilMonth || null),
      unlockedScenes: survived
        ? [...new Set([...(beforeStory.unlockedScenes || []), 'S06'])]
        : [...(beforeStory.unlockedScenes || [])],
      storyTags: [...storyTags],
      lastCheckpointId: 'checkpoint.S05.zhangManchengRescue'
    };
    try {
      if (!blackboard) throw new Error('storyStateUnavailable');
      blackboard.set('storyState', draftStory);
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: 'checkpoint.S05.zhangManchengRescue', sceneId: 'S05'
      });
      if (!saved?.ok) throw new Error(saved?.message || 'checkpointFailed');
      if (!survived && targetHpRollback) {
        const defeatedTarget = (this.entities || []).find(entity => entity?.id === targetHpRollback.targetId);
        if (defeatedTarget && !defeatedTarget.isDying && !defeatedTarget.isDead) {
          this.combatSystem?.spawnLoot?.(defeatedTarget);
          this.combatSystem?.triggerDeathEffect?.(defeatedTarget);
        }
      }
      this.s03s14BattleCoordinator.setRescueObjectiveTitle(S05_ZHANG_MANCHENG_RESCUE_ID);
      this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem.getState());
      this._showScreenTip(
        survived
          ? '你远程打断了秦颉的致命一击，张曼成存活，S06 宛城围攻已经开放。'
          : '张曼成未能撑过 60 秒，宛城围攻路线未开放。',
        { title: survived ? '救援成功' : '救援失败' }
      );
      return true;
    } catch (error) {
      blackboard?.set?.('storyState', beforeStory);
      const restored = this.rescueSystem.deserialize(beforeRescueState);
      if (targetHpRollback && Number.isFinite(targetHpRollback.hp)) {
        const target = (this.entities || []).find(entity => entity?.id === targetHpRollback.targetId);
        const stats = target?.getComponent?.('stats');
        if (stats) stats.hp = targetHpRollback.hp;
      }
      this.s03s14BattleCoordinator.setRescueObjectiveTitle(S05_ZHANG_MANCHENG_RESCUE_ID);
      this.rescueObjectiveView?.setSnapshot?.(restored?.state || this.rescueSystem.getState());
      this._showScreenTip(`张曼成救援检查点失败：${error?.message || error}，剧情、救援与生命值已回滚。`, {
        title: '保存失败'
      });
      return false;
    } finally {
      this._s05RescueBusy = false;
    }
  },

  async checkS05Exit() {
    if (this.currentSceneId !== 'S05') {
      this._showScreenTip('只有在 S05 宛城外围才能前往宛城围攻。', { title: '出口不可用' });
      return false;
    }
    const blackboard = this.gameLoader?.blackboard;
    const battleResult = blackboard?.get?.('warState')?.battles?.[S05_BATTLE_ID];
    if (!battleResult) {
      this._showScreenTip('先完成宛城外围战役并冻结战果。', { title: '战役尚未完成' });
      return false;
    }
    const appliedResultIds = blackboard?.get?.('appliedBattleResultIds') || [];
    if (!battleResult.resultId || !appliedResultIds.includes(battleResult.resultId)) {
      this._showScreenTip('宛城外围战果尚未成功写入检查点，请在军令旗处重试结算。', { title: '战果尚未应用' });
      return false;
    }
    const rescueResult = blackboard?.get?.('storyState')?.rescueResults?.[S05_ZHANG_MANCHENG_RESCUE_ID];
    if (rescueResult?.survived !== true) {
      this._showScreenTip('只有张曼成救援成功并保存后，才能延长战线进入 S06。', { title: '宛城围攻未开放' });
      return false;
    }
    const targetChunk = this._worldLoadSession?.getChunk?.('S06');
    const targetSpawn = this._worldLoadSession?.findSpawn?.('S06', 'player');
    if (!targetChunk || !targetSpawn) {
      this._showScreenTip('S06 区块或玩家出生点缺失。', { title: '宛城围攻路线不可用' });
      return false;
    }
    try {
      const transition = await this.teleportToChunk({ scene: 'S06', spawnRef: 'player', transition: 'fadeBlack' });
      if (transition === false || transition?.cancelled) throw new Error('sceneTransitionCancelled');
      this.s03s14BattleCoordinator.closeUi();
      this.rescueObjectiveView?.clear?.();
      this._showScreenTip('张曼成率余部延长战线，你已抵达宛城城下。', { title: 'S06·宛城围攻' });
      return true;
    } catch (error) {
      this._showScreenTip(`前往宛城围攻失败：${error?.message || error}`, { title: '场景切换失败' });
      return false;
    }
  }
};

export class S05SceneCoordinator extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, s05Methods, { name: 'S05SceneCoordinator' });
  }
}

export default S05SceneCoordinator;