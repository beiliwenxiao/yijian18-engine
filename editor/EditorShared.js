/**
 * EditorShared - 编辑器多页面共享模块
 * 负责：URL 参数解析、游戏/场景状态恢复、canonical 服务初始化、页面跳转
 */

import { EditorDataManager } from './EditorDataManager.js';
import { CanonicalDocumentService } from './CanonicalDocumentService.js';
import { CanonicalEditorSession } from './CanonicalEditorSession.js';
import { EditorSceneCommandService } from './EditorSceneCommandService.js';
import { SharedAtlasCommandService } from './SharedAtlasCommandService.js';
import { LocalStorageSceneCacheAdapter } from '../src/core/scene/CanonicalSceneAdapters.js';
import { InputHints } from '../src/core/input/InputHints.js';

// 页面注册表：页面 ID → HTML 文件名
export const EDITOR_PAGES = Object.freeze({
  'game-list': 'index.html',
  'scene-workflow': 'scene-workflow.html',
  'quest-editor': 'quest-editor.html',
  'storyline-editor': 'storyline-editor.html',
  'tutorial-editor': 'tutorial-editor.html',
  'ui-editor': 'ui-editor.html',
  'library-editor': 'library-editor.html',
  'item-reference': 'item-reference.html',
  'dialogue-editor': 'dialogue-editor.html',
  'world-map-editor': 'world-map-editor.html',
  'panel-editor': 'panel-editor.html',
  'system-editor': 'system-editor.html'
});

// 导航项定义（分组即显示分组，组间渲染分隔线）。
// 「⌨ 按钮写法」「📦 物体写法」是弹层入口（非页面），挂在场景编辑器的标签栏（scene-workflow.html）「⚡ 事件/触发器」之后，
// 通过 openButtonHelp / openItemReferenceModal 打开，不在顶部导航出现。
const NAV_GROUPS = Object.freeze([
  { label: '', items: [
    { id: 'game-list', label: '🎮 游戏列表', file: 'index.html' }
  ]},
   { label: '场景世界', items: [
    { id: 'scene-workflow', label: '🗺️ 场景', file: 'scene-workflow.html' },
    { id: 'world-map-editor', label: '🌍 大地图', file: 'world-map-editor.html' }
  ]},
  { label: '剧情创作', items: [
    { id: 'quest-editor', label: '📋 任务', file: 'quest-editor.html' },
    { id: 'storyline-editor', label: '🎬 剧情', file: 'storyline-editor.html' },
    { id: 'tutorial-editor', label: '📖 教程', file: 'tutorial-editor.html' },
    { id: 'dialogue-editor', label: '💬 对话', file: 'dialogue-editor.html' }
  ]},
  { label: '资产系统', items: [
    { id: 'ui-editor', label: '🎨 UI', file: 'ui-editor.html' },
    { id: 'panel-editor', label: '🧩 面板', file: 'panel-editor.html' },
    { id: 'library-editor', label: '📚 内容库', file: 'library-editor.html' },
    { id: 'system-editor', label: '⚙️ 系统', file: 'system-editor.html' }
  ]}
]);

// 扁平视图（兼容既有引用）：分组导航的一维展开
const NAV_ITEMS = Object.freeze(NAV_GROUPS.flatMap(group => group.items));

/**
 * 渲染统一导航栏到指定容器
 * @param {string} currentPageId - 当前页面 ID（用于高亮）
 * @param {string} containerId - 容器元素 ID（默认 'editor-nav'）
 */
