/* Hypersensitivity scene: one stage shows the chosen type (I to IV) with live treatment effects and gauges. */
const ease = (u) => u * u * (3 - 2 * u), ramp = (t, a, b) => clamp((t - a) / (b - a));
const LY = { stage: $("stage"), over: $("over"), panel: $("panel") };
const CYC = [10, 12, 14, 20], W = SC.W, H = SC.H || 610;
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abY(parent, x, y, rot, sc) { const g = mk("g", {}, parent); mk("path", { class: "ab-p", d: "M0 7L0 0M0 0L-5.5 -6.5M0 0L5.5 -6.5" }, g); place(g, x, y, rot, sc || 1); return g; }
function hexAt(parent, r, cls) { const pts = []; for (let i = 0; i < 6; i++) { const a = i * 1.0472 + 0.5; pts.push(f1(r * Math.cos(a)) + " " + f1(r * Math.sin(a))); } return mk("path", { class: cls || "ag", d: "M" + pts.join("L") + "Z" }, parent); }
const dotP = (parent, cls, r) => mk("circle", { class: "sc-p " + cls, r: r || 2.6 }, parent);
const droplet = (parent) => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, parent);
const types = [], labels = [];
function addLabel(ty, text, x, y, tx, ty2, tip) { const g = pill(LY.over, text, x, y, tx, ty2, tip); labels.push({ g, ty }); return g; }
function capText(ty, dr) {
  const T = [
    ["No treatment. Allergen links IgE on the mast cell. Histamine leaks the vessel and pressure falls.",
      "Adrenaline rescue. Vessels tighten and pressure recovers while histamine fades.",
      "Antihistamine sits on the vessel receptor. Histamine still pours out but cannot act.",
      "Steroid calms mast cells. Less histamine is released and the leak eases.",
      "Immunosuppressant turns down immune cells. Mediator release falls slowly.",
      "Trigger removed. No allergen means no IgE link and no histamine burst."],
    ["No treatment. Antibody coats the red cell. Complement bursts it and the spleen eats the rest.",
      "Adrenaline does little here. Antibody keeps binding and cells keep bursting.",
      "Antihistamine does little here. This injury is not histamine driven.",
      "Steroid lowers antibody attack and spleen eating. Fewer cells are lost.",
      "Immunosuppressant lowers antibody making. Coating and eating ease.",
      "Trigger removed. Without the antigen target, coating and bursting end."],
    ["No treatment. Complexes lodge in the wall. Complement calls neutrophils and the wall bleeds.",
      "Adrenaline does little here. Complexes keep lodging and the wall keeps bleeding.",
      "Antihistamine does little here. This injury is not histamine driven.",
      "Steroid calms complement and neutrophils. Wall injury eases.",
      "Immunosuppressant lowers antibody making. Fewer complexes form and lodge.",
      "Trigger removed. No antigen means no new complexes and the wall heals."],
    ["No treatment. T cells learn the allergen, wake macrophages and kill skin cells over days.",
      "Adrenaline does little here. T cells keep acting over days.",
      "Antihistamine does little here. This injury is not histamine driven.",
      "Steroid turns down T cells and macrophages. Skin injury eases.",
      "Immunosuppressant blocks T cell action. Killing slows where it works best.",
      "Trigger removed. Without the allergen, T cells stay quiet and skin heals."],
  ];
  return T[ty][dr];
}
let capEl = null, capKey = "";

