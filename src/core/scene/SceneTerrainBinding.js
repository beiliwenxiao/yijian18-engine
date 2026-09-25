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
        console.log(`[SceneTerrainBinding] 收集到 ${zones.length} 个 Buff 多边形 (${loadedCount}/${total} terrains loaded)`);
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

  checkTerrainCollision() {
    const scene = this.scene;
    const terrains = scene._terrains?.length ? scene._terrains : (scene.terrain ? [scene.terrain] : []);
    if (terrains.length === 0 || !this.SceneTerrainCollision) return;
    if (!scene._terrainCollision) scene._terrainCollision = new this.SceneTerrainCollision({ entityRadius: 12 });
    if (scene.jumpSystem) scene._terrainCollision.setJumpSystem?.(scene.jumpSystem);
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
   * 对当前全部 terrain 执行只读阻挡查询，供移动规划复用正式碰撞几何。
   * terrain 数据已经是世界坐标；此处不得再次应用 worldOffset。
   */
  isPositionBlocked(x, y, { radius = null } = {}) {
    const scene = this.scene;
    const terrains = scene._terrains?.length ? scene._terrains : (scene.terrain ? [scene.terrain] : []);
    if (terrains.length === 0 || !this.SceneTerrainCollision) return false;
    if (!scene._terrainCollision) scene._terrainCollision = new this.SceneTerrainCollision({ entityRadius: 12 });
    return scene._terrainCollision.isAnyPositionBlocked(terrains, x, y, {
      entityRadius: radius
    });
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
    const sourceTerrains = scene._terrains?.length > 0
      ? scene._terrains
      : (scene.terrain ? [scene.terrain] : []);
    const currentTerrains = Array.isArray(minimap._terrains) ? minimap._terrains : [];
    const terrainSetChanged = sourceTerrains.length !== currentTerrains.length
      || sourceTerrains.some((terrain, index) => terrain !== currentTerrains[index]);
    if (terrainSetChanged) minimap.setTerrains(sourceTerrains);
  }
}

export default SceneTerrainBinding;