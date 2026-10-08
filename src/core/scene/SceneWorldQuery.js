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

import { SceneClimbTargetResolver } from './SceneClimbTargetResolver.js';

/**
 * Read-only scene-world query facade. Projected scene objects are always consumed
 * as world coordinates; local scene data is only passed to the resolver fallback.
 */
export class SceneWorldQuery {
  constructor({ getSession, getCurrentSceneId, getProjectedObjects, getClimbableShapes } = {}) {
    this.getSession = getSession || (() => null);
    this.getCurrentSceneId = getCurrentSceneId || (() => null);
    this.getProjectedObjects = getProjectedObjects || (() => []);
    // 当前 chunk 地形层中标记 climbable 的 shape（世界坐标），由宿主懒加载注入。
    this.getClimbableShapes = getClimbableShapes || (() => []);
  }

  getChunk(sceneId = this.getCurrentSceneId()) {
    return sceneId ? this.getSession()?.getChunk?.(sceneId) || null : null;
  }

  findProjectedObject(sceneId, objectId) {
    if (!sceneId || !objectId) return null;
    return this.getSession()?.findSceneObject?.(sceneId, objectId) || null;
  }

  resolveClimbTarget({ entity = null, sceneId = this.getCurrentSceneId() } = {}) {
    const chunk = this.getChunk(sceneId);
    return SceneClimbTargetResolver.resolve({
      entity,
      sceneId,
      projectedObjects: this.getProjectedObjects() || [],
      climbableShapes: this.getClimbableShapes() || [],
      sceneData: chunk?.sceneData || null,
      worldOffset: chunk?.offset || { x: 0, y: 0 }
    });
  }
}

export default SceneWorldQuery;
