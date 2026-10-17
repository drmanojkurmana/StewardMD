/* Hypersensitivity scene: one stage, the active type (I to IV) is animated, with treatment marks and gauges. */
const ease = (u) => u * u * (3 - 2 * u), ramp = (t, a, b) => clamp((t - a) / (b - a));
const LY = { stage: $("stage"), over: $("over"), panel: $("panel") };
const CYC = [10, 12, 14, 20], W = SC.W;
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abY(parent, x, y, rot, sc) { const g = mk("g", {}, parent); mk("path", { class: "ab-p", d: "M0 7L0 0M0 0L-5.5 -6.5M0 0L5.5 -6.5" }, g); place(g, x, y, rot, sc || 1); return g; }
function hexAt(parent, r, cls) { const pts = []; for (let i = 0; i < 6; i++) { const a = i * 1.0472 + 0.5; pts.push(f1(r * Math.cos(a)) + " " + f1(r * Math.sin(a))); } return mk("path", { class: cls || "ag", d: "M" + pts.join("L") + "Z" }, parent); }
const dotP = (parent, cls, r) => mk("circle", { class: "sc-p " + cls, r: r || 2.6 }, parent);
const droplet = (parent) => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, parent);
const types = [], marks = [], labels = [];
function addLabel(ty, text, x, y, tx, ty2, tip) { const g = pill(LY.over, text, x, y, tx, ty2, tip); labels.push({ g, ty }); return g; }
function addMark(ty, drugs, x, y, text, tx, tyy, tip, good) {
  const g = mk("g", {}, LY.over);
  if (good) { mk("path", { class: "mk-g", d: "M" + f1(x - 6) + " " + f1(y) + "l4 5l8 -10" }, g); } else { mk("circle", { class: "mk-c", cx: f1(x), cy: f1(y), r: 8 }, g); mk("path", { class: "mk-x", d: "M" + f1(x - 4) + " " + f1(y - 4) + "l8 8M" + f1(x + 4) + " " + f1(y - 4) + "l-8 8" }, g); }
  pill(g, text, x, y, tx, tyy, tip); marks.push({ g, ty, drugs }); return g;
}

