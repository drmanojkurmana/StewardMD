#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform sampler2D heartTexture;
uniform sampler2D vesselTexture;
uniform sampler2DArray patchTexture;
uniform float patchOpening;
uniform vec4 u[25];
uniform vec2 resolution;
uniform vec2 sectorLimit;
uniform int aortaSourceCount;
uniform int protectedSourceCount;
uniform vec4 aortaSourceMin[16];
uniform vec4 aortaSourceMax[16];
uniform vec4 protectedSourceMin[16];
uniform vec4 protectedSourceMax[16];
out vec4 fragment;

bool withinSource(vec3 p, vec3 low, vec3 high) {
 return all(greaterThanEqual(p,low)) && all(lessThanEqual(p,high));
}
bool descendingAortaOwnsBlood(vec3 rest) {
 bool covered=false;
 for(int i=0;i<16;i++) {
  if(i>=aortaSourceCount)break;
  if(withinSource(rest,aortaSourceMin[i].xyz,aortaSourceMax[i].xyz))covered=true;
 }
 if(!covered)return false;
 for(int i=0;i<16;i++) {
  if(i>=protectedSourceCount)break;
  if(withinSource(rest,protectedSourceMin[i].xyz,protectedSourceMax[i].xyz))return false;
 }
 return true;
}
vec4 readAtlas(sampler2D atlas,ivec2 pixel){
 vec4 value=texelFetch(atlas,pixel,0);
 if(textureSize(atlas,0).x!=4096)return value;
 ivec3 voxel=ivec3(pixel.y%256,pixel.x%256,(pixel.y/256)*16+pixel.x/256)-ivec3(92,113,106);
 if(any(lessThan(voxel,ivec3(0)))||any(greaterThanEqual(voxel,ivec3(41,38,35))))return value;
 ivec2 p=ivec2((voxel.z%6)*38+voxel.y,(voxel.z/6)*41+voxel.x);
 float phase=clamp(patchOpening,0.0,1.0)*4.0;
 int low=int(floor(phase)),high=min(low+1,4);float weight=fract(phase);
 vec4 a=texelFetch(patchTexture,ivec3(p,low),0),b=texelFetch(patchTexture,ivec3(p,high),0);
 value=a;if(weight>=1.0)value=b;
 else if(weight>0.0){value.r=mix(a.r,b.r,weight);int ai=int(a.g*255.0+.5),bi=int(b.g*255.0+.5);if(ai!=bi){int other=ai==12?bi:ai;value.g=value.r>0.0?12.0/255.0:float(other)/255.0;}}
 return value;
}

































float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += vec2(dot(p, p + 45.32));
    return fract(p.x * p.y);
}



















uvec3 pcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v;
}

float hashLattice(vec3 i) {
    uvec3 u = uvec3(ivec3(i) + ivec3(0x100000));
    return float(pcg3d(u).x) * (1.0 / 4294967296.0);
}

float valueNoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float x00 = mix(hashLattice(i), hashLattice(i + vec3(1,0,0)), f.x);
    float x10 = mix(hashLattice(i + vec3(0,1,0)), hashLattice(i + vec3(1,1,0)), f.x);
    float x01 = mix(hashLattice(i + vec3(0,0,1)), hashLattice(i + vec3(1,0,1)), f.x);
    float x11 = mix(hashLattice(i + vec3(0,1,1)), hashLattice(i + vec3(1,1,1)), f.x);
    return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}

float valueNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}













vec4 tissueStyle(int idx) {
    switch (idx) {
        case 1:  return vec4(1.00, 1.00, 0.55, 0.75);
        case 2:  return vec4(1.05, 0.90, 0.30, 0.70);
        case 3:
        case 4:  return vec4(0.80, 0.80, 0.00, 0.65);
        case 5:  return vec4(0.90, 1.20, 0.90, 0.80);
        case 6:
        case 7:  return vec4(0.80, 0.80, 0.00, 0.35);
        case 8:
        case 9:  return vec4(0.80, 0.80, 0.00, 0.40);
        case 14: return vec4(0.90, 1.00, 0.00, 0.60);
        case 15:
        case 16:
        case 17: return vec4(0.80, 0.80, 0.00, 0.40);
        case 21: return vec4(0.85, 0.85, 0.00, 0.70);
        default: return vec4(0.60, 0.60, 0.00, 0.30);
    }
}




















