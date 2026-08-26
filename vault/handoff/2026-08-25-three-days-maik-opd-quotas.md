---
tags: [handoff]
---
# Handoff — 23-25 Aug 2026: MaiK latency/streaming, OPD, quotas

Written because work keeps being lost when a session is closed or cleared. This is the
session-spanning record: what shipped, WHERE it lives, what is still open, and what must be
reverted. 136 non-merge commits landed in this window across several parallel sessions.

**Scope note, so this is not mistaken for more than it is:** the MaiK latency/streaming/quota
sections below are first-hand — measured, with the numbers reproducible. The "other workstreams"
section is summarised FROM THE COMMIT LOG only; treat those as pointers to read the commits, not
as verified descriptions.

---

## 1. MaiK latency + streaming (the largest thread)

Full reasoning is in [[Decisions]] under *2026-08-24 — MaiK latency: the model was never the main
problem*. Short version, all measured on a physical iPhone or on production:

| stage | before | after |
|---|---|---|
| head — request entry to answer path | 1112ms | 12ms |
| pre-Gemini — quota gate, re-rank, prompt | 409ms | 76ms |
| Gemini first token | ~1900ms | unchanged |
| transport (real network) | ~92ms | ~92ms |
| **non-model overhead** | **~1613ms** | **~230ms** |

Device benchmark, 128 requests: TTFV **p50 3672ms → 2333ms**; drug 1604ms, rx-malaria 1437ms.
126/126 streamed. Errors 4/31 → 2/128, then 0/24 after the deadline fix.

**The four things that actually mattered**

1. **The SSE frame splitter was broken.** `buf.split("\n\n")` never matched, because Google
   delimits frames with `\r\n\r\n`. Zero deltas were ever emitted — this was the "blank answer"
   streaming outage, and it was thirty characters of our own code, not an upstream fault.
   Parser lives in `functions/_sse_parse.js` so the framing is unit-testable.
2. **Native cannot stream over fetch.** `CapacitorHttp` buffers, and `CapacitorWebFetch` IGNORES
   `AbortController`, so the watchdog could not even abort it — the app sat to a 25s deadline then
   refetched: 26.6s measured on device. Native now streams over the **pristine XHR**
   (`window.CapacitorWebXMLHttpRequest.fullObject`), whose `abort()` genuinely works.
3. **KV WRITES were the dead weight, not the model.** A KV write costs ~380ms here.
   `recordAiUsage` (admin rollup, gates nothing) was awaited in front of every answer at 1096ms;
   `checkQuota`'s rate-limit slot write was another ~380ms. Both now run via `waitUntil`.
4. **The router was the single biggest wait.** `/api/ai/refine` costs 6.0-7.7s and ran SERIALLY
   before every new question. Now cached server-side (7.695s → 1.557s) and warmed on a typing
   pause in the composer.

**Two conclusions recorded so they are not re-litigated:**
- **Vertex context caching was declined ON EVIDENCE.** +6000 prompt tokens cost only ~356ms of
  TTFT, so the entire 2,338-token system prompt is ~140ms of ~1900ms.
- **`gemini-2.5-flash` stays.** `gemini-3.1-flash-lite` BROKE live streaming outright;
  `gemini-2.5-flash-lite` gave ~200ms better TTFT but longer answers, making TOTAL latency worse.

**Reliability:** the streaming path had NO timeout anywhere (a 196-SECOND hang was measured).
Now bounded connect 10s / idle 10s / total 25s, through one exit that always emits a done event.
A deadline-closed stream carries `stalled:true` and the client refuses to surface it — otherwise
the clean close would present a TRUNCATED CLINICAL ANSWER as complete.

**Observability that now exists** — the stream's done event reports `headMs`, `preMs`,
`firstTokMs`, `totalMs`, `model`, and sub-stage marks. Use it before optimising anything; every
guess made in this session WITHOUT it was wrong, including a 1.2s "network latency" that turned
out to be 92ms.

