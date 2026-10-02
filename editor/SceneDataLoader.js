/**
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 */

/**
 * SceneDataLoader - 场景数据加载器
 * 
 * 负责从现有场景文件中提取数据，转换为编辑器可用的格式
 * 所有默认值从 config/ 目录下的 JSON 文件加载
 */

import { SceneDataExporter } from './SceneDataExporter.js';
import sharedAtlasConfig from '../example/sanguo_zhangjiao/config/atlases.json' with { type: 'json' };

const DEFAULT_ATLAS_PROJECT_PATH = 'example/sanguo_zhangjiao/game.project.json';

/**
 * 规范化编辑器项目路径，作为共享图集缓存的稳定分区键。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAtlasProjectPath(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(?:\.\.\/)+/, '')
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+/, '');
  if (normalized.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new TypeError('共享图集项目路径不能包含 . 或 ..');
  }
  return normalized;
}

// 运行时配置缓存。catalog/loadPromise 按项目分区；_atlasesConfig 只投影当前活动项目。
let _scenePresetsConfig = null;
let _decoSpritesConfig = null;
const _atlasCatalogs = new Map([[DEFAULT_ATLAS_PROJECT_PATH, structuredClone(sharedAtlasConfig)]]);
const _atlasLoadPromises = new Map();
let _activeAtlasProjectPath = DEFAULT_ATLAS_PROJECT_PATH;
let _atlasesConfig = _atlasCatalogs.get(DEFAULT_ATLAS_PROJECT_PATH);
let _imagesConfig = null;

function _storeAtlasCatalog(projectPath, config) {
  if (!config || typeof config !== 'object' || !Array.isArray(config.atlases)) {
    throw new TypeError('共享图集 catalog 必须包含 atlases 数组');
  }
  const normalizedProjectPath = normalizeAtlasProjectPath(projectPath) || DEFAULT_ATLAS_PROJECT_PATH;
  const snapshot = structuredClone(config);
  _atlasCatalogs.set(normalizedProjectPath, snapshot);
  if (_activeAtlasProjectPath === normalizedProjectPath) _atlasesConfig = snapshot;
  return snapshot;
}

/**
 * 加载场景配置
 */
async function _loadConfigs() {
  try {
    const [presetsResp, decoResp, atlasIndexResp, imagesResp] = await Promise.all([
      fetch('./config/scene-presets.json'),
      fetch('./config/deco-sprites.json'),
      fetch('./config/atlases.json'),
      fetch('./config/images.json')
    ]);
    _scenePresetsConfig = await presetsResp.json();
    _decoSpritesConfig = await decoResp.json();
    const atlasIndex = await atlasIndexResp.json();
    if (atlasIndex && typeof atlasIndex.$ref === 'string') {
      const atlasUrl = new URL(atlasIndex.$ref, atlasIndexResp.url);
      const atlasResp = await fetch(atlasUrl);
      if (!atlasResp.ok) throw new Error(`加载共享图集配置失败: HTTP ${atlasResp.status}`);
      _storeAtlasCatalog(DEFAULT_ATLAS_PROJECT_PATH, await atlasResp.json());
    } else {
      _storeAtlasCatalog(DEFAULT_ATLAS_PROJECT_PATH, atlasIndex);
    }
    _imagesConfig = await imagesResp.json();
  } catch (e) {
    _storeAtlasCatalog(DEFAULT_ATLAS_PROJECT_PATH, sharedAtlasConfig);
    console.warn('加载场景配置失败；默认项目共享图集继续使用游戏级配置:', e);
  }
}

export class SceneDataLoader {
  constructor() {
    this.assetBase = (_scenePresetsConfig && _scenePresetsConfig.assetBase) || '../example/sanguo_zhangjiao/assets/images/scene1/';
    this.exporter = new SceneDataExporter();
    this._configsLoaded = false;
  }
  
