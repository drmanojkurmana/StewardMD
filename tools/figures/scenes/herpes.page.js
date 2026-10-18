/* Herpes scene: skin DNA copying, fibre transport both ways, latency in the ganglion soma, reactivation to skin vesicles.
 * Aciclovir caps the growing viral DNA chain: blockers dock on chain tips, chains go quiet, and everything downstream fades. */
const LY = { skin: $("skin"), axon: $("axon"), gang: $("gang"), gangSlot: $("gangSlot"), derm: $("derm"), trig: $("trig"), parts: $("parts"), over: $("over"), panel: $("panel") };
let axonTrack = null, gangO = null, nucPos = [790, 240], capEl = null, capKey = -1, tipIx = 0, ph = 0;
const tips = [[238, 170], [238, 225], [238, 280]];
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: Math.random() }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* skin epithelium with an infection glow, cells, surface vesicles and three viral DNA chains */
mk("rect", { class: "hv-skin", x: 40, y: 110, width: 220, height: 220, rx: 14 }, LY.skin);
const glow = mk("ellipse", { class: "hv-inf", cx: 150, cy: 225, rx: 92, ry: 96, opacity: 0 }, LY.skin);
const epiCells = [];
[150, 200, 250, 300].forEach((y) => [75, 125, 175, 225].forEach((x) => { if (x === 225 && y === 150) return; const g = cell(LY.skin, { cls: "epi", r: 19, nuc: 0.35, seed: x + y, wob: 0.08 }); place(g, x, y, 0, 1); epiCells.push(g); }));
mk("path", { class: "hv-basal", d: "M45 315L255 315" }, LY.skin);
const vesXs = [110, 150, 190, 230];
const vesicles = vesXs.map((x, i) => { const g = mk("g", {}, LY.skin); mk("circle", { class: "hv-ves", r: 11 - (i % 2) * 2 }, g); mk("circle", { class: "hv-ves", cx: 7, cy: 4, r: 6 }, g); place(g, x, 108, 0, 0.1); return g; });
/* one DNA chain per row: backbone, rungs that light up in sequence while copying, growing tip */
const rungXs = [80, 104, 128, 152, 176, 200, 224];
const chains = tips.map(([tx, ty]) => {
  const g = mk("g", { class: "dna" }, LY.skin);
  mk("path", { class: "dna-bb", d: "M62 " + ty + "L238 " + ty }, g);
  const rgs = rungXs.map((x) => mk("path", { class: "dna-rg", d: "M" + x + " " + (ty - 7) + "L" + x + " " + (ty + 7) }, g));
  const tip = mk("circle", { class: "dna-tip", cx: tx, cy: ty, r: 4.5 }, g);
  return { g, rgs, tip };
});

/* nerve fibre with myelin segments, meeting the ganglion fibre stub */
mk("rect", { class: "hv-axon", x: 260, y: 224, width: 408, height: 32, rx: 16 }, LY.axon);
mk("path", { class: "hv-chain", d: "M268 240L662 240" }, LY.axon);
[300, 400, 500, 600].forEach((x) => mk("rect", { class: "hv-myel", x, y: 224, width: 46, height: 32, rx: 15 }, LY.axon));

/* ganglion as real anatomy: capsule, fibre stubs, soma with nucleus, satellite glia around it */
gangO = organ(LY.gangSlot, "ganglion", 790, 240, 230, {});
nucPos = gangO.ports.nucleus;
axonTrack = track([[268, 240], gangO.ports.in]);
[[700, 175], [880, 175], [700, 305], [880, 305], [790, 150]].forEach(([x, y], i) => { const g = cell(LY.gang, { cls: "sat", r: 15, nuc: 0.3, seed: i + 7, wob: 0.12 }); place(g, x, y, 0, 1); });
const latDots = [[-10, -6], [8, -10], [0, 4], [-6, 12], [12, 8], [2, -2]].map(([dx, dy]) => mk("circle", { class: "hv-lat", cx: nucPos[0] + dx, cy: nucPos[1] + dy, r: 3.2 }, LY.gang));

/* dermatome strip (zoster concept) */
mk("rect", { class: "hv-derm", x: 40, y: 356, width: 340, height: 48, rx: 12 }, LY.derm);
const dermOn = mk("rect", { class: "hv-derm hv-derm-on", x: 40, y: 356, width: 340, height: 48, rx: 12, opacity: 0 }, LY.derm);
const dermDots = [90, 135, 180, 225, 270, 315].map((x) => mk("circle", { class: "hv-ves", cx: x, cy: 389, r: 5 }, LY.derm));

