/* PrepNucleus content fixes (functions/_prepfix.js, functions/api/prep/fix.js): who may edit, what a fix may hold, how it is
 * applied to a question and a lesson, the image upload, the history and the revert.
 * node --test --experimental-test-module-mocks test/prep-fix.test.mjs */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const WHO = { "tok-owner": { owner: { ok: true, uid: "u-o", email: "drmanojkurmana@gmail.com" } }, "tok-signer": { signer: { ok: true, uid: "u-s", name: "Dr Test Signer", regNo: "1", council: "X", specialties: [] } }, "tok-student": {} };
const tokOf = (req) => (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifiedClaimsFor: async (req) => (WHO[tokOf(req)] ? { sub: "x", email: "e@x.com", email_verified: true } : null), identify: async (req) => (WHO[tokOf(req)] ? "fb:" + tokOf(req) : null) } });
mock.module("../functions/_bulletins_auth.js", { namedExports: {
  ownerIdentity: async (req) => (WHO[tokOf(req)] && WHO[tokOf(req)].owner) || { ok: false, reason: "not-owner" },
  signerIdentity: async (req) => (WHO[tokOf(req)] && WHO[tokOf(req)].signer) || { ok: false, reason: "not-a-signer" } } });

const P = await import("../functions/_prepfix.js");
const fix = await import("../functions/api/prep/fix.js");
const flag = await import("../functions/api/prep/flag.js");
const bank = await import("../functions/api/prep/bank/[[path]].js");

function kv() { const m = new Map(); return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) }; }
const r2 = () => { const o = new Map(); return { o, put: async (k, v, meta) => { o.set(k, { v, meta }); } }; };
const url = (q) => "https://stewardmd.in/api/prep/fix" + (q || "");
const call = (method, q, token, body, raw) => {
  const h = { "Content-Type": "application/json" }; if (token) h.Authorization = "Bearer " + token;
  const req = new Request(url(q), { method, headers: h, body: raw ? raw : body ? JSON.stringify(body) : undefined });
  return { request: req };
};
const env0 = () => ({ UPDATES_KV: kv(), PREP_BANK_R2: r2() });
const Q = { kind: "question", id: "q-abc-1", module: "ana-spleen", subject: "anatomy" };

test("validateFix: question fields are capped, cleaned and must agree with each other", () => {
  const ex = P.validateFix("question", { exp: "A <b>clear</b> explanation." }).fix.exp; assert.ok(!/[<>]/.test(ex) && /clear/.test(ex), "angle brackets are stripped");
  assert.equal(P.validateFix("question", { o: ["a", "b", "c"], a: 1 }).ok, true);
  assert.equal(P.validateFix("question", { o: ["a", "b", "c"] }).error, "key-needed");
  assert.equal(P.validateFix("question", { o: ["a", "b"], a: 2 }).error, "bad-key");
  assert.equal(P.validateFix("question", { o: ["a", ""], a: 0 }).error, "bad-options");
  assert.equal(P.validateFix("question", { q: "short" }).error, "bad-question");
  assert.equal(P.validateFix("question", { img: ["http://evil/x.webp"] }).error, "bad-image");
  assert.equal(P.validateFix("question", { img: ["v90/img/fx-0123abcd.webp"], imgPlace: "exp" }).fix.imgPlace, "exp");
  assert.equal(P.validateFix("question", {}).error, "empty-fix");
  assert.equal(P.validateFix("nope", { q: "x" }).error, "bad-kind");
  assert.equal(P.validateFix("question", { exp: "x".repeat(9000) }).fix.exp.length, P.LIMITS.exp);
});
test("validateFix: lesson steps and figures", () => {
  const v = P.validateFix("lesson", { title: "New title", steps: { 0: { tx: "Text", say: "Spoken" }, 2: { fig: { src: "v90/img/fx-0123abcd.webp", alt: "Spleen" } } } });
  assert.equal(v.ok, true); assert.equal(v.fix.steps["2"].fig.alt, "Spleen");
  assert.equal(P.validateFix("lesson", { steps: { 99: { tx: "x" } } }).error, "bad-steps");
  assert.equal(P.validateFix("lesson", { steps: { 0: { fig: { src: "/etc/passwd" } } } }).error, "bad-image");
});
test("applyQuestionFix: edited options or explanation drop the old per-option reasoning", () => {
  const it = { id: "q1", q: "Old?", o: ["a", "b"], a: 0, exp: "old", r: ["x", "y"], x: { key: "k" }, img: ["a.webp"], credit: "c" };
  P.applyQuestionFix(it, { exp: "new", ts: 5 });
  assert.equal(it.exp, "new"); assert.equal(it.r, null); assert.equal(it.x, null); assert.equal(it._fx, 5);
  const it2 = { q: "Old question here", o: ["a", "b"], a: 0, kp: "k" };
  P.applyQuestionFix(it2, { o: ["p", "q", "r"], a: 2, img: ["v90/img/fx-0123abcd.webp"], imgPlace: "stem", ts: 1 });
  assert.deepEqual(it2.o, ["p", "q", "r"]); assert.equal(it2.a, 2); assert.deepEqual(it2.img, ["v90/img/fx-0123abcd.webp"]);
});
test("applyLessonFix: text and a figure per step", () => {
  const les = { title: "T", steps: [{ tx: "a", say: "b" }, { tx: "c", vis: { kind: "table" } }] };
  P.applyLessonFix(les, { title: "T2", steps: { 0: { tx: "A2" }, 1: { fig: { src: "v90/img/fx-0123abcd.webp", alt: "Fig", caption: "Cap" } } }, ts: 9 });
  assert.equal(les.title, "T2"); assert.equal(les.steps[0].tx, "A2"); assert.equal(les.steps[0].say, "b");
  assert.deepEqual(les.steps[1].vis, { kind: "image", src: "v90/img/fx-0123abcd.webp", alt: "Fig", caption: "Cap" });
});