  /**
   * 确保配置已加载
   */
  async _ensureConfigs() {
    if (this._configsLoaded) return;
    await _loadConfigs();
    if (_scenePresetsConfig && _scenePresetsConfig.assetBase) {
      this.assetBase = _scenePresetsConfig.assetBase;
    }
    this._configsLoaded = true;
  }

  /**
   * 获取全局图集配置（所有场景共享）
   * @returns {Array} 图集数组
   */
  getGlobalAtlases() {
    return this._getScene1Atlases();
  }
  
  /**
   * 获取场景1的地形数据（使用导出器生成完整数据）
   */
  async loadScene1Terrain() {
    await this._ensureConfigs();
    return this.exporter.exportPrologueScene({
      presets: _scenePresetsConfig,
      getAtlas: atlasId => this._getScene1Atlases().find(atlas => atlas?.id === atlasId) || null
    });
  }
  
  /**
   * 获取游戏级共享图集资源。完整定义不合并进任何场景正文。
   */
  _getScene1Atlases() {
    return Array.isArray(_atlasesConfig?.atlases) ? _atlasesConfig.atlases : [];
  }
  
  /**
   * 获取所有预设场景
   */
  getPresetScenes() {
    // 优先使用 JSON 配置
    if (_scenePresetsConfig && _scenePresetsConfig.presetScenesList) {
      return _scenePresetsConfig.presetScenesList;
    }
    return [
      { id: 'scene_Prologue', name: '序章 - 盆地营地', type: 'terrain' },
      { id: 'scene_Act1', name: '第一幕 - 起义军营', type: 'terrain' },
      { id: 'scene_Act2', name: '第二幕 - 符水救灾', type: 'indoor' },
      { id: 'scene_Act3', name: '第三幕 - 铜钱法器', type: 'indoor' },
      { id: 'scene_Act4', name: '第四幕 - 山寨', type: 'terrain' },
      { id: 'scene_Act5', name: '第五幕 - 决战', type: 'terrain' },
      { id: 'scene_Act6', name: '第六幕 - 结局', type: 'indoor' }
    ];
  }
  
  /**
   * 加载指定场景
   */
  async loadScene(sceneId) {
    await this._ensureConfigs();
    switch (sceneId) {
      case 'scene_Prologue':
        return await this.loadScene1Terrain();
      case 'scene_Act1':
        return await this.loadAct1Scene();
      case 'scene_Act2':
        return await this.loadAct2Scene();
      case 'scene_Act3':
        return await this.loadAct3Scene();
      case 'scene_Act4':
        return await this.loadAct4Scene();
      case 'scene_Act5':
        return await this.loadAct5Scene();
      case 'scene_Act6':
        return await this.loadAct6Scene();
      default:
        // 未登记的 canonical SXX 没有预设基底；调用方必须直接使用磁盘场景，
        // 禁止把空 legacy preset 合并进 canonical 文档。
        return null;
    }
  }
  
  /**
   * 创建空场景
   */
  createEmptyScene(sceneId, name, bgColor) {
    // 从 JSON 配置获取默认背景色
    const defaultBg = bgColor || '#2a3a1a';
    return {
      id: sceneId,
      name: name || sceneId.replace('scene_', ''),
      width: 1280,
      height: 720,
      backgroundColor: defaultBg,
      layers: [
        { id: 'layer_bg', name: '背景层', visible: true, locked: false, objects: [] },
        { id: 'layer_deco', name: '装饰层', visible: true, locked: false, objects: [] },
        { id: 'layer_entity', name: '实体层', visible: true, locked: false, objects: [] }
      ],
      decorations: [],
      colliders: []
    };
  }

  /**
   * 将旧户外预设规范化为共享 atlas 引用，删除路径和裁剪矩形副本。
   */
  _withSharedOutdoorAtlas(terrain = {}) {
    const normalized = {
      ...terrain,
      atlasId: 'mountain_landscape',
      sliceKey: 'grassTile'
    };
    delete normalized.image;
    delete normalized.grassTile;
    return normalized;
  }
  
