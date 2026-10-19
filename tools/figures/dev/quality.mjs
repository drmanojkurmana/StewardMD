/* Per scene quality metrics: how much the stage changes when the best treatment is on (pixel difference), label count, smallest label text.
 *   node tools/figures/dev/quality.mjs [id ...]  -> TSV: id, diff%, labels, organs(blob names), */
import { launch, serve } from "./pw.mjs";
import fs from "node:fs";
const reg = JSON.parse(fs.readFileSync(new URL("../../../prep/figures/figures.json", import.meta.url))).figures.filter((f) => f.scene);
const ids = process.argv.length > 2 ? process.argv.slice(2) : reg.map((f) => f.id);
const { srv, port } = serve(), b = await launch();
const ctx = await b.newContext({ viewport: { width: 1000, height: 800 } });
for (const id of ids) {
  const p = await ctx.newPage();
  try {
    await p.goto(`http://localhost:${port}/prep/figures/${id}.html?l=2&d=0`); await p.waitForTimeout(900);
    const n = await p.evaluate(() => document.getElementById("drug") ? document.getElementById("drug").options.length : 0);
    const labels = await p.evaluate(() => document.querySelectorAll(".p-pill").length);
    const shot = async () => (await p.locator(".dr-svg").first().screenshot()).toString("base64");
    const a = await shot();
    let best = 0;
    for (let d = 1; d < n; d++) {
      await p.evaluate((d) => { const s = document.getElementById("drug"); s.value = String(d); s.dispatchEvent(new Event("change", { bubbles: true })); }, d); await p.waitForTimeout(1100);
      const c = await shot();
      const diff = await p.evaluate(async ([x, y]) => {
        const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
        const [i1, i2] = await Promise.all([load(x), load(y)]); const w = Math.min(i1.width, i2.width), h = Math.min(i1.height, i2.height);
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const g = cv.getContext("2d", { willReadFrequently: true });
        g.drawImage(i1, 0, 0); const A = g.getImageData(0, 0, w, h).data; g.clearRect(0, 0, w, h); g.drawImage(i2, 0, 0); const B = g.getImageData(0, 0, w, h).data;
        let k = 0; for (let q = 0; q < A.length; q += 4) if (Math.abs(A[q] - B[q]) + Math.abs(A[q + 1] - B[q + 1]) + Math.abs(A[q + 2] - B[q + 2]) > 60) k++;
        return (100 * k) / (w * h);
      }, [a, c]);
      best = Math.max(best, diff);
    }
    console.log([id, best.toFixed(1), labels, n].join("\t"));
  } catch (e) { console.log([id, "ERR", String(e.message).split("\n")[0]].join("\t")); }
  await p.close();
}
await b.close(); srv.close();
