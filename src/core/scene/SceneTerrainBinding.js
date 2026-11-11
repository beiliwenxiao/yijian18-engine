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

import { Logger } from '../Logger.js';
import { SceneObjectProjector } from './SceneObjectProjector.js';
import { ScenePathLibrary } from './ScenePathLibrary.js';

/** 逐索引比较两个 terrain 引用列表是否不同（模块级函数，热路径零闭包分配）。 */
function terrainListDiffers(left, right) {
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return true;
  }
  return false;
}

/**
 * SceneTerrainBinding - 将已由世界流式会话创建的 terrain 绑定到通用场景生命周期。
 *
 * 不直接导入 Demo 类型；特效区渲染与碰撞解算由宿主场景注入。
 * Terrain 数据只来自同一份 canonical chunk 投影，不在 Binding 内再次读盘或读取缓存。
 */
export class SceneTerrainBinding {
  constructor({ scene, EffectZoneRenderer, SceneTerrainCollision } = {}) {
    this.scene = scene;
    this.EffectZoneRenderer = EffectZoneRenderer;
    this.SceneTerrainCollision = SceneTerrainCollision;
    this.projector = new SceneObjectProjector();
  }

  /** 替换唯一特效区域渲染器，并同步正式 Context 投影。 */
  setEffectZoneRenderer(renderer, { clearPrevious = false } = {}) {
    const scene = this.scene;
    const previous = scene.effectZoneRenderer || null;
    if (clearPrevious && previous && previous !== renderer) previous.clear?.();
    scene.effectZoneRenderer = renderer || null;
    if (scene.context?.presentation) {
      scene.context.presentation.effectZoneRenderer = renderer || null;
    }
    return renderer || null;
  }

  /**
   * 将已投影的多 chunk 特效区域交给唯一 renderer，并重置区域粒子累积器。
   * effectZones 必须已经处于世界坐标，避免在表现层重复应用 worldOffset。
   */
  setEffectZones(effectZones, { clearPrevious = true } = {}) {
    const scene = this.scene;
    if (!scene.particleSystem || !this.EffectZoneRenderer) return null;
    const renderer = new this.EffectZoneRenderer(scene.particleSystem);
    this.setEffectZoneRenderer(renderer, { clearPrevious });
    renderer.zones = Array.isArray(effectZones) ? effectZones : [];
    renderer._accumulators = renderer.zones.map(() => 0);
    return renderer;
  }

  /** 只清理当前实例，避免旧生命周期误清新场景接线。 */
  clearEffectZoneRenderer(renderer = this.scene.effectZoneRenderer) {
    const scene = this.scene;
    if (!renderer || scene.effectZoneRenderer !== renderer) return false;
    renderer.clear?.();
    scene.effectZoneRenderer = null;
    if (scene.context?.presentation?.effectZoneRenderer === renderer) {
      scene.context.presentation.effectZoneRenderer = null;
    }
    return true;
  }

  collectBuffZones() {
    const scene = this.scene;
    const terrains = scene._terrains || (scene.terrain ? [scene.terrain] : []);
    if (terrains.length === 0 || !this.SceneTerrainCollision) return;

    const { zones, loadedCount, total } = this.SceneTerrainCollision.collectBuffZones(terrains);
    if (loadedCount > 0) {
      scene.zoneEffectSystem.setZones(zones);
      scene._buffZones = zones;
      if (loadedCount >= total) scene._buffZonesCollected = true;
      if (zones.length > 0 && !scene._buffZonesLogged) {
        Logger.log(`[SceneTerrainBinding] 收集到 ${zones.length} 个 Buff 多边形 (${loadedCount}/${total} terrains loaded)`);
        scene._buffZonesLogged = true;
      }
    }
  }

  renderBuffZones(ctx) {
    const scene = this.scene;
    const debugMode = scene.debugShowBuffZones === true;
    if (!scene._buffZones || scene._buffZones.length === 0) {
      if (debugMode && !scene._buffZonesCollected) this.collectBuffZones();
      if (!scene._buffZones || scene._buffZones.length === 0) return;
    }
    this.SceneTerrainCollision.renderBuffZones(ctx, scene._buffZones, debugMode);
  }

  /**
   * 收集场景剧情路径（顶层 paths）到 scene._scenePaths / _scenePathMap。
   * 延迟收集同 buffZone：terrain 异步加载完成后由帧管线触发，集齐后置位守卫。
   * 消费方（army.march routeId 等）用 _scenePathMap.get(id) 取世界坐标路径点。
   */
  collectScenePaths() {
    const scene = this.scene;
    const terrains = scene._terrains || (scene.terrain ? [scene.terrain] : []);
    if (terrains.length === 0) return;

    const { paths, loadedCount, total } = ScenePathLibrary.collectPaths(terrains);
    if (loadedCount > 0) {
      scene._scenePaths = paths;
      scene._scenePathMap = new Map(paths.map(path => [path.id, path]));
      if (loadedCount >= total) scene._scenePathsCollected = true;
    }
  }

  /**
   * 收集当前所有地形的阻挡碰撞多边形（世界坐标），供批量刷出避障探测使用。
   * 只返回带 points 的多边形形状；无地形/未加载时返回空数组。
   */
  getCollisionShapes() {
    const scene = this.scene;
    const terrains = scene?._terrains?.length ? scene._terrains : (scene?.terrain ? [scene.terrain] : []);
    const shapes = [];
    for (const terrain of terrains) {
      const list = Array.isArray(terrain?._collisionShapes) ? terrain._collisionShapes : [];
      for (const shape of list) {
        if (Array.isArray(shape?.points) && shape.points.length >= 3) shapes.push(shape);
      }
    }
    return shapes;
  }

