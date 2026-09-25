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

  it('移动下令：阵型目标点写入 commandState.goal + 命令达成倒计时', () => {
    const unitA = makeUnit('u1', { x: 0, y: 0 });
    const unitB = makeUnit('u2', { x: 10, y: 0 });
    system.registerUnit(unitA, { squadId: 'qian', formationIndex: 0 });
    system.registerUnit(unitB, { squadId: 'qian', formationIndex: 1 });

    system.setSelection('all');
    const result = system.orderMove({ x: 500, y: 300 });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);

    // 阵型点：两单位水平并列，间距 44，围绕目标点分布（M2 由姿态机驱动移动）
    const goalA = unitA.getComponent('commandState').goal;
    const goalB = unitB.getComponent('commandState').goal;
    expect(goalA.x).toBeCloseTo(500 - 22);
    expect(goalB.x).toBeCloseTo(500 + 22);
    expect(Math.abs(goalA.y - goalB.y)).toBeLessThan(0.01);

    // 倒计时未归零且未到位 → 未达成
    const order = system.getActiveOrder();
    expect(order.done).toBe(false);
    expect(order.duration).toBeGreaterThan(0);
    system.update(order.duration / 2);
    expect(order.done).toBe(false);
    expect(order.countdown).toBeCloseTo(order.duration / 2);

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

    // hold 记录驻守点为当前位置
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
    expect(system.getSelectedStance()).toBe('flee');

    // HUD 姿态按钮点击 → applyStance（按钮位置由 render 生成，此处直接注入模拟）
    class HudpStub { }
    void HudpStub;
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
    expect(hud.handleMouseClick(80 + 10, 14, 'left')).toBe(true); // 第 2 个按钮 = 原地防守
    expect(unitA.getComponent('commandState').stance).toBe('hold');
    expect(system.pendingStance).toBe('hold');
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
    expect(system.getSelectedStance()).toBe('garrison');
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

describe('ArmyCommandSystem 搬运玩法（M4 抢救伤员）', () => {
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

  it('接近阶段：rescue 姿态单位朝伤员移动；不足 2 人不搬运', () => {
    const body = makeBody('body', { x: 200, y: 0 });
    system.setRescueTarget(body, { goal: { x: 600, y: 0 } });
    system.applyStance('rescue');

    // 两单位都远离伤员 → 接近（速度 0.9x 朝伤员）
    system.updateStances();
    for (const unit of system.getSelectedUnits()) {
      const velocity = unit.getComponent('movement').velocity;
      expect(velocity.x).toBeGreaterThan(0); // 伤员在东侧
      expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(81); // 90 × 0.9
    }
    expect(system.getRescueTarget().carrying).toBe(false);

    // 仅 1 人贴身（u2 调离到远处）→ 不搬运
    system.units.get('u2').entity.getComponent('transform').position = { x: 205, y: 0 };
    system.units.get('u1').entity.getComponent('transform').position = { x: 150, y: 0 };
    system.update(0.5);
    expect(system.getRescueTarget().carrying).toBe(false);
    expect(body.getComponent('transform').position.x).toBe(200); // 伤员未被拖动
  });

  it('搬运阶段：≥2 人贴身 → 伤员被拖向救援目标点；抵达 → onRescueComplete', () => {
    const body = makeBody('body', { x: 200, y: 0 });
    system.setRescueTarget(body, { goal: { x: 400, y: 0 }, regionId: 'S02-camp-rescue' });
    system.applyStance('rescue');

    // 两人贴身 → 搬运启动，伤员向目标点慢速移动（90 × 0.45）
    system.units.get('u1').entity.getComponent('transform').position = { x: 180, y: 0 };
    system.units.get('u2').entity.getComponent('transform').position = { x: 220, y: 0 };
    system.update(0.5);
    expect(system.getRescueTarget().carrying).toBe(true);
    expect(body.getComponent('transform').position.x).toBeCloseTo(220.25); // 200 + 40.5 × 0.5s

    // 搬运者 carryState 置位
    expect(system.units.get('u1').entity.getComponent('commandState').carryState).toBe('carrying');

    // 抵达目标点（30 半径内）→ 完成回调 + 救援单位转 hold + 任务清空
    const completions = [];
    system.onRescueComplete = payload => completions.push(payload);
    body.getComponent('transform').position = { x: 395, y: 0 };
    system.units.get('u1').entity.getComponent('transform').position = { x: 375, y: 0 };
    system.units.get('u2').entity.getComponent('transform').position = { x: 415, y: 0 };
    system.update(0.016);
    expect(completions).toHaveLength(1);
    expect(completions[0].regionId).toBe('S02-camp-rescue');
    expect(system.getRescueTarget()).toBe(null);
    for (const unit of system.getSelectedUnits()) {
      const command = unit.getComponent('commandState');
      expect(command.stance).toBe('hold');
      expect(command.carryState).toBe(null);
      expect(command.post).toBeTruthy();
    }
  });

  it('搬运遇敌中断：放下伤员、全体切原地防守；战后重新下令可恢复搬运', () => {
    const body = makeBody('body', { x: 200, y: 0 });
    system.setRescueTarget(body, { goal: { x: 600, y: 0 } });
    system.applyStance('rescue');
    system.units.get('u1').entity.getComponent('transform').position = { x: 180, y: 0 };
    system.units.get('u2').entity.getComponent('transform').position = { x: 220, y: 0 };
    system.update(0.1);
    const carryingX = body.getComponent('transform').position.x;
    expect(system.getRescueTarget().carrying).toBe(true);

    // 敌人进入救援警戒半径（160）→ 中断
    const interrupts = [];
    system.onRescueInterrupt = payload => interrupts.push(payload);
    system.setEnemies([makeEnemy('scavenger', { x: 260, y: 0 })]);
    system.update(0.016);
    expect(interrupts).toHaveLength(1);
    expect(system.getRescueTarget().carrying).toBe(false);
    expect(body.getComponent('transform').position.x).toBe(carryingX); // 伤员留在原地
    for (const unit of system.getSelectedUnits()) {
      const command = unit.getComponent('commandState');
      expect(command.stance).toBe('hold'); // 切原地防守自动战斗
      expect(command.carryState).toBe(null);
    }

    // 战后不自动恢复：敌人清空后仍保持 hold
    system.setEnemies([]);
    system.update(0.1);
    expect(system.getSelectedUnits()[0].getComponent('commandState').stance).toBe('hold');
    expect(system.getRescueTarget().carrying).toBe(false);

    // 重新下达抢救伤员 → 恢复接近/搬运
    system.setSelection('all');
    system.applyStance('rescue');
    system.update(0.5);
    expect(system.getRescueTarget().carrying).toBe(true);
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
