const asList = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();

/**
 * Tutorial 详情编辑器；只管理本定义与 steps[]（全 Trigger 化，不再有 FlowGroup 归属）。
 *
 * 依赖注入（不再耦合 TriggerEditor 实例）：constructor(deps) 接受
 *   - getScenes(): 场景列表 [{id,name}]（场景 scope 下拉候选）
 *   - getProject(): 项目数据（create() 时基于 project.tutorials 生成稳定 ID）
 *   - status(message, kind): 状态栏消息（拖动排序提示等）
 *   - nextStableId(prefix, definitions): 稳定 ID 生成（缺省内置 prefix-001 递增实现）
 *   - bindJsonValidation(el, allowEmpty): JSON textarea 实时校验（缺省内置等价实现）
 * 通用转义/解析为内置默认实现（escapeHtml/parseJson），宿主可经 deps 覆盖以完全对齐自身行为。
 */
export class TutorialEditorPanel {
  constructor(deps = {}) {
    this.deps = deps;
  }

  render(panel, tutorial) {
    const escape = value => this._escapeHtml(value);
    const scopedSceneIds = new Set(asList(tutorial.scope?.sceneIds));
    const scenes = new Map();
    for (const scene of (this.deps.getScenes?.() || [])) {
      if (scene?.id) scenes.set(scene.id, scene.name || scene.id);
    }
    for (const sceneId of scopedSceneIds) {
      if (!scenes.has(sceneId)) scenes.set(sceneId, `${sceneId}（旧引用）`);
    }
    const sceneOptions = [...scenes].map(([sceneId, name]) => (
      `<option value="${escape(sceneId)}"${scopedSceneIds.has(sceneId) ? ' selected' : ''}>${escape(name)}</option>`
    )).join('');
    const stepsHtml = asList(tutorial.steps).map((step, index) => this._renderStep(step, index)).join('');

    panel.innerHTML = `
      <div class="trg-definition-heading">
        <strong>Tutorial 教学表现</strong>
        <span>展示必须由事件 action 显式调用 tutorial.command(show, tutorialId)</span>
      </div>
      <div class="row"><label>ID</label><input type="text" id="d-tutorial-id" value="${escape(tutorial.id || '')}"></div>
      <div class="row"><label>标题</label><input type="text" id="d-tutorial-title" value="${escape(tutorial.title || '')}"></div>
      <div class="row"><label>说明</label><textarea id="d-tutorial-description">${escape(tutorial.description || '')}</textarea></div>
      <div class="row"><label>开场提示 beginText（教程弹出时展示，与步骤独立）</label><textarea id="d-tutorial-begin-text">${escape(tutorial.beginText || '')}</textarea></div>
      <div class="row"><label>收场提示 endText（教程完成时展示）</label><textarea id="d-tutorial-end-text">${escape(tutorial.endText || '')}</textarea></div>
      <div class="row"><label>场景 scope（教程展示作用域）</label><select id="d-tutorial-scenes" multiple size="${Math.min(7, Math.max(3, scenes.size))}">${sceneOptions}</select></div>
      <div class="row"><label>分类 category</label><input type="text" id="d-tutorial-category" value="${escape(tutorial.category || 'general')}"></div>
      <div class="row"><label>完成策略</label><select id="d-tutorial-policy">
        <option value="allSteps"${tutorial.completionPolicy === 'allSteps' ? ' selected' : ''}>完成全部步骤</option>
        <option value="signal"${tutorial.completionPolicy === 'signal' ? ' selected' : ''}>等待领域信号</option>
        <option value="manual"${tutorial.completionPolicy === 'manual' ? ' selected' : ''}>显式完成</option>
      </select></div>
      <div class="row trg-inline-options">
        <label><input type="checkbox" id="d-tutorial-pause"${tutorial.pauseGame === true ? ' checked' : ''}> 暂停游戏</label>
        <label><input type="checkbox" id="d-tutorial-skip"${tutorial.canSkip !== false ? ' checked' : ''}> 可跳过</label>
      </div>
      <div class="row"><label>展示入口</label><div class="do-result-semantics">只允许 Trigger 事件动作 <code>tutorial.command</code> 以 <code>operation: "show"</code> 和稳定 <code>tutorialId</code> 显式展示；场景加载、读档、帧更新和上一教程完成均不会自动弹出。</div></div>
      <div class="row"><label>展示优先级 priority（高值先展示）</label><input type="number" id="d-tutorial-priority" value="${Number(tutorial.priority || 0)}"></div>
      <div class="row"><label>信号规则 signalRules（JSON 数组，可空）</label><textarea id="d-tutorial-signals">${tutorial.signalRules ? escape(JSON.stringify(tutorial.signalRules, null, 2)) : ''}</textarea></div>
      <div class="row"><label>移动规则 movementRule（JSON 对象，可空）</label><textarea id="d-tutorial-movement">${tutorial.movementRule ? escape(JSON.stringify(tutorial.movementRule, null, 2)) : ''}</textarea></div>
      <div class="row">
        <label>教学步骤 steps[]（严格按此顺序）</label>
        <div id="d-tutorial-steps">${stepsHtml || '<div class="trg-empty compact">暂无教学步骤</div>'}</div>
        <button type="button" class="trg-mini" id="d-add-tutorial-step">+ 添加步骤</button>
      </div>
    `;

    this._bindJsonValidation(panel.querySelector('#d-tutorial-signals'), true);
    this._bindJsonValidation(panel.querySelector('#d-tutorial-movement'), true);
    this._bindSteps(panel, tutorial);
    panel.querySelector('#d-add-tutorial-step')?.addEventListener('click', () => {
      this.commit(tutorial, panel);
      tutorial.steps = asList(tutorial.steps);
      tutorial.steps.push({
        id: this._nextStableId(`${tutorial.id || 'tutorial'}-step`, tutorial.steps),
        text: '新教学步骤'
      });
      this.render(panel, tutorial);
    });
  }

