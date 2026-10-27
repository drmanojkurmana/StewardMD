// Render pamphlets to PDF (print) and PNG (preview). Usage: node render.cjs [name ...]
// Needs a local static server on this folder, started by this script.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const DIR = __dirname, OUT = path.join(DIR, "out");
const PAGES = { colleges: "a4", clinicians: "a4", numbers: "a4", poster: "a3" };
const SIZE = { a4: { w: 210, h: 297 }, a3: { w: 297, h: 420 } };
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };
const srv = http.createServer((q, r) => {
  const f = path.join(DIR, decodeURIComponent(q.url.split("?")[0]));
  if (!f.startsWith(DIR) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
});
(async () => {
  await new Promise((res) => srv.listen(0, res));
  const base = "http://localhost:" + srv.address().port + "/";
  fs.mkdirSync(OUT, { recursive: true });
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PAGES);
  const b = await chromium.launch();
  for (const n of names) {
    const s = SIZE[PAGES[n]], px = (mm) => Math.round(mm / 25.4 * 96);
    const p = await b.newPage({ viewport: { width: px(s.w), height: px(s.h) }, deviceScaleFactor: 2 });
    await p.goto(base + n + ".html", { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts.ready);
    await p.pdf({ path: path.join(OUT, n + ".pdf"), width: s.w + "mm", height: s.h + "mm", printBackground: true, pageRanges: "1" });
    await p.screenshot({ path: path.join(OUT, n + ".png") });
    console.log("rendered", n);
    await p.close();
  }
  await b.close(); srv.close();
})();