/* ================= TYPE I: IgE, mast cell, histamine ================= */
(function () {
  const g = mk("g", {}, LY.stage), MX = 250, MY = 270;
  const oed = mk("rect", { class: "sc-oed", x: 440, y: 150, width: 490, height: 190, rx: 14, opacity: 0 }, g);
  const vl = mk("rect", { class: "sc-lum2", x: 440, y: 356, width: 490, height: 48 }, g);
  const wt = mk("rect", { class: "sc-wall", x: 440, y: 349, width: 490, height: 8, rx: 4 }, g), wb = mk("rect", { class: "sc-wall", x: 440, y: 403, width: 490, height: 8, rx: 4 }, g);
  const rbs = Array.from({ length: 8 }, (_, i) => { const e = mk("g", { class: "cl cl-rbc" }, g); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, e); return { e, x: 440 + i * 62, y: 380 + (i % 3 - 1) * 8 }; });
  const mast = mk("g", {}, g); cell(mast, { cls: "mast", r: 40, nuc: 0.32, seed: 4, wob: 0.07 }); place(mast, MX, MY, 0, 1);
  const grans = Array.from({ length: 14 }, (_, i) => { const a = i * 2.4, r = 10 + (i % 4) * 6; return mk("circle", { class: "sc-p p-gran", cx: f1(MX + Math.cos(a) * r), cy: f1(MY + Math.sin(a) * r), r: 3.2 }, g); });
  for (let i = 0; i < 9; i++) { const a = i * 0.698 - 1.2; abY(g, MX + Math.cos(a) * 46, MY + Math.sin(a) * 46, a * 57.3 + 90, 1); }
  const aller = [0.6, 2.1, 3.6].map((a) => ({ e: hexAt(g, 7, "ag"), a }));
  const hist = mkPool(70, () => dotP(g, "p-hist", 2.3)), leak = mkPool(24, () => droplet(g));
  let acc = 0, accL = 0, hh = 24;
  types.push({ g, upd(dt, ph, m) {
    const deg = ramp(ph, 3.2, 4.4) * (1 - ramp(ph, 8.2, 9.6)) * m.R, bound = ramp(ph, 1.6, 3.2), trig = m.drug === 5 ? 0.15 : 1;
    aller.forEach((al) => { const a = al.a - 1.2 + 0.2, tx = MX + Math.cos(a) * 54, tyy = MY + Math.sin(a) * 54, u = ease(clamp(bound * trig * 1.2)), sx = 40, sy = 190 + al.a * 20;
      al.e.setAttribute("transform", "translate(" + f1(lerp(sx, tx, u)) + " " + f1(lerp(sy, tyy, u)) + ") rotate(" + f1(tm / 9) + ")"); al.e.setAttribute("opacity", (m.drug === 5 ? 0.25 : 1).toFixed(2)); });
    mast.setAttribute("transform", "translate(" + MX + " " + MY + ") scale(" + (1 + 0.05 * Math.sin(tm / 90) * deg).toFixed(3) + ")");
    grans.forEach((gr, i) => gr.setAttribute("opacity", (1 - 0.8 * ramp(ph, 3.4 + (i % 7) * 0.15, 6) * m.R).toFixed(2)));
    acc += dt * deg * 26; while (acc >= 1) { acc--; const p = freeP(hist), a = rnd(-0.9, 0.9); if (p) emit(p, MX + Math.cos(a) * 44, MY + Math.sin(a) * 44, Math.cos(a) * 46 + 20, Math.sin(a) * 30 + 22, 0); }
    hist.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx += (620 - p.x) * dt * 0.1; p.vy += (355 - p.y) * dt * 0.28; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 346 || p.t > 6) kill(p); });
    const dil = clamp(ramp(ph, 4.6, 7) * (1 - ramp(ph, 9, 10)) * m.D * 1.1);
    hh = lerp(hh, 24 + 16 * dil, Math.min(1, dt * 2));
    vl.setAttribute("y", f1(380 - hh)); vl.setAttribute("height", f1(hh * 2)); wt.setAttribute("y", f1(373 - hh)); wb.setAttribute("y", f1(379 + hh));
    rbs.forEach((r) => { r.x += dt * 34; if (r.x > 930) r.x = 444; place(r.e, r.x, 380 + (r.y - 380) * (hh / 24), 0, 1); });
    oed.setAttribute("opacity", (0.5 * dil * m.D).toFixed(2));
    accL += dt * dil * m.D * 7; while (accL >= 1) { accL--; const p = freeP(leak); if (p) emit(p, rnd(480, 900), 345, rnd(-3, 3), -rnd(14, 22), 0); }
    leak.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.2) kill(p); });
  } });
  addLabel(0, "Mast cell", MX - 20, MY - 38, MX - 60, 164, "Mast cell: a tissue cell packed with granules of histamine. IgE antibodies on its surface act as sensors.");
  addLabel(0, "IgE", MX + 46, MY - 8, MX + 64, 340, "IgE antibody bound to the mast cell. Each one carries a site that recognises one allergen.");
  addLabel(0, "Allergen", 100, 214, 80, 164, "The allergen bridges two IgE molecules. That cross-linking is the trigger.");
  addLabel(0, "Histamine", 420, 305, 410, 200, "Histamine and other mediators spread into the tissue within minutes.");
  addLabel(0, "Leaky, widened vessel", 700, 349, 760, 316, "Histamine widens the vessel and makes it leaky. This causes swelling, redness, itching and, if widespread, a fall in blood pressure (anaphylaxis).");
  addMark(0, [1], 690, 405, "Adrenaline narrows vessels", 780, 430, "Adrenaline tightens vessels, relaxes airways and calms mast cells: rescue treatment in anaphylaxis.", true);
  addMark(0, [2], 560, 349, "H1 receptor blocked", 640, 172, "An antihistamine blocks the H1 receptor, so histamine reaches the vessel but cannot act. It does not stop the release itself.");
  addMark(0, [3, 4], 340, 235, "Fewer mediators made", 380, 150, "Steroids and immunosuppressants reduce the cells, cytokines and later-phase response. Little effect on the first minutes.");
  addMark(0, [5], 90, 200, "Allergen avoided", 130, 140, "Removing the trigger stops the cross-linking: no allergen, no reaction.");
})();

