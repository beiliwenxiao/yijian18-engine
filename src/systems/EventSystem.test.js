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
 * EventSystem.test.js
 * 动态事件系统单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EventType,
  EventState,
  EventReward,
  WorldEvent,
  EventTemplate,
  EventSystem
} from './EventSystem.js';

describe('EventType', () => {
  it('should have all event types defined', () => {
    expect(EventType.ELITE_SPAWN).toBe('elite_spawn');
    expect(EventType.TREASURE_CHEST).toBe('treasure_chest');
    expect(EventType.WORLD_BOSS).toBe('world_boss');
    expect(EventType.INVASION).toBe('invasion');
    expect(EventType.BONUS_EXP).toBe('bonus_exp');
    expect(EventType.BONUS_DROP).toBe('bonus_drop');
    expect(EventType.MERCHANT).toBe('merchant');
    expect(EventType.PORTAL).toBe('portal');
  });
});

describe('EventState', () => {
  it('should have all states defined', () => {
    expect(EventState.PENDING).toBe('pending');
    expect(EventState.ACTIVE).toBe('active');
    expect(EventState.COMPLETED).toBe('completed');
    expect(EventState.EXPIRED).toBe('expired');
    expect(EventState.FAILED).toBe('failed');
  });
});

describe('EventReward', () => {
  it('should create reward with default values', () => {
    const reward = new EventReward();
    expect(reward.exp).toBe(0);
    expect(reward.gold).toBe(0);
    expect(reward.items).toEqual([]);
  });

  it('should create reward with custom values', () => {
    const reward = new EventReward({
      exp: 100,
      gold: 50,
      items: [{ id: 'item1', dropRate: 0.5 }]
    });
    expect(reward.exp).toBe(100);
    expect(reward.gold).toBe(50);
    expect(reward.items.length).toBe(1);
  });

  it('should calculate reward based on contribution', () => {
    const reward = new EventReward({
      exp: 100,
      gold: 50,
      items: []
    });
    const result = reward.calculate(0.5);
    expect(result.exp).toBe(50);
    expect(result.gold).toBe(25);
  });
});

describe('WorldEvent', () => {
  let event;

  beforeEach(() => {
    event = new WorldEvent({
      id: 'test_event',
      type: EventType.ELITE_SPAWN,
      name: 'Test Event',
      description: 'A test event',
      mapId: 'test_map',
      position: { x: 100, y: 200 },
      duration: 60000,
      maxProgress: 100,
      reward: { exp: 500, gold: 200 }
    });
  });

  it('should create event with correct properties', () => {
    expect(event.id).toBe('test_event');
    expect(event.type).toBe(EventType.ELITE_SPAWN);
    expect(event.name).toBe('Test Event');
    expect(event.mapId).toBe('test_map');
    expect(event.position).toEqual({ x: 100, y: 200 });
    expect(event.state).toBe(EventState.PENDING);
  });

  it('should start event correctly', () => {
    const onStart = vi.fn();
    event.onStart = onStart;
    
    event.start();
    
    expect(event.state).toBe(EventState.ACTIVE);
    expect(onStart).toHaveBeenCalledWith(event);
  });

  it('should add progress correctly', () => {
    event.start();
    event.addProgress('player1', 30);
    
    expect(event.progress).toBe(30);
    expect(event.participants.get('player1')).toBe(30);
  });

  it('should complete when progress reaches max', () => {
    const onComplete = vi.fn();
    event.onComplete = onComplete;
    
    event.start();
    event.addProgress('player1', 100);
    
    expect(event.state).toBe(EventState.COMPLETED);
    expect(onComplete).toHaveBeenCalledWith(event);
  });

  it('should calculate progress percentage', () => {
    event.start();
    event.addProgress('player1', 50);
    
    expect(event.getProgressPercent()).toBe(50);
  });

  it('should check if position is in range', () => {
    expect(event.isInRange({ x: 100, y: 200 })).toBe(true);
    expect(event.isInRange({ x: 150, y: 200 })).toBe(true);
    expect(event.isInRange({ x: 500, y: 500 })).toBe(false);
  });

  it('should calculate participant reward', () => {
    event.start();
    event.addProgress('player1', 60);
    event.addProgress('player2', 40);
    
    const reward1 = event.getParticipantReward('player1');
    const reward2 = event.getParticipantReward('player2');
    
    expect(reward1.exp).toBeGreaterThan(reward2.exp);
  });
});

