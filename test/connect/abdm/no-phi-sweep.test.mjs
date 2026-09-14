// test/connect/abdm/no-phi-sweep.test.mjs — Stage-6 Task-6 (spec §14.3 / R16): the no-PHI + residency guard.
//
// TWO independent proofs that no raw ABHA / decrypted FHIR content ever leaves the Connect process except as
// an HMAC / id / opaque token, plus the HONEST careContextReference stance from the dual-adversarial review:
//   (1) RUNTIME GUARD  — looksLikePhi / assertNoPhi / guardedKvPut / scrubPhi reject or redact a PHI-shaped
//                        value (ABHA, 14-digit ABHA, Aadhaar, Indian mobile, name, FHIR) while HMAC hex,
//                        UUIDs, ISO timestamps, counts, opaque tokens, epoch-ms and clinical labels pass
//                        untouched (so the real token/nonce/counter KV writes are never blocked).
//   (2) CODEBASE AUDIT — a static sweep of every functions/_connect/**/*.js module. A raw ABHA / decrypted
//                        plaintext (STRICT) may reach NO sink. A careContextReference (protocol-visible — see
//                        below) may NOT reach a KV/log/URL sink but MAY be stored in a D1 column (ref /
//                        care_contexts) BY DESIGN. Comment/string-aware, so doc-comments and the field-name
//                        map (`careContextRef: "careContextReference"`) do not false-positive.
//
// HONEST INVARIANT (dual-adversarial fix #3): the ABHA is ALWAYS HMAC'd; the careContextReference is a
// protocol-visible identifier (returned raw to the HIU, matched on serve) stored raw in ref/care_contexts —
// an accepted exception, NOT a leak. The audit sink (fix #1) now value-scans scope/resourceCounts.
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { looksLikePhi, assertNoPhi, assertNoPhiKey, guardedKvPut, scrubPhi, PhiLeakError, RESIDENCY } from "../../../functions/_connect/abdm/no-phi.js";
import { makeAuditSink } from "../../../functions/_connect/audit.js";
import { makeMockDb } from "../../../functions/_connect/testkit.js";
import { linkCareContext } from "../../../functions/_connect/abdm/hip.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// (1) RUNTIME GUARD
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const HMAC_HEX = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"; // 64 hex, has letters
const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ISO = "2026-07-31T10:20:30.123Z";

test("looksLikePhi: ABHA / 14-digit / FHIR shapes → true", () => {
  const phi = [
    "tester@sbx", "patient@abdm", "9876543210@ndhm", "someone@myrealm", // ABHA addresses (incl. an unlisted realm)
    "12345678901234", "12-3456-7890-1234",                              // 14-digit ABHA number
    '{"resourceType":"Patient","id":"p1"}', '{"resourceType":"Bundle","entry":[]}',
    { resourceType: "Observation", id: "o1" },                          // FHIR as an object
    { resourceCounts: { total: 3 }, scope: { blob: { resourceType: "Bundle" } } }, // FHIR NESTED in a blob
  ];
  for (const v of phi) assert.equal(looksLikePhi(v), true, "should flag PHI: " + JSON.stringify(v).slice(0, 60));
});

test("looksLikePhi: Aadhaar / Indian mobile / name → true (dual-adversarial additions #2)", () => {
  const phi = [
    "123456789012",              // 12-digit Aadhaar (bare)
    "1234 5678 9012",            // Aadhaar grouped 4-4-4
    "9876543210",                // 10-digit Indian mobile
    "+91-98765-43210",           // +91 mobile (grouped)
    "sms to 9123456789 bounced", // mobile embedded in free text
    "Dr. Ramesh Kumar",          // honorific name
    "Kumar, Ramesh",             // "Surname, Firstname"
    "1234567890123456",          // 16-digit id — no longer waved through as "hex"
  ];
  for (const v of phi) assert.equal(looksLikePhi(v), true, "should flag: " + v);
});