/* ================= TYPE II: antibody on a cell or receptor ================= */
(function () {
  const g = mk("g", {}, LY.stage), AX = 210, AY = 270;
  const cellA = mk("g", {}, g); cell(cellA, { cls: "rbc2", r: 42, seed: 9, wob: 0.05 });
  const sq = Array.from({ length: 10 }, (_, i) => { const a = i * 0.628; return mk("rect", { class: "ag", x: -2.6, y: -2.6, width: 5.2, height: 5.2, transform: "translate(" + f1(AX + Math.cos(a) * 44) + " " + f1(AY + Math.sin(a) * 44) + ") rotate(" + f1(a * 57.3) + ")" }, g); });
  const abs = Array.from({ length: 8 }, (_, i) => { const a = i * 0.785 + 0.3; return { g: abY(g, AX + Math.cos(a) * 80, AY + Math.sin(a) * 80, a * 57.3 + 90, 1), a }; });
  const comp = Array.from({ length: 10 }, (_, i) => ({ e: dotP(g, "p-comp", 3.4), a: i * 0.628 + 0.2 }));
  const pores = Array.from({ length: 4 }, (_, i) => { const a = i * 1.57 + 0.6; return mk("circle", { class: "mk-c", cx: f1(AX + Math.cos(a) * 42), cy: f1(AY + Math.sin(a) * 42), r: 3.4 }, g); });
  const frag = mkPool(10, () => mk("ellipse", { class: "sc-p p-frag", rx: 4, ry: 2.6 }, g));
  const cellB = mk("g", {}, g); cell(cellB, { cls: "rbc2", r: 32, seed: 3, wob: 0.05 });
  const opso = Array.from({ length: 7 }, () => dotP(g, "p-comp", 2.6));
  const mac = mk("g", {}, g); cell(mac, { cls: "mac", r: 30, nuc: 0.4, seed: 5, wob: 0.12 });
  const CX = 790, CYY = 372, rec = mk("g", {}, g); cell(rec, { cls: "endo", r: 30, nuc: 0.3, seed: 12, wob: 0.06 }); place(rec, CX, CYY, 0, 1);
  for (let i = 0; i < 5; i++) { const a = -0.9 + i * 0.5; mk("path", { class: "mk-x rcp", d: "M" + f1(CX + Math.cos(a) * 30) + " " + f1(CYY + Math.sin(a) * 30) + "l" + f1(Math.cos(a) * 9) + " " + f1(Math.sin(a) * 9) }, g); }
  const abR = abY(g, CX + 52, CYY - 20, -60, 1.1), ring = mk("circle", { class: "mk-g", cx: CX, cy: CYY, r: 40, opacity: 0 }, g);
  let lysed = 0;
  types.push({ g, upd(dt, ph, m) {
    const bind = ramp(ph, 1, 3), comps = ramp(ph, 3, 5), lyse = ramp(ph, 5.4, 6.4) * (m.D > 0.25 ? 1 : 0), back = ramp(ph, 10.4, 11.4), trig = m.drug === 5 ? 0.15 : 1;
    abs.forEach((a) => { const r = lerp(88, 56, ease(clamp(bind * trig))); a.g.setAttribute("transform", "translate(" + f1(AX + Math.cos(a.a) * r) + " " + f1(AY + Math.sin(a.a) * r) + ") rotate(" + f1(a.a * 57.3 + 90) + ")"); a.g.setAttribute("opacity", (0.2 + 0.8 * bind * trig).toFixed(2)); });
    comp.forEach((c, i) => { const r = 54 + (i % 2) * 4; c.e.setAttribute("transform", "translate(" + f1(AX + Math.cos(c.a) * r) + " " + f1(AY + Math.sin(c.a) * r) + ")"); c.e.setAttribute("opacity", (comps * m.R * trig > 0.2 ? Math.min(1, comps * 1.2) : 0).toFixed(2)); });
    pores.forEach((p) => p.setAttribute("opacity", (comps > 0.9 && m.D > 0.25 ? 1 : 0).toFixed(2)));
    const gone = lyse * (1 - back);
    cellA.setAttribute("transform", "translate(" + AX + " " + AY + ") scale(" + f1(1 - 0.9 * gone) + ")"); cellA.setAttribute("opacity", (1 - gone).toFixed(2));
    sq.forEach((s) => s.setAttribute("opacity", (1 - gone).toFixed(2)));
    if (lyse > 0.5 && lysed === 0) { lysed = 1; frag.forEach((p) => emit(p, AX, AY, rnd(-60, 60), rnd(-60, 60), 0)); } if (ph < 1) lysed = 0;
    frag.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.97; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.t > 3) kill(p); });
    const ph2 = ramp(ph, 3, 9) * m.D, mx = lerp(760, 568, ease(ph2)), eat = ramp(ph, 7, 10) * m.D;
    place(mac, mx, 290 + Math.sin(tm / 600) * 3, 0, 1 + 0.12 * eat); place(cellB, 520, 300, 0, 1 - 0.8 * eat); cellB.setAttribute("opacity", (1 - 0.9 * eat).toFixed(2));
    opso.forEach((o, i) => { const a = i * 0.9; o.setAttribute("transform", "translate(" + f1(520 + Math.cos(a) * 34 * (1 - 0.8 * eat)) + " " + f1(300 + Math.sin(a) * 34 * (1 - 0.8 * eat)) + ")"); o.setAttribute("opacity", (ramp(ph, 2, 4) * (1 - eat) * trig).toFixed(2)); });
    const pulse = 0.5 + 0.5 * Math.sin(tm / 300); ring.setAttribute("opacity", (m.R * 0.7 * pulse * trig).toFixed(2)); ring.setAttribute("r", f1(38 + 5 * pulse));
    abR.setAttribute("opacity", trig > 0.5 ? 1 : 0.2);
  } });
  addLabel(1, "Target cell", AX, AY - 44, AX - 20, 160, "A cell carrying a surface antigen (for example a red cell with a foreign blood group, or a drug stuck to its surface).");
  addLabel(1, "Antibody (IgG)", AX + 80, AY + 40, AX + 110, 380, "IgG binds the antigen on the cell. Binding on its own does no harm; what follows is the damage.");
  addLabel(1, "Complement", AX - 56, AY + 24, AX - 100, 350, "Complement proteins settle on the bound antibody and can punch holes (membrane attack complex) so the cell bursts.");
  addLabel(1, "Macrophage eats it", 640, 258, 660, 180, "Coated cells (opsonised by antibody and complement) are eaten by macrophages, mostly in the spleen and liver.");
  addLabel(1, "Antibody to a receptor", CX, CYY + 30, CX - 10, 428, "Some antibodies do not kill but disturb a receptor: stimulating the TSH receptor (Graves) or blocking the acetylcholine receptor (myasthenia gravis).");
  addMark(1, [3, 4], 400, 395, "Antibody and attack reduced", 420, 424, "Steroids and immunosuppressants lower antibody production and phagocyte activity. They help slowly.");
  addMark(1, [5], 110, 200, "Trigger removed", 140, 140, "Stopping the offending drug or avoiding the incompatible blood removes the antigen target.");
})();

