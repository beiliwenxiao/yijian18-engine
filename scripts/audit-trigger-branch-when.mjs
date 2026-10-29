/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * @project YiJian18-Engine
 ************************************************************/

/**
 * Temp/scan-branch-when.mjs —— 扫描 triggers.json：branch 容器步骤的 when 错位模式。
 * 错位 = step.branch 存在 && step.when 存在 && 所有 branch 项都无 when
 *（branch 项级 when 才被 _selectBranch 求值；容器级 when 对 branch 步骤不生效）。
 */
import fs from 'node:fs';

const triggers = JSON.parse(fs.readFileSync('example/sanguo_zhangjiao/project/triggers.json', 'utf8'));
const issues = [];
const scanSteps = (trigger, steps, path) => {
    for (const [i, step] of (steps || []).entries()) {
        if (!step) continue;
        if (Array.isArray(step.branch)) {
            const branchesHaveWhen = step.branch.some(b => b?.when != null);
            const hasOtherwise = step.branch.some(b => b?.otherwise === true);
            if (step.when != null && !branchesHaveWhen && !hasOtherwise) {
                issues.push(`${trigger.id} step[${i}](${step.stepId || '?'}): 容器级 when 被 branch 步骤忽略（应挪到 branch 项级）`);
            }
            if (step.when == null && !branchesHaveWhen && !hasOtherwise) {
                issues.push(`${trigger.id} step[${i}](${step.stepId || '?'}): branch 无任何 when——无条件命中第一个分支（确认是否有意）`);
            }
            for (const [bi, branch] of step.branch.entries()) {
                scanSteps(trigger, branch?.do, `${path}.branch[${bi}]`);
            }
        }
    }
};
for (const trigger of triggers) scanSteps(trigger, trigger.do || [], trigger.id);
console.log(issues.length ? issues.join('\n') : 'NO BRANCH-WHEN MISPLACEMENT');
