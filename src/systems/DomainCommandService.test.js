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
import { DomainCommandService } from './DomainCommandService.js';

const command = Object.freeze({
  commandType: 'battle.command', operationId: 'operation:one', actorId: 'player',
  payload: { battleId: 'battle.one', operation: 'battle.open' }
});
const context = Object.freeze({
  preparedStateRevision: { stateId: 'domain:battle.command', next: 4 },
  commitStateRevision: vi.fn(() => ({ ok: true, stateRevision: 4 }))
});

describe('DomainCommandService', () => {
  it('在受控 Facade 成功后统一提交 revision 并返回提交后通知', async () => {
    const facade = { execute: vi.fn(async value => ({ ok: true, value })) };
    const service = new DomainCommandService({ ports: { 'battle.command': facade } });
    const result = await service.execute(command, context);
    expect(facade.execute).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'operation:one' }));
    expect(context.commitStateRevision).toHaveBeenCalledWith(context.preparedStateRevision);
    expect(result.result).toMatchObject({ ok: true, committed: true, stateRevision: 4 });
    expect(result.committedEvents[0].type).toBe('battle.command.committed');
  });

  it('拒绝未知 operation 而不提交 revision 或通知', async () => {
    const service = new DomainCommandService({ ports: { 'battle.command': { execute: async () => ({ ok: false, code: 'blocked' }) } } });
    const result = await service.execute(command, context);
    expect(result).toMatchObject({ ok: false, committed: false, code: 'blocked' });
    expect(result.committedEvents).toBeUndefined();
  });
});