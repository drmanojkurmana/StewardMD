/* _sse_parse.js — SSE frame parsing for the Gemini streaming transport.
 *
 * WHY THIS FILE EXISTS: the parser used to live inline in functions/api/ai/[[path]].js and split
 * frames on "\n\n". Google's SSE frames are delimited with CRLF ("\r\n\r\n"), which does NOT
 * contain "\n\n" as a substring — the \r sits between the two newlines. So the split never fired,
 * the buffer grew without bound, and NOT ONE delta was ever emitted: the stream closed having sent
 * only {"done":true}. That is the "empty stream / blank answer" that took live streaming down and
 * was wrongly attributed to an upstream fault.
 *
 * Pulled out here so the framing can be unit-tested against both LF and CRLF without importing the
 * whole API handler (and its several dozen dependencies).
 */

/* Split a decoder buffer into complete SSE frames. Returns the complete frames plus the trailing
 * partial frame, which the caller must carry into the next read. Tolerates LF and CRLF. */
export function sseFrames(buf) {
  const frames = String(buf).split(/\r?\n\r?\n/);
  const rest = frames.pop();          // last element is always the incomplete tail ("" if buf ended on a boundary)
  return { frames, rest };
}

/* Extract the generated text from one Gemini SSE frame. Returns "" for keep-alives, comments,
 * [DONE], malformed JSON, and any frame carrying no text part — a bad frame must never break the
 * stream, only contribute nothing. */
export function sseFrameText(frame) {
  const data = String(frame)
    .split(/\r?\n/)
    .filter((l) => l.indexOf("data:") === 0)
    .map((l) => l.slice(5).trim())
    .join("");
  if (!data || data === "[DONE]") return "";
  let j;
  try { j = JSON.parse(data); } catch (e) { return ""; }
  const cand = j.candidates && j.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  return parts ? parts.map((p) => p.text || "").join("") : "";
}
