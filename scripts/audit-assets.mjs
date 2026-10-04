// 资产审计：1) assets.json 登记的文件是否存在于磁盘 2) library/场景/对话引用的 imageId 是否登记
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'example/sanguo_zhangjiao';
const manifest = JSON.parse(readFileSync(join(ROOT, 'assets/manifests/assets.json'), 'utf8'));
const entries = Array.isArray(manifest) ? manifest : (manifest.assets || manifest.images || []);
console.log(`assets.json 条目数: ${entries.length}`);

// 1) 登记文件存在性
const missingFiles = [];
for (const entry of entries) {
  const file = entry.runtime2D?.path || entry.sourceFile;
  if (!file) continue;
  if (!existsSync(join(ROOT, file))) missingFiles.push({ assetId: entry.assetId, file });
}
console.log(`\n== 登记但文件缺失 (${missingFiles.length}) ==`);
for (const m of missingFiles) console.log(`  ${m.assetId} -> ${m.file}`);

// 2) 引用 vs 登记
const registered = new Set(entries.map(e => e.assetId).filter(Boolean));
const refs = new Map(); // imageId -> [出处]
const collect = (imageId, where) => {
  if (!imageId || typeof imageId !== 'string') return;
  if (!refs.has(imageId)) refs.set(imageId, []);
  refs.get(imageId).push(where);
};

const library = JSON.parse(readFileSync(join(ROOT, 'project/library.json'), 'utf8'));
const walk = (obj, where) => {
  if (Array.isArray(obj)) { obj.forEach((v, i) => walk(v, where)); return; }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if ((k === 'imageId' || k === 'assetId' || k === 'portraitImageId') && typeof v === 'string') collect(v, where);
      else walk(v, where);
    }
  }
};
for (const [kind, list] of Object.entries(library)) {
  if (!Array.isArray(list)) continue;
  for (const def of list) walk(def, `library.${kind}:${def.id || ''}`);
}
for (const sceneFile of ['S01', 'S01-C01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12', 'S13', 'S14']) {
  try {
    const scene = JSON.parse(readFileSync(join(ROOT, 'assets/scenes', `${sceneFile}.json`), 'utf8'));
    walk(scene, `scene:${sceneFile}`);
  } catch (_) { /* 场景文件可能不存在 */ }
}
try {
  const dialogues = JSON.parse(readFileSync(join(ROOT, 'project/dialogues.json'), 'utf8'));
  walk(dialogues, 'dialogues');
} catch (_) {}

const unregistered = [...refs.entries()].filter(([id]) => !registered.has(id));
console.log(`\n== 引用但未登记 (${unregistered.length}) ==`);
for (const [id, where] of unregistered) {
  const src = [...new Set(where)].slice(0, 3).join(', ');
  console.log(`  ${id}  [${src}]`);
}
