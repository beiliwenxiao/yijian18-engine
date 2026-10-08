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
 * ImageSlicer - 图片分割工具
 * 
 * 功能：
 * - 加载图片并显示
 * - 自动检测图片中的小块边界
 * - 手动标记和调整分割区域
 * - 导出分割配置为JSON
 * - 支持精灵图集(sprite sheet)分割
 */

export class ImageSlicer {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' 
      ? document.querySelector(container) 
      : container;
    
    this.options = {
      defaultTileSize: options.defaultTileSize || 32,
      autoDetectThreshold: options.autoDetectThreshold || 10,
      maxSlices: options.maxSlices || 500,
      ...options
    };
    
    // 当前加载的图片
    this.image = null;
    this.imageData = null;
    
    // 分割区域列表
    this.slices = [];
    
    // 选中的分割区域
    this.selectedSlice = null;
    
    // 缩放和平移
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    
    // 拖拽状态
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.isDrawingSlice = false;
    this.drawStart = { x: 0, y: 0 };
    
    // 回调函数
    this.onSliceSelect = null;
    this.onSliceUpdate = null;
    
    // 初始化UI
    this._initUI();
  }
  
  /**
   * 初始化UI界面
   * @private
   */
  _initUI() {
    this.container.innerHTML = `
      <div class="image-slicer">
        <div class="slicer-toolbar">
          <div class="toolbar-group">
            <label>图片:</label>
            <input type="file" id="slicer-image-input" accept="image/*">
          </div>
          <div class="toolbar-group">
            <button id="slicer-auto-detect" disabled>自动检测</button>
            <button id="slicer-grid-slice" disabled>网格分割</button>
          </div>
          <div class="toolbar-group">
            <label>网格尺寸:</label>
            <input type="number" id="slicer-tile-size" value="${this.options.defaultTileSize}" min="8" max="256">
          </div>
          <div class="toolbar-group">
            <button id="slicer-clear">清除所有</button>
            <button id="slicer-export">导出配置</button>
          </div>
        </div>
        <div class="slicer-main">
          <div class="slicer-canvas-container" id="slicer-canvas-container">
            <canvas id="slicer-canvas"></canvas>
            <canvas id="slicer-overlay"></canvas>
          </div>
          <div class="slicer-sidebar">
            <div class="slicer-info">
              <h3>图片信息</h3>
              <div id="slicer-image-info">未加载图片</div>
            </div>
            <div class="slicer-slices">
              <h3>分割区域 (<span id="slicer-slice-count">0</span>)</h3>
              <div id="slicer-slice-list" class="slice-list"></div>
            </div>
            <div class="slicer-selected">
              <h3>选中区域</h3>
              <div id="slicer-selected-info">未选中</div>
              <div class="slice-controls" id="slice-controls" style="display:none;">
                <div class="control-row">
                  <label>X:</label>
                  <input type="number" id="slice-x" min="0">
                </div>
                <div class="control-row">
                  <label>Y:</label>
                  <input type="number" id="slice-y" min="0">
                </div>
                <div class="control-row">
                  <label>宽度:</label>
                  <input type="number" id="slice-w" min="1">
                </div>
                <div class="control-row">
                  <label>高度:</label>
                  <input type="number" id="slice-h" min="1">
                </div>
                <div class="control-row">
                  <label>名称:</label>
                  <input type="text" id="slice-name" placeholder="自动命名">
                </div>
                <div class="control-row">
                  <label>类型:</label>
                  <select id="slice-type">
                    <option value="tile">地砖</option>
                    <option value="decoration">装饰</option>
                    <option value="character">角色</option>
                    <option value="effect">特效</option>
                    <option value="other">其他</option>
                  </select>
                </div>
                <div class="control-row">
                  <label>碰撞:</label>
                  <input type="checkbox" id="slice-collide">
                </div>
                <div class="control-row">
                  <button id="slice-delete">删除</button>
                  <button id="slice-duplicate">复制</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    // 添加样式
    this._addStyles();
    // 绑定事件
    this._bindEvents();
  }
  /**
   * 添加样式
   * @private
   */
  _addStyles() {
    if (document.getElementById('image-slicer-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'image-slicer-styles';
    style.textContent = `
      .image-slicer {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #1a1a2e;
        color: #fff;
      }
      
      .slicer-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        padding: 10px;
        background: #16213e;
        border-bottom: 1px solid #2a3a5e;
      }
      
      .toolbar-group {
        display: flex;
        align-items: center;
        gap: 5px;
      }
      
      .toolbar-group label {
        font-size: 12px;
        color: #aaa;
      }
      
      .toolbar-group input[type="file"] {
        font-size: 12px;
        color: #fff;
      }
      
      .toolbar-group input[type="number"],
      .toolbar-group input[type="text"] {
        width: 60px;
        padding: 4px 8px;
        background: #2a3a5e;
        border: 1px solid #3a4a7e;
        border-radius: 4px;
        color: #fff;
        font-size: 12px;
      }
      
      .toolbar-group button {
        padding: 6px 12px;
        background: #4a5a8e;
        border: none;
        border-radius: 4px;
        color: #fff;
        cursor: pointer;
        font-size: 12px;
      }
      
      .toolbar-group button:hover:not(:disabled) {
        background: #5a6a9e;
      }
      
      .toolbar-group button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      
      .slicer-main {
        display: flex;
        flex: 1;
        overflow: hidden;
      }
      
      .slicer-canvas-container {
        flex: 1;
        position: relative;
        overflow: hidden;
        background: #0a0a1e;
        cursor: crosshair;
      }
      
      .slicer-canvas-container canvas {
        position: absolute;
        top: 0;
        left: 0;
      }
      
      #slicer-canvas {
        z-index: 1;
      }
      
      #slicer-overlay {
        z-index: 2;
        pointer-events: none;
      }
      
      .slicer-sidebar {
        width: 280px;
        background: #16213e;
        border-left: 1px solid #2a3a5e;
        overflow-y: auto;
        padding: 10px;
      }
      
      .slicer-sidebar h3 {
        font-size: 14px;
        margin: 0 0 10px 0;
        color: #4CAF50;
      }
      
      .slicer-info, .slicer-slices, .slicer-selected {
        margin-bottom: 15px;
        padding-bottom: 15px;
        border-bottom: 1px solid #2a3a5e;
      }
      
      .slice-list {
        max-height: 200px;
        overflow-y: auto;
      }
      
      .slice-item {
        display: flex;
        align-items: center;
        padding: 5px 8px;
        margin-bottom: 3px;
        background: #2a3a5e;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      }
      
      .slice-item:hover {
        background: #3a4a7e;
      }
      
      .slice-item.selected {
        background: #4CAF50;
        color: #000;
      }
      
      .slice-item-color {
        width: 16px;
        height: 16px;
        margin-right: 8px;
        border-radius: 2px;
        border: 1px solid #fff;
      }
      
      .slice-controls {
        margin-top: 10px;
      }
      
      .control-row {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-bottom: 5px;
      }
      
      .control-row label {
        width: 50px;
        font-size: 12px;
        color: #aaa;
      }
      
      .control-row input[type="number"],
      .control-row input[type="text"],
      .control-row select {
        flex: 1;
        padding: 4px 8px;
        background: #2a3a5e;
        border: 1px solid #3a4a7e;
        border-radius: 4px;
        color: #fff;
        font-size: 12px;
      }
      
      .control-row button {
        flex: 1;
        padding: 4px 8px;
        background: #4a5a8e;
        border: none;
        border-radius: 4px;
        color: #fff;
        cursor: pointer;
        font-size: 12px;
      }
      
      .control-row button:hover {
        background: #5a6a9e;
      }
    `;
    
    document.head.appendChild(style);
  }
  
  /**
   * 绑定事件
   * @private
   */
  _bindEvents() {
    // 文件选择
    document.getElementById('slicer-image-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.loadImage(file);
      }
    });
    
    // 自动检测
    document.getElementById('slicer-auto-detect').addEventListener('click', () => {
      this.autoDetectSlices();
    });
    
    // 网格分割
    document.getElementById('slicer-grid-slice').addEventListener('click', () => {
      const tileSize = parseInt(document.getElementById('slicer-tile-size').value);
      this.gridSlice(tileSize);
    });
    
    // 清除所有
    document.getElementById('slicer-clear').addEventListener('click', () => {
      this.clearSlices();
    });
    
    // 导出
    document.getElementById('slicer-export').addEventListener('click', () => {
      this.exportConfig();
    });
    
    // Canvas事件
    const canvasContainer = document.getElementById('slicer-canvas-container');
    const canvas = document.getElementById('slicer-canvas');
    const overlay = document.getElementById('slicer-overlay');
    
    // 鼠标滚轮缩放
    canvasContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      this.zoom(delta, e.offsetX, e.offsetY);
    });
    
    // 鼠标按下
    canvasContainer.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // 左键
        // 检查是否点击了现有slice
        const clicked = this.getSliceAt(e.offsetX, e.offsetY);
        if (clicked) {
          this.selectSlice(clicked);
        } else {
          // 开始绘制新slice
          this.isDrawingSlice = true;
          this.drawStart = { x: e.offsetX, y: e.offsetY };
        }
      } else if (e.button === 1 || e.button === 2) { // 中键或右键拖拽
        this.isDragging = true;
        this.dragStart = { x: e.offsetX - this.offsetX, y: e.offsetY - this.offsetY };
      }
    });
    
    // 鼠标移动
    canvasContainer.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        this.offsetX = e.offsetX - this.dragStart.x;
        this.offsetY = e.offsetY - this.dragStart.y;
        this.render();
      } else if (this.isDrawingSlice) {
        this.renderDrawPreview(e.offsetX, e.offsetY);
      }
    });
    
    // 鼠标松开
    canvasContainer.addEventListener('mouseup', (e) => {
      if (this.isDrawingSlice && this.image) {
        const x = Math.min(this.drawStart.x, e.offsetX);
        const y = Math.min(this.drawStart.y, e.offsetY);
        const w = Math.abs(e.offsetX - this.drawStart.x);
        const h = Math.abs(e.offsetY - this.drawStart.y);
        
        if (w > 2 && h > 2) {
          // 转换为图片坐标
          const imgX = Math.round(x / this.scale - this.offsetX / this.scale);
          const imgY = Math.round(y / this.scale - this.offsetY / this.scale);
          const imgW = Math.round(w / this.scale);
          const imgH = Math.round(h / this.scale);
          
          this.addSlice(imgX, imgY, imgW, imgH);
        }
      }
      
      this.isDragging = false;
      this.isDrawingSlice = false;
    });
    
    // 右键菜单
    canvasContainer.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    
    // 选中slice的控件
    ['slice-x', 'slice-y', 'slice-w', 'slice-h', 'slice-name', 'slice-type', 'slice-collide'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => this.updateSelectedSlice());
      el.addEventListener('change', () => this.updateSelectedSlice());
    });
    
    document.getElementById('slice-delete').addEventListener('click', () => {
      this.deleteSelectedSlice();
    });
    
    document.getElementById('slice-duplicate').addEventListener('click', () => {
      this.duplicateSelectedSlice();
    });
  }
  
  /**
   * 加载图片
   * @param {File|string} source - 文件对象或URL
   */
  loadImage(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        this.image = img;
        
        // 创建canvas并绘制图片
        const canvas = document.getElementById('slicer-canvas');
        const overlay = document.getElementById('slicer-overlay');
        
        canvas.width = img.width;
        canvas.height = img.height;
        overlay.width = img.width;
        overlay.height = img.height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        // 保存图像数据
        this.imageData = ctx.getImageData(0, 0, img.width, img.height);
        
        // 更新UI
        document.getElementById('slicer-image-info').innerHTML = `
          <div>尺寸: ${img.width} x ${img.height}</div>
          <div>宽高比: ${(img.width / img.height).toFixed(2)}</div>
        `;
        
        document.getElementById('slicer-auto-detect').disabled = false;
        document.getElementById('slicer-grid-slice').disabled = false;
        
        // 自动适应大小
        this.fitToContainer();
        
        resolve(img);
      };
      
      img.onerror = () => {
        reject(new Error('图片加载失败'));
      };
      
      if (source instanceof File) {
        img.src = URL.createObjectURL(source);
      } else {
        img.src = source;
      }
    });
  }
  
  /**
   * 适应容器大小
   */
  fitToContainer() {
    const container = document.getElementById('slicer-canvas-container');
    const canvas = document.getElementById('slicer-canvas');
    
    if (!this.image) return;
    
    const scaleX = container.clientWidth / this.image.width;
    const scaleY = container.clientHeight / this.image.height;
    this.scale = Math.min(scaleX, scaleY, 2) * 0.9;
    
    this.offsetX = (container.clientWidth - this.image.width * this.scale) / 2;
    this.offsetY = (container.clientHeight - this.image.height * this.scale) / 2;
    
    this.render();
  }
  
  /**
   * 缩放
   */
  zoom(factor, pivotX, pivotY) {
    const oldScale = this.scale;
    this.scale *= factor;
    this.scale = Math.max(0.1, Math.min(10, this.scale));
    
    // 以鼠标位置为中心缩放
    const scaleRatio = this.scale / oldScale;
    this.offsetX = pivotX - (pivotX - this.offsetX) * scaleRatio;
    this.offsetY = pivotY - (pivotY - this.offsetY) * scaleRatio;
    
    this.render();
  }
  
  /**
   * 渲染
   */
  render() {
    if (!this.image) return;
    
    const canvas = document.getElementById('slicer-canvas');
    const ctx = canvas.getContext('2d');
    
    // 清除画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 应用变换
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    
    // 绘制图片
    ctx.drawImage(this.image, 0, 0);
    
    ctx.restore();
    
    // 渲染分割区域
    this.renderSlices();
  }
  
  /**
   * 渲染分割区域
   */
  renderSlices() {
    const overlay = document.getElementById('slicer-overlay');
    const ctx = overlay.getContext('2d');
    
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    
    for (const slice of this.slices) {
      const isSelected = slice === this.selectedSlice;
      
      // 计算屏幕坐标
      const x = slice.x * this.scale + this.offsetX;
      const y = slice.y * this.scale + this.offsetY;
      const w = slice.w * this.scale;
      const h = slice.h * this.scale;
      
      // 绘制边框
      ctx.strokeStyle = isSelected ? '#4CAF50' : '#2196F3';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(x, y, w, h);
      
      // 绘制半透明填充
      ctx.fillStyle = isSelected ? 'rgba(76, 175, 80, 0.2)' : 'rgba(33, 150, 243, 0.1)';
      ctx.fillRect(x, y, w, h);
      
      // 绘制标签
      if (this.scale > 0.5) {
        ctx.fillStyle = isSelected ? '#4CAF50' : '#2196F3';
        ctx.font = '10px Arial';
        ctx.fillText(slice.name, x + 2, y + 10);
      }
    }
  }
  
  /**
   * 渲染绘制预览
   */
  renderDrawPreview(mouseX, mouseY) {
    this.render();
    
    const overlay = document.getElementById('slicer-overlay');
    const ctx = overlay.getContext('2d');
    
    const x = Math.min(this.drawStart.x, mouseX);
    const y = Math.min(this.drawStart.y, mouseY);
    const w = Math.abs(mouseX - this.drawStart.x);
    const h = Math.abs(mouseY - this.drawStart.y);
    
    ctx.strokeStyle = '#FF5722';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    
    // 显示尺寸
    ctx.fillStyle = '#FF5722';
    ctx.font = '12px Arial';
    ctx.fillText(`${Math.round(w / this.scale)} x ${Math.round(h / this.scale)}`, x + 5, y - 5);
  }
  
  /**
   * 添加分割区域
   */
  addSlice(x, y, w, h, options = {}) {
    if (this.slices.length >= this.options.maxSlices) {
      alert(`分割区域数量已达上限 (${this.options.maxSlices})`);
      return null;
    }
    
    const slice = {
      id: 'slice_' + Date.now(),
      name: options.name || `slice_${this.slices.length}`,
      x: Math.max(0, x),
      y: Math.max(0, y),
      w: Math.max(1, w),
      h: Math.max(1, h),
      type: options.type || 'tile',
      collide: options.collide || false,
      color: options.color || this._randomColor()
    };
    
    this.slices.push(slice);
    this._updateSliceList();
    this.render();
    
    if (this.onSliceUpdate) {
      this.onSliceUpdate(this.slices);
    }
    
    return slice;
  }
  
  /**
   * 生成随机颜色
   * @private
   */
  _randomColor() {
    const hue = Math.random() * 360;
    return `hsl(${hue}, 70%, 50%)`;
  }
  
  /**
   * 获取指定位置的分割区域
   */
  getSliceAt(screenX, screenY) {
    // 从后往前遍历，后添加的在上层
    for (let i = this.slices.length - 1; i >= 0; i--) {
      const slice = this.slices[i];
      const x = slice.x * this.scale + this.offsetX;
      const y = slice.y * this.scale + this.offsetY;
      const w = slice.w * this.scale;
      const h = slice.h * this.scale;
      
      if (screenX >= x && screenX <= x + w && screenY >= y && screenY <= y + h) {
        return slice;
      }
    }
    return null;
  }
  
  /**
   * 选中分割区域
   */
  selectSlice(slice) {
    this.selectedSlice = slice;
    this._updateSliceList();
    this._updateSelectedInfo();
    this.render();
    
    if (this.onSliceSelect) {
      this.onSliceSelect(slice);
    }
  }
  
  /**
   * 更新选中的分割区域
   */
  updateSelectedSlice() {
    if (!this.selectedSlice) return;
    
    this.selectedSlice.x = parseInt(document.getElementById('slice-x').value) || 0;
    this.selectedSlice.y = parseInt(document.getElementById('slice-y').value) || 0;
    this.selectedSlice.w = parseInt(document.getElementById('slice-w').value) || 1;
    this.selectedSlice.h = parseInt(document.getElementById('slice-h').value) || 1;
    this.selectedSlice.name = document.getElementById('slice-name').value || this.selectedSlice.name;
    this.selectedSlice.type = document.getElementById('slice-type').value;
    this.selectedSlice.collide = document.getElementById('slice-collide').checked;
    
    this._updateSliceList();
    this.render();
    
    if (this.onSliceUpdate) {
      this.onSliceUpdate(this.slices);
    }
  }
  
  /**
   * 删除选中的分割区域
   */
  deleteSelectedSlice() {
    if (!this.selectedSlice) return;
    
    const index = this.slices.indexOf(this.selectedSlice);
    if (index !== -1) {
      this.slices.splice(index, 1);
      this.selectedSlice = null;
      this._updateSliceList();
      this._updateSelectedInfo();
      this.render();
      
      if (this.onSliceUpdate) {
        this.onSliceUpdate(this.slices);
      }
    }
  }
  
  /**
   * 复制选中的分割区域
   */
  duplicateSelectedSlice() {
    if (!this.selectedSlice) return;
    
    this.addSlice(
      this.selectedSlice.x + 10,
      this.selectedSlice.y + 10,
      this.selectedSlice.w,
      this.selectedSlice.h,
      {
        name: this.selectedSlice.name + '_copy',
        type: this.selectedSlice.type,
        collide: this.selectedSlice.collide
      }
    );
  }
  
  /**
   * 自动检测分割区域（基于透明度边界）
   */
  autoDetectSlices() {
    if (!this.imageData) return;
    
    const threshold = this.options.autoDetectThreshold;
    const data = this.imageData.data;
    const width = this.imageData.width;
    const height = this.imageData.height;
    
    // 简化版本：检测连续不透明区域
    const visited = new Array(width * height).fill(false);
    const regions = [];
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (visited[idx]) continue;
        
        // 检查是否是不透明像素
        const pixelIdx = idx * 4;
        const alpha = data[pixelIdx + 3];
        
        if (alpha > threshold) {
          // BFS找到连通区域
          const region = this._floodFill(x, y, width, height, data, visited, threshold);
          if (region.w > 2 && region.h > 2) {
            regions.push(region);
          }
        }
      }
    }
    
    // 添加检测到的区域
    for (const region of regions) {
      this.addSlice(region.x, region.y, region.w, region.h, { type: 'auto' });
    }
    
    console.log(`自动检测到 ${regions.length} 个区域`);
  }
  
  /**
   * 洪水填充算法找到连通区域
   * @private
   */
  _floodFill(startX, startY, width, height, data, visited, threshold) {
    const queue = [[startX, startY]];
    let minX = startX, maxX = startX;
    let minY = startY, maxY = startY;
    
    while (queue.length > 0) {
      const [x, y] = queue.shift();
      const idx = y * width + x;
      
      if (visited[idx]) continue;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const pixelIdx = idx * 4;
      const alpha = data[pixelIdx + 3];
      
      if (alpha <= threshold) continue;
      
      visited[idx] = true;
      
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      
      // 4邻域
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    
    return {
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1
    };
  }
  
  /**
   * 网格分割
   */
  gridSlice(tileSize) {
    if (!this.image) return;
    
    const cols = Math.ceil(this.image.width / tileSize);
    const rows = Math.ceil(this.image.height / tileSize);
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * tileSize;
        const y = row * tileSize;
        const w = Math.min(tileSize, this.image.width - x);
        const h = Math.min(tileSize, this.image.height - y);
        
        this.addSlice(x, y, w, h, {
          name: `tile_${col}_${row}`,
          type: 'tile'
        });
      }
    }
  }
  
  /**
   * 清除所有分割区域
   */
  clearSlices() {
    this.slices = [];
    this.selectedSlice = null;
    this._updateSliceList();
    this._updateSelectedInfo();
    this.render();
    
    if (this.onSliceUpdate) {
      this.onSliceUpdate(this.slices);
    }
  }
  
  /**
   * 导出配置
   */
  exportConfig() {
    const config = {
      imageWidth: this.image ? this.image.width : 0,
      imageHeight: this.image ? this.image.height : 0,
      slices: this.slices.map(s => ({
        name: s.name,
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        type: s.type,
        collide: s.collide
      }))
    };
    
    const json = JSON.stringify(config, null, 2);
    
    // 下载文件
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'slice_config.json';
    a.click();
    URL.revokeObjectURL(url);
    
    return json;
  }
  
  /**
   * 导入配置
   */
  importConfig(json) {
    try {
      const config = JSON.parse(json);
      
      this.clearSlices();
      
      for (const slice of config.slices) {
        this.addSlice(slice.x, slice.y, slice.w, slice.h, {
          name: slice.name,
          type: slice.type,
          collide: slice.collide
        });
      }
      
      return true;
    } catch (e) {
      console.error('导入配置失败:', e);
      return false;
    }
  }
  
  /**
   * 更新分割区域列表UI
   * @private
   */
  _updateSliceList() {
    document.getElementById('slicer-slice-count').textContent = this.slices.length;
    
    const list = document.getElementById('slicer-slice-list');
    list.innerHTML = '';
    
    for (const slice of this.slices) {
      const item = document.createElement('div');
      item.className = 'slice-item' + (slice === this.selectedSlice ? ' selected' : '');
      item.innerHTML = `
        <div class="slice-item-color" style="background: ${slice.color}"></div>
        <span>${slice.name} (${slice.w}x${slice.h})</span>
      `;
      item.addEventListener('click', () => this.selectSlice(slice));
      list.appendChild(item);
    }
  }
  
  /**
   * 更新选中区域信息UI
   * @private
   */
  _updateSelectedInfo() {
    const info = document.getElementById('slicer-selected-info');
    const controls = document.getElementById('slice-controls');
    
    if (this.selectedSlice) {
      info.innerHTML = `<strong>${this.selectedSlice.name}</strong>`;
      controls.style.display = 'block';
      
      document.getElementById('slice-x').value = this.selectedSlice.x;
      document.getElementById('slice-y').value = this.selectedSlice.y;
      document.getElementById('slice-w').value = this.selectedSlice.w;
      document.getElementById('slice-h').value = this.selectedSlice.h;
      document.getElementById('slice-name').value = this.selectedSlice.name;
      document.getElementById('slice-type').value = this.selectedSlice.type;
      document.getElementById('slice-collide').checked = this.selectedSlice.collide;
    } else {
      info.innerHTML = '未选中';
      controls.style.display = 'none';
    }
  }
}
