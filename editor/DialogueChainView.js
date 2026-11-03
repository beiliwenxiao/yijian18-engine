/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-03
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * DialogueChainView - 对话链视图（方案 3，2026-11-03 乞讨链断链事故沉淀）
 *
 * 跨对话接线总览：每个对话一张卡片，展示 启动来源 → 本对话 → 监听触发器
 * （动作摘要）→ 去向对话；断线即红/黄高亮，解决「跨三文件手工接线漏一环
 * 静默不可见」的排查痛点。
 *
 * 校验规则镜像 src/core/DefinitionRepository.js 的 validateDialogueGraph
 * （加载期静态校验）：孤儿对话 / dialogueChoice 未按 choiceId 过滤 / choiceId
 * 与节点引用悬空 / 监听不存在的对话。规则两边同步维护——改一边必须改另一边。
 */

/** 触发动作 → 一行摘要（链卡片「监听触发器」动作列表用）。 */
function describeAction(action) {
  const p = action?.params || {};
  switch (action?.action) {
    case 'startDialogue': return `▶ 对话 ${p.id || '?'}`;
    case 'dialogue.command': return `▶ 对话 ${p.dialogueId || '?'}${p.operation && p.operation !== 'start' ? `(${p.operation})` : ''}`;
    case 'state.transaction': return `⚑ 事务 ${p.definitionId || '?'}`;
    case 'spawnPlacements': return `✦ 生成 ${p.selector?.group || p.selector?.id || '?'}`;
    case 'despawnPlacements': return `✗ 移除 ${p.selector?.group || p.selector?.id || '?'}`;
    case 'scenario.command': return `⚙ ${p.operation || p.scenarioId || '?'}`;
    case 'showTip': return `💬 ${String(p.text || '').slice(0, 18)}`;
    case 'takeReward': return '－ 扣物';
    case 'giveReward': return '＋ 给物';
    case 'setVar': return `⌨ ${p.key || '?'}=${String(p.value).slice(0, 10)}`;
    default: return String(action?.action || '?');
  }
}

/** 递归收集触发步骤（branch[] 分支容器展开，与引擎 _runSteps 同构）。 */
export function collectActionSteps(steps) {
  const out = [];
  const walk = candidates => {
    for (const step of candidates) {
      if (Array.isArray(step?.branch)) {
        step.branch.forEach(alternative => walk(Array.isArray(alternative?.do) ? alternative.do : []));
        continue;
      }
      out.push(step);
    }
  };
  walk(Array.isArray(steps) ? steps : []);
  return out;
}

/** 收集对话定义全部选项 id（跨所有节点）。 */
function collectChoiceIds(definition) {
  const ids = new Set();
  const nodes = definition?.nodes && typeof definition.nodes === 'object' ? definition.nodes : {};
  for (const node of Object.values(nodes)) {
    for (const choice of Array.isArray(node?.choices) ? node.choices : []) {
      if (typeof choice?.id === 'string' && choice.id) ids.add(choice.id);
    }
  }
  return ids;
}

/** HTML 转义（对话标题/来源标签来自内容数据，防注入）。 */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * 构建跨对话接线模型（纯函数，便于单测）。
 * @param {{dialogues:Array, triggers:Array, quests:Array, scenarios?:Array}} content
 * @returns {{ dialogues:Array, danglingListeners:Array, summary:Object }}
 */
