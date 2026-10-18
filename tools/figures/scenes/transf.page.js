/* Transfusion reactions scene: six mechanisms (ABO acute, febrile, allergic, TRALI, TACO, delayed), one shown at a time. */
const ease = (u) => u * u * (3 - 2 * u), ramp = (t, a, b) => clamp((t - a) / (b - a));
const LY = { stage: $("stage"), over: $("over"), panel: $("panel") };
const CYC = [14, 11, 12, 14, 13, 16], W = SC.W;
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abY(parent, x, y, rot, sc, cls) { const g = mk("g", {}, parent); mk("path", { class: cls || "ab-p", d: "M0 7L0 0M0 0L-5.5 -6.5M0 0L5.5 -6.5" }, g); place(g, x, y, rot, sc || 1); return g; }
function hexAt(parent, r, cls) { const pts = []; for (let i = 0; i < 6; i++) { const a = i * 1.0472 + 0.5; pts.push(f1(r * Math.cos(a)) + " " + f1(r * Math.sin(a))); } return mk("path", { class: cls || "ag", d: "M" + pts.join("L") + "Z" }, parent); }
const dotP = (parent, cls, r) => mk("circle", { class: "sc-p " + cls, r: r || 2.6 }, parent);
const droplet = (parent) => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, parent);
function bag(parent, x, y, label) { const g = mk("g", {}, parent); mk("rect", { class: "tf-bag", x: x, y: y, width: 52, height: 72, rx: 10 }, g); mk("rect", { class: "tf-bag", x: x + 8, y: y + 10, width: 36, height: 20, rx: 4 }, g); const t = mk("text", { class: "sc-lab", x: x + 26, y: y + 24, "text-anchor": "middle" }, g); t.textContent = label; mk("path", { class: "tf-tube", d: "M" + (x + 26) + " " + (y + 72) + " C " + (x + 30) + " " + (y + 110) + ", " + (x + 90) + " " + (y + 108) + ", " + (x + 118) + " " + (y + 92) }, g); return g; }
const types = [], marks = [], labels = [];
function addLabel(ty, text, x, y, tx, ty2, tip) { const g = pill(LY.over, text, x, y, tx, ty2, tip); labels.push({ g, ty }); return g; }
function addMark(ty, drugs, x, y, text, tx, tyy, tip, good) {
  const g = mk("g", {}, LY.over);
  if (good) { mk("path", { class: "mk-g", d: "M" + f1(x - 6) + " " + f1(y) + "l4 5l8 -10" }, g); } else { mk("circle", { class: "mk-c", cx: f1(x), cy: f1(y), r: 8 }, g); mk("path", { class: "mk-x", d: "M" + f1(x - 4) + " " + f1(y - 4) + "l8 8M" + f1(x + 4) + " " + f1(y - 4) + "l-8 8" }, g); }
  pill(g, text, x, y, tx, tyy, tip); marks.push({ g, ty, drugs }); return g;
}

