/* Salicylate scene: gut to blood, respiratory centre, mitochondria, kidney and gauges. */
const layers = { parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const sal = pool(30, () => mk("circle", { class: "sc-p p-sal", r: 3.2 }, layers.parts));
const co2 = pool(18, () => mk("circle", { class: "sc-p p-co2", r: 2.6 }, layers.parts));
const acid = pool(20, () => mk("path", { class: "sc-p p-acid", d: "M0 -3L3 2L-3 2Z" }, layers.parts));
const heatp = pool(12, () => mk("circle", { class: "p-heatp", r: 2.4 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["sal", "Salicylate", "g-sal", "Salicylate level in the blood from absorbed tablets. Charcoal lowers absorption, alkalinisation aids urine excretion, dialysis clears blood directly."], ["resp", "Breathing", "g-resp", "Respiratory centre stimulation: breathing speeds up and carbon dioxide is blown off, causing respiratory alkalosis early."], ["acid", "Metabolic acid", "g-acid", "High anion gap metabolic acidosis from uncoupled metabolism and accumulated acids. Acid conditions increase tissue entry."], ["heat", "Body heat", "g-heat", "Uncoupled oxidative phosphorylation releases energy as heat, so temperature rises."], ["brain", "Tissue entry", "g-brain", "How much salicylate enters tissues and brain. It rises when blood is more acid and falls with alkalinisation or dialysis."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Tablets", 125, 145, 125, 70, "Salicylate tablets in the gut. Activated charcoal here binds salicylate and reduces absorption.");
  pill(ox, "Blood", 425, 125, 425, 70, "Blood carries absorbed salicylate to brain, tissues and kidney. Dialysis clears salicylate from this compartment.");
  pill(ox, "Respiratory centre", 730, 112, 750, 70, "The respiratory centre in the brainstem is directly stimulated by salicylate, driving faster breathing.");
  pill(ox, "Tinnitus", 858, 124, 880, 70, "Ringing in the ear (tinnitus) is a classic early feature of salicylate poisoning.");
  pill(ox, "Uncoupled mitochondria", 385, 322, 340, 428, "Salicylate uncouples oxidative phosphorylation: energy escapes as heat instead of being stored, and metabolic acid accumulates.");
  pill(ox, "Acid raises entry", 520, 330, 565, 428, "When tissues and blood are more acid, more salicylate is non-ionised and crosses into tissues and brain, worsening toxicity.");
  pill(ox, "Kidney trapping", 770, 300, 700, 410, "In alkaline urine salicylate stays ionised, is trapped in urine and excreted. Urinary alkalinisation uses this.");
}
const sm = { Sal: 0.4, Resp: 0.4, Acid: 0.3, Heat: 0.3, Brain: 0.3, chr: 0, alk: 0, dial: 0 };
const acc = { sal: 0, co2: 0, acid: 0, heat: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  sm.Sal = lerp(sm.Sal, m.Sal, k); sm.Resp = lerp(sm.Resp, m.Resp, k); sm.Acid = lerp(sm.Acid, m.Acid, k); sm.Heat = lerp(sm.Heat, m.Heat, k); sm.Brain = lerp(sm.Brain, m.Brain, k); sm.chr = lerp(sm.chr, m.chr, k); sm.alk = lerp(sm.alk, m.alk, k); sm.dial = lerp(sm.dial, m.dial, k);
  $("charGroup").setAttribute("opacity", sm.chr.toFixed(2));
  $("alkGroup").setAttribute("opacity", sm.alk.toFixed(2));
  $("heatWaves").setAttribute("opacity", (sm.Heat * 0.9).toFixed(2));
  $("dialBox").setAttribute("opacity", (0.25 + 0.75 * sm.dial).toFixed(2));
  acc.sal += dt * (2 + sm.Sal * 10); while (acc.sal >= 1) { acc.sal--; const p = free(sal); if (p) emit(p, 150, 180 + rnd(-18, 18), rnd(18, 30), 0, 0); }
  sal.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += Math.sin(tm / 300 + p.x / 20) * 6 * dt;
    if (p.x > 235 && p.x < 610) { p.vx = 42; p.y += (150 + Math.sin(p.x / 45) * 28 - p.y) * dt * 1.2; }
    if (p.x >= 610) { if (sm.dial > 0.5 && Math.random() < 0.02) { kill(p); return; } p.vx = 28; p.y += ((Math.random() < 0.5 ? 340 : 150) - p.y) * dt * 0.6; }
    if (p.x > 840) p.x = 840;
    if (p.t > 9) kill(p);
    p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 60, 425)) + ")"); });
  acc.co2 += dt * sm.Resp * 9; while (acc.co2 >= 1) { acc.co2--; const p = free(co2); if (p) emit(p, rnd(670, 790), 222, rnd(-6, 6), -rnd(22, 34), 0); }
  co2.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6 || p.y < 58) kill(p); });
  acc.acid += dt * sm.Acid * 8; while (acc.acid >= 1) { acc.acid--; const p = free(acid); if (p) emit(p, rnd(300, 560), rnd(300, 380), rnd(-8, 8), rnd(-6, 6), 0); }
  acid.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 255, 595); p.y = clamp(p.y, 285, 410); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.t > 5) kill(p); });
  acc.heat += dt * sm.Heat * 6; while (acc.heat >= 1) { acc.heat--; const p = free(heatp); if (p) emit(p, rnd(330, 530), 320, rnd(-4, 4), -rnd(18, 28), 0); }
  heatp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8) kill(p); });
  gg.sal.set(sm.Sal, wordOf(sm.Sal, 0.28, 0.58, ["low", "raised", "high"])); gg.resp.set(sm.Resp, wordOf(sm.Resp, 0.3, 0.6, ["near normal", "fast", "very fast"])); gg.acid.set(sm.Acid, wordOf(sm.Acid, 0.32, 0.6, ["low", "raised", "high"])); gg.heat.set(sm.Heat, wordOf(sm.Heat, 0.3, 0.6, ["normal", "warm", "overheated"])); gg.brain.set(sm.Brain, wordOf(sm.Brain, 0.22, 0.5, ["low", "raised", "high"]));
}
run({ init, step });
