/************************************************************

 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)

 * 

 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎

 * @author    刘枭 (beiliwenxiao)

 * @email     beiliwenxiao@qq.com

 * @date      2026-01-14

 * @blog      https://blog.csdn.net/beiliwenxiao

 * @repo      https://github.com/beiliwenxiao/yijian18-engine

 *            https://gitee.com/coderaaa/yijian18-engine

 ************************************************************/

import { SceneObjectProjector } from './SceneObjectProjector.js';

const SCENE_OBJECT_PROJECTOR = new SceneObjectProjector();

/**
 * SceneTerrainCollision - 地形碰撞与区域收集（框架级）
 *
 * 承担四类地形约束的统一解算：
 *   1. 椭圆盆地边界（可留入口扇形缺口）
 *   2. 水池（椭圆，从内部推出）
 *   3. 树木（椭圆碰撞体）
 *   4. 编辑器 collide shape（rect / circle / ellipse / polygon / path）
 *
 * 以及从场景数据收集 buffZone 多边形并转世界坐标。
 *
 * 设计约定：
 *   - 只做几何解算，不认识 ECS 之外的游戏概念
 *   - 直接就地修改传入的 position 对象（性能考虑，避免每帧分配）
 *   - terrain 只提供已投影到世界坐标的碰撞数据；shape 命中与推出算法由本模块拥有
 *
 * 用法：
 *   const collision = new SceneTerrainCollision();
 *   collision.resolveEntities(terrain, entities, { entityRadius: 12 });
 *   const zones = SceneTerrainCollision.collectBuffZones(terrains);
 */
const EMPTY_SPATIAL_ITEMS = Object.freeze([]);
const EMPTY_OPTIONS = Object.freeze({});

export class SceneTerrainCollision {
  /**
   * @param {Object} [options]
   * @param {number} [options.entityRadius=12] - 实体碰撞半径
   * @param {number} [options.pushEpsilon=2] - 推出后的额外余量，防止贴边抖动
   */
  constructor(options = {}) {
    this.entityRadius = options.entityRadius != null ? options.entityRadius : 12;
    this.pushEpsilon = options.pushEpsilon != null ? options.pushEpsilon : 2;
    this.spatialCellSize = Math.max(32, options.spatialCellSize || 128);
    /** terrain -> 静态碰撞数据空间索引；terrain 生命周期结束后可自动回收。 */
    this._spatialCache = new WeakMap();
    /** entity -> 上次地形解算后的地面坐标，用于防止单帧跨越窄碰撞体。 */
    this._lastResolvedPositions = new WeakMap();
    /** 跳跃系统（可选）；注入后跳跃（滞空）中的实体跳过地形碰撞。 */
    this.jumpSystem = options.jumpSystem || null;
  }

  setJumpSystem(jumpSystem) {
    this.jumpSystem = jumpSystem || null;
    return this;
  }

