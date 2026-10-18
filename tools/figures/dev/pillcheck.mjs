/* Report overlapping label pills (and pills over gauge/title text) on figure pages.
 *   node tools/figures/dev/pillcheck.mjs <page-id>... ; tries levels 0..2 and treatments 0..2 */
import { launch, serve } from "./pw.mjs";
const ids = process.argv.slice(2);
const { srv, port } = serve(), b = await launch();
const p = await (await b.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
for (const id of ids) {
  const found = new Set();
  for (const l of [0, 1, 2]) for (const d of [0, 1, 2]) {
    await p.goto(`http://localhost:${port}/prep/figures/${id}.html?d=${d}&l=${l}`); await p.waitForTimeout(700);
    const r = await p.evaluate(() => {
      const pills = [...document.querySelectorAll(".p-pill")].filter((e) => e.getBoundingClientRect().width && getComputedStyle(e).display !== "none" && getComputedStyle(e).opacity !== "0")
        .map((e) => ({ t: e.textContent.trim(), r: e.getBoundingClientRect() }));
      const out = [];
      for (let i = 0; i < pills.length; i++) for (let j = i + 1; j < pills.length; j++) {
        const a = pills[i].r, c = pills[j].r;
        if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) out.push(pills[i].t + " x " + pills[j].t);
      }
      return out;
    });
    r.forEach((x) => found.add(x));
  }
  console.log(id, found.size ? "OVERLAP: " + [...found].join(" | ") : "ok");
}
await b.close(); srv.close();
