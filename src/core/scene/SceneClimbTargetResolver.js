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
 * 从已投影的世界对象解析最近攀爬面。它不拥有能力判定、UI 提示或具体剧情；
 * controlled 模式仅投影场景配置，实际移动由 LocomotionSystem/ClimbSystem 执行。
 */
export class SceneClimbTargetResolver {
  static resolve({
    entity = null,
    sceneId = null,
    projectedObjects = [],
    climbableShapes = [],
    sceneData = null,
    worldOffset = { x: 0, y: 0 }
  } = {}) {
    const transform = entity?.getComponent?.('transform');
    if (!transform || !sceneId) return null;

    const offsetX = Number(worldOffset?.x) || 0;
    const offsetY = Number(worldOffset?.y) || 0;
    // 语义升级：任意物件（藤蔓/树/石头…）勾 climbable:true 即为可攀爬面，
    // 不再要求显式声明 semanticRole:'climbSurface'。
    const projected = Array.isArray(projectedObjects)
      ? projectedObjects.filter(object => (
        object?.sceneId === sceneId
        && (object?.semanticRole === 'climbSurface' || object?.climbable === true)
      ))
      : [];
    const localSurfaces = projected.length > 0
      ? projected
      : this._projectLocalSurfaces(sceneData, offsetX, offsetY);
    // 地形层 climbable shape（世界投影坐标）与 climbSurface 放置物一同参评；
    // shape 已含 worldOffset，不再二次偏移。
    const sources = [...localSurfaces, ...this._projectClimbableShapes(climbableShapes)]
      .map(surface => this._normalizeClimbableSource(surface, transform.position));

    let best = null;
    for (const surface of sources) {
      const centerX = Number(surface.x) + (Number(surface.width) || 0) / 2;
      const centerY = Number(surface.y) + (Number(surface.height) || 0) / 2;
      const distance = Math.hypot(
        transform.position.x - centerX,
        transform.position.y - centerY
      );
      const radius = Math.max(32, Number(surface.radius) || 96);
      // 配置了进入区（climbEnterBounds）的攀爬面：必须在进入/跌落区内起跳才能进入攀爬，
      // 靠近攀爬面但不在进入区时不可进入。未配置进入区的源保持半径判定。
      const enterZone = surface.climbEnterBounds || null;
      if (enterZone) {
        const margin = 12;
        const insideEnterZone = transform.position.x >= enterZone.minX - margin
          && transform.position.x <= enterZone.maxX + margin
          && transform.position.y >= enterZone.minY - margin
          && transform.position.y <= enterZone.maxY + margin;
        if (!insideEnterZone || (best && best.distance <= distance)) continue;
      } else if (distance > radius || (best && best.distance <= distance)) continue;

      const target = surface.climbTarget || {};
      const targetX = Number(target.x);
      const targetY = Number(target.y);
      if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) continue;
      const controlled = surface.climbMode === 'controlled';
      const localBounds = surface.climbBounds || {};
      const exit = surface.climbExit || target;
      const exitX = Number(exit.x);
      const exitY = Number(exit.y);
      if (controlled && (!Number.isFinite(exitX) || !Number.isFinite(exitY))) continue;
      // 跳下跌落落点基准：优先用进入区世界包围盒；无三区时回落到攀爬范围底部
      let enterBounds = surface.climbEnterBounds || null;
      if (controlled && !enterBounds) {
        const boundsLeft = Number(localBounds.x ?? surface.x)
          + (surface.climbBoundsWorld === true ? 0 : offsetX);
        const boundsTop = Number(localBounds.y ?? surface.y)
          + (surface.climbBoundsWorld === true ? 0 : offsetY);
        const boundsWidth = Number(localBounds.width ?? surface.width);
        const boundsHeight = Number(localBounds.height ?? surface.height);
        enterBounds = {
          minX: boundsLeft,
          minY: boundsTop,
          maxX: boundsLeft + boundsWidth,
          maxY: boundsTop + boundsHeight
        };
      }
      best = {
        id: surface.id,
        distance,
        promptTemplate: surface.prompt || '{jump}可以攀爬',
        requiresClimbAbility: surface.requiresClimbAbility !== false,
        hasExitZone: surface.climbHasExitZone !== false,
        targetPosition: {
          x: targetX + (surface.climbTargetWorld === true ? 0 : offsetX),
          y: targetY + (surface.climbTargetWorld === true ? 0 : offsetY)
        },
        ...(controlled ? {
          mode: 'controlled',
          enterBounds,
          climbPolygon: surface.climbPolygon || null,
          climbSurfaceBounds: surface.climbSurfaceBounds || null,
          bounds: {
            // climbBoundsWorld: 源已提供世界坐标 bounds（地形 climbable shape 路径），
            // 不得再叠加 chunk 偏移，否则玩家会被钳制到未加载区域（地图/物品全部消失）。
            x: Number(localBounds.x ?? surface.x) + (surface.climbBoundsWorld === true ? 0 : offsetX),
            y: Number(localBounds.y ?? surface.y) + (surface.climbBoundsWorld === true ? 0 : offsetY),
            width: Number(localBounds.width ?? surface.width),
            height: Number(localBounds.height ?? surface.height)
          },
          exitPosition: {
            x: exitX + (surface.climbExitWorld === true ? 0 : offsetX),
            y: exitY + (surface.climbExitWorld === true ? 0 : offsetY)
          },
          exitRadius: Math.max(0, Number(surface.climbExitRadius) || 18),
          speed: Math.max(1, Number(surface.climbSpeed) || 84),
          elevation: Math.max(0, Number(surface.climbElevation) || 14)
        } : {})
      };
    }
    return best;
  }

  static _projectLocalSurfaces(sceneData, offsetX, offsetY) {
    if (!Array.isArray(sceneData?.layers)) return [];
    return sceneData.layers.flatMap(layer => (layer.objects || [])
      .filter(object => object?.semanticRole === 'climbSurface' || object?.climbable === true)
      .map(object => ({
        ...object,
        x: Number(object.x) + offsetX,
        y: Number(object.y) + offsetY
      })));
  }

  /**
   * 语义归一化：把各类攀爬源整理成受控攀爬标准字段。
   * 1) climbZones 三区多边形（进入/攀爬/离开，顶点相对物件锚点）优先：
   *    攀爬区 → climbBounds；离开区 → climbExit/半径（区内任意点均视为抵达出口）；
   *    进入区 → 命中半径（站进进入区必能选中）。
   * 2) 普通物件勾 climbable:true 但未配置攀爬目标/出口时，
   *    以玩家当前位置为目标（跳入即贴附），并视为"处处皆出口"——
   *    脱离完全由「跳跃随时跳离」负责。
   * 显式配置过 climbTarget/climbExit 且未画三区的（如 S01 逃生藤蔓）保持原样。
   */
  static _normalizeClimbableSource(surface, playerPosition) {
    if (!surface) return surface;
    if (surface.climbZones) {
      const prepared = this._applyClimbZones(surface);
      if (prepared) surface = prepared;
    }
    if (surface.climbable !== true && surface.semanticRole !== 'climbSurface') return surface;
    // 新语义（勾选可攀爬的普通物件）默认不要求攀爬能力：跳入即攀爬。
    // 未显式配置 requiresClimbAbility 时必须补 false，否则解析器会按
    // `requiresClimbAbility !== false` 误判为需要解锁能力，导致跳跃永远进不了攀爬。
    if (surface.climbable === true && surface.requiresClimbAbility === undefined) {
      surface = { ...surface, requiresClimbAbility: false };
    }
    const hasTarget = Number.isFinite(Number(surface.climbTarget?.x))
      && Number.isFinite(Number(surface.climbTarget?.y));
    if (!hasTarget) {
      if (!playerPosition) return surface;
      surface = { ...surface, climbTarget: { x: playerPosition.x, y: playerPosition.y }, climbTargetWorld: true };
      if (!surface.climbMode) surface.climbMode = 'controlled';
      // 无显式 climbBounds 时回落到 surface.x/y（世界坐标），禁止解析器再叠加 chunk 偏移
      if (!Number.isFinite(Number(surface.climbBounds?.x))) {
        surface = { ...surface, climbBoundsWorld: true };
      }
    }
    const isControlledLike = surface.climbMode !== 'traverse';
    const hasExit = Number.isFinite(Number(surface.climbExit?.x))
      && Number.isFinite(Number(surface.climbExit?.y));
    if (!hasExit && isControlledLike) {
      const width = Math.max(0, Number(surface.width) || 0);
      const height = Math.max(0, Number(surface.height) || 0);
      surface = {
        ...surface,
        climbExit: { ...(surface.climbTarget || {}) },
        climbExitWorld: true,
        climbExitRadius: Math.max(width, height),
        // 兜底出口仅供坐标换算：无真实离开区 → isAtExit 恒为 false（跳跃=跳下跌落）
        climbHasExitZone: false
      };
    } else if (hasExit) {
      // 显式配置过出口（离开区/藤蔓 climbExit）→ 出口判定生效
      surface = { ...surface, climbHasExitZone: true };
    }
    return surface;
  }

  /**
   * 把 climbZones 三区多边形换算成标准攀爬字段；无有效区时返回 null（回落到旧字段/兜底）。
   * 顶点相对物件锚点存储，此处换算为世界坐标（surface.x/y 已含投影偏移）。
   */
  static _applyClimbZones(surface) {
    const zones = surface.climbZones || {};
    const anchorX = Number(surface.x) || 0;
    const anchorY = Number(surface.y) || 0;
    const toWorld = points => (Array.isArray(points)
      ? points
        .filter(point => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
        .map(point => [anchorX + Number(point[0]), anchorY + Number(point[1])])
      : null);
    const bboxOf = points => {
      if (!points || points.length < 3) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of points) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      return { minX, minY, maxX, maxY };
    };
    const climbBox = bboxOf(toWorld(zones.climb));
    const exitBox = bboxOf(toWorld(zones.exit));
    const enterBox = bboxOf(toWorld(zones.enter));
    if (!climbBox && !exitBox && !enterBox) return null;
    const prepared = { ...surface };
    if (climbBox) {
      prepared.climbBounds = {
        x: climbBox.minX,
        y: climbBox.minY,
        width: climbBox.maxX - climbBox.minX,
        height: climbBox.maxY - climbBox.minY
      };
      // 区块包围盒已换算为世界坐标（surface.x/y 为世界锚点），解析器不得再叠加偏移
      prepared.climbBoundsWorld = true;
      // 攀爬区多边形（世界坐标顶点）：攀爬移动的精确约束边界（而非包围盒）
      prepared.climbPolygon = toWorld(zones.climb);
    }
    // 被攀爬物体的本体世界包围盒：攀爬时高亮物体边缘用
    {
      const bodyWidth = Math.max(0, Number(surface.width) || 0);
      const bodyHeight = Math.max(0, Number(surface.height) || 0);
      const isFeetAnchor = surface.type === 'decoration' || surface.type === 'ref';
      const bodyLeft = isFeetAnchor ? anchorX - bodyWidth / 2 : anchorX;
      const bodyTop = isFeetAnchor ? anchorY - bodyHeight : anchorY;
      prepared.climbSurfaceBounds = {
        minX: bodyLeft,
        minY: bodyTop,
        maxX: bodyLeft + bodyWidth,
        maxY: bodyTop + bodyHeight
      };
    }
    if (exitBox) {
      prepared.climbExit = { x: (exitBox.minX + exitBox.maxX) / 2, y: (exitBox.minY + exitBox.maxY) / 2 };
      prepared.climbExitWorld = true;
      prepared.climbExitRadius = Math.max(1, Math.hypot(exitBox.maxX - exitBox.minX, exitBox.maxY - exitBox.minY) / 2);
    }
    if (enterBox) {
      // 命中半径 = 进入区对角线一半 + 本体中心到进入区中心的距离：站进进入区必能选中
      const width = Math.max(0, Number(surface.width) || 0);
      const height = Math.max(0, Number(surface.height) || 0);
      const isFeetAnchor = surface.type === 'decoration' || surface.type === 'ref';
      const bodyCx = isFeetAnchor ? anchorX : anchorX + width / 2;
      const bodyCy = isFeetAnchor ? anchorY - height / 2 : anchorY + height / 2;
      const enterCx = (enterBox.minX + enterBox.maxX) / 2;
      const enterCy = (enterBox.minY + enterBox.maxY) / 2;
      prepared.radius = Math.max(32,
        Math.hypot(enterBox.maxX - enterBox.minX, enterBox.maxY - enterBox.minY) / 2
        + Math.hypot(bodyCx - enterCx, bodyCy - enterCy));
      // 进入区世界包围盒：攀爬中「跳下」跌落的落点基准（入口区垂直下方）
      prepared.climbEnterBounds = { minX: enterBox.minX, minY: enterBox.minY, maxX: enterBox.maxX, maxY: enterBox.maxY };
    }
    return prepared;
  }

  /**
   * 地形层 climbable 源（世界坐标）直通：统一交给 _normalizeClimbableSource 做字段补全
   * （目标/出口注入、三区换算、进入区门槛），避免与 projectedObjects 路径产生两套判定。
   * climbBoundsWorld 标记坐标已是世界坐标，解析器不再叠加 chunk 偏移。
   */
  static _projectClimbableShapes(shapes) {
    if (!Array.isArray(shapes)) return [];
    return shapes
      .filter(shape => shape && Number.isFinite(Number(shape.x)) && Number.isFinite(Number(shape.y)))
      .map(shape => ({ ...shape, climbBoundsWorld: true }));
  }
}

export default SceneClimbTargetResolver;
