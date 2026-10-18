/* Paracetamol scene: central action, peripheral tissue, liver NAPQI and NAC rescue, gauges. */
const layers = { parts: $("parts"), over: $("over"), panel: $("panel"), heps: $("heps") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const para = pool(26, () => mk("circle", { class: "sc-p p-para", r: 3.2 }, layers.parts));
const pg = pool(14, () => mk("circle", { class: "sc-p p-pg", r: 2.6 }, layers.parts));
const sero = pool(16, () => mk("circle", { class: "sc-p p-sero", r: 2.4 }, layers.parts));
const nap = pool(22, () => mk("path", { class: "sc-p p-nap", d: "M0 -3.4L3.4 0L0 3.4L-3.4 0Z" }, layers.parts));
const gshp = pool(18, () => mk("circle", { class: "sc-p p-gsh", r: 2.4 }, layers.parts));
const nacp = pool(14, () => mk("circle", { class: "sc-p p-nacp", r: 2.6 }, layers.parts));
const charp = pool(10, () => mk("circle", { class: "sc-p p-charp", r: 3 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* hepatocytes with an injury overlay each */
const heps = [[520, 345, 15], [560, 340, 13], [595, 350, 15], [525, 385, 14], [565, 390, 15], [600, 385, 13]].map(([x, y, r], i) => {
  const g = cell(layers.heps, { cls: "hep", r, nuc: 0.4, seed: i * 3 + 1, wob: 0.1 });
  const inj = mk("circle", { class: "pm-inj", r: (r * 0.62).toFixed(1), opacity: "0" }, g);
  return { g, x, y, inj, ph: i * 1.7 };
});
const gg = {};
let charPill = null, nacPill = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["pain", "Pain", "g-pain", "Residual pain after central action and the descending block. Rises when less drug is absorbed."],
    ["fever", "Fever", "g-fever", "Residual fever after the hypothalamic set point is lowered. Returns when absorption falls."],
    ["sw", "Swelling", "g-sw", "Swelling at the inflamed site. It changes little because the peripheral anti-inflammatory effect is minimal."],
    ["nap", "Free NAPQI", "g-nap", "Reactive NAPQI not yet detoxified by glutathione. High levels injure liver cells."],
    ["gsh", "Glutathione", "g-gsh", "The liver glutathione store that detoxifies NAPQI. Overdose depletes it and N-acetylcysteine restores it."],
    ["inj", "Liver injury", "g-inj", "Hepatocyte injury from free NAPQI. Grows as glutathione runs out and eases with rescue."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Hypothalamus", 115, 114, 115, 96, "Hypothalamus: the brain thermostat. Paracetamol lowers the raised set point in fever, so heat is lost and temperature falls.");
  pill(ox, "Central COX", 250, 116, 250, 96, "Central cyclo-oxygenase: paracetamol weakly blocks this enzyme in the brain, which eases pain and fever with little effect elsewhere.");
  pill(ox, "AM404", 232, 215, 160, 240, "AM404: a product of paracetamol that acts through the cannabinoid system and adds to pain relief.");
  pill(ox, "Pain blocked", 350, 252, 350, 268, "Descending pathways using serotonin travel down the cord and dampen incoming pain. The gate closes as central action rises.");
  pill(ox, "Weak COX effect", 730, 116, 730, 96, "Peripheral cyclo-oxygenase is only weakly blocked, so local signals at the injury site fall little.");
  pill(ox, "Swelling", 580, 117, 580, 96, "Swelling at the inflamed site changes little, because the peripheral anti-inflammatory effect is minimal.");
  pill(ox, "Pain signal", 845, 202, 845, 240, "Pain signals travel along the nerve toward the brain. Central action and the descending block reduce what is felt.");
  pill(ox, "Gut", 80, 337, 80, 300, "Paracetamol is absorbed from the gut into the blood.");
  pill(ox, "Taken drug", 170, 341, 170, 300, "Paracetamol taken in: most follows a safe path, and a small part becomes NAPQI.");
  pill(ox, "Safe path", 300, 312, 300, 300, "Safe metabolism: most of the drug is cleared by harmless routes.");
  pill(ox, "Liver cells", 555, 330, 555, 292, "Hepatocytes: liver cells injured by free NAPQI when glutathione runs out.");
  pill(ox, "Glutathione", 735, 308, 735, 292, "Glutathione tank: the liver store that detoxifies NAPQI. Overdose depletes it.");
  pill(ox, "CYP enzyme", 300, 414, 300, 426, "A liver enzyme converts a small fraction of paracetamol into the reactive product NAPQI.");
  pill(ox, "NAPQI", 430, 418, 430, 428, "NAPQI: reactive and toxic unless glutathione detoxifies it. Free NAPQI injures liver cells.");
  charPill = pill(ox, "Charcoal", 80, 393, 80, 418, "Activated charcoal in the gut binds the drug and reduces absorption when given early.");
  nacPill = pill(ox, "NAC restores", 720, 417, 720, 427, "N-acetylcysteine restores glutathione and helps detoxify NAPQI.");
  $("descPath").setAttribute("stroke-dasharray", "7 7");
}
const sm = { D: 0.45, cent: 0.9, pain: 0.31, fever: 0.29, inflam: 0.73, prod: 0.06, gsh: 0.93, freeN: 0, inj: 0, nac: 0, chr: 0 };
const acc = { para: 0, pg: 0, sero: 0, nap: 0, gsh: 0, nac: 0, char: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  sm.D = lerp(sm.D, m.D, k); sm.cent = lerp(sm.cent, m.cent, k); sm.pain = lerp(sm.pain, m.pain, k); sm.fever = lerp(sm.fever, m.fever, k);
  sm.inflam = lerp(sm.inflam, m.inflam, k); sm.prod = lerp(sm.prod, m.prod, k); sm.gsh = lerp(sm.gsh, m.gsh, k);
  sm.freeN = lerp(sm.freeN, m.freeN, k); sm.inj = lerp(sm.inj, m.inj, k); sm.nac = lerp(sm.nac, m.nac, k); sm.chr = lerp(sm.chr, m.chr, k);
  /* static nodes follow the model */
  $("hypoGlow").setAttribute("opacity", (0.15 + 0.75 * sm.cent).toFixed(2));
  $("am404Glow").setAttribute("opacity", (0.1 + 0.7 * sm.cent).toFixed(2));
  $("liverGlow").setAttribute("opacity", (sm.inj * 0.9).toFixed(2));
  $("charDots").setAttribute("opacity", sm.chr.toFixed(2));
  $("descPath").setAttribute("stroke-dashoffset", f1(-(tm / 50) % 14));
  const gs = 1 + 0.1 * sm.cent * Math.sin(tm / 350);
  $("painGate").setAttribute("transform", "translate(350 245) scale(" + gs.toFixed(3) + ") translate(-350 -245)");
  const ns = 1 + 0.2 * sm.freeN * Math.sin(tm / 300) + 0.03 * Math.sin(tm / 900);
  $("napqiNode").setAttribute("transform", "translate(430 395) scale(" + ns.toFixed(3) + ") translate(-430 -395)");
  const nacS = 1 + 0.1 * sm.nac * Math.sin(tm / 320);
  $("nacNode").setAttribute("transform", "translate(720 395) scale(" + nacS.toFixed(3) + ") translate(-720 -395)");
  $("thermoNeedle").setAttribute("transform", "rotate(" + f1(-50 + 100 * sm.fever) + " 115 150)");
  const gf = $("gshFill");
  gf.setAttribute("width", f1(178 * sm.gsh));
  gf.style.fill = sm.gsh < 0.3 ? "#e5484d" : sm.gsh < 0.65 ? "#e9b84a" : "";
  charPill.style.opacity = sm.chr.toFixed(2); nacPill.style.opacity = sm.nac.toFixed(2);
  heps.forEach((hp) => { place(hp.g, hp.x + Math.sin(tm / 1500 + hp.ph) * 1.5, hp.y + Math.cos(tm / 1800 + hp.ph) * 1.5, 0, 1); hp.inj.setAttribute("opacity", sm.inj.toFixed(2)); });
  /* drug from the gut: most to the liver, some up to the brain */
  acc.para += dt * (1 + sm.D * 9); while (acc.para >= 1) { acc.para--; const p = free(para); if (p) { const brain = Math.random() < 0.3; emit(p, 170 + rnd(-10, 10), 365 + rnd(-10, 10), 0, 0, brain ? 1 : 0); if (brain) { p.vx = rnd(-10, 25); p.vy = -rnd(40, 70); } else { p.vx = rnd(30, 55); p.vy = rnd(-14, 6); } } }
  para.forEach((p) => { if (!p.on) return; p.t += dt; if (p.k === 1) { p.vx += (250 - p.x) * dt * 0.8; if (p.y < 160) { kill(p); return; } } else if (p.x > 290) { kill(p); return; }
    p.x += p.vx * dt; p.y += p.vy * dt; if (p.t > 8) { kill(p); return; }
    p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 60, 425)) + ")"); });
  /* peripheral signals linger at the tissue */
  acc.pg += dt * (1 + sm.inflam * 7); while (acc.pg >= 1) { acc.pg--; const p = free(pg); if (p) emit(p, 580 + rnd(-58, 58), 165 + rnd(-30, 30), rnd(-6, 14), rnd(-16, -4), 0); }
  pg.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 500, 660)) + " " + f1(clamp(p.y, 100, 220)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 4).toFixed(2)); if (p.t > 4) kill(p); });
  /* descending inhibition pulses */
  acc.sero += dt * sm.cent * 10; while (acc.sero >= 1) { acc.sero--; const p = free(sero); if (p) emit(p, 350 + rnd(-4, 4), 175, rnd(-3, 3), rnd(40, 60), 0); }
  sero.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 236) kill(p); });
  /* NAPQI from CYP toward liver cells, detoxified faster with NAC */
  acc.nap += dt * (0.5 + sm.prod * 12); while (acc.nap >= 1) { acc.nap--; const p = free(nap); if (p) emit(p, 305, 395 + rnd(-8, 8), rnd(40, 70), rnd(-12, 12), 0); }
  const napLife = 6 - 4 * sm.nac;
  nap.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 280, 620)) + " " + f1(clamp(p.y, 320, 415)) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / napLife).toFixed(2)); if (p.t > napLife || p.x > 505) kill(p); });
  /* glutathione drift from the tank to the cells */
  acc.gsh += dt * (0.5 + sm.gsh * 7); while (acc.gsh >= 1) { acc.gsh--; const p = free(gshp); if (p) emit(p, 735 + rnd(-80, 80), 330 + rnd(-8, 12), -rnd(25, 45), rnd(-6, 6), 0); }
  gshp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 500, 820)) + " " + f1(clamp(p.y, 310, 360)) + ")"); if (p.t > 5 || p.x < 615) kill(p); });
  /* NAC particles from the NAC node to the cells */
  acc.nac += dt * sm.nac * 10; while (acc.nac >= 1) { acc.nac--; const p = free(nacp); if (p) emit(p, 720 + rnd(-8, 8), 395 + rnd(-8, 8), -rnd(40, 60), rnd(-10, 10), 0); }
  nacp.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 600, 740)) + " " + f1(clamp(p.y, 360, 420)) + ")"); if (p.x < 610) kill(p); });
  /* charcoal grains held in the gut */
  acc.char += dt * sm.chr * 8; while (acc.char >= 1) { acc.char--; const p = free(charp); if (p) emit(p, 80 + rnd(-16, 16), 365 + rnd(-16, 16), rnd(-6, 6), rnd(-6, 6), 0); }
  charp.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt + rnd(-8, 8) * dt, 56, 104); p.y = clamp(p.y + p.vy * dt + rnd(-8, 8) * dt, 342, 388); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3) kill(p); });
  /* gauges */
  gg.pain.set(sm.pain, wordOf(sm.pain, 0.35, 0.62, ["eased", "partly eased", "still present"]));
  gg.fever.set(sm.fever, wordOf(sm.fever, 0.35, 0.6, ["down", "settling", "still high"]));
  gg.sw.set(sm.inflam, wordOf(sm.inflam, 0.4, 0.65, ["less", "some", "stays"]));
  gg.nap.set(sm.freeN, wordOf(sm.freeN, 0.12, 0.38, ["none", "some", "high"]));
  gg.gsh.set(sm.gsh, wordOf(sm.gsh, 0.3, 0.65, ["depleted", "low", "ample"]));
  gg.inj.set(sm.inj, wordOf(sm.inj, 0.2, 0.55, ["none", "some", "widespread"]));
}
run({ init, step });
