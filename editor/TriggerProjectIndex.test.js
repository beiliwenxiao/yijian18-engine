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
import { TriggerProjectIndex } from './TriggerProjectIndex.js';

function project() {
  return {
    triggers: [
      { id: 'trg.a', name: 'A', when: { type: 'sceneEnter' } },
      { id: 'trg.b', name: 'B', when: { type: 'gathering.completed', params: { itemId: 'wood' } } }
    ],
    tutorials: [
      { id: 'tut.1', title: 'T1', scope: { sceneIds: ['S01'] } },
      { id: 'tut.2', title: 'T2', scope: { sceneIds: ['S02'] } }
    ]
  };
}

describe('TriggerProjectIndex（全 Trigger 化投影）', () => {
  it('getTrigger / getTutorial 按 id 查找', () => {
    const index = new TriggerProjectIndex(project());
    expect(index.getTrigger('trg.a')?.name).toBe('A');
    expect(index.getTrigger('missing')).toBeNull();
    expect(index.getTutorial('tut.2')?.title).toBe('T2');
  });

  it('compareTriggers 保持定义顺序', () => {
    const index = new TriggerProjectIndex(project());
    expect(index.compareTriggers(index.triggers[0], index.triggers[1]) < 0).toBe(true);
    expect(index.compareTriggers(index.triggers[1], index.triggers[0]) > 0).toBe(true);
  });

  it('getSceneProjection 平铺绑定，不去按 flowGroup 归组', () => {
    const index = new TriggerProjectIndex(project());
    const bindings = [
      { id: 'b1', binding: { triggerId: 'trg.a', type: 'trigger' } },
      { id: 'b2', binding: { triggerId: 'trg.b', type: 'trigger' } }
    ];
    const projection = index.getSceneProjection('S01', bindings);
    expect(projection.bindings.map(b => b.id)).toEqual(['b1', 'b2']);
    expect(projection.bindings[0].trigger?.id).toBe('trg.a');
    expect(projection.bindings[1].trigger?.id).toBe('trg.b');
    // triggers：绑定实际引用，保持定义顺序
    expect(projection.triggers.map(t => t.id)).toEqual(['trg.a', 'trg.b']);
    // tutorials：按 sceneId scope 过滤
    expect(projection.tutorials.map(t => t.id)).toEqual(['tut.1']);
  });

  it('未绑定到已知 Trigger 的 binding 解析为 undefined trigger', () => {
    const index = new TriggerProjectIndex(project());
    const projection = index.getSceneProjection('S01', [
      { id: 'orphan', binding: { triggerId: 'trg.ghost', type: 'trigger' } }
    ]);
    expect(projection.bindings[0].trigger).toBeNull();
    expect(projection.triggers).toHaveLength(0);
  });

  it('getBindingsForTrigger 返回场景绑定记录', () => {
    const index = new TriggerProjectIndex(project(), {
      sceneDocuments: [{
        id: 'S01',
        layers: [{ objects: [
          { type: 'trigger', triggerId: 'trg.a', name: 'A空间' }
        ] }]
      }]
    });
    const records = index.getBindingsForTrigger('trg.a', 'S01');
    expect(records).toHaveLength(1);
    expect(records[0].sceneId).toBe('S01');
  });
});