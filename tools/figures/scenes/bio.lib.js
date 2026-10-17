/* Shared page runtime for the animated mechanism scenes (sepsis, airway, graft). Plain globals, ES2015. A scene script follows this file and ends with run({ init, step, onModel }). */
const NS = "http://www.w3.org/2000/svg";
const svg = document.querySelector(".dr-fig");
const $ = (id) => svg.querySelector("#" + id);
const mk = (name, attrs, parent) => { const el = document.createElementNS(NS, name); for (const k in attrs) el.setAttribute(k, attrs[k]); if (parent) parent.appendChild(el); return el; };
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const f1 = (v) => (+v).toFixed(1);
const readout = document.querySelector("[data-readout]");
const levelBox = document.getElementById("level"), drugBox = document.getElementById("drug"), pauseBtn = document.getElementById("pause");
const info = document.getElementById("info"), statusEl = document.getElementById("status");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const S = SC.S;
let level = S.level.start, drug = 0, playing = !reduce.matches, visible = true, last = 0, frame = 0, tm = 0, M = null, SCN = null;
{ const q = new URLSearchParams(location.search), d0 = +q.get("d"), l0 = q.get("l");
  if (d0 > 0 && d0 < S.settings.length) { drug = d0; drugBox.value = String(d0); }
  if (l0 !== null && l0 !== "" && +l0 >= 0 && +l0 < S.level.a.length) { level = +l0; levelBox.value = String(level); } }
levelBox.setAttribute("aria-valuetext", S.level.names[level]);

/* a smooth closed blob path (Catmull-Rom through points), centred on 0,0 */
function blobD(r, seed, wob, n) {
  n = n || 9; wob = wob === undefined ? 0.1 : wob; const pts = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * 6.2832, k = 1 + wob * Math.sin(t * 3 + seed * 1.7) + wob * 0.6 * Math.cos(t * 2 + seed * 2.3); pts.push([r * k * Math.cos(t), r * k * Math.sin(t)]); }
  let d = "M" + f1(pts[0][0]) + " " + f1(pts[0][1]);
  for (let i = 0; i < n; i++) { const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += "C" + f1(p1[0] + (p2[0] - p0[0]) / 6) + " " + f1(p1[1] + (p2[1] - p0[1]) / 6) + " " + f1(p2[0] - (p3[0] - p1[0]) / 6) + " " + f1(p2[1] - (p3[1] - p1[1]) / 6) + " " + f1(p2[0]) + " " + f1(p2[1]); }
  return d + "Z";
}
/* a lit, shaded cell: body, shade ring, highlight, optional nucleus. cls colours it (CSS: .cl-<cls> .cl-b) */
function cell(parent, o) {
  const g = mk("g", { class: "cl cl-" + o.cls }, parent), r = o.r, seed = o.seed || Math.random() * 9;
  mk("path", { class: "cl-b", d: blobD(r, seed, o.wob === undefined ? 0.09 : o.wob, o.n) }, g);
  mk("path", { class: "cl-s", d: blobD(r * 0.86, seed, o.wob === undefined ? 0.09 : o.wob, o.n), transform: "translate(" + f1(r * 0.04) + " " + f1(r * 0.05) + ")" }, g);
  mk("path", { class: "cl-h", d: blobD(r * 0.62, seed + 1, 0.05, 7), transform: "translate(" + f1(-r * 0.14) + " " + f1(-r * 0.16) + ")" }, g);
  if (o.nuc) mk("path", { class: "cl-n" + (o.nucCls ? " " + o.nucCls : ""), d: blobD(r * o.nuc, seed + 2, 0.12, 7), transform: "translate(" + f1(r * 0.05) + " " + f1(r * 0.02) + ")" }, g);
  if (o.x !== undefined) g.setAttribute("transform", "translate(" + f1(o.x) + " " + f1(o.y) + ")");
  return g;
}
const place = (g, x, y, rot, sc) => g.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")" + (rot ? " rotate(" + f1(rot) + ")" : "") + (sc && sc !== 1 ? " scale(" + sc.toFixed(3) + ")" : ""));
/* label pill with a leader; hover/focus shows `text` in the info line */
function pill(parent, text, x, y, tx, ty, infoText) {
  const lw = text.length * 6.2 + 14, g = mk("g", { class: "hot dr-lab", tabindex: "0", "data-info": infoText || text }, parent);
  mk("path", { class: "dr-leader", d: "M" + f1(x) + " " + f1(y) + "L" + f1(tx) + " " + f1(ty + 8) }, g);
  mk("circle", { class: "dr-dot", cx: f1(x), cy: f1(y), r: 1.6 }, g);
  mk("rect", { class: "dr-lab-r", x: f1(tx - lw / 2), y: f1(ty - 8), width: f1(lw), height: 17, rx: 8.5 }, g);
  const t = mk("text", { class: "dr-lab-t", x: f1(tx), y: f1(ty + 4), "text-anchor": "middle" }, g); t.textContent = text; return g;
}
/* a vertical gauge (track + fill); set(v) moves it; the value word sits under it */
function gauge(parent, x, y, h, w, cls, name, infoText) {
  const g = mk("g", { class: "hot", tabindex: "0", "data-info": infoText || name }, parent);
  mk("rect", { class: "dr-g-tr", x: x - w / 2, y, width: w, height: h, rx: w / 2 }, g);
  const fill = mk("rect", { class: "dr-g-fill " + cls, x: x - w / 2, y: y + h, width: w, height: 0, rx: w / 2 }, g);
  const t1 = mk("text", { class: "dr-pt2", x, y: y + h + 15, "text-anchor": "middle" }, g); t1.textContent = name;
  const t2 = mk("text", { class: "dr-g-v", x, y: y + h + 28, "text-anchor": "middle" }, g);
  return { set(v, word) { const hh = clamp(v) * h; fill.setAttribute("y", f1(y + h - hh)); fill.setAttribute("height", f1(hh)); if (word !== undefined && t2.textContent !== word) t2.textContent = word; } };
}
/* a path through points, with length table; at(u) gives {x,y,a} */
function track(pts) { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const len = cum[cum.length - 1];
  return { len, at(u) { const d = clamp(u) * len; let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const f = (d - cum[i - 1]) / Math.max(0.001, cum[i] - cum[i - 1]); const a = pts[i - 1], b = pts[i];
    return { x: lerp(a[0], b[0], f), y: lerp(a[1], b[1], f), a: Math.atan2(b[1] - a[1], b[0] - a[0]) * 57.2958 }; } };
}
const wordOf = (v, a, b, ws) => (v < a ? ws[0] : v < b ? ws[1] : ws[2]);

