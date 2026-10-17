/* Screenshot one figure page at desktop size, two frames 0.8 s apart, and print console errors.
 *   node tools/figures/dev/shot.mjs <page-id> ["?d=3&l=2"] [tag]   -> OUT/<tag>1.png, <tag>2.png   (OUT defaults to /tmp/figshots)
 * Use "<id>-light" for the light page. d = treatment index, l = level index. */
import fs from "node:fs";
import { launch, serve } from "./pw.mjs";
const [id, qs = "", tag = "a"] = process.argv.slice(2), OUT = process.env.OUT || "/tmp/figshots";
fs.mkdirSync(OUT, { recursive: true });
const { srv, port } = serve(), b = await launch();
const p = await (await b.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1.4 })).newPage();
p.on("pageerror", (e) => console.log("ERR", e.message)); p.on("console", (m) => { if (m.type() === "error") console.log("CON", m.text()); });
await p.goto(`http://localhost:${port}/prep/figures/${id}.html${qs}`); await p.waitForTimeout(2500);
const clip = { x: 0, y: 60, width: 1000, height: 720 };
await p.screenshot({ path: `${OUT}/${tag}1.png`, clip }); await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}/${tag}2.png`, clip });
console.log("wrote", `${OUT}/${tag}1.png`, `${OUT}/${tag}2.png`);
await b.close(); srv.close();
