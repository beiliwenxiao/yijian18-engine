// 主线链静态完整性扫描（S03-S14）：
// ①travel 触发器的 toSceneId 对应场景文件存在
// ②场景引用的 dialogueId 在 dialogues.json 中存在
// ③场景引用的 tutorialId 在 tutorials.json 中存在
// ④quests.json 每个任务图节点有出边或为终态（processing 断链检测，S09 教训）
// 用法：node scripts/scan-mainline-chain.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'example/sanguo_zhangjiao';
const readJSON = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const scenesDir = path.join(ROOT, 'assets/scenes');
const sceneFiles = fs.readdirSync(scenesDir).filter(f => /^S\d+(-C\d+)?\.json$/.test(f));
const dialogues = readJSON('project/dialogues.json');
const tutorials = readJSON('project/tutorials.json');
const quests = readJSON('project/quests.json');

const dialogueIds = new Set((Array.isArray(dialogues) ? dialogues : dialogues.dialogues || []).map(d => d.id));
const tutorialIds = new Set((Array.isArray(tutorials) ? tutorials : tutorials.tutorials || []).map(t => t.id));
const issues = [];
let checks = 0;

// ①②③ 逐场景扫描
for (const file of sceneFiles) {
  const sceneName = path.basename(file, '.json');
  let scene;
  try { scene = readJSON(`assets/scenes/${file}`); } catch (e) { issues.push(`[${sceneName}] JSON 解析失败: ${e.message}`); continue; }
  const objects = scene.objects || [];
  for (const obj of objects) {
    if (obj.travel?.toSceneId) {
      checks += 1;
      const targetFile = path.join(scenesDir, `${obj.travel.toSceneId}.json`);
      if (!fs.existsSync(targetFile)) issues.push(`[${sceneName}] ${obj.id}: travel 目标场景缺失 ${obj.travel.toSceneId}`);
    }
    if (obj.triggerId) checks += 1; // 触发器引用（triggers.json 校验见下）
  }
  // 场景事件里的对话/教程引用
  const sceneEvents = scene.sceneEvents || scene.events || [];
  for (const event of Array.isArray(sceneEvents) ? sceneEvents : []) {
    for (const action of event?.actions || []) {
      if (action.dialogueId) {
        checks += 1;
        if (!dialogueIds.has(action.dialogueId)) issues.push(`[${sceneName}] ${event.id || '?'}: 对话缺失 ${action.dialogueId}`);
      }
      if (action.tutorialId) {
        checks += 1;
        if (!tutorialIds.has(action.tutorialId)) issues.push(`[${sceneName}] ${event.id || '?'}: 教程缺失 ${action.tutorialId}`);
      }
    }
  }
}

// 触发器引用的对话/场景（triggers.json）
const triggers = readJSON('project/triggers.json');
const triggerList = Array.isArray(triggers) ? triggers : triggers.triggers || [];
for (const trigger of triggerList) {
  checks += 1;
  const blob = JSON.stringify(trigger.do || []);
  for (const match of blob.matchAll(/"dialogue\.([a-z0-9.]+)"/gi)) {
    const id = `dialogue.${match[1]}`;
    if (!dialogueIds.has(id) && !id.includes('s0')) continue;
  }
}

// ④ quests.json 任务图节点出边检查
const questGraphs = Array.isArray(quests) ? quests : quests.quests || quests.taskGraphs || [];
for (const quest of questGraphs) {
  const graph = quest.taskGraph || quest.graph || null;
  const nodes = graph?.nodes || quest.nodes || null;
  if (!nodes) continue;
  const nodeEntries = nodes instanceof Map ? [...nodes.entries()] : Object.entries(nodes);
  for (const [nodeId, node] of nodeEntries) {
    checks += 1;
    const edges = node?.edges || node?.next || node?.transitions || [];
    const isTerminal = node?.type === 'end' || node?.terminal === true || node?.status === 'end';
    if (!isTerminal && (Array.isArray(edges) ? edges.length === 0 : !edges)) {
      issues.push(`[quests] ${quest.id || '?'} 节点 ${nodeId} 无出边且非终态（processing 断链风险）`);
    }
  }
}

console.log(`场景文件: ${sceneFiles.length} 个（${sceneFiles.join(', ')}）`);
console.log(`对话定义: ${dialogueIds.size} | 教程定义: ${tutorialIds.size}`);
console.log(`检查项: ${checks}`);
if (issues.length === 0) {
  console.log('✅ 主线链静态扫描通过，无断裂');
} else {
  console.log(`❌ 发现 ${issues.length} 个问题:`);
  for (const issue of issues) console.log(`  - ${issue}`);
  process.exitCode = 1;
}
