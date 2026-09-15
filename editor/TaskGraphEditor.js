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

const NODE_TYPES = Object.freeze(['start', 'objective', 'sequence', 'parallel', 'branch', 'complete', 'fail']);
const JOIN_POLICIES = Object.freeze(['all', 'any', 'count']);
const clone = value => structuredClone(value);
const list = value => Array.isArray(value) ? value : [];
const stableId = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._-]*$/.test(value);

/**
 * TaskGraphSystem 定义的薄 UI 适配器。
 * 只拥有 project.taskGraphs 根字段的编辑草稿，提交统一委托共享 CanonicalEditorSession。
 */
export class TaskGraphEditor {
  constructor(container, { canonicalSession, projectPath = '' } = {}) {
    if (!(container instanceof HTMLElement)) throw new TypeError('TaskGraphEditor requires a container element');
    if (!canonicalSession) throw new TypeError('TaskGraphEditor requires a shared CanonicalEditorSession');
    this.container = container;
    this.canonicalSession = canonicalSession;
    this.projectPath = projectPath || canonicalSession.sourceUri;
    this.taskGraphs = [];
    this.selectedIndex = -1;
    this.invalidJsonFields = new Set();
    this._initialized = false;
  }

  async init() {
    if (!this._initialized) {
      this._initialized = true;
      this._injectStyles();
      this._buildUI();
    }
    this._load();
    this._render();
    return this;
  }

