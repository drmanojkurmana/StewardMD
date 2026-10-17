# Code Blue design contract (v2.1)

Binding for every Code Blue screen on web, Apple Watch and Wear OS. Produced from the brand, design, anti-ui-slop and ui-ux-pro-max passes. Owner rules win over generated suggestions: restrained, no glows, gradients, backdrops or logo banners; no emojis; no em-dashes in text.

## 1. What this is
An emergency timer and documentation tool used in seconds, under stress, often one-handed, often at arm's length, sometimes in a dark ward. The screen is read at a glance (is the clock running, what is due next) and operated with a thumb. It is a calm instrument, not a dashboard and not a game. Practice screens share the same identity but are always badged TRAINING.

## 2. Identity
- Character: clinical, quiet, exact. Think resuscitation trolley labels and a good monitor, not a marketing site.
- Surfaces: dark first. Web dark surfaces are #071318 (canvas), #0D1D23 (raised), 1px lines #1E343B. Web light: #F4F6F5 canvas, #FFFFFF raised, lines #CFDBD7. The watch keeps its existing SMDPalette canvas and surface (black, #12141C); the Wear OS app keeps its SmdWearTheme. Only the STATE colours below are shared across all three so a colour means the same thing everywhere.
- Accent for actions and the running state: #42CDB5 on dark, #0C6E5E on light. One accent only.
- Type: system UI stack (SF Pro, Roboto, system-ui). No webfont download in an emergency tool. Numbers always use tabular figures (`font-variant-numeric: tabular-nums`, SwiftUI `.monospacedDigit()`). Scale (web, px): 12 label, 14 secondary, 16 body, 20 action label, 28 section, 64 to 72 the clock. Weight 600 for actions, 800 only for the TRAINING badge and the clock.
- Radius 8 for controls and tiles, 12 for sheets. Borders 1px. No shadows, no blur, no gradient, no glow, no inner highlights.
- Icons: simple monoline SVG (Lucide style, 1.75 stroke), never emoji, never decorative. Every icon sits beside a text label except the close and back controls (which carry an aria-label).

## 3. State colours (shared across platforms)
| State | Meaning | Dark | Light |
|---|---|---|---|
| running | clock running, nothing due | #42CDB5 | #0C6E5E |
| due | rhythm check or epinephrine due | #FFC53D | #8A5A00 |
| overdue / shock | epinephrine overdue, shock action | #FF453A | #B3261E |
| rosc | ROSC achieved | #30D158 | #17803A |
| paused | CPR paused | #9DB8B1 | #3D5650 |
Rule: colour is never the only signal. Each state also has a text word ("Due", "Overdue", "ROSC", "Paused") and a shape change (border style or icon). Contrast of text on each state tile is at least 4.5:1, UI components at least 3:1.

## 4. Phone live code screen (390 x 844 reference, works from 360 wide)
Single screen, no navigation during a code. Top to bottom:
1. Status row (44 px): mode chip (Adult, Paediatric, Neonatal), audio toggle, Close (confirm if running).
2. Clock block: elapsed mm:ss at 64 px, below it "Cycle 3" and the rhythm-check countdown as a thin 4 px linear bar that drains left to right (no ring, no easing, linear) with the seconds as text.
3. Due strip: one line that always shows the single most important next thing from the AlgorithmGuide ("Shock", "Epinephrine due 0:42", "Rhythm check 0:08", "Give breath"). State colour is a 4 px left border plus the word. When nothing is due it reads "CPR in progress".
4. Action grid: 2 columns, tiles at least 64 px tall, 12 px gap, safe-area aware. Order by use: Shock, Epinephrine, Rhythm, Pause, Procedure, Note, ROSC, Re-arrest (only after ROSC replaces Pause). Each tile: icon, label, small count or last-time line ("2 given, last 3:10 ago"). Tap gives instant state change (under 100 ms), a short haptic where the platform allows, and an undo toast for 5 seconds. No confirmation dialogs for logging actions; End and Reset are the only confirmed actions.
5. Footer: Log (opens sheet), Checklist (post-ROSC, appears at ROSC), End.
The disclaimer appears once on entry and in Settings. Training runs on a sped-up clock and shows the TRAINING badge in the status row.
Required states: idle (mode picker), running, paused, rhythm check due, epinephrine due, epinephrine overdue, ROSC, post-ROSC checklist, re-arrest, resume prompt, ended summary, empty log, audio blocked (browser needs a tap), offline (fully works), error (storage full).
Thumb zone: the primary actions sit in the lower 60 percent. Nothing important is only reachable at the top edge.

