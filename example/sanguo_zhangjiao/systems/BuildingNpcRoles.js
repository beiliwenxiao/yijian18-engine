/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-13
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * BuildingNpcRoles - 建筑前 NPC 的三项业务视图与执行器
 *
 * 业务口径（B6 后续）：
 * - 招募补员：按亲卫上限补到 cap，1 粮/人，从营地仓 → 随军粮一本账扣。
 * - 收编卫兵：只收既有散兵池（FoodLedgerSystem.scatteredPool），1 粮/人。
 * - 官勋成长：读 ranks 表取下一级，8 粮/级，写 storyState.playerRank。
 *
 * 本文件不做对话/UI，只返回「本次对话应显示什么」和「确认后做什么」；
 * 结算、幂等 operationId、资源校验全部由 BuildingNpcFlow 统一注入。
 */

const DEFAULTS = Object.freeze({
  recruit: Object.freeze({ foodPerHead: 1 }),
  muster: Object.freeze({ foodPerHead: 1 }),
  rank: Object.freeze({ foodPerRank: 8 })
});

const toInt = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

const formatFood = value => `${Math.max(0, toInt(value))} 粮`;

const formatRank = rank => rank
  ? `${rank.title || rank.id}（官职值 ${toInt(rank.value)}）`
  : '白身';

function foodPlanText(ctx, cost) {
  const campFood = Math.max(0, toInt(ctx.campFood));
  const armyFood = Math.max(0, toInt(ctx.armyFood));
  return `营地仓 ${formatFood(campFood)} + 随军 ${formatFood(armyFood)}，共 ${formatFood(campFood + armyFood)}；本次需 ${formatFood(cost)}。`;
}

/**
 * 招募补员（征召处）
 */
export function createRecruitRole() {
  return {
    id: 'recruit',
    dialogueId: 'dialogue.bnp.s02.recruit',
    name: '征召官',
    title: '征召处',
    sceneId: 'S02',
    mapPosition: { x: 745, y: 360 },
    mapPositions: {
      S02: { x: 745, y: 360 },
      S10: { x: 270, y: 390 }
    },

    buildView(ctx) {
      const gap = Math.max(0, toInt(ctx.cap) - toInt(ctx.count));
      const perHead = Math.max(0, Number(ctx.config?.recruit?.foodPerHead ?? DEFAULTS.recruit.foodPerHead));
      const cost = gap * perHead;
      const intro = gap > 0
        ? `征召官摊开名册：“亲卫上限 ${toInt(ctx.cap)} 人，现编 ${toInt(ctx.count)} 人，还缺 ${gap} 人。每人 ${perHead} 粮，补满需 ${formatFood(cost)}。”\n${foodPlanText(ctx, cost)}`
        : `征召官合上名册：“亲卫已满 ${toInt(ctx.cap)}/${toInt(ctx.cap)}，不必再补。若要扩编，得先升官。”`;
      return {
        gap,
        cost,
        perHead,
        canConfirm: gap > 0,
        intro,
        confirmText: `补员 ${gap} 人（耗 ${formatFood(cost)}）`,
        donePlaceholder: '征召官提笔在名册上添了几笔。'
      };
    },

    async execute(ctx) {
      const view = ctx.view || {};
      const gap = Math.max(0, toInt(view.gap));
      if (gap <= 0) return { ok: false, message: `亲卫已满 ${toInt(ctx.cap)}/${toInt(ctx.cap)}，无需补员。` };
      const cost = Math.max(0, toInt(view.cost));
      const plan = ctx.preview({ food: cost });
      if (!plan?.ok) {
        const missing = Math.max(0, toInt(plan?.missing?.food));
        return {
          ok: false,
          message: `粮草不够：营地仓与随军粮合起来还差 ${formatFood(missing)}，这 ${gap} 人补不进来。先去粮仓调粮，或打完这一仗再来。`
        };
      }
      const consumed = ctx.consume({ food: cost });
      if (!consumed?.ok) {
        return { ok: false, message: '粮草调拨没有成功，名册未改。稍后再试。' };
      }
      const nextCount = toInt(ctx.count) + gap;
      const submitted = await ctx.submit('story.bnp.recruit', {
        count: nextCount,
        cap: toInt(ctx.cap),
        food: cost
      });
      if (!submitted?.ok) return { ok: false, message: '名册登记失败，补员未生效。稍后再试。' };
      return {
        ok: true,
        message: `名册已改：亲卫 ${nextCount}/${toInt(ctx.cap)} 人，扣粮 ${formatFood(cost)}。新补的 ${gap} 人已在营前列队。`
      };
    }
  };
}

/**
 * 收编卫兵（兵营）
 */
