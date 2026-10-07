// 程序化生成玩家/示范骨骼资产。
// 玩家：完整全身骨骼方案（Spine 式 rig，13 骨骼 + 16 槽位，身体各段全部部件化，
//       动画由骨骼关键帧驱动，不再依赖整身帧表）。
// 狼示范：保留简单 rig（body sequence 帧表槽位，验证混合模式）。
// 用法：node scripts/gen-player-skeleton.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT_DIR = 'example/sanguo_zhangjiao/assets/skeletons';

/** 关键帧工具：以 durationMs 均分 n 段采样 fn(i, tMs) */
function loopTrack(bone, durationMs, samples) {
  const keys = samples.map((value, index) => ({ t: Math.round((index / samples.length) * durationMs), ...value }));
  return { bone, keys };
}

function clip(name, durationMs, loop, tracks) {
  return { name, durationMs, loop, tracks };
}

/* ============================================================
 * 玩家：完整全身骨骼
 * 世界系：root(0,0)=脚底中心，y 向下为正（负值向上）。
 * 部件世界坐标 = 骨骼 + (图内坐标 - pivot)。
 *
 * 骨骼树：
 *   root(0,0)
 *   └─ hips(0,-26)                     髋
 *      ├─ torso(0,-2)   → 世界-28      腰（躯干底）
 *      │  └─ head(0,-20) → 世界-48     颈
 *      ├─ armUL(±7,-16)  → 世界(±7,-44) 肩（挂 torso）
 *      │  └─ armF(0,12)  → 世界(±7,-32) 肘
 *      ├─ thigh(±5,-1)   → 世界(±5,-27) 髋关节
 *      │  └─ calf(0,13)  → 世界(±5,-14) 膝
 *      └─ back(0,-14)    → 世界(0,-40)  背（长矛）
 *
 * 附件偏移：att = (32-px, 32-py)，pivot(px,py)=部件钉点。
 *   头 pivot 底中 (32,24) → (0,8)；躯干 pivot 底中 (32,30) → (0,2)；
 *   臂/腿 pivot 顶中 (32,4) → (0,28)；裙 pivot 顶中 (32,6) → (0,26)；
 *   斧握点 (32,10) → (2,36)（挂 armFR：握点世界 -18，柄 18px 尾不插地）；
 *   矛中心 (32,32) → (3,0)（背面时由映射器取反 x 镜像）。
 * 槽位渲染按数组顺序；headFront/HeadSide/HeadBack 三态由状态映射器按方向切换 visible。
 * ============================================================ */
