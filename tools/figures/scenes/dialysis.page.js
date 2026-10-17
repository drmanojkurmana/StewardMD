/* Page script for the haemodialysis figure: pump, syringe, drip chamber, particles in the lines and in one fibre, gauges, controls. */
const NS = "http://www.w3.org/2000/svg";
const svg = document.querySelector(".dr-fig");
const $ = (id) => svg.querySelector("#" + id);
const mk = (name, attrs, parent) => { const el = document.createElementNS(NS, name); for (const k in attrs) el.setAttribute(k, attrs[k]); if (parent) parent.appendChild(el); return el; };
const readout = document.querySelector("[data-readout]");
const levelBox = document.getElementById("level"), drugBox = document.getElementById("drug"), pauseBtn = document.getElementById("pause");
const info = document.getElementById("info"), statusEl = document.getElementById("status");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const S = SC.S;
let level = 1, drug = 0, playing = !reduce.matches, visible = true, last = 0, frame = 0, tm = 0;
{ const q = new URLSearchParams(location.search), d0 = +q.get("d"), l0 = q.get("l");
  if (d0 > 0 && d0 < S.settings.length) { drug = d0; drugBox.value = String(d0); }
  if (l0 === "0" || l0 === "2") { level = +l0; levelBox.value = l0; levelBox.setAttribute("aria-valuetext", S.level.names[level]); } }
let M = modelOf(S, level, drug);

/* ---- the camera, for the parts that turn ---- */
const iso = (p) => { const a = SC.ISO.azimuth * Math.PI / 180, e = SC.ISO.elevation * Math.PI / 180, k = SC.ISO.scale * Math.sqrt(1.6);
  return [SC.ISO.origin[0] + (p[0] * Math.sin(a) - p[1] * Math.cos(a)) * k, SC.ISO.origin[1] + ((p[0] * Math.cos(a) + p[1] * Math.sin(a)) * Math.sin(e) - p[2] * Math.cos(e)) * k]; };
const ringPath = (c, r, z, n = 36) => { let d = ""; for (let i = 0; i < n; i++) { const t = (i / n) * 6.2832, q = iso([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t), z]); d += (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); } return d + "Z"; };

/* ---- blood pump: a rotor with three rollers ---- */
const rotor = $("rotor"), disc = mk("path", { class: "p-rot-disc" }, rotor), hub = mk("path", { class: "p-rot-hub" }, rotor), rolls = [0, 1, 2].map(() => mk("path", { class: "p-roll" }, rotor));
let rotA = 0;
/* the pump sits on the machine's front face, so its rings lie in the x-z plane */
const ringXZ = (c, r, dy, n = 36) => { let d = ""; for (let i = 0; i < n; i++) { const t = (i / n) * 6.2832, q = iso([c[0] + r * Math.cos(t), c[1] + dy, c[2] + r * Math.sin(t)]); d += (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); } return d + "Z"; };
function drawRotor() {
  const c = SC.ROTOR;
  disc.setAttribute("d", ringXZ(c, SC.ROTOR_R, 0.6)); hub.setAttribute("d", ringXZ(c, 3.4, 1.4, 14));
  rolls.forEach((r, i) => { const t = rotA + i * 2.0944; r.setAttribute("d", ringXZ([c[0] + (SC.ROTOR_R - 4.8) * Math.cos(t), c[1], c[2] + (SC.ROTOR_R - 4.8) * Math.sin(t)], 3.1, 1.8, 12)); });
}
/* ---- heparin syringe: the plunger creeps in ---- */
const plunger = $("plunger"), rod = mk("path", { class: "p-plunger" }, plunger), pad = mk("path", { class: "p-pad" }, plunger);
let hp = 0;
function drawPlunger() { const h = SC.HEP, off = 16 * (1 - hp), a = iso([h[0] - 2 - off, h[1], h[2]]), b = iso([h[0] + 4, h[1], h[2]]);
  rod.setAttribute("d", "M" + a[0].toFixed(1) + " " + a[1].toFixed(1) + "L" + b[0].toFixed(1) + " " + b[1].toFixed(1)); pad.setAttribute("d", ringPath([h[0] - 4 - off, h[1]], 2.6, h[2], 12)); }
