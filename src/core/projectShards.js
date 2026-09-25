/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * GameProject 分片（shards）：主文件留元信息 + shards 声明，大字段拆独立 JSON。
 *
 * 声明格式（主文件 game.project.json 顶层）：
 *   "shards": { "triggers": "project/triggers.json", ... }
 *   —— 值为相对项目根目录的路径；分片内容整体替换同名字段（浅合并）。
 *
 * 加载端：mergeShardedProject(main, loadShard) → 合并后的完整 project。
 * 保存端：splitShardedProject(project) → { main, shards }，按声明路由到文件。
 * 无 shards 声明的工程走原单体加载/保存，行为完全不变。
 */

const SAFE_FIELD = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** 必须留在主文件的字段：runtime 独立加载链与服务端 closure 依赖它们。 */
const RESERVED_FIELDS = new Set([
  'shards', 'schemaVersion', 'meta', 'assetManifest', 'presentation',
  'variables', 'worldMap', 'scenes', 'integration'
]);

/** 解析主文件的 shards 声明 → [{ field, path }]；无声明返回 []，非法声明抛错。 */
export function normalizeShardDeclaration(project) {
  const shards = project?.shards;
  if (shards == null) return [];
  if (typeof shards !== 'object' || Array.isArray(shards)) {
    throw new Error('shards 必须是 { 字段: 相对路径 } 对象');
  }
  const entries = [];
  const seenPaths = new Set();
  for (const [field, value] of Object.entries(shards)) {
    if (!SAFE_FIELD.test(field)) throw new Error(`shards.${field}: 字段名不安全`);
    if (RESERVED_FIELDS.has(field)) throw new Error(`shards.${field}: 保留字段不允许分片`);
    if (typeof value !== 'string' || !value) throw new Error(`shards.${field}: 必须是相对路径字符串`);
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized.endsWith('.json') || normalized.includes('..') || normalized.startsWith('/')) {
      throw new Error(`shards.${field}: 路径不安全 ${value}`);
    }
    if (seenPaths.has(normalized)) throw new Error(`shards: 路径重复 ${normalized}`);
    seenPaths.add(normalized);
    entries.push({ field, path: normalized });
  }
  return entries;
}

export function hasShards(project) {
  return project != null && project.shards != null
    && typeof project.shards === 'object' && !Array.isArray(project.shards);
}

/**
 * 加载端：主文件 + 分片浅合并（返回新对象，不改入参）。
 * @param {Object} mainProject - 主文件解析结果
 * @param {(relPath: string) => Promise<any>} loadShard - 相对项目根目录的异步 JSON 加载器
 */
export async function mergeShardedProject(mainProject, loadShard) {
  const entries = normalizeShardDeclaration(mainProject);
  if (entries.length === 0) return mainProject;
  const merged = { ...mainProject };
  for (const { field, path } of entries) {
    merged[field] = await loadShard(path);
  }
  return merged;
}

/**
 * 保存端：把完整 project 拆成主文件内容 + 分片内容（均深拷贝）。
 * 无声明时 shards 为空对象，main 即完整 project。
 * @returns {{ main: Object, shards: Object }} shards 以分片路径为键
 */
export function splitShardedProject(project) {
  const entries = normalizeShardDeclaration(project);
  const main = { ...project };
  const shards = {};
  for (const { field, path } of entries) {
    shards[path] = structuredClone(project[field] ?? null);
    delete main[field];
  }
  return { main, shards };
}

/** 主文件里误留的分片字段名列表（保存一致性检查用）。 */
export function findShardFieldDuplication(mainProject) {
  return normalizeShardDeclaration(mainProject)
    .filter(({ field }) => mainProject[field] !== undefined)
    .map(({ field }) => field);
}
