/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-02-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { UIElement } from './UIElement.js';
import { ItemIconRenderer } from './ItemIconRenderer.js';

/**
 * 玩家信息面板
 * 显示玩家的姓名、职业、等级、装备和属性
 */
export class PlayerInfoPanel extends UIElement {
  /**
   * @param {Object} options - 配置选项
   * @param {Entity} options.player - 玩家实体
   * @param {string} [options.backgroundColor='rgba(0, 0, 0, 0.7)'] - 背景颜色
   * @param {string} [options.borderColor='#4a9eff'] - 边框颜色
   * @param {string} [options.textColor='#ffffff'] - 文字颜色
   * @param {Function} [options.onAttributeAllocate] - 属性加点按钮点击回调
   * @param {Function} [options.onEquipmentClick] - 装备点击回调
   */
  constructor(options = {}) {
    super({
      x: options.x || 10,
      y: options.y || 10,
      width: options.width || 320,
      height: options.height || 580,
      visible: options.visible !== undefined ? options.visible : true,
      zIndex: options.zIndex || 100
    });
    
    this._playerSource = options.player || null;
    this.player = options.player || null;
    this.getProjection = typeof options.getProjection === 'function' ? options.getProjection : () => null;
    this.backgroundColor = options.backgroundColor || 'rgba(0, 0, 0, 0.85)';
    this.borderColor = options.borderColor || '#4a9eff';
    this.textColor = options.textColor || '#ffffff';
    this.labelColor = options.labelColor || '#aaaaaa';
    
    this.borderWidth = 2;
    this.padding = 15;
    this.lineHeight = 20;
    
    // 横排布局（移动端：属性左侧,装备右侧,面板更矮更宽）
    this.horizontalLayout = options.horizontalLayout || false;

    // 分离显示开关（PC 端属性/装备分成两个面板）
    // showEquipmentSection: 是否显示装备槽区
    // showAttributeSection: 是否显示职业/等级/属性列表/加点
    this.showEquipmentSection = options.showEquipmentSection !== false;
    this.showAttributeSection = options.showAttributeSection !== false;
    
    // 装备槽尺寸
    this.equipSlotSize = 50;
    this.equipSlotPadding = 8;
    
    // 属性加点按钮回调
    this.onAttributeAllocate = options.onAttributeAllocate || null;
    
    // 装备点击回调
    this.onEquipmentClick = options.onEquipmentClick || null;
    
    // 属性加点按钮状态
    this.attributeButtonHovered = false;
    this.attributeButtonRect = null;
    
    // 装备槽悬停状态
    this.hoveredEquipSlot = null;
    // 手柄焦点独立于鼠标悬停，渲染与导航都依赖稳定槽位定义而不是上一帧命中矩形。
    this.focusedEquipSlot = null;
    this.equipSlots = {};
    
    // 职业颜色映射
    this.classColors = {
      'warrior': '#ff6b6b',
      'strategist': '#4a9eff',
      'archer': '#51cf66',
      'refugee': '#888888'
    };
    
    // 职业中文名映射
    this.classNames = {
      'warrior': '战士',
      'strategist': '军师',
      'archer': '弓箭手',
      'refugee': '平民'
    };
    
    // 装备槽位置定义（3列4行布局）
    this.equipSlotPositions = {
      'accessory': { row: 0, col: 0, label: '饰品' },
      'helmet': { row: 0, col: 1, label: '头盔' },
      'necklace': { row: 0, col: 2, label: '项链' },
      'mainhand': { row: 1, col: 0, label: '主手武器' },
      'armor': { row: 1, col: 1, label: '胸甲' },
      'offhand': { row: 1, col: 2, label: '副手武器' },
      'ring1': { row: 2, col: 0, label: '戒指' },
      'belt': { row: 2, col: 1, label: '腰带' },
      'ring2': { row: 2, col: 2, label: '戒指' },
      'instrument': { row: 3, col: 0, label: '器械' },
      'boots': { row: 3, col: 1, label: '鞋子' },
      'mount': { row: 3, col: 2, label: '坐骑' }
    };
  }

  /**
   * 应用面板编辑器的布局数据（数据驱动渲染）
   * @param {Object} panelDef - 面板定义 { width, height, backgroundColor, borderColor, borderWidth, parts[] }
   */
  applyPanelLayout(panelDef) {
    if (!panelDef) return;
    this._panelLayout = panelDef;
    // 组合背包中宽高由 BackpackPanel 与 UIEditor 同步，零值边框必须保留以实现透明子面板。
    this.width = panelDef.width ?? this.width;
    this.height = panelDef.height ?? this.height;
    this.backgroundColor = panelDef.backgroundColor ?? this.backgroundColor;
    this.borderColor = panelDef.borderColor ?? this.borderColor;
    this.borderWidth = panelDef.borderWidth ?? this.borderWidth;
  }