export function renderEditorNav(currentPageId, containerId = 'editor-nav') {
  const container = document.getElementById(containerId);
  if (!container) return;

  // 注入共享样式（只注入一次）
  if (!document.getElementById('editor-shared-nav-styles')) {
    const style = document.createElement('style');
    style.id = 'editor-shared-nav-styles';
    style.textContent = `
      .editor-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 20px; background: #16213e; border-bottom: 1px solid #2a3a5e; flex-shrink: 0; overflow-x: auto; }
      .editor-header h1 { font-size: 18px; color: #4CAF50; margin: 0; white-space: nowrap; flex-shrink: 0; }
      .editor-nav { display: flex; gap: 8px; align-items: center; }
      .editor-nav button { padding: 6px 12px; background: #3a4a7e; border: none; border-radius: 4px; color: #fff; cursor: pointer; font-size: 13px; white-space: nowrap; flex-shrink: 0; }
      .editor-nav button:hover { background: #4a5a9e; }
      .editor-nav button.active { background: #4CAF50; color: #000; }
      .editor-nav .nav-group-divider { width: 1px; height: 20px; background: #3a4a7e; margin: 0 6px; flex-shrink: 0; }
      .editor-nav .nav-group-label { font-size: 11px; color: #6a7a9e; margin-right: -2px; align-self: center; white-space: nowrap; flex-shrink: 0; }
      .game-selector { padding: 6px 12px; background: #2a3a5e; border: 1px solid #4CAF50; border-radius: 4px; color: #fff; font-size: 13px; margin-left: 12px; }
      .game-selector-label { color: #aaa; font-size: 12px; margin-right: 4px; }
    `;
    document.head.appendChild(style);
  }

  const gameId = new URLSearchParams(window.location.search).get('gameId') || '';
  const query = gameId ? `?gameId=${encodeURIComponent(gameId)}` : '';

  container.innerHTML = `
    <div class="editor-header">
      <h1>🎮 游戏编辑器</h1>
      <nav class="editor-nav">
        ${NAV_GROUPS.map((group, groupIndex) => {
          const buttons = group.items.map(item => `
            <button class="${item.id === currentPageId ? 'active' : ''}"
                    onclick="window.location.href='${item.file}${query}'">
              ${item.label}
            </button>`).join('');
          const divider = groupIndex > 0 ? '<span class="nav-group-divider" title="分组"></span>' : '';
          const groupLabel = group.label ? `<span class="nav-group-label">${group.label}</span>` : '';
          return `${divider}${groupLabel}${buttons}`;
        }).join('')}
      </nav>
      <span class="game-selector-label">游戏:</span><select id="game-selector" class="game-selector"></select>
    </div>
  `;

  // 填充游戏选择器（所有页面统一处理）
  const selector = container.querySelector('#game-selector');
  if (selector) {
    const games = new EditorDataManager().getAllGames();
    if (gameId) {
      selector.innerHTML = games.map(g =>
        `<option value="${g.id}" ${g.id === gameId ? 'selected' : ''}>${g.name}</option>`
      ).join('');
    } else {
      selector.innerHTML = '<option value="">选择游戏...</option>' + games.map(g =>
        `<option value="${g.id}">${g.name}</option>`
      ).join('');
    }
    selector.addEventListener('change', (e) => {
      const newGameId = e.target.value;
      if (!newGameId) return;
      const url = new URL(window.location);
      url.searchParams.set('gameId', newGameId);
      window.location.href = url.toString();
    });
  }
}

/* -------------------------------------------------------------------------- */
/* 「按钮写法」全局弹层（顶部导航入口，所有编辑器页面可用）                     */
/* -------------------------------------------------------------------------- */

const _escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let _hintsConfigLoaded = false;

