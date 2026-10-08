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

import { describe, expect, it, vi } from 'vitest';
import { QuestHud, QuestIntentClient, QuestNpcMarker, QuestProjectionView, QuestTracker } from './QuestProjectionView.js';

const projection = Object.freeze({ value: Object.freeze({ quests: Object.freeze([
  Object.freeze({ id: 'quest.one', state: 'active', tracked: true, giverNPCId: 'npc.a', objectives: [] }),
  Object.freeze({ id: 'quest.two', state: 'completed', tracked: false, turnInNPCId: 'npc.b', objectives: [] }),
  Object.freeze({ id: 'quest.three', state: 'available', giverNPCId: 'npc.c', objectives: [] })
]) }) });

describe('QuestProjectionView', () => {
  it('Tracker、NPC marker 与 HUD 只从 ProjectionStore immutable view 派生', () => {
    const store = { get: () => projection, list: () => [projection] };
    const view = new QuestProjectionView({ projectionStore: store, projectionId: 'quest:actor' });
    expect(Object.isFrozen(view.all())).toBe(true);
    expect(new QuestTracker(view).items().map(item => item.id)).toEqual(['quest.one']);
    expect(new QuestHud(view).items().map(item => item.id)).toEqual(['quest.one', 'quest.two']);
    const marker = new QuestNpcMarker(view);
    expect(marker.markerFor('npc.b')).toBe('completable');
    expect(marker.markerFor('npc.c')).toBe('available');
  });

  it('任务操作只通过 CommandGateway 发送 accept/advance/abandon/turnIn/track intent', async () => {
    const execute = vi.fn(async intent => ({ ok: true, intent }));
    const client = new QuestIntentClient({ commandGateway: { execute }, actorRef: 'actor.one' });
    await client.accept('quest.one');
    await client.advance('quest.one', { type: 'collect' });
    await client.abandon('quest.one');
    await client.turnIn('quest.one');
    await client.track('quest.one', true);
    expect(execute.mock.calls.map(([intent]) => intent.payload.operation)).toEqual(['accept', 'advance', 'abandon', 'turnIn', 'track']);
    expect(execute.mock.calls.every(([intent]) => intent.intentType === 'quest.command' && intent.actorRef === 'actor.one')).toBe(true);
  });
});
