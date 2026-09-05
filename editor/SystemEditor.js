/**
 * SystemEditor - 系统编辑器
 * 
 * 配置游戏系统级参数（登录界面、加载页面、全局设置等），保存到 game.project.json 的 system 字段。
 * 标签顺序与运行时一致：登录界面 → 加载页面 → 天气/时间系统。
 */

const TIME_PERIOD_DEFAULTS = Object.freeze({
  dawn:         Object.freeze({ duration: 60, darknessOpacity: 0.25, tintColor: 'rgba(80,60,120,0.2)' }),
  earlyMorning: Object.freeze({ duration: 60, darknessOpacity: 0,    tintColor: 'rgba(255,200,100,0.1)' }),
  morning:      Object.freeze({ duration: 60, darknessOpacity: 0,    tintColor: 'rgba(0,0,0,0)' }),
  noon:         Object.freeze({ duration: 60, darknessOpacity: 0,    tintColor: 'rgba(0,0,0,0)' }),
  afternoon:    Object.freeze({ duration: 60, darknessOpacity: 0,    tintColor: 'rgba(255,180,50,0.05)' }),
  dusk:         Object.freeze({ duration: 60, darknessOpacity: 0.25, tintColor: 'rgba(255,100,50,0.15)' }),
  night:        Object.freeze({ duration: 60, darknessOpacity: 0.65, tintColor: 'rgba(20,20,80,0.3)' }),
  lateNight:    Object.freeze({ duration: 60, darknessOpacity: 0.65, tintColor: 'rgba(10,10,40,0.4)' })
});

const WEATHER_PARTICLE_DEFAULTS = Object.freeze({
  clear:     Object.freeze({ count: 0, windX: 0, windY: 0 }),
  breeze:    Object.freeze({ count: 12, windX: 40, windY: 3 }),
  wind:      Object.freeze({ count: 35, windX: 120, windY: 8 }),
  lightRain: Object.freeze({ count: 80, windX: 8, windY: 350 }),
  heavyRain: Object.freeze({ count: 180, windX: 30, windY: 520 }),
  lightFog:  Object.freeze({ count: 8, windX: 0, windY: 0 }),
  heavyFog:  Object.freeze({ count: 14, windX: 0, windY: 0 }),
  storm:     Object.freeze({ count: 140, windX: 55, windY: 480 })
});

export class SystemEditor {
  constructor(container, opts = {}) {
    this.container = container;
    this.gameId = opts.gameId || 'sanguo_zhangjiao';
    if (!opts.canonicalSession) {
      throw new TypeError('SystemEditor requires a shared CanonicalEditorSession');
    }
    this.canonicalSession = opts.canonicalSession;
    this.schemaFields = this.canonicalSession?.fields || null;
    this._initialized = false;
    this._data = null; // system 配置数据
  }

  async init() {
    await this._loadData();
    if (!this._initialized) {
      this._render();
      this._initialized = true;
    } else {
      this._render();
    }
  }

