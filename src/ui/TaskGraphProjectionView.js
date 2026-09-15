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
  constructor({ getTaskGraph = () => null } = {}) {
    this.getTaskGraph = getTaskGraph;
    this.visible = true;
  }

  render(ctx, width = 1280, _height = 720) {
    if (!this.visible || !ctx) return false;
    const tasks = this.getTaskGraph?.()?.getProjection?.() || [];
    if (tasks.length === 0) return false;
    const lines = tasks.slice(0, 3).flatMap(task => [
      { text: task.title, accent: true },
      ...task.nodes.slice(0, 3).map(node => ({ text: `• ${node.nodeId}`, accent: false }))
    ]);
    const x = 18;
    const y = 86;
    const lineHeight = 20;
    const boxWidth = Math.min(340, Math.max(190, ...lines.map(line => ctx.measureText(line.text).width + 34)));
    const boxHeight = lines.length * lineHeight + 20;
    ctx.save();
    ctx.fillStyle = 'rgba(10, 16, 30, 0.82)';
    ctx.fillRect(x, y, boxWidth, boxHeight);
    ctx.strokeStyle = '#c49a52';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, boxWidth, boxHeight);
    ctx.font = '14px Microsoft YaHei, Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((line, index) => {
      ctx.fillStyle = line.accent ? '#f0d080' : '#d6dbe8';
      ctx.fillText(line.text, x + 12, y + 14 + index * lineHeight);
    });
    ctx.restore();
    return true;
  }
}

export default TaskGraphProjectionView;
