import { describe, expect, it, beforeEach } from 'vitest';
import { DialogueSystem } from '../src/systems/DialogueSystem.js';
import { FoodLedgerSystem } from '../src/systems/FoodLedgerSystem.js';
import { BuildingNpcFlow } from '../example/sanguo_zhangjiao/systems/BuildingNpcFlow.js';

const RANKS = [
  { id: 'rank.wusheng', title: '伍长', value: 0 },
  { id: 'rank.shizhang', title: '什长', value: 5 }
];

const DIALOGUES = {
  'dialogue.bnp.s02.recruit': {
    startNode: 'start',
    nodes: {
      start: { speaker: '征召官', text: '', choices: [
        { id: 'confirm', text: '补员', nextNode: 'done' },
        { id: 'cancel', text: '再说', nextNode: 'cancel' }
      ] },
      done: { speaker: '征召官', text: '' },
      cancel: { speaker: '征召官', text: '' }
    }
  },
  'dialogue.bnp.s02.muster': {
    startNode: 'start',
    nodes: {
      start: { speaker: '收编官', text: '', choices: [
        { id: 'confirm', text: '收编', nextNode: 'done' },
        { id: 'cancel', text: '再说', nextNode: 'cancel' }
      ] },
      done: { speaker: '收编官', text: '' },
      cancel: { speaker: '收编官', text: '' }
    }
  },
  'dialogue.bnp.s10.rank': {
    startNode: 'start',
    nodes: {
      start: { speaker: '军府主簿', text: '', choices: [
        { id: 'confirm', text: '擢升', nextNode: 'done' },
        { id: 'cancel', text: '再说', nextNode: 'cancel' }
      ] },
      done: { speaker: '军府主簿', text: '' },
      cancel: { speaker: '军府主簿', text: '' }
    }
  }
};

function makeCompanion(id, armyId = 'companion') {
  return {
    id,
    isDead: false,
    getComponent(name) {
      return name === 'squadMember' ? { armyId, squadId: 'zhong' } : null;
    }
  };
}

function createFixture({ story = {}, campFood = 50, capacity = 20, currentSceneId = 'S02', existing = 2, existingArmyId = 'companion', scattered = [], spawnBudget = Infinity } = {}) {
  const blackboard = {
    state: { storyState: { playerRank: { rankId: 'rank.wusheng', title: '伍长', value: 0 }, s02RecruitCount: 2, ...story } },
    get(key) { return this.state[key]; },
    set(key, value) { this.state[key] = value; }
  };
  const ledger = new FoodLedgerSystem();
  ledger.registerCamp({ campId: 'camp.s02.field', ownerArmyId: 'army.player.escort', stock: { food: campFood }, capacity: 2000 });
  ledger.registerArmy({ id: 'army.player.escort', roster: { melee: 2 }, manpower: 2, supply: { food: 0, cap: 500 } });
  for (const entry of scattered) ledger.scatteredPool.push(entry);
  const dialogue = new DialogueSystem();
  for (const [id, data] of Object.entries(DIALOGUES)) dialogue.registerDialogue(id, data);
  const intents = [];
  const tips = [];
  const companions = [];
  for (let index = 0; index < existing; index += 1) companions.push(makeCompanion(`companion.seed.${index}`, existingArmyId));
  let spawnAttempts = 0;
  const scene = {
    currentSceneId,
    playerEntity: { id: 'player.entity', getComponent: () => ({ position: { x: 100, y: 100 } }) },
    gameLoader: {
      blackboard,
      project: {
        companionRule: { heroId: 'hero.test', initialRankId: 'rank.wusheng', capacityMax: 100 },
        buildingNpc: { recruit: { foodPerHead: 1 }, muster: { foodPerHead: 1 }, rank: { foodPerRank: 8 } }
      },
      getRegistry(name) {
        if (name === 'heroes') return { get: () => ({ stats: { command: 20 } }) };
        if (name === 'ranks') return { all: () => RANKS };
        return { get: () => null, all: () => [] };
      }
    },
    companionSquadSystem: { getCapacity: () => capacity },
    companionSquadFlow: { syncRoster() {} },
    entityStore: {
      all: companions,
      getById(id) { return this.all.find(entity => entity.id === id) || null; },
      remove(entity) {
        const index = this.all.indexOf(entity);
        if (index >= 0) this.all.splice(index, 1);
        return index >= 0;
      }
    },
    spawnCompanionMember({ unitId }) {
      spawnAttempts += 1;
      if (spawnAttempts > spawnBudget) return null;
      const entity = makeCompanion(unitId);
      companions.push(entity);
      return entity;
    },
    foodLedgerSystem: ledger,
    dialogueSystem: dialogue,
    sceneRuntime: { commandGateway: { execute: async intent => { intents.push(intent); return { ok: true }; } } },
    _showScreenTip(text) { tips.push(String(text)); },
    _worldIndex: { findScene: id => ({ offset: { x: id === 'S02' ? 100 : 300, y: 0 } }) }
  };
  const flow = new BuildingNpcFlow(scene);
  return { flow, scene, blackboard, ledger, dialogue, intents, tips, companions };
}