/** 合并项目已保存的提示文案覆盖（config/InputHints.json），与 UIEditor「提示文案」读取同一文件。 */
async function ensureInputHintsConfig(gameId) {
  if (_hintsConfigLoaded) return;
  _hintsConfigLoaded = true;
  try {
    const file = `example/${gameId}/config/InputHints.json`;
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

/** 从 InputHints 汇总全部可用动作写法。 */
function buttonReferenceRows() {
  return Object.entries(InputHints.getActions()).map(([name, def]) => {
    const pc = def?.pc || {};
    let pcText;
    try { pcText = InputHints.phrase(name) || pc.key || name; }
    catch (e) { pcText = (pc.kind === 'raw' ? '点击' : '按 ') + (pc.key || name); }
    return {
      tokens: `{${name}}　{key:${name}}`,
      pc: _escapeHtml(pcText),
      android: _escapeHtml(def?.android || '—'),
      pad: _escapeHtml(def?.padKey || def?.padFixed || '—')
    };
  });
}

/** 「按钮写法」全局弹层内容（不含外层 overlay 容器）。 */
function buttonHelpModalBody() {
  const rows = buttonReferenceRows();
  const body = rows.length
    ? `<div class="story-help-row story-help-head">
          <span>写法（可直接拷贝）</span><span>键鼠</span><span>触屏</span><span>手柄</span>
        </div>`
      + rows.map(row => `
        <div class="story-help-row">
          <code class="story-help-tokens" title="点击拷贝">${_escapeHtml(row.tokens)}</code>
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

function injectButtonHelpStyles() {
  if (document.getElementById('story-btn-help-styles')) return;
  const style = document.createElement('style');
  style.id = 'story-btn-help-styles';
  style.textContent = `
    .story-btn-help-overlay{position:fixed;inset:0;background:rgba(5,10,25,.72);z-index:10000;display:flex;align-items:center;justify-content:center;}
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

/** 打开全局「按钮写法」弹层（挂在 body，场景编辑器标签栏入口等处可用）。 */
export async function openButtonHelp({ gameId = '' } = {}) {
  await ensureInputHintsConfig(gameId);
  injectButtonHelpStyles();
  const overlay = document.createElement('div');
  overlay.className = 'story-btn-help-overlay';
  overlay.innerHTML = buttonHelpModalBody();
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.story-btn-help-close').addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  for (const el of overlay.querySelectorAll('.story-help-tokens')) {
    el.addEventListener('click', () => {
      try { navigator.clipboard?.writeText?.(el.textContent || ''); } catch (e) { /* 忽略剪贴板拒绝 */ }
    });
  }
}

function injectItemRefModalStyles() {
  if (document.getElementById('item-ref-modal-styles')) return;
  const style = document.createElement('style');
  style.id = 'item-ref-modal-styles';
  style.textContent = `
    .item-ref-overlay{position:fixed;inset:0;background:rgba(5,10,25,.72);z-index:10000;display:flex;align-items:center;justify-content:center;}
    .item-ref-modal{width:min(960px,94vw);height:86vh;display:flex;flex-direction:column;background:#0a0a1e;color:#fff;border:1px solid #2a3a5e;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.55);overflow:hidden;}
    .item-ref-modal-head{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#101a30;border-bottom:1px solid #2a3a5e;}
    .item-ref-modal-sub{color:#8aa;font-size:11px;}
    .item-ref-modal-close{margin-left:auto;background:#3a4a7e;border:none;color:#fff;border-radius:4px;padding:4px 10px;cursor:pointer;}
    .item-ref-modal-frame{flex:1;width:100%;border:none;background:#0a0a1e;}
  `;
  document.head.appendChild(style);
}

/** 打开「物体写法」弹窗（iframe 内嵌 item-reference.html，不切换/跳转页面）。 */
export function openItemReferenceModal({ gameId = '' } = {}) {
  if (document.querySelector('.item-ref-overlay')) return;
  injectItemRefModalStyles();
  const overlay = document.createElement('div');
  overlay.className = 'item-ref-overlay';
  const query = gameId ? `?gameId=${encodeURIComponent(gameId)}` : '';
  overlay.innerHTML = `
    <div class="item-ref-modal">
      <div class="item-ref-modal-head">
        <strong>📦 物体写法</strong>
        <span class="item-ref-modal-sub">内容库物品/装备/资源节点等 ID 参考，点击物品 ID 可复制</span>
        <button type="button" class="item-ref-modal-close" title="关闭">✕</button>
      </div>
      <iframe class="item-ref-modal-frame" title="物体写法" src="item-reference.html${query}"></iframe>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.item-ref-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
}

/** 从当前 URL 读取查询参数 */
export function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    gameId: params.get('gameId') || null,
    sceneId: params.get('sceneId') || null,
    page: params.get('page') || null
  };
}

/** 构建带参数的页面 URL */
export function buildPageUrl(pageId, { gameId = null, sceneId = null } = {}) {
  const file = EDITOR_PAGES[pageId];
  if (!file) throw new Error(`Unknown editor page: ${pageId}`);
  const params = new URLSearchParams();
  if (gameId) params.set('gameId', gameId);
  if (sceneId) params.set('sceneId', sceneId);
  const query = params.toString();
  return query ? `${file}?${query}` : file;
}

/** 跳转到指定编辑器页面 */
export function navigateTo(pageId, context = {}) {
  window.location.href = buildPageUrl(pageId, context);
}

/**
 * 编辑器页面基础上下文：初始化数据管理器 + canonical 服务，恢复游戏/场景状态
 * 每个独立编辑器页面的入口 JS 都应通过此函数获取上下文
 */
export class EditorPageContext {
  constructor() {
    this.dataManager = new EditorDataManager();
    this.documentService = new CanonicalDocumentService();
    this._sceneCommandServices = new Map();
    this.sharedAtlasCommandService = new SharedAtlasCommandService();
    this.currentGameId = null;
    this.currentSceneId = null;
    this._projectDefinitions = { triggers: [], tutorials: [] };
    this._projectTriggers = [];
    this._projectBattles = [];
    this._presentationProfile = null;
  }

  /** 初始化并恢复 URL 参数中的游戏/场景状态 */
  async init() {
    const { loadBuiltinGamesConfig, loadScenePresetsConfig, loadSceneTemplatesConfig } =
      await import('./EditorDataManager.js');
    const { loadEditorDefaults } = await import('./SceneEditor.js');

    await Promise.all([
      loadEditorDefaults(),
      loadBuiltinGamesConfig(),
      loadScenePresetsConfig(),
      loadSceneTemplatesConfig()
    ]);
    await this.dataManager.init();

    // 从 URL 恢复当前游戏/场景
    const { gameId, sceneId } = getQueryParams();
    if (gameId) {
      await this.setCurrentGame(gameId, sceneId);
    }
    return this;
  }

  async setCurrentGame(gameId, sceneId = null) {
    this.currentGameId = gameId;
    this.currentSceneId = sceneId;
    const game = this.dataManager.setCurrentGame(gameId);
    window._editorCurrentGame = game;
    if (!game) return null;

    await this.dataManager.initScenesFromFile(gameId);
    await this._ensureCanonicalProject(game);
    await this._refreshProjectTriggers();
    return game;
  }

  _canonicalProjectPath(game = this.dataManager.getCurrentGame()) {
    return `${game?.path || '../example/sanguo_zhangjiao/'}game.project.json`
      .replace(/\\/g, '/')
      .replace(/^(?:\.\.\/)+/, '');
  }

  async _readCanonicalJson(filePath) {
    const response = await fetch('/api/read-file?path=' + encodeURIComponent(filePath));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok || typeof payload.content !== 'string') {
      throw new Error(payload.error || `无法读取 canonical 文件: ${filePath}`);
    }
    return JSON.parse(payload.content);
  }

  async _loadCanonicalProjectAggregate(projectPath) {
    const project = await this._readCanonicalJson(projectPath);
    const root = projectPath.slice(0, -'/game.project.json'.length);
    const sceneRoot = `${root}/assets/scenes/`;
    const sceneOrder = await this._readCanonicalJson(`${sceneRoot}_scene_order.json`);
    const scenes = {};
    await Promise.all((project.scenes || []).map(async entry => {
      scenes[entry.id] = await this._readCanonicalJson(`${sceneRoot}${entry.id}.json`);
    }));
    return { project, sceneOrder, scenes };
  }

  async _ensureCanonicalProject(game) {
    const projectPath = this._canonicalProjectPath(game);
    if (!this.documentService.getProject(projectPath)) {
      const canonical = await this._loadCanonicalProjectAggregate(projectPath);
      this.documentService.openProject({ sourceUri: projectPath, canonical, snapshotRevision: 1 });
    }
    if (!this._sceneCommandServices.has(projectPath)) {
      this._sceneCommandServices.set(projectPath, new EditorSceneCommandService({
        documentService: this.documentService,
        cacheAdapter: new LocalStorageSceneCacheAdapter({ gameId: game.id }),
        readCommittedSnapshot: async () => ({
          canonical: await this._loadCanonicalProjectAggregate(projectPath),
          snapshotRevision: this.documentService.requireProject(projectPath).snapshotRevision + 1
        }),
        notifier: event => window.dispatchEvent(new CustomEvent('editor-canonical-committed', { detail: event }))
      }));
    }
    return this._sceneCommandServices.get(projectPath);
  }

  _sceneCommands() {
    const projectPath = this._canonicalProjectPath();
    const service = this._sceneCommandServices.get(projectPath);
    if (!service) throw new Error('canonical 项目尚未打开');
    return { service, projectPath };
  }

  _sharedAtlasCommands() {
    return {
      service: this.sharedAtlasCommandService,
      projectPath: this._canonicalProjectPath()
    };
  }

  _canonicalEditorSession(rootPath = 'project', schemaId = 'gameProject') {
    const { service, projectPath } = this._sceneCommands();
    return new CanonicalEditorSession({
      sourceUri: projectPath,
      documentService: this.documentService,
      commandService: service,
      schemaRegistry: service.validator.projectPipeline.contentValidator,
      consumptionRegistry: service.validator.configConsumptionRegistry,
      schemaId,
      rootPath
    });
  }

  async _refreshProjectTriggers(project = null) {
    try {
      const game = this.dataManager.getCurrentGame();
      const gamePath = game ? game.path : '../example/sanguo_zhangjiao/';
      if (!project) {
        const projectPath = `${gamePath}game.project.json`.replace(/^\.\.\//, '');
        const response = await fetch('/api/read-file?path=' + encodeURIComponent(projectPath));
        const data = response.ok ? await response.json() : null;
        project = data?.ok && data.content ? JSON.parse(data.content) : null;
      }
      this._projectDefinitions = {
        triggers: Array.isArray(project?.triggers) ? project.triggers : [],
        tutorials: Array.isArray(project?.tutorials) ? project.tutorials : []
      };
      this._projectTriggers = this._projectDefinitions.triggers;
      const battleEntries = Array.isArray(project?.battles) ? project.battles : [];
      this._projectBattles = (await Promise.all(battleEntries.map(async entry => {
        if (entry?.battleId) return entry;
        if (!entry?.$ref) return null;
        try {
          const battlePath = `${gamePath}${entry.$ref}`.replace(/^\.\.\//, '');
          const response = await fetch('/api/read-file?path=' + encodeURIComponent(battlePath));
          const data = response.ok ? await response.json() : null;
          return data?.ok && data.content ? JSON.parse(data.content) : null;
        } catch (error) {
          console.warn(`[Editor] 加载战役定义失败: ${entry.$ref}`, error);
          return null;
        }
      }))).filter(entry => entry?.battleId);
      this._presentationProfile = null;
      const profileRef = project?.presentation?.$ref;
      if (profileRef) {
        const profilePath = `${gamePath}${profileRef}`.replace(/^\.\.\//, '');
        const response = await fetch('/api/read-file?path=' + encodeURIComponent(profilePath));
        const data = response.ok ? await response.json() : null;
        this._presentationProfile = data?.ok && data.content ? JSON.parse(data.content) : null;
      }
    } catch (error) {
      console.warn('[Editor] 加载项目触发器/战役/表现规格失败', error);
      this._projectDefinitions = { triggers: [], tutorials: [] };
      this._projectTriggers = this._projectDefinitions.triggers;
      this._projectBattles = [];
      this._presentationProfile = null;
    }
    return this._projectTriggers;
  }

  /** 供 TriggerEditor 等使用的场景文档获取器 */
  getSceneDocuments() {
    let scenes = {};
    try {
      scenes = {
        ...this.documentService.requireProject(this._canonicalProjectPath()).getCommittedSnapshot().scenes
      };
    } catch (error) {
      console.warn('EditorPageContext: 获取 committed 场景快照失败', error);
    }
    return Object.values(scenes);
  }

  /** 供 TriggerEditor 等使用的放置点获取器 */
  getPlacementOptions(sceneEditor = null) {
    const sceneData = sceneEditor?.sceneData;
    const sceneId = this.currentSceneId || sceneData?.id || '';
    return (sceneData?.layers || []).flatMap(layer =>
      (layer?.objects || []).filter(object => object?.type === 'ref')
        .map(object => ({ ...object, sceneId: object.sceneId || sceneId }))
    );
  }

  /**
   * 获取当前游戏 ID（用于保存时传递）
   * @returns {string|null}
   */
  getGameId() {
    return this.currentGameId;
  }

  /**
   * 获取当前游戏名称（用于保存时传递）
   * @returns {string|null}
   */
  getGameName() {
    return this.dataManager.getCurrentGame()?.name || null;
  }

  /**
   * 保存时附加游戏参数（gameId + gameName）
   * 所有编辑器保存操作都应通过此方法包装 payload
   */
  withGameParams(payload = {}) {
    return {
      ...payload,
      gameId: this.currentGameId,
      gameName: this.getGameName()
    };
  }
}

export default EditorPageContext;
