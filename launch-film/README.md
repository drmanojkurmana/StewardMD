# StewardMD 30-second launch film

`out/stewardmd-launch-30s.mp4`: 1920x1080, 30 fps, exactly 30.000 s (900 frames), H.264 High
+ AAC 48 kHz stereo, with sound design.

The film is built with the architecture of [NullMotion](https://github.com/blixvip/NullMotion) (its
HyperFrames compositions and frame-accurate exporter), and every product frame is a real
StewardMD screen. There are no mock-ups, invented features or invented numbers.

## The five capabilities

I reviewed the whole repository before choosing: the code, the `vault/` notes,
`STEWARDMD_OVERVIEW.md`, the flag registries and the store/site assets. I also ran the app. There
are about 40 feature areas. Each was scored on clinical value, differentiation, implementation
maturity, visual demonstrability, how quickly a viewer understands it, and "wow" factor. The five
also had to read together as one platform, following one patient and one clinician.

| # | Capability | What the film shows | Why it made the cut |
|---|---|---|---|
| 1 | **Dx My Patient**: live clinical reasoning (`reasoning.js`) | Home, then Dx Patient. Four findings are entered, the guided consult asks one question ("Altered sensorium?"), and the clinician taps *Present · add*. The ranked differential follows, with the engine's own "What changed" line (for example "Viral (Aseptic) Meningitis fell (91→62)"). | Fully working and in production. A deterministic, explainable engine, which is rare in a market of black-box chatbots. It is the clinical entry point for everything else, and the differential updating on screen is easy to follow. |
| 2 | **Antimicrobial stewardship**: stewardship page + ICMR antibiogram (`reasoning.js`, `antibiogram*.js`) | The same case continues to the stewardship page: QUICK DECISION (Acute Bacterial Meningitis, Ceftriaxone 2 g IV q12h, ICU/HDU). Then the ICMR AMRSN 2024 resistance rates on the phone, and the full coverage grid on an iPad in landscape. | This is the product's namesake and its strongest differentiator: national ICMR AMRSN 2024 data across 5 Indian regions plus 20 hospital antibiograms. It is fully working and very visual (the heat-map grid), and it follows directly from capability 1 as one workflow. |
| 3 | **MaiK**: grounded clinical AI (`maik-engine.js`, `functions/api/ai`) | "Grounded · AI-generated, verify independently". A clinician's question, then a MaiK Evidence Review answer with numbered citations, revealed top-down the way MaiK streams. | Fully working (3-tier routing, streaming on native). It is grounded in the StewardMD knowledge base, and the Intent Firewall keeps it clinical-only. It is the "wow" moment, and it is honest: the UI says advisory, verify. |
| 4 | **ICU workstation** (`icu.js`, `icu-autoscores.js`) | A synthetic septic-shock patient: header vitals, live status tiles with trends, electrolyte alerts, "Critical: NEWS2 10", and the qSOFA 2/3 critical alert that the engine computed from charted values. | Core dashboard and auto-scores are live. It is StewardMD's flagship workstation, it is clinically weighty, and it looks striking (red CRITICAL header, sparkline tiles). It shows that StewardMD covers the sickest patients, not just a reference shelf. |
| 5 | **Apple Watch companion** (`ios/StewardMDWatch`, `native-watch.js`, `watch-lab.js`) | Lab Watch critical-lab alert, then the Code Blue timer, on Apple Watch Ultra. | Fully working native watchOS (and Wear OS) app with tests. It extends the platform to a third device and takes it off the screen and onto the wrist. The ICU's "Lab Watch 24/7" leads straight into it. |

### Considered and left out (and why)

- **ONCQIS / OncoTree oncology** is production-approved and deep (267 regimens). In a local build,
  though, every protocol card reads "DRAFT - NOT ACTIVATED" (activation is a server-side approval
  workflow), and showing that would undercut the film.
- **KardiQ X / ThoreX / FundX / SknX imaging AI**: the vault calls these clinically unvalidated and
  regulatory-pending, and a real result needs live inference. The `*_demo` flags that return canned
  results must never be used (`vault/Flags.md`), so the film does not show fabricated
  classifications.
- **MaiK Scribe (voice)** was a close sixth: fully working and multilingual. It is referenced on
  screen by the "Speak about your patient · MaiK Scribe" button in capability 1.
