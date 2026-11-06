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
 * SceneEditorHistory - 场景编辑器撤销/重做/导入导出模块
 */
export class SceneEditorHistory {
  /**
   * @param {import('./SceneEditor.js').SceneEditor} editor - 主编辑器实例
   */
  constructor(editor) {
    this.editor = editor;
    this.undoStack = [];
    this.redoStack = [];
    this.maxSize = 50;
  }

  /**
   * 设置最大历史记录条数
   */
  setMaxSize(size) {
    this.maxSize = size;
  }

  /**
   * 保存历史状态
   */
  saveHistory() {
    const editor = this.editor;
    this.undoStack.push(JSON.stringify(editor.sceneData));
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    this.redoStack = [];
  }

  /**
   * 撤销
   */
  undo() {
    if (this.undoStack.length === 0) return;
    const editor = this.editor;
    this.redoStack.push(JSON.stringify(editor.sceneData));
    editor.sceneData = JSON.parse(this.undoStack.pop());
    editor.selectedObjects = [];
    editor.eventFilter?.rebuild({ preserveSelection: true });
    editor.layers.updateLayerList();
    editor.ui.updateObjectProperties();
    editor.ui.updateObjectCount();
    editor.ui.refreshBattleFlowFields?.();
    editor.ui.updateScenePathsPanel?.();
    editor.render();
  }

  /**
   * 重做
   */
  redo() {
    if (this.redoStack.length === 0) return;
    const editor = this.editor;
    this.undoStack.push(JSON.stringify(editor.sceneData));
    editor.sceneData = JSON.parse(this.redoStack.pop());
    editor.selectedObjects = [];
    editor.eventFilter?.rebuild({ preserveSelection: true });
    editor.layers.updateLayerList();
    editor.ui.updateObjectProperties();
    editor.ui.updateObjectCount();
    editor.ui.refreshBattleFlowFields?.();
    editor.ui.updateScenePathsPanel?.();
    editor.render();
  }

  /**
   * 重置历史
   */
  reset() {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * 保存场景（触发持久化回调）
   */
  async save() {
    const editor = this.editor;
    if (typeof editor.onSceneChange !== 'function') {
      const failure = {
        ok: false,
        committed: false,
        status: 'rejected',
        code: 'missingPersistenceHandler',
        errors: [{ path: '', message: '未配置场景持久化处理器', reason: '未配置场景持久化处理器' }]
      };
      console.error('SceneEditorHistory: 场景保存失败，未配置持久化处理器');
      editor.ui.showToast('场景保存失败：未配置持久化处理器', 'error');
      return failure;
    }

    try {
      const result = await editor.onSceneChange(editor.sceneData);
      if (result?.ok !== true || result.committed !== true) {
        const firstError = result?.errors?.[0];
        const detail = [firstError?.path, firstError?.message || firstError?.reason]
          .filter(Boolean)
          .join(': ');
        const message = detail || result?.error?.message || result?.error || '持久化处理器未确认磁盘提交';
        editor.ui.showToast(`场景保存失败：${message}`, 'error');
        return result || {
          ok: false,
          committed: false,
          status: 'failed',
          code: 'unconfirmedPersistence',
          errors: [{ path: '', message, reason: message }]
        };
      }

      if (result.degraded) {
        editor.ui.showToast('磁盘已提交，但缓存/通知同步降级', 'warn');
      } else {
        editor.ui.showToast(result.successMessage || '场景已保存');
      }
      return result;
    } catch (error) {
      const result = error?.result;
      const firstError = result?.errors?.[0];
      const detail = [firstError?.path, firstError?.message || firstError?.reason]
        .filter(Boolean)
        .join(': ');
      const message = detail || error?.message || '未知错误';
      console.error('SceneEditorHistory: 场景保存失败', error);
      editor.ui.showToast(`场景保存失败：${message}`, 'error');
      return result || {
        ok: false,
        committed: false,
        status: 'failed',
        code: 'persistenceFailed',
        errors: [{ path: '', message, reason: message }],
        error
      };
    }
  }
  /**
   * 导出 JSON。导出是纯序列化，不清理资源、不舍入、不注入元数据。
   */
  exportJSON() {
    const editor = this.editor;
    const json = JSON.stringify(editor.sceneData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${editor.sceneData.name || 'scene'}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return json;
  }

  /**
   * 导入 JSON
   */
  importJSON(source) {
    const editor = this.editor;
    const loadJSON = (json) => {
      try {
        editor.loadScene(JSON.parse(json));
        return true;
      } catch (e) {
        console.error('导入失败:', e);
        return false;
      }
    };

    if (source instanceof File) {
      const reader = new FileReader();
      reader.onload = (e) => loadJSON(e.target.result);
      reader.readAsText(source);
    } else if (typeof source === 'string') {
      return loadJSON(source);
    }
    return false;
  }

  /**
   * 获取场景数据
   */
  getSceneData() {
    return this.editor.sceneData;
  }
}
