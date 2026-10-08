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

import { EditorDataManager, loadBuiltinGamesConfig, loadScenePresetsConfig, loadSceneTemplatesConfig } from './EditorDataManager.js';
        import { SceneEditor, loadEditorDefaults } from './SceneEditor.js';
        import { ImageSlicer } from './ImageSlicer.js';
        import { SceneDataLoader } from './SceneDataLoader.js';
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
        import { LocalStorageSceneCacheAdapter } from '../src/core/scene/CanonicalSceneAdapters.js';
        
        
import { EditorInteractionScene } from './EditorInteractionScene.js';

/** 仅协调 DOM 交互和编辑器模块；canonical 持久化始终委托 command service。 */
export class GameEditor extends EditorInteractionScene {            // 清理本地 localStorage 缓存（下次从工程 JSON 文件重新加载；文件不受影响）
            async clearSceneCache() {
                const gameId = this.currentGameId || 'sanguo_zhangjiao';
                if (!confirm('确定清理本地缓存？\n将删除 localStorage 中该游戏的场景编辑数据，随后从工程 JSON 文件重新加载（文件不受影响）。')) return;
                try {
                    localStorage.removeItem('yijian18-engine_editor_data_scenes_' + gameId);
                    console.log('[Editor] 已清理 localStorage 场景缓存:', gameId);
                    await this.dataManager.initScenesFromFile(gameId);
                    if (this.currentSceneId) {
                        const loaded = await this.editScene(this.currentSceneId);
                        if (loaded === false) throw new Error(`场景 ${this.currentSceneId} 未能从磁盘重新加载`);
                    } else {
                        this.renderSceneList(gameId);
                    }
                    this.sceneEditor?.ui?.showToast?.('已清理缓存，已从工程文件重新加载', 'success');
                } catch (error) {
                    console.warn('[Editor] 清理缓存后重新加载失败:', error);
                    this.sceneEditor?.ui?.showToast?.(`缓存已清理，但磁盘重载失败: ${error.message}`, 'error');
                }
            }
            
            // 场景排序也作为 update 命令，经完整候选校验后原子提交。
            async _saveSceneOrder(gameId, order) {
                const { service, projectPath } = this._sceneCommands();
                const model = this.documentService.requireProject(projectPath);
                const sceneOrder = model.getCandidate().sceneOrder;
                const result = await service.update(projectPath, {
                    sceneOrder: { ...sceneOrder, order: order.slice() }
                });
                if (result?.ok !== true || result.committed !== true) {
                    throw Object.assign(new Error(this._persistenceError(result, '保存场景排序失败：磁盘未提交')), { result });
                }
                if (result.degraded) this.sceneEditor?.ui?.showToast?.('排序已提交，但缓存/通知同步降级', 'warn');
                return result;
            }
            
            // 打开图片分割工具
            openSlicer() {
                this.showModal('slicer-modal');
                
                if (!this.imageSlicer) {
                    this.imageSlicer = new ImageSlicer(document.getElementById('slicer-container'));
                }
            }
            
            // 更新顶部游戏指示器（显示当前游戏并提供切换下拉）
            _updateGameIndicator(selectedGameId) {
                const indicator = document.getElementById('editor-game-indicator');
                const selector = document.getElementById('game-selector');
                const allGames = this.dataManager.getAllGames();
                
                // 填充下拉列表
                selector.innerHTML = allGames.map(g =>
                    `<option value="${g.id}" ${g.id === selectedGameId ? 'selected' : ''}>${g.name}</option>`
                ).join('');
                
                // 显示指示器
                indicator.style.display = 'flex';
                
                // 绑定切换事件（只绑一次）
                if (!this._gameSelectorBound) {
                    this._gameSelectorBound = true;
                    selector.addEventListener('change', (e) => {
                        const newGameId = e.target.value;
                        this._switchGame(newGameId);
                    });
                }
            }

