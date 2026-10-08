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

/**
 * TriggerStorylinePanel - 剧情线总览（Trigger 链视图）。
 *
 * 全 Trigger 化后以 Trigger 为唯一流程编排概念：按场景或事件链把 Trigger
 * 排成时间链（按协调组/按事件类型分组已删除，事件类型降级为工具栏筛选），每张卡片展示「何时触发（when）→ 满足条件（if）→ 依次做什么（do[]）」，
 * 教程步骤（tutorial.command）高亮为 🎓 并支持内联编排：目标教程、操作、串行等待(await)、
 * 开场/收场提示；branch[] 分支容器缩进展示各分支条件与子步骤。
 *
 * 只读展示 + 步骤内联编排；定义细节编辑仍走「Trigger 业务规则」Tab。
 */

import { InputHints } from '../src/core/input/InputHints.js';
import { getTriggerEvents } from '../src/systems/TriggerCatalog.js';
import { RESULT_META } from './TriggerTracePanel.js';

const asList = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();

/** 触发时机 when 摘要。 */
function whenSummary(trigger) {
  const when = trigger?.when || {};
  const params = when.params && typeof when.params === 'object' && Object.keys(when.params).length
    ? `(${Object.entries(when.params).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ')})`
    : '';
  return `${text(when.type) || '?'} ${params}`.trim();
}

/** 条件摘要：CompositeCondition / 旧格式叶子 / 新表达式 if → 一行可读文本。 */
function conditionSummary(condition) {
  if (!condition || typeof condition !== 'object') return '（无条件，立即可用）';
  if (Array.isArray(condition.children) && condition.operator) {
    const op = condition.operator === 'OR' ? ' 或 ' : ' 且 ';
    const parts = condition.children.map(child => conditionSummary(
      child?.config ? { blackboardKey: child.config.blackboardKey, path: child.config.path, equals: child.config.value }
        : child
    ));
    return parts.join(op);
  }
  if (condition.op && (condition.args || condition.var != null || condition.left != null)) {
    // 新表达式格式：{"op":"==","var":"...","value":...} / {"op":"and","args":[...]}
    const key = text(condition.var) || text(condition.left?.var) || (condition.path ? String(condition.path) : '变量');
    const value = condition.value !== undefined ? JSON.stringify(condition.value)
      : condition.right !== undefined ? JSON.stringify(condition.right)
        : condition.args ? `(${asList(condition.args).map(conditionSummary).join(' 且 ')})`
          : '';
    return `${key} ${text(condition.op)} ${value}`.trim();
  }
  const key = [text(condition.blackboardKey), text(condition.path)].filter(Boolean).join('.') || '变量';
  const value = JSON.stringify(condition.value ?? condition.equals);
  const operator = text(condition.operator) || (condition.equals !== undefined ? '=' : '存在');
  return `${key} ${operator} ${value}`;
}

export class TriggerStorylinePanel {
  /** @param {TriggerEditor} editor */
  constructor(editor) {
    this.editor = editor;
    this.expanded = new Set(); // 展开的触发器 id（默认全部展开）
    this.groupMode = 'chain'; // chain | scene（按协调组/按事件类型分组已删除；事件类型走工具栏筛选）
    this.sceneFilter = ''; // 场景筛选（groupMode=scene 时生效）
    this.eventFilter = ''; // 事件类型筛选（when.type，跨分组维度生效）
  }

  /** HTML 转义（优先复用编辑器的 _escapeHtml）。 */
  _escape(value) {
    return this.editor?._escapeHtml
      ? this.editor._escapeHtml(value)
      : String(value ?? '');
  }

  render(panel) {
    const project = this.editor.project || {};
    const triggers = asList(project.triggers);
    this._chainGraphCache = null; // 每次渲染重建依赖图（数据可能已编辑）
    this._injectButtonHelpStyles();
    this.injectStyles();
    if (!triggers.length) {
      panel.innerHTML = '<div style="padding:24px;color:#8a93a8;">暂无 Trigger。先在「Trigger 业务规则」Tab 创建触发器。</div>';
      return;
    }
    // 默认全部展开
    for (const trigger of triggers) this.expanded.add(trigger.id);
    const groups = this._groupTriggers(triggers);
    panel.innerHTML = this._toolbarHtml()
      + groups.map(group => this._renderGroup(group)).join('');
    this._bindEvents(panel);
  }

