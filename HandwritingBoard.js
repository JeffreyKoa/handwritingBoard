/**
 * 手写板插件 (HandwritingBoard) v1.6
 */
class HandwritingBoard {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`HandwritingBoard: Container #${containerId} not found.`);
      return;
    }
    
    this.options = Object.assign({
      width: '100%',
      height: null,
      background: 'grid',
      readOnly: false,
      onSave: null,
      answerRows: 10,
      lineHeight: 32,
      expandRowsStep: 5
    }, options);

    this.history = [];
    this.currentTool = 'pen';
    this.isDrawing = false;
    this.isDragging = false;
    this.selectedObject = null;
    this.dragStartPoint = null;
    this._fullscreen = { active: false, previousHeight: null };
    this._answerRows = this.options.answerRows;
    this._lineHeight = this.options.lineHeight;
    this._expandRowsStep = this.options.expandRowsStep;
    this._pan = { active: false, startClientY: 0, startScrollTop: 0 };
    this._movedDuringDrag = false;

    this.config = {
      color: '#000000',
      width: 3,
      font: 'Arial',
      background: this.options.background
    };
    
    this._initDOM();
    this._bindEvents();
    
    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this._resizeCanvas());
      this.resizeObserver.observe(this.canvasContainer);
    } else {
      window.addEventListener('resize', () => this._resizeCanvas());
    }
    
    setTimeout(() => this._resizeCanvas(), 50);
    this.container.handwritingBoard = this;
  }

  _initDOM() {
    this.container.style.position = 'relative';
    this.container.style.border = '1px solid #ccc';
    this.container.style.display = 'flex';
    this.container.style.flexDirection = 'column';
    this.container.style.height = this.options.height || 'auto';
    this.container.style.overflowX = 'hidden';
    this.container.style.overflowY = 'hidden';
    this.container.style.background = '#fff';
    this.container.style.touchAction = 'none';

    // 1. 工具栏
    const toolbar = document.createElement('div');
    this.toolbar = toolbar;
    toolbar.className = 'hb-toolbar';
    toolbar.style.cssText = `
      padding: 5px; background: #f9f9f9; border-bottom: 1px solid #eee;
      display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
      position: sticky; top: 0; z-index: 10;
    `;
    
    const createBtn = (id, text, title) => {
      const btn = document.createElement('button');
      btn.dataset.action = id;
      btn.title = title || text;
      btn.innerHTML = text;
      btn.style.cssText = `padding: 4px 8px; cursor: pointer; border: 1px solid #ddd; background: #fff; border-radius: 4px; user-select: none;`;
      return btn;
    };

    const tools = [
      { id: 'select', icon: '✋', title: '移动/选择' },
      { id: 'pen', icon: '✏️', title: '笔' },
      { id: 'line', icon: '📏', title: '直线' },
      { id: 'rect', icon: '⬜', title: '矩形' },
      { id: 'circle', icon: '⚪', title: '圆形' },
      { id: 'text', icon: 'T', title: '文本' },
      { id: 'eraser', icon: '🧼', title: '橡皮' }
    ];

    tools.forEach(t => {
      const btn = createBtn(t.id, t.icon, t.title);
      if (t.id === 'pen') this._setActiveBtn(btn);
      btn.onclick = (e) => {
        e.preventDefault(); 
        this._confirmText();
        this.currentTool = t.id;
        this._setActiveBtn(btn);
        
        // 切换光标样式
        this.canvasContainer.style.cursor = t.id === 'select' ? 'default' : 'crosshair';
      };
      toolbar.appendChild(btn);
    });

    const sep = () => {
      const s = document.createElement('span');
      s.style.cssText = 'width:1px; height:20px; background:#ddd; margin:0 5px;';
      return s;
    };
    toolbar.appendChild(sep());

    const btnUndo = createBtn('undo', '↩');
    btnUndo.onclick = () => this.undo();
    toolbar.appendChild(btnUndo);

    const btnClear = createBtn('clear', '🗑️');
    btnClear.onclick = () => this.clear();
    toolbar.appendChild(btnClear);

    toolbar.appendChild(sep());

    // 属性控件
    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.value = this.config.color;
    colorPicker.style.cssText = 'width:30px; height:30px; border:none; padding:0; cursor:pointer;';
    colorPicker.onchange = (e) => this.config.color = e.target.value;
    toolbar.appendChild(colorPicker);

    const widthPicker = document.createElement('input');
    widthPicker.type = 'range';
    widthPicker.min = 1;
    widthPicker.max = 10;
    widthPicker.value = this.config.width;
    widthPicker.style.width = '60px';
    widthPicker.oninput = (e) => this.config.width = parseInt(e.target.value);
    toolbar.appendChild(widthPicker);

    const bgSelect = document.createElement('select');
    bgSelect.innerHTML = `<option value="blank">空白</option><option value="grid">方格</option><option value="line">横线</option>`;
    bgSelect.value = this.config.background;
    bgSelect.onchange = (e) => {
      this.config.background = e.target.value;
      this.redraw();
    };
    toolbar.appendChild(bgSelect);

    const toolbarSpacer = document.createElement('span');
    toolbarSpacer.style.cssText = 'flex:1 1 auto;';
    toolbar.appendChild(toolbarSpacer);

    const btnExpand = createBtn('expand', '+ 增加行', '增加答题空间');
    btnExpand.style.borderColor = '#b7eb8f';
    btnExpand.style.color = '#237804';
    btnExpand.style.background = '#f6ffed';
    btnExpand.onclick = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      this._increaseAnswerSpace();
    };
    toolbar.appendChild(btnExpand);

    const btnFullscreen = createBtn('fullscreen', '⛶ 全屏', '全屏/退出全屏 (Esc 退出)');
    btnFullscreen.style.borderColor = '#91caff';
    btnFullscreen.style.color = '#0958d9';
    btnFullscreen.style.background = '#e6f4ff';
    btnFullscreen.onclick = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      this._toggleFullscreen();
    };
    toolbar.appendChild(btnFullscreen);

    // 2. 画布区域
    const canvasContainer = document.createElement('div');
    canvasContainer.style.cssText = 'flex:0 0 auto; position:relative; background:#fff; cursor:crosshair; overflow:hidden; touch-action:none;';
    
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    
    // 文本输入框
    const textInput = document.createElement('div');
    textInput.style.cssText = 'position:absolute; display:none; border:1px dashed #007bff; background:rgba(255,255,255,0.95); padding:5px; z-index:100; min-width:100px; box-shadow:0 2px 5px rgba(0,0,0,0.2);';
    
    const textArea = document.createElement('textarea');
    textArea.style.cssText = 'width:100%; height:100%; min-height:40px; border:none; outline:none; background:transparent; resize:both; overflow:hidden; font-family:inherit;';
    
    const confirmBtn = document.createElement('button');
    confirmBtn.innerText = '确定';
    confirmBtn.style.cssText = 'position:absolute; right:0; bottom:-28px; font-size:12px; padding:4px 8px; cursor:pointer; background:#007bff; color:#fff; border:none; border-radius:2px;';
    
    confirmBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    confirmBtn.addEventListener('touchstart', (e) => e.stopPropagation());
    
    textInput.appendChild(textArea);
    textInput.appendChild(confirmBtn);
    
    canvasContainer.appendChild(canvas);
    canvasContainer.appendChild(textInput);
    
    this.container.appendChild(toolbar);
    this.container.appendChild(canvasContainer);

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.canvasContainer = canvasContainer;
    this.textInput = textInput;
    this.textArea = textArea;
    this.confirmTextBtn = confirmBtn;
    this._btnFullscreen = btnFullscreen;
    this._btnExpand = btnExpand;

    const handleGlobalClick = (e) => {
      if (this.textInput.style.display !== 'none' && !this.textInput.contains(e.target)) {
        this._confirmText();
      }
    };
    this.canvasContainer.addEventListener('mousedown', handleGlobalClick, true);
    this.canvasContainer.addEventListener('touchstart', handleGlobalClick, true);

    if (!document.getElementById('hb-fullscreen-style')) {
      const style = document.createElement('style');
      style.id = 'hb-fullscreen-style';
      style.textContent = `
        .hb-fullscreen-host { background: #fff; overflow-y: auto; -webkit-overflow-scrolling: touch; }
        .hb-fullscreen-host:fullscreen { width: 100vw; height: 100vh; }
        .hb-fullscreen-host:-webkit-full-screen { width: 100vw; height: 100vh; }
      `;
      document.head.appendChild(style);
    }

    this._applyAnswerHeight();
    this._updateFullscreenButton();
  }

  _setActiveBtn(activeBtn) {
    Array.from(this.toolbar.children).forEach(child => {
      if (child.tagName === 'BUTTON' && child.dataset.action) {
        if (child.dataset.action === 'fullscreen') {
          child.style.borderColor = '#91caff';
          child.style.color = '#0958d9';
          child.style.background = '#e6f4ff';
        } else if (child.dataset.action === 'expand') {
          child.style.borderColor = '#b7eb8f';
          child.style.color = '#237804';
          child.style.background = '#f6ffed';
        } else {
          child.style.background = '#fff';
          child.style.color = '#000';
          child.style.borderColor = '#ddd';
        }
      }
    });
    if (activeBtn.dataset.action === 'fullscreen' || activeBtn.dataset.action === 'expand') return;
    activeBtn.style.background = '#007bff';
    activeBtn.style.color = '#fff';
    activeBtn.style.borderColor = '#0056b3';
  }

  _applyAnswerHeight() {
    const canvasHeight = Math.max(1, this._answerRows * this._lineHeight);
    this.canvasContainer.style.height = canvasHeight + 'px';

    if (this._isFullscreenActive()) {
      this.container.style.height = '100vh';
      this.container.style.overflowY = 'auto';
    } else {
      this.container.style.overflowY = 'hidden';
      if (this.options.height) {
        this.container.style.height = this.options.height;
      } else {
        const toolbarHeight = this.toolbar ? this.toolbar.offsetHeight : 0;
        this.container.style.height = (toolbarHeight + canvasHeight) + 'px';
      }
    }
  }

  _increaseAnswerSpace() {
    this._answerRows += this._expandRowsStep;
    this._applyAnswerHeight();
    this._resizeCanvas();
  }

  _updateFullscreenButton() {
    if (!this._btnFullscreen) return;
    if (this._isFullscreenActive()) {
      this._btnFullscreen.innerHTML = '✕ 退出';
      this._btnFullscreen.title = '退出全屏 (Esc)';
    } else {
      this._btnFullscreen.innerHTML = '⛶ 全屏';
      this._btnFullscreen.title = '进入全屏';
    }
  }

  _isFullscreenActive() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  async _toggleFullscreen() {
    if (this._isFullscreenActive()) {
      await this._exitFullscreen();
    } else {
      await this._enterFullscreen();
    }
  }

  async _enterFullscreen() {
    try {
      this._fullscreen.previousHeight = this.container.style.height;
      this.container.classList.add('hb-fullscreen-host');

      const request = this.container.requestFullscreen || this.container.webkitRequestFullscreen;
      if (request) {
        await request.call(this.container);
      }

      this._fullscreen.active = true;
      this._applyAnswerHeight();
      this._updateFullscreenButton();
      this._resizeCanvas();
    } catch (e) {
      console.warn('Fullscreen request failed', e);
    }
  }

  async _exitFullscreen() {
    try {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) {
        await exit.call(document);
      }
    } catch (e) {
      console.warn('Fullscreen exit failed', e);
    } finally {
      this._fullscreen.active = false;
      this.container.classList.remove('hb-fullscreen-host');
      if (this._fullscreen.previousHeight != null) {
        this.container.style.height = this._fullscreen.previousHeight;
      }
      this._applyAnswerHeight();
      this._updateFullscreenButton();
      this._resizeCanvas();
    }
  }

  _bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => this._startDrawing(e, 'mouse'));
    this.canvas.addEventListener('mousemove', (e) => this._draw(e, 'mouse'));
    this.canvas.addEventListener('mouseup', (e) => this._stopDrawing(e, 'mouse'));
    this.canvas.addEventListener('mouseleave', (e) => this._stopDrawing(e, 'mouse'));

    this.canvas.addEventListener('touchstart', (e) => this._startDrawing(e, 'touch'), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this._draw(e, 'touch'), { passive: false });
    this.canvas.addEventListener('touchend', (e) => this._stopDrawing(e, 'touch'));
    this.canvas.addEventListener('touchcancel', (e) => this._stopDrawing(e, 'touch'));
    
    this.confirmTextBtn.onclick = () => this._confirmText();

    const onFsChange = () => {
      const active = this._isFullscreenActive();
      this._fullscreen.active = active;
      if (!active) this.container.classList.remove('hb-fullscreen-host');
      if (active) this.container.classList.add('hb-fullscreen-host');
      this._applyAnswerHeight();
      this._updateFullscreenButton();
      this._resizeCanvas();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
  }

  _resizeCanvas() {
    const rect = this.canvasContainer.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    
    const ratio = window.devicePixelRatio || 1;
    if (this.canvas.width !== rect.width * ratio || this.canvas.height !== rect.height * ratio) {
      this.canvas.width = rect.width * ratio;
      this.canvas.height = rect.height * ratio;
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = rect.height + 'px';
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(ratio, ratio);
      this.redraw();
    }
  }

  _getPoint(e, type) {
    const rect = this.canvas.getBoundingClientRect();
    let clientX, clientY;

    if (type === 'touch') {
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      } else {
        return this.lastPoint || { x: 0, y: 0 };
      }
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = clientX - rect.left;
    const y = clientY - rect.top;
    
    this.lastPoint = { x, y };
    return { x, y };
  }

  _startDrawing(e, type) {
    if (this.options.readOnly) return;
    if (this.textInput.contains(e.target)) return;
    
    if (type === 'touch') {
      if (e.touches && e.touches.length > 1) return;
    }

    if (this.textInput.style.display !== 'none') {
       this._confirmText();
    }

    const point = this._getPoint(e, type);

    // === 处理移动工具 ===
    if (this.currentTool === 'select') {
      const hitObj = this._hitTest(point);
      if (hitObj) {
        this.selectedObject = hitObj;
        this.isDragging = true;
        this._movedDuringDrag = false;
        this.dragStartPoint = point;
        this.redraw(); // 重绘以显示选中框
      } else {
        this.selectedObject = null;
        this.isDragging = false;
        this.dragStartPoint = null;
        this._movedDuringDrag = false;

        if (this._isFullscreenActive() && this.container.scrollHeight > this.container.clientHeight) {
          let clientY = type === 'touch' ? (e.touches && e.touches[0] ? e.touches[0].clientY : 0) : e.clientY;
          this._pan.active = true;
          this._pan.startClientY = clientY;
          this._pan.startScrollTop = this.container.scrollTop;
        }

        this.redraw();
      }
      return;
    }

    if (this.currentTool === 'text') {
      this._handleTextToolClick(e, type);
      return;
    }
    
    if (e.cancelable) e.preventDefault();

    this.isDrawing = true;
    
    const isPen = ['pen', 'eraser'].includes(this.currentTool);
    this.currentObject = {
      type: isPen ? 'stroke' : this.currentTool,
      tool: this.currentTool,
      color: this.currentTool === 'eraser' ? '#ffffff' : this.config.color,
      width: this.config.width * (this.currentTool === 'eraser' ? 5 : 1),
      points: isPen ? [point] : [],
      start: point,
      end: point
    };
  }

  _draw(e, type) {
    if (this.currentTool === 'select' && this._pan.active) {
      if (e.cancelable) e.preventDefault();
      let clientY = type === 'touch' ? (e.touches && e.touches[0] ? e.touches[0].clientY : this._pan.startClientY) : e.clientY;
      const dy = clientY - this._pan.startClientY;
      this.container.scrollTop = this._pan.startScrollTop - dy;
      return;
    }

    if ((this.isDrawing || (this.currentTool === 'select' && this.isDragging)) && e.cancelable) {
      e.preventDefault();
    }

    const point = this._getPoint(e, type);

    // === 处理移动 ===
    if (this.currentTool === 'select' && this.isDragging && this.selectedObject) {
      const dx = point.x - this.dragStartPoint.x;
      const dy = point.y - this.dragStartPoint.y;
      
      this._moveObject(this.selectedObject, dx, dy);
      this._movedDuringDrag = true;
      this.dragStartPoint = point; // 更新起始点
      this.redraw();
      return;
    }

    if (!this.isDrawing || !this.currentObject) return;
    
    if (this.currentObject.type === 'stroke') {
      this.currentObject.points.push(point);
      this._drawSegment(this.currentObject.points); 
    } else {
      this.currentObject.end = point;
      this.redraw(); 
      this._drawObject(this.currentObject);
    }
  }

  _stopDrawing(e, type) {
    // === 结束移动 ===
    if (this.currentTool === 'select') {
      const shouldNotify = this.isDragging && this._movedDuringDrag;
      this.isDragging = false;
      this.dragStartPoint = null;
      this._pan.active = false;
      if (shouldNotify) this._notifyChange();
      return;
    }

    if (!this.isDrawing) return;
    
    if (this.currentObject) {
      if (this.currentObject.type === 'stroke' && this.currentObject.points.length < 2) {
        // ignore
      } else {
        this.history.push(this.currentObject);
        this.redraw(); 
        this._notifyChange();
      }
      this.currentObject = null;
    }
    this.isDrawing = false;
  }

  // --- 新增：命中检测 ---
  _hitTest(point) {
    // 倒序遍历，优先选中最上面的
    for (let i = this.history.length - 1; i >= 0; i--) {
      const obj = this.history[i];
      if (this._isPointInObject(point, obj)) {
        return obj;
      }
    }
    return null;
  }

  _isPointInObject(p, obj) {
    const threshold = 10;
    
    if (obj.type === 'stroke') {
      // 简单包围盒检测 + 采样点检测
      // 为了性能，先做包围盒
      // (更精细的检测需要遍历 points)
      for (let pt of obj.points) {
        if (Math.abs(pt.x - p.x) < threshold && Math.abs(pt.y - p.y) < threshold) {
          return true;
        }
      }
      return false;
    } else if (obj.type === 'rect') {
      const minX = Math.min(obj.start.x, obj.end.x);
      const maxX = Math.max(obj.start.x, obj.end.x);
      const minY = Math.min(obj.start.y, obj.end.y);
      const maxY = Math.max(obj.start.y, obj.end.y);
      // 检测是否在边框附近 (如果是填充矩形则是内部，这里是空心)
      // 简单起见，检测内部
      return p.x >= minX - threshold && p.x <= maxX + threshold &&
             p.y >= minY - threshold && p.y <= maxY + threshold;
    } else if (obj.type === 'circle') {
      const r = Math.sqrt(Math.pow(obj.end.x - obj.start.x, 2) + Math.pow(obj.end.y - obj.start.y, 2));
      const dist = Math.sqrt(Math.pow(p.x - obj.start.x, 2) + Math.pow(p.y - obj.start.y, 2));
      return Math.abs(dist - r) < threshold || dist < r; // 选中圆边或内部
    } else if (obj.type === 'line') {
      // 点到线段距离公式
      const { start, end } = obj;
      const length2 = Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2);
      if (length2 === 0) return false;
      const t = ((p.x - start.x) * (end.x - start.x) + (p.y - start.y) * (end.y - start.y)) / length2;
      const tClamped = Math.max(0, Math.min(1, t));
      const projX = start.x + tClamped * (end.x - start.x);
      const projY = start.y + tClamped * (end.y - start.y);
      const dist = Math.sqrt(Math.pow(p.x - projX, 2) + Math.pow(p.y - projY, 2));
      return dist < threshold;
    } else if (obj.type === 'text') {
      this.ctx.font = obj.font;
      const metrics = this.ctx.measureText(obj.text);
      const height = parseInt(obj.font) || 20; // 估算高度
      // text x,y 是左下角 (baseline)
      return p.x >= obj.x && p.x <= obj.x + metrics.width &&
             p.y >= obj.y - height && p.y <= obj.y + 5;
    }
    return false;
  }

  // --- 新增：移动对象 ---
  _moveObject(obj, dx, dy) {
    if (obj.type === 'stroke') {
      obj.points.forEach(p => {
        p.x += dx;
        p.y += dy;
      });
    } else if (['rect', 'circle', 'line'].includes(obj.type)) {
      obj.start.x += dx;
      obj.start.y += dy;
      obj.end.x += dx;
      obj.end.y += dy;
    } else if (obj.type === 'text') {
      obj.x += dx;
      obj.y += dy;
    }
  }

  // --- 新增：绘制选中框 ---
  _drawSelectionBox(obj) {
    if (!obj) return;
    this.ctx.save();
    this.ctx.strokeStyle = '#007bff';
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([5, 5]);
    
    // 计算包围盒
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    if (obj.type === 'stroke') {
      obj.points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
    } else if (['rect', 'line', 'circle'].includes(obj.type)) {
      if (obj.type === 'circle') {
        const r = Math.sqrt(Math.pow(obj.end.x - obj.start.x, 2) + Math.pow(obj.end.y - obj.start.y, 2));
        minX = obj.start.x - r; maxX = obj.start.x + r;
        minY = obj.start.y - r; maxY = obj.start.y + r;
      } else {
        minX = Math.min(obj.start.x, obj.end.x);
        maxX = Math.max(obj.start.x, obj.end.x);
        minY = Math.min(obj.start.y, obj.end.y);
        maxY = Math.max(obj.start.y, obj.end.y);
      }
    } else if (obj.type === 'text') {
      this.ctx.font = obj.font;
      const w = this.ctx.measureText(obj.text).width;
      const h = parseInt(obj.font) || 20;
      minX = obj.x;
      maxX = obj.x + w;
      minY = obj.y - h;
      maxY = obj.y + 5;
    }

    if (minX !== Infinity) {
      const padding = 5;
      this.ctx.strokeRect(minX - padding, minY - padding, (maxX - minX) + padding*2, (maxY - minY) + padding*2);
    }
    
    this.ctx.restore();
  }

  _drawSegment(points) {
    if (points.length < 2) return;
    const p1 = points[points.length - 2];
    const p2 = points[points.length - 1];
    
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = this.currentObject.color;
    this.ctx.lineWidth = this.currentObject.width;
    this.ctx.moveTo(p1.x, p1.y);
    this.ctx.lineTo(p2.x, p2.y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  _handleTextToolClick(e, type) {
    if (e.cancelable) e.preventDefault();
    const point = this._getPoint(e, type);
    
    const cw = this.canvasContainer.offsetWidth;
    const ch = this.canvasContainer.offsetHeight;
    let x = Math.min(Math.max(point.x, 5), cw - 150);
    let y = Math.min(Math.max(point.y, 20), ch - 50);

    this.textInput.style.left = x + 'px';
    this.textInput.style.top = y + 'px';
    this.textInput.style.display = 'block';
    
    this.textArea.value = '';
    this.textArea.style.fontFamily = this.config.font;
    this.textArea.style.color = this.config.color;
    this.textArea.style.fontSize = (this.config.width * 3 + 12) + 'px';
    
    setTimeout(() => this.textArea.focus(), 50);
    
    this.textInput.dataset.x = x;
    this.textInput.dataset.y = y;
  }

  _confirmText() {
    if (this.textInput.style.display === 'none') return;
    const text = this.textArea.value;
    if (text.trim()) {
      this.history.push({
        type: 'text',
        text: text,
        x: parseFloat(this.textInput.dataset.x),
        y: parseFloat(this.textInput.dataset.y) + parseFloat(this.textArea.style.fontSize),
        font: `${this.textArea.style.fontSize} ${this.config.font}`,
        color: this.config.color
      });
      this.redraw();
      this._notifyChange();
    }
    this.textInput.style.display = 'none';
  }

  _notifyChange() {
    if (this.options.onSave) {
      try {
        this.options.onSave(this.getData());
      } catch (err) {
        console.warn('onSave callback failed', err);
      }
    }
  }

  redraw() {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();

    this._drawBackground();
    this.history.forEach(obj => this._drawObject(obj));
    
    // 绘制选中框
    if (this.currentTool === 'select' && this.selectedObject) {
      this._drawSelectionBox(this.selectedObject);
    }
  }

  _drawBackground() {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.strokeStyle = '#e0e0e0';
    this.ctx.lineWidth = 1;
    const w = this.canvasContainer.offsetWidth;
    const h = this.canvasContainer.offsetHeight;

    if (this.config.background === 'grid') {
      const step = this._lineHeight;
      for (let x = 0; x < w; x += step) { this.ctx.moveTo(x, 0); this.ctx.lineTo(x, h); }
      for (let y = 0; y < h; y += step) { this.ctx.moveTo(0, y); this.ctx.lineTo(w, y); }
    } else if (this.config.background === 'line') {
      const step = this._lineHeight;
      for (let y = step; y < h; y += step) { this.ctx.moveTo(0, y); this.ctx.lineTo(w, y); }
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  _drawObject(obj) {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = obj.color;
    this.ctx.lineWidth = obj.width;
    this.ctx.fillStyle = obj.color;

    if (obj.type === 'stroke') {
      if (obj.points.length < 2) return;
      this.ctx.moveTo(obj.points[0].x, obj.points[0].y);
      if (obj.points.length === 2) {
        this.ctx.lineTo(obj.points[1].x, obj.points[1].y);
      } else {
        let i;
        for (i = 1; i < obj.points.length - 2; i++) {
          const xc = (obj.points[i].x + obj.points[i + 1].x) / 2;
          const yc = (obj.points[i].y + obj.points[i + 1].y) / 2;
          this.ctx.quadraticCurveTo(obj.points[i].x, obj.points[i].y, xc, yc);
        }
        this.ctx.quadraticCurveTo(
          obj.points[i].x, obj.points[i].y,
          obj.points[i+1].x, obj.points[i+1].y
        );
      }
      this.ctx.stroke();
    } else if (obj.type === 'line') {
      this.ctx.moveTo(obj.start.x, obj.start.y);
      this.ctx.lineTo(obj.end.x, obj.end.y);
      this.ctx.stroke();
    } else if (obj.type === 'rect') {
      this.ctx.strokeRect(obj.start.x, obj.start.y, obj.end.x - obj.start.x, obj.end.y - obj.start.y);
    } else if (obj.type === 'circle') {
      const r = Math.sqrt(Math.pow(obj.end.x - obj.start.x, 2) + Math.pow(obj.end.y - obj.start.y, 2));
      this.ctx.arc(obj.start.x, obj.start.y, r, 0, Math.PI * 2);
      this.ctx.stroke();
    } else if (obj.type === 'text') {
      this.ctx.font = obj.font;
      this.ctx.fillText(obj.text, obj.x, obj.y);
    }
    this.ctx.restore();
  }

  undo() {
    this.history.pop();
    this.redraw();
    this._notifyChange();
  }

  clear() {
    if (confirm('确定清空当前画板吗？')) {
      this.history = [];
      this.redraw();
      this._notifyChange();
    }
  }

  getData() {
    return {
      history: this.history,
      config: this.config,
      image: this.canvas.toDataURL('image/png')
    };
  }

  loadData(data) {
    if (!data) return;
    if (data.history) this.history = data.history;
    if (data.config) Object.assign(this.config, data.config);
    this.redraw();
  }
}