test("looksLikePhi: HMAC/UUID/ISO/count/token/epoch/clinical-label/empty → false", () => {
  const clean = [
    HMAC_HEX, UUID, ISO,
    "1", "0", "202", "999999999", 3, 0,                                 // counts / nonce (<=9 digits)
    "opaque-token", "connect:token:default", "connect:abdm:nonce:" + UUID, "connect:abdm:disco:src-1",
    "GRANTED", "REVOKED", "TRANSFERRED",
    "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.sig",                        // JWT-shaped opaque token
    JSON.stringify({ token: "eyJhbGciOiJSUzI1NiJ9", exp: 1735689600000 }), // the REAL token-cache value (13-digit epoch inside)
    "1735689600000",                                                    // bare epoch-ms — must NOT be Aadhaar/mobile
    "Discharge Summary", "Blood Test Report", "Complete Blood Count",   // clinical labels (TitleCase, NOT names)
    null, undefined, "",
  ];
  for (const v of clean) assert.equal(looksLikePhi(v), false, "should NOT flag: " + String(v).slice(0, 60));
});

test("assertNoPhi: throws PhiLeakError on PHI, no-op on clean; carries `where`", () => {
  assert.throws(() => assertNoPhi("tester@sbx", "kv.key"), (e) => e instanceof PhiLeakError && e.where === "kv.key");
  assert.doesNotThrow(() => assertNoPhi(HMAC_HEX, "kv.value"));
  assert.doesNotThrow(() => assertNoPhi("opaque-token", "kv.value"));
});

function mockKv() {
  const store = new Map();
  return { store, async put(k, v, o) { store.set(k, { v, o }); }, async get(k) { const e = store.get(k); return e ? e.v : null; } };
}

test("guardedKvPut: opaque token/nonce/counter writes are allowed (the wired sites)", async () => {
  const kv = mockKv();
  await guardedKvPut(kv, "connect:abdm:tok:default", JSON.stringify({ token: "opaque-token", exp: 1735689600000 }), { expirationTtl: 60 });
  await guardedKvPut(kv, "connect:abdm:nonce:" + UUID, "1", { expirationTtl: 900 });
  await guardedKvPut(kv, "connect:abdm:disco:src-1", JSON.stringify({ win: 29345678, count: 1 }), { expirationTtl: 120 });
  assert.equal(kv.store.size, 3);
  assert.equal(JSON.parse(kv.store.get("connect:abdm:tok:default").v).token, "opaque-token");
});

test("guardedKvPut: PHI in KEY or VALUE (ABHA/Aadhaar/mobile/FHIR) → PhiLeakError, NOTHING written", async () => {
  const kv = mockKv();
  await assert.rejects(() => guardedKvPut(kv, "connect:abha:tester@sbx", "1"), PhiLeakError);          // ABHA in key
  await assert.rejects(() => guardedKvPut(kv, "connect:abha:12345678901234", "1"), PhiLeakError);      // 14-digit in key
  await assert.rejects(() => guardedKvPut(kv, "connect:x", "9876543210@abdm"), PhiLeakError);          // ABHA value
  await assert.rejects(() => guardedKvPut(kv, "connect:x", "123456789012"), PhiLeakError);             // Aadhaar value
  await assert.rejects(() => guardedKvPut(kv, "connect:x", "+91-98765-43210"), PhiLeakError);          // mobile value
  await assert.rejects(() => guardedKvPut(kv, "connect:x", '{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Patient"}}]}'), PhiLeakError);
  assert.equal(kv.store.size, 0, "guard must refuse every put — no partial write");
});

test("audit sink (fix #1): a PHI value in scope/resourceCounts is REDACTED, never persisted to D1", async () => {
  const db = makeMockDb({});
  const sink = makeAuditSink({}, db);
  await sink({
    action: "hip.failed", outcome: "failed", ts: ISO, tenantId: "t1",
    // the free-form blobs an adversary would use to smuggle PHI past the KEY-only allow-list:
    scope: { reason: "rate-limited", note: "patient tester@sbx", who: "Dr. Ramesh Kumar", phone: "9876543210", blob: { resourceType: "Bundle", subject: "x" } },
    resourceCounts: { pages: 2, phone: "+91-98765-43210" },
  });
  const rows = db._tables.connect_audit_event;
  assert.equal(rows.length, 1, "the audit row still writes (redact, not drop)");
  const dump = JSON.stringify(rows[0]);
  for (const leak of ["tester@sbx", "Ramesh Kumar", "9876543210", "98765", '"Bundle"']) assert.equal(dump.includes(leak), false, "PHI leaked to D1: " + leak);
  const rc = JSON.parse(rows[0]._raw[6]);   // resource_counts column
  const scope = JSON.parse(rows[0]._raw[7]); // scope column
  assert.equal(scope.reason, "rate-limited", "non-PHI reason preserved");
  assert.equal(scope.note, "[REDACTED]");
  assert.equal(scope.who, "[REDACTED]");
  assert.equal(scope.phone, "[REDACTED]");
  assert.equal(scope.blob, "[REDACTED]");   // a nested FHIR subtree is redacted wholesale
  assert.equal(rc.pages, 2, "non-PHI count preserved");
  assert.equal(rc.phone, "[REDACTED]");
});