/* ================= TYPE I: allergen, mast cell, vessel ================= */
(function () {
  const g = mk("g", {}, LY.stage), MX = 300, MY = 275;
  const glow = mk("rect", { class: "hy-glow", x: 618, y: 150, width: 164, height: 252, rx: 22, opacity: 0 }, g);
  const oed = mk("ellipse", { class: "sc-oed", cx: 700, cy: 275, rx: 118, ry: 128, opacity: 0 }, g);
  const ves = organ(g, "vessel", 700, 275, 150, {});
  const mast = mk("g", {}, g); cell(mast, { cls: "mast", r: 38, nuc: 0.32, seed: 4, wob: 0.07 }); place(mast, MX, MY, 0, 1);
  const grans = [];
  for (let i = 0; i < 12; i++) { const a = i * 2.4, r = 9 + (i % 4) * 6; grans.push(mk("circle", { class: "sc-p p-gran", cx: f1(MX + Math.cos(a) * r), cy: f1(MY + Math.sin(a) * r), r: 3.2 }, g)); }
  for (let i = 0; i < 8; i++) { const a = i * 0.785 - 1.2; abY(g, MX + Math.cos(a) * 44, MY + Math.sin(a) * 44, a * 57.3 + 90, 1); }
  const aller = [0.5, 1.9, 3.4, 4.6].map((a) => ({ e: hexAt(g, 7, "ag"), a }));
  const rbs = [];
  for (let i = 0; i < 4; i++) { const e = mk("ellipse", { class: "sc-p p-frag", rx: 8, ry: 4.8 }, g); rbs.push({ e, x: 685 + (i % 2) * 30, y: 170 + i * 55 }); }
  const blks = [];
  for (let i = 0; i < 12; i++) { const sy = 188 + i * 14.5; mk("circle", { class: "hy-site", cx: 628, cy: f1(sy), r: 2.2 }, g); const e = dotP(g, "p-blk", 3.4); e.setAttribute("opacity", "0"); blks.push({ e, x: 940, y: sy, sy }); }
  const hist = mkPool(60, () => dotP(g, "p-hist", 2.3)), leak = mkPool(22, () => droplet(g));
  let acc = 0, accL = 0;
  types.push({ g, upd(dt, ph, m) {
    const trig = m.drug === 5 ? 0.15 : 1, blk = m.drug === 2 ? 1 : 0;
    const bind = ramp(ph, 1.6, 3.2);
    const deg = ramp(ph, 3.2, 4.4) * (1 - ramp(ph, 8.2, 9.6)) * m.R;
    ves.g.setAttribute("transform", "translate(700 275) scale(" + (1 + 0.22 * m.D).toFixed(3) + ")");
    glow.setAttribute("opacity", (0.35 * m.D).toFixed(2));
    oed.setAttribute("opacity", (0.42 * m.D).toFixed(2));
    aller.forEach((al) => { const a = al.a - 1.2 + 0.2, tx = MX + Math.cos(a) * 52, tyy = MY + Math.sin(a) * 52, u = ease(clamp(bind * trig * 1.2)), sx = 70, sy = 205 + al.a * 22;
      al.e.setAttribute("transform", "translate(" + f1(lerp(sx, tx, u)) + " " + f1(lerp(sy, tyy, u)) + ") rotate(" + f1(tm / 9) + ")"); al.e.setAttribute("opacity", trig > 0.5 ? 1 : 0.22); });
    place(mast, MX, MY, 0, 1 + 0.05 * Math.sin(tm / 90) * deg);
    grans.forEach((gr, i) => gr.setAttribute("opacity", (1 - 0.8 * ramp(ph, 3.4 + (i % 6) * 0.2, 6) * m.R).toFixed(2)));
    acc += dt * deg * 26; while (acc >= 1) { acc--; const p = freeP(hist); if (p) emit(p, MX + 40, MY + rnd(-30, 30), rnd(50, 90), rnd(-25, 25), 0); }
    hist.forEach((p) => { if (!p.on) return; p.t += dt; p.vx += (655 - p.x) * dt * 1.2; p.vy += (275 - p.y) * dt * 1.2; p.x += p.vx * dt; p.y += p.vy * dt;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 624 || p.t > 5) kill(p); });
    rbs.forEach((r) => { r.y += dt * 40; if (r.y > 378) r.y = 168; place(r.e, r.x + Math.sin(tm / 500 + r.y) * 3, r.y, 0, 1); });
    blks.forEach((b) => { const gx = blk ? 628 : 940, dx = gx - b.x, dy = b.sy - b.y, dd = Math.hypot(dx, dy);
      if (dd > 2) { const v = Math.min(dd, dt * 300); b.x += dx / dd * v; b.y += dy / dd * v; }
      const cur = parseFloat(b.e.getAttribute("opacity") || 0), nx = cur + (blk - cur) * Math.min(1, dt * 4);
      b.e.setAttribute("opacity", nx.toFixed(2)); b.e.setAttribute("transform", "translate(" + f1(b.x) + " " + f1(b.y) + ")"); });
    accL += dt * m.D * (1 - 0.75 * blk) * 9; while (accL >= 1) { accL--; const p = freeP(leak); if (p) emit(p, rnd(636, 768), rnd(190, 360), rnd(-4, 4), rnd(25, 55), 0); }
    leak.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.8) kill(p); });
  } });
  addLabel(0, "Mast cell", MX, MY - 38, 250, 160, "Mast cell: a tissue sensor packed with histamine. Allergen links its IgE and it bursts its granules.");
  addLabel(0, "Vessel", 748, 230, 790, 160, "Small vessel: histamine widens it and opens gaps so fluid leaks out and pressure falls.");
})();

