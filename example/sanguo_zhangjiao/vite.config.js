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

import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { editorFileAPIPlugin } from '../../src/dev/EditorFileApiPlugin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../');
const CANONICAL_PROJECT = 'example/sanguo_zhangjiao/game.project.json';

function copyRuntimeDirsPlugin(outDir) {
  // project/ = game.project.json 的 shards 分片目录，与主文件一同随构建拷贝
  const dirs = ['assets', 'data', 'config', 'project'];
  return {
    name: 'copy-runtime-dirs',
    apply: 'build',
    closeBundle() {
      for (const dir of dirs) {
        const from = path.resolve(__dirname, dir);
        const to = path.resolve(outDir, dir);
        if (fs.existsSync(from)) {
          fs.cpSync(from, to, { recursive: true });
          console.log(`[copy-runtime-dirs] 已拷贝 ${dir} -> ${to}`);
        }
      }
    }
  };
}

const outDir = path.resolve(repoRoot, 'dist/sanguo_zhangjiao');

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [
    copyRuntimeDirsPlugin(outDir),
    editorFileAPIPlugin({ repoRoot, allowedProjectPaths: [CANONICAL_PROJECT] })
  ],
  server: {
    port: 3100,
    open: true,
    fs: { allow: [repoRoot] }
  },
  build: {
    outDir,
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2018'
  }
});