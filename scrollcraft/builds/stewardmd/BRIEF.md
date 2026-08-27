# BRIEF — StewardMD product page

**Interview status: PARTIALLY INTERVIEWED.** Questions on placement, audience,
aesthetic range and structure were asked and answered by the owner. The
remaining four (vibe references, section-by-section journey, energy curve, the
one-thing-no-site-does) were **self-authored from the repository** and are marked
`[self-authored]` below. Owner had not replied at time of build. Every
self-authored answer is a fallback, not a plan, and should be overwritten.

---

## The subject

Owner's words: *"use this on stewardmd.in website to make it better more best"*.

What that turned out to mean, after reading the repo:

- `stewardmd.in/` is **not** a marketing site. It serves the 368KB clinician app
  shell (`index.html`), which `scripts/build-www.sh:17` also copies into `www/`
  for the iOS and Android bundles. Touching it breaks the web app and every
  native build.
- There **is** an existing marketing page, live at `stewardmd.in/_site/`
  (HTTP 200): a complete GSAP-animated landing page with strong copy.
- So this build is a **successor to `_site/index.html`**, at a new path, with
  both `/` and `/_site/` left untouched.

---

## The eight answers

**1. Vibe, in three to five words, plus references.** `[self-authored]`
Quiet, exact, load-bearing, unhurried. References: the ICU flowsheet at 3am; a
Braun surgical instrument catalogue; the NASA flight-controller console
handbook. Deliberately not a website, and deliberately not "clinical SaaS".

**2. The scroll journey, section by section.** `[self-authored]`
The case is already open when you arrive. What you actually have to reconcile.
Which source governs, and why that is the question. You change the patient and
watch everything re-derive. The numbers, each one traceable. The range of
modules. The note it hands you.

**3. The energy curve.** `[self-authored]`
Calm the whole way except one act. This is a page for people who are tired.
Loudness would read as a vendor. The single intense moment is act 4, and it is
intense because the visitor caused it, not because the page got louder.

**4. Feeling stage by stage, and the one moment.** `[self-authored]`
See the feeling curve below. The one moment: act 4.

**5. One thing no site they have seen does.** `[self-authored — owner asked to
veto or confirm, no reply at build time]`
A patient you can edit from anywhere on the page, where every panel below
re-derives from that edit, and the page accumulates the reasoning into a note it
hands you at the end.

**6. How far from premium-minimal.** *(owner answered)* "mix of all".
Read as: an **editorial spine** carrying the argument, **dense** data surfaces
where the product is being shown, and **one loud act** (the peak). Not
premium-minimal, which the skill flags as the default worth departing from.

**7. One unbroken world, or distinct scenes.** *(owner answered)* **Distinct
scenes.** Consistent with the Live surface grammar: panels and states, not a
continuous camera flight.

**8. Assets.** *(owner answered "all" on audience; asset question unanswered at
build time — inventory taken from the repo instead)*
- **No video anywhere in the repo.** Zero mp4/mov/webm.
- **No SVG logo.** Every mark is raster. `mark-teal.png` / `mark-white.png` at
  1024×1024 are the usable ones.
- **13 store-ready app screenshots** at 1290×2796 (`store-assets/apple/`) and
  1080×2160 (`store-assets/google-play/`), plus 13 unframed sources in
  `store-assets/raw-app-screens/`. This is the real product imagery and it is
  what a Live surface page should show.
- **`clinix-*.jpg` (22 bedside photos of real people): NOT USED.** Consent and
  model-release status is undocumented anywhere in the repo. No faces on a
  public page without that.
- **`KIE_AI_API_KEY` is not set**, so nothing can be generated. The chosen
  grammar needs no generated imagery, which is part of why it was chosen.

---

## Audience

Owner answered **all four**: practising clinicians, hospital buyers, students,
investors. Resolved as: clinicians are the primary reader and the page is built
for them; three later acts turn to answer the others without changing register.
A page that addresses four audiences evenly addresses none.

---

## The feeling curve

Written before the acts existed. Emotion first, cause second.

