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

import { describe, expect, it } from 'vitest';
import { ContentValidator } from '../src/core/validation/ContentValidator.js';
import { CanonicalDocumentService } from './CanonicalDocumentService.js';
import { CanonicalEditorSession } from './CanonicalEditorSession.js';
import { QuestEditor } from './QuestEditor.js';

const PATH = 'example/game/game.project.json';
const canonical = () => ({ project: {
  scenes: [{ id: 'S01' }], triggers: [{ id: 'trigger.start', do: [] }], dialogues: [{ id: 'dialogue.one' }],
  scenarios: [{ id: 'scenario.one', questRefs: ['quest.one'] }],
  quests: [{ id: 'quest.one', name: '任务一', objectives: [{ id: 'one', type: 'collect', requiredCount: 1 }], triggerRefs: ['trigger.start'], dialogueRefs: ['dialogue.one'], sceneRefs: ['S01'] }]
}, sceneOrder: { scenes: {}, order: [] }, scenes: {} });

function setup() {
  const documents = new CanonicalDocumentService();
  documents.openProject({ sourceUri: PATH, canonical: canonical() });
  const registry = new ContentValidator();
  registry.registerSchema({ id: 'gameProject', fields: { quests: { type: 'array' } } });
  const commandService = { save: async (_source, options) => ({ ok: true, committed: true, rootPaths: options.rootPaths }) };
  const session = new CanonicalEditorSession({ sourceUri: PATH, documentService: documents, commandService, schemaRegistry: registry, schemaId: 'gameProject', rootPath: 'project' });
  return { documents, session, editor: new QuestEditor({ canonicalSession: session }) };
}

describe('QuestEditor', () => {
  it('共享唯一 canonical model、字段编辑器和 undo，并保留全字段定义', () => {
    const { documents, session, editor } = setup();
    expect(editor.model).toBe(documents.requireProject(PATH));
    editor.patch('quest.one', 'reward.gold', 10);
    editor.patch('quest.one', 'objectives[0].description', '收集');
    expect(editor.definition('quest.one').reward.gold).toBe(10);
    expect(session.undo()).toBe(true);
    expect(editor.definition('quest.one').objectives[0].description).toBeUndefined();
  });

  it('在同一候选中创建、复制、重命名、精确拒绝删除被引用任务', () => {
    const { editor } = setup();
    editor.create({ id: 'quest.two', objectives: [] });
    editor.duplicate('quest.two', 'quest.copy');
    editor.rename('quest.one', 'quest.renamed');
    expect(editor.definition('quest.renamed')).toBeTruthy();
    expect(editor.referenceErrors('quest.renamed')).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'project.scenarios[0].questRefs[0]' })
    ]));
    expect(editor.delete('quest.renamed')).toMatchObject({ ok: false });
    expect(editor.delete('quest.copy')).toEqual({ ok: true, errors: [] });
  });

  it('只从投影读取运行态预览，保存任务定义只经共享会话', async () => {
    const { editor } = setup();
    editor.select('quest.one');
    const store = { list: () => [{ value: { quests: [{ definitionId: 'quest.one', state: 'active', objectiveProgress: { one: 1 }, remaining: 5, repeat: { count: 0 }, tracking: true, rewardSettlementLedger: ['op'], stateRevision: 2 }] } }] };
    expect(editor.runtimePreview(store)[0]).toMatchObject({ state: 'active', tracking: true, stateRevision: 2 });
    const result = await editor.save();
    expect(result).toMatchObject({ committed: true });
  });
});
