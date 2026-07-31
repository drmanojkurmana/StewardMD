// test/connect/abdm/no-phi-sweep.test.mjs — Stage-6 Task-6 (spec §14.3 / R16): the no-PHI + residency guard.
//
// TWO independent proofs that no raw ABHA / careContextReference / decrypted FHIR content ever leaves the
// Connect process except as an HMAC / id / opaque token:
//   (1) RUNTIME GUARD  — looksLikePhi / assertNoPhi / guardedKvPut reject a PHI-shaped key or value at write
//                        time (fail-closed), while HMAC hex, UUIDs, ISO timestamps, counts and opaque tokens
//                        pass untouched (so the real token/nonce KV writes are never blocked).
//   (2) CODEBASE AUDIT — a static sweep of every functions/_connect/**/*.js module proving no `kv.put` /
//                        `console.*` / URL-construction / D1-`bind`/`prepare` / key-assignment line ever
//                        carries a RAW-ABHA / careContextReference / plaintext variable. Comment- and
//                        string-aware, so the many "raw ABHA…" doc-comments and the field-name map
//                        (`careContextRef: "careContextReference"`) do NOT false-positive, while a planted
//                        `kv.put(k, abhaAddress)` / `console.error(careContextReference)` DOES fail it.
//
// Adversarial focus (from the brief): a raw ABHA on a console/throw path, a careContextReference in an R2 key
// or URL query, a decrypted blob nested in an audit scope, a KV key built from patient input, and a
// looksLikePhi realm false-negative.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { looksLikePhi, assertNoPhi, guardedKvPut, PhiLeakError, RESIDENCY } from "../../../functions/_connect/abdm/no-phi.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// (1) RUNTIME GUARD
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const HMAC_HEX = "a".repeat(64);                                   // a 256-bit HMAC/digest, hex
const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ISO = "2026-07-31T10:20:30.123Z";

test("looksLikePhi: PHI shapes → true", () => {
  const phi = [
    "tester@sbx",                                                 // ABHA address, sandbox realm
    "patient@abdm",                                               // ABHA address, prod realm
    "9876543210@ndhm",                                            // digits@realm
    "someone@myrealm",                                            // GENERIC realm — no false-negative on an unlisted realm
    "12345678901234",                                             // bare 14-digit ABHA number
    "12-3456-7890-1234",                                          // hyphen-formatted 14-digit ABHA number
    '{"resourceType":"Patient","id":"p1"}',                      // decrypted FHIR resource
    '{"resourceType":"Bundle","type":"collection","entry":[]}', // decrypted FHIR Bundle
    { resourceType: "Observation", id: "o1" },                  // FHIR as an object (not pre-stringified)
    { resourceCounts: { total: 3 }, scope: { blob: { resourceType: "Bundle" } } }, // FHIR NESTED in an audit-scope blob
  ];
  for (const v of phi) assert.equal(looksLikePhi(v), true, "should flag PHI: " + JSON.stringify(v).slice(0, 60));
});

