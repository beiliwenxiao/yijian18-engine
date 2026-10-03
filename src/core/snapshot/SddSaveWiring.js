/************************************************************
 * YiJian18-Engine - SDD save wiring（documentProjector / snapshotTransformer 工厂）
 ************************************************************/

import { SDD_SCHEMA_VERSION, projectSnapshotToSdd } from './SddProjection.js';

/**
 * SDD 产品接线（阶段 4 收敛）：documentProjector / snapshotTransformer 只在此处定义，
 * index.html 与回归测试共用同一实现。禁止在别处复制闭包——同一语义两处实现必然分叉
 * （见 .kiro/steering/single-authority-save-document-migration.md 硬规则）。
 */

/**
 * 写端投影（SnapshotManager.capture 时调用）：旧快照 → SDD v3 文档。
 * quests/narrative 以运行时自持文档为准（questSystem.sdd / gameLoader.sddStore，
 * 与各自 serialize 同源同步）；运行时不可用时退回快照投影值。
 * @param {() => any} getScene 取当前场景实例（含 questSystem/gameLoader），可返回 null。
 * @returns {(snapshot: any) => {schemaVersion: number, document: any}}
 */
export function createRuntimeDocumentProjector(getScene) {
  return snapshot => {
    const document = projectSnapshotToSdd(snapshot);
    const scene = typeof getScene === 'function' ? getScene() : null;
    const runtimeQuests = scene?.questSystem?.sdd?.getNode('quests');
    if (runtimeQuests) document.quests = runtimeQuests;
    const runtimeNarrative = scene?.gameLoader?.sddStore?.getNode('narrative');
    if (runtimeNarrative) document.narrative = runtimeNarrative;
    return { schemaVersion: SDD_SCHEMA_VERSION, document };
  };
}

/**
 * 读端变形（SnapshotManager.restore 前调用）：带 sdd 的存档以文档节点覆盖旧链路字段
 * （同值替代——sdd 是权威源的结构声明）。quests/narrative=运行时文档节点；
 * player/ui/world=存档时文档节点（缺段判空跳过——投影对缺段写 null）。
 * 旧档无 sdd 字段时原样返回（走旧链路）。
 * @returns {(snapshot: any) => any}
 */
export function createSddSnapshotTransformer() {
  return snapshot => {
    const sdd = snapshot?.sdd;
    if (!sdd?.document) return snapshot;
    const serviceStates = snapshot?.data?.game?.authority?.serviceStates;
    if (serviceStates) {
      if (sdd.document.quests) serviceStates.quests = sdd.document.quests;
      if (sdd.document.narrative) serviceStates.campaignContent = sdd.document.narrative;
    }
    const game = snapshot?.data?.game;
    if (game) {
      if (sdd.document.player) game.player = sdd.document.player;
      if (sdd.document.ui?.tutorial) game.tutorial = sdd.document.ui.tutorial;
      if (sdd.document.ui?.dialogue) game.dialogue = sdd.document.ui.dialogue;
      if (sdd.document.world?.scene) game.scene = sdd.document.world.scene;
    }
    return snapshot;
  };
}
