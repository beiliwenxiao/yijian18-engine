import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanonicalSnapshot } from '../../src/core/CanonicalSnapshot.js';
import { DefinitionRepository } from '../../src/core/DefinitionRepository.js';
import { Blackboard } from '../../src/core/Blackboard.js';
import { CommandGateway } from '../../src/core/command/CommandGateway.js';
import { LocalAuthorityAdapter } from '../../src/core/command/LocalAuthorityAdapter.js';
import { AuthorityClocks } from '../../src/core/command/AuthorityClocks.js';
import { ProjectionStore } from '../../src/core/command/ProjectionStore.js';
import { CanonicalStateTransactionService } from '../../src/systems/CanonicalStateTransactionService.js';
import { DomainCommandService } from '../../src/systems/DomainCommandService.js';
import { InventoryTransactionService } from '../../src/systems/InventoryTransactionService.js';
import { InventoryComponent } from '../../src/ecs/components/InventoryComponent.js';
import { RescueSystem } from '../../src/systems/RescueSystem.js';
import { VehicleLogisticsSystem } from '../../src/systems/VehicleLogisticsSystem.js';
import { EndingSystem } from '../../src/systems/EndingSystem.js';
import { Entity } from '../../src/ecs/Entity.js';
import { VehicleComponent } from '../../src/ecs/components/VehicleComponent.js';
import { CargoComponent } from '../../src/ecs/components/CargoComponent.js';
import { S11S12Coordinator } from '../../example/sanguo_zhangjiao/systems/S11S12Coordinator.js';
import { InMemoryDiskAdapter } from './ModelTesting.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const clone = value => structuredClone(value);
const readJson = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const normalizePath = value => path.posix.normalize(String(value).replace(/\\/g, '/')).replace(/^\.\//, '');

/** 仅用作测试磁盘：先从当前 Demo 磁盘收集 canonical JSON，运行中只经此 adapter 读取。 */
export function createDemoCanonicalDisk() {
  const files = new Map();
  const collect = relative => {
    const file = normalizePath(relative);
    if (files.has(file)) return;
    const value = readJson(`example/sanguo_zhangjiao/${file}`);
    files.set(file, value);
    const visit = (node, base) => {
      if (Array.isArray(node)) return node.forEach(item => visit(item, base));
      if (!node || typeof node !== 'object') return;
      if (typeof node.$ref === 'string') {
        collect(path.posix.join(base, node.$ref));
        return;
      }
      Object.values(node).forEach(value => visit(value, base));
    };
    visit(value, path.posix.dirname(file));
  };
  collect('game.project.json');
  // shards 分片：主文件声明的分片文件一并收集进测试磁盘（collect 以 example/sanguo_zhangjiao 为根）
  for (const shardPath of Object.values(readJson('example/sanguo_zhangjiao/game.project.json').shards || {})) {
    collect(shardPath);
  }
  collect('assets/scenes/S11.json');
  collect('assets/scenes/S12.json');
  collect('assets/scenes/S14.json');
  return new InMemoryDiskAdapter(Object.fromEntries(files));
}

function resolveDiskJson(disk, relative) {
  const load = file => {
    const normalized = normalizePath(file);
    const value = clone(disk.read(normalized));
    const resolve = (node, base) => {
      if (Array.isArray(node)) return node.map(item => resolve(item, base));
      if (!node || typeof node !== 'object') return node;
      if (typeof node.$ref === 'string') return load(path.posix.join(base, node.$ref));
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, resolve(value, base)]));
    };
    return resolve(value, path.posix.dirname(normalized));
  };
  return load(relative);
}

