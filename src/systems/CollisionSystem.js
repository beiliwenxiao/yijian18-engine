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

/**
 * 碰撞检测系统 - 处理实体之间的碰撞检测和推开。
 * CollisionComponent 可提供物理中心偏移和轴对齐椭圆半径；未配置半径的实体保持默认矩形占地。
 */
export class CollisionSystem {
  /**
   * @param {Object} config
   * @param {number} config.entityRadius - 默认实体碰撞半径，默认20
   * @param {number} config.widthRatio - 碰撞宽度比例，默认0.8
   * @param {number} config.heightRatio - 碰撞高度比例，默认0.75
   * @param {string[]} config.collidableLayers - 参与碰撞的实体类型，默认['player', 'enemy']
   */
  constructor(config = {}) {
    this.entityRadius = config.entityRadius ?? 20;
    this.widthRatio = config.widthRatio ?? 0.8;
    this.heightRatio = config.heightRatio ?? 0.75;
    this.collidableLayers = config.collidableLayers ?? ['player', 'enemy'];
    this.broadPhaseThreshold = Math.max(2, config.broadPhaseThreshold ?? 24);
    this.broadPhaseCellSize = Math.max(32, config.broadPhaseCellSize ?? 64);
    this._collidableLayers = new Set(this.collidableLayers);
    this._collidableBuffer = [];
    this._transformBuffer = [];
    this._offsetXBuffer = [];
    this._offsetYBuffer = [];
    this._radiusXBuffer = [];
    this._radiusYBuffer = [];
    this._ellipseBuffer = [];
    this._broadPhaseGrid = new Map();
    this._bucketPool = [];
    this._usedBucketCount = 0;
    this._pairBuffer = [];
    this.onCollisionCallbacks = [];
  }

  /** 注册碰撞回调。 */
  onCollision(callback) {
    this.onCollisionCallbacks.push(callback);
  }