  /**
   * 反查定位：滚动到指定触发器节点并高亮闪烁（轨迹面板条目点击联动）。
   * 需在 render 之后调用（总览已在页内）。返回是否找到节点。
   */
  revealTrigger(id) {
    const targetId = text(id);
    if (!targetId) return false;
    const panel = this.editor.container?.querySelector?.('#trg-detail');
    const card = panel?.querySelector(`.story-trigger[data-trigger="${targetId}"]`);
    if (!card) return false;
    panel.querySelectorAll('.story-trigger.story-highlight').forEach(el => el.classList.remove('story-highlight'));
    card.classList.add('story-highlight');
    card.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); // jsdom 等环境可能未实现
    clearTimeout(this._highlightTimer);
    this._highlightTimer = setTimeout(() => card.classList.remove('story-highlight'), 3000);
    return true;
  }

  /** 按当前分组维度把 Trigger 排成组；事件类型筛选跨维度生效。 */
  _groupTriggers(triggers) {
    let filtered = triggers;
    if (this.eventFilter) {
      filtered = filtered.filter(trigger => text(trigger?.when?.type) === this.eventFilter);
    }
    // 场景筛选：groupMode=scene 且有选中场景时，只显示该场景的 Trigger
    if (this.groupMode === 'scene' && this.sceneFilter) {
      filtered = filtered.filter(trigger => {
        const sceneIds = asList(trigger.editorScope?.sceneIds);
        return sceneIds.includes(this.sceneFilter);
      });
    }

    const groups = [];
    const groupOf = trigger => {
      if (this.groupMode === 'chain') return this._chainStage(trigger);
      const sceneIds = asList(trigger.editorScope?.sceneIds);
      return sceneIds[0] || '（无场景归属）';
    };
    const sceneName = id => {
      const map = new Map();
      try { for (const scene of this.editor.getSceneList?.() || []) map.set(scene.id, scene.name || scene.id); }
      catch (e) { /* 忽略 */ }
      return map.get(id) || id;
    };
    for (const trigger of filtered) {
      const key = groupOf(trigger);
      let group = groups.find(candidate => candidate.key === key);
      if (!group) {
        groups.push({ key, label: this.groupMode === 'scene' ? sceneName(key) : key, items: [] });
        group = groups[groups.length - 1];
      }
      group.items.push(trigger);
    }
    const definitionOrder = list => list.sort((left, right) =>
      (this.editor.project?.triggers || []).indexOf(left) - (this.editor.project?.triggers || []).indexOf(right));
    for (const group of groups) definitionOrder(group.items);
    // 事件链：按拓扑阶段排序；无场景归属放最后
    return groups.sort((left, right) => {
      if (this.groupMode === 'chain') {
        const stageOrder = stage => {
          const match = stage.match(/^阶段(\d+)$/);
          if (match) return Number(match[1]);
          if (stage === '入口事件') return -1;
          if (stage === '终局/无后续') return 999;
          return 998; // 游离 Trigger
        };
        const orderA = stageOrder(left.key);
        const orderB = stageOrder(right.key);
        if (orderA !== orderB) return orderA - orderB;
      }
      if (left.key === '（无场景归属）') return 1;
      if (right.key === '（无场景归属）') return -1;
      return 0;
    });
  }

  /**
   * 事件链阶段判定：从 trigger 的「触发事务」与「提交事务」推断它在剧情 DAG 中的深度。
   *   when.type=state.transaction 的 params.definitionId → 被上游事务触发（有前驱）
   *   do[] 中 s01Survival.commitStoryWhenReady 的 params.definitionId → 提交下游事务（有后继）
   * 拓扑排序：无前驱为「入口事件」；否则按最长依赖链求深度 → 阶段N。
   */
  _chainStage(trigger) {
    const graph = this._buildChainGraph();
    const stage = graph.stages.get(trigger.id);
    return stage ?? '游离 Trigger';
  }

  _buildChainGraph() {
    if (this._chainGraphCache) return this._chainGraphCache;
    const triggers = asList(this.editor.project?.triggers);
    const commitId = step => {
      if (step?.action !== 's01Survival' && step?.action !== 'state.transaction') return null;
      const definitionId = text(step?.params?.definitionId);
      if (step?.action === 's01Survival' && step?.params?.operation === 'commitStoryWhenReady') return definitionId;
      if (step?.action === 'state.transaction') return definitionId;
      return null;
    };
    const collectCommits = steps => {
      const ids = [];
      for (const step of asList(steps)) {
        if (Array.isArray(step?.branch)) for (const branch of step.branch) ids.push(...collectCommits(branch?.do));
        else {
          const id = commitId(step);
          if (id) ids.push(id);
        }
      }
      return ids;
    };
    // 事务 → 产出它的 trigger；事务 → 消费它的 trigger
    const producedBy = new Map(); // definitionId -> Set<triggerId>
    const consumedBy = new Map(); // definitionId -> Set<triggerId>
    for (const trigger of triggers) {
      const incoming = trigger?.when?.type === 'state.transaction'
        ? text(trigger.when?.params?.definitionId)
        : '';
      if (incoming) {
        const set = consumedBy.get(incoming) || new Set();
        set.add(trigger.id);
        consumedBy.set(incoming, set);
      }
      for (const definitionId of collectCommits(trigger?.do)) {
        const set = producedBy.get(definitionId) || new Set();
        set.add(trigger.id);
        producedBy.set(definitionId, set);
      }
    }
    // trigger 依赖边：trigger A 产出的事务被 trigger B 消费 → A → B
    const outEdges = new Map(); // triggerId -> Set<triggerId>
    const inDegree = new Map(); // triggerId -> number（独立前驱数）
    const hasPredecessor = new Set();
    const isChained = new Set();
    for (const trigger of triggers) {
      const id = trigger?.id;
      if (!id) continue;
      inDegree.set(id, 0);
      if (!outEdges.has(id)) outEdges.set(id, new Set());
      const incoming = trigger?.when?.type === 'state.transaction'
        ? text(trigger.when?.params?.definitionId)
        : '';
      if (incoming && producedBy.get(incoming)?.size) hasPredecessor.add(id);
      for (const definitionId of collectCommits(trigger?.do)) {
        const consumers = consumedBy.get(definitionId);
        if (!consumers) continue;
        isChained.add(id);
        for (const consumer of consumers) {
          if (consumer === id) continue;
          if (!outEdges.get(id).has(consumer)) {
            outEdges.get(id).add(consumer);
            inDegree.set(consumer, (inDegree.get(consumer) || 0) + 1);
            isChained.add(consumer);
          }
        }
      }
    }
    // 拓扑求深度（Kahn）；环/无链回退定义序
    const orderIndex = new Map(triggers.map((trigger, index) => [trigger?.id, index]));
    const depth = new Map();
    const queue = [...inDegree.entries()]
      .filter(([id, degree]) => degree === 0)
      .map(([id]) => id);
    for (const id of queue) depth.set(id, 0);
    let guard = 0;
    while (queue.length && guard < 10000) {
      guard++;
      const current = queue.shift();
      for (const next of outEdges.get(current) || []) {
        depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(current) ?? 0) + 1));
        inDegree.set(next, inDegree.get(next) - 1);
        if (inDegree.get(next) === 0) queue.push(next);
      }
    }
    const stages = new Map();
    for (const trigger of triggers) {
      const id = trigger?.id;
      if (!id) continue;
      if (!isChained.has(id)) {
        stages.set(id, trigger?.when?.type === 'state.transaction' ? '游离 Trigger' : '入口事件');
        continue;
      }
      const d = depth.get(id) ?? 0;
      stages.set(id, d === 0 ? '入口事件' : `阶段${d}`);
    }
    this._chainGraphCache = { stages };
    return this._chainGraphCache;
  }

  /** 顶部工具栏：分组维度切换 + 事件类型筛选 + 「按钮写法」帮助入口。 */
  _toolbarHtml() {
    const modeLabel = { chain: '⛓ 事件链（执行顺序）', scene: '按场景' };
    // 事件类型筛选：只列工程里实际在用的类型（目录标签优先，未知类型回退原始值）
    const catalogLabel = new Map(getTriggerEvents(this.editor.project).map(item => [item.v, item.label]));
    const usedTypes = [...new Set(asList(this.editor.project?.triggers)
      .map(trigger => text(trigger?.when?.type)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    const eventOptions = [{ v: '', label: '全部事件类型' },
      ...usedTypes.map(type => ({ v: type, label: catalogLabel.get(type) || type }))];
    const scenes = this.editor.getSceneList?.() || [];
    const sceneOptions = [{ id: '', name: '全部场景' }, ...scenes];
    return `
      <div class="story-toolbar">
        <strong class="story-toolbar-title">剧情线总览（Trigger 链）</strong>
        <select class="story-group-mode" title="切换分组维度">
          ${Object.entries(modeLabel).map(([value, label]) => `<option value="${value}"${this.groupMode === value ? ' selected' : ''}>${label}</option>`).join('')}
        </select>
        <select class="story-event-filter" title="按事件类型筛选">
          ${eventOptions.map(option => `<option value="${this._escape(option.v)}"${this.eventFilter === option.v ? ' selected' : ''}>${this._escape(option.label)}</option>`).join('')}
        </select>
        ${this.groupMode === 'scene' ? `
          <select class="story-scene-filter" title="筛选场景">
            ${sceneOptions.map(s => `<option value="${this._escape(s.id)}"${this.sceneFilter === s.id ? ' selected' : ''}>${this._escape(s.name)}</option>`).join('')}
          </select>` : ''}
      </div>`;
  }

  _renderGroup(group) {
    return `
      <div class="story-card story-group" data-group="${this._escape(group.key)}">
        <div class="story-head">
          <strong>🗂 ${this._escape(group.label)}</strong>
          <span class="story-count">${group.items.length} 个 Trigger</span>
        </div>
        <div class="story-members">
          ${group.items.map(trigger => this._renderTriggerCard(trigger)).join('')}
        </div>
      </div>
    `;
  }

  _renderTriggerCard(trigger) {
    const escape = value => this.editor._escapeHtml(value);
    const id = text(trigger.id);
    const name = text(trigger.name);
    const whenLabel = this._whenLabel(trigger);
    const ifSummary = conditionSummary(trigger.if);
    const steps = asList(trigger.do);
    const incoming = trigger?.when?.type === 'state.transaction'
      ? text(trigger.when?.params?.definitionId)
      : '';
    const outgoing = this._collectCommits(trigger).map(id => `→ ${id}`);
    // 运行态徽章（轨迹面板推送的最近一次结果，总览 × 轨迹联动）
    const runtime = this.editor.triggerTracePanel?.latestResultByTrigger?.().get(id) || null;
    const runtimeMeta = runtime ? RESULT_META[runtime.result] : null;
    const runtimeTitle = runtime
      ? `最近运行 ${runtime.time}${runtime.code ? ` · ${runtime.code}` : ''}${runtime.message ? ` · ${runtime.message}` : ''}`
      : '';
    return `
      <div class="story-card story-trigger" data-trigger="${escape(id)}">
        <div class="story-trigger-head">
          <span class="story-type">⚡ Trigger</span>
          <span class="story-member-id">${escape(id)}</span>
          ${name ? `<small class="story-name">${escape(name)}</small>` : ''}
          ${runtimeMeta ? `<span class="story-runtime-badge" style="color:${runtimeMeta.color};background:${runtimeMeta.bg};" title="${escape(runtimeTitle)}">${runtimeMeta.short} 运行态</span>` : ''}
          ${trigger.enabled === false ? '<span class="story-disabled">⏸ 停用</span>' : ''}
          <button class="story-jump" data-jump-target="triggers" data-jump-id="${escape(id)}">编辑 →</button>
        </div>
        ${incoming || outgoing.length ? `
          <div class="story-chain">
            ${incoming ? `<div class="story-chain-in" title="由该事务触发">⇤ ${escape(incoming)}</div>` : ''}
            ${outgoing.length ? `<div class="story-chain-out" title="提交该事务后触发下游">${escape(outgoing.join(' · '))}</div>` : ''}
          </div>` : ''}
        <div class="story-cond">
          <div class="story-cond-col">
            <div class="story-cond-title">⚡ 触发时机</div><div>${escape(whenLabel)}</div>
            <div class="story-cond-title" style="margin-top:6px;">🛡 前置条件</div><div>${escape(ifSummary)}</div>
          </div>
          <div class="story-cond-col">
            <div class="story-cond-title">📋 协调</div>
            <div>${trigger.coordination?.group
              ? `${escape(trigger.coordination.group)} · ${escape(trigger.coordination.policy || 'broadcast')} · priority ${Number.isInteger(trigger.coordination?.priority) ? trigger.coordination.priority : 0}`
              : '独立执行'}</div>
            <div class="story-cond-title" style="margin-top:6px;">🔁 重复</div>
            <div>${trigger.once ? '只触发一次 (once)' : '可重复触发'}</div>
          </div>
        </div>
        <div class="story-steps">
          <div class="story-cond-title">── 步骤链 do[]（顺序执行 · 多路径）</div>
          ${steps.length ? steps.map((step, index) => this._renderStep(step, `${index}`, trigger, 0)).join('')
            : '<div class="story-empty">（暂无动作）</div>'}
          <div class="story-step-actions">
            <button type="button" class="story-step-add" data-trigger="${escape(id)}" data-path="">+ 追加教程步骤</button>
          </div>
        </div>
      </div>
    `;
  }

  /** 收集 trigger do[]（含 branch 递归）中 s01Survival/state.transaction 提交的事务 definitionId。 */
  _collectCommits(trigger) {
    const ids = [];
    const walk = steps => {
      for (const step of asList(steps)) {
        if (Array.isArray(step?.branch)) {
          for (const branch of step.branch) walk(branch?.do);
          continue;
        }
        const action = step?.action;
        if (action !== 's01Survival' && action !== 'state.transaction') continue;
        const definitionId = text(step?.params?.definitionId);
        if (!definitionId) continue;
        if (action === 's01Survival' && step?.params?.operation !== 'commitStoryWhenReady') continue;
        ids.push(definitionId);
      }
    };
    walk(trigger?.do);
    return ids;
  }

  /** 递归渲染一个步骤（动作 / 分支容器）。path 形如 "2" 或 "1.0.3"。 */
  _renderStep(step, path, trigger, depth) {
    const escape = value => this.editor._escapeHtml(value);
    const isBranch = Array.isArray(step?.branch);
    const indent = depth > 0 ? `style="margin-left:${Math.min(depth, 6) * 16}px"` : '';
    const upDown = `
      <button type="button" class="story-step-up" data-trigger="${escape(trigger.id)}" data-path="${escape(path)}" title="上移（更早执行）">↑</button>
      <button type="button" class="story-step-down" data-trigger="${escape(trigger.id)}" data-path="${escape(path)}" title="下移（更迟执行）">↓</button>
      <span class="story-step-del" data-trigger="${escape(trigger.id)}" data-path="${escape(path)}" title="删除此步骤">✕</span>`;
    if (isBranch) {
      const branches = asList(step.branch);
      return `
        <div class="story-step story-step-branch" data-path="${escape(path)}" ${indent}>
          ${upDown}
          <span class="story-orch-op">🔀 分支容器</span>
          <span class="story-step-id">stepId: ${escape(step.stepId || '')}</span>
          ${branches.map((branch, bIndex) => `
            <div class="story-branch">
              <div class="story-branch-when">
                ${branch.otherwise ? 'otherwise（兜底）' : `when: ${escape(conditionSummary(branch.when))}`}
              </div>
              <div class="story-branch-do">
                ${asList(branch.do).length ? asList(branch.do).map((child, cIndex) =>
                  this._renderStep(child, `${path}.${bIndex}.${cIndex}`, trigger, depth + 1)).join('')
                  : '<div class="story-empty">（空分支）</div>'}
              </div>
            </div>`).join('')}
        </div>`;
    }
    const action = text(step?.action);
    const isTutorial = action === 'tutorial.command';
    const op = text(step?.params?.operation);
    const opLabel = { show: '🎓 显示教程', complete: '✓ 完成教程', hide: '✕ 隐藏教程', showStep: '🎓 显示教程步骤' }[op] || (isTutorial ? `操作 ${op || '?'}` : (action || '未知动作'));
    if (isTutorial) {
      const tutorialId = text(step?.params?.tutorialId);
      const tutorial = asList(this.editor.project?.tutorials).find(t => t.id === tutorialId);
      return `
        <div class="story-step story-step-tutorial" data-path="${escape(path)}" ${indent}>
          ${upDown}
          <span class="story-orch-op">${escape(opLabel)}</span>
          <select class="story-step-target" data-trigger="${escape(trigger.id)}" data-path="${escape(path)}">${this._tutorialOptions(tutorialId)}</select>
          <span class="story-step-id">stepId: ${escape(step.stepId || '')}</span>
          <label class="story-step-await" title="勾选后，本教程完全结束（隐藏）才执行下一个步骤；适合一个 Trigger 内连续播放多个教程">
            <input type="checkbox" class="story-await" data-trigger="${escape(trigger.id)}" data-path="${escape(path)}"${step.params?.await ? ' checked' : ''}> ⏳ 串行等待
          </label>
          ${tutorial ? `
            <div class="story-tutorial-hints">
              <label class="story-prompt"><span>开场提示 beginText</span><input class="story-begin" data-tutorial="${escape(tutorialId)}" value="${escape(text(tutorial.beginText))}" placeholder="（可选）"></label>
              <label class="story-prompt"><span>收场提示 endText</span><input class="story-end" data-tutorial="${escape(tutorialId)}" value="${escape(text(tutorial.endText))}" placeholder="（可选）"></label>
            </div>` : ''}
        </div>`;
    }
    const paramsText = this._jsonCompact(step?.params);
    return `
      <div class="story-step story-step-action" data-path="${escape(path)}" ${indent}>
        ${upDown}
        <span class="story-orch-op">${escape(opLabel)}</span>
        <span class="story-step-id">stepId: ${escape(step.stepId || '')}</span>
        <span class="story-step-params" title="${escape(paramsText)}">${escape(this._actionSummary(action, step))}</span>
      </div>`;
  }

  _actionSummary(action, step) {
    const params = step?.params || {};
    if (action === 'tutorial.command') return text(params.tutorialId) || '（未选教程）';
    if (params.operation) return `${params.operation}${params.definitionId ? ` · ${params.definitionId}` : ''}`;
    return this._jsonCompact(params) || '—';
  }

  _jsonCompact(value) {
    if (!value || typeof value !== 'object') return '';
    try { return JSON.stringify(value); } catch (e) { return ''; }
  }

  _whenLabel(trigger) {
    const events = this.editor.project ? [] : [];
    return whenSummary(trigger);
  }

  _tutorialOptions(selectedId) {
    const tutorials = asList(this.editor.project?.tutorials);
    return `<option value="">（未选教程）</option>` + tutorials.map(t =>
      `<option value="${this._escape(t.id)}"${t.id === selectedId ? ' selected' : ''}>${this._escape(t.title || t.id)}</option>`).join('');
  }

  /** 按 path 定位 do[] 中的数组与下标（支持嵌套 branch）。 */
  _resolveStep(trigger, pathStr) {
    if (!trigger || !pathStr) return null;
    const parts = String(pathStr).split('.').map(Number);
    let array = asList(trigger.do);
    let node = trigger;
    for (let i = 0; i < parts.length - 1; i += 2) {
      const step = array[parts[i]];
      if (!step || !Array.isArray(step.branch)) return null;
      const branch = step.branch[parts[i + 1]];
      if (!branch) return null;
      array = asList(branch.do);
    }
    const index = parts[parts.length - 1];
    if (!Number.isInteger(index) || index < 0 || index >= array.length) return null;
    return { array, index, node };
  }

  _bindEvents(panel) {
    // 「按钮写法」入口已移到顶部导航（EditorShared），本面板内不再提供重复按钮。
    panel.querySelector('.story-group-mode')?.addEventListener('change', event => {
      this.groupMode = event.target.value;
      if (this.groupMode !== 'scene') this.sceneFilter = '';
      this.render(panel);
    });
    panel.querySelector('.story-event-filter')?.addEventListener('change', event => {
      this.eventFilter = event.target.value;
      this.render(panel);
    });
    panel.querySelector('.story-scene-filter')?.addEventListener('change', event => {
      this.sceneFilter = event.target.value;
      this.render(panel);
    });
    for (const button of panel.querySelectorAll('.story-jump')) {
      button.addEventListener('click', () => {
        this.editor.selectById(button.dataset.jumpId, button.dataset.jumpTarget);
      });
    }
    // 上移 / 下移 / 删除：按 path 操作对应数组。
    const commit = (trigger, message) => {
      this.editor._status?.(`${message}（点击「💾 保存到工程」生效）`, 'ok');
      this.render(panel);
    };
    for (const button of panel.querySelectorAll('.story-step-up, .story-step-down')) {
      button.addEventListener('click', () => {
        const trigger = this._memberOf('trigger', button.dataset.trigger);
        if (!trigger) return;
        const located = this._resolveStep(trigger, button.dataset.path);
        if (!located) return;
        const delta = button.classList.contains('story-step-up') ? -1 : 1;
        const target = located.index + delta;
        if (target < 0 || target >= located.array.length) return;
        [located.array[located.index], located.array[target]] = [located.array[target], located.array[located.index]];
        commit(trigger, `已调整 ${trigger.name || trigger.id} 的步骤顺序`);
      });
    }
    for (const del of panel.querySelectorAll('.story-step-del')) {
      del.addEventListener('click', () => {
        const trigger = this._memberOf('trigger', del.dataset.trigger);
        if (!trigger) return;
        const located = this._resolveStep(trigger, del.dataset.path);
        if (!located) return;
        located.array.splice(located.index, 1);
        commit(trigger, `已删除 ${trigger.name || trigger.id} 的一个步骤`);
      });
    }
    // 追加教程步骤：默认追加到 do[] 末尾。
    for (const add of panel.querySelectorAll('.story-step-add')) {
      add.addEventListener('click', () => {
        const trigger = this._memberOf('trigger', add.dataset.trigger);
        if (!trigger) return;
        trigger.do = asList(trigger.do);
        trigger.do.push({
          action: 'tutorial.command',
          params: { operation: 'show', tutorialId: '', await: true },
          stepId: this.editor._nextStableId(`${trigger.id || 'trg'}-step`, trigger.do)
        });
        commit(trigger, `已为 ${trigger.name || trigger.id} 追加教程步骤（请选择目标教程）`);
      });
    }
    // 教程步骤：切换目标 / 串行等待开关。
    for (const target of panel.querySelectorAll('.story-step-target')) {
      target.addEventListener('change', () => {
        const trigger = this._memberOf('trigger', target.dataset.trigger);
        const located = trigger && this._resolveStep(trigger, target.dataset.path);
        if (!located) return;
        const step = located.array[located.index];
        step.params = step.params || {};
        const value = text(target.value);
        if (value) step.params.tutorialId = value;
        else delete step.params.tutorialId;
        commit(trigger, `已切换 ${trigger.name || trigger.id} 教程目标 -> ${value || '（空）'}`);
      });
    }
    for (const checkbox of panel.querySelectorAll('.story-await')) {
      checkbox.addEventListener('change', () => {
        const trigger = this._memberOf('trigger', checkbox.dataset.trigger);
        const located = trigger && this._resolveStep(trigger, checkbox.dataset.path);
        if (!located) return;
        const step = located.array[located.index];
        step.params = step.params || {};
        if (checkbox.checked) step.params.await = true;
        else delete step.params.await;
        commit(trigger, checkbox.checked ? '已开启串行等待（教程结束后再执行下一步）' : '已关闭串行等待');
      });
    }
    // 内联编辑教程 开场/收场 提示（写回教程定义）。
    for (const input of panel.querySelectorAll('.story-begin, .story-end')) {
      input.addEventListener('change', event => {
        const tutorial = this._memberOf('tutorial', input.dataset.tutorial);
        if (!tutorial) return;
        const field = input.classList.contains('story-begin') ? 'beginText' : 'endText';
        const value = text(event.target.value);
        if (value) tutorial[field] = value;
        else delete tutorial[field];
        this.editor._status?.(`${input.dataset.tutorial} 的 ${field === 'beginText' ? '开场提示' : '收场提示'} 已更新（点击「💾 保存到工程」生效）`, 'ok');
      });
    }
  }

  _memberOf(type, id) {
    const list = {
      trigger: asList(this.editor.project?.triggers),
      tutorial: asList(this.editor.project?.tutorials),
      dialogue: asList(this.editor.project?.dialogues)
    }[type] || [];
    return list.find(item => item?.id === id) || null;
  }

  /** 从 InputHints 汇总全部可用动作写法（与 FlowGroupStorylinePanel 同源）。 */
  _buttonReferenceRows() {
    const escape = value => this.editor._escapeHtml(value);
    return Object.entries(InputHints.getActions()).map(([name, def]) => {
      const pc = def?.pc || {};
      let pcText;
      try { pcText = InputHints.phrase(name) || pc.key || name; }
      catch (e) { pcText = (pc.kind === 'raw' ? '点击' : '按 ') + (pc.key || name); }
      return {
        name,
        tokens: `{${name}}　{key:${name}}`,
        pc: escape(pcText),
        android: escape(def?.android || '—'),
        pad: escape(def?.padKey || def?.padFixed || '—')
      };
    });
  }

  /** 「按钮写法」全局弹层内容（不含外层 overlay 容器）。 */
  _buttonHelpModalBody() {
    const escape = value => this.editor._escapeHtml(value);
    const rows = this._buttonReferenceRows();
    const body = rows.length
      ? `<div class="story-help-row story-help-head">
            <span>写法（可直接拷贝）</span><span>键鼠</span><span>触屏</span><span>手柄</span>
          </div>`
        + rows.map(row => `
          <div class="story-help-row">
            <code class="story-help-tokens" title="点击拷贝">${escape(row.tokens)}</code>
            <span>${row.pc}</span><span>${row.android}</span><span>${row.pad}</span>
          </div>`).join('')
      : '<div class="story-help-body"><div class="story-empty">（暂无动作定义）</div></div>';
    return `
      <div class="story-btn-help-modal">
        <div class="story-btn-help-head">
          <strong>⌨ 按钮写法（文本模板占位符）</strong>
          <span class="story-btn-help-sub">用于教程 beginText/endText 或对话正文，运行时自动替换成当前设备的按键/控件名</span>
          <button type="button" class="story-btn-help-close" title="关闭">✕</button>
        </div>
        <div class="story-help-note">
          两种写法：<code>{动作名}</code> 显示完整操作短语（如 <code>{attack}</code> → 点击鼠标左键）；<code>{key:动作名}</code> 只插入按键/控件名（如 <code>{key:attack}</code> → 鼠标左键）。
          点击下方任一写法即可拷贝。
        </div>
        <div class="story-help-body">${body}</div>
      </div>`;
  }

  /** 提示文案配置文件基目录（与 UIEditor 同规则：example/<gameId>/config/）。 */
  _configBase() {
    if (this.editor?.gameId) return `example/${this.editor.gameId}/config/`;
    const path = String(this.editor?.projectPath || '');
    const index = path.lastIndexOf('/');
    const dir = index >= 0 ? path.slice(0, index) : '';
    return dir ? `${dir}/config/` : 'config/';
  }

  /** 合并项目已保存的提示文案覆盖（config/InputHints.json），与 UIEditor「提示文案」读取同一文件。 */
  async _ensureInputHintsConfig() {
    if (this._hintsConfigLoaded) return;
    this._hintsConfigLoaded = true;
    try {
      const file = this._configBase() + 'InputHints.json';
      const res = await fetch('/api/read-file?path=' + encodeURIComponent(file));
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.ok || !data.content) return;
      const parsed = JSON.parse(data.content);
      InputHints.merge(parsed && parsed.actions ? parsed.actions : parsed);
    } catch (e) {
      // 无覆盖文件或环境不支持读取时，沿用内部默认表（与 UIEditor 行为一致）
    }
  }

  /** 打开全局「按钮写法」弹层（挂在 body，任一切换页可用）。 */
  async openButtonHelp() {
    await this._ensureInputHintsConfig();
    this._injectButtonHelpStyles();
    if (this._buttonHelpOverlay) {
      this._buttonHelpOverlay.remove();
      this._buttonHelpOverlay = null;
    }
    const overlay = document.createElement('div');
    overlay.className = 'story-btn-help-overlay';
    overlay.innerHTML = this._buttonHelpModalBody();
    document.body.appendChild(overlay);
    this._buttonHelpOverlay = overlay;
    const close = () => {
      overlay.remove();
      if (this._buttonHelpOverlay === overlay) this._buttonHelpOverlay = null;
    };
    overlay.querySelector('.story-btn-help-close').addEventListener('click', close);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    for (const el of overlay.querySelectorAll('.story-help-tokens')) {
      el.addEventListener('click', () => {
        try { navigator.clipboard?.writeText?.(el.textContent || ''); } catch (e) { /* 忽略剪贴板拒绝 */ }
        this.editor._status?.(`已拷贝写法：${el.textContent}`.replace(/　/g, '，'), 'ok');
      });
    }
  }

  _injectButtonHelpStyles() {
    if (document.getElementById('story-btn-help-styles')) return;
    const style = document.createElement('style');
    style.id = 'story-btn-help-styles';
    style.textContent = `
      .story-toolbar{display:flex;align-items:center;gap:12px;padding:0 4px;margin:0 0 10px;flex-wrap:wrap;}
      .story-toolbar-title{font-size:15px;color:#e6ecf7;}
      .story-group-mode{background:#26304e;color:#e6ecf7;border:1px solid #3a4a7e;border-radius:4px;padding:5px 8px;font-size:12px;}
      .story-btn-help{background:#3a4a7e;border:none;color:#fff;border-radius:4px;padding:6px 14px;cursor:pointer;font-size:12px;}
      .story-btn-help:hover{background:#4a5d9e;}
      .story-btn-help-overlay{position:fixed;inset:0;background:rgba(5,10,25,.72);z-index:10000;display:flex;align-items:center;justify-content:center;}
      .story-btn-help-overlay[hidden]{display:none;}
      .story-btn-help-modal{width:min(720px,92vw);max-height:86vh;display:flex;flex-direction:column;background:#0d1326;color:#e6ecf7;border:1px solid #2a3a5e;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.55);overflow:hidden;font-size:13px;}
      .story-btn-help-head{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#101a30;border-bottom:1px solid #2a3a5e;}
      .story-btn-help-sub{color:#8aa;font-size:11px;}
      .story-btn-help-close{margin-left:auto;background:#3a4a7e;border:none;color:#fff;border-radius:4px;padding:4px 10px;cursor:pointer;}
      .story-help-note{padding:10px 16px;color:#93a8cc;font-size:12px;background:#16213e;border-bottom:1px solid #2a3a5e;}
      .story-help-note code{background:#26304e;color:#7a9bd8;border-radius:3px;padding:1px 5px;}
      .story-help-body{flex:1;overflow:auto;padding:8px 16px 16px;}
      .story-help-row{display:grid;grid-template-columns:minmax(160px,1.4fr) 1fr 1fr 1fr;gap:8px;align-items:center;padding:5px 4px;border-bottom:1px dotted #1e2b47;font-size:12px;color:#aebce0;}
      .story-help-row.story-help-head{color:#8a93a8;font-size:11px;position:sticky;top:0;background:#0d1326;}
      .story-help-tokens{color:#7ad;cursor:pointer;white-space:nowrap;}
      .story-help-tokens:hover{color:#fff;}
    `;
    document.head.appendChild(style);
  }

  injectStyles() {
    if (document.getElementById('story-trigger-styles')) return;
    const style = document.createElement('style');
    style.id = 'story-trigger-styles';
    style.textContent = `
      .story-card{margin:12px 0;border:1px solid #2a3a5e;border-radius:8px;background:#111a30;overflow:hidden;}
      .story-head{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#16213e;border-bottom:1px solid #2a3a5e;}
      .story-id{color:#7a8aab;font-size:11px;}
      .story-count{margin-left:auto;color:#93a8cc;font-size:11px;}
      .story-cond{display:flex;gap:0;border-bottom:1px solid #1e2b47;}
      .story-cond-col{flex:1;padding:8px 14px;font-size:12px;color:#bcd;line-height:1.7;}
      .story-cond-col+.story-cond-col{border-left:1px solid #1e2b47;}
      .story-cond-title{color:#e6ecf7;font-weight:600;font-size:11px;margin-bottom:2px;}
      .story-members{padding:8px 14px;}
      .story-empty{color:#5a6a8a;font-size:12px;padding:4px 0;}
      .story-trigger{border-style:solid;margin:8px 0;}
      .story-trigger-head{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#15203c;border-bottom:1px solid #2a3a5e;flex-wrap:wrap;}
      .story-type{color:#c6d4f0;font-weight:600;font-size:11px;min-width:60px;}
      .story-member-id{color:#e6ecf7;font-weight:600;font-size:12px;}
      .story-name{color:#7a8aab;font-size:11px;}
      .story-disabled{color:#c07a9a;font-size:11px;border:1px solid #5a3050;border-radius:3px;padding:0 5px;}
      .story-runtime-badge{display:inline-block;border-radius:8px;padding:1px 8px;font-size:10px;font-weight:bold;white-space:nowrap;}
      .story-highlight{outline:2px solid #f6e7a8;box-shadow:0 0 14px rgba(246,231,168,.45);animation:story-highlight-pulse 1s ease-in-out 2;}
      @keyframes story-highlight-pulse{0%,100%{outline-offset:0;}50%{outline-offset:4px;}}
      .story-jump{background:#26304e;border:1px solid #3a4a7e;color:#bcd;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:11px;margin-left:auto;}
      .story-jump:hover{background:#34406a;color:#fff;}
      .story-steps{padding:8px 12px 10px;}
      .story-step{display:flex;align-items:center;gap:6px;padding:4px 2px;font-size:12px;color:#bcd;flex-wrap:wrap;}
      .story-step button{background:#26304e;border:1px solid #33446e;color:#c3d2f0;border-radius:3px;padding:1px 7px;cursor:pointer;font-size:11px;}
      .story-step button:hover{background:#34406a;}
      .story-step-up,.story-step-down{min-width:26px;}
      .story-step-del{color:#c07a9a;cursor:pointer;padding:0 3px;font-size:12px;}
      .story-step-del:hover{color:#ff8a80;}
      .story-orch-op{color:#dbe6ff;font-size:11px;white-space:nowrap;}
      .story-step-id{color:#5a6a8a;font-size:11px;}
      .story-step-params{color:#7c92bd;font-size:11px;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .story-step-tutorial{background:#1a2a3a;border:1px solid #2a4a7e;border-radius:4px;padding:4px 8px;margin:2px 0;}
      .story-step-branch{border:1px dashed #3a5490;border-radius:4px;padding:4px 8px;margin:2px 0;background:#0f1830;}
      .story-step-target{background:#1a2440;color:#dbe6ff;border:1px solid #2f4168;border-radius:3px;padding:2px 6px;font-size:11px;max-width:220px;}
      .story-step-await{display:flex;align-items:center;gap:4px;color:#93a8cc;font-size:11px;cursor:pointer;}
      .story-tutorial-hints{display:flex;gap:10px;flex-wrap:wrap;flex-basis:100%;margin-top:4px;}
      .story-prompt{display:flex;align-items:center;gap:6px;color:#93a8cc;font-size:11px;}
      .story-prompt span{min-width:96px;}
      .story-prompt input{background:#1a2440;color:#dbe6ff;border:1px solid #2f4168;border-radius:3px;padding:4px 7px;font-size:12px;min-width:200px;}
      .story-branch{margin:4px 0 4px 14px;border-left:2px solid #2a3a5e;padding-left:10px;}
      .story-branch-when{color:#9ab6e0;font-size:11px;margin-bottom:2px;}
      .story-step-actions{margin-top:6px;}
      .story-step-add{background:#1d2a4a;border:1px dashed #3a5490;color:#9ab6e0;border-radius:3px;padding:3px 8px;cursor:pointer;font-size:11px;}
      .story-step-add:hover{background:#2a3a64;color:#fff;}
      .story-chain{display:flex;flex-direction:column;gap:2px;padding:4px 12px;background:#0f1830;border-bottom:1px solid #1e2b47;font-size:11px;}
      .story-chain-in{color:#7a9bd8;}
      .story-chain-out{color:#6fae7f;}
    `;
    document.head.appendChild(style);
  }
}

export default TriggerStorylinePanel;
