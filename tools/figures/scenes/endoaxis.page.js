/* Endocrine axes scene: thyroid and adrenal axes, hormone flow, negative feedback, treatment overlays and the gauges. */
const L = { arrows: $("arrows"), nodes: $("nodes"), parts: $("parts"), over: $("over"), panel: $("panel") };
const AXES = [
  { ox: 0, title: "THYROID AXIS", rel: "TRH", pit: "TSH", gl: "Thyroid gland", end: "T4 and T3", gcls: "eos", st: ["hypothyroid", "euthyroid", "thyrotoxic"],
    relInfo: "TRH (thyrotropin-releasing hormone) from the hypothalamus. It travels a short portal circuit to the pituitary and makes it release TSH.",
    pitInfo: "TSH (thyroid-stimulating hormone) from the pituitary. It drives the thyroid to make hormone and keeps the gland grown.",
    endInfo: "T4 and T3, the thyroid hormones. They set the body's metabolic pace and feed back to turn TSH and TRH down.",
    glInfo: "Thyroid gland: TSH drives it to make and release thyroid hormone. Without TSH it shrinks; with a lot of TSH it can enlarge.",
    tisInfo: "Target tissues: thyroid hormone sets metabolic rate, heart rate and warmth. Too little slows them; too much speeds them up." },
  { ox: 480, title: "ADRENAL AXIS", rel: "CRH", pit: "ACTH", gl: "Adrenal cortex", end: "Cortisol", gcls: "graft", st: ["cortisol deficient", "cortisol normal", "cortisol excess"],
    relInfo: "CRH (corticotropin-releasing hormone) from the hypothalamus. It makes the pituitary release ACTH.",
    pitInfo: "ACTH (adrenocorticotropic hormone) from the pituitary. It drives the adrenal cortex to make cortisol and keeps that layer grown.",
    endInfo: "Cortisol, the stress and metabolic steroid. It feeds back to turn ACTH and CRH down.",
    glInfo: "Adrenal cortex: ACTH drives the cortisol-making layer. Without ACTH it shrinks. Aldosterone is mainly controlled by the renin system, not ACTH, and is left out.",
    tisInfo: "Target tissues: cortisol supports blood sugar, blood pressure and the stress response. Too little is dangerous in illness; too much causes Cushing features." },
];
const GY = 346, PY = 226, HY = 110;                        // node centres (local x = 200)
const sm = { H: 0.5, P: 0.5, G: 0.5, gs: 0.5, ps: 1, rp: 1, rh: 1, rep: 0, blk: 0, rmG: 0, rmP: 0, br: 0.5 };
const tracks = { rel: track([[200, 140], [200, 198]]), pit: track([[200, 254], [200, 306]]), end: track([[276, 350], [388, 350]]),
  fbP: track([[240, 326], [300, 322], [320, 300], [320, 226], [272, 226]]), fbH: track([[240, 326], [300, 322], [320, 300], [320, 110], [276, 110]]) };

