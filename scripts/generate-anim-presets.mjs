/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * generate-anim-presets.mjs
 * 生成动作模板（animation presets）到 assets/skeletons/anim-presets/：
 *   humanoid：walk 8 方向（N/NE/E/SE/S/SW/W/NW）、run、jump、climb、attack_melee、attack_bow、attack_cast
 *   wolf/horse：walk、run、attack_bite（horse 无 bite 用 attack_bite 同款命名）
 *   mounted：ride_idle、ride_run
 *   siege_ram：ram_advance、ram_strike；siege_catapult：catapult_cock、catapult_launch
 *   siege_tower：tower_advance、tower_deploy
 * 预设 = { presetId, topology, clipName, durationMs, loop, tracks }（键可为部分字段：t/rot/x/y）。
 * 使用即深拷贝套用到目标骨架（按骨名匹配），与预设无数据关联（模板独立性原则）。
 * 另写 index.json（编辑器预设列表用）。用法：node scripts/generate-anim-presets.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/anim-presets');
const tplDir = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/templates');

/* ---- 键/轨道快捷构造 ---- */
// 键值是绝对局部值（采样时直接替换 rest），位移类键必须基于目标骨骼 rest 基准展开。
const HUMANOID_HIPS_REST_Y = -26;   // tpl.humanoid hips rest y
const RIDER_TORSO_REST_Y = -8;      // tpl.mounted rider_torso rest y
const k = (t, extra = {}) => ({ t, ease: 'easeInOut', ...extra });       // 部分字段键
const klin = (t, extra = {}) => ({ t, ease: 'linear', ...extra });       // 线性（轮转等）
const tr = (boneId, keys) => ({ bone: boneId, keys });
/** 对称摆动轨道：0 → +amp → 回 0（或相位翻转）。 */
const swing = (boneId, amp, dur, { phase = 0, ease = 'easeInOut' } = {}) => {
  const half = dur / 2;
  const keys = phase === 0
    ? [k(0, { rot: amp }), k(half, { rot: -amp }), k(dur, { rot: amp })]
    : [k(0, { rot: -amp }), k(half, { rot: amp }), k(dur, { rot: -amp })];
  return tr(boneId, keys.map(x => ({ ...x, ease })));
};
/** 上下起伏（y 偏移，负=向上）。baseY=骨骼 rest y——键值是绝对局部值，必须基于 rest 展开。 */
const bob = (boneId, amp, dur, baseY = 0) => tr(boneId, [
  k(0, { y: baseY }), k(dur * 0.25, { y: baseY - amp }), k(dur * 0.5, { y: baseY }),
  k(dur * 0.75, { y: baseY - amp }), k(dur, { y: baseY })
]);

/* ---- 人形步行（按方向参数化：正面小幅/侧面大幅/对角折中） ---- */
/** dir: S/N 正面视角小幅；E/W 侧面大幅；NE/SE/NW/SW 对角中等。 */
function walkTracks(dir, { dur = 800, amp = null, bobAmp = 2, torsoAmp = 2 } = {}) {
  const FRONT = ['S', 'N'];
  const SIDE = ['E', 'W'];
  const resolvedAmp = amp ?? (FRONT.includes(dir) ? 6 : SIDE.includes(dir) ? 22 : 14);
  const flip = ['W', 'N', 'NW', 'SW'].includes(dir) ? 1 : 0; // 相位翻转区分左右/前后
  const armAmp = FRONT.includes(dir) ? 10 : resolvedAmp * 0.7;
  const legPhase = flip ? 1 : 0;
  const armPhase = flip ? 0 : 1;
  const tracks = [
    swing('thighL', resolvedAmp, dur, { phase: legPhase }),
    swing('thighR', resolvedAmp, dur, { phase: 1 - legPhase }),
    swing('calfL', resolvedAmp * 0.6, dur, { phase: 1 - legPhase }),
    swing('calfR', resolvedAmp * 0.6, dur, { phase: legPhase }),
    swing('armUL', armAmp, dur, { phase: armPhase }),
    swing('armUR', armAmp, dur, { phase: 1 - armPhase }),
    bob('hips', bobAmp, dur, HUMANOID_HIPS_REST_Y),
    swing('torso', torsoAmp, dur, { phase: legPhase })
  ];
  return tracks;
}
const runTracks = (dir, { dur = 480 } = {}) => {
  const FRONT = ['S', 'N'];
  const amp = FRONT.includes(dir) ? 9 : ['E', 'W'].includes(dir) ? 30 : 19;
  const flip = ['W', 'N', 'NW', 'SW'].includes(dir) ? 1 : 0;
  return [
    swing('thighL', amp, dur, { phase: flip }),
    swing('thighR', amp, dur, { phase: 1 - flip }),
    swing('calfL', amp * 0.9, dur, { phase: 1 - flip }),
    swing('calfR', amp * 0.9, dur, { phase: flip }),
    swing('armUL', amp * 0.8, dur, { phase: 1 - flip }),
    swing('armUR', amp * 0.8, dur, { phase: flip }),
    tr('torso', [k(0, { rot: 6 }), k(dur / 2, { rot: 3 }), k(dur, { rot: 6 })]),
    bob('hips', 3, dur, HUMANOID_HIPS_REST_Y)
  ];
};

