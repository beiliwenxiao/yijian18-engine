/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * DialogueGraphEditor - 对话图编辑器（P3-1）
 *
 * 读写 GameProject（example/<game>/game.project.json）的 dialogues[]。
 * 对话格式与 DialogueSystem.registerDialogue 兼容（§5.1）：
 *   { id, title, startNode, nodes:{ <nodeId>:{ speaker, portrait, text,
 *       nextNode:<id|null>,                       // 单跳
 *       choices:[{ id, text, nextNode, if?, do? }] // 多选分支（DSL 条件/动作）
 *   }}}
 * choice.if = ExpressionEngine 条件（JSON，可空）；choice.do = 动作序列（JSON，可空）。
 *
 * 提供「导入 DialogueData.json」把现有对话数据迁移进 dialogues[]（P3-2）。
 * 通过 Vite dev server 的 /api/read-file、/api/canonical-transaction 读写。
 */

export class DialogueGraphEditor {
  /**
   * @param {HTMLElement} container
   * @param {Object} options - { gameId }
   */
  constructor(container, options = {}) {
    this.container = container;
    this.gameId = options.gameId || 'sanguo_zhangjiao';
    this.canonicalSession = options.canonicalSession || null;
    this.schemaFields = this.canonicalSession?.fields || null;
    this.projectPath = `example/${this.gameId}/game.project.json`;
    this.legacyDialoguePath = `example/${this.gameId}/data/DialogueData.json`;
    this.project = null;
    this.dialogues = [];
    this.selectedIndex = -1;
    this._initialized = false;
  }

  async init() {
    if (!this._initialized) {
      this._initialized = true;
      this._buildUI();
      this._injectStyles();
    }
    await this._load();
    this._renderList();
    this._renderDetail();
  }

  // ---- 加载 / 保存 ----

  async _load() {
    if (!this.canonicalSession) {
      throw new TypeError('DialogueGraphEditor requires a shared CanonicalEditorSession');
    }
    this.project = this.canonicalSession.getValue();
    if (!this.project || typeof this.project !== 'object') {
      throw new Error('DialogueGraphEditor: canonical project candidate 不可用');
    }
    if (!Array.isArray(this.project.dialogues)) this.project.dialogues = [];
    this.dialogues = this.project.dialogues;
  }

  async save() {
    if (this._validateAllJson()) {
      this._toast('JSON 格式错误，请修正后再保存（红框处）', 'error');
      this._status('❌ JSON 格式错误，未保存', 'err');
      return { ok: false, committed: false, status: 'rejected', code: 'invalidJson' };
    }
    this._commitDetail();
    this.project.dialogues = this.dialogues;
    try {
      this.canonicalSession.patch('dialogues', this.dialogues);
      const data = await this.canonicalSession.save();
      if (data?.ok === true && data.committed === true) {
        if (data.degraded) {
          const warning = '磁盘已提交，但缓存/通知同步降级';
          this._status('⚠️ ' + warning, 'warn');
          this._toast(warning, 'warn');
        } else {
          this._status('✅ 已保存到 ' + this.projectPath + '（对话 ' + this.dialogues.length + ' 条）', 'ok');
          this._toast('保存成功（对话 ' + this.dialogues.length + ' 条）', 'success');
        }
        return data;
      }
      const firstError = data?.errors?.[0];
      const message = [firstError?.path, firstError?.message || firstError?.reason]
        .filter(Boolean)
        .join(': ') || data?.error?.message || data?.error || '未知';
      this._status('❌ 保存失败: ' + message, 'err');
      this._toast('保存失败: ' + message, 'error');
      return data;
    } catch (error) {
      const result = error.result || { ok: false, committed: false, status: 'failed', error };
      this._status('❌ 保存失败: ' + error.message, 'err');
      this._toast('保存失败: ' + error.message, 'error');
      return result;
    }
  }

