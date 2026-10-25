/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yiji1818-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * rebuild-player-legs.mjs —— 用「脚落点 + 骨长」重建腿部三节轨（idle / walk / jump）
 *
 * ## 为什么不用手写关节角
 *
 * 新 16 骨人形 rig 的腿是「大腿 26 + 小腿 19 + 脚 7」三节骨链，膝是真转角：
 *   - 侧视：膝相对角（shin 局部 rot）必须 > 0，膝盖朝前（脚跟朝臀）才是人膝；
 *   - 正/背视：膝盖弯在前后平面（画面不可见），小腿必须竖直，否则两踝向中线交叉。
 * 旧数据把「膝盖弯」错译成左右外撇 → 用户反馈的「膝盖反关节 / 两腿交叉」。
 *
 * 本脚本改为**落点驱动**：只声明「踝（脚骨原点）应该在哪」，膝角由骨长恒等式反推。
 *   - 踝贴地 → 腿伸直（正/背视不出现膝角）
 *   - 抬脚 → 整条腿沿 y 平移（大腿骨 y = −lift），膝角保持 0
 *     （正/背视的「抬脚」在 2D 里只能靠缩短腿长表达；若用膝角表达会变成 10px 的 O 型腿）
 *   - 侧视已有正确的人膝数据（walk_side / jump_side / idle_side），本脚本不改
 *
 * ## 关节约定（SkeletonPose.composeBoneWorld：world.rot = parent.rot + local.rot）
 *   骨世界偏移 = (−L·sinθ, L·cosθ)：θ=0 竖直向下；θ<0 指向 +x（角色前方）
 *   脚骨 rest 局部 rot = −90 → 脚世界角 −90 时鞋图渲染角 = 0（鞋底水平、鞋头朝 +x）
 *   槽 rot = +90 抵消脚骨 rest 的 −90
 *
 * ## 地面常量（新骨架定值）
 *   hips rest y = −50；大腿 26 + 小腿 19 = 45 → 脚骨（踝）世界 y = −5
 *   鞋图内容距踝 5px（FOOT_ATT ly=2.8 + 鞋底半高 2.5）→ 鞋底 y = 0 恰为地面
 *
 * 幂等：每次都整体重写目标轨道，可反复运行。
 * 必须跑在 migrate-player-to-humanoid.mjs 之后（迁移脚本会重建整个 player.json）。
 *
 * 用法：node scripts/rebuild-player-legs.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/player.json');

const L1 = 26;               // 大腿骨长
const L2 = 19;               // 小腿骨长
const LEG = L1 + L2;         // 伸直腿长 45
const ANKLE_GROUND = -5;     // 踝（脚骨原点）世界 y：鞋底 = 0
const HIPS_REST_Y = -50;
const SPINE_REST_Y = -12;
const FOOT_LOCAL_FLAT = -90; // 脚世界角 −90（鞋底水平）时，小腿竖直下的脚局部 rot

/** 各形态的大腿横向挂点 [R, L]：侧视收拢、背视左右互换（与 migration §3.9 一致）。 */
const THIGH_X = {
  down: [-3.5, 3.5],
  up: [3.5, -3.5],
  side: [-2, 2],
  SE: [-3.5, 3.5], SW: [-3.5, 3.5],
  NE: [3.5, -3.5], NW: [3.5, -3.5]
};

const doc = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''));
if (!Array.isArray(doc.bones) || !doc.bones.some(b => b.id === 'thighR')) {
  throw new Error('player.json 不是新 16 骨人形 rig（缺 thighR），本脚本只处理迁移后的资产');
}

const round = v => Math.round(v * 100) / 100;
const easeOf = last => (last ? undefined : 'easeInOut');

function clipOf(name) {
  const c = doc.clips.find(x => x.name === name);
  if (!c) throw new Error(`剪辑缺失：${name}`);
  return c;
}

function putTrack(clip, bone, keys) {
  const cleaned = keys.map(k => {
    const out = { t: k.t };
    for (const f of ['x', 'y', 'rot', 'scaleX', 'scaleY']) {
      if (typeof k[f] === 'number') out[f] = round(k[f]);
    }
    if (k.ease) out.ease = k.ease;
    return out;
  });
  const tr = clip.tracks.find(t => t.bone === bone);
  if (tr) tr.keys = cleaned;
  else clip.tracks.push({ bone, keys: cleaned });
}

