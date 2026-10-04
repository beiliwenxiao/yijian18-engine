import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArmyCommandSystem, ARMY_SELECTION_SLOTS } from '../src/systems/ArmyCommandSystem.js';
import { SquadMemberComponent } from '../src/ecs/components/SquadMemberComponent.js';
import { CommandStateComponent, ARMY_STANCES } from '../src/ecs/components/CommandStateComponent.js';

/** 构造带 transform/movement/combat/squadMember/commandState 的最小模拟实体。 */
function makeUnit(id, { x = 0, y = 0, armyId = 'army.s02.guard', squadId = 'qian', formationIndex = 0, speed = 90 } = {}) {
  const components = new Map([
    ['transform', { position: { x, y } }],
    ['movement', { speed, velocity: { x: 0, y: 0 }, setPath() {}, clearPath() {} }],
    ['combat', { attackRange: 40, attackCooldown: 1500 }],
    ['sprite', { playAnimation: vi.fn() }]
  ]);
  const entity = {
    id,
    isDead: false,
    getComponent: type => components.get(type) || null,
    addComponent: component => components.set(component.type, component)
  };
  entity.addComponent(new SquadMemberComponent({ armyId, squadId, formationIndex }));
  entity.addComponent(new CommandStateComponent({ stance: 'hold' }));
  return entity;
}

/** 构造敌对目标（野狼）。transform 为稳定对象（测试内可位移模拟敌动）。 */
function makeEnemy(id, { x = 0, y = 0 } = {}) {
  const components = { transform: { position: { x, y } } };
  return {
    id,
    type: 'enemy',
    faction: 'enemy',
    isDead: false,
    isDying: false,
    getComponent: type => components[type] || null
  };
}

describe('ArmyCommandSystem 军团指挥（M1 编组与命令）', () => {
  let system;

  beforeEach(() => {
    system = new ArmyCommandSystem({});
  });

  it('编组注册幂等；选择槽位循环覆盖 7 槽（武将→全军→五军）', () => {
    const unitA = makeUnit('u1', { squadId: 'qian' });
    const unitB = makeUnit('u2', { squadId: 'hou' });
    expect(system.registerUnit(unitA, { armyId: 'army.s02.guard', squadId: 'qian' })).toBe(true);
    expect(system.registerUnit(unitA, { squadId: 'qian' })).toBe(false); // 幂等
    system.registerUnit(unitB, { squadId: 'hou' });
    expect(system.getUnitCount()).toBe(2);

    expect(system.getSelectionSlot()).toBe('commander');
    system.cycleSelection(1);
    expect(system.getSelectionSlot()).toBe('all');
    system.cycleSelection(1);
    expect(system.getSelectionSlot()).toBe('qian');
    system.cycleSelection(-1);
    expect(system.getSelectionSlot()).toBe('all');
    // 循环回绕：连续正向 7 次回到原点
    for (let index = 0; index < ARMY_SELECTION_SLOTS.length; index++) system.cycleSelection(1);
    expect(system.getSelectionSlot()).toBe('all');
  });

  it('选择过滤器：全军返回全部、分队返回该队、武将返回空', () => {
    system.registerUnit(makeUnit('u1', { x: 100, y: 100, squadId: 'qian' }), { squadId: 'qian' });
    system.registerUnit(makeUnit('u2', { x: 200, y: 100, squadId: 'hou' }), { squadId: 'hou' });

    system.setSelection('all');
    expect(system.getSelectedUnits().map(unit => unit.id)).toEqual(['u1', 'u2']);
    expect(system.hasSquadSelection()).toBe(true);

    system.setSelection('hou');
    expect(system.getSelectedUnits().map(unit => unit.id)).toEqual(['u2']);

    system.setSelection('commander');
    expect(system.getSelectedUnits()).toEqual([]);
    expect(system.hasSquadSelection()).toBe(false);
  });

  it('点选与框选：自定义选择命中最近单位，空框清空选择', () => {
    system.registerUnit(makeUnit('u1', { x: 100, y: 100 }), {});
    system.registerUnit(makeUnit('u2', { x: 130, y: 100 }), {});

    // 点选命中最近
    expect(system.selectUnitAt({ x: 105, y: 100 })).toBe(true);
    expect(system.getSelectedUnits().map(unit => unit.id)).toEqual(['u1']);

    // 框选命中两个
    expect(system.selectUnitsInRect({ minX: 90, minY: 90, maxX: 140, maxY: 110 })).toBe(2);
    expect(system.getSelectedUnits().length).toBe(2);

    // 空框清空回武将
    expect(system.selectUnitsInRect({ minX: 0, minY: 0, maxX: 10, maxY: 10 })).toBe(0);
    expect(system.getSelectionSlot()).toBe('commander');
    expect(system.getSelectedUnits()).toEqual([]);

    // 点空地不选中
    expect(system.selectUnitAt({ x: 999, y: 999 })).toBe(false);
  });

  it('移动下令：阵型目标点写入 commandState.goal + 全部到位即达成（无倒计时延迟）', () => {
    const unitA = makeUnit('u1', { x: 0, y: 0 });
    const unitB = makeUnit('u2', { x: 10, y: 0 });
    system.registerUnit(unitA, { squadId: 'qian', formationIndex: 0 });
    system.registerUnit(unitB, { squadId: 'qian', formationIndex: 1 });

    system.setSelection('all');
    const result = system.orderMove({ x: 500, y: 300 });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.duration).toBeUndefined();

    // 阵型点：两单位水平并列，间距 44，围绕目标点分布（M2 由姿态机驱动移动）
    const goalA = unitA.getComponent('commandState').goal;
    const goalB = unitB.getComponent('commandState').goal;
    expect(goalA.x).toBeCloseTo(500 - 22);
    expect(goalB.x).toBeCloseTo(500 + 22);
    expect(Math.abs(goalA.y - goalB.y)).toBeLessThan(0.01);

    // 未到位 → 未达成（即使推进大量时间，用户裁定取消倒计时延迟）
    const order = system.getActiveOrder();
    expect(order.done).toBe(false);
    system.update(10);
    expect(order.done).toBe(false);

    // 全部到位 → 立即达成
    unitA.getComponent('transform').position = { x: goalA.x, y: goalA.y };
    unitB.getComponent('transform').position = { x: goalB.x, y: goalB.y };
    system.update(0.016);
    expect(order.done).toBe(true);
  });

  it('无选择时下令拒绝；tryHandleMoveOrder 仅在编组选择+右键未处理时接管', () => {
    system.registerUnit(makeUnit('u1', { x: 0, y: 0 }), {});
    system.setSelection('commander');
    expect(system.orderMove({ x: 100, y: 100 }).ok).toBe(false);

    const clicks = [];
    const inputManager = {
      isMouseClicked: () => clicks.at(-1)?.down ?? false,
      getMouseButton: () => clicks.at(-1)?.button ?? 0,
      isMouseClickHandled: () => clicks.at(-1)?.handled ?? false,
      getMousePosition: () => ({ x: 50, y: 50 }),
      getMouseWorldPosition: () => ({ x: 500, y: 300 }),
      markMouseClickHandled: () => { clicks.at(-1).handled = true; }
    };
    system.setInputManager(inputManager);
    const camera = { screenToWorld: (x, y) => ({ x: x + 450, y: y + 250 }) };

    // 武将选择 → 不接管
    system.setSelection('commander');
    clicks.push({ down: true, button: 2, handled: false });
    expect(system.tryHandleMoveOrder(camera)).toBe(false);

    // 编组选择 + 右键未处理 → 接管并标记 handled
    system.setSelection('all');
    expect(system.tryHandleMoveOrder(camera)).toBe(true);
    expect(clicks.at(-1).handled).toBe(true);
    expect(system.getActiveOrder().goal).toEqual({ x: 500, y: 300 });

    // 已处理的点击不重复接管
    expect(system.tryHandleMoveOrder(camera)).toBe(false);
  });
});

