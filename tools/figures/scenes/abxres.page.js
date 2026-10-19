/* Antibiotic resistance scene: one large cell on the left, drug entering from the far
 * left, and the surviving population on the right. Each treatment visibly acts on the
 * drawing: inhibitor caps sit on the enzymes, drug docks on its target, the wall cracks
 * and the cell sickens, protein chains halt at a blocked ribosome, and survivors fade. */
const LY = { stage: $("stage"), over: $("over"), panel: $("panel") };
const CX = 300, CY2 = 258;
/* pools */
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const drugs = mkPool(26, () => mk("circle", { class: "sc-p p-bl", r: 3.4 }, LY.stage));
const inhs = mkPool(10, () => mk("circle", { class: "sc-p p-inh", r: 2.6 }, LY.stage));
const alts = mkPool(14, () => mk("rect", { class: "sc-p p-alt", x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: 1 }, LY.stage));
const ejected = mkPool(12, () => mk("circle", { class: "sc-p p-bl", r: 2.8 }, LY.stage));
const plasDot = mkPool(6, () => mk("circle", { class: "sc-p p-plas", r: 3 }, LY.stage));
const sparks = mkPool(14, () => mk("circle", { class: "sc-p abx-spark", r: 2 }, LY.stage));
function spark(x, y) { const p = freeP(sparks); if (p) emit(p, x, y, rnd(-26, 26), rnd(-26, 26), 0); }

/* large cell */
const ENZ = [[225, 195], [265, 225], [335, 195], [245, 320], [355, 330]];
const PBS = [[200, 366], [260, 358], [340, 366], [400, 358]];
const cellG = mk("g", {}, LY.stage);
mk("ellipse", { class: "mem", cx: CX, cy: CY2, rx: 205, ry: 128 }, cellG);
mk("ellipse", { class: "mem-in", cx: CX, cy: CY2, rx: 188, ry: 112 }, cellG);
const dmg = mk("ellipse", { class: "abx-damage", cx: CX, cy: CY2, rx: 205, ry: 128, opacity: "0" }, cellG);
mk("path", { class: "chrom", d: "M210 230q30 -28 62 -6q34 24 66 2q30 -20 58 4q-28 18 -58 0q-32 -20 -64 0q-34 20 -64 0Z" }, cellG);
const riboG = mk("g", {}, cellG);
mk("ellipse", { class: "ribo", cx: 295, cy: 292, rx: 22, ry: 14 }, riboG);
mk("ellipse", { class: "ribo", cx: 312, cy: 284, rx: 13, ry: 9 }, riboG);
const riboAlt = mk("circle", { class: "ribo-alt", cx: 300, cy: 288, r: 27, opacity: 0 }, riboG);
const docks = [[288, 272], [302, 268], [316, 272]].map(([x, y]) => mk("rect", { class: "abx-dock", x: x - 3, y: y - 3, width: 6, height: 6, rx: 1, opacity: "0" }, cellG));
const chain = [0, 1, 2, 3, 4].map((i) => mk("circle", { class: "abx-chain", cx: 334 + i * 15, cy: 290 + (i % 2) * 5 - 2, r: 2.6, opacity: "0" }, cellG));
mk("circle", { class: "plasmid", cx: 365, cy: 210, r: 13 }, cellG);
mk("circle", { class: "plasmid", cx: 365, cy: 210, r: 5 }, cellG);
/* porins on top membrane */
const porins = [190, 250, 350, 410].map((x) => { const g = mk("g", {}, cellG); mk("rect", { class: "porin", x: x - 8, y: 126, width: 16, height: 22, rx: 4 }, g); const inner = mk("rect", { class: "porin-in", x: x - 3, y: 130, width: 6, height: 14, rx: 2 }, g); return { g, inner }; });
/* PBPs on inner lower membrane, with bound drug dots that appear as drug docks */
const pbps = PBS.map(([x, y]) => mk("circle", { class: "pbp", cx: x, cy: y, r: 7 }, cellG));
const pbpAlts = PBS.map(([x, y]) => mk("circle", { class: "pbp-alt", cx: x, cy: y, r: 7, opacity: 0 }, cellG));
const bound = PBS.map(([x, y]) => mk("circle", { class: "abx-bound", cx: x, cy: y - 9, r: 4, opacity: "0" }, cellG));
/* efflux pump on right membrane */
const pumpG = mk("g", {}, cellG);
mk("rect", { class: "pump-b", x: 492, y: 224, width: 26, height: 68, rx: 8 }, pumpG);
mk("ellipse", { class: "pump-in", cx: 505, cy: 258, rx: 7, ry: 20 }, pumpG);
/* beta-lactamase enzymes inside, with inhibitor caps that sit on them */
const enzymes = ENZ.map(([x, y]) => {
  const g = mk("g", { opacity: 0 }, cellG);
  mk("path", { class: "enzyme", d: "M0 -11L3 -3L11 -3L5 2L7 10L0 5L-7 10L-5 2L-11 -3L-3 -3Z", transform: "translate(" + x + " " + y + ")" }, g);
  return g;
});
const caps = ENZ.map(([x, y]) => mk("circle", { class: "abx-capd", cx: x + 8, cy: y - 8, r: 4.5, opacity: "0" }, cellG));
/* wall cracks that open as the drug kills */
const cracks = ["M138 158l16 12l-7 15l17 9", "M502 276l-17 7l5 16l-15 10", "M248 384l11 -15l13 7l7 -14"]
  .map((d) => mk("path", { class: "abx-crack", d, opacity: "0" }, cellG));
