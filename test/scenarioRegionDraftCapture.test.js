import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function extractMethod(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`${signature} not found`);
  // 签名参数列表自带 {}（如 ({ includeAuthority } = {})），方法体开括号固定为签名末尾的 '{'。
  if (!signature.endsWith('{')) throw new Error('signature must end with the body opening brace');
  let depth = 0;
  let end = -1;
  for (let index = start + signature.length - 1; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) { end = index + 1; break; }
  }
  if (end < 0) throw new Error(`${signature} is incomplete`);
  return source.slice(start, end);
}

/** 直接从场景源码提取 captureSaveState，避免引入整套 Scene 依赖图。 */
function loadCaptureSaveState() {
  const source = read('example/sanguo_zhangjiao/scenes/BaseGameSceneSetup.js');
  const methodSource = extractMethod(source, '  captureSaveState({ includeAuthority = true } = {}) {');
  const factory = new Function(
    'CAMPAIGN_ID',
    'SAVE_SCHEMA_VERSION',
    `return class ObservedCaptureSaveState {\n${methodSource}\n}`
  );
  const Observed = factory('sanguo-zhangjiao-s01-s14', 5);
  return (fakeThis, args) => Reflect.apply(Observed.prototype.captureSaveState, fakeThis, args);
}

function createFakeScene({ ledgerRecords = [] } = {}) {
  const serializeCalls = [];
  return {
    serializeCalls,
    playerEntity: {
      id: 'player-1',
      getComponent: key => {
        if (key === 'transform') {
          return { position: { x: 10, y: 20 }, rotation: 0, scale: { x: 1, y: 1 }, floorId: 'ground' };
        }
        if (key === 'stats') return { hp: 100, maxHp: 100 };
        if (key === 'name') return { name: '张角', visible: true, color: '#ffffff' };
        return null;
      }
    },
    currentSceneId: 'S01',
    sceneRuntime: {
      operationLedger: { snapshot: () => ({ entries: [] }) },
      authoritySnapshotService: { capture: () => ({ authority: true }) }
    },
    gameLoader: {
      triggerSystem: { ledger: { all: () => ledgerRecords } },
      serialize: (...args) => {
        serializeCalls.push(args);
        return { blackboard: {}, triggers: { version: 1, records: [] } };
      }
    },
    captureSceneSaveState: () => ({ scene: true }),
    validateSaveState: () => ({ ok: true, errors: [] })
  };
}

const runningRecord = {
  triggerId: 'trg_s01_enter_shelter',
  definitionRevision: 1,
  eventId: 'evt:run:0000000170',
  operationId: 'evt:run:0000000170:trigger:trg_s01_enter_shelter:step:enter-shelter',
  fingerprint: 'fp-1',
  status: 'running',
  actionIndex: 0,
  result: null,
  startedAt: 1,
  finishedAt: null
};

describe('BaseGameSceneSetup.captureSaveState 运行中 Trigger 守卫契约', () => {
  it('产品存档（includeAuthority=true）在存在运行中 Trigger 时拒绝捕获', () => {
    const capture = loadCaptureSaveState();
    const fakeScene = createFakeScene({ ledgerRecords: [runningRecord] });
    let thrown = null;
    try {
      capture(fakeScene, [{ includeAuthority: true }]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('scenarioExecutionBusy');
    expect(thrown.triggerIds).toEqual(['trg_s01_enter_shelter']);
  });

  it('跨 Region 回滚草稿（includeAuthority=false）由发起切区的 Trigger 同步捕获，运行中 Trigger 必须放行', () => {
    const capture = loadCaptureSaveState();
    const fakeScene = createFakeScene({ ledgerRecords: [runningRecord] });
    const snapshot = capture(fakeScene, [{ includeAuthority: false }]);
    expect(snapshot.currentSceneId).toBe('S01');
    expect(snapshot.content).toEqual({ blackboard: {}, triggers: { version: 1, records: [] } });
    expect(snapshot.authority).toBeUndefined();
    expect(fakeScene.serializeCalls).toHaveLength(1);
  });

  it('无运行中 Trigger 时产品存档正常捕获 Authority 快照且不携带 content', () => {
    const capture = loadCaptureSaveState();
    const fakeScene = createFakeScene({ ledgerRecords: [{ ...runningRecord, status: 'succeeded', result: { ok: true } }] });
    const snapshot = capture(fakeScene, [{ includeAuthority: true }]);
    expect(snapshot.authority).toEqual({ authority: true });
    expect(snapshot.content).toBeUndefined();
    expect(fakeScene.serializeCalls).toHaveLength(0);
  });

  it('无运行中 Trigger 时回滚草稿正常携带 content', () => {
    const capture = loadCaptureSaveState();
    const fakeScene = createFakeScene();
    const snapshot = capture(fakeScene, [{ includeAuthority: false }]);
    expect(snapshot.content).toEqual({ blackboard: {}, triggers: { version: 1, records: [] } });
    expect(snapshot.authority).toBeUndefined();
  });
});
