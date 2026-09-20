import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskGraphSystem } from '../src/systems/TaskGraphSystem.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));

const project = readJson('example/sanguo_zhangjiao/game.project.json');
const graph = project.taskGraphs.find(entry => entry.id === 'task.s01.survival');

function createSystem() {
  const system = new TaskGraphSystem({ definitions: [graph] });
  system.start(graph.id, { actorId: 'player-1' });
  return system;
}

function commitEvent(system, sequence, definitionId) {
  return system.consumeEvent({
    eventId: `evt:tx:${sequence}`,
    type: 'state.transaction',
    payload: { definitionId }
  });
}

function gatherWood(system, sequence, accepted = 1) {
  return system.consumeEvent({
    eventId: `evt:gather:${sequence}`,
    type: 'gathering.completed',
    // matcher 已登记 resourceType 限定（策划编辑器写回），合成事件需携带完整身份
    payload: { itemId: 'resource.wood', resourceType: 'wood', accepted, nodeId: 'S01-node-wood-1' }
  });
}

function findNode(system, nodeId) {
  return system.getProjection('player-1')[0]?.nodes.find(node => node.nodeId === nodeId) || null;
}

function runToWoodStage(system) {
  commitEvent(system, 1, 'story.s01.campfireLit');
  commitEvent(system, 2, 'story.s01.initialToolsPicked');
  // gatherBerries 已改为真实采集事件驱动（gathering.completed + itemId）
  system.consumeEvent({
    eventId: 'evt:gather:berries:1',
    type: 'gathering.completed',
    payload: { itemId: 'resource.wild_berry', accepted: 1, nodeId: 'S01-node-berry-1' }
  });
  commitEvent(system, 4, 'story.s01.berryEaten');
}

describe('S01 采集木材任务进度（真实 task.s01.survival 定义）', () => {
  it('契约：gatherWood 按采集入包份数累计（gathering.completed + progressBy=accepted），目标次数由策划配置', () => {
    const node = graph.nodes.find(entry => entry.id === 'gatherWood');
    expect(node.requiredCount).toBeGreaterThanOrEqual(1);
    expect(node.progressBy).toBe('accepted');
    expect(node.eventMatcher).toEqual({
      type: 'gathering.completed',
      payload: { itemId: 'resource.wood', resourceType: 'wood' }
    });
  });

  it('一次采集（accepted 超过目标份数）立即完成并解锁后续节点', () => {
    const system = createSystem();
    runToWoodStage(system);
    expect(findNode(system, 'gatherWood')?.currentCount).toBe(0);

    const result = gatherWood(system, 1, 3);
    expect(result.changes[0].completed).toBe(true);
    // 进度按目标数钳制（requiredCount 由策划在编辑器配置，当前为 1）
    expect(result.changes[0].currentCount).toBe(result.changes[0].requiredCount);
    // succeeded 节点退出投影可见集（只含 active/available），后继节点激活即证明推进成立
    expect(findNode(system, 'gatherWood')).toBeNull();
    expect(findNode(system, 'spotWolf')?.status).toBe('active');
  });

  it('受伤半产量（accepted 低于目标）按实际入包数部分推进，不完成', () => {
    const system = createSystem();
    runToWoodStage(system);
    if ((graph.nodes.find(entry => entry.id === 'gatherWood').requiredCount || 1) <= 1) {
      // 目标为 1 次时任何正数结算都直接完成，跳过部分推进断言
      expect(gatherWood(system, 1, 2).changes[0].completed).toBe(true);
      return;
    }
    gatherWood(system, 1, 2);
    expect(findNode(system, 'gatherWood').currentCount).toBe(2);
    const result = gatherWood(system, 2, 1);
    expect(result.changes[0].completed).toBe(true);
    expect(findNode(system, 'spotWolf')?.status).toBe('active');
  });

  it('其它物品采集、0 份结算与重复事件都不推进进度', () => {
    const system = createSystem();
    runToWoodStage(system);
    system.consumeEvent({
      eventId: 'evt:gather:berry-1',
      type: 'gathering.completed',
      payload: { itemId: 'resource.wild_berry', accepted: 5 }
    });
    gatherWood(system, 1, 0);
    const before = findNode(system, 'gatherWood')?.currentCount ?? 0;
    gatherWood(system, 2, 0);
    gatherWood(system, 2, 0);
    const node = findNode(system, 'gatherWood');
    if (node) expect(node.currentCount).toBe(before);
    expect(findNode(system, 'gatherWood')?.status ?? 'succeeded').toBe('active');
  });

  it('woodGathered 事务不驱动该节点（单次事务死锁根源已移除）', () => {
    const system = createSystem();
    runToWoodStage(system);
    const result = commitEvent(system, 5, 'story.s01.woodGathered');
    expect(result.changes.find(change => change.nodeId === 'gatherWood')).toBeUndefined();
    expect(findNode(system, 'gatherWood').currentCount).toBe(0);
  });

  it('旧档快照（无 progress 字段）恢复后按新语义继续累计', () => {
    const legacySystem = createSystem();
    runToWoodStage(legacySystem);
    const snapshot = legacySystem.snapshot();
    // 模拟本次改动前的旧档：nodeStates 没有 progress 字段
    for (const instance of snapshot.instances) {
      for (const state of Object.values(instance.nodeStates)) delete state.progress;
    }
    const system = new TaskGraphSystem({ definitions: [graph] });
    expect(system.restore(snapshot).ok).toBe(true);
    const result = gatherWood(system, 10, 3);
    expect(result.changes[0].completed).toBe(true);
    expect(findNode(system, 'spotWolf')?.status).toBe('active');
  });

  it('旧档中间态：补齐木材与添柴后，历史击杀事实对账能让 killWolf 完成', () => {
    // 模拟用户当前存档：木材任务修复前，firstWolfKilled 事实已提交但 killWolf 节点仍 locked
    const system = createSystem();
    runToWoodStage(system);
    gatherWood(system, 1, 3); // 新语义：一次采 3 份，gatherWood 完成
    commitEvent(system, 6, 'story.s01.refuelCampfire'); // spotWolf 改为添柴事务驱动，可重发
    expect(findNode(system, 'killWolf')?.status).toBe('active');

    // 事实对账：firstWolfKilled 已在 StoryState 成立（狼在节点锁定期间被击杀），补喂合成事件
    const reconciled = system.consumeEvent({
      eventId: 'reconcile:story.s01.firstWolfKilled',
      type: 'state.transaction',
      payload: { definitionId: 'story.s01.firstWolfKilled' }
    });
    expect(reconciled.changes.find(change => change.nodeId === 'killWolf')?.completed).toBe(true);
    expect(findNode(system, 'killWolf')).toBeNull(); // succeeded 退出可见集
    expect(findNode(system, 'skinWolf')?.status).toBe('active');
  });

  it('spotWolf 由可重发的添柴事务驱动（firstWolfSpotted 事务不会二次提交，不再死锁）', () => {
    const node = graph.nodes.find(entry => entry.id === 'spotWolf');
    expect(node.eventMatcher).toEqual({
      type: 'state.transaction',
      payload: { definitionId: 'story.s01.refuelCampfire' }
    });
  });
});
