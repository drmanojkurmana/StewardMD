/* Action potential figure generator (Anima kit, MIT: prep/figures/ANIMA-LICENSE.txt).
 *   ANIMA_DIR=/path/to/anima node tools/figures/ap.mjs tools/figures/specs/<id>.json [--register]
 * Two panels: a fast-response action potential (atrial and ventricular muscle, Purkinje fibres) and a slow-response one (SA and AV
 * node). The normal curve stays as a dashed ghost; the solid curve shows the drug class. A heart-rate slider shows
 * use dependence. Qualitative and illustrative: the axes carry no numbers, and no dose or concentration is shown or implied.
 * Spec: tools/figures/README.md (drugs[]: label, status, up, apd, slope, ca, ud). */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const ANIMA = process.env.ANIMA_DIR || "/home/user/garinmckayl/anima";
const { BIO_CSS } = await import(pathToFileURL(join(ANIMA, "kit/blob.mjs")));
const { figureSvg, pageHtml, plateHtml } = await import(pathToFileURL(join(ANIMA, "kit/iso-kit.mjs")));
const specPath = process.argv[2];
if (!specPath) throw new Error("usage: ap.mjs <spec.json> [--register]");
const S = JSON.parse(readFileSync(resolve(specPath), "utf8"));
const WIDTH = 960, HEIGHT = 640;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------------- model (also runs in the page) ---------------- */
function modelOf(S, rate, drug) {
  const d = S.drugs[drug], f = S.rates[rate];
  const ud = d.ud == null ? 1 : d.ud, g = Math.pow(f, ud);
  const up = 1 - (1 - (d.up == null ? 1 : d.up)) * g;
  const apd = 1 - (1 - (d.apd == null ? 1 : d.apd)) * (d.apdUd ? g : 1);
  const slope = d.slope == null ? 1 : d.slope, ca = d.ca == null ? 1 : d.ca;
  const w0 = up < 0.55 ? "markedly slowed" : up < 0.95 ? "slowed" : "normal";
  const w1 = apd > 1.15 ? "prolonged" : apd < 0.92 ? "shortened" : "unchanged";
  const w2 = slope < 0.75 ? "slower" : "unchanged";
  const w3 = ca < 0.75 ? "slowed" : "normal";
  return { up, apd, slope, ca, words: [w0, w1, w2, w3], readout: S.readout.replace(/\{(\d)\}/g, (_, k) => [w0, w1, w2, w3][+k]) };
}
if (process.argv.includes("--print-model")) { for (let r = 0; r < 3; r++) for (let d = 0; d < S.drugs.length; d++) console.log(JSON.stringify([r, d, modelOf(S, r, d).readout])); process.exit(0); }
for (const t of S.tests || []) {
  const r = modelOf(S, t[0], t[1]).readout;
  if (r !== t[2]) throw new Error(`${S.id}: model readout "${r}" != "${t[2]}" at rate ${t[0]}, drug ${t[1]}`);
}

