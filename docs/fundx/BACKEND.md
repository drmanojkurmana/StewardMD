# FundX AI Backend — Cloudflare Pages Functions

Production backend for FundX retinal inference + clinical reasoning. The app talks **only**
to these endpoints; provider-specific logic and all credentials stay server-side.

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/fundx/vision` | `{ image, metrics?, ctx? }` | `{ findings: RetinalFindings }` |
| POST | `/api/fundx/clinical` | `{ findings, patient? }` | `{ assessment: ClinicalAssessment }` |
| GET | `/api/fundx/health` | — | `{ ok, providers[], visionOrder, clinicalOrder, model }` |

`image` is a data URL or bare base64 JPEG/PNG/WebP. Responses match the app's existing Vision
and Clinical interfaces exactly (versioned `schemaVersion`), so the app's provider layer
consumes them unchanged.

## Architecture

```
app ──HTTPS──> functions/api/fundx/[[path]].js  (auth · CORS · rate-limit · validate · route)
                         │
                         └─> functions/_fundx_ai.js  (provider abstraction + transport)
                                   ├─ vertex     (Gemini, WIF keyless — vision + text)
                                   ├─ developer  (AI Studio key — vision + text, dev/failover)
                                   └─ cerebras   (API key — text/clinical)
```

- **No keys to the client.** All provider auth is server-side. Vertex uses keyless Workload
  Identity Federation (self-signed OIDC JWT → Google STS → IAM Credentials access token) —
  the same secrets MaiK already uses.
- **Auth.** Same gate as MaiK/GHIS: Cf-Access email, `X-App-Token` (`FUNDX_APP_TOKEN` /
  `AI_APP_TOKEN` / `GHIS_APP_TOKEN`), or an allowed Origin (stewardmd.in + the native app's
  `capacitor://localhost` + same-origin empty Origin).
- **Rate limiting.** Server-derived identity (Firebase ID token / Cf-Access / hashed IP via
  `_usage.js`), KV-backed (reuses `MAIK_KV`), namespaced apart from MaiK counters:
  min-interval (`FUNDX_RATE_LIMIT_SECONDS`) + per-identity daily cap (`FUNDX_DAILY_LIMIT`).
  Fails **open** if no KV is bound.
- **Robustness.** Request + response validation, JSON extraction (tolerates code fences /
  prose), output normalization to the schema, per-provider timeout (`FUNDX_TIMEOUT_MS`),
  Vertex retry-once → developer failover, structured JSON logging (no PHI / no secrets),
  typed error responses (`{error, code}` + HTTP status).
- **Provider abstraction.** Add a provider by extending `PROVIDERS` in `_fundx_ai.js`
  (`{name, modalities, available(env), generate(env, req, opts)}`) and the selection order
  helpers. No app or router change.

## Environment variables

Set as Cloudflare **Pages** env vars / secrets (Dashboard → Settings → Environment variables,
or `wrangler pages secret put <NAME>`). Locally, put them in `.dev.vars` (see
`.dev.vars.example`; gitignored).

| Name | Kind | Notes |
|---|---|---|
| `FUNDX_AI_PROVIDER` | var | `vertex` (default) \| `developer` \| `cerebras` |
| `FUNDX_VISION_PROVIDER` / `FUNDX_CLINICAL_PROVIDER` | var | optional per-task overrides |
| `FUNDX_MODEL` | var | default `gemini-2.5-flash` |
| `FUNDX_DAILY_LIMIT` / `FUNDX_RATE_LIMIT_SECONDS` / `FUNDX_TIMEOUT_MS` | var | limits |
| `FUNDX_APP_TOKEN` | secret | optional app token (Origin gate already covers app+web) |
| `GCP_PROJECT` / `GCP_LOCATION` / `GCP_SA_EMAIL` | secret | Vertex (shared with MaiK) |
| `GCP_WIF_PRIVATE_KEY` / `GCP_WIF_AUDIENCE` / `GCP_WIF_KID` / `GCP_WIF_ISSUER` / `GCP_WIF_SUBJECT` | secret | Vertex keyless WIF (shared with MaiK) |
| `GCP_SA_PRIVATE_KEY` | secret | alt to WIF (only if org allows SA keys) |
| `GEMINI_API_KEY` | secret | AI Studio dev/failover (optional) |
| `CEREBRAS_API_KEY` / `CEREBRAS_MODEL` / `CEREBRAS_BASE` | secret/var | Cerebras clinical (optional) |

