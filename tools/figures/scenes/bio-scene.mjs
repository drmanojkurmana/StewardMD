/* Shared page builder for the animated mechanism scenes. A scene file builds its SVG body and model, then calls buildScene(...).
 *   ANATOMY_DIR / ANIMA_DIR point at the MIT kits (defaults below). Writes prep/figures/<id>.html and <id>-light.html. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "../../..");
const AN = process.env.ANATOMY_DIR || "/home/user/wheresryan22/anatomy";
export const k = await import(pathToFileURL(join(AN, "kit/iso-kit.mjs")));
const { BIO_CSS } = await import(pathToFileURL(join(process.env.ANIMA_DIR || "/home/user/garinmckayl/anima", "kit/blob.mjs")));
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildScene(o) {
  const { id, fig = "Fig 1", title, hint = "tap a part · space: pause", caption, W, H, body, label, scene = {}, pageJs, modelOf, MD, tests = [], withLabel, withoutLabel, sourcesLis = [], simplified, extraCss = "", extraControls = "", organs = false } = o;
  if (process.argv.includes("--print-model")) { for (let l = 0; l < MD.level.a.length; l++) for (let d = 0; d < MD.settings.length; d++) console.log(JSON.stringify([l, d, modelOf(MD, l, d).readout])); process.exit(0); }
  for (const [l, d, t] of tests) { const r = modelOf(MD, l, d).readout; if (r !== t) throw new Error(`${id}: model readout "${r}" != "${t}" at level ${l}, drug ${d}`); }
  const start = modelOf(MD, MD.level.start, 0).readout;
  const SVG = k.figureSvg({ width: W, height: H, label, body: `<ellipse class="dr-halo" cx="${W / 2}" cy="${H - 6}" rx="${W * 0.46}" ry="12"/>${body}`, className: "dr-fig" });
  const framed = k.plateHtml({ fig, title, hint, readout: start, caption, body: `<div class="dr-svg">${SVG}</div>` });
  const controls = `
<div class="dr-controls">
  <label class="dr-range"><span>${esc(MD.level.label)}</span><input id="level" type="range" min="0" max="${MD.level.a.length - 1}" step="1" value="${MD.level.start}" aria-valuetext="${esc(MD.level.names[MD.level.start])}"><span class="dr-ticks">${MD.level.ticks.map((t) => `<i>${esc(t)}</i>`).join("")}</span></label>
  <label class="dr-range"><span>${esc(MD.drugLabel)}</span><select id="drug" data-without="${esc(withoutLabel)}" data-with="${esc(withLabel)}">${MD.settings.map((d, i) => `<option value="${i}">${esc(d.label)}</option>`).join("")}</select></label>${extraControls}
  <button id="pause" type="button" aria-pressed="false">Pause motion</button>
</div>
<p id="status" class="dr-status" aria-live="polite"></p>
<p id="info" class="dr-info" aria-live="polite">Hover or focus a labelled part for a one-line explanation.</p>`;
  const sources = `<footer class="bio-sources">
<h2>What the figure shows, and how sure we are</h2>
<ul>${sourcesLis.map((s) => `<li>${s}</li>`).join("")}</ul>
<p><strong>What was simplified.</strong> ${simplified}</p>
<p>Interactive figure built with the <a href="https://github.com/wheresryan22/anatomy">Anatomy</a> and <a href="https://github.com/Garinmckayl/anima">Anima</a> kits (MIT licence). All drawing is original.</p>
<p>For education only; this figure is not medical advice and says nothing about any person's treatment or any medicine. It is AI-assisted and awaits clinician review.</p>
</footer>`;
  const SC = { ...scene, S: { level: MD.level, settings: MD.settings, drugNames: MD.drugNames, status: MD.status } };
  const script = `const SC = ${JSON.stringify(SC)};\nconst modelOf = ${modelOf.toString()};\n` + readFileSync(join(HERE, "bio.lib.js"), "utf8") + "\n" + (organs ? readFileSync(join(HERE, "organs.lib.js"), "utf8") + "\n" : "") + pageJs;
  const CSS = readFileSync(join(HERE, "../figure.css"), "utf8") + readFileSync(join(HERE, "dialysis.css"), "utf8") + readFileSync(join(HERE, "bio-scene.css"), "utf8") + extraCss;
  for (const light of [false, true]) {
    const html = k.pageHtml({ title, theme: light ? "light" : "dark", width: W + 40, body: `<style>${BIO_CSS}${CSS}</style>${framed}${controls}${sources}`, script });
    writeFileSync(join(ROOT, "prep/figures", id + (light ? "-light" : "") + ".html"), html);
    console.log("wrote prep/figures/" + id + (light ? "-light" : "") + ".html " + html.length);
  }
}
