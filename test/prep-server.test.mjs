/* PrepNucleus server routes: the bank file route and student question reports.
 * Firebase auth, KV and R2 are in-memory. What must hold: only whitelisted, versioned bank paths are served, with
 * immutable caching (manifest short-lived) and nothing else readable from the bucket; a missing binding is a 503;
 * reports need sign-in, take only an id and a reason code, count once per user per item, stop at the daily cap,
 * and only owners can read the list.
 *
 * node --test --experimental-test-module-mocks test/prep-server.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const CLAIMS = { "tok-a": { sub: "u-a", email: "a@example.com", email_verified: true }, "tok-b": { sub: "u-b", email: "b@example.com", email_verified: true } };
const realAuth = await import("../functions/_fbauth.js");
const claimsOf = (req) => CLAIMS[(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")] || null;
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifiedClaimsFor: async (req) => claimsOf(req), identify: async (req) => { const c = claimsOf(req); return c ? "fb:" + c.sub : null; } } });

const bank = await import("../functions/api/prep/bank/[[path]].js");
const flag = await import("../functions/api/prep/flag.js");

function r2(files) {
  return { get: async (k) => (k in files ? { body: files[k], httpEtag: '"e1"' } : null) };
}
function kv() {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}
const get = (path, env) => bank.onRequestGet({ env, params: { path: path.split("/") } });

test("bank: serves a whitelisted module file from prep-bank/ with immutable caching", async () => {
  const env = { PREP_BANK_R2: r2({ "prep-bank/v1/anatomy/mcq/ana-gametogenesis.json": '{"topic":"ana-gametogenesis","items":[]}', "prep-bank/v1/manifest.json": "{}" }) };
  const r = await get("v1/anatomy/mcq/ana-gametogenesis.json", env);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("Cache-Control"), /immutable/);
  assert.equal(r.headers.get("ETag"), '"e1"');
  assert.deepEqual(JSON.parse(await r.text()), { topic: "ana-gametogenesis", items: [] });
  const m = await get("v1/manifest.json", env);
  assert.equal(m.status, 200);
  assert.doesNotMatch(m.headers.get("Cache-Control"), /immutable/);
});

test("bank: anything off the whitelist is 404 and never reaches the bucket", async () => {
  let asked = 0;
  const env = { PREP_BANK_R2: { get: async () => { asked++; return { body: "x" }; } } };
  for (const p of ["../ota/secret.json", "v1/anatomy/../../ota/x.json", "v1/Anatomy/index.json", "v1/anatomy/index.js", "v1/anatomy/mcq/a/b.json", "ota/manifest.json", "v1/anatomy/mcq/x.json.bak"]) {
    const r = await get(p, env);
    assert.equal(r.status, 404, p);
  }
  assert.equal(asked, 0);
  assert.equal((await get("v1/anatomy/mcq/missing-module.json", { PREP_BANK_R2: r2({}) })).status, 404);
});

test("bank: PYQ index (short cache), hashed items file and webp images (immutable, image/webp); nothing else under pyq/", async () => {
  const env = { PREP_BANK_R2: r2({ "prep-bank/v2/pyq/index.json": '{"v":1}', "prep-bank/v2/pyq/items-0a1b2c3d.json": '{"v":1,"items":[]}', "prep-bank/v2/pyq/img/neet-pg-2025-r1-1-1.webp": "RIFF" }) };
  const ix = await get("v2/pyq/index.json", env);
  assert.equal(ix.status, 200);
  assert.doesNotMatch(ix.headers.get("Cache-Control"), /immutable/);
  const it = await get("v2/pyq/items-0a1b2c3d.json", env);
  assert.equal(it.status, 200);
  assert.match(it.headers.get("Cache-Control"), /immutable/);
  assert.match(it.headers.get("Content-Type"), /json/);
  const im = await get("v2/pyq/img/neet-pg-2025-r1-1-1.webp", env);
  assert.equal(im.status, 200);
  assert.equal(im.headers.get("Content-Type"), "image/webp");
  assert.match(im.headers.get("Cache-Control"), /immutable/);
  let asked = 0;
  const spy = { PREP_BANK_R2: { get: async () => { asked++; return { body: "x" }; } } };
  for (const p of ["v2/pyq/items.json", "v2/pyq/items-0A1B2C3D.json", "v2/pyq/img/x.png", "v2/pyq/img/../index.json", "v2/pyq/source.pdf", "v2/pyq/img/a/b.webp", "v2/anatomy/x.webp", "v2/pyq/img/neet.webp.json"]) {
    assert.equal((await get(p, spy)).status, 404, p);
  }
  assert.equal(asked, 0);
});

test("bank: a bank item's images (v<n>/img/<name>.webp, immutable, image/webp); nothing else under img/", async () => {
  const env = { PREP_BANK_R2: r2({ "prep-bank/v5/img/ana-brachial-plexus-1.webp": "RIFF" }) };
  const im = await get("v5/img/ana-brachial-plexus-1.webp", env);
  assert.equal(im.status, 200);
  assert.equal(im.headers.get("Content-Type"), "image/webp");
  assert.match(im.headers.get("Cache-Control"), /immutable/);
  let asked = 0;
  const spy = { PREP_BANK_R2: { get: async () => { asked++; return { body: "x" }; } } };
  for (const p of ["v5/img/x.png", "v5/img/../manifest.json", "v5/img/a/b.webp", "v5/img/UPPER.webp", "v5/img/x.webp.json", "img/x.webp", "v5/anatomy/img/x.webp"]) assert.equal((await get(p, spy)).status, 404, p);
  assert.equal(asked, 0);
});

test("bank: radnotes figures and overlays (img/radnotes/rn-<id>.webp, overlay/radnotes/<subject>/<module>.json, immutable); nothing else", async () => {
  const env = { PREP_BANK_R2: r2({ "prep-bank/img/radnotes/rn-n1-p031-2.webp": "RIFF", "prep-bank/overlay/radnotes/radiology/rad-gi.json": '{"topic":"rad-gi","set":"radnotes","v":1,"items":[]}' }) };
  const im = await get("img/radnotes/rn-n1-p031-2.webp", env);
  assert.equal(im.status, 200);
  assert.equal(im.headers.get("Content-Type"), "image/webp");
  assert.match(im.headers.get("Cache-Control"), /immutable/);
  const ov = await get("overlay/radnotes/radiology/rad-gi.json", env);
  assert.equal(ov.status, 200);
  assert.match(ov.headers.get("Content-Type"), /application\/json/);
  assert.match(ov.headers.get("Cache-Control"), /immutable/);
  assert.equal(JSON.parse(await ov.text()).set, "radnotes");
  let asked = 0;
  const spy = { PREP_BANK_R2: { get: async () => { asked++; return { body: "x" }; } } };
  for (const p of ["img/radnotes/x.webp", "img/radnotes/rn-a.png", "img/radnotes/../rn-ab.webp", "img/radnotes/rn-AB.webp", "img/other/rn-ab.webp", "img/radnotes/a/rn-ab.webp",
    "overlay/radnotes/rad-gi.json", "overlay/radnotes/radiology/rad-gi.webp", "overlay/radnotes/radiology/../x.json", "overlay/other/radiology/rad-gi.json", "overlay/radnotes/radiology/a/b.json", "overlay/radnotes/Radiology/rad-gi.json"]) assert.equal((await get(p, spy)).status, 404, p);
  assert.equal(asked, 0);
});

test("bank: medcov overlays (overlay/medcov/<subject>/<module>.json, immutable); nothing else", async () => {
  const env = { PREP_BANK_R2: r2({ "prep-bank/overlay/medcov/medicine/med-acs.json": '{"topic":"med-acs","set":"medcov","v":1,"items":[]}', "prep-bank/overlay/medcov/ss-cardiology/sca-stemi.json": '{"topic":"sca-stemi","set":"medcov","v":1,"items":[]}' }) };
  for (const p of ["overlay/medcov/medicine/med-acs.json", "overlay/medcov/ss-cardiology/sca-stemi.json"]) {
    const r = await get(p, env);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get("Content-Type"), /application\/json/);
    assert.match(r.headers.get("Cache-Control"), /immutable/);
    assert.equal(JSON.parse(await r.text()).set, "medcov");
  }
  let asked = 0;
  const spy = { PREP_BANK_R2: { get: async () => { asked++; return { body: "x" }; } } };
  for (const p of ["overlay/medcov/med-acs.json", "overlay/medcov/medicine/med-acs.webp", "overlay/medcov/medicine/../x.json", "overlay/medcov/Medicine/med-acs.json", "overlay/medcov/medicine/a/b.json", "img/medcov/x.webp", "overlay/medcovx/medicine/med-acs.json"]) assert.equal((await get(p, spy)).status, 404, p);
  assert.equal(asked, 0);
});

test("bank: lessons and cards (index short cache; module files and lesson media immutable, right types); nothing else", async () => {
  const env = { PREP_BANK_R2: r2({ "prep-bank/v1/lessons/index.json": '{"v":1}', "prep-bank/v1/lessons/sur-thyroid.json": '{"v":1}', "prep-bank/v1/lessons/media/thyroid-flow.svg": "<svg/>",
    "prep-bank/v1/lessons/media/neck-us.webp": "RIFF", "prep-bank/v1/cards/index.json": '{"v":1}', "prep-bank/v1/cards/sur-thyroid.json": '{"v":1}' }) };
  for (const p of ["v1/lessons/index.json", "v1/cards/index.json"]) {
    const r = await get(p, env);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get("Content-Type"), /json/);
    assert.doesNotMatch(r.headers.get("Cache-Control"), /immutable/, p);
  }
  for (const [p, type] of [["v1/lessons/sur-thyroid.json", /json/], ["v1/cards/sur-thyroid.json", /json/], ["v1/lessons/media/thyroid-flow.svg", /^image\/svg\+xml$/], ["v1/lessons/media/neck-us.webp", /^image\/webp$/]]) {
    const r = await get(p, env);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get("Content-Type"), type, p);
    assert.match(r.headers.get("Cache-Control"), /immutable/, p);
  }
  assert.match((await get("v1/lessons/media/thyroid-flow.svg", env)).headers.get("Content-Security-Policy"), /default-src 'none'/);
  let asked = 0;
  const spy = { PREP_BANK_R2: { get: async () => { asked++; return { body: "x" }; } } };
  for (const p of ["v1/lessons/Sur.json", "v1/lessons/a/b.json", "v1/lessons/x.svg", "v1/cards/media/x.webp", "v1/lessons/media/x.png", "v1/lessons/media/../index.json", "v1/lessons/media/a/b.svg", "v1/cards/x.json.bak", "v1/lessons/media/x.svg.json", "lessons/index.json"]) {
    assert.equal((await get(p, spy)).status, 404, p);
  }
  assert.equal(asked, 0);
});

test("bank: radiology images and scroll-stack slices in a subject's own version (immutable, right types); nothing else", async () => {
  const env = { PREP_BANK_R2: r2({ "prep-bank/v6/ss-radiology/img/rad-moyamoya-pmc1-f1.webp": "RIFF", "prep-bank/v6/ss-radiology/stack/vs/soft/000.webp": "RIFF",
    "prep-bank/v6/ss-radiology/stack/vs/stack.json": '{"n":1}', "prep-bank/v6/ss-radiology/index.json": '{"id":"ss-radiology"}', "prep-bank/v6/ss-radiology/mcq/srd-neuro-tumour.json": '{"items":[]}' }) };
  for (const [p, type] of [["v6/ss-radiology/img/rad-moyamoya-pmc1-f1.webp", /^image\/webp$/], ["v6/ss-radiology/stack/vs/soft/000.webp", /^image\/webp$/], ["v6/ss-radiology/stack/vs/stack.json", /json/], ["v6/ss-radiology/mcq/srd-neuro-tumour.json", /json/]]) {
    const r = await get(p, env);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get("Content-Type"), type, p);
    assert.match(r.headers.get("Cache-Control"), /immutable/, p);
  }
  assert.equal((await get("v6/ss-radiology/index.json", env)).status, 200);
  let asked = 0;
  const spy = { PREP_BANK_R2: { get: async () => { asked++; return { body: "x" }; } } };
  for (const p of ["v6/ss-radiology/img/x.png", "v6/ss-radiology/img/a/b.webp", "v6/ss-radiology/img/../index.json", "v6/ss-radiology/stack/vs/soft/00.webp", "v6/ss-radiology/stack/vs/soft/0001.webp",
    "v6/ss-radiology/stack/vs/Soft/000.webp", "v6/ss-radiology/stack/vs/soft/000.png", "v6/ss-radiology/stack/vs/a/b/000.webp", "v6/ss-radiology/stack/vs.json", "v1/cards/img/x.webp", "v1/lessons/img/x.webp", "ss-radiology/img/x.webp"]) {
    assert.equal((await get(p, spy)).status, 404, p);
  }
  assert.equal(asked, 0);
});

test("bank: no binding is a clear 503", async () => {
  assert.equal((await get("v1/anatomy/index.json", {})).status, 503);
});

const post = (body, token, env) => flag.onRequestPost({ request: new Request("https://stewardmd.in/api/prep/flag", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }), env });
const GOOD = { itemId: "e9ad821a-c438-4965-9f77-760819dfa155", subject: "anatomy", module: "ana-gametogenesis", reason: "wrong-key" };

test("flag: sign-in required; only an id and a reason code are accepted", async () => {
  const env = { UPDATES_KV: kv() };
  assert.equal((await post(GOOD, null, env)).status, 401);
  for (const bad of [{ ...GOOD, reason: "free text here" }, { ...GOOD, itemId: "x" }, { ...GOOD, subject: "../etc" }, { ...GOOD, module: "" }]) {
    assert.equal((await post(bad, "tok-a", env)).status, 400);
  }
  assert.equal(env.UPDATES_KV.m.size, 0);
});

test("flag: one count per user per item; the record holds reasons, no text", async () => {
  const env = { UPDATES_KV: kv() };
  assert.deepEqual(await (await post(GOOD, "tok-a", env)).json(), { ok: true, counted: true, n: 1 });
  assert.deepEqual(await (await post({ ...GOOD, reason: "unclear" }, "tok-a", env)).json(), { ok: true, counted: false });
  assert.deepEqual(await (await post({ ...GOOD, reason: "unclear" }, "tok-b", env)).json(), { ok: true, counted: true, n: 2 });
  const rec = JSON.parse(env.UPDATES_KV.m.get("prep:flag:" + GOOD.itemId));
  assert.equal(rec.n, 2);
  assert.deepEqual(rec.reasons, { "wrong-key": 1, unclear: 1 });
  assert.equal(rec.subject, "anatomy");
  assert.ok(!JSON.stringify(rec).includes("a@example.com"));
});

test("flag: daily cap per user", async () => {
  const env = { UPDATES_KV: kv() };
  for (let i = 0; i < 60; i++) assert.equal((await post({ ...GOOD, itemId: "item-" + String(i).padStart(4, "0") }, "tok-a", env)).status, 200);
  assert.equal((await post({ ...GOOD, itemId: "item-9999" }, "tok-a", env)).status, 429);
  assert.equal((await post({ ...GOOD, itemId: "item-9999" }, "tok-b", env)).status, 200);
});

test("flag: only owners read the most-reported list", async () => {
  const env = { UPDATES_KV: kv(), UPDATES_ADMIN_TOKEN: "owner-token-123" };
  await post(GOOD, "tok-a", env); await post(GOOD, "tok-b", env);
  await post({ ...GOOD, itemId: "other-item-1" }, "tok-a", env);
  const deny = await flag.onRequestGet({ request: new Request("https://stewardmd.in/api/prep/flag?top=1", { headers: { Authorization: "Bearer tok-a" } }), env });
  assert.equal(deny.status, 403);
  const ok = await flag.onRequestGet({ request: new Request("https://stewardmd.in/api/prep/flag?top=1", { headers: { "X-Admin-Token": "owner-token-123" } }), env });
  const j = await ok.json();
  assert.equal(j.items[0].itemId, GOOD.itemId);
  assert.equal(j.items[0].n, 2);
  assert.equal(j.items.length, 2);
});

test("flag: three separate reporters hide an item for everyone; owners see it marked and can restore it", async () => {
  CLAIMS["tok-c"] = { sub: "u-c", email: "c@example.com", email_verified: true };
  const env = { UPDATES_KV: kv(), UPDATES_ADMIN_TOKEN: "owner-token-123" };
  const hidden = async () => (await flag.onRequestGet({ request: new Request("https://stewardmd.in/api/prep/flag?hidden=1"), env })).json();
  await post(GOOD, "tok-a", env); await post(GOOD, "tok-a", env); await post(GOOD, "tok-b", env);
  assert.deepEqual(await hidden(), { ids: [] }, "two reporters (one twice) do not hide it");
  await post(GOOD, "tok-c", env);
  const r = await flag.onRequestGet({ request: new Request("https://stewardmd.in/api/prep/flag?hidden=1"), env });
  assert.match(r.headers.get("Cache-Control"), /public/);
  assert.deepEqual(await r.json(), { ids: [GOOD.itemId] });
  const top = await (await flag.onRequestGet({ request: new Request("https://stewardmd.in/api/prep/flag?top=1", { headers: { "X-Admin-Token": "owner-token-123" } }), env })).json();
  assert.equal(top.items[0].hidden, true);
  const del = (h) => flag.onRequestDelete({ request: new Request("https://stewardmd.in/api/prep/flag", { method: "DELETE", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify({ itemId: GOOD.itemId }) }), env });
  assert.equal((await del({ Authorization: "Bearer tok-a" })).status, 403);
  assert.equal((await del({ "X-Admin-Token": "owner-token-123" })).status, 200);
  assert.deepEqual(await hidden(), { ids: [] });
  assert.equal(env.UPDATES_KV.m.has("prep:flag:" + GOOD.itemId), false);
});
