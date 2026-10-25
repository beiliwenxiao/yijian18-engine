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
 * SkeletonBindService.test.js
 * 绑骨端点内核单测：骨段换算 + 按骨段切图 + 挂点/图集输出。
 * 用 sharp 现场合成一张带 alpha 的竖向「角色」图，避免依赖项目素材文件。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { bindSkeletonParts, buildBindSegments, computeRestWorldBones } from './SkeletonBindService.js';

let tempRoot = '';
let sourcePath = '';

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skeleton-bind-'));
  // 200×200 画布：上方 60 行是「头」，中间 60 行是「躯干」，下方 60 行是「腿」，其余透明
  const width = 200;
  const height = 200;
  const raw = Buffer.alloc(width * height * 4);
  const paint = (x0, y0, x1, y1, color) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const index = (y * width + x) * 4;
        raw[index] = color[0];
        raw[index + 1] = color[1];
        raw[index + 2] = color[2];
        raw[index + 3] = 255;
      }
    }
  };
  paint(90, 10, 110, 70, [200, 60, 60]);    // 头
  paint(70, 70, 130, 130, [60, 200, 60]);   // 躯干
  paint(80, 130, 120, 190, [60, 60, 200]);  // 腿
  sourcePath = path.join(tempRoot, 'design.png');
  await sharp(raw, { raw: { width, height, channels: 4 } }).png().toFile(sourcePath);
});

afterAll(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

const BONES = [
  { name: 'root', parent: null, x: 0, y: 0, rot: 0, length: 0 },
  { name: 'torso', parent: 'root', x: 0, y: -30, rot: 0, length: 30 },
  { name: 'head', parent: 'torso', x: 0, y: -30, rot: 0, length: 20 },
  { name: 'leg', parent: 'root', x: 0, y: 0, rot: 90, length: 20 }
];

describe('computeRestWorldBones', () => {
  it('按父子关系累加旋转与位移', () => {
    const world = computeRestWorldBones(BONES);
    expect(world.get('root')).toMatchObject({ x: 0, y: 0, rot: 0 });
    expect(world.get('torso')).toMatchObject({ x: 0, y: -30, rot: 0 });
    expect(world.get('head')).toMatchObject({ x: 0, y: -60, rot: 0 });
    // 旋转 90° 的腿：局部 (0,0) 原点仍在 root，但朝向转为水平
    expect(world.get('leg').rot).toBeCloseTo(90, 5);
  });
});

describe('buildBindSegments', () => {
  it('子骨起点作为父骨末端；叶子骨按 rest 朝向 + length 补末端', () => {
    const built = buildBindSegments({
      bones: BONES,
      pxPerUnit: 1,
      pxJoints: { root: { x: 100, y: 190 }, torso: { x: 100, y: 130 }, head: { x: 100, y: 70 } }
    });
    const byKey = new Map(built.segments.map(segment => [segment.key, segment]));
    expect(byKey.get('torso').b).toEqual({ x: 100, y: 70 });        // 末端 = head 起点
    expect(byKey.get('head').b.y).toBeLessThan(70);                 // 叶子骨沿父骨方向（向上）延伸
    // leg 未采集：沿 root 反推 → 与 root 同点
    expect(byKey.get('leg').a).toEqual({ x: 100, y: 190 });
    // 旋转 90° 且无父骨方向时，退回骨骼自身朝向（+x 旋转 90° → 朝下）
    expect(byKey.get('leg').b.y).toBeCloseTo(210, 5);
  });
});

describe('bindSkeletonParts', () => {
  it('按骨段切图并返回图集 base64 + 有限数值挂点', async () => {
    const result = await bindSkeletonParts({
      sourceAbsolutePath: sourcePath,
      bones: BONES,
      pxPerUnit: 1,
      designHeight: 200,
      pxJoints: { root: { x: 100, y: 190 }, torso: { x: 100, y: 130 }, head: { x: 100, y: 70 } },
      atlasWidth: 128
    });
    expect(result.ok).toBe(true);
    expect(result.atlas.width).toBeGreaterThan(0);
    expect(result.parts.length).toBeGreaterThanOrEqual(3);
    expect(result.parts.map(part => part.bone)).toEqual(expect.arrayContaining(['torso', 'head']));
    for (const part of result.parts) {
      expect(Number.isFinite(part.atlas.sx)).toBe(true);
      expect(Number.isFinite(part.local.x)).toBe(true);
      expect(Number.isFinite(part.local.y)).toBe(true);
      expect(part.atlas.sw).toBeGreaterThan(0);
      expect(part.width).toBeGreaterThan(0);
    }
    // 头块：内容中心应落在头骨起点上方（局部 y 为负）
    const head = result.parts.find(part => part.bone === 'head');
    expect(head.local.y).toBeLessThan(0);
    expect(Buffer.from(result.atlasPngBase64, 'base64').length).toBeGreaterThan(0);
  });

  it('拒绝越界或非图片路径', async () => {
    await expect(bindSkeletonParts({
      sourceAbsolutePath: path.join(tempRoot, 'missing.png'),
      bones: BONES,
      pxPerUnit: 1,
      pxJoints: { root: { x: 10, y: 10 } }
    })).rejects.toThrow();
    await expect(bindSkeletonParts({
      sourceAbsolutePath: path.join(tempRoot, 'design.txt'),
      bones: BONES,
      pxPerUnit: 1,
      pxJoints: { root: { x: 10, y: 10 } }
    })).rejects.toThrow();
  });
});
