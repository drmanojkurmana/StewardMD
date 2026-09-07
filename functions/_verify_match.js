/* functions/_verify_match.js — the pure half of doctor verification: which register rows to ask
 * for, and whether a row IS the doctor on the certificate. No Cloudflare bindings, no I/O, so
 * every decision here is unit-tested in node (test/verify-match.test.mjs).
 *
 * WHY THIS FILE EXISTS (reported 2026-09-02: "auto verification works 1/10 of expected"):
 * verify-doctor.js was routing genuine, on-the-register doctors to manual review through four
 * separate decisions, each of which looked reasonable on its own:
 *
 *   1. The live register was queried with the number EXACTLY AS PRINTED ("APMC/FMR/112487/2015").
 *      The register search the app ships to doctors (nmc-search.js) queries the digit core
 *      ("112487") and works. Same service, different question, empty answer.
 *   2. An EMPTY answer from the live register was final. The offline D1 mirror was consulted only
 *      when the register was DOWN, never when it was up and simply did not recognise the form of
 *      the number it was given.
 *   3. Name agreement had no notion of initials. "K MANOJ KUMAR" on a certificate against
 *      "KURMANA MANOJ KUMAR" on the register is the same person; the old rule needed the tokens
 *      to be equal.
 *   4. A register match on BOTH number and name was still sent to manual review whenever Gemini's
 *      self-reported reading confidence was under 0.85. That confidence is uncalibrated and sits at
 *      0.6-0.8 for an ordinary phone photo. The register match is the strong evidence; the model's
 *      opinion of its own OCR is not, once the register has agreed with it.
 *
 * Nothing here can auto-REJECT anyone: every "no" still lands in the owner's manual-review queue
 * with provisional access, exactly as before. What changes is how many genuine doctors get a "yes"
 * without waiting for a human. */
import { regCandidates, regCore } from "./api/_nmc.js";
export { regCandidates, regCore };

/* Honorifics and degree suffixes that appear on certificates and ID cards but are not part of the
 * registered name. Stripped BEFORE comparing, so "DR MANOJ KUMAR KURMANA MBBS MD" and
 * "KURMANA MANOJ KUMAR" compare on the name alone. */
const NOISE = /\b(DR|MR|MRS|MS|MISS|SHRI|SMT|PROF|MBBS|MD|DNB|DM|MCH|BDS|MDS|PHD|FRCS|MRCP|MS)\b\.?/g;

export function normName(s) {
  return String(s || "").toUpperCase()
    .replace(/[^A-Z\s.]/g, " ")   // digits, slashes, commas -> space; keep dots for the noise pass
    .replace(NOISE, " ")
    .replace(/[.]/g, " ")
    .replace(/\s+/g, " ").trim();
}

/* Register records are not shaped consistently: some carry the whole name in firstName, others
 * split it across first/middle/last, and the offline mirror uses `name`. Use whatever is there. */
export function nmcNameOf(r) {
  if (!r) return "";
  return [r.firstName, r.middleName, r.lastName, r.doctorName, r.name]
    .filter((x) => typeof x === "string" && x.trim())
    .join(" ");
}

/* Does the name read off the document agree with the name on the register row?
 *
 * Token-set comparison, order-insensitive (Indian names are printed surname-first on some
 * documents and surname-last on others), with initials honoured in BOTH directions: a single
 * letter matches any word starting with it, and a word matches a single-letter initial. At least
 * 60% of the SMALLER set must match, and at least one full word (3+ letters) must match exactly,
 * so a run of bare initials can never agree with anyone. */
export function nameAgrees(extracted, nmcName) {
  const a = normName(extracted), b = normName(nmcName);
  if (!a || !b) return false;
  if (a.replace(/ /g, "") === b.replace(/ /g, "")) return true;   // "MANOJKUMAR" vs "MANOJ KUMAR"
  const ta = a.split(" "), tb = b.split(" ");
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const largeSet = new Set(large);
  const largeInitials = new Set(large.filter((t) => t.length === 1));
  // "MANOJKUMAR" on one side, "MANOJ KUMAR" on the other: a word that is two of the other side's
  // tokens run together counts as both of them, whichever side printed it joined.
  const joinedOf = (word, toks) => toks.some((x, i) => toks.some((y, j) => i !== j && x + y === word));
  const covered = new Set();
  for (const w of large) for (const x of small) for (const y of small) if (x !== y && x + y === w) { covered.add(x); covered.add(y); }
  let matched = 0, fullWord = false;
  for (const t of small) {
    if (largeSet.has(t) || covered.has(t)) { matched++; if (t.length >= 3) fullWord = true; continue; }
    if (t.length === 1 && large.some((w) => w.length > 1 && w[0] === t)) { matched++; continue; }
    if (t.length > 1 && largeInitials.has(t[0])) { matched++; continue; }
    if (t.length >= 5 && joinedOf(t, large)) { matched++; fullWord = true; continue; }
  }
  const need = Math.max(1, Math.ceil(small.length * 0.6));
  return matched >= need && fullWord;
}

