/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { TriggerStorylinePanel } from './TriggerStorylinePanel.js';

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildEditor(project) {
  return {
    project,
    getSceneList: () => [{ id: 's1', name: '场景一' }],
    _escapeHtml: escapeHtml,
    _status: () => {},
    selectById: () => {},
    _nextStableId: (base, list) => `${base}-${list.length + 1}`
  };
}

const baseProject = () => ({
  triggers: [
    {
      id: 'trg-1',
      name: '首次采集',
      when: { type: 'gatheringRisk', params: {} },
      once: true,
      editorScope: { sceneIds: ['s1'] },
      do: [
        { action: 'tutorial.command', params: { operation: 'show', tutorialId: 'tu-a', await: true }, stepId: 's1' },
        { action: 'setVar', params: { key: 'act', value: 1 }, stepId: 's2' }
      ]
    }
  ],
  tutorials: [{ id: 'tu-a', title: '采集野果' }, { id: 'tu-b', title: '砍柴' }]
});

describe('TriggerStorylinePanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.getElementById('story-trigger-styles')?.remove();
    document.getElementById('story-btn-help-styles')?.remove();
  });

  it('按场景分组渲染 Trigger 卡片：when/if 摘要 + 教程步骤高亮 + 多教程步骤', () => {
    const panel = document.createElement('div');
    const panelInstance = new TriggerStorylinePanel(buildEditor(baseProject()));
    panelInstance.groupMode = 'scene'; // 显式切回按场景分组，保持既有断言契约
    panelInstance.render(panel);
    const html = panel.innerHTML;
    expect(html).toContain('场景一');           // 分组标签
    expect(html).toContain('trg-1');
    expect(html).toContain('首次采集');
    expect(html).toContain('gatheringRisk');   // when 摘要
    expect(html).toContain('🎓');              // 教程步骤高亮
    expect(html).toContain('tu-a');
    expect(html).toContain('s1');
  });

  it('教程步骤内联：切换目标教程 + 勾选串行等待写回 params', () => {
    const editor = buildEditor(baseProject());
    const panel = document.createElement('div');
    new TriggerStorylinePanel(editor).render(panel);
    const select = panel.querySelector('.story-step-target[data-path="0"]');
    select.value = 'tu-b';
    select.dispatchEvent(new Event('change'));
    expect(editor.project.triggers[0].do[0].params.tutorialId).toBe('tu-b');

    const awaitBox = panel.querySelector('.story-await[data-path="0"]');
    awaitBox.checked = false;
    awaitBox.dispatchEvent(new Event('change'));
    expect(editor.project.triggers[0].do[0].params.await).toBeUndefined();
  });

  it('步骤上移改写同父级 do[] 顺序', () => {
    const editor = buildEditor(baseProject());
    const panel = document.createElement('div');
    new TriggerStorylinePanel(editor).render(panel);
    // 第 1 个步骤上移后应排到第 0 位
    panel.querySelector('.story-step-up[data-path="1"]').click();
    expect(editor.project.triggers[0].do[0].stepId).toBe('s2');
    expect(editor.project.triggers[0].do[1].stepId).toBe('s1');
  });

  it('运行态徽章：轨迹面板的最近结果叠加到触发器卡片', () => {
    const editor = buildEditor(baseProject());
    editor.triggerTracePanel = {
      latestResultByTrigger: () => new Map([
        ['trg-1', { result: 'failed', time: '10:00', code: 'E_INVALID', message: '动作不可用' }]
      ])
    };
    const panel = document.createElement('div');
    new TriggerStorylinePanel(editor).render(panel);
    const badge = panel.querySelector('.story-runtime-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('❌');
    expect(badge.title).toContain('E_INVALID');
    expect(badge.title).toContain('10:00');
  });

  it('无运行轨迹时不渲染徽章；revealTrigger 高亮定位对应卡片', () => {
    const editor = buildEditor(baseProject());
    const host = document.createElement('div');
    const detail = document.createElement('div');
    detail.id = 'trg-detail';
    host.appendChild(detail);
    editor.container = host;
    const storyline = new TriggerStorylinePanel(editor);
    storyline.render(detail);
    expect(detail.querySelector('.story-runtime-badge')).toBeNull();

    expect(storyline.revealTrigger('trg-1')).toBe(true);
    const card = detail.querySelector('[data-trigger="trg-1"]');
    expect(card.classList.contains('story-highlight')).toBe(true);
    // 未命中返回 false，不影响既有高亮
    expect(storyline.revealTrigger('trg-不存在')).toBe(false);
    expect(card.classList.contains('story-highlight')).toBe(true);
  });

  it('分支容器渲染：otherwise/when 摘要 + 子步骤缩进 + 空分支占位', () => {
    const project = baseProject();
    project.triggers[0].do = [
      { action: 'setVar', params: {}, stepId: 's0' },
      {
        stepId: 's1',
        branch: [
          { when: { op: '==', var: 'hp', value: 0 },
            do: [{ action: 'tutorial.command', params: { operation: 'show', tutorialId: 'tu-a' }, stepId: 's1.0.0' }] },
          { otherwise: true,
            do: [{ action: 'tutorial.command', params: { operation: 'show', tutorialId: 'tu-b' }, stepId: 's1.1.0' }] },
          { when: null, do: [] }
        ]
      }
    ];
    const panel = document.createElement('div');
    new TriggerStorylinePanel(buildEditor(project)).render(panel);
    const html = panel.innerHTML;
    expect(html).toContain('🔀 分支容器');
    expect(html).toContain('otherwise（兜底）');
    expect(html).toContain('hp == 0');
    expect(html).toContain('（空分支）');
    expect(html).toContain('tu-a');
    expect(html).toContain('tu-b');
  });

  it('「按钮写法」帮助：打开全局弹层并列出 InputHints 动作清单，可关闭', async () => {
    // 「按钮写法」入口已移到顶部导航（EditorShared），面板内不再提供重复按钮；
    // 全局弹层能力仍保留在面板（openButtonHelp 仍可直接调用）。
    const panel = document.createElement('div');
    const storyline = new TriggerStorylinePanel(buildEditor(baseProject()));
    storyline.render(panel);
    expect(panel.querySelector('.story-btn-help')).toBeNull();
    await storyline.openButtonHelp();
    const overlay = document.querySelector('.story-btn-help-overlay');
    expect(overlay).toBeTruthy();
    const tokens = [...overlay.querySelectorAll('.story-help-tokens')].map(el => el.textContent).join(' ');
    expect(tokens).toContain('{attack}');
    expect(tokens).toContain('{key:attack}');
    overlay.querySelector('.story-btn-help-close').click();
    expect(document.querySelector('.story-btn-help-overlay')).toBeNull();
  });

  it('事件链分组：按事务依赖拓扑排序（入口 → 阶段1 → 阶段2）', () => {
    const project = {
      triggers: [
        { id: 't-entry', name: '采集野果', when: { type: 'gathering.completed', params: {} }, do: [
          { action: 's01Survival', params: { operation: 'commitStoryWhenReady', definitionId: 'story.a' }, stepId: 's' }
        ] },
        { id: 't-mid', name: '记录', when: { type: 'state.transaction', params: { definitionId: 'story.a' } }, do: [
          { action: 's01Survival', params: { operation: 'commitStoryWhenReady', definitionId: 'story.b' }, stepId: 's' }
        ] },
        { id: 't-end', name: '吃果', when: { type: 'state.transaction', params: { definitionId: 'story.b' } }, do: [
          { action: 'tutorial.command', params: { operation: 'show', tutorialId: 'x' }, stepId: 's' }
        ] }
      ],
      tutorials: []
    };
    const panel = document.createElement('div');
    new TriggerStorylinePanel(buildEditor(project)).render(panel);
    const groups = [...panel.querySelectorAll('.story-group .story-head strong')].map(el => el.textContent.trim());
    expect(groups[0]).toContain('入口事件');
    expect(groups[1]).toContain('阶段1');
    expect(groups[2]).toContain('阶段2');
    // 卡片显示事务链路：t-mid 由 story.a 触发、提交 story.b
    const mid = panel.querySelector('[data-trigger="t-mid"]');
    expect(mid.textContent).toContain('story.a');
    expect(mid.textContent).toContain('story.b');
  });
});
