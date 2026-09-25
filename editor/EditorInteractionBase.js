import { EditorDataManager, loadBuiltinGamesConfig, loadScenePresetsConfig, loadSceneTemplatesConfig } from './EditorDataManager.js';
        import { SceneEditor, loadEditorDefaults } from './SceneEditor.js';
        import { ImageSlicer } from './ImageSlicer.js';
        import {
            SceneDataLoader,
            activateGlobalAtlasesProject,
            getGlobalAtlasesConfig,
            loadGlobalAtlasesConfig
        } from './SceneDataLoader.js';
        import { UIEditor } from './UIEditor.js';
        import { TriggerEditor } from './TriggerEditor.js';
        import { LibraryEditor } from './LibraryEditor.js';
        import { DialogueGraphEditor } from './DialogueGraphEditor.js';
        import { WorldMapEditor } from './WorldMapEditor.js';
        import { PanelEditor } from './PanelEditor.js';
        import { SystemEditor } from './SystemEditor.js';
        import { CanonicalDocumentService } from './CanonicalDocumentService.js';
        import { CanonicalEditorSession } from './CanonicalEditorSession.js';
        import { EditorSceneCommandService } from './EditorSceneCommandService.js';
        import { SharedAtlasCommandService } from './SharedAtlasCommandService.js';
        import { LocalStorageSceneCacheAdapter } from '../src/core/scene/CanonicalSceneAdapters.js';
        import { mergeShardedProject } from '../src/core/projectShards.js';
        
        
export class EditorInteractionBase {
            constructor() {
                this.dataManager = new EditorDataManager();
                this.sceneLoader = new SceneDataLoader();
                this.sceneEditor = null;
                this.uiEditor = null;
                this.triggerEditor = null;
                this.libraryEditor = null;
                this.dialogueEditor = null;
                this.imageSlicer = null;
                this.currentGameId = null;
                this.currentSceneId = null;
                this._gameContextGeneration = 0;
                this._projectDefinitions = { triggers: [], tutorials: [] };
                this._projectTriggers = [];
                this._projectBattles = [];
                this._presentationProfile = null;
                this.documentService = new CanonicalDocumentService();
                this._sceneCommandServices = new Map();
                this.sharedAtlasCommandService = new SharedAtlasCommandService();
                
                this._initAsync();
            }
            
            async _initAsync() {
                // 先加载所有 JSON 配置
                await Promise.all([
                    loadEditorDefaults(),
                    loadBuiltinGamesConfig(),
                    loadScenePresetsConfig(),
                    loadSceneTemplatesConfig()
                ]);
                // 用加载的配置初始化数据管理器
                await this.dataManager.init();
                
                this.init();
            }
            
            init() {
                this.renderBuiltinGames();
                this.renderCustomGames();
                this.bindEvents();
            }
            
            // 渲染内置游戏
            renderBuiltinGames() {
                const grid = document.getElementById('builtin-games-grid');
                const games = this.dataManager.getBuiltinGames();
                
                grid.innerHTML = games.map(game => `
                    <div class="game-card" data-id="${game.id}">
                        <div class="game-card-thumbnail">
                            <img src="${game.thumbnail}" alt="${game.name}" onerror="this.style.display='none';this.parentElement.innerHTML='<div class=\\'placeholder\\'>🎮</div>'">
                        </div>
                        <div class="game-card-info">
                            <h3>${game.name}</h3>
                            <p>${game.description}</p>
                            <div class="game-card-actions">
                                <button class="primary" data-action="edit">编辑游戏</button>
                                <button data-action="play">运行游戏</button>
                            </div>
                        </div>
                    </div>
                `).join('');
            }
            
            // 渲染用户游戏
            renderCustomGames() {
                const grid = document.getElementById('custom-games-grid');
                const games = this.dataManager.getCustomGames();
                
                let html = games.map(game => `
                    <div class="game-card" data-id="${game.id}" data-custom="true">
                        <div class="game-card-thumbnail">
                            ${game.thumbnail 
                                ? `<img src="${game.thumbnail}" alt="${game.name}" onerror="this.style.display='none';this.parentElement.innerHTML='<div class=\\'placeholder\\'>🎮</div>'">`
                                : '<div class="placeholder">🎮</div>'
                            }
                        </div>
                        <div class="game-card-info">
                            <h3>${game.name}</h3>
                            <p>${game.description || '暂无描述'}</p>
                            <div class="game-card-actions">
                                <button class="primary" data-action="edit">编辑</button>
                                <button data-action="delete">删除</button>
                            </div>
                        </div>
                    </div>
                `).join('');
                
                // 添加新建游戏卡片
                html += `
                    <div class="new-game-card" id="new-game-btn">
                        <div class="icon">+</div>
                        <span>创建新游戏</span>
                    </div>
                `;
                
                grid.innerHTML = html;
            }
            
