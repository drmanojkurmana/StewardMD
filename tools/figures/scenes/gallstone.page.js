/* Gallstone scene: supersaturated bile, crystals, cholesterol and pigment stones, colic, cholecystitis, duct stone and gauges. */
const WW = SC.W;
const layers = { bile: $("bileFlow"), crys: $("crystals"), stones: $("stonesG"), bili: $("bilirubin"), bugs: $("bugs"), neuts: $("neuts"), parts: $("parts"), scopeG: $("scopeG"), over: $("over"), panel: $("panel") };
const bileTrack = track([[470, 150], [512, 186], [538, 202], [546, 262], [578, 326], [645, 350], [720, 350]]);
/* ---- dynamic stones ---- */
let cholStone = null, cystStone = null, cbdStone = null;
const pigStones = [];
function initStones() {
  const S = layers.stones;
  cholStone = mk("g", {}, S);
  mk("path", { class: "gs-stone-c", d: "M-14 -7L-5 -15L8 -13L15 -3L11 10L1 16L-10 11L-16 2Z" }, cholStone);
  mk("path", { class: "gs-facet", d: "M-14 -7L1 0L8 -13M1 0L11 10M1 0L-10 11" }, cholStone);
  [[348, 332], [366, 321], [358, 343]].forEach(([x, y]) => { const g = mk("g", { transform: "translate(" + x + " " + y + ")" }, S); mk("circle", { class: "gs-stone-p", r: 7 }, g); mk("circle", { class: "cl-h", r: 2, cx: -2, cy: -2 }, g); pigStones.push(g); });
  cystStone = mk("g", {}, S);
  mk("path", { class: "gs-stone-c", d: "M-9 -5L0 -9L9 -4L7 7L-3 10L-10 3Z" }, cystStone);
  cbdStone = mk("g", {}, S);
  mk("path", { class: "gs-stone-c", d: "M-11 -6L-2 -12L10 -8L13 4L5 12L-8 9L-13 1Z" }, cbdStone);
  mk("path", { class: "gs-facet", d: "M-11 -6L2 1L10 -8M2 1L5 12" }, cbdStone);
  const P = layers.parts;
  for (let i = 0; i < 3; i++) mk("path", { class: "gs-pain", id: "pain" + i, d: "M" + (14 + i * 9) + " " + (-12 - i * 4) + "a" + (18 + i * 8) + " " + (18 + i * 8) + " 0 0 1 0 " + (24 + i * 8) }, P);
  const Sc = layers.scopeG;
  mk("path", { id: "scopePath", class: "gs-scope", d: "M725 350L645 350L578 326L550 280", opacity: "0" }, Sc);
  mk("circle", { id: "scopeTip", class: "gs-clip", r: 4, cx: 550, cy: 280, opacity: "0" }, Sc);
  mk("rect", { id: "clip1", class: "gs-clip", x: 424, y: 182, width: 5, height: 16, rx: 2, opacity: "0" }, Sc);
  mk("rect", { id: "clip2", class: "gs-clip", x: 434, y: 182, width: 5, height: 16, rx: 2, opacity: "0" }, Sc);
  [[176, 182], [560, 298], [602, 334], [682, 340], [556, 238]].forEach(([x, y], i) => { const g = mk("g", { class: "cl cl-bug2 bug2", transform: "translate(" + x + " " + y + ") rotate(" + (i * 41) + ")" }, layers.bugs); mk("ellipse", { class: "cl-b", rx: 6, ry: 3 }, g); });
}
/* ---- neutrophils around the gallbladder ---- */
const neutPos = [[232, 240], [408, 258], [262, 352], [382, 348]];
let neutGs = [];
function initNeuts() { neutGs = neutPos.map(([x, y], i) => { const g = cell(layers.neuts, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: i + 7, wob: 0.14 }); place(g, x, y, 0, 1); g.style.opacity = "0"; return g; }); }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0 }; }); }
const bileP = pool(22, () => mk("circle", { class: "sc-p p-bile", r: 2.6 }, layers.bile));
const crysP = pool(24, () => mk("path", { class: "sc-p p-chol", d: "M0 -4L3 0L0 4L-3 0Z" }, layers.crys));
const biliP = pool(16, () => mk("circle", { class: "sc-p p-bili", r: 2.8 }, layers.bili));
const fragP = pool(12, () => mk("path", { class: "sc-p p-frag2", d: "M0 -3L3 1L-2 3Z" }, layers.parts));
const capsP = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
let inflPillEl = null, ductPillEl = null, ercpPillEl = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["sat", "Saturation", "g-sat", "How supersaturated bile is with cholesterol compared with bile salts and lecithin. Above saturation, crystals can form."], ["stone", "Stones", "g-stone", "Stone burden in the gallbladder and duct. Cholesterol stones are pale; pigment stones are dark."], ["block", "Blockage", "g-block", "Blockage of the cystic duct or the common bile duct by a stone."], ["inf", "Inflammation", "g-bad", "Inflammation of the gallbladder wall in cholecystitis, or of the bile duct in cholangitis."], ["jaund", "Jaundice", "g-jaund", "Yellowing from bilirubin backing up when the common bile duct is blocked."], ["pain", "Pain", "g-bad", "Biliary colic pain when the gallbladder squeezes against a stone stuck in its outlet."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Liver", 200, 140, 130, 205, "Liver: makes bile. Cholesterol in bile is held in solution by bile salts and lecithin.");
  pill(ox, "Gallbladder", 285, 275, 130, 285, "Gallbladder: stores and concentrates bile. Poor emptying and stasis help crystals nucleate and grow into stones.");
  pill(ox, "Cholesterol stone", 295, 322, 140, 360, "Cholesterol stone: pale stone formed when bile is supersaturated with cholesterol compared with bile salts and lecithin.");
  pill(ox, "Pigment stones", 358, 332, 285, 405, "Pigment stones: small dark stones of calcium bilirubinate, formed when excess bilirubin reaches bile, for example in haemolysis.");
  pill(ox, "Cystic duct", 455, 193, 620, 110, "Cystic duct: the gallbladder outlet. A stone stuck here while the gallbladder squeezes causes biliary colic.");
  pill(ox, "Common bile duct", 548, 265, 700, 180, "Common bile duct: carries bile to the duodenum. A stone here blocks bile flow and causes jaundice.");
  pill(ox, "Duodenum", 730, 330, 840, 215, "Duodenum: bile enters here to help digest fat. Bacteria from here can ascend a blocked duct and cause cholangitis.");
  pill(ox, "Bile flow", 540, 230, 860, 95, "Bile flow: bile made in the liver drains through the ducts to the duodenum, with some stored in the gallbladder.");
  inflPillEl = pill(ox, "Inflamed wall", 240, 250, 480, 405, "Inflamed wall: in cholecystitis the blocked gallbladder wall becomes swollen, red and tender, often with fever.");
  ductPillEl = pill(ox, "Duct stone", 550, 278, 700, 425, "Duct stone: a stone in the common bile duct. Bile backs up, causing jaundice, and infected held back bile causes cholangitis.");
  ercpPillEl = pill(ox, "ERCP scope", 660, 350, 855, 425, "ERCP: a scope passed through the duodenum to open the duct opening and clear a duct stone.");
  inflPillEl.style.opacity = "0"; ductPillEl.style.opacity = "0"; ercpPillEl.style.opacity = "0";
}
const sm = { Sat: 0.85, StoneGB: 0.55, StoneDuct: 0, Cyst: 0, Cbd: 0, Chol: 0, Inf: 0.08, InfAll: 0.08, Jaund: 0, Pain: 0.12, Flow: 1, analg: 0, chole: 0, ercp: 0 };
const acc = { crys: 0, frag: 0, caps: 0 };
function init() { initStones(); initNeuts(); initPanel(); bileP.forEach((p, i) => { p.on = true; p.u = i / bileP.length; p.e.setAttribute("opacity", "1"); }); biliP.forEach((p, i) => { emit(p, rnd(100, 510), rnd(78, 158), rnd(-9, 9), rnd(-6, 6)); }); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  sm.Sat = lerp(sm.Sat, m.Sat, k2); sm.StoneGB = lerp(sm.StoneGB, m.StoneGB, k2); sm.StoneDuct = lerp(sm.StoneDuct, m.StoneDuct, k2);
  sm.Cyst = lerp(sm.Cyst, m.Cyst, k1); sm.Cbd = lerp(sm.Cbd, m.Cbd, k1); sm.Chol = lerp(sm.Chol, m.Chol, k2);
  sm.Inf = lerp(sm.Inf, m.Inf, k2); sm.InfAll = lerp(sm.InfAll, m.InfAll, k2); sm.Jaund = lerp(sm.Jaund, m.Jaund, k2);
  sm.Pain = lerp(sm.Pain, m.Pain, k1); sm.Flow = lerp(sm.Flow, m.Flow, k1);
  sm.analg = lerp(sm.analg, m.analg, k1); sm.chole = lerp(sm.chole, m.chole, k1); sm.ercp = lerp(sm.ercp, m.ercp, k1);
  /* gallbladder: removed, inflamed and squeezing */
  const gb = $("gbWrap");
  if (gb) { const sq = 1 + 0.035 * sm.Pain * Math.sin(tm / 300); gb.setAttribute("opacity", (1 - sm.chole * 0.85).toFixed(2)); gb.setAttribute("transform", "translate(317 272) scale(" + sq.toFixed(3) + ") translate(-317 -272)"); }
  const wall = $("gbWall");
  if (wall) wall.setAttribute("class", sm.Inf > 0.45 ? "gs-gb-hot" : "gs-gb");
  const liv = $("liverShape");
  if (liv) liv.style.opacity = (1 - sm.Jaund * 0.25).toFixed(2);
  /* stones */
  if (cholStone) { const s = (0.35 + sm.StoneGB * 0.95) * (1 - sm.chole); cholStone.setAttribute("transform", "translate(295 322) rotate(" + f1(Math.sin(tm / 700) * 4) + ") scale(" + s.toFixed(3) + ")"); cholStone.style.opacity = clamp(sm.StoneGB * 1.6).toFixed(2); }
  pigStones.forEach((g, i) => { g.style.opacity = clamp(sm.StoneGB * 1.6 - i * 0.12).toFixed(2); const sc = (0.6 + sm.StoneGB * 0.5).toFixed(3); g.setAttribute("transform", g.getAttribute("transform").replace(/scale\([^)]*\)/, "") + " scale(" + sc + ")"); });
  if (cystStone) { const s = sm.Cyst * (1 - sm.chole); cystStone.setAttribute("transform", "translate(388 190) scale(" + (0.25 + s * 0.9).toFixed(3) + ")"); cystStone.style.opacity = clamp(s * 1.8).toFixed(2); }
  if (cbdStone) { const s = sm.StoneDuct; cbdStone.setAttribute("transform", "translate(550 278) rotate(" + f1(Math.sin(tm / 600) * 6) + ") scale(" + (0.25 + s * 0.95).toFixed(3) + ")"); cbdStone.style.opacity = clamp(s * 1.8).toFixed(2); }
  if (ductPillEl) ductPillEl.style.opacity = clamp(sm.StoneDuct * 1.6).toFixed(2);
  if (inflPillEl) inflPillEl.style.opacity = clamp((sm.Inf - 0.4) * 1.8).toFixed(2);
  if (ercpPillEl) ercpPillEl.style.opacity = sm.ercp.toFixed(2);
  /* pain arcs at the gallbladder neck */
  for (let i = 0; i < 3; i++) { const el = $("pain" + i); if (el) { el.setAttribute("transform", "translate(388 196)"); el.setAttribute("opacity", (sm.Pain * clamp(0.4 + 0.6 * (0.5 + 0.5 * Math.sin(tm / 420 + i * 0.9)))).toFixed(2)); } }
  /* neutrophils and duct bacteria */
  neutGs.forEach((g, i) => { g.style.opacity = clamp(sm.Inf * 1.3 - i * 0.1).toFixed(2); place(g, neutPos[i][0] + Math.sin(tm / 500 + i * 2) * 3, neutPos[i][1], Math.sin(tm / 400 + i) * 10, 1); });
  layers.bugs.querySelectorAll(".bug2").forEach((g, i) => { g.style.opacity = clamp(sm.Chol * 1.5 - i * 0.07).toFixed(2); });
  /* bile flow to the duodenum */
  const spd = 0.018 + 0.055 * sm.Flow;
  bileP.forEach((p) => { p.u += spd * dt * 3.2; if (p.u > 1) p.u -= 1; const q = bileTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", (0.3 + 0.65 * clamp(sm.Flow + 0.2) * (1 - sm.chole * 0.15)).toFixed(2)); });
  /* cholesterol crystals swirling in gallbladder bile */
  acc.crys += dt * sm.Sat * (1 - sm.chole) * 9; while (acc.crys >= 1) { acc.crys--; const p = freeP(crysP); if (p) emit(p, rnd(262, 378), rnd(215, 330), rnd(-8, 8), rnd(-6, 6)); }
  crysP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 500 + p.y) * 0.25; p.y += p.vy * dt; if (p.x < 256) p.vx = Math.abs(p.vx); if (p.x > 384) p.vx = -Math.abs(p.vx); if (p.y < 208) p.vy = Math.abs(p.vy); if (p.y > 338) p.vy = -Math.abs(p.vy); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1.15 - p.t / 2.8).toFixed(2)); if (p.t > 2.8) kill(p); });
  /* bilirubin backing up into the liver when the duct is blocked */
  biliP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < 88) p.vx = Math.abs(p.vx); if (p.x > 522) p.vx = -Math.abs(p.vx); if (p.y < 72) p.vy = Math.abs(p.vy); if (p.y > 162) p.vy = -Math.abs(p.vy); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(sm.Jaund * 1.2).toFixed(2)); });
  /* analgesia capsules drifting to the gallbladder */
  acc.caps += dt * sm.analg * 2.2; while (acc.caps >= 1) { acc.caps--; const p = freeP(capsP); if (p) emit(p, 52, rnd(280, 320), 0, 0); }
  capsP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (292 - p.x) * dt * 0.55 + 13 * dt; p.y += (292 - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.6) / 1.4).toFixed(2)); if (p.t > 5) kill(p); });
  /* ERCP: scope up the duct, stone fragments washed to the duodenum */
  const sp = $("scopePath"), stp = $("scopeTip");
  if (sp) sp.setAttribute("opacity", sm.ercp.toFixed(2));
  if (stp) stp.setAttribute("opacity", sm.ercp.toFixed(2));
  const c1 = $("clip1"), c2 = $("clip2");
  if (c1) c1.setAttribute("opacity", sm.chole.toFixed(2));
  if (c2) c2.setAttribute("opacity", sm.chole.toFixed(2));
  acc.frag += dt * sm.ercp * (level === 3 ? 5 : 0); while (acc.frag >= 1) { acc.frag--; const p = freeP(fragP); if (p) emit(p, 550, 278, rnd(22, 36), rnd(10, 18)); }
  fragP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 4) + ")"); if (p.x > 730 || p.t > 6) kill(p); });
  /* gauges */
  const burden = Math.max(sm.StoneGB, sm.StoneDuct), block = Math.max(sm.Cyst, sm.Cbd);
  gg.sat.set(sm.Sat, wordOf(sm.Sat, 0.35, 0.65, ["in solution", "near limit", "supersaturated"])); gg.stone.set(burden, wordOf(burden, 0.3, 0.7, ["none", "small", "large"])); gg.block.set(block, wordOf(block, 0.25, 0.6, ["open", "partial", "blocked"]));
  gg.inf.set(sm.InfAll, wordOf(sm.InfAll, 0.3, 0.6, ["calm", "sore", "inflamed"])); gg.jaund.set(sm.Jaund, wordOf(sm.Jaund, 0.3, 0.6, ["none", "mild", "marked"])); gg.pain.set(sm.Pain, wordOf(sm.Pain, 0.25, 0.6, ["none", "moderate", "severe"]));
}
run({ init, step });