/* ---- drip chamber: blood level and rising bubbles ---- */
const chamber = $("chamber"), lvl = mk("path", { class: "p-level" }, chamber), bubbles = [0, 1, 2, 3].map(() => mk("circle", { class: "p-bubble", r: 1.6 }, chamber)), bph = [0, 0.3, 0.55, 0.8];
function drawChamber(flow) { const c = SC.CH; lvl.setAttribute("d", ringPath([c[0], c[1]], 6.2, c[2] + 14, 24)); bubbles.forEach((b, i) => { const u = (tm / 1800 * (0.2 + flow) + bph[i]) % 1, p = iso([c[0] + Math.sin(u * 9 + i) * 2.4, c[1], c[2] + 4 + u * 20]); b.setAttribute("cx", p[0].toFixed(1)); b.setAttribute("cy", p[1].toFixed(1)); b.style.opacity = flow > 0.05 ? (u < 0.9 ? 0.85 : 0) : 0; }); }

/* ---- particles travelling in the tubes ---- */
const lineLayer = $("line-live");
const routes = [["ART", "rbc"], ["VEN", "rbc"], ["DIN", "bic"], ["DOUT", "ure"], ["SAL", "sal"]].map(([k, t]) => { const pts = SC[k], cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { pts, cum, len: cum[cum.length - 1], type: t, dots: [] }; });
const at = (R, u) => { const d = u * R.len; let i = 1; while (i < R.cum.length - 1 && R.cum[i] < d) i++; const f = (d - R.cum[i - 1]) / Math.max(0.001, R.cum[i] - R.cum[i - 1]); return [R.pts[i - 1][0] + (R.pts[i][0] - R.pts[i - 1][0]) * f, R.pts[i - 1][1] + (R.pts[i][1] - R.pts[i - 1][1]) * f]; };
routes.forEach((R, ri) => { for (let i = 0; i < 16; i++) { const kind = R.type === "sal" ? "sal" : R.type === "rbc" ? (i % 4 === 3 ? "ure" : "rbc") : R.type === "bic" ? "bic" : (i % 2 ? "ure" : i % 4 === 0 ? "pot" : "bic"); const e = mk("circle", { class: "p-" + kind, r: kind === "rbc" ? 2.5 : kind === "sal" ? 1.5 : 1.9 }, lineLayer); R.dots.push({ e, u: i / 16, kind, ri }); } });

