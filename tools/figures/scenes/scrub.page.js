/* Scrub typhus and rickettsial scene: bite, eschar, endothelial invasion, vasculitis, leak, rash and organ involvement. */
const CY = SC.CY, WW = SC.W;
const layers = { rbc: $("rbcs"), endo: $("endo"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen"), oed: $("oedema"), fever: $("fever"), rash: $("rash"), eschar: $("eschar"), orgL: $("org-lung"), orgB: $("org-brain"), orgO: $("org-other") };
let hh = 36;
const WALL_N = 26;
const endo = { top: [], bot: [] };
function initEndo() { ["top", "bot"].forEach((row) => { for (let i = 0; i < WALL_N; i++) { const g = mk("g", {}, layers.endo); cell(g, { cls: "endo", r: 14, nuc: 0.3, seed: i + (row === "top" ? 0 : 40), wob: 0.06, n: 8 }); endo[row].push({ g, x: 14 + (i + 0.5) * ((WW - 28) / WALL_N) }); } }); }
const rbcs = [];
function initRbc() { for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-0.8, 0.8), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const rick = pool(34, () => mk("circle", { class: "sc-p p-rick", r: 3 }, layers.parts));
const inflam = pool(30, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, layers.parts));
const drops = pool(30, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const dox = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const vol = pool(16, () => mk("path", { class: "p-fl p-bolus", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = clamp(x, 24, WW - 24); p.y = clamp(y, 56, 432); p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["org", "Organism", "g-bac", "Orientia or Rickettsia bacteria living inside vessel lining cells."], ["endo", "Vessel injury", "g-cyt", "Infected endothelium becomes inflamed: vasculitis of small vessels."], ["leak", "Leaky wall", "g-fl", "Vascular permeability rises, plasma leaks out and tissue edema forms."], ["fever", "Fever and rash", "g-bad", "Fever with a rash appearing as vessels in the skin are involved."], ["organ", "Organs", "g-bad", "Spread to lung, brain and other organs as vessel injury widens."], ["shock", "Shock risk", "g-good", "Circulation fails when leak and vasodilation are severe and untreated."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Mite bite", 88, 118, 110, 88, "A mite, tick or louse bite introduces Orientia or Rickettsia through the skin. The vector varies by disease and place.");
  pill(ox, "Eschar", 122, 146, 205, 88, "Eschar: a dark crusted sore at the bite site. It may be hidden and is not present in every patient.");
  pill(ox, "Rickettsiae", 360, 172, 365, 88, "Rickettsiae: small bacteria that live inside cells. They spread from the bite site to vessel lining cells throughout the body.");
  pill(ox, "Fever and rash", 830, 168, 830, 88, "Fever and rash: fever is usual from onset, and a rash appearing later reflects vessel involvement in the skin.");
  pill(ox, "Endothelium", 560, CY - hh - 6, 560, 235, "Endothelium: the single cell lining of small vessels. Rickettsiae invade and multiply inside these cells.");
  pill(ox, "Vasculitis", 720, CY - hh - 6, 720, 235, "Vasculitis: inflamed, injured vessel walls. The vascular injury drives most manifestations of the illness.");
  pill(ox, "Leaky wall", 880, CY - hh + 4, 870, 235, "Increased vascular permeability: plasma leaks from injured vessels, causing edema and falling circulating volume.");
  const dx = pill(ox, "Doxycycline", 180, CY - 8, 180, 235, "Doxycycline is the treatment to consider early. Benefit is greatest before severe disease develops."); dx.setAttribute("id", "dox-pill");
  const sp = pill(ox, "Support", 330, CY + 10, 330, 360, "Supportive care: fluids and organ support while the antibiotic works. It does not clear the organism alone."); sp.setAttribute("id", "sup-pill");
}
const sm = { B: 0.4, E: 0.3, P: 0.2, F: 0.4, O: 0.2, Sh: 0.2, dox: 0, sup: 0 };
const acc = { rick: 0, inf: 0, drop: 0, dox: 0, vol: 0 };
function init() { initEndo(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.B = lerp(sm.B, m.B, k2); sm.E = lerp(sm.E, m.E, k2); sm.P = lerp(sm.P, m.P, k2); sm.F = lerp(sm.F, m.F, k2); sm.O = lerp(sm.O, m.O, k2); sm.Sh = lerp(sm.Sh, m.Sh, k1); sm.dox = lerp(sm.dox, m.dox, k1); sm.sup = lerp(sm.sup, m.sup, k1);
  hh = 36 + 8 * sm.P + 2 * Math.sin(tm / 900);
  const wallT = CY - hh - 4, wallB = CY + hh + 4;
  layers.lumen.setAttribute("y", f1(CY - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  layers.oed.setAttribute("height", f1(Math.max(0, wallT - 44))); layers.oed.setAttribute("opacity", (sm.P * 0.5).toFixed(2));
  layers.fever.setAttribute("opacity", (sm.F * 0.16).toFixed(2));
  layers.rash.setAttribute("opacity", clamp(0.15 + sm.F * 0.85).toFixed(2));
  layers.eschar.setAttribute("opacity", clamp(0.35 + sm.B * 0.65).toFixed(2));
  layers.orgL.setAttribute("opacity", (sm.O * 0.75).toFixed(2)); layers.orgB.setAttribute("opacity", (sm.O * 0.75).toFixed(2)); layers.orgO.setAttribute("opacity", (sm.O * 0.6).toFixed(2));
  endo.top.forEach((e, i) => place(e.g, e.x, wallT + Math.sin(tm / 800 + i) * 0.8, 0, 1)); endo.bot.forEach((e, i) => place(e.g, e.x, wallB + Math.sin(tm / 800 + i + 2) * 0.8, 0, 1));
  [endo.top, endo.bot].forEach((row) => row.forEach((e) => { e.g.setAttribute("transform", e.g.getAttribute("transform") + " scale(" + (1 - 0.22 * sm.P).toFixed(3) + " 1)"); e.g.style.setProperty("--act", sm.E.toFixed(2)); }));
  rbcs.forEach((r) => { r.x += r.v * 62 * clamp(0.3 + 0.7 * (1 - sm.Sh)) * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.8, 0.8); } place(r.g, r.x, CY + r.y * (hh - 12), r.rot + Math.sin(tm / 500 + r.x) * 10, 1); });
  acc.rick += dt * sm.B * 10; while (acc.rick >= 1) { acc.rick--; const p = freeP(rick); if (p) emit(p, rnd(120, 300), rnd(130, 200), rnd(18, 34), rnd(10, 20), 0); }
  rick.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, WW - 24)) + " " + f1(clamp(p.y, 56, wallT - 6)) + ")"); if (p.y > wallT - 10 || p.t > 7) kill(p); });
  acc.inf += dt * sm.E * 9; while (acc.inf >= 1) { acc.inf--; const p = freeP(inflam); if (p) emit(p, rnd(80, WW - 80), wallT - 4, rnd(-8, 8), -rnd(12, 24), 0); }
  inflam.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, WW - 24)) + " " + f1(clamp(p.y, 56, 432)) + ")"); if (p.t > 3.2) kill(p); });
  acc.drop += dt * sm.P * 9; while (acc.drop >= 1) { acc.drop--; const p = freeP(drops); if (p) emit(p, rnd(60, WW - 60), CY - hh + 4, rnd(-4, 4), -rnd(14, 22), 0); }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, WW - 24)) + " " + f1(clamp(p.y, 56, 432)) + ")"); p.e.setAttribute("opacity", p.y < wallT ? clamp(1 - (wallT - p.y) / 60).toFixed(2) : "1"); if (p.y < wallT - 64) kill(p); });
  acc.dox += dt * sm.dox * 3; while (acc.dox >= 1) { acc.dox--; const p = freeP(dox); if (p) emit(p, rnd(60, 160), CY - 8, 10, -14, 0); }
  dox.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (230 - p.x) * dt * 0.5 + 14 * dt; p.y += (165 - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, WW - 24)) + " " + f1(clamp(p.y, 56, 432)) + ") rotate(" + f1(p.t * 90) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  acc.vol += dt * sm.sup * 6; while (acc.vol >= 1) { acc.vol--; const p = freeP(vol); if (p) emit(p, 20, CY + rnd(-hh + 12, hh - 12), 86, 0, 0); }
  vol.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, WW - 24)) + " " + f1(p.y) + ")"); if (p.x > WW - 20) kill(p); });
  $("dox-pill").style.opacity = sm.dox.toFixed(2); $("sup-pill").style.opacity = sm.sup.toFixed(2);
  gg.org.set(sm.B, wordOf(sm.B, 0.2, 0.55, ["low", "present", "high"])); gg.endo.set(sm.E, wordOf(sm.E, 0.3, 0.6, ["mild", "inflamed", "severe"])); gg.leak.set(sm.P, wordOf(sm.P, 0.3, 0.6, ["tight", "leaky", "very leaky"]));
  gg.fever.set(sm.F, wordOf(sm.F, 0.3, 0.6, ["settling", "present", "high"])); gg.organ.set(sm.O, wordOf(sm.O, 0.3, 0.6, ["none yet", "some", "widespread"])); gg.shock.set(1 - sm.Sh, wordOf(1 - sm.Sh, 0.4, 0.65, ["at risk", "borderline", "stable"]));
}
run({ init, step });
