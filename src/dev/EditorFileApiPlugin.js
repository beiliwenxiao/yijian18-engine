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

import fs from 'fs';
import path from 'path';
import { AtomicDiskAdapter } from './AtomicDiskAdapter.js';
import { CanonicalCandidatePipeline } from '../core/validation/CanonicalCandidatePipeline.js';
import { CandidateRuleValidator } from '../core/validation/CandidateRuleValidator.js';
import { createContentValidator } from '../core/validation/ContentSchemas.js';
import { CanonicalSceneValidator } from '../core/scene/CanonicalSceneValidation.js';
import { prepareSharedAtlasTransaction } from './sharedAtlasTransaction.js';
import { prepareLibraryItemImageTransaction } from './LibraryItemImageTransaction.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function reply(res, status, value) {
  res.statusCode = status;
  for (const [name, content] of Object.entries(JSON_HEADERS)) res.setHeader(name, content);
  res.end(JSON.stringify(value));
}

function resolveInside(root, relativePath) {
  const target = path.resolve(root, String(relativePath || ''));
  const relative = path.relative(root, target);
  if (!relative || relative === '.' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('路径越权'), { statusCode: 403 });
  }
  return target;
}

function normalizeRelative(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 22 * 1024 * 1024) reject(Object.assign(new Error('请求体过大'), { statusCode: 413 }));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(Object.assign(error, { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function canonicalInfo(projectPath) {
  const normalized = normalizeRelative(projectPath);
  if (!normalized.endsWith('/game.project.json')) throw Object.assign(new Error('projectPath 无效'), { statusCode: 400 });
  const root = normalized.slice(0, -'/game.project.json'.length);
  return { projectPath: normalized, projectRoot: root, sceneRoot: `${root}/assets/scenes/` };
}

function isCanonicalPath(filePath, allowedProjects) {
  const normalized = normalizeRelative(filePath);
  return allowedProjects.some(projectPath => {
    const info = canonicalInfo(projectPath);
    return normalized === info.projectPath || normalized.startsWith(info.sceneRoot);
  });
}

function isSharedAtlasAssetPath(filePath, allowedProjects) {
  const normalized = normalizeRelative(filePath);
  return allowedProjects.some(projectPath => {
    const info = canonicalInfo(projectPath);
    return normalized === `${info.projectRoot}/config/atlases.json`
      || normalized === `${info.projectRoot}/assets/manifests/assets.json`;
  });
}

function finalContent(repoRoot, changes, relativePath) {
  const normalized = normalizeRelative(relativePath);
  let content = fs.existsSync(path.resolve(repoRoot, normalized))
    ? fs.readFileSync(path.resolve(repoRoot, normalized), 'utf8')
    : null;
  for (const change of changes) {
    const target = normalizeRelative(change.path || change.to);
    const source = normalizeRelative(change.from);
    if (change.operation === 'rename' && source === normalized) content = null;
    if (target !== normalized) continue;
    if (change.operation === 'delete') content = null;
    else if (change.operation === 'rename' && change.content === undefined) {
      content = fs.readFileSync(path.resolve(repoRoot, source), 'utf8');
    } else content = String(change.content);
  }
  return content;
}

function validationFailure(errors, message = 'canonical 候选校验失败') {
  return Object.assign(new Error(message), { statusCode: 422, errors });
}

function validateCanonicalChangeSet(repoRoot, projectPath, changes) {
  const info = canonicalInfo(projectPath);
  const projectText = finalContent(repoRoot, changes, info.projectPath);
  if (projectText == null) throw validationFailure([{ path: '', category: 'missing', reason: '项目文件不得删除' }]);

  const contentValidator = createContentValidator();
  const pipeline = new CanonicalCandidatePipeline({
    contentValidator,
    ruleValidator: new CandidateRuleValidator({ contentValidator })
  });
  const projectResult = pipeline.process(projectText, { schemaId: 'gameProject', source: info.projectPath });
  if (!projectResult.ok) throw validationFailure(projectResult.errors);
  const project = projectResult.value;
  const currentProjectText = fs.readFileSync(path.resolve(repoRoot, info.projectPath), 'utf8');
  const currentProject = JSON.parse(currentProjectText);
  const projectIds = new Set([
    ...(currentProject.scenes || []).map(scene => scene?.id).filter(Boolean),
    ...(project.scenes || []).map(scene => scene?.id).filter(Boolean)
  ]);
  const finalProjectIds = new Set((project.scenes || []).map(scene => scene?.id).filter(Boolean));

  for (const change of changes) {
    for (const candidate of [change.path || change.to, change.from].filter(Boolean)) {
      const normalized = normalizeRelative(candidate);
      if (normalized === info.projectPath || normalized === `${info.sceneRoot}_scene_order.json`) continue;
      if (!normalized.startsWith(info.sceneRoot) || !normalized.endsWith('.json')) {
        throw Object.assign(new Error(`非当前项目 canonical JSON 路径: ${normalized}`), { statusCode: 403 });
      }
      const sceneId = path.posix.basename(normalized, '.json');
      if (!projectIds.has(sceneId)) {
        throw Object.assign(new Error(`场景路径不在当前项目 closure: ${sceneId}`), { statusCode: 403 });
      }
    }
  }

  const sceneValidator = new CanonicalSceneValidator();
  const orderPath = `${info.sceneRoot}_scene_order.json`;
  const orderText = finalContent(repoRoot, changes, orderPath);
  if (orderText == null) throw validationFailure([{ path: '', category: 'missing', reason: '场景列表不得删除' }]);
  const orderResult = sceneValidator.validateSceneOrder(orderText, { source: orderPath, project });
  if (!orderResult.ok) throw validationFailure(orderResult.errors);
  const orderIds = Object.keys(orderResult.value.scenes || {});
  const closureErrors = orderIds.filter(id => !finalProjectIds.has(id)).map(id => ({
    path: `scenes.${id}`, category: 'referenceFailed', reason: `场景列表 ID 未在项目登记: ${id}`
  }));
  if (closureErrors.length) throw validationFailure(closureErrors);

  const sceneValues = new Map();
  for (const sceneId of orderIds) {
    const scenePath = `${info.sceneRoot}${sceneId}.json`;
    const sceneText = finalContent(repoRoot, changes, scenePath);
    if (sceneText == null) throw validationFailure([{ path: `scenes.${sceneId}`, category: 'missing', reason: `缺少场景文件 ${sceneId}` }]);
    const result = sceneValidator.validateScene(sceneText, { source: scenePath, sceneId, project });
    if (!result.ok) throw validationFailure(result.errors);
    sceneValues.set(scenePath, result.value);
  }
  const canonicalChanges = changes.map(change => {
    if (change.operation === 'delete') return change;
    const target = normalizeRelative(change.path || change.to);
    let value = null;
    if (target === info.projectPath) value = project;
    else if (target === orderPath) value = orderResult.value;
    else if (sceneValues.has(target)) value = sceneValues.get(target);
    return value == null ? change : { ...change, content: `${JSON.stringify(value, null, 2)}\n` };
  });
  return { project, order: orderResult.value, changes: canonicalChanges };
}
export function editorFileAPIPlugin({ repoRoot, allowedProjectPaths = [] } = {}) {
  const root = path.resolve(repoRoot || '.');
  const projects = allowedProjectPaths.map(normalizeRelative);
  const sceneRoots = projects.map(projectPath => path.resolve(root, canonicalInfo(projectPath).sceneRoot));
  const adapter = new AtomicDiskAdapter({ repositoryRoot: root });
  let recovery = null;

  return {
    name: 'editor-file-api',
    apply: 'serve',
    configureServer(server) {
      recovery = recovery || adapter.initialize();
      const notifiedRevisions = new Map();
      const sceneCommitEvent = 'yijian18:canonical-scene-commit';
      const projectCommitEvent = 'yijian18:canonical-project-commit';
      const canonicalSceneId = /^S(?:0[1-9]|1[0-4])(?:-C\d{2})?$/;
      const logger = server.config?.logger || console;
      const resolveProjectCommit = filePath => {
        const absolutePath = path.resolve(String(filePath || ''));
        const relativePath = normalizeRelative(path.relative(root, absolutePath));
        for (const projectPath of projects) {
          const info = canonicalInfo(projectPath);
          if (relativePath !== info.projectPath) continue;
          return {
            absolutePath,
            relativePath,
            projectPath: info.projectPath,
            gameId: path.posix.basename(info.projectRoot)
          };
        }
        return null;
      };
      const resolveSceneCommit = filePath => {
        const absolutePath = path.resolve(String(filePath || ''));
        const relativePath = normalizeRelative(path.relative(root, absolutePath));
        for (const projectPath of projects) {
          const info = canonicalInfo(projectPath);
          if (!relativePath.startsWith(info.sceneRoot)) continue;
          const fileName = relativePath.slice(info.sceneRoot.length);
          if (!fileName || fileName.includes('/') || !fileName.endsWith('.json') || fileName.startsWith('_')) continue;
          const sceneId = fileName.slice(0, -'.json'.length);
          if (!canonicalSceneId.test(sceneId)) continue;
          return {
            absolutePath,
            relativePath,
            projectPath: info.projectPath,
            gameId: path.posix.basename(info.projectRoot),
            sceneId
          };
        }
        return null;
      };
      // watcher.add() 可能为已有文件补发 add；先记录启动基线，避免服务器启动时误报全部场景。
      for (const sceneRoot of sceneRoots) {
        try {
          for (const fileName of fs.readdirSync(sceneRoot)) {
            const commit = resolveSceneCommit(path.join(sceneRoot, fileName));
            if (!commit) continue;
            const stat = fs.statSync(commit.absolutePath);
            if (stat.isFile()) notifiedRevisions.set(commit.relativePath, `${stat.mtimeMs}:${stat.size}`);
          }
        } catch (error) {
          logger.warn(`[EditorFileApiPlugin][CanonicalHotSync] baselineFailed=${error?.message || error}`);
        }
      }
      const notifyProjectCommit = (filePath, source = 'transaction') => {
        const commit = resolveProjectCommit(filePath);
        if (!commit) return false;
        let stat;
        try {
          stat = fs.statSync(commit.absolutePath);
          if (!stat.isFile()) return false;
        } catch (error) {
          logger.warn(`[EditorFileApiPlugin][CanonicalHotSync] source=${source} projectPath=${commit.projectPath} statFailed=${error?.message || error}`);
          return false;
        }
        const revision = `${stat.mtimeMs}:${stat.size}`;
        if (notifiedRevisions.get(commit.relativePath) === revision) {
          /* 火堆项目 HMR 排障日志：
          logger.info(`[EditorFileApiPlugin][CanonicalHotSync] source=${source} projectPath=${commit.projectPath} revision=${revision} wsSent=false duplicate=true`);
          */
          return false;
        }
        try {
          server.ws.send({
            type: 'custom',
            event: projectCommitEvent,
            data: {
              gameId: commit.gameId,
              projectPath: commit.projectPath,
              revision,
              ts: Date.now()
            }
          });
          notifiedRevisions.set(commit.relativePath, revision);
          /* 火堆项目 HMR 排障日志：
          logger.info(`[EditorFileApiPlugin][CanonicalHotSync] source=${source} projectPath=${commit.projectPath} revision=${revision} wsSent=true`);
          */
          return true;
        } catch (error) {
          logger.warn(`[EditorFileApiPlugin][CanonicalHotSync] source=${source} projectPath=${commit.projectPath} revision=${revision} wsSent=false error=${error?.message || error}`);
          return false;
        }
      };
      const notifySceneCommit = (filePath, source = 'transaction') => {
        if (resolveProjectCommit(filePath)) return notifyProjectCommit(filePath, source);
        const commit = resolveSceneCommit(filePath);
        if (!commit) return false;
        let stat;
        try {
          stat = fs.statSync(commit.absolutePath);
          if (!stat.isFile()) return false;
        } catch (error) {
          logger.warn(`[EditorFileApiPlugin][CanonicalHotSync] source=${source} sceneId=${commit.sceneId} statFailed=${error?.message || error}`);
          return false;
        }
        const revision = `${stat.mtimeMs}:${stat.size}`;
        if (notifiedRevisions.get(commit.relativePath) === revision) {
          logger.info(`[EditorFileApiPlugin][CanonicalHotSync] source=${source} sceneId=${commit.sceneId} revision=${revision} wsSent=false duplicate=true`);
          return false;
        }
        try {
          server.ws.send({
            type: 'custom',
            event: sceneCommitEvent,
            data: {
              gameId: commit.gameId,
              projectPath: commit.projectPath,
              sceneId: commit.sceneId,
              revision,
              ts: Date.now()
            }
          });
          notifiedRevisions.set(commit.relativePath, revision);
          logger.info(`[EditorFileApiPlugin][CanonicalHotSync] source=${source} sceneId=${commit.sceneId} revision=${revision} wsSent=true`);
          return true;
        } catch (error) {
          logger.warn(`[EditorFileApiPlugin][CanonicalHotSync] source=${source} sceneId=${commit.sceneId} revision=${revision} wsSent=false error=${error?.message || error}`);
          return false;
        }
      };
      const handleCanonicalAdd = filePath => { notifySceneCommit(filePath, 'add'); };
      const handleCanonicalChange = filePath => { notifySceneCommit(filePath, 'change'); };
      server.watcher.add(sceneRoots);
      server.watcher.on('add', handleCanonicalAdd);
      server.watcher.on('change', handleCanonicalChange);
      server.httpServer?.once('close', () => {
        server.watcher.off('add', handleCanonicalAdd);
        server.watcher.off('change', handleCanonicalChange);
        notifiedRevisions.clear();
      });

      server.middlewares.use(async (req, res, next) => {
        try {
          if (req.method === 'POST' && req.url === '/api/asset-transaction') {
            await recovery;
            const body = await parseBody(req);
            const projectPath = normalizeRelative(body.projectPath);
            if (!projects.includes(projectPath)) {
              return reply(res, 403, { ok: false, committed: false, error: '非当前项目' });
            }
            if (!body.catalog || typeof body.catalog !== 'object' || Array.isArray(body.catalog)) {
              return reply(res, 400, { ok: false, committed: false, error: 'catalog 必须是对象' });
            }
            const info = canonicalInfo(projectPath);
            let prepared;
            const result = await adapter.commitPrepared(() => {
              prepared = prepareSharedAtlasTransaction({
                repoRoot: root,
                projectPath,
                projectRoot: info.projectRoot,
                sceneRoot: info.sceneRoot,
                catalog: body.catalog
              });
              return prepared.changes;
            });
            if (!result.ok) {
              return reply(res, 500, { ...result, error: result.error?.message || '共享图集磁盘提交失败' });
            }
            return reply(res, 200, {
              ...result,
              catalog: prepared.catalog,
              manifest: prepared.manifest
            });
          }

          if (req.method === 'POST' && req.url === '/api/library-item-image-transaction') {
            await recovery;
            const body = await parseBody(req);
            const projectPath = normalizeRelative(body.projectPath);
            if (!projects.includes(projectPath)) {
              return reply(res, 403, { ok: false, committed: false, error: '非当前项目' });
            }
            const info = canonicalInfo(projectPath);
            let prepared;
            const result = await adapter.commitPrepared(() => {
              prepared = prepareLibraryItemImageTransaction({
                repoRoot: root,
                projectPath,
                projectRoot: info.projectRoot,
                library: body.library,
                imageUpdates: body.imageUpdates,
                canonicalizeProject: candidateProject => {
                  const validated = validateCanonicalChangeSet(root, projectPath, [{
                    operation: 'replace',
                    path: projectPath,
                    content: `${JSON.stringify(candidateProject, null, 2)}\n`
                  }]);
                  return validated.project;
                }
              });
              return prepared.changes;
            });
            if (!result.ok) {
              return reply(res, 500, { ...result, error: result.error?.message || '内容库图片磁盘提交失败' });
            }
            return reply(res, 200, { ...result, project: prepared.project, manifest: prepared.manifest });
          }

          if (req.method === 'POST' && req.url === '/api/canonical-transaction') {
            await recovery;
            const body = await parseBody(req);
            const projectPath = normalizeRelative(body.projectPath);
            if (!projects.includes(projectPath)) return reply(res, 403, { ok: false, committed: false, error: '非当前项目' });
            if (!Array.isArray(body.changes) || body.changes.length === 0) {
              return reply(res, 400, { ok: false, committed: false, error: 'changes 不能为空' });
            }
            /* 火堆内容库提交排障日志：
            logger.info('[EditorFileApiPlugin][CanonicalTransaction] received', {
              projectPath,
              repositoryRoot: root,
              changes: body.changes.map(change => ({
                operation: change.operation,
                path: normalizeRelative(change.path || change.to),
                from: change.from ? normalizeRelative(change.from) : undefined
              }))
            });
            */
            let validated;
            const result = await adapter.commitPrepared(() => {
              validated = validateCanonicalChangeSet(root, projectPath, body.changes);
              /* 火堆内容库提交排障日志：
              const campfirePresentation = validated.project.library?.items
                ?.find(item => item?.id === 'story.s01.campfire')?.campfirePresentation?.presentation || null;
              logger.info('[EditorFileApiPlugin][CanonicalTransaction] validated', {
                projectPath,
                canonicalChanges: validated.changes.map(change => ({ operation: change.operation, path: change.path })),
                campfirePresentation
              });
              */
              return validated.changes;
            });
            if (!result.ok) return reply(res, 500, { ...result, error: result.error?.message || '磁盘提交失败' });
            /* 火堆内容库提交排障日志：
            logger.info('[EditorFileApiPlugin][CanonicalTransaction] committed', {
              projectPath,
              repositoryRoot: root,
              transactionId: result.transactionId,
              committed: result.committed
            });
            */
            for (const change of validated.changes) {
              if (change.operation === 'delete') continue;
              const target = normalizeRelative(change.path || change.to);
              if (target) notifySceneCommit(path.resolve(root, target));
            }
            return reply(res, 200, result);
          }

          if (req.method === 'POST' && req.url === '/api/save-file') {
            const body = await parseBody(req);
            const filePath = normalizeRelative(body.path);
            if (isCanonicalPath(filePath, projects)) {
              return reply(res, 409, {
                ok: false,
                error: 'canonical 项目/场景只能通过 /api/canonical-transaction 提交'
              });
            }
            if (isSharedAtlasAssetPath(filePath, projects)) {
              return reply(res, 409, {
                ok: false,
                error: '共享图集 catalog 与 Asset Manifest 只能通过 /api/asset-transaction 原子提交'
              });
            }
            if (!filePath || body.content === undefined) return reply(res, 400, { error: '缺少 path 或 content' });
            if (!['utf8', 'base64'].includes(body.encoding || 'utf8')) return reply(res, 400, { error: '不支持的文件编码' });
            const target = resolveInside(root, filePath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const content = body.encoding === 'base64' ? Buffer.from(body.content, 'base64') : String(body.content);
            fs.writeFileSync(target, content, body.encoding === 'base64' ? undefined : 'utf8');
            return reply(res, 200, { ok: true, path: filePath });
          }

          if (req.method === 'GET' && req.url?.startsWith('/api/read-file')) {
            const url = new URL(req.url, 'http://localhost');
            const filePath = normalizeRelative(url.searchParams.get('path'));
            if (!filePath) return reply(res, 400, { error: '缺少 path 参数' });
            const target = resolveInside(root, filePath);
            if (!fs.existsSync(target)) return reply(res, 404, { error: '文件不存在', path: filePath });
            return reply(res, 200, { ok: true, content: fs.readFileSync(target, 'utf8') });
          }

          if (req.method === 'GET' && req.url?.startsWith('/api/list-files')) {
            const url = new URL(req.url, 'http://localhost');
            const dirPath = normalizeRelative(url.searchParams.get('path'));
            if (!dirPath) return reply(res, 400, { error: '缺少 path 参数' });
            const target = resolveInside(root, dirPath);
            if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return reply(res, 404, { error: '目录不存在' });
            const files = fs.readdirSync(target).map(name => ({ name, isDir: fs.statSync(path.join(target, name)).isDirectory() }));
            return reply(res, 200, { ok: true, files });
          }

          if (req.method === 'GET' && req.url?.startsWith('/api/file-size')) {
            const url = new URL(req.url, 'http://localhost');
            const filePath = normalizeRelative(url.searchParams.get('path'));
            if (!filePath) return reply(res, 400, { error: '缺少 path 参数' });
            const target = resolveInside(root, filePath);
            if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return reply(res, 404, { error: '文件不存在' });
            return reply(res, 200, { ok: true, size: fs.statSync(target).size });
          }
          next();
        } catch (error) {
          reply(res, error.statusCode || 500, {
            ok: false,
            committed: false,
            error: error.message,
            errors: error.errors || []
          });
        }
      });
    }
  };
}

export { validateCanonicalChangeSet };
export default editorFileAPIPlugin;