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

function setPlayerPosition(player, x, y) {
  if (!player) return false;
  if (typeof player.setPosition === 'function') {
    player.setPosition(x, y);
    return true;
  }
  const transform = typeof player.getComponent === 'function' ? player.getComponent('transform') : null;
  const position = transform?.position || player.position;
  if (!position) return false;
  position.x = x;
  position.y = y;
  return true;
}

function setCameraPosition(camera, x, y) {
  if (!camera) return false;
  if (typeof camera.centerOn === 'function') camera.centerOn(x, y);
  else if (typeof camera.setPosition === 'function') camera.setPosition(x, y);
  else if (camera.position) Object.assign(camera.position, { x, y });
  else return false;
  return true;
}

function readPosition(target) {
  const transform = typeof target?.getComponent === 'function' ? target.getComponent('transform') : null;
  const position = transform?.position || target?.position;
  if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) return { x: position.x, y: position.y };
  if (Number.isFinite(target?.x) && Number.isFinite(target?.y)) return { x: target.x, y: target.y };
  return null;
}

function getSceneExtent(chunk, cell, region) {
  const worldWidth = Number(chunk?.worldWidth ?? cell?.worldWidth);
  const worldHeight = Number(chunk?.worldHeight ?? cell?.worldHeight);
  return {
    width: Number.isFinite(worldWidth) && worldWidth > 0 ? worldWidth : region.chunkWidth,
    height: Number.isFinite(worldHeight) && worldHeight > 0 ? worldHeight : region.chunkHeight
  };
}

/** 大地图区块传送器；所有状态访问和副作用均由构造参数注入。 */
export class ChunkNavigator {
  constructor({
    getWorldIndex = () => null,
    getChunk = () => null,
    findSpawn = () => null,
    getPlayer = () => null,
    getCamera = () => null,
    projector = null,
    prepareTarget = null,
    captureState = null,
    restoreState = null,
    onSceneEnter = null,
    onFallback = null,
    transition = null
  } = {}) {
    this.getWorldIndex = getWorldIndex;
    this.getChunk = getChunk;
    this.findSpawn = findSpawn;
    this.getPlayer = getPlayer;
    this.getCamera = getCamera;
    this.projector = projector || new SceneObjectProjector();
    this.prepareTarget = typeof prepareTarget === 'function' ? prepareTarget : null;
    this.captureState = typeof captureState === 'function' ? captureState : null;
    this.restoreState = typeof restoreState === 'function' ? restoreState : null;
    this.onSceneEnter = onSceneEnter;
    this.onFallback = onFallback;
    this.transition = transition;
  }

  async teleport({ sceneId, spawnRef = null, x = null, y = null, transition = 'none' } = {}) {
    if (!sceneId) return this._fallback({ reason: 'missingSceneId', sceneId, spawnRef });

    let worldIndex;
    let cell;
    let chunk;
    try {
      worldIndex = this.getWorldIndex?.() || null;
      cell = worldIndex?.findScene?.(sceneId) || null;
      if (!cell || worldIndex?.isLoadable?.(sceneId) !== true) {
        return this._fallback({ reason: 'chunkNotFound', sceneId, spawnRef });
      }
      chunk = this.getChunk?.(sceneId) || cell;
    } catch (error) {
      return this._fallback({ reason: 'lookupFailed', sceneId, spawnRef, error });
    }

    const region = worldIndex.getRegion(cell.regionId);
    const offset = worldIndex.getOffset(sceneId);
    let spawn = null;
    if (spawnRef != null) {
      try {
        spawn = this.findSpawn?.(sceneId, spawnRef) || null;
      } catch (error) {
        return this._fallback({ reason: 'spawnLookupFailed', sceneId, spawnRef, error });
      }
    }

    let worldX;
    let worldY;
    if (spawn) {
      worldX = Number(spawn.x) || 0;
      worldY = Number(spawn.y) || 0;
    } else {
      const extent = getSceneExtent(chunk, cell, region);
      const localX = x == null ? extent.width / 2 : Number(x) || 0;
      const localY = y == null ? extent.height / 2 : Number(y) || 0;
      const projected = this.projector.project({ x: localX, y: localY }, offset);
      worldX = projected.x;
      worldY = projected.y;
    }

    const commit = async () => {
      const player = this.getPlayer?.() || null;
      const camera = this.getCamera?.() || null;
      const rollback = {
        player: readPosition(player),
        camera: readPosition(camera),
        external: this.captureState ? await this.captureState({ sceneId, spawnRef }) : null
      };
      const restore = async () => {
        if (rollback.player) setPlayerPosition(player, rollback.player.x, rollback.player.y);
        if (rollback.camera) setCameraPosition(camera, rollback.camera.x, rollback.camera.y);
        if (this.restoreState) await this.restoreState(rollback.external, { sceneId, spawnRef });
      };
      try {
        if (this.prepareTarget) {
          const prepared = await this.prepareTarget({ sceneId, spawnRef, spawn, chunk, x: worldX, y: worldY });
          if (prepared === false || prepared?.ok === false) {
            try {
              await restore();
            } catch (rollbackError) {
              return {
                ok: false, cancelled: true, reason: 'targetRollbackFailed',
                errors: [
                  ...(prepared?.errors || []),
                  { code: rollbackError?.code || 'targetRollbackFailed', path: 'world.teleport.rollback', message: rollbackError?.message || String(rollbackError) }
                ]
              };
            }
            return {
              ok: false, cancelled: true, reason: 'targetPrepareFailed',
              errors: prepared?.errors || []
            };
          }
          if (spawnRef != null && !spawn) {
            spawn = prepared?.spawn || this.findSpawn?.(sceneId, spawnRef) || null;
            if (spawn) {
              worldX = Number(spawn.x) || 0;
              worldY = Number(spawn.y) || 0;
            }
          }
        }
        const playerMoved = setPlayerPosition(player, worldX, worldY);
        const cameraMoved = setCameraPosition(camera, worldX, worldY);
        const result = { sceneId, spawnRef, spawn, chunk, x: worldX, y: worldY, playerMoved, cameraMoved };
        if (typeof this.onSceneEnter === 'function') await this.onSceneEnter(result);
        return { ok: true, ...result };
      } catch (error) {
        try {
          await restore();
        } catch (rollbackError) {
          return {
            ok: false, cancelled: true, reason: 'targetRollbackFailed',
            errors: [
              { code: error?.code || 'targetCommitFailed', path: 'world.teleport', message: error?.message || String(error) },
              { code: rollbackError?.code || 'targetRollbackFailed', path: 'world.teleport.rollback', message: rollbackError?.message || String(rollbackError) }
            ]
          };
        }
        return {
          ok: false, cancelled: true, reason: 'targetCommitFailed',
          errors: [{ code: error?.code || 'targetCommitFailed', path: 'world.teleport', message: error?.message || String(error) }]
        };
      }
    };

    if (transition === 'none' || !this.transition) return commit();
    if (typeof this.transition === 'function') return this.transition(transition, commit);
    if (typeof this.transition.start === 'function') {
      const outcome = await this.transition.start(commit);
      return outcome?.cancelled ? outcome : (outcome?.value ?? outcome);
    }
    return commit();
  }

  _fallback(context) {
    if (typeof this.onFallback !== 'function') return Promise.resolve(null);
    try {
      return Promise.resolve(this.onFallback(context));
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

export default ChunkNavigator;