KV binding `MAIK_KV` is already declared in `wrangler.toml` (production env). No new binding
is required.

## Local development

```bash
cp .dev.vars.example .dev.vars      # fill in what you want to exercise
npm run build:www                   # assemble www/ (static app)
npx wrangler pages dev . --kv MAIK_KV       # serves functions/ + www/ with .dev.vars
# health check:
curl -s http://localhost:8788/api/fundx/health | jq
```

With no Vertex/Cerebras creds in `.dev.vars`, `/health` reports every provider
`available:false` and `/vision` + `/clinical` return HTTP 503 `no_*_provider` — the app then
falls back to the on-device mock (vision) / rule engine (clinical). Add creds to exercise
real calls.

## Testing

```bash
node test/fundx-backend.test.mjs    # 33 assertions: validation, prompts, JSON extraction,
                                    # normalization, provider selection, orchestration via a
                                    # mock provider, and the router (health/503/CORS/401/405)
npm test                            # runs the above + all FundX + app suites
```

These run with **no credentials** — provider calls are exercised via an injected mock, and the
router is driven with fake Requests. Nothing hits the network.

## Production deployment

Deploys with the existing StewardMD Pages pipeline (`functions/` ships automatically). Steps:

1. Set the env vars above on the Pages project (production). Vertex WIF vars are already set
   for MaiK — FundX reuses them; you only add optional `CEREBRAS_API_KEY` / `FUNDX_*` tuning.
2. Deploy: `npm run build:www && npx wrangler pages deploy .` (or the existing CI/Pages Git
   integration — no special build for functions).
3. Verify: `curl -s https://stewardmd.in/api/fundx/health` (needs an allowed Origin/token) —
   confirm the intended provider shows `available:true`.
4. **Activate in the app:** the app is pre-wired — in FundX Settings pick the `vertex-gemini`
   vision provider (`SMD_FUNDX_PROVIDERS.setActive`), and/or activate the `backend` clinical
   provider (`SMD_FUNDX_CLINICAL.setActive("backend")`). Until then mock/rules stay active.

## Remaining configuration steps (credentials-gated)

Everything is complete and tested EXCEPT the final authenticated provider calls, which need
external credentials that are not present in this environment:

- [ ] Confirm/keep the shared **Vertex WIF** secrets on the Pages project (already used by
      MaiK). If FundX runs under a different GCP project/SA, set the `GCP_*` vars accordingly.
- [ ] (Optional) Set `CEREBRAS_API_KEY` to enable the Cerebras clinical provider.
- [ ] (Optional) Set `GEMINI_API_KEY` for the AI Studio dev/failover path.
- [ ] Deploy, hit `/api/fundx/health`, confirm `available:true` for the intended provider.
- [ ] Flip the app's active provider(s) as above.

No code change is required for any of these — they are configuration only.

## Provider router, monitoring & cost (production)

**Provider router (`_fundx_ai.js` `routeOrder`).** Per task the order is:
`FUNDX_PRIMARY` → `FUNDX_SECONDARY` → the task base order (`FUNDX_VISION_PROVIDER` /
`FUNDX_CLINICAL_PROVIDER` / `FUNDX_AI_PROVIDER`, default `vertex → developer`, clinical adds
`cerebras`), de-duplicated. `runTask` then applies **health-based** skipping (unavailable
providers are skipped) and **modality** filtering (vision requests skip text-only providers
like Cerebras), with **retry-once → automatic failover** to the next provider. Manual
override = set `FUNDX_PRIMARY`. Client-side manual override = the app's provider selector.

**Streaming.** The FundX endpoints return a single structured-JSON object (findings /
assessment), so **streaming is not applicable** and `capabilities().streaming === false` for
all providers — a deliberate design choice, not a gap. (MaiK's chat endpoint streams; FundX
structured output does not.)

