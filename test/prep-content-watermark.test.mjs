/* test/prep-content-watermark.test.mjs — per-user PrepNucleus bank watermark (owner 2026-11-13).
 *
 * Round-trip embed -> trace finds the right user among 1,000 ids; different users get different marks;
 * stems/options/answers byte-identical; JSON parses; public paths unmarked; missing secret serves normally.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import os from "node:os";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "test-watermark-secret-do-not-use-in-prod-0123456789abcdef";
const FILE_KEY = "v5/medicine/mcq/wm-fixture.json";

const SAMPLE = {
  topic: "wm-fixture",
  items: [
    {
      id: "wm-1",
      q: "A 32 year old woman has resistant hypertension. Angiography shows a beaded mid renal artery. The most likely diagnosis is?",
      o: ["Atherosclerotic stenosis", "Fibromuscular dysplasia", "Polyarteritis nodosa", "Renal artery embolism"],
      a: 1,
      exp: "Fibromuscular dysplasia gives the beaded look because short stenoses alternate with dilatations. Remember mid-artery beads in a young woman.",
      t: "wm-fixture",
      d: 2,
      x: {
        key: "Fibromuscular dysplasia gives the beaded look because short stenoses alternate with small dilatations in the mid artery. Ostial disease points elsewhere.",
        notes: "Young woman with resistant hypertension and mid-artery beads: think FMD. Treat with angioplasty when indicated.",
        others: {
          A: "Atheroma narrows the origin of the artery in older people with vascular risk factors.",
          C: "Polyarteritis nodosa gives small aneurysms and a systemic illness, not smooth mid-artery beads.",
          D: "An embolism cuts flow off suddenly, usually with flank pain and a normal downstream wall.",
        },
        pearl: "Mid artery beads in a young woman: think fibromuscular dysplasia.",
      },
    },
    {
      id: "wm-2",
      q: "Which drug is withheld in pregnancy among these diabetes medicines?",
      o: ["Insulin", "Metformin", "Empagliflozin", "Glyburide"],
      a: 2,
      exp: "Empagliflozin is withheld in pregnancy for lack of safety data. Insulin, metformin and glyburide are used when needed.",
      t: "wm-fixture",
      d: 1,
      x: {
        key: "Empagliflozin is withheld in pregnancy for lack of safety data, while insulin, metformin and glyburide are used.",
        notes: "SGLT2 inhibitors lack pregnancy safety data. Switch early when planning conception.",
        others: {
          A: "Insulin is the preferred agent in pregnancy.",
          B: "Metformin is widely used in gestational diabetes.",
          D: "Glyburide is an option when metformin is not tolerated.",
        },
        pearl: "Hold SGLT2 inhibitors in pregnancy.",
      },
    },
    {
      id: "wm-3",
      q: "Pure motor wrist drop with intact sensation localises to which nerve?",
      o: ["Radial nerve at the spiral groove", "Posterior interosseous nerve", "Ulnar nerve", "Median nerve"],
      a: 1,
      exp: "A pure motor wrist drop with intact sensation places the lesion distal to the sensory branch. That is the posterior interosseous nerve.",
      t: "wm-fixture",
      d: 2,
    },
  ],
};

const CLAIMS = {
  "tok-a": { sub: "u-a", email: "a@example.com", email_verified: true },
  "tok-b": { sub: "u-b", email: "b@example.com", email_verified: true },
};
const realAuth = await import("../functions/_fbauth.js");
const claimsOf = (req) => CLAIMS[(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")] || null;
mock.module("../functions/_fbauth.js", {
  namedExports: {
    ...realAuth,
    verifiedClaimsFor: async (req) => claimsOf(req),
  },
});

const wm = await import("../functions/_prep_watermark.js");
const gate = await import("../functions/_prep_bank_gate.js");
const bank = await import("../functions/api/prep/bank/[[path]].js");

function r2(files) {
  return {
    get: async (k) => {
      if (!(k in files)) return null;
      const body = files[k];
      return {
        body,
        httpEtag: '"e1"',
        text: async () => (typeof body === "string" ? body : await new Response(body).text()),
      };
    },
  };
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

async function createSignedRequest(pathStr, userToken, session, overrides = {}) {
  const ts = overrides.timestamp != null ? overrides.timestamp : Math.floor(Date.now() / 1000);
  const nonce = overrides.nonce || ("n_" + Math.random().toString(36).slice(2));
  const toSign = `${ts}:${pathStr}:${nonce}`;
  const sig = overrides.sig != null ? overrides.sig : await gate.hmacSha256Hex(session.sessionKey, toSign);
  const headers = new Headers({
    Origin: overrides.origin != null ? overrides.origin : "https://stewardmd.in",
    "X-SMD-Device": "dev-wm-1",
    Authorization: "Bearer " + userToken,
    "X-SMD-Session": session.sessionId,
    "X-SMD-Timestamp": String(ts),
    "X-SMD-Nonce": nonce,
    "X-SMD-Signature": sig,
  });
  return new Request("https://stewardmd.in/api/prep/bank/" + pathStr, { method: "GET", headers });
}

async function mint(env, token) {
  const sessReq = new Request("https://stewardmd.in/api/prep/bank/session", {
    method: "POST",
    headers: {
      Origin: "https://stewardmd.in",
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "X-SMD-Device": "phone-wm",
    },
    body: JSON.stringify({ deviceId: "phone-wm", appVersion: "1.0.0" }),
  });
  const sessRes = await bank.onRequestPost({ env, params: { path: ["session"] }, request: sessReq });
  assert.equal(sessRes.status, 200);
  return sessRes.json();
}

function freezeProtected(orig, marked) {
  assert.equal(marked.items.length, orig.items.length);
  for (let i = 0; i < orig.items.length; i++) {
    const a = orig.items[i], b = marked.items[i];
    assert.equal(b.id, a.id);
    assert.equal(b.q, a.q);
    assert.deepEqual(b.o, a.o);
    assert.equal(b.a, a.a);
    if (a.x && a.x.others) assert.deepEqual(b.x.others, a.x.others);
    if (a.x && a.x.pearl) assert.equal(b.x.pearl, a.x.pearl);
  }
}

test("watermark unit: embed marks; stems/options/answers unchanged; JSON parses", async () => {
  wm.resetWatermarkLog();
  const doc = JSON.parse(JSON.stringify(SAMPLE));
  const r = await wm.watermarkDocument(doc, { userId: "fb:u-a", fileKey: FILE_KEY, secret: SECRET });
  assert.equal(r.marked, true);
  assert.ok(r.targets.length >= 2 && r.targets.length <= 3);
  freezeProtected(SAMPLE, doc);
  const marks = wm.extractMarks(JSON.stringify(doc));
  assert.ok(marks.length >= 2);
  const hex = wm.bitsToHex40(marks[0]);
  const { bits40 } = await wm.hmacMarkMaterial(SECRET, "fb:u-a", FILE_KEY);
  assert.equal(hex, wm.bitsToHex40(bits40));
});

test("watermark unit: different users get different marks", async () => {
  const a = JSON.parse(JSON.stringify(SAMPLE));
  const b = JSON.parse(JSON.stringify(SAMPLE));
  await wm.watermarkDocument(a, { userId: "fb:u-a", fileKey: FILE_KEY, secret: SECRET });
  await wm.watermarkDocument(b, { userId: "fb:u-b", fileKey: FILE_KEY, secret: SECRET });
  const ma = wm.extractMarks(JSON.stringify(a)).map(wm.bitsToHex40);
  const mb = wm.extractMarks(JSON.stringify(b)).map(wm.bitsToHex40);
  assert.ok(ma.length);
  assert.ok(mb.length);
  assert.notEqual(ma[0], mb[0]);
});

test("watermark unit: variant layer uses NBSP after a full stop for bit=1 users", async () => {
  const doc = JSON.parse(JSON.stringify(SAMPLE));
  const { variantBit } = await wm.hmacMarkMaterial(SECRET, "fb:u-a", FILE_KEY);
  await wm.watermarkDocument(doc, { userId: "fb:u-a", fileKey: FILE_KEY, secret: SECRET });
  const raw = JSON.stringify(doc);
  if (variantBit === 1) {
    assert.ok(raw.includes("." + wm.NBSP), "variant bit 1 should insert NBSP after a period");
  } else {
    assert.equal(wm.detectVariantBit(wm.stripWatermarkMarks(raw).replace(/\u00A0/g, " ")), 0);
  }
  assert.equal(wm.detectVariantBit(raw), variantBit);
});

test("watermark unit: missing secret returns unmarked and logs once", async () => {
  wm.resetWatermarkLog();
  const raw = JSON.stringify(SAMPLE);
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  try {
    const r1 = await wm.watermarkJsonText(raw, { userId: "fb:u-a", fileKey: FILE_KEY, secret: "" });
    const r2 = await wm.watermarkJsonText(raw, { userId: "fb:u-a", fileKey: FILE_KEY, secret: "" });
    assert.equal(r1.marked, false);
    assert.equal(r1.text, raw);
    assert.equal(r2.text, raw);
    assert.equal(warns.filter((w) => /WATERMARK_SECRET missing/.test(w)).length, 1);
  } finally {
    console.warn = orig;
  }
});

test("watermark round-trip: trace finds the right user among 1,000 candidate ids", async () => {
  const doc = JSON.parse(JSON.stringify(SAMPLE));
  const victim = "fb:user-victim-42";
  await wm.watermarkDocument(doc, { userId: victim, fileKey: FILE_KEY, secret: SECRET });
  const leaked = JSON.stringify(doc);
  const marks = wm.extractMarks(leaked);
  assert.ok(marks.length >= 1);

  const candidates = [];
  for (let i = 0; i < 1000; i++) candidates.push("fb:user-" + i);
  candidates[42] = victim;

  const t0 = performance.now();
  const hits = await wm.matchCandidates(marks, candidates, FILE_KEY, SECRET);
  const ms = performance.now() - t0;
  assert.deepEqual(hits, [victim]);
  assert.ok(ms < 5000, "matching 1000 ids should be well under a few seconds (got " + ms + "ms)");
});

test("watermark embed performance: < 5 ms per typical file", async () => {
  const raw = JSON.stringify(SAMPLE);
  /* Warm HMAC / subtle. */
  await wm.watermarkJsonText(raw, { userId: "fb:warm", fileKey: FILE_KEY, secret: SECRET });
  const times = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    await wm.watermarkJsonText(raw, { userId: "fb:perf-" + i, fileKey: FILE_KEY, secret: SECRET });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  assert.ok(median < 5, "median watermark time " + median.toFixed(2) + "ms must be < 5ms");
});

