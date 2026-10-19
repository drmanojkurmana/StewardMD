/* Salicylate scene: gut to blood, breathing centre, mitochondria, kidney, dialysis and gauges. */
const layers = { parts: $("parts"), over: $("over"), panel: $("panel") };
let gutO = null, brainO = null, lungO = null, kidO = null, capEl = null, capKey = "";
let trAbsorb = null, trEntry = null, trEar = null, trKidney = null, trUrine = null, trDiaA = null, trDiaB = null;
let lungX = 730, lungY = 285, brainX = 752, brainY = 140;
function initOrgans() {
  gutO = organ($("gutSlot"), "bowel", 130, 200, 150, {});
  brainO = organ($("brainSlot"), "brain", 752, 140, 130, {});
  lungO = organ($("lungSlot"), "lung", 730, 285, 120, {});
  kidO = organ($("kidneySlot"), "kidney", 860, 340, 95, {});
  organ($("earSlot"), "ear", 872, 148, 60, {});
  brainX = brainO.ports.parenchyma[0]; brainY = brainO.ports.parenchyma[1];
  lungX = 730; lungY = 285;
  const go = gutO.ports.out, ci = brainO.ports.carotid, ki = kidO.ports.in, ko = kidO.ports.out;
  $("absArrow").setAttribute("d", "M" + f1(go[0]) + " " + f1(go[1]) + " C200 250 215 225 240 200");
  $("entryArrow").setAttribute("d", "M540 150 C600 148 " + f1((540 + ci[0]) / 2) + " " + f1((150 + ci[1]) / 2) + " " + f1(ci[0]) + " " + f1(ci[1]));
  $("ureter").setAttribute("d", "M" + f1(ko[0]) + " " + f1(ko[1]) + " L" + f1(ko[0]) + " 414 L884 416");
  trAbsorb = track([go, [200, 250], [240, 200]]);
  trEntry = track([[540, 150], [600, 148], ci]);
  trEar = track([ci, [(ci[0] + 872) / 2, (ci[1] + 148) / 2 - 8], [872, 148]]);
  trKidney = track([[540, 200], [600, 310], [670, 385], [770, 388], [800, 370], ki]);
  trUrine = track([ko, [ko[0], 414], [884, 416]]);
  trDiaA = track([[540, 126], [600, 126]]);
  trDiaB = track([[600, 186], [540, 186]]);
}
function capText(d, l) {
  const sev = l === 2 ? "Severe poisoning. " : l === 0 ? "Mild poisoning. " : "";
  if (d === 1) return sev + "Charcoal traps tablets in the gut, so less salicylate enters the blood.";
  if (d === 2) return sev + "Alkaline urine traps salicylate, so more leaves in the urine.";
  if (d === 3) return sev + "Dialysis cleans the blood directly, so salicylate falls fast.";
  return sev + "No treatment. Salicylate spreads in the blood and reaches the brain.";
}
/* tracks above are built in initOrgans from the bowel, brain and kidney ports */
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, u: 0, tr: null, tx: 0, ty: 0 }; }); }
const sal = pool(34, () => mk("circle", { class: "sc-p p-sal", r: 3.2 }, layers.parts));
const co2 = pool(18, () => mk("circle", { class: "sc-p p-co2", r: 2.6 }, layers.parts));
const acid = pool(20, () => mk("path", { class: "sc-p p-acid", d: "M0 -3L3 2L-3 2Z" }, layers.parts));
const heatp = pool(12, () => mk("circle", { class: "sc-p p-heatp", r: 2.4 }, layers.parts));
const uri = pool(12, () => mk("circle", { class: "sc-p p-sal", r: 2.8 }, layers.parts));
const dia = pool(10, () => mk("circle", { class: "sc-p p-dia", r: 3 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["sal", "Salicylate", "g-sal", "Salicylate level in the blood from absorbed tablets. Charcoal lowers absorption and dialysis clears blood directly."], ["resp", "Breathing", "g-resp", "Breathing centre stimulation: breathing speeds up and carbon dioxide is blown off, causing respiratory alkalosis early."], ["acid", "Metabolic acid", "g-acid", "High anion gap metabolic acidosis from uncoupled metabolism. Acid conditions increase tissue entry."], ["heat", "Body heat", "g-heat", "Uncoupled mitochondria release energy as heat, so temperature rises."], ["brain", "Tissue entry", "g-brain", "How much salicylate enters tissues and brain. It rises when blood is more acid and falls with alkalinisation or dialysis."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Tablets", 130, 200, 125, 70, "Salicylate tablets in the gut. Charcoal here binds salicylate and less is absorbed.");
  pill(ox, "Blood", 390, 150, 425, 70, "Blood carries absorbed salicylate around the body. Dialysis clears it from here.");
  pill(ox, "Dialysis", 639, 110, 610, 70, "Dialysis machine. Blood flows through it and salicylate is removed.");
  pill(ox, "Breathing centre", 752, 130, 750, 70, "Salicylate switches the breathing centre on, so breathing speeds up and carbon dioxide is blown off.");
  pill(ox, "Ringing ear", 872, 148, 880, 70, "Ringing in the ears is an early warning sign of salicylate poisoning.");
  pill(ox, "Mitochondria", 385, 348, 340, 402, "Salicylate uncouples mitochondria, so energy escapes as heat and acid builds up.");
  pill(ox, "Acid raises entry", 500, 355, 565, 402, "Acid lets more salicylate cross into the brain, which makes poisoning worse.");
  pill(ox, "Kidney trapping", 840, 320, 760, 402, "Alkaline urine traps salicylate so it leaves the body in the urine.");
  capEl = mk("text", { class: "sl-cap", x: 30, y: 434 }, ox); capEl.textContent = capText(drug, level);
}
const sm = { Sal: 0.4, Resp: 0.4, Acid: 0.3, Heat: 0.3, Brain: 0.3, chr: 0, alk: 0, dial: 0 };
const acc = { sal: 0, co2: 0, acid: 0, heat: 0, uri: 0 };
function init() { initOrgans(); initPanel(); dia.forEach((p, i) => { p.on = true; p.u = i / dia.length; p.e.setAttribute("opacity", "0"); }); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  sm.Sal = lerp(sm.Sal, m.Sal, k); sm.Resp = lerp(sm.Resp, m.Resp, k); sm.Acid = lerp(sm.Acid, m.Acid, k); sm.Heat = lerp(sm.Heat, m.Heat, k); sm.Brain = lerp(sm.Brain, m.Brain, k); sm.chr = lerp(sm.chr, m.chr, k); sm.alk = lerp(sm.alk, m.alk, k); sm.dial = lerp(sm.dial, m.dial, k);
  $("charGroup").setAttribute("opacity", sm.chr.toFixed(2));
  $("alkGroup").setAttribute("opacity", sm.alk.toFixed(2));
  $("heatWaves").setAttribute("opacity", (sm.Heat * 0.9).toFixed(2));
  $("tabGroup").setAttribute("opacity", (1 - 0.35 * sm.chr).toFixed(2));
  $("dialBox").setAttribute("opacity", (0.25 + 0.75 * sm.dial).toFixed(2));
  $("diaGlow").setAttribute("opacity", (0.55 * sm.dial).toFixed(2));
  $("diaLight").setAttribute("fill", sm.dial > 0.5 ? "#3ddc97" : "#5a6b7a");
  $("brainGlow").setAttribute("opacity", (sm.Brain * 0.5).toFixed(2));
  $("absArrow").setAttribute("opacity", (0.2 + 0.8 * clamp(sm.Sal + 0.15)).toFixed(2));
  const en = $("entryArrow");
  en.setAttribute("stroke-width", f1(1 + 7 * sm.Brain));
  en.setAttribute("opacity", (0.15 + 0.85 * sm.Brain).toFixed(2));
  $("urinePool").setAttribute("r", f1(7 + 5 * clamp(sm.alk * 0.7 + sm.Sal * 0.3)));
  /* lungs breathe faster when stimulated */
  const per = lerp(1500, 520, sm.Resp);
  place(lungO.g, lungX, lungY, 0, 1 + 0.03 * Math.sin(tm / per * 6.2832));
  /* ear rings pulse with salicylate */
  for (let i = 1; i <= 3; i++) {
    const r = $("ring" + i), f = (tm / 1700 + i / 3) % 1;
    r.setAttribute("r", f1(6 + 15 * f));
    r.setAttribute("opacity", ((1 - f) * 0.55 * clamp(sm.Sal * 1.6)).toFixed(2));
  }
  /* dialysis loop flow, visible only when dialysis is on */
  dia.forEach((p) => { p.u = (p.u + dt * 0.5) % 1; const q = p.u < 0.5 ? trDiaA.at(p.u * 2) : trDiaB.at((p.u - 0.5) * 2);
    p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", sm.dial.toFixed(2)); });
  /* salicylate: gut to blood, then brain, ear, kidney or urine */
  acc.sal += dt * (1.5 + 9 * sm.Sal); while (acc.sal >= 1) { acc.sal--; const p = free(sal); if (p) { emit(p, rnd(90, 175), rnd(150, 240), rnd(-8, 8), rnd(-8, 8)); p.st = 0; } }
  sal.forEach((p) => { if (!p.on) return;
    if (p.st === 0) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 70, 195); p.y = clamp(p.y, 140, 255); place(p.e, p.x, p.y, 0, 1);
      if (p.t > 0.7) { if (Math.random() < 0.6 * sm.chr) { p.st = 5; p.t = 0; p.tx = rnd(105, 150); p.ty = rnd(165, 200); } else { p.tr = trAbsorb; p.u = 0; p.st = 1; } } }
    else if (p.st === 5) { p.t += dt; p.x = lerp(p.x, p.tx, Math.min(1, dt * 3)); p.y = lerp(p.y, p.ty, Math.min(1, dt * 3)); place(p.e, p.x, p.y, 0, 1);
      p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4) kill(p); }
    else if (p.st === 1) { p.u += dt * 90 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, 1); if (p.u >= 1) { p.st = 2; p.x = 240; p.y = 200; } }
    else if (p.st === 2) { p.t += dt; p.x += 48 * dt; p.y += (150 + Math.sin(p.x / 45) * 30 - p.y) * dt * 1.4; place(p.e, clamp(p.x, 30, 930), clamp(p.y, 60, 425), 0, 1);
      if (p.x >= 530) { const r = Math.random();
        if (r < 0.6 * sm.dial) { p.st = 6; p.tx = 639; p.ty = 156; }
        else if (r < 0.6 * sm.dial + 0.3 + 0.4 * sm.alk) { p.tr = trKidney; p.u = 0; p.st = 3; }
        else if (Math.random() < 0.35) { p.tr = trEar; p.u = 0; p.st = 4; p.k = 1; }
        else { p.tr = trEntry; p.u = 0; p.st = 4; p.k = 0; } } }
    else if (p.st === 6) { p.x = lerp(p.x, p.tx, Math.min(1, dt * 4)); p.y = lerp(p.y, p.ty, Math.min(1, dt * 4)); place(p.e, p.x, p.y, 0, 1);
      p.e.setAttribute("opacity", clamp(1 - Math.hypot(p.x - 639, p.y - 156) / 90).toFixed(2)); if (Math.hypot(p.x - 639, p.y - 156) < 8) kill(p); }
    else if (p.st === 3) { p.u += dt * 110 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, 1);
      if (p.u >= 1) { if (Math.random() < 0.35 + 0.55 * sm.alk) { p.tr = trUrine; p.u = 0; p.st = 7; } else { p.st = 8; p.t = 0; } } }
    else if (p.st === 7) { p.u += dt * 80 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, 1);
      p.e.setAttribute("opacity", clamp(1 - p.u * 0.5).toFixed(2)); if (p.u >= 1) kill(p); }
    else if (p.st === 8) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 1.2).toFixed(2)); if (p.t > 1.2) kill(p); }
    else if (p.st === 4) { p.u += dt * 100 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, 1);
      if (p.u >= 1) { p.st = p.k ? 10 : 9; p.t = 0; p.vx = rnd(-14, 14); p.vy = rnd(-10, 10); } }
    else if (p.st === 9) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, brainX - 45, brainX + 45); p.y = clamp(p.y, brainY - 35, brainY + 40);
      place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - (p.t - 1.6) / 1.4).toFixed(2)); if (p.t > 3) kill(p); }
    else { p.t += dt; p.x = clamp(p.x + p.vx * dt, 852, 892); p.y = clamp(p.y + p.vy * dt, 130, 166); place(p.e, p.x, p.y, 0, 1);
      p.e.setAttribute("opacity", clamp(1 - (p.t - 1.2) / 1.2).toFixed(2)); if (p.t > 2.4) kill(p); } });
  acc.co2 += dt * sm.Resp * 9; while (acc.co2 >= 1) { acc.co2--; const p = free(co2); if (p) emit(p, 729 + rnd(-14, 14), 215, rnd(-6, 6), -rnd(22, 34), 0); }
  co2.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6 || p.y < 58) kill(p); });
  acc.acid += dt * sm.Acid * 8; while (acc.acid >= 1) { acc.acid--; const p = free(acid); if (p) emit(p, rnd(300, 560), rnd(300, 380), rnd(-8, 8), rnd(-6, 6), 0); }
  acid.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 255, 595); p.y = clamp(p.y, 285, 410); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.t > 5) kill(p); });
  acc.heat += dt * sm.Heat * 6; while (acc.heat >= 1) { acc.heat--; const p = free(heatp); if (p) emit(p, rnd(330, 530), 320, rnd(-4, 4), -rnd(18, 28), 0); }
  heatp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8) kill(p); });
  acc.uri += dt * (0.4 + sm.alk * 3.2) * (0.3 + sm.Sal); while (acc.uri >= 1) { acc.uri--; const p = free(uri); if (p) { emit(p, 884 + rnd(-6, 6), 420, rnd(-3, 3), rnd(4, 10), 0); p.t = 0; } }
  uri.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9) kill(p); });
  gg.sal.set(sm.Sal, wordOf(sm.Sal, 0.28, 0.58, ["low", "raised", "high"])); gg.resp.set(sm.Resp, wordOf(sm.Resp, 0.3, 0.6, ["near normal", "fast", "very fast"])); gg.acid.set(sm.Acid, wordOf(sm.Acid, 0.32, 0.6, ["low", "raised", "high"])); gg.heat.set(sm.Heat, wordOf(sm.Heat, 0.3, 0.6, ["normal", "warm", "overheated"])); gg.brain.set(sm.Brain, wordOf(sm.Brain, 0.22, 0.5, ["low", "raised", "high"]));
  const ck = drug + "|" + level; if (ck !== capKey) { capKey = ck; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
