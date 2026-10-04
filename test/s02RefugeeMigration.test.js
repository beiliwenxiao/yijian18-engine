// S09 饥民事件迁移 S02：事实场景门、触发器、场景放置、任务链一致性数据断言。
// 迁移原则：definitionId/checkpointId/对话 id/storyState 键名保留 S09 前缀（存档兼容），
// 仅场景门与场景绑定迁至 S02。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));

const commands = JSON.parse(fs.readFileSync(path.join(ROOT, 'example/sanguo_zhangjiao/project/commands.json'), 'utf8'));
const triggers = JSON.parse(fs.readFileSync(path.join(ROOT, 'example/sanguo_zhangjiao/project/triggers.json'), 'utf8'));
const triggerArr = Array.isArray(triggers) ? triggers : triggers.triggers;
const quests = JSON.parse(fs.readFileSync(path.join(ROOT, 'example/sanguo_zhangjiao/project/quests.json'), 'utf8'));
const s02 = JSON.parse(fs.readFileSync(path.join(ROOT, 'example/sanguo_zhangjiao/assets/scenes/S02.json'), 'utf8'));
const s09 = JSON.parse(fs.readFileSync(path.join(ROOT, 'example/sanguo_zhangjiao/assets/scenes/S09.json'), 'utf8'));

const objectsOf = scene => (scene.layers || []).flatMap(layer => layer.objects || []);
const REFUGEE_FACT_IDS = ['story.s09.refugee.prepare', 'story.s09.refugee.start', 'story.s09.refugee.donate', 'story.s09.refugee.branch'];

describe('S09 饥民事件迁移 S02', () => {
  it('四个饥民事实的场景门全部为 S02，checkpoint 挂 S02，S09 场景门零残留', () => {
    for (const id of REFUGEE_FACT_IDS) {
      const definition = commands.find(entry => entry.id === id);
      expect(definition, `${id} 应存在`).toBeTruthy();
      const serialized = JSON.stringify(definition);
      expect(serialized).toContain('"S02"');
      expect(serialized.includes('"sceneId": "S09"')).toBe(false);
      expect(serialized.includes('"equals": "S09"')).toBe(false);
    }
    // definitionId 与 checkpointId 名字保留 S09 前缀（存档兼容）
    expect(commands.find(entry => entry.id === 'story.s09.refugee.branch').transaction.variantDefinitions.donate_food)
      .toBe('story.s09.refugee.donate');
  });

  it('饥民触发器迁至 S02（prepare 挂 sceneEnter S02，choice 监听对话 id 不变）', () => {
    const prepare = triggerArr.find(trigger => trigger.id === 'trg_s02_prepare_refugee_conflict');
    expect(prepare).toBeTruthy();
    expect(prepare.when).toEqual({ type: 'sceneEnter', params: { sceneId: 'S02' } });
    const choice = triggerArr.find(trigger => trigger.id === 'trg_s02_refugee_choice');
    expect(choice.when.params.id).toBe('dialogue.s09.refugeeConflict');
    // S09 侧旧触发器已删除
    expect(triggerArr.some(trigger => /trg_s09_.*refugee/i.test(trigger.id))).toBe(false);
  });

  it('黄巾军离场：farewell 触发器 tombstone S02-army；awakening_done 开饥民任务而非召见', () => {
    const farewell = triggerArr.find(trigger => trigger.id === 'trg_s02_farewell');
    expect(farewell.when).toEqual({ type: 'dialogueEnd', params: { id: 'dialogue.s02.awakening' } });
    expect(farewell.do[0].action).toBe('despawnPlacements');
    expect(farewell.do[0].params.selector).toEqual({ group: 'S02-army' });
    const awakeningDone = triggerArr.find(trigger => trigger.id === 'trg_s02_awakening_done');
    expect(awakeningDone.do[0].params.definitionId).toBe('task.s02.refugeeRelief');
    expect(awakeningDone.do.some(action => action.params?.definitionId === 'task.s02.summons')).toBe(false);
  });

  it('S02 场景承载饥民营地（8 放置 + 交互绑定），S09 场景饥民放置清零', () => {
    const s02Ids = objectsOf(s02).map(entry => entry.id);
    for (const suffix of ['soldier', 'woman', 'child', 'dead-west', 'dead-east', 'one-armed']) {
      expect(s02Ids).toContain(`S02-refugee-${suffix}`);
    }
    expect(s02Ids).toContain('S02-story-bread');
    expect(s02Ids).toContain('S02-refugee-scout');
    expect(s02Ids).toContain('S02-binding-refugee-conflict');
    // 废营储备粮：捐粮 20 份的可及来源（防流程死锁）
    const food = objectsOf(s02).find(entry => entry.id === 'S02-supply-food');
    expect(food?.overrides?.quantity).toBeGreaterThanOrEqual(20);
    const s09Ids = objectsOf(s09).map(entry => entry.id);
    expect(s09Ids.some(id => /S09-refugee-|S09-story-bread|S09-binding-refugee/.test(id))).toBe(false);
  });

  it('任务链：refugeeRelief 先行，summons 由 questCompleted 接续，S03-S14 全覆盖', () => {
    const relief = quests.find(quest => quest.id === 'task.s02.refugeeRelief');
    expect(relief).toBeTruthy();
    expect(relief.steps.map(step => step.target)).toEqual(['story.s09.refugee.start', 'story.s09.refugee.branch']);
    const summons = quests.find(quest => quest.id === 'task.s02.summons');
    expect(summons.accept.when).toEqual({ type: 'questCompleted', questId: 'task.s02.refugeeRelief' });
    for (const sceneId of ['S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S10', 'S11', 'S12', 'S13', 'S14']) {
      const quest = quests.find(entry => entry.scenes?.includes(sceneId) && entry.accept?.when?.type === 'event');
      expect(quest, `${sceneId} 应有 sceneEnter 自动接取的主线任务`).toBeTruthy();
      expect(quest.accept.when.params.sceneId).toBe(sceneId);
    }
  });
});