## 5. Audio vocabulary (web: Web Audio + speechSynthesis; native: AVSpeechSynthesizer / TextToSpeech)
Audio starts only after the first tap on Start (browser rule). Cue classes can be muted independently: Voice, Metronome, Breaths.
- Voice (plain, short, en-GB or en-IN voice if present, fallback default): "Rhythm check in ten seconds", "Rhythm check. Switch compressor", "Epinephrine due", "Epinephrine overdue", "Shock logged", "ROSC logged", "Give breath" (only when the breath cue is on).
- Metronome: 110 per minute click, short sine tick 1 kHz, 25 ms, constant volume; ducks voice never the other way (voice at full volume, tick ducks 6 dB while voice plays).
- Breath cue: lower soft tick (600 Hz) every 6 s with an advanced airway; in 30:2 or 15:2 the cue is spoken once per cycle ("Two breaths"); neonatal 3:1 uses a 3-count tick.
- Never use alarm-like sounds for routine events. One distinct two-tone only for overdue epinephrine, once.
- Silent mode: all visual states still change; the due strip is the only requirement for safe use without sound.

## 6. Customisation
- Themes (7): Night Shift (default dark), Ward Light, High Contrast (white on black, 7:1), Red Room (dark red-tinted neutral for dark adaptation, keeps state words), Mono (greyscale plus state words), Sepia Light, Auto (follows system). Themes only change surfaces and lines; state colours stay recognisable and contrast is re-verified per theme.
- Layout: action tiles can be reordered and hidden; up to 4 custom buttons (label plus log kind note). Defaults restore in one tap.
- Size: text size 90 to 130 percent; UI size small, standard, large (tile height 56, 64, 76 px). Reduced motion switch honours the system setting by default.
- Stored on device. Applied by one shared prefs module to the live, trainer, ECG and sheet screens.

## 7. Motion (the only motion allowed)
- The countdown bar drains linearly in real time (it is data, not decoration).
- State change: colour and label cross-fade 140 ms. Press feedback: scale 0.97 for 80 ms. Sheets: 200 ms ease-out slide. Toasts: 160 ms fade.
- Overdue: one non-looping attention pulse on the due strip (2 beats), then static. No looping animation anywhere in a code screen.
- `prefers-reduced-motion` and the in-app switch remove everything above except the colour change.

## 8. ECG and practice screens
Same tokens. ECG paper uses a quiet grid (minor 1 mm at 12 percent, major 5 mm at 28 percent line colour), ink in foreground colour at 1.6 px, a lead label in 12 px, and the word "schematic" always visible. Ink for ST elevation uses the overdue colour only with a text label "ST up" beside the number. No decorative waveform backgrounds.

## 9. Anti-slop finish gate (every screen, before it is called done)
- [ ] No gradient, glow, blur, drop shadow, glass or neon anywhere.
- [ ] No emoji or stock-icon-in-a-circle decoration; every icon has a job and a label.
- [ ] No identical three-card grids or hero blocks; layout follows the task order in section 4.
- [ ] Real content in every state (real mm:ss, real counts, real prompts), no lorem or "Item 1".
- [ ] Every state in the required-states list is rendered and looked at (screenshots).
- [ ] 360 and 390 px, light and dark, large text 130 percent, reduced motion: no clipping, no horizontal scroll, targets at least 44 px (tiles 64).
- [ ] Contrast checked per theme; colour is never the only signal.
- [ ] Works one-handed and offline; nothing needs a network call.
- [ ] Copy: short, plain, British spelling, no dashes as punctuation, abbreviations expanded on first use, no doses in new content.
- [ ] Compared against this contract, not just "no console errors".

## 10. Out of scope here
Native audio on a locked screen, Live Activity, watch haptics and store builds are the native phase (needs Xcode, devices and the Android signing key). The web phase must not depend on them.