**Safety.** Gemini requests carry `safetySettings` on all four harm categories at
`FUNDX_SAFETY` (default `BLOCK_ONLY_HIGH`) so medical images/text are not over-blocked; never
silently `OFF`.

**Monitoring.** Every provider call emits a structured log line (no PHI) and a metric event
(provider, status, latencyMs, inTok, outTok, costUsd). The router persists per-day, per-provider
counters to `MAIK_KV` via `ctx.waitUntil` (off the response path); `GET /api/fundx/health`
returns today's `metrics` = per-provider `{count, errors, errorRate, avgLatencyMs, tokens,
costUsd}` + total request volume. (A visual dashboard would consume this endpoint / the logs —
not built in; documented follow-up.)

**Cost.** Token usage is **estimated** (`estTokens` ≈ chars/4; image ≈ 1000 tokens for Gemini
multimodal — no exact token API) and priced from a per-provider table (USD/1M tokens,
overridable via `FUNDX_PRICES`). Surfaced in `/health.metrics[provider].costUsd`; use it for
provider comparison + monthly projection. Rate-limit / cost caps via `FUNDX_DAILY_LIMIT`.

**New env vars:** `FUNDX_PRIMARY`, `FUNDX_SECONDARY` (routing), `FUNDX_SAFETY` (default
`BLOCK_ONLY_HIGH`), `FUNDX_PRICES` (optional cost override) — all non-secret; see
`.dev.vars.example`.

**Capability discovery:** `GET /api/fundx/health.providers[]` = `{name, modalities, streaming,
structuredJson, imageInput, available}` per provider.

## Cerebras integration status (verified 2026-07-18, billing enabled)

- **Secrets stored** (production Pages): `CEREBRAS_API_KEY` and `CEREBRAS_MODEL` (=`gemma-4-31b`)
  — set via `wrangler pages secret put ... --project-name stewardmd`. Never committed / never
  sent to the client (server-only `env.CEREBRAS_API_KEY`); confirmed absent from git history,
  the client bundle, logs, and API responses.
- **Real inference VERIFIED** (billing now active): a real clinical inference succeeds through
  the backend (`runClinical` → Cerebras) — e.g. severe-DR + macular-oedema findings → `severity:
  severe, urgency: urgent, referral: Ophthalmology/Retina`. Latency ~0.95–1.45 s, ~230 output
  tokens, ~$0.0003/call. Structured-JSON contract validated (engine/advisory/schemaVersion).
- **Model choice:** account exposes `gemma-4-31b`, `gpt-oss-120b`, `zai-glm-4.7` (NOT the code
  default `llama-3.3-70b`, so `CEREBRAS_MODEL` **must** be set). **`gemma-4-31b` chosen** — clean
  JSON, concise (~230 tok), cheapest, most reliable. `gpt-oss-120b` works but is a *reasoning*
  model (separate `reasoning` field, ~2× tokens, occasional non-JSON); `zai-glm-4.7` puts all
  output in `reasoning` and leaves `content` empty → **not usable** with structured JSON. Since
  Cerebras is the LAST fallback, reliability was prioritised.
- **Production priority [verified]:** Vertex (primary) → **Developer/Mock DISABLED in production**
  → Cerebras (last fallback, clinical only — no vision modality). `isProduction(env)` (default
  true; dev via `FUNDX_ENV=development`/`preview` or `FUNDX_ALLOW_DEVELOPER=1`) removes developer
  from every order AND from `available()`, so it can never run in prod. Verified: Vertex-unavail
  → Cerebras `ok`; no provider → HTTP 503; developer excluded even with `GEMINI_API_KEY` set.
- **Rotate this key** — it was shared in chat; treat as exposed. Re-run only the
  `CEREBRAS_API_KEY` secret put after rotating.

### Setting Cerebras secrets (reference)
```bash
printf '%s' "$CEREBRAS_KEY" | wrangler pages secret put CEREBRAS_API_KEY --project-name stewardmd
printf '%s' "gemma-4-31b"  | wrangler pages secret put CEREBRAS_MODEL  --project-name stewardmd
```
