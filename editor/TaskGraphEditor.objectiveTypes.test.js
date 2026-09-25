// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskGraphEditor } from './TaskGraphEditor.js';
import { compileQuestProject } from '../src/systems/quest/QuestRuntime.js';
import { loadProjectWithShards } from '../test/support/projectFixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const project = await loadProjectWithShards();

function buildEditor() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const canonicalSession = {
    sourceUri: 'test://game.project.json',
    getValue: () => project,
    patch: () => {},
    save: async () => ({ ok: true, committed: true })
  };
  const editor = new TaskGraphEditor(container, { canonicalSession });
  editor.project = project;
  // 阶段③迁移：运行时任务定义 = taskGraphs[] + quests[] 编译产物（S01 已迁移）
  editor.taskGraphs = [
    ...structuredClone(project.taskGraphs),
    ...compileQuestProject(project).taskGraphs
  ];
  editor.selectedIndex = editor.taskGraphs.findIndex(task => task?.id === 'task.s01.survival');
  editor._initialized = true;
  editor._buildUI();
  editor._render();
  return editor;
}

const stepCard = (editor, nodeId) =>
  editor.container.querySelector(`[data-linear-node-id="${nodeId}"]`);

const selectedValue = card => selector =>
  card.querySelector(selector)?.value ?? null;

describe('TaskGraphEditor 目标类型目录驱动', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('S01 真实任务渲染：旧数据反推目标类型，身份下拉与数量累计说明按目录生成', () => {
    const editor = buildEditor();

    const gather = stepCard(editor, 'gatherWood');
    expect(selectedValue(gather)('[data-linear-field="objectiveType"]')).toBe('gather.item');
    expect(selectedValue(gather)('[data-identity-field="itemId"]')).toBe('resource.wood');
    expect(gather.textContent).toContain('accepted');

    const kill = stepCard(editor, 'killWolf');
    expect(selectedValue(kill)('[data-linear-field="objectiveType"]')).toBe('kill.enemy');
    expect(selectedValue(kill)('[data-identity-field="definitionId"]')).toBe('story.s01.firstWolfKilled');

    const fact = stepCard(editor, 'spotWolf');
    expect(selectedValue(fact)('[data-linear-field="objectiveType"]')).toBe('commit.fact');
    // 目录类型不渲染「完成事件」下拉
    expect(fact.querySelector('[data-linear-field="eventType"]')).toBeNull();
  });

  it('目录未登记事件回退 custom.event：渲染完成事件下拉与事件级身份字段', () => {
    const editor = buildEditor();
    const task = editor.taskGraphs.find(entry => entry.id === 'task.s01.survival');
    task.nodes.push({
      id: 'customStep', type: 'objective', title: '自定义', next: [],
      eventMatcher: { type: 'sceneEnter', payload: { sceneId: 'S01' } }
    });
    editor._render();

    const card = stepCard(editor, 'customStep');
    expect(selectedValue(card)('[data-linear-field="objectiveType"]')).toBe('custom.event');
    expect(selectedValue(card)('[data-linear-field="eventType"]')).toBe('sceneEnter');
    expect(selectedValue(card)('[data-identity-field="sceneId"]')).toBe('S01');
  });

  it('切换目标类型写回 objectiveType/progressBy/eventMatcher：kill.enemy ↔ gather.item', () => {
    const editor = buildEditor();
    const card = stepCard(editor, 'spotWolf');
    const select = card.querySelector('[data-linear-field="objectiveType"]');
    select.value = 'kill.enemy';
    select.dispatchEvent(new Event('change'));

    let task = editor.taskGraphs.find(entry => entry.id === 'task.s01.survival');
    let spotWolf = task.nodes.find(node => node.id === 'spotWolf');
    expect(spotWolf.objectiveType).toBe('kill.enemy');
    expect(spotWolf.progressBy).toBeUndefined();
    expect(spotWolf.eventMatcher).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.s01.refuelCampfire' } });

    select.value = 'gather.item';
    select.dispatchEvent(new Event('change'));
    task = editor.taskGraphs.find(entry => entry.id === 'task.s01.survival');
    spotWolf = task.nodes.find(node => node.id === 'spotWolf');
    expect(spotWolf.objectiveType).toBe('gather.item');
    expect(spotWolf.progressBy).toBe('accepted');
    expect(spotWolf.eventMatcher.type).toBe('gathering.completed');
    // 换 matcherType 时旧身份字段（definitionId）不残留
    expect(spotWolf.eventMatcher.payload.definitionId).toBeUndefined();
  });

  it('同 matcherType 内切换身份保留附加限定字段（gather.item ↔ custom 同通道不适用，gather ↔ gather 保留 resourceType）', () => {
    const editor = buildEditor();
    const card = stepCard(editor, 'gatherWood');
    const select = card.querySelector('[data-linear-field="objectiveType"]');
    // gather.item → commit.fact（丢弃 itemId/resourceType）→ gather.item（payload 重建为空身份）
    select.value = 'commit.fact';
    select.dispatchEvent(new Event('change'));
    select.value = 'gather.item';
    select.dispatchEvent(new Event('change'));

    const task = editor.taskGraphs.find(entry => entry.id === 'task.s01.survival');
    const gatherWood = task.nodes.find(node => node.id === 'gatherWood');
    expect(gatherWood.objectiveType).toBe('gather.item');
    expect(gatherWood.eventMatcher.type).toBe('gathering.completed');
    expect(gatherWood.progressBy).toBe('accepted');
  });

  it('自定义事件选择固化 objectiveType=custom.event 并清空 progressBy', () => {
    const editor = buildEditor();
    const card = stepCard(editor, 'gatherWood');
    const eventSelect = card.querySelector('[data-linear-field="eventType"]');
    expect(eventSelect, 'gather.item 为目录类型，不显示完成事件下拉').toBeNull();

    const typeSelect = card.querySelector('[data-linear-field="objectiveType"]');
    typeSelect.value = 'custom.event';
    typeSelect.dispatchEvent(new Event('change'));

    const task = editor.taskGraphs.find(entry => entry.id === 'task.s01.survival');
    const gatherWood = task.nodes.find(node => node.id === 'gatherWood');
    expect(gatherWood.objectiveType).toBe('custom.event');
    expect(gatherWood.progressBy).toBeUndefined();
  });
});
