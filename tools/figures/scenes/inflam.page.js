/* Acute inflammation scene: injured skin, sentinel mast cells and macrophages, mediators,
 * a vessel that widens and leaks, neutrophils leaving the blood to eat germs, and two
 * treatments that visibly act. NSAID caps the prostaglandin making sites and the
 * prostaglandin stream fades. Steroid quiets the sentinel cells and narrows the vessel. */
const CY = SC.CY, WW = SC.W;
const layers = { skin: $("skinSlot"), tufts: $("tufts"), coxg: $("coxg"), bac: $("bacteria"), lymph: $("lymph"), rbc: $("rbcs"), endo: $("endo"), parts: $("parts"), phag: $("phag"), over: $("over"), panel: $("panel"), lumen: $("lumen"), oed: $("oedema"), red: $("redness"), heat: $("heat") };
let hh = 36;
const WALL_N = 26;
const COX = { x: 330, y: 235 };
const WOUND = { x: 150, y: 160 };
/* ---- recognisable anatomy; vessels and particles anchor to it ---- */
let skinO = null;
function initOrgans() {
  skinO = organ(layers.skin, "skin", 165, 170, 240, {});
  const dp = skinO.ports && skinO.ports.dermis;
  if (dp) { WOUND.x = Math.round(dp[0]); WOUND.y = Math.round(dp[1]); }
}
/* ---- inflamed capillary tufts recruited across the tissue ---- */
const TUFT_N = 40, tufts = [];
function initTufts() {
  const outs = [[360, 155, 32], [560, 150, 36], [685, 215, 32], [COX.x, COX.y, 36]];
  let guard = 0;
  while (tufts.length < TUFT_N && guard++ < 600) {
    const x = rnd(60, 920), y = rnd(80, 252);
    if (outs.some(([cx, cy, r]) => (x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r)) continue;
    const e = mk("circle", { class: "in-tuft", r: 5 }, layers.tufts);
    tufts.push({ e, x, y, th: tufts.length / TUFT_N });
  }
  const ths = tufts.map((t) => t.th);
  for (let i = ths.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const tmp = ths[i]; ths[i] = ths[j]; ths[j] = tmp; }
  tufts.forEach((t, i) => { t.th = ths[i]; place(t.e, t.x, t.y, 0, 0.001); t.e.setAttribute("opacity", "1"); });
}
/* ---- prostaglandin making sites: NSAID blockers dock here ---- */
const coxS = [[-28, -6], [-14, 8], [0, -10], [14, 6], [28, -4], [8, 14]].map(([dx, dy]) => ({ x: COX.x + dx, y: COX.y + dy }));
function initCox() { coxS.forEach((s) => mk("circle", { class: "in-cox", r: 3, cx: s.x, cy: s.y }, layers.coxg)); }
const blockers = Array.from({ length: 6 }, (_, i) => {
  const g = mk("g", {}, layers.parts);
  mk("circle", { class: "in-block", r: 5 }, g);
  mk("circle", { class: "in-block2", r: 1.8 }, g);
  g.setAttribute("opacity", "0");
  return { g, i, st: 0, t: 0, sx: 0, sy: 0 };
});
function stepBlockers(dt, m) {
  const on = m.nsaid === 1;
  blockers.forEach((b) => {
    const s = coxS[b.i];
    if (b.st === 0) {
      if (!on) return;
      b.st = 1; b.t = 0; b.sx = s.x + rnd(-40, 40); b.sy = 372; b.g.setAttribute("opacity", "1");
    }
    if (b.st === 1) {
      if (!on) { b.st = 0; b.g.setAttribute("opacity", "0"); return; }
      b.t += dt; const u = Math.min(1, b.t / 0.9);
      place(b.g, lerp(b.sx, s.x, u), lerp(b.sy, s.y, u), 0, 1);
      if (u >= 1) b.st = 2;
    } else if (b.st === 2) {
      if (!on) { b.st = 3; b.t = 0; return; }
      place(b.g, s.x + Math.sin(tm / 500 + b.i * 1.7) * 1.5, s.y + Math.cos(tm / 620 + b.i) * 1.5, 0, 1);
    } else if (b.st === 3) {
      b.t += dt; b.g.setAttribute("opacity", (1 - b.t / 0.5).toFixed(2));
      place(b.g, s.x, s.y + b.t * 60, 0, 1);
      if (b.t >= 0.5) { b.st = 0; b.g.setAttribute("opacity", "0"); }
    }
  });
}
/* ---- steroid dots: leave the blood and are taken up by sentinel cells ---- */
const SEN = [[360, 155], [560, 150], [685, 215]];
const abso = Array.from({ length: 5 }, () => {
  const e = mk("circle", { class: "in-ab", r: 3 }, layers.parts);
  e.setAttribute("opacity", "0");
  return { e, on: false, x: 0, y: 0, tx: 0, ty: 0 };
});
function stepAbso(dt, m) {
  abso.forEach((p) => {
    if (!p.on) {
      if (m.ster !== 1) return;
      const t = pick(SEN);
      p.on = true; p.x = rnd(40, 900); p.y = CY + rnd(-14, 14); p.tx = t[0]; p.ty = t[1]; p.e.setAttribute("opacity", "1");
    }
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
    if (d < 8) { p.on = false; p.e.setAttribute("opacity", "0"); return; }
    const v = 150 * dt / Math.max(1, d);
    p.x += dx * v; p.y += dy * v;
    place(p.e, p.x, p.y, 0, 1);
  });
}
/* ---- trigger: bacteria and debris in the injured skin ---- */
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
const caps = pool(12, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-cap", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-cap2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = clamp(x, 24, WW - 24); p.y = clamp(y, 56, 428); p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- caption, labels, heat waves, gauges ---- */
let capEl = null, capDrug = -1, capLevel = -1;
function capText(d, l) {
  if (d === 1) {
    if (l === 3) return "NSAID blocks prostaglandin making. Swelling eases but the trigger persists.";
    if (l === 2) return "NSAID blocks prostaglandin making. Little swelling is left to ease.";
    return "NSAID blocks prostaglandin making. The vessel narrows and swelling eases.";
  }
  if (d === 2) {
    if (l === 3) return "Steroid damps all mediators. The trigger lingers as clearing slows.";
    if (l === 2) return "Steroid damps all mediators. The last germs linger as clearing slows.";
    return "Steroid damps all mediators. Swelling fades but clearing slows.";
  }
  if (l === 3) return "No treatment. The trigger persists, so defenders gather and stay.";
  if (l === 2) return "No treatment. The trigger is almost cleared. Swelling settles.";
  if (l === 0) return "No treatment. Injury wakes nearby sentinel cells. Neutrophils hurry in.";
  return "No treatment. Mediators widen the vessel and fluid leaks out. Neutrophils swarm.";
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The tissue response";
  [["med", "Mediators", "g-cyt", "Histamine from mast cells, prostaglandin made at the injury, and cytokines from macrophages, taken together."], ["vas", "Widening", "g-bad", "Vasodilation: the vessel relaxes and widens, bringing more blood. This gives redness and heat."], ["swell", "Swelling", "g-fl", "Increased permeability lets protein rich exudate leave the vessel and collect as oedema, which is the swelling."], ["neu", "Neutrophils", "g-neu", "Neutrophils arriving in the tissue after slowing at the wall and leaving the vessel."], ["clear", "Clearing", "g-good", "Eating of microbes and debris by neutrophils and macrophages, which clears the trigger."], ["signs", "Signs", "g-bad", "The cardinal signs together: redness, heat, swelling, pain and loss of function."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Wound", WOUND.x, WOUND.y, 140, 66, "Wound: injured skin plus microbes. Their signals wake nearby sentinel cells and start inflammation.");
  pill(ox, "Mast cell", 360, 155, 360, 66, "Mast cell: a sentinel that releases histamine within minutes of injury or infection.");
  pill(ox, "Macrophage", 560, 150, 580, 66, "Macrophage: a sentinel that releases cytokines, then clears dead cells and debris as healing begins.");
  pill(ox, "Histamine", 352, 192, 296, 250, "Histamine from mast cells: quickly widens the vessel and loosens its wall.");
  pill(ox, "Prostaglandin", COX.x, COX.y, 520, 250, "Prostaglandin made at the injury: widens the vessel, adds leak and carries pain. An NSAID caps the ringed making sites.");
  pill(ox, "Leaky vessel", 830, 320, 838, 250, "Leaky vessel: widened by mediators, so fluid leaks out as exudate and neutrophils can leave. A steroid narrows it again.");
  pill(ox, "Neutrophil", 215, 328, 230, 405, "Neutrophil: slows at the wall, squeezes out of the vessel, then eats microbes and debris.");
  const dp = pill(ox, "Treatment", 70, 320, 110, 405, "Treatment arriving in the blood. An NSAID caps the prostaglandin making sites. A steroid quiets mast cells and macrophages."); dp.setAttribute("id", "drug-pill");
  capEl = mk("text", { class: "in-cap", x: 30, y: 434 }, ox); capEl.textContent = capText(0, 1);
  [892, 908, 924].forEach((x) => { const p = mk("path", { class: "heat-p", d: "M" + x + " 150q6 -10 0 -20q-6 -10 0 -20", opacity: "0" }, layers.heat); p.setAttribute("id", "heat" + x); });
}
const sm = { Trig: 0.6, Med: 0.5, Hist: 0.5, Pg: 0.5, Ck: 0.5, Vas: 0.5, Perm: 0.4, Exu: 0.4, Neu: 0.5, Mac: 0.4, Phag: 0.3, Signs: 0.4, chron: 0, drug: 0, nsaid: 0, ster: 0 };
const acc = { hist: 0, pg: 0, ck: 0, drop: 0, caps: 0, neu: 0 };
function init() { initOrgans(); initBacteria(); initTufts(); initCox(); initEndo(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Trig = lerp(sm.Trig, m.Trig, k2); sm.Med = lerp(sm.Med, m.Med, k2); sm.Hist = lerp(sm.Hist, m.Hist, k2); sm.Pg = lerp(sm.Pg, m.Pg, k2); sm.Ck = lerp(sm.Ck, m.Ck, k2); sm.Vas = lerp(sm.Vas, m.Vas, k1); sm.Perm = lerp(sm.Perm, m.Perm, k2); sm.Exu = lerp(sm.Exu, m.Exu, k2); sm.Neu = lerp(sm.Neu, m.Neu, k2); sm.Mac = lerp(sm.Mac, m.Mac, k2); sm.Phag = lerp(sm.Phag, m.Phag, k2); sm.Signs = lerp(sm.Signs, m.Signs, k2); sm.chron = lerp(sm.chron, m.chron, k2); sm.drug = lerp(sm.drug, m.nsaid || m.ster ? 1 : 0, k1); sm.nsaid = lerp(sm.nsaid, m.nsaid, k1); sm.ster = lerp(sm.ster, m.ster, k1);
  hh = 18 + 48 * sm.Vas + 2 * Math.sin(tm / 900);
  const wallT = CY - hh - 4, wallB = CY + hh + 4;
  layers.lumen.setAttribute("y", f1(CY - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  layers.oed.setAttribute("height", f1(Math.max(0, wallT - 44))); layers.oed.setAttribute("opacity", (sm.Exu * 0.5).toFixed(2));
  layers.red.setAttribute("opacity", (sm.Vas * 0.35).toFixed(2));
  [892, 908, 924].forEach((x, i) => { const hp = $("heat" + x); if (hp) hp.setAttribute("opacity", (sm.Signs * 0.8).toFixed(2)); });
  /* capillaries open as the vessel widens */
  tufts.forEach((t) => place(t.e, t.x, t.y, 0, clamp((sm.Vas - t.th) * 8, 0.001, 1)));
  /* drug mechanisms */
  stepBlockers(dt, m); stepAbso(dt, m);
  /* endothelium */
  const gapK = 1 - 0.26 * sm.Perm;
  endo.top.forEach((e, i) => place(e.g, e.x, wallT + Math.sin(tm / 800 + i) * 0.8, 0, 1)); endo.bot.forEach((e, i) => place(e.g, e.x, wallB + Math.sin(tm / 800 + i + 2) * 0.8, 0, 1));
  [endo.top, endo.bot].forEach((row) => row.forEach((e) => { e.g.setAttribute("transform", e.g.getAttribute("transform") + " scale(" + gapK.toFixed(3) + " " + (1 - 0.08 * sm.Vas).toFixed(3) + ")"); e.g.style.setProperty("--act", sm.Med.toFixed(2)); }));
  /* trigger bacteria wander in a bounded patch */
  const want = Math.round(sm.Trig * BAC_N);
  bac.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.4 : 2 + sm.Phag * 2)));
    b.a += rnd(-1.4, 1.4) * dt; b.x += Math.cos(b.a) * 6 * dt; b.y += Math.sin(b.a) * 6 * dt; if (b.x < 55 || b.x > 255) b.a = Math.PI - b.a; if (b.y < 98 || b.y > 208) b.a = -b.a; b.x = clamp(b.x, 55, 255); b.y = clamp(b.y, 98, 208);
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 600 + i) * 18, Math.max(0.001, b.s)); b.g.style.opacity = b.s > 0.04 ? 1 : 0; });
  /* resident cells; a steroid quiets and dims them */
  const dim = 1 - 0.45 * sm.ster, csc = 1 - 0.1 * sm.ster;
  place(mast.g, mast.x + Math.sin(tm / 1500) * 2, mast.y, Math.sin(tm / 2400) * 5, csc * (1 + 0.05 * sm.Hist * Math.sin(tm / 300))); mast.g.style.opacity = dim.toFixed(2);
  macs.forEach((mm, i) => { const sc = i === 0 ? 1 : 0.35 + 0.65 * sm.Mac; place(mm.g, mm.x + Math.sin(tm / 1600 + mm.ph) * 3, mm.y + Math.cos(tm / 1800 + mm.ph) * 2.5, Math.sin(tm / 2600 + mm.ph) * 6, sc * csc * (1 + 0.05 * sm.Ck * Math.sin(tm / 320 + i))); mm.g.style.opacity = (i === 0 ? 1 : clamp(0.25 + sm.Mac)) * dim; });
  lymphs.forEach((l, i) => { place(l.g, l.x, l.y + Math.sin(tm / 1400 + i) * 2, 0, Math.max(0.001, sm.chron)); l.g.style.opacity = sm.chron > 0.05 ? 1 : 0; });
  /* mediators drift from their sources down to the vessel wall */
  acc.hist += dt * sm.Hist * 9; while (acc.hist >= 1) { acc.hist--; const p = free(hist); if (p) emit(p, mast.x + rnd(-14, 14), mast.y + rnd(8, 18), rnd(-10, 16), rnd(24, 38), 0); }
  acc.pg += dt * sm.Pg * 9; while (acc.pg >= 1) { acc.pg--; const p = free(pg); if (p) emit(p, COX.x + rnd(-24, 24), COX.y + rnd(-8, 8), rnd(8, 20), rnd(24, 38), 0); }
  acc.ck += dt * sm.Ck * 11; while (acc.ck >= 1) { acc.ck--; const mm = pick(macs), p = free(ck); if (p) emit(p, mm.x + rnd(-14, 14), mm.y + rnd(8, 16), rnd(-12, 12), rnd(26, 40), 0); }
  [hist, pg, ck].forEach((pl) => pl.forEach((p) => { if (!p.on) return; p.x = clamp(p.x + p.vx * dt + Math.sin(tm / 400 + p.y) * 0.3, 24, WW - 24); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > wallT - 6 || p.y > 424) kill(p); }));
  /* exudate leak up through the top wall into the tissue */
  acc.drop += dt * sm.Perm * 9; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) emit(p, rnd(60, WW - 60), CY - hh + 4, rnd(-4, 4), -rnd(14, 22), 0); }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 24, WW - 24); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", p.y < wallT ? clamp(1 - (wallT - p.y) / 70).toFixed(2) : "1"); if (p.y < 82) kill(p); });
  /* red cells flow in the lumen */
  const flow = clamp(0.35 + 0.75 * (1 - sm.Vas * 0.4));
  rbcs.forEach((r) => { r.x += r.v * 65 * flow * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.8, 0.8); } place(r.g, clamp(r.x, -12, WW + 12), CY + r.y * (hh - 12), r.rot + Math.sin(tm / 500 + r.x) * 10, 1); });
  /* neutrophils: roll along the top wall, emigrate, crawl to the trigger and eat it */
  const nn = Math.round(sm.Neu * neus.length);
  neus.forEach((n, i) => { const act = i < nn;
    if (n.st === 0) { if (act) { n.x = rnd(30, 180); n.y = CY - hh + 12; n.st = 1; } else { n.g.style.opacity = 0; place(n.g, -40, CY, 0, 0.1); } }
    else if (n.st === 1) { n.g.style.opacity = 1; n.x += 34 * dt; n.y = CY - hh + 12; place(n.g, n.x, n.y, 0, 1); if (n.x > 150 + i * 35) { n.st = 2; n.tx = rnd(70, 240); n.ty = rnd(110, 200); } }
    else if (n.st === 2) { n.y -= 32 * dt; place(n.g, n.x, n.y, 0, n.y > wallT - 6 ? 0.8 : 1); if (n.y < wallT - 10) n.st = 3; }
    else if (n.st === 3) { n.x += (n.tx - n.x) * dt * 0.7; n.y += (n.ty - n.y) * dt * 0.7; n.x = clamp(n.x, 45, 275); n.y = clamp(n.y, 92, 225); place(n.g, n.x + Math.sin(tm / 300 + i) * 2, n.y, Math.sin(tm / 400 + i) * 12, 1 + 0.08 * sm.Phag * Math.sin(tm / 280 + i)); n.t += dt; if (n.t > 9 || !act) { n.t = 0; n.st = 4; } }
    else { n.g.style.opacity = clamp(parseFloat(n.g.style.opacity || 1) - dt * 0.6); if (parseFloat(n.g.style.opacity) < 0.05) n.st = 0; } });
  /* treatment capsules flow in the lumen when a treatment is chosen */
  acc.caps += dt * sm.drug * 6; while (acc.caps >= 1) { acc.caps--; const p = free(caps); if (p) emit(p, -6, CY + rnd(-hh + 12, hh - 12), 85, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); if (p.x > WW + 6) kill(p); });
  const dpill = $("drug-pill"); if (dpill) dpill.style.opacity = sm.drug.toFixed(2);
  /* gauges */
  gg.med.set(sm.Med, wordOf(sm.Med, 0.3, 0.6, ["low", "raised", "high"])); gg.vas.set(sm.Vas, wordOf(sm.Vas, 0.3, 0.6, ["slight", "widened", "wide"])); gg.swell.set(sm.Exu, wordOf(sm.Exu, 0.3, 0.6, ["little", "moderate", "marked"]));
  gg.neu.set(sm.Neu, wordOf(sm.Neu, 0.3, 0.6, ["few", "many", "very many"])); gg.clear.set(sm.Phag, wordOf(sm.Phag, 0.3, 0.6, ["slow", "active", "brisk"])); gg.signs.set(sm.Signs, wordOf(sm.Signs, 0.3, 0.6, ["mild", "clear", "strong"]));
  if (drug !== capDrug || level !== capLevel) { capDrug = drug; capLevel = level; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