/* ================= TYPE III: immune complexes in a vessel wall ================= */
(function () {
  const g = mk("g", {}, LY.stage), YT = 232, YB = 322;
  mk("rect", { class: "sc-lum2", x: 14, y: YT + 6, width: W - 28, height: YB - YT - 12 }, g);
  mk("rect", { class: "sc-wall", x: 14, y: YT - 4, width: W - 28, height: 10, rx: 5 }, g); mk("rect", { class: "sc-wall", x: 14, y: YB - 6, width: W - 28, height: 10, rx: 5 }, g);
  const dmg = mk("rect", { class: "dmg", x: 300, y: YB - 6, width: 500, height: 10, rx: 5, opacity: 0 }, g);
  const hem = mkPool(22, () => mk("ellipse", { class: "sc-p p-frag", rx: 4.4, ry: 2.8 }, g));
  const cplx = mkPool(18, () => { const e = mk("g", {}, g); hexAt(e, 4.4, "ag"); abY(e, -7, -6, -50, 0.7); abY(e, 7, -6, 50, 0.7); abY(e, 0, 8, 180, 0.7); return e; });
  const comps = mkPool(30, () => dotP(g, "p-comp", 2.6));
  const neuts = [0, 1, 2].map((i) => { const e = mk("g", {}, g); cell(e, { cls: "neut", r: 15, nuc: 0.55, seed: i + 30, wob: 0.14 }); e.setAttribute("opacity", "0"); return { e, st: 0, x: 40, tx: 0, t: 0 }; });
  const enz = mkPool(30, () => dotP(g, "p-enz", 2));
  const rbs = Array.from({ length: 10 }, (_, i) => { const e = mk("g", { class: "cl cl-rbc" }, g); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, e); return { e, x: i * 96, y: YT + 26 + (i * 17 % 36) }; });
  let accC = 0, acc2 = 0, dep = [], hemAcc = 0, enzAcc = 0;
  types.push({ g, upd(dt, ph, m) {
    const trig = m.drug === 5 ? 0.15 : 1;
    if (ph < 0.15 && dep.length) { dep.forEach((d) => kill(d)); dep = []; }
    rbs.forEach((r) => { r.x += dt * 52; if (r.x > W) r.x = -10; place(r.e, r.x, r.y, 0, 1); });
    accC += dt * 1.8 * m.R * trig * (ph < 7 ? 1 : 0.2); while (accC >= 1) { accC--; const p = freeP(cplx); if (p) emit(p, -10, rnd(YT + 18, YB - 28), 70, 0, Math.random() < 0.55 ? 1 : 0); }
    cplx.forEach((p) => { if (!p.on) return;
      if (p.st === 0) { p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.x) + ")");
        if (p.k && p.x > 300 && p.x < 800 && dep.length < 12 && Math.random() < dt * 1.4) { p.st = 1; p.y = YB - 14 - (dep.length % 3) * 8; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); dep.push(p); }
        if (p.x > W + 12) kill(p); } });
    const attack = ramp(ph, 4, 6) * m.D;
    acc2 += dt * attack * 9; while (acc2 >= 1) { acc2--; if (!dep.length) continue; const d = pick(dep), p = freeP(comps); if (p) emit(p, d.x + rnd(-10, 10), d.y - rnd(8, 18), rnd(-6, 6), rnd(-4, 4), 0); }
    comps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.4) kill(p); });
    neuts.forEach((n, i) => { const want = attack > 0.15 && dep.length > i;
      if (n.st === 0) { n.e.setAttribute("opacity", "0"); if (want) { n.st = 1; n.x = 40; n.tx = dep[i].x - 10; n.t = 0; } }
      else { n.e.setAttribute("opacity", "1"); n.x += (n.tx - n.x) * dt * 0.9 + 18 * dt; n.t += dt; place(n.e, n.x, YB - 26 + Math.sin(tm / 300 + i) * 2, Math.sin(tm / 400 + i) * 10, 1); if (n.t > 9 || !want) n.st = 0; } });
    hemAcc += attack * 5 * dt; while (hemAcc >= 1) { hemAcc--; const p = freeP(hem); if (p && dep.length) { const d = pick(dep); emit(p, d.x, YB + 8, rnd(-8, 8), rnd(8, 22), 0); } }
    hem.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3.5).toFixed(2)); if (p.t > 3.5) kill(p); });
    enzAcc += attack * 10 * dt; while (enzAcc >= 1) { enzAcc--; const n = neuts.find((q) => q.st === 1), p = freeP(enz); if (p && n) emit(p, n.x, YB - 10, rnd(-10, 10), rnd(10, 24), 0); }
    enz.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.2) kill(p); });
    dmg.setAttribute("opacity", (attack * 0.85).toFixed(2));
  } });
  addLabel(2, "Immune complex", 220, 270, 160, 190, "Soluble antigen bound to antibody. Normally cleared, but when the complexes are too many or too small they settle in vessel walls, kidney glomeruli, joints and skin.");
  addLabel(2, "Deposit in the wall", 520, 308, 520, 392, "The deposited complexes activate complement in the wall.");
  addLabel(2, "Complement", 560, 290, 650, 178, "Complement attracts neutrophils and makes the wall inflamed.");
  addLabel(2, "Neutrophils", 330, 296, 280, 392, "Neutrophils cannot swallow the deposits stuck to the wall, so they release enzymes that injure the wall itself.");
  addLabel(2, "Wall damage and bleeding", 700, 330, 790, 392, "Injured vessel wall: inflammation (vasculitis), leak, haemorrhage and fibrin. In the kidney this shows as glomerulonephritis.");
  addMark(2, [3, 4], 420, 190, "Inflammation reduced", 520, 160, "Steroids and immunosuppressants calm the complement and neutrophil attack and lower antibody production.");
  addMark(2, [5], 80, 200, "Antigen source removed", 140, 160, "Stopping the antigen (the drug, the infection) lets the complexes clear.");
})();

