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
 * 三国张角传 - P3 S03–S08 场景流程编排
 *
 * 只承载历史剧情、UI 与场景切换编排。Battle/CityWar/Rescue
 * 领域系统及其共享装配仍由场景组合根注入。
 ************************************************************/

import { SceneFlowCoordinator } from '../../../src/core/scene/SceneFlowCoordinator.js';
import { BattleMode } from '../../../src/systems/BattleSystem.js';
import { RescueStatus } from '../../../src/systems/RescueSystem.js';
import { S04_ROUTE_CONFIGS } from './S04RouteCoordinator.js';

export const S03_BATTLE_ID = 'battle.s03.yingchuan';
export const S04_BOCAI_RESCUE_ID = 'rescue.s04.bocai';

const cloneData = value => value == null ? value : JSON.parse(JSON.stringify(value));

const s03s08Methods = {
  async travelToS03() {
    if (this.currentSceneId !== 'S09') {
      return { ok: false, errors: [{ code: 'wrongScene', path: 'currentSceneId', message: '只能从 S09 出征颍川' }] };
    }
    const storyState = this.gameLoader?.blackboard?.get?.('storyState');
    if (storyState?.joinedYellowTurban !== true || storyState?.classSelectionCommitted !== true) {
      this._showScreenTip('加入黄巾并确认职业后，才能持军令出征颍川', { title: '出征条件不足' });
      return { ok: false, errors: [{
        code: 's03PrerequisiteMissing', path: 'storyState.classSelectionCommitted', message: 'S03 需要完成入伍和职业确认'
      }] };
    }
    const regionIndex = this._findRegionIndexForScene('S03');
    if (regionIndex < 0) {
      return { ok: false, errors: [{ code: 'missingTargetScene', path: 'worldMap', message: '世界地图未登记 S03' }] };
    }
    return this.travelToRegion({ regionIndex, sceneId: 'S03', spawnRef: 'player' });
  },

  async checkS03Exit() {
    if (this.currentSceneId !== 'S03') return false;
    const resolved = this.gameLoader?.blackboard?.get?.('warState')?.battles?.[S03_BATTLE_ID];
    if (!resolved) {
      this._showScreenTip('先在中央军令旗确认观战或介入，并完成颍川战果结算', { title: '战役尚未完成' });
      return false;
    }
    const targetChunk = this._worldLoadSession?.getChunk?.('S04');
    const targetSpawn = this._worldLoadSession?.findSpawn?.('S04', 'player');
    if (!targetChunk || !targetSpawn) {
      this._showScreenTip('S04 区块或玩家出生点缺失', { title: '长社路线不可用' });
      return false;
    }
    const blackboard = this.gameLoader?.blackboard;
    const beforeStory = cloneData(blackboard?.get?.('storyState') || {});
    blackboard?.set?.('storyState', {
      ...beforeStory,
      unlockedScenes: [...new Set([...(beforeStory.unlockedScenes || []), 'S04'])]
    });
    try {
      const result = await this.teleportToChunk({ scene: 'S04', spawnRef: 'player', transition: 'fadeBlack' });
      if (result === false || result?.cancelled) throw new Error('sceneTransitionCancelled');
      this.s03s14BattleCoordinator.closeUi();
      this._showScreenTip('已抵达五月的长社战场。', { title: 'S04·长社战场' });
      return true;
    } catch (error) {
      blackboard?.set?.('storyState', beforeStory);
      this._showScreenTip(`前往长社失败：${error?.message || error}`, { title: '场景切换失败' });
      return false;
    }
  },

  startS04BocaiRescue() {
    const battleCoordinator = this.s03s14BattleCoordinator;
    const rescueDefinition = battleCoordinator?.getRescueDefinition?.(S04_BOCAI_RESCUE_ID);
    const battleSession = battleCoordinator?.getSessionState?.() || {};
    if (this.currentSceneId !== 'S04' || !this.rescueSystem || !rescueDefinition) return false;
    battleCoordinator.setRescueObjectiveTitle(S04_BOCAI_RESCUE_ID);
    if (battleSession.mode !== BattleMode.INTERVENE) {
      this._showScreenTip('只有在长社战役选择介入后才能启动波才救援。', { title: '救援不可用' });
      return false;
    }
    const existing = this.rescueSystem.getState();
    if (existing.status !== RescueStatus.IDLE) {
      this.rescueObjectiveView?.setSnapshot?.(existing);
      this._showScreenTip(
        existing.status === RescueStatus.ACTIVE ? '波才救援正在进行。' : '波才救援结果已经冻结。',
        { title: '救援状态' }
      );
      return true;
    }
    const targetId = rescueDefinition.targetEntityId;
    const target = (this.entities || []).find(entity => entity?.id === targetId);
    if (!target) {
      this._showScreenTip(`救援目标 ${targetId} 尚未生成`, { title: '救援配置错误' });
      return false;
    }
    const started = this.rescueSystem.start(rescueDefinition, {
      mode: battleSession.mode,
      operationId: `start:${S04_BOCAI_RESCUE_ID}`
    });
    if (!started.ok) {
      this._showScreenTip(`救援未启动：${started.message || started.code}`, { title: '救援失败' });
      return false;
    }
    this.rescueObjectiveView?.setSnapshot?.(started.state);
    this._showScreenTip('90 秒计时开始。靠近波才后向东侧绿色撤离区移动。', { title: '护送波才' });
    return true;
  },

  completeS04BocaiEvacuation() {
    if (this.currentSceneId !== 'S04' || this.rescueSystem?.status !== RescueStatus.ACTIVE) return false;
    const definition = this.s03s14BattleCoordinator?.getRescueDefinition?.(S04_BOCAI_RESCUE_ID);
    const target = (this.entities || []).find(entity => entity?.id === definition?.targetEntityId);
    const evacuation = this._worldLoadSession?.findSpawn?.('S04', definition?.evacuationRef);
    const transform = target?.getComponent?.('transform');
    if (!transform || !evacuation) return false;
    const dx = transform.position.x - evacuation.x;
    const dy = transform.position.y - evacuation.y;
    if (Math.hypot(dx, dy) > Number(definition.evacuationRadius)) {
      this._showScreenTip('波才尚未进入东侧撤离点，请继续护送。', { title: '撤离未完成' });
      return false;
    }
    const before = this.rescueSystem.serialize();
    const outcome = this.rescueSystem.completeStage('escort-east', {
      operationId: `complete:${S04_BOCAI_RESCUE_ID}:escort-east`
    });
    if (!outcome?.completed) return false;
    void this._settleS04BocaiRescue(outcome.result, before);
    return true;
  },

  _updateS04BocaiRescue(deltaTime) {
    if (this.currentSceneId !== 'S04' || this.rescueSystem?.status !== RescueStatus.ACTIVE || this._s04RescueBusy) return;
    const definition = this.s03s14BattleCoordinator?.getRescueDefinition?.(S04_BOCAI_RESCUE_ID);
    const target = (this.entities || []).find(entity => entity?.id === definition?.targetEntityId);
    const targetStats = target?.getComponent?.('stats');
    const targetTransform = target?.getComponent?.('transform');
    const playerTransform = this.playerEntity?.getComponent?.('transform');
    const before = this.rescueSystem.serialize();
    let outcome = null;
    if (!target || !targetStats || Number(targetStats.hp) <= 0) {
      outcome = this.rescueSystem.fail('targetDefeated', { operationId: `fail:${S04_BOCAI_RESCUE_ID}:target` });
    } else {
      outcome = this.rescueSystem.update();
      if (outcome?.active && targetTransform) {
        const evacuation = this._worldLoadSession?.findSpawn?.('S04', definition?.evacuationRef);
        if (evacuation && Math.hypot(
          targetTransform.position.x - evacuation.x,
          targetTransform.position.y - evacuation.y
        ) <= Number(definition.evacuationRadius)) {
          outcome = this.rescueSystem.completeStage('escort-east', {
            operationId: `complete:${S04_BOCAI_RESCUE_ID}:escort-east`
          });
        }
      }
      if (outcome?.active && targetTransform && playerTransform) {
        const dx = playerTransform.position.x - targetTransform.position.x;
        const dy = playerTransform.position.y - targetTransform.position.y;
        const distance = Math.hypot(dx, dy);
        const movement = target.getComponent?.('movement');
        const followDistance = Number(definition.followDistance);
        const followMaxDistance = Number(definition.followMaxDistance);
        const followOffset = definition.followOffset;
        if (movement && distance > followDistance && distance < followMaxDistance) {
          movement.setPath([{
            x: playerTransform.position.x + Number(followOffset.x),
            y: playerTransform.position.y + Number(followOffset.y)
          }]);
        } else if (movement && distance <= followDistance) {
          movement.stop();
        }
      }
    }
    this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem.getState());
    if (outcome?.completed && outcome.result) void this._settleS04BocaiRescue(outcome.result, before);
  },

  async _settleS04BocaiRescue(result, beforeRescueState) {
    if (this._s04RescueBusy) return false;
    this._s04RescueBusy = true;
    const blackboard = this.gameLoader?.blackboard;
    const beforeStory = cloneData(blackboard?.get?.('storyState') || {});
    const rescueResults = { ...(beforeStory.rescueResults || {}), [S04_BOCAI_RESCUE_ID]: cloneData(result) };
    try {
      blackboard?.set?.('storyState', {
        ...beforeStory,
        rescueResults,
        bocaiSurvived: result.survived === true,
        lastCheckpointId: 'checkpoint.S04.bocaiRescue'
      });
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: 'checkpoint.S04.bocaiRescue', sceneId: 'S04'
      });
      if (!saved?.ok) throw new Error(saved?.message || 'checkpointFailed');
      this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem.getState());
      this._showScreenTip(
        result.survived ? '波才已从东侧撤离，后续可在 S12 作为友军出现。' : '波才未能在时限内撤离。',
        { title: result.survived ? '救援成功' : '救援失败' }
      );
      return true;
    } catch (error) {
      blackboard?.set?.('storyState', beforeStory);
      const restored = this.rescueSystem.deserialize(beforeRescueState);
      this.s03s14BattleCoordinator.setRescueObjectiveTitle(S04_BOCAI_RESCUE_ID);
      this.rescueObjectiveView?.setSnapshot?.(restored?.state || this.rescueSystem.getState());
      this._showScreenTip(`救援检查点失败：${error?.message || error}，结果已回滚。`, { title: '保存失败' });
      return false;
    } finally {
      this._s04RescueBusy = false;
    }
  },

  async openS04RouteChoice() {
    if (this.currentSceneId !== 'S04' || !this.irreversibleChoiceView || !this.s04RouteCoordinator) return false;
    const availability = this.s04RouteCoordinator.validateOpen({
      rescueActive: this.rescueSystem?.status === RescueStatus.ACTIVE
    });
    if (availability.committed) {
      try {
        return await this._travelS04SelectedRoute(availability.route.routeId);
      } catch (error) {
        this._showScreenTip(`前往已选路线失败：${error?.message || error}`, { title: '场景切换失败' });
        return false;
      }
    }
    if (!availability.ok) {
      const messages = {
        battleResultNotApplied: '先完成长社战役并让战果成功写入检查点。',
        rescueActive: '波才救援仍在计时，先完成或结束救援再离开长社。',
        routeTargetMissing: `${availability.sceneId || '目标'} 区块或玩家出生点缺失。`
      };
      this._showScreenTip(messages[availability.code] || '豫州路线当前不可用。', { title: '路线尚未开放' });
      return false;
    }

    this.irreversibleChoiceView.open({
      title: '长社战后·选择豫州进军路线',
      description: '南阳与西华路线互斥，确认并写入检查点后不可更改。',
      allowCancel: true,
      selectedId: 'nanyang',
      choices: Object.values(S04_ROUTE_CONFIGS).map(route => ({
        id: route.id,
        label: route.label,
        consequences: route.consequences
      }))
    });
    return true;
  },

  async _handleS04RouteChoiceCommand(command = {}) {
    if (command.type === 'cancel') {
      if (!this._s04RouteBusy) this.irreversibleChoiceView?.close?.();
      return true;
    }
    if (command.type !== 'selectChoice') return false;
    return this._commitS04RouteChoice(command.choiceId);
  },

  async _commitS04RouteChoice(routeId) {
    if (this._s04RouteBusy || this.currentSceneId !== 'S04') return false;
    const route = S04_ROUTE_CONFIGS[routeId];
    const coordinator = this.s04RouteCoordinator;
    if (!route || !coordinator) {
      this._showScreenTip('所选豫州路线不存在或路线服务尚未就绪。', { title: '路线不可用' });
      return false;
    }

    this._s04RouteBusy = true;
    this.irreversibleChoiceView?.setBusy?.(true);
    try {
      const result = await coordinator.commit(routeId, {
        rescueActive: this.rescueSystem?.status === RescueStatus.ACTIVE
      });
      if (!result.ok) {
        const messages = {
          routeLocked: `豫州路线已锁定为${S04_ROUTE_CONFIGS[result.routeId]?.label || result.routeId || '其他路线'}。`,
          routeCommitRolledBack: `路线检查点失败：${result.message || '保存失败'}，选择未写入。`,
          routeBusy: '路线选择正在提交，请稍候。',
          battleResultNotApplied: '先完成长社战役并让战果成功写入检查点。',
          rescueActive: '波才救援仍在计时，先完成或结束救援再选择路线。',
          routeTargetMissing: `${result.sceneId || '目标'} 区块或玩家出生点缺失。`,
          invalidRoute: '所选豫州路线不存在。'
        };
        const titles = {
          routeLocked: '路线不可更改',
          routeCommitRolledBack: '路线提交失败',
          routeBusy: '路线正在提交'
        };
        this._showScreenTip(messages[result.code] || '豫州路线当前不可提交。', {
          title: titles[result.code] || '路线不可用'
        });
        return false;
      }

      this.irreversibleChoiceView?.close?.();
      if (!result.idempotent) {
        this._showScreenTip(`${route.label}已锁定，另一条豫州路线不再开放。`, { title: '路线确认完成' });
      }
      if (result.eventError) {
        console.warn('[DDScene] 路线已持久化，但 routeSelected 事件处理失败:', result.eventError);
      }

      try {
        return await this._travelS04SelectedRoute(routeId);
      } catch (error) {
        this._showScreenTip(
          `路线已保存，但前往 ${route.entrySceneId} 失败：${error?.message || error}。可在路线军令旗处重试。`,
          { title: '场景切换失败' }
        );
        return false;
      }
    } catch (error) {
      this._showScreenTip(`路线提交失败：${error?.message || error}`, { title: '路线提交失败' });
      return false;
    } finally {
      this._s04RouteBusy = false;
      this.irreversibleChoiceView?.setBusy?.(false);
    }
  },

  async _travelS04SelectedRoute(routeId) {
    const route = S04_ROUTE_CONFIGS[routeId];
    if (!route || this.currentSceneId !== 'S04') return false;
    if (!this._worldLoadSession?.getChunk?.(route.entrySceneId)
      || !this._worldLoadSession?.findSpawn?.(route.entrySceneId, 'player')) {
      throw new Error(`${route.entrySceneId} 区块或玩家出生点缺失`);
    }
    const result = await this.teleportToChunk({
      scene: route.entrySceneId, spawnRef: 'player', transition: 'fadeBlack'
    });
    if (result === false || result?.cancelled) throw new Error('sceneTransitionCancelled');
    this.s03s14BattleCoordinator.closeUi();
    this._showScreenTip(`已进入${route.label}。当前场景为后续内容制作的灰盒入口。`, {
      title: `${route.entrySceneId}·${route.label}`
    });
    return true;
  }
};


export class S03S08Coordinator extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, s03s08Methods, { name: 'S03S08Coordinator' });
  }
}

export default S03S08Coordinator;