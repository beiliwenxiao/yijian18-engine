import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SceneSystemContainer } from '../src/core/scene/SceneSystemContainer.js';
import { GameSceneRuntime } from '../src/core/scene/GameSceneRuntime.js';
import { ContentValidator, FieldType } from '../src/core/validation/ContentValidator.js';
import { CanonicalCandidatePipeline } from '../src/core/validation/CanonicalCandidatePipeline.js';
import { CandidateRuleValidator } from '../src/core/validation/CandidateRuleValidator.js';
import { ContentErrorCategory } from '../src/core/validation/ContentOperationResult.js';
import { ProjectWorldIndex } from '../src/core/ProjectWorldIndex.js';
import { CanonicalSnapshot } from '../src/core/CanonicalSnapshot.js';
import { DefinitionRepository, DefinitionRepositoryValidationError } from '../src/core/DefinitionRepository.js';
import { auditTrackedJavaScript, readExceptionManifest } from '../src/dev/JavaScriptAuditGate.js';
import { CanonicalDocumentService } from '../editor/CanonicalDocumentService.js';
import { EditorCanonicalCandidateValidator, EditorSceneCommandService } from '../editor/EditorSceneCommandService.js';
import { MemorySceneCacheAdapter } from '../src/core/scene/CanonicalSceneAdapters.js';
import { TriggerGraph } from '../src/core/scenario/TriggerGraph.js';
import { ScenarioDefinitionIndex } from '../src/core/scenario/ScenarioDefinitionIndex.js';
import { TriggerSystem } from '../src/systems/TriggerSystem.js';
import { createStandardActionDescriptorRegistry } from '../src/systems/ActionDescriptorRegistry.js';
import { CommandAdapter } from '../src/systems/CommandAdapter.js';
import { QuestSystem } from '../src/systems/QuestSystem.js';
import { SceneEditorHistory } from '../editor/SceneEditorHistory.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXED_SEED = 0x5eedc0de;
const ARCHITECTURE_KINDS = new Set([
  'SCENE_LIFECYCLE', 'CONFIG_RELOAD', 'PROJECT_WORLD', 'SCENE_REFRESH',
  'EDITOR_MUTATION', 'WORLD_GRID_SAVE', 'SCHEMA_EDIT', 'CANONICAL_LOAD_FAILURE',
  'ROUND_TRIP', 'CANDIDATE_SUBMIT', 'JAVASCRIPT_AUDIT', 'CONTENT_EXTENSION',
  'QUEST_RUNTIME', 'COMMAND_EXECUTION'
]);

const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const readOptional = relativePath => {
  const absolute = path.join(ROOT, relativePath);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
};

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createHarness(seed, faultAt = null) {
  const trace = [];
  const random = seededRng(seed);
  const adapter = name => ({
    state: new Map(),
    write(key, value, phase = name) {
      trace.push(`${name}:write:${key}`);
      if (faultAt === phase) throw new Error(`injected:${phase}`);
      this.state.set(key, structuredClone(value));
    },
    snapshot() { return [...this.state.entries()]; }
  });
  return {
    disk: adapter('disk'), cache: adapter('cache'), trace, faultAt,
    clocks: { logical: () => 17, monotonic: () => 101, wall: () => 1700000000000 },
    rng: { seed, next: random },
    transport: {
      async execute(message) {
        trace.push({ transport: 'request', message: structuredClone(message) });
        const response = structuredClone(message);
        trace.push({ transport: 'response', message: response });
        return response;
      }
    }
  };
}

function makeInput(probe, seed, generated) {
  const random = seededRng(seed);
  return {
    kind: probe.kind,
    probe: probe.id,
    seed,
    generated,
    variant: {
      aliases: generated ? 2 + Math.floor(random() * 3) : 2,
      precision: generated ? 1.2345 + random() / 10000 : 1.234567,
      faultPhase: generated
        ? ['validate', 'disk', 'memory', 'cache', 'notify'][Math.floor(random() * 5)]
        : (probe.faultPhase || 'disk')
    }
  };
}

// Seeds drive generated inputs and replay only. A snapshot revision is a separate,
// stable test identifier and must satisfy CanonicalSnapshot's revision contract.
function canonicalTestRevision(seed, role = 'snapshot') {
  return `property-1:${role}:${seed >>> 0}`;
}

function loadCanonicalEditorAggregate() {
  const root = path.join(ROOT, 'example/sanguo_zhangjiao');
  const resolveRefs = value => {
    if (Array.isArray(value)) return value.map(resolveRefs);
    if (!value || typeof value !== 'object') return value;
    if (typeof value.$ref === 'string') {
      return resolveRefs(JSON.parse(fs.readFileSync(path.join(root, value.$ref), 'utf8')));
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveRefs(child)]));
  };
  const mainProject = JSON.parse(fs.readFileSync(path.join(root, 'game.project.json'), 'utf8'));
  // shards 分片：主文件声明的分片字段并回完整 project（$ref 解析前）
  const projectSource = { ...mainProject };
  for (const [shardField, shardPath] of Object.entries(mainProject.shards || {})) {
    projectSource[shardField] = JSON.parse(fs.readFileSync(path.join(root, shardPath), 'utf8'));
  }
  const project = resolveRefs(projectSource);
  const sceneOrder = JSON.parse(fs.readFileSync(path.join(root, 'assets/scenes/_scene_order.json'), 'utf8'));
  const scenes = Object.fromEntries(project.scenes.map(({ id }) => [
    id,
    JSON.parse(fs.readFileSync(path.join(root, `assets/scenes/${id}.json`), 'utf8'))
  ]));
  return { project, sceneOrder, scenes };
}