/* ================= TYPE IV: delayed T cell and macrophage attack ================= */
(function () {
  const g = mk("g", {}, LY.stage);
  const apc = mk("g", {}, g); cell(apc, { cls: "mac", r: 26, nuc: 0.4, seed: 21, wob: 0.15 }); place(apc, 130, 250, 0, 1);
  const ag = hexAt(g, 6, "ag"); ag.setAttribute("transform", "translate(110 232)");
  const th = mk("g", {}, g); cell(th, { cls: "th2", r: 22, nuc: 0.45, seed: 22, wob: 0.1 }); place(th, 280, 250, 0, 1);
  const mac = mk("g", {}, g); cell(mac, { cls: "mac", r: 28, nuc: 0.4, seed: 23, wob: 0.12 });
  const tg = Array.from({ length: 6 }, (_, i) => { const e = mk("g", {}, g); cell(e, { cls: "tgt", r: 20, nuc: 0.4, seed: 40 + i, wob: 0.08 }); place(e, 650 + (i % 3) * 78, 330 + Math.floor(i / 3) * 52 - 26, 0, 1); return e; });
  const tc = mk("g", {}, g); cell(tc, { cls: "lymph", r: 22, nuc: 0.5, seed: 24, wob: 0.1 });
  const ifn = mkPool(36, () => dotP(g, "p-ifn", 2.4)), perf = mkPool(14, () => dotP(g, "p-perf", 2));
  const clk = mk("g", {}, g); mk("circle", { class: "clk", cx: 880, cy: 190, r: 22 }, clk); const hand = mk("path", { class: "clk-h", d: "M880 190L880 174" }, clk); const ct = mk("text", { class: "dr-pt2", x: 880, y: 228, "text-anchor": "middle" }, clk); ct.textContent = "day 0";
  let acc = 0, accP = 0;
  types.push({ g, upd(dt, ph, m) {
    const trig = m.drug === 5 ? 0.15 : 1, prime = ramp(ph, 1, 4) * trig, act = ramp(ph, 5, 9) * m.R, kill2 = ramp(ph, 10, 17) * m.D;
    hand.setAttribute("transform", "rotate(" + f1(ph / 20 * 360 * 0.75) + " 880 190)"); const d = Math.floor(ph / 20 * 3.2); if (ct.textContent !== "day " + d) ct.textContent = "day " + d;
    ag.setAttribute("opacity", (m.drug === 5 ? 0.25 : 1).toFixed(2));
    place(th, lerp(330, 280, ease(prime)), 250 + Math.sin(tm / 700) * 3, 0, 1 + 0.12 * prime * m.R);
    acc += dt * act * 16; while (acc >= 1) { acc--; const p = freeP(ifn); if (p) emit(p, 290, 250, rnd(24, 44), rnd(-12, 12), 0); }
    ifn.forEach((p) => { if (!p.on) return; p.t += dt; const dx = 480 - p.x, dy = 262 - p.y, dd = Math.hypot(dx, dy) || 1; p.x += (dx / dd) * 60 * dt + p.vx * dt * 0.2; p.y += (dy / dd) * 60 * dt + p.vy * dt * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (dd < 22 || p.t > 6) kill(p); });
    place(mac, 480, 262 + Math.sin(tm / 800) * 3, 0, 1 + 0.35 * act);
    mac.querySelectorAll(".cl-b").forEach((e) => (e.style.fill = "color-mix(in srgb,var(--c-bad) " + Math.round(55 * act) + "%,var(--c-mac))"));
    const kk = ease(clamp(kill2 * 1.6)), tcx = lerp(640, 800, kk), tcy = lerp(190, 300, kk);
    place(tc, tcx, tcy + Math.sin(tm / 500) * 2, 0, 1); tc.setAttribute("opacity", (m.drug === 4 || m.drug === 3 ? 0.55 : 1).toFixed(2));
    accP += dt * kill2 * 10; while (accP >= 1) { accP--; const p = freeP(perf); if (p) emit(p, tcx + 14, tcy + 10, rnd(8, 18), rnd(6, 18), 0); }
    perf.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.6) kill(p); });
    tg.forEach((t, i) => { const dm = clamp(m.D * (act * 0.5 + kill2 * 0.7) * 1.3 - i * 0.07); t.setAttribute("opacity", (1 - 0.75 * dm).toFixed(2)); t.querySelectorAll(".cl-b").forEach((e) => (e.style.stroke = dm > 0.4 ? "var(--c-bad)" : "")); });
  } });
  addLabel(3, "Antigen-presenting cell", 130, 224, 150, 160, "A dendritic cell shows a piece of antigen on MHC molecules to T cells in a lymph node or the skin.");
  addLabel(3, "Th1 cell", 280, 226, 300, 160, "A Th1 CD4 T cell recognises the antigen and releases interferon-gamma. It takes a day or more to build up, so the reaction is delayed.");
  addLabel(3, "Activated macrophage", 480, 232, 470, 170, "Interferon-gamma activates macrophages, which release enzymes and cytokines that damage tissue (granuloma, tuberculin test, contact dermatitis).");
  addLabel(3, "Killer T cell", 700, 190, 700, 150, "CD8 T cells kill target cells directly with perforin and granzymes (graft rejection, some skin reactions).");
  addLabel(3, "Target cells", 720, 400, 740, 430, "Cells in the tissue that carry the antigen, such as skin cells with a contact allergen or graft cells.");
  addLabel(3, "Slow clock", 880, 168, 880, 140, "Type IV is delayed: it peaks one to three days after exposure, unlike the minutes of type I.");
  addMark(3, [3, 4], 380, 330, "T cell activity reduced", 420, 400, "Steroids and immunosuppressants (calcineurin inhibitors, anti-proliferatives, biologics) turn down T cells and macrophages. This is where they work best.");
  addMark(3, [5], 105, 218, "Trigger avoided", 120, 176, "Avoiding the contact allergen (for example nickel) removes the antigen.");
  addMark(3, [1, 2], 500, 330, "Little effect", 540, 400, "Adrenaline and antihistamines act on type I mediators, not on T cells, so they do little here.", true);
})();

