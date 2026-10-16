/* Cascade figure generator (Anima kit, MIT: prep/figures/ANIMA-LICENSE.txt).
 *   ANIMA_DIR=/path/to/anima node tools/figures/cascade.mjs tools/figures/specs/<id>.json [--register]
 * A chain (or small network) of molecules joined by enzyme or receptor steps. A slider sets how strongly the cascade is driven, a
 * selector picks a drug class that blocks one or more steps, and a small model turns both into a qualitative level at every
 * molecule. Flow dots show how much passes each step. Qualitative and illustrative: no doses, affinities or concentrations.
 * Spec fields are listed in tools/figures/README.md. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const ANIMA = process.env.ANIMA_DIR || "/home/user/garinmckayl/anima";
const { BIO_CSS, blobOf, blobSvg } = await import(pathToFileURL(join(ANIMA, "kit/blob.mjs")));
const { figureSvg, pageHtml, pathOf, plateHtml } = await import(pathToFileURL(join(ANIMA, "kit/iso-kit.mjs")));
const specPath = process.argv[2];
if (!specPath) throw new Error("usage: cascade.mjs <spec.json> [--register]");
const S = JSON.parse(readFileSync(resolve(specPath), "utf8"));
const WIDTH = 960, HEIGHT = 640;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------------- model (also runs in the page) ---------------- */
function modelOf(S, level, drug) {
  const dr = S.drugs[drug], lv = {}, flux = {}, blocked = {};
  S.nodes.forEach((n) => { lv[n.id] = 0; });
  S.nodes.forEach((n) => { if (n.kind === "source") lv[n.id] = n.fixed != null ? n.fixed : Math.min(1, S.level.a[level] * (n.gain == null ? 1 : n.gain)); });
  S.edges.forEach((e) => {
    const b = (dr.blocks && dr.blocks[e.id]) || 0;
    blocked[e.id] = b;
    flux[e.id] = e.rest ? Math.max(0, lv[e.from] - flux[e.rest]) : Math.max(0, Math.min(1, lv[e.from] * (e.w == null ? 1 : e.w) * (1 - b)));
    lv[e.to] += flux[e.id];
  });
  S.nodes.forEach((n) => { lv[n.id] = Math.min(1, lv[n.id] * (n.scale == null ? 1 : n.scale)); });
  S.nodes.forEach((n) => { if (n.kind === "inv") lv[n.id] = 0.15 + 0.8 * Math.max(0, blocked[n.inv] || 0); });
  S.nodes.forEach((n) => { if (n.kind === "calc") { let v = n.base || 0; (n.terms || []).forEach((t) => { v += t[1] * (t[0].charAt(0) === "e" ? flux[t[0].slice(2)] : lv[t[0].slice(2)]); }); lv[n.id] = Math.max(0, Math.min(1, v)); } });
  const word = (v, w, cuts) => { const c = cuts || [0.2, 0.6]; let k = 0; while (k < c.length && v >= c[k]) k++; return w[k]; };
  const words = S.outputs.map((o) => word(lv[o.node], o.words, o.cuts));
  return { lv, flux, blocked, words, readout: S.readout.replace(/\{(\d)\}/g, (_, k) => words[+k]) };
}
if (process.argv.includes("--print-model")) { for (let l = 0; l < 3; l++) for (let d = 0; d < S.drugs.length; d++) console.log(JSON.stringify([l, d, modelOf(S, l, d).readout])); process.exit(0); }
for (const t of S.tests || []) {
  const r = modelOf(S, t[0], t[1]).readout;
  if (r !== t[2]) throw new Error(`${S.id}: model readout "${r}" != "${t[2]}" at level ${t[0]}, drug ${t[1]}`);
}

