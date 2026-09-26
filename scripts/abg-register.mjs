#!/usr/bin/env node
/* StewardMD - build the antibiogram census register (data/antibiogram/register.json).
 *
 * Input:  data/antibiogram/census/<slice>.json   what each census search found (one entry per
 *         document: institution, url, page, status, why not downloaded), written during the
 *         census; data/antibiogram/census/overrides.json   the lead's decisions per document
 *         ({id: {integrated?: "<source id>", reason?: "..."}}) for documents that were
 *         downloaded but are not (or not yet) a source, and for merged ids.
 * Output: data/antibiogram/register.json   [{id, institution, short, city, state, region, sector,
 *         type, year, period, url, page, status, integrated, reason, found_via}]
 *         data/antibiogram/census/summary.json   {documents, integrated, websites, pagesCrawled,
 *         searches, navigations}: how wide the search was, shown in the Sources tab
 * A document is "integrated" when a source file of that id exists (or an override names the
 * source it went into). Every other entry carries the reason, which the Sources tab shows.
 *
 *   node scripts/abg-register.mjs          write the register
 *   node scripts/abg-register.mjs --check  fail if it is stale
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CENSUS = join(ROOT, "data", "antibiogram", "census");
const SOURCES = join(ROOT, "data", "antibiogram", "sources");
const OUT = join(ROOT, "data", "antibiogram", "register.json");

const STATUS_REASON = {
  "404": "the link is dead (HTTP 404)",
  "reset": "the website refused the connection from our network",
  "blocked-403": "the website blocked automated access (HTTP 403)",
  "login-required": "behind a login",
  "not-an-antibiogram": "checked: no susceptibility tables (a policy, advisory or plan)",
  "policy-without-antibiogram": "checked: an antibiotic policy without an antibiogram",
  "not-downloaded-journal": "a journal article, not an institution's antibiogram; not integrated",
  "not-downloaded": "recorded, not downloaded",
  "record-only": "recorded for reference (outside the scope of Indian institution antibiograms)",
  "timeout": "the website did not respond",
  "js-challenge": "the website requires a browser challenge"
};

export function buildRegister() {
  const files = existsSync(CENSUS) ? readdirSync(CENSUS).filter((f) => f.endsWith(".json") && !/queries|crawled|checked|sites|overrides|summary/.test(f)).sort() : [];
  const over = existsSync(join(CENSUS, "overrides.json")) ? JSON.parse(readFileSync(join(CENSUS, "overrides.json"), "utf8")) : {};
  const have = new Set(existsSync(SOURCES) ? readdirSync(SOURCES).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : []);
  const seen = new Map();
  files.forEach((f) => {
    const list = JSON.parse(readFileSync(join(CENSUS, f), "utf8"));
    (Array.isArray(list) ? list : []).forEach((x) => {
      if (!x || typeof x !== "object" || !x.id || x.type === "meta" || /^_/.test(x.id)) return;
      if (x.duplicate_of) return;                                  // the same document under another slice's id
      const o = over[x.id] || {};
      const integrated = o.integrated || (have.has(x.id) ? x.id : null);
      let reason = null;
      if (!integrated) reason = o.reason || STATUS_REASON[x.status] || (x.status === "downloaded" ? "downloaded; not yet extracted" : (x.status || "not integrated"));
      const e = {
        id: x.id, institution: x.institution || null, short: x.short || null, city: x.city || null, state: x.state || null,
        region: x.region || null, sector: x.sector || null, type: x.type || null, year: Number.isInteger(x.year) ? x.year : (parseInt(x.year, 10) || null),
        period: x.period || null, url: x.url || null, page: x.page || null, status: x.status || null, integrated, reason,
        found_via: x.found_via || null, slice: f.replace(/\.json$/, "")
      };
      if (!seen.has(e.id) || (integrated && !seen.get(e.id).integrated)) seen.set(e.id, e);
    });
  });
  return Array.from(seen.values()).sort((a, b) => (a.region || "").localeCompare(b.region || "") || (a.institution || "").localeCompare(b.institution || "") || (b.year || 0) - (a.year || 0));
}

/* How wide the census was: websites checked (crawled or looked at), pages crawled, web searches
 * and site navigations logged by the census agents. Counted from the census logs, so "at least". */
