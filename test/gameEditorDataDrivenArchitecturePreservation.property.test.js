// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSanguoZhangjiaoProject } from '../example/sanguo_zhangjiao/config/SanguoZhangjiaoContentPolicy.js';
import { SceneObjectProjector } from '../src/core/scene/SceneObjectProjector.js';
import { InventoryComponent } from '../src/ecs/components/InventoryComponent.js';
import { InventoryTransactionService } from '../src/systems/InventoryTransactionService.js';
import { EquipmentSystem } from '../src/systems/EquipmentSystem.js';
import { SceneEquipmentFlow } from '../src/core/scene/SceneEquipmentFlow.js';
let ObservedDataDrivenEquipmentScene = null;

function loadObservedDataDrivenEquipmentScene() {
  if (ObservedDataDrivenEquipmentScene) return ObservedDataDrivenEquipmentScene;
  const source = read('example/sanguo_zhangjiao/scenes/DataDrivenPrologueScene.js');
  const signature = '  onEquipmentChanged(messages, info = null) {';
  const start = source.indexOf(signature);
  if (start < 0) throw new Error('DataDrivenPrologueScene.onEquipmentChanged not found');
  let depth = 0;
  let end = -1;
  for (let index = source.indexOf('{', start); index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) { end = index + 1; break; }
  }
  if (end < 0) throw new Error('DataDrivenPrologueScene.onEquipmentChanged is incomplete');
  const methodSource = source.slice(start, end);
  const ObservedBase = class {
    onEquipmentChanged(messages, info) {
      this.baseEquipmentCalls = [...(this.baseEquipmentCalls || []), { messages: clone(messages), info: clone(info) }];
    }
  };
  ObservedDataDrivenEquipmentScene = new Function(
    'ObservedBase',
    `return class ObservedDataDrivenEquipmentScene extends ObservedBase {\n${methodSource}\n}`
  )(ObservedBase);
  return ObservedDataDrivenEquipmentScene;
}

class DataDrivenPrologueScene {
  onEquipmentChanged(...args) {
    const Observed = loadObservedDataDrivenEquipmentScene();
    return Reflect.apply(Observed.prototype.onEquipmentChanged, this, args);
  }
}
import { SnapshotManager } from '../src/core/snapshot/SnapshotManager.js';
import { InputActionRouter, HANDLER_PRIORITY } from '../src/core/input/InputActionRouter.js';
import { InputEvent, InputEventType, InputDevice, PointerButton, InputHandler } from '../src/core/input/InputEvent.js';
import { DefinitionRepository } from '../src/core/DefinitionRepository.js';
import { CommandGateway } from '../src/core/command/CommandGateway.js';
import { LocalAuthorityAdapter } from '../src/core/command/LocalAuthorityAdapter.js';
import { ProjectionStore } from '../src/core/command/ProjectionStore.js';
import { QuestSystem, QuestType, ObjectiveType } from '../src/systems/QuestSystem.js';
import { QUEST_COMMANDS } from '../src/systems/QuestTransactionService.js';
import { QuestPanel } from '../src/ui/QuestPanel.js';
import { EndingSystem } from '../src/systems/EndingSystem.js';
import { S04RouteCoordinator } from '../example/sanguo_zhangjiao/systems/S04RouteCoordinator.js';
import { WorldStreamingManager } from '../src/core/WorldStreamingManager.js';
import { BattleClient } from '../src/integration/BattleClient.js';
import { LocalMockTransport } from '../src/integration/LocalMockTransport.js';
import { createJsonRpcRequest } from '../src/integration/JsonRpcProtocol.js';
import { loadProjectWithShards } from './support/projectFixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const readJson = relative => JSON.parse(read(relative));
const clone = value => structuredClone(value);
const demoProject = await loadProjectWithShards();

