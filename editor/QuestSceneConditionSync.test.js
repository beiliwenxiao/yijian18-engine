/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-10-14
 ************************************************************/

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyConditionSyncPlan,
  computeConditionSyncPlan,
  conditionSyncPlanSignature,
  isSimpleEqualityGate
} from './QuestSceneConditionSync.js';
import { QuestWizardEditor } from './QuestWizardEditor.js';
import { loadProjectWithShards, readRepoJson } from '../test/support/projectFixture.js';

const project = await loadProjectWithShards();
const sceneS01 = readRepoJson('example/sanguo_zhangjiao/assets/scenes/S01.json');
const s01Quest = () => structuredClone(project.quests.find(quest => quest?.id === 'task.s01.survival'));

function stepIndex(quest, stepId) {
  return quest.steps.findIndex(step => step?.id === stepId);
}

/** 拖动语义：把 fromStepId 移动到 targetStepId 之前。 */
function moveStepBefore(quest, fromStepId, targetStepId) {
  const steps = quest.steps;
  const [moved] = steps.splice(stepIndex(quest, fromStepId), 1);
  steps.splice(stepIndex(quest, targetStepId), 0, moved);
}

function placementById(sceneDoc, placementId) {
  for (const layer of sceneDoc.layers || []) {
    for (const object of layer?.objects || []) {
      if (object?.id === placementId) return object;
    }
  }
  return null;
}

