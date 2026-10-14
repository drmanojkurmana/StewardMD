// node scripts/lesson-diagrams/check.mjs : checkLesson + cleared-media + dash + file-exists for every lesson that carries an ana-/phy- figure
import { createRequire } from "node:module"; import fs from "node:fs";
const P = createRequire(import.meta.url)("../../prep-lessons.js");
const dir = new URL("../../prep/lessons/v1/", import.meta.url).pathname; let n = 0, bad = 0, figs = 0;
const RE = /^prep\/lessons\/media\/[a-z0-9-]+\.(?:svg|webp|png)$/;
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".json") || f === "index.json") continue;
  const l = JSON.parse(fs.readFileSync(dir + f, "utf8")); let mine = false;
  for (const s of l.steps) if (s.vis && s.vis.kind === "image" && /\/(ana|phy)-/.test(s.vis.src)) {
    mine = true; figs++;
    const p = [];
    if (!RE.test(s.vis.src)) p.push("uncleared"); if (!fs.existsSync(new URL("../../" + s.vis.src, import.meta.url))) p.push("missing file");
    if (/[–—]/.test(s.vis.alt + s.vis.caption)) p.push("dash");
    const svg = fs.existsSync(new URL("../../" + s.vis.src, import.meta.url)) ? fs.readFileSync(new URL("../../" + s.vis.src, import.meta.url), "utf8") : "";
    if (/[–—]/.test(svg)) p.push("dash in svg"); if (!/<title/.test(svg) || !/<desc/.test(svg)) p.push("no title/desc");
    if (p.length) { bad++; console.log(f, p.join()); }
  }
  if (mine) { n++; const pr = P.checkLesson(l); if (pr.length) { bad++; console.log(f, pr.join("; ")); } }
}
console.log("lessons", n, "figures", figs, "problems", bad); process.exit(bad ? 1 : 0);