function observeDemoAndWorld() {
  const project = clone(demoProject);
  const endings = readJson('example/sanguo_zhangjiao/config/endings.json');
  const positions = {};
  for (const region of project.worldMap.regions) {
    for (let row = 0; row < region.grid.length; row++) {
      for (let col = 0; col < region.grid[row].length; col++) {
        const cell = region.grid[row][col];
        const sceneId = typeof cell === 'string' ? cell : cell?.sceneId;
        if (/^S(?:0[1-9]|1[0-4])$/.test(sceneId || '')) positions[sceneId] = [region.id, row, col];
      }
    }
  }
  const sceneOrder = readJson('example/sanguo_zhangjiao/assets/scenes/_scene_order.json');
  const scenarioSurface = sceneOrder.order.map(sceneId => {
    const scene = readJson(`example/sanguo_zhangjiao/assets/scenes/${sceneId}.json`);
    const triggerCommands = (scene.layers || []).flatMap(layer => layer.objects || [])
      .filter(object => object.type === 'trigger')
      .map(({ triggerId, command, event }) => ({ triggerId, command: command || null, event: event || null }));
    return {
      sceneId: scene.id,
      size: [scene.width, scene.height],
      gameplayKeys: Object.keys(scene.gameplay || {}).sort(),
      triggerCommands
    };
  });
  const legacy = clone(project);
  legacy.meta.campaignId = 'legacy-six-act';
  legacy.variables.storyState.currentSceneId = 'scene_Prologue';
  legacy.variables.classId = 'mage';
  const rejection = validateSanguoZhangjiaoProject(legacy);
  const local = { id: 'object-1', x: 12, y: 34, sortY: 40, points: [[1, 2]], path: [{ x: 3, y: 4 }] };
  const projected = new SceneObjectProjector().project(local, { x: 16640, y: 11520 });
  return {
    identity: {
      schemaVersion: project.schemaVersion,
      meta: project.meta,
      campaignId: project.meta.campaignId,
      sceneOrder
    },
    rejection: rejection.errors.map(({ code, path, actual }) => ({ code, path, actual })),
    world: { rows: project.worldMap.regions.map(region => region.rows), cols: project.worldMap.regions.map(region => region.cols), positions },
    projection: { local, projected },
    scenarioSurface,
    endingPriority: endings.priority
  };
}

function observeInventoryAndEquipment() {
  const item = { id: 'wood', type: 'material', maxStack: 5 };
  const inventory = new InventoryComponent({ maxSlots: 2 });
  const service = new InventoryTransactionService();
  const first = service.commit({ type: 'add', inventory, item, quantity: 7, operationId: 'inventory:add:wood' });
  const replay = service.commit({ type: 'add', inventory, item, quantity: 7, operationId: 'inventory:add:wood' });
  const conflict = service.commit({ type: 'add', inventory, item, quantity: 1, operationId: 'inventory:add:wood' });

  const slots = { mainhand: null };
  const equipment = {
    slots,
    equip(slot, value) { const old = slots[slot] || null; slots[slot] = value; return old; },
    unequip(slot) { const old = slots[slot] || null; slots[slot] = null; return old; },
    getEquipment(slot) { return slots[slot] || null; },
    getBonusStats() { return {}; },
    isValidEquipmentForSlot() { return true; }
  };
  const stats = { attack: 1, defense: 1, maxHp: 10, maxMp: 5, hp: 10, mp: 5, speed: 1, resetToBaseStats() {} };
  const entity = { getComponent: name => ({ equipment, stats }[name] || null) };
  const equipmentSystem = new EquipmentSystem();
  const sword = { id: 'sword', name: 'Sword', type: 'equipment', subType: 'weapon', maxStack: 1, stats: {} };
  const equipResult = equipmentSystem.equipItem(entity, 'mainhand', sword);
  const unequipResult = equipmentSystem.unequipItem(entity, 'mainhand');

  const fullInventory = new InventoryComponent({ maxSlots: 1, items: [{ item: { id: 'stone', maxStack: 1 }, quantity: 1 }] });
  slots.mainhand = sword;
  const flowEntity = { getComponent: name => ({ equipment, stats, inventory: fullInventory }[name] || null) };
  const undo = new SceneEquipmentFlow({ equipmentSystem }).unequip(flowEntity, 'mainhand');

  const events = [];
  const scene = Object.create(DataDrivenPrologueScene.prototype);
  scene.playerEntity = { getComponent: name => name === 'equipment' ? { slots: { mainhand: sword } } : null };
  scene.floatingTextManager = { addText() {} };
  scene.gameLoader = { triggerSystem: { fire: (type, payload) => events.push({ type, payload }) } };
  scene.onEquipmentChanged(['equipped'], { slot: 'mainhand', item: sword, action: 'equip' });
  scene.onEquipmentChanged(['unequipped'], { slot: 'mainhand', oldItem: sword, action: 'unequip' });

  return { first, replay, conflict, count: inventory.getItemCount('wood'), equipResult, unequipResult, undo, slotAfterUndo: slots.mainhand?.id, events };
}