```
1  Recognition   the case is already open at 02:14, the surface in a state, no title screen
2  Doubt         the four things you are holding in your head, listed plainly, none agreeing
3  Orientation   one wipe, and the source hierarchy resolves: which authority governs this
                 (ends quiet, deliberately — see authored silence)
4  Control       PEAK. you change the patient and every panel below rewrites itself
5  Confidence    the real numbers arrive, each one with the file it came from
6  Breadth       the modules travel sideways, one patient seen five ways
7  Readiness     the note it wrote, in a field with a cursor in it
```

No two adjacent acts share a feeling. Recognition and Orientation are the two
nearest and are separated by Doubt.

## The peak

**Act 4.** The sentence a visitor would say to a friend:

> you change the kidney function at the top of the page and every panel below it
> rewrites itself, and at the bottom it hands you the note

It gets the three things: the largest span on the page by a clear margin (3.8
against 2.8 for the next), the silence in front of it (act 3 resolves and then
holds nearly empty), and the whole bespoke-code budget.

## The tell-someone sentence

> It's the site where you set the patient at the top and the whole page
> re-derives, then gives you the note.

## Authored silence

**The tail of act 3 is deliberately near-empty.** Act 3 became a flow section
during the build (it and the peak were both pinned and adjacent, which breaks
the variety rule), and it carries `24vh` of extra bottom padding after the
source hierarchy resolves. That empty stretch is the silence in front of the
peak. The verification harness must not read it as dead scroll, and it does not.

---

## Grammar: Live surface (uniqueness.md §2.3)

Why the other seven lost:

| Grammar | Why not |
|---|---|
| Filmic one-shot | Carries a burden of proof, and needs video. No footage in the repo, no API key. Unbuildable. |
| Continuous world | Requires worldflight and generated footage. Same blocker. Owner also chose distinct scenes. |
| Chaptered editorial | Strong for credibility, but it argues on paper. The honest pitch for decision support is "watch what it does". |
| Typographic poster | Right when there are no assets. There are 13 real product screens, so type-only would be throwing them away. |
| Gallery / catalog | Fits the seven modules, and only the seven modules. One act's worth of grammar. |
| Split stage | Runner-up. Current bedside workflow against the tool is a real two-sided argument. Lost because it bans `pan`, which the module range wants, and because it cannot show the product operating. |
| Rhythmic cutlist | An energy grammar for streetwear and events. Wrong register for tired clinicians. |

**The honesty rule is the constraint that shapes this build.** Live surface
demands real markup running real logic on real or clearly-labelled sample data;
`taste.md` separately bans div-built fake dashboards. So every panel computes.

**And one safety constraint on top of it.** A *public* page that computes
antibiotic doses is a clinical surface without the app's clinician gate in front
of it. So the surface computes real arithmetic (Cockcroft-Gault creatinine
clearance, a published formula, from values the visitor sets) and then shows
**which guideline tier governs and why** — never a drug, never a dose, never a
regimen. Real logic, real provenance, nothing prescriptive. The sample case is
labelled as illustrative on its face. No PHI, invented or otherwise.

## Signature move

**The patient strip.** Persistent app chrome at the top, and in this grammar the
chrome *is* the navigation. Four editable fields: age, weight, creatinine, sex.
Every panel further down the page derives from them live — the clearance, the
renal band, which source tier governs, which module opens. Passing an act
appends one derived line to a running note held in the strip, so arriving at the
close means arriving with a record rather than reaching a footer. The close is
that note, in a real field, copyable.

One control that regrades the whole page, merged with a trace of where you have
been, and it is the product's actual thesis: one patient, every module, one
record. Coded in the page off `--sc-p` and bespoke `data-smd-*` attributes. The
engine is not touched.

## Fingerprint gate

Registry `scrollcraft/FINGERPRINTS.md` was **empty** at build time (first build).
The gate passes trivially — there are no rows to differ from. Row appended after
shipping.

Deliberately avoided anyway, since they are named in the skill as the prior-build
band: the 6-to-7-acts-at-13.6-13.8vh shape. This page is 7 acts at **13.2vh**.

## Score table