describe('ArmyCommandSystem 姿态机（M2）', () => {
  let system;
  let combatSystem;

  beforeEach(() => {
    system = new ArmyCommandSystem({});
    combatSystem = { performAttack: vi.fn() };
    system.setCombatSystem(combatSystem);
  });

  it('applyStance：写入选中单位 commandState，hold 记录驻守点；未知/无选择拒绝', () => {
    const unit = makeUnit('u1', { x: 120, y: 80 });
    system.registerUnit(unit, { squadId: 'qian' });
    system.setSelection('all');

    const miss = system.applyStance('assault');
    expect(miss).toEqual({ ok: true, count: 1, stance: 'assault' });
    expect(unit.getComponent('commandState').stance).toBe('assault');
    expect(system.getSelectionSlot()).toBe('commander'); // M5：发完自动回武将

    // hold 记录驻守点为当前位置（重新选择后再发）
    system.setSelection('all');
    expect(system.applyStance('hold').ok).toBe(true);
    expect(unit.getComponent('commandState').stance).toBe('hold');
    expect(unit.getComponent('commandState').post).toEqual({ x: 120, y: 80 });

    // 未知姿态 / 无选择
    system.setSelection('commander');
    expect(system.applyStance('assault').ok).toBe(false);
    system.setSelection('all');
    expect(system.applyStance('no.such').ok).toBe(false);
  });

  it('全速进攻：警戒内敌人 → 追击（速度 1.25x）；进攻击程内 → 停下走正规攻击', () => {
    const unit = makeUnit('u1', { x: 0, y: 0 });
    system.registerUnit(unit, { squadId: 'qian' });
    system.setSelection('all');
    system.applyStance('assault');

    const enemy = makeEnemy('wolf1', { x: 200, y: 0 });
    system.setEnemies([enemy]);
    system.updateStances();

    // 追击：velocity 朝敌人，幅度 = 90 × 1.25
    let velocity = unit.getComponent('movement').velocity;
    expect(velocity.x).toBeCloseTo(112.5);
    expect(velocity.y).toBeCloseTo(0);

    // 接敌：距离 30 ≤ 40+8 → 停止 + performAttack（走正规击杀链）
    enemy.getComponent('transform').position = { x: 30, y: 0 };
    system.updateStances();
    velocity = unit.getComponent('movement').velocity;
    expect(velocity.x).toBe(0);
    expect(velocity.y).toBe(0);
    expect(combatSystem.performAttack).toHaveBeenCalledWith(unit, enemy, expect.any(Number));
  });

  it('原地防守：敌进攻击程接战，超出驻守点脱离半径则脱锁回归', () => {
    const unit = makeUnit('u1', { x: 100, y: 100 });
    system.registerUnit(unit, { squadId: 'qian' });
    system.setSelection('all');
    system.applyStance('hold'); // post = (100,100)

    // 敌进入攻击范围（30 ≤ 40+8）→ 接战
    const enemyNear = makeEnemy('wolf1', { x: 130, y: 100 });
    system.setEnemies([enemyNear]);
    system.updateStances();
    expect(combatSystem.performAttack).toHaveBeenCalled();

    // 敌距驻守点 400 > 320 脱离半径 → 无视威胁，回归驻守点（单位先位移模拟追出）
    combatSystem.performAttack.mockClear();
    unit.getComponent('transform').position = { x: 300, y: 100 };
    const enemyFar = makeEnemy('wolf2', { x: 500, y: 100 });
    system.setEnemies([enemyFar]);
    system.updateStances();
    const velocity = unit.getComponent('movement').velocity;
    expect(velocity.x).toBeLessThan(0); // 朝驻守点（西）移动
    expect(combatSystem.performAttack).not.toHaveBeenCalled();
  });

  it('缓慢推进：向目标移动速度 0.6x；快速逃命：远离敌人 1.5x 且不攻击', () => {
    const unitA = makeUnit('u1', { x: 0, y: 0 });
    system.registerUnit(unitA, { squadId: 'qian' });
    system.setSelection('all');
    system.applyStance('advance');
    system.setSelection('all'); // M5：applyStance 后选择已清空，重新选择再下令

    // 无敌情、有移动目标 → 0.6x 推进
    system.orderMove({ x: 300, y: 0 });
    system.updateStances();
    expect(unitA.getComponent('movement').velocity.x).toBeCloseTo(54); // 90 × 0.6

    // 快速逃命：敌在西侧 → 向东逃离 1.5x，不攻击
    const unitB = makeUnit('u2', { x: 100, y: 100 });
    system.registerUnit(unitB, { squadId: 'hou' });
    system.setSelection('all');
    system.applyStance('flee');
    const enemy = makeEnemy('wolf1', { x: 40, y: 100 });
    system.setEnemies([enemy]);
    system.updateStances();
    const velocity = unitB.getComponent('movement').velocity;
    expect(velocity.x).toBeGreaterThan(0); // 远离（向东）
    expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(135); // 90 × 1.5
    expect(combatSystem.performAttack).not.toHaveBeenCalled();
  });

  it('getSelectedStance：选中单位姿态一致才返回；命令面板按钮点击应用姿态', () => {
    const unitA = makeUnit('u1', { x: 0, y: 0 });
    const unitB = makeUnit('u2', { x: 20, y: 0 });
    system.registerUnit(unitA, { squadId: 'qian' });
    system.registerUnit(unitB, { squadId: 'qian', formationIndex: 1 });
    system.setSelection('all');
    expect(system.getSelectedStance()).toBe('hold');

    system.applyStance('flee');
    // M5：姿态指令后自动回武将（选择清空），姿态数据仍写在单位上
    expect(system.getSelectionSlot()).toBe('commander');
    expect(unitA.getComponent('commandState').stance).toBe('flee');

    // HUD 姿态按钮点击 → applyStance（按钮位置由 render 生成，此处直接注入模拟）
    const hud = {
      _stanceButtons: ARMY_STANCES.map((stance, index) => ({
        stanceKey: stance.key,
        x: index * 80, y: 0, width: 76, height: 28
      })),
      handleMouseClick(x, y, button) {
        if (button !== 'left') return false;
        for (const item of this._stanceButtons) {
          if (x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height) {
            system.applyStance(item.stanceKey);
            system.pendingStance = item.stanceKey;
            return true;
          }
        }
        return false;
      }
    };
    system.setSelection('all');
    expect(hud.handleMouseClick(80 + 10, 14, 'left')).toBe(true); // 第 2 个按钮 = 原地防守
    expect(unitA.getComponent('commandState').stance).toBe('hold');
    expect(system.getSelectionSlot()).toBe('commander'); // 发完指令自动回武将
    expect(hud.handleMouseClick(0, 14, 'right')).toBe(false); // 非左键不消费
  });
});

