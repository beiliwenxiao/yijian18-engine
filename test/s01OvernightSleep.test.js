// S01 庇护所过夜演出：6 秒计时条 + Zzz 睡觉动画；满 6 秒才提交 story.s01.overnight，
// 期间离开室内中断且不写任何事实。
import { describe, expect, it } from 'vitest';
import { S01S02Coordinator } from '../example/sanguo_zhangjiao/systems/S01S02SceneFlow.js';

function createSleepSceneStub() {
  const progressEvents = [];
  const zzzTexts = [];
  const tips = [];
  let currentSceneId = 'S01-C01';
  const scene = {
    get currentSceneId() { return currentSceneId; },
    set currentSceneId(value) { currentSceneId = value; },
    context: {
      services: {},
      presentation: {
        gatheringProgress: {
          handleEvent: (event, data) => {
            progressEvents.push({ event, progress: data.progress });
            return true;
          }
        }
      }
    },
    gameLoader: {
      blackboard: {
        get: key => (key === 'storyState' ? { s01Survival: {} } : undefined),
        set: () => {}
      }
    },
    playerEntity: { getComponent: () => ({ position: { x: 320, y: 210 } }) },
    floatingTextManager: {
      add: options => zzzTexts.push(options)
    },
    entityStore: { getById: () => null },
    timeSystem: { setCurrentDay: value => { scene.currentDay = value; } },
    _showScreenTip: text => tips.push(text)
  };
  scene._progressEvents = progressEvents;
  scene._zzzTexts = zzzTexts;
  scene._tips = tips;
  return scene;
}

describe('S01 庇护所过夜演出', () => {
  it('触发后 6 秒内只推进入睡演出，不提交过夜事务', async () => {
    const scene = createSleepSceneStub();
    const coordinator = new S01S02Coordinator(scene);
    const submits = [];
    coordinator._submit = (definitionId, payload, operationId) => {
      submits.push({ definitionId, operationId });
      return Promise.resolve({ ok: true });
    };

    const pending = coordinator.handleAction({ operation: 'overnight' }, { eventId: 'op-1' });
    expect(scene._progressEvents.some(event => event.event === 'started')).toBe(true);
    // 未满 6 秒：每帧推进进度、周期冒 Z，但不提交
    for (let i = 0; i < 5; i += 1) coordinator.update(1);
    expect(submits).toEqual([]);
    expect(scene._progressEvents.at(-1).progress).toBeCloseTo(5 / 6, 5);
    expect(scene._zzzTexts.length).toBeGreaterThanOrEqual(4);
    expect(scene._zzzTexts.every(zzz => zzz.text === 'Z')).toBe(true);

    // 第 6 秒满：演出完成并提交事务
    coordinator.update(1);
    const result = await pending;
    expect(result).toEqual({ ok: true });
    expect(submits).toEqual([{ definitionId: 'story.s01.overnight', operationId: 'op-1:state:story.s01.overnight' }]);
    expect(scene.currentDay).toBe(2);
    expect(scene._tips.some(tip => tip.includes('钻进被窝'))).toBe(true);
  });

  it('睡眠期间重复触发被拒绝；离开室内中断且不写任何事实', async () => {
    const scene = createSleepSceneStub();
    const coordinator = new S01S02Coordinator(scene);
    const submits = [];
    coordinator._submit = definitionId => {
      submits.push(definitionId);
      return Promise.resolve({ ok: true });
    };

    const pending = coordinator.handleAction({ operation: 'overnight' }, {});
    const repeated = await coordinator.handleAction({ operation: 'overnight' }, {});
    expect(repeated).toEqual({ ok: true, status: 'alreadySleeping' });

    // 玩家走出室内：演出中断、进度条清理、事务零提交
    scene.currentSceneId = 'S01';
    coordinator.update(0.5);
    const result = await pending;
    expect(result).toEqual({ ok: true, status: 'sleepInterrupted' });
    expect(submits).toEqual([]);
    expect(scene._progressEvents.at(-1).event).toBe('interrupted');
  });

  it('过夜已完成时良性短路，不再进入演出', async () => {
    const scene = createSleepSceneStub();
    scene.gameLoader.blackboard.get = key => (
      key === 'storyState' ? { s01Survival: { overnightCompleted: true } } : undefined
    );
    const coordinator = new S01S02Coordinator(scene);
    const result = await coordinator.handleAction({ operation: 'overnight' }, {});
    expect(result).toEqual({ ok: true, status: 'alreadyCommitted' });
    expect(coordinator.overnightSleepProgress).toBeNull();
  });
});
