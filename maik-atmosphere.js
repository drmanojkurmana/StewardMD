/* MaiK atmospheric backgrounds. Presentation only; never reads prompt or answer text.
 * Aurora shader / Letter Glitch behavior adapted from React Bits (David Haz).
 * See licenses/react-bits.txt. No React, network calls, or runtime dependencies. */
(function () {
  'use strict';
  var VERT = '#version 300 es\nin vec2 position;void main(){gl_Position=vec4(position,0.,1.);}';
  var FRAG = "#version 300 es\nprecision highp float;\n\nuniform float uTime;\nuniform float uAmplitude;\nuniform vec3 uColorStops[3];\nuniform vec2 uResolution;\nuniform float uBlend;\nuniform float uLightMode;\n\nout vec4 fragColor;\n\nvec3 permute(vec3 x) {\n  return mod(((x * 34.0) + 1.0) * x, 289.0);\n}\n\nfloat snoise(vec2 v){\n  const vec4 C = vec4(\n      0.211324865405187, 0.366025403784439,\n      -0.577350269189626, 0.024390243902439\n  );\n  vec2 i  = floor(v + dot(v, C.yy));\n  vec2 x0 = v - i + dot(i, C.xx);\n  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);\n  vec4 x12 = x0.xyxy + C.xxzz;\n  x12.xy -= i1;\n  i = mod(i, 289.0);\n\n  vec3 p = permute(\n      permute(i.y + vec3(0.0, i1.y, 1.0))\n    + i.x + vec3(0.0, i1.x, 1.0)\n  );\n\n  vec3 m = max(\n      0.5 - vec3(\n          dot(x0, x0),\n          dot(x12.xy, x12.xy),\n          dot(x12.zw, x12.zw)\n      ), \n      0.0\n  );\n  m = m * m;\n  m = m * m;\n\n  vec3 x = 2.0 * fract(p * C.www) - 1.0;\n  vec3 h = abs(x) - 0.5;\n  vec3 ox = floor(x + 0.5);\n  vec3 a0 = x - ox;\n  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);\n\n  vec3 g;\n  g.x  = a0.x  * x0.x  + h.x  * x0.y;\n  g.yz = a0.yz * x12.xz + h.yz * x12.yw;\n  return 130.0 * dot(m, g);\n}\n\nstruct ColorStop {\n  vec3 color;\n  float position;\n};\n\n#define COLOR_RAMP(colors, factor, finalColor) {                int index = 0;                                              for (int i = 0; i < 2; i++) {                                    ColorStop currentColor = colors[i];                         bool isInBetween = currentColor.position <= factor;         index = int(mix(float(index), float(i), float(isInBetween)));   }                                                           ColorStop currentColor = colors[index];                     ColorStop nextColor = colors[index + 1];                    float range = nextColor.position - currentColor.position;   float lerpFactor = (factor - currentColor.position) / range;   finalColor = mix(currentColor.color, nextColor.color, lerpFactor); }\n\nvoid main() {\n  vec2 uv = gl_FragCoord.xy / uResolution;\n  \n  ColorStop colors[3];\n  colors[0] = ColorStop(uColorStops[0], 0.0);\n  colors[1] = ColorStop(uColorStops[1], 0.5);\n  colors[2] = ColorStop(uColorStops[2], 1.0);\n  \n  vec3 rampColor;\n  COLOR_RAMP(colors, uv.x, rampColor);\n  \n  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.12, uTime * 0.28)) * 0.55 * uAmplitude;\n  height = exp(height);\n  height = (uv.y * 2.0 - height + 0.22);\n  float intensity = 0.65 * height;\n  \n  float midPoint = 0.20;\n  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);\n  \n  vec3 auroraColor = intensity * rampColor;\n  \n  if (uLightMode > 0.5) {\n    float energy = clamp(max(intensity, 0.0), 0.0, 1.0);\n    float coverage = clamp(auroraAlpha * (0.65 + 0.35 * energy), 0.0, 0.95);\n    vec3 chroma = pow(clamp(rampColor, 0.0, 1.0), vec3(0.92));\n    fragColor = vec4(chroma * coverage, coverage * 0.88);\n  } else {\n    fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);\n  }\n}\n";

  var STORAGE_KEY = 'smd_maik_atmo_cfg';

  var DEFAULT_CONFIG = {
    light: {
      color1: '#b4510a',
      color2: '#035524',
      color3: '#060351',
      blend: 0.51,
      speed: 1.6
    },
    dark: {
      color1: '#FF671F',
      color2: '#046A38',
      color3: '#06038D',
      blend: 0.49,
      speed: 1.2
    }
  };

  var PRESETS = [
    { id: 'tiranga', name: 'Tiranga Fusion', color1: '#b4510a', color2: '#035524', color3: '#060351', blend: 0.51, speed: 1.6 },
    { id: 'borealis', name: 'Borealis Emerald', color1: '#046a38', color2: '#0ea5e9', color3: '#ed670a', blend: 0.52, speed: 1.5 },
    { id: 'cosmic', name: 'Cosmic Indigo', color1: '#4f46e5', color2: '#06b6d4', color3: '#f43f5e', blend: 0.54, speed: 1.6 },
    { id: 'sunset', name: 'Warm Sunset', color1: '#b4510a', color2: '#dc2626', color3: '#4338ca', blend: 0.50, speed: 1.8 },
    { id: 'glacier', name: 'Nordic Glacier', color1: '#0284c7', color2: '#059669', color3: '#1e3a8a', blend: 0.48, speed: 1.4 }
  ];

  function cleanHex(h, fallback) {
    if (!h) return fallback;
    var s = String(h).trim().replace(/^#/, '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return (/^[0-9a-fA-F]{6}$/.test(s)) ? ('#' + s.toLowerCase()) : fallback;
  }

  function hexToRgb(hex) {
    var s = cleanHex(hex, '#000000').replace(/^#/, '');
    var n = parseInt(s, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function hexToRgba(hex, a) {
    var rgb = hexToRgb(hex);
    return 'rgba(' + Math.round(rgb[0] * 255) + ',' + Math.round(rgb[1] * 255) + ',' + Math.round(rgb[2] * 255) + ',' + a + ')';
  }

  function loadConfig() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o) {
          var lt = o.light || o;
          var dk = o.dark || DEFAULT_CONFIG.dark;
          return {
            light: {
              color1: cleanHex(lt.color1, DEFAULT_CONFIG.light.color1),
              color2: cleanHex(lt.color2, DEFAULT_CONFIG.light.color2),
              color3: cleanHex(lt.color3, DEFAULT_CONFIG.light.color3),
              blend: Math.min(0.95, Math.max(0.1, Number(lt.blend) || DEFAULT_CONFIG.light.blend)),
              speed: Math.min(3.5, Math.max(0.2, Number(lt.speed) || DEFAULT_CONFIG.light.speed)),
              plain: lt.plain === true
            },
            dark: {
              color1: cleanHex(dk.color1, DEFAULT_CONFIG.dark.color1),
              color2: cleanHex(dk.color2, DEFAULT_CONFIG.dark.color2),
              color3: cleanHex(dk.color3, DEFAULT_CONFIG.dark.color3),
              blend: Math.min(0.95, Math.max(0.1, Number(dk.blend) || DEFAULT_CONFIG.dark.blend)),
              speed: Math.min(3.5, Math.max(0.2, Number(dk.speed) || DEFAULT_CONFIG.dark.speed)),
              plain: dk.plain === true
            }
          };
        }
      }
    } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  var currentConfig = loadConfig();
  var activeInstances = [];

  function setConfig(patch) {
    if (!patch) return currentConfig;
    if (patch.light) {
      if (patch.light.color1) currentConfig.light.color1 = cleanHex(patch.light.color1, currentConfig.light.color1);
      if (patch.light.color2) currentConfig.light.color2 = cleanHex(patch.light.color2, currentConfig.light.color2);
      if (patch.light.color3) currentConfig.light.color3 = cleanHex(patch.light.color3, currentConfig.light.color3);
      if (patch.light.blend != null) currentConfig.light.blend = Math.min(0.95, Math.max(0.1, Number(patch.light.blend)));
      if (patch.light.speed != null) currentConfig.light.speed = Math.min(3.5, Math.max(0.2, Number(patch.light.speed)));
      currentConfig.light.plain = patch.light.plain === true;   // any palette edit brings the aurora back
    }
    if (patch.dark) {
      if (patch.dark.color1) currentConfig.dark.color1 = cleanHex(patch.dark.color1, currentConfig.dark.color1);
      if (patch.dark.color2) currentConfig.dark.color2 = cleanHex(patch.dark.color2, currentConfig.dark.color2);
      if (patch.dark.color3) currentConfig.dark.color3 = cleanHex(patch.dark.color3, currentConfig.dark.color3);
      if (patch.dark.blend != null) currentConfig.dark.blend = Math.min(0.95, Math.max(0.1, Number(patch.dark.blend)));
      if (patch.dark.speed != null) currentConfig.dark.speed = Math.min(3.5, Math.max(0.2, Number(patch.dark.speed)));
      currentConfig.dark.plain = patch.dark.plain === true;
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(currentConfig)); } catch (e) {}
    activeInstances.forEach(function (inst) { try { inst.syncConfig(); } catch (e) {} });
    return currentConfig;
  }

  function resetConfig() {
    currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    activeInstances.forEach(function (inst) { try { inst.syncConfig(); } catch (e) {} });
    return currentConfig;
  }

  /* Background choices for the MaiK sidebar (owner, 2026-09-26: "in dark mode keep existing as one
   * background and give option to change background even in dark mode"). One list for both themes,
   * applied to the theme on screen. "tiranga" is each theme's own default, so dark keeps exactly the
   * background it always had; the other palettes are the Display presets; "plain" hides the aurora,
   * the glow and the thinking glyphs, and no animation loop runs. */
  var BG_BLURB = { tiranga: 'Saffron, green and navy aurora. The original.', borealis: 'Emerald, sky blue and amber aurora.', cosmic: 'Indigo, cyan and rose aurora.', sunset: 'Amber, red and indigo aurora.', glacier: 'Ocean blue, green and navy aurora.', plain: 'No aurora and no motion. A calm, solid backdrop.' };
  var BG_SHORT = { tiranga: 'Default', borealis: 'Borealis', cosmic: 'Cosmic', sunset: 'Sunset', glacier: 'Glacier', plain: 'Plain', custom: 'Custom' };
  function themeOf(theme) { return theme === 'dark' ? 'dark' : 'light'; }
  function bgPalette(theme, id) {
    if (id === 'tiranga') return DEFAULT_CONFIG[themeOf(theme)];
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }
  function choice(theme) {
    var c = currentConfig[themeOf(theme)];
    if (c.plain) return 'plain';
    for (var i = 0; i < PRESETS.length; i++) {
      var p = bgPalette(theme, PRESETS[i].id);
      if (c.color1.toLowerCase() === p.color1.toLowerCase() && c.color2.toLowerCase() === p.color2.toLowerCase() &&
          c.color3.toLowerCase() === p.color3.toLowerCase() && Math.abs(c.blend - p.blend) < 0.02) return PRESETS[i].id;
    }
    return 'custom';
  }
  function backgrounds(theme) {
    var list = PRESETS.map(function (p) {
      var c = bgPalette(theme, p.id);
      return { id: p.id, name: p.id === 'tiranga' ? p.name + ' (default)' : p.name, blurb: BG_BLURB[p.id] || '',
        preview: 'linear-gradient(160deg,' + hexToRgba(c.color1, 0.85) + ' 0%,' + hexToRgba(c.color3, 0.75) + ' 55%,' + hexToRgba(c.color2, 0.8) + ' 100%),var(--mk-bg)' };
    });
    list.push({ id: 'plain', name: 'Plain', blurb: BG_BLURB.plain, preview: 'var(--mk-bg)' });
    return list;
  }
  function choose(theme, id) {
    var patch = {}, p = bgPalette(theme, id);
    if (id === 'plain') patch[themeOf(theme)] = { plain: true };
    else if (p) patch[themeOf(theme)] = { color1: p.color1, color2: p.color2, color3: p.color3, blend: p.blend, speed: p.speed };
    else return currentConfig;
    return setConfig(patch);
  }

  function mount(sheet) {
    var layer = document.createElement('div'); layer.className = 'mk-atmo'; layer.setAttribute('aria-hidden', 'true');
    var aurora = document.createElement('canvas'), code = document.createElement('canvas'), veil = document.createElement('div');
    aurora.className = 'mk-atmo-aurora'; code.className = 'mk-atmo-code'; veil.className = 'mk-atmo-veil';
    layer.appendChild(aurora); layer.appendChild(code); layer.appendChild(veil); sheet.insertBefore(layer, sheet.firstChild); sheet.classList.add('mk-atmosphere');
    var ctx = code.getContext('2d'), gl = null, program = null, buffer = null, shaders = [], uniforms = {};
    var dead = false, busy = false, dark = false, raf = 0, last = 0, elapsed = 0, width = 1, height = 1, cols = 1, letters = [];
    var FONT = '14px ui-monospace, SFMono-Regular, monospace', CELL_L = 1.25, CELL_T = 2, cellsFit = false, fresh = true;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}[]<>/=+;:.*';
    function randomChar() { return chars.charAt(Math.floor(Math.random() * chars.length)); }

    function getPaletteArray(cfg) {
      return hexToRgb(cfg.color1).concat(hexToRgb(cfg.color2), hexToRgb(cfg.color3));
    }

    function applyCssGlow(cfg) {
      if (!dark) {
        layer.style.setProperty('--mk-c1-a', hexToRgba(cfg.color1, 0.28));
        layer.style.setProperty('--mk-c2-a', hexToRgba(cfg.color2, 0.24));
        layer.style.setProperty('--mk-c3-a', hexToRgba(cfg.color3, 0.22));
      } else {
        // The default dark palette gives exactly the stylesheet's own values (.34 / .22 / .45).
        layer.style.setProperty('--mk-d1-a', hexToRgba(cfg.color1, 0.34));
        layer.style.setProperty('--mk-d2-a', hexToRgba(cfg.color2, 0.22));
        layer.style.setProperty('--mk-d3-a', hexToRgba(cfg.color3, 0.45));
      }
      layer.classList.toggle('mk-atmo-plain', !!cfg.plain);
    }
    function plainNow() { return !!(dark ? currentConfig.dark : currentConfig.light).plain; }

    function releaseGL() {
      if (!gl) return;
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      shaders.forEach(function (s) { gl.deleteShader(s); });
      var ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
      gl = null;
    }
    try {
      gl = aurora.getContext('webgl2', {alpha:true, premultipliedAlpha:true, antialias:false});
      if (gl) {
        function compile(type, source) { var s=gl.createShader(type); shaders.push(s); gl.shaderSource(s,source); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error('Aurora shader unavailable'); return s; }
        program=gl.createProgram(); gl.attachShader(program,compile(gl.VERTEX_SHADER,VERT)); gl.attachShader(program,compile(gl.FRAGMENT_SHADER,FRAG)); gl.linkProgram(program);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error('Aurora program unavailable');
        gl.useProgram(program); buffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
        var pos=gl.getAttribLocation(program,'position'); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
        ['uTime','uAmplitude','uBlend','uResolution','uLightMode','uColorStops[0]'].forEach(function (n) { uniforms[n]=gl.getUniformLocation(program,n); });
        gl.uniform1f(uniforms.uAmplitude,1.05); gl.clearColor(0,0,0,0);
      }
    } catch (e) { releaseGL(); }
    if (!gl) aurora.style.display='none';

    function paint() {
      if (dead || plainNow()) return;
      var cfg = dark ? currentConfig.dark : currentConfig.light;
      if (!busy && gl) {
        gl.uniform1f(uniforms.uTime, elapsed * cfg.speed);
        gl.uniform1f(uniforms.uLightMode, dark ? 0 : 1);
        gl.uniform1f(uniforms.uBlend, cfg.blend);
        gl.uniform3fv(uniforms['uColorStops[0]'], new Float32Array(getPaletteArray(cfg)));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      } else if (busy && ctx) {
        ctx.font = FONT; ctx.textBaseline = 'top';
        var shades = dark ? ['#3b7560', '#70c4a1', '#6c9cb5'] : [cfg.color1, cfg.color2, cfg.color3];
        /* Energy: repaint only the cells whose glyph, colour or 8-bit alpha changed since they were
         * last painted. Cells never overlap (cellsFit), so clearing a cell's box and redrawing it gives
         * the same pixels as the full clear + redraw (test/run-maik-atmosphere-pixels.mjs). */
        var full = !cellsFit || fresh;
        if (full) ctx.clearRect(0, 0, width, height);
        letters.forEach(function (l, i) {
          l.value += (l.target - l.value) * .14;
          var a = .3 + l.value * .6, q = Math.round(a * 255), fill = shades[i % 3], x = (i % cols) * 11, y = Math.floor(i / cols) * 20;
          if (!full) { if (l.pc === l.char && l.pq === q && l.pf === fill) return; ctx.clearRect(x - CELL_L, y - CELL_T, 11, 20); }
          ctx.globalAlpha = a;
          ctx.fillStyle = fill;
          ctx.fillText(l.char, x, y);
          l.pc = l.char; l.pq = q; l.pf = fill;
        });
        ctx.globalAlpha = 1; fresh = false;
      }
    }
    // A cell's clear box is [x - CELL_L, x - CELL_L + 11) x [y - CELL_T, y - CELL_T + 20); the boxes
    // tile the canvas. Every glyph's ink must sit at least one device pixel inside its box, so the
    // box's (possibly fractional) edge never shares a pixel with ink. Otherwise: full redraws only.
    function measureCells(dpr) {
      var m = 1 / dpr + .05; ctx.font = FONT; ctx.textBaseline = 'top';
      for (var k = 0; k < chars.length; k++) {
        var t = ctx.measureText(chars.charAt(k));
        if (t.actualBoundingBoxLeft == null) return false;
        if (t.actualBoundingBoxLeft > CELL_L - m || t.actualBoundingBoxRight > 11 - CELL_L - m ||
            t.actualBoundingBoxAscent > CELL_T - m || t.actualBoundingBoxDescent > 20 - CELL_T - m) return false;
      }
      return true;
    }

    function active() { return !dead && sheet.isConnected && sheet.classList.contains('on') && !document.hidden && !reduced.matches; }
    function frame(t) {
      raf = 0; if (!sheet.isConnected) { destroy(); return; } if (!active() || plainNow()) return;
      if (t - last >= 24) {
        elapsed += Math.min((t - last) / 1000, .1); last = t;
        if (busy) for (var i = 0; i < letters.length * .04; i++) { var l = letters[Math.floor(Math.random() * letters.length)]; l.char = randomChar(); l.target = Math.random(); }
        paint();
      }
      raf = requestAnimationFrame(frame);
    }
    function sync() {
      if (dead) return;
      fresh = true;
      dark = document.body.classList.contains('dark') || document.body.classList.contains('v3-dark');
      layer.classList.toggle('mk-atmo-dark', dark);
      var cfg = dark ? currentConfig.dark : currentConfig.light;
      applyCssGlow(cfg);
      paint();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      last = performance.now();
      if (active() && !plainNow()) raf = requestAnimationFrame(frame);
    }
    function resize() {
      if (dead) return;
      width = Math.max(1, sheet.clientWidth); height = Math.max(1, sheet.clientHeight); var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      code.width = Math.round(width * dpr); code.height = Math.round(height * dpr); if (ctx) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); cellsFit = measureCells(dpr); }
      cols = Math.ceil(width / 11); letters = []; for (var n = 0; n < cols * Math.ceil(height / 20); n++) letters.push({ char: randomChar(), value: Math.random(), target: Math.random() });
      if (gl) { aurora.width = Math.round(width * dpr); aurora.height = Math.round(height * dpr); gl.viewport(0, 0, aurora.width, aurora.height); gl.uniform2f(uniforms.uResolution, aurora.width, aurora.height); }
      sync();
    }
    var themeObserver = new MutationObserver(sync), sheetObserver = new MutationObserver(sync), resizeObserver = window.ResizeObserver ? new ResizeObserver(resize) : null;
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] }); sheetObserver.observe(sheet, { attributes: true, attributeFilter: ['class'] });
    if (resizeObserver) resizeObserver.observe(sheet); else window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', sync); if (reduced.addEventListener) reduced.addEventListener('change', sync); else reduced.addListener(sync);

    var inst = {
      syncConfig: function () {
        var cfg = dark ? currentConfig.dark : currentConfig.light;
        applyCssGlow(cfg);
        if (!raf && active() && !cfg.plain) { last = performance.now(); raf = requestAnimationFrame(frame); }   // leaving Plain restarts the loop
        fresh = true; paint();
      },
      setBusy: function (on) {
        busy = !!on;
        layer.classList.toggle('mk-atmo-thinking', busy);
        sync();
      },
      destroy: destroy
    };
    activeInstances.push(inst);

    function destroy() {
      if (dead) return; dead = true; cancelAnimationFrame(raf);
      var idx = activeInstances.indexOf(inst);
      if (idx >= 0) activeInstances.splice(idx, 1);
      themeObserver.disconnect(); sheetObserver.disconnect(); if (resizeObserver) resizeObserver.disconnect(); else window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', sync); if (reduced.removeEventListener) reduced.removeEventListener('change', sync); else reduced.removeListener(sync);
      releaseGL(); layer.remove(); sheet.classList.remove('mk-atmosphere');
    }
    resize();
    return inst;
  }

  window.SMD_MAIK_ATMOSPHERE = {
    mount: mount,
    getConfig: function () { return JSON.parse(JSON.stringify(currentConfig)); },
    setConfig: setConfig,
    resetConfig: resetConfig,
    backgrounds: backgrounds,
    choice: choice,
    choiceLabel: function (theme) { return BG_SHORT[choice(theme)]; },
    choose: choose,
    PRESETS: PRESETS,
    DEFAULT_CONFIG: DEFAULT_CONFIG
  };
})();
