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

/**
 * Bounds-only camera projection for streamed or single-scene worlds.
 * The caller owns camera follow timing; this utility only clamps its final position.
 */
export class SceneCameraBounds {
  static clamp(camera, bounds) {
    if (!camera || !bounds) return false;
    const width = Number(bounds.width);
    const height = Number(bounds.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) return false;

    const left = Number(bounds.left ?? bounds.x ?? 0);
    const top = Number(bounds.top ?? bounds.y ?? 0);
    const halfWidth = Math.max(0, Number(camera.width) || 0) / 2;
    const halfHeight = Math.max(0, Number(camera.height) || 0) / 2;
    const minX = left + Math.min(halfWidth, width / 2);
    const maxX = left + Math.max(width - halfWidth, width / 2);
    const minY = top + Math.min(halfHeight, height / 2);
    const maxY = top + Math.max(height - halfHeight, height / 2);

    camera.position.x = Math.max(minX, Math.min(maxX, Number(camera.position?.x) || minX));
    camera.position.y = Math.max(minY, Math.min(maxY, Number(camera.position?.y) || minY));
    return true;
  }

  static clampToWorldIndex(camera, worldIndex, regionId = null) {
    return this.clamp(camera, worldIndex?.getBounds?.(regionId));
  }
}

export default SceneCameraBounds;
