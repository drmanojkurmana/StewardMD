# Watch-Lab — background lab alerts (A2, consent-gated)

Alerts a doctor when a **new lab is reported** for a patient they chose to watch — even when
the app is closed. Built on the native push channel (see `docs/PUSH-NATIVE.md`).

## Why it's built this way
Only a server runs 24/7, so reliable "app-closed" alerts require a **server-side watcher**.
The GHIS proxy is deliberately password-less (session tokens expire in hours), so the watcher
must be able to log in to GHIS on the doctor's behalf. That means storing the doctor's GHIS
login server-side — done **only with explicit consent**, encrypted, auto-expiring.

**Privacy (must stay in the consent UI + here, verbatim intent):** opting in stores the
doctor's GHIS username+password on our server, **AES-GCM encrypted, auto-destroyed after 30
days**, revocable anytime. The AES key lives server-side, so our server (and anyone who
breaches it) can decrypt it — which is exactly why this is **opt-in and consent-gated**.
Doctors who don't opt in keep the default "password never stored" posture.

## Account-specific by construction
Every per-user endpoint derives the account from a **verified Firebase ID token**
(`functions/_fbauth.js`), and pushes are sent with `sendNativeToAll(env, msg, { uid })`. Only
the doctor who consented for a patient receives that patient's alerts — never anyone else.

## Pieces
| Piece | File |
|---|---|
| Encrypted store (creds/list/seen), 30-day TTL, `labSignature` | `functions/_watch.js` |
| API: enable/add/remove/forget/status + admin `run` | `functions/api/watch/[[path]].js` |
| Cron trigger (every 15 min) → `POST /api/watch/run` | `worker/wrangler.jsonc`, `worker/src/index.js` |
| Client consent sheet + `window.SMD_WATCH` | `watch-lab.js` (loaded in `index.html`) |
| Foreground banner helper | `window.SMD_localNotify` in `native-push.js` |

## API
- `GET  /api/watch/status` (Bearer Firebase idToken) → `{ consented, watching:[...] }`
- `POST /api/watch/enable` (Bearer) `{ ghisUserId, ghisPassword, patient, consent:true }`
- `POST /api/watch/add` / `remove` / `forget` (Bearer)
- `POST /api/watch/run` (`X-Admin-Token`; cron only): for each consented uid → decrypt creds →
  `POST /api/ghis/login` (fresh session, never stored) → `GET /api/ghis/lab?patientId=` per
  watched patient → diff the orders' `{renderId,status}` signature vs the last seen → on change,
  push (uid-scoped) and update the baseline. First sight of a patient sets the baseline silently
  (no alert for pre-existing labs). Pushes carry **no PHI/values** — just "a new result arrived."

## Client usage
```js
await SMD_WATCH.enableWithConsent({ patientId, episodeId, name }); // opens consent sheet
await SMD_WATCH.add({ patientId, name });   // add another watched patient (already consented)
await SMD_WATCH.remove(patientId);          // stop watching one (clears creds if list empties)
await SMD_WATCH.forget();                    // revoke consent, purge creds + all watches
await SMD_WATCH.status();                    // { consented, watching }
```

## Config (Cloudflare secrets)
- `WATCH_ENC_KEY` — base64 of a 32-byte AES-256 key. Generate: `openssl rand -base64 32`.
- `UPDATES_ADMIN_TOKEN` — already used; also authorises the cron `run` call.
- Plus the APNs key + FCM service account from `docs/PUSH-NATIVE.md` (delivery).
- Store binding: `WATCH_KV` (falls back to `PUSH_KV`/`UPDATES_KV`/`GHIS_KV`/`CASES_KV`).

## Verified locally
`functions/_watch.js` unit-tested (16/16): AES-GCM cred round-trip, ciphertext-at-rest,
wrong-key-cannot-decrypt, watch-list add/dedupe/remove/forget, `labSignature`
order-independence + change-detection, seen round-trip. Firebase token anti-spoofing 7/7;
APNs/FCM signing 16/16. End-to-end delivery needs the secrets above + a test GHIS account.

## Honest limitations
- **Latency:** up to the cron interval (~15 min).
- **Only consented doctors** are polled; revoking (`forget`) or the 30-day expiry stops it.
- **If a doctor changes their GHIS password**, background login fails silently until they
  re-enable (a future improvement could surface a "re-authenticate" nudge).
