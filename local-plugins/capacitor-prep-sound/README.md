# @stewardmd/capacitor-prep-sound

Android-only Capacitor plugin for PrepNucleus Sound. Exposed to JS as
`Capacitor.Plugins.PrepSound`. iOS intentionally has no implementation: the
web layer detects that and keeps using the WebAudio player.

## Playback

`PrepSoundService` is a foreground service (`foregroundServiceType="mediaPlayback"`,
permissions `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` in the
plugin manifest, targetSdk 36) using platform `MediaPlayer` +
`android.media.session.MediaSession` only. The repo has no Media3 dependency
and this plugin adds none beyond the AppCompat the repo already uses (for the
activity type on the compile path).

- `play({ trackId, title?, volume?, backgroundPlayback? })` starts the loop.
  `trackId` must be one of `rain_soft`, `night_quiet`, `deep_drone`,
  `ocean_slow`; anything else is rejected as `unknown-track`.
- `pause()`, `stop()`, `setVolume({ volume })`, `getStatus()`.
- `isAvailable()` resolves `{ available, platform: "android", backgroundPlayback, secureStorage }`.
- Lock-screen / notification controls come from the MediaSession and the
  foreground notification (Play/Pause, Stop). Audio focus: pause on
  `AUDIOFOCUS_LOSS` / transient loss, duck to 20% on
  `AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK`, restore on gain (a transient pause
  resumes; an explicit web-layer hush uses pause/stop and never auto-resumes).
  `ACTION_AUDIO_BECOMING_NOISY` pauses. No autoplay: nothing plays until the
  web layer forwards an explicit user tap.
- State changes are broadcast inside the app and re-emitted to JS as the
  `playbackStateChange` listener event (`{ playing, trackId, reason }`).

## Audio assets

The web player synthesises the same four tracks in-browser. The native service
needs real files, so `tools/prep-sound-render-wavs.mjs` renders deterministic,
seeded WAV loops (original generated noise/pads only, no samples) into
`android/src/main/assets/prep-sound/`. Re-run it with:

```sh
node tools/prep-sound-render-wavs.mjs
```

Output is byte-deterministic for a given script version. Do not hand-edit the
WAVs; change the recipe in the script and re-render.

## Secure storage

`setSecret({ key, value })`, `getSecret({ key }) -> { value: string | null }`,
`removeSecret({ key })`. Backed by `SecureStore`: an AES-256-GCM key generated
in the Android Keystore (`AndroidKeyStore`, never exported), 12-byte random IV
per write, ciphertext Base64-stored in private SharedPreferences. No
`EncryptedSharedPreferences` dependency. Keys must match
`^[A-Za-z0-9._-]{1,64}$`; values are capped at 8192 chars. Values and ciphertext
are never logged. The only current caller stores the Spotify refresh token
under `prep_sound_spotify_refresh_token`, on native Android only.

## Store note

This is native code. An OTA/web update cannot deliver it: phones need a new
store (or internal-track) build that includes this plugin before
`prep-sound-native.js` or the Spotify secure restore can run.