  /** 更新实体间碰撞。 */
  update(entities) {
    const collidable = this._collidableBuffer;
    const transforms = this._transformBuffer;
    const offsetX = this._offsetXBuffer;
    const offsetY = this._offsetYBuffer;
    const radiusX = this._radiusXBuffer;
    const radiusY = this._radiusYBuffer;
    const ellipses = this._ellipseBuffer;
    collidable.length = 0;
    transforms.length = 0;
    offsetX.length = 0;
    offsetY.length = 0;
    radiusX.length = 0;
    radiusY.length = 0;
    ellipses.length = 0;

    const defaultRadiusX = this.entityRadius * this.widthRatio;
    const defaultRadiusY = this.entityRadius * this.heightRatio;
    let maxRadius = Math.max(defaultRadiusX, defaultRadiusY);
    for (let index = 0, length = entities?.length || 0; index < length; index++) {
      const entity = entities[index];
      if (!entity || entity.isDead || entity.isDying || !this._collidableLayers.has(entity.type)) continue;
      const transform = entity.getComponent?.('transform');
      if (!transform) continue;
      const collision = entity.getComponent?.('collision');
      const configuredEllipse = Number.isFinite(collision?.radiusX) && collision.radiusX > 0 &&
        Number.isFinite(collision?.radiusY) && collision.radiusY > 0;
      const resolvedRadiusX = configuredEllipse ? collision.radiusX : defaultRadiusX;
      const resolvedRadiusY = configuredEllipse ? collision.radiusY : defaultRadiusY;
      collidable.push(entity);
      transforms.push(transform);
      offsetX.push(Number(collision?.offsetX) || 0);
      offsetY.push(Number(collision?.offsetY) || 0);
      radiusX.push(resolvedRadiusX);
      radiusY.push(resolvedRadiusY);
      ellipses.push(configuredEllipse);
      maxRadius = Math.max(maxRadius, resolvedRadiusX, resolvedRadiusY);
    }

    const count = collidable.length;
    if (count < 2) return;
    if (count < this.broadPhaseThreshold) {
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          this._resolvePair(collidable[i], transforms[i], offsetX[i], offsetY[i], radiusX[i], radiusY[i], ellipses[i],
            collidable[j], transforms[j], offsetX[j], offsetY[j], radiusX[j], radiusY[j], ellipses[j]);
        }
      }
      return;
    }

    this._buildBroadPhase(transforms, offsetX, offsetY, Math.max(this.broadPhaseCellSize, maxRadius * 2));
    const pairs = this._pairBuffer;
    pairs.length = 0;
    for (const [cellX, column] of this._broadPhaseGrid) {
      for (const [cellY, bucket] of column) {
        this._appendBucketPairs(bucket, bucket, count, true);
        this._appendNeighborPairs(cellX, cellY, bucket, count);
      }
    }
    pairs.sort((a, b) => a - b);
    for (let index = 0; index < pairs.length; index++) {
      const key = pairs[index];
      const i = Math.floor(key / count);
      const j = key - i * count;
      this._resolvePair(collidable[i], transforms[i], offsetX[i], offsetY[i], radiusX[i], radiusY[i], ellipses[i],
        collidable[j], transforms[j], offsetX[j], offsetY[j], radiusX[j], radiusY[j], ellipses[j]);
    }
  }

  _buildBroadPhase(transforms, offsetX, offsetY, cellSize) {
    this._broadPhaseGrid.clear();
    this._usedBucketCount = 0;
    this._activeBroadPhaseCellSize = cellSize;
    for (let index = 0; index < transforms.length; index++) {
      const position = transforms[index].position;
      const cellX = Math.floor((position.x + offsetX[index]) / cellSize);
      const cellY = Math.floor((position.y + offsetY[index]) / cellSize);
      let column = this._broadPhaseGrid.get(cellX);
      if (!column) this._broadPhaseGrid.set(cellX, (column = new Map()));
      let bucket = column.get(cellY);
      if (!bucket) {
        bucket = this._bucketPool[this._usedBucketCount] || [];
        this._bucketPool[this._usedBucketCount++] = bucket;
        bucket.length = 0;
        column.set(cellY, bucket);
      }
      bucket.push(index);
    }
  }

  _appendNeighborPairs(cellX, cellY, bucket, count) {
    this._appendGridPair(cellX + 1, cellY, bucket, count);
    this._appendGridPair(cellX - 1, cellY + 1, bucket, count);
    this._appendGridPair(cellX, cellY + 1, bucket, count);
    this._appendGridPair(cellX + 1, cellY + 1, bucket, count);
  }

  _appendGridPair(cellX, cellY, bucket, count) {
    const other = this._broadPhaseGrid.get(cellX)?.get(cellY);
    if (other) this._appendBucketPairs(bucket, other, count, false);
  }

  _appendBucketPairs(first, second, count, sameBucket) {
    for (let a = 0; a < first.length; a++) {
      const start = sameBucket ? a + 1 : 0;
      for (let b = start; b < second.length; b++) {
        let i = first[a];
        let j = second[b];
        if (i === j) continue;
        if (i > j) [i, j] = [j, i];
        this._pairBuffer.push(i * count + j);
      }
    }
  }

  _resolvePair(a, ta, offsetAX, offsetAY, radiusAX, radiusAY, ellipseA,
    b, tb, offsetBX, offsetBY, radiusBX, radiusBY, ellipseB) {
    const dx = (ta.position.x + offsetAX) - (tb.position.x + offsetBX);
    const dy = (ta.position.y + offsetAY) - (tb.position.y + offsetBY);
    if (!ellipseA && !ellipseB) {
      this._resolveDefaultPair(a, ta, b, tb, dx, dy, radiusAX, radiusAY);
      return;
    }

    const combinedRadiusX = radiusAX + radiusBX;
    const combinedRadiusY = radiusAY + radiusBY;
    const normalizedDistanceSq = (dx * dx) / (combinedRadiusX * combinedRadiusX) +
      (dy * dy) / (combinedRadiusY * combinedRadiusY);
    if (normalizedDistanceSq >= 1) return;
    if (normalizedDistanceSq <= Number.EPSILON) {
      const direction = String(a?.id || '').localeCompare(String(b?.id || '')) <= 0 ? -1 : 1;
      const push = combinedRadiusY / 2;
      ta.position.y += direction * push;
      tb.position.y -= direction * push;
    } else {
      const correction = (1 / Math.sqrt(normalizedDistanceSq) - 1) / 2;
      ta.position.x += dx * correction;
      ta.position.y += dy * correction;
      tb.position.x -= dx * correction;
      tb.position.y -= dy * correction;
    }
    this._emitCollision(a, b);
  }

  _resolveDefaultPair(a, ta, b, tb, dx, dy, radius, halfHeight) {
    const overlapX = (radius * 2) - Math.abs(dx);
    const overlapY = (halfHeight * 2) - Math.abs(dy);
    if (overlapX <= 0 || overlapY <= 0) return;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared === 0) {
      const direction = String(a?.id || '').localeCompare(String(b?.id || '')) <= 0 ? -1 : 1;
      ta.position.y += direction * halfHeight;
      tb.position.y -= direction * halfHeight;
    } else {
      const distance = Math.sqrt(distanceSquared);
      const nx = dx / distance;
      const ny = dy / distance;
      const push = Math.min(overlapX, overlapY) / 2;
      if (overlapX < overlapY) {
        ta.position.x += nx * push;
        tb.position.x -= nx * push;
      } else {
        ta.position.y += ny * push;
        tb.position.y -= ny * push;
      }
    }
    this._emitCollision(a, b);
  }

  _emitCollision(a, b) {
    for (let index = 0; index < this.onCollisionCallbacks.length; index++) {
      this.onCollisionCallbacks[index](a, b);
    }
  }

  /** 为寻路生成只读实体阻挡查询。 */
  createPositionBlocker(entities, { ignoreEntity = null } = {}) {
    const obstacles = [];
    for (let index = 0; index < (entities?.length || 0); index++) {
      const entity = entities[index];
      if (!entity || entity === ignoreEntity || entity.isDead || entity.isDying ||
        !this._collidableLayers.has(entity.type)) continue;
      const position = entity.getComponent?.('transform')?.position;
      if (!position) continue;
      const collision = entity.getComponent?.('collision');
      obstacles.push({
        x: position.x + (Number(collision?.offsetX) || 0),
        y: position.y + (Number(collision?.offsetY) || 0)
      });
    }
    const halfWidth = this.entityRadius * this.widthRatio * 2;
    const halfHeight = this.entityRadius * this.heightRatio * 2;
    return (x, y) => {
      for (let index = 0; index < obstacles.length; index++) {
        const obstacle = obstacles[index];
        if (Math.abs(x - obstacle.x) < halfWidth && Math.abs(y - obstacle.y) < halfHeight) return true;
      }
      return false;
    };
  }

  /** 设置可碰撞层。 */
  setCollidableLayers(layers) {
    this.collidableLayers = Array.isArray(layers) ? layers : [];
    this._collidableLayers = new Set(this.collidableLayers);
  }
}