            // 切换当前游戏（重新加载各子编辑器数据）
            async _switchGame(gameId) {
                const gameContextGeneration = ++this._gameContextGeneration;
                this.currentGameId = gameId;
                this.currentSceneId = null;
                const game = this.dataManager.setCurrentGame(gameId);
                window._editorCurrentGame = game;
                if (!game) return;

                // 与 editGame 相同：真实项目切换必须在首个 await 前推进 SceneEditor epoch。
                const atlasContext = this._activateSharedAtlasProjectContext(game);
                try {
                    await Promise.all([
                        this.dataManager.initScenesFromFile(gameId),
                        atlasContext.ready
                    ]);
                    if (gameContextGeneration !== this._gameContextGeneration) return;
                    await this._ensureCanonicalProject(game);
                    if (gameContextGeneration !== this._gameContextGeneration) return;
                    const bindCanonical = editor => {
                        if (!editor) return;
                        editor.gameId = game.id;
                        editor.projectPath = this._canonicalProjectPath(game);
                        editor.canonicalSession = this._canonicalEditorSession('project');
                    };
                    [this.triggerEditor, this.libraryEditor, this.dialogueEditor, this.systemEditor].forEach(bindCanonical);
                } catch (error) {
                    console.error('[Editor] 切换 canonical 项目失败:', error);
                    alert(`无法打开 canonical 项目: ${error.message}`);
                    return;
                }
                await this._refreshProjectTriggers();
                if (gameContextGeneration !== this._gameContextGeneration) return;

                document.getElementById('current-game-name').textContent = game.name;
                this.renderSceneList(gameId);

                // 销毁已有的子编辑器实例，下次打开时用新 gameId 重建
                if (this.uiEditor) { this.uiEditor = null; document.getElementById('ui-editor-container').innerHTML = ''; }
                if (this.triggerEditor) { this.triggerEditor = null; document.getElementById('trigger-editor-container').innerHTML = ''; }
                if (this.libraryEditor) { this.libraryEditor = null; document.getElementById('library-editor-container').innerHTML = ''; }
                if (this.dialogueEditor) { this.dialogueEditor = null; document.getElementById('dialogue-editor-container').innerHTML = ''; }

                // 重新触发当前活动页面的显示（用新 gameId 重新初始化对应编辑器）
                const activePage = this._getCurrentPage();
                if (activePage && activePage !== 'game-list') {
                    this.showPage(activePage);
                }

                console.log('[Editor] 切换游戏:', game.name, gameId);
            }

            // 获取当前活动页面标识
            _getCurrentPage() {
                if (document.getElementById('scene-editor-page').classList.contains('active')) return 'scene-editor';
                if (document.getElementById('ui-editor-page').classList.contains('active')) return 'ui-editor';
                if (document.getElementById('trigger-editor-page').classList.contains('active')) return 'trigger-editor';
                if (document.getElementById('library-editor-page').classList.contains('active')) return 'library-editor';
                if (document.getElementById('dialogue-editor-page').classList.contains('active')) return 'dialogue-editor';
                if (document.getElementById('panel-editor-page').classList.contains('active')) return 'panel-editor';
                if (document.getElementById('game-list-page').style.display !== 'none') return 'game-list';
                return null;
            }

