/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { buildFactCatalog } from '../src/systems/quest/FactCatalog.js';

const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * QuestSceneConditionSync - 任务步骤顺序 ⇄ 场景出生条件（spawnWhen）联动
 *
 * 语义（与 QuestRuntime 编译器的分段规则同源）：
 *   非目标步骤由「前面最近的目标」完成事件驱动；同理，目标步骤经 mapTargets 引用的
 *   场景对象，其出生条件应门控于「该目标的前一个目标」提交的事实——前序目标完成，
 *   联动对象随之出现。首个目标前 = 无条件生成（清空 spawnWhen）。
 *   带地图引用的任意步骤（目标/动作等）统一按「数组中最近前序目标的事实」推导期望门控：
 *   目标步骤的对象须在前序目标完成后即可交互；非目标步骤的对象在其段驱动目标完成时出现。
 *
 * 安全边界（只改不改错）：
 *   - 仅重写 mapTargets 直接引用、且已存在「简单等值出生条件」的对象；
 *     逻辑标记（河流/崖底等无出生条件的锚点）永不新增条件；
 *   - 复合出生条件（gte/in/exists 等）不自动改写，仅提示手动处理；
 *   - 前序目标未提交事实（如 gather.item 目标物品）时标记「无法推导」，保持不变。
 */

/** 判定是否为可自动改写的简单等值出生条件：{blackboardKey?:'storyState', path:X, equals:true}。 */
export function isSimpleEqualityGate(spawnWhen) {
  if (!isObject(spawnWhen)) return false;
  const keys = Object.keys(spawnWhen);
  if (!keys.every(key => key === 'blackboardKey' || key === 'path' || key === 'equals')) return false;
  if (spawnWhen.equals !== true) return false;
  if (spawnWhen.blackboardKey !== undefined && text(spawnWhen.blackboardKey) !== 'storyState') return false;
  return Boolean(text(spawnWhen.path));
}

/** 事实目录索引：factId → story 写入路径清单（transaction 事实 + 项目手工登记）。 */
export function buildFactPathIndex(project = null) {
  const index = new Map();
  for (const fact of buildFactCatalog(project)) {
    if (fact?.id && Array.isArray(fact.paths) && fact.paths.length) {
      index.set(fact.id, fact.paths.map(text).filter(Boolean));
    }
  }
  return index;
}

/** 遍历场景文档的全部 placement（含所在 sceneId）。 */
export function collectPlacements(sceneDocs = []) {
  const placements = [];
  for (const scene of list(sceneDocs)) {
    if (!isObject(scene)) continue;
    for (const layer of list(scene.layers)) {
      for (const object of list(layer?.objects)) {
        if (!isObject(object) || !text(object.id)) continue;
        placements.push({ sceneId: text(scene.id), layerId: text(layer?.id), placement: object });
      }
    }
  }
  return placements;
}

/** placement 索引：`sceneId::placementId` → 条目（一次扫描，计划计算内复用）。 */
function indexPlacements(sceneDocs = []) {
  const index = new Map();
  for (const entry of collectPlacements(sceneDocs)) {
    index.set(`${entry.sceneId}::${entry.placement.id}`, entry);
  }
  return index;
}

/** 当前步骤在 steps 中的前一个 objective 步骤（无则 null）。 */
function precedingObjective(steps, stepId) {
  const index = steps.findIndex(step => step?.id === stepId);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const step = steps[cursor];
    if (step?.type === 'objective') return step;
  }
  return null;
}

/**
 * 步骤是否因重排而改变了「前序目标」关系（联动生效的前提）。
 * previousSteps 为加载时的 steps 快照；缺失（新任务/未知任务）时保守视为未移动。
 */
function changedByReorder(currentSteps, previousSteps, stepId) {
  if (!Array.isArray(previousSteps)) return false;
  const key = steps => {
    const previous = precedingObjective(steps, stepId);
    return previous ? text(previous.id) : '(none)';
  };
  return key(currentSteps) !== key(previousSteps);
}

function gateLabel(entry) {
  const kind = text(entry.placement.kind) || 'object';
  const ref = text(entry.placement.ref);
  return ref ? `${entry.placement.id}（${kind} · ${ref}）` : `${entry.placement.id}（${kind}）`;
}