/* ================= 0: ABO acute haemolytic ================= */
(function () {
  const g = mk("g", {}, LY.stage);
  bag(g, 56, 158, "A / B");
  const AX = 250, AY = 272;
  const tgt = mk("g", {}, g); cell(tgt, { cls: "rbc", r: 42, seed: 9, wob: 0.05 }); place(tgt, AX, AY, 0, 1);
  const ags = Array.from({ length: 10 }, (_, i) => { const a = i * 0.628; return mk("rect", { class: "ag", x: -2.6, y: -2.6, width: 5.2, height: 5.2, transform: "translate(" + f1(AX + Math.cos(a) * 44) + " " + f1(AY + Math.sin(a) * 44) + ") rotate(" + f1(a * 57.3) + ")" }, g); });
  const igms = Array.from({ length: 7 }, (_, i) => { const a = i * 0.9 + 0.3; return { g: abY(g, AX + Math.cos(a) * 82, AY + Math.sin(a) * 82, a * 57.3 + 90, 1.15, "ab-igm"), a }; });
  const comp = Array.from({ length: 10 }, (_, i) => ({ e: dotP(g, "p-comp", 3.2), a: i * 0.628 + 0.2 }));
  const pores = Array.from({ length: 4 }, (_, i) => { const a = i * 1.57 + 0.6; return mk("circle", { class: "mk-c", cx: f1(AX + Math.cos(a) * 42), cy: f1(AY + Math.sin(a) * 42), r: 3.4 }, g); });
  const frag = mkPool(12, () => mk("ellipse", { class: "sc-p p-hb", rx: 4, ry: 2.6 }, g));
  const hb = mkPool(36, () => dotP(g, "p-hb", 2.4));
  mk("rect", { class: "sc-lum2", x: 440, y: 318, width: 490, height: 52, rx: 10 }, g);
  const clumps = Array.from({ length: 5 }, (_, i) => { const e = mk("g", { class: "cl cl-rbc" }, g); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, e); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4, transform: "translate(10 4)" }, e); return { e, x: 470 + i * 88, y: 344 }; });
  const kid = mk("g", {}, g); mk("path", { class: "tf-kid", d: "M830 190c-26 -18 -52 4 -48 30c3 22 28 36 50 24c18 -10 16 -40 -2 -54Z" }, kid); mk("path", { class: "tf-tube", d: "M806 214c10 8 22 8 30 -2" }, kid);
  let lysed = 0, acc = 0;
  types.push({ g, upd(dt, ph, m) {
    const bind = ramp(ph, 1, 3), comps = ramp(ph, 3, 5), lyse = ramp(ph, 5.4, 6.6) * (m.H > 0.2 ? 1 : 0), back = ramp(ph, 11.5, 12.8);
    const gone = lyse * (1 - back), trig = m.drug === 0 ? 1 : 0.55;
    igms.forEach((a) => { const r = lerp(90, 57, ease(clamp(bind * trig + 0.2))); a.g.setAttribute("transform", "translate(" + f1(AX + Math.cos(a.a) * r) + " " + f1(AY + Math.sin(a.a) * r) + ") rotate(" + f1(a.a * 57.3 + 90) + ")"); a.g.setAttribute("opacity", (0.25 + 0.75 * bind).toFixed(2)); });
    comp.forEach((c, i) => { const r = 54 + (i % 2) * 4; c.e.setAttribute("transform", "translate(" + f1(AX + Math.cos(c.a) * r) + " " + f1(AY + Math.sin(c.a) * r) + ")"); c.e.setAttribute("opacity", (comps * m.R > 0.15 ? Math.min(1, comps * 1.2) : 0).toFixed(2)); });
    pores.forEach((p) => p.setAttribute("opacity", (comps > 0.9 && m.H > 0.2 ? 1 : 0).toFixed(2)));
    tgt.setAttribute("transform", "translate(" + AX + " " + AY + ") scale(" + f1(Math.max(0.05, 1 - 0.92 * gone)) + ")"); tgt.setAttribute("opacity", (1 - gone).toFixed(2));
    ags.forEach((s) => s.setAttribute("opacity", (1 - gone).toFixed(2)));
    if (lyse > 0.5 && lysed === 0) { lysed = 1; frag.forEach((p) => emit(p, AX, AY, rnd(-60, 60), rnd(-55, 55), 0)); } if (ph < 1) lysed = 0;
    frag.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.97; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.t > 3) kill(p); });
    acc += dt * m.H * 14 * (0.3 + gone); while (acc >= 1) { acc--; const p = freeP(hb); if (p) emit(p, 450, rnd(328, 360), rnd(30, 60), rnd(-4, 4), 0); }
    hb.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 925 || p.t > 7) kill(p); });
    clumps.forEach((c, i) => { c.x += dt * (10 + 8 * m.C); if (c.x > 925) c.x = 450; place(c.e, c.x, c.y + Math.sin(tm / 500 + i) * 2, 0, 0.7 + 0.5 * m.H); });
    kid.setAttribute("opacity", (0.35 + 0.65 * m.H).toFixed(2));
  } });
  addLabel(0, "Donor red cell", AX, AY - 44, 210, 164, "A donor red cell carrying A or B antigen that the recipient lacks. Group O recipients and wrong-unit errors are the classic setting.");
  addLabel(0, "Recipient IgM", AX + 82, AY + 30, 360, 392, "Preformed IgM binds the donor antigen at once. IgM is a strong complement fixer.");
  addLabel(0, "Complement burst", AX - 56, AY + 26, 120, 392, "Complement punches holes in the donor cell (membrane attack complex), so it bursts inside the vessel: intravascular haemolysis.");
  addLabel(0, "Free haemoglobin", 640, 326, 660, 286, "Free haemoglobin and red-cell stroma enter the plasma: dark urine, falling blood pressure, clotting activation and kidney injury can follow.");
  addLabel(0, "Kidney at risk", 806, 186, 830, 150, "Free haemoglobin, low pressure and clotting injure the kidney. Supporting the circulation protects it.");
  addMark(0, [1], 118, 252, "Transfusion stopped", 170, 428, "Stopping the unit at once limits how much incompatible blood enters. Rechecking identity and the unit follows.");
  addMark(0, [2], 520, 392, "Fluids support pressure and kidney", 560, 428, "Fluids restore circulating volume and kidney perfusion after haemolysis. They do not undo the haemolysis itself.", true);
  addMark(0, [4], 700, 392, "Diuretic does not fix haemolysis", 720, 428, "A diuretic cannot remove free haemoglobin or restore volume here and may worsen kidney perfusion if pressure is low.");
})();

