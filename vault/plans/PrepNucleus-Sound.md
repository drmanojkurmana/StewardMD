# PrepNucleus Sound — Music Integration Technical Plan

**Status:** Proposed; documentation only. No application code, credentials, provider registrations, or feature flags changed.  
**Product scope:** PrepNucleus on Android (Capacitor/native wrapper) and Web/PWA.  
**User goal:** Listen to personal music while reading notes, answering MCQs, reviewing explanations, studying MediGram, or taking mock tests. Music must not interrupt the learning workflow.

## 1. Product decision

Build **PrepNucleus Sound** as a provider-independent music layer with two distinct playback paths:

1. **Embedded / first-party playback:** PrepNucleus plays audio it owns or is explicitly licensed to stream, and any third-party catalogue whose official SDK and commercial terms have been approved for the product.
2. **External-app handoff / remote control:** Where a provider does not permit embedded playback, open the provider's app or supported deep link. Native integrations may expose supported remote controls only where the provider explicitly permits them.

The user should see one consistent Sound Dock, but the UI must disclose which playback path is active. Never imply that an external app is being controlled when PrepNucleus only opened it.

**Core principle:** PrepNucleus is a study app with optional background music, not a music streaming service or a Spotify clone.

## 2. UX requirements

### 2.1 Sound Dock

A compact, persistent player accessible from:
- PrepNucleus home;
- MCQ runner and answer explanation;
- notes/lesson reader;
- MediGram;
- mock-test setup and results (not over the active exam question area if it distracts).

Controls:
- play/pause;
- next/previous where the active provider supports it;
- track title and artist (only when provider terms permit);
- output/provider indicator;
- volume where the active playback path permits it;
- expand/minimise;
- open provider app;
- disconnect / stop.

Do not show disabled controls as if they work. Provider capability flags determine which controls appear.

### 2.2 Focus presets

Offer curated presets such as:
- Deep Focus
- Lo-fi
- Instrumental
- Classical
- Ambient
- Nature / White Noise

A preset is a playlist/context shortcut, not a claim that a provider catalogue is included in PrepNucleus. Clearly label whether it opens an external playlist or starts a first-party licensed track collection.

### 2.3 Study-aware behaviour

- Music is opt-in; never autoplay on first use or after login.
- Persist the user's explicit preference and last selected provider/preset.
- Navigating between PrepNucleus modules must not restart audio.
- Starting a mock test must not pause music unless the user chooses that behaviour.
- MediGram video audio must not be mixed with or synchronised to third-party music. Offer a clear choice: pause music before video, or watch a muted/captioned video where appropriate. Do not attempt to mix provider streams.
- On leaving PrepNucleus, first-party playback may continue only if the user explicitly enabled background playback.
- Provide a one-tap stop and a clear way to return to study.

## 3. Provider capability and policy matrix

Provider support is not uniform. Treat each provider as a separate adapter with its own capability manifest and approval status.

| Provider | Embedded playback | External handoff / remote control | Initial decision |
|---|---|---|---|
| Apple Music | MusicKit provides catalog access and playback on web and Android, subject to SDK/platform support, subscription, entitlements and terms. Validate the current Android SDK in a proof of concept. | Open Apple Music links; do not assume arbitrary remote control of the Apple Music app. | First embedded-provider candidate; technical and commercial review required. |
| Spotify | Web Playback SDK can play in browser for Premium users, but Spotify says it must not be used in commercial projects without prior written approval. Spotify classifies SDK/API playback control as a streaming SDA and imposes commercial-use restrictions. | Android App Remote can control the installed Spotify app with user authorisation and supported scopes; this is still a streaming SDA under Spotify policy. Use only after written approval for this commercial product. | External deep link only in MVP; no OAuth/SDK playback controls until written approval. |
| YouTube Music | No supported public third-party Music playback SDK identified for this use case. Do not use YouTube Data API as a music playback API. | Open user-selected playlist/song/app links. Generic cross-app transport controls are not available to a web page. | External handoff only. |
| Amazon Music | Developer portal describes a closed-beta Web API and certification/approval requirements; no generally available public third-party mobile SDK for this use case. | Open Amazon Music app/deep link where supported. | External handoff only unless Amazon grants access and certifies the integration. |
| JioSaavn | No verified public playback SDK/API for this product use case. Do not scrape endpoints or reverse-engineer private APIs. | Open supported app/web links. | External handoff only. |
| Gaana | No verified public playback SDK/API for this product use case. Do not scrape endpoints or reverse-engineer private APIs. | Open supported app/web links. | External handoff only. |
| StewardMD-owned/licensed audio | Yes, using a first-party player and licensed audio assets. | Not applicable. | MVP embedded fallback and the only provider-independent playback path. |

