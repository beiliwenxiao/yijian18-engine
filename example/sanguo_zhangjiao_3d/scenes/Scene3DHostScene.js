/**
 * Scene3DHostScene - S01 数据驱动 3D 宿主（方案决策 A：独立宿主，2D 现网零改动）
 *
 * M1：任务/触发器/教程由 2D 工程数据驱动——
 * - project/triggers.json  事件→命令链（S01TriggerRunner 执行）
 * - project/quests.json    任务步骤机（dialogue/tutorial/objective/action 四类步）
 * - project/tutorials.json 教程文案（顶部提示条）
 * - 命令分发：task.command / tutorial.command / startDialogue / spawnPlacements /
 *   s01Survival（presentEntry、commitStoryWhenReady、refuelCampfire、组生成类 op）
 * - 交互：S01-logic 绑定 + 采集节点（node 定义驱动：工具需求/产量区间）+ 可拾取物件
 * - 事实：commitFact 驱动任务目标步推进 + activeWhen 状态镜像 + 门控放置物
 *
 * 手写玩法为零：所有推进均来自 2D 工程同源数据。
 */

import { Logger } from '../../../src/core/Logger.js';
import { BaseGameScene } from './BaseGameScene.js';
import { ProjectData } from './project/ProjectData.js';
import { S01WorldBuilder3D } from './S01WorldBuilder3D.js';
import { S01TriggerRunner } from './S01TriggerRunner.js';

const QUEST_ID = 'task.s01.survival';

export class Scene3DHostScene extends BaseGameScene {
  constructor() {
    super(1, {
      title: 'S01：寒风荒野求生',
      description: '2D 工程数据 · 3D 渲染'
    });

    this.projectData = null;
    this.questState = null;

    // 事实与状态镜像（M1 简化版 storyState；key: story.s01.X / s01Survival.X）
    this.storyFlags = new Map();
    this.counters = new Map();
    this.tutorialFlags = new Map();

    // 任务步骤机（全步骤，含 type/target/action）
    this.quest = null;

    // 教程顶部提示
    this.currentTip = null;      // { title, text }

    // 交互 / 采集
    this._wakeDialogueStarted = false;
    this._campfireLit = false;
  }

  loadActData() {
    Logger.log('Scene3DHostScene: 跳过 Act1Data（数据来自 game.project 管线）');
  }

  enter(data = null) {
    super.enter(data);

    // 数据到达前占位
    this.s01Ground3D = { ensure() {}, update() {} };

    this.applyPlayerArtwork();
    this.loadProject();

    Logger.log('Scene3DHostScene: 进入 S01 数据驱动 3D 宿主');
  }

  // ============ 工程数据装载 ============

  async loadProject() {
    try {
      const pd = await ProjectData.load();
      this.projectData = pd;

      const world = new S01WorldBuilder3D(pd);
      this.s01World = world;
      this.s01Ground3D = world;

      // 2D 狼美术预加载（战斗实体 billboard）
      this.loadWolfArtwork();

      // 玩家传送到工程出生点
      const spawn = pd.spawnPoint('S01-spawn-player');
      if (spawn) {
        const transform = this.playerEntity?.getComponent('transform');
        if (transform) {
          transform.position.x = spawn.x;
          transform.position.y = spawn.y;
        }
      }

      // 触发器执行桥
      this.triggerRunner = new S01TriggerRunner({
        triggers: pd.triggers('trg_s01'),
        handlers: {
          executeAction: (step, ctx, trg) => this.executeCommand(step, ctx, trg),
          onTriggerStart: (trg) => Logger.log(`Scene3DHostScene: 触发 ${trg.id} — ${trg.name || ''}`),
          onTriggerEnd: (trg) => Logger.log(`Scene3DHostScene: 触发完成 ${trg.id}`)
        }
      });

      // 任务步骤机（全步骤数据驱动）
      this.quest = {
        steps: pd.questFullSteps(QUEST_ID),
        index: -1,
        started: false,
        completed: false
      };

      // 场景进入事件 → task.start + 装配初始场景 + presentEntry（2D 同链）
      this.triggerRunner.fire('sceneEnter', { sceneId: 'S01' });

      Logger.log('Scene3DHostScene: 工程数据装载完成');
    } catch (err) {
      console.error('Scene3DHostScene: 工程数据装载失败', err);
    }
  }

  // ============ 玩家美术（2D 主角 LPC） ============

  applyPlayerArtwork() {
    const canvas = document.createElement('canvas');
    canvas.width = 9 * 64;
    canvas.height = 4 * 64;
    const ctx2d = canvas.getContext('2d');
    ctx2d.fillStyle = '#4a4a4a';
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);

    if (this.assetManager?.images) {
      this.assetManager.images.set('s01_player_lpc', canvas);
    }

    const img = new Image();
    img.onload = () => {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      // LPC universal walk 行：row8=up, row9=left, row10=down, row11=right（各9帧）
      ctx2d.drawImage(img, 0, 8 * 64, 9 * 64, 4 * 64, 0, 0, 9 * 64, 4 * 64);
      this.renderBackend?.entityViews?.delete?.(this.playerEntity?.id);
      Logger.log('Scene3DHostScene: 2D 主角 LPC 美术就绪 (s01_player_lpc)');
    };
    img.onerror = () => console.warn('Scene3DHostScene: LPC 主角图加载失败');
    img.src = '../sanguo_zhangjiao/assets/images/player/lpc/frames.png';

