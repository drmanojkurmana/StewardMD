/* Owner review page for the dose-calculator extraction (phase 1).
 *
 *   node scripts/build-dose-review-page.mjs <out.html>
 *
 * Reads data/dose-rules.json (run scripts/build-dose-rules.mjs first) and the monograph tags, and
 * writes one self-contained HTML page: every per-kg / per-m2 dose row, every renal band set and every
 * Child-Pugh set, each showing the source sentence, what the parser read, a worked example, and
 * Correct / Wrong buttons. Marks are saved in the artifact's db (collection "verdicts") so they can be
 * read back and fixed in the parser. Not shipped in the app.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const out = process.argv[2];
if (!out) { console.error("usage: node scripts/build-dose-review-page.mjs <out.html>"); process.exit(1); }
const R = JSON.parse(readFileSync(join(ROOT, "data/dose-rules.json"), "utf8"));

// High-alert flag from the monograph tags (narrow margin, anticoagulant, cytotoxic, aminoglycoside...).
const HIGH = /narrow therapeutic|anticoagul|antineoplast|cytotoxic|chemotherap|aminoglycoside|insulin|opioid|neuromuscular block|antiarrhythm|high.?alert|thrombolytic|immunosuppress|digoxin|glycopeptide/i;
const tags = {};
for (const f of readdirSync(join(ROOT, "worker/data/gold"))) {
  if (!f.endsWith(".json")) continue;
  try { const g = JSON.parse(readFileSync(join(ROOT, "worker/data/gold", f), "utf8")); tags[g.generic] = (g.tags || []).join(" ") + " " + (g.cls || ""); } catch (e) {}
}

const EX = { adult: 55, any: 55, child: 15, neonate: 3 };
const toMg = { mcg: 0.001, mg: 1, g: 1000 };
const fmt = (n) => (n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100).toLocaleString("en-IN");
function example(r) {
  const w = EX[r.pop] || 55, bsa = r.pop === "child" ? 0.65 : r.pop === "neonate" ? 0.2 : 1.6;
  const lines = [];
  r.p.filter((p) => p.per === "kg" || p.per === "m2").forEach((p) => {
    const f = p.per === "kg" ? w : bsa, by = p.per === "kg" ? w + " kg" : bsa + " m²";
    const lo = p.lo != null ? p.lo * f : null, hi = p.hi != null ? p.hi * f : null;
    let v = (lo != null ? fmt(lo) : "up to ") + (hi != null ? (lo != null ? "-" : "") + fmt(hi) : "") + " " + p.u + (p.tm ? " per " + p.tm : "");
    // Ceilings: per-kg ones scale, plain ones are compared in mg.
    const top = hi != null ? hi : lo;
    r.cap.forEach((c) => {
      if (c.per === "kg" && p.per === "kg" && c.u === p.u && (c.tm || null) === (p.tm || null) && top > c.v * w) v += ", capped at " + fmt(c.v * w) + " " + c.u;
      if (!c.per && toMg[c.u] && toMg[p.u] && (c.tm || null) === (p.tm || null) && top * toMg[p.u] > c.v * toMg[c.u]) v += ", capped at " + fmt(c.v) + " " + c.u;
    });
    lines.push((p.l ? p.l[0].toUpperCase() + p.l.slice(1) + ": " : "") + (p.lo != null ? p.lo : "up to ") + (p.hi != null ? (p.lo != null ? "-" : "") + p.hi : "") + " " + p.u + "/" + (p.per === "kg" ? "kg" : "m²") + " × " + by + " = " + v);
  });
  return lines;
}

const items = [];
R.drugs.forEach((d) => {
  const hi = HIGH.test(tags[d.n] || "") || HIGH.test(d.c || "");
  d.rows.forEach((r, i) => {
    if (r.k !== "perkg" && r.k !== "perm2") return;
    items.push({ id: "dose~" + d.n + "~" + i, t: r.k === "perkg" ? "kg" : "m2", drug: d.n, cls: d.c, hi,
      ctx: r.ctx, pop: r.pop, basis: r.b, src: [r.d, r.t, r.note].filter(Boolean).join(" · "),
      marks: r.p.map((p) => p.src).concat(r.cap.map((c) => c.src)),
      read: r.p.map((p) => ({ v: (p.lo != null ? p.lo : "up to ") + (p.hi != null ? (p.lo != null ? "-" : "") + p.hi : ""), u: p.u + "/" + (p.per === "kg" ? "kg" : "m²") + (p.tm ? " per " + p.tm : ""), l: p.l || "" })),
      caps: r.cap.map((c) => c.v + " " + c.u + (c.per === "kg" ? "/kg" : "") + (c.tm ? " per " + c.tm : "")),
      ex: example(r) });
  });
  if (d.ren.bands.length) items.push({ id: "renal~" + d.n, t: "renal", drug: d.n, cls: d.c, hi, src: d.ren.text, measure: d.ren.m,
    bands: d.ren.bands.map((b) => ({ r: (b.lo ? fmt(b.lo) : "0") + (b.hi == null ? " and above" : " to " + fmt(b.hi)), a: b.advice,
      f: [b.factor ? Math.round(b.factor * 100) + "% of the dose" : "", b.every ? "every " + b.every + " h" : "", b.avoid ? "avoid" : "", b.mixed ? "unclear: shows full note" : "", b.sentence ? "whole sentence" : ""].filter(Boolean) })),
    dia: d.ren.dia || "" });
  if (Object.keys(d.hep.cp).length) items.push({ id: "liver~" + d.n, t: "liver", drug: d.n, cls: d.c, hi, src: d.hep.text,
    classes: ["A", "B", "C"].filter((k) => d.hep.cp[k]).map((k) => ({ k, a: d.hep.cp[k].advice, f: [d.hep.cp[k].factor ? Math.round(d.hep.cp[k].factor * 100) + "% of the dose" : "", d.hep.cp[k].avoid ? "avoid" : "", d.hep.cp[k].none ? "no change" : ""].filter(Boolean) })) });
});

const counts = { kg: items.filter((x) => x.t === "kg").length, m2: items.filter((x) => x.t === "m2").length, renal: items.filter((x) => x.t === "renal").length, liver: items.filter((x) => x.t === "liver").length };
const DATA = JSON.stringify({ built: R.version, drugs: R.drugs.length, counts, items }).replace(/</g, "\\u003c");

const html = `<title>Dose Rules Review</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
:root{--bg:#f4f7f6;--panel:#ffffff;--ink:#12202a;--mut:#5b6b75;--line:#dce4e2;--acc:#0f766e;--acc-soft:#e3f2ef;--ok:#1c7a4a;--ok-soft:#e5f4ea;--bad:#b42318;--bad-soft:#fdecea;--warn:#9a5b00;--warn-soft:#fff3dd;--mark:#fff1b8;
--sans:"IBM Plex Sans",-apple-system,system-ui,sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#0d1417;--panel:#151f23;--ink:#e3ecea;--mut:#93a4a8;--line:#26363b;--acc:#37b8a6;--acc-soft:#153430;--ok:#4cc38a;--ok-soft:#14301f;--bad:#ff7b6e;--bad-soft:#3a1714;--warn:#f0b454;--warn-soft:#352812;--mark:#4a3f10}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#0d1417;--panel:#151f23;--ink:#e3ecea;--mut:#93a4a8;--line:#26363b;--acc:#37b8a6;--acc-soft:#153430;--ok:#4cc38a;--ok-soft:#14301f;--bad:#ff7b6e;--bad-soft:#3a1714;--warn:#f0b454;--warn-soft:#352812;--mark:#4a3f10}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:15px/1.5 var(--sans);padding-inline:16px}
.wrap{max-width:880px;margin:0 auto;padding-block:20px 60px}
header h1{font:700 26px/1.2 var(--sans);letter-spacing:-.01em;margin:0 0 4px;text-wrap:balance}
header p{margin:0;color:var(--mut);max-width:68ch}
.stat{display:flex;flex-wrap:wrap;gap:8px 18px;margin:14px 0 6px;font:500 13px var(--sans);color:var(--mut)}
.stat b{font:600 15px var(--mono);color:var(--ink);font-variant-numeric:tabular-nums}
.bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin:6px 0 2px;display:flex}
.bar i{display:block;height:100%}
.bar .o{background:var(--ok)}.bar .x{background:var(--bad)}
.note{font-size:13px;color:var(--warn);background:var(--warn-soft);border-radius:8px;padding:8px 12px;margin-top:10px}
.tools{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--bg);padding-block:12px 10px;border-bottom:1px solid var(--line);margin-bottom:14px;display:flex;flex-direction:column;gap:8px}
.tabs,.chips{display:flex;flex-wrap:wrap;gap:6px}
.tabs button,.chips button{font:600 13px var(--sans);border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:7px 12px;cursor:pointer;min-height:36px}
.tabs button[aria-pressed="true"]{background:var(--acc);border-color:var(--acc);color:#fff}
.chips button[aria-pressed="true"]{background:var(--acc-soft);border-color:var(--acc);color:var(--acc)}
.tabs button span{font:500 12px var(--mono);opacity:.8;margin-left:4px}
#q{width:100%;font:500 15px var(--sans);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink)}
#q:focus,button:focus-visible,textarea:focus{outline:2px solid var(--acc);outline-offset:1px}
.list{display:flex;flex-direction:column;gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.card.ok{border-color:color-mix(in srgb,var(--ok) 45%,var(--line))}
.card.bad{border-color:var(--bad)}
.hd{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px}
.hd h2{font:600 16px/1.3 var(--sans);margin:0}
.cls{font-size:12.5px;color:var(--mut)}
.pill{font:600 11px var(--sans);letter-spacing:.04em;text-transform:uppercase;border-radius:999px;padding:2px 8px;background:var(--acc-soft);color:var(--acc)}
.pill.hi{background:var(--bad-soft);color:var(--bad)}
.ctx{font:500 13px var(--sans);color:var(--mut)}
.src{font:13px/1.55 var(--mono);background:color-mix(in srgb,var(--bg) 60%,var(--panel));border:1px solid var(--line);border-radius:8px;padding:8px 10px;overflow-wrap:anywhere}
.src mark{background:var(--mark);color:inherit;border-radius:3px;padding:0 2px}
.read{display:flex;flex-wrap:wrap;gap:6px}
.read span{font:500 12.5px var(--mono);background:var(--acc-soft);color:var(--acc);border-radius:6px;padding:3px 8px}
.read span.cap{background:var(--warn-soft);color:var(--warn)}
.ex{font:500 13.5px/1.5 var(--mono);color:var(--ink);margin:0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:2px}
.ex li::before{content:"= ";color:var(--mut)}
.lbl{font:600 11px var(--sans);text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}
table{width:100%;border-collapse:collapse;font-size:13.5px}
td{border-top:1px solid var(--line);padding:6px 8px 6px 0;vertical-align:top}
td:first-child{font:500 13px var(--mono);white-space:nowrap;width:1%;padding-right:12px;font-variant-numeric:tabular-nums}
td small{display:block;color:var(--warn);font:500 12px var(--sans)}
.dia{font-size:13px;color:var(--mut)}
.act{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.act button{font:600 14px var(--sans);border-radius:9px;padding:8px 14px;min-height:40px;cursor:pointer;border:1px solid var(--line);background:var(--panel);color:var(--ink)}
.act .y[aria-pressed="true"]{background:var(--ok);border-color:var(--ok);color:#fff}
.act .n[aria-pressed="true"]{background:var(--bad);border-color:var(--bad);color:#fff}
.act textarea{flex:1 1 260px;min-height:40px;font:14px var(--sans);border:1px solid var(--line);border-radius:9px;padding:8px 10px;background:var(--panel);color:var(--ink);resize:vertical}
.act .saved{font-size:12px;color:var(--mut)}
.more{align-self:center;font:600 14px var(--sans);border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:10px;padding:10px 18px;cursor:pointer;margin-top:6px}
.empty{color:var(--mut);text-align:center;padding:30px 0}
@media (prefers-reduced-motion:no-preference){.card{transition:border-color .2s}}
</style>
<div class="wrap">
<header>
  <h1>Dose rules review</h1>
  <p>Every number the dose calculator will use, read from our drug monographs. Check the highlighted words against what the parser read and the worked example, then mark each one. Anything marked wrong is fixed before the calculator is switched on.</p>
  <div class="stat" id="stat"></div>
  <div class="bar" aria-hidden="true"><i class="o" id="barO"></i><i class="x" id="barX"></i></div>
  <div class="note" id="offline" hidden>Marks are saved in this browser only on this view, so they will not reach the team. Open the page from claude.ai to save them.</div>
</header>
<div class="tools">
  <div class="tabs" role="group" aria-label="What to review" id="tabs"></div>
  <div class="chips" role="group" aria-label="Filter" id="chips"></div>
  <input id="q" type="search" placeholder="Find a drug" autocomplete="off" aria-label="Find a drug">
</div>
<div class="list" id="list"></div>
</div>
<script>
const D = ${DATA};
const TABS = [["kg","Weight doses"],["m2","Body surface"],["renal","Kidney"],["liver","Liver"]];
const S = { tab: "kg", filter: "all", q: "", shown: 40, v: {} };
let db = null;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const key = (id) => id.replace(/[^A-Za-z0-9_\\-.~:@+]/g, "_").slice(0, 190);
try { S.tab = localStorage.getItem("dr_tab") || "kg"; } catch (e) {}

function mark(src, marks) {
  let h = esc(src);
  [...new Set(marks)].sort((a, b) => b.length - a.length).forEach((m) => { const e = esc(m); h = h.split(e).join("\\u0000" + e + "\\u0001"); });
  return h.replace(/\\u0000/g, "<mark>").replace(/\\u0001/g, "</mark>");
}
function visible() {
  const q = S.q.trim().toLowerCase();
  return D.items.filter((it) => it.t === S.tab
    && (!q || it.drug.toLowerCase().includes(q))
    && (S.filter === "all" || (S.filter === "hi" && it.hi) || (S.filter === "todo" && !S.v[key(it.id)]) || (S.filter === "bad" && S.v[key(it.id)] && S.v[key(it.id)].verdict === "wrong")));
}
function card(it) {
  const v = S.v[key(it.id)] || {}, st = v.verdict === "ok" ? " ok" : v.verdict === "wrong" ? " bad" : "";
  let body = "";
  if (it.t === "kg" || it.t === "m2") {
    body += (it.ctx ? '<div class="ctx">' + esc(it.ctx) + (it.pop !== "any" ? " · " + esc(it.pop) : "") + (it.basis !== "actual" ? " · uses " + esc(it.basis) + " body weight" : "") + "</div>" : "")
      + '<div class="src">' + mark(it.src, it.marks) + "</div>"
      + '<div class="lbl">Read as</div><div class="read">' + it.read.map((r) => "<span>" + (r.l ? esc(r.l) + ": " : "") + esc(r.v + " " + r.u) + "</span>").join("") + it.caps.map((c) => '<span class="cap">max ' + esc(c) + "</span>").join("") + "</div>"
      + '<div class="lbl">Example</div><ul class="ex">' + it.ex.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>";
  } else if (it.t === "renal") {
    body += '<div class="src">' + esc(it.src) + "</div><div class=\\"lbl\\">Read as (" + esc(it.measure) + " mL/min)</div><table>" + it.bands.map((b) => "<tr><td>" + esc(b.r) + "</td><td>" + esc(b.a) + (b.f.length ? "<small>" + esc(b.f.join(" · ")) + "</small>" : "") + "</td></tr>").join("") + "</table>"
      + (it.dia ? '<div class="dia"><b>On dialysis:</b> ' + esc(it.dia) + "</div>" : "");
  } else {
    body += '<div class="src">' + esc(it.src) + '</div><div class="lbl">Read as</div><table>' + it.classes.map((c) => "<tr><td>Child-Pugh " + c.k + "</td><td>" + esc(c.a) + (c.f.length ? "<small>" + esc(c.f.join(" · ")) + "</small>" : "") + "</td></tr>").join("") + "</table>";
  }
  return '<article class="card' + st + '" data-id="' + esc(it.id) + '"><div class="hd"><h2>' + esc(it.drug) + "</h2>" + (it.hi ? '<span class="pill hi">High-alert</span>' : "") + '<span class="cls">' + esc(it.cls) + "</span></div>" + body
    + '<div class="act"><button class="y" aria-pressed="' + (v.verdict === "ok") + '" data-v="ok">Correct</button><button class="n" aria-pressed="' + (v.verdict === "wrong") + '" data-v="wrong">Wrong</button>'
    + (v.verdict === "wrong" ? '<textarea id="n_' + esc(key(it.id)) + '" placeholder="What is wrong? (optional)">' + esc(v.note || "") + "</textarea>" : "")
    + (v.at ? '<span class="saved">Saved</span>' : "") + "</div></article>";
}
function render() {
  const all = D.items, done = all.filter((i) => S.v[key(i.id)]), bad = done.filter((i) => S.v[key(i.id)].verdict === "wrong");
  document.getElementById("stat").innerHTML = "<span><b>" + D.drugs.toLocaleString("en-IN") + "</b> monographs read</span><span><b>" + all.length + "</b> rules to check</span><span><b>" + done.length + "</b> checked</span><span><b>" + bad.length + "</b> marked wrong</span><span>built " + esc(D.built) + "</span>";
  document.getElementById("barO").style.width = ((done.length - bad.length) / all.length * 100) + "%";
  document.getElementById("barX").style.width = (bad.length / all.length * 100) + "%";
  document.getElementById("tabs").innerHTML = TABS.map((t) => '<button data-tab="' + t[0] + '" aria-pressed="' + (S.tab === t[0]) + '">' + t[1] + "<span>" + D.counts[t[0]] + "</span></button>").join("");
  document.getElementById("chips").innerHTML = [["all","All"],["hi","High-alert"],["todo","Not checked"],["bad","Marked wrong"]].map((c) => '<button data-f="' + c[0] + '" aria-pressed="' + (S.filter === c[0]) + '">' + c[1] + "</button>").join("");
  let vis = visible();
  if (S.filter === "hi") vis = vis.filter((i) => i.hi);
  const list = document.getElementById("list");
  list.innerHTML = vis.length ? vis.slice(0, S.shown).map(card).join("") + (vis.length > S.shown ? '<button class="more" id="more">Show more (' + (vis.length - S.shown) + " left)</button>" : "") : '<p class="empty">Nothing here.</p>';
}
async function save(id, verdict, note) {
  const k = key(id), body = { item: id, verdict, note: note || "", at: new Date().toISOString() };
  S.v[k] = body; render();
  if (db) { try { await db.collection("verdicts").doc(k).set(body); } catch (e) { document.getElementById("offline").hidden = false; } }
  else { try { localStorage.setItem("dr_v", JSON.stringify(S.v)); } catch (e) {} }
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab]"); if (t) { S.tab = t.dataset.tab; S.shown = 40; try { localStorage.setItem("dr_tab", S.tab); } catch (x) {} render(); return; }
  const f = e.target.closest("[data-f]"); if (f) { S.filter = f.dataset.f; S.shown = 40; render(); return; }
  if (e.target.id === "more") { S.shown += 40; render(); return; }
  const b = e.target.closest("[data-v]"); if (b) { const c = b.closest(".card"), id = c.dataset.id, ta = c.querySelector("textarea"); save(id, b.dataset.v, ta ? ta.value : ""); }
});
let noteT = null;
document.addEventListener("input", (e) => {
  if (e.target.id === "q") { S.q = e.target.value; S.shown = 40; render(); const q = document.getElementById("q"); q.focus(); return; }
  if (e.target.tagName === "TEXTAREA") { const c = e.target.closest(".card"), id = c.dataset.id, val = e.target.value; clearTimeout(noteT); noteT = setTimeout(() => { const k = key(id), cur = S.v[k]; if (!cur || cur.note === val) return; const body = Object.assign({}, cur, { note: val, at: new Date().toISOString() }); S.v[k] = body; if (db) db.collection("verdicts").doc(k).set(body).catch(() => {}); }, 700); }
});
try { const l = JSON.parse(localStorage.getItem("dr_v") || "{}"); if (l && typeof l === "object") S.v = l; } catch (e) {}
render();
(async () => {
  try { db = await (window.claude && window.claude.use ? window.claude.use("db") : null); } catch (e) { db = null; }
  if (!db) { document.getElementById("offline").hidden = false; return; }
  db.collection("verdicts").onSnapshot((snap) => {
    const v = {}; snap.docs.forEach((d) => { if (d.exists) v[d.id] = d.data(); });
    const active = document.activeElement && document.activeElement.tagName === "TEXTAREA";
    S.v = v; if (!active) render();
  }, () => { document.getElementById("offline").hidden = false; });
})();
</script>`;
writeFileSync(out, html);
console.log("wrote", out, (html.length / 1024).toFixed(0) + " KB", JSON.stringify(counts));
