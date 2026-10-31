# PrepNucleus Sound — Apple Music (plan only, no code in job rs-player-ui)

Status: OPEN. No Apple Music code ships until every owner step below is done.
Until then Apple Music stays an external-handoff provider: the Sound Dock
shows the honest card ("Playing in Apple Music — PrepNucleus can't see or
control it"), one Open button, no fake transport. See PrepNucleus-Sound.md
sections 3 and 7.

## Why no code yet

MusicKit JS (web/iOS) plays Apple Music only with a **developer token**: a
JWT (ES256) signed with a private MusicKit key (.p8) from the owner's Apple
Developer account, plus the team ID and key ID. The signing key must never
ship in the app or repo — tokens are minted server-side and refreshed before
expiry (max 6 months). Without the owner's account artefacts there is
nothing safe to build against: no key, no token, no playback. Android would
need a separate check of Apple's current Android MusicKit SDK and Capacitor
interop (do not assume web and Android behave alike).

## Exact owner steps

1. Sign in to developer.apple.com with the StewardMD Apple Developer account.
2. Certificates, Identifiers & Profiles -> Identifiers: open the PrepNucleus
   app ID (or create it) and enable the **MusicKit** capability.
3. Keys -> create a new key, enable **MusicKit** on it, download the `.p8`
   file (downloadable once only — store it in the team password vault, never
   in git, never in the client bundle).
4. Note the **Key ID** (on the key's page) and the **Team ID** (Membership
   page). Share both IDs with engineering (they are not secrets); hand the
   `.p8` to whoever runs the token endpoint through a secure channel only.
5. Engineering then: adds a server endpoint that signs short-lived developer
   tokens (ES256, `iss` = Team ID, `kid` = Key ID), loads MusicKit JS in the
   Sound layer behind `smd_prep_sound` + a new Apple sub-flag, implements
   user authorisation (the learner's own Apple Music subscription), and
   verifies: subscription entitlement, India catalogue availability,
   background/lock-screen behaviour, required artwork/attribution display,
   and current commercial/App Store terms.
6. If the Android SDK or commercial terms fail, Apple Music stays
   external-handoff. No unofficial wrappers or reverse-engineered clients.

## OPEN items for humans

- Apple Developer artefacts above (owner only).
- Legal/commercial review of MusicKit terms for a paid education app.
- Real-device playback tests (iPhone + Android) after a token endpoint
  exists.
