/* Cisplatin scene: tumour DNA cross-links and apoptosis on the left, toxic organs on the right. */
const TCX = 240, TCY = 255, TCR = 120, NUC = 62, XLINK_Y = 250;
const L = { tum: $("tum"), dna: $("dna"), kid: $("kidSlot"), ear: $("earSlot"), nerve: $("nerve"), gut: $("gutSlot"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { K: 0.3, Kd: 0.2, Ot: 0.2, Nr: 0.2, Na: 0.3, Mg: 0.8, on: 0, hyd: 0, aem: 0 };
const acc = { cis: 0, kcis: 0, rad: 0, hyd: 0, mg: 0, ecis: 0, ser: 0 };
const gg = {};
let tumG = null, nucG = null, xlinkG = null, forkG = null, blockG = null, kdmg = null, gdim = null, axbad = null, gutGlow = null, capEl = null, capKey = "";
let kidO = null, earO = null, gangO = null, gutO = null, forkY = 205;
const blebs = [], octs = [], hairs = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const cis = pool(16, () => mk("circle", { class: "sc-p p-cis", r: 3 }, L.parts));
const kcis = pool(10, () => mk("circle", { class: "sc-p p-cis", r: 2.6 }, L.parts));
const ecis = pool(8, () => mk("circle", { class: "sc-p p-cis", r: 2.6 }, L.parts));
const rad = pool(12, () => mk("path", { class: "sc-p p-rad", d: "M0 -4.5L1.2 -1.2L4.5 -1.2L1.8 1L2.8 4.2L0 2.2L-2.8 4.2L-1.8 1L-4.5 -1.2L-1.2 -1.2Z" }, L.parts));
const hyd = pool(12, () => mk("path", { class: "sc-p p-hyd", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const mgp = pool(10, () => mk("circle", { class: "sc-p p-mg", r: 2.6 }, L.parts));
const ser = pool(14, () => mk("circle", { class: "sc-p p-ser", r: 2.8 }, L.parts));
const trn = pool(10, () => mk("circle", { class: "sc-p p-trn", r: 2.6 }, L.parts));
const xmark = (parent, x, y) => { const g = mk("g", { opacity: "0" }, parent); mk("circle", { class: "oc-xc", cx: x, cy: y, r: 7 }, g); mk("path", { class: "oc-xp", d: "M" + (x - 3.5) + " " + (y - 3.5) + "l7 7M" + (x + 3.5) + " " + (y - 3.5) + "l-7 7" }, g); return g; };
let aemX1 = null, aemX2 = null;

function capText(d, l) {
  if (d === 3) return "Full protection: hydration, magnesium and antiemetics. Vomiting settles while the tumour still dies.";
  if (d === 2) return "Hydration flushes the kidneys and magnesium replaces losses. Kidney and magnesium harm stay lower.";
  if (d === 1) return l >= 2 ? "Cisplatin cross-links tumour DNA and cells die. By late courses kidney, hearing, nerve and gut harm build."
    : "Cisplatin cross-links tumour DNA and cells die. Kidney, hearing, nerve and gut harm build with each course.";
  return "No treatment. The tumour keeps growing and the organs stay healthy.";
}

function init() {
  /* ---- tumour cell with nucleus ---- */
  tumG = cell(L.tum, { cls: "tum", r: TCR, seed: 3, wob: 0.08, n: 10 });
  place(tumG, TCX, TCY, 0, 1);
  nucG = cell(L.tum, { cls: "nuc", r: NUC, seed: 7, wob: 0.06, n: 9 });
  place(nucG, TCX, TCY, 0, 1);
  /* ---- DNA: two wavy strands with rungs ---- */
  let dL = "", dR = "";
  for (let y = 198; y <= 312; y += 4) { const s = 5 * Math.sin(y / 10); dL += (y === 198 ? "M" : "L") + f1(TCX - 16 + s) + " " + y; dR += (y === 198 ? "M" : "L") + f1(TCX + 16 + s) + " " + y; }
  mk("path", { class: "oc-dna", d: dL }, L.dna);
  mk("path", { class: "oc-dna", d: dR }, L.dna);
  for (let y = 206; y <= 306; y += 14) { const s = 5 * Math.sin(y / 10); mk("path", { class: "oc-rung", d: "M" + f1(TCX - 16 + s) + " " + y + "L" + f1(TCX + 16 + s) + " " + y }, L.dna); }
  /* ---- the cross-link bridging the strands ---- */
  xlinkG = mk("g", {}, L.dna);
  mk("rect", { class: "oc-x", x: TCX - 16, y: XLINK_Y, width: 32, height: 7, rx: 3.5 }, xlinkG);
  mk("circle", { class: "oc-x", cx: TCX - 16, cy: XLINK_Y + 3.5, r: 4 }, xlinkG);
  mk("circle", { class: "oc-x", cx: TCX + 16, cy: XLINK_Y + 3.5, r: 4 }, xlinkG);
  /* ---- replication fork that stalls at the link, plus a blocked mark ---- */
  forkG = mk("g", {}, L.dna);
  mk("path", { class: "oc-fork", d: "M-9 0L9 0L0 12Z" }, forkG);
  place(forkG, TCX, forkY, 0, 1);
  blockG = xmark(L.dna, TCX + 34, XLINK_Y + 3);
  /* ---- apoptotic blebs around the rim ---- */
  for (let i = 0; i < 7; i++) { const ang = -0.5 + i * 0.62, e = mk("circle", { class: "oc-bleb", r: 5 + (i % 3) * 1.6 }, L.tum); blebs.push({ e, ang }); }
  /* ---- toxic organs ---- */
  kidO = organ(L.kid, "kidney", 600, 185, 95, {});
  earO = organ(L.ear, "ear", 820, 185, 95, {});
  gangO = organ(L.nerve, "ganglion", 568, 325, 64, {});
  gutO = organ(L.gut, "stomach", 820, 325, 110, { h: 78 });
  /* kidney: OCT2 uptake dots and a damage glow */
  const cx = kidO.ports.cortex ? kidO.ports.cortex[0] : 612, cy = kidO.ports.cortex ? kidO.ports.cortex[1] : 178;
  [[-26, -18], [-14, 6], [4, -10], [16, 12]].forEach(([u, v], i) => octs.push({ e: mk("circle", { class: "oc-oct", cx: f1(cx + u), cy: f1(cy + v), r: 3 }, L.parts), i }));
  kdmg = mk("ellipse", { class: "oc-dmg", cx: 600, cy: 185, rx: 52, ry: 62, opacity: "0" }, L.parts);
  /* ear: cochlear hair cells that wilt */
  const hx = earO.ports.cochlea ? earO.ports.cochlea[0] : 828, hy = earO.ports.cochlea ? earO.ports.cochlea[1] : 205;
  for (let i = 0; i < 5; i++) { const g = mk("g", {}, L.parts); mk("path", { class: "oc-hair", d: "M-4 0L0 -13L4 0Z" }, g); mk("circle", { class: "oc-hair", cx: 0, cy: -15, r: 2.4 }, g); hairs.push({ g, x: hx - 18 + i * 9, y: hy + 14, i }); }
  /* nerve: axon fibre with myelin bands, transport dots, damage glows */
  mk("rect", { class: "oc-axon", x: 606, y: 318, width: 100, height: 14, rx: 7 }, L.nerve);
  [626, 656, 686].forEach((x) => mk("rect", { class: "oc-myel", x, y: 314, width: 8, height: 22, rx: 3 }, L.nerve));
  axbad = mk("rect", { class: "oc-axonbad", x: 606, y: 318, width: 100, height: 14, rx: 7, opacity: "0" }, L.nerve);
  gdim = mk("ellipse", { class: "oc-dmg", cx: 568, cy: 325, rx: 36, ry: 34, opacity: "0" }, L.parts);
  trn.forEach((p, i) => { p.u = i / 10; p.on = true; p.e.setAttribute("opacity", "1"); });
  /* gut: sickness glow plus antiemetic block marks */
  gutGlow = mk("ellipse", { class: "oc-dmg", cx: 820, cy: 325, rx: 58, ry: 42, opacity: "0" }, L.parts);
  aemX1 = xmark(L.parts, 788, 264);
  aemX2 = xmark(L.parts, 852, 264);
  /* ---- labels, caption, gauges ---- */
  const o = L.over;
  pill(o, "Cisplatin", 60, 200, 120, 100, "Cisplatin enters cells and swaps its chlorides for water. The charged form binds DNA.");
  pill(o, "Cross-link", 240, 247, 130, 152, "An intrastrand cross-link bends DNA. Replication stalls and the cell kills itself.");
  pill(o, "DNA", 258, 292, 352, 150, "DNA in the tumour nucleus. Cisplatin links neighbouring guanines on the same strand.");
  pill(o, "Dying cell", 325, 340, 350, 415, "Apoptosis: the damaged tumour cell breaks into blebs and dies.");
  pill(o, "Kidney", cx, cy, 600, 92, "Cisplatin enters tubule cells through the OCT2 transporter and makes radicals. Cells swell and leak magnesium.");
  pill(o, "Inner ear", hx, hy, 830, 92, "Cisplatin poisons cochlear hair cells through radicals. Hearing dulls and the damage lasts.");
  pill(o, "Nerve", 656, 325, 590, 415, "Cisplatin injures sensory nerves in the hands and feet. Tingling builds into numbness.");
  pill(o, "Gut", 820, 340, 830, 415, "Gut serotonin and brain substance P trigger the vomit reflex. Blockers at 5-HT3 and NK1 calm it.");
  capEl = mk("text", { class: "oc-cap", x: 30, y: 449 }, o); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["kill", "Tumour kill", "g-good", "How much of the tumour dies by apoptosis. It rises with each course while the drug is given."],
    ["kid", "Kidney injury", "g-bad", "Tubule injury from OCT2 uptake and radicals. Hydration flushes the tubules and keeps this lower."],
    ["hear", "Hearing loss", "g-cyt", "Cochlear hair cell injury. It builds with each course and does not recover."],
    ["neur", "Neuropathy", "g-neu", "Sensory nerve injury in hands and feet: tingling that builds into numbness."],
    ["nau", "Nausea", "g-eos", "Sickness from gut serotonin and brain substance P. Antiemetics that block 5-HT3 and NK1 calm it."],
    ["mag", "Magnesium", "g-fl", "Body magnesium. The injured tubule wastes it; replacement keeps the level up."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, 486, 56, 18, cls, name, tip); });
}

function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.K = lerp(sm.K, m.K, k2); sm.Kd = lerp(sm.Kd, m.Kd, k2); sm.Ot = lerp(sm.Ot, m.Ot, k2);
  sm.Nr = lerp(sm.Nr, m.Nr, k2); sm.Na = lerp(sm.Na, m.Na, k1); sm.Mg = lerp(sm.Mg, m.Mg, k2);
  sm.on = lerp(sm.on, m.on, k1); sm.hyd = lerp(sm.hyd, m.hyd, k1); sm.aem = lerp(sm.aem, m.aem, k1);
  /* tumour shrinks and its nucleus condenses as cells die */
  place(tumG, TCX, TCY, 0, 1 - 0.07 * sm.K);
  place(nucG, TCX, TCY, 0, 1 - 0.22 * sm.K);
  blebs.forEach((b, i) => { const s = clamp((sm.K - 0.08 * i) * 1.6), rr = TCR * (1 - 0.07 * sm.K) + 2;
    b.e.setAttribute("cx", f1(TCX + Math.cos(b.ang) * rr)); b.e.setAttribute("cy", f1(TCY + Math.sin(b.ang) * rr));
    b.e.setAttribute("r", f1((5 + (i % 3) * 1.6) * (0.2 + 0.8 * s))); b.e.setAttribute("opacity", s > 0.05 ? "1" : "0"); });
  /* the cross-link flashes while drug is present */
  xlinkG.setAttribute("opacity", (0.25 + 0.75 * sm.on * (0.6 + 0.4 * Math.sin(tm / 180))).toFixed(2));
  /* the fork runs when untreated and stalls at the link when treated */
  if (sm.on > 0.5) forkY = lerp(forkY, XLINK_Y - 6, Math.min(1, dt * 2));
  else { forkY += 42 * dt; if (forkY > 312) forkY = 198; }
  place(forkG, TCX, forkY, 0, 1);
  blockG.setAttribute("opacity", clamp(sm.on * sm.K * 1.4).toFixed(2));
  /* drug dots drift in from the blood, cross the membrane and head for DNA */
  acc.cis += dt * sm.on * 7;
  while (acc.cis >= 1) { acc.cis--; const p = free(cis); if (p) emit(p, rnd(18, 30), rnd(150, 360), 0, 0, 0); }
  cis.forEach((p) => { if (!p.on) return;
    if (p.k === 0) { p.x += 55 * dt; p.y += Math.sin(tm / 300 + p.y) * 0.25; if (p.x > 128) p.k = 1; }
    else { const dx = TCX - p.x, dy = TCY + 10 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 62 * dt; p.y += (dy / d) * 62 * dt; if (d < 26) { kill(p); return; } }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 460) kill(p); });
  /* kidney: drug arrives at the cortex, radicals flash, tubules glow with injury */
  const cort = kidO.ports.cortex || [612, 178];
  acc.kcis += dt * sm.on * 5;
  while (acc.kcis >= 1) { acc.kcis--; const p = free(kcis); if (p) emit(p, rnd(482, 492), rnd(140, 210), 0, 0, 0); }
  kcis.forEach((p) => { if (!p.on) return; const dx = cort[0] - p.x, dy = cort[1] - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 72 * dt; p.y += (dy / d) * 72 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 10) kill(p); });
  acc.rad += dt * sm.Kd * 9;
  while (acc.rad >= 1) { acc.rad--; const p = free(rad); if (p) emit(p, cort[0] + rnd(-30, 30), clamp(cort[1] + rnd(-30, 30), 100, 260), 0, 0, 0); }
  rad.forEach((p) => { if (!p.on) return; p.t += dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 1.2).toFixed(2) + ") rotate(" + f1(tm / 6) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 0.7).toFixed(2)); if (p.t > 0.7) kill(p); });
  octs.forEach((o) => o.e.setAttribute("opacity", (0.25 + 0.75 * sm.on * (0.5 + 0.5 * Math.sin(tm / 240 + o.i * 1.7))).toFixed(2)));
  kdmg.setAttribute("opacity", (sm.Kd * 0.55).toFixed(2));
  /* hydration flushes down through the kidney */
  acc.hyd += dt * sm.hyd * 8;
  while (acc.hyd >= 1) { acc.hyd--; const p = free(hyd); if (p) emit(p, rnd(560, 640), 96, 0, 92, 0); }
  hyd.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 272) kill(p); });
  /* magnesium leaks away in the urine while tubules are injured */
  const pelv = kidO.ports.pelvis || [587, 172];
  acc.mg += dt * sm.on * (1 - sm.Mg) * 10;
  while (acc.mg >= 1) { acc.mg--; const p = free(mgp); if (p) emit(p, pelv[0] + 28 + rnd(-8, 8), pelv[1] + 30, rnd(-6, 6), 55, 0); }
  mgp.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 432) kill(p); });
  /* ear: drug drifts to the cochlea and hair cells wilt */
  const coch = earO.ports.cochlea || [828, 205];
  acc.ecis += dt * sm.on * 4;
  while (acc.ecis >= 1) { acc.ecis--; const p = free(ecis); if (p) emit(p, rnd(748, 768), rnd(110, 150), 0, 0, 0); }
  ecis.forEach((p) => { if (!p.on) return; const dx = coch[0] - p.x, dy = coch[1] - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 52 * dt; p.y += (dy / d) * 52 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 8) kill(p); });
  hairs.forEach((h) => { const sway = (1 - sm.Ot) * 8 * Math.sin(tm / 300 + h.i * 1.3);
    place(h.g, h.x, h.y, sm.Ot * 58 + sway, 1); h.g.setAttribute("opacity", (1 - 0.6 * sm.Ot).toFixed(2)); });
  /* nerve: transport slows and jitters as neuropathy builds */
  trn.forEach((p) => { p.u += dt * (0.04 + 0.22 * (1 - sm.Nr)); if (p.u > 1) p.u -= 1;
    const x = 606 + p.u * 100, y = 325 + Math.sin(tm / 200 + p.u * 9) * (1 + sm.Nr * 4);
    p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); });
  axbad.setAttribute("opacity", (sm.Nr * 0.75).toFixed(2));
  gdim.setAttribute("opacity", (sm.Nr * 0.5).toFixed(2));
  /* gut: serotonin bursts rise with sickness; antiemetics block the signals */
  const fund = gutO.ports.fundus || [800, 300];
  acc.ser += dt * sm.Na * 11;
  while (acc.ser >= 1) { acc.ser--; const p = free(ser); if (p) emit(p, fund[0] + rnd(-24, 24), fund[1] + rnd(-8, 8), rnd(-14, 14), -rnd(30, 60), 0); }
  ser.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8 || p.y < 190) kill(p); });
  gutGlow.setAttribute("opacity", (sm.Na * 0.4).toFixed(2));
  aemX1.setAttribute("opacity", sm.aem.toFixed(2));
  aemX2.setAttribute("opacity", sm.aem.toFixed(2));
  /* caption and gauges */
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
  gg.kill.set(sm.K, wordOf(sm.K, 0.25, 0.6, ["growing", "slowing", "dying"]));
  gg.kid.set(sm.Kd, wordOf(sm.Kd, 0.25, 0.6, ["ok", "strained", "injured"]));
  gg.hear.set(sm.Ot, wordOf(sm.Ot, 0.3, 0.6, ["ok", "dulling", "lost"]));
  gg.neur.set(sm.Nr, wordOf(sm.Nr, 0.3, 0.6, ["none", "tingling", "numb"]));
  gg.nau.set(sm.Na, wordOf(sm.Na, 0.3, 0.6, ["settled", "queasy", "vomiting"]));
  gg.mag.set(sm.Mg, wordOf(sm.Mg, 0.4, 0.7, ["low", "borderline", "ok"]));
}
run({ init, step });