describe('QuestSceneConditionSync 场景出生条件联动', () => {
  it('isSimpleEqualityGate：仅接受 {blackboardKey?, path, equals:true} 简单等值门控', () => {
    expect(isSimpleEqualityGate({ blackboardKey: 'storyState', equals: true, path: 's01Survival.campfireLit' })).toBe(true);
    expect(isSimpleEqualityGate({ equals: true, path: 's01Survival.campfireLit' })).toBe(true);
    expect(isSimpleEqualityGate({ blackboardKey: 'inventory', equals: true, path: 'gold' })).toBe(false);
    expect(isSimpleEqualityGate({ equals: true, gte: 1, path: 'count' })).toBe(false);
    expect(isSimpleEqualityGate({ equals: false, path: 'flag' })).toBe(false);
    expect(isSimpleEqualityGate({ equals: true })).toBe(false);
    expect(isSimpleEqualityGate(null)).toBe(false);
  });

  it('真实 S01 数据：links 完整标注联动状态；本会话未拖动时静态不一致不进入 updates', () => {
    const plan = computeConditionSyncPlan({ quest: s01Quest(), project, sceneDocs: [sceneS01] });
    const byPlacement = new Map(plan.links.map(link => [link.placementId, link]));

    const berry = byPlacement.get('S01-node-berry-1');
    expect(berry).toBeTruthy();
    expect(berry.status).toBe('mismatch');
    expect(berry.changedByReorder).toBe(false);
    expect(berry.currentPath).toBe('s01Survival.initialToolsPicked');
    expect(berry.expectedPath).toBe('s01Survival.campfireLit');
    expect(berry.precedingStepId).toBe('lightCampfire');

    // 木材节点（gatherWood mapTargets）门控 berriesGathered：策划手工门控，未拖动不参与改写
    for (const woodId of ['S01-node-wood-1', 'S01-node-wood-2', 'S01-node-wood-3']) {
      expect(byPlacement.get(woodId)).toMatchObject({ status: 'mismatch', changedByReorder: false });
    }
    expect(byPlacement.get('S01-prop-cooking-rack')).toMatchObject({ status: 'match', currentPath: 's01Survival.wolfSkinned' });
    expect(byPlacement.get('S01-prop-tanning-rack')).toMatchObject({ status: 'match', currentPath: 's01Survival.meatCooked' });

    // 无出生条件的逻辑锚点（出生点/河流/崖底）不参与联动
    expect(byPlacement.has('S01-spawn-campfire')).toBe(false);
    expect(byPlacement.has('S01-shelter-site-firewood')).toBe(false);
    expect(byPlacement.has('S01-river-far-bank')).toBe(false);

    expect(plan.updates).toHaveLength(0);
  });

  it('拖动 findTools 到 gatherBerries 之前（用户场景）：野果丛门控与新顺序一致；后续分段边界变化的目标进入计划', () => {
    const quest = s01Quest();
    const baseline = structuredClone(quest.steps);
    moveStepBefore(quest, 'findTools', 'gatherBerries');
    const plan = computeConditionSyncPlan({ quest, project, sceneDocs: [sceneS01], previousSteps: baseline });
    // 野果丛：新顺序中前序目标正是 findTools（initialToolsPicked），门控天然一致
    const berry = plan.links.find(link => link.placementId === 'S01-node-berry-1');
    expect(berry.status).toBe('match');
    expect(berry.currentPath).toBe('s01Survival.initialToolsPicked');
    expect(plan.updates.map(update => update.placementId)).not.toContain('S01-node-berry-1');
    // gatherWood 的前序目标由 spotWolf 变为 eatBerry，木材节点门控按规则给出跟随计划（可应用/忽略）
    expect(plan.updates.map(update => update.placementId).sort())
      .toEqual(['S01-node-wood-1', 'S01-node-wood-2', 'S01-node-wood-3']);
    expect(plan.updates[0].expectedPath).toBe('s01Survival.berryEaten');
  });

  it('把 gatherBerries 拖到 eatBerry 之后：因拖动产生改写计划，应用后写回场景且不改传入文档', () => {
    const quest = s01Quest();
    const baseline = structuredClone(quest.steps);
    moveStepBefore(quest, 'gatherBerries', 'after.eatBerry.1');
    const plan = computeConditionSyncPlan({ quest, project, sceneDocs: [sceneS01], previousSteps: baseline });
    const berry = plan.links.find(link => link.placementId === 'S01-node-berry-1');
    expect(berry.status).toBe('mismatch');
    expect(berry.changedByReorder).toBe(true);
    expect(berry.expectedPath).toBe('s01Survival.berryEaten');
    expect(plan.updates).toHaveLength(1);

    const frozen = structuredClone(sceneS01);
    const { sceneDocs, sceneIds } = applyConditionSyncPlan([sceneS01], plan.updates);
    expect(sceneIds).toEqual(['S01']);
    expect(placementById(sceneDocs.S01, 'S01-node-berry-1').spawnWhen).toEqual({
      blackboardKey: 'storyState', equals: true, path: 's01Survival.berryEaten'
    });
    expect(sceneS01).toEqual(frozen); // 入参场景文档不被变异
  });

  it('gatherBerries 拖成首个目标：计划为移除出生条件，应用后对象无条件生成', () => {
    const quest = s01Quest();
    const baseline = structuredClone(quest.steps);
    moveStepBefore(quest, 'gatherBerries', 'lightCampfire');
    const plan = computeConditionSyncPlan({ quest, project, sceneDocs: [sceneS01], previousSteps: baseline });
    const berry = plan.links.find(link => link.placementId === 'S01-node-berry-1');
    expect(berry.status).toBe('mismatch');
    expect(berry.clearExpected).toBe(true);

    const { sceneDocs } = applyConditionSyncPlan([sceneS01], plan.updates);
    expect(placementById(sceneDocs.S01, 'S01-node-berry-1').spawnWhen).toBeUndefined();
  });

  it('拖动 gatherWood：木材节点门控跟随新前序目标进入 updates；复合条件与不可解析事实保持不变', () => {
    const quest = s01Quest();
    const baseline = structuredClone(quest.steps);
    // gatherWood 拖到 gatherBerries 之前：前序目标由 spotWolf 变为 lightCampfire
    moveStepBefore(quest, 'gatherWood', 'after.findTools.2');
    const plan = computeConditionSyncPlan({ quest, project, sceneDocs: [sceneS01], previousSteps: baseline });
    const woodIds = plan.updates.map(update => update.placementId).sort();
    expect(woodIds).toEqual(['S01-node-wood-1', 'S01-node-wood-2', 'S01-node-wood-3']);
    expect(plan.updates[0].expectedPath).toBe('s01Survival.campfireLit');

    // 复合出生条件：标记 manual 不自动改写
    const sceneDoc = structuredClone(sceneS01);
    placementById(sceneDoc, 'S01-node-wood-1').spawnWhen = { blackboardKey: 'storyState', equals: true, gte: 1, path: 's01Survival.berryGatherCount' };
    const manualPlan = computeConditionSyncPlan({ quest, project, sceneDocs: [sceneDoc], previousSteps: baseline });
    expect(manualPlan.links.find(link => link.placementId === 'S01-node-wood-1').status).toBe('manual');
    expect(manualPlan.updates.map(update => update.placementId)).not.toContain('S01-node-wood-1');

    // 前序目标无可解析事实（gather.item 目标物品）：标记 unresolved 保持不变
    const quest2 = s01Quest();
    const baseline2 = structuredClone(quest2.steps);
    moveStepBefore(quest2, 'gatherBerries', 'spotWolf'); // gatherBerries 前序目标变为 gatherWood（resource.wood，非事实）
    const unresolvedPlan = computeConditionSyncPlan({ quest: quest2, project, sceneDocs: [sceneS01], previousSteps: baseline2 });
    const berry2 = unresolvedPlan.links.find(link => link.placementId === 'S01-node-berry-1');
    expect(berry2.status).toBe('unresolved');
    expect(unresolvedPlan.updates).toHaveLength(0);
  });

  it('计划签名随更新内容变化', () => {
    const questA = s01Quest();
    const planA = computeConditionSyncPlan({ quest: questA, project, sceneDocs: [sceneS01], previousSteps: questA.steps });
    const quest = s01Quest();
    const baseline = structuredClone(quest.steps);
    moveStepBefore(quest, 'gatherBerries', 'after.eatBerry.1');
    const planB = computeConditionSyncPlan({ quest, project, sceneDocs: [sceneS01], previousSteps: baseline });
    expect(conditionSyncPlanSignature(planA)).toBe('[]');
    expect(conditionSyncPlanSignature(planB)).not.toBe('[]');
  });
});