/* triggers, only present on reactivation */
const trigG = mk("g", { class: "hot", "data-info": "Wake up signals: stress, fever, ultraviolet light and low immunity can wake the resting genome and send new virus back down the fibre.", opacity: 0, "pointer-events": "none" }, LY.trig);
[[360, 76, 104, "stress"], [478, 76, 148, "low immunity"]].forEach(([x, y, w, txt]) => { mk("rect", { class: "hv-trig", x, y, width: w, height: 28, rx: 8 }, trigG); const t = mk("text", { class: "sc-lab", x: x + w / 2, y: y + 18, "text-anchor": "middle" }, trigG); t.textContent = txt; });

/* particles */
const axonVirus = mkPool(24, () => mk("circle", { class: "sc-p p-virus", r: 4 }, LY.parts));
axonVirus.forEach((p) => { p.u = Math.random(); p.on = true; });
const skinVirus = mkPool(20, () => mk("circle", { class: "sc-p p-virus2", r: 3 }, LY.parts));
const acic = mkPool(9, () => { const g = mk("g", {}, LY.parts); mk("rect", { class: "sc-p p-acic", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); return g; });
let acAcc = 0;

function capText(l, d) {
  if (d === 1 && l === 0) return "Aciclovir caps the viral DNA chain. Copying stops and fewer blisters form.";
  if (d === 1 && l === 1) return "Aciclovir cannot clear resting DNA. The genome waits in the nerve.";
  if (d === 1) return "Aciclovir caps the chain again. Spread slows but resting DNA stays.";
  if (l === 0) return "No treatment. Virus copies its DNA in skin and travels up the nerve.";
  if (l === 1) return "No treatment. Viral DNA rests quietly in the nerve body.";
  return "No treatment. Virus wakes, travels back down and blisters the skin.";
}

const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The infection";
  [["rep", "Replication", "g-bad", "How actively the virus copies its DNA in skin cells. Aciclovir caps the chain and lowers this."], ["ves", "Vesicles", "g-fl", "Grouped fluid filled blisters where virus copying in the skin reaches the surface."], ["lat", "Latent DNA", "g-cyt", "Viral DNA resting in the nerve cell nucleus. It stays even when treatment stops copying."], ["spr", "Axonal spread", "g-good", "Movement along the nerve fibre: up to the nerve body in first infection, back down to the skin on return."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 170 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
  pill(LY.over, "Skin", 70, 320, 90, 80, "Skin or mucosa: the first site where the virus copies itself, and where blisters return.");
  pill(LY.over, "Vesicles", 248, 122, 300, 110, "Grouped blisters where virus copying in the skin reaches the surface.");
  pill(LY.over, "Viral DNA", 150, 225, 150, 140, "Viral DNA chain being copied in an infected skin cell. Aciclovir caps the chain so copying stops.");
  pill(LY.over, "Axon", 560, 244, 560, 180, "The sensory nerve fibre. New virus travels up it to the nerve body, and back down when it wakes.");
  pill(LY.over, "Neuron", 840, 220, 862, 110, "Sensory nerve cell body in the ganglion. Its nucleus shelters the resting viral genome for life.");
  pill(LY.over, "Latent DNA", 800, 252, 790, 392, "Resting viral DNA in the nucleus. Treatment stops copying but does not clear this store.");
  pill(LY.over, "Dermatome", 330, 382, 452, 385, "One dermatome: the band of skin served by this ganglion. Shingles blisters stay in one band.");
  capEl = mk("text", { class: "hv-cap", x: 30, y: 428 }, LY.over); capEl.textContent = capText(0, 0);
}
const sm = { Rep: 0.8, Ves: 0.6, Lat: 0.3, Spr: 0.7, ac: 0, react: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 2.2);
  sm.Rep = lerp(sm.Rep, m.Rep, k); sm.Ves = lerp(sm.Ves, m.Ves, k); sm.Lat = lerp(sm.Lat, m.Lat, k); sm.Spr = lerp(sm.Spr, m.Spr, k); sm.ac = lerp(sm.ac, m.ac, k);
  const reactT = m.level === 2 ? 1 : 0; sm.react = lerp(sm.react, reactT, k);
  trigG.setAttribute("opacity", sm.react.toFixed(2));
  trigG.setAttribute("pointer-events", sm.react > 0.3 ? "auto" : "none");
  glow.setAttribute("opacity", (0.04 + 0.3 * sm.Rep).toFixed(2));
  vesicles.forEach((g, i) => { const s = clamp(sm.Ves * 1.1 - i * 0.06); place(g, vesXs[i], 108, 0, Math.max(0.08, s)); g.setAttribute("opacity", s > 0.06 ? "1" : "0"); });
  latDots.forEach((d) => { d.setAttribute("opacity", clamp(sm.Lat * 1.2).toFixed(2)); d.setAttribute("r", (2 + 2 * sm.Lat).toFixed(1)); });
  dermOn.setAttribute("opacity", (sm.react * 0.9).toFixed(2));
  dermDots.forEach((d) => d.setAttribute("opacity", (sm.react * clamp(sm.Ves + 0.25)).toFixed(2)));
  /* DNA chains: rungs light up in sequence while copying; drug caps the chain so it goes quiet and grey */
  const capped = sm.ac > 0.35;
  ph += dt * (1 - sm.ac) * clamp(sm.Rep * 2.5, 0.08, 1) * 3;
  chains.forEach((c, ci) => {
    c.g.setAttribute("class", capped ? "dna off" : "dna");
    c.rgs.forEach((r, i) => { const wv = Math.sin(ph - i * 0.9 + ci * 2.1); r.setAttribute("opacity", (0.2 + 0.7 * clamp(sm.Rep * 1.6) * wv * wv).toFixed(2)); });
    c.tip.setAttribute("r", (3 + 2.5 * clamp(sm.Rep * 1.4) * (0.7 + 0.3 * Math.sin(tm / 240))).toFixed(1));
  });
  /* fibre transport: direction depends on stage, pace and brightness fall under treatment */
  const dir = m.level === 0 ? 1 : m.level === 2 ? -1 : 0;
  axonVirus.forEach((p, i) => {
    if (!dir || sm.Spr < 0.08) { p.e.setAttribute("opacity", "0"); return; }
    p.u += dir * dt * 0.14 * (0.35 + sm.Spr); if (p.u > 1) p.u -= 1; if (p.u < 0) p.u += 1;
    const pos = axonTrack.at(p.u); place(p.e, pos.x, pos.y + Math.sin(tm / 300 + i) * 5, 0, 1); p.e.setAttribute("opacity", clamp(sm.Spr * 1.4).toFixed(2));
  });
  /* skin copying dots */
  const want = Math.round(sm.Rep * skinVirus.length);
  skinVirus.forEach((p, i) => {
    if (i >= want) { if (p.on) kill(p); return; }
    if (!p.on) emit(p, rnd(55, 245), rnd(125, 315), rnd(-8, 8), rnd(-8, 8), 0);
    p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < 52 || p.x > 248) p.vx *= -1; if (p.y < 122 || p.y > 318) p.vy *= -1; p.x = clamp(p.x, 52, 248); p.y = clamp(p.y, 122, 318);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
  });
  /* aciclovir blockers fly to the chain tips and sit on them while copying runs; they leave when it does not */
  const dock = capped && sm.Rep >= 0.08;
  if (dock) { acAcc += dt * sm.ac * (2 + sm.Rep * 4); while (acAcc >= 1) { acAcc--; const p = freeP(acic); if (p) emit(p, rnd(300, 350), rnd(200, 280), 0, 0, tipIx++ % 3); } }
  else acAcc = 0;
  acic.forEach((p, i) => {
    if (!p.on) return;
    const tip = tips[p.k % 3];
    if (dock) {
      p.t = 0; p.x += (tip[0] - p.x) * Math.min(1, dt * 3); p.y += (tip[1] - p.y) * Math.min(1, dt * 3) + Math.sin(tm / 350 + i * 2) * 0.3;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 18 + i * 40) + ")");
      p.e.setAttribute("opacity", "1");
    } else {
      p.t += dt; p.x += Math.sin(tm / 400 + i) * 10 * dt; p.y += 26 * dt;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 18 + i * 40) + ")");
      p.e.setAttribute("opacity", clamp(1 - p.t / 1.2).toFixed(2)); if (p.t > 1.2) kill(p);
    }
  });
  gg.rep.set(sm.Rep, wordOf(sm.Rep, 0.2, 0.55, ["quiet", "active", "high"])); gg.ves.set(sm.Ves, wordOf(sm.Ves, 0.15, 0.5, ["none", "few", "many"]));
  gg.lat.set(sm.Lat, wordOf(sm.Lat, 0.4, 0.75, ["seeding", "present", "established"])); gg.spr.set(sm.Spr, wordOf(sm.Spr, 0.2, 0.55, ["still", "moving", "spreading"]));
  const key = m.level * 2 + drug;
  if (key !== capKey) { capKey = key; const t = capText(m.level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