function publish() {
  M = modelOf(S, level, drug);
  if (M.readout !== readout.textContent) readout.textContent = M.readout;
  statusEl.textContent = S.status.replace("{level}", S.level.names[level]).replace("{drug}", S.drugNames[drug]) + " " + M.readout + ". Qualitative, illustrative.";
  if (SCN && SCN.onModel) SCN.onModel(M);
}
function tick(now) { frame = 0; if (!playing || !visible) return; const dt = Math.min(0.064, (now - (last || now)) / 1000); last = now; tm += dt * 1000; SCN.step(dt, M); frame = requestAnimationFrame(tick); }
function start() { if (playing && visible && !frame) { last = 0; frame = requestAnimationFrame(tick); } }
function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; }
function setPlaying(v) { playing = v; pauseBtn.textContent = v ? "Pause motion" : "Play motion"; pauseBtn.setAttribute("aria-pressed", String(!v)); if (v) start(); else stop(); }
function run(scn) {
  SCN = scn;
  levelBox.addEventListener("input", () => { level = +levelBox.value; levelBox.setAttribute("aria-valuetext", S.level.names[level]); publish(); if (!playing) for (let i = 0; i < 6; i++) SCN.step(0.05, M); });
  drugBox.addEventListener("change", () => { drug = +drugBox.value; publish(); if (!playing) for (let i = 0; i < 6; i++) SCN.step(0.05, M); });
  pauseBtn.addEventListener("click", () => setPlaying(!playing));
  document.addEventListener("keydown", (e) => { if (e.code !== "Space" || e.target.closest("button, a, input, textarea, select")) return; e.preventDefault(); setPlaying(!playing); });
  reduce.addEventListener("change", () => setPlaying(!reduce.matches));
  scn.init(); publish();
  const idle = info.textContent;
  svg.querySelectorAll(".hot").forEach((el) => { const on = () => { info.textContent = el.dataset.info; el.classList.add("is-hot"); }, off = () => { info.textContent = idle; el.classList.remove("is-hot"); };
    el.addEventListener("pointerenter", on); el.addEventListener("pointerleave", off); el.addEventListener("focus", on); el.addEventListener("blur", off); });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop(); }).observe(svg);
  if (reduce.matches) { pauseBtn.textContent = "Play motion"; pauseBtn.setAttribute("aria-pressed", "true"); }
  for (let i = 0; i < 90; i++) scn.step(0.05, M);
  start();
}