**Policy gate:** Re-check official provider terms, SDK status, geographic availability, subscription requirements, attribution rules, app-store requirements and commercial approval immediately before implementation and release. A technical SDK does not automatically grant permission to commercialise the integration.

### Important platform limitation

- **Android app:** A native integration can use Android media-session/background-service patterns for audio that PrepNucleus is licensed to play. It may connect to another app only through that provider's supported SDK or Android-supported intent/deep link. There is no universal API that lets PrepNucleus control every installed music app.
- **Web/PWA:** A web page can play its own permitted audio and expose its own playback through the browser Media Session API. Media Session controls do not grant permission to control Spotify, YouTube Music, Amazon Music or other unrelated apps. Browser autoplay and background execution are platform-dependent; playback must begin after a user gesture.
- **External app playback:** Once a user opens a music app, the operating system/provider owns playback. PrepNucleus should not promise universal in-app next/previous/pause controls for that external session.

## 4. Proposed architecture

This is a proposed design, not a statement that these files or abstractions already exist. Audit the active PrepNucleus branch before naming final files or introducing dependencies.

### 4.1 Layers

1. **Sound UI:** Sound Dock, provider chooser, preset list, connection and error states.
2. **Sound orchestrator:** One public interface for play, pause, stop, next, previous, current item and provider state.
3. **Provider adapters:** Apple Music, Spotify App Remote (only after approval), external deep-link adapters, and first-party audio.
4. **Platform bridge:** Capacitor/native Android bridge and Web/PWA browser adapter.
5. **Persistence:** Minimal local preference state; do not duplicate PrepNucleus auth or profile stores.

Suggested modules after code audit:
- `prep-sound.js`: UI/controller and action routing, using the existing PrepNucleus host conventions.
- `prep-sound.css`: isolated `.pn-sound-*` styles using current theme tokens.
- `prep-sound-core.js`: provider-neutral state machine and capability model.
- `prep-sound-providers.js`: provider adapter registry and deep-link handling.
- `prep-sound-native.js`: Capacitor/native bridge, only if the current wrapper requires it.
- `prep-sound-web.js`: HTMLAudioElement / Media Session implementation for first-party audio.

Do not create every file by default. Keep the MVP small and align with the existing `prep.js`, `prep-loader.js`, `PREP._host`, `data-act` forwarding and back/leave lifecycle after inspecting the active branch.

### 4.2 Provider-neutral interface

Each adapter should expose a common contract where supported:

```ts
type SoundProviderId =
  | "first_party"
  | "apple_music"
  | "spotify_remote"
  | "youtube_music_external"
  | "amazon_music_external"
  | "jiosaavn_external"
  | "gaana_external";

type ProviderCapabilities = {
  embeddedPlayback: boolean;
  externalHandoff: boolean;
  remoteControls: boolean;
  queueControls: boolean;
  volumeControl: boolean;
  trackMetadata: boolean;
  backgroundPlayback: boolean;
};

interface SoundProvider {
  id: SoundProviderId;
  capabilities: ProviderCapabilities;
  getStatus(): Promise<SoundStatus>;
  play?(context?: PlayContext): Promise<void>;
  pause?(): Promise<void>;
  stop?(): Promise<void>;
  next?(): Promise<void>;
  previous?(): Promise<void>;
  openExternal?(target: ExternalTarget): Promise<void>;
  disconnect?(): Promise<void>;
  dispose(): Promise<void>;
}
```

