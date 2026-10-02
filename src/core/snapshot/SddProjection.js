/************************************************************
 * YiJian18-Engine - SDD v3 projection (legacy snapshot ⇄ single document)
 ************************************************************/

/**
 * SDD v3 投影：把现有三层嵌套快照（data.game）与单一权威文档互转的**纯函数**。
 *
 * 阶段 1 纪律（见 .kiro/steering/single-authority-save-document-migration.md）：
 * - 只做形状重排，不改任何字段语义；缺段容忍（旧档/部分段 undefined）。
 * - 双写不双读：本投影仅用于等价性校验与 migrate 链，产品读写仍走旧链路。
 * - 等价性契约：projectSddToSnapshot(projectSnapshotToSdd(snapshot)) 与原快照
 *   在语义字段上深相等（test/saveSystemRegression.test.js 的随机往返钉住）。
 */

export const SDD_SCHEMA_VERSION = 3;

const cloneData = value => value == null ? value : JSON.parse(JSON.stringify(value));

/** 语义深相等：键序无关，undefined 与「键缺失」视为等价（双写校验与测试复用）。 */
export function sddSemanticEquals(left, right) {
  return semanticDeepEquals(left, right);
}

function semanticDeepEquals(left, right) {
  if (left === right) return true;
  if (left === undefined || right === undefined) return left === right;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => semanticDeepEquals(item, right[index]));
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left).filter(key => left[key] !== undefined);
    const rightKeys = Object.keys(right).filter(key => right[key] !== undefined);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(key => key in right && semanticDeepEquals(left[key], right[key]));
  }
  // NaN 语义相等（存档中 NaN 本身非法，这里仅防御 JSON 往返后的边界）
  return Number.isNaN(left) && Number.isNaN(right);
}

/**
 * 旧快照（data.game 形状或完整 snapshot）→ SDD v3 文档。
 * 输入完整 snapshot 时取 data.game；输入 game 段时直接投影。
 */
export function projectSnapshotToSdd(snapshot) {
  const game = snapshot?.data?.game && typeof snapshot.data.game === 'object'
    ? snapshot.data.game
    : (snapshot && typeof snapshot === 'object' ? snapshot : {});
  const authority = game.authority && typeof game.authority === 'object' ? game.authority : {};
  const serviceStates = authority.serviceStates && typeof authority.serviceStates === 'object'
    ? authority.serviceStates
    : {};
  return {
    sddSchemaVersion: SDD_SCHEMA_VERSION,
    campaignId: game.campaignId ?? null,
    gameSchemaVersion: game.schemaVersion ?? null,
    currentSceneId: game.currentSceneId ?? null,
    player: cloneData(game.player) ?? null,
    ui: {
      tutorial: cloneData(game.tutorial) ?? null,
      dialogue: cloneData(game.dialogue) ?? null
    },
    quests: cloneData(serviceStates.quests) ?? null,
    narrative: cloneData(serviceStates.campaignContent) ?? null,
    eventJournal: cloneData(serviceStates.eventJournal) ?? null,
    clock: {
      snapshotSchemaVersion: authority.snapshotSchemaVersion ?? null,
      definitionRevision: authority.definitionRevision ?? null,
      stateRevisions: cloneData(authority.stateRevisions) ?? null,
      lastEventSequence: authority.lastEventSequence ?? null,
      logicalClock: cloneData(authority.logicalClock) ?? null,
      rngState: cloneData(authority.rngState) ?? null,
      operationLedger: cloneData(authority.operationLedger) ?? null
    },
    world: {
      currentSceneId: game.currentSceneId ?? null,
      scene: cloneData(game.scene) ?? null
    }
  };
}

/** SDD v3 文档 → 旧 data.game 形状（migrate 链读取用）。 */
export function projectSddToSnapshot(document) {
  const doc = document && typeof document === 'object' ? document : {};
  const clock = doc.clock && typeof doc.clock === 'object' ? doc.clock : {};
  const narrative = doc.narrative && typeof doc.narrative === 'object' ? doc.narrative : null;
  const quests = doc.quests && typeof doc.quests === 'object' ? doc.quests : null;
  const eventJournal = doc.eventJournal ?? null;
  const world = doc.world && typeof doc.world === 'object' ? doc.world : {};
  const currentSceneId = doc.currentSceneId ?? world.currentSceneId ?? null;
  const hasAuthority = clock.snapshotSchemaVersion != null || narrative != null || quests != null;
  const game = {
    ...(doc.campaignId != null ? { campaignId: doc.campaignId } : {}),
    ...(doc.gameSchemaVersion != null ? { schemaVersion: doc.gameSchemaVersion } : {}),
    ...(currentSceneId != null ? { currentSceneId } : {}),
    ...(doc.player != null ? { player: cloneData(doc.player) } : {}),
    ...(doc.ui?.tutorial != null ? { tutorial: cloneData(doc.ui.tutorial) } : {}),
    ...(doc.ui?.dialogue != null ? { dialogue: cloneData(doc.ui.dialogue) } : {}),
    ...(hasAuthority ? {
      authority: {
        ...(clock.snapshotSchemaVersion != null ? { snapshotSchemaVersion: clock.snapshotSchemaVersion } : {}),
        ...(clock.definitionRevision != null ? { definitionRevision: clock.definitionRevision } : {}),
        ...(clock.stateRevisions != null ? { stateRevisions: cloneData(clock.stateRevisions) } : {}),
        ...(clock.lastEventSequence != null ? { lastEventSequence: clock.lastEventSequence } : {}),
        ...(clock.logicalClock != null ? { logicalClock: cloneData(clock.logicalClock) } : {}),
        ...(clock.rngState != null ? { rngState: cloneData(clock.rngState) } : {}),
        ...(clock.operationLedger != null ? { operationLedger: cloneData(clock.operationLedger) } : {}),
        serviceStates: {
          ...(eventJournal != null ? { eventJournal: cloneData(eventJournal) } : {}),
          ...(quests != null ? { quests: cloneData(quests) } : {}),
          ...(narrative != null ? { campaignContent: cloneData(narrative) } : {})
        }
      }
    } : {}),
    ...(world.scene != null ? { scene: cloneData(world.scene) } : {})
  };
  return game;
}