vec4 tissueLook(int idx) {
    switch (idx) {
        case 1:  return vec4(1.00, 1.00, 0.0, 0.22);
        case 2:  return vec4(0.95, 1.00, 0.0, 0.18);
        case 3:
        case 4:  return vec4(0.90, 0.95, 0.0, 0.10);
        case 5:  return vec4(1.15, 1.00, 0.0, 0.25);
        case 6:
        case 7:  return vec4(0.90, 1.60, 1.0, 0.00);
        case 8:  return vec4(0.85, 1.35, 1.0, 0.00);
        case 9:  return vec4(0.80, 1.20, 1.0, 0.00);
        case 14: return vec4(1.40, 0.80, 0.0, 0.08);
        case 15:
        case 16: return vec4(0.65, 0.85, 1.0, 0.00);
        case 17: return vec4(0.40, 0.45, 1.0, 0.00);
        case 21: return vec4(1.00, 0.30, 0.0, 0.14);
        default: return vec4(1.10, 1.20, 0.7, 0.00);
    }
}




const int BLOOD_INDEX = 20;
const int BODY_INDEX = 21;


const float HEART_DISTANCE_UNIT = 0.0001;



const float BODY_ECHO = 0.36;








































































float sstep(float e0, float e1, float x)
{
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}












vec3 valveInverse(vec3 p, vec4 hinge, vec4 axis, float open)
{
    float theta = clamp(open, 0.0, 1.0) * axis.w;
    float R = hinge.w;
    if (theta < 0.002 || R < 1e-4) return p;
    vec3 c = hinge.xyz;
    vec3 n = normalize(axis.xyz);
    vec3 d = p - c;
    float h = dot(d, n);
    vec3 radial = d - h * n;
    float rr = length(radial);
    if (rr < 1e-5 || rr > R * 1.15 || h < -R * 0.25 || h > R * 1.25) return p;
    vec3 u = radial / rr;
    vec3 attach = c + u * R;
    vec3 t = normalize(cross(n, u));
    vec3 q = p - attach;
    float cs = cos(theta), sn = sin(theta);


    vec3 back = q * cs - cross(t, q) * sn + t * dot(t, q) * (1.0 - cs);
    float w = (1.0 - sstep(R * 0.92, R * 1.15, rr))
            * (1.0 - sstep(R * 1.0, R * 1.25, h))
            * sstep(-R * 0.25, -R * 0.05, h);
    return mix(p, attach + back, w);
}






























vec3 beatInverse(vec3 p, vec4 heartApex, vec4 heartAxis,
                          vec4 heartBeat, float outside)
{
    float k = heartBeat.x * (1.0 - sstep(0.004, 0.018, outside));
    if (k <= 0.0) return p;

    vec3 apex = heartApex.xyz;
    float L = max(heartApex.w, 1e-4);
    vec3 a = normalize(heartAxis.xyz);

    vec3 d = p - apex;
    float s = dot(d, a);
    vec3 rv = d - s * a;
    float r = length(rv);

    float amp = k * sstep(0.95 * L, 0.55 * L, s) * sstep(-0.02 * L, 0.08 * L, s);
    float s0 = s * (1.0 + heartBeat.y * amp);
    float taper = mix(1.0, heartBeat.w, clamp(r / (0.5 * L), 0.0, 1.0));
    float r0 = r * (1.0 + heartBeat.z * amp * taper);

    return apex + s0 * a + rv * (r0 / max(r, 1e-6));
}

































