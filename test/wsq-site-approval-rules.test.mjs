/* Admin approval rules: what is saved is exactly what the server's levelsFor/policyFor read. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { levelsFor } from "../functions/_wardsynq/verification.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const sb = { window: { WSQ: { page() {} } } };
sb.WSQ = sb.window.WSQ;
vm.createContext(sb); vm.runInContext(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"), sb);
const A = sb.window.WSQ._approvalRules;

/* A minimal row stand-in: the reader only uses getAttribute, querySelector(value) and querySelectorAll(checked). */
function row(kind, { levels = "1", roles = [], expires = "", above = "", aboveLevels = "" } = {}) {
  const vals = { ".apLevels": levels, ".apExpires": expires, ".apAbove": above, ".apAboveLevels": aboveLevels };
  return {
    getAttribute: () => kind,
    querySelector: (s) => ({ value: vals[s] }),
    querySelectorAll: () => ["admin", "doctor", "pg_faculty", "pg_hod"].map((r) => ({ value: r, checked: roles.includes(r) })),
  };
}

test("the screen shows the current rules and reads them back into the shape the server enforces", () => {
  const html = A.html(esc, { approvalLevels: { PurchaseOrder: 2 }, approvalPolicy: { PurchaseOrder: { approverRoles: ["admin"], expiresHours: 48, amountThresholds: [{ abovePaise: 5000000, levels: 3 }] } } });
  assert.match(html, /data-kind="PurchaseOrder"/);
  assert.match(html, /value="2"/);
  assert.match(html, /value="50000"/);
  const out = A.read([row("PurchaseOrder", { levels: "1", roles: ["admin"], expires: "48", above: "50000", aboveLevels: "2" })]);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { approvalLevels: { PurchaseOrder: 1 }, approvalPolicy: { PurchaseOrder: { approverRoles: ["admin"], expiresHours: 48, amountThresholds: [{ abovePaise: 5000000, levels: 2 }] } } });
  const cfg = { wsqCfg: out };
  assert.equal(levelsFor(cfg, "PurchaseOrder", 100), 1);
  assert.equal(levelsFor(cfg, "PurchaseOrder", 6000000), 2);
  assert.equal(levelsFor(cfg, "PurchaseOrder", undefined), 2, "unknown amount: the strictest");
});

test("laboratory result checking shows the saved setting", () => {
  const L = sb.window.WSQ._labCheck;
  assert.match(L.html(esc, { labVerification: { mode: "second-person" } }), /id="labSecond" checked/);
  assert.ok(!/id="labSecond" checked/.test(L.html(esc, {})));
});

test("half-filled or impossible rules are refused on screen, not saved", () => {
  assert.match(A.read([row("Invoice", { above: "100" })]).error, /both a rupee amount and a number/);
  assert.match(A.read([row("Invoice", { levels: "0" })]).error, /between 1 and 5/);
  assert.match(A.read([row("Invoice", { expires: "-3" })]).error, /above zero/);
});

test("OPD token numbering card: what is saved is exactly what the org model keeps", async () => {
  const { tokenConfig } = await import("../functions/_opd_org.js");
  const K = sb.window.WSQ._tokenCard;
  const depts = [{ id: "dcard", name: "Cardiology", code: "CAR", active: true }, { id: "dmed", name: "General Medicine", code: "GM", active: true }, { id: "dx", name: "Closed", active: false }];
  const html = K.html(esc, { scope: "department", prefixes: { cardiology: "C", ghost: "G" }, deptAliases: { "gen med": "dmed" } }, depts);
  assert.match(html, /value="department" selected/);
  assert.match(html, /data-tok-dept="dcard"[\s\S]*?value="C"/, "a legacy name-keyed prefix shows in its department's row");
  assert.match(html, /data-tok-dept="dmed"[\s\S]*?placeholder="GM"[\s\S]*?value="gen med"/, "the code is the default prefix; aliases shown");
  assert.doesNotMatch(html, /data-tok-dept="dx"/, "inactive departments are not offered");
  assert.match(html, /name no department: ghost = G/, "a stale saved prefix is visible, not silently dropped");
  assert.match(K.html(esc, undefined, depts), /value="hospital" selected/, "default is one sequence for the hospital");
  assert.match(K.html(esc, {}, undefined), /Loading departments/);
  assert.match(K.html(esc, {}, null), /could not be loaded[\s\S]*Do not read this as no departments/);
  const out = K.read("department", [{ departmentId: "dcard", prefix: "c", aka: "Heart OPD, cardio" }, { departmentId: "dmed", prefix: "", aka: "" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(out.tokens)), { scope: "department", prefixes: { dcard: "C" }, deptAliases: { "heart opd": "dcard", cardio: "dcard" } });
  assert.deepEqual(tokenConfig(out.tokens), { scope: "department", prefixes: { dcard: "C" }, deptAliases: { "heart opd": "dcard", cardio: "dcard" } });
  assert.match(K.read("department", [{ departmentId: "dcard", prefix: "TOOLONG" }]).error, /one to three letters/);
  assert.match(K.read("department", [{ departmentId: "dcard", aka: "OPD" }, { departmentId: "dmed", aka: "opd" }]).error, /two departments/);
  assert.doesNotMatch(html, /—/, "no em dash");
});
