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

/**
 * NPCSystem.test.js
 * NPC交互系统单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NPCType,
  NPCState,
  DialogOption,
  DialogNode,
  DialogTree,
  NPC,
  NPCSystem
} from './NPCSystem.js';

describe('NPCType', () => {
  it('should have all NPC types defined', () => {
    expect(NPCType.QUEST_GIVER).toBe('quest_giver');
    expect(NPCType.MERCHANT).toBe('merchant');
    expect(NPCType.TRAINER).toBe('trainer');
    expect(NPCType.GUARD).toBe('guard');
    expect(NPCType.VILLAGER).toBe('villager');
    expect(NPCType.BLACKSMITH).toBe('blacksmith');
    expect(NPCType.INNKEEPER).toBe('innkeeper');
    expect(NPCType.BANKER).toBe('banker');
  });
});

describe('NPCState', () => {
  it('should have all states defined', () => {
    expect(NPCState.IDLE).toBe('idle');
    expect(NPCState.WALKING).toBe('walking');
    expect(NPCState.TALKING).toBe('talking');
    expect(NPCState.WORKING).toBe('working');
    expect(NPCState.SLEEPING).toBe('sleeping');
  });
});

describe('DialogOption', () => {
  it('should create option with default values', () => {
    const option = new DialogOption();
    expect(option.text).toBe('');
    expect(option.visible).toBe(true);
  });

  it('should create option with custom values', () => {
    const option = new DialogOption({
      id: 'test',
      text: 'Test option',
      nextDialogId: 'next',
      action: 'test_action'
    });
    expect(option.id).toBe('test');
    expect(option.text).toBe('Test option');
    expect(option.nextDialogId).toBe('next');
    expect(option.action).toBe('test_action');
  });

  it('should check availability based on conditions', () => {
    const option = new DialogOption({
      condition: { minLevel: 10 }
    });
    
    expect(option.isAvailable({ level: 5 })).toBe(false);
    expect(option.isAvailable({ level: 10 })).toBe(true);
    expect(option.isAvailable({ level: 15 })).toBe(true);
  });

  it('should check quest condition', () => {
    const option = new DialogOption({
      condition: { requiredQuest: 'quest1' }
    });
    
    expect(option.isAvailable({ completedQuests: [] })).toBe(false);
    expect(option.isAvailable({ completedQuests: ['quest1'] })).toBe(true);
  });
});

describe('DialogNode', () => {
  it('should create node with default values', () => {
    const node = new DialogNode();
    expect(node.speaker).toBe('NPC');
    expect(node.text).toBe('');
    expect(node.options).toEqual([]);
  });

  it('should create node with options', () => {
    const node = new DialogNode({
      id: 'test_node',
      speaker: 'Test NPC',
      text: 'Hello!',
      options: [
        { id: 'opt1', text: 'Option 1' },
        { id: 'opt2', text: 'Option 2' }
      ]
    });
    
    expect(node.options.length).toBe(2);
    expect(node.options[0]).toBeInstanceOf(DialogOption);
  });

  it('should get available options', () => {
    const node = new DialogNode({
      options: [
        { id: 'opt1', text: 'Option 1' },
        { id: 'opt2', text: 'Option 2', condition: { minLevel: 10 } }
      ]
    });
    
    const available = node.getAvailableOptions({ level: 5 });
    expect(available.length).toBe(1);
    expect(available[0].id).toBe('opt1');
  });
});

describe('DialogTree', () => {
  it('should create tree with nodes', () => {
    const tree = new DialogTree({
      startNodeId: 'start',
      nodes: [
        { id: 'start', text: 'Hello' },
        { id: 'end', text: 'Goodbye' }
      ]
    });
    
    expect(tree.nodes.size).toBe(2);
    expect(tree.startNodeId).toBe('start');
  });

  it('should get start node', () => {
    const tree = new DialogTree({
      nodes: [{ id: 'first', text: 'First' }]
    });
    
    const startNode = tree.getStartNode();
    expect(startNode.id).toBe('first');
  });

  it('should add nodes', () => {
    const tree = new DialogTree();
    tree.addNode(new DialogNode({ id: 'new_node', text: 'New' }));
    
    expect(tree.getNode('new_node')).not.toBeNull();
  });
});

describe('NPC', () => {
  let npc;

  beforeEach(() => {
    npc = new NPC({
      id: 'test_npc',
      name: 'Test NPC',
      type: NPCType.MERCHANT,
      mapId: 'test_map',
      position: { x: 100, y: 100 },
      interactionRadius: 50
    });
  });

  it('should create NPC with correct properties', () => {
    expect(npc.id).toBe('test_npc');
    expect(npc.name).toBe('Test NPC');
    expect(npc.type).toBe(NPCType.MERCHANT);
    expect(npc.state).toBe(NPCState.IDLE);
  });

  it('should check if player is in range', () => {
    expect(npc.isInRange({ x: 100, y: 100 })).toBe(true);
    expect(npc.isInRange({ x: 120, y: 100 })).toBe(true);
    expect(npc.isInRange({ x: 200, y: 200 })).toBe(false);
  });

  it('should change state on interact', () => {
    npc.interact({});
    expect(npc.state).toBe(NPCState.TALKING);
  });

  it('should end interaction', () => {
    npc.interact({});
    npc.endInteraction();
    expect(npc.state).toBe(NPCState.IDLE);
  });

  it('should get available quests', () => {
    npc.availableQuests = ['quest1', 'quest2'];
    
    const available = npc.getAvailableQuests({ activeQuests: [], completedQuests: [] });
    expect(available.length).toBe(2);
    
    const filtered = npc.getAvailableQuests({ activeQuests: ['quest1'], completedQuests: [] });
    expect(filtered.length).toBe(1);
  });

  it('should get quest marker', () => {
    npc.availableQuests = ['quest1'];
    npc.completableQuests = ['quest2'];
    
    expect(npc.getQuestMarker({ activeQuests: [], completedQuests: [] })).toBe('available');
    expect(npc.getQuestMarker({ activeQuests: ['quest2'], completedQuests: [] })).toBe('completable');
  });

  it('should update friendliness', () => {
    npc.addFriendliness(10);
    expect(npc.friendliness).toBe(60);
    
    npc.addFriendliness(-100);
    expect(npc.friendliness).toBe(0);
    
    npc.addFriendliness(200);
    expect(npc.friendliness).toBe(100);
  });

  it('should serialize correctly', () => {
    const data = npc.serialize();
    expect(data.id).toBe('test_npc');
    expect(data.name).toBe('Test NPC');
    expect(data.position).toEqual({ x: 100, y: 100 });
  });
});

describe('NPCSystem', () => {
  let system;

  beforeEach(() => {
    system = new NPCSystem();
  });

  it('should initialize with default NPCs', () => {
    expect(system.npcs.size).toBeGreaterThan(0);
    expect(system.getNPC('village_chief')).not.toBeNull();
  });

  it('should register custom NPC', () => {
    const npc = new NPC({
      id: 'custom_npc',
      name: 'Custom NPC',
      mapId: 'test_map'
    });
    
    system.registerNPC(npc);
    expect(system.getNPC('custom_npc')).toBe(npc);
  });

  it('should get NPCs by map', () => {
    const npcs = system.getNPCsByMap('starter_village');
    expect(npcs.length).toBeGreaterThan(0);
  });

  it('should get NPCs in range', () => {
    const npcs = system.getNPCsInRange('starter_village', { x: 200, y: 150 }, 100);
    expect(npcs.length).toBeGreaterThan(0);
  });

  it('should start dialog', () => {
    const onDialogStart = vi.fn();
    system.on('dialogStart', onDialogStart);
    
    const node = system.startDialog('village_chief', {});
    
    expect(node).not.toBeNull();
    expect(system.currentNPC).not.toBeNull();
    expect(onDialogStart).toHaveBeenCalled();
  });

  it('should select dialog option', () => {
    system.startDialog('village_chief', {});
    
    const result = system.selectOption('ask_village', {});
    expect(result.node).not.toBeNull();
  });

  it('should end dialog', () => {
    const onDialogEnd = vi.fn();
    system.on('dialogEnd', onDialogEnd);
    
    system.startDialog('village_chief', {});
    system.endDialog();
    
    expect(system.currentNPC).toBeNull();
    expect(onDialogEnd).toHaveBeenCalled();
  });

  it('should emit dialog action', () => {
    const onDialogAction = vi.fn();
    system.on('dialogAction', onDialogAction);
    
    system.startDialog('village_chief', {});
    system.selectOption('goodbye', {});
    
    expect(onDialogAction).toHaveBeenCalled();
  });

  it('should get stats', () => {
    const stats = system.getStats();
    expect(stats.totalNPCs).toBeGreaterThan(0);
    expect(stats.isInDialog).toBe(false);
  });

  it('should reset system', () => {
    system.startDialog('village_chief', {});
    system.reset();
    
    expect(system.currentNPC).toBeNull();
    expect(system.npcs.size).toBeGreaterThan(0);
  });
});
