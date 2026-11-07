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
 * 三国张角传 - 结局切片独立 coordinator（E0）
 * 从 S11S14SceneFlow 抽出「结局演出与结算推进」一整片：
 * 结局命令 / 演出视图命令 / 终局方略 / 结局结算 / 输入投影。
 * 宿主 S11S14SceneCoordinator 保留同名 delegate，调用面零改动。
 ************************************************************/

import { SceneFlowCoordinator } from '../../../src/core/scene/SceneFlowCoordinator.js';
import { PadButton } from '../../../src/core/input/Xbox360Profile.js';
import { projectEndingInput, requireEndingInput } from './EndingInputProjector.js';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

const endingMethods = {
  async executeEndingCommand({ endingId, operation, endingKey, ...payload } = {}) {
    // commit：绕过 S14 终局门禁，按结局库元数据直接提交单个结局演出
    // （S02 乱世草芥等剧情裁决结局走此通道，M4）。
    // endingId 校验契约=结局库 id（$ref 存根）；endingKey=库内具体结局元数据 id。
    if (operation === 'commit') return this.commitEndingById(endingKey || endingId, payload);
    if (operation !== 'resolve' || endingId !== this._endingConfig?.id) return false;
    return this.resolveEnding(payload);
  },

  /**
   * 按结局库元数据直接提交结局：打开结局演出视图并写入剧情检查点。
   * @param {string} endingId - endings 库中的结局元数据 id
   * @param {{checkpointId?: string, reviewLines?: Array<string>}} [options]
   */
  async commitEndingById(endingId, { checkpointId = null, reviewLines = null } = {}) {
    if (!this.endingPresentationView) return false;
    const metadata = this._endingConfig?.endings?.find(ending => ending?.id === endingId);
    if (!metadata) {
      this._showScreenTip?.(`结局元数据缺失：${endingId}`, { title: '演出不可用' });
      return false;
    }
    this.endingPresentationView.open({
      snapshot: { endingId, endingSnapshotId: `endingSnapshot.direct.${endingId}` },
      ending: metadata,
      reviewLines: Array.isArray(reviewLines) ? reviewLines : [],
      preSaveCheckpointId: checkpointId
    });
    if (checkpointId) {
      try {
        await this.requestAutoSave({
          reason: 'checkpoint', checkpointId, sceneId: this.currentSceneId
        });
      } catch (error) {
        console.warn('[EndingFlowCoordinator] 结局检查点写入失败', error?.message || error);
      }
    }
    return true;
  },

  _readEndingRuntimeState() {
    // 读取态仍由宿主 S11S14SceneCoordinator._readS13S14State 提供（形状与存档键名不变）
    return this.$scene.s11s14SceneCoordinator?._readS13S14State?.();
  },

  _writeEndingRuntimeState(state = {}) {
    const blackboard = this.gameLoader?.blackboard;
    if (!blackboard || !state.storyState) return false;
    const story = clone(state.storyState);
    if (story.endingId) story.unlockedEndings = [...new Set([...(story.unlockedEndings || []), story.endingId])];
    blackboard.set('storyState', story);
    return true;
  },

  _projectEndingInput(state = {}) {
    // E1：纯投影 + 锚点校验；缺字段抛 endingInputMissingPaths（EndingSystem 包装为 inputProjectionFailed）
    const source = requireEndingInput(state);
    const normalized = this.s13s14Coordinator?.normalizeEndingSnapshot?.() || {};
    return projectEndingInput({ state: source, normalized });
  },

  openS14FinalDoctrine() {
    if (this.currentSceneId !== 'S14' || !this.irreversibleChoiceView) return false;
    const story = this.gameLoader?.blackboard?.get?.('storyState') || {};
    if (story.s14FinalDoctrine?.committed === true) {
      const label = story.s14FinalDoctrine.choiceId === 'scorched' ? '焦土断后' : '保全残部';
      this._showScreenTip(`终局方略已锁定为“${label}”。`, { title: '方略已冻结' });
      return true;
    }
    this.irreversibleChoiceView.open({
      title: '结局之地·最后方略',
      description: '这项选择会进入结局快照。焦土断后只在城市已重损且营建投入足够时触发隐藏结局。',
      allowCancel: true,
      selectedId: 'preserve',
      choices: [
        { id: 'preserve', label: '保全残部', consequences: ['不再扩大城市损毁', '带现有资源与幸存者撤离'] },
        { id: 'scorched', label: '焦土断后', consequences: ['焚毁无法带走的粮仓', '记录焦土选择', '不可撤回'] }
      ]
    });
    return true;
  },

  async _handleS14FinalDoctrineCommand(command = {}) {
    if (command.type === 'cancel') {
      this.irreversibleChoiceView?.close?.();
      return true;
    }
    if (command.type !== 'selectChoice' || !['preserve', 'scorched'].includes(command.choiceId)) return false;
    const blackboard = this.gameLoader?.blackboard;
    const beforeStory = clone(blackboard?.get?.('storyState') || {});
    if (!blackboard) return false;
    if (beforeStory.s14FinalDoctrine?.committed === true) return this.openS14FinalDoctrine();
    const choiceId = command.choiceId;
    const endingInputs = clone(beforeStory.endingInputs || {});
    if (choiceId === 'scorched') endingInputs.allowedCityDestruction = true;
    const draft = {
      ...beforeStory,
      endingInputs,
      scorchedEarthChoice: choiceId === 'scorched',
      s14FinalDoctrine: {
        committed: true,
        choiceId,
        operationId: `story:S14:finalDoctrine:${choiceId}`
      },
      lastCheckpointId: 'checkpoint.S14.finalDoctrine'
    };
    this.irreversibleChoiceView?.setBusy?.(true);
    blackboard.set('storyState', draft);
    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: draft.lastCheckpointId, sceneId: 'S14'
      });
      if (!saved?.ok) throw new Error(saved?.message || 'checkpointRejected');
      this.irreversibleChoiceView?.close?.();
      this._showScreenTip(
        choiceId === 'scorched' ? '无法带走的粮仓已经点燃，焦土方略进入结局快照。' : '你下令停止焚毁，优先保全残部。',
        { title: choiceId === 'scorched' ? '焦土断后' : '保全残部' }
      );
      return true;
    } catch (error) {
      blackboard.set('storyState', beforeStory);
      this._showScreenTip(`终局方略保存失败：${error?.message || error}，选择已回滚。`, { title: '提交失败' });
      return false;
    } finally {
      this.irreversibleChoiceView?.setBusy?.(false);
    }
  },

  async resolveEnding(options = {}) {
    if (this.currentSceneId !== 'S14' || !this.endingSystem || !this.endingPresentationView) return false;
    const story = this.gameLoader?.blackboard?.get?.('storyState') || {};
    if (story.s14FinalDoctrine?.committed !== true) {
      this.openS14FinalDoctrine();
      return false;
    }
    if (story.s14ResourceDivergence?.completed !== true) {
      this._showScreenTip('先分别检查最后的马车和投石车，冻结两项资源分歧。', { title: '终局状态尚未完整' });
      return false;
    }
    this.endingPresentationView.setBusy?.(true);
    const result = await this.endingSystem.resolveEnding({
      checkpointId: options.checkpointId || 'checkpoint.S14.preEnding'
    });
    this.endingPresentationView.setBusy?.(false);
    if (!result?.ok) {
      // E1：优先展示投影/校验给出的明确原因（如缺失字段清单），不吞成 unknown
      const detail = result?.message
        ? result.message
        : `${result?.path ? `${result.path} ` : ''}${result?.code || 'unknown'}`;
      this._showScreenTip(`结局冻结失败：${detail}`, { title: '结局输入不完整' });
      return false;
    }
    const metadata = this._endingConfig?.endings?.find(ending => ending.id === result.endingId);
    if (!metadata) {
      this._showScreenTip(`结局元数据缺失：${result.endingId}`, { title: '演出不可用' });
      return false;
    }
    const input = result.snapshot?.input || {};
    const reviewLines = [
      `职业：${input.storyState?.classId || '未记录'}`,
      `豫州路线：${input.storyState?.yuzhouRoute?.routeId || input.storyState?.routeId || '未记录'}`,
      `张梁：${input.heroStates?.primary?.[0]?.alive ? '存活' : '死亡'}；张宝：${input.heroStates?.primary?.[1]?.alive ? '存活' : '死亡'}`,
      `波才：${input.heroStates?.support?.[0]?.alive ? '存活' : '死亡'}；张曼成：${input.heroStates?.support?.[1]?.alive ? '存活' : '死亡'}`,
      `观战 ${input.battleModeStats?.observed || 0} 场，介入 ${input.battleModeStats?.intervened || 0} 场`,
      `城市最终损毁：${Math.round((input.cityState?.coreDamageRatio || 0) * 100)}%`,
      `累计采集：${input.hiddenInputs?.totalGathered || 0}`
    ];
    this.endingPresentationView.open({
      snapshot: result.snapshot,
      ending: metadata,
      reviewLines,
      preSaveCheckpointId: options.checkpointId || 'checkpoint.S14.preEnding'
    });
    return true;
  },

  async _handleEndingPresentationCommand(command = {}) {
    if (!this.endingPresentationView?.visible) return false;
    // 场景层提示（_showScreenTip）会被结局视图全屏绘制盖住；视图打开期间的反馈一律 showNotice。
    const notice = text => this.endingPresentationView.showNotice?.(text);
    if (command.type === 'close') {
      this.endingPresentationView.close();
      return true;
    }
    if (command.type === 'returnTitle') {
      const manager = this.sceneManager;
      if (!manager?.scenes?.has?.('Login')) {
        notice('标题场景尚未注册，当前结局演出保持打开。');
        return false;
      }
      this.endingPresentationView.close();
      manager.switchTo('Login');
      return true;
    }
    if (command.type === 'loadPreEndingSave') {
      this.endingPresentationView.setBusy?.(true);
      let loaded = null;
      try {
        loaded = await this.requestCheckpointLoad?.(
          this.endingPresentationView.preSaveCheckpointId || 'checkpoint.S14.preEnding'
        );
      } catch (error) {
        console.error('[EndingFlowCoordinator] 读取结局前检查点异常', error);
        loaded = { ok: false, message: error?.message || String(error) };
      } finally {
        this.endingPresentationView.setBusy?.(false);
      }
      if (!loaded?.ok) {
        const message = loaded?.code === 'checkpointNotFound'
          ? '三个自动存档中已找不到结局前检查点。'
          : (loaded?.message || loaded?.errors?.[0]?.message || '宿主无法读取结局前检查点。');
        notice(message);
        return false;
      }
      this.endingPresentationView.close();
      this._showScreenTip('已恢复到结局演出开始前。', { title: '读取成功' });
      return true;
    }
    if (command.type === 'viewUnlockedEndings') {
      const unlocked = this.gameLoader?.blackboard?.get?.('storyState')?.unlockedEndings || [];
      notice(unlocked.length ? `已解锁结局：${unlocked.join('、')}` : '尚无已解锁结局。');
      return true;
    }
    return false;
  },

  _createEndingInputContext({ inputManager, gamepad } = {}) {
    const key = name => inputManager?.isKeyPressed?.(name) === true;
    const button = index => gamepad?.isButtonPressed?.(index) === true;
    return {
      inputManager,
      gamepad,
      viewWidth: this.logicalWidth,
      viewHeight: this.logicalHeight,
      isActionPressed: action => {
        const actions = {
          confirm: () => key('e') || key('enter') || button(PadButton.A) || button(PadButton.X),
          dialogueContinue: () => key('e') || key('enter') || button(PadButton.A) || button(PadButton.X),
          modalCancel: () => key('escape') || button(PadButton.B) || button(PadButton.RS),
          skip: () => key('space') || key('tab') || button(PadButton.Y),
          // 方向切换只认键盘方向键；手柄方向由 EndingPresentationView 统一读左摇杆
          // （UiNavStickReader），十字键不参与方向切换。
          left: () => key('left'),
          previous: () => key('left'),
          right: () => key('right'),
          next: () => key('right')
        };
        return actions[action]?.() === true;
      }
    };
  }
};

/**
 * 结局切片：结局命令、演出视图命令、终局方略与结局结算推进。
 * 通过 SceneFlowCoordinator 投影 Scene 状态；宿主 S11S14SceneCoordinator 保留同名 delegate。
 */
export class EndingFlowCoordinator extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, endingMethods, { name: 'EndingFlowCoordinator' });
  }
}

export default EndingFlowCoordinator;
