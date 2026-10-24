/* kardia-sim-geom.js - Kardia beating heart geometry (WP2).
 *
 * ES5 IIFE, window.KARDIA_GEOM, module.exports under node. WebGL 1, no
 * three.js. Patient frame: x left, y anterior, z cranial, mm, origin at
 * the LV cavity centroid (end-diastole reference).
 *
 * Two geometry layers share one deformation rig:
 *  1. Parametric core (always present, deterministic under node): chamber
 *     cavities and walls as oriented ellipsoids whose volume equals the
 *     cycle model volume by construction, hinged valve leaflets and
 *     cusps, chordae, papillary muscles, septa, LVOT/RVOT, great vessels
 *     as tubes, IVC/hepatic veins, pericardium, and parametric context
 *     (ribs, lungs, liver, chest wall) used until real meshes replace it.
 *  2. BodyParts3D meshes from atlas/3d (manifest + LOD chunks). Loading
 *     reuses atlas3d.js where it is present (ATLAS3D._pure.parseManifest)
 *     and the same chunk byte layout (Float32 pos, Int16 nrm, Uint16 pid,
 *     Uint32 idx); parts are extracted by their per-vertex pid, never by
 *     copying the atlas renderer. Atlas metres map to the patient frame
 *     as x = x, y(anterior) = z, z(cranial) = y, recentred on the
 *     FJ2422 LV cavity bounds centre and scaled to mm.
 *
 * Each structure carries acoustic tags for the ultrasound renderer:
 * {echogenicity 0..1, attenuation dB/cm/MHz, isBlood, isCalcium,
 *  isAir, isBone}.
 */
