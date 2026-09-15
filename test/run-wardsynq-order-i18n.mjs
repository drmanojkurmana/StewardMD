/* test/run-wardsynq-order-i18n.mjs - the Order workstation's staff-language conversion (ui-i18n-site,
 * owner decision 2026-09-15), in a real headless Chrome.
 *
 * Modelled on test/run-wardsynq-workstation-open.mjs: a local server serves the real page and its
 * modules from this checkout, and GET/POST /api/wardsynq/* through the REAL route handler with a real
 * minted staff session; only Firestore membership is stubbed. The server ALSO answers
 * /wardsynq/site/i18n/te.js with a FAKE catalog built from every T()/TS() key this repo's staff
 * sources extract (test/wsq-site-i18n-harness.mjs), each mapped to "⟦English⟧" - so a translated
 * string is visibly marked and an untranslated one is not, without touching the real Telugu file.
 *
 * Cannot use loadSite() (test/wsq-site-i18n-harness.mjs): that is the site-shell fake DOM, and this
 * page is not shell-hosted.
 *
 *   node test/run-wardsynq-order-i18n.mjs
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./wardsynq-site-cdp.mjs";
import { extractKeys, fakeCatalog } from "./wsq-site-i18n-harness.mjs";
import { handle } from "../functions/api/wardsynq/[[path]].js";
import { MemoryRepository } from "../functions/_wardsynq/repository.js";
import { makeMockDb } from "../functions/_connect/testkit.js";
import { mintStaffSession, verifyStaffSession } from "../functions/_opd_auth.js";
import { Patient } from "../wardsynq/wardsynq-model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.WSQ_ORDER_I18N_PORT || 8872);
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

// A fake "te" language file, registered exactly the way a real wardsynq/site/i18n/<code>.js does
// (window.WSQI18n.register), but its catalog is every key this repo's T()/TS() calls extract, each
// bracketed - so any of them showing up untranslated is caught, without depending on a translator's
// real (and separately owned) Telugu file ever having order.* entries.
const FAKE_TE_JS = `(function(){var c=${JSON.stringify(fakeCatalog(extractKeys()))};if(window.WSQI18n)window.WSQI18n.register("te","Fake",c,{reviewed:false});})();`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith("/api/wardsynq/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handle(new Request(url.href, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : Buffer.concat(chunks) }), ENV, deps);
    res.writeHead(r.status, { "content-type": "application/json" }); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  if (url.pathname === "/wardsynq/site/i18n/te.js") {
    res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }); res.end(FAKE_TE_JS); return;
  }
  const file = join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" }); res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));

let pass = 0, fail = 0;
const ok = (c, name, extra) => { console.log(`  ${c ? "PASS" : "FAIL"} ${name}${extra ? " - " + extra : ""}`); c ? pass++ : fail++; };
const tok = await mintStaffSession(ENV, ORG.id, "dr.pin@gimsr.test", Date.now());
const w = await handle(new Request(`http://localhost:${PORT}/api/wardsynq/gimsr/record`, { method: "POST", headers: { "Content-Type": "application/json", "X-Staff-Token": tok }, body: JSON.stringify({ entity: Patient({ id: "pat-ws-1", mrn: "WS-1", name: "Test Patient", dob: "1970-01-01", sex: "female" }) }) }), ENV, deps);
if (w.status !== 201) { console.log("seed failed", w.status, await w.text()); process.exit(1); }

const PAGE = `http://localhost:${PORT}/wardsynq/ui/wardsynq.html?record=gimsr&site=1`;
const b = await launch({ port: Number(process.env.CDP_PORT || 9473) });
try {
  // The Firebase account this browser remembers is not a member of this hospital; the staff session
  // (X-Staff-Token from localStorage) is what actually opens the record. Same shape as
  // run-wardsynq-workstation-open.mjs.
  await b.call("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(window, "SMD_AUTH", { configurable: true, get: function () { return { token: function () { return Promise.resolve("fb-somebody-else"); } }; }, set: function () {} });` });
  await b.nav(PAGE);
  await b.ev(`localStorage.setItem("smd_opd_toktype", "staff"); localStorage.setItem("smd_opd_staff_tok", ${JSON.stringify(tok)}); localStorage.setItem("wsqStaffNavLang", "te"); return 1`);
  await b.nav(PAGE);

  const actor = await b.until(`return window.WARDSYNQ && window.WARDSYNQ.actor && window.WARDSYNQ.actor.id`, 20000);
  ok(actor === "dr.pin@gimsr.test", "staff session opens the record with the staff language set", actor);
  await b.until(`return document.getElementById("identity").textContent.indexOf("Test Patient") >= 0 ? "y" : ""`, 8000);

  ok(await b.ev(`return document.documentElement.lang`) === "te", "document.documentElement.lang follows the staff language");

  const railOrder = await b.ev(`return document.querySelector('button[data-go="order"]').textContent`);
  ok(/^⟦Order⟧/.test(railOrder), "rail: Order button is translated (key hint kept)", railOrder);
  const railMeds = await b.ev(`return document.querySelector('button[data-go="meds"]').textContent`);
  ok(/^⟦Medications⟧/.test(railMeds), "rail: Medications button is translated", railMeds);
  const railResults = await b.ev(`return document.querySelector('button[data-go="results"]').textContent`);
  ok(/^⟦Results⟧/.test(railResults), "rail: Results button is translated", railResults);
  const railRecord = await b.ev(`return document.querySelector('button[data-go="ledger"]').textContent`);
  ok(/^⟦Record⟧/.test(railRecord), "rail: Record button is translated", railRecord);

  const orderHeading = await b.ev(`return document.querySelector("#orderSection h2").textContent`);
  ok(orderHeading === "⟦Order⟧", "Order section heading is translated", orderHeading);
  const ledgerHeading = await b.ev(`return document.querySelector("#ledgerSection h2").textContent`);
  ok(ledgerHeading === "⟦Record⟧", "Record section heading is translated", ledgerHeading);
  const resultsHeading = await b.ev(`return document.querySelector("#resultsSection h2").textContent`);
  ok(resultsHeading === "⟦Results⟧", "Results heading is translated", resultsHeading);

  const fieldLabels = await b.ev(`return Array.from(document.querySelectorAll("label.f span")).map(function (s) { return s.textContent; }).join("|")`);
  ok(fieldLabels === "⟦Medication⟧|⟦Dose⟧|⟦Unit⟧|⟦Route⟧", "field labels Medication/Dose/Unit/Route are translated", fieldLabels);

  const signBtn = await b.ev(`return document.getElementById("sign").textContent`);
  ok(signBtn === "⟦Sign order⟧", "Sign order button is translated", signBtn);
  const clearBtn = await b.ev(`return document.getElementById("clear").textContent`);
  ok(clearBtn === "⟦Clear⟧", "Clear button is translated", clearBtn);

  const nameHtml = await b.ev(`return document.querySelector("#identity .name").innerHTML`);
  ok(nameHtml.indexOf("Test Patient") >= 0 && nameHtml.indexOf("⟦") === -1, "patient name is shown verbatim, not inside a translated bracket", nameHtml);
  ok(/<span lang="en">Test Patient<\/span>/.test(nameHtml), "patient name sits inside a lang=\"en\" element", nameHtml);

  // No session: the 401 banner must stay in the staff language, with the English original underneath.
  await b.ev(`localStorage.removeItem("smd_opd_toktype"); localStorage.removeItem("smd_opd_staff_tok"); return 1`);
  await b.call("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(window, "SMD_AUTH", { configurable: true, get: function () { return { token: function () { return Promise.resolve(null); } }; }, set: function () {} });` });
  await b.nav(PAGE);
  const bannerHtml = await b.until(`var p=document.getElementById("pack"); return p && /\\(401\\)/.test(p.textContent) ? p.innerHTML : ""`, 15000);
  ok(!!bannerHtml, "no session: the genuine 401 is still reported", bannerHtml);
  ok(bannerHtml.indexOf("⟦") >= 0, "401 banner carries translated text", bannerHtml);
  ok(bannerHtml.indexOf('class="en-orig"') >= 0 && bannerHtml.indexOf('lang="en"') >= 0, "401 banner carries the English original underneath", bannerHtml);
  ok(await b.ev(`return document.documentElement.lang`) === "te", "document.documentElement.lang stays \"te\" even when the record refuses to open");

  // Language unset: plain English, no bracket artifacts, no en-orig anywhere.
  await b.ev(`localStorage.setItem("smd_opd_toktype", "staff"); localStorage.setItem("smd_opd_staff_tok", ${JSON.stringify(tok)}); localStorage.removeItem("wsqStaffNavLang"); return 1`);
  await b.nav(PAGE);
  await b.until(`return document.getElementById("identity").textContent.indexOf("Test Patient") >= 0 ? "y" : ""`, 8000);
  ok(await b.ev(`return document.documentElement.lang`) === "en", "document.documentElement.lang is \"en\" when no staff language is set");
  const bodyText = await b.ev(`return document.body.textContent`);
  ok(bodyText.indexOf("⟦") === -1, "no bracket artifacts anywhere on the page in English");
  const bodyHtml = await b.ev(`return document.body.innerHTML`);
  ok(bodyHtml.indexOf("en-orig") === -1, "no en-orig spans anywhere on the page in English");
  const railOrderEn = await b.ev(`return document.querySelector('button[data-go="order"]').textContent`);
  ok(/^Order\s/.test(railOrderEn), "rail: Order button reads plain English", railOrderEn);
  const signBtnEn = await b.ev(`return document.getElementById("sign").textContent`);
  ok(signBtnEn === "Sign order", "Sign order button reads plain English", signBtnEn);

  if (b.consoleLines.length) console.log("  console:", b.consoleLines.slice(0, 5).join(" | "));
} finally { b.close(); server.close(); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
