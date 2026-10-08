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

import { describe, it, expect } from 'vitest';
import {
  projectSnapshotToSdd,
  projectSddToSnapshot,
  sddSemanticEquals,
  SDD_SCHEMA_VERSION
} from './SddProjection.js';

/**
 * SDD v3 投影等价性（阶段 1b）：
 * 对任意旧快照形状，projectSddToSnapshot(projectSnapshotToSdd(snapshot))
 * 必须与原快照在语义字段上深相等——这是双写不双读的安全前提。
 */

/** 伪随机生成器（可复现）：mulberry32。 */
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state |= 0; state = state + 0x6D2B79F5 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** 随机生成一个 data.game 形状的快照段（覆盖全部已知 section）。 */
function makeRandomGameSnapshot(rng, depth = 0) {
  const maybe = (probability, factory) => (rng() < probability ? factory() : undefined);
  return {
    campaignId: 'sanguo-zhangjiao-s01-s14',
    schemaVersion: 5,
    currentSceneId: `S0${1 + Math.floor(rng() * 9)}`,
    player: {
      id: 'player-1',
      name: maybe(0.8, () => '张角'),
      transform: { position: { x: rng() * 10000, y: rng() * 7000 }, rotation: 0 },
      stats: { hp: Math.floor(rng() * 100), mp: Math.floor(rng() * 50), level: 1 + Math.floor(rng() * 9) },
      inventory: { slots: rng() < 0.5 ? [{ item: { id: 'item.potion.hp' }, count: Math.floor(rng() * 9) }] : [] },
      equipment: rng() < 0.5 ? { slots: {} } : undefined
    },
    tutorial: maybe(0.6, () => ({ phase: 'attack', completed: rng() < 0.5 })),
    dialogue: maybe(0.4, () => ({ activeId: 'dlg.s02.awakening' })),
    authority: {
      snapshotSchemaVersion: 2,
      definitionRevision: Math.floor(rng() * 10),
      stateRevisions: { storyState: Math.floor(rng() * 20) },
      lastEventSequence: Math.floor(rng() * 1000),
      logicalClock: { logical: rng() * 600 },
      rngState: { seed: Math.floor(rng() * 1e9) },
      operationLedger: {
        entries: rng() < 0.7
          ? [{ operationId: `op:${Math.floor(rng() * 1e6)}`, status: 'committed', result: { ok: true } }]
          : []
      },
      serviceStates: {
        eventJournal: rng() < 0.6 ? { version: 1, records: [{ eventId: `evt:${Math.floor(rng() * 1e6)}`, status: 'committed' }] } : undefined,
        quests: {
          schemaVersion: 2,
          definitionRevision: Math.floor(rng() * 10),
          taskGraph: { nodes: { [`task.s0${1 + Math.floor(rng() * 9)}.main`]: { status: rng() < 0.5 ? 'completed' : 'active' } } },
          actors: [{ actorId: 'player-1', runtimes: {} }]
        },
        campaignContent: {
          blackboard: { storyState: { currentSceneId: 'S01', s01Survival: { firstWolfKilled: rng() < 0.5 } } },
          triggers: { version: 1, records: [] }
        }
      }
    },
    scene: depth < 1 ? {
      worldStreamingState: {
        schemaVersion: 2,
        regionId: 'mainland',
        current: { col: 6, row: 5 },
        chunks: [{
          schemaVersion: 2,
          chunkId: 'S01',
          sceneNamespace: 'S01',
          col: 6,
          row: 5,
          worldWidth: 1280,
          worldHeight: 720,
          chunkState: null,
          providers: {
            demoDynamic: {
              schemaVersion: 2,
              sceneNamespace: 'S01',
              resourceNodes: [{ id: 'S01-berry-bush', state: { remaining: Math.floor(rng() * 10) } }],
              placementStates: [{
                id: `S01-first-wolf-${1 + Math.floor(rng())}`,
                state: { kind: 'enemy', removed: rng() < 0.5, hp: Math.floor(rng() * 40) }
              }],
              deathDrops: [],
              s10StructureStates: [],
              vehicleStates: []
            }
          }
        }]
      },
      campfireLit: rng() < 0.5,
      clearedGroups: rng() < 0.5 ? ['S01-wolf-group'] : []
    } : undefined
  };
}

describe('SDD 投影：基础形状', () => {
  it('完整快照投影出 v3 文档：quests/narrative 平铺出 authority.serviceStates', () => {
    const snapshot = { version: 1, createdAt: 1, meta: {}, data: { game: makeRandomGameSnapshot(makeRng(1)) } };
    const doc = projectSnapshotToSdd(snapshot);
    expect(doc.sddSchemaVersion).toBe(SDD_SCHEMA_VERSION);
    expect(doc.quests.schemaVersion).toBe(2);
    expect(doc.narrative.blackboard.storyState.currentSceneId).toBe('S01');
    expect(doc.clock.operationLedger).toBeTruthy();
    expect(doc.world.scene.worldStreamingState.chunks[0].chunkId).toBe('S01');
    expect(doc.player.stats.hp).toBe(snapshot.data.game.player.stats.hp);
  });

  it('容忍缺段：空对象与部分段不抛', () => {
    expect(projectSnapshotToSdd({}).sddSchemaVersion).toBe(SDD_SCHEMA_VERSION);
    const partial = projectSnapshotToSdd({ data: { game: { player: { hp: 3 } } } });
    expect(partial.player).toEqual({ hp: 3 });
    expect(partial.quests).toBeNull();
    expect(partial.clock.logicalClock).toBeNull();
  });
});

describe('SDD 投影：随机档往返等价性（双写安全前提）', () => {
  it('100 份随机快照：roundtrip(v1) ≡ 原快照（剥离 undefined 后深相等）', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rng = makeRng(seed);
      const game = makeRandomGameSnapshot(rng);
      const snapshot = { version: 1, createdAt: seed, meta: {}, data: { game } };
      const doc = projectSnapshotToSdd(snapshot);
      const roundtrip = projectSddToSnapshot(doc);
      expect(
        sddSemanticEquals(roundtrip, game),
        `seed=${seed} 往返不等价`
      ).toBe(true);
    }
  });

  it('roundtrip 后的快照仍能被再次投影且形状稳定（幂等）', () => {
    const rng = makeRng(42);
    const game = makeRandomGameSnapshot(rng);
    const doc = projectSnapshotToSdd({ data: { game } });
    const roundtrip = projectSddToSnapshot(doc);
    const doc2 = projectSnapshotToSdd({ data: { game: roundtrip } });
    expect(sddSemanticEquals(doc2, doc)).toBe(true);
  });
});
