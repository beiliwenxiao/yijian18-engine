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
import crypto from 'crypto';

const JOURNAL_VERSION = 1;
const JOURNAL_DIR = '.canonical-transactions';
const LOCKS = new Map();

function ensureInside(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative === '.' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`路径越权: ${target}`);
  }
  return target;
}

function writeJsonDurable(filePath, value) {
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.write`);
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  const handle = fs.openSync(temp, 'r+');
  try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
  fs.renameSync(temp, filePath);
}

function removePath(filePath) {
  fs.rmSync(filePath, { recursive: true, force: true });
}

function sameFileContent(left, right) {
  if (!fs.existsSync(left) || !fs.existsSync(right)) return false;
  const leftStat = fs.statSync(left);
  const rightStat = fs.statSync(right);
  if (!leftStat.isFile() || !rightStat.isFile() || leftStat.size !== rightStat.size) return false;
  return fs.readFileSync(left).equals(fs.readFileSync(right));
}

function removeEmptyDirectory(directory) {
  try {
    if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  } catch (_error) { /* best effort */ }
}

function fsyncDirectory(directory) {
  if (process.platform === 'win32') return;
  const handle = fs.openSync(directory, 'r');
  try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
}

function runExclusive(key, operation) {
  const previous = LOCKS.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  LOCKS.set(key, current);
  return current.finally(() => {
    if (LOCKS.get(key) === current) LOCKS.delete(key);
  });
}

/**
 * Node/Vite 开发宿主的 canonical 磁盘事务适配器。
 * journal durable 标记从 prepared 线性化为 committed 的时刻是唯一 commit point。
 */
export class AtomicDiskAdapter {
  constructor({ repositoryRoot, faultInjector = null } = {}) {
    if (!repositoryRoot) throw new TypeError('AtomicDiskAdapter requires repositoryRoot');
    this.repositoryRoot = path.resolve(repositoryRoot);
    this.journalRoot = path.join(this.repositoryRoot, JOURNAL_DIR);
    this.faultInjector = faultInjector;
  }

  initialize() {
    return runExclusive(this.repositoryRoot, async () => this._recoverUnlocked());
  }

  commit(changeSet) {
    return runExclusive(this.repositoryRoot, async () => {
      this._recoverUnlocked();
      return this._commitUnlocked(changeSet);
    });
  }

  /**
   * 在 repository 独占锁内读取并准备 change set，再执行同一原子提交。
   * 用于跨文件引用闭包，避免 validate 与 commit 之间被其他事务改写。
   * @param {() => Array<object>|Promise<Array<object>>} prepareChangeSet
   */
  commitPrepared(prepareChangeSet) {
    if (typeof prepareChangeSet !== 'function') {
      throw new TypeError('AtomicDiskAdapter.commitPrepared requires prepareChangeSet');
    }
    return runExclusive(this.repositoryRoot, async () => {
      this._recoverUnlocked();
      const changeSet = await prepareChangeSet();
      return this._commitUnlocked(changeSet);
    });
  }

  _fault(phase, context = {}) {
    this.faultInjector?.(phase, context);
  }

  _normalize(changeSet) {
    if (!Array.isArray(changeSet) || changeSet.length === 0) throw new Error('changeSet 不能为空');
    const normalized = changeSet.map((change, index) => {
      const operation = change?.operation;
      if (!['replace', 'create', 'rename', 'delete'].includes(operation)) {
        throw new Error(`changeSet[${index}] operation 无效`);
      }
      const item = { operation };
      if (operation === 'rename') {
        item.from = ensureInside(this.repositoryRoot, path.resolve(this.repositoryRoot, change.from || ''));
        item.path = ensureInside(this.repositoryRoot, path.resolve(this.repositoryRoot, change.path || change.to || ''));
        if (change.content !== undefined) item.content = String(change.content);
      } else {
        item.path = ensureInside(this.repositoryRoot, path.resolve(this.repositoryRoot, change.path || ''));
        if (operation !== 'delete') item.content = String(change.content);
      }
      return item;
    });

    const touched = new Set();
    for (const change of normalized) {
      for (const target of [change.from, change.path].filter(Boolean)) {
        if (touched.has(target)) throw new Error(`changeSet 路径冲突: ${path.relative(this.repositoryRoot, target)}`);
        touched.add(target);
      }
      if (change.operation === 'create' && fs.existsSync(change.path)) {
        throw new Error(`create 目标已存在: ${path.relative(this.repositoryRoot, change.path)}`);
      }
      if (change.operation === 'replace' && !fs.existsSync(change.path)) {
        throw new Error(`replace 目标不存在: ${path.relative(this.repositoryRoot, change.path)}`);
      }
      if (change.operation === 'rename' && !fs.existsSync(change.from)) {
        throw new Error(`rename 来源不存在: ${path.relative(this.repositoryRoot, change.from)}`);
      }
    }
    return normalized;
  }

  _commitUnlocked(changeSet) {
    const changes = this._normalize(changeSet);
    fs.mkdirSync(this.journalRoot, { recursive: true });
    const transactionId = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const transactionRoot = path.join(this.journalRoot, transactionId);
    const backupRoot = path.join(transactionRoot, 'backup');
    fs.mkdirSync(backupRoot, { recursive: true });

    const touched = [...new Set(changes.flatMap(change => [change.from, change.path]).filter(Boolean))];
    const originals = touched.map((target, index) => {
      const exists = fs.existsSync(target);
      const backup = path.join(backupRoot, `${index}.bak`);
      if (exists) {
        fs.copyFileSync(target, backup);
        const backupHandle = fs.openSync(backup, 'r+');
        try { fs.fsyncSync(backupHandle); } finally { fs.closeSync(backupHandle); }
      }
      return { path: target, exists, backup: exists ? backup : null };
    });
    const prepared = [];
    let committed = false;

    try {
      this._fault('prewrite:start', { transactionId });
      for (let index = 0; index < changes.length; index++) {
        const change = changes[index];
        if (change.operation === 'delete') continue;
        const content = change.operation === 'rename' && change.content === undefined
          ? fs.readFileSync(change.from, 'utf8')
          : change.content;
        JSON.parse(content);
        const temp = path.join(path.dirname(change.path), `.${path.basename(change.path)}.${transactionId}.${index}.tmp`);
        fs.writeFileSync(temp, content, 'utf8');
        const handle = fs.openSync(temp, 'r+');
        try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
        prepared.push({ index, temp });
      }
      this._fault('prewrite:complete', { transactionId });

      const journalPath = path.join(transactionRoot, 'journal.json');
      const journal = {
        version: JOURNAL_VERSION,
        transactionId,
        repositoryRoot: this.repositoryRoot,
        status: 'prepared',
        originals,
        tempFiles: prepared.map(item => item.temp)
      };
      writeJsonDurable(journalPath, journal);
      fsyncDirectory(transactionRoot);
      this._fault('journal:prepared', { transactionId });

      for (let index = 0; index < changes.length; index++) {
        const change = changes[index];
        if (change.operation === 'rename') removePath(change.from);
        removePath(change.path);
        if (change.operation !== 'delete') {
          const temp = prepared.find(item => item.index === index).temp;
          fs.renameSync(temp, change.path);
        }
        this._fault('disk:change', { transactionId, index, operation: change.operation });
      }
      for (const directory of new Set(touched.map(target => path.dirname(target)))) fsyncDirectory(directory);

      journal.status = 'committed';
      journal.committedAt = Date.now();
      writeJsonDurable(journalPath, journal);
      fsyncDirectory(transactionRoot);
      committed = true;
      this._fault('journal:committed', { transactionId });

      try {
        fs.rmSync(transactionRoot, { recursive: true, force: true });
        removeEmptyDirectory(this.journalRoot);
      }
      catch (error) {
        return { ok: true, committed: true, transactionId, degraded: true, warnings: [{ category: 'journalCleanupFailed', message: error.message }] };
      }
      return { ok: true, committed: true, transactionId, degraded: false, warnings: [] };
    } catch (error) {
      if (!committed) {
        try {
          this._restoreOriginals(originals);
          for (const item of prepared) removePath(item.temp);
          removePath(transactionRoot);
          removeEmptyDirectory(this.journalRoot);
        } catch (rollbackError) {
          const failure = new Error(
            `磁盘提交失败且回滚未完成：${error.message}；回滚错误：${rollbackError.message}`
          );
          return {
            ok: false,
            committed: false,
            category: 'diskCommitRollbackFailed',
            error: failure,
            errors: [{
              path: '',
              category: 'rollbackFailed',
              reason: failure.message
            }]
          };
        }
        return { ok: false, committed: false, category: 'diskCommitFailed', error };
      }
      return {
        ok: true, committed: true, transactionId, degraded: true,
        warnings: [{ category: 'postCommitCleanupFailed', message: error.message }]
      };
    }
  }

  _restoreOriginals(originals) {
    const directories = new Set();
    for (const original of originals) {
      const relativePath = path.relative(this.repositoryRoot, original.path);
      try {
        directories.add(path.dirname(original.path));
        if (!original.exists) {
          removePath(original.path);
          continue;
        }
        if (!original.backup || !fs.existsSync(original.backup)) {
          throw new Error('恢复备份不存在');
        }
        fs.mkdirSync(path.dirname(original.path), { recursive: true });
        if (!sameFileContent(original.path, original.backup)) {
          removePath(original.path);
          fs.copyFileSync(original.backup, original.path);
        }
        const handle = fs.openSync(original.path, 'r+');
        try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
      } catch (error) {
        throw new Error(`恢复原文件失败 ${relativePath}: ${error.message}`, { cause: error });
      }
    }
    for (const directory of directories) fsyncDirectory(directory);
  }

  _recoverUnlocked() {
    if (!fs.existsSync(this.journalRoot)) return { recovered: 0 };
    let recovered = 0;
    for (const name of fs.readdirSync(this.journalRoot)) {
      const transactionRoot = path.join(this.journalRoot, name);
      const journalPath = path.join(transactionRoot, 'journal.json');
      if (!fs.existsSync(journalPath)) {
        removePath(transactionRoot);
        continue;
      }
      let journal;
      try { journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')); }
      catch (error) { throw new Error(`无法读取恢复 journal ${name}: ${error.message}`, { cause: error }); }
      if (journal.version !== JOURNAL_VERSION || path.resolve(journal.repositoryRoot) !== this.repositoryRoot) {
        throw new Error(`拒绝不匹配的恢复 journal: ${name}`);
      }
      try {
        if (journal.status !== 'committed') this._restoreOriginals(journal.originals || []);
        for (const temp of journal.tempFiles || []) removePath(temp);
        removePath(transactionRoot);
      } catch (error) {
        throw new Error(`恢复 canonical 事务 ${name} 失败: ${error.message}`, { cause: error });
      }
      recovered++;
    }
    try {
      if (fs.existsSync(this.journalRoot) && fs.readdirSync(this.journalRoot).length === 0) fs.rmdirSync(this.journalRoot);
    } catch (_error) { /* best effort */ }
    return { recovered };
  }
}

export default AtomicDiskAdapter;