describe('BuildingNpcFlow', () => {
  let fixture;
  beforeEach(() => { fixture = createFixture(); });

  it('招募：显示上限/缺口/成本，并按亲卫上限补满实兵', async () => {
    const { flow, dialogue, ledger, intents, companions } = fixture;
    const opened = flow.interact({ npcId: 'recruit', source: 'scene' });
    expect(opened.ok).toBe(true);
    const start = dialogue.dialogues.get('dialogue.bnp.s02.recruit').nodes.get('start');
    expect(start.text).toContain('亲卫上限 20 人');
    expect(start.text).toContain('还缺 18 人');
    expect(start.choices[0].text).toContain('补员 18 人');

    const result = await flow.execute({ npcId: 'recruit' });
    expect(result.accepted).toBe(true);
    expect(ledger.getCamp('camp.s02.field').stock.food).toBe(32);
    expect(companions).toHaveLength(20);
    expect(intents).toHaveLength(1);
    expect(intents[0].payload).toMatchObject({ definitionId: 'story.bnp.recruit', count: 20, cap: 20, food: 18, spawnSeq: 18 });
    expect(dialogue.dialogues.get('dialogue.bnp.s02.recruit').nodes.get('done').text).toContain('亲卫 20/20');
  });

  it('招募：已有 10 名 S02-army-guard 编组守兵时，缺口 = 上限 - 10', async () => {
    const guardFixture = createFixture({ existing: 10, existingArmyId: 'army.player.escort' });
    const { flow, dialogue, intents, companions } = guardFixture;
    flow.interact({ npcId: 'recruit', source: 'scene' });
    const start = dialogue.dialogues.get('dialogue.bnp.s02.recruit').nodes.get('start');
    expect(start.text).toContain('现编 10 人');
    expect(start.text).toContain('还缺 10 人');
    const result = await flow.execute({ npcId: 'recruit' });
    expect(result.accepted).toBe(true);
    expect(companions).toHaveLength(20);
    expect(intents[0].payload).toMatchObject({ count: 20, cap: 20, spawnSeq: 10 });
  });

  it('招募：实体生成中途失败时回滚，不扣粮、不写事实', async () => {
    const failing = createFixture({ spawnBudget: 2 });
    const { flow, ledger, intents, companions, dialogue } = failing;
    flow.interact({ npcId: 'recruit', source: 'scene' });
    const result = await flow.execute({ npcId: 'recruit' });
    expect(result.accepted).toBe(false);
    expect(companions).toHaveLength(2);
    expect(ledger.getCamp('camp.s02.field').stock.food).toBe(50);
    expect(intents).toHaveLength(0);
    expect(dialogue.dialogues.get('dialogue.bnp.s02.recruit').nodes.get('done').text).toContain('没有生效');
  });

  it('招募：粮草不足时给出可读拒绝话术且不扣粮不写事实', async () => {
    const low = createFixture({ campFood: 10 });
    const { flow, dialogue, ledger, intents } = low;
    flow.interact({ npcId: 'recruit', source: 'scene' });
    const result = await flow.execute({ npcId: 'recruit' });
    expect(result.accepted).toBe(false);
    expect(result.message).toContain('还差 8 粮');
    expect(ledger.getCamp('camp.s02.field').stock.food).toBe(10);
    expect(intents).toHaveLength(0);
    expect(dialogue.dialogues.get('dialogue.bnp.s02.recruit').nodes.get('done').text).toContain('还差 8 粮');
  });

  it('收编：散兵池为空时只给拒绝话术，不出现确认项', () => {
    const { flow, dialogue } = fixture;
    flow.interact({ npcId: 'muster', source: 'scene' });
    const start = dialogue.dialogues.get('dialogue.bnp.s02.muster').nodes.get('start');
    expect(start.text).toContain('没有散兵');
    expect(start.choices).toHaveLength(1);
    expect(start.choices[0].id).toBe('cancel');
  });

  it('收编：从散兵池取人并生成实兵，计数与实体一致', async () => {
    const musterFixture = createFixture({ scattered: [{ armyId: 'army.player.escort', count: 5, day: 1, expiresDay: 30 }] });
    const { flow, ledger, intents, companions, dialogue } = musterFixture;
    flow.interact({ npcId: 'muster', source: 'scene' });
    const start = dialogue.dialogues.get('dialogue.bnp.s02.muster').nodes.get('start');
    expect(start.text).toContain('可收 5 人');
    const result = await flow.execute({ npcId: 'muster' });
    expect(result.accepted).toBe(true);
    expect(companions).toHaveLength(7);
    expect(ledger.listScattered({ armyId: 'army.player.escort' })).toHaveLength(0);
    expect(intents[0].payload).toMatchObject({ definitionId: 'story.bnp.muster', count: 7, absorbed: 5, spawnSeq: 5 });
  });

  it('官勋：取 ranks 下一级并解锁对应亲卫上限', async () => {
    const { flow, dialogue, ledger, intents } = createFixture({ capacity: 10 });
    flow.interact({ npcId: 'rank', source: 'scene' });
    const start = dialogue.dialogues.get('dialogue.bnp.s10.rank').nodes.get('start');
    expect(start.text).toContain('伍长');
    expect(start.text).toContain('什长');
    expect(start.text).toContain('亲卫上限随之升至 12 人');

    const result = await flow.execute({ npcId: 'rank' });
    expect(result.accepted).toBe(true);
    expect(ledger.getCamp('camp.s02.field').stock.food).toBe(42);
    expect(intents[0].payload).toMatchObject({
      definitionId: 'story.bnp.rank',
      rank: { rankId: 'rank.shizhang', title: '什长', value: 5 },
      cap: 12
    });
  });

  it('大地图：首次实地交互写持久解锁；未解锁点选给提示', () => {
    const { flow, blackboard, tips } = fixture;
    const locked = flow.interact({ npcId: 'muster', source: 'map' });
    expect(locked.ok).toBe(false);
    expect(tips.at(-1)).toContain('先到 S02');

    flow.interact({ npcId: 'muster', source: 'scene' });
    expect(blackboard.get('storyState').buildingNpcUnlocked.muster).toBeTruthy();
    const markers = flow.getMapMarkers();
    expect(markers.find(entry => entry.npcId === 'muster').unlocked).toBe(true);
    expect(markers.find(entry => entry.npcId === 'recruit').unlocked).toBe(false);
    expect(markers.find(entry => entry.npcId === 'muster').x).toBe(940 + 100);
  });
});