The orchestrator must check capabilities before rendering controls or invoking methods. Unsupported operations should return a typed unsupported result, not silently do nothing.

### 4.3 State machine

Suggested states:
- `idle`
- `selecting_provider`
- `connecting`
- `ready`
- `playing_embedded`
- `playing_external` (handoff confirmed only to the extent observable)
- `paused`
- `interrupted`
- `error`

Events include user play/pause, provider connect/disconnect, app background/foreground, audio interruption, route change, network loss, token expiry and provider callback. State must be reconciled on app resume; do not assume playback continued.

## 5. Android implementation

- Confirm whether the production Android app is Capacitor and identify its current Capacitor version before selecting plugins.
- For first-party audio, use a supported Android media playback service / Media3 integration with media session, notification controls, audio focus, headset/Bluetooth controls, noisy-route handling and foreground-service compliance.
- Use a single app-level playback owner so navigation between PrepNucleus screens does not recreate the player.
- Handle audio focus loss, phone calls, alarms, Bluetooth disconnect, headphones unplugged, process recreation and low-memory termination.
- Store only a stable track/playlist ID and playback preference; do not persist streaming URLs or DRM material.
- Provider SDKs must be added only after policy approval, current SDK compatibility checks, signing/configuration and an end-to-end test on physical devices.
- External handoff should use official deep links / Android intents and gracefully fall back to the provider's web URL or Play Store listing. Never rely on undocumented package names or private endpoints.
- Respect Android background execution and foreground-service rules for first-party playback. Do not keep a service alive when no audio is playing.

## 6. Web/PWA implementation

- Use a single app-level audio owner, not one audio element per screen.
- For first-party/licensed audio, use HTMLAudioElement initially; use Media Session API for lock-screen / headset metadata and transport controls where browser support exists.
- Start playback only from an explicit user gesture. Handle autoplay rejection, tab suspension, mobile browser background restrictions, visibility changes and output-device changes.
- Use a supported streaming format and CDN with correct range requests, cache headers and CORS. Do not expose signed/private media URLs longer than needed.
- Do not assume a PWA can control other installed music apps. External provider links open the relevant app or web experience; the browser may switch context.
- Test Chrome Android, Safari iOS if later supported, desktop Chrome/Edge/Firefox and installed PWA mode separately.

## 7. Apple Music integration spike

Apple's official MusicKit materials describe catalog access and playback for web and Android, with user authorisation and subscription checks. Before adopting it:
1. Register the appropriate Apple developer identifiers and MusicKit capability.
2. Implement developer-token generation on the server; never ship the private signing key in the client.
3. Implement user authorisation and revoke/disconnect handling.
4. Verify MusicKit Web playback in supported browsers.
5. Verify the current official Android SDK on target Android versions and Capacitor integration; do not assume web and Android SDKs have identical features.
6. Verify subscription entitlement, playback restrictions, background behaviour, attribution, content availability in India and current commercial/app-store terms.
7. Confirm whether the Sound Dock can display required metadata/artwork and whether any UI or monetisation restriction applies.

If Android SDK compatibility or commercial terms fail, retain Apple Music as an external handoff provider on Android and web until resolved. Do not use unofficial wrappers or reverse-engineered MusicKit clients in production.

## 8. Spotify integration gate

Spotify's current public documentation distinguishes:
- Android App Remote: controls the installed Spotify app with user permission and the `app-remote-control` scope.
- Web Playback SDK: browser playback using the `streaming` scope and Premium.
- Spotify classifies SDK/API playback control as a streaming SDA. Its Developer Policy limits commercial use, and the Web Playback SDK documentation explicitly says commercial projects need prior written approval.

Therefore:
- MVP: external Spotify link/handoff only; no Spotify OAuth, playback SDK, track streaming or remote controls.
- Later: submit the complete PrepNucleus use case to Spotify and obtain explicit written approval covering Android App Remote, Web Playback SDK (if desired), commercial model, monetisation and distribution.
- Do not use Spotify audio in MediGram videos, mix it with other audio, synchronise it to video, use it for quiz/game mechanics, or mimic Spotify's core experience.
- If approval is not obtained, leave the external handoff option only.

