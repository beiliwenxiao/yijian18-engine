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
 * 共享图集定义的只读解析投影。
 * sharedAtlases 是游戏级事实源；localAtlases 仅用于读取旧场景，不能覆盖同 ID 的共享定义。
 */
export class AtlasRegistry {
  constructor(sharedAtlases = [], localAtlases = []) {
    this.setSources(sharedAtlases, localAtlases);
  }

  setSources(sharedAtlases = [], localAtlases = []) {
    this.sharedAtlases = Array.isArray(sharedAtlases) ? sharedAtlases : [];
    this.localAtlases = Array.isArray(localAtlases) ? localAtlases : [];
    this.sharedIds = new Set();
    this.atlases = new Map();

    for (const atlas of this.sharedAtlases) {
      if (!atlas?.id || this.sharedIds.has(atlas.id)) continue;
      this.sharedIds.add(atlas.id);
      this.atlases.set(atlas.id, atlas);
    }
    for (const atlas of this.localAtlases) {
      if (!atlas?.id || this.atlases.has(atlas.id)) continue;
      this.atlases.set(atlas.id, atlas);
    }
    return this;
  }

  getAll() {
    return [...this.atlases.values()];
  }

  getAtlas(atlasId) {
    return this.atlases.get(atlasId) || null;
  }

  getSlice(atlasId, sliceKey) {
    if (!atlasId || !sliceKey) return null;
    return this.getAtlas(atlasId)?.slices?.[sliceKey] || null;
  }

  findAtlasBySliceKey(sliceKey) {
    if (!sliceKey) return null;
    for (const atlas of this.atlases.values()) {
      if (atlas?.slices?.[sliceKey]) return atlas;
    }
    return null;
  }

  isShared(atlasId) {
    return this.sharedIds.has(atlasId);
  }
}

export default AtlasRegistry;