  checkTerrainCollision() {
    const scene = this.scene;
    const terrains = scene._terrains?.length ? scene._terrains : (scene.terrain ? [scene.terrain] : []);
    if (terrains.length === 0 || !this.SceneTerrainCollision) return;
    if (!scene._terrainCollision) scene._terrainCollision = new this.SceneTerrainCollision({ entityRadius: 12 });
    if (scene.jumpSystem) {
      scene._terrainCollision.setJumpSystem?.(scene.jumpSystem);
      // 跳跃路径探针：JumpSystem 每帧扫描剩余路径——可落脚提前落地 / 可阻挡跳跃撞墙弹回
      // （terrain 列表动态读取，流式加载替换数组后探针仍指向当前 chunk 集合）
      if (!scene._jumpPathProbe) {
        scene._jumpPathProbe = (fromX, fromY, dirX, dirY, maxDistance) => {
          const list = scene._terrains?.length ? scene._terrains : (scene.terrain ? [scene.terrain] : []);
          return scene._terrainCollision?.scanEntityJumpPath?.(list, fromX, fromY, dirX, dirY, maxDistance) || null;
        };
      }
      scene.jumpSystem.setPathProbe?.(scene._jumpPathProbe);
    }
    // 攀爬中的实体跳过地形碰撞（攀爬区间常与树冠碰撞体重叠）
    const climbSystem = scene.locomotionSystem?.climbSystem;
    if (climbSystem) scene._terrainCollision.setClimbSystem?.(climbSystem);
    scene._terrainCollision.resolveTerrains(terrains, scene.entities);
  }

  /**
   * teleport 等位置事实变更后，同步碰撞解算的"已解算位置"记忆。
   * 不同步的话，防穿越判定会把单帧大位移当作穿墙，把实体拉回旧 chunk 位置。
   */
  rememberEntityResolvedPosition(entity) {
    const scene = this.scene;
    if (!entity || !this.SceneTerrainCollision) return false;
    if (!scene._terrainCollision) scene._terrainCollision = new this.SceneTerrainCollision({ entityRadius: 12 });
    if (scene.jumpSystem) scene._terrainCollision.setJumpSystem?.(scene.jumpSystem);
    return scene._terrainCollision.rememberEntityPosition(entity);
  }

  /**
   * 按场景局部坐标安装或移除运行时碰撞体。
   * 动态工事、ref 世界物件等表现可以与静态场景共用同一碰撞解算器，且 worldOffset 只应用一次。
   * block 与 walkable 互斥；可落脚形状按 SceneTerrainCollision 既有优先级先于阻挡形状判定。
   */
  setDynamicCollider({ sceneId = null, id, shape = null, enabled = true, mode = 'block' } = {}) {
    if (!id) return false;
    if (mode !== 'block' && mode !== 'walkable') return false;
    const scene = this.scene;
    const terrains = scene._terrains?.length ? scene._terrains : (scene.terrain ? [scene.terrain] : []);
    const terrain = terrains.find(candidate => !sceneId || candidate?._editorSceneId === sceneId);
    if (!terrain) return false;
    terrain._collisionShapes = Array.isArray(terrain._collisionShapes) ? terrain._collisionShapes : [];
    terrain._walkableShapes = Array.isArray(terrain._walkableShapes) ? terrain._walkableShapes : [];
    const marker = `dynamic:${id}`;
    for (const collection of [terrain._collisionShapes, terrain._walkableShapes]) {
      for (let index = collection.length - 1; index >= 0; index--) {
        if (collection[index]?.__dynamicColliderId === marker) collection.splice(index, 1);
      }
    }
    scene._terrainCollision?.invalidate?.(terrain);
    // 编辑器 shape 表现层缓存（Scene1Terrain._renderEditorShapes 离屏缓存）失效：
    // 动态碰撞体会增删 walkable/collision 集合条目
    terrain._editorShapesVersion = (terrain._editorShapesVersion || 0) + 1;
    if (!enabled) return true;
    if (!shape || typeof shape !== 'object') return false;

    const offset = terrain.worldOffset || { x: 0, y: 0 };
    const projected = this.projector.project({
      ...shape,
      id: shape.id || id,
      type: shape.type || 'shape',
      __dynamicColliderId: marker,
      collide: mode === 'block',
      walkable: mode === 'walkable'
    }, offset);
    const target = mode === 'walkable' ? terrain._walkableShapes : terrain._collisionShapes;
    target.push(projected);
    scene._terrainCollision?.invalidate?.(terrain);
    return true;
  }

  /**
   * 同步小地图 terrain 引用，不建立或重建静态缩略图。
   * HUD 每帧调用本方法；背景缓存只能由区域激活提交后的显式入口建立。
   */
  updateMinimap(minimap) {
    const scene = this.scene;
    if (!minimap) return;
    // 兜底单地形缓冲：流式场景 _terrains 为空时复用（仅 scene.terrain 引用变化时重建），
    // 免每帧 [scene.terrain] 与比较闭包分配
    let sourceTerrains = scene._terrains;
    if (!(sourceTerrains?.length > 0)) {
      if (scene.terrain) {
        let fallback = this._minimapTerrainFallback;
        if (!fallback || fallback[0] !== scene.terrain) {
          fallback = [scene.terrain];
          this._minimapTerrainFallback = fallback;
        }
        sourceTerrains = fallback;
      } else {
        sourceTerrains = this._minimapTerrainEmpty
          || (this._minimapTerrainEmpty = []);
      }
    }
    const currentTerrains = Array.isArray(minimap._terrains) ? minimap._terrains : [];
    const terrainSetChanged = sourceTerrains.length !== currentTerrains.length
      || terrainListDiffers(sourceTerrains, currentTerrains);
    if (terrainSetChanged) minimap.setTerrains(sourceTerrains);
  }
}

export default SceneTerrainBinding;