export function buildDialogueWiring({ dialogues = [], triggers = [], quests = [], scenarios = [] } = {}) {
  const dialogueIds = new Set(dialogues.map(d => String(d?.id || '')).filter(Boolean));

  // 来源收集：触发器 startDialogue / dialogue.command(start) + quest 步骤/引用 + scenario 引用
  const sources = new Map(); // dialogueId -> [{ kind, label, ref }]
  const mark = (id, kind, label, ref) => {
    if (typeof id !== 'string' || !id || !dialogueIds.has(id)) return;
    if (!sources.has(id)) sources.set(id, []);
    sources.get(id).push({ kind, label, ref });
  };
  const transitions = new Map();      // dialogueId -> Set<下一对话 id>（监听触发器串接的去向）
  const listenersByDialogue = new Map(); // dialogueId -> listeners
  const danglingListeners = [];          // 监听不存在的对话（这类触发器永远不触发）

  for (const trigger of Array.isArray(triggers) ? triggers : []) {
    const whenType = trigger?.when?.type;
    const steps = collectActionSteps(trigger?.do);
    // 来源收集扫全量触发器（任意 when 类型都可能 startDialogue——场景入口/定时等），
    // 与加载期 collectDialogueStartSources 同规则；监听挂卡仅认 dialogueChoice/dialogueEnd。
    for (const action of steps) {
      const started = action?.action === 'startDialogue' ? action?.params?.id
        : action?.action === 'dialogue.command' && (!action?.params?.operation || action.params.operation === 'start')
          ? action?.params?.dialogueId : null;
      if (typeof started === 'string' && started && dialogueIds.has(started)) {
        mark(started, 'trigger', `由触发器 ${String(trigger?.id || '?')} 启动`, `${String(trigger?.id || '?')}.do`);
      }
    }
    if (whenType !== 'dialogueChoice' && whenType !== 'dialogueEnd') continue;
    const targetId = trigger?.when?.params?.id;
    const entry = {
      triggerId: String(trigger?.id || '?'),
      event: whenType,
      choiceId: typeof trigger?.when?.params?.choiceId === 'string' ? trigger.when.params.choiceId : null,
      actions: steps.map(describeAction)
    };
    if (typeof targetId !== 'string' || !targetId) {
      danglingListeners.push({ ...entry, dialogueId: null, reason: '未声明对话 id（when.params.id）' });
      continue;
    }
    if (!dialogueIds.has(targetId)) {
      danglingListeners.push({ ...entry, dialogueId: targetId, reason: '监听的对话不存在（悬空引用）' });
      continue;
    }
    if (!listenersByDialogue.has(targetId)) listenersByDialogue.set(targetId, []);
    listenersByDialogue.get(targetId).push(entry);
    for (const action of steps) {
      const started = action?.action === 'startDialogue' ? action?.params?.id
        : action?.action === 'dialogue.command' && (!action?.params?.operation || action.params.operation === 'start')
          ? action?.params?.dialogueId : null;
      if (typeof started === 'string' && started && dialogueIds.has(started) && started !== targetId) {
        if (!transitions.has(targetId)) transitions.set(targetId, new Set());
        transitions.get(targetId).add(started);
      }
    }
  }

  for (const quest of Array.isArray(quests) ? quests : []) {
    const label = `任务 ${quest?.title || quest?.id || '?'}`;
    for (const ref of Array.isArray(quest?.dialogueRefs) ? quest.dialogueRefs : []) {
      mark(String(ref), 'quest', label, `quests.${quest?.id}.dialogueRefs`);
    }
    (Array.isArray(quest?.steps) ? quest.steps : []).forEach((step, index) => {
      if (step?.type === 'dialogue') mark(String(step?.dialogueId || ''), 'quest', label, `quests.${quest?.id}.steps[${index}].dialogueId`);
    });
    if (quest?.giver?.dialogueId) mark(String(quest.giver.dialogueId), 'quest', `${label}（接取对话）`, `quests.${quest?.id}.giver.dialogueId`);
  }
  for (const scenario of Array.isArray(scenarios) ? scenarios : []) {
    for (const ref of Array.isArray(scenario?.dialogueRefs) ? scenario.dialogueRefs : []) {
      mark(String(ref), 'scenario', `剧情 ${scenario?.title || scenario?.id || '?'}`, `scenarios.${scenario?.id}.dialogueRefs`);
    }
  }

  const cards = dialogues.map(dialogue => {
    const id = String(dialogue?.id || '');
    const nodes = dialogue?.nodes && typeof dialogue.nodes === 'object' ? dialogue.nodes : {};
    const choiceIds = collectChoiceIds(dialogue);
    const issues = [];
    // 节点引用悬空（与加载期校验同规则）
    if (typeof dialogue?.startNode === 'string' && dialogue.startNode && !nodes[dialogue.startNode]) {
      issues.push({ severity: 'error', code: 'invalidReference', message: `startNode 悬空: ${dialogue.startNode}` });
    }
    for (const [nodeId, node] of Object.entries(nodes)) {
      if (typeof node?.nextNode === 'string' && node.nextNode && !nodes[node.nextNode]) {
        issues.push({ severity: 'error', code: 'invalidReference', message: `节点 ${nodeId}.nextNode 悬空: ${node.nextNode}` });
      }
      (Array.isArray(node?.choices) ? node.choices : []).forEach((choice, index) => {
        if (typeof choice?.nextNode === 'string' && choice.nextNode && !nodes[choice.nextNode]) {
          issues.push({ severity: 'error', code: 'invalidReference', message: `节点 ${nodeId}.choices[${index}].nextNode 悬空: ${choice.nextNode}` });
        }
      });
    }
    // 孤儿对话（无来源且未声明 runtimeStarted）
    const cardSources = sources.get(id) || [];
    if (cardSources.length === 0 && dialogue?.runtimeStarted !== true) {
      issues.push({ severity: 'error', code: 'unreachableDialogue', message: '孤儿对话：无任何启动来源，永远不会触发' });
    }
    // 监听触发器的 choiceId 校验
    const listeners = listenersByDialogue.get(id) || [];
    for (const listener of listeners) {
      if (listener.event !== 'dialogueChoice') continue;
      if (!listener.choiceId) {
        if (choiceIds.size > 0) {
          issues.push({ severity: 'warning', code: 'unfilteredDialogueChoice',
            message: `触发器 ${listener.triggerId} 未声明 choiceId，将对所有选项生效` });
        }
        continue;
      }
      if (!choiceIds.has(listener.choiceId)) {
        issues.push({ severity: 'error', code: 'invalidReference',
          message: `触发器 ${listener.triggerId} 声明的 choiceId 不存在: ${listener.choiceId}` });
      }
    }
    return {
      id,
      title: dialogue?.title || '',
      nodeCount: Object.keys(nodes).length,
      choiceIds: [...choiceIds],
      runtimeStarted: dialogue?.runtimeStarted === true,
      sources: cardSources,
      listeners,
      nextDialogueIds: [...(transitions.get(id) || [])],
      issues
    };
  });

  const summary = {
    total: cards.length,
    orphans: cards.filter(card => card.issues.some(issue => issue.code === 'unreachableDialogue')).length,
    unfiltered: cards.filter(card => card.issues.some(issue => issue.code === 'unfilteredDialogueChoice')).length,
    broken: cards.reduce((count, card) => count + card.issues.filter(issue => issue.severity === 'error' && issue.code === 'invalidReference').length, 0)
      + danglingListeners.length
  };
  return { dialogues: cards, danglingListeners, summary };
}

