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
 *   links   全部 mapTargets 联动（含一致项，供步骤卡标注）；
 *   updates 需要写回场景的项：status === 'mismatch' 且步骤的前序目标关系因重排而变化。
 *           静态不一致（策划手工门控、本会话未拖动）只在 links 里标注 ⚠，不进入自动改写。
 * 每项：{ stepId, stepTitle, sceneId, placementId, label, currentPath|null,
 *         expectedPath|null, clearExpected, status, changedByReorder, reason? }
 * status：match（已一致）/ mismatch（待写回）/ unresolved（前序目标无可解析事实）/ manual（复合条件）
 */
export function computeConditionSyncPlan({ quest, project = null, sceneDocs = [], previousSteps = null } = {}) {
  const steps = list(quest?.steps);
  const factIndex = buildFactPathIndex(project);
  const placementIndex = indexPlacements(sceneDocs);
  const links = [];
  for (const step of steps) {
    if (step?.type !== 'objective') continue;
    const reordered = changedByReorder(steps, previousSteps, text(step.id));
    for (const mapTarget of list(step.mapTargets)) {
      const sceneId = text(mapTarget?.sceneId);
      const targetId = text(mapTarget?.targetId);
      if (!sceneId || !targetId) continue;
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
  return {
    links,
    updates: links.filter(link => link.status === 'mismatch' && link.changedByReorder === true)
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

/** 计划签名：内容变更后自动重新展示审查栏（忽略状态失效）。 */
export function conditionSyncPlanSignature(plan = null) {
  if (!plan) return '';
  return JSON.stringify(plan.updates.map(update => [
    update.sceneId, update.placementId, update.currentPath, update.expectedPath, update.clearExpected
  ]));
}

export default {
  isSimpleEqualityGate,
  buildFactPathIndex,
  collectPlacements,
  computeConditionSyncPlan,
  applyConditionSyncPlan,
  conditionSyncPlanSignature
};
