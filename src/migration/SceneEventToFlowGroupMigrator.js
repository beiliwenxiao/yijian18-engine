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

/**
 * SceneEvent → FlowGroup 的归一化与一键迁移工具。
 *
 * 两种用法：
 *   1) GameLoader 启动时的 normalizeProject：只做内存内双读兼容，不修改 JSON。
 *   2) Editor 工具条的「一键迁移」：修改 project 永久删除旧字段。
 */

const asList = v => Array.isArray(v) ? v : [];
const text = v => typeof v === 'string' ? v.trim() : '';

/**
 * 单条旧 SceneEventDefinition → FlowGroupDefinition（100% 字段兼容）。
 * 保留原始 id / order / scope / dependsOn / activeWhen / completionWhen。
 */
export function migrateSceneEventToFlowGroup(sceneEvent) {
  if (!sceneEvent || typeof sceneEvent !== 'object') return null;
  const fg = {
    id: text(sceneEvent.id) || '',
    name: text(sceneEvent.name) || text(sceneEvent.id) || '未命名 FlowGroup',
    scope: {
      sceneIds: [...new Set(asList(sceneEvent.scope?.sceneIds ?? sceneEvent.sceneIds).map(text).filter(Boolean))]
    },
    order: Number.isInteger(sceneEvent.order) ? sceneEvent.order : 0,
    dependsOn: [...new Set(asList(sceneEvent.dependsOn).map(text).filter(Boolean))],
    control: {
      autoActivate: true,
      autoComplete: true,
      repeatable: false,
      maxProgress: null,
      notifyProgressEvery: 10
    }
  };
  if (text(sceneEvent.description)) fg.description = sceneEvent.description;
  if (sceneEvent.activeWhen && typeof sceneEvent.activeWhen === 'object') {
    fg.activeWhen = normalizeLegacyCondition(sceneEvent.activeWhen);
  }
  if (sceneEvent.completionWhen && typeof sceneEvent.completionWhen === 'object') {
    fg.completionWhen = normalizeLegacyCondition(sceneEvent.completionWhen);
  }
  if (sceneEvent.metadata && typeof sceneEvent.metadata === 'object') {
    fg.metadata = { ...sceneEvent.metadata, migratedFrom: 'sceneEvent' };
  } else {
    fg.metadata = { migratedFrom: 'sceneEvent' };
  }
  return fg;
}

/**
 * 旧条件格式（SceneEvent 编辑器里手写的黑板条件）→ 统一的 CompositeCondition 单叶子。
 * 支持:
 *   { blackboardKey, path, equals }
 *   { blackboardKey, path, gte }
 *   { blackboardKey, path, lte }
 *   { blackboardKey, path, value, operator }
 * 如果已经是 CompositeCondition（operator + children）直接原样返回。
 */
export function normalizeLegacyCondition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.operator === 'string' && Array.isArray(raw.children)) {
    // 已是新格式，仅确保 children 中的 leaf 也同样归一化
    return {
      operator: raw.operator,
      children: raw.children.map(c => {
        if (c && typeof c === 'object' && c.type === 'leaf') return c;
        return normalizeLegacyCondition(c);
      })
    };
  }
  const blackboardKey = text(raw.blackboardKey) || 'storyState';
  const path = text(raw.path) || '';
  let operator = 'equals';
  let value = true;
  if ('equals' in raw) { value = raw.equals; operator = 'equals'; }
  else if ('notEquals' in raw) { value = raw.notEquals; operator = 'notEquals'; }
  else if ('gte' in raw) { value = raw.gte; operator = 'gte'; }
  else if ('lte' in raw) { value = raw.lte; operator = 'lte'; }
  else if ('in' in raw) { value = raw.in; operator = 'in'; }
  else if ('exists' in raw) { value = raw.exists; operator = 'exists'; }
  else if ('value' in raw) {
    value = raw.value;
    if (text(raw.operator)) operator = raw.operator;
  }
  return {
    operator: 'AND',
    children: [{
      type: 'leaf',
      conditionType: 'variable',
      config: { blackboardKey, path, operator, value }
    }]
  };
}

/**
 * 读取 Trigger/Tutorial/Binding 的 flowGroupId，不存在时回退到旧 sceneEventId。
 * 不修改原对象（纯函数）。
 */
export function resolveFlowGroupId(obj) {
  if (!obj) return '';
  const fromFg = text(obj.flowGroupId);
  if (fromFg) return fromFg;
  return text(obj.sceneEventId);
}

/**
 * Project 启动时的内存归一化（双读兼容，不修改源 JSON）。
 * - 如果项目只有 sceneEvents：在内存补齐 flowGroups
 * - 如果 Trigger/Tutorial 只有 sceneEventId：补齐 flowGroupId（仅内存副本）
 * - 不会写回 project.sceneEvents = null（一键迁移另做）
 */
