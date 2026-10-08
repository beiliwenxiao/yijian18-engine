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
 * PlayerSyncSystem.test.js
 * 玩家同步系统单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlayerSyncSystem, RemotePlayer, PlayerState } from './PlayerSyncSystem.js';

describe('RemotePlayer', () => {
  describe('constructor', () => {
    it('should create player with default values', () => {
      const player = new RemotePlayer({ id: 'player1' });
      
      expect(player.id).toBe('player1');
      expect(player.name).toBe('Unknown');
      expect(player.level).toBe(1);
      expect(player.position).toEqual({ x: 0, y: 0 });
      expect(player.state).toBe(PlayerState.IDLE);
      expect(player.hp).toBe(100);
      expect(player.maxHp).toBe(100);
    });

    it('should create player with provided data', () => {
      const data = {
        id: 'player1',
        name: 'TestPlayer',
        level: 10,
        position: { x: 100, y: 200 },
        hp: 80,
        maxHp: 120,
        classType: 'strategist'
      };
      
      const player = new RemotePlayer(data);
      
      expect(player.id).toBe('player1');
      expect(player.name).toBe('TestPlayer');
      expect(player.level).toBe(10);
      expect(player.position).toEqual({ x: 100, y: 200 });
      expect(player.hp).toBe(80);
      expect(player.maxHp).toBe(120);
      expect(player.classType).toBe('strategist');
    });
  });

  describe('addPositionHistory', () => {
    it('should add position to history', () => {
      const player = new RemotePlayer({ id: 'player1' });
      
      player.addPositionHistory({ x: 10, y: 20 }, 1000);
      player.addPositionHistory({ x: 20, y: 30 }, 2000);
      
      expect(player.positionHistory.length).toBe(2);
      expect(player.positionHistory[0].position).toEqual({ x: 10, y: 20 });
      expect(player.positionHistory[1].position).toEqual({ x: 20, y: 30 });
    });

    it('should limit history length', () => {
      const player = new RemotePlayer({ id: 'player1' });
      player.maxHistoryLength = 3;
      
      for (let i = 0; i < 5; i++) {
        player.addPositionHistory({ x: i * 10, y: i * 10 }, i * 1000);
      }
      
      expect(player.positionHistory.length).toBe(3);
      expect(player.positionHistory[0].position).toEqual({ x: 20, y: 20 });
    });
  });

  describe('getInterpolatedPosition', () => {
    it('should return current position if not enough history', () => {
      const player = new RemotePlayer({ id: 'player1', position: { x: 50, y: 50 } });
      
      const pos = player.getInterpolatedPosition(Date.now());
      
      expect(pos).toEqual({ x: 50, y: 50 });
    });

    it('should interpolate between positions', () => {
      const player = new RemotePlayer({ id: 'player1' });
      player.interpolationDelay = 0;
      
      player.addPositionHistory({ x: 0, y: 0 }, 1000);
      player.addPositionHistory({ x: 100, y: 100 }, 2000);
      
      const pos = player.getInterpolatedPosition(1500);
      
      expect(pos.x).toBeCloseTo(50, 0);
      expect(pos.y).toBeCloseTo(50, 0);
    });
  });

  describe('update', () => {
    it('should update player data', () => {
      const player = new RemotePlayer({ id: 'player1' });
      
      player.update({
        position: { x: 100, y: 200 },
        hp: 50,
        state: PlayerState.ATTACKING
      });
      
      expect(player.position).toEqual({ x: 100, y: 200 });
      expect(player.hp).toBe(50);
      expect(player.state).toBe(PlayerState.ATTACKING);
    });

    it('should update lastUpdate timestamp', () => {
      const player = new RemotePlayer({ id: 'player1' });
      const before = player.lastUpdate;
      
      // 等待一小段时间
      player.update({ hp: 90 });
      
      expect(player.lastUpdate).toBeGreaterThanOrEqual(before);
    });
  });

  describe('isTimedOut', () => {
    it('should return false for recent update', () => {
      const player = new RemotePlayer({ id: 'player1' });
      
      expect(player.isTimedOut(30000)).toBe(false);
    });

    it('should return true for old update', () => {
      const player = new RemotePlayer({ id: 'player1' });
      player.lastUpdate = Date.now() - 60000;
      
      expect(player.isTimedOut(30000)).toBe(true);
    });
  });
});

