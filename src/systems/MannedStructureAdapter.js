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

/************************************************************
 * 有人建筑到 VehicleSystem 的薄适配层。
 * 建筑仍拥有耐久/损毁事实，VehicleSystem 继续拥有席位、乘降、控制与弹员规则。
 ************************************************************/

import { VehicleComponent, SeatRole } from '../ecs/components/VehicleComponent.js';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

export class MannedStructureAdapter {
  constructor({ vehicleSystem, onEvent = null } = {}) {
    if (!vehicleSystem
      || typeof vehicleSystem.mount !== 'function'
      || typeof vehicleSystem.dismount !== 'function'
      || typeof vehicleSystem.routeIntent !== 'function'
      || typeof vehicleSystem.onVehicleDestroyed !== 'function') {
      throw new TypeError('MannedStructureAdapter requires VehicleSystem');
    }
    this.vehicleSystem = vehicleSystem;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.structures = new Set();
    this.ejectedStructures = new WeakSet();
  }

  /**
   * 把一个 ECS 建筑实体登记为有人建筑。未装配 vehicle 组件时创建静止席位容器。
   */
  registerStructure(structure, config = {}) {
    const building = structure?.getComponent?.('building');
    if (!building) return { ok: false, code: 'buildingComponentMissing' };

    let vehicle = structure.getComponent('vehicle');
    let componentCreated = false;
    if (!vehicle) {
      vehicle = new VehicleComponent({
        vehicleType: config.vehicleType || `mannedStructure:${building.buildingType || 'generic'}`,
        speed: 0,
        turnRate: 0,
        maxHp: building.maxHp,
        hp: building.hp,
        onDestroyed: 'eject',
        seats: Array.isArray(config.seats) && config.seats.length > 0
          ? config.seats
          : [{ id: 'operator', role: SeatRole.GUNNER, offset: [0, 0] }]
      });
      structure.addComponent(vehicle);
      componentCreated = true;
    }

    this.structures.add(structure);
    this.vehicleSystem.registerVehicle(structure);
    const synced = this.syncStructure(structure);
    if (!synced.ok) {
      this.structures.delete(structure);
      this.vehicleSystem.unregisterVehicle(structure);
      return synced;
    }
    this._emit('mannedStructureRegistered', {
      structureId: structure.id,
      componentCreated,
      seatIds: Object.keys(vehicle.seats)
    });
    return { ok: true, structureId: structure.id, componentCreated, seatIds: Object.keys(vehicle.seats) };
  }

  unregisterStructure(structure) {
    if (!this.structures.has(structure)) return { ok: false, code: 'structureNotRegistered' };
    const vehicle = structure.getComponent?.('vehicle');
    if (vehicle?.getRiders?.().length > 0) return { ok: false, code: 'structureOccupied' };
    this.structures.delete(structure);
    this.vehicleSystem.unregisterVehicle(structure);
    this.ejectedStructures.delete(structure);
    this._emit('mannedStructureUnregistered', { structureId: structure.id });
    return { ok: true, structureId: structure.id };
  }

  isMannedStructure(structure) {
    return this.structures.has(structure);
  }

  getSeats(structure) {
    if (!this.structures.has(structure)) return null;
    return clone(structure.getComponent?.('vehicle')?.seats || null);
  }


  mount(rider, structure, seatId = null) {
    if (!this.structures.has(structure)) return false;
    const building = structure.getComponent?.('building');
    if (!building || building.destroyed || !(Number(building.hp) > 0)) return false;
    return this.vehicleSystem.mount(rider, structure, seatId);
  }

  dismount(rider) {
    return this.vehicleSystem.dismount(rider);
  }

  routeIntent(rider, intent) {
    return this.vehicleSystem.routeIntent(rider, intent);
  }

  /**
   * 将 BuildingComponent 的生命状态投影到 VehicleComponent。
   * 首次进入摧毁状态时直接委托 VehicleSystem 执行弹员与伤害。
   */
  syncStructure(structure) {
    if (!this.structures.has(structure)) return { ok: false, code: 'structureNotRegistered' };
    const building = structure.getComponent?.('building');
    const vehicle = structure.getComponent?.('vehicle');
    if (!building || !vehicle) return { ok: false, code: 'componentMissing' };

    vehicle.maxHp = Math.max(1, Number(building.maxHp) || 1);
    vehicle.hp = Math.max(0, Math.min(vehicle.maxHp, Number(building.hp) || 0));
    const destroyed = building.destroyed === true || vehicle.hp <= 0;
    vehicle.destroyed = destroyed;

    if (destroyed && !this.ejectedStructures.has(structure)) {
      this.ejectedStructures.add(structure);
      this.vehicleSystem.onVehicleDestroyed(structure);
      this._emit('mannedStructureDestroyed', { structureId: structure.id });
      return { ok: true, destroyed: true, ejected: true };
    }
    if (!destroyed && this.ejectedStructures.has(structure)) {
      this.ejectedStructures.delete(structure);
      this.vehicleSystem.registerVehicle(structure);
      this._emit('mannedStructureRestored', { structureId: structure.id });
    }
    return { ok: true, destroyed, ejected: false };
  }

  syncAll() {
    const results = [];
    for (const structure of [...this.structures]) results.push(this.syncStructure(structure));
    return results;
  }

  /** VehicleComponent 已保存席位 riderId；此包装便于 SceneDynamicState 显式收集。 */
  captureState(structure) {
    if (!this.structures.has(structure)) return null;
    const vehicle = structure.getComponent?.('vehicle');
    if (!vehicle?.serialize) return null;
    return { schemaVersion: 1, structureId: structure.id, vehicle: clone(vehicle.serialize()) };
  }

  restoreState(structure, snapshot) {
    if (!snapshot || snapshot.schemaVersion !== 1 || !snapshot.vehicle) {
      return { ok: false, code: 'invalidMannedStructureSnapshot' };
    }
    if (!this.structures.has(structure)) {
      const registered = this.registerStructure(structure);
      if (!registered.ok) return registered;
    }
    const vehicle = structure.getComponent?.('vehicle');
    if (!vehicle?.deserialize) return { ok: false, code: 'vehicleComponentMissing' };
    const restored = vehicle.deserialize(clone(snapshot.vehicle));
    if (!restored?.ok) return restored || { ok: false, code: 'vehicleRestoreFailed' };
    this.vehicleSystem.registerVehicle(structure);
    return { ok: true, structureId: structure.id };
  }

  _emit(event, payload) {
    try {
      this.onEvent(event, clone(payload));
    } catch (error) {
      console.warn(`[MannedStructureAdapter] ${event} listener failed`, error);
    }
  }
}

export default MannedStructureAdapter;