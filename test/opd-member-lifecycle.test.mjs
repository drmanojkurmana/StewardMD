/* Staff lifecycle against an in-memory Firestore double. The bug: every lifecycle write was an
 * upsert, so a mistyped staff ID on "Set PIN" created a working sign-in nobody chose to create.
 *
 * node --test --experimental-test-module-mocks test/opd-member-lifecycle.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const docs = new Map();
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d } } : null; },
    fsQuery: async (_e, coll, opts) => [...docs].filter(([p, f]) => p.startsWith(coll + "/") && (!opts?.where || String(f[opts.where.field]) === String(opts.where.value))).map(([p, f]) => ({ id: p.slice(coll.length + 1), fields: { ...f } })),
    fsCommit: async (_e, writes) => { for (const w of writes) docs.set(w.path, { ...(docs.get(w.path) || {}), ...w.fields }); return { ok: true }; },
    wCreate: (_e, path, fields) => ({ path, fields }),
    wUpdate: (_e, path, fields) => ({ path, fields }),
  },
});
mock.module("../functions/_opd_auth.js", { namedExports: { genSalt: () => "salt", hashSecret: async () => "hash" } });
const ORG = await import("../functions/_opd_org_store.js");

const members = () => [...docs.keys()].filter((k) => k.startsWith("q_members/"));
const audits = () => [...docs].filter(([k]) => k.startsWith("q_events/")).map(([, f]) => f.action);

test("a mistyped staff ID is refused by every lifecycle action and creates nothing", async () => {
  docs.clear();
  for (const call of [
    () => ORG.setMemberPin(undefined, "org1", "nurse-typo", "1234", "admin"),
    () => ORG.setMemberPassword(undefined, "org1", "nurse-typo", "n@x.in", "pw12345678", "admin"),
    () => ORG.setMemberActive(undefined, "org1", "nurse-typo", false, "admin"),
    () => ORG.setMemberActive(undefined, "org1", "nurse-typo", true, "admin"),
    () => ORG.resetMemberAccess(undefined, "org1", "nurse-typo", "admin"),
    () => ORG.removeMembership(undefined, "org1", "nurse-typo", "admin"),
  ]) {
    const r = await call();
    assert.equal(r.ok, false);
    assert.equal(r.error, "member_not_found");
    assert.match(r.message, /Add them first/);
  }
  assert.deepEqual(members(), [], "no member row may be created");
  assert.equal(await ORG.getMemberAuth(undefined, "org1", "nurse-typo"), null, "so there is no sign-in to use");
  assert.deepEqual(audits(), [], "nothing happened, so nothing is audited as if it had");
});

test("a real member is disabled (loses access), restored, reset, and each step is audited", async () => {
  docs.clear();
  const saved = await ORG.setMembership(undefined, "org1", "nurse1", { role: "nurse" }, "admin");
  assert.notEqual(saved.ok, false);
  assert.equal((await ORG.setMemberPin(undefined, "org1", "nurse1", "1234", "admin")).ok, true);

  assert.equal((await ORG.setMemberActive(undefined, "org1", "nurse1", false, "admin")).ok, true);
  assert.equal((await ORG.getMemberAuth(undefined, "org1", "nurse1")).active, false);
  assert.equal((await ORG.setMemberActive(undefined, "org1", "nurse1", true, "admin")).ok, true);
  assert.equal((await ORG.getMemberAuth(undefined, "org1", "nurse1")).active, true);

  assert.equal((await ORG.resetMemberAccess(undefined, "org1", "nurse1", "admin")).ok, true);
  assert.equal((await ORG.getMemberAuth(undefined, "org1", "nurse1")).pinHash, "", "reset clears the PIN");

  const a = audits();
  for (const act of ["member:set_pin", "member:disable", "member:restore", "member:reset_access"]) assert.ok(a.includes(act), act + " audited");
});

test("the route is admin-only and turns a refusal into a failure, not a success", () => {
  const src = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  const block = src.slice(src.indexOf('if (seg === "member") {'), src.indexOf('if (seg === "member") {') + 1400);
  assert.match(block, /azOrg\(CAPS\.STAFF_ADMIN\); if \(!az\.ok\) return deny\(az\)/);
  for (const sub of ["pin", "password", "disable", "restore", "reset"]) assert.match(block, new RegExp('sub === "' + sub + '"\\) return lifecycle\\('));
  assert.match(block, /r\.ok === false \? 404 : 200/);
  const admin = readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8");
  assert.match(admin, /if \(!MEMBER_ACTION_ROUTE\[act\]\) return;/);
});
