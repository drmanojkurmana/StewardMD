/* StewardMD — web-search enrichment (TinyFish).
 *
 * Shared by the admin AI push box (manual publish) and the daily crawler pipeline, so both can turn
 * a thin headline or a bare drug/guideline name into rich, authoritative context (prescribing info,
 * indications, doses, official links) before the Gemini summarizer runs.
 *
 * Key is a Cloudflare secret (env.TINYFISH_API_KEY) — never hardcoded. Best-effort: no key, or any
 * network/parse error, returns [] and the caller proceeds without enrichment. Never throws.
 */
export async function tinyfishSearch(env, query) {
  const key = env && env.TINYFISH_API_KEY;
  if (!key || !query) return [];
  try {
    const r = await fetch("https://api.search.tinyfish.ai?query=" + encodeURIComponent(String(query).slice(0, 300)), {
      headers: { "X-API-Key": key },
      redirect: "follow",
    });
    if (!r.ok) return [];
    const j = await r.json();
    return ((j && j.results) || []).slice(0, 8).map((x) => ({
      title: String(x.title || "").slice(0, 200),
      snippet: String(x.snippet || "").slice(0, 400),
      url: String(x.url || "").slice(0, 500),
      site: String(x.site_name || "").slice(0, 120),
    })).filter((x) => x.title || x.snippet);
  } catch (e) { return []; }
}
