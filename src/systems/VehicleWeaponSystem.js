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

/** 将乘员攻击意图路由为载具武器领域事务。 */
export class VehicleWeaponSystem {
  constructor({ vehicleSystem, vehicleLogisticsSystem, now = () => performance.now() } = {}) {
    if (!vehicleSystem || !vehicleLogisticsSystem) {
      throw new TypeError('VehicleWeaponSystem requires vehicleSystem and vehicleLogisticsSystem');
    }
    this.vehicleSystem = vehicleSystem;
    this.vehicleLogisticsSystem = vehicleLogisticsSystem;
    this.now = typeof now === 'function' ? now : () => performance.now();
    this.cooldowns = new Map();
  }

  async handleIntent({
    rider, intent, inventory, weapon = {}, costs = {}, operationId,
    checkpointId = null, context = null, inventoryOwnerId = null, execute = null
  } = {}) {
    const routed = this.vehicleSystem.routeIntent(rider, intent);
    if (!routed || routed.target !== 'vehicle' || routed.role !== 'gunner') {
      return { ok: false, code: 'vehicleWeaponIntentNotRouted' };
    }
    const vehicle = routed.vehicle;
    const component = vehicle?.getComponent?.('vehicle');
    const riderState = rider?.getComponent?.('rider');
    const seat = component?.getSeat?.(riderState?.seatId);
    if (!component || component.destroyed || seat?.riderId !== rider?.id || !seat?.weapon) {
      return { ok: false, code: 'vehicleGunnerSeatUnavailable' };
    }
    if (weapon.id && seat.weapon !== weapon.id) {
      return { ok: false, code: 'vehicleWeaponMismatch' };
    }

    const target = intent?.targetEntity;
    const sourceTransform = vehicle.getComponent?.('transform');
    const targetTransform = target?.getComponent?.('transform');
    const targetStats = target?.getComponent?.('stats');
    if (!target || !targetTransform || !targetStats || Number(targetStats.hp) <= 0) {
      return { ok: false, code: 'vehicleWeaponTargetUnavailable' };
    }
    const distance = Math.hypot(
      targetTransform.position.x - sourceTransform.position.x,
      targetTransform.position.y - sourceTransform.position.y
    );
    const range = Math.max(1, Number(weapon.range) || 1);
    if (distance > range) return { ok: false, code: 'vehicleWeaponTargetOutOfRange', distance, range };

    const cooldownMs = Math.max(0, Number(weapon.cooldownMs) || 0);
    const readyAt = this.cooldowns.get(vehicle.id) || 0;
    const timestamp = this.now();
    if (timestamp < readyAt) {
      return { ok: false, code: 'vehicleWeaponCooldown', remainingMs: readyAt - timestamp };
    }

    const result = await this.vehicleLogisticsSystem.fireCatapult({
      vehicle,
      inventory,
      costs,
      targetId: target.id,
      operationId,
      checkpointId,
      context,
      inventoryOwnerId,
      execute: typeof execute === 'function'
        ? executionContext => execute({
          ...executionContext,
          rider,
          intent,
          vehicle,
          target,
          weapon,
          distance
        })
        : null
    });
    if (result?.ok && !result.idempotent) this.cooldowns.set(vehicle.id, timestamp + cooldownMs);
    return { ...result, vehicleId: vehicle.id, targetId: target.id, distance };
  }

  dispose() {
    this.cooldowns.clear();
  }
}

export default VehicleWeaponSystem;