function createFailureClassificationPipeline() {
  const contentValidator = new ContentValidator({ supportedVersion: 2 });
  contentValidator.registerSchema({
    id: 'propertyFailureRoot',
    fields: {
      schemaVersion: { type: FieldType.INTEGER, required: true, min: 1, max: 2 },
      count: { type: FieldType.INTEGER, default: 3, min: 0 },
      entries: { type: FieldType.ARRAY, required: true }
    }
  });
  return new CanonicalCandidatePipeline({
    contentValidator,
    ruleValidator: new CandidateRuleValidator({ contentValidator })
  });
}

function architectureAuditPaths() {
  return [
    'src/core/scene/SceneSystemContainer.js',
    'src/core/scene/GameSceneRuntime.js',
    'src/core/ProjectWorldIndex.js',
    'src/core/validation/CanonicalCandidatePipeline.js',
    'src/core/scene/CanonicalSceneRepository.js',
    'src/systems/ActionDescriptorRegistry.js',
    'src/systems/CommandAdapter.js',
    'src/systems/TriggerSystem.js'
  ];
}

async function executeCanonicalTriggerPath(seed, { withScenario = false } = {}) {
  const project = {
    schemaVersion: 1,
    scenes: [{ id: 'S01' }], battles: [{ id: 'battle.one' }],
    dialogues: [], quests: [], tutorials: [], rescues: [], endings: [], library: {},
    triggers: [{ id: 'generic-trigger', when: { type: 'signal' }, do: [{ action: 'battle.command', params: { battleId: 'battle.one', operation: 'start' } }] }],
    scenarios: withScenario
      ? [{ id: 'scenario.one', scope: { sceneId: 'S01' }, triggerRefs: ['generic-trigger'], sceneRefs: ['S01'], questRefs: [], dialogueRefs: [], commandRefs: [] }]
      : []
  };
  const snapshot = CanonicalSnapshot.fromProject(project, { revision: canonicalTestRevision(seed, withScenario ? 'trigger-kernel' : 'content-extension') });
  const repository = DefinitionRepository.fromSnapshot(snapshot);
  const descriptors = createStandardActionDescriptorRegistry();
  const intents = [];
  const commandGateway = {
    async execute(intent) {
      intents.push(structuredClone(intent));
      return {
        ok: true, operationId: intent.operationId, status: 'committed', committed: true, code: null,
        stateId: 'battle:battle.one', stateRevision: 1, eventFrom: 1, eventTo: 1, value: null, error: null
      };
    }
  };
  const adapter = new CommandAdapter({ registry: descriptors, definitionRepository: repository, commandGateway });
  const graph = TriggerGraph.fromSnapshot(snapshot);
  const index = ScenarioDefinitionIndex.fromSnapshot(snapshot, { triggerGraph: graph });
  const triggerSystem = new TriggerSystem({ actionDescriptorRegistry: descriptors, commandAdapter: adapter, definitionRevision: snapshot.definitionRevision });
  triggerSystem.init({ definitionRepository: repository, player: { id: 'player' } });
  triggerSystem.register(project.triggers[0]);
  const execution = await triggerSystem.fireAndWait('signal', { actorRef: 'player' });
  return { snapshot, repository, descriptors, adapter, graph, index, triggerSystem, execution, intents };
}

function executableJavaScript() {
  const roots = ['src', 'editor', 'example/sanguo_zhangjiao'];
  const output = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const relative = path.relative(ROOT, fullPath).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        if (/(^|\/)(node_modules|dist|desktop|mobile|test|tests|fixtures|vendor|third_party|generated)(\/|$)/.test(relative)) continue;
        visit(fullPath);
      } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
        output.push({ file: relative, source: fs.readFileSync(fullPath, 'utf8') });
      }
    }
  };
  for (const root of roots) visit(path.join(ROOT, root));
  return output;
}

function result(input, phase, commandSequence, snapshot, actualTrace, correctPredicate, counterexample) {
  return {
    triggered: true,
    correctPredicate,
    phase,
    commandSequence,
    snapshot,
    actualTrace,
    counterexample
  };
}

function expectedBehavior(observation) {
  return observation.correctPredicate === true;
}

function isBugCondition(input, observation) {
  return ARCHITECTURE_KINDS.has(input.kind)
    && observation.triggered === true
    && !expectedBehavior(observation, input);
}