            // 绑定事件
            bindEvents() {
                // 导航按钮
                document.getElementById('nav-game-list').addEventListener('click', () => this.showPage('game-list'));
                document.getElementById('nav-scene-editor').addEventListener('click', () => this.showPage('scene-editor'));
                document.getElementById('nav-ui-editor').addEventListener('click', () => this.showPage('ui-editor'));
                document.getElementById('nav-trigger-editor').addEventListener('click', () => this.showPage('trigger-editor'));
                document.getElementById('nav-library-editor').addEventListener('click', () => this.showPage('library-editor'));
                document.getElementById('nav-world-map-editor').addEventListener('click', () => this.showPage('world-map-editor'));
                document.getElementById('nav-dialogue-editor').addEventListener('click', () => this.showPage('dialogue-editor'));
                document.getElementById('nav-panel-editor').addEventListener('click', () => this.showPage('panel-editor'));
                document.getElementById('nav-system-editor').addEventListener('click', () => this.showPage('system-editor'));
                document.getElementById('nav-home').addEventListener('click', () => window.location.href = '../index.html');
                
                // 游戏卡片点击
                document.getElementById('builtin-games-grid').addEventListener('click', (e) => this.handleGameCardClick(e));
                document.getElementById('custom-games-grid').addEventListener('click', (e) => this.handleGameCardClick(e));
                
                // 新建游戏
                document.getElementById('new-game-btn').addEventListener('click', () => this.showModal('new-game-modal'));
                document.getElementById('cancel-new-game').addEventListener('click', () => this.hideModal('new-game-modal'));
                document.getElementById('confirm-new-game').addEventListener('click', () => this.createGame());
                
                // 新建场景
                document.getElementById('new-scene-btn').addEventListener('click', () => { this.populateSceneTemplates(); this.showModal('new-scene-modal'); });
                document.getElementById('cancel-new-scene').addEventListener('click', () => this.hideModal('new-scene-modal'));
                // 模板下拉切换：更新描述，并把模板的宽高/背景色回填到表单（用户仍可再改）
                document.getElementById('scene-template').addEventListener('change', () => this.onSceneTemplateChange());
                document.getElementById('confirm-new-scene').addEventListener('click', () => this.createScene());

                // 新建场景模板
                document.getElementById('new-template-btn').addEventListener('click', () => this.createNewTemplate());
                
                // 场景筛选器
                document.getElementById('scene-filter-type').addEventListener('change', (e) => {
                    const wmSelect = document.getElementById('scene-filter-worldmap');
                    if (e.target.value === 'worldChunk') {
                        wmSelect.style.display = '';
                        this._populateWorldMapFilter();
                    } else {
                        wmSelect.style.display = 'none';
                    }
                    if (this.currentGameId) this.renderSceneList(this.currentGameId);
                });
                document.getElementById('scene-filter-worldmap').addEventListener('change', () => {
                    if (this.currentGameId) this.renderSceneList(this.currentGameId);
                });

                // 图片分割工具关闭
                document.getElementById('slicer-modal').addEventListener('click', (e) => {
                    if (e.target.id === 'slicer-modal') this.hideModal('slicer-modal');
                });
            }
            
            // 处理游戏卡片点击
            handleGameCardClick(e) {
                const card = e.target.closest('.game-card');
                if (!card) return;
                
                const gameId = card.dataset.id;
                const action = e.target.dataset.action;
                
                if (action === 'edit') {
                    this.editGame(gameId);
                } else if (action === 'play') {
                    this.playGame(gameId);
                } else if (action === 'delete') {
                    this.deleteGame(gameId);
                }
            }
            
            /**
             * 在任何项目异步加载前同步推进共享图集活动上下文，封闭 A→B→A 迟到回调窗口。
             */
            _activateSharedAtlasProjectContext(game = this.dataManager.getCurrentGame()) {
                const projectPath = this._canonicalProjectPath(game);
                activateGlobalAtlasesProject(projectPath);
                this.sceneEditor?.activateSharedAtlasProject(projectPath);
                return {
                    projectPath,
                    ready: loadGlobalAtlasesConfig(projectPath)
                };
            }