  commit(tutorial, panel) {
    if (!tutorial || !panel?.querySelector('#d-tutorial-id')) return false;
    tutorial.id = text(panel.querySelector('#d-tutorial-id').value) || tutorial.id;
    tutorial.title = text(panel.querySelector('#d-tutorial-title').value) || tutorial.id;
    const description = text(panel.querySelector('#d-tutorial-description').value);
    if (description) tutorial.description = description;
    else delete tutorial.description;
    tutorial.beginText = text(panel.querySelector('#d-tutorial-begin-text').value) || tutorial.beginText || undefined;
    if (!tutorial.beginText) delete tutorial.beginText;
    tutorial.endText = text(panel.querySelector('#d-tutorial-end-text').value) || tutorial.endText || undefined;
    if (!tutorial.endText) delete tutorial.endText;
    tutorial.category = text(panel.querySelector('#d-tutorial-category').value) || 'general';
    tutorial.completionPolicy = panel.querySelector('#d-tutorial-policy').value || 'allSteps';
    tutorial.pauseGame = panel.querySelector('#d-tutorial-pause').checked;
    tutorial.canSkip = panel.querySelector('#d-tutorial-skip').checked;
    tutorial.autoTrigger = false;
    tutorial.autoAdvance = false;
    tutorial.priority = Number(panel.querySelector('#d-tutorial-priority').value) || 0;
    const sceneIds = [...panel.querySelector('#d-tutorial-scenes').selectedOptions]
      .map(option => text(option.value)).filter(Boolean);
    if (sceneIds.length) tutorial.scope = { ...(tutorial.scope || {}), sceneIds: [...new Set(sceneIds)] };
    else delete tutorial.scope;
    this._commitJson(tutorial, 'signalRules', panel.querySelector('#d-tutorial-signals').value, []);
    this._commitJson(tutorial, 'movementRule', panel.querySelector('#d-tutorial-movement').value, {});

    const previousSteps = asList(tutorial.steps);
    tutorial.steps = [...panel.querySelectorAll('.trg-tutorial-step')].map((element, index) => {
      const previous = previousSteps[index] || {};
      const next = {
        ...previous,
        id: text(element.querySelector('.tutorial-step-id').value) || previous.id,
        text: text(element.querySelector('.tutorial-step-text').value) || previous.text || '教学步骤'
      };
      this._assignOptional(next, 'image', element.querySelector('.tutorial-step-image').value);
      this._assignOptional(next, 'target', element.querySelector('.tutorial-step-target').value);
      this._assignOptional(next, 'position', element.querySelector('.tutorial-step-position').value);
      this._assignOptional(next, 'arrow', element.querySelector('.tutorial-step-arrow').value);
      next.highlightTarget = element.querySelector('.tutorial-step-highlight').checked;
      return next;
    });
    return true;
  }

