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
 * ScenePathLibrary - 场景剧情路径库（场景顶层 paths 的运行时收集器）。
 *
 * 数据模型见 .trae/rules/scene-path-library-design.md：场景 JSON 顶层
 * `paths: [{id, name, points: [[x,y],...], color?}]`——场景局部绝对坐标，
 * 点序即行进序。消费方（触发器命令如 army.march routeId、未来的 NPC 剧情走位）
 * 按 id 引用，不感知坐标换算。
 *
 * 用法（照 collectBuffZones 先例）：
 *   const { paths, loadedCount, total } = ScenePathLibrary.collectPaths(terrains);
 * 输出 points 已投影为世界坐标 [{x,y}...]，消费方直接使用，禁止二次加偏移。
 */
export class ScenePathLibrary {
  /**
   * 从多个 terrain 的场景数据中收集剧情路径，坐标转为世界坐标。
   * @param {Array} terrains - terrain 实例数组（每个持有 _sceneDataRaw + worldOffset）
   * @returns {{paths: Array<{id: string, name: string, color: string, points: Array<{x:number,y:number}>}>, loadedCount: number, total: number}}
   */
  static collectPaths(terrains) {
    const list = Array.isArray(terrains) ? terrains : [];
    const paths = [];
    const seenIds = new Set();
    let loadedCount = 0;

    for (const terrain of list) {
      const scene = terrain?._sceneDataRaw;
      if (!scene) continue;
      loadedCount++;
      if (!Array.isArray(scene.paths)) continue;

      const offset = terrain.worldOffset || { x: 0, y: 0 };

      for (const raw of scene.paths) {
        const id = typeof raw?.id === 'string' ? raw.id : '';
        if (!id) continue;
        // 同 id 跨 chunk：以先载入为准（流式加载重复注入时后者忽略）
        if (seenIds.has(id)) continue;
        const points = (Array.isArray(raw.points) ? raw.points : [])
          .filter(point => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
          .map(point => ({ x: Number(point[0]) + (offset.x || 0), y: Number(point[1]) + (offset.y || 0) }));
        if (points.length < 2) continue;
        seenIds.add(id);
        paths.push({
          id,
          name: typeof raw.name === 'string' ? raw.name : '',
          color: typeof raw.color === 'string' ? raw.color : '#b48cff',
          points
        });
      }
    }

    return { paths, loadedCount, total: list.length };
  }
}
