// 一次性迁移：player.json 的 walk_* 剪辑从 3 组关键帧改为 4 组 + 隐式首帧第 5 组。
// 规则：
//   - 同刻去重（±5ms 取数组最后一条，对齐编辑器 upsert 语义）
//   - 3 键 [接触左, 接触右, 接触左] → 4 键 [接触左, passing, 接触右, passing]
//     passing 帧值 = 两侧接触帧的字段平均（t/ease 除外，ease 取过渡目标帧）
//   - ≥4 键（hips 起伏 5 键 [接触,高,接触,高,接触]）→ 取前 4 键，尾键由隐式首帧承接
//   - 新键位统一 [0, d/4, d/2, 3d/4]；末段 → duration 由运行时隐式回插首帧（第 5 组）
// 键值全部继承旧数据（walk_down 的手工调整不丢失），只重构时间结构。
import { readFileSync, writeFileSync } from 'node:fs';

const PATH = 'example/sanguo_zhangjiao/assets/skeletons/player.json';
const doc = JSON.parse(readFileSync(PATH, 'utf8'));

const round2 = v => Math.round(v * 100) / 100;

function dedupe(keys) {
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const out = [];
  for (const key of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(key.t - last.t) <= 5) out[out.length - 1] = key;
    else out.push(key);
  }
  return out;
}

function avgKeys(a, b, t) {
  const out = { t };
  for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (f === 't') continue;
    const va = a[f], vb = b[f];
    if (f === 'ease') { out[f] = vb ?? va ?? 'linear'; continue; }
    if (va == null && vb == null) continue;
    if (va == null) { out[f] = vb; continue; }
    if (vb == null) { out[f] = va; continue; }
    out[f] = typeof va === 'number' && typeof vb === 'number' ? round2((va + vb) / 2) : vb;
  }
  return out;
}

for (const clip of doc.clips.filter(c => c.name.startsWith('walk_'))) {
  const d = clip.durationMs;
  const times = [0, Math.round(d / 4), Math.round(d / 2), Math.round(d * 3 / 4)];
  for (const track of clip.tracks) {
    const old = dedupe(track.keys);
    if (old.length < 3) continue; // 键太少（不足一个交替周期）保持原样
    let values;
    if (old.length >= 4) {
      values = old.slice(0, 4); // hips 起伏类：取前 4 键，尾键由隐式首帧承接
    } else {
      const [k0, k1, k2] = old;
      values = [k0, avgKeys(k0, k1), k1, avgKeys(k1, k2)];
    }
    track.keys = values.map((key, i) => ({ ...key, t: times[i] }));
  }
}

writeFileSync(PATH, JSON.stringify(doc, null, 2) + '\n');
console.log('migrated:');
for (const c of doc.clips.filter(c => c.name.startsWith('walk_'))) {
  console.log(' ', c.name, c.tracks.map(t => `${t.bone}[${t.keys.map(k => k.t).join(',')}]`).join(' '));
}