## 9. First-party audio fallback and rights

A first-party library is the only reliable provider-independent embedded option.

- Use original commissioned tracks or audio licensed for on-demand streaming inside a commercial educational app.
- Obtain written rights covering app distribution, territories (including India), streaming, caching/offline use if any, term, attribution and takedown.
- Keep licence metadata and expiry dates in a private/admin-controlled asset manifest.
- No unlicensed commercial songs, ripped streams, user-uploaded copyrighted files or music extracted from videos.
- For MVP, start with a small collection of original ambient / white-noise / instrumental tracks. Do not promise popular songs.
- Decide whether offline caching is permitted per asset. Encrypt or otherwise protect cached assets as appropriate to the licence; never cache DRM streams.

## 10. Data model and privacy

Minimal preference object, stored with the existing PrepNucleus local preferences:

```json
{
  "v": 1,
  "enabled": false,
  "preferredProvider": "first_party",
  "preferredPreset": "deep_focus",
  "autoResume": false,
  "backgroundPlayback": false,
  "pauseBeforeVideo": true
}
```

Rules:
- Do not collect music listening history for learning analytics.
- Do not infer mood, mental health, productivity or attention from music choice.
- Do not store provider passwords, refresh tokens or private keys in localStorage or public manifests.
- Use provider-authorised secure token storage where a permitted SDK requires it; keep server signing secrets server-side.
- Make disconnect and preference reset discoverable.
- Disclose any provider account data accessed and why. Keep provider analytics separate from PrepNucleus learning analytics.
- Do not send track titles, artist names or listening history to AI Tutor or recommendation systems.

## 11. Feature flag and rollout

Proposed flag: `smd_prep_sound`, default **OFF**, requiring `smd_prep`. It must not affect normal PrepNucleus if disabled or if provider scripts fail.

### Phase 0 — Audit and legal/technical validation
- Audit active branch, Android wrapper, Capacitor plugins, build scripts, CSP, app lifecycle, existing audio/TTS code and test harness.
- Validate Apple Music SDK support and commercial terms.
- Seek Spotify written approval only if remote control is a priority.
- Confirm provider deep-link behaviour on target Android devices.
- Confirm rights and cost for first-party tracks.

**Exit:** architecture decision record, provider approval matrix, tested Android/web proof-of-concept and asset-rights plan.

### Phase 1 — Sound Dock + external handoff
- Add flag-gated Sound Dock and provider chooser.
- Implement official deep-link / web-link handoff for Spotify, YouTube Music, Amazon Music, JioSaavn, Gaana and Apple Music where a verified link format exists.
- Add focus preset cards that open the selected provider's curated playlist.
- Clearly label external playback and show only controls actually supported.
- No third-party credentials, OAuth or embedded third-party streaming in this phase.

**Exit:** handoff works on installed-app and no-app paths; no false promise of external controls; flag-off regression tests pass.

### Phase 2 — First-party embedded player
- Add licensed/original ambient tracks.
- Implement Android background service/media session and web audio/Media Session adapter.
- Add audio focus, interruption, headset, lock-screen, background and app-resume behaviour.
- Persist minimal user preferences; no autoplay.

**Exit:** physical-device and browser lifecycle tests pass; audio rights verified; battery/data usage acceptable.

### Phase 3 — Approved catalogue provider
- Apple Music proof-of-concept first, conditional on SDK support and legal review.
- Spotify App Remote / Web Playback only if Spotify gives written commercial approval.
- Add provider-specific account linking, entitlement and disconnect flows only after approval.
- Keep external handoff as a fallback.

**Exit:** provider certification/approval (where required), legal sign-off, privacy review and store compliance.

### Phase 4 — Refinement
- Add optional focus timer integration, saved presets and user-defined provider links.
- Consider more first-party ambience and languages only if users request them.
- Do not add social listening, public playlists or listening-time leaderboards.

