/* Audit every registered scene page for label density, rendered type size, pill overlap and overflow.
 *   node tools/figures/dev/audit.mjs [batch]
 * batch is how many scenes this process finishes (default 24). 0 means all that remain.
 * Re-run the same command to continue. Each viewport row is appended before the resume file
 * is updated, so a kill loses at most the row in progress.
 *   ~/Documents/figure-audit.tsv
 *   ~/Documents/figure-audit.resume.json
 * Columns: id, viewport, labels, min_px, overlap, outside, tiny
 * labels / overlap / outside use visible .dr-lab chips (pill() in bio.lib.js). .p-pill is a
 * drug capsule mark with no text, so it is not a label. No screenshots. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, serve } from "./pw.mjs";

const VIEWS = [{ w: 390, h: 844 }, { w: 820, h: 1180 }, { w: 1024, h: 768 }];
const OUT = path.join(os.homedir(), "Documents", "figure-audit.tsv");
const RESUME = path.join(os.homedir(), "Documents", "figure-audit.resume.json");
const batchArg = process.argv[2];
const batch = batchArg === undefined ? 24 : Math.max(0, +batchArg || 0);
const reg = JSON.parse(fs.readFileSync(new URL("../../../prep/figures/figures.json", import.meta.url))).figures.filter((f) => f.scene);

function loadDone() {
  const done = new Set();
  if (fs.existsSync(RESUME)) {
    try { for (const k of JSON.parse(fs.readFileSync(RESUME, "utf8"))) if (k) done.add(k); } catch { /* rewrite on next save */ }
  }
  if (fs.existsSync(OUT)) {
    for (const line of fs.readFileSync(OUT, "utf8").split("\n").slice(1)) {
      const [id, vp] = line.split("\t");
      if (id && vp) done.add(id + "|" + vp);
    }
  }
  return done;
}
function saveDone(done) {
  const tmp = RESUME + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify([...done]));
  fs.renameSync(tmp, RESUME);
}
function key(id, v) { return id + "|" + v.w + "x" + v.h; }

const done = loadDone();
const pending = [];
for (const f of reg) for (const v of VIEWS) if (!done.has(key(f.id, v))) pending.push({ id: f.id, v });
const work = batch ? pending.slice(0, batch * VIEWS.length) : pending;
if (!fs.existsSync(OUT)) fs.writeFileSync(OUT, "id\tviewport\tlabels\tmin_px\toverlap\toutside\ttiny\n");
if (!work.length) { console.log("audit complete", reg.length, "scenes"); process.exit(0); }

const { srv, port } = serve();
const b = await launch();
const ctx = await b.newContext({ deviceScaleFactor: 1 });
const page = await ctx.newPage();
let n = 0;
try {
  for (const job of work) {
    const { id, v } = job;
    await page.setViewportSize({ width: v.w, height: v.h });
    let row;
    try {
      await page.goto(`http://localhost:${port}/prep/figures/${id}.html`, { waitUntil: "load" });
      await page.waitForTimeout(1200);
      row = await page.evaluate(() => {
        const stage = document.querySelector("svg.dr-fig") || document.querySelector("svg");
        if (!stage) return { labels: 0, min: "", overlap: 0, outside: 0, tiny: 0 };
        const shown = (el) => {
          const r = el.getBoundingClientRect();
          if (r.width < 0.5 || r.height < 0.5) return false;
          for (let n = el; n; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.display === "none" || cs.visibility === "hidden") return false;
            if (parseFloat(cs.opacity) === 0) return false;
          }
          return true;
        };
        const box = stage.getBoundingClientRect();
        const pills = [...stage.querySelectorAll(".dr-lab")].filter(shown).map((g) => (g.querySelector(".dr-lab-r") || g).getBoundingClientRect());
        let overlap = 0, outside = 0;
        for (let i = 0; i < pills.length; i++) {
          const a = pills[i];
          if (a.left < box.left - 1 || a.top < box.top - 1 || a.right > box.right + 1 || a.bottom > box.bottom + 1) outside++;
          for (let j = i + 1; j < pills.length; j++) {
            const c = pills[j];
            if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) overlap++;
          }
        }
        const own = (el) => [...el.childNodes].some((nd) => nd.nodeType === 3 && nd.textContent.trim());
        let min = Infinity, tiny = 0;
        for (const el of stage.querySelectorAll("text, tspan")) {
          if (!own(el) || !shown(el)) continue;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          const m = el.getScreenCTM();
          if (!fs || !m) continue;
          const px = fs * Math.hypot(m.a, m.b);
          if (px < min) min = px;
          if (px < 9) tiny++;
        }
        return { labels: pills.length, min: min === Infinity ? "" : min.toFixed(2), overlap, outside, tiny };
      });
    } catch (e) {
      console.error("ERR", id, v.w + "x" + v.h, String(e.message || e).split("\n")[0]);
      continue;
    }
    fs.appendFileSync(OUT, [id, v.w + "x" + v.h, row.labels, row.min, row.overlap, row.outside, row.tiny].join("\t") + "\n");
    done.add(key(id, v));
    saveDone(done);
    n++;
    console.log([id, v.w + "x" + v.h, row.labels, row.min, row.overlap, row.outside, row.tiny].join("\t"));
  }
} finally {
  await b.close();
  srv.close();
}
console.log("wrote", n, "rows;", done.size, "of", reg.length * VIEWS.length, "done");
