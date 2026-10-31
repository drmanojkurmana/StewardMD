# PrepSound Spotify spike — playback path decision (rs-spotify)

Status: decided for build; end-to-end verification on a real allowlisted account is **not done** (needs owner-supplied Spotify developer app, see report OPEN items). No approval request was written or sent.

## Decision: one playback path — Web API player endpoints (all platforms)

Chosen: the Spotify Web API player endpoints (`GET/PUT /v1/me/player*`) controlling the user's already-active Spotify app/device, plus Web API reads (`/v1/me`, `/v1/me/playlists`, `/v1/search`, `/v1/me/player`).

Why this path:

- It is the only option that works identically on Web/PWA and inside the Capacitor Android webview with zero native SDK, zero new dependency, and no client secret. PrepNucleus already ships as web code in both shells.
- The sheet never plays audio itself. It remote-controls the learner's own Spotify app, which keeps study audio and music fully separate (no mixing, no sync — plan restrictions hold by construction).
- Choosing a track/playlist calls `PUT /v1/me/player/play` with a `uris`/`context_uri` body; the sheet then closes back to the question, which is exactly the trip the feature exists to remove.

Rejected alternatives:

| Path | Why not (for v1) |
|---|---|
| Web Playback SDK (`streaming` scope) | Creates a new in-browser player device, Premium-only, heavier scope, and Spotify's own docs require prior written commercial approval for it. It also puts playback inside the study page, which the plan forbids mixing with lesson/video audio. Revisit only if approval is granted and the Web API path proves insufficient. |
| Android App Remote SDK (`app-remote-control` scope) | Native SDK + Capacitor bridge work, Android-only, still a streaming SDA under Spotify policy. Duplicates what the Web API player endpoints already do from the webview. Revisit only for offline/installed-app edge cases the Web API cannot reach. |

If Spotify refuses commercial approval, this module degrades to the plan's Phase 1 handoff: the sheet keeps playlists + "Open in Spotify" deep links and drops all remote controls (the free-account state already renders exactly that shape).

## Auth: Authorization Code + PKCE, no secret anywhere

- Flow: `GET https://accounts.spotify.com/authorize` with `response_type=code`, `code_challenge_method=S256`, a random `state`, and the minimum scopes below; exchange and refresh at `POST https://accounts.spotify.com/api/token` with `grant_type=authorization_code|refresh_token` and the PKCE `code_verifier`. No `client_secret` exists in the app, the repo, or any request.
- Minimum scopes: `user-read-private` (account product, to detect Premium honestly), `user-read-playback-state`, `user-read-currently-playing`, `user-modify-playback-state`, `playlist-read-private`, `playlist-read-collaborative`, `user-library-read`. Nothing else. No streaming, no App Remote, no profile-write scopes.
- `state` is verified on return; a mismatch aborts before any token call. The PKCE verifier + `state` live only in `sessionStorage` for the seconds of the redirect round-trip and are deleted at exchange. Access + refresh tokens live **in memory only** and are never written to `localStorage`, analytics, or the AI Tutor. Closing/reloading the app therefore asks for Connect again on web — accepted for v1; it keeps the secret surface at zero.
- Android token storage: **OPEN.** The installed Capacitor set (`@capacitor/preferences`, etc.) has no encrypted/secure-storage plugin, and `@capacitor/preferences` is plain storage, so tokens stay in memory on Android too until the owner approves adding a secure-storage plugin. No plugin was added by this job.

## Client id and flags

- Client id comes from config: `window.SMD_SPOTIFY_CLIENT_ID` (string) or `window.SMD_CONFIG.spotifyClientId`. Empty/absent by default. With no client id the module is inert and the music button is never rendered, even if flags are on.
- Flags (all must be on): `smd_prep` (existing, default ON) + `smd_prep_sound` (default OFF) + `smd_prep_sound_spotify` (default OFF). Off-default flags turn on only via `localStorage` `"1"` or `?sound=1` / `?spotify=1`. With any flag off, `window.PREP_SOUND_SPOTIFY` stays `undefined` and PrepNucleus is unchanged.
- Redirect URI comes from `window.SMD_SPOTIFY_REDIRECT_URI` or defaults to the current page origin + path. The owner must register that exact URI in the Spotify developer app.

## Capability honesty (show only working controls)

- Premium (`product === "premium"`): now-playing, play/pause, next/previous, volume (only when the active device reports `supports_volume`), playlists, search, tap-to-play, then sheet closes.
- Free: playlists + search results render as "Open in Spotify" links with a plain explanation that playback control needs Premium. No dead play/pause buttons are shown.
- No active device (`404` from player endpoints): plain "Open Spotify on this device first, then try again" state. `401` → session expired → Disconnect + Connect again. `429` → wait state honouring `Retry-After`. Offline → retry state. Every error state keeps Disconnect reachable.

## Branding

The sheet carries a "Spotify" wordmark text label and "Open in Spotify" attribution on every external link, per Spotify's design/branding guidelines: no Spotify green as a PrepNucleus theme colour, no logo redraw, no implication that PrepNucleus provides the music. PrepNucleus tokens (`--pn-*`, restrained dark green `#071318/#0D1D23/#42CDB5`) style the sheet; Spotify is named, never skinned.

## Adapter contract (Sound plan 4.2)

`prep-sound-spotify.js` is self-contained (rs-sound has not landed yet) and exposes the plan 4.2 shape so the Sound Dock can register it unchanged: `id: "spotify_remote"`, `capabilities` (`embeddedPlayback: false`, `externalHandoff: true`, `remoteControls/queueControls/volumeControl/trackMetadata` reflect the live Premium/device state, `backgroundPlayback: false` — Spotify's app owns background playback, PrepNucleus does not), plus `getStatus/play/pause/stop/next/previous/openExternal/disconnect/dispose`. `stop` maps to pause (Spotify has no stop for remote control; claiming one would be a dead control). Unsupported calls resolve to a typed `{ ok: false, reason }` result instead of throwing or silently doing nothing.