describe('EventTemplate', () => {
  let template;

  beforeEach(() => {
    template = new EventTemplate({
      id: 'test_template',
      type: EventType.TREASURE_CHEST,
      name: 'Test Template',
      duration: 300000,
      maxProgress: 50,
      reward: { exp: 100, gold: 50 },
      spawnChance: 0.5,
      cooldown: 60000
    });
  });

  it('should create template with correct properties', () => {
    expect(template.id).toBe('test_template');
    expect(template.type).toBe(EventType.TREASURE_CHEST);
    expect(template.name).toBe('Test Template');
    expect(template.spawnChance).toBe(0.5);
  });

  it('should create event from template', () => {
    const event = template.createEvent('map1', { x: 50, y: 50 });
    
    expect(event.type).toBe(EventType.TREASURE_CHEST);
    expect(event.name).toBe('Test Template');
    expect(event.mapId).toBe('map1');
    expect(event.position).toEqual({ x: 50, y: 50 });
  });

  it('should respect cooldown', () => {
    template.lastSpawnTime = Date.now();
    expect(template.canSpawn({})).toBe(false);
  });

  it('should check spawn conditions', () => {
    template.spawnCondition = {
      minPlayers: 5,
      mapIds: ['map1', 'map2']
    };
    template.spawnChance = 1;
    
    expect(template.canSpawn({ playerCount: 3, mapId: 'map1' })).toBe(false);
    expect(template.canSpawn({ playerCount: 5, mapId: 'map3' })).toBe(false);
  });
});

