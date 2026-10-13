// 找出 manifest 登记了但 git 未追踪的图片 = 必须入库的缺失图
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const manifest = JSON.parse(readFileSync('example/sanguo_zhangjiao/assets/manifests/assets.json', 'utf8'));

// 收集 manifest 引用的所有资产文件路径（image/skeleton 等）
const referenced = new Set();
for (const entry of manifest.assets) {
  const path = entry.runtime2D?.path || entry.sourceFile;
  if (path) referenced.add(path.replace(/\\/g, '/'));
  if (Array.isArray(entry.frames)) {
    for (const frame of entry.frames) if (frame.url) referenced.add(frame.url.replace(/\\/g, '/'));
  }
}

// git 已追踪的文件集合
const tracked = new Set(
  execSync('git -c core.quotepath=false ls-files', { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean)
);

const missing = [...referenced].filter(p => !tracked.has(`example/sanguo_zhangjiao/${p}`)).sort();
console.log(`manifest 引用文件: ${referenced.size}，git 未追踪: ${missing.length}`);
for (const p of missing) console.log(p);
if (missing.length) {
  writeFileSync('.trae/missing-manifest-images.txt', missing.join('\n'), 'utf8');
  console.log('清单已写入 .trae/missing-manifest-images.txt');
}
