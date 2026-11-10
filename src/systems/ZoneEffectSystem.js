/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-07-22
 ************************************************************/

/**
 * ZoneEffectSystem - Buff 多边形区域效果系统
 *
 * 管理 buffZone 类型对象的进入/停留/离开检测及 5 种效果：
 *   1. instant + remove：进入立即生效，离开立即撤回
 *   2. instant + countdown：进入立即生效，离开后倒计时撤回
 *   3. periodic + remove：每隔 interval 秒生效，离开立即停止
 *   4. periodic + countdown：每隔 interval 秒生效，离开后倒计时内继续，到时停止
 *   5. delayed：进入后倒计时，到时触发一次效果
 *
 * 另支持 `effect.kind === 'terrainCombat'`（5C 地势战斗加成）：不做逐帧状态，
 * 由 `resolveTerrainCombat(x, y, context)` 按点击/交战位置临时求值，供
 * TerrainCombatResolver 与 CombatModifierPipeline 使用。
 *
 * authority: 'server' (将来服务器权威裁决)
 */
import { resolveTerrainCombatModifiers, isTerrainCombatEffect } from './TerrainCombatResolver.js';

export class ZoneEffectSystem {
  constructor() {
    // 活跃效果: Map<entityId, Map<zoneId, EffectState>>
    this._active = new Map();
    // 离开后倒计时中的效果: Map<entityId, Map<zoneId, LeaveState>>
    this._leaving = new Map();
  }

  /**
   * 设置 buff 区域列表（场景加载时调用）
   * @param {Array<Object>} zones - buffZone 对象数组（含 points, effect 等）
   */
  setZones(zones) {
    this._zones = zones || [];
  }

  /**
   * 地势战斗修正（5C）：求某点所在 terrainCombat 区域的合并修正。
   * 纯查询、不产生逐帧状态，可在交战/命中时按需调用。
   *
   * @param {number} x
   * @param {number} y
   * @param {{unitTypeId?:string, side?:string, ranged?:boolean}} [context]
   * @returns {{attack:number, defense:number, range:number, speed:number, sources:string[]}}
   */
  resolveTerrainCombat(x, y, context = {}) {
    const hits = [];
    for (const zone of this._zones || []) {
      if (!zone || !isTerrainCombatEffect(zone.effect)) continue;
      if (!this._pointInPolygon(x, y, zone.points)) continue;
      hits.push(zone);
    }
    return resolveTerrainCombatModifiers(hits, context);
  }

  /**
   * 设置事件回调
   * @param {Object} callbacks
   * @param {Function} [callbacks.onEnterZone] - (entity, zone) 进入区域时
   * @param {Function} [callbacks.onLeaveZone] - (entity, zone) 离开区域时
   * @param {Function} [callbacks.onEffectApply] - (entity, zone, stat, value) 属性变化时
   */
  setCallbacks(callbacks = {}) {
    this._onEnterZoneCb = callbacks.onEnterZone || null;
    this._onLeaveZoneCb = callbacks.onLeaveZone || null;
    this._onEffectApplyCb = callbacks.onEffectApply || null;
  }

  /**
   * 每帧更新
   * @param {number} dt - 秒
   * @param {Array<Object>} entities - 含 transform + stats 的实体列表
   */
  update(dt, entities) {
    if (!this._zones || this._zones.length === 0) return;

    for (const entity of entities) {
      const transform = entity.getComponent ? entity.getComponent('transform') : null;
      const stats = entity.getComponent ? entity.getComponent('stats') : null;
      if (!transform || !stats) continue;
      const pos = transform.position;
      const eid = entity.id;

      if (!this._active.has(eid)) this._active.set(eid, new Map());
      if (!this._leaving.has(eid)) this._leaving.set(eid, new Map());
      const activeMap = this._active.get(eid);
      const leavingMap = this._leaving.get(eid);

      for (const zone of this._zones) {
        if (!zone.effect) continue;
        // 地势战斗区不参与逐帧状态机（由 resolveTerrainCombat 按位置求值）
        if (isTerrainCombatEffect(zone.effect)) continue;
        const zid = zone.id;
        const eff = zone.effect;

        // 目标过滤
        if (!this._matchTarget(entity, eff.target)) continue;

        const inside = this._pointInPolygon(pos.x, pos.y, zone.points);

        if (inside) {
          // 如果之前在 leaving 中，取消离开倒计时
          if (leavingMap.has(zid)) {
            const ls = leavingMap.get(zid);
            // 恢复为 active
            activeMap.set(zid, ls.state);
            leavingMap.delete(zid);
          }

          if (!activeMap.has(zid)) {
            // 刚进入
            const state = { timer: 0, applied: false, delayTimer: 0, totalApplied: 0 };
            activeMap.set(zid, state);
            if (this._onEnterZoneCb) this._onEnterZoneCb(entity, zone);
            this._onEnter(stats, eff, state, entity, zone);
          } else {
            // 停留中
            const state = activeMap.get(zid);
            this._onStay(dt, stats, eff, state, entity, zone);
          }
        } else {
          // 不在区域内
          if (activeMap.has(zid)) {
            // 刚离开
            const state = activeMap.get(zid);
            activeMap.delete(zid);
            if (this._onLeaveZoneCb) this._onLeaveZoneCb(entity, zone);
            this._onLeave(dt, stats, eff, state, eid, zid, leavingMap);
          }
        }
      }

      // 更新离开倒计时
      for (const [zid, ls] of leavingMap) {
        ls.remaining -= dt;
        // 离开期间 periodic 继续生效
        if (ls.eff.effectType === 'periodic' && ls.eff.onLeave === 'countdown') {
          ls.state.timer += dt;
          if (ls.state.timer >= (ls.eff.interval || 1)) {
            ls.state.timer -= (ls.eff.interval || 1);
            this._applyStat(stats, ls.eff, entity, null);
          }
        }
        if (ls.remaining <= 0) {
          // 倒计时结束，撤回效果
          this._removeEffect(stats, ls.eff, ls.state);
          leavingMap.delete(zid);
        }
      }
    }
  }