/* ================= TYPE II: antibody coats a red cell, spleen clears ================= */
(function () {
  const g = mk("g", {}, LY.stage), AX = 200, AY = 272;
  const glow = mk("rect", { class: "hy-glow", x: 128, y: 178, width: 144, height: 194, rx: 20, opacity: 0 }, g);
  const ves = organ(g, "vessel", 200, 275, 130, {});
  const spl = organ(g, "spleen", 730, 280, 170, {});
  const pulp = spl.ports.pulp || [730, 260];
  const tint = mk("ellipse", { class: "hy-tint", cx: 730, cy: 280, rx: 95, ry: 88, opacity: 0 }, g);
  const cellA = mk("g", {}, g); cell(cellA, { cls: "rbc", r: 30, seed: 9, wob: 0.05 }); place(cellA, AX, AY, 0, 1);
  const sq = [];
  for (let i = 0; i < 8; i++) { const a = i * 0.785; sq.push(mk("rect", { class: "ag", x: -2.6, y: -2.6, width: 5.2, height: 5.2, transform: "translate(" + f1(AX + Math.cos(a) * 32) + " " + f1(AY + Math.sin(a) * 32) + ") rotate(" + f1(a * 57.3) + ")" }, g)); }
  const abs = [];
  for (let i = 0; i < 8; i++) { const a = i * 0.785 + 0.3; abs.push({ g: abY(g, AX + 80, AY + 60, a * 57.3 + 90, 1), a }); }
  const comp = [];
  for (let i = 0; i < 10; i++) comp.push({ e: dotP(g, "p-comp", 3.4), a: i * 0.628 + 0.2 });
  const pores = [];
  for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.6; pores.push(mk("circle", { class: "mk-c", cx: f1(AX + Math.cos(a) * 30), cy: f1(AY + Math.sin(a) * 30), r: 3.4 }, g)); }
  const frag = mkPool(10, () => mk("ellipse", { class: "sc-p p-frag", rx: 4, ry: 2.6 }, g));
  const cellB = mk("g", {}, g); cell(cellB, { cls: "rbc", r: 24, seed: 3, wob: 0.05 });
  const opso = [];
  for (let i = 0; i < 7; i++) opso.push(dotP(g, "p-comp", 2.6));
  const mac = mk("g", {}, g); cell(mac, { cls: "mac", r: 26, nuc: 0.4, seed: 5, wob: 0.12 });
  let lysed = 0;
  function reset() { lysed = 0; frag.forEach(kill); }
  types.push({ g, reset, upd(dt, ph, m) {
    const trig = m.drug === 5 ? 0.15 : 1, ster = (m.drug === 3 || m.drug === 4) ? 0.55 : 1;
    const bind = ramp(ph, 1, 3), comps = ramp(ph, 3, 5), lyse = ramp(ph, 5.4, 6.4) * (m.D > 0.25 ? 1 : 0), back = ramp(ph, 10.4, 11.4);
    tint.setAttribute("opacity", (0.4 * m.D).toFixed(2));
    abs.forEach((a) => { const r = lerp(88, 50, ease(clamp(bind * trig))); a.g.setAttribute("transform", "translate(" + f1(AX + Math.cos(a.a) * r) + " " + f1(AY + Math.sin(a.a) * r) + ") rotate(" + f1(a.a * 57.3 + 90) + ")"); a.g.setAttribute("opacity", ((0.2 + 0.8 * bind * trig) * ster).toFixed(2)); });
    comp.forEach((c, i) => { const r = 46 + (i % 2) * 4; c.e.setAttribute("transform", "translate(" + f1(AX + Math.cos(c.a) * r) + " " + f1(AY + Math.sin(c.a) * r) + ")"); c.e.setAttribute("opacity", (comps * m.R * trig * ster > 0.15 ? Math.min(1, comps * 1.2) * ster : 0).toFixed(2)); });
    pores.forEach((p) => p.setAttribute("opacity", comps > 0.9 && m.D > 0.25 ? 1 : 0));
    glow.setAttribute("opacity", (0.4 * lyse * (1 - back)).toFixed(2));
    const gone = lyse * (1 - back);
    cellA.setAttribute("transform", "translate(" + AX + " " + AY + ") scale(" + f1(1 - 0.9 * gone) + ")"); cellA.setAttribute("opacity", (1 - gone).toFixed(2));
    sq.forEach((s) => s.setAttribute("opacity", (1 - gone).toFixed(2)));
    if (lyse > 0.5 && lysed === 0) { lysed = 1; frag.forEach((p) => emit(p, AX, AY, rnd(-60, 60), rnd(-60, 60), 0)); } if (ph < 1) lysed = 0;
    frag.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.97; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.t > 3) kill(p); });
    const ph2 = ramp(ph, 3, 9) * m.D, mx = lerp(430, pulp[0] - 40, ease(ph2)), eat = ramp(ph, 7, 10) * m.D * ster;
    place(mac, pulp[0], pulp[1] + Math.sin(tm / 600) * 3, 0, 1 + 0.12 * eat);
    place(cellB, mx, 292, 0, 1 - 0.8 * eat); cellB.setAttribute("opacity", (1 - 0.9 * eat).toFixed(2));
    opso.forEach((o, i) => { const a = i * 0.9; o.setAttribute("transform", "translate(" + f1(mx + Math.cos(a) * 26 * (1 - 0.8 * eat)) + " " + f1(292 + Math.sin(a) * 26 * (1 - 0.8 * eat)) + ")"); o.setAttribute("opacity", (ramp(ph, 2, 4) * (1 - eat) * trig * ster).toFixed(2)); });
  } });
  addLabel(1, "Red cell", AX, AY - 32, 170, 155, "Red cell carrying a surface target, such as a foreign blood group. Antibody binding alone does no harm.");
  addLabel(1, "Spleen", 730, 202, 730, 155, "Spleen: coated red cells are eaten here by macrophages. Heavy eating injures it.");
})();