/* Which registrationNo strings to ask the live register for, in order. The digit cores first
 * (longest first - that is the registration number; a 2-digit fragment is noise), then the number
 * exactly as printed in case a council registers it with its prefix. Stop at the first non-empty
 * answer, so the common case is still one round trip. */
export function nmcQueriesFor(effReg) {
  const raw = String(effReg || "").trim();
  const out = [];
  for (const c of regCandidates(raw)) if (c.length >= 3 && out.indexOf(c) < 0) out.push(c);
  if (raw && /\D/.test(raw) && out.indexOf(raw) < 0) out.push(raw);
  return out;
}

/* Does a register row's registration number agree with the one on the document? Any shared digit
 * core of 3+ digits ("112487" inside "APMC/FMR/112487/2015"), or the same digits end to end. */
export function regAgrees(recordRegNo, effReg) {
  const rc = regCandidates(recordRegNo), ec = regCandidates(effReg);
  if (!rc.length || !ec.length) return false;
  if (rc.some((c) => c.length >= 3 && ec.indexOf(c) > -1)) return true;
  const rd = String(recordRegNo || "").replace(/\D/g, ""), ed = String(effReg || "").replace(/\D/g, "");
  if (rd && ed && rd === ed) return true;
  const e = String(effReg || "").trim().toUpperCase();
  return e.length >= 4 && String(recordRegNo || "").toUpperCase().indexOf(e) > -1;
}

const COUNCIL_NOISE = new Set(["MEDICAL", "COUNCIL", "STATE", "OF", "THE", "SMC", "MC", "AND", "&"]);
function councilTokens(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter((t) => t && !COUNCIL_NOISE.has(t));
}
/* "APMC" vs "Andhra Pradesh Medical Council": a shared word, or the short form being the initials
 * of the long form. Used only to PREFER a row, never to reject one - councils are printed in too
 * many forms to be a hard gate. */
export function councilAgrees(a, b) {
  const ta = councilTokens(a), tb = councilTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.some((t) => t.length >= 4 && tb.indexOf(t) > -1)) return true;
  const initials = (toks) => toks.map((t) => t[0]).join("");
  const fullA = String(a || "").toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter(Boolean);
  const fullB = String(b || "").toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter(Boolean);
  const shortA = ta.length === 1 ? ta[0] : "", shortB = tb.length === 1 ? tb[0] : "";
  return !!((shortA && shortA.length >= 3 && initials(fullB).indexOf(shortA) === 0) ||
            (shortB && shortB.length >= 3 && initials(fullA).indexOf(shortB) === 0));
}

/* The register row that IS this doctor, or null. Number AND name must agree. When more than one
 * row agrees (the same number is issued by several state councils), the row whose council matches
 * the one printed on the certificate wins; otherwise the first. */
export function pickMatch(records, effReg, extractedName, extractedCouncil) {
  const rows = Array.isArray(records) ? records : [];
  const hits = rows.filter((r) => r && regAgrees(r.registrationNo, effReg) && nameAgrees(extractedName, nmcNameOf(r)));
  if (!hits.length) return null;
  if (extractedCouncil) { const c = hits.find((r) => councilAgrees(extractedCouncil, r.smcName)); if (c) return c; }
  return hits[0];
}

/* Name-only fallback (behind VERIFY_NAME_ONLY_MATCH): the number could not be read at all, but
 * the name could. Accept only when the register returns EXACTLY ONE row that agrees on the name
 * (and on the council, when one was read) and the name has at least two words. Anything wider
 * than that is a guess, and a guess goes to a human. */
export function uniqueNameMatch(records, extractedName, extractedCouncil) {
  if (normName(extractedName).split(" ").filter((t) => t.length >= 2).length < 2) return null;
  const rows = Array.isArray(records) ? records : [];
  let hits = rows.filter((r) => r && nameAgrees(extractedName, nmcNameOf(r)));
  if (extractedCouncil) {
    const byCouncil = hits.filter((r) => councilAgrees(extractedCouncil, r.smcName));
    if (byCouncil.length) hits = byCouncil;
  }
  return hits.length === 1 ? hits[0] : null;
}

/* Once the register has agreed on number and name, the model's confidence in its own OCR is a
 * sanity floor, not the verdict. 0.5 catches "I could barely read this"; it no longer routes an
 * ordinary phone photo (0.6-0.8) to a human who will only confirm what the register already said. */
export const AUTO_VERIFY_MIN_CONFIDENCE = 0.5;
export function autoVerifyOk(confidence) {
  return !(typeof confidence === "number" && confidence < AUTO_VERIFY_MIN_CONFIDENCE);
}
