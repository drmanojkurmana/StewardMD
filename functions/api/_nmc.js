/* StewardMD — NMC (Indian Medical Register) search helpers (pure, no CF deps; Node-testable).
 * ---------------------------------------------------------------------------
 * Shared by functions/api/nmc-search.js. The live register + D1 mirror return the same row shape
 * (firstName / registrationNo / smcName …); normalizeResults() folds both into a clean, PUBLIC-only
 * subset (name, reg no, council, year, qualification) — never phone/email/Aadhaar/address.
 */
/* NMC rebuilt nmc.org.in (found 2026-10-08): the old POST MCIRest/open/getDataFromService?service=
 * searchDoctor now answers 301 -> 404, so every register lookup "failed" and every verification fell
 * to the offline mirror (and to manual review when the mirror lacked the doctor). The register page now
 * calls GET /indian-medical-register/search?search_type=reg_no|name&reg_no=|name=&page=&per_page=,
 * answering { success, data:[{ registration_no, name, father_name, state_medical_council, year_of_info,
 * qualification, qualification_year, university, removed_status, ... }], pagination }. */
export const NMC_SEARCH = "https://nmc.org.in/indian-medical-register/search";
export const NMC_REFERER = "https://nmc.org.in/information-desk/indian-medical-register";

/* A new-API row in the shape the matchers and normalizeResults() already speak (the old API's field
 * names). removed_status marks a doctor struck off the register: carried as `removed` so no match is
 * ever made on it. */
export function fromNmcRow(r) {
  if (!r) return null;
  return {
    registrationNo: String(r.registration_no || "").trim(),
    firstName: String(r.name || "").replace(/\s+/g, " ").trim(),
    smcName: String(r.state_medical_council || "").trim(),
    yearInfo: r.year_of_info != null ? String(r.year_of_info) : "",
    doctorDegree: r.qualification || "",
    university: r.university || "",
    removed: !!(r.removed_status && String(r.removed_status).trim() && !/^(null|0|no|false)$/i.test(String(r.removed_status).trim())),
  };
}
/* One query to the live register. `q` is { regNo } or { name }. Resolves to mapped rows ([] = it
 * answered and found nobody); THROWS when the register could not be asked (non-2xx, not JSON, timeout)
 * so a caller can tell "down" from "empty". fetchImpl is injectable for tests. */
export async function nmcQuery(q, fetchImpl) {
  const f = fetchImpl || fetch;
  const u = new URL(NMC_SEARCH);
  if (q && q.regNo) { u.searchParams.set("search_type", "reg_no"); u.searchParams.set("reg_no", String(q.regNo)); }
  else { u.searchParams.set("search_type", "name"); u.searchParams.set("name", String((q && q.name) || "")); }
  u.searchParams.set("page", "1"); u.searchParams.set("per_page", "100");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await f(u.toString(), { headers: { "Accept": "application/json", "X-Requested-With": "XMLHttpRequest", "Referer": NMC_REFERER, "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal });
    if (!res.ok) throw new Error("nmc_http_" + res.status);
    const j = await res.json();
    if (!j || j.success === false || !Array.isArray(j.data)) throw new Error("nmc_bad_answer");
    const rows = j.data.map(fromNmcRow).filter(Boolean);
    // more rows exist than came back: a caller looking for "exactly one" must not trust this page
    const total = j.pagination && Number(j.pagination.total);
    rows.truncated = Number.isFinite(total) && total > rows.length;
    return rows;
  } finally { clearTimeout(t); }
}

// A query "looks like a registration number" when it has a 3+ digit run and almost no letters
// (a council prefix like "TN/12345" is fine). Otherwise treat it as a name search.
export function looksLikeReg(q) {
  q = String(q || "").trim();
  if (!/\d{3,}/.test(q)) return false;
  return (q.match(/[a-z]/gi) || []).length <= 4;
}
/* The comparable digit core of a registration number — kept in step with verify-doctor.js.
 * This used to take the LAST digit group, which picks the YEAR off a certificate number such as
 * "APMC/FMR/112487/2015" and makes every register lookup miss. Prefer the longest group, and skip
 * anything that is plainly a year while another candidate exists. */
export function regCandidates(s) {
  const groups = String(s || "").match(/\d{2,}/g) || [];
  if (!groups.length) return [];
  const looksLikeYear = (g) => /^(19|20)\d{2}$/.test(g);
  const nonYear = groups.filter((g) => !looksLikeYear(g));
  const pool = nonYear.length ? nonYear : groups;
  const seen = new Set(), out = [];
  for (const g of pool.slice().sort((a, b) => b.length - a.length)) if (!seen.has(g)) { seen.add(g); out.push(g); }
  return out;
}
export function regCore(s) { const c = regCandidates(s); return c.length ? c[0] : ""; }

// Fold NMC-API or D1 rows → clean, deduped, PUBLIC-only result cards.
export function normalizeResults(rows) {
  const out = [], seen = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r) return;
    const name = [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const regNo = String(r.registrationNo || "").trim();
    if (!name && !regNo) return;
    const key = String(r.doctorId || (regNo + "|" + name));
    if (seen[key]) return; seen[key] = 1;
    const o = { name: name, regNo: regNo, council: String(r.smcName || "").trim() };
    const year = r.yearOfPassing || r.yearInfo;
    if (year) o.year = String(year).trim();
    if (r.doctorDegree) o.degree = String(r.doctorDegree).replace(/\s+/g, " ").trim();
    if (r.university) o.university = String(r.university).replace(/\s+/g, " ").trim();
    out.push(o);
  });
  return out;
}