describe('ArmyCommandSystem 特殊命令收口（任务驱动建造）', () => {
  let system;

  beforeEach(() => {
    system = new ArmyCommandSystem({});
    const unitA = makeUnit('u1', { x: 0, y: 0 });
    const unitB = makeUnit('u2', { x: 20, y: 0 });
    system.registerUnit(unitA, { squadId: 'qian' });
    system.registerUnit(unitB, { squadId: 'qian', formationIndex: 1 });
    system.setSelection('all');
  });

  it('守城姿态：applyStance 接受 garrison（大脱离半径驻守）', () => {
    expect(system.applyStance('garrison').ok).toBe(true);
    // M5：applyStance 后自动回武将，但姿态数据写在单位上
    expect(system.getSelectionSlot()).toBe('commander');
    expect(system.units.get('u1').entity.getComponent('commandState').stance).toBe('garrison');
  });

  it('startConstruction：任务驱动建造流（士兵到位→施工倒计时→完成回调）', () => {
    const completions = [];
    system.onConstructionComplete = (commandKey, pos, def) => completions.push({ commandKey, pos, def });

    expect(system.startConstruction('no.such', { x: 300, y: 200 }).ok).toBe(false); // 未知命令
    const placed = system.startConstruction('caltrops', { x: 300, y: 200 });
    expect(placed.ok).toBe(true);
    expect(placed.phase).toBe('moving');
    const job = system.constructionJob;
    expect(job.phase).toBe('moving');
    expect(job.builders).toEqual(['u1', 'u2']);
    expect(system.isBlockedAt(300, 200)).toBe(false); // 未完成不阻挡

    // 士兵未到位 → 停留 moving
    system.updateConstruction(1);
    expect(job.phase).toBe('moving');

    // 士兵到位 → building 倒计时
    for (const id of job.builders) {
      const unit = system.units.get(id);
      const goal = unit.entity.getComponent('commandState').goal;
      unit.entity.getComponent('transform').position = { x: goal.x, y: goal.y };
    }
    system.updateStances(); // 建造覆盖：builder 站定（velocity 0）
    expect(unit0VelocityZero(system)).toBe(true);
    system.updateConstruction(1);
    expect(job.phase).toBe('building');

    // 倒计时结束 → 完成回调 + 工程物阻挡生效
    system.updateConstruction(job.total + 0.1);
    expect(system.constructionJob).toBe(null);
    expect(completions).toHaveLength(1);
    expect(completions[0].commandKey).toBe('caltrops');
    expect(system.constructions).toHaveLength(1);
    expect(system.isBlockedAt(300, 200)).toBe(true);
    expect(system.isBlockedAt(400, 300)).toBe(false);
  });

  function unit0VelocityZero(system) {
    for (const unit of system.units.values()) {
      const velocity = unit.entity.getComponent('movement').velocity;
      if (velocity.x !== 0 || velocity.y !== 0) return false;
    }
    return true;
  }
});