/* ================= 1: febrile non-haemolytic ================= */
(function () {
  const g = mk("g", {}, LY.stage);
  bag(g, 56, 158, "unit");
  const WX = 250, WY = 272;
  const wbc = mk("g", {}, g); cell(wbc, { cls: "neut", r: 38, nuc: 0.55, nucCls: "multi", seed: 7, wob: 0.13 }); place(wbc, WX, WY, 0, 1);
  const cytk = mkPool(44, () => dotP(g, "p-cytk", 2.4));
  const frag2 = mkPool(10, () => dotP(g, "p-cytk", 3));
  const thX = 720, thY = 290;
  mk("rect", { class: "tf-therm", x: thX - 7, y: 170, width: 14, height: 120, rx: 7 }, g);
  const merc = mk("rect", { class: "tf-merc", x: thX - 3.5, y: 280, width: 7, height: 10, rx: 3 }, g);
  mk("circle", { class: "tf-merc", cx: thX, cy: 302, r: 13 }, g);
  const waves = [0, 1, 2].map((i) => mk("path", { class: "tf-tube", d: "M" + (500 + i * 36) + " 210 q10 -14 0 -28 q-10 -14 0 -28", opacity: 0 }, g));
  mk("rect", { class: "sc-lum2", x: 440, y: 330, width: 490, height: 44, rx: 10 }, g);
  const rbs = Array.from({ length: 7 }, (_, i) => { const e = mk("g", { class: "cl cl-rbc" }, g); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, e); return { e, x: 460 + i * 66, y: 352 }; });
  let acc = 0, burst = 0;
  types.push({ g, upd(dt, ph, m) {
    const rel = ramp(ph, 2, 5) * m.R, fever = ramp(ph, 4, 8) * m.R;
    wbc.setAttribute("transform", "translate(" + WX + " " + WY + ") scale(" + (1 - 0.25 * rel).toFixed(3) + ")"); wbc.setAttribute("opacity", (1 - 0.45 * rel).toFixed(2));
    if (rel > 0.4 && burst === 0) { burst = 1; frag2.forEach((p) => emit(p, WX, WY, rnd(-45, 45), rnd(-45, 45), 0)); } if (ph < 1) burst = 0;
    frag2.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.5).toFixed(2)); if (p.t > 2.5) kill(p); });
    acc += dt * rel * 16; while (acc >= 1) { acc--; const p = freeP(cytk); if (p) emit(p, WX + rnd(-20, 20), WY + rnd(-16, 16), rnd(28, 52), rnd(-18, 6), 0); }
    cytk.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx += (thX - p.x) * dt * 0.12; p.vy += (230 - p.y) * dt * 0.1; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 5) kill(p); });
    const mh = 10 + 100 * fever; merc.setAttribute("y", f1(290 - mh)); merc.setAttribute("height", f1(mh));
    waves.forEach((wv, i) => wv.setAttribute("opacity", (fever * (0.4 + 0.3 * Math.sin(tm / 300 + i))).toFixed(2)));
    rbs.forEach((r) => { r.x += dt * 42; if (r.x > 925) r.x = 450; place(r.e, r.x, r.y, 0, 1); });
  } });
  addLabel(1, "Donor white cell", WX, WY - 40, 220, 164, "Donor leucocytes in the unit. Recipient antibody reacts with them; cytokines also build up in stored blood.");
  addLabel(1, "Cytokines released", 400, 240, 400, 180, "Cytokines from the white-cell reaction act on the temperature centre. The red cells themselves are not destroyed.");
  addLabel(1, "Fever and rigors", thX, 160, thX, 140, "Temperature rises during or soon after transfusion, often with shivering (rigors). Haemolysis must still be excluded.");
  addLabel(1, "Red cells intact", 640, 338, 640, 404, "The vessel shows intact red cells passing: this reaction causes fever without haemolysis.");
  addMark(1, [1], 118, 252, "Transfusion stopped", 170, 428, "Stopping and assessing is still the first step, because fever can be the first sign of a haemolytic or contaminated unit.");
  addMark(1, [3], 520, 200, "Symptoms eased", 560, 160, "Antihistamine and steroid ease allergic-type symptoms and inflammation here; fever itself is usually settled with an antipyretic in practice (not shown).", true);
})();