function buildRepository(disk) {
  const project = resolveDiskJson(disk, 'game.project.json');
  // shards 分片：主文件声明的分片字段并回完整 project（$ref 解析由 resolveDiskJson 处理）
  for (const [shardField, shardPath] of Object.entries(project.shards || {})) {
    project[shardField] = resolveDiskJson(disk, shardPath);
  }
  const s11 = resolveDiskJson(disk, 'assets/scenes/S11.json');
  const s12 = resolveDiskJson(disk, 'assets/scenes/S12.json');
  const s14 = resolveDiskJson(disk, 'assets/scenes/S14.json');
  const endings = resolveDiskJson(disk, 'config/endings.json');
  project.definitionCollections = {
    ...(project.definitionCollections || {}),
    vehicles: [...(s11.gameplay?.vehicles || []), ...(s12.gameplay?.vehicles || []), ...s14.gameplay.vehicles],
    endings: [endings, ...endings.endings]
  };
  const snapshot = CanonicalSnapshot.fromProject(project, { revision: 'disk-canonical-r1' });
  return { project, snapshot, repository: DefinitionRepository.fromSnapshot(snapshot) };
}

function clockSnapshot(clocks = {}) {
  const value = typeof clocks.snapshot === 'function' ? clocks.snapshot() : clocks;
  return { logicalTime: Number(value.logical) || 0, monotonicTime: Number(value.monotonic) || 0, wallTime: Number(value.wall) || 0 };
}

function item(repository, id) {
  const definition = repository.get('items', id);
  if (!definition) throw new Error(`Canonical item definition missing: ${id}`);
  return definition;
}

function createVehicleRuntime(definition, repository) {
  const entity = new Entity(definition.id, 'vehicle');
  entity.addComponent(new VehicleComponent(definition));
  if (definition.cargo) entity.addComponent(new CargoComponent({
    ...definition.cargo,
    definitionResolver: id => item(repository, id)
  }));
  return entity;
}

export function createEndingInput(kind) {
  const states = {
    'scorched-earth': { cityState: { coreDamageRatio: 0.8 }, hiddenInputs: { scorchedEarthChosen: true, cityDamageNeglected: true, resourceConstructionScore: 3 } },
    observer: { battleModeStats: { optionalBattles: 1, observed: 1, intervened: 0 }, hiddenInputs: { allOptionalBattlesObserved: true } },
    spark: {},
    ember: { heroStates: { primary: [{ id: 'zhangLiang', alive: true }, { id: 'zhangBao', alive: false }], support: [{ id: 'bocai', alive: false }, { id: 'zhangMancheng', alive: false }] } },
    meteor: { heroStates: { primary: [{ id: 'zhangLiang', alive: false }, { id: 'zhangBao', alive: false }], support: [{ id: 'bocai', alive: true }, { id: 'zhangMancheng', alive: false }] } },
    dust: { heroStates: { primary: [{ id: 'zhangLiang', alive: false }, { id: 'zhangBao', alive: false }], support: [{ id: 'bocai', alive: false }, { id: 'zhangMancheng', alive: false }] } }
  };
  const base = {
    storyState: {}, cityState: { coreDamageRatio: 0.1 }, warState: {},
    heroStates: { primary: [{ id: 'zhangLiang', alive: true }, { id: 'zhangBao', alive: true }], support: [{ id: 'bocai', alive: false }, { id: 'zhangMancheng', alive: false }] },
    battleModeStats: { optionalBattles: 1, observed: 0, intervened: 1 }, retreatReadiness: true,
    hiddenInputs: { totalGathered: 0, cityMaintenanceLevel: 0, resourceConstructionScore: 0, allOptionalBattlesObserved: false, cityDamageNeglected: false, scorchedEarthChosen: false }
  };
  const patch = states[kind] || {};
  return {
    ...base, ...patch,
    storyState: { ...base.storyState, ...patch.storyState }, cityState: { ...base.cityState, ...patch.cityState },
    warState: { ...base.warState, ...patch.warState }, battleModeStats: { ...base.battleModeStats, ...patch.battleModeStats },
    hiddenInputs: { ...base.hiddenInputs, ...patch.hiddenInputs }
  };
}

function defaultStory(project) {
  return clone(project.variables?.storyState || { currentSceneId: 'S01', unlockedScenes: ['S01'] });
}

