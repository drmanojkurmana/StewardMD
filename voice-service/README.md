# FollowCare AI Voice Fallback — RunPod voice service (Phase 2 + 3)

The GPU side of the AI voice fallback. It calls a discharged patient who ignored the digital FollowCare
check-in and runs one short wellbeing conversation, **reusing the existing deterministic FollowCare engine
for every clinical decision** (over HTTP to Cloudflare). No clinical reasoning lives here. RunPod GPU only —
no Google Cloud GPU. No Plivo AI Agent.

## The loop (exactly the agreed architecture)

```
Plivo Audio Streaming (WS)
   → IndicConformer 600M STT            (app/stt/indicconformer.py)
   → Gemini 2.5 Flash slot extraction   (app/nlu/gemini.py)   -- speech→structured value ONLY
   → FollowCare deterministic engine     (app/followcare/client.py → Cloudflare /voice/classify, /voice/result)
   → short response formatter            (app/call/responder.py, 1 short sentence)
   → Indic Parler-TTS                    (app/tts/parler.py)
   → Plivo Audio Streaming (WS)
```

Deterministic call flow (spec §17), in `app/call/state_machine.py`:
`START → VERIFY → ASK(script questions) → [ESCALATE → AMBULANCE] → END`. The question script comes from
Cloudflare (`GET /voice/queue`, built by `Assessment.buildAssessment` — the same script the web portal shows).

## What is NOT here (by design)
- No clinical engine — escalation/score is Cloudflare's `Engine.assess` via `/voice/classify` and `/voice/result`.
- No eligibility/scheduling/records/settings — those are Phase 1 on Cloudflare.
- Gemini decides nothing clinical: it only turns a spoken reply into a structured value.

## Lifecycle (spec §11–15) — GPU never idles
1. Cloudflare cron `run-voice` enqueues due calls and, when there are any, **resumes this pod** (RunPod API).
2. On boot the service loads STT+TTS, then `GET /voice/queue` (each call carries the script + decrypted phone).
3. It originates calls via Plivo (bounded `VOICE_MAX_CONCURRENT`, default 5) and runs each as a `CallSession`
   over the Plivo WebSocket.
4. Each call posts its result to `/voice/result`; Cloudflare scores it with the engine, escalates worsening to
   the doctor, and routes an explicit ambulance request to the hospital contact.
5. When the queue drains and the box goes idle it **stops its own pod** (`app/gpu.py`).

## Run the core offline (no GPU, no Plivo, no network)
```
cd voice-service
python3 -m unittest discover -s tests -v      # 15 tests: codec, state machine, NLU, client, full loop
python3 run_local_sim.py                       # prints 4 full simulated calls (recovering / ambulance / no-answer / wrong-person)
```
The core (`app/call`, `app/audio`, `app/followcare/client`, `app/nlu` with an injected model) has **zero
third-party dependencies** — only the live service needs `requirements.txt`.

## One-command provisioning (`deploy/`)

Secrets stay in your shell / `deploy/.env` — never in git, never in chat.

```
cp voice-service/deploy/.env.example voice-service/deploy/.env    # fill in Plivo/Gemini/token values
RUNPOD_API_KEY=xxx GITHUB_TOKEN=xxx bash voice-service/deploy/runpod.sh up      # create the 24GB pod
# → prints POD_ID + the public URL; put both into deploy/.env
CF_PAGES_PROJECT=<pages-project> bash voice-service/deploy/cloudflare.sh         # push the 3 shared secrets
RUNPOD_API_KEY=xxx RUNPOD_POD_ID=yyy bash voice-service/deploy/runpod.sh status  # / down to stop
```

`GITHUB_TOKEN` is a read-only GitHub PAT so the pod can clone the (private) repo. The pod boots, installs,
downloads the models to `/models` (persistent), and serves on `:8080`. Then set the pod's `VOICE_PUBLIC_BASE`
to the printed URL and restart. If RunPod rejects the deploy, adjust `RUNPOD_GPU_TYPE` (availability/region).

## Deploy to RunPod
1. Build + push the image (`Dockerfile`) to a registry; create an **on-demand GPU pod** (24 GB: A5000 / RTX 3090)
   exposing port 8080 with a public HTTPS endpoint.
2. Set env (below). Point `VOICE_PUBLIC_BASE` at the pod's public URL.
3. On Cloudflare (Pages project) set `FOLLOWCARE_VOICE_SERVICE_TOKEN` (same value), `RUNPOD_API_KEY`,
   `RUNPOD_POD_ID` so `run-voice` can resume the pod.

### Environment
| Var | Purpose |
|---|---|
| `FOLLOWCARE_BASE` | e.g. `https://stewardmd.in/api/followcare` |
| `FOLLOWCARE_VOICE_SERVICE_TOKEN` | shared secret; sent as `X-Voice-Token` (must match Cloudflare) |
| `FOLLOWCARE_APP_TOKEN` | optional, if the app gate requires `X-App-Token` |
| `PLIVO_AUTH_ID` / `PLIVO_AUTH_TOKEN` / `PLIVO_FROM` | Plivo India account + caller-ID DID |
| `VOICE_PUBLIC_BASE` | public `https://` URL Plivo reaches this service at |
| `VOICE_AUDIO_FORMAT` | `mulaw` (default) or `l16` |
| `GEMINI_API_KEY` | Gemini 2.5 Flash for slot extraction |
| `STT_MODEL` / `TTS_MODEL` | default AI4Bharat IndicConformer 600M / Indic Parler-TTS |
| `VOICE_MAX_CONCURRENT` | default 5 |
| `RUNPOD_API_KEY` / `RUNPOD_POD_ID` | self-stop when the queue drains |

## Tuning knobs (real-world, not guessable once in code)
- Silence endpointing + barge-in energy threshold: `PlivoStreamTelephony(silence_ms, energy_threshold)` —
  calibrate on the actual telephony path.
- IndicConformer forward call (`app/stt/indicconformer.py::_run`) — confirm against the current model card.
- Parler voice `description` (`app/tts/parler.py`) — tune tone/pace per language.
- Non-English spoken lines: `app/call/responder.py` has en + hi + te reviewed; add reviewed translations for
  the other languages (mirrors the digital side's `reviewed` model).

## Go-live checklist (Phase 3)
- [ ] Plivo India account + KYC + a DID for `PLIVO_FROM`
- [ ] RunPod pod built from this image; `VOICE_PUBLIC_BASE` reachable by Plivo
- [ ] Cloudflare secrets set (`FOLLOWCARE_VOICE_SERVICE_TOKEN`, `RUNPOD_API_KEY`, `RUNPOD_POD_ID`)
- [ ] A hospital has enabled voice + set its ambulance contact (FollowCare → Voice & ambulance settings)
- [ ] Controlled test calls to internal numbers before any real patient
