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
 * TriggerActions - 触发器默认动作注册表
 *
 * 每个动作 fn(params, ctx)：从 ctx 取已有系统执行副作用，返回 Promise（需 await 的动作）。
 * ctx 由 TriggerSystem.init 注入：
 *   { blackboard, dialogue(DialogueSystem), sceneManager, questSystem, world,
 *     player, audioManager, floatingText, triggerSystem }
 *
 * 覆盖：变量/开关、对话、场景/大区、奖励、任务、提示、音频、生成、编排(wait/parallel)、战场。
 * 战场动作(battleWin 等)在 §14 实现 BattleMode 时补充具体逻辑，这里先占位。
 */

import { InputHints } from '../core/input/InputHints.js';

/** 稳定的内置 action 契约，供 canonical 候选引用校验复用。 */
export const DEFAULT_TRIGGER_ACTION_IDS = Object.freeze([
  'setVar', 'addVar', 'setFlag', 'toggleFlag', 'startDialogue', 'switchScene',
  'loadRegion', 'teleportToChunk', 'giveReward', 'heal', 'startQuest',
  'completeQuest', 'showTip', 'playSound', 'playBgm', 'spawnEnemy', 'wait',
  'parallel', 'battleWin', 'battleLose', 'mount',
  'rescue.command', 'battle.command', 'construction.command', 'vehicle.command',
  'quest.command', 'task.command', 'world.teleport', 'checkpoint.request', 'ending.command',
  'dialogue.command', 'tutorial.command', 'state.transaction', 'scenario.command'
]);