/* ================= TYPE III: complexes lodge in a vessel wall ================= */
(function () {
  const g = mk("g", {}, LY.stage), YT = 170;
  const glow = mk("rect", { class: "hy-glow", x: 338, y: 158, width: 164, height: 236, rx: 18, opacity: 0 }, g);
  const cloud = mk("rect", { class: "hy-cloud", x: 392, y: 170, width: 56, height: 210, rx: 20, opacity: 0 }, g);
  organ(g, "vessel", 420, 275, 140, {});
  const wallL = 352, wallR = 488;
  const bandL = mk("rect", { class: "hy-tint", x: 344, y: 160, width: 14, height: 230, rx: 7, opacity: 0 }, g);
  const bandR = mk("rect", { class: "hy-tint", x: 482, y: 160, width: 14, height: 230, rx: 7, opacity: 0 }, g);
  const kd = organ(g, "kidney", 730, 280, 150, {});
  const hil = kd.ports.hilum || kd.ports.pelvis || [655, 265];
  const ktint = mk("ellipse", { class: "hy-tint", cx: 730, cy: 280, rx: 85, ry: 112, opacity: 0 }, g);
  const hem = mkPool(18, () => mk("ellipse", { class: "sc-p p-frag", rx: 4.4, ry: 2.8 }, g));
  const cplx = mkPool(14, () => { const e = mk("g", {}, g); hexAt(e, 4.4, "ag"); abY(e, -7, -6, -50, 0.7); abY(e, 7, -6, 50, 0.7); abY(e, 0, 8, 180, 0.7); return e; });
  const comps = mkPool(24, () => dotP(g, "p-comp", 2.6));
  const neuts = [0, 1, 2].map((i) => { const e = mk("g", {}, g); cell(e, { cls: "neut", r: 15, nuc: 0.55, seed: i + 30, wob: 0.14 }); e.setAttribute("opacity", "0"); return { e, st: 0, x: 60, tx: 0, ty: 0, t: 0 }; });
  const enz = mkPool(24, () => dotP(g, "p-enz", 2));
  const rbs = [];
  for (let i = 0; i < 6; i++) { const e = mk("g", { class: "cl cl-rbc" }, g); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, e); rbs.push({ e, x: 380 + i * 13, y: YT + 20 + ((i * 37) % 150) }); }
  const fly = [0, 1, 2].map((i) => ({ e: hexAt(g, 4.4, "ag"), off: i / 3 }));
  let accC = 0, acc2 = 0, dep = [], hemAcc = 0, enzAcc = 0;
  function reset() { dep.forEach(kill); dep = []; }
  types.push({ g, reset, upd(dt, ph, m) {
    const trig = m.drug === 5 ? 0.15 : 1, ster = (m.drug === 3 || m.drug === 4) ? 0.6 : 1;
    const attack = ramp(ph, 4, 6) * m.D, open = m.D > 0.22 ? 1 : 0;
    glow.setAttribute("opacity", (0.5 * attack).toFixed(2));
    cloud.setAttribute("opacity", (0.25 * m.D).toFixed(2));
    bandL.setAttribute("opacity", (0.5 * m.D).toFixed(2)); bandR.setAttribute("opacity", (0.5 * m.D).toFixed(2));
    ktint.setAttribute("opacity", (0.55 * m.D).toFixed(2));
    if (ph < 0.15 && dep.length) { dep.forEach((d) => kill(d)); dep = []; }
    rbs.forEach((r) => { r.y += dt * 46; if (r.y > 372) r.y = 178; place(r.e, r.x, r.y, 0, 1); });
    accC += dt * 1.8 * m.R * trig * (ph < 7 ? 1 : 0.2); while (accC >= 1) { accC--; const p = freeP(cplx); if (p) emit(p, rnd(390, 450), 165, rnd(-6, 6), rnd(50, 70), Math.random() < 0.6 ? 1 : 0); }
    cplx.forEach((p) => { if (!p.on) return;
      if (p.st === 0) { p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.y) + ")");
        p.e.setAttribute("opacity", trig > 0.5 ? 1 : 0.3);
        if (p.k && p.y > 195 && p.y < 365 && dep.length < 10 && Math.random() < dt * 1.6) { p.st = 1; p.x = dep.length % 2 ? wallR + 7 : wallL - 7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); dep.push(p); }
        if (p.y > 395) kill(p); }
      else p.e.setAttribute("opacity", ((0.3 + 0.7 * trig) * ster).toFixed(2)); });
    acc2 += dt * attack * 9 * open; while (acc2 >= 1) { acc2--; if (!dep.length) continue; const d = pick(dep), p = freeP(comps); if (p) emit(p, d.x + rnd(-10, 10), d.y - rnd(8, 18), rnd(-6, 6), rnd(-4, 4), 0); }
    comps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.4) kill(p); });
    neuts.forEach((n, i) => { const want = open && attack > 0.1 && dep.length > i;
      if (n.st === 0) { n.e.setAttribute("opacity", "0"); if (want) { n.st = 1; n.x = 60; n.tx = (dep[i] ? dep[i].x : 420) - 46; n.ty = (dep[i] ? dep[i].y : 300) + 24; n.t = 0; } }
      else { n.e.setAttribute("opacity", "1"); n.x += (n.tx - n.x) * dt * 0.9 + 18 * dt; n.t += dt; place(n.e, n.x, n.ty + Math.sin(tm / 300 + i) * 2, Math.sin(tm / 400 + i) * 10, 1); if (n.t > 9 || !want) n.st = 0; } });
    hemAcc += attack * 5 * dt * open; while (hemAcc >= 1) { hemAcc--; const p = freeP(hem); if (p && dep.length) { const d = pick(dep); emit(p, d.x, d.y + 8, rnd(-8, 8), rnd(8, 22), 0); } }
    hem.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3.5).toFixed(2)); if (p.t > 3.5) kill(p); });
    enzAcc += attack * 10 * dt * open; while (enzAcc >= 1) { enzAcc--; const n = neuts.find((q) => q.st === 1), p = freeP(enz); if (p && n) emit(p, n.x, n.ty - 14, rnd(-10, 10), rnd(10, 24), 0); }
    enz.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.2) kill(p); });
    fly.forEach((fl) => { const u = (tm / 5200 + fl.off) % 1, fx = lerp(500, hil[0], u), fy = lerp(300, hil[1], u) + Math.sin(u * 6.28) * 14;
      fl.e.setAttribute("transform", "translate(" + f1(fx) + " " + f1(fy) + ")"); fl.e.setAttribute("opacity", (trig > 0.5 ? m.R : 0.12 * m.R).toFixed(2)); });
  } });
  addLabel(2, "Vessel wall", wallL, 250, 290, 155, "Vessel wall: drifting complexes snag here, then complement and neutrophils injure the wall.");
  addLabel(2, "Kidney", 730, 170, 730, 150, "Kidney: lodged complexes inflame the glomerulus, so blood and protein leak into urine.");
})();

