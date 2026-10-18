/* Glycolysis and TCA scene: sugar splits in the cytosol, then burns in the powerhouse or spills to lactate. */
const WW = SC.W;
const layers = { parts: $("parts"), nodes: $("nodes"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: Math.random(), ang: Math.random() * 6.28 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const at = (p) => p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
const glyTrack = track([[60, 175], [160, 175], [270, 175], [385, 175], [500, 175]]);
const pdhTrack = track([[516, 175], [640, 175], [730, 215], [762, 236]]);
const lacTrack = track([[500, 192], [500, 340], [430, 375], [80, 375]]);
const TCX = 815, TCY = 275, TRX = 92, TRY = 72;
const sm = { G: 0.85, PDH: 0.15, TCA: 0.06, Lac: 0.85, E: 0.3, effO2: 0.2, thiam: 0 };
const acc = { atp: 0, nadh: 0, co2: 0, thi: 0 };
/* ---- nodes ---- */
function node(x, y, r, cls) { const g = mk("g", {}, layers.nodes); mk("circle", { class: cls, cx: 0, cy: 0, r }, g); g.setAttribute("transform", "translate(" + x + " " + y + ")"); return g; }
const gluNode = node(60, 175, 13, "gly-sub");
const hexNode = node(160, 175, 16, "gly-enz");
const pfkNode = node(270, 175, 19, "gly-main");
const pfkRing = mk("circle", { class: "gly-ring", cx: 270, cy: 175, r: 26 }, layers.nodes);
const pkNode = node(385, 175, 16, "gly-enz");
const pyrNode = node(500, 175, 13, "gly-pyr");
const lacNode = node(500, 340, 14, "gly-lac");
const pdhNode = node(640, 175, 17, "gly-enz");
const acNode = node(730, 215, 12, "gly-ac");
[[215, 175], [325, 175]].forEach(([x, y]) => mk("circle", { class: "gly-dot", cx: x, cy: y, r: 5 }, layers.nodes));
for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283; mk("circle", { class: "gly-dot", cx: f1(TCX + Math.cos(a) * TRX), cy: f1(TCY + Math.sin(a) * TRY), r: 5 }, layers.nodes); }
/* ---- PDH gate: two bars across the entry track that slide open as throughput rises ---- */
const gateGlow = mk("circle", { class: "gly-gateglow", cx: 600, cy: 175, r: 20, opacity: "0.12" }, layers.nodes);
const gateTop = mk("rect", { class: "gly-gate", x: 594, y: 152, width: 12, height: 19 }, layers.nodes);
const gateBot = mk("rect", { class: "gly-gate", x: 594, y: 179, width: 12, height: 21 }, layers.nodes);
const dockThi = [[584, 160], [584, 190], [616, 160], [616, 190]].map(([x, y]) => { const e = mk("circle", { class: "sc-p p-thi", cx: x, cy: y, r: 3.4, opacity: "0" }, layers.nodes); return e; });
/* ---- pools ---- */
const glyP = pool(24, () => mk("path", { class: "sc-p p-glu", d: "M0 -4L3.5 -2L3.5 2L0 4L-3.5 2L-3.5 -2Z" }, layers.parts));
const pdhP = pool(14, () => mk("circle", { class: "sc-p p-pyr", r: 3.2 }, layers.parts));
const lacP = pool(14, () => mk("circle", { class: "sc-p p-lac", r: 3.2 }, layers.parts));
const tcaP = pool(10, () => mk("circle", { class: "sc-p p-glu", r: 3.4 }, layers.parts));
const atpP = pool(16, () => mk("circle", { class: "sc-p p-atp", r: 3 }, layers.parts));
const nadhP = pool(12, () => mk("circle", { class: "sc-p p-nadh", r: 2.8 }, layers.parts));
const co2P = pool(10, () => mk("circle", { class: "p-co2", r: 3.6 }, layers.parts));
const o2P = pool(12, () => { const e = mk("circle", { class: "sc-p p-o2", r: 3 }, layers.parts); return e; });
o2P.forEach((p) => { p.x = rnd(640, 920); p.y = rnd(70, 250); });
const thiP = pool(8, () => mk("path", { class: "sc-p p-thi", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, layers.parts));
const gg = {};
let thiPill = null, capEl = null, capKey = "";
function capText() {
  if (drug === 2) return "Oxygen restored. The powerhouse burns fuel fully and lactate drains away.";
  if (drug === 1) return level === 0 ? "Thiamine docks at the gate, but with no oxygen the powerhouse stays stalled." : "Thiamine opens the PDH gate. More fuel enters the powerhouse and less turns to lactate.";
  return level === 0 ? "No treatment. With no oxygen the powerhouse stalls and extra fuel turns to lactate." : level === 1 ? "No treatment. Low oxygen slows the powerhouse, so much fuel turns to lactate." : "No treatment. Even a small shortage leaves fuel turning to lactate.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 280, 450, 620, 790];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The cell";
  [["gly", "Glycolysis", "g-gly", "Speed of glucose breakdown in the cytosol, from glucose through the splitting steps to pyruvate. It gives a small net gain of energy."], ["pdh", "PDH entry", "g-pdh", "Pyruvate passing the gate into the mitochondrion to become fuel for the powerhouse. Thiamine helps open this gate."], ["tca", "TCA cycle", "g-tca", "The powerhouse cycle in the mitochondrion: it burns fuel fully, releases CO2 and loads carriers for energy making."], ["lac", "Lactate", "g-lac", "Lactate made from pyruvate when oxygen is short. This keeps splitting going, but gives far less energy and lactate builds up."], ["atp", "Energy", "g-atp", "Useful energy for cell work: a little from splitting, and much more when the powerhouse burns fuel with oxygen."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Sugar in", 60, 175, 60, 108, "Sugar entering the cell. It is the fuel for the whole chain.");
  pill(ox, "Split steps", 270, 175, 270, 108, "The splitting chain. It cuts sugar down to pyruvate and makes a little energy. It slows when energy is plentiful and speeds when energy is low.");
  pill(ox, "Pyruvate", 500, 175, 500, 108, "Pyruvate, the fork in the road. With oxygen it enters the powerhouse. Without oxygen it turns to lactate.");
  pill(ox, "PDH gate", 600, 175, 648, 108, "The gate into the powerhouse. Thiamine helps open it so fuel can enter and burn fully.");
  pill(ox, "Oxygen", 816, 150, 856, 108, "Oxygen lets the powerhouse burn fuel fully. Without it the cycle stalls and fuel spills to lactate.");
  pill(ox, "Powerhouse", 907, 275, 870, 155, "The TCA cycle in the mitochondrion. It burns fuel fully and loads carriers that make lots of energy.");
  pill(ox, "Lactate", 500, 340, 500, 405, "Lactate, the overflow. Made when oxygen is short. It builds up and gives little energy.");
  thiPill = pill(ox, "Thiamine", 612, 190, 640, 265, "Thiamine, a helper the gate needs. It docks here and opens the way in."); thiPill.style.opacity = "0";
  capEl = mk("text", { class: "gly-cap", x: 30, y: 432 }, ox); capEl.textContent = capText();
}
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.G = lerp(sm.G, m.G, k2); sm.PDH = lerp(sm.PDH, m.PDH, k2); sm.TCA = lerp(sm.TCA, m.TCA, k2); sm.Lac = lerp(sm.Lac, m.Lac, k2); sm.E = lerp(sm.E, m.E, k2); sm.effO2 = lerp(sm.effO2, m.effO2, k1); sm.thiam = lerp(sm.thiam, m.thiam, k1);
  /* enzyme pulse */
  place(hexNode, 160, 175, 0, 1 + 0.07 * sm.G * Math.sin(tm / 300));
  place(pfkNode, 270, 175, 0, 1 + 0.1 * sm.G * Math.sin(tm / 260));
  place(pkNode, 385, 175, 0, 1 + 0.07 * sm.G * Math.sin(tm / 320 + 1));
  place(pdhNode, 640, 175, 0, 1 + 0.09 * (sm.PDH / Math.max(0.2, sm.G)) * Math.sin(tm / 300 + 2));
  pfkRing.setAttribute("opacity", (0.35 + 0.6 * sm.G).toFixed(2));
  /* PDH gate opens with throughput; thiamine docks on it */
  const pdhRatio = clamp(sm.PDH / Math.max(0.15, sm.G));
  const gap = 4 + 14 * pdhRatio;
  gateTop.setAttribute("height", f1(23 - gap));
  gateBot.setAttribute("y", f1(175 + gap));
  gateBot.setAttribute("height", f1(25 - gap));
  gateGlow.setAttribute("opacity", (0.12 + 0.55 * sm.thiam).toFixed(2));
  dockThi.forEach((e) => e.setAttribute("opacity", sm.thiam.toFixed(2)));
  thiPill.style.opacity = sm.thiam.toFixed(2);
  /* lactate flood, powerhouse glow, oxygen stream, cycle brightness */
  $("wash").setAttribute("opacity", clamp(0.08 + (sm.Lac - 0.15) * 1.3, 0.05, 0.85).toFixed(2));
  $("glow").setAttribute("opacity", (0.05 + 0.5 * sm.TCA).toFixed(2));
  $("o2flow").setAttribute("stroke-width", f1(3 + 11 * sm.effO2));
  $("o2flow").setAttribute("opacity", (0.15 + 0.85 * sm.effO2).toFixed(2));
  $("lacFlow").setAttribute("stroke-width", f1(2 + 9 * sm.Lac));
  $("lacFlow").setAttribute("opacity", (0.25 + 0.75 * sm.Lac).toFixed(2));
  $("tcaLoop").setAttribute("opacity", (0.45 + 0.55 * sm.TCA).toFixed(2));
  /* glycolysis flow */
  const glyWant = Math.round(sm.G * glyP.length);
  glyP.forEach((p, i) => { p.u += dt * 0.13 * (0.35 + sm.G); if (p.u > 1) p.u -= 1; const q = glyTrack.at(p.u); p.x = q.x; p.y = q.y; at(p); p.e.setAttribute("opacity", i < glyWant ? "1" : "0"); });
  /* pyruvate split: into the powerhouse */
  const pdhWant = Math.round(pdhRatio * pdhP.length);
  pdhP.forEach((p, i) => { p.u += dt * 0.16 * (0.3 + pdhRatio); if (p.u > 1) p.u -= 1; const q = pdhTrack.at(p.u); p.x = q.x; p.y = q.y; at(p); p.e.setAttribute("opacity", i < pdhWant ? "1" : "0"); });
  /* pyruvate split: to lactate */
  const lacWant = Math.round(clamp(sm.Lac) * lacP.length);
  lacP.forEach((p, i) => { p.u += dt * 0.11 * (0.3 + sm.Lac); if (p.u > 1) p.u -= 1; const q = lacTrack.at(p.u); p.x = q.x; p.y = q.y; at(p); p.e.setAttribute("opacity", i < lacWant ? "1" : "0"); });
  /* TCA circulation */
  const tcaWant = Math.round(sm.TCA * tcaP.length);
  tcaP.forEach((p, i) => { p.ang += dt * 0.55 * (0.2 + sm.TCA); p.x = TCX + Math.cos(p.ang) * TRX; p.y = TCY + Math.sin(p.ang) * TRY; at(p); p.e.setAttribute("opacity", i < tcaWant ? "1" : "0"); });
  /* oxygen drifting into the mitochondrion */
  const o2Want = Math.round(sm.effO2 * o2P.length);
  o2P.forEach((p, i) => { p.y += dt * 26 * (0.3 + sm.effO2); p.x += Math.sin(tm / 500 + i) * 6 * dt; if (p.y > 250) { p.y = 68; p.x = rnd(650, 920); } at(p); p.e.setAttribute("opacity", i < o2Want ? "1" : "0"); });
  /* thiamine to the PDH gate */
  acc.thi += dt * sm.thiam * 4; while (acc.thi >= 1) { acc.thi--; const p = free(thiP); if (p) emit(p, 596, 175 + rnd(-8, 8), 42, 0, 0); }
  thiP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; at(p); if (p.x > 630) kill(p); });
  /* ATP sparks from splitting and the cycle */
  acc.atp += dt * sm.E * 5; while (acc.atp >= 1) { acc.atp--; const p = free(atpP); if (p) { if (Math.random() < 0.45) emit(p, 385 + rnd(-10, 10), 156, rnd(-6, 6), -30, 0); else { const a = rnd(0, 6.28); emit(p, TCX + Math.cos(a) * TRX, TCY + Math.sin(a) * TRY, rnd(-8, 8), 30, 0); } } }
  atpP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; at(p); if (p.t > 1.5 || p.y < 120 || p.y > 404) kill(p); });
  /* NADH carriers leaving the cycle toward energy making */
  acc.nadh += dt * sm.TCA * 4; while (acc.nadh >= 1) { acc.nadh--; const p = free(nadhP); if (p) { const a = rnd(0, 6.28); emit(p, TCX + Math.cos(a) * TRX * 0.8, TCY + Math.sin(a) * TRY * 0.8, 22, 26, 0); } }
  nadhP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; at(p); if (p.t > 1.8 || p.x > 922 || p.y > 404) kill(p); });
  /* CO2 bubbles rising out of the mitochondrion */
  acc.co2 += dt * sm.TCA * 3.2; while (acc.co2 >= 1) { acc.co2--; const p = free(co2P); if (p) { const a = rnd(0, 6.28); emit(p, TCX + Math.cos(a) * TRX * 0.7, TCY + Math.sin(a) * TRY * 0.7, rnd(-5, 5), -34, 0); } }
  co2P.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; at(p); if (p.y < 84) kill(p); });
  /* gauges */
  gg.gly.set(sm.G, wordOf(sm.G, 0.72, 0.9, ["steady", "brisk", "very fast"])); gg.pdh.set(sm.PDH, wordOf(sm.PDH, 0.2, 0.45, ["low", "partly in", "mostly in"])); gg.tca.set(sm.TCA, wordOf(sm.TCA, 0.15, 0.38, ["quiet", "active", "strong"]));
  gg.lac.set(sm.Lac, wordOf(sm.Lac, 0.35, 0.65, ["low", "raised", "high"])); gg.atp.set(sm.E, wordOf(sm.E, 0.4, 0.6, ["low", "moderate", "high"]));
  const ck = level + ":" + drug; if (ck !== capKey) { capKey = ck; const t = capText(); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
