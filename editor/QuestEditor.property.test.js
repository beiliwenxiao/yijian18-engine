/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AtomicDiskAdapter } from '../src/dev/AtomicDiskAdapter.js';
import { ContentValidator, FieldType } from '../src/core/validation/ContentValidator.js';
import { SeedGenerator } from '../test/support/ModelTesting.js';
import { CanonicalDocumentService } from './CanonicalDocumentService.js';
import { CanonicalEditorSession } from './CanonicalEditorSession.js';
import { EditorSceneCommandService } from './EditorSceneCommandService.js';
import { QuestEditor } from './QuestEditor.js';

const PROJECT_PATH = 'example/game/game.project.json';
const SCENE_ROOT = 'example/game/assets/scenes/';
const ORDER_PATH = `${SCENE_ROOT}_scene_order.json`;
const PROPERTY_SEEDS = Object.freeze([0x11a2b3c4, 0x11a2b3c5, 0x11a2b3c6, 0x11a2b3c7]);
const temporaryRoots = new Set();
const clone = value => structuredClone(value);

function writeJson(root, relativePath, value) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function createValidator() {
  const registry = new ContentValidator();
  registry.registerSchema({
    id: 'propertyGameProject',
    fields: {
      schemaVersion: { type: FieldType.INTEGER, required: true, min: 1 },
      meta: { type: FieldType.OBJECT, required: true },
      scenes: { type: FieldType.ARRAY, required: true },
      triggers: { type: FieldType.ARRAY, required: true },
      dialogues: { type: FieldType.ARRAY, required: true },
      scenarios: { type: FieldType.ARRAY, required: true },
      quests: { type: FieldType.ARRAY, required: true }
    },
    validate(project) {
      const errors = [];
      const questIds = new Set();
      for (const [index, quest] of project.quests.entries()) {
        const base = `quests[${index}]`;
        if (typeof quest?.id !== 'string' || !quest.id) errors.push({ path: `${base}.id`, category: 'schemaFailed', code: 'missing', reason: 'quest id is required' });
        if (questIds.has(quest?.id)) errors.push({ path: `${base}.id`, category: 'referenceFailed', code: 'duplicateId', reason: 'quest id must be unique' });
        questIds.add(quest?.id);
        if (!Array.isArray(quest?.objectives)) errors.push({ path: `${base}.objectives`, category: 'schemaFailed', code: 'typeMismatch', reason: 'objectives must be an array' });
        for (const [objectiveIndex, objective] of (quest?.objectives || []).entries()) {
          const objectivePath = `${base}.objectives[${objectiveIndex}]`;
          if (typeof objective?.id !== 'string') errors.push({ path: `${objectivePath}.id`, category: 'schemaFailed', code: 'typeMismatch', reason: 'objective id must be a string' });
          if (typeof objective?.type !== 'string') errors.push({ path: `${objectivePath}.type`, category: 'schemaFailed', code: 'typeMismatch', reason: 'objective type must be a string' });
          if (!Number.isInteger(objective?.requiredCount) || objective.requiredCount < 0) errors.push({ path: `${objectivePath}.requiredCount`, category: 'schemaFailed', code: 'typeMismatch', reason: 'requiredCount must be a non-negative integer' });
        }
        for (const [referenceIndex, reference] of (quest?.prerequisites || []).entries()) {
          if (!questIds.has(reference) && !project.quests.some(item => item?.id === reference)) errors.push({ path: `${base}.prerequisites[${referenceIndex}]`, category: 'referenceFailed', code: 'invalidReference', reason: 'prerequisite must reference a quest' });
        }
      }
      for (const [index, scenario] of project.scenarios.entries()) {
        for (const [referenceIndex, reference] of (scenario?.questRefs || []).entries()) {
          if (!questIds.has(reference)) errors.push({ path: `scenarios[${index}].questRefs[${referenceIndex}]`, category: 'referenceFailed', code: 'invalidReference', reason: 'scenario must reference a quest' });
        }
      }
      return { ok: errors.length === 0, errors };
    }
  });

  return {
    sceneValidator: { fingerprint: 'property-11' },
    validateAndCanonicalize(candidate) {
      const loaded = registry.loadCandidate(candidate?.project, 'propertyGameProject');
      if (!loaded.committed) return {
        ok: false,
        errors: loaded.errors.map(error => ({ ...error, path: error.path ? `project.${error.path}` : 'project' }))
      };
      return { ok: true, errors: [], value: { ...clone(candidate), project: loaded.value } };
    }
  };
}

