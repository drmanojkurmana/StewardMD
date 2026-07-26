# WARD_ROUND_VIDEO_MANIFEST.md
### Feature Manifest for the cinematic advertisement **"The Ward Round"**
Production-ready context for an AI video model (Gemini Omni / Veo). Every screen, label, color, and interaction below is taken from the real StewardMD codebase — nothing here is invented. Where a common name (e.g. "Lab Interpretation", "Drug Index") does **not** exist in the app, the real feature name is used and the discrepancy is flagged.

> Scope: this manifest covers ONLY the three workflows featured in the ad — the **Electrolyte Correction Engine** (corrected calcium), the **Drug Database** with **Renal dose**, and the **Clinical Calculators** (CHA₂DS₂-VASc) — plus the shared home/navigation shell and design system needed to render them faithfully. It deliberately omits unrelated parts of the app.

---

## 1. Product Summary

StewardMD is a mobile clinical-decision-support app for doctors (native iOS/Android via Capacitor, plus web). Its own tagline is **"Smart Clinical Decision Support for Doctors"**; the app also brands itself an **"Antibiotic Decision Engine."** It is developed by **MaiKnowledge** (Dr. Manoj Kumar Kurmana, MD) under the credit line *"Merging AI with Infinite Knowledge."*

On a hospital **ward round**, a doctor moves bed to bed making fast, high-stakes decisions with incomplete information: *Is this calcium really low once you correct for albumin? What dose of this antibiotic is safe in renal impairment? Does this patient with atrial fibrillation actually need anticoagulation?* StewardMD collapses the three tools a clinician would otherwise juggle — a lab interpreter, a formulary, and a calculator — into one pocket app with a single, consistent interface.

The featured value on rounds:
- **Electrolyte Correction Engine** — enter the electrolyte panel and it interprets each analyte (with reference ranges, severity, and critical warnings) and generates concrete ICU correction guidance. It computes **corrected calcium** (`Ca + 0.8 × (4 − albumin)`) automatically.
- **Drug Database** — 400,000+ Indian brands searchable by molecule or brand, opening to a structured monograph (Quick Facts, dosing, indications). For antibiotics, a one-tap **Renal dose** tool computes the CrCl-adjusted dose (Cockcroft-Gault), so dosing in renal impairment is exact, not guessed.
- **Clinical Calculators** — 405 bedside calculators across 20 specialties (MDCalc-scale), including **CHA₂DS₂-VASc** for stroke risk in atrial fibrillation, returning the score plus the annual stroke risk and the anticoagulation recommendation.

The product feeling is calm, premium, and clinical: teal-accented, high-contrast typography, generous white space, subtle motion — decision support that feels trustworthy at the bedside.

---

## 2. Advertisement Goal

- **Target audience:** hospital physicians — residents, registrars, and consultants doing daily inpatient/ICU ward rounds; medical students. Secondary: hospital/medical-college decision-makers.
- **Clinical problem:** on rounds, clinicians make rapid decisions (electrolyte correction, renal drug dosing, risk stratification) while switching between memory, textbooks, and scattered apps — slow and error-prone at the bedside.
- **Desired emotional response:** quiet confidence and relief. "This is the calm, authoritative second opinion in my pocket." Precision, trust, and speed — never gimmicky.
- **Key message:** *One app for the whole ward round — interpret the labs, dose the drug safely, score the risk. StewardMD. Smart clinical decision support for doctors.*

---

## 3. Featured Workflow

A single, unbroken bedside sequence for one patient (an ICU/ward patient with atrial fibrillation, renal impairment, and an abnormal electrolyte panel). Every step uses the **real** navigation path from the code.