/* ---- one fibre, enlarged ---- */
const F = SC.FIB, live = $("fibre-live"), parts = [];
const LUM0 = F.lumTop + 7, LUM1 = F.lumBot - 7, TOPB = [SC.IN.y + 44, F.topWall - 8], BOTB = [F.botWall + 12, SC.IN.y + SC.IN.h - 40];
const shapes = {
  rbc: (g) => { mk("ellipse", { class: "p-rbc", rx: 7, ry: 4.3 }, g); mk("ellipse", { class: "p-rbc-c", rx: 2.6, ry: 1.4 }, g); },
  alb: (g) => { mk("circle", { class: "p-alb", r: 4.3 }, g); mk("circle", { class: "p-alb", r: 1.8, cx: -3.6, cy: -2.6 }, g); mk("circle", { class: "p-alb", r: 1.8, cx: 3.6, cy: -2.6 }, g); },
  ure: (g) => mk("circle", { class: "p-ure", r: 2.5 }, g), pot: (g) => mk("circle", { class: "p-pot", r: 2.5 }, g), bic: (g) => mk("circle", { class: "p-bic", r: 2.4 }, g),
  wat: (g) => mk("path", { class: "p-wat", d: "M0 -3.6C2.4 -0.6 3 0.9 3 2A3 3 0 0 1 -3 2C-3 0.9 -2.4 -0.6 0 -3.6Z" }, g),
};
[["rbc", 0], ["alb", 1], ["ure", 2], ["pot", 3], ["bic", 4], ["wat", 5]].forEach(([k]) => { const g = $("lg-" + k); if (g) shapes[k](g); });
function spawn(kind, x, y, side) { const g = mk("g", {}, live); shapes[kind](g); const p = { kind, x, y, g, st: 0, side, ty: 0, vy: rnd(-4, 4) }; parts.push(p); place(p); return p; }
function place(p) { p.g.setAttribute("transform", "translate(" + p.x.toFixed(1) + " " + p.y.toFixed(1) + ")" + (p.kind === "rbc" ? " rotate(" + (p.rot || 0).toFixed(0) + ")" : "")); }
const U = { u: 0.85, k: 0.8, f: 0.8 }, flow = { b: 0, d: 0 };
let acc = { rbc: 0, alb: 0, ure: 0, pot: 0, bic: 0, wat: 0 };
const VS = 62;
function seed() { for (let i = 0; i < 9; i++) { const p = spawn("rbc", rnd(F.x0 + 10, F.x1 - 10), rnd(LUM0, LUM1), 0); p.rot = rnd(-25, 25); } for (let i = 0; i < 5; i++) spawn("alb", rnd(F.x0 + 10, F.x1 - 10), rnd(LUM0, LUM1), 0); for (let i = 0; i < 14; i++) spawn("ure", rnd(F.x0 + 10, F.x1 - 10), rnd(LUM0, LUM1), 0); for (let i = 0; i < 7; i++) spawn("pot", rnd(F.x0 + 10, F.x1 - 10), rnd(LUM0, LUM1), 0); for (let i = 0; i < 12; i++) spawn("bic", rnd(F.x0 + 10, F.x1 - 10), rnd(i % 2 ? TOPB[0] : BOTB[0], i % 2 ? TOPB[1] : BOTB[1]), i % 2 ? -1 : 1).st = 2; }
function fibreStep(dt) {
  const st = M.st, counter = st.counter, dir = counter ? -1 : 1, eff = M.eff;
  // spawn
  if (flow.b > 0.06) { acc.rbc += dt * 1.1 * flow.b; acc.alb += dt * 0.6 * flow.b; acc.ure += dt * 4.6 * flow.b * U.u; acc.pot += dt * 2.6 * flow.b * U.k; }
  if (flow.d > 0.06) { acc.bic += dt * 3.2 * flow.d; if (st.uf > 0.5) acc.wat += dt * 2.4 * flow.b; }
  ["rbc", "alb", "ure", "pot"].forEach((k) => { while (acc[k] >= 1) { acc[k]--; const p = spawn(k, F.x0 - 8, rnd(LUM0, LUM1), 0); p.rot = rnd(-20, 20); } });
  while (acc.bic >= 1) { acc.bic--; const top = Math.random() < 0.5, p = spawn("bic", counter ? F.x1 + 6 : F.x0 - 6, top ? rnd(TOPB[0], TOPB[1]) : rnd(BOTB[0], BOTB[1]), top ? -1 : 1); p.st = 2; }
  while (acc.wat >= 1) { acc.wat--; spawn("wat", rnd(F.x0 + 30, F.x1 - 30), rnd(LUM0, LUM1), 0); }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.st === 0) { // in the blood
      p.x += flow.b * VS * dt * (p.kind === "rbc" ? 0.92 : p.kind === "alb" ? 0.9 : 1.0);
      p.vy += rnd(-30, 30) * dt; p.vy *= 0.92; p.y += p.vy * dt * (flow.b > 0.06 ? 1 : 0.35);
      const pad = p.kind === "rbc" ? 6.5 : 4.5; if (p.y < LUM0 - 3 + pad - 4) { p.y = LUM0 - 3 + pad - 4; p.vy = Math.abs(p.vy); } if (p.y > LUM1 + 3 - pad + 4) { p.y = LUM1 + 3 - pad + 4; p.vy = -Math.abs(p.vy); }
      if (p.rot !== undefined) p.rot += rnd(-20, 20) * dt;
      const u = clamp((p.x - F.x0) / (F.x1 - F.x0));
      const g = counter ? 0.85 : 1 - 0.85 * u;
      if ((p.kind === "ure" || p.kind === "pot") && flow.d > 0.08 && p.x > F.x0 && p.x < F.x1) {
        const rate = (p.kind === "ure" ? 0.85 : 0.62) * g * eff * flow.d * 1.3 * (0.5 + 0.5 * flow.b);
        if (Math.random() < rate * dt * (p.y < (LUM0 + LUM1) / 2 ? 1.3 : 1)) { p.st = 1; p.side = p.y < (LUM0 + LUM1) / 2 ? -1 : 1; p.ty = p.side < 0 ? rnd(TOPB[0] + 4, TOPB[1] - 3) : rnd(BOTB[0] + 3, BOTB[1] - 4); }
      }
      if (p.kind === "wat" && p.x > F.x0) { p.st = 1; p.side = p.y < (LUM0 + LUM1) / 2 ? -1 : 1; p.ty = p.side < 0 ? rnd(TOPB[0] + 4, TOPB[1] - 3) : rnd(BOTB[0] + 3, BOTB[1] - 4); }
      if (p.x > F.x1 + 14) { p.g.remove(); parts.splice(i, 1); continue; }
    } else if (p.st === 1) { // crossing the membrane into the dialysate
      const dy = p.ty - p.y; p.y += Math.sign(dy) * Math.min(Math.abs(dy), 74 * dt); p.x += flow.b * VS * dt * 0.3;
      if (Math.abs(dy) < 1.5) p.st = 2;
    } else { // in the dialysate (or a bicarbonate on its way in)
      const vx = dir * flow.d * VS * 0.92 * dt;
      p.x += (p.kind === "bic" && p.side === 0 ? 0 : vx); p.y += rnd(-6, 6) * dt;
      const top = p.side < 0, a = top ? TOPB : BOTB; p.y = clamp(p.y, a[0], a[1]);
      if (p.kind === "bic" && p.st === 2 && p.x > F.x0 && p.x < F.x1 && flow.d > 0.08 && eff > 0) {
        const u = clamp((p.x - F.x0) / (F.x1 - F.x0)), g = counter ? 0.85 : 0.2 + 0.8 * (1 - u);
        if (Math.random() < 0.18 * g * dt * (0.4 + eff)) { p.st = 3; p.ty = rnd(LUM0 + 3, LUM1 - 3); }
      }
      if (p.x < F.x0 - 16 || p.x > F.x1 + 16) { p.g.remove(); parts.splice(i, 1); continue; }
    }
    if (p.st === 3) { p.y += Math.sign(p.ty - p.y) * Math.min(Math.abs(p.ty - p.y), 60 * dt); p.x += flow.b * VS * dt * 0.8; if (Math.abs(p.ty - p.y) < 1.5) p.st = 0; if (p.x > F.x1 + 14) { p.g.remove(); parts.splice(i, 1); continue; } }
    place(p);
  }
  if (parts.length > 260) { for (let j = 0; j < 40; j++) parts.shift().g.remove(); }
}