/** 对话链视图渲染（跨对话接线总览面板）。 */
export class DialogueChainView {
  /**
   * @param {HTMLElement} container
   * @param {{ onSelectDialogue?:(id:string)=>void }} options - 点击卡片回跳对话编辑
   */
  constructor(container, options = {}) {
    this.container = container;
    this.onSelectDialogue = options.onSelectDialogue || null;
    this.model = null;
    this.filter = ''; // '' = 全部 | 'issues' = 仅问题
  }

  render(model) {
    this.model = model;
    this._injectStyles();
    this._render();
  }

  _injectStyles() {
    if (document.getElementById('dlg-chain-styles')) return;
    const style = document.createElement('style');
    style.id = 'dlg-chain-styles';
    style.textContent = `
      .dc-root{height:100%;overflow-y:auto;padding:14px;}
      .dc-summary{display:flex;gap:14px;align-items:center;padding:10px 14px;background:#16213e;border:1px solid #2a3a5e;border-radius:6px;margin-bottom:12px;font-size:13px;flex-wrap:wrap;}
      .dc-summary .dc-num{font-weight:bold;}
      .dc-summary .dc-ok{color:#6c6;} .dc-summary .dc-bad{color:#e66;} .dc-summary .dc-warn{color:#eb6;}
      .dc-filter{margin-left:auto;display:flex;gap:6px;}
      .dc-filter button{padding:4px 10px;background:#3a4a7e;border:none;border-radius:3px;color:#fff;cursor:pointer;font-size:12px;}
      .dc-filter button.active{background:#4CAF50;color:#000;}
      .dc-card{border:1px solid #2a3a5e;border-left:4px solid #4CAF50;border-radius:6px;padding:10px 14px;margin-bottom:10px;background:#0f1830;cursor:pointer;}
      .dc-card:hover{background:#15203e;}
      .dc-card.has-error{border-left-color:#e66;}
      .dc-card.has-warning{border-left-color:#eb6;}
      .dc-card .dc-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
      .dc-card .dc-title{font-weight:bold;font-size:13px;color:#fff;}
      .dc-card .dc-id{font-size:11px;color:#9ab;}
      .dc-badge{font-size:10px;padding:1px 7px;border-radius:8px;}
      .dc-badge.err{background:#7e2a2a;color:#faa;}
      .dc-badge.warn{background:#7e5a1a;color:#fda;}
      .dc-badge.ok{background:#2a4a2e;color:#afa;}
      .dc-row{font-size:12px;margin:3px 0;display:flex;gap:6px;flex-wrap:wrap;align-items:baseline;}
      .dc-row .dc-label{color:#789;flex-shrink:0;width:64px;}
      .dc-chip{background:#0c1428;border:1px solid #26365a;border-radius:3px;padding:2px 7px;font-size:11px;color:#cde;}
      .dc-chip.link{color:#7cf;cursor:pointer;}
      .dc-chip.link:hover{background:#1a2a4e;}
      .dc-chip.warn{color:#fda;border-color:#7e5a1a;}
      .dc-issues{margin-top:5px;}
      .dc-issue{font-size:11px;padding:2px 0;}
      .dc-issue.error{color:#f99;}
      .dc-issue.warning{color:#fda;}
      .dc-empty{color:#778;padding:30px;text-align:center;}
    `;
    document.head.appendChild(style);
  }