  /**
   * 第一幕 - 起义军营
   */
  async loadAct1Scene() {
    // 从 JSON 配置获取场景预设
    const preset = (_scenePresetsConfig && _scenePresetsConfig.scenes && _scenePresetsConfig.scenes['scene_Act1']) || {};
    const config = this.createEmptyScene('scene_Act1', preset.name || '第一幕 - 起义军营', preset.backgroundColor || '#1a2a2a');
    
    config.terrain = preset.terrain || {
      type: 'camp',
      tileSize: 64,
      atlasId: 'mountain_landscape',
      sliceKey: 'grassTile'
    };
    config.terrain = this._withSharedOutdoorAtlas(config.terrain);
    
    config.centerX = preset.centerX || 640;
    config.centerY = preset.centerY || 360;
    config.basinRadius = preset.basinRadius || 500;
    config.basinAspectY = preset.basinAspectY || 0.7;
    
    config.decorations = this._generateCampDecorations(config);
    
    return config;
  }
  
  /**
   * 第二幕 - 符水救灾（室内粥棚）
   */
  async loadAct2Scene() {
    const preset = (_scenePresetsConfig && _scenePresetsConfig.scenes && _scenePresetsConfig.scenes['scene_Act2']) || {};
    const config = this.createEmptyScene('scene_Act2', preset.name || '第二幕 - 符水救灾', preset.backgroundColor || '#2a2020');
    
    config.terrain = preset.terrain || {
      type: 'indoor',
      tileSize: 48
    };
    
    config.decorations = this._generateIndoorDecorations(config, 'porridge');
    config.decoSprites = this._getIndoorDecoSprites();
    
    return config;
  }
  
  /**
   * 第三幕 - 铜钱法器（室内道场）
   */
  async loadAct3Scene() {
    const preset = (_scenePresetsConfig && _scenePresetsConfig.scenes && _scenePresetsConfig.scenes['scene_Act3']) || {};
    const config = this.createEmptyScene('scene_Act3', preset.name || '第三幕 - 铜钱法器', preset.backgroundColor || '#202030');
    
    config.terrain = preset.terrain || {
      type: 'indoor',
      tileSize: 48
    };
    
    config.decorations = this._generateIndoorDecorations(config, 'dojo');
    config.decoSprites = this._getIndoorDecoSprites();
    
    return config;
  }
  
  /**
   * 第四幕 - 山寨
   */
  async loadAct4Scene() {
    const preset = (_scenePresetsConfig && _scenePresetsConfig.scenes && _scenePresetsConfig.scenes['scene_Act4']) || {};
    const config = this.createEmptyScene('scene_Act4', preset.name || '第四幕 - 山寨', preset.backgroundColor || '#252520');
    
    config.terrain = preset.terrain || {
      type: 'mountain',
      tileSize: 64,
      atlasId: 'mountain_landscape',
      sliceKey: 'grassTile'
    };
    config.terrain = this._withSharedOutdoorAtlas(config.terrain);
    
    config.centerX = preset.centerX || 640;
    config.centerY = preset.centerY || 350;
    config.basinRadius = preset.basinRadius || 550;
    config.basinAspectY = preset.basinAspectY || 0.6;
    
    config.decorations = this._generateMountainDecorations(config);
    
    return config;
  }
  
  /**
   * 第五幕 - 决战
   */
  async loadAct5Scene() {
    const preset = (_scenePresetsConfig && _scenePresetsConfig.scenes && _scenePresetsConfig.scenes['scene_Act5']) || {};
    const config = this.createEmptyScene('scene_Act5', preset.name || '第五幕 - 决战', preset.backgroundColor || '#301515');
    
    config.terrain = preset.terrain || {
      type: 'battlefield',
      tileSize: 64,
      atlasId: 'mountain_landscape',
      sliceKey: 'grassTile'
    };
    config.terrain = this._withSharedOutdoorAtlas(config.terrain);
    
    config.centerX = preset.centerX || 640;
    config.centerY = preset.centerY || 360;
    config.basinRadius = preset.basinRadius || 600;
    config.basinAspectY = preset.basinAspectY || 0.65;
    
    config.decorations = this._generateBattlefieldDecorations(config);
    
    return config;
  }
  