describe('QuestWizardEditor 联动审查栏', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    localStorage.removeItem('qwe-col-widths');
  });

  function buildEditor({ sceneDoc } = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const saved = [];
    let currentScene = sceneDoc ? structuredClone(sceneDoc) : null;
    const canonicalSession = {
      sourceUri: 'test://game.project.json',
      getValue: () => ({ ...project }),
      patch: () => {},
      save: async () => ({ ok: true, committed: true })
    };
    const editor = new QuestWizardEditor(container, {
      canonicalSession,
      getSceneDocuments: () => (currentScene ? [currentScene] : []),
      saveSceneDocument: async (sceneId, scene) => {
        currentScene = structuredClone(scene);
        saved.push({ sceneId, scene: currentScene });
        return { ok: true, committed: true };
      }
    });
    editor.project = { ...project };
    editor.selectedId = 'task.s01.survival';
    editor._initialized = true;
    editor._buildUI();
    editor._load(); // 建立 _stepsAtLoad 联动基线
    editor._render();
    return { editor, saved };
  }

  it('本会话未拖动：无审查栏，步骤卡显示「未联动」标注；拖动后审查栏列出改写计划', () => {
    const { editor } = buildEditor({ sceneDoc: sceneS01 });
    expect(editor.container.querySelector('[data-role="condition-sync"]')).toBeNull();
    const berryCard = editor.container.querySelector('[data-step-id="gatherBerries"]');
    expect(berryCard?.querySelector('.qwe-link.muted')?.textContent).toContain('S01-node-berry-1');

    // 拖动 gatherBerries 到 eatBerry 之后 → 审查栏出现，列出 current → expected
    moveStepBefore(editor.quests[0], 'gatherBerries', 'after.eatBerry.1');
    editor._renderDetail();
    const bar = editor.container.querySelector('[data-role="condition-sync"]');
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain('S01-node-berry-1');
    expect(bar.textContent).toContain('s01Survival.initialToolsPicked');
    expect(bar.textContent).toContain('s01Survival.berryEaten');
    expect(editor.container.querySelector('[data-step-id="gatherBerries"] .qwe-link.warn')).toBeTruthy();
  });

  it('未接入保存通道时应用按钮禁用', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = new QuestWizardEditor(container, {
      canonicalSession: {
        sourceUri: 'test://game.project.json',
        getValue: () => ({ ...project }),
        patch: () => {},
        save: async () => ({ ok: true, committed: true })
      },
      getSceneDocuments: () => [structuredClone(sceneS01)]
    });
    editor.project = { ...project };
    editor.selectedId = 'task.s01.survival';
    editor._initialized = true;
    editor._buildUI();
    editor._load();
    editor._render();
    moveStepBefore(editor.quests[0], 'gatherBerries', 'after.eatBerry.1');
    editor._renderDetail();
    expect(editor.container.querySelector('[data-action="sync-apply"]').disabled).toBe(true);
  });

  it('点击应用：调用 saveSceneDocument 写回改写后的 spawnWhen，审查栏随之消失', async () => {
    const { editor, saved } = buildEditor({ sceneDoc: sceneS01 });
    moveStepBefore(editor.quests[0], 'gatherBerries', 'after.eatBerry.1');
    editor._renderDetail();
    editor.container.querySelector('[data-action="sync-apply"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(saved).toHaveLength(1);
    expect(saved[0].sceneId).toBe('S01');
    expect(placementById(saved[0].scene, 'S01-node-berry-1').spawnWhen)
      .toEqual({ blackboardKey: 'storyState', equals: true, path: 's01Survival.berryEaten' });
    expect(editor.container.querySelector('[data-role="condition-sync"]')).toBeNull();
  });

  it('点击忽略：审查栏隐藏；计划随后续拖动变化时重新出现', () => {
    const { editor } = buildEditor({ sceneDoc: sceneS01 });
    moveStepBefore(editor.quests[0], 'gatherBerries', 'after.eatBerry.1');
    editor._renderDetail();
    expect(editor.container.querySelector('[data-role="condition-sync"]')).toBeTruthy();
    editor.container.querySelector('[data-action="sync-dismiss"]').click();
    expect(editor.container.querySelector('[data-role="condition-sync"]')).toBeNull();

    // 计划未变的重渲染保持隐藏
    editor._renderDetail();
    expect(editor.container.querySelector('[data-role="condition-sync"]')).toBeNull();

    // 再次拖动：gatherBerries 移到 spotWolf 之后 → 前序目标变为 spotWolf，计划内容不同 → 审查栏重新出现
    moveStepBefore(editor.quests[0], 'gatherBerries', 'after.spotWolf.1');
    editor._renderDetail();
    const barAgain = editor.container.querySelector('[data-role="condition-sync"]');
    expect(barAgain).toBeTruthy();
    expect(barAgain.textContent).toContain('S01-node-berry-1');
    expect(barAgain.textContent).toContain('campfireRefuelCount');
  });

  it('未提供场景文档时不渲染审查栏，不影响既有渲染', () => {
    const { editor } = buildEditor();
    expect(editor.container.querySelector('[data-role="condition-sync"]')).toBeNull();
    expect(editor.container.querySelector('[data-role="quest-detail"]').innerHTML).toContain('编译预览');
  });
});