            // 显示页面
            showPage(page) {
                document.querySelectorAll('.editor-header nav button').forEach(btn => btn.classList.remove('active'));
                const navBtn = document.getElementById(`nav-${page}`);
                if (navBtn) navBtn.classList.add('active');
                
                // 先全部隐藏
                document.getElementById('game-list-page').style.display = 'none';
                document.getElementById('scene-editor-page').classList.remove('active');
                document.getElementById('ui-editor-page').classList.remove('active');
                document.getElementById('trigger-editor-page').classList.remove('active');
                document.getElementById('library-editor-page').classList.remove('active');
                document.getElementById('dialogue-editor-page').classList.remove('active');
                document.getElementById('world-map-editor-page').classList.remove('active');
                document.getElementById('panel-editor-page').classList.remove('active');
                document.getElementById('system-editor-page').classList.remove('active');
                
                if (page === 'game-list') {
                    document.getElementById('game-list-page').style.display = 'block';
                    // 游戏列表页隐藏指示器
                    document.getElementById('editor-game-indicator').style.display = 'none';
                } else if (page === 'scene-editor') {
                    document.getElementById('scene-editor-page').classList.add('active');
                    // 确保游戏指示器可见
                    if (this.currentGameId) this._updateGameIndicator(this.currentGameId);
                    setTimeout(() => {
                        window.dispatchEvent(new Event('resize'));
                    }, 100);
                } else if (page === 'ui-editor') {
                    document.getElementById('ui-editor-page').classList.add('active');
                    if (this.currentGameId) this._updateGameIndicator(this.currentGameId);
                    // 懒初始化 UI 编辑器
                    if (!this.uiEditor) {
                        this.uiEditor = new UIEditor(
                            document.getElementById('ui-editor-container'),
                            { gameId: this.currentGameId || 'sanguo_zhangjiao' }
                        );
                    }
                    this.uiEditor.init();
                } else if (page === 'trigger-editor') {
                    document.getElementById('trigger-editor-page').classList.add('active');
                    if (this.currentGameId) this._updateGameIndicator(this.currentGameId);
                    if (!this.triggerEditor) {
                        this.triggerEditor = new TriggerEditor(
                            document.getElementById('trigger-editor-container'),
                            {
                                gameId: this.currentGameId || 'sanguo_zhangjiao',
                                canonicalSession: this._canonicalEditorSession('project'),
                                getSceneList: () => this.dataManager.getGameScenes(this.currentGameId),
                                getSceneDocuments: () => {
                                    let scenes = {};
                                    try {
                                        scenes = {
                                            ...this.documentService.requireProject(this._canonicalProjectPath()).getCommittedSnapshot().scenes
                                        };
                                    } catch (error) {
                                        console.warn('TriggerEditor: 获取 committed 场景快照失败', error);
                                    }
                                    const currentScene = this.sceneEditor?.sceneData;
                                    if (this.currentSceneId && currentScene?.id === this.currentSceneId) {
                                        scenes[this.currentSceneId] = currentScene;
                                    }
                                    return Object.values(scenes);
                                },
                                getPlacementOptions: () => {
                                    const sceneData = this.sceneEditor?.sceneData;
                                    const sceneId = this.currentSceneId || sceneData?.id || '';
                                    return (sceneData?.layers || []).flatMap(layer =>
                                        (layer?.objects || []).filter(object => object?.type === 'ref')
                                            .map(object => ({ ...object, sceneId: object.sceneId || sceneId }))
                                    );
                                },
                                onSaved: project => this._refreshProjectTriggers(project)
                            }
                        );
                    }
                    void this.triggerEditor.init().catch(error => console.error('TriggerEditor 初始化失败:', error));
                } else if (page === 'library-editor') {
                    document.getElementById('library-editor-page').classList.add('active');
                    if (this.currentGameId) this._updateGameIndicator(this.currentGameId);
                    if (!this.libraryEditor) {
                        this.libraryEditor = new LibraryEditor(
                            document.getElementById('library-editor-container'),
                            { gameId: this.currentGameId || 'sanguo_zhangjiao', canonicalSession: this._canonicalEditorSession('project') }
                        );
                    }
                    void this.libraryEditor.init().catch(error => console.error('LibraryEditor 初始化失败:', error));
                } else if (page === 'dialogue-editor') {
                    document.getElementById('dialogue-editor-page').classList.add('active');
                    if (this.currentGameId) this._updateGameIndicator(this.currentGameId);
                    if (!this.dialogueEditor) {
                        this.dialogueEditor = new DialogueGraphEditor(
                            document.getElementById('dialogue-editor-container'),
                            { gameId: this.currentGameId || 'sanguo_zhangjiao', canonicalSession: this._canonicalEditorSession('project') }
                        );
                    }
                    void this.dialogueEditor.init().catch(error => console.error('DialogueGraphEditor 初始化失败:', error));
                } else if (page === 'world-map-editor') {
                    document.getElementById('world-map-editor-page').classList.add('active');
                    if (this.currentGameId) this._updateGameIndicator(this.currentGameId);
                    const gameId = this.currentGameId || 'sanguo_zhangjiao';
                    const game = this.dataManager.getCurrentGame()
                        || this.dataManager.getAllGames().find(item => item.id === gameId);
                    const gamePath = (game?.path || `../example/${gameId}/`)
                        .replace(/\\/g, '/').replace(/^(?:\.\.\/)+/, '').replace(/\/?$/, '/');
                    const mapContext = {
                        gameId,
                        projectPath: `${gamePath}game.project.json`,
                        canonicalSession: this._canonicalEditorSession('project')
                    };
                    if (!this.worldMapEditor) {
                        this.worldMapEditor = new WorldMapEditor(
                            document.getElementById('world-map-editor-container'),
                            mapContext
                        );
                        void this.worldMapEditor.init().catch(error => console.error('WorldMapEditor 初始化失败:', error));
                    } else {
                        this.worldMapEditor.setProjectContext(mapContext);
                        void this.worldMapEditor.loadFromProject().catch(error => console.error('WorldMapEditor 加载失败:', error));
                    }
                } else if (page === 'panel-editor') {
                    document.getElementById('panel-editor-page').classList.add('active');
                    if (this.currentGameId) this._updateGameIndicator(this.currentGameId);
                    if (!this.panelEditor) {
                        this.panelEditor = new PanelEditor(
                            document.getElementById('panel-editor-container'),
                            { gameId: this.currentGameId || 'sanguo_zhangjiao' }
                        );
                    }
                    this.panelEditor.init();
                } else if (page === 'system-editor') {
                    document.getElementById('system-editor-page').classList.add('active');
                    if (this.currentGameId) this._updateGameIndicator(this.currentGameId);
                    if (!this.systemEditor) {
                        this.systemEditor = new SystemEditor(
                            document.getElementById('system-editor-container'),
                            { gameId: this.currentGameId || 'sanguo_zhangjiao', canonicalSession: this._canonicalEditorSession('project') }
                        );
                    }
                    void this.systemEditor.init().catch(error => console.error('SystemEditor 初始化失败:', error));
                }
            }
            
            // 显示模态框
            showModal(id) {
                document.getElementById(id).classList.add('active');
            }
            
            // 隐藏模态框
            hideModal(id) {
                document.getElementById(id).classList.remove('active');
            }
}

export default GameEditor;