/** 构造倒地伤员（玩家主角，M4 搬运目标）。 */
function makeBody(id, { x = 0, y = 0 } = {}) {
  const components = new Map([
    ['transform', { position: { x, y } }],
    ['movement', { speed: 150, velocity: { x: 0, y: 0 } }],
    ['sprite', { playAnimation: vi.fn() }]
  ]);
  return {
    id,
    type: 'player',
    faction: 'player',
    isDead: false,
    isDying: false,
    getComponent: type => components.get(type) || null
  };
}

describe('ArmyCommandSystem 搬运玩法（担架载具：触发框招募 + 玩家驾驶）', () => {
  let system;

  beforeEach(() => {
    system = new ArmyCommandSystem({});
    system.registerUnit(makeUnit('u1', { x: 0, y: 0 }), { squadId: 'qian' });
    system.registerUnit(makeUnit('u2', { x: 24, y: 0 }), { squadId: 'qian', formationIndex: 1 });
    system.setSelection('all');
  });

  it('搬运目标注册：setRescueTarget/clearRescueTarget；无效实体拒绝', () => {
    const body = makeBody('body', { x: 200, y: 100 });
    expect(system.setRescueTarget(body, { goal: { x: 500, y: 300 }, regionId: 'S02-camp-rescue' })).toBe(true);
    expect(system.getRescueTarget().entity).toBe(body);
    expect(system.getRescueTarget().goal).toEqual({ x: 500, y: 300 });
    expect(system.getRescueTarget().carrying).toBe(false);

    expect(system.setRescueTarget(null, {})).toBe(false);
    system.clearRescueTarget();
    expect(system.getRescueTarget()).toBe(null);
  });

  it('触发框招募：两名士兵走近伤员 → 自动挂载（无需救援指令）；仅一人不挂载', () => {
    const body = makeBody('body', { x: 200, y: 0 });
    system.setRescueTarget(body, { goal: { x: 600, y: 0 }, regionId: 'S02-camp-rescue' });

    // 两名士兵都远离触发框（96 半径外）→ 不挂载
    system.units.get('u1').entity.getComponent('transform').position = { x: 20, y: 0 };
    system.units.get('u2').entity.getComponent('transform').position = { x: 320, y: 0 };
    const starts = [];
    system.onCarryStart = payload => starts.push(payload);
    system.update(0.1);
    expect(system.getRescueTarget().carrying).toBe(false);
    expect(starts).toHaveLength(0);

    // u2 走进触发框，u1 仍在框外 → 仅 1 人不挂载
    system.units.get('u2').entity.getComponent('transform').position = { x: 230, y: 0 };
    system.update(0.1);
    expect(system.getRescueTarget().carrying).toBe(false);

    // u1 也走近 → 自动挂载：两名最近士兵成为担架兵
    system.units.get('u1').entity.getComponent('transform').position = { x: 190, y: 0 };
    system.update(0.1);
    expect(system.getRescueTarget().carrying).toBe(true);
    expect(starts).toHaveLength(1);
    expect(system.getRescueTarget().bearers).toEqual(['u1', 'u2']);
    for (const id of ['u1', 'u2']) {
      const command = system.units.get(id).entity.getComponent('commandState');
      expect(command.carryState).toBe('carrying');
      expect(command.stance).toBe('rescue');
    }
  });

  it('搬运态（玩家驾驶）：伤员不被自动拖动；担架兵按航向左右刚性贴位；抵达 → onRescueComplete', () => {
    const body = makeBody('body', { x: 200, y: 0 });
    system.setRescueTarget(body, { goal: { x: 600, y: 0 }, regionId: 'S02-camp-rescue' });
    system.units.get('u1').entity.getComponent('transform').position = { x: 190, y: 0 };
    system.units.get('u2').entity.getComponent('transform').position = { x: 230, y: 0 };
    system.update(0.1);
    expect(system.getRescueTarget().carrying).toBe(true);

    // 玩家未输入（速度 0）→ 组合体不自动移动；担架兵按默认航向 (1,0) 左右贴位
    system.update(0.5);
    expect(body.getComponent('transform').position.x).toBe(200); // 无拖拽：等待玩家驾驶
    const u1Transform = system.units.get('u1').entity.getComponent('transform').position;
    const u2Transform = system.units.get('u2').entity.getComponent('transform').position;
    expect(u1Transform.y).toBeCloseTo(18); // 航向 (1,0) → 侧向 (0,1)：u1 右侧、u2 左侧
    expect(u2Transform.y).toBeCloseTo(-18);
    expect(u1Transform.x).toBeCloseTo(200);
    expect(u2Transform.x).toBeCloseTo(200);

    // 玩家驾驶：伤员自行移动到目标点附近（30 半径内）→ 完成回调 + 担架兵转 hold + 任务清空
    const completions = [];
    system.onRescueComplete = payload => completions.push(payload);
    body.getComponent('transform').position = { x: 585, y: 0 };
    system.update(0.016);
    expect(completions).toHaveLength(1);
    expect(completions[0].regionId).toBe('S02-camp-rescue');
    expect(system.getRescueTarget()).toBe(null);
    for (const id of ['u1', 'u2']) {
      const command = system.units.get(id).entity.getComponent('commandState');
      expect(command.stance).toBe('hold');
      expect(command.carryState).toBe(null);
    }
  });

  it('搬运遇敌中断：担架解散、伤员重新倒地（onCarryEnd）；士兵切原地防守', () => {
    const body = makeBody('body', { x: 200, y: 0 });
    system.setRescueTarget(body, { goal: { x: 600, y: 0 } });
    system.units.get('u1').entity.getComponent('transform').position = { x: 190, y: 0 };
    system.units.get('u2').entity.getComponent('transform').position = { x: 230, y: 0 };
    system.update(0.1);
    expect(system.getRescueTarget().carrying).toBe(true);

    // 敌人进入担架兵警戒半径（160）→ 解散挂载
    const ends = [];
    const interrupts = [];
    system.onCarryEnd = () => ends.push(true);
    system.onRescueInterrupt = payload => interrupts.push(payload);
    system.setEnemies([makeEnemy('scavenger', { x: 300, y: 0 })]);
    system.update(0.016);
    expect(interrupts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(system.getRescueTarget().carrying).toBe(false);
    expect(body.getComponent('transform').position.x).toBe(200); // 伤员留在原地
    for (const id of ['u1', 'u2']) {
      const command = system.units.get(id).entity.getComponent('commandState');
      expect(command.stance).toBe('hold'); // 切原地防守自动战斗
      expect(command.carryState).toBe(null);
    }

    // 战后士兵重新走近触发框 → 自动再次挂载（无需重新下令）
    system.setEnemies([]);
    system.update(0.1);
    expect(system.getRescueTarget().carrying).toBe(true);
  });

  it('担架兵折损致不足两人 → 解散担架并触发 onCarryEnd', () => {
    const body = makeBody('body', { x: 200, y: 0 });
    system.setRescueTarget(body, { goal: { x: 600, y: 0 } });
    system.units.get('u1').entity.getComponent('transform').position = { x: 190, y: 0 };
    system.units.get('u2').entity.getComponent('transform').position = { x: 230, y: 0 };
    system.update(0.1);
    expect(system.getRescueTarget().carrying).toBe(true);

    const ends = [];
    system.onCarryEnd = () => ends.push(true);
    system.units.get('u2').entity.isDead = true;
    system.update(0.016);
    expect(ends).toHaveLength(1);
    expect(system.getRescueTarget().carrying).toBe(false);
    expect(system.units.get('u1').entity.getComponent('commandState').stance).toBe('hold');
  });

  it('伤员消失/死亡 → 搬运任务自动清理', () => {
    const body = makeBody('body', { x: 200, y: 0 });
    system.setRescueTarget(body, { goal: { x: 600, y: 0 } });
    system.applyStance('rescue');

    body.isDead = true;
    system.update(0.016);
    expect(system.getRescueTarget()).toBe(null);
  });
});

describe('ArmyCommandSystem M5 简化改造（预设+偶尔覆盖）', () => {
  let system;
  let combatSystem;

  beforeEach(() => {
    system = new ArmyCommandSystem({});
    combatSystem = { performAttack: vi.fn() };
    system.setCombatSystem(combatSystem);
    const unitA = makeUnit('u1', { x: 0, y: 0 });
    const unitB = makeUnit('u2', { x: 24, y: 0 });
    system.registerUnit(unitA, { squadId: 'qian' });
    system.registerUnit(unitB, { squadId: 'qian', formationIndex: 1 });
  });

  it('escort 默认跟随：无武将退化为驻守；有武将则回归武将周围阵型点', () => {
    // 无武将：退化为驻守（post=当前位置）
    system.setSelection('all');
    system.applyStance('escort');
    system.updateStances();
    expect(system.units.get('u1').entity.getComponent('commandState').stance).toBe('escort');
    expect(system.units.get('u1').entity.getComponent('movement').velocity.x).toBe(0);

    // 有武将：远离跟随点 → 朝武将移动（跟随点已外推到最小跟随距离 64，方向仍指向武将侧）
    const commander = makeBody('commander', { x: 300, y: 0 });
    system.setCommanderProvider(() => commander);
    system.units.get('u1').entity.getComponent('transform').position = { x: 0, y: 0 };
    system.units.get('u2').entity.getComponent('transform').position = { x: 10, y: 0 };
    system.updateStances();
    const velocity = system.units.get('u1').entity.getComponent('movement').velocity;
    expect(velocity.x).toBeGreaterThan(0); // 武将在东侧 → 向东跟随
    expect(velocity.x).toBeGreaterThan(90); // 外推后 x 分量略低于满速 94.5 但仍以横向为主
  });

  it('escort 接战：敌进入攻击范围且未拉离武将 → 站定攻击', () => {
    const commander = makeBody('commander', { x: 0, y: 0 });
    system.setCommanderProvider(() => commander);
    system.setSelection('all');
    system.applyStance('escort');
    const unit = system.units.get('u1').entity;
    unit.getComponent('transform').position = { x: 30, y: 0 };
    const enemy = makeEnemy('wolf', { x: 50, y: 0 });
    system.setEnemies([enemy]);
    system.updateStances();
    expect(unit.getComponent('movement').velocity.x).toBe(0);
    expect(combatSystem.performAttack).toHaveBeenCalled();
  });

  it('orderIntent 语义化：点敌=进攻、点地=驻守、点武将=集结，发完自动回武将', () => {
    const commander = makeBody('commander', { x: 0, y: 0 });
    system.setCommanderProvider(() => commander);
    const enemy = makeEnemy('wolf', { x: 400, y: 0 });
    system.setEnemies([enemy]);

    // 点敌 → assault，goal=敌位置，自动回武将
    system.setSelection('all');
    const assault = system.orderIntent({ x: 395, y: 5 });
    expect(assault).toMatchObject({ ok: true, intent: 'assault', count: 2 });
    expect(system.units.get('u1').entity.getComponent('commandState').stance).toBe('assault');
    expect(system.units.get('u1').entity.getComponent('commandState').goal).toEqual({ x: 400, y: 0 });
    expect(system.getSelectionSlot()).toBe('commander'); // 发完回武将

    // 点地 → hold，goal=post=点击点
    system.setSelection('all');
    const hold = system.orderIntent({ x: 500, y: 200 });
    expect(hold.intent).toBe('hold');
    const holdCommand = system.units.get('u1').entity.getComponent('commandState');
    expect(holdCommand.stance).toBe('hold');
    expect(holdCommand.post).toEqual({ x: 500, y: 200 });
    expect(system.getSelectionSlot()).toBe('commander');

    // 点武将附近 → 集结回归 escort
    system.setSelection('all');
    const regroup = system.orderIntent({ x: 30, y: 10 });
    expect(regroup.intent).toBe('regroup');
    const regroupCommand = system.units.get('u1').entity.getComponent('commandState');
    expect(regroupCommand.stance).toBe('escort');
    expect(regroupCommand.goal).toBe(null);
    expect(system.getSelectionSlot()).toBe('commander');
  });

  it('orderIntent 跳过 rescue 姿态单位（搬运任务优先）', () => {
    const commander = makeBody('commander', { x: 0, y: 0 });
    system.setCommanderProvider(() => commander);
    system.units.get('u1').entity.getComponent('commandState').stance = 'rescue';
    system.setSelection('all');

    const result = system.orderIntent({ x: 500, y: 300 });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1); // 只有 u2 受命
    expect(system.units.get('u1').entity.getComponent('commandState').stance).toBe('rescue'); // 保持搬运
  });

  it('orderIntent 点倒地伤员 → 救援意图：受命单位切 rescue 接近，搬运编排接管', () => {
    const body = makeBody('body', { x: 300, y: 0 });
    system.setRescueTarget(body, { goal: { x: 600, y: 0 }, regionId: 'S02-camp-rescue' });
    system.setSelection('all');

    const result = system.orderIntent({ x: 295, y: 5 }); // 点击伤员附近
    expect(result).toMatchObject({ ok: true, intent: 'rescue', count: 2 });
    for (const unit of system.units.values()) {
      const command = unit.entity.getComponent('commandState');
      expect(command.stance).toBe('rescue');
      expect(command.goal).toEqual({ x: 300, y: 0 });
    }
    expect(system.getSelectionSlot()).toBe('commander'); // 发完自动回武将

    // ≥2 人贴身 → 搬运启动（现有编排接管）
    system.units.get('u1').entity.getComponent('transform').position = { x: 280, y: 0 };
    system.units.get('u2').entity.getComponent('transform').position = { x: 320, y: 0 };
    system.update(0.2);
    expect(system.getRescueTarget().carrying).toBe(true);
  });

  it('Tab 循环：cycleSquadSelection 含武将（武将→全军→前→左→中→右→后 回绕）', () => {
    // 用户裁定：军队无命令时可快速切回武将本身
    expect(system.getSelectionSlot()).toBe('commander');
    const sequence = [];
    for (let i = 0; i < 7; i++) sequence.push(system.cycleSquadSelection());
    expect(sequence).toEqual(['all', 'qian', 'zuo', 'zhong', 'you', 'hou', 'commander']);
  });

  it('手柄命令循环：cycleCommandStance 仅编组选中有效，收敛可见 5 姿态（不含 rescue/flee）', () => {
    // 手柄指挥态 RB 键走此方法（§11.1.6 M5-3 按住 LB 指挥）
    expect(system.cycleCommandStance()).toBeNull(); // 未选中编组 → 无效

    system.setSelection('all');
    expect(system.cycleCommandStance()).toBe('escort');           // 首按落在"跟随"
    expect(system.cycleCommandStance()).toBe('assault');
    expect(system.cycleCommandStance()).toBe('hold');
    expect(system.cycleCommandStance()).toBe('advance');
    expect(system.cycleCommandStance()).toBe('retreat');
    expect(system.cycleCommandStance()).toBe('escort');           // 回绕
    expect(system.cycleCommandStance(-1)).toBe('retreat');        // 反向
    // 姿态循环不得进入剧情/紧急专用姿态
    const legal = new Set(['escort', 'assault', 'hold', 'advance', 'retreat']);
    for (let i = 0; i < 10; i++) expect(legal.has(system.cycleCommandStance())).toBe(true);
  });
});