```
Home (rnav shell, body.ui-v2)
        │
        │  tap "Electrolytes" tile   → data-act="electrolytes" → ELYTE.open()
        ▼
Electrolyte Correction Engine  (overlay #eceOverlay)
   enter Calcium + Albumin (+ any panel values)
        │  tap "🧮 Analyze & Generate ICU Recommendations"
        ▼
   Results → Calcium card shows CORRECTED CALCIUM  = Ca + 0.8 × (4 − albumin)
        │  return to Home  (Home FAB / back)
        ▼
Home
        │  tap "Drugs"   → data-act="drugmenu" → bottom sheet → "Drug Database" → MEDDB.openList()
        ▼
Drugs Database  (overlay #dbOverlay)
   search an antibiotic (e.g. "Meropenem")  → open the molecule detail
        │  antibiotic detail shows the teal "Renal dose" button
        │  tap "Renal dose"  → SMD_RENAL_DOSE.open()
        ▼
   Renal dose sheet  → tab "From labs" → enter Age / Weight / Creatinine
        │  → CrCl (Cockcroft-Gault) + impairment band + exact adjusted dose
        │  return to Home
        ▼
Home
        │  tap "Calculators"  → data-act="calculators" → MEDCALC.openList()
        ▼
Clinical Calculators  (overlay #mcOverlay)
   search "CHA2DS2" (or category "Cardiovascular") → expand CHA₂DS₂-VASc card
        │  tick CHF / Hypertension / Diabetes / Prior stroke; enter Age; select Sex
        ▼
   Result: score (points) + annual stroke risk % + anticoagulation recommendation
```

> Truthfulness notes: There is **no** screen called "Lab Interpretation" — the real feature is the **Electrolyte Correction Engine**. There is **no** home tile literally labeled "Drug Index" — the entry point is **"Drugs"**, which opens a bottom sheet whose row is **"Drug Database."** All routes above are dispatched by the `ACT` map in `home.js` (`electrolytes`→`ELYTE.open()`, `drugmenu`→sheet→`MEDDB.openList()`, `calculators`→`MEDCALC.openList()`).

---

## 4. Screen Inventory

### 4.1 Home (rnav shell — the default on native `body.ui-v2`)

- **Purpose:** launcher / clinical dashboard; the root the app returns to.
- **Layout (top→bottom):** header → date eyebrow + greeting → **Quick-action row** (4 pill buttons) → **Hero banner** (teal gradient) → **Quick-card row** (4 cards) → **"Clinical tools"** section header → **Tools grid** → recent activity → footer → **Bottom tab bar**.
- **Header:** left menu (hamburger), brand mark (`logo.png`) + **"Steward​MD"** wordmark (the "MD" is teal-accented), spacer, then Search, theme toggle (sun/moon), notifications bell (badge count). Flat white panel with a 1px bottom border — **not** a gradient bar.
- **Quick-action row (order):** **Start Case** (stethoscope), **Dx Patient** (neurology/brain), **Drugs** (medication/pill), **Calculators** (calculate). Icons are Material Symbols Rounded.
- **Hero banner:** teal `linear-gradient(135deg, …)` card, white text: "Steward MD / Clinical decision support."
- **Quick-card row:** **Syndromes**, **Ward Sync**, **ICU**, **Antibiogram**.
- **Tools grid:** (optionally FundX AI, KardiQ X AI — access-gated), then **Dictate**, **Scan Meds**, **Electrolytes**, **Guides**.
- **Bottom tab bar (5):** **Home** (active), **Cases**, **Ask Maik** (center, elevated FAB-style, teal), **Drugs**, **More**.
- **Typography:** headings 700–800 weight; the on-device sans family renders as the system UI font (Inter/SF fallback chain).
- **Colors:** page `#F8FAFC`, panels `#FFFFFF`, ink `#0F172A`, teal `#0F766E`, teal-soft `#CCFBF1`, muted `#64748B`.
- **Icons:** Material Symbols Rounded (self-hosted).
- **Scroll:** vertical, native momentum; header is sticky; bottom tab bar is fixed.
- **Loading / empty:** watchlist / resume / recent slots are hydrated only when real data exists (otherwise absent — no fake placeholders). No spinner on home itself.
- **Animation:** home appears via a plain `display` toggle (no slide). Press feedback: buttons/tiles `:active { transform: scale(.94–.985) }`.

### 4.2 Electrolyte Correction Engine (overlay `#eceOverlay`, class `.ece`)