const PROBES = [
  { id: 'duplicate-owned-lifecycle', kind: 'SCENE_LIFECYCLE' },
  { id: 'module-global-owner', kind: 'SCENE_LIFECYCLE' },
  { id: 'null-is-not-missing', kind: 'CONFIG_RELOAD' },
  { id: 'project-only-derivation', kind: 'PROJECT_WORLD' },
  { id: 'disk-refresh-removes-cache-id', kind: 'SCENE_REFRESH' },
  { id: 'editor-atomic-commit', kind: 'EDITOR_MUTATION', faultPhase: 'disk' },
  { id: 'world-grid-canonical-closure', kind: 'WORLD_GRID_SAVE' },
  { id: 'schema-aware-field-preservation', kind: 'SCHEMA_EDIT' },
  { id: 'lossless-round-trip', kind: 'ROUND_TRIP' },
  { id: 'classified-load-failure', kind: 'CANONICAL_LOAD_FAILURE' },
  { id: 'complete-candidate-before-commit', kind: 'CANDIDATE_SUBMIT', faultPhase: 'validate' },
  { id: 'javascript-scope-lines-responsibility', kind: 'JAVASCRIPT_AUDIT' },
  { id: 'json-only-content-extension', kind: 'CONTENT_EXTENSION' },
  { id: 'duplicate-definition-rejected', kind: 'CONTENT_EXTENSION' },
  { id: 'item-ui-command-port', kind: 'CONTENT_EXTENSION' },
  { id: 'trigger-success-only-ledger', kind: 'CONTENT_EXTENSION' },
  { id: 'trigger-sole-kernel', kind: 'CONTENT_EXTENSION' },
  { id: 'quest-definition-runtime-transaction', kind: 'QUEST_RUNTIME' },
  { id: 'request-operation-separation', kind: 'COMMAND_EXECUTION' },
  { id: 'projection-gap-stops-apply', kind: 'COMMAND_EXECUTION' },
  { id: 'clock-rng-replay', kind: 'COMMAND_EXECUTION' }
];

