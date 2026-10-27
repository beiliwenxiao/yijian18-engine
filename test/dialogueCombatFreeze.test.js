/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { describe, it, expect, vi } from 'vitest';
import { SceneFramePipeline } from '../src/core/scene/SceneFramePipeline.js';

/**
 * 对话/旁白期间冻结战斗与 AI（SceneFramePipeline）
 *
 * 玩家侧战斗动作已有对话守卫（SceneCombatActions），本组测试固化怪物侧的
 * 对称冻结：dialogueSystem.isDialogueActive() === true 时——
 *   - aiSystem.update 不执行（怪物不索敌/不决策/不移动）
 *   - combatSystem.update 不执行（不结算攻击/扑击/伤害数字）
 *   - combatSystem.updateCombatState 不执行（战斗态维持对话前状态）
 * 对话结束后三系统恢复每帧更新。
 */

function createScene({ dialogueActive }) {
  return {
    isActive: true,
    isPaused: false,
    dialogueSystem: {
      isDialogueActive: () => dialogueActive,
      update: vi.fn()
    },
    performanceOptimizer: {
      update: vi.fn(),
      updateSpatialGrid: vi.fn(),
      shouldUpdate: vi.fn(name => name === 'ai')
    },
    tutorialSystem: { update: vi.fn() },
    getGameState: vi.fn(() => ({})),
    handleUIClick: vi.fn(),
    checkTerrainCollision: vi.fn(),
    handleEnemySelection: vi.fn(),
    postCameraUpdate: vi.fn(),
    checkDialogueContinue: vi.fn(),
    removeDeadEntities: vi.fn()
  };
}

function createContext() {
  return {
    systems: {
      ai: { update: vi.fn() },
      combat: { update: vi.fn(), updateCombatState: vi.fn() },
      movement: { update: vi.fn(() => ({})) },
      meditation: { isActive: vi.fn(() => false), update: vi.fn() },
      equipment: { update: vi.fn() },
      collision: { update: vi.fn() }
    },
    presentation: {
      floatingTextManager: { update: vi.fn() },
      particleSystem: { update: vi.fn(), getActiveCount: () => 0 }
    },
    camera: { instance: { update: vi.fn() } },
    input: {
      manager: {
        isMouseClicked: () => false,
        isMouseButtonDown: () => false,
        getMouseButton: () => 0,
        isMouseClickHandled: () => false,
        isKeyDown: () => false,
        getMoveAxis: () => null,
        update: vi.fn()
      }
    },
    entities: { all: [] },
    player: { entity: null }
  };
}

describe('对话/旁白期间冻结战斗与 AI', () => {
  it('对话未激活：AI 与战斗三系统每帧正常更新', () => {
    const scene = createScene({ dialogueActive: false });
    const context = createContext();
    new SceneFramePipeline({ scene, context }).run(0.016);

    expect(context.systems.ai.update).toHaveBeenCalledTimes(1);
    expect(context.systems.combat.update).toHaveBeenCalledTimes(1);
    expect(context.systems.combat.updateCombatState).toHaveBeenCalledTimes(1);
  });

  it('对话激活：AI 与战斗三系统整帧冻结', () => {
    const scene = createScene({ dialogueActive: true });
    const context = createContext();
    new SceneFramePipeline({ scene, context }).run(0.016);

    expect(context.systems.ai.update).not.toHaveBeenCalled();
    expect(context.systems.combat.update).not.toHaveBeenCalled();
    expect(context.systems.combat.updateCombatState).not.toHaveBeenCalled();
    // 对话系统自身仍每帧推进（打字机/选项）
    expect(scene.dialogueSystem.update).toHaveBeenCalledTimes(1);
  });

  it('对话结束后恢复：三系统重新每帧更新', () => {
    const scene = createScene({ dialogueActive: true });
    const context = createContext();
    const pipeline = new SceneFramePipeline({ scene, context });

    pipeline.run(0.016);
    expect(context.systems.ai.update).not.toHaveBeenCalled();

    scene.dialogueSystem.isDialogueActive = () => false;
    pipeline.run(0.016);

    expect(context.systems.ai.update).toHaveBeenCalledTimes(1);
    expect(context.systems.combat.update).toHaveBeenCalledTimes(1);
    expect(context.systems.combat.updateCombatState).toHaveBeenCalledTimes(1);
  });
});
