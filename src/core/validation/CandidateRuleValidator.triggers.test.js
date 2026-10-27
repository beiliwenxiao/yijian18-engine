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

import { describe, expect, it } from 'vitest';
import { CandidateRuleValidator } from './CandidateRuleValidator.js';
import { createContentValidator } from './ContentSchemas.js';

/**
 * triggers do[] 的 branch 分支容器校验回归。
 *
 * 背景：M1（f51b3d0）引入触发器 branch 容器（branch 数组 + when 选择执行），
 * 执行端 TriggerSystem._selectBranch 完整支持，但 CandidateRuleValidator 旧版
 * 把容器当普通条目要求 action，每个容器误报一个 missingField（S02 M3.5 实测 12 条）。
 * 修复：容器跳过 action 必填、递归校验分支内条目，语义对齐 TriggerSystem._validateStepList
 * （stepId 去重池跨层级共享、stepId/await 守卫对容器照常生效）。
 *
 * do[] 的 action/stepId/await 校验位于 validateBusinessRules 阶段
 * （CanonicalCandidatePipeline 三阶段之一，GameLoader 装配全跑），
 * 用最小 candidate 直接调用，无需完整工程。
 */

function validateTriggers(triggers) {
  const validator = new CandidateRuleValidator({ contentValidator: createContentValidator() });
  const errors = validator.validateBusinessRules({ triggers }) || [];
  return errors.filter(e => /^triggers\[\d+\]/.test(String(e.path || e.field || '')));
}

const branchTrigger = (doEntries, extra = {}) => ({
  id: 'trg_test_branch_container',
  when: { type: 'command', params: { command: 'test-branch' } },
  do: doEntries,
  ...extra
});

describe('CandidateRuleValidator triggers branch 容器', () => {
  it('branch 容器不要求自身 action（修复回归：不再误报 missingField）', () => {
    const errors = validateTriggers([branchTrigger([
      {
        branch: [
          { do: [{ action: 'showTip', params: { text: '分支A' }, stepId: 'tip-a' }], when: { op: 'true' } },
          { do: [{ action: 'showTip', params: { text: '分支B' }, stepId: 'tip-b' }], otherwise: true }
        ]
      }
    ])]);
    const missingAction = errors.filter(e => String(e.message || '').includes('action 必须是非空字符串'));
    expect(missingAction).toEqual([]);
  });

  it('递归校验分支内条目：action 缺失在 branch[0].do[n] 路径上报错', () => {
    const errors = validateTriggers([branchTrigger([
      {
        branch: [
          { do: [{ params: { text: '坏条目' }, stepId: 'bad' }], when: { op: 'true' } }
        ]
      }
    ])]);
    const hit = errors.find(e => String(e.path || e.field || '').includes('do[0].branch[0].do[0].action')
      && String(e.message || '').includes('action 必须是非空字符串'));
    expect(hit).toBeDefined();
  });

  it('分支缺 do 数组时报 branch[0].do 必须为数组', () => {
    const errors = validateTriggers([branchTrigger([
      { branch: [{ when: { op: 'true' } }] }
    ])]);
    const hit = errors.find(e => String(e.path || e.field || '').includes('do[0].branch[0].do')
      && String(e.message || '').includes('必须为数组'));
    expect(hit).toBeDefined();
  });

  it('深层嵌套 branch 递归路径正确', () => {
    const errors = validateTriggers([branchTrigger([
      {
        branch: [
          {
            do: [
              { branch: [{ do: [{ params: {}, stepId: 'deep-bad' }], when: { op: 'true' } }] }
            ],
            when: { op: 'true' }
          }
        ]
      }
    ])]);
    const hit = errors.find(e => String(e.path || e.field || '').includes('do[0].branch[0].do[0].branch[0].do[0].action'));
    expect(hit).toBeDefined();
  });

  it('flowGroupId 场景：branch 容器自身缺 stepId 也报错（对齐 TriggerSystem 稳定身份要求）', () => {
    const container = branchTrigger([
      {
        branch: [{ do: [{ action: 'showTip', params: { text: 'x' }, stepId: 'inner' }], when: { op: 'true' } }]
      }
    ], { flowGroupId: 'flow-test-branch' });
    const errors = validateTriggers([container]);
    // 容器自身缺 stepId → do[0].stepId 报缺失；分支内条目有 stepId 不报
    const containerMissing = errors.find(e => String(e.path || e.field || '').endsWith('do[0].stepId')
      && String(e.message || '').includes('必须声明稳定 stepId'));
    expect(containerMissing).toBeDefined();
    const innerMissing = errors.filter(e => String(e.path || e.field || '').includes('branch[0].do[0].stepId'));
    expect(innerMissing).toEqual([]);
  });

  it('stepId 去重池跨层级共享：分支内与顶层重复时报重复', () => {
    const errors = validateTriggers([branchTrigger([
      { action: 'showTip', params: { text: '顶层' }, stepId: 'dup-id' },
      {
        branch: [
          { do: [{ action: 'showTip', params: { text: '分支' }, stepId: 'dup-id' }], when: { op: 'true' } }
        ]
      }
    ])]);
    const dup = errors.find(e => String(e.path || e.field || '').includes('do[1].branch[0].do[0].stepId')
      && String(e.message || '').includes('重复的 stepId'));
    expect(dup).toBeDefined();
  });

  it('FlowGroup 场景：分支内 await 报 legacyAwaitNotAllowed（对齐 TriggerSystem 废弃语义）', () => {
    const container = branchTrigger([
      {
        branch: [
          { do: [{ action: 'showTip', params: { text: 'x' }, stepId: 'with-await', await: true }], when: { op: 'true' } }
        ]
      }
    ], { flowGroupId: 'flow-test-await' });
    const errors = validateTriggers([container]);
    const hit = errors.find(e => String(e.path || e.field || '').includes('do[0].branch[0].do[0].await')
      && String(e.message || '').includes('await 已废弃'));
    expect(hit).toBeDefined();
  });

  it('非 FlowGroup 触发器的 boolean await 不报错（与原版行为一致）', () => {
    const errors = validateTriggers([branchTrigger([
      {
        branch: [
          { do: [{ action: 'showTip', params: { text: 'x' }, stepId: 'with-await', await: true }], when: { op: 'true' } }
        ]
      }
    ])]);
    const awaitErrors = errors.filter(e => String(e.path || e.field || '').includes('.await'));
    expect(awaitErrors).toEqual([]);
  });
});
