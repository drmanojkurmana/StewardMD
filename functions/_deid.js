/* functions/_deid.js - strip identifier-like content from free text before it leaves our servers
 * (third-party search) or is stored (feedback). Shared by /api/ai/research, /figures, /evidence
 * and /api/maik-feedback.
 *
 * A clinical QUESTION is not itself PHI, but doctors paste things like "bed 12 UHID 4481123 ramesh
 * 45M with sepsis". Nothing a search or a feedback log needs survives this: a medical topic has no
 * 4+ digit numbers, no emails, no phone numbers and no hospital registration tokens.
 *
 * Removes: everything after "patient name"; email addresses; MRN / UHID / IP no / IPD / OP no /
 * reg no / bed N / ward N tokens with their value; phone numbers (+91 and grouped forms); and any
 * remaining run of 4+ digits. Short numbers (doses, ages, "2 days") are kept on purpose.
 */
export function stripIdentifiers(s) {
  return String(s == null ? "" : s)
    .replace(/\bpatient(?:'s)?\s*name\b[\s\S]*$/i, " ")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ")
    .replace(/\b(?:mrn|uhid|cr\s*no|ipd?\s*(?:no|number|num)|op\s*(?:no|number)|reg(?:istration)?\s*(?:no|number)|bed(?:\s*(?:no|number))?|ward(?:\s*(?:no|number))?)\b\.?\s*[:#-]?\s*[a-z]*\d[\w\/-]*/gi, " ")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => (m.replace(/\D/g, "").length >= 8 ? " " : m))
    .replace(/\d{4,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