/* small flagella hints */
[110, 150, 450].forEach((x, i) => mk("path", { class: "chrom", d: "M" + x + " " + (150 + i * 90) + "q-22 8 -30 -8", transform: "rotate(" + (i * 40) + " " + x + " " + (150 + i * 90) + ")" }, cellG));

/* population: small rods on the right */
const pop = [];
for (let i = 0; i < 10; i++) {
  const x = 665 + (i % 3) * 88, y = 165 + Math.floor(i / 3) * 62;
  const g = mk("g", { class: "cl cl-bac" }, LY.stage);
  mk("ellipse", { class: "cl-b", rx: 20, ry: 10 }, g);
  mk("circle", { class: "plasmid", cx: 6, cy: 0, r: 4 }, g);
  pop.push({ g, x, y, rot: (i % 3 - 1) * 18 });
}
const donor = pop[1], recip = pop[2];

/* plain-language caption in the stage, following drug and severity */
let capEl = null, capKey = "";
function capText(d, l) {
  const sev = ["No resistance. ", "One defence active. ", "Several defences active. "][l];
  if (d === 1) return sev + (l === 2 ? "The inhibitor caps the enzyme but other defences hold, so bacteria survive." : "The inhibitor caps the enzyme, the drug gets through and bacteria die.");
  if (d === 2) return sev + (l === 2 ? "A different class drug docks on the ribosome and fewer bacteria survive." : "A different class drug docks on the ribosome and bacteria die.");
  return sev + (l === 0 ? "The drug reaches its target and bacteria die." : "Defences destroy or expel the drug and bacteria thrive.");
}

/* labels: pill(parent, text, dotX, dotY, pillCx, pillCy, tip) */
pill(LY.over, "Beta-lactamase", 240, 195, 148, 98, "Beta-lactamase: an enzyme that breaks the beta-lactam ring and destroys the drug before it can act.");
pill(LY.over, "Porin channel", 250, 132, 335, 98, "Porin: a channel in the outer membrane that lets the drug in. Fewer or altered porins mean less drug enters.");
pill(LY.over, "Ribosome", 300, 288, 205, 404, "Ribosome: the target of a different drug class. Modifying its binding site reduces that class too.");
pill(LY.over, "Altered target", 340, 360, 385, 404, "Altered target: changed wall building blocks bind beta-lactams poorly, so the wall keeps being built despite the drug.");
pill(LY.over, "Efflux pump", 505, 258, 560, 404, "Efflux pump: a membrane pump that throws the drug back out, lowering the amount inside the cell.");
pill(LY.over, "Plasmid", 750, 165, 762, 98, "Plasmid: a small DNA circle carrying resistance genes. It can copy itself and pass to another bacterium.");
pill(LY.over, "Survivors", 755, 292, 815, 404, "Selection pressure: the drug kills susceptible bacteria, so resistant survivors multiply and take over the population.");

