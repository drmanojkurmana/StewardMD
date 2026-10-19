/* Carboplatin scene: tumour DNA crosslinks, renal clearance, marrow platelets, kidney, ear, gut, allergy and gauges. */
const CB = { nod: $("nodSlot"), kid: $("kidSlot"), ear: $("earSlot"), bowel: $("bowelSlot"), mar: $("marSlot"), mast: $("mastSlot"), parts: $("parts"), over: $("over"), panel: $("panel"), tumCell: $("tumCell"), marCav: $("marCav"), blush: $("allerBlush") };
const CBW = SC.W;
let kidneyO = null, earO = null, bowelO = null, cbCapEl = null, cbCapD = -1, cbCapL = -1;
function cbPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const cbFree = (pl) => pl.find((p) => !p.on);
function cbEmit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function cbKill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

function cbInitOrgans() {
  kidneyO = organ(CB.kid, "kidney", 595, 185, 110, {});
  earO = organ(CB.ear, "ear", 595, 335, 110, {});
  bowelO = organ(CB.bowel, "bowel", 800, 335, 130, {});
}
function cbCapText(d, l) {
  if (d === 0) return "No treatment. The tumour keeps growing. Marrow, kidney, hearing and gut stay settled.";
  if (d === 1) {
    if (l === 0) return "Carboplatin reaches tumour DNA and starts crosslinks. Platelets begin to fall.";
    if (l === 1) return "Crosslinks stop the tumour copying DNA. Tumour kill rises as platelets fall.";
    return "Late cycles deepen tumour kill. Platelets run very low and allergy becomes likely.";
  }
  if (d === 2) {
    if (l === 0) return "Dose set to kidney function. The kidney clears the drug steadily.";
    if (l === 1) return "Kidney based dosing holds tumour kill while kidney harm stays mild.";
    return "Late cycles with kidney based dosing. Kidney harm stays mild but allergy can still appear.";
  }
  if (l === 0) return "Count and allergy support alongside carboplatin. Early crosslinks form.";
  if (l === 1) return "Support steadies counts while crosslinks hold the tumour.";
  return "Late cycles with support. Platelets steadied and allergy risk lowered.";
}

/* ---- fixed cells: tumour nodules, marrow platelets, mast cells ---- */
const cbNods = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * 6.2832 + 0.2, x = 240 + 135 * Math.cos(a), y = 255 + 115 * Math.sin(a);
  const g = mk("g", {}, CB.nod); cell(g, { cls: "tum", r: 11 + (i % 3), nuc: 0.45, seed: i + 5, wob: 0.1 });
  place(g, x, y, 0, 1); return { g, x, y, s: 1, i };
});
const cbPlts = Array.from({ length: 10 }, (_, i) => {
  const g = mk("g", {}, CB.mar); cell(g, { cls: "plt", r: 5, seed: i + 40, wob: 0.15, n: 7 });
  const x = 758 + (i * 37) % 84, y = 185 + ((i * 53) % 13) - 6;
  place(g, x, y, 0, 1); return { g, x, y, v: 18 + (i % 4) * 4, i };
});
const cbMasts = [[892, 296, 10], [908, 348, 9]].map(([x, y, r], i) => {
  const g = mk("g", {}, CB.mast); cell(g, { cls: "mast", r, nuc: 0.4, seed: i + 90, wob: 0.12 });
  place(g, x, y, 0, 1); return { g, x, y };
});
const cbXlinks = Array.from($("xlinks").childNodes).filter((n) => n.setAttribute);

