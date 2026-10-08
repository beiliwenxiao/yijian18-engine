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

// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AtomicDiskAdapter } from './AtomicDiskAdapter.js';

const roots = [];
const json = value => JSON.stringify(value);

function workspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-disk-'));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, json(content), 'utf8');
  }
  return root;
}

function read(root, name) {
  const target = path.join(root, name);
  return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

describe('AtomicDiskAdapter', () => {
  it('在一个 commit point 提交 replace/create/rename/delete change set', async () => {
    const root = workspace({
      'project.json': { revision: 1 },
      'old.json': { id: 'old' },
      'delete.json': { id: 'delete' }
    });
    const adapter = new AtomicDiskAdapter({ repositoryRoot: root });

    const result = await adapter.commit([
      { operation: 'replace', path: 'project.json', content: json({ revision: 2 }) },
      { operation: 'create', path: 'created.json', content: json({ id: 'created' }) },
      { operation: 'rename', from: 'old.json', path: 'renamed.json', content: json({ id: 'renamed' }) },
      { operation: 'delete', path: 'delete.json' }
    ]);

    expect(result).toMatchObject({ ok: true, committed: true, degraded: false });
    expect(read(root, 'project.json')).toEqual({ revision: 2 });
    expect(read(root, 'created.json')).toEqual({ id: 'created' });
    expect(read(root, 'old.json')).toBeNull();
    expect(read(root, 'renamed.json')).toEqual({ id: 'renamed' });
    expect(read(root, 'delete.json')).toBeNull();
  });

  it('commit point 前故障恢复全部原文件并清理 temp/journal', async () => {
    const root = workspace({ 'a.json': { value: 'before-a' }, 'b.json': { value: 'before-b' } });
    let diskChanges = 0;
    const adapter = new AtomicDiskAdapter({
      repositoryRoot: root,
      faultInjector(phase) {
        if (phase === 'disk:change' && ++diskChanges === 2) throw new Error('injected-before-commit');
      }
    });

    const result = await adapter.commit([
      { operation: 'replace', path: 'a.json', content: json({ value: 'after-a' }) },
      { operation: 'replace', path: 'b.json', content: json({ value: 'after-b' }) }
    ]);

    expect(result).toMatchObject({ ok: false, committed: false, category: 'diskCommitFailed' });
    expect(read(root, 'a.json')).toEqual({ value: 'before-a' });
    expect(read(root, 'b.json')).toEqual({ value: 'before-b' });
    expect(fs.existsSync(path.join(root, '.canonical-transactions'))).toBe(false);
    expect(fs.readdirSync(root).some(name => name.endsWith('.tmp'))).toBe(false);
  });

  it('commit point 后故障不回滚磁盘，后续启动清理 committed journal', async () => {
    const root = workspace({ 'state.json': { revision: 1 } });
    const adapter = new AtomicDiskAdapter({
      repositoryRoot: root,
      faultInjector(phase) {
        if (phase === 'journal:committed') throw new Error('post-commit-degradation');
      }
    });

    const result = await adapter.commit([
      { operation: 'replace', path: 'state.json', content: json({ revision: 2 }) }
    ]);

    expect(result).toMatchObject({ ok: true, committed: true, degraded: true });
    expect(read(root, 'state.json')).toEqual({ revision: 2 });
    expect(fs.existsSync(path.join(root, '.canonical-transactions'))).toBe(true);
    await new AtomicDiskAdapter({ repositoryRoot: root }).initialize();
    expect(read(root, 'state.json')).toEqual({ revision: 2 });
    expect(fs.existsSync(path.join(root, '.canonical-transactions'))).toBe(false);
  });

  it('启动时将 prepared journal 恢复为提交前状态', async () => {
    const root = workspace({ 'scene.json': { revision: 'partial' } });
    const transactionRoot = path.join(root, '.canonical-transactions', 'crashed');
    const backupRoot = path.join(transactionRoot, 'backup');
    fs.mkdirSync(backupRoot, { recursive: true });
    const backup = path.join(backupRoot, '0.bak');
    fs.writeFileSync(backup, json({ revision: 'before' }), 'utf8');
    fs.writeFileSync(path.join(transactionRoot, 'journal.json'), json({
      version: 1,
      transactionId: 'crashed',
      repositoryRoot: root,
      status: 'prepared',
      originals: [{ path: path.join(root, 'scene.json'), exists: true, backup }],
      tempFiles: []
    }), 'utf8');

    const recovered = await new AtomicDiskAdapter({ repositoryRoot: root }).initialize();

    expect(recovered).toEqual({ recovered: 1 });
    expect(read(root, 'scene.json')).toEqual({ revision: 'before' });
    expect(fs.existsSync(path.join(root, '.canonical-transactions'))).toBe(false);
  });

  it('拒绝目录穿越、重复目标和非法 JSON，磁盘保持不变', async () => {
    const root = workspace({ 'safe.json': { value: 1 } });
    const adapter = new AtomicDiskAdapter({ repositoryRoot: root });
    await expect(adapter.commit([
      { operation: 'replace', path: '../outside.json', content: json({ value: 2 }) }
    ])).rejects.toThrow('路径越权');
    await expect(adapter.commit([
      { operation: 'replace', path: 'safe.json', content: json({ value: 2 }) },
      { operation: 'delete', path: 'safe.json' }
    ])).rejects.toThrow('路径冲突');
    const invalid = await adapter.commit([
      { operation: 'replace', path: 'safe.json', content: '{ invalid' }
    ]);
    expect(invalid).toMatchObject({ ok: false, committed: false });
    expect(read(root, 'safe.json')).toEqual({ value: 1 });
  });

  it('对生成的 replace change set 序列始终产生完整新状态', async () => {
    for (let count = 1; count <= 6; count++) {
      const files = Object.fromEntries(Array.from({ length: count }, (_, index) => [`f${index}.json`, { value: index }]));
      const root = workspace(files);
      const changes = Array.from({ length: count }, (_, index) => ({
        operation: 'replace', path: `f${index}.json`, content: json({ value: index + 100 })
      }));
      const result = await new AtomicDiskAdapter({ repositoryRoot: root }).commit(changes);
      expect(result.committed).toBe(true);
      expect(changes.map((_, index) => read(root, `f${index}.json`).value)).toEqual(
        Array.from({ length: count }, (_, index) => index + 100)
      );
    }
  });
});