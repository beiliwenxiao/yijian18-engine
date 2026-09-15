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

import { resolveSceneSpatialGeometry } from './SceneSpatialGeometry.js';

const GET_OBJECT = () => ({});
const GET_NULL = () => null;
const GET_ENTITIES = () => [];

function entityArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.all)) return value.all;
  if (typeof value?.values === 'function') return Array.from(value.values());
  return [];
}

function finitePosition(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return { x: value.x, y: value.y };
}

/** 只依赖分组 getter 的 HUD 帧更新器。 */
export class SceneHudUpdater {
  constructor({
    getUI = GET_OBJECT,
    getSystems = GET_OBJECT,
    getWorld = GET_OBJECT,
    getContext = GET_OBJECT,
    getPlayer = GET_NULL,
    getEntities = GET_ENTITIES,
    performanceOptimizer = null
  } = {}) {
    this.getUI = typeof getUI === 'function' ? getUI : GET_OBJECT;
    this.getSystems = typeof getSystems === 'function' ? getSystems : GET_OBJECT;
    this.getWorld = typeof getWorld === 'function' ? getWorld : GET_OBJECT;
    this.getContext = typeof getContext === 'function' ? getContext : GET_OBJECT;
    this.getPlayer = typeof getPlayer === 'function' ? getPlayer : GET_NULL;
    this.getEntities = typeof getEntities === 'function' ? getEntities : GET_ENTITIES;
    this.performanceOptimizer = performanceOptimizer;
    this._enemyPositions = null;
    this._taskMarkers = [];
    this._taskMarkerKeys = new Set();
    this._panelBuffer = [null, null, null, null];
    this._updatedPanels = new Set();
  }

  _shouldUpdate(channel) {
    return typeof this.performanceOptimizer?.shouldUpdate !== 'function' ||
      this.performanceOptimizer.shouldUpdate(channel);
  }

  updateCooldowns() {
    const ui = this.getUI() || {};
    const systems = this.getSystems() || {};
    this._updateCooldown(ui.flightButton, systems.flightSystem || systems.flight,
      'getCooldownRemaining', 'getCooldownTotal');
    this._updateCooldown(ui.throwButton, systems.weaponRenderer || systems.throw,
      'getThrowCooldownRemaining', 'getThrowCooldownTotal');
    this._updateCooldown(ui.blockButton, systems.combatSystem || systems.combat,
      'getBlockCooldownRemaining', 'getBlockCooldownTotal');
  }

  _updateCooldown(button, system, remaining, total) {
    if (!button?.setCooldown || typeof system?.[remaining] !== 'function') return;
    button.setCooldown(system[remaining](), system[total]?.());
  }

  updateDialogue(dt = 0) {
    const ui = this.getUI() || {};
    const systems = this.getSystems() || {};
    const dialogue = systems.dialogueSystem || systems.dialogue;
    const box = ui.dialogueBox || ui.dialogue;
    if (!dialogue || !box) return;

    const active = dialogue.isDialogueActive?.() === true;
    if (active && !box.visible) box.show?.();
    else if (!active && box.visible) box.hide?.();
    box.update?.(dt);
  }

  updatePanels(dt = 0) {
    const ui = this.getUI() || {};
    // 决策弹窗倒计时属于业务可见时间，必须逐帧推进，不能被普通 HUD 节流拉长。
    ui.itemGainedPopup?.update?.(dt);
    if (!this._shouldUpdate('ui')) return;
    const updated = this._updatedPanels;
    const panels = this._panelBuffer;
    updated.clear();
    panels[0] = ui.backpackPanel || ui.backpack;
    panels[1] = ui.bottomControlBar;
    panels[2] = ui.playerStatusHUD;
    panels[3] = ui.gamepadPanel;
    for (let index = 0; index < panels.length; index++) {
      const panel = panels[index];
      if (!panel || updated.has(panel)) continue;
      updated.add(panel);
      panel.update?.(dt);
    }
    ui.updatePanelHover?.();
  }