test("gate: signed-in gated JSON is watermarked; Cache-Control stays private, no-store", async () => {
  gate.resetBankGateMemory();
  wm.resetWatermarkLog();
  const body = JSON.stringify(SAMPLE);
  const env = {
    PREP_BANK_ENFORCE: "1",
    WATERMARK_SECRET: SECRET,
    MAIK_KV: kv(),
    PREP_BANK_R2: r2({ ["prep-bank/" + FILE_KEY]: body }),
  };
  const sess = await mint(env, "tok-a");
  const req = await createSignedRequest(FILE_KEY, "tok-a", sess);
  const r = await bank.onRequestGet({ env, params: { path: FILE_KEY.split("/") }, request: req });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  const text = await r.text();
  const marked = JSON.parse(text);
  freezeProtected(SAMPLE, marked);
  const marks = wm.extractMarks(text);
  assert.ok(marks.length >= 1, "gated response should carry zero-width marks");
  const hits = await wm.matchCandidates(marks, ["fb:u-a", "fb:u-b"], FILE_KEY, SECRET);
  assert.deepEqual(hits, ["fb:u-a"]);
});

test("gate: different signed-in users receive different marks for the same file", async () => {
  gate.resetBankGateMemory();
  const body = JSON.stringify(SAMPLE);
  const env = {
    PREP_BANK_ENFORCE: "1",
    WATERMARK_SECRET: SECRET,
    MAIK_KV: kv(),
    PREP_BANK_R2: r2({ ["prep-bank/" + FILE_KEY]: body }),
  };
  const sessA = await mint(env, "tok-a");
  const sessB = await mint(env, "tok-b");
  const rA = await bank.onRequestGet({
    env, params: { path: FILE_KEY.split("/") },
    request: await createSignedRequest(FILE_KEY, "tok-a", sessA),
  });
  const rB = await bank.onRequestGet({
    env, params: { path: FILE_KEY.split("/") },
    request: await createSignedRequest(FILE_KEY, "tok-b", sessB),
  });
  const tA = await rA.text(), tB = await rB.text();
  const hA = wm.extractMarks(tA).map(wm.bitsToHex40);
  const hB = wm.extractMarks(tB).map(wm.bitsToHex40);
  assert.ok(hA.length && hB.length);
  assert.notEqual(hA[0], hB[0]);
});