  /**
   * 数据驱动渲染（按面板编辑器的 parts 数据绘制）
   * @param {CanvasRenderingContext2D} ctx
   */
  _renderFromLayout(ctx) {
    const layout = this._panelLayout;
    const stats = this.player.getComponent('stats');
    const equipment = this.player.getComponent('equipment');
    const nameComponent = this.player.getComponent('name');
    const playerName = nameComponent?.name || nameComponent?.displayName || this.player.name || '玩家';
    this.equipSlots = {};
    this.attributeButtonRect = null;

    // 子面板在组合背包中使用透明底框，外层 BackpackPanel 统一绘制背景和边框。
    ctx.fillStyle = layout.backgroundColor ?? this.backgroundColor;
    ctx.fillRect(this.x, this.y, this.width, this.height);
    const borderWidth = layout.borderWidth ?? this.borderWidth;
    if (borderWidth > 0) {
      ctx.strokeStyle = layout.borderColor ?? this.borderColor;
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(this.x, this.y, this.width, this.height);
    }

    // 遍历 parts 绘制
    for (const part of layout.parts) {
      const px = this.x + part.x;
      const py = this.y + part.y;
      const pw = part.width;
      const ph = part.height;

      switch (part.type) {
        case 'text': {
          // 替换模板变量
          let text = part.text || '';
          text = text.replace(/\{playerName\}/g, playerName);
          if (stats) {
            text = text.replace('{className}', this.classNames[this.player.class] || this.player.class || '');
            text = text.replace('{class}', this.classNames[this.player.class] || this.player.class || '');
            text = text.replace('{level}', stats.level || 1);
          }
          ctx.fillStyle = part.color || '#ffffff';
          ctx.font = `${part.fontWeight || 'normal'} ${part.fontSize || 14}px Arial`;
          ctx.textAlign = part.align || 'left';
          ctx.textBaseline = 'top';
          const tx = part.align === 'center' ? px + pw / 2 : part.align === 'right' ? px + pw : px;
          ctx.fillText(text, tx, py);
          ctx.textAlign = 'left';
          break;
        }
        case 'line':
          ctx.strokeStyle = part.color || this.borderColor;
          ctx.lineWidth = ph || 1;
          ctx.beginPath();
          ctx.moveTo(px, py + ph / 2);
          ctx.lineTo(px + pw, py + ph / 2);
          ctx.stroke();
          break;

        case 'button': {
          ctx.fillStyle = part.bgColor || '#2a5a8f';
          ctx.fillRect(px, py, pw, ph);
          ctx.strokeStyle = part.borderColor || this.borderColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(px, py, pw, ph);
          ctx.fillStyle = part.color || '#ffffff';
          ctx.font = `bold ${part.fontSize || 12}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(part.text || '', px + pw / 2, py + ph / 2);
          ctx.textAlign = 'left';
          // 保存加点按钮位置
          if (part.id === 'attrAllocBtn') {
            this.attributeButtonRect = { x: px, y: py, width: pw, height: ph };
          }
          break;
        }
        case 'equip-slot': {
          const slotType = part.slotType;
          ctx.fillStyle = part.slotBgColor || 'rgba(30,30,30,0.9)';
          ctx.fillRect(px, py, pw, ph);
          ctx.strokeStyle = part.slotBorderColor || '#555';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px, py, pw, ph);
          // 保存槽位位置（点击用）
          this.equipSlots[slotType] = { x: px, y: py, width: pw, height: ph, slotType, label: part.slotLabel };
          // 渲染装备图标
          if (equipment) {
            const equip = equipment.getEquipment(slotType);
            if (equip) {
              this.drawEquipIcon(ctx, equip, px, py, pw, ph);
            } else {
              this._drawEmptySlotLabel(ctx, part.slotLabel, px, py, pw, ph);
            }
          } else {
            this._drawEmptySlotLabel(ctx, part.slotLabel, px, py, pw, ph);
          }
          // 鼠标悬停和手柄焦点分别用白/金色描边，手柄焦点不依赖鼠标坐标。
          if (this.focusedEquipSlot === slotType) {
            ctx.strokeStyle = '#ffe785';
            ctx.lineWidth = 2;
            ctx.strokeRect(px, py, pw, ph);
          } else if (this.hoveredEquipSlot === slotType) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.strokeRect(px, py, pw, ph);
          }
          break;
        }
        case 'attr-row': {
          if (!stats) break;
          const label = part.attrLabel || '';
          let value = '';
          switch (label) {
            case 'HP': value = `${Math.round(stats.hp)}/${stats.maxHp}`; break;
            case 'MP': value = `${Math.round(stats.mp)}/${stats.maxMp}`; break;
            case '攻击': value = `${stats.attack}`; break;
            case '防御': value = `${stats.defense}`; break;
            case '速度': value = `${stats.speed}`; break;
            default: value = '0';
          }
          ctx.fillStyle = part.labelColor || '#aaaaaa';
          ctx.font = `${part.fontSize || 13}px Arial`;
          ctx.textBaseline = 'top';
          ctx.fillText(`${label}:`, px, py);
          ctx.fillStyle = part.attrColor || '#ffffff';
          // 标签与数值的间距随面板缩放（组合背包会按比例注入 valueOffsetX）
          ctx.fillText(value, px + (part.valueOffsetX ?? 60), py);
          break;
        }
        case 'slot-grid': {
          // 背包格子渲染（此面板通常不含，留作扩展）
          const cols = part.cols || 6;
          const rows = part.rows || 4;
          const sz = part.slotSize || 50;
          const pad = part.slotPadding || 5;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const sx = px + c * (sz + pad);
              const sy = py + r * (sz + pad);
              ctx.fillStyle = part.slotBgColor || 'rgba(50,50,50,0.8)';
              ctx.fillRect(sx, sy, sz, sz);
              ctx.strokeStyle = part.slotBorderColor || '#666';
              ctx.lineWidth = 1;
              ctx.strokeRect(sx, sy, sz, sz);
            }
          }
          break;
        }
        // 其他类型不影响此面板，跳过
      }
    }

    // 渲染装备tooltip（复用现有逻辑）
    if (this.showEquipmentSection && equipment) {
      this.renderEquipmentTooltip(ctx, equipment);
    }
  }

  /**
   * 绘制空装备槽的占位文字，字号随槽位尺寸缩放，避免面板缩小后文字溢出。
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} label - 槽位名称
   * @param {number} px - 槽位左上角 x
   * @param {number} py - 槽位左上角 y
   * @param {number} pw - 槽位宽
   * @param {number} ph - 槽位高
   */
  _drawEmptySlotLabel(ctx, label, px, py, pw, ph) {
    const fontSize = Math.max(8, Math.round(Math.min(pw, ph) * 0.2));
    ctx.fillStyle = '#555';
    ctx.font = `${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label || '', px + pw / 2, py + ph / 2);
    ctx.textAlign = 'left';
  }

  /**
   * 设置玩家实体
   * @param {Entity} player - 玩家实体
   */
  setPlayer(player) {
    this._playerSource = player || null;
    if (!player) {
      this.player = null;
      return;
    }
    this.player = new Proxy(player, {
      get: (target, property, receiver) => {
        if (property !== 'getComponent') return Reflect.get(target, property, receiver);
        return type => {
          const projectionSnapshot = this.getProjection();
          const projection = projectionSnapshot?.value || projectionSnapshot;
          if (!projection) return target.getComponent?.(type);
          if (type === 'stats') {
            return target.getComponent?.('stats') || projection.stats || null;
          }
          if (type === 'equipment') {
            const liveEquipment = target.getComponent?.('equipment');
            if (liveEquipment) return liveEquipment;
            const slots = projection.equipment || {};
            return { slots, getEquipment: slot => slots[slot] || null };
          }
          return target.getComponent?.(type);
        };
      }
    });
  }
  
  /**
   * 设置属性加点回调
   * @param {Function} callback - 回调函数
   */
  setOnAttributeAllocate(callback) {
    this.onAttributeAllocate = callback;
  }
  
  /**
   * 设置装备点击回调
   * @param {Function} callback - 回调函数
   */
  setOnEquipmentClick(callback) {
    this.onEquipmentClick = callback;
  }

  /**
   * 横排布局渲染（移动端：左侧属性 + 右侧装备，面板更矮更宽）
   * @param {CanvasRenderingContext2D} ctx
   */
  renderHorizontal(ctx) {
    const stats = this.player.getComponent('stats');
    const equipment = this.player.getComponent('equipment');
    if (!stats) return;

    // 背景 + 边框
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = this.borderWidth;
    ctx.strokeRect(this.x, this.y, this.width, this.height);

    const pad = 12;
    const leftW = Math.floor(this.width * 0.4); // 左侧属性占 40%
    const rightX = this.x + leftW;

    // ===== 左侧：角色名 + 属性 =====
    let ly = this.y + pad;
    const className = this.classNames[this.player.class] || this.player.class;
    const nameComponent = this.player.getComponent('name');
    const playerName = nameComponent?.name || nameComponent?.displayName || this.player.name || '玩家';
    ctx.fillStyle = this.textColor;
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(playerName, this.x + pad, ly);
    ly += 20;

    ctx.fillStyle = this.labelColor;
    ctx.font = '12px Arial';
    ctx.fillText(`Lv.${stats.level}`, this.x + pad, ly);
    ly += 20;

    // 属性列表
    const attributes = [
      { label: 'HP', value: `${Math.round(stats.hp)}/${stats.maxHp}`, color: '#ff4444' },
      { label: 'MP', value: `${Math.round(stats.mp)}/${stats.maxMp}`, color: '#4444ff' },
      { label: '攻击', value: stats.attack, color: '#ffaa00' },
      { label: '防御', value: stats.defense, color: '#00aaff' },
      { label: '速度', value: stats.speed, color: '#00ff00' }
    ];
    ctx.font = '12px Arial';
    for (const attr of attributes) {
      ctx.fillStyle = this.labelColor;
      ctx.fillText(`${attr.label}:`, this.x + pad, ly);
      ctx.fillStyle = attr.color;
      ctx.fillText(attr.value.toString(), this.x + pad + 45, ly);
      ly += 18;
    }

    // ===== 右侧：装备槽 3×4 =====
    const slotSize = 50;
    const slotGap = 5;
    const cols = 3;
    const totalSlotsWidth = cols * slotSize + (cols - 1) * slotGap;
    const eqStartX = rightX + (this.width - leftW - totalSlotsWidth) / 2;
    let eqStartY = this.y + pad;

    ctx.fillStyle = this.borderColor;
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('装备', rightX + (this.width - leftW) / 2, eqStartY);
    eqStartY += 20;

    this.equipSlots = {};
    for (const [slotType, pos] of Object.entries(this.equipSlotPositions)) {
      const sx = eqStartX + pos.col * (slotSize + slotGap);
      const sy = eqStartY + pos.row * (slotSize + slotGap);

      // 保存槽位位置(用于点击检测)
      this.equipSlots[slotType] = { x: sx, y: sy, width: slotSize, height: slotSize };

      // 背景
      const isHov = this.hoveredEquipSlot === slotType;
      ctx.fillStyle = isHov ? 'rgba(100,150,255,0.3)' : 'rgba(60,60,60,0.5)';
      ctx.fillRect(sx, sy, slotSize, slotSize);
      ctx.strokeStyle = isHov ? '#4a9eff' : '#555';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx, sy, slotSize, slotSize);

      // 装备图标
      const equippedItem = equipment && equipment.slots ? equipment.slots[slotType] : null;
      if (equippedItem) {
        this.drawEquipIcon(
          ctx,
          equippedItem,
          sx + slotSize * 0.1,
          sy + slotSize * 0.1,
          slotSize * 0.8,
          slotSize * 0.8
        );
        if (equippedItem.quantity > 1) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 10px Arial';
          ctx.textAlign = 'right';
          ctx.fillText(`${equippedItem.quantity}`, sx + slotSize - 2, sy + slotSize - 2);
        }
      } else {
        // 空槽标签
        ctx.fillStyle = '#555';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(pos.label.substring(0, 2), sx + slotSize / 2, sy + slotSize / 2 + 3);
      }
    }
    ctx.textAlign = 'left';

    // tooltip(复用现有)
    this.renderEquipmentTooltip(ctx, equipment);
  }

  /**
   * 更新面板
   * @param {number} deltaTime - 帧间隔时间（毫秒）
   */
  update(deltaTime) {
    // 面板内容实时从玩家实体读取，无需更新
  }

  /**
   * 渲染面板
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   */
  render(ctx) {
    if (!this.visible || !this.player) return;

    // 数据驱动渲染（面板编辑器配置）
    if (this._panelLayout) {
      this._renderFromLayout(ctx);
      return;
    }

    // 横排布局（移动端）
    if (this.horizontalLayout) {
      this.renderHorizontal(ctx);
      return;
    }

    // 兜底：无面板编辑器数据时用旧逻辑
    // 绘制背景
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(this.x, this.y, this.width, this.height);

    // 绘制边框
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = this.borderWidth;
    ctx.strokeRect(this.x, this.y, this.width, this.height);

    // 获取玩家数据
    const stats = this.player.getComponent('stats');
    const equipment = this.player.getComponent('equipment');
    
    if (!stats) return;

    let currentY = this.y + this.padding;

    // 绘制标题
    ctx.fillStyle = this.borderColor;
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'left';
    const _title = (this.showEquipmentSection && !this.showAttributeSection) ? '装备'
      : (!this.showEquipmentSection && this.showAttributeSection) ? '属性' : '角色信息';
    ctx.fillText(_title, this.x + this.padding, currentY);
    currentY += this.lineHeight + 5;

    // 绘制分隔线
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.x + this.padding, currentY);
    ctx.lineTo(this.x + this.width - this.padding, currentY);
    ctx.stroke();
    currentY += 10;

    // 绘制角色名称
    const className = this.classNames[this.player.class] || this.player.class;
    const nameComponent = this.player.getComponent('name');
    const playerName = nameComponent?.name || nameComponent?.displayName || this.player.name || '玩家';
    ctx.fillStyle = this.textColor;
    ctx.font = 'bold 16px Arial';
    ctx.fillText(`${playerName}`, this.x + this.padding, currentY + 5);
    
    currentY += this.lineHeight + 5;

    // 绘制职业和等级（属性区）
    if (this.showAttributeSection) {
      const classColor = this.classColors[this.player.class] || '#ffffff';

      ctx.fillStyle = this.labelColor;
      ctx.font = '14px Arial';
      ctx.fillText('职业:', this.x + this.padding, currentY);

      ctx.fillStyle = classColor;
      ctx.font = 'bold 14px Arial';
      ctx.fillText(className, this.x + this.padding + 50, currentY);

      ctx.fillStyle = this.labelColor;
      ctx.fillText('等级:', this.x + this.padding + 150, currentY);

      ctx.fillStyle = this.textColor;
      ctx.fillText(`${stats.level}`, this.x + this.padding + 190, currentY);
      currentY += this.lineHeight + 10;
    }

    // 绘制装备区域（属性/装备分离时可关闭）
    if (this.showEquipmentSection) {
      ctx.fillStyle = this.borderColor;
      ctx.font = 'bold 14px Arial';
      ctx.fillText('装备', this.x + this.padding, currentY);
      currentY += this.lineHeight + 5;

      // 绘制装备槽
      this.renderEquipmentSlots(ctx, currentY, equipment);
      currentY += (this.equipSlotSize + this.equipSlotPadding) * 4 + 10;
    } else {
      this.equipSlots = {}; // 不显示装备时清空槽位，避免误点击
    }

    // 绘制属性标题、加点按钮和属性列表（属性区）
    if (this.showAttributeSection) {
      ctx.fillStyle = this.borderColor;
      ctx.font = 'bold 14px Arial';
      ctx.fillText('属性', this.x + this.padding, currentY);

      // 绘制属性加点按钮 [+]
      const buttonX = this.x + this.padding + 50;
      const buttonY = currentY - 12;
      const buttonWidth = 24;
      const buttonHeight = 16;

      // 保存按钮位置用于点击检测
      this.attributeButtonRect = {
        x: buttonX,
        y: buttonY,
        width: buttonWidth,
        height: buttonHeight
      };

      // 按钮背景
      ctx.fillStyle = this.attributeButtonHovered ? '#4a9eff' : '#2a5a8f';
      ctx.fillRect(buttonX, buttonY, buttonWidth, buttonHeight);

      // 按钮边框
      ctx.strokeStyle = this.borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(buttonX, buttonY, buttonWidth, buttonHeight);

      // 按钮文字
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('+', buttonX + buttonWidth / 2, buttonY + 12);
      ctx.textAlign = 'left';

      currentY += this.lineHeight;

      // 绘制属性列表
      const attributes = [
        { label: 'HP', value: `${Math.round(stats.hp)}/${stats.maxHp}`, color: '#ff4444' },
        { label: 'MP', value: `${Math.round(stats.mp)}/${stats.maxMp}`, color: '#4444ff' },
        { label: '攻击', value: stats.attack, color: '#ffaa00' },
        { label: '防御', value: stats.defense, color: '#00aaff' },
        { label: '速度', value: stats.speed, color: '#00ff00' }
      ];

      ctx.font = '13px Arial';
      for (const attr of attributes) {
        // 标签
        ctx.fillStyle = this.labelColor;
        ctx.fillText(`${attr.label}:`, this.x + this.padding, currentY);

        // 值
        ctx.fillStyle = attr.color;
        ctx.fillText(attr.value.toString(), this.x + this.padding + 60, currentY);
        currentY += this.lineHeight;
      }
    } else {
      this.attributeButtonRect = null; // 不显示属性时清空加点按钮
    }

    // 绘制装备tooltip
    if (this.showEquipmentSection) {
      this.renderEquipmentTooltip(ctx, equipment);
    }
  }