function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, k: 0, x: 0, y: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, k) { p.on = true; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

function buildAxis(a) {
  const ox = a.ox, X = (x) => x + ox;
  const arr = mk("g", { transform: "translate(" + ox + " 0)" }, L.arrows);
  mk("path", { class: "ax-a", d: "M200 140V196M194 188L200 197L206 188" }, arr);
  mk("path", { class: "ax-a", d: "M200 254V304M194 296L200 305L206 296" }, arr);
  mk("path", { class: "ax-a", d: "M276 350H386M378 344L387 350L378 356" }, arr);
  const fbMain = mk("path", { class: "fb-l", d: "M240 326C285 324 320 318 320 292V226" }, arr), fbUp = mk("path", { class: "fb-l", d: "M320 226V110" }, arr);
  const fbPit = mk("path", { class: "fb-l", d: "M320 226H270" }, arr), fbHyp = mk("path", { class: "fb-l", d: "M320 110H276" }, arr);
  const tbP = mk("path", { class: "fb-t", d: "M266 212V240" }, arr), tbH = mk("path", { class: "fb-t", d: "M272 96V124" }, arr);
  const tis = mk("g", { transform: "translate(" + X(423) + " 350)" }, L.nodes);
  const tisBox = mk("g", { class: "hot", tabindex: "0", "data-info": a.tisInfo }, tis);
  mk("rect", { class: "ax-tis-o", x: -31, y: -32, width: 62, height: 64, rx: 14 }, tisBox);
  const tisFill = mk("rect", { class: "ax-tis", x: -31, y: -32, width: 62, height: 64, rx: 14, opacity: "0.3" }, tisBox);
  for (let i = 0; i < 3; i++) mk("circle", { class: "cl-b", cx: -14 + i * 14, cy: -10 + (i % 2) * 18, r: 6, style: "fill:var(--c-endo);stroke:var(--anatomy-mid)" }, tisBox);
  const stT = mk("text", { class: "ax-st", x: X(454), y: 402, "text-anchor": "end" }, L.over);
  const wrap = (cls, x, y, info, parent, seed, sx, sy, nuc) => { const g = mk("g", { class: "hot", tabindex: "0", "data-info": info }, parent || L.nodes), inner = mk("g", {}, g);
    cell(inner, { cls, r: 30, nuc, seed, wob: 0.1 }); return { g, inner, x: X(x), y }; };
  const hyp = wrap("mac", 200, HY, "Hypothalamus: part of the brain that sets the axis. It releases " + a.rel + " and senses the end hormone, turning its own output down when that hormone is high.", 0, 3 + a.ox, 0, 0.35);
  const pit = wrap("lymph", 200, PY, "Anterior pituitary: " + a.rel + " makes it release " + a.pit + ". It is switched down by the end hormone (negative feedback). A pituitary tumour can escape that brake.", 0, 5 + a.ox, 0, 0.35);
  const gl = wrap(a.gcls, 200, GY, a.glInfo, 0, 7 + a.ox, 0, 0.3);
  const ringG = mk("ellipse", { class: "ax-ring", cx: X(200), cy: GY, rx: 84, ry: 40, opacity: "0" }, L.over), ringP = mk("ellipse", { class: "ax-ring", cx: X(200), cy: PY, rx: 76, ry: 38, opacity: "0" }, L.over);
  /* particles */
  const rel = pool(12, () => mk("circle", { class: "sc-p p-rel", r: 2.6 }, L.parts)), pitp = pool(12, () => mk("rect", { class: "sc-p p-pit", x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: 1 }, L.parts));
  const endp = pool(22, () => mk("path", { class: "sc-p p-end", d: "M0 -3.4L3.4 0L0 3.4L-3.4 0Z" }, L.parts)), fb = pool(24, () => mk("circle", { class: "p-fb", r: 2.4 }, L.parts));
  const caps = pool(10, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -5, y: -2.5, width: 10, height: 5, rx: 2.5 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.5, width: 5, height: 5, rx: 2.5 }, g); return g; });
  const blks = pool(8, () => mk("path", { class: "p-blk", d: "M-3 -3L3 3M3 -3L-3 3", style: "stroke:var(--c-bad);stroke-width:2;fill:none" }, L.parts));
  /* labels */
  const o = L.over, P = (t, x, y, tx, ty, info) => pill(o, t, X(x), y, X(tx), ty, info);
  mk("text", { class: "sc-zone", x: X(34), y: 70 }, o).textContent = a.title;
  P("Hypothalamus", 142, 108, 72, 96, hyp.g.dataset.info);
  P("Pituitary", 151, 226, 62, 226, pit.g.dataset.info);
  P(a.gl, 148, 346, 70 + (a.gl.length > 13 ? 4 : 0), 346, a.glInfo);
  P(a.rel, 192, 168, 130, 168, a.relInfo);
  P(a.pit, 192, 282, 130, 282, a.pitInfo);
  P(a.end, 276, 350, 340, 378, a.endInfo);
  P("Negative feedback", 320, 170, 388, 170, "Negative feedback: the end hormone acts on the pituitary and the hypothalamus to turn their output down, which holds the end hormone near a set level. If it falls, the brake lifts and the drive rises. The line fades when the brake is weak, or when the target cannot respond.");
  P("Body tissues", 423, 318, 423, 296, a.tisInfo);
  const rm = P("Source removed", 160, 372, 70, 402, "The overactive gland or the pituitary tumour has been taken out. What is left makes little or none of its own signal, so the rest of the axis has to be replaced or it falls low.");
  const pr = P("Replacement hormone", 262, 364, 250, 424, "The missing end hormone given from outside. It acts on the tissues and also feeds back, so the pituitary drive falls once the body has enough. In a healthy axis it would overshoot.");
  const pb = P("Synthesis blocker", 262, 364, 250, 424, "A drug class that blocks the gland from making the end hormone. It lowers an excess, but in a failing axis it makes the deficit worse, and a pituitary tumour can drive harder when the feedback weakens.");
  return { a, ox, rel, pitp, endp, fb, caps, blks, acc: { rel: 0, pit: 0, end: 0, fb: 0, cap: 0, blk: 0 }, fbMain, fbUp, fbPit, fbHyp, tbP, tbH, tisFill, tis, stT, hyp, pit, gl, ringG, ringP, rm, pr, pb };
}
const axes = AXES.map(buildAxis);
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [130, 305, 480, 655, 830];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "Both axes (the same fault shown in each)";
  [["H", "Releasing hormone", "g-cyt", "TRH or CRH from the hypothalamus. It rises when the end hormone is low and the hypothalamus works; it falls when the end hormone is high or the hypothalamus fails."],
   ["P", "Pituitary hormone", "g-fl", "TSH or ACTH. High when the gland fails (no brake) or a pituitary tumour escapes; low when the end hormone is high, or when the pituitary or hypothalamus fails."],
   ["G", "End hormone", "g-eos", "Thyroid hormone or cortisol in the blood. It is the signal the body actually feels. Low means under-supplied tissues, high means over-exposed tissues."],
   ["gs", "Gland size", "g-neu", "Size of the thyroid or adrenal cortex. The pituitary hormone keeps the gland grown, so it shrinks without it. A tumour or removal changes it directly."],
   ["br", "Feedback brake", "g-bad", "How strongly the end hormone is telling the pituitary and hypothalamus to stand down. It follows the end hormone, but it only works if they can still respond."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h - 18, 18, cls, name, tip); });
}
function init() { initPanel(); }
function nodePlace(n, x, y, sx, sy, rot) { n.inner.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ") rotate(" + f1(rot) + ") scale(" + sx.toFixed(3) + " " + sy.toFixed(3) + ")"); }
function lineOp(el, v) { el.setAttribute("stroke-opacity", clamp(v).toFixed(2)); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.8);
  ["H", "P", "G", "gs", "ps", "rp", "rh", "rep", "blk", "rmG", "rmP"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  const br = sm.G;
  axes.forEach((A, ai) => {
    const ox = A.ox, ac = A.acc;
    const bs = 0.5 + 0.5 * Math.sin(tm / 1500 + ai), s = 0.4 + 0.75 * sm.gs;
    nodePlace(A.hyp, ox + 200, HY + Math.sin(tm / 1600 + ai) * 1.5, 2.0, 0.9, Math.sin(tm / 2600 + ai) * 2);
    nodePlace(A.pit, ox + 200, PY + Math.sin(tm / 1800 + ai) * 1.5, 1.7 * sm.ps, 0.85 * sm.ps, Math.sin(tm / 2900 + ai) * 2);
    nodePlace(A.gl, ox + 200, GY + Math.sin(tm / 2000 + ai) * 1.2, 2.1 * s, 0.95 * s, Math.sin(tm / 2400 + ai) * 2);
    A.ringG.setAttribute("opacity", sm.rmG.toFixed(2)); A.ringP.setAttribute("opacity", sm.rmP.toFixed(2));
    A.rm.style.opacity = Math.max(sm.rmG, sm.rmP).toFixed(2); A.pr.style.opacity = sm.rep.toFixed(2); A.pb.style.opacity = sm.blk.toFixed(2);
    [A.rm, A.pr, A.pb].forEach((g) => { g.style.pointerEvents = parseFloat(g.style.opacity) > 0.3 ? "auto" : "none"; });
    /* feedback lines and bars */
    const fo = 0.12 + 0.88 * br;
    lineOp(A.fbMain, fo); lineOp(A.fbUp, fo * Math.max(sm.rh, 0.3)); lineOp(A.fbPit, fo * (0.15 + 0.85 * sm.rp)); lineOp(A.fbHyp, fo * (0.15 + 0.85 * sm.rh));
    A.tbP.setAttribute("stroke-opacity", clamp(0.12 + br * sm.rp).toFixed(2)); A.tbH.setAttribute("stroke-opacity", clamp(0.12 + br * sm.rh).toFixed(2));
    /* tissue */
    A.tisFill.setAttribute("opacity", (0.1 + 0.7 * br).toFixed(2));
    A.tis.setAttribute("transform", "translate(" + (ox + 423) + " 350) scale(" + (1 + 0.04 * br * Math.sin(tm / (320 - 200 * br))).toFixed(3) + ")");
    const sw = br < 0.3 ? A.a.st[0] : br < 0.7 ? A.a.st[1] : A.a.st[2]; if (A.stT.textContent !== sw) A.stT.textContent = sw;
    /* hormone particles */
    ac.rel += dt * sm.H * 5; ac.pit += dt * sm.P * 5; ac.end += dt * sm.G * 6; ac.fb += dt * sm.G * 3.5;
    while (ac.rel >= 1) { ac.rel--; const p = free(A.rel); if (p) emit(p); }
    while (ac.pit >= 1) { ac.pit--; const p = free(A.pitp); if (p) emit(p); }
    while (ac.end >= 1) { ac.end--; const p = free(A.endp); if (p) emit(p); }
    while (ac.fb >= 1) { ac.fb--; const kk = Math.random() < 0.5 ? 0 : 1, p = free(A.fb); if (p && Math.random() < (kk ? sm.rh : sm.rp) * 0.9 + 0.1) emit(p, kk); }
    const move = (pl, tr, sp, getTr) => pl.forEach((p) => { if (!p.on) return; const T = getTr ? getTr(p) : tr; p.u += (sp / T.len) * dt; if (p.u >= 1) { kill(p); return; } const q = T.at(p.u);
      p.e.setAttribute("transform", "translate(" + f1(q.x + ox) + " " + f1(q.y + (pl === A.rel || pl === A.pitp ? Math.sin(tm / 200 + p.u * 9) * 2 : 0)) + ")"); });
    move(A.rel, tracks.rel, 42); move(A.pitp, tracks.pit, 42); move(A.endp, tracks.end, 52); move(A.fb, null, 60, (p) => (p.k ? tracks.fbH : tracks.fbP));
    /* treatment capsules: replacement runs in with the end hormone, blocker heads for the gland */
    ac.cap += dt * sm.rep * 1.8; while (ac.cap >= 1) { ac.cap--; const p = free(A.caps); if (p) emit(p); }
    move(A.caps, tracks.end, 46);
    ac.blk += dt * sm.blk * 1.6; while (ac.blk >= 1) { ac.blk--; const p = free(A.blks); if (p) emit(p); }
    A.blks.forEach((p) => { if (!p.on) return; p.u += dt * 0.35; if (p.u >= 1) { kill(p); return; } const x = lerp(318, 262, p.u), y = lerp(396, 366, p.u);
      p.e.setAttribute("transform", "translate(" + f1(x + ox) + " " + f1(y) + ") rotate(" + f1(p.u * 80) + ")"); p.e.setAttribute("opacity", (p.u > 0.8 ? (1 - p.u) * 5 : 1).toFixed(2)); });
  });
  gg.H.set(sm.H, wordOf(sm.H, 0.3, 0.7, ["low", "normal", "high"])); gg.P.set(sm.P, wordOf(sm.P, 0.3, 0.7, ["low", "normal", "high"])); gg.G.set(sm.G, wordOf(sm.G, 0.3, 0.7, ["low", "normal", "high"]));
  gg.gs.set(sm.gs, wordOf(sm.gs, 0.2, 0.7, ["small", "normal", "large"]));
  gg.br.set(br, wordOf(br, 0.3, 0.7, ["weak", "normal", "strong"]) + (sm.rp < 0.4 || sm.rh < 0.4 ? ", not heeded" : ""));
}
run({ init, step });
