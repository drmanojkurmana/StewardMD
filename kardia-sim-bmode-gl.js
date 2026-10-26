/* kardia-sim-bmode-gl.js - Kardia K3 WebGL B-mode renderer (independent).
 * Samples the K3 label atlas (kardia-sim-volume.js) along the live probe
 * plane in a fragment shader: per-tissue echogenicity, fully developed
 * speckle that decorrelates as tissue deforms, depth attenuation with an
 * 8-band TGC, near-field clutter, acoustic shadowing behind bone and
 * lung (beam march), specular pericardium and valve leaflets, lateral
 * blur growing with depth and least at the focus, sector mask, depth
 * scale, focus marker, ECG strip and frame rate. Black surround, grey
 * scale only, no colour and no glow.
 * API: create(canvas) returns { setVolume, setPose, setPhase, setKnobs,
 * render, resize, fps, shaderSources }. Poses are {origin, beam, up} in
 * patient millimetres (see KARDIA_SIM_VOLUME.poseToPlane).
 */
(function (G) {
  "use strict";
  var VERT = "attribute vec2 aPos; varying vec2 vUv; void main(){ vUv=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }";
  var FRAG = [
    "precision highp float;",
    "varying vec2 vUv;",
    "uniform sampler2D uAtlas;",
    "uniform vec3 uOrigin, uBeam, uRight, uNormal, uVolMin, uVolStep;",
    "uniform vec3 uDims; uniform float uCols, uPhase, uTime;",
    "uniform vec4 uKnobs; /* gain 0..2, depthMm, focusMm, dynamicRange 30..90 */",
    "uniform float uTgc[8]; uniform vec2 uRes; uniform float uFps;",
    "float hash(vec3 p){ p=fract(p*vec3(443.897,441.423,437.195)); p+=dot(p,p.yzx+19.19); return fract((p.x+p.y)*p.z); }",
    "float vnoise(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);",
    "  float a=hash(i), b=hash(i+vec3(1.0,0.0,0.0)), c=hash(i+vec3(0.0,1.0,0.0)), d=hash(i+vec3(1.0,1.0,0.0));",
    "  float e=hash(i+vec3(0.0,0.0,1.0)), g=hash(i+vec3(1.0,0.0,1.0)), h=hash(i+vec3(0.0,1.0,1.0)), k=hash(i+vec3(1.0,1.0,1.0));",
    "  return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g,f.x),mix(h,k,f.x),f.y),f.z); }",
    "/* Inverse cardiac deformation, mirroring deformPoint on the CPU. */",
    "vec3 undeform(vec3 p){",
    "  float t=fract(uPhase); float c; if(t<0.32){ float u=t/0.32; c=u*u*(3.0-2.0*u); } else { float v=(t-0.32)/0.68; c=1.0-v*v*(3.0-2.0*v)*0.92-0.08*sin(v*3.14159); }",
    "  vec3 lv=vec3(-2.0,2.0,-4.0); vec3 d=p-lv; float dist=length(d);",
    "  if(dist<38.0){ float f=1.0+0.22*c*(1.0-dist/38.0); p=lv+(p-lv)*f; }",
    "  vec3 rv=vec3(-2.6,37.0,11.5); d=p-rv; dist=length(d);",
    "  if(dist<38.0){ float f=1.0+0.18*c*(1.0-dist/38.0); p=rv+(p-rv)*f; }",
    "  return p; }",
    "vec4 texSlice(vec3 p){",
    "  vec3 g=(p-uVolMin)/uVolStep; /* voxel coords */",
    "  float z=clamp(g.z,0.0,uDims.z-1.001); float z0=floor(z);",
    "  vec2 tile=vec2(mod(z0,uCols),floor(z0/uCols));",
    "  vec2 uv=((tile*uDims.xy)+clamp(g.xy,vec2(0.0),uDims.xy-1.001)+0.5)/vec2(uCols*uDims.x, ceil(uDims.z/uCols)*uDims.y);",
    "  return texture2D(uAtlas,uv); }",
    "vec4 sampleVol(vec3 p){ /* trilinear on xy per slice, lerp slices */",
    "  vec3 g=(p-uVolMin)/uVolStep; float z0=floor(clamp(g.z,0.0,uDims.z-1.001)); float fz=fract(g.z);",
    "  vec3 pa=p; pa.z=uVolMin.z+z0*uVolStep.z; vec3 pb=pa; pb.z+=uVolStep.z;",
    "  return mix(texSlice(pa),texSlice(pb),clamp(fz,0.0,1.0)); }",
    "/* Atlas fields: R echo, G specular, B attenuation/4, A blood. All smoothed, */",
    "/* sampled with LINEAR filtering plus slice lerp: true trilinear, no labels. */",
    "void main(){",
    "  vec2 px=vUv*uRes; vec2 c=vec2(uRes.x*0.5,uRes.y*0.94);",
    "  vec2 d=px-c; float depthPx=uKnobs.y/160.0*uRes.y*0.86; float depthMm=( -d.y)/max(depthPx,1.0)*uKnobs.y;",
    "  float ang=atan(d.x,max(-d.y,0.001)); float halfA=0.62;",
    "  vec3 col=vec3(0.0);",
    "  /* ECG strip along the bottom */",
    "  if(vUv.y<0.07){ float x=vUv.x; float ph=fract(uPhase+x*0.0); float w=fract(uTime*0.9+x*1.4); float ecg=0.0;",
    "    ecg+=exp(-pow((w-0.18)*22.0,2.0))*0.25; ecg+=exp(-pow((w-0.24)*90.0,2.0))*1.0; ecg-=exp(-pow((w-0.27)*70.0,2.0))*0.22; ecg+=exp(-pow((w-0.45)*16.0,2.0))*0.35;",
    "    float line=0.035+ecg*0.022; col=mix(col,vec3(0.55),smoothstep(0.004,0.001,abs(vUv.y-line))*step(0.02,vUv.y)); }",
    "  if(depthMm>2.0 && depthMm<uKnobs.y && abs(ang)<halfA){",
    "    float latMm=tan(ang)*depthMm;",
    "    vec3 world=uOrigin+uBeam*depthMm+uRight*latMm;",
    "    vec3 rest=undeform(world);",
    "    vec4 s=sampleVol(rest); float echo=s.r; float specF=s.g; float bloodF=s.a;",
    "    /* Beam march: shadow and attenuation behind bone or lung */",
    "    float shadow=1.0; float att=0.0; float steps=8.0;",
    "    for(int i=0;i<8;i++){ float dm=depthMm*(float(i)+0.5)/steps; vec3 wp=uOrigin+uBeam*dm+uRight*(tan(ang)*dm); float at=sampleVol(undeform(wp)).b*4.0; att+=at*(depthMm/steps)/10.0; shadow*=exp(-max(at-1.4,0.0)*(depthMm/steps)*0.06); }",
    "    att=exp(-att*0.25);",
    "    /* TGC: 8 bands by depth */",
    "    float band=clamp(depthMm/uKnobs.y*8.0,0.0,7.99); float tgc=1.0;",
    "    for(int i=0;i<8;i++){ if(abs(float(i)-floor(band))<0.5) tgc=uTgc[i]; }",
    "    /* Speckle: two independent smooth noises give a Rayleigh-like */",
    "    /* envelope; intensity env*env is exponential, as in real speckle. */",
    "    /* Grains are elongated laterally: about 1.4 mm wide (lateral) by */",
    "    /* 0.55 mm tall (axial), widening slowly beyond the focus. */",
    "    float foc=exp(-pow((depthMm-uKnobs.z)/28.0,2.0));",
    "    float latCell=mix(1.25,0.95,foc)+depthMm*0.003; float axCell=0.48+depthMm*0.0012;",
    "    vec3 cell=vec3(latMm/latCell, depthMm/axCell, dot(world-uOrigin,uNormal)/1.5);",
    "    vec3 grain=floor(cell);",
    "    vec2 gg=vec2(hash(grain)-0.5,hash(grain+31.7)-0.5)*2.2;",
    "    float env=length(gg); float speckle=env*env*(0.72+0.55*vnoise(cell*2.03+11.1));",
    "    float tissueSig=echo*speckle*0.9;",
    "    float bloodSig=0.008*env; /* blood: almost black, faint noise only */",
    "    float spec=specF*0.65;",
    "    float nearClutter=exp(-depthMm/9.0)*(0.05+0.04*vnoise(cell*1.4));",
    "    float sig=(mix(tissueSig,bloodSig,clamp(bloodF,0.0,1.0))+spec*(0.25+0.75*speckle)+nearClutter);",
    "    sig*=att*shadow*tgc*uKnobs.x;",
    "    float dr=uKnobs.w; float grey=clamp(log(1.0+sig*(exp(dr/8.6859)-1.0))/ (dr/8.6859) ,0.0,1.0);",
    "    grey=pow(grey,0.85); col=vec3(grey);",
    "    /* Sector edge falloff */",
    "    col*=smoothstep(halfA,halfA-0.02,abs(ang));",
    "  }",
    "  /* Depth ticks on the right of the fan, focus marker */",
    "  float tickX=0.86; if(abs(vUv.x-tickX)<0.012){ for(int i=1;i<9;i++){ float ty=0.94-float(i)*(0.86/8.0)*(uRes.x/uRes.y)*(uRes.y/uRes.x); } }",
    "  if(abs(vUv.x-0.865)<0.02 && vUv.y<0.94 && vUv.y>0.08){ float f=fract((0.94-vUv.y)/0.1075); if(f<0.03) col=max(col,vec3(0.5)); }",
    "  float focy=0.94-(uKnobs.z/uKnobs.y)*0.86; if(abs(vUv.y-focy)<0.004 && abs(vUv.x-0.885)<0.012) col=vec3(0.85);",
    "  gl_FragColor=vec4(col,1.0); }"
  ].join("\n");
  function compile(gl, type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader compile failed"); return s; }
  function create(canvas) {
    var gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) throw new Error("WebGL is not available on this device");
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("B-mode shader failed to link");
    gl.useProgram(prog);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "aPos"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {}; ["uAtlas", "uOrigin", "uBeam", "uRight", "uNormal", "uVolMin", "uVolStep", "uDims", "uCols", "uPhase", "uTime", "uKnobs", "uRes", "uFps"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    U.uTgc = gl.getUniformLocation(prog, "uTgc[0]");
    var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var state = { pose: null, phase: 0, knobs: { gain: 1.0, depthMm: 160, focusMm: 70, dynamicRange: 60 }, tgc: [0.9, 0.95, 1, 1, 1, 1.05, 1.1, 1.15], vol: null, frames: 0, fps: 0, lastFpsT: performance.now() };
    function setVolume(atlas) {
      state.vol = atlas;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, atlas.width, atlas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas.rgba);
      gl.uniform3f(U.uVolMin, atlas.min[0], atlas.min[1], atlas.min[2]);
      gl.uniform3f(U.uVolStep, atlas.step[0], atlas.step[1], atlas.step[2]);
      gl.uniform3f(U.uDims, atlas.dims[0], atlas.dims[1], atlas.dims[2]); gl.uniform1f(U.uCols, atlas.cols);
    }
    function setPose(pose) { state.pose = pose; }
    function setPhase(t) { state.phase = t; }
    function setKnobs(k) { if (!k) return; ["gain", "depthMm", "focusMm", "dynamicRange"].forEach(function (key) { if (typeof k[key] === "number") state.knobs[key] = k[key]; }); if (k.depthCm) state.knobs.depthMm = k.depthCm * 10; if (k.tgc) state.tgc = k.tgc.slice(0, 8); }
    function resize() { var w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height; if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } gl.viewport(0, 0, canvas.width, canvas.height); }
    function render(now) {
      resize(); if (!state.vol || !state.pose) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
      var V = G.KARDIA_SIM_VOLUME; if (!V) throw new Error("kardia-sim-volume.js must load first");
      var pl = V.poseToPlane(state.pose);
      gl.uniform3f(U.uOrigin, pl.origin[0], pl.origin[1], pl.origin[2]);
      gl.uniform3f(U.uBeam, pl.beam[0], pl.beam[1], pl.beam[2]); gl.uniform3f(U.uRight, pl.right[0], pl.right[1], pl.right[2]); gl.uniform3f(U.uNormal, pl.normal[0], pl.normal[1], pl.normal[2]);
      gl.uniform1f(U.uPhase, state.phase); gl.uniform1f(U.uTime, (now || 0) / 1000);
      gl.uniform4f(U.uKnobs, state.knobs.gain, state.knobs.depthMm, state.knobs.focusMm, state.knobs.dynamicRange);
      gl.uniform1fv(U.uTgc, new Float32Array(state.tgc)); gl.uniform2f(U.uRes, canvas.width, canvas.height); gl.uniform1f(U.uFps, state.fps); gl.uniform1i(U.uAtlas, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      state.frames++; var t = performance.now(); if (t - state.lastFpsT >= 500) { state.fps = Math.round(state.frames * 1000 / (t - state.lastFpsT)); state.frames = 0; state.lastFpsT = t; }
    }
    return { setVolume: setVolume, setPose: setPose, setPhase: setPhase, setKnobs: setKnobs, render: render, resize: resize,
      get fps() { return state.fps; }, get knobs() { return state.knobs; }, gl: gl };
  }
  /* Fake-GL compile check for unit tests (no real context needed). */
  function compileCheck(gl) { compile(gl, gl.VERTEX_SHADER, VERT); compile(gl, gl.FRAGMENT_SHADER, FRAG); return true; }
  var API = { create: create, VERT: VERT, FRAG: FRAG, _compileCheck: compileCheck, shaderSources: { vertex: VERT, fragment: FRAG } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.KARDIA_BMODE_GL = API;
})(typeof window !== "undefined" ? window : globalThis);