- **OPD Queue / EMR**: live, but the only existing captures contain a real patient name. Recreating
  the flow needs a signed-in hospital context. PHI was not an option.
- **FollowCare, calculators (420), drug interactions, RadioAnatome, SURGX, CliniX, NMC Logbook**:
  all real, but each is either less visual in 4 seconds, flag- or content-gated, or aimed at a
  different audience (students, residents, patients).

## 9:16 Instagram Reel (`reel/` → `out/stewardmd-reel-45s-9x16.mp4`)

1080x1920, 30 fps, exactly 45.000 s (1350 frames), H.264 + AAC, about -15.5 LUFS. The five
capabilities, story and real screens are the same as the film. It is re-authored for vertical and
for how StewardMD actually ships:

- **Platforms.** StewardMD runs on iPhone, iPad and Android, with an Apple Watch and a Wear OS
  companion; only OPD is on the web. The reel therefore shows phones, an iPad and a watch: no
  desktop. The antibiogram grid is shown on the phone turned to landscape, which the app
  itself prompts ("Rotate for a wider view"). It is captured at 844x390 (iPhone landscape) with
  iOS landscape safe-area insets. The finale brings in the iPad (antibiogram coverage grid, the real iPad
  capture) and an Android phone (punch-hole body) running the same app bundle. The end card names
  the real platforms (iPhone, iPad, Android, Apple Watch, Wear OS)
  and the one web surface ("OPD on the web · stewardmd.in").
- **Wear OS** is real (`android/wear`: labs, Code Blue, watchlist), but the repo has no render of
  its UI. It is therefore named in the copy, in the site's own words ("The same alert reaches
  your phone and your Apple Watch or Wear OS"), not drawn.
- **Pacing about 0.8x the film.** Motion runs about 1.25x longer, and each capability holds 6-7 s,
  so copy and UI read on a phone.
- **Look.** White background (the app's paper and ink), the site's serif headlines with a teal
  italic, headlines revealed word by word through masks, large lifted UI cards, and soft shadows.
  All key text sits inside Instagram's safe area (y 230-1480).
- **MaiK** uses the site's higher-resolution capture `_site/assets/s/maik.png` (dengue question,
  Evidence Review, Bottom Line, citations) so it stays sharp at 1.3x phone scale.

| Time | Section (`reel/sections/`) | Beat | Device moves |
|---|---|---|---|
| 0-4.5 | `01-open.js` | Teal mark on two heartbeat pulses, wordmark with clipped sheen, *Clinical intelligence workspace*; the iPhone rises with the home screen. | phone rises |
| 4.5-11.5 | `02-reason.js` | **01 Reason**: tap Dx Patient, the guided question, *Present · add*, lifted findings, Review differential, lifted "What changed", tap *Open full stewardship page*. | in-screen pushes |
| 11.5-18.5 | `03-steward.js` | **02 Steward**: stewardship page, QUICK DECISION lifts, then the phone turns to landscape for the ICMR coverage grid, panning. | rotate to landscape |
| 18.5-25.5 | `04-maik.js` | **03 Ask MaiK** (MaiK wordmark): the phone turns upright into MaiK; the question lifts, the answer streams, the Bottom Line and Evidence Review header lift. | rotate upright, tumble out |
| 25.5-32.5 | `05-icu.js` | **04 Monitor**: ICU dashboard; the vitals strip, Current status (NEWS2 10) and qSOFA 2/3 alert lift. | tumble in, step back |
| 32.5-38.5 | `06-watch.js` | **05 On the wrist**: Apple Watch rises in front of the ICU phone; critical labs, then a wrist flick to Code Blue. | watch rises |
| 38.5-45 | `07-finale.js` | "One workspace, *pocket to wrist.*": iPad, iPhone, Android and Watch together with the five named; then the end card: "When the clinical decision matters, *open StewardMD.*", platforms, OPD on the web, fine print. | converge, recede |

Reel review pass (first full render → final):