/* ================= TYPE IV: T cells attack skin over days ================= */
(function () {
  const g = mk("g", {}, LY.stage);
  organ(g, "skin", 720, 285, 210, {});
  const tint = mk("ellipse", { class: "hy-tint", cx: 720, cy: 285, rx: 110, ry: 75, opacity: 0 }, g);
  const apc = mk("g", {}, g); cell(apc, { cls: "mac", r: 24, nuc: 0.4, seed: 21, wob: 0.15 }); place(apc, 140, 265, 0, 1);
  const th = mk("g", {}, g); cell(th, { cls: "th2", r: 20, nuc: 0.45, seed: 22, wob: 0.1 }); place(th, 330, 265, 0, 1);
  const mac = mk("g", {}, g); cell(mac, { cls: "mac", r: 26, nuc: 0.4, seed: 23, wob: 0.12 });
  const tg = [];
  for (let i = 0; i < 5; i++) { const e = mk("g", {}, g); cell(e, { cls: "tgt", r: 17, nuc: 0.4, seed: 40 + i, wob: 0.08 }); place(e, 640 + i * 40, 305, 0, 1); tg.push(e); }
  const tc = mk("g", {}, g); cell(tc, { cls: "lymph", r: 20, nuc: 0.5, seed: 24, wob: 0.1 });
  const aller = [0.4, 1.6, 2.8, 4.0].map((a) => ({ e: hexAt(g, 6, "ag"), y: 240 + a * 14 }));
  const ifn = mkPool(30, () => dotP(g, "p-ifn", 2.4)), perf = mkPool(12, () => dotP(g, "p-perf", 2));
  const clk = mk("g", {}, g); mk("circle", { class: "clk", cx: 880, cy: 178, r: 18 }, clk); const hand = mk("path", { class: "clk-h", d: "M880 178L880 164" }, clk);
  let acc = 0, accP = 0;
  types.push({ g, upd(dt, ph, m) {
    const trig = m.drug === 5 ? 0.15 : 1, ster = (m.drug === 3 || m.drug === 4) ? 1 : 0;
    const prime = ramp(ph, 1, 4) * trig, act = ramp(ph, 5, 9) * m.R, kill2 = ramp(ph, 10, 17) * m.D;
    tint.setAttribute("opacity", (0.45 * m.D).toFixed(2));
    hand.setAttribute("transform", "rotate(" + f1(ph / 20 * 270) + " 880 178)");
    aller.forEach((al) => { const u = ease(clamp(prime * 1.2));
      al.e.setAttribute("transform", "translate(" + f1(lerp(55, 118, u)) + " " + f1(lerp(al.y, 258, u)) + ")"); al.e.setAttribute("opacity", trig > 0.5 ? 1 : 0.22); });
    place(th, lerp(330, 285, ease(prime)), 265 + Math.sin(tm / 700) * 3, 0, 1 + 0.12 * prime * m.R);
    th.setAttribute("opacity", ster ? 0.6 : 1);
    acc += dt * act * 16 * (ster ? 0.4 : 1); while (acc >= 1) { acc--; const p = freeP(ifn); if (p) emit(p, 292, 265, rnd(24, 44), rnd(-12, 12), 0); }
    ifn.forEach((p) => { if (!p.on) return; p.t += dt; const dx = 480 - p.x, dy = 275 - p.y, dd = Math.hypot(dx, dy) || 1; p.x += (dx / dd) * 60 * dt + p.vx * dt * 0.2; p.y += (dy / dd) * 60 * dt + p.vy * dt * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (dd < 22 || p.t > 6) kill(p); });
    place(mac, 480, 275 + Math.sin(tm / 800) * 3, 0, 1 + 0.35 * act);
    mac.querySelectorAll(".cl-b").forEach((e) => (e.style.fill = "color-mix(in srgb,var(--c-bad) " + Math.round(55 * act) + "%,var(--c-mac))"));
    mac.setAttribute("opacity", ster ? 0.65 : 1);
    const kk = ease(clamp(kill2 * 1.6)), tcx = lerp(620, 700, kk), tcy = lerp(195, 292, kk);
    place(tc, tcx, tcy + Math.sin(tm / 500) * 2, 0, 1); tc.setAttribute("opacity", ster ? 0.55 : 1);
    accP += dt * kill2 * 10; while (accP >= 1) { accP--; const p = freeP(perf); if (p) emit(p, tcx + 14, tcy + 10, rnd(8, 18), rnd(6, 18), 0); }
    perf.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.6) kill(p); });
    tg.forEach((t, i) => { const dm = clamp(m.D * (act * 0.5 + kill2 * 0.7) * 1.3 - i * 0.07); t.setAttribute("opacity", (1 - 0.75 * dm).toFixed(2)); t.querySelectorAll(".cl-b").forEach((e) => (e.style.stroke = dm > 0.4 ? "var(--c-bad)" : "")); });
  } });
  addLabel(3, "Skin", 720, 222, 720, 160, "Skin: in contact allergy the allergen soaks through here and skin cells become the target.");
  addLabel(3, "T cell", 655, 240, 560, 160, "T cell: helper cells wake macrophages and killer cells destroy marked skin cells.");
})();

