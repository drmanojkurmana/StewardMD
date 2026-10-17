/* Open every registered figure in the viewer at 390 px width, dark and light, and flag pages that do not zoom, overflow sideways,
 * have no readout, are too short, or throw. Prints "checked N bad M".   node tools/figures/dev/sweep.mjs */
import fs from "node:fs";
import { ROOT, launch, serve } from "./pw.mjs";
const { srv, port } = serve();
const ids = JSON.parse(fs.readFileSync(ROOT + "/prep/figures/figures.json", "utf8")).figures.map((f) => f.id);
const b = await launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
let bad = 0;
for (const dark of [true, false]) for (const id of ids) {
  const p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`http://localhost:${port}/host`);
  await p.evaluate(([id, dark]) => { if (!dark) document.body.classList.remove("dark"); return SMD_FIG.ready().then(() => SMD_FIG.open({ src: "prep/figures/" + id + ".html", title: id })); }, [id, dark]);
  await p.waitForTimeout(700);
  const fr = p.frames().find((f) => f.url().includes("/" + id + (dark ? ".html" : "-light.html")));
  const r = fr ? await fr.evaluate(() => ({ z: !!window.__smdZoom, ow: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, ro: (document.querySelector("[data-readout]") || {}).textContent, h: (document.querySelector(".smdz-st") || { clientHeight: 0 }).clientHeight, ctl: !!document.getElementById("drug") || !!document.querySelector("select,input[type=range]") })) : null;
  if (!r || !r.z || r.ow > r.cw || !r.ro || r.h < 150 || errs.length) { bad++; console.log("BAD", dark ? "dark" : "light", id, JSON.stringify(r), errs.join("|")); }
  await p.close();
}
console.log("checked", ids.length * 2, "bad", bad);
await b.close(); srv.close();
