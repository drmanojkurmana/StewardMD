/* GERD scene: acid and pepsin reflux, sphincter opening, hiatus hernia, mucosal change and the gauges. */
const layers = { hernia: $("hernia"), anat: $("anatomy"), muc: $("mucosa"), parts: $("parts"), over: $("over"), panel: $("panel") };
const refs = {};
function initAnatomy() {
  const A = layers.anat;
  mk("rect", { class: "gerd-lumen", x: 338, y: 78, width: 84, height: 250 }, A);
  mk("rect", { class: "gerd-wall", x: 326, y: 78, width: 12, height: 250, rx: 5 }, A);
  mk("rect", { class: "gerd-wall", x: 422, y: 78, width: 12, height: 250, rx: 5 }, A);
  mk("rect", { class: "gerd-muc", x: 338, y: 78, width: 6, height: 250 }, A);
  mk("rect", { class: "gerd-muc", x: 416, y: 78, width: 6, height: 250 }, A);
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
  mk("ellipse", { class: "gerd-stom", cx: 380, cy: 392, rx: 120, ry: 48 }, A);
  mk("rect", { class: "gerd-stom", x: 334, y: 322, width: 92, height: 36 }, A);
  mk("ellipse", { class: "gerd-acidpool", cx: 380, cy: 410, rx: 84, ry: 24 }, A);
  mk("rect", { class: "gerd-diag", x: 44, y: 318, width: 282, height: 14, rx: 6 }, A);
  mk("rect", { class: "gerd-diag", x: 434, y: 318, width: 124, height: 14, rx: 6 }, A);
  refs.herniaG = mk("g", {}, layers.hernia);
  mk("ellipse", { class: "gerd-hernia", cx: 0, cy: 0, rx: 54, ry: 21 }, refs.herniaG);
  mk("ellipse", { class: "gerd-acidpool", cx: 0, cy: 4, rx: 34, ry: 10 }, refs.herniaG);
  refs.lesL = mk("rect", { class: "gerd-les", x: 326, y: 326, width: 52, height: 17, rx: 8 }, A);
  refs.lesR = mk("rect", { class: "gerd-les", x: 382, y: 326, width: 52, height: 17, rx: 8 }, A);
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
  pill(ox, "Oesophagus", 365, 120, 200, 100, "Oesophagus: the muscular tube carrying food to the stomach. Its lower lining is normally squamous.");
  pill(ox, "Lower sphincter", 330, 334, 170, 300, "Lower oesophageal sphincter: a ring of muscle at the junction. Weakness and transient relaxations at the wrong time let gastric fluid reflux.");
  pill(ox, "Stomach", 460, 410, 535, 380, "Stomach: contains acid and pepsin that digest food. The same fluid injures the oesophageal lining.");
  pill(ox, "Hiatus hernia", 380, 292, 500, 260, "Hiatus hernia: part of the stomach slides up through the diaphragm. It impairs the sphincter and traps refluxed fluid.");
  pill(ox, "Acid and pepsin", 395, 398, 160, 380, "Acid and pepsin: gastric fluid that flows back during reflux. Acid suppression makes it less injurious.");
  pill(ox, "Barrett segment", 418, 278, 500, 200, "Barrett segment: salmon-coloured columnar mucosa extending up from the junction, replacing squamous lining after repeated injury.");
  pill(ox, "Stricture", 342, 246, 190, 210, "Peptic stricture: narrowing from inflammation and scarring. It can make swallowing solid food difficult.");
  pill(ox, "Columnar cells", 700, 210, 680, 106, "Columnar cells with goblet cells: the metaplastic lining of Barrett oesophagus, seen in the close-up as taller orange cells.");
  pill(ox, "Dysplasia", 820, 246, 838, 150, "Dysplasia: crowded, abnormal cells and nuclei in Barrett mucosa. High-grade dysplasia is the step before adenocarcinoma.");
  pill(ox, "Basement membrane", 660, 308, 680, 380, "Basement membrane: the boundary under the lining. Cancer is present when abnormal cells grow through it into deeper tissue.");
}
const sm = { R: 0.3, A: 0.3, I: 0.2, B: 0, ST: 0, CA: 0, H: 0.2, weak: 0.4, D: 0 };
const acc = { acid: 0, pep: 0 };
function init() { initAnatomy(); initMucosa(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.R = lerp(sm.R, m.R, k2); sm.A = lerp(sm.A, m.A, k2); sm.I = lerp(sm.I, m.I, k2); sm.B = lerp(sm.B, m.B, k2); sm.ST = lerp(sm.ST, m.ST, k2); sm.CA = lerp(sm.CA, m.CA, k2); sm.H = lerp(sm.H, m.H, k2); sm.weak = lerp(sm.weak, m.weak, k1); sm.D = lerp(sm.D, m.D || 0, k2);
  const phase = (tm / 2800) % 1, transient = phase < 0.3 ? Math.sin((phase / 0.3) * Math.PI) : 0;
  const gateOpen = clamp(sm.weak * 0.4 + transient * (0.25 + 0.75 * sm.R));
  refs.lesL.setAttribute("x", f1(326 - gateOpen * 18)); refs.lesR.setAttribute("x", f1(382 + gateOpen * 18));
  place(refs.herniaG, 380, 314, 0, 0.25 + 0.75 * sm.H); refs.herniaG.setAttribute("opacity", sm.H > 0.04 ? "1" : "0");
  refs.infl.setAttribute("opacity", (sm.I * 0.5).toFixed(2));
  const bh = sm.B * 118; refs.barrL.setAttribute("y", f1(328 - bh)); refs.barrL.setAttribute("height", f1(bh)); refs.barrR.setAttribute("y", f1(328 - bh)); refs.barrR.setAttribute("height", f1(bh));
  refs.strict.setAttribute("opacity", (sm.ST * 0.95).toFixed(2)); refs.strict.setAttribute("transform", "translate(" + f1(380) + " 246) scale(" + (0.35 + 0.65 * sm.ST).toFixed(2) + ") translate(-380 -246)");
  refs.tum.setAttribute("opacity", (sm.CA * 0.95).toFixed(2)); refs.tum.setAttribute("transform", "translate(410 300) scale(" + (0.3 + 0.7 * sm.CA).toFixed(2) + ") translate(-410 -300)");
  refs.sqG.setAttribute("opacity", clamp(1 - sm.B * 0.9 - sm.CA * 0.4).toFixed(2));
  refs.colG.setAttribute("opacity", clamp(sm.B * (1 - sm.D * 0.45)).toFixed(2));
  refs.dysG.setAttribute("opacity", clamp(sm.D * (1 - sm.CA * 0.35)).toFixed(2));
  refs.caG.setAttribute("opacity", (sm.CA * 0.95).toFixed(2));
  acc.acid += dt * sm.R * (gateOpen > 0.32 ? 13 : 1.5); while (acc.acid >= 1) { acc.acid--; const p = freeP(acid); if (p) emit(p, rnd(348, 412), rnd(398, 416), rnd(-5, 5), -rnd(42, 62), 326 - sm.R * 175 - rnd(0, 36)); }
  acid.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 380 + p.y) * 0.25; p.y += p.vy * dt; p.x = clamp(p.x, 342, 418); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < p.k || p.y < 84) kill(p); });
  acc.pep += dt * sm.A * (gateOpen > 0.32 ? 7 : 0.8); while (acc.pep >= 1) { acc.pep--; const p = freeP(pep); if (p) emit(p, rnd(348, 412), rnd(398, 416), rnd(-5, 5), -rnd(36, 52), 326 - sm.A * 150 - rnd(0, 30)); }
  pep.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 342, 418); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.y < p.k || p.y < 84) kill(p); });
  gg.reflux.set(sm.R, wordOf(sm.R, 0.25, 0.6, ["low", "moderate", "high"])); gg.injury.set(sm.I, wordOf(sm.I, 0.2, 0.55, ["none", "inflamed", "severe"])); gg.barr.set(sm.B, wordOf(sm.B, 0.15, 0.6, ["absent", "present", "wide"])); gg.strict.set(sm.ST, wordOf(sm.ST, 0.2, 0.55, ["none", "mild", "tight"])); gg.ca.set(sm.CA, wordOf(sm.CA, 0.1, 0.5, ["absent", "at risk", "present"]));
}
run({ init, step });