  /**
   * 渲染装备槽
   */
  renderEquipmentSlots(ctx, startY, equipment) {
    this.equipSlots = {};
    
    const slotsPerRow = 3; // 改为3列
    const slotWidth = this.equipSlotSize;
    const slotHeight = this.equipSlotSize;
    const totalWidth = slotsPerRow * slotWidth + (slotsPerRow - 1) * this.equipSlotPadding;
    const startX = this.x + (this.width - totalWidth) / 2;
    
    for (const [slotType, position] of Object.entries(this.equipSlotPositions)) {
      const slotX = startX + position.col * (slotWidth + this.equipSlotPadding);
      const slotY = startY + position.row * (slotHeight + this.equipSlotPadding);
      
      // 保存槽位置用于点击检测
      this.equipSlots[slotType] = {
        x: slotX,
        y: slotY,
        width: slotWidth,
        height: slotHeight
      };
      
      const isHovered = this.hoveredEquipSlot === slotType;
      const isFocused = this.focusedEquipSlot === slotType;
      const equippedItem = equipment?.slots[slotType] || null;
      
      // 绘制槽背景
      ctx.fillStyle = isFocused
        ? 'rgba(255, 231, 133, 0.24)'
        : (isHovered ? 'rgba(74, 158, 255, 0.3)' : 'rgba(50, 50, 50, 0.8)');
      ctx.fillRect(slotX, slotY, slotWidth, slotHeight);
      
      // 绘制槽边框
      ctx.strokeStyle = isFocused ? '#ffe785' : (isHovered ? '#4a9eff' : '#666666');
      ctx.lineWidth = isFocused ? 3 : 2;
      ctx.strokeRect(slotX, slotY, slotWidth, slotHeight);
      
      if (equippedItem) {
        // 绘制装备图标（简化为颜色块）
        const rarityColors = {
          0: '#888888', // 普通
          1: '#00ff00', // 优秀
          2: '#0088ff', // 精良
          3: '#aa00ff', // 史诗
          4: '#ff8800'  // 传说
        };
        
        ctx.fillStyle = rarityColors[equippedItem.rarity] || '#888888';
        ctx.fillRect(slotX + 5, slotY + 5, slotWidth - 10, slotHeight - 10);
        
        this.drawEquipIcon(ctx, equippedItem, slotX, slotY, slotWidth, slotHeight);
        
        // 数量显示（箭矢等可堆叠装备）
        if (equippedItem.quantity != null && equippedItem.quantity > 0) {
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px Arial';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`${equippedItem.quantity}`, slotX + slotWidth - 3, slotY + slotHeight - 3);
        }
      } else {
        // 绘制空槽提示
        ctx.fillStyle = '#666666';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(position.label, slotX + slotWidth / 2, slotY + slotHeight / 2);
      }
    }
  }