/* ---------------- geometry ---------------- */
const FP = { origin: [0, 0], scale: 1 / Math.sqrt(1.6), azimuth: 90, elevation: 0 };
const W = (x, y) => [x, 0, -y];
const ringE = (cx, cy, rx, ry, n = 30, phase = 0, wob = 0.03) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; const w = 1 + wob * Math.sin(a * 3 + phase) + (wob / 2) * Math.cos(a * 5 - phase); return W(cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w); });
const f1 = (v) => +v.toFixed(1);
const byId = {}; S.nodes.forEach((n) => { n.rx = n.rx || 62; n.ry = n.ry || 24; byId[n.id] = n; });
const KIND_TONE = { source: "hi", mid: "mid", out: "hi", inv: "mid" };
const nodeBlob = (n, i) => blobOf(ringE(0, 0, n.rx, n.ry, 30, i + 1), FP, { tone: KIND_TONE[n.kind] || "mid", highlight: 0.7, shade: 0.9 });
const hex = (x, y, r) => pathOf(Array.from({ length: 6 }, (_, k) => [x + Math.cos((k * Math.PI) / 3) * r, y + Math.sin((k * Math.PI) / 3) * r]), true);
const trim = (a, b, pad) => { // point on the boundary of node a's ellipse towards b, pushed out by pad
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, r = 1 / Math.sqrt((dx / d / a.rx) ** 2 + (dy / d / a.ry) ** 2);
  return [a.x + (dx / d) * (r + pad), a.y + (dy / d) * (r + pad)];
};
S.edges.forEach((e) => {
  const a = byId[e.from], b = byId[e.to];
  e.p0 = trim(a, b, 4); e.p1 = trim(b, a, 9);
  e.mid = [(e.p0[0] + e.p1[0]) / 2, (e.p0[1] + e.p1[1]) / 2];
  const dx = e.p1[0] - e.p0[0], dy = e.p1[1] - e.p0[1], d = Math.hypot(dx, dy) || 1;
  e.dir = [dx / d, dy / d]; e.len = d;
});
const label = (text, x, y, anchor = "middle", cls = "") => `<text class="dr-label ${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${text}</text>`;

const edgeSvg = (e) => {
  const [x0, y0] = e.p0, [x1, y1] = e.p1, [mx, my] = e.mid, ah = 9;
  const ang = Math.atan2(e.dir[1], e.dir[0]);
  const head = `M${f1(x1)} ${f1(y1)}l${f1(-ah * Math.cos(ang - 0.45))} ${f1(-ah * Math.sin(ang - 0.45))}M${f1(x1)} ${f1(y1)}l${f1(-ah * Math.cos(ang + 0.45))} ${f1(-ah * Math.sin(ang + 0.45))}`;
  const lw = Math.max(34, String(e.label || "").length * 7.4 + 16);
  const lozenge = e.label ? `<g class="hot dr-enz" tabindex="0" data-info="${esc(e.info || e.label)}"><rect class="dr-enz-r" x="${f1(mx - lw / 2)}" y="${f1(my - 11)}" width="${f1(lw)}" height="22" rx="11"/><text class="dr-prot" x="${f1(mx)}" y="${f1(my + 4)}" text-anchor="middle">${esc(e.label)}</text></g>` : "";
  const nb = e.blockable !== false;
  const blk = nb ? `<g class="hot dr-block" id="blk-${e.id}" tabindex="0" data-info="${esc(S.blockInfo)}"><path class="dr-block-hex" d="${hex(mx, my - (e.label ? 25 : 14), 9)}"/><path class="dr-block-x" d="M${f1(mx - 3.6)} ${f1(my - (e.label ? 25 : 14) - 3.6)}L${f1(mx + 3.6)} ${f1(my - (e.label ? 25 : 14) + 3.6)}M${f1(mx + 3.6)} ${f1(my - (e.label ? 25 : 14) - 3.6)}L${f1(mx - 3.6)} ${f1(my - (e.label ? 25 : 14) + 3.6)}"/></g>` : "";
  const enh = nb ? `<g class="hot dr-block dr-enh" id="enh-${e.id}" tabindex="0" data-info="${esc(S.enhanceInfo || S.blockInfo)}"><path class="dr-ag-hex" d="${hex(mx + 22, my - (e.label ? 25 : 14), 9)}"/></g>` : "";
  return `<path class="dr-rail dr-flowline" id="ln-${e.id}" d="${pathOf([[x0, y0], [x1, y1]])}"/><path class="dr-flowhead" d="${head}"/><g id="pt-${e.id}"></g>${lozenge}${blk}${enh}`;
};
const nodeSvg = (n, i) => `<g class="hot dr-node dr-n-${n.kind}" id="nd-${n.id}" tabindex="0" data-info="${esc(n.info)}" transform="translate(${n.x} ${n.y})">${blobSvg(nodeBlob(n, i))}<text class="dr-prot dr-nl" x="0" y="${n.sub ? -1 : 4}" text-anchor="middle">${esc(n.label)}</text>${n.sub ? `<text class="dr-label dr-muted dr-ns" x="0" y="13" text-anchor="middle">${esc(n.sub)}</text>` : ""}</g>`;
const zoneSvg = (z) => `<rect class="dr-zone" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="18"/><text class="dr-label dr-muted" x="${z.x + 16}" y="${z.y + 22}">${esc(z.label)}</text>`;

