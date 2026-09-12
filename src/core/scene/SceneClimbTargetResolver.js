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
    sceneData = null,
    worldOffset = { x: 0, y: 0 }
  } = {}) {
    const transform = entity?.getComponent?.('transform');
    if (!transform || !sceneId) return null;

    const offsetX = Number(worldOffset?.x) || 0;
    const offsetY = Number(worldOffset?.y) || 0;
    const projected = Array.isArray(projectedObjects)
      ? projectedObjects.filter(object => (
        object?.sceneId === sceneId && object?.semanticRole === 'climbSurface'
      ))
      : [];
    const sources = projected.length > 0
      ? projected
      : this._projectLocalSurfaces(sceneData, offsetX, offsetY);

    let best = null;
    for (const surface of sources) {
      const centerX = Number(surface.x) + (Number(surface.width) || 0) / 2;
      const centerY = Number(surface.y) + (Number(surface.height) || 0) / 2;
      const distance = Math.hypot(
        transform.position.x - centerX,
        transform.position.y - centerY
      );
      const radius = Math.max(32, Number(surface.radius) || 96);
      if (distance > radius || (best && best.distance <= distance)) continue;

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
      best = {
        id: surface.id,
        distance,
        promptTemplate: surface.prompt || '{climb}攀爬',
        requiresClimbAbility: surface.requiresClimbAbility !== false,
        targetPosition: {
          x: targetX + (surface.climbTargetWorld === true ? 0 : offsetX),
          y: targetY + (surface.climbTargetWorld === true ? 0 : offsetY)
        },
        ...(controlled ? {
          mode: 'controlled',
          bounds: {
            x: Number(localBounds.x ?? surface.x) + offsetX,
            y: Number(localBounds.y ?? surface.y) + offsetY,
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
      .filter(object => object?.semanticRole === 'climbSurface')
      .map(object => ({
        ...object,
        x: Number(object.x) + offsetX,
        y: Number(object.y) + offsetY
      })));
  }
}

export default SceneClimbTargetResolver;