/* ---------------- drawing ---------------- */
const PANEL = [{ x0: 50, x1: 470, y0: 140, y1: 400, id: "fast" }, { x0: 510, x1: 930, y0: 140, y1: 400, id: "slow" }];
const text = (t, x, y, anchor = "start", cls = "") => `<text class="dr-label ${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${t}</text>`;
const axes = (p, title, sub) => {
  const yz = p.y1 - ((0 + 95) / 130) * (p.y1 - p.y0);
  return `<rect class="dr-zone" x="${p.x0 - 14}" y="${p.y0 - 62}" width="${p.x1 - p.x0 + 28}" height="${p.y1 - p.y0 + 150}" rx="16"/>` +
    text(esc(title), p.x0, p.y0 - 36, "start", "dr-name") + text(esc(sub), p.x0, p.y0 - 18, "start", "dr-muted") +
    `<path class="dr-axis" d="M${p.x0} ${p.y0}V${p.y1}H${p.x1}"/><path class="dr-zeroline" d="M${p.x0} ${f1(yz)}H${p.x1}"/>` +
    text("0", p.x0 - 6, f1(yz + 4), "end", "dr-muted") + text("membrane potential", p.x0 - 6, p.y0 - 4, "start", "dr-muted") + text("time", p.x1, p.y1 + 18, "end", "dr-muted");
};
const f1 = (v) => +v.toFixed(1);
const body = [
  `<ellipse class="dr-halo" cx="480" cy="626" rx="430" ry="16"/>`,
  PANEL.map((p, i) => axes(p, S.panels[i].title, S.panels[i].sub)).join(""),
  `<g class="hot" tabindex="0" id="ph-info" data-info="${esc(S.panels[0].info)}"><path id="fast-ghost" class="dr-ghost" d=""/><path id="fast-cur" class="dr-cur" d=""/><g id="fast-ph"></g></g>`,
  `<g class="hot" tabindex="0" data-info="${esc(S.panels[1].info)}"><path id="slow-ghost" class="dr-ghost" d=""/><path id="slow-cur" class="dr-cur dr-cur2" d=""/></g>`,
  `<g id="fast-labels"></g><g id="slow-labels"></g>`,
  `<g class="dr-key"><path class="dr-ghost" d="M52 560H92"/><text class="dr-label" x="102" y="564">normal (no drug)</text><path class="dr-cur" d="M52 584H92"/><text class="dr-label" x="102" y="588">with the drug class</text></g>`,
].join("");
const svg = figureSvg({ width: WIDTH, height: HEIGHT, label: S.ariaLabel, body, className: "dr-fig" });
const start = S.rateStart ?? 1;
const framed = plateHtml({ fig: "Fig 1", title: S.title, hint: "hover or focus a curve · space: pause", readout: modelOf(S, start, 0).readout, caption: S.caption, body: `<div class="dr-svg">${svg}</div>` });
const controls = `
<div class="dr-controls">
  <label class="dr-range"><span>${esc(S.rateLabel)}</span><input id="level" type="range" min="0" max="2" step="1" value="${start}" aria-valuetext="${esc(S.rateNames[start])}"><span class="dr-ticks">${S.rateTicks.map((t) => `<i>${esc(t)}</i>`).join("")}</span></label>
  <label class="dr-range"><span>${esc(S.drugLabel)}</span><select id="drug">${S.drugs.map((d, i) => `<option value="${i}">${esc(d.label)}</option>`).join("")}</select></label>
  <button id="pause" type="button" aria-pressed="false">Pause motion</button>
</div>
<p id="status" class="dr-status" aria-live="polite"></p>
<p id="info" class="dr-info" aria-live="polite">Hover or focus a curve for a one-line explanation.</p>`;
const sources = `<footer class="bio-sources">
<h2>What the figure shows, and how sure we are</h2>
<ul>
${S.sources.map((x) => `<li>${x}</li>`).join("\n")}
</ul>
<p><strong>What was simplified.</strong> ${S.simplified}</p>
<p>Interactive figure drawn with the <a href="https://github.com/Garinmckayl/anima">Anima</a> kit (MIT licence).</p>
<p>For education only; this figure is not medical advice and says nothing about any person’s treatment or any medicine.</p>
</footer>`;

