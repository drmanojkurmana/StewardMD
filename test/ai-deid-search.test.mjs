/* ai-deid-search.test.mjs - identifier-like content never reaches a third-party search (T09) or the
 * 90-day feedback log (T10), and /api/maik-feedback is per-IP rate limited (T10). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripIdentifiers } from "../functions/_deid.js";
import { sanitizeFeedback } from "../functions/_maik_feedback.js";

const { onRequest } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));
const fb = await import(new URL("../functions/api/maik-feedback.js", import.meta.url));

const RAW = "bed 12 UHID 4481123 ramesh ph 98765 43210 dr.x@hosp.org septic shock vasopressor choice patient name Ramesh Kumar";

test("stripIdentifiers removes MRN/UHID/bed, phones, emails, 4+ digit runs and everything after 'patient name'", () => {
  const out = stripIdentifiers(RAW);
  for (const bad of ["4481123", "98765", "43210", "hosp.org", "Kumar", "bed 12", "UHID"]) assert.ok(out.indexOf(bad) < 0, bad + " leaked: " + out);
  assert.match(out, /septic shock vasopressor choice/);
  assert.equal(stripIdentifiers("BP 120/80, 2 days fever, 0.5 mg/kg"), "BP 120/80, 2 days fever, 0.5 mg/kg", "doses and short numbers are kept");
  assert.equal(stripIdentifiers("IP no. 2024/5561 septic shock bedside ultrasound"), "septic shock bedside ultrasound");
});

function fakeKv() {
  const m = new Map();
  return { _m: m, get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, list: async () => ({ keys: [], list_complete: true }) };
}
async function research(body, env) {
  const seen = { tinyfish: [], gemini: [] };
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url && url.url ? url.url : url);
    if (u.indexOf("tinyfish") >= 0) { seen.tinyfish.push(decodeURIComponent(new URL(u).searchParams.get("query"))); return new Response(JSON.stringify({ results: [{ title: "Septic shock", snippet: "norepinephrine first", url: "https://www.ncbi.nlm.nih.gov/x" }] }), { status: 200 }); }
    if (u.indexOf("generateContent") >= 0) { seen.gemini.push(String(init && init.body)); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 }); }
    return new Response("{}", { status: 200 });
  };
  try {
    const request = new Request("https://stewardmd.in/api/ai/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const res = await onRequest({ request, env: Object.assign({ AI_PROVIDER: "developer", GEMINI_API_KEY: "k", TINYFISH_API_KEY: "t" }, env || {}), params: { path: ["research"] }, waitUntil: () => {} });
    await res.text();
  } finally { globalThis.fetch = real; }
  return seen;
}

test("/research sends TinyFish the stripped question, never the identifiers", async () => {
  const seen = await research({ question: RAW });
  assert.ok(seen.tinyfish.length >= 1, "TinyFish was called");
  for (const q of seen.tinyfish) for (const bad of ["4481123", "98765", "hosp.org", "Kumar"]) assert.ok(q.indexOf(bad) < 0, bad + " sent to TinyFish: " + q);
});

test("/research prefers the client's canonical topic for the search", async () => {
  const seen = await research({ question: RAW, topic: "Septic shock" });
  assert.deepEqual([...new Set(seen.tinyfish)], ["Septic shock"]);
});

test("snippetsOnly search is stripped too", async () => {
  const seen = await research({ question: RAW, snippetsOnly: true });
  assert.ok(seen.tinyfish.length >= 1);
  for (const q of seen.tinyfish) assert.ok(q.indexOf("4481123") < 0 && q.indexOf("Kumar") < 0);
});

test("feedback rows are identifier-stripped before storage", () => {
  const r = sanitizeFeedback({ helpful: "down", question: RAW, reason: "wrong for UHID 99887766, call 9876543210" }, 1);
  assert.ok(r.question.indexOf("4481123") < 0 && r.question.indexOf("Kumar") < 0);
  assert.ok(r.reason.indexOf("99887766") < 0 && r.reason.indexOf("9876543210") < 0);
});

test("/api/maik-feedback is rate limited per IP (30 / 10 min) and other IPs are unaffected", async () => {
  const kv = fakeKv();
  const post = (ip) => fb.onRequestPost({ request: new Request("https://stewardmd.in/api/maik-feedback", { method: "POST", headers: { "CF-Connecting-IP": ip }, body: JSON.stringify({ helpful: "up", question: "dose of x" }) }), env: { MAIK_KV: kv } }).then((r) => r.json());
  for (let i = 0; i < fb.FEEDBACK_PER_IP; i++) assert.equal((await post("1.2.3.4")).ok, true);
  const over = await post("1.2.3.4");
  assert.equal(over.ok, false);
  assert.equal(over.limited, true);
  assert.equal((await post("5.6.7.8")).ok, true, "a different IP still records");
});

test("feedback fails open when KV is unavailable", async () => {
  const r = await fb.onRequestPost({ request: new Request("https://x/api/maik-feedback", { method: "POST", headers: { "CF-Connecting-IP": "9.9.9.9" }, body: JSON.stringify({ helpful: "up" }) }), env: {} });
  assert.equal((await r.json()).ok, true);
});
