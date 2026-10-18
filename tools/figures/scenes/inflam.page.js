/* Acute inflammation scene: trigger, mast cell and macrophages, mediators, vessel widening and leak, neutrophil emigration, phagocytosis and the gauges. */
const CY = SC.CY, WW = SC.W;
const layers = { bac: $("bacteria"), lymph: $("lymph"), rbc: $("rbcs"), endo: $("endo"), parts: $("parts"), phag: $("phag"), over: $("over"), panel: $("panel"), lumen: $("lumen"), oed: $("oedema"), red: $("redness"), heat: $("heat") };
let hh = 36;
const WALL_N = 26;
/* ---- trigger: bacteria and debris in the injured tissue ---- */
const BAC_N = 30, bac = [];
function initBacteria() { for (let i = 0; i < BAC_N; i++) { const rod = i % 3 === 0, g = mk("g", { class: "cl cl-bac" }, layers.bac);
    mk(rod ? "ellipse" : "circle", rod ? { class: "cl-b", rx: 6.5, ry: 3.4 } : { class: "cl-b", r: 4 }, g); mk("circle", { class: "cl-h", r: 1.4, cx: -1.4, cy: -1.2 }, g);
    bac.push({ g, x: rnd(55, 255), y: rnd(98, 208), a: rnd(0, 6.28), s: 0, on: false, rod, rot: rnd(0, 180) }); } }
