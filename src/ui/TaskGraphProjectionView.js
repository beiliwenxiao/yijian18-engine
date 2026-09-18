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

/** TaskGraphSystem 的只读玩家任务投影；不持有任务状态、不发命令。 */
export class TaskGraphProjectionView {
  constructor({ getTaskGraph = () => null, getActorId = () => null } = {}) {
    this.getTaskGraph = getTaskGraph;
    this.getActorId = getActorId;
    this.visible = true;
  }

  /**
   * 在 ScenePanelLayout 提供的正式屏幕 HUD 矩形内绘制当前玩家任务。
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x:number,y:number,width:number,height:number}} rect
   */
  render(ctx, rect) {
    if (!this.visible || !ctx || !rect) return false;
    const { x, y, width, height } = rect;
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return false;

    const tasks = this.getTaskGraph?.()?.getProjection?.(this.getActorId?.() || null) || [];
    if (tasks.length === 0) return false;

    const lines = [{ text: '任务追踪', accent: true, strong: true, progress: null }];
    for (const task of tasks.slice(0, 3)) {
      const taskRequiredCount = Math.max(0, Math.floor(Number(task.requiredCount) || 0));
      const taskCurrentCount = Math.min(taskRequiredCount, Math.max(0, Math.floor(Number(task.currentCount) || 0)));
      lines.push({
        text: task.title,
        accent: true,
        strong: false,
        progress: taskRequiredCount > 0 ? `${taskCurrentCount}/${taskRequiredCount}` : null,
        completed: taskRequiredCount > 0 && taskCurrentCount >= taskRequiredCount
      });
      for (const node of task.nodes.slice(0, 3)) {
        const requiredCount = Math.max(1, Math.floor(Number(node.requiredCount) || 1));
        const currentCount = Math.min(requiredCount, Math.max(0, Math.floor(Number(node.currentCount) || 0)));
        lines.push({
          text: `• ${node.label || node.nodeId}`,
          accent: false,
          strong: false,
          progress: node.isObjective === false ? null : `${currentCount}/${requiredCount}`,
          completed: currentCount >= requiredCount
        });
      }
    }

    const paddingX = Math.max(8, Math.min(14, Math.round(width * 0.04)));
    const paddingY = Math.max(6, Math.min(12, Math.round(height * 0.06)));
    const lineHeight = Math.max(16, Math.min(22, Math.round(height / 7)));
    const visibleLines = lines.slice(0, Math.max(1, Math.floor((height - paddingY * 2) / lineHeight)));
    const fontSize = Math.max(11, Math.min(15, Math.round(lineHeight * 0.68)));
    const maxTextWidth = Math.max(1, width - paddingX * 2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.fillStyle = 'rgba(10, 16, 30, 0.82)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#c49a52';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    visibleLines.forEach((line, index) => {
      const baselineY = y + paddingY + lineHeight * (index + 0.5);
      const progressWidth = line.progress ? Math.max(34, fontSize * 3.2) : 0;
      ctx.fillStyle = line.accent ? '#f0d080' : '#d6dbe8';
      ctx.font = `${line.strong ? 'bold ' : ''}${fontSize}px Microsoft YaHei, Arial`;
      ctx.textAlign = 'left';
      ctx.fillText(line.text, x + paddingX, baselineY, Math.max(1, maxTextWidth - progressWidth));
      if (line.progress) {
        ctx.fillStyle = line.completed ? '#8fd6a1' : '#f0d080';
        ctx.textAlign = 'right';
        ctx.fillText(line.progress, x + width - paddingX, baselineY, progressWidth);
      }
    });
    ctx.restore();
    return true;
  }
}

export default TaskGraphProjectionView;
