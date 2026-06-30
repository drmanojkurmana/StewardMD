# StewardMD — Gemini AI (explainer + ICU Vision) deployment

Adds an **AI explainer** for the differential and **AI Vision** for ICU Snapshot,
via a same-origin Cloudflare Pages Function (`/api/ai/*`). **Off by default** and
fully reversible — the rule engine always decides first; AI only explains an
already-computed differential or extracts structured fields from a captured image.

## Files (already in the repo)
- `functions/api/ai/[[path]].js` — the Function (`/api/ai/status|explain|vision`).
- Frontend: `window.SMD_AI` (in reasoning.js) + "✨ Explain with AI" on the live
  differential + ICU Snapshot camera capture (in icu.js). All gated by `smd_ai`.

## Cloudflare setup (Pages → project → Settings → Environment variables, *encrypted*)
1. `GEMINI_API_KEY` = a Google AI Studio / Gemini API key. **Required** — without
   it `/api/ai/status` returns `{enabled:false}` and the app silently falls back
   to the rule-based output.
2. Optional `GEMINI_MODEL` (default `gemini-2.0-flash`).
3. Reuse the GHIS access gate (`GHIS_APP_TOKEN` / Cloudflare Access / same-origin).

## Turn it on (per device, reversible)
- `SMD_AI.setFlag(true)` in the console (or set `localStorage.smd_ai = "1"`).
- `SMD_AI.setFlag(false)` removes the AI UI instantly. Default is OFF.

## ⚠️ Privacy / PHI — read before enabling
- **Explain** sends the (name-free) findings/differential to Google.
- **ICU Vision** sends the captured **image** (monitor/labs/ventilator/flow-sheet)
  to Google. These are PHI. Only enable with appropriate consent/governance.
- Nothing is persisted by the Function; the service worker never caches `/api/*`.
- The engine's decision is authoritative; AI output is explanatory and must be
  clinically verified. Disable instantly with the flag if in doubt.

## Smoke test after deploy
- `GET /api/ai/status` → `{"enabled":true}` once the key is set.
- In-app: enable `smd_ai`, open a case → "✨ Explain with AI" returns a summary;
  ICU → 📷 Snapshot → capture a monitor photo → values populate the ICU tabs.