/* ================= 2: allergic / anaphylactic ================= */
(function () {
  const g = mk("g", {}, LY.stage);
  bag(g, 56, 158, "plasma");
  const MX = 250, MY = 272;
  const mast = mk("g", {}, g); cell(mast, { cls: "mast", r: 40, nuc: 0.32, seed: 4, wob: 0.07 }); place(mast, MX, MY, 0, 1);
  const grans = Array.from({ length: 14 }, (_, i) => { const a = i * 2.4, r = 10 + (i % 4) * 6; return mk("circle", { class: "sc-p p-gran", cx: f1(MX + Math.cos(a) * r), cy: f1(MY + Math.sin(a) * r), r: 3.2 }, g); });
  for (let i = 0; i < 9; i++) { const a = i * 0.698 - 1.2; abY(g, MX + Math.cos(a) * 46, MY + Math.sin(a) * 46, a * 57.3 + 90, 1); }
  const hist = mkPool(60, () => dotP(g, "p-hist", 2.3)), leak = mkPool(22, () => droplet(g));
  const skin = mk("ellipse", { class: "tf-skin", cx: 720, cy: 225, rx: 120, ry: 62 }, g);
  const wheals = [0, 1, 2, 3].map((i) => mk("ellipse", { class: "tf-wheal", cx: 660 + (i % 2) * 110, cy: 200 + Math.floor(i / 2) * 48, rx: 26, ry: 13, opacity: 0 }, g));
  const oed = mk("rect", { class: "sc-oed", x: 440, y: 150, width: 490, height: 120, rx: 14, opacity: 0 }, g); g.insertBefore(oed, skin);
  mk("rect", { class: "sc-lum2", x: 440, y: 330, width: 490, height: 44, rx: 10 }, g);
  const rbs = Array.from({ length: 7 }, (_, i) => { const e = mk("g", { class: "cl cl-rbc" }, g); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, e); return { e, x: 460 + i * 66, y: 352 }; });
  let acc = 0, accL = 0;
  types.push({ g, upd(dt, ph, m) {
    const deg = ramp(ph, 2.5, 4.5) * (1 - ramp(ph, 9, 10.5)) * m.R, dil = ramp(ph, 4.5, 7) * m.C;
    mast.setAttribute("transform", "translate(" + MX + " " + MY + ") scale(" + (1 + 0.05 * Math.sin(tm / 90) * deg).toFixed(3) + ")");
    grans.forEach((gr, i) => gr.setAttribute("opacity", (1 - 0.8 * ramp(ph, 3 + (i % 7) * 0.15, 6) * m.R).toFixed(2)));
    acc += dt * deg * 26; while (acc >= 1) { acc--; const p = freeP(hist), a = rnd(-0.9, 0.9); if (p) emit(p, MX + Math.cos(a) * 44, MY + Math.sin(a) * 44, Math.cos(a) * 46 + 30, Math.sin(a) * 28, 0); }
    hist.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx += (700 - p.x) * dt * 0.1; p.vy += (250 - p.y) * dt * 0.15; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 6) kill(p); });
    wheals.forEach((wv, i) => wv.setAttribute("opacity", (dil * (0.5 + 0.15 * Math.sin(tm / 400 + i))).toFixed(2)));
    oed.setAttribute("opacity", (0.4 * dil).toFixed(2));
    accL += dt * dil * 7; while (accL >= 1) { accL--; const p = freeP(leak); if (p) emit(p, rnd(480, 900), 326, rnd(-3, 3), -rnd(12, 20), 0); }
    leak.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3) kill(p); });
    rbs.forEach((r) => { r.x += dt * 36; if (r.x > 925) r.x = 450; place(r.e, r.x, r.y, 0, 1); });
  } });
  addLabel(2, "Mast cell", MX - 20, MY - 38, 200, 164, "Mast cell with IgE on its surface. Donor plasma proteins trigger mediator release in a sensitised recipient.");
  addLabel(2, "Histamine", 420, 280, 410, 180, "Histamine widens and leaks small vessels: flushing, itching and urticaria (hives) within minutes.");
  addLabel(2, "Urticaria (skin)", 720, 170, 730, 140, "Raised itchy wheals on the skin. Lip and airway swelling and wheeze mark the severe end (anaphylaxis).");
  addLabel(2, "Leaky vessel", 640, 338, 640, 404, "Widespread leak and widening can drop blood pressure in anaphylaxis.");
  addMark(2, [1], 118, 252, "Transfusion stopped", 170, 428, "Stopping the unit removes the donor plasma proteins driving the reaction.");
  addMark(2, [3], 560, 300, "Histamine blocked, inflammation calmed", 580, 428, "An antihistamine blocks histamine effects and a steroid calms later inflammation. Anaphylaxis itself needs adrenaline in practice (not a toggle here).", true);
})();