test("gate: public lessons path is unmarked even when WATERMARK_SECRET is set", async () => {
  gate.resetBankGateMemory();
  const lesson = JSON.stringify({ id: "les-1", title: "Public lesson", body: "Explanation-like text that is long enough for a mark. Second sentence here." });
  const p = "v1/lessons/les-1.json";
  const env = {
    PREP_BANK_ENFORCE: "1",
    WATERMARK_SECRET: SECRET,
    PREP_BANK_R2: r2({ ["prep-bank/" + p]: lesson }),
  };
  const req = new Request("https://stewardmd.in/api/prep/bank/" + p, {
    method: "GET",
    headers: { Origin: "https://stewardmd.in" },
  });
  const r = await bank.onRequestGet({ env, params: { path: p.split("/") }, request: req });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("Cache-Control"), /public/);
  const text = await r.text();
  assert.equal(text, lesson);
  assert.equal(wm.extractMarks(text).length, 0);
});

test("gate: missing WATERMARK_SECRET serves gated JSON normally (unmarked)", async () => {
  gate.resetBankGateMemory();
  wm.resetWatermarkLog();
  const body = JSON.stringify(SAMPLE);
  const env = {
    PREP_BANK_ENFORCE: "1",
    MAIK_KV: kv(),
    PREP_BANK_R2: r2({ ["prep-bank/" + FILE_KEY]: body }),
  };
  const sess = await mint(env, "tok-a");
  const r = await bank.onRequestGet({
    env, params: { path: FILE_KEY.split("/") },
    request: await createSignedRequest(FILE_KEY, "tok-a", sess),
  });
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.equal(text, body);
  assert.equal(wm.extractMarks(text).length, 0);
});