/* ---- 四足步行（对角步态：FL+HR 同相，FR+HL 反相） ---- */
const quadrupedWalk = ({ dur = 700, amp = 20 }) => [
  swing('legFL_upper', amp, dur, { phase: 0 }), swing('legHR_upper', amp, dur, { phase: 0 }),
  swing('legFR_upper', amp, dur, { phase: 1 }), swing('legHL_upper', amp, dur, { phase: 1 }),
  swing('legFL_lower', amp * 0.5, dur, { phase: 1 }), swing('legHR_lower', amp * 0.5, dur, { phase: 1 }),
  swing('legFR_lower', amp * 0.5, dur, { phase: 0 }), swing('legHL_lower', amp * 0.5, dur, { phase: 0 }),
  swing('head', 3, dur, { phase: 1 }), swing('tail1', 10, dur), swing('tail2', 14, dur)
];

/* ---- 预设清单 ---- */
const DIRS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];
const PRESETS = [];

// humanoid：八方向 walk + run + jump/climb/三攻击
for (const dir of DIRS) {
  PRESETS.push({
    presetId: `humanoid.walk_${dir}`, topology: 'humanoid', clipName: `walk_${dir}`,
    durationMs: 800, loop: true, tracks: walkTracks(dir)
  });
}
for (const dir of DIRS) {
  PRESETS.push({
    presetId: `humanoid.run_${dir}`, topology: 'humanoid', clipName: `run_${dir}`,
    durationMs: 480, loop: true, tracks: runTracks(dir)
  });
}
PRESETS.push(
  {
    presetId: 'humanoid.jump', topology: 'humanoid', clipName: 'jump', durationMs: 900, loop: false,
    tracks: [
      tr('hips', [k(0, { y: 0 }), k(150, { y: 4 }), k(350, { y: -14 }), k(600, { y: -10 }), k(750, { y: 0 }), k(900, { y: 0 })]),
      tr('thighL', [k(0), k(150, { rot: 35 }), k(350, { rot: -10 }), k(600, { rot: -20 }), k(750), k(900)]),
      tr('thighR', [k(0), k(150, { rot: 35 }), k(350, { rot: -10 }), k(600, { rot: -20 }), k(750), k(900)]),
      tr('calfL', [k(0), k(150, { rot: -45 }), k(350, { rot: 15 }), k(600, { rot: -25 }), k(750), k(900)]),
      tr('calfR', [k(0), k(150, { rot: -45 }), k(350, { rot: 15 }), k(600, { rot: -25 }), k(750), k(900)]),
      tr('armUL', [k(0), k(150, { rot: 30 }), k(350, { rot: -50 }), k(750), k(900)]),
      tr('armUR', [k(0), k(150, { rot: 30 }), k(350, { rot: -50 }), k(750), k(900)]),
      tr('torso', [k(0), k(150, { rot: 8 }), k(350, { rot: -6 }), k(900)])
    ]
  },
  {
    presetId: 'humanoid.climb', topology: 'humanoid', clipName: 'climb', durationMs: 900, loop: true,
    tracks: [
      tr('armUL', [...swing('armUL', 20, 900, { phase: 0 }).keys.map(x => ({ ...x, rot: x.rot - 80 }))]),
      tr('armUR', [...swing('armUR', 20, 900, { phase: 1 }).keys.map(x => ({ ...x, rot: x.rot - 80 }))]),
      tr('armFL', [k(0, { rot: 15 }), k(450, { rot: 25 }), k(900, { rot: 15 })]),
      tr('armFR', [k(0, { rot: 25 }), k(450, { rot: 15 }), k(900, { rot: 25 })]),
      swing('thighL', 20, 900, { phase: 1 }), swing('thighR', 20, 900, { phase: 0 }),
      tr('calfL', [k(0, { rot: -30 }), k(450, { rot: -10 }), k(900, { rot: -30 })]),
      tr('calfR', [k(0, { rot: -10 }), k(450, { rot: -30 }), k(900, { rot: -10 })]),
      tr('hips', [k(0, { y: 0 }), k(225, { y: -4 }), k(450, { y: 0 }), k(675, { y: -4 }), k(900, { y: 0 })])
    ]
  },
  {
    presetId: 'humanoid.attack_melee', topology: 'humanoid', clipName: 'attack_melee', durationMs: 700, loop: false,
    tracks: [
      tr('armUR', [k(0), k(150, { rot: -55 }), k(350, { rot: 60 }), k(550, { rot: 20 }), k(700)]),
      tr('armFR', [k(0), k(150, { rot: -20 }), k(350, { rot: 15 }), k(550, { rot: 10 }), k(700)]),
      tr('armUL', [k(0), k(350, { rot: 25 }), k(700)]),
      tr('torso', [k(0), k(150, { rot: -10 }), k(350, { rot: 14 }), k(700)])
    ]
  },
  {
    presetId: 'humanoid.attack_bow', topology: 'humanoid', clipName: 'attack_bow', durationMs: 900, loop: false,
    tracks: [
      tr('armUL', [k(0), k(200, { rot: -85 }), k(700, { rot: -85 }), k(900)]),
      tr('armFL', [k(0), k(200, { rot: -15 }), k(700, { rot: -15 }), k(900)]),
      tr('armUR', [k(0), k(150, { rot: -70 }), k(350, { rot: -78 }), k(550, { rot: -60 }), k(650, { rot: -85 }), k(900)]),
      tr('armFR', [k(0), k(150, { rot: -30 }), k(550, { rot: -20 }), k(650, { rot: -35 }), k(900)]),
      tr('torso', [k(0), k(200, { rot: -6 }), k(900)])
    ]
  },
  {
    presetId: 'humanoid.attack_cast', topology: 'humanoid', clipName: 'attack_cast', durationMs: 900, loop: false,
    tracks: [
      tr('armUL', [k(0), k(250, { rot: -95 }), k(500, { rot: -100 }), k(700, { rot: -80 }), k(900)]),
      tr('armUR', [k(0), k(250, { rot: -95 }), k(500, { rot: -100 }), k(700, { rot: -80 }), k(900)]),
      tr('armFL', [k(0), k(250, { rot: -25 }), k(500, { rot: -30 }), k(700, { rot: -10 }), k(900)]),
      tr('armFR', [k(0), k(250, { rot: -25 }), k(500, { rot: -30 }), k(700, { rot: -10 }), k(900)]),
      tr('torso', [k(0), k(250, { rot: -5 }), k(500, { rot: -8 }), k(900)]),
      tr('head', [k(0), k(500, { rot: 6 }), k(900)])
    ]
  }
);

