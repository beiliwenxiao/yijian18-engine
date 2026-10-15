/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * LayerComponent.js
 * 世界渲染分层组件
 *
 * 三类分层语义（见 .kiro_old/specs/dual-rendering-backend/design.md §9）：
 *   - worldLayer ：世界子层（绘制顺序分组）
 *   - floorId    ：地图楼层（与 TransformComponent.floorId 冗余，便于索引）
 *   - renderOrder：同层内手动微调
 */

import { Component } from '../Component.js';

/**
 * 允许的 worldLayer 值
 */
export const WORLD_LAYERS = Object.freeze([
  'ground',   // 地面/影子，不参与 Y-sort
  'decal',    // 地面装饰（血迹、符文、光圈）
  'entity',   // 角色/敌人/NPC/物体
  'aerial',   // 飞行物/投掷武器/箭矢
  'effect'    // 技能特效/粒子
]);

export class LayerComponent extends Component {
  /**
   * @param {Object} [config]
   * @param {string} [config.worldLayer='entity']
   * @param {string} [config.floorId='ground']
   * @param {number} [config.renderOrder=0]
   */
  constructor(config = {}) {
    super('layer');
    const wl = config.worldLayer ?? 'entity';
    this.worldLayer = WORLD_LAYERS.includes(wl) ? wl : 'entity';
    this.floorId = config.floorId ?? 'ground';
    this.renderOrder = config.renderOrder ?? 0;

    /** 首个临时层进入前的基础 worldLayer。 */
    this._originalWorldLayer = this.worldLayer;
    this._layerLeases = [];
    this._layerLeaseSequence = 0;
  }

  /**
   * 获取临时世界层租约。多个系统嵌套切层时，各自只能释放自己的 token。
   * @param {string} layer
   * @param {string|null} [owner]
   * @returns {string|null}
   */
  acquireLayer(layer, owner = null) {
    if (!WORLD_LAYERS.includes(layer)) return null;
    if (this._layerLeases.length === 0) this._originalWorldLayer = this.worldLayer;
    const token = `layer:${++this._layerLeaseSequence}`;
    this._layerLeases.push({ token, layer, owner });
    this.worldLayer = layer;
    return token;
  }

  /**
   * 释放指定临时层租约。
   * @param {string} token
   * @returns {boolean}
   */
  releaseLayer(token) {
    const index = this._layerLeases.findIndex(lease => lease.token === token);
    if (index < 0) return false;
    this._layerLeases.splice(index, 1);
    const active = this._layerLeases[this._layerLeases.length - 1];
    this.worldLayer = active?.layer || this._originalWorldLayer || 'entity';
    return true;
  }

  /**
   * 切到新层并返回租约 token；保留旧调用兼容。
   * @param {string} layer
   * @param {string|null} [owner]
   * @returns {string|null}
   */
  pushLayer(layer, owner = null) {
    return this.acquireLayer(layer, owner);
  }

  /**
   * 恢复临时层。传 token 时只释放对应租约；不传时兼容旧的后进先出行为。
   * @param {string|null} [token]
   * @returns {boolean}
   */
  popLayer(token = null) {
    const target = token || this._layerLeases[this._layerLeases.length - 1]?.token;
    if (target) return this.releaseLayer(target);
    this.worldLayer = this._originalWorldLayer ?? 'entity';
    return false;
  }

  setFloor(id) {
    this.floorId = id;
  }
}

export default LayerComponent;
