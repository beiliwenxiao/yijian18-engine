#!/usr/bin/env node
/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-09-26
 *
 * 一次性迁移：把 game.project.json 按字段切分为 shards 分片。
 * 主文件保留元信息 + shards 声明；SHARD_FIELDS 大字段写入 project/<field>.json。
 * 幂等：检测到 shards 声明即退出。回滚：git checkout 该工程目录。
 ************************************************************/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_DIR = path.join(ROOT, 'example', 'sanguo_zhangjiao');
const MAIN = path.join(PROJECT_DIR, 'game.project.json');
const SHARD_FIELDS = ['triggers', 'commands', 'library', 'triggerCatalog', 'quests', 'tutorials', 'dialogues'];

const originalText = fs.readFileSync(MAIN, 'utf8');
const project = JSON.parse(originalText);
if (project.shards) {
  console.log('[split-shards] 已存在 shards 声明，跳过');
  process.exit(0);
}

const shardDir = path.join(PROJECT_DIR, 'project');
fs.mkdirSync(shardDir, { recursive: true });

const shards = {};
for (const field of SHARD_FIELDS) {
  if (project[field] === undefined) continue;
  shards[field] = `project/${field}.json`;
  const shardText = `${JSON.stringify(project[field], null, 2)}\n`;
  JSON.parse(shardText); // 落盘前校验
  fs.writeFileSync(path.join(shardDir, `${field}.json`), shardText);
  console.log(`[split-shards] ${field} → project/${field}.json (${JSON.stringify(project[field]).length} bytes)`);
}

// 主文件保留原键序，shards 声明插在 schemaVersion 之后
const main = {};
let shardsInserted = false;
for (const [key, value] of Object.entries(project)) {
  if (SHARD_FIELDS.includes(key)) continue;
  main[key] = value;
  if (key === 'schemaVersion') {
    main.shards = shards;
    shardsInserted = true;
  }
}
if (!shardsInserted) main.shards = shards;

const mainText = `${JSON.stringify(main, null, 2)}\n`;
JSON.parse(mainText); // 落盘前校验

// 无损校验：主文件 + 分片合并后与原 project 深度一致（键序无关）
const merged = { ...main };
for (const field of Object.keys(shards)) merged[field] = project[field];
const stripShards = value => {
  const copy = { ...value };
  delete copy.shards;
  return copy;
};
const sortedStringify = value => {
  if (Array.isArray(value)) return `[${value.map(sortedStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${sortedStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
if (sortedStringify(stripShards(merged)) !== sortedStringify(stripShards(project))) {
  throw new Error('[split-shards] 合并校验失败：分片结果与原文件不一致，已中止');
}

fs.writeFileSync(MAIN, mainText);
console.log(`[split-shards] 主文件 ${originalText.length} → ${mainText.length} bytes，分片 ${Object.keys(shards).length} 个`);