test("tools/watermark-trace.mjs finds the victim among candidates (CLI)", async () => {
  const doc = JSON.parse(JSON.stringify(SAMPLE));
  const victim = "fb:cli-victim";
  await wm.watermarkDocument(doc, { userId: victim, fileKey: FILE_KEY, secret: SECRET });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-trace-"));
  const leakedPath = path.join(dir, "leaked.txt");
  const idsPath = path.join(dir, "ids.txt");
  fs.writeFileSync(leakedPath, JSON.stringify(doc));
  const ids = [];
  for (let i = 0; i < 50; i++) ids.push("fb:cli-" + i);
  ids.push(victim);
  fs.writeFileSync(idsPath, ids.join("\n") + "\n");

  const r = spawnSync(process.execPath, [
    path.join(ROOT, "tools/watermark-trace.mjs"),
    "--text", leakedPath,
    "--file-key", FILE_KEY,
    "--ids", idsPath,
    "--json",
  ], {
    encoding: "utf8",
    env: { ...process.env, WATERMARK_SECRET: SECRET },
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const summary = JSON.parse(r.stdout);
  assert.ok(summary.marksFound >= 1);
  assert.ok(summary.matches.includes(victim));
  assert.doesNotMatch(r.stdout, new RegExp(SECRET));
  assert.doesNotMatch(r.stderr || "", new RegExp(SECRET));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("client helpers strip zero-width marks without touching visible letters", () => {
  const marked = "bead" + "\u2060" + "\u200B\u200C".repeat(20) + "\u2060" + "ed";
  assert.equal(wm.stripWatermarkMarks(marked), "beaded");
  const play = fs.readFileSync(path.join(ROOT, "prep-play.js"), "utf8");
  assert.match(play, /\\u200b\\u200c\\u200d\\u2060\\ufeff/);
  const prep = fs.readFileSync(path.join(ROOT, "prep.js"), "utf8");
  assert.match(prep, /function stripWmMarks/);
  const teacher = fs.readFileSync(path.join(ROOT, "prep-teacher.js"), "utf8");
  assert.match(teacher, /\\u200b\\u200c\\u200d\\u2060\\ufeff/);
});
