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

const DEFAULT_CONFIG = Object.freeze({
  duration: 0.8,
  peakHeight: 18,
  controlledSpeed: 84,
  controlledElevation: 14,
  exitRadius: 18
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeBounds(bounds = {}) {
  const minX = finite(bounds.minX ?? bounds.x);
  const minY = finite(bounds.minY ?? bounds.y);
  const maxX = finite(bounds.maxX ?? (minX == null ? null : minX + Number(bounds.width)));
  const maxY = finite(bounds.maxY ?? (minY == null ? null : minY + Number(bounds.height)));
  if (minX == null || minY == null || maxX == null || maxY == null || maxX < minX || maxY < minY) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * 通用攀爬执行器。普通攀爬按目标插值；受控攀爬由同一设备无关移动轴在
 * 场景提供的边界内推进。技能解锁、体力和冷却仍由 AbilitySystem 负责。
 */
export class ClimbSystem {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    /** 攀爬开始回调（场景层注入，用于教程信号等辅助消费者） */
    this.onClimbStarted = typeof config.onClimbStarted === 'function' ? config.onClimbStarted : null;
    this._active = new Map();
    // 脱离（取消/结束）受控攀爬的时间戳：供跳跃入口做短暂冷却，防止"跳离"当帧立即回攀。
    this._controlledDetachAt = new WeakMap();
  }

  startClimb(entity, target = {}, options = {}) {
    const transform = entity?.getComponent?.('transform');
    if (!transform || this._active.has(entity)) return false;
    const targetX = finite(target.x);
    const targetY = finite(target.y);
    if (targetX == null || targetY == null) return false;

    entity.getComponent?.('movement')?.stop?.();
    const state = {
      mode: 'traverse',
      transform,
      startX: transform.position.x,
      startY: transform.position.y,
      targetX,
      targetY,
      baseElevation: transform.position.elevation || 0,
      elapsed: 0,
      duration: Math.max(0.1, Number(options.duration) || this.config.duration),
      peakHeight: Math.max(0, Number(options.peakHeight) || this.config.peakHeight),
      ...this._acquireLayer(entity)
    };
    this._active.set(entity, state);
    this.onClimbStarted?.(entity, { mode: 'traverse' });
    return true;
  }

  /**
   * 开始由玩家移动轴驱动的受控攀爬。入口只会吸附到可攀爬范围最近点，
   * 不会插值或自动抵达出口。
   */
  startControlledClimb(entity, bounds = {}, options = {}) {
    const transform = entity?.getComponent?.('transform');
    const normalizedBounds = normalizeBounds(bounds);
    const exitPosition = options.exitPosition || options.targetPosition || null;
    const exitX = finite(exitPosition?.x);
    const exitY = finite(exitPosition?.y);
    if (!transform || this._active.has(entity) || !normalizedBounds || exitX == null || exitY == null) return false;

    const speed = Math.max(1, Number(options.speed) || this.config.controlledSpeed);
    const exitRadius = Math.max(0, Number(options.exitRadius) || this.config.exitRadius);
    const baseElevation = Number(transform.position.elevation) || 0;
    entity.getComponent?.('movement')?.stop?.();
    // 跳下跌落的落点基准（进入/离开区世界包围盒）：无则回落到攀爬范围底部
    const rawEnterBounds = options.enterBounds || null;
    const enterBounds = rawEnterBounds
      && [rawEnterBounds.minX, rawEnterBounds.minY, rawEnterBounds.maxX, rawEnterBounds.maxY].every(Number.isFinite)
      ? rawEnterBounds
      : { minX: normalizedBounds.minX, minY: normalizedBounds.minY, maxX: normalizedBounds.maxX, maxY: normalizedBounds.maxY };
    // 攀爬区多边形（世界坐标顶点）：存在时移动按多边形精确约束（而非包围盒）
    const climbPolygon = Array.isArray(options.climbPolygon)
      && options.climbPolygon.length >= 3
      && options.climbPolygon.every(point => Array.isArray(point)
        && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
      ? options.climbPolygon.map(point => [Number(point[0]), Number(point[1])])
      : null;
    const state = {
      mode: 'controlled',
      transform,
      startX: transform.position.x,
      startY: transform.position.y,
      baseElevation,
      minX: normalizedBounds.minX,
      minY: normalizedBounds.minY,
      maxX: normalizedBounds.maxX,
      maxY: normalizedBounds.maxY,
      exitX,
      exitY,
      exitRadius,
      speed,
      enterBounds,
      climbPolygon,
      climbSurfaceBounds: options.surfaceBounds || null,
      hasExitZone: options.hasExitZone !== false,
      climbElevation: Math.max(baseElevation, Number(options.elevation) || baseElevation + this.config.controlledElevation),
      surfaceId: typeof options.surfaceId === 'string' ? options.surfaceId : null,
      ...this._acquireLayer(entity)
    };
    if (climbPolygon) {
      // 入口吸附：把玩家吸附到攀爬多边形最近点（从进入区"抓住"攀爬面）
      const nearest = this._nearestPolygonPoint(climbPolygon, state.transform.position.x, state.transform.position.y);
      state.transform.position.x = nearest.x;
      state.transform.position.y = nearest.y;
    } else {
      state.transform.position.x = clamp(state.transform.position.x, state.minX, state.maxX);
      state.transform.position.y = clamp(state.transform.position.y, state.minY, state.maxY);
    }
    state.transform.position.elevation = state.climbElevation;
    this._active.set(entity, state);
    this.onClimbStarted?.(entity, { mode: 'controlled', surfaceId: state.surfaceId });
    return true;
  }

  isClimbing(entity) {
    return this._active.has(entity);
  }

  isControlledClimb(entity) {
    return this._active.get(entity)?.mode === 'controlled';
  }

  isAtControlledExit(entity) {
    const state = this._active.get(entity);
    if (!state || state.mode !== 'controlled') return false;
    return Math.hypot(
      state.transform.position.x - state.exitX,
      state.transform.position.y - state.exitY
    ) <= state.exitRadius;
  }

  /** 返回只读表现投影，渲染器不得持有或回写攀爬业务状态。 */
  getControlledClimbPresentation(entity) {
    const state = this._active.get(entity);
    if (!state || state.mode !== 'controlled') return null;
    return {
      surfaceId: state.surfaceId,
      bounds: {
        minX: state.minX,
        minY: state.minY,
        maxX: state.maxX,
        maxY: state.maxY
      },
      exitPosition: { x: state.exitX, y: state.exitY },
      exitRadius: state.exitRadius,
      // 跳下跌落落点基准（进入区世界包围盒）
      enterBounds: state.enterBounds || null,
      // 攀爬高度（跌落动画的起始抬升，保证下落过程高度连续）
      elevation: state.climbElevation,
      // 被攀爬物体的本体世界包围盒（攀爬时高亮物体边缘用）
      surfaceBounds: state.climbSurfaceBounds || null,
      // 无真实离开区的攀爬面（兜底出口）恒为 false：跳跃=跳下跌落，而非出口脱离
      isAtExit: state.hasExitZone !== false && this.isAtControlledExit(entity)
    };
  }

  /** 只有抵达真实出口后才可结束受控攀爬（无离开区的攀爬面只能跳跃跳下）。 */
  finishControlledClimb(entity) {
    const state = this._active.get(entity);
    if (!state || state.mode !== 'controlled'
      || state.hasExitZone === false || !this.isAtControlledExit(entity)) return false;
    this._finish(entity, state);
    return true;
  }

  update(deltaTime, { inputAxis = null } = {}) {
    const dt = Math.max(0, Number(deltaTime) || 0);
    for (const [entity, state] of this._active) {
      const transform = entity?.getComponent?.('transform');
      if (!transform) {
        this._finish(entity, state);
        continue;
      }
      if (state.mode === 'controlled') {
        this._applyControlledPosition(state, dt, inputAxis);
        continue;
      }
      state.elapsed += dt;
      this._applyTraversePosition(state);
      if (state.elapsed >= state.duration) this._finish(entity, state);
    }
  }

  cancel(entity, { restoreStart = false } = {}) {
    const state = this._active.get(entity);
    if (!state) return false;
    if (restoreStart) {
      state.transform.position.x = state.startX;
      state.transform.position.y = state.startY;
    }
    this._finish(entity, state);
    return true;
  }

  serialize(entity) {
    const state = this._active.get(entity);
    if (!state) return { schemaVersion: 1, active: false };
    if (state.mode === 'controlled') {
      return {
        schemaVersion: 1,
        active: true,
        mode: 'controlled',
        startX: state.startX,
        startY: state.startY,
        baseElevation: state.baseElevation,
        minX: state.minX,
        minY: state.minY,
        maxX: state.maxX,
        maxY: state.maxY,
        exitX: state.exitX,
        exitY: state.exitY,
        exitRadius: state.exitRadius,
        hasExitZone: state.hasExitZone !== false,
        speed: state.speed,
        climbElevation: state.climbElevation,
        surfaceId: state.surfaceId
      };
    }
    return {
      schemaVersion: 1,
      active: true,
      mode: 'traverse',
      startX: state.startX,
      startY: state.startY,
      targetX: state.targetX,
      targetY: state.targetY,
      baseElevation: state.baseElevation,
      elapsed: state.elapsed,
      duration: state.duration,
      peakHeight: state.peakHeight
    };
  }

  validateSerialized(data = {}) {
    if (data == null) return { ok: true };
    if (data.schemaVersion !== 1 || typeof data.active !== 'boolean') return { ok: false, code: 'invalidClimbState' };
    if (!data.active) return { ok: true };
    const mode = data.mode || 'traverse';
    if (mode === 'controlled') {
      const fields = ['startX', 'startY', 'baseElevation', 'minX', 'minY', 'maxX', 'maxY', 'exitX', 'exitY', 'exitRadius', 'speed', 'climbElevation'];
      if (fields.some(key => finite(data[key]) == null)
        || Number(data.maxX) < Number(data.minX)
        || Number(data.maxY) < Number(data.minY)
        || Number(data.exitRadius) < 0
        || Number(data.speed) <= 0
        || (data.surfaceId != null && typeof data.surfaceId !== 'string')) {
        return { ok: false, code: 'invalidClimbState' };
      }
      return { ok: true };
    }
    if (mode !== 'traverse') return { ok: false, code: 'invalidClimbState' };
    const fields = ['startX', 'startY', 'targetX', 'targetY', 'baseElevation', 'elapsed', 'duration', 'peakHeight'];
    if (fields.some(key => finite(data[key]) == null) || Number(data.duration) <= 0 || Number(data.elapsed) < 0) {
      return { ok: false, code: 'invalidClimbState' };
    }
    return { ok: true };
  }

  /** 只校验并构造恢复草稿，不触碰当前位移、坐标或层。 */
  prepareDeserialize(entity, data = {}) {
    const check = this.validateSerialized(data);
    if (!check.ok) return check;
    if (!data.active) return { ok: true, draft: { active: false } };
    const transform = entity?.getComponent?.('transform');
    if (!transform) return { ok: false, code: 'climbRestoreFailed' };
    if ((data.mode || 'traverse') === 'controlled') {
      return {
        ok: true,
        draft: {
          active: true,
          mode: 'controlled',
          transform,
          startX: Number(data.startX),
          startY: Number(data.startY),
          baseElevation: Number(data.baseElevation),
          minX: Number(data.minX),
          minY: Number(data.minY),
          maxX: Number(data.maxX),
          maxY: Number(data.maxY),
          exitX: Number(data.exitX),
          exitY: Number(data.exitY),
          exitRadius: Number(data.exitRadius),
          hasExitZone: data.hasExitZone !== false,
          speed: Number(data.speed),
          climbElevation: Number(data.climbElevation),
          surfaceId: data.surfaceId || null
        }
      };
    }
    return {
      ok: true,
      draft: {
        active: true,
        mode: 'traverse',
        transform,
        startX: Number(data.startX),
        startY: Number(data.startY),
        targetX: Number(data.targetX),
        targetY: Number(data.targetY),
        baseElevation: Number(data.baseElevation),
        elapsed: Number(data.elapsed),
        duration: Number(data.duration),
        peakHeight: Math.max(0, Number(data.peakHeight))
      }
    };
  }

  /** 已准备草稿的一次性提交；准备成功后本阶段不再包含可失败前置。 */
  commitDeserialize(entity, draft) {
    const previous = this._active.get(entity);
    if (previous) this._finish(entity, previous);
    if (!draft?.active) return { ok: true };

    entity.getComponent?.('movement')?.stop?.();
    const state = { ...draft, ...this._acquireLayer(entity) };
    if (state.mode === 'controlled') {
      state.transform.position.x = clamp(state.transform.position.x, state.minX, state.maxX);
      state.transform.position.y = clamp(state.transform.position.y, state.minY, state.maxY);
      state.transform.position.elevation = state.climbElevation;
      this._active.set(entity, state);
      return { ok: true };
    }
    this._applyTraversePosition(state);
    if (state.elapsed >= state.duration) {
      state.transform.position.elevation = state.baseElevation;
      this._releaseLayer(entity, state);
      return { ok: true };
    }
    this._active.set(entity, state);
    return { ok: true };
  }

  deserialize(entity, data = {}) {
    const prepared = this.prepareDeserialize(entity, data);
    if (!prepared.ok) return prepared;
    return this.commitDeserialize(entity, prepared.draft);
  }

  cleanup() {
    for (const [entity, state] of this._active) this._finish(entity, state);
    this._active.clear();
  }

  _applyTraversePosition(state) {
    const progress = Math.min(1, Math.max(0, state.elapsed / state.duration));
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    state.transform.position.x = state.startX + (state.targetX - state.startX) * eased;
    state.transform.position.y = state.startY + (state.targetY - state.startY) * eased;
    state.transform.position.elevation = state.baseElevation + state.peakHeight * 4 * progress * (1 - progress);
  }

  _applyControlledPosition(state, deltaTime, inputAxis) {
    const rawX = Number(inputAxis?.x) || 0;
    const rawY = Number(inputAxis?.y) || 0;
    const rawMagnitude = Math.hypot(rawX, rawY);
    const requestedMagnitude = Number(inputAxis?.magnitude);
    const magnitude = rawMagnitude > 0.0001
      ? Math.min(1, Number.isFinite(requestedMagnitude) ? Math.max(0, requestedMagnitude) : rawMagnitude)
      : 0;
    if (magnitude > 0) {
      const distance = state.speed * deltaTime * magnitude;
      const currentX = state.transform.position.x;
      const currentY = state.transform.position.y;
      const nextX = currentX + rawX / rawMagnitude * distance;
      const nextY = currentY + rawY / rawMagnitude * distance;
      if (Array.isArray(state.climbPolygon) && state.climbPolygon.length >= 3) {
        // 多边形精确约束：整体尝试 → 分轴滑动，角色脚点始终保持在攀爬多边形内
        const polygon = state.climbPolygon;
        if (this._pointInPolygon(polygon, nextX, nextY)) {
          state.transform.position.x = nextX;
          state.transform.position.y = nextY;
        } else if (this._pointInPolygon(polygon, nextX, currentY)) {
          state.transform.position.x = nextX;
        } else if (this._pointInPolygon(polygon, currentX, nextY)) {
          state.transform.position.y = nextY;
        }
      } else {
        state.transform.position.x = clamp(nextX, state.minX, state.maxX);
        state.transform.position.y = clamp(nextY, state.minY, state.maxY);
      }
    }
    state.transform.position.elevation = state.climbElevation;
  }

  /** 射线法：点是否在多边形内。 */
  _pointInPolygon(polygon, x, y) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0];
      const yi = polygon[i][1];
      const xj = polygon[j][0];
      const yj = polygon[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /** 点到多边形的最近点（逐边投影取最近），用于进入攀爬时的入口吸附。 */
  _nearestPolygonPoint(polygon, x, y) {
    if (this._pointInPolygon(polygon, x, y)) return { x, y };
    let best = null;
    let bestDistance = Infinity;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const ax = polygon[j][0];
      const ay = polygon[j][1];
      const bx = polygon[i][0];
      const by = polygon[i][1];
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSq));
      const px = ax + dx * t;
      const py = ay + dy * t;
      const distance = Math.hypot(x - px, y - py);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: px, y: py };
      }
    }
    return best || { x, y };
  }

  _acquireLayer(entity) {
    const layer = entity.getComponent?.('layer');
    if (!layer) return { layerPushed: false, layerToken: null };
    if (typeof layer.acquireLayer === 'function') {
      const layerToken = layer.acquireLayer('aerial', 'climb');
      return { layerPushed: !!layerToken, layerToken };
    }
    layer.pushLayer?.('aerial');
    return { layerPushed: true, layerToken: null };
  }

  _releaseLayer(entity, state) {
    if (!state.layerPushed) return;
    const layer = entity.getComponent?.('layer');
    if (state.layerToken && typeof layer?.releaseLayer === 'function') layer.releaseLayer(state.layerToken);
    else layer?.popLayer?.();
    state.layerPushed = false;
    state.layerToken = null;
  }

  _finish(entity, state) {
    state.transform.position.elevation = state.baseElevation;
    this._releaseLayer(entity, state);
    if (state.mode === 'controlled') this._controlledDetachAt.set(entity, performance.now());
    this._active.delete(entity);
  }

  /** 受控攀爬脱离后的冷却剩余毫秒；0 表示可立即再次攀爬。 */
  getControlledDetachCooldown(entity, cooldownMs = 250) {
    const detachedAt = this._controlledDetachAt.get(entity);
    if (!detachedAt) return 0;
    return Math.max(0, cooldownMs - (performance.now() - detachedAt));
  }
}

export default ClimbSystem;