test("scrubPhi: leaves non-PHI untouched, redacts only PHI leaves", () => {
  assert.deepEqual(scrubPhi({ a: 1, b: "ok", c: "GRANTED" }), { a: 1, b: "ok", c: "GRANTED" });
  assert.deepEqual(scrubPhi({ reason: "revoked", abha: "x@sbx" }), { reason: "revoked", abha: "[REDACTED]" });
  assert.equal(scrubPhi(null), null);
  assert.equal(scrubPhi(5), 5);
});

test("linkCareContext (fix #4): a PHI-shaped display is rejected up front; a clinical label passes", async () => {
  for (const bad of ["Dr. Ramesh Kumar", "9876543210", "tester@sbx", "123456789012"]) {
    await assert.rejects(() => linkCareContext({}, {}, { display: bad, ref: "cc-1", tenantId: "t1" }), PhiLeakError, "must reject display: " + bad);
  }
  // a legitimate owner label passes the display gate (then fails later on the missing identify dep — NOT a PhiLeakError)
  await assert.rejects(
    () => linkCareContext({}, {}, { display: "Discharge Summary", ref: "cc-1", tenantId: "t1" }),
    (e) => !(e instanceof PhiLeakError),
  );
});

test("RESIDENCY note: KV-global policy AND the careContextReference protocol-visible exception are documented", () => {
  assert.ok(Object.isFrozen(RESIDENCY));
  const s = JSON.stringify(RESIDENCY).toLowerCase();
  assert.match(s, /global/);                                   // KV globally replicated → PHI-free by policy
  assert.match(s, /dpia|residency|gap/);
  assert.match(s, /protocol-visible|carecontextreference/);    // fix #3: honest, documented accepted exception
  assert.match(s, /hmac/);                                     // the ABHA is always HMAC'd
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// (2) CODEBASE AUDIT — the static sweep
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

// Comment/string-aware reducer: drop // and /* */ comments (a raw-ABHA doc-comment must not trip the sweep)
// while PRESERVING string and template-literal bodies (so a `kv.put(`n:${abhaAddress}`)` interpolation stays
// visible). Newlines inside block comments are kept so reported line numbers stay accurate.
function codeOnly(src) {
  let out = "", i = 0, mode = "code";
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && d === "*") { mode = "block"; i += 2; continue; }
      if (c === "'" || c === '"' || c === "`") { mode = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i++; continue; }
    if (mode === "block") { if (c === "*" && d === "/") { mode = "code"; i += 2; continue; } if (c === "\n") out += "\n"; i++; continue; }
    out += c;                                                  // inside a string / template literal
    if (c === "\\") { if (i + 1 < n) { out += src[i + 1]; i += 2; continue; } }
    if (c === mode) mode = "code";
    i++;
  }
  return out;
}

// STRICT raw identifiers — a raw ABHA / decrypted plaintext. These may reach NO sink.
const RAW_STRICT = /\b(?:abhaAddress|abhaNumber|abha|healthId|rawAbha|raw_abha|aadhaar|ndhmPlaintext|plaintextBundle|decryptedContent|decrypted|plaintext)\b/i;
// PROTOCOL-VISIBLE raw identifier — the careContextReference. Kept out of KV/log/URL (data-minimisation) but
// ACCEPTED in a D1 column (ref/care_contexts), where it is stored raw BY DESIGN (fix #3).
const RAW_REF = /\b(?:careContextReference|careContextRef)\b/i;

