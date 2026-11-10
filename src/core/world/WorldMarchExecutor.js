/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * WorldMarchExecutor - 无实体军团的大地图行军执行器（模块 4 · 4A）
 *
 * 设计依据：spec.md §3/§4.4
 * - 只消费 `state.route`（节点链 + 边链 + 进度），不负责选路：
 *   选路由 `ArmyOrderSystem` 的 routePlanner（WorldRouteLayer.shortestPath）完成；
 * - 每 500ms 战略刻推进当前边一段（抵达节点后本刻不再续走，避免跨段速度混合误差）；
 * - 边在行军途中变为不可走（敌占关隘/封路）→ failed(routeBlocked)，交给场景层提示；
 * - 不写 Blackboard / 不碰实体；位置写回由 ArmyOrderSystem._applyExecutorResult 统一完成。
 */

/** 各边形态的速度倍率（相对 armyOrders.marchSpeed；缺省 1）。 */
export const DEFAULT_MODE_SPEED = Object.freeze({
  road: 1,
  bridge: 0.9,
  mountainPath: 0.6,
  ferry: 0.5,
  waterway: 0.7
});

const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0));

export class WorldMarchExecutor {
  /**
   * @param {Object} options
   * @param {import('./WorldRouteLayer.js').WorldRouteLayer} options.layer - 逻辑路径层（读节点坐标与边状态）
   * @param {number} [options.marchSpeed=120] - 基准速度（px/秒）
   * @param {number} [options.arrivalRadius=8] - 抵达判定半径（px）
   * @param {Object} [options.modeSpeed] - 边形态 → 速度倍率
   * @param {Function} [options.onEnterNode] - ({ state, nodeId, node }) => void
   */
  constructor({
    layer,
    marchSpeed = 120,
    arrivalRadius = 8,
    modeSpeed = null,
    onEnterNode = null
  } = {}) {
    if (!layer) throw new Error('WorldMarchExecutor: layer required');
    this.layer = layer;
    this.marchSpeed = Math.max(1, Number(marchSpeed) || 120);
    this.arrivalRadius = Math.max(0, Number(arrivalRadius) || 8);
    this.modeSpeed = { ...DEFAULT_MODE_SPEED, ...(modeSpeed || {}) };
    this.onEnterNode = typeof onEnterNode === 'function' ? onEnterNode : null;
  }

  /**
   * @param {Object} context - { state, order, stepMs }
   * @returns {{status:string, position?:Object, progress?:number, code?:string, edgeId?:string, reasons?:string[]}}
   */
  execute({ state, order, stepMs = 0 } = {}) {
    const route = state?.route;
    if (!route || !Array.isArray(route.nodeIds) || route.nodeIds.length < 2) {
      return { status: 'failed', code: 'routeMissing' };
    }
    const ms = Number(stepMs);
    if (!Number.isFinite(ms) || ms <= 0) return { status: 'executing', progress: clamp01(route.progress) };

    if (!Number.isFinite(Number(route.index)) || Number(route.index) < 1) route.index = 1;
    if (!Number.isFinite(Number(route.travelled))) route.travelled = 0;
    if (!Number.isFinite(Number(route.totalDistance)) || Number(route.totalDistance) <= 0) {
      route.totalDistance = this._routeDistance(route);
    }

    if (route.index >= route.nodeIds.length) {
      return { status: 'completed', position: { ...state.position }, progress: 1 };
    }

    const nodeId = String(route.nodeIds[route.index]);
    const node = this.layer.getNode(nodeId);
    if (!node?.position) return { status: 'failed', code: 'unknownNode', nodeId };

    const edgeId = route.edgeIds?.[route.index - 1] != null ? String(route.edgeIds[route.index - 1]) : null;
    if (edgeId) {
      const entry = this.layer.getSnapshot().edges[edgeId];
      if (entry && entry.passable === false) {
        return { status: 'failed', code: 'routeBlocked', edgeId, reasons: [...(entry.reasons || [])] };
      }
    }

    const targetX = Number(node.position.x);
    const targetY = Number(node.position.y);
    const currentX = Number(state.position?.x) || 0;
    const currentY = Number(state.position?.y) || 0;
    const dx = targetX - currentX;
    const dy = targetY - currentY;
    const distance = Math.hypot(dx, dy);

    const mode = edgeId ? this.layer.getEdge(edgeId)?.mode : null;
    const speed = this.marchSpeed * (Number(this.modeSpeed[mode]) || 1);
    const travel = (speed * ms) / 1000;

    if (distance <= this.arrivalRadius || distance <= travel) {
      state.position = { x: targetX, y: targetY };
      route.travelled += distance;
      route.index += 1;
      this.onEnterNode?.({ state, nodeId, node });
      if (route.index >= route.nodeIds.length) {
        route.progress = 1;
        return { status: 'completed', position: { ...state.position }, progress: 1 };
      }
      route.progress = clamp01(route.travelled / route.totalDistance);
      return { status: 'executing', position: { ...state.position }, progress: route.progress, enteredNodeId: nodeId };
    }

    const ratio = travel / distance;
    state.position = { x: currentX + dx * ratio, y: currentY + dy * ratio };
    route.travelled += travel;
    route.progress = clamp01(route.travelled / route.totalDistance);
    return { status: 'executing', position: { ...state.position }, progress: route.progress };
  }

  /** 路线总长（节点段直线距离之和；缺失节点按 0 计）。 */
  _routeDistance(route) {
    let total = 0;
    for (let index = 1; index < route.nodeIds.length; index += 1) {
      const from = this.layer.getNode(route.nodeIds[index - 1])?.position;
      const to = this.layer.getNode(route.nodeIds[index])?.position;
      if (!from || !to) continue;
      total += Math.hypot(Number(to.x) - Number(from.x), Number(to.y) - Number(from.y));
    }
    return total;
  }
}

export default WorldMarchExecutor;
