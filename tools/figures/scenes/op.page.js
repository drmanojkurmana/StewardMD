/* Organophosphate scene: blocked AChE, acetylcholine flood, gland and muscle switches, body organs, antidotes. */
const layers = { syn: $("syn"), parts: $("parts"), fx: $("fx"), over: $("over"), panel: $("panel") };
let eyeO = null, lungO = null, gutO = null, musO = null;
let trSpread = null;
const V = { capEl: null, capDrug: -1, wash: $("achWash"), glow: $("dangerGlow"), vessel: $("spreadV"),
  pupil: null, tears: [], airLn: [], wheeze: [], secr: [], gutDots: [], gutTint: null,
  musTint: null, fasc: [], fire: [], caps: [], spreadAcc: 0, oxiAcc: 0 };
function capText(d) {
  if (d === 1) return "Atropine sits on the gland switches. Wheeze eases but weakness stays.";
  if (d === 2) return "Oxime frees the enzyme. The signal drains and strength returns.";
  if (d === 3) return "Both drugs. Glands calm and strength returns.";
  return "No antidote. The signal floods the body.";
}
/* ---- body organs, drawn with real anatomy art ---- */
function initOrgans() {
  eyeO = organ($("eyeSlot"), "eye", 672, 140, 130, {});
  lungO = organ($("lungSlot"), "lung", 852, 150, 110, {});
  gutO = organ($("gutSlot"), "bowel", 672, 305, 140, {});
  musO = organ($("musSlot"), "muscle", 852, 315, 150, {});
  const EP = eyeO.ports, LP = lungO.ports, GP = gutO.ports, MP = musO.ports;
  trSpread = track([[530, 372], [556, 350], [572, 300], [600, 252]]);
  const F = layers.fx;
  V.pupil = mk("circle", { class: "op-pupil", cx: f1(EP.lens[0]), cy: f1(EP.lens[1]), r: 4 }, F);
  const eb = eyeO.y + eyeO.h / 2;
  for (let i = 0; i < 2; i++) V.tears.push(mk("circle", { class: "op-tear", cx: f1(EP.lens[0] - 16 + i * 30), cy: f1(eb + 5), r: 3, opacity: "0" }, F));
  const hy = (LP.hilumL[1] + LP.hilumR[1]) / 2;
  for (let i = 0; i < 2; i++) V.airLn.push(mk("line", { class: "op-air", x1: f1(LP.hilumL[0] - 14), y1: f1(hy), x2: f1(LP.hilumR[0] + 14), y2: f1(hy) }, F));
  for (let i = 0; i < 3; i++) V.wheeze.push(mk("path", { class: "op-wheeze", d: "M" + f1(LP.carina[0] - 26) + " " + f1(LP.carina[1] - 14 + i * 12) + "l7 -5 7 5 7 -5 7 5", fill: "none", opacity: "0" }, F));
  for (let i = 0; i < 4; i++) V.secr.push(mk("circle", { class: "op-secr", cx: f1(LP.carina[0] + rnd(-14, 14)), cy: f1(LP.carina[1] + rnd(-8, 10)), r: 2.6, opacity: "0" }, F));
  V.gutTint = mk("ellipse", { class: "op-guttint", cx: f1(gutO.x), cy: f1(gutO.y), rx: 62, ry: 54, opacity: "0" }, F);
  for (let i = 0; i < 6; i++) { const c = mk("circle", { class: "sc-p p-ach", r: 3, opacity: "0" }, F); V.gutDots.push({ e: c, a: (i / 6) * 6.28 }); }
  V.musTint = mk("ellipse", { class: "op-mustint", cx: f1(musO.x), cy: f1(musO.y), rx: 68, ry: 32, opacity: "0" }, F);
  for (let i = 0; i < 4; i++) V.fasc.push(mk("path", { class: "op-fasc", d: "M" + f1(MP.belly[0] - 24 + i * 16) + " " + f1(MP.belly[1] - 8) + "l4 -7 4 7", fill: "none", opacity: "0" }, F));
}
/* ---- presynaptic terminal and vesicles ---- */
const term = cell(layers.syn, { cls: "pre", r: 54, nuc: 0.3, seed: 3, wob: 0.08 });
place(term, 200, 148, 0, 1);
term.classList.add("hot"); term.setAttribute("tabindex", "0");
term.setAttribute("data-info", "The nerve ending. It releases acetylcholine from small sacs into the cleft with each signal.");
const ves = [];
for (let i = 0; i < 8; i++) { const c = mk("circle", { class: "op-ves", r: 6 }, layers.syn); ves.push({ c, ph: i * 0.9 }); }
/* ---- AChE enzymes in the cleft, with a blocked cross ---- */
const enz = [[105, 262], [180, 282], [255, 258], [330, 282], [405, 258], [480, 280]].map(([x, y]) => {
  const g = mk("g", {}, layers.syn);
  mk("path", { class: "op-enz", d: "M0 -8L2.4 -2.4L8 -2L3.4 2L5.4 8L0 4.6L-5.4 8L-3.4 2L-8 -2L-2.4 -2.4Z" }, g);
  const xg = mk("g", { class: "op-enzx" }, g); mk("path", { d: "M-6 -6L6 6M6 -6L-6 6", fill: "none" }, xg);
  place(g, x, y, 0, 1); return { g, xg, x, y, pop: 0 };
});
/* ---- receptors on the receiving cell (gland switches left, muscle switches right) ---- */
const recM = [110, 150, 190, 230].map((x) => { const g = mk("g", {}, layers.syn);
  mk("path", { class: "op-recM", d: "M" + x + " 330L" + x + " 318M" + x + " 318L" + (x - 6) + " 308M" + x + " 318L" + (x + 6) + " 308" }, g);
  const fire = mk("circle", { class: "op-fire", cx: x, cy: 322, r: 4, opacity: "0" }, g);
  const cap = mk("circle", { class: "op-cap", cx: x, cy: 282, r: 6.5, opacity: "0" }, g);
  V.caps.push(cap); return { g, fire, x }; });
