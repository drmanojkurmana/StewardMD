/* Bortezomib scene: jammed proteasome and protein pile-up in the myeloma cell; nerve, skin, bowel and marrow harm. */
const WW = SC.W;
const layers = { cell: $("cellSlot"), prot: $("protG"), pile: $("pileG"), nerve: $("nerveSlot"), skin: $("skinSlot"), bowel: $("bowelSlot"), mar: $("marSlot"), parts: $("parts"), over: $("over"), panel: $("panel") };
const CX = 290, CY = 245, CR = 150, PX = 335, PY = 241, DOCK = [372, 241];
/* ---- myeloma cell with its nucleus ---- */
let deadShade = null;
function initCell() {
  const g = cell(layers.cell, { cls: "my", r: CR, seed: 3, wob: 0.06 });
  place(g, CX, CY, 0, 1);
  deadShade = mk("circle", { class: "bt-dead", cx: 0, cy: 0, r: CR * 0.96, opacity: "0" }, g);
  cell(layers.cell, { cls: "myn", r: 46, seed: 5, wob: 0.1, x: 215, y: 185 });
}
/* ---- proteasome barrel: 20S core rings between two 19S caps, beta-5 site on the rim ---- */
let docked = null;
function initProteasome() {
  const g = layers.prot;
  mk("ellipse", { class: "bt-cap", cx: PX, cy: 202, rx: 30, ry: 13 }, g);
  [216, 229, 242, 255].forEach((y) => mk("rect", { class: "bt-core", x: PX - 30, y: y, width: 60, height: 12, rx: 5 }, g));
  mk("ellipse", { class: "bt-cap", cx: PX, cy: 280, rx: 30, ry: 13 }, g);
  mk("rect", { class: "bt-beta", x: 361, y: 236, width: 8, height: 10, rx: 2 }, g);
  docked = mk("path", { class: "bt-dock", d: "M0 -6L6 0L0 6L-6 0Z", opacity: "0" }, g);
  place(docked, DOCK[0], DOCK[1], 0, 1);
}
/* ---- NF-kB held by IkB in the cytoplasm while the shredder is jammed ---- */
let ikbE = null, nfkE = null;
const BOUND = [402, 322], FREE = [228, 196];
function initNfkb() {
  ikbE = mk("circle", { class: "bt-ikb", r: 9, opacity: "0" }, layers.prot);
  nfkE = mk("circle", { class: "bt-nfk", r: 9 }, layers.prot);
}
/* ---- protein pile-up dots ---- */
const pileDots = [];
function initPile() {
  for (let i = 0; i < 26; i++) {
    const e = mk("circle", { class: "bt-pile", cx: f1(200 + (i * 47) % 90), cy: f1(297 + (i * 31) % 58), r: 3.5, opacity: "0" }, layers.pile);
    pileDots.push(e);
  }
}
/* ---- blebs on the dying cell rim ---- */
const blebs = [];
function initBlebs() { for (let i = 0; i < 6; i++) { const c = mk("circle", { class: "bt-bleb", cx: 0, cy: 0, r: 8, opacity: "0" }, layers.cell); blebs.push({ e: c, a: i * 1.05 + 0.4 }); } }
/* ---- nerve ganglion with pain sparks and a fibre running to the skin ---- */
const sparks = [];
function starD(r1, r2, n) { let d = ""; for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = (i / (n * 2)) * 6.283; d += (i ? "L" : "M") + f1(Math.cos(a) * r) + " " + f1(Math.sin(a) * r); } return d + "Z"; }
function initNerve() {
  organ(layers.nerve, "ganglion", 662, 132, 72, {});
  mk("path", { class: "bt-axon", d: "M700 132L795 130" }, layers.nerve);
  [[628, 100], [640, 166], [702, 100]].forEach(([x, y]) => { const g = mk("g", { opacity: "0" }, layers.nerve); mk("path", { class: "bt-spark", d: starD(10, 4, 8) }, g); place(g, x, y, 0, 1); sparks.push({ g, x, y }); });
}
/* ---- skin with a belt of shingles blisters ---- */
const ves = [];
let rashW = null;
function initSkin() {
  organ(layers.skin, "skin", 850, 135, 110, { h: 95 });
  rashW = mk("ellipse", { class: "bt-rash", cx: 850, cy: 129, rx: 52, ry: 20, opacity: "0" }, layers.skin);
  for (let i = 0; i < 10; i++) ves.push(mk("circle", { class: "bt-ves", cx: f1(808 + (i % 5) * 20), cy: f1(122 + Math.floor(i / 5) * 14), r: 4.2, opacity: "0" }, layers.skin));
}
/* ---- bowel with spasm rings ---- */
const spasms = [];
function initBowel() {
  organ(layers.bowel, "bowel", 668, 292, 140, { h: 110 });
  [[640, 270, 30, 14], [696, 315, 26, 12]].forEach(([x, y, rx, ry]) => spasms.push(mk("ellipse", { class: "bt-spasm", cx: x, cy: y, rx: rx, ry: ry, opacity: "0" }, layers.bowel)));
}
/* ---- marrow inside a small procedural bone: platelets thin out ---- */
const platelets = [];
function initMarrow() {
  const g = layers.mar, bx = 852, by = 295;
  mk("rect", { class: "bt-bone", x: bx - 65, y: by - 13, width: 130, height: 26, rx: 12 }, g);
  [[-65, -8], [-65, 8], [65, -8], [65, 8]].forEach(([dx, dy]) => mk("circle", { class: "bt-bone", cx: bx + dx, cy: by + dy, r: 12 }, g));
  mk("ellipse", { class: "bt-cav", cx: bx, cy: by, rx: 48, ry: 8 }, g);
  for (let i = 0; i < 14; i++) platelets.push(mk("circle", { class: "bt-mcell", cx: f1(bx - 42 + i * 6.5), cy: f1(by + ((i * 37) % 9) - 4), r: 2.6 }, g));
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const bort = pool(12, () => mk("path", { class: "sc-p p-bort", d: "M0 -4.5L4.5 0L0 4.5L-4.5 0Z" }, layers.parts));
const mis = pool(16, () => mk("circle", { class: "sc-p p-mis", r: 2.8 }, layers.parts));
const vir = pool(8, () => mk("circle", { class: "sc-p p-vir", r: 3 }, layers.parts));
const aci = pool(8, () => mk("rect", { class: "sc-p p-aci", x: -4, y: -2, width: 8, height: 4, rx: 2 }, layers.parts));
const churn = pool(10, () => mk("circle", { class: "sc-p p-churn", r: 2.6 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, gauges, caption ---- */
const gg = {};
let capEl = null;
function capText(m) {
  if (!m.on) return "No drug yet: the proteasome shreds scrap protein and nerves, platelets, skin and bowel stay healthy.";
  if (m.prot) return "Bortezomib is jamming proteasomes and killing the myeloma while aciclovir cover holds shingles back.";
  return m.Kill < 0.5 ? "Bortezomib is jamming the proteasome while protein piles up and nerves begin to tingle." : "The myeloma is dying in a pile of its own protein while burning feet, low platelets, shingles and bowel upset build up.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 270, 440, 610, 780];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Benefit and harm";
  [["kill", "Tumour kill", "g-good", "How much myeloma the drug has killed. Rises as blocked proteasomes pile up protein through the course."],
    ["neur", "Neuropathy", "g-neu", "Painful nerve injury: small sensory fibres in the feet are harmed, so tingling builds into burning pain, and autonomic fibres can let blood pressure fall on standing."],
    ["plat", "Low platelets", "g-clot", "Low platelets: counts dip with each exposure and bleeding risk rises, then recover between cycles."],
    ["zos", "Shingles", "g-eos", "Shingles: latent chickenpox virus wakes in nerve roots and breaks out in a belt on the skin. Aciclovir cover holds it back."],
    ["bow", "Bowel upset", "g-fl", "Bowel upset: the gut is disturbed so bouts of diarrhoea and constipation alternate, with nausea and cramps."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Bortezomib", 90, 200, 75, 100, "Bortezomib: a drug that docks on the beta-5 site of the proteasome and reversibly jams it.");
  pill(ox, "Proteasome", 335, 210, 430, 100, "The 26S proteasome: the cell shredder that chops worn out proteins into scraps for recycling.");
  pill(ox, "Protein pile-up", 230, 330, 120, 385, "Misfolded proteins the jammed shredder cannot clear. The pile triggers stress signals that push the cell toward death.");
  pill(ox, "NF-kB blocked", 405, 322, 480, 385, "NF-kB held off: with the shredder jammed, IkB is never destroyed, so NF-kB cannot switch on survival genes.");
  pill(ox, "Nerve", 650, 110, 655, 80, "Nerve: the drug injures small sensory and autonomic fibres, so feet tingle and burn and blood pressure can fall on standing.");
  pill(ox, "Shingles", 862, 122, 897, 74, "Shingles: sleeping chickenpox virus wakes in the nerve root and travels down to blister the skin in a belt.");
  pill(ox, "Bowel", 615, 300, 618, 368, "Bowel: the disturbed gut swings between diarrhoea and constipation, with nausea and cramps.");
  pill(ox, "Platelets", 852, 295, 880, 360, "Platelets: counts dip with each exposure so bruising and bleeding rise, then recover before the next cycle.");
  capEl = mk("text", { class: "bt-capline", x: 30, y: 428 }, ox); capEl.textContent = capText({ on: 0, prot: 0, Kill: 0 });
}
const sm = { Kill: 0, Pile: 0, Neur: 0, Plat: 0, Zos: 0, Bow: 0, on: 0, prot: 0 };
const acc = { bort: 0, mis: 0, vir: 0, aci: 0 };
function init() { initCell(); initProteasome(); initNfkb(); initPile(); initBlebs(); initNerve(); initSkin(); initBowel(); initMarrow(); initPanel();
  churn.forEach((p) => emit(p, rnd(610, 725), rnd(250, 335), rnd(-14, 14), rnd(-10, 10), 0));
}
function step(dt, m) {
  const k2 = Math.min(1, dt * 0.55), k1 = Math.min(1, dt * 0.9);
  ["Kill", "Pile", "Neur", "Plat", "Zos", "Bow"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k2); });
  sm.on = lerp(sm.on, m.on, k1); sm.prot = lerp(sm.prot, m.prot, k1);
  /* dying cell: darkens and blebs */
  deadShade.setAttribute("opacity", (sm.Kill * 0.4).toFixed(2));
  docked.setAttribute("opacity", sm.on.toFixed(2));
  blebs.forEach((b) => { const r = CR + 2; b.e.setAttribute("cx", f1(CX + Math.cos(b.a) * r)); b.e.setAttribute("cy", f1(CY + Math.sin(b.a) * r)); b.e.setAttribute("r", f1(4 + 10 * sm.Kill)); b.e.setAttribute("opacity", sm.Kill > 0.15 ? "1" : "0"); });
  /* pile grows; NF-kB is held while the shredder is jammed, freed when it runs */
  pileDots.forEach((e, i) => e.setAttribute("opacity", clamp(sm.Pile * 28 - i).toFixed(2)));
  const nx = lerp(FREE[0], BOUND[0], sm.on), ny = lerp(FREE[1], BOUND[1], sm.on);
  nfkE.setAttribute("cx", f1(nx)); nfkE.setAttribute("cy", f1(ny));
  ikbE.setAttribute("cx", f1(nx - 14)); ikbE.setAttribute("cy", f1(ny)); ikbE.setAttribute("opacity", sm.on.toFixed(2));
  /* bortezomib drifts in from the left and docks on the beta-5 site */
  acc.bort += dt * sm.on * 5;
  while (acc.bort >= 1) { acc.bort--; const p = free(bort); if (p) emit(p, rnd(24, 60), rnd(150, 340), 0, 0, 0); }
  bort.forEach((p) => { if (!p.on) return; const dx = DOCK[0] - p.x, dy = DOCK[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 60 * dt; p.y += (dy / d) * 60 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); if (d < 12) kill(p); });
  /* misfolded proteins: shredded while the proteasome runs, piling up while it is jammed */
  acc.mis += dt * (3 + 5 * sm.on);
  while (acc.mis >= 1) { acc.mis--; const p = free(mis); if (p) emit(p, rnd(180, 400), rnd(150, 340), 0, 0, 0); }
  mis.forEach((p) => { if (!p.on) return; const jam = sm.on > 0.5, tx = jam ? 245 : PX, ty = jam ? 326 : 205, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 45 * dt; p.y += (dy / d) * 45 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 10) kill(p); });
  /* pain sparks flash on the nerve */
  sparks.forEach((s, i) => { const fl = 0.5 + 0.5 * Math.sin(tm / 140 + i * 2.1); s.g.setAttribute("opacity", (sm.Neur * (0.3 + 0.7 * fl)).toFixed(2)); place(s.g, s.x, s.y, tm / 50 + i * 30, 0.7 + 0.5 * fl); });
  /* virus wakes in the nerve root and travels to the skin; aciclovir rains on the rash */
  acc.vir += dt * sm.Zos * 4;
  while (acc.vir >= 1) { acc.vir--; const p = free(vir); if (p) emit(p, 700, 132, 55, -1, 0); }
  vir.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 800) kill(p); });
  acc.aci += dt * sm.prot * 3;
  while (acc.aci >= 1) { acc.aci--; const p = free(aci); if (p) emit(p, rnd(800, 900), 60, 0, 40, 0); }
  aci.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", p.y > 130 ? clamp(1 - (p.y - 130) / 25).toFixed(2) : "1"); if (p.y > 155) kill(p); });
  ves.forEach((e) => e.setAttribute("opacity", sm.Zos.toFixed(2)));
  rashW.setAttribute("opacity", (sm.Zos * 0.3).toFixed(2));
  /* bowel churns and spasms */
  const drift = Math.sin(tm / 4000) * 10 * sm.Bow;
  churn.forEach((p) => { p.x += (p.vx + drift) * dt; p.y += p.vy * dt; if (p.x < 610 || p.x > 725) p.vx = -p.vx; if (p.y < 250 || p.y > 335) p.vy = -p.vy; p.x = clamp(p.x, 610, 725); p.y = clamp(p.y, 250, 335); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", sm.Bow.toFixed(2)); });
  spasms.forEach((e, i) => e.setAttribute("opacity", (sm.Bow * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(tm / 500 + i * 2)))).toFixed(2)));
  /* platelets thin out */
  const keep = Math.round((1 - sm.Plat * 0.92) * platelets.length);
  platelets.forEach((e, i) => e.setAttribute("opacity", i < keep ? "1" : "0"));
  /* caption and gauges */
  const c = capText(m); if (capEl.textContent !== c) capEl.textContent = c;
  gg.kill.set(sm.Kill, wordOf(sm.Kill, 0.3, 0.65, ["none", "some", "high"]));
  gg.neur.set(sm.Neur, wordOf(sm.Neur, 0.3, 0.6, ["none", "tingling", "burning"]));
  gg.plat.set(sm.Plat, wordOf(sm.Plat, 0.3, 0.6, ["normal", "low", "very low"]));
  gg.zos.set(sm.Zos, wordOf(sm.Zos, 0.45, 0.7, ["none", "some", "severe"]));
  gg.bow.set(sm.Bow, wordOf(sm.Bow, 0.35, 0.6, ["calm", "upset", "severe"]));
}
run({ init, step });
