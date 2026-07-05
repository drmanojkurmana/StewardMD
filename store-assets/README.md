# StewardMD — App Store Screenshots

Store-ready, HD marketing screenshots for the App Store and Google Play launch,
rendered from live captures of the app (real UI — no mockups) and framed with the
StewardMD brand.

## Sizes

| Store | Folder | Dimensions | Notes |
|-------|--------|-----------|-------|
| Apple App Store | `apple/` | **1290 × 2796** | 6.7″ iPhone, realistic iPhone-Pro frame (Dynamic Island + 9:41 status bar); largest required set — App Store Connect down-scales to smaller devices |
| Google Play | `google-play/` | **1080 × 2160** | Phone (2:1 max ratio — needs its own size; Apple's cannot be reused) |

`raw-app-screens/` holds the unframed source captures (device viewport only), in
case you want to re-frame or crop differently.

## The 12 screens (same order in both folders)

1. **01-home** — brand hero + clinical tools
2. **02-meningitis** — findings → QUICK DECISION (diagnosis, disposition, first-line regimen)
3. **03-cholangitis** — time-critical empiric therapy + source control
4. **04-tb-renal-hepatic** — patient-specific safety: auto CrCl, per-drug renal & hepatic dose adjustment (pulmonary TB)
5. **05-pyelonephritis-dosing** — renal / hepatic / QT dose checks tuned to age, weight & creatinine
6. **06-drug-interactions** — medication safety check (major interactions, duplicates, QT)
7. **07-antibiogram** — antibiotic-coverage grid (spectrum of activity)
8. **08-knowledge-library** — 480+ conditions, drugs & guidelines search
9. **09-live-reasoning** — live differential reasoning workspace
10. **10-home-dark** — dark mode (home)
11. **11-meningitis-dark** — dark mode (decision screen)
12. **12-antibiogram-dark** — dark mode (coverage grid)

## Upload guidance

- **Apple**: one 6.7″ set is the minimum required; these auto-scale. 3–10 images.
- **Google Play**: 2–8 phone screenshots. A separate 1024 × 500 feature graphic is
  also required by Play — included (see below).
- The Apple set uses a realistic iPhone-Pro device frame (Dynamic Island +
  9:41 status bar). The Play set uses a clean frameless-style device. Device
  frames are optional for both stores — only the exact pixel dimensions are
  enforced.

All clinical output shown is decision-support only and carries the app's in-product
"verify locally / not a substitute for clinical judgment" disclaimers.

## Store graphics (icon + feature graphic)

- `app-icon-1024-teal.png` / `app-icon-1024-white.png` — 1024×1024 marketing icon,
  two background options. App Store: use one, no transparency, square (Apple rounds it).
  Play uses the existing `android-chrome-512x512.png` for the app icon.
- `google-play/feature-graphic-1024x500.png` — required Play Store feature graphic.
