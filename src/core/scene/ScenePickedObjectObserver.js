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
 * Scans compatible scene object lists for objects already marked as picked.
 * State commitment and domain-specific reactions remain with the injected callback.
 */
export class ScenePickedObjectObserver {
  constructor({ lists = [], onPicked = null } = {}) {
    this.lists = lists;
    this.onPicked = typeof onPicked === 'function' ? onPicked : null;
  }

  scan() {
    if (!this.onPicked) return 0;
    let observed = 0;
    for (const source of this.lists || []) {
      const values = typeof source === 'function' ? source() : source;
      if (!values || typeof values[Symbol.iterator] !== 'function') continue;
      for (const value of values) {
        if (value?.picked !== true) continue;
        this.onPicked(value);
        observed++;
      }
    }
    return observed;
  }
}

export default ScenePickedObjectObserver;