/* ---- gauges and status ---- */
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The reaction";
  [["rel", "Mediator release", "g-cyt", "How much histamine, complement, cytokines or killing molecules are released."], ["dmg", "Tissue damage", "g-bad", "How much tissue is injured: swelling, cell loss, vessel wall damage."], ["spd", "Onset speed", "g-fl", "How fast the reaction starts: minutes for type I, one to three days for type IV."], ["sev", "Severity", "g-clot", "Overall severity of the reaction."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 170 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
}
let curType = -1, clk = 0;
function init() { types.forEach((t) => (t.g.style.opacity = 0)); initPanel(); }
function setType(m) { curType = m.type; clk = 0; document.querySelectorAll(".sc-card").forEach((c, i) => c.classList.toggle("on", i === m.type)); }
function step(dt, m) {
  if (m.type !== curType) setType(m);
  clk += dt; const ph = clk % CYC[m.type];
  types.forEach((t, i) => { const want = i === m.type ? 1 : 0, cur = parseFloat(t.g.style.opacity || 0), nx = cur + (want - cur) * Math.min(1, dt * 5); t.g.style.opacity = nx.toFixed(3); t.g.style.display = nx < 0.01 && !want ? "none" : ""; });
  types[m.type].upd(dt, ph, m);
  labels.forEach((l) => { l.g.style.display = l.ty === m.type ? "" : "none"; });
  marks.forEach((k2) => { k2.g.style.display = k2.ty === m.type && k2.drugs.indexOf(m.drug) > -1 ? "" : "none"; });
  gg.rel.set(m.R, wordOf(m.R, 0.25, 0.6, ["low", "moderate", "high"])); gg.dmg.set(m.D, wordOf(m.D, 0.25, 0.55, ["little", "some", "marked"]));
  gg.spd.set(m.speed, wordOf(m.speed, 0.3, 0.7, ["slow", "hours", "minutes"])); gg.sev.set(m.S, wordOf(m.S, 0.25, 0.55, ["mild", "moderate", "severe"]));
}
run({ init, step });