/**
 * 计算单个任务的联动计划。返回：
 *   links   全部 mapTargets 联动（含一致项，供步骤卡标注）；带地图引用的目标与非目标步骤统一参与。
 *   updates 需要写回场景的项：status === 'mismatch' 且步骤的前序目标关系因重排而变化。
 *           静态不一致（策划手工门控、本会话未拖动）只在 links 里标注 ⚠，由审查栏逐项应用。
 *   orphans 未引用的门控对象，kind 二分：result = 产出型（门控于自身目标的完成事实，
 *           且与该目标已引用的施工/交互点同属 relatedObjectIds 关联簇——目标完成后的产物，无需补链）；
 *           broken = 断链（应参与流程却无步骤引用，拖动不会联动）。
 * 每项：{ stepId, stepTitle, sceneId, placementId, label, currentPath|null,
 *         expectedPath|null, clearExpected, status, changedByReorder, reason? }
 * status：match（已一致）/ mismatch（待写回）/ unresolved（前序目标无可解析事实或对象缺失）/ manual（复合条件）
 */
export function computeConditionSyncPlan({ quest, project = null, sceneDocs = [], previousSteps = null } = {}) {
  const steps = list(quest?.steps);
  const factIndex = buildFactPathIndex(project);
  const placementIndex = indexPlacements(sceneDocs);
  const links = [];
  const referencedPlacements = new Set();
  const questFactPaths = new Set();
  // 产出型识别：目标事实 → 该目标引用的放置点 + 目标标题。
  // 未引用的放置点若与同事实下已引用的施工/交互点同属 editor.relatedObjectIds 关联簇，
  // 则它是目标完成后的产物（如建成的庇护所），而非断链。
  const objectiveRefsByFact = new Map();
  const objectiveTitleByFact = new Map();
  for (const step of steps) {
    if (step?.type === 'objective') {
      const factPaths = (factIndex.get(text(step.target)) || []).map(text).filter(Boolean);
      for (const path of factPaths) {
        questFactPaths.add(path);
        if (!objectiveTitleByFact.has(path)) objectiveTitleByFact.set(path, text(step.title) || text(step.id));
        if (!objectiveRefsByFact.has(path)) objectiveRefsByFact.set(path, new Set());
      }
      for (const mapTarget of list(step.mapTargets)) {
        const refKey = `${text(mapTarget?.sceneId)}::${text(mapTarget?.targetId)}`;
        for (const path of factPaths) objectiveRefsByFact.get(path)?.add(refKey);
      }
    }
    // 统一规则：目标步骤（对象须在前序目标完成后即可交互）与非目标步骤（对象在其段
    // 驱动目标完成时出现）的期望门控，同为「数组中最近前序目标提交的事实」。
    const mapTargets = list(step.mapTargets);
    if (!mapTargets.length) continue;
    const reordered = changedByReorder(steps, previousSteps, text(step.id));
    for (const mapTarget of mapTargets) {
      const sceneId = text(mapTarget?.sceneId);
      const targetId = text(mapTarget?.targetId);
      if (!sceneId || !targetId) continue;
      referencedPlacements.add(`${sceneId}::${targetId}`);
      const found = placementIndex.get(`${sceneId}::${targetId}`) || null;
      if (!found) {
        links.push({
          stepId: text(step.id), stepTitle: text(step.title) || text(step.id),
          sceneId, placementId: targetId, label: targetId,
          currentPath: null, expectedPath: null, clearExpected: false,
          status: 'unresolved', changedByReorder: reordered, reason: '场景中未找到该对象（可能已删除）'
        });
        continue;
      }
      const spawnWhen = found.placement.spawnWhen;
      const base = {
        stepId: text(step.id),
        stepTitle: text(step.title) || text(step.id),
        sceneId,
        placementId: targetId,
        label: gateLabel(found),
        changedByReorder: reordered
      };
      if (!spawnWhen) continue; // 逻辑锚点等无出生条件的对象：不参与联动，不展示
      const currentPath = isSimpleEqualityGate(spawnWhen) ? text(spawnWhen.path) : null;
      if (!currentPath) {
        links.push({ ...base, currentPath: null, expectedPath: null, clearExpected: false, status: 'manual', reason: '复合出生条件，不自动改写' });
        continue;
      }
      const previous = precedingObjective(steps, step.id);
      if (!previous) {
        links.push({ ...base, currentPath, expectedPath: null, clearExpected: true, status: 'mismatch' });
        continue;
      }
      const paths = factIndex.get(text(previous.target)) || null;
      if (!paths) {
        links.push({
          ...base, currentPath, expectedPath: null, clearExpected: false, status: 'unresolved',
          reason: `前序目标「${text(previous.title) || text(previous.id)}」未提交可解析事实，保持不变`
        });
        continue;
      }
      const expectedPath = paths[0];
      const status = paths.includes(currentPath) ? 'match' : 'mismatch';
      links.push({
        ...base, currentPath, expectedPath, clearExpected: false, status,
        precedingStepId: text(previous.id), precedingStepTitle: text(previous.title) || text(previous.id)
      });
    }
  }
  // editor.relatedObjectIds 关联簇（按场景）：同簇对象互相视为「产出/施工」关联
  const relatedByScene = new Map();
  for (const entry of collectPlacements(sceneDocs)) {
    const clusterIds = [...new Set([
      text(entry.placement.id),
      ...list(entry.placement.editor?.relatedObjectIds).map(text).filter(Boolean)
    ])];
    if (clusterIds.length < 2) continue;
    let sceneMap = relatedByScene.get(entry.sceneId);
    if (!sceneMap) {
      sceneMap = new Map();
      relatedByScene.set(entry.sceneId, sceneMap);
    }
    for (const a of clusterIds) {
      for (const b of clusterIds) {
        if (a === b) continue;
        if (!sceneMap.has(a)) sceneMap.set(a, new Set());
        if (!sceneMap.has(b)) sceneMap.set(b, new Set());
        sceneMap.get(a).add(b);
        sceneMap.get(b).add(a);
      }
    }
  }
  const orphans = [];
  for (const entry of collectPlacements(sceneDocs)) {
    const spawnWhen = entry.placement.spawnWhen;
    if (!isSimpleEqualityGate(spawnWhen)) continue;
    const path = text(spawnWhen.path);
    if (!questFactPaths.has(path)) continue;
    const placementId = text(entry.placement.id);
    if (referencedPlacements.has(`${entry.sceneId}::${placementId}`)) continue;
    // 分类：与该事实目标已引用的放置点同簇 → 产出型（目标完成后的产物）；否则 → 断链
    let kind = 'broken';
    let producingStepTitle = null;
    const relatedMap = relatedByScene.get(entry.sceneId) || null;
    if (relatedMap) {
      for (const refKey of objectiveRefsByFact.get(path) || []) {
        const separatorIndex = refKey.indexOf('::');
        const refScene = refKey.slice(0, separatorIndex);
        const refId = refKey.slice(separatorIndex + 2);
        if (refScene !== entry.sceneId) continue;
        if (relatedMap.get(refId)?.has(placementId) || relatedMap.get(placementId)?.has(refId)) {
          kind = 'result';
          producingStepTitle = objectiveTitleByFact.get(path) || null;
          break;
        }
      }
    }
    orphans.push({
      sceneId: entry.sceneId,
      placementId,
      factPath: path,
      label: gateLabel(entry),
      kind,
      producingStepTitle
    });
  }
  return {
    links,
    updates: links.filter(link => link.status === 'mismatch' && link.changedByReorder === true),
    orphans
  };
}