vec3 maneuverInverse(vec3 p, vec4 heartApex, vec4 heartAxis,
                              vec4 manA, vec4 cavaA, vec4 cavaB)
{






    p -= vec3(0.0, manA.y, 0.0);






    vec3 dir = vec3(cavaA.w, cavaB.x, cavaB.y);
    float rIn = cavaB.z, rOut = cavaB.w;
    bool hasCava = (rOut > rIn + 1e-5) && (length(dir) > 1e-5);
    vec3 d = hasCava ? normalize(dir) : vec3(0.0, 1.0, 0.0);
    float wCava = 0.0;
    if (hasCava) {
        vec3 v = p - cavaA.xyz;
        wCava = sstep(rOut, rIn, length(v - dot(v, d) * d));
    }




























    float s = manA.x;
    if (abs(s - 1.0) > 1e-4) {
        float eff = 1.0 + (s - 1.0) * (1.0 - wCava);
        if (abs(eff - 1.0) > 1e-5) {
            eff = max(eff, 0.2);
            vec3 a = normalize(heartAxis.xyz);
            vec3 c = heartApex.xyz + 0.5 * max(heartApex.w, 1e-4) * a;
            p = c + (p - c) / eff;
        }
    }





































    float collapse = manA.z;
    if (hasCava && abs(collapse) > 1e-4) {
        vec3 v = p - cavaA.xyz;
        vec3 q = v - dot(v, d) * d;
        float r = length(q);
        float far = r / max(1.0 - collapse, 0.2);
        float lo = min(r, far), hi = max(r, far);
        for (int i = 0; i < 8; ++i) {
            float mid = 0.5 * (lo + hi);
            float fwd = mid * (1.0 - collapse * sstep(rOut, rIn, mid));
            if (fwd < r) { lo = mid; } else { hi = mid; }
        }
        float r0 = 0.5 * (lo + hi);
        p += q * (r0 / max(r, 1e-6) - 1.0);
    }

    return p;
}


vec3 restingPoint(vec3 p, vec4 heartApex, vec4 heartAxis,
                           vec4 heartBeat, vec4 manA,
                           vec4 cavaA, vec4 cavaB, float outside)
{
    return maneuverInverse(beatInverse(p, heartApex, heartAxis, heartBeat, outside),
                           heartApex, heartAxis, manA, cavaA, cavaB);
}




float heartDistanceAt(sampler2D vol, vec3 p, vec4 volBox, vec4 volGrid)
{
    float n = volGrid.x, cols = volGrid.y;
    float pitch = volBox.w / n;
    vec3 g = (p - volBox.xyz) / pitch;
    if (any(lessThan(g,vec3(0.0))) || any(greaterThan(g,vec3(n-1.0)))) return 255.0 * HEART_DISTANCE_UNIT;
    vec3 f = floor(g + 0.5);
    float row = floor(f.z / cols), col = f.z - row * cols;
    uvec2 px = uvec2(uint(col * n + f.y), uint(row * n + f.x));
    return float(readAtlas(vol, ivec2(px)).b) * 255.0 * HEART_DISTANCE_UNIT;
}







vec2 volumeAt(sampler2D vol, vec3 p, vec4 volBox, vec4 volGrid,
                      bool omitCapsule, bool omitVessels)
{
    float n = volGrid.x, cols = volGrid.y;
    float pitch = volBox.w / n;
    vec3 g = (p - volBox.xyz) / pitch;
    if (any(lessThan(g,vec3(0.0))) || any(greaterThan(g,vec3(n-1.0)))) return vec2(0.0);

    vec3 f = floor(g), t = g - f;
    vec2 acc = vec2(0.0);
    for (int dz = 0; dz < 2; ++dz) {
        float z = clamp(f.z + float(dz), 0.0, n - 1.0);
        float row = floor(z / cols), col = z - row * cols;
        vec2 plane = vec2(0.0);
        for (int dy = 0; dy < 2; ++dy) {
            for (int dx = 0; dx < 2; ++dx) {
                float xi = clamp(f.x + float(dx), 0.0, n - 1.0);
                float yi = clamp(f.y + float(dy), 0.0, n - 1.0);

                uvec2 px = uvec2(uint(col * n + yi), uint(row * n + xi));
                vec2 v = readAtlas(vol, ivec2(px)).rg;



                int index = int(float(v.y) * 255.0 + 0.5);
                if ((omitCapsule && index == 14)
                    || (omitVessels && (index == 8 || index == 15))) v.x = 0.0;
                float w = (dx == 0 ? 1.0 - t.x : t.x) * (dy == 0 ? 1.0 - t.y : t.y);
                plane += v * float(w);
            }
        }
        acc += plane * float(dz == 0 ? 1.0 - t.z : t.z);
    }
    return acc;
}



