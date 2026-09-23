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

import { getFactOptions } from '../src/systems/quest/FactCatalog.js';

const clone = value => structuredClone(value);
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stableId = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._-]*$/.test(value);

/** 表单可编辑的字段；出现其它字段（variants/delayed/selector 等高级语义）时锁定表单、仅 JSON 模式。 */
const FORM_FIELDS = new Set(['commandType', 'id', 'name', 'transaction']);
const TRANSACTION_FIELDS = new Set(['when', 'writes', 'inventory', 'checkpoint', 'travel']);
const ADVANCED_FIELDS = ['selector', 'variants', 'variantDefinitions', 'delayed', 'onPreconditionFailed', 'stepId'];

const CONDITION_OPS = Object.freeze([
  ['equals', '等于'], ['gte', '不少于'], ['lte', '不超过']
]);
const WRITE_TARGETS = Object.freeze([
  ['story', '剧情（story）'], ['blackboard', '黑板（blackboard）'], ['city', '城市（city）']
]);

/**
 * StateTransactionEditor - 状态事务管理（编辑 project.commands[] 的 state.transaction 定义）
 *
 * 事实的唯一定义处：任务目标（commit.fact）、接取条件、奖励、触发器 do 都引用这里的 id。
 * 两种编辑模式：表单模式覆盖常用结构（when 条件 / writes 写入 / inventory 背包 / travel 传送 /
 * checkpoint 存档点），含高级字段（variants/delayed 等）的定义自动锁定表单、仅 JSON 源码编辑。
 * 保存经 canonicalSession.patch('commands') 统一提交。
 */
