/* Pituitary scene: hypothalamus, stalk, gland and adenoma, optic chiasm, six hormone nodes and gauges. */
const layers = { cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel"), aden: $("adenoma"), glandG: $("glandG"), chiasm: $("chiasm"), vfL: $("vfLs"), vfR: $("vfRs") };
const NODES = [
  { x: 110, ab: "GH", key: "gh", cls: "hn0", pcls: "p-h0", tgt: "growth" },
  { x: 260, ab: "ACTH", key: "acth", cls: "hn1", pcls: "p-h1", tgt: "adrenal" },
  { x: 410, ab: "TSH", key: "tsh", cls: "hn2", pcls: "p-h2", tgt: "thyroid" },
  { x: 560, ab: "FSH", key: "fsh", cls: "hn3", pcls: "p-h3", tgt: "gonads" },
  { x: 710, ab: "LH", key: "lh", cls: "hn4", pcls: "p-h4", tgt: "gonads" },
  { x: 860, ab: "PRL", key: "prl", cls: "hn5", pcls: "p-h5", tgt: "milk" },
];
const NY = 350;
const nodes = [];
function initNodes() {
  NODES.forEach((n, i) => {
    const g = mk("g", {}, layers.cells);
    const c = mk("circle", { class: "pit-node " + n.cls, cx: n.x, cy: NY, r: 27 }, g);
    const t = mk("text", { class: "pit-abbr", x: n.x, y: NY + 4, "text-anchor": "middle" }, g); t.textContent = n.ab;
    const tg = mk("text", { class: "pit-tgt", x: n.x, y: NY + 44, "text-anchor": "middle" }, g); tg.textContent = n.tgt;
    mk("path", { class: "pit-field", d: "M480 268 L" + n.x + " " + (NY - 30) }, layers.cells);
    nodes.push({ g, c, i, key: n.key, v: 0.4 });
  });
}
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const horm = pool(72, () => mk("circle", { class: "sc-p p-h0", r: 2.6 }, layers.parts));
const rel = pool(16, () => mk("circle", { class: "sc-p p-rel", r: 2.4 }, layers.parts));
const daP = pool(10, () => mk("circle", { class: "sc-p p-da", r: 3 }, layers.parts));
const saP = pool(10, () => mk("circle", { class: "sc-p p-sa", r: 3 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [140, 340, 540, 740];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["prl", "Prolactin", "g-prl", "Prolactin from the anterior pituitary. Raised by a prolactinoma, lowered by a dopamine agonist."], ["gh", "Growth hormone", "g-gh", "Growth hormone. Raised in acromegaly, lowered by a somatostatin analogue or surgery."], ["oth", "Other hormones", "g-oth", "ACTH, TSH, FSH and LH together. Low in hypopituitarism and when a large adenoma squeezes the gland."], ["mass", "Mass effect", "g-mass", "Pressure from an adenoma on nearby structures, above all the optic chiasm."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Optic chiasm", 480, 92, 640, 78, "Optic chiasm: where the nasal fibres from each eye cross. An adenoma growing upward presses here first.");
  pill(ox, "Hypothalamus", 538, 138, 640, 140, "Hypothalamus: controls the pituitary through releasing and inhibiting signals sent down the stalk, including dopamine holding prolactin back.");
  pill(ox, "Pituitary gland", 390, 228, 320, 205, "Anterior pituitary gland sitting in its bony pocket below the hypothalamus. It releases GH, ACTH, TSH, FSH, LH and prolactin.");
  pill(ox, "Adenoma", 508, 240, 320, 267, "Adenoma: a benign pituitary tumour. It can secrete prolactin or growth hormone and can press on the chiasm and the normal gland.");
  pill(ox, "Outer half lost", 848, 150, 848, 192, "Bitemporal hemianopia: the outer half of vision is lost in both eyes when the crossing fibres in the chiasm are pressed.");
  pill(ox, "Growth hormone", 110, 323, 110, 300, "Growth hormone (GH): drives growth and metabolism. Excess in adults causes acromegaly.");
  pill(ox, "ACTH adrenal", 260, 323, 260, 300, "ACTH: tells the adrenal glands to make cortisol.");
  pill(ox, "TSH thyroid", 410, 323, 410, 300, "TSH: tells the thyroid to make thyroid hormone.");
  pill(ox, "FSH gonads", 560, 323, 560, 300, "FSH: acts on the ovaries and testes for fertility.");
  pill(ox, "LH gonads", 710, 323, 710, 300, "LH: acts on the ovaries and testes for fertility and sex hormones.");
  pill(ox, "Prolactin", 860, 323, 860, 300, "Prolactin: drives milk production. Excess can stop periods and fertility by suppressing FSH and LH.");
  const d1 = pill(ox, "Dopamine agonist", 400, 235, 150, 195, "Dopamine agonist: copies dopamine, lowers prolactin and shrinks a prolactinoma."); d1.setAttribute("id", "da-pill");
  const d2 = pill(ox, "Somatostatin analogue", 400, 245, 150, 230, "Somatostatin analogue: lowers growth hormone release in acromegaly."); d2.setAttribute("id", "sa-pill");
  const d3 = pill(ox, "Surgery", 400, 255, 150, 265, "Surgery: removes the adenoma through the nose and relieves pressure on the chiasm."); d3.setAttribute("id", "sx-pill");
}
const sm = { prl: 0.5, gh: 0.4, oth: 0.3, mass: 0.5, da: 0, sa: 0, sx: 0, gland: 1 };
const acc = { horm: 0, rel: 0, da: 0, sa: 0 };
function init() { initNodes(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.prl = lerp(sm.prl, m.prl, k2); sm.gh = lerp(sm.gh, m.gh, k2); sm.oth = lerp(sm.oth, m.oth, k2);
  sm.mass = lerp(sm.mass, m.mass, k1); sm.da = lerp(sm.da, m.da, k1); sm.sa = lerp(sm.sa, m.sa, k1); sm.sx = lerp(sm.sx, m.sx, k1); sm.gland = lerp(sm.gland, m.gland, k2);
  nodes.forEach((n) => { n.v = lerp(n.v, m[n.key], k2); const s = 0.82 + 0.36 * n.v; n.c.setAttribute("r", f1(27 * s)); n.c.style.opacity = (0.45 + 0.55 * n.v).toFixed(2); });
  layers.aden.setAttribute("r", f1(6 + 30 * sm.mass));
  layers.aden.style.opacity = (0.25 + 0.75 * clamp((sm.mass - 0.08) / 0.6)).toFixed(2);
  layers.glandG.setAttribute("transform", "translate(480 228) scale(" + sm.gland.toFixed(3) + ") translate(-480 -228)");
  layers.chiasm.setAttribute("transform", "translate(0 " + f1(-7 * sm.mass) + ")");
  const shade = clamp((sm.mass - 0.28) * 1.5);
  layers.vfL.setAttribute("opacity", shade.toFixed(2)); layers.vfR.setAttribute("opacity", shade.toFixed(2));
  $("da-pill").style.opacity = sm.da.toFixed(2); $("sa-pill").style.opacity = sm.sa.toFixed(2); $("sx-pill").style.opacity = sm.sx.toFixed(2);
  /* hypothalamic signals down the stalk */
  acc.rel += dt * (0.4 + sm.oth) * 3;
  while (acc.rel >= 1) { acc.rel--; const p = free(rel); if (p) emit(p, 480 + rnd(-3, 3), 160, 0, 42, 0); }
  rel.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x += Math.sin(tm / 300 + p.y) * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 205) kill(p); });
  /* hormone particles from the gland to each hormone node */
  acc.horm += dt * 16 * (0.25 + sm.prl + sm.gh + sm.oth) / 1.6;
  while (acc.horm >= 1) { acc.horm--; const idx = Math.floor(Math.random() * NODES.length), nd = NODES[idx]; if (Math.random() > 0.15 + nodes[idx].v) continue; const p = free(horm); if (p) { p.e.setAttribute("class", "sc-p " + nd.pcls); emit(p, 480 + rnd(-24, 24), 268, nd.x, NY - 30, idx); } }
  horm.forEach((p) => { if (!p.on) return; p.t += dt * 0.55; const tx = p.vx, ty = p.vy, x = lerp(480, tx, p.t), y = lerp(268, ty, p.t) - Math.sin(p.t * 3.14) * 14; p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); if (p.t >= 1) kill(p); });
  /* treatment particles arriving at the gland */
  acc.da += dt * sm.da * 5; while (acc.da >= 1) { acc.da--; const p = free(daP); if (p) emit(p, 210, 208, 0, 0, 0); }
  daP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (462 - p.x) * dt * 1.4 + 22 * dt; p.y += (232 - p.y) * dt * 1.4; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.2) kill(p); });
  acc.sa += dt * sm.sa * 5; while (acc.sa >= 1) { acc.sa--; const p = free(saP); if (p) emit(p, 210, 238, 0, 0, 0); }
  saP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (462 - p.x) * dt * 1.4 + 22 * dt; p.y += (232 - p.y) * dt * 1.4; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.2) kill(p); });
  gg.prl.set(sm.prl, wordOf(sm.prl, 0.35, 0.65, ["low", "normal", "high"]));
  gg.gh.set(sm.gh, wordOf(sm.gh, 0.35, 0.65, ["low", "normal", "high"]));
  gg.oth.set(sm.oth, wordOf(sm.oth, 0.3, 0.6, ["low", "reduced", "normal"]));
  gg.mass.set(sm.mass, wordOf(sm.mass, 0.3, 0.55, ["none", "mild", "marked"]));
}
run({ init, step });