| Problem in reel v1 | Fix |
|---|---|
| The phone peeked in at the bottom edge during the logo (about 1.5 s) | Rise starts from y 2250, fully off-frame |
| On white, the white wordmark sheen erased letters mid-sweep ("Ste ardMD" at about 2 s) | Sheen is a narrow teal glint, clipped to the letterforms |
| MaiK "Bottom Line" card rendered behind the phone screen (shared 3D space z-sorted the screen above it) | Reel sections are flat; stacking follows DOM order and each device and card has its own perspective |
| Stray outline ring on the finale's first frames; chips wrapped 4+1 | Ring starts hidden; chip row balanced 3+2 |
| Phone small for a phone-sized screen; kicker small; orphan word in the ICU subline | Phone 1.2x → 1.3x, kicker 19 → 22 px, subline shortened |

Render: `python3 audio/soundtrack.py reel && node render/render.mjs --comp reel`.
Preview: `http://localhost:8991/launch-film/reel/index.html#play` (or `?section=r04-maik`, `?t=21`).

## Story and timeline, 16:9 film (exact cues: `film/lib.js` `F.T`)

| Time | Section file | Beat | Devices |
|---|---|---|---|
| 0.0-3.0 | `01-open.js` | The StewardMD mark resolves on two heartbeat pulses. The "Steward**MD**" wordmark wipes in with a sheen, followed by the kicker *Clinical intelligence workspace* (the site's own line). The identity lifts away as the phone rises showing the real home screen. | iPhone |
| 3.0-7.6 | `02-reason.js` | **01 Reason**: "A differential that updates *with every finding.*" Tap Dx Patient. The guided question comes up and the clinician taps *Present · add*; the findings lift out. Tap Review differential, scroll to the ranked list with the lifted "What changed" line, then tap *Open full stewardship page*. | iPhone |
| 7.6-12.2 | `03-steward.js` | **02 Steward**: "Antimicrobial stewardship *at the point of prescribing.*" The stewardship page appears and the QUICK DECISION card lifts. An iPad slides in with the ICMR coverage grid panning, while the phone moves to resistance rates. | iPhone + iPad |
| 12.2-16.8 | `04-maik.js` | **03 Ask MaiK**: "Clinical questions. *Grounded, cited answers.*" The phone swings across. The question lifts, the answer streams in, and the evidence-review header with citations lifts. | iPhone |
| 16.8-21.4 | `05-icu.js` | **04 Monitor**: "An ICU workstation *that scores as you chart.*" The header vitals strip lifts, the view scrolls to Current status (NEWS2 10), and the qSOFA critical alert lifts. | iPhone |
| 21.4-25.4 | `06-watch.js` | **05 On the wrist**: "Critical labs and Code Blue, *on Apple Watch.*" The watch rises showing a critical-lab alert, then a wrist flick to Code Blue. | Apple Watch |
| 25.4-30.0 | `07-finale.js` | Convergence: desktop (stewardmd.in), iPad (antibiogram), iPhone (home) and Watch (Code Blue) arrive together as one platform, with the five named in a row. They recede into the site's line "When the clinical decision matters, *open StewardMD.*", then **STEWARDMD.IN** and the fine print "Clinical decision support for registered medical practitioners." | all four |
| 0-30 | `00-background.js` | A deep-teal field with the site's faint grid. An accent glow changes colour with each capability (dx violet, stewardship red, MaiK teal, ICU red, watch orange, platform teal). | |

Consecutive sections share a device. Each outgoing section ends on the exact state the next one
starts from (same phone, pose and screen scroll), so every cut is invisible.

## Review pass (first render → final)

The first full render was checked frame by frame (2 fps contact sheet plus full-size frames).
These problems were found and fixed:

| Problem in v1 | Fix |
|---|---|
| Wordmark sheen drawn as a band across the whole frame; a grey smear beside "StewardMD" (1.0-1.6 s) | Sheen is now a copy of the wordmark filled with a moving highlight and clipped to the letterforms |
| Identity still on screen while the phone rose through it (2.4-2.7 s) | Identity exits 0.25 s earlier; phone rise shortened and starts later |
| Mark small in the opening, and first wordmark beat late | Mark 150→170 px; wordmark and kicker land 0.15-0.2 s sooner |
| First "What changed" capture had no change line: all five findings were added in one batch, so the crop framed "Dominant system" instead | Capture now follows the real guided-consult flow (four findings, then *Present · add* on the suggested "Altered sensorium"), and crop rectangles are measured from the DOM (`film/rects.js`) instead of estimated |
| "What changed" lift too small to read | Enlarged to 1.62x, placed beside the phone |
| Lifted cards crossing into the headline column (MaiK, ICU) | All lifts are positioned by their right edge (≤ x 1030); the MaiK copy column is narrowed, and the "Grounded" strip lift was dropped (translucent, read as grey) |
| MaiK phone looked blank for about 1 s while the answer "streamed" | Stream starts at 0.4 s and runs 1.2 s |
| iPad and resistance captures still showed the app's one-time "Rotate for a wider view" hint | Capture waits 5 s for the hint to time out |
| Finale: the tilted iPad sliced through the desktop's plane (shared 3D space), and the capability chips did not render | Flat finale rig, each device with its own perspective and explicit stacking; chip backdrop-filter removed |
| Finale end card undersized; iPad clipped at the left edge | Line 84→96 px, mark 112→132 px, URL larger; iPad moved in |
| Audio: heartbeat and impact peaks far above the bed; -13.4 LUFS overall | Rebalanced (heartbeat and impact down, pads and plucks up), master about -15 LUFS / -3 dBFS |

## Sound design (`audio/soundtrack.py` → `audio/soundtrack.wav`)

All synthesized and seeded (no samples, nothing to license). It is cued to the same timings as
the picture:

- **Score**: warm pad chords that change with each capability (D-major colour), plus a soft pluck
  arpeggio at 112 bpm from capability 1 to the finale.
- **Heartbeat**: a lub-dub under the opening mark pulses.
- **Whooshes**: filtered-noise sweeps on every device move.
- **UI foley**: a click on every on-screen tap, a glassy chime on every lifted UI card, a soft
  two-tone on the qSOFA alert, and a haptic double-tick on Code Blue.
- **Finale**: a riser into the convergence, a sub impact with shimmer, and a bell chord on the end
  line.
- **Master**: reverb, gentle limiting, about -15 LUFS integrated, -3 dBFS peak.

## Assets used

| Asset | Path | Notes |
|---|---|---|
| StewardMD mark | `/mark-white.png` | opening, finale |
| Wordmark styling | app header "Steward" + teal "MD" | set in Inter, as `index.html` does |
| MaiK wordmark | `/maik-wordmark-white.png` | capability 3 |
| Brand colours | `redesign-system.css` (`#0F766E`, `#115E59`, sphere `#2f9184 → #06231e`), `_site/index.html` | |
| Type | Inter (`assets/fonts/inter-variable.woff2`, from the repo); Newsreader (the site's headline serif, OFL, from Google Fonts, in `assets/fonts/`) | headline style matches the site: serif with a teal italic |
| Lines of copy | "Clinical intelligence workspace", "When the clinical decision matters, open StewardMD." are the site's own; capability copy is written from what each screen shows | no statistics or claims beyond the screens |
| Device frames | iPhone / iPad / desktop drawn in CSS (`film/film.css`); Apple Watch Ultra renders from the repo | iPad is a supported target (`TARGETED_DEVICE_FAMILY = "1,2"`) |
| GSAP 3.14.2 | `vendor/gsap.min.js` | copied from NullMotion `public/_vendor/`, licence header kept ([standard licence](https://gsap.com/standard-license)) |

## Source of every product screen

Nothing is drawn by the film. Each screen is one of these real captures:

| Film file | Source | How it was produced |
|---|---|---|
| `assets/screens/home.jpg` | the app's home (`home.js`) | `capture/capture-screens.mjs`: the real app in headless Chromium at 390x844 @3x (iPhone), first-run overlays removed |
| `dx-findings-4.jpg`, `dx-findings-5.jpg` | Dx My Patient (`reasoning.js`) | same script; findings entered through `DX.addFindings`, the fifth by clicking the guided consult's real *Present · add* button |
| `dx-differential-tall.jpg` | Dx My Patient → Review differential | same run, 390x2000 viewport so the film can scroll it |
| `stewardship-tall.jpg` | *Open full stewardship page* for that case | clicked from the differential |
| `antibiogram-resistance-tall.jpg` | Antibiogram → Resistance rates (`antibiogram.js`, ICMR AMRSN 2024) | home tile → tab |
| `antibiogram-grid-ipad-tall.jpg` | Antibiogram → Antibiotic coverage | 1180-wide iPad landscape viewport |
| `antibiogram-grid-phone-landscape-tall.jpg` (reel) | Antibiogram → Antibiotic coverage | 844-wide iPhone landscape viewport, after the rotate hint times out |
| `icu-overview-tall.jpg` | ICU workstation overview (`icu.js`) | **synthetic** patient "Demo Patient", charted through `ICU.ingestPatient/Monitor/Labs/Flowsheet/Ventilator`. Every score and alert on screen is the app's own computation from those values. |
| `site-desktop.jpg` | stewardmd.in home page (`_site/index.html`) | 1440x900 @2x desktop |
| `/_site/assets/s/maik-2.png` (film), `maik.png` (reel) | MaiK answer screen | a repo asset: the StewardMD site's own MaiK capture, used unchanged |
| `/_site/assets/s/watch-frame-critical.png`, `watch-frame-codeblue.png` | watchOS app (`ios/StewardMDWatch/CriticalLabsView.swift`, `CodeBlueView.swift`) | repo assets: the site's own Apple Watch Ultra renders, used unchanged |

Crop rectangles for the lifted UI cards are measured from the live DOM during capture
(`film/rects.js`, generated). A lifted card is always exactly the named element.

**Rendering note.** On iOS the app's font stack resolves to the system font. Headless Linux has
no SF Pro, so during capture `-apple-system` / `system-ui` / `sans-serif` were mapped to Inter
(bundled in the repo) with a fontconfig alias. Without it, the captures fall back to DejaVu.

**No PHI.** All clinical data on screen is synthetic or reference data. The watch renders show
the test patient the site already ships.

## How it maps onto NullMotion

| NullMotion | Here |
|---|---|
| HyperFrames composition: 1920x1080 `#root[data-composition-id]`, `<meta name="hyperframes">` | `film/index.html` |
| One paused GSAP timeline per composition, `window.__timelines.root`, finite (no infinite repeats) | `FILM.build()` in `film/lib.js` |
| Sections / clips with `data-start`, `data-duration`, `data-track-index` | one file per section in `film/sections/`, registered with `FILM.section({...})` |
| Frame-accurate export: seek the timeline to each frame's time and capture it; nothing is recorded in real time | `render/render.mjs` (Playwright seek, JPEG q98 frames piped to ffmpeg/x264 CRF 16; NullMotion's WebCodecs path needs an H.264 encoder in the browser, which headless Chromium lacks) |

## Edit and export

```sh
# 0. once: Node 22, Playwright (Chromium), Python 3 with numpy scipy pillow, ffmpeg with libx264
#    and the Inter fontconfig alias above (only needed to re-capture screens).
cd <repo root>
node test/serve.mjs . 8991 &                        # serves the app and the film

# 1. (optional) re-capture the real screens and crop rects from the current app
node launch-film/capture/capture-screens.mjs       # -> assets/screens/raw/*.png + film/rects.js
python3 launch-film/capture/prepare-screens.py     # -> assets/screens/*.jpg

# 2. sound
python3 launch-film/audio/soundtrack.py            # -> audio/soundtrack.wav (film)
python3 launch-film/audio/soundtrack.py reel       # -> audio/soundtrack-reel.wav (reel)

# 3. preview in a browser
#    http://localhost:8991/launch-film/film/index.html#play            whole film, real time
#    http://localhost:8991/launch-film/film/index.html?section=s03-steward   loop one section
#    http://localhost:8991/launch-film/film/index.html?t=14.5           one exact frame

# 4. render
node launch-film/render/render.mjs                 # -> out/stewardmd-launch-30s.mp4 (30 fps)
python3 launch-film/audio/soundtrack.py reel
node launch-film/render/render.mjs --comp reel     # -> out/stewardmd-reel-45s-9x16.mp4
node launch-film/render/render.mjs --fps 24        # 24 fps variant
node launch-film/render/render.mjs --stills 3.5,14.2   # PNG stills for review
```

To edit, change a cue in `F.T` (`film/lib.js`) and in `T` (`audio/soundtrack.py`). Each section
reads its window from those values, and section-local times are relative to the section start.
Copy lives in each section's `F.copy(...)` call.
