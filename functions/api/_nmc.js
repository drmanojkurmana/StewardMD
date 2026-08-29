/* StewardMD — NMC (Indian Medical Register) search helpers (pure, no CF deps; Node-testable).
 * ---------------------------------------------------------------------------
 * Shared by functions/api/nmc-search.js. The live register + D1 mirror return the same row shape
 * (firstName / registrationNo / smcName …); normalizeResults() folds both into a clean, PUBLIC-only
 * subset (name, reg no, council, year, qualification) — never phone/email/Aadhaar/address.
 */
export const NMC_SEARCH = "https://www.nmc.org.in/MCIRest/open/getDataFromService?service=searchDoctor";
export const NMC_REFERER = "https://www.nmc.org.in/information-desk/indian-medical-register/";

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
