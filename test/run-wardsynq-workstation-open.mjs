/* test/run-wardsynq-workstation-open.mjs - the order-safety workstation, in a real headless Chrome,
 * opens the hospital's record for a signed-in doctor and has safety checking available.
 *
 * Owner bug 2026-09-15 ("record service refused to open (401). Safety checking is unavailable, so
 * ordering is disabled."). A local server serves the real page and its modules from this checkout,
 * and GET/POST /api/wardsynq/* through the REAL route handler (functions/api/wardsynq/[[path]].js)
 * with a real minted staff session; only Firestore membership is stubbed. Two sign-ins are checked:
 * a staff session with a different Firebase account still remembered by the browser (the mixed state
 * that acted as the wrong person), and no session at all (the banner must stay).
 *
 *   node test/run-wardsynq-workstation-open.mjs
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./wardsynq-site-cdp.mjs";
import { handle } from "../functions/api/wardsynq/[[path]].js";
import { MemoryRepository } from "../functions/_wardsynq/repository.js";
import { makeMockDb } from "../functions/_connect/testkit.js";
import { mintStaffSession, verifyStaffSession } from "../functions/_opd_auth.js";
import { Patient } from "../wardsynq/wardsynq-model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.WSQ_WS_PORT || 8871);
const ENV = { WARDSYNQ_RECORD: "1", QUEUE_STAFF_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-for-staff-sessions-at-least-32-chars" };
const ORG = { id: "org-gimsr", name: "GIMSR", connectTenantId: "gimsr", mode: "wardsynq" };
const deps = {
  db: makeMockDb({ connect_tenant: [{ id: "gimsr", name: "GIMSR", status: "active", mode: "sandbox", settings: "{}" }], connect_membership: [] }),
  repository: new MemoryRepository(),
  identifyFn: async (request) => {
    const t = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    return /^fb-[a-z-]+$/.test(t) ? { id: "fb:" + t.slice(3), guest: false, email: t.slice(3) + "@x.test" } : { guest: true };
  },
  claimsFn: async () => ({}),
  staffSession: verifyStaffSession,
  orgForTenant: async (env, tenant) => (tenant.id === "gimsr" ? ORG : null),
  authorizeOrg: async (env, actor) => (actor.kind === "staff" && actor.orgId === ORG.id && actor.id === "dr.pin@gimsr.test" ? { ok: true, role: "doctor" } : { ok: false, reason: "not_a_member" }),
};
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith("/api/wardsynq/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handle(new Request(url.href, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : Buffer.concat(chunks) }), ENV, deps);
    res.writeHead(r.status, { "content-type": "application/json" }); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const file = join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" }); res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));

let pass = 0, fail = 0;
const ok = (c, name, extra) => { console.log(`  ${c ? "PASS" : "FAIL"} ${name}${extra ? " - " + extra : ""}`); c ? pass++ : fail++; };
const tok = await mintStaffSession(ENV, ORG.id, "dr.pin@gimsr.test", Date.now());
// One patient on the record, written through the real route as that doctor.
const w = await handle(new Request(`http://localhost:${PORT}/api/wardsynq/gimsr/record`, { method: "POST", headers: { "Content-Type": "application/json", "X-Staff-Token": tok }, body: JSON.stringify({ entity: Patient({ id: "pat-ws-1", mrn: "WS-1", name: "Test Patient", dob: "1970-01-01", sex: "female" }) }) }), ENV, deps);
if (w.status !== 201) { console.log("seed failed", w.status, await w.text()); process.exit(1); }

const PAGE = `http://localhost:${PORT}/wardsynq/ui/wardsynq.html?record=gimsr&site=1`;
const b = await launch({ port: Number(process.env.CDP_PORT || 9472) });
try {
  // The page defines SMD_AUTH itself; a remembered Firebase account is modelled by answering token() with
  // a bearer for somebody who is not a member of this hospital.
  await b.call("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(window, "SMD_AUTH", { configurable: true, get: function () { return { token: function () { return Promise.resolve("fb-somebody-else"); } }; }, set: function () {} });` });
  await b.nav(PAGE);
  await b.ev(`localStorage.setItem("smd_opd_toktype", "staff"); localStorage.setItem("smd_opd_staff_tok", ${JSON.stringify(tok)}); return 1`);
  await b.nav(PAGE);
  const actor = await b.until(`return window.WARDSYNQ && window.WARDSYNQ.actor && window.WARDSYNQ.actor.id`, 20000);
  ok(actor === "dr.pin@gimsr.test", "staff session opens the record as the signed-in doctor, not the remembered account", actor);
  const pack = await b.ev(`return document.getElementById("pack").textContent`);
  ok(!/refused|unavailable/i.test(pack) && /interaction rules loaded/.test(pack), "safety rules loaded, no refusal banner", pack);
  ok(await b.ev(`return document.getElementById("drug").disabled === false`) === true, "medication field enabled: ordering with safety checking is available");
  ok(!!(await b.until(`return document.getElementById("identity").textContent.indexOf("Test Patient") >= 0 ? "y" : ""`, 8000)), "the record's patient is on screen");

  await b.ev(`localStorage.removeItem("smd_opd_toktype"); localStorage.removeItem("smd_opd_staff_tok"); return 1`);
  await b.call("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(window, "SMD_AUTH", { configurable: true, get: function () { return { token: function () { return Promise.resolve(null); } }; }, set: function () {} });` });
  await b.nav(PAGE);
  const banner = await b.until(`var p=document.getElementById("pack"); return p && /\\(401\\)/.test(p.textContent) ? p.textContent : ""`, 15000);
  ok(!!banner, "no session: the genuine 401 is still reported", banner);
  ok(await b.ev(`return document.getElementById("drug").disabled === true`) === true, "no session: ordering stays disabled");
  if (b.consoleLines.length) console.log("  console:", b.consoleLines.slice(0, 5).join(" | "));
} finally { b.close(); server.close(); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
