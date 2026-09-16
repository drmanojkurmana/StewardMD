/* MaiK atmospheric backgrounds. Presentation only; never reads prompt or answer text.
 * Aurora shader / Letter Glitch behavior adapted from React Bits (David Haz).
 * See licenses/react-bits.txt. No React, network calls, or runtime dependencies. */
(function () {
  'use strict';
  var VERT = '#version 300 es\nin vec2 position;void main(){gl_Position=vec4(position,0.,1.);}';
  var FRAG = "#version 300 es\nprecision highp float;\n\nuniform float uTime;\nuniform float uAmplitude;\nuniform vec3 uColorStops[3];\nuniform vec2 uResolution;\nuniform float uBlend;\nuniform float uLightMode;\n\nout vec4 fragColor;\n\nvec3 permute(vec3 x) {\n  return mod(((x * 34.0) + 1.0) * x, 289.0);\n}\n\nfloat snoise(vec2 v){\n  const vec4 C = vec4(\n      0.211324865405187, 0.366025403784439,\n      -0.577350269189626, 0.024390243902439\n  );\n  vec2 i  = floor(v + dot(v, C.yy));\n  vec2 x0 = v - i + dot(i, C.xx);\n  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);\n  vec4 x12 = x0.xyxy + C.xxzz;\n  x12.xy -= i1;\n  i = mod(i, 289.0);\n\n  vec3 p = permute(\n      permute(i.y + vec3(0.0, i1.y, 1.0))\n    + i.x + vec3(0.0, i1.x, 1.0)\n  );\n\n  vec3 m = max(\n      0.5 - vec3(\n          dot(x0, x0),\n          dot(x12.xy, x12.xy),\n          dot(x12.zw, x12.zw)\n      ), \n      0.0\n  );\n  m = m * m;\n  m = m * m;\n\n  vec3 x = 2.0 * fract(p * C.www) - 1.0;\n  vec3 h = abs(x) - 0.5;\n  vec3 ox = floor(x + 0.5);\n  vec3 a0 = x - ox;\n  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);\n\n  vec3 g;\n  g.x  = a0.x  * x0.x  + h.x  * x0.y;\n  g.yz = a0.yz * x12.xz + h.yz * x12.yw;\n  return 130.0 * dot(m, g);\n}\n\nstruct ColorStop {\n  vec3 color;\n  float position;\n};\n\n#define COLOR_RAMP(colors, factor, finalColor) {                int index = 0;                                              for (int i = 0; i < 2; i++) {                                    ColorStop currentColor = colors[i];                         bool isInBetween = currentColor.position <= factor;         index = int(mix(float(index), float(i), float(isInBetween)));   }                                                           ColorStop currentColor = colors[index];                     ColorStop nextColor = colors[index + 1];                    float range = nextColor.position - currentColor.position;   float lerpFactor = (factor - currentColor.position) / range;   finalColor = mix(currentColor.color, nextColor.color, lerpFactor); }\n\nvoid main() {\n  vec2 uv = gl_FragCoord.xy / uResolution;\n  \n  ColorStop colors[3];\n  colors[0] = ColorStop(uColorStops[0], 0.0);\n  colors[1] = ColorStop(uColorStops[1], 0.5);\n  colors[2] = ColorStop(uColorStops[2], 1.0);\n  \n  vec3 rampColor;\n  COLOR_RAMP(colors, uv.x, rampColor);\n  \n  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;\n  height = exp(height);\n  height = (uv.y * 2.0 - height + 0.2);\n  float intensity = 0.6 * height;\n  \n  float midPoint = 0.20;\n  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);\n  \n  vec3 auroraColor = intensity * rampColor;\n  \n  if (uLightMode > 0.5) {\n    float energy = clamp(max(intensity, 0.0), 0.0, 1.0);\n    float coverage = clamp(auroraAlpha * (0.55 + 0.45 * energy), 0.0, 0.86);\n    vec3 chroma = pow(clamp(rampColor, 0.0, 1.0), vec3(1.2));\n    float chromaPeak = max(chroma.r, max(chroma.g, chroma.b));\n    chroma /= max(chromaPeak, 0.0001);\n    fragColor = vec4(mix(vec3(1.0), chroma, min(coverage * 1.08, 0.94)), 1.0);\n  } else {\n    fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);\n  }\n}\n";
  var PALETTES = { dark: ['#FF671F', '#046A38', '#06038D'], light: ['#046A38', '#FFFFFF', '#ED670A'] };
  function mount(sheet) {
    var layer = document.createElement('div'); layer.className = 'mk-atmo'; layer.setAttribute('aria-hidden', 'true');
    var aurora = document.createElement('canvas'), code = document.createElement('canvas'), veil = document.createElement('div');
    aurora.className = 'mk-atmo-aurora'; code.className = 'mk-atmo-code'; veil.className = 'mk-atmo-veil';
    layer.appendChild(aurora); layer.appendChild(code); layer.appendChild(veil); sheet.insertBefore(layer, sheet.firstChild); sheet.classList.add('mk-atmosphere');
    var ctx = code.getContext('2d'), gl = null, program = null, buffer = null, shaders = [], uniforms = {};
    var dead = false, busy = false, dark = false, raf = 0, last = 0, elapsed = 0, width = 1, height = 1, cols = 1, letters = [];
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}[]<>/=+;:.*';
    function randomChar() { return chars.charAt(Math.floor(Math.random() * chars.length)); }
    function colors() { return (dark ? PALETTES.dark : PALETTES.light).reduce(function (a, hex) { return a.concat([1,3,5].map(function (i) { return parseInt(hex.substr(i,2),16)/255; })); }, []); }
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
        gl.uniform1f(uniforms.uAmplitude,1.05); gl.uniform1f(uniforms.uBlend,.49); gl.clearColor(0,0,0,0);
      }
    } catch (e) { releaseGL(); }
    if (!gl) aurora.style.display='none';
    function paint() {
      if (dead) return;
      if (!busy && gl) {
        gl.uniform1f(uniforms.uTime,elapsed*.4); gl.uniform1f(uniforms.uLightMode,dark?0:1); gl.uniform1f(uniforms.uBlend,dark?.49:.5); gl.uniform3fv(uniforms['uColorStops[0]'],new Float32Array(colors())); gl.drawArrays(gl.TRIANGLES,0,3);
      } else if (busy && ctx) {
        ctx.clearRect(0,0,width,height); ctx.font='14px ui-monospace, SFMono-Regular, monospace'; ctx.textBaseline='top';
        var shades=dark?['#3b7560','#70c4a1','#6c9cb5']:['#046A38','#365b75','#686868'];
        letters.forEach(function (l,i) { l.value+=(l.target-l.value)*.14; ctx.globalAlpha=.3+l.value*.6; ctx.fillStyle=shades[i%3]; ctx.fillText(l.char,(i%cols)*11,Math.floor(i/cols)*20); }); ctx.globalAlpha=1;
      }
    }
    function active() { return !dead && sheet.isConnected && sheet.classList.contains('on') && !document.hidden && !reduced.matches; }
    function frame(t) {
      raf=0; if (!sheet.isConnected) { destroy(); return; } if(!active()) return;
      if(t-last>=50) { elapsed+=Math.min((t-last)/1000,.1); last=t;
        if(busy) for(var i=0;i<letters.length*.04;i++) {var l=letters[Math.floor(Math.random()*letters.length)];l.char=randomChar();l.target=Math.random();}
        paint();
      }
      raf=requestAnimationFrame(frame);
    }
    function sync() {
      if (dead) return;
      dark=document.body.classList.contains('dark')||document.body.classList.contains('v3-dark'); layer.classList.toggle('mk-atmo-dark',dark); paint();
      if(raf) {cancelAnimationFrame(raf);raf=0;} last=performance.now(); if(active()) raf=requestAnimationFrame(frame);
    }
    function resize() {
      if(dead) return;
      width=Math.max(1,sheet.clientWidth); height=Math.max(1,sheet.clientHeight); var dpr=Math.min(window.devicePixelRatio||1,1.5);
      code.width=Math.round(width*dpr);code.height=Math.round(height*dpr);if(ctx)ctx.setTransform(dpr,0,0,dpr,0,0);
      cols=Math.ceil(width/11);letters=[];for(var n=0;n<cols*Math.ceil(height/20);n++)letters.push({char:randomChar(),value:Math.random(),target:Math.random()});
      if(gl){aurora.width=Math.round(width*dpr);aurora.height=Math.round(height*dpr);gl.viewport(0,0,aurora.width,aurora.height);gl.uniform2f(uniforms.uResolution,aurora.width,aurora.height);} sync();
    }
    var themeObserver=new MutationObserver(sync),sheetObserver=new MutationObserver(sync),resizeObserver=window.ResizeObserver?new ResizeObserver(resize):null;
    themeObserver.observe(document.body,{attributes:true,attributeFilter:['class']});sheetObserver.observe(sheet,{attributes:true,attributeFilter:['class']});
    if(resizeObserver)resizeObserver.observe(sheet);else window.addEventListener('resize',resize);
    document.addEventListener('visibilitychange',sync); if(reduced.addEventListener)reduced.addEventListener('change',sync);else reduced.addListener(sync);
    function destroy() {
      if(dead)return;dead=true;cancelAnimationFrame(raf);themeObserver.disconnect();sheetObserver.disconnect();if(resizeObserver)resizeObserver.disconnect();else window.removeEventListener('resize',resize);
      document.removeEventListener('visibilitychange',sync);if(reduced.removeEventListener)reduced.removeEventListener('change',sync);else reduced.removeListener(sync);
      releaseGL();layer.remove();sheet.classList.remove('mk-atmosphere');
    }
    resize();
    return {setBusy:function(on){busy=!!on;layer.classList.toggle('mk-atmo-thinking',busy);sync();},destroy:destroy};
  }
  window.SMD_MAIK_ATMOSPHERE={mount:mount};
})();