  /**
   * 对一批实体解算地形碰撞。
   * @param {Object} terrain - 地形实例（Scene1Terrain 或同构对象）
   * @param {Array} entities - 实体数组
   * @param {Object} [options]
   * @param {number} [options.entityRadius] - 覆盖默认半径
   */
  resolveEntities(terrain, entities, options = {}) {
    if (!terrain || !entities || entities.length === 0) return;
    const defaultRadius = options.entityRadius != null ? options.entityRadius : this.entityRadius;
    const previousPositions = options.previousPositions || null;
    const trees = terrain.getTreeColliders ? terrain.getTreeColliders() : [];
    const shapes = terrain._collisionShapes || [];
    const walkables = terrain._walkableShapes || [];
    const ponds = terrain.waterPatches || [];

    for (const entity of entities) {
      if (entity.isDead || entity.isDying) continue;
      const transform = entity.getComponent && entity.getComponent('transform');
      if (!transform) continue;
      // 跳跃（滞空）期间不做地形碰撞（可跳过水池、树、火堆等）；由场景注入 jumpSystem。
      if (this.jumpSystem?.isJumping?.(entity)) continue;
      const collision = entity.getComponent?.('collision');
      const offsetX = Number(collision?.offsetX) || 0;
      const offsetY = Number(collision?.offsetY) || 0;
      const radiusX = Number(collision?.radiusX) > 0 ? Number(collision.radiusX) : defaultRadius;
      const radiusY = Number(collision?.radiusY) > 0 ? Number(collision.radiusY) : defaultRadius;
      const broadRadius = Math.max(radiusX, radiusY);
      const spatial = this._getSpatialIndex(terrain, trees, shapes, walkables, ponds, broadRadius);
      const hasCollisionOffset = offsetX !== 0 || offsetY !== 0;
      const p = hasCollisionOffset
        ? { x: transform.position.x + offsetX, y: transform.position.y + offsetY }
        : transform.position;
      const previous = previousPositions?.get(entity) || this._lastResolvedPositions.get(entity) || null;

      // 可落脚区域优先于编辑器 collide shape 和盆地边界，与 Scene1Terrain.isBlocked 一致。
      const nearbyWalkables = this._querySpatial(spatial.walkables, p.x, p.y);
      let isWalkable = false;
      for (let i = 0; i < nearbyWalkables.length; i++) {
        if (this._pointInShape(nearbyWalkables[i], p.x, p.y)) {
          isWalkable = true;
          break;
        }
      }
      if (!isWalkable) {
        for (let i = 0; i < spatial.unboundedWalkables.length; i++) {
          if (this._pointInShape(spatial.unboundedWalkables[i], p.x, p.y)) {
            isWalkable = true;
            break;
          }
        }
      }
      const nearbyPonds = this._querySpatial(spatial.ponds, p.x, p.y);
      for (let i = 0; i < nearbyPonds.length; i++) this.resolvePond(p, nearbyPonds[i], radiusX, radiusY);
      const nearbyTrees = this._querySpatial(spatial.trees, p.x, p.y);
      for (let i = 0; i < nearbyTrees.length; i++) this.resolveTree(p, nearbyTrees[i], radiusX, radiusY);
      const nearbyShapes = isWalkable
        ? EMPTY_SPATIAL_ITEMS
        : this._querySpatialRange(spatial.shapes, p, previous, broadRadius);
      for (let i = 0; i < nearbyShapes.length; i++) this.resolveShape(p, nearbyShapes[i], radiusX, radiusY, previous);
      // 缺少可计算包围盒的自定义 shape 始终走兜底列表（walkable 内除外）。
      if (!isWalkable) {
        for (let i = 0; i < spatial.unboundedShapes.length; i++) {
          this.resolveShape(p, spatial.unboundedShapes[i], radiusX, radiusY, previous);
        }
      }
      if (hasCollisionOffset) {
        transform.position.x = p.x - offsetX;
        transform.position.y = p.y - offsetY;
      }
      if (!previousPositions) this._rememberResolvedPosition(entity, p);
    }
  }

  /**
   * 对多个 chunk terrain 解算可碰撞装饰物、水面与编辑器 shape。
   * 旧椭圆盆地只是视觉地形，不再作为任何 terrain 的物理边界。
   */
  resolveTerrains(terrains, entities, { entityRadius = null } = {}) {
    if (!terrains || terrains.length === 0) return;
    const previousPositions = new Map();
    for (const entity of entities || []) {
      const transform = entity?.getComponent?.('transform');
      if (!transform) continue;
      const collision = entity.getComponent?.('collision');
      previousPositions.set(entity, this._lastResolvedPositions.get(entity) || {
        x: transform.position.x + (Number(collision?.offsetX) || 0),
        y: transform.position.y + (Number(collision?.offsetY) || 0)
      });
    }
    const options = entityRadius == null
      ? { previousPositions }
      : { entityRadius, previousPositions };
    for (let index = 0; index < terrains.length; index++) {
      const terrain = terrains[index];
      if (!terrain) continue;
      this.resolveEntities(terrain, entities, options);
    }
    for (const [entity] of previousPositions) {
      const transform = entity?.getComponent?.('transform');
      if (!transform) continue;
      const collision = entity.getComponent?.('collision');
      this._rememberResolvedPosition(entity, {
        x: transform.position.x + (Number(collision?.offsetX) || 0),
        y: transform.position.y + (Number(collision?.offsetY) || 0)
      });
    }
  }

