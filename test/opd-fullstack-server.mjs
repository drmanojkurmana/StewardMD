/* test/opd-fullstack-server.mjs - the OPD console against the REAL queue router, on one local port.
 *
 * Static files from the repo root (opd.html, opd-display.html and every script they load) and /api/queue/*
 * answered by the real onRequest of functions/api/queue/[[path]].js, on the in-memory Firestore + MemoryRepository
 * of test/_wardsynq-alert-harness.mjs (imported first: it registers the module mocks). Streaming responses
 * (GET /api/queue/live, text/event-stream) are piped chunk by chunk, never buffered.
 *
 * Seeded: the harness hospital (wardsynq mode, record-on) + a department, two staffed rooms (so walk-ins wait in
 * the pool), billing on, WhatsApp "custom" provider posting to a 2factor.in URL the harness fetch stub captures.
 *
 *   node --experimental-test-module-mocks test/opd-fullstack-server.mjs [port]     # serve until killed
 *   import { start } from "./opd-fullstack-server.mjs"                             # in-process (the e2e runner)
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const H = await import("./_wardsynq-alert-harness.mjs");
export { H };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };

export const DOCTOR2 = "doctor2@example.test";
export const WA_URL = "https://2factor.in/API/R1/wa-custom-test";

/** Seeds the hospital through the real admin routes. Returns ids the runner uses. */
export async function seed() {
  const { seedHospital, as, docs, ENV, ORG, ADMIN, DOCTOR, sanitize, idFor } = H;
  Object.assign(ENV, {
    CLINIC_BILLING_ENABLED: "1",
    FOLLOWCARE_WA_PROVIDER: "custom", FOLLOWCARE_WA_URL: WA_URL,
    FOLLOWCARE_WA_BODY: JSON.stringify({ to: "{{to}}", text: "{{text}}" }),
    FOLLOWCARE_WA_HEADERS: JSON.stringify({ "Content-Type": "application/json" }),
    QUEUE_LINK_BASE: "http://localhost",
  });
  seedHospital();
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(DOCTOR2))}`, { fields: { orgId: ORG, identity: idFor(DOCTOR2), role: "doctor", active: true, displayName: "Dr Second" }, updateTime: "t1" });
  const must = (r, what) => { if (r.__status !== 200 || r.ok === false) throw new Error(what + " failed " + JSON.stringify(r)); return r; };
  const dept = must(await as(ADMIN, "/dept", "POST", { orgId: ORG, name: "General Medicine", code: "GM" }), "dept").department;
  const r1 = must(await as(ADMIN, "/room", "POST", { orgId: ORG, name: "Room 1", number: "1", departmentId: dept.id, assignment: { mode: "primary", primary: idFor(DOCTOR), doctorName: "Dr Test" } }), "room 1").room;
  const r2 = must(await as(ADMIN, "/room", "POST", { orgId: ORG, name: "Room 2", number: "2", departmentId: dept.id, assignment: { mode: "primary", primary: idFor(DOCTOR2), doctorName: "Dr Second" } }), "room 2").room;
  must(await as(ADMIN, "/bill/tariff", "POST", { orgId: ORG, code: "CONS-" + idFor(DOCTOR), name: "Consultation Dr Test", kind: "consultation", price: 50000, doctorId: idFor(DOCTOR) }), "tariff");
  return { dept, rooms: [r1, r2] };
}

async function toRequest(req, port) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  const body = chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
  return new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers, body });
}

export const log = [];   // every request: { path, status }
export function start(port) {
  const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split("?")[0]);
    try {
      if (path.startsWith("/api/queue/") || path === "/api/queue") {
        const request = await toRequest(req, port);
        const pending = [];
        const r = await H.queue({ request, env: H.ENV, params: { path: path.replace(/^\/api\/queue\/?/, "").split("/") }, waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) });
        const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
        res.writeHead(r.status, h);
        log.push({ path, status: r.status });
        if (!r.body) { res.end(); return; }
        const reader = r.body.getReader();
        req.on("close", () => { try { reader.cancel(); } catch {} });
        res.on("close", () => { try { reader.cancel(); } catch {} });
        for (;;) {
          const { done, value } = await reader.read().catch(() => ({ done: true }));
          if (done) break;
          res.write(Buffer.from(value));   // SSE frames leave as they are made
        }
        res.end();
        return;
      }
      if (path.startsWith("/api/")) { log.push({ path, status: 404 }); res.writeHead(404, { "Content-Type": "application/json" }); res.end('{"ok":false,"error":"not_in_harness"}'); return; }
      let p = path === "/" ? "/index.html" : path;
      let fp = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ""));
      let data;
      try { data = await readFile(fp); } catch { if (!extname(p)) { fp += ".html"; data = await readFile(fp); } else throw new Error("404"); }
      log.push({ path, status: 200 });
      res.writeHead(200, { "Content-Type": TYPES[extname(fp)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    } catch (e) {
      log.push({ path, status: e && e.message === "404" || (e && e.code === "ENOENT") ? 404 : 500, err: String(e && e.stack || e) });
      if (!res.headersSent) res.writeHead(e && (e.message === "404" || e.code === "ENOENT") ? 404 : 500);
      res.end();
    }
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] || 8931);
  const ids = await seed();
  await start(port);
  const tok = await H.staffToken(H.ORG, H.idFor(H.ADMIN));
  console.log(JSON.stringify({ url: `http://localhost:${port}/opd.html`, orgId: H.ORG, staffToken: tok, rooms: ids.rooms.map((r) => r.id) }, null, 1));
}