/* ================= 3: TRALI ================= */
(function () {
  const g = mk("g", {}, LY.stage);
  bag(g, 56, 158, "unit");
  const AX = 500, AY = 268;
  const fluid = mk("circle", { class: "tf-fluid", cx: AX, cy: AY, r: 62, opacity: 0 }, g);
  mk("circle", { class: "tf-alv", cx: AX, cy: AY, r: 88 }, g);
  mk("path", { class: "tf-cap", d: "M" + (AX - 108) + " " + (AY + 52) + " A 118 118 0 0 1 " + (AX + 108) + " " + (AY + 52) }, g);
  const neuts = [0, 1, 2, 3].map((i) => { const e = mk("g", {}, g); cell(e, { cls: "neut", r: 14, nuc: 0.55, nucCls: "multi", seed: i + 30, wob: 0.14 }); const a = -2.4 + i * 0.55; place(e, AX + Math.cos(a) * 104, AY + Math.sin(a) * 104, 0, 1); return e; });
  const abDots = Array.from({ length: 8 }, (_, i) => ({ e: dotP(g, "p-comp", 3), a: -2.4 + i * 0.34 }));
  const leaks = mkPool(26, () => droplet(g)), oxy = mkPool(20, () => dotP(g, "p-oxy", 2.6));
  const heart = mk("g", {}, g); mk("path", { class: "tf-heart", d: "M790 330c-22 -26 -58 -8 -58 18c0 22 30 34 58 52c28 -18 58 -30 58 -52c0 -26 -36 -44 -58 -18Z" }, heart);
  let acc = 0, accO = 0;
  types.push({ g, upd(dt, ph, m) {
    const act = ramp(ph, 2, 5) * m.R, fill = ramp(ph, 5, 9) * m.L;
    neuts.forEach((n, i) => place(n, AX + Math.cos(-2.4 + i * 0.55) * 104, AY + Math.sin(-2.4 + i * 0.55) * 104 + Math.sin(tm / 400 + i) * 2, 0, 1 + 0.15 * act));
    abDots.forEach((d) => { d.e.setAttribute("transform", "translate(" + f1(AX + Math.cos(d.a) * 92) + " " + f1(AY + Math.sin(d.a) * 92) + ")"); d.e.setAttribute("opacity", (act).toFixed(2)); });
    fluid.setAttribute("opacity", (0.55 * fill).toFixed(2)); fluid.setAttribute("r", f1(30 + 38 * fill));
    acc += dt * act * 9; while (acc >= 1) { acc--; const p = freeP(leaks), a = rnd(-2.6, -0.6); if (p) emit(p, AX + Math.cos(a) * 96, AY + Math.sin(a) * 96, -Math.cos(a) * 16, -Math.sin(a) * 16, 0); }
    leaks.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.6) kill(p); });
    accO += dt * 5; while (accO >= 1) { accO--; const p = freeP(oxy); if (p) emit(p, AX + rnd(-50, 50), AY - 70, 0, 26, 0); }
    oxy.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt * (1 - 0.7 * fill); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - fill * 0.8).toFixed(2)); if (p.y > AY + 60 || p.t > 4) kill(p); });
    heart.setAttribute("opacity", (0.45 + 0.2 * Math.sin(tm / 300)).toFixed(2));
  } });
  addLabel(3, "Donor antibody", 380, 190, 330, 150, "Donor anti-leucocyte antibodies (against neutrophil or HLA antigens) enter with the component, often plasma-rich units.");
  addLabel(3, "Neutrophils in lung capillary", AX - 100, AY + 40, 300, 392, "Activated neutrophils stick in lung capillaries and injure the capillary lining.");
  addLabel(3, "Fluid in alveolus", AX, AY - 20, AX + 40, 150, "Protein-rich fluid leaks into the alveolus (non-cardiogenic oedema). Breathing and oxygenation fail within hours of transfusion.");
  addLabel(3, "Heart not overloaded", 790, 318, 810, 428, "The heart and filling pressures are not the problem in TRALI, which helps tell it from TACO.");
  addMark(3, [1], 118, 252, "Transfusion stopped", 170, 428, "Stopping the unit limits further donor antibody. Breathing support is the mainstay in practice (not a toggle here).");
  addMark(3, [2], 640, 360, "Extra fluid can worsen lungs", 620, 428, "Fluids do not clear alveolar leak and can add to lung fluid when capillaries are injured.");
  addMark(3, [4], 700, 200, "Diuretic does not clear this fluid", 760, 160, "Because the fluid is a capillary leak, not volume overload, a diuretic does little in TRALI. This contrasts with TACO.");
})();