function canonicalDocument(seed) {
  const random = new SeedGenerator(seed);
  const suffix = random.string(6, 'abcdefghijklmnopqrstuvwxyz');
  const firstQuestId = `quest.one-${suffix}`;
  const dependentQuestId = `quest.dependent-${suffix}`;
  return {
    project: {
      schemaVersion: 1,
      meta: { id: `property-${suffix}`, version: 3, schema: 3 },
      scenes: [{ id: 'S01', name: 'scene-one' }],
      triggers: [{ id: `trigger.${suffix}`, do: [] }],
      dialogues: [{ id: `dialogue.${suffix}` }],
      scenarios: [{ id: `scenario.${suffix}`, questRefs: [firstQuestId] }],
      quests: [
        {
          id: firstQuestId,
          type: 'side',
          objectives: [
            { id: `collect.${suffix}`, type: 'collect', targetId: null, requiredCount: random.int(1, 4) },
            { id: `talk.${suffix}`, type: 'talk', targetId: `npc.${suffix}`, requiredCount: 1 }
          ],
          triggerRefs: [`trigger.${suffix}`],
          dialogueRefs: [`dialogue.${suffix}`],
          sceneRefs: ['S01'],
          capabilities: [{ id: 'consumable', strategyId: 'heal', params: { amount: random.int(1, 50) } }],
          unknownLegal: { nested: { keep: random.int(0, 100), explicitNull: null }, order: ['first', 'second'] }
        },
        {
          id: dependentQuestId,
          type: 'side',
          objectives: [{ id: `dependent.${suffix}`, type: 'collect', targetId: null, requiredCount: 1 }],
          prerequisites: [firstQuestId],
          unknownLegal: { retained: true }
        }
      ]
    },
    sceneOrder: { gameId: `property-${suffix}`, order: ['S01'], scenes: { S01: { name: 'scene-one', type: 'terrain' } } },
    scenes: { S01: { id: 'S01', layers: [], unknownLegal: { nullValue: null, missingOptionalIsAbsent: true } } }
  };
}

async function createHarness(canonical) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-editor-property-'));
  temporaryRoots.add(root);
  writeJson(root, PROJECT_PATH, canonical.project);
  writeJson(root, ORDER_PATH, canonical.sceneOrder);
  writeJson(root, `${SCENE_ROOT}S01.json`, canonical.scenes.S01);

  const documents = new CanonicalDocumentService();
  const model = documents.openProject({ sourceUri: PROJECT_PATH, schemaId: 'propertyGameProject', canonical });
  const schemaRegistry = new ContentValidator();
  schemaRegistry.registerSchema({ id: 'propertyGameProject', fields: { quests: { type: FieldType.ARRAY } } });
  const transaction = new AtomicDiskAdapter({ repositoryRoot: root });
  await transaction.initialize();
  const commandService = new EditorSceneCommandService({
    documentService: documents,
    validator: createValidator(),
    diskTransaction: async (_projectPath, changes) => transaction.commit(changes),
    now: () => 123
  });
  const session = new CanonicalEditorSession({
    sourceUri: PROJECT_PATH,
    documentService: documents,
    commandService,
    schemaRegistry,
    schemaId: 'propertyGameProject',
    rootPath: 'project'
  });
  return { root, documents, model, session, editor: new QuestEditor({ canonicalSession: session }), validator: createValidator() };
}

function loadCommittedAggregate(root) {
  const project = readJson(root, PROJECT_PATH);
  return {
    project,
    sceneOrder: readJson(root, ORDER_PATH),
    scenes: Object.fromEntries(project.scenes.map(({ id }) => [id, readJson(root, `${SCENE_ROOT}${id}.json`)]))
  };
}

function expectRootError(result, path) {
  expect(result).toMatchObject({ ok: false, committed: false, code: 'candidateValidationFailed' });
  expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
}

afterEach(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
  temporaryRoots.clear();
});

