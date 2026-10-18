/* Verify figure pages: JavaScript errors, console errors, overlapping label pills, across levels and treatments.
 *   node tools/figures/dev/verify.mjs <page-id>...   -> one line per page ("ok" or the problems); exit code 1 if any page has errors
 * Overlap findings are advisory (printed as "warn"); script errors fail the page. */
import { launch, serve } from "./pw.mjs";
const ids = process.argv.slice(2);
const { srv, port } = serve(), b = await launch();
let bad = 0;
for (const id of ids) {
  const p = await (await b.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
  const errs = new Set(), warn = new Set();
  p.on("pageerror", (e) => errs.add(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.add("console: " + m.text()); });
  for (const l of [0, 1, 2]) for (const d of [0, 1, 2]) {
    try { await p.goto(`http://localhost:${port}/prep/figures/${id}.html?d=${d}&l=${l}`); } catch (e) { errs.add("load: " + String(e.message).split("\n")[0]); continue; }
    await p.waitForTimeout(450);
    const r = await p.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width && getComputedStyle(e).display !== "none" && getComputedStyle(e).opacity !== "0";
      const pills = [...document.querySelectorAll(".p-pill")].filter(vis).map((e) => ({ t: e.textContent.trim(), r: e.getBoundingClientRect() })).filter((x) => x.t), out = [];
      for (let i = 0; i < pills.length; i++) for (let j = i + 1; j < pills.length; j++) { const a = pills[i].r, c = pills[j].r; if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) out.push(pills[i].t + " x " + pills[j].t); }
      return out;
    });
    r.forEach((x) => warn.add(x));
  }
  const line = errs.size ? "ERROR " + [...errs].slice(0, 2).join(" | ") : warn.size ? "warn overlap: " + [...warn].slice(0, 3).join(" | ") : "ok";
  if (errs.size) bad++;
  console.log(id.padEnd(40), line);
  await p.context().close();
}
await b.close(); srv.close(); process.exit(bad ? 1 : 0);