// EGRESS SINKS + the raw-identifier tiers each forbids. A line is a violation only when it matches a sink AND
// carries an identifier from one of that sink's tiers.
const SINKS = [
  { name: "kv/r2.put",  re: /\b(?:kv|cache|store|r2|bucket)\s*\.\s*put\s*\(/i, tiers: [RAW_STRICT, RAW_REF] },
  { name: "console",    re: /\bconsole\s*\.\s*[a-z]+\s*\(/i,                   tiers: [RAW_STRICT, RAW_REF] },
  { name: "url",        re: /\bnew\s+URL\s*\(|https?:\/\/|\bfetch\s*\(|[?&][A-Za-z_%]+=/i, tiers: [RAW_STRICT, RAW_REF] },
  { name: "key-assign", re: /\b[A-Za-z_$][\w$]*[kK]ey\s*=[^=]/,               tiers: [RAW_STRICT, RAW_REF] },
  { name: "d1",         re: /\.\s*(?:bind|prepare)\s*\(/i,                     tiers: [RAW_STRICT] }, // careContextReference (RAW_REF) in a D1 column is the ACCEPTED protocol-visible exception
];

function scan(src, file) {
  const lines = codeOnly(src).split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // ABDM's own endpoints contain the token "abha" as a bounded word, in the host
    // (https://abha.abdm.gov.in) and in the path (/abha/api/v3/...). Those are endpoints, not patient
    // identifiers, so blank the ABDM URL literal out before matching identifiers. Narrow on purpose:
    // only the literal is neutralised, so anything CONCATENATED onto it - a real abhaNumber or
    // abhaAddress variable - is still caught. The planted-violation test pins both directions.
    const probe = line.replace(/https?:\/\/[A-Za-z0-9.-]*abdm\.gov\.in[^"'`\s)]*/g, "ABDM_URL");
    for (const s of SINKS) {
      if (s.re.test(line) && s.tiers.some((t) => t.test(probe))) { hits.push({ file, line: i + 1, sink: s.name, text: line.trim().slice(0, 120) }); break; }
    }
  }
  return hits;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = dir + "/" + name;
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

const CONNECT_DIR = fileURLToPath(new URL("../../../functions/_connect", import.meta.url));

test("codebase-audit: the Connect surface is clean — no raw-ABHA/plaintext egress, no careContextReference in KV/log/URL", () => {
  const files = walk(CONNECT_DIR);
  assert.ok(files.length >= 20, "expected the whole Connect surface to be scanned, got " + files.length);
  const hits = [];
  for (const f of files) hits.push(...scan(readFileSync(f, "utf8"), f.replace(CONNECT_DIR, "functions/_connect")));
  assert.deepEqual(hits, [], "PHI-egress violation(s):\n" + hits.map((h) => `  ${h.file}:${h.line} [${h.sink}] ${h.text}`).join("\n"));
});

test("codebase-audit: the sweep WOULD flag every planted violation shape", () => {
  const planted = [
    'await kv.put("k", abhaAddress);',                                     // raw ABHA → KV value
    'const nonceKey = "connect:abha:" + abhaAddress;',                    // KV key built from patient input
    'await deps.kv.put(`connect:abha:${abhaAddress}`, "1");',             // ABHA interpolated into a KV key
    'console.error("data failed", careContextReference);',               // careContextReference on a log path
    'const u = new URL(base + "?ref=" + careContextReference);',         // careContextReference in a URL query
    'await r2.put(`abdm/buffer/${txn}/${careContextReference}`, body);', // careContextReference in an R2 key
    'await db.prepare("INSERT ...").bind(id, abhaAddress).run();',       // raw ABHA into a D1 column (STRICT)
    'await r2.put("k", decryptedContent);',                              // decrypted plaintext persisted
    'await fetch("https://abha.abdm.gov.in/x?id=" + abhaNumber);',       // ABDM host allowance must NOT hide a real leak
    'const u = new URL("https://abhasbx.abdm.gov.in/" + abhaAddress);',  // ditto, sandbox host
  ];
  planted.forEach((code, idx) => assert.equal(scan(code, "planted-" + idx + ".js").length, 1, "planted violation NOT caught: " + code));
});

test("codebase-audit: an ABDM API hostname alone is not a PHI violation", () => {
  const benign = [
    'abhaApiHost: "https://abha.abdm.gov.in",',
    'gateway: "https://dev.abdm.gov.in",',
    'const cert = await fetch("https://abhasbx.abdm.gov.in/abha/api/v3/profile/public/certificate");',
  ];
  benign.forEach((code) => assert.deepEqual(scan(code, "benign.js"), [], "false positive on: " + code));
});

test("codebase-audit: careContextReference in a D1 column is the ACCEPTED protocol-visible exception (not flagged)", () => {
  const accepted = [
    'await db.prepare("INSERT INTO cc ...").bind(id, tenant, hash, source, careContextReference, hiType, display, now).run();',
    '.bind(tenantId, careContextReference)',
  ];
  for (const code of accepted) assert.equal(scan(code, "accepted.js").length, 0, "protocol-visible careContextReference in D1 must NOT be flagged: " + code);
});

test("codebase-audit: the sweep does NOT false-positive on legitimate raw-PHI uses or doc-comments", () => {
  const benign = [
    'const body = { patient: { id: abhaAddress } };',                    // raw ABHA in an OUTBOUND POST body (legit) — no sink
    'const patientAbhaHash = await hmacPseudonym(env, tenantId, req.abhaAddress);', // hash it — assignment is NOT a key-sink
    'outbound.push({ page, careContextRef: rec.careContextRef });',      // .push, not .put
    'careContextReference,',                                              // pushPage POST-body field
    'careContextRef: "careContextReference",',                          // ingress field-name map (string literal)
    '// raw ABHA and careContextReference are NEVER logged or put to KV', // a doc-comment
    '/* careContextReference is HMAC-ed before any kv.put or console.log */', // a block doc-comment
    'await kv.put(tokKey, JSON.stringify({ token, exp }));',            // real token write — sink but NO raw ident
    'const careContextHash = await hmacCareContext(env, careContextRef);', // hash assignment — RAW present but not a sink
  ];
  for (const code of benign) assert.equal(scan(code, "benign.js").length, 0, "false-positive on a legitimate line: " + code);
});

// ───────────── D9: a composite KV key must not trip the guard on a concatenation artefact ─────────────
// A KV key is a namespace plus one or more values joined by ":". Checking the JOINED string flagged 7% of
// `prefix:hipId:<sha256>` keys, because a 64-char hex digest next to other text manufactures digit runs
// that look like an Indian mobile. The consequence was not a leak but a DENIAL: guardedKvPut threw, the
// caller failed closed, and roughly one patient in fourteen could never be cleared to receive a link OTP.
// Keys are now checked segment-wise, then again with the provably-safe segments elided.
test("D9: a hex digest inside a composite key never trips the guard", async () => {
  const sha = async (s) => {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
    return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  let tripped = 0;
  for (let i = 0; i < 500; i++) {
    try { assertNoPhiKey("connect:abdm:tok:IN2810006668:" + (await sha("patient-" + i))); }
    catch { tripped++; }
  }
  assert.equal(tripped, 0, "a hashed pseudonym is not PHI, and denying its key denies the patient");
});

test("D9: the key guard STILL blocks real PHI in any segment", () => {
  for (const key of [
    "connect:abdm:tok:ramesh1985@sbx",          // ABHA address
    "connect:abdm:x:9876543210",                // Indian mobile
    "connect:abdm:x:234123412346",              // Aadhaar
    "connect:abdm:x:91234567890123",            // ABHA number
    "connect:abdm:tok:IN2810006668:9876543210", // PHI alongside a legitimate segment
  ]) {
    assert.throws(() => assertNoPhiKey(key), PhiLeakError, "must block: " + key);
  }
});

test("D9: an identifier SPLIT across segments still trips on the elided remainder", () => {
  // Neither "98765" nor "43210" is PHI-shaped alone, so segment-wise checking alone would pass it.
  // Eliding only the provably-safe segments leaves the rest joined, which does trip.
  assert.throws(() => assertNoPhiKey("connect:abdm:x:98765:43210"), PhiLeakError);
});

test("D9: guardedKvPut writes a composite-key record that the old guard would have refused", async () => {
  const sha = async (s) => {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
    return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  // sha256("P1") is one of the digests that used to trip it.
  const key = "connect:abdm:otprate:t1:" + (await sha("P1"));
  const kv = makeMockKv();
  await guardedKvPut(kv, key, JSON.stringify({ win: 1, count: 1 }), { expirationTtl: 60 });
  assert.ok(await kv.get(key), "the rate-limit record must actually land");
});
