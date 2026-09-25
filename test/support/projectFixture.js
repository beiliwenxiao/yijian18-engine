/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-09-26
 *
 * 测试夹具：读取 game.project.json 并按 shards 声明合并分片。
 * 无 shards 声明时等价于直接读主文件。
 ************************************************************/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeShardedProject } from '../../src/core/projectShards.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 读取仓库内 JSON（相对仓库根）。 */
export function readRepoJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

/** 读取 game.project.json 并按 shards 声明浅合并分片字段。 */
export async function loadProjectWithShards(projectPath = 'example/sanguo_zhangjiao/game.project.json') {
  const main = readRepoJson(projectPath);
  const root = projectPath.slice(0, -'/game.project.json'.length);
  return mergeShardedProject(main, rel => Promise.resolve(readRepoJson(`${root}/${rel}`)));
}
