/* test/seed-signoff.test.mjs - D10: clinical seed data carries a per-item sign-off by Dr Manoj Kurmana.
 *
 * Routes: GET /api/queue/seed/status, POST /api/queue/seed/signoff.
 * Pinned: every item starts UNAPPROVED (nothing is marked signed by this build); the status read needs the
 * platform owner or a hospital's staff.admin; sign-off is the platform owner's alone (a hospital owner and a
 * hospital admin are refused), in the named signatory's name only, for the exact content shown, with an
 * attestation; the record and its audit row are one commit; a failed write records nothing; changed content
 * is unapproved again; and the Admin screen marks unsigned items UNAPPROVED and says so when it cannot load.
 *
 * node --test --experimental-test-module-mocks test/seed-signoff.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as H from "./helpers/opd-router-harness.mjs";
const { api, docs } = H;
const S = await import("../functions/_wardsynq/seed-signoff.js");

const records = () => [...docs.keys()].filter((k) => k.startsWith("q_seed_signoffs/"));
const events = () => [...docs.values()].map((d) => d.fields).filter((f) => f.action === "seed:signoff");
async function firstItem() {
  const r = await api("/seed/status", "GET", null, H.PLATFORM);
  const l = r.lists.find((x) => x.id === "dose-ceilings");
  return { list: l, item: l.items[0] };
}

test("pure: every seed list is present, every item has a fingerprint, and nothing is signed until a record exists for its current content", async () => {
  const lists = await S.seedStatus([]);
  assert.deepEqual(lists.map((l) => l.id), ["allergy-classes", "allergy-cross-reactivity", "dose-ceilings", "critical-limits", "critical-thresholds", "pews-bands", "meows-bands", "news2-escalation", "quality-measures"]);
  for (const l of lists) {
    assert.ok(l.items.length > 0, l.id + " has items");
    for (const it of l.items) { assert.equal(it.status, "unapproved"); assert.match(it.contentHash, /^[0-9a-f]{64}$/); }
  }
  assert.ok(lists.find((l) => l.id === "critical-limits").items.some((i) => i.id === "2823-3" && i.label === "Potassium"));
  // A record for OTHER content does not sign the item: a changed item is unapproved again.
  const it = lists[2].items[0];
  const stale = { id: S.signoffId("dose-ceilings", it.id, "0".repeat(64)), text: "old" };
  assert.equal((await S.seedStatus([stale]))[2].items[0].status, "unapproved");
  const good = { id: S.signoffId("dose-ceilings", it.id, it.contentHash), text: "Signed off by Dr Manoj Kurmana", signedBy: S.SIGNATORY, signedAt: "2026-09-14T00:00:00Z", version: it.version };
  assert.equal((await S.seedStatus([good]))[2].items[0].status, "signed");
  // Function bodies are part of the fingerprint (MEOWS bands and quality measures are functions).
  assert.notEqual(await S.fingerprint({ red: (v) => v < 10 }), await S.fingerprint({ red: (v) => v < 11 }));
});

test("GET /api/queue/seed/status: 401 without a session; a nurse and another hospital's admin refused; a hospital admin reads (cannot sign); the platform owner reads (can sign)", async () => {
  H.seed();
  assert.equal((await api("/seed/status?orgId=org-a")).__status, 401);
  assert.equal((await api("/seed/status?orgId=org-a", "GET", null, H.NURSE_A)).__status, 403);
  const other = await api("/seed/status?orgId=org-a", "GET", null, H.HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  const admin = await api("/seed/status?orgId=org-a", "GET", null, H.HR_A);
  assert.equal(admin.__status, 200, JSON.stringify(admin));
  assert.equal(admin.canSign, false);
  assert.equal(admin.signatory, "Dr Manoj Kurmana");
  assert.ok(admin.lists.every((l) => l.signed === 0), "this build marks nothing signed");
  assert.equal((await api("/seed/status", "GET", null, H.PLATFORM)).canSign, true);
});

test("POST /api/queue/seed/signoff: 401; hospital owner, hospital admin and a staff session refused 403; wrong name, no attestation or other content refused; nothing written", async () => {
  H.seed();
  const { list, item } = await firstItem();
  const body = { listId: list.id, itemId: item.id, contentHash: item.contentHash, signatory: "Dr Manoj Kurmana", attest: true };
  assert.equal((await api("/seed/signoff", "POST", body)).__status, 401);
  for (const who of [H.OWNER_A, H.HR_A]) {
    const r = await api("/seed/signoff", "POST", body, who);
    assert.equal(r.__status, 403, who); assert.equal(r.error, "platform_owner_only");
  }
  const staff = await H.staffToken("org-a", "admin1", "admin");
  assert.equal((await api("/seed/signoff", "POST", body, staff)).__status, 403);
  const wrong = await api("/seed/signoff", "POST", { ...body, signatory: "Dr Someone Else" }, H.PLATFORM);
  assert.equal(wrong.__status, 422); assert.match(wrong.message, /signed off by Dr Manoj Kurmana/);
  assert.equal((await api("/seed/signoff", "POST", { ...body, attest: false }, H.PLATFORM)).__status, 422);
  const changed = await api("/seed/signoff", "POST", { ...body, contentHash: "f".repeat(64) }, H.PLATFORM);
  assert.equal(changed.__status, 409); assert.equal(changed.error, "content_changed");
  assert.equal((await api("/seed/signoff", "POST", { ...body, itemId: "no-such" }, H.PLATFORM)).__status, 404);
  assert.deepEqual(records(), []);
  assert.equal(events().length, 0);
});

test("the platform owner signs one item: the record says who, when and which version, it is audited in the same commit, only that item turns signed, and it cannot be signed twice", async () => {
  H.seed();
  const { list, item } = await firstItem();
  const body = { listId: list.id, itemId: item.id, contentHash: item.contentHash, signatory: " Dr Manoj Kurmana ", attest: true };
  const r = await api("/seed/signoff", "POST", body, H.PLATFORM);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.match(r.signoff.text, /^Signed off by Dr Manoj Kurmana, \d{4}-\d{2}-\d{2}, version code#[0-9a-f]{12}$/);
  assert.equal(r.signoff.signedByAccount, H.uidFor(H.PLATFORM));
  assert.equal(records().length, 1);
  assert.equal(events().length, 1);
  const after = await api("/seed/status?orgId=org-a", "GET", null, H.HR_A);
  const l = after.lists.find((x) => x.id === list.id);
  assert.equal(l.items[0].status, "signed");
  assert.equal(l.items[0].signoff.signedBy, "Dr Manoj Kurmana");
  assert.equal(l.signed, 1);
  assert.equal(after.lists.reduce((n, x) => n + x.signed, 0), 1, "no other item was touched");
  const twice = await api("/seed/signoff", "POST", body, H.PLATFORM);
  assert.equal(twice.__status, 409); assert.equal(twice.error, "already_signed");
  assert.equal(events().length, 1);
});

test("a sign-off whose commit fails reports failure and records nothing", async () => {
  H.seed();
  const { list, item } = await firstItem();
  H.fail.commits = true;
  const r = await api("/seed/signoff", "POST", { listId: list.id, itemId: item.id, contentHash: item.contentHash, signatory: "Dr Manoj Kurmana", attest: true }, H.PLATFORM);
  const st = await api("/seed/status", "GET", null, H.PLATFORM);
  H.fail.commits = false;
  assert.equal(r.__status, 503); assert.match(r.message, /Nothing was recorded/);
  assert.deepEqual(records(), []);
  assert.equal(st.lists.find((x) => x.id === list.id).items[0].status, "unapproved");
});

test("screens: Admin > Clinical seed data marks unsigned items UNAPPROVED, shows the sign-off text for signed ones, offers sign-off only when the server says so, and a failed load says treat all as unapproved", async () => {
  const sb = { window: { WSQ: { page() {} } } };
  sb.WSQ = sb.window.WSQ;
  new Function("window", readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"))(sb.window);
  const html = sb.window.WSQ._seedHtml;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const c = { esc };
  const lists = await S.seedStatus([]);
  const it = lists[0].items[0];
  lists[0].items[0] = { ...it, status: "signed", signoff: { text: "Signed off by Dr Manoj Kurmana, 2026-09-14, version " + it.version } };
  lists[0].signed = 1; lists[0].unapproved -= 1;
  const admin = html(c, { signatory: S.SIGNATORY, canSign: false, lists });
  assert.match(admin, /<span class="pill stop">UNAPPROVED<\/span>/);
  assert.match(admin, /Signed off by Dr Manoj Kurmana, 2026-09-14, version/);
  assert.doesNotMatch(admin, /data-seed-sign/, "a hospital admin is not offered sign-off");
  const owner = html(c, { signatory: S.SIGNATORY, canSign: true, lists });
  assert.ok((owner.match(/data-seed-sign=/g) || []).length === lists.reduce((n, l) => n + l.unapproved, 0), "one Sign off button per unapproved item, none on a signed one");
  assert.match(html(c, { failed: true, message: "forbidden" }), /could not be loaded: forbidden\. Treat every item as UNAPPROVED/);
  assert.match(html(c, undefined), /Loading/);
  assert.doesNotMatch(owner, /[—–]/, "no em or en dash");
  assert.match(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"), /c\.api\("\/seed\/signoff"/);
});