  /**
   * 第六幕 - 结局
   */
  async loadAct6Scene() {
    const preset = (_scenePresetsConfig && _scenePresetsConfig.scenes && _scenePresetsConfig.scenes['scene_Act6']) || {};
    const config = this.createEmptyScene('scene_Act6', preset.name || '第六幕 - 结局', preset.backgroundColor || '#1a1a2a');
    
    config.terrain = preset.terrain || {
      type: 'indoor',
      tileSize: 48
    };
    
    config.decorations = this._generateIndoorDecorations(config, 'palace');
    config.decoSprites = this._getIndoorDecoSprites();
    
    return config;
  }
  
  /**
   * 生成军营装饰物
   */
  _generateCampDecorations(config) {
    const decorations = [];
    let seed = 54321;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    
    // 军营帐篷
    for (let i = 0; i < 8; i++) {
      decorations.push({
        x: 200 + rand() * 800,
        y: 150 + rand() * 400,
        key: 'tent',
        scale: 1.0
      });
    }
    
    // 旗帜
    for (let i = 0; i < 5; i++) {
      decorations.push({
        x: 100 + rand() * 1000,
        y: 100 + rand() * 500,
        key: 'flag',
        scale: 1.0
      });
    }
    
    return decorations;
  }
  
  /**
   * 生成室内装饰物
   */
  _generateIndoorDecorations(config, type) {
    const decorations = [];
    
    if (type === 'porridge') {
      // 粥棚 - 锅、桌子、草席
      decorations.push({ x: 400, y: 300, key: 'cauldron', scale: 1.0 });
      decorations.push({ x: 600, y: 400, key: 'table', scale: 1.0 });
      decorations.push({ x: 800, y: 350, key: 'mat', scale: 1.0 });
    } else if (type === 'dojo') {
      // 道场 - 香炉、蒲团、符咒
      decorations.push({ x: 500, y: 200, key: 'incense', scale: 1.0 });
      decorations.push({ x: 640, y: 400, key: 'cushion', scale: 1.0 });
      decorations.push({ x: 300, y: 300, key: 'talisman', scale: 1.0 });
    } else if (type === 'palace') {
      // 宫殿 - 宝座、屏风、蜡烛
      decorations.push({ x: 640, y: 200, key: 'throne', scale: 1.2 });
      decorations.push({ x: 400, y: 350, key: 'screen', scale: 1.0 });
      decorations.push({ x: 850, y: 250, key: 'candle', scale: 1.0 });
    }
    
    return decorations;
  }
  
  /**
   * 生成山寨装饰物
   */
  _generateMountainDecorations(config) {
    const decorations = [];
    let seed = 98765;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    
    // 山寨木栅栏
    for (let i = 0; i < 12; i++) {
      decorations.push({
        x: 150 + i * 90,
        y: 500 + rand() * 50,
        key: 'fence',
        scale: 1.0
      });
    }
    
    // 山石
    for (let i = 0; i < 6; i++) {
      decorations.push({
        x: 100 + rand() * 1000,
        y: 200 + rand() * 300,
        key: 'rock',
        scale: 0.8 + rand() * 0.4
      });
    }
    
    return decorations;
  }
  
  /**
   * 生成战场装饰物
   */
  _generateBattlefieldDecorations(config) {
    const decorations = [];
    let seed = 11111;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    
    // 破损旗帜
    for (let i = 0; i < 8; i++) {
      decorations.push({
        x: 100 + rand() * 1000,
        y: 150 + rand() * 400,
        key: 'broken_flag',
        scale: 0.8 + rand() * 0.4
      });
    }
    
    // 废墟
    for (let i = 0; i < 10; i++) {
      decorations.push({
        x: rand() * 1200,
        y: 200 + rand() * 400,
        key: 'ruins',
        scale: 0.6 + rand() * 0.8
      });
    }
    
    return decorations;
  }
  
