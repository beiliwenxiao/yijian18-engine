/**
 * ProgressiveTipsConfig - 渐进式提示配置文件
 *
 * S01「寒风荒野求生」任务链提示（文案移植自 2D 项目 tutorials.json 的 s01.* 教程
 * 与 quests.json task.s01.survival「荒原求生」步骤标题）：
 *
 * 提示流程：
 * 醒来 -> 站起身来 -> 点燃火堆 -> 采些野果 -> 吃下酸果
 * -> 拾起斧头 -> 装备斧头 -> 砍些干柴 -> 给火堆添柴 -> 杀死饿狼 -> 穿过枯树林(狼王)
 */

export const ProgressiveTipsConfig = {
  // 1. 醒来（2D dialogue.s01.wake / s01.move）
  progressive_tip_1: {
    id: 'progressive_tip_1',
    title: '寒风中醒来',
    description: '荒原求生',
    text: '寒风把你吹醒，有点冷。按任意键起身活动一下。',
    position: 'center',
    priority: 100,
    triggerConditionId: 'progressive_tip_1_trigger',
    prerequisites: [],
    nextTip: 'progressive_tip_2'
  },

  // 2. 站起身来（2D s01.move）
  progressive_tip_2: {
    id: 'progressive_tip_2',
    title: '站起身来',
    description: '荒原求生',
    text: '先起身活动僵硬的身体。按<span class="key">W</span><span class="key">A</span><span class="key">S</span><span class="key">D</span>移动',
    position: 'center',
    priority: 99,
    triggerConditionId: 'progressive_tip_2_trigger',
    prerequisites: ['progressive_tip_1'],
    nextTip: 'progressive_tip_3'
  },

  // 3. 点燃火堆（2D lightCampfire）
  progressive_tip_3: {
    id: 'progressive_tip_3',
    title: '点燃火堆',
    description: '荒原求生',
    text: '你看到一个熄灭的篝火。靠近并按<span class="key">E</span>键点燃火堆',
    position: 'center',
    priority: 98,
    triggerConditionId: 'progressive_tip_3_trigger',
    prerequisites: ['progressive_tip_2'],
    nextTip: 'progressive_tip_4'
  },

  // 4. 采些野果（2D s01.gather：寻找食物）
  progressive_tip_4: {
    id: 'progressive_tip_4',
    title: '采些野果',
    description: '寻找食物',
    text: '暖和了一些，一股饥饿感袭来。靠近野果，按<span class="key">E</span>采集荒野酸果充饥',
    position: 'center',
    priority: 97,
    triggerConditionId: 'progressive_tip_4_trigger',
    prerequisites: ['progressive_tip_3'],
    nextTip: 'progressive_tip_5'
  },

  // 5. 查看背包（2D tutorial-001：吃掉食物）
  progressive_tip_5: {
    id: 'progressive_tip_5',
    title: '查看背包',
    description: '吃掉食物',
    text: '采到了野果。按<span class="key">B</span>键打开背包',
    position: 'center',
    priority: 96,
    triggerConditionId: 'progressive_tip_5_trigger',
    prerequisites: ['progressive_tip_4'],
    nextTip: 'progressive_tip_7'
  },

  // 7. 吃下酸果（2D tutorial-001）
  progressive_tip_7: {
    id: 'progressive_tip_7',
    title: '吃下酸果',
    description: '吃掉食物',
    text: '肚子饿了。点击背包里的荒野酸果，吃下去恢复体力',
    position: 'center',
    priority: 94,
    triggerConditionId: 'progressive_tip_7_trigger',
    prerequisites: ['progressive_tip_5'],
    nextTip: 'progressive_tip_8'
  },

  // 7.1 关闭背包
  progressive_tip_7_1: {
    id: 'progressive_tip_7_1',
    title: '收拾一下',
    description: '关闭面板',
    text: '再次按<span class="key">B</span>键关闭背包',
    position: 'center',
    priority: 93,
    triggerConditionId: 'progressive_tip_7_1_trigger',
    prerequisites: ['progressive_tip_7'],
    nextTip: 'progressive_tip_8'
  },

  // 8. 脚边有把旧斧头（2D after.eatBerry.3/4）
  progressive_tip_8: {
    id: 'progressive_tip_8',
    title: '脚边有把旧斧头',
    description: '荒原求生',
    text: '脚边似乎有把旧斧头。靠近物品，按<span class="key">E</span>键拾取',
    position: 'center',
    priority: 90,
    triggerConditionId: 'progressive_tip_8_trigger',
    prerequisites: ['progressive_tip_7'],
    nextTip: 'progressive_tip_9'
  },

  // 9. 握紧斧柄（2D after.findAxe.1）
  progressive_tip_9: {
    id: 'progressive_tip_9',
    title: '握紧斧柄',
    description: '荒原求生',
    text: '按<span class="key">B</span>打开背包，点击破旧斧头装备它',
    position: 'center',
    priority: 80,
    triggerConditionId: 'progressive_tip_9_trigger',
    prerequisites: ['progressive_tip_8'],
    nextTip: 'progressive_tip_10'
  },

  // 10. 砍些干柴（2D s01.chopWood：篝火燃料）
  progressive_tip_10: {
    id: 'progressive_tip_10',
    title: '砍些干柴',
    description: '篝火燃料',
    text: '篝火快熄灭了。走近枯木旁的干柴，按<span class="key">E</span>拾取',
    position: 'center',
    priority: 70,
    triggerConditionId: 'progressive_tip_10_trigger',
    prerequisites: ['progressive_tip_9'],
    nextTip: 'progressive_tip_10_5'
  },

  // 10.5 给火堆添柴（2D spotWolf）
  progressive_tip_10_5: {
    id: 'progressive_tip_10_5',
    title: '给火堆添柴',
    description: '荒原求生',
    text: '带着干柴回到火堆旁，按<span class="key">E</span>添柴，让火烧得更旺',
    position: 'center',
    priority: 68,
    triggerConditionId: 'progressive_tip_10_5_trigger',
    prerequisites: ['progressive_tip_10'],
    nextTip: 'progressive_tip_10_6'
  },

  // 10.6 杀死饿狼（2D s01.attack：猎狼反击）
  progressive_tip_10_6: {
    id: 'progressive_tip_10_6',
    title: '饿狼来了',
    description: '猎狼反击',
    text: '随着篝火的火光越来越亮，一匹虚弱的饿狼出现了。按<span class="key">空格</span>反击，杀死饿狼',
    position: 'center',
    priority: 66,
    triggerConditionId: 'progressive_tip_10_6_trigger',
    prerequisites: ['progressive_tip_10_5'],
    nextTip: 'progressive_tip_11'
  },

  // 11. 穿过枯树林（2D defeatWolfPack / defeatWolfKing）
  progressive_tip_11: {
    id: 'progressive_tip_11',
    title: '穿过枯树林',
    description: '荒原求生',
    text: '你击退了饿狼，拾取战利品。枯树林深处传来狼嚎——按<span class="key">N</span>键深入枯树林，面对狼群与狼王',
    position: 'center',
    priority: 60,
    triggerConditionId: 'progressive_tip_11_trigger',
    prerequisites: ['progressive_tip_10_6'],
    nextTip: null
  }
};