const body = [
  `<ellipse class="dr-halo" cx="480" cy="626" rx="430" ry="16"/>`,
  (S.zones || []).map(zoneSvg).join(""),
  S.edges.map(edgeSvg).join(""),
  S.nodes.map(nodeSvg).join(""),
  `<g class="dr-key"><path class="dr-block-hex" d="${hex(52, 578, 7)}" style="opacity:1"/><text class="dr-label" x="68" y="582">${esc(S.blockKey || "inhibitor or blocker (generic)")}</text>${S.enhanceKey ? `<path class="dr-ag-hex" d="${hex(52, 600, 7)}" style="opacity:1"/><text class="dr-label" x="68" y="604">${esc(S.enhanceKey)}</text>` : ""}<circle class="dr-camp" cx="52" cy="622" r="4.4"/><text class="dr-label" x="68" y="626">flow: more dots, more passes this step</text></g>`,
].join("");
const svg = figureSvg({ width: WIDTH, height: HEIGHT, label: S.ariaLabel, body, className: "dr-fig" });
const start = S.level.start ?? 1;
const framed = plateHtml({ fig: "Fig 1", title: S.title, hint: "hover or focus a part · space: pause", readout: modelOf(S, start, 0).readout, caption: S.caption, body: `<div class="dr-svg">${svg}</div>` });
const controls = `
<div class="dr-controls">
  <label class="dr-range"><span>${esc(S.level.label)}</span><input id="level" type="range" min="0" max="2" step="1" value="${start}" aria-valuetext="${esc(S.level.names[start])}"><span class="dr-ticks">${S.level.ticks.map((t) => `<i>${esc(t)}</i>`).join("")}</span></label>
  <label class="dr-range"><span>${esc(S.drugLabel)}</span><select id="drug">${S.drugs.map((d, i) => `<option value="${i}">${esc(d.label)}</option>`).join("")}</select></label>
  <button id="pause" type="button" aria-pressed="false">Pause motion</button>
</div>
<p id="status" class="dr-status" aria-live="polite"></p>
<p id="info" class="dr-info" aria-live="polite">Hover or focus a labelled part for a one-line explanation.</p>`;
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
const S = ${JSON.stringify({ level: S.level, drugs: S.drugs.map((d) => ({ label: d.label, blocks: d.blocks || {} })), nodes: S.nodes.map((n) => ({ id: n.id, kind: n.kind, gain: n.gain, inv: n.inv, scale: n.scale, fixed: n.fixed, base: n.base, terms: n.terms })), edges: S.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, w: e.w, rest: e.rest })), outputs: S.outputs, readout: S.readout, status: S.status, drugNames: S.drugs.map((d) => d.status || d.label) })};
const modelOf = ${modelOf.toString()};
const GEO = ${JSON.stringify(S.edges.map((e) => ({ id: e.id, p0: e.p0, p1: e.p1 })))};
const NS = "http://www.w3.org/2000/svg";
const svg = document.querySelector(".dr-fig");
const $ = (id) => svg.querySelector("#" + id);
const readout = document.querySelector("[data-readout]");
const levelBox = document.getElementById("level"), drugBox = document.getElementById("drug"), pauseBtn = document.getElementById("pause");
const info = document.getElementById("info"), statusEl = document.getElementById("status");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v) => Math.max(0, Math.min(1, v));
const frac = (v) => v - Math.floor(v);
const mk = (name, attrs, parent) => { const el = document.createElementNS(NS, name); for (const k in attrs) el.setAttribute(k, attrs[k]); parent.appendChild(el); return el; };
let level = ${start}, drug = 0, playing = !reduce.matches, visible = true, sim = reduce.matches ? 4000 : 0, last = 0, frame = 0;
{ const q = new URLSearchParams(location.search), d0 = +q.get("d"), nm = (q.get("name") || "").replace(/[^A-Za-z0-9 \\-]/g, "").slice(0, 40);
  if (d0 > 0 && d0 < S.drugs.length) { drug = d0; drugBox.value = String(d0); }
  const l0 = q.get("l"); if (l0 === "0" || l0 === "2") { level = +l0; levelBox.value = l0; levelBox.setAttribute("aria-valuetext", S.level.names[level]); }
  if (nm) { const p = document.createElement("p"); p.className = "dr-status"; p.textContent = nm + ": the selector below is set to this drug's class. Drug classes overlap, so check the drug's own details."; statusEl.before(p); } }