// wolf / horse：四足 walk/run/attack_bite
for (const [topology, walkDur, walkAmp, runDur] of [['wolf', 700, 20, 450], ['horse', 800, 18, 500]]) {
  PRESETS.push(
    {
      presetId: `${topology}.walk`, topology, clipName: 'walk', durationMs: walkDur, loop: true,
      tracks: quadrupedWalk({ dur: walkDur, amp: walkAmp })
    },
    {
      presetId: `${topology}.run`, topology, clipName: 'run', durationMs: runDur, loop: true,
      tracks: [...quadrupedWalk({ dur: runDur, amp: 30 }), tr('spine', [k(0, { rot: 4 }), k(runDur / 2, { rot: 2 }), k(runDur, { rot: 4 })])]
    },
    {
      presetId: `${topology}.attack_bite`, topology, clipName: 'attack_bite', durationMs: 600, loop: false,
      tracks: [
        // wolf 有 jaw 骨；horse 以颈部前探代替
        ...(topology === 'wolf'
          ? [tr('jaw', [k(0), k(200, { rot: 28 }), k(350, { rot: 4 }), k(600)])]
          : [tr('neck1', [k(0), k(200, { rot: -6 }), k(350, { rot: 8 }), k(600)])]),
        tr('head', [k(0), k(200, { rot: -8 }), k(350, { rot: 10 }), k(600)]),
        tr('chest', [k(0, { x: 0 }), k(200, { x: 3 }), k(350, { x: 6 }), k(600, { x: 0 })])
      ]
    }
  );
}