  /**
   * 只读查询一个世界坐标是否会被 terrain 阻挡，不修改实体或坐标。
   * 判定顺序与 resolveEntities 一致：walkable 只覆盖编辑器 collide shape，
   * 水池和树木仍保持独立物理阻挡。
   */
  isPositionBlocked(terrain, x, y, { entityRadius = null } = {}) {
    if (!terrain || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const radius = entityRadius == null ? this.entityRadius : Math.max(0, Number(entityRadius) || 0);
    const trees = terrain.getTreeColliders ? terrain.getTreeColliders() : [];
    const shapes = terrain._collisionShapes || [];
    const walkables = terrain._walkableShapes || [];
    const ponds = terrain.waterPatches || [];
    const spatial = this._getSpatialIndex(terrain, trees, shapes, walkables, ponds, radius);

    const nearbyPonds = this._querySpatial(spatial.ponds, x, y);
    for (let index = 0; index < nearbyPonds.length; index++) {
      const pond = nearbyPonds[index];
      const rx = (Number(pond?.rx) || 0) + radius;
      const ry = (Number(pond?.ry) || 0) + radius;
      if (rx <= 0 || ry <= 0) continue;
      const nx = (x - pond.x) / rx;
      const ny = (y - pond.y) / ry;
      if (nx * nx + ny * ny < 1) return true;
    }

    const nearbyTrees = this._querySpatial(spatial.trees, x, y);
    for (let index = 0; index < nearbyTrees.length; index++) {
      const tree = nearbyTrees[index];
      const expandedRadiusX = (Number(tree?.radiusX) || 0) + radius;
      const expandedRadiusY = (Number(tree?.radiusY) || 0) + radius;
      if (expandedRadiusX <= 0 || expandedRadiusY <= 0) continue;
      const dx = (x - tree.x) / expandedRadiusX;
      const dy = (y - tree.y) / expandedRadiusY;
      if (dx * dx + dy * dy < 1) return true;
    }

    let isWalkable = false;
    const nearbyWalkables = this._querySpatial(spatial.walkables, x, y);
    for (let index = 0; index < nearbyWalkables.length; index++) {
      if (this._pointInShape(nearbyWalkables[index], x, y)) {
        isWalkable = true;
        break;
      }
    }
    if (!isWalkable) {
      for (let index = 0; index < spatial.unboundedWalkables.length; index++) {
        if (this._pointInShape(spatial.unboundedWalkables[index], x, y)) {
          isWalkable = true;
          break;
        }
      }
    }
    if (isWalkable) return false;

    const nearbyShapes = this._querySpatial(spatial.shapes, x, y);
    for (let index = 0; index < nearbyShapes.length; index++) {
      if (this._isShapeBlocked(nearbyShapes[index], x, y, radius)) return true;
    }
    for (let index = 0; index < spatial.unboundedShapes.length; index++) {
      if (this._pointInShape(spatial.unboundedShapes[index], x, y)) return true;
    }
    return false;
  }

  /** 多 terrain 只读阻挡聚合；任一 terrain 命中即阻挡。 */
  isAnyPositionBlocked(terrains, x, y, options = EMPTY_OPTIONS) {
    for (let index = 0; index < (terrains?.length || 0); index++) {
      if (this.isPositionBlocked(terrains[index], x, y, options)) return true;
    }
    return false;
  }

  /** 显式使动态碰撞体变更后的 terrain 索引失效。 */
  invalidate(terrain) {
    if (!terrain) return false;
    return this._spatialCache.delete(terrain);
  }

  /**
   * 获取或重建 terrain 静态碰撞空间索引。
   * 数组替换（异步场景加载）或数量/半径变化时自动失效。
   * @private
   */
  _getSpatialIndex(terrain, trees, shapes, walkables, ponds, radius) {
    let cache = this._spatialCache.get(terrain);
    if (cache && cache.treeSource === trees && cache.treeCount === trees.length &&
        cache.shapeSource === shapes && cache.shapeCount === shapes.length &&
        cache.walkableSource === walkables && cache.walkableCount === walkables.length &&
        cache.pondSource === ponds && cache.pondCount === ponds.length &&
        cache.radius === radius) {
      return cache;
    }

    cache = {
      treeSource: trees,
      treeCount: trees.length,
      shapeSource: shapes,
      shapeCount: shapes.length,
      walkableSource: walkables,
      walkableCount: walkables.length,
      pondSource: ponds,
      pondCount: ponds.length,
      radius,
      trees: new Map(),
      shapes: new Map(),
      walkables: new Map(),
      ponds: new Map(),
      unboundedShapes: [],
      unboundedWalkables: []
    };

    for (let i = 0; i < trees.length; i++) {
      const tree = trees[i];
      const extentX = (Number(tree?.radiusX) || 0) + radius + 1;
      const extentY = (Number(tree?.radiusY) || 0) + radius + 1;
      this._insertSpatial(cache.trees, tree, tree.x - extentX, tree.y - extentY,
        tree.x + extentX, tree.y + extentY);
    }
    for (let i = 0; i < ponds.length; i++) {
      const pond = ponds[i];
      this._insertSpatial(cache.ponds, pond, pond.x - pond.rx - radius, pond.y - pond.ry - radius,
        pond.x + pond.rx + radius, pond.y + pond.ry + radius);
    }
    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i];
      const bounds = this._shapeBounds(shape, radius + this.pushEpsilon);
      if (!bounds) cache.unboundedShapes.push(shape);
      else this._insertSpatial(cache.shapes, shape, bounds.left, bounds.top, bounds.right, bounds.bottom);
    }
    for (let i = 0; i < walkables.length; i++) {
      const shape = walkables[i];
      const bounds = this._shapeBounds(shape);
      if (!bounds) cache.unboundedWalkables.push(shape);
      else this._insertSpatial(cache.walkables, shape, bounds.left, bounds.top, bounds.right, bounds.bottom);
    }

