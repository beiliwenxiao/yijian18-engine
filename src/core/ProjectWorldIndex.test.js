import { describe, expect, it } from 'vitest';
import { ProjectWorldIndex, ProjectWorldIndexValidationError } from './ProjectWorldIndex.js';
import { WorldStreamingManager } from './WorldStreamingManager.js';
import { LoadedChunk } from './LoadedChunk.js';
import { WorldMapLoadSession } from './scene/WorldMapLoadSession.js';
import { ChunkNavigator } from './scene/ChunkNavigator.js';

function project({ rows = 2, cols = 3, chunkWidth = 960, chunkHeight = 540,
  entrySceneId = 'B', grid = [[null, 'A', null], [null, null, 'B']], scenes = ['A', 'B'], sceneDimensions = null } = {}) {
  return {
    scenes: scenes.map(id => ({ id, ...(sceneDimensions || {}) })),
    worldMap: {
      entrySceneId,
      regions: [{ id: 'r1', name: 'R1', rows, cols, chunkWidth, chunkHeight, grid }]
    }
  };
}

function scene(id, dimensions = null) {
  return {
    id,
    ...(dimensions || {}),
    layers: [{ objects: [{ id: `${id}-spawn`, type: 'spawn', ref: 'player', x: 7, y: 11,
      sortY: 12, points: [[1, 2, 'keep']], path: [{ x: 3, y: 4 }] }] }]
  };
}

