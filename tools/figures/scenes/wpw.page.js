/* WPW scene: SA node, AV node with dual pathways, accessory bypass, orthodromic circuit, AF pre-excitation, ECG and gauges. */
const G = SC.GEO, E = SC.ECG, WW = SC.W;
const L = { imps: $("imps"), marks: $("marks"), ecg: $("ecg"), over: $("over"), panel: $("panel"), inset: $("inset") };
const chEls = { ra: $("ch-ra"), la: $("ch-la"), rv: $("ch-rv"), lv: $("ch-lv") };
const act = { ra: 0, la: 0, rv: 0, lv: 0 };
const trk = { bach: track(G.bach), inter: track(G.inter), his: track(G.hisTrack), lbb: track(G.lbb), rbb: track(G.rbb), accDown: track(G.accDown), accUp: track(G.accUp), downFull: track(G.downFull) };
const sm = { rate: 0.7, delta: 0.1, circ: 0.5, danger: 0.3, avBlock: 0, bypass: 1, chaos: 0, irreg: 0.1, abl: 0, code: 2 };
const gg = {};
let beatT = 0.4, afT = 0.3, circT = 0.2, Tsec = 0;
const holdQ = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null, sp: 1, cb: null }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const dots = pool(12, () => mk("circle", { class: "wp-imp", r: 5 }, L.imps));
function launch(tr, dur, cb) { const p = freeP(dots); if (!p) { if (cb) cb(); return; } p.on = true; p.tr = tr; p.u = 0; p.sp = 1 / Math.max(0.05, dur); p.cb = cb || null; p.e.setAttribute("opacity", "1"); const q = tr.at(0); p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y)); }
function flashA() { act.ra = 1; act.la = 1; }
function flashV() { act.rv = 1; act.lv = 1; }
const wavelets = [];
let ecgPath = null, ecgTxt = null, insetDot = null, dualDot = null, avMark = null, ablMark = null;
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
  const wc = [[205, 145], [235, 170], [320, 140], [355, 168], [300, 175]];
  wc.forEach(([x, y], i) => { const e = mk("circle", { class: "wp-node2", r: 3 }, L.imps); wavelets.push({ e, cx: x, cy: y, r: 8 + (i % 3) * 3, sp: 1.8 + (i % 3) * 0.6, ph: i * 1.2 }); });
}
function initPanel() {
  initInset();
  ecgPath = mk("path", { class: "wp-trace" }, L.ecg);
  ecgTxt = mk("text", { class: "sc-zone", x: E.x + E.w - 10, y: E.y + 16, "text-anchor": "end" }, L.ecg);
  const eh = mk("g", { class: "hot", tabindex: "0", "data-info": "One ECG lead. Sinus rhythm with pre-excitation: short PR interval and a slurred delta wave at the start of a widened QRS. Orthodromic SVT: regular narrow QRS with no delta wave. AF with pre-excitation: irregular, very fast, wide and varying QRS complexes." }, L.ecg);
  mk("rect", { x: E.x, y: E.y, width: E.w, height: E.h, fill: "transparent" }, eh);
  avMark = mk("g", { opacity: "0" }, L.marks);
  mk("circle", { class: "wp-x", cx: G.av[0] + 18, cy: G.av[1] - 14, r: 8 }, avMark); mk("path", { class: "wp-xp", d: "M" + (G.av[0] + 14) + " " + (G.av[1] - 18) + "l8 8m0 -8l-8 8" }, avMark);
  mk("circle", { class: "wp-x", cx: 624, cy: 366, r: 7 }, avMark); mk("path", { class: "wp-xp", d: "M621 363l6 6m0 -6l-6 6" }, avMark);
  ablMark = mk("g", { opacity: "0" }, L.marks);
  mk("circle", { class: "wp-x", cx: 415, cy: 252, r: 9 }, ablMark); mk("path", { class: "wp-xp", d: "M411 248l8 8m0 -8l-8 8" }, ablMark);
  mk("circle", { class: "wp-x", cx: 682, cy: 380, r: 8 }, ablMark); mk("path", { class: "wp-xp", d: "M679 377l6 6m0 -6l-6 6" }, ablMark);
  const o = L.over;
  pill(o, "SA node", G.sa[0], G.sa[1], 80, 132, "Sinoatrial node: the normal pacemaker. It fires, the atria activate, and the impulse then reaches both the AV node and the accessory pathway.");
  pill(o, "Atria", 340, 120, 480, 110, "Atria: the top chambers. Their activation is the P wave. In AF they fibrillate with chaotic, rapid activity and no organised P wave.");
  pill(o, "AV node", G.av[0], G.av[1], 480, 225, "Compact AV node: the normal gateway to the ventricles. It delays the impulse so the ventricles can fill. Inside it, dual pathways (a fast and a slow pathway) can sustain AVNRT.");
  pill(o, "Bypass tract", 415, 252, 485, 305, "Accessory pathway (bypass tract): an extra muscle bridge from atrium to ventricle that bypasses the AV node. It conducts fast and without the normal delay, so the ventricle starts early.");
  pill(o, "His bundle", G.his[0], G.his[1], 480, 365, "Bundle of His and bundle branches: the fast route from the AV node that activates both ventricles together, giving a narrow QRS when it is the only route used.");
  pill(o, "Ventricle", 150, 330, 62, 300, "Ventricles: the pumping chambers. Early activation through the bypass gives the delta wave; activation only through the His-Purkinje system gives a narrow QRS.");
  pill(o, "Delta wave", 640, 155, 640, 275, "Delta wave: the slurred, slow start of the QRS in pre-excitation. Part of the ventricle starts through the bypass (slow muscle to muscle spread), then the rest follows fast through the His-Purkinje system.");
  pill(o, "Fast wide QRS", 800, 150, 835, 275, "In AF with pre-excitation many atrial impulses race down the bypass without AV nodal filtering: the ventricular rate is very fast, irregular and wide, and it can collapse or degenerate. This is the dangerous form.");
  pill(o, "Re-entry loop", 647, 380, 750, 332, "Orthodromic re-entry: down the AV node and His-Purkinje system to the ventricles (narrow QRS), then back up the accessory pathway to the atria, round and round. It needs the AV node, so AV nodal block can break it.");
  pill(o, "Dual pathways", 838, 368, 838, 440, "AVNRT: dual AV nodal pathways, a fast and a slow pathway in and around the compact AV node. The impulse loops between them, activating atria and ventricles almost together. Ablation targets the slow pathway.");
  const pv = pill(o, "Vagal slows AV node", G.av[0], G.av[1], 660, 440, "A vagal manoeuvre raises vagal tone and slows the AV node. It can terminate SVT that needs the AV node, but it does not stop AF racing down the bypass."); pv.setAttribute("id", "p-vagal"); pv.style.opacity = 0;
  const pa = pill(o, "AV node blocked", G.av[0], G.av[1], 660, 440, "Adenosine transiently blocks the AV node. That breaks orthodromic AVRT and AVNRT, but in AF with pre-excitation it can shunt more impulses down the bypass, so it is avoided there."); pa.setAttribute("id", "p-adeno"); pa.style.opacity = 0;
  const pb = pill(o, "Pathway ablated", 415, 252, 660, 440, "Catheter ablation destroys the accessory pathway (or the slow pathway in AVNRT). Pre-excitation and the re-entry circuit are removed, so SVT does not recur and AF can only reach the ventricles through the AV node."); pb.setAttribute("id", "p-abl"); pb.style.opacity = 0;
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The rhythm";
  [["rate", "Ventricular rate", "g-bad", "How fast the ventricles beat. Orthodromic SVT is fast and regular; AF with pre-excitation is very fast and irregular."], ["circ", "Re-entry circuit", "g-circ", "How strongly the re-entry loop (or the dual pathway loop in AVNRT) is running."], ["delta", "Delta wave", "g-cyt", "Pre-excitation: how much ventricle is started early through the bypass. Present in sinus rhythm with WPW, absent during orthodromic SVT and after ablation."], ["danger", "Danger", "g-bad", "Risk from a very fast pre-excited response in AF, which can cause collapse. Blocking the AV node alone does not remove it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 180 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
}
function init() { initPanel(); }
function step(dt, m) {
  Tsec += dt;
  const k1 = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  sm.rate = lerp(sm.rate, m.rate, k1); sm.delta = lerp(sm.delta, m.delta, k2); sm.circ = lerp(sm.circ, m.circ, k2);
  sm.danger = lerp(sm.danger, m.danger, k2); sm.avBlock = lerp(sm.avBlock, m.avBlock, k1); sm.bypass = lerp(sm.bypass, m.bypass, k2);
  sm.chaos = lerp(sm.chaos, m.chaos, k2); sm.irreg = lerp(sm.irreg, m.irreg, k2); sm.abl = lerp(sm.abl, m.ablated, k1); sm.code = m.code;
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
    act.ra = Math.max(act.ra, 0.2 + Math.random() * 0.25); act.la = Math.max(act.la, 0.2 + Math.random() * 0.25);
  }
  const dec = Math.exp(-dt * 3.4);
  ["ra", "la", "rv", "lv"].forEach((n) => { act[n] *= dec; chEls[n].style.setProperty("--act", act[n].toFixed(2)); });
  wavelets.forEach((wv) => { const a = tm / 1000 * wv.sp + wv.ph, x = wv.cx + Math.cos(a) * wv.r, y = wv.cy + Math.sin(a * 1.3) * wv.r * 0.7; wv.e.setAttribute("cx", f1(x)); wv.e.setAttribute("cy", f1(y)); wv.e.setAttribute("opacity", sm.chaos > 0.15 ? "0.9" : "0"); });
  const accEl = $("accPath"); if (accEl) accEl.setAttribute("opacity", (0.15 + 0.85 * sm.bypass).toFixed(2));
  const accN = $("accNode"); if (accN) accN.setAttribute("opacity", (0.2 + 0.8 * sm.bypass).toFixed(2));
  const inAcc = $("insetAcc"); if (inAcc) inAcc.setAttribute("opacity", (0.15 + 0.85 * sm.bypass).toFixed(2));
  if (avMark) avMark.setAttribute("opacity", clamp(sm.avBlock * 1.1).toFixed(2));
  if (ablMark) ablMark.setAttribute("opacity", sm.abl.toFixed(2));
  $("p-vagal").style.opacity = m.drug === 1 ? "1" : "0"; $("p-adeno").style.opacity = m.drug === 2 ? "1" : "0"; $("p-abl").style.opacity = m.drug === 3 ? "1" : "0";
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
}
run({ init, step });