/* ---- resident cells ---- */
const mast = (() => { const g = mk("g", {}, layers.phag); cell(g, { cls: "mast", r: 21, nuc: 0.4, seed: 5, wob: 0.12 }); return { g, x: 360, y: 155 }; })();
const macs = [[560, 150, 26], [685, 215, 22]].map(([x, y, r], i) => { const g = mk("g", {}, layers.phag); cell(g, { cls: "mac", r, nuc: 0.42, seed: i * 3 + 1, wob: 0.13 }); return { g, x, y, r, ph: i * 2.1 }; });
const lymphs = [[770, 135], [825, 182], [738, 198], [852, 128]].map(([x, y], i) => { const g = mk("g", {}, layers.lymph); cell(g, { cls: "lymph", r: 12, nuc: 0.62, seed: i + 31, wob: 0.08 }); return { g, x, y }; });
const debris = [[215, 185], [245, 120], [95, 195]].map(([x, y], i) => { const g = mk("g", {}, layers.phag); cell(g, { cls: "deb", r: 9, nuc: 0, seed: i + 44, wob: 0.22 }); place(g, x, y, i * 40, 0.8); return g; });
/* ---- endothelium ---- */
const endo = { top: [], bot: [] };
function initEndo() { ["top", "bot"].forEach((row) => { for (let i = 0; i < WALL_N; i++) { const g = mk("g", {}, layers.endo); cell(g, { cls: "endo", r: 14, nuc: 0.3, seed: i + (row === "top" ? 0 : 40), wob: 0.06, n: 8 }); endo[row].push({ g, x: 14 + (i + 0.5) * ((WW - 28) / WALL_N) }); } }); }
/* ---- red cells ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-0.8, 0.8), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
/* ---- neutrophils ---- */
const neus = Array.from({ length: 6 }, (_, i) => ({ g: cell(layers.phag, { cls: "neut", r: 11, nuc: 0.55, nucCls: "multi", seed: i + 20, wob: 0.14 }), st: 0, x: -30, y: CY, t: 0, tx: 0, ty: 0, i }));
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const hist = pool(18, () => mk("circle", { class: "sc-p p-hist", r: 2.5 }, layers.parts));
const pg = pool(18, () => mk("rect", { class: "sc-p p-pg", x: -2.3, y: -2.3, width: 4.6, height: 4.6, rx: 1 }, layers.parts));
const ck = pool(20, () => mk("path", { class: "sc-p p-ck", d: "M0 -3.2L3 0L0 3.2L-3 0Z" }, layers.parts));
const drops = pool(30, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const drugp = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = clamp(x, 24, WW - 24); p.y = clamp(y, 56, 428); p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, heat waves, gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The tissue response";
  [["med", "Mediators", "g-cyt", "Histamine from mast cells, prostaglandin made locally, and cytokines from macrophages, taken together."], ["vas", "Widening", "g-bad", "Vasodilation: the vessel relaxes and widens, bringing more blood. This gives redness and heat."], ["swell", "Swelling", "g-fl", "Increased permeability lets protein rich exudate leave the vessel and collect as oedema, which is the swelling."], ["neu", "Neutrophils", "g-neu", "Neutrophils arriving in the tissue after margination at the wall and emigration out of the vessel."], ["clear", "Clearing", "g-good", "Phagocytosis of microbes and debris by neutrophils and macrophages, which clears the trigger."], ["signs", "Signs", "g-bad", "The cardinal signs together: redness, heat, swelling, pain and loss of function."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Trigger", 130, 122, 150, 84, "The trigger: injured cells and microbes. Their signals start acute inflammation.");
  pill(ox, "Mast cell", 360, 134, 360, 84, "Mast cell: a resident tissue cell that quickly releases histamine when the tissue is injured or infected.");
  pill(ox, "Macrophage", 560, 124, 580, 84, "Macrophage: a resident sentinel that releases cytokines and later clears dead neutrophils and debris in resolution.");
  pill(ox, "Histamine", 345, 185, 300, 248, "Histamine from mast cells: quickly widens the vessel and makes its wall leaky.");
  pill(ox, "Prostaglandin", 505, 205, 505, 248, "Prostaglandin made locally: widens the vessel, adds to leak and carries the pain signal. An NSAID blocks its making.");
  pill(ox, "Cytokines", 600, 185, 705, 248, "Cytokines from macrophages: act on the vessel wall and call neutrophils in. A steroid broadly suppresses them.");
  pill(ox, "Vessel wall", 830, 285, 850, 248, "The vessel wall (endothelium): mediators widen the vessel and open gaps, so exudate leaks and neutrophils can emigrate.");
  pill(ox, "Neutrophil", 200, 335, 170, 405, "Neutrophil: slows and sticks at the wall (margination), squeezes out (emigration), then phagocytoses microbes and debris.");
  pill(ox, "Exudate", 470, 285, 430, 405, "Exudate: protein rich fluid that has leaked through the vessel wall. Collected in the tissue it is oedema, the swelling.");
  const dp = pill(ox, "Treatment", 650, 340, 650, 405, "Treatment arriving in the blood. An NSAID mainly blocks prostaglandin; a steroid broadly suppresses mediators, emigration and phagocytosis."); dp.setAttribute("id", "drug-pill");
  [892, 908, 924].forEach((x) => { const p = mk("path", { class: "heat-p", d: "M" + x + " 150q6 -10 0 -20q-6 -10 0 -20", opacity: "0" }, layers.heat); p.setAttribute("id", "heat" + x); });
}
const sm = { Trig: 0.6, Med: 0.5, Hist: 0.5, Pg: 0.5, Ck: 0.5, Vas: 0.5, Perm: 0.4, Exu: 0.4, Neu: 0.5, Mac: 0.4, Phag: 0.3, Signs: 0.4, chron: 0, drug: 0 };
const acc = { hist: 0, pg: 0, ck: 0, drop: 0, drugp: 0, neu: 0 };
function init() { initBacteria(); initEndo(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Trig = lerp(sm.Trig, m.Trig, k2); sm.Med = lerp(sm.Med, m.Med, k2); sm.Hist = lerp(sm.Hist, m.Hist, k2); sm.Pg = lerp(sm.Pg, m.Pg, k2); sm.Ck = lerp(sm.Ck, m.Ck, k2); sm.Vas = lerp(sm.Vas, m.Vas, k1); sm.Perm = lerp(sm.Perm, m.Perm, k2); sm.Exu = lerp(sm.Exu, m.Exu, k2); sm.Neu = lerp(sm.Neu, m.Neu, k2); sm.Mac = lerp(sm.Mac, m.Mac, k2); sm.Phag = lerp(sm.Phag, m.Phag, k2); sm.Signs = lerp(sm.Signs, m.Signs, k2); sm.chron = lerp(sm.chron, m.chron, k2); sm.drug = lerp(sm.drug, m.nsaid || m.ster ? 1 : 0, k1);
  hh = 30 + 22 * sm.Vas + 2 * Math.sin(tm / 900);
  const wallT = CY - hh - 4, wallB = CY + hh + 4;
  layers.lumen.setAttribute("y", f1(CY - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  layers.oed.setAttribute("height", f1(Math.max(0, wallT - 44))); layers.oed.setAttribute("opacity", (sm.Exu * 0.5).toFixed(2));
  layers.red.setAttribute("opacity", (sm.Vas * 0.14).toFixed(2));
  [892, 908, 924].forEach((x, i) => { const hp = $("heat" + x); if (hp) hp.setAttribute("opacity", (sm.Signs * 0.8).toFixed(2)); });
  /* endothelium */
  const gapK = 1 - 0.26 * sm.Perm;
  endo.top.forEach((e, i) => place(e.g, e.x, wallT + Math.sin(tm / 800 + i) * 0.8, 0, 1)); endo.bot.forEach((e, i) => place(e.g, e.x, wallB + Math.sin(tm / 800 + i + 2) * 0.8, 0, 1));
  [endo.top, endo.bot].forEach((row) => row.forEach((e) => { e.g.setAttribute("transform", e.g.getAttribute("transform") + " scale(" + gapK.toFixed(3) + " " + (1 - 0.08 * sm.Vas).toFixed(3) + ")"); e.g.style.setProperty("--act", sm.Med.toFixed(2)); }));
  /* trigger bacteria wander in a bounded patch */
  const want = Math.round(sm.Trig * BAC_N);
  bac.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.4 : 2 + sm.Phag * 2)));
    b.a += rnd(-1.4, 1.4) * dt; b.x += Math.cos(b.a) * 6 * dt; b.y += Math.sin(b.a) * 6 * dt; if (b.x < 55 || b.x > 255) b.a = Math.PI - b.a; if (b.y < 98 || b.y > 208) b.a = -b.a; b.x = clamp(b.x, 55, 255); b.y = clamp(b.y, 98, 208);
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 600 + i) * 18, Math.max(0.001, b.s)); b.g.style.opacity = b.s > 0.04 ? 1 : 0; });
  /* resident cells */
  place(mast.g, mast.x + Math.sin(tm / 1500) * 2, mast.y, Math.sin(tm / 2400) * 5, 1 + 0.05 * sm.Hist * Math.sin(tm / 300));
  macs.forEach((mm, i) => { const sc = i === 0 ? 1 : 0.35 + 0.65 * sm.Mac; place(mm.g, mm.x + Math.sin(tm / 1600 + mm.ph) * 3, mm.y + Math.cos(tm / 1800 + mm.ph) * 2.5, Math.sin(tm / 2600 + mm.ph) * 6, sc * (1 + 0.05 * sm.Ck * Math.sin(tm / 320 + i))); mm.g.style.opacity = i === 0 ? 1 : clamp(0.25 + sm.Mac); });
  lymphs.forEach((l, i) => { place(l.g, l.x, l.y + Math.sin(tm / 1400 + i) * 2, 0, Math.max(0.001, sm.chron)); l.g.style.opacity = sm.chron > 0.05 ? 1 : 0; });
  /* mediators drift from their sources down to the vessel wall */
  acc.hist += dt * sm.Hist * 9; while (acc.hist >= 1) { acc.hist--; const p = free(hist); if (p) emit(p, mast.x + rnd(-14, 14), mast.y + rnd(8, 18), rnd(-10, 16), rnd(24, 38), 0); }
  acc.pg += dt * sm.Pg * 9; while (acc.pg >= 1) { acc.pg--; const p = free(pg); if (p) emit(p, rnd(180, 280), rnd(185, 215), rnd(8, 20), rnd(24, 38), 0); }
  acc.ck += dt * sm.Ck * 11; while (acc.ck >= 1) { acc.ck--; const mm = pick(macs), p = free(ck); if (p) emit(p, mm.x + rnd(-14, 14), mm.y + rnd(8, 16), rnd(-12, 12), rnd(26, 40), 0); }
  [hist, pg, ck].forEach((pl) => pl.forEach((p) => { if (!p.on) return; p.x = clamp(p.x + p.vx * dt + Math.sin(tm / 400 + p.y) * 0.3, 24, WW - 24); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > wallT - 6 || p.y > 424) kill(p); }));
  /* exudate leak up through the top wall into the tissue */
  acc.drop += dt * sm.Perm * 9; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) emit(p, rnd(60, WW - 60), CY - hh + 4, rnd(-4, 4), -rnd(14, 22), 0); }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 24, WW - 24); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", p.y < wallT ? clamp(1 - (wallT - p.y) / 70).toFixed(2) : "1"); if (p.y < 82) kill(p); });
  /* red cells flow in the lumen */
  const flow = clamp(0.35 + 0.75 * (1 - sm.Vas * 0.4));
  rbcs.forEach((r) => { r.x += r.v * 65 * flow * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.8, 0.8); } place(r.g, clamp(r.x, -12, WW + 12), CY + r.y * (hh - 12), r.rot + Math.sin(tm / 500 + r.x) * 10, 1); });
  /* neutrophils: roll along the top wall, emigrate, crawl to the trigger and phagocytose */
  const nn = Math.round(sm.Neu * neus.length);
  neus.forEach((n, i) => { const act = i < nn;
    if (n.st === 0) { if (act) { n.x = rnd(30, 180); n.y = CY - hh + 12; n.st = 1; } else { n.g.style.opacity = 0; place(n.g, -40, CY, 0, 0.1); } }
    else if (n.st === 1) { n.g.style.opacity = 1; n.x += 34 * dt; n.y = CY - hh + 12; place(n.g, n.x, n.y, 0, 1); if (n.x > 150 + i * 35) { n.st = 2; n.tx = rnd(70, 240); n.ty = rnd(110, 200); } }
    else if (n.st === 2) { n.y -= 32 * dt; place(n.g, n.x, n.y, 0, n.y > wallT - 6 ? 0.8 : 1); if (n.y < wallT - 10) n.st = 3; }
    else if (n.st === 3) { n.x += (n.tx - n.x) * dt * 0.7; n.y += (n.ty - n.y) * dt * 0.7; n.x = clamp(n.x, 45, 275); n.y = clamp(n.y, 92, 225); place(n.g, n.x + Math.sin(tm / 300 + i) * 2, n.y, Math.sin(tm / 400 + i) * 12, 1 + 0.08 * sm.Phag * Math.sin(tm / 280 + i)); n.t += dt; if (n.t > 9 || !act) { n.t = 0; n.st = 4; } }
    else { n.g.style.opacity = clamp(parseFloat(n.g.style.opacity || 1) - dt * 0.6); if (parseFloat(n.g.style.opacity) < 0.05) n.st = 0; } });
  /* treatment capsules flow in the lumen when a treatment is chosen */
  acc.drugp += dt * sm.drug * 3; while (acc.drugp >= 1) { acc.drugp--; const p = free(drugp); if (p) emit(p, -6, CY + rnd(-hh + 12, hh - 12), 85, 0, 0); }
  drugp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); if (p.x > WW + 6) kill(p); });
  const dpill = $("drug-pill"); if (dpill) dpill.style.opacity = sm.drug.toFixed(2);
  /* gauges */
  gg.med.set(sm.Med, wordOf(sm.Med, 0.3, 0.6, ["low", "raised", "high"])); gg.vas.set(sm.Vas, wordOf(sm.Vas, 0.3, 0.6, ["slight", "widened", "wide"])); gg.swell.set(sm.Exu, wordOf(sm.Exu, 0.3, 0.6, ["little", "moderate", "marked"]));
  gg.neu.set(sm.Neu, wordOf(sm.Neu, 0.3, 0.6, ["few", "many", "very many"])); gg.clear.set(sm.Phag, wordOf(sm.Phag, 0.3, 0.6, ["slow", "active", "brisk"])); gg.signs.set(sm.Signs, wordOf(sm.Signs, 0.3, 0.6, ["mild", "clear", "strong"]));
}
run({ init, step });