/* ================= 4: TACO ================= */
(function () {
  const g = mk("g", {}, LY.stage);
  bag(g, 56, 158, "unit");
  const AX = 640, AY = 268;
  const fluid = mk("circle", { class: "tf-fluid", cx: AX, cy: AY, r: 62, opacity: 0 }, g);
  mk("circle", { class: "tf-alv", cx: AX, cy: AY, r: 88 }, g);
  const ves = mk("rect", { class: "sc-lum2", x: 200, y: 330, width: 560, height: 44, rx: 12 }, g);
  const heart = mk("g", {}, g); mk("path", { class: "tf-heart", d: "M300 210c-22 -26 -58 -8 -58 18c0 22 30 34 58 52c28 -18 58 -30 58 -52c0 -26 -36 -44 -58 -18Z" }, heart);
  const rbs = Array.from({ length: 9 }, (_, i) => { const e = mk("g", { class: "cl cl-rbc" }, g); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, e); return { e, x: 220 + i * 58, y: 352 }; });
  const drops = mkPool(24, () => droplet(g)), urine = mkPool(16, () => droplet(g));
  const kid = mk("g", {}, g); mk("path", { class: "tf-kid", d: "M850 320c-24 -16 -48 4 -44 28c3 20 26 32 46 22c16 -9 14 -36 -2 -50Z" }, kid);
  let acc = 0, accU = 0;
  types.push({ g, upd(dt, ph, m) {
    const fill = ramp(ph, 3, 8) * m.L, strain = m.C;
    fluid.setAttribute("opacity", (0.55 * fill).toFixed(2)); fluid.setAttribute("r", f1(30 + 38 * fill));
    ves.setAttribute("height", f1(44 + 18 * strain)); ves.setAttribute("y", f1(330 - 9 * strain));
    heart.setAttribute("transform", "translate(0 0) scale(1)"); heart.setAttribute("opacity", (0.6 + 0.3 * strain * (0.5 + 0.5 * Math.sin(tm / 280))).toFixed(2));
    rbs.forEach((r) => { r.x += dt * (26 + 20 * strain); if (r.x > 750) r.x = 210; place(r.e, r.x, 352 + Math.sin(tm / 500 + r.x) * 2, 0, 1); });
    acc += dt * strain * 7; while (acc >= 1) { acc--; const p = freeP(drops); if (p) emit(p, rnd(460, 580), 322, rnd(-3, 3), -rnd(20, 30), 0); }
    drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx += (AX - p.x) * dt * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3) kill(p); });
    const diu = m.drug === 4 ? 1 : 0;
    accU += dt * diu * 8; while (accU >= 1) { accU--; const p = freeP(urine); if (p) emit(p, 850, 372, rnd(-4, 4), rnd(18, 28), 0); }
    urine.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2) kill(p); });
    kid.setAttribute("opacity", (0.4 + 0.6 * diu).toFixed(2));
  } });
  addLabel(4, "Strained heart", 300, 196, 280, 150, "A heart (or kidney) that cannot handle extra volume: older age, cardiac failure and renal impairment raise the risk.");
  addLabel(4, "Volume in the vessel", 420, 338, 400, 404, "Transfused volume raises filling pressures. The vessel is fuller and pressure backs up toward the lungs.");
  addLabel(4, "Fluid in alveolus", AX, AY - 20, AX + 60, 150, "Raised pressure pushes fluid into alveoli (cardiogenic pulmonary oedema): breathlessness, raised venous pressure, often high blood pressure.");
  addLabel(4, "Kidney", 850, 312, 860, 428, "The kidney can unload salt and water when given a diuretic, lowering filling pressures.");
  addMark(4, [1], 118, 252, "Transfusion stopped or slowed", 180, 428, "Stopping or slowing the unit limits further volume. Sitting the patient up and oxygen help in practice (not toggles here).");
  addMark(4, [2], 500, 392, "Extra fluid worsens overload", 520, 428, "More fluid raises filling pressures further and pushes more fluid into the lungs in TACO.");
  addMark(4, [4], 760, 360, "Diuretic unloads volume", 720, 404, "A diuretic increases urine output and lowers filling pressures, clearing cardiogenic lung fluid. This is the TACO treatment that does not help TRALI.", true);
})();