    const sprite = this.playerEntity?.getComponent('sprite');
    if (sprite) {
      sprite.spriteSheet = 's01_player_lpc';
      sprite.useAnimatedSprite = true;
      sprite.spriteColumns = 9;
      sprite.spriteRows = 4;
      sprite.directionRowMap = {
        up: 0, 'up-left': 0, 'up-right': 0,
        left: 1, 'down-left': 1, 'down-right': 3, right: 3,
        down: 2, idle: 2
      };
      sprite.width = 56;
      sprite.height = 64;
    }
  }

  // ============ 触发器命令分发（2D commands 同构） ============

  async executeCommand(step, ctx, trg) {
    const { action, params = {} } = step;
    switch (action) {
      case 'task.command':
        this.onTaskCommand(params);
        break;
      case 'tutorial.command':
        this.onTutorialCommand(params);
        break;
      case 'startDialogue':
        this.playDialogue(params.id);
        break;
      case 'spawnPlacements':
        this.spawnPlacementsGroup(params.selector?.group || '');
        break;
      case 'state.transaction':
        this.commitFact(params.definitionId);
        break;
      case 'showTip':
        this.showFloatingHint(params.text || '');
        break;
      case 'construction.command':
        this.tryBuildShelter(params);
        break;
      case 's01Survival':
        this.onS01SurvivalOp(params);
        break;
      default:
        Logger.log('Scene3DHostScene: 命令待接入', action, step.stepId || '');
        break;
    }
  }

  /** 按组生成放置物；敌对项生成战斗实体 */
  spawnPlacementsGroup(group) {
    const records = this.s01World?.spawnGroup(group) || [];
    for (const record of records) {
      if (record.kind === 'enemy') this.spawnWolfEntity(record);
    }
    return records;
  }

  onTaskCommand(params) {
    if (params.operation === 'task.start' && params.definitionId === QUEST_ID && !this.quest.started) {
      this.quest.started = true;
      this.activateStep(0);
    }
  }

  onTutorialCommand(params) {
    const { operation, tutorialId } = params;
    if (operation === 'complete') {
      this.tutorialFlags.set(tutorialId, true);
      this.onTutorialCompleted(tutorialId);
    } else if (operation === 'show') {
      this.showTutorialTip(tutorialId);
    }
  }

  /**
   * s01Survival 命令（2D S01S02SceneFlow 的 3D 承载）
   */
  onS01SurvivalOp(params) {
    const op = params.operation;
    switch (op) {
      case 'presentEntry':
        this.playDialogue('dialogue.s01.wake');
        break;
      case 'commitStoryWhenReady':
        this.commitStoryWhenReady(params);
        break;
      case 'ensureMovedAfterWake':
        // 2D：确保玩家起身活动（教程 s01.move 完成）
        if (!this.tutorialFlags.get('s01.move')) {
          this.tutorialFlags.set('s01.move', true);
          this.onTutorialCompleted('s01.move');
        }
        break;
      case 'campfireLit':
        // 点火视觉 + 事实提交（任务目标步 target story.s01.campfireLit）
        if (!this._campfireLit) {
          this._campfireLit = true;
          this.s01World?.setCampfireLit(true);
          const transform = this.playerEntity?.getComponent('transform');
          if (transform && this.floatingTextManager) {
            this.floatingTextManager.addText(
              transform.position.x, transform.position.y - 60,
              '篝火点燃了，暖和了一些', '#ffb347'
            );
          }
          this.commitFact('story.s01.campfireLit');
        }
        break;
      case 'refuelCampfire':
        this.refuelCampfire();
        break;
      case 'openBerryGathering':
        this.spawnPlacementsGroup('S01-berries');
        break;
      case 'dropWornAxe':
        this.spawnPlacementsGroup('S01-worn-axe');
        break;
      case 'afterBerriesGathered':
        break;
      case 'afterWoodGathered':
        this.showFloatingHint('篝火快熄灭了，回去添柴');
        break;
      case 'ensureFirstWolf':
        this.spawnPlacementsGroup('S01-first-wolf');
        break;
      case 'openCookingRecipes':
        this.craftAtRack('cook');
        break;
      case 'openTanningRecipes':
        this.craftAtRack('tan');
        break;
      case 'enterShelter':
        this.enterShelter();
        break;
      case 'overnight':
        this.doOvernight();
        break;
      case 'riverCrossed':
        if (!this.storyFlags.get('story.s01.riverCrossed')) {
          this.commitFact('story.s01.riverCrossed', '跳石过河——荒原对岸到了');
        }
        break;
      case 'cliffReached':
        if (!this.storyFlags.get('story.s01.cliffReached')) {
          this.commitFact('story.s01.cliffReached', '崖壁到了——藤蔓垂在眼前');
        }
        break;
      case 'leaveShelter':
        if (!this.storyFlags.get('story.s01.leaveShelter')) {
          this.commitFact('story.s01.leaveShelter');
        }
        break;
      default:
        Logger.log('Scene3DHostScene: s01Survival op 待接入', op);
        break;
    }
  }

  // ============ 战斗：狼实体 / 死亡 / 波次 ============

  /**
   * S01 美术：2D 狼原图注册（key: s01_wolf_static，68×48；狼王 96×64）
   */
  loadWolfArtwork() {
    if (!this.assetManager?.images) return;
    const img = new Image();
    img.onload = () => {
      this.assetManager.images.set('s01_wolf_static', img);
    };
    img.onerror = () => console.warn('Scene3DHostScene: 2D 狼美术加载失败');
    img.src = '../sanguo_zhangjiao/assets/images/s01/wild-wolf.png';
  }

  applyWolfArtwork(enemy, isBoss = false) {
    const sprite = enemy?.getComponent?.('sprite');
    if (!sprite) return;
    sprite.spriteSheet = 's01_wolf_static';
    sprite.spriteColumns = 1;
    sprite.spriteRows = 1;
    sprite.useAnimatedSprite = false;
    sprite.width = isBoss ? 96 : 68;
    sprite.height = isBoss ? 64 : 48;
  }

  /**
   * 生成狼战斗实体（挂库定义 stats/lootTable + AI）
   */
  spawnWolfEntity(record) {
    if (record.entity) return record;
    const def = this.projectData.definition(record.ref) || {};
    const enemy = this.entityFactory.createEnemy({
      name: def.name || record.name,
      templateId: 'wild_dog',
      level: def.level || 1,
      position: { x: record.x, y: record.y },
      stats: def.stats ? { ...def.stats } : { maxHp: 30, attack: 5, defense: 1 },
      aiType: def.aiType || 'aggressive'
    });
    this.applyWolfArtwork(enemy, !!def.isBoss);
    enemy.lootTable = def.lootTable || null;
    enemy.placementId = record.placementId;
    enemy.enemyGroup = record.group;
    enemy.enemyRole = record.placementId === 'S01-first-wolf' ? 'firstWolf' : null;

    this.entities.push(enemy);
    (this.enemyEntities ||= []).push(enemy);
    this.aiSystem.registerAI(enemy, def.aiType || 'aggressive');
    record.entity = enemy;
    record.corpseRef = def.corpse?.resourceNodeRef || 'node.wolf_carcass';
    Logger.log('Scene3DHostScene: 生成敌对实体', def.name, record.placementId);
    return record;
  }

  /**
   * 每帧：狼死亡检测 → enemy.killed 事件 + 尸体采集节点 + waveCleared
   */
  checkWolfDeaths() {
    const list = this.enemyEntities || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const enemy = list[i];
      const stats = enemy.getComponent('stats');
      if (!stats || stats.hp > 0) continue;

      list.splice(i, 1);
      const record = this.s01World?.spawnedPlacements?.find(r => r.placementId === enemy.placementId);
      const transform = enemy.getComponent('transform');
      const deathX = transform?.position.x ?? record?.x ?? 0;
      const deathY = transform?.position.y ?? record?.y ?? 0;

      // 尸体 → 采集节点（剥皮刀采集，产出狼皮；触发 wolfSkinned 链）
      const carcassObj = {
        id: 'carcass-' + (enemy.placementId || enemy.id),
        ref: enemy.corpseRef || 'node.wolf_carcass',
        kind: 'resourceNode',
        group: record?.group || null,
        x: deathX, y: deathY
      };
      const carcass = this.s01World?.spawnPlacement(carcassObj);
      if (carcass && this.floatingTextManager && transform) {
        this.floatingTextManager.addText(deathX, deathY - 50, '狼的尸体', '#dddddd');
      }

      // enemy.killed 事件（第一匹狼携带 enemyRole）
      this.triggerRunner?.fire('enemy.killed', {
        corpseReady: true,
        enemyRole: enemy.enemyRole || null,
        placementId: enemy.placementId,
        ref: enemy.corpseRef
      });

      // 波次清空检测
      if (enemy.enemyGroup) {
        this.checkWaveCleared(enemy.enemyGroup);
      }
    }
  }

  checkWaveCleared(group) {
    if (this._clearedWaves?.has(group)) return;
    const pending = (this.s01World?.spawnedPlacements || [])
      .filter(r => r.group === group && r.kind === 'enemy' && !r.consumed);
    const allDead = pending.every(r => {
      const st = r.entity?.getComponent('stats');
      return !st || st.hp <= 0;
    });
    if (!allDead) return;
    (this._clearedWaves ||= new Set()).add(group);
    this.triggerRunner?.fire('waveCleared', { group });
  }

  // ============ 加工 / 建造 ============

  /**
   * 烤肉架 / 制皮架（openCookingRecipes / openTanningRecipes）
   */
  craftAtRack(kind) {
    const inventory = this.playerEntity?.getComponent('inventory');
    if (!inventory) return;
    if (kind === 'cook') {
      if (this.countInventoryItem('resource.raw_wolf_meat') < 1) {
        this.showFloatingHint('没有生狼肉可烤');
        return;
      }
      inventory.removeItem('resource.raw_wolf_meat', 1);
      const roasted = this.projectData.definition('resource.roasted_wolf_meat');
      inventory.addItem({
        id: 'resource.roasted_wolf_meat',
        name: roasted?.name || '烤狼肉',
        type: 'consumable',
        usable: true,
        effect: { type: 'heal', value: 35 },
        maxStack: 10,
        description: '烤熟的狼肉，香气扑鼻'
      }, 1);
      this.commitFact('story.s01.meatCooked', '狼肉烤熟了');
    } else if (kind === 'tan') {
      if (this.countInventoryItem('resource.wolf_hide') < 1) {
        this.showFloatingHint('没有狼皮可加工');
        return;
      }
      inventory.removeItem('resource.wolf_hide', 1);
      this.commitFact('story.s01.wolfGearCrafted', '狼皮背心制作完成');
    }
  }

  /**
   * 搭建小庇护所（construction.command → 库定义材料需求）
   */
  tryBuildShelter(params) {
    if (this.storyFlags.get('story.s01.shelterCompleted')) return;
    const inventory = this.playerEntity?.getComponent('inventory');
    const def = this.projectData.definition(params.definitionId || 'construction.s01.small_shelter');
    const required = def?.materials || def?.cost || { 'resource.wood': 4 };
    for (const [itemId, qty] of Object.entries(required)) {
      if (this.countInventoryItem(itemId) < qty) {
        this.showFloatingHint(`材料不足：还需要 ${qty - this.countInventoryItem(itemId)} 个木材`);
        return;
      }
    }
    for (const [itemId, qty] of Object.entries(required)) {
      inventory?.removeItem(itemId, qty);
    }
    this.s01World?.spawnGroup('S01-small-shelter');
    this.commitFact('story.s01.shelterCompleted', '小庇护所搭建完成！');
  }

  // ============ 事实 / 状态镜像 ============

  /**
   * 提交故事事实：状态镜像 + state.transaction 事件 + 任务目标步推进
   */
  commitFact(factId, tipText = null) {
    if (this.storyFlags.get(factId)) return;
    this.storyFlags.set(factId, true);

    // 派生 activeWhen 路径（story.s01.X → s01Survival.X）
    const m = factId.match(/^story\.s01\.(.+)$/);
    if (m) this.storyFlags.set('s01Survival.' + m[1], true);

    if (tipText) this.showFloatingHint(tipText);

    // 门控放置物重评估（spawnWhen 条件随事实满足）
    this.spawnGatedPlacements();

    // 内部派生事件（state.transaction 触发器依赖）
    this.triggerRunner?.fire('state.transaction', { definitionId: factId });

    // 目标步推进：当前 objective 步的事实（gather.item 走采集完成事实别名）
    const step = this.quest?.steps?.[this.quest.index];
    if (step?.type === 'objective') {
      const targetFact = this._objectiveTargetFact(step);
      if (targetFact && (targetFact === factId || step.target === factId)) {
        this.activateStep(this.quest.index + 1);
        return;
      }
    }
    // 教程桥（live 侧）：当前教程步的桥接事实刚成立 → 教学完成推进
    if (step?.type === 'tutorial' && Scene3DHostScene.TUTORIAL_FACT_BRIDGE[step.tutorialId] === factId) {
      this.onTutorialCommand({ operation: 'complete', tutorialId: step.tutorialId });
    }
  }

  /**
   * 门控放置物重评估：spawnWhen 路径条件满足的放置物按需生成
   * （2D PlacementRuntime spawnWhen 的 3D 承载）
   */
  spawnGatedPlacements() {
    if (!this.s01World) return;
    for (const obj of this.projectData.placementObjects()) {
      if (!obj.spawnWhen) continue;
      const when = obj.spawnWhen;
      if (when.blackboardKey && when.blackboardKey !== 'storyState') continue;
      const actual = !!this.storyFlags.get(when.path);
      if (actual !== !!when.equals) continue;
      const record = this.s01World.spawnPlacement(obj);
      if (record?.kind === 'enemy') this.spawnWolfEntity(record);
    }
  }

  commitStoryWhenReady(params) {
    let ready = true;
    if (params.inventoryItemId) {
      // 库存条件优先（2D gather 链口径；completedPath 为自指目标路径）
      ready = this.countInventoryItem(params.inventoryItemId) >= (params.minimumQuantity || 1);
    } else if (params.storyPath && params.gte !== undefined) {
      ready = (this.counters.get(params.storyPath) || 0) >= params.gte;
    } else if (params.completedPath !== undefined) {
      // completedPath 是要写的事实路径（自指目标），不是前置条件——
      // 触发事件本身（如 itemPickup/enemy.killed）即条件；当成前置读会永远 false，
      // 斧头/剥皮刀/首狼击杀事实将永远无法提交（实测）
      ready = true;
    }
    if (!ready) return;

    const tip = params.successTip
      ? params.successTip.replace(/\{s01Survival\.(\w+)\}/g, (_, k) => this.counters.get('s01Survival.' + k) || 0)
      : (params.successTitle || null);
    this.commitFact(params.definitionId, tip);
  }

  countInventoryItem(itemId) {
    const inventory = this.playerEntity?.getComponent('inventory');
    if (!inventory?.getAllItems) return 0;
    let n = 0;
    for (const { slot } of inventory.getAllItems()) {
      if (slot?.item?.id === itemId) n += slot.quantity || 1;
    }
    return n;
  }

  // ============ 任务步骤机 ============

  /**
   * 教程步 ← 事实 桥接（2D TutorialSystem signalRules 的简化承载）：
   * 对应事实成立即视为该教学完成（2D 数据中这些教程没有 complete 触发器，
   * 靠教程系统 signalRules 完成，宿主无该系统故按事实桥接）
   */
  static TUTORIAL_FACT_BRIDGE = {
    'tutorial-001': 'story.s01.berryEaten',      // 吃野果教学
    's01.pickup': 'story.s01.axeFound',          // 拾起斧头教学
    's01.chopWood': 'story.s01.woodGathered',    // 砍柴教学
    's01.attack': 'story.s01.firstWolfSpotted'   // 迎上去教学（狼已现身扑来）
  };

  /**
   * gather.item 目标步的目标是物品 id（2D 按事件计数推进），宿主按「采集完成事实」推进——
   * 事实名由触发器链提交（trg_s01_*_gathered），此处建立 物品 → 完成事实 的别名
   */
  static GATHER_ITEM_FACT = {
    'resource.wild_berry': 'story.s01.berriesGathered',
    'resource.wood': 'story.s01.woodGathered'
  };

  /** 目标步当前 target 对应的事实（gather.item 用别名，commit.fact 直接用 target） */
  _objectiveTargetFact(step) {
    if (!step || step.type !== 'objective') return null;
    if (step.objectiveType === 'gather.item') {
      return Scene3DHostScene.GATHER_ITEM_FACT[step.target] || null;
    }
    return step.target || null;
  }

  activateStep(index) {
    if (!this.quest) return;
    this.quest.index = index;
    const step = this.quest.steps[index];
    if (!step) {
      this.quest.completed = true;
      Logger.log('Scene3DHostScene: 主任务「荒原求生」完成！');
      return;
    }
    Logger.log(`Scene3DHostScene: 任务步骤[${index}] ${step.title} (${step.type})`);

    switch (step.type) {
      case 'dialogue':
        this.playDialogue(step.dialogueId, () => this.activateStep(index + 1));
        break;
      case 'tutorial': {
        if (step.tutorialId) {
          // 完成态追认：教程标记或桥接事实已成立 → 立即推进（防永久卡步）
          const bridgeFact = Scene3DHostScene.TUTORIAL_FACT_BRIDGE[step.tutorialId];
          if (this.tutorialFlags.get(step.tutorialId) || (bridgeFact && this.storyFlags.get(bridgeFact))) {
            this.activateStep(index + 1);
            return;
          }
          this.showTutorialTip(step.tutorialId);
        } else {
          this.activateStep(index + 1);
        }
        break;
      }
      case 'action':
        this.executeCommand({ action: step.action, params: step.params || {} }, null, null)
          .then(() => this.activateStep(index + 1));
        break;
      case 'objective':
        // 追认已成立事实（2D reconcileTaskFacts 同语义）：触发器链是异步微任务，
        // 事实可能在本步激活前就已提交（如 采些野果教程完成 → 采集荒野酸果 的顺序），
        // 若不追认，目标步会永远停在 active
        {
          const targetFact = this._objectiveTargetFact(step);
          if (targetFact && this.storyFlags.get(targetFact)) {
            this.activateStep(index + 1);
            return;
          }
        }
        // 等待事实提交（commitFact 推进）
        break;
      default:
        this.activateStep(index + 1);
        break;
    }
  }

  onTutorialCompleted(tutorialId) {
    // 隐藏同 id 提示
    if (this.currentTip?.id === tutorialId) this.currentTip = null;
    // 当前任务步是该教程 → 推进
    const step = this.quest?.steps?.[this.quest.index];
    if (step?.type === 'tutorial' && step.tutorialId === tutorialId) {
      this.activateStep(this.quest.index + 1);
    }
  }

  showTutorialTip(tutorialId) {
    const t = this.projectData?.tutorial(tutorialId);
    if (!t) return;
    const text = (t.steps?.[0]?.text || t.beginText || '')
      .replace('{harvest}', 'E').replace('{interact}', 'E')
      .replace('{eat}', 'B').replace('{potionHp}', 'B')
      .replace('{attack}', '空格').replace('{jump}', '空格')
      .replace('{move}', 'WASD').replace('{pickup}', 'E');
    this.currentTip = { id: tutorialId, title: t.title || '提示', text };
  }

  /** 顶部教程提示（HUD，2D tips 面板口径） */
  renderTutorialTip(ctx) {
    if (this.quest?.completed && !this._questBannerShown) {
      this._questBannerShown = true;
      this.currentTip = { id: 'quest_complete', title: 'S01 寒风荒野求生', text: '主任务「荒原求生」完成——你翻越山崖，逃往废弃营地。' };
    }
    if (!this.currentTip) return;
    const { title, text } = this.currentTip;
    const w = Math.min(this.logicalWidth - 40, 620);
    const x = (this.logicalWidth - w) / 2;
    const y = 14;
    ctx.save();
    ctx.font = '600 15px "SF Pro Text", "PingFang SC", system-ui, sans-serif';
    const titleW = ctx.measureText(title).width;
    ctx.font = '400 14px "SF Pro Text", "PingFang SC", system-ui, sans-serif';
    const textW = ctx.measureText(text).width;
    const boxH = 66;
    ctx.fillStyle = 'rgba(10, 10, 12, 0.86)';
    ctx.strokeStyle = 'rgba(76, 175, 80, 0.55)';
    ctx.lineWidth = 2;
    if (ctx.roundRect) {
      ctx.beginPath(); ctx.roundRect(x, y, w, boxH, 12); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillRect(x, y, w, boxH); ctx.strokeRect(x, y, w, boxH);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8BC34A';
    ctx.font = '600 15px "SF Pro Text", "PingFang SC", system-ui, sans-serif';
    ctx.fillText(title, this.logicalWidth / 2, y + 24);
    ctx.fillStyle = '#ffffff';
    ctx.font = '400 14px "SF Pro Text", "PingFang SC", system-ui, sans-serif';
    ctx.fillText(text, this.logicalWidth / 2, y + 48, w - 24);
    ctx.restore();
  }

  // ============ 对话 ============

  playDialogue(dialogueId, onEnd = null) {
    if (!dialogueId || !this.dialogueSystem) return;
    let dlg = this.projectData?.dialogue(dialogueId);
    if (dlg && !this.dialogueSystem.completedDialogues?.has?.(dialogueId)) {
      // 首次：注册原始数据（重复注册幂等）
      this.dialogueSystem.registerDialogue(dialogueId, {
        title: dlg.title || '',
        startNode: dlg.startNode || 'start',
        presentation: dlg.presentation || null,
        nodes: dlg.nodes || {}
      });
    }
    if (onEnd) {
      this.dialogueSystem.onEnd((dialogue) => {
        if (dialogue?.id === dialogueId) onEnd();
      });
    }
    this.dialogueSystem.startDialogue(dialogueId);
  }

  // ============ 每帧更新 ============

  update(deltaTime) {
    this.trackMovement();
    this.checkInteractKey();
    this.checkRegionEnters();
    this.checkWolfDeaths();
    this.updateShelterFade(deltaTime);
    super.update(deltaTime);
  }

  /**
   * 区域进入事件（2D binding event='enter'：进入 region 矩形触发一次）
   * 狼群领地（trg_s01_wolf_region_enter）→ 狼群战开启；河岸 → 跳跃教学
   */
  checkRegionEnters() {
    if (!this.projectData || !this.playerEntity || !this.triggerRunner) return;
    const transform = this.playerEntity.getComponent('transform');
    if (!transform) return;

    for (const binding of this.projectData.layerObjects('S01-logic')) {
      if (binding.type !== 'trigger' || binding.event !== 'enter') continue;
      if (this._firedRegions?.has(binding.id)) continue;
      const region = this.projectData.sceneObject(binding.target);
      if (!region || region.type !== 'region') continue;

      const dx = transform.position.x - region.x;
      const dy = transform.position.y - region.y;
      const inside = Math.abs(dx) <= (region.width || 0) / 2 &&
                     Math.abs(dy) <= (region.height || 0) / 2;
      if (inside) {
        (this._firedRegions ||= new Set()).add(binding.id);
        this.triggerRunner.fireTrigger(binding.triggerId);
      }
    }
  }

  trackMovement() {
    if (this.tutorialFlags.get('s01.move')) return;
    const im = this.inputManager;
    if (!im) return;
    const moving = ['w', 'a', 's', 'd', 'up', 'down', 'left', 'right']
      .some(k => im.isKeyDown(k) || im.isKeyPressed(k));
    if (moving) {
      // 2D movementRule anyMovement threshold 0：任意移动即完成
      this.tutorialFlags.set('s01.move', true);
      this.onTutorialCompleted('s01.move');
    }
  }

  // ============ 交互（绑定 / 采集节点 / 拾取物） ============

  checkInteractKey() {
    if (!this.projectData || !this.playerEntity) return;
    const pressed = this.inputManager.isKeyPressed('e') || this.inputManager.isKeyPressed('E');
    if (!pressed) return;
    const best = this.findNearestInteractable();
    if (!best) return;

    if (best.kind === 'binding') {
      this.triggerRunner?.fireTrigger(best.binding.triggerId);
    } else if (best.kind === 'node') {
      this.gatherNode(best.record);
    } else if (best.kind === 'pickup') {
      this.pickupPlacement(best.record);
    }
  }

  findNearestInteractable() {
    const transform = this.playerEntity.getComponent('transform');
    if (!transform) return null;

    let best = null;
    const consider = (kind, x, y, radius, payload) => {
      const dx = x - transform.position.x;
      const dy = y - transform.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= radius && (!best || dist < best.dist)) {
        best = { kind, dist, ...payload };
      }
    };

    // 交互绑定（S01-logic，activeWhen 判定）
    for (const binding of this.projectData.interactBindings) {
      if (!this.isBindingActive(binding)) continue;
      const pos = this.projectData.bindingTargetPosition(binding);
      if (!pos) continue;
      consider('binding', pos.x, pos.y, binding.radius || 72, { binding });
    }

    // 运行时放置物（采集节点 / 可拾取物件）
    for (const record of this.s01World?.spawnedPlacements || []) {
      if (record.consumed) continue;
      if (record.node) {
        consider('node', record.x, record.y, record.node.interactionRadius, { record });
      } else if (record.pickup) {
        consider('pickup', record.x, record.y, 72, { record });
      }
    }
    return best;
  }

  hasTool(toolType) {
    if (!toolType) return true;
    const equipment = this.playerEntity?.getComponent('equipment');
    for (const slot of Object.values(equipment?.slots || {})) {
      if (!slot) continue;
      const caps = slot.capabilities || [];
      if (caps.some(c => c?.id === 'tool' && c?.parameters?.toolType === toolType)) return true;
      if (slot.toolType === toolType) return true;
    }
    // 库定义口径「持有即可用」（tool.worn_axe 描述原文）：背包里的工具也算持有，
    // 否则斧头拾取进背包后砍柴仍提示需要斧头（实测）
    const inventory = this.playerEntity?.getComponent('inventory');
    for (const { slot } of inventory?.getAllItems?.() || []) {
      const caps = slot?.item?.capabilities || [];
      if (caps.some(c => c?.id === 'tool' && c?.parameters?.toolType === toolType)) return true;
    }
    return false;
  }

  gatherNode(record) {
    const node = record.node;
    if (node.requiredToolType && !this.hasTool(node.requiredToolType)) {
      this.showFloatingHint(`需要${node.requiredToolType === 'axe' ? '斧头' : node.requiredToolType}才能采集`);
      return;
    }
    const range = node.gatherYieldRange || { min: 1, max: 1 };
    const yieldCount = range.min + Math.floor(Math.random() * (range.max - range.min + 1));

    const inventory = this.playerEntity?.getComponent('inventory');
    if (inventory) {
      const def = this.projectData.definition(node.itemId);
      inventory.addItem({
        id: node.itemId,
        name: def?.name || node.itemId,
        type: def?.type || 'material',
        description: def?.description || '',
        // usable 必须透传（库定义无 usable 字段时按 consumable 能力/heal 效果派生），
        // 否则背包面板无法使用（吃下酸果步永远无法完成，实测）
        usable: !!def?.usable || !!def?.effect ||
          (def?.capabilities || []).some(c => c?.id === 'consumable'),
        effect: def?.effect || null,
        capabilities: def?.capabilities,
        maxStack: def?.maxStack || 99
      }, yieldCount);
    }

    this.showFloatingHint(`${node.promptName} ×${yieldCount}`);

    // 采集计数（2D storyPath 口径：berryGatherCount / woodGatherCount）
    const counterKey = node.resourceType === 'food' ? 's01Survival.berryGatherCount'
      : node.resourceType === 'wood' ? 's01Survival.woodGatherCount' : null;
    if (counterKey) {
      this.counters.set(counterKey, (this.counters.get(counterKey) || 0) + 1);
    }

    this.triggerRunner?.fire('gathering.completed', {
      itemId: node.itemId,
      resourceType: node.resourceType
    });
  }

  pickupPlacement(record) {
    const def = record.pickup.itemDef;
    const inventory = this.playerEntity?.getComponent('inventory');
    if (inventory && def) {
      inventory.addItem({
        id: def.id,
        name: def.name,
        type: def.type,
        subType: def.subType,
        description: def.description || '',
        rarity: def.rarity || 0,
        maxStack: def.maxStack || 1,
        stats: def.stats ? { ...def.stats } : {},
        capabilities: def.capabilities,
        usable: !!def.usable || !!def.effect ||
          (def.capabilities || []).some(c => c?.id === 'consumable'),
        effect: def.effect || null
      }, 1);
    }
    record.consumed = true;
    if (record.mesh) {
      record.mesh.visible = false;
    }
    this.showFloatingHint(`获得了 ${def?.name || record.ref}`);
    this.triggerRunner?.fire('itemPickup', { placementId: record.placementId, complete: true });
  }

  // ============ 添柴 / 吃果事实 ============

  refuelCampfire() {
    const hasWood = this.countInventoryItem('resource.wood') >= 1;
    if (!hasWood) {
      this.showFloatingHint('没有柴火，先去砍些枯木');
      return;
    }
    const inventory = this.playerEntity?.getComponent('inventory');
    inventory?.removeItem('resource.wood', 1);
    const count = (this.counters.get('s01Survival.campfireRefuelCount') || 0) + 1;
    this.counters.set('s01Survival.campfireRefuelCount', count);
    this.s01World?.setCampfireLit(true);
    this.showFloatingHint('添了柴，火烧得更旺了');
    this.commitFact('story.s01.refuelCampfire');
  }

  /**
   * 物品使用（B 背包/点击使用）→ 吃野果事实（2D story.s01.berryEaten）
   */
  onItemUsed(item, healAmount, manaAmount) {
    super.onItemUsed(item, healAmount, manaAmount);
    if (item?.id === 'resource.wild_berry') {
      this.commitFact('story.s01.berryEaten');
    }
  }

  // ============ 交互可用性 / 提示 ============

  isBindingActive(binding) {
    const activeWhen = binding.activeWhen;
    if (!activeWhen || !Array.isArray(activeWhen.all)) return true;
    return activeWhen.all.every(cond => {
      if (cond.path) return !!this.storyFlags.get(cond.path) === !!cond.equals;
      if (cond.tutorialId !== undefined) {
        return !!this.tutorialFlags.get(cond.tutorialId) === !!cond.completed;
      }
      return true;
    });
  }

  showFloatingHint(text) {
    const transform = this.playerEntity?.getComponent('transform');
    if (transform && this.floatingTextManager) {
      this.floatingTextManager.addText(
        transform.position.x,
        transform.position.y - 55,
        text,
        '#ffffff'
      );
    }
  }

  // ============ 庇护所 / 过夜（3D 单场景简化：黑屏过渡替代室内切换） ============

  /**
   * 进入庇护所：黑屏 → 庇护所内对话 → 自动过夜（3D 单场景简化）
   */
  enterShelter() {
    if (this._shelterFade) return;
    this._shelterFade = { t: 0, phase: 'in', text: null, then: () => {
      this.playDialogue('dialogue.s01.shelterIn');
      // 2D 在室内 S01-C01 睡觉；3D 单场景简化为入内即安睡
      setTimeout(() => { if (this.isActive) this.doOvernight(); }, 3000);
    } };
  }

  /**
   * 过夜：黑屏过场 → 天明 → overnight 事实（触发 trg_s01_dawn 黎明对话链）
   */
  doOvernight() {
    if (this._shelterFade) return;
    this._shelterFade = { t: 0, phase: 'in', text: '你在庇护所中沉沉睡去……', then: () => {
      this.commitFact('story.s01.overnight');
      // 天明后出门即 leaveShelter（2D 庇护所门口交互的简化）
      setTimeout(() => {
        if (this.isActive) this.commitFact('story.s01.leaveShelter');
      }, 4000);
    } };
  }

  updateShelterFade(deltaTime) {
    const fade = this._shelterFade;
    if (!fade) return;
    fade.t += deltaTime;
    const DUR = 1.2;
    if (fade.phase === 'in' && fade.t >= DUR) {
      fade.phase = 'hold';
      fade.t = 0;
      // 遮黑中：执行过场动作
      if (fade.then) { const fn = fade.then; fade.then = null; fn(); }
      const spawn = this.projectData?.spawnPoint('S01-shelter-rest');
      if (spawn) {
        const transform = this.playerEntity?.getComponent('transform');
        if (transform) { transform.position.x = spawn.x; transform.position.y = spawn.y; }
      }
    } else if (fade.phase === 'hold' && fade.t >= 1.6) {
      fade.phase = 'out';
      fade.t = 0;
    } else if (fade.phase === 'out' && fade.t >= DUR) {
      this._shelterFade = null;
    }
  }

  renderShelterFade(ctx) {
    const fade = this._shelterFade;
    if (!fade) return;
    let alpha = 0;
    if (fade.phase === 'in') alpha = Math.min(1, fade.t / 1.2);
    else if (fade.phase === 'hold') alpha = 1;
    else alpha = Math.max(0, 1 - fade.t / 1.2);

    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
    if (fade.text && alpha > 0.6) {
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.font = '500 18px "SF Pro Text", "PingFang SC", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(fade.text, this.logicalWidth / 2, this.logicalHeight / 2);
    }
    ctx.restore();
  }

  // ============ HUD ============

  getQuestState() {
    if (!this.quest?.steps?.length) {
      return {
        id: QUEST_ID, title: '荒原求生', completed: false, stepIndex: 0,
        steps: [{ title: '连接工程数据…', state: 'active' }]
      };
    }
    const idx = this.quest.index;
    const steps = [];
    this.quest.steps.forEach((s, i) => {
      if (s.type !== 'objective') return;
      const state = this.quest.completed || i < idx ? 'done'
        : i === idx ? 'active' : 'locked';
      steps.push({ title: s.title, state });
    });
    return {
      id: QUEST_ID,
      title: '荒原求生',
      completed: this.quest.completed,
      stepIndex: idx,
      steps
    };
  }

  render(ctxOrBackend) {
    super.render(ctxOrBackend);

    if (ctxOrBackend && ctxOrBackend.mode === '3d') {
      const hudCtx = ctxOrBackend.getHUDContext();
      if (hudCtx) {
        this.renderTutorialTip(hudCtx);
        this.renderInteractionHint(hudCtx);
        this.renderShelterFade(hudCtx);
      }
    }
  }

  renderInteractionHint(ctx) {
    if (!this.projectData || !this.playerEntity) return;
    if (this.dialogueSystem?.isDialogueActive?.()) return;

    const best = this.findNearestInteractable();
    if (!best) return;

    let text = null;
    if (best.kind === 'binding') {
      text = (best.binding.prompt || '').replace('{interact}', 'E').replace(/\{(\w+)\}/g, '$1');
    } else if (best.kind === 'node') {
      const needTool = best.record.node.requiredToolType && !this.hasTool(best.record.node.requiredToolType);
      text = needTool
        ? `需要${best.record.node.requiredToolType === 'axe' ? '斧头' : best.record.node.requiredToolType}`
        : `E 采集${best.record.node.promptName}`;
    } else if (best.kind === 'pickup') {
      text = `E 拾取${best.record.name}`;
    }
    if (!text) return;

    ctx.save();
    const fontSize = 16;
    ctx.font = `600 ${fontSize}px "SF Pro Text", "PingFang SC", system-ui, sans-serif`;
    const textWidth = ctx.measureText(text).width;
    const boxW = textWidth + 36;
    const boxH = 40;
    const boxX = (this.logicalWidth - boxW) / 2;
    const boxY = this.logicalHeight - 150;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
    ctx.strokeStyle = 'rgba(255, 193, 7, 0.7)';
    ctx.lineWidth = 2;
    if (ctx.roundRect) {
      ctx.beginPath(); ctx.roundRect(boxX, boxY, boxW, boxH, 10); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillRect(boxX, boxY, boxW, boxH); ctx.strokeRect(boxX, boxY, boxW, boxH);
    }
    ctx.fillStyle = '#ffc107';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, this.logicalWidth / 2, boxY + boxH / 2 + 1);
    ctx.restore();
  }
}

export default Scene3DHostScene;