describe('PlayerSyncSystem', () => {
  let system;

  beforeEach(() => {
    vi.useFakeTimers();
    system = new PlayerSyncSystem({
      cleanupInterval: 1000,
      playerTimeout: 5000
    });
    system.initialize('localPlayer');
  });

  afterEach(() => {
    system.destroy();
    vi.useRealTimers();
  });

  describe('initialize', () => {
    it('should set local player id', () => {
      expect(system.localPlayerId).toBe('localPlayer');
    });

    it('should start cleanup timer', () => {
      expect(system.cleanupTimer).not.toBeNull();
    });
  });

  describe('addPlayer', () => {
    it('should add remote player', () => {
      const player = system.addPlayer({
        id: 'player1',
        name: 'TestPlayer',
        position: { x: 100, y: 200 }
      });
      
      expect(player).not.toBeNull();
      expect(player.id).toBe('player1');
      expect(system.getPlayerCount()).toBe(1);
    });

    it('should not add local player', () => {
      const player = system.addPlayer({
        id: 'localPlayer',
        name: 'LocalPlayer'
      });
      
      expect(player).toBeNull();
      expect(system.getPlayerCount()).toBe(0);
    });

    it('should emit playerJoin event', () => {
      const callback = vi.fn();
      system.on('playerJoin', callback);
      
      system.addPlayer({ id: 'player1', name: 'TestPlayer' });
      
      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls[0][0].player.id).toBe('player1');
    });

    it('should update existing player instead of adding duplicate', () => {
      system.addPlayer({ id: 'player1', name: 'TestPlayer', hp: 100 });
      system.addPlayer({ id: 'player1', name: 'TestPlayer', hp: 80 });
      
      expect(system.getPlayerCount()).toBe(1);
      expect(system.getPlayer('player1').hp).toBe(80);
    });

    it('should respect max players limit', () => {
      system.config.maxPlayers = 2;
      
      system.addPlayer({ id: 'player1' });
      system.addPlayer({ id: 'player2' });
      const player3 = system.addPlayer({ id: 'player3' });
      
      expect(player3).toBeNull();
      expect(system.getPlayerCount()).toBe(2);
    });
  });

  describe('removePlayer', () => {
    it('should remove player', () => {
      system.addPlayer({ id: 'player1' });
      
      const result = system.removePlayer('player1');
      
      expect(result).toBe(true);
      expect(system.getPlayerCount()).toBe(0);
    });

    it('should return false for non-existent player', () => {
      const result = system.removePlayer('nonexistent');
      
      expect(result).toBe(false);
    });

    it('should emit playerLeave event', () => {
      const callback = vi.fn();
      system.on('playerLeave', callback);
      
      system.addPlayer({ id: 'player1' });
      system.removePlayer('player1');
      
      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls[0][0].playerId).toBe('player1');
    });
  });

  describe('updatePlayer', () => {
    it('should update existing player', () => {
      system.addPlayer({ id: 'player1', hp: 100 });
      
      system.updatePlayer('player1', { hp: 50 });
      
      expect(system.getPlayer('player1').hp).toBe(50);
    });

    it('should create player if not exists', () => {
      system.updatePlayer('player1', { id: 'player1', name: 'NewPlayer' });
      
      expect(system.getPlayerCount()).toBe(1);
      expect(system.getPlayer('player1').name).toBe('NewPlayer');
    });

    it('should emit playerUpdate event', () => {
      const callback = vi.fn();
      system.on('playerUpdate', callback);
      
      system.addPlayer({ id: 'player1' });
      system.updatePlayer('player1', { hp: 50 });
      
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('handlePlayerMove', () => {
    it('should update player position', () => {
      system.addPlayer({ id: 'player1', position: { x: 0, y: 0 } });
      
      system.handlePlayerMove({
        playerId: 'player1',
        position: { x: 100, y: 200 },
        velocity: { x: 10, y: 0 }
      });
      
      const player = system.getPlayer('player1');
      expect(player.position).toEqual({ x: 100, y: 200 });
      expect(player.state).toBe(PlayerState.MOVING);
    });

    it('should ignore local player moves', () => {
      const callback = vi.fn();
      system.on('playerMove', callback);
      
      system.handlePlayerMove({
        playerId: 'localPlayer',
        position: { x: 100, y: 200 }
      });
      
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('handlePlayerAction', () => {
    it('should update player state on attack', () => {
      system.addPlayer({ id: 'player1' });
      
      system.handlePlayerAction({
        playerId: 'player1',
        action: 'attack'
      });
      
      expect(system.getPlayer('player1').state).toBe(PlayerState.ATTACKING);
    });

    it('should update player state on cast', () => {
      system.addPlayer({ id: 'player1' });
      
      system.handlePlayerAction({
        playerId: 'player1',
        action: 'cast'
      });
      
      expect(system.getPlayer('player1').state).toBe(PlayerState.CASTING);
    });

    it('should handle death and respawn', () => {
      system.addPlayer({ id: 'player1', hp: 10, maxHp: 100 });
      
      system.handlePlayerAction({ playerId: 'player1', action: 'die' });
      expect(system.getPlayer('player1').state).toBe(PlayerState.DEAD);
      
      system.handlePlayerAction({ playerId: 'player1', action: 'respawn' });
      expect(system.getPlayer('player1').state).toBe(PlayerState.IDLE);
      expect(system.getPlayer('player1').hp).toBe(100);
    });
  });

  describe('getPlayersInView', () => {
    it('should return players within view distance', () => {
      system.addPlayer({ id: 'player1', position: { x: 100, y: 100 } });
      system.addPlayer({ id: 'player2', position: { x: 500, y: 500 } });
      system.addPlayer({ id: 'player3', position: { x: 2000, y: 2000 } });
      
      const players = system.getPlayersInView(0, 0, 1000);
      
      expect(players.length).toBe(2);
    });
  });

  describe('getNearbyPlayers', () => {
    it('should return players sorted by distance', () => {
      system.addPlayer({ id: 'player1', position: { x: 300, y: 0 } });
      system.addPlayer({ id: 'player2', position: { x: 100, y: 0 } });
      system.addPlayer({ id: 'player3', position: { x: 200, y: 0 } });
      
      const players = system.getNearbyPlayers(0, 0, 10);
      
      expect(players[0].id).toBe('player2');
      expect(players[1].id).toBe('player3');
      expect(players[2].id).toBe('player1');
    });

    it('should limit result count', () => {
      for (let i = 0; i < 20; i++) {
        system.addPlayer({ id: `player${i}`, position: { x: i * 10, y: 0 } });
      }
      
      const players = system.getNearbyPlayers(0, 0, 5);
      
      expect(players.length).toBe(5);
    });
  });

  describe('cleanupTimedOutPlayers', () => {
    it('should remove timed out players', () => {
      system.addPlayer({ id: 'player1' });
      system.addPlayer({ id: 'player2' });
      
      // 设置player1为超时
      system.getPlayer('player1').lastUpdate = Date.now() - 10000;
      
      system.cleanupTimedOutPlayers();
      
      expect(system.getPlayerCount()).toBe(1);
      expect(system.getPlayer('player1')).toBeNull();
      expect(system.getPlayer('player2')).not.toBeNull();
    });
  });

  describe('update', () => {
    it('should update render positions', () => {
      system.addPlayer({ id: 'player1', position: { x: 100, y: 200 } });
      
      system.update(16);
      
      const player = system.getPlayer('player1');
      expect(player.renderPosition).toBeDefined();
    });

    it('should change moving state to idle when velocity is zero', () => {
      system.addPlayer({ id: 'player1' });
      const player = system.getPlayer('player1');
      player.state = PlayerState.MOVING;
      player.velocity = { x: 0, y: 0 };
      
      system.update(16);
      
      expect(player.state).toBe(PlayerState.IDLE);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      system.addPlayer({ id: 'player1' });
      system.addPlayer({ id: 'player2' });
      system.removePlayer('player1');
      
      const stats = system.getStats();
      
      expect(stats.totalJoins).toBe(2);
      expect(stats.totalLeaves).toBe(1);
      expect(stats.currentPlayers).toBe(1);
    });
  });

  describe('event system', () => {
    it('should add and remove listeners', () => {
      const callback = vi.fn();
      
      system.on('test', callback);
      system.emit('test', { data: 'test' });
      expect(callback).toHaveBeenCalledTimes(1);
      
      system.off('test', callback);
      system.emit('test', { data: 'test' });
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
});