            _sceneEditorOptions() {
                return {
                    getSceneList: () => this.dataManager.getGameScenes(this.currentGameId),
                    getProjectDefinitions: () => this._projectDefinitions,
                    getProjectTriggers: () => this._projectDefinitions.triggers,
                    getBattleDefinitions: () => this._projectBattles,
                    getProjectPath: () => this._canonicalProjectPath(),
                    getSharedAtlasCatalog: projectPath => {
                        const catalog = getGlobalAtlasesConfig(projectPath);
                        return catalog ? structuredClone(catalog) : null;
                    },
                    saveSharedAtlasCatalog: (projectPath, catalog) => this.sharedAtlasCommandService.save(
                        projectPath,
                        catalog
                    ),
                    getContentLibrary: () => {
                        const model = this.documentService.requireProject(this._canonicalProjectPath());
                        return structuredClone(model.getCandidate().project?.library || {});
                    },
                    saveContentLibrary: async (library) => {
                        const projectPath = this._canonicalProjectPath();
                        const session = this._canonicalEditorSession('project');
                        const expectedCampfirePresentation = structuredClone(
                            library?.items?.find(item => item?.id === 'story.s01.campfire')?.campfirePresentation?.presentation || null
                        );
                        console.info('[EditorInteraction][ContentLibrarySave] patch-before', {
                            projectPath,
                            expectedCampfirePresentation,
                            candidateBefore: this.documentService.requireProject(projectPath)
                                .getCandidate().project?.library?.items
                                ?.find(item => item?.id === 'story.s01.campfire')?.campfirePresentation?.presentation || null
                        });
                        session.patch('library', structuredClone(library));
                        console.info('[EditorInteraction][ContentLibrarySave] patch-after', {
                            projectPath,
                            candidateAfter: session.model.getCandidate().project?.library?.items
                                ?.find(item => item?.id === 'story.s01.campfire')?.campfirePresentation?.presentation || null
                        });
                        const result = await session.save();
                        console.info('[EditorInteraction][ContentLibrarySave] session-save-result', {
                            projectPath,
                            ok: result?.ok,
                            committed: result?.committed,
                            code: result?.code,
                            transactionId: result?.transactionId,
                            changes: result?.changes?.map(change => ({ operation: change.operation, path: change.path }))
                        });
                        if (result?.ok !== true || result.committed !== true) return result;
                        try {
                            const project = await this._readCanonicalJson(projectPath);
                            console.info('[EditorInteraction][ContentLibrarySave] disk-readback', {
                                projectPath,
                                expectedCampfirePresentation,
                                committedCampfirePresentation: project.library?.items
                                    ?.find(item => item?.id === 'story.s01.campfire')?.campfirePresentation?.presentation || null
                            });
                            session.acceptExternalProjectCommit(project, {
                                snapshotRevision: result.snapshotRevision
                            });
                            return { ...result, project, library: structuredClone(project.library || {}) };
                        } catch (error) {
                            console.error('[EditorInteraction] 内容库提交后磁盘回读失败', error);
                            return {
                                ...result,
                                ok: false,
                                code: 'contentLibraryReadbackFailed',
                                error
                            };
                        }
                    },
                    presentationProfile: this._presentationProfile,
                    openTriggerEditor: (definitionId, target = 'triggers') => this._openTriggerEditor(definitionId, target),
                    previewTrigger: (binding, trigger) => {
                        const message = trigger
                            ? `${binding.triggerId}：${this.sceneEditor?.getTriggerSummary(binding.triggerId) || ''}`
                            : `${binding.triggerId || '未绑定'}：项目行为不存在`;
                        this.sceneEditor?.ui?.showToast(message, trigger ? 'success' : 'error');
                    }
                };
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
                        if (project) {
                            // shards 分片：读取分片并浅合并（triggers/tutorials 等大字段存分片文件）
                            const root = projectPath.slice(0, -'/game.project.json'.length);
                            project = await mergeShardedProject(project, async rel => {
                                const shardResponse = await fetch('/api/read-file?path=' + encodeURIComponent(`${root}/${rel}`));
                                const shardData = shardResponse.ok ? await shardResponse.json() : null;
                                if (!shardData?.ok || typeof shardData.content !== 'string') {
                                    throw new Error(shardData?.error || `无法读取分片文件: ${rel}`);
                                }
                                return JSON.parse(shardData.content);
                            });
                        }
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
                this.sceneEditor?.setPresentationProfile?.(this._presentationProfile || {});
                this.sceneEditor?.refreshTriggerReferences?.();
                return this._projectTriggers;
            }

            async _openTriggerEditor(definitionId, target = 'triggers') {
                this.showPage('trigger-editor');
                await this.triggerEditor?.init?.();
                if (definitionId && !this.triggerEditor?.selectById?.(definitionId, target)) {
                    const label = target === 'tutorials' ? 'Tutorial' : 'Trigger';
                    this.sceneEditor?.ui?.showToast(`项目中不存在 ${label} ${definitionId}`, 'error');
                }
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

}

export default EditorInteractionBase;
