# StewardMD — feature flags, controls & deploy reference

Everything shipped in the gold95–gold104 wave is **additive and reversible**. The
risky / experimental parts are **flag-gated**; the reasoning engine is byte-identical
when its flags are off (golden harness enforced). Recovery point: git tag
`reasoning-v1-stable` / branch `backup-reasoning-v1`.

## Toggle from the UI
Open the **sidebar → 🧪 Experimental features** and flip any switch (gold104).

## Flags (localStorage) + console setters + defaults
| Feature | Flag key | Console | Default | What it does |
|---|---|---|---|---|
| Reasoning v2 | `smd_reason_v2` | `SMD_REASON.setFlag(true/false)` | **ON** | Live 🔴/🟢 differential in the 5-step form + progressive Step-3 findings + "Explain with AI" hook |
| Expanded Harrison KB | `smd_kb_expanded` | `SMD_setKbExpanded(true/false)` | **OFF** | +268 reference diseases as diagnostic candidates (auto-derived signatures — clinician review needed) |
| AI assist (Gemini) | `smd_ai` | `SMD_AI.setFlag(true/false)` | **OFF** | "✨ Explain with AI" + ICU Snapshot camera→Vision→ICU_STATE (needs server key) |
| GHIS Ward Sync | `smd_ghis_ward` | `SMD_setGhis(true/false)` | **ON** | Live inpatient labs + radiology (sidebar 🏥 Ward) |

`SMD_kbExpandedCount()` reports the expanded-KB status.

## Cloudflare Pages — required secrets (Settings → Environment variables, encrypted)
| Secret | For | Notes |
|---|---|---|
| `GHIS_USER`, `GHIS_PASS` | GHIS hosted login | Dedicated GHIS **service account**, strong password |
| `GHIS_KV` (KV binding) | GHIS session sharing | Optional but recommended |
| `GEMINI_API_KEY` | AI assist | Required to enable AI; absent → `/api/ai/status` = `{enabled:false}` → rule-based fallback |
| `GEMINI_MODEL` | AI model | Optional, default `gemini-2.0-flash` |
| `GHIS_APP_TOKEN` | Endpoint lock | Or front `/api/*` with **Cloudflare Access** |

Smoke tests: `GET /api/ghis/status` → `{"connected":true}`; `GET /api/ai/status` → `{"enabled":true}` (after key).

## PHI & safety
- The engine always decides first; **AI only explains** an already-computed differential or extracts structured fields from an image (you verify before use).
- `/api/ghis/*` (labs/radiology) and `/api/ai/vision` (images) carry **PHI**; the service worker **never caches `/api/*`**, and the Functions persist nothing (only the GHIS session cookie is cached).
- Enable AI / GHIS only with appropriate consent and the endpoint locked to authorised users.

## Tests (auto-spawn server + headless Chrome)
`node test/run-golden.mjs` · `run-main-engine.mjs` · `run-nextq.mjs` · `run-kb-ai.mjs` · `run-ghis-ward.mjs` · `run-kb-expanded.mjs` · `run-reason-api.mjs`