const script = `
const S = ${JSON.stringify({ rates: S.rates, rateNames: S.rateNames, drugs: S.drugs.map((d) => ({ label: d.label, up: d.up, apd: d.apd, slope: d.slope, ca: d.ca, ud: d.ud, apdUd: d.apdUd })), readout: S.readout, status: S.status, drugNames: S.drugs.map((d) => d.status || d.label) })};
const modelOf = ${modelOf.toString()};
const PANEL = ${JSON.stringify(PANEL)};
const svg = document.querySelector(".dr-fig");
const $ = (id) => svg.querySelector("#" + id);
const readout = document.querySelector("[data-readout]");
const levelBox = document.getElementById("level"), drugBox = document.getElementById("drug"), pauseBtn = document.getElementById("pause");
const info = document.getElementById("info"), statusEl = document.getElementById("status");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const TMAX = 560;
let rate = ${start}, drug = 0, playing = !reduce.matches, visible = true, last = 0, frame = 0, sweep = reduce.matches ? 1 : 0;
{ const q = new URLSearchParams(location.search), d0 = +q.get("d"), nm = (q.get("name") || "").replace(/[^A-Za-z0-9 \\-]/g, "").slice(0, 40);
  if (d0 > 0 && d0 < S.drugs.length) { drug = d0; drugBox.value = String(d0); }
  const l0 = q.get("l"); if (l0 === "0" || l0 === "2") { rate = +l0; levelBox.value = l0; levelBox.setAttribute("aria-valuetext", S.rateNames[rate]); }
  if (nm) { const p = document.createElement("p"); p.className = "dr-status"; p.textContent = nm + ": the selector below is set to this drug's class. Drug classes overlap, so check the drug's own details."; statusEl.before(p); } }
let M = modelOf(S, rate, drug);
const VMIN = -95, VMAX = 35;
const yOf = (p, v) => p.y1 - ((v - VMIN) / (VMAX - VMIN)) * (p.y1 - p.y0);
const xOf = (p, t) => p.x0 + (t / TMAX) * (p.x1 - p.x0);
// fast response: phase 4 rest, 0 Na upstroke, 1 notch, 2 plateau, 3 repolarisation
function fast(up, apd) {
  const t0 = 40, d0 = Math.max(6 / up, 6), pk = 30 - 38 * (1 - up), n = 1, pts = [];
  const t1 = t0 + d0 + 12, plat = 150 * apd, t2 = t1 + plat, t3 = t2 + 70 * apd;
  for (let t = 0; t <= TMAX; t += 4) {
    let v = -85;
    if (t >= t0 && t < t0 + d0) v = -85 + (pk + 85) * smooth((t - t0) / d0);
    else if (t >= t0 + d0 && t < t1) v = pk - 16 * smooth((t - t0 - d0) / 12);
    else if (t >= t1 && t < t2) v = (pk - 16) - 18 * ((t - t1) / plat);
    else if (t >= t2 && t < t3) v = ((pk - 34)) + (-85 - (pk - 34)) * smooth((t - t2) / (t3 - t2));
    pts.push([t, v]);
  }
  return pts;
}
// slow response: phase 4 slope (pacemaker), 0 Ca upstroke, 3 repolarisation
function slow(slope, ca) {
  const T4 = 190 / slope, Tu = 45 / ca, T3 = 70, L = T4 + Tu + T3, pts = [];
  for (let t = 0; t <= TMAX; t += 4) {
    const c = ((t + 60) % L), v0 = -60;
    let v;
    if (c < T4) v = v0 + 20 * (c / T4);
    else if (c < T4 + Tu) v = -40 + 50 * smooth((c - T4) / Tu);
    else v = 10 + (v0 - 10) * smooth((c - T4 - Tu) / T3);
    pts.push([t, v]);
  }
  return pts;
}
const path = (p, pts, upto) => "M" + pts.filter((q) => q[0] <= upto).map((q) => xOf(p, q[0]).toFixed(1) + " " + yOf(p, q[1]).toFixed(1)).join("L");
const cur = { up: 1, apd: 1, slope: 1, ca: 1 };
const ghostF = fast(1, 1), ghostS = slow(1, 1);
const fl = $("fast-labels"), sl = $("slow-labels");
const NS = "http://www.w3.org/2000/svg";
const lab = (parent, x, y, t, cls, anchor) => { const e = document.createElementNS(NS, "text"); e.setAttribute("class", "dr-label " + (cls || "")); e.setAttribute("x", x); e.setAttribute("y", y); e.setAttribute("text-anchor", anchor || "middle"); e.textContent = t; parent.appendChild(e); return e; };
const PF = PANEL[0], PS = PANEL[1];
// phase numbers (and the channel behind each phase) placed beside the normal curve: [t, mV, number, channel, anchor, dx, dy]
[[40, -30, "0", "Na⁺ in", "end", -12, 4], [62, 33, "1", "", "start", 6, 4], [150, -10, "2", "Ca²⁺ in, K⁺ out", "middle", 0, 34], [262, -45, "3", "K⁺ out", "start", 14, 4], [440, -85, "4", "resting potential", "middle", 0, -10]].forEach((a) => {
  const x = xOf(PF, a[0]) + a[5], y = yOf(PF, a[1]);
  lab(fl, x, y + a[6] - (a[3] ? 12 : 0), a[2], "dr-phase", a[4]);
  if (a[3]) lab(fl, x + (a[4] === "end" ? 0 : a[4] === "start" ? 14 : 0), y + a[6] + 4, a[3], "dr-muted dr-small", a[4]);
});
[[8, -60, "4", "slow drift up", "start", 4, 20], [188, 10, "0", "Ca²⁺ in", "end", -14, 8], [262, -35, "3", "K⁺ out", "start", 14, 4]].forEach((a) => {
  const x = xOf(PS, a[0]) + a[5], y = yOf(PS, a[1]);
  lab(sl, x, y + a[6] - 14, a[2], "dr-phase", a[4]); lab(sl, x + (a[4] === "end" ? 0 : a[4] === "start" ? 14 : 0), y + a[6] + 2, a[3], "dr-muted dr-small", a[4]);
});
function draw() {
  const k = 0.18;
  cur.up += (M.up - cur.up) * k; cur.apd += (M.apd - cur.apd) * k; cur.slope += (M.slope - cur.slope) * k; cur.ca += (M.ca - cur.ca) * k;
  const upto = playing ? sweep * TMAX : TMAX;
  $("fast-ghost").setAttribute("d", path(PF, ghostF, TMAX)); $("slow-ghost").setAttribute("d", path(PS, ghostS, TMAX));
  $("fast-cur").setAttribute("d", path(PF, fast(cur.up, cur.apd), upto)); $("slow-cur").setAttribute("d", path(PS, slow(cur.slope, cur.ca), upto));
}
function publish() {
  M = modelOf(S, rate, drug);
  if (M.readout !== readout.textContent) readout.textContent = M.readout;
  statusEl.textContent = S.status.replace("{level}", S.rateNames[rate]).replace("{drug}", S.drugNames[drug]) + " " + M.readout + ". Qualitative, illustrative.";
}
function tick(now) {
  frame = 0; if (!playing || !visible) return;
  const dt = Math.min(64, now - (last || now)); last = now;
  sweep = (sweep + dt / 3200) % 1.35; if (sweep > 1) { /* hold the full curve briefly, then sweep again */ }
  draw(); frame = requestAnimationFrame(tick);
}
function still() { sweep = 1; for (let i = 0; i < 40; i++) draw(); }
function start() { if (playing && visible && !frame) { last = 0; frame = requestAnimationFrame(tick); } }
function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; }
levelBox.addEventListener("input", () => { rate = +levelBox.value; levelBox.setAttribute("aria-valuetext", S.rateNames[rate]); publish(); if (!playing) still(); });
drugBox.addEventListener("change", () => { drug = +drugBox.value; publish(); if (!playing) still(); });
function setPlaying(v) { playing = v; pauseBtn.textContent = v ? "Pause motion" : "Play motion"; pauseBtn.setAttribute("aria-pressed", String(!v)); if (v) start(); else { stop(); still(); } }
pauseBtn.addEventListener("click", () => setPlaying(!playing));
document.addEventListener("keydown", (e) => { if (e.code !== "Space" || e.target.closest("button, a, input, textarea, select")) return; e.preventDefault(); setPlaying(!playing); });
reduce.addEventListener("change", () => setPlaying(!reduce.matches));
const idle = info.textContent;
svg.querySelectorAll(".hot").forEach((el) => {
  const on = () => { info.textContent = el.dataset.info; el.classList.add("is-hot"); };
  const off = () => { info.textContent = idle; el.classList.remove("is-hot"); };
  el.addEventListener("pointerenter", on); el.addEventListener("pointerleave", off); el.addEventListener("focus", on); el.addEventListener("blur", off);
});
new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop(); }).observe(svg);
if (reduce.matches) { pauseBtn.textContent = "Play motion"; pauseBtn.setAttribute("aria-pressed", "true"); }
publish(); still(); start();
`;
const extra = `.dr-zone{fill:var(--anatomy-shade-1);stroke:var(--anatomy-faint);stroke-width:.8;stroke-dasharray:3 4}
.dr-axis{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.dr-zeroline{fill:none;stroke:var(--anatomy-faint);stroke-width:1;stroke-dasharray:2 4}
.dr-ghost{fill:none;stroke:var(--anatomy-muted);stroke-width:1.6;stroke-dasharray:5 4;stroke-linejoin:round}
.dr-cur{fill:none;stroke:var(--anatomy-lit);stroke-width:2.4;stroke-linejoin:round;stroke-linecap:round}
.dr-cur2{stroke:var(--anatomy-green)}
.dr-phase{fill:var(--anatomy-strong);font:700 13px var(--anatomy-mono);pointer-events:none}
.dr-small{font-size:10.5px;pointer-events:none}
.hot .dr-cur,.hot .dr-ghost{pointer-events:stroke}
.dr-controls select{border:1px solid var(--anatomy-faint);background:var(--anatomy-card);color:var(--anatomy-text);font:inherit;padding:6px 8px}`;
const style = readFileSync(join(HERE, "figure.css"), "utf8") + extra;
for (const light of [false, true]) {
  const html = pageHtml({ title: S.title, theme: light ? "light" : "dark", width: WIDTH + 40, body: `<style>${BIO_CSS}${style}</style>${framed}${controls}${sources}`, script });
  writeFileSync(join(ROOT, "prep/figures", S.id + (light ? "-light" : "") + ".html"), html);
  console.log("wrote prep/figures/" + S.id + (light ? "-light" : "") + ".html " + html.length);
}
if (process.argv.includes("--register") && S.registry) {
  const fp = join(ROOT, "prep/figures/figures.json"), J = JSON.parse(readFileSync(fp, "utf8"));
  const entry = { id: S.id, title: S.registry.title || S.title, blurb: S.registry.blurb, page: "prep/figures/" + S.id + ".html", drugs: S.registry.drugs, terms: S.registry.terms || [] };
  const k = J.figures.findIndex((f) => f.id === S.id);
  if (k >= 0) J.figures[k] = entry; else J.figures.push(entry);
  writeFileSync(fp, JSON.stringify(J, null, 1) + "\n");
  console.log("registered " + S.id);
}