| # | Beat | Feeling | Device | Span | Why this one |
|---|---|---|---|---|---|
| 1 | The case is open | Recognition | `pin` (ground present, cues stagger) | 1.8 | The surface already in a state is this grammar's hero. A title screen would break it. |
| 2 | What you are holding | Doubt | `flow` + `in` | ~1.0 | The one act that should read like a document. Pinning it would dignify the problem. |
| 3 | Which source governs | Orientation | `reveal` (wipe) in flow | ~1.0 + 24vh tail | A wipe is a change of state, which is exactly this beat. Flow, not pinned: see below. Ends quiet. |
| 4 | You change the patient | **Control (PEAK)** | `pin` + pointer + bespoke `--sc-p` | **3.8** | The visitor operating the thing is the whole argument. Largest span by a clear margin. |
| 5 | The numbers | Confidence | `count` on verified figures | ~1.1 | Counters are truth claims. Every one traces to a file. |
| 6 | Five ways | Breadth | `pan` | 2.8 | Lateral travel reads as range; vertical reads as argument. |
| 7 | The note | Readiness | `pin`, closing, real input | 1.2 | This grammar's close must be an input, not a button. |

**Measured 12.6vh at 1440x900 and 13.2vh at 390x844**, inside the 8-14 budget
and outside the 6-to-7-acts-at-13.6-13.8vh band named in the skill.

Act 3 was planned as a pinned act and built as one. The contact sheet showed it
sitting directly against the pinned peak, so the engine saw `pin > pin`: the
same device family twice in a row. It is now a flow section carrying the reveal,
which fixes the adjacency and sharpens the peak, because the page stops being a
document and becomes a machine at exactly that boundary.

Checks: six device families (pin, flow, reveal, count, pan, pointer), no family
twice in a row, zero `scrub` acts, one peak, silence in front of it, and the
grammar's bans all hold — no `scrub`, no `kinetic`, no `spotlight`, no `magnet`,
and drift held to two stops.

## Numbers used, and their sources

Every figure on the page is verified against a file in this repo. Counts below
were re-derived directly, not taken from the asset inventory.

| Figure | Source |
|---|---|
| 484 searchable diseases (141 diagnostic + 343 reference-only) | `kb/manifest/COVERAGE-GAP-REPORT.md:21` |
| 310 interaction rules | `len(data/interaction-rules.json.rules)` |
| 3,307 generics · 2,620 drug classes · 292 brands | same file |
| 20 antibiogram organism records | `len(data/antibiogram-raw.json)` |
| 267 protocols | file count, `kb/protocols/*.json` |

**Not used: "4,808 conditions".** The claim is live on `_site/index.html:168` and
the string appears **nowhere else in the repository** — no data file, no script,
no doc. The machine-generated coverage report says 484 searchable diseases, and
`kb/reference/*.json` is 4,664 files. It is an unsourced headline number on a
public medical page and it should be corrected or dropped at source.

**Antibiogram values are not published**, only the record count. Local
resistance data is institution-specific.

## Copy

Built from the existing page's own lines where they are strong, notably:

> When the clinical decision matters, open StewardMD.

> The engine assembles the review. It does not choose the antibiotic.

The disclaimer the current page carries on every clinical claim is kept:
*"Clinician-only decision support. StewardMD does not diagnose or prescribe on
its own; the treating doctor decides."*

## CTA

**"Get StewardMD"** — one label, used everywhere. Taken from the existing page,
where it is the most-used of five competing labels (*Get StewardMD* ×3, *Start
the 7-day free trial*, *Start your 7-day free trial*, *Start a case*, *Open
OPD*). That spread breaks `taste.md`'s one-label-per-intent rule; this page
picks one. Links to the App Store and Play Store entries already in
`_site/index.html`.

## Palette and type

The app's **own dark tokens**, because a Live surface page should look like the
product:

| Role | Value | From |
|---|---|---|
| canvas | `#0d1b26` | `--paper` dark, `index.html` |
| surface | `#132030` | `--panel` dark |
| ink | `#e8edf2` | `--ink` dark |
| ink-soft | `#7690a6` | `--slate-soft` dark |
| accent | `#3fc7b3` | `--teal` dark |

Severity ramp reused as-is from the app (`--green` `#4dd68c`, `--yellow`
`#f0c060`, `--orange` `#f07040`, `--red` `#e85070`) because in this product it is
clinical meaning, not decoration.

