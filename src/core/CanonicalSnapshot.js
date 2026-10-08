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

const isObject = value => value !== null && typeof value === 'object';

export function cloneCanonicalValue(value, seen = new WeakMap()) {
  if (!isObject(value)) return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    value.forEach(item => copy.push(cloneCanonicalValue(item, seen)));
    return copy;
  }
  const copy = {};
  seen.set(value, copy);
  for (const [key, child] of Object.entries(value)) {
    copy[key] = cloneCanonicalValue(child, seen);
  }
  return copy;
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (!isObject(value) || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

const list = value => Array.isArray(value) ? value : [];

/** Canonical project 中具有稳定 ID、可由仓库查询的定义集合。 */
export function collectDefinitionCollections(project) {
  const collections = {};
  const add = (kind, values) => {
    if (!Array.isArray(values)) return;
    collections[kind] = [...(collections[kind] || []), ...values];
  };
  const hasDeclaredDefinition = (kind, id) => typeof id === 'string'
    && list(project?.definitionCollections?.[kind]).some(definition => definition?.id === id);

  for (const [kind, values] of Object.entries(project?.library || {})) add(kind, values);
  for (const kind of ['scenes', 'dialogues', 'quests', 'triggers', 'tutorials', 'rescues', 'battles', 'endings', 'scenarios', 'commands', 'actions']) {
    add(kind, project?.[kind]);
  }
  // Endings remain authored in the project extension file but participate in the
  // same immutable definition snapshot as top-level definitions. An explicit
  // collection with the same stable ID is already the canonical owner.
  const extensionEndings = project?.extensions?.endings;
  if (!Array.isArray(project?.endings)
    && isObject(extensionEndings)
    && !hasDeclaredDefinition('endings', extensionEndings.id)) {
    add('endings', [extensionEndings]);
  }
  add('skills', Array.isArray(project?.progression?.skills?.skills)
    ? project.progression.skills.skills
    : (Array.isArray(project?.progression?.skills) ? project.progression.skills : null));
  add('progressionGraphs', project?.progression?.graphs);
  add('constructions', project?.construction?.definitions);

  const declared = project?.definitionCollections;
  if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
    for (const [kind, values] of Object.entries(declared)) add(kind, values);
  }
  return deepFreeze(collections);
}

export function normalizeRuntimeDebugMode(value) {
  return value === true || value === 1 || value === '1';
}

function runtimeConfigFromProject(project, revision) {
  return {
    definitionRevision: revision,
    debug: normalizeRuntimeDebugMode(project.system?.debug),
    schemaVersion: project.schemaVersion,
    meta: project.meta || null,
    assetManifest: project.assetManifest || null,
    presentation: project.presentation || null,
    extensions: project.extensions || null,
    progression: project.progression || null,
    construction: project.construction || null,
    variables: project.variables || {},
    system: project.system || null,
    scenes: project.scenes || [],
    battles: project.battles || [],
    rescues: project.rescues || [],
    dialogues: project.dialogues || [],
    quests: project.quests || [],
    triggers: project.triggers || [],
    tutorials: project.tutorials || [],
    worldMap: project.worldMap || null,
    integration: project.integration || null
  };
}

/** 不含可变运行态的只读运行配置视图。 */
export class RuntimeConfigSnapshot {
  constructor(project, definitionRevision) {
    Object.assign(this, runtimeConfigFromProject(project, definitionRevision));
    deepFreeze(this);
  }
}

/** 完整校验、canonicalize 后才可创建的不可变配置事实源。 */
export class CanonicalSnapshot {
  constructor(project, { revision = 1 } = {}) {
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      throw new TypeError('CanonicalSnapshot requires a canonical project object');
    }
    if ((!Number.isInteger(revision) || revision < 0) && (typeof revision !== 'string' || !revision)) {
      throw new TypeError('CanonicalSnapshot revision must be a non-negative integer or non-empty string');
    }
    const canonicalProject = deepFreeze(cloneCanonicalValue(project));
    this.revision = revision;
    this.definitionRevision = revision;
    this.schemaVersion = canonicalProject.schemaVersion;
    this.project = canonicalProject;
    this.definitions = collectDefinitionCollections(canonicalProject);
    this.runtimeConfig = new RuntimeConfigSnapshot(canonicalProject, revision);
    Object.freeze(this);
  }

  static fromProject(project, options = {}) {
    return new CanonicalSnapshot(project, options);
  }

  getDefinitions(kind) {
    return this.definitions[kind] || Object.freeze([]);
  }
}

export default CanonicalSnapshot;