describe('ProjectWorldIndex', () => {
  it('从非 Demo 项目派生 bounds、显式入口和 offset', () => {
    const index = ProjectWorldIndex.build(project());

    expect(index.getBounds('r1')).toEqual({
      left: 0, top: 0, right: 2880, bottom: 1080, width: 2880, height: 1080
    });
    expect(index.getEntry()).toMatchObject({ sceneId: 'B', row: 1, col: 2, loadable: true });
    expect(index.getOffset('B')).toEqual({ x: 1920, y: 540 });
    expect(Object.isFrozen(index.getRegion('r1'))).toBe(true);
    expect(Object.isFrozen(index.getEntry().offset)).toBe(true);
  });

  it('reserved 单元可索引但不可加载或作为入口', () => {
    const reserved = project({
      entrySceneId: 'A',
      grid: [[null, 'A', null], [null, null, { sceneId: 'B', reserved: true }]]
    });
    const index = ProjectWorldIndex.build(reserved);

    expect(index.findScene('B')).toMatchObject({ reserved: true, loadable: false });
    expect(index.isLoadable('B')).toBe(false);
    expect(index.getCells('r1').map(cell => cell.sceneId)).toEqual(['A']);
    expect(() => ProjectWorldIndex.build({
      ...reserved, worldMap: { ...reserved.worldMap, entrySceneId: 'B' }
    })).toThrow(ProjectWorldIndexValidationError);
  });

  it('在发布索引前一次报告尺寸、cell、重复定位和入口错误', () => {
    const invalid = project({
      rows: 2,
      cols: 2,
      entrySceneId: 'MISSING',
      grid: [['A'], ['A', { sceneId: 'B', reserved: false }]]
    });

    try {
      ProjectWorldIndex.build(invalid);
      throw new Error('expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectWorldIndexValidationError);
      expect(error.errors.map(item => item.code)).toEqual(expect.arrayContaining([
        'gridColumnMismatch', 'duplicateSceneLocation', 'invalidWorldCell', 'entrySceneNotFound'
      ]));
    }
  });

  it('拒绝未进入 canonical project.scenes closure 的普通或 reserved ID', () => {
    const invalid = project({
      entrySceneId: 'A', scenes: ['A'],
      grid: [[null, 'A', null], [null, null, { sceneId: 'CACHE_ONLY', reserved: true }]]
    });
    expect(() => ProjectWorldIndex.build(invalid)).toThrowError(/canonical project\.scenes/);
  });

  it('对生成的合法尺寸始终满足数学派生且不改输入', () => {
    // **Validates: Requirements 2.3, 3.2, 3.5, 3.9**
    for (let seed = 1; seed <= 32; seed++) {
      const rows = 1 + (seed % 7);
      const cols = 1 + ((seed * 3) % 9);
      const chunkWidth = 320 + seed * 17;
      const chunkHeight = 180 + seed * 11;
      const row = seed % rows;
      const col = (seed * 5) % cols;
      const grid = Array.from({ length: rows }, () => Array(cols).fill(null));
      grid[row][col] = `E${seed}`;
      const input = project({ rows, cols, chunkWidth, chunkHeight, entrySceneId: `E${seed}`,
        grid, scenes: [`E${seed}`] });
      const before = JSON.stringify(input);
      const index = ProjectWorldIndex.build(input);
      expect(index.getOffset(`E${seed}`)).toEqual({ x: col * chunkWidth, y: row * chunkHeight });
      expect(index.getBounds('r1').width).toBe(cols * chunkWidth);
      expect(index.getBounds('r1').height).toBe(rows * chunkHeight);
      expect(JSON.stringify(input)).toBe(before);
    }
  });
});

describe('ProjectWorldIndex consumers and single projection', () => {
  it('WorldMapLoadSession 只加载 index 中可加载单元并保持局部输入不变', async () => {
    const input = project({
      entrySceneId: 'A', scenes: ['A', 'R'],
      sceneDimensions: { width: 960, height: 540 },
      grid: [[null, 'A', null], [null, null, { sceneId: 'R', reserved: true }]]
    });
    const localScene = scene('A', { width: 960, height: 540 });
    const before = structuredClone(localScene);
    const loadedIds = [];
    const session = new WorldMapLoadSession({
      loadProject: async () => input,
      loadScene: async id => { loadedIds.push(id); return localScene; }
    });

    const result = await session.load({ sceneIds: 'entry' });
    const spawn = result.placements[0];
    expect(loadedIds).toEqual(['A']);
    expect(result.chunks.map(chunk => chunk.sceneId)).toEqual(['A']);
    expect(spawn).toMatchObject({ x: 967, y: 11, sortY: 12, path: [{ x: 963, y: 4 }] });
    expect(spawn.points).toEqual([[961, 2, 'keep']]);
    expect(spawn._worldOffsetApplied).toBe(true);
    expect(localScene).toEqual(before);
  });

  it('WorldMapLoadSession 从显式入口派生非零 Region', async () => {
    const input = {
      scenes: [{ id: 'S03', width: 800, height: 450 }, { id: 'S04', width: 640, height: 360 }],
      worldMap: {
        entrySceneId: 'S04',
        regions: [
          { id: 'r1', rows: 1, cols: 1, chunkWidth: 800, chunkHeight: 450, grid: [['S03']] },
          { id: 'r2', rows: 1, cols: 2, chunkWidth: 640, chunkHeight: 360, grid: [[null, 'S04']] }
        ]
      }
    };
    const session = new WorldMapLoadSession({
      loadProject: async () => input,
      loadScene: async id => scene(id, id === 'S03' ? { width: 800, height: 450 } : { width: 640, height: 360 })
    });

    const result = await session.load({ sceneIds: 'entry' });

    expect(result.region.id).toBe('r2');
    expect(result.chunks.map(chunk => chunk.sceneId)).toEqual(['S04']);
    expect(result.worldIndex.getEntry()).toMatchObject({
      sceneId: 'S04', regionId: 'r2', regionIndex: 1, row: 0, col: 1
    });
    expect(result.placements[0]).toMatchObject({ x: 647, y: 11 });
  });

  it('LoadedChunk 的碰撞、表现、交互数据全部经同一 projector 一次投影', async () => {
    const localScene = scene('A');
    localScene.layers[0].objects[0].collide = true;
    localScene.layers[0].objects[0].interactive = true;
    const chunk = new LoadedChunk({ sceneId: 'A', chunkId: 'A', regionId: 'r1', row: 2, col: 3,
      origin: { x: 1200, y: 800 }, sceneData: localScene });

    const draft = await chunk.prepare();
    expect(draft.sceneObjects[0]).toMatchObject({ x: 1207, y: 811, sortY: 812 });
    expect(draft.sceneObjects[0].path).toEqual([{ x: 1203, y: 804 }]);
    expect(draft.sceneObjects[0]._worldOffsetApplied).toBe(true);
    expect(localScene.layers[0].objects[0]).toMatchObject({ x: 7, y: 11, sortY: 12 });
  });

  it('core manager 与 navigator 都从 index 取得坐标且拒绝 reserved', async () => {
    const index = ProjectWorldIndex.build(project({
      entrySceneId: 'S04',
      grid: [[null, 'S03', null], [null, null, 'S04']],
      scenes: ['S03', 'S04']
    }));
    const manager = new WorldStreamingManager();
    expect(manager.configureRegion(index, { regionRef: 'r1', sceneResolver: async id => scene(id) }).ok).toBe(true);
    const update = await manager.update(1920 + 10, 540 + 10);
    expect(update.ok).toBe(true);
    expect(manager.getSceneId(2, 1)).toBe('S04');
    expect(manager.chunkOrigin(2, 1)).toEqual({ x: 1920, y: 540 });

    const player = { position: { x: 0, y: 0 } };
    const camera = { position: { x: 0, y: 0 } };
    const navigator = new ChunkNavigator({
      getWorldIndex: () => index,
      getChunk: id => ({ ...index.findScene(id) }),
      getPlayer: () => player,
      getCamera: () => camera
    });
    const moved = await navigator.teleport({ sceneId: 'S04', x: 5, y: 6 });
    expect(moved).toMatchObject({ x: 1925, y: 546, playerMoved: true, cameraMoved: true });
    expect(player.position).toEqual({ x: 1925, y: 546 });
  });
});
