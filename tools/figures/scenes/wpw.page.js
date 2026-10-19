/* WPW scene: SA node, AV node gate, accessory bypass on a real heart, orthodromic circuit, AF pre-excitation, ECG and gauges. */
const E = SC.ECG, WW = SC.W;
const HX = 277, HY = 242, HW = 270, HS = HW / 100;
const SAN = [Math.round(HX + 30 * HS), Math.round(HY - 15 * HS)];
const AVN = [Math.round(HX - HS), Math.round(HY - 6 * HS)];
const HIS = [Math.round(HX + 3 * HS), Math.round(HY + 8 * HS)];
const BYA = [Math.round(HX - 38 * HS), Math.round(HY - 8 * HS)];
const BYV = [Math.round(HX - 30 * HS), Math.round(HY + 26 * HS)];
const VEN = [Math.round(HX + 12 * HS), Math.round(HY + 28 * HS)];
const BYM = [Math.round((BYA[0] + BYV[0]) / 2 - 4), Math.round((BYA[1] + BYV[1]) / 2)];
const L = { heart: $("heart"), inset: $("inset"), marks: $("marks"), imps: $("imps"), ecg: $("ecg"), over: $("over"), panel: $("panel") };
let heartO = null, zA = null, zV = null;
let actA = 0, actV = 0;
const trk = {};
const sm = { rate: 0.7, delta: 0.1, circ: 0.5, danger: 0.3, avBlock: 0, bypass: 1, chaos: 0, irreg: 0.1, abl: 0, vagal: 0, plug: 0, code: 2 };
const gg = {};
let beatT = 0.4, afT = 0.3, circT = 0.2, Tsec = 0;
const holdQ = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null, sp: 1, cb: null }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const dots = pool(12, () => mk("circle", { class: "wp-imp", r: 5 }, L.imps));
function launch(tr, dur, cb) { const p = freeP(dots); if (!p) { if (cb) cb(); return; } p.on = true; p.tr = tr; p.u = 0; p.sp = 1 / Math.max(0.05, dur); p.cb = cb || null; p.e.setAttribute("opacity", "1"); const q = tr.at(0); p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y)); }
function flashA() { actA = 1; }
function flashV() { actV = 1; }
const wavelets = [], blockers = [];
let ecgPath = null, ecgTxt = null, insetDot = null, dualDot = null, avMark = null, ablMark = null;
let accEl = null, bypA = null, bypB = null, avWire = null, hisWire = null, vagalHalo = null;
let capEl = null, capKey = "";
function intervalOf() { return 1.25 - 0.78 * sm.rate; }
function phaseAt(tSec) {
  const code = sm.code;
  if (code === 3 || code === 4) {
    const RR = [0.36, 0.5, 0.42, 0.58, 0.39, 0.52];
    const fac = code === 3 ? 0.92 : 1.35, sum = RR.reduce((s, v) => s + v * fac, 0);
    let tt = ((tSec % sum) + sum) % sum;
    for (let i = 0; i < RR.length; i++) { const iv = RR[i] * fac; if (tt < iv) return tt / iv; tt -= iv; }
    return 0;
  }
  const per = intervalOf();
  return ((tSec % per) + per) % per / per;
}
function ecgVal(tSec) {
  const p = phaseAt(tSec), code = sm.code; let v = 0;
  if (code === 3 || code === 4) v += 0.05 * Math.sin(tSec * 31) + 0.04 * Math.sin(tSec * 47 + 1.2);
  if (code === 0 || code === 1) {
    if (p > 0.06 && p < 0.18) v += 0.13 * Math.sin(Math.PI * (p - 0.06) / 0.12);
    if (sm.delta > 0.25 && p > 0.20 && p < 0.34) v += sm.delta * 0.34 * ((p - 0.20) / 0.14);
    if (p > 0.29 && p < 0.315) v -= 0.10 * Math.sin(Math.PI * (p - 0.29) / 0.025);
    if (p > 0.315 && p < 0.355) v += 0.95 * Math.sin(Math.PI * (p - 0.315) / 0.04);
    if (p > 0.355 && p < 0.38) v -= 0.20 * Math.sin(Math.PI * (p - 0.355) / 0.025);
    if (p > 0.48 && p < 0.72) v += 0.26 * Math.sin(Math.PI * (p - 0.48) / 0.24);
  } else if (code === 2) {
    if (p > 0.05 && p < 0.075) v -= 0.10 * Math.sin(Math.PI * (p - 0.05) / 0.025);
    if (p > 0.075 && p < 0.115) v += 1.0 * Math.sin(Math.PI * (p - 0.075) / 0.04);
    if (p > 0.115 && p < 0.14) v -= 0.20 * Math.sin(Math.PI * (p - 0.115) / 0.025);
    if (p > 0.26 && p < 0.50) v += 0.24 * Math.sin(Math.PI * (p - 0.26) / 0.24);
  } else {
    const wide = code === 3;
    if (wide) { if (p > 0.04 && p < 0.16) v += 0.92 * Math.sin(Math.PI * (p - 0.04) / 0.12); if (p > 0.30 && p < 0.56) v += 0.22 * Math.sin(Math.PI * (p - 0.30) / 0.26); }
    else { if (p > 0.05 && p < 0.09) v += 1.0 * Math.sin(Math.PI * (p - 0.05) / 0.04); if (p > 0.09 && p < 0.115) v -= 0.18 * Math.sin(Math.PI * (p - 0.09) / 0.025); if (p > 0.26 && p < 0.50) v += 0.24 * Math.sin(Math.PI * (p - 0.26) / 0.24); }
  }
  return v;
}
function capText(d, l) {
  if (d === 1) {
    if (l === 1) return "Vagal manoeuvre slows the gate. The loop breaks and a normal beat returns.";
    if (l === 2) return "Vagal manoeuvre slows the gate only. AF still races down the bridge.";
    return "Vagal manoeuvre slows the gate. Beats slow a little.";
  }
  if (d === 2) {
    if (l === 1) return "Adenosine plugs the gate. The loop breaks and a normal beat returns.";
    if (l === 2) return "Adenosine plugs the gate. More beats rush down the bridge, which is unsafe.";
    return "Adenosine plugs the gate. Beats slow until it wears off.";
  }
  if (d === 3) {
    if (l === 1) return "Ablation scars the bridge shut. The loop cannot run again.";
    if (l === 2) return "Ablation scars the bridge shut. AF can only pass through the gate.";
    return "Ablation scars the bridge shut. Beats use the normal gate only.";
  }
  if (l === 1) return "No treatment. The beat loops down the gate and up the bridge, fast and regular.";
  if (l === 2) return "No treatment. In AF many beats race down the bridge, very fast and wide.";
  return "No treatment. The bridge fires early, so each beat starts with a slur.";
}
function initOrgans() {
  heartO = organ($("heartSlot"), "heart", HX, HY, HW, {});
  trk.bach = track([SAN, [315, 193], [240, 198], BYA]);
  trk.inter = track([SAN, [328, 214], [300, 221], AVN]);
  trk.his = track([AVN, HIS]);
  trk.lbb = track([HIS, [296, 292], VEN]);
  trk.rbb = track([HIS, [256, 292], [224, 318]]);
  trk.accDown = track([BYA, [158, 250], [166, 286], BYV]);
  trk.accUp = track([VEN, [252, 330], [210, 326], BYV, [166, 286], [158, 250], BYA]);
  trk.downFull = track([SAN, [328, 214], [300, 221], AVN, HIS, [296, 292], VEN]);
  const H = L.heart;
  zA = mk("ellipse", { class: "wp-zA", cx: 300, cy: 205, rx: 95, ry: 40 }, H);
  zV = mk("ellipse", { class: "wp-zV", cx: 272, cy: 318, rx: 95, ry: 55 }, H);
  mk("path", { class: "wp-wire", d: "M" + SAN[0] + " " + SAN[1] + "L315 193L240 198L" + BYA[0] + " " + BYA[1] }, H);
  avWire = mk("path", { class: "wp-wire", d: "M" + SAN[0] + " " + SAN[1] + "L328 214L300 221L" + AVN[0] + " " + AVN[1] }, H);
  hisWire = mk("path", { class: "wp-wire", d: "M" + AVN[0] + " " + AVN[1] + "L" + HIS[0] + " " + HIS[1] + "L296 292L" + VEN[0] + " " + VEN[1] + "M" + HIS[0] + " " + HIS[1] + "L256 292L224 318" }, H);
  accEl = mk("path", { class: "wp-acc", id: "accPath", d: "M" + BYA[0] + " " + BYA[1] + "L158 250L166 286L" + BYV[0] + " " + BYV[1] }, H);
  mk("circle", { class: "wp-node", cx: SAN[0], cy: SAN[1], r: 8 }, H);
  mk("circle", { class: "wp-node", cx: AVN[0], cy: AVN[1], r: 9 }, H);
  mk("circle", { class: "wp-his", cx: HIS[0], cy: HIS[1], r: 5 }, H);
  bypA = mk("circle", { class: "wp-node2", cx: BYA[0], cy: BYA[1], r: 5 }, H);
  bypB = mk("circle", { class: "wp-node2", cx: BYV[0], cy: BYV[1], r: 5 }, H);
  vagalHalo = mk("circle", { class: "wp-vagal", cx: AVN[0], cy: AVN[1], r: 20, opacity: "0" }, H);
  for (let i = 0; i < 6; i++) blockers.push({ e: mk("circle", { class: "wp-block", r: 4, opacity: "0" }, H), a: i * 1.047 });
  const wc = [[-70, -8], [-35, -14], [0, -6], [35, -12], [65, -2]];
  wc.forEach(([dx, dy], i) => { const e = mk("circle", { class: "wp-node2", r: 3 }, L.imps); wavelets.push({ e, cx: 300 + dx, cy: 205 + dy, r: 8 + (i % 3) * 3, sp: 1.8 + (i % 3) * 0.6, ph: i * 1.2 }); });
}
function initInset() {
  const I = L.inset;
  mk("path", { class: "wp-wire", d: "M640 352L618 366L612 380L618 394L640 408" }, I);
  mk("path", { class: "wp-acc", id: "insetAcc", d: "M640 352L668 366L682 380L668 394L640 408" }, I);
  mk("circle", { class: "wp-inode", cx: 640, cy: 350, r: 15 }, I);
  mk("circle", { class: "wp-inode", cx: 640, cy: 410, r: 15 }, I);
  mk("circle", { class: "wp-node", cx: 612, cy: 380, r: 7 }, I);
  mk("circle", { class: "wp-node2", cx: 682, cy: 380, r: 5 }, I);
  const ta = mk("text", { class: "sc-lab", x: 640, y: 354, "text-anchor": "middle" }, I); ta.textContent = "A";
  const tv = mk("text", { class: "sc-lab", x: 640, y: 414, "text-anchor": "middle" }, I); tv.textContent = "V";
  mk("circle", { class: "wp-mag", cx: 838, cy: 368, r: 30 }, I);
  mk("path", { class: "wp-dual", d: "M826 348L838 368L826 388" }, I);
  mk("path", { class: "wp-dual2", d: "M850 348Q838 368 850 388" }, I);
  mk("circle", { class: "wp-node", cx: 838, cy: 368, r: 5 }, I);
  const tf = mk("text", { class: "sc-lab", x: 818, y: 342, "text-anchor": "middle" }, I); tf.textContent = "fast";
  const ts = mk("text", { class: "sc-lab", x: 858, y: 342, "text-anchor": "middle" }, I); ts.textContent = "slow";
  insetDot = mk("circle", { class: "wp-imp", r: 4.5 }, I);
  dualDot = mk("circle", { class: "wp-imp", r: 3.5 }, I);
}
function initPanel() {
  initInset();
  ecgPath = mk("path", { class: "wp-trace" }, L.ecg);
  ecgTxt = mk("text", { class: "sc-zone", x: E.x + E.w - 10, y: E.y + 16, "text-anchor": "end" }, L.ecg);
  const eh = mk("g", { class: "hot", tabindex: "0", "data-info": "One ECG lead. Sinus rhythm with pre-excitation: short PR interval and a slurred delta wave at the start of a widened QRS. Orthodromic SVT: regular narrow QRS with no delta wave. AF with pre-excitation: irregular, very fast, wide and varying QRS complexes." }, L.ecg);
  mk("rect", { x: E.x, y: E.y, width: E.w, height: E.h, fill: "transparent" }, eh);
  avMark = mk("g", { opacity: "0" }, L.marks);
  mk("circle", { class: "wp-x", cx: AVN[0], cy: AVN[1], r: 11 }, avMark); mk("path", { class: "wp-xp", d: "M" + (AVN[0] - 5) + " " + (AVN[1] - 5) + "l10 10m0 -10l-10 10" }, avMark);
  mk("circle", { class: "wp-x", cx: 624, cy: 366, r: 7 }, avMark); mk("path", { class: "wp-xp", d: "M621 363l6 6m0 -6l-6 6" }, avMark);
  ablMark = mk("g", { opacity: "0" }, L.marks);
  mk("circle", { class: "wp-x", cx: BYM[0], cy: BYM[1], r: 10 }, ablMark); mk("path", { class: "wp-xp", d: "M" + (BYM[0] - 5) + " " + (BYM[1] - 5) + "l10 10m0 -10l-10 10" }, ablMark);
  mk("circle", { class: "wp-x", cx: 682, cy: 380, r: 8 }, ablMark); mk("path", { class: "wp-xp", d: "M679 377l6 6m0 -6l-6 6" }, ablMark);
  const o = L.over;
  pill(o, "SA node", SAN[0], SAN[1], 470, 100, "SA node: the natural pacemaker. Each beat starts here and spreads across the atria.");
  pill(o, "AV node", AVN[0], AVN[1], 470, 215, "AV node and His bundle: the normal gate to the ventricles. It delays the beat so the ventricles can fill. Vagal tone and adenosine plug it here.");
  pill(o, "Bypass tract", BYM[0], BYM[1], 100, 140, "Bypass tract: an extra bridge from atrium to ventricle with no delay, so the ventricle starts early. Ablation scars it shut.");
  pill(o, "Ventricle", VEN[0], VEN[1], 100, 360, "Ventricle: early start through the bridge gives the slurred delta wave on the ECG.");
  pill(o, "Delta wave", 700, 150, 640, 275, "Delta wave: the slurred, slow start of the QRS in pre-excitation. Absent during orthodromic SVT and after ablation.");
  pill(o, "Re-entry loop", 647, 380, 758, 330, "Orthodromic re-entry: down the AV node to the ventricles, then back up the bridge to the atria, round and round. Plugging the AV node breaks it.");
  pill(o, "AF danger", 800, 150, 845, 275, "AF with pre-excitation: many impulses race down the bridge without AV nodal filtering. The pulse is very fast, wide and uneven. Plugging the AV node alone cannot stop it.");
  capEl = mk("text", { class: "wp-cap", x: 30, y: 428 }, o); capEl.textContent = capText(0, 1);
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The rhythm";
  [["rate", "Ventricular rate", "g-bad", "How fast the ventricles beat. Orthodromic SVT is fast and regular; AF with pre-excitation is very fast and irregular."], ["circ", "Re-entry circuit", "g-circ", "How strongly the re-entry loop is running."], ["delta", "Delta wave", "g-cyt", "Pre-excitation: how much ventricle is started early through the bypass. Present in sinus rhythm with WPW, absent during orthodromic SVT and after ablation."], ["danger", "Danger", "g-bad", "Risk from a very fast pre-excited response in AF, which can cause collapse. Blocking the AV node alone does not remove it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 180 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
}
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  Tsec += dt;
  const k1 = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  sm.rate = lerp(sm.rate, m.rate, k1); sm.delta = lerp(sm.delta, m.delta, k2); sm.circ = lerp(sm.circ, m.circ, k2);
  sm.danger = lerp(sm.danger, m.danger, k2); sm.avBlock = lerp(sm.avBlock, m.avBlock, k1); sm.bypass = lerp(sm.bypass, m.bypass, k2);
  sm.chaos = lerp(sm.chaos, m.chaos, k2); sm.irreg = lerp(sm.irreg, m.irreg, k2); sm.abl = lerp(sm.abl, m.ablated, k1); sm.code = m.code;
  sm.vagal = lerp(sm.vagal, drug === 1 ? 1 : 0, k1); sm.plug = lerp(sm.plug, drug === 2 ? 1 : 0, k1);
  for (let i = holdQ.length - 1; i >= 0; i--) { holdQ[i].t -= dt; if (holdQ[i].t <= 0) { const cb = holdQ[i].cb; holdQ.splice(i, 1); cb(); } }
  dots.forEach((p) => { if (!p.on) return; p.u += dt * p.sp; const q = p.tr.at(clamp(p.u)); p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y)); if (p.u >= 1) { killP(p); if (p.cb) p.cb(); } });
  if (sm.code === 0 || sm.code === 1) {
    beatT -= dt;
    if (beatT <= 0) { beatT += intervalOf(); flashA(); launch(trk.bach, 0.16, null); launch(trk.inter, 0.12, null);
      if (sm.bypass > 0.4) launch(trk.accDown, 0.22, () => flashV());
      holdQ.push({ t: 0.34, cb: () => { launch(trk.his, 0.04, null); launch(trk.lbb, 0.08, () => flashV()); launch(trk.rbb, 0.08, null); } });
    }
  } else if (sm.code === 2) {
    circT -= dt;
    if (circT <= 0) { circT += intervalOf(); flashA();
      launch(trk.downFull, 0.20, () => { flashV(); launch(trk.accUp, 0.20, () => flashA()); });
    }
  } else {
    afT -= dt;
    if (afT <= 0) { afT += rnd(0.26, 0.5) * (sm.code === 3 ? 0.85 : 1.3);
      if (sm.bypass > 0.4) launch(trk.accDown, 0.16, () => flashV());
      else launch(trk.downFull, 0.24, () => flashV());
    }
    actA = Math.max(actA, 0.2 + Math.random() * 0.25);
  }
  const dec = Math.exp(-dt * 3.4);
  actA *= dec; actV *= dec;
  if (zA) zA.style.setProperty("--act", actA.toFixed(2));
  if (zV) zV.style.setProperty("--act", actV.toFixed(2));
  wavelets.forEach((wv) => { const a = tm / 1000 * wv.sp + wv.ph, x = wv.cx + Math.cos(a) * wv.r, y = wv.cy + Math.sin(a * 1.3) * wv.r * 0.7; wv.e.setAttribute("cx", f1(x)); wv.e.setAttribute("cy", f1(y)); wv.e.setAttribute("opacity", sm.chaos > 0.15 ? "0.9" : "0"); });
  blockers.forEach((b, i) => { const a = tm / 1100 + b.a; b.e.setAttribute("cx", f1(AVN[0] + Math.cos(a) * 15)); b.e.setAttribute("cy", f1(AVN[1] + Math.sin(a) * 15)); b.e.setAttribute("opacity", clamp((sm.plug - 0.15) * 1.6).toFixed(2)); });
  if (vagalHalo) { vagalHalo.setAttribute("opacity", (sm.vagal * (0.45 + 0.25 * Math.sin(tm / 300))).toFixed(2)); vagalHalo.setAttribute("r", f1(20 + 3 * Math.sin(tm / 300))); }
  if (accEl) accEl.setAttribute("opacity", (0.15 + 0.85 * sm.bypass).toFixed(2));
  if (bypA) bypA.setAttribute("opacity", (0.2 + 0.8 * sm.bypass).toFixed(2));
  if (bypB) bypB.setAttribute("opacity", (0.2 + 0.8 * sm.bypass).toFixed(2));
  const inAcc = $("insetAcc"); if (inAcc) inAcc.setAttribute("opacity", (0.15 + 0.85 * sm.bypass).toFixed(2));
  if (avWire) avWire.setAttribute("opacity", (1 - 0.65 * sm.avBlock).toFixed(2));
  if (hisWire) hisWire.setAttribute("opacity", (1 - 0.65 * sm.avBlock).toFixed(2));
  if (avMark) avMark.setAttribute("opacity", clamp(sm.avBlock * 1.1).toFixed(2));
  if (ablMark) ablMark.setAttribute("opacity", sm.abl.toFixed(2));
  if (insetDot) { const a = tm / 1000 * 2.4, show = sm.code === 2 ? 1 : 0; insetDot.setAttribute("cx", f1(647 + Math.cos(a) * 36)); insetDot.setAttribute("cy", f1(380 + Math.sin(a) * 28)); insetDot.setAttribute("opacity", show ? (0.35 + 0.65 * sm.circ).toFixed(2) : "0"); }
  if (dualDot) { const a = -tm / 1000 * 3.1, show = sm.code === 2 ? 1 : 0; dualDot.setAttribute("cx", f1(838 + Math.cos(a) * 17)); dualDot.setAttribute("cy", f1(368 + Math.sin(a) * 17)); dualDot.setAttribute("opacity", show ? (0.35 + 0.65 * sm.circ).toFixed(2) : "0"); }
  let d = "";
  for (let x = E.x; x <= E.x + E.w; x += 3) { const age = (E.x + E.w - x) / 110, v = ecgVal(Tsec - age), y = clamp(E.base - 44 * v, E.y + 4, E.y + E.h - 4); d += (x === E.x ? "M" : "L") + x + " " + f1(y); }
  ecgPath.setAttribute("d", d);
  const ew = sm.code === 2 ? "SVT: narrow, regular" : sm.code === 3 ? "AF: fast, wide, irregular" : sm.code === 4 ? "AF via AV node" : sm.delta > 0.3 ? "sinus: delta wave" : "sinus rhythm";
  if (ecgTxt.textContent !== ew) ecgTxt.textContent = ew;
  gg.rate.set(sm.rate, wordOf(sm.rate, 0.38, 0.68, ["slow", "normal", "fast"]));
  gg.circ.set(sm.circ, wordOf(sm.circ, 0.25, 0.6, ["off", "weak", "running"]));
  gg.delta.set(sm.delta, wordOf(sm.delta, 0.15, 0.55, ["absent", "faint", "clear"]));
  gg.danger.set(sm.danger, wordOf(sm.danger, 0.25, 0.6, ["low", "raised", "high"]));
  const key = drug + ":" + level;
  if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
