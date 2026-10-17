/* Shared helpers for the figure dev scripts: a tiny static server over the repo and a Playwright launcher.
 * Needs Playwright (npm i -D playwright, or a global install) and a Chromium. Set CHROME=/path/to/chrome to use a specific binary. */
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const req = createRequire(import.meta.url);
function loadPlaywright() {
  try { return req("playwright"); } catch (e) { /* not local */ }
  return req(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}
export const { chromium } = loadPlaywright();
export const launch = () => chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox"] });
export function serve() {
  const srv = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split("?")[0]);
    if (u === "/host") { r.setHeader("content-type", "text/html"); return r.end('<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body class="dark" style="background:#000"><script src="/fig-viewer.js"></script>'); }
    const f = path.join(ROOT, u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
    r.setHeader("content-type", f.endsWith(".html") ? "text/html" : f.endsWith(".js") ? "text/javascript" : "application/json");
    r.end(fs.readFileSync(f));
  }).listen(0);
  return { srv, port: srv.address().port };
}