  /**
   * 获取默认装饰物精灵配置
   */
  _getDefaultDecoSprites() {
    const mountainAtlas = this._getScene1Atlases()
      .find(atlas => atlas?.id === 'mountain_landscape');
    const sharedSlices = Object.fromEntries(
      Object.entries(mountainAtlas?.slices || {}).map(([sliceKey, slice]) => [
        sliceKey,
        { scale: 1.0, ...slice }
      ])
    );
    return {
      ...(_decoSpritesConfig?.outdoor || {}),
      ...sharedSlices
    };
  }
  
  /**
   * 获取室内装饰物精灵配置
   */
  _getIndoorDecoSprites() {
    // 优先使用 JSON 配置
    if (_decoSpritesConfig && _decoSpritesConfig.indoor) {
      return _decoSpritesConfig.indoor;
    }
    return {
      cauldron: { sx: 0, sy: 0, sw: 64, sh: 64, scale: 1.0, collide: true },
      table: { sx: 0, sy: 0, sw: 80, sh: 48, scale: 1.0, collide: true },
      mat: { sx: 0, sy: 0, sw: 64, sh: 32, scale: 1.0, collide: false },
      incense: { sx: 0, sy: 0, sw: 32, sh: 48, scale: 1.0, collide: false },
      cushion: { sx: 0, sy: 0, sw: 48, sh: 24, scale: 1.0, collide: false },
      talisman: { sx: 0, sy: 0, sw: 32, sh: 32, scale: 1.0, collide: false },
      throne: { sx: 0, sy: 0, sw: 96, sh: 96, scale: 1.0, collide: true },
      screen: { sx: 0, sy: 0, sw: 64, sh: 96, scale: 1.0, collide: true },
      candle: { sx: 0, sy: 0, sw: 24, sh: 32, scale: 1.0, collide: false }
    };
  }
}

export const sceneDataLoader = new SceneDataLoader();

/**
 * 同步切换共享图集活动项目。未加载项目会把 legacy 投影清空，禁止保留上一项目 catalog。
 * @param {string} projectPath
 * @returns {{projectPath:string,catalog:object|null}}
 */
export function activateGlobalAtlasesProject(projectPath) {
  const normalizedProjectPath = normalizeAtlasProjectPath(projectPath) || DEFAULT_ATLAS_PROJECT_PATH;
  _activeAtlasProjectPath = normalizedProjectPath;
  _atlasesConfig = _atlasCatalogs.get(normalizedProjectPath) || null;
  return { projectPath: normalizedProjectPath, catalog: _atlasesConfig };
}

/**
 * 外部更新指定项目的图集缓存（保存图集后调用，避免刷新前缓存过时）。
 * 单参数 overload 仅用于仍绑定活动项目的 legacy 调用方。
 * @param {string|object} projectPathOrConfig
 * @param {object} [config]
 * @returns {object}
 */
export function updateAtlasesCache(projectPathOrConfig, config) {
  if (config === undefined && projectPathOrConfig && typeof projectPathOrConfig === 'object') {
    return _storeAtlasCatalog(_activeAtlasProjectPath, projectPathOrConfig);
  }
  return _storeAtlasCatalog(projectPathOrConfig, config);
}

/**
 * 按项目加载共享图集 catalog；同项目并发请求复用同一 Promise。
 * @param {string} [projectPath]
 * @returns {Promise<{schemaVersion?:number,atlases:Array<object>}|null>}
 */
