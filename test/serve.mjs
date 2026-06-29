/* Minimal static file server for the test harness (dev-only).
 * Serves the repo root so headless Chrome can load the real app.
 *   node test/serve.mjs [repoRoot] [port]
 */
import http from "node:http";
import { readFile } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[3] || 8799);
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const fp = join(root, normalize(p).replace(/^(\.\.[/\\])+/, ""));
  readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    // no-store so the test harness always sees the current working tree (defeats Chrome's cache)
    res.writeHead(200, { "content-type": TYPES[extname(fp)] || "application/octet-stream", "cache-control": "no-store, must-revalidate" });
    res.end(data);
  });
}).listen(port, () => console.log(`[serve] ${root} on http://localhost:${port}`));