vec2 volumeAt(sampler2D vol,vec3 p,vec4 box,vec4 grid){return volumeAt(vol,p,box,grid,false,false);}
vec3 vesselAt(sampler2D vol, vec3 p, vec4 box, vec4 grid)
{
    if (box.w <= 0.0) return vec3(0.0);
    vec3 g = (p - box.xyz) / box.w;
    if (any(lessThan(g,vec3(0.0))) || any(greaterThan(g,grid.xyz-1.0))) return vec3(0.0);
    vec3 f = floor(g), t = g - f, result = vec3(0.0);
    float offsetY = float(textureSize(vol,0).y) - ceil(grid.z / grid.w) * grid.x;
    for (int dz = 0; dz < 2; ++dz) {
        float z = min(f.z + float(dz), grid.z - 1.0);
        float row = floor(z / grid.w), col = z - row * grid.w;
        for (int dy = 0; dy < 2; ++dy) {
            for (int dx = 0; dx < 2; ++dx) {
                float x = min(f.x + float(dx), grid.x - 1.0);
                float y = min(f.y + float(dy), grid.y - 1.0);
                float weight = (dx == 0 ? 1.0-t.x : t.x)
                    * (dy == 0 ? 1.0-t.y : t.y) * (dz == 0 ? 1.0-t.z : t.z);
                result += vec3(readAtlas(vol, ivec2(uvec2(uint(col*grid.y+y), uint(offsetY+row*grid.x+x)))).rgb) * weight;
            }
        }
    }
    return result;
}

float vesselEcho(vec3 field) { return dot(field.xy, vec2(0.44, 0.42)); }

float combinedTissue(sampler2D vol, vec3 rest,
                            vec4 volBox, vec4 volGrid,
                            sampler2D liverVol, vec3 liverRest,
                            vec4 liverBox, vec4 liverGrid,
                            vec4 vesselBox, vec4 vesselGrid)
{



    vec3 vessel = vesselAt(liverVol, rest, vesselBox, vesselGrid);
    float heart = float(volumeAt(vol, rest, volBox, volGrid, liverGrid.w > 0.0, vesselBox.w > 0.0).x);
    float liver = liverGrid.w > 0.0
        ? 0.40 * float(volumeAt(liverVol, liverRest, liverBox, liverGrid).x) : 0.0;
    liver *= 1.0 - clamp(vessel.x + vessel.y + vessel.z, 0.0, 1.0);
    return max(max(heart, liver), vesselEcho(vessel));
}

struct TissueLook {
    vec4 style; vec4 look;

    float blood;

    float body;
};




TissueLook looksAt(sampler2D vol, vec3 p, vec4 box, vec4 grid,
                          bool omitCapsule, bool omitVessels)
{
    TissueLook result;
    result.style = tissueStyle(BODY_INDEX);
    result.look = tissueLook(BODY_INDEX);
    result.blood = 0.0;
    result.body = 1.0;
    float n = grid.x, cols = grid.y;
    vec3 g = (p - box.xyz) / (box.w / n);
    if (any(lessThan(g,vec3(0.0))) || any(greaterThan(g,vec3(n-1.0)))) return result;
    vec3 f = floor(g), t = g - f;
    vec4 style = vec4(0.0), look = vec4(0.0);
    float weight = 0.0, blood = 0.0, body = 0.0;
    for (int dz = 0; dz < 2; ++dz) {
        float z = min(f.z + float(dz), n - 1.0);
        float row = floor(z / cols), col = z - row * cols;
        for (int dy = 0; dy < 2; ++dy) {
            for (int dx = 0; dx < 2; ++dx) {
                float x = min(f.x + float(dx), n - 1.0);
                float y = min(f.y + float(dy), n - 1.0);
                vec2 value = readAtlas(vol, ivec2(uvec2(uint(col*n+y), uint(row*n+x)))).rg;
                int idx = int(float(value.y) * 255.0 + 0.5);
                float tri = (dx == 0 ? 1.0-t.x : t.x)
                    * (dy == 0 ? 1.0-t.y : t.y) * (dz == 0 ? 1.0-t.z : t.z);
                if (omitCapsule && idx == 14) idx = 0;
                if (omitVessels && (idx == 8 || idx == 15)) idx = 0;
                if (idx == BLOOD_INDEX) { blood += tri; continue; }


                float e = idx == 0 ? BODY_ECHO : float(value.x);
                if (idx == 0) { body += tri; idx = BODY_INDEX; }
                float w = e * tri;
                style += tissueStyle(idx) * w;
                look += tissueLook(idx) * w;
                weight += w;
            }
        }
    }
    if (weight > 1e-6) {
        result.style = style / weight;
        result.look = look / weight;
    }
    result.blood = blood;
    result.body = body;
    return result;
}




