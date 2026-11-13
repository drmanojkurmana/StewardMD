#!/usr/bin/env node
/* Ship ONE file per interactive figure in the app bundle (build-www step; the repo keeps both builds).
 *
 * prep/figures/<name>.html (dark) and <name>-light.html (light) are byte-identical except the body's
 * data-theme (and, for figures that link to an alternate view, that link's "-light" suffix). That was
 * 336 duplicate pages, about 42 MB of the bundle. Here, inside www/ only:
 *   1. every dark page gets a tiny script right after its <body ...> tag that switches it to light when the
 *      iframe is named "smdfig-light" (fig-viewer.js names it so). A frame's name survives navigation inside
 *      it, so the alternate-view link stays light without a "-light" twin;
 *   2. a light twin is deleted only when it is equivalent to the dark page under that rule; any other
 *      difference fails the build rather than silently changing what a light-theme reader sees;
 *   3. www/index.html gets window.SMD_FIG_ONEFILE=1, which tells fig-viewer.js to open the dark page.
 *
 *   node scripts/slim-figures.mjs <www dir>
 */
import fs from "node:fs";
import path from "node:path";

export const SNIPPET = '<script>try{if(window.name==="smdfig-light")document.body.setAttribute("data-theme","light")}catch(e){}</script>';
const BODY_RE = /<body\b[^>]*\bdata-theme="dark"[^>]*>/;

/* The light page as the dark page's light rendering would read it: theme attribute and link suffixes normalised. */
export function equivalent(dark, light) {
  const norm = (s) => s.replace(/data-theme="(light|dark)"/g, "").replace(/(data-href="[a-z0-9-]+?)-light\.html"/g, '$1.html"');
  return norm(dark) === norm(light);
}

export function inject(dark) {
  if (dark.includes(SNIPPET)) return dark;
  const m = BODY_RE.exec(dark);
  if (!m) return null;
  return dark.slice(0, m.index + m[0].length) + SNIPPET + dark.slice(m.index + m[0].length);
}

export function slim(dir) {
  const out = { pages: 0, removed: 0, bytes: 0, problems: [] };
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".html") || f.endsWith("-light.html")) continue;
    const dp = path.join(dir, f), lp = path.join(dir, f.replace(/\.html$/, "-light.html"));
    const dark = fs.readFileSync(dp, "utf8");
    if (!fs.existsSync(lp)) continue;   // no light build: nothing to fold
    const light = fs.readFileSync(lp, "utf8");
    if (!equivalent(dark, light)) { out.problems.push(f + ": light build differs beyond the theme"); continue; }
    const next = inject(dark);
    if (next == null) { out.problems.push(f + ": no <body data-theme=\"dark\"> tag"); continue; }
    fs.writeFileSync(dp, next);
    out.bytes += Buffer.byteLength(light);
    fs.unlinkSync(lp);
    out.pages++; out.removed++;
  }
  return out;
}

if (import.meta.url === "file://" + process.argv[1]) {
  const www = process.argv[2];
  if (!www) { console.error("usage: slim-figures.mjs <www dir>"); process.exit(2); }
  const r = slim(path.join(www, "prep/figures"));
  if (r.problems.length) { console.error("  figures: " + r.problems.join("; ")); process.exit(1); }
  const idx = path.join(www, "index.html");
  if (r.removed && fs.existsSync(idx)) {
    const s = fs.readFileSync(idx, "utf8");
    if (!s.includes("window.SMD_FIG_ONEFILE=0;")) { console.error("  figures: index.html has no SMD_FIG_ONEFILE flag"); process.exit(1); }
    fs.writeFileSync(idx, s.replace("window.SMD_FIG_ONEFILE=0;", "window.SMD_FIG_ONEFILE=1;"));
  }
  console.log("  figures: one file per figure (" + r.removed + " light twins removed, " + (r.bytes / 1e6).toFixed(1) + " MB)");
}