Note there are two brand teals in the repo: `#0e6e63` (app light) and `#0F766E`
(the marketing page). This build uses the app's dark-mode `#3fc7b3` for contrast
on a dark ground and flags the divergence as worth resolving at source.

**Inter and IBM Plex Mono.** `taste.md` discourages Inter as a default because it
reads as a non-decision. Here it is the brand's own self-hosted face
(`/assets/fonts/inter-variable.woff2`) and the face of the product being shown,
so a Live surface page in anything else would be showing a product that does not
exist. Mono is for data and labels only, not as a costume for "technical".

---

## The feel check (run after Step 5, cold)

Scrolled the contact sheet before rereading this file. One word per act:

| # | Intended | Felt | Verdict |
|---|---|---|---|
| 1 | Recognition | recognition | matches |
| 2 | Doubt | acknowledged | close enough, the list is calm by design |
| 3 | Orientation | orientation | matches |
| 4 | **Control (peak)** | **clarity** | **mismatch, fixed** |
| 5 | Confidence | confidence | matches |
| 6 | Breadth | breadth | matches |
| 7 | Readiness | readiness | matches |

**The one disagreement, and what changed.** Act 4 was intended as *control* but a
passive scroller feels *clarity*: they watch it compute rather than causing it.
Control only exists for someone who touches the patient strip, and nothing drew
their eye to it. That also put two near-identical feelings next to each other
(orientation then clarity), which is the filler signature from feel.md §1.

Fixed in the page, not in this brief: when the peak act is reached and the
visitor has not yet edited anything, the four inputs in the chrome raise their
hand once (accent underline plus two soft pulses, dropped under reduced motion,
cleared permanently on first edit). The peak now points at its own control.

Peak still reads as the peak on the sheet: largest span (3.8 against 2.8 for the
rail), the largest visual change, and the silence in front of it is visible as
the long quiet tail of act 3.

## What verification actually covered

Green, and re-run after every fix:

- Desktop 1440x900: 12.6 viewport-heights, no dead scroll, all cues clear 4.5:1
  measured on the composited page at the brightest frame under each line.
- Mobile 390x844: 13.2 viewport-heights, same result.
- Reduced motion: same result.
- `lab/measure.mjs`, the manual pan-overflow check the harness cannot do:
  968px / 1040px / 1040px / 1415px of rail overflow at 1920 / 1440 / 1180 / 390.
- `lab/functest.mjs`, 25 assertions, all passing: Cockcroft-Gault against
  hand-computed values at four patient states, the sex factor, empty input
  producing no number rather than a false one, the note accumulating live, no
  console errors, and a safety assertion that no drug name or dosing
  instruction appears in the page's visible text.

Defects the harness passed but the contact sheet caught, all fixed:

1. Every pinned stage was top-aligned with an empty lower half (`.sc-stage` is
   `height:100vh` and centres nothing).
2. Act 1 held one frame for its whole 1.8 viewport-heights.
3. Acts 3 and 4 were both pinned and adjacent, breaking the never-the-same-
   family-twice-in-a-row rule. Act 3 is now a flow section carrying the reveal.
4. The peak panel and the closing stage were both hollow during their entry
   slide (the ground-or-greet rule in devices.md).
5. The chrome's hard-coded values said 24 mL/min and "Severe" while the real
   computation is 35 and "Moderate". JS corrected it at runtime, so it was
   invisible after hydration, but a pre-hydration or no-JS reader saw a wrong
   clinical number.
6. The creatinine input was clipped to "1." by the number spinner.
7. `IntersectionObserver` used `threshold: 0.35`, which a 3420px pinned act
   against a 900px viewport can never reach (max ratio 0.26), so the peak never
   registered and the note silently omitted the derivation.
8. The pan rail had only 400px of overflow at 1920px against a 960px target,
   which is the width-dependent dead-pan defect: motionless on a large desktop
   while the harness reports it clean.

**Not covered, and it matters:** a real phone. Headless Chrome cannot reproduce
iOS touch scrolling, Low Power Mode, or Safari's layout of the sticky chrome.
There is no video on this page, which removes the largest class of iOS defect,
but the fixed patient strip and the pinned stages should be looked at on a real
handset before this goes in front of anyone.