function observeSnapshotAndInput() {
  const trace = [];
  const manager = new SnapshotManager({ now: () => 1000 });
  const providers = { a: { value: 1 }, b: { value: 2 } };
  let rejectB = false;
  for (const key of ['a', 'b']) manager.register(key, {
    snapshot: () => clone(providers[key]),
    validate: data => ({ ok: typeof data.value === 'number', errors: [] }),
    restore: data => {
      trace.push(`restore:${key}:${data.value}`);
      providers[key] = clone(data);
      if (key === 'b' && rejectB) { rejectB = false; return { ok: false, errors: [{ code: 'rejected', path: '', message: 'rejected' }] }; }
    }
  });
  const saved = manager.capture({ sceneId: 'S01' }).snapshot;
  providers.a.value = 10;
  providers.b.value = 20;
  rejectB = true;
  const restored = manager.restore(saved);

  const route = modifiers => {
    const router = new InputActionRouter();
    for (const name of HANDLER_PRIORITY) router.register(name, { id: name, handle: () => true });
    router.enqueue(new InputEvent({ type: InputEventType.POINTER_DOWN, device: InputDevice.MOUSE,
      button: modifiers.button ?? PointerButton.LEFT, modifiers }));
    return router.dispatch()[0].consumedBy;
  };
  const unified = [];
  const router = new InputActionRouter();
  router.register(InputHandler.PICKUP, { handle: event => { unified.push(`${event.device}:${event.key}`); return true; } });
  router.enqueueInteract(InputDevice.VIRTUAL);
  router.enqueueInteract(InputDevice.TOUCH);
  router.enqueue(new InputEvent({ type: InputEventType.KEY_PRESS, device: InputDevice.KEYBOARD, key: 'e' }));
  router.dispatch();
  return {
    snapshot: { capture: saved, restored, state: providers, trace },
    input: { priority: HANDLER_PRIORITY, ctrl: route({ ctrl: true }), shift: route({ shift: true }), plain: route({}), right: route({ button: PointerButton.RIGHT }), unified }
  };
}
async function observeQuestPanel() {
  const actorId = 'golden-observer';
  const projectionId = `quest:${actorId}`;
  const definition = {
    id: 'golden-quest', name: 'Golden Quest', type: QuestType.MAIN,
    description: 'Observed quest', shortDescription: 'Observe', minLevel: 1,
    objectives: [{ id: 'collect-one', type: ObjectiveType.COLLECT, targetId: 'herb', requiredCount: 1, description: 'Collect herb' }],
    reward: { exp: 10, gold: 2 }
  };
  const repository = DefinitionRepository.fromSnapshot({
    definitionRevision: 1,
    project: {},
    definitions: { quests: [definition] }
  });
  const projectionStore = new ProjectionStore({ definitionRevision: repository.definitionRevision });
  projectionStore.registerReducer('questRuntime', (current, event) => {
    const quest = event.payload?.quest;
    if (!quest) return current || { quests: [] };
    return {
      quests: [
        ...(current?.quests || []).filter(item => item.id !== quest.id && item.definitionId !== quest.definitionId),
        quest
      ]
    };
  });
  const authority = new LocalAuthorityAdapter({ projectionStore });
  const questSystem = new QuestSystem({ definitionRepository: repository, actorId });
  for (const commandType of Object.values(QUEST_COMMANDS)) authority.registerHandler(commandType, questSystem);
  const gateway = new CommandGateway({ authorityPort: authority, definitionRepository: repository });
  questSystem.setCommandGateway(gateway);

  const events = [];
  for (const type of ['questAccepted', 'questTrackingChanged', 'questProgress', 'questCompleted', 'questTurnedIn']) {
    questSystem.on(type, () => events.push(type));
  }
  const panel = new QuestPanel({ projectionStore, projectionId, commandGateway: gateway, actorRef: actorId });
  window.questPanel = panel;
  panel.show();
  const emptyText = panel.content.textContent.trim();
  await questSystem.acceptQuest('golden-quest', { operationId: 'quest:golden:accept' });
  await questSystem.toggleTracking('golden-quest', { operationId: 'quest:golden:track' });
  panel.refresh();
  const activeText = panel.content.textContent.replace(/\s+/g, ' ').trim();
  await questSystem.advanceQuest('golden-quest', { type: ObjectiveType.COLLECT, targetId: 'herb', amount: 1 }, { operationId: 'quest:golden:collect' });
  const turnIn = await questSystem.turnInQuest('golden-quest', { operationId: 'quest:golden:turn-in' });
  const observed = {
    panelId: panel.container.id,
    display: panel.container.style.display,
    emptyText,
    activeText,
    trackedCountBeforeTurnIn: 1,
    trackedCountAfterTurnIn: questSystem.getTrackedQuests().length,
    events,
    reward: { exp: turnIn.value.reward.exp, gold: turnIn.value.reward.gold }
  };
  panel.destroy();
  window.questPanel = null;
  return observed;
}