  create(preferredSceneId = '') {
    const tutorials = this.deps.getProject?.()?.tutorials || [];
    const id = this._nextStableId('tutorial', tutorials);
    return {
      id,
      title: '新教学',
      description: '',
      beginText: '',
      endText: '',
      category: 'general',
      scope: { sceneIds: text(preferredSceneId) ? [text(preferredSceneId)] : [] },
      steps: [{ id: `${id}-step-001`, text: '提示文本' }],
      completionPolicy: 'allSteps',
      pauseGame: false,
      canSkip: true,
      autoTrigger: false,
      autoAdvance: false,
      priority: 0
    };
  }

  validate(tutorials, _eventIds) {
    const errors = [];
    const ids = new Set();
    asList(tutorials).forEach((tutorial, index) => {
      const path = `tutorials[${index}]`;
      const id = text(tutorial?.id);
      if (!id) errors.push(`${path}.id 不能为空`);
      else if (ids.has(id)) errors.push(`${path}.id 重复: ${id}`);
      else ids.add(id);
      if (!text(tutorial?.title)) errors.push(`${path}.title 不能为空`);
      if (tutorial?.autoTrigger === true) errors.push(`${path}.autoTrigger 不允许自动触发，请使用事件 action 显式展示`);
      if (tutorial?.autoAdvance === true) errors.push(`${path}.autoAdvance 不允许自动推进，请由下一事件显式展示`);
      if (!asList(tutorial?.steps).length) errors.push(`${path}.steps 至少需要一个步骤`);
      asList(tutorial?.steps).forEach((step, stepIndex) => {
        if (!text(step?.text)) errors.push(`${path}.steps[${stepIndex}].text 不能为空`);
      });
    });
    return errors;
  }

  _renderStep(step, index) {
    const escape = value => this._escapeHtml(value);
    return `
      <div class="trg-tutorial-step" data-step-index="${index}">
        <div class="do-head">
          <button type="button" class="tutorial-step-drag do-drag-handle" draggable="true" title="拖动调整教学步骤顺序">↕</button>
          <strong>步骤 ${index + 1}</strong>
          <button type="button" class="trg-mini tutorial-step-delete">删</button>
        </div>
        <div class="tutorial-step-grid">
          <label>稳定 ID<input class="tutorial-step-id" value="${escape(step.id || '')}"></label>
          <label>位置<input class="tutorial-step-position" value="${escape(step.position || '')}" placeholder="center/top/bottom"></label>
          <label class="wide">教学文本<textarea class="tutorial-step-text">${escape(step.text || '')}</textarea></label>
          <label>图片 ID<input class="tutorial-step-image" value="${escape(step.image || '')}"></label>
          <label>目标<input class="tutorial-step-target" value="${escape(step.target || '')}"></label>
          <label>箭头<input class="tutorial-step-arrow" value="${escape(step.arrow || '')}"></label>
          <label class="check"><input type="checkbox" class="tutorial-step-highlight"${step.highlightTarget ? ' checked' : ''}> 高亮目标</label>
        </div>
      </div>`;
  }

