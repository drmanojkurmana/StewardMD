/* GERD scene: acid and pepsin reflux through the sphincter, stomach acid pumps
 * blocked by treatment, wrap and healing of the lining, plus the gauges. */
const layers = { hernia: $("hernia"), stomach: $("stomachSlot"), anat: $("anatomy"), muc: $("mucosa"), parts: $("parts"), over: $("over"), panel: $("panel") };
const refs = {};
let stomachO = null, capEl = null, capDrug = -1, acidWeak = false;
const pumps = [], blockers = [];
function capText(d) {
  if (d === 1) return "Lifestyle measures tighten the junction. Less acid washes up.";
  if (d === 2) return "Acid suppression blocks the acid pumps. Reflux is weaker and the lining heals.";
  if (d === 3) return "Surgery wraps the junction and removes Barrett tissue. Reflux stops.";
  return "No treatment. Acid washes up and burns the lining.";
}
function initOrgans() {
  stomachO = organ($("stomachSlot"), "stomach", 380, 368, 170, { h: 92 });
  mk("ellipse", { class: "gerd-acidpool", cx: 375, cy: 390, rx: 52, ry: 12 }, layers.stomach);
}
function initAnatomy() {
  const A = layers.anat;
  mk("rect", { class: "gerd-lumen", x: 338, y: 78, width: 84, height: 266 }, A);
  mk("rect", { class: "gerd-wall", x: 326, y: 78, width: 12, height: 266, rx: 5 }, A);
  mk("rect", { class: "gerd-wall", x: 422, y: 78, width: 12, height: 266, rx: 5 }, A);
  mk("rect", { class: "gerd-muc", x: 338, y: 78, width: 6, height: 266 }, A);
  mk("rect", { class: "gerd-muc", x: 416, y: 78, width: 6, height: 266 }, A);
  refs.infl = mk("rect", { class: "gerd-infl", x: 344, y: 208, width: 72, height: 120, opacity: "0" }, A);
  refs.barrL = mk("rect", { class: "gerd-barr", x: 338, y: 328, width: 9, height: 0 }, A);
  refs.barrR = mk("rect", { class: "gerd-barr", x: 413, y: 328, width: 9, height: 0 }, A);
  refs.strict = mk("g", { opacity: "0" }, A);
  mk("ellipse", { class: "gerd-strict", cx: 340, cy: 246, rx: 11, ry: 24 }, refs.strict);
  mk("ellipse", { class: "gerd-strict", cx: 420, cy: 246, rx: 11, ry: 24 }, refs.strict);
  refs.tum = mk("g", { opacity: "0" }, A);
  mk("circle", { class: "gerd-tum", cx: 414, cy: 292, r: 17 }, refs.tum);
  mk("circle", { class: "gerd-tum", cx: 400, cy: 306, r: 13 }, refs.tum);
  mk("circle", { class: "gerd-tum", cx: 424, cy: 310, r: 11 }, refs.tum);
  mk("rect", { class: "gerd-diag", x: 44, y: 318, width: 282, height: 14, rx: 6 }, A);
  mk("rect", { class: "gerd-diag", x: 434, y: 318, width: 124, height: 14, rx: 6 }, A);
  refs.herniaG = mk("g", {}, layers.hernia);
  mk("ellipse", { class: "gerd-hernia", cx: 0, cy: 0, rx: 54, ry: 21 }, refs.herniaG);
  mk("ellipse", { class: "gerd-acidpool", cx: 0, cy: 4, rx: 34, ry: 10 }, refs.herniaG);
  refs.lesL = mk("rect", { class: "gerd-les", x: 326, y: 326, width: 52, height: 17, rx: 8 }, A);
  refs.lesR = mk("rect", { class: "gerd-les", x: 382, y: 326, width: 52, height: 17, rx: 8 }, A);
  refs.wrap = mk("rect", { class: "gerd-wrap", x: 318, y: 316, width: 124, height: 36, rx: 17, opacity: "0" }, A);
  [[348, 392], [378, 396], [408, 392]].forEach(([x, y]) => {
    mk("circle", { class: "gerd-pump", cx: x, cy: y, r: 5 }, layers.parts);
    mk("circle", { class: "gerd-pumpin", cx: x, cy: y, r: 2 }, layers.parts);
    pumps.push({ x, y });
  });
  for (let i = 0; i < 4; i++) {
    const e = mk("circle", { class: "gerd-block", r: 4, opacity: "0" }, layers.parts);
    blockers.push({ e, hx: 336 + i * 30, hy: 352 });
  }
}
function initMucosa() {
  const M = layers.muc;
  refs.sqG = mk("g", {}, M); refs.colG = mk("g", { opacity: "0" }, M); refs.dysG = mk("g", { opacity: "0" }, M); refs.caG = mk("g", { opacity: "0" }, M);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) mk("rect", { class: "gerd-squam", x: 642 + c * 30, y: 226 + r * 20, width: 26, height: 16, rx: 6 }, refs.sqG);
  for (let c = 0; c < 8; c++) { mk("rect", { class: "gerd-colcell", x: 642 + c * 30, y: 192, width: 26, height: 116, rx: 7 }, refs.colG); mk("ellipse", { class: "gerd-gob", cx: 655 + c * 30, cy: 232, rx: 6, ry: 11 }, refs.colG); mk("ellipse", { class: "gerd-nucleus", cx: 655 + c * 30, cy: 292, rx: 5, ry: 7 }, refs.colG); }
  for (let c = 0; c < 8; c++) { mk("rect", { class: "gerd-dys", x: 642 + c * 30, y: 198 + (c % 3) * 5, width: 26, height: 110 - (c % 3) * 5, rx: 6 }, refs.dysG); mk("ellipse", { class: "gerd-nucleus", cx: 655 + c * 30, cy: 250 + (c % 2) * 24, rx: 7, ry: 11 }, refs.dysG); }
  mk("circle", { class: "gerd-tum", cx: 700, cy: 322, r: 26 }, refs.caG); mk("circle", { class: "gerd-tum", cx: 758, cy: 334, r: 32 }, refs.caG); mk("circle", { class: "gerd-tum", cx: 822, cy: 320, r: 25 }, refs.caG); mk("circle", { class: "gerd-tum", cx: 730, cy: 292, r: 18 }, refs.caG); mk("circle", { class: "gerd-tum", cx: 800, cy: 290, r: 16 }, refs.caG);
  mk("line", { class: "gerd-bm", x1: 640, y1: 308, x2: 882, y2: 308 }, M);
  const cap = mk("text", { class: "sc-zone sc-dim", x: 640, y: 132 }, M); cap.textContent = "LINING CELLS";
  const cap2 = mk("text", { class: "sc-zone sc-dim", x: 770, y: 386 }, M); cap2.textContent = "DEEPER TISSUE";
}
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const acid = pool(26, () => mk("circle", { class: "p-acid", r: 3.2 }, layers.parts));
const pep = pool(16, () => mk("path", { class: "p-pep", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [120, 280, 440, 600, 760];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The oesophagus";
  [["reflux", "Reflux", "g-reflux", "How often and how high gastric fluid flows back into the oesophagus."], ["injury", "Injury", "g-injury", "Mucosal injury from acid and pepsin: redness, erosions and ulceration in oesophagitis."], ["barr", "Barrett", "g-barr", "Columnar metaplasia replacing squamous lining at the junction. It can progress through dysplasia."], ["strict", "Stricture", "g-strict", "Peptic narrowing from scarring after repeated injury. It makes swallowing harder."], ["ca", "Cancer", "g-ca", "Oesophageal adenocarcinoma arising in Barrett mucosa after high-grade dysplasia."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Oesophagus", 365, 140, 200, 108, "Food tube to the stomach. Acid washing up burns its lining.");
  pill(ox, "Sphincter", 332, 334, 170, 300, "Muscle ring at the junction. When loose, stomach fluid flows back.");
  pill(ox, "Stomach", 440, 392, 520, 400, "Makes acid and pepsin that digest food and can burn the gullet.");
  pill(ox, "Hernia", 380, 296, 505, 262, "Bit of stomach pushed above the diaphragm. Harder to keep acid down.");
  pill(ox, "Acid", 360, 390, 160, 382, "Stomach acid and pepsin. Acid suppression makes this fluid weaker.");
  pill(ox, "Barrett", 418, 280, 505, 196, "Pink lining replacing the normal pale lining after burns. See the close up on the right.");
  pill(ox, "Stricture", 340, 246, 190, 216, "Narrowing from scarring after repeated burns. Food can stick.");
  pill(ox, "Cancer", 758, 310, 770, 152, "Abnormal growth in Barrett lining that has broken through. Surgery can remove it.");
  capEl = mk("text", { class: "gerd-cap", x: 30, y: 434 }, ox); capEl.textContent = capText(0);
}
const sm = { R: 0.3, A: 0.3, I: 0.2, B: 0, ST: 0, CA: 0, H: 0.2, weak: 0.4, D: 0, block: 0, wrap: 0, life: 0 };
const acc = { acid: 0, pep: 0 };
function init() { initOrgans(); initAnatomy(); initMucosa(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.7);
  sm.R = lerp(sm.R, m.R, k2); sm.A = lerp(sm.A, m.A, k2); sm.I = lerp(sm.I, m.I, k2); sm.B = lerp(sm.B, m.B, k2); sm.ST = lerp(sm.ST, m.ST, k2); sm.CA = lerp(sm.CA, m.CA, k2); sm.H = lerp(sm.H, m.H, k2); sm.weak = lerp(sm.weak, m.weak, k1); sm.D = lerp(sm.D, m.D || 0, k2);
  sm.block = lerp(sm.block, drug === 2 ? 1 : 0, k1); sm.wrap = lerp(sm.wrap, drug === 3 ? 1 : 0, k1); sm.life = lerp(sm.life, drug === 1 ? 1 : 0, k1);
  const phase = (tm / 2800) % 1, transient = phase < 0.3 ? Math.sin((phase / 0.3) * Math.PI) : 0;
  const gateOpen = clamp((sm.weak * 0.4 + transient * (0.25 + 0.75 * sm.R)) * (1 - 0.3 * sm.life) * (1 - 0.45 * sm.wrap));
  refs.lesL.setAttribute("x", f1(326 - gateOpen * 18)); refs.lesR.setAttribute("x", f1(382 + gateOpen * 18));
  refs.wrap.setAttribute("opacity", (sm.wrap * 0.95).toFixed(2));
  refs.wrap.setAttribute("transform", "translate(380 334) scale(" + (0.92 + 0.08 * sm.wrap).toFixed(3) + ") translate(-380 -334)");
  place(refs.herniaG, 380, 314, 0, 0.25 + 0.75 * sm.H); refs.herniaG.setAttribute("opacity", sm.H > 0.04 ? "1" : "0");
  refs.infl.setAttribute("opacity", (sm.I * 0.5).toFixed(2));
  const bh = sm.B * 118; refs.barrL.setAttribute("y", f1(328 - bh)); refs.barrL.setAttribute("height", f1(bh)); refs.barrR.setAttribute("y", f1(328 - bh)); refs.barrR.setAttribute("height", f1(bh));
  refs.strict.setAttribute("opacity", (sm.ST * 0.95).toFixed(2)); refs.strict.setAttribute("transform", "translate(" + f1(380) + " 246) scale(" + (0.35 + 0.65 * sm.ST).toFixed(2) + ") translate(-380 -246)");
  refs.tum.setAttribute("opacity", (sm.CA * 0.95).toFixed(2)); refs.tum.setAttribute("transform", "translate(410 300) scale(" + (0.3 + 0.7 * sm.CA).toFixed(2) + ") translate(-410 -300)");
  refs.sqG.setAttribute("opacity", clamp(1 - sm.B * 0.9 - sm.CA * 0.4).toFixed(2));
  refs.colG.setAttribute("opacity", clamp(sm.B * (1 - sm.D * 0.45)).toFixed(2));
  refs.dysG.setAttribute("opacity", clamp(sm.D * (1 - sm.CA * 0.35)).toFixed(2));
  refs.caG.setAttribute("opacity", (sm.CA * 0.95).toFixed(2));
  const e = sm.block * sm.block * (3 - 2 * sm.block);
  blockers.forEach((b, i) => {
    const d = pumps[i % pumps.length];
    place(b.e, lerp(b.hx, d.x, e), lerp(b.hy, d.y, e) + Math.sin(tm / 450 + i * 2.1) * 2 * e, 0, 0.6 + 0.4 * e);
    b.e.setAttribute("opacity", e.toFixed(2));
  });
  const wantWeak = drug === 2;
  if (wantWeak !== acidWeak) { acidWeak = wantWeak; acid.forEach((p) => p.e.setAttribute("class", acidWeak ? "p-weak" : "p-acid")); }
  acc.acid += dt * (2 + 11 * sm.R) * (gateOpen > 0.32 ? 1 : 0.12); while (acc.acid >= 1) { acc.acid--; const p = freeP(acid); if (p) emit(p, rnd(348, 412), rnd(382, 396), rnd(-5, 5), -rnd(42, 62), 322 - sm.R * 170 - rnd(0, 36)); }
  acid.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 380 + p.y) * 0.25; p.y += p.vy * dt; p.x = clamp(p.x, 342, 418); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < p.k || p.y < 84) kill(p); });
  acc.pep += dt * (0.5 + 7 * sm.A) * (gateOpen > 0.32 ? 1 : 0.15); while (acc.pep >= 1) { acc.pep--; const p = freeP(pep); if (p) emit(p, rnd(348, 412), rnd(382, 396), rnd(-5, 5), -rnd(36, 52), 322 - sm.A * 150 - rnd(0, 30)); }
  pep.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 342, 418); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.y < p.k || p.y < 84) kill(p); });
  gg.reflux.set(sm.R, wordOf(sm.R, 0.25, 0.6, ["low", "moderate", "high"])); gg.injury.set(sm.I, wordOf(sm.I, 0.2, 0.55, ["none", "inflamed", "severe"])); gg.barr.set(sm.B, wordOf(sm.B, 0.15, 0.6, ["absent", "present", "wide"])); gg.strict.set(sm.ST, wordOf(sm.ST, 0.2, 0.55, ["none", "mild", "tight"])); gg.ca.set(sm.CA, wordOf(sm.CA, 0.1, 0.5, ["absent", "at risk", "present"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