function endingInput(overrides = {}) {
  const base = {
    storyState: {}, cityState: { coreDamageRatio: 0.1 }, warState: {},
    heroStates: {
      primary: [{ id: 'zhangLiang', alive: true }, { id: 'zhangBao', alive: true }],
      support: [{ id: 'bocai', alive: false }, { id: 'zhangMancheng', alive: false }]
    },
    battleModeStats: { optionalBattles: 1, observed: 0, intervened: 1 },
    retreatReadiness: true,
    hiddenInputs: {
      totalGathered: 0, cityMaintenanceLevel: 0, resourceConstructionScore: 0,
      allOptionalBattlesObserved: false, cityDamageNeglected: false, scorchedEarthChosen: false
    }
  };
  return {
    ...base, ...overrides,
    storyState: { ...base.storyState, ...overrides.storyState },
    cityState: { ...base.cityState, ...overrides.cityState },
    warState: { ...base.warState, ...overrides.warState },
    battleModeStats: { ...base.battleModeStats, ...overrides.battleModeStats },
    hiddenInputs: { ...base.hiddenInputs, ...overrides.hiddenInputs }
  };
}

function endingCases() {
  return {
    scorchedEarth: endingInput({
      cityState: { coreDamageRatio: 0.8 },
      hiddenInputs: { scorchedEarthChosen: true, cityDamageNeglected: true, resourceConstructionScore: 3 }
    }),
    observer: endingInput({
      battleModeStats: { optionalBattles: 1, observed: 1, intervened: 0 },
      hiddenInputs: { allOptionalBattlesObserved: true }
    }),
    spark: endingInput(),
    ember: endingInput({
      heroStates: {
        primary: [{ id: 'zhangLiang', alive: true }, { id: 'zhangBao', alive: false }],
        support: [{ id: 'bocai', alive: false }, { id: 'zhangMancheng', alive: false }]
      }
    }),
    meteor: endingInput({
      heroStates: {
        primary: [{ id: 'zhangLiang', alive: false }, { id: 'zhangBao', alive: false }],
        support: [{ id: 'bocai', alive: true }, { id: 'zhangMancheng', alive: false }]
      }
    }),
    dust: endingInput({
      heroStates: {
        primary: [{ id: 'zhangLiang', alive: false }, { id: 'zhangBao', alive: false }],
        support: [{ id: 'bocai', alive: false }, { id: 'zhangMancheng', alive: false }]
      }
    })
  };
}

