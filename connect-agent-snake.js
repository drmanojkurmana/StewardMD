/* connect-agent-snake.js
   Small snake game widget. Buildless ES5 IIFE.
   window.SMD_SNAKE = { mount: function(container, opts), tick: function(state, dir) }
*/
(function () {
  'use strict';
  var DIRS = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0]
  };
  function isReverse(a, b) {
    if (!a || !b) return false;
    return DIRS[a][0] === -DIRS[b][0] && DIRS[a][1] === -DIRS[b][1];
  }
  function cloneSnake(snake) {
    var out = [];
    for (var i = 0; i < snake.length; i++) out.push([snake[i][0], snake[i][1]]);
    return out;
  }
  function occupied(snake, x, y) {
    for (var i = 0; i < snake.length; i++) {
      if (snake[i][0] === x && snake[i][1] === y) return true;
    }
    return false;
  }
  function placeFood(cols, rows, snake, random) {
    var free = [];
    for (var x = 0; x < cols; x++) {
      for (var y = 0; y < rows; y++) {
        if (!occupied(snake, x, y)) free.push([x, y]);
      }
    }
    if (free.length === 0) return [0, 0];
    var idx = Math.floor(random() * free.length);
    if (idx >= free.length) idx = free.length - 1;
    return free[idx];
  }
  function tick(state, dir) {
    if (state.dead) {
      return {
        cols: state.cols, rows: state.rows,
        snake: cloneSnake(state.snake),
        food: [state.food[0], state.food[1]],
        dir: state.dir, score: state.score, dead: true
      };
    }
    var nextDir = state.dir;
    if (dir && DIRS[dir] && !isReverse(dir, state.dir)) nextDir = dir;
    var delta = DIRS[nextDir];
    var head = state.snake[0];
    var nx = head[0] + delta[0];
    var ny = head[1] + delta[1];
    var out = {
      cols: state.cols,
      rows: state.rows,
      dir: nextDir,
      score: state.score,
      food: [state.food[0], state.food[1]],
      snake: cloneSnake(state.snake),
      dead: false,
      random: state.random
    };
    if (nx < 0 || nx >= state.cols || ny < 0 || ny >= state.rows) {
      out.dead = true;
      return out;
    }
    var ate = nx === state.food[0] && ny === state.food[1];
    var body = ate ? state.snake : state.snake.slice(0, state.snake.length - 1);
    if (occupied(body, nx, ny)) {
      out.dead = true;
      return out;
    }
    var newSnake = [[nx, ny]].concat(cloneSnake(body));
    out.snake = newSnake;
    if (ate) {
      out.score = state.score + 1;
      out.food = placeFood(state.cols, state.rows, newSnake, state.random || Math.random);
    }
    return out;
  }
  function initState(cols, rows) {
    var midX = Math.floor(cols / 2);
    var midY = Math.floor(rows / 2);
    var snake = [[midX, midY], [midX - 1, midY], [midX - 2, midY]];
    return {
      cols: cols, rows: rows,
      snake: snake,
      food: placeFood(cols, rows, snake, Math.random),
      dir: 'right',
      score: 0,
      dead: false
    };
  }
  var BG = '#F4F1EA', SNAKE = '#0E7C66', FOOD = '#FF9500', TEXT = '#14202B';
  var GRID = 14, TICK_MS = Math.round(1000 / 7);
  function mount(container, opts) {
    opts = opts || {};
    var random = opts.random || Math.random;
    if (container.__smdSnake) container.__smdSnake.stop();
    container.innerHTML = '';
    var size = Math.min(container.clientWidth || 320, 320);
    var dpr = window.devicePixelRatio || 1;
    var canvas = document.createElement('canvas');
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);
    var controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.justifyContent = 'center';
    controls.style.gap = '6px';
    controls.style.marginTop = '8px';
    ['left', 'up', 'down', 'right'].forEach(function (key) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = key.charAt(0).toUpperCase();
      b.setAttribute('aria-label', key);
      b.addEventListener('click', function () { requestDir(key); });
      controls.appendChild(b);
    });
    container.appendChild(controls);
    var ctx = canvas.getContext('2d');
    var cell = size / GRID;
    var state = initState(GRID, GRID);
    state.random = random;
    var started = false;
    var timer = null;
    var touchX = 0, touchY = 0;
    function requestDir(d) {
      if (!started) { started = true; startTimer(); }
      if (state.dead) { restart(); return; }
      state.dir = (DIRS[d] && !isReverse(d, state.dir)) ? d : state.dir;
      draw();
    }
    function restart() {
      state = initState(GRID, GRID);
      state.random = random;
      started = true;
      draw();
    }
    function tickOnce() {
      state = tick(state, null);
      draw();
    }
    function draw() {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = FOOD;
      ctx.fillRect(state.food[0] * cell, state.food[1] * cell, cell, cell);
      ctx.fillStyle = SNAKE;
      for (var i = 0; i < state.snake.length; i++) {
        ctx.fillRect(state.snake[i][0] * cell, state.snake[i][1] * cell, cell, cell);
      }
      ctx.fillStyle = TEXT;
      ctx.font = '14px sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText('Score: ' + state.score, 6, 4);
      if (!started) {
        ctx.textAlign = 'center';
        ctx.fillText('Tap to play', size / 2, size / 2);
        ctx.textAlign = 'left';
      } else if (state.dead) {
        ctx.textAlign = 'center';
        ctx.fillText('Game over, tap to restart', size / 2, size / 2);
        ctx.textAlign = 'left';
      }
      ctx.restore();
    }
    function startTimer() {
      stopTimer();
      timer = setInterval(tickOnce, TICK_MS);
    }
    function stopTimer() {
      if (timer) { clearInterval(timer); timer = null; }
    }
    function onCanvasTap() {
      if (!started) { started = true; startTimer(); draw(); return; }
      if (state.dead) { restart(); startTimer(); }
    }
    function onTouchStart(e) {
      var t = e.changedTouches[0];
      touchX = t.clientX; touchY = t.clientY;
    }
    function onTouchEnd(e) {
      var t = e.changedTouches[0];
      var dx = t.clientX - touchX, dy = t.clientY - touchY;
      if (Math.abs(dx) < 20 && Math.abs(dy) < 20) { onCanvasTap(); return; }
      if (Math.abs(dx) > Math.abs(dy)) requestDir(dx > 0 ? 'right' : 'left');
      else requestDir(dy > 0 ? 'down' : 'up');
    }
    function onVisibility() {
      if (document.hidden) stopTimer();
      else if (started && !state.dead) startTimer();
    }
    canvas.addEventListener('click', onCanvasTap);
    canvas.addEventListener('touchstart', onTouchStart);
    canvas.addEventListener('touchend', onTouchEnd);
    document.addEventListener('visibilitychange', onVisibility);
    draw();
    var handle = {
      stop: function () {
        stopTimer();
        canvas.removeEventListener('click', onCanvasTap);
        canvas.removeEventListener('touchstart', onTouchStart);
        canvas.removeEventListener('touchend', onTouchEnd);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
    container.__smdSnake = handle;
    return handle;
  }
  window.SMD_SNAKE = { mount: mount, tick: tick };
})();