function buildPlayerSkeleton() {
  const bones = [
    { id: 'root', parent: null, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 16 },
    { id: 'hips', parent: 'root', x: 0, y: -26, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'torso', parent: 'hips', x: 0, y: -2, rot: 0, scaleX: 1, scaleY: 1, length: 20 },
    { id: 'head', parent: 'torso', x: 0, y: -20, rot: 0, scaleX: 1, scaleY: 1, length: 16 },
    { id: 'armUL', parent: 'torso', x: -7, y: -16, rot: 0, scaleX: 1, scaleY: 1, length: 12 },
    { id: 'armUR', parent: 'torso', x: 7, y: -16, rot: 0, scaleX: 1, scaleY: 1, length: 12 },
    { id: 'armFL', parent: 'armUL', x: 0, y: 12, rot: 0, scaleX: 1, scaleY: 1, length: 13 },
    { id: 'armFR', parent: 'armUR', x: 0, y: 12, rot: 0, scaleX: 1, scaleY: 1, length: 13 },
    { id: 'thighL', parent: 'hips', x: -5, y: -1, rot: 0, scaleX: 1, scaleY: 1, length: 13 },
    { id: 'thighR', parent: 'hips', x: 5, y: -1, rot: 0, scaleX: 1, scaleY: 1, length: 13 },
    { id: 'calfL', parent: 'thighL', x: 0, y: 13, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'calfR', parent: 'thighR', x: 0, y: 13, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'back', parent: 'hips', x: 0, y: -14, rot: 0, scaleX: 1, scaleY: 1, length: 10 }
  ];

  const img = (assetId, x, y, visible = true) => (
    { type: 'image', assetId, x, y, rot: 0, width: 64, height: 64, visible }
  );
  const slots = [
    { id: 'shadow', bone: 'root', z: 0, attachment: { type: 'empty' } },
    { id: 'spearBack', bone: 'back', z: 1, attachment: img('player.parts.weapon-spear', 3, 0) },
    { id: 'skirtBack', bone: 'torso', z: 2, attachment: img('player.parts.skirt-back', 0, 22) },
    // 斧画在两臂之下层：前臂/手覆盖斧柄上段 → 手握斧视觉
    { id: 'toolHand', bone: 'armFR', z: 3, attachment: img('player.parts.weapon-axe', 5, 30) },
    { id: 'armUL', bone: 'armUL', z: 3, attachment: img('player.parts.upper-arm-l', 0, 28) },
    { id: 'armFL', bone: 'armFL', z: 3, attachment: img('player.parts.fore-arm-l', 0, 28) },
    { id: 'armUR', bone: 'armUR', z: 4, attachment: img('player.parts.upper-arm-r', 0, 28) },
    { id: 'armFR', bone: 'armFR', z: 4, attachment: img('player.parts.fore-arm-r', 0, 28) },
    { id: 'torsoSlot', bone: 'torso', z: 5, attachment: img('player.parts.torso', 0, 2) },
    { id: 'skirtFront', bone: 'torso', z: 6, attachment: img('player.parts.skirt-front', 0, 22) },
    { id: 'headFront', bone: 'head', z: 7, attachment: img('player.parts.head-front', 0, 8, true) },
    { id: 'headSide', bone: 'head', z: 7, attachment: img('player.parts.head-side', 0, 8, false) },
    { id: 'headBack', bone: 'head', z: 7, attachment: img('player.parts.head-back', 0, 8, false) },
    { id: 'armor', bone: 'torso', z: 9, attachment: { type: 'empty', x: 0, y: 0, rot: 0 } }
  ];

  const clips = [];
  // 待机（3 方向）：呼吸起伏 + 头/臂微摆
  for (const dir of ['down', 'up', 'side']) {
    clips.push(clip(`idle_${dir}`, 1800, true, [
      loopTrack('torso', 1800, [
        { y: -2 }, { y: -3.5, ease: 'easeInOut' }, { y: -2, ease: 'easeInOut' }
      ]),
      loopTrack('head', 1800, [
        { rot: 0 }, { rot: dir === 'side' ? 3 : 4, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('armUL', 1800, [
        { rot: 0 }, { rot: 3, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('armUR', 1800, [
        { rot: 0 }, { rot: -3, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('armFL', 1800, [
        { rot: 0 }, { rot: 2, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('armFR', 1800, [
        { rot: 0 }, { rot: -2, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ])
    ]));
  }
  // 行走（3 方向）：髋/膝/臂交替摆 + 躯干起伏（摆幅按像素可见性调大）
  for (const dir of ['down', 'up', 'side']) {
    const stride = dir === 'side' ? 30 : 22;
    clips.push(clip(`walk_${dir}`, 620, true, [
      loopTrack('root', 620, [
        { y: 0 }, { y: -3, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }, { y: -3, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }
      ]),
      loopTrack('torso', 620, [
        { rot: -3 }, { rot: 3, ease: 'easeInOut' }, { rot: -3, ease: 'easeInOut' }
      ]),
      loopTrack('thighL', 620, [
        { rot: -stride }, { rot: stride, ease: 'easeInOut' }, { rot: -stride, ease: 'easeInOut' }
      ]),
      loopTrack('calfL', 620, [
        { rot: -stride * 0.8 }, { rot: -2, ease: 'easeInOut' }, { rot: -stride * 0.8, ease: 'easeInOut' }
      ]),
      loopTrack('thighR', 620, [
        { rot: stride }, { rot: -stride, ease: 'easeInOut' }, { rot: stride, ease: 'easeInOut' }
      ]),
      loopTrack('calfR', 620, [
        { rot: -2 }, { rot: -stride * 0.8, ease: 'easeInOut' }, { rot: -2, ease: 'easeInOut' }
      ]),
      loopTrack('armUL', 620, [
        { rot: stride * 0.8 }, { rot: -stride * 0.8, ease: 'easeInOut' }, { rot: stride * 0.8, ease: 'easeInOut' }
      ]),
      loopTrack('armUR', 620, [
        { rot: -stride * 0.8 }, { rot: stride * 0.8, ease: 'easeInOut' }, { rot: -stride * 0.8, ease: 'easeInOut' }
      ]),
      loopTrack('armFL', 620, [
        { rot: stride * 0.28 }, { rot: -stride * 0.28, ease: 'easeInOut' }, { rot: stride * 0.28, ease: 'easeInOut' }
      ]),
      loopTrack('armFR', 620, [
        { rot: -stride * 0.28 }, { rot: stride * 0.28, ease: 'easeInOut' }, { rot: -stride * 0.28, ease: 'easeInOut' }
      ])
    ]));
  }
  // 跳跃：蓄力-腾空-落地（非循环）
  clips.push(clip('jump', 420, false, [
    { bone: 'root', keys: [
      { t: 0, y: 2 }, { t: 100, y: 3 }, { t: 260, y: -20, ease: 'easeInOut' }, { t: 380, y: 0, ease: 'easeInOut' }, { t: 420, y: 0 }
    ] },
    { bone: 'thighL', keys: [ { t: 0, rot: 0 }, { t: 120, rot: 20 }, { t: 300, rot: 10 }, { t: 420, rot: 0 } ] },
    { bone: 'thighR', keys: [ { t: 0, rot: 0 }, { t: 120, rot: -20 }, { t: 300, rot: -10 }, { t: 420, rot: 0 } ] },
    { bone: 'calfL', keys: [ { t: 0, rot: 0 }, { t: 120, rot: -26 }, { t: 300, rot: -10 }, { t: 420, rot: 0 } ] },
    { bone: 'calfR', keys: [ { t: 0, rot: 0 }, { t: 120, rot: -26 }, { t: 300, rot: -10 }, { t: 420, rot: 0 } ] },
    { bone: 'armUL', keys: [ { t: 0, rot: 0 }, { t: 140, rot: -46 }, { t: 420, rot: 0 } ] },
    { bone: 'armUR', keys: [ { t: 0, rot: 0 }, { t: 140, rot: 46 }, { t: 420, rot: 0 } ] }
  ]));
  // 攻击：右臂挥砍（侧向+翻转覆盖全向）
  clips.push(clip('attack', 400, false, [
    { bone: 'armUR', keys: [ { t: 0, rot: -70 }, { t: 160, rot: 55, ease: 'easeInOut' }, { t: 400, rot: 0, ease: 'easeInOut' } ] },
    { bone: 'armFR', keys: [ { t: 0, rot: -10 }, { t: 160, rot: 20, ease: 'easeInOut' }, { t: 400, rot: 0, ease: 'easeInOut' } ] },
    { bone: 'torso', keys: [ { t: 0, rot: -8 }, { t: 160, rot: 10, ease: 'easeInOut' }, { t: 400, rot: 0, ease: 'easeInOut' } ] }
  ]));
  // 采集（弯腰拾取，循环）
  clips.push(clip('gather', 900, true, [
    { bone: 'torso', keys: [ { t: 0, rot: 0 }, { t: 450, rot: 34, ease: 'easeInOut' }, { t: 900, rot: 0, ease: 'easeInOut' } ] },
    { bone: 'armUR', keys: [ { t: 0, rot: 0 }, { t: 450, rot: 62, ease: 'easeInOut' }, { t: 900, rot: 0, ease: 'easeInOut' } ] },
    { bone: 'armFR', keys: [ { t: 0, rot: 0 }, { t: 450, rot: 18, ease: 'easeInOut' }, { t: 900, rot: 0, ease: 'easeInOut' } ] }
  ]));
  // 伐木（举斧重劈，循环）
  clips.push(clip('logging', 1100, true, [
    { bone: 'armUR', keys: [ { t: 0, rot: -95, ease: 'easeInOut' }, { t: 480, rot: 70, ease: 'easeInOut' }, { t: 1100, rot: -95, ease: 'easeInOut' } ] },
    { bone: 'armFR', keys: [ { t: 0, rot: -20, ease: 'easeInOut' }, { t: 480, rot: 15, ease: 'easeInOut' }, { t: 1100, rot: -20, ease: 'easeInOut' } ] },
    { bone: 'torso', keys: [ { t: 0, rot: -6 }, { t: 480, rot: 16, ease: 'easeInOut' }, { t: 1100, rot: -6, ease: 'easeInOut' } ] }
  ]));
  // 挖矿（短促连凿，循环）
  clips.push(clip('mining', 800, true, [
    { bone: 'armUR', keys: [ { t: 0, rot: -70 }, { t: 300, rot: 55, ease: 'easeInOut' }, { t: 800, rot: -70, ease: 'easeInOut' } ] },
    { bone: 'armFR', keys: [ { t: 0, rot: -8 }, { t: 300, rot: 12, ease: 'easeInOut' }, { t: 800, rot: -8, ease: 'easeInOut' } ] },
    { bone: 'armUL', keys: [ { t: 0, rot: -30 }, { t: 300, rot: -10, ease: 'easeInOut' }, { t: 800, rot: -30, ease: 'easeInOut' } ] }
  ]));
  // 钓鱼（甩竿-持竿，循环）
  clips.push(clip('fishing', 2200, true, [
    { bone: 'armUR', keys: [ { t: 0, rot: -40, ease: 'easeInOut' }, { t: 300, rot: 30, ease: 'easeInOut' }, { t: 2200, rot: -12, ease: 'easeInOut' } ] },
    { bone: 'armFR', keys: [ { t: 0, rot: -15, ease: 'easeInOut' }, { t: 300, rot: 20, ease: 'easeInOut' }, { t: 2200, rot: 0, ease: 'easeInOut' } ] },
    { bone: 'torso', keys: [ { t: 0, rot: 0 }, { t: 300, rot: 4, ease: 'easeInOut' }, { t: 2200, rot: 2, ease: 'easeInOut' } ] }
  ]));
  // 背向攀爬（交替上爬，循环）
  clips.push(clip('climb_back', 700, true, [
    loopTrack('root', 700, [
      { y: 0 }, { y: -3, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }
    ]),
    loopTrack('armUL', 700, [
      { rot: -55 }, { rot: -95, ease: 'easeInOut' }, { rot: -55, ease: 'easeInOut' }
    ]),
    loopTrack('armUR', 700, [
      { rot: -95 }, { rot: -55, ease: 'easeInOut' }, { rot: -95, ease: 'easeInOut' }
    ]),
    loopTrack('thighL', 700, [
      { rot: 25 }, { rot: -5, ease: 'easeInOut' }, { rot: 25, ease: 'easeInOut' }
    ]),
    loopTrack('thighR', 700, [
      { rot: -5 }, { rot: 25, ease: 'easeInOut' }, { rot: -5, ease: 'easeInOut' }
    ]),
    loopTrack('calfL', 700, [
      { rot: -10 }, { rot: 0, ease: 'easeInOut' }, { rot: -10, ease: 'easeInOut' }
    ]),
    loopTrack('calfR', 700, [
      { rot: 0 }, { rot: -10, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
    ])
  ]));
  // 睡觉（全身躺平 + 呼吸，循环）：hips 旋转 85° 使全身沿地面平躺
  clips.push(clip('sleep', 2400, true, [
    { bone: 'hips', keys: [ { t: 0, rot: 85, y: -8 }, { t: 1200, rot: 87, y: -9, ease: 'easeInOut' }, { t: 2400, rot: 85, y: -8, ease: 'easeInOut' } ] },
    { bone: 'head', keys: [ { t: 0, rot: 6 }, { t: 1200, rot: 8, ease: 'easeInOut' }, { t: 2400, rot: 6, ease: 'easeInOut' } ] },
    { bone: 'thighL', keys: [ { t: 0, rot: 8 } ] },
    { bone: 'thighR', keys: [ { t: 0, rot: -6 } ] },
    { bone: 'calfL', keys: [ { t: 0, rot: -4 } ] },
    { bone: 'calfR', keys: [ { t: 0, rot: 4 } ] },
    { bone: 'armUL', keys: [ { t: 0, rot: 15 } ] },
    { bone: 'armUR', keys: [ { t: 0, rot: -15 } ] }
  ]));
  // 躺担架（平躺被抬，循环微晃）
  clips.push(clip('stretcher', 1200, true, [
    { bone: 'hips', keys: [ { t: 0, rot: 88, y: -10 }, { t: 600, rot: 86, y: -11, ease: 'easeInOut' }, { t: 1200, rot: 88, y: -10, ease: 'easeInOut' } ] },
    { bone: 'root', keys: [ { t: 0, y: -6 }, { t: 600, y: -8, ease: 'easeInOut' }, { t: 1200, y: -6, ease: 'easeInOut' } ] },
    { bone: 'thighL', keys: [ { t: 0, rot: 6 } ] },
    { bone: 'thighR', keys: [ { t: 0, rot: -6 } ] }
  ]));
  // 死亡倒下（非循环：前倾倒地——躯干/髋依次旋转，全身落地）
  clips.push(clip('death', 520, false, [
    { bone: 'hips', keys: [ { t: 0, rot: 0, y: -26 }, { t: 380, rot: 85, y: -8, ease: 'easeInOut' }, { t: 520, rot: 85, y: -8 } ] },
    { bone: 'torso', keys: [ { t: 0, rot: 0 }, { t: 260, rot: 18, ease: 'easeInOut' }, { t: 380, rot: 4, ease: 'easeInOut' }, { t: 520, rot: 4 } ] },
    { bone: 'head', keys: [ { t: 0, rot: 0 }, { t: 380, rot: 16, ease: 'easeInOut' }, { t: 520, rot: 16 } ] },
    { bone: 'thighL', keys: [ { t: 0, rot: 0 }, { t: 380, rot: 10, ease: 'easeInOut' }, { t: 520, rot: 10 } ] },
    { bone: 'thighR', keys: [ { t: 0, rot: 0 }, { t: 380, rot: -8, ease: 'easeInOut' }, { t: 520, rot: -8 } ] },
    { bone: 'armUL', keys: [ { t: 0, rot: 0 }, { t: 380, rot: 30, ease: 'easeInOut' }, { t: 520, rot: 30 } ] },
    { bone: 'armUR', keys: [ { t: 0, rot: 0 }, { t: 380, rot: -30, ease: 'easeInOut' }, { t: 520, rot: -30 } ] },
    { bone: 'root', keys: [ { t: 0, y: 0 }, { t: 380, y: 2, ease: 'easeInOut' }, { t: 520, y: 2 } ] }
  ]));
  // 灵魂悬浮（缓慢起伏漂移，循环）
  clips.push(clip('soul', 2200, true, [
    loopTrack('root', 2200, [
      { y: -8 }, { y: -16, ease: 'easeInOut' }, { y: -8, ease: 'easeInOut' }
    ]),
    loopTrack('torso', 2200, [
      { rot: -3 }, { rot: 3, ease: 'easeInOut' }, { rot: -3, ease: 'easeInOut' }
    ]),
    loopTrack('head', 2200, [
      { rot: -2 }, { rot: 2, ease: 'easeInOut' }, { rot: -2, ease: 'easeInOut' }
    ])
  ]));

  return {
    schemaVersion: 1,
    skeletonId: 'skeleton.player',
    meta: { width: 64, height: 64 },
    defaultClip: 'idle_down',
    bones,
    slots,
    clips
  };
}

/** 狼示范：简单 rig + body sequence 帧表（混合模式验证用） */
function buildSimpleSkeleton({ skeletonId, bodyAssetId, bodyWidth, bodyHeight }) {
  const bones = [
    { id: 'root', parent: null, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 16 },
    { id: 'hips', parent: 'root', x: 0, y: -18, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'torso', parent: 'hips', x: 0, y: -10, rot: 0, scaleX: 1, scaleY: 1, length: 26 },
    { id: 'head', parent: 'torso', x: 0, y: -22, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'legL', parent: 'hips', x: -10, y: 4, rot: 0, scaleX: 1, scaleY: 1, length: 20 },
    { id: 'legR', parent: 'hips', x: 10, y: 4, rot: 0, scaleX: 1, scaleY: 1, length: 20 }
  ];
  const bodyOffsetY = -bodyHeight / 2 + 28;
  const slots = [
    { id: 'shadow', bone: 'root', z: 0, attachment: { type: 'empty' } },
    { id: 'body', bone: 'torso', z: 1, attachment: {
      type: 'sequence', assetId: bodyAssetId, fps: 8, frames: [], x: 0, y: bodyOffsetY, rot: 0, width: bodyWidth, height: bodyHeight
    } }
  ];
  const clips = [
    clip('idle_down', 1800, true, [
      loopTrack('torso', 1800, [ { y: -10 }, { y: -11.5, ease: 'easeInOut' }, { y: -10, ease: 'easeInOut' } ])
    ]),
    clip('walk_down', 620, true, [
      loopTrack('root', 620, [ { y: 0 }, { y: -3, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' } ]),
      loopTrack('legL', 620, [ { rot: -14 }, { rot: 14, ease: 'easeInOut' }, { rot: -14, ease: 'easeInOut' } ]),
      loopTrack('legR', 620, [ { rot: 14 }, { rot: -14, ease: 'easeInOut' }, { rot: 14, ease: 'easeInOut' } ])
    ])
  ];
  return {
    schemaVersion: 1,
    skeletonId,
    meta: { width: bodyWidth, height: bodyHeight },
    defaultClip: 'idle_down',
    bones,
    slots,
    clips
  };
}

mkdirSync(OUT_DIR, { recursive: true });

// 玩家：完整全身骨骼
const playerDoc = buildPlayerSkeleton();
playerDoc.skeletonId = 'skeleton.player';
writeFileSync(`${OUT_DIR}/player.json`, `${JSON.stringify(playerDoc, null, 2)}\n`);
console.log(`written: ${OUT_DIR}/player.json (bones=${playerDoc.bones.length} slots=${playerDoc.slots.length} clips=${playerDoc.clips.length})`);

// 狼示范：简单 rig
const wolfDoc = buildSimpleSkeleton({ skeletonId: 'skeleton.wolf-demo', bodyAssetId: 's01.enemy.wolf', bodyWidth: 68, bodyHeight: 48 });
wolfDoc.skeletonId = 'skeleton.wolf-demo';
writeFileSync(`${OUT_DIR}/wolf-demo.json`, `${JSON.stringify(wolfDoc, null, 2)}\n`);
console.log(`written: ${OUT_DIR}/wolf-demo.json (bones=${wolfDoc.bones.length} clips=${wolfDoc.clips.length})`);