function restoreRuntimeState(runtime, state = {}) {
  const board = state.blackboard || {};
  runtime.blackboard.deserialize({
    ...runtime.blackboard.serialize(),
    ...clone(board),
    storyState: clone(board.storyState || defaultStory(runtime.project)),
    cityStates: clone(board.cityStates || runtime.blackboard.get('cityStates') || [])
  });
  runtime.inventory.loadItems(clone(state.inventory || []));
  if (state.rescue) runtime.rescueSystem.deserialize(clone(state.rescue));
  if (state.coordinator) runtime.rescueCoordinator.deserialize(clone(state.coordinator));
}

/**
 * 真实最小组合根：定义来自磁盘快照，命令必须经过 Gateway → Authority → 真实事务服务。
 * 本文件只提供 IO/生命周期与通用端口适配；没有内容规则或 mock handler。
 */
export async function createRealCanonicalRuntime({ disk, seed = 0, clocks, snapshot = null } = {}) {
  const { project, snapshot: canonicalSnapshot, repository } = buildRepository(disk);
  const authorityClocks = new AuthorityClocks(clockSnapshot(clocks));
  const blackboard = new Blackboard();
  blackboard.init(project.variables || {});
  const inventory = new InventoryComponent({
    maxSlots: 24,
    definitionResolver: id => item(repository, id)
  });
  const inventoryTransactions = new InventoryTransactionService();
  const checkpoints = [];
  const travelAttempts = [];
  const checkpoint = async request => {
    checkpoints.push(clone(request));
    return snapshot?.checkpointFailure ? { ok: false, code: 'injectedCheckpointFailure' } : { ok: true };
  };
  const travel = async request => {
    travelAttempts.push(clone(request));
    return snapshot?.travelFailure ? { ok: false, code: 'targetUnavailable' } : { ok: true, destination: request.sceneId };
  };
  const stateTransactions = new CanonicalStateTransactionService({
    definitionRepository: repository, getBlackboard: () => blackboard, getInventory: () => inventory,
    inventoryTransactions, getItem: id => item(repository, id), checkpoint, travel,
    tutorialComplete: id => (snapshot?.completedTutorials || []).includes(id)
  });
  const rescueSystem = new RescueSystem({ now: () => authorityClocks.monotonic.now() });
  const rescueDefinitions = Object.fromEntries(repository.all('rescues').map(definition => [definition.id, definition]));
  const rescueCoordinator = new S11S12Coordinator({
    rescueSystem, inventoryTransactions, getInventory: () => inventory,
    getBattleSession: () => ({ battleId: snapshot?.battleId || null }), canUseRescue: () => true,
    readStoryState: () => clone(blackboard.get('storyState') || {}),
    writeStoryState: next => { blackboard.set('storyState', clone(next)); return true; },
    createCheckpoint: checkpoint, rescueDefinitions
  });
  const vehicles = new Map(repository.all('vehicles').map(definition => [definition.id, createVehicleRuntime(definition, repository)]));
  const vehicleLogistics = new VehicleLogisticsSystem({ inventoryTransactions, createCheckpoint: checkpoint });
  const endingSystem = new EndingSystem({
    readState: () => ({ storyState: clone(blackboard.get('storyState') || {}), endingInput: clone(snapshot?.endingInput) }),
    commitState: next => { blackboard.set('storyState', clone(next.storyState)); return true; },
    restoreState: previous => { blackboard.set('storyState', clone(previous.storyState)); return true; },
    checkpoint
  });
  const projectionStore = new ProjectionStore({ definitionRevision: repository.definitionRevision });
  projectionStore.registerReducer('canonicalState', (_state, event) => event.payload);
  projectionStore.registerReducer('domainCommand', (_state, event) => event.payload);

  const domainPort = {
    async execute({ commandType, operationId, payload }) {
      if (commandType === 'rescue.command') return rescueCoordinator.executeCommand({ ...payload, operationId });
      if (commandType === 'vehicle.command') {
        const vehicle = vehicles.get(payload.vehicleId);
        if (!vehicle) return { ok: false, code: 'unknownVehicleDefinition' };
        if (payload.operation === 'cargo.transfer') {
          return vehicleLogistics.transfer({
            source: inventory, target: vehicle.getComponent('cargo'), itemId: payload.itemId,
            quantity: payload.quantity, operationId, checkpointId: payload.checkpointId || null,
            context: { vehicleId: payload.vehicleId }
          });
        }
        if (payload.operation === 'catapult.assemble') {
          return vehicleLogistics.assembleCatapult({
            vehicle, inventory, requirements: payload.requirements || repository.get('vehicles', payload.vehicleId)?.assemblyRequirements,
            operationId, checkpointId: payload.checkpointId || null, context: { vehicleId: payload.vehicleId }
          });
        }
        return { ok: false, code: 'unsupportedVehicleOperation' };
      }
      if (commandType === 'ending.command') {
        if (!repository.has('endings', payload.endingId)) return { ok: false, code: 'unknownEndingDefinition' };
        return endingSystem.resolveEnding({ operationId, checkpointId: payload.checkpointId });
      }
      return { ok: false, code: 'unsupportedDomainCommand' };
    }
  };
  const domainCommands = new DomainCommandService({
    ports: { 'rescue.command': domainPort, 'vehicle.command': domainPort, 'ending.command': domainPort },
    statePrefix: 'canonical-domain'
  });
  const authority = new LocalAuthorityAdapter({
    authorityClocks, authoritySeed: seed, projectionStore,
    handlers: { 'state.transaction': stateTransactions, 'rescue.command': domainCommands, 'vehicle.command': domainCommands, 'ending.command': domainCommands }
  });
  const notifications = [];
  const unsubscribe = authority.notificationBus.subscribe(event => notifications.push(clone({ kind: event.kind, value: event.value })));
  const gateway = new CommandGateway({ authorityPort: authority, definitionRepository: repository });
  const runtime = {
    project, canonicalSnapshot, repository, blackboard, inventory, inventoryTransactions, checkpoints, travelAttempts,
    stateTransactions, rescueSystem, rescueCoordinator, vehicles, vehicleLogistics, endingSystem,
    projectionStore, authority, gateway, notifications, unsubscribe, disposed: false
  };
  restoreRuntimeState(runtime, snapshot?.runtimeState || {});
  return runtime;
}