## 12. Testing plan

### Unit tests
- capability-based control rendering;
- provider state machine and unsupported actions;
- provider disconnect, expired token and failed handoff;
- preference migration and reset;
- no autoplay on first launch;
- no duplicate player instances across route changes;
- no provider metadata leaking into learning analytics;
- rights/expiry validation for first-party assets.

### Android integration tests
- playback continues through PrepNucleus navigation;
- background/foreground and process recreation;
- notification, lock-screen, Bluetooth and headset controls;
- audio focus loss and restoration;
- call/alarm interruption;
- app update and provider app missing/outdated;
- external app handoff and return to exact study screen.

### Web tests
- user-gesture requirement and autoplay rejection;
- background tab / PWA behaviour;
- Media Session availability and fallback;
- network loss and media range requests;
- tab reload, navigation and multiple-tab ownership;
- external handoff on desktop and Android Chrome.

### Product regression
- MCQ timer and answer submission unaffected;
- mock exam timing and autosave unaffected;
- TTS lessons and audio player do not unexpectedly overlap;
- MediGram video and music do not mix or synchronise;
- feature flag OFF leaves PrepNucleus unchanged.

Use mocks and synthetic audio fixtures for CI. Do not make CI depend on real provider accounts, paid subscriptions or live copyrighted streams.

## 13. Success measures

Primary:
- percentage of users who voluntarily enable Sound;
- successful start rate and playback reliability;
- rate of playback interruptions during MCQ/notes navigation;
- user-reported study distraction versus benefit.

Guardrails:
- no reduction in MCQ completion, accuracy or mock-test reliability;
- no increase in accidental autoplay;
- battery/data usage;
- crash-free sessions;
- privacy or licensing incidents (target zero).

Do not optimise for listening minutes or longer study sessions as a goal in itself.

## 14. Owner decisions before implementation

1. Is Apple Music the first embedded provider to prototype? Recommendation: yes, subject to current Android SDK validation and commercial review.
2. Is Spotify remote control worth pursuing with written approval? Recommendation: submit an inquiry, but do not block MVP on it.
3. Which first-party audio pack should ship first: ambient/white noise only, or commissioned instrumental tracks too?
4. Should playback auto-resume after app restart? Recommendation: off by default; offer an explicit preference.
5. Is offline music required? Recommendation: defer until asset licences explicitly allow downloads/caching.

## 15. Definition of done

PrepNucleus Sound is ready for a limited release when:
- the same Sound Dock works consistently across PrepNucleus screens;
- embedded and external paths are clearly distinguished;
- Android and web platform limitations are honestly represented;
- all embedded audio is owned or properly licensed, or played through an approved provider SDK;
- unsupported controls are hidden;
- background playback and interruptions are tested;
- no provider secrets or listening history leak into PrepNucleus data;
- music never interferes with MCQ timing, mock tests, TTS or MediGram media;
- the feature is optional and flag-gated.

## 16. Official references checked (2026-10-31)

- Apple MusicKit overview and platform support: https://developer.apple.com/musickit/
- Apple MusicKit documentation: https://developer.apple.com/documentation/musickit
- Spotify Web Playback SDK and commercial approval notice: https://developer.spotify.com/documentation/web-playback-sdk
- Spotify Developer Policy (effective 15 May 2025): https://developer.spotify.com/policy
- Spotify compliance tips: https://developer.spotify.com/compliance-tips
- Spotify scopes (App Remote and Web Playback): https://developer.spotify.com/documentation/web-api/concepts/scopes
- Spotify Android App Remote SDK: https://spotify.github.io/android-sdk/
- Amazon Music Developer Program: https://developer.amazon.com/docs/music/landing_home
- Amazon Music Program Requirements: https://www.developer.amazon.com/docs/music/requ_AM-Program-Requirements.html

**Bottom line:** Ship external handoff first, add a small licensed first-party embedded player next, and integrate a streaming catalogue only when the provider's current SDK, platform support and commercial permissions are confirmed.