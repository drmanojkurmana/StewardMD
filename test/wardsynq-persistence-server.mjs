/* test/wardsynq-persistence-server.mjs — a REAL local WardSynQ server, for proving persistence
 * across a reload and a second browser session: the SAME org/auth test scaffolding
 * wardsynq-inpatient-emar.test.mjs already uses (Firestore mocked the same way; that is
 * membership/org lookup, not the clinical record), but the WardSynQ record itself is a REAL
 * D1Repository over a REAL on-disk SQLite file (functions/_wardsynq/repository-sqlite.js,
 * functions/_wardsynq/repository-d1.js) instead of the in-memory test double. It serves the real
 * onRequest() from functions/api/queue/[[path]].js, plus ward.js/ward.css/discharge.js/
 * patient-register.js as static files from the SAME origin, so a real browser's relative
 * fetch("/api/queue/...") reaches it.
 *
 * NOT a Cloudflare Pages deployment and does not claim to be one: no live URL, no production
 * credentials, no production data. Two things it genuinely proves that the CDP harnesses (which
 * stub the network) cannot: (1) data survives a full process restart against the same sqlite
 * file, and (2) two independent browser sessions issuing independent HTTP requests see the SAME
 * server-side state, because there is only one - exactly what "two devices" means functionally.
 *
 * Usage: node test/wardsynq-persistence-server.mjs <port> <sqlite-file-path>
 * Prints "LISTENING <port>" on stdout once ready.
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { mock } from "node:test";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const PORT = Number(process.argv[2]) || 8799;
const DB_PATH = process.argv[3] || join(process.env.CLAUDE_JOB_DIR || "/tmp", "wardsynq-persistence.sqlite");

// ---- the SAME Firestore double the route tests use (org/membership only, not the clinical record) ----
const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) continue;
        const cur = docs.get(w.update.name), cd = w.currentDocument;
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" });
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields, opts) => {
      const w = { update: { name: path, fields } };
      if (opts && opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
      else if (opts && opts.exists === true) w.currentDocument = { exists: true };
      return w;
    },
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");

// ---- the ONE real difference from the test suite: a real, on-disk D1Repository -----------------
const { DatabaseSync } = await import("node:sqlite");
const { openSqlite } = await import("../functions/_wardsynq/repository-sqlite.js");
const { D1Repository } = await import("../functions/_wardsynq/repository-d1.js");
const readSchema = (name) => readFileSync(
  new URL(name === "connect" ? "../db/connect_schema.sql" : "../functions/db/wardsynq_schema.sql", import.meta.url), "utf8");
const wasNew = !existsSync(DB_PATH);
const { binding } = openSqlite({ DatabaseSync, readSchema }, { path: DB_PATH });
const RECORD = new D1Repository(binding);
console.error(`[persistence-server] sqlite file: ${DB_PATH} (${wasNew ? "new" : "REUSED - existing data will still be there"})`);

const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT_ROW.id ? { ...TENANT_ROW } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({
      db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg,
      claimsFn: async (request) => {
        const who = String(request.headers.get("Cf-Access-Authenticated-User-Email") || "").toLowerCase();
        return who === "doctor@example.test" ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {};
      },
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", LABTECH = "lab@example.test", PHARM = "pharmacy@example.test";
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
};

// A fresh org + staff roster EVERY time this script starts, so a restart proves the CLINICAL
// record (the sqlite file) survived even though the org/membership scaffolding was rebuilt.
docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [LABTECH, "lab"], [PHARM, "pharmacy"]]) {
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
}
console.error(`[persistence-server] org ${ORG}: doctor=${DOCTOR} nurse=${NURSE} lab=${LABTECH} pharmacy=${PHARM}`);

// ---- static files, same origin as /api/queue, so ward.js's relative fetch("/api/queue/...") works ----
const STATIC = ["ward.js", "ward.css", "discharge.js", "patient-register.js", "patient-register.css"];
const MIME = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<!doctype html><meta charset="utf-8"><title>wsq</title><link rel="stylesheet" href="/ward.css">' +
        '<body><script>localStorage.setItem("smd_opd_staff_tok","");</script>' +
        '<script src="/patient-register.js"></script><script src="/ward.js"></script>' +
        '<script src="/discharge.js"></script><script>window.__ready = !!(window.WARD && window.WARD.open);</script>');
      return;
    }
    const staticName = url.pathname.replace(/^\//, "");
    if (STATIC.includes(staticName)) {
      res.writeHead(200, { "content-type": MIME[extname(staticName)] || "text/plain" });
      res.end(readFileSync(join(ROOT, staticName)));
      return;
    }
    if (url.pathname.startsWith("/api/queue")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const request = new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers, body: (req.method === "GET" || req.method === "HEAD") ? undefined : body });
      const out = await onRequest({ request, env: ENV });
      const outHeaders = {}; out.headers.forEach((v, k) => { outHeaders[k] = v; });
      res.writeHead(out.status, outHeaders);
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    res.writeHead(404); res.end("not found");
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" }); res.end("server error: " + (e && e.stack || e));
  }
});
server.listen(PORT, () => { console.log(`LISTENING ${PORT}`); });
process.on("SIGTERM", () => process.exit(0));