  _resolveTaskMarkerPosition(target, services) {
    const direct = finitePosition(target);
    if (direct) return direct;
    if (!target?.targetId || !target?.sceneId) return null;

    const inspection = services.placements?.inspectPlacement?.(target.targetId) || null;
    const placementSceneId = inspection?.placement?.sceneId || null;
    if (placementSceneId === target.sceneId) {
      const placementPosition = finitePosition(inspection.actual) || finitePosition(inspection.expected);
      if (placementPosition) return placementPosition;
    }

    const projectedObject = services.worldQuery?.findProjectedObject?.(target.sceneId, target.targetId) || null;
    if (projectedObject) {
      const geometry = resolveSceneSpatialGeometry(projectedObject);
      const projectedPosition = finitePosition(geometry?.anchor);
      if (projectedPosition) return projectedPosition;
    }

    const triggerObject = services.triggerBindings?.sceneObjects?.find?.(candidate => (
      candidate?.sceneId === target.sceneId && candidate?.id === target.targetId
    )) || null;
    return triggerObject
      ? finitePosition(resolveSceneSpatialGeometry(triggerObject)?.anchor)
      : null;
  }

  _updateTaskMarkers(minimap, player) {
    const context = this.getContext() || {};
    const services = context.services || {};
    const projection = services.taskGraph?.getProjection?.(player?.id || null) || [];
    const markers = this._taskMarkers;
    const keys = this._taskMarkerKeys;
    markers.length = 0;
    keys.clear();

    for (const task of projection) {
      for (const node of task?.nodes || []) {
        const target = node?.mapTarget;
        if (!target) continue;
        const position = this._resolveTaskMarkerPosition(target, services);
        if (!position) continue;
        const key = `${target.sceneId}:${target.targetId || ''}:${position.x}:${position.y}`;
        if (keys.has(key)) continue;
        keys.add(key);
        markers.push({
          ...position,
          sceneId: target.sceneId,
          targetId: target.targetId || null,
          instanceId: task.instanceId,
          nodeId: node.nodeId,
          label: target.label || node.label || task.title
        });
      }
    }
    minimap.setTaskMarkers?.(markers);
  }

  updateMinimap(dt = 0) {
    const ui = this.getUI() || {};
    const world = this.getWorld() || {};
    const minimap = ui.minimap || world.minimap;
    if (!minimap) return;

    const terrainBinding = world.terrainBinding || world.binding;
    terrainBinding?.updateMinimap?.(minimap);
    const worldIndex = world.worldIndex || null;
    const region = world.worldRegion || world.region;
    const regionRef = region?.id ?? region ?? null;
    if (worldIndex && regionRef != null &&
        (minimap._worldIndex !== worldIndex || minimap._regionRef !== regionRef)) {
      minimap.setWorldIndex?.(worldIndex, regionRef);
    }

    const player = this.getPlayer();
    const playerTransform = player?.getComponent?.('transform');
    if (playerTransform) minimap.setPlayerPosition?.(playerTransform.position);
    this._updateTaskMarkers(minimap, player);

    if (!this._enemyPositions || this._shouldUpdate('minimap')) {
      const positions = this._enemyPositions || [];
      positions.length = 0;
      for (const entity of entityArray(this.getEntities())) {
        if (entity?.type !== 'enemy' || entity.isDead || entity.isDying) continue;
        const transform = entity.getComponent?.('transform');
        if (transform) positions.push(transform.position);
      }
      this._enemyPositions = positions;
    }
    minimap.setEnemyPositions?.(this._enemyPositions);

    const camera = world.camera || world.cameraInstance;
    if (typeof camera?.getViewBounds === 'function') {
      minimap.setViewBounds?.(camera.getViewBounds());
    }
    minimap.update?.(dt);
  }

  update(dt = 0) {
    this.updateCooldowns();
    this.updateDialogue(dt);
    this.updatePanels(dt);
    this.updateMinimap(dt);
  }
}

export default SceneHudUpdater;
