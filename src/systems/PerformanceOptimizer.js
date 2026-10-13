/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * PerformanceOptimizer - 序章性能优化管理器
 * 
 * 整合多种性能优化策略：
 * - 对象池管理（复用 ObjectPool）
 * - 空间分区优化碰撞检测
 * - 实体批处理
 * - 懒加载和资源管理
 * - 性能监控（复用 PerformanceMonitor）
 * 
 * 需求: 30 - 大规模战斗性能优化
 */

import { Logger } from '../core/Logger.js';
import { ObjectPool } from '../core/ObjectPool.js';

/**
 * 空间分区网格
 * 用于优化碰撞检测和实体查询
 */
class SpatialGrid {
  constructor(cellSize = 128) {
    this.cellSize = cellSize;
    this.grid = new Map();
  }

  /**
   * 获取网格键
   */
  getKey(x, y) {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    return `${cellX},${cellY}`;
  }

  /**
   * 获取实体所在的所有网格键
   */
  getEntityKeys(entity) {
    const transform = entity.getComponent('transform');
    if (!transform) return [];

    const sprite = entity.getComponent('sprite');
    const width = sprite?.width || 32;
    const height = sprite?.height || 32;

    const keys = new Set();
    const x = transform.position.x;
    const y = transform.position.y;

    // 计算实体覆盖的所有网格
    const minX = Math.floor(x / this.cellSize);
    const maxX = Math.floor((x + width) / this.cellSize);
    const minY = Math.floor(y / this.cellSize);
    const maxY = Math.floor((y + height) / this.cellSize);

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        keys.add(`${cx},${cy}`);
      }
    }

    return Array.from(keys);
  }

  /**
   * 插入实体到网格
   */
  insert(entity) {
    const keys = this.getEntityKeys(entity);
    
    for (const key of keys) {
      if (!this.grid.has(key)) {
        this.grid.set(key, new Set());
      }
      this.grid.get(key).add(entity);
    }
  }

  /**
   * 从网格移除实体
   */
  remove(entity) {
    const keys = this.getEntityKeys(entity);
    
    for (const key of keys) {
      const cell = this.grid.get(key);
      if (cell) {
        cell.delete(entity);
        if (cell.size === 0) {
          this.grid.delete(key);
        }
      }
    }
  }

  /**
   * 查询区域内的实体
   */
  query(x, y, width, height) {
    const entities = new Set();
    
    const minX = Math.floor(x / this.cellSize);
    const maxX = Math.floor((x + width) / this.cellSize);
    const minY = Math.floor(y / this.cellSize);
    const maxY = Math.floor((y + height) / this.cellSize);

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const key = `${cx},${cy}`;
        const cell = this.grid.get(key);
        if (cell) {
          cell.forEach(entity => entities.add(entity));
        }
      }
    }

    return Array.from(entities);
  }

  /**
   * 查询点附近的实体
   */
  queryPoint(x, y, radius = 0) {
    return this.query(x - radius, y - radius, radius * 2, radius * 2);
  }

  /**
   * 清空网格
   */
  clear() {
    this.grid.clear();
  }

  /**
   * 重建网格（当实体移动后）
   */
  rebuild(entities) {
    this.clear();
    for (const entity of entities) {
      if (entity.active) {
        this.insert(entity);
      }
    }
  }

  /**
   * 获取网格统计信息
   */
  getStats() {
    let totalEntities = 0;
    let maxEntitiesPerCell = 0;
    
    for (const cell of this.grid.values()) {
      totalEntities += cell.size;
      maxEntitiesPerCell = Math.max(maxEntitiesPerCell, cell.size);
    }

    return {
      cellCount: this.grid.size,
      totalEntities,
      maxEntitiesPerCell,
      avgEntitiesPerCell: this.grid.size > 0 ? totalEntities / this.grid.size : 0
    };
  }
}

/**
 * 实体批处理器
 * 将相似实体分组处理以提高性能
 */
class EntityBatcher {
  constructor() {
    this.batches = new Map();
  }

  /**
   * 按类型分组实体
   */
  batch(entities) {
    this.batches.clear();

    for (const entity of entities) {
      if (!entity.active) continue;

      const name = entity.getComponent('name');
      const type = name?.name || 'unknown';

      if (!this.batches.has(type)) {
        this.batches.set(type, []);
      }
      this.batches.get(type).push(entity);
    }

    return this.batches;
  }

  /**
   * 获取指定类型的批次
   */
  getBatch(type) {
    return this.batches.get(type) || [];
  }

  /**
   * 获取所有批次
   */
  getAllBatches() {
    return this.batches;
  }

