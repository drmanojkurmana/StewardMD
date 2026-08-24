/* test/maik-sse-framing.test.mjs — regression guard for the live-streaming outage.
 *
 * MAIK_LIVE_STREAM=1 was enabled and production answers came back blank. It was attributed to an
 * upstream Gemini fault ("zero-byte SSE body"). It was not: the frame splitter used "\n\n", and
 * Google delimits SSE frames with "\r\n\r\n". "\r\n\r\n" does not contain "\n\n" — so no frame ever
 * completed, no delta was ever emitted, and the stream closed with only {"done":true}.
 *
 * The first test below is the one that would have caught it.
 *
 * node --test test/maik-sse-framing.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sseFrames, sseFrameText } from "../functions/_sse_parse.js";

const frame = (obj) => "data: " + JSON.stringify(obj);
const chunk = (text) => frame({ candidates: [{ content: { parts: [{ text }] } }] });

/* Drive the parser the way streamGeminiToSSE does: accumulate, split, emit. */
function collect(wireText, readSize) {
  let buf = "", out = "";
  for (let i = 0; i < wireText.length; i += readSize) {
    buf += wireText.slice(i, i + readSize);
    const { frames, rest } = sseFrames(buf);
    buf = rest;
    for (const f of frames) out += sseFrameText(f);
  }
  return out;
}

test("CRLF-delimited frames still yield deltas — the bug that blanked live streaming", () => {
  const wire = chunk("Paracetamol ") + "\r\n\r\n" + chunk("1g QDS.") + "\r\n\r\n";
  // The old splitter (buf.split("\n\n")) returns zero frames here — assert we are not that.
  assert.equal(wire.split("\n\n").length - 1, 0, "precondition: CRLF wire contains no bare \\n\\n");
  assert.equal(collect(wire, 4096), "Paracetamol 1g QDS.");
});

test("LF-delimited frames keep working (the format we assumed)", () => {
  const wire = chunk("Amoxicillin ") + "\n\n" + chunk("500mg TDS.") + "\n\n";
  assert.equal(collect(wire, 4096), "Amoxicillin 500mg TDS.");
});

test("a frame split across reads is not lost or duplicated", () => {
  const wire = chunk("Ceftriaxone ") + "\r\n\r\n" + chunk("2g OD.") + "\r\n\r\n";
  for (const size of [1, 3, 7, 50]) {
    assert.equal(collect(wire, size), "Ceftriaxone 2g OD.", `byte-wise read size ${size}`);
  }
});

test("a partial trailing frame is carried, not emitted", () => {
  const { frames, rest } = sseFrames(chunk("full") + "\r\n\r\n" + chunk("partial"));
  assert.equal(frames.length, 1);
  assert.equal(sseFrameText(frames[0]), "full");
  assert.match(rest, /partial/, "the incomplete tail must be carried into the next read");
});

test("SAFETY: a malformed frame contributes nothing and never throws", () => {
  assert.equal(sseFrameText("data: {not json"), "");
  assert.equal(sseFrameText("data: [DONE]"), "");
  assert.equal(sseFrameText(": keep-alive comment"), "");
  assert.equal(sseFrameText(""), "");
  assert.equal(sseFrameText(frame({ candidates: [{ finishReason: "STOP" }] })), "", "no text part");
});

test("multi-line data: fields in one frame are concatenated", () => {
  const j = JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
  const split = "data: " + j.slice(0, 10) + "\r\ndata: " + j.slice(10);
  assert.equal(sseFrameText(split), "ok");
});
