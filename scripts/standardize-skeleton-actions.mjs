/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-17
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

// 标准动作集批量补齐：让所有玩家类/人形 NPC 类骨骼资产具备统一动作集。
//   node scripts/standardize-skeleton-actions.mjs
//
// 标准库（两组，2026-11-17 用户裁定）：
//   写实组 = player-female.json（16 骨 hips/spine/chest/neck/head/upperArm×/forearm×/
//            thigh×/shin×/foot×/back，本脚本先为它补写 hurt → 28 clips）
//   三头身组 = skirt-girl-chibi.json（9 骨 root/hips/torso/head/skirt/armL/armR/
//            legL/legR，30 clips，含 hurt）
//
// 补齐策略（幂等：目标已有同名 clip 保留自家，缺失才补）：
//   写实组目标：
//     player.json         ← player-female 拷 sit/sit_up/lie/lie_up/hurt（骨骼同构直拷）
//     player-humanoid.json ← player-female 拷全套（14 骨缺 back，过滤 back 轨道）
//   三头身组目标（8~9 骨简 rig，过滤 skirt 轨道）：
//     skeleton.chibi.json / refugee-man / refugee-elder-man / refugee-elder-woman /
//     refugee-woman / refugee-child / skirt-girl.json
//
// 通用兜底：所有目标资产全文档关键帧 ease 补 'linear'（显式 ease 保留；与运行时
// parseSkeletonAsset 的缺省归一一致，零行为变化，旧/新校验器都能过）。
// 排除资产：female-hero.json（整帧 LPC 模式，动作=手绘帧表无法凭空生成）、
//           demo/wolf/rabbit（非人形/演示）、templates/（本脚本产物另见 generate-skeleton-templates.mjs）。
import { readFileSync, writeFileSync } from 'node:fs';
import { validateSkeletonAsset } from '../src/core/validation/SkeletonAssetValidator.js';

const DIR = 'example/sanguo_zhangjiao/assets/skeletons';
const readAsset = name => JSON.parse(readFileSync(`${DIR}/${name}.json`, 'utf8'));
const writeAsset = (name, doc) => writeFileSync(`${DIR}/${name}.json`, `${JSON.stringify(doc, null, 2)}\n`);

const cloneClips = clips => JSON.parse(JSON.stringify(clips));

/** 过滤轨道：只保留目标骨骼集存在的 bone 轨道。 */
const filterTracks = (clips, boneIds) => clips.map(clip => ({
  ...clip,
  tracks: (clip.tracks || []).filter(track => boneIds.has(track.bone))
}));

/** 关键帧 ease 合法化（显式合法 ease 保留；缺省补 'linear'；非法值归一 'linear'——
 * 与运行时 parseSkeletonAsset 的 ease 归一一致，零行为变化）。 */
function patchEase(doc) {
  let patched = 0;
  for (const clip of doc.clips || []) {
    for (const track of clip.tracks || []) {
      for (const key of track.keys || []) {
        if (key.ease === undefined) { key.ease = 'linear'; patched += 1; }
        else if (key.ease !== 'linear' && key.ease !== 'easeInOut') { key.ease = 'linear'; patched += 1; }
      }
    }
  }
  return patched;
}

/** 合并缺失剪辑：目标已有同名 clip 保留自家，缺失才补源剪辑。 */
function mergeMissingClips(targetDoc, sourceClips) {
  const existing = new Set((targetDoc.clips || []).map(clip => clip.name));
  const added = [];
  for (const clip of sourceClips) {
    if (existing.has(clip.name)) continue;
    targetDoc.clips.push(clip);
    added.push(clip.name);
  }
  return added;
}

function processTarget(name, doc, sourceClips, boneIds) {
  const before = (doc.clips || []).length;
  const added = mergeMissingClips(doc, filterTracks(sourceClips, boneIds));
  const easePatched = patchEase(doc);
  const errors = validateSkeletonAsset(doc);
  if (errors.errors && errors.errors.length) {
    console.error(`✗ ${name} 校验失败:`, JSON.stringify(errors.errors.slice(0, 5), null, 2));
    process.exit(1);
  }
  writeAsset(name, doc);
  console.log(`✓ ${name}: clips ${before} → ${doc.clips.length}（补 ${added.length}${added.length ? ': ' + added.join(',') : ''}，ease 补 ${easePatched}）`);
}

