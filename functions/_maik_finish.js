/* MaiK answer integrity helpers (owner, 2026-10-10: "Maik cloud not giving full answer and on pressing know
 * more it again gave this" - the answer stopped at "| Diagnosis/Option | Distinguishing Features" and the
 * detail repeated the same opening, stopping at the same place).
 *
 * Two things the explain handler used to do nothing about:
 *   1. Gemini reports WHY it stopped (candidates[0].finishReason). Anything but STOP is an answer that was
 *      cut: MAX_TOKENS (budget), SAFETY / PROHIBITED_CONTENT / BLOCKLIST (a content filter), RECITATION
 *      (copied text), OTHER. The handler served the partial text as if it were whole. finishAnalysis says
 *      what happened and whether one retry is worth paying for.
 *   2. The tier-2 "Know more" call is told to give ONLY the detail, and a model that ignores that restates
 *      the lead. dropRepeatedLead removes leading paragraphs the clinician has already read.
 * Pure functions, no I/O, so they are unit-tested directly (test/maik-finish.test.mjs).
 */

/* finishReason -> what the handler should do. `cut` = the text is incomplete. `retry` = one more attempt
 * may help (a different sample avoids RECITATION; a bigger budget fixes MAX_TOKENS). A content-filter stop
 * is retried once too, because the filter often trips on one sample and not the next. */
export function finishAnalysis(finishReason) {
  const f = String(finishReason || "").toUpperCase();
  if (!f || f === "STOP" || f === "FINISH_REASON_UNSPECIFIED") return { cut: false, retry: false, kind: "ok" };
  if (f === "MAX_TOKENS") return { cut: true, retry: true, kind: "length", moreTokens: true };
  if (f === "RECITATION") return { cut: true, retry: true, kind: "recitation" };
  if (/SAFETY|PROHIBITED|BLOCKLIST|SPII|IMAGE_SAFETY/.test(f)) return { cut: true, retry: true, kind: "filter" };
  return { cut: true, retry: true, kind: "other" };
}

/* The model said STOP but the text plainly was not finished: it ends on a markdown table header or a row that
 * was never closed (owner screenshot: "| Diagnosis/Option | Distinguishing Features" and nothing after it).
 * A real table always has a separator row ("|---|---|") right after its header. */
export function looksCutOff(text) {
  const lines = String(text || "").replace(/\s+$/, "").split("\n");
  const last = (lines[lines.length - 1] || "").trim();
  if (!last || last.charAt(0) !== "|") return false;
  if (last.charAt(last.length - 1) !== "|") return true;                      // a row cut mid-cell
  const hasSep = lines.some(function (l) { return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l); });
  return !hasSep && lines.filter(function (l) { return l.trim().charAt(0) === "|"; }).length === 1;   // just a header, no body
}

/* Pick the better of two attempts at the same answer: complete beats cut, then longer beats shorter. */
export function betterAttempt(a, b) {
  const ca = finishAnalysis(a.finish).cut || looksCutOff(a.text), cb = finishAnalysis(b.finish).cut || looksCutOff(b.text);
  if (ca !== cb) return ca ? b : a;
  return String(b.text || "").length > String(a.text || "").length ? b : a;
}

const norm = (s) => String(s || "").toLowerCase().replace(/[*_`#>|]/g, " ").replace(/\s+/g, " ").trim();

/* Remove the leading paragraphs of a tier-2 answer that merely restate what the clinician already has.
 * A paragraph counts as a repeat when its first 50 normalised characters occur in the lead, or when it is
 * the lead's own opening. Stops at the first paragraph that is genuinely new, so nothing after it is touched.
 * If everything would be removed the text is returned unchanged: a cut answer is better than a blank one. */
export function dropRepeatedLead(text, priorLead) {
  const lead = norm(priorLead);
  if (!lead || !text) return text;
  const blocks = String(text).split(/\n{2,}/);
  let i = 0;
  while (i < blocks.length) {
    const b = norm(blocks[i]);
    if (!b) { i++; continue; }
    const head = b.slice(0, 50);
    const repeat = (head.length >= 12 && lead.indexOf(head) >= 0) || (b.length >= 12 && lead.indexOf(b) >= 0) || (lead.length >= 12 && b.indexOf(lead.slice(0, Math.min(lead.length, 80))) === 0);
    if (!repeat) break;
    i++;
  }
  if (i === 0 || i >= blocks.length) return text;
  return blocks.slice(i).join("\n\n").replace(/^\s+/, "");
}