- **Purpose:** interpret an electrolyte/lab panel and generate ICU correction guidance; compute corrected calcium.
- **Layout:** sticky top bar (back `‹ ICU Dashboard` + breadcrumb **"ICU Dashboard › Electrolyte Correction"**) → **Hero** `🧪 Electrolyte Correction Engine` / subtitle *"Evidence-based ICU electrolyte management"* → **"Patient information"** section (grid: Weight, Age, Sex, Diagnosis, ICU/Ward, Urine output; pill toggles: Renal failure, Dialysis, Liver disease, Heart failure, Pregnancy, Ventilator, Malnutrition, Alcohol) → **"Electrolytes & labs"** section (Conventional/SI unit toggle + numeric grid: Na, K, Cl, HCO₃, **Ca**, **Albumin**, Mg, PO₄, Creatinine, eGFR, Glucose, pH, Osmolality) → results container → fixed bottom CTA bar.
- **Primary CTA:** **"🧮 Analyze & Generate ICU Recommendations"** (large teal button, shadow).
- **Result blocks (in order):** (1) **Clinical summary** — value **chips**, one per analyte, colored left border + status dot (🔴/🟠/🟢); (2) **Clinical warnings** — red 🚨 alert cards; (3) **Correction engine** — detailed cards (name, value+unit, severity pill, key/value rows, evidence badges), sorted worst-first; (4) **Smart clinical insights** (💡); (5) **Monitoring plan**; (6) **Evidence** badges.
- **Corrected calcium** appears as a row inside the **Calcium** card: e.g. *"Corrected calcium — 8.9 mg/dL (measured 8.2, albumin 2.6)"* with reference "(8.5–10.5)" and an ionised-calcium note. Falls back to the measured value with an "albumin not entered" note if albumin is missing.
- **Typography:** hero title 800/24px (letter-spacing −.02em); section headers 700/12px uppercase (tracking .06em); field values 700/17px; chip value 800/22px; card title 800/16px.
- **Colors:** teal accent `#0F766E` (light) / `#2DD4BF` (dark); status ramps red `#DC2626`, amber `#B45309`, ok `#047857`, crit `#7F1D1D`, each with a soft tint; panel white, bg `#F4F6F9`.
- **Icons:** emoji-forward (🧪 hero, 🧮 CTA, 🔴🟠🟢 dots, 🚨 warnings, 💡 insights).
- **Scroll:** vertical; on Analyze the results smooth-scroll into view.
- **Loading / empty:** if no electrolyte value entered → toast *"Enter at least one electrolyte value."* If module still loading → toast *"Electrolyte engine loading…"*.
- **Animation:** overlay enters with `opacity 0→1` + `translateY(8px)→0` over `.22s`; CTA `:active { scale(.99) }`.

### 4.3 Drugs Database (overlay `#dbOverlay`, class `.db-overlay`)

- **Purpose:** search 400k+ Indian brands / molecules; open a structured drug monograph; compute renal dose for antibiotics.
- **Layout:** sticky header (`‹ Back` · title **"Drugs Database"** · hidden **"Available brands N"** button on detail · close **X**) → **search bar** (`.db-searchbar` with a magnifier icon left, input placeholder *"Search a drug or brand (e.g. pantoprazole, augmentin, monocef)…"*) → subtitle *"412,224 Indian brands · search a molecule or brand name, then open it for all brands & prices"* (count updates live) → results list (two sections: **"Brands matching …"** and **"Molecules & compositions"**).
- **Drug DETAIL screen:** header shows the molecule name, `‹ Back`, an **"Available brands N"** pill (opens a right slide-in drawer of brands with price ₹, tier filters All/Top branded/Top generic, sort Relevance/Price↑/Price↓), and close X. Body: **drug name** (`.db-gen`, 800/20px) + **category chips** (`.db-chip`, teal-soft pills, e.g. "Antibiotic", "Cephalosporins: 3 Generation"). For antibiotics, the teal **Renal dose** button appears directly under the chips. Then the monograph: a **Quick Facts** grid — **Adult dose, Meal, Pregnancy, Renal, Hepatic, Half-life, Alcohol, Monitoring** (2-col on mobile, 4-col ≥560px) — followed by **Summary** ("What is it?"), **Indications** ("When?"), Dosage, Administration, etc.
- **Buttons:** Back, Available brands, close X, tier/sort chips, "Load more", and the **Renal dose** CTA.
- **Typography:** title 800/16px; molecule name 800/20px; chips 700/10.5px capitalized; brand price 800/15px.
- **Colors:** teal `#0F766E` (on-device via `--teal`; classic-web fallback `#0a9396`), teal-soft chips, prices in teal, ink `#14202b`/`#0F172A`, lines light grey.
- **Icons:** monochrome line SVGs (search magnifier `.db-search-ic`, pills, flask, close).
- **Scroll:** vertical list; drawer scrolls independently.
- **Loading / empty:** typing <3 chars → *"Type at least 3 letters…"*; searching → *"Searching…"*; no match → *"No drugs match '…'."* Detail body shows a "…loading…" line until the monograph resolves.
- **Animation:** overlay enters via `@keyframes dbIn` (`opacity 0→1`, `translateY(8px)`, `.22s ease`); the "Available brands" button has a soft glow pulse (`dbGlow`, 1.8s); brands drawer slides in from the right (`translateX(100%)→0`, `.24s ease`); section chevrons rotate 90° on expand.