/* ---------------- 1. 写实组：player-female 先补 hurt（本组唯一缺口） ---------------- */

const FEMALE_HURT = {
  name: 'hurt', durationMs: 260, loop: false,
  tracks: [
    { bone: 'hips', keys: [
      { t: 0, x: 0 }, { t: 90, x: -4, ease: 'easeInOut' }, { t: 260, x: 0, ease: 'easeInOut' }
    ] },
    { bone: 'spine', keys: [
      { t: 0, rot: 0 }, { t: 90, rot: -13, ease: 'easeInOut' }, { t: 260, rot: -3, ease: 'easeInOut' }
    ] },
    { bone: 'chest', keys: [
      { t: 0, rot: 0 }, { t: 90, rot: -6, ease: 'easeInOut' }, { t: 260, rot: -2, ease: 'easeInOut' }
    ] },
    { bone: 'neck', keys: [
      { t: 0, rot: 0 }, { t: 90, rot: -5, ease: 'easeInOut' }, { t: 260, rot: -1, ease: 'easeInOut' }
    ] },
    { bone: 'head', keys: [
      { t: 0, rot: 0 }, { t: 90, rot: -9, ease: 'easeInOut' }, { t: 260, rot: -2, ease: 'easeInOut' }
    ] },
    { bone: 'upperArmR', keys: [
      { t: 0, rot: 0 }, { t: 90, rot: 16, ease: 'easeInOut' }, { t: 260, rot: 4, ease: 'easeInOut' }
    ] },
    { bone: 'upperArmL', keys: [
      { t: 0, rot: 0 }, { t: 90, rot: 16, ease: 'easeInOut' }, { t: 260, rot: 4, ease: 'easeInOut' }
    ] },
    { bone: 'forearmR', keys: [
      { t: 0, rot: 0 }, { t: 90, rot: 10, ease: 'easeInOut' }, { t: 260, rot: 0, ease: 'easeInOut' }
    ] },
    { bone: 'forearmL', keys: [
      { t: 0, rot: 0 }, { t: 90, rot: 10, ease: 'easeInOut' }, { t: 260, rot: 0, ease: 'easeInOut' }
    ] }
  ]
};

const female = readAsset('player-female');
{
  const before = female.clips.length;
  const added = mergeMissingClips(female, [cloneClips([FEMALE_HURT])[0]]);
  patchEase(female);
  const errors = validateSkeletonAsset(female);
  if (errors.errors && errors.errors.length) {
    console.error('✗ player-female 校验失败:', JSON.stringify(errors.errors.slice(0, 5), null, 2));
    process.exit(1);
  }
  writeAsset('player-female', female);
  console.log(`✓ player-female: clips ${before} → ${female.clips.length}（补 ${added.length}${added.length ? ': ' + added.join(',') : ''}）`);
}
const femaleClips = cloneClips(female.clips);

/* ---------------- 2. 写实组目标：player / player-humanoid ---------------- */

{
  const doc = readAsset('player');
  processTarget('player', doc, femaleClips, new Set(doc.bones.map(b => b.id)));
}
{
  const doc = readAsset('player-humanoid');
  processTarget('player-humanoid', doc, femaleClips, new Set(doc.bones.map(b => b.id)));
}

/* ---------------- 3. 三头身组目标：简 rig 资产（标准库 = skirt-girl-chibi） ---------------- */

const chibiStandard = cloneClips(readAsset('skirt-girl-chibi').clips);
const SIMPLE_TARGETS = [
  'skeleton.chibi', 'refugee-man', 'refugee-elder-man', 'refugee-elder-woman',
  'refugee-woman', 'refugee-child', 'skirt-girl'
];
for (const name of SIMPLE_TARGETS) {
  const doc = readAsset(name);
  processTarget(name, doc, chibiStandard, new Set(doc.bones.map(b => b.id)));
}

console.log('全部资产标准化完成');