let M = modelOf(S, level, drug);
const NP = 8;
const E = GEO.map((g) => ({ g, blk: $("blk-" + g.id), enh: $("enh-" + g.id), pool: $("pt-" + g.id), line: $("ln-" + g.id), f: 0, b: 0, dots: [] }));
E.forEach((e) => { for (let i = 0; i < NP; i++) { const c = mk("g", { class: "dr-particle" }, e.pool); mk("circle", { class: "dr-camp", r: 4.4 }, c); mk("circle", { class: "dr-camp-dot", r: 1.5 }, c); e.dots.push({ g: c, a: 0 }); } });
const N = S.nodes.map((n) => ({ n, el: $("nd-" + n.id), v: 0 }));
function draw(dt) {
  const k = dt >= 1000 ? 1 : 1 - Math.exp(-dt / 600);
  E.forEach((e) => {
    const f = M.flux[e.g.id], b = M.blocked[e.g.id];
    e.f += (f - e.f) * k; e.b += (b - e.b) * k;
    if (e.blk) e.blk.style.opacity = (e.b > 0.02 ? 0.35 + 0.65 * e.b : 0).toFixed(2);
    if (e.enh) e.enh.style.opacity = (e.b < -0.02 ? 0.35 + 0.65 * clamp(-e.b) : 0).toFixed(2);
    e.line.style.opacity = (0.35 + 0.65 * clamp(e.f * 1.4)).toFixed(2);
    const nd = Math.round(clamp(e.f) * NP);
    e.dots.forEach((d, i) => {
      d.a += ((i < nd ? 1 : 0) - d.a) * (dt >= 1000 ? 1 : 1 - Math.exp(-dt / 400));
      if (d.a < 0.02) { d.g.style.opacity = 0; return; }
      const u = frac(sim / 3600 + i / NP);
      d.g.setAttribute("transform", "translate(" + (e.g.p0[0] + (e.g.p1[0] - e.g.p0[0]) * u).toFixed(1) + " " + (e.g.p0[1] + (e.g.p1[1] - e.g.p0[1]) * u).toFixed(1) + ")");
      d.g.style.opacity = (d.a * (u < 0.1 ? u / 0.1 : u > 0.9 ? (1 - u) / 0.1 : 1)).toFixed(2);
    });
  });
  N.forEach((o) => { o.v += (M.lv[o.n.id] - o.v) * k; o.el.style.setProperty("--on", o.v.toFixed(2)); });
}
function publish() {
  M = modelOf(S, level, drug);
  if (M.readout !== readout.textContent) readout.textContent = M.readout;
  statusEl.textContent = S.status.replace("{level}", S.level.names[level]).replace("{drug}", S.drugNames[drug]) + " " + M.readout + ". Qualitative, illustrative.";
}
function tick(now) { frame = 0; if (!playing || !visible) return; const dt = Math.min(64, now - (last || now)); last = now; sim += dt; draw(dt); frame = requestAnimationFrame(tick); }
function still() { draw(1000); }
function start() { if (playing && visible && !frame) { last = 0; frame = requestAnimationFrame(tick); } }
function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; }
levelBox.addEventListener("input", () => { level = +levelBox.value; levelBox.setAttribute("aria-valuetext", S.level.names[level]); publish(); if (!playing) still(); });
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
.dr-flowline{stroke:var(--anatomy-mid);stroke-width:1.5}
.dr-flowhead{fill:none;stroke:var(--anatomy-mid);stroke-width:1.5;stroke-linecap:round}
.dr-enz-r{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}
.dr-node{--on:0}
.dr-node .bio-blob-edge{stroke:color-mix(in srgb,var(--anatomy-lit) calc(var(--on,0) * 100%),var(--anatomy-hi))}
.dr-node{filter:drop-shadow(0 0 calc(var(--on,0) * 6px) var(--anatomy-lit))}
.dr-n-out .dr-nl{fill:var(--anatomy-strong)}
.dr-nl{pointer-events:none}.dr-ns{pointer-events:none;font-size:10.5px}
.dr-ag-hex{fill:var(--anatomy-green);stroke:var(--anatomy-green);stroke-width:1.2}
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
