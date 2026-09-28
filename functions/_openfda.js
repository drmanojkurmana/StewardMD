/* StewardMD - Medical Updates: openFDA fetcher for NEW drug approvals (not label revisions).
 *
 * drug/drugsfda lists applications with their submissions. openFDA's search cannot require that the ORIG
 * type, the AP status and the date sit on the SAME submission (it returned a 2022 approval for a 2026
 * window when a later supplement matched), so the query only narrows the set and the exact rule is applied
 * here: an NDA or BLA whose ORIGINAL submission was APPROVED inside the window. ANDAs (generics) are
 * excluded. NDA review classes kept: TYPE 1 (new molecular entity), TYPE 2 (new active ingredient),
 * TYPE 4 (new combination); every BLA is kept (biologic class codes are often blank).
 * For each approval, drug/label gives the indication text the summary is written from.
 *
 * No key needed (openFDA allows 240 requests a minute and 1,000 a day per IP); env.OPENFDA_API_KEY raises it.
 * A run makes at most MAX_PAGES + one label call per new approval.
 */
const BASE = "https://api.fda.gov/drug/";
const UA = "StewardMD/1.0 (+https://stewardmd.in)";
const PAGE = 100, MAX_PAGES = 6;
const NDA_CLASSES = ["TYPE 1", "TYPE 2", "TYPE 4"];

function ymd(ts) { return new Date(ts).toISOString().slice(0, 10).replace(/-/g, ""); }
function tsOf(s) { return /^\d{8}$/.test(s || "") ? Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) : 0; }
function https(u) { return String(u || "").replace(/^http:\/\/(www\.)?accessdata\.fda\.gov\//i, "https://www.accessdata.fda.gov/"); }
function key(env) { return env && env.OPENFDA_API_KEY ? "&api_key=" + encodeURIComponent(env.OPENFDA_API_KEY) : ""; }
function one(a) { return Array.isArray(a) && a.length ? String(a[0]) : ""; }
function title(s) { return String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()); }

/** Pure: pick new approvals out of drugsfda results. Exported for tests. */
export function selectNewApprovals(results, fromYmd, toYmd) {
  const out = [];
  for (const r of results || []) {
    const an = String(r.application_number || "");
    const isBla = an.indexOf("BLA") === 0, isNda = an.indexOf("NDA") === 0;
    if (!isBla && !isNda) continue;
    const orig = (r.submissions || []).find((s) => s.submission_type === "ORIG" && s.submission_status === "AP" &&
      String(s.submission_status_date || "") >= fromYmd && String(s.submission_status_date || "") <= toYmd);
    if (!orig) continue;
    if (isNda && NDA_CLASSES.indexOf(String(orig.submission_class_code || "")) < 0) continue;
    const of = r.openfda || {};
    const prod = (r.products || [])[0] || {};
    const brand = one(of.brand_name) || prod.brand_name || "";
    const generic = Array.from(new Set(String(one(of.generic_name) || (prod.active_ingredients || []).map((a) => a.name).join(", "))
      .split(/\s*,\s*/).map((x) => x.trim().toLowerCase()).filter(Boolean))).join(", ");
    if (!brand && !generic) continue;
    const docs = orig.application_docs || [];
    const letter = docs.find((d) => /letter/i.test(d.type || "")), label = docs.find((d) => /label/i.test(d.type || ""));
    const applNo = an.replace(/^\D+/, "");
    out.push({
      application: an, brand, generic, sponsor: r.sponsor_name || "", date: orig.submission_status_date,
      classCode: orig.submission_class_code || (isBla ? "BLA" : ""), classDesc: orig.submission_class_code_description || "",
      pharmClass: one(of.pharm_class_epc), route: one(of.route) || (prod.route || ""), form: prod.dosage_form || "",
      url: https((letter || label || {}).url) || "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=" + applNo,
      labelUrl: https((label || {}).url),
    });
  }
  return out;
}

async function getJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (r.status === 404) return { results: [] };                       // openFDA answers 404 for "no matches"
  if (!r.ok) throw new Error("openFDA HTTP " + r.status);
  return r.json();
}

/**
 * fetchOpenFdaApprovals(opts) -> [{ docKey, title, abstract, url, ts, application, ... }]
 * opts: { days (default 14), now, env }. Newest first.
 */
export async function fetchOpenFdaApprovals(opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const days = Math.max(1, Math.min(90, opts.days || 14));
  const from = ymd(now - days * 86400000), to = ymd(now);
  const search = 'submissions.submission_type:"ORIG"+AND+submissions.submission_status:"AP"+AND+submissions.submission_status_date:[' + from + "+TO+" + to + "]";
  let found = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const d = await getJson(BASE + "drugsfda.json?search=" + search + "&limit=" + PAGE + "&skip=" + page * PAGE + key(opts.env));
    const res = d.results || [];
    found = found.concat(selectNewApprovals(res, from, to));
    const total = (((d.meta || {}).results || {}).total) || 0;
    if (res.length < PAGE || (page + 1) * PAGE >= total) break;
  }
  const seen = new Set(), out = [];
  for (const a of found) {
    if (seen.has(a.application)) continue;
    seen.add(a.application);
    let indication = "";
    try {
      const l = await getJson(BASE + 'label.json?search=openfda.application_number:"' + a.application + '"&limit=1' + key(opts.env));
      indication = one(((l.results || [])[0] || {}).indications_and_usage).replace(/^\s*\d*\s*INDICATIONS\s*(AND|&)\s*USAGE\s*/i, "").slice(0, 3000);
    } catch (e) {}
    const name = title(a.brand) + (a.generic ? " (" + a.generic + ")" : "");
    const facts = [
      "FDA approval of a new " + (a.application.indexOf("BLA") === 0 ? "biologic" : "drug application") + ": " + name + ".",
      "Application " + a.application + ", sponsor " + a.sponsor + ", approved " + a.date.slice(0, 4) + "-" + a.date.slice(4, 6) + "-" + a.date.slice(6, 8) + ".",
      a.classDesc ? "FDA review class: " + a.classDesc + "." : "",
      a.pharmClass ? "Established pharmacologic class: " + a.pharmClass + "." : "",
      a.route || a.form ? "Route and form: " + [a.route, a.form].filter(Boolean).join(", ").toLowerCase() + "." : "",
      indication ? "Indications and usage (FDA label): " + indication : "Indication not yet in openFDA; see the approval letter.",
    ].filter(Boolean).join(" ");
    out.push(Object.assign({}, a, {
      docKey: "fda:" + a.application, title: "FDA approves " + name, abstract: facts,
      url: a.url, ts: tsOf(a.date) || now, doi: "", pmid: "",
    }));
  }
  return out.sort((x, y) => y.ts - x.ts);
}