export async function loadGlobalAtlasesConfig(projectPath = '') {
  await sceneDataLoader._ensureConfigs();
  const normalizedProjectPath = normalizeAtlasProjectPath(projectPath);
  if (!normalizedProjectPath) return getGlobalAtlasesConfig();

  const cached = _atlasCatalogs.get(normalizedProjectPath);
  if (cached) return cached;
  const inFlight = _atlasLoadPromises.get(normalizedProjectPath);
  if (inFlight) return inFlight;
  if (!normalizedProjectPath.endsWith('/game.project.json') && normalizedProjectPath !== 'game.project.json') {
    throw new TypeError(`共享图集项目路径无效: ${normalizedProjectPath}`);
  }

  const catalogPath = `${normalizedProjectPath.slice(0, normalizedProjectPath.lastIndexOf('/') + 1)}config/atlases.json`;
  const loadPromise = (async () => {
    const response = await fetch('/api/read-file?path=' + encodeURIComponent(catalogPath));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `加载共享图集配置失败: HTTP ${response.status}`);
    }
    let config = payload;
    if (typeof payload?.content === 'string') {
      try {
        config = JSON.parse(payload.content);
      } catch (error) {
        throw new Error(`共享图集配置 JSON 无效 (${catalogPath}): ${error.message}`);
      }
    }
    return _storeAtlasCatalog(normalizedProjectPath, config);
  })();

  _atlasLoadPromises.set(normalizedProjectPath, loadPromise);
  try {
    return await loadPromise;
  } finally {
    if (_atlasLoadPromises.get(normalizedProjectPath) === loadPromise) {
      _atlasLoadPromises.delete(normalizedProjectPath);
    }
  }
}

/**
 * 获取游戏级共享图集配置。显式 projectPath 只查询对应分区，未命中返回 null。
 * @param {string} [projectPath]
 * @returns {{schemaVersion?:number,atlases:Array<object>}|null}
 */
export function getGlobalAtlasesConfig(projectPath = '') {
  const normalizedProjectPath = normalizeAtlasProjectPath(projectPath);
  return normalizedProjectPath
    ? (_atlasCatalogs.get(normalizedProjectPath) || null)
    : _atlasesConfig;
}

/**
 * 将游戏内 assets/ 路径转换为编辑器页面可加载的 URL。
 * @param {object|string} atlasOrId
 * @param {string} [gamePathOverride] 当前游戏目录（含或不含结尾斜杠）
 * @param {string} [projectPath] atlas ID 所属项目；显式传入时不读取可变全局宿主
 * @returns {string}
 */
export function getGlobalAtlasImageUrl(atlasOrId, gamePathOverride = '', projectPath = '') {
  const normalizedProjectPath = normalizeAtlasProjectPath(projectPath);
  const catalog = normalizedProjectPath ? getGlobalAtlasesConfig(normalizedProjectPath) : _atlasesConfig;
  const atlas = typeof atlasOrId === 'string'
    ? (catalog?.atlases || []).find(item => item?.id === atlasOrId)
    : atlasOrId;
  const path = String(atlas?.path || '');
  if (!path || /^(?:https?:|data:|blob:|\/|\.\.?\/)/.test(path)) return path;
  const projectGamePath = normalizedProjectPath
    ? `../${normalizedProjectPath.slice(0, normalizedProjectPath.lastIndexOf('/') + 1)}`
    : '';
  const rawGamePath = gamePathOverride
    || projectGamePath
    || (typeof window !== 'undefined' && window._editorCurrentGame?.path)
    || '../example/sanguo_zhangjiao/';
  const gamePath = `${String(rawGamePath).replace(/\\/g, '/').replace(/\/+$/, '')}/`;
  return `${gamePath}${path.replace(/^\/+/, '')}`;
}

/**
 * 获取全局图片资源配置
 * @returns {object} images 对象 { imageId: { src, name } }
 */
export function getGlobalImages() {
  return (_imagesConfig && _imagesConfig.images) || {};
}

/**
 * 外部更新图片资源缓存（保存图片后调用）
 * @param {object} config - { images: { ... } }
 */
export function updateImagesCache(config) {
  _imagesConfig = config;
}

/**
 * 向全局图片缓存合并单张图片（添加图片时调用，使其成为全局库资源，切场景不丢失）
 * @param {string} id - 图片 id
 * @param {object} data - { src, name }
 */
export function addGlobalImage(id, data) {
  if (!id || !data) return;
  if (!_imagesConfig) _imagesConfig = { images: {} };
  if (!_imagesConfig.images) _imagesConfig.images = {};
  _imagesConfig.images[id] = data;
}
