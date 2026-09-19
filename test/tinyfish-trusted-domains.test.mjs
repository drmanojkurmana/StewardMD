/* test/tinyfish-trusted-domains.test.mjs — TinyFish search is restricted to trusted medical sources.
 *
 * Owner: "mk sure tinyfish uses trusted medical resources". TinyFish's `include_domains` param
 * hard-restricts results server-side (an allow-list, not a ranking hint), so this asserts the
 * actual outbound request carries it - a caller could otherwise silently drift back to an
 * unrestricted web search and nobody would notice until a doctor saw a forum post as a "source".
 * Shared by every caller (Research on the web, the Medical-Updates crawler, admin publish), so the
 * restriction lives once in functions/_search.js rather than being re-added per caller.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tinyfishSearch, TRUSTED_MEDICAL_DOMAINS } from "../functions/_search.js";

function stubFetch(response) {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return response; };
  return { calls, restore: () => { global.fetch = realFetch; } };
}

test("the domain list names real health authorities, journals and guideline bodies, no general web", () => {
  assert.ok(TRUSTED_MEDICAL_DOMAINS.length >= 15, "the list should be a real allow-list, not a token gesture");
  for (const d of ["who.int", "cdc.gov", "fda.gov", "ncbi.nlm.nih.gov", "nejm.org", "cochranelibrary.com"]) {
    assert.ok(TRUSTED_MEDICAL_DOMAINS.includes(d), `missing ${d}`);
  }
  for (const d of TRUSTED_MEDICAL_DOMAINS) assert.ok(/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d), `not a bare domain: ${d}`);
});

test("every TinyFish request carries include_domains with the trusted list, url-encoded", async () => {
  const s = stubFetch({ ok: true, json: async () => ({ results: [{ title: "NICE", url: "https://www.nice.org.uk/x", snippet: "s" }] }) });
  try {
    await tinyfishSearch({ TINYFISH_API_KEY: "k" }, "amoxicillin dose adult");
    assert.equal(s.calls.length, 1, "a restricted hit needs no second call");
    const url = s.calls[0].url;
    assert.ok(url.includes("include_domains="), "request is missing include_domains");
    const params = new URL(url).searchParams;
    assert.equal(params.get("include_domains"), TRUSTED_MEDICAL_DOMAINS.join(","));
    assert.equal(params.get("query"), "amoxicillin dose adult");
  } finally { s.restore(); }
});

test("no API key still returns [] and makes no request (unchanged behaviour)", async () => {
  const s = stubFetch({ ok: true, json: async () => ({ results: [{ title: "x" }] }) });
  try {
    const r = await tinyfishSearch({}, "anything");
    assert.deepEqual(r, []);
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
});

test("a non-ok response still returns [] (best-effort, never throws)", async () => {
  const s = stubFetch({ ok: false });
  try {
    const r = await tinyfishSearch({ TINYFISH_API_KEY: "k" }, "q");
    assert.deepEqual(r, []);
  } finally { s.restore(); }
});

test("FALLBACK (2026-09-18): an empty restricted search retries unrestricted and keeps ONLY trusted URLs", async () => {
  let n = 0; const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => { calls.push(url); n++; return { ok: true, json: async () => (n === 1 ? { results: [] } : { results: [
    { title: "AASLD guideline", url: "https://www.aasld.org/practice-guidelines/x", snippet: "s", site_name: "aasld.org" },
    { title: "Forum post", url: "https://www.reddit.com/r/medicine/x", snippet: "s", site_name: "reddit.com" },
    { title: "Healthline", url: "https://www.healthline.com/x", snippet: "s", site_name: "healthline.com" },
    { title: "UNC", url: "https://www.med.unc.edu/x", snippet: "s", site_name: "med.unc.edu" }
  ] }) }; };
  try {
    const r = await tinyfishSearch({ TINYFISH_API_KEY: "k" }, "melena workup");
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes("include_domains="), "first call restricted");
    assert.ok(!calls[1].includes("include_domains="), "second call unrestricted");
    assert.deepEqual(r.map((x) => x.site), ["aasld.org", "med.unc.edu"], "forum and lay sites filtered out; .edu kept");
  } finally { global.fetch = realFetch; }
});
