/**
 * SceneImageAssetTransaction.test.js
 * 「导入即登记」事务单元测试：场景图片 upsert 进 Asset Manifest。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { prepareSceneImageAssetTransaction } from './SceneImageAssetTransaction.js';

const PNG_2X1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // 签名
  0, 0, 0, 13, 'I'.charCodeAt(0), 'H'.charCodeAt(0), 'D'.charCodeAt(0), 'R'.charCodeAt(0),
  0, 0, 0, 2, 0, 0, 0, 1, // 2x1
  8, 6, 0, 0, 0
]);

function makeRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-image-tx-'));
  const projectRoot = 'example/test_game';
  const manifestPath = path.join(repoRoot, projectRoot, 'assets/manifests/assets.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const imagePath = path.join(repoRoot, projectRoot, 'assets/images/s01/test.png');
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, PNG_2X1);
  const manifest = {
    schemaVersion: 1,
    gameId: 'test_game',
    assets: [
      {
        assetId: 's01.environment.existing',
        imageId: 's01.environment.existing',
        category: 'environment-module',
        usage: ['S01'],
        sourceFile: 'assets/images/s01/existing.png',
        runtime2D: { path: 'assets/images/s01/existing.png', mode: 'image' },
        runtime3D: { mode: 'billboard', sourceAssetId: 's01.environment.existing' },
        pivot: { x: 0.5, y: 1 },
        bounds: { width: 10, height: 10 },
        animations: [],
        targetPhase: 'P1',
        status: 'final',
        revision: 3
      }
    ]
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { repoRoot, projectRoot, manifestPath };
}

describe('prepareSceneImageAssetTransaction', () => {
  let repo;
  const buildParams = (imageAssets) => ({
    repoRoot: repo.repoRoot,
    projectPath: 'example/test_game/game.project.json',
    projectRoot: repo.projectRoot,
    imageAssets
  });

  beforeEach(() => {
    repo = makeRepo();
  });

  afterEach(() => {
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  });

  it('新图片登记：创建 placeholder 条目，usage 并入场景 ID，尺寸取自 PNG 头', () => {
    const { manifest, changes } = prepareSceneImageAssetTransaction(buildParams([
      { imageId: 'img.test_new', runtimePath: 'assets/images/s01/test.png', sceneId: 'S01' }
    ]));

    const entry = manifest.assets.find(candidate => candidate.imageId === 'img.test_new');
    expect(entry).toBeTruthy();
    expect(entry.assetId).toBe('img.test_new');
    expect(entry.runtime2D).toEqual({ path: 'assets/images/s01/test.png', mode: 'image' });
    expect(entry.bounds).toEqual({ width: 2, height: 1 });
    expect(entry.status).toBe('placeholder');
    expect(entry.usage).toContain('S01');
    expect(entry.usage).toContain('s01');
    expect(entry.runtime3D.sourceAssetId).toBe('img.test_new');
    expect(changes).toEqual([{
      operation: 'replace',
      path: 'example/test_game/assets/manifests/assets.json',
      content: `${JSON.stringify(manifest, null, 2)}\n`
    }]);
  });

  it('已存在条目：只更新路径与实测尺寸，revision 递增，usage/status 保留', () => {
    const { manifest } = prepareSceneImageAssetTransaction(buildParams([
      { imageId: 's01.environment.existing', runtimePath: 'assets/images/s01/test.png', sceneId: 'S01' }
    ]));
    const entry = manifest.assets.find(candidate => candidate.imageId === 's01.environment.existing');
    expect(entry.sourceFile).toBe('assets/images/s01/test.png');
    expect(entry.bounds).toEqual({ width: 2, height: 1 });
    expect(entry.revision).toBe(4);
    expect(entry.status).toBe('final');
    expect(entry.usage).toContain('S01');
    expect(manifest.assets).toHaveLength(1);
  });

  it('重复登记同一 imageId 拒绝', () => {
    expect(() => prepareSceneImageAssetTransaction(buildParams([
      { imageId: 'img.a', runtimePath: 'assets/images/s01/test.png' },
      { imageId: 'img.a', runtimePath: 'assets/images/s01/test.png' }
    ]))).toThrow(/重复/);
  });

  it('非法 imageId（数字开头）拒绝', () => {
    expect(() => prepareSceneImageAssetTransaction(buildParams([
      { imageId: '1bad', runtimePath: 'assets/images/s01/test.png' }
    ]))).toThrow(/imageId/);
  });

  it('atlas 条目不允许通过本事务改写', () => {
    const manifest = JSON.parse(fs.readFileSync(repo.manifestPath, 'utf8'));
    manifest.assets.push({
      assetId: 'atlas.thing', imageId: 'atlas.thing', category: 'environment-atlas',
      usage: ['S01'], sourceFile: 'assets/images/s01/atlas.png',
      runtime2D: { path: 'assets/images/s01/atlas.png', mode: 'atlas' },
      runtime3D: { mode: 'billboard', sourceAssetId: 'atlas.thing' },
      pivot: { x: 0.5, y: 1 }, bounds: { width: 4, height: 4 },
      animations: [], targetPhase: 'P1', status: 'final', revision: 1
    });
    fs.writeFileSync(repo.manifestPath, JSON.stringify(manifest, null, 2));

    expect(() => prepareSceneImageAssetTransaction(buildParams([
      { imageId: 'atlas.thing', runtimePath: 'assets/images/s01/test.png' }
    ]))).toThrow(/atlas/);
  });

  it('PNG 文件不存在拒绝', () => {
    expect(() => prepareSceneImageAssetTransaction(buildParams([
      { imageId: 'img.missing', runtimePath: 'assets/images/s01/nope.png' }
    ]))).toThrow(/不存在/);
  });

  it('路径越权（.. / 非 assets/images）拒绝', () => {
    expect(() => prepareSceneImageAssetTransaction(buildParams([
      { imageId: 'img.bad', runtimePath: '../game.project.json' }
    ]))).toThrow(/assets\/images|越/);
    expect(() => prepareSceneImageAssetTransaction(buildParams([
      { imageId: 'img.bad', runtimePath: 'project/library.json' }
    ]))).toThrow(/assets\/images/);
  });

  it('空 imageAssets 拒绝', () => {
    expect(() => prepareSceneImageAssetTransaction(buildParams([]))).toThrow(/imageAssets/);
  });
});