const recN = [360, 400, 440, 480].map((x) => { const g = mk("g", {}, layers.syn);
  mk("rect", { class: "op-recN", x: x - 7, y: 306, width: 14, height: 24, rx: 3 }, g); return { g }; });
mk("circle", { class: "op-opdrop", cx: 465, cy: 105, r: 9 }, layers.syn);
mk("path", { class: "op-opdrop", d: "M465 88C472 100 476 106 476 112A11 11 0 0 1 454 112C454 106 458 100 465 88Z" }, layers.syn);
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const ach = pool(36, () => mk("circle", { class: "sc-p p-ach", r: 3 }, layers.parts));
const opx = pool(12, () => mk("path", { class: "sc-p p-opx", d: "M0 -4L4 0L0 4L-4 0Z" }, layers.parts));
const oxi = pool(10, () => mk("circle", { class: "sc-p p-oxi", r: 3.4 }, layers.parts));
const spreadP = pool(12, () => mk("circle", { class: "sc-p p-ach", r: 3 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const acc = { op: 0 };
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The synapse and the body";
  [["enz", "AChE blocked", "g-enz", "How much of the clearing enzyme is switched off by the poison. An oxime can free it again."],
   ["ach", "Signal flood", "g-ach", "Acetylcholine piling up in the cleft. It rises when the enzyme that clears it is blocked."],
   ["mus", "Gland signs", "g-mus", "Gland overdrive: drooling, tears, cramps, small pupils, wheeze. Atropine blocks this."],
   ["nic", "Muscle signal", "g-nic", "Overdrive at muscle switches: twitching first, then weakness. Atropine does not help here."],
   ["weak", "Weakness", "g-weak", "Muscle weakness and paralysis as muscle switches are overwhelmed."],
   ["bre", "Breathing", "g-bad", "Breathing strain from secretions and narrowed airways plus weak breathing muscles."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Poison", 465, 105, 468, 78, "The organophosphate poison. It switches off the enzyme that clears the signal.");
  pill(ox, "Enzyme", 350, 272, 350, 205, "The enzyme that clears acetylcholine. Blocked by the poison and marked with a cross. An oxime can free it.");
  pill(ox, "Gland switch", 150, 314, 140, 398, "Gland switches drive drooling, tears, cramps, small pupils and wheeze. Atropine sits on them and blocks the signal.");
  pill(ox, "Muscle switch", 420, 314, 410, 398, "Muscle switches drive skeletal muscle. Too much signal makes muscle twitch then fail. Atropine cannot block these.");
  pill(ox, "Eye", 612, 130, 640, 222, "The pupil shrinks and tears flow while gland switches are stuck on. Atropine lets the pupil open again.");
  pill(ox, "Lung", 860, 170, 862, 240, "Airways narrow and fill with fluid so breathing wheezes. Clearing the signal opens them again.");
  pill(ox, "Gut", 620, 300, 640, 392, "The gut cramps and hurries while gland switches are stuck on. It calms as the signal drains away.");
  pill(ox, "Muscle", 800, 315, 852, 392, "Muscle twitches then weakens as its switches are overwhelmed. Oxime restores strength by freeing the enzyme.");
  V.capEl = mk("text", { class: "op-note", x: 30, y: 428 }, ox); V.capEl.textContent = capText(0);
}
const sm = { E: 0.5, Ach: 0.5, Mus: 0.4, Nic: 0.5, Weak: 0.2, Fasc: 0.2, Breath: 0.3, atr: 0, ox: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.E = lerp(sm.E, m.E, k2); sm.Ach = lerp(sm.Ach, m.Ach, k2); sm.Mus = lerp(sm.Mus, m.Mus, k2); sm.Nic = lerp(sm.Nic, m.Nic, k2);
  sm.Weak = lerp(sm.Weak, m.Weak, k2); sm.Fasc = lerp(sm.Fasc, m.Fasc, k2); sm.Breath = lerp(sm.Breath, m.Breath, k1); sm.atr = lerp(sm.atr, m.atr, k1); sm.ox = lerp(sm.ox, m.ox, k1);
  place(term, 200 + Math.sin(tm / 1600) * 2, 148 + Math.cos(tm / 1900) * 2, 0, 1);
  ves.forEach((v, i) => { const u = (tm / 2400 + v.ph) % 1; const x = 178 + (i % 4) * 15 + Math.sin(tm / 500 + i) * 2, y = 120 + u * 62; v.c.setAttribute("cx", f1(x)); v.c.setAttribute("cy", f1(y)); v.c.setAttribute("opacity", (0.35 + 0.65 * (1 - u)).toFixed(2)); });
  /* enzymes: crosses mark the blocked share; oxime hits pop them free */
  enz.forEach((e, i) => { e.pop = Math.max(0, e.pop - dt * 2.2);
    e.xg.setAttribute("opacity", (sm.E * (1 - e.pop)).toFixed(2));
    place(e.g, e.x, e.y, Math.sin(tm / 900 + i) * 8, 1 + 0.45 * e.pop + 0.12 * (1 - sm.E) * Math.sin(tm / 280 + i)); });
  /* gland switches fire with the signal; atropine caps slide down and sit on them */
  recM.forEach((r, i) => { r.g.style.opacity = (0.45 + 0.55 * sm.Mus).toFixed(2);
    r.fire.setAttribute("opacity", (sm.Mus * (1 - sm.atr * 0.85)).toFixed(2));
    const c = V.caps[i]; c.setAttribute("cy", f1(308 - 26 * (1 - sm.atr))); c.setAttribute("opacity", sm.atr.toFixed(2)); });
  recN.forEach((r, i) => { const j = sm.Fasc * Math.sin(tm / 90 + i * 1.7) * 2.2; r.g.setAttribute("transform", "translate(" + f1(j) + " 0)"); r.g.style.opacity = (0.45 + 0.55 * sm.Nic).toFixed(2); });
  /* the flood: cleft wash, vessel to the body, drifting signal dots */
  V.wash.setAttribute("opacity", (sm.Ach * 0.45).toFixed(2));
  V.vessel.setAttribute("opacity", (0.15 + 0.55 * sm.Ach).toFixed(2));
  V.glow.setAttribute("opacity", (Math.max(sm.Weak, sm.Breath) * 0.5).toFixed(2));
  const want = Math.round(sm.Ach * ach.length);
  ach.forEach((p, i) => { const on = i < want;
    if (on && !p.on) emit(p, rnd(70, 500), rnd(238, 298), rnd(-14, 14), rnd(-8, 8), 0);
    if (!on && p.on) kill(p);
    if (!p.on) return;
    p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < 62 || p.x > 518) p.vx *= -1; if (p.y < 236 || p.y > 300) p.vy *= -1; p.x = clamp(p.x, 62, 518); p.y = clamp(p.y, 236, 300);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* signal travelling to the body along the vessel */
  V.spreadAcc += dt * (0.5 + 7 * sm.Ach);
  while (V.spreadAcc >= 1) { V.spreadAcc--; const p = free(spreadP); if (p) emit(p, 0, 0, 0, 0, 0); }
  spreadP.forEach((p) => { if (!p.on) return; p.u += dt * 130 / trSpread.len; const q = trSpread.at(Math.min(1, p.u));
    p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u >= 1) kill(p); });
  /* poison diamonds drift to enzymes; oxime sparks chase them off */
  acc.op += dt * (0.4 + sm.E * 3) * (sm.ox ? 0.3 : 1);
  while (acc.op >= 1) { acc.op--; const p = free(opx); if (p) emit(p, 465 + rnd(-6, 6), 118, 0, 0, Math.floor(Math.random() * enz.length)); }
  opx.forEach((p) => { if (!p.on) return; const e = enz[p.k], dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 42 * dt; p.y += (dy / d) * 42 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (d < 12 || sm.ox > 0.7) kill(p); });
  V.oxiAcc += dt * (sm.ox > 0.3 ? 6 : 0);
  while (V.oxiAcc >= 1) { V.oxiAcc--; const p = free(oxi); if (p) { const k = Math.floor(Math.random() * enz.length); emit(p, enz[k].x + rnd(-40, 40), 150, 0, 0, k); } }
  oxi.forEach((p) => { if (!p.on) return; const e = enz[p.k], dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 60 * dt; p.y += (dy / d) * 60 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (d < 10) { e.pop = 1; kill(p); } });
  /* ---- the body answers ---- */
  V.pupil.setAttribute("r", f1(3 + 5 * (1 - sm.Mus)));
  V.tears.forEach((t) => t.setAttribute("opacity", sm.Mus.toFixed(2)));
  const gap = 3 + 9 * (1 - sm.Mus), LP = lungO.ports, hy = (LP.hilumL[1] + LP.hilumR[1]) / 2;
  V.airLn[0].setAttribute("y1", f1(hy - gap / 2)); V.airLn[0].setAttribute("y2", f1(hy - gap / 2));
  V.airLn[1].setAttribute("y1", f1(hy + gap / 2)); V.airLn[1].setAttribute("y2", f1(hy + gap / 2));
  V.wheeze.forEach((w) => w.setAttribute("opacity", (sm.Mus * 0.9).toFixed(2)));
  V.secr.forEach((s, i) => { s.setAttribute("opacity", (sm.Mus * 0.85).toFixed(2));
    s.setAttribute("cx", f1(LP.carina[0] + Math.sin(tm / 700 + i * 2.1) * 10)); s.setAttribute("cy", f1(LP.carina[1] + Math.cos(tm / 900 + i * 1.7) * 8)); });
  place(lungO.g, lungO.x, lungO.y, 0, 1 + 0.025 * Math.sin(tm / (420 + 500 * (1 - sm.Breath))) * (0.3 + 0.7 * (1 - sm.Breath)));
  const GP = gutO.ports;
  place(gutO.g, gutO.x + sm.Mus * 2.2 * Math.sin(tm / 130), gutO.y + sm.Mus * 2.2 * Math.cos(tm / 160), 0, 1);
  V.gutTint.setAttribute("opacity", (sm.Mus * 0.32).toFixed(2));
  V.gutDots.forEach((gd, i) => { gd.a += dt * (0.6 + 3.2 * sm.Mus);
    gd.e.setAttribute("transform", "translate(" + f1(GP.coils[0] + Math.cos(gd.a) * 24) + " " + f1(GP.coils[1] + Math.sin(gd.a) * 16) + ")");
    gd.e.setAttribute("opacity", (0.2 + 0.8 * sm.Mus).toFixed(2)); });
  place(musO.g, musO.x + sm.Fasc * 2.6 * Math.sin(tm / 80), musO.y + sm.Fasc * 2 * Math.cos(tm / 97), 0, 1);
  V.musTint.setAttribute("opacity", (sm.Weak * 0.42).toFixed(2));
  V.fasc.forEach((fl, i) => fl.setAttribute("opacity", (sm.Fasc * (0.4 + 0.6 * Math.abs(Math.sin(tm / 110 + i * 1.9)))).toFixed(2)));
  gg.enz.set(sm.E, wordOf(sm.E, 0.3, 0.65, ["little", "partly", "mostly"]));
  gg.ach.set(sm.Ach, wordOf(sm.Ach, 0.35, 0.65, ["normal", "raised", "very high"]));
  gg.mus.set(sm.Mus, wordOf(sm.Mus, 0.3, 0.6, ["mild", "moderate", "marked"]));
  gg.nic.set(sm.Nic, wordOf(sm.Nic, 0.35, 0.65, ["normal", "raised", "very high"]));
  gg.weak.set(sm.Weak, wordOf(sm.Weak, 0.25, 0.55, ["none", "some", "paralysed"]));
  gg.bre.set(sm.Breath, wordOf(sm.Breath, 0.3, 0.6, ["steady", "strained", "failing"]));
  if (drug !== V.capDrug) { V.capDrug = drug; const t = capText(drug); if (V.capEl.textContent !== t) V.capEl.textContent = t; }
}
run({ init, step });
