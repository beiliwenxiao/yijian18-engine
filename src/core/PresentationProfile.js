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

const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const dimension = (source, fallback) => ({
  width: positive(source?.width ?? source?.w, fallback.width),
  height: positive(source?.height ?? source?.h, fallback.height)
});
const collisionOffset = (source, fallback) => ({
  offsetX: finite(source?.offsetX, fallback.offsetX),
  offsetY: finite(source?.offsetY, fallback.offsetY)
});

export const DEFAULT_PRESENTATION_PROFILE = Object.freeze({
  schemaVersion: 1,
  id: 'default-presentation',
  logicalResolution: { width: 1280, height: 720, scaleMode: 'stretch' },
  world: { pixelsPerWorldUnit: 1, gridSize: 32, tileWidth: 64, tileHeight: 32 },
  camera: { followSpeed: 0.15, deadzone: { x: 50, y: 50 } },
  actors: {
    directionMode: 8,
    player: {
      visual: { width: 64, height: 64 },
      footprint: { width: 28, height: 18 },
      colliderRadius: 14,
      collisionOffset: { offsetX: 0, offsetY: 0 }
    },
    unit: {
      visual: { width: 48, height: 48 },
      footprint: { width: 24, height: 16 },
      colliderRadius: 12,
      collisionOffset: { offsetX: 0, offsetY: 0 }
    }
  },
  ui: { mobileMinFontPx: 16 },
  palette: {}
});

export function normalizePresentationProfile(profile = {}) {
  const base = DEFAULT_PRESENTATION_PROFILE;
  const actor = (key) => ({
    visual: dimension(profile.actors?.[key]?.visual, base.actors[key].visual),
    footprint: dimension(profile.actors?.[key]?.footprint, base.actors[key].footprint),
    colliderRadius: positive(profile.actors?.[key]?.colliderRadius, base.actors[key].colliderRadius),
    collisionOffset: collisionOffset(profile.actors?.[key]?.collisionOffset, base.actors[key].collisionOffset)
  });
  const logical = dimension(profile.logicalResolution, base.logicalResolution);
  return {
    schemaVersion: positive(profile.schemaVersion, base.schemaVersion), id: String(profile.id || base.id),
    visualStyle: { ...(profile.visualStyle || {}) },
    logicalResolution: { ...logical, scaleMode: ['fit', 'stretch', 'window'].includes(profile.logicalResolution?.scaleMode) ? profile.logicalResolution.scaleMode : base.logicalResolution.scaleMode },
    world: { ...base.world, ...(profile.world || {}), pixelsPerWorldUnit: positive(profile.world?.pixelsPerWorldUnit, base.world.pixelsPerWorldUnit) },
    camera: { ...base.camera, ...(profile.camera || {}), deadzone: { ...base.camera.deadzone, ...(profile.camera?.deadzone || {}) } },
    actors: { directionMode: profile.actors?.directionMode === 4 ? 4 : 8, player: actor('player'), unit: actor('unit') },
    ui: { ...base.ui, ...(profile.ui || {}), mobileMinFontPx: positive(profile.ui?.mobileMinFontPx, base.ui.mobileMinFontPx) },
    palette: { ...(profile.palette || {}) }
  };
}

export default normalizePresentationProfile;