describe('ArmyCommandSystem 战前预设（M5-3 per 军默认战术姿态）', () => {
  let system;

  beforeEach(() => {
    system = new ArmyCommandSystem({});
  });

  it('setSquadPreset 校验：未知军与非法姿态拒绝，合法写入', () => {
    // 默认全部跟随
    expect(system.getSquadPresets()).toEqual({ qian: 'escort', zuo: 'escort', zhong: 'escort', you: 'escort', hou: 'escort' });
    expect(system.setSquadPreset('qian', 'assault')).toEqual({ ok: true });
    expect(system.getSquadPreset('qian')).toBe('assault');
    expect(system.setSquadPreset('wujang', 'assault').ok).toBe(false); // 未知军
    expect(system.setSquadPreset('qian', 'flee').ok).toBe(false);     // flee 不入预设
    expect(system.setSquadPreset('qian', 'rescue').ok).toBe(false);   // rescue 剧情专用
  });

  it('applySquadPresets：开战按预设切姿态（escort 跟随 / hold 就地驻守 / assault 索敌）', () => {
    const qian = makeUnit('u1', { x: 0, y: 0, squadId: 'qian' });
    const zhong = makeUnit('u2', { x: 20, y: 0, squadId: 'zhong' });
    const hou = makeUnit('u3', { x: 40, y: 0, squadId: 'hou' });
    system.registerUnit(qian, { squadId: 'qian', formationIndex: 0 });
    system.registerUnit(zhong, { squadId: 'zhong', formationIndex: 0 });
    system.registerUnit(hou, { squadId: 'hou', formationIndex: 0 });
    system.setSquadPreset('qian', 'assault');
    system.setSquadPreset('zhong', 'hold');
    // hou 保持跟随

    system.applySquadPresets();
    expect(system.presetsActive).toBe(true);
    const commandQian = qian.getComponent('commandState');
    expect(commandQian.stance).toBe('assault');
    expect(commandQian.goal).toBeNull(); // assault 无固定目标，全图索敌
    const commandZhong = zhong.getComponent('commandState');
    expect(commandZhong.stance).toBe('hold');
    expect(commandZhong.post).toEqual({ x: 20, y: 0 }); // 开战位置即驻守点
    const commandHou = hou.getComponent('commandState');
    expect(commandHou.stance).toBe('escort');
    expect(commandHou.post).toBeNull();
  });

  it('预设应用跳过搬运单位；战斗结束 resetSquadsToEscort 回跟随', () => {
    const qian = makeUnit('u1', { x: 0, y: 0, squadId: 'qian' });
    const hou = makeUnit('u2', { x: 40, y: 0, squadId: 'hou' });
    system.registerUnit(qian, { squadId: 'qian', formationIndex: 0 });
    system.registerUnit(hou, { squadId: 'hou', formationIndex: 0 });
    system.setSquadPreset('qian', 'assault');
    system.setSquadPreset('hou', 'assault');
    // qian 正在搬运（rescue 姿态，任务优先 §11.2）
    qian.getComponent('commandState').stance = 'rescue';

    system.applySquadPresets();
    expect(qian.getComponent('commandState').stance).toBe('rescue'); // 不扰动
    expect(hou.getComponent('commandState').stance).toBe('assault');

    system.resetSquadsToEscort();
    expect(system.presetsActive).toBe(false);
    expect(qian.getComponent('commandState').stance).toBe('rescue'); // 搬运仍不扰动
    expect(hou.getComponent('commandState').stance).toBe('escort'); // 战后归队
    // 预设本身不被清除（下次开战再应用）
    expect(system.getSquadPreset('hou')).toBe('assault');
  });
});