export function registerDefaultActions(triggerSystem) {
  triggerSystem.registerActions({
    // ---- 变量 / 开关 ----
    setVar: (p, ctx) => {
      if (!ctx.blackboard?.set || !p?.key) return false;
      ctx.blackboard.set(p.key, p.value);
      return true;
    },
    addVar: (p, ctx) => {
      if (!ctx.blackboard?.add || !p?.key) return false;
      ctx.blackboard.add(p.key, p.delta ?? 1);
      return true;
    },
    setFlag: (p, ctx) => {
      if (!ctx.blackboard?.set || !p?.key) return false;
      ctx.blackboard.set(p.key, p.value !== false);
      return true;
    },
    toggleFlag: (p, ctx) => {
      if (!ctx.blackboard?.toggle || !p?.key) return false;
      ctx.blackboard.toggle(p.key);
      return true;
    },

    // ---- 对话（await: true 时等待对话结束）----
    startDialogue: (p, ctx) => {
      const ds = ctx.dialogue;
      if (!ds?.startDialogue) return false;
      const started = ds.startDialogue(p.id, p.context || {});
      if (started === false) return false;
      // 只有对话成功启动后才等待结束；启动失败不得关闭 once trigger。
      return new Promise((resolve) => {
        if (!ds.onEnd) { resolve(true); return; }
        const off = ds.onEnd(() => { if (typeof off === 'function') off(); resolve(true); });
      });
    },

    // ---- 场景 / 大区切换 ----
    switchScene: async (p, ctx) => {
      const sm = ctx.sceneManager;
      if (!sm?.switchTo || !p?.scene) return false;
      if (p.transition === 'text' && sm.startTextTransition) {
        return new Promise(resolve => {
          const started = sm.startTextTransition({
            mainText: p.text || '场景切换中...',
            onComplete: async () => resolve((await sm.switchTo(p.scene, p.data || null)) !== false)
          });
          if (started === false) resolve(false);
        });
      }
      return (await sm.switchTo(p.scene, p.data || null)) !== false;
    },
    loadRegion: async (p, ctx) => {
      if (!p?.region) return false;
      // 大区流式切换（P5 WorldStreamingManager 接入前，先走 sceneManager）
      if (ctx.world?.loadRegion) return (await ctx.world.loadRegion(p.region, p.at)) !== false;
      if (ctx.sceneManager?.switchTo) {
        return (await ctx.sceneManager.switchTo(p.region, { at: p.at })) !== false;
      }
      return false;
    },

    // ---- 大地图内传送（同 region 内 chunk 间移动）----
    teleportToChunk: async (p, ctx) => {
      const scene = ctx.scene; // DataDrivenPrologueScene 或任何大地图场景
      if (scene?.teleportToChunk) {
        const result = await scene.teleportToChunk(p);
        return result?.ok === false || result === false ? result : (result || true);
      }
      // 回退：走 switchScene，但仍等待目标切换完成后才报告成功。
      console.warn('[TriggerActions] teleportToChunk: 当前场景不支持大地图传送，回退 switchScene');
      if (!ctx.sceneManager?.switchTo || !p?.scene) return false;
      return (await ctx.sceneManager.switchTo(p.scene, p.data || null)) !== false;
    },

    // ---- 奖励 ----
    // giveReward{ exp, gold, items }：items 每项可为完整物品对象，或 { id, quantity }（按内容库 registries.items 解析）
    giveReward: (p, ctx) => {
      const player = ctx.player;
      if (!player) return false;
      if (p.exp && typeof player.addExp !== 'function') return false;
      if (p.gold && !ctx.blackboard?.add) return false;

      const requestedItems = Array.isArray(p.items) ? p.items : [];
      const inventory = player.getComponent?.('inventory');
      if (requestedItems.length > 0 && !inventory?.addItem) return false;
      const itemRegistry = ctx.registries?.items;
      const inventoryBefore = inventory?.exportItems?.();
      const gained = [];
      try {
        for (const raw of requestedItems) {
          let item = raw;
          if (raw?.id && !raw.name && itemRegistry?.get) {
            const definition = itemRegistry.get(raw.id);
            if (definition) item = { ...definition, ...raw };
          }
          if (!item?.id) throw Object.assign(new Error('reward item definition missing'), { code: 'rewardItemMissing' });
          const quantity = Math.max(1, Math.floor(Number(raw?.quantity) || 1));
          const accepted = inventory.addItem(item, quantity);
          if (accepted !== quantity) {
            throw Object.assign(new Error(`reward inventory capacity insufficient: ${item.id}`), {
              code: 'inventoryFull'
            });
          }
          gained.push({ ...item, quantity: accepted });
        }
      } catch (error) {
        if (inventoryBefore && inventory?.loadItems) inventory.loadItems(inventoryBefore);
        return { ok: false, committed: false, code: error.code || 'rewardCommitFailed', error };
      }

      if (p.exp) player.addExp(p.exp);
      if (p.gold) ctx.blackboard.add('gold', p.gold);
      // 所有奖励都成功写入后才发布获得表现；失败路径不会触发 itemGained。
      for (const item of gained) {
        try { ctx.onItemGained?.(item, player); } catch (error) { /* 表现降级不回滚已提交奖励 */ }
      }
      return true;
    },

    // ---- 治疗 / 恢复 ----
    // heal{ hp, mp, full }：恢复玩家生命/法力；full=true 时全满。作用于 ctx.player。
    heal: (p, ctx) => {
      const player = ctx.player;
      if (!player) return false;
      const stats = player.getComponent?.('stats');
      if (!stats) return false;
      if (p.full) {
        if (stats.maxHp != null) stats.hp = stats.maxHp;
        if (stats.maxMp != null) stats.mp = stats.maxMp;
        return true;
      }
      let changed = false;
      if (p.hp != null && stats.maxHp != null) {
        stats.hp = Math.min(stats.maxHp, (stats.hp || 0) + p.hp);
        changed = true;
      }
      if (p.mp != null && stats.maxMp != null) {
        stats.mp = Math.min(stats.maxMp, (stats.mp || 0) + p.mp);
        changed = true;
      }
      return changed;
    },

    // ---- 任务 ----
    // 兼容 action 仅转发到 QuestTransactionService；不得直接写任务运行态。
    startQuest: (p, ctx) => {
      if (!ctx.questSystem?.acceptQuest) return false;
      return ctx.questSystem.acceptQuest(p.quest || p.questId);
    },
    completeQuest: (p, ctx) => {
      if (!ctx.questSystem?.turnInQuest) return false;
      return ctx.questSystem.turnInQuest(p.quest || p.questId);
    },

    // ---- 提示 / 引导 ----
    // 文案里可写 {bag}、{key:pickup} 等占位符，按当前输入方案（键鼠/触屏/手柄）替换
    showTip: (p, ctx) => {
      const params = { ...p, text: InputHints.format(p.text || '') };
      if (ctx.tutorial?.showTip) {
        return ctx.tutorial.showTip(params) !== false;
      }
      if (ctx.floatingText && ctx.player) {
        const transform = ctx.player.getComponent?.('transform');
        if (!transform) return false;
        ctx.floatingText.addText(transform.position.x, transform.position.y - 40, params.text, '#ffffff');
        return true;
      }
      return false;
    },

    // ---- 音频 ----
    playSound: async (p, ctx) => {
      if (!ctx.audioManager?.playSound || !p?.id) return false;
      const { id, options: nestedOptions, ...inlineOptions } = p || {};
      const options = nestedOptions && typeof nestedOptions === 'object'
        ? { ...inlineOptions, ...nestedOptions }
        : inlineOptions;
      return (await ctx.audioManager.playSound(id, options)) !== false;
    },
    playBgm: async (p, ctx) => {
      if (!ctx.audioManager?.playMusic || !p?.id) return false;
      return (await ctx.audioManager.playMusic(p.id, p.fadeIn === true)) !== false;
    },

    // ---- 生成 ----
    spawnEnemy: async (p, ctx) => {
      if (!ctx.world?.spawnEnemy) return false;
      return (await ctx.world.spawnEnemy(p)) !== false;
    },

    // ---- 编排 ----
    wait: (p) => new Promise((resolve) => setTimeout(() => resolve(true), (p.seconds || 0) * 1000)),
    parallel: async (p, ctx) => {
      const actions = Array.isArray(p.actions) ? p.actions : [];
      const results = await Promise.all(actions.map(async act => {
        const fn = ctx.triggerSystem?.actions?.[act.action];
        if (!fn) return false;
        try { return await fn(act.params || {}, ctx); }
        catch (error) { return { ok: false, committed: false, code: error?.code || 'parallelActionFailed' }; }
      }));
      return results.every(result => result !== false && result?.ok !== false);
    },

    // ---- 战场（§14 BattleMode 占位，具体逻辑待实现）----
    battleWin: (p, ctx) => {
      if (!ctx.blackboard?.set) return false;
      ctx.blackboard.set('_battleResult', { win: true, team: p.team });
      return true;
    },
    battleLose: (p, ctx) => {
      if (!ctx.blackboard?.set) return false;
      ctx.blackboard.set('_battleResult', { win: false, team: p.team });
      return true;
    },
    mount: async (p, ctx) => {
      if (!ctx.world?.mount) return false;
      return (await ctx.world.mount(p.rider, p.vehicle, p.seat)) !== false;
    }
  });
}

export default registerDefaultActions;