  /** 进入区域时 */
  _onEnter(stats, eff, state, entity, zone) {
    if (eff.effectType === 'instant') {
      this._applyStat(stats, eff, entity, zone);
      state.applied = true;
      state.totalApplied = eff.value || 0;
    } else if (eff.effectType === 'periodic') {
      // 立即触发第一次
      this._applyStat(stats, eff, entity, zone);
      state.timer = 0;
      state.totalApplied = eff.value || 0;
    } else if (eff.effectType === 'delayed') {
      state.delayTimer = 0;
      state.applied = false;
    }
  }

  /** 停留时每帧 */
  _onStay(dt, stats, eff, state, entity, zone) {
    if (eff.effectType === 'periodic') {
      state.timer += dt;
      const interval = eff.interval || 1;
      if (state.timer >= interval) {
        state.timer -= interval;
        this._applyStat(stats, eff, entity, zone);
        state.totalApplied += (eff.value || 0);
      }
    } else if (eff.effectType === 'delayed') {
      if (!state.applied) {
        state.delayTimer += dt;
        if (state.delayTimer >= (eff.delay || 10)) {
          this._applyStat(stats, eff, entity, zone);
          state.applied = true;
        }
      }
    }
  }

  /** 离开区域时 */
  _onLeave(dt, stats, eff, state, eid, zid, leavingMap) {
    const onLeave = eff.onLeave || 'remove';

    if (onLeave === 'remove') {
      this._removeEffect(stats, eff, state);
    } else if (onLeave === 'countdown') {
      // 开始离开倒计时
      leavingMap.set(zid, {
        remaining: eff.leaveDuration || 5,
        eff,
        state
      });
    }
    // onLeave === 'continue': 不做任何事，效果永久保留
  }

  /** 撤回效果（instant 类型撤回之前加的值） */
  _removeEffect(stats, eff, state) {
    if (eff.effectType === 'instant' && state.applied) {
      // 撤回：反向操作
      const stat = eff.stat || 'hp';
      const val = -(eff.value || 0);
      this._modStat(stats, stat, val);
    }
    // periodic 累积的不撤回（已经是实际伤害/治疗）
    // delayed 一次性的也不撤回
  }

  /** 应用一次属性变化 */
  _applyStat(stats, eff, entity, zone) {
    const stat = eff.stat || 'hp';
    const val = eff.value || 0;
    this._modStat(stats, stat, val);
    if (this._onEffectApplyCb && entity) {
      this._onEffectApplyCb(entity, zone, stat, val);
    }
  }

  /** 修改属性值（带上下限） */
  _modStat(stats, stat, val) {
    if (stat === 'hp') {
      stats.hp = Math.max(0, Math.min(stats.maxHp || 9999, (stats.hp || 0) + val));
    } else if (stat === 'mp') {
      stats.mp = Math.max(0, Math.min(stats.maxMp || 9999, (stats.mp || 0) + val));
    } else if (stat === 'attack') {
      stats.attack = Math.max(0, (stats.attack || 0) + val);
    } else if (stat === 'defense') {
      stats.defense = Math.max(0, (stats.defense || 0) + val);
    } else if (stat === 'speed') {
      stats.speed = Math.max(0, (stats.speed || 0) + val);
    }
  }

  /** 目标匹配 */
  _matchTarget(entity, target) {
    if (!target || target === 'all') return true;
    if (target === 'player') return entity.type === 'player' || entity.isPlayer === true;
    if (target === 'enemy') return entity.type === 'enemy' || entity.isEnemy === true || entity.faction === 'enemy';
    return true;
  }

  /**
   * 点在多边形内检测（射线法）
   * @param {number} px
   * @param {number} py
   * @param {Array<Array<number>>} points - [[x,y], ...]
   * @returns {boolean}
   */
  _pointInPolygon(px, py, points) {
    if (!points || points.length < 3) return false;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i][0], yi = points[i][1];
      const xj = points[j][0], yj = points[j][1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** 清理所有效果状态（场景离开时调用） */
  dispose() {
    this._active.clear();
    this._leaving.clear();
    this._zones = [];
  }

  /** 序列化（存档用） */
  serialize() {
    return { active: [...this._active], leaving: [...this._leaving] };
  }
}

export default ZoneEffectSystem;