### 4.4 Renal dose sheet (bottom sheet, class `.rd-sheet` in `.rd-scrim`)

- **Purpose:** compute the renal-adjusted antibiotic dose from CrCl / eGFR.
- **Layout:** header **"🫘 Renal dose · {drug}"** + close ×; sub-line *"Renal-adjusted dosing from CrCl (Cockcroft-Gault) or a reported eGFR."*; **tabs**: **From labs** (default), **Enter CrCl / eGFR**, and **Ward Sync** (only if an EMR is connected); inputs area; result card; a decision-support footer.
- **Inputs (From labs):** Age + Weight row, Serum creatinine with mg/dL ⇄ µmol/L unit select, and a **"Female (×0.85)"** checkbox. (Enter CrCl/eGFR = a single number field; Ward Sync = patient picker that pulls latest eGFR/creatinine.)
- **Result card:** the computed **CrCl** (large), a colored **impairment band** pill (Normal ≥90 / Mild ≥60 / Moderate ≥30 / Severe ≥15 / ESRD), the source, then the **exact adjusted dose** ("give …"), or "usual dose — no reduction", or the monograph's renal prose. Draft entries carry a "verify locally" tag.
- **Colors:** button/accent teal `#0e6e63` (`--teal-dk` hover `#0b5b52`); band pills — normal/mild green `#e7f5ec/#1c7a4a`, moderate amber `#fdf2de/#92620a`, severe orange `#fdebe1/#b5460f`, ESRD red `#fbe7e9/#ab1c2c`.
- **Corner radius:** sheet `18px 18px 0 0` (mobile), fields 9px, result card 13px.
- **Animation:** scrim fades in (`rdFade`, .18s); sheet slides up (`rdUp`, `translateY(24px)→0`, `.24s cubic-bezier(.22,1,.36,1)`).

### 4.5 Clinical Calculators (overlay `#mcOverlay`)

- **Purpose:** 405 bedside calculators (20 specialties); here, CHA₂DS₂-VASc.
- **Layout:** header (`‹ Close` · title **"Clinical Calculators"** + live count badge **405**) → search input (placeholder *"Search calculators (e.g. MELD, sepsis, sodium, stroke)…"*) → **category chip row** ("All" + one chip per category with count) → grouped list (category header `mc-grp-h` → grid of accordion cards `mc-card`) → "Check Drug Interactions" button → disclaimer.
- **CHA₂DS₂-VASc card (expanded):** inputs — **Congestive heart failure / LV dysfunction** (check), **Hypertension** (check), **Age** (number, yrs), **Diabetes mellitus** (check), **Prior stroke / TIA / thromboembolism** (check), **Vascular disease (MI, PAD, aortic plaque)** (check), **Sex** (select Male/Female). A **Calculate** button, then a result box.
- **Result:** big score number (`.mc-res-num`, 800/30px teal) + unit **"points"**, then the interpretation line: *"Adjusted annual stroke/TE risk ≈ X%. Oral anticoagulation recommended at ≥2 (men) / ≥3 (women); consider at 1 (men) / 2 (women)."* Reference: *"Lip GYH et al. Chest 2010;137(2):263–72."*
- **Colors:** teal `#0F766E` inputs/focus/button; result box teal-soft bg with teal border; card `.open` gets a teal border + elevated shadow.
- **Corner radius:** inputs 10px, calculate button 14px (min-height 50px, teal, shadow), result box 14px, cards 14px.
- **Scroll:** vertical; card expands inline (accordion).
- **Loading / empty:** search no-match → *"No calculators match '…'."*; invalid inputs → dashed "Could not compute — check the inputs." Result recomputes live on each input change; also on Enter/Calculate. Note: CHA₂DS₂-VASc has **no** auto-fill bar (its inputs carry no lab hints).
- **Animation:** overlay enters via `@keyframes mcIn` (`opacity 0→1`, `translateY(8px)→0`, `.25s ease`). Score renders instantly (no dedicated result animation).