// mounted：骑乘（马步态 + rider 随动）
PRESETS.push(
  {
    presetId: 'mounted.ride_idle', topology: 'mounted', clipName: 'ride_idle', durationMs: 1600, loop: true,
    tracks: [
      swing('spine', 2, 1600), swing('neck1', 3, 1600), swing('tail1', 8, 1600),
      swing('rider_torso', 2, 1600, { phase: 1 }), swing('rider_head', 3, 1600),
      swing('rider_armUL', 3, 1600, { phase: 1 }), swing('rider_armUR', 3, 1600)
    ]
  },
  {
    presetId: 'mounted.ride_run', topology: 'mounted', clipName: 'ride_run', durationMs: 600, loop: true,
    tracks: [
      swing('legFL_upper', 25, 600, { phase: 0 }), swing('legHR_upper', 25, 600, { phase: 0 }),
      swing('legFR_upper', 25, 600, { phase: 1 }), swing('legHL_upper', 25, 600, { phase: 1 }),
      swing('legFL_lower', 12, 600, { phase: 1 }), swing('legHR_lower', 12, 600, { phase: 1 }),
      swing('legFR_lower', 12, 600, { phase: 0 }), swing('legHL_lower', 12, 600, { phase: 0 }),
      tr('rider_torso', [k(0, { rot: 8 }), k(300, { rot: 5 }), k(600, { rot: 8 })]),
      tr('rider_armUL', [k(0, { rot: -20 }), k(600, { rot: -20 })]),
      tr('rider_armUR', [k(0, { rot: -20 }), k(600, { rot: -20 })]),
      bob('rider_torso', 2, 600, RIDER_TORSO_REST_Y)
    ]
  }
);