/**
 * 写入一条腿的三节轨。lift = 整条腿向上平移量（px，0 = 踝贴地）。
 * tilt = 鞋图旋转角（度，正 = 顺时针 / 鞋头下压；0 = 鞋底水平）。
 */
function putLeg(clip, side, form, frames) {
  const x = THIGH_X[form][side === 'R' ? 0 : 1];
  putTrack(clip, `thigh${side}`, frames.map((f, i) => ({
    t: f.t, x, y: -f.lift, rot: 0, ease: easeOf(i === frames.length - 1)
  })));
  putTrack(clip, `shin${side}`, frames.map((f, i) => ({
    t: f.t, rot: 0, ease: easeOf(i === frames.length - 1)
  })));
  putTrack(clip, `foot${side}`, frames.map((f, i) => ({
    t: f.t, rot: FOOT_LOCAL_FLAT + (f.tilt || 0), ease: easeOf(i === frames.length - 1)
  })));
}

/** hips 轨：正/背视恒定骑在伸直腿上（y = −50 → 踝 = −5 贴地）。 */
function putHipsFlat(clip, times) {
  putTrack(clip, 'hips', times.map((t, i) => ({ t, x: 0, y: HIPS_REST_Y, rot: 0, ease: easeOf(i === times.length - 1) })));
}

/** 把躯干起伏从 hips 移到 spine：骨盆守恒（脚不离地），上半身仍随步频起伏。 */
function putSpineBob(clip, times, bobs) {
  const old = clip.tracks.find(t => t.bone === 'spine')?.keys || [];
  putTrack(clip, 'spine', times.map((t, i) => {
    const src = old[i] || {};
    return { ...src, t, y: SPINE_REST_Y + bobs[i], rot: typeof src.rot === 'number' ? src.rot : 0 };
  }));
}

/* ---------------- 1. idle 正/背视：站直 + 踝贴地 ---------------- */
// 旧 idle_down 的 hips 被旧 rig 比例带到 −44.35（比 rest 低 5.65px），腿伸直 → 鞋陷进地里 5.65px。
// 改为骨盆恒定 −50、双腿伸直贴地；呼吸仍由 spine/head 轨表达。
for (const name of ['idle_down', 'idle_up']) {
  const clip = clipOf(name);
  const form = name === 'idle_down' ? 'down' : 'up';
  putHipsFlat(clip, [0]);
  const frames = [{ t: 0, lift: 0, tilt: 0 }];
  putLeg(clip, 'R', form, frames);
  putLeg(clip, 'L', form, frames);
}

/* ---------------- 2. walk 正/背/斜视：交替抬脚（整腿平移），支撑脚贴地 ---------------- */
// 抬脚量 6px：2D 正/背视里「迈步」唯一不失真的表达是缩短腿长（膝角保持 0 → 无 O 型腿）。
// 旧数据把抬脚写成大腿 y 平移 + 小腿 rot，§3.10 把小 rot 归零后脚就悬在半空（实测离地 1.2–6.2px）。
const WALK_LIFT = 6;
const WALK_SPECS = [
  { clip: 'walk_down', form: 'down', times: [0, 155, 310, 465] },
  { clip: 'walk_up', form: 'up', times: [0, 155, 310, 465] },
  { clip: 'walk_SE', form: 'SE', times: [0, 200, 400, 600] },
  { clip: 'walk_SW', form: 'SW', times: [0, 200, 400, 600] },
  { clip: 'walk_NE', form: 'NE', times: [0, 200, 400, 600] },
  { clip: 'walk_NW', form: 'NW', times: [0, 200, 400, 600] }
];
for (const spec of WALK_SPECS) {
  const clip = clipOf(spec.clip);
  const [t0, t1, t2, t3] = spec.times;
  putHipsFlat(clip, spec.times);
  // 单支撑在 t0（左腿支撑、右腿抬）与 t2（镜像）；t1/t3 双脚落地
  const liftR = [WALK_LIFT, 0, 0, 0];
  const liftL = [0, 0, WALK_LIFT, 0];
  putLeg(clip, 'R', spec.form, spec.times.map((t, i) => ({ t, lift: liftR[i], tilt: 0 })));
  putLeg(clip, 'L', spec.form, spec.times.map((t, i) => ({ t, lift: liftL[i], tilt: 0 })));
  // 躯干起伏：单支撑最高、双支撑最低（骨盆不动，起伏交给 spine）
  putSpineBob(clip, spec.times, [-1, 1, -1, 1]);
}

