/* kardia-sim-bmode-gl.js - Kardia K3 WebGL B-mode renderer (independent).
 * Samples the K3 field atlas along the live probe plane in a fragment
 * shader. Polar sector (apex at the top, circular far field), scatterer
 * speckle convolved with a depth-dependent PSF (laterally wide, axially
 * short), log compression, TGC, attenuation, rib shadow, lung A-lines,
 * near-field clutter, depth marks, focus marker and ECG strip.
 * API: create(canvas) returns { setVolume, setPose, setPhase, setKnobs,
 * render, resize, fps }. Poses are {origin, beam, up} in patient mm.
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
    "uniform vec4 uKnobs; /* gain, depthMm, focusMm, dynamicRange */",
    "uniform float uTgc[8]; uniform vec2 uRes; uniform float uFps;",
    "float hash(vec3 p){ p=fract(p*vec3(443.897,441.423,437.195)); p+=dot(p,p.yzx+19.19); return fract((p.x+p.y)*p.z); }",
    "float sgauss(vec2 c, float seed){",
    "  vec2 i=floor(c); vec2 f=c-i; vec2 s=f*f*(3.0-2.0*f);",
    "  float v=mix(mix(hash(vec3(i,seed)),hash(vec3(i+vec2(1.0,0.0),seed)),s.x),",
    "              mix(hash(vec3(i+vec2(0.0,1.0),seed)),hash(vec3(i+vec2(1.0,1.0),seed)),s.x),s.y);",
    "  vec4 w=vec4((1.0-s.x)*(1.0-s.y), s.x*(1.0-s.y), (1.0-s.x)*s.y, s.x*s.y);",
    "  return (v-0.5)*sqrt(12.0/max(dot(w,w),0.001)); }",
    "vec3 undeform(vec3 p){",
    "  float t=fract(uPhase); float c;",
    "  if(t<0.32){ float u=t/0.32; c=u*u*(3.0-2.0*u); }",
    "  else { float v=(t-0.32)/0.68; c=1.0-v*v*(3.0-2.0*v)*0.92-0.08*sin(v*3.14159); }",
    "  vec3 lv=vec3(0.0,2.0,-3.0); vec3 d=p-lv; float dist=length(d);",
    "  if(dist<42.0){ float f=1.0+0.20*c*(1.0-dist/42.0); p=lv+(p-lv)/f; }",
    "  vec3 rv=vec3(-23.1,12.6,1.6); d=p-rv; dist=length(d);",
    "  if(dist<36.0){ float f=1.0+0.16*c*(1.0-dist/36.0); p=rv+(p-rv)/f; }",
    "  return p; }",
    "vec4 texSlice(vec3 p){",
    "  vec3 g=(p-uVolMin)/uVolStep;",
    "  float z=clamp(g.z,0.0,uDims.z-1.001); float z0=floor(z);",
    "  vec2 tile=vec2(mod(z0,uCols),floor(z0/uCols));",
    "  vec2 xy=clamp(g.xy,vec2(0.5),uDims.xy-1.5);",
    "  float atlasH=ceil(uDims.z/uCols)*uDims.y;",
    "  vec2 uv=(tile*uDims.xy+xy)/vec2(uCols*uDims.x, atlasH);",
    "  return texture2D(uAtlas,uv); }",
    "vec4 sampleVol(vec3 p){",
    "  vec3 g=(p-uVolMin)/uVolStep; float z0=floor(clamp(g.z,0.0,uDims.z-1.001)); float fz=fract(g.z);",
    "  vec3 pa=p; pa.z=uVolMin.z+z0*uVolStep.z; vec3 pb=pa; pb.z+=uVolStep.z;",
    "  return mix(texSlice(pa),texSlice(pb),clamp(fz,0.0,1.0)); }",
    "float tgcAt(float d){ float t=clamp(d/max(uKnobs.y,1.0),0.0,1.0)*7.0; int i=int(floor(t)); float f=t-float(i); float a=1.0; float b=1.0;",
    "  for(int k=0;k<8;k++){ if(k==i) a=uTgc[k]; if(k==i+1) b=uTgc[k]; } return mix(a,b,f); }",
    "float ecg(float ph){ float v=0.0;",
    "  v+=0.16*exp(-pow(ph-0.14,2.0)/0.00065);",
    "  v+=-0.14*exp(-pow(ph-0.285,2.0)/0.00007);",
    "  v+=1.00*exp(-pow(ph-0.30,2.0)/0.00013);",
    "  v+=-0.24*exp(-pow(ph-0.315,2.0)/0.00007);",
    "  v+=0.30*exp(-pow(ph-0.52,2.0)/0.0016); return v; }",
    "void main(){",
    "  float ecgH=0.12; float imgH=1.0-ecgH;",
    "  bool inStrip=vUv.y<ecgH;",
    "  vec2 px=vec2(vUv.x*uRes.x, (1.0-vUv.y)*uRes.y);",
    "  float imgHpx=uRes.y*imgH;",
    "  float apexX=uRes.x*0.5;",
    "  float apexY=4.0+imgHpx*0.025;",
    "  float scale=(imgHpx-apexY)*0.98/max(uKnobs.y,1.0);",
    "  float dx=px.x-apexX, dy=px.y-apexY;",
    "  float r=length(vec2(dx,dy));",
    "  float ang=atan(dx, max(dy,0.0001));",
    "  float halfA=0.70;",
    "  vec3 col=vec3(0.0);",
    "  if(!inStrip && dy>0.0 && abs(ang)<=halfA && r<=imgHpx-apexY){",
    "    float depthMm=r/max(scale,0.001);",
    "    float latMm=tan(ang)*depthMm;",
    "    vec3 dir=normalize(uBeam*cos(ang)+uRight*sin(ang));",
    "    /* PSF: lateral FWHM 1.5->4 mm with depth, smallest at focus;",
    "       axial FWHM 0.5->1.0 mm. Five lateral taps, three axial. */",
    "    float latF=clamp(1.35+(depthMm/150.0)*2.3+abs(depthMm-uKnobs.z)/140.0*0.9, 1.4, 4.0);",
    "    float axF=clamp(0.52+(depthMm/150.0)*0.42, 0.5, 1.0);",
    "    float sigL=latF/2.355, sigA=axF/2.355;",
    "    vec4 s=vec4(0.0); float wsum=0.0;",
    "    for(int i=-2;i<=2;i++){",
    "      for(int j=-1;j<=1;j++){",
    "        float wl=exp(-float(i*i)/(2.0*2.0)); float wa=exp(-float(j*j)/(2.0*1.2));",
    "        float w=wl*wa; vec3 wp=uOrigin+dir*(depthMm+float(j)*sigA)+uRight*(float(i)*sigL);",
    "        s+=sampleVol(undeform(wp))*w; wsum+=w;",
    "      }",
    "    }",
    "    s/=max(wsum,0.001);",
    "    float echo=s.r; float specF=s.g; float attF=s.b*4.0; float bloodF=s.a;",
    "    /* Beam march: attenuation and shadow behind bone / lung. */",
    "    float shadow=1.0; float att=0.0; float aLine=0.0; float ribAt=-1.0;",
    "    for(int k=1;k<=10;k++){",
    "      float dm=depthMm*(float(k)+0.5)/10.0;",
    "      vec4 sm=sampleVol(undeform(uOrigin+dir*dm));",
    "      float at=sm.b*4.0;",
    "      att+=at*(depthMm/10.0)/10.0;",
    "      if(at>2.4 && ribAt<0.0) ribAt=dm;",
    "      if(sm.b>0.7 && sm.r>0.45) aLine+=0.15;",
    "    }",
    "    if(ribAt>0.0 && depthMm>ribAt+3.0){",
    "      float behind=depthMm-ribAt;",
    "      shadow=behind<32.0 ? 0.06 : mix(0.06,1.0,clamp((behind-32.0)/34.0,0.0,1.0));",
    "    }",
    "    att=exp(-att*0.22);",
    "    /* Fully developed speckle: two independent smooth Gaussians",
    "       (I/Q). Grains elongated laterally, widening with depth. */",
    "    float foc=exp(-pow((depthMm-uKnobs.z)/32.0,2.0));",
    "    float latCell=(1.15-0.22*foc)+depthMm*0.0045;",
    "    float axCell=0.50+depthMm*0.0016;",
    "    vec2 sc=vec2(latMm/latCell, depthMm/axCell);",
    "    float gI=sgauss(sc,11.0)*0.85+sgauss(sc*2.35,102.0)*0.53;",
    "    float gQ=sgauss(sc,58.0)*0.85+sgauss(sc*2.35,149.0)*0.53;",
    "    float speck=sqrt(gI*gI+gQ*gQ)/1.2533;",
    "    float pixU=hash(vec3(floor(vUv*uRes), 17.0));",
    "    float pixSpeck=sqrt(-2.0*log(1.0-clamp(pixU,0.0,0.999)))/1.2533;",
    "    speck=speck*0.62+pixSpeck*0.38;",
    "    float smoke=bloodF>0.4 ? max(sgauss(vec2(latMm/6.5, depthMm/6.5-uTime*0.10),91.0),0.0)*0.012 : 0.0;",
    "    float lin;",
    "    if(bloodF>0.55) lin=echo*speck*0.95+smoke;",
    "    else lin=echo*speck;",
    "    if(echo>=0.70) lin*=1.55;",
    "    else if(echo>=0.28 && echo<=0.65) lin*=1.28;",
    "    lin+=specF*0.38*(0.35+0.65*speckleSafe(speck));",
    "    /* near-field clutter */",
    "    if(depthMm<22.0) lin+=pow(1.0-depthMm/22.0,2.0)*(0.045+0.03*speck);",
    "    /* lung A-lines: repeating bright arcs at the sector edges */",
    "    if(aLine>0.2 && abs(ang)>0.42){",
    "      float al=abs(fract(depthMm/14.0)-0.5);",
    "      lin+=smoothstep(0.08,0.02,al)*0.18*clamp(aLine,0.0,1.0);",
    "    }",
    "    lin*=att*shadow*tgcAt(depthMm);",
    "    float lossDb=0.55*2.0*(depthMm/10.0)*(0.06+clamp((depthMm-90.0)/60.0,0.0,1.0)*0.03);",
    "    lin*=pow(10.0,(8.0-lossDb)/20.0);",
    "    lin*=uKnobs.x;",
    "    /* Log compression. Dynamic range sets the curve. Soft knee. */",
    "    float dr=max(uKnobs.w,30.0);",
    "    float db=20.0*log(max(1e-5,lin))/log(10.0);",
    "    float grey=clamp(1.0+db/dr,0.0,1.0);",
    "    grey=pow(grey,0.90);",
    "    if(grey>0.74) grey=0.74+0.26*(1.0-exp(-(grey-0.74)/0.26));",
    "    grey*=smoothstep(2.0,7.0,depthMm);",
    "    grey*=smoothstep(halfA,halfA-0.028,abs(ang));",
    "    col=vec3(grey);",
    "    /* Depth ticks every 10 mm on the left of the fan. */",
    "    float tick=step(abs(fract(depthMm/10.0)-0.5),0.46)*step(abs(ang+halfA-0.018),0.007)*step(8.0,depthMm);",
    "    col=max(col,vec3(0.42)*tick);",
    "    /* Focus caret on the right. */",
    "    float fd=abs(depthMm-uKnobs.z);",
    "    if(fd<1.6 && abs(ang-halfA+0.03)<0.02) col=max(col,vec3(0.75));",
    "    col+=vec3((mod(gl_FragCoord.x+gl_FragCoord.y,2.0)-0.5)*0.018);",
    "  }",
    "  if(inStrip){",
    "    col=vec3(0.0);",
    "    float ph=fract(uPhase+vUv.x);",
    "    float yv=ecgH*(0.46+ecg(ph)*0.34);",
    "    col=mix(col,vec3(0.42,0.92,0.52),smoothstep(0.0045,0.0012,abs(vUv.y-yv)));",
    "  }",
    "  gl_FragColor=vec4(col,1.0); }",
    "float speckleSafe(float s){ return s; }"
  ].join("\n");

  /* The helper is declared after main in the string above, which WebGL1
   * GLSL ES 1.00 does not allow. Rebuild FRAG with the helper first. */
  FRAG = [
    "precision highp float;",
    "varying vec2 vUv;",
    "uniform sampler2D uAtlas;",
    "uniform vec3 uOrigin, uBeam, uRight, uNormal, uVolMin, uVolStep;",
    "uniform vec3 uDims; uniform float uCols, uPhase, uTime;",
    "uniform vec4 uKnobs;",
    "uniform float uTgc[8]; uniform vec2 uRes; uniform float uFps;",
    "float hash(vec3 p){ p=fract(p*vec3(443.897,441.423,437.195)); p+=dot(p,p.yzx+19.19); return fract((p.x+p.y)*p.z); }",
    "float sgauss(vec2 c, float seed){",
    "  vec2 i=floor(c); vec2 f=c-i; vec2 s=f*f*(3.0-2.0*f);",
    "  float v=mix(mix(hash(vec3(i,seed)),hash(vec3(i+vec2(1.0,0.0),seed)),s.x),",
    "              mix(hash(vec3(i+vec2(0.0,1.0),seed)),hash(vec3(i+vec2(1.0,1.0),seed)),s.x),s.y);",
    "  vec4 w=vec4((1.0-s.x)*(1.0-s.y), s.x*(1.0-s.y), (1.0-s.x)*s.y, s.x*s.y);",
    "  return (v-0.5)*sqrt(12.0/max(dot(w,w),0.001)); }",
    "vec3 undeform(vec3 p){",
    "  float t=fract(uPhase); float c;",
    "  if(t<0.32){ float u=t/0.32; c=u*u*(3.0-2.0*u); }",
    "  else { float v=(t-0.32)/0.68; c=1.0-v*v*(3.0-2.0*v)*0.92-0.08*sin(v*3.14159); }",
    "  vec3 lv=vec3(0.0,2.0,-3.0); vec3 d=p-lv; float dist=length(d);",
    "  if(dist<42.0){ float f=1.0+0.20*c*(1.0-dist/42.0); p=lv+(p-lv)/f; }",
    "  vec3 rv=vec3(-23.1,12.6,1.6); d=p-rv; dist=length(d);",
    "  if(dist<36.0){ float f=1.0+0.16*c*(1.0-dist/36.0); p=rv+(p-rv)/f; }",
    "  return p; }",
    "vec4 texSlice(vec3 p){",
    "  vec3 g=(p-uVolMin)/uVolStep;",
    "  float z=clamp(g.z,0.0,uDims.z-1.001); float z0=floor(z);",
    "  vec2 tile=vec2(mod(z0,uCols),floor(z0/uCols));",
    "  vec2 xy=clamp(g.xy,vec2(0.5),uDims.xy-1.5);",
    "  float atlasH=ceil(uDims.z/uCols)*uDims.y;",
    "  vec2 uv=(tile*uDims.xy+xy)/vec2(uCols*uDims.x, atlasH);",
    "  return texture2D(uAtlas,uv); }",
    "vec4 sampleVol(vec3 p){",
    "  vec3 g=(p-uVolMin)/uVolStep; float z0=floor(clamp(g.z,0.0,uDims.z-1.001)); float fz=fract(g.z);",
    "  vec3 pa=p; pa.z=uVolMin.z+z0*uVolStep.z; vec3 pb=pa; pb.z+=uVolStep.z;",
    "  return mix(texSlice(pa),texSlice(pb),clamp(fz,0.0,1.0)); }",
    "float tgcAt(float d){ float t=clamp(d/max(uKnobs.y,1.0),0.0,1.0)*7.0; int i=int(floor(t)); float f=t-float(i); float a=1.0; float b=1.0;",
    "  for(int k=0;k<8;k++){ if(k==i) a=uTgc[k]; if(k==i+1) b=uTgc[k]; } return mix(a,b,f); }",
    "float ecg(float ph){ float v=0.0;",
    "  v+=0.16*exp(-pow(ph-0.14,2.0)/0.00065);",
    "  v+=-0.14*exp(-pow(ph-0.285,2.0)/0.00007);",
    "  v+=1.00*exp(-pow(ph-0.30,2.0)/0.00013);",
    "  v+=-0.24*exp(-pow(ph-0.315,2.0)/0.00007);",
    "  v+=0.30*exp(-pow(ph-0.52,2.0)/0.0016); return v; }",
    "void main(){",
    "  float ecgH=0.12; float imgH=1.0-ecgH;",
    "  bool inStrip=vUv.y<ecgH;",
    "  vec2 px=vec2(vUv.x*uRes.x, (1.0-vUv.y)*uRes.y);",
    "  float imgHpx=uRes.y*imgH;",
    "  float apexX=uRes.x*0.5;",
    "  float apexY=4.0+imgHpx*0.025;",
    "  float scale=(imgHpx-apexY)*0.98/max(uKnobs.y,1.0);",
    "  float dx=px.x-apexX, dy=px.y-apexY;",
    "  float r=length(vec2(dx,dy));",
    "  float ang=atan(dx, max(dy,0.0001));",
    "  float halfA=0.70;",
    "  vec3 col=vec3(0.0);",
    "  if(!inStrip && dy>0.0 && abs(ang)<=halfA && r<=imgHpx-apexY){",
    "    float depthMm=r/max(scale,0.001);",
    "    float latMm=tan(ang)*depthMm;",
    "    vec3 dir=normalize(uBeam*cos(ang)+uRight*sin(ang));",
    "    float latF=clamp(1.35+(depthMm/150.0)*2.3+abs(depthMm-uKnobs.z)/140.0*0.9, 1.4, 4.0);",
    "    float axF=clamp(0.52+(depthMm/150.0)*0.42, 0.5, 1.0);",
    "    float sigL=latF/2.355, sigA=axF/2.355;",
    "    vec4 s=vec4(0.0); float wsum=0.0;",
    "    for(int i=-2;i<=2;i++){",
    "      for(int j=-1;j<=1;j++){",
    "        float wl=exp(-float(i*i)/(2.0*2.0)); float wa=exp(-float(j*j)/(2.0*1.2));",
    "        float w=wl*wa; vec3 wp=uOrigin+dir*(depthMm+float(j)*sigA)+uRight*(float(i)*sigL);",
    "        s+=sampleVol(undeform(wp))*w; wsum+=w;",
    "      }",
    "    }",
    "    s/=max(wsum,0.001);",
    "    float echo=s.r; float specF=s.g; float bloodF=s.a;",
    "    float shadow=1.0; float att=0.0; float aLine=0.0; float ribAt=-1.0;",
    "    for(int k=1;k<=10;k++){",
    "      float dm=depthMm*(float(k)+0.5)/10.0;",
    "      vec4 sm=sampleVol(undeform(uOrigin+dir*dm));",
    "      float at=sm.b*4.0;",
    "      att+=at*(depthMm/10.0)/10.0;",
    "      if(at>2.4 && ribAt<0.0) ribAt=dm;",
    "      if(sm.b>0.7 && sm.r>0.45) aLine+=0.15;",
    "    }",
    "    if(ribAt>0.0 && depthMm>ribAt+3.0){",
    "      float behind=depthMm-ribAt;",
    "      shadow=behind<32.0 ? 0.06 : mix(0.06,1.0,clamp((behind-32.0)/34.0,0.0,1.0));",
    "    }",
    "    att=exp(-att*0.22);",
    "    float foc=exp(-pow((depthMm-uKnobs.z)/32.0,2.0));",
    "    float latCell=(1.15-0.22*foc)+depthMm*0.0045;",
    "    float axCell=0.50+depthMm*0.0016;",
    "    vec2 sc=vec2(latMm/latCell, depthMm/axCell);",
    "    float gI=sgauss(sc,11.0)*0.85+sgauss(sc*2.35,102.0)*0.53;",
    "    float gQ=sgauss(sc,58.0)*0.85+sgauss(sc*2.35,149.0)*0.53;",
    "    float speck=sqrt(gI*gI+gQ*gQ)/1.2533;",
    "    float pixU=hash(vec3(floor(vUv*uRes), 17.0));",
    "    float pixSpeck=sqrt(-2.0*log(1.0-clamp(pixU,0.0,0.999)))/1.2533;",
    "    speck=speck*0.62+pixSpeck*0.38;",
    "    float smoke=bloodF>0.4 ? max(sgauss(vec2(latMm/6.5, depthMm/6.5-uTime*0.10),91.0),0.0)*0.010 : 0.0;",
    "    float lin;",
    "    if(bloodF>0.55) lin=echo*speck*0.95+smoke;",
    "    else lin=echo*speck;",
    "    if(echo>=0.62) lin*=1.40;",
    "    else if(echo>=0.28 && echo<=0.55) lin*=1.12;",
    "    lin+=specF*0.28*(0.30+0.70*speck);",
    "    if(depthMm<20.0) lin+=pow(1.0-depthMm/20.0,2.0)*(0.035+0.02*speck);",
    "    if(aLine>0.2 && abs(ang)>0.45){",
    "      float al=abs(fract(depthMm/14.0)-0.5);",
    "      lin+=smoothstep(0.07,0.02,al)*0.12*clamp(aLine,0.0,1.0);",
    "    }",
    "    lin*=att*shadow*(0.92+0.12*tgcAt(depthMm));",
    "    float fall=0.02+0.05*clamp((depthMm-110.0)/50.0,0.0,1.0);",
    "    lin*=exp(-fall*depthMm/55.0)*uKnobs.x;",
    "    float grey=pow(clamp(lin,0.0,3.0),0.82);",
    "    if(grey>0.72) grey=0.72+0.28*(1.0-exp(-(grey-0.72)/0.28));",
    "    grey=clamp(grey,0.0,1.0);",
    "    grey*=smoothstep(2.0,7.0,depthMm);",
    "    grey*=smoothstep(halfA,halfA-0.028,abs(ang));",
    "    col=vec3(grey);",
    "    float tick=step(abs(fract(depthMm/10.0)-0.5),0.04)*step(abs(ang+halfA-0.018),0.012)*step(8.0,depthMm);",
    "    col=max(col,vec3(0.42)*tick);",
    "    float fd=abs(depthMm-uKnobs.z);",
    "    if(fd<1.6 && abs(ang-halfA+0.03)<0.02) col=max(col,vec3(0.75));",
    "    col+=vec3((mod(gl_FragCoord.x+gl_FragCoord.y,2.0)-0.5)*0.012);",
    "  }",
    "  if(inStrip){",
    "    col=vec3(0.0);",
    "    float ph=fract(uPhase+vUv.x);",
    "    float yv=ecgH*(0.46+ecg(ph)*0.34);",
    "    col=mix(col,vec3(0.42,0.92,0.52),smoothstep(0.0045,0.0012,abs(vUv.y-yv)));",
    "  }",
    "  gl_FragColor=vec4(col,1.0); }"
  ].join("\n");

  function compile(gl, type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
    return s;
  }
  function create(canvas) {
    var gl = canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: true }) ||
      canvas.getContext("experimental-webgl");
    if (!gl) throw new Error("WebGL is not available on this device");
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("B-mode shader failed to link");
    gl.useProgram(prog);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "aPos"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {};
    ["uAtlas", "uOrigin", "uBeam", "uRight", "uNormal", "uVolMin", "uVolStep", "uDims", "uCols", "uPhase", "uTime", "uKnobs", "uRes", "uFps"].forEach(function (n) {
      U[n] = gl.getUniformLocation(prog, n);
    });
    U.uTgc = gl.getUniformLocation(prog, "uTgc[0]");
    var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var state = {
      pose: null, phase: 0,
      knobs: { gain: 1.25, depthMm: 160, focusMm: 70, dynamicRange: 55 },
      tgc: [1.05, 1.08, 1.12, 1.15, 1.18, 1.22, 1.28, 1.34],
      vol: null, frames: 0, fps: 0, lastFpsT: (typeof performance !== "undefined" ? performance.now() : 0)
    };
    function setVolume(atlas) {
      state.vol = atlas;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, atlas.width, atlas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas.rgba);
      gl.uniform3f(U.uVolMin, atlas.min[0], atlas.min[1], atlas.min[2]);
      gl.uniform3f(U.uVolStep, atlas.step[0], atlas.step[1], atlas.step[2]);
      gl.uniform3f(U.uDims, atlas.dims[0], atlas.dims[1], atlas.dims[2]);
      gl.uniform1f(U.uCols, atlas.cols);
    }
    function setPose(pose) { state.pose = pose; }
    function setPhase(t) { state.phase = t; }
    function setKnobs(k) {
      if (!k) return;
      ["gain", "depthMm", "focusMm", "dynamicRange"].forEach(function (key) {
        if (typeof k[key] === "number") state.knobs[key] = k[key];
      });
      if (typeof k.depth === "number") state.knobs.depthMm = k.depth;
      if (k.depthCm) state.knobs.depthMm = k.depthCm * 10;
      if (k.focus) state.knobs.focusMm = k.focus;
      if (k.tgc) state.tgc = k.tgc.slice(0, 8);
    }
    function resize() {
      var w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    function render(now) {
      resize();
      if (!state.vol || !state.pose) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
      var V = G.KARDIA_SIM_VOLUME;
      if (!V) throw new Error("kardia-sim-volume.js must load first");
      var pl = V.poseToPlane(state.pose);
      gl.useProgram(prog);
      gl.uniform3f(U.uOrigin, pl.origin[0], pl.origin[1], pl.origin[2]);
      gl.uniform3f(U.uBeam, pl.beam[0], pl.beam[1], pl.beam[2]);
      gl.uniform3f(U.uRight, pl.right[0], pl.right[1], pl.right[2]);
      gl.uniform3f(U.uNormal, pl.normal[0], pl.normal[1], pl.normal[2]);
      gl.uniform1f(U.uPhase, state.phase);
      gl.uniform1f(U.uTime, (now || 0) / 1000);
      gl.uniform4f(U.uKnobs, state.knobs.gain, state.knobs.depthMm, state.knobs.focusMm, state.knobs.dynamicRange);
      gl.uniform1fv(U.uTgc, new Float32Array(state.tgc));
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uFps, state.fps);
      gl.uniform1i(U.uAtlas, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      state.frames++;
      var t = typeof performance !== "undefined" ? performance.now() : 0;
      if (t - state.lastFpsT >= 500) {
        state.fps = Math.round(state.frames * 1000 / (t - state.lastFpsT));
        state.frames = 0; state.lastFpsT = t;
      }
    }
    return {
      setVolume: setVolume, setPose: setPose, setPhase: setPhase, setKnobs: setKnobs,
      render: render, resize: resize,
      get fps() { return state.fps; }, get knobs() { return state.knobs; }, gl: gl
    };
  }
  function compileCheck(gl) {
    compile(gl, gl.VERTEX_SHADER, VERT);
    compile(gl, gl.FRAGMENT_SHADER, FRAG);
    return true;
  }
  var API = { create: create, VERT: VERT, FRAG: FRAG, _compileCheck: compileCheck, shaderSources: { vertex: VERT, fragment: FRAG } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.KARDIA_BMODE_GL = API;
})(typeof window !== "undefined" ? window : globalThis);
