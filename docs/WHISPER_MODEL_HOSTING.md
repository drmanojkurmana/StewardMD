# Hosting the Whisper (Clinical Dictation) models

The app downloads a ggml Whisper model **once** at runtime from a **StewardMD-owned origin** (never a
third-party hotlink). Files, pinned in `native-bridge.js` `WHISPER_MODELS` and verified by SHA-256
natively before first use:

| model key | file | bytes | sha256 |
|---|---|---|---|
| `small.en-q5_1` (default) | `ggml-small.en-q5_1.bin` | 190,098,681 | `bfdff489…e478ad30` |
| `base-q5_1` | `ggml-base-q5_1.bin` | 59,707,625 | `422f1ae4…f01a8898` |
| `tiny-q5_1` (low-end) | `ggml-tiny-q5_1.bin` | 32,152,673 | `81871056…b469c3d7` |

Default is **small English-only** (best accuracy for accented/medical English; English-only because Clinical Dictation is language-locked to English). All three are hosted under `whisper/`.

> Cloudflare **Pages cannot host these** (25 MiB per-file limit; base is ~57 MB). Use **R2**.

## Option A — R2 + custom domain `models.stewardmd.in` (recommended; zero app change)
`WHISPER_MODEL_HOST` already = `https://models.stewardmd.in/whisper`, so once the bucket exists and
the custom domain is attached, nothing in the app changes.

1. Authenticate: `wrangler login` **or** `export CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=…`
   (token scope: *R2 Storage: Edit*).
2. Run: `bash scripts/host-whisper-models.sh` — fetches from HF, **verifies the pinned SHA-256**,
   creates bucket `stewardmd-models`, uploads to `whisper/…`.
3. Dashboard (one step): **R2 → stewardmd-models → Settings → Custom Domains → Connect
   `models.stewardmd.in`** (DNS + TLS auto-created because stewardmd.in is in your account).
4. Verify: `curl -sIL https://models.stewardmd.in/whisper/ggml-base-q5_1.bin` → `200`, `content-length: 59707625`.

## Option B — serve from `stewardmd.in/models` via a Pages Function (no new subdomain)
If you'd rather keep everything on `stewardmd.in`: create the bucket + upload as above, bind it to the
Pages project as `MODELS`, add a `functions/models/[[path]].js` that streams the object (with Range +
long cache), and set `WHISPER_MODEL_HOST = "https://stewardmd.in/models"`. Tell me and I'll wire this
(it's ~30 lines + one binding + the const change).

## Notes
- The native download uses `URLSession` directly (not the JS `/api/*` rewrite), so an absolute R2/custom-domain URL is required — CORS is irrelevant (native request).
- Long-lived immutable content: set a Cache Rule / `Cache-Control: public, max-age=31536000, immutable` on the R2 custom domain for edge caching.
- **Rollback:** `wrangler r2 object delete stewardmd-models/whisper/<file> --remote` (and/or remove the custom domain). With the model absent, Clinical Dictation reports `model-download-failed` and the app falls back to Fast — no crash.
- License: ggml Whisper models are MIT (OpenAI Whisper); re-hosting/mirroring is permitted (notice in the plugin `LICENSE`).
