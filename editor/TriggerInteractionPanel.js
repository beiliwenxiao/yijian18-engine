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

import { getTriggerActions, getTriggerActionOperations } from '../src/systems/TriggerCatalog.js';

const asList = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();

/**
 * TriggerInteractionPanel - 交互注册表视图（TriggerEditor 的「交互」页签）。
 *
 * 把 when.type=interact 的触发器按场景聚合，呈现为「交互点 → do 动作链」的行式表格
 * （编辑风格与状态事务管理的行式编辑一致）。triggers.json 数据格式完全不动、
 * 运行时零改动——这只是同一份 triggers[] 数据的第二种编辑视图：
 *   - 新增交互 = 加一行（选场景 + 命名），动作链行内选 action + operation；
 *   - 含分支/复杂参数的触发器行内锁定，经「详细编辑」跳回规则编辑卡片。
 * 未在此视图出现的非交互触发器（sceneEnter 装配、transaction 链）仍走规则编辑。
 */
export class TriggerInteractionPanel {
  /** @param {TriggerEditor} editor */
  constructor(editor) {
    this.editor = editor;
    this.newSceneId = ''; // 「新增交互」选定的归属场景
  }

  _escape(value) {
    return this.editor?._escapeHtml
      ? this.editor._escapeHtml(value)
      : String(value ?? '');
  }

  /** 场景归属：空间绑定优先，其次 editorScope 声明；都没有则未绑定。 */
  _sceneIdsOf(trigger) {
    const byBinding = asList(this.editor.projectIndex?.getBindingsForTrigger?.(trigger.id))
      .map(record => text(record?.sceneId)).filter(Boolean);
    if (byBinding.length) return [...new Set(byBinding)];
    const scoped = asList(trigger?.editorScope?.sceneIds).map(text).filter(Boolean);
    return [...new Set(scoped)];
  }

  /** 按场景聚合交互触发器；返回 [{key, label, items}]（定义序）。 */
  _groups() {
    const triggers = asList(this.editor.project?.triggers);
    const interactions = triggers.filter(trigger => text(trigger?.when?.type) === 'interact');
    const nameOf = id => {
      const map = new Map();
      try { for (const scene of this.editor.getSceneList?.() || []) map.set(scene.id, scene.name || scene.id); }
      catch (e) { /* 忽略 */ }
      return map.get(id) || id;
    };
    const buckets = new Map();
    for (const trigger of interactions) {
      const sceneIds = this._sceneIdsOf(trigger);
      const keys = sceneIds.length ? sceneIds : [''];
      for (const key of keys) {
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(trigger);
      }
    }
    const groups = [...buckets.entries()].map(([key, items]) => ({
      key,
      label: key ? `${nameOf(key)}（${key}）` : '（未绑定场景）',
      items
    }));
    // 场景按 id 排序；未绑定场景固定在最后
    return groups.sort((left, right) => {
      if (!left.key) return 1;
      if (!right.key) return -1;
      return left.key.localeCompare(right.key);
    });
  }

  render(panel) {
    this.injectStyles();
    const actions = getTriggerActions(this.editor.project);
    if (!actions.length) {
      panel.innerHTML = '<div style="padding:24px;color:#8a93a8;">动作目录不可用。</div>';
      return;
    }
    const groups = this._groups();
    const scenes = this.editor.getSceneList?.() || [];
    panel.innerHTML = `
      <div class="ti-toolbar">
        <strong class="ti-toolbar-title">交互注册表（${asList(this.editor.project?.triggers)
          .filter(trigger => text(trigger?.when?.type) === 'interact').length} 个交互点）</strong>
        <select class="ti-new-scene" title="新交互归属场景（也可之后在场景编辑器做空间绑定）">
          <option value="">（暂不归属场景）</option>
          ${scenes.map(scene => `<option value="${this._escape(scene.id)}"${this.newSceneId === scene.id ? ' selected' : ''}>${this._escape(scene.name || scene.id)}</option>`).join('')}
        </select>
        <button type="button" class="ti-add">+ 新增交互</button>
        <span class="ti-hint">交互 = 靠近交互点按键触发（when: interact）；绑定交互点在场景编辑器完成。改动后点「💾 保存到工程」生效。</span>
      </div>
      ${groups.length ? groups.map(group => this._renderGroup(group)).join('')
        : '<div class="ti-empty">暂无交互触发器。点击「+ 新增交互」创建第一个。</div>'}`;
    this._bindEvents(panel);
  }

