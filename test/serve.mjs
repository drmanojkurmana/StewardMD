/* Minimal static file server for the test harness (dev-only).
 * Serves the repo root so headless Chrome can load the real app.
 *   node test/serve.mjs [repoRoot] [port]
 */
import http from "node:http";
import { readFile, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[3] || 8799);
const TYPES = { ".gz": "application/gzip", ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".mp4": "video/mp4" };

import https from "node:https";

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.startsWith("/api/")) {
    const proxyReq = https.request(`https://wardsynq.com${req.url}`, {
      method: req.method,
      headers: { ...req.headers, host: "wardsynq.com" }
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (e) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "proxy_error", message: e.message }));
    });
    req.pipe(proxyReq);
    return;
  }
  if (p === "/") p = "/index.html";
  let fp = join(root, normalize(p).replace(/^(\.\.[/\\])+/, ""));
  // scripts/build-www.sh copies data/ payloads to the bundle ROOT, so the app asks for
  // "/offline-clinical.json.gz" and "/clinical-index.js". Serving the repo verbatim 404s them,
  // which silently turned off the offline clinical library in every UI test. Fall back to data/.
  if (!existsSync(fp) && extname(p) && existsSync(join(root, "data", p.replace(/^\//, "")))) {
    fp = join(root, "data", p.replace(/^\//, ""));
  }
  readFile(fp, (err, data) => {
    if (err && !extname(p)) {
      const htmlFp = fp + ".html";
      readFile(htmlFp, (err2, data2) => {
        if (err2) { res.writeHead(404); res.end("404"); return; }
        res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store, must-revalidate" });
        res.end(data2);
      });
      return;
    }
    if (err) { res.writeHead(404); res.end("404"); return; }
    // no-store so the test harness always sees the current working tree (defeats Chrome's cache). Fixture lesson media
    // under an api/ folder are served like the bank route serves them (immutable, one year), so offline tests see the
    // HTTP cache the app relies on.
    const immutable = /\/test\/fixtures\/[a-z0-9-]+\/api\/v\d+\/lessons\/media\//.test(fp.split("\\").join("/"));
    const ctype = TYPES[extname(fp)] || "application/octet-stream";
    const cc = immutable ? "public, max-age=31536000, immutable" : "no-store, must-revalidate";
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? Math.min(data.length - 1, parseInt(m[2], 10)) : data.length - 1;
        if (start <= end && start < data.length) {
          res.writeHead(206, {
            "content-type": ctype,
            "cache-control": cc,
            "accept-ranges": "bytes",
            "content-range": `bytes ${start}-${end}/${data.length}`,
            "content-length": end - start + 1
          });
          res.end(data.subarray(start, end + 1));
          return;
        }
      }
    }
    res.writeHead(200, { "content-type": ctype, "cache-control": cc, "accept-ranges": "bytes" });
    res.end(data);
  });
}).listen(port, () => console.log(`[serve] ${root} on http://localhost:${port}`));
