/* Onc-ritux scene: rituximab coats CD20 on the B cell (left); complement, NK killing and
 * apoptosis destroy it while vessel, kidney, liver, brain, antibodies and marrow show the harms (right). */
const BCX = 242, BCY = 245, BR = 100;
const VX = 580, VY = 185, KX = 715, KY = 185, LX = 850, LY = 185;
const BX = 580, BY = 335, DX = 715, DY = 335, MX = 850, MY = 335;
const L = { bcell: $("bcell"), mab: $("mab"), comp: $("comp"), nk: $("nk"), deb: $("deb"), vesSlot: $("vesSlot"), vesFx: $("vesFx"), kidSlot: $("kidSlot"), kidFx: $("kidFx"), livSlot: $("livSlot"), livFx: $("livFx"), brnSlot: $("brnSlot"), brnFx: $("brnFx"), dish: $("dish"), neut: $("neut"), over: $("over"), panel: $("panel") };
const SLOTS = [-150, -105, -60, -15, 30, 75, 120, 165].map((d) => { const t = d * Math.PI / 180; return [BCX + 102 * Math.cos(t), BCY + 102 * Math.sin(t), d + 90]; });
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.st = 0; p.e.setAttribute("opacity", "0"); }
function mabY(parent, cls) { const g = mk("g", { class: cls }, parent); mk("path", { d: "M0 5L0 -1M0 -1L-4.5 -6.5M0 -1L4.5 -6.5" }, g); mk("circle", { cx: 0, cy: 0, r: 1.5 }, g); return g; }
let bcellG = null, nkG = null, nkX = 80, nkY = 378, flush = null, shield = null, kidTint = null, livTint = null, capEl = null, capKey = "";
let holes = [], blebs = [], cryst = [], virs = [], lesions = [], dmabs = [], bacs = [], neus = [], gg = {};
let mabP, compP, granP, debP, cytP, pmP, dropP;
function capText(d, l) {
  if (d === 0) return "No treatment. The B cell tumour grows and no drug harm builds.";
  if (d === 2 && l === 0) return "First courses with premedication. Slow infusion calms the reaction while B cell kill proceeds.";
  if (d === 2 && l === 1) return "Middle courses with premedication. Infusions stay calm but antibodies fall and other harms continue.";
  if (d === 2) return "Late courses with premedication. B cells are gone with calm infusions; late harms still need care.";
  if (l === 0) return "First courses. Rituximab coats B cells and kill begins; infusion reactions and tumour lysis peak now.";
  if (l === 1) return "Middle courses. B cells keep dying while antibodies fall and late harms stir.";
  return "Late courses. Most B cells are gone but liver, brain, antibody and neutrophil harms have built up.";
}
function init() {
  /* ---- B cell with CD20 stubs, holes and blebs ---- */
  bcellG = cell(L.bcell, { cls: "bcell", r: BR, nuc: 0.5, seed: 5, wob: 0.07, n: 10 });
  SLOTS.forEach((s) => { const g = mk("g", { transform: "translate(" + f1(s[0]) + " " + f1(s[1]) + ") rotate(" + f1(s[2]) + ")" }, L.bcell); mk("rect", { class: "rx-cd20", x: -3, y: -8, width: 6, height: 8, rx: 2 }, g); });
  [10, 70, 130, 190, 250, 310].forEach((d) => { const t = d * Math.PI / 180; holes.push(mk("circle", { class: "rx-hole", cx: f1(BCX + 92 * Math.cos(t)), cy: f1(BCY + 92 * Math.sin(t)), r: 4.5, opacity: "0" }, L.bcell)); });
  [40, 100, 160, 220, 280].forEach((d) => { const t = d * Math.PI / 180; blebs.push({ e: mk("circle", { class: "rx-bleb", cx: f1(BCX + 100 * Math.cos(t)), cy: f1(BCY + 100 * Math.sin(t)), r: 2, opacity: "0" }, L.bcell) }); });
  mabP = pool(10, () => mabY(L.mab, "rx-mab"));
  compP = pool(16, () => mk("circle", { class: "sc-p rx-comp", r: 2.2 }, L.comp));
  granP = pool(8, () => mk("circle", { class: "sc-p rx-gran", r: 2.4 }, L.nk));
  debP = pool(14, () => mk("circle", { class: "sc-p rx-deb", r: 2.5 }, L.deb));
  nkG = cell(L.nk, { cls: "neut", r: 20, nuc: 0.45, seed: 9, wob: 0.1, n: 8 });
  place(nkG, nkX, nkY, 0, 1);
  /* ---- vessel: infusion reaction ---- */
  organ(L.vesSlot, "vessel", VX, VY, 130, { h: 85 });
  flush = mk("ellipse", { class: "rx-flush", cx: VX, cy: VY, rx: 54, ry: 34, opacity: "0" }, L.vesFx);
  shield = mk("ellipse", { class: "rx-shield", cx: VX, cy: VY, rx: 66, ry: 46, opacity: "0" }, L.vesFx);
  cytP = pool(18, () => mk("circle", { class: "sc-p rx-cyt", r: 2.2 }, L.vesFx));
  pmP = pool(6, () => { const g = mk("g", {}, L.vesFx); mk("rect", { class: "rx-pm1", x: -4.5, y: -2, width: 9, height: 4, rx: 2 }, g); mk("rect", { class: "rx-pm2", x: 0, y: -2, width: 4.5, height: 4, rx: 2 }, g); return g; });
  /* ---- kidney: tumour lysis ---- */
  organ(L.kidSlot, "kidney", KX, KY, 72, { h: 92 });
  kidTint = mk("ellipse", { class: "rx-tint", cx: KX, cy: KY + 8, rx: 26, ry: 34, opacity: "0" }, L.kidFx);
  for (let i = 0; i < 10; i++) cryst.push(mk("path", { class: "sc-p rx-cryst", d: "M0 -3.6L3.4 2.6L-3.4 2.6Z", transform: "translate(" + f1(690 + (i % 5) * 12.5 + rnd(-2, 2)) + " " + f1(198 + Math.floor(i / 5) * 14 + rnd(-2, 2)) + ")", opacity: "0" }, L.kidFx));
  dropP = pool(6, () => mk("circle", { class: "sc-p rx-deb", r: 2.2 }, L.kidFx));
  /* ---- liver: hepatitis B ---- */
  organ(L.livSlot, "liver", LX, LY, 135, { h: 80 });
  livTint = mk("ellipse", { class: "rx-tint", cx: LX, cy: LY, rx: 55, ry: 28, opacity: "0" }, L.livFx);
  for (let i = 0; i < 12; i++) virs.push({ e: mk("circle", { class: "sc-p rx-vir", r: 2.6, opacity: "0" }, L.livFx), x: 798 + (i % 6) * 21 + rnd(-4, 4), y: 158 + Math.floor(i / 6) * 26 + rnd(-5, 5), ph: rnd(0, 6.28) });
  /* ---- brain: PML ---- */
  organ(L.brnSlot, "brain", BX, BY, 110, { h: 88 });
  [[-20, -14], [18, 10], [-5, 25]].forEach(([dx, dy]) => lesions.push(mk("ellipse", { class: "rx-les", cx: BX + dx, cy: BY + dy, rx: 6, ry: 5, opacity: "0" }, L.brnFx)));
  /* ---- dish: low antibodies and bacteria ---- */
  mk("ellipse", { class: "rx-dish", cx: DX, cy: DY, rx: 58, ry: 42 }, L.dish);
  [[-25, -15], [0, -23], [25, -15], [-25, 15], [0, 23], [25, 15]].forEach(([dx, dy]) => { const g = mabY(L.dish, "rx-dmab"); g.setAttribute("transform", "translate(" + (DX + dx) + " " + (DY + dy) + ")"); dmabs.push(g); });
  for (let i = 0; i < 8; i++) bacs.push({ e: mk("circle", { class: "rx-bac", r: 4, opacity: "0" }, L.dish), x: DX - 42 + (i % 4) * 28 + rnd(-4, 4), y: DY - 12 + Math.floor(i / 4) * 24 + rnd(-4, 4), ph: rnd(0, 6.28) });
  /* ---- marrow bone: late neutropenia ---- */
  mk("circle", { class: "rx-bone", cx: MX - 44, cy: MY, r: 22 }, L.neut);
  mk("circle", { class: "rx-bone", cx: MX + 44, cy: MY, r: 22 }, L.neut);
  mk("rect", { class: "rx-bone", x: MX - 40, y: MY - 17, width: 80, height: 34, rx: 10 }, L.neut);
  mk("rect", { class: "rx-cav", x: MX - 30, y: MY - 10, width: 60, height: 20, rx: 10 }, L.neut);
  for (let i = 0; i < 8; i++) neus.push({ e: mk("circle", { class: "rx-neu", r: 3.6 }, L.neut), x: MX - 22 + (i % 4) * 14.5, y: MY - 4 + Math.floor(i / 4) * 9 });
  /* ---- labels, caption, gauges ---- */
  const o = L.over;
  pill(o, "Rituximab", 66, 195, 82, 118, "Rituximab, an anti-CD20 antibody. It coats B cells so complement, NK cells and the cell itself destroy them.");
  pill(o, "CD20", 293, 157, 382, 112, "CD20, a marker on B cells. Rituximab locks onto it and flags the cell for killing.");
  pill(o, "Infusion reaction", 580, 150, 580, 108, "Cytokine release. The first dose kills many B cells at once, so cytokines flood the blood and cause fever, chills and low pressure.");
  pill(o, "Tumour lysis", 715, 148, 715, 108, "Tumour lysis syndrome. Dying B cells spill salts and uric acid that clog the kidney.");
  pill(o, "Hepatitis B", 850, 150, 850, 108, "Hepatitis B reactivation. Killing B cells weakens control of hidden virus, so it wakes in the liver.");
  pill(o, "PML", 580, 372, 580, 414, "Progressive multifocal leukoencephalopathy. Weakened immunity lets JC virus attack brain white matter.");
  pill(o, "Low antibodies", 715, 372, 715, 414, "Hypogammaglobulinaemia. Dead B cells cannot make antibodies, so bacteria grow unchecked and infections return.");
  pill(o, "Low neutrophils", 850, 372, 850, 414, "Late neutropenia. Neutrophils fall weeks after treatment, which invites bacterial infection.");
  capEl = mk("text", { class: "rx-cap", x: 30, y: 449 }, o); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "Benefit and harm";
  [["kill", "B cell kill", "g-good", "B cell kill. Rituximab coats CD20, then complement lysis, NK cell attack (ADCC) and apoptosis destroy the B cell."],
    ["inf", "Infusion", "g-bad", "Infusion reaction. Dying B cells release cytokines that cause fever, chills and low pressure, worst at the first dose. Premedication and a slow infusion calm it."],
    ["tls", "Tumour lysis", "g-neu", "Tumour lysis syndrome. Contents spilled from dying cells clog the kidney and disturb salts."],
    ["liv", "Liver", "g-bac", "Hepatitis B reactivation. Lost immune control lets hidden virus wake and inflame the liver."],
    ["brn", "Brain", "g-cyt", "PML. Weakened immunity lets JC virus destroy brain white matter."],
    ["irs", "Infections", "g-eos", "Infections from low antibodies. Without B cells the body cannot replace antibodies, so infections keep returning."],
    ["neu", "Neutrophils", "g-fl", "Late neutropenia. Neutrophils fall weeks after treatment and invite bacterial infection."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 100 + i * 123, 486, 60, 18, cls, name, tip); });
}
const sm = { K: 0.5, Inf: 0.4, TLS: 0.3, Liv: 0.15, Brn: 0.1, Irs: 0.3, Neu: 0.15, on: 0, prot: 0 };
const acc = { mab: 0, comp: 0, gran: 0, deb: 0, cyt: 0, pm: 0, drop: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.K = lerp(sm.K, m.K, k); sm.Inf = lerp(sm.Inf, m.Inf, k); sm.TLS = lerp(sm.TLS, m.TLS, k); sm.Liv = lerp(sm.Liv, m.Liv, k);
  sm.Brn = lerp(sm.Brn, m.Brn, k); sm.Irs = lerp(sm.Irs, m.Irs, k); sm.Neu = lerp(sm.Neu, m.Neu, k); sm.on = lerp(sm.on, m.on, k); sm.prot = lerp(sm.prot, m.prot, k);
  /* B cell shrinks as kill builds, grows without treatment */
  const cs = (1 - 0.13 * sm.K * sm.on + (1 - sm.on) * 0.05) * (1 + 0.012 * Math.sin(tm / 700));
  place(bcellG, BCX, BCY, 0, cs);
  /* antibodies fly in and lodge on CD20; they leave when treatment stops */
  const want = m.on ? 8 : 0;
  let n = 0, lodged = 0;
  mabP.forEach((p) => { if (p.on && (p.st === 1 || p.st === 2)) n++; if (p.on && p.st === 2) lodged++; });
  acc.mab += dt * m.on * 3;
  while (acc.mab >= 1) { acc.mab--; if (n < want) { const p = free(mabP); if (p) { const used = {}; mabP.forEach((q) => { if (q.on && (q.st === 1 || q.st === 2)) used[q.k] = 1; }); let si = 0; while (used[si] && si < 8) si++; emit(p, 28, rnd(150, 300), 0, 0, si % 8); n++; } } }
  if (n > want) { const p = mabP.find((q) => q.on && q.st === 2) || mabP.find((q) => q.on && q.st === 1); if (p) p.st = 3; }
  mabP.forEach((p, i) => {
    if (!p.on) return;
    if (p.st === 1) { const s = SLOTS[p.k], dx = s[0] - p.x, dy = s[1] - p.y, d = Math.hypot(dx, dy) || 1, v = 120 * dt;
      if (d < v + 2) { p.x = s[0]; p.y = s[1]; p.st = 2; } else { p.x += dx / d * v; p.y += dy / d * v; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 9 + i * 53) + ")"); }
    else if (p.st === 2) p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(SLOTS[p.k][2]) + ")");
    else { p.x -= 80 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 9) + ")"); p.e.setAttribute("opacity", clamp((p.x - 16) / 40).toFixed(2)); if (p.x < 18) kill(p); }
  });
  /* complement rains onto lodged antibodies and punches holes */
  acc.comp += dt * lodged * 1.6;
  while (acc.comp >= 1) { acc.comp--; const p = free(compP), q = pick(mabP.filter((r) => r.on && r.st === 2)); if (p && q) emit(p, rnd(60, 420), 56, 0, 0, mabP.indexOf(q)); }
  compP.forEach((p) => { if (!p.on) return; const q = mabP[p.k]; if (!q || !q.on || q.st !== 2) { kill(p); return; }
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1, v = 130 * dt;
    if (d < v + 3) kill(p); else { p.x += dx / d * v; p.y += dy / d * v; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); } });
  holes.forEach((h, i) => h.setAttribute("opacity", (sm.K * sm.on > 0.12 + i * 0.06 ? 0.9 : 0).toFixed(1)));
  blebs.forEach((b) => { b.e.setAttribute("r", f1(2 + 8 * sm.K * sm.on)); b.e.setAttribute("opacity", (sm.K * sm.on * 0.9).toFixed(2)); });
  /* NK cell moves in and fires granules at the coated cell */
  nkX = lerp(nkX, m.on ? 130 : 80, Math.min(1, dt * 0.8)); nkY = lerp(nkY, m.on ? 312 : 378, Math.min(1, dt * 0.8));
  place(nkG, nkX + Math.sin(tm / 900) * 2, nkY + Math.cos(tm / 1100) * 2, 0, 1);
  acc.gran += dt * sm.on * 3;
  while (acc.gran >= 1) { acc.gran--; const p = free(granP); if (p) { const dx = BCX - nkX, dy = BCY - nkY, d = Math.hypot(dx, dy) || 1; emit(p, nkX, nkY, dx / d * 130, dy / d * 130, 0); } }
  granP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(BCX - p.x, BCY - p.y) < 104 || p.x < 14 || p.x > 470) kill(p); });
  /* debris from dying B cells */
  acc.deb += dt * sm.K * sm.on * 8;
  while (acc.deb >= 1) { acc.deb--; const p = free(debP); if (p) { const a = rnd(0, 6.28); emit(p, BCX + Math.cos(a) * 98, BCY + Math.sin(a) * 98, Math.cos(a) * 26, Math.sin(a) * 26, 0); } }
  debP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.x < 18 || p.x > 466 || p.y < 48 || p.y > 436) kill(p); });
  /* infusion: flush and cytokine storm around the vessel */
  flush.setAttribute("opacity", (sm.Inf * 0.5).toFixed(2));
  shield.setAttribute("opacity", sm.prot.toFixed(2));
  acc.cyt += dt * sm.Inf * 14;
  while (acc.cyt >= 1) { acc.cyt--; const p = free(cytP); if (p) { const a = rnd(0, 6.28); emit(p, VX + Math.cos(a) * 50, VY + Math.sin(a) * 32, Math.cos(a) * 22, Math.sin(a) * 18, 0); } }
  cytP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6 || p.x < 500 || p.x > 668 || p.y < 122 || p.y > 258) kill(p); });
  acc.pm += dt * sm.prot * 2.2;
  while (acc.pm >= 1) { acc.pm--; const p = free(pmP); if (p) emit(p, 935, 128, -70, 0, 0); }
  pmP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x < 650) kill(p); });
  /* tumour lysis: debris falls in, crystals clog the kidney */
  kidTint.setAttribute("opacity", (sm.TLS * 0.4).toFixed(2));
  cryst.forEach((c, i) => c.setAttribute("opacity", sm.TLS > 0.08 + i * 0.06 ? "0.95" : "0"));
  acc.drop += dt * sm.TLS * 4;
  while (acc.drop >= 1) { acc.drop--; const p = free(dropP); if (p) emit(p, KX + rnd(-14, 14), 140, 0, 42, 0); }
  dropP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 228) kill(p); });
  /* hepatitis B: virus dots wake across the liver */
  livTint.setAttribute("opacity", (sm.Liv * 0.7).toFixed(2));
  virs.forEach((v, i) => { v.e.setAttribute("transform", "translate(" + f1(v.x + Math.sin(tm / 500 + v.ph) * 2) + " " + f1(v.y + Math.cos(tm / 620 + v.ph) * 2) + ")"); v.e.setAttribute("opacity", clamp(sm.Liv * 22 - i, 0, 1).toFixed(2)); });
  /* PML: pale lesions spread in the brain */
  lesions.forEach((e) => { e.setAttribute("rx", f1(6 + 12 * sm.Brn)); e.setAttribute("ry", f1(5 + 9 * sm.Brn)); e.setAttribute("opacity", clamp(sm.Brn * 3).toFixed(2)); });
  /* antibodies fade, bacteria move in */
  dmabs.forEach((g) => g.setAttribute("opacity", clamp(1 - sm.Irs).toFixed(2)));
  const bvis = sm.Irs * 8 - 0.4;
  bacs.forEach((b, i) => { b.e.setAttribute("cx", f1(b.x + Math.sin(tm / 450 + b.ph) * 2.5)); b.e.setAttribute("cy", f1(b.y + Math.cos(tm / 550 + b.ph) * 2)); b.e.setAttribute("opacity", clamp(bvis - i, 0, 1).toFixed(2)); });
  /* marrow neutrophils deplete late */
  const nvis = (1 - sm.Neu * 1.6) * 8;
  neus.forEach((c, i) => { c.e.setAttribute("cx", f1(c.x)); c.e.setAttribute("cy", f1(c.y)); c.e.setAttribute("opacity", clamp(nvis - i, 0, 1).toFixed(2)); });
  /* caption and gauges */
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; capEl.textContent = capText(drug, level); }
  gg.kill.set(sm.K, wordOf(sm.K, 0.3, 0.7, ["low", "some", "high"])); gg.inf.set(sm.Inf, wordOf(sm.Inf, 0.3, 0.65, ["calm", "reacting", "severe"]));
  gg.tls.set(sm.TLS, wordOf(sm.TLS, 0.3, 0.6, ["none", "some", "severe"])); gg.liv.set(sm.Liv, wordOf(sm.Liv, 0.2, 0.35, ["quiet", "stirring", "active"]));
  gg.brn.set(sm.Brn, wordOf(sm.Brn, 0.12, 0.22, ["none", "early", "spreading"])); gg.irs.set(sm.Irs, wordOf(sm.Irs, 0.3, 0.6, ["low", "raised", "high"]));
  gg.neu.set(sm.Neu, wordOf(sm.Neu, 0.2, 0.45, ["ok", "low", "very low"]));
}
run({ init, step });
