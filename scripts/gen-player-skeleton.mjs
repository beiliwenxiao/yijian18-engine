// 程序化生成玩家/示范骨骼资产（rig 空节点 + 全套动作剪辑，混合模式第一期）。
// 身体槽位 attachment 仅声明 assetId 占位；帧表由 PlayerSkeletonStateMapper
// 按实体实际贴图（cols×rows + 方向行）在运行时计算覆盖。
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

/** 骨骼默认姿势（rest）由 bones 数组定义；剪辑只写变化的通道，其余回退 rest。 */
function buildSkeleton({ skeletonId, bodyAssetId, bodyWidth, bodyHeight, withParts = false }) {
  // rig 世界：root(0,0)=脚底；torso 世界 y=-46（hips -26 + torso -20）。
  // meta.height = bodyHeight（=实体显示高）→ SkeletonRenderer scale=1，骨骼坐标即实际像素。
  // 肩点：torso 局部 (±6, 7) → 世界 (±6, -39)（核心帧躯干顶世界 -38，袖片自肩点下垂）。
  // 手点：torso 局部 (7, 22) → 世界 (7, -24)（臂图手端 ≈ 世界 -22..-18，握点略上）。
  const torsoWorldY = -46;
  const bodyOffsetY = -bodyHeight / 2 - torsoWorldY; // 帧图中心对齐：脚底落在 root
  const lyingTorsoY = bodyHeight / 2 - Math.abs(torsoWorldY) - 4; // 横躺（rot≈90°）时躯干下移贴地
  const bones = [
    { id: 'root', parent: null, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 16 },
    { id: 'hips', parent: 'root', x: 0, y: -26, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'torso', parent: 'hips', x: 0, y: -20, rot: 0, scaleX: 1, scaleY: 1, length: 26 },
    { id: 'head', parent: 'torso', x: 0, y: -26, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'armL', parent: 'torso', x: -6, y: 7, rot: 0, scaleX: 1, scaleY: 1, length: 20 },
    { id: 'armR', parent: 'torso', x: 6, y: 7, rot: 0, scaleX: 1, scaleY: 1, length: 20 },
    { id: 'legL', parent: 'hips', x: -6, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: 26 },
    { id: 'legR', parent: 'hips', x: 6, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: 26 },
    { id: 'hand', parent: 'torso', x: 7, y: 22, rot: 0, scaleX: 1, scaleY: 1, length: 8 },
    { id: 'back', parent: 'hips', x: 0, y: -14, rot: 0, scaleX: 1, scaleY: 1, length: 10 }
  ];

  // 槽位渲染按数组顺序绘制（z 仅元数据）。
  // 玩家拆件（withParts）：shadow → spearBack(背矛) → skirtBack → body → skirtFront → armL → armR → toolHand(斧) → armor
  // 部件附件偏移 = (图中心 - pivot)：64×64 部件图 pivot(px,py) → (32-px, 32-py)。
  //   臂 pivot 肩点 (32,6) → (0,26)；斧握点 (32,10) → (0,22)+x4 外移；矛 pivot 中心 (32,32) → (0,4) 下移贴背；
  //   裙 pivot 顶中 (32,6) → (0,44)（挂 torso：裙顶对齐腰部世界 -28，横躺随躯干旋转）。
  const baseSlots = [
    { id: 'shadow', bone: 'root', z: 0, attachment: { type: 'empty' } },
    { id: 'body', bone: 'torso', z: 1, attachment: {
      type: 'sequence', assetId: bodyAssetId, fps: 8, frames: [], x: 0, y: bodyOffsetY, rot: 0, width: bodyWidth, height: bodyHeight
    } },
    { id: 'toolHand', bone: 'hand', z: 2, attachment: { type: 'empty', x: 0, y: 0, rot: 0 } },
    { id: 'armor', bone: 'torso', z: 3, attachment: { type: 'empty', x: 0, y: 0, rot: 0 } }
  ];
  const partSlots = [
    { id: 'spearBack', bone: 'back', z: 1, attachment: {
      type: 'image', assetId: 'player.parts.weapon-spear', x: 3, y: 8, rot: 0, width: 64, height: 64
    } },
    { id: 'skirtBack', bone: 'torso', z: 2, attachment: {
      type: 'image', assetId: 'player.parts.skirt-back', x: 0, y: 44, rot: 0, width: 64, height: 64
    } },
    { id: 'skirtFront', bone: 'torso', z: 4, attachment: {
      type: 'image', assetId: 'player.parts.skirt-front', x: 0, y: 44, rot: 0, width: 64, height: 64
    } },
    { id: 'armL', bone: 'armL', z: 5, attachment: {
      type: 'image', assetId: 'player.parts.arm-l', x: 0, y: 26, rot: 0, width: 64, height: 64
    } },
    { id: 'armR', bone: 'armR', z: 6, attachment: {
      type: 'image', assetId: 'player.parts.arm-r', x: 0, y: 26, rot: 0, width: 64, height: 64
    } },
    { id: 'toolHand', bone: 'hand', z: 7, attachment: {
      type: 'image', assetId: 'player.parts.weapon-axe', x: 7, y: 22, rot: 0, width: 64, height: 64
    } }
  ];
  const slots = withParts
    ? [
        baseSlots[0],
        partSlots[0],            // spearBack（背背长矛，最外层之后）
        partSlots[1],            // skirtBack
        baseSlots[1],            // body
        partSlots[2],            // skirtFront
        partSlots[3],            // armL
        partSlots[4],            // armR
        partSlots[5],            // toolHand（武器）
        baseSlots[3]             // armor
      ]
    : baseSlots;

  const clips = [];
  // 待机（3 方向）：呼吸起伏 + 头部微摆
  for (const dir of ['down', 'up', 'side']) {
    clips.push(clip(`idle_${dir}`, 1800, true, [
      loopTrack('torso', 1800, [
        { y: -20 }, { y: -21.5, ease: 'easeInOut' }, { y: -20, ease: 'easeInOut' }
      ]),
      loopTrack('head', 1800, [
        { rot: 0 }, { rot: dir === 'side' ? 3 : 4, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('armL', 1800, [
        { rot: 0 }, { rot: 3, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('armR', 1800, [
        { rot: 0 }, { rot: -3, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ])
    ]));
  }
  // 行走（3 方向）：步频起伏 + 躯干摆动 + 双臂摆
  for (const dir of ['down', 'up', 'side']) {
    clips.push(clip(`walk_${dir}`, 620, true, [
      loopTrack('root', 620, [
        { y: 0 }, { y: -3, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }, { y: -3, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }
      ]),
      loopTrack('torso', 620, [
        { rot: -4 }, { rot: 4, ease: 'easeInOut' }, { rot: -4, ease: 'easeInOut' }
      ]),
      loopTrack('armL', 620, [
        { rot: 14 }, { rot: -14, ease: 'easeInOut' }, { rot: 14, ease: 'easeInOut' }
      ]),
      loopTrack('armR', 620, [
        { rot: -14 }, { rot: 14, ease: 'easeInOut' }, { rot: -14, ease: 'easeInOut' }
      ]),
      loopTrack('legL', 620, [
        { rot: -12 }, { rot: 12, ease: 'easeInOut' }, { rot: -12, ease: 'easeInOut' }
      ]),
      loopTrack('legR', 620, [
        { rot: 12 }, { rot: -12, ease: 'easeInOut' }, { rot: 12, ease: 'easeInOut' }
      ])
    ]));
  }
  // 跳跃：蓄力-腾空-落地（非循环）
  clips.push(clip('jump', 420, false, [
    { bone: 'root', keys: [
      { t: 0, y: 2 }, { t: 100, y: 3 }, { t: 260, y: -20, ease: 'easeInOut' }, { t: 380, y: 0, ease: 'easeInOut' }, { t: 420, y: 0 }
    ] },
    { bone: 'legL', keys: [ { t: 0, rot: 0 }, { t: 120, rot: 18 }, { t: 300, rot: 8 }, { t: 420, rot: 0 } ] },
    { bone: 'legR', keys: [ { t: 0, rot: 0 }, { t: 120, rot: -18 }, { t: 300, rot: -8 }, { t: 420, rot: 0 } ] },
    { bone: 'armL', keys: [ { t: 0, rot: 0 }, { t: 140, rot: -46 }, { t: 420, rot: 0 } ] },
    { bone: 'armR', keys: [ { t: 0, rot: 0 }, { t: 140, rot: 46 }, { t: 420, rot: 0 } ] }
  ]));
  // 攻击（侧向+翻转覆盖全向）：挥臂
  clips.push(clip('attack', 400, false, [
    { bone: 'armR', keys: [ { t: 0, rot: -70 }, { t: 160, rot: 55, ease: 'easeInOut' }, { t: 400, rot: 0, ease: 'easeInOut' } ] },
    { bone: 'torso', keys: [ { t: 0, rot: -8 }, { t: 160, rot: 10, ease: 'easeInOut' }, { t: 400, rot: 0, ease: 'easeInOut' } ] }
  ]));
  // 采集（弯腰拾取，循环）
  clips.push(clip('gather', 900, true, [
    { bone: 'torso', keys: [ { t: 0, rot: 0 }, { t: 450, rot: 34, ease: 'easeInOut' }, { t: 900, rot: 0, ease: 'easeInOut' } ] },
    { bone: 'armR', keys: [ { t: 0, rot: 0 }, { t: 450, rot: 62, ease: 'easeInOut' }, { t: 900, rot: 0, ease: 'easeInOut' } ] }
  ]));
  // 伐木（举斧重劈，循环）
  clips.push(clip('logging', 1100, true, [
    { bone: 'armR', keys: [ { t: 0, rot: -95, ease: 'easeInOut' }, { t: 480, rot: 70, ease: 'easeInOut' }, { t: 1100, rot: -95, ease: 'easeInOut' } ] },
    { bone: 'torso', keys: [ { t: 0, rot: -6 }, { t: 480, rot: 16, ease: 'easeInOut' }, { t: 1100, rot: -6, ease: 'easeInOut' } ] }
  ]));
  // 挖矿（短促连凿，循环）
  clips.push(clip('mining', 800, true, [
    { bone: 'armR', keys: [ { t: 0, rot: -70 }, { t: 300, rot: 55, ease: 'easeInOut' }, { t: 800, rot: -70, ease: 'easeInOut' } ] },
    { bone: 'armL', keys: [ { t: 0, rot: -30 }, { t: 300, rot: -10, ease: 'easeInOut' }, { t: 800, rot: -30, ease: 'easeInOut' } ] }
  ]));
  // 钓鱼（甩竿-持竿，循环）
  clips.push(clip('fishing', 2200, true, [
    { bone: 'armR', keys: [ { t: 0, rot: -40, ease: 'easeInOut' }, { t: 300, rot: 30, ease: 'easeInOut' }, { t: 2200, rot: -12, ease: 'easeInOut' } ] },
    { bone: 'torso', keys: [ { t: 0, rot: 0 }, { t: 300, rot: 4, ease: 'easeInOut' }, { t: 2200, rot: 2, ease: 'easeInOut' } ] }
  ]));
  // 背向攀爬（交替上爬，循环）
  clips.push(clip('climb_back', 700, true, [
    loopTrack('root', 700, [
      { y: 0 }, { y: -3, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }
    ]),
    loopTrack('armL', 700, [
      { rot: -55 }, { rot: -95, ease: 'easeInOut' }, { rot: -55, ease: 'easeInOut' }
    ]),
    loopTrack('armR', 700, [
      { rot: -95 }, { rot: -55, ease: 'easeInOut' }, { rot: -95, ease: 'easeInOut' }
    ]),
    loopTrack('legL', 700, [
      { rot: 25 }, { rot: -5, ease: 'easeInOut' }, { rot: 25, ease: 'easeInOut' }
    ]),
    loopTrack('legR', 700, [
      { rot: -5 }, { rot: 25, ease: 'easeInOut' }, { rot: -5, ease: 'easeInOut' }
    ])
  ]));
  // 睡觉（躺平 + 呼吸，循环）：进入时躯干旋到 85°
  clips.push(clip('sleep', 2400, true, [
    { bone: 'torso', keys: [ { t: 0, rot: 85, y: lyingTorsoY }, { t: 1200, rot: 87, y: lyingTorsoY - 1, ease: 'easeInOut' }, { t: 2400, rot: 85, y: lyingTorsoY, ease: 'easeInOut' } ] },
    { bone: 'head', keys: [ { t: 0, rot: 12 }, { t: 1200, rot: 14, ease: 'easeInOut' }, { t: 2400, rot: 12, ease: 'easeInOut' } ] },
    { bone: 'legL', keys: [ { t: 0, rot: 6 } ] },
    { bone: 'legR', keys: [ { t: 0, rot: -6 } ] }
  ]));
  // 躺担架（平躺被抬，循环微晃）
  clips.push(clip('stretcher', 1200, true, [
    { bone: 'torso', keys: [ { t: 0, rot: 90, y: lyingTorsoY }, { t: 600, rot: 88, y: lyingTorsoY - 1, ease: 'easeInOut' }, { t: 1200, rot: 90, y: lyingTorsoY, ease: 'easeInOut' } ] },
    { bone: 'root', keys: [ { t: 0, y: -6 }, { t: 600, y: -8, ease: 'easeInOut' }, { t: 1200, y: -6, ease: 'easeInOut' } ] }
  ]));
  // 死亡倒下（非循环：前倾倒地）
  clips.push(clip('death', 520, false, [
    { bone: 'torso', keys: [ { t: 0, rot: 0, y: -20 }, { t: 380, rot: 90, y: lyingTorsoY, ease: 'easeInOut' }, { t: 520, rot: 90, y: lyingTorsoY } ] },
    { bone: 'root', keys: [ { t: 0, y: 0 }, { t: 380, y: 4, ease: 'easeInOut' }, { t: 520, y: 4 } ] },
    { bone: 'head', keys: [ { t: 0, rot: 0 }, { t: 380, rot: 24, ease: 'easeInOut' }, { t: 520, rot: 24 } ] }
  ]));
  // 灵魂悬浮（缓慢起伏漂移，循环）
  clips.push(clip('soul', 2200, true, [
    loopTrack('root', 2200, [
      { y: -8 }, { y: -16, ease: 'easeInOut' }, { y: -8, ease: 'easeInOut' }
    ]),
    loopTrack('torso', 2200, [
      { rot: -3 }, { rot: 3, ease: 'easeInOut' }, { rot: -3, ease: 'easeInOut' }
    ])
  ]));

  return {
    schemaVersion: 1,
    skeletonId: 'skeleton.player',
    meta: { width: bodyWidth, height: bodyHeight },
    defaultClip: 'idle_down',
    bones,
    slots,
    clips
  };
}

// 玩家骨骼（body 槽位 = 核心版 sheet（无臂无裙），manifest 稳定 ID player.animated；
// 帧表由 PlayerSkeletonStateMapper 按 4×8 布局+方向行运行时计算覆盖。
// 手臂/武器/裙片由独立部件槽位骨骼驱动，withParts=true 启用）
mkdirSync(OUT_DIR, { recursive: true });
const playerDoc = buildSkeleton({ skeletonId: 'skeleton.player', bodyAssetId: 'player.animated', bodyWidth: 64, bodyHeight: 64, withParts: true });
writeFileSync(`${OUT_DIR}/player.json`, `${JSON.stringify(playerDoc, null, 2)}\n`);
console.log(`written: ${OUT_DIR}/player.json (clips=${playerDoc.clips.length})`);

// 示范骨骼：狼贴图做 body（验证 rig 驱动 + 状态剪辑切换）
const wolfDoc = buildSkeleton({ skeletonId: 'skeleton.wolf-demo', bodyAssetId: 's01.enemy.wolf', bodyWidth: 68, bodyHeight: 48 });
wolfDoc.skeletonId = 'skeleton.wolf-demo';
writeFileSync(`${OUT_DIR}/wolf-demo.json`, `${JSON.stringify(wolfDoc, null, 2)}\n`);
console.log(`written: ${OUT_DIR}/wolf-demo.json (clips=${wolfDoc.clips.length})`);