float liverBloodAt(sampler2D vol, vec3 p, vec4 box, vec4 grid)
{
    float n = grid.x, cols = grid.y;
    vec3 g = (p - box.xyz) / (box.w / n);
    if (any(lessThan(g,vec3(0.0))) || any(greaterThan(g,vec3(n-1.0)))) return 0.0;
    vec3 f = floor(g), t = g - f;
    float blood = 0.0;
    for (int dz = 0; dz < 2; ++dz) {
        float z = min(f.z + float(dz), n - 1.0);
        float row = floor(z / cols), col = z - row * cols;
        for (int dy = 0; dy < 2; ++dy) {
            for (int dx = 0; dx < 2; ++dx) {
                float x = min(f.x + float(dx), n - 1.0);
                float y = min(f.y + float(dy), n - 1.0);
                vec2 value = readAtlas(vol, ivec2(uvec2(uint(col*n+y), uint(row*n+x)))).rg;
                if (int(float(value.y) * 255.0 + 0.5) == BLOOD_INDEX) {
                    blood += (dx == 0 ? 1.0-t.x : t.x) * (dy == 0 ? 1.0-t.y : t.y)
                           * (dz == 0 ? 1.0-t.z : t.z);
                }
            }
        }
    }
    return blood;
}

vec4 bmodeSample(vec2 pos,
                           vec4 geometry,
                           vec4 planeO,
                           vec4 planeU,
                           vec4 planeV,
                           vec4 volBox,
                           vec4 volGrid,
                           vec4 heartApex,
                           vec4 heartBeat,
                           vec4 heartAxis,
                           vec4 manA,
                           vec4 cavaA,
                           vec4 cavaB,
                           vec4 liverBox,
                           vec4 liverGrid,
                           vec4 vesselBox,
                           vec4 vesselGrid,
                           vec4 valveOpen,
                           vec4 mvHinge,
                           vec4 mvAxis,
                           vec4 tvHinge,
                           vec4 tvAxis,
                           vec4 avHinge,
                           vec4 avAxis,
                           vec4 pvHinge,
                           vec4 pvAxis,
                           sampler2D vol,
                           sampler2D liverVol)
{
    vec2 apex = geometry.xy;
    float pxPerMetre = geometry.z;
    float depthMetres = geometry.w;

    vec2 d = pos - apex;
    float r = max(length(d), 1.0);
    vec2 beam = d / r;






    vec3 world = planeO.xyz
                 + planeU.xyz * (d.x / pxPerMetre)
                 + planeV.xyz * (d.y / pxPerMetre);





    float outside = heartDistanceAt(vol, world, volBox, volGrid);
    vec3 rest = restingPoint(world, heartApex, heartAxis, heartBeat,
                               manA, cavaA, cavaB, outside);


    rest = valveInverse(rest, mvHinge, mvAxis, valveOpen.x);
    rest = valveInverse(rest, tvHinge, tvAxis, valveOpen.y);
    rest = valveInverse(rest, avHinge, avAxis, valveOpen.z);
    rest = valveInverse(rest, pvHinge, pvAxis, valveOpen.w);





    vec3 liverRest = maneuverInverse(world, heartApex, heartAxis,
                                      vec4(1.0, manA.y, manA.z, 0.0), cavaA, cavaB);
    vec3 vessel = vesselAt(liverVol, rest, vesselBox, vesselGrid);
    float vesselOccupancy = clamp(vessel.x + vessel.y + vessel.z, 0.0, 1.0);
    float vesselTissue = vesselEcho(vessel);
    float heartTissue = float(volumeAt(vol, rest, volBox, volGrid, liverGrid.w > 0.0, vesselBox.w > 0.0).x);
    float liverTissue = liverGrid.w > 0.0
        ? 0.40 * float(volumeAt(liverVol, liverRest, liverBox, liverGrid).x) : 0.0;
    liverTissue *= 1.0 - vesselOccupancy;
    float tissue = max(max(heartTissue, liverTissue), vesselTissue);
    bool inLiver = liverTissue > heartTissue && liverTissue > 0.001;






















    float step = 1.6 * volBox.w / volGrid.x;
    float txp = combinedTissue(vol, rest + vec3(step, 0, 0), volBox, volGrid,
                               liverVol, liverRest + vec3(step, 0, 0), liverBox, liverGrid,
                               vesselBox, vesselGrid);
    float txm = combinedTissue(vol, rest - vec3(step, 0, 0), volBox, volGrid,
                               liverVol, liverRest - vec3(step, 0, 0), liverBox, liverGrid,
                               vesselBox, vesselGrid);
    float typ = combinedTissue(vol, rest + vec3(0, step, 0), volBox, volGrid,
                               liverVol, liverRest + vec3(0, step, 0), liverBox, liverGrid,
                               vesselBox, vesselGrid);
    float tym = combinedTissue(vol, rest - vec3(0, step, 0), volBox, volGrid,
                               liverVol, liverRest - vec3(0, step, 0), liverBox, liverGrid,
                               vesselBox, vesselGrid);
    float tzp = combinedTissue(vol, rest + vec3(0, 0, step), volBox, volGrid,
                               liverVol, liverRest + vec3(0, 0, step), liverBox, liverGrid,
                               vesselBox, vesselGrid);
    float tzm = combinedTissue(vol, rest - vec3(0, 0, step), volBox, volGrid,
                               liverVol, liverRest - vec3(0, 0, step), liverBox, liverGrid,
                               vesselBox, vesselGrid);
    vec3 grad = vec3(txp - txm, typ - tym, tzp - tzm);



    vec3 curvature = vec3(txp + txm, typ + tym, tzp + tzm) - 2.0 * tissue;














    const float gradientToUnit = 5.1;
    float gradientMagnitude = length(grad);
    vec3 beam3 = normalize(planeU.xyz * beam.x + planeV.xyz * beam.y);
    float gm = gradientMagnitude * gradientToUnit;









    float align = (gradientMagnitude > 1e-4)
        ? abs(dot(grad / gradientMagnitude, beam3)) : 0.0;
    float specular = clamp(gm, 0.0, 1.0) * (0.04 + 0.96 * pow(align, 2.0));











    vec3 ridgeAxes = max(-curvature, 0.0);
    float ridgeSum = ridgeAxes.x + ridgeAxes.y + ridgeAxes.z;
    vec3 normalSquared = ridgeSum > 1e-5 ? ridgeAxes / ridgeSum : vec3(1.0 / 3.0);
    float ridgeAlign = dot(normalSquared, beam3 * beam3);
    float ridge = clamp(ridgeSum * 1.0, 0.0, 1.0) * (0.15 + 0.85 * ridgeAlign);
























    TissueLook tl = looksAt(vol, rest, volBox, volGrid, liverGrid.w > 0.0, vesselBox.w > 0.0);
    // The legacy blood class contains a convex-hull cap outside the descending
    // aortic wall. Only in its unambiguous native source domain, let the newer
    // vessel lumen own blood and restore ordinary body scatter outside it.
    // Protected source bounds retain all adjacent cardiac/vessel blood.
    if(vesselBox.w > 0.0 && descendingAortaOwnsBlood(rest)) {
        float retainedBlood=min(tl.blood,vessel.z);
        tl.body += tl.blood-retainedBlood;
        tl.blood=retainedBlood;
    }
    float liverShare = liverTissue / max(heartTissue + liverTissue, 1e-6);
    vec4 style = mix(tl.style, tissueStyle(14), liverShare);
    vec4 look  = mix(tl.look,  tissueLook(14),  liverShare);
    float vesselShare = vesselTissue / max(heartTissue + liverTissue + vesselTissue, 1e-6);
    float cavalShare = vessel.y / max(vessel.x + vessel.y, 1e-6);
    style = mix(style, mix(tissueStyle(8), tissueStyle(15), cavalShare), vesselShare);
    look = mix(look, mix(tissueLook(8), tissueLook(15), cavalShare), vesselShare);

    float depth = clamp(r / max(pxPerMetre * depthMetres, 1.0), 0.0, 1.0);
    float rMetres = r / pxPerMetre;










    float liverBlood = liverGrid.w > 0.0 ? liverBloodAt(liverVol, liverRest, liverBox, liverGrid) : 0.0;
    float liverOccupancy = liverGrid.w > 0.0 ? liverTissue / 0.40 : 0.0;
    float blood = clamp(max(max(tl.blood, liverBlood), vessel.z), 0.0, 1.0);
    float body = clamp(tl.body - liverOccupancy - liverBlood, 0.0, 1.0)
               * (1.0 - blood) * (1.0 - vesselOccupancy);
    body *= mix(1.0, 0.55, sstep(0.55, 1.0, depth));


    float wall = sstep(0.028, 0.014, rMetres);
    float planes = 0.5 + 0.5 * cos(rMetres * 6.2832 / 0.0045 + 0.4);
    float bodyEcho = BODY_ECHO * (1.0 + 0.55 * wall * planes);




    float nearHeart = max(max(max(txp, txm), max(typ, tym)), max(tzp, tzm));
    float pericardium = body * sstep(0.10, 0.30, nearHeart);

    vec2 lat2 = vec2(-beam.y, beam.x);
    vec3 lat3 = normalize(planeU.xyz * lat2.x + planeV.xyz * lat2.y);
    vec3 elev3 = normalize(cross(beam3, lat3));



    float axialCell   = max(0.00085 * style.x, 1.6 / pxPerMetre);
    float lateralCell = max(0.0032 * style.y * (0.80 + 0.45 * depth), 3.0 / pxPerMetre);
    const float elevCell = 0.0015;

    vec3 materialPoint = inLiver && liverTissue > vesselTissue ? liverRest : rest;
    vec3 q = vec3(dot(materialPoint, beam3)  / axialCell,
                      dot(materialPoint, lat3)   / lateralCell,
                      dot(materialPoint, elev3)  / elevCell);
    float ct = cos(style.z), st = sin(style.z);
    q.xy = vec2(q.x * ct - q.y * st, q.x * st + q.y * ct);















    const float c2 = 0.8253, s2 = 0.5646;
    const float c3 = 0.6216, s3 = -0.7833;
    float g1 = 0.0, g2 = 0.0;
    for (int tap = -1; tap <= 1; ++tap) {
        vec3 qt = q + vec3(0.0, 0.42 * float(tap), 0.0);
        vec3 q2 = vec3(qt.x * c2 - qt.y * s2, qt.x * s2 + qt.y * c2, qt.z);
        vec3 q3 = vec3(qt.x * c3 - qt.y * s3, qt.x * s3 + qt.y * c3, qt.z);
        g1 += 0.38 * (valueNoise3(q2 * 0.5 + vec3(3.1, 7.7, 1.3)) - 0.5)
            +        (valueNoise3(qt) - 0.5)
            + 0.22 * (valueNoise3(q3 * 2.0 + vec3(17.3, 5.1, 29.7)) - 0.5);
        g2 += 0.38 * (valueNoise3(q2 * 0.5 + vec3(9.4, 2.2, 5.8)) - 0.5)
            +        (valueNoise3(qt + vec3(41.7, 9.2, 73.1)) - 0.5)
            + 0.22 * (valueNoise3(q3 * 2.0 + vec3(5.9, 61.3, 11.7)) - 0.5);
    }
    g1 /= 3.0; g2 /= 3.0;




    float envelope = min(length(vec2(g1, g2)) * 2.45 * 1.22, 3.0);
    float speckle = mix(1.0, envelope, style.w);



    float layering = 1.0 + look.w * 2.0 * (valueNoise3(materialPoint / 0.007) - 0.5);





    float atten = mix(1.0, 0.68, depth);





    float floorNoise = 0.008 * speckle * sstep(0.002, 0.06, tissue)
                     + 0.014 * speckle * blood * (1.0 - vessel.z);





    float scatter = (tissue + bodyEcho * body) * speckle * look.x * layering * (1.0 - 0.45 * look.z);
    float boundaryEcho = mix(specular, ridge, look.z) * look.y
                    + pericardium * (0.15 + 0.85 * pow(align, 2.0)) * 1.1;
    float lin = (floorNoise + scatter * 0.36 + boundaryEcho * 0.34) * atten;








    const float compression = 9.0;
    float v = log(1.0 + compression * max(lin, 0.0)) / log(1.0 + compression);
    return vec4(float(v), float(v), float(v), 1.0);
}


















void main(){
 vec2 pos=vec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y);
 vec2 d=pos-u[0].xy;float radius=length(d);
 if(d.y<0.0 || abs(atan(d.x,d.y))>sectorLimit.x || radius>u[0].w*u[0].z || radius<sectorLimit.y*u[0].z){fragment=vec4(0,0,0,1);return;}
 fragment=bmodeSample(pos,u[0],u[1],u[2],u[3],u[4],u[5],u[6],u[7],u[8],u[9],u[10],u[11],u[12],u[13],u[14],u[15],u[16],u[17],u[18],u[19],u[20],u[21],u[22],u[23],u[24],heartTexture,vesselTexture);
}