  _bindSteps(panel, tutorial) {
    let draggedIndex = null;
    const clear = () => panel.querySelectorAll('.trg-tutorial-step').forEach(element => {
      element.classList.remove('drop-before', 'drop-after', 'dragging');
      delete element.dataset.dropPosition;
    });
    panel.querySelectorAll('.trg-tutorial-step').forEach(element => {
      const handle = element.querySelector('.tutorial-step-drag');
      handle.addEventListener('dragstart', event => {
        this.commit(tutorial, panel);
        draggedIndex = Number(element.dataset.stepIndex);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(draggedIndex));
        requestAnimationFrame(() => element.classList.add('dragging'));
      });
      element.addEventListener('dragover', event => {
        const targetIndex = Number(element.dataset.stepIndex);
        if (!Number.isInteger(draggedIndex) || draggedIndex === targetIndex) return;
        event.preventDefault();
        const placeAfter = event.clientY >= element.getBoundingClientRect().top + element.offsetHeight / 2;
        clear();
        element.dataset.dropPosition = placeAfter ? 'after' : 'before';
        element.classList.add(placeAfter ? 'drop-after' : 'drop-before');
      });
      element.addEventListener('drop', event => {
        event.preventDefault();
        const targetIndex = Number(element.dataset.stepIndex);
        const placeAfter = element.dataset.dropPosition === 'after';
        const fromIndex = draggedIndex;
        draggedIndex = null;
        clear();
        this._moveStep(tutorial, fromIndex, targetIndex, placeAfter);
        this.render(panel, tutorial);
      });
      handle.addEventListener('dragend', () => { draggedIndex = null; clear(); });
      element.querySelector('.tutorial-step-delete').addEventListener('click', () => {
        this.commit(tutorial, panel);
        tutorial.steps.splice(Number(element.dataset.stepIndex), 1);
        this.render(panel, tutorial);
      });
    });
  }

  _moveStep(tutorial, fromIndex, targetIndex, placeAfter) {
    if (!Number.isInteger(fromIndex) || !Number.isInteger(targetIndex) || fromIndex === targetIndex) return false;
    const steps = asList(tutorial.steps);
    if (!steps[fromIndex] || !steps[targetIndex]) return false;
    const [step] = steps.splice(fromIndex, 1);
    let insertionIndex = targetIndex + (placeAfter ? 1 : 0);
    if (fromIndex < insertionIndex) insertionIndex -= 1;
    steps.splice(insertionIndex, 0, step);
    tutorial.steps = steps;
    this.deps.status?.(`已调整 ${tutorial.title || tutorial.id} 的 steps[] 顺序，请保存到工程`, 'ok');
    return true;
  }

  _assignOptional(owner, field, value) {
    const normalized = text(value);
    if (normalized) owner[field] = normalized;
    else delete owner[field];
  }

  _commitJson(owner, field, source, emptyFallback) {
    const value = text(source);
    if (!value) {
      delete owner[field];
      return;
    }
    const parsed = this._parseJson(value, owner[field] ?? emptyFallback);
    owner[field] = parsed;
  }

  // ── 内置默认工具（与宿主编辑器语义一致；deps 可覆盖）──

  _escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  _parseJson(str, fallback) {
    if (!str || !str.trim()) return fallback;
    try { return JSON.parse(str); }
    catch (e) { this.deps.status?.('JSON 解析错误: ' + e.message, 'err'); return fallback; }
  }

  _nextStableId(prefix, definitions = []) {
    if (typeof this.deps.nextStableId === 'function') return this.deps.nextStableId(prefix, definitions);
    const ids = new Set((definitions || []).map(definition => definition?.id).filter(Boolean));
    let sequence = 1;
    let candidate = '';
    do candidate = `${prefix}-${String(sequence++).padStart(3, '0')}`;
    while (ids.has(candidate));
    return candidate;
  }

  _bindJsonValidation(el, allowEmpty) {
    if (typeof this.deps.bindJsonValidation === 'function') return this.deps.bindJsonValidation(el, allowEmpty);
    if (!el) return;
    const check = () => {
      const v = el.value.trim();
      if (!v) {
        el.style.borderColor = allowEmpty ? '#2a3a5e' : '#c62828';
        el.title = allowEmpty ? '' : '不能为空';
        return true;
      }
      try {
        JSON.parse(v);
        el.style.borderColor = '#4a8a4a';
        el.title = 'JSON 格式正确';
        return true;
      } catch (e) {
        el.style.borderColor = '#e05252';
        el.title = 'JSON 格式错误: ' + e.message + '\n（注意用半角引号 " 和大括号 {}）';
        return false;
      }
    };
    el.addEventListener('input', check);
    check();
  }
}

export default TutorialEditorPanel;