test("looksLikePhi: non-PHI (HMAC/UUID/ISO/count/token/empty) → false", () => {
  const clean = [
    HMAC_HEX, UUID, ISO,
    "1", "0", "202", 3, 0,                                        // small counts / nonce value
    "opaque-token", "connect:token:default", "connect:abdm:nonce:" + UUID,
    "GRANTED", "REVOKED", "TRANSFERRED",
    "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.sig",                  // JWT-shaped opaque token (no @realm)
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

test("guardedKvPut: opaque token/nonce writes are allowed", async () => {
  const kv = mockKv();
  await guardedKvPut(kv, "connect:abdm:tok:default", JSON.stringify({ token: "opaque-token", exp: 1 }), { expirationTtl: 60 });
  await guardedKvPut(kv, "connect:abdm:nonce:" + UUID, "1", { expirationTtl: 900 });
  assert.equal(kv.store.size, 2);
  assert.equal(JSON.parse(kv.store.get("connect:abdm:tok:default").v).token, "opaque-token");
});

test("guardedKvPut: PHI in the KEY → PhiLeakError, and NOTHING is written", async () => {
  const kv = mockKv();
  await assert.rejects(() => guardedKvPut(kv, "connect:abha:tester@sbx", "1"), PhiLeakError);
  await assert.rejects(() => guardedKvPut(kv, "connect:abha:12345678901234", "1"), PhiLeakError);
  assert.equal(kv.store.size, 0, "guard must refuse the put — no partial write");
});

test("guardedKvPut: decrypted FHIR in the VALUE → PhiLeakError, and NOTHING is written", async () => {
  const kv = mockKv();
  await assert.rejects(() => guardedKvPut(kv, "connect:x", '{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Patient"}}]}'), PhiLeakError);
  await assert.rejects(() => guardedKvPut(kv, "connect:y", "9876543210@abdm"), PhiLeakError);   // ABHA smuggled as a value
  assert.equal(kv.store.size, 0);
});

test("RESIDENCY note is exported and frozen for the T9 owner-onboarding DPIA section", () => {
  assert.equal(typeof RESIDENCY, "object");
  assert.ok(Object.isFrozen(RESIDENCY));
  assert.match(JSON.stringify(RESIDENCY).toLowerCase(), /global/);   // KV is globally replicated → PHI-free by policy
  assert.match(JSON.stringify(RESIDENCY).toLowerCase(), /dpia|residency|gap/);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// (2) CODEBASE AUDIT — the static sweep
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

// A comment- and string-aware reducer: drop // and /* */ comments (a raw-ABHA doc-comment must not trip the
// sweep) while PRESERVING string and template-literal bodies (so a `kv.put(`n:${abhaAddress}`)` interpolation
// is still visible). Newlines inside block comments are kept so reported line numbers stay accurate.
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
    // inside a string / template literal
    out += c;
    if (c === "\\") { if (i + 1 < n) { out += src[i + 1]; i += 2; continue; } }
    if (c === mode) mode = "code";
    i++;
  }
  return out;
}

// A RAW value-bearing identifier: a raw ABHA / careContextReference / decrypted-plaintext variable. The HMAC
// forms (patientAbhaHash, careContextHash) and generic `ref`/`key` names are deliberately NOT here.
const RAW = /\b(?:abhaAddress|abhaNumber|abha|healthId|rawAbha|raw_abha|careContextReference|careContextRef|ndhmPlaintext|plaintextBundle|decryptedContent|decrypted|plaintext)\b/i;

// The forbidden EGRESS SINKS. A line is a violation only when it is a sink AND carries a RAW identifier.
const SINKS = [
  { name: "kv/r2.put",   re: /\b(?:kv|cache|store|r2|bucket)\s*\.\s*put\s*\(/i },   // R16: no PHI into KV / R2
  { name: "console",     re: /\bconsole\s*\.\s*[a-z]+\s*\(/i },                     // no PHI into logs
  { name: "url",         re: /\bnew\s+URL\s*\(|https?:\/\/|\bfetch\s*\(|[?&][A-Za-z_%]+=/i }, // no PHI in a URL/query
  { name: "d1",          re: /\.\s*(?:bind|prepare)\s*\(/i },                       // no PHI into a D1 column
  { name: "key-assign",  re: /\b[A-Za-z_$][\w$]*[kK]ey\s*=[^=]/ },                  // no KV key built from patient input
];

function scan(src, file) {
  const lines = codeOnly(src).split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!RAW.test(line)) continue;
    for (const s of SINKS) if (s.re.test(line)) { hits.push({ file, line: i + 1, sink: s.name, text: line.trim().slice(0, 120) }); break; }
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

test("codebase-audit: the Connect surface is clean — zero raw-ABHA/careContextReference/plaintext egress", () => {
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
    'await db.prepare("INSERT ...").bind(id, abhaAddress).run();',       // raw ABHA into a D1 column
    'await r2.put("k", decryptedContent);',                              // decrypted plaintext persisted
  ];
  planted.forEach((code, idx) => {
    const hits = scan(code, "planted-" + idx + ".js");
    assert.equal(hits.length, 1, "planted violation NOT caught: " + code);
  });
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
  for (const code of benign) {
    const hits = scan(code, "benign.js");
    assert.equal(hits.length, 0, "false-positive on a legitimate line: " + code + " -> " + JSON.stringify(hits));
  }
});