/* ================= 5: delayed haemolytic ================= */
(function () {
  const g = mk("g", {}, LY.stage);
  const bagG = bag(g, 56, 158, "unit"); bagG.setAttribute("opacity", "0.45");
  const clk = mk("g", {}, g); mk("circle", { class: "clk", cx: 300, cy: 205, r: 24 }, clk); const hand = mk("path", { class: "clk-h", d: "M300 205L300 188" }, clk); const ct = mk("text", { class: "dr-pt2", x: 300, y: 243, "text-anchor": "middle" }, clk); ct.textContent = "day 0";
  const SX = 640, SY = 272;
  const mac = mk("g", {}, g); cell(mac, { cls: "mac", r: 44, nuc: 0.4, seed: 23, wob: 0.12 }); place(mac, SX, SY, 0, 1);
  const tgt = mk("g", {}, g); cell(tgt, { cls: "rbc", r: 30, seed: 11, wob: 0.05 });
  const coat = Array.from({ length: 8 }, (_, i) => ({ e: dotP(g, "p-comp", 2.6), a: i * 0.785 }));
  const iggs = Array.from({ length: 6 }, (_, i) => { const a = i * 1.047 + 0.3; return { g: abY(g, 470 + Math.cos(a) * 30, 250 + Math.sin(a) * 30, a * 57.3 + 90, 0.9), a }; });
  const bili = mkPool(30, () => dotP(g, "p-bili", 2.6));
  const mem = mk("g", {}, g); cell(mem, { cls: "bcell", r: 22, nuc: 0.45, seed: 31, wob: 0.1 }); place(mem, 430, 330, 0, 1);
  let acc = 0;
  types.push({ g, upd(dt, ph, m) {
    const days = ph / 16 * 7, prime = ramp(ph, 3, 7) * m.R, eat = ramp(ph, 8, 13) * m.H;
    hand.setAttribute("transform", "rotate(" + f1(ph / 16 * 360 * 1.5) + " 300 205)"); const d = Math.floor(days); if (ct.textContent !== "day " + d) ct.textContent = "day " + d;
    iggs.forEach((a, i) => { const tx = lerp(470, 545, ease(prime)), ty = lerp(250, SY, ease(prime)); a.g.setAttribute("transform", "translate(" + f1(tx + Math.cos(a.a) * 18) + " " + f1(ty + Math.sin(a.a) * 18) + ") rotate(" + f1(a.a * 57.3 + 90) + ")"); a.g.setAttribute("opacity", (0.2 + 0.8 * prime).toFixed(2)); });
    const tx2 = lerp(545, SX - 30, ease(eat)), sc = 1 - 0.75 * eat;
    place(tgt, tx2, SY + Math.sin(tm / 500) * 2, 0, Math.max(0.1, sc)); tgt.setAttribute("opacity", (1 - 0.85 * eat).toFixed(2));
    coat.forEach((c) => { c.e.setAttribute("transform", "translate(" + f1(tx2 + Math.cos(c.a) * 30 * sc) + " " + f1(SY + Math.sin(c.a) * 30 * sc) + ")"); c.e.setAttribute("opacity", (prime * (1 - eat)).toFixed(2)); });
    place(mac, SX, SY, 0, 1 + 0.18 * eat); mem.setAttribute("opacity", (0.5 + 0.5 * prime).toFixed(2));
    acc += dt * eat * 12; while (acc >= 1) { acc--; const p = freeP(bili); if (p) emit(p, SX - 20, SY - 20, rnd(-18, 18), rnd(-36, -18), 0); }
    bili.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.t > 3) kill(p); });
  } });
  addLabel(5, "Earlier transfusion", 82, 150, 120, 140, "The sensitising transfusion (or pregnancy) was days to weeks earlier. The antibody was too low to detect at cross-match.");
  addLabel(5, "Memory response", 430, 306, 420, 392, "Memory B cells rapidly make IgG against a minor donor antigen (classically Kidd) after re-exposure: an anamnestic response.");
  addLabel(5, "Coated donor cell", 545, 240, 520, 170, "IgG-coated donor red cells are recognised by splenic macrophages. The cells are removed outside vessels: extravascular haemolysis.");
  addLabel(5, "Spleen macrophage", SX, SY - 46, SX + 20, 170, "The spleen removes coated cells. Breakdown releases bilirubin: jaundice with a falling haemoglobin days after transfusion.");
  addLabel(5, "Days later (clock)", 300, 180, 300, 140, "Delayed means days later, not minutes. An unexpectedly falling haemoglobin with jaundice after transfusion is the clue.");
  addMark(5, [1], 118, 252, "Little left to stop", 170, 428, "By the time a delayed reaction appears the unit has long finished, so stopping cannot undo it. Assessment and monitoring follow.");
  addMark(5, [2], 560, 360, "Fluids support only", 580, 428, "Fluids support the circulation while coated cells are cleared; they do not stop the antibody response.", true);
})();