/* ---- the patient gauges and the monitor ---- */
const G = { u: $("g-urea"), k: $("g-pot"), f: $("g-flu") };
const GV = { u: $("gv-urea"), k: $("gv-pot"), f: $("gv-flu") };
const gy0 = SC.PT.y + 164, gh = 124;
function drawGauges() { [["u", U.u], ["k", U.k], ["f", U.f]].forEach(([k, v]) => { const h = Math.max(0, v) * gh; G[k].setAttribute("y", (gy0 - h).toFixed(1)); G[k].setAttribute("height", h.toFixed(1)); GV[k].textContent = v > 0.62 ? "high" : v > 0.38 ? "raised" : "near normal"; }); }
/* ---- pressure dials and the two dialysate containers ---- */
const nd = {}, ndv = { art: -70, dia: -70, ven: -70 }; SC.DIALS.forEach((d) => { nd[d.id] = { g: $("nd-" + d.id), x: d.x, y: d.y }; });

function drawDials(dt) {
  const tg = { art: flow.b > 0.05 ? -22 - 26 * flow.b : -70, dia: flow.d > 0.05 ? -6 + 14 * flow.d : -70, ven: flow.b > 0.05 ? 4 + 34 * flow.b : -70 };
  for (const id in nd) { ndv[id] += (tg[id] - ndv[id]) * Math.min(1, dt * 3); const j = flow.b > 0.05 ? Math.sin(tm / 380 + id.length) * 1.6 : 0; nd[id].g.setAttribute("transform", "rotate(" + (ndv[id] + j).toFixed(1) + " " + nd[id].x + " " + nd[id].y + ")"); }
}
const scr = { bp: $("scr-bp"), dp: $("scr-dp"), cd: $("scr-cd"), led: $("scr-led") };
function drawScreen() { [["bp", flow.b * 0.9], ["dp", flow.d * 0.8], ["cd", flow.d * 0.7]].forEach(([k, v]) => { const h = 0.6 * Math.max(0.02, v); scr[k].setAttribute("y", (0.8 - h).toFixed(3)); scr[k].setAttribute("height", h.toFixed(3)); }); scr.led.style.fill = flow.b > 0.1 ? "#3ddc97" : "#6b6b6b"; }

