/* Hydroxyurea scene: RNR plugged in the tumour cell, S stage stall, HbF rise, and the harmed organs. */
const L = { tum: $("tumSlot"), org: $("orgSlot"), parts: $("parts"), over: $("over"), panel: $("panel") };
const TC = [240, 250], TR = 100;
const sm = { K: 0, Ms: 0, Ul: 0, Sk: 0, Ca: 0, Pg: 0, Hb: 0, on: 0, pro: 0, a: 0.6 };
const acc = { dntp: 0, hu: 0, hbf: 0, bleb: 0, spk: 0, care: 0 };
let tumG, dauG, forkG, zipE, plugE, blockE, sickE, roundG, shieldM, shieldS, warnE, blotchE, gg = {}, capEl = null, capKey = "";
let marCells = [], macroE = [], ulcE = [], pigE = [], bandE = [], soreM = [];
let trHu, trDntp, dntp, hu, hbf, bleb, spk, care, zipU = 0;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d, l) {
  if (d === 2) return ["Blood checks and skin care start with the drug. Tumour kill goes on while counts are watched.", "Marrow and skin are guarded while the tumour keeps dying. Fetal haemoglobin still rises.", "Even late on, checks guard counts and care guards skin. Pregnancy risk stays high throughout."];
  if (d === 1) return ["Hydroxyurea plugs the enzyme. Building blocks run out and tumour DNA stalls in S stage.", "The tumour dies back while marrow, skin, mouth and pregnancy suffer. Fetal haemoglobin rises.", "Late courses kill more tumour but ulcers, skin change and skin cancer build."];
  return ["No treatment. The enzyme feeds DNA building blocks and the tumour copies its DNA.", "No treatment. The tumour keeps dividing and nothing else changes.", "No treatment. The tumour grows on, with no benefit and no harm."];
}
function init() {
  tumG = cell(L.tum, { cls: "tum", r: TR, nuc: 0.55, seed: 3, wob: 0.08, x: TC[0], y: TC[1] });
  /* replication fork: two arms with rungs that stall */
  forkG = mk("g", {}, tumG);
  mk("path", { class: "oc-dna", d: "M0 -18L-28 72M0 -18L28 72" }, forkG);
  mk("path", { class: "oc-rung", d: "M-7 2L7 2M-13 22L13 22M-19 42L19 42M-24 58L24 58" }, forkG);
  forkG.setAttribute("transform", "translate(0 10)");
  zipE = mk("circle", { class: "sc-p p-dntp", r: 4 }, L.tum);
  /* RNR enzyme with its pocket, plugged by drug */
  const ez = mk("g", {}, L.tum);
  mk("rect", { class: "oc-enz", x: 200, y: 160, width: 80, height: 30, rx: 9 }, ez);
  mk("ellipse", { class: "oc-pock", cx: 240, cy: 162, rx: 11, ry: 5.5 }, ez);
  const ezT = mk("text", { class: "sc-lab", x: 240, y: 184, "text-anchor": "middle" }, ez); ezT.textContent = "RNR";
  plugE = mk("path", { class: "oc-plug", d: "M240 151L251 162L240 173L229 162Z", opacity: "0" }, ez);
  blockE = mk("rect", { class: "oc-block", x: 196, y: 156, width: 88, height: 38, rx: 12, opacity: "0" }, ez);
  const bT = mk("text", { class: "sc-lab", x: 292, y: 200 }, L.tum); bT.textContent = "blocks";
  const dT = mk("text", { class: "sc-lab", x: 258, y: 222 }, L.tum); dT.textContent = "building blocks";
  /* S stage badge */
  const sb = mk("g", {}, L.tum);
  mk("circle", { class: "oc-sbadge", cx: 178, cy: 292, r: 13 }, sb);
  const sbT = mk("text", { class: "sc-lab", x: 178, y: 297, "text-anchor": "middle" }, sb); sbT.textContent = "S";
  const sb2 = mk("text", { class: "sc-lab", x: 178, y: 318, "text-anchor": "middle" }, sb); sb2.textContent = "S stage";
  dauG = cell(L.tum, { cls: "tum", r: 28, nuc: 0.5, seed: 5, wob: 0.1, x: 415, y: 352 });
  /* sickle cell and round cell inset for fetal haemoglobin */
  sickE = mk("path", { class: "oc-sick", d: "M258 388A26 26 0 0 0 312 404A20 20 0 0 1 262 396Z" }, L.tum);
  roundG = cell(L.tum, { cls: "rbc", r: 14, nuc: 0, seed: 8, wob: 0.1, x: 360, y: 398 });
  const sT = mk("text", { class: "sc-lab", x: 285, y: 424, "text-anchor": "middle" }, L.tum); sT.textContent = "sickle";
  const hT = mk("text", { class: "sc-lab", x: 360, y: 424, "text-anchor": "middle" }, L.tum); hT.textContent = "HbF";
  /* marrow bone with blood cells that run low, plus big macrocytes */
  const bg = mk("g", {}, L.org);
  mk("rect", { class: "oc-bone", x: 515, y: 132, width: 110, height: 88, rx: 18 }, bg);
  mk("ellipse", { class: "oc-bone", cx: 515, cy: 176, rx: 15, ry: 44 }, bg);
  mk("ellipse", { class: "oc-bone", cx: 625, cy: 176, rx: 15, ry: 44 }, bg);
  mk("rect", { class: "oc-cav", x: 530, y: 152, width: 80, height: 48, rx: 13 }, bg);
  const mpos = [[544, 166, "rbc"], [566, 161, "neut"], [588, 166, "plt"], [601, 179, "rbc"], [555, 187, "neut"], [578, 190, "plt"]];
  mpos.forEach(([x, y, cls], i) => marCells.push({ g: cell(bg, { cls, r: 7, nuc: cls === "plt" ? 0 : 0.4, seed: i + 11, wob: 0.12, x, y }), x, y }));
  [[545, 208], [572, 210], [598, 205]].forEach(([x, y], i) => macroE.push({ e: mk("ellipse", { class: "oc-macro", cx: x, cy: y, rx: 12, ry: 9, opacity: "0" }, bg) }));
  shieldM = mk("ellipse", { class: "oc-shield", cx: 570, cy: 176, rx: 66, ry: 58, opacity: "0" }, L.org);
  /* skin with ulcers, pigment shift, nails and a late cancer blotch */
  organ(L.org, "skin", 735, 175, 130, {});
  [[712, 160, 8, 5], [745, 178, 7, 5], [762, 158, 6, 4]].forEach(([x, y, rx, ry]) => ulcE.push(mk("ellipse", { class: "oc-ulc", cx: x, cy: y, rx, ry, opacity: "0" }, L.org)));
  [[700, 150], [722, 190], [748, 150], [768, 185], [730, 205], [755, 168]].forEach(([x, y]) => pigE.push(mk("circle", { class: "oc-pig", cx: x, cy: y, r: 2.6, opacity: "0" }, L.org)));
  blotchE = mk("path", { class: "oc-mel", d: blobD(9, 4, 0.25, 8), opacity: "0" }, L.org);
  blotchE.setAttribute("transform", "translate(728 200)");
  shieldS = mk("ellipse", { class: "oc-shield", cx: 735, cy: 175, rx: 76, ry: 66, opacity: "0" }, L.org);
  [688, 720, 752].forEach((x) => {
    mk("rect", { class: "oc-nail", x, y: 300, width: 26, height: 42, rx: 8 }, L.org);
    bandE.push(mk("rect", { class: "oc-band", x, y: 316, width: 26, height: 7, opacity: "0" }, L.org));
  });
  const nT = mk("text", { class: "sc-lab", x: 728, y: 356, "text-anchor": "middle" }, L.org); nT.textContent = "nails";
  /* mouth with sores */
  const mo = mk("g", {}, L.org);
  mk("ellipse", { class: "oc-lips", cx: 880, cy: 175, rx: 30, ry: 20 }, mo);
  mk("ellipse", { class: "oc-mouth", cx: 880, cy: 175, rx: 17, ry: 10 }, mo);
  [[872, 172], [885, 179], [892, 170]].forEach(([x, y]) => soreM.push(mk("circle", { class: "oc-sore", cx: x, cy: y, r: 2.6, opacity: "0" }, L.org)));
  /* uterus with a warning ring for pregnancy */
  organ(L.org, "uterus", 600, 340, 110, {});
  warnE = mk("circle", { class: "oc-warn", cx: 600, cy: 340, r: 62, opacity: "0" }, L.org);
  /* tracks and particle pools */
  trHu = track([[16, 330], [90, 315], [150, 270], [198, 180]]);
  trDntp = track([[240, 196], [240, 228]]);
  dntp = pool(10, () => mk("circle", { class: "sc-p p-dntp", r: 2.6 }, L.parts));
  hu = pool(12, () => mk("path", { class: "sc-p p-hu", d: "M0 -4L4 0L0 4L-4 0Z" }, L.parts));
  hbf = pool(10, () => mk("circle", { class: "sc-p p-hbf", r: 2.6 }, L.parts));
  bleb = pool(12, () => mk("circle", { class: "sc-p p-bleb", r: 3.4 }, L.parts));
  spk = pool(12, () => mk("circle", { class: "sc-p p-spk", r: 2.2 }, L.parts));
  care = pool(10, () => mk("path", { class: "p-care", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
  /* labels, caption, gauges */
  const ox = L.over;
  pill(ox, "Hydroxyurea", 70, 319, 80, 410, "Hydroxyurea plugs ribonucleotide reductase but cannot tell tumour from healthy dividing cells.");
  pill(ox, "RNR", 283, 175, 345, 105, "Ribonucleotide reductase turns ribonucleotides into deoxyribonucleotides for DNA. Plugged, the pool runs dry.");
  pill(ox, "Tumour DNA", 240, 305, 110, 105, "Without deoxynucleotides the tumour cell stalls in S stage, cannot copy its DNA, and dies.");
  pill(ox, "Marrow", 570, 140, 570, 95, "Marrow precursors divide fast, so without building blocks counts fall and red cells come out big and fragile.");
  pill(ox, "Skin", 735, 148, 735, 95, "Skin renews fast, so without building blocks ulcers open, nails band, colour shifts, and late change can turn cancerous.");
  pill(ox, "Mouth", 880, 160, 880, 95, "Mouth lining renews fast, so without building blocks it breaks into painful sores.");
  pill(ox, "Pregnancy", 600, 312, 520, 275, "The unborn child builds every tissue from dividing cells, so the drug can harm its growth.");
  capEl = mk("text", { class: "oc-cap", x: 30, y: 443 }, ox); capEl.textContent = capText(drug, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 448, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 470 }, P); t.textContent = "Benefit and harm together";
  [["kill", "Tumour kill", "g-good", "How much tumour dies for lack of building blocks. Rises with each course."], ["mar", "Marrow low", "g-neu", "Marrow precursors divide fast, so without building blocks counts fall. Blood checks guard them."], ["ulc", "Ulcers", "g-bad", "Skin and mouth renew fast, so without building blocks they break into sores. Skin care guards them."], ["skn", "Skin change", "g-eos", "Nail banding and pigment shift from the same failed renewal. Skin care and sun cover guard it."], ["can", "Skin cancer", "g-clot", "Long term change can turn a skin lesion cancerous. Grows late and shrinks with skin care."], ["prg", "Pregnancy", "g-fl", "The unborn child builds every tissue from dividing cells, so the drug can harm its growth. Checks cannot remove this risk."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 140, 478, 70, 18, cls, name, tip); });
}
function step(dt, m) {
  const k2 = Math.min(1, dt * 1.2);
  sm.K = lerp(sm.K, m.K, k2); sm.Ms = lerp(sm.Ms, m.Ms, k2); sm.Ul = lerp(sm.Ul, m.Ul, k2); sm.Sk = lerp(sm.Sk, m.Sk, k2); sm.Ca = lerp(sm.Ca, m.Ca, k2); sm.Pg = lerp(sm.Pg, m.Pg, k2); sm.Hb = lerp(sm.Hb, m.Hb, k2); sm.on = lerp(sm.on, m.on, k2); sm.pro = lerp(sm.pro, m.pro, k2); sm.a = lerp(sm.a, m.a, k2);
  /* drug rides in and plugs the enzyme; building blocks run dry */
  acc.hu += dt * sm.on * 5;
  while (acc.hu >= 1) { acc.hu--; const p = free(hu); if (p) emit(p, 0, 0, 0, 0, 0); }
  hu.forEach((p) => { if (!p.on) return; p.u += dt * 0.5; if (p.u >= 1) { kill(p); return; } const q = trHu.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(p.u * 160) + ")"); });
  plugE.setAttribute("opacity", sm.on.toFixed(2));
  blockE.setAttribute("opacity", sm.on.toFixed(2));
  acc.dntp += dt * (1 - sm.K) * 5;
  while (acc.dntp >= 1) { acc.dntp--; const p = free(dntp); if (p) emit(p, 0, 0, 0, 0, 0); }
  dntp.forEach((p) => { if (!p.on) return; p.u += dt * 0.8; if (p.u >= 1) { kill(p); return; } const q = trDntp.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* fork stalls and dims; the zip dot slows to a halt */
  forkG.setAttribute("opacity", (1 - 0.55 * sm.K).toFixed(2));
  zipU = (zipU + dt * 0.6 * (1 - sm.K)) % 1;
  zipE.setAttribute("transform", "translate(" + f1(TC[0]) + " " + f1(TC[1] + 10 - 18 + zipU * 90) + ")");
  zipE.setAttribute("opacity", (1 - 0.7 * sm.K).toFixed(2));
  /* tumour blebs off, the daughter cell stalls */
  acc.bleb += dt * sm.K * 5;
  while (acc.bleb >= 1) { acc.bleb--; const p = free(bleb); if (p) { const a = rnd(0, 6.28); emit(p, TC[0] + Math.cos(a) * TR, TC[1] + Math.sin(a) * TR, Math.cos(a) * 26, Math.sin(a) * 26, 0); } }
  bleb.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  const dg = 1 - sm.K;
  place(dauG, 415, 352, 0, Math.max(dg, 0.001)); dauG.style.opacity = dg > 0.05 ? 1 : 0;
  /* fetal haemoglobin rises: sickle fades, HbF dots rise from the round cell */
  sickE.setAttribute("opacity", (1 - 0.85 * sm.Hb).toFixed(2));
  acc.hbf += dt * sm.Hb * 5;
  while (acc.hbf >= 1) { acc.hbf--; const p = free(hbf); if (p) emit(p, 360 + rnd(-8, 8), 392, rnd(-4, 4), rnd(-26, -16), 0); }
  hbf.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4 || p.y < 344) kill(p); });
  /* marrow cells run low, macrocytes appear */
  const keep = (1 - 0.85 * sm.Ms) * marCells.length;
  marCells.forEach((c, i) => { const s = clamp(keep - i); place(c.g, c.x, c.y, 0, Math.max(s, 0.001)); c.g.style.opacity = s > 0.05 ? 1 : 0; });
  const mac = sm.on * (0.25 + 0.6 * sm.a);
  macroE.forEach((o) => o.e.setAttribute("opacity", mac.toFixed(2)));
  /* skin and mouth sores glow, pigment shifts, bands show, blotch grows */
  const so = sm.Ul * (0.75 + 0.25 * Math.sin(tm / 350));
  ulcE.forEach((e) => e.setAttribute("opacity", so.toFixed(2)));
  soreM.forEach((e) => e.setAttribute("opacity", so.toFixed(2)));
  pigE.forEach((e) => e.setAttribute("opacity", sm.Sk.toFixed(2)));
  bandE.forEach((e) => e.setAttribute("opacity", sm.Sk.toFixed(2)));
  blotchE.setAttribute("transform", "translate(728 200) scale(" + (0.3 + 1.4 * sm.Ca).toFixed(2) + ")");
  blotchE.setAttribute("opacity", clamp(sm.Ca * 1.6).toFixed(2));
  warnE.setAttribute("opacity", clamp(sm.Pg * 1.2).toFixed(2));
  shieldM.setAttribute("opacity", sm.pro.toFixed(2));
  shieldS.setAttribute("opacity", sm.pro.toFixed(2));
  acc.spk += dt * (sm.Ul + sm.Ca) * 4;
  while (acc.spk >= 1) { acc.spk--; const p = free(spk); if (p) { const atSkin = Math.random() < 0.6; emit(p, atSkin ? 735 + rnd(-35, 35) : 880 + rnd(-22, 22), atSkin ? 175 + rnd(-25, 25) : 175 + rnd(-14, 14), 0, 0, 0); } }
  spk.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 1.6).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) kill(p); });
  /* skin care drops fall on the skin */
  acc.care += dt * sm.pro * 6;
  while (acc.care >= 1) { acc.care--; const p = free(care); if (p) emit(p, 735 + rnd(-40, 40), 108, 0, rnd(50, 70), 0); }
  care.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 210) kill(p); });
  /* caption and gauges */
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
  gg.kill.set(sm.K, wordOf(sm.K, 0.25, 0.6, ["low", "medium", "high"]));
  gg.mar.set(sm.Ms, wordOf(sm.Ms, 0.3, 0.65, ["ok", "low", "very low"]));
  gg.ulc.set(sm.Ul, wordOf(sm.Ul, 0.3, 0.65, ["ok", "sore", "raw"]));
  gg.skn.set(sm.Sk, wordOf(sm.Sk, 0.35, 0.65, ["ok", "rough", "damaged"]));
  gg.can.set(sm.Ca, wordOf(sm.Ca, 0.2, 0.55, ["none", "small", "growing"]));
  gg.prg.set(sm.Pg, wordOf(sm.Pg, 0.3, 0.7, ["none", "risk", "high"]));
}
run({ init, step });