  /**
   * 绘制装备图标
   */
  drawEquipIcon(ctx, equipment, slotX, slotY, slotWidth, slotHeight) {
    const cx = slotX + slotWidth / 2;
    const cy = slotY + slotHeight / 2;
    const iconSize = Math.min(slotWidth, slotHeight);
    if (ItemIconRenderer.drawIcon(ctx, equipment, cx, cy, iconSize)) return true;

    const label = String(
      equipment?.name || equipment?.displayName || equipment?.definitionId || equipment?.id || '?'
    ).trim() || '?';
    const rarityColors = {
      0: '#888888',
      1: '#00ff00',
      2: '#0088ff',
      3: '#aa00ff',
      4: '#ff8800'
    };
    const inset = Math.max(3, Math.round(iconSize * 0.1));
    ctx.save();
    ctx.fillStyle = rarityColors[equipment?.rarity] || '#888888';
    ctx.fillRect(
      slotX + inset,
      slotY + inset,
      Math.max(0, slotWidth - inset * 2),
      Math.max(0, slotHeight - inset * 2)
    );
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(10, Math.round(iconSize * 0.36))}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.charAt(0), cx, cy);
    ctx.restore();
    return true;
  }

  /** 返回稳定装备槽类型，供手柄导航使用。 */
  getEquipmentSlotTypes() {
    return Object.keys(this.equipSlotPositions);
  }

  /** 按 3×4 逻辑网格查询槽位，不依赖上一帧绘制命中矩形。 */
  getEquipmentSlotAt(row, col) {
    return Object.entries(this.equipSlotPositions)
      .find(([, position]) => position.row === row && position.col === col)?.[0] || null;
  }

  getEquipmentSlotPosition(slotType) {
    return this.equipSlotPositions[slotType] || null;
  }

  getEquipmentItem(slotType) {
    const equipment = this.player?.getComponent?.('equipment');
    return equipment?.getEquipment?.(slotType) || equipment?.slots?.[slotType] || null;
  }

  setFocusedEquipSlot(slotType) {
    this.focusedEquipSlot = slotType && this.equipSlotPositions[slotType] ? slotType : null;
    return this.focusedEquipSlot;
  }

  /**
   * 处理鼠标移动事件
   * @param {number} x - 鼠标X坐标
   * @param {number} y - 鼠标Y坐标
   */
  handleMouseMove(x, y) {
    if (!this.visible) return;
    
    // 保存鼠标位置用于tooltip
    this.mouseX = x;
    this.mouseY = y;
    
    // 检查是否悬停在属性加点按钮上
    if (this.attributeButtonRect) {
      const btn = this.attributeButtonRect;
      this.attributeButtonHovered = (
        x >= btn.x && x <= btn.x + btn.width &&
        y >= btn.y && y <= btn.y + btn.height
      );
    }
    
    // 检查是否悬停在装备槽上
    this.hoveredEquipSlot = null;
    for (const [slotType, slot] of Object.entries(this.equipSlots)) {
      if (x >= slot.x && x <= slot.x + slot.width &&
          y >= slot.y && y <= slot.y + slot.height) {
        this.hoveredEquipSlot = slotType;
        break;
      }
    }
  }

  /**
   * 渲染装备tooltip
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} equipment - 装备组件
   */
  renderEquipmentTooltip(ctx, equipment) {
    if (!this.hoveredEquipSlot || !equipment) return;
    
    const item = equipment.slots[this.hoveredEquipSlot];
    if (!item) return;
    
    const tooltipWidth = 280;
    const isTool = typeof item.toolType === 'string' && item.toolType.length > 0;
    const toolLineCount = isTool ? (Number(item.durability) <= 0 ? 4 : 3) : 0;
    const tooltipHeight = 200 + toolLineCount * 14;
    
    // 获取canvas尺寸
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;
    
    // 默认显示在鼠标右侧
    let tooltipX = this.mouseX + 15;
    let tooltipY = this.mouseY - 20;
    
    // 如果超出右边界，显示在鼠标左侧
    if (tooltipX + tooltipWidth > canvasWidth) {
      tooltipX = this.mouseX - tooltipWidth - 15;
    }
    
    // 如果左侧也超出，显示在面板右侧
    if (tooltipX < 0) {
      tooltipX = this.x + this.width + 10;
      // 如果面板右侧也超出，显示在面板左侧
      if (tooltipX + tooltipWidth > canvasWidth) {
        tooltipX = this.x - tooltipWidth - 10;
      }
    }
    
    // 如果超出下边界，向上调整
    if (tooltipY + tooltipHeight > canvasHeight) {
      tooltipY = canvasHeight - tooltipHeight - 10;
    }
    
    // 如果超出上边界，向下调整
    if (tooltipY < 0) {
      tooltipY = 10;
    }
    
    // 稀有度颜色
    const rarityColors = {
      0: '#888888', // 普通
      1: '#00ff00', // 优秀
      2: '#0088ff', // 精良
      3: '#aa00ff', // 史诗
      4: '#ff8800'  // 传说
    };
    
    // 提示框背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
    
    // 提示框边框
    ctx.strokeStyle = rarityColors[item.rarity] || '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);

    let yOffset = 20;
    
    // 物品名称
    ctx.fillStyle = rarityColors[item.rarity] || '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(item.name, tooltipX + 10, tooltipY + yOffset);
    yOffset += 20;
    
    // 物品类型和稀有度
    const typeNames = {
      'weapon': '武器',
      'armor': '护甲',
      'accessory': '饰品',
      'consumable': '消耗品'
    };
    
    const rarityNames = {
      0: '普通',
      1: '优秀',
      2: '精良',
      3: '史诗',
      4: '传说'
    };
    
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '12px Arial';
    const typeName = typeNames[item.type] || item.type;
    const rarityName = rarityNames[item.rarity] || '未知';
    ctx.fillText(`${typeName} | ${rarityName}`, tooltipX + 10, tooltipY + yOffset);
    yOffset += 15;
    
    // 物品描述
    if (item.description) {
      ctx.fillStyle = '#cccccc';
      ctx.font = '10px Arial';
      yOffset += 5;
      this.wrapText(ctx, item.description, tooltipX + 10, tooltipY + yOffset, tooltipWidth - 20, 12);
      yOffset += 30;
    }
    
    // 装备属性
    if (item.stats) {
      ctx.fillStyle = '#ffff00';
      ctx.font = '11px Arial';
      ctx.fillText('装备属性:', tooltipX + 10, tooltipY + yOffset);
      yOffset += 15;
      
      ctx.fillStyle = '#00ff00';
      
      if (item.stats.attack) {
        ctx.fillText(`攻击力: +${item.stats.attack}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      if (item.stats.defense) {
        ctx.fillText(`防御力: +${item.stats.defense}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      if (item.stats.maxHp) {
        ctx.fillText(`生命值: +${item.stats.maxHp}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      if (item.stats.maxMp) {
        ctx.fillText(`魔法值: +${item.stats.maxMp}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      if (item.stats.speed) {
        ctx.fillText(`速度: +${item.stats.speed}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
    }
    
    // 工具属性
    if (typeof item.toolType === 'string' && item.toolType) {
      const maxDurability = Number(item.maxDurability) || 0;
      const durability = Math.max(0, Number(item.durability) || 0);
      ctx.fillStyle = '#7fd6ff';
      ctx.font = '11px Arial';
      ctx.fillText(`功能: ${item.functionDescription || `用于${item.toolType}`}`, tooltipX + 10, tooltipY + yOffset);
      yOffset += 14;
      ctx.fillStyle = durability <= 0 ? '#ff7777' : '#ffffff';
      ctx.fillText(`耐久: ${durability}/${maxDurability}`, tooltipX + 10, tooltipY + yOffset);
      yOffset += 14;
      ctx.fillStyle = '#a9e59b';
      ctx.fillText(`采集速度: ×${Number(item.gatherSpeed) > 0 ? item.gatherSpeed : 1}`, tooltipX + 10, tooltipY + yOffset);
      yOffset += 14;
      if (durability <= 0) {
        ctx.fillStyle = '#ff7777';
        ctx.fillText('工具已损坏，可锻造修复', tooltipX + 10, tooltipY + yOffset);
        yOffset += 14;
      }
    }

    // 特殊属性（穿刺、多重箭等）
    if (item.pierce) {
      ctx.fillStyle = '#ff8800';
      ctx.font = '11px Arial';
      ctx.fillText(`穿刺: ${item.pierce}`, tooltipX + 15, tooltipY + yOffset);
      yOffset += 12;
    }
    if (item.multishot) {
      ctx.fillStyle = '#ff8800';
      ctx.font = '11px Arial';
      ctx.fillText(`多重箭: ${item.multishot}`, tooltipX + 15, tooltipY + yOffset);
      yOffset += 12;
    }
    
    // 攻击间隔（武器特有属性）
    if (item.attackSpeed != null) {
      ctx.fillStyle = '#ffaa00';
      ctx.fillText(`攻击间隔: ${item.attackSpeed}秒`, tooltipX + 15, tooltipY + yOffset);
      yOffset += 12;
    } else if (item.subType === 'mainhand' || item.subType === 'offhand' || item.subType === 'weapon') {
      ctx.fillStyle = '#ffaa00';
      ctx.fillText(`攻击间隔: 3秒`, tooltipX + 15, tooltipY + yOffset);
      yOffset += 12;
    }
  }

  /**
   * 文本换行
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {string} text - 文本
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} maxWidth - 最大宽度
   * @param {number} lineHeight - 行高
   */
  wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split('');
    let line = '';
    let currentY = y;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i];
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;

      if (testWidth > maxWidth && i > 0) {
        ctx.fillText(line, x, currentY);
        line = words[i];
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
  }

  /**
   * 处理鼠标点击事件
   * @param {number} x - 鼠标X坐标
   * @param {number} y - 鼠标Y坐标
   * @param {string} button - 鼠标按钮 ('left' | 'right')
   * @returns {boolean} 是否处理了点击事件
   */
  handleMouseClick(x, y, button = 'left') {
    // 如果不可见或点击不在面板内，返回 false
    if (!this.visible || !this.containsPoint(x, y)) {
      return false;
    }
    
    // 检查是否点击了属性加点按钮
    if (this.attributeButtonRect && button === 'left') {
      const btn = this.attributeButtonRect;
      if (x >= btn.x && x <= btn.x + btn.width &&
          y >= btn.y && y <= btn.y + btn.height) {
        console.log('PlayerInfoPanel: 点击属性加点按钮');
        if (this.onAttributeAllocate) {
          this.onAttributeAllocate(this.player);
        }
        return true;
      }
    }
    
    // 检查是否点击了装备槽
    for (const [slotType, slot] of Object.entries(this.equipSlots)) {
      if (x >= slot.x && x <= slot.x + slot.width &&
          y >= slot.y && y <= slot.y + slot.height) {
        console.log('PlayerInfoPanel: 点击装备槽', slotType);
        if (this.onEquipmentClick) {
          this.onEquipmentClick(slotType, button);
        }
        return true;
      }
    }
    
    // 点击在面板内任何位置都算处理了（阻止事件传播）
    return true;
  }
}