/* gauges */
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "What happens";
  [["surv", "Survival", "g-bac", "How many bacteria survive and keep growing despite the drug."], ["reach", "Drug at target", "g-good", "How much drug reaches and binds its target inside the cell."], ["barr", "Defences", "g-cyt", "Combined strength of enzyme destruction, blocked entry, efflux and altered targets."], ["spread", "Spread", "g-bad", "How readily resistance spreads as survivors multiply and share plasmids."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 170 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
  capEl = mk("text", { class: "abx-cap", x: 30, y: 434 }, LY.over);
  capEl.textContent = capText(0, 1);
}
const sm = { Surv: 0.5, Reach: 0.5, Barrier: 0.2, Spread: 0.2, Kill: 0.3, bla: 1, pbp: 0, eff: 0, por: 0.5, ribo: 0, inh: 0, bPBP: 0, bRibo: 0, flow: 0.5 };
const acc = { d: 0, i: 0, e: 0, p: 0, dk: 0, ik: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.6);
  sm.Surv = lerp(sm.Surv, m.Surv, k); sm.Reach = lerp(sm.Reach, m.Reach, k); sm.Barrier = lerp(sm.Barrier, m.Barrier, k); sm.Spread = lerp(sm.Spread, m.Spread, k);
  sm.Kill = lerp(sm.Kill, m.Kill, k);
  sm.bla = lerp(sm.bla, m.bla, k); sm.pbp = lerp(sm.pbp, m.pbp, k); sm.eff = lerp(sm.eff, m.eff, k); sm.por = lerp(sm.por, m.por, k); sm.ribo = lerp(sm.ribo, m.ribo, k);
  sm.inh = lerp(sm.inh, drug === 1 ? 1 : 0, k);
  sm.bPBP = lerp(sm.bPBP, drug === 2 ? 0 : m.Reach, k);
  sm.bRibo = lerp(sm.bRibo, drug === 2 ? m.Reach : 0, k);
  sm.flow = lerp(sm.flow, m.Surv, k);
  /* the sickening cell: damage tint, cracks, slight shrinkage */
  const s = 1 - 0.12 * sm.Kill;
  cellG.setAttribute("transform", "translate(" + f1(CX) + " " + f1(CY2) + ") scale(" + s.toFixed(3) + ") translate(" + f1(-CX) + " " + f1(-CY2) + ")");
  dmg.setAttribute("opacity", clamp(sm.Kill * 1.4, 0, 0.55).toFixed(2));
  cracks.forEach((c) => c.setAttribute("opacity", sm.Kill.toFixed(2)));
  caps.forEach((c) => c.setAttribute("opacity", sm.inh.toFixed(2)));
  bound.forEach((c) => c.setAttribute("opacity", sm.bPBP.toFixed(2)));
  docks.forEach((c) => c.setAttribute("opacity", sm.bRibo.toFixed(2)));
  chain.forEach((c, i) => c.setAttribute("opacity", (sm.flow * 5 > i + 0.5 ? 0.9 : 0.06).toFixed(2)));
  enzymes.forEach((g, i) => { g.setAttribute("opacity", (sm.bla * (drug === 1 ? 0.35 : 1)).toFixed(2)); g.setAttribute("transform", "translate(" + f1(Math.sin(tm / 700 + i * 2) * 3) + " " + f1(Math.cos(tm / 800 + i) * 2) + ")"); });
  pbpAlts.forEach((c) => c.setAttribute("opacity", sm.pbp.toFixed(2)));
  pbps.forEach((c) => c.setAttribute("opacity", (1 - sm.pbp).toFixed(2)));
  riboAlt.setAttribute("opacity", sm.ribo.toFixed(2));
  porins.forEach(({ g, inner }) => {
    const open = 1 - sm.por * 0.75, h = 14 * (1 - 0.7 * sm.por);
    g.setAttribute("opacity", (0.3 + 0.7 * open).toFixed(2));
    inner.setAttribute("height", f1(h)); inner.setAttribute("y", f1(137 - h / 2));
  });
  pumpG.setAttribute("opacity", (0.25 + 0.75 * Math.max(sm.eff, 0.15)).toFixed(2));
  pumpG.setAttribute("transform", "translate(" + f1(Math.sin(tm / 300) * sm.eff * 2) + " 0)");
  /* drug particles by treatment */
  const isAlt = drug === 2, isInh = drug === 1;
  acc.d += dt * 3.2; while (acc.d >= 1) { acc.d--; acc.dk++;
    if (isAlt) { const p = freeP(alts); if (p) emit(p, 30, rnd(180, 330), 0, 0, 0); }
    else { const p = freeP(drugs); if (p) emit(p, 30, rnd(180, 330), 0, 0, acc.dk % 4); } }
  acc.i += dt * (isInh ? 2 : 0); while (acc.i >= 1) { acc.i--; acc.ik++; const p = freeP(inhs); if (p) emit(p, 30, rnd(180, 330), 0, 0, acc.ik % 5); }
  function moveDrug(p, alt) {
    if (!p.on) return; p.t += dt;
    const tgt = alt ? [303, 280] : PBS[p.k % 4], tx = tgt[0], ty = tgt[1];
    const inside = p.x > 120 && p.x < 480;
    if (inside && sm.bla > 0.5 && !alt && !isInh && Math.random() < dt * 2.2) { spark(p.x, p.y); killP(p); return; }
    if (inside && sm.eff > 0.5 && Math.random() < dt * 1.4) { killP(p); const e = freeP(ejected); if (e) emit(e, 505, 258, 60, rnd(-20, 20), 0); return; }
    p.x += (tx - p.x) * dt * 0.55 + 34 * dt; p.y += (ty - p.y) * dt * 0.55;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")" + (alt ? " rotate(" + f1(tm / 6) + ")" : ""));
    const near = Math.hypot(tx - p.x, ty - p.y) < (alt ? 12 : 13);
    if (near || p.t > 7) { if (near) spark(p.x, p.y); killP(p); }
  }
  drugs.forEach((p) => moveDrug(p, false)); alts.forEach((p) => moveDrug(p, true));
  inhs.forEach((p) => { if (!p.on) return; p.t += dt; const tgt = ENZ[p.k % 5]; p.x += (tgt[0] - p.x) * dt * 0.5 + 30 * dt; p.y += (tgt[1] - p.y) * dt * 0.5; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(tgt[0] - p.x, tgt[1] - p.y) < 10 || p.t > 5) killP(p); });
  ejected.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.2).toFixed(2)); if (p.t > 1.2 || p.x > 580) killP(p); });
  sparks.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.5).toFixed(2)); if (p.t > 0.5) killP(p); });
  /* population survival */
  const want = Math.max(1, Math.round(sm.Surv * pop.length));
  pop.forEach((b, i) => { const on = i < want; const sc = on ? 1 : 0.12; place(b.g, b.x + Math.sin(tm / 900 + i) * 2, b.y + Math.cos(tm / 1000 + i) * 2, b.rot, sc); b.g.style.opacity = on ? 1 : 0.18; });
  /* conjugation: plasmid dot shuttles donor to recipient when spread is high */
  acc.p += dt * sm.Spread * 1.6; while (acc.p >= 1) { acc.p--; const p = freeP(plasDot); if (p && sm.Spread > 0.2) emit(p, donor.x, donor.y, 0, 0, 0); }
  plasDot.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (recip.x - p.x) * dt * 0.9; p.y += (recip.y - p.y) * dt * 0.9; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(recip.x - p.x, recip.y - p.y) < 10 || p.t > 4) killP(p); });
  gg.surv.set(sm.Surv, wordOf(sm.Surv, 0.35, 0.7, ["killed", "surviving", "thriving"]));
  gg.reach.set(sm.Reach, wordOf(sm.Reach, 0.25, 0.6, ["blocked", "partly", "reaching"]));
  gg.barr.set(sm.Barrier, wordOf(sm.Barrier, 0.25, 0.6, ["none", "some", "strong"]));
  gg.spread.set(sm.Spread, wordOf(sm.Spread, 0.25, 0.55, ["low", "moderate", "high"]));
  const key = drug + ":" + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