  setFilter(filter) {
    this.filter = filter;
    this._render();
  }

  _render() {
    if (!this.model) {
      this.container.innerHTML = '<div class="dc-root"><div class="dc-empty">对话链数据未就绪</div></div>';
      return;
    }
    const { dialogues, danglingListeners, summary } = this.model;
    const hasIssue = card => card.issues.length > 0;
    const visible = dialogues.filter(card => this.filter !== 'issues' || hasIssue(card));

    const summaryHtml = `
      <div class="dc-summary">
        <span>对话 <span class="dc-num dc-ok">${summary.total}</span></span>
        <span>孤儿 <span class="dc-num ${summary.orphans ? 'dc-bad' : 'dc-ok'}">${summary.orphans}</span></span>
        <span>未过滤选项 <span class="dc-num ${summary.unfiltered ? 'dc-warn' : 'dc-ok'}">${summary.unfiltered}</span></span>
        <span>断引用 <span class="dc-num ${summary.broken ? 'dc-bad' : 'dc-ok'}">${summary.broken}</span></span>
        <div class="dc-filter">
          <button data-dc-filter="" class="${this.filter === '' ? 'active' : ''}">全部</button>
          <button data-dc-filter="issues" class="${this.filter === 'issues' ? 'active' : ''}">仅问题</button>
        </div>
      </div>`;

    const danglingHtml = danglingListeners.length === 0 ? '' : `
      <div class="dc-card has-error">
        <div class="dc-head"><span class="dc-badge err">悬空监听</span>
          <span class="dc-id">以下 dialogueChoice/dialogueEnd 触发器引用的对话不存在，永远不会触发</span></div>
        ${danglingListeners.map(listener => `
          <div class="dc-row"><span class="dc-chip warn">⚠ ${esc(listener.triggerId)}</span>
            <span class="dc-id">${esc(listener.event)} → ${esc(listener.dialogueId || '(未声明)')} · ${esc(listener.reason)}</span></div>`).join('')}
      </div>`;

    const cardsHtml = visible.map(card => {
      const cls = card.issues.some(issue => issue.severity === 'error') ? 'has-error'
        : card.issues.some(issue => issue.severity === 'warning') ? 'has-warning' : '';
      const statusBadge = card.issues.some(issue => issue.severity === 'error') ? '<span class="dc-badge err">断链</span>'
        : card.issues.some(issue => issue.severity === 'warning') ? '<span class="dc-badge warn">提示</span>'
        : '<span class="dc-badge ok">接线完整</span>';
      const sourceChips = card.runtimeStarted && card.sources.length === 0
        ? '<span class="dc-chip">⚙ 引擎代码启动（runtimeStarted）</span>'
        : card.sources.map(source => `<span class="dc-chip" title="${esc(source.ref)}">${esc(source.label)}</span>`).join('') || '<span class="dc-chip warn">无启动来源</span>';
      const listenerChips = card.listeners.map(listener => `
        <span class="dc-chip" title="${esc(listener.actions.join('；'))}">
          ${listener.event === 'dialogueChoice' ? '✪' : '⏏'} ${esc(listener.triggerId)}${listener.event === 'dialogueChoice' ? (listener.choiceId ? ` · ${esc(listener.choiceId)}` : ' · (全部选项)') : ' · (对话结束)'}</span>`).join('')
        || '<span class="dc-chip warn">无监听触发器</span>';
      const nextChips = card.nextDialogueIds.length > 0
        ? card.nextDialogueIds.map(nextId => `<span class="dc-chip link" data-dc-jump="${esc(nextId)}">→ ${esc(nextId)}</span>`).join('')
        : '<span class="dc-id">（无后续对话）</span>';
      const issuesHtml = card.issues.length === 0 ? '' : `
        <div class="dc-issues">${card.issues.map(issue => `<div class="dc-issue ${issue.severity}">${issue.severity === 'error' ? '🔴' : '🟡'} ${esc(issue.message)}</div>`).join('')}</div>`;
      return `
        <div class="dc-card ${cls}" data-dc-id="${esc(card.id)}">
          <div class="dc-head">
            ${statusBadge}
            <span class="dc-title">${esc(card.title || '(未命名)')}</span>
            <span class="dc-id">${esc(card.id)} · ${card.nodeCount} 节点 · ${card.choiceIds.length} 选项</span>
          </div>
          <div class="dc-row"><span class="dc-label">启动来源</span>${sourceChips}</div>
          <div class="dc-row"><span class="dc-label">监听触发器</span>${listenerChips}</div>
          <div class="dc-row"><span class="dc-label">去向</span>${nextChips}</div>
          ${issuesHtml}
        </div>`;
    }).join('');

    this.container.innerHTML = `
      <div class="dc-root">
        ${summaryHtml}
        ${danglingHtml}
        ${visible.length === 0 ? '<div class="dc-empty">无匹配对话</div>' : cardsHtml}
      </div>`;

    this.container.querySelectorAll('[data-dc-filter]').forEach(button => {
      button.addEventListener('click', () => this.setFilter(button.dataset.dcFilter));
    });
    this.container.querySelectorAll('[data-dc-jump]').forEach(chip => {
      chip.addEventListener('click', event => {
        event.stopPropagation();
        this.onSelectDialogue?.(chip.dataset.dcJump);
      });
    });
    this.container.querySelectorAll('.dc-card[data-dc-id]').forEach(card => {
      card.addEventListener('click', () => this.onSelectDialogue?.(card.dataset.dcId));
    });
  }
}

export default DialogueChainView;