  /**
   * 导入现有 DialogueData.json（按幕嵌套）→ 扁平化合并进 dialogues[]（P3-2）
   * 非破坏：只往工程 dialogues[] 追加/覆盖同 id，不改动 DialogueData.json。
   */
  async importLegacy() {
    let raw;
    try {
      const res = await fetch('/api/read-file?path=' + encodeURIComponent(this.legacyDialoguePath));
      const data = await res.json();
      if (!data || !data.ok) { this._toast('读取 DialogueData.json 失败', false); return; }
      raw = JSON.parse(data.content);
    } catch (e) {
      this._toast('导入失败: ' + e.message, false);
      return;
    }
    this._commitDetail();
    const existingIds = new Set(this.dialogues.map(d => d.id));
    let added = 0, updated = 0;
    // DialogueData 结构：{ act1:{ dlgId:{...} }, act2:{...} }
    for (const [act, group] of Object.entries(raw)) {
      if (!group || typeof group !== 'object') continue;
      for (const [dlgId, dlg] of Object.entries(group)) {
        const entry = {
          id: dlg.id || dlgId,
          title: dlg.title || '',
          act,
          startNode: dlg.startNode || 'start',
          nodes: dlg.nodes || {}
        };
        const idx = this.dialogues.findIndex(d => d.id === entry.id);
        if (idx >= 0) { this.dialogues[idx] = entry; updated++; }
        else { this.dialogues.push(entry); added++; }
        existingIds.add(entry.id);
      }
    }
    this.project.dialogues = this.dialogues;
    this._renderList();
    this._renderDetail();
    this._toast(`已导入：新增 ${added} 条，覆盖 ${updated} 条（记得点保存）`, true);
    this._status(`导入完成：新增 ${added}，覆盖 ${updated}。点击「保存到工程」写入。`, 'ok');
  }

  // ---- 数据辅助 ----
  _dlg() { return this.dialogues[this.selectedIndex]; }
  _nodeIds() {
    const d = this._dlg();
    return d && d.nodes ? Object.keys(d.nodes) : [];
  }

  // ---- UI 构建 ----
  _buildUI() {
    this.container.innerHTML = `
      <div class="dlg-root">
        <div class="dlg-toolbar">
          <select id="dlg-filter-enabled" title="筛选启用/停用" style="padding:4px;background:#26304e;color:#fff;border:1px solid #3a4a7e;border-radius:3px;font-size:12px;">
            <option value="">全部状态</option>
            <option value="enabled">启用</option>
            <option value="disabled">停用</option>
          </select>
          <select id="dlg-filter-scene" title="筛选场景/幕" style="padding:4px;background:#26304e;color:#fff;border:1px solid #3a4a7e;border-radius:3px;font-size:12px;">
            <option value="">全部场景</option>
          </select>
          <button id="dlg-add">+ 新增对话</button>
          <button id="dlg-del">🗑 删除对话</button>
          <button id="dlg-import">⬇ 导入 DialogueData</button>
          <button id="dlg-save" class="primary">💾 保存到工程</button>
          <span class="dlg-hint">数据 → ${this.projectPath} · dialogues</span>
        </div>
        <div class="dlg-main">
          <div class="dlg-list" id="dlg-list"></div>
          <div class="dlg-detail" id="dlg-detail"></div>
        </div>
        <div class="dlg-status" id="dlg-status"></div>
      </div>`;
    this.container.querySelector('#dlg-add').addEventListener('click', () => this._addDialogue());
    this.container.querySelector('#dlg-del').addEventListener('click', () => this._deleteDialogue());
    this.container.querySelector('#dlg-import').addEventListener('click', async () => {
      await this.importLegacy();
    });
    this.container.querySelector('#dlg-save').addEventListener('click', async () => {
      await this.save();
    });
    this.container.querySelector('#dlg-filter-enabled').addEventListener('change', () => this._renderList());
    this.container.querySelector('#dlg-filter-scene').addEventListener('change', () => this._renderList());
  }

  /** 动态更新场景/幕筛选下拉（从对话 act 字段收集） */
  _updateSceneFilter() {
    const select = this.container.querySelector('#dlg-filter-scene');
    if (!select) return;
    const currentVal = select.value;
    const scenes = new Set();
    for (const d of this.dialogues) {
      const s = d.scene || d.act;
      if (s) scenes.add(s);
    }
    let opts = '<option value="">全部场景</option>';
    for (const s of scenes) {
      opts += `<option value="${s}" ${s === currentVal ? 'selected' : ''}>${s}</option>`;
    }
    select.innerHTML = opts;
  }