describe('ArmyCommandSystem 军队直接驾驶（WASD/左摇杆接管，M6）', () => {
  let system;
  let fakeNow;

  beforeEach(() => {
    fakeNow = 1_000_000;
    system = new ArmyCommandSystem({ now: () => fakeNow });
  });

  it('驾驶接管：操作条开启 + 选中编组 → 轴输入直写 velocity 并消费输入', () => {
    const unit = makeUnit('u1', { x: 0, y: 0, squadId: 'qian', speed: 90 });
    system.registerUnit(unit, { squadId: 'qian' });
    system.setHudVisibleProvider(() => true);
    system.setSelection('qian');

    expect(system.isArmyDriveActive()).toBe(true);
    expect(system.handleDriveInput(1, 0, 1)).toBe(true);
    expect(unit.getComponent('movement').velocity).toEqual({ x: 90, y: 0 });
    expect(unit.getComponent('sprite').playAnimation).toHaveBeenCalledWith('walk');
  });

  it('武将槽/操作条关闭时不接管，武将移动不被消费', () => {
    const unit = makeUnit('u1', { squadId: 'qian' });
    system.registerUnit(unit, { squadId: 'qian' });
    system.setHudVisibleProvider(() => true);
    // 武将槽：选中单位为空 → hasSquadSelection false
    expect(system.handleDriveInput(1, 0, 1)).toBe(false);
    // 操作条关闭
    system.setSelection('qian');
    system.setHudVisibleProvider(() => false);
    expect(system.isArmyDriveActive()).toBe(false);
    expect(system.handleDriveInput(1, 0, 1)).toBe(false);
    expect(unit.getComponent('movement').velocity).toEqual({ x: 0, y: 0 });
  });

  it('驾驶窗口期内姿态机不抢速度（escort 不拉回武将）', () => {
    const commander = makeBody('commander', { x: 1000, y: 1000 });
    const unit = makeUnit('u1', { x: 0, y: 0, squadId: 'qian' });
    system.registerUnit(unit, { squadId: 'qian' });
    system.setCommanderProvider(() => commander);
    unit.getComponent('commandState').stance = 'escort';
    system.setHudVisibleProvider(() => true);
    system.setSelection('qian');

    expect(system.handleDriveInput(0, -1, 1)).toBe(true);
    const velocity = { ...unit.getComponent('movement').velocity };
    expect(velocity.y).toBeCloseTo(-90);
    system.update(0.016); // 同帧姿态机被驾驶守卫压制
    expect(unit.getComponent('movement').velocity).toEqual(velocity);
  });

  it('松开摇杆（magnitude=0）→ 原地驻守：goal 清空、post 更新为当前位置、速度清零', () => {
    const unit = makeUnit('u1', { x: 120, y: 80, squadId: 'qian' });
    system.registerUnit(unit, { squadId: 'qian' });
    system.setHudVisibleProvider(() => true);
    system.setSelection('qian');
    unit.getComponent('commandState').goal = { x: 500, y: 500 };

    expect(system.handleDriveInput(1, 0, 1)).toBe(true);
    unit.getComponent('transform').position = { x: 200, y: 60 }; // 驾驶期间移动
    expect(system.handleDriveInput(0, 0, 0)).toBe(false); // 松开收尾
    const command = unit.getComponent('commandState');
    expect(command.goal).toBeNull();
    expect(command.post).toEqual({ x: 200, y: 60 });
    expect(unit.getComponent('movement').velocity).toEqual({ x: 0, y: 0 });
  });

  it('关列表收尾后窗口期结束，姿态机恢复（escort 朝武将回归）', () => {
    const commander = makeBody('commander', { x: 1000, y: 0 });
    const unit = makeUnit('u1', { x: 0, y: 0, squadId: 'qian' });
    system.registerUnit(unit, { squadId: 'qian' });
    system.setCommanderProvider(() => commander);
    unit.getComponent('commandState').stance = 'escort';
    system.setHudVisibleProvider(() => true);
    system.setSelection('qian');

    system.handleDriveInput(1, 0, 1);
    system.setHudVisibleProvider(() => false); // 关闭操作条 → 下一帧收尾
    expect(system.handleDriveInput(1, 0, 1)).toBe(false);
    expect(unit.getComponent('movement').velocity).toEqual({ x: 0, y: 0 });
    fakeNow += 300; // 越过 250ms 驾驶窗口
    system.update(0.016);
    expect(unit.getComponent('movement').velocity.x).toBeGreaterThan(0);
  });

  it('搬运中单位豁免：不被驾驶驱动也不被收尾停止（担架编排刚性驱动）', () => {
    const carrier = makeUnit('u1', { x: 0, y: 0, squadId: 'qian' });
    const normal = makeUnit('u2', { x: 40, y: 0, squadId: 'qian' });
    system.registerUnit(carrier, { squadId: 'qian' });
    system.registerUnit(normal, { squadId: 'qian' });
    carrier.getComponent('commandState').carryState = 'carrying';
    carrier.getComponent('movement').velocity = { x: 30, y: -40 };
    system.setHudVisibleProvider(() => true);
    system.setSelection('qian');

    expect(system.handleDriveInput(1, 0, 1)).toBe(true);
    expect(carrier.getComponent('movement').velocity).toEqual({ x: 30, y: -40 }); // 不扰动
    expect(normal.getComponent('movement').velocity).toEqual({ x: 90, y: 0 });    // 正常驾驶

    system.handleDriveInput(0, 0, 0); // 松开收尾
    expect(carrier.getComponent('movement').velocity).toEqual({ x: 30, y: -40 }); // 仍不扰动
    expect(normal.getComponent('movement').velocity).toEqual({ x: 0, y: 0 });
  });
});