/* ---- gauges and status ---- */
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The patient";
  [["rel", "Reaction", "g-cyt", "Immune reaction activity: antibody, complement, histamine, cytokines or neutrophil activation, depending on the type."], ["haem", "Haemolysis", "g-bad", "Red-cell destruction: intravascular bursting in ABO incompatibility, extravascular removal in the spleen in a delayed reaction."], ["lung", "Lung fluid", "g-fl", "Fluid in the alveoli causing breathlessness: capillary leak in TRALI, raised pressure in TACO, widespread allergic leak in anaphylaxis."], ["sev", "Severity", "g-clot", "Overall severity of the reaction."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 170 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
}
let curType = -1, clk2 = 0;
function init() { types.forEach((t) => (t.g.style.opacity = 0)); initPanel(); }
function setType(m) { curType = m.type; clk2 = 0; document.querySelectorAll(".sc-card").forEach((c, i) => c.classList.toggle("on", i === m.type)); }
function step(dt, m) {
  if (m.type !== curType) setType(m);
  clk2 += dt; const ph = clk2 % CYC[m.type];
  types.forEach((t, i) => { const want = i === m.type ? 1 : 0, cur = parseFloat(t.g.style.opacity || 0), nx = cur + (want - cur) * Math.min(1, dt * 5); t.g.style.opacity = nx.toFixed(3); t.g.style.display = nx < 0.01 && !want ? "none" : ""; });
  types[m.type].upd(dt, ph, m);
  labels.forEach((l) => { l.g.style.display = l.ty === m.type ? "" : "none"; });
  marks.forEach((k2) => { k2.g.style.display = k2.ty === m.type && k2.drugs.indexOf(m.drug) > -1 ? "" : "none"; });
  gg.rel.set(m.R, wordOf(m.R, 0.25, 0.6, ["low", "moderate", "high"])); gg.haem.set(m.H, wordOf(m.H, 0.2, 0.55, ["little", "some", "marked"]));
  gg.lung.set(m.L, wordOf(m.L, 0.25, 0.6, ["little", "some", "marked"])); gg.sev.set(m.S, wordOf(m.S, 0.25, 0.55, ["mild", "moderate", "severe"]));
}
run({ init, step });