  _injectStyles() {
    if (document.getElementById('dlg-styles')) return;
    const s = document.createElement('style');
    s.id = 'dlg-styles';
    s.textContent = `
      .dlg-root{display:flex;flex-direction:column;height:100%;background:#0d1326;color:#fff;}
      .dlg-toolbar{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#16213e;border-bottom:1px solid #2a3a5e;}
      .dlg-toolbar button{padding:7px 12px;background:#3a4a7e;border:none;border-radius:4px;color:#fff;cursor:pointer;}
      .dlg-toolbar button.primary{background:#4CAF50;color:#000;font-weight:bold;}
      .dlg-hint{margin-left:auto;color:#8aa;font-size:12px;}
      .dlg-main{flex:1;display:flex;overflow:hidden;}
      .dlg-list{width:220px;background:#111a30;border-right:1px solid #2a3a5e;overflow-y:auto;}
      .dlg-item{padding:9px 14px;border-bottom:1px solid #1e2b47;cursor:pointer;}
      .dlg-item:hover{background:#1a2540;}
      .dlg-item.active{background:#2a3a6e;}
      .dlg-item.disabled{opacity:0.45;}
      .dlg-item .di-title{font-weight:bold;font-size:13px;}
      .dlg-item .di-id{font-size:11px;color:#9ab;}
      .dlg-detail{flex:1;padding:16px;overflow-y:auto;}
      .dlg-detail .row{margin-bottom:10px;}
      .dlg-detail label{display:block;font-size:12px;color:#9ab;margin-bottom:3px;}
      .dlg-detail input[type=text],.dlg-detail select,.dlg-detail textarea{width:100%;box-sizing:border-box;background:#0a1020;border:1px solid #2a3a5e;color:#fff;padding:6px;border-radius:3px;font-size:12px;}
      .dlg-detail textarea{font-family:monospace;resize:vertical;}
      .dlg-node{border:1px solid #2a3a5e;border-radius:6px;padding:10px;margin-bottom:10px;background:#0f1830;}
      .dlg-node.start{border-color:#4CAF50;}
      .dlg-node .node-head{display:flex;gap:6px;align-items:center;margin-bottom:8px;}
      .dlg-node .node-head .nid{font-weight:bold;color:#7cf;font-size:13px;}
      .dlg-node .node-head .start-badge{background:#4CAF50;color:#000;font-size:10px;padding:1px 6px;border-radius:8px;}
      .dlg-2col{display:flex;gap:8px;}
      .dlg-2col > div{flex:1;}
      .dlg-choice{border:1px dashed #3a5a8e;border-radius:4px;padding:7px;margin-top:6px;background:#0c1428;}
      .dlg-choice .ch-head{display:flex;gap:6px;align-items:center;margin-bottom:5px;}
      .dlg-empty{color:#778;padding:40px;text-align:center;}
      .dlg-status{padding:6px 16px;font-size:12px;min-height:22px;background:#0a1020;}
      .dlg-status.ok{color:#6c6;} .dlg-status.err{color:#e66;}
      .dlg-mini{padding:3px 8px;background:#3a4a7e;border:none;border-radius:3px;color:#fff;cursor:pointer;font-size:12px;}
      .dlg-mini.danger{background:#7e3a3a;}
    `;
    document.head.appendChild(s);
  }

  _status(msg, kind) {
    const el = this.container.querySelector('#dlg-status');
    if (el) { el.textContent = msg; el.className = 'dlg-status ' + (kind || ''); }
  }