(function (G) {
  "use strict";

  /* ---------- small vec helpers ---------- */
  function v3(x, y, z) { return [x, y, z]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)) || 1; }
  function norm(a) { var l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------- acoustic tags ---------- */
  var ACOUSTIC = {
    blood:      { echogenicity: 0.05, attenuation: 0.20, isBlood: true,  isCalcium: false, isAir: false, isBone: false },
    myocardium: { echogenicity: 0.45, attenuation: 0.80, isBlood: false, isCalcium: false, isAir: false, isBone: false },
    atrialWall: { echogenicity: 0.40, attenuation: 0.70, isBlood: false, isCalcium: false, isAir: false, isBone: false },
    valve:      { echogenicity: 0.80, attenuation: 1.00, isBlood: false, isCalcium: false, isAir: false, isBone: false },
    vesselWall: { echogenicity: 0.55, attenuation: 0.90, isBlood: false, isCalcium: false, isAir: false, isBone: false },
    pericardium:{ echogenicity: 0.95, attenuation: 1.20, isBlood: false, isCalcium: false, isAir: false, isBone: false },
    fluid:      { echogenicity: 0.02, attenuation: 0.10, isBlood: false, isCalcium: false, isAir: false, isBone: false },
    calcium:    { echogenicity: 1.00, attenuation: 2.00, isBlood: false, isCalcium: true,  isAir: false, isBone: false },
    bone:       { echogenicity: 0.95, attenuation: 3.00, isBlood: false, isCalcium: false, isAir: false, isBone: true },
    air:        { echogenicity: 0.90, attenuation: 5.00, isBlood: false, isCalcium: false, isAir: true,  isBone: false },
    liver:      { echogenicity: 0.40, attenuation: 0.70, isBlood: false, isCalcium: false, isAir: false, isBone: false },
    softTissue: { echogenicity: 0.35, attenuation: 0.90, isBlood: false, isCalcium: false, isAir: false, isBone: false }
  };
  function acoustic(name) { var a = ACOUSTIC[name] || ACOUSTIC.softTissue, o = {}, k; for (k in a) o[k] = a[k]; return o; }

  /* LV long axis: base -> apex points left, anterior, caudal. */
  var APEX_DIR = norm([0.12, -0.12, -0.986]);
  var LV_E2 = norm(cross(APEX_DIR, [0, 0, 1]));
  var LV_E3 = norm(cross(APEX_DIR, LV_E2));

  /* AHA 17-segment map for an LV local point (u along APEX_DIR from
   * centre, -1 apex .. +1 base; angle around the axis). */
  function lvSegment(local, a) {
    var t = a > 0 ? local[0] / a : 0; /* -1..1 */
    if (t < -0.82) return 17;
    var ang = Math.atan2(local[2], local[1]); /* -pi..pi in E2/E3 plane */
    var sector = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 6) % 6; /* 0..5 */
    if (t > 0.33) return 1 + sector;        /* basal 1-6 */
    if (t > -0.33) return 7 + sector;       /* mid 7-12 */
    var s4 = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 4) % 4;
    return 13 + s4;                          /* apical 13-16 */
  }

  /* ---------- mesh builders (positions/indices, plain arrays) ---------- */
  function Builder() { this.pos = []; this.idx = []; }
  Builder.prototype.v = function (p) { this.pos.push(p[0], p[1], p[2]); return this.pos.length / 3 - 1; };
  Builder.prototype.tri = function (a, b, c) { this.idx.push(a, b, c); };
  Builder.prototype.quad = function (a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); };
  /* Oriented ellipsoid. basis = [e1,e2,e3], semi axes [a,b,c]. */
  Builder.prototype.ellipsoid = function (centre, basis, axes, nU, nV) {
    var i, j, start = this.pos.length / 3;
    for (j = 0; j <= nV; j++) {
      var phi = -Math.PI / 2 + Math.PI * j / nV;
      for (i = 0; i <= nU; i++) {
        var th = 2 * Math.PI * i / nU;
        var lp = [Math.sin(phi) * axes[0], Math.cos(phi) * Math.cos(th) * axes[1], Math.cos(phi) * Math.sin(th) * axes[2]];
        var p = add(centre, add(add(mul(basis[0], lp[0]), mul(basis[1], lp[1])), mul(basis[2], lp[2])));
        this.v(p);
      }
    }
    for (j = 0; j < nV; j++) for (i = 0; i < nU; i++) {
      var a = start + j * (nU + 1) + i, b = a + 1, c = a + nU + 1, d = c + 1;
      this.quad(a, c, d, b);
    }
    return this;
  };
  /* Tube along a polyline path. */
  Builder.prototype.tube = function (path, radius, nR) {
    var i, j, rings = [];
    for (i = 0; i < path.length; i++) {
      var tan = i === 0 ? sub(path[1], path[0]) : (i === path.length - 1 ? sub(path[i], path[i - 1]) : sub(path[i + 1], path[i - 1]));
      tan = norm(tan);
      var ref = Math.abs(tan[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      var e2 = norm(cross(tan, ref)), e3 = cross(tan, e2), ring = [];
      var r = typeof radius === "function" ? radius(i, path.length) : radius;
      for (j = 0; j <= nR; j++) {
        var th = 2 * Math.PI * j / nR;
        ring.push(this.v(add(path[i], add(mul(e2, Math.cos(th) * r), mul(e3, Math.sin(th) * r)))));
      }
      rings.push(ring);
    }
    /* end caps */
    var c0 = this.v(path[0]), c1 = this.v(path[path.length - 1]);
    for (j = 0; j < nR; j++) { this.tri(c0, rings[0][j + 1], rings[0][j]); this.tri(c1, rings[rings.length - 1][j], rings[rings.length - 1][j + 1]); }
    for (i = 0; i < rings.length - 1; i++) for (j = 0; j < nR; j++) this.quad(rings[i][j], rings[i + 1][j], rings[i + 1][j + 1], rings[i][j + 1]);
    return this;
  };
  /* Hinged leaflet: a curved thin solid. hingePoint/hingeAxis define the
   * annulus line; dirClosed points where the free edge rests when shut;
   * opening rotates dir toward flowDir by angleRad. */
  Builder.prototype.leaflet = function (hingePoint, hingeAxis, dirClosed, flowDir, angleRad, widthMm, lengthMm, thicknessMm) {
    var axis = norm(hingeAxis);
    var dir = norm(add(mul(dirClosed, Math.cos(angleRad)), mul(flowDir, Math.sin(angleRad))));
    var side = norm(cross(axis, dir));
    var nU = 6, nV = 8, top = [], bot = [], i, j;
    function pt(u, v, off) {
      var along = mul(axis, (u - 0.5) * widthMm);
      var bend = Math.sin(v * Math.PI * 0.35) * lengthMm * 0.18;
      var p = add(hingePoint, add(along, add(mul(dir, v * lengthMm), mul(side, bend))));
      return add(p, mul(side, off));
    }
    for (j = 0; j <= nV; j++) { top.push([]); bot.push([]); for (i = 0; i <= nU; i++) { top[j].push(this.v(pt(i / nU, j / nV, thicknessMm / 2))); bot[j].push(this.v(pt(i / nU, j / nV, -thicknessMm / 2))); } }
    for (j = 0; j < nV; j++) for (i = 0; i < nU; i++) {
      this.quad(top[j][i], top[j + 1][i], top[j + 1][i + 1], top[j][i + 1]);
      this.quad(bot[j][i + 1], bot[j + 1][i + 1], bot[j + 1][i], bot[j][i]);
    }
    for (i = 0; i < nU; i++) { this.quad(top[0][i], bot[0][i], bot[0][i + 1], top[0][i + 1]); this.quad(top[nV][i + 1], bot[nV][i + 1], bot[nV][i], top[nV][i]); }
    for (j = 0; j < nV; j++) { this.quad(top[j][0], top[j + 1][0], bot[j + 1][0], bot[j][0]); this.quad(top[j][nU], bot[j][nU], bot[j + 1][nU], top[j + 1][nU]); }
    return this;
  };

  function meshVolume(pos, idx) {
    var vol = 0, i;
    for (i = 0; i + 2 < idx.length; i += 3) {
      var a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      var ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
      var bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
      var cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
      vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return Math.abs(vol) / 6 / 1000; /* mm3 -> ml */
  }
  function computeNormals(pos, idx) {
    var n = new Float32Array(pos.length), i;
    for (i = 0; i + 2 < idx.length; i += 3) {
      var a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      var ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      var vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      n[a] += nx; n[a + 1] += ny; n[a + 2] += nz; n[b] += nx; n[b + 1] += ny; n[b + 2] += nz; n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
    }
    for (i = 0; i < n.length; i += 3) { var l = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
    return n;
  }

  /* Prolate ellipsoid axes for a volume: long semi-axis grows weakly
   * (longitudinal), radial axes take the rest, so volume is exact. */
  function prolateAxes(volumeMl, refVolumeMl, refLongMm, longPow) {
    var ratio = Math.max(0.05, volumeMl / refVolumeMl);
    var a = refLongMm * Math.pow(ratio, longPow == null ? 0.25 : longPow);
    var b = Math.sqrt(Math.max(20, volumeMl * 1000 / (4.18879 * a)));
    return [a, b, b];
  }
  function sphereAxes(volumeMl) { var r = Math.pow(Math.max(1, volumeMl) * 1000 / 4.18879, 1 / 3); return [r, r, r]; }

  var IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  function basisFromThin(thinDir, ref) {
    var t = norm(thinDir), r = ref || [0, 0, 1];
    var e2 = norm(cross(t, Math.abs(dot(t, r)) > 0.9 ? [1, 0, 0] : r));
    return [t, e2, norm(cross(t, e2))];
  }

  /* Part-id -> rig assignment for BodyParts3D meshes. Chamber parts
   * deform with that chamber, vessel parts pulse, context is static. */
  var PART_RIG = {
    FJ2422: "LV", FJ2425: "LA", FJ2438: "LA", FJ2423: "RV", FJ2424: "RA", FJ2439: "RA",
    FJ2428: "LVWALL", FJ2420: "MV", FJ2432: "MV", FJ2421: "TV", FJ2433: "TV", FJ2436: "TV",
    FJ2426: "AV", FJ2431: "AV", FJ2435: "AV", FJ2417: "PV", FJ2427: "PV", FJ2434: "PV",
    FJ2418: "LV", FJ2429: "LV", FJ2419: "RV", FJ2430: "RV", FJ2437: "RV"
  };
  var GREAT_VESSEL_IDS = { FJ3411: 1, FJ3413: 1, FJ3427: 1, FJ1931: 1, FJ1932: 1, FJ2966: 1, FJ2924: 1, FJ3019: 1, FJ3645: 1, FJ3441: 1, FJ3659: 1 };

  function defaultPathology() {
    return {
      wallThicknessScale: 1, chamberDilation: {}, wallMotion: null,
      effusionMm: 0, leafletThickeningMm: 0, leafletRestriction: 0,
      vegetation: null, thrombus: null, septalDefect: null
    };
  }

  function create(options) {
    options = options || {};
    var heart = options.heart || null;
    var viewsData = options.views || null;
    var pathology = defaultPathology();
    if (options.pathology) for (var pk in options.pathology) pathology[pk] = options.pathology[pk];

    /* Reference (end-diastolic calibration) volumes, ml. The parametric
     * cavities are rebuilt from the live model volume each update, so
     * these only set shape (long-axis length) at the reference volume. */
    var REF = { LV: 120, RV: 115, LA: 38, RA: 36 };
    var structures = [];      /* built per update: {id,ref,name,kind,acoustic,pos,idx,centroid} */
    var loadedParts = [];     /* BodyParts3D: {id,ref,name,rig,basePos,idx,centroid0,acoustic,kind} */
    var manifest = null;
    var lastState = null;
    var built = null;         /* cached buffers() result for current update */

    function dilated(chamber, volumeMl) {
      var d = pathology.chamberDilation[chamber];
      return d ? volumeMl * d : volumeMl;
    }
    function valveAngle(open, flow, maxDeg) {
      if (!open) return 0;
      var f = clamp(Math.abs(flow || 0) / 250, 0.25, 1);
      var maxA = (maxDeg || 72) * (1 - 0.85 * clamp(pathology.leafletRestriction, 0, 1));
      return maxA * f * Math.PI / 180;
    }

    function build(state) {
      structures = [];
      var vol = state.volumes, prs = state.pressures, valves = state.valves;
      var lvV = dilated("LV", vol.LV), rvV = dilated("RV", vol.RV), laV = dilated("LA", vol.LA), raV = dilated("RA", vol.RA);
      var lvAxes = prolateAxes(lvV, REF.LV, 42, 0.25);
      /* Base descent in systole: the mitral annulus is pulled toward the
       * apex as the long axis shortens (reference a=42 at REF volume). */
      var systole = clamp(1 - lvV / (REF.LV * (pathology.chamberDilation.LV || 1)), 0, 1);
      var lvCentre = [0, 0, 0];
      var baseCentre = add(lvCentre, mul(APEX_DIR, -lvAxes[0]));
      var annulus = add(lvCentre, mul(APEX_DIR, -lvAxes[0] * 0.92));
      var apexPoint = add(lvCentre, mul(APEX_DIR, lvAxes[0]));
      var wallT = 10 * pathology.wallThicknessScale;
      /* Regional wall motion: systolic radial scale per segment. Applied
       * by rebuilding the LV cavity with a per-vertex radial factor when
       * a wallMotion map is present (normal hearts skip this path). */
      function addStruct(id, ref, name, kind, acousticName, builderFn) {
        var b = new Builder(); builderFn(b);
        var cen = [0, 0, 0], i;
        for (i = 0; i < b.pos.length; i += 3) { cen[0] += b.pos[i]; cen[1] += b.pos[i + 1]; cen[2] += b.pos[i + 2]; }
        var n = Math.max(1, b.pos.length / 3);
        structures.push({ id: id, ref: ref, name: name, kind: kind, acoustic: acoustic(acousticName), pos: b.pos, idx: b.idx, centroid: [cen[0] / n, cen[1] / n, cen[2] / n] });
      }

      /* --- LV cavity (FJ2422) with optional RWMA --- */
      addStruct("lv_cavity", "FJ2422", "Cavity of left ventricle", "chamber", "blood", function (b) {
        if (!pathology.wallMotion) { b.ellipsoid(lvCentre, [APEX_DIR, LV_E2, LV_E3], lvAxes, 28, 20); return; }
        /* rebuild manually so akinetic segments barely move in systole */
        var refAxes = prolateAxes(REF.LV * (pathology.chamberDilation.LV || 1), REF.LV, 42, 0.25);
        var nU = 28, nV = 20, j, i, grid = [];
        for (j = 0; j <= nV; j++) { grid.push([]); var phi = -Math.PI / 2 + Math.PI * j / nV;
          for (i = 0; i <= nU; i++) { var th = 2 * Math.PI * i / nU;
            var lpRef = [Math.sin(phi) * refAxes[0], Math.cos(phi) * Math.cos(th) * refAxes[1], Math.cos(phi) * Math.sin(th) * refAxes[2]];
            var lp = [Math.sin(phi) * lvAxes[0], Math.cos(phi) * Math.cos(th) * lvAxes[1], Math.cos(phi) * Math.sin(th) * lvAxes[2]];
            var seg = lvSegment(lpRef, refAxes[0]);
            var motion = pathology.wallMotion[seg] == null ? 1 : pathology.wallMotion[seg];
            var use = [lpRef[0] + (lp[0] - lpRef[0]) * 1, 0, 0];
            use[1] = lpRef[1] + (lp[1] - lpRef[1]) * motion; use[2] = lpRef[2] + (lp[2] - lpRef[2]) * motion;
            grid[j].push(b.v(add(lvCentre, add(add(mul(APEX_DIR, use[0]), mul(LV_E2, use[1])), mul(LV_E3, use[2])))));
          } }
        for (j = 0; j < nV; j++) for (i = 0; i < nU; i++) b.quad(grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]);
      });
      /* --- LV wall: outer ellipsoid (FJ2428); thickness via pathology --- */
      var lvWallAxes = [lvAxes[0] + wallT * 0.4, lvAxes[1] + wallT, lvAxes[2] + wallT];
      addStruct("lv_wall", "FJ2428", "Wall of left ventricle", "wall", "myocardium", function (b) { b.ellipsoid(lvCentre, [APEX_DIR, LV_E2, LV_E3], lvWallAxes, 24, 18); });
      /* --- RV cavity + wall --- */
      var rvAxes = prolateAxes(rvV, REF.RV, 40, 0.22);
      var rvDir = norm([-0.25, 0.18, -0.95]), rvE2 = norm(cross(rvDir, [0, 0, 1])), rvE3 = norm(cross(rvDir, rvE2));
      var rvCentre = [-26, 14, 10];
      addStruct("rv_cavity", "FJ2423", "Cavity of right ventricle", "chamber", "blood", function (b) { b.ellipsoid(rvCentre, [rvDir, rvE2, rvE3], rvAxes, 24, 18); });
      addStruct("rv_wall", "rv_wall", "Wall of right ventricle", "wall", "myocardium", function (b) { b.ellipsoid(rvCentre, [rvDir, rvE2, rvE3], [rvAxes[0] + 2, rvAxes[1] + 5 * pathology.wallThicknessScale, rvAxes[2] + 5 * pathology.wallThicknessScale], 20, 14); });
      /* --- Atria --- */
      var laAxes = sphereAxes(laV), raAxes = sphereAxes(raV);
      var laCentre = add(baseCentre, [-2, -8, 10]);
      var raCentre = [-34, 2, 30];
      addStruct("la_cavity", "FJ2425", "Cavity of left atrium", "chamber", "blood", function (b) { b.ellipsoid(laCentre, IDENTITY, laAxes, 22, 16); });
      addStruct("la_wall", "FJ2438", "Wall of left atrium", "wall", "atrialWall", function (b) { b.ellipsoid(laCentre, IDENTITY, [laAxes[0] + 3, laAxes[1] + 3, laAxes[2] + 3], 18, 12); });
      addStruct("ra_cavity", "FJ2424", "Cavity of right atrium", "chamber", "blood", function (b) { b.ellipsoid(raCentre, IDENTITY, raAxes, 22, 16); });
      addStruct("ra_wall", "FJ2439", "Wall of right atrium", "wall", "atrialWall", function (b) { b.ellipsoid(raCentre, IDENTITY, [raAxes[0] + 3, raAxes[1] + 3, raAxes[2] + 3], 18, 12); });
      /* --- Septa (parametric; a defect leaves a real hole) --- */
      function septum(id, ref, name, centre, thinDir, r1, r2, defectMm) {
        addStruct(id, ref, name, "septum", "myocardium", function (b) {
          var basis = basisFromThin(thinDir);
          if (!defectMm) { b.ellipsoid(centre, basis, [3, r1, r2], 20, 14); return; }
          /* annulus disc with a central hole: rings from defect to rim */
          var rings = [], nR = 20, nS = 5, j, i;
          for (j = 0; j <= nS; j++) { rings.push([]); var rr = defectMm / 2 + (r1 - defectMm / 2) * j / nS;
            for (i = 0; i <= nR; i++) { var th = 2 * Math.PI * i / nR;
              rings[j].push(b.v(add(centre, add(mul(basis[1], Math.cos(th) * rr), mul(basis[2], Math.sin(th) * rr * (r2 / r1)))))); } }
          for (j = 0; j < nS; j++) for (i = 0; i < nR; i++) b.quad(rings[j][i], rings[j + 1][i], rings[j + 1][i + 1], rings[j][i + 1]);
        });
      }
      var defect = pathology.septalDefect;
      septum("septum_iv", "interventricular_septum", "Interventricular septum", [-13, 7, 0], sub(rvCentre, lvCentre), 24, 30, defect && defect.type === "VSD" ? defect.sizeMm || 8 : 0);
      addStruct("septum_iv_mid", "ventricular_septum_mid", "Mid interventricular septum", "septum", "myocardium", function (b) { b.ellipsoid([-13, 7, -4], basisFromThin(sub(rvCentre, lvCentre)), [3, 12, 14], 14, 10); });
      septum("septum_ia", "atrial_septum_interatrial", "Interatrial septum", [-25, -8, 36], sub(raCentre, laCentre), 17, 20, defect && defect.type === "ASD" ? defect.sizeMm || 10 : 0);
      addStruct("lv_apex", "lv_apex", "Left ventricular apex", "landmark", "myocardium", function (b) { b.ellipsoid(apexPoint, IDENTITY, [13, 13, 13], 12, 8); });
      /* --- LVOT + aortic root --- */
      var avCentre = add(annulus, [3, -2, 13]);
      addStruct("lvot", "lvot", "Left ventricular outflow tract", "outflow", "blood", function (b) { b.tube([add(lvCentre, mul(APEX_DIR, -lvAxes[0] * 0.55)), annulus, avCentre], 11, 14); });
      addStruct("aortic_root", "aortic_root", "Aortic root", "vessel", "vesselWall", function (b) { b.ellipsoid(avCentre, IDENTITY, [15, 15, 13], 16, 12); });
      addStruct("rvot", "rvot", "Right ventricular outflow tract", "outflow", "blood", function (b) { b.tube([add(rvCentre, [6, 2, 20]), [-14, 16, 38], [-12, 12, 49]], 10, 12); });
      /* --- Valves: hinged leaflets and cusps --- */
      var lt = 1.2 + (pathology.leafletThickeningMm || 0);
      var mvAngle = valveAngle(valves.mitral.open, valves.mitral.flow, 72);
      var tvAngle = valveAngle(valves.tricuspid.open, valves.tricuspid.flow, 68);
      var avAngle = valveAngle(valves.aortic.open, valves.aortic.flow, 58);
      var pvAngle = valveAngle(valves.pulmonary.open, valves.pulmonary.flow, 58);
      var mvHingeAxis = norm(cross(APEX_DIR, [1, 0, 0]));
      addStruct("mv_anterior", "FJ2420", "Anterior leaflet of mitral valve", "valve", "valve", function (b) { b.leaflet(add(annulus, mul(mvHingeAxis, 0)), mvHingeAxis, APEX_DIR, mul(APEX_DIR, -1), mvAngle, 26, 22, lt); });
      addStruct("mv_posterior", "FJ2432", "Posterior leaflet of mitral valve", "valve", "valve", function (b) { b.leaflet(annulus, mvHingeAxis, APEX_DIR, mul(APEX_DIR, -1), mvAngle, 26, 15, lt); });
      var tvCentre = add(rvCentre, [4, -2, 26]);
      var tvHingeAxis = norm(cross(rvDir, [1, 0, 0]));
      addStruct("tv_anterior", "FJ2421", "Anterior leaflet of tricuspid valve", "valve", "valve", function (b) { b.leaflet(tvCentre, tvHingeAxis, rvDir, mul(rvDir, -1), tvAngle, 22, 18, lt); });
      addStruct("tv_septal", "FJ2436", "Septal leaflet of tricuspid valve", "valve", "valve", function (b) { b.leaflet(tvCentre, tvHingeAxis, rvDir, mul(rvDir, -1), tvAngle, 20, 13, lt); });
      addStruct("tv_posterior", "FJ2433", "Posterior leaflet of tricuspid valve", "valve", "valve", function (b) { b.leaflet(tvCentre, norm(cross(rvDir, [0, 1, 0])), rvDir, mul(rvDir, -1), tvAngle, 20, 13, lt); });
      function cusps(prefix, refs, names, centre, flowDir, angle) {
        for (var ci = 0; ci < 3; ci++) {
          (function (ci) {
            var th = ci * 2.094 + 0.5, hingeAxis = [Math.cos(th), Math.sin(th), 0];
            var closed = norm(cross(hingeAxis, flowDir));
            addStruct(prefix + "_" + ci, refs[ci], names[ci], "valve", "valve", function (b) { b.leaflet(centre, hingeAxis, closed, flowDir, angle, 15, 13, lt); });
          })(ci);
        }
      }
      cusps("av_cusp", ["FJ2426", "FJ2431", "FJ2435"], ["Left posterior cusp of aortic valve", "Right posterior cusp of aortic valve", "Anterior cusp of aortic valve"], avCentre, [0, 0, 1], avAngle);
      var pvCentre = [-12, 10, 49];
      cusps("pv_cusp", ["FJ2417", "FJ2427", "FJ2434"], ["Left anterior cusp of pulmonary valve", "Posterior cusp of pulmonary valve", "Right anterior cusp of pulmonary valve"], pvCentre, norm([-0.1, -0.2, 1]), pvAngle);
      /* --- Papillary muscles + chordae --- */
      var papAL = add(lvCentre, add(mul(APEX_DIR, lvAxes[0] * 0.35), mul(LV_E2, lvAxes[1] * 0.55)));
      var papPM = add(lvCentre, add(mul(APEX_DIR, lvAxes[0] * 0.35), mul(LV_E3, lvAxes[1] * 0.55)));
      addStruct("pap_lv_lat", "FJ2429", "Lateral papillary muscle of left ventricle", "papillary", "myocardium", function (b) { b.ellipsoid(papAL, IDENTITY, [6, 6, 9], 12, 8); });
      addStruct("pap_lv_al_head", "FJ2418", "Anterolateral head of lateral papillary muscle", "papillary", "myocardium", function (b) { b.ellipsoid(add(papAL, [0, 0, 5]), IDENTITY, [4, 4, 5], 10, 8); });
      addStruct("pap_rv_ant", "FJ2419", "Anterior papillary muscle of right ventricle", "papillary", "myocardium", function (b) { b.ellipsoid(add(rvCentre, [10, -8, -10]), IDENTITY, [5, 5, 8], 10, 8); });
      addStruct("chordae", "chordae_tendineae", "Chordae tendineae", "chordae", "valve", function (b) {
        b.tube([papAL, add(annulus, mul(APEX_DIR, 8))], 0.7, 5); b.tube([papPM, add(annulus, mul(APEX_DIR, 8))], 0.7, 5);
        b.tube([add(rvCentre, [10, -8, -10]), add(tvCentre, mul(rvDir, 6))], 0.7, 5);
      });
      /* --- Great vessels (radius pulses with pressure) --- */
      var aoPulse = 1 + 0.10 * clamp((prs.Ao - 80) / 40, -1, 1.5);
      var paPulse = 1 + 0.10 * clamp((prs.PA - 16) / 14, -1, 1.5);
      addStruct("aorta_asc", "FJ3413", "Ascending aorta", "vessel", "blood", function (b) { b.tube([avCentre, add(avCentre, [2, -3, 26]), [0, -8, 62]], function (i) { return (i === 0 ? 14 : 12) * aoPulse; }, 14); });
      addStruct("aorta_arch", "FJ3411", "Arch of aorta", "vessel", "blood", function (b) { b.tube([[0, -8, 62], [-16, -18, 72], [-24, -24, 46]], 11 * aoPulse, 12); });
      addStruct("aorta_desc", "FJ3427", "Descending aorta", "vessel", "blood", function (b) { b.tube([[-24, -21, 46], [-22, -21, 0], [-20, -20, -48]], 10 * aoPulse, 12); });
      addStruct("aorta_abd", "FJ1932", "Abdominal aorta", "vessel", "blood", function (b) { b.tube([[-20, -22, -48], [-18, -20, -80]], 9 * aoPulse, 10); });
      addStruct("pa_trunk", "FJ2966", "Pulmonary trunk", "vessel", "blood", function (b) { b.tube([pvCentre, [-6, -2, 56]], 13 * paPulse, 12); });
      addStruct("pa_left", "FJ2924", "Left pulmonary artery", "vessel", "blood", function (b) { b.tube([[-6, 4, 56], [24, -8, 54]], 7 * paPulse, 10); });
      addStruct("pa_right", "FJ3019", "Right pulmonary artery", "vessel", "blood", function (b) { b.tube([[-6, 4, 56], [-38, -8, 52]], 7 * paPulse, 10); });
      addStruct("svc", "FJ3645", "Superior vena cava", "vessel", "blood", function (b) { b.tube([add(raCentre, [0, 0, 14]), add(raCentre, [2, -2, 48])], 9, 12); });
      addStruct("ivc", "FJ3441", "Inferior vena cava", "vessel", "blood", function (b) { b.tube([add(raCentre, [0, -2, -12]), add(raCentre, [2, -4, -52])], 11, 12); });
      addStruct("hepatic_vein", "hepatic_vein", "Hepatic vein", "vessel", "blood", function (b) { b.tube([add(raCentre, [2, -4, -40]), [-52, -6, -52]], 5, 8); });
      addStruct("coronary_sinus", "FJ2655", "Coronary sinus", "vessel", "blood", function (b) { b.tube([add(raCentre, [-8, -10, -4]), add(laCentre, [8, -8, -8])], 4, 8); });
      addStruct("oesophagus", "LIVE_esophagus", "Oesophagus", "context", "softTissue", function (b) { b.tube([[-6, -34, 60], [-8, -36, -40]], 7, 8); });
      addStruct("urinary_bladder", "LIVE_urinary_bladder", "Urinary bladder", "context", "softTissue", function (b) { b.ellipsoid([0, 18, -150], IDENTITY, [34, 26, 22], 12, 8); });
      /* Arch branches and other view landmarks as small parametric tubes */
      addStruct("brachiocephalic", "brachiocephalic_trunk", "Brachiocephalic trunk", "vessel", "blood", function (b) { b.tube([[-8, -14, 68], [-16, -16, 88]], 5, 8); });
      addStruct("carotid_l", "left_common_carotid_artery", "Left common carotid artery", "vessel", "blood", function (b) { b.tube([[-14, -17, 70], [-8, -18, 92]], 4, 8); });
      addStruct("subclavian_l", "left_subclavian_artery", "Left subclavian artery", "vessel", "blood", function (b) { b.tube([[-20, -20, 66], [6, -20, 84]], 4, 8); });
      addStruct("ductus", "ductus_arteriosus_region", "Ductus arteriosus region", "landmark", "vesselWall", function (b) { b.ellipsoid([-16, -10, 52], IDENTITY, [8, 8, 8], 10, 8); });
      addStruct("laa", "left_atrial_appendage", "Left atrial appendage", "landmark", "atrialWall", function (b) { b.ellipsoid(add(laCentre, [14, 8, 2]), IDENTITY, [8, 7, 10], 10, 8); });
      addStruct("raa", "right_atrial_appendage", "Right atrial appendage", "landmark", "atrialWall", function (b) { b.ellipsoid(add(raCentre, [10, 12, 4]), IDENTITY, [8, 7, 9], 10, 8); });
      addStruct("pv_left_sup", "FJ2925", "Left superior pulmonary vein", "vessel", "blood", function (b) { b.tube([add(laCentre, [16, -6, 6]), add(laCentre, [36, -12, 8])], 5, 8); });
      addStruct("oesophagus_marker", "FJ2563", "Oesophagus (TEE probe path)", "landmark", "softTissue", function (b) { b.ellipsoid([-7, -35, 20], IDENTITY, [8, 6, 12], 10, 8); });
      addStruct("kidney_r", "FJ3147", "Right kidney", "context", "softTissue", function (b) { b.ellipsoid([-70, -28, -70], IDENTITY, [22, 14, 30], 10, 8); });
      addStruct("spleen", "FJ2561", "Spleen", "context", "softTissue", function (b) { b.ellipsoid([72, -20, -30], IDENTITY, [24, 12, 28], 10, 8); });
      addStruct("kidney_l", "FJ3145", "Left kidney", "context", "softTissue", function (b) { b.ellipsoid([70, -28, -70], IDENTITY, [22, 14, 30], 10, 8); });
      /* --- Pericardium: offset shell; effusion pushes it out --- */
      var eff = pathology.effusionMm || 0;
      addStruct("pericardium", "pericardium", "Pericardium", "pericardium", "pericardium", function (b) { b.ellipsoid([-6, 0, 8], IDENTITY, [66 + eff, 58 + eff, 64 + eff], 22, 16); });
      if (eff > 0) addStruct("pericardial_space", "pericardial_space", "Pericardial space", "fluid", "fluid", function (b) { b.ellipsoid([-6, 0, 8], IDENTITY, [64 + eff * 0.5, 56 + eff * 0.5, 62 + eff * 0.5], 20, 14); });
      else addStruct("pericardial_space", "pericardial_space", "Pericardial space", "fluid", "fluid", function (b) { b.ellipsoid([-6, 0, 8], IDENTITY, [63, 55, 61], 16, 10); });
      /* --- Pathology blobs --- */
      if (pathology.vegetation) {
        var vg = pathology.vegetation, vpos = vg.valve === "mitral" ? annulus : (vg.valve === "tricuspid" ? tvCentre : avCentre), vs = vg.sizeMm || 8;
        addStruct("vegetation", "vegetation", "Vegetation", "pathology", "valve", function (b) { b.ellipsoid(vpos, IDENTITY, [vs / 2, vs / 2, vs / 2], 12, 8); });
      }
      if (pathology.thrombus) {
        var th = pathology.thrombus, tpos = th.chamber === "LA" ? laCentre : (th.chamber === "RA" ? raCentre : (th.chamber === "RV" ? rvCentre : apexPoint)), ts = th.sizeMm || 14;
        addStruct("thrombus", "thrombus", "Thrombus", "pathology", "myocardium", function (b) { b.ellipsoid(tpos, IDENTITY, [ts / 2, ts / 2, ts / 2], 12, 8); });
      }
      /* --- Parametric context (replaced per-role by real meshes) --- */
      if (!hasLoadedRole("ribs")) {
        addStruct("ribs", "ribs", "Ribs", "context", "bone", function (b) {
          for (var ri = 0; ri < 5; ri++) {
            var z = 42 - ri * 20, path = [], ai;
            for (ai = 0; ai <= 10; ai++) { var t = ai / 10, ang = -2.4 + t * 4.8; path.push([Math.sin(ang) * 118, -Math.cos(ang) * 52 + 8, z + Math.sin(t * Math.PI) * 4]); }
            b.tube(path, 3.5, 6);
          }
        });
      }
      if (!hasLoadedRole("lungs")) {
        addStruct("lung_l", "lung_left", "Left lung", "context", "air", function (b) { b.ellipsoid([86, -6, 4], IDENTITY, [44, 48, 72], 14, 10); });
        addStruct("lung_r", "lung_right", "Right lung", "context", "air", function (b) { b.ellipsoid([-88, -6, 0], IDENTITY, [44, 48, 68], 14, 10); });
      }
      if (!hasLoadedRole("liver")) addStruct("liver", "LIVE_liver", "Liver", "context", "liver", function (b) { b.ellipsoid([-30, 2, -58], IDENTITY, [85, 55, 48], 14, 10); });
      if (!hasLoadedRole("chestwall")) addStruct("chest_wall", "chest_wall", "Chest wall", "context", "softTissue", function (b) { b.ellipsoid([0, 4, 2], IDENTITY, [132, 78, 96], 16, 10); });
      /* Extra named landmarks used by non-TTE views */
      var extras = [
        ["pleural_line", "Pleural line", [86, 42, 10]], ["diaphragm_dome", "FJ3131", [-20, 0, -54]],
        ["morison_pouch", "Morison pouch", [-58, -8, -62]], ["splenorenal_recess", "Splenorenal recess", [58, -10, -58]],
        ["costophrenic_recess", "Costophrenic recess", [-72, 20, -52]], ["rectovesical_pouch", "Rectovesical pouch", [0, 8, -138]],
        ["douglas_pouch", "Pouch of Douglas", [0, -12, -138]], ["thoracic_spine_shadow", "Thoracic spine shadow", [-16, -42, 0]]
      ];
      extras.forEach(function (ex) {
        var isRefId = ex[1].indexOf("FJ") === 0;
        addStruct("x_" + (isRefId ? ex[0] : ex[0]), isRefId ? ex[1] : ex[0], isRefId ? ex[0].replace(/_/g, " ") : ex[1], "landmark", ex[0] === "pleural_line" ? "pericardium" : "softTissue", function (b) { b.ellipsoid(ex[2], IDENTITY, [9, 9, 9], 10, 8); });
      });
      built = null;
      lastState = state;
      return api;
    }
    function hasLoadedRole(role) { for (var i = 0; i < loadedParts.length; i++) if (loadedParts[i].role === role) return true; return false; }

    /* Deform a loaded BodyParts part: scale about its own centroid.
     * Ventricular/atrial parts follow their chamber volume (radial in
     * the plane across the long axis, weaker along it, so the deformed
     * mesh volume tracks the model); vessels pulse with pressure. */
    function deformLoaded(part, state) {
      var rig = part.rig, out = new Array(part.basePos.length), i;
      if (rig === "context") { for (i = 0; i < out.length; i++) out[i] = part.basePos[i]; return out; }
      var volKey = rig === "LVWALL" ? "LV" : rig, refV = REF[volKey] || 60;
      var curV = state.volumes[volKey];
      if (curV == null) { /* valves/vessels: pulse or copy */
        var pulse = rig === "AV" || rig === "MV" || rig === "TV" || rig === "PV" ? 1 : 1 + 0.08 * clamp(((rig === "PV" ? state.pressures.PA : state.pressures.Ao) - 80) / 40, -1, 1.5);
        for (i = 0; i < out.length; i++) out[i] = part.centroid0[i % 3] + (part.basePos[i] - part.centroid0[i % 3]) * pulse;
        return out;
      }
      var ratio = clamp(curV / refV, 0.2, 2.5);
      var radial = Math.pow(ratio, 0.4), longS = Math.pow(ratio, 0.2);
      var axis = (volKey === "RV") ? norm([-0.25, 0.18, -0.95]) : APEX_DIR;
      /* base descends in systole for ventricular rigs */
      var drop = (volKey === "LV" || volKey === "RV" || volKey === "LVWALL") ? mul(axis, -6 * clamp(1 - ratio, 0, 1)) : [0, 0, 0];
      for (i = 0; i + 2 < out.length; i += 3) {
        var rel = [part.basePos[i] - part.centroid0[0], part.basePos[i + 1] - part.centroid0[1], part.basePos[i + 2] - part.centroid0[2]];
        var along = dot(rel, axis), perp = sub(rel, mul(axis, along));
        var p = add(part.centroid0, add(add(mul(perp, radial), mul(axis, along * longS)), drop));
        out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
      }
      return out;
    }

    function ensureBuilt() { if (!lastState) update(); }

    function buffers() {
      ensureBuilt();
      if (built) return built;
      var pos = [], idx = [], groups = [], offset = 0, i, j;
      function pushMesh(ref, id, name, kind, ac, p, ix) {
        var start = idx.length;
        for (j = 0; j < p.length; j++) pos.push(p[j]);
        for (j = 0; j < ix.length; j++) idx.push(ix[j] + offset);
        groups.push({ id: id, ref: ref, name: name, kind: kind, acoustic: ac, indexStart: start, indexCount: ix.length, vertexStart: offset, vertexCount: p.length / 3 });
        offset += p.length / 3;
      }
      for (i = 0; i < structures.length; i++) { var s = structures[i]; pushMesh(s.ref, s.id, s.name, s.kind, s.acoustic, s.pos, s.idx); }
      for (i = 0; i < loadedParts.length; i++) { var lp = loadedParts[i]; pushMesh(lp.id, "bp3d_" + lp.id, lp.name, "bp3d:" + lp.rig, lp.acoustic, deformLoaded(lp, lastState), lp.idx); }
      var posArr = new Float32Array(pos), idxArr = new Uint32Array(idx);
      built = { positions: posArr, normals: computeNormals(posArr, idxArr), indices: idxArr, groups: groups, vertexCount: posArr.length / 3, triangleCount: idxArr.length / 3 };
      return built;
    }
    function volumeOfRef(ref) {
      var b = buffers(), total = 0, gi;
      for (gi = 0; gi < b.groups.length; gi++) {
        var g = b.groups[gi]; if (g.ref !== ref) continue;
        /* indices in the group are global; meshVolume expects local
         * indices, so subtract the group's vertex offset first */
        var local = [], li;
        for (li = g.indexStart; li < g.indexStart + g.indexCount; li++) local.push(b.indices[li] - g.vertexStart);
        total += meshVolume(b.positions.subarray(g.vertexStart * 3, (g.vertexStart + g.vertexCount) * 3), local);
      }
      return total;
    }
    function structureVolume(ref) { return volumeOfRef(ref); }

    /* ---------- cut: CPU triangle/plane intersection ---------- */
    function cut(planeOrigin, planeNormal, planeUp, widthMm, depthMm) {
      ensureBuilt();
      var n = norm(planeNormal), up0 = norm(planeUp);
      var right = norm(cross(n, up0)); var up = norm(cross(right, n));
      var b = buffers(), polys = [], gi, i;
      var w = widthMm || 240, d = depthMm || 240;
      for (gi = 0; gi < b.groups.length; gi++) {
        var g = b.groups[gi];
        var segs = [];
        for (i = g.indexStart; i + 2 < g.indexStart + g.indexCount; i += 3) {
          var pts = [], k;
          var tri = [b.indices[i], b.indices[i + 1], b.indices[i + 2]];
          var dist = [];
          for (k = 0; k < 3; k++) { var o = tri[k] * 3; pts.push([b.positions[o], b.positions[o + 1], b.positions[o + 2]]); dist.push(dot(sub(pts[k], planeOrigin), n)); }
          var hits = [];
          for (k = 0; k < 3; k++) {
            var a = pts[k], c = pts[(k + 1) % 3], da = dist[k], dc = dist[(k + 1) % 3];
            if ((da < 0 && dc > 0) || (da > 0 && dc < 0)) { var t = da / (da - dc); hits.push(add(a, mul(sub(c, a), t))); }
            else if (Math.abs(da) < 1e-9) hits.push(a);
          }
          if (hits.length >= 2) segs.push([hits[0], hits[1]]);
        }
        if (!segs.length) continue;
        /* chain segments into loops by quantised endpoints */
        function key(p) { return Math.round(p[0] * 20) + "," + Math.round(p[1] * 20) + "," + Math.round(p[2] * 20); }
        var adj = {};
        segs.forEach(function (sg, si) { (adj[key(sg[0])] = adj[key(sg[0])] || []).push(si); (adj[key(sg[1])] = adj[key(sg[1])] || []).push(si); });
        var used = {}, loops = [];
        segs.forEach(function (sg, si) {
          if (used[si]) return;
          var loop = [sg[0], sg[1]]; used[si] = 1;
          var guard = 0;
          while (guard++ < segs.length + 2) {
            var end = loop[loop.length - 1], cands = adj[key(end)] || [], found = false;
            for (var ci = 0; ci < cands.length; ci++) { if (used[cands[ci]]) continue; var s2 = segs[cands[ci]]; var nxt = key(s2[0]) === key(end) ? s2[1] : s2[0]; loop.push(nxt); used[cands[ci]] = 1; found = true; break; }
            if (!found) break;
            if (key(loop[loop.length - 1]) === key(loop[0])) break;
          }
          if (loop.length >= 3) loops.push(loop);
        });
        if (!loops.length && segs.length >= 3) {
          /* open surface (leaflet edge-on etc.): use segment endpoints */
          var flat = []; segs.forEach(function (sg) { flat.push(sg[0]); flat.push(sg[1]); }); loops = [flat];
        }
        loops.forEach(function (loop) {
          var pts2 = loop.map(function (p) { var rel = sub(p, planeOrigin); return [dot(rel, right), dot(rel, up)]; });
          var cu = 0, cv = 0; pts2.forEach(function (p) { cu += p[0]; cv += p[1]; }); cu /= pts2.length; cv /= pts2.length;
          if (Math.abs(cu) > w / 2 || Math.abs(cv) > d / 2) return;
          polys.push({ id: g.id, ref: g.ref, name: g.name, kind: g.kind, acoustic: g.acoustic, points: pts2, centroid: [cu, cv] });
        });
      }
      return polys;
    }

    function currentStructures() {
      ensureBuilt();
      var out = structures.map(function (s) { return { id: s.id, ref: s.ref, name: s.name, kind: s.kind, acoustic: s.acoustic, centroid: s.centroid.slice() }; });
      loadedParts.forEach(function (lp) { out.push({ id: "bp3d_" + lp.id, ref: lp.id, name: lp.name, kind: "bp3d:" + lp.rig, acoustic: lp.acoustic, centroid: lp.centroid0.slice() }); });
      return out;
    }
    function viewById(id) {
      if (!viewsData || !viewsData.views) return null;
      for (var i = 0; i < viewsData.views.length; i++) if (viewsData.views[i].id === id) return viewsData.views[i];
      return null;
    }
    /* Target plane for a view: views.json normal/up, origin chosen on
     * that normal to best cover the view's landmark centroids. */
    function viewPlane(view) {
      ensureBuilt();
      var v = typeof view === "string" ? viewById(view) : view;
      if (!v) return { origin: [0, 0, 0], normal: [0, 1, 0], up: [0, 0, -1] };
      var n = norm(v.probe.normal), up = norm(v.probe.up);
      var byRef = {};
      currentStructures().forEach(function (s) { if (!byRef[s.ref]) byRef[s.ref] = s; });
      /* vertex projection range of each landmark along n: a plane at
       * candidate d intersects it iff d is inside [min, max]. */
      function projRange(ref) {
        var src = null, i;
        for (i = 0; i < structures.length; i++) if (structures[i].ref === ref) { src = structures[i]; break; }
        if (!src) { var s = byRef[ref]; var c = s ? dot(s.centroid, n) : 0; return [c - 18, c + 18]; }
        var mn = 1e9, mx = -1e9;
        for (i = 0; i < src.pos.length; i += 3) { var dd = src.pos[i] * n[0] + src.pos[i + 1] * n[1] + src.pos[i + 2] * n[2]; if (dd < mn) mn = dd; if (dd > mx) mx = dd; }
        return [mn, mx];
      }
      var items = [];
      (v.landmarks || []).forEach(function (lm) { var s = byRef[lm.ref]; if (s) { var r = projRange(lm.ref); items.push({ ref: lm.ref, proj: dot(s.centroid, n), mn: r[0], mx: r[1], rad: Math.max(3, (r[1] - r[0]) / 2) }); } });
      var d = 0;
      if (items.length) {
        var cands = [];
        items.forEach(function (it) { cands.push(it.proj); cands.push((it.mn + it.mx) / 2); cands.push(it.mn + 0.5); cands.push(it.mx - 0.5); });
        for (var a = 0; a < items.length; a++) for (var b = a + 1; b < items.length; b++) { cands.push((items[a].proj + items[b].proj) / 2); cands.push((items[a].mn + items[b].mx) / 2); cands.push((items[a].mx + items[b].mn) / 2); }
        var best = null;
        cands.forEach(function (cand) {
          var covered = 0, score = 0;
          items.forEach(function (it) { var dist = Math.abs(it.proj - cand); if (cand >= it.mn && cand <= it.mx) covered++; score += dist / it.rad; });
          if (!best || covered > best.covered || (covered === best.covered && score < best.score)) best = { d: cand, covered: covered, score: score };
        });
        d = best.d;
      }
      return { origin: mul(n, d), normal: n, up: up, viewId: v.id };
    }

    /* ---------- BodyParts3D loader ---------- */
    function parseManifest(m) {
      if (G.ATLAS3D && G.ATLAS3D._pure && G.ATLAS3D._pure.parseManifest) return G.ATLAS3D._pure.parseManifest(m);
      var parts = (m.parts || []).map(function (a, i) { return { i: i, id: a[0], name: a[1], fma: a[2], sys: a[3], reg: a[4], chunk: a[5], iStart: a[6], iCount: a[7], b: a[8], canon: a[9] || null, src: a[10] || 0 }; });
      var byId = {}; parts.forEach(function (p) { byId[p.id] = p.i; });
      return { raw: m, parts: parts, byId: byId, systems: m.systems || [], chunks: m.chunks || [], lod: m.lod || null };
    }
    function roleForPart(part, sysId) {
      if (PART_RIG[part.id]) return PART_RIG[part.id];
      if (GREAT_VESSEL_IDS[part.id]) return "vessel";
      if (sysId === "cardiac") return "LV";
      if (sysId === "skeletal") return part.canon === "RIB" || part.canon === "STERNUM" || /rib|sternum/i.test(part.name) ? "ribs" : null;
      if (sysId === "respiratory") return /lung/i.test(part.name) ? "lungs" : null;
      if (sysId === "digestive") return /liver/i.test(part.name) ? "liver" : null;
      if (sysId === "muscular") return /diaphragm/i.test(part.name) ? "context" : null;
      if (sysId === "integumentary") return "chestwall";
      if (sysId === "arterial") return /aorta|pulmonary/i.test(part.name) ? "vessel" : null;
      if (sysId === "venous") return /vena cava|pulmonary vein|hepatic vein/i.test(part.name) ? "vessel" : null;
      return null;
    }
    function ingestManifest(m) { manifest = parseManifest(m); return manifest; }
    /* raw = decompressed chunk ArrayBuffer; chunk = manifest chunk entry.
     * Wanted parts are extracted by per-vertex pid (atlas layout). */
    function ingestChunk(chunk, raw) {
      if (!manifest) throw new Error("ingestManifest first");
      var posF = new Float32Array(raw, chunk.pos, chunk.v * 3);
      var pid = new Uint16Array(raw, chunk.pid, chunk.v);
      var idxU = new Uint32Array(raw, chunk.idx, chunk.i);
      /* patient-frame origin: FJ2422 bounds centre, atlas metres */
      var lvPart = null, pi;
      for (pi = 0; pi < manifest.parts.length; pi++) if (manifest.parts[pi].id === "FJ2422") lvPart = manifest.parts[pi];
      var org = lvPart ? [(lvPart.b[0] + lvPart.b[3]) / 2, (lvPart.b[1] + lvPart.b[4]) / 2, (lvPart.b[2] + lvPart.b[5]) / 2] : [0, 1.3, 0];
      function toPatient(o) { return [(posF[o] - org[0]) * 1000, (posF[o + 2] - org[2]) * 1000, (posF[o + 1] - org[1]) * 1000]; }
      var byPid = {};
      var ti;
      for (ti = 0; ti + 2 < idxU.length; ti += 3) {
        var p0 = pid[idxU[ti]];
        if (p0 !== pid[idxU[ti + 1]] || p0 !== pid[idxU[ti + 2]]) continue;
        (byPid[p0] = byPid[p0] || []).push(idxU[ti], idxU[ti + 1], idxU[ti + 2]);
      }
      var added = 0;
      Object.keys(byPid).forEach(function (key) {
        var part = manifest.parts[+key]; if (!part || part.src) return;
        var sysId = (manifest.systems[part.sys] || {}).id || "";
        var role = roleForPart(part, sysId);
        if (!role) return;
        if (loadedParts.some(function (lp) { return lp.id === part.id; })) return;
        var tris = byPid[key], verts = {}, posArr = [], idxArr = [], cen = [0, 0, 0];
        tris.forEach(function (vi) {
          if (verts[vi] == null) { var p = toPatient(vi * 3); verts[vi] = posArr.length / 3; posArr.push(p[0], p[1], p[2]); cen[0] += p[0]; cen[1] += p[1]; cen[2] += p[2]; }
          idxArr.push(verts[vi]);
        });
        var nv = Math.max(1, posArr.length / 3);
        var rig = PART_RIG[part.id] || (role === "vessel" ? "vessel" : (role === "ribs" || role === "lungs" || role === "liver" || role === "chestwall" || role === "context" ? "context" : role));
        var acName = role === "ribs" ? "bone" : role === "lungs" ? "air" : role === "liver" ? "liver" : (PART_RIG[part.id] && /FJ242[02]|FJ243/.test(part.id) && PART_RIG[part.id].length <= 2 ? "valve" : (rig === "vessel" ? "blood" : "blood"));
        if (part.id === "FJ2428" || part.id === "FJ2438" || part.id === "FJ2439") acName = "myocardium";
        loadedParts.push({ id: part.id, name: part.name, role: (role === "ribs" || role === "lungs" || role === "liver" || role === "chestwall") ? role : "bp3d", rig: rig, basePos: posArr, idx: idxArr, centroid0: [cen[0] / nv, cen[1] / nv, cen[2] / nv], acoustic: acoustic(acName) });
        added++;
      });
      built = null;
      if (lastState) build(lastState);
      return added;
    }
    function loadAtlas(opts) {
      opts = opts || {};
      var base = opts.baseUrl || "";
      var manifestUrl = opts.manifestUrl || (base + "/atlas/3d/manifest.json");
      function inflate(buf, rawBytes) {
        if (buf.byteLength === rawBytes) return Promise.resolve(buf);
        var stream = new G.Blob([buf]).stream().pipeThrough(new G.DecompressionStream("gzip"));
        return new G.Response(stream).arrayBuffer();
      }
      return G.fetch(manifestUrl).then(function (r) { return r.json(); }).then(function (m) {
        ingestManifest(m);
        var d = manifest;
        var chunkList = (opts.lod !== false && d.lod && d.lod.chunks && d.lod.chunks.length) ? d.lod.chunks : d.chunks;
        var wantSys = { cardiac: 1, arterial: 1, venous: 1, skeletal: 1, respiratory: 1, digestive: 1 };
        var chunks = chunkList.filter(function (c) { return wantSys[c.system] && !c.src; });
        if (opts.systems) chunks = chunkList.filter(function (c) { return opts.systems.indexOf(c.system) >= 0 && !c.src; });
        var total = 0;
        return chunks.reduce(function (chain, c) {
          return chain.then(function () {
            return G.fetch(base + c.url).then(function (r) { return r.arrayBuffer(); }).then(function (buf) { return inflate(buf, c.bytes); }).then(function (raw) { total += ingestChunk(c, raw); }).catch(function () { /* one chunk failing keeps the rest */ });
          });
        }, Promise.resolve()).then(function () { return { parts: loadedParts.length, added: total, chunks: chunks.length }; });
      });
    }

    /* ---------- public api ---------- */
    function update(state) {
      var st = state || (heart && heart.state ? heart.state() : null);
      if (!st) throw new Error("KARDIA_GEOM: no heart state (pass a KARDIA_HEART instance or a state)");
      return build(st);
    }
    var api = {
      update: update,
      buffers: buffers,
      cut: cut,
      viewPlane: viewPlane,
      viewById: viewById,
      structures: currentStructures,
      meshVolume: structureVolume,
      setHeart: function (h) { heart = h; return api; },
      getHeart: function () { return heart; },
      setViews: function (v) { viewsData = v; return api; },
      setPathology: function (p) { if (p) for (var k in p) pathology[k] = p[k]; if (lastState) build(lastState); return api; },
      getPathology: function () { var o = {}, k; for (k in pathology) o[k] = pathology[k]; return o; },
      ingestManifest: ingestManifest,
      ingestChunk: ingestChunk,
      loadAtlas: loadAtlas,
      loadedParts: function () { return loadedParts.map(function (lp) { return { id: lp.id, name: lp.name, rig: lp.rig, role: lp.role }; }); },
      state: function () { return lastState; },
      createRenderer: function (canvas) { return createRenderer(canvas, api); },
      _structures: function () { return structures; }
    };
    if (heart) update();
    return api;
  }

  /* ---------- minimal WebGL1 renderer (own shaders, no atlas copy) --- */
  function createRenderer(canvas, geom) {
    var gl = null, prog = null, vb = null, nb = null, ib = null, groups = [], lost = false, errors = [];
    var VS = "attribute vec3 aPos; attribute vec3 aNrm; uniform mat4 uVP; varying vec3 vN; varying vec3 vP;\nvoid main(){ vN=aNrm; vP=aPos; gl_Position=uVP*vec4(aPos,1.0); }";
    var FS = "precision mediump float; varying vec3 vN; varying vec3 vP; uniform vec3 uColor; uniform vec3 uEye;\nvoid main(){ vec3 n=normalize(vN); if(!gl_FrontFacing) n=-n; vec3 L=normalize(vec3(-0.45,0.8,0.55)); float d=max(dot(n,L),0.0); vec3 c=uColor*(0.30+0.65*d); gl_FragColor=vec4(c,1.0); }";
    function compile(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = new Error("shader: " + gl.getShaderInfoLog(s)); errors.push(String(e.message)); throw e; } return s; }
    function buildGL() {
      gl = canvas.getContext("webgl", { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: false }) || canvas.getContext("experimental-webgl");
      if (!gl) throw new Error("WebGL unavailable");
      if (!gl.getExtension("OES_element_index_uint")) throw new Error("OES_element_index_uint unavailable");
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
      gl.bindAttribLocation(prog, 0, "aPos"); gl.bindAttribLocation(prog, 1, "aNrm"); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(prog));
      vb = gl.createBuffer(); nb = gl.createBuffer(); ib = gl.createBuffer();
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      upload();
    }
    function upload() {
      var b = geom.buffers(); groups = b.groups;
      gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, b.positions, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, b.normals, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b.indices, gl.STATIC_DRAW);
      renderer.triangleCount = b.triangleCount;
    }
    function perspective(fov, asp, near, far) { var f = 1 / Math.tan(fov * Math.PI / 360), nf = 1 / (near - far); return [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]; }
    function lookAt(eye, tgt, up) { var z = norm(sub(eye, tgt)), x = norm(cross(up, z)), y = cross(z, x); return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]; }
    function mulM(a, b) { var o = new Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; }
    function colorFor(g) {
      var e = g.acoustic ? g.acoustic.echogenicity : 0.4;
      if (g.acoustic && g.acoustic.isBlood) return [0.25 + e, 0.06, 0.07];
      if (g.acoustic && g.acoustic.isBone) return [0.85, 0.80, 0.66];
      if (g.acoustic && g.acoustic.isAir) return [0.45, 0.55, 0.62];
      if (g.kind && g.kind.indexOf("valve") >= 0) return [0.80, 0.62, 0.52];
      return [0.45 + e * 0.5, 0.22 + e * 0.3, 0.20 + e * 0.25];
    }
    var renderer = {
      errors: errors, triangleCount: 0,
      render: function (opts) {
        opts = opts || {};
        if (lost || !gl) return false;
        if (opts.refresh !== false) { geom.update(); upload(); }
        var w = canvas.width, h = canvas.height;
        gl.viewport(0, 0, w, h); gl.clearColor(0.07, 0.08, 0.09, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        var yaw = opts.yaw == null ? 0.6 : opts.yaw, pitch = opts.pitch == null ? 0.15 : opts.pitch, dist = opts.dist || 340;
        var eye = [dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.cos(pitch) * Math.cos(yaw) + 10, dist * Math.sin(pitch)];
        var vp = mulM(perspective(38, w / Math.max(1, h), 2, 1200), lookAt(eye, [0, 0, 0], [0, 0, 1]));
        gl.useProgram(prog);
        gl.uniformMatrix4fv(gl.getUniformLocation(prog, "uVP"), false, new Float32Array(vp));
        gl.uniform3f(gl.getUniformLocation(prog, "uEye"), eye[0], eye[1], eye[2]);
        gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        for (var i = 0; i < groups.length; i++) {
          var g = groups[i]; /* skip the big chest-wall shell: it would hide the heart */
          if (g.id === "chest_wall") continue;
          var c = colorFor(g); gl.uniform3f(gl.getUniformLocation(prog, "uColor"), c[0], c[1], c[2]);
          gl.drawElements(gl.TRIANGLES, g.indexCount, gl.UNSIGNED_INT, g.indexStart * 4);
        }
        return true;
      },
      readFrame: function () {
        if (!renderer.render({ refresh: false })) return null;
        var w = canvas.width, h = canvas.height, px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return { w: w, h: h, px: px };
      },
      isLost: function () { return lost; },
      dispose: function () { try { if (gl) { gl.deleteBuffer(vb); gl.deleteBuffer(nb); gl.deleteBuffer(ib); gl.deleteProgram(prog); } } catch (e) {} gl = null; }
    };
    renderer._loseContext = function () { var ext = gl && gl.getExtension("WEBGL_lose_context"); if (ext) { renderer._loseExt = ext; ext.loseContext(); } return !!ext; };
    renderer._restoreContext = function () { if (renderer._loseExt) renderer._loseExt.restoreContext(); };
    canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); lost = true; }, false);
    canvas.addEventListener("webglcontextrestored", function () { try { var old = canvas; buildGL(); lost = false; } catch (err) { errors.push(String(err && err.message || err)); } }, false);
    buildGL();
    return renderer;
  }

  var API = {
    create: create, ACOUSTIC: ACOUSTIC, lvSegment: lvSegment,
    APEX_DIR: APEX_DIR.slice(), meshVolume: meshVolume,
    _pure: { meshVolume: meshVolume, lvSegment: lvSegment, prolateAxes: prolateAxes }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_GEOM = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));