---

## 5. UI Behaviour

- **Page transitions:** tools open as **full-screen overlays layered over the home** (home is never hidden; it sits underneath at a lower z-index). Each overlay fades/rises in over ~.22–.25s. Returning to home is via the floating **Home FAB** (teal circle, bottom corner) or the platform back/swipe.
- **Button presses:** universal tactile feedback — `:active { transform: scale(.93–.99) }` on tiles, tabs, CTAs.
- **Card expansion:** calculator cards and electrolyte correction cards are accordions — tapping the head toggles an inline panel; a chevron rotates 90°; the card gains a teal border + deeper shadow when open.
- **Scroll physics:** native momentum scrolling; sticky headers; fixed bottom bars; results smooth-scroll into view after "Analyze."
- **Navigation animation:** bottom sheets (Drugs menu) slide up `translateY(100%)→0` over `.26s cubic-bezier(.2,.7,.2,1)` behind a fading scrim.
- **Search behaviour:** live, debounced (250ms) with a 3-character minimum; results split into labeled sections; tapping a result opens the detail.
- **Loading indicators:** shimmer skeletons (`rds-shimmer`, a light sweep, 1.3s) for hydrating lists; inline "…loading…"/"Searching…" text; toast messages for validation.
- **Reduced motion:** all transitions/animations are disabled under `prefers-reduced-motion` — respect this if the render needs a calmer cut.

---

## 6. Visual Design

- **Color palette (on-device native, `body.ui-v2`):**
  - Light — teal **`#0F766E`** (accent), teal-soft `#CCFBF1`, page `#F8FAFC`, panel `#FFFFFF`, ink `#0F172A`, slate `#334155`, muted `#64748B`, line `#E2E8F0`.
  - Dark — teal **`#2DD4BF`**, page `#0B1220`, panel `#111B2E`, line `#1E2B43`, ink `#E7EDF5`.
  - Status ramps: green `#1c7a4a`, amber/yellow `#92620a`, orange `#b5460f`, red `#ab1c2c` (each with soft bg + line).
  - (Classic web root uses a slightly deeper teal `#0e6e63` / dark `#3fc7b3`. For the ad, standardize on the native **`#0F766E`/`#2DD4BF`** — that is what a screen recording shows.)
- **Typography:** headings 700–800; body 500–600; a clean humanist sans (renders as the system UI face — Inter/SF-like). Numbers/results are heavy (800). Icon font: **Material Symbols Rounded**. A cursive **Sacramento** face is used only for the small "MaiKnowledge" credit.
- **Corner radius:** controls 12px, cards 16px, large cards 18px, bottom sheets 20px (top corners), pills 999px.
- **Shadows:** soft and low — cards `0 1px 2px rgba(13,27,36,.04)`; CTAs `0 6px 18px rgba(15,118,110,.22)`; sheets `0 12px 40px rgba(13,27,36,.14)`. Elevation is subtle, never heavy.
- **Spacing:** 4-pt system (4/8/12/16/24/32), 20px gutters, 16px card padding.
- **Glass effects:** modest `backdrop-filter: blur(2–10px)` on scrims/overlays — a light frosted layer, not heavy glassmorphism.
- **Dark mode / light mode:** both are first-class. Light = airy white/teal; dark = deep navy `#0B1220` with brighter teal `#2DD4BF`. Toggled by a `dark` class on `<body>`.

---

## 7. Motion Reference

| Moment | Animation | Timing / easing |
|---|---|---|
| App launch | Splash → home (home shows via `display` toggle, no slide) | instant reveal |
| Open a tool overlay (Electrolytes) | fade + `translateY(8px)→0` | `.22s ease` |
| Open Calculators | `mcIn` fade + rise | `.25s ease` |
| Open Drugs DB | `dbIn` fade + rise | `.22s ease` |
| Bottom sheet (Drugs menu) | slide up `translateY(100%)→0` | `.26s cubic-bezier(.2,.7,.2,1)` |
| Renal dose sheet | scrim `rdFade` + sheet `rdUp` (`translateY(24px)→0`) | `.18s` / `.24s cubic-bezier(.22,1,.36,1)` |
| Renal dose button (idle) | `rdAttn` attention pulse ring | `2.4s ease-in-out` loop |
| Brands drawer | slide in from right | `.24s ease` |
| Accordion card open | chevron rotate 90° + border/shadow lift | `.18s` |
| Button/tile press | `scale(.93–.99)` | `~.15s`, standard ease `cubic-bezier(.2,.7,.2,1)` |
| List loading | `rds-shimmer` skeleton sweep | `1.3s` loop |
| Result appears (Analyze / score) | smooth-scroll into view; value renders instantly | `~.3s` scroll |
| Theme toggle (light⇄dark) | **circular reveal** — new theme unmasked by an expanding `clip-path: circle()` from the tap point, with a teal leading-edge glow | `400ms cubic-bezier(.4,0,.2,1)` |

