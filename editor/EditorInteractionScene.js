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
import { ProjectWorldIndex } from '../src/core/ProjectWorldIndex.js';
        
        
import { EditorInteractionBase } from './EditorInteractionBase.js';

export class EditorInteractionScene extends EditorInteractionBase {            // 编辑游戏
            async editGame(gameId) {
                const gameContextGeneration = ++this._gameContextGeneration;
                this.currentGameId = gameId;
                this.currentSceneId = null;
                const game = this.dataManager.setCurrentGame(gameId);
                
                // 暴露当前游戏信息给资源模块使用
                window._editorCurrentGame = game;
                
                if (!game) return;

                // 同步激活必须早于首个 await，使旧项目所有异步图集编辑 lease 立即失效。
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
                        editor.schemaFields = editor.canonicalSession.fields;
                    };
                    [this.triggerEditor, this.libraryEditor, this.dialogueEditor, this.systemEditor].forEach(bindCanonical);
                } catch (error) {
                    console.error('[Editor] 打开 canonical 项目失败:', error);
                    alert(`无法打开 canonical 项目: ${error.message}`);
                    return;
                }
                await this._refreshProjectTriggers();
                if (gameContextGeneration !== this._gameContextGeneration) return;
                
                // 更新游戏选择器
                this._updateGameIndicator(gameId);
                
                document.getElementById('current-game-name').textContent = game.name;
                this.renderSceneList(gameId);
                this.showPage('scene-editor');
                
                // 初始化场景编辑器
                if (!this.sceneEditor) {
                    this.sceneEditor = new SceneEditor(
                        document.getElementById('scene-editor-container'),
                        this._sceneEditorOptions()
                    );
                    this.sceneEditor.onOpenSlicer = () => this.openSlicer();
                    this.sceneEditor.onSceneChange = (data) => this.saveScene(data);
                    this.sceneEditor.onClearCache = () => this.clearSceneCache();
                    this.sceneEditor.onSceneMetaChange = (meta) => this._handleSceneMetaChange(meta);
                }
                // 新实例在 catalog 已加载后幂等绑定同一项目；复用实例已在首个 await 前切换。
                this.sceneEditor.activateSharedAtlasProject(atlasContext.projectPath);
                
                // 触发resize以正确显示编辑器
                setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                }, 100);
            }
            
            // 运行游戏
            playGame(gameId) {
                const game = this.dataManager.getAllGames().find(g => g.id === gameId);
                if (game && game.path) {
                    window.open(game.path + 'index.html', '_blank');
                }
            }
            
            // 删除游戏
            deleteGame(gameId) {
                if (confirm('确定要删除这个游戏吗？此操作不可撤销。')) {
                    this.dataManager.deleteGame(gameId);
                    this.renderCustomGames();
                }
            }
            
            // 创建游戏
            createGame() {
                const name = document.getElementById('game-name').value.trim();
                if (!name) {
                    alert('请输入游戏名称');
                    return;
                }
                
                const description = document.getElementById('game-description').value.trim();
                const thumbnailFile = document.getElementById('game-thumbnail').files[0];
                
                const game = this.dataManager.createGame({ name, description });
                
                if (thumbnailFile) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        game.thumbnail = e.target.result;
                        this.dataManager.updateGame(game.id, { thumbnail: game.thumbnail });
                        this.renderCustomGames();
                    };
                    reader.readAsDataURL(thumbnailFile);
                } else {
                    this.renderCustomGames();
                }
                
                this.hideModal('new-game-modal');
                document.getElementById('new-game-form').reset();
            }
            
            // 渲染场景列表
            renderSceneList(gameId) {
                let scenes = this.dataManager.getGameScenes(gameId);
                const list = document.getElementById('scene-list');
                
                // 筛选逻辑
                const filterType = document.getElementById('scene-filter-type')?.value || 'all';
                const filterWorldMap = document.getElementById('scene-filter-worldmap')?.value || '';
                // 「场景模板」筛选：列表只显示模板项
                if (filterType === 'template') {
                    list.innerHTML = this._buildTemplateSectionHtml();
                    this._bindTemplateItems(list);
                    this._refreshSceneConsumers();
                    return;
                }
                if (filterType === 'worldChunk') {
                    scenes = scenes.filter(s => s.sceneType === 'worldChunk');
                    if (filterWorldMap) scenes = scenes.filter(s => s.worldMap === filterWorldMap);
                } else if (filterType === 'standalone') {
                    scenes = scenes.filter(s => s.sceneType === 'standalone' || (!s.sceneType && !s.worldMap));
                }
                
                if (scenes.length === 0) {
                    list.innerHTML = '<div style="padding:15px;color:#666;text-align:center;">暂无场景，请创建新场景</div>';
                    this._refreshSceneConsumers();
                    return;
                }

                // getGameScenes() 已按磁盘 `_scene_order.json` 的顺序返回；
                // 过滤只保留相对顺序，禁止再用独立 localStorage key 覆盖权威列表。
                
                list.innerHTML = scenes.map(scene => `
                    <div class="scene-item ${scene.id === this.currentSceneId ? 'active' : ''}" data-id="${scene.id}" draggable="true">
                        <span class="scene-drag-handle">⋮⋮</span>
                        <span class="scene-name">${scene.name}</span>
                        <div class="scene-actions">
                            <button data-action="edit">编辑</button>
                            <button data-action="delete">×</button>
                        </div>
                    </div>
                `).join('');
                
                // 绑定场景点击事件
                list.querySelectorAll('.scene-item:not(.template-item)').forEach(item => {
                    item.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const action = e.target.dataset.action;
                        const sceneId = item.dataset.id;
                        
                        if (action === 'edit') {
                            await this.editScene(sceneId);
                        } else if (action === 'delete') {
                            await this.deleteScene(sceneId);
                        } else {
                            await this.editScene(sceneId);
                        }
                    });
                });

                // 拖拽排序（仅普通场景项参与，排除模板项）
                let dragItem = null;
                list.querySelectorAll('.scene-item:not(.template-item)').forEach(item => {
                    item.addEventListener('dragstart', (e) => {
                        dragItem = item;
                        item.style.opacity = '0.4';
                        e.dataTransfer.effectAllowed = 'move';
                    });
                    item.addEventListener('dragend', async () => {
                        item.style.opacity = '1';
                        dragItem = null;
                        list.querySelectorAll('.scene-item:not(.template-item)').forEach(el => el.classList.remove('drag-over'));
                        const visibleOrder = [...list.querySelectorAll('.scene-item:not(.template-item)')]
                            .map(el => el.dataset.id);
                        const visibleIds = new Set(visibleOrder);
                        let visibleIndex = 0;
                        // 筛选视图只重排可见项，不能把隐藏场景从 canonical order 中删除。
                        const newOrder = this.dataManager.getGameScenes(gameId).map(scene =>
                            visibleIds.has(scene.id) ? visibleOrder[visibleIndex++] : scene.id
                        );
                        try {
                            await this._saveSceneOrder(gameId, newOrder);
                        } catch (error) {
                            console.warn('保存 canonical 场景排序失败:', error);
                            this.sceneEditor?.ui?.showToast?.(`排序保存失败: ${error.message}`, 'error');
                            this.renderSceneList(gameId);
                            return;
                        }
                        try {
                            await this.dataManager.initScenesFromFile(gameId);
                            this.renderSceneList(gameId);
                        } catch (error) {
                            console.warn('场景排序已提交，但磁盘列表刷新失败:', error);
                            this.sceneEditor?.ui?.showToast?.(`排序已提交，但列表刷新失败: ${error.message}`, 'warn');
                        }
                    });
                    item.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (item !== dragItem) item.classList.add('drag-over');
                    });
                    item.addEventListener('dragleave', () => {
                        item.classList.remove('drag-over');
                    });
                    item.addEventListener('drop', (e) => {
                        e.preventDefault();
                        item.classList.remove('drag-over');
                        if (dragItem && dragItem !== item) {
                            // 在 DOM 中重新排列
                            const items = [...list.querySelectorAll('.scene-item:not(.template-item)')];
                            const fromIdx = items.indexOf(dragItem);
                            const toIdx = items.indexOf(item);
                            if (fromIdx < toIdx) {
                                item.after(dragItem);
                            } else {
                                item.before(dragItem);
                            }
                        }
                    });
                });
                this._refreshSceneConsumers();
            }

            /** 场景列表变化后同步已打开的事件/触发器控件。 */
            _refreshSceneConsumers() {
                this.sceneEditor?.ui?.updateObjectProperties?.();
                this.triggerEditor?.refreshSceneList?.();
            }

            // 填充世界地图筛选下拉（从 game.project.json 读 regions）
            async _populateWorldMapFilter() {
                const select = document.getElementById('scene-filter-worldmap');
                if (!select) return;
                select.innerHTML = '<option value="">所有地图</option>';
                const game = this.dataManager.getCurrentGame();
                const gamePath = game ? game.path : '../example/sanguo_zhangjiao/';
                const projectPath = `${gamePath}game.project.json`.replace(/^\.\.\//, '');
                try {
                    const res = await fetch('/api/read-file?path=' + encodeURIComponent(projectPath));
                    if (!res.ok) return;
                    const data = await res.json();
                    const project = (data && data.ok && data.content) ? JSON.parse(data.content) : null;
                    if (!project || !project.worldMap || !project.worldMap.regions) return;
                    for (const region of project.worldMap.regions) {
                        const opt = document.createElement('option');
                        opt.value = region.id;
                        opt.textContent = region.name || region.id;
                        select.appendChild(opt);
                    }
                } catch (e) { /* ignore */ }
            }
            
            // 编辑场景
            async editScene(sceneId) {
                const loadGeneration = (this._sceneLoadGeneration || 0) + 1;
                this._sceneLoadGeneration = loadGeneration;
                const previousSceneId = this.currentSceneId;
                const previousTemplateId = this._editingTemplateId;
                this.currentSceneId = sceneId;
                // 退出模板编辑态（编辑的是普通游戏场景）
                this._editingTemplateId = null;
                
                // 确保场景编辑器已初始化
                if (!this.sceneEditor) {
                    this.sceneEditor = new SceneEditor(
                        document.getElementById('scene-editor-container'),
                        this._sceneEditorOptions()
                    );
                    this.sceneEditor.onOpenSlicer = () => this.openSlicer();
                    this.sceneEditor.onSceneChange = (data) => this.saveScene(data);
                    this.sceneEditor.onClearCache = () => this.clearSceneCache();
                    this.sceneEditor.onSceneMetaChange = (meta) => this._handleSceneMetaChange(meta);
                }
                
                // 先尝试加载预设场景作为基底（提供 terrain / atlases / decoSprites 等完整字段）
                let presetScene = null;
                try {
                    presetScene = await this.sceneLoader.loadScene(sceneId);
                } catch (e) {
                    console.warn('加载预设场景失败:', e);
                }
                if (loadGeneration !== this._sceneLoadGeneration) return null;
                
                // 磁盘 JSON 是唯一事实源；失败时只使用本次打开项目的最近 committed memory，不读无 provenance 的旧编辑器缓存。
                const fileScene = await this._loadSceneFromFile(sceneId, presetScene);
                if (loadGeneration !== this._sceneLoadGeneration) return null;
                let saved = fileScene;
                if (!saved) {
                    try {
                        const committed = this.documentService
                            .requireProject(this._canonicalProjectPath())
                            .getCommittedSnapshot().scenes[sceneId];
                        saved = Array.isArray(committed?.layers) ? committed : null;
                    } catch (error) {
                        saved = null;
                    }
                }
                let sceneToLoad;
                if (presetScene && saved) {
                    // 合并：预设提供完整字段，保存数据覆盖用户编辑过的内容
                    sceneToLoad = {
                        ...presetScene,
                        ...saved,
                        // 关键地形字段缺失时回退到预设，避免空白
                        terrain: saved.terrain || presetScene.terrain,
                        atlases: (saved.atlases && saved.atlases.length) ? saved.atlases : presetScene.atlases,
                        decoSprites: saved.decoSprites || presetScene.decoSprites,
                        // decorations 为空时回退到预设的程序化装饰物
                        decorations: (saved.decorations && saved.decorations.length) ? saved.decorations : presetScene.decorations,
                        centerX: saved.centerX ?? presetScene.centerX,
                        centerY: saved.centerY ?? presetScene.centerY,
                        basinRadius: saved.basinRadius ?? presetScene.basinRadius,
                        basinAspectY: saved.basinAspectY ?? presetScene.basinAspectY
                    };
                } else if (saved) {
                    sceneToLoad = saved;
                } else if (presetScene) {
                    sceneToLoad = presetScene;
                } else {
                    sceneToLoad = null;
                }

                if (!sceneToLoad || !Array.isArray(sceneToLoad.layers)) {
                    const message = `无法加载场景 ${sceneId}：磁盘 canonical 文档、已提交快照与已登记 preset 均不存在有效 layers`;
                    console.error('[Editor]', message);
                    this.currentSceneId = previousSceneId;
                    this._editingTemplateId = previousTemplateId;
                    this.sceneEditor?.ui?.showToast?.(message, 'error');
                    this.renderSceneList(this.currentGameId);
                    return false;
                }
                
                this.sceneEditor.loadScene(sceneToLoad);
                this.dataManager.setCurrentScene(sceneId);
                this.sceneEditor.refreshTriggerReferences?.();
                
                // 加载地形图集
                if (sceneToLoad.terrain && sceneToLoad.terrain.image) {
                    this.loadTerrainAtlas(sceneToLoad.terrain.image);
                }

                // 计算相邻场景数据（大地图多场景编辑参考）
                await this._setupNeighborScenes(sceneId, loadGeneration);
                if (loadGeneration !== this._sceneLoadGeneration) return null;
                
                this.renderSceneList(this.currentGameId);
                
                // 触发resize以正确显示编辑器
                setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                }, 50);
                return true;
            }
            
            // 计算相邻场景数据，供多场景编辑参考
            async _setupNeighborScenes(currentSceneId, loadGeneration = this._sceneLoadGeneration) {
                if (!this.sceneEditor) return;
                if (loadGeneration !== this._sceneLoadGeneration || this.currentSceneId !== currentSceneId) return;
                this.sceneEditor.setNeighborScenes([]);
                this.sceneEditor.setWorldMapLocation(null);

                // 从当前页面共享的 canonical candidate 构建唯一世界索引，不再直接解释 Region raw grid。
                let worldIndex = null;
                try {
                    const projectPath = this._canonicalProjectPath();
                    const candidate = this.documentService.requireProject(projectPath).getCandidate();
                    worldIndex = ProjectWorldIndex.build(candidate?.project, {
                        requireSceneDimensions: true
                    });
                } catch (error) {
                    if (loadGeneration !== this._sceneLoadGeneration || this.currentSceneId !== currentSceneId) return;
                    const detail = error?.errors?.[0]?.message || error.message;
                    const message = `无法读取场景 ${currentSceneId} 的 canonical 世界索引，不能计算相邻场景`;
                    console.error(`[Editor] ${message}:`, error);
                    this.sceneEditor.ui?.showToast?.(`${message}: ${detail}`, 'error');
                    return;
                }
                if (loadGeneration !== this._sceneLoadGeneration || this.currentSceneId !== currentSceneId) return;

                const currentAnchor = worldIndex.findScene(currentSceneId);
                if (!currentAnchor?.loadable) {
                    const message = `场景 ${currentSceneId} 未定位到可加载的 canonical 世界格`;
                    console.error(`[Editor] ${message}`);
                    this.sceneEditor.ui?.showToast?.(message, 'error');
                    return;
                }

                const currentRegion = worldIndex.getRegion(currentAnchor.regionId);
                this.sceneEditor.setWorldMapLocation({
                    regionId: currentAnchor.regionId,
                    regionName: currentRegion?.name || '',
                    row: currentAnchor.row,
                    col: currentAnchor.col
                });

                // 共享索引统一收集全局八邻域；所有正文准备成功后才一次提交，禁止部分九宫格。
                const neighbors = [];
                for (const neighborAnchor of worldIndex.getAdjacentSceneAnchors(currentSceneId)) {
                    const nId = neighborAnchor.sceneId;

                    // 邻居预览同样磁盘优先；列表 localStorage 只含缓存元数据，不能冒充场景文档。
                    let nScene = await this._loadSceneFromFile(nId, null);
                    if (loadGeneration !== this._sceneLoadGeneration || this.currentSceneId !== currentSceneId) return;
                    if (!nScene) {
                        try {
                            const committed = this.documentService
                                .requireProject(this._canonicalProjectPath())
                                .getCommittedSnapshot().scenes[nId];
                            nScene = Array.isArray(committed?.layers) ? committed : null;
                        } catch (error) {
                            nScene = null;
                        }
                    }
                    if (!nScene) {
                        try {
                            const preset = await this.sceneLoader.loadScene(nId);
                            if (loadGeneration !== this._sceneLoadGeneration || this.currentSceneId !== currentSceneId) return;
                            nScene = Array.isArray(preset?.layers) ? preset : null;
                        } catch (error) {
                            nScene = null;
                        }
                    }
                    if (!nScene) {
                        const message = `九宫格邻居 ${nId} 缺少可渲染的 canonical 场景文档`;
                        console.error(`[Editor] ${message}`);
                        this.sceneEditor.ui?.showToast?.(message, 'error');
                        return;
                    }
                    neighbors.push({
                        sceneData: nScene,
                        offsetX: neighborAnchor.offset.x - currentAnchor.offset.x,
                        offsetY: neighborAnchor.offset.y - currentAnchor.offset.y
                    });
                }

                if (loadGeneration !== this._sceneLoadGeneration || this.currentSceneId !== currentSceneId) return;
                this.sceneEditor.setNeighborScenes(neighbors);
            }

            // 从当前游戏磁盘 canonical JSON 加载完整场景；localStorage 不参与文档回退。
            async _loadSceneFromFile(sceneId, presetScene) {
                const gameId = this.currentGameId || 'sanguo_zhangjiao';
                const name = (presetScene && presetScene.name) || sceneId;
                
                // 优先用 sceneId 作为文件名，再用 name（处理 id 和文件名不一致的情况）
                const candidates = [sceneId];
                if (name !== sceneId) candidates.push(name);
                
                for (const filename of candidates) {
                    const path = `example/${gameId}/assets/scenes/${filename}.json`;
                    try {
                        const res = await fetch('/api/read-file?path=' + encodeURIComponent(path));
                        if (!res.ok) continue;
                        const data = await res.json();
                        if (data?.ok === true && data.content) {
                            const parsed = JSON.parse(data.content);
                            const scenes = Array.isArray(parsed) ? parsed : [parsed];
                            const s = scenes.find(x => x && x.id === sceneId) || scenes[0];
                            if (Array.isArray(s?.layers)) {
                                console.log('[Editor] 从文件恢复场景:', path);
                                return s;
                            }
                        }
                    } catch (e) {
                        // 继续尝试下一个候选文件名
                    }
                }
                console.warn('[Editor] 场景文件兜底加载失败，所有候选文件均无法匹配:', candidates);
                return null;
            }

            // 加载地形图集
            loadTerrainAtlas(imageUrl) {
                if (!this.sceneEditor) return;
                
                const img = new Image();
                img.onload = () => {
                    this.sceneEditor.loadedImages.set('terrain_atlas', img);
                    this.sceneEditor.render();
                };
                img.src = imageUrl;
            }
            
            // 填充"场景模板"下拉（打开新建场景弹窗时调用）
            populateSceneTemplates() {
                const sel = document.getElementById('scene-template');
                if (!sel) return;
                const { defaultTemplateId, templates } = this.dataManager.getSceneTemplates();
                sel.innerHTML = templates.map(t =>
                    `<option value="${t.id}">${t.name}</option>`
                ).join('');
                sel.value = defaultTemplateId;
                this.onSceneTemplateChange();
            }

            // 模板切换：显示描述，并把模板的宽高/背景色回填到表单（用户仍可再改）
            onSceneTemplateChange() {
                const sel = document.getElementById('scene-template');
                if (!sel) return;
                const tpl = this.dataManager.getSceneTemplate(sel.value);
                const descEl = document.getElementById('scene-template-desc');
                if (descEl) descEl.textContent = tpl ? (tpl.description || '') : '';
                if (tpl && tpl.scene) {
                    const s = tpl.scene;
                    if (s.width) document.getElementById('scene-width').value = s.width;
                    if (s.height) document.getElementById('scene-height').value = s.height;
                    if (s.backgroundColor) document.getElementById('scene-bg-color').value = s.backgroundColor;
                }
            }

            // 编辑模板：用场景编辑器打开模板的 scene 数据，保存时写回 scene-templates.json
            editSceneTemplate(templateId) {
                const tpl = this.dataManager.getSceneTemplate(templateId);
                if (!tpl) return;
                // 确保编辑器已初始化
                if (!this.sceneEditor) {
                    this.sceneEditor = new SceneEditor(
                        document.getElementById('scene-editor-container'),
                        this._sceneEditorOptions()
                    );
                    this.sceneEditor.onOpenSlicer = () => this.openSlicer();
                    this.sceneEditor.onSceneChange = (data) => this.saveScene(data);
                    this.sceneEditor.onClearCache = () => this.clearSceneCache();
                    this.sceneEditor.onSceneMetaChange = (meta) => this._handleSceneMetaChange(meta);
                }
                // 进入模板编辑态
                this._editingTemplateId = templateId;
                this.currentSceneId = null;
                // 模板 canonical 数据原样加载；资源选择和模板元信息不得注入场景文档。
                const sceneToLoad = structuredClone(tpl.scene || {});
                this.sceneEditor.loadScene(sceneToLoad);
                if (this.sceneEditor.ui && this.sceneEditor.ui.showToast) {
                    this.sceneEditor.ui.showToast('正在编辑模板「' + tpl.name + '」，保存将写回模板');
                }
                // 刷新左侧列表以高亮当前编辑的模板
                if (this.currentGameId) this.renderSceneList(this.currentGameId);
                window.dispatchEvent(new Event('resize'));
            }

            _persistenceError(result, fallback = '磁盘未提交') {
                const firstError = result?.errors?.[0];
                const validationMessage = [firstError?.path, firstError?.message || firstError?.reason]
                    .filter(Boolean)
                    .join(': ');
                if (validationMessage) return validationMessage;
                if (typeof result?.error?.message === 'string') return result.error.message;
                if (typeof result?.error === 'string') return result.error;
                return fallback;
            }

            _restoreTemplateSnapshot(snapshot, previousTemplateId) {
                this.dataManager.replaceSceneTemplatesConfig(snapshot);
                this._editingTemplateId = previousTemplateId;
                if (this.currentGameId) this.renderSceneList(this.currentGameId);
            }

            // 新建模板：文件提交成功后才进入编辑。
            async createNewTemplate() {
                const name = prompt('输入新模板名称：', '新模板');
                if (!name) return;
                const snapshot = structuredClone(this.dataManager.getSceneTemplatesConfig());
                const previousTemplateId = this._editingTemplateId;
                let template;
                try {
                    ({ template } = this.dataManager.createSceneTemplate({ name }));
                    const result = await this._saveTemplatesToFile();
                    if (result?.ok !== true || result.committed !== true) {
                        this._restoreTemplateSnapshot(snapshot, previousTemplateId);
                        this.sceneEditor?.ui?.showToast?.('新建模板失败：' + this._persistenceError(result), 'error');
                        return;
                    }
                } catch (error) {
                    this._restoreTemplateSnapshot(snapshot, previousTemplateId);
                    this.sceneEditor?.ui?.showToast?.('新建模板失败：' + error.message, 'error');
                    return;
                }
                this.editSceneTemplate(template.id);
            }

            // 删除模板：提交失败时恢复完整配置和编辑态。
            async deleteTemplate(templateId) {
                const tpl = this.dataManager.getSceneTemplate(templateId);
                if (!tpl) return;
                if (!confirm('确定删除模板「' + tpl.name + '」？')) return;
                const snapshot = structuredClone(this.dataManager.getSceneTemplatesConfig());
                const previousTemplateId = this._editingTemplateId;
                try {
                    if (this._editingTemplateId === templateId) this._editingTemplateId = null;
                    this.dataManager.deleteSceneTemplate(templateId);
                    const result = await this._saveTemplatesToFile();
                    if (result?.ok !== true || result.committed !== true) {
                        this._restoreTemplateSnapshot(snapshot, previousTemplateId);
                        this.sceneEditor?.ui?.showToast?.('删除模板失败：' + this._persistenceError(result), 'error');
                        return;
                    }
                } catch (error) {
                    this._restoreTemplateSnapshot(snapshot, previousTemplateId);
                    this.sceneEditor?.ui?.showToast?.('删除模板失败：' + error.message, 'error');
                    return;
                }
                if (this.currentGameId) this.renderSceneList(this.currentGameId);
            }

            // 把模板配置写回 editor/config/scene-templates.json。
            async _saveTemplatesToFile() {
                try {
                    const config = structuredClone(this.dataManager.getSceneTemplatesConfig());
                    const response = await fetch('/api/save-file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            path: 'editor/config/scene-templates.json',
                            content: JSON.stringify(config, null, 2)
                        })
                    });
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok || data?.ok !== true) {
                        return {
                            ok: false,
                            committed: false,
                            status: 'failed',
                            code: 'templateFileSaveFailed',
                            error: data.error || `模板保存 HTTP ${response.status}`
                        };
                    }
                    console.log('场景模板已保存到文件:', data.path);
                    return { ok: true, committed: true, status: 'committed', degraded: false, path: data.path };
                } catch (error) {
                    console.warn('保存模板文件请求失败:', error);
                    return { ok: false, committed: false, status: 'failed', code: 'templateFileSaveFailed', error };
                }
            }

            // 构建左侧列表底部的「场景模板」分组 HTML
            _buildTemplateSectionHtml() {
                const { templates } = this.dataManager.getSceneTemplates();
                const items = templates.map(t => `
                    <div class="scene-item template-item ${this._editingTemplateId === t.id ? 'active' : ''}" data-tpl-id="${t.id}" title="${t.description || ''}">
                        <span class="scene-name">📐 ${t.name}</span>
                        <div class="scene-actions">
                            <button data-tpl-action="edit">编辑</button>
                            <button data-tpl-action="delete">×</button>
                        </div>
                    </div>
                `).join('');
                return `
                    <div class="scene-template-section" style="margin-top:10px;border-top:1px solid #3a3a3a;padding-top:6px;">
                        <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;color:#8bc34a;font-size:12px;font-weight:bold;">
                            <span>场景模板</span>
                            <button id="inline-add-template" title="新建模板" style="padding:0 6px;">＋</button>
                        </div>
                        ${items || '<div style="padding:8px;color:#666;font-size:12px;text-align:center;">暂无模板</div>'}
                    </div>`;
            }

            // 绑定模板项的点击（编辑/删除）与新建模板按钮
            _bindTemplateItems(list) {
                list.querySelectorAll('.template-item').forEach(item => {
                    item.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const id = item.dataset.tplId;
                        const action = e.target.dataset.tplAction;
                        if (action === 'delete') await this.deleteTemplate(id);
                        else this.editSceneTemplate(id);
                    });
                });
                const addBtn = list.querySelector('#inline-add-template');
                if (addBtn) addBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await this.createNewTemplate();
                });
            }

            // 创建 canonical 场景；磁盘提交后再从 _scene_order.json 重建列表缓存。
            async createScene() {
                const name = document.getElementById('scene-name').value.trim();
                if (!name) {
                    alert('请输入场景名称');
                    return;
                }
                const scene = this.dataManager.createSceneDraft({
                    name,
                    templateId: document.getElementById('scene-template').value,
                    width: parseInt(document.getElementById('scene-width').value) || 1280,
                    height: parseInt(document.getElementById('scene-height').value) || 720,
                    backgroundColor: document.getElementById('scene-bg-color').value
                });

                let result;
                try {
                    const { service, projectPath } = this._sceneCommands();
                    result = await service.create(projectPath, { scene });
                } catch (error) {
                    console.warn('创建 canonical 场景请求失败:', error);
                    alert(`创建场景失败: ${error.message}`);
                    return;
                }
                if (result?.ok !== true || result.committed !== true) {
                    alert(`创建场景失败: ${this._persistenceError(result, '磁盘未提交')}`);
                    return result;
                }

                try {
                    await this.dataManager.initScenesFromFile(this.currentGameId);
                    this.hideModal('new-scene-modal');
                    document.getElementById('new-scene-form').reset();
                    this.renderSceneList(this.currentGameId);
                    const loaded = await this.editScene(scene.id);
                    if (loaded === false) {
                        this.sceneEditor?.ui?.showToast?.('场景已写入磁盘，但编辑器无法加载该 canonical 文档', 'warn');
                        return { ...result, degraded: true, status: 'committed-with-degradation' };
                    }
                } catch (error) {
                    console.warn('场景已创建，但编辑器刷新失败:', error);
                    this.sceneEditor?.ui?.showToast?.(`场景已写入磁盘，但编辑器刷新失败: ${error.message}`, 'warn');
                    return { ...result, degraded: true, status: 'committed-with-degradation' };
                }
                if (result.degraded) this.sceneEditor?.ui?.showToast?.('场景已提交到磁盘，但缓存/通知同步降级', 'warn');
                return result;
            }
            
            // 删除 canonical 场景；磁盘提交后再刷新列表缓存。
            async deleteScene(sceneId) {
                if (!confirm('确定要删除这个场景吗？')) return;
                let result;
                try {
                    const { service, projectPath } = this._sceneCommands();
                    result = await service.delete(projectPath, { sceneId });
                } catch (error) {
                    console.warn('删除 canonical 场景请求失败:', error);
                    alert(`删除场景失败: ${error.message}`);
                    return;
                }
                if (result?.ok !== true || result.committed !== true) {
                    alert(`删除场景失败: ${this._persistenceError(result, '磁盘未提交')}`);
                    return result;
                }

                if (this.currentSceneId === sceneId) this.currentSceneId = null;
                try {
                    await this.dataManager.initScenesFromFile(this.currentGameId);
                    this.renderSceneList(this.currentGameId);
                } catch (error) {
                    console.warn('场景已删除，但编辑器列表刷新失败:', error);
                    this.sceneEditor?.ui?.showToast?.(`场景已从磁盘删除，但列表刷新失败: ${error.message}`, 'warn');
                    return { ...result, degraded: true, status: 'committed-with-degradation' };
                }
                if (result.degraded) this.sceneEditor?.ui?.showToast?.('场景已从磁盘删除，但缓存/通知同步降级', 'warn');
                return result;
            }
            
            // 保存场景或模板，统一返回严格的持久化结果供 SceneEditorHistory 判定。
            async saveScene(sceneData) {
                if (this._editingTemplateId) {
                    const templateId = this._editingTemplateId;
                    const snapshot = structuredClone(this.dataManager.getSceneTemplatesConfig());
                    try {
                        this.dataManager.upsertSceneTemplate(templateId, sceneData);
                        const result = await this._saveTemplatesToFile();
                        if (result?.ok !== true || result.committed !== true) {
                            this.dataManager.replaceSceneTemplatesConfig(snapshot);
                            return result;
                        }
                        return {
                            ...result,
                            successMessage: `模板「${this.dataManager.getSceneTemplate(templateId)?.name || templateId}」已保存`
                        };
                    } catch (error) {
                        this.dataManager.replaceSceneTemplatesConfig(snapshot);
                        return {
                            ok: false,
                            committed: false,
                            status: 'failed',
                            code: 'templateSaveFailed',
                            error
                        };
                    }
                }
                if (!this.currentGameId || !this.currentSceneId) {
                    return {
                        ok: false,
                        committed: false,
                        status: 'rejected',
                        code: 'missingSceneSelection',
                        errors: [{ path: 'sceneId', message: '未选择要保存的 canonical 场景' }]
                    };
                }
                try {
                    const { service, projectPath } = this._sceneCommands();
                    return await service.save(projectPath, {
                        sceneId: this.currentSceneId,
                        sourceUri: `${projectPath.slice(0, -'/game.project.json'.length)}/assets/scenes/${this.currentSceneId}.json`,
                        scene: structuredClone(sceneData)
                    });
                } catch (error) {
                    console.warn('保存 canonical 场景失败:', error);
                    return {
                        ok: false,
                        committed: false,
                        status: 'failed',
                        code: 'canonicalSceneSaveFailed',
                        error
                    };
                }
            }

            // 处理场景元数据变更（名称/ID）。模板与 canonical 场景均等待真实提交。
            async _handleSceneMetaChange(meta) {
                if (this._editingTemplateId) {
                    if (meta.name === undefined) return;
                    const snapshot = structuredClone(this.dataManager.getSceneTemplatesConfig());
                    try {
                        this.dataManager.updateSceneTemplateMeta(this._editingTemplateId, { name: meta.name });
                        const result = await this._saveTemplatesToFile();
                        if (result?.ok !== true || result.committed !== true) {
                            this.dataManager.replaceSceneTemplatesConfig(snapshot);
                            this.sceneEditor?.ui?.showToast?.('模板名称保存失败: ' + this._persistenceError(result), 'error');
                            return result;
                        }
                        if (this.currentGameId) this.renderSceneList(this.currentGameId);
                        return result;
                    } catch (error) {
                        this.dataManager.replaceSceneTemplatesConfig(snapshot);
                        this.sceneEditor?.ui?.showToast?.(`模板名称保存失败: ${error.message}`, 'error');
                        return { ok: false, committed: false, status: 'failed', error };
                    }
                }
                if (!this.currentGameId || !this.currentSceneId) return;

                const { service, projectPath } = this._sceneCommands();
                if (meta.id && meta.oldId) {
                    let result;
                    try {
                        result = await service.rename(projectPath, { oldId: meta.oldId, newId: meta.id });
                    } catch (error) {
                        result = { ok: false, committed: false, status: 'failed', error };
                    }
                    if (result?.ok !== true || result.committed !== true) {
                        if (this.sceneEditor?.sceneData?.id === meta.id) this.sceneEditor.sceneData.id = meta.oldId;
                        const input = document.getElementById('editor-scene-id');
                        if (input) input.value = meta.oldId;
                        this.sceneEditor?.ui?.showToast?.('重命名失败: ' + this._persistenceError(result), 'error');
                        return result;
                    }
                    this.currentSceneId = meta.id;
                    if (this.sceneEditor?.sceneData) this.sceneEditor.sceneData.id = meta.id;
                    await this.dataManager.initScenesFromFile(this.currentGameId);
                    this.renderSceneList(this.currentGameId);
                    if (result.degraded) this.sceneEditor?.ui?.showToast?.('重命名已提交到磁盘，但缓存/通知同步降级', 'warn');
                    return result;
                }

                if (meta.name !== undefined) {
                    let result;
                    try {
                        const model = this.documentService.requireProject(projectPath);
                        const scene = model.getCandidate().scenes[this.currentSceneId];
                        result = await service.update(projectPath, {
                            sceneId: this.currentSceneId,
                            scene: { ...scene, name: meta.name },
                            orderEntry: { name: meta.name }
                        });
                    } catch (error) {
                        result = { ok: false, committed: false, status: 'failed', error };
                    }
                    if (result?.ok !== true || result.committed !== true) {
                        this.sceneEditor?.ui?.showToast?.('名称保存失败: ' + this._persistenceError(result), 'error');
                        return result;
                    }
                    await this.dataManager.initScenesFromFile(this.currentGameId);
                    this.renderSceneList(this.currentGameId);
                    if (result.degraded) this.sceneEditor?.ui?.showToast?.('名称已提交，但缓存/通知同步降级', 'warn');
                    return result;
                }
            }

}

export default EditorInteractionScene;
