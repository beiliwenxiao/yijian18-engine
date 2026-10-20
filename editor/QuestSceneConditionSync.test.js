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

  it('真实 S01 数据：links 完整标注联动状态；任务链补齐后门控全部一致，静态不一致不进入 updates', () => {
    const plan = computeConditionSyncPlan({ quest: s01Quest(), project, sceneDocs: [sceneS01] });
    const byPlacement = new Map(plan.links.map(link => [link.placementId, link]));

    const berry = byPlacement.get('S01-node-berry-1');
    expect(berry).toBeTruthy();
    expect(berry.status).toBe('match');
    expect(berry.changedByReorder).toBe(false);
    expect(berry.currentPath).toBe('s01Survival.campfireLit');
    expect(berry.expectedPath).toBe('s01Survival.campfireLit');
    expect(berry.precedingStepId).toBe('lightCampfire');

    // 木材节点（gatherWood mapTargets）门控 axeFound：与步骤顺序一致
    for (const woodId of ['S01-node-wood-1', 'S01-node-wood-2', 'S01-node-wood-3']) {
      expect(byPlacement.get(woodId)).toMatchObject({ status: 'match', changedByReorder: false, currentPath: 's01Survival.axeFound' });
    }
    expect(byPlacement.get('S01-pickup-worn-axe')).toMatchObject({ status: 'match', currentPath: 's01Survival.berryEaten' });
    expect(byPlacement.get('S01-prop-cooking-rack')).toMatchObject({ status: 'match', currentPath: 's01Survival.wolfSkinned' });
    expect(byPlacement.get('S01-prop-tanning-rack')).toMatchObject({ status: 'match', currentPath: 's01Survival.meatCooked' });

    // 无出生条件的逻辑锚点（出生点/河流/崖底）不参与联动
    expect(byPlacement.has('S01-spawn-campfire')).toBe(false);
    expect(byPlacement.has('S01-shelter-site-firewood')).toBe(false);
    expect(byPlacement.has('S01-river-far-bank')).toBe(false);

    expect(plan.updates).toHaveLength(0);
  });

  it('拖动 gatherWood 到 killWolf 之后：木材节点门控跟随新前序目标进入 updates', () => {
    const quest = s01Quest();
    const baseline = structuredClone(quest.steps);
    moveStepBefore(quest, 'gatherWood', 'findSkinningKnife');
    const plan = computeConditionSyncPlan({ quest, project, sceneDocs: [sceneS01], previousSteps: baseline });
    // gatherWood 插到 killWolf 与 findSkinningKnife 之间，新前序目标为 killWolf（firstWolfKilled）
    expect(plan.updates.map(update => update.placementId).sort())
      .toEqual(['S01-node-wood-1', 'S01-node-wood-2', 'S01-node-wood-3']);
    expect(plan.updates[0].expectedPath).toBe('s01Survival.firstWolfKilled');
  });

  it('把 gatherBerries 拖到 eatBerry 之后：因拖动产生改写计划，应用后写回场景且不改传入文档', () => {
    const quest = s01Quest();
    const baseline = structuredClone(quest.steps);
    moveStepBefore(quest, 'gatherBerries', 'after.eatBerry.1');
    const plan = computeConditionSyncPlan({ quest, project, sceneDocs: [sceneS01], previousSteps: baseline });
    // 同一对象被多个步骤引用（after.lightCampfire.1 亦指向 berry-1），按步骤精确取链接
    const berry = plan.links.find(link => link.placementId === 'S01-node-berry-1' && link.stepId === 'gatherBerries');
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
    const berry = plan.links.find(link => link.placementId === 'S01-node-berry-1' && link.stepId === 'gatherBerries');
    expect(berry.status).toBe('mismatch');
    expect(berry.clearExpected).toBe(true);

    const { sceneDocs } = applyConditionSyncPlan([sceneS01], plan.updates);
    expect(placementById(sceneDocs.S01, 'S01-node-berry-1').spawnWhen).toBeUndefined();
  });

  it('拖动后复合条件标记 manual 不改写；前序目标无可解析事实标记 unresolved 保持不变', () => {
    const quest = s01Quest();
    const baseline = structuredClone(quest.steps);
    moveStepBefore(quest, 'gatherWood', 'findSkinningKnife');
    const plan = computeConditionSyncPlan({ quest, project, sceneDocs: [sceneS01], previousSteps: baseline });
    expect(plan.updates.map(update => update.placementId)).toContain('S01-node-wood-1');

    // 复合出生条件：标记 manual 不自动改写
    const sceneDoc = structuredClone(sceneS01);
    placementById(sceneDoc, 'S01-node-wood-1').spawnWhen = { blackboardKey: 'storyState', equals: true, gte: 1, path: 's01Survival.berryGatherCount' };
    const manualPlan = computeConditionSyncPlan({ quest, project, sceneDocs: [sceneDoc], previousSteps: baseline });
    expect(manualPlan.links.find(link => link.placementId === 'S01-node-wood-1').status).toBe('manual');
    expect(manualPlan.updates.map(update => update.placementId)).not.toContain('S01-node-wood-1');

    // 前序目标无可解析事实（gather.item 目标物品）：标记 unresolved 保持不变
    const quest2 = s01Quest();
    const baseline2 = structuredClone(quest2.steps);
    moveStepBefore(quest2, 'craftGear', 'after.gatherBerries.1'); // craftGear 前序目标变为 gatherBerries（resource.wild_berry，非事实）
    const unresolvedPlan = computeConditionSyncPlan({ quest: quest2, project, sceneDocs: [sceneS01], previousSteps: baseline2 });
    const rack = unresolvedPlan.links.find(link => link.placementId === 'S01-prop-tanning-rack');
    expect(rack.status).toBe('unresolved');
    expect(unresolvedPlan.updates.map(update => update.placementId)).not.toContain('S01-prop-tanning-rack');
  });

  it('计划签名随更新内容变化：静态签名含 updates 空组与 orphans，拖动后 updates 变化', () => {
    const questA = s01Quest();
    const planA = computeConditionSyncPlan({ quest: questA, project, sceneDocs: [sceneS01], previousSteps: questA.steps });
    const quest = s01Quest();
    const baseline = structuredClone(quest.steps);
    moveStepBefore(quest, 'gatherBerries', 'after.eatBerry.1');
    const planB = computeConditionSyncPlan({ quest, project, sceneDocs: [sceneS01], previousSteps: baseline });
    const sigA = JSON.parse(conditionSyncPlanSignature(planA));
    expect(sigA.updates).toEqual([]);
    expect(sigA.statics).toEqual([]);
    expect(sigA.orphans.length).toBeGreaterThan(0); // 产出型放置点提示进入静态签名
    expect(conditionSyncPlanSignature(planB)).not.toBe(conditionSyncPlanSignature(planA));
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

  it('本会话未拖动：审查栏仅含产出型提示（静态无 updates）；拖动后审查栏列出改写计划', () => {
    const { editor } = buildEditor({ sceneDoc: sceneS01 });
    // 门控已全部修齐：静态只剩产出型放置点提示（庇护所等目标完成后的产物），无 updates 段
    const idleBar = editor.container.querySelector('[data-role="condition-sync"]');
    expect(idleBar?.textContent).toContain('产出型放置点');
    expect(idleBar.textContent).not.toContain('处待更新');
    const berryCard = editor.container.querySelector('[data-step-id="gatherBerries"]');
    expect(berryCard?.querySelector('.qwe-link.ok')?.textContent).toContain('S01-node-berry-1');

    // 拖动 gatherBerries 到 eatBerry 之后 → 审查栏出现 updates 段，列出 current → expected
    moveStepBefore(editor.quests[0], 'gatherBerries', 'after.eatBerry.1');
    editor._renderDetail();
    const bar = editor.container.querySelector('[data-role="condition-sync"]');
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain('S01-node-berry-1');
    expect(bar.textContent).toContain('s01Survival.campfireLit');
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

  it('点击应用：调用 saveSceneDocument 写回改写后的 spawnWhen，updates 段随之消失（产出型提示保留）', async () => {
    const { editor, saved } = buildEditor({ sceneDoc: sceneS01 });
    moveStepBefore(editor.quests[0], 'gatherBerries', 'after.eatBerry.1');
    editor._renderDetail();
    editor.container.querySelector('[data-action="sync-apply"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(saved).toHaveLength(1);
    expect(saved[0].sceneId).toBe('S01');
    expect(placementById(saved[0].scene, 'S01-node-berry-1').spawnWhen)
      .toEqual({ blackboardKey: 'storyState', equals: true, path: 's01Survival.berryEaten' });
    // 应用后 updates 已清空：审查栏只剩产出型放置点提示段
    const bar = editor.container.querySelector('[data-role="condition-sync"]');
    expect(bar?.textContent).toContain('产出型放置点');
    expect(bar.textContent).not.toContain('处待更新');
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
  }, 15000); // 多轮全量重渲染（detail ~15 万字符），并发跑套件时默认 5s 不够

  it('未提供场景文档时不渲染审查栏，不影响既有渲染', () => {
    const { editor } = buildEditor();
    expect(editor.container.querySelector('[data-role="condition-sync"]')).toBeNull();
    expect(editor.container.querySelector('[data-role="quest-detail"]').innerHTML).toContain('编译预览');
  });
});