Global feel: **calm, spring-tinged, brief.** Nothing bounces excessively; overlays rise softly; the signature flourish is the circular theme reveal.

---

## 8. Marketing Screens (best to showcase, and why)

1. **Electrolyte Correction Engine — results with the CORRECTED CALCIUM card.** The clearest "AI reads the labs for you" moment; color-coded severity + a real derived number tells the whole value story in one frame.
2. **Drug detail with the pulsing teal "Renal dose" button → the CrCl result.** Visually distinctive (the pulse draws the eye), and it dramatizes the hardest bedside task — safe dosing in renal impairment — resolved in one tap.
3. **CHA₂DS₂-VASc result card.** Instantly recognizable to any physician; the big score + risk % + anticoagulation recommendation is a satisfying, authoritative payoff.
4. **Home (rnav) landing.** Establishes the brand: teal hero, clean tiles, bottom tab bar — the "one calm app" thesis shot.
5. **Dark-mode circular theme reveal.** A premium, Apple-style signature transition for a hero beat.

---

## 9. Screen Recording Guide (exact interaction steps)

Record on a real device in the **native app** (so `body.ui-v2` chrome + Material Symbols render). Keep the status bar clean (full battery, strong signal).

```
1. Home (rnav)                       — hold 1.5 s (establish)
2. Tap "Electrolytes" tile
3. Electrolyte Correction Engine opens
4. Enter Calcium 8.2 (Ca field), Albumin 2.6 (Albumin field)
     — optionally Na/K for a fuller panel
5. Tap "🧮 Analyze & Generate ICU Recommendations"
6. Results scroll in; PAUSE 2 s on the Calcium card
     showing "Corrected calcium 8.9 mg/dL (measured 8.2, albumin 2.6)"
7. Return to Home (Home FAB)
8. Tap "Drugs" → bottom sheet → tap "Drug Database"
9. In search type "Meropenem"; PAUSE as results appear
10. Tap the Meropenem result → molecule detail
11. PAUSE 1.5 s on the teal, pulsing "Renal dose" button under the chips
12. Tap "Renal dose"
13. Sheet rises; tab "From labs" — enter Age 72, Weight 60, Creatinine 2.1
14. PAUSE 2 s on the result: CrCl value + "Severe" band pill + adjusted dose
15. Return to Home
16. Tap "Calculators"
17. In search type "CHA2DS2" (or tap the "Cardiovascular" chip)
18. Tap the CHA₂DS₂-VASc card to expand
19. Tick: Congestive heart failure, Hypertension, Diabetes, Prior stroke/TIA;
     enter Age 74; select Sex = Female
20. Tap Calculate
21. PAUSE 2.5 s on the result: score (points) + annual stroke risk % +
     anticoagulation recommendation
22. (Optional hero beat) Tap the theme toggle → circular dark-mode reveal
```

Everything above follows the real app flow and the real field labels.

---

## 10. Camera Notes

- **Close-ups (fill the frame):** the **Corrected calcium** row; the **Renal dose** button pulse and the **CrCl + band pill**; the **CHA₂DS₂-VASc score number** and risk line. These carry the message — get tight on them.
- **Zoom / push-in:** slow push toward the result value as it renders (Analyze, CrCl, score). Let the number "land."
- **Floating phone shots:** use for the **Home landing** and for section-to-section transitions (phone drifting in 3D over a soft, blurred ward/clinical backdrop) — establish product, not detail.
- **Interactions that should fill the screen:** the finger tapping **"Analyze"**, tapping **"Renal dose"**, and ticking the CHA₂DS₂-VASc checkboxes — show real touch, real state change.
- **Signature beat:** the **circular theme reveal** deserves a full-screen, slow-motion moment.
- Keep motion steady and deliberate — no whip pans; this is a premium, trustworthy medical tool.