**How to measure on the phone**, because laptop numbers lie: `test/device/maik-bench.html` runs
inside the real WKWebView via a throwaway build (copy it over `ios/App/App/public/index.html`, set
`loggingBehavior: "debug"`, build, then `devicectl device process launch --console`). Its control
arm uses the PATCHED `window.fetch` and reliably shows `ttfv == total`, proving on-device that
CapacitorHttp buffers.

## 2. Quota / identity correctness

- **Owners are no longer capped by a limit meant for regular users.** `checkQuota` already exempted
  them; `gateAndCount` did not. Now takes `ownerExempt` (same `ownerOK`), skipping the per-module
  and per-user cost caps — but still METERED, and the project-wide cost breaker exempts nobody.
- **Guest identity is now per DEVICE, falling back to IP.** It was `ip:<hash>`, so everyone behind
  one NAT shared ONE 15/day bucket — on Indian carrier-grade NAT that can be thousands of
  subscribers, where one heavy guest locks out the rest. Now `dev:<sha256(X-SMD-Device)>` first.
  Trade-off: a device id is client-supplied and resets on reinstall, which is what the 300/day
  device cap and the cost breaker are there to backstop.

**Gotcha worth remembering:** `aiHeaders()` attaches `Authorization` only when a CACHED id token
exists — it deliberately never calls `getIdToken()`. **Reinstalling the app wipes that cache**, so
a signed-in user silently becomes a guest until they sign in again. This cost real debugging time.

## 3. Other workstreams in the window (from the commit log — read the commits)

- **CliniX** (39 commits): visual asset gaps filled, video playback fixes (inline allow-list;
  silent fallback to external YouTube), tutor latency (skip reranker round trip), MaiK Viva
  Examiner server route.
- **ICU** (9 commits).
- **SURGX** — Surgical Intelligence MVP, five sections/one engine, plus real-device polish.
- **OncoTree** — a trastuzumab regimen was wired into three HER2-NEGATIVE breast nodes (worth
  knowing about); wave-2 vertical routing tests; `smd_onco_protolib` re-opened by owner decision.
- **OPD** — ABDM-ready check-in sheet for app + console, an MR allocator that cannot collide,
  front desk working in the app, pharmacy/HR roles + cashier, console→app sync (IST day split).
- **MaiK Scribe / Ask** — iOS Whisper Telugu mojibake root cause (decode segment bytes ONCE),
  measured VAD threshold, interview pipelining. See [[MaiK Scribe]] and [[MaiK Ask]].
- **OTA updates** Phases 1-2, Razorpay checkout, Profile page, Android WhisperPlugin registration.

## 4. OPEN — nothing here is done

- **TTFV p50 is 2333ms, not the ≤2s target.** Gemini's own first token (0.8-2.8s) is now
  essentially the entire wait. Going lower needs a faster model tier or provisioned Vertex
  capacity — an INFRASTRUCTURE decision, deliberately not taken unilaterally.
- ~~**The MaiK answer cache writes nothing.**~~ **RESOLVED 2026-08-26** — the block sat below the
  live-stream early return in `/explain`, so with `MAIK_LIVE_STREAM` on the handler returned the SSE
  response without ever reading or writing it. Your instinct was right: not the KV binding. See
  [[Decisions]]. Still empty in prod until the fix DEPLOYS (push to `main`).
- **2 pre-existing failures in `functions/_research.test.mjs`** — verified pre-existing by running
  them against the pre-change file, where they fail identically. Not caused by this window's work.
- The Gemini `streamGenerateContent?alt=sse` staging probe (`test/staging/gemini-sse-probe.js`) was
  committed but never run; the outage it was written for turned out to be our own parser.

## 5. MUST REVERT — temporary values left in production

- **`MAIK_GUEST_DAILY_LIMIT` is 300**, raised for device testing. Put back to **15**:
  `printf '15' | npx wrangler pages secret put MAIK_GUEST_DAILY_LIMIT --project-name stewardmd`
  then redeploy. (Safer to restore now that guests are bucketed per device.)
- **KV `ai:limits` = `{"maik":500}`** — this one is INTENTIONAL and predates the benchmarking;
  deleting it drops the MaiK module cap to the 50/day default and blocks the owner's own testing.
  Do not "clean it up" again.