export function censusSummary(reg) {
  const domains = new Set(); let pages = 0, searches = 0, navigations = 0;
  const host = (u) => { try { return new URL(/^https?:/.test(u) ? u : "https://" + u).hostname.replace(/^www\./, ""); } catch (e) { return null; } };
  const countLine = (t) => {
    const x = String(t || "").trim();
    if (/^(WS|WebSearch)\b/i.test(x) && !/NOT RUN|budget exhausted|refused/i.test(x)) searches++;
    else if (/^(NAV|Site search|Navigation|Wayback)\b/i.test(x)) navigations++;
  };
  if (existsSync(CENSUS)) readdirSync(CENSUS).sort().forEach((f) => {
    const full = join(CENSUS, f);
    if (f.endsWith(".txt")) { readFileSync(full, "utf8").split(/\r?\n/).forEach(countLine); return; }
    if (!f.endsWith(".json") || f === "overrides.json" || f === "summary.json") return;
    let j; try { j = JSON.parse(readFileSync(full, "utf8")); } catch (e) { return; }
    if (/crawled/.test(f) && Array.isArray(j)) { j.forEach((x) => { if (x && x.reachable) { const h = host(x.seed); if (h) domains.add(h); pages += x.pages_crawled || 0; } }); return; }
    if (/checked|sites/.test(f) && Array.isArray(j)) { j.forEach((x) => { const h = x && (x.domain ? host(x.domain) : x.url ? host(x.url) : x.site ? host(x.site) : x.seed ? host(x.seed) : null); if (h) domains.add(h); }); return; }
    if (/queries/.test(f)) {
      if (Array.isArray(j)) j.forEach(countLine);
      else if (j && typeof j === "object") Object.keys(j).forEach((k) => {
        if (!Array.isArray(j[k])) return;
        if (/not_run|refused|exhausted/i.test(k)) return;
        if (/websearch/i.test(k)) searches += j[k].length; else if (/nav/i.test(k)) navigations += j[k].length; else j[k].forEach(countLine);
      });
      return;
    }
    if (Array.isArray(j)) j.forEach((x) => {
      if (!x || typeof x !== "object") return;
      if (x.url) { const h = host(x.url); if (h) domains.add(h); }
      if (x.page) { const m = /https?:\/\/[^\s;,)]+/.exec(String(x.page)); const h = m && host(m[0]); if (h) domains.add(h); }
      (x.queries || []).forEach(countLine);
    });
  });
  const integrated = reg.filter((x) => x.integrated).length;
  return { documents: reg.length, integrated, websites: domains.size, pagesCrawled: pages, searches, navigations };
}

function main() {
  const reg = buildRegister(), text = JSON.stringify(reg, null, 1) + "\n";
  const sum = JSON.stringify(censusSummary(reg), null, 1) + "\n", SUM = join(CENSUS, "summary.json");
  const stale = !existsSync(OUT) || readFileSync(OUT, "utf8") !== text || !existsSync(SUM) || readFileSync(SUM, "utf8") !== sum;
  const n = reg.length, integ = reg.filter((x) => x.integrated).length;
  if (process.argv.includes("--check")) {
    if (stale) { console.error("Stale: data/antibiogram/register.json. Run: node scripts/abg-register.mjs"); process.exit(1); }
    console.log(`OK: register ${n} documents, ${integ} integrated`); return;
  }
  writeFileSync(OUT, text); writeFileSync(SUM, sum);
  const why = {}; reg.filter((x) => !x.integrated).forEach((x) => { why[x.reason] = (why[x.reason] || 0) + 1; });
  console.log(`Wrote data/antibiogram/register.json: ${n} documents, ${integ} integrated.\n` + Object.keys(why).sort((a, b) => why[b] - why[a]).map((r) => `  ${why[r]}  ${r}`).join("\n"));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