async function observeScenarioAndBackends() {
  const cases = endingCases();
  const previewSystem = new EndingSystem();
  const previews = Object.fromEntries(Object.entries(cases).map(([name, input]) => {
    const preview = previewSystem.selectEnding(input);
    return [name, { ok: preview.ok, endingId: preview.endingId, endingSnapshotId: preview.endingSnapshotId }];
  }));

  const endingTrace = [];
  let endingState = { storyState: {}, endingInput: clone(cases.spark) };
  const ending = new EndingSystem({
    readState: () => clone(endingState),
    commitState: draft => { endingTrace.push('commit'); endingState = clone(draft); return true; },
    restoreState: state => { endingState = clone(state); },
    projectInput: state => state.endingInput,
    emit: type => endingTrace.push(`emit:${type}`),
    checkpoint: () => { endingTrace.push('checkpoint'); return { ok: true }; }
  });
  const resolved = await ending.resolveEnding({ operationId: 'ending:S14:golden' });

  const runRoute = async mode => {
    const trace = [];
    let state = { storyState: { unlockedScenes: ['S01'], storyTags: [] }, warState: { battles: { 'battle.s04.changshe': { resultId: 'r-s04' } } }, appliedBattleResultIds: ['r-s04'] };
    const coordinator = new S04RouteCoordinator({
      readState: () => clone(state),
      writeStoryState: storyState => { trace.push('commit:story'); state.storyState = clone(storyState); return true; },
      hasTarget: () => true,
      createCheckpoint: async () => { trace.push('checkpoint'); return { ok: true }; },
      onCommitted: async () => trace.push('notify:routeCommitted')
    });
    const result = await coordinator.commit('nanyang', { backendMode: mode });
    return { result: { ok: result.ok, operationId: result.operationId, routeId: result.route.id, entrySceneId: result.route.entrySceneId }, storyState: state.storyState, trace };
  };
  const twoD = await runRoute('2d');
  const threeD = await runRoute('3d');
  return {
    ending: {
      previews,
      resolved: { ok: resolved.ok, endingId: resolved.endingId, endingSnapshotId: resolved.endingSnapshotId },
      trace: endingTrace
    },
    backendBusiness: { twoD, threeD }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function observeStreaming() {
  const gate = deferred();
  const trace = [];
  const manager = new WorldStreamingManager({
    regionId: 'R', chunkWidth: 100, chunkHeight: 100, cols: 4, rows: 1,
    grid: [['S01', 'S02', 'S03', 'S04']],
    sceneResolver: async sceneId => {
      if (sceneId === 'S01' || sceneId === 'S02') await gate.promise;
      return { id: sceneId };
    },
    onChunkLoad: async (col, row, sceneId) => ({
      col, row, sceneId, sceneNamespace: sceneId,
      prepare: async () => ({ sceneId }), validatePrepared: () => ({ ok: true, errors: [] }),
      commit: async () => { trace.push(`commit:${sceneId}`); return { ok: true }; },
      rollbackPrepared: async () => trace.push(`rollback:${sceneId}`), discardPrepared: async () => trace.push(`discard:${sceneId}`),
      serialize: () => ({ sceneId }), release: async () => trace.push(`release:${sceneId}`)
    })
  });
  const firstPromise = manager.update(10, 10);
  await Promise.resolve();
  const second = await manager.update(310, 10);
  gate.resolve();
  const first = await firstPromise;

  const rollbackTrace = [];
  const rollbackManager = new WorldStreamingManager({ regionId: 'R', cols: 2, rows: 1, grid: [['S01', 'S02']] });
  rollbackManager._generation = 1;
  const loads = ['S01', 'S02'].map((sceneId, index) => ({
    key: `R:${index},0`, spec: { col: index, row: 0, sceneId }, chunkDraft: {}, providerRestores: [],
    chunk: {
      col: index, row: 0, sceneId, sceneNamespace: sceneId,
      commit: async () => { rollbackTrace.push(`commit:${sceneId}`); return index === 1 ? { ok: false } : { ok: true }; },
      rollbackPrepared: async () => rollbackTrace.push(`rollback:${sceneId}`),
      discardPrepared: async () => rollbackTrace.push(`discard:${sceneId}`)
    }
  }));
  const rollback = await rollbackManager.commitPrepared({ generation: 1, center: { col: 0, row: 0 }, loads, unloads: [] });
  return {
    latestWins: { first, second: { ok: second.ok, loaded: second.loaded, unloaded: second.unloaded }, finalScenes: [...manager.loaded.values()].map(chunk => chunk.sceneId).sort(), trace },
    rollback: { result: rollback, trace: rollbackTrace, loadedSize: rollbackManager.loaded.size }
  };
}

async function observeRpcAndIsolation() {
  let request;
  const client = new BattleClient({
    transport: { request: async value => { request = clone(value); return { jsonrpc: '2.0', id: value.id, result: { accepted: true } }; } },
    requestIdFactory: () => 'request-attempt-1'
  });
  const clientResult = await client.createBattle({ operationId: 'operation-stable' });
  const transport = new LocalMockTransport();
  const first = await transport.request(createJsonRpcRequest('request-7', 'unknown', { operationId: 'operation-stable' }));
  const replay = await transport.request(createJsonRpcRequest('request-7', 'unknown', { operationId: 'operation-stable' }));
  const conflict = await transport.request(createJsonRpcRequest('request-7', 'unknown', { operationId: 'operation-other' }));
  const networkSource = read('src/network/NetworkManager.js');
  const project = demoProject;
  return {
    client: { request, result: clientResult },
    localMock: { first, replay, conflict },
    delivery: { resultSource: project.integration.battle.resultSource },
    networkIsolation: {
      imports: [...networkSource.matchAll(/^import\s+.*?from\s+['"](.+?)['"];?$/gm)].map(match => match[1]),
      commandChainReferences: ['CommandGateway', 'AuthorityPort', 'LocalAuthorityAdapter', 'operationId', 'CommittedEvent', 'ProjectionStore'].filter(name => networkSource.includes(name))
    }
  };
}

function pendingMeasuredAcceptance() {
  return {
    frameRate: { status: 'pendingMeasurement', sceneId: 'S11', activeEntityTarget: 100, averageFpsTarget: 60, sample: null },
    regionMemory: { status: 'pendingMeasurement', peakMbTargetExclusive: 100, sample: null },
    dualBackend: { status: 'pendingMeasurement', modes: ['2d', '3d'], replayArtifact: null },
    releaseResidue: { status: 'pendingMeasurement', owners: null, listeners: null, timers: null, resources: null }
  };
}

const GOLDEN = readJson('test/fixtures/gameEditorDataDrivenArchitecturePreservation.golden.json');

async function observePreservationBaseline() {
  return {
    demoAndWorld: observeDemoAndWorld(),
    inventoryAndEquipment: observeInventoryAndEquipment(),
    snapshotAndInput: observeSnapshotAndInput(),
    questPanelAndTracker: await observeQuestPanel(),
    scenarioAndBackends: await observeScenarioAndBackends(),
    streaming: await observeStreaming(),
    rpcAndIsolation: await observeRpcAndIsolation(),
    measuredAcceptance: pendingMeasuredAcceptance()
  };
}

function selectGolden(observed) {
  const demo = observed.demoAndWorld;
  const inventory = observed.inventoryAndEquipment;
  const scenario = observed.scenarioAndBackends;
  return {
    identity: {
      schemaVersion: demo.identity.schemaVersion,
      meta: demo.identity.meta,
      sceneOrder: demo.identity.sceneOrder.order
    },
    legacyRejection: demo.rejection,
    world: demo.world,
    projection: demo.projection,
    scenarioTriggerIds: Object.fromEntries(demo.scenarioSurface.map(scene => [
      scene.sceneId,
      scene.triggerCommands.map(trigger => trigger.triggerId)
    ])),
    endingPriority: demo.endingPriority,
    inventory: { first: inventory.first, replay: inventory.replay, conflict: inventory.conflict, count: inventory.count },
    equipment: {
      equipResult: inventory.equipResult,
      unequipItemId: inventory.unequipResult?.id || null,
      undo: inventory.undo,
      slotAfterUndo: inventory.slotAfterUndo,
      events: inventory.events
    },
    snapshot: {
      restored: observed.snapshotAndInput.snapshot.restored,
      state: observed.snapshotAndInput.snapshot.state,
      trace: observed.snapshotAndInput.snapshot.trace
    },
    input: observed.snapshotAndInput.input,
    quest: observed.questPanelAndTracker,
    endings: scenario.ending,
    backendBusiness: scenario.backendBusiness.twoD,
    streaming: observed.streaming,
    rpc: observed.rpcAndIsolation,
    measuredAcceptance: observed.measuredAcceptance
  };
}

const DIAGNOSTIC_METADATA_KEYS = new Set(['provenance', 'phase', 'auditMetadata']);
function normalizeDiagnostics(value) {
  if (Array.isArray(value)) return value.map(normalizeDiagnostics);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !DIAGNOSTIC_METADATA_KEYS.has(key))
    .map(([key, item]) => [key, normalizeDiagnostics(item)]));
}

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Property 2: Preservation - Non-Buggy Inputs Retain Existing Observable Behavior', () => {
  // **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12**
  it('matches the observation-first golden snapshot and ordered traces', async () => {
    const observed = await observePreservationBaseline();
    expect(selectGolden(observed)).toEqual(GOLDEN);
    expect(observed.scenarioAndBackends.backendBusiness.threeD)
      .toEqual(observed.scenarioAndBackends.backendBusiness.twoD);
  }, 15000);

  it('preserves single-offset projection and operationId replay for generated non-buggy inputs', () => {
    const seeds = [0x5eed0001, 0x5eed0002, 0x5eed0003, 0x5eed0004, 0x5eed0005, 0x5eed0006];
    for (const seed of seeds) {
      const random = seededRng(seed);
      const local = {
        id: `object-${seed}`,
        x: Math.floor(random() * 500),
        y: Math.floor(random() * 300),
        sortY: Math.floor(random() * 300),
        points: [[Math.floor(random() * 20), Math.floor(random() * 20)]],
        path: [{ x: Math.floor(random() * 20), y: Math.floor(random() * 20) }]
      };
      const before = clone(local);
      const offset = { x: Math.floor(random() * 10) * 1280, y: Math.floor(random() * 10) * 720 };
      const projected = new SceneObjectProjector().project(local, offset);
      expect(local).toEqual(before);
      expect(projected.x).toBe(local.x + offset.x);
      expect(projected.y).toBe(local.y + offset.y);
      expect(projected.sortY).toBe(local.sortY + offset.y);
      expect(projected.points[0]).toEqual([local.points[0][0] + offset.x, local.points[0][1] + offset.y]);

      const quantity = 1 + Math.floor(random() * 12);
      const inventory = new InventoryComponent({ maxSlots: 3 });
      const service = new InventoryTransactionService();
      const operationId = `generated:add:${seed}`;
      const item = { id: `item-${seed}`, type: 'material', maxStack: 5 };
      const first = service.commit({ type: 'add', inventory, item, quantity, operationId });
      const replay = service.commit({ type: 'add', inventory, item, quantity, operationId });
      const conflict = service.commit({ type: 'add', inventory, item, quantity: quantity + 1, operationId });
      expect(first).toMatchObject({ ok: true, accepted: quantity, remainder: 0 });
      expect(replay).toEqual({ ...first, idempotent: true });
      expect(conflict).toEqual({ ok: false, code: 'operationIdConflict', operationId });
      expect(inventory.getItemCount(item.id)).toBe(quantity);
    }
  });

  it('normalizes only additive diagnostic metadata and keeps business differences visible', () => {
    const diagnostics = [{
      code: 'inventoryFull', path: 'inventory.slots', reason: 'capacity', actual: 7,
      provenance: 'disk', phase: 'validate', auditMetadata: { revision: 4 },
      payload: { slot: 'mainhand', mappedSlot: 'weapon', businessResult: 'rejected' }
    }];
    expect(normalizeDiagnostics(diagnostics)).toEqual([{
      code: 'inventoryFull', path: 'inventory.slots', reason: 'capacity', actual: 7,
      payload: { slot: 'mainhand', mappedSlot: 'weapon', businessResult: 'rejected' }
    }]);
  });

  it('records performance, memory, measured dual-backend, and release checks as pending only', () => {
    expect(Object.values(GOLDEN.measuredAcceptance).every(record => record.status === 'pendingMeasurement')).toBe(true);
    expect(GOLDEN.measuredAcceptance.frameRate.sample).toBeNull();
    expect(GOLDEN.measuredAcceptance.regionMemory.sample).toBeNull();
    expect(GOLDEN.measuredAcceptance.dualBackend.replayArtifact).toBeNull();
    expect(GOLDEN.measuredAcceptance.releaseResidue).toMatchObject({ owners: null, listeners: null, timers: null, resources: null });
  });
});