  _load() {
    const project = this.canonicalSession.getValue();
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      throw new Error('TaskGraphEditor: canonical project candidate 不可用');
    }
    this.taskGraphs = list(project.taskGraphs).map(clone);
    if (this.selectedIndex >= this.taskGraphs.length) this.selectedIndex = this.taskGraphs.length - 1;
  }

  async save() {
    if (this.invalidJsonFields.size > 0) {
      const message = '存在 JSON 格式错误，请修正红框字段后再保存';
      this._status(`❌ ${message}`, 'error');
      this._toast(message, 'error');
      return { ok: false, committed: false, status: 'rejected', code: 'invalidJson' };
    }
    const validation = this._validateDefinitions();
    if (!validation.ok) {
      this._status(`❌ ${validation.message}`, 'error');
      this._toast(validation.message, 'error');
      return { ok: false, committed: false, status: 'rejected', code: validation.code };
    }
    try {
      this.canonicalSession.patch('taskGraphs', clone(this.taskGraphs));
      const result = await this.canonicalSession.save();
      if (result?.ok === true && result.committed === true) {
        const message = result.degraded
          ? '磁盘已提交，但缓存或通知同步降级'
          : `已保存 ${this.taskGraphs.length} 个任务图`;
        this._status(`${result.degraded ? '⚠️' : '✅'} ${message}`, result.degraded ? 'warn' : 'ok');
        this._toast(message, result.degraded ? 'warn' : 'success');
        return result;
      }
      const message = this._saveError(result);
      this._status(`❌ 保存失败：${message}`, 'error');
      this._toast(`保存失败：${message}`, 'error');
      return result;
    } catch (error) {
      const result = error?.result || { ok: false, committed: false, status: 'failed', error };
      this._status(`❌ 保存失败：${error.message}`, 'error');
      this._toast(`保存失败：${error.message}`, 'error');
      return result;
    }
  }

  _buildUI() {
    this.container.innerHTML = `
      <div class="tge-root">
        <div class="tge-toolbar">
          <button type="button" data-action="add-task">+ 新建任务</button>
          <button type="button" data-action="delete-task" class="danger">删除任务</button>
          <button type="button" data-action="save" class="primary">保存到工程</button>
          <span class="tge-hint">${this._escape(this.projectPath)} · taskGraphs</span>
        </div>
        <div class="tge-main">
          <aside class="tge-list" data-role="task-list"></aside>
          <section class="tge-detail" data-role="task-detail"></section>
        </div>
        <div class="tge-status" data-role="status"></div>
      </div>`;
    this.container.querySelector('[data-action="add-task"]').addEventListener('click', () => this._addTask());
    this.container.querySelector('[data-action="delete-task"]').addEventListener('click', () => this._deleteTask());
    this.container.querySelector('[data-action="save"]').addEventListener('click', async () => { await this.save(); });
  }

  _render() {
    this._renderList();
    this._renderDetail();
  }

  _renderList() {
    const target = this.container.querySelector('[data-role="task-list"]');
    if (!target) return;
    if (this.taskGraphs.length === 0) {
      target.innerHTML = '<div class="tge-empty">暂无任务图<br>点击“+ 新建任务”开始</div>';
      return;
    }
    target.innerHTML = this.taskGraphs.map((task, index) => `
      <button type="button" class="tge-task ${index === this.selectedIndex ? 'active' : ''}" data-task-index="${index}">
        <strong>${this._escape(task.title || task.id || '未命名任务')}</strong>
        <small>${this._escape(task.id || '缺少 id')} · ${list(task.nodes).length} 节点</small>
      </button>`).join('');
    target.querySelectorAll('[data-task-index]').forEach(button => button.addEventListener('click', () => {
      this.selectedIndex = Number(button.dataset.taskIndex);
      this.invalidJsonFields.clear();
      this._render();
    }));
  }

  _renderDetail() {
    const target = this.container.querySelector('[data-role="task-detail"]');
    const task = this._task();
    if (!target) return;
    if (!task) {
      target.innerHTML = '<div class="tge-empty">选择或新建一个任务图</div>';
      return;
    }
    const nodeIds = list(task.nodes).map(node => node?.id).filter(Boolean);
    target.innerHTML = `
      <div class="tge-header-grid">
        <div class="tge-field"><label>任务 ID</label><input data-task-field="id" value="${this._escape(task.id || '')}" placeholder="task.main.example"></div>
        <div class="tge-field"><label>标题</label><input data-task-field="title" value="${this._escape(task.title || '')}" placeholder="任务标题"></div>
        <div class="tge-field"><label>分类</label><input data-task-field="category" value="${this._escape(task.category || 'main')}" placeholder="main"></div>
        <div class="tge-field"><label>入口节点</label><select data-task-field="entryNodeId">${this._nodeOptions(nodeIds, task.entryNodeId)}</select></div>
      </div>
      <div class="tge-node-toolbar">
        <h3>节点列表（${list(task.nodes).length}）</h3>
        <button type="button" data-action="add-node">+ 新建节点</button>
      </div>
      <div class="tge-nodes">
        ${list(task.nodes).map((node, index) => this._nodeCard(node, index, nodeIds)).join('') || '<div class="tge-empty compact">暂无节点</div>'}
      </div>`;
    target.querySelectorAll('[data-task-field]').forEach(input => input.addEventListener('change', () => {
      this._updateTaskField(input.dataset.taskField, input.value);
    }));
    target.querySelector('[data-action="add-node"]')?.addEventListener('click', () => this._addNode());
    target.querySelectorAll('[data-node-index]').forEach(card => this._bindNodeCard(card));
  }

  _nodeCard(node, index, nodeIds) {
    const isObjective = node.type === 'objective';
    const isParallel = node.type === 'parallel';
    const isBranch = node.type === 'branch';
    return `
      <article class="tge-node" data-node-index="${index}">
        <div class="tge-node-head">
          <strong>节点 ${index + 1}</strong>
          <button type="button" class="danger" data-action="delete-node">删除节点</button>
        </div>
        <div class="tge-node-grid">
          <div class="tge-field"><label>节点 ID</label><input data-node-field="id" value="${this._escape(node.id || '')}" placeholder="node.start"></div>
          <div class="tge-field"><label>类型</label><select data-node-field="type">${NODE_TYPES.map(type => `<option value="${type}" ${node.type === type ? 'selected' : ''}>${type}</option>`).join('')}</select></div>
          <div class="tge-field full"><label>next 边（逗号分隔节点 ID）</label><input data-node-list="next" value="${this._escape(list(node.next).join(', '))}" placeholder="node.next, node.complete"><small>可直接输入目标节点 ID；保存前会校验引用。</small></div>
        </div>
        ${isObjective ? `
          <div class="tge-json-field">
            <label>objective eventMatcher（JSON）</label>
            <textarea data-node-json="eventMatcher" rows="4" placeholder='{"type":"enemyDefeated","payload":{"enemyId":"..."}}'>${this._escape(this._json(node.eventMatcher || {}))}</textarea>
          </div>` : ''}
        ${isParallel ? `
          <div class="tge-node-grid tge-parallel">
            <div class="tge-field full"><label>parallel children（逗号分隔节点 ID）</label><input data-node-list="children" value="${this._escape(list(node.children).join(', '))}" placeholder="node.collect, node.defeat"></div>
            <div class="tge-field"><label>joinPolicy</label><select data-node-field="joinPolicy">${JOIN_POLICIES.map(policy => `<option value="${policy}" ${(node.joinPolicy || 'all') === policy ? 'selected' : ''}>${policy}</option>`).join('')}</select></div>
            <div class="tge-field"><label>requiredCount（count 策略必填）</label><input type="number" min="1" step="1" data-node-number="requiredCount" value="${Number.isInteger(node.requiredCount) ? node.requiredCount : ''}" placeholder="1"></div>
          </div>` : ''}
        ${isBranch ? `
          <div class="tge-json-field">
            <label>branch branches（JSON 数组）</label>
            <textarea data-node-json="branches" rows="7" placeholder='[{"id":"success","allCompleted":["node.objective"],"targetNodeId":"node.complete"}]'>${this._escape(this._json(list(node.branches)))}</textarea>
            <small>每项可使用 id、allCompleted、countCompleted: { nodes, gte }、targetNodeId。</small>
          </div>` : ''}
      </article>`;
  }

  _bindNodeCard(card) {
    const index = Number(card.dataset.nodeIndex);
    card.querySelector('[data-action="delete-node"]')?.addEventListener('click', () => this._deleteNode(index));
    card.querySelectorAll('[data-node-field]').forEach(input => input.addEventListener('change', () => {
      this._updateNodeField(index, input.dataset.nodeField, input.value);
    }));
    card.querySelectorAll('[data-node-list]').forEach(input => input.addEventListener('change', () => {
      this._updateNodeField(index, input.dataset.nodeList, this._splitIds(input.value));
    }));
    card.querySelectorAll('[data-node-number]').forEach(input => input.addEventListener('change', () => {
      const value = input.value === '' ? undefined : Number(input.value);
      this._updateNodeField(index, input.dataset.nodeNumber, value);
    }));
    card.querySelectorAll('[data-node-json]').forEach(input => input.addEventListener('input', () => {
      this._updateJsonField(index, input.dataset.nodeJson, input);
    }));
  }

  _addTask() {
    const id = prompt('任务 ID（英文稳定标识）：', this._nextId('task'))?.trim();
    if (!id) return;
    if (!stableId(id)) return this._toast('任务 ID 只能使用字母开头的字母、数字、点、下划线和短横线', 'error');
    if (this.taskGraphs.some(task => task?.id === id)) return this._toast(`任务 ID 已存在：${id}`, 'error');
    const title = prompt('任务标题：', id)?.trim() || id;
    this.taskGraphs.push({
      id,
      title,
      category: 'main',
      entryNodeId: `${id}.start`,
      nodes: [{ id: `${id}.start`, type: 'start', next: [] }]
    });
    this.selectedIndex = this.taskGraphs.length - 1;
    this.invalidJsonFields.clear();
    this._render();
  }

  _deleteTask() {
    const task = this._task();
    if (!task) return;
    if (!confirm(`确定删除任务图“${task.title || task.id}”吗？`)) return;
    this.taskGraphs.splice(this.selectedIndex, 1);
    this.selectedIndex = Math.min(this.selectedIndex, this.taskGraphs.length - 1);
    this.invalidJsonFields.clear();
    this._render();
  }

  _addNode() {
    const task = this._task();
    if (!task) return;
    const id = `${task.id || 'task'}.node.${list(task.nodes).length + 1}`;
    task.nodes = list(task.nodes);
    task.nodes.push({ id, type: 'objective', next: [], eventMatcher: {} });
    this._renderDetail();
  }

  _deleteNode(index) {
    const task = this._task();
    const node = list(task?.nodes)[index];
    if (!node) return;
    if (!confirm(`确定删除节点“${node.id || index + 1}”吗？`)) return;
    task.nodes.splice(index, 1);
    this._removeNodeReferences(task, node.id);
    if (task.entryNodeId === node.id) task.entryNodeId = task.nodes[0]?.id || '';
    this.invalidJsonFields.clear();
    this._renderDetail();
  }

  _updateTaskField(field, value) {
    const task = this._task();
    if (!task) return;
    if (field === 'id' && value !== task.id) {
      if (!stableId(value)) return this._toast('任务 ID 格式无效', 'error');
      if (this.taskGraphs.some(item => item !== task && item?.id === value)) return this._toast(`任务 ID 已存在：${value}`, 'error');
    }
    task[field] = value;
    this._renderList();
  }

  _updateNodeField(index, field, value) {
    const task = this._task();
    const node = list(task?.nodes)[index];
    if (!node) return;
    if (field === 'id' && value !== node.id) {
      if (!stableId(value)) return this._toast('节点 ID 格式无效', 'error');
      if (task.nodes.some(item => item !== node && item?.id === value)) return this._toast(`节点 ID 已存在：${value}`, 'error');
      this._replaceNodeReferences(task, node.id, value);
    }
    if (field === 'type' && !NODE_TYPES.includes(value)) return;
    if (field === 'joinPolicy' && !JOIN_POLICIES.includes(value)) return;
    if (field === 'requiredCount' && value !== undefined && (!Number.isInteger(value) || value < 1)) return;
    if (value === undefined) delete node[field];
    else node[field] = clone(value);
    if (field === 'type') this._renderDetail();
    else if (field === 'id') this._renderDetail();
  }

  _updateJsonField(index, field, input) {
    const node = list(this._task()?.nodes)[index];
    if (!node) return;
    const key = `${index}:${field}`;
    try {
      const value = JSON.parse(input.value);
      if (field === 'eventMatcher' && (!value || typeof value !== 'object' || Array.isArray(value))) throw new TypeError('eventMatcher 必须是 JSON 对象');
      if (field === 'branches' && !Array.isArray(value)) throw new TypeError('branches 必须是 JSON 数组');
      node[field] = value;
      this.invalidJsonFields.delete(key);
      input.classList.remove('invalid');
      input.title = '';
    } catch (error) {
      this.invalidJsonFields.add(key);
      input.classList.add('invalid');
      input.title = error.message;
    }
  }

  _replaceNodeReferences(task, oldId, newId) {
    if (task.entryNodeId === oldId) task.entryNodeId = newId;
    for (const node of list(task.nodes)) {
      node.next = list(node.next).map(id => id === oldId ? newId : id);
      if (node.type === 'parallel') node.children = list(node.children).map(id => id === oldId ? newId : id);
      if (node.type === 'branch') {
        node.branches = list(node.branches).map(branch => ({
          ...branch,
          allCompleted: list(branch?.allCompleted).map(id => id === oldId ? newId : id),
          countCompleted: branch?.countCompleted && typeof branch.countCompleted === 'object'
            ? { ...branch.countCompleted, nodes: list(branch.countCompleted.nodes).map(id => id === oldId ? newId : id) }
            : branch?.countCompleted,
          targetNodeId: branch?.targetNodeId === oldId ? newId : branch?.targetNodeId
        }));
      }
    }
  }

  _removeNodeReferences(task, nodeId) {
    for (const node of list(task.nodes)) {
      node.next = list(node.next).filter(id => id !== nodeId);
      if (node.type === 'parallel') node.children = list(node.children).filter(id => id !== nodeId);
      if (node.type === 'branch') {
        node.branches = list(node.branches).map(branch => ({
          ...branch,
          allCompleted: list(branch?.allCompleted).filter(id => id !== nodeId),
          countCompleted: branch?.countCompleted && typeof branch.countCompleted === 'object'
            ? { ...branch.countCompleted, nodes: list(branch.countCompleted.nodes).filter(id => id !== nodeId) }
            : branch?.countCompleted,
          targetNodeId: branch?.targetNodeId === nodeId ? '' : branch?.targetNodeId
        }));
      }
    }
  }

  _validateDefinitions() {
    const ids = new Set();
    for (const task of this.taskGraphs) {
      if (!stableId(task?.id) || ids.has(task.id)) return { ok: false, code: 'invalidTaskId', message: '任务 ID 缺失、格式无效或重复' };
      ids.add(task.id);
      const nodes = list(task.nodes);
      const nodeIds = new Set();
      for (const node of nodes) {
        if (!stableId(node?.id) || nodeIds.has(node.id)) return { ok: false, code: 'invalidTaskNodeId', message: `任务 ${task.id} 存在缺失、无效或重复的节点 ID` };
        if (!NODE_TYPES.includes(node.type)) return { ok: false, code: 'invalidTaskNodeType', message: `节点 ${node.id} 的类型无效` };
        nodeIds.add(node.id);
      }
      if (!nodeIds.has(task.entryNodeId)) return { ok: false, code: 'invalidTaskEntry', message: `任务 ${task.id} 的入口节点不存在` };
      for (const node of nodes) {
        if (list(node.next).some(targetId => !nodeIds.has(targetId))) return { ok: false, code: 'invalidTaskEdge', message: `节点 ${node.id} 的 next 引用了不存在的节点` };
        if (node.type === 'parallel') {
          const children = list(node.children);
          if (children.length === 0 || children.some(id => !nodeIds.has(id))) return { ok: false, code: 'invalidParallelChildren', message: `并行节点 ${node.id} 的 children 不能为空且必须存在` };
          const policy = node.joinPolicy || 'all';
          if (!JOIN_POLICIES.includes(policy)) return { ok: false, code: 'invalidParallelJoin', message: `并行节点 ${node.id} 的 joinPolicy 无效` };
          if (policy === 'count' && (!Number.isInteger(node.requiredCount) || node.requiredCount < 1 || node.requiredCount > children.length)) return { ok: false, code: 'invalidParallelCount', message: `并行节点 ${node.id} 的 requiredCount 必须在 children 数量范围内` };
        }
        if (node.type === 'branch' && list(node.branches).length === 0) return { ok: false, code: 'invalidBranchRules', message: `分支节点 ${node.id} 至少需要一条 branches 规则` };
      }
    }
    return { ok: true };
  }

  _task() { return this.taskGraphs[this.selectedIndex] || null; }
  _nextId(prefix) {
    let index = 1;
    while (this.taskGraphs.some(task => task?.id === `${prefix}.${index}`)) index += 1;
    return `${prefix}.${index}`;
  }
  _splitIds(value) { return String(value).split(',').map(id => id.trim()).filter(Boolean); }
  _nodeOptions(ids, selected) { return ids.map(id => `<option value="${this._escape(id)}" ${id === selected ? 'selected' : ''}>${this._escape(id)}</option>`).join(''); }
  _json(value) { return JSON.stringify(value, null, 2); }
  _escape(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
  _saveError(result) {
    const first = result?.errors?.[0];
    return [first?.path, first?.message || first?.reason].filter(Boolean).join(': ')
      || result?.error?.message || result?.error || '磁盘未提交';
  }
  _status(message, kind = '') {
    const target = this.container.querySelector('[data-role="status"]');
    if (target) { target.textContent = message; target.className = `tge-status ${kind}`; }
  }
  _toast(message, type = 'success') {
    let target = document.getElementById('tge-toast');
    if (!target) {
      target = document.createElement('div');
      target.id = 'tge-toast';
      target.className = 'tge-toast';
      document.body.appendChild(target);
    }
    target.textContent = message;
    target.dataset.type = type;
    target.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => target.classList.remove('visible'), 2600);
  }

  _injectStyles() {
    if (document.getElementById('tge-styles')) return;
    const style = document.createElement('style');
    style.id = 'tge-styles';
    style.textContent = `
      .tge-root{height:100%;display:flex;flex-direction:column;background:#0d1326;color:#fff;font-size:13px}.tge-toolbar{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#16213e;border-bottom:1px solid #2a3a5e}.tge-toolbar button,.tge-node-toolbar button{padding:7px 12px;border:0;border-radius:4px;background:#3a4a7e;color:#fff;cursor:pointer}.tge-toolbar .primary{background:#4caf50;color:#102010;font-weight:bold}.tge-toolbar .danger,.tge-node .danger{background:#7e3a3a}.tge-hint{margin-left:auto;color:#8aa;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tge-main{min-height:0;flex:1;display:flex;overflow:hidden}.tge-list{width:240px;flex:none;overflow:auto;background:#111a30;border-right:1px solid #2a3a5e}.tge-task{display:flex;width:100%;flex-direction:column;gap:3px;padding:10px 13px;text-align:left;color:#fff;background:transparent;border:0;border-bottom:1px solid #1e2b47;cursor:pointer}.tge-task:hover{background:#1a2540}.tge-task.active{background:#2a3a6e}.tge-task small{color:#9ab}.tge-detail{min-width:0;flex:1;overflow:auto;padding:16px}.tge-header-grid,.tge-node-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.tge-field{min-width:0}.tge-field.full{grid-column:1/-1}.tge-field label,.tge-json-field label{display:block;margin-bottom:4px;color:#9ab;font-size:12px}.tge-field input,.tge-field select,.tge-json-field textarea{width:100%;padding:7px;border:1px solid #2a3a5e;border-radius:3px;background:#0a1020;color:#fff;font:inherit}.tge-field small,.tge-json-field small{display:block;margin-top:4px;color:#789;font-size:11px}.tge-node-toolbar{display:flex;align-items:center;justify-content:space-between;margin:18px 0 10px}.tge-node-toolbar h3{font-size:14px}.tge-node{margin-bottom:12px;padding:12px;border:1px solid #2a3a5e;border-radius:6px;background:#0f1830}.tge-node-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.tge-node-head button{padding:4px 8px;border:0;border-radius:3px;color:#fff;cursor:pointer}.tge-json-field{margin-top:10px}.tge-json-field textarea{resize:vertical;font-family:Consolas,monospace;font-size:12px}.tge-json-field textarea.invalid{border-color:#e66;box-shadow:0 0 0 1px #e66}.tge-status{min-height:30px;padding:7px 16px;background:#0a1020;color:#9ab}.tge-status.ok{color:#6c6}.tge-status.warn{color:#e6bd5d}.tge-status.error{color:#e66}.tge-empty{padding:38px 16px;color:#789;text-align:center;line-height:1.7}.tge-empty.compact{padding:18px}.tge-toast{position:fixed;top:58px;left:50%;z-index:100000;max-width:min(600px,90vw);padding:10px 18px;border-radius:6px;background:#2e7d32;color:#fff;box-shadow:0 4px 16px #0008;opacity:0;pointer-events:none;transform:translate(-50%,-8px);transition:opacity .2s,transform .2s}.tge-toast[data-type="error"]{background:#c62828}.tge-toast[data-type="warn"]{background:#9a6700}.tge-toast.visible{opacity:1;transform:translate(-50%,0)}@media (max-width:800px){.tge-list{width:180px}.tge-header-grid,.tge-node-grid{grid-template-columns:1fr}.tge-field.full{grid-column:auto}.tge-hint{display:none}}
    `;
    document.head.appendChild(style);
  }
}

export default TaskGraphEditor;