export function normalizeProjectForRuntime(project) {
  if (!project || typeof project !== 'object') return project;
  const copy = { ...project };

  // 1) flowGroups：全 Trigger 化后不再从 sceneEvents 生成组。
  //    只保证 flowGroups 是数组（内容通常为空，trigger/tutorial 的 flowGroupId 仅为兼容标签）。
  if (!Array.isArray(copy.flowGroups)) {
    copy.flowGroups = [];
  }

  // 2) Trigger.flowGroupId ← sceneEventId（内存补齐）
  if (Array.isArray(copy.triggers) && copy.triggers.length > 0) {
    copy.triggers = copy.triggers.map(t => {
      if (!t) return t;
      const fgid = resolveFlowGroupId(t);
      if (!fgid || (t.flowGroupId && t.flowGroupId === fgid)) return t;
      return { ...t, flowGroupId: fgid };
    });
  }

  // 3) Tutorial.flowGroupId ← sceneEventId
  if (Array.isArray(copy.tutorials) && copy.tutorials.length > 0) {
    copy.tutorials = copy.tutorials.map(t => {
      if (!t) return t;
      const fgid = resolveFlowGroupId(t);
      if (!fgid || (t.flowGroupId && t.flowGroupId === fgid)) return t;
      return { ...t, flowGroupId: fgid };
    });
  }

  // 4) scene.bindings 中 trigger 类型的 flowGroupId ← sceneEventId
  if (copy.scenes && typeof copy.scenes === 'object') {
    copy.scenes = { ...copy.scenes };
    for (const [sceneId, sceneDoc] of Object.entries(copy.scenes)) {
      if (!sceneDoc || !Array.isArray(sceneDoc.layers)) continue;
      let changed = false;
      const newLayers = sceneDoc.layers.map(layer => {
        if (!layer || !Array.isArray(layer.objects)) return layer;
        const newObjects = layer.objects.map(obj => {
          if (obj?.type !== 'trigger') return obj;
          const fgid = resolveFlowGroupId(obj);
          if (!fgid || (obj.flowGroupId && obj.flowGroupId === fgid)) return obj;
          changed = true;
          return { ...obj, flowGroupId: fgid };
        });
        if (!changed) return layer;
        return { ...layer, objects: newObjects };
      });
      if (changed) copy.scenes[sceneId] = { ...sceneDoc, layers: newLayers };
    }
  }

  return copy;
}

/**
 * Editor 工具条：一键迁移。直接修改 project 并返回迁移统计。
 * 执行完后旧字段 sceneEvents / (trigger|tutorial).sceneEventId / binding.sceneEventId 都被删除。
 *
 * 返回:
 *   { ok: true, stats: { flowGroups, triggers, tutorials, bindings, removedLegacyFields: true } }
 *   { ok: false, errors: string[] }
 */
export function migrateProjectPermanently(project) {
  const errors = [];
  if (!project || typeof project !== 'object') {
    return { ok: false, errors: ['project 不是对象'] };
  }
  const stats = { flowGroups: 0, triggers: 0, tutorials: 0, bindings: 0, removedLegacyFields: false };

  // Step 1: flowGroups
  if (Array.isArray(project.sceneEvents) && project.sceneEvents.length > 0) {
    if (Array.isArray(project.flowGroups) && project.flowGroups.length > 0) {
      errors.push('project 同时存在 sceneEvents 和 flowGroups，拒绝迁移以避免覆盖。请手动删除旧字段 sceneEvents 后重试。');
      return { ok: false, errors };
    }
    project.flowGroups = project.sceneEvents.map(migrateSceneEventToFlowGroup).filter(Boolean);
    stats.flowGroups = project.flowGroups.length;
    delete project.sceneEvents;
  } else if (!Array.isArray(project.flowGroups)) {
    project.flowGroups = [];
  } else {
    stats.flowGroups = project.flowGroups.length;
  }

  // Step 2: Trigger
  if (Array.isArray(project.triggers)) {
    for (const t of project.triggers) {
      if (!t) continue;
      const fgid = resolveFlowGroupId(t);
      if (fgid) t.flowGroupId = fgid;
      delete t.sceneEventId;
      stats.triggers += 1;
    }
  }

  // Step 3: Tutorial
  if (Array.isArray(project.tutorials)) {
    for (const t of project.tutorials) {
      if (!t) continue;
      const fgid = resolveFlowGroupId(t);
      if (fgid) t.flowGroupId = fgid;
      delete t.sceneEventId;
      stats.tutorials += 1;
    }
  }

  // Step 4: Scene bindings
  if (project.scenes && typeof project.scenes === 'object') {
    for (const sceneDoc of Object.values(project.scenes)) {
      if (!sceneDoc || !Array.isArray(sceneDoc.layers)) continue;
      for (const layer of sceneDoc.layers) {
        if (!layer || !Array.isArray(layer.objects)) continue;
        for (const obj of layer.objects) {
          if (obj?.type !== 'trigger') continue;
          const fgid = resolveFlowGroupId(obj);
          if (fgid) obj.flowGroupId = fgid;
          delete obj.sceneEventId;
          stats.bindings += 1;
        }
      }
    }
  }

  stats.removedLegacyFields = true;
  return { ok: true, stats, errors: [] };
}

export default {
  migrateSceneEventToFlowGroup,
  normalizeLegacyCondition,
  resolveFlowGroupId,
  normalizeProjectForRuntime,
  migrateProjectPermanently
};
