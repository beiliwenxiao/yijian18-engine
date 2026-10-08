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
import { ChunkNavigator } from './ChunkNavigator.js';

function worldIndex() {
  const region = { id: 'A', chunkWidth: 100, chunkHeight: 80 };
  return {
    findScene: sceneId => sceneId === 'S02' ? { sceneId, regionId: 'A' } : null,
    isLoadable: sceneId => sceneId === 'S02',
    getRegion: () => region,
    getOffset: () => ({ x: 100, y: 80 })
  };
}

describe('ChunkNavigator transaction boundary', () => {
  it('目标提交失败时恢复玩家、相机和外部 Story/streaming 草稿', async () => {
    const player = { position: { x: 10, y: 20 } };
    const camera = { position: { x: 10, y: 20 } };
    const external = { sceneId: 'S01', story: { completed: false }, streaming: 'old' };
    let runtime = structuredClone(external);
    const restoreState = vi.fn(snapshot => { runtime = structuredClone(snapshot); });
    const navigator = new ChunkNavigator({
      getWorldIndex: worldIndex,
      getChunk: sceneId => ({ sceneId }),
      getPlayer: () => player,
      getCamera: () => camera,
      captureState: () => structuredClone(runtime),
      restoreState,
      prepareTarget: () => {
        runtime.streaming = 'target';
        return { ok: true };
      },
      onSceneEnter: () => {
        runtime.sceneId = 'S02';
        runtime.story.completed = true;
        throw new Error('projection failed');
      }
    });

    const result = await navigator.teleport({ sceneId: 'S02', x: 5, y: 6 });

    expect(result).toMatchObject({ ok: false, cancelled: true, reason: 'targetCommitFailed' });
    expect(player.position).toEqual({ x: 10, y: 20 });
    expect(camera.position).toEqual({ x: 10, y: 20 });
    expect(runtime).toEqual(external);
    expect(restoreState).toHaveBeenCalledTimes(1);
  });

  it('目标预检失败时不发送 sceneEnter notification', async () => {
    const onSceneEnter = vi.fn();
    const navigator = new ChunkNavigator({
      getWorldIndex: worldIndex,
      getChunk: sceneId => ({ sceneId }),
      getPlayer: () => ({ position: { x: 1, y: 2 } }),
      getCamera: () => ({ position: { x: 1, y: 2 } }),
      prepareTarget: () => ({ ok: false, errors: [{ code: 'missingProjection' }] }),
      onSceneEnter
    });

    const result = await navigator.teleport({ sceneId: 'S02' });
    expect(result).toMatchObject({ ok: false, cancelled: true, reason: 'targetPrepareFailed' });
    expect(onSceneEnter).not.toHaveBeenCalled();
  });
});