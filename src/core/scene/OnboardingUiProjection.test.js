import { describe, it, expect } from 'vitest';
import { OnboardingUiProjection } from './OnboardingUiProjection.js';

/** 构造最小投影定义（贴真实 OnboardingUI.json 的关键语义）。 */
function makeDefinition() {
  return {
    version: 1,
    controlledComponentIds: [
      'minimap', 'joystick', 'pc-jump', 'pc-flight', 'pc-throw',
      'pc-skill1', 'pc-settings', 'act-attack', 'act-jump', 'act-flight', 'act-throw', 'hb-hp'
    ],
    rules: [
      {
        id: 'global-essential-ui',
        scope: { excludeSceneIds: ['S01'] },
        when: { type: 'always' },
        revealComponentIds: ['minimap', 'joystick', 'pc-skill1', 'pc-settings', 'act-attack', 'hb-hp'],
        enabledComponentIds: ['pc-skill1', 'act-attack', 'hb-hp']
      },
      {
        id: 's01-opening-essential-ui',
        scope: { sceneIds: ['S01'] },
        when: { type: 'always' },
        revealComponentIds: ['joystick'],
        enabledComponentIds: ['joystick']
      },
      {
        id: 's01-jump-reveal-mobility',
        scope: { sceneIds: ['S01'] },
        when: { type: 'tutorialCurrent', tutorialId: 's01.capacity' },
        revealComponentIds: ['pc-jump', 'act-jump'],
        enabledComponentIds: ['pc-jump', 'act-jump']
      }
    ]
  };
}

function makeProjection({ sceneId, tutorialStates = {} }) {
  const tutorialFlow = {
    isCompleted: id => tutorialStates[id]?.completed === true,
    isCurrent: id => tutorialStates[id]?.current === true
  };
  const projection = new OnboardingUiProjection({
    url: 'config/OnboardingUI.json',
    fetchImpl: async () => ({ ok: true, json: async () => makeDefinition() }),
    getSceneId: () => sceneId,
    getStoryState: () => ({}),
    tutorialFlow,
    onProjection: () => {}
  });
  return projection.load().then(() => projection);
}

describe('OnboardingUiProjection 渐进 UI 显隐（轻功/投掷/跳跃按钮治理）', () => {
  it('S01：轻功/投掷默认隐藏，攀藤教程进行中才开启跳跃按钮', async () => {
    const projection = await makeProjection({
      sceneId: 'S01',
      tutorialStates: { 's01.capacity': { current: false, completed: false } }
    });
    const states = projection.getProjection().states;
    expect(states['pc-flight'].visible).toBe(false);
    expect(states['act-throw'].visible).toBe(false);
    expect(states['pc-jump'].visible).toBe(false);
    expect(states['act-jump'].visible).toBe(false);

    const climbing = await makeProjection({
      sceneId: 'S01',
      tutorialStates: { 's01.capacity': { current: true } }
    });
    const climbingStates = climbing.getProjection().states;
    expect(climbingStates['pc-jump'].visible).toBe(true);
    expect(climbingStates['act-jump'].visible).toBe(true);
    expect(climbingStates['act-jump'].enabled).toBe(true);
    expect(climbingStates['pc-flight'].visible).toBe(false);
  });

  it('S02+（全局常驻规则，excludeSceneIds 生效）：常驻显示，轻功/投掷/跳跃隐藏', async () => {
    const projection = await makeProjection({ sceneId: 'S09', tutorialStates: {} });
    const states = projection.getProjection().states;
    expect(states['act-attack'].visible).toBe(true);
    expect(states['pc-skill1'].visible).toBe(true);
    expect(states['pc-skill1'].enabled).toBe(true);
    expect(states['hb-hp'].visible).toBe(true);
    expect(states['minimap'].visible).toBe(true);
    expect(states['pc-flight'].visible).toBe(false);
    expect(states['act-flight'].visible).toBe(false);
    expect(states['pc-throw'].visible).toBe(false);
    expect(states['act-throw'].visible).toBe(false);
    expect(states['pc-jump'].visible).toBe(false);
    expect(states['act-jump'].visible).toBe(false);
  });

  it('excludeSceneIds 语义：S01 被排除不激活全局规则；S02+ 全覆盖', async () => {
    // S01：全局规则被排除，只留 s01-opening 规则 → active 但 flight 等仍隐藏
    const s01 = await makeProjection({ sceneId: 'S01', tutorialStates: {} });
    const s01Projection = s01.getProjection();
    expect(s01Projection.active).toBe(true);
    expect(s01Projection.states['joystick'].visible).toBe(true);

    // 非排除场景（如新场景）：全局规则生效 → 常驻显示、轻功/投掷/跳跃隐藏
    const fresh = await makeProjection({ sceneId: 'S99', tutorialStates: {} });
    const freshProjection = fresh.getProjection();
    expect(freshProjection.active).toBe(true);
    expect(freshProjection.states['act-attack'].visible).toBe(true);
    expect(freshProjection.states['pc-flight'].visible).toBe(false);
    expect(freshProjection.states['act-jump'].visible).toBe(false);
  });
});