export async function executeRealCanonicalCommand(runtime, command) {
  return runtime.gateway.execute(clone(command.intent), clone(command.options || {}));
}

export function inspectRealCanonicalState(runtime) {
  return clone({
    blackboard: runtime.blackboard.serialize(), inventory: runtime.inventory.exportRuntimeStates(),
    rescue: runtime.rescueSystem.serialize(), rescueCoordinator: runtime.rescueCoordinator.serialize(),
    vehicleLogistics: runtime.vehicleLogistics.serialize(),
    vehicles: [...runtime.vehicles.values()].map(vehicle => ({ id: vehicle.id, vehicle: vehicle.getComponent('vehicle').serialize(), cargo: vehicle.getComponent('cargo')?.serialize() || null })),
    checkpoints: runtime.checkpoints, travelAttempts: runtime.travelAttempts, endingLedger: runtime.endingSystem.serialize()
  });
}

export function inspectRealCanonicalStableIds(runtime) {
  const kinds = [...runtime.repository.kinds()].sort();
  return {
    definition: Object.fromEntries(kinds.map(kind => [kind, [...runtime.repository.ids(kind)].sort()])),
    runtime: { playerInventory: 'player:inventory', vehicles: [...runtime.vehicles.keys()].sort() }
  };
}

export function inspectRealCanonicalEvents(runtime, kind) {
  return runtime.notifications.filter(event => event.kind === kind).map(event => clone(event.value));
}

export function inspectRealCanonicalEnding(runtime) {
  const story = runtime.blackboard.get('storyState') || {};
  return clone({ endingId: story.endingId || null, endingSnapshotId: story.endingSnapshotId || null });
}

export async function destroyRealCanonicalRuntime(runtime) {
  if (!runtime || runtime.disposed) return false;
  runtime.disposed = true;
  runtime.unsubscribe?.();
  runtime.gateway.dispose();
  runtime.authority.dispose();
  runtime.vehicles.clear();
  runtime.projectionStore.clear();
  return true;
}