  _renderGroup(group) {
    return `
      <div class="ti-card">
        <div class="ti-group-head">
          <strong>📍 ${this._escape(group.label)}</strong>
          <span class="ti-count">${group.items.length} 个交互</span>
        </div>
        ${group.items.map(trigger => this._renderRow(trigger)).join('')}
      </div>`;
  }

  _renderRow(trigger) {
    const escape = this._escape.bind(this);
    const id = text(trigger.id);
    const steps = asList(trigger.do);
    const branchStep = steps.some(step => Array.isArray(step?.branch));
    const bindings = asList(this.editor.projectIndex?.getBindingsForTrigger?.(id));
    const pointLabel = bindings.length
      ? bindings.map(record => {
          const binding = record?.binding || {};
          const label = text(binding.prompt) || text(binding.id) || '（未命名绑定）';
          return `⚡ ${escape(label)}`;
        }).join('　')
      : '<span class="ti-unbound">未绑定交互点</span>';
    return `
      <div class="ti-row" data-trigger="${escape(id)}">
        <div class="ti-cell ti-point" title="该触发器在场景中的空间绑定（binding.prompt / id）">${pointLabel}</div>
        <div class="ti-cell ti-name-wrap">
          <input class="ti-name" value="${escape(text(trigger.name))}" placeholder="交互名称" title="交互名称（列表与提示显示用）">
          <code class="ti-id">${escape(id)}</code>
        </div>
        <div class="ti-cell ti-steps" data-role="steps">
          ${branchStep ? '<div class="ti-locked">🔀 含分支步骤，行内不可编辑</div>'
            : steps.length ? steps.map((step, index) => this._renderStep(step, index, trigger)).join('')
              : '<div class="ti-unbound">（无动作）</div>'}
          ${branchStep ? '' : `
            <div class="ti-step ti-step-add">
              <select class="ti-add-action"><option value="">+ 选择动作…</option>${this._actionOptions('')}</select>
              <select class="ti-add-operation" hidden></select>
            </div>`}
        </div>
        <div class="ti-cell ti-ops">
          <label class="ti-once" title="勾选后交互只生效一次（once）">
            <input type="checkbox" class="ti-once-cb"${trigger.once ? ' checked' : ''}> 一次
          </label>
          <button type="button" class="ti-edit" title="打开规则编辑卡片，编辑条件与完整参数">详细编辑 →</button>
          <button type="button" class="ti-del" title="删除该交互触发器">🗑</button>
        </div>
      </div>`;
  }

  _renderStep(step, index, trigger) {
    const escape = this._escape.bind(this);
    const action = text(step?.action);
    return `
      <div class="ti-step" data-step-index="${index}">
        <select class="ti-step-action" title="动作">
          <option value="">（选择动作）</option>${this._actionOptions(action)}
        </select>
        <select class="ti-step-operation" title="操作">
          ${this._operationOptions(action, text(step?.params?.operation))}
        </select>
        <span class="ti-step-params" title="${escape(this._jsonCompact(step?.params))}">${escape(this._paramsSummary(step))}</span>
        <button type="button" class="ti-step-up" title="上移">↑</button>
        <button type="button" class="ti-step-down" title="下移">↓</button>
        <button type="button" class="ti-step-del" title="删除此动作">✕</button>
      </div>`;
  }