---

## 11. AI Video Context (for Gemini Omni / Veo)

> **What StewardMD is:** a mobile clinical-decision-support app for doctors — "Smart Clinical Decision Support for Doctors." On a hospital ward round it interprets electrolyte labs, computes safe renal drug doses, and runs bedside risk calculators, all in one calm teal-and-white interface.
>
> **UI that must remain UNCHANGED:** the teal accent (**`#0F766E`** light / **`#2DD4BF`** dark) on near-white `#F8FAFC` panels; the flat top headers with a thin bottom border (never a gradient bar); the bottom tab bar with a center **"Ask Maik"** button; Material-Symbols line icons; heavy (800-weight) numbers for results; the real screen titles **"Electrolyte Correction Engine," "Drugs Database," "Clinical Calculators"**; the real field labels and result text quoted in this manifest.
>
> **Interactions that must look NATURAL:** finger taps land on the actual buttons ("Analyze," "Renal dose," "Calculate," checkboxes); overlays rise softly over the home (home is never a hard cut to black); search shows a brief debounce before results; the score/CrCl/corrected-calcium values render crisply into their cards.
>
> **Visual style to MAINTAIN:** Apple-keynote calm — generous white space, soft low shadows, subtle spring motion, teal as the single accent. Clinical, premium, trustworthy. Light mode as the default; one dark-mode circular-reveal hero beat.
>
> **How animations should FEEL:** brief and eased (`.2–.26s`, `cubic-bezier(.2,.7,.2,1)`), never bouncy; the Renal-dose button has a slow 2.4s glow pulse; the theme toggle is a 400ms expanding circular wipe from the tap point with a teal glow edge.
>
> **NEVER modify / invent:** do not add a "Lab Interpretation" screen (it does not exist — it is the **Electrolyte Correction Engine**); do not label a tile "Drug Index" (it is **"Drugs" → "Drug Database"**); do not put a gradient across the top bar; do not invent tabs, logos, or feature names; do not change the teal to blue/green; do not fabricate numbers beyond the plausible clinical values shown; keep all medical text exactly as quoted.

---

## 12. Assets

- **Logos / marks (repo root):** `logo.png` (header brand), `mark-teal.png` / `mark-white.png` (StewardMD monogram), `maik-logo.png` / `maik-logo-white.png` (+ `.webp`) and `maik-wordmark-color.png` / `maik-wordmark-white.png` (MaiKnowledge credit), `og-image.png` (social), `StewardMD_Intro_Poster_Final.webp` (intro poster).
- **App icon / favicons:** iOS `AppIcon-512@2x.png`; web `apple-touch-icon.png`, `android-chrome-192/512`, `favicon-16/32/48`, `favicon.ico`.
- **Splash:** iOS `Splash.imageset` with light **and** dark variants (@1x/@2x/@3x).
- **Fonts:** **Material Symbols Rounded** (self-hosted `assets/fonts/material-symbols-rounded.woff2`) for all UI icons; **Sacramento** (`assets/fonts/sacramento.woff2`) for the cursive "MaiKnowledge" credit only. UI text uses the system sans stack (IBM Plex Sans / Inter families named in CSS but rendered via OS fallback).
- **Brand colors:** teal `#0F766E` (light) / `#2DD4BF` (dark); teal-soft `#CCFBF1`; ink `#0F172A`; page `#F8FAFC`; dark page `#0B1220`. (PWA manifest theme color is a deeper green `#0F5132`.)
- **Apple Watch assets (exist):** `ios/StewardMDWatch/…/AppIcon-1024.png` and a `StewardMDMark.imageset` (`stewardmd-mark.png`). *Not featured in this ad; listed for completeness only.*
- **Taglines (verified, on-screen):** "Smart Clinical Decision Support for Doctors" (primary), "Antibiotic Decision Engine," and "Merging AI with Infinite Knowledge" (MaiKnowledge credit). Footer: "© 2026 StewardMD · Developed by MaiKnowledge · Dr. Manoj Kumar Kurmana, MD."

---

*This manifest reflects the StewardMD repository as implemented. Feature names, labels, colors, and interactions are drawn from the code; nothing is fabricated. Where a requested name did not exist, the real feature name was substituted and flagged.*