// Property 11: Fix Checking — Lossless Schema-Aware Path Editing.
// **Validates: Requirements 2.7, 2.9, 2.10, 3.11**
describe('Property 11: Lossless Schema-Aware Path Editing', () => {
  it('以可重放 seed 生成 canonical 文档，沿共享模型和原子保存链保持无损等价', async () => {
    for (const seed of PROPERTY_SEEDS) {
      const canonical = canonicalDocument(seed);
      const { root, documents, model, session, editor, validator } = await createHarness(canonical);
      const firstQuestId = canonical.project.quests[0].id;
      const renamedQuestId = `${firstQuestId}.renamed`;
      const originalRuntime = { list: () => [{ value: { quests: [{ definitionId: firstQuestId, state: 'active', objectiveProgress: {}, stateRevision: 3 }] } }] };
      const beforePreview = model.getCandidate();

      expect(editor.model).toBe(model);
      expect(session.model).toBe(documents.requireProject(PROJECT_PATH));
      expect(editor.runtimePreview(originalRuntime)).toEqual([]);
      expect(model.getCandidate()).toEqual(beforePreview);
      expect(Object.hasOwn(editor.definition(firstQuestId), 'missingOptional')).toBe(false);

      editor.patch(firstQuestId, 'objectives[0].requiredCount', 7);
      editor.patch(firstQuestId, 'capabilities[0].params.amount', 99);
      editor.patch(firstQuestId, 'unknownLegal.nested.keep', seed >>> 0);
      editor.patch(firstQuestId, 'unknownLegal.explicitNull', null);
      editor.fieldEditor(firstQuestId).move('objectives', 1, 0);
      editor.rename(firstQuestId, renamedQuestId);

      expect(editor.definition(renamedQuestId).objectives.map(item => item.id)).toEqual([
        canonical.project.quests[0].objectives[1].id,
        canonical.project.quests[0].objectives[0].id
      ]);
      expect(editor.definition(renamedQuestId).unknownLegal.explicitNull).toBeNull();
      expect(editor.definition(canonical.project.quests[1].id).prerequisites).toEqual([renamedQuestId]);
      expect(model.getCandidate().project.scenarios[0].questRefs).toEqual([renamedQuestId]);
      expect(editor.list().flatMap(({ id }) => editor.referenceErrors(id, { includeSelf: false }))).toEqual([]);
      expect(editor.referenceErrors(renamedQuestId)).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'project.scenarios[0].questRefs[0]', code: 'referencedByScenario', category: 'referenceFailed' }),
        expect.objectContaining({ path: 'project.quests[1].prerequisites[0]', code: 'referencedByQuest', category: 'referenceFailed' })
      ]));

      expect(editor.undo()).toBe(true);
      expect(editor.definition(firstQuestId)).toBeTruthy();
      expect(editor.redo()).toBe(true);
      expect(editor.definition(renamedQuestId)).toBeTruthy();

      const expected = validator.validateAndCanonicalize(model.getCandidate());
      expect(expected.ok).toBe(true);
      const saved = await editor.save();
      expect(saved).toMatchObject({ ok: true, committed: true, degraded: false });
      expect(model.isDirty).toBe(false);

      const reloaded = loadCommittedAggregate(root);
      const loaded = validator.validateAndCanonicalize(reloaded);
      expect(loaded).toMatchObject({ ok: true });
      expect(loaded.value).toEqual(expected.value);

      const reopened = new CanonicalDocumentService().openProject({ sourceUri: PROJECT_PATH, schemaId: 'propertyGameProject', canonical: reloaded });
      expect(reopened.getCommittedSnapshot()).toEqual(expected.value);
    }
  });

  it('对每个可重放文档在磁盘提交前返回完整候选根路径错误并保持已提交快照', async () => {
    for (const seed of PROPERTY_SEEDS) {
      const canonical = canonicalDocument(seed);
      const { root, model, editor } = await createHarness(canonical);
      const questId = canonical.project.quests[0].id;
      const beforeMemory = model.getCommittedSnapshot();
      const beforeDisk = loadCommittedAggregate(root);

      editor.patch(questId, 'objectives[0].requiredCount', 'not-an-integer');
      const result = await editor.save();

      expectRootError(result, 'project.quests[0].objectives[0].requiredCount');
      expect(model.getCommittedSnapshot()).toEqual(beforeMemory);
      expect(loadCommittedAggregate(root)).toEqual(beforeDisk);
    }
  });
});