  async _loadData() {
    this._data = structuredClone(this.canonicalSession.getValue('system') || {});

    // 登录页面在运行时位于加载页面之前。
    if (!this._data.login) {
      this._data.login = {
        title: '三国张角传',
        subtitle: '苍天已死，黄天当立',
        description: '乱世将起，你的选择将改变众人的命运。',
        showDescription: true,
        backgroundImage: '',
        backgroundColor: '#111111',
        panelColor: 'rgba(15, 15, 18, 0.88)',
        titleColor: '#e7c778',
        textColor: '#dddddd',
        buttonColor: '#4b6728'
      };
    }
    // 兼容“显示文字”旧配置；保存后统一使用 showDescription。
    if (this._data.login.showDescription === undefined && this._data.login.showText !== undefined) {
      this._data.login.showDescription = this._data.login.showText;
    }
    // 确保 loading 子对象存在
    if (!this._data.loading) {
      this._data.loading = {
        title: '三国张角传',
        subtitle: '三月荒原',
        loadingText: '加载中...',
        icon: '',
        backgroundColor: '#1a1a1a',
        titleColor: '#4CAF50',
        progressBarColor: '#4CAF50,#8BC34A',
        steps: [
          { progress: 0, text: '初始化 ECS 系统...', delay: 500 },
          { progress: 25, text: '加载核心系统...', delay: 500 },
          { progress: 50, text: '创建场景管理器...', delay: 300 },
          { progress: 60, text: '注册场景...', delay: 500 },
          { progress: 75, text: '初始化玩家实体...', delay: 0 },
          { progress: 90, text: '进入第一幕...', delay: 500 },
          { progress: 100, text: '完成！', delay: 500 }
        ]
      };
    }
    // 确保 weather 子对象存在
    if (!this._data.weather) {
      this._data.weather = { default: 'clear', transitionSpeed: 0.5, particles: {} };
    }
    if (!this._data.weather.particles) this._data.weather.particles = {};
    // 确保 time 子对象存在
    if (!this._data.time) {
      this._data.time = {
        enabled: false,
        startPeriod: 'noon',
        periods: structuredClone(TIME_PERIOD_DEFAULTS)
      };
    }
    if (!this._data.time.periods) this._data.time.periods = {};
  }

  _persistenceError(result, fallback = 'canonical 提交失败') {
    const firstError = result?.errors?.[0];
    const validationMessage = [firstError?.path, firstError?.message || firstError?.reason]
      .filter(Boolean)
      .join(': ');
    if (validationMessage) return validationMessage;
    if (typeof result?.error?.message === 'string') return result.error.message;
    if (typeof result?.error === 'string') return result.error;
    return fallback;
  }

  async _save() {
    try {
      this.canonicalSession.patch('system', structuredClone(this._data));
      const result = await this.canonicalSession.save();
      if (result?.ok !== true || result.committed !== true) {
        throw Object.assign(new Error(this._persistenceError(result)), { result });
      }
      this._showToast(
        result.degraded ? '磁盘已提交，但缓存/通知同步降级' : '已保存到 canonical 配置',
        result.degraded ? 'warn' : 'success'
      );
      return result;
    } catch (error) {
      console.error('SystemEditor: 保存失败', error);
      const result = error.result || {
        ok: false,
        committed: false,
        status: 'failed',
        error
      };
      this._showToast(`保存失败：${this._persistenceError(result, error.message)}`, 'error');
      return result;
    }
  }