    this._spatialCache.set(terrain, cache);
    return cache;
  }

  /** @private */
  _shapeBounds(shape, padding = 0) {
    if (Array.isArray(shape.points) && shape.points.length > 0) {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (let i = 0; i < shape.points.length; i++) {
        const point = shape.points[i];
        if (!point || point.length < 2) continue;
        if (point[0] < left) left = point[0];
        if (point[0] > right) right = point[0];
        if (point[1] < top) top = point[1];
        if (point[1] > bottom) bottom = point[1];
      }
      if (Number.isFinite(left)) {
        return {
          left: left - padding,
          top: top - padding,
          right: right + padding,
          bottom: bottom + padding
        };
      }
    }
    if (Number.isFinite(shape.x) && Number.isFinite(shape.y) &&
        Number.isFinite(shape.width) && Number.isFinite(shape.height)) {
      return {
        left: Math.min(shape.x, shape.x + shape.width) - padding,
        top: Math.min(shape.y, shape.y + shape.height) - padding,
        right: Math.max(shape.x, shape.x + shape.width) + padding,
        bottom: Math.max(shape.y, shape.y + shape.height) + padding
      };
    }
    return null;
  }

  /** @private */
  _insertSpatial(grid, item, left, top, right, bottom) {
    const size = this.spatialCellSize;
    const minX = Math.floor(left / size), maxX = Math.floor(right / size);
    const minY = Math.floor(top / size), maxY = Math.floor(bottom / size);
    for (let cellX = minX; cellX <= maxX; cellX++) {
      let column = grid.get(cellX);
      if (!column) grid.set(cellX, (column = new Map()));
      for (let cellY = minY; cellY <= maxY; cellY++) {
        let items = column.get(cellY);
        if (!items) column.set(cellY, (items = []));
        items.push(item);
      }
    }
  }

  /** @private */
  _querySpatial(grid, x, y) {
    const size = this.spatialCellSize;
    return grid.get(Math.floor(x / size))?.get(Math.floor(y / size)) || EMPTY_SPATIAL_ITEMS;
  }

  /** @private 查询移动线段及实体半径覆盖的格子，并去除跨格重复的 shape。 */
  _querySpatialRange(grid, position, previous, radius) {
    const from = previous || position;
    const padding = Math.max(0, radius || 0) + this.pushEpsilon;
    const left = Math.min(from.x, position.x) - padding;
    const top = Math.min(from.y, position.y) - padding;
    const right = Math.max(from.x, position.x) + padding;
    const bottom = Math.max(from.y, position.y) + padding;
    const size = this.spatialCellSize;
    const result = [];
    const seen = new Set();
    for (let cellX = Math.floor(left / size); cellX <= Math.floor(right / size); cellX++) {
      const column = grid.get(cellX);
      if (!column) continue;
      for (let cellY = Math.floor(top / size); cellY <= Math.floor(bottom / size); cellY++) {
        const items = column.get(cellY);
        if (!items) continue;
        for (let index = 0; index < items.length; index++) {
          const item = items[index];
          if (seen.has(item)) continue;
          seen.add(item);
          result.push(item);
        }
      }
    }
    return result;
  }

  /** @private */
  _rememberResolvedPosition(entity, position) {
    this._lastResolvedPositions.set(entity, { x: position.x, y: position.y });
  }

  /**
   * 显式同步实体的"已解算位置"记忆（teleport 等位置事实变更后调用）。
   * 不同步的话，防穿越判定会把单帧大位移当作穿墙，把实体拉回旧位置。
   */
  rememberEntityPosition(entity) {
    const transform = entity?.getComponent?.('transform');
    if (!entity || !transform) return false;
    const collision = entity.getComponent?.('collision');
    this._rememberResolvedPosition(entity, {
      x: transform.position.x + (Number(collision?.offsetX) || 0),
      y: transform.position.y + (Number(collision?.offsetY) || 0)
    });
    return true;
  }

  /** 水池：以实体椭圆扩张水面后，将中心推出边缘外。 */
  resolvePond(p, pond, radiusX = 0, radiusY = 0) {
    const rx = (Number(pond?.rx) || 0) + Math.max(0, radiusX);
    const ry = (Number(pond?.ry) || 0) + Math.max(0, radiusY);
    if (rx <= 0 || ry <= 0) return;
    const pdx = p.x - pond.x;
    const pdy = p.y - pond.y;
    const nx = pdx / rx;
    const ny = pdy / ry;
    const d2 = nx * nx + ny * ny;
    if (d2 < 1 && d2 > 0) {
      const k = 1 / Math.sqrt(d2);
      p.x = pond.x + pdx * k * 1.04;
      p.y = pond.y + pdy * k * 1.04;
    } else if (d2 === 0) {
      // 正好在水面中心：沿短轴推出，避免除零。
      p.y = pond.y - ry - this.pushEpsilon;
    }
  }

  /** 树木：以玩家椭圆扩张树根椭圆后，将中心推出边缘外。 */
  resolveTree(p, tree, radiusX = 0, radiusY = 0) {
    const treeRadiusX = Number(tree?.radiusX) || 0;
    const treeRadiusY = Number(tree?.radiusY) || 0;
    const expandedRadiusX = treeRadiusX + Math.max(0, radiusX);
    const expandedRadiusY = treeRadiusY + Math.max(0, radiusY);
    if (expandedRadiusX <= 0 || expandedRadiusY <= 0) return;
    const tdx = p.x - tree.x;
    const tdy = p.y - tree.y;
    const normalizedDistance = Math.hypot(tdx / expandedRadiusX, tdy / expandedRadiusY);
    if (normalizedDistance >= 1) return;
    if (normalizedDistance > 1e-7) {
      const worldDistance = Math.hypot(tdx, tdy) || 1;
      p.x = tree.x + tdx / normalizedDistance + tdx / worldDistance * this.pushEpsilon;
      p.y = tree.y + tdy / normalizedDistance + tdy / worldDistance * this.pushEpsilon;
    } else {
      p.y = tree.y + expandedRadiusY + this.pushEpsilon;
    }
  }

  /**
   * 编辑器 collide shape：按形状类型推出。
   * polygon/path 使用实体半径形成阻挡外沿，并检测上一次解算位置到当前帧的穿越，
   * 防止低帧率或高移动速度将角色中心直接越过狭窄物件。
   * @param {Object} p - position（就地修改）
   * @param {Object} s - shape 定义
   * @param {number} radiusX - 实体椭圆横轴半径
   * @param {number} radiusY - 实体椭圆纵轴半径
   * @param {{x:number,y:number}|null} [previous] - 上一次地形解算后的坐标
   */
  resolveShape(p, s, radiusX, radiusY, previous = null) {
    const st = s.shapeType;
    const EPS = this.pushEpsilon;

    if (st === 'polygon' || st === 'path') {
      const contact = this._getPolygonContact(s.points, p.x, p.y);
      if (contact) {
        const distance = contact.distance;
        const normalX = distance > 1e-7 ? (p.x - contact.nearestX) / distance :
          -contact.nearestEdgeY / (Math.hypot(contact.nearestEdgeX, contact.nearestEdgeY) || 1);
        const normalY = distance > 1e-7 ? (p.y - contact.nearestY) / distance :
          contact.nearestEdgeX / (Math.hypot(contact.nearestEdgeX, contact.nearestEdgeY) || 1);
        const supportRadius = Math.hypot(radiusX * normalX, radiusY * normalY);
        if (contact.inside || distance <= supportRadius) {
          this._pushOutOfPolygon(p, s.points, supportRadius + EPS, contact);
          return;
        }
      }
      if (this._crossedPolygon(previous, p, s.points)) {
        p.x = previous.x;
        p.y = previous.y;
      }
      return;
    }

    if (st === 'circle' || st === 'ellipse') {
      const scx = (s.x || 0) + (s.width || 0) / 2;
      const scy = (s.y || 0) + (s.height || 0) / 2;
      const baseRadiusX = (st === 'circle' ? Math.min(s.width, s.height) : s.width) / 2 || 1;
      const baseRadiusY = (st === 'circle' ? Math.min(s.width, s.height) : s.height) / 2 || 1;
      const expandedRadiusX = baseRadiusX + radiusX;
      const expandedRadiusY = baseRadiusY + radiusY;
      const dirX = p.x - scx;
      const dirY = p.y - scy;
      const normalizedDistance = Math.hypot(dirX / expandedRadiusX, dirY / expandedRadiusY);
      if (normalizedDistance >= 1) return;
      if (normalizedDistance > 1e-7) {
        const worldDistance = Math.hypot(dirX, dirY) || 1;
        p.x = scx + dirX / normalizedDistance + dirX / worldDistance * EPS;
        p.y = scy + dirY / normalizedDistance + dirY / worldDistance * EPS;
      } else {
        p.y = scy - expandedRadiusY - EPS;
      }
      return;
    }

    // rect：以椭圆在最近接触法线上的支撑半径推出，角落保留真实的圆角外沿。
    const left = s.x || 0;
    const top = s.y || 0;
    const right = left + (s.width || 0);
    const bottom = top + (s.height || 0);
    const nearestX = Math.max(left, Math.min(p.x, right));
    const nearestY = Math.max(top, Math.min(p.y, bottom));
    const dirX = p.x - nearestX;
    const dirY = p.y - nearestY;
    const distance = Math.hypot(dirX, dirY);
    if (distance > 1e-7) {
      const normalX = dirX / distance;
      const normalY = dirY / distance;
      const supportRadius = Math.hypot(radiusX * normalX, radiusY * normalY);
      if (distance >= supportRadius) return;
      p.x = nearestX + normalX * (supportRadius + EPS);
      p.y = nearestY + normalY * (supportRadius + EPS);
      return;
    }
    const dL = p.x - left, dR = right - p.x, dT = p.y - top, dB = bottom - p.y;
    const minD = Math.min(dL, dR, dT, dB);
    if (minD === dL) p.x = left - radiusX - EPS;
    else if (minD === dR) p.x = right + radiusX + EPS;
    else if (minD === dT) p.y = top - radiusY - EPS;
    else p.y = bottom + radiusY + EPS;
  }

  /** @private 与 terrain 实现无关的 shape 点命中。 */
  _pointInShape(shape, x, y) {
    if (!shape) return false;
    if ((shape.shapeType === 'polygon' || shape.shapeType === 'path') && Array.isArray(shape.points)) {
      return this._pointInPolygon(shape.points, x, y);
    }
    const bx = shape.x || 0, by = shape.y || 0;
    const bw = shape.width || 0, bh = shape.height || 0;
    const cx = bx + bw / 2, cy = by + bh / 2;
    if (shape.shapeType === 'circle') {
      return Math.hypot(x - cx, y - cy) <= Math.min(bw, bh) / 2;
    }
    if (shape.shapeType === 'ellipse') {
      const nx = (x - cx) / (bw / 2 || 1);
      const ny = (y - cy) / (bh / 2 || 1);
      return nx * nx + ny * ny <= 1;
    }
    return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
  }

  /** @private 用于路径与碰撞规划的只读阻挡判定。 */
  _isShapeBlocked(shape, x, y, radius) {
    if (shape?.shapeType !== 'polygon' && shape?.shapeType !== 'path') {
      return this._pointInShape(shape, x, y);
    }
    const contact = this._getPolygonContact(shape.points, x, y);
    return Boolean(contact && (contact.inside || contact.distance <= radius));
  }

  /** @private 射线法判断点是否在闭合多边形内。 */
  _pointInPolygon(points, x, y) {
    if (!Array.isArray(points) || points.length < 3) return false;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const current = points[i], previous = points[j];
      const xi = Array.isArray(current) ? current[0] : current.x;
      const yi = Array.isArray(current) ? current[1] : current.y;
      const xj = Array.isArray(previous) ? previous[0] : previous.x;
      const yj = Array.isArray(previous) ? previous[1] : previous.y;
      if (((yi > y) !== (yj > y)) &&
          (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /** @private 返回点相对多边形的最近边接触信息。 */
  _getPolygonContact(points, x, y) {
    if (!Array.isArray(points) || points.length < 3) return null;
    let nearestX = x, nearestY = y;
    let nearestEdgeX = 0, nearestEdgeY = 0;
    let bestDistanceSq = Infinity;

    for (let i = 0; i < points.length; i++) {
      const start = points[i], end = points[(i + 1) % points.length];
      const ax = Array.isArray(start) ? start[0] : start?.x;
      const ay = Array.isArray(start) ? start[1] : start?.y;
      const bx = Array.isArray(end) ? end[0] : end?.x;
      const by = Array.isArray(end) ? end[1] : end?.y;
      if (![ax, ay, bx, by].every(Number.isFinite)) continue;
      const edgeX = bx - ax, edgeY = by - ay;
      const edgeLengthSq = edgeX * edgeX + edgeY * edgeY;
      if (edgeLengthSq <= 0) continue;
      const projection = Math.max(0, Math.min(1,
        ((x - ax) * edgeX + (y - ay) * edgeY) / edgeLengthSq
      ));
      const candidateX = ax + edgeX * projection;
      const candidateY = ay + edgeY * projection;
      const dx = candidateX - x, dy = candidateY - y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        nearestX = candidateX;
        nearestY = candidateY;
        nearestEdgeX = edgeX;
        nearestEdgeY = edgeY;
      }
    }

    if (!Number.isFinite(bestDistanceSq)) return null;
    return {
      inside: this._pointInPolygon(points, x, y),
      distance: Math.sqrt(bestDistanceSq),
      nearestX,
      nearestY,
      nearestEdgeX,
      nearestEdgeY
    };
  }

  /** @private 判断一个移动线段是否从多边形外部完全穿越。 */
  _crossedPolygon(previous, position, points) {
    if (!previous || !Array.isArray(points) || points.length < 3) return false;
    if (this._pointInPolygon(points, previous.x, previous.y)) return false;
    if (previous.x === position.x && previous.y === position.y) return false;
    for (let i = 0; i < points.length; i++) {
      const start = points[i], end = points[(i + 1) % points.length];
      const ax = Array.isArray(start) ? start[0] : start?.x;
      const ay = Array.isArray(start) ? start[1] : start?.y;
      const bx = Array.isArray(end) ? end[0] : end?.x;
      const by = Array.isArray(end) ? end[1] : end?.y;
      if (![ax, ay, bx, by].every(Number.isFinite)) continue;
      if (this._segmentsIntersect(previous.x, previous.y, position.x, position.y, ax, ay, bx, by)) {
        return true;
      }
    }
    return false;
  }

  /** @private 含边界的线段相交判定。 */
  _segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const cross = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
    const onSegment = (px, py, qx, qy, rx, ry) => (
      rx >= Math.min(px, qx) && rx <= Math.max(px, qx) &&
      ry >= Math.min(py, qy) && ry <= Math.max(py, qy)
    );
    const abC = cross(ax, ay, bx, by, cx, cy);
    const abD = cross(ax, ay, bx, by, dx, dy);
    const cdA = cross(cx, cy, dx, dy, ax, ay);
    const cdB = cross(cx, cy, dx, dy, bx, by);
    if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
        ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
    return (abC === 0 && onSegment(ax, ay, bx, by, cx, cy)) ||
      (abD === 0 && onSegment(ax, ay, bx, by, dx, dy)) ||
      (cdA === 0 && onSegment(cx, cy, dx, dy, ax, ay)) ||
      (cdB === 0 && onSegment(cx, cy, dx, dy, bx, by));
  }

  /** @private 将多边形内部或边缘重叠点推出到最近边界外侧。 */
  _pushOutOfPolygon(position, points, offset, contact = null) {
    const resolved = contact || this._getPolygonContact(points, position.x, position.y);
    if (!resolved) return;
    const distance = resolved.distance;
    const clearance = Math.max(offset || 0, 0.001);
    if (distance > 1e-7) {
      const direction = resolved.inside ? -1 : 1;
      position.x = resolved.nearestX + (position.x - resolved.nearestX) / distance * clearance * direction;
      position.y = resolved.nearestY + (position.y - resolved.nearestY) / distance * clearance * direction;
      return;
    }

    // 点恰好位于边界时，测试边法线两侧，选择多边形外的一侧。
    const edgeLength = Math.hypot(resolved.nearestEdgeX, resolved.nearestEdgeY) || 1;
    const normalX = -resolved.nearestEdgeY / edgeLength;
    const normalY = resolved.nearestEdgeX / edgeLength;
    const firstX = resolved.nearestX + normalX * clearance;
    const firstY = resolved.nearestY + normalY * clearance;
    if (!this._pointInPolygon(points, firstX, firstY)) {
      position.x = firstX;
      position.y = firstY;
    } else {
      position.x = resolved.nearestX - normalX * clearance;
      position.y = resolved.nearestY - normalY * clearance;
    }
  }

  /**
   * 从多个 terrain 的场景数据中收集 buffZone，坐标转为世界坐标。
   * @param {Array} terrains - terrain 实例数组
   * @returns {{zones: Array, loadedCount: number, total: number}}
   */
  static collectBuffZones(terrains) {
    const list = terrains || [];
    const zones = [];
    let loadedCount = 0;

    for (const t of list) {
      const scene = t._sceneDataRaw;
      if (!scene) continue;
      loadedCount++;
      if (!Array.isArray(scene.layers)) continue;

      const offset = t.worldOffset || { x: 0, y: 0 };

      for (const layer of scene.layers) {
        if (!Array.isArray(layer.objects)) continue;
        for (const obj of layer.objects) {
          if (obj.type !== 'buffZone' || !obj.effect) continue;
          const projected = SCENE_OBJECT_PROJECTOR.project(obj, offset);
          zones.push({
            id: projected.id,
            name: projected.name || '',
            points: projected.points || [],
            fillColor: projected.fillColor,
            borderColor: projected.borderColor,
            visible: projected.visible !== false,
            effect: projected.effect
          });
        }
      }
    }

    return { zones, loadedCount, total: list.length };
  }

  /**
   * 渲染 buffZone 多边形。
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} zones - collectBuffZones 产出的区域数组
   * @param {boolean} [debugMode=false] - true 时显示隐形区域并附加名称/效果标签
   */
  static renderBuffZones(ctx, zones, debugMode = false) {
    if (!zones || zones.length === 0) return;

    for (const zone of zones) {
      if (!zone.points || zone.points.length < 3) continue;
      if (!zone.visible && !debugMode) continue;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(zone.points[0][0], zone.points[0][1]);
      for (let i = 1; i < zone.points.length; i++) {
        ctx.lineTo(zone.points[i][0], zone.points[i][1]);
      }
      ctx.closePath();

      // 填充：调试模式下隐形区域用红色区分
      if (debugMode) {
        ctx.fillStyle = zone.visible
          ? (zone.fillColor || 'rgba(100, 0, 200, 0.15)')
          : 'rgba(200, 0, 0, 0.15)';
      } else {
        ctx.fillStyle = zone.fillColor || 'rgba(100, 0, 200, 0.15)';
      }
      ctx.fill();

      ctx.strokeStyle = debugMode
        ? (zone.visible ? (zone.borderColor || 'rgba(100,0,200,0.5)') : 'rgba(200,0,0,0.5)')
        : (zone.borderColor || 'rgba(100,0,200,0.5)');
      ctx.lineWidth = debugMode ? 2 : 1.5;
      if (debugMode) ctx.setLineDash([6, 3]);
      ctx.stroke();
      if (debugMode) ctx.setLineDash([]);

      if (debugMode) {
        const cx = zone.points.reduce((s, pt) => s + pt[0], 0) / zone.points.length;
        const cy = zone.points.reduce((s, pt) => s + pt[1], 0) / zone.points.length;
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(zone.name || 'Buff', cx, cy - 6);
        if (zone.effect) {
          const eff = zone.effect;
          const label = `${eff.stat || 'hp'} ${eff.value > 0 ? '+' : ''}${eff.value || 0} (${eff.effectType || '?'})`;
          ctx.fillStyle = '#ccc';
          ctx.font = '10px sans-serif';
          ctx.fillText(label, cx, cy + 8);
        }
      }
      ctx.restore();
    }
  }
}

export default SceneTerrainCollision;