test("only owners and registered signers may write; students and anonymous may not", async () => {
  const env = env0(), body = { ...Q, fix: { exp: "A better explanation." } };
  for (const tok of [null, "tok-student"]) assert.equal((await fix.onRequestPost({ ...call("POST", "", tok, body), env })).status, 403);
  assert.equal((await fix.onRequestPost({ ...call("POST", "", "tok-signer", body), env })).status, 200);
  assert.equal((await fix.onRequestPost({ ...call("POST", "", "tok-owner", body), env })).status, 200);
  assert.equal((await fix.onRequestDelete({ ...call("DELETE", "", "tok-student", Q), env })).status, 403);
  const me = await (await fix.onRequestGet({ ...call("GET", "?me=1", "tok-signer"), env })).json();
  assert.deepEqual([me.editor, me.role], [true, "signer"]);
  assert.equal((await (await fix.onRequestGet({ ...call("GET", "?me=1", "tok-student"), env })).json()).editor, false);
});
test("a saved fix is public per module, listed in the index, logged, and revertible", async () => {
  const env = env0();
  assert.deepEqual(await (await fix.onRequestGet({ ...call("GET", "?ix=1"), env })).json(), { mods: {} });
  const s = await fix.onRequestPost({ ...call("POST", "", "tok-signer", { ...Q, fix: { exp: "First wording." }, note: "typo in key point" }), env });
  assert.equal(s.status, 200);
  await fix.onRequestPost({ ...call("POST", "", "tok-owner", { ...Q, fix: { exp: "Second wording.", kp: "Remember this." } }), env });
  const mod = await (await fix.onRequestGet({ ...call("GET", "?module=ana-spleen"), env })).json();
  assert.equal(mod.q["q-abc-1"].exp, "Second wording."); assert.equal(mod.q["q-abc-1"].name, "drmanojkurmana");
  assert.ok(Object.keys((await (await fix.onRequestGet({ ...call("GET", "?ix=1"), env })).json()).mods).includes("ana-spleen"));
  const log = (await (await fix.onRequestGet({ ...call("GET", "?log=1&kind=question&id=q-abc-1", "tok-owner"), env })).json()).log;
  assert.equal(log.length, 2); assert.equal(log[0].after.name, "Dr Test Signer"); assert.equal(log[1].before.exp, "First wording.");
  assert.equal((await fix.onRequestGet({ ...call("GET", "?log=1&kind=question&id=q-abc-1", "tok-student"), env })).status, 403);
  assert.equal((await fix.onRequestDelete({ ...call("DELETE", "", "tok-signer", Q), env })).status, 200);
  assert.deepEqual((await (await fix.onRequestGet({ ...call("GET", "?module=ana-spleen"), env })).json()).q, {});
  assert.deepEqual(await (await fix.onRequestGet({ ...call("GET", "?ix=1"), env })).json(), { mods: {} });
  assert.equal((await (await fix.onRequestGet({ ...call("GET", "?log=1&kind=question&id=q-abc-1", "tok-owner"), env })).json()).log.length, 3);
});
test("a lesson fix is stored under its own slot", async () => {
  const env = env0();
  await fix.onRequestPost({ ...call("POST", "", "tok-owner", { kind: "lesson", id: "ana-spleen", module: "ana-spleen", fix: { steps: { 0: { tx: "New text" } } } }), env });
  const mod = await (await fix.onRequestGet({ ...call("GET", "?module=ana-spleen"), env })).json();
  assert.equal(mod.l["ana-spleen"].steps["0"].tx, "New text"); assert.deepEqual(mod.q, {});
});
test("bad requests are refused and the public reads cannot be abused", async () => {
  const env = env0();
  assert.equal((await fix.onRequestPost({ ...call("POST", "", "tok-owner", { kind: "question", id: "..", module: "m", fix: { q: "x".repeat(20) } }), env })).status, 400);
  assert.equal((await fix.onRequestPost({ ...call("POST", "", "tok-owner", { ...Q, fix: { img: ["https://x/y.webp"] } }), env })).status, 400);
  assert.equal((await fix.onRequestGet({ ...call("GET", "?module=../secret"), env })).status, 400);
});
test("image upload: images only (WebP, JPEG, PNG by their bytes), size capped, content-addressed, served by the bank route", async () => {
  const env = env0();
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4, 5]);
  assert.equal((await fix.onRequestPost({ ...call("POST", "?image=1", "tok-student", null, webp), env })).status, 403);
  assert.equal((await fix.onRequestPost({ ...call("POST", "?image=1", "tok-owner", null, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])), env })).status, 415);
  const ok = await fix.onRequestPost({ ...call("POST", "?image=1", "tok-signer", null, webp), env });
  const j = await ok.json();
  assert.equal(ok.status, 200); assert.match(j.path, P.IMG_PATH_RE);
  assert.ok(env.PREP_BANK_R2.o.has("prep-bank/" + j.path));
  assert.equal(env.PREP_BANK_R2.o.get("prep-bank/" + j.path).meta.httpMetadata.contentType, "image/webp");
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0]);
  const jr = await (await fix.onRequestPost({ ...call("POST", "?image=1", "tok-owner", null, jpg), env })).json();
  assert.equal(env.PREP_BANK_R2.o.get("prep-bank/" + jr.path).meta.httpMetadata.contentType, "image/jpeg", "a JPEG keeps its own Content-Type under the .webp key");
  assert.ok(bank.bankPath({ path: j.path.split("/") }), "the existing bank route will serve it");
  const big = new Uint8Array(P.IMG_MAX_BYTES + 10); big.set(webp);
  assert.equal((await fix.onRequestPost({ ...call("POST", "?image=1", "tok-owner", null, big), env })).status, 413);
});
test("signers read and restore from the student-reports list too", async () => {
  const env = env0(); await env.UPDATES_KV.put("prep:flag:q-abc-1", JSON.stringify({ n: 1, reasons: { typo: 1 }, subject: "anatomy", module: "ana-spleen", first: 1, last: 2 }));
  const list = await flag.onRequestGet({ request: new Request("https://stewardmd.in/api/prep/flag?top=1", { headers: { Authorization: "Bearer tok-signer" } }), env });
  assert.equal(list.status, 200); assert.equal((await list.json()).items.length, 1);
  assert.equal((await flag.onRequestGet({ request: new Request("https://stewardmd.in/api/prep/flag?top=1", { headers: { Authorization: "Bearer tok-student" } }), env })).status, 403);
});