  _render() {
    const lg = this._data.login;
    const ld = this._data.loading;
    this.container.innerHTML = `
      <div style="padding:16px;color:#ccc;font-family:sans-serif;overflow-y:auto;height:100%;">
        <h2 style="color:#4CAF50;margin:0 0 16px;">系统编辑器</h2>
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <button class="sys-tab active" data-tab="login">登录界面</button>
          <button class="sys-tab" data-tab="loading">加载页面</button>
          <button class="sys-tab" data-tab="weather">天气系统</button>
          <button class="sys-tab" data-tab="time">时间系统</button>
        </div>
        <div id="sys-tab-login" class="sys-tab-content">
          <fieldset style="border:1px solid #333;padding:12px;border-radius:6px;margin-bottom:12px;">
            <legend style="color:#8cf;">文字内容</legend>
            <div class="sys-row"><label>标题:</label><input type="text" id="sys-lg-title" value="${this._esc(lg.title)}"></div>
            <div class="sys-row"><label>副标题:</label><input type="text" id="sys-lg-subtitle" value="${this._esc(lg.subtitle)}"></div>
            <div class="sys-row"><label>文字描述:</label><textarea id="sys-lg-description" rows="4">${this._esc(lg.description)}</textarea></div>
            <div class="sys-row"><label>显示描述文字:</label><input type="checkbox" id="sys-lg-show-description"${lg.showDescription !== false ? ' checked' : ''}></div>
          </fieldset>
          <fieldset style="border:1px solid #333;padding:12px;border-radius:6px;margin-bottom:12px;">
            <legend style="color:#8cf;">背景与样式</legend>
            <div class="sys-row"><label>背景图URL:</label><input type="text" id="sys-lg-image" value="${this._esc(lg.backgroundImage)}" placeholder="如 assets/images/login-bg.jpg"></div>
            <div class="sys-row"><label>背景色:</label><input type="color" id="sys-lg-bg" value="${lg.backgroundColor || '#111111'}"></div>
            <div class="sys-row"><label>面板颜色:</label><input type="text" id="sys-lg-panel" value="${this._esc(lg.panelColor)}" placeholder="支持 rgba(...) "></div>
            <div class="sys-row"><label>标题色:</label><input type="color" id="sys-lg-titlecolor" value="${lg.titleColor || '#e7c778'}"></div>
            <div class="sys-row"><label>文字色:</label><input type="color" id="sys-lg-textcolor" value="${lg.textColor || '#dddddd'}"></div>
            <div class="sys-row"><label>按钮色:</label><input type="color" id="sys-lg-button" value="${lg.buttonColor || '#4b6728'}"></div>
          </fieldset>
          <p style="color:#888;font-size:12px;">运行顺序：登录界面 → 加载页面 → 游戏场景。登录界面固定提供“开始游戏 / 继续游戏 / 退出游戏”。</p>
          <button id="sys-lg-save" style="padding:8px 24px;background:#4CAF50;border:none;color:#fff;border-radius:4px;cursor:pointer;font-size:14px;">保存</button>
        </div>
        <div id="sys-tab-loading" class="sys-tab-content" style="display:none;">
          <fieldset style="border:1px solid #333;padding:12px;border-radius:6px;margin-bottom:12px;">
            <legend style="color:#8cf;">基本信息</legend>
            <div class="sys-row"><label>标题:</label><input type="text" id="sys-ld-title" value="${this._esc(ld.title)}"></div>
            <div class="sys-row"><label>副标题:</label><input type="text" id="sys-ld-subtitle" value="${this._esc(ld.subtitle)}"></div>
            <div class="sys-row"><label>加载文字:</label><input type="text" id="sys-ld-text" value="${this._esc(ld.loadingText)}"></div>
            <div class="sys-row"><label>图标URL:</label><input type="text" id="sys-ld-icon" value="${this._esc(ld.icon)}" placeholder="留空=无图标，如 assets/images/logo.png"></div>
            <div class="sys-row" id="sys-ld-icon-preview-row" style="display:none;">
              <label>图标预览:</label>
              <div id="sys-ld-icon-preview" style="max-width:100%;overflow:auto;border:1px solid #333;padding:8px;background:#0a1020;border-radius:4px;">
                <img id="sys-ld-icon-preview-img" style="max-width:none;max-height:none;display:block;" alt="图标预览">
              </div>
              <span id="sys-ld-icon-size" style="color:#888;font-size:11px;margin-left:8px;"></span>
            </div>
          </fieldset>
          <fieldset style="border:1px solid #333;padding:12px;border-radius:6px;margin-bottom:12px;">
            <legend style="color:#8cf;">样式</legend>
            <div class="sys-row"><label>背景色:</label><input type="color" id="sys-ld-bg" value="${ld.backgroundColor || '#1a1a1a'}"></div>
            <div class="sys-row"><label>标题色:</label><input type="color" id="sys-ld-titlecolor" value="${ld.titleColor || '#4CAF50'}"></div>
            <div class="sys-row"><label>进度条渐变:</label><input type="text" id="sys-ld-barcolor" value="${ld.progressBarColor || '#4CAF50,#8BC34A'}" placeholder="#颜色1,#颜色2"></div>
          </fieldset>
          <fieldset style="border:1px solid #333;padding:12px;border-radius:6px;margin-bottom:12px;">
            <legend style="color:#8cf;">加载步骤</legend>
            <div id="sys-ld-steps"></div>
            <button id="sys-ld-add-step" style="margin-top:8px;padding:4px 12px;background:#2a3a2a;border:1px solid #4CAF50;color:#fff;border-radius:4px;cursor:pointer;">+ 添加步骤</button>
          </fieldset>
          <button id="sys-ld-save" style="padding:8px 24px;background:#4CAF50;border:none;color:#fff;border-radius:4px;cursor:pointer;font-size:14px;">保存</button>
        </div>
        <div id="sys-tab-weather" class="sys-tab-content" style="display:none;">
          <fieldset style="border:1px solid #333;padding:12px;border-radius:6px;margin-bottom:12px;">
            <legend style="color:#8cf;">天气配置</legend>
            <div class="sys-row"><label>默认天气:</label><select id="sys-wt-default">
              <option value="clear">晴天 clear</option>
              <option value="breeze">微风 breeze</option>
              <option value="wind">大风 wind</option>
              <option value="lightRain">小雨 lightRain</option>
              <option value="heavyRain">大雨 heavyRain</option>
              <option value="lightFog">小雾 lightFog</option>
              <option value="heavyFog">大雾 heavyFog</option>
              <option value="storm">雷暴 storm</option>
            </select></div>
            <div class="sys-row"><label>过渡速度:</label><input type="number" id="sys-wt-speed" value="0.5" step="0.1" min="0.1" max="5"></div>
          </fieldset>
          <fieldset style="border:1px solid #333;padding:12px;border-radius:6px;margin-bottom:12px;">
            <legend style="color:#8cf;">各天气参数</legend>
            <div id="sys-wt-defs"></div>
          </fieldset>
          <p style="color:#888;font-size:12px;">通过触发器动作 <code>setWeather</code> 切换，参数：<code>{"type":"heavyRain"}</code><br>Debug面板可实时选择天气预览效果。</p>
          <button id="sys-wt-save" style="padding:8px 24px;background:#4CAF50;border:none;color:#fff;border-radius:4px;cursor:pointer;font-size:14px;">保存</button>
        </div>
        <div id="sys-tab-time" class="sys-tab-content" style="display:none;">
          <fieldset style="border:1px solid #333;padding:12px;border-radius:6px;margin-bottom:12px;">
            <legend style="color:#8cf;">时间系统</legend>
            <div class="sys-row"><label>启用:</label><input type="checkbox" id="sys-tm-enabled"></div>
            <div class="sys-row"><label>起始时间段:</label><select id="sys-tm-start">
              <option value="dawn">凌晨</option><option value="earlyMorning">清晨</option>
              <option value="morning">上午</option><option value="noon" selected>中午</option>
              <option value="afternoon">下午</option><option value="dusk">黄昏</option>
              <option value="night">夜晚</option><option value="lateNight">深夜</option>
            </select></div>
          </fieldset>
          <fieldset style="border:1px solid #333;padding:12px;border-radius:6px;margin-bottom:12px;">
            <legend style="color:#8cf;">各时间段参数</legend>
            <div id="sys-tm-periods"></div>
          </fieldset>
          <p style="color:#888;font-size:12px;">通过触发器动作 <code>setTime</code> 跳转，参数：<code>{"period":"night"}</code></p>
          <button id="sys-tm-save" style="padding:8px 24px;background:#4CAF50;border:none;color:#fff;border-radius:4px;cursor:pointer;font-size:14px;">保存</button>
        </div>
      </div>
      <style>
        .sys-row { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
        .sys-row label { min-width:80px; color:#aaa; font-size:13px; }
        .sys-row input[type="text"], .sys-row input[type="number"], .sys-row textarea { flex:1; padding:4px 8px; background:#1a2a3a; border:1px solid #333; color:#fff; border-radius:3px; }
        .sys-row input[type="color"] { width:50px; height:28px; border:none; cursor:pointer; }
        .sys-tab { padding:6px 16px; background:#1a2a3a; border:1px solid #333; color:#aaa; border-radius:4px 4px 0 0; cursor:pointer; }
        .sys-tab.active { background:#0d1326; color:#4CAF50; border-bottom-color:#0d1326; }
        .sys-step-row { display:flex; align-items:center; gap:6px; margin-bottom:6px; background:#0a1020; padding:6px 8px; border-radius:4px; }
        .sys-step-row input { padding:3px 6px; background:#1a2a3a; border:1px solid #333; color:#fff; border-radius:3px; }
        .sys-step-row .step-progress { width:50px; }
        .sys-step-row .step-text { flex:1; }
        .sys-step-row .step-delay { width:60px; }
        .sys-step-row button { background:none; border:none; color:#f66; cursor:pointer; font-size:16px; }
      </style>
    `;
    this._renderSteps();
    this._bindEvents();
  }