  _actionOptions(selected) {
    return getTriggerActions(this.editor.project).map(item =>
      `<option value="${this._escape(item.v)}"${item.v === selected ? ' selected' : ''}>${this._escape(item.label || item.v)}</option>`).join('');
  }

  _operationOptions(action, selected) {
    const operations = action ? getTriggerActionOperations(action, this.editor.project) : [];
    if (!operations.length) return '<option value="">（无操作）</option>';
    return `<option value="">（未选操作）</option>` + operations.map(item =>
      `<option value="${this._escape(item.v)}"${item.v === selected ? ' selected' : ''}>${this._escape(item.label || item.v)}</option>`).join('');
  }

  _paramsSummary(step) {
    const params = step?.params || {};
    const known = new Set(['operation']);
    const extras = Object.entries(params)
      .filter(([key]) => !known.has(key))
      .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`);
    return extras.join(' · ') || '—（详细编辑可配参数）';
  }

  _jsonCompact(value) {
    if (!value || typeof value !== 'object') return '';
    try { return JSON.stringify(value); } catch (e) { return ''; }
  }

  _commit(panel, message) {
    this.editor._status?.(`${message}（点击「💾 保存到工程」生效）`, 'ok');
    this.render(panel);
  }

  _bindEvents(panel) {
    panel.querySelector('.ti-new-scene')?.addEventListener('change', event => {
      this.newSceneId = event.target.value;
    });

    panel.querySelector('.ti-add')?.addEventListener('click', () => {
      const sceneId = text(this.newSceneId);
      const triggers = asList(this.editor.project.triggers);
      const trigger = {
        id: this.editor._nextStableId('trg-interact', triggers),
        name: '新交互',
        when: { type: 'interact', params: {} },
        do: []
      };
      if (sceneId) trigger.editorScope = { sceneIds: [sceneId] };
      // 追加到 triggers 末尾，保持与其它视图同一份数据
      if (!Array.isArray(this.editor.project.triggers)) this.editor.project.triggers = triggers;
      this.editor.project.triggers.push(trigger);
      this._commit(panel, `已新增交互 ${trigger.id}${sceneId ? `（归属 ${sceneId}）` : ''}`);
    });

    for (const input of panel.querySelectorAll('.ti-name')) {
      input.addEventListener('change', () => {
        const trigger = this._memberOf(input);
        if (!trigger) return;
        const value = text(input.value);
        if (value) trigger.name = value;
        else delete trigger.name;
        this._commit(panel, `已更新 ${trigger.id} 的名称`);
      });
    }

    for (const checkbox of panel.querySelectorAll('.ti-once-cb')) {
      checkbox.addEventListener('change', () => {
        const trigger = this._memberOf(checkbox);
        if (!trigger) return;
        if (checkbox.checked) trigger.once = true;
        else delete trigger.once;
        this._commit(panel, `已${checkbox.checked ? '开启' : '关闭'} ${trigger.id} 的一次性触发`);
      });
    }

    // 行内添加动作：选动作 → 有操作目录的再选操作追加；无操作目录的选动作即追加
    for (const select of panel.querySelectorAll('.ti-add-action')) {
      select.addEventListener('change', () => {
        const wrap = select.closest('.ti-step-add');
        const opSelect = wrap?.querySelector('.ti-add-operation');
        if (!wrap || !opSelect) return;
        const action = text(select.value);
        if (!action) {
          opSelect.hidden = true;
          return;
        }
        const trigger = this._memberOf(select);
        if (!trigger) return;
        const operations = getTriggerActionOperations(action, this.editor.project);
        if (!operations.length) {
          trigger.do = asList(trigger.do);
          trigger.do.push({
            action,
            params: {},
            stepId: this.editor._nextStableId(`${trigger.id}-step`, trigger.do)
          });
          this._commit(panel, `已为 ${trigger.name || trigger.id} 追加动作（详细编辑可配参数）`);
          return;
        }
        opSelect.hidden = false;
        opSelect.innerHTML = `<option value="">选择操作后追加…</option>${this._operationOptions(action, '')}`;
      });
    }
    for (const opSelect of panel.querySelectorAll('.ti-add-operation')) {
      opSelect.addEventListener('change', () => {
        const wrap = opSelect.closest('.ti-step-add');
        const actionSelect = wrap?.querySelector('.ti-add-action');
        if (!actionSelect || !opSelect.value) return;
        const trigger = this._memberOf(actionSelect);
        if (!trigger) return;
        const action = text(actionSelect.value);
        trigger.do = asList(trigger.do);
        const params = { operation: opSelect.value };
        trigger.do.push({
          action,
          params,
          stepId: this.editor._nextStableId(`${trigger.id}-step`, trigger.do)
        });
        this._commit(panel, `已为 ${trigger.name || trigger.id} 追加动作（详细编辑可配参数）`);
      });
    }

    for (const select of panel.querySelectorAll('.ti-step-action')) {
      select.addEventListener('change', () => {
        const row = select.closest('.ti-step');
        const index = Number(row?.dataset.stepIndex);
        const trigger = this._memberOf(select);
        if (!trigger || !Number.isInteger(index)) return;
        trigger.do = asList(trigger.do);
        const step = trigger.do[index];
        if (!step) return;
        step.action = select.value;
        step.params = {}; // 切动作后旧参数作废，操作/参数重新选择
        this._commit(panel, `已切换 ${trigger.name || trigger.id} 的第 ${index + 1} 个动作`);
      });
    }

    for (const select of panel.querySelectorAll('.ti-step-operation')) {
      select.addEventListener('change', () => {
        const row = select.closest('.ti-step');
        const index = Number(row?.dataset.stepIndex);
        const trigger = this._memberOf(select);
        if (!trigger || !Number.isInteger(index)) return;
        trigger.do = asList(trigger.do);
        const step = trigger.do[index];
        if (!step) return;
        step.params = { ...(step.params || {}) };
        if (select.value) step.params.operation = select.value;
        else delete step.params.operation;
        this._commit(panel, `已更新 ${trigger.name || trigger.id} 的操作`);
      });
    }

    for (const button of panel.querySelectorAll('.ti-step-up, .ti-step-down')) {
      button.addEventListener('click', () => {
        const row = button.closest('.ti-step');
        const index = Number(row?.dataset.stepIndex);
        const trigger = this._memberOf(button);
        if (!trigger || !Number.isInteger(index)) return;
        trigger.do = asList(trigger.do);
        const delta = button.classList.contains('ti-step-up') ? -1 : 1;
        const target = index + delta;
        if (target < 0 || target >= trigger.do.length) return;
        [trigger.do[index], trigger.do[target]] = [trigger.do[target], trigger.do[index]];
        this._commit(panel, `已调整 ${trigger.name || trigger.id} 的动作顺序`);
      });
    }

    for (const button of panel.querySelectorAll('.ti-step-del')) {
      button.addEventListener('click', () => {
        const row = button.closest('.ti-step');
        const index = Number(row?.dataset.stepIndex);
        const trigger = this._memberOf(button);
        if (!trigger || !Number.isInteger(index)) return;
        trigger.do = asList(trigger.do);
        if (index < 0 || index >= trigger.do.length) return;
        trigger.do.splice(index, 1);
        this._commit(panel, `已删除 ${trigger.name || trigger.id} 的一个动作`);
      });
    }

    for (const button of panel.querySelectorAll('.ti-edit')) {
      button.addEventListener('click', () => {
        const row = button.closest('.ti-row');
        const id = row?.dataset.trigger;
        if (id) this.editor.selectById(id, 'triggers');
      });
    }

    for (const button of panel.querySelectorAll('.ti-del')) {
      button.addEventListener('click', () => {
        const row = button.closest('.ti-row');
        const id = row?.dataset.trigger;
        const trigger = asList(this.editor.project.triggers).find(item => item?.id === id);
        if (!trigger) return;
        if (!confirm(`确定删除交互「${trigger.name || trigger.id}」吗？场景中的空间绑定将失去目标。`)) return;
        const index = this.editor.project.triggers.indexOf(trigger);
        if (index >= 0) this.editor.project.triggers.splice(index, 1);
        this._commit(panel, `已删除交互 ${id}`);
      });
    }
  }

  /** 由行内控件反查所属触发器。 */
  _memberOf(control) {
    const row = control.closest('.ti-row');
    const id = row?.dataset.trigger;
    return asList(this.editor.project?.triggers).find(item => item?.id === id) || null;
  }

  injectStyles() {
    if (document.getElementById('ti-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'ti-panel-styles';
    style.textContent = `
      .ti-toolbar{display:flex;align-items:center;gap:12px;padding:0 4px;margin:0 0 10px;flex-wrap:wrap;}
      .ti-toolbar-title{font-size:15px;color:#e6ecf7;}
      .ti-toolbar select,.ti-new-scene{background:#26304e;color:#e6ecf7;border:1px solid #3a4a7e;border-radius:4px;padding:5px 8px;font-size:12px;}
      .ti-add{background:#3a4a7e;border:none;color:#fff;border-radius:4px;padding:6px 14px;cursor:pointer;font-size:12px;}
      .ti-add:hover{background:#4a5d9e;}
      .ti-hint{color:#7a8aab;font-size:11px;}
      .ti-empty{padding:24px;color:#8a93a8;}
      .ti-card{margin:12px 0;border:1px solid #2a3a5e;border-radius:8px;background:#111a30;overflow:hidden;}
      .ti-group-head{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#16213e;border-bottom:1px solid #2a3a5e;}
      .ti-group-head strong{color:#e6ecf7;font-size:13px;}
      .ti-count{margin-left:auto;color:#93a8cc;font-size:11px;}
      .ti-row{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid #1e2b47;}
      .ti-row:last-child{border-bottom:none;}
      .ti-cell{min-width:0;}
      .ti-point{flex:0 0 200px;font-size:12px;color:#c6d4f0;line-height:1.7;}
      .ti-unbound{color:#c07a9a;font-size:11px;}
      .ti-name-wrap{flex:0 0 220px;display:flex;flex-direction:column;gap:4px;}
      .ti-name{background:#1a2440;color:#e6ecf7;border:1px solid #2f4168;border-radius:3px;padding:5px 8px;font-size:12px;width:100%;box-sizing:border-box;}
      .ti-id{color:#5a6a8a;font-size:11px;}
      .ti-steps{flex:1;display:flex;flex-direction:column;gap:4px;}
      .ti-step{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
      .ti-step select{background:#1a2440;color:#dbe6ff;border:1px solid #2f4168;border-radius:3px;padding:4px 6px;font-size:11px;max-width:180px;}
      .ti-step button{background:#26304e;border:1px solid #33446e;color:#c3d2f0;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:11px;}
      .ti-step button:hover{background:#34406a;color:#fff;}
      .ti-step-del:hover{background:#7e3a3a !important;border-color:#7e3a3a !important;color:#fff !important;}
      .ti-step-params{color:#7c92bd;font-size:11px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .ti-step-add{opacity:.85;}
      .ti-locked{color:#93a8cc;font-size:11px;padding:2px 0;}
      .ti-ops{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;gap:6px;}
      .ti-once{display:flex;align-items:center;gap:4px;color:#93a8cc;font-size:11px;cursor:pointer;}
      .ti-edit,.ti-del{background:#26304e;border:1px solid #3a4a7e;color:#bcd;border-radius:3px;padding:3px 9px;cursor:pointer;font-size:11px;}
      .ti-edit:hover{background:#34406a;color:#fff;}
      .ti-del:hover{background:#7e3a3a;color:#fff;}
    `;
    document.head.appendChild(style);
  }
}

export default TriggerInteractionPanel;