describe('EventSystem', () => {
  let system;

  beforeEach(() => {
    system = new EventSystem();
  });

  it('should initialize with default templates', () => {
    expect(system.templates.size).toBeGreaterThan(0);
    expect(system.getTemplate('elite_spawn_forest')).not.toBeNull();
    expect(system.getTemplate('world_boss_dragon')).not.toBeNull();
  });

  it('should register custom template', () => {
    const template = new EventTemplate({
      id: 'custom_event',
      type: EventType.MERCHANT,
      name: 'Custom Event'
    });
    
    system.registerTemplate(template);
    
    expect(system.getTemplate('custom_event')).toBe(template);
  });

  it('should create event from template', () => {
    const event = system.createEvent('elite_spawn_forest', 'green_forest', { x: 100, y: 100 });
    
    expect(event).not.toBeNull();
    expect(event.type).toBe(EventType.ELITE_SPAWN);
    expect(system.activeEvents.has(event.id)).toBe(true);
  });

  it('should start event', () => {
    const event = system.createEvent('treasure_chest_random', 'map1', { x: 0, y: 0 });
    system.startEvent(event.id);
    
    expect(event.state).toBe(EventState.ACTIVE);
  });

  it('should get active events', () => {
    // 直接创建事件并添加到系统中
    const event1 = new WorldEvent({
      id: 'test_event_1',
      type: EventType.ELITE_SPAWN,
      name: 'Test Event 1',
      mapId: 'map1',
      position: { x: 0, y: 0 },
      maxProgress: 100
    });
    const event2 = new WorldEvent({
      id: 'test_event_2',
      type: EventType.WORLD_BOSS,
      name: 'Test Event 2',
      mapId: 'map2',
      position: { x: 0, y: 0 },
      maxProgress: 100
    });
    
    system.activeEvents.set(event1.id, event1);
    system.activeEvents.set(event2.id, event2);
    
    expect(system.getActiveEvents().length).toBe(2);
    expect(system.getActiveEvents('map1').length).toBe(1);
  });

  it('should participate in event', () => {
    const event = system.createEvent('elite_spawn_forest', 'map1', { x: 0, y: 0 });
    system.startEvent(event.id);
    system.participate(event.id, 'player1', 25);
    
    expect(event.progress).toBe(25);
  });

  it('should handle event completion', () => {
    const onComplete = vi.fn();
    system.on('eventComplete', onComplete);
    
    const event = system.createEvent('treasure_chest_random', 'map1', { x: 0, y: 0 });
    system.startEvent(event.id);
    system.participate(event.id, 'player1', 1);
    
    expect(onComplete).toHaveBeenCalled();
    expect(system.activeEvents.has(event.id)).toBe(false);
  });

  it('should force end event', () => {
    const event = system.createEvent('elite_spawn_forest', 'map1', { x: 0, y: 0 });
    system.forceEndEvent(event.id);
    
    expect(system.activeEvents.has(event.id)).toBe(false);
    expect(system.eventHistory.length).toBe(1);
  });

  it('should get events in range', () => {
    const event1 = new WorldEvent({
      id: 'range_test_1',
      type: EventType.ELITE_SPAWN,
      name: 'Range Test 1',
      mapId: 'map1',
      position: { x: 100, y: 100 },
      radius: 100,
      maxProgress: 100
    });
    const event2 = new WorldEvent({
      id: 'range_test_2',
      type: EventType.WORLD_BOSS,
      name: 'Range Test 2',
      mapId: 'map1',
      position: { x: 500, y: 500 },
      radius: 100,
      maxProgress: 100
    });
    
    system.activeEvents.set(event1.id, event1);
    system.activeEvents.set(event2.id, event2);
    
    const nearbyEvents = system.getEventsInRange({ x: 100, y: 100 }, 50);
    expect(nearbyEvents.length).toBe(1);
  });

  it('should get events by type', () => {
    const event1 = new WorldEvent({
      id: 'type_test_1',
      type: EventType.ELITE_SPAWN,
      name: 'Type Test 1',
      mapId: 'map1',
      position: { x: 0, y: 0 },
      maxProgress: 100
    });
    const event2 = new WorldEvent({
      id: 'type_test_2',
      type: EventType.WORLD_BOSS,
      name: 'Type Test 2',
      mapId: 'map1',
      position: { x: 0, y: 0 },
      maxProgress: 100
    });
    
    system.activeEvents.set(event1.id, event1);
    system.activeEvents.set(event2.id, event2);
    
    const grouped = system.getEventsByType();
    expect(grouped[EventType.ELITE_SPAWN].length).toBe(1);
    expect(grouped[EventType.WORLD_BOSS].length).toBe(1);
  });

  it('should emit events', () => {
    const callback = vi.fn();
    system.on('eventCreated', callback);
    
    system.createEvent('elite_spawn_forest', 'map1', { x: 0, y: 0 });
    
    expect(callback).toHaveBeenCalled();
  });

  it('should remove event listener', () => {
    const callback = vi.fn();
    system.on('eventCreated', callback);
    system.off('eventCreated', callback);
    
    system.createEvent('elite_spawn_forest', 'map1', { x: 0, y: 0 });
    
    expect(callback).not.toHaveBeenCalled();
  });

  it('should get stats', () => {
    system.createEvent('elite_spawn_forest', 'map1', { x: 0, y: 0 });
    
    const stats = system.getStats();
    expect(stats.activeEventCount).toBe(1);
    expect(stats.templateCount).toBeGreaterThan(0);
  });

  it('should reset system', () => {
    system.createEvent('elite_spawn_forest', 'map1', { x: 0, y: 0 });
    system.reset();
    
    expect(system.activeEvents.size).toBe(0);
    expect(system.completedEvents.length).toBe(0);
  });

  it('should serialize and deserialize', () => {
    const event = system.createEvent('elite_spawn_forest', 'map1', { x: 100, y: 100 });
    system.startEvent(event.id);
    system.participate(event.id, 'player1', 50);
    system.forceEndEvent(event.id);
    
    const data = system.serialize();
    
    const newSystem = new EventSystem();
    newSystem.deserialize(data);
    
    expect(newSystem.eventHistory.length).toBe(1);
  });

  it('should generate random position', () => {
    const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    const pos = system.generateRandomPosition(bounds);
    
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.x).toBeLessThanOrEqual(100);
    expect(pos.y).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeLessThanOrEqual(100);
  });

  it('should get event history', () => {
    const event = system.createEvent('treasure_chest_random', 'map1', { x: 0, y: 0 });
    system.startEvent(event.id);
    system.participate(event.id, 'player1', 1);
    
    const history = system.getEventHistory();
    expect(history.length).toBe(1);
  });
});