/* ---------------- 3. jump 正/背视：起落贴地 + 空中收腿 ---------------- */
// 旧 jump_down/up 用「大腿外撇 ±6..10° + 小腿竖直」表达腾空，正视看是持续的 O 型腿。
// 改为整腿平移收腿：起跳/落地踝贴地，空中腿自然缩短。
const JUMP_HIPS = [
  { t: 0, y: HIPS_REST_Y },
  { t: 100, y: HIPS_REST_Y + 1 },
  { t: 260, y: HIPS_REST_Y - 20 },
  { t: 380, y: HIPS_REST_Y - 1 },
  { t: 420, y: HIPS_REST_Y }
];
for (const name of ['jump_down', 'jump_up', 'jump_side']) {
  const clip = clipOf(name);
  putTrack(clip, 'hips', JUMP_HIPS.map((k, i) => ({ t: k.t, x: 0, y: k.y, rot: 0, ease: easeOf(i === JUMP_HIPS.length - 1) })));
}
for (const name of ['jump_down', 'jump_up']) {
  const clip = clipOf(name);
  const form = name === 'jump_down' ? 'down' : 'up';
  const frames = [
    { t: 0, lift: 0, tilt: 0 },
    { t: 120, lift: 6, tilt: 0 },
    { t: 300, lift: 4, tilt: 0 },
    { t: 420, lift: 0, tilt: 0 }
  ];
  putLeg(clip, 'R', form, frames);
  putLeg(clip, 'L', form, frames);
}

/* ---------------- 4. 写盘 + 校验 ---------------- */
const { parseSkeletonAsset } = await import(pathToFileURL(path.join(root, 'src/animation/SkeletonAsset.js')).href);
const { createRestLocalPose, sampleClip, composeWorldTransforms } = await import(pathToFileURL(path.join(root, 'src/animation/SkeletonPose.js')).href);
const asset = parseSkeletonAsset(doc);
const rest = createRestLocalPose(asset);

writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

/** 校验：踝贴地误差 + 正/背视膝角必须为 0。 */
const REPORT = [
  ['idle_down', 'down', [0]], ['idle_up', 'up', [0]],
  ['walk_down', 'down', [0, 155, 310, 465]], ['walk_up', 'up', [0, 155, 310, 465]],
  ['walk_SE', 'SE', [0, 200, 400, 600]], ['walk_NW', 'NW', [0, 200, 400, 600]],
  ['jump_down', 'down', [0, 120, 300, 420]], ['jump_up', 'up', [0, 120, 300, 420]]
];
let worstGround = 0;
for (const [name, , times] of REPORT) {
  const clip = asset.clips.get(name);
  for (const t of times) {
    const world = composeWorldTransforms(asset, sampleClip(clip, t, rest));
    for (const side of ['R', 'L']) {
      const th = world.get(`thigh${side}`);
      const sh = world.get(`shin${side}`);
      const ft = world.get(`foot${side}`);
      const knee = (sh.rot - th.rot) * 180 / Math.PI;
      if (Math.abs(knee) > 0.01) console.warn(`[膝角非零] ${name}@${t} ${side}: ${knee.toFixed(2)}°`);
      // 鞋底 = 踝 + 5；贴地时踝应在 −5（空中允许离地）
      const soleY = ft.y + 5;
      if (soleY > 0.01) console.warn(`[穿地] ${name}@${t} ${side}: 鞋底 y=${soleY.toFixed(2)}`);
      worstGround = Math.max(worstGround, -soleY);
    }
  }
}
console.log(`已写入 ${path.relative(root, FILE)}`);
console.log(`校验：正/背/斜视膝角全为 0；最大离地高度 ${worstGround.toFixed(2)}px（空中帧允许）`);