// 攻城器械
PRESETS.push(
  {
    presetId: 'siege_ram.ram_advance', topology: 'siege_ram', clipName: 'ram_advance', durationMs: 1000, loop: true,
    tracks: [
      tr('wheelFL', [klin(0, { rot: 0 }), klin(1000, { rot: 360 })]),
      tr('wheelBL', [klin(0, { rot: 0 }), klin(1000, { rot: 360 })]),
      tr('wheelFR', [klin(0, { rot: 0 }), klin(1000, { rot: 360 })]),
      tr('wheelBR', [klin(0, { rot: 0 }), klin(1000, { rot: 360 })]),
      swing('ram_arm', 4, 1000)
    ]
  },
  {
    presetId: 'siege_ram.ram_strike', topology: 'siege_ram', clipName: 'ram_strike', durationMs: 900, loop: true,
    tracks: [tr('ram_arm', [k(0), k(250, { rot: -38 }), k(450, { rot: 32 }), k(650), k(900)])]
  },
  {
    presetId: 'siege_catapult.catapult_cock', topology: 'siege_catapult', clipName: 'catapult_cock', durationMs: 1400, loop: false,
    tracks: [
      tr('throw_arm', [k(0, { rot: -30 }), k(1400, { rot: -72 })]),
      tr('sling', [k(0), k(1400, { rot: 8 })]),
      tr('counterweight', [k(0), k(1400, { rot: -6 })]),
      tr('frame_winch', [k(0), k(1400, { rot: 20 })])
    ]
  },
  {
    presetId: 'siege_catapult.catapult_launch', topology: 'siege_catapult', clipName: 'catapult_launch', durationMs: 800, loop: false,
    tracks: [
      tr('throw_arm', [k(0, { rot: -72 }), k(120, { rot: 38 }), k(300, { rot: 20 }), k(800, { rot: -30 })]),
      tr('sling', [k(0, { rot: 8 }), k(120, { rot: -25 }), k(300), k(800)]),
      tr('counterweight', [k(0, { rot: -6 }), k(120, { rot: 24 }), k(300, { rot: 10 }), k(800)])
    ]
  },
  {
    presetId: 'siege_tower.tower_advance', topology: 'siege_tower', clipName: 'tower_advance', durationMs: 1200, loop: true,
    tracks: [
      tr('wheelFL', [klin(0, { rot: 0 }), klin(1200, { rot: 360 })]),
      tr('wheelBL', [klin(0, { rot: 0 }), klin(1200, { rot: 360 })]),
      tr('wheelFR', [klin(0, { rot: 0 }), klin(1200, { rot: 360 })]),
      tr('wheelBR', [klin(0, { rot: 0 }), klin(1200, { rot: 360 })]),
      swing('towerL3', 1, 1200), swing('top_platform', 1, 1200, { phase: 1 })
    ]
  },
  {
    presetId: 'siege_tower.tower_deploy', topology: 'siege_tower', clipName: 'tower_deploy', durationMs: 1000, loop: false,
    tracks: [
      tr('shield_front', [k(0), k(600, { rot: -18 }), k(1000, { rot: -18 })]),
      tr('towerL1', [k(0), k(600, { rot: 2 }), k(1000)]),
      tr('top_platform', [k(0), k(600, { rot: -2 }), k(1000)])
    ]
  }
);

/* ---- 校验：轨道骨必须存在于对应拓扑模板；键时间单调且不越界 ---- */
const tplBones = new Map();
for (const [topology] of [['humanoid'], ['wolf'], ['horse'], ['mounted'], ['siege_ram'], ['siege_catapult'], ['siege_tower']]) {
  const tpl = JSON.parse(fs.readFileSync(path.join(tplDir, `tpl.${topology}.json`), 'utf8'));
  tplBones.set(topology, new Set(tpl.bones.map(b => b.id)));
}
for (const preset of PRESETS) {
  const bones = tplBones.get(preset.topology);
  if (!bones) throw new Error(`未知拓扑: ${preset.topology}`);
  for (const track of preset.tracks) {
    if (!bones.has(track.bone)) throw new Error(`${preset.presetId}: 轨道骨 ${track.bone} 不在 tpl.${preset.topology} 拓扑中`);
    let prev = -1;
    for (const key of track.keys) {
      if (key.t < prev) throw new Error(`${preset.presetId}/${track.bone}: 关键帧时间非单调`);
      if (key.t > preset.durationMs) throw new Error(`${preset.presetId}/${track.bone}: 关键帧越界`);
      prev = key.t;
    }
  }
}

/* ---- 落盘 + index.json ---- */
fs.mkdirSync(outDir, { recursive: true });
for (const preset of PRESETS) {
  fs.writeFileSync(path.join(outDir, `${preset.presetId}.json`), `${JSON.stringify(preset, null, 2)}\n`);
}
const index = PRESETS.map(({ presetId, topology, clipName, durationMs, loop }) => ({ presetId, topology, clipName, durationMs, loop }));
fs.writeFileSync(path.join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`✓ ${PRESETS.length} 个动作预设 + index.json → ${path.relative(root, outDir)}`);