/* ---- particle pools (pool items expose their element as p.e) ---- */
const cbCarbo = cbPool(22, () => mk("circle", { class: "sc-p p-carbo", r: 2.8 }, CB.parts));
const cbKid = cbPool(14, () => mk("circle", { class: "sc-p p-kid", r: 2.4 }, CB.parts));
const cbHist = cbPool(16, () => mk("circle", { class: "sc-p p-hist", r: 2.2 }, CB.parts));
const cbGut = cbPool(10, () => mk("path", { class: "sc-p p-gut", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, CB.parts));
const cbDeb = cbPool(12, () => mk("circle", { class: "sc-p p-deb", r: 2 }, CB.parts));

/* ---- labels (at most 8, short) ---- */
function cbInitLabels() {
  const ox = CB.over;
  pill(ox, "Tumour DNA", 240, 250, 140, 100, "Tumour DNA. The target that platinum crosslinks so the cell cannot copy it.");
  pill(ox, "Carboplatin", 110, 150, 110, 135, "Carboplatin. A platinum drug with a stable leaving group that activates inside the cell.");
  pill(ox, "Crosslink", 255, 258, 350, 110, "Crosslink. Platinum joins the two DNA strands so copying stalls and the cell dies.");
  pill(ox, "Kidney", 595, 185, 595, 105, "Kidney clears carboplatin into urine. High levels injure tubule cells, so the dose is set to kidney function.");
  pill(ox, "Marrow", 800, 185, 800, 105, "Marrow makes platelets here. Platinum harms dividing marrow cells so platelets fall first and bleeding risk rises.");
  pill(ox, "Ear", 580, 310, 520, 262, "Inner ear. Platinum can injure hearing and balance cells and also peripheral nerves, but less so than cisplatin.");
  pill(ox, "Gut", 810, 310, 835, 256, "Gut. Platinum signals the vomiting centre through the gut, giving nausea, but less than cisplatin.");
  pill(ox, "Allergy", 892, 296, 898, 410, "Allergy after repeated cycles. Platinum can trigger histamine release with rash, breathlessness and pressure fall.");
  cbCapEl = mk("text", { class: "cb-cap", x: 30, y: 428 }, ox); cbCapEl.textContent = cbCapText(0, 1);
}

/* ---- gauges ---- */
const cbGg = {};
function cbInitPanel() {
  const P = CB.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: CBW - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "Tumour kill and side effects";
  [["kill", "Tumour kill", "g-good", "Tumour kill from DNA crosslinks. Rises with each course."],
   ["plt", "Platelets", "g-bad", "Platelets made in marrow. Platinum harms dividing marrow cells so platelets fall first."],
   ["kid", "Kidney", "g-fl", "Kidney harm from platinum in tubule cells. Milder than with cisplatin and eased by kidney based dosing."],
   ["ear", "Hearing", "g-neu", "Hearing, balance and nerve harm. Platinum injures ear and nerve cells but less so than cisplatin."],
   ["gut", "Sickness", "g-eos", "Nausea and vomiting through gut signals to the vomiting centre. Milder than with cisplatin."],
   ["all", "Allergy", "g-cyt", "Histamine allergy after repeated cycles. Watch for rash, breathlessness and pressure fall."]]
    .forEach(([id, name, cls, tip], i) => { cbGg[id] = gauge(P, 120 + i * 145, y0 + 2, 52, 18, cls, name, tip); });
}
const cbSm = { K: 0.1, P: 0.05, Kd: 0.05, E: 0.04, Sk: 0.05, A: 0.03, carbo: 0, a: 0.5 };
const cbAcc = { carbo: 0, kid: 0, hist: 0, gut: 0, deb: 0 };
function cbInit() { cbInitOrgans(); cbInitLabels(); cbInitPanel(); }
function step(dt, m) {
  const kk = Math.min(1, dt * 1.6);
  cbSm.K = lerp(cbSm.K, m.K, kk); cbSm.P = lerp(cbSm.P, m.P, kk); cbSm.Kd = lerp(cbSm.Kd, m.Kd, kk);
  cbSm.E = lerp(cbSm.E, m.E, kk); cbSm.Sk = lerp(cbSm.Sk, m.Sk, kk); cbSm.A = lerp(cbSm.A, m.A, kk);
  cbSm.carbo = lerp(cbSm.carbo, m.carbo, kk); cbSm.a = lerp(cbSm.a, m.a, kk);
  /* tumour cell: pulse with crosslink activity, shrink slightly with kill */
  const pulse = 1 + 0.06 * cbSm.carbo * Math.sin(tm / 300);
  CB.tumCell.setAttribute("transform", "translate(240 255) scale(" + (pulse * (1 - 0.08 * cbSm.K)).toFixed(3) + ") translate(-240 -255)");
  /* crosslinks glow with drug and course */
  const xo = clamp(cbSm.carbo * (0.25 + 0.75 * cbSm.a)) * (0.75 + 0.25 * Math.sin(tm / 240));
  cbXlinks.forEach((x) => x.setAttribute("opacity", xo.toFixed(2)));
  /* nodules: grow without treatment, shrink with kill */
  const want = m.carbo ? Math.round((1 - cbSm.K) * 8) : Math.round(2 + 6 * cbSm.a);
  cbNods.forEach((n, i) => {
    const on = i < want;
    n.s = lerp(n.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.2 : 2.2)));
    place(n.g, n.x + Math.sin(tm / 700 + i * 1.7) * 1.6, n.y + Math.cos(tm / 900 + i) * 1.6, Math.sin(tm / 800 + i) * 6, Math.max(0.05, n.s));
    n.g.style.opacity = n.s > 0.04 ? 1 : 0;
  });
  /* marrow cavity empties as platelets fall */
  CB.marCav.setAttribute("opacity", (1 - 0.45 * cbSm.P).toFixed(2));
  /* platelets flow out of the marrow while counts allow */
  const pn = Math.round(clamp(1 - cbSm.P * 0.9) * 10);
  cbPlts.forEach((r, i) => {
    r.x += r.v * (0.3 + 0.7 * clamp(1 - cbSm.P)) * dt;
    if (r.x > 918) { r.x = 758 + rnd(0, 20); r.y = 185 + rnd(-6, 6); }
    place(r.g, r.x, r.y + Math.sin(tm / 600 + i) * 1.5, 0, 1);
    r.g.style.opacity = i < pn ? 1 : 0;
  });
  /* ear signal waves fade as hearing harm rises */
  [0, 1, 2].forEach((i) => {
    const wv = $("ew" + i);
    if (wv) wv.setAttribute("opacity", (clamp(1 - cbSm.E) * (0.55 + 0.45 * Math.sin(tm / 350 + i * 1.2))).toFixed(2));
  });
  /* gut churn with sickness */
  Array.from($("gutChurn").childNodes).filter((n) => n.setAttribute).forEach((c, i) => {
    c.setAttribute("opacity", (0.25 + 0.75 * cbSm.Sk * (0.6 + 0.4 * Math.sin(tm / 300 + i * 2))).toFixed(2));
  });
  /* allergy blush and mast cells */
  CB.blush.setAttribute("opacity", (cbSm.A * 0.7).toFixed(2));
  cbMasts.forEach((mc, i) => place(mc.g, mc.x + Math.sin(tm / 500 + i * 2) * 1.5, mc.y + Math.cos(tm / 600 + i) * 1.5, 0, 1));
  /* kidney exit arrow with clearance */
  $("kidArrow").setAttribute("opacity", (0.25 + 0.75 * cbSm.carbo).toFixed(2));
  /* particles */
  cbAcc.carbo += dt * cbSm.carbo * (2 + 8 * cbSm.a);
  while (cbAcc.carbo >= 1) { cbAcc.carbo--; const p = cbFree(cbCarbo); if (p) cbEmit(p, rnd(50, 130), rnd(70, 110), 0, 0, 0); }
  cbCarbo.forEach((p) => {
    if (!p.on) return; p.t += dt;
    p.x += (240 - p.x) * dt * 0.8; p.y += (255 - p.y) * dt * 0.8;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (Math.hypot(240 - p.x, 255 - p.y) < 16 || p.t > 4) cbKill(p);
  });
  cbAcc.kid += dt * cbSm.carbo * 7;
  while (cbAcc.kid >= 1) { cbAcc.kid--; const p = cbFree(cbKid); if (p) cbEmit(p, 595 + rnd(-30, 30), 140, rnd(-4, 4), rnd(40, 60), 0); }
  cbKid.forEach((p) => {
    if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.y > 232 || p.t > 3) cbKill(p);
  });
  cbAcc.hist += dt * cbSm.A * 12;
  while (cbAcc.hist >= 1) { cbAcc.hist--; const p = cbFree(cbHist); if (p) cbEmit(p, 900 + rnd(-12, 12), 322 + rnd(-24, 24), rnd(-25, 25), rnd(-25, 25), 0); }
  cbHist.forEach((p) => {
    if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2));
    if (p.t > 1.6) cbKill(p);
  });
  cbAcc.gut += dt * cbSm.Sk * 7;
  while (cbAcc.gut >= 1) { cbAcc.gut--; const p = cbFree(cbGut); if (p) cbEmit(p, rnd(750, 860), 272, rnd(-4, 4), rnd(28, 44), 0); }
  cbGut.forEach((p) => {
    if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.y > 378 || p.t > 3.5) cbKill(p);
  });
  cbAcc.deb += dt * cbSm.K * 5;
  while (cbAcc.deb >= 1) {
    cbAcc.deb--; const p = cbFree(cbDeb);
    if (p) { const a = rnd(0, 6.28); cbEmit(p, 240 + Math.cos(a) * 100, 255 + Math.sin(a) * 100, Math.cos(a) * 12, Math.sin(a) * 12, 0); }
  }
  cbDeb.forEach((p) => {
    if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2));
    if (p.t > 1.4) cbKill(p);
  });
  /* gauges */
  cbGg.kill.set(cbSm.K, wordOf(cbSm.K, 0.3, 0.6, ["low", "fair", "high"]));
  cbGg.plt.set(cbSm.P, wordOf(cbSm.P, 0.3, 0.55, ["normal", "low", "very low"]));
  cbGg.kid.set(cbSm.Kd, wordOf(cbSm.Kd, 0.15, 0.3, ["normal", "mild", "harm"]));
  cbGg.ear.set(cbSm.E, wordOf(cbSm.E, 0.15, 0.3, ["normal", "mild", "harm"]));
  cbGg.gut.set(cbSm.Sk, wordOf(cbSm.Sk, 0.2, 0.4, ["settled", "queasy", "sick"]));
  cbGg.all.set(cbSm.A, wordOf(cbSm.A, 0.2, 0.45, ["rare", "possible", "likely"]));
  if (drug !== cbCapD || level !== cbCapL) { cbCapD = drug; cbCapL = level; const t = cbCapText(drug, level); if (cbCapEl.textContent !== t) cbCapEl.textContent = t; }
}
function init() { cbInit(); }
run({ init, step });