  _toast(msg, type = 'success') {
    let t = document.getElementById('dlg-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'dlg-toast';
      t.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);' +
        'padding:12px 28px;border-radius:8px;color:#fff;font-size:15px;font-weight:bold;' +
        'z-index:100000;pointer-events:none;transition:opacity 0.3s;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
      document.body.appendChild(t);
    }
    const tone = type === true ? 'success' : type === false ? 'error' : type;
    const presentations = {
      success: { icon: '✅ ', background: '#2e7d32' },
      warn: { icon: '⚠️ ', background: '#9a6700' },
      error: { icon: '❌ ', background: '#c62828' }
    };
    const presentation = presentations[tone] || presentations.success;
    t.textContent = presentation.icon + msg;
    t.dataset.type = tone;
    t.style.background = presentation.background;
    t.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2400);
  }

  // ---- 列表 ----
  _renderList() {
    const list = this.container.querySelector('#dlg-list');
    if (!list) return;

    // 更新场景/幕下拉
    this._updateSceneFilter();

    if (this.dialogues.length === 0) {
      list.innerHTML = '<div class="dlg-empty">暂无对话<br>点「+ 新增」或「导入」</div>';
      return;
    }

    const filterEnabled = this.container.querySelector('#dlg-filter-enabled')?.value || '';
    const filterScene = this.container.querySelector('#dlg-filter-scene')?.value || '';

    const filtered = this.dialogues.filter(d => {
      if (filterEnabled === 'enabled' && d.enabled === false) return false;
      if (filterEnabled === 'disabled' && d.enabled !== false) return false;
      if (filterScene && (d.scene || d.act || '') !== filterScene) return false;
      return true;
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div class="dlg-empty">无匹配的对话</div>';
      return;
    }

    list.innerHTML = '';
    filtered.forEach((d) => {
      const i = this.dialogues.indexOf(d);
      const item = document.createElement('div');
      const disabled = d.enabled === false;
      item.className = 'dlg-item' + (i === this.selectedIndex ? ' active' : '') + (disabled ? ' disabled' : '');
      const cnt = d.nodes ? Object.keys(d.nodes).length : 0;
      const statusIcon = disabled ? '⏸' : '▶';
      const sceneLabel = d.scene || d.act || '';
      item.innerHTML = `<div style="display:flex;align-items:center;gap:6px;">
          <span class="dlg-status-icon" data-toggle="${i}" title="启用/停用" style="cursor:pointer;flex-shrink:0;">${statusIcon}</span>
          <div style="flex:1;overflow:hidden;">
            <div class="di-title">${this._esc(d.title || d.id || '(未命名)')}</div>
            <div class="di-id">${this._esc(d.id || '')} · ${cnt} 节点${sceneLabel ? ' · ' + this._esc(sceneLabel) : ''}</div>
          </div>
        </div>`;
      // 状态图标点击切换启用/停用
      item.querySelector('.dlg-status-icon').addEventListener('click', (e) => {
        e.stopPropagation();
        this._commitDetail();
        d.enabled = d.enabled === false ? undefined : false;
        if (d.enabled === undefined) delete d.enabled;
        this._renderList();
        this._renderDetail();
      });
      item.addEventListener('click', () => {
        this._commitDetail();
        this.selectedIndex = i;
        this._renderList();
        this._renderDetail();
      });
      list.appendChild(item);
    });
  }

  // ---- 详情（节点卡片）----
  _renderDetail() {
    const panel = this.container.querySelector('#dlg-detail');
    if (!panel) return;
    const d = this._dlg();
    if (!d) {
      panel.innerHTML = '<div class="dlg-empty">选择或新增一个对话</div>';
      return;
    }
    if (!d.nodes) d.nodes = {};
    const nodeIds = Object.keys(d.nodes);
    const startOpts = nodeIds.map(id =>
      `<option value="${id}" ${d.startNode === id ? 'selected' : ''}>${id}</option>`).join('');

    // 对话框演出配置（对话级）：类型 + 三套美术资源路径
    const presentation = (d.presentation && typeof d.presentation === 'object') ? d.presentation : {};
    const boxType = ['narration', 'portrait', 'halfBody', 'fullBody'].includes(presentation.boxType)
      ? presentation.boxType : 'portrait';

    let html = `
      <div class="dlg-2col">
        <div class="row"><label>对话 ID</label><input type="text" id="d-id" value="${this._esc(d.id || '')}"></div>
        <div class="row"><label>标题 title</label><input type="text" id="d-title" value="${this._esc(d.title || '')}"></div>
      </div>
      <div class="dlg-2col">
        <div class="row"><label>所属场景 (场景ID)</label><input type="text" id="d-scene" value="${this._esc(d.scene || d.act || '')}" placeholder="如 s1-1 / s2-1"></div>
        <div class="row"><label>状态</label><label style="display:flex;align-items:center;gap:5px;color:#fff;"><input type="checkbox" id="d-enabled" ${d.enabled !== false ? 'checked' : ''} style="width:auto;"> 启用</label></div>
      </div>
      <div class="dlg-2col">
        <div class="row"><label>对话框类型</label>
          <select id="d-box-type">
            <option value="portrait" ${boxType === 'portrait' ? 'selected' : ''}>头像对话（默认）</option>
            <option value="narration" ${boxType === 'narration' ? 'selected' : ''}>旁白对话</option>
            <option value="halfBody" ${boxType === 'halfBody' ? 'selected' : ''}>NPC半身对话</option>
            <option value="fullBody" ${boxType === 'fullBody' ? 'selected' : ''}>NPC全身对话</option>
          </select>
        </div>
        <div class="row"><label>头像图 portraitImage</label><input type="text" id="d-portrait-image" value="${this._esc(presentation.portraitImage || '')}" placeholder="assets/images/xxx.png（留空用节点 portrait）"></div>
      </div>
      <div class="dlg-2col">
        <div class="row"><label>半身像 halfBodyImage</label><input type="text" id="d-halfbody-image" value="${this._esc(presentation.halfBodyImage || '')}" placeholder="assets/images/xxx_half.png（半身对话使用）"></div>
        <div class="row"><label>全身像 fullBodyImage</label><input type="text" id="d-fullbody-image" value="${this._esc(presentation.fullBodyImage || '')}" placeholder="assets/images/xxx_full.png（全身对话使用）"></div>
      </div>
      <div class="row"><label>起始节点 startNode</label><select id="d-start">${startOpts || '<option value="">(无节点)</option>'}</select></div>
      <div class="row" style="display:flex;gap:8px;">
        <button class="dlg-mini" id="d-add-node">+ 添加节点</button>
      </div>
    `;

    // 节点卡片
    nodeIds.forEach(nid => {
      const n = d.nodes[nid] || {};
      const isStart = d.startNode === nid;
      const nextOpts = this._nodeSelectOptions(nodeIds, n.nextNode);
      const hasChoices = Array.isArray(n.choices) && n.choices.length > 0;

      let choicesHtml = '';
      if (hasChoices) {
        n.choices.forEach((ch, ci) => {
          const chNext = this._nodeSelectOptions(nodeIds, ch.nextNode);
          choicesHtml += `
            <div class="dlg-choice" data-nid="${nid}" data-ci="${ci}">
              <div class="ch-head">
                <input type="text" class="ch-text" placeholder="选项文本" value="${this._esc(ch.text || '')}" style="flex:2;">
                <select class="ch-next" style="flex:1;">${chNext}</select>
                <button class="dlg-mini danger ch-del">删</button>
              </div>
              <div class="dlg-2col">
                <div><label style="font-size:11px;color:#9ab;">if 条件(JSON,可空)</label><textarea class="ch-if" rows="2" placeholder='{"op":"==","left":{"var":"act"},"right":1}'>${ch.if ? this._json(ch.if) : ''}</textarea></div>
                <div><label style="font-size:11px;color:#9ab;">do 动作(JSON数组,可空)</label><textarea class="ch-do" rows="2" placeholder='[{"action":"setFlag","params":{"key":"agreed"}}]'>${ch.do ? this._json(ch.do) : ''}</textarea></div>
              </div>
            </div>`;
        });
      }

      html += `
        <div class="dlg-node ${isStart ? 'start' : ''}" data-nid="${nid}">
          <div class="node-head">
            <span class="nid">${nid}</span>
            ${isStart ? '<span class="start-badge">START</span>' : ''}
            <span style="flex:1;"></span>
            <button class="dlg-mini node-del">删除节点</button>
          </div>
          <div class="dlg-2col">
            <div class="row"><label>说话者 speaker</label><input type="text" class="n-speaker" value="${this._esc(n.speaker || '')}"></div>
            <div class="row"><label>立绘 portrait</label><input type="text" class="n-portrait" value="${this._esc(n.portrait || '')}" placeholder="如 zhangjiao / player"></div>
          </div>
          <div class="row"><label>文本 text</label><textarea class="n-text" rows="2">${this._esc(n.text || '')}</textarea></div>
          <div class="row">
            <label>分支：无选项时走 nextNode；有选项时用 choices</label>
            <div class="dlg-2col">
              <div><label style="font-size:11px;">nextNode（单跳）</label><select class="n-next" ${hasChoices ? 'disabled' : ''}>${nextOpts}</select></div>
              <div style="display:flex;align-items:flex-end;"><button class="dlg-mini n-add-choice">+ 添加选项</button></div>
            </div>
          </div>
          ${choicesHtml}
        </div>`;
    });

    panel.innerHTML = html;
    this._bindDetailEvents(panel, d);

    // 启用/停用即时刷新列表图标
    const enEl = panel.querySelector('#d-enabled');
    if (enEl) enEl.addEventListener('change', () => { this._commitDetail(); this._renderList(); });
  }

  /** 生成一个 node 下拉（含“结束(null)”） */
  _nodeSelectOptions(nodeIds, current) {
    let opts = `<option value="" ${!current ? 'selected' : ''}>— 结束(null) —</option>`;
    opts += nodeIds.map(id =>
      `<option value="${id}" ${current === id ? 'selected' : ''}>${id}</option>`).join('');
    return opts;
  }

  _bindDetailEvents(panel, d) {
    panel.querySelector('#d-add-node').addEventListener('click', () => {
      this._commitDetail();
      const nid = this._newNodeId(d);
      d.nodes[nid] = { speaker: '', portrait: '', text: '', nextNode: null };
      if (!d.startNode || Object.keys(d.nodes).length === 1) d.startNode = nid;
      this._renderDetail();
    });

    panel.querySelectorAll('.node-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const nid = e.target.closest('.dlg-node').dataset.nid;
        this._commitDetail();
        delete d.nodes[nid];
        if (d.startNode === nid) d.startNode = Object.keys(d.nodes)[0] || 'start';
        this._renderDetail();
      });
    });

    panel.querySelectorAll('.n-add-choice').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const nid = e.target.closest('.dlg-node').dataset.nid;
        this._commitDetail();
        const n = d.nodes[nid];
        if (!Array.isArray(n.choices)) n.choices = [];
        n.choices.push({ id: 'ch_' + (n.choices.length + 1), text: '新选项', nextNode: null });
        this._renderDetail();
      });
    });

    panel.querySelectorAll('.ch-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const wrap = e.target.closest('.dlg-choice');
        const nid = wrap.dataset.nid;
        const ci = parseInt(wrap.dataset.ci);
        this._commitDetail();
        const n = d.nodes[nid];
        if (n && Array.isArray(n.choices)) {
          n.choices.splice(ci, 1);
          if (n.choices.length === 0) delete n.choices;
        }
        this._renderDetail();
      });
    });

    // if/do 实时校验
    panel.querySelectorAll('.ch-if, .ch-do').forEach(el => this._bindJsonValidation(el));
  }

  _newNodeId(d) {
    let i = 1;
    while (d.nodes['node' + i]) i++;
    return 'node' + i;
  }

  /** 把详情表单写回当前对话数据 */
  _commitDetail() {
    const d = this._dlg();
    const panel = this.container.querySelector('#dlg-detail');
    if (!d || !panel || !panel.querySelector('#d-id')) return;

    d.id = panel.querySelector('#d-id').value.trim() || d.id;
    d.title = panel.querySelector('#d-title').value.trim();
    // 所属场景（场景 ID，如 s1-1）
    const sceneEl = panel.querySelector('#d-scene');
    if (sceneEl) {
      const sv = sceneEl.value.trim();
      if (sv) d.scene = sv; else delete d.scene;
    }
    // 启用/停用：未勾选=false，勾选=删除字段（默认启用，保持 JSON 简洁）
    const enabledEl = panel.querySelector('#d-enabled');
    if (enabledEl) {
      if (!enabledEl.checked) d.enabled = false;
      else delete d.enabled;
    }
    const startSel = panel.querySelector('#d-start');
    if (startSel && startSel.value) d.startNode = startSel.value;

    // 对话框演出配置（对话级）：类型 + 三套美术路径；
    // 全部为默认值时删除字段，保持 JSON 干净。
    const boxTypeEl = panel.querySelector('#d-box-type');
    const portraitImageEl = panel.querySelector('#d-portrait-image');
    const halfBodyImageEl = panel.querySelector('#d-halfbody-image');
    const fullBodyImageEl = panel.querySelector('#d-fullbody-image');
    if (boxTypeEl && portraitImageEl && halfBodyImageEl && fullBodyImageEl) {
      const boxType = boxTypeEl.value;
      const portraitImage = portraitImageEl.value.trim();
      const halfBodyImage = halfBodyImageEl.value.trim();
      const fullBodyImage = fullBodyImageEl.value.trim();
      const isDefault = boxType === 'portrait' && !portraitImage && !halfBodyImage && !fullBodyImage;
      if (isDefault) delete d.presentation;
      else {
        d.presentation = { boxType };
        if (portraitImage) d.presentation.portraitImage = portraitImage;
        if (halfBodyImage) d.presentation.halfBodyImage = halfBodyImage;
        if (fullBodyImage) d.presentation.fullBodyImage = fullBodyImage;
      }
    }

    panel.querySelectorAll('.dlg-node').forEach(card => {
      const nid = card.dataset.nid;
      const n = d.nodes[nid];
      if (!n) return;
      n.speaker = card.querySelector('.n-speaker').value;
      const portrait = card.querySelector('.n-portrait').value.trim();
      if (portrait) n.portrait = portrait;
      else if (Object.prototype.hasOwnProperty.call(n, 'portrait')) {
        n.portrait = n.portrait === null ? null : '';
      }
      n.text = card.querySelector('.n-text').value;

      const choiceEls = card.querySelectorAll('.dlg-choice');
      if (choiceEls.length > 0) {
        const previousChoices = Array.isArray(n.choices) ? n.choices : [];
        n.choices = [];
        delete n.nextNode;
        choiceEls.forEach((ce, idx) => {
          const previous = previousChoices[idx] || {};
          const ch = {
            ...previous,
            id: previous.id || 'ch_' + (idx + 1),
            text: ce.querySelector('.ch-text').value,
            nextNode: ce.querySelector('.ch-next').value || null
          };
          const ifv = ce.querySelector('.ch-if').value.trim();
          const dov = ce.querySelector('.ch-do').value.trim();
          if (ifv) ch.if = this._parseJson(ifv, undefined); else delete ch.if;
          if (dov) ch.do = this._parseJson(dov, undefined); else delete ch.do;
          n.choices.push(ch);
        });
      } else {
        delete n.choices;
        const nextSel = card.querySelector('.n-next');
        if (nextSel?.value) n.nextNode = nextSel.value;
        else if (Object.prototype.hasOwnProperty.call(n, 'nextNode')) n.nextNode = null;
      }
    });
  }

  _addDialogue() {
    this._commitDetail();
    const id = 'dlg_' + Date.now().toString(36);
    this.dialogues.push({
      id, title: '新对话', startNode: 'start',
      nodes: { start: { speaker: '', portrait: null, text: '', nextNode: null } }
    });
    this.selectedIndex = this.dialogues.length - 1;
    this._renderList();
    this._renderDetail();
  }

  _deleteDialogue() {
    if (this.selectedIndex < 0) return;
    this.dialogues.splice(this.selectedIndex, 1);
    this.selectedIndex = Math.min(this.selectedIndex, this.dialogues.length - 1);
    this._renderList();
    this._renderDetail();
  }

  // ---- JSON 校验 ----
  _validateAllJson() {
    const panel = this.container.querySelector('#dlg-detail');
    if (!panel) return false;
    let hasError = false;
    panel.querySelectorAll('.ch-if, .ch-do').forEach(el => {
      const v = el.value.trim();
      if (!v) return;
      try { JSON.parse(v); } catch (e) { el.style.borderColor = '#e05252'; hasError = true; }
    });
    return hasError;
  }

  _bindJsonValidation(el) {
    if (!el) return;
    const check = () => {
      const v = el.value.trim();
      if (!v) { el.style.borderColor = '#2a3a5e'; el.title = ''; return true; }
      try { JSON.parse(v); el.style.borderColor = '#4a8a4a'; el.title = 'JSON 正确'; return true; }
      catch (e) { el.style.borderColor = '#e05252'; el.title = 'JSON 错误: ' + e.message; return false; }
    };
    el.addEventListener('input', check);
    check();
  }

  _json(v) { try { return JSON.stringify(v); } catch (e) { return ''; } }
  _parseJson(str, fallback) {
    if (!str || !str.trim()) return fallback;
    try { return JSON.parse(str); } catch (e) { return fallback; }
  }
  _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

export default DialogueGraphEditor;