  /**
   * 清空批次
   */
  clear() {
    this.batches.clear();
  }
}

/**
 * 性能优化管理器
 */
export class PerformanceOptimizer {
  constructor(options = {}) {
    // 空间分区
    this.spatialGrid = new SpatialGrid(options.cellSize || 128);
    this.spatialGridEnabled = options.spatialGrid !== false;
    this.spatialGridDirty = true;

    // 实体批处理
    this.entityBatcher = new EntityBatcher();
    this.batchingEnabled = options.batching !== false;

    // 对象池
    this.pools = new Map();
    this.poolingEnabled = options.pooling !== false;

    // 更新频率控制
    this.updateThrottles = new Map();
    this.throttleDefaults = {
      ai: 3,           // AI每3帧更新一次
      particles: 1,    // 粒子每帧更新
      effects: 2,      // 特效每2帧更新
      ui: 2,          // UI每2帧更新
      minimap: 6      // 小地图敌人扫描每6帧更新一次（约10Hz）
    };

    // 帧计数器。统计快照无需逐帧重建，默认每 30 帧刷新一次。
    this.frameCount = 0;
    this.statsUpdateInterval = Math.max(1, options.statsUpdateInterval || 30);

    // 性能统计
    this.stats = {
      spatialGrid: { cellCount: 0, totalEntities: 0 },
      batches: { count: 0, types: [] },
      pools: { total: 0, active: 0, pooled: 0 },
      throttled: { skipped: 0, executed: 0 }
    };

    // LOD（细节层次）设置
    this.lodEnabled = options.lod !== false;
    this.lodDistances = {
      high: 300,    // 高细节距离
      medium: 600,  // 中等细节距离
      low: 1000     // 低细节距离
    };
  }

  /**
   * 初始化对象池
   */
  initializePool(name, factory, reset, initialSize = 50, maxSize = 500) {
    if (!this.poolingEnabled) return;

    const pool = new ObjectPool(factory, reset, initialSize, maxSize);
    this.pools.set(name, pool);
    
    Logger.log(`PerformanceOptimizer: Initialized pool '${name}' with ${initialSize} objects`);
  }

  /**
   * 从对象池获取对象
   */
  acquireFromPool(poolName) {
    if (!this.poolingEnabled) return null;

    const pool = this.pools.get(poolName);
    if (!pool) {
      console.warn(`PerformanceOptimizer: Pool '${poolName}' not found`);
      return null;
    }

    return pool.acquire();
  }

  /**
   * 归还对象到池
   */
  releaseToPool(poolName, obj) {
    if (!this.poolingEnabled) return;

    const pool = this.pools.get(poolName);
    if (!pool) {
      console.warn(`PerformanceOptimizer: Pool '${poolName}' not found`);
      return;
    }

    pool.release(obj);
  }

  /**
   * 更新空间分区网格
   */
  updateSpatialGrid(entities) {
    if (!this.spatialGridEnabled) return;

    if (this.spatialGridDirty) {
      this.spatialGrid.rebuild(entities);
      this.spatialGridDirty = false;
    }
  }

  /**
   * 标记空间网格需要更新
   */
  markSpatialGridDirty() {
    this.spatialGridDirty = true;
  }

  /**
   * 查询区域内的实体（使用空间分区）
   */
  queryEntitiesInArea(x, y, width, height) {
    if (!this.spatialGridEnabled) return [];
    return this.spatialGrid.query(x, y, width, height);
  }

  /**
   * 查询点附近的实体
   */
  queryEntitiesNearPoint(x, y, radius) {
    if (!this.spatialGridEnabled) return [];
    return this.spatialGrid.queryPoint(x, y, radius);
  }

  /**
   * 批处理实体
   */
  batchEntities(entities) {
    if (!this.batchingEnabled) return new Map();
    return this.entityBatcher.batch(entities);
  }

  /**
   * 检查是否应该更新（节流）
   */
  shouldUpdate(category) {
    const throttle = this.throttleDefaults[category] || 1;
    const shouldUpdate = this.frameCount % throttle === 0;

    if (shouldUpdate) {
      this.stats.throttled.executed++;
    } else {
      this.stats.throttled.skipped++;
    }

    return shouldUpdate;
  }