export function createMusterRole() {
  return {
    id: 'muster',
    dialogueId: 'dialogue.bnp.s02.muster',
    name: '收编官',
    title: '兵营',
    sceneId: 'S02',
    mapPosition: { x: 940, y: 360 },
    mapPositions: {
      S02: { x: 940, y: 360 }
    },

    buildView(ctx) {
      const count = Math.max(0, toInt(ctx.count));
      const cap = Math.max(0, toInt(ctx.cap));
      const left = Math.max(0, cap - count);
      const scattered = Math.max(0, toInt(ctx.scattered));
      const absorb = Math.min(left, scattered);
      const perHead = Math.max(0, Number(ctx.config?.muster?.foodPerHead ?? DEFAULTS.muster.foodPerHead));
      const cost = absorb * perHead;
      let intro;
      if (left <= 0) {
        intro = `收编官摇头：“编制已满 ${count}/${cap}，收进来也没地方安置。”`;
      } else if (scattered <= 0) {
        intro = `收编官望向营外：“四下没有散兵。断粮逃散的人要先聚起来，才有得收。”`;
      } else {
        intro = `收编官指着营外：“营外有 ${scattered} 名散兵，编制还空 ${left} 人，可收 ${absorb} 人。每人 ${perHead} 粮安置，共 ${formatFood(cost)}。”\n${foodPlanText(ctx, cost)}`;
      }
      return {
        absorb,
        cost,
        perHead,
        canConfirm: absorb > 0,
        intro,
        confirmText: `收编 ${absorb} 人（耗 ${formatFood(cost)}）`,
        donePlaceholder: '收编官朝营外挥了挥手。'
      };
    },

    async execute(ctx) {
      const view = ctx.view || {};
      const absorb = Math.max(0, toInt(view.absorb));
      if (absorb <= 0) {
        return {
          ok: false,
          message: toInt(ctx.scattered) <= 0
            ? '营外没有可收编的散兵。'
            : `编制已满 ${toInt(ctx.count)}/${toInt(ctx.cap)}，收编不了。`
        };
      }
      const cost = Math.max(0, toInt(view.cost));
      const plan = ctx.preview({ food: cost });
      if (!plan?.ok) {
        const missing = Math.max(0, toInt(plan?.missing?.food));
        return {
          ok: false,
          message: `粮草不够：还差 ${formatFood(missing)}，这 ${absorb} 名散兵安顿不下来。`
        };
      }
      const consumed = ctx.consume({ food: cost });
      if (!consumed?.ok) return { ok: false, message: '粮草调拨没有成功，收编未生效。' };
      const nextCount = toInt(ctx.count) + absorb;
      const submitted = await ctx.submit('story.bnp.muster', {
        count: nextCount,
        cap: toInt(ctx.cap),
        absorbed: absorb,
        food: cost
      });
      if (!submitted?.ok) return { ok: false, message: '收编登记失败，散兵未入册。' };
      return {
        ok: true,
        message: `收编完毕：${absorb} 名散兵入册，亲卫 ${nextCount}/${toInt(ctx.cap)} 人，扣粮 ${formatFood(cost)}。`
      };
    }
  };
}

/**
 * 官勋成长（S10 新营军帐/营府）
 */
export function createRankRole() {
  return {
    id: 'rank',
    dialogueId: 'dialogue.bnp.s10.rank',
    name: '军府主簿',
    title: '营府',
    sceneId: 'S10',
    mapPosition: { x: 330, y: 360 },
    mapPositions: {
      S10: { x: 390, y: 390 }
    },

    buildView(ctx) {
      const current = ctx.currentRank || null;
      const next = ctx.nextRank || null;
      const perRank = Math.max(0, Number(ctx.config?.rank?.foodPerRank ?? DEFAULTS.rank.foodPerRank));
      const base = `现任 ${formatRank(current)}，亲卫上限 ${toInt(ctx.cap)} 人。`;
      if (!next) {
        return {
          canConfirm: false,
          cost: 0,
          intro: `${base}\n主簿拱手：“已是大将军，位列人臣之极，无可再升。”`,
          confirmText: '无可再升',
          donePlaceholder: '主簿把印绶收回匣中。'
        };
      }
      const nextCap = ctx.resolveCapacity(next.value);
      const intro = `${base}\n主簿展开官牒：“可擢为 ${formatRank(next)}，亲卫上限随之升至 ${nextCap} 人。置办官服印绶需 ${formatFood(perRank)}。”\n${foodPlanText(ctx, perRank)}`;
      return {
        canConfirm: true,
        cost: perRank,
        nextCap,
        intro,
        confirmText: `擢升为 ${next.title || next.id}（耗 ${formatFood(perRank)}）`,
        donePlaceholder: '主簿研墨，准备书写官牒。'
      };
    },

    async execute(ctx) {
      const view = ctx.view || {};
      const next = ctx.nextRank || null;
      if (!next) return { ok: false, message: '已是大将军，无可再升。' };
      const cost = Math.max(0, toInt(view.cost));
      const plan = ctx.preview({ food: cost });
      if (!plan?.ok) {
        const missing = Math.max(0, toInt(plan?.missing?.food));
        return {
          ok: false,
          message: `粮草不够：置办官服印绶还差 ${formatFood(missing)}，这次擢升办不下来。`
        };
      }
      const consumed = ctx.consume({ food: cost });
      if (!consumed?.ok) return { ok: false, message: '粮草调拨没有成功，官牒未发。' };
      const nextCap = ctx.resolveCapacity(next.value);
      const submitted = await ctx.submit('story.bnp.rank', {
        rank: { rankId: next.id, title: next.title || next.id, value: toInt(next.value) },
        cap: nextCap,
        food: cost
      });
      if (!submitted?.ok) return { ok: false, message: '官牒登记失败，擢升未生效。' };
      return {
        ok: true,
        message: `官牒已发：${formatRank(next)}。亲卫上限升至 ${nextCap} 人，扣粮 ${formatFood(cost)}。`
      };
    }
  };
}

export function createBuildingNpcRoles() {
  return [createRecruitRole(), createMusterRole(), createRankRole()];
}

export default createBuildingNpcRoles;