/**
 * 将计划写回场景文档（深拷贝后变异，不触碰入参）。
 * 返回 { sceneDocs: {sceneId: doc}, sceneIds: [已变更场景] }，配合 saveSceneDocument 逐场景提交。
 */
export function applyConditionSyncPlan(sceneDocs = [], updates = []) {
  const cloned = list(sceneDocs).filter(isObject).map(scene => structuredClone(scene));
  const placementIndex = indexPlacements(cloned);
  const changed = new Set();
  for (const update of list(updates)) {
    const found = placementIndex.get(`${text(update.sceneId)}::${text(update.placementId)}`) || null;
    if (!found) continue;
    const placement = found.placement;
    if (update.clearExpected === true) delete placement.spawnWhen;
    else if (text(update.expectedPath)) {
      placement.spawnWhen = { blackboardKey: 'storyState', equals: true, path: text(update.expectedPath) };
    } else continue;
    changed.add(found.sceneId);
  }
  const sceneDocsById = {};
  for (const scene of cloned) sceneDocsById[text(scene.id)] = scene;
  return { sceneDocs: sceneDocsById, sceneIds: [...changed] };
}

/** 计划签名：内容变更后自动重新展示审查栏（忽略状态失效）。覆盖 updates / 静态不一致 / orphans 三组。 */
export function conditionSyncPlanSignature(plan = null) {
  if (!plan) return '';
  const statics = list(plan.links).filter(link => link.status === 'mismatch' && link.changedByReorder !== true)
    .map(link => [link.sceneId, link.placementId, link.currentPath, link.expectedPath, link.clearExpected]);
  return JSON.stringify({
    updates: list(plan.updates).map(update => [
      update.sceneId, update.placementId, update.currentPath, update.expectedPath, update.clearExpected
    ]),
    statics,
    orphans: list(plan.orphans).map(orphan => [orphan.sceneId, orphan.placementId, orphan.factPath, orphan.kind])
  });
}

export default {
  isSimpleEqualityGate,
  buildFactPathIndex,
  collectPlacements,
  computeConditionSyncPlan,
  applyConditionSyncPlan,
  conditionSyncPlanSignature
};
