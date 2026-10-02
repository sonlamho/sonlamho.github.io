/* Interactive simple linear regression widget.
   Click the chart to add a point, click a point to remove it, drag a point to
   move it. The least-squares line and its statistics are refitted each time.
   The maths lives in stats.js; this file handles drawing and interaction. */
(function () {
  'use strict';

  var Stats = window.Stats;
  var svg = document.getElementById('rg-chart');
  var wrap = document.getElementById('rg-wrap');
  if (!svg || !wrap || !Stats) return;

  /* ---------- Configuration ---------- */

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var X_MAX = 20; // the chart shows 0..X_MAX horizontally
  var Y_MAX = 14; // and 0..Y_MAX vertically
  var TICK = 2;
  var MARGIN = { top: 12, right: 16, bottom: 42, left: 40 };
  var MAX_POINTS = 200;
  var DRAG_THRESHOLD = 4; // pixels of movement before a press counts as a drag
  var DOT_RADIUS = 6;
  var HIT_RADIUS = 14;

  var ANSCOMBE_X = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
  var DATASETS = {
    anscombe1: {
      x: ANSCOMBE_X,
      y: [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68]
    },
    anscombe2: {
      x: ANSCOMBE_X,
      y: [9.14, 8.14, 8.74, 8.77, 9.26, 8.10, 6.13, 3.10, 9.13, 7.26, 4.74]
    },
    anscombe3: {
      x: ANSCOMBE_X,
      y: [7.46, 6.77, 12.74, 7.11, 7.81, 8.84, 6.08, 5.39, 8.15, 6.42, 5.73]
    },
    anscombe4: {
      x: [8, 8, 8, 8, 8, 8, 8, 19, 8, 8, 8],
      y: [6.58, 5.76, 7.71, 8.84, 8.47, 7.04, 5.25, 12.50, 5.56, 7.91, 6.89]
    }
  };

  var DEFAULT_HINT = 'Click the chart to add a point. Click a point to remove it, or drag it to move it.';

  /* ---------- Elements ---------- */

  var tip = document.getElementById('rg-tip');
  var hint = document.getElementById('rg-hint');
  var live = document.getElementById('rg-live');
  var out = {
    equation: document.getElementById('rg-equation'),
    r2: document.getElementById('rg-r2'),
    p: document.getElementById('rg-p'),
    slope: document.getElementById('rg-slope'),
    intercept: document.getElementById('rg-intercept'),
    r: document.getElementById('rg-r'),
    n: document.getElementById('rg-n'),
    slopeSE: document.getElementById('rg-slope-se'),
    residualSE: document.getElementById('rg-residual-se'),
    interpretation: document.getElementById('rg-interpretation')
  };
  var tableBody = document.getElementById('rg-table-body');
  var addForm = document.getElementById('rg-add-form');
  var addX = document.getElementById('rg-add-x');
  var addY = document.getElementById('rg-add-y');
  var undoButton = document.getElementById('rg-undo');
  var clearButton = document.getElementById('rg-clear');
  var randomButton = document.getElementById('rg-random');
  var residualsToggle = document.getElementById('rg-residuals');
  var residualsKey = document.getElementById('rg-residuals-key');

  function el(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (var key in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, key)) node.setAttribute(key, attrs[key]);
      }
    }
    return node;
  }

  var defs = el('defs');
  var clip = el('clipPath', { id: 'rg-clip' });
  var clipRect = el('rect');
  clip.appendChild(clipRect);
  defs.appendChild(clip);

  var gridLayer = el('g', { 'class': 'rg-grid', 'aria-hidden': 'true' });
  var axisLayer = el('g', { 'class': 'rg-axes', 'aria-hidden': 'true' });
  var plotRect = el('rect', { 'class': 'rg-plot' });
  var clipped = el('g', { 'clip-path': 'url(#rg-clip)' });
  var residualLayer = el('g', { 'class': 'rg-residuals', 'aria-hidden': 'true' });
  var fitLine = el('line', { 'class': 'rg-fit', 'aria-hidden': 'true' });
  clipped.appendChild(residualLayer);
  clipped.appendChild(fitLine);
  var ghost = el('circle', { 'class': 'rg-ghost', r: DOT_RADIUS, 'aria-hidden': 'true' });
  var pointLayer = el('g', { 'class': 'rg-points' });

  [defs, gridLayer, axisLayer, plotRect, clipped, ghost, pointLayer].forEach(function (node) {
    svg.appendChild(node);
  });
  ghost.style.display = 'none';
  fitLine.style.display = 'none';

  /* ---------- State ---------- */

  var points = []; // { id, x, y }
  var nextId = 1;
  var undoStack = [];
  var showResiduals = false;
  var fit = Stats.linearRegression(points);
  var size = { width: 0, height: 0, plotWidth: 0, plotHeight: 0 };
  var press = null; // the pointer interaction in progress, if any
  var lastNudge = { id: null, time: 0 };
  var pointNodes = new Map();
  var tipPointId = null;

  /* ---------- Helpers ---------- */

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  /* Fixed-decimal number with a true minus sign; em dash when undefined. */
  function fmt(value, decimals) {
    if (typeof value !== 'number' || !isFinite(value)) return '—';
    var text = value.toFixed(decimals);
    if (Number(text) === 0) text = (0).toFixed(decimals);
    return text.replace('-', '−');
  }

  function fmtP(p) {
    if (typeof p !== 'number' || p !== p) return '—';
    if (p < 0.0001) return '< 0.0001';
    return p.toFixed(4);
  }

  function fmtCoord(value) {
    return fmt(value, 2);
  }

  function equationText() {
    if (fit.status !== 'ok') return '—';
    var sign = fit.slope < 0 && Number(fit.slope.toFixed(2)) !== 0 ? '−' : '+';
    return 'ŷ = ' + fmt(fit.intercept, 2) + ' ' + sign + ' ' + fmt(Math.abs(fit.slope), 2) + 'x';
  }

  function px(x) {
    return MARGIN.left + (x / X_MAX) * size.plotWidth;
  }

  function py(y) {
    return MARGIN.top + (1 - y / Y_MAX) * size.plotHeight;
  }

  /* Convert a pointer position to data coordinates. */
  function toData(event) {
    var rect = svg.getBoundingClientRect();
    var sx = event.clientX - rect.left;
    var sy = event.clientY - rect.top;
    var x = ((sx - MARGIN.left) / size.plotWidth) * X_MAX;
    var y = (1 - (sy - MARGIN.top) / size.plotHeight) * Y_MAX;
    return {
      x: x,
      y: y,
      inside: x >= 0 && x <= X_MAX && y >= 0 && y <= Y_MAX
    };
  }

  function findPoint(id) {
    for (var i = 0; i < points.length; i++) {
      if (points[i].id === id) return points[i];
    }
    return null;
  }

  function indexOfPoint(id) {
    for (var i = 0; i < points.length; i++) {
      if (points[i].id === id) return i;
    }
    return -1;
  }

  function snapshot() {
    return points.map(function (p) {
      return { id: p.id, x: p.x, y: p.y };
    });
  }

  function pushUndo(state) {
    undoStack.push(state || snapshot());
    if (undoStack.length > 100) undoStack.shift();
    /* Any other change ends a run of arrow-key nudges, so the next nudge
       gets an undo step of its own. */
    lastNudge = { id: null, time: 0 };
  }

  /* ---------- Drawing ---------- */

  function layout() {
    var width = Math.floor(wrap.clientWidth);
    if (width <= 0) return false;
    var height = Math.round(clamp(width * 0.7, 280, 480));
    size.width = width;
    size.height = height;
    size.plotWidth = width - MARGIN.left - MARGIN.right;
    size.plotHeight = height - MARGIN.top - MARGIN.bottom;

    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

    [plotRect, clipRect].forEach(function (rect) {
      rect.setAttribute('x', MARGIN.left);
      rect.setAttribute('y', MARGIN.top);
      rect.setAttribute('width', size.plotWidth);
      rect.setAttribute('height', size.plotHeight);
    });

    gridLayer.textContent = '';
    axisLayer.textContent = '';
    var left = MARGIN.left;
    var right = MARGIN.left + size.plotWidth;
    var top = MARGIN.top;
    var bottom = MARGIN.top + size.plotHeight;
    var value;
    var label;

    for (value = 0; value <= X_MAX; value += TICK) {
      var gx = Math.round(px(value)) + 0.5;
      if (value > 0) gridLayer.appendChild(el('line', { x1: gx, x2: gx, y1: top, y2: bottom }));
      label = el('text', { x: gx, y: bottom + 18, 'text-anchor': 'middle' });
      label.textContent = String(value);
      axisLayer.appendChild(label);
    }
    for (value = 0; value <= Y_MAX; value += TICK) {
      var gy = Math.round(py(value)) + 0.5;
      if (value > 0) gridLayer.appendChild(el('line', { x1: left, x2: right, y1: gy, y2: gy }));
      label = el('text', { x: left - 9, y: gy + 4, 'text-anchor': 'end' });
      label.textContent = String(value);
      axisLayer.appendChild(label);
    }

    var axisX = Math.round(left) + 0.5;
    var axisY = Math.round(bottom) + 0.5;
    axisLayer.appendChild(el('line', { x1: axisX, x2: axisX, y1: top, y2: axisY }));
    axisLayer.appendChild(el('line', { x1: axisX, x2: right, y1: axisY, y2: axisY }));

    var xTitle = el('text', { 'class': 'rg-axis-title', x: left + size.plotWidth / 2, y: bottom + 37, 'text-anchor': 'middle' });
    xTitle.textContent = 'x';
    axisLayer.appendChild(xTitle);
    var yTitle = el('text', { 'class': 'rg-axis-title', x: 9, y: top + size.plotHeight / 2 + 4, 'text-anchor': 'middle' });
    yTitle.textContent = 'y';
    axisLayer.appendChild(yTitle);
    return true;
  }

  function pointLabel(p) {
    return 'Point at x ' + fmtCoord(p.x) + ', y ' + fmtCoord(p.y) +
      '. Press Delete to remove, arrow keys to move.';
  }

  function renderPoints() {
    var seen = new Set();
    points.forEach(function (p) {
      seen.add(p.id);
      var node = pointNodes.get(p.id);
      if (!node) {
        node = el('g', { 'class': 'rg-point', tabindex: '0', role: 'button', 'data-id': p.id });
        node.appendChild(el('circle', { 'class': 'rg-hit', r: HIT_RADIUS }));
        node.appendChild(el('circle', { 'class': 'rg-dot', r: DOT_RADIUS }));
        pointLayer.appendChild(node);
        pointNodes.set(p.id, node);
      }
      node.setAttribute('transform', 'translate(' + px(p.x).toFixed(2) + ',' + py(p.y).toFixed(2) + ')');
      node.setAttribute('aria-label', pointLabel(p));
    });
    pointNodes.forEach(function (node, id) {
      if (!seen.has(id)) {
        node.remove();
        pointNodes.delete(id);
      }
    });
    /* Keep the elements in the same order as the data (and the table), so
       that tabbing through the points follows that order after an undo. */
    points.forEach(function (p, index) {
      var node = pointNodes.get(p.id);
      if (pointLayer.children[index] !== node) {
        pointLayer.insertBefore(node, pointLayer.children[index] || null);
      }
    });
  }

  function renderFit() {
    fit = Stats.linearRegression(points);
    residualLayer.textContent = '';

    if (fit.status !== 'ok') {
      fitLine.style.display = 'none';
      return;
    }
    fitLine.style.display = '';
    fitLine.setAttribute('x1', px(0));
    fitLine.setAttribute('y1', py(fit.intercept));
    fitLine.setAttribute('x2', px(X_MAX));
    fitLine.setAttribute('y2', py(fit.intercept + fit.slope * X_MAX));

    if (showResiduals) {
      points.forEach(function (p) {
        var x = px(p.x);
        residualLayer.appendChild(el('line', {
          x1: x,
          x2: x,
          y1: py(p.y),
          y2: py(fit.intercept + fit.slope * p.x)
        }));
      });
    }
  }

  function interpretationText() {
    if (fit.status === 'empty') {
      return 'Click anywhere on the chart to add your first point.';
    }
    if (fit.status === 'single') {
      return 'One point does not determine a line. Add at least one more.';
    }
    if (fit.status === 'vertical') {
      return 'All points share the same x-value, so the slope of a least-squares line is undefined. Add a point with a different x.';
    }
    if (fit.r2 !== fit.r2) {
      return 'All points share the same y-value. The fitted line is horizontal, and R² is undefined because there is no variation in y to explain.';
    }
    if (fit.df <= 0) {
      return 'Two points always lie exactly on a line, so R² = 1 and no degrees of freedom are left to test the slope. Add a third point to get a p-value.';
    }
    /* One decimal, so the percentage always agrees with the three-decimal R²
       next to it (a whole number would turn R² = 0.996 into "100%"). */
    var first = 'The line explains ' + fmt(fit.r2 * 100, 1) + '% of the variation in y (R² = ' + fmt(fit.r2, 3) + '). ';
    var pText = fit.p < 0.0001 ? 'p < 0.0001' : 'p = ' + fit.p.toFixed(4);
    if (fit.p < 0.05) {
      return first + 'With ' + pText + ', the slope is statistically significant at the 5% level.';
    }
    return first + 'With ' + pText + ', there is not enough evidence at the 5% level that the slope differs from zero.';
  }

  function renderStats() {
    var ok = fit.status === 'ok';
    out.equation.textContent = equationText();
    out.n.textContent = String(fit.n);
    out.slope.textContent = ok ? fmt(fit.slope, 3) : '—';
    out.intercept.textContent = ok ? fmt(fit.intercept, 3) : '—';
    out.r.textContent = ok ? fmt(fit.r, 3) : '—';
    out.r2.textContent = ok ? fmt(fit.r2, 3) : '—';
    out.p.textContent = ok ? fmtP(fit.p) : '—';
    out.slopeSE.textContent = ok ? fmt(fit.slopeSE, 3) : '—';
    out.residualSE.textContent = ok ? fmt(fit.residualSE, 3) : '—';
    out.interpretation.textContent = interpretationText();
  }

  function renderTable() {
    tableBody.textContent = '';
    if (points.length === 0) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 6;
      emptyCell.className = 'empty';
      emptyCell.textContent = 'No points yet.';
      emptyRow.appendChild(emptyCell);
      tableBody.appendChild(emptyRow);
      return;
    }
    var ok = fit.status === 'ok';
    points.forEach(function (p, index) {
      var fitted = ok ? fit.intercept + fit.slope * p.x : NaN;
      var cells = [
        String(index + 1),
        fmtCoord(p.x),
        fmtCoord(p.y),
        fmt(fitted, 2),
        fmt(p.y - fitted, 2)
      ];
      var row = document.createElement('tr');
      cells.forEach(function (text) {
        var cell = document.createElement('td');
        cell.textContent = text;
        row.appendChild(cell);
      });
      var action = document.createElement('td');
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'row-remove';
      remove.setAttribute('data-id', p.id);
      remove.setAttribute('aria-label', 'Remove point ' + (index + 1));
      remove.textContent = '×';
      action.appendChild(remove);
      row.appendChild(action);
      tableBody.appendChild(row);
    });
  }

  function updateControls() {
    undoButton.disabled = undoStack.length === 0;
    clearButton.disabled = points.length === 0;
    residualsKey.hidden = !showResiduals;
  }

  function announce() {
    var text = fit.n + (fit.n === 1 ? ' point. ' : ' points. ');
    if (fit.status === 'ok') {
      text += equationText() + '. R squared ' + fmt(fit.r2, 3) + ', p-value ' + fmtP(fit.p) + '.';
    }
    live.textContent = text;
  }

  /* Redraw everything from the current state. `committed` is false while a
     point is being dragged, so screen readers are not flooded with updates. */
  function render(committed) {
    renderPoints();
    renderFit();
    renderStats();
    renderTable();
    updateControls();
    if (tipPointId !== null) showPointTip(tipPointId, press && press.moved ? 'drag' : tip.getAttribute('data-mode'));
    if (committed) announce();
  }

  /* ---------- Tooltip ---------- */

  function showPointTip(id, mode) {
    var p = findPoint(id);
    if (!p) {
      hideTip();
      return;
    }
    tipPointId = id;
    tip.setAttribute('data-mode', mode || 'hover');
    tip.textContent = '';
    var strong = document.createElement('strong');
    strong.textContent = '(' + fmtCoord(p.x) + ', ' + fmtCoord(p.y) + ')';
    tip.appendChild(strong);
    if (fit.status === 'ok') {
      var residual = p.y - (fit.intercept + fit.slope * p.x);
      var line = document.createElement('span');
      line.textContent = 'Residual ' + (residual >= 0 && Number(residual.toFixed(2)) !== 0 ? '+' : '') + fmt(residual, 2);
      tip.appendChild(line);
    }
    if (mode !== 'drag') {
      var help = document.createElement('span');
      help.style.display = 'block';
      help.textContent = mode === 'focus' ? 'Delete removes · arrows move' : 'Click to remove · drag to move';
      tip.appendChild(help);
    }
    tip.hidden = false;

    var x = px(p.x);
    var y = py(p.y);
    var tipWidth = tip.offsetWidth;
    var tipHeight = tip.offsetHeight;
    var left = x + 14;
    if (left + tipWidth > size.width) left = x - tipWidth - 14;
    left = clamp(left, 0, Math.max(0, size.width - tipWidth));
    var top = y - tipHeight - 12;
    if (top < 0) top = y + 16;
    tip.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';

    pointNodes.forEach(function (node, nodeId) {
      node.classList.toggle('is-active', nodeId === id);
    });
  }

  function hideTip() {
    tipPointId = null;
    tip.hidden = true;
    pointNodes.forEach(function (node) {
      node.classList.remove('is-active');
    });
  }

  function hideGhost() {
    ghost.style.display = 'none';
    hint.textContent = DEFAULT_HINT;
  }

  /* ---------- Changes to the data ---------- */

  function addPoint(x, y) {
    if (points.length >= MAX_POINTS) {
      hint.textContent = 'This chart holds at most ' + MAX_POINTS + ' points. Remove one to add another.';
      return null;
    }
    pushUndo();
    var point = { id: nextId++, x: round2(clamp(x, 0, X_MAX)), y: round2(clamp(y, 0, Y_MAX)) };
    points.push(point);
    render(true);
    return point;
  }

  function removePoint(id) {
    var index = indexOfPoint(id);
    if (index < 0) return;
    pushUndo();
    points.splice(index, 1);
    if (tipPointId === id) hideTip();
    render(true);
  }

  function replaceAll(list) {
    pushUndo();
    points = list.map(function (item) {
      return { id: nextId++, x: round2(clamp(item.x, 0, X_MAX)), y: round2(clamp(item.y, 0, Y_MAX)) };
    });
    hideTip();
    render(true);
  }

  function loadDataset(name) {
    var data = DATASETS[name];
    if (!data) return;
    replaceAll(data.x.map(function (x, i) {
      return { x: x, y: data.y[i] };
    }));
  }

  /* Standard normal random number (Box–Muller). */
  function randomNormal() {
    var u = 1 - Math.random();
    var v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function randomSample() {
    var slope = -0.6 + 1.2 * Math.random();
    var noise = 0.4 + 2.2 * Math.random();
    var list = [];
    for (var i = 0; i < 12; i++) {
      var x = 1 + 18 * Math.random();
      var y = Y_MAX / 2 + slope * (x - X_MAX / 2) + noise * randomNormal();
      list.push({ x: x, y: clamp(y, 0.3, Y_MAX - 0.3) });
    }
    replaceAll(list);
  }

  function undo() {
    if (undoStack.length === 0) return;
    points = undoStack.pop();
    /* The step a run of nudges was sharing has just been used up. */
    lastNudge = { id: null, time: 0 };
    hideTip();
    render(true);
  }

  /* ---------- Pointer interaction ---------- */

  function pointIdFromTarget(target) {
    var node = target && target.closest ? target.closest('.rg-point') : null;
    return node ? Number(node.getAttribute('data-id')) : null;
  }

  svg.addEventListener('pointerdown', function (event) {
    if (press) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    var id = pointIdFromTarget(event.target);
    if (id !== null) {
      press = {
        type: 'point',
        id: id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        before: snapshot()
      };
      event.preventDefault();
    } else if (toData(event).inside) {
      press = {
        type: 'plot',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY
      };
    }
    if (!press) return;
    /* Capture both kinds of press. Without it, a mouse button released
       outside the chart never reports back, the press is never cleared, and
       the next click on the chart is swallowed. */
    try {
      svg.setPointerCapture(event.pointerId);
    } catch (e) {
      /* without capture, the press still works while it stays inside the chart */
    }
  });

  svg.addEventListener('pointermove', function (event) {
    if (press && event.pointerId !== press.pointerId) return;

    if (press && press.type === 'point') {
      var dx = event.clientX - press.startX;
      var dy = event.clientY - press.startY;
      if (!press.moved && dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
        press.moved = true;
        svg.classList.add('is-dragging');
        ghost.style.display = 'none';
      }
      if (press.moved) {
        var point = findPoint(press.id);
        if (point) {
          var position = toData(event);
          point.x = round2(clamp(position.x, 0, X_MAX));
          point.y = round2(clamp(position.y, 0, Y_MAX));
          tipPointId = point.id;
          render(false);
        }
      }
      return;
    }

    if (event.pointerType !== 'mouse') return;

    var hoveredId = pointIdFromTarget(event.target);
    if (hoveredId !== null) {
      ghost.style.display = 'none';
      hint.textContent = DEFAULT_HINT;
      if (tipPointId !== hoveredId || tip.getAttribute('data-mode') !== 'hover') {
        showPointTip(hoveredId, 'hover');
      }
      return;
    }
    if (tipPointId !== null && tip.getAttribute('data-mode') !== 'focus') hideTip();

    var data = toData(event);
    if (data.inside) {
      var x = round2(data.x);
      var y = round2(data.y);
      ghost.setAttribute('cx', px(x));
      ghost.setAttribute('cy', py(y));
      ghost.style.display = '';
      hint.textContent = 'Click to add a point at (' + fmtCoord(x) + ', ' + fmtCoord(y) + ').';
    } else {
      hideGhost();
    }
  });

  function endPress(event, cancelled) {
    if (!press || event.pointerId !== press.pointerId) return;
    var finished = press;
    press = null;
    svg.classList.remove('is-dragging');
    try {
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    } catch (e) {
      /* nothing to release */
    }

    if (finished.type === 'point') {
      if (finished.moved) {
        if (cancelled) {
          points = finished.before;
          hideTip();
          render(true);
        } else {
          pushUndo(finished.before);
          if (event.pointerType !== 'mouse') hideTip();
          render(true);
          if (tipPointId !== null) showPointTip(tipPointId, 'hover');
        }
      } else if (!cancelled) {
        removePoint(finished.id);
      }
      return;
    }

    if (finished.type === 'plot' && !cancelled) {
      var dx = event.clientX - finished.startX;
      var dy = event.clientY - finished.startY;
      var position = toData(event);
      if (dx * dx + dy * dy <= 36 && position.inside) {
        addPoint(position.x, position.y);
        ghost.style.display = 'none';
      }
    }
  }

  svg.addEventListener('pointerup', function (event) {
    endPress(event, false);
  });
  svg.addEventListener('pointercancel', function (event) {
    endPress(event, true);
  });
  svg.addEventListener('pointerleave', function (event) {
    if (press) return;
    if (event.pointerType === 'mouse') {
      hideGhost();
      if (tip.getAttribute('data-mode') !== 'focus') hideTip();
    }
  });

  /* A finger that lands on a point is about to drag it, so the page must not
     scroll. CSS touch-action covers this in most browsers, but some ignore it
     on elements inside an SVG, hence this explicit fallback. */
  svg.addEventListener('touchstart', function (event) {
    if (pointIdFromTarget(event.target) !== null && event.cancelable) event.preventDefault();
  }, { passive: false });

  /* The browser's own drag-and-drop gets in the way here. */
  svg.addEventListener('dragstart', function (event) {
    event.preventDefault();
  });

  /* ---------- Keyboard interaction ---------- */

  /* Focus listeners go on the HTML wrapper: browsers treat an SVG element
     that listens for focus events as a tab stop of its own. */
  wrap.addEventListener('focusin', function (event) {
    var id = pointIdFromTarget(event.target);
    if (id !== null && event.target.matches(':focus-visible')) showPointTip(id, 'focus');
  });

  wrap.addEventListener('focusout', function () {
    if (tip.getAttribute('data-mode') === 'focus') hideTip();
  });

  svg.addEventListener('keydown', function (event) {
    var id = pointIdFromTarget(event.target);
    if (id === null) return;
    var key = event.key;

    if (key === 'Delete' || key === 'Backspace' || key === 'Enter' || key === ' ') {
      event.preventDefault();
      var index = indexOfPoint(id);
      removePoint(id);
      var neighbour = points[Math.min(index, points.length - 1)];
      if (neighbour) {
        pointNodes.get(neighbour.id).focus();
      } else {
        addX.focus();
      }
      return;
    }

    var step = event.shiftKey ? 1 : 0.1;
    var dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
    var dy = key === 'ArrowDown' ? -step : key === 'ArrowUp' ? step : 0;
    if (dx === 0 && dy === 0) return;
    event.preventDefault();

    var point = findPoint(id);
    if (!point) return;
    var x = round2(clamp(point.x + dx, 0, X_MAX));
    var y = round2(clamp(point.y + dy, 0, Y_MAX));
    /* Already against the edge of the chart: nothing to move or to undo. */
    if (x === point.x && y === point.y) return;
    var now = Date.now();
    if (lastNudge.id !== id || now - lastNudge.time > 1500) pushUndo();
    lastNudge = { id: id, time: now };
    point.x = x;
    point.y = y;
    tipPointId = id;
    tip.setAttribute('data-mode', 'focus');
    render(true);
  });

  /* ---------- Controls ---------- */

  Array.prototype.forEach.call(document.querySelectorAll('[data-dataset]'), function (button) {
    button.addEventListener('click', function () {
      loadDataset(button.getAttribute('data-dataset'));
    });
  });

  randomButton.addEventListener('click', randomSample);
  undoButton.addEventListener('click', undo);
  clearButton.addEventListener('click', function () {
    if (points.length > 0) replaceAll([]);
  });

  residualsToggle.addEventListener('change', function () {
    showResiduals = residualsToggle.checked;
    render(false);
  });

  addForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var x = Number(addX.value);
    var y = Number(addY.value);
    if (addX.value === '' || addY.value === '' || !isFinite(x) || !isFinite(y)) return;
    if (addPoint(x, y)) {
      addForm.reset();
      addX.focus();
    }
  });

  tableBody.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('.row-remove') : null;
    if (!button) return;
    var id = Number(button.getAttribute('data-id'));
    var index = indexOfPoint(id);
    removePoint(id);
    var buttons = tableBody.querySelectorAll('.row-remove');
    if (buttons.length > 0) {
      buttons[Math.min(index, buttons.length - 1)].focus();
    } else {
      addX.focus();
    }
  });

  /* ---------- Start ---------- */

  function resize() {
    if (layout()) render(false);
  }

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(resize).observe(wrap);
  } else {
    window.addEventListener('resize', resize);
  }

  showResiduals = residualsToggle.checked;
  hint.textContent = DEFAULT_HINT;
  layout();
  var start = DATASETS.anscombe1;
  points = start.x.map(function (x, i) {
    return { id: nextId++, x: x, y: start.y[i] };
  });
  render(false);
})();