  _renderSteps() {
    const container = this.container.querySelector('#sys-ld-steps');
    const steps = this._data.loading.steps || [];
    container.innerHTML = steps.map((s, i) => `
      <div class="sys-step-row" data-index="${i}">
        <input type="number" class="step-progress" value="${s.progress}" min="0" max="100" title="进度%">
        <input type="text" class="step-text" value="${this._esc(s.text)}" title="显示文字">
        <input type="number" class="step-delay" value="${s.delay}" min="0" step="100" title="延迟ms">
        <button class="step-remove" title="删除">✕</button>
      </div>
    `).join('');
  }

  _bindEvents() {
    // 标签切换
    this.container.querySelectorAll('.sys-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.container.querySelectorAll('.sys-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.container.querySelectorAll('.sys-tab-content').forEach(c => c.style.display = 'none');
        const target = this.container.querySelector(`#sys-tab-${tab.dataset.tab}`);
        if (target) target.style.display = '';
      });
    });

    // 登录页面保存（位于加载页面之前）
    this.container.querySelector('#sys-lg-save').addEventListener('click', async () => {
      this._collectLoginFields();
      await this._save();
    });
    // 加载页面保存
    this.container.querySelector('#sys-ld-save').addEventListener('click', async () => {
      this._collectFields();
      await this._save();
    });
    // 图标URL实时预览
    const iconInput = this.container.querySelector('#sys-ld-icon');
    if (iconInput) {
      iconInput.addEventListener('input', (e) => this._updateIconPreview(e.target.value));
    }
    // 天气保存
    const wtSave = this.container.querySelector('#sys-wt-save');
    if (wtSave) wtSave.addEventListener('click', async () => {
      this._data.weather.default = this.container.querySelector('#sys-wt-default').value;
      this._data.weather.transitionSpeed = parseFloat(this.container.querySelector('#sys-wt-speed').value);
      // 收集各天气粒子参数。
      this.container.querySelectorAll('.sys-wt-row').forEach(row => {
        const key = row.dataset.weather;
        if (!key) return;
        const current = this._data.weather.particles[key] || {};
        this._data.weather.particles[key] = {
          ...current,
          count: parseInt(row.querySelector('.wt-count').value) || 0,
          windX: parseFloat(row.querySelector('.wt-wx').value) || 0,
          windY: parseFloat(row.querySelector('.wt-wy').value) || 0
        };
      });
      await this._save();
    });
    // 时间保存
    const tmSave = this.container.querySelector('#sys-tm-save');
    if (tmSave) tmSave.addEventListener('click', async () => {
      this._data.time.enabled = this.container.querySelector('#sys-tm-enabled').checked;
      this._data.time.startPeriod = this.container.querySelector('#sys-tm-start').value;
      // 收集各时间段参数；darknessOpacity 是唯一全屏黑暗强度。
      this.container.querySelectorAll('.sys-period-row').forEach(row => {
        const periodId = row.dataset.period;
        if (!periodId) return;
        this._data.time.periods[periodId] = {
          ...(this._data.time.periods[periodId] || {}),
          duration: parseFloat(row.querySelector('.p-dur').value) || 60,
          darknessOpacity: parseFloat(row.querySelector('.p-darkness').value) || 0,
          tintColor: row.querySelector('.p-tint').value || 'rgba(0,0,0,0)'
        };
      });
      await this._save();
    });

    // 添加步骤
    this.container.querySelector('#sys-ld-add-step').addEventListener('click', () => {
      const steps = this._data.loading.steps;
      const lastProgress = steps.length > 0 ? steps[steps.length - 1].progress : 0;
      steps.push({ progress: Math.min(100, lastProgress + 10), text: '加载中...', delay: 300 });
      this._renderSteps();
      this._bindStepEvents();
    });
    this._bindStepEvents();
    this._renderTimePeriods();
    this._initWeatherFields();
    this._initTimeFields();
  }

  _bindStepEvents() {
    // 删除步骤
    this.container.querySelectorAll('.step-remove').forEach(btn => {
      btn.onclick = (e) => {
        const row = e.target.closest('.sys-step-row');
        const idx = parseInt(row.dataset.index);
        this._data.loading.steps.splice(idx, 1);
        this._renderSteps();
        this._bindStepEvents();
      };
    });
    // 步骤字段变化实时同步到 data
    this.container.querySelectorAll('.sys-step-row').forEach(row => {
      const idx = parseInt(row.dataset.index);
      row.querySelector('.step-progress').addEventListener('change', (e) => {
        this._data.loading.steps[idx].progress = parseInt(e.target.value) || 0;
      });
      row.querySelector('.step-text').addEventListener('change', (e) => {
        this._data.loading.steps[idx].text = e.target.value;
      });
      row.querySelector('.step-delay').addEventListener('change', (e) => {
        this._data.loading.steps[idx].delay = parseInt(e.target.value) || 0;
      });
    });
  }

  _collectLoginFields() {
    const lg = this._data.login;
    lg.title = this.container.querySelector('#sys-lg-title').value;
    lg.subtitle = this.container.querySelector('#sys-lg-subtitle').value;
    lg.description = this.container.querySelector('#sys-lg-description').value;
    lg.showDescription = this.container.querySelector('#sys-lg-show-description').checked;
    delete lg.showText;
    lg.backgroundImage = this.container.querySelector('#sys-lg-image').value.trim();
    lg.backgroundColor = this.container.querySelector('#sys-lg-bg').value;
    lg.panelColor = this.container.querySelector('#sys-lg-panel').value;
    lg.titleColor = this.container.querySelector('#sys-lg-titlecolor').value;
    lg.textColor = this.container.querySelector('#sys-lg-textcolor').value;
    lg.buttonColor = this.container.querySelector('#sys-lg-button').value;
  }

  _collectFields() {
    const ld = this._data.loading;
    ld.title = this.container.querySelector('#sys-ld-title').value;
    ld.subtitle = this.container.querySelector('#sys-ld-subtitle').value;
    ld.loadingText = this.container.querySelector('#sys-ld-text').value;
    ld.icon = this.container.querySelector('#sys-ld-icon').value;
    ld.backgroundColor = this.container.querySelector('#sys-ld-bg').value;
    ld.titleColor = this.container.querySelector('#sys-ld-titlecolor').value;
    ld.progressBarColor = this.container.querySelector('#sys-ld-barcolor').value;
  }

  _updateFields() {
    const ld = this._data.loading;
    const q = (id) => this.container.querySelector(id);
    if (q('#sys-ld-title')) q('#sys-ld-title').value = ld.title || '';
    if (q('#sys-ld-subtitle')) q('#sys-ld-subtitle').value = ld.subtitle || '';
    if (q('#sys-ld-text')) q('#sys-ld-text').value = ld.loadingText || '';
    if (q('#sys-ld-icon')) q('#sys-ld-icon').value = ld.icon || '';
    this._updateIconPreview(ld.icon || '');
    if (q('#sys-ld-bg')) q('#sys-ld-bg').value = ld.backgroundColor || '#1a1a1a';
    if (q('#sys-ld-titlecolor')) q('#sys-ld-titlecolor').value = ld.titleColor || '#4CAF50';
    if (q('#sys-ld-barcolor')) q('#sys-ld-barcolor').value = ld.progressBarColor || '#4CAF50,#8BC34A';
    this._renderSteps();
    this._bindStepEvents();
  }

  _updateIconPreview(url) {
    const row = this.container.querySelector('#sys-ld-icon-preview-row');
    const img = this.container.querySelector('#sys-ld-icon-preview-img');
    const sizeLabel = this.container.querySelector('#sys-ld-icon-size');
    if (!row || !img) return;
    if (!url || !url.trim()) {
      row.style.display = 'none';
      return;
    }
    row.style.display = 'flex';
    img.onload = () => {
      sizeLabel.textContent = `原始尺寸: ${img.naturalWidth} × ${img.naturalHeight}`;
    };
    img.onerror = () => {
      sizeLabel.textContent = '加载失败';
    };
    img.src = url;
  }

  _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  _renderTimePeriods() {
    const container = this.container.querySelector('#sys-tm-periods');
    if (!container) return;
    const NAMES = { dawn:'凌晨', earlyMorning:'清晨', morning:'上午', noon:'中午', afternoon:'下午', dusk:'黄昏', night:'夜晚', lateNight:'深夜' };
    const periods = this._data.time?.periods || {};
    container.innerHTML = Object.entries(NAMES).map(([key, name]) => {
      const p = { ...TIME_PERIOD_DEFAULTS[key], ...(periods[key] || {}) };
      return `<div class="sys-period-row" data-period="${key}" style="display:flex;align-items:center;gap:4px;margin-bottom:4px;background:#0a1020;padding:4px 6px;border-radius:3px;">
        <span style="width:50px;color:#aaa;font-size:11px;">${name}</span>
        <input class="p-dur" type="number" value="${p.duration}" min="10" max="600" style="width:45px;" title="持续秒数">
        <input class="p-darkness" type="number" value="${p.darknessOpacity}" min="0" max="1" step="0.05" style="width:52px;" title="黑暗蒙版透明度 0~1">
        <input class="p-tint" type="text" value="${p.tintColor}" style="flex:1;font-size:10px;" title="色调rgba">
      </div>`;
    }).join('');
  }

  _initWeatherFields() {
    const sel = this.container.querySelector('#sys-wt-default');
    const speed = this.container.querySelector('#sys-wt-speed');
    if (sel) sel.value = this._data.weather.default || 'clear';
    if (speed) speed.value = this._data.weather.transitionSpeed || 0.5;

    // 渲染各天气参数编辑
    const NAMES = { clear:'晴天', breeze:'微风', wind:'大风', lightRain:'小雨', heavyRain:'大雨', lightFog:'小雾', heavyFog:'大雾', storm:'雷暴' };
    const defsContainer = this.container.querySelector('#sys-wt-defs');
    if (!defsContainer) return;
    const particles = this._data.weather.particles;
    defsContainer.innerHTML = Object.entries(NAMES).map(([key, name]) => {
      const d = { ...WEATHER_PARTICLE_DEFAULTS[key], ...(particles[key] || {}) };
      return `<div class="sys-wt-row" data-weather="${key}" style="display:flex;align-items:center;gap:4px;margin-bottom:4px;background:#0a1020;padding:4px 6px;border-radius:3px;">
        <span style="width:40px;color:#aaa;font-size:11px;">${name}</span>
        <input class="wt-count" type="number" value="${d.count}" min="0" max="300" style="width:42px;" title="粒子数">
        <input class="wt-wx" type="number" value="${d.windX}" min="-200" max="200" style="width:42px;" title="风力X">
        <input class="wt-wy" type="number" value="${d.windY}" min="0" max="800" style="width:42px;" title="风力Y">
      </div>`;
    }).join('');
  }

  _initTimeFields() {
    const en = this.container.querySelector('#sys-tm-enabled');
    const start = this.container.querySelector('#sys-tm-start');
    if (en) en.checked = !!this._data.time.enabled;
    if (start) start.value = this._data.time.startPeriod || 'noon';
  }

  _showToast(msg, type = 'success') {
    let toast = document.getElementById('sys-editor-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sys-editor-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);padding:8px 20px;color:#fff;border-radius:4px;font-size:13px;z-index:99999;transition:opacity 0.3s;';
      document.body.appendChild(toast);
    }
    const backgrounds = {
      success: '#2e7d32',
      warn: '#9a6700',
      error: '#b3261e'
    };
    toast.textContent = msg;
    toast.dataset.type = type;
    toast.style.background = backgrounds[type] || backgrounds.success;
    toast.style.opacity = '1';
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
      this._toastTimer = null;
    }, 2500);
  }
}

export default SystemEditor;
