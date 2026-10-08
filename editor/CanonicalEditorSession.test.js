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
import { EditorSceneCommandService } from './EditorSceneCommandService.js';

const PROJECT_PATH = 'example/game/game.project.json';
const canonical = () => ({
  project: { system: { enabled: false }, unknownAllowed: { keep: null }, scenes: [{ id: 'S01' }] },
  sceneOrder: { order: ['S01'], scenes: { S01: { name: 'one' } } },
  scenes: { S01: { id: 'S01', layers: [], unknownAllowed: 'keep' } }
});

describe('CanonicalEditorSession', () => {
  it('多个域共享一个 model/undo，并只把候选根 path 交给完整候选提交链', async () => {
    const documentService = new CanonicalDocumentService();
    const model = documentService.openProject({ sourceUri: PROJECT_PATH, canonical: canonical() });
    const writes = [];
    const commandService = new EditorSceneCommandService({
      documentService,
      validator: {
        sceneValidator: { fingerprint: 'test' },
        validateAndCanonicalize: candidate => ({ ok: true, errors: [], value: structuredClone(candidate) })
      },
      diskTransaction: async (_path, changes) => {
        writes.push(changes);
        return { ok: true, committed: true, transactionId: 'tx-schema', warnings: [] };
      }
    });
    const registry = new ContentValidator();
    registry.registerSchema({ id: 'project', fields: { system: { type: 'object' } } });
    const first = new CanonicalEditorSession({
      sourceUri: PROJECT_PATH, documentService, commandService, schemaRegistry: registry,
      schemaId: 'project', rootPath: 'project'
    });
    const second = new CanonicalEditorSession({
      sourceUri: PROJECT_PATH, documentService, commandService, schemaRegistry: registry,
      schemaId: 'project', rootPath: 'project'
    });

    first.patch('system.enabled', true);
    second.patch('system.zero', 0);
    expect(first.model).toBe(second.model);
    expect(model.dirtyPaths).toEqual(new Set(['project.system.enabled', 'project.system.zero']));
    expect(second.undo()).toBe(true);
    expect(model.getCandidate().project.system).toEqual({ enabled: true });

    const result = await first.save();
    expect(result).toMatchObject({ ok: true, committed: true });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toHaveLength(1);
    expect(writes[0][0]).toMatchObject({ operation: 'replace', path: PROJECT_PATH });
    expect(JSON.parse(writes[0][0].content).unknownAllowed).toEqual({ keep: null });
  });
});