  /**
   * 计算实体的LOD级别
   */
  calculateLOD(entity, cameraPosition) {
    if (!this.lodEnabled) return 'high';

    const transform = entity.getComponent('transform');
    if (!transform) return 'high';

    const dx = transform.position.x - cameraPosition.x;
    const dy = transform.position.y - cameraPosition.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < this.lodDistances.high) return 'high';
    if (distance < this.lodDistances.medium) return 'medium';
    if (distance < this.lodDistances.low) return 'low';
    return 'culled';
  }

  /**
   * 过滤实体（基于LOD和视锥剔除）
   */
  filterEntitiesForRendering(entities, camera) {
    const filtered = {
      high: [],
      medium: [],
      low: [],
      culled: []
    };

    for (const entity of entities) {
      if (!entity.active) continue;

      const lod = this.calculateLOD(entity, camera.position);
      
      if (lod === 'culled') {
        filtered.culled.push(entity);
        continue;
      }

      // 视锥剔除
      const transform = entity.getComponent('transform');
      const sprite = entity.getComponent('sprite');
      
      if (transform && sprite) {
        const width = sprite.width || 32;
        const height = sprite.height || 32;
        
        if (camera.isRectVisible(
          transform.position.x,
          transform.position.y,
          width,
          height
        )) {
          filtered[lod].push(entity);
        } else {
          filtered.culled.push(entity);
        }
      }
    }

    return filtered;
  }

  /**
   * 更新性能统计
   */
  updateStats() {
    // 空间网格统计
    if (this.spatialGridEnabled) {
      this.stats.spatialGrid = this.spatialGrid.getStats();
    }

    // 批次统计
    if (this.batchingEnabled) {
      const batches = this.entityBatcher.getAllBatches();
      this.stats.batches.count = batches.size;
      this.stats.batches.types = Array.from(batches.keys());
    }

    // 对象池统计
    if (this.poolingEnabled) {
      let totalObjects = 0;
      let activeObjects = 0;
      let pooledObjects = 0;

      for (const pool of this.pools.values()) {
        totalObjects += pool.getTotalCount();
        activeObjects += pool.getActiveCount();
        pooledObjects += pool.getPoolSize();
      }

      this.stats.pools = {
        total: totalObjects,
        active: activeObjects,
        pooled: pooledObjects
      };
    }
  }

  /**
   * 更新帧计数
   */
  update() {
    this.frameCount++;
    if (this.frameCount === 1 || this.frameCount % this.statsUpdateInterval === 0) {
      this.updateStats();
    }
  }

  /**
   * 获取性能统计
   */
  getStats() {
    return {
      ...this.stats,
      frameCount: this.frameCount,
      spatialGridEnabled: this.spatialGridEnabled,
      batchingEnabled: this.batchingEnabled,
      poolingEnabled: this.poolingEnabled,
      lodEnabled: this.lodEnabled
    };
  }

  /**
   * 获取对象池统计（用于PerformanceMonitor）
   */
  getPoolStats() {
    const poolStats = {};
    
    for (const [name, pool] of this.pools) {
      poolStats[name] = {
        total: pool.getTotalCount(),
        active: pool.getActiveCount(),
        pooled: pool.getPoolSize()
      };
    }

    return poolStats;
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats.throttled.skipped = 0;
    this.stats.throttled.executed = 0;
  }

  /**
   * 清理所有资源
   */
  cleanup() {
    this.spatialGrid.clear();
    this.entityBatcher.clear();
    
    for (const pool of this.pools.values()) {
      pool.clear();
    }
    
    this.pools.clear();
    this.updateThrottles.clear();
  }

  /**
   * 启用/禁用空间分区
   */
  setSpatialGridEnabled(enabled) {
    this.spatialGridEnabled = enabled;
    if (enabled) {
      this.spatialGridDirty = true;
    }
  }

  /**
   * 启用/禁用批处理
   */
  setBatchingEnabled(enabled) {
    this.batchingEnabled = enabled;
  }

  /**
   * 启用/禁用对象池
   */
  setPoolingEnabled(enabled) {
    this.poolingEnabled = enabled;
  }

  /**
   * 启用/禁用LOD
   */
  setLODEnabled(enabled) {
    this.lodEnabled = enabled;
  }

  /**
   * 设置节流频率
   */
  setThrottle(category, frames) {
    this.throttleDefaults[category] = frames;
  }

  /**
   * 导出配置
   */
  exportConfig() {
    return {
      spatialGrid: {
        enabled: this.spatialGridEnabled,
        cellSize: this.spatialGrid.cellSize
      },
      batching: {
        enabled: this.batchingEnabled
      },
      pooling: {
        enabled: this.poolingEnabled,
        pools: Array.from(this.pools.keys())
      },
      lod: {
        enabled: this.lodEnabled,
        distances: { ...this.lodDistances }
      },
      throttles: { ...this.throttleDefaults }
    };
  }
}