/**
 * 获取提示的前置提示列表
 * @param {string} tipId - 提示ID
 * @returns {string[]} - 前置提示ID数组
 */
export function getPrerequisites(tipId) {
  const tip = ProgressiveTipsConfig[tipId];
  return tip ? tip.prerequisites : [];
}

/**
 * 获取提示的后续提示
 * @param {string} tipId - 提示ID
 * @returns {string|null} - 后续提示ID
 */
export function getNextTip(tipId) {
  const tip = ProgressiveTipsConfig[tipId];
  return tip ? tip.nextTip : null;
}

/**
 * 检查前置提示是否全部完成
 * @param {string} tipId - 提示ID
 * @param {Object} completedTips - 已完成的提示对象 { tipId: true }
 * @returns {boolean}
 */
export function arePrerequisitesMet(tipId, completedTips) {
  const prerequisites = getPrerequisites(tipId);
  if (prerequisites.length === 0) return true;
  return prerequisites.every(prereq => completedTips[prereq] === true);
}

/**
 * 获取第一个提示ID（没有前置条件的提示）
 * @returns {string|null}
 */
export function getFirstTipId() {
  for (const tipId in ProgressiveTipsConfig) {
    if (ProgressiveTipsConfig[tipId].prerequisites.length === 0) {
      return tipId;
    }
  }
  return null;
}

export default ProgressiveTipsConfig;