async function executeOriginal(input) {
  const worldMapSource = read('editor/WorldMapEditor.js');
  const editorManagerSource = read('editor/EditorDataManager.js');
  const loaderSource = read('editor/SceneDataLoader.js');
  const triggerSource = read('src/systems/TriggerSystem.js');
  const questSource = read('src/systems/QuestSystem.js');
  const pickupSource = read('src/systems/PickupSystem.js');

  switch (input.probe) {
    case 'duplicate-owned-lifecycle': {
      const events = [];
      const shared = { update: () => events.push('update:shared'), destroy: () => events.push('destroy:shared') };
      const container = new SceneSystemContainer();
      for (let index = 0; index < input.variant.aliases; index++) container.register(`owner-${index}`, shared, { order: index });
      container.update(0.016);
      container.destroy();
      container.destroy();
      const updates = events.filter(event => event === 'update:shared').length;
      const disposals = events.filter(event => event === 'destroy:shared').length;
      return result(input, 'ownership-lifecycle', [`register same identity x${input.variant.aliases}`, 'update(frame=1)', 'dispose()', 'dispose()'],
        { aliases: input.variant.aliases, ownership: 'owned' }, { events, updates, disposals },
        updates === 1 && disposals === 1,
        `same owned identity updated ${updates} times and disposed ${disposals} times`);
    }
    case 'module-global-owner': {
      const events = [];
      const shared = {
        update: () => events.push('update:shared'),
        destroy: () => events.push('destroy:shared')
      };
      const runtime = new GameSceneRuntime();
      const borrowedProjection = {};
      const owner = runtime.registerSystem('shared-owner', shared, { order: 100 });
      runtime.applyRegistrationPlan({
        id: 'borrowed-projection',
        registrations: [{ name: 'shared-borrowed', instance: shared, options: { ownership: 'BORROWED', updateHook: false, order: 200 } }],
        projections: [{ target: borrowedProjection, key: 'shared', instance: shared }]
      });
      runtime.enter();
      runtime.update(0.016);
      const borrowed = runtime.get('shared-borrowed');
      const projectedBeforeDispose = borrowedProjection.shared;
      const firstDispose = runtime.dispose();
      const secondDispose = runtime.dispose();
      return result(input, 'dependency-ownership', ['construct GameSceneRuntime', 'register owned capability once', 'borrow identity as projection', 'update(frame=1)', 'dispose()', 'dispose()'],
        { lifecycleOwner: 'GameSceneRuntime/SceneSystemContainer', identity: 'shared' },
        { owner, borrowed, projectedBeforeDispose, projectionAfterDispose: borrowedProjection.shared, events, firstDispose, secondDispose },
        owner === shared && borrowed === shared && projectedBeforeDispose === shared && borrowedProjection.shared === null
          && events.filter(event => event === 'update:shared').length === 1
          && events.filter(event => event === 'destroy:shared').length === 1
          && firstDispose === secondDispose,
        'GameSceneRuntime/SceneSystemContainer did not retain the single owner identity, exactly-once update/disposal, or idempotent disposal');
    }
    case 'null-is-not-missing': {
      const validator = new ContentValidator();
      validator.registerSchema({ id: 'runtime-config', fields: { followDistance: { type: FieldType.NUMBER, min: 1, max: 20 } } });
      const candidate = { followDistance: null };
      const validation = validator.validate(candidate, 'runtime-config', 'candidate');
      const rejectedAtRootPath = !validation.ok && validation.errors.some(error => error.path === 'candidate.followDistance');
      return result(input, 'candidate-validation', ['load last-good', 'submit followDistance:null', 'validate candidate'],
        { lastGood: { followDistance: 8 }, candidate }, validation, rejectedAtRootPath,
        'optional non-null followDistance:null was accepted or not reported at candidate.followDistance');
    }
    case 'project-only-derivation': {
      const demoFallbacks = [...worldMapSource.matchAll(/(?:chunkWidth|chunkHeight|cols|rows):\s*r\.[^\n]+\|\|\s*\d+/g)].map(match => match[0]);
      return result(input, 'project-derivation', ['load rows=12 cols=10 chunk=960x540 entry=S03', 'derive bounds/entry/offset'],
        { rows: 12, cols: 10, chunkWidth: 960, chunkHeight: 540, entrySceneId: 'S03', local: { x: 7, y: 11 } },
        { demoFallbacks }, demoFallbacks.length === 0,
        `Demo defaults remain in project derivation: ${demoFallbacks.join('; ')}`);
    }
    case 'disk-refresh-removes-cache-id': {
      const cacheExtendsIds = /localStorage[\s\S]*availableScenes\.push\(s\.id\)/.test(worldMapSource);
      return result(input, 'repository-refresh', ['disk rename S05 -> S05A', 'retain cache S05', 'refresh IDs'],
        { diskIds: ['S05A'], cacheIds: ['S05'] }, { cacheExtendsIds }, !cacheExtendsIds,
        'stale cache ID can extend the disk canonical ID set');
    }
    case 'editor-atomic-commit': {
      const harness = createHarness(input.seed, input.variant.faultPhase);
      harness.disk.state.set('world', { revision: 'before' });
      harness.cache.state.set('world', { revision: 'before' });
      const directSave = worldMapSource.includes("fetch('/api/save-file'");
      const fullPipeline = /validate[\s\S]*canonicalize[\s\S]*atomic/i.test(worldMapSource);
      try { harness.disk.write('world', { revision: 'candidate' }, input.variant.faultPhase); } catch (error) { harness.trace.push(error.message); }
      return result(input, 'editor-transaction', [`inject fault:${input.variant.faultPhase}`, 'save world map'],
        { diskBefore: 'before', memoryBefore: 'before', cacheBefore: 'before' },
        { directSave, fullPipeline, adapterTrace: harness.trace, disk: harness.disk.snapshot(), cache: harness.cache.snapshot() },
        !directSave || fullPipeline,
        'editor exposes direct save without complete candidate + atomic transaction boundary');
    }
    case 'world-grid-canonical-closure': {
      const candidate = loadCanonicalEditorAggregate();
      const region = candidate.project.worldMap.regions.find(entry => Array.isArray(entry.grid));
      const row = region.grid.findIndex(entries => Array.isArray(entries) && entries.some(cell => typeof cell === 'string'));
      const col = region.grid[row].findIndex(cell => typeof cell === 'string');
      region.grid[row][col] = { sceneId: 'CACHE_ONLY', reserved: true };
      let indexErrors = [];
      try { ProjectWorldIndex.build(candidate.project); } catch (error) { indexErrors = error.errors || []; }
      const validator = new EditorCanonicalCandidateValidator();
      const validation = validator.validateAndCanonicalize(candidate, { source: 'property://world-grid-closure' });
      return result(input, 'world-grid-closure', ['build complete canonical candidate', 'place reserved CACHE_ONLY outside project closure', 'validate ProjectWorldIndex and EditorCanonicalCandidateValidator'],
        { canonicalIds: candidate.project.scenes.map(scene => scene.id), gridPath: `worldMap.regions[${candidate.project.worldMap.regions.indexOf(region)}].grid[${row}][${col}]` },
        { indexErrors, validationErrors: validation.errors, committed: validation.committed },
        indexErrors.some(error => error.code === 'unknownSceneId')
          && validation.ok === false && validation.committed === false
          && validation.errors.some(error => error.code === 'invalidProjectWorld' || error.code === 'unknownSceneId'),
        'EditorCanonicalCandidateValidator/ProjectWorldIndex accepted a non-canonical reserved grid ID or exposed a partial commit');
    }
    case 'schema-aware-field-preservation':
    case 'lossless-round-trip': {
      const before = {
        id: 'S01', unknownLegal: { keep: true }, imageAssets: { unusedStable: { src: 'assets/images/stable.png' } },
        layers: [{ id: 'objects', objects: [{ id: 'stable-id', imageId: 'stable-image', assetId: 'stable-image', x: input.variant.precision, points: [[input.variant.precision, 2.34567]] }] }]
      };
      const editor = { sceneData: structuredClone(before), onSceneChange() {}, ui: { showToast() {} } };
      new SceneEditorHistory(editor).save();
      const after = editor.sceneData;
      const unchanged = JSON.stringify(after) === JSON.stringify(before);
      const phase = input.probe === 'schema-aware-field-preservation' ? 'schema-aware-edit' : 'canonical-round-trip';
      return result(input, phase, ['load', 'preview', 'save without semantic edit', 'reload'], before,
        { before, after }, unchanged,
        'no-op editor round-trip removed legal fields or rounded canonical values');
    }
    case 'classified-load-failure': {
      const pipeline = createFailureClassificationPipeline();
      const lastGood = Object.freeze({ schemaVersion: 1, count: 7, entries: [] });
      const cases = [
        ['missing', pipeline.process(null, { schemaId: 'propertyFailureRoot', source: 'disk://missing.json', lastSuccessfulValue: lastGood })],
        ['unreadable', pipeline.process('ignored', { schemaId: 'propertyFailureRoot', source: 'disk://denied.json', lastSuccessfulValue: lastGood, reader: () => { throw new Error('denied'); } })],
        ['parseFailed', pipeline.process('{ invalid', { schemaId: 'propertyFailureRoot', source: 'disk://broken.json', lastSuccessfulValue: lastGood })],
        ['schemaFailed', pipeline.process({ schemaVersion: 1, count: null, entries: [] }, { schemaId: 'propertyFailureRoot', source: 'disk://schema.json', lastSuccessfulValue: lastGood })]
      ];
      const expectedCategories = [
        ContentErrorCategory.MISSING,
        ContentErrorCategory.UNREADABLE,
        ContentErrorCategory.PARSE_FAILED,
        ContentErrorCategory.SCHEMA_FAILED
      ];
      return result(input, 'canonical-load-failure', ['retain last-good canonical value', 'run CanonicalCandidatePipeline for missing/unreadable/parse/schema failures', 'classify source/category'],
        { lastGood, categories: expectedCategories },
        { cases: cases.map(([kind, value]) => ({ kind, ok: value.ok, category: value.category, source: value.source, value: value.value, errors: value.errors })) },
        cases.every(([, value], index) => value.ok === false && value.value === lastGood
          && value.category === expectedCategories[index] && value.errors.every(error => error.source === value.source)),
        'CanonicalCandidatePipeline failed to retain last-good state or classify missing/unreadable/parseFailed/schemaFailed source failures');
    }
    case 'complete-candidate-before-commit': {
      const projectPath = 'example/sanguo_zhangjiao/game.project.json';
      const documentService = new CanonicalDocumentService();
      const aggregate = loadCanonicalEditorAggregate();
      const model = documentService.openProject({ sourceUri: projectPath, canonical: aggregate });
      const cache = new MemorySceneCacheAdapter({
        S01: { sceneId: 'S01', source: 'disk://S01.json', canonicalData: structuredClone(aggregate.scenes.S01), eligible: true }
      });
      const diskCalls = [];
      const notifierCalls = [];
      const service = new EditorSceneCommandService({
        documentService,
        validator: new EditorCanonicalCandidateValidator(),
        cacheAdapter: cache,
        diskTransaction: async (_path, changes) => { diskCalls.push(changes); return { ok: true, committed: true, transactionId: 'unexpected' }; },
        notifier: async event => notifierCalls.push(event)
      });
      const beforeMemory = model.getCommittedSnapshot();
      const beforeCache = structuredClone(cache.entries);
      const rejected = await service.save(projectPath, { sceneId: 'S01', scene: { ...aggregate.scenes.S01, layers: null } });
      return result(input, 'candidate-submit', ['open committed canonical aggregate', 'submit invalid nested scene candidate through EditorSceneCommandService', 'observe disk/memory/cache/notification'],
        { candidate: { sceneId: 'S01', layers: null }, disk: 'before', memory: 'before', cache: 'before' },
        { rejected, diskCalls, notifierCalls, memory: model.getCommittedSnapshot(), cache: cache.entries },
        rejected.ok === false && rejected.committed === false && rejected.status === 'rejected'
          && rejected.code === 'candidateValidationFailed' && rejected.errors.some(error => error.path.includes('layers'))
          && diskCalls.length === 0 && notifierCalls.length === 0
          && JSON.stringify(model.getCommittedSnapshot()) === JSON.stringify(beforeMemory)
          && JSON.stringify(cache.entries) === JSON.stringify(beforeCache),
        'EditorSceneCommandService allowed a rejected full candidate to modify disk, committed memory, cache, or notification state');
    }
    case 'javascript-scope-lines-responsibility': {
      const files = architectureAuditPaths();
      const audit = auditTrackedJavaScript({
        root: ROOT,
        paths: files,
        exceptionManifest: readExceptionManifest(ROOT)
      });
      const lineOrResponsibilityFailures = audit.violations.filter(violation => (
        violation.code === 'line-limit-or-invalid-exception'
        || violation.code.includes('overreach')
        || violation.code.includes('responsibility')
      ));
      const oversizedWithoutValidException = audit.units.filter(unit => (
        unit.physicalLines > 1000 && unit.exception.status !== 'valid'
      ));
      const invalidExceptions = audit.units.filter(unit => (
        unit.physicalLines > 1000 && unit.exception.status === 'invalid'
      ));
      return result(input, 'javascript-audit', ['enumerate architecture-supported executable units', 'count physical lines including comments/blank lines', 'validate responsibility and evidence-bound exception gate'],
        { scope: files, exclusions: ['test', 'fixtures', 'third-party', 'generated', 'dist', 'desktop', 'mobile'] },
        { units: audit.units, included: audit.included, lineOrResponsibilityFailures, oversizedWithoutValidException, invalidExceptions },
        audit.included.map(entry => entry.file).sort().join('|') === files.slice().sort().join('|')
          && audit.units.every(unit => unit.physicalLines >= 1 && (unit.physicalLines <= 1000 || unit.exception.status === 'valid'))
          && lineOrResponsibilityFailures.length === 0 && oversizedWithoutValidException.length === 0 && invalidExceptions.length === 0,
        'architecture-supported executable units violate the physical-line, responsibility, or evidence-bound exception gate');
    }
    case 'json-only-content-extension': {
      const pathResult = await executeCanonicalTriggerPath(input.seed);
      const descriptorContracts = pathResult.descriptors.all().every(descriptor => (
        Object.isFrozen(descriptor) && descriptor.adapterId === 'command'
          && typeof descriptor.commandType === 'string'
          && !Object.values(descriptor).some(value => typeof value === 'function')
      ));
      const intent = pathResult.intents[0];
      return result(input, 'content-extension-restart', ['add schema-expressible content JSON', 'publish CanonicalSnapshot and DefinitionRepository', 'derive TriggerGraph/index', 'execute generic ActionDescriptor through CommandAdapter and TriggerSystem'],
        { jsonDelta: { item: 'existing-capability' }, executableJavaScriptDiff: 0, seed: input.seed },
        { snapshotRevision: pathResult.snapshot.definitionRevision, repositoryKinds: pathResult.repository.kinds(), graphIds: pathResult.graph.ids(), indexedScenarioCount: pathResult.index.ids().length, descriptorIds: pathResult.descriptors.ids(), execution: pathResult.execution, intents: pathResult.intents },
        descriptorContracts && pathResult.graph.has('generic-trigger') && pathResult.repository.has('triggers', 'generic-trigger')
          && pathResult.execution.ok === true && pathResult.execution.accepted === 1
          && intent?.intentType === 'battle.command' && intent.actorRef === 'player' && intent.payload.battleId === 'battle.one',
        'canonical content did not execute through CanonicalSnapshot → DefinitionRepository → TriggerGraph/ScenarioDefinitionIndex → ActionDescriptorRegistry → CommandAdapter → TriggerSystem');
    }
    case 'duplicate-definition-rejected': {
      const first = { id: 'same', value: 1 };
      const second = { id: 'same', value: 2 };
      const lastSuccessfulSnapshot = CanonicalSnapshot.fromProject({ schemaVersion: 1, library: { items: [first] } }, { revision: canonicalTestRevision(input.seed, 'last-good') });
      const lastSuccessfulRepository = DefinitionRepository.fromSnapshot(lastSuccessfulSnapshot);
      let currentSnapshot = lastSuccessfulSnapshot;
      let currentRepository = lastSuccessfulRepository;
      let rejected = false;
      let errors = [];
      try {
        const candidateSnapshot = CanonicalSnapshot.fromProject({ schemaVersion: 1, library: { items: [first, second] } }, { revision: canonicalTestRevision(input.seed, 'candidate') });
        const candidateRepository = DefinitionRepository.fromSnapshot(candidateSnapshot);
        currentSnapshot = candidateSnapshot;
        currentRepository = candidateRepository;
      } catch (error) {
        rejected = error instanceof DefinitionRepositoryValidationError;
        errors = error.errors || [];
      }
      return result(input, 'definition-publication', ['build last successful CanonicalSnapshot', 'build duplicate candidate definition IDs', 'validate DefinitionRepository before publish'],
        { definitions: [first, second] },
        { rejected, errors, currentRevision: currentSnapshot.definitionRevision, published: currentRepository.get('items', 'same') },
        rejected && currentSnapshot === lastSuccessfulSnapshot && currentRepository === lastSuccessfulRepository && currentRepository.get('items', 'same')?.value === first.value,
        'duplicate definition ID was not rejected before publish, partially published, or replaced the last successful snapshot');
    }
    case 'item-ui-command-port': {
      const directInventoryCommit = /inventoryTransactions\.commit\(/.test(pickupSource);
      const gateway = /CommandGateway|AuthorityPort|ItemLifecycleService/.test(pickupSource);
      const uiDirectStats = /statsComponent\.(?:attack|defense|maxHp|maxMp|speed)\s*[+\-]=/.test(read('src/ui/InventoryPanel.js'));
      return result(input, 'item-command-bypass', ['submit pickup intent', 'inject item/UI failure', 'inspect authoritative mutation path'],
        { item: { definitionId: 'potion', quantity: 1 }, operationId: 'item-op' },
        { directInventoryCommit, gateway, uiDirectStats }, gateway && !directInventoryCommit && !uiDirectStats,
        'Pickup/UI can mutate inventory or stats without the unified command port');
    }
    case 'trigger-success-only-ledger': {
      const events = [];
      const trigger = new TriggerSystem();
      trigger.registerAction('rejecting', () => { events.push('action:rejecting'); throw new Error('injected'); });
      trigger.registerAction('must-not-run', () => events.push('action:must-not-run'));
      trigger.on(event => events.push(event));
      trigger.register({ id: 'once-chain', when: { type: 'signal' }, once: true, cooldown: 30, do: [{ action: 'rejecting' }, { action: 'must-not-run' }] });
      trigger.fire('signal');
      await Promise.resolve();
      const onceCommitted = trigger.hasFiredOnce('once-chain');
      const continued = events.includes('action:must-not-run');
      return result(input, 'trigger-ledger-commit', ['fire once trigger', 'action[0] throws', 'observe action[1]/once/cooldown'],
        { triggerId: 'once-chain', once: true, actions: ['rejecting', 'must-not-run'] },
        { events, onceCommitted, cooldownCommitted: Boolean(trigger.serialize().cooldowns['once-chain']), continued },
        !onceCommitted && !continued && events.includes('triggerFailed'),
        'Trigger committed once/cooldown before chain success and continued after action failure');
    }
    case 'trigger-sole-kernel': {
      const pathResult = await executeCanonicalTriggerPath(input.seed, { withScenario: true });
      const closure = pathResult.index.getReferenceClosure('scenario.one');
      const intent = pathResult.intents[0];
      const genericDescriptors = pathResult.descriptors.all().every(descriptor => descriptor.adapterId === 'command'
        && descriptor.commandType === descriptor.id && Object.isFrozen(descriptor));
      return result(input, 'trigger-kernel-closure', ['publish canonical scenario/trigger definitions', 'derive read-only TriggerGraph/index', 'execute schema-validated generic action via CommandAdapter and TriggerSystem'],
        { actionContract: 'schema-validated generic command' },
        { descriptorIds: pathResult.descriptors.ids(), execution: pathResult.execution, intent, graphIds: pathResult.graph.ids(), scenarioClosure: closure, triggerLedger: pathResult.triggerSystem.serialize().ledger },
        genericDescriptors && pathResult.graph.has('generic-trigger')
          && pathResult.index.get('scenario.one')?.references?.triggers.includes('generic-trigger')
          && closure?.triggers?.includes('generic-trigger')
          && pathResult.execution.ok === true && pathResult.intents.length === 1
          && intent?.operationId?.startsWith(`trigger:${pathResult.snapshot.definitionRevision}:generic-trigger:`),
        'canonical scenario definitions did not close through the sole TriggerSystem execution kernel and generic command adapter');
    }
    case 'quest-definition-runtime-transaction': {
      const questSystem = new QuestSystem();
      const firstQuest = questSystem.getAllQuests()[0] || null;
      const serialized = firstQuest?.serialize?.() || null;
      const runtimeKeys = serialized ? ['state', 'objectives', 'acceptedTime', 'completedTime', 'tracked'].filter(key => key in serialized) : [];
      const hasSecondProgressionAlgorithm = /updateObjective\([\s\S]*checkCompletion\(\)/.test(questSource);
      const nonAtomicTurnIn = /const reward = quest\.turnIn\(\);[\s\S]*activeQuests\.delete[\s\S]*completedQuests\.add/.test(questSource);
      return result(input, 'quest-runtime-transaction', ['load canonical quests=[]', 'inspect definition/runtime owner', 'advance objective', 'turnIn with reward fault'],
        { canonicalQuests: [], operationId: 'quest-op', expectedStateRevision: 3 },
        { injectedDefaultQuestCount: questSystem.getAllQuests().length, firstQuestId: firstQuest?.id, runtimeKeys, frozen: Object.isFrozen(firstQuest), hasSecondProgressionAlgorithm, nonAtomicTurnIn },
        questSystem.getAllQuests().length === 0 && runtimeKeys.length === 0 && !hasSecondProgressionAlgorithm && !nonAtomicTurnIn,
        'Quest injects defaults, mixes mutable runtime into definitions, owns a second resolver, and turns in non-atomically');
    }
    case 'request-operation-separation': {
      const harness = createHarness(input.seed);
      const attempts = [
        { requestId: `request-${input.seed}-1`, operationId: 'operation-stable', payload: { quantity: 1 } },
        { requestId: `request-${input.seed}-2`, operationId: 'operation-stable', payload: { quantity: 1 } },
        { requestId: `request-${input.seed}-3`, operationId: 'operation-stable', payload: { quantity: 2 } }
      ];
      for (const attempt of attempts) await harness.transport.execute(attempt);
      const sources = executableJavaScript();
      const gatewayFiles = sources.filter(({ source }) => /class CommandGateway/.test(source)).map(({ file }) => file);
      const authorityFiles = sources.filter(({ source }) => /AuthorityPort/.test(source)).map(({ file }) => file);
      return result(input, 'command-identity-ledger', ['request-1 operation-stable payload=A', 'request-2 operation-stable payload=A', 'request-3 operation-stable payload=B'],
        { attempts }, { gatewayFiles, authorityFiles, transport: harness.trace },
        gatewayFiles.length > 0 && authorityFiles.length > 0,
        'no unified gateway/authority operation ledger separates request attempts from business operations');
    }
    case 'projection-gap-stops-apply': {
      const sources = executableJavaScript();
      const projectionFiles = sources.filter(({ source }) => /class ProjectionStore|lastEventSequence|projectionRevision/.test(source)).map(({ file }) => file);
      return result(input, 'projection-notification-order', ['apply event sequence=4', 'apply duplicate sequence=4', 'inject gap sequence=6'],
        { projectionSequence: 3, events: [4, 4, 6], stateRevisions: [4, 4, 6] },
        { projectionFiles, actual: projectionFiles.length ? 'implementation-present' : 'no gap-aware ProjectionStore' },
        projectionFiles.length > 0,
        'state revision / notification duplicate-gap contract has no ProjectionStore implementation');
    }
    case 'clock-rng-replay': {
      const businessSources = ['src/systems/TriggerSystem.js', 'src/systems/QuestSystem.js', 'src/systems/PickupSystem.js', 'src/systems/resolvers/LootResolver.js'];
      const platformCalls = businessSources.flatMap(file => {
        const source = readOptional(file);
        return [...source.matchAll(/Date\.now\(|new Date\(|Math\.random\(/g)].map(match => ({ file, call: match[0] }));
      });
      const authoritySnapshotSources = executableJavaScript().filter(({ source }) => /rngState|logicalClock/.test(source)).map(({ file }) => file);
      const harness = createHarness(input.seed);
      const deterministicSample = [harness.clocks.logical(), harness.clocks.monotonic(), harness.clocks.wall(), harness.rng.next()];
      return result(input, 'deterministic-clock-rng', ['freeze logical/monotonic/wall clocks and RNG', 'execute command', 'snapshot/restart', 'replay'],
        { seed: input.seed, clocks: deterministicSample.slice(0, 3), rngCounter: 0 },
        { deterministicSample, platformCalls, authoritySnapshotSources },
        platformCalls.length === 0 && authoritySnapshotSources.length > 0,
        'business logic reads platform clock/RNG and authority snapshot lacks deterministic clock/RNG state');
    }
    default:
      return { triggered: false, correctPredicate: true, phase: 'unsupported', commandSequence: [], snapshot: input, actualTrace: {}, counterexample: 'unsupported probe' };
  }
}

describe('Property 1: Bug Condition - Modular Canonical Architecture and Unified Commands Satisfy the Correct Predicate', () => {
  // **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12**
  it('finds replayable pre-fix counterexamples for every architecture operation domain', async () => {
    const executions = [];
    for (let index = 0; index < PROBES.length; index++) {
      const probe = PROBES[index];
      const deterministic = makeInput(probe, FIXED_SEED + index, false);
      const generated = makeInput(probe, FIXED_SEED ^ Math.imul(index + 1, 0x9e3779b1), true);
      executions.push({ input: deterministic, observation: await executeOriginal(deterministic) });
      executions.push({ input: generated, observation: await executeOriginal(generated) });
    }

    const byPhase = new Map();
    for (const execution of executions) {
      if (!isBugCondition(execution.input, execution.observation)) continue;
      const existing = byPhase.get(execution.observation.phase);
      if (existing) {
        existing.replaySeeds.push(execution.input.seed);
        continue;
      }
      byPhase.set(execution.observation.phase, {
        kind: execution.input.kind,
        probe: execution.input.probe,
        seed: execution.input.seed,
        replaySeeds: [execution.input.seed],
        minimalCommandSequence: execution.observation.commandSequence,
        inputSnapshot: execution.observation.snapshot,
        actualTrace: execution.observation.actualTrace,
        failurePhase: execution.observation.phase,
        failedPredicate: 'expectedBehavior(result,input)',
        counterexample: execution.observation.counterexample
      });
    }

    const counterexamples = [...byPhase.values()];
    const report = `Property 1 pre-fix counterexamples (fixedSeed=${FIXED_SEED}):\n${JSON.stringify(counterexamples, null, 2)}`;
    expect(counterexamples, report).toEqual([]);
  }, 15000);
});