/* ---- gauges, caption and status ---- */
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The reaction";
  [["rel", "Mediator release", "g-cyt", "How much histamine, complement, cytokines or killing molecules are released."], ["dmg", "Tissue damage", "g-bad", "How much tissue is injured: swelling, cell loss, vessel wall damage."], ["spd", "Onset speed", "g-fl", "How fast the reaction comes on: minutes for type I, days for type IV."], ["sev", "Severity", "g-clot", "Overall severity of the reaction."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 170 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
  capEl = mk("text", { class: "hy-cap", x: 30, y: 431 }, LY.over); capEl.textContent = capText(0, 0);
}
let curType = -1, clk = 0;
function init() { types.forEach((t) => (t.g.style.opacity = 0)); initPanel(); }
function setType(m) { curType = m.type; clk = 0; types.forEach((t) => { if (t.reset) t.reset(); }); document.querySelectorAll(".sc-card").forEach((c, i) => c.classList.toggle("on", i === m.type)); }
function step(dt, m) {
  if (m.type !== curType) setType(m);
  clk += dt; const ph = clk % CYC[m.type];
  types.forEach((t, i) => { const want = i === m.type ? 1 : 0, cur = parseFloat(t.g.style.opacity || 0), nx = cur + (want - cur) * Math.min(1, dt * 5); t.g.style.opacity = nx.toFixed(3); t.g.style.display = nx < 0.01 && !want ? "none" : ""; });
  types[m.type].upd(dt, ph, m);
  labels.forEach((l) => { l.g.style.display = l.ty === m.type ? "" : "none"; });
  const key = m.type * 10 + m.drug, tx = capText(m.type, m.drug);
  if (key !== capKey) { capKey = key; if (capEl.textContent !== tx) capEl.textContent = tx; }
  gg.rel.set(m.R, wordOf(m.R, 0.25, 0.6, ["low", "moderate", "high"])); gg.dmg.set(m.D, wordOf(m.D, 0.25, 0.55, ["little", "some", "marked"]));
  gg.spd.set(m.speed, wordOf(m.speed, 0.3, 0.7, ["slow", "hours", "minutes"])); gg.sev.set(m.S, wordOf(m.S, 0.25, 0.55, ["mild", "moderate", "severe"]));
}
run({ init, step });