/* ---- the loop ---- */
function step(dt) {
  const bT = M.st.eff > 0 ? M.qb : 0, dT = M.st.eff > 0 ? 0.95 : 0;
  flow.b += (bT - flow.b) * Math.min(1, dt * 2.2); flow.d += (dT - flow.d) * Math.min(1, dt * 2.2);
  U.u += (M.U - U.u) * Math.min(1, dt * 0.16); U.k += (M.K - U.k) * Math.min(1, dt * 0.2); U.f += (M.F - U.f) * Math.min(1, dt * 0.11);
  rotA += flow.b * dt * 3.6; hp = (hp + dt * 0.012 * (flow.b > 0.05 ? 1 : 0)) % 1;
  routes.forEach((R) => { const sp = (R.type === "bic" || R.type === "ure") ? flow.d : flow.b; R.dots.forEach((d) => { d.u = (d.u + dt * 0.16 * sp + (d.u > 1 ? -1 : 0)); if (d.u > 1) d.u -= 1; const p = at(R, d.ri === 3 || d.ri === 2 ? (R.type === "bic" ? d.u : d.u) : d.u); d.e.setAttribute("cx", p[0].toFixed(1)); d.e.setAttribute("cy", p[1].toFixed(1));
    d.e.style.opacity = (d.ri === 1 && d.kind === "ure" ? Math.max(0, 0.9 - 0.7 * (1 - U.u)) * (M.eff ? 0.3 : 1) : 0.92) * (sp > 0.03 ? 1 : 0.35); }); });
  drawRotor(); drawPlunger(); drawChamber(flow.b); drawGauges(); drawScreen(); drawDials(dt); fibreStep(dt);
}
function publish() {
  M = modelOf(S, level, drug);
  if (M.readout !== readout.textContent) readout.textContent = M.readout;
  statusEl.textContent = S.status.replace("{level}", S.level.names[level]).replace("{drug}", S.drugNames[drug]) + " " + M.readout + ". Qualitative, illustrative.";
  const dt = $("dtxt"); if (dt) dt.textContent = M.st.eff > 0 ? (M.st.counter ? "← dialysate flows against the blood" : "dialysate flows with the blood →") : "dialysate off";
}
function tick(now) { frame = 0; if (!playing || !visible) return; const dt = Math.min(0.064, (now - (last || now)) / 1000); last = now; tm += dt * 1000; step(dt); frame = requestAnimationFrame(tick); }
function still() { for (let i = 0; i < 6; i++) step(0.05); }
function start() { if (playing && visible && !frame) { last = 0; frame = requestAnimationFrame(tick); } }
function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; }
levelBox.addEventListener("input", () => { level = +levelBox.value; levelBox.setAttribute("aria-valuetext", S.level.names[level]); publish(); if (!playing) still(); });
drugBox.addEventListener("change", () => { drug = +drugBox.value; publish(); if (!playing) still(); });
function setPlaying(v) { playing = v; pauseBtn.textContent = v ? "Pause motion" : "Play motion"; pauseBtn.setAttribute("aria-pressed", String(!v)); if (v) start(); else stop(); }
pauseBtn.addEventListener("click", () => setPlaying(!playing));
document.addEventListener("keydown", (e) => { if (e.code !== "Space" || e.target.closest("button, a, input, textarea, select")) return; e.preventDefault(); setPlaying(!playing); });
reduce.addEventListener("change", () => setPlaying(!reduce.matches));
const idle = info.textContent;
svg.querySelectorAll(".hot").forEach((el) => { const on = () => { info.textContent = el.dataset.info; el.classList.add("is-hot"); }, off = () => { info.textContent = idle; el.classList.remove("is-hot"); };
  el.addEventListener("pointerenter", on); el.addEventListener("pointerleave", off); el.addEventListener("focus", on); el.addEventListener("blur", off); });
new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop(); }).observe(svg);
if (reduce.matches) { pauseBtn.textContent = "Play motion"; pauseBtn.setAttribute("aria-pressed", "true"); }
seed(); publish();
for (let i = 0; i < 80; i++) step(0.05);   // settle into the current setting before the first frame
start();