export class StateTransactionEditor {
  constructor(container, { canonicalSession, projectPath = '' } = {}) {
    if (!(container instanceof HTMLElement)) throw new TypeError('StateTransactionEditor requires a container element');
    if (!canonicalSession) throw new TypeError('StateTransactionEditor requires a shared CanonicalEditorSession');
    this.container = container;
    this.canonicalSession = canonicalSession;
    this.projectPath = projectPath || canonicalSession.sourceUri;
    this.project = null;
    this.commands = [];
    this.selectedId = null;
    this._dirty = false;
    this._jsonMode = new Set();      // 强制 JSON 模式的事务 id（含高级字段或用户切换）
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
      throw new Error('StateTransactionEditor: canonical project candidate 不可用');
    }
    this.project = project;
    this.commands = list(project.commands).map(clone);
    this._dirty = false;
    this._jsonMode = new Set();
    if (this.selectedId && !this.commands.some(command => command?.id === this.selectedId)) this.selectedId = null;
  }

  _buildUI() {
    this.container.innerHTML = `
      <div class="ste-root">
        <div class="ste-toolbar">
          <button type="button" class="primary" data-action="save">💾 保存到工程</button>
          <button type="button" data-action="add">+ 新建状态事务</button>
          <span class="ste-hint">状态事务 = 事实的唯一定义处（任务目标 / 接取条件 / 奖励 / 触发器都引用这里的 ID）</span>
        </div>
        <div class="ste-status" data-role="status"></div>
        <div class="ste-main">
          <div class="ste-list" data-role="transaction-list"></div>
          <div class="ste-detail" data-role="transaction-detail"></div>
        </div>
      </div>`;
    this.container.querySelector('[data-action="save"]')?.addEventListener('click', () => { void this.save(); });
    this.container.querySelector('[data-action="add"]')?.addEventListener('click', () => this._addTransaction());
  }

  _render() {
    this._renderList();
    this._renderDetail();
  }

  _renderList() {
    const target = this.container.querySelector('[data-role="transaction-list"]');
    if (!target) return;
    if (!this.commands.length) {
      target.innerHTML = '<div class="ste-empty">暂无状态事务<br>点击“+ 新建状态事务”开始</div>';
      return;
    }
    target.innerHTML = this.commands.map(command => {
      const active = command?.id && command.id === this.selectedId ? ' active' : '';
      return `
        <button type="button" class="ste-item${active}" data-transaction-id="${this._escape(command?.id || '')}">
          <span class="n">${this._escape(command?.name || command?.id || '（未命名）')}</span>
          <small>${this._escape(command?.id || '')}</small>
        </button>`;
    }).join('');
    target.querySelectorAll('[data-transaction-id]').forEach(button => button.addEventListener('click', () => {
      this.selectedId = button.dataset.transactionId;
      this._render();
    }));
  }

  _current() {
    return this.commands.find(command => command?.id === this.selectedId) || null;
  }

  _renderDetail() {
    const target = this.container.querySelector('[data-role="transaction-detail"]');
    if (!target) return;
    const command = this._current();
    if (!command) {
      target.innerHTML = '<div class="ste-empty">选择或新建一个状态事务</div>';
      return;
    }
    const advancedLocked = this._hasAdvancedFields(command) || this._jsonMode.has(command.id);
    target.innerHTML = `
      <div class="ste-detail-head">
        <strong>${this._escape(command.name || command.id)}</strong>
        <button type="button" class="danger" data-action="delete-transaction">删除</button>
      </div>
      ${advancedLocked ? this._jsonEditorHtml(command) : this._formHtml(command)}
      <button type="button" data-action="toggle-mode">${advancedLocked ? '✎ 切换到表单模式' : '{ } 切换到 JSON 源码'}</button>`;
    this._bindDetail(command, advancedLocked);
  }

  _hasAdvancedFields(command) {
    const extraTop = Object.keys(command).some(key => !FORM_FIELDS.has(key));
    const transaction = command.transaction || {};
    const extraTx = Object.keys(transaction).some(key => !TRANSACTION_FIELDS.has(key));
    return extraTop || extraTx;
  }

  _formHtml(command) {
    const transaction = command.transaction || {};
    return `
      <div class="ste-grid">
        <div class="ste-field"><label>事务 ID（被任务目标/触发器引用，修改需同步引用处）</label><input data-ste-field="id" value="${this._escape(command.id || '')}"></div>
        <div class="ste-field"><label>中文名称（目录/下拉显示用）</label><input data-ste-field="name" value="${this._escape(command.name || '')}"></div>
      </div>
      <fieldset class="ste-block"><legend>触发条件（when，全部满足才执行）</legend>
        <div class="ste-rows" data-role="conditions">${this._conditionRowsHtml(transaction.when)}</div>
        <button type="button" data-action="add-condition">+ 添加条件</button>
      </fieldset>
      <fieldset class="ste-block"><legend>写入（writes，条件满足时执行）</legend>
        <div class="ste-rows" data-role="writes">${this._writeRowsHtml(transaction.writes)}</div>
        <button type="button" data-action="add-write">+ 添加写入</button>
      </fieldset>
      <fieldset class="ste-block"><legend>背包变更（inventory，可选）</legend>
        ${this._inventoryHtml(transaction.inventory)}
      </fieldset>
      <div class="ste-grid">
        <div class="ste-field"><label>切场景（travel，可选）</label><input data-ste-inv="travelSceneId" value="${this._escape(transaction.travel?.sceneId || '')}" placeholder="场景 ID，如 S02"></div>
        <div class="ste-field"><label>存档点（checkpoint，可选）</label><input data-ste-inv="checkpointId" value="${this._escape(transaction.checkpoint?.checkpointId || '')}" placeholder="留空不存档"></div>
      </div>`;
  }

  _conditionRowsHtml(when) {
    const rows = this._parseWhen(when);
    if (!rows.length) return '<small class="ste-muted">无条件（事件到达即执行）</small>';
    return rows.map((row, index) => `
      <div class="ste-row" data-condition-index="${index}">
        <select data-condition-field="kind">
          <option value="field" ${row.kind === 'field' ? 'selected' : ''}>字段比较</option>
          <option value="inventory" ${row.kind === 'inventory' ? 'selected' : ''}>背包持有</option>
        </select>
        ${row.kind === 'inventory' ? `
          <input data-condition-field="itemId" value="${this._escape(row.itemId || '')}" placeholder="物品 ID" title="物品 ID">
          <input data-condition-field="quantity" type="number" min="1" value="${Math.max(1, Number(row.quantity) || 1)}" title="数量">
        ` : `
          <input data-condition-field="path" value="${this._escape(row.path || '')}" placeholder="story.s01Survival.xxx" title="字段路径">
          <select data-condition-field="op">${CONDITION_OPS.map(([value, label]) => `<option value="${value}" ${row.op === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
          <input data-condition-field="value" value="${this._escape(this._valueToText(row.value))}" placeholder="比较值" title="比较值（true/false/数字/文本）">
        `}
        <button type="button" class="danger" data-action="delete-condition">删除</button>
      </div>`).join('');
  }

  _writeRowsHtml(writes) {
    const rows = this._parseWrites(writes);
    if (!rows.length) return '<small class="ste-muted">无写入</small>';
    return rows.map((row, index) => `
      <div class="ste-row" data-write-index="${index}">
        <select data-write-field="target">${WRITE_TARGETS.map(([value, label]) => `<option value="${value}" ${row.target === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
        ${row.target === 'city' ? `<input data-write-field="cityId" value="${this._escape(row.cityId || '')}" placeholder="city.xxx">` : ''}
        <input data-write-field="path" value="${this._escape(row.path || '')}" placeholder="字段路径，如 s01Survival.campfireLit" title="写入字段路径">
        <select data-write-field="mode">
          ${[['bool', '布尔'], ['number', '数字'], ['string', '文本'], ['add', '原值+N'], ['null', '清空']].map(([value, label]) => `<option value="${value}" ${row.mode === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        ${row.mode === 'bool' ? `<select data-write-field="boolValue"><option value="true" ${row.value === true ? 'selected' : ''}>真</option><option value="false" ${row.value === false ? 'selected' : ''}>假</option></select>` : ''}
        ${row.mode === 'number' ? `<input data-write-field="numValue" type="number" value="${Number(row.value ?? 0)}">` : ''}
        ${row.mode === 'string' ? `<input data-write-field="strValue" value="${this._escape(String(row.value ?? ''))}">` : ''}
        ${row.mode === 'add' ? `<input data-write-field="addValue" type="number" value="${Number(row.delta ?? 1)}" title="每次增加的数量">` : ''}
        <button type="button" class="danger" data-action="delete-write">删除</button>
      </div>`).join('');
  }

  _inventoryHtml(inventory) {
    const addEntries = list(inventory?.addEntries);
    const removeEntries = list(inventory?.removeEntries);
    const entryRow = (entry, index, kind) => `
      <div class="ste-row" data-inv-kind="${kind}" data-inv-index="${index}">
        <input data-inv-field="itemId" value="${this._escape(entry?.itemId || '')}" placeholder="物品 ID" title="物品 ID">
        <input data-inv-field="quantity" type="number" min="1" value="${Math.max(1, Number(entry?.quantity) || 1)}" title="数量">
        <button type="button" class="danger" data-action="delete-inv">删除</button>
      </div>`;
    return `
      <small class="ste-muted">获得物品</small>
      <div class="ste-rows" data-role="inv-add">${addEntries.map((entry, index) => entryRow(entry, index, 'add')).join('') || '<small class="ste-muted">无</small>'}</div>
      <button type="button" data-action="add-inv" data-inv-kind="add">+ 获得物品</button>
      <small class="ste-muted">消耗物品</small>
      <div class="ste-rows" data-role="inv-remove">${removeEntries.map((entry, index) => entryRow(entry, index, 'remove')).join('') || '<small class="ste-muted">无</small>'}</div>
      <button type="button" data-action="add-inv" data-inv-kind="remove">+ 消耗物品</button>`;
  }

  _jsonEditorHtml(command) {
    return `
      <div class="ste-json-note">该事务包含高级字段（分支/延迟/选择器等）或已切换源码模式，仅以 JSON 编辑（改动仍做合法性校验）。</div>
      <textarea data-role="json-source" rows="22" spellcheck="false">${this._escape(JSON.stringify(command, null, 2))}</textarea>`;
  }

  _bindDetail(command, advancedLocked) {
    const target = this.container.querySelector('[data-role="transaction-detail"]');
    target.querySelector('[data-action="delete-transaction"]')?.addEventListener('click', () => {
      if (!confirm(`确定删除状态事务“${command.name || command.id}”吗？引用它的任务目标/触发器将失效。`)) return;
      this.commands = this.commands.filter(item => item !== command);
      this._dirty = true;
      this.selectedId = null;
      this._render();
    });
    target.querySelector('[data-action="toggle-mode"]')?.addEventListener('click', () => {
      if (advancedLocked && this._jsonMode.has(command.id) && this._hasAdvancedFields(command)) {
        return this._toast('该事务含高级字段，无法使用表单模式', 'error');
      }
      if (this._jsonMode.has(command.id)) this._jsonMode.delete(command.id);
      else this._jsonMode.add(command.id);
      this._renderDetail();
    });

    if (advancedLocked) {
      const textarea = target.querySelector('[data-role="json-source"]');
      textarea?.addEventListener('change', () => {
        try {
          const parsed = JSON.parse(textarea.value);
          if (!isObject(parsed) || text(parsed.commandType) !== 'state.transaction') throw new Error('commandType 必须为 state.transaction');
          if (!text(parsed.id)) throw new Error('缺少 id');
          const index = this.commands.findIndex(item => item?.id === command.id);
          if (index >= 0) this.commands[index] = parsed;
          if (parsed.id !== command.id) this.selectedId = parsed.id;
          this._dirty = true;
          this._render();
        } catch (error) {
          this._toast(`JSON 无效：${error.message}`, 'error');
        }
      });
      return;
    }

    // —— 表单模式绑定 ——
    target.querySelectorAll('[data-ste-field]').forEach(input => input.addEventListener('change', () => {
      const field = input.dataset.steField;
      const value = text(input.value);
      if (field === 'id') {
        if (!stableId(value)) return this._toast('ID 只能使用字母开头的字母、数字、点、下划线和短横线', 'error');
        if (value !== command.id && this.commands.some(item => item?.id === value)) return this._toast(`ID 已存在：${value}`, 'error');
        this.selectedId = value;
      }
      command[field] = value;
      this._dirty = true;
      this._renderList();
    }));
    target.querySelectorAll('[data-condition-field]').forEach(control => control.addEventListener('change', () => {
      this._syncConditions(command, target);
      this._dirty = true;
    }));
    target.querySelectorAll('[data-write-field]').forEach(control => control.addEventListener('change', () => {
      this._syncWrites(command, target);
      if (control.dataset.writeField === 'target' || control.dataset.writeField === 'mode') this._renderDetail();
      else this._dirty = true;
    }));
    target.querySelectorAll('[data-inv-field]').forEach(control => control.addEventListener('change', () => {
      this._syncInventory(command, target);
      this._dirty = true;
    }));
    target.querySelectorAll('[data-ste-inv]').forEach(input => input.addEventListener('change', () => {
      command.transaction = isObject(command.transaction) ? command.transaction : {};
      if (input.dataset.steInv === 'travelSceneId') {
        const sceneId = text(input.value);
        if (sceneId) command.transaction.travel = { sceneId, spawnRef: 'player' };
        else delete command.transaction.travel;
      } else {
        const checkpointId = text(input.value);
        if (checkpointId) command.transaction.checkpoint = { checkpointId, checkpointMode: 'bestEffort', reason: 'checkpoint', sceneId: 'S01' };
        else delete command.transaction.checkpoint;
      }
      this._dirty = true;
    }));
    target.querySelector('[data-action="add-condition"]')?.addEventListener('click', () => {
      command.transaction = isObject(command.transaction) ? command.transaction : {};
      const rows = this._parseWhen(command.transaction.when);
      rows.push({ kind: 'field', path: '', op: 'equals', value: true });
      command.transaction.when = this._serializeWhen(rows);
      this._dirty = true;
      this._renderDetail();
    });
    target.querySelectorAll('[data-action="delete-condition"]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.closest('[data-condition-index]')?.dataset.conditionIndex);
      const rows = this._parseWhen(command.transaction?.when);
      if (Number.isInteger(index)) rows.splice(index, 1);
      command.transaction.when = this._serializeWhen(rows);
      this._dirty = true;
      this._renderDetail();
    }));
    target.querySelector('[data-action="add-write"]')?.addEventListener('click', () => {
      command.transaction = isObject(command.transaction) ? command.transaction : {};
      const rows = this._parseWrites(command.transaction.writes);
      rows.push({ target: 'story', path: '', mode: 'bool', value: true });
      command.transaction.writes = this._serializeWrites(rows);
      this._dirty = true;
      this._renderDetail();
    });
    target.querySelectorAll('[data-action="delete-write"]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.closest('[data-write-index]')?.dataset.writeIndex);
      const rows = this._parseWrites(command.transaction?.writes);
      if (Number.isInteger(index)) rows.splice(index, 1);
      command.transaction.writes = this._serializeWrites(rows);
      this._dirty = true;
      this._renderDetail();
    }));
    target.querySelectorAll('[data-action="add-inv"]').forEach(button => button.addEventListener('click', () => {
      command.transaction = isObject(command.transaction) ? command.transaction : {};
      const kind = button.dataset.invKind === 'add' ? 'addEntries' : 'removeEntries';
      const inventory = isObject(command.transaction.inventory) ? command.transaction.inventory : {};
      inventory[kind] = list(inventory[kind]);
      inventory[kind].push({ itemId: '', quantity: 1 });
      inventory.type = kind === 'addEntries' ? (inventory.removeEntries?.length ? 'batchExchange' : 'batchAdd') : (inventory.addEntries?.length ? 'batchExchange' : 'batchRemove');
      command.transaction.inventory = inventory;
      this._dirty = true;
      this._renderDetail();
    }));
    target.querySelectorAll('[data-action="delete-inv"]').forEach(button => button.addEventListener('click', () => {
      const row = button.closest('[data-inv-kind]');
      const kind = row?.dataset.invKind === 'add' ? 'addEntries' : 'removeEntries';
      const index = Number(row?.dataset.invIndex);
      const inventory = command.transaction?.inventory;
      if (isObject(inventory) && Number.isInteger(index)) {
        list(inventory[kind]).splice(index, 1);
        if (!list(inventory.addEntries).length && !list(inventory.removeEntries).length) delete command.transaction.inventory;
      }
      this._dirty = true;
      this._renderDetail();
    }));
  }

  // —— when 条件：结构 ↔ 行模型 ——
  _parseWhen(when) {
    const clauses = Array.isArray(when?.all) ? when.all : (when && Object.keys(when).length ? [when] : []);
    return clauses.map(clause => {
      if (isObject(clause?.inventory)) return { kind: 'inventory', itemId: text(clause.inventory.itemId), quantity: Number(clause.inventory.quantity) || 1 };
      for (const [op] of CONDITION_OPS) {
        if (op in clause) return { kind: 'field', path: text(clause.path), op, value: clause[op] };
      }
      return { kind: 'field', path: text(clause.path), op: 'equals', value: clause.equals };
    });
  }

  _serializeWhen(rows) {
    const clauses = rows.map(row => row.kind === 'inventory'
      ? { inventory: { itemId: text(row.itemId), quantity: Math.max(1, Number(row.quantity) || 1) } }
      : { [row.op || 'equals']: this._parseScalar(row.value), path: text(row.path) });
    if (!clauses.length) return {};
    return clauses.length === 1 ? clauses[0] : { all: clauses };
  }

  _syncConditions(command, target) {
    const rows = this._parseWhen(command.transaction?.when);
    target.querySelectorAll('[data-condition-index]').forEach(rowEl => {
      const index = Number(rowEl.dataset.conditionIndex);
      const row = rows[index];
      if (!row) return;
      if (row.kind === 'inventory') {
        row.itemId = rowEl.querySelector('[data-condition-field="itemId"]')?.value ?? row.itemId;
        row.quantity = Number(rowEl.querySelector('[data-condition-field="quantity"]')?.value) || row.quantity;
      } else {
        row.path = rowEl.querySelector('[data-condition-field="path"]')?.value ?? row.path;
        row.op = rowEl.querySelector('[data-condition-field="op"]')?.value ?? row.op;
        row.value = rowEl.querySelector('[data-condition-field="value"]')?.value ?? row.value;
      }
    });
    command.transaction.when = this._serializeWhen(rows);
  }

  // —— writes 写入：结构 ↔ 行模型 ——
  _parseWrites(writes) {
    return list(writes).map(write => {
      const value = write?.value;
      let mode = 'string';
      let normalized = value;
      if (value === true || value === false || value === null) { mode = value === null ? 'null' : 'bool'; }
      else if (isObject(value) && Array.isArray(value.$add)) {
        mode = 'add';
        const delta = value.$add[1];
        normalized = typeof delta === 'number' ? delta : 1;
      } else if (typeof value === 'number') mode = 'number';
      else if (typeof value === 'string') { mode = 'string'; normalized = text(value); }
      return { target: text(write?.target) || 'story', cityId: text(write?.cityId), path: text(write?.path), mode, value: normalized, delta: mode === 'add' ? normalized : 1 };
    });
  }

  _serializeWrites(rows) {
    return rows.map(row => {
      const write = { path: text(row.path), target: row.target || 'story' };
      if (row.target === 'city' && text(row.cityId)) write.cityId = text(row.cityId);
      if (row.mode === 'bool') write.value = row.boolValue !== undefined ? row.boolValue === 'true' || row.boolValue === true : row.value === true;
      else if (row.mode === 'number') write.value = Number(row.numValue ?? row.value ?? 0);
      else if (row.mode === 'string') write.value = String(row.strValue ?? row.value ?? '');
      else if (row.mode === 'null') write.value = null;
      else {
        const delta = Number(row.addValue ?? row.delta ?? 1);
        write.value = { $add: [{ $get: `story.${text(row.path)}` }, delta] };
      }
      return write;
    });
  }

  _syncWrites(command, target) {
    const rows = this._parseWrites(command.transaction?.writes);
    target.querySelectorAll('[data-write-index]').forEach(rowEl => {
      const index = Number(rowEl.dataset.writeIndex);
      const row = rows[index];
      if (!row) return;
      row.target = rowEl.querySelector('[data-write-field="target"]')?.value ?? row.target;
      row.cityId = rowEl.querySelector('[data-write-field="cityId"]')?.value ?? row.cityId;
      row.path = rowEl.querySelector('[data-write-field="path"]')?.value ?? row.path;
      row.mode = rowEl.querySelector('[data-write-field="mode"]')?.value ?? row.mode;
      row.boolValue = rowEl.querySelector('[data-write-field="boolValue"]')?.value;
      row.numValue = rowEl.querySelector('[data-write-field="numValue"]')?.value;
      row.strValue = rowEl.querySelector('[data-write-field="strValue"]')?.value;
      row.addValue = rowEl.querySelector('[data-write-field="addValue"]')?.value;
    });
    command.transaction.writes = this._serializeWrites(rows);
  }

  // —— inventory 背包：结构 ↔ 行模型 ——
  _syncInventory(command, target) {
    command.transaction = isObject(command.transaction) ? command.transaction : {};
    const inventory = isObject(command.transaction.inventory) ? command.transaction.inventory : { type: 'batchExchange' };
    const readKind = kind => {
      const rows = [];
      target.querySelectorAll(`[data-inv-kind="${kind === 'addEntries' ? 'add' : 'remove'}"]`).forEach(rowEl => {
        rows.push({
          itemId: rowEl.querySelector('[data-inv-field="itemId"]')?.value || '',
          quantity: Math.max(1, Number(rowEl.querySelector('[data-inv-field="quantity"]')?.value) || 1)
        });
      });
      return rows;
    };
    const addEntries = readKind('addEntries');
    const removeEntries = readKind('removeEntries');
    if (addEntries.length) inventory.addEntries = addEntries; else delete inventory.addEntries;
    if (removeEntries.length) inventory.removeEntries = removeEntries; else delete inventory.removeEntries;
    inventory.type = addEntries.length && removeEntries.length ? 'batchExchange' : (addEntries.length ? 'batchAdd' : 'batchRemove');
    if (!addEntries.length && !removeEntries.length) delete command.transaction.inventory;
    else command.transaction.inventory = inventory;
  }

  _parseScalar(value) {
    const raw = String(value ?? '').trim();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
    return raw;
  }

  _valueToText(value) {
    if (value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  _addTransaction() {
    const id = prompt('事务 ID（英文稳定标识，如 story.s01.newFact）：', '')?.trim();
    if (!id) return;
    if (!stableId(id)) return this._toast('ID 只能使用字母开头的字母、数字、点、下划线和短横线', 'error');
    if (this.commands.some(command => command?.id === id)) return this._toast(`ID 已存在：${id}`, 'error');
    const name = prompt('中文名称：', '')?.trim() || id;
    this.commands.push({ commandType: 'state.transaction', id, name, transaction: { writes: [] } });
    this._dirty = true;
    this.selectedId = id;
    this._render();
  }

  async save() {
    const errors = [];
    const seen = new Set();
    for (const command of this.commands) {
      if (!text(command?.id)) errors.push('存在缺少 ID 的事务');
      else if (stableId(command.id) === false) errors.push(`ID 非法：${command.id}`);
      else if (seen.has(command.id)) errors.push(`ID 重复：${command.id}`);
      seen.add(command?.id);
      if (text(command?.commandType) !== 'state.transaction') errors.push(`${command?.id || '?'}: commandType 必须为 state.transaction`);
    }
    if (errors.length) {
      const message = `状态事务校验失败：${errors[0]}`;
      this._status(`❌ ${message}`, 'error');
      this._toast(message, 'error');
      return { ok: false, errors };
    }
    try {
      this.canonicalSession.patch('commands', clone(this.commands));
      const result = await this.canonicalSession.save();
      if (result?.ok === true && result.committed === true) {
        const message = result.degraded ? '磁盘已提交，但缓存或通知同步降级' : `已保存 ${this.commands.length} 个状态事务`;
        this._status(`${result.degraded ? '⚠️' : '✅'} ${message}`, result.degraded ? 'warn' : 'ok');
        this._toast(message, result.degraded ? 'warn' : 'success');
        this._dirty = false;
        return result;
      }
      const failMessage = this._saveError(result);
      this._status(`❌ 保存失败：${failMessage}`, 'error');
      this._toast(`保存失败：${failMessage}`, 'error');
      return result;
    } catch (error) {
      const message = `保存异常：${error?.message || String(error)}`;
      this._status(`❌ ${message}`, 'error');
      return { ok: false, error: message };
    }
  }

  _saveError(result) {
    const first = result?.errors?.[0];
    return [first?.path, first?.message || first?.reason].filter(Boolean).join(': ')
      || result?.error?.message || result?.error || '磁盘未提交';
  }

  _status(message, kind = '') {
    const target = this.container.querySelector('[data-role="status"]');
    if (target) { target.textContent = message; target.className = `ste-status ${kind}`; }
  }

  _toast(message, type = 'success') {
    let target = document.getElementById('ste-toast');
    if (!target) {
      target = document.createElement('div');
      target.id = 'ste-toast';
      target.className = 'ste-toast';
      document.body.appendChild(target);
    }
    target.textContent = message;
    target.dataset.type = type;
    target.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => target.classList.remove('visible'), 2600);
  }

  _escape(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }

  _injectStyles() {
    if (document.getElementById('ste-styles')) return;
    const style = document.createElement('style');
    style.id = 'ste-styles';
    style.textContent = `
      .ste-root{height:100%;display:flex;flex-direction:column;background:#0d1326;color:#fff;font-size:13px}
      .ste-toolbar{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#16213e;border-bottom:1px solid #2a3a5e}
      .ste-toolbar button{padding:7px 12px;border:0;border-radius:4px;background:#3a4a7e;color:#fff;cursor:pointer}
      .ste-toolbar .primary{background:#4caf50;color:#102010;font-weight:bold}
      .ste-hint{margin-left:auto;color:#8aa;font-size:12px}
      .ste-status{min-height:28px;padding:6px 16px;background:#0a1020;color:#9ab}
      .ste-status.ok{color:#6c6}.ste-status.warn{color:#e6bd5d}.ste-status.error{color:#e66}
      .ste-main{min-height:0;flex:1;display:flex;overflow:hidden}
      .ste-list{width:260px;flex:none;overflow:auto;background:#111a30}
      .ste-item{display:flex;width:100%;flex-direction:column;gap:3px;padding:9px 13px;text-align:left;color:#fff;background:transparent;border:0;border-bottom:1px solid #1e2b47;cursor:pointer;font:inherit}
      .ste-item:hover{background:#1a2540}.ste-item.active{background:#2a3a6e}
      .ste-item small{color:#9ab;font-size:11px}
      .ste-detail{min-width:0;flex:1;overflow:auto;padding:16px}
      .ste-detail-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
      .ste-detail-head .danger{padding:5px 10px;border:0;border-radius:3px;background:#7e3a3a;color:#fff;cursor:pointer}
      .ste-block{margin-bottom:12px;padding:10px 14px;border:1px solid #2a3a5e;border-radius:6px;background:#0f1830}
      .ste-block legend{padding:0 8px;color:#8fa7d8;font-weight:bold}
      .ste-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px}
      .ste-field label{display:block;margin-bottom:4px;color:#9ab;font-size:12px}
      .ste-field input,.ste-row input,.ste-row select{padding:7px;border:1px solid #2a3a5e;border-radius:3px;background:#0a1020;color:#fff;font:inherit}
      .ste-field input{width:100%}
      .ste-rows{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
      .ste-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .ste-row input{flex:1;min-width:90px}
      .ste-row select{flex:none}
      .ste-row .danger{padding:5px 9px;border:0;border-radius:3px;background:#7e3a3a;color:#fff;cursor:pointer}
      .ste-block>button,.ste-detail>button{padding:6px 11px;border:0;border-radius:4px;background:#3a4a7e;color:#fff;cursor:pointer;margin-top:4px}
      .ste-muted{color:#789;font-size:11px;display:block;margin:2px 0}
      .ste-empty{padding:38px 16px;color:#789;text-align:center;line-height:1.7}
      .ste-json-note{margin-bottom:8px;padding:8px 12px;border:1px solid #8a6d3b;border-radius:5px;background:#2a2313;color:#e6bd5d;font-size:12px}
      .ste-detail textarea{width:100%;padding:10px;border:1px solid #2a3a5e;border-radius:4px;background:#0a1020;color:#fff;font:Consolas,monospace;font-size:12px;resize:vertical;margin-bottom:8px}
      .ste-toast{position:fixed;top:58px;left:50%;z-index:100000;max-width:min(600px,90vw);padding:10px 18px;border-radius:6px;background:#2e7d32;color:#fff;box-shadow:0 4px 16px #0008;opacity:0;pointer-events:none;transform:translate(-50%,-8px);transition:opacity .2s,transform .2s}
      .ste-toast[data-type="error"]{background:#c62828}
      .ste-toast.visible{opacity:1;transform:translate(-50%,0)}
    `;
    document.head.appendChild(style);
  }
}

export default StateTransactionEditor;
