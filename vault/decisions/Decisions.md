---
tags: [decisions, adr]
---
# Decisions

Dated architectural calls + why. Newest first. Keep each short: **decision · why · trade-off · status**.

## 2026-09-18 · Deferring a payload without deferring the contract (PDF engines off cold start)

**Measured first, because the received wisdom was wrong.** `stewardmd.in` is a MARKETING PAGE (3
scripts, App Store links); `/home.js` 404s there. The app is a Capacitor bundle read off LOCAL DISK.
So compression, CDN, `modulepreload` and service-worker *network* strategy do not apply to real
users at all. The only cold-start cost that is real is **V8 parse+compile of the bundle**: 13.4 MB
across 268 files, 205 ms on desktop node (several times that on a mid-range phone).

**The pattern that makes deferral safe here: defer the PAYLOAD, never the CONTRACT.** The globals
keep their exact names and shapes; the feature `await`s a cached-promise loader before first use;
every pre-existing "engine unavailable" guard stays as the fail-safe. Because the bundle is on local
disk, "lazy" costs a file read plus parse (**measured: 44 ms**), not a download. That is what makes
the trade nearly free in THIS app and is exactly why it would not be free in a web app.

**Superseded on the 2026-09-19 merge:** `origin/main` had shipped the same deferral as `ensurePdfEngine()` in `native-bridge.js` + `window.smdLazy` in `prescription.js`; `pdf-engines.js` and its two tests were dropped in favour of main's version. The pattern below still holds.

**First application: `pdf-engines.js` (dropped, see above).** vendor-html2canvas (194 KB) + vendor-jspdf (357 KB) = 551 KB
parsed at every launch for two features most sessions never reach (prescription export, native
HTML->PDF). Now loaded on demand by `SMD_PDF_ENGINES.ensure()`. **13.4 MB -> 12.9 MB, 205 ms -> 176 ms.**

**It also fixed a live race.** `prescription.js` read `window.html2canvas` directly and told the
doctor *"Export engine still loading - try again"* whenever Export was reached before the eagerly
deferred 551 KB had parsed. Awaiting the loader removes that window rather than apologising for it.

**A collision this nearly caused, worth remembering:** `native-bridge.js` already owns
`window.SMD_PDF` (its `fromHtml` renderer, used by MaiK/onco/reports) and loads FIRST. Naming the
loader `SMD_PDF` would have silently replaced it. Hence `SMD_PDF_ENGINES`, pinned by a test.

**The ordered plan for the rest, by win over risk:**

| Tier | Target | Win | Why it is safe, or not |
|---|---|---|---|
| done | vendor jspdf + html2canvas | 551 KB | call sites already guarded; no clinical content |
| next | `hospitals-in.js` (249 KB), `followcare-i18n.js` (173 KB) | 422 KB | pure data, single consumer each, count is assertable |
| then | `kardiox-content-pack.js` (1.88 MB) + `kardiox-content.js` (508 KB) | 2.4 MB | biggest win, but it CONCATS 1041 lessons into `SMD_KARDIOX_CONTENT.ecgs` at load; needs a test asserting the atlas still reports 1141 or it truncates silently. `index.html` already calls this out: CliniX fetches its content lazily *"deliberately unlike kardiox-content-pack.js which parses 1.9 MB on every page load"* |
| **never** | `interaction-rules.js` (880 KB) | - | a drug-safety engine must be present anywhere a drug appears. Deferring it risks a missed interaction warning. **Do not lazy-load a safety engine.** |

**Rejected, with measurements:** debouncing the search inputs. They are undebounced, but ONCQIS
search is **1-5 ms/keystroke** and the 2,405-row hospital picker is **0.4-1.7 ms** (60-row cap). A
120 ms debounce on a 2 ms operation adds lag for no gain.

**Status:** `test/pdf-engines.test.mjs` 7/7 (single injection under concurrency, never rejects,
retryable, no SMD_PDF clobber); `test/run-pdf-lazy-ui.mjs` 13/13 in a real browser, including
rendering an actual PDF after the lazy load. Suite 3210 pass; 4 failures all reproduce on clean
`origin/main` (followcare-voice-server, opd-mrn-alloc, and two in entitlement-trial).

## 2026-09-02 · A named score is answered by its calculator, not by the model; the tool chips were dead

**Reported with a screenshot:** "HACOR score" in MaiK (Cloud) spent a paid Gemini turn and answered
with a fabricated formula (`FiO2 × 100 / (PaO2/FiO2)` - HACOR is Heart rate, Acidosis, Consciousness,
Oxygenation, Respiratory rate), while the "Open calculators" chip under the answer did nothing when
tapped. Owner: "why didn't it redirect to our calculator, and these chips don't work."

**Why the chip was dead.** `home.js`'s delegated chip handler resolved the tapped element with
`closest("[data-maik-q],[data-maik-web]")` and returned when nothing matched. The tool chips carry
only `data-maik-tool`, so every one of them ("Open calculators", "Open Drug Index", "Check
interactions") fell through that early return; the `data-maik-tool` branch further down was
unreachable. A comment elsewhere in the file still claimed those chips "always worked", which is how
a dead code path stays dead: it was believed to be the working one. The selector now includes
`data-maik-tool`, `data-maik-calc`, `data-maik-calcask`.

**Why the tokens were spent.** Nothing resolved a score NAME against the calculator registry before
the model was called. `MaiKBrain.suggestCalcs` maps conditions to scores (pneumonia → CURB-65) but
had no idea what "HACOR" was, and `plan()`'s "pure score → no Gemini" flag is not consulted by
`runClinical` anyway. (HACOR also did not exist in the registry: 430 calculators, no HACOR.)

**Fix, four places.** (1) `calculators.js` `MEDCALC.find(query)`: resolve free text to ONE calculator
by name. Conservative by construction: every significant word of the question must appear in the
title (so "treatment of pneumonia" does not hit "CURB-65 (pneumonia)"), a real word must match (so
"65" alone never does), the calculator's own name must be at least half covered, and two calculators
that fit equally is "not sure" ("wells score" → null; "wells score for PE" → wells_pe). Digits split
from letters and subscripts normalised so `curb65`, `CURB-65`, `CHA2DS2-VASc` all resolve. A short
alias map covers spoken forms (`gcs`, `crcl`, `chads vasc`). (2) `home.js` `maikRoute()`: a
`calculator` kind, checked before the patient-specific route, that requires either an exact name or
a score cue word. The answer is a local card (what it is, what it needs, "Open <name>", "Ask MaiK
anyway") - zero tokens, and the arithmetic is the registry's. `_maikSkipCalc` is a one-shot bypass
for "Ask MaiK anyway", same pattern as `_maikDisambigResolved`. (3) `maikToolChipsHTML` names the
calculator ("Open CURB-65" via `data-maik-calc`) when the question names one, generic list chip
otherwise. (4) `MaiKBrain.suggestCalcs` puts a named calculator first, so the copilot's "Open in
StewardMD" chips say its name. Plus a HACOR entry (Duan 2017, five bands, >5 = high risk of NIV
failure) so the reported question has somewhere to land.

**Trade-off:** a question that is ONLY a score name no longer gets a narrative from the model by
default; it gets the calculator and an explicit "Ask MaiK anyway". That is the owner's stated
preference ("rather than wasting tokens"). A false positive in `find()` would send a doctor to the
wrong calculator, which is why it is conservative and every miss falls back to the old behaviour.

**Status:** `test/calc-find.test.mjs` 9/9 (resolver + HACOR bands + threshold); `test/run-maik-calc-route-ui.mjs`
22/22 in a real browser: the reported question routes to HACOR through the real send path with ZERO
`/api/ai` calls, the previously-dead generic chip opens the list, the specific chip opens that
calculator, delegation survives a thread restore, and "Ask MaiK anyway" bypasses exactly once.
`maikRoute()` gained `typeof` guards because two structural suites evaluate it outside module scope.
**Note:** the HACOR entry is new clinical content and is marked for clinician sign-off like the rest
of the registry.

## 2026-09-18 · Related figures under a MaiK answer: a search result, never hosted or generated

**Owner:** show the image a trusted medical page carries for the topic "just like Google", with the
link below it, without spending tokens; "we never host, cache or regenerate, we just show the search
result image and the link which on click takes them there." TinyFish is already paid for and already
restricted to `TRUSTED_MEDICAL_DOMAINS`, so it is the search; Google image search was considered and
not adopted (new vendor, new key, per-query cost).

**Decision.** `GET /api/ai/figures?q=<topic>` (`functions/_figures.js`): TinyFish returns the
trusted pages (its results carry title/snippet/url only, no images), the function reads each page's
HTML once and `pickFigure()` chooses the figure the page is built around (alt/caption/src matching
the topic, `<figure>` context, size; logos, icons, banners, pixels and SVG/GIF rejected; `og:image`
only when it names the topic). Only URLs leave the function. The client (`home.js
maikFiguresStrip`) shows up to three cards under the answer, image loaded by the phone straight from
the source with `referrerpolicy="no-referrer"`, caption = site + title, tap opens the source page. A
hotlink the source blocks removes its own card. Cloud engine and online only; flag
`smd_maik_figures` ("0" off). Zero model tokens: the query is the canonical topic the client already
computed.

**Trade-off / status.** Hit rate will be uneven (long articles seldom expose their figure; single-
figure pages like the UNC AUA algorithm do), and the rule is the OCR rule: show nothing rather than
a wrong image. No KV cache of results by the owner's instruction, so each answer costs one TinyFish
query plus up to five page reads. Shipped behind the flag. Tests: `test/maik-figures.test.mjs`.

## 2026-09-19 · Offline MaiK must reply like MaiK: audit findings and what shipped

**Owner:** "audit offline AI models, they should reply like MaiK native models."

**Finding.** The on-device models were wrapped in a second, weaker MaiK: (1) `maik-local.js`
discarded the cloud package's `topicMatch` and re-retrieved from the book by word overlap, so
"melena workup" grounded on a dermatitis chunk containing "workup"; (2) answers carried pipeline
verdicts ("Left out: 3 statements") in the clinical text; (3) `_brainAugment` skipped the local
engine entirely, so no follow-up chips, workflow steps or tool launchers; (4) 20 to 70 s per answer
on Lite; (5) Cortex leaked its SFT template and once returned nothing; (6) duplicated render and an
export full of button labels; (7) the per-model battery had never been run.

**Shipped.** (1) Two RAGs chained: the cloud topic match is the ROUTER (which disease), the
on-device book is the CORPUS; the router's disease name rides in the BM25 query and is a required
anchor (`retrieveGrounding(packId, question, topic)`, `test/maik-rag-router.test.mjs`).
(2) Verdict moved to `result.grounding.removed` and the meta line. (3) Chips, workflow and tools
render on device; only page-cited verify lines stay off. (6) Export strips all UI. Earlier the same
day: greetings never hit a model, leaked-template guard, continuity on every engine, dose follow-up
section fix.

**Open.** (4) Latency: fewer passages, prefix-stable prompt for KV reuse, token streaming in the UI.
(5) Explicit ChatML wrapper for Cortex when the GGUF has no template; make `EMPTY_ANSWER` visibly
render. (6) The duplicated dengue render (replay + final on the local path) needs a repro.
(7) Run `bench/rag-grounding/run.mjs --live` on the phone as the gate for every offline change.

## 2026-09-19 · Ternary Bonsai 2 27B: not shippable on our llama.cpp; pack stays on Bonsai 27B v1

**Owner:** update the Bonsai packs to PrismML's 17 Sep 2026 release (Ternary Bonsai 2 27B, Qwen3.8-27B
base, 98.2% of full precision, 5.9 GB class, Apache 2.0).

**Finding.** Every official GGUF (`prism-ml/Ternary-Bonsai-2-27B-gguf`: PTQ1_0 5.95 GB, PQ2_0 7.21 GB;
`-gguf-dev`: Q2_0 "prism-fork-required" 7.63 GB) is a fork-only type. The model card states stock
llama.cpp rejects PTQ1_0/PQ2_0 as unknown types and lacks the Hadamard activation runtime. Our
`capacitor-llama` plugin links mainline b10502. No mainline g64 file was published (the 8B ternary
has one, which is why `bonsai-ternary-8b` works). There is no Bonsai 2 at 8B or 4B.

**Decision (same day, owner: "go ahead").** Move `local-plugins/capacitor-llama` to PrismML's fork,
release `prism-b10685-7dffb15` (mainline b10685 base, so a superset of b10502: every existing pack is
a plain GGUF and keeps loading). iOS: `Package.swift` binaryTarget now points at the fork's
xcframework (322,127,363 B, checksum `c9c83d40…`; same `build-apple/llama.xcframework/` layout, and
it adds simulator slices). Android: the `llama-cpp` submodule URL is the fork and the pointer is the
tag's commit `7dffb15`. New pack `bonsai2-27b` ("MAiK Bonsai Max 2", PTQ1_0, 5,946,648,928 B, sha256
`53107f53…`), tier 5.5, 12 GB floor, text-only for now (the repo's Q8_0 mmproj is noted, not wired).

**Verification status.** Both apps were rebuilt against the fork. Still to prove on a phone: an
existing pack (Lite, Cortex, Bonsai 8B) answering on the fork runtime, then the 5.95 GB pack itself
loading on a 12 GB device. Until that is done the new pack should not be pushed to devices.

## 2026-09-18 · A dose question is a database lookup, not a model question

**Owner:** "tell me dose of ondansetron … we already have the drug database it can redirect … dose of
parecetmal it should understand correct spelling" — and, on the drug source: "check drug database
medapi, all drugs in the world are there."

**Decision.** `kb/ai/drug-dose.js` (`window.SMD_DOSE`) intercepts dose-intent questions in
`maik-engine.js route()` — BEFORE the engine choice, so cloud and on-device behave identically — and
answers from `window.MEDAPI`: `searchCompositions` / `searchBrands` resolve the molecule, `structured`
supplies the figures (`gold.dosage` rows, else `adult_dose` / `ped_dose` / `renal_adjust` /
`hepatic_adjust` / `pregnancy`). **No model is in the loop for the numbers**, so a dose cannot be
invented. The adult answer also carries the renal and hepatic lines, because a dose question is
rarely only about the adult dose.

**Spelling.** The full-text search finds nothing for "parecetmal", so the router re-searches on the
first 4 then 3 letters — a typo is almost never in them — and fuzzy-matches inside that short
candidate list with the existing `DrugFuzzy` (Scan-Meds'), widened to distance 3 for a TYPED name.
A corrected or brand-resolved name is always STATED back ("You typed …", "Pantocid is Pantoprazole"),
never silently substituted.

**Trade-off / status.** Fails OPEN at every step: no dose intent, no confident molecule, or no dose
text in the record returns null and the normal grounded answer runs. Online only — the offline drug DB
carries brands and compositions, not the structured label — so offline the KB-grounded model answers
as before. Shipped. Tests: `test/drug-dose.test.mjs` (8), the dose block in `test/maik-engine.test.mjs`
(4, including "the on-device model is never asked for the number"), and the real-browser
`test/run-maik-dose.mjs` (9 checks against the shipped bundle).

## 2026-09-24 · Bundle carries subject-appropriate standard textbooks, never specific citations

**Decision.** Owner revised the reference style: not one generic line but the standard textbooks of the
subject (general medicine Harrison/Oxford Handbook of Clinical Medicine/Davidson; cardiology Braunwald/
Hurst/Oxford Cardiology; genetics Thompson & Thompson/Emery/Harper; neurology Adams and Victor/Bradley and
Daroff/Oxford Neurology; ... 23 subjects in `emoji-icons.js` SUBJECTS). Never an edition, chapter or page.
Labelled "Standard textbooks", not "Source": they are the field's standard texts, not a claim that an
entry was taken from them.

**How.** `scripts/sanitize-sources.mjs` runs in `build-www.sh` on the assembled www/ (and KB encryption now
reads the sanitized copies): specific citations in KB data become the entry's subject line (by `system`;
genetics first), page/pages/chapter fields are emptied, source/reference fields that name any book become
the subject line, inline citations inside prose are dropped, comments are cleaned too. kb/dist bundles are
evaluated, rewritten as data and re-emitted with the same wrapper and entry counts; JSON must re-parse; JS
is rewritten only inside string literals/comments (lexer skips regex/template literals) and must parse, or
the file is kept and reported. Result on the bundle: 377 files, 0 failures; ~13,700 textbook mentions and
~15,000 page locators down to 13 intentional leftovers (regex patterns in code, the physician Tinsley R.
Harrison, the Davidson 1800/1500 insulin rule). The repo keeps its authoring provenance.

**Not covered.** The on-device RAG book (`maik-lite-kb.jsonl`, 38 MB, downloaded from models.stewardmd.in,
sha256-pinned in `kb/ai/maik-lite-kb-store.js`) is not in this repo; it must be regenerated and re-uploaded
with its page groups remapped (maik-lite-rag.js uses `rows[].pages` only to cap chunks per page, so opaque
group ids keep behaviour) and the new sha256/size pinned.

## 2026-09-24 · No textbooks named as sources, no page numbers (copyright)

**Decision.** Owner: "I shouldn't find Harrison or any text book as source but reference, as copyright
problem, and no page numbers anywhere." Our own copy was rewritten at source (About changelog in home.js,
About text and demo notes in index.html). Data-driven text (knowledge-base reader footers, "Source:"
lines, MaiK answers) is scrubbed on the rendered DOM by `emoji-icons.js` (flag `smd_nobooks`, default ON):
full textbook titles (Harrison, Nelson, Mandell, Campbell-Walsh, Sleisenger, Adams and Victor, Williams,
Bailey and Love, Murray and Nadel, Sabiston, Oxford Handbooks, Tintinalli, Davidson, Robbins, Guyton,
Goodman and Gilman, Washington Manual, Kumar and Clark, Katzung, Braunwald's Heart Disease, Fitzpatrick's
Dermatology, Sherlock, Brenner and Rector, Rockwood and Green, Novak, Sanford Guide...) become "Standard
medical references"; the bare name in prose becomes "the reference"; p./pp./page/Chapter/Ch. locators are
removed. Clinical eponyms are protected (Harrison's groove, Fitzpatrick skin type, Braunwald
classification, Kaplan-Meier, Brenner tumour, Nelson syndrome, Rockwood classification, "Page 2 of 5").

**Trade-off / status.** The shipped knowledge-base DATA still carries the source metadata (about 30,700
textbook mentions and 41,000 page locators in kb/ files, mostly `kb/dist/*`); nothing displays it, but
anyone unpacking the app bundle can read it. Removing it from the data is a separate, larger change
(the RAG and reader code read those fields), not done yet. The underlying question of whether the KB
prose itself is paraphrased closely enough is a legal review, not a display fix.

## 2026-09-24 · No AI-style dashes in the app

**Decision.** Owner: "remove AI slop like -- AI dashes all over the app without causing malfunction".
Same rendered-DOM layer as the emoji swap (`emoji-icons.js`, flag `smd_nodash`, default ON). Each dash is
judged by its neighbours: an aside (X — Y, X—Y, X -- Y) becomes a comma; a range (5—10, 5 – 10) becomes
5-10 and a tight 7–10 en dash is untouched; an empty value (a lone —, HR: —, —/—) becomes – so empty
still reads as empty; a dash at the start/end of a text node becomes a comma only when the text continues
in the neighbouring element. Hyphens, CSS `--vars` and `a--b` are untouched; inputs/code are skipped.
Also applied to attributes, document.title, dialogs and outbound text (PDF, share, clipboard, notifications).

**Malfunction guard.** Code that compares screen text with the string it rendered would stop matching once
the text is rewritten (this affects the emoji swap too). The five such sites (search.js scroll-to-result,
home.js menu match, medlist.js route/frequency chips, opd-emr.js dictation bar) now compare via
`SMD_EMOJI_ICONS.same()/norm()`, which normalises both sides; without the module they fall back to the
original comparison. Comparisons on data values (not screen text) are unaffected.

## 2026-09-24 · No emoji in the app: rendered emoji become line icons

**Decision.** Owner: "remove emoji all over the app and replace with icons". ~1,500 emoji sit in 71
source files, many in non-HTML strings (toasts, textContent, titles, <option>, PDF text), so a source
rewrite would break them. `emoji-icons.js` works on the rendered DOM instead: an emoji in visible text
becomes the matching `window.ICONS` line icon (bell, steth, pills, lungs...), status emoji keep their
colour (green check, amber warn, red cross; coloured circles become solid dots), anything unmapped is
removed. Attributes (title, placeholder, aria-label, alt), <option> text, document.title and
alert/confirm/prompt are stripped. Typography (arrows, triangles, check/cross marks, stars, (c)(tm)) is
kept. User input is never touched. Flag `smd_noemoji`, default ON, "0" restores the emoji.

**Trade-off / status.** The source still contains the emoji; a later clean-up can replace them file by
file. Not covered: PDF/print text built from strings (jsPDF) and the separate web pages
(admin/, followcare.html, opd.html), which do not load it. Recovery point: main at c149bb42 (the tag
push was refused by the session proxy). Tests: `test/emoji-icons.test.mjs`, `test/run-noemoji-ui.mjs`.

## 2026-09-23 · Drug names are links: highlight + monograph-first in MaiK

**Decision.** Owner: every drug name in a question, answer or page is BOLD and opens that drug's
monograph. Revised 2026-09-24 (owner: "bold and glow for 5 sec ... rather than keep it highlighted
forever", then "letters to glow in a flow"): no permanent yellow and no box; for 5 s after it
scrolls into view a gold band flows through the LETTERS left to right (background-clip:text sweep,
three passes, soft halo) (IntersectionObserver,
re-armed only after it fully leaves the view) and on hover, then rests as plain bold. Reduced motion:
a steady glow, no animation. Earlier wording, kept for history: the name was bold yellow and opened that drug's
monograph (`MEDDB.openComposition`). A MaiK question naming a drug first shows a card: open the
monograph, Just answer, or answer and don't ask again. `drug-link.js` + generated `drug-lexicon.js`
(2,213 generics + 180 brands from `data/interaction-rules.json`, public domain), plus the Drug Index
formulary, `SMD_BRANDS`, and fuzzy spelling for the doctor's own question ("paracetomol"). Surfaces:
`#maikBody` (MaiK), the ICU MaiK/evidence/AI-discharge sheets, `#sbrefBody` (Knowledge Library with
its Syndromes, Antibiogram, AWaRe and Guidelines tabs), `#dxOverlay` (disease reader), `#refOverlay`,
`#abgBody`, `#smdProtoSheet` (chemotherapy protocols), `#smdOncoHome`, `#clinixScroll`, `#surgxScroll`.
Editors and the Drugs Database itself are excluded. The highlight is a `<span>` (a bare `<mark>` would
print yellow in exported HTML) with a print rule that removes it; the database is lifted above any
surface it opens from and restored on close. British/Indian spellings come from api.js `CLIN_SYN`.
Flags `smd_druglink` and `smd_druglink_ask`, both default ON, "0" to turn off.

**Trade-off / status.** Detection is a lexicon, not the OpenMed tagger: it works offline today, and the
tagger (still fail-closed, licence unverified) only adds names via `SMD_DRUGLINK.learn()` once enabled.
Lab analytes (sodium, potassium, glucose) are deliberately not highlighted. Tests:
`test/drug-link.test.mjs`, `test/run-druglink-ui.mjs` (real app, MaiK send path, Chromium 390 px).

## 2026-09-23 · OpenMed drug + disease taggers wired in, off and fail-closed

**Decision.** Owner: integrate PharmaDetect-TinyMed-65M and DiseaseDetect-TinyMed-65M. `openmed-ner.js`
runs them on the vendored onnxruntime-web. Pharma feeds extra drug names to claim grounding (stricter
only: fixes the aspirin-for-paracetamol swap that grounding graded supported). Disease splits a combined
diagnosis for ICD suggestions (offered, never assigned). Flags `smd_openmed_pharma` / `smd_openmed_disease`
default OFF.

**Trade-off / status.** The owner's rule (no model unless its exact checkpoint licence is verified
Apache-2.0) is enforced in code: `licence.verified:false` and null sha256s make every call return []
without a download. Hugging Face was unreachable from this session. The pipeline is proven on the real
runtime with a fixture model, not on the real weights. The aspirin gap could also be closed without a
model by passing drug-DB names (`MEDDRUGS._list`) as `opts.drugs`; not done, owner asked for the models.

## 2026-09-23 · OpenMed: rules now, models only after licence check and benchmark

**Decision.** From the OpenMed catalog (2,255 of 2,266 checkpoints declared Apache-2.0), nothing
replaces MaiK, MedGemma, Bonsai or the deterministic engines: every OpenMed model is a token tagger.
Shipped now: `phi-india.js`, OpenMed's India health-ID coverage re-implemented as rules inside
`redactPHI()` (flag `smd_phi_india`, default ON, "0" restores the old output exactly). It closes real
leaks: `name@abdm` ABHA Addresses, UPI IDs, PAN, and Aadhaar/phone numbers in Indic digits all used to
reach the cloud from AI Vision. PII models (ClinicalE5-Small-33M en/hi/te) are BENCHMARK FIRST.

**Trade-off / status.** No OpenMed weights are bundled or downloaded: the per-checkpoint Hugging Face
licence and the Nemotron-PII dataset licence could not be verified from this session. Full table and
next steps: [[OpenMed-Evaluation]]. Tests: `test/phi-india.test.mjs`.

## 2026-09-23 · MAiK Cortex (`medmo-4b`) removed from the offline model list

**Decision.** Owner: remove MAiK Cortex from the offline models. The `medmo-4b` entry is gone from
`PACKS` and `CAPS` in `maik-models.js`, so it no longer appears in the picker or grades. Supersedes
the 2026-09-18 entry below.

**Trade-off / status.** A phone that had Cortex selected falls back to MxCore (`activePack()` returns
`maik-mxcore` for an unknown id). A previously downloaded `medmo-4b-q4_k_m.gguf` (2.7 GB) is not
deleted automatically; it is orphaned on disk until the app data is cleared. Pinned in
`test/maik-models.test.mjs`.

## 2026-09-18 · MedMO-4B ships as MAiK Cortex, RAG-connected like every other text pack

**Decision.** The `medmo-4b` pack is labelled **MAiK Cortex** in the offline model list; `actual`
keeps the honest provenance (MedMO-4B, MBZUAI, Qwen3-VL-4B base, Q4_K_M). Its `CAPS.kb` is true, which
is exactly what the capability-based `maik-local.ragEligible()` reads, so every Cortex answer goes
through retrieval and the claim-level grounding verifier (`kb/ai/maik-grounding.js`) — unsupported
statements are removed or qualified, never the whole answer, and the evidence gate is untouched.

**Trade-off / status.** The pack id stays `medmo-4b` so existing downloads and prefs keep working;
only the visible label changed. Still UNVERIFIED on device: a qwen3vl-architecture GGUF loading
text-only in the plugin's llama.cpp has not been run on a phone, and the per-model grounding battery
(`bench/rag-grounding/run.mjs --live`) has not been run for it. Pinned in `test/maik-models.test.mjs`.

## 2026-09-18 · On-device MaiK: conversation continuity by default (three live failures)

**Owner:** "I can't treat every question as a new question." Live: "FUO" then "tell me the exact
definition" got "what definition?"; "treatment of hypertension" then "tell me doses" gave doses for
drugs the model had not named; a correction ("wrong, it's nitrofurantoin") started a new conversation.

**Root causes, in order of weight:** (1) home.js attaches history as `{q, a}` pairs (`_maikTurns`,
the cloud's shape) but `maik-local.js buildPrompt()` read `{role, text}`, so every turn rendered as an
empty "Doctor:" line: the model never saw a previous turn, whatever the follow-up detector said.
(2) `isFollowUp()` only knew a short aspect word list, so "exact definition" and any correction that
named a drug were treated as new subjects. (3) The previous answer was clipped to 180 characters, which
lost the drug list a "tell me doses" refers to. (4) Retrieval used only the current question, so a
follow-up had no topic anchor, grounded nothing, and the answer came from the model's weights.

**Fixes (maik-local.js, tests in test/maik-continuity.test.mjs):** `histTurns()` reads both shapes.
`continues(q, hist)` makes continuity the default: a question starts fresh only when it names a NEW
subject (a content word that is not filler, aspect, or a reference to the previous turn, and appears
nowhere in the previous exchange); a correction always continues. The fever -> "Polycystic Kidney
Disease" topic-bleed regression that made history opt-in stays fixed and pinned. `carry()` keeps the
previous answer's opening line and its bullet/figure lines (the drug list) up to 700 chars, dropping
citations and footer lines. `ragQuestion()` retrieves on the previous question plus the follow-up, so
"tell me doses" is grounded on the hypertension passages and checked claim by claim. Prefill cost of
the carried answer is accepted: continuity was the ask.

## 2026-09-18 · On-device RAG for every text pack; the whole-answer gate replaced by claim-level grounding

**Decision (owner):** RAG eligibility is a CAPABILITY (`maik-models.js CAPS[id].kb`, read by
`maik-local.js ragEligible()`), not the `packId === "maik-lite"` allow-list, and every text pack now
has `kb: true`, including the new text-only `medmo-4b` (MBZUAI MedMO-4B Q4_K_M, 2,716,064,480 bytes,
no vision projector published). This deliberately supersedes the 2026-09-03 reversal that made Bonsai
ungrounded: that reversal was a reaction to the GATE, not to grounding itself.

**Why the old gate lost half of a larger model's answers:** `evidenceGate` (kept in
`kb/ai/maik-lite-rag.js` for `webAnswer` and as the fallback when the new module is absent) failed
the WHOLE answer when any number or drug-suffixed token was not literally in the passages: "1 g" for
"1000 mg", "twice daily", "7-10 days", an alternative named in passing. Paraphrase was punished as
hallucination.

**What replaced it:** `kb/ai/maik-grounding.js` (`window.SMD_MAIK_GROUND`, ES5, deterministic, no
dependencies). The answer is split into claims; each claim is verified on FACTS: numbers are
unit-normalised (mass to mg, frequency/route words to one token so bd == twice daily == every 12
hours), a drug+dose pair must co-occur in ONE passage (a dose from passage A on a drug from passage B
is not support), a different dose for that drug in the evidence is a CONTRADICTION (removed, never
qualified), prose claims need concept overlap with a passage (stemmed, UK/US, abbreviations expanded
through the retrieval module's own table), never phrase overlap. Figures from the clinician's own
question stay allowed, as before. Outcomes per claim: supported (with [n] provenance to the passage),
clinician, unsupported (left out; or under "Not in the StewardMD Knowledge Base (general model
knowledge, unverified):" only when `localStorage smd_maik_general_knowledge=1`, off by default),
contradicted (left out), meta (verify line etc., kept, never cited). If NOTHING is supported the
model gets ONE regeneration constrained to the reference material (`_regen`), and only then does the
reference passage stand in for the answer. The gate was not weakened: nothing the passages do not
support is ever shown as Knowledge-Base-backed, and a count of left-out statements is printed.

**Measured** (`test/maik-grounding-verifier.test.mjs`, `bench/rag-grounding/run.mjs`, 31 gold-labelled
claims across supported paraphrase, unsupported, partial, multi-source, conflicting passages,
numerical/dosage, terminology): valid grounded claims accepted 100%, false rejection 0%, unsupported
blocked 100%, precision 1.0, recall 1.0; every contradicted dose classed as contradicted, not merely
unsupported. The two paraphrases the old gate rejected are accepted by name in the suite.

**NOT measured yet:** per-model behaviour on real answers (MaiK Lite, MedMO-4B, MedGemma, Bonsai).
`bench/rag-grounding/run.mjs --live` asks each installed pack on the connected phone and records the
answers; `--answers <file>` replays a recording. No phone was attached when this shipped, so the
per-model table is empty until someone runs it. Per-model "false rejection" additionally needs a
clinician to gold-label each free-form answer; the battery prints what was removed for that review
rather than guessing. `medmo-4b` loading text-only (qwen3vl GGUF, no mmproj) in the plugin's
llama.cpp is also unverified on device.

**Trade-off accepted:** concept-overlap support (COV_MIN 0.5 of a claim's stemmed content tokens in one
passage) is a heuristic; it errs toward leaving a correct prose sentence out, never toward keeping an
unsupported dose in. Tune COV_MIN from the live battery, not from intuition.
## 2026-09-18 · SUPERSEDES the entry below: ONCQIS is add-on only, SURGX is Pro and residents

**Decision (owner):** ONCQIS and OncoTree are NOT free. Every account gets a **3 day trial**, after
which they need the **Onco add-on (₹89/mo)**, which any tier may buy. SURGX is NOT free either: it is
included with **Pro and above**, and with **resident** plans (trainee tier whose verified role is
resident, plus Co-Resident). CliniX is unchanged: Respiratory free, the other systems Pro.

**Still to build:** `onco` and `surgx` entries in the role x tier matrix (`functions/_features.js` on
branch worktree-agent-aca63a9e6e54f1648), the 3-day onco trial clock, and the client gates. The copy
in this branch (website + paywall) already states the new rule, so code and copy must land together
or the site promises what the app refuses.

## 2026-09-17 · ONCQIS and SURGX free; CliniX one system free, the rest Pro (SUPERSEDED 2026-09-18)

**Decision (owner):** ONCQIS (oncology) and SURGX are included free on every account. CliniX gives
Respiratory free and locks the other four systems (Cardiovascular, GIT and abdomen, Neurology, Short
cases) behind Pro.

**How:** ONCQIS and SURGX already had no Pro check in code; only copy changed (website pricing, in-app
paywall blurbs, and the +₹89 OncoTree + ONCQIS add-on row removed). CliniX: `free: true` on the
system in `clinix/manifest.json` (data, not code); pure `systemLocked()` / `openPackIds()` in
`clinix-model.js`; enforced at every door in `clinix-screens.js` (system card, disease/module open,
resume) and in `loadAllSkills(pro)` so a locked system's skills are not reachable through the skills
library. Refusals route through `SMD_PRO_NOTICE` ("clinix"). `pro-notice.js` gained a `signin` reason
so a signed-out reader is asked to sign in instead of being told their connection failed.

**Trade-off:** client-side only. CliniX content ships inside the native bundle, so a determined user
can read the JSON; same ceiling as every other client gate. Pro here is `SMD_PRO.isProSync()`, which
with `VERIFY_REQUIRED_FOR_PRO` on (default) means verified (7-day free Pro) or paid; unverified
signed-up users see the lock immediately, the launch promo does not open it.

**Open for owner:** the App Store product `in.stewardmd.onco.monthly` (Onco add-on, READY_TO_SUBMIT)
is now unsold; leave it out of the review submission or delete it. Website plan ladder
(Student/Intern/Resident/Physician Pro/Onco+ at ₹129-799) still differs from the in-app/App Store
ladder (Trainee/Co-Resident/Pro/Physician/Physician Pro at ₹199-2,499).
## 2026-09-18 · The paywall sells three plans, and every number on it comes from the server

**Decision:** `pro-paywall.js` opens on THREE cards (Pro / Physician / Physician Pro) with **Physician
preselected** and the **Annual** cycle preselected. Trainee and Co-Resident sit behind a quiet
"I’m a student or resident" link: self-selection keeps the default view premium without making a
cheaper tier unbuyable (the link reveals them, a revealed tier never re-hides, and the CTA follows
whatever is selected). Each card leads with a per-day figure ("₹21 a day. Less than a samosa, and it
runs your clinic.") over one benefit line; a sticky bottom bar always names the tier, the amount and
the period. The Onco add-on is back and is offered on EVERY tier, priced from `plans.addons.onco`.

**Why the honesty rules shaped it more than the conversion playbook.** Three tactics were asked for
and three were changed:
1. **Strike-throughs and SAVE% come only from the server’s `regular`** (x12 on an annual card). No
   `regular`, or one that is not higher, renders nothing. Inventing a "was" price is misleading-MRP
   territory under Indian consumer law and fails App Store review.
2. **The CTA does NOT say "Start 7 days free, then ₹7,499/year".** No purchase path here begins with
   a free period: Razorpay charges on the spot and no StoreKit introductory offer is configured. The
   bar reads "Subscribe to Physician · ₹7,490/year" with "Cancel anytime" under it. The free access
   some accounts already hold is still stated by the banner, from `/api/billing/status`.
3. **The add-on’s "3-day trial everyone gets" renders only if the server sends `addons.onco.trialDays`.**
   Nothing server-side grants an onco trial today, so the sentence stays off until it does.
No countdown, no scarcity, no clinical outcome claim, no statistic, and only assistive framing for
MaiK Voice Scribe ("offers the differentials worth considering"), because a doctor who trusts the AI not to miss
checks less carefully.

**Trade-off:** the default view hides two real tiers behind a tap, and the strike-through disappears
entirely if a KV price edit drops `regular`. Both are deliberate: reachable beats prominent, and a
missing anchor beats a fabricated one.

**Status:** `test/paywall-render.test.mjs` 17/17 (three-card default, preselection, reveal link,
SAVE% from `regular`, no-`regular` → no strike, CTA text per selection, per-day maths both cycles,
benefit lines, and every rupee on a card traced back to the payload), `paywall-interceptor` 4/4,
`paywall-resync` 6/6, `pro-notice` 11/11, `no-ui-emoji` pass, and `test/run-paywall-ui.mjs` 28/28 in
headless Chrome against `test/fixtures/paywall-sheet.html`.

## 2026-09-16 · Image Engine chooser: recommend Hybrid first, add "Don't ask me again"

**Decision:** `recommendFor()` now recommends Private Device OCR - relabeled "Hybrid" in the UI whenever
its automatic second-reader check can actually engage (`hybridReady()`) - ahead of AI Vision, which
drops to second, then plain on-device OCR/On-device AI last. Two independent readers agreeing is safer
than either alone, and it is free when the on-device model does the checking. Falls back to the old
AI-Vision-first order when hybrid cannot engage (no consent yet and no local vision pack downloaded, or
`smd_icu_hybrid=0`, or no device OCR at all as on web). The engine-card copy and Settings list relabel
the "device" option "Hybrid" with an updated description under the same condition, so the picker and
Settings never disagree about what the recommended option actually does.

Added a "Don't ask me again" button to the chooser sheet, distinct from the existing "Remember my
choice" checkbox: remembering only pre-selects the radio next time, the sheet still shows; the new
button (`localStorage.stewardmd.imageEngineSkipChooser`) skips the sheet entirely and routes straight to
the remembered engine. Re-enabled from Settings ("Ask which engine to use every time"), shown only while
skipped.

**Bug fixed in passing:** `getPref()`/`setPref()` only ever persisted `"ai"` or `"device"` -  choosing
"On-device AI" and checking "Remember my choice" silently reverted to Device on the next photo. Found
because the skip button is pointless if the remembered engine isn't the one actually chosen. Now all
three values round-trip.

## 2026-09-16 · ICU OCR digit reader ported to Android (TFLite), not a second cloud model

**Decision:** The on-device CRNN-CTC digit reader (1.5M params, 3MB, iOS Core ML since 2026-09-15) is
now on Android too, via the SAME training checkpoint (`best.pt`) converted PyTorch -> ONNX -> TFLite
with `onnx2tf`, not retrained. Verified before shipping: 50/50 exact text match and ~0.00002 max logit
diff against the original PyTorch model on the held-out parity set (tighter than the Core ML export's
own 0.028). Ships as a new Android source set on the existing `@stewardmd/capacitor-vision-ocr` local
plugin (`local-plugins/capacitor-vision-ocr/android/`), registered under the SAME Capacitor plugin name
(`VisionOcr`) and the SAME `readDigits({base64Image, boxes}) -> {available, reads}` contract as iOS, so
`native-bridge.js` / `reasoning.js` needed ZERO platform-specific changes - `window.SMD_NATIVE.readDigits`
just starts working on Android because `Capacitor.Plugins.VisionOcr.readDigits` now exists there.

**Why this instead of a small vision-language model:** the owner asked for "any small image reading
model, fewer parameters" after seeing the local-hybrid MedGemma check take 2-5+ minutes per photo on
Android. Every vision-capable MaiK pack is 4B-class (2.5-3.1 GB); there is no smaller VLM in the app,
and reaching for an off-the-shelf small VLM (SmolVLM, Moondream) would mean unproven digit-reading
accuracy plus real GGUF/TFLite integration work. The digit reader already exists, is purpose-built for
exactly this (7-segment/LCD monitor numerals, not general images), and was proven safe on iOS. Porting
it is strictly cheaper and safer than adopting a new general model.

**Gotcha found during conversion:** onnx2tf's fast "flatbuffer_direct" path (used automatically when
`onnxsim` isn't installed) does NOT apply the usual NCHW->NHWC transpose to the OUTPUT tensor the way it
does the input. Confirmed by inspecting the compiled `.tflite`'s IO shapes directly: input is `(1,48,192,1)`
NHWC as expected, but output is `(1,16,48)` - `(batch, class, time)`, NOT the PyTorch/Core ML model's
`(1,48,16)` `(batch, time, class)`. The Kotlin decode indexes `logits[0][k][t]` accordingly - verified
against the PyTorch parity data before writing the Android decode, not assumed from the PyTorch shape.

**Verified live on the Pixel 9** (no stubs): `VisionOcr.readDigits` against two real detected OCR boxes
(ground truth HR=95, MAP=68) returned `95` at conf 0.9999999884 and `68` at conf 0.9999978847 - both
correct, both comfortably above the 0.999 threshold, in 46ms total (vs. 2-5+ minutes for the MedGemma
hybrid path on the same hardware). `window.SMD_NATIVE.readDigits` and `V2.digitReadBoxes`/`applyDigitReads`
confirmed reachable and wired with no code changes beyond the plugin itself.

**Open question, not yet resolved:** in a full `readImageLocal` run on the same fixture, the confirmed
"95" did NOT flip HR from `NEEDS_REVIEW` to `AUTO_ACCEPTED`. `applyDigitReads`'s own contract is "confirm
or conflict, never add a value" - it only satisfies the *two-scale-confirmation* blocker specifically,
not every reason a field can be held for review, and this fixture is a deliberately hard adversarial
photo (glare, invalid-values banner, big-clock distractor). This may be correct, existing, cross-platform
behavior (unrelated to the Android port) rather than a defect - not confirmed either way before this
entry was written, since the phone disconnected (owner picked it up) mid-investigation. Check whether
the SAME non-promotion happens on iOS with this fixture before concluding anything is broken.

**Build note:** the local Capacitor plugin's `android/` folder must be mirrored into BOTH the worktree
(source of truth, committed) and the real checkout at `~/Developer/StewardMD/local-plugins/...` - Gradle
resolves the plugin through `node_modules/@stewardmd/capacitor-vision-ocr`, which is a relative symlink
(`../../local-plugins/...`) that resolves against wherever `node_modules` physically lives, which for
this worktree is a symlink back to the real checkout. A worktree-only edit to a local plugin's Android
source is invisible to a build run from the same worktree until it's copied to the real checkout too.

## 2026-09-12 · Connect Hospital: explore everything, then ask the doctor

**Decision:** The phone crawl is exhaustive (every control under one patient record, read-only SKIP list, keywords only order the walk) and captures label/value report blocks as well as tables; whatever is still missing is asked of the doctor in a new plugin `guide` mode (question banner, Done, no touch overlay) and the tap path is saved as the replay pattern. Details in `connect-hospital-next-2026-09-12.md`.

**Why:** On GHIS radiology, discharge and history sit inside "Patient profile" as report blocks a keyword-gated, table-only crawler never reached; a doctor can show the agent in seconds what heuristics miss.

**Trade-off:** One `list_notes` per manifest (schema uniqueness), so radiology/discharge/history compete; ids with digit runs are refused as anchors even when stable. Inline report lines keep their label text.

**Status:** Built and tested (unit, real-DOM Chrome, broker, UI harness); awaiting the on-phone autonomous run after PR #1038 merges.

## 2026-09-10 · Browser provider for Connect Agent: jo-inc/camofox-browser over REST API

**Decision:** Browser provider for Connect Agent = jo-inc/camofox-browser (Camoufox engine), driven over its REST API by connect-agent/camofox-client.mjs.

**Why:** Bot-detection resistance on real hospital EMRs; endpoints verified against its openapi.json.

**Status:** Decided; verified against a running jo-inc/camofox-browser 1.14.0 server.

## 2026-09-10 · Main-world evaluation prerequisite for Connect discovery

**Decision:** Main-world evaluation is a hard prerequisite: discovery installs and reads its observer with the "mw:" prefix, enabled by the connect-agent/camofox-plugins/main-world plugin.

**Why:** Camoufox isolates evaluate() by design, so a plain-realm observer is invisible to page scripts (verified live).

**Status:** Decided; verified against a running jo-inc/camofox-browser 1.14.0 server.

## 2026-09-10 · Disqualification of Camofox Playwright tracing for doctor sessions

**Decision:** Camofox Playwright tracing is disqualified for doctor sessions.

**Why:** It records the login POST body (credentials), cookies, bodies and screenshots, and can only be enabled at session creation.

**Status:** Decided; verified against a running jo-inc/camofox-browser 1.14.0 server.

## 2026-09-10 · HMAC-SHA256 signature verification for consent receipts

**Decision:** Consent receipts are HMAC-SHA256 signed with CONNECT_CONSENT_SIGNING_KEY and verified server-side; no unkeyed fallback.

**Why:** The previous unkeyed digest was never verified and was forgeable.

**Status:** Decided; verified against a running jo-inc/camofox-browser 1.14.0 server.

## 2026-09-10 · Versioned adapter spec validation (schemaVersion 1 and 2)

**Decision:** Adapter spec validation is versioned: schemaVersion 1 (legacy, default) keeps keyword blocking; schemaVersion 2 separates action verbs from clinical-domain nouns so read endpoints validate.

**Why:** v1 rejected ordinary reads like GET /patients/{id}/medications.

**Status:** Decided; verified against a running jo-inc/camofox-browser 1.14.0 server.
## 2026-09-10 · Skn X calm clarity UI selected

Use the calm clarity direction for Skn X: native system typography, translucent navigation, grouped
surfaces and a clear camera-first action. It keeps the clinically important hierarchy quiet and legible
without changing analysis or safety behavior. The local Material Symbols font is explicitly applied
inside `#sknxRoot`, preventing raw ligature names when offline. Cache: `sknx18calm1`.

## 2026-09-09 · WardSynQ TASK 4.16 (Downtime/Business Continuity): the 6×4 policy matrix, documented not rebuilt

**Decision.** The plan asks six failure modes (network, payment gateway, payer system, LIS/RIS,
identity service, database) to each have an EXPLICIT CONTINUE-SAFELY/QUEUE/READ-ONLY/FAIL-CLOSED
behavior, and forbids ever silently pretending a sync succeeded. Audit found every cell already
correctly implemented - the gap was that none of it was written down as a stated policy in one
place. This entry IS that policy statement; no behavior changed.

| Failure mode | Bucket | Evidence |
|---|---|---|
| Network unavailable | **READ-ONLY** | `functions/_wardsynq/downtime.js` - a stamped, staleness-aware, write-nothing paper snapshot. Its own header: "a route that mutated the record to prepare for an outage would be one more thing to go wrong during one." |
| Database temporarily unavailable | **FAIL CLOSED, with an honest error** | Every bridge (`downtime.js`, `lab-result.js`, `critical-results.js`, and the rest) maps a repository exception to `{ok:false, status:502, error:"record_read_failed"/"record_write_failed"}` - never a swallowed failure, never a silent success. `repository-d1.js` throws `VersionConflictError`/the raw D1 error; nothing catches and proceeds. |
| Identity service unavailable | **FAIL CLOSED** | `actor.js`'s `resolveIdentity()`/`resolveClinicalActor()` throw `AuthError`/`PermissionError` the instant an identity/auth dependency fails or returns nothing usable - no degraded-access fallback. This is the one bucket that MUST stay fail-closed: an auth outage granting access anyway is a security bug, not a continuity feature. |
| Payment gateway fails | **CONTINUE SAFELY, by construction** (no live gateway integration exists yet) | `wardsynq-invoice.js`'s `payment` event only records a payment FACT already reported by a human/reconciliation process; there is no outbound gateway call anywhere in the invoice code today for a failure to interrupt. Named explicitly in that file's own header (see 2026-09-09 addition) so a future gateway integration is built to this policy, not against it. |
| Payer/claims system unavailable | **CONTINUE SAFELY, by construction** (no live payer transport exists yet) | `wardsynq-billing.js`'s `submit()`/`resubmit()` are pure local state transitions (`claim.state`, `history`) with no outbound call to any payer adapter - submission-to-payer is an external step this codebase does not yet couple to a live network call. Named explicitly in that file's own header. |
| LIS/RIS unavailable | **QUEUE** (inbound) **/ CONTINUE SAFELY** (outbound) | Inbound: `hl7-inbound.js`'s own header states the ACK/NACK contract explicitly - an uncaught failure here is a transport failure to the sending interface engine, which retries; `fhir-inbound.js`'s exception queue (`landBundle`/`registerRedrive`/`listExceptions`) holds ambiguous bundles for human resolution rather than dropping them. Outbound: `lab-result.js` never blocks an order waiting on the LIS - a `ServiceRequest` simply stays `active` until a result arrives, whenever that is. |

**Why documented, not rebuilt.** No cell showed a real gap - no silent swallow, no infinite retry, no
fabricated success anywhere in the codebase this audit swept. "Never silently pretend synchronization
succeeded" was already true throughout, as a direct consequence of this codebase's own append-only,
honest-error architecture (repository.js/service.js's own header commitments). Rebuilding a second
mechanism to re-enforce an already-uniform pattern would have been unrequested infrastructure; the
plan's own ask - "must be explicitly defined" - is satisfied by writing the definition down, citing
the real code, not by adding a policy-engine nobody asked for.

**What this task did NOT do**, and why: it did not build a live payment-gateway or payer-transport
integration (none exists to fail; inventing one to then define its failure policy would be scope
creep this task's own instruction doesn't ask for), and it did not touch `functions/_wardsynq/
emergency-mode.js` (TASK 4.15) - that file already declares `"downtime"`/`"network-outage"` as
activation *kinds*, and its own header already defers "reconcile actions after recovery" as
separate, future work; this task's per-workflow behavior matrix is the complementary, non-
overlapping half TASK 4.15 explicitly left open.

**Reversible:** this is a documentation entry plus two one-line code comments (see `wardsynq-invoice.js`
and `wardsynq-billing.js`); nothing here can regress by being reverted. Owner may veto or amend the
matrix at any time - it states what the code already does, not a promise the code must be changed to keep.

## 2026-09-09 · Selected outline and glow splash finish

The owner selected option B: retain logo formation, remove the solid fill, and finish with one
restrained halo. Rounded quadratic contour corners and a 4.4-unit stroke keep the outline crisp.
Formation and glow durations are 30% longer (1.56s and 1.43s). The welcome phase begins after the
formation, within the existing three-second readiness window. Reduce Motion shows the completed
outline immediately. Web cache marker: `splashv2k`.

## 2026-09-09 · One visible three-second boot sequence; native launch mark removed

**Decision:** make the required iOS/Android native launch surface an unbranded white bridge and
start the existing SVG trace/fill only at the native-to-web handoff. Returning clinicians now see
the logo draw and the personalised “Loading your workspace…” phase inside one three-second total,
not a 1.2-second lead-in plus a second three-second hold. The splash fails open at six seconds if
readiness detection does not resolve, and the native bridge has a four-second safety release.
`launchAutoHide` is false so native cannot expose an unpainted WebView; JavaScript performs the
handoff once the web content is composited. Android's required system icon is transparent and the
iOS launch storyboard has no image. Cache marker: `splashv2j`.

## 2026-09-09 · Boot splash logo traces, then fills while the app loads

**Decision:** port the draw-then-fill motion from the MIT-licensed `swiftui-logo-draw` reference
into the existing Capacitor boot splash rather than adding its SwiftUI package. StewardMD's mark is
traced as three ordered inline SVG contours over 1.2 seconds; the existing light/dark logo layer
begins filling at 70% and completes in 350 ms. The rest of the splash remains present while the app
loads, and the existing native-splash handoff, personalised second phase, App Lock timing and hard
loading cap are unchanged. Reduce Motion displays the completed existing logo immediately. This
keeps the behavior identical in iOS WKWebView, Android WebView and the web app, while the operating
system launch screen remains the required static bridge until the web splash has painted. `sw.js`
cache marker is `splashv2i`; `test/run-splash-ui.mjs` covers the three paths, fill, both themes,
guest/returning flows, timing and Reduce Motion.

## 2026-09-06 · RadioAnatome 3D — a second, LIVING body from the CT masks; geometry on R2; mobile LOD

**Decision:** add the living-torso CT subject (TotalSegmentator s0108, CC BY 4.0, the same scan
the `ct-live-torso-*` modules show) as a second 3D source next to the BodyParts3D reference body,
meshed from the dataset's expert masks by our own `live3d.py` (marching cubes) + `pack3d.mjs`
(meshoptimizer). Every shipped slice of the three living-torso modules is registered as a plane in
the mesh frame, so CT → 3D lands on the living body with the slice drawn as a textured cut. Host
all geometry on the `stewardmd-models` R2 bucket (`models.stewardmd.in/atlas3d/`) with same-origin
as the first choice, and ship a 60%-triangle LOD of the reference body as the phone default.

**Why:** BodyParts3D has no liver, lung, lobe or closed heart; the reference body is a different
person from every slice we show, so "the same structure in 3D and on CT" was only ever a
vocabulary link. Meshing the masks the slices came from makes it the same voxels. R2 because a
Pages deploy caps files at 25 MiB and the branch preview host was the only working origin;
LOD because 31.8 MB of full-detail chunks over cellular is the open device-run question.

**Audit findings that shaped it:** the volume's z axis runs SUPERIOR→inferior despite the RAS
header (measured on the masks); the reformatted coronal/sagittal volumes are flipped crops; and
the living-torso 2D images display the patient's right on the image right (non-radiological),
which is now a [[Roadmap]] item, not silently changed.

**Trade-off:** +4.5 MB living chunks, +19.6 MB LOD chunks committed under `atlas/3d/` and mirrored
to R2 by hand after each pipeline run (no CI step). Registration of the axial module is 19/22
confident slices on a linear fit (the other 3 are interpolated); coronal/sagittal are 24/24.
**Status: built, 143 tests green (52 data + 33 pure + 58 browser), screenshots verified; device
run pending** ([[RadioAnatome 3D]]).

## 2026-09-06 · RadioAnatome 3D — Human Atlas/BodyParts3D as a DATA SOURCE for one atlas, not a second viewer

**Ask:** evaluate github.com/ashemag/human-atlas (2,234 BodyParts3D meshes, MIT code / CC BY 4.0 data)
as a 3D layer that complements the CT/MRI atlas; do not copy it wholesale; link it to the same
canonical ontology; audit licence + geometry first; report counts.

**Decision:** import the DATA through our own pipeline (`atlas-pipeline/bp3d_import.py`) and render
it with our own ~900-line WebGL1 viewer (`atlas3d.js`) inside RadioAnatome, rather than vendoring
the React/three.js app. Why: the app is buildless ES5 and three.js is ESM-only since r160 (~650 KB);
one anatomy system means one ontology, one catalog, one back-stack. The mapping between
RadioAnatome canonical ids and FMA concepts is HAND-CURATED (`bp3d-map.json`), row by row from the
concept element lists, because names do not match (TotalSegmentator `autochthon` vs four FMA
muscles; SynthSeg `ventral DC` vs nothing). Laterality stays on the 3D side as `left`/`right`
children of the unsided canonical id, honouring the Visible Human no-side rule.

**Audit findings that shaped it:** upstream licence page (2025-02-27) confirms CC BY 4.0 with a
mandated verbatim attribution string, so it renders only on the 3D About screen; 7 meshes are exact
duplicates (rejected); Human Atlas files brain ventricles under "cardiac" (corrected, recorded);
the BodyParts3D "isa" set has NO liver/lung/lobe surfaces, so those canonical structures are
`related`-only and the UI says so instead of pretending a bronchial tree is a lung.

**Trade-off:** 31.8 MB of geometry is committed to the repo under `atlas/3d/` (same precedent as the
52 MB of slices) and streamed per system from Pages, never bundled natively and never SW-cached.
Not yet run on a device; SwiftShader proves correctness, not frame rate.

**Flag:** `smd_atlas3d` defaults ON, applying the 2026-09-04 no-per-device-gating order below;
`?atlas3d=0` still closes it on one device. **Status: built, 111 tests green, PR open;
device run pending** ([[RadioAnatome 3D]], `HUMAN_ATLAS_PROVENANCE.md`).

## 2026-09-04 · ICD Search — shipped default-on, no flag, from the first commit

**Ask:** "now integrate ICD also and add a Search ICD button and add ICD integration into EMR/icu
ward & OPD" — then, when asked which edition, "ICD 10 & 11" (both).

**Decision:** built as a new module (`icd.js`/`icd.css`/`functions/_icd_repo.js`/`functions/api/icd/`,
D1 `stewardmd-icd`) carrying no feature flag at all, applying the owner's earlier "no more
flagging" instruction (see the Scheme Search entry below) from the start rather than shipping
gated-then-flipping. 106,367 codes loaded (71,704 ICD-10-CM + 34,663 ICD-11 MMS), both from public
WHO/CMS downloads, no API credentials needed — see `scripts/icd/README.md` for exact provenance.

**Trade-off:** ICD-10 here is the US ICD-10-CM edition (most complete freely-downloadable
machine-readable set), not the plainer WHO 4-character ICD-10 — documented explicitly so the
extra granularity doesn't surprise anyone. ICD-11 is WHO's own public "Simple Tabulation" export,
current as of WHO's 2024-01 release (not the live API, which needs registered credentials).
**Status: shipped.** See `vault/modules/ICD Search.md`.

## 2026-09-04 · Scheme Search (renamed from Government Health Schemes) — owner overrode the review gate, flag defaults ON for all devices

**Owner's explicit order** (verbatim intent): stop flagging this module behind a per-device toggle;
it should be open for everyone, on every device, by default, effective immediately.

**Decision: reverses the 2026-09-02 "admin review pass before default ON" gate below.**
`smd_govt_schemes` now defaults `true` in `govschemes-flags.js` (was `false`); all 29
`scheme_versions` rows were bulk-promoted `draft` → `active` in the remote D1
(`stewardmd-govschemes`) to match. A device can still force it off with `?gs=0` or
`localStorage smd_govt_schemes=0`, but no further review pass gates default visibility.

**Trade-off, stated plainly:** the per-jurisdiction data quality varies (see
`vault/modules/Government Health Schemes.md` — some states have codes/names but no verified
amounts, e.g. Arunachal Pradesh; some have partial coverage, e.g. Meghalaya IPD). This is now
live to every clinician by default rather than opt-in. **Status: shipped per direct owner
instruction, superseding the earlier default-off decision.**

## 2026-09-02 · Government Health Schemes Phase 1 — schema mirrors Medical Updates, not a new pattern

**Ask:** a national database of every state/UT/central government health-assurance scheme (packages,
native codes, rates, eligibility), searchable by disease/procedure/code, versioned, with full
source provenance. Explicitly told to build a NEW data domain from scratch, India-wide, no
reduced scope.

**Decision: reuse the Medical Updates module's shape rather than inventing one.** Before writing any
schema, read `functions/db/updates_schema.sql`, `functions/_updates_repo.js`, `worker/schema.sql`
(Drugs DB), `onco-protocol-review.js`, `functions/_adminauth.js`, and `*-flags.js` — this repo already
solves "versioned external-document data with provenance" once (Medical Updates: `sources` →
`updates` → `update_versions` → `crawl_logs`) and "structured dataset with fast search" once (Drugs
DB: flat table + FTS5 + sync triggers). `functions/db/govschemes_schema.sql` mirrors both directly:
`jurisdictions` / `sources` / `schemes` / `scheme_versions` / `packages` (+ `packages_fts`, same
FTS5-with-triggers shape as `drugs_fts`) / `crawl_logs`, plus a `clinical_concepts` /
`clinical_synonyms` / `concept_package_map` shape reserved now (empty in Phase 1) so Phase 2's
clinical crosswalk needs no migration later.

**Versioning granularity: per scheme_version, not per package row.** A government package master is
published as a whole replacement document (one XLSX/PDF), never as an incremental diff — so the
version boundary is the scheme_version (one row = one published document), and `packages` rows
belong to exactly one `scheme_version_id`. Re-importing a scheme creates a NEW scheme_version;
the old one's rows are never touched. This is simpler than per-row temporal versioning and matches
how the source data actually arrives.

**Native-key discovery from the real first dataset** (Dr. NTR Vaidya Seva Trust workbook, Andhra
Pradesh — 3,713 rows, 32 speciality codes, confirmed by direct parse): a `treatment_code` alone is
NOT unique — 332 codes are legitimately reused across different specialities (e.g. `S11.36.3` appears
under Cardiothoracic Surgery, ENT, and General Surgery, each a distinct package with its own amount).
The real natural key is `(scheme_version_id, speciality_code, treatment_code)` — confirmed zero
collisions on that triple. Documented as a schema comment so a future importer doesn't "fix" the
apparent duplicates by dropping rows.

**Trade-off: admin review workflow deliberately NOT the two-gate ONCQIS pattern (yet).**
`onco-protocol-review.js`'s DRAFT→R1_REVIEW→INSTITUTIONAL_APPROVAL→ACTIVE state machine with
per-field accept/reject/edit/verify and a blocking "VERIFY" flag is the strongest precedent for
"Upload source → Analyze → Review → Publish," and Phase 3 should adopt its `changeRecords`/audit/
diff shape for scheme updates. Phase 1 instead follows Medical Updates' lighter flow (AI-assisted
classify → human eyeballs an on-screen draft → single admin publish) — correct for getting the
foundation running, not correct as the final production review gate for financial/eligibility data
patients rely on. Revisit before Phase 3 production release.

**Flag:** `smd_govt_schemes` (module master), default **OFF** — not a `PUBLIC-RELEASE-GATE`
default-on candidate like most new StewardMD features, because the data itself is unverified until
Phase 1's data-quality engine and at least one admin review pass exist. Turn on only after the first
scheme_version is marked `verified` in `sources.verification_status`.

**Status:** Phase 1 schema + jurisdiction registry seeded, NTR Vaidya Seva (Andhra Pradesh) workbook
ingestion built. D1 database not yet provisioned to remote (`wrangler d1 create` needs an explicit
go-ahead — real infra/cost, not a code change). API layer, admin UI, and the other 35
jurisdictions' source discovery are follow-up work, delegated per the owner's explicit Claude
Code + agy split. See [[Government Health Schemes]].

## 2026-09-02 · Auto-verification at 1 in 10, and the Subscription tap that asked a verified doctor to verify

**Reported with a screenshot:** the owner's own account wearing the Pro badge while the More → Subscription
row said "This feature needs a verified registration"; and separately, "auto verification of doctors doesn't
work as intended (1/10 of expected)".

**Why auto-verification said no to doctors who are on the register.** Four decisions in
`functions/api/verify-doctor.js`, each defensible alone, that together sent most genuine uploads to
manual review:

| Decision | Effect |
|---|---|
| Live register queried with the number AS PRINTED (`APMC/FMR/112487/2015`) | The app's own register search (`nmc-search.js`) queries the digit core and works. Same service, different question, empty answer. |
| An EMPTY answer from the live register was final | The offline D1 mirror was consulted only when the register was DOWN, never when it was up and did not recognise the form of the number. |
| Name agreement had no notion of initials | `K MANOJ KUMAR` vs `KURMANA MANOJ KUMAR` is one person; the rule needed equal tokens. |
| Register match on number AND name still went to a human under Gemini confidence 0.85 | Self-reported OCR confidence is uncalibrated and sits at 0.6-0.8 for a phone photo. The register match is the evidence; the model's opinion of its own reading is not, once the register has agreed. |

**Fix: `functions/_verify_match.js`**, the pure half of the decision, unit-tested (`test/verify-match.test.mjs`,
27 cases). `nmcQueriesFor()` asks for the core first and the printed form last; `registerLookup()` falls
through to D1 on an empty answer, not just on an outage; `nameAgrees()` honours initials in both
directions and joined names, and still refuses bare initials; `AUTO_VERIFY_MIN_CONFIDENCE` is 0.5, a
sanity floor. **Nothing here can auto-reject**: every "no" still lands in the owner's manual queue with
provisional access. What changed is how many genuine doctors get a "yes" without waiting for a human.
Each pending record now carries `lookup: {queries, source, records}` so "why was this one manual?" is
answerable from the review queue. **Behind a flag, default OFF:** `VERIFY_NAME_ONLY_MATCH=1` lets a
certificate whose number could not be read but whose name could verify against a register that returns
EXACTLY ONE agreeing row (council-narrowed). It is a loosening of the rule, so the owner turns it on.

**Why the Subscription tap asked a verified doctor to verify.** Two readers, two answers, both honest:
the header badge reads the `pro` CLAIM (`pro-badge.js`); the paywall's verify-bounce reads the
`/billing/status` payload `account.js` cached at sign-in (`SMD_PRO_NOTICE.reason()`). A verification
that lands mid-session refreshed the token (so the claim was fresh) and never told `account.js`, so the
cache said "unverified" until the next app open. And for the owner specifically, `accessState()` had no
notion of an owner at all, so the server itself answered `unverified` for the person running the platform.

**Fix, three places.** (1) `_entitlement.js` `isOwnerClaims()`: a platform owner (`_adminauth.js`
`OWNER_EMAILS`, email read from the SIGNED token) holds Pro as a team entitlement, `source:"owner"`.
Deliberately NOT `verified`: verification also unlocks the prescription pad, which stamps a real
registration number, and an owner who is not a registered doctor must still not have that.
(2) `pro-paywall.js` `openPaywall()` decides on a FRESH verdict: when the cache says unverified/pending it
calls `SMD_PRO.sync()` once, then re-decides; the second pass never re-syncs, so a still-unverified
account sees the explainer exactly once and nothing loops. (3) `verify.js` `resyncPro()`: a
verification landing mid-session (upload success, or an owner approval discovered by `evaluate()`)
pushes a cache refresh AFTER the forced token refresh, so the request carries the new claim.

**Trade-off:** one extra `/billing/status` round trip on a Subscription tap by an unverified account,
a rare user-initiated action. Owner Pro is a new server-side entitlement source; it is gated on the
signed token's email against the same owner list every admin surface already trusts.

**Status:** `test/verify-match.test.mjs` 27/27, `test/verify-gate.test.mjs` +5 owner cases,
`test/paywall-resync.test.mjs` 6/6 (sandbox), `test/verify-resync.test.mjs` 3/3 (structural),
`test/run-paywall-resync-ui.mjs` 10/10 in a real browser (`test/fixtures/paywall-resync.html`).
Verification + entitlement suites 124/124. The live NMC endpoint could not be probed from the build
environment (its certificate chain fails verification through the proxy), so the "core not printed
form" claim rests on `nmc-search.js`, which ships to doctors and queries the core.

## 2026-08-27 · The verification split-brain: two stores, one question, no reconciler

**Reported with a screen recording.** The verification panel showed "Your account is verified ✓"
while, at the same moment and for the same account, every Pro feature showed "This feature needs a
verified registration". Both were reading honestly, from different places:

| Reader | Source |
|---|---|
| `GET /api/verify-doctor` (the panel) | the KV doctor record `icu:doctor:<uid>` |
| every entitlement gate (`accessState`) | the Firebase claim `verified` / `verifiedAt` |

They drift whenever a record is written and the claim does not land: a doctor verified before the
claim existed, an owner approval whose claim write failed, a claim cleared by a later merge. Nothing
ever reconciled them, so once drifted the disagreement was **permanent and invisible** - and the new
enforcement turned a latent inconsistency into a hard lockout.

**Fix: `functions/_verify_claim.js` `reconcileVerifiedClaim()`.** The CLAIM stays authoritative - it
is what the gates read, it is signed, a client cannot forge it - so healing is **one-way**: a record
that says verified re-asserts the claim, never the reverse (a stale KV record must not be able to
grant entitlement on its own). Called from BOTH the panel's GET (heals while the doctor is looking
at it) and `/billing/status` BEFORE the entitlement is computed (so Pro returns on the next app open
without the doctor having to know to visit that screen). `verifiedAt` starts now, so an
already-verified doctor gets a full free week rather than one that expired before they saw it.

**The second half, and the reason a server-only fix would have looked broken anyway:** the gates read
claims out of the ID token the CLIENT sends, and Firebase caches that token for up to an hour. A
just-written claim does not reach them until the token happens to refresh. `account.js` now forces
ONE refresh per session when `/billing/status` reports a verified account. Without this the app says
"verified" and every feature keeps refusing for an hour.

**Status:** 8/8 `test/verify-claim-reconcile.test.mjs` (the one-way direction is the load-bearing
case), 15/15 `run-pro-notice-ui`. Suite 2830/2833.

## 2026-08-27 · Selling to institutions: tenant provisioning, and the code-vs-id bug under it

Owner: *"we should also be able to make medical colleges admins ... for each medical college there
will be an admin where I can assign username pwd (autogenerated) and can be linked to google account
... they have full controls and dashboard of faculty and student."*

**Almost all of it already existed** and had simply never been joined up: `createOrg`,
`setMembership`, `setMemberPassword` (salted), and `POST /api/queue/auth/email` which mints a staff
session. A college admin lands on the `admin` role, which already carries every cap except the PGLOG
sign-off ones - so the Academic Cell console, `dept` oversight and the 12 reports were all already
theirs. The missing piece was one owner-gated seam to create a college and hand over credentials.

**New: `functions/api/tenants/[[path]].js`** (ownerOK) - list every institution, create one with its
admin, re-issue a password. Plus a **"Medical colleges" pane** in `admin/index.html`.

**Decisions worth keeping:**
- **The college admin OWNS their org**, not merely administers it. Consequence, accepted
  deliberately: `authorizeOrgAccess` knows only org-owner and membership, so **StewardMD staff cannot
  read a tenant's clinical data through the org routes.** Support means re-provisioning, not reading.
- **Two logins, different reach.** Google (Firebase) reaches everything including the eLOGBook
  console; the generated password mints a STAFF SESSION which reaches the OPD/queue surfaces and
  NOT the logbook, because `functions/api/pglog/[[path]].js` authenticates with
  `verifyFirebaseToken()` alone. Owner chose "Google for admins, password for staff" over widening
  the auth surface of the module carrying the PGMER-2023 9.2(c) signing guarantees.
- Password alphabet excludes `O/0/I/1/l`: it is read off a screen and typed on a phone. CSPRNG,
  returned exactly once, stored only salted+hashed.
- An Academic Cell can never mint an org admin or owner (the `/enrol` allowlist); only the platform
  owner can, through this route.

**The bug found while wiring it, which would have broken the whole enrolment flow.** `screenSetup()`
has always asked for the "Institution code (SMD-XXXXXX)" and stored it as `orgId` - but an org has
BOTH an internal `id` and an `SMD-XXXXXX` `code`, and pglog's gate calls `getOrg()`, a **direct
document fetch by id** that never resolves the code. So a resident typing exactly what their
department told them got `org_not_found`. Fixed in the pglog route's `context()`, which now resolves
either form via `ORG.resolveOrgId()` (a real id passes straight through, so it is a no-op for
existing callers) and returns the canonical `orgId` + `orgCode` from `/me`, which the client then
persists. The Academic Cell console shows `org.code` and stores `org.id` - they are different values.

**Not done, on purpose:** `stewardmd.in@gmail.com` is still hardcoded as a PLATFORM owner in
`_adminauth.js` and `functions/api/verifications/[[path]].js`. Owner said "just for testing he will
be customer", which is not the same as giving up platform access, so the allowlist is untouched.
**While it stays there that account can reach every tenant's data regardless of membership, so a
test using it demonstrates the flow but NOT tenant isolation.** Removing the email from those two
files is the whole change if real isolation is wanted.

**Status:** 10/10 `test/tenant-provision.test.mjs`, 15/15 headless-Chrome
`test/run-tenants-admin-ui.mjs` (which fails on any uncaught exception, because the admin script is
one IIFE and a syntax error there kills every handler silently), 21/21
`run-pglog-designation-ui`. Full suite 2822/2825.

## 2026-08-27 · Acknowledgements: read #ackCard, don't restyle a clone of it

**Owner: "it looks too big".** It was. `openAck()` cloned `#ackCard` into the sheet and used a wall
of `!important` to force every hover tooltip open INLINE, because hover does not exist on touch.
Twelve people x a full bio each is roughly three screens, so the names - the entire point of the
page - were buried in prose nobody scrolls.

**Fix: read the markup instead of restyling it.** `#ackCard` STAYS the single source of truth (the
desktop hover tooltips still use it, and adding a contributor is still one `<span>` there and
nothing else). `ackHTML()` now parses name / role / bio / links out of both markup shapes
(`.creator-tip` -> `.ctp-deg`/`.ctp-bio`/`a.ctp-linkedin`; `.ack-tip` -> `<strong>` + trailing text)
and renders a compact accordion. Owner picked this from four mockups.

- **Collapsed by default, one open at a time** - twelve open accordions is the same wall again.
- **Founders get initials avatars**, contributors do not: it separates the two groups without a
  second heading style, and keeps contributor rows to one line each.
- **`visibility:hidden` on collapsed bios, not just `overflow:hidden`.** Clipping alone leaves the
  text in the a11y tree and in find-in-page, so a screen reader still read all twelve. Caught by the
  browser test, which asserted on `innerText` rather than on height.
- `openAck()` and the About-box "Acknowledgements" tab now share ONE builder, so the two surfaces
  cannot drift. Both render into the DOM at once, so anything testing them must scope to the
  VISIBLE roster - a document-wide query hits the hidden About copy, where `innerText` does not
  respect collapse and every assertion silently inverts.

**Added:** Dr. Sri Harsha Gora, Field Testing & Bug Reports (IM resident using the app on the wards).

**Measured:** 12 people in ~1000 px, was ~3 screens. **Status:** 19/19 headless-Chrome
`test/run-ack-ui.mjs`, driven against the REAL page rather than a fixture, precisely so it fails if
the parser stops matching `#ackCard`. Cache tokens bumped (`home.js` + the SW key).

## 2026-08-27 · Enforcement armed: deletion on, prompt every open, tiered AI limits

Owner, after reviewing the dry-run design: *"push it, turn on auto delete if not verified in 7 days,
and ask them to verify on every app opening, and no launch promo for who not verified (like who
verified had better pro limits while guest have very less)"*. All four, plus the first push.

**1. The sweep is ARMED and DELETES.** `UNVERIFIED_PURGE_ON` and `UNVERIFIED_PURGE_HARD_DELETE` now
both default ON. The concern about irreversibility was raised and the owner reaffirmed, so it ships.
What makes it survivable is not the switches but `decidePurge()`: verified, paying and
pending-review accounts are spared by explicit claim-checked rules, and **nobody is removed who was
not warned by email first** (day 5, send-once, and an overdue-but-unwarned account gets warned rather
than deleted). Either switch can be softened from env with no deploy.

**New: `purgeUserData()` runs BEFORE the account delete.** Deleting the Firebase user alone would
have left the account's saved cases (`icu:index:` / `icu:case:` in CASES_KV), verification record,
budget cache and Firestore `users/{uid}/profile/self` + `doctorDirectory/{smdId}` behind: the doctor
locked out of records we were still holding, which is the worst of both outcomes and a retention
problem rather than a tidy-up. The lifecycle record itself is KEPT as a `purgedAt` tombstone so a
later run cannot reprocess the same uid.

**2. Ask on every app open.** `verify.js` `evaluate()` re-opens the gate for a provisional
(skipped) account once per app OPEN, latched on `_promptedThisOpen` because evaluate() also fires on
every auth/account change. Still dismissible, because unverified keeps the free tier. **Pending
review is exempt** - nagging someone for something they have already done is how a real doctor is
lost. Before this, one tap on skip silenced the prompt for the whole 7 days, so an account could
reach the deletion sweep having been asked exactly once.

**3. Tiered AI limits ON.** `_aibudget.js` already encoded precisely what the owner described and
was simply switched off behind `AI_BUDGET_ON`, now default ON: unverified **0**, verified-not-Pro
5k, Pro 1M, physician 3M, every rung env-tunable. This is also what "no launch promo for the
unverified" means in practice at the token level.

**Gotcha found while arming it:** `monthlyCapFor()` caches the computed cap for ~26h. Verification
changes the tier from 0 to a real allowance, so without busting that cache a doctor verifies and
MaiK still refuses them until the next day - the exact "I did what you asked and nothing happened"
report. New `clearBudgetCache()` is called on both verification paths (auto NMC + owner approval).

**Status:** 2560/2563 (2 pre-existing `mock.module` failures), new suites
`ai-budget-tiers` 6/6 and `verify-prompt` 6/6. PUSHED to `fix/audit-sweep-2026-08-26`.
Recovery point: tag `pre-verify-enforcement-2026-08-27`. See [[Flags]].

## 2026-08-27 · A locked Pro feature must explain itself, with the RIGHT button

**Why this had to ship with the verification gate, not after it.** Enforcing verification turns on a
brand-new failure mode: features that worked yesterday stop working, and the app's existing answer
was either silence or "upgrade to Pro". Both are wrong now. Silence reads as a bug, and a paywall
shown to an unverified doctor takes money for something verification would have unlocked **free**.

**The silence was real, not hypothetical.** `functions/api/cases/[[path]].js` carried the comment
*"client handles 402 silently"* — a doctor's saved patients simply never appeared on their second
device and nothing, anywhere, said why. `icu.js` said "Saved on this device" and stopped there.

**Server: every refusal now names its cause.** `requirePro()` returns `{ reason, verified,
pendingReview }` from `entitlementState`, and the new `needsProBody()` builds the 402 body so eleven
endpoints cannot drift into eleven different answers. Wired through cases, watch (x2), ghis,
queue and `_usage.js`. `proMessageFor()` holds the one wording of each case. `_usage.js` reuses the
`callerVerified` it already had, so a doctor over the free AI allowance who is merely unverified is
told to verify rather than sold a subscription.

**Client: one explainer, `pro-notice.js` (`SMD_PRO_NOTICE`).** `explain()` is pure, so the wording
is unit-tested — the wording IS the feature. Four cases:

| State | What they see | Button |
|---|---|---|
| not verified | "needs a verified registration ... free for 7 days. This is not a payment." | **Verify my registration** |
| review pending | "we are reviewing it, you keep full access" | Got it (**no price, ever**) |
| free week over | "your free Pro week has ended, your saved work is untouched" | See Pro plans |
| unknown | admits it could not confirm, rather than inventing a cause | Open account |

`openPaywall()` itself now bounces an unverified or pending user to the explainer, so **the paywall
can no longer be the wrong door** regardless of which call site opens it. No loop: the explainer
never routes those two reasons back to the paywall.

**Trade-off:** `SMD_PRO_NOTICE` is a fifth place that can render a modal (paywall, AI-limit sheet,
verify gate, guest bar). Accepted: the alternative is each gate inventing its own wording, which is
exactly how "upgrade to Pro" ended up being shown to people who could not benefit from it.

**Status:** 11/11 `test/pro-notice.test.mjs` + 15/15 `test/verify-gate.test.mjs`, 15/15
headless-Chrome `test/run-pro-notice-ui.mjs` (incl. that the unverified button reaches verification
and not the paywall), full suite 2547/2550 (2 pre-existing `mock.module` failures). See
[[StewardMD ID]].

## 2026-08-27 · Pro is an entitlement of a VERIFIED account (three tiers)

**The bug behind the ask.** "The app is not verifying anyone" was true, but not because the gate was
off: `verify.js` has had `BETA_VERIFY_ALL = false` for a while and the forced gate does fire. The
hole was in `functions/_entitlement.js` `isPro()`, whose FIRST line was `if (promoActive(env, now))
return true` - the launch promo (to 15 Sep 2026) granted Pro to every caller **without ever reading
`claims.verified`**. Nothing anywhere in the codebase consulted `verified` when deciding Pro. Eleven
server modules gate on that one function, so the fix is one guard, not eleven.

Secondary hole: the forced gate's "Skip for now" button AND its ✕ both called `startTrial()`, so any
signed-in user got **7 days of full access** by tapping the close box.

**Decision (owner).** Three tiers:

| Who | What they get |
|---|---|
| Verified against NMC/SMC | **Pro free for 7 days** from the moment of verification, then paid |
| Signed up, not verified | **Free tier only**; the account is removed after 7 days |
| Guest (not signed up) | **300 s per session, 2 sessions per day** |
| Proof uploaded, review pending | **Full access while pending** - owner review latency must never be a user-facing outage |

**How.** `isPro()`/`entitlementState()` ask `accessState()` first, which reads **claims only**
(`verified`, `verifiedAt`, `provUntil`) so the hot path stays free of KV/Firestore reads. When
enforcement is on the promo deliberately does NOT apply - it is the exact hole being closed.
`verifiedAt` is stamped at all three places that set `verified:true` (auto NMC, the owner's review
dashboard, the admin console) and **backfilled** in `entitlementFor()` for doctors verified before
this existed, so nobody who did the right thing blinks out of Pro on deploy day.

**Trade-off, and it is a pricing decision:** enforcement effectively **ends the launch promo early**
for unverified accounts. That is the point, but it is the owner's call to keep or revert -
`VERIFY_REQUIRED_FOR_PRO=0` in KV restores the old contract with no deploy, and
`test/entitlement-trial.test.mjs` pins that the flag-off path is byte-identical.

**Client.** `account.js` seeded `_pro = true` for everyone and failed open. Harmless while the promo
covered all; with verification enforced it would flash Pro UI at an unverified account. Now the seed
is the **last known verdict for that uid** (`smd_pro_last:<uid>`), false when never seen - a verified
doctor offline on a ward still gets in, a new unverified account does not.

**Guest 300 s.** Already existed and was already correct (`app.js` writes
`expiresAt: Date.now()+3e5`, ticks `Guest · M:SS`, wipes and reloads at zero; `account.js`
`GUEST_MAX_PER_DAY = 2`). What was missing is that the clock lived in a chip nobody looks at. New
`guest-timer.js` renders the same clock as a **top bar** (additive, never edits app.js) and carries a
backstop teardown at zero, so auto-sign-out is a guarantee rather than a side effect of a chip having
rendered.

**Auto-deletion is built but OFF.** A StewardMD account can own ICU membership and saved clinical
cases, so the destructive path is deliberately two switches deep: `UNVERIFIED_PURGE_ON` (default
OFF - the sweep reports what it would do and changes nothing) and, only then,
`UNVERIFIED_PURGE_HARD_DELETE` (default OFF - otherwise it **disables**, which is reversible).
Day 5 sends one warning email; **nobody is removed who was never warned**, and verified, paying and
pending-review accounts are all spared by explicit rules in `decidePurge()` rather than by a KV
filter that can go stale.

**Status:** 25/25 across `test/verify-gate.test.mjs` + `test/unverified-purge.test.mjs`, 14/14
headless-Chrome `test/run-guest-bar-ui.mjs`, full suite 2531/2534 (the 2 failures are pre-existing
`mock.module` issues in OPD/FollowCare, untouched here). Recovery point: tag
`pre-verify-enforcement-2026-08-27`. NOT deployed. See [[StewardMD ID]].

## 2026-08-27 · MaiK on-device is a Pro feature, not a private beta

**Decision:** `SMD_MAIK_ENGINE.gateActive()` is now **Pro only** - `window.SMD_PRO.isProSync()`.
The shared experimental access-code gate (`SMD_XACCESS` feature `maik_local`) is REMOVED from the
feature: the constant, the client row under Settings > Experimental Features, its `openFeat()`
branch, and the `maik_local` entry in `functions/_experimental.js` FEATURES are all gone. The two
developer escape hatches stay (`localStorage smd_maik_local_bypass=1`, and a native DEBUG build via
`SMD_MAIK_LOCAL.isDebugBuild()`) because the device harnesses drive them and a debug install has no
Pro state to read.

**Why:** it was never a boolean feature flag - it was the FundX/KardioX beta-code gate, so on-device
answering was unreachable for every clinician who did not have a code from the team. A paying
subscriber was being shown a greyed-out row reading "Private beta. Unlock with an access code below"
and a toast telling them to go find one. Owner: make it available to Pro subscribers, no gates.

**Trade-off:** a code can no longer unlock it for a non-subscriber, so existing MAIK-prefixed codes
are inert. Accepted - that is the point of the change. `SMD_PRO` **fails OPEN** (`_pro` defaults
true, only an explicit `{pro:false}` from `/api/billing/status` flips it), so during the launch promo
(to 2026-09-15) this is effectively open to everyone on a native build; enforcement tightens by
itself when the promo ends. That is the right direction: a network blip must never lock a clinician
out of a 2.5 GB model already on their phone.

**Copy** follows the gate: the locked row now reads "Included with Pro. Subscribe to unlock, then
download the model.", the picker row carries a **Pro** pill next to **Beta** (Pro = access, Beta =
quality - the model is still ungrounded and can be wrong), and `kbOnlyNotice()` says
"On-device answering is included with Pro." instead of naming an access code.

**Status:** 178/178 `test/maik-engine.test.mjs` + 19/19 headless-Chrome `test/run-maik-engine-ui.mjs`
green. Client-only apart from the dead FEATURES line. NOT yet in a native build - needs
`build-www` -> `cap sync` -> rebuild + reinstall to reach a device. See [[MaiK]].

## 2026-08-26 · ACCEPTED EXPOSURE: real patient identifiers are permanent in main's history

**Owner decision: leave it, and record it here so it is not rediscovered as a surprise.**

**What happened.** GHIS work captured against the live server used a real admitted patient. Real MR
and IP numbers reached four files and were committed. `c47cdb47` ("GHIS: confirm activation by
identity, not HTTP status; redact patient ids") replaced them with synthetic ids in the WORKING
TREE — it stripped 32 identifier-shaped values (7-, 8- and 9-digit) across:

- `docs/ghis/captured-initial-assessment-write.md`
- `functions/api/ghis/[[path]].js`
- `test/ghis-save-docid.test.mjs`
- `test/ghis-ward-assessment.test.mjs`

**A redaction commit does not remove anything.** The pre-redaction blobs remain reachable at
`c47cdb47^` and its ancestors, and those commits are now in `main`. `git show <parent>:<file>`
returns the real values to anyone who can clone. This is permanent short of a history rewrite.

**Why it is being accepted rather than purged.** The repository is **private with 0 forks**, so the
audience is exactly the people who already have repo access. Purging means `git filter-repo`/BFG
plus a force-push to `main`, which invalidates every existing clone and all eight active worktrees —
a real cost against an exposure that is already bounded. That trade is the owner's to make and they
made it.

**What this does NOT make acceptable.** `CLAUDE.md` says: never commit PHI. That rule is unchanged
and this entry is not a precedent. The failure was not the redaction, which was correct and prompt —
it was capturing against a **real patient** when a synthetic one would have proved the same thing.
Capture against synthetic identifiers, or redact BEFORE the first commit, because after it there is
no undo that does not hurt.

**If the repo is ever made public, this must be revisited first.** Publishing without a history
rewrite would publish these identifiers. Treat that as a hard gate on any decision to open the repo.

**Found by:** the parallel session that did the GHIS work, which flagged it rather than quietly
leaving it; verified independently here against `origin/main` before being recorded.

## 2026-08-26 · One icon treatment on Home, and one stroke weight across three glyph systems

**The split was a selector, not a design decision.** The glossy sphere lived on
`.rnav-tile.feat .rnav-badge`, and `feat` marks a **branded** module, not a more important one. So
six tiles (FundX, SknX, CliniX, SURGX, MAiTRI, OncoTree) read as the product and twelve — FollowCare,
OPD Queue, Dictate, Scan Meds, Guides and the rest — read as placeholders, for a reason that had
nothing to do with them. The sphere is now the base `.rnav-badge`. `.feat` is kept as a hook: it no
longer owns the sphere but still marks a branded module and still carries the status dot.

`.addtool` opts OUT deliberately — an empty slot inviting a choice is not a tool and should not
pretend to be one. It needs the inherited sheen and shadow explicitly cleared or it renders as a
*broken* sphere.

### The trap worth remembering: `stroke-width` is in USER units

Measured on the real page, the badges disagreed badly:

| glyph | artboard → box | effective |
|---|---|---|
| inline SVG | 24-wide viewBox at 32px | 2 × 1.333 = **2.67px** |
| the ECG | **48**-wide viewBox at 36px | 2 × 0.75 = **1.50px** |
| Material Symbols | `wght 400` at 28px | ≈ **2.30px** |
| brand PNGs | inline-styled | **48 / 38 / 34px** |

The ECG was drawing at *nearly half* the others, and nothing warned anyone: the same literal `2`
draws a different thickness in every viewBox, so **an icon drawn on a wider artboard silently comes
out thinner**. This will happen again to the next icon someone adds on a non-24 artboard.

**The fix is `vector-effect: non-scaling-stroke`**, which takes the viewBox out of the equation —
`stroke-width` then means SCREEN pixels, so ONE number governs every SVG however it was drawn.
Everything is driven from `--rds-glyph-stroke: 2.5` in `redesign-system.css`, with Material's weight
axis at 500 to sit on the same line. Solid shapes (`.pupil`, `.p`, `.n`, `.beam`) are explicitly
excluded, or they take an outline and bloat.

The three brand marks moved from inline `width:48/38/34px` to a shared `.ai-brandmark` class: one
optical box, `object-fit: contain`, which also deleted a triplicated inline filter.

**Verified by measurement and by screenshot in both themes**, not by reading the CSS — the only
honest way to check a visual property. Every SVG reports `eff=2.50px`, every ligature 28px/`wght 500`,
every brand mark inside a 38px box.

**Known limit, not a bug:** `surgx-logo.png`, `maitri-logo.png` and `clinix-logo.png` are RASTER. Size
and colour normalise; the drawn line weight cannot. They read slightly finer than a Material glyph at
38px. Redrawing them as SVG at 2.5px is the only real fix, and that is illustration work.

**Not touched, deliberately:** the top quick-action row (`.rnav-qa-btn`) and the bottom tab bar are
different components and keep their compact outline style. Unifying them is one more selector if the
owner wants it. See [[Flags]] for the module gating that decides which tiles appear at all.

## 2026-08-26 · SURGX notes survive a reinstall, without a background sync

**Decision:** an explicit, confirmed **backup + restore** to the surgeon's own Google Drive
(`surgx-backup.js`), NOT continuous sync. **Why:** notes are encrypted device-local with no note
server by design, and every native install creates a new container, so a reinstall destroys them —
twice, already. The `drive` destination that shipped in August is a readable `.txt` per note: an
export for a human, not something the app can read back.

**Why note bodies and not ciphertext:** `surgx-store.js` encrypts with a per-device, per-account
random secret in `localStorage`. A reinstall wipes that secret, so backed-up ciphertext would be
permanently unreadable. A backup that cannot restore is not a backup. The file carries note JSON
into the doctor's OWN Drive — the same data class and destination the sanctioned `.txt` export
already uses — and restoring re-encrypts under the new device's secret.

**Why not auto-sync, given the request was "get SURGX synced":** the module's PHI posture states
that every non-local send needs `confirmed:true` AND a second in-UI tap, and that no silent or
background upload path exists. Continuous sync would break both. So the feature is foreground and
double-pressed, and **the owner is told plainly that background sync remains available as a
deliberate decision to relax that posture** rather than something shipped quietly under a
sync-shaped request. **Trade-off:** the surgeon must remember to back up; the mitigation is that the
control sits in the Notes screen where the loss is felt, not buried in settings.

**Restore is additive**: strictly-newer-wins on `updatedAt`, equal timestamps skip, so a repeat
restore writes nothing and a restore onto a working device cannot roll back newer edits. See
[[SURGX]].

## 2026-08-26 · The overlay-stacking trap again (MaiK), and the brand field's missing query

**A third module hit the same z-index trap.** `#maikSheet` is **999**; `.db-overlay` (Drugs
Database) is **880** and `.mc-overlay` (Calculators) **870**. The "Open in StewardMD" copilot chips
called `TOOLS[kind].open()` with the MaiK sheet still up, so the module opened BEHIND it, working
and invisible. The sibling chip group (`data-maik-tool`) always `close()`s first, which is precisely
why those worked. **Rule, now three modules deep (SURGX, CliniX, MaiK):** before deep-linking into a
shared app surface, either close your own overlay or lift the target above it. Never assume a module
overlay is below yours. Also: the "Drug database" chip pointed at `MEDDRUGS.openList()` (drugs.js,
the small local list used elsewhere only for `openInteractions`) instead of `MEDDB.openList()`
(api.js, the 4-lakh brand index) — `surgx-screens.js` already carried a comment warning not to
confuse the two, and this is what confusing them looks like.

**The Rx pad had no entry of its own** — only from a MaiK answer or a consult. It now has a tile in
the Hospital hub. Opening it cold also produced NO drug row, because `regimenFromCtx()` always seeds
a `"Lifestyle & general measures"` **advice** row, which carries no drug/brand input: a length check
on `lines` therefore never fires, and the pad looked populated while offering nothing to type into.
The guard tests for a non-advice row.

**The brand field could not find brands the Drugs Database found instantly — same backend, one
missing query.** The pad resolved the typed drug to a composition via `/search` and filtered that
molecule's brands; it never called `/brand-search`, which the Drugs Database pairs with `/search`.
So a drug field holding a shorthand the composition index does not carry (`Amoxiclav` for
Amoxycillin + Clavulanic Acid) made every brand unreachable, while the empty state still said "Type
the drug first". Two further faults surfaced while fixing it: clearing the box left the previous
drug's suggestions on screen, and `if (loading) return` DROPPED a newer drug mid-flight, parking
`loadedFor` on the wrong molecule. Requests supersede now. The rules live in **`rx-brand-match.js`**
as pure functions, for the same reason `functions/_sse_parse.js` was extracted: unit-testable
without a browser. **Harness note:** the app calls `location.reload()` when the guest session
expires, which lands mid-run and wipes long browser tests — keep them short and push detail into
unit tests. See [[Scan-Meds and Drug Index]].

## 2026-08-26 · Edge swipe ownership, and the profile that never loaded

**The edge swipe belongs to home; every other screen goes back.** `homeIsForeground()` decided "am
I at home?" by asking `elementFromPoint()` about ONE pixel, the viewport centre. Anything not
covering that pixel was invisible to it (a bottom sheet shorter than half the screen, a small
dialog, a top-anchored panel), so home still looked like the foreground and the swipe opened the
MENU instead of dismissing what was on top. A structural check now runs first: is a LIVE layer
stacked above `#homeV2`? Measured on the app, at home every layer above home (`sbBackdrop`,
`hvScrim`, `harrisonQuotePopup`) is `opacity:0` AND `pointer-events:none`, while an open sheet's
scrim and sheet are `opacity:1` / `pointer-events:auto`. Both conditions required, so a parked layer
can never suppress the home menu. The pixel test is KEPT as a second, independent condition because
it still catches an overlay rendered INSIDE `#homeV2`. `edgeSwipeAction()` was
`openMenuAtHome() || goBack()` and is now an explicit either/or, so a false positive can no longer
open the menu on a screen the user meant to step back from. **Also:** `#hvSheet` (More, the settings
sheets, Customize tools, Account) ships no back/close control, so the `BACK_SEL` scan found nothing
in it and clicked a stray match on the home screen UNDERNEATH, leaving the sheet open. `goBack()`
now clicks `#hvScrim`, whose handler is the app's own `closeSheet()`. Pinned by
`test/run-swipe-back-ui.mjs`. **Not reproduced:** "the sidebar opens on every page" did not occur on
any screen driven in the web build; what was found is the same rule failing on sheets/dialogs. If it
persists on device, check the installed bundle's `?v=`.

**The Profile's professional details never loaded.** Firestore is loaded LAZILY
(`window.SMD_loadFirebase`), so `window.SMD_DB` does not exist on a cold start;
`acctFillProfessional()` looked once, saw no DB and declared "Offline" with no way back but a manual
Retry. It now boots Firebase and re-fills the sheet that is on screen at that moment. Separately,
`offline()` appended its notice unconditionally, so a second call stacked a second
"Couldn't load your details" row (visible in the owner's screenshot); it is now keyed on
`data-offnote`. **Trade-off:** none. `Offline` now means an actual failure.

**Nothing ever asked for the professional details.** `hospitals-in.js` (~2,400 institutions) and its
searchable picker were already wired into the Profile card, but the card never loaded and no flow
requested them, so the directory looked absent. `profile-setup.js` asks on every app start when a
signed-in user is missing phone / college / degree / speciality; "Later" postpones for that app-open
only. It writes the SAME `users/{uid}/profile/self` doc the card reads. Degree and Speciality are now
rows on the card too, chosen from shared lists that live in `profile-setup.js` so the two surfaces
cannot drift. **MBBS is in the degree list** although the request named only PG degrees: a
near-mandatory form must let an intern or medical officer answer truthfully. Pinned by
`test/run-profile-details-ui.mjs`. See [[StewardMD ID]].

## 2026-08-26 (follow-up) · Closing the sweep's own caveats: verify by observation, not by reading

The sweep below shipped with three stated caveats. Two are now closed by evidence; the third needs
the owner. Closing them turned up a real bug the original fix had left standing.

**Verification, not more code.** The answer-cache fix was pinned only by asserting the ORDER of two
blocks in the handler's source. That is too weak for this particular bug: the original defect was
code that was present, correct, and in a plausible-looking place — a source grep would have passed
against the broken build. `test/maik-cache-wiring.test.mjs` now drives the real exported
`onRequest()` over the live-stream path with a fake KV and a fake Gemini upstream and asserts on
OBSERVED EFFECTS (a `maik:ans:*` key appears; the next identical question makes no upstream call).
**Checked the check:** run against the pre-fix handler (`9f9e4770^`) the three live-stream tests
FAIL and the three controls (non-stream, differential-not-cached, flag-off) still pass.

**Confirmed against live prod, read-only.** `MAIK_KV` (`c110474d…`) holds 453 keys, 114 under
`maik:`, including `maik:route:` — and **zero** under `maik:ans:`. `maik:cfg` reads
`{"answerCache":true,...}`, so the KV runtime override is NOT the explanation. That is the reported
symptom reproduced live and the last alternative cause ruled out. The FIX itself cannot be verified
in prod until it deploys (server changes go live on push to `main`); the post-deploy check is
`npx wrangler kv key list --namespace-id c110474def2947ddb657d93a6f9cbefe --prefix "maik:ans:" --remote`
turning non-empty.

**A browser test found what the unit tests could not.** KardiQ had no headless-browser harness, so
the Learn-progress fix rested on unit tests plus a one-string UI edit. `test/run-kardiox-progress-ui.mjs`
drives the real library + lesson screens in Chrome — and the bookmark still did not persist. Cause:
`data-act="kx-bookmark"` had TWO live handlers, the lesson screen's `host.onclick` on `#kxScroll`
and a duplicate `case` in the router's delegated listener on the ancestor `#kardioxRoot`. One tap
toggled the store twice and netted zero. Invisible before the sweep (the toggle only mutated an
in-memory record that was already lost on reload); once the store became real it WAS the bug.
**Decision:** the router's duplicate case is deleted rather than the screen's handler silenced —
`kx-bookmark` is emitted by exactly one screen, which also owns its `aria-pressed` and toast, and
`render09` already documented the toggle as local. **Trade-off:** a future screen wanting the same
`data-act` must handle it itself; there is no such screen. See [[KardiQ X]].

**`MAIK_GUEST_DAILY_LIMIT` set back to 15** (owner ran it; two attempts from this session were
refused by the environment's permission policy). 15 is also the code default in `functions/_usage.js`.
**Not live yet:** Pages binds secrets at deploy time — Cloudflare's own docs say a secret "needs to
be done before a deployment that uses" it — and production is still deployment `87b57391`
(`main` @ `d59d8ba`), which predates the change. The next push to `main` picks it up; no separate
action needed if #760 is merged. Nothing verifies this from outside, since secrets are write-only
and the effective limit is not exposed on an unauthenticated route: confirm on the Pages deployment,
not by probing.

## 2026-08-26 · Audit sweep: four open items, each fixed at the seam every caller routes through

Cleared from [[Roadmap]] and the 2026-08-25 handoff. Nothing here needed new architecture; each was
a fix in the one place all callers already pass through, plus a test that pins it.

**1. The MaiK answer cache was UNREACHABLE, not broken.** `maik:ans:*` stayed empty with
`MAIK_ANSWER_CACHE=1` even though the router cache proved the KV binding good — the cause the
handoff left open. The block sat BELOW the live-stream early return in `/explain`, so with
`MAIK_LIVE_STREAM` (or `?livestream=1`) on, the handler returned the SSE response before reaching
either the read or the write. Lookup hoisted above that return; the stream path now writes from its
completion callback via `context.waitUntil` — the same pattern the router cache uses, which is
exactly why that one always worked. **Trade-off:** none; flag-off is still byte-identical.

**2. CliniX content could never be updated on a cached device.** SURGX's `?v=<contentVersion>` fix
applied verbatim. See [[CliniX]].

**3. KardiQ Learn state was frozen inside the content records.** `status`/`masteryPct`/`bookmarked`
are fields of the shipped, read-only bundle, so the 1,041-lesson pack rendered "new · 0%" forever
and bookmarks died on reload. Real state already existed in `kxProgress` (localStorage); the library
now overlays it in `mockLibrary`, the single seam every screen reads through, and never mutates the
content record. Two more in that layer: the progress ring's denominator was a hardcoded `100`
against a 1,141-lesson library, and one lucky answer marked a lesson mastered — mastery now needs
repeated success on SEPARATE days, which is what this log already said it should be.
**Drift corrected:** the 2026-08-22 entry below says the `tier:"atlas"` mismatch makes all 1,041
pack lessons "unreachable through the UI". Verified against the code: they DO render under the
default "All" chip and in search; what was true is that no tier chip could ever surface them. An
Atlas chip is added. The rest of that entry's critique (1.9 MB parsed on every load, no media
licence manifest) stands unchanged, and so does the decision to build CliniX like RadioAnatome.

**4. `functions/_research.test.mjs` had been red since #596** made per-module caps opt-in; it still
asserted the old always-on 2/day. It now asks for `MAIK_ENFORCE_CAPS` the way `test/ai-usage.test.mjs`
already did, and pins the launch default too. **The cap behaviour was never wrong — only the test.**

Also corrected: `native-bridge.js` claimed `X-SMD-App` was INERT because no server code read
`env.APP_GATE_KEY`. Three handlers read it and the secret has been in prod since 2026-08-16, so the
header is load-bearing — acting on that comment would have locked the native app out of `/api/*`.

**Status:** 2495/2495 unit green + `test/run-clinix-ui.mjs` green in a real browser. Client `?v=`
tokens bumped. NOT deployed — server changes go live on push to `main`; the client needs
build-www → cap sync → rebuild.

## 2026-08-24 · SURGX projects the existing surgery engine rather than re-authoring it
New module (see [[SURGX]]), built behind `smd_surgx` off tag `pre-surgx`. Three decisions worth keeping.

**1. `ws-surgery.js` was ABSORBED, not duplicated, and not edited.** The app already had a working
surgical decision engine: 13 syndromes with focused findings, danger signs, a deterministic
`assess()` returning an emergency flag, a management-ladder index, source control, referral, notes
and empiric antibiotic regimens with an ICMR reference. The obvious move - author SURGX protocol
JSON covering the same syndromes - would have produced two places where "acute abdomen" gets a
recommendation, drifting apart. That is exactly the failure recorded above for the KardiQ content
pack. Instead `compileEngineProtocol()` projects the engine's own output onto a seven-band spine, so
**parity is structural rather than tested-for**, and `ws-surgery.js` has zero changes. Provenance,
an INVESTIGATE band and calculator links live in a separately-reviewed overlay JSON. Eight authored
protocols cover only what the engine does NOT model (ATLS, shock, sepsis, chest, head, burns, GI
bleed, post-op deterioration).

**The projection is deliberately non-interpretive.** `result.sc` is source control so it becomes
DEFINITIVE; `result.ref` is referral so it becomes ESCALATION; `result.mgmt[]` is an unstructured
note list so it is carried WHOLE rather than scattered across bands by keyword matching.
Regex-splitting clinical prose into bands would silently relocate a safety-critical line, and that
class of change is precisely what the module exists to prevent.

**2. For Notes, only ONE of the four anti-fabrication layers is a prompt.** An operative note is a
legal record. The prompt says "do not invent"; the server intersects the model's keys with the
schema's `aiFillable:true` set and then applies a hard DENY list on top (counts, specimens,
implants, consent, discharge medications, identifiers, attribution); the client voids any field
containing a number absent from the transcript; and export is blocked until every required field is
clinician-confirmed, behind a double press. Layers 2 to 4 are code. **A prompt is a request, not a
mechanism** - the same conclusion `clinix-tutor.js` reached about dose refusal.

**3. Notes reuse `SMD_RX.canPrescribe()` as the clinician gate rather than inventing a role check.**
There is no client-facing role read in this app, and verify.js already draws the line in the right
place: a student "unlocks StewardMD's learning tools" while "prescription and clinical-action
features stay locked". Notes is on the locked side of that line. SURGX Notes does not prescribe, so
this is STRICTER than needed - the correct direction to be wrong in, at zero cost. An unverified
user SEES the section and is told what is needed; hiding it would read as a broken app.

**Trade-off accepted:** notes are device-local only (AES-GCM via `SMD_CLINIC_CRYPTO`, key in
localStorage). That defends against a backup or a storage-panel dump, not against code execution on
an unlocked device, and it is written down as such rather than glossed. Moving the secret to
Keychain/Keystore is the marked upgrade path. **Status: built, flag ON for testers, content
ai_drafted pending R1.**

## 2026-08-23 · Arming OTA on a device DOWNGRADED it to the pre-CliniX bundle
**Measured on the owner's iPhone 15 Pro, not inferred.** The first device ever built with
`@capgo/capacitor-updater` linked in immediately hit `/api/ota/check`, downloaded a 36 MB bundle and
served it over the fresh install. The app then reported `build 1`, no `clinix.js` (404), and the
pre-CliniX `?v=` tokens, while the correct build sat unused in the app bundle.

The server is the cause, and it is unambiguous:
```
GET /api/ota/check?version=builtin&nativeBuild=7
  -> {"ota":true,"version":1,"commit":"b2b1bdcdbbd6d4df94e7598c595b370ae0073ded", ...}
```
`b2b1bdcd` is the commit immediately BEFORE CliniX. **The live channel is pinned to a stale
commit**, so any device that arms the updater is silently downgraded to it. This is precisely the
failure the 1 Aug system was torn down for ("a stale bundle silently downgrading installs"), now
reproduced by the rebuild on its first real device.

`CapacitorUpdater.reset()` and `delete()` did NOT hold - the bundle re-applied on the next launch.
The only reliable local escape was to unlink the plugin and rebuild. **Decision: do not arm OTA on
any device until the live channel is correct.** Fix the channel (or flip the Phase-1 kill switch,
which is designed to make devices `reset()` themselves) FIRST, arm second. `autoUpdate:"off"` in
`capacitor.config.json` and `isAuto()` in `native-ota.js` were both verified correct, so the apply
path is either the update banner being tapped or something outside those two gates - **worth
establishing before this is armed again.**

**Method note worth keeping:** three wrong diagnoses (service worker, wrong `App.app`, WebView
cache) were guessed before anyone looked. The answer took five minutes once
`ios_webkit_debug_proxy` was pointed at the running WebView and it was asked directly. For a
native WebView bug, attach the inspector FIRST. Note iOS needs the `Target.sendMessageToTarget`
envelope; a bare `Runtime.evaluate` returns "'Runtime' domain was not found".

## 2026-08-22 · CliniX: one skill object, many runners, and two gates that fail closed
New module for medical students (see [[CliniX]]), built behind `smd_clinix` def:false off tag
`pre-clinix`. Three decisions worth keeping.

**1. The atom is a Skill, and Learn / Case / OSCE / Viva / Competency are PROJECTIONS over it.**
The alternative, which every LMS reaches for, is to author a lesson, then an OSCE station, then a
viva bank. That triples the content and guarantees they drift. Here `compileLesson()`,
`compileStation()` and `compileViva()` all read the same object, so an OSCE station is a *selection
of skills plus a clock*, not authored content, and a single `competencyKey()` is what all three write
against. A disease does not own skills, it references them and adds `emphasis` - which is what makes
the fourth disease cheap rather than a fourth full authoring job.

**2. CliniX is built like RadioAnatome, deliberately NOT like the KardiQ Learn atlas.** This is a
measured call, not a stylistic one. `kardiox-content-pack.js` is 1.9 MB of JS parsed on every page
load for every user whether or not they open Learn; `management` is `string[]` in 100 records and
`""` in the other 1,041; user state (`status`, `masteryPct`, `bookmarked`) lives INSIDE content
records and is therefore frozen at `"new"`/`0` forever; `tier:"atlas"` matches none of its own UI's
tier chips, so **all 1,041 pack lessons are unreachable through the UI that ships with them**; and
`assets/kardiox-learn/` holds 872 images with no manifest and no licence record. `atlas.js` already
demonstrates the right answer in this repo: a small catalog, lazily fetched per-unit JSON, and
`atlas-pipeline`'s `require_clear()` licence gate. CliniX takes that, and grounds content in
`kb/reference/*` (4,664 Harrison-cited entries with per-entry review state) rather than authoring a
parallel corpus.

**3. Both gates fail CLOSED, and the module ships with them closed.** The review gate: content whose
`review.status` is not `approved`/`published` never reaches a student, and a missing or garbled
status reads as `draft`. The licence gate: media renders only when `cleared === true` with a real
licence and attribution; **absence of a licence record is a refusal, not a default-allow**. The
consequence is deliberate and visible: all Phase-1 COPD content is `ai_drafted` and no media is
cleared, so a student today sees an explicit "Awaiting clinical review" state and lessons render
captions rather than assets. That is the gate working. **Never flip `review.status` to `approved` to
make a screen look finished** - the whole point is that the owner's clinical sign-off is the only
thing that opens it.

A fourth, smaller call: mastery requires repeated success on SEPARATE days, not one correct answer
(which is what `kardiox-providers.js:112` does, and why no row in the ECG atlas ever shows mastered).
**Status**: Phase 1 built, flag OFF. 55 unit + 36 real-browser checks green; full suite shows 104
failures before and after, identical set, verified against `pre-clinix` in a clean worktree.
**Open for the owner**: per-skill clinical sign-off, and the media work order in
`clinix/media/manifest.json`.

## 2026-08-04 · SknX AI Phases 2-3 (educational report merged; clinician-Rx built OFF)
See [[SknX]]. **Phase 2 (MERGED, PR #622):** evidence-grounded educational dermatology report using the REAL Gemini/Vertex transport (`functions/api/sknx` reuses `callGemini`, mirrors the audited thorex proxy) + Explain-Like + Compare. Three hard invariants, each tested: no raw image/PHI to the LLM (image-key reject + strict whitelist + recursive scan; TEXT-only prompt), no hallucinated citations (guidelineSummary/references only from the vetted `sknx-evidence.js` corpus; the LLM writes only the free-text discussion), no Rx (deterministic management principles; LLM discussion dropped if it looks like an Rx). R2 (AI-safety) + R1 (clinical) APPROVED; referral guardrail INTACT. **Phase 3 (built, branch `claude/sknx-phase3`, flag OFF):** `smd_sknx_rx` def:false. `sknx-rx.js` drafts a class-level first-line regimen (no patient dose) the clinician confirms/doses/signs in the existing `SMD_RX` pad; the affordance is impossible unless rxEligible + not-referral + flag-on + verified-prescriber, and malignant/urgent conditions (melanoma/BCC/SCC/cellulitis) are never draftable. **Decision: SknX never prescribes autonomously and never on a malignant/referral case; the `smd_sknx_rx` flag must NOT flip on without R1 clinical + R3-DPDP + R7 sign-off.** **Why:** prescribing is the one clinically-loaded capability; keep it clinician-confirmed, KB-grounded, reversible, and hard-gated. **Trade-off:** the real vision models (weights + native Core ML/TFLite) remain the one asset-dependent piece; everything else is real/mock-swappable. **Status:** Phase 2 merged (R1+R2 clean, 75 unit + 19 e2e); Phase 3 flag-OFF scaffold, 82 unit + 23 e2e green, pending R1 GO/NO-GO + its own PR.

## 2026-08-01 · Connect Track A (FHIR/SMART) + Track B (HL7/CSV legacy feeds)
Built on `feat/connect-fhir-smart` (off merged main; tag `pre-connect-fhir`), both behind own flags default OFF. **Track A** = synchronous FHIR R4 **pull** via SMART Backend Services (`private_key_jwt`): asymmetric-only signer (alg:none/HMAC structurally impossible), token-endpoint **trust gate** validated pre-sign + re-asserted pre-POST, envelope-sealed NON-PHI token cache, same-origin pagination, FHIR->SCCM. **Decision:** the frozen `SMART_HOST_ALLOWLIST` is a HARD CEILING — a per-tenant config override may only NARROW it (fix from the token-exchange red-team, which also caught a string-allowlist substring-match degrade + an unvalidated-fhirBase SSRF); connector is dual-mode (SMART when `secret_ref` present, else Phase-0 no-auth) for zero regression; scope is SCCM-canonical (medications family = MedicationRequest+MedicationStatement). **Track B** = HL7 v2 + file/CSV **event/push** via one HMAC-gated ingest spine (mirrors abdm/ingress): verify(constant-time HMAC)->replay(freshness+HMAC'd nonce)->correlate(authoritative tenant from `connect_feed`, headers cross-check only)->route->validate/filter/PHI-free-audit->discard; hand-written no-dep parsers, warn-never-throw, budget-bounded; no StewardMD actor on push. **Why:** realizes the reserved pull + event profiles; the egress/auth boundary lives where the secret/PHI crosses. **Trade-off:** AL1/DG1 ADT maps + local->LOINC crosswalk owner-gated/deferred. **Status:** 391 connect (incl smart/hl7/csv/abdm) + 208 top-level green, zero regression; benches under budget; DUAL-ADVERSARIAL reviews on the signer/token (SAFE, exfil HIGHs fixed) + HL7 parser + ingest spine. NOT merged/pushed — owner // VERIFY the real FHIR+AS host allow-list, client registration, and the HL7 inbound auth/transport before any real feed (see `docs/connect/track-a-b-onboarding.md`). See [[Home]].

## 2026-08-01 · Connect Track D — Enterprise RBAC + MaiK wiring behind the egress gate
Built (behind `smd_connect` + new `smd_connect_maik`, both OFF; tag `pre-connect-track-d`, branch `feat/connect-track-d-enterprise-maik`): (1) deny-by-default fail-closed RBAC (owner/admin/clinician/auditor) on the existing membership seam — PHI actions are clinician-only, `egress:baa` owner-only; (2) MaiK consumes canonical SCCM via `buildMaikContext` behind the R7 `assertEgressAllowed` gate. **Decision:** the wiring is SERVER-CENTRIC — the single existing-file touch is one flag-gated, fail-safe block in `functions/api/ai/[[path]].js` (before `renderGroundedPrompt` in `explain`); the client `home.js` is untouched; the patient binding is server-held (envelope-SEALED in KV, no raw patientRef in KV). Only the R7-GATED egress lane is folded into `pkg.patientCase`; a live bundle without `egressBaaOk` feeds the deterministic lane only (served to the clinician's device by the new `functions/api/connect/maik` surface), NEVER the LLM. **Why:** `callGemini` is the third-party egress, so the invariant must live where the egress lives; flag-off is byte-identical (63 ns hot-path). **Trade-off:** meds/allergies fold into the existing `findings` channel (no second live-function change); `research` handler + target-in-audit deferred. **Status:** 118/118 connect + 208/208 top-level green, zero regression; DUAL-ADVERSARIAL reviews on RBAC + egress gate. NOT merged/deployed — owner ratifies the RBAC matrix + flips `egressBaaOk` only after BAA/DPA + no-retention LLM tier (see `docs/connect/track-d-enterprise-maik.md`). See [[Home]].

## 2026-07-30 · Block internal source/docs from public serving
Pages serves the repo root, so `docs/` (runbook) + `CLAUDE.md` were publicly reachable (leaking team ID, SHA fingerprints, the inert-gate-key note). `functions/_middleware.js` now 404s internal paths (`docs/`, `vault/`, `ios/`, `*.md`, `CLAUDE.md`…). **Trade-off**: none for the app (only web assets are served). **Status**: live. Protects [[Home|this vault]] too.

## 2026-07-30 · On-demand native assets (fetch from stewardmd.in)
Heavy, flag-gated module assets are stripped from the native bundle and fetched on first use, cached by the WebView. First: [[FundX]] MediaPipe (~22 MB). **Why**: shrink install. **Trade-off**: one-time download on first module use (fallback: LOCAL→SELF→CDN, so nothing breaks). **Status**: phase 1 live (AAB 124→115 MB); ONNX / Learn / ML-Kit / offline-KB pending — see [[Roadmap]].

## 2026-07-30 · Vision/OCR pinned to a strong fixed model
[[Scan-Meds and Drug Index]] `/vision` used the global model → an admin model-override to `gemini-3.5-flash-lite` degraded handwriting OCR. Now `VISION_MODEL` (default `gemini-2.5-flash`), ignoring the text override + emergency-cheap. **Why**: misreading a drug is a safety risk. **Status**: live.

## 2026-07-30 · Admin access = exactly 3 owner accounts
`drmanojkurmana@` / `mkkmanojkumar0@` / `kdiwakar45@gmail.com`; removed `stewardmd.in@`. Set in ALL gates (server `_adminauth.js` + `verifications`, client `home.js`/`sidebar-redesign.js`) + env `OWNER_EMAILS`. Server (Firebase id-token email) is the real boundary; client lists = UI visibility. **Status**: live.

## 2026-07-29 · Intent Firewall = allow-list, not block-list
See [[MaiK Intent Firewall]]. Require a positive medical signal; reject the rest. **Why**: a block-list can't enumerate all non-medical topics. **Invariant**: zero false-refusals. **Status**: live (gold1041).

## 2026-08-20 · Intent Firewall: refuse only what we can NAME; the model handles the rest
Amends the 2026-07-29 allow-list decision, which stood on one wrong assumption: that "no positive
medical signal" means "not medical". It means "not in our vocabulary". A doctor's own device transcript
had MaiK answering "What is PCOD?" and "What is SGLT2 drugs mechanism of action?" with "MaiK is for
healthcare professionals. It answers only medical and clinical questions." The **invariant of zero
false-refusals was being violated by the firewall's own default branch**, and no amount of vocabulary
can close it - medicine is open-ended.

**Now:** `classify()` returns `certain:true|false`. Gate on `MaiKScope.isRefusable(q)`, which is true
only for a POSITIVELY identified non-clinical category (code / creative / general / lay). An
unrecognised query goes to the model, and the model refuses non-medical itself (`MEDICAL_ONLY` in the
Vertex prompts, and a medical-only line in the on-device SYSTEM prompt). The model has the world
knowledge to tell PCOD from a state capital; a regex does not.

**Cost accepted:** a genuinely non-medical query that we cannot name deterministically now costs one
model call to refuse. The named shapes (code, creative, general knowledge, travel, sport) are still
refused for free. That trade is the right way round: a wasted call is cheap, telling a doctor their
clinical question is not medical is not.

**Corollary:** the client gate and the server `firewallBlock()` must share ONE predicate. They had
drifted - the server already excluded the uncertain bucket, the client did not, and the client is what
doctors saw. **Status**: live. See [[MaiK Intent Firewall]].

## 2026-08-21 · iOS background download is capped ~1 MB/s; chunking buys resilience, NOT speed
**Measured, after two wrong turns.** The controlled comparison that settled the diagnosis was the
owner's own: same Wi-Fi, same room, same hour, same 3.11 GB file on HuggingFace - **Android
DownloadManager 10.5 MB/s vs iOS background URLSession 1.3 MB/s**. So the origin is not the cap and
**R2 would not fix iOS**; the ceiling is client-side.

**The burst-vs-sustained trap.** A DownloadProbe measured 20 MB bursts: default session 6.55 MB/s,
background 1 stream 1.08 MB/s, background 4 range tasks 4.77 MB/s. The 4.4x looked like a per-task
throttle, so a chunked downloader was built on it. The real sustained number, read off the `.parts`
sidecar after a 2.49 GB attempt, was **1.04 MB/s across 8 parallel parts** - identical to one stream.
**A 20 MB burst does not predict a 2.5 GB transfer**; iOS gives an initial allowance and then caps the
session. Measure sustained throughput for a sustained feature.

**Chunking was kept anyway, on different grounds:** 64 MB ranged parts written straight into the final
file at their offset, with a `<name>.parts` sidecar. It buys resilience, not speed - a part is the most
that can be lost, progress survives crashes AND app reinstalls (verified: 1.38 GB preserved across a
reinstall), and a failure at 89% no longer costs 2.5 GB. The sidecar is also the best measurement tool
available: pull it with `devicectl device copy from` and count '1's, no console needed.

**Still untested:** whether a DEFAULT session sustains ~6 MB/s. Only the burst figure exists, and
extrapolating it is exactly the mistake above. If it does, a foreground-first chunked download is worth
building - and chunking is what makes it safe, because backgrounding would cost only the in-flight
parts. **Status**: chunked background download shipped; speed unresolved and honestly so.

## 2026-08-21 · On-device model download stays on ONE background URLSession
**Rejected:** a foreground/background hybrid (default session for speed while on screen, handed to the
background session on `didEnterBackgroundNotification`). It was built, shipped to a device, and
**reverted the same night** because background downloads stopped working: `cancel(byProducingResumeData:)`
is ASYNCHRONOUS, so it tears the running transfer down immediately and iOS suspends the app before the
completion block can restart it on the background session. The download died the moment the app left
the screen.

**The mistake worth remembering** is not the API detail, it is the trade: a VERIFIED capability (a
2.49 GB model completing with the app force-stopped) was risked for an UNMEASURED speed hypothesis.
The 0.5 MB/s figure came off the UI and was never confirmed natively, and the diagnosis ("iOS
background sessions are throttled") was inferred from a Mac-vs-phone comparison, not measured on the
phone. Correctness that is proven outranks speed that is assumed.

**What was kept:** native throughput printing (`[llama-dl] … MB/s`, readable via
`devicectl --console`), so the speed question can finally be measured rather than argued.

**If throughput does need work,** prefer options that keep a single background session: several
concurrent background tasks over byte ranges (a background session may throttle per-task, and a Mac
test showed only a 23% gain from parallelism on an UNTHROTTLED session, so the per-task theory is
untested and worth measuring), or host the files closer to the user (R2, APAC). Do NOT reintroduce a
foreground/background handoff. **Status**: reverted, background-only shipped.

## 2026-08-19 · Recording a vaccination is its own capability
`CAPS.EMR_IMMUNISE`, held by doctor + nurse + intern/resident (owner: "doctor + auth staff"). NOT `emr.treat` (the nurse usually gives the dose, so doctor-only would mean the doctor typing in someone else's act) and NOT `emr.vitals` (once a care context is linked to an ABHA it can never be withdrawn, so this can land permanently in a national health record). Reception/supervisor/cashier hold neither. **Status**: live behind `smd_opd_immunization` (def true, inside the already-gated OPD EMR surface).

## 2026-08-19 · Clinical code lists are GENERATED from the IG, never hand-written
`functions/_vaccines.js` is emitted by `scripts/gen-vaccines.mjs` from the NDHM IG's own `ndhm-vaccine-codes` value set; the server refuses any code outside it and always takes the display from the IG, never the request body. **Why**: a vaccine code in a patient's national health record is a clinical claim ABDM can never retract, and typing SNOMED from memory is how a wrong one ships - the generator's assertion caught HPV as `...109` vs the IG's `...103` on the first run. **Applies to**: any future coded clinical list (route, body site, billing codes). **Status**: live.

## 2026-08-19 · Validate PROJECTIONS against the real validator, not just fixtures
The HAPI/NRCES gate emits two extra bundles built from real product data (a `q_invoices` bill, an OPD vaccination) alongside the eight fixtures. **Why**: fixture ids are hand-written and happen to be legal - the first projected bundle failed with 3 errors because FHIR `Resource.id` forbids underscores and the billing store mints `inv_<hex>`. Fixed at `entryOf()` (the one funnel every resource passes through) and `validateNdhmDoc` now checks the charset, so the class is caught without a JDK. **Status**: live.

## Standing principles
- **Reversible changes**: big/risky changes go behind a feature **flag** + a git **recovery point** (tag/branch); made permanent only after owner approval.
- **Test before you build** (owner mandate): unit + a real headless-browser test before shipping UI/logic.
- **No em-dash** in app-facing text (MaiK AI *output* exempt).
- **Mobile-only**: the web code IS the app (Capacitor renders local `www/`).

## 2026-08-21 — Never deploy a subset of a branch by copying whole files
Hand-copying `functions/api/ai/[[path]].js` from a feature branch onto main (`6064c197`) silently
REVERTED three later main commits and took MaiK Cloud down with HTTP 500 (no provider failover).
Cherry-pick hunks instead, and prove the result: `git show <target>:<file> > /tmp/x && diff /tmp/x <file>`.
A correct server fix was then masked for another hour because the **WebView had cached the failure** -
clearing `cache/` + `app_webview/Default/Cache` fixed it without wiping login or the 2.5 GB models.
Full write-up: `vault/handoff/2026-08-21-maik-cloud-outage.md`.

## 2026-08-22 — ICU visual design system (visual layer only, UX locked)
The ICU dashboard was restyled to read as mature clinical software rather than a generic SaaS
surface. The rule for the pass: **treat the UX as locked** and change only the design layer, so the
whole redesign lives inside `icu.js` `injectCSS()` (plus the one inline `style=` on the unit-picker
card). No component, action, screen, filter, alert rule or navigation path was added, removed or
renamed; `git diff` on that commit contains only CSS declarations and comments.

The system:
- **Surfaces** — paper-grey ground (`--bg`), white `--panel`, recessed `--panel2`; separation is done
  by hairline `--border`, not shadow (`--sh` is a single 1px lift; `--sh-lift` for pressed/raised).
- **Radii** — a 12/10/8 step (`--r`/`--r-sm`/`--r-xs`) replacing 16px + pill-everything. `--r-pill`
  is kept for the genuinely round things (avatars, dots, badges).
- **Colour** — one deep teal accent (`--primary`/`--primary2`); status colours (danger/warn/ok) are
  reserved for status, and acuity now tints the bed tile only when it means something (a stable bed
  is neutral, so exceptions pop). Header chrome is flat `--primary2` — the gradients are gone.
- **Type** — weights pulled down (800 → 600/700), eyebrows 10.5px/.11em, body copy at 400, and
  **tabular figures on every measured number** so vitals/labs/doses stay column-aligned as they change.
- **States** — no scale-bounce; press = brightness/surface change, selection = colour + weight (+ a
  tinted plate in the bottom bar), so selection survives glare and colour-vision deficiency.

Verified by re-running the ICU browser suites (nav, alerts, modal-color, safety-ux, dx-flow,
swipe-remove) — unchanged, incl. the pre-existing failures in `run-icu-nav` / `run-icu-labwatch`
which reproduce identically on the parent commit.

## 2026-08-22 — The StewardMD ID is minted at sign-in, for everyone
The `SMD-XXXXXX` ID was reachable through exactly ONE path: `icu-collab.ensureIdentity`, guarded by
`icuGroupsOn()` and called only from `grpEnsureGroupsSub`. So an ID existed only after a user turned
**Group mode on** AND a unit resolved. That is backwards: a resident does not create units — someone
adds them to one, **by their ID** — so the people who most need an ID were the ones who could not
get one without toggling Group mode purely to mint it. `steward-id.js` already implemented a
universal mint (Phase 1, PR #545) but nothing ever called it: its bootstrap was flag-gated AND ran
`if (window.firebase)` at parse time, while index.html loads the Firebase SDK lazily on idle.

**Decision**: the ID is universal and unconditional, like a national ID number. It is minted on
sign-in for every user (`steward-id-onboard.js`, waiting for `SMD_loadFirebase`), the `icuGroupsOn()`
guard is gone from `ensureIdentity`, and the ID card shows on the solo ICU Team screen too.
Reversibility is a **kill switch, not a rollout gate**: `smd_steward_id_mint` defaults ON and can be
set to 0 to stop the per-user write without a redeploy. The verified-email / Apple-proxy **capture
UI** stays behind `smd_steward_id` (default OFF) — it has open R3/R5 items; minting does not.

**Consequence to know**: every signed-in user now gets a `doctorDirectory/{smdId}` entry holding
`{uid, name}`. That collection is get-only and never listable (rules), so it is a lookup key, not a
public roster — the same exposure ICU users already had, now for all users.

**Latent bug this exposed and fixed**: identity was cached without its uid. With minting universal,
sign-out → sign-in as someone else happens inside one page lifetime, so account B would have been
handed account A's ID — and it would have travelled into referrals, invites and the directory. Both
caches are now keyed on uid and `my(uid)` refuses a mismatch. See [[StewardMD ID]].

## 2026-08-22 — One profile page, and it never renders a shorter version of you
The account sheet had three problems: the StewardMD ID was absent (the only place to read your own
ID was ICU → Team), the professional details (reg no · hospital/college · city · phone) were
appended ONLY inside a successful Firestore `.then()`, and edits went through `window.prompt()`.

The second one is the real bug: when the read was slow, the user signed out, or `SMD_DB` wasn't up
yet, the rows simply never appeared — so the page looked like a profile with nothing filled in
rather than a profile that failed to load. **A UI that degrades by omission lies about the data.**
Every row now renders in every state (loading / loaded / empty / unreadable), with an explicit
"Couldn't load your details · Retry".

Also: `openAccount()` is exported as `window.SMD_openProfile` so all entry points open ONE page —
the sidebar identity block (tapping your own photo, which was previously inert), More → Profile, and
a new Settings → Account → "Profile & StewardMD ID" row. `window.prompt` is replaced by in-place row
editing (hospital keeps the searchable directory picker). Test: `test/run-profile-ui.mjs`, which
drives the real sheet and asserts the failure state still renders all four rows. See
[[StewardMD ID]].

## 2026-08-22 — AI may draft the discharge narrative, never the prescription
"Draft with MaiK" in the Discharge Creator writes prose into a medico-legal document, so the design
is mostly a set of refusals. MaiK drafts exactly four sections — hospital course, condition at
discharge, follow-up, advice to patient — and is explicitly forbidden, in the prompt and by having
no field to write into, from touching:

- **Discharge medications.** Medication reconciliation is the highest-risk act in the document. The
  existing R1 decision already refuses to auto-seed it from running infusions (a summary must never
  tell a GP the patient goes home on noradrenaline); an AI that lists drugs it inferred is that same
  failure with better grammar. Meds stay the clinician's Treatment list.
- **The final diagnosis.** Ask MaiK has never been allowed to set a Dx; drafting a discharge does not
  change that.
- **Pending results.** Asserting that a culture is pending when nobody recorded it is inventing
  clinical fact.

Two further rules: the prompt forbids inventing any value and requires missing data to come back as
a bracketed prompt (`[ confirm admission date ]`) rather than a plausible guess; and **nothing is
written into the form until the clinician ticks that section and presses Insert** — a draft that
silently fills fields is a draft nobody reads. The guideline basis MaiK cites is shown for review and
deliberately NOT inserted, so nothing unverified travels into the printed document.

**Open question for the owner**: whether the printed summary should carry a provenance line saying
parts were AI-drafted. It is stamped DRAFT and clinician-review-required either way, but the
medico-legal answer is a product call, not an engineering one. Deliberately not decided here.

## 2026-08-28 — Interstitial revamp is a flagged override layer, and the returning-user splash is personalised
The three interstitials (boot splash `#smdBootSplash`, first-run intro poster `#introPoster`, landing
splash `#splash`) all live inline in `index.html` — the poster's phase logic sits in the minified
`app.js`, and the poster/landing CSS is inside the ~100 KB single-line `<style>` blob on line 30.
Editing that blob in place would have been an unreviewable diff with no way back, so the revamp is an
**additive override `<style>` layer scoped to `html.smd-splash-v2`**, appended in readable form just
above the poster markup. Flag resolution copies the `rds-on` pattern set before first paint: default
**ON**, `?splashv2=0` or `localStorage smd_splash_v2="0"` reverts. No markup, IDs or phase logic
changed, so `app.js` is untouched and the fallback is exact.

Scope of the visual change is deliberately narrow: composition, spacing, type hierarchy, micro-motion.
The palette is unchanged (same teal `#3fc7b3` / `#0e6e63`, paper `#f6f7f5` and navy-teal gradients the
originals used). Reduced-motion was previously honoured only on the boot splash; the layer now covers
the poster and landing splash too.

**The returning-user splash is personalised with the clinician's own profile photo.** `#smdBootSplash`
is the only interstitial a returning user actually sees (the gate at the top of `index.html` hides
`#introPoster` and `#splash` for them), so that is where "welcome back" belongs. It reads the SAME
record the sidebar and profile sheet read — `localStorage "stewardmd_account"` (`.name`/`.email`/
`.picture`, mirrored from the Firebase user by `account.js`) — because Firebase has not booted that
early; no new avatar field was invented. Signed-in users only; guests and first-time users keep the
brand tagline, and the poster stays entirely logo/brand-led. The photo is accepted only over `https:`
and falls back to a monogram if it fails to load; nothing is written or transmitted. Test:
`test/run-splash-ui.mjs` (CDP, 390x844, covers both flag states and the guest path).

The layer sits on top of the same day's "broaden the splash from antibiotic-only to full platform"
change and styles its module-pill strip too, tightened so the five pills read as one balanced row at
390px instead of breaking 4 + 1.

Also fixed there: `.ip-dev-maik-logo` carried `filter:invert(1)` over a white-on-transparent asset, so
the credit wordmark rendered black on the dark poster. It now uses `brightness(0) invert(1)`, matching
`.dev-studio-logo`.

## 2026-08-28 - Interstitials adopt Direction C (gradient depth, glass cards, real brand assets)
The owner was shown three design directions for the five interstitial screens and picked **Direction C**
(modern app-native: gradient depth, glass cards, bold type). It is built as a **restyle of the existing
`html.smd-splash-v2` override layer**, not a new mechanism: same flag, same default-ON resolution, same
`?splashv2=0` / `localStorage smd_splash_v2="0"` revert, still zero markup / ID / `app.js` changes.

The visual language, from the approved mockups:
- a deep teal-to-navy radial gradient mesh with two soft off-edge glows (teal, amber), expressed as
  extra `radial-gradient` layers in one `background` rather than blurred blob elements, so there is no
  `filter:blur` compositing cost on device;
- glass cards (`rgba(255,255,255,.06-.07)` fill, hairline border, `backdrop-filter:blur(10px)`, 18-26px
  radius, soft elevation) for the AMR stats, the credit card, the case preview and the boot-splash foot;
- bold tight-tracked display type (700-800, -.01 to -.02em), tinted pill chips (teal `#6fe0cf`, amber
  `#f0c060` for the risk/de-escalation note), progress dots as rounded-rect pills with an elongated
  active pill, and a teal glow shadow on the primary CTA only.

Two structural notes worth keeping. `.ip-bg` animates the `background` **shorthand** via `ipBgShift`,
and a keyframe beats a normal declaration, so the previous layer's `.ip-bg{background:...}` never
actually applied; the Direction C rule sets `animation:none` first. Phase 2 and phase 3 are recomposed
without touching markup: the AMR block flips from a 3-up grid to stacked rows by setting
`grid-template-columns:1fr`, and phase 3 becomes one glass card by styling `#ipPhase3` itself and
re-ordering its children with flex `order` (quote, then credit, then copyright).

**Brand marks are the real assets, not drawn shapes.** The mockups used a placeholder shield-and-pulse
SVG and a typographic "MaiK" because the canvas tool could not reach app assets. The shipped layer uses
`/mark-white.png` for the app mark (phase 1 and the landing splash, swapped in via CSS `background` so
the markup is untouched) and `/maik-logo-white.png` for the "a product of" / "developed by" credit,
preserving the existing `.sbs-maik-light` / `.sbs-maik-dark` theme pairing in `.sbs-foot`. Only genuinely
decorative shapes stay generated: the phase-1 pulse line (an inline SVG data URI) and the avatar's
online-status dot.

The boot splash keeps both themes: Direction C's gradient mesh on `.sbs-dark`, a light equivalent
otherwise. The C5 avatar treatment (84px gradient avatar, status dot, translucent "Loading your
workspace" pill) applies **only** in the personalised state, off the same `stewardmd_account` record as
before; the guest and first-run paths are structurally unchanged. Reduced-motion coverage from the
previous layer is retained and now also stills the loading pill. `sw.js` `CACHE` bumped to
`...-splashv2c`. Test: `test/run-splash-ui.mjs`, extended to assert the Direction C treatment, that the
real brand assets resolve 200 (not 404 placeholders), the dark boot splash, and reduced-motion.

## 2026-08-28 — The interstitials get a display face (Bricolage Grotesque) and a hero mark
Review of the Direction C interstitials: *"looks like created by generic vibe coding"*, *"make font
better"*, *"I want StewardMD logo to look big and better"*. Direction C's foundations (gradient mesh,
depth, palette, real brand assets) were kept; what read as templated was the type and the composition.

**One self-hosted display face, not another weight of the UI sans.** `Bricolage Grotesque` (SIL OFL
1.1) now does every brand and headline moment on the five interstitials; supporting copy stays on
`var(--sans)`, so the two roles read as two voices. It was picked for having actual idiosyncrasy in the
letterforms while staying clinical, and for its 200..800 weight axis, which is what carries the
recurring device: **weight contrast on one line** ("Steward" at 300 against "MD" at 800; the AMR
headline at 800 against its kicker at 200). Display sizes are set tight (-.045em) and small labels
loose (.24em) so the hierarchy is optical rather than numeric.

`@font-face` lives in `redesign-system.css` with the other faces, `font-display:block` (as Sacramento
does) so the word-mark never flashes in a fallback, plus a `<link rel=preload>` in `index.html` so that
block period is effectively zero. **Self-hosting is not optional here**: the interstitials paint before
any network is guaranteed inside the Capacitor shell, so a runtime Google Fonts `<link>` would silently
fall back to the system sans offline — exactly the failure that would undo the change invisibly.
`assets/fonts/bricolage-grotesque.woff2` is the Latin subset trimmed to the characters these screens
use with both axes kept, 48 KB (the same size as the bundled Inter). `scripts/build-www.sh` already
copies `assets/fonts/*`, so it ships in the native bundle with no build change.

**The mark is a hero, not an icon in a tile.** 152px on poster phase 1, 118px on the landing splash,
126px on the boot splash, standing free with its own glow and drop-shadow. The rounded glass tile that
used to box it in is gone — it was the single most template-looking element in the set. Note the glow
goes only on `.sbs-mark` (a CSS mask, genuinely transparent); `/logo.png` is opaque to its edges, so a
drop-shadow on `.sbs-logo` renders as a square halo around the artwork.

**Composition.** The poster is left-aligned and top-weighted so phases 1-3 share one axis instead of
being three centred slides, and phase 1 is dropped 58px below the optical centre (via `position`, since
`.ip-phase` runs the ipRise transform) so the empty upper half reads as sky. The AMR figures are an open
list hung off a teal rule rather than a third identical glass card; cards are now the exception (the
credit, the case preview), which is what makes them read. Landing module pills became squared hairline
chips with only the first filled.

Gotcha worth keeping: **phase 3's quote `<br>` must stay.** The markup is `...the only thing<br>standing
between...` with no space either side, so `br{display:none}` sets "thingstanding".

Still presentation-only and inside `html.smd-splash-v2`: no markup, ID or logic changes, flag and
`?splashv2=0` revert unchanged, reduced-motion still covered. `sw.js` `CACHE` and the
`redesign-system.css` token bumped to `splashv2d`. `test/run-splash-ui.mjs` extended to assert the face
genuinely LOADS (`document.fonts.check` on both ends of the axis, the loaded-font set, canvas metrics
differing from the fallback stack, and the woff2 returning 200) alongside the hero sizes, the absent
tile chrome and the weight contrast.

## Interstitials: Apple-style liquid glass for every splash surface (2026-08-28)

Owner review of the LIGHT-theme personalised boot splash on device: he circled the "Loading your
workspace" pill and the "developed by MaiK" footer bar with "can we make this marked boxes liquid
glass for all - it should look like apple liquid glass". Direction C's surfaces were
"translucent fill + flat 1px border + blur(10px)", which on a near-white field renders as a flat
white shape with an outline. On the dark screens it passed; on light it was the flattest thing in
the set.

**One material, six tokens.** `--lg-blur / --lg-blur-sm`, `--lg-fill(-d)`, `--lg-rim(-d)`,
`--lg-inset(-d)`, `--lg-shadow(-d)`, `--lg-solid(-d)` are declared once on `html.smd-splash-v2` in
the boot-splash `<style>` and consumed by the poster/landing layer further down (custom properties
cross `<style>` boundaries, so the two layers stay separate but share one surface language). Every
pill and card on the five screens is rebuilt from them: the loading pill, the developed-by bar,
poster phase 3's credit card, the skip pill, the landing case card, the module chips and the CTA.

What actually makes it read as Apple glass, rather than generic glassmorphism:
- **refraction**: `blur(22px) saturate(180%)` (16px on small controls, so a 30px pill does not smear
  the whole background), always with the `-webkit-` twin, since iOS renders these in WKWebView.
- **specular edge as a 1px GRADIENT border**, not a solid one: the sheen fill is painted to
  `padding-box` and a rim gradient to `border-box` in one `background` shorthand, so no
  pseudo-element is needed (several of these surfaces already spend `::after` on content).
- **layered inset highlights** top and bottom plus a soft ambient drop shadow, which on the light
  theme is most of what makes the glass visible at all.
- **something worth refracting**: the light boot splash's radial blobs were so faint the backdrop
  was effectively flat white, so they were strengthened and two were added under the pill and the
  foot bar. Light-theme copy darkened (`#4a6577` / `#54707f`) to stay readable on the brighter fill.
- **the CTA stays tinted glass**, not clear: a near-solid teal gradient keeps the dark label legible
  and keeps it reading as the one tappable thing; the glass shows up as rim, sheen and refraction.

**Fallback is mandatory.** Each surface has a more opaque plain fill + solid hairline outside the
`@supports ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px)))` block, so a WebView
without backdrop-filter still gets a legible panel.

**Gotcha found here:** `home.js` injects `body.ui-v2 .demo-card{border-radius:16px!important;
border:...!important;box-shadow:...!important}` for the advanced app theme, and that sheet lands
after `index.html`. It had already been flattening the landing case card whenever that theme was on.
The interstitial is a splash surface, not an app card, so `html.smd-splash-v2 #splash .demo-card`
now re-asserts its radius/border/shadow with `!important`. Scoped to that one card. This also made
the harness flaky: the assertion passed or failed depending on whether the injected sheet had landed.

Same commit, owner's second ask: the interstitials display the brand as **StewardMD**, never
"StewardMD.in". Two visible spots, both plain copy in the poster markup: the `.ip-in` superscript on
the phase 1 word-mark and the phase 3 copyright line. Functional uses of the domain (api endpoints,
`mailto:Support@StewardMD.in`) are untouched.

Still presentation-only inside `html.smd-splash-v2`: no layout, size, ID, data or flag changes, and
`?splashv2=0` reverts everything. `sw.js` `CACHE` and the `redesign-system.css` token bumped to
`splashv2e`. `test/run-splash-ui.mjs` grew a `glass()` helper asserting blur+saturate, a rim/sheen
gradient and layered inset speculars on all seven surfaces in both themes, a source check that every
`backdrop-filter` in the material ships with its `-webkit-` twin (Chromium drops the prefixed alias
at parse time, so the CSSOM cannot prove it), and the two brand-text assertions.
## 2026-08-22 — OTA updates, Phase 1: rebuilding what was torn down, this time against the failure
This exact system existed once — self-hosted OTA on Cloudflare (Worker + R2 + admin console),
built 1 Aug 2026, deliberately torn down the SAME DAY. The retire commit is explicit:
"...so it can't be re-armed and leave a stale bundle silently downgrading installs (which is what
broke ICU once)." The user asked to rebuild it (22 Aug 2026), explicitly wanting a PUBG/Duolingo-
style banner update, admin-console control, easy undo, "full user and my control." Full plan
published as an artifact and approved before any code was written.

**Phase 1 (server-only, this session) is deliberately shaped around the one sentence above:**
- **Staging and going live are two different acts by two different systems.** CI (on every push to
  `main`) can only ever write a `candidate` pointer — nothing a device would see. Only an owner
  pressing "Push to devices" in the admin console moves the live channel. Confusing "a build
  exists" with "a build is live" is precisely what the 1 Aug system never separated.
- **The kill switch is the FIRST thing built, not an afterthought**, and is a single R2 JSON
  object checked on every device request — flipping it needs no redeploy, no rebuild, no code
  change. That is the direct fix for "the retire mechanism itself needed a redeploy to re-arm,"
  which is the actual mechanism of the original failure, not just its symptom.
- **Rollback republishes the OLD manifest under a NEW, higher version number**, never moving the
  counter backward — so a device that only trusts "is this newer than mine" still takes the
  rollback instead of silently ignoring it because the number went down.
- A device is never offered a release its native build can't run (`minNativeBuild` gate), and a
  missing/corrupt manifest fails the device check CLOSED, never with a half-answer.

**What's built**: `functions/_ota.js` (pure, deps-injectable, 12 unit tests — the kill-switch ones
are load-bearing), `functions/api/ota/[[path]].js` (HTTP surface), `scripts/ota-stage.mjs` +
`.github/workflows/ota-stage.yml` (auto-stage on push, reusing existing `CLOUDFLARE_API_TOKEN`/
`CLOUDFLARE_ACCOUNT_ID` secrets), a new `ota` pane in `admin/index.html` (18 UI tests against the
REAL console), and an `OTA_R2` binding reusing the existing `stewardmd-offline` bucket — no new
service, no new bucket, no new secret.

**What's deliberately NOT built yet**: the native client (`native-ota.js`, the update banner,
`notifyAppReady()` wiring) and the exact `@capgo/capacitor-updater` wire contract. Nothing in the
shipped app calls `/api/ota/check`. Guessing the plugin's exact release-artifact shape now, before
a real client exists to hold that guess accountable, is how a format mismatch would go unnoticed
until the one time it matters — Phase 2 pins it down against whatever version is actually
installed then. Full detail: [[OTA Updates]].

## 2026-08-22 — OTA updates, Phase 2: the native client, contract pinned against the real plugin
Phase 2 built the actual `native-ota.js` client (`window.SMD_OTA`) and, per the plan, pinned the
exact `@capgo/capacitor-updater` wire contract against the plugin's real current docs rather than
the stale Aug-1 assumption. Two corrections that came out of that verification:
- `capacitor.config.json`'s `autoUpdate` is a STRING enum (`"off"|"atBackground"|...`), not the
  boolean `false` the old plan assumed — using the wrong type would have silently left the plugin
  on its default `"atBackground"` polling mode, fighting our own manual check/download logic.
- Self-hosted delta-via-`manifest` support is ambiguous in the OSS docs. Rather than build against
  an uncertain feature, Phase 2 ships ONE zip per release (`scripts/ota-stage.mjs` now also zips
  `www/`, content-addressed like every other file) — simpler, verifiably matches `download({url,
  version})`'s documented contract, and the per-file manifest `_ota.js` already produces stays
  available for a real delta path later if it's confirmed to work self-hosted.
- The plugin is MPL-2.0, not MIT as stated in conversation earlier this session — corrected here;
  still free, still not the paid Capgo cloud (only their hosted service costs money).

**Two more decisions, both direct extensions of the kill-switch principle from Phase 1:**
- **The kill switch is enforced ON THE DEVICE, inside `check()` itself** — when the server reports
  `disabled` and the device is on a non-builtin version, it calls `reset()` and clears its local
  version right there. A device that already took a bad release does not sit on it waiting for
  someone to reopen the admin console; the moment it can reach the server again, it reverts itself.
- **Two install paths map to two different plugin calls, and nothing outside them is allowed to
  invoke either**: an explicit user tap (banner or the pre-existing Settings button) calls `set()`
  (immediate reload); the user's own opt-in "Automatic updates" toggle calls `next()` (queued for a
  future natural restart, never interrupting a live session). This is the literal mechanism behind
  "nothing applies without the user's own choice" — not a policy statement, an enforced code path.

**Reuse note**: `home.js` already carried a full, correctly-shaped Settings-page integration for
`window.SMD_OTA` (Automatic-updates toggle, Check for updates, Download & install), dormant since
before the teardown and guarded by `if (window.SMD_OTA && SMD_OTA.available())`. Phase 2 is built
to satisfy that EXISTING contract exactly, rather than design a new one — the row activates the
moment `native-ota.js` defines the global correctly, no home.js change needed.

Verified inert (zero exceptions, `available()===false`) in both non-target states: plain web, and
native-WITHOUT-the-plugin-yet — which is the actual state of the shipped app the moment this PR
merges, before the one Phase 3 native rebuild. Full detail: [[OTA Updates]].

---

## 2026-08-24 — MaiK latency: the model was never the main problem

Instrumented the WHOLE request instead of just the model call, and the long-held picture was wrong
in two ways. All figures measured on production, `?stream=1` with timings on the done event.

**Stage attribution (median), before → after:**

| stage | before | after |
|---|---|---|
| head — request entry to the answer path | 1112ms | 12ms |
| pre-Gemini — quota gate, re-rank, prompt render | 409ms | 76ms |
| Gemini first token | ~1900ms | ~1900ms (unchanged) |
| transport — real network | ~92ms | ~92ms |
| **non-model overhead** | **~1613ms** | **~230ms** |

**Decision 1 — "network latency" was a misattribution, and instrumentation is the fix.**
The ~1.2s repeatedly blamed on the network is 92ms of actual transport. The rest was our own code
running before the answer path started. `headMs` / `preMs` / `transport` are now reported separately
on the stream's done event specifically so this cannot be hand-waved again. Attribution before
optimisation — every guess made without it in this session was wrong.

**Decision 2 — KV WRITES were the dead weight, not reads and not the model.**
A KV write costs ~380ms in this Worker. `recordAiUsage` (the admin analytics rollup) was awaited in
front of every clinical answer at ~1096ms, and `checkQuota`'s rate-limit slot write was the final
~380ms. Both now run via `waitUntil`, CONCURRENTLY with the response. Every read in `checkQuota`
finishes in 8-15ms once parallelised — the reads were never the problem.

**What is deliberately NOT deferred**, because it gates: `checkModuleQuota` still counts per ATTEMPT
before the AI call (its contract — deferring it lets a burst exceed the daily cap), the cost cap
still blocks, `deviceCheck`'s READ still enforces the device cap. Refusal ORDER is unchanged:
circuit breaker → rate limit → per-user caps, each awaiting its own read before deciding. Only the
waiting is overlapped, never the decisions.

**Accepted trade-off, stated plainly:** deferring the rate-limit slot write narrows the double-fire
window from "none" to ~380ms on a control the code already documents as best-effort and non-atomic.
It buys 380ms on every answer.

**Decision 3 — prefill is NOT the TTFT floor, so context caching was NOT implemented.**
Tested directly: adding ~6,000 tokens of prompt cost only ~356ms of TTFT (~0.06ms/token), so the
whole 2,338-token system prompt contributes ~140ms of the ~1900ms. Vertex context caching would buy
~0.3-0.6s at most and was declined on evidence, not preference. Recorded so it is not re-litigated.

**Decision 4 — staying on `gemini-2.5-flash`, benchmarked not assumed.**
`gemini-3.1-flash-lite` BROKE live streaming (fell back to whole-answer; reverted immediately).
`gemini-2.5-flash-lite` gave ~200ms better TTFT but produced much longer answers, making total
latency WORSE (stream total 5527ms vs 3877ms), and carries a known router parse-quality regression.
The done event now reports the serving model so a model A/B is verifiable rather than assumed.

**Decision 5 — the router, not Gemini, was the biggest single wait.**
`/api/ai/refine` costs 6.0-7.7s and ran BEFORE the answer on every new question — 6.0s + 3.7s TTFV
is the ~9.7s clinicians actually saw. Now cached server-side (7.695s → 1.557s, `cached:"kv"`) keyed
by a SHA-256 of the normalised query, value = canonical concepts only, never the raw query; and
warmed client-side on a typing pause. Same router, same text, same result — only earlier, or not
repeated. Failed parses are never cached.

**Reliability:** the streaming path had NO timeout anywhere — a stalled upstream held the SSE open
until the phone gave up (measured: a 196-SECOND hang). Now bounded by connect/idle/total deadlines
with one exit that always emits a done event; a deadline-closed stream carries `stalled:true` and
the client refuses to surface it, so the new clean close cannot turn a truncated clinical answer
into one that looks complete. The other device "failures" were HTTP 429 rate limiting — the limiter
working correctly against a back-to-back benchmark, not a transport fault.

**Method note worth keeping:** every latency number before this was taken from curl on a laptop,
which is exactly how a 26.6s on-device regression shipped while curl looked fine. Device numbers now
come from `test/device/maik-bench.html`, run inside the real WKWebView on a physical iPhone via a
throwaway build launched with `devicectl ... --console`. Its control arm uses the PATCHED
`window.fetch` and reliably shows `ttfv == total` — proof on-device that CapacitorHttp buffers and
the pristine XHR transport is required.

---

## 2026-08-26 — Sign-out never wiped anything, in any module

**The gap.** CliniX, SknX, ThoreX, KardioX and SURGX each registered a `wipe()` on
`smd:signout` / `smd-signout` / `signout` / `smd:logout`. **Nothing in the repo had ever
dispatched one of those events.** Every module's privacy contract was dead code from the day it
was written; `kardiox-screens.js` even carried the note "hook the real signout".

Two things hid it. The real path (`signout-fix.js`) ends in `location.reload()`, so a fresh JS
context and a closed overlay *look* like a clean slate while the localStorage keys survive
untouched. And four of the five modules only called `wireSignout()` from `mount()`/`init()`, so
even a dispatched event would have missed any module the student had not opened that session.

**Consequence.** The next person to sign in on a shared device inherited the previous user's
CliniX competency, misses and resume tile; their SknX dermatology history; their KardioX/ThoreX
study records. On a shared ward device that is a real privacy failure, not a cosmetic one.

**Decision.** The dispatch belongs in `signout-fix.js` (the one place that already owns the real
teardown), fired BEFORE the reload — a wipe after the reload never runs. Modules wire their
listener at LOAD, not on mount. `SMD_SKNX_STORE` gained the `deleteAll()` its `wipe()` had been
missing (its handler was a comment reading "no bulk-delete API yet" while the store held up to
100 analyses).

**The consequence that needed a guard.** Making the wipe real also made sign-out an irreversible
way to destroy data: **SURGX notes are encrypted, device-local, have no server copy, and the wipe
deletes the encryption key with them.** Nothing in the app asked before signing out. Sign-out now
confirms *only when there are notes to lose* — an empty store stays a single tap. Fixing a
privacy leak must not quietly create a data-loss path.

**Also, same day, in CliniX:** OSCE graded each skill all-or-nothing
(`record(sid, ps.correct === ps.seen)`), so ticking 5 of 6 items filed one hard WRONG against the
whole skill and a well-performed chest examination read as a weak area. It now records one attempt
per checklist item, matching how Learn, Viva and Case record one per probe, and the miss log finally
names *which step* was missed. A null viva verdict ("MaiK could not judge") no longer fires the
wrong-answer haptic; reaching for the mic no longer erases what the student had already typed.

**Test-harness note.** `test/run-clinix-ui.mjs` reused one Chrome profile across runs, and it
toggles a *persisted* flag (`smd_clinix_viva_voice`) as part of its own assertions — so a passing
run left the flag ON and made the next run fail three checks against correct code. It had been
failing "viva opens on the MBBS tier by default" for the same reason. Fresh profile per run. A test
that fails because the last run of itself passed is worse than no test. (Second harness-state bug of
this exact shape this week; the first was `smd_verify_bypass`.)

---

## 2026-08-26 — SURGX notes get an encrypted Drive backup (the only clinical data with no copy)

**Why.** SURGX notes were the single piece of clinical data in the app with no copy anywhere:
encrypted by `surgx-store.js` under a **per-device random secret** with no server record. A
reinstall makes a new container and destroys them (CLAUDE.md records this costing a linked note
twice in one session), and once the sign-out wipe actually started running (same day, see above)
signing out destroyed them too.

**Why the local ciphertext could not simply be uploaded.** The device secret exists nowhere but
that phone. Uploading blobs encrypted under it would produce a backup no other device could ever
read: insurance that is worthless at the moment it is claimed. So the backup is **re-encrypted
under a password-derived key** (PBKDF2-SHA256 200k -> AES-GCM 256) that the surgeon can reproduce
on a new phone.

**Reused, not reinvented.** That scheme is `personal-clinic.js`'s `encryptBackup`/`decryptBackup`,
already shipping for My Clinic, and the same clinic backup password from the Keychain. One password
for the doctor, one crypto implementation to review, none to drift. Drive auth is native-auth's
existing `SMD_getDriveToken` (`drive.file` scope, so it cannot see the user's other Drive files).
`surgx-sync.js` adds no new auth and no new cryptography.

**Decisions worth not re-litigating:**
- **Opt-in, default OFF** (`smd_surgx_drive_backup`, def false). An app upgrade must never silently
  begin uploading operative notes. Both the feature flag AND a per-account toggle must be on.
- **Silence is not consent.** Personal clinic treats a missing auto-sync key as ON (opt-out). For
  PHI leaving the device that is the wrong way round, so `autoSyncOn()` requires an explicit `"1"`.
- **Both keys are per-account**, mirroring `surgx-store.js`'s `uid()`. Global keys would have meant
  the next person on a shared ward phone inherits "backup on" and starts uploading to their own
  Drive without ever agreeing, and is told they have a backup to restore when they have none. This
  is the same shared-device trap the sign-out wipe exists for.
- **Restore MERGES, newest-wins per note, never deletes.** A restore that dropped a note the phone
  had but the backup did not would turn "recover my notes" into "lose my notes".
- **ONE file, overwritten in place.** Drive must not accumulate a history of operative notes.
- **An empty note list never uploads**, so a fresh install cannot overwrite a real backup with an
  empty one.
- **A My Clinic backup is refused as a note backup.** Both use the same `{smd_enc:1}` envelope and
  `decryptBackup` opens either, so only the payload (`{surgx:1}`) can tell them apart. It is checked
  before anything is written.

**Consistency fix that came with it.** The Notes banner said "Encrypted on this device and never
uploaded ... Sign out wipes them" unconditionally. That becomes a flat lie once a backup exists, so
it now branches, and the sign-out confirmation softens when a backup is present (an alarming
"permanent loss" dialog shown to someone who set up a backup only teaches them to ignore dialogs).

**GHIS was already done.** `smd_surgx_dest_emr` has defaulted true, `/api/ghis/surgx-note` writes
over the same verified transport as the OPD assessment (visit activation, authoritative form
re-serialisation, patient_id mismatch abort, doc_id 0 refusal), gated by the same `QUEUE_EMR_WRITE`
env var. No new work was needed; it needs a patient with an ACTIVE assessment, which is what the
earlier live attempt lacked.

---

## 2026-08-27 — NMC Logbook: a regulatory record, built as a data layer that refuses

**Context.** StewardMD gains a Medical Education module. Phase 1 is the **PG digital logbook** that
PGMER-2023 §5.2(v)–(vi) requires every Indian PG resident to maintain. UG/CBME is explicitly out of
scope and was not built.

**The decision that shaped everything else.** A PG logbook entry is not app data. It is a document a
University examiner relies on, and **PGMER-2023 §9.2(c) puts a monetary penalty on the named
faculty / HoD / Dean who submits a false record**. So every guarantee is a **throw in
`pglog-model.js`**, the pure core that the client AND the Cloudflare Function both import — not a
disabled button, and not a server-only check that a future importer or admin script would bypass:

- `verify()` throws if the actor is the entry's author (namespace-tolerant, so `fb:uid` vs `uid`
  cannot silently disable the guard — that is exactly how this class of check dies).
- `applyEdit()` / `softDelete()` throw on a verified entry. Correction is `amend()`, which snapshots
  the **entire prior document** into `revisions[]` and re-opens verification.
- A return without a reason, an assessment with a blank criterion, a remediation without a plan: all
  refused at the data layer.
- Attestation ids are deterministic + `wCreate`, so **a month can be authenticated exactly once**.

**Decisions worth not re-litigating:**

- **The module does NOT claim "NMC compliant."** It claims *"structured to PGMER-2023 §5.2(v)–(vi)"*
  and, per pack, *"NMC \<specialty\> guidelines, \<year\>"*. Whether a logbook satisfies a University
  is the institution's decision. Every report says so in its own footer.
- **No invented numbers, ever.** `NMC_PG_LOGBOOK_REQUIREMENTS.md` maps source → clause → verbatim
  quote → feature for every requirement, and `test/pglog-curriculum.test.mjs` **fails the build if a
  numeric target does not appear in its own quotation**. Most NMC specialty curricula say
  *"a specified number of cases"* — so those requirements COUNT and show **no denominator and no
  progress bar**. MD Emergency Medicine 2024 is the one curriculum in the set that prints procedure
  minima; those 64 numbers are shipped verbatim, and the 5 procedures it names *without* a number
  stay `null` rather than being back-filled from a neighbour.
- **Provenance is a visible material, not metadata.** An NMC requirement and an institutional target
  must never look alike, so `.pgl-prov` differs by colour AND weight AND border style per grade —
  the distinction survives greyscale and a photocopy. An institutional override may change a
  `target`; it can **never** rewrite a label, source, clause or quote.
- **Attendance carries two provenances and they are not merged.** The 80% is §5.6 (the gazette). The
  751/501-day figures come from the PGMEB FAQ of 10.04.2024 — **a secondary source; the primary PDF
  was not obtainable on 2026-08-27**. They are graded differently, shown differently, and editable.
  The module reports attendance; it never declares anyone exam-ineligible on it.
- **Only VERIFIED entries count toward progress.** A resident cannot advance their own bar; a faculty
  member advancing it is the entire point of §5.2(vi). Submitted-but-unverified work is surfaced
  separately as `pending` so it does not look lost.
- **Two independent locks on self-approval.** `pg_resident` holds no `PGLOG_VERIFY` cap *and* the
  model throws. `admin` is deliberately **not** granted verify/assess/attest — the same separation
  the ONCQIS approval caps already use, for the same reason: signing a trainee's clinical record is
  not a technical-admin power.
- **The DRP semester window is a WARNING, not a block** (§5.2(xii)V). A State's posting schedule is
  not the resident's to fix, and refusing to record a posting that actually happened would make the
  logbook less true, not more compliant. Same reasoning for late logging: the delay is measured and
  shown, never used to reject the entry.
- **It is a logbook, not a second EMR.** The entry schema has no field for a patient name, phone,
  address or Aadhaar; `sanitizeCaseRef()` strips them on write, server-side included; age is a band,
  never a DOB; and `publicEntry(e, audience)` withholds case reference and diagnosis from every
  cross-resident surface — the Academic Cell's institution-wide view (§5.2(iii) "ensure and monitor")
  is a completeness question, so it gets counts.
- **AI cannot touch the record.** Suggestions are filtered against the resolved pack, so the model
  cannot mint a requirement; no AI path creates, edits, submits or verifies anything; and the two
  features the brief listed as AI — detecting incomplete entries, and reminders — were implemented as
  **pure code with no model call**, because a reminder about a regulatory deadline must be right
  rather than plausible.
- **Drafts work with no network and are never called "submitted."** Submitted means a named faculty
  member now owes a verification, which is a fact about the server, not the phone. A queued draft
  says "waiting to submit".
- **Offline computes the same numbers.** The client recomputes progress with the same pure functions
  the server uses, so a phone that was offline and a server that was not can never disagree about a
  number printed on a regulatory document.

**A note for whoever runs the tests next.** The headless UI test binds port **8994**, not the shared
8991. Another worktree's `serve.mjs` on 8991 silently served *its* copy of the app, and 48 assertions
"failed" against code they were never looking at. See [[two-claude-sessions-one-folder]].

### 2026-08-27, same day — what R1 found, and the one that stings

R1 returned **NO-GO** on the module above. Seven critical, nine important. The full before/after is in
`NMC_PG_LOGBOOK_REQUIREMENTS.md` §12; the decisions worth recording here are these.

**Three of the seven were the module inventing a number and attributing it to the NMC** — precisely
the failure the whole design was supposed to prevent. `months >= 2.5` let a 77-day District Residency
satisfy a clause that says three months. `COUNTS_AS_ATTENDED` deducted statutory maternity leave from
a resident's attendance and badged the result "PGMER-2023 5.6", when §5.6 *grants* that leave and
extends the term only for leave **in excess** of what is permitted. And a whole-course target was
"expected" from day one, so a resident three days into residency saw 72 high-severity gaps and
"about 100 intubations expected by now". Writing "no invented numbers" in a design document does not
prevent inventing numbers; a test that reads the source does.

**Two were authorization holes that the client flag does not contain**, because Cloudflare Functions
go live on push regardless of `smd_pglog`: any faculty member in the institution could read any
resident's case references, diagnoses and reflections (both branches of the read guard returned the
same value — the `if` was dead and its comment described a restriction that was not implemented), and
a rotation `PATCH` gated on a caller-supplied org while writing to the rotation's own. The lesson is
narrow and worth keeping: **a comment describing a guard is not a guard**, and a branch whose two
arms return the same value is a bug that reads as a feature.

**The one that stings.** The commit message advertised: *"test/pglog-curriculum.test.mjs fails the
build if a numeric target does not appear in its own quotation."* It could not. The generator
synthesised each procedure's quotation *from that target* (`label + " (" + target + ")"`), so the
assertion compared a number with itself. It passed for all 64 shipped Emergency Medicine minima
without ever reading the PDF — and did not notice that **17 more minima had been dropped**, including
nasogastric tube insertion (100) and lab/imaging interpretation (100), about a fifth of the
requirement, behind a checklist that looked complete. Two neighbouring assertions were worse than
useless: `every OTHER specialty pack ships procedure targets of null` iterated **zero** items in all
sixteen packs and read as if sixteen had been verified, and the EM count was asserted as a **floor**,
which is exactly what let a 69-item list that should have had 87 go by.

**So the fix was not a patch, it was evidence.** `pglog-sources/` now holds the extracted plain text
of all sixteen NMC PDFs (868 KB, checked in, deliberately *outside* `pglog/` so `build-www.sh` never
bundles it into the app), and `test/pglog-provenance.test.mjs` checks every quotation and every number
against it. A number that is not in the source is a build failure.

That test immediately found four things R1's own spot-check had not: the shared 2022 pack dropped
"the" from "from **the** Head of Department"; MD Radiodiagnosis writes "training **program**", not
"programme"; MS OBGY prints "**clinic**-pathological", which had been silently tidied to "clinico-";
and **MD Pathology carried a requirement quoting "…clinico-pathological conferences…" to a clause
that does not exist in that PDF**. That last one was a fabricated quotation. It was deleted rather
than given an invented replacement — PGMER-2023 §5.2(x) already covers CPCs for every specialty, so
nothing was lost by removing it, and inventing a citation to keep a feature would have been the worst
available outcome.

**A quotation is evidence, not a transcription to be tidied.** Where the NMC PDF prints something
odd — "clinic-pathological", "examinationof" with the space missing — the pack now quotes it as
printed, with a note. The test's normaliser is allowed to forgive the *extractor's* artefacts (line-
break hyphenation, page numbers inside a paragraph, padded columns); it is not allowed to forgive
ours.

**Also worth not re-litigating:** the appraisal form now prints no total. The MD General Medicine
Annexure 1 is a banded per-element rating with a comments column and **no total row**, and the module
was synthesising "105 / 135" onto a document an examiner may read. `noTotal` is carried through the
model, the server scoring contract and the report. A mark the form does not have is a mark that was
made up.

### 2026-08-27, later — signatures that mean something: the registration gate and the QR

Two things were missing from a module whose entire purpose is an auditable official record.

**A signature from an unverified account is worth nothing, and looks exactly like one that is worth
something.** PGMER-2023 §5.2(vii) says the logbook is authenticated by "the Post-graduate guide";
§9.2(c) attaches a monetary penalty to the NAMED faculty/HoD/Dean who submits a false record. Both
presuppose a registered medical practitioner. The module was checking a *capability* — what a role
may do — and never whether the *person* was on a medical register at all.

So `functions/_pglog_signer.js` now gates every act of signing: verify, return, assess, sign-off and
the monthly attestation. It does **not** re-implement verification — StewardMD already checks
doctors against the **live Indian Medical Register** via `/api/verify-doctor`, which writes
`icu:doctor:<uid>` and sets the `verified` custom claim. This reads that.

**Decisions worth not re-litigating:**

- **FAIL CLOSED.** If KV is unreachable and the claims lookup throws, the signature is refused with a
  503 that says *nothing was signed*. An outage must never silently downgrade a regulatory signature
  to an unverified one: the resident can wait, a falsified training record cannot be taken back.
- **The registration NUMBER is recorded on the record**, not just a uid — number, council, registered
  name, and how it was verified. A signature that said only "fb:abc123 signed this" is unauditable by
  the University that has to rely on it.
- **`verified:true` with no registration number is refused.** A signature nobody can check is not a
  signature.
- **The uid is de-namespaced before lookup.** `fb:abc` vs `abc` would have made every lookup miss —
  and before the fail-closed rule that would have failed *open*. It is one function, used everywhere,
  with a test.

**The QR.** A printed logbook is trusted because a named person signed it; a PDF of one is trusted
because of nothing at all. Every signed event now mints an 80-bit code and a QR
(`functions/_pglog_verify.js`), and `GET /api/pglog/v/<code>` answers **unauthenticated** — an
examiner holding a printout has no account, and requiring one would make the QR useless to the only
person it exists for.

- **The code is an opaque handle, not an encoding of the record.** A code on a whiteboard leaks
  nothing.
- **The stored record holds an HMAC digest of a FIXED canonical form** — an explicit field list, never
  `Object.keys()` over a live document, whose key order would change with a schema edit and silently
  invalidate every code ever issued. On lookup the digest is recomputed from the live record: if
  someone edits Firestore directly, the page says **TAMPERED** rather than showing a green tick over
  altered content.
- **The honest claim is the one on the page.** This is tamper-EVIDENT, not tamper-proof, and it is
  *not* a cryptographic signature by the faculty member — it is the server attesting to what it
  recorded. A real per-signer keypair needs key custody we do not have, and claiming otherwise would
  be worse than not claiming it.
- **Amending a verified entry supersedes its code.** The old signature described a document that no
  longer stands, so the code says so instead of continuing to validate.
- **Without `PGLOG_SIGNING_KEY`, no code is issued at all** — an uncheckable "verification code" is
  worse than no QR, because it looks like one that can be checked.
- **Minting a code can never take a signature down with it.** If signing is unconfigured or the write
  fails, the record is still signed and auditable; it simply carries no QR and the UI says so.
- **The public payload is PHI-free by construction.** Every field was chosen by asking: *is this
  already on the document the examiner is holding?* Resident name and SMD ID, programme, activity
  KIND and date, signer and registration, and whether it still stands. Never the case reference, the
  diagnosis, the remarks or the reflection.

**The QR encoder is ours** (`pglog-qr.js`, ~350 lines, ISO/IEC 18004 byte mode, versions 1–10). A
library would add a dependency to a buildless ES5 app; an image service would send the code to a
third party and fail on a ward with no signal. **A wrong QR is worse than no QR** — it looks
scannable and is not — so every part with a published reference value is tested against it: the
GF(256) tables, the RS generator polynomials, **all 32 format-information strings from Table C.1**,
the version strings from Table D.1. The QR block deliberately stays **light in dark mode**: an
inverted QR does not scan reliably.

**Two bugs the tests caught, both mine.** `normalizeCode()` folded confusable characters *before*
stripping the `PGL` prefix — and "PGL" contains an L, which the folder rewrites to `1`. Every scanned
and every hand-typed code returned empty. Order was the whole bug. And the first cut of the
supervisor-resolution error overwrote `err.message`, which broke the router's error mapping it was
supposed to feed.

### 2026-08-27, later still — what two security reviewers found, and the rule they both found

Two reviewers (R3 security/privacy, S4 app-security) over the signing + QR surface, independently.
Four blocking findings. Both reviewers found the same two authorization holes without seeing each
other's work, which is the part worth keeping: **the module's own comments described boundaries the
code did not enforce.** A comment is not a control.

**The rule underneath all four:** a boundary defined in two places drifts, and the copy that drifts
is the one that leaks. Every fix collapses a duplicated definition into one.

- **Every entry QR would have read TAMPERED.** The signing side and the verification side each had
  their own list of the field names a signature covers, in two different files, and they disagreed
  twice. Every genuine record would have told the examiner not to rely on it. The tests missed it
  because both sides were handed a hand-built payload — so the fix is `payloadFor()`, one definition,
  called at both ends, plus a round-trip test that signs a real entry and verifies its real code.
  **A signature that cries forgery over honest records is worse than no signature.**
- **The URL printed on every QR was not served.** `/pglog/v/<code>` is extensionless, so the site
  gate classified it as an anonymous page view and returned the marketing home page with a 200. The
  feature existed end to end except for the end the examiner actually touches. Now a server-rendered
  page (no JavaScript at all — the reader is a stranger on an unknown device, often printing it) plus
  a middleware pass-through, and a gate regression test so it cannot silently close again.
- **Any faculty member could sign any resident's entry.** `PGLOG_VERIFY` is an org-wide capability;
  §5.2(vii) is not an org-wide question — it names "the Post-graduate guide". The gate was asking
  what a ROLE may do where the regulation asks who a PERSON is to this trainee.
- **The Academic Cell and the technical admin read every trainee's clinical detail.** The read guard
  tested the department capability first, and both of those roles hold it too, so they took the HoD
  branch and the institution-wide → aggregate line below it was dead code. The role definition in
  `_queue_roles.js` promised the opposite in a comment. Now ordered by named responsibility, with a
  table-driven test enumerating every role against every relationship — this guard has been wrong
  twice, so it gets a table rather than another careful reading.
- **`publicEntry()` was called the privacy boundary and covered entries only.** Assessments (3000
  characters of feedback about a named trainee, their remediation plan, every criterion score),
  attestation notes and the raw resident record including the Firebase uid sat next to it,
  unprojected. A boundary that covers one of four record types is not a boundary.
- **`amend` could mass-assign `deleted`** and retire a verified, signed training record that
  `softDelete()` explicitly refuses to touch — while naming someone else as the deleter. The two edit
  paths kept separate lists of un-patchable fields and disagreed. One `SERVER_OWNED` list now.

Smaller, same spirit: the verification code is a **capability**, not a fact about the record, so it
no longer goes to an aggregate audience; `getUserClaims()` returning `{}` during an outage no longer
reads as "this person is not verified"; the rate-limit key no longer falls back to the
client-supplied `X-Forwarded-For`; `PGLOG_OFF` now covers the public endpoint, because an operator
flipping a kill switch during an incident should not find the one unauthenticated route still
serving; Firestore error detail stays in the log; the SMD ID is masked on the public page; and the
free text posted to the AI endpoint is scrubbed of honorific-led names — the *copy sent out*, not the
stored text, which stays readable to the resident and their guide.

Not done, and owed before a non-tester release: **these fixes have not themselves been re-reviewed**,
and `PGLOG_SIGNING_KEY` is not provisioned (so no QR is issued yet — deliberately).

### 2026-08-27, later still — the logbook becomes a document

Owner's requirement: a logbook must be shareable as a PDF once signed, with at least two faculty and
the HoD signing before it can be approved or shared (the HoD may count as both), and the PDF must
carry a digital signature verifiable through StewardMD so a college or the NMC can hold it and rely
on it.

**The core decision: a CERTIFICATE, not a flag.** "Approved" as a boolean on a logbook would be a
claim about a moving target — a logbook gains entries daily. So certification mints a separate record
that **freezes what it covers**: an HMAC over the exact verified-entry set, each entry with its own
signature state, sorted by id. Amend a covered entry afterwards and the certificate is **superseded**
rather than quietly continuing to validate. The document those people signed no longer exists, and
saying otherwise over changed content is the worst thing this feature could do.

**Decisions worth not re-litigating:**

- **The quorum defaults to exactly the owner's rule** — 2 faculty + 1 HoD, HoD counting toward both,
  so two distinct people suffice — and is per-programme configurable. The same person cannot fill two
  slots: distinct *people*, matched through `sameActor` so a namespace or case difference is not a
  second signatory.
- **WHOSE RULE IS WHOSE, printed on the artefact.** The HoD signature is sourced (the 2022-revised
  curricula say the completed log book is signed by the Head of the Department). The **number of
  faculty signatures is ours**, and the screen and the PDF both say "not an NMC requirement" in those
  words. This is the likeliest place in the module for a local policy to be laundered into a
  regulatory claim.
- **`requireGuide` defaults OFF.** Defensible from §5.2(vii), but a guide who has left, retired or
  died would otherwise make their former trainees permanently uncertifiable, and a rule that strands
  a resident is a rule the department will work around. Whether the guide signed is reported either
  way.
- **The server decides the signing role from the membership.** A client that could name itself "hod"
  would be the entire quorum by itself.
- **Only verified entries are certified**, and what was excluded is printed. A certificate that
  silently omitted unverified work would read as a complete logbook.
- **NOT a digital signature under the IT Act, 2000.** No DSC from a licensed Certifying Authority is
  applied, because nobody here holds such a key. It is tamper-EVIDENT: a QR that re-reads the live
  record and re-derives the digest. **The limitation is printed on the document**, since the person
  relying on it is the person who needs to read it. Upgrading later is a key-custody problem, not a
  rendering one — the certificate record already pins exactly what would be signed.
- **An uncertified export is stamped `NOT CERTIFIED`, with no QR and no signature block.** There is
  no configuration in which the exported document is ambiguous about whether anyone signed it. That
  ambiguity is the only way it could mislead by accident.
- **The print QR is a TABLE of cells, not the SVG.** The export runs through two renderers — the iOS
  WKWebView (fine with SVG) and an html2canvas fallback (not reliably). A QR that silently fails to
  render is worse than no QR, because the document still says it is verifiable. It needs an explicit
  `<colgroup>`: `table-layout: fixed` reads column widths from the first row, and a QR's first row is
  all quiet zone, i.e. one cell spanning everything.

**A real bug this surfaced, well outside the feature.** The certificate's content digest flipped
between "request" and "issue" for no reason a reader could see. Cause: `getEntry()` re-attached the
signature block that `M.entry()`'s schema drops, and `listEntries()` did not — the same stored
document came back with a registration number down one path and without it down the other. Same shape
as the two field lists behind the QR digest. It had a second, silent consequence nobody had noticed:
every report's "verified entries carrying the signer's registration" count was reading zero. One
`withSignature()` now serves every read path.

**Measurement note.** The browser test first "failed" the printed QR at 132.8px against an expected
123px. That was not the QR: the app carries a root `zoom` of 1.08 for the OS text-size setting. The
assertion was wrong, not the code — so it now tests **module uniformity and squareness**, which is
what actually decides whether a scanner can read it, and is zoom-independent.

## 2026-08-28 — The boot splash is a SEQUENCE: the classic splash first, the personalised one second
Owner feedback from a real device, in strong terms: the v2 layer had *replaced* the classic boot
splash, and the classic one is not negotiable. The composition he wants on open is the original:
light field, the interlocked mark, the two-tone "Steward**MD**" wordmark, "Built by clinicians, for
clinicians", the thin progress bar, and the "DEVELOPED BY [MaiK]" foot, in **both** the light and the
dark variant. What the v2 layer built is not rejected; it is **misplaced in time**. It should come
*after*.

**So `#smdBootSplash` now has two phases inside the same element.**
- **Phase 1 (default, no class):** the classic CSS, untouched. Every v2 rule that changes composition
  (126px mark, the display-face lock-up, the "Loading your workspace" glass pill in place of the
  progress bar, the full-width row foot, the `.sbs-personal` hiding of the wordmark and tagline) is
  now scoped to `#smdBootSplash.smd-boot-phase2`. The single carry-over is the **liquid-glass
  material on the developed-by bar**, which the owner had explicitly asked for: material only, the
  classic stacked composition and the 53px MaiK logo are kept.
- **Phase 2 (`.smd-boot-phase2`):** the personalised "welcome back" screen, added by the existing
  inline personalisation script after a **900ms beat** plus a **220ms crossfade** (opacity on
  `.sbs-center` / `.sbs-foot`; instant swap under `prefers-reduced-motion`).

**It cannot delay boot.** The beat is a bare `setTimeout` that no-ops if the splash is already fading
(`.sbs-hide`) or detached, so a fast boot goes straight to the app exactly as before — the phase is
skipped, never waited on. The splash's own `MIN`/`CAP` hold logic is untouched.

**Only signed-in returning clinicians reach phase 2.** The beat is scheduled inside the
personalisation block, which already returns early for guests and first-run users — so they keep the
classic splash for the whole boot, and their "what you created" arrives as the intro poster and
landing splash that follow. That is also why the phase-2 field is painted on a `#smdBootSplash::before`
overlay rather than swapped into `background`: a background-image swap cannot crossfade, an overlay's
opacity can, and phase 1 then keeps the genuinely original white / dark-teal field.

Same flag, same default-ON resolution, `?splashv2=0` still drops the whole layer. `sw.js` CACHE
`...-splashv2e` → `...-splashv2f`. Test: `test/run-splash-ui.mjs` now asserts the classic phase FIRST
in both themes (107px mark, two-tone 30px/800 wordmark, the tagline, the 132x3 progress bar, the
stacked foot, no loading-pill copy, the hello row not yet shown), then the transition into phase 2,
and that a guest never enters phase 2 at all.

**The general lesson, worth more than the fix.** A redesign layer that improves a screen can still be
a deletion from the owner's side if it removes the moment he recognises the product by. Brand-recall
surfaces are not styling surfaces. When there is something new to show, prefer adding a *phase*
over overwriting the existing one.

## 2026-08-28 — Phase 2 is a stop, not a second loading screen: the Open Workspace button gates boot
Follow-up owner feedback on the two-phase boot splash: "WHY TWO LOADING SCREENS FOR WHO LOGGED IN."
He is right, and the diagnosis is sharper than the complaint. Phase 1 and phase 2 were both passive
waits, so the sequence read as the same dead time twice. A screen only earns its place if the user
does something on it.

**So phase 2's pill became the action.** The "Loading your workspace" pill is now a real
`<button id="sbsGo">Open Workspace</button>`, carrying the same tinted-glass primary treatment as
the landing CTA, and the splash **holds** on the welcome-back screen until the clinician taps. On
tap: reveal at once if boot has finished, otherwise the button flips to "Opening..." (reusing the
existing `sbsGlow`) and the reveal happens the moment boot is ready.

**Fail-open is the whole design, because this is a clinical app.** A clinician stuck behind a splash
is not a cosmetic bug. Four independent ways out:
- The hold arms only after the button is **in the DOM, measured at a real 44px+ tap target, and its
  listener attached**. Any throw or bad measurement and `.sbs-gate` never lands, so phase 2 keeps
  today's passive pill and auto-hides. This is why the pill/button swap is keyed on `.sbs-gate`
  rather than on phase 2 itself: the CSS cannot show a button the JS did not successfully wire.
- A **20s safety valve** opens it for them if they set the phone down.
- The hide loop **re-checks that deadline itself** (`gateHeld()` compares against `gate.armed`), so a
  dropped or throttled timer cannot strand anyone. Anything unexpected reads as "not held".
- `?splashv2=0` and guests never reach the arming code at all (the personalisation block already
  returned early), so both keep the exact pre-existing auto-hide.

**The gate deliberately suppresses `CAP` (15s) while held.** A visible button the user can press is a
better failure mode than a screen that vanishes under them, and the gate's own 20s deadline bounds
the wait regardless, so the true worst case is ~21s from boot rather than unbounded.

**No `app.js` change and no fork of the hide logic.** The splash's `MIN`/`CAP` loop was extended in
place with one `gateHeld()` check plus a `window.__smdBootGateOpened` hook for an immediate reveal on
tap; the gate object is published by the splash-v2 script that already owns personalisation. The
button is **static markup kept `hidden`**, the same pattern `.sbs-hello` uses, so the flag-off path
stays byte-exact.

`sw.js` CACHE `...-splashv2g` → `...-splashv2h`. Test: `test/run-splash-ui.mjs` asserts the button
renders as a `<button>` with the right label at a 44px+ target in both themes, that the splash holds
**under the exact `ready()` condition that would otherwise hide it** (the harness forces a visible
`#accountGate`, which is the proof: staying up merely for a while would prove nothing), that the tap
releases and reveals, that a mid-boot tap yields "Opening...", and that guests and `?splashv2=0` are
neither gated nor shown the button and still auto-hide.

---

## 2026-09-11 — RxChoice™: strength certainty, not strength assumption

RxChoice shows alternative PRODUCTS for a prescription the doctor has already written. Everything
about its design follows from one property of the Drug Database: **`composition` carries per-ingredient
strengths only sometimes.** `Amoxycillin (500mg) + Clavulanic Acid (125mg)` has 845 brands; the bare
`Amoxycillin + Clavulanic Acid` has 5795, with the strength in the brand name ("Augmentin 625 Tablet",
"Augmentin 1000 Duo Tablet"). A matcher that read `composition` alone would have offered 625 against
1000 as "the same therapy".

**Decision: eligibility is gated on strength CERTAINTY, via a provenance-tagged key.**
`comp:amoxycillin=500mg|clavulanic acid=125mg` (parsed from the composition) or `brand:625mg` (parsed
from the brand name, and only when the composition carries no strengths at all). Keys must be
identical, and a `comp:` key never matches a `brand:` key. **A product whose strength cannot be
established either way is not shown** — "when uncertain, no substitution" is a code path, not a
promise. Same for form family, release tokens (IR ≠ XR), and an unreadable price or pack.

**The single product truth is `window.MEDAPI`.** No RxChoice brand list, no second dataset, no
AI-generated product. `offline-db.js` already routes those calls to the on-device SQLite copy with an
identical record shape, so online and offline results agree for free. Manufacturer tiers MIRROR
`worker/src/index.js` and `offline-db.js` rather than introducing a third opinion on "established
manufacturer"; the three must be kept in step.

**Course cost is unit-dispensing for countable oral solids, whole-pack for everything else.** The
written spec contradicts itself here: it gives both `ceil(qty/pack) × packPrice` (₹150) and ₹75 for
the same worked example (a 20-tablet pack at ₹150, a 10-tablet course). The unit reading is the one
that matches both its own headline figure and an Indian pharmacy counter, where a strip is cut — and
it is what makes a bigger pack able to be the cheaper course, which is the feature's whole point. A
vial, bottle, tube or inhaler cannot be cut, so those cost whole packs and the leftover is real waste.
Both numbers are always returned (`courseCost`, `wholePackCost`, `dispensing`) so no caller has to
guess which model produced a figure.

**BALANCED is allowed to coincide with GENERIC or PREMIUM.** When the cheapest product is also the
best value, the honest output is to say so (`balanced.sameAs` → "also the lowest cost" on the card).
Forcing a different product into the Recommended Value slot would mean recommending one the score
ranked lower, purely so four cards look different.

**AI is not in the decision path.** `smd_rxchoice_ai_normalization` ships **def:false**, and even on it
may only normalize free text *before* the deterministic lookup. Eligibility, matching, pricing and
ranking are deterministic whatever that flag says, so an AI answer can never promote a product.

Also fixed here, found during the audit: `scripts/build-www.sh` never copied root `*.mjs`, so
`prescription.js`'s `import("/rx-build.mjs")` was unresolvable inside the native bundle. RxChoice's own
core is deliberately plain `.js` (dual-export, like `rx-brand-match.js`) so it needs no ESM plumbing,
loads offline and is directly `require()`-able from node tests.

Tests: `test/rxchoice-core.test.mjs` (15) + `test/run-rxchoice-ui.mjs` (30 browser checks, including
flag-off restoring the pad byte-for-byte behaviourally). See [[RxChoice]].
## 2026-08-29 — App Lock: PIN / Face ID·Touch ID / no-lock, chosen once at first login
Owner ask, after seeing the "Open Workspace" welcome-back splash (build 3464): add a real lock in
front of it. Three options, offered once right after the first-run profile step (email-auth.js's
`openProfile({firstRun:true})`, the single choke point every sign-in method — Google/Apple/email —
already funnels through):
1. **PIN** — 4-6 digits, salted SHA-256 (Web Crypto), stored in the OS Keychain/Keystore via
   `capacitor-secure-storage-plugin` (the same `window.SMD_SECURE` shim autofetch.js defines).
   Available on every device regardless of biometric hardware.
2. **Face ID / Touch ID** — feature-detected via `Capacitor.isPluginAvailable()`. No biometric
   plugin is installed in this repo today, so the option correctly never renders on any current
   build. Wiring a `NativeBiometric`-shaped plugin (`p.verifyIdentity`/`p.authenticate`) + `cap
   sync` + a native rebuild lights it up with **zero** changes to `applock.js` — the call shape is
   already written and named-lookup-guarded (`NativeBiometric` or `BiometricAuth`).
3. **No lock (auto sign-in)** — own-risk, gated to **personal accounts only**. There is no existing
   "institution account" field, so this reuses the profile's `hospital` freetext (already collected
   at the same first-run step): non-empty hospital → the option is not rendered at all, not merely
   discouraged. A risk checkbox gates the Confirm button even for personal accounts.

**Enforcement point**: `index.html`'s boot-splash `finish()` — the single function that already
hides/removes `#smdBootSplash` (see the 2026-08-28 Phase-2 entry above) — gained ONE check:
if `SMD_APPLOCK.required()`, hold behind an unlock overlay and only call the real hide once it
calls back. No fork of the hide/tick loop, matching how Phase 2's own gate was added.

**Fail-open, deliberately, because this file's own rule already exists**: every unlock screen
carries a "Sign out instead" escape (routes to the existing `#sessionSignOut` click, the same
button the header already wires); `window.SMD_APPLOCK` undefined/throwing anywhere is read as "not
required" — a clinician locked out by a bug in THIS code is worse than the lock not firing once.

**Known gap, accepted rather than engineered around**: `applock.js` loads as a deferred script
after `app.js` in the script order, while the boot-splash gate script is inline and starts polling
immediately. On an extremely slow first cold load (no service-worker cache yet) it's theoretically
possible for `finish()` to fire once before `SMD_APPLOCK` has registered, skipping the gate for
that one boot. Not restructured, because moving `applock.js` earlier only matters for a narrow,
self-healing window (the very next boot has it cached) and this codebase's own MIN/CAP splash logic
already accepts equivalent races elsewhere.

**Flag**: `smd_applock`, default **OFF** — this is a big, security-adjacent, boot-blocking change
per this repo's own flag convention, and has NOT had a device pass yet (Chrome-headless UI test
only: `test/run-applock-ui.mjs`, 25/25 green, plus the full existing `test/run-splash-ui.mjs` still
25/25 green with the `finish()` change in place). `?applock=1` / `localStorage.smd_applock="1"`
forces it on for testing; `?applock=0` forces off. Needs an owner device pass + R3 security review
before flipping the default, per CLAUDE.md's "reversible changes" rule for anything auth-shaped.
sw.js CACHE bumped `-applock1`.

## 2026-08-29 — App Lock biometric: wired to a real plugin, not just feature-detected
Follow-up to the App Lock entry above: owner asked for iPhone Face ID/Touch ID and Android
biometrics to actually work, not just be structurally ready for a plugin. Added
`@aparajita/capacitor-biometric-auth@10.0.0` (verified against the npm registry + its
TypeScript definitions before writing any call — declares `@capacitor/*: ^8.x`, matching this
repo's Capacitor 8.4.1; 214k weekly downloads, updated 2026-02, actively maintained — over the
older, Capacitor-3-targeted `capacitor-native-biometric`).

- `npm install` + `npm run build:www` + `npx cap sync` run in this session: 28 iOS / 21 Android
  plugins now include it, WatchBridge still present (no repeat of the incomplete-node_modules
  drop — node_modules was already complete before this install).
- `ios/App/App/Info.plist` gained `NSFaceIDUsageDescription` — mandatory or iOS silently refuses
  Face ID. No Android manifest change needed (AndroidX BiometricPrompt handles its own
  permission).
- **Corrected two wrong assumptions from the first pass**: the plugin's registered name is
  `BiometricAuthNative` (not `NativeBiometric`/`BiometricAuth` — those were guesses; the export
  named `BiometricAuth` in the plugin's own JS is just a local alias for that proxy, and
  `Capacitor.Plugins` is keyed on the string passed to `registerPlugin()`). And device capability
  is NOT `Capacitor.isPluginAvailable()` (that only proves the plugin is compiled into the
  build) — it's the async `checkBiometry().isAvailable` (whether the device actually has
  biometry enrolled), so `canBiometric()` became async and `renderChooser()` now awaits it
  before deciding whether to show the Face ID/Touch ID row.
- `authenticate()` resolves (void) on success and REJECTS with a `BiometryError` on failure/
  cancel — never returns a boolean — so `verifyBiometric()` reads success from settle, not from
  the resolved value; this matches the resolve→true/catch→false wrapper already written, so no
  caller (`renderBiometricSetup`/`renderBiometricUnlock`) needed to change.
- Not yet run on a physical device — this session has no iPhone/Android attached. Web-side logic
  is fully verified (`test/run-applock-ui.mjs`, 25/25 green, unaffected since Chrome-headless
  has no `window.Capacitor` bridge — biometric correctly reports unavailable there, same as
  before); `test/run-splash-ui.mjs` still 25/25. The remaining step is the owner's own
  build→install→test pass per this file's native-build gotchas (Xcode SPM scheme, `devicectl`
  reinstall wipes app data, `ios_webkit_debug_proxy` for on-device debugging).

## 2026-08-30 — App Lock biometric: call the NATIVE method name (internalAuthenticate)
Correction to the entry above. On the iPhone 15 Pro, Face ID setup failed instantly with no
Face ID sheet, no "StewardMD would like to use Face ID" permission dialog, and no Dynamic Island
animation. Root cause was not the device or memory: `verifyBiometric()` called
`Capacitor.Plugins.BiometricAuthNative.authenticate()`, but the Swift plugin's `pluginMethods`
are exactly `checkBiometry` and `internalAuthenticate`. The public `authenticate()` exists only
in the plugin's ESM JS layer (`dist/esm/base.js`), which a buildless ES5 app never loads.
- Capacitor's native proxy returns a wrapper function for EVERY property, so `!p.authenticate`
  guards can never detect a wrong name; the call rejects `UNIMPLEMENTED` before `LAContext` is
  touched. `checkBiometry()` is a real native method, which is why the option still rendered.
- Rule for this repo: when using a Capacitor plugin through `window.Capacitor.Plugins` (no
  bundler), the callable names are the plugin's native `pluginMethods` / `@PluginMethod`s, not
  its TypeScript public API. Read the Swift/Java, not `definitions.d.ts`.
- Failure text now maps the LAError code (`userCancel`, `authenticationFailed`,
  `biometryLockout`, `biometryNotEnrolled`, ...). `test/run-applock-ui.mjs` section 9 installs a
  Capacitor-shaped fake proxy where only native names succeed (41/41).

## 2026-08-30 — App Lock: closable Manage, lock at load, optional 2h grace (personal only)
Owner feedback after the Face ID fix: Manage had no way out and forced a re-pick; boot unlock
felt slow; wanted auto Face ID on launch or "don't ask if opened within 2 hours".
- **Manage is closable, first-run is not.** `manage()` sets `_fromManage`; the chooser then
  shows "Keep current setting" (or "Not now" when nothing is set) and marks the current method.
  `promptSetup()` (first-run) keeps the forced choice from the original 3-option spec.
- **Lock is shown the moment `applock.js` loads**, over the boot splash, not at the splash's
  `finish()`. Face ID fires on launch; the PIN pad is up while the app still loads. `unlock()` is
  idempotent with a `done` queue, so `finish()`'s `unlock(reallyFinish)` joins the screen already
  on show. Completing setup counts as that boot's unlock (`markUnlocked()`), no second prompt.
- **2h grace** (`smd_applock_grace`="2h", `smd_applock_lastunlock` ms): skip the prompt when the
  app is reopened within 2h of the last open (sliding: a grace-skipped open refreshes the stamp).
  Classified with "no lock" as own-risk: opt-in, off by default, **hidden for institutional
  profiles** (same PHI rule), cleared by sign-out. Not a security boundary; the PIN hash /
  LAContext still is.
- `test/run-applock-ui.mjs` 54/54; `test/run-splash-ui.mjs` now clears its own origin at start
  (the persisted Chrome profile used to fake a signed-in first run and fail 2 asserts on every
  second run).
- **Addendum (same day): biometric unlock shows no card.** Owner: "never app should show face id
  option on click of app". Boot is splash -> system Face ID / Touch ID sheet fires by itself at
  the splash's `finish()` -> app. `renderBiometricUnlock()` renders nothing; `renderBiometricRetry()`
  (Try <Face ID|Touch ID> again / Sign out) appears only after a failed or cancelled scan. The
  PIN pad still pre-shows at load. So the "lock at load" point above now applies to PIN only.

## 2026-08-30 — Boot splash: one frame, constant 3s, then Face ID / PIN by itself (gate REMOVED)
Reverses the "Open Workspace gate" and the phase-1 -> phase-2 crossfade decisions. Owner sent a
screen recording: bare grey WebView, then a loading bar alone, then the foot, then the logo, then
the logo faded out for a welcome card with a button. "Unprofessional. Constant 3 sec splash,
all appear at once, then automatic Face ID / PIN, fast, into app."
- **Grey frame root cause:** `capacitor.config.json` `SplashScreen.launchShowDuration: 0` +
  `launchAutoHide: true` dropped the native splash at launch, exposing the unpainted WKWebView
  (system-dark) even though `native-bridge.js` hides it on `load`. Now `launchShowDuration: 3000`
  (auto-hide kept only as the cap); the native splash (white + mark) covers until paint.
- **Web splash:** no entrance animation on any element (sbsPop/sbsFade removed); the signed-in
  avatar + name row sits in the SAME frame as mark, wordmark, tagline, bar, foot; `MIN` 900 ->
  3000; no phase 2, no `.sbs-go` button, no `__smdBootGate`. App Lock's early PIN pad is gone
  too: `finish()` -> `unlock()` after the 3s frame, for both Face ID (no card) and PIN.
- Dead `.smd-boot-phase2` selectors remain inside the shared LIQUID GLASS lists; harmless.
- `test/run-splash-ui.mjs` section 2 rewritten (static-at-first-paint, hold at 1.6s/2.5s with
  ready forced at 0.6s, self-hide by 3.6s, no button) 91/91; `run-applock-ui` 59/59.

## 2026-08-30 — App Lock: forced for every signed-in user (not flag-gated, every provider)
Owner: "no one is forcing me to set up id/pin once signed up/in i want you to force users."
`promptSetup()` was gated on the `smd_applock` rollout flag (unreachable in the native app) and
fired only from the email first-run profile step, so Google/Apple sign-ins and existing accounts
were never asked. Now `applock.js` subscribes to `SMD_ACCOUNT.onChange` (runs at boot and on
every sign-in): signed-in, non-guest, no method configured -> the first-run chooser (no close)
as soon as nothing else owns the screen. "Busy" = `SMD_EMAIL_AUTH.gateUp()` (account / intro /
verify gates, splashes), `SMD_EMAIL_AUTH.flowOpen()` (its own sheet, which hands over via
`promptSetup()` itself), or `#smdBootSplash`. Polls 500ms up to 2 min per event. Hospital for
the institutional rule comes from `SMD_EMAIL_AUTH.loadProfile(uid)` (Firestore profile doc;
"" when unavailable, i.e. treated as personal, and Manage re-evaluates with the real value).
`smd_applock` now gates nothing that matters; the Security row shows for everyone.
- **Addendum (same day): screen 2 is back.** Owner: "why did you remove second screen after
  splash? bring it back i want both". Screen 1 (classic, static) -> 1.5s beat -> crossfade ->
  screen 2 (avatar, name, glass foot, passive pill). Still no Open Workspace button/hold; the
  constant 3s + automatic Face ID / PIN stands. So only the GATE stays removed, not phase 2.
- **Addendum (same day): the "second screen" was the merged frame, held for 3s of REAL visibility.**
  Owner's screenshot circled the welcome row + bar on the single merged frame: "i want user to
  see this screen for at least 3 secs". The two-screen crossfade restore (87fc0f7c) is reverted.
  The real defect: MIN counted from script start while the native splash still covered the
  WebView. `native-bridge.js` now stamps `window.__smdSplashShownAt` when it lifts the native
  splash and the boot script measures MIN from that stamp (script start on the web).
- **Addendum (same day, final): BOTH screens, screen 2 seen for 3s.** "still same single splash
  screen" after the revert: the ask was the two-screen sequence with the welcome screen on for at
  least 3s. Screen 1 (classic, static) 1.2s -> 220ms crossfade -> screen 2 (avatar, name, glass
  foot, passive pill) 3s. Beat AND hold count from `__smdSplashShownAt`; `MIN` = 4500 for
  `.sbs-personal` boots, 3000 for guests (screen 1 only). Gate/button still gone.

## 2026-08-28 — Ask MaiK inside the insulin calculator: MaiK fills the form, it does not answer the dose

**Decision (owner, "B").** A doctor describes the situation in free text ("patient on 16 units
regular, sugar 320 now, how much?") and MaiK responds by **pre-filling the calculator** — mode plus
every input — for the doctor to check and press Calculate. It does NOT print a dose inline.

**Why the LLM never produces the number.** insulin.js already separates the maths (`INSULIN_ENGINE`:
`correctionDose`, `mealBolus`, `firstDoseCorrection`, `combinedDose`, `basalInitiation`, `isfFromTdd`,
`icrFromTdd`, `activeInsulin`, `pediatricInit`, `dkaInsulin`) from the presentation, and
`INSULIN_SAFETY.evaluate(ctx, input, res)` from both. So the agent's whole job is EXTRACTION: choose
the engine function and fill its arguments. The dose then comes from the same validated code path the
calculator has always used, and every existing safety warning and `interrupt` still fires. An LLM that
emitted units directly would bypass all of it.

**Why pre-fill rather than an inline answer.** Both were considered. Inline is one tap faster, but the
failure mode is "the AI said 6 units" — a number a busy doctor may accept without auditing inputs the
AI inferred. Pre-fill makes the failure mode "the AI filled these five fields, check them", on the
screen the clinician already reads, with the existing confirm/acknowledge flow intact. For insulin
that trade is worth the tap. An inline answer can be layered on later once extraction is shown to be
reliable in practice.

**Rules the implementation must keep.**
- Missing required input (no ISF, no weight, no time since last dose) -> ASK, never assume a default.
  Silent defaulting is where the real danger is, not the arithmetic.
- Show the extracted inputs as an editable summary with a one-line rationale, before any result.
- A safety `interrupt` blocks the answer exactly as it does in the manual flow.
- Never auto-confirm or auto-log a dose on the doctor's behalf.

**Implemented 2026-08-29** behind `smd_insulin_ask` (DEFAULT OFF). `insulin-extract.js`
(`window.INSULIN_EXTRACT`) is the validated seam: free text → `{mode, corrSource, set[], missing[],
questions[], rationale}`, whitelisted to known modes/field keys with plausibility ranges, mirroring
`maik-reasoning.js`. Server kind `insulin-extract` (`functions/api/ai/_insulin-extract.js`).

Two implementation facts worth keeping:
- **The result had to be HELD.** The calculator recomputes live on every keystroke, so a plain
  pre-fill paints a dose in the same instant MaiK fills the fields — the exact inline-answer failure
  rejected above. `st.askPending` makes `render()` paint the review card *instead of computing*;
  Calculate releases it. This is the load-bearing line, and `test/run-insulin-ask-ui.mjs` pins it.
- **The engine cannot enforce the no-defaulting rule, so the UI does.** `st` holds a value for
  everything (glucose 180, isf 50, iob 2, weight 70), and `correctionDose()` treats a missing IOB as 0
  and still returns a number. Every REQUIRED field MaiK did not read is therefore *blanked* and
  Calculate stays disabled until a human types it.

Extraction runs on the CLOUD model (`SMD_AI.maik`), matching MaiK Ask/Scribe/SURGX posture. On-device
was considered — it keeps the scenario off the network — but `SMD_MAIK_LOCAL.answer()` takes a KB
package rather than a prompt, is PRO-gated and needs a downloaded pack, so it cannot be relied on for
strict JSON. `INSULIN_EXTRACT.setProvider()` is the one-line swap if the owner wants it later.
**Owner: confirm cloud-vs-on-device.**

## 2026-08-31 — MaiK Lite is now OUR trained model, and the flagship on-device tier

The `maik-lite` pack no longer points at the upstream qvac/MedPsy-1.7B base on HuggingFace. It now
ships StewardMD's own LoRA fine-tune (v2), trained on the StewardMD Knowledge Base, hosted on our
R2 (`models.stewardmd.in/maik/maik-lite-q4_k_m.gguf`) because the weights are private. It is the
DEFAULT_PACK, carries a STEWARDMD picker badge, and has its OWN system prompt in the registry
(`pk.system`, consumed by maik-local.js) - the shared SYSTEM's example dose ("2 g IV over 20 min")
was parroted by the 1.7B as a real furosemide dose, so its prompt carries no example dose.

Presentation rule (owner): on-device answers never show page numbers or upstream source names; the
only attribution anywhere is "StewardMD Knowledge Base - based on standard medical resources".
stripReasoning() now also drops trained-in [n] citation markers.

Two training passes: v1 (reasoning-style SFT, loss 0.62) answered well but inherited the base's
thinking habit when served over plain ChatML (the native path) - it burned the whole nPredict on an
unterminated <think> and the doctor got a blank. v2 (continued SFT, 1 epoch, lr 1e-5) moved the
empty think block INTO the loss target and added the system turn to 60% of examples. Probes over
the native-style path after v2: most questions answer immediately (empty think block); some still
reason first, hence nPredict 768 and an explicit "did not produce an answer" error instead of an
empty bubble when reasoning eats the budget. Server-path eval held: structured 52%, unsupported
1.2%, cited 100% on the 100-question set.

Known gaps for a v3 pass (do not re-discover): the think habit is reduced, not eliminated - the
robust fix is a <think>-token ban at the native sampler (both platforms) or more discipline data;
scope-refusal is enforced by the Intent Firewall (maik-scope.js) upstream, NOT by the model, which
answered a football question in bare-model probes.

## 2026-09-19 — One email template (premium, single column), unsubscribe everywhere it must be, promo series OFF, phone verified over WhatsApp

**Email.** `functions/_email.js` is now a component kit (`headline`, `hero`, `tile`, `ctaRow`,
`codeBox`, `facts`, `note`) plus one `renderEmail()` shell: soft grey page, white 600px column, the
SD mark alone at the top, one big headline, one line, one pill button, tiles that make one point each,
quiet footer. Every existing template (OTP, reset, temp password, verified, reminder, Pro, failed,
welcome, upsell) was rewritten on it; no em-dash anywhere (pinned by test). `sendBranded(env, opts)`
takes `kind:"marketing"` + `uid`: it then signs an unsubscribe token (`_unsub.js`, HMAC under
`UNSUB_SECRET` falling back to `RESEND_API_KEY`), adds the footer Unsubscribe button + link and the
RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post: One-Click` headers. `/api/unsubscribe` (GET link,
POST one-click, `resub=1` to undo) flips `unsubscribedAt` on the lifecycle record ONLY. Account notices
(codes, verification, the day-5 removal warning) are transactional and deliberately never suppressed:
nobody may lose an account because they unsubscribed from offers. Welcome + Pro upsell are marketing
(unsubscribable); `sendProUpsellOnce` honours the opt-out without stamping `upsellAt`.

**Prices in copy come from `_pricing.js`**, which reads the same `cfgPrice` the paywall reads (KV
override > env > default) and rounds per-day figures UP, so a price change can never make an email
understate the cost. Today: Pro 599/mo = 20/day, annual 4999 = 14/day, trainee 199 = 7/day.

**Promo series** (`_promo.js`): seven editions, 2-3 features each, one hero figure, per-day price
against a chai / bottle of water / pastry. `PROMO_SERIES_ON` is OFF: the nightly `/api/lifecycle/run`
reports candidates but sends nothing until the owner turns it on. Starts day 5 (after the day-3
upsell), one edition every 4 days, never to opt-outs or paying accounts. Owner preview:
`GET /api/email-preview?kind=promo:maik` (owner auth), `POST` sends a real copy.

**Phone verification** (owner: "ask every signup phone number verified by WhatsApp with backup
SMS"). Server `_phone_otp.js` + `/api/auth/phone-start|phone-verify`, keyed `otp:phone:<uid>`, same
rules as the email OTP (10-min TTL, 30 s throttle, 5 tries then the code burns) plus a per-number
daily cap of 6 so our account cannot be used to SMS-bomb a number. Delivery reuses the FollowCare
senders: WhatsApp first when a provider is configured, else SMS; 2Factor goes through its dedicated
OTP API (pre-approved DLT OTP template), other providers through `sendSms`. A same-window resend
by SMS carries the SAME code. Success sets the `phoneVerified` claim and stamps the lifecycle record.
Client `phone-verify.js` asks after `profile-setup.js` saves (listens for `smd:profile-saved`), never
stacks on the registration gate (`#verifyGate`, polls until hidden), "Later" snoozes per app-open.
Nothing is gated on it yet; it is an ask, not a wall. Kill switches: `smd_phone_verify=0` (client),
`PHONE_VERIFY_ON=0` (server).

**Not done, deliberately:** an in-app "marketing emails" toggle (the email button + header suffice for
now); `mark-teal.png` is in the repo but 404s on the live site, so the template uses `logo.png`.

Tests: `test/email-template.test.mjs` (16), `test/phone-otp.test.mjs` (17),
`test/run-phone-verify-ui.mjs` (35 in a real browser), `test/render-emails.mjs` renders every email
to PNG for a human look. Guide: the Clinical UX Guide canvas (10 boards) was produced the same day.


## 2026-09-02 — MaiK Lite v3/v4: found and fixed WHY the think habit persisted, caution policy removed

v3 (bare-question data, no abstain examples, caution policy removed per owner order) trained
cleanly but its own in-VM probes came back 0/8 passing - still opening `<think>` and never
closing it, exactly like v1/v2 on the phone path. Root cause, found by inspecting the actual
training prompt: `tokenizer.apply_chat_template()` silently prepends the BASE MODEL VENDOR'S
default system line ("You are MedPsy, a medical and healthcare AI assistant developed by QVAC")
ahead of whatever system text we pass it. So v1/v2/v3 were all trained with an extra hidden
system turn the phone never sends - the empty-think suppression was conditioned on a prompt
that does not exist at serve time. Confirmed by decoding the actual tokenized prompt, not by
reading the template source.

v4 (`train_vm3.py`) fixes this the only reliable way: it does not call `apply_chat_template` at
all. It hand-builds the exact ChatML string llama.cpp's `llama_chat_apply_template` produces
(`<|im_start|>system\n...<|im_end|>\n<|im_start|>user\n...`) so train and serve are byte-identical.
Data recipe otherwise unchanged from v3: bare questions (no book-evidence wrapper - the phone
never sends one), abstain/clarify examples fully removed (owner: "REMOVE CAUTION POLICY"), dose/
numeric/criteria/contra examples kept for dosing quality.

Result, in-VM probes over the exact phone path (llama-cli --chat-template chatml, no evidence,
app system prompt), 8 owner-supplied questions including the two that had failed live
("Treatment of Pneumonia", "Fever Treatment") plus 4 dose questions: **8/8 clean - zero
unterminated thinking, zero blank answers.** Shipped as the maik-lite pack's weights (sha256
3d779b25..., same R2 object key as v2/v3, no other code change needed).

Not fixed by v4, still true: a 1.7B WILL make occasional dose errors (verified: one probe named
azithromycin BID instead of the correct QD/weekly regimen for CAP - a plausible-sounding but wrong
figure). No training pass removes this ceiling; the durable fix is routing dose-specific questions
to the deterministic drug engine instead of the fine-tuned model. Scope-refusal (non-medical
questions) is still enforced upstream by the Intent Firewall (`maik-scope.js`), not by the model.

## 2026-09-03 — MaiK Lite v4 never reached phones: same-size retrain defeated the install check

Live symptom: v4 was merged (#814), weights verified live on R2, but the owner's phone kept
returning the exact v2 failure mode ("did not produce an answer"). Root cause: `installed()`/
`installedCached()` in maik-models.js only ever compared on-disk byte count + GGUF magic against
the registry - never content. A LoRA-merge retrain (v2 -> v3 -> v4) never changes file size, so a
phone that had already downloaded v2 saw "right size, right magic, marker already set" and never
re-fetched, forever - no matter how many times the registry's sha256 or code shipped a new PR.

Fix: a new localStorage marker per pack (`smd_maik_packsha_<id>`) records the registry sha256 that
was actually verified at download time. `installed()`/`installedCached()` now treat a pack as
stale (not installed) the moment the registry's sha256 for that pack differs from the stamped
value, even though size+magic still pass. Both download entry points (`nativeDownload`'s
modelPath "already" shortcut, and `oneFile()`'s Range-resume shortcut) were ALSO patched - each
had its own identical same-size short-circuit that would otherwise still skip the redownload even
after installedCached() correctly started reporting "not installed". Deliberately still no full
sha256 rehash on-device (would mean reading the whole multi-GB file back through the bridge); this
is a cheap string compare against a value already known from download time.

Consequence chain that WAS working correctly and needed no fix: `maik-engine.js`'s
`packInstalled()` -> `localReady()` -> `effective()` already refuses to route to a local engine
that `installedCached()` says isn't ready, falling back to KB-only - so once this fix ships, a
stale phone will show "Tap to download" and auto-fallback to KB-only rather than silently running
old weights, with no further app-side changes needed.

Regression tests added in test/maik-models.test.mjs for both download paths: a same-size file with
a stale registry sha256 must be deleted and genuinely re-fetched, not reported as already-installed.

## 2026-09-03 — MaiK Lite on-device RAG: BM25 book search wired to the trained model, and the fresh-install crash

Owner's ask: doctors expect to-the-point answers with drug, dose and duration as per the textbook,
so bring the BM25 + evidence-gate pipeline built for training (`~/MedPsy/run/book_search.py`,
`pipeline.py`, `validator.py`) into the app and connect it to MaiK Lite on the phone. Shipped in
PR #819: `kb/ai/maik-lite-rag.js` (BM25 port, verified byte-identical scores against the Python on
the real 42,176-chunk book), `kb/ai/maik-lite-kb-store.js` (chunked download of the 38 MB JSONL
asset from R2, cached in Documents), and wiring in `maik-local.js`: top-3 passages prefixed to the
prompt, the model's answer run through the same evidence gate (any drug or figure not present in
the retrieved passages fails), and on failure the passage itself is shown instead of the answer.
The gate is never weakened to raise the answer rate. Only the `maik-lite` pack is RAG-eligible.

Citation policy (owner, verbatim intent): NEVER a page number, on device or anywhere. Every
grounded answer ends with "Source: StewardMD Knowledge Base - based on standard medical
resources." and nothing else. A unit test pins that the source line can never carry a page number.
Book text never leaves the device.

Crashes found live on the owner's iPhone 15 Pro and fixed, in order:
1. `String.fromCharCode.apply` on a 2 MiB download chunk blew the call stack. Sub-chunk at 0x8000.
2. `Filesystem.readFile` without `encoding: "utf8"` returned base64, so the index built with zero
   rows while reporting installed. Encoding now explicit, with a full-size synthetic regression test.
3. Jetsam kill after a handful of questions: the built Book (42,176 per-chunk term Maps) was cached
   for the app's life. First attempt: rebuild it per question and release. WRONG, see 5.
4. Jetsam kill on a FRESH install (the path every earlier test had skipped because the KB was already
   on disk): the post-download whole-file SHA-256 read 38 MB back through the bridge as base64 and
   looped 38 million charCodeAt calls on the main thread. Removed. Integrity is now the exact byte
   count plus an exact 42,176-row parse in loadBook(); a short file is deleted and re-downloaded.
   The registry sha256 stays as the same-size staleness marker only, as in maik-models.js.
5. Still crashing for the owner after 3 and 4. The pulled JetsamEvent report was decisive: it was
   NOT the App process (0.6 GB, fine, it holds the model natively) but com.apple.WebKit.WebContent,
   the WebView's content process, at 2.16 GB, reason "per-process-limit". Every earlier memory
   probe had read the App process's headroom via the Llama plugin and so could never see this.
   The 42,176 Maps were ~640 MB, and rebuilding per question left the previous build's garbage
   overlapping the new one. Fix: a flat inverted index (one term->id Map, typed arrays for
   per-term offset/idf and one global posting array), built once per session and cached: 121 MB,
   2.9 s build, 18 ms search on the full book, scores bit-identical to the old code (checked on all
   42,176 chunks, 17 queries). A per-term-object layout was tried first and measured at 955 MB,
   WORSE than the Maps, because the book has 1.6 million distinct terms (bigrams): never allocate
   per term. Lesson for any future WebView memory question: pull the JetsamEvent with
   `idevicecrashreport -n -u <network udid> -e -k <dir>` and read which process died; the App
   process and the WebContent process have separate limits.

Verified live after fix 5, installed over the existing container: 5 paced questions plus one more,
all grounded, none rejected by the gate, no page number, App PID unchanged throughout, no new
jetsam report. First question including the index build 13 to 14 s, later ones 9 to 27 s
depending on answer length. Native builds for this work must come from the live checkout, not
a worktree: the CapApp-SPM Package.swift relative paths resolve to the original checkout's
`local-plugins` when synced from a worktree, so a worktree build silently compiles the OLD Swift.
Also: `devicectl device info processes` pads lines with trailing spaces, so a `$`-anchored grep on
the app path silently matches nothing and looks like "the app is gone" when it is not.

## 2026-09-03 — Bonsai packs (PrismML 1-bit / ternary) in the picker; ternary 8B as the offline stand-in for MaiK Cloud

Owner decision: add Ternary Bonsai 8B as an offline model and use it in place of Vertex/Gemini for
offline users wherever possible; list all three Bonsai models (1-bit 8B, ternary 8B, 1-bit 27B) in
the MaiK Assistant picker. Chosen over the 27B on the numbers: PrismML's own suite has ternary 8B at
85.0% vs 1-bit 27B at 82.9% and 1-bit 8B at 78.9%, and the 27B at 5.2 GB RAM (4K context) would be
the first thing iOS evicts on an 8 GB phone every time the app is backgrounded.

No native change was needed, and this was verified rather than assumed. The plugin links the
mainline llama.cpp b10502 xcframework; that tag's ggml.h already carries GGML_TYPE_Q1_0 (41) and
GGML_TYPE_Q2_0 (42) with Metal kernels, because PrismML's formats were merged upstream after their
March release. Group sizes differ from PrismML's fork defaults: mainline Q2_0 is a 64-weight group,
so the ternary pack points at `Ternary-Bonsai-8B-Q2_0_g64.gguf` (2,310,125,920 bytes), NOT the
default g128 file the model card recommends (that one needs their fork). Q1_0 is g128 in both, so
the 1-bit files are used as published. The 27B's GGUF declares arch `qwen35` (Qwen3.6 backbone),
present in b10502. Licence Apache-2.0 on all three, so direct HuggingFace URLs like the MedGemma
packs. Sizes and sha256 are the HF API's exact size and lfs.oid.

Live on the owner's iPhone 15 Pro: the g64 ternary file downloaded (2.31 GB), loaded and answered on
the unchanged build. Cold first answer 79 s including the load; warm answers 47 to 57 s, about four
times slower than MaiK Lite 1.7B on the same phone, with the retrieved passages in the prompt. Four
questions: two passed the evidence gate, two were rejected and showed the reference passage. So it
WORKS as an offline stand-in and is honest, but it is slow on an 8 GB phone; the flagship badge is a
statement of quality per gigabyte, not speed. The 1-bit 8B and the 27B are in the registry and
unverified on device (same formats, same runtime path).

Routing: `maik-engine.js` `effective()` now sends a `cloud`-preference user to the installed local
pack when `navigator.onLine` is false and `localReady()`. The preference is untouched, so cloud
resumes with the network. Flag `smd_maik_offline_local` ("0" disables). Flagship flag moved from
Apex to `bonsai-ternary-8b`.

REVERSED THE SAME DAY (owner): the first cut grounded the Bonsai packs in the book (`rag: true`,
half their answers were then rejected by the gate, see above). The owner's call is that the Bonsai
models act individually on their own weights and knowledge, ungrounded, unlike MaiK Lite. The
`rag` flag is gone; `ragEligible()` is back to `maik-lite` only. Consequence to keep in mind: a
Bonsai answer carries no evidence gate and no source line, exactly like the MedGemma packs.

## 2026-09-04 — On-device MaiK: where it is reached from, idle unload, and the "not in the reference material" miss

**Coverage audit** (owner asked whether the on-device engine works from CliniX Ask MaiK, OPD Queue
Ask MaiK and Let MaiK Ask). `maik-engine.js` decorates exactly four `SMD_AI` calls: explain,
explainGrounded, explainGroundedStream, refine. Everything that goes through those reaches the
on-device model when it is selected (or offline with the stand-in): the MaiK sheet (home.js), the
reasoning module, ICU explain/explainGrounded, the med list explain, insulin refine, the SurgX
"Ask MaiK" button (opens the sheet via `SMD_askMaik`), and the CliniX tutor (`clinix-tutor.js`
streams through explainGroundedStream). NOT covered, cloud only, fail honestly offline: the CliniX
viva judge (`SMD_AI.vivaJudge`, a dedicated server model), the OPD EMR "Ask MaiK Pro" differential
(`SMD_AI.extract` "opd-suggest"), Let MaiK Ask's finding extraction (`SMD_AI.extract`), translate,
research, vision/OCR, transcription, ICU correlate/evidence/imagingSummary.

SAME DAY, owner: "cant we make them use on device model lite or bonsai". Yes for the two that are
plain structured calls. `maik-local.js` gains `vivaJudge()` and `opdSuggest()`: the server's own
prompts and output whitelisting (viva-judge in [[path]].js, _opd-suggest.js) ported verbatim, run
with the task prompt as the SYSTEM prompt so the interpretive MaiK prompt cannot turn JSON into
prose, temperature 0, tolerant JSON extraction, honest `{error:"parse"}` on garbage rather than an
invented verdict. `maik-engine.js` now decorates `vivaJudge` and `extract`; they go local only when
the effective engine is local, and only extract kind `opd-suggest` (voice, translate and MaiK Ask
extraction keep today's cloud behaviour regardless of engine; KB-only mode has no model and also
stays cloud there). Tracked by the idle unload like any other call.

Measured live on the owner's iPhone 15 Pro (assessment: fever, flank pain, dysuria; viva:
anaphylaxis first step):

| call | MaiK Lite 1.7B | Ternary Bonsai 8B |
|---|---|---|
| OPD differential | 11 to 24 s, thin (1 ddx, 1 investigation, 1 treatment, 1 red flag) | 151 s incl. load, rich (6 ddx, ceftriaxone dosing, 3 red flags) |
| viva judge | 5 to 11 s, verdict right, feedback often empty | 20 s, verdict + proper examiner feedback |

Small-model realities handled in code: MaiK Lite (a prose fine-tune) answers the JSON prompt in
prose about half the time. generateJSON() nudges ("Start your reply with {"), retries ONCE with a
blunter instruction at temperature 0.3, and on a second miss returns {error:"parse", sample}. For
the viva only, a verdict the model states plainly in its opening sentence ("The student's answer is
incorrect because...") is accepted with that sentence as feedback, when exactly one verdict word
appears and "correct" is not negated; anything vaguer stays a parse error. Nothing is inferred.
The 151 s Bonsai OPD call is the honest cost of a 27B-class-quality differential on an 8 GB phone;
the OPD screen shows its busy state throughout and the local path has no 45 s race timeout (that
timeout wraps only the cloud fetch in reasoning.js).

## 2026-09-04 — Bonsai image models, and the on-device model as the offline alternative to AI Vision

Owner asked for "Bonsai Image model as extension to Bonsai, Swift, Max". Facts checked on the HF
API: PrismML publishes an image-reading projector (mmproj) for the 27B only (Q8_0 629 MB, BF16
931 MB); the 8B repos have none and sit on a text-only Qwen3-8B base, so MAiK Bonsai and Bonsai
Swift cannot read images. PrismML's separate "Bonsai Image" family (bonsai-image-binary/ternary-4B)
is a TEXT-TO-IMAGE diffusion model in MLX/gemlite/safetensors builds only: not a vision model, not
loadable by llama.cpp. Registered: `bonsai-27b.vision` = the Q8_0 projector (exact HF size and
lfs.oid). Unverified on a device (the 27B needs a 12 GB phone; mtmd + qwen35 not exercised).

"Let it be the offline alternative to Google AI Vision": image-engine.js already had the on-device
multimodal model as a third engine but only ever offered it in the chooser; its offline path and
every fallback dialog knew only OCR. Now `recommendFor()` recommends "local" when AI Vision cannot
run and a projector is installed; `routeAI()` goes straight to the on-device model when offline
(preference untouched, cloud again with the network); every fallback dialog offers "Use On-device
AI (offline)"; Settings lists On-device AI when a projector is installed; copy names it the
offline alternative and says it is slower and can be wrong. If the on-device read fails too, the
dialog drops to OCR/manual rather than looping to a cloud that is not there.

Picker intro closes with the owner's reassurance to users that our models are still being trained
and will keep improving, thanking them for trusting MaiKnowledge and StewardMD.

**Idle unload** (owner: "make sure model is stopped once we close the tab or its work is done").
`maik-local.js` wraps `answer` and `warm`: any pending release is cancelled while a call is in
flight; when the last one settles a release is scheduled, 3 min with the MaiK sheet open, 20 s
once it is closed. `home.js` `openAskAi()` calls `sheetOpened()` and warms the local pack there;
`close()` calls `sheetClosed()`. A running generation is never cut (close() deliberately lets it
finish and persist). The startup warm-up in `maik-engine.js install()` is gone: no resident 1 to
4 GB model for a session that never opens MaiK. Cost: the first question after a release reloads
the pack (seconds for MaiK Lite, longer for the Bonsai packs).

**"Not addressed in the provided reference material"** (owner screenshot: "Spleenomegaly with
Fever DD and RX" on MaiK Lite). Retrieval missed: the misspelling is in no chunk, "DD" matched the
book's dd-cfDNA passage and "RX" expanded to treatment, junk cleared the score floor, and the model
obediently reported no coverage. Two fixes, both deviations from the Python port and marked as such
in the code: (1) `Book.us()` repairs an unknown 6+ letter word by trying single-letter deletions
against the index vocabulary and taking the commonest hit ("Spleenomegaly" -> "splenomegaly"),
and SYNONYMS gains "dd/ddx/d/d" -> differential diagnosis; (2) `maik-local.js` treats a
no-coverage reply (NO_COVERAGE regex) as a retrieval verdict and re-asks ONCE with no reference
material, returning an ungrounded answer from the model's own weights with no gate and no source
line. The gate is untouched: it still applies to every grounded answer.

Naming caveat for the owner: the labels "MAiK Bonsai / Bonsai Swift / Bonsai Max" carry the upstream
brand, against the tier-name convention (MxCore, Neural, Horizon, Apex). Kept because the owner
asked for the models by that name; rename is a one-line registry edit each.

## 2026-09-04 — Web research: Gemini fallback removed, on-device model writes the answer off-cloud

Owner: "remove gemini fallback" and "let gemini do it during MaiK Cloud selected and for rest
offline or free models we cant charge them for snippet conversion into clean language". Two
separate changes to `functions/api/ai/[[path]].js`'s `seg === "research"` handler (plain web
research, NOT Evidence Review, which is untouched and stays cloud-only):

1. The Gemini-grounded fallback (`webSearch: true`) that ran when TinyFish returned nothing is
   deleted outright, per the literal instruction. It was the slower, costlier of the two search
   paths and duplicated ground TinyFish already covers at $0/search (see functions/_search.js). A
   TinyFish miss is now an honest `{text: null, sources: []}`, which the client's existing no-text
   branch already renders as a clear retry - no new failure mode introduced.
2. A new `body.snippetsOnly` branch, checked BEFORE the quota gate, does the TinyFish search and
   returns raw sources with NO Gemini call and no quota burn - it is a plain search proxy. This is
   what lets an engine other than MaiK Cloud avoid paying for the snippet-to-prose step at all.

Client side: `maik-engine.js` now decorates `research` (it previously reached SMD_AI.research
undecorated, always cloud). Its route() intercepts kind "research" ONLY when `effective() ===
"local"` and mode is not "evidence-review": it calls the new `SMD_AI.researchSnippets()`
(reasoning.js - hits `/research` with `snippetsOnly:true`, the free path above) and hands the raw
sources to the new `maik-local.js` `webAnswer(question, sources, opts)`, which writes the prose on
device using WEB_SYS (RESEARCH_SYS_SNIPPETS ported verbatim, so a web-research answer reads the
same regardless of which engine wrote it) and then runs the SAME `evidenceGate` the book RAG uses -
generic against arbitrary evidence text, not book-specific - so an unsupported drug or figure in a
locally-written web answer is caught exactly as it would be for a StewardMD Knowledge Base answer,
and the gate-fail branch shows the top real source instead of a wrong paraphrase, matching the
book-RAG UX. Cloud engine and KB-only both fall straight through to the unchanged cloud path
(`orig.apply`); a local engine with no `webAnswer` (older bundle) also falls through cleanly rather
than throwing. Web research still needs a live network for the TinyFish call itself regardless of
engine - only the WRITING step moves on-device, not the search.

Dead code removed: `RESEARCH_SYS` (only the deleted fallback used it); `test/maik-cloud-scope.test.mjs`
updated to stop asserting a scope rule on a constant that no longer exists.

Verified live on the owner's iPhone 15 Pro (same question, both engines): local engine ->
{engine:"local", mode:"web-local", 8 free TinyFish sources, 989-char answer, 21 s}; MaiK Cloud ->
{mode:"web-tinyfish", 8 sources, 7 s}, confirming the cloud path is unchanged. Unit coverage:
maik-local.test.mjs webAnswer tests using the REAL kb/ai/maik-lite-rag.js evidenceGate, not a
book-specific stub; maik-engine.test.mjs routing; test/research-web-fallback.test.mjs, a
source-level regression for the two server changes.

## 2026-09-04 — TinyFish restricted to trusted medical domains

Owner: "mk sure tinyfish uses trusted medical resources". `functions/_search.js` `tinyfishSearch()`
now passes TinyFish's `include_domains` param (a comma-separated allow-list the API enforces
server-side, not a ranking hint - confirmed against TinyFish's own docs) with a fixed list of
health authorities (WHO, CDC, FDA, EMA, NICE, ICMR, MoHFW), PubMed/PMC/NIH/Cochrane/ClinicalTrials.gov,
major journals (NEJM, Lancet, JAMA, BMJ), and specialty/reference sites (Mayo Clinic, UpToDate,
Medscape, Drugs.com, the AHA/ADA/NKF/ACS society sites). No general news, forums or unvetted blogs
can ever be returned.

Applied ONCE in the shared helper rather than per caller, because `tinyfishSearch()` is already
shared by three medical-only call sites - "Research on the web" (`/research`), the Medical-Updates
crawler (`functions/_updates_pipeline.js`), and the admin manual-publish enrichment
(`functions/api/updates/[[path]].js`) - all three benefit and none had any reliance on
unrestricted results (checked: both crawler call sites already exist to enrich medical
drug/guideline/headline items, never general web content).

New test/tinyfish-trusted-domains.test.mjs (4 tests, stubs global.fetch) asserts the outbound
request actually carries `include_domains` with the exact list, so a future edit that silently
drops the restriction fails a test rather than being noticed the first time a doctor sees a
non-medical source cited. Verified live on the owner's iPhone after merge+deploy: a real search for
DKA management returned 7 sources, all resolving under the trusted list (bestpractice.bmj.com under
bmj.com, pmc.ncbi.nlm.nih.gov under ncbi.nlm.nih.gov, etc.) - confirms TinyFish genuinely enforces
`include_domains` (subdomain matching included) rather than ignoring an unrecognized parameter.

## 2026-09-04 — "Was this helpful?" feedback: durable storage, an admin console pane, and a "why?" prompt

Owner asked where the answer feedback button's data went (nowhere durable: an anonymous
`maik_feedback_up`/`down` counter via `/api/analytics`, plus a "No" also wrote to a DEVICE-LOCAL-ONLY
gap log in `localStorage` that never reached a server), then asked for an admin console section and
for a "No" tap to ask why and store the reason.

Modeled on the two existing patterns closest to this shape: `functions/_clientlog.js`'s KV ring
buffer (get/record/clear, same shape) and `functions/api/ws-feedback.js`'s anonymous-signal stance
(no identity, an aggregate for public GETs, entries only readable by admin). New:
- `functions/_maik_feedback.js` - `sanitizeFeedback`/`recordFeedback`/`amendFeedbackReason`/
  `getFeedback`/`getFeedbackAgg`/`clearFeedback`. Metadata + the doctor's own free text only: helpful
  (up/down), the question typed (clipped 300), an optional reason (clipped 500), engine/pack, ts, a
  generated id. No identity, no patient data.
- `functions/api/maik-feedback.js` - public, unauthenticated (feedback must never be blocked by a
  sign-in check, matches `/api/clientlog`'s own reasoning). Two request shapes on one POST: a new
  rating `{helpful, question, engine, pack}` records immediately and returns `{id}`; `{id, reason}`
  amends that SAME row. GET is counts-only (never the free text), same split as ws-feedback.js.
- `functions/api/ai/[[path]].js` - `admin/maik-feedback` added to the existing owner-gated
  (`aiAdminAuthed`) admin segment list; GET returns entries (with reasons) + the aggregate, POST
  clears and audit-logs, identical pattern to `admin/clientlog`.
- `admin/index.html` - new "MaiK feedback" pane (👍/👎 counts, % helpful, with-a-reason count, and the
  scrollable list of Yes/No + question + reason), wired the same way as the Crashes pane (`fbLoad`,
  nav badge, PANES/TITLES, `refresh()`).
- `home.js` `_answerFeedback` - "No" now shows "Sorry it missed. Please tell us why - help us
  improve." with an optional reason textarea (Send/Skip), a note against patient details. The
  down-vote is recorded THE MOMENT "No" is tapped (so the admin aggregate reflects every tap, not
  only the ones a doctor stays to explain) and its id is used to amend that SAME entry if a reason is
  typed - never a duplicate row for one tap. Existing `SMD_track`/`MaiKCopilot.gapLog` calls are
  untouched (kept for their existing purposes: the allow-listed analytics counter and the local
  per-device gap report).

14 new tests (`test/maik-feedback.test.mjs`: sanitize/record/amend/aggregate/clear, including that
amending twice never double-counts `withReason` and an unknown id is a safe no-op;
`test/maik-feedback-admin-route.test.mjs`: source-level, the route sits inside the same owner gate
every other admin segment uses and returns the free text only there, never on the public GET).

NOT yet verified: the admin console pane's rendering itself needs the owner's own Google login at
stewardmd.in/admin to see - this session has no admin credentials. What WAS verified is the parts
reachable without them: the client and storage logic pass their tests, and (pending a live device
check after merge+deploy) the network flow from a real "No" tap through to the stored aggregate.

## 2026-09-04 — MaiK CHAT skin: make MaiK feel like ChatGPT / Claude

Owner: "not getting a feel of using an AI assistant like ChatGPT or Claude", asked via the
taste-skill. That skill is scoped to landing pages and says so; what applies here is its discipline
(audit before touching, preserve mode, copy self-audit, kill the decorative tells), measured against
what actually makes those two apps feel like assistants. An audit of the sheet found five concrete
differences, none of them streaming (both engines already stream tokens; native falls back to a
word-paced reveal):
1. every assistant answer was a bordered, shaded, shadowed 92%-wide card with an uppercase teal
   "MAIK" label on top; ChatGPT/Claude render assistant prose unboxed and only the user's turn as a
   bubble
2. "Educational clinical reference. Verify with local protocol." was stamped INSIDE every answer, on
   top of the sheet's permanent banner saying the same thing (no recorded decision required the
   duplicate)
3. 13px body / 12.5px user text: widget-sized, not reading-sized
4. up to 17 tappable bordered chips under one answer (Know more, sources, 6 refine, follow-ups, tool
   chips, Create prescription, Research on the web, Yes/No)
5. thinking = mascot + three shimmering skeleton bars + stage captions, then a whole-bubble swap

Decision: a presentation-only CSS skin on `body.mkchat`, DEFAULT ON, `?mkchat=0` kill switch
(persists in `smd_mkchat`), `?mkchat=1` restores. No DOM or logic change, so flag-off is
byte-for-byte the previous MaiK. It unboxes `.maik-b.ai`, hides `.maik-attr` (with !important: the
web-research path inlines its own display) and `.maik-edu`, hides `.maik-conf` except the LOWER
warning, sets 15px reading text, turns every chip into a quiet outline with muted sentence-case
labels, and hides the skeleton bars. Tokens are untouched so dark mode follows. The existing
off-by-default `body.mk2` "UI 2" skin is left as is; the two are independent selectors.

Also fixed in app-facing strings (repo rule, not the skin): the emoji prefixes on the four follow-up
chips, and the em-dashes in the chip/stage/feedback/error strings the audit listed. The model's own
output remains exempt, as CLAUDE.md says. `test/maik-chat-skin.test.mjs` pins the flag semantics,
each of the five CSS fixes, and the string cleanups. Branch stacks on PR #826 because both touch
`_answerFeedback`.

Not changed, deliberately: the chip SET itself (which chips exist is product logic, not skin), lazy
"Know more" (a token-cost decision), the mascot, the sidebar, the empty state. If the owner wants
fewer chips per answer, that is a separate product call.

Two things the first live check caught (fixed in the same PR): the on-device path renders BARE
`<p>/<ul>/<li>` with no `.maik-p` class, so the 15px rule had missed it (measured 12.5px live); and
the "Create prescription" chip is inline-styled as a filled teal button, which beat the skin. The
skin now targets `.maik-b.ai p/li/strong/em/h1-h4` and overrides `.maik-chip.maik-rx` with
`!important`, leaving the send button as the one filled accent on the screen.

Owner, same session: "Answer can show Bold Italic etc formats to make it more appealing and
reading". The renderer (reasoning.js `maikMarkdown`) already turns `**x**`/`*x*` into `<b>`/`<i>`,
with headings, lists and tables; the gap was that MaiK Lite, a prose fine-tune, emits plain text,
and its system prompt is the exact training prompt and stays untouched. `maik-local.js
emphasize()` adds it deterministically instead: drug names (the evidence gate's own suffix regex
via `SMD_MAIK_RAG.drugsOf`, with a fallback), doses and durations are bolded, only when the model
produced no `**` of its own, after the gate (it changes no figure), never on the Source line, and
never on a verbatim quoted book passage (the gate-fail path shows the book as written). Also
applied to on-device web-research answers. 10 tests.

Verified live on the owner's iPhone 15 Pro, fresh question, MaiK Lite: assistant prose unboxed
(border none, transparent, no shadow, 100% width), MAIK label and per-answer disclaimer gone, prose
measured 15px/24.75px, user bubble 14.5px, two `<b>` drug names in the answer, prescription chip
transparent with muted text, no emoji in chips, app process unchanged through the test.

## 2026-09-04 MaiK Lite assistant gaps: retrieval drift guard, dose follow-up, answer actions (PR #827, same branch)

Owner ran a 5-question live battery ("As an AI Engineer and CEO of ChatGPT, run MaiK Assistant and
tell me what is left"), then: "Fix as many as possible but keeping speed & size of model same".
Model, quant, context and system prompt are untouched. Every fix is in retrieval, the follow-up
resolver and the UI.

1. Retrieval drift guard (`maik-local.js retrieveGrounding`). Live, "UTI treatment" retrieved a
   DEFINITIONS/glossary passage and "what if she is pregnant" retrieved hepatitis-in-pregnancy,
   which the model then answered from (lamivudine/IFN) and the presence-only gate passed. Now:
   the top-3 BM25 hits are anchored on the question's 2-3 highest-IDF non-generic tokens (the
   pregnancy/renal/paediatric modifiers and words like management/dose/first-line are excluded from
   the anchors), passages missing every anchor are dropped, introductory chapters are demoted for
   treatment questions, glyph bullets are cleaned, evidence is capped at 700 chars per passage and
   a weak third passage (<60 % of the top score) is dropped. Net effect is fewer, more relevant
   prompt tokens, so prefill gets shorter, not longer. The gate itself is unchanged (repo rule:
   never weaken it). If anchoring empties the set, the answer is "not covered", not a drift.
2. Gate-fail fallback shows the cleaned, capped passage, and states plainly that the model's answer
   could not be verified; the raw "■■ DEFINITIONS" dump is gone.
3. Dose follow-up (`home.js maikResolveFollowup`). "and the dose?" with no drug named and none
   remembered used to answer "Which drug's dose would you like?". It now resolves to the current
   topic's first-line drug and dose, with retrieval steered at "<topic> first line drug dose
   duration". Named or remembered drugs keep precedence.
4. Answer actions: Copy (answer text only, chips/sources stripped), Regenerate (drops the cached
   render, resends with `regen: true`, which the local engine maps to temperature 0.4 so the answer
   actually changes; default remains temperature 0), Edit (question back in the composer).

Tests: `test/maik-local.test.mjs` (real RAG index harness for the drift cases, cap/weak-third,
regen temperature), `test/maik-followup-actions.test.mjs`. `anchorsFor` degrades to "no anchoring"
when the RAG build lacks a tokenizer instead of throwing (an exception there would silently turn
every answer ungrounded, which the older test stubs exposed).

Not fixed, same-model constraint: first-token latency (3-7 s) is prefill-bound; the real lever is
KV prefix caching of the fixed system prompt in `LlamaEngine.swift`, which is native work and a
separate PR.

Addendum, second live battery same day (after the guard above shipped to the phone): CAP comparison
still grounded in typhoid-resistance passages because "community" alone was an anchor match, and
"UTI" was lost as an anchor since expand() rewrites it to the long form. Anchors are now three
kinds (topic / drug / population modifier); a passage must contain a topic anchor when the question
has one (a drug name is not the topic), two anchors beat one when any passage has two, search runs
3x TOPK and keeps TOPK after filtering, and among on-topic passages the ones mentioning the asked
modifier win (negated "non-pregnant" excluded). Result on the phone, MaiK Lite, same model: UTI
treatment grounded (TMP-SMX / nitrofurantoin / fosfomycin, 6.7 s first text); "and the dose?"
grounded 3-day oral regimen, gate passed (4.1 s); "what if she is pregnant" UTI-in-pregnancy
(2.0 s); CAP comparison pneumonia passages only, honest "not compared head to head" (6.4 s);
pregnancy follow-up after CAP stays on CAP; poem refused (1.1 s). Copy / Regenerate / Edit on
every answer. `window.__smdLastGate` holds the last gate rejection (numbers, drugs, anchors,
headings; never passage text) for triage.

## 2026-09-04 WardSynQ: one system with Ward Sync, and the P0 core

**WardSynQ is a module inside StewardMD, not a separate repo or product codebase** (owner, 2026-09-04).
`wardsynq.com` is its EMR web surface. A separate `~/Developer/WardSynQ` repo was started earlier in
the same session and abandoned on that instruction; nothing depends on it.

**Ward Sync and WardSynQ are the same system.** The existing GIMSR GHIS integration (`ghis-ward.js`,
`wardSync` state in `icu.js` / `medlist.js` / `autofetch.js`) is not a parallel feature to be kept
alongside a new EMR. It becomes the first hospital-data adapter under WardSynQ's future Integration
Hub. The pipeline the owner specified:

    GHIS / existing Ward Sync connector
      -> WardSynQ canonical clinical model
      -> Clinical Event Bus
      -> Safety / Workflow / AI / Patient 360 / EMR

with HL7 v2, FHIR R4, DICOM/DICOMweb, LIS, ABDM and IoMT following the same adapter shape. The
binding constraint: **no adapter-specific logic in WardSynQ core.** GHIS lab-name mapping, unit
conversion, token handling and the GIMSR picker stay in the adapter. Existing mobile behaviour keeps
working while it migrates onto the shared layer.

**Not started: the `ghis-ward.js` migration itself.** It touches live mobile code that the ICU
flowsheet, medlist and autofetch all read through, so it is its own reviewed change, not a side
effect of scaffolding.

P0 shipped three files plus 44 tests (`wardsynq/wardsynq-model.js`, `-events.js`, `-meds.js`,
`test/wardsynq-p0-core.test.mjs`). Nothing is wired to the app, nothing is flagged on, there is no UI
and no persistence layer. See `vault/modules/WardSynQ.md` for the design rules; the ones most likely
to be undone by accident are that the eMAR holds no clinical pharmacology (the safety engine is
injected, and its default refuses everything), and that `ADMINISTERED` is structurally reachable only
from `SCANNED`.

Deliberately NOT written, despite the spec listing them: `wardsynq-safety.js`,
`wardsynq-safety-case.js`, `wardsynq-temporal.js`, `wardsynq-mpi.js`, `wardsynq-store.js`,
`wardsynq-interop.js`. The spec routes the clinical-safety files to Opus-level clinical reasoning and
they were kept out of a scaffolding pass on purpose.

Tooling note for future sessions: the owner approved using `agy` (Gemini Antigravity CLI) for small
local tasks, but the Claude Code auto-mode permission classifier refused to spawn it from a
background session, with both `--dangerously-skip-permissions` and `--mode accept-edits`. An owner
saying "go ahead" does not lift that classifier; it needs a Bash permission rule in settings.

## 2026-09-04 WardSynQ safety engine: reuse the interaction data, seed the allergy gap

Built `wardsynq-safety.js` plus store, MPI and an adapter. 127 tests. Still unwired: no flag, no
route, no UI. Three decisions worth not re-deriving.

**Reuse, do not re-author, the interaction data.** A survey of the repo found
`data/interaction-rules.json` already carrying 310 curated rules and 2620 generic-to-class mappings
(ONC HPDDI, openFDA SPL, CredibleMeds, RxNorm) behind the existing `interactions.js` engine and its
tests. WardSynQ reads it through `wardsynq/adapters/wardsynq-rules-stewardmd.js`. A second copy of
drug-interaction content that can drift from the first is a patient-safety problem, not a
duplication smell. CredibleMeds licensing needs checking before commercial use.

**The allergy data did not exist, so it is a labelled seed.** The same survey found no allergy
cross-reactivity data of any kind: no beta-lactam class map, no sulfonamide grouping, nothing. The
Allergy Shield had nothing to run against. `wardsynq/data/allergy-classes.seed.json` fills it,
marked UNAPPROVED with a review date, using the modern side-chain understanding of beta-lactam
cross-reactivity rather than the discredited 10 percent figure, and deliberately recording
sulfonamide-antibiotic to non-antibiotic cross-reactivity as NONE so a later reviewer does not
"helpfully" add it. Dose ceilings are a similar eight-drug seed: StewardMD's max doses exist only as
free-text monograph prose, and regex-parsing prose into a hard-stop is not acceptable.

**Severity and disposition are separate axes.** Severity is the clinical judgement; disposition is
the policy decision about who may proceed anyway. Verdicts carry `blocks` (Category 1, absolute) and
`overridables` (Category 2, audited handshake) separately, and a test asserts that NO override
payload, however well formed or witnessed, can clear a block. A finding may only move between the
two by a reviewed change to a rule pack, never by a code change in the engine and never by a caller
passing a flag. This is the invariant most likely to be quietly eroded later.

**Two drug vocabularies, found the hard way.** The RxNorm-derived data spells amoxicillin
"amoxicillin anhydrous"; every clinician and allergy list writes "amoxicillin". An integration test
expecting an amoxicillin order to trip a penicillin allergy caught the shield failing open.
Reconciled in the adapter by aliasing a multi-word generic's first word to it only when exactly one
generic starts with that word, with allergy membership indexed under both spellings; ambiguous first
words get no alias and the drug is reported unresolved instead of guessed. Every future adapter
(HL7, FHIR, ABDM, LIS) will hit this and needs the same discipline.

Two of these files were written by delegated agents (`agy` for the store, a Claude subagent for the
MPI) against written briefs, then verified here: the MPI's Jaro-Winkler and Soundex were checked
against published reference values including Tymczak and Pfister, and every suite was re-run
independently rather than trusted from the agent's own report.

## 2026-09-04 WardSynQ: the GHIS adapter exists, the cut-over does not

Built `wardsynq/adapters/wardsynq-ghis-adapter.js` (23 tests): GHIS bundle to canonical model, onto
the Clinical Event Bus. This is the owner's stated architecture (Ward Sync becomes WardSynQ's first
interop adapter) implemented as the non-destructive half.

**Deliberately NOT done: rewiring the live path.** `ghis-ward.js`, `icu.js`, `medlist.js` and
`autofetch.js` are untouched. The adapter is pure mapping with no fetch, no token, no live state.
`ghis-ward.js` keeps transport, the per-doctor bearer token (`ghis_token:<uid>`), the 401 silent
refresh and the patient picker. Splitting it this way means the mapping is verifiable in a test with
no network, and the risky part is a separate reviewed change against code real users depend on.

**What a cut-over will have to preserve** (from the survey, all read directly rather than through an
accessor): `STATE.wardSync` shape `{connected,lastTs,patientId,newUpdate}` is read at icu.js:556,
2286, 2424, 2431, 2434, 3718, 6433, 8538, plus autofetch.js:57 and ghis-ward.js:1076. Roster ids are
derived as `"pw_"+patientId` / `"w_"+patientId` (icu.js:873-918). `wardSwitchGuard` (icu.js:725-730)
keys cross-patient contamination protection on `bundle.patientId`. `ingestFromWard`'s conflict logic
treats `STATE.src[key].source === "Manual"` as clinician-entered and everything else as overwritable,
so a new source name must never be "Manual". `GHIS.getSelectedPatient()` is the sole handle
`ghis-meds.js` and the DDI patient context use.

**Three traps in the payload, each pinned by a test.** `dob` is an AGE in years as a string, so
parsing it as a date gives a patient born in year 45, and age drives paediatric dosing; the adapter
records `ageYears` and leaves `dob` as a sentinel that does not parse as a date. `wardToSI` in
icu.js does the opposite of its name (SI back to conventional), so the adapter does no unit
normalisation at all and flags `unitNormalised: false` while keeping the raw value and unit.
`patientId` is the MRN, with no separate UHID.

**Model gap found by the adapter, now fixed:** `Encounter` had no `identifiers` field, so a source
visit id could only survive by being baked into the generated `id` string, which no consumer can
parse back out. Every adapter after this one (HL7 visit numbers, FHIR Encounter.identifier) would
have hit it.

Adapter contract for everything that follows: stable ids from source-stable parts only; nothing
silently dropped (unmapped vocabulary keeps its name and raises an issue, one bad row never discards
the import); the raw source preserved on every record; no invented clinical values; and a source
system's own assertions (GHIS's `critical` flag) carried as data, never promoted to a control.

## 2026-09-04 WardSynQ workstation, and two safety bugs only the UI exposed

Built the EMR surface (`wardsynq/ui/`): patient banner, worklist, order entry with live safety
checking, and the override handshake. Buildless native ES modules and hand-written CSS, importing
the same source the tests import, so the screen cannot drift from tested behaviour. No clinical
logic in the UI: every verdict comes from the real engine against the real pack.

**taste-skill was the wrong tool and says so itself.** Its section 13 excludes dashboards, dense
product UI and data tables, which is exactly what a clinical workstation is. Used
`ecc-healthcare-emr-patterns` instead. Design dials set deliberately against web defaults: variance
LOW (a clinician must find the same control in the same place at 3am), motion LOW (movement in a
ward UI is distraction, and an animated critical alert is worse), density HIGH.

**Two real bugs found by driving the interface, neither caught by 165 unit tests.**

1. **Duplicate-therapy rules fired on a SINGLE drug.** All 270 `duplicate_class` rules in the pack
   carry exactly one subject, meaning "two or more drugs in this class". Read literally by a
   generic matcher they fire when only one is present, so ordering warfarin for a patient on
   nothing else raised a MAJOR "two systemic anticoagulants" alert and demanded an override
   handshake for a duplication that did not exist. That is a false gate on the majority of ordinary
   orders, and the fastest possible way to teach clinicians to click through safety prompts. Fixed
   with `satisfyDuplicationRule`, which requires at least two distinct matching drugs and names all
   of them in the finding.
2. **Alert fatigue by class multiplicity.** Amoxicillin plus clarithromycin produced SIX identical
   duplicate-therapy advisories, one per shared class tag, including tags meaningless at the bedside
   ("Chemical Structure", "Established Pharmacologic Classes"). Fixed with
   `collapseDuplicateFindings`, grouping by rule type, severity and drug set; every contributing
   rule id survives in `mergedRuleIds` so an audit loses nothing. Findings of different severity or
   about different drugs are never collapsed. Together these took the amoxicillin case from seven
   findings to three.

**A UX bug that is really an audit-quality bug.** The verdict panel re-renders on every keystroke in
the order form, which destroyed a half-typed override rationale. A clinician who loses a careful
justification once starts writing "as discussed", and the audit trail quietly stops being worth
reading. Drafts are now preserved across re-renders.

**Buildless ESM caching gotcha.** A `?v=` token on the entry script does NOT invalidate the modules
it imports: ES module imports are cached per URL. The workstation ran stale safety logic in the
browser while the served file and the tests were both correct, which is a genuinely dangerous
failure mode for a safety control. Development now uses a no-store dev server; a production
deployment needs cache headers on the module files, not just a version token on the entry point.
StewardMD's `?v=goldNNN` convention has the same blind spot for anything loaded as a module.

The screen states the rule pack version and its approval status permanently, because a clinician
trusting seed data because the interface looked finished is a foreseeable route to harm.

## 2026-09-04 WardSynQ workstation: redesign after the first pass read as AI-generated

Owner feedback: the font and the safety boxes looked "vibe coded". Correct on both counts, and the
first pass had more tells than those two.

**What was wrong.** The font stack was `ui-sans-serif, Segoe UI, Roboto` — the most generic possible
choice, in a file whose own comments said to avoid generic stacks. Findings rendered as rounded
tinted cards with a thick coloured left border and an uppercase micro-label, which is the standard
LLM alert-card shape. Containers nested three deep (panel inside card inside card) so there were
three levels of box and no levels of hierarchy. Severity colours were washed-out pastels that read
as decoration. The dose field was 800px wide for three digits. A "checked in 0.3 ms" floated in the
top right corner attached to nothing.

**Direction, from the ui-ux-pro-max database rather than taste.** Swiss / International grid style
(its match for enterprise dashboards and professional tools), dials variance 3, motion 2, density 9.
Typeface **Fira Sans with Fira Mono**, the database's dashboard and analytics pairing. Fira was drawn
for legibility at small sizes on poor screens, and the matched monospace is the point: every clinical
number here is tabular, so a decimal sits in the same column down a list and 1.42 cannot be misread
as 142.

**What changed structurally.** Ruled bands instead of nested rounded cards. A label column plus a
control column, with controls sized to their content, because a field's width is a hint about what
belongs in it. Findings are a severity rail plus a ground, where **fill intensity is the hierarchy**:
a hard stop is filled and unmissable, an override is lightly filled, an advisory has no fill at all
and recedes. Making advisories quiet is the alert-fatigue lesson expressed in the layout, and it is
what keeps the filled one noticeable. The override handshake now sits inside the finding it belongs
to, separated by a rule rather than by a second border and radius. The results table is deliberately
NOT full width: five columns stretched across 950px puts a value half a screen from its reference
range, and long scan distances are how a value gets read against the wrong row.

**Unchanged on purpose.** Severity is a word before it is a colour, everywhere. Both colour schemes
ship and both were checked visually, not assumed. 44px targets.

**PRODUCTION GAP:** the webfont loads from a CDN in this build. A ward loses its network, so a real
deployment must self-host the woff2 files. The fallback stack is ordered to degrade to another
tabular-capable face rather than to something that reflows every number, but that is a mitigation,
not the fix.

## 2026-09-04 WardSynQ workstation v4: designed as a clinical instrument, not a dashboard

Owner brief: Bloomberg terminal meets Apple clinical software meets modern ICU workstation. Premium,
dense but calm, no generic SaaS or shadcn look, safety engine as the hero, never weaken a warning
for aesthetics. Built directly into the existing buildless app: vanilla ES modules and token-driven
CSS, no framework added, engine untouched apart from one additive field (`effect` and `action` kept
separately on interaction findings so Risk and Guidance can render as distinct facts).

**Critique of the previous pass that drove this.** The patient was a header, not the object. The
safety result was a paragraph in a tinted box; a clinician under pressure needs Risk, Mechanism
and Guidance as separable facts. Labs sat in a table three scrolls from the decision they inform.
The override was a form, not a decision. Typography was competent but anonymous.

**Decisions.**
- Type: IBM Plex Sans + IBM Plex Mono. Built for dense enterprise data, true tabular figures, and a
  mono that carries the terminal register without cosplay. Every clinical number is mono/tabular.
- Tokens in `:root` for colour, type scale, space, radius, hairline/rail widths, shadow, motion.
  Components only use tokens. Severity scale: critical, major, moderate, monitor, info, ok. Fill
  intensity is the hierarchy: critical and major filled, moderate lightly, monitor and info unfilled
  so they recede and the loud finding stays loud.
- Patient context bar: sticky, hairline-separated segments (identity, MRN, location and status,
  allergy with rail, actions). 59px. The allergy is in the bar, not a panel, because the hazard is
  acting on the wrong chart.
- Sidebar: chart navigation with keyboard hints plus the ward worklist; Notes and Alerts present but
  aria-disabled with a title, rather than faked.
- Workspace: order and safety engine in the main column, clinical context (results as data points,
  dosing context, active meds) in an aside beside the decision. Results are a figure, a name and a
  WORD for the flag; abnormal cells are lightly filled.
- InteractionCard: severity badge (word first), drug pair in mono, rule code, then Risk and
  Mechanism as a labelled fact grid, with Guidance, Monitoring and rule id under a native
  `details` disclosure. Merged rule count shown as "and N related".
- OverridePanel: "Override required. Why are you proceeding?" with four reason buttons (Clinical
  necessity, No suitable alternative, Benefit outweighs risk, Other), rationale, Cancel and "Apply
  override and sign", and a line stating it is recorded to the clinical audit trail. Drafts survive
  re-render. Apply records the override, re-evaluates, and signs only if the engine then allows.
- AuditTrail: an in-session list of override and signing events, timestamped.
- Keyboard: Enter advances fields, Ctrl+Enter signs when allowed, Esc clears, N/O/L/M/P jump.
- Engine status line in the safety header: "310 rules in 0.3 ms" with a state dot.

**Verified, not assumed.** Viewport screenshots read by eye in light mode; end-to-end override
flow driven in the browser (gating, draft survival across a mid-entry re-render, apply and sign,
audit entries, active medication list updated); zero console errors; 173 tests, 172 passing.

**Production gaps recorded.** Webfont from CDN (must self-host; wards lose network). Dark scheme
tokens exist but this pass was checked by eye in light only. Notes and Alerts are placeholders.

## 2026-09-04 WardSynQ v5: an original visual language, and the defects redesigning it exposed

Owner rejected v4 as still AI-coded and generic-enterprise. Correct. The `frontend-design` skill
lists the current AI-design tells, and v4 hit three of five by name: broadsheet layout with hairline
rules, tracked-out all-caps eyebrow labels above every heading, and a monospace face for small data
labels. It was the generated default, not a designed thing.

**Research actually read** (subagent, `gh`/WebFetch, cited in full in the session): NASA Open MCT
(`_status.scss`, `_limits.scss`), NHS.UK design system colour + service manual, GOV.UK type scale,
IBM Carbon `packages/type`, GitHub Primer `primitives`, Microsoft Fluent 2 `packages/tokens`,
OpenMRS O3 esm-styleguide, Bahmni, Medplum.

**Principles extracted, and what each changed here.**
- Open MCT encodes a limit violation on four independent channels: glyph, colour, border and dash
  spacing, with limit DIRECTION as a separate arrow. Severity survives with colour removed. Adopted
  as the core idea: WardSynQ's marks differ in LENGTH, WEIGHT and TEXTURE (solid, broken, dot)
  before they differ in hue, and result deviation is split from result direction.
- NHS.UK: "make sure what the colour is saying is available in other ways", and a grey-tinted ground
  to cut glare for sustained reading. Our ground is a low-chroma green-grey for that reason.
- GOV.UK: tabular figures are opt-in per element, not global. v5 scopes `tabular-nums` to results,
  dose and dosing facts; running clinical prose gets proportional figures.
- Primer: monospace is policy-restricted to code. Fluent 2 goes further and gives numerals their own
  family rather than reaching for mono. v5 has exactly ONE monospace use left, the MRN.
- Carbon/Primer/Fluent all use ONE family for every text role. v5 uses Source Sans 3 throughout.
- Anti-pattern found: Bahmni and Medplum document no typography, density or accessibility policy at
  all, and O3's tokens are gated in Zeplin. Being used in real hospitals is not evidence of design
  rigour, so none of them was treated as a model.

**The original idea: the signal column.** A narrow channel down the left of the workspace is the only
place colour appears. Every clinical statement registers a mark there; nothing else does. It is not
any of the references: Open MCT marks rows in a table, this binds a whole workspace to one continuous
significance channel, so peripheral vision answers "is anything wrong on this screen" before a word
is read. Findings are written as clinical sentences (significance, then the patient's own data as
context, then what to consider, then what an override actually does) rather than a labelled
Risk/Mechanism grid, and mechanism moves under a disclosure because it is study material.

**Colour earns its place.** The allergy on the identity bar is unfilled until the drug being ordered
actually implicates it, verified: ordering amoxicillin lights it, ibuprofen does not. A chip that is
red all day is wallpaper by the second shift.

**THREE REAL DEFECTS the redesign exposed, none cosmetic.**
1. **The medication input rendered at 1.2:1.** The signal mechanism set `color` on the line so the
   mark could use `currentColor`, and it cascaded into descendants: with `data-sig="none"` the drug
   field drew its text in the hairline grey. A clinician could not read the drug name they had just
   typed. The mark now rides on its own `--mark` property and never touches text. Now 18.35:1.
2. **Duplicate-therapy findings with subset drug lists.** The screen showed the same sentence twice,
   once for two drugs and once for three including both. `collapseDuplicateFindings` now absorbs a
   finding whose drugs are a strict subset of an identical one at the same severity, keeping the
   superset because it names every drug involved. Three tests pin it, including that different
   severities and different messages are never merged.
3. **A disabled commit button at 1.85:1.** `.btn[disabled]` outranked `.btn-commit`, leaving muted
   text on the signal fill, so the clinician could not read what the button would do before earning
   the right to press it. Disabled now drops the fill instead of dimming text on top of it.
Also: the signal column marked non-clinical rows with a vestigial dot. A channel that marks every
row means nothing, so plain lines now render no mark at all.

**Verified:** light and dark by eye at 1680x1000; contrast measured in both schemes (body 7.4 to
17.5, severity words 5.95 and 7.84, inputs 13.9 to 18.4); tab order runs drug, dose, unit, route,
the four reason chips, rationale; no horizontal overflow at 1180; full override-to-signature flow
driven in the browser including draft survival across a mid-entry re-render; 176 tests, 175 passing.
Zero uppercase labels and one monospace use remain in the stylesheet.

**Still open:** webfont from CDN must be self-hosted for wards without network; Notes and Handover
are disabled placeholders; the clinical seed content remains unapproved.

## 2026-09-04 WardSynQ: the safety case is executable, and it says 4 of 11

Built `wardsynq/wardsynq-safety-case.js` and `scripts/wardsynq-assurance.mjs`. The spec's hazard
table is now code whose verification column names real tests, and the script runs the suites, parses
TAP, and cross-references what actually passed. A hazard whose named test is renamed or deleted
reports MISSING TEST instead of quietly continuing to look verified, which is how a paper safety case
decays the week after it is signed.

**The honest number is 4 of 11 fully verified**, 4 partially controlled, 3 uncontrolled. Verified:
HAZ-MED-01 interactions, HAZ-MED-02 allergy, HAZ-MED-03 dose ceilings, HAZ-MED-04 bedside five
rights. Uncontrolled with nothing built: HAZ-DIAG-01 critical-result acknowledgement, HAZ-BLD-01
transfusion compatibility, HAZ-SURG-01 the WHO surgical checklist.

**The file caught itself lying on its first run.** HAZ-AI-01 and HAZ-DEV-01 came back VERIFIED
because their declared tests passed, while their own caveats said no control had been built: the
model carries `aiDrafted` and `artifact` FIELDS and nothing enforces or ever sets them. A green row
for a control that does not exist is worse than no safety case at all. Controls now declare an
`adequacy`, and a partial control is capped at PARTIAL however green its tests are, because tests can
show that what was built works but never that what was NOT built was unnecessary. That single change
took the headline from a flattering 8 of 11 to a truthful 4 of 11.

Its own test suite is written as attempts to make it lie: an all-passing run must still report the
uncontrolled hazards as uncontrolled, a partial control must not be promoted, a renamed test must
surface as missing evidence rather than success, an empty run must leave nothing looking verified,
and the report must open with what is not covered because an assurance report that leads with its
successes is a marketing document.

Exit code is 1 only on FAILING, deliberately 0 on UNCONTROLLED and NO_EVIDENCE: those are declared
gaps in an early build, and a gate that fails from day one is a gate somebody switches off.

Two caveats on the artefact itself. VERIFIED means the named tests pass, not that the control is
clinically adequate; that judgement belongs to the named approver. And HAZ-MED-01 through 03 are
verified as MECHANISMS while their clinical content is still unapproved seed data.

## 2026-09-04 WardSynQ: the three uncontrolled hazards are now built

Built controls for the three hazards that had nothing at all, in the owner's priority order. 269
tests, 268 passing, 1 skipped. Assurance moves from 4 of 11 verified to 7 of 11, with 0 uncontrolled.
The scoring methodology was NOT touched; every point came from a control that now exists.

**HAZ-DIAG-01, `wardsynq-critical.js`.** The whole loop: deterministic classification against an
injected threshold pack, responsible clinician identified, dispatch, delivery, viewing,
acknowledgement, documented action, time-driven escalation, append-only ledger. Design rules each
exist because of a way the control could be defeated: a source system's own critical flag can RAISE
a loop but never close or veto one; no state may be skipped; timestamps are server-assigned so an
acknowledgement cannot be backdated; escalation has no suppression flag; viewing does NOT stop
escalation because a result that was looked at and abandoned is the hazard; acknowledgement alone
does not close the loop because seeing a potassium of 7.1 is not treating it.

Caught during the build: `tick()` was a correct method that nothing called, which would have left
the state machine right and the clinical control absent. Added `CriticalResultMonitor`, whose
`pump()` drives every live loop and whose failures are isolated so one broken loop cannot silence
every other patient's result.

**HAZ-BLD-01, `wardsynq-transfusion.js`.** ABO and RhD compatibility live in code because they are
immutable biology; anything genuinely local, such as D-positive to D-negative policy, is injected.
Red cell and plasma tables are kept separate and both matrices are asserted by hand in the tests,
because plasma is the INVERSE of red cells and one shared table would be lethal in one direction.
Nearly all the effort is on identity: the crossmatch binds one unit to one patient, and the bedside
check needs two different named people, a scanned wristband, a scanned unit, and RE-DERIVES
compatibility from the physical bag rather than the crossmatch record, so a mislabelled bag is
caught by the check that matters. Platelets are explicitly refused rather than guessed.

**HAZ-SURG-01, `wardsynq-surgical.js`.** Incision is unreachable until Sign In and Time Out are
complete, and complete means every item explicitly confirmed plus three DIFFERENT people signing as
surgeon, anaesthetist and nurse. The laterality chain is the interesting part: the side is declared
once at booking and re-asserted independently at marking, Sign In and Time Out, each compared to the
BOOKING rather than to the previous step, so an early error cannot propagate by agreement. Consent
must match procedure and side. An operative record is refused while any milestone is outstanding,
because otherwise the gate would only delay the paperwork.

**One test was rewritten and it is worth being explicit that this was not a weakening.** The safety
case test "the report leads with what is not covered" asserted the literal string UNCONTROLLED as
the first row. It went stale the moment the last uncontrolled hazard was genuinely built. It now
asserts the general invariant instead, that the report leads with the worst status actually present
and never with a verified row while anything is unverified, and additionally that the whole listing
stays ordered worst first. The scoring, the adequacy cap and the criteria are unchanged.

**Status vocabulary, kept distinct as the owner asked.** All three are IMPLEMENTED and TESTED. None
is CLINICALLY VALIDATED or CLINICALLY APPROVED. The critical threshold pack is unapproved seed and
models ADULT limits only, so a paediatric result classified against it would be wrong. Transfusion
covers ABO and RhD only, with antibody screening, phenotype matching, special requirements, massive
transfusion and neonatal rules all absent. The surgical item set is shorter than the full WHO
checklist and than most local variants. No barcode hardware is integrated anywhere, so every bedside
gate is verified against supplied scan values rather than a scanner.

**Remaining, in priority order:** HAZ-AI-01 is the worst of the four PARTIALs, because the AI
boundary is currently a convention with nothing enforcing it and the store will accept a
signed-looking record from any caller; it needs an actor model. Then HAZ-DEV-01 (fields exist,
nothing sets them), HAZ-DOWN-01 (offline and three-way merge), and HAZ-ID-01 (cross-context chart
contamination).

## 2026-09-04 WardSynQ: actor model, device gateway, offline reconciliation, and the shadow tap

Four pieces. 343 tests, 342 passing. Assurance moves 7 of 11 to 10 of 11, with one hazard held at
PARTIAL deliberately.

**HAZ-AI-01, `wardsynq-actors.js`.** The boundary was a convention: the model carried `aiDrafted` and
`signedBy` and the store would accept a record claiming `status: "active"` and `signedBy: "dr-x"`
from any caller including the model that wrote the draft. Now a four-tier ladder where the ceiling is
a property of the actor's KIND rather than its configuration, clamped at construction on a frozen
object, so no AI, device, adapter or service actor can hold EXECUTE by any route. A signature is an
act: only a credentialed human writing as themselves may set `signedBy`.

One rule was removed during the build for being both weaker and wrong. It refused a record claiming
`aiDrafted: false`, which broke on ordinary writes because the model factory defaults that field to
false, and which could only ever catch a claim it could see. Replaced by stamping provenance at the
point of writing, which cannot be evaded by omitting, defaulting or misspelling the claim.

**HAZ-DEV-01, `wardsynq-iomt.js`.** `signalQualityIndex` and `artifact` existed and NOTHING EVER SET
THEM. Now a gateway sets them. The bigger half of the hazard is attribution rather than noise: a
reading from an unassociated device is REFUSED rather than queued or guessed from the bed, and moving
a monitor explicitly ends the previous claim so no chart has two live claims on one device. Artefact
is derived from signal quality and plausibility and cannot be overridden by a payload asserting its
own data is clean. An implausible value is marked but never discarded, because an SpO2 of 71 is a
sick patient rather than a broken sensor. Clock skew is marked, never corrected.

**HAZ-DOWN-01, `wardsynq-offline.js`. HELD AT PARTIAL ON PURPOSE.** Three-way reconciliation against
the common ancestor: only disjoint field changes combine automatically, anything signed or
administered is never folded into, and the same field changed on both sides becomes a conflict
carrying both versions and the ancestor. A conflict cannot be resolved without a named clinician and
a rationale, and the discarded version stays on the record. That closes the silent-overwrite half.
The data-loss half is NOT closed: the journal is in memory, so a workstation losing power mid-outage
loses the charting it held. Raising this to full would be exactly the flattering arithmetic the
adequacy cap exists to prevent.

**The Ward Sync cut-over: shadow first.** `wardsynq-flags.js` follows the insulin-flags pattern, all
flags default OFF. `wardsynq-shadow.js` observes: with the flag on, a bundle already ingested by the
legacy path is additionally passed through the adapter and the two compared. Three properties make
it safe, in order of importance: icu.js is NOT MODIFIED, the wrapper is installed from outside so not
loading the file removes the change entirely; the legacy result is computed first and returned
untouched; and the shadow cannot throw into the caller, so an adapter defect is a number on a report
rather than a broken ward round. A legacy throw still propagates, because swallowing it would turn a
real ingest failure into a silent success.

The cut-over proper is NOT built and its flag says so. It should happen only after the shadow has run
against real ward data and `report().clean` has stayed true.

**Two safety-case tests were rewritten and neither weakened anything.** The literal example naming
HAZ-AI-01 as the partial-control regression went stale when that control was genuinely built; it now
pins to whatever is currently partial and asserts the set is non-empty so it cannot pass vacuously.
The scoring, the adequacy cap and the criteria are unchanged.

## 2026-09-04 WardSynQ: the last open hazard, and guarding the number against itself

Closed HAZ-DOWN-01 by making the offline journal durable. 351 tests, 350 passing. Assurance reads
11 of 11 verified, which is exactly the point at which this artefact becomes dangerous to read
carelessly, so the report changed too.

**Durability.** `OfflineJournal` now takes a backend and `record()` is async and does NOT resolve
until the entry has reached storage. A UI that reports a note saved before that resolves is lying to
a clinician, so the ordering is durable-first: a failed write reports failure and is not held in
memory pretending to be journalled. `open()` restores a previous session's work, sorted by when it
was written, skipping unreadable rows so one half-written entry cannot cost a clinician the rest of
the night's charting. Reconciliation now clears settled entries from disk while leaving unresolved
conflicts, so a device dying mid-reconciliation comes back holding only the work still owed a
decision. `IndexedDBJournalBackend` resolves on transaction COMPLETE rather than request success,
because a device dying between those two moments would lose an edit it had already acknowledged.

**Two caveats kept on the record rather than buried.** The durability tests exercise the backend
INTERFACE through an in-memory implementation; the IndexedDB adapter itself is reasoned about rather
than proven. And nothing yet wires the journal into the workstation, so the control exists and an
application that does not use it gets none of it.

**The safety case tests fired their own guards, twice, and that was the design working.** With
nothing left partial or unverified, the cap test correctly declared itself vacuous ("add a partial
fixture rather than deleting the rule") and the ordering test found VERIFIED first. Both now assert
against SYNTHETIC hazard fixtures containing one of every status, so the rules stay enforced no
matter how the real table evolves, and additionally check the live table. That is strictly stronger
than the versions that went stale: a rule that can pass vacuously is a rule that has quietly stopped
working. Scoring and the adequacy cap are unchanged.

**The report now qualifies itself unconditionally.** A headline of "11 of 11" with nothing beside it
will be read as "safe to use on patients", which is not what any row says. Every run now prints, in
the header: VERIFIED means the named tests pass, it does NOT mean the control is clinically adequate
or that its clinical content is approved; how many hazards carry an unapproved-content caveat
(currently 9 of 11); and that nothing in the build is clinically validated or approved. A test
asserts the qualifier is present even on an all-green table, because that is when it matters most.

## 2026-09-04 WardSynQ: the workstation now stands on the controls

Phase 1 of what was left: wiring. Before this, `grep` showed the workstation used none of
GovernedStore, OfflineJournal or makeActor. The safety case read 11 of 11 while the UI wrote
straight to the raw store with no actor, no session binding and no journal. An enforcement point off
the path enforces nothing, so three hazards carried a caveat saying so.

**What changed.** The workstation holds a credentialed human actor and a governed session rebound on
every patient switch. Seeding uses a SERVICE actor, capped below EXECUTE by its kind. Offline writes
go to a durable IndexedDB journal and reconcile on reconnect. Governance denials are surfaced in the
record rather than swallowed, because an interface that hides a refusal teaches clinicians the
software is flaky rather than that it is protecting them.

**A real hole found by the wiring, not by a test.** `Reconciler` wrote through the RAW store, so an
outage's worth of charting would have been committed with no actor at all: the exact hole the
governed store exists to close. Added `GovernedStore.asStoreFor(actor)`, an actor-bound but
chart-unbound handle for machinery that legitimately spans patients, and moved reconciliation onto
it. Chart binding is dropped rather than faked, because pretending a batch job has one chart open
would make the WRONG_CHART check meaningless. Four tests now pin it, including that the batch handle
is still governed and is not a way around the ceiling.

**A UI bug the browser found.** `clear()` ignored its parameter and always wiped the confirmation
panel, so the offline path wrote "Held on this device" and then erased it: the clinician saw a
cleared form and no statement of what had happened to their order.

**Verified in a browser, not asserted.** A signed order carries a `writtenBy` stamp that only
GovernedStore applies, which is the proof the wiring is real rather than decorative. A cross-chart
write from the live session was refused with WRONG_CHART. A full outage was driven end to end:
signed offline, held durably, still present when a fresh journal was opened over the same IndexedDB
store, reconciled cleanly on reconnect, journal emptied. Zero console errors.

**That last point closes a caveat honestly.** HAZ-DOWN-01 previously said IndexedDBJournalBackend was
"reasoned about rather than proven" because only the in-memory backend was exercised. The restart
case has now been driven through the real IndexedDB adapter in a browser, so the caveat now records
what remains instead: a service worker, so the app itself LOADS without a network, is separate from
data survival and is still not built.

`window.WARDSYNQ` exposes a diagnostics handle carrying the GOVERNED store rather than the raw one,
so a support console cannot become an ungoverned write path.

## 2026-09-04 WardSynQ: the Integration Hub, so GHIS stops being a special case

`wardsynq-interop.js`, 19 tests. GHIS was the only adapter and there was nothing for a second one to
register with, so the pattern existed only in the comments. Now it is a registry, and GHIS is an
instance of it rather than the exception.

**Four rules, each a way interop layers normally go wrong.**

1. **An adapter is never trusted to commit.** Every feed writes as an ADAPTER-kind actor, which the
   existing actor model caps at DRAFT. The ceiling is enforced by the same control that stops an AI
   committing an order rather than by a second, weaker rule written here. A test sends a feed that
   insists on a signed active prescription from another hospital's system: it is refused and
   quarantined, because "the other system said so" is not a clinician's signature.
2. **Nothing is silently dropped.** Unclaimed, ambiguous, rejected, failed and governance-refused
   payloads all land in quarantine with the reason and the original payload. A feed that discards
   what it does not understand produces a chart that is wrong in a way nobody can see.
3. **One broken feed does not stop the others.** A hospital runs many feeds and they fail
   independently, so a throwing adapter is isolated and counted, and a `claims()` that throws is
   treated as not claiming rather than as a crash.
4. **Replay is expected.** Ingest is keyed on the source's own event identity, so a reconnect or a
   catch-up window is a no-op rather than a second copy of a patient's potassium.

Two adapters claiming one message is quarantined as AMBIGUOUS rather than resolved, because guessing
would attach a patient's data to whichever adapter happened to register first. `health()` reports
per-feed counters and a `stalled` flag for a feed that is arriving and never landing, which is what a
hospital with eight feeds actually needs to see.

The hub works with no store at all, so mapping stays exercisable in a harness, the same property the
adapters themselves have.

## Paediatrics: refusing to treat a child as a small adult (2026-09-04)

Two hazards were VERIFIED while carrying the same caveat: the critical-result thresholds and the dose
ceilings are ADULT values, so a paediatric result classified against them would be wrong. That caveat
was honest and unaddressed, and children are exactly where threshold and dosing errors kill.

`wardsynq/wardsynq-paediatrics.js` closes it, and the way it closes it is by REFUSING rather than by
inventing paediatric numbers.

1. **An unbanded reference range means ADULT and must not be applied to a child.** Not applied with a
   warning, not applied because it is probably close enough: refused, and reported as unclassified.
   A potassium of 6.0 is critical in an adult and ordinary in a neonate.
2. **A refused result RAISES a loop rather than falling through as "not critical."** This was the
   dangerous half. The first cut of the refusal made a child's result vanish silently, which is at
   least as dangerous as judging it wrongly. An unassessable result now opens a loop marked
   `raisedBy: "unassessable-result"` so a human sees the number the machine would not judge.
3. **An age in whole years is not a band below toddler.** `ageYears: 0` is true of a two-day-old and
   an eleven-month-old, so it resolves to UNKNOWN rather than NEONATE. Unknown is refused, never
   assumed adult, because assuming adult is the single most likely way this control gets defeated.
4. **A neonate needs gestational age.** A 26-week preterm on day 2 and a term baby on day 27 are both
   neonates and share almost no reference range.
5. **The adult maximum caps weight-based dosing.** A 90 kg adolescent at 15 mg/kg is 1350 mg: the
   arithmetic is right and the answer is dangerous. That is the classic paediatric overdose.
6. **The weight itself is checked for plausibility.** A mistyped weight is invisible once it has
   become arithmetic. Bounds are deliberately generous: this catches a decimal point or a
   pounds/kilograms mix-up, not an unusual child.

The file is mechanism and almost no content, on purpose. Real paediatric limits vary by band, assay,
gestational age and local policy, and getting them wrong is worse than not having them, so the
numbers stay in a pack a paediatrician signs. The HAZ-MED-03 and HAZ-DIAG-01 caveats were rewritten
to record that the content is still absent; the scoring methodology and criteria were NOT changed.

STATUS: IMPLEMENTED and TESTED (21 tests). NOT clinically validated, NOT clinically approved.

## Deterioration: NEWS2, and the reasons a score must refuse (2026-09-04)

Failure to rescue is the largest avoidable category of inpatient death, and nothing in the build
watched a trend. The spec's own HAZ-DEV-01 verification already named this file's job -- the IoMT
artifact filter exists to keep corrupted telemetry out of "automated NEWS2 calculations" -- but there
was no such calculation, so that clause was asserted rather than exercised.

The arithmetic of NEWS2 is public and easy. Everything that decides whether an early warning system
saves anybody is in what it does when the inputs are not what the score assumes:

1. **A missing parameter is not zero.** The single most dangerous way to implement NEWS2. An absent
   respiratory rate scores 0, the total looks reassuring, and respiratory rate is the earliest sign
   of deterioration there is. An incomplete score is INCOMPLETE and has no risk category, however
   low the partial total. The partial total is still shown, so a human can see how sick this is.
2. **A stale observation is not a current one.** A score built from a six-hour-old blood pressure is
   a current-looking number about a patient who has since changed.
3. **Scale 2 is a prescription, not a guess.** Using Scale 1 on a hypercapnic patient escalates
   somebody who is at their own target; using Scale 2 on anyone else hides real hypoxia. It applies
   only where recorded. The counterintuitive half is tested: 98 percent ON OXYGEN scores 3 on
   Scale 2, and the same number on air scores 0.
4. **The total hides the single parameter.** A total of 3 from one parameter at its extreme is a
   different patient from a total of 3 spread across three. Both now drive escalation.
5. **NEWS2 is adult and non-obstetric**, so children and pregnant patients are REFUSED rather than
   approximated. Same rule as the paediatrics module: an unbanded tool means adult.
6. **An unscorable patient is escalated too.** A patient nobody has fully observed is its own reason
   to send somebody, so an incomplete score raises rather than falls silent.
7. **Re-escalation goes strictly ABOVE whoever was already asked.** The first cut counted rungs on a
   ladder, which sent an ignored medium-risk escalation back to the ward doctor who had just ignored
   it. A test caught it.

**A real defect this exposed.** `scoreEligible` was bolted onto the observation object AFTER
construction and was therefore not part of the canonical model, so any device reading that
round-tripped through the store, an adapter or the event bus lost the flag and was then excluded
from every automated score forever, silently. It is now a modelled field with null meaning NOT
ASSESSED, which for a device observation remains ineligible: a reading nothing has vetted has not
passed.

**A new hazard row, HAZ-DET-01, marked LOCAL.** It is not transcribed from the spec's assurance
table, which has no row for failure to rescue. It is declared PARTIAL and stays partial: the score,
the refusals and the escalation state machine work, but there is NO NOTIFICATION CHANNEL. A monitor
that raises a correct escalation into an in-memory Map has not rescued anybody, and the sweep is
caller-driven so nothing re-escalates unless something calls it on a timer. Adding this row LOWERS
the fully-verified fraction from 11/11 to 11/12; it was added because the omission was real, not to
improve a number. The scoring methodology and criteria are unchanged.

The RCP's published 2017 parameter bands are a national standard, which is why this file carries
numbers where the threshold and dose packs deliberately do not. The escalation policy attached to
them is a local decision and is marked unapproved.

STATUS: IMPLEMENTED and TESTED (32 tests). NOT clinically validated, NOT clinically approved.

## Notification: attempted is not delivered (2026-09-04)

Two closed loops depend on telling a human something: a critical result and a deteriorating patient.
Each had its own idea of what "sent" meant, and a hospital does not need two notification systems
with two different definitions of delivery. The weaker definition is the one that quietly loses a
patient.

`wardsynq/wardsynq-notify.js` is now the only place that decides. One rule: a channel that throws,
returns nothing, returns anything other than `delivered: true`, or is not configured at all has NOT
delivered, and the caller is told so. Silent success is the failure mode; every branch exists to make
failure loud. A site that wires no channel gets NO_CHANNEL thrown at it, because an escalation system
that appears to work while shouting into a void is worse than one that is visibly switched off.

**Two real defects this surfaced.**

1. The deterioration monitor awaited a `notify` callback and treated anything that did not throw as
   success, so a well-meaning `async () => {}` stub read as a receipt. It now refuses to raise at all
   without a channel, unless a harness explicitly opts out and accepts undelivered escalations.
2. The critical-result ESCALATION path -- not its primary dispatch, which was always correct --
   awaited its channel and ignored the return value entirely. A channel reporting failure was
   recorded as though the on-call consultant had been told, and a missing channel was skipped in
   silence. This was the more dangerous of the two, because it sat inside a hazard already marked
   VERIFIED. Three tests now hold it.

The escalation ladder also had a bug worth recording: re-escalation counted rungs on a fixed ladder,
which sent an ignored medium-risk escalation back to the ward doctor who had just ignored it.
Re-escalation now goes strictly ABOVE whoever was already asked, and the top rung is terminal so an
ignored emergency keeps asking the resuscitation team rather than falling off the end into silence.

What has NOT changed: no transport is shipped. Every channel is a function a site supplies and this
build supplies none, so HAZ-DET-01 stays PARTIAL. The improvement is that the system no longer
pretends otherwise.

## Emergency bundles: the clock is the control (2026-09-04)

`wardsynq/wardsynq-emergency.js` (29 tests) implements the spec's named Code Sepsis, Code STEMI and
Code Blue state machines. What makes these different from every other workflow in the build is that
the dangerous variable is TIME: a sepsis bundle completed perfectly at four hours is a bundle that
did not work. So the object is a clock with a checklist attached, not a checklist with a timestamp.

**The failure it is built against.** Bundle compliance is measured, reported and rewarded, so it is
gamed, and it is gamed in one specific way: time zero is moved. A patient recognised at 02:10 who
gets antibiotics at 04:30 becomes compliant the moment somebody records recognition at 03:45. The
record then says the hospital did well and the patient still waited two and a half hours.

1. **Time zero is set once**, non-writable and non-configurable. Under module strict mode both a
   plain assignment and a redefinition throw. It cannot be in the future, and it cannot precede the
   evidence that triggered it -- back-dating in either direction is refused.
2. **A wrong origin is corrected by VOIDING with a mandatory reason**, leaving both bundles on the
   record. Deliberately expensive, so a correction can be told apart from a cover-up.
3. **An element completes on its own named event.** Antibiotics count on `administered`, and passing
   `ordered` is refused with "ordering a thing is not doing it". Ordered at 40 minutes and hung at
   three hours is a three-hour bundle.
4. **A breach stays a breach.** Status is recomputed from the immutable origin every time rather
   than stored, and breach outranks completion: every element eventually done with one done late is
   BREACHED, because the patient waited.
5. **Cultures-before-antibiotics is recorded as a deviation, not enforced.** Delaying an antibiotic
   to draw cultures kills people, so the two facts are kept separable rather than one blocking the
   other.

**Screening is not diagnosis.** qSOFA has poor sensitivity and its documented harm is being read as
a rule-out. There is no NEGATIVE result here: a screen that is not met returns NOT_POSITIVE and says
in words that it does not exclude sepsis. An incomplete screen that has not already reached two
criteria cannot be reported as not-positive at all, because the missing criterion might have been the
deciding one. A screen can never open a bundle; that requires a named human.

**The arrest clock carries no dose.** It gives intervals and says what is due. A system that told a
resuscitation team what to give, from an unapproved table, during the two minutes where nobody has
time to check it, would be the most dangerous thing in this repository. A test asserts that no label
contains anything matching a dose.

**HAZ-TIME-01, marked LOCAL and declared PARTIAL** for a specific reason: the timing control is whole
and adversarially tested, but NOTHING TRIGGERS A BUNDLE. A bundle exists only where a clinician
already knew to start one, which is precisely the population that was never going to be missed. The
patient this hazard is about is the one nobody recognised, and for them this control currently does
nothing. Also open: no notification transport, a caller-driven sweep, and no link to the eMAR, so
"antibiotics administered" is asserted by whoever records it rather than derived from an
administration event.

11 of 13 hazards verified, 2 partial. Scoring methodology and criteria unchanged.

STATUS: IMPLEMENTED and TESTED. NOT clinically validated, NOT clinically approved.

## Recognition: the interval between a machine noticing and a human deciding (2026-09-04)

HAZ-TIME-01 was declared PARTIAL with a specific reason: the timing of a bundle was trustworthy, but
nothing started one. A bundle existed only where a clinician already knew to open it, which is
exactly the population that was never going to be missed. `wardsynq/wardsynq-recognition.js` (17
tests) is that trigger, and the design decision worth not re-litigating is that **it does not start
bundles.**

A screen is not a diagnosis. qSOFA is specific and insensitive, NEWS2 is sensitive and non-specific,
and a system that opened a Code Sepsis on either would be diagnosing. Instead a positive screen or a
high NEWS2 raises a PROMPT that a named human must answer. Three properties a passive alert does not
have:

1. **The prompt is timestamped and immutable**, so the interval between the machine noticing and a
   human deciding becomes a measurable number. That interval is invisible in most hospitals, which
   is why nobody manages it. `recognitionStats()` deliberately reports the still-unanswered prompts
   too, because a median over only the answered ones is the flattering number and the wrong one.
2. **The prompt pins the bundle's time zero.**
3. **Declining is an answer and is recorded with its reason and its author.** A clinician who looks
   and decides this is not sepsis is doing their job, and that judgement is worth far more on the
   record than a dismissed alert. An unanswered prompt is the dangerous state, and it is the one
   that escalates.

**A real hole this exposed, and it was in the direction that matters.** The emergency module guarded
time zero against being moved EARLIER than its evidence. It did not guard the other direction, and
moving time zero FORWARD is what gaming actually looks like: it turns a two-hour wait into a
compliant one-hour bundle. An accepted prompt now sets `pinsTimeZero`, and time zero must equal the
evidence time exactly. The end-to-end test is the one that found it: a prompt raised at 02:10,
accepted at 03:45, and an attempt to open the bundle claiming recognition at 03:40. It is refused,
and the honest bundle is BREACHED before the first antibiotic is drawn up.

**Alert fatigue is real and is NOT solved here.** A prompt on every transient qSOFA of 2 would be
ignored within a week, and an ignored prompt is worse than none because it launders inaction into a
record of having been told. What this file does is deduplicate: one live prompt per patient per code,
a stronger signal supersedes rather than stacks, and an answered prompt suppresses repeats for a
refractory period. Whether the trigger threshold is clinically right is a decision this file cannot
make and does not pretend to.

HAZ-TIME-01 stays PARTIAL. The trigger reason is closed; what remains is that no notification
transport is shipped, the sweeps are caller-driven, and no bundle element is derived from a real eMAR
administration, so "antibiotics administered" is still asserted by whoever records it.

Also refreshed `vault/modules/WardSynQ.md`, which still said "P0 complete, unwired, 127 tests" and
listed the safety case and interop hub as unbuilt.

STATUS: IMPLEMENTED and TESTED. NOT clinically validated, NOT clinically approved.

## Obstetrics: paying off the second refusal (2026-09-04)

NEWS2 refused pregnant patients and pointed at a module that did not exist. Children got a module
when the same debt came up; pregnant women got a dead end. Refusing to score a population and
offering them nothing leaves that population LESS protected than before, not more, because the
refusal also removes whatever crude signal they were getting.

`wardsynq/wardsynq-obstetrics.js` (30 tests) is that module, and the design decisions are all
consequences of one physiological fact: a healthy young pregnant woman COMPENSATES EXTRAORDINARILY
WELL. Blood volume is up around 40 percent, resting pulse is up, blood pressure FALLS in the second
trimester. She can lose 1.5 litres with a pulse of 100 and a normal blood pressure and then
decompensate suddenly and late. A general early warning score here is not merely miscalibrated, it is
looking for a gradual curve this patient does not draw.

1. **MEOWS is trigger-based and returns NO TOTAL.** Not a re-skinned NEWS2. One red trigger, or two
   concurrent yellows, is the alert. A sum would give a low total to a woman with one catastrophic
   parameter and six normal ones, which is exactly the presentation that kills, so there is no
   number anywhere in the result that can be read as reassuring. A missing parameter never suppresses
   a red trigger either.
2. **The compensation warning is attached to EVERY result, including the calm ones**, because the
   reassuring result is the dangerous one.
3. **Pregnancy is a state with a postpartum day, not a boolean.** Most maternal haemorrhage deaths
   are postpartum, so a `pregnant: true` flag that flips to false at delivery would drop the guard at
   the moment risk peaks. The NEWS2 refusal was widened to match, and the test for it is the one that
   would have caught the original bug.
4. **A visual blood-loss estimate is an observation and never a measurement.** Visual estimation
   underestimates by roughly half, worst at the volumes where the decision changes, so a volume
   threshold on an estimate returns UNKNOWN rather than false, and the plausible true figure is shown
   alongside rather than silently substituted. An untrustworthy estimate PROMPTS: waiting for
   certainty is the error.
5. **No dosing at all, and magnesium sulphate deliberately.** The window between anticonvulsant
   effect and respiratory arrest is narrow, and an unapproved regimen in this file would be a direct
   route to a maternal death. A test asserts no bundle element label contains anything matching a
   dose.
6. **The obstetric bundles reuse the emergency module's clock** via its `definition` injection rather
   than growing a second timing implementation, so they inherit the immutable time zero and the
   ordered-is-not-given guard for free.

**An asymmetry fixed rather than declared.** NEWS2 gathered from observations with a freshness window
and the IoMT artefact filter; MEOWS took a plain values object, so a chart could be built over a
six-hour-old blood pressure or a detached lead with nothing to stop it. Rather than write that into a
caveat, the gatherer was extracted to `wardsynq-vitals.js` and both charts now use it. Two charts with
two ideas of what counts as a current observation is the same class of defect as two notification
paths with two definitions of delivery, which was last week's bug.

**HAZ-MAT-01 is VERIFIED, not partial**, and the distinction is deliberate: it claims DETECTION and
MEASUREMENT DISCIPLINE, and delivers both. It does not claim treatment. The trigger cut-offs are
UNAPPROVED and that matters more here than elsewhere, because MEOWS charts differ substantially
between units and a chart with the wrong cut-offs is worse than no chart, since it is trusted. Fetal
monitoring and CTG interpretation are not touched at all and this row must not be read as covering
them.

12 of 14 hazards verified, 2 partial. Scoring methodology and criteria unchanged.

STATUS: IMPLEMENTED and TESTED. NOT clinically validated, NOT clinically approved.

## Bundle binding: knowing versus being told (2026-09-04)

HAZ-TIME-01's last named reason was that "antibiotics administered" was asserted by whoever recorded
it. A bundle element completed by a human typing into a form measures whether the form was filled in.
Next door, `wardsynq-meds.js` already runs a state machine where ADMINISTERED is reachable only from
SCANNED, which means a nurse scanned a wristband and a product. That is a fact about the world.
`wardsynq/wardsynq-bundle-binding.js` (16 tests) connects the two.

**The design decision worth arguing about, because the obvious one is wrong.** The obvious move is to
make a derivable element UNCOMPLETABLE by hand: if the eMAR is the source of truth, refuse anything
else. That is dangerous here. During a haemorrhage or an arrest the eMAR may be down, the drug may
come from an emergency box, the scanner may be broken, and a system that refuses to let the team
record what they did is a system the team abandons mid-resuscitation. It would also fail the patient
in the only direction that matters: the drug was given and the record says it was not.

So manual completion stays, and the two are kept APART instead:

- **DERIVED**: the eMAR emitted an administration for this patient and this drug. We know.
- **ATTESTED**: a named human recorded it. We were told, by someone accountable.

Both complete the element; neither is called the other. `provenanceReport()` leads with the ratio,
and the ratio is the finding: a unit whose sepsis bundles are 100 percent compliant and 3 percent
derived is not measuring care, and nobody could see that before. A test constructs exactly that unit.

**A derived completion cannot be back-dated.** It carries the eMAR's own `administeredAt`, never the
time the event was processed and never a time a caller supplies, so the one route by which automation
could have made a bundle look faster is closed. An administration timed BEFORE the bundle's time zero
belongs to an earlier episode and is refused, because crediting a dose given before the patient was
even recognised would be free compliance.

**A defect in the canonical model, found by wiring this.** `MedicationAdministration` recorded only
its `orderId`, so an administration record could not say what drug was given without the order still
existing and being fetchable. That is a poor clinical record on its own terms, quite apart from
making the emitted `meds.administered` event non-self-describing. `drug` and `drugCode` are now
copied onto the record when it is opened.

**HAZ-TIME-01 stays PARTIAL, and the caveat now names the right reasons.** Two of its original
reasons are closed (nothing triggered a bundle; nothing derived an element). What remains: attestation
is still permitted by design, so a bundle can be compliant on claims alone and only the provenance
report will say so; ONLY medication elements can be derived, since lactate, ECG and cultures have no
binding to a laboratory or imaging result, which means most of a sepsis bundle is still attested; and,
unchanged and largest, no notification transport is shipped.

12 of 14 verified, 2 partial. Scoring methodology and criteria unchanged.

STATUS: IMPLEMENTED and TESTED. NOT clinically validated, NOT clinically approved.

## P2 begins: quality measures and incidents (2026-09-04)

### wardsynq-quality.js: the denominator is the attack surface

Quality measures are reported to regulators, published, and used to decide funding and careers, which
makes them the most incentivised numbers in the building. Numerator over denominator is trivial
arithmetic; everything that decides whether the number means anything is elsewhere.

1. **Nobody improves a mortality rate by falsifying deaths.** Deaths are hard to hide. They improve it
   by removing patients from the denominator. So every exclusion carries a reason, is counted BY
   reason, and travels with the rate in the same sentence. A test shows the same hospital with the
   same ten deaths going from 10 percent to 2.2 percent purely by calling eight of them palliative on
   admission, and shows the exclusion rate making it visible.
2. **"We cannot tell" is not "not eligible."** Missing data excluded as though it were a clinical
   decision is how an unmeasured cohort disappears, so the two are separate exclusion kinds.
3. **A small denominator is not a rate.** One death in three is not 33 percent mortality, it is three
   patients. Below the minimum the counts are still reported and the percentage is refused, because a
   percentage on a dashboard gets compared with one from a unit that had four hundred patients and
   nothing on the screen says they are different kinds of number.
4. **compare() exists in order to refuse.** A league table of unadjusted mortality is a picture of
   case mix that will be read as a picture of quality by people who act on it. No risk model is
   implemented, so no ranking is produced, and even a caller ASSERTING risk adjustment gets rows
   without an ordering, because this module cannot verify the claim.
5. **trend() refuses to draw a line across a definition change**, which would show a definition
   changing rather than care changing.
6. **Evidence quality travels with the number** via the bundle-binding provenance, and is deliberately
   NOT folded into the rate: two numbers that mean different things should not be averaged into one
   that means neither.

### wardsynq-incidents.js: the reports you never receive

An incident system's failure mode is silence, not a bad severity matrix. The reports that matter most
go unfiled for reasons entirely rational from the reporter's side.

1. **A near miss is the free lesson** and is reportable in a minimal form. Anonymity is a first-class
   choice, not a degraded one: it costs follow-up with the author and buys the report existing.
2. **Severity is the outcome, not the culpability.** The same syringe swap is a near miss or a death
   depending on luck the clinician did not control. SAC decides how much INVESTIGATION an event
   warrants; a test asserts no response string contains the language of blame.
3. **A person is never a root cause.** "Human error", "the nurse forgot", "non-compliance by staff"
   are refused, and the refusal says what to do instead, because a bare rejection just gets worked
   around. The question those phrases leave unasked is why the system made the error easy, likely, or
   invisible until it reached the patient.
4. **An incident cannot be closed on retraining alone.** Education and reminders are the most-chosen
   and least-effective response in patient safety: they ask the next tired person to be more careful
   in the same place and change nothing about the place. They are detected, not banned, and closure
   requires at least one action that changes the system.
5. **A CAPA with no owner and no date is a wish**, and "done" with no evidence is not done.
6. **The ledger leads with the near-miss ratio**, because that measures the health of the REPORTING
   system rather than the hospital. A unit reporting only harm is reported as a failing reporting
   system, not a safe one. A falling incident count is celebrated everywhere and is usually bad news.

Neither module gets a hazard row: they are governance and measurement, not clinical controls, and
inventing hazard rows for them would inflate the table with things that do not stop a patient being
harmed. The safety case stays at 12 of 14 with 2 partial.

595 tests across 23 suites. STATUS: IMPLEMENTED and TESTED. NOT clinically validated or approved.

## P2 continued: consent and research de-identification (2026-09-04)

### wardsynq-consent.js: a signature is not consent

Consent is a decision made by someone who understood the proposal, was told what could go wrong, knew
the alternatives including doing nothing, and was free to refuse. The signature is evidence a
conversation happened. This module makes it impossible to record the signature without the
conversation: consent is refused outright if the risks, the alternatives or the option of NO
treatment were not recorded. That last one is the most commonly omitted and is always available.

The asymmetry running through the file is that capacity is presumed and incapacity must be
demonstrated, because the failure modes are not symmetrical. Treating a capable adult as incapable
strips a right they have, and it happens overwhelmingly to the old, the disabled, the mentally ill,
and anyone who disagrees with their doctor.

1. **A refusal is never evidence of incapacity.** Disagreeing with the recommended treatment is the
   commonest trigger for a capacity assessment, and an unwise decision is a right capable people
   have. The two are recorded separately and neither is inferred from the other.
2. **A blanket "lacks capacity" flag is refused.** Capacity is decision-specific and time-specific: a
   person may lack it for cardiac surgery and retain it for a blood test. An assessment names its
   decision or it is not an assessment, it is a label that follows someone for years after the
   delirium resolved.
3. **A finding of incapacity cannot stand on a checkbox.** All four functional abilities must be
   answered and a reason is mandatory. An assessment with no decision-making support recorded is
   flagged as incomplete, since capacity is assessed AFTER support has been offered.
4. **A proxy decides for the patient, not for themselves**, and a valid advance directive OUTRANKS a
   relative who disagrees with it.
5. **Emergency treatment is never recorded as consent.** Passing NECESSITY as a consent basis is
   refused with a pointer to the right function, which records it as what it is and requires both why
   they could not consent and why it could not wait.
6. **Consent does not generalise, goes stale, and is withdrawable at any moment** including after the
   patient is on the table. Withdrawal deliberately requires no reason: requiring one would make it
   something to justify rather than a right exercised.

This module does not assess capacity, and says so in its own output. Any function claiming to would
be used to overrule people, which is why there is not one.

### wardsynq-research.js: the record that looks anonymous

The hazard is not failing, it is succeeding visibly and failing invisibly. The name is gone, the
record looks anonymous, and the person is still findable from date of birth, district and a rare
diagnosis. The output LOOKS safe, which is exactly why it gets shared.

1. **Safe Harbor is a floor, not a proof**, and nothing this module returns uses the word anonymous.
   The disclaimer travels with every release.
2. **k-anonymity catches what Safe Harbor passes**, and rows that fail it are WITHHELD rather than
   released with a warning, because a warning does not travel with the row once somebody opens the
   file in a spreadsheet.
3. **A rare diagnosis is an identifier.** There may be one patient in the state with it.
4. **Date shifting is per-patient and consistent.** Intervals within a patient survive, which is the
   research value; a single dataset-wide offset would let anyone who knows one real date recover
   every other.
5. **Free text is removed, never scrubbed.** A regex over a discharge summary produces text that
   looks clean and still names the daughter and the referring doctor.
6. **An unrecognised field is dropped, not assumed safe.** A failing test caught the corollary: a
   timestamp nobody listed in dateFields is an unknown field, so forgetting to declare it drops the
   date rather than releasing the real one.

One deliberate cost is now pinned by a test: the direct-identifier match is over-broad, so drugName
and testName are stripped as identifiers. Over-removal is recoverable because it is reported;
under-removal is not, because nobody looks.

Neither module gets a hazard row. They are governance, not clinical controls. Safety case holds at
12 of 14 with 2 partial. 639 tests across 25 suites.

STATUS: IMPLEMENTED and TESTED. NOT clinically validated, NOT legal advice, NOT certified against
HIPAA, the DPDP Act or any other regime.

## P2 complete: lineage, API governance, billing, population health (2026-09-04)

### wardsynq-lineage.js

The spec asks that a clinician can click any derived value and see the raw observations behind it.
Two properties carry the file. **Staleness propagates**: a NEWS2 calculated one minute ago on a
four-hour-old blood pressure is a four-hour-old assessment, and a display showing only the calculation
time lies by omission. **A rejected input is part of the lineage**: a score built from five values
after discarding a stale sixth is not the same fact as a score built from five, and the discarded one
is the first thing an investigation asks about. A missing input makes provenance INCOMPLETE rather
than partial-but-quiet. `impactOf()` answers the question asked after a mislabelled sample: not what
fed this, but what did this feed, and who acted on it.

### wardsynq-api-gov.js

This is where data leaves the building, so every control upstream is undone by one endpoint that
answers wrongly. **Scope is not access**: a valid, unexpired, correctly scoped token is still refused
for a patient the requester has no relationship with, and a gateway constructed with no relationship
check refuses every patient request rather than defaulting to allow. An unparseable scope invalidates
the SET rather than being dropped, since dropping it means proceeding on the rest, which fails open on
a malformed token. Expired means expired, with no grace window, because a grace window is a window.
Bulk is separated from single-patient: one chart is a clinical act and ten thousand is an export.
Webhooks carry an id and a type and never clinical content, because a webhook posts to a URL somebody
typed and no transport security helps once the payload is at the wrong address. `suspiciousClients()`
distinguishes a client walking a patient id space from one that is merely misconfigured.

### wardsynq-billing.js

A billing module inside an EMR is a safety module, and not for the obvious reason. The danger is not a
wrong bill; it is money starting to decide what the chart says. A record bent for a claim lies to
whoever reads it next, and that patient may be unconscious at the time. So:

**The clinical record is the source. Billing reads it and never writes to it.**

- a code with nothing behind it is REFUSED, not queried, because a queried code sits in a work list
  until somebody makes it go away and the cheapest way is to add the diagnosis
- an inferred code is surfaced as a question for a clinician, with the note "do NOT add it to support
  the claim"
- coding that CHANGES after a payer denial is flagged permanently and not blocked, because a genuine
  correction happens too; what matters is that "we found more documentation" can never be invisible
- `mayProceedClinically()` always returns true and takes no arguments. It exists so no caller invents
  its own answer, and so that removing the boundary means deliberately deleting a function whose
  comment says what it is for
- a refused pre-authorisation is recorded as a FUNDING decision that does not mean the treatment is
  not indicated

### wardsynq-population.js

Every other module reacts to a patient in front of somebody. This one is about the person whose HbA1c
was last checked nineteen months ago and about whom no alert will ever fire, because nothing is
happening to them. A care gap is an absence, so it is computed on a sweep rather than detected.

The suppression rules are the point. An outreach list is a list of people and contacting them costs
them something: a recall letter to a family who has just had a death is a cruelty the system caused.
Suppression is applied BEFORE the list exists rather than as a filter over one somebody could export
first, every applicable reason is returned rather than the first (one at a time invites clearing them
and re-running), and a decline PERSISTS, because re-detecting it monthly teaches people to ignore the
one letter that mattered. The list is ordered by clinical risk, never by how overdue anything is: the
largest overdue number and the sickest patient are rarely the same person.

None of these four gets a hazard row. They are governance, measurement and administration, not
clinical controls, and inventing rows would inflate the table with things that do not stop a patient
being harmed. Safety case holds at 12 of 14 with 2 partial.

P2 is now complete: quality, incidents, consent, research, lineage, api-gov, billing, population.
708 tests across 29 suites.

STATUS: IMPLEMENTED and TESTED. NOT clinically validated, NOT approved, NOT certified for any payer
or regulatory regime.

## P3: AI security and MLOps, and a real hole in a VERIFIED hazard (2026-09-04)

### The defect, first, because it matters most

Building `wardsynq-secops.js` required a test that assumed prompt injection SUCCEEDS and checked that
the model still could not commit an order. The test failed, and not for the reason expected.

`can()` read `actor.tier` directly. The AI ceiling was applied in `makeActor()`, so any actor object
that reached the authorisation check without passing through the factory held whatever tier it
claimed. `{kind: "ai", tier: "execute"}` was EXECUTE. That is not an exotic path: an actor gets
hand-built in a harness, deserialised from storage, or rebuilt across a process boundary as a matter
of course. **A ceiling enforced only at construction assumes every path went through the door.**

This sat inside HAZ-AI-01, a row already marked VERIFIED, whose entire argument is that an AI cannot
commit. The ceiling is now re-applied inside `can()` itself, `effectiveTier()` is exported so a UI
shows the truth rather than the claim, and five regression tests hold it, including a deserialised
actor and every non-human kind.

The row stays VERIFIED, and the caveat now records the defect. Finding a hole in a verified control
is the safety case working; hiding it afterwards would be the failure.

### wardsynq-secops.js

An LLM reading a chart cannot distinguish "the patient reports chest pain" from the same sentence
followed by an injected instruction, because both are text in the same field and the model was
trained to be helpful about both. So the defence cannot be the model's judgement: asking a model to
notice it is being manipulated is asking the compromised component to detect its own compromise.

- retrieved content is fenced with a PER-REQUEST nonce and labelled untrusted, so a note written last
  week cannot close this request's fence
- an unsigned document does not enter the context, because the attack is not a clever prompt, it is
  somebody writing a note into a chart and waiting for the summariser to read it
- a document that TRIPS the injection tripwire is still included, deliberately. Dropping it would
  make the tripwire the defence, and an attacker who reads the list simply would not trip it. The
  signals are evidence, not a filter, and the module says so.
- outputs naming another patient are withheld WHOLE, never redacted: a partially redacted leak is
  still a leak and looks safe
- the "signing" is a content DIGEST, named `digest` throughout and documented as not cryptographic,
  so nobody imports it believing otherwise

The module explicitly does not claim to prevent prompt injection. The design assumption is that
injection succeeds and the blast radius is bounded by the actor ceiling, which the model does not
control. That is why the ceiling defect above was the important find.

### wardsynq-mlops.js

Clinical AI does not fail loudly, it degrades, while the dashboard still shows the accuracy from the
validation set that has not changed.

- retrospective performance is accepted and immediately labelled as insufficient: it shows a model
  can fit the data it was built from
- shadow means the output reaches NOBODY. A visible shadow prediction is refused, because its
  evaluation would measure the behaviour it caused rather than the model.
- drift is checked on INPUTS, because outcome labels arrive weeks late and the input distribution
  shifts the same day
- a subgroup gap blocks deployment however good the aggregate: a 92 percent model with a 61 percent
  minority subgroup is not a 92 percent model, it is one that fails the people already worst served
- unlabelled predictions are not evidence, and are disproportionately the recent, sicker cases
- a breach WITHDRAWS the model automatically rather than raising a ticket, because a ticket leaves it
  running until somebody triages it and the meeting is next week
- a withdrawn model goes back through shadow, never straight to deployment, because the evidence that
  supported it was gathered on a population since shown to have changed

Neither module gets its own hazard row; both are evidence under HAZ-AI-01, which is where the AI
hazard already lives. 754 tests across 31 suites, safety case at 12 of 14 with 2 partial.

STATUS: IMPLEMENTED and TESTED. Not a security certification, and explicitly not a claim that prompt
injection is prevented.

## P3: simulation and chaos (2026-09-04)

Every test written before this one asks a module a question it was designed to be asked, which
catches the bugs somebody thought of. `wardsynq-simulation.js` (14 tests) generates load and disorder
instead, and asserts INVARIANTS rather than outcomes.

The distinction is the whole design. An expected-output assertion tells you the simulation ran as
written; an invariant tells you the system did not hurt anybody. The six are: no dose administered
without a scan, no record on the wrong chart, nothing silently dropped (every event applied or
quarantined with a reason), no duplicate applied twice, no critical loop closed without
acknowledgement, no clinical event applied with a future time.

1. **Seeded and deterministic.** A chaos test that cannot be replayed is a bug report saying "it
   failed once". Every report carries the exact call that reproduces it.
2. **The faults are Tuesday, not exotica**: the same event from two feeds eleven seconds apart, an
   arrival 15 minutes out of order, a day of clock skew, a truncated payload, a feed that stops
   mid-stream, a patient merged mid-episode, and a record carrying one patient's id with another's
   identifiers.
3. **The invariants are proven able to FAIL.** One test constructs a world that harmed somebody and
   asserts all six fire. An invariant that has never failed is decoration, not evidence.
4. **A naive handler is actually caught.** A second scenario runs a handler that applies everything
   and trusts the stated patient, and the run fails on cross-patient data. If chaos does not catch
   the obvious wrong implementation, it would not have caught a subtle one.
5. **A passing run says what it does not mean.** The report's own text states that it is evidence
   about one class of failure under one seed, is NOT evidence of safety, does not generalise, and
   must not be quoted without that sentence. That qualifier is attached to the PASS, which is where
   it is needed.

**The honest limitation, stated in the module header and asserted by a test.** This is
single-threaded and interleaves deterministically. That finds ordering assumptions and it does not
find data races. The spec's 10,000-patient figure is treated as a DATA VOLUME claim, not a
concurrency claim, and pretending otherwise would have been the dishonest part of the file.

Two test-side defects found and fixed while writing it, both mine rather than the system's: the event
bus dedupe option is `id`, not `idempotencyKey`, and my test had been silently passing an unknown
field so the storm test was not testing dedupe at all.

768 tests across 32 suites. Safety case at 12 of 14 with 2 partial.

STATUS: IMPLEMENTED and TESTED.

## End-to-end clinical scenarios, and the defect only they could find (2026-09-04)

Thirty-two unit suites each proved one module correct in isolation, which is exactly the shape of
testing that misses integration defects: every module is tested against the interface its own author
imagined. `test/wardsynq-scenarios.test.mjs` runs one patient through the whole stack with the
assertions placed at the SEAMS.

Scenario 1 is the complete journey: observations at 02:10, NEWS2 scores HIGH, a recognition prompt is
raised and nobody answers it, it escalates on its own, a clinician accepts at 03:45 with the delay
recorded as 95 minutes, the bundle refuses to start at a flattering time in either direction, the
antibiotic element is completed by an actual bedside scan through the real eMAR state machine, a
NORMAL lactate still completes its element, and the provenance summary reports two derived elements
and one attested. Every one of those handoffs is a place two modules could have disagreed.

The other scenarios pin seams that would be invisible in isolation:

- a postpartum woman is refused by NEWS2 AND accepted by MEOWS. Both refusing would leave her with
  nothing watching her, and neither suite could see that on its own.
- a child is refused by NEWS2 and by qSOFA, and neither refusal is allowed to read as reassurance
- an unscorable patient escalates for being unobserved and is NOT also raised as suspected sepsis,
  because double-counting one patient as two alerts trains people to ignore both
- a forged AI actor can draft and cannot commit, on this patient's live chart
- the number on the screen explains itself, including what it refused to use

**The defect.** The lineage scenario asserted a stale blood pressure would be rejected and it was
not, because `gatherVitals` guarded staleness and had no guard on FUTURE-dated observations. A
future reading is worse than a stale one: it WINS. "Latest reading" logic ranks it above the correct
current value, so the score is computed from a number describing a moment that has not happened. It
arises from ordinary causes, a device with a skewed clock or a feed with a timezone bug.

The sharpest part is that `wardsynq-simulation.js` already asserts `no-future-clinical-time` as an
invariant, and the gatherer sitting under two clinical charts was not enforcing it. A property named
in one module and unenforced in another is precisely what unit tests do not catch, because each file
is consistent with itself.

Fixed in `wardsynq-vitals.js`, which both NEWS2 and MEOWS go through, with three regression tests
including the boundary case that an observation timestamped exactly now is current rather than
future.

778 tests across 33 suites. Safety case at 12 of 14 with 2 partial.

## The bedside surface (2026-09-04)

`wardsynq/ui/opd.html`, `opd.css` and `opd-emr.js` are the mobile and tablet surface the spec asks
for. Three decisions worth not re-litigating:

**It is the same design system, not a second one.** `opd.css` imports `wardsynq.css` for its tokens
and adds only what a bedside needs that a desk does not. A separate visual language for mobile means
a nurse learning two products, and the one they use at 3am under pressure would be the one they know
less well.

**What changes at a bedside is safety, not style.** Targets are 56px rather than the 44px guideline,
because that guideline assumes a considered tap on a clean screen and this is a gloved thumb in a
corridor while somebody is talking. Nothing moves on its own: no toasts that leave, no reflow as data
arrives, and the scan-state line has its height reserved, because a screen that changes while a thumb
is descending is how the wrong button gets pressed, and here the wrong button administers something.
The workstation's signal column becomes a left edge mark with the same colours and the same rule that
colour is never the only carrier. An irreversible action gets more SPACE around it rather than being
made smaller or hidden behind a confirm.

**The logic holds no clinical rules at all.** `opd-emr.js` sequences the eMAR, the safety engine and
the governed store and renders what they return. There is no threshold, no dose limit and no
interaction rule in it, and there must never be: a rule duplicated in a view drifts from the engine
and the drift is invisible.

The properties the tests hold:

- opening a chart does NOT confirm identity, because opening a chart is something you can do from the
  corridor. Identity is the band on the patient in front of you.
- switching patient REVOKES the confirmation, since the commonest bedside error is the screen still
  showing the last patient
- the ACTION refuses without identity, not just the button. A caller bypassing the UI entirely still
  cannot administer, and the governed store would refuse it again underneath.
- a five-rights failure is rendered IN FULL. Truncating a refusal to fit a phone is how "blocked"
  becomes "the app is broken" and then becomes a workaround.
- a refusal must be acknowledged explicitly, because one that fades was never read
- offline work is durable BEFORE the screen says it was recorded
- a GOVERNANCE refusal is not journalled as though it were a connectivity problem, which would retry
  a write the system has already decided is not allowed

Two smaller things the tests pin: a signalled row cannot be constructed without a word, so no view
can render colour alone; and a value of 0 renders as "0" rather than vanishing, because 0 mL/h urine
output is the important one.

**It is deliberately not reachable.** No route, not in the www/ build, and `opd.html` carries no
script tag: the logic is tested and the renderer is not written, and wiring a half-built view to a
live medication path would be worse than leaving it unwired. That is stated in the file rather than
left for somebody to discover.

794 tests across 34 suites. Safety case at 12 of 14 with 2 partial.

## The ICU flowsheet: the running total that is quietly wrong (2026-09-04)

`wardsynq/wardsynq-flowsheet.js` (35 tests). The flowsheet is the densest document in a hospital, and
the danger is not in its cells: ICU prescribing is done off its running TOTALS, and a total looks
equally authoritative whether or not the hours underneath it are complete.

1. **A missing hour is not zero.** The same defect as a missing NEWS2 parameter, and worse here
   because it compounds. If nobody charted output between 03:00 and 06:00, a balance that sums what
   it has is wrong by exactly the amount nobody knows, and that is the number a consultant reads at
   08:00 before prescribing diuresis. Every balance names the missing hours and states that the true
   figure differs by whatever was not charted. An hour with intake charted and output blank is NOT a
   complete hour, which is the commonest shape of the gap.
   The numbers are still returned, deliberately: suppressing them pushes a nurse to add it up on
   paper, which is worse. What is refused is calling it a balance.
2. **The hour is a bucket, not a timestamp.** `observedAt` and `chartedAt` are both mandatory, and
   BACKFILLED is computed from the lag rather than declared by the caller, so it cannot be omitted
   by someone in a hurry. An entry written six hours late that looks identical to one written on
   time is a clinical and a medico-legal problem. The grid surfaces backfilling at the TOP, because
   the pattern is the signal: one late row is a busy hour, a whole shift of them is a shift where
   nobody was charting.
3. **An infusion volume is an integral, not a multiplication.** Current rate times elapsed time is
   the obvious implementation, is wrong for every patient whose rate was ever changed, and
   under-reports a weaned vasopressor. A test pins the exact wrong answer it would have given.
4. **The weight is the input everybody forgets is an input.** A weight-based rate refuses without
   one, flags an implausible one through the paediatrics sanity check, and carries its workings, so
   a cell can be traced to the three numbers behind it, one of which somebody typed.
5. **SET and MEASURED are different kinds, not a flag.** A set PEEP of 8 against a measured 12 means
   the patient is doing something, and a chart holding one number per row cannot show it.
6. **An empty cell stays empty and is counted.** Rendering a blank as a zero is the display half of
   the missing-hour problem: it looks complete.

**A trap removed rather than documented.** `recomputeAfterCorrection()` first took the entry set
before and after the correction, and a test caught that as a trap: `correct()` marks the original
superseded IN PLACE, so a caller holding one array across the call holds the same mutated objects and
both totals come out identical. It now takes the correction itself and derives the before-state, so
it cannot be got wrong.

**HAZ-FLUID-01, marked LOCAL and declared PARTIAL** for one specific reason. A correction now reports
exactly which totals changed and flags the case that is not merely arithmetic: a balance crossing a
line somebody prescribes against is stated as "read negative and now reads positive", not as "360 mL
smaller". What stays open is the half that matters most. The consultant who prescribed at 06:00 off
the wrong figure is still not notified when it is fixed at 08:00, because nothing in this build
records that a total was READ. That needs a view log, which does not exist, and the function says so
in its own output rather than letting its absence imply otherwise.

Also unbuilt and stated: nothing gates prescribing on an incomplete balance, deliberately, since a
system that blocked a consultant from reading a partial total would be worked around on paper. That
means the honesty is advisory.

Safety case now 12 of 15 verified, 3 partial. The row was added because the omission was real and it
lowered the fraction, as the other two local rows did.

829 tests across 35 suites. STATUS: IMPLEMENTED and TESTED. NOT clinically validated or approved.

## The WardSynQ mark, and three palette defects it found (2026-09-04)

The owner supplied the logo. Wiring it in was meant to be chrome work and turned into a palette audit,
because measuring the brand against the existing tokens required measuring the existing tokens.

### The asset

Sampled brand navy is **#1c3048**. The supplied master was 669x373 with the artwork occupying
522x122, so 94 percent of what every viewer would download was transparent padding, and background
removal had left a fringe of near-navies (1c3048, 1b2f47, 1c3049, 1d3149 all appear in it).

Assets are trimmed, then repainted to one exact navy with alpha as the shape. That removes the
fringe, makes the mark crisp at small sizes, lets the files compress as flat shapes rather than as
photographs (57 to 62 percent smaller), and, most usefully, makes them RECOLOURABLE, which is what
lets dark mode use the same file rather than a second one that can drift.

`wardsynq-lockup.png`, `wardsynq-mark.png`, icons at 512/192/180/32, and a webmanifest. 108 KB total.
An SVG master should still come from whoever drew it: these are raster derivatives of a raster file,
and no attempt was made to trace the artwork, because a redrawn logo that is subtly wrong is worse
than a PNG.

### Three defects, all found by measuring rather than by looking

1. **`--ink-3` was below AA in BOTH palettes.** 3.98:1 on white, 3.90:1 on the dark raised surface.
   The metadata grey is still text somebody has to read. Darkened to #5f6965 and #828d89, hue kept.
2. **`--brand` had no dark-mode value at all.** The dark block redefines every other token, so the
   light navy would have inherited into it and sat on #1a211f at under 1.5:1. That is a mark nobody
   can SEE rather than a mark that looks wrong, so nobody would have reported it. Dark mode now gets
   a lifted navy, and the asset's flat-colour-plus-mask construction is what makes recolouring it
   possible.
3. **The dark stop and major signals were 32 degrees of hue and 1.21:1 of lightness apart**, which is
   closer than the light pair. Nudged the dark amber to #dcb45a: 35 degrees and 1.41:1, still 8.37:1
   on the darkest surface. The threshold was NOT loosened to make the test pass.

### Two brand rules, derived from measurement and enforced by a test

- **`--brand` is not a text colour on a light surface.** Against `--ink` it is 1.37:1, so navy words
  beside near-black words do not read as a deliberate accent, they read as two inks that do not
  match. The mark carries the brand; the words carry `--ink`.
- **Nothing signalled ever sits on a `--brand` fill.** Every signal lands between 1.63:1 and 2.15:1
  against navy, so a smart-looking navy header bar with a status chip in it would fail all four at
  once, and would fail them while looking considered.

### test/wardsynq-brand.test.mjs

The palette is now parsed out of the real stylesheet and the ratios are COMPUTED, per palette. This
project has already shipped two contrast defects, a drug name at 1.2:1 and a disabled button at
1.85:1, and both were found by staring at a screenshot. A comment in CSS claiming a colour is AAA is
a claim; this is a measurement that fails when somebody nudges a hex.

Two of its own tests were wrong first and both are recorded in the file rather than quietly fixed:
the parser took the last definition of each token and was therefore measuring the dark palette while
believing it was measuring the light one (which is how defect 2 surfaced, underneath the nonsense),
and the distinguishability test compared signals by contrast ratio, which is the wrong measure for
telling two colours apart. It now requires hue OR lightness separation, because red and amber are
adjacent hues in every clinical palette ever drawn and are told apart by lightness, while slate and
green are the mirror case.

### Placement

The mark is chrome. It sits above the clinical content and never inside it, it is `aria-hidden`
because a screen reader announcing "WardSynQ logo" before every ward round is noise, it is the first
thing hidden on a short viewport, and on the bedside header it disappears entirely when identity is
unconfirmed, because that warning needs the width. It is kept for print, where a chart that does not
say which system produced it is a page somebody has to identify by hand.

843 tests across 36 suites. Safety case unchanged at 12 of 15.

## A to Z: the five things that were left (2026-09-04)

Five items, each of which was a named gap in the safety case rather than a new feature.

### 1. wardsynq-transport.js — actually telling somebody

Three hazards had been PARTIAL for one reason: escalations computed correctly and delivered to
nobody. The distinction this file exists for is that SENT, DELIVERED and SEEN are three different
things and most systems have one. A webhook returning 200 means a server accepted bytes; calling
that delivery is how a hospital comes to believe in an escalation path nobody has ever been paged
by. Only a NAMED HUMAN acknowledging moves a notice to SEEN, and `outstanding()` deliberately
includes the delivered ones, because a dashboard counting only failures shows zero while the pager
lies face down on a desk.

The outbox is written BEFORE any transport is attempted, so a crash mid-send leaves "we decided and
do not know whether it went", which is recoverable; the reverse order leaves nothing. The ladder
stops at the first CONFIRMED delivery, not the first non-throw, because paging four people for one
patient is how a ward learns to ignore the fifth. A channel that has never carried a message is
UNVERIFIED rather than assumed healthy, and `verify()` is how a site proves one works without
waiting for a real patient: an integration that broke three weeks ago looks exactly like one that
works.

`SweepDriver` closes a separate defect nobody had named: every monitor in this build had a correct
`sweep()` that nothing ever called on a timer, which is a re-escalation ladder that never
re-escalates.

### 2. wardsynq-pews.js — the third refusal, paid off

NEWS2 refused every patient under 16 and named PEWS, which did not exist. A refusal pointing at
nothing leaves that population LESS protected, because it removes the crude signal too. The first
test is the whole argument: a pulse of 150 is unremarkable at four months and peri-arrest at
fourteen, so one set of bands cannot serve both.

Neonates are refused, because a neonatal chart is a different instrument and that population is
where a wrong score does most harm. A FALLING respiratory rate scores harder than a rising one,
since a tiring child's rate falls as they decompensate and rate alone inverts at the worst possible
moment. Parental concern is a scored parameter that can escalate a child whose numbers are all
normal, which is what happened in most of the cases that generated the literature.

### 3. wardsynq-readlog.js — telling the person who prescribed on the wrong number

Every correction path could say WHAT changed; none could say who acted on the old value, because
nothing recorded that anybody read it. The output is a list of PEOPLE, not a count of totals:
"three totals changed" is not actionable and "Dr Shah read the 06:00 balance at 06:12 and it was
wrong by 360 mL" is. Only readers of the superseded version, only from before the correction, and
the person who ACTED on it is named first.

A value merely rendered on a page is not a read. The log is retention-bounded and states its purpose
on every entry, because a record of who looked at what is also a surveillance tool, and used as one
it will stop people opening things.

### 4. HMAC-SHA256 in wardsynq-secops.js

The old function was a 64-bit FNV-ish hash documented as NOT cryptographic. The note was honest and
keeping the function was still wrong: a field called "integrity" gets relied on regardless of the
comment beside it. With no implementation wired it now REFUSES to hash rather than falling back,
because a silent downgrade is worse than a loud failure. A document carrying the previous build's
digest is refused as LEGACY, since honouring it is how a deprecated primitive outlives the decision
to deprecate it. It is a MAC and not a signature and the naming keeps that: it cannot say WHICH key
holder, so it does not attribute authorship.

### 5. Reachability: renderer, offline shell, build

`opd-render.js` draws the surface `opd-emr.js` had been waiting for, holds no clinical rule, and is
a pure function of `session.state()` so the screen cannot keep showing a confirmation the system
revoked. It also populates the read log on OPEN, which is what made item 3 real rather than proven
and unpopulated.

`wardsynq-sw.js`'s one important rule: a stale APP is fine and stale CLINICAL DATA is not. The shell
is cache-first; anything clinical is network-first and returns a 503 saying so rather than a cached
body, because a cached potassium rendered without its age is the exact hazard every gatherer in this
build refuses at the other end of the pipe.

`build-www.sh` ships wardsynq/ whole, and both the script and the markup state that shipping the
files does not make it reachable: nothing links to it, no flag turns it on, and the page does not
boot itself, because a page that constructed its own actor would be a page deciding who may give a
drug.

### Where that leaves it

921 tests across 41 suites, 39 modules. Safety case 13 of 16 verified, 3 partial, and all three
partials now name SMALLER reasons than before:

- HAZ-DET-01 and HAZ-TIME-01: the transport seam, outbox, ladder and driver exist; no real pager,
  SMS or phone system is integrated, and every shipped adapter reaches only somebody already looking
  at a screen.
- HAZ-FLUID-01: the correction-to-reader chain is proven end to end and populated only where a
  bedside row is opened, because the FLOWSHEET still has no renderer.

None of that is dishonest bookkeeping: each partial is a control that works and cannot yet reach far
enough, which is a different thing from a control that does not exist.

## The GHIS cut-over, and the last renderer (2026-09-05)

### The cut-over, approved by the owner

GHIS is now a real adapter on the live path, feeding the canonical model and the event bus. The
design decision worth not re-litigating is what it does NOT do: it does not rewrite
`ingestFromWard`. That function guards cross-patient contamination, preserves manual overrides
against ward values, and writes a STATE object read at more than twenty sites in icu.js alone.
Replacing it in one step would put a live mobile app behind a code path that has never rendered a
ward round, in exchange for tidiness.

So it is a strangler fig: the legacy path keeps owning STATE and every screen that reads it, and
the adapter takes ownership of the canonical model alongside it. Two consumers of one bundle, the
new one authoritative for everything built after it. The duplication is real and is the price of
not breaking a working ward round.

The properties, in the order they matter to a clinician holding the phone: the legacy result is
computed FIRST and returned untouched, so enabling the flag cannot change what the app displays;
the adapter path can never throw into the caller, and an exploding adapter, a full disk, a
rejecting async write and a downed bus are each a number on a report rather than a broken round;
there is a kill switch that works in-process with no reload; it is idempotent on the source's own
event identity; and it writes as an ADAPTER actor, so it is capped at DRAFT by the existing actor
model rather than by anything re-implemented here.

**What "approved" means.** The owner approved an ARCHITECTURAL cut-over, which is theirs to give.
It is not clinical approval. Every rule pack remains UNAPPROVED seed content awaiting pharmacy and
the relevant committees, a test asserts the cut-over's own report says so, and the flag still
defaults OFF.

### The flowsheet renderer

The last named reason HAZ-FLUID-01 was partial. The renderer holds no arithmetic and decides only
how honesty is displayed, which turned out to be most of the work: an empty cell renders blank
rather than as a zero or a dash, because at a glance those are the same mark; a half-charted row
states "3 of 6" beside itself so it cannot look complete; a backfilled entry is marked rather than
rendered identically, which would launder the difference; and the incompleteness of a total sits in
the same sentence as the number, because a qualifier in a tooltip is one nobody reads at 08:00.

Opening a balance records a read. HAZ-FLUID-01 moves to VERIFIED: every clause of its stated
requirement is met and adversarially tested, so the adequacy cap comes off. The deliberate
non-gating stays in the caveat.

### A race, found and closed

The full suite failed once and could not be reproduced in thirteen further runs. Rather than
shrugging, the cause was located: the ghis-live tests used `setTimeout(0)` to let promise chains
settle, which does not guarantee that a `.then()` on an already-rejected promise has run. Now
`setImmediate`, which fires after the microtask queue drains. A racy assertion in a clinical safety
suite is worse than a failing one, because it gets re-run until it passes.

956 tests across 44 suites. Safety case 14 of 16 verified, 2 partial, both waiting on a real pager.

## 2026-09-05 — Shadow mode watched a door no ward sync walks through

The observer was wired to `ICU.ingestFromWard`, and `wardsynq-shadow-boot.js` claimed on that basis
to observe the real GHIS sync. It did not. `ghis-ward.js:685` reads

    var res = (ICU.ingestWardHistory ? ICU.ingestWardHistory(...) : ICU.ingestFromWard(...));

`ingestWardHistory` exists on every current build and is a separate function that does not call
`ingestFromWard`, so the fallback branch is dead on a current device. Shadow mode ran through a real
ward sync on a real iPhone and reported `bundlesSeen: 0`.

Two decisions follow.

**The observer covers every door, not the one it was written against.** `installShadow` now takes a
`method`, and the boot installs on both `ingestWardHistory` and `ingestFromWard`. The caller picks
which entry point it uses; an observer that assumes one has assumed the caller's implementation.
`SMD_WARDSYNQ_SHADOW` became a combined view with a `byMethod` breakdown, because `installShadow`
assigns that global unconditionally and a second install would otherwise have hidden the first —
the same class of silent-masking bug.

**`clean` now requires `observed`.** The old report returned `clean: true` for an observer that had
never been handed a bundle: no errors and no disagreements, because nothing had happened. That is
how a mis-wired observer passes for a working one. Absence of findings is not a finding of absence,
and a readiness signal that fires when nothing ran is worse than no signal.

Worth recording about how it was found: this was invisible to the unit tests, which called
`ingestFromWard` directly and so tested the observer against itself rather than against the caller.
It took putting it on a ward with real traffic. It is the first thing shadow mode found, and what it
found was shadow mode.

## 2026-09-05 — One orchestrator over the existing transport, and what it deliberately did not do

Nine PRs (#835, #836, #838-#843, #845). The through-line is that almost none of it was new
machinery: the transport, the event bus, the push infrastructure and the three clinical monitors all
existed, and what was missing was the connections between them and honesty about what a connection
proves.

**One state machine, not a second notification system.** `wardsynq-orchestrator.js` owns no outbox,
no ladder, no channel and no delivery vocabulary. Duplicating those would have produced two systems
with two ideas of what "delivered" means, which is the exact failure `wardsynq-notify.js` was written
to end. What it adds is ONE identity for a clinical alert across every channel, and one place that
decides the alert has been answered.

**The transport bends to the clinical modules, not the other way round.**
`wardsynq-deterioration.js`, `wardsynq-recognition.js` and `wardsynq-emergency.js` each had their own
payload shape before the orchestrator existed. All three are byte-identical after this work, verified
by `git diff`. The adapter reads three shapes explicitly, one branch each, because a generic
extractor would silently mis-address the day a fourth appears. Reshaping three tested clinical
modules to suit one transport would have been the wrong direction of dependency.

**A re-escalation is not a repeat.** The escalation's tier became the notice sequence. Keying only on
the alert would have made the registrar's page silently return the ward nurse's ignored notice, and
answering any one notice answers the alert so the consultant is not woken for something already
taken. The same reasoning gave a bundle element's warning and its later breach one identity derived
from patient, code, TIME ZERO and element — the same element on a later episode is a different
clinical fact.

**Absence of findings is not a finding of absence.** Two separate controls were changed for this.
Shadow mode's `report().clean` was true for an observer that had been handed nothing, which is how an
observer wired to the wrong function passed for a working one; `clean` now requires `observed`. And a
push accepted by APNs is SENT, never DELIVERED — only the handset's own receipt promotes it. In the
live demonstration the escalation correctly read `delivered: false` after the gateway accepted it for
4 of 11 devices.

**A screen whose only exit is accepting responsibility gets answered by whoever is nearest.** The
forced acknowledgement screen has two answers and only one closes the loop. "I cannot attend" posts
no acknowledgement and leaves the escalation outstanding so the ladder finds somebody who can.

**An unconfigured surface must not look like a working one.** The bedside page previously drew a
wristband field and three live-looking buttons with no system behind them. `opd-boot.js` requires
store, actor and eMAR from the deployment — the page still names nobody, per the earlier decision
that a page constructing its own actor would be a page deciding who may give a drug — and paints an
explicitly disabled "not connected to a patient record" state otherwise.

**Three defects were found only by real hardware**, and each had passed its unit tests: the shadow
observer watched `ingestFromWard` while `ghis-ward.js` calls `ingestWardHistory`; APNs and FCM
dropped every custom key, so an escalation reached a phone that could not say which escalation it
was; and a Debug build's sandbox token was pruned by a production-host rejection, which looked
exactly like a broken push system. The lesson is not "write more tests" — the mocks were faithful to
the contracts they modelled. It is that the contracts themselves were wrong, and only the real thing
said so.

**Nothing here moved a safety-case rating.** 14 of 16 verified, 2 partial, unchanged across all nine
PRs. HAZ-DET-01's remaining blocker is the resuscitation committee approving the escalation policy;
HAZ-TIME-01's is that attestation is permitted by design. Working transport is not an approved
policy, and a demonstration on `DEMO-PAT-1` is not a patient.

## 2026-09-06 — The record leaves the browser: a server-side WardSynQ Clinical Record Service

The audit of 2026-09-05 found the decisive gap: WardSynQ had every part of a clinical core and no
record. `wardsynq-store.js` offered memory and IndexedDB only, so the product model (hospital PC and
StewardMD Mobile as two interfaces to one record) was impossible, and SCCM and the WardSynQ model
overlapped with nothing saying which was the record.

**Decision: the WardSynQ canonical model is the clinical record; SCCM is the ingest wire format.**
They meet in one adapter (`wardsynq-sccm-adapter.js`) and nowhere else. Neither was rewritten.

**Decision: reuse the store and the governance, do not port them.** The server runs the SAME
`ClinicalStore` and `GovernedStore` per request over a `TenantBackend`. There is no second
implementation of versioning, append-only history or the actor ceilings to drift from the first.
This is also why `functions/` now imports from `wardsynq/`, which had no precedent; `wrangler pages
functions build` proves it bundles.

**Decision: a persistence PORT, not a database.** Eight methods (`functions/_wardsynq/repository.js`),
D1 behind it today, a reference in-memory one for tests, on-prem a sibling file nobody has written.
Managed India-hosted, hospital-controlled and hybrid are then deployment choices, not rewrites. Stated
plainly: only D1 exists.

**Decision: concurrency is two layers, and the loser is told.** `expectedVersion` on the API refuses
a stale write with the current record; the UNIQUE (tenant, type, id, version) key catches the race
the check cannot see. Nothing merges silently; the existing Reconciler resolves with a person.

**Decision: authority follows provenance, in both modes.** A record whose latest version came from
another system cannot be overwritten natively, whether the hospital is on Epic or on WardSynQ. This
is what "the existing EMR remains authoritative for the data it owns" means as code. Integration
mode adds only that the external EMR creates the masters. Neither is a clinical rule.

**Decision: PHI stays clinician-only.** `record:read`/`record:write` were added to the Connect RBAC
matrix for clinician (and super-admin, who is then built READ-tier). Owner, admin, auditor: no chart.
The pinned matrix test was updated deliberately, with the reason in the test.

**Not decided, on purpose:** which of the 18 queue roles map to which actor tier; whether the
workstation's demo cohort view model (labs with ranges, med sigs) should become a canonical
projection; write-back to an external EMR. Each is the next build or a committee's, not this one.

## 2026-09-06 — Eighteen roles, one ladder: the operational roles reach the clinical record

The record service shipped with only Connect membership at its door, which has no nurse and no
receptionist. The hospital's real staff registry is `_queue_roles.js` + `q_members`, decided by
`authorizeOrg()`. Wiring it in was the prerequisite for any OPD write to move.

**Decision: derive the grant from capabilities, not from role names.** `emr.treat` → EXECUTE on
everything; `emr.vitals` without it → EXECUTE on Observation only; `emr.view` → READ; `order.read` →
READ on orders; nothing → no actor. The owner's non-negotiable ("a nurse may record vitals but never
treatment/prescriptions") was already a fact about capabilities, so the record inherits it instead of
restating it. A nineteenth role gets the right grant by holding the right capabilities.

**Decision: scope is a field on the actor, enforced in the same place as everything else.** Rather
than a second check in the service, `authoriseWrite` gained `SCOPE_DENIED` and `GovernedStore` reads
gained `READ_SCOPE_DENIED`. Actors built without scope are unchanged (null = every type), which is why
36 existing actor tests and every hub adapter kept passing without edits.

**Decision: a nurse is EXECUTE, not DRAFT.** Her observation is a committed clinical record. What she
may not touch is decided by scope; what she may not sign is decided by the absence of a credential.
Making her DRAFT would have labelled every vital sign a proposal.

**Decision: the OPD role wins over Connect membership when both exist.** Least privilege, and the OPD
org is where the hospital actually manages its people.

**Decision: AI acts as itself.** `origin.kind === "ai"` or `aiDrafted: true` makes the writer an
AI-kind actor with `onBehalfOf`. A doctor's token is a session, not an authorship claim. The
alternative, stamping the doctor and keeping a flag, is exactly the field-is-not-a-control failure the
actor model was written to end.

**Left as is, and named:** `admin` writes as a doctor because the existing matrix grants it
`emr.treat`; a staff PIN session cannot sign because a PIN carries no registration number; the
queue's room/department scope (`withinScope`) is not applied to the chart, since a chart is a patient
and not a room.

## 2026-09-06 — The first write moves: nurse vitals, per tenant, three modes

The smallest real clinical write, chosen because it exercises the nurse grant end to end and needs
nothing not already built.

**Decision: dual-write with a per-tenant mode, not a cut-over.** `off` leaves the handler
byte-identical. `shadow` writes the timeline first and reports the record's outcome. `authoritative`
writes the record first and fails the save if the record refuses. The timeline is never removed:
every OPD screen reads it, and a mode is a setting, not a deploy.

**Decision: structured values from the form, not parsing the text.** The console already had the
fields; sending them alongside the text costs nothing and avoids inventing a parser whose mistakes
would become clinical values.

**Decision: as reported, coded, no conversion.** LOINC codes, UCUM units, Fahrenheit stays
Fahrenheit. A unit conversion is a place to be wrong silently; the GHIS adapter took the same
position for the same reason.

**Decision: no Patient record from a vitals write.** The nurse's grant is Observation only and the
ticket has no demographics. Observations file under `opd-pat-<mrn>`, which the registration
migration will also use, so they attach to the master the day it exists. A ticket with no MRN is
refused rather than given an invented patient.

**Not done:** the doctor's writes (investigations, prescriptions, assessment) still go to GHIS; the
record is not read back into any OPD screen; the safety engine is not wired to these observations.
`WARDSYNQ_RECORD` stays OFF and the production schema unapplied.

## 2026-09-06 — The doctor reads the record: vitals on the ticket, through the record's own door

**Decision: the console reads the record directly, not through the queue API.** The timeline GET
only says WHERE the record is (`record: {tenantId, patientId}`), and only when the tenant is on.
The console then calls the record's existing Observation endpoint with the credentials it already
holds. Proxying through the queue route would have made the queue's EMR_VIEW the authority over the
clinical record, which is a second door with a weaker lock; this way a pharmacist who can open the
notes drawer still cannot see vitals, because the record refuses them, and a tenant elsewhere gets
403, because the record scopes by membership.

**Decision: alongside, not instead.** The timeline keeps its text line; the record card shows the
values. Two facts from one save are two facts. When a tenant is in `shadow`, a doctor can see both
and judge them against each other before the tenant flips to `authoritative`.

**Decision: every failure state is a clinical sentence.** "Could not reach the clinical record.
Showing the visit timeline only" is what a doctor at 3am needs; a spinner that never ends, or an
empty card that looks like "no vitals", would each be read as a clinical fact.

**Not done:** the doctor's own writes still go to GHIS; the safety engine does not read these
observations; no Patient master is created; `WARDSYNQ_RECORD` stays OFF and the schema unapplied.

## 2026-09-06 — Patient registration: the master the vitals migration was missing

**Decision: the MRN allocator is untouchable, so "authoritative" cannot mean what it meant for
vitals.** A vitals save can be retried with no consequence; an MR number, once handed out by the
atomic per-org counter, cannot be handed back. Vitals' authoritative mode puts the record first and
only writes the timeline if it accepts; registration cannot, without redesigning the allocator into
something reversible, which is out of scope and would itself need its own careful design. So
Firestore/GHIS registration runs first in EVERY mode, and authoritative only changes whether a
record refusal is reported to the desk or swallowed. Documented as a real limitation, not hidden
inside "same pattern as vitals."

**Decision: the id mapping moves to a shared module.** `opd-pat-<mrn>` was private to
migrate-vitals.js. Extracted to `opd-identity.js` so registration and vitals are provably the SAME
function, not two copies that happen to agree — the whole point of doing registration at all was so
vitals would have a real Patient to attach to, which only means something if the id is guaranteed
identical.

**Decision: QUEUE_ADD earns Patient-write, not a special case.** Reception's own capability list
already says what she does: "register / walk-in a patient." The actor grant was silent on it only
because nothing had asked the record to create an identity yet. Extending `grantForCaps` by one
capability, unioned onto whatever the EMR capabilities already granted, keeps the whole mapping
capability-derived rather than adding an if-role-is-reception special case.

**Decision: same-MRN re-registration is a version, never a merge.** The id is deterministic from
the MRN, so there is no code path that could combine two DIFFERENT mrns into one Patient. What DOES
need an explicit governed step, and is explicitly NOT built here, is the provisional-to-real MRN
promotion (`linkHospitalMrn`) — a genuine identity link, left for its own migration.

## 2026-09-06 — The doctor's assessment: SOAP structure over a 90-field GHIS form, not a second model

**Decision: group into the model's own SOAP hint, do not transcribe the GHIS schema.** The canonical
`ClinicalNote.sections` docstring already says "e.g. {subjective, objective, assessment, plan}" — an
open shape, not an enforced one. Reproducing GHIS's ~90 bespoke intake fields as WardSynQ fields
would BE the second model the task forbids, since those names belong to one hospital's form, not to
a clinical concept. Four SOAP keys for the universally meaningful subset, `sections.raw` carrying
everything else verbatim, so the grouping is honest about what it groups and does not discard the
rest under the excuse of "it's structured now."

**Decision: reuse the vitals seam exactly, do not add a second hook point.** The doctor's real
clinical write already lands in GHIS through a separate file this migration never touches; the ONLY
integration point available, before or after this work, is the same `addToTimeline` → `POST
/api/queue/timeline` call vitals uses. Extending that one branch (dispatch on `kind`) rather than
adding a second endpoint keeps the whole "one clinical write, one place it enters WardSynQ" property
vitals established.

**Decision: one id per encounter, versioned — the SAME concurrency answer as registration.** A note
is not a log of separate entries; it is the ONE evolving document for a visit, exactly as GHIS itself
treats its Initial Assessment before "Authorise" locks it. `expectedVersion` is therefore the right
concurrency control here too, not a fresh id per save (which would have made "amendment" and
"overwrite" indistinguishable) and not a merge (which would have made concurrent edits invisible to
each other).

**Decision: generalise the GET's record-link, don't special-case a third resource type into it.**
The alternative — asking "is vitals on, OR is registration on, OR is assessment on" — grows one
clause per future migration. `recordLinkForOrg` answers the real question (can this tenant's record
be read at all) once, and each migration decides for itself, independently, what to WRITE.

**Decision: make `authoritative` honest on the client, minimally.** `addToTimeline`'s fetch had no
`.then()` at all — even an HTTP error vanished silently. Claiming an authoritative mode exists while
a refusal could never reach the doctor would be exactly the kind of claim this project does not make.
One additive check, one toast, fires on nothing today.

## 2026-09-06 — Sign-off: a signature is the signer's own id, and tracing it found a defect

**Decision: model the lock with the field the model already has, and the rule the actor model
already enforces.** `ClinicalNote.signedBy` existed; `authoriseWrite`'s three signature refusals
existed. Sign-off is a new version of the same note with `signedBy` = the authenticated actor's id,
and nothing else — no "locked" flag, no GHIS display name copied in as if it were an identity. The
PIN-session doctor who cannot sign is refused by `NO_CREDENTIAL`, exactly as she is for a
prescription; nothing new was written to make that true.

**Decision: a save and a sign-off are distinguished by an explicit flag, never by kind alone.** Both
arrive as `kind:"assessment"` on the same endpoint. Without `signOff: true` the previous migration
would have treated the Authorise as a content save with no content and wiped the note's sections.
Found by tracing the call site, not by a bug report — which is the argument for tracing every call
site of a hooked endpoint before declaring a migration done. The content path now also refuses to
write with no fields at all, so the class of defect is closed, not just this instance.

**Decision: signed means closed.** GHIS locks its form on authorise; a WardSynQ note that could be
re-saved after signing would make `signedBy` decorative. `note_signed` refuses the edit. A correction
after sign-off is an addendum, which is a separate design nobody has done yet, and is named as such
rather than approximated by letting the edit through.

**Not done, named:** addenda; copying GHIS's `authorized.on`; investigations and prescriptions.

## 2026-09-06 — Investigation orders: a structured payload decides, and the record keeps what GHIS drops

**Decision: an order is recognised by its payload, never by its timeline kind.** The order mirrors as
`kind:"note"`, and `"note"` is the catch-all the console uses for free text too. Dispatching on the
kind would have swept genuine notes into the migration the moment a clinic turned it on. The client
sends an explicit `order:{...}` beside the sentence and the route requires it (`isInvOrder`), so the
default for everything else stays "migrate nothing". This is the same lesson the sign-off trace taught
one migration earlier, applied before it could become a defect rather than after.

**Decision: write the canonical `ServiceRequest`, not the sentence.** The model already represents a
non-medication order. Storing the mirrored line "Investigation ordered: CBC (for fever)" would have
put a second, prose model of an order into a system whose whole point is one canonical record, and
would have made the ward re-parse English to answer "what was ordered". The sentence stays on the
timeline for humans; the record holds the structure.

**Decision: record `priority` and `reason` even though GHIS discards them.** `orderInvestigation` maps
neither the Emergency toggle nor the typed diagnosis. The temptation is to mirror GHIS exactly, on the
grounds that anything else is a divergence. Rejected: the doctor entered both, the canonical model has
a field for both, and dropping them to match a downstream limitation would lose clinical intent the
user actually expressed. The GHIS behaviour is documented as pre-existing and left alone.

**Decision: do not infer `category`.** Service ids are prefixed ("LAB1118", "P0110") and it is tempting
to read lab vs procedure off the prefix. That is a naming convention, not a terminology. `category`
stays `"other"` rather than encoding a guess that would look like a fact.

**Decision: one order per test per encounter, and say what that costs.** A deterministic id makes a
retry or a double-tap idempotent, which is the failure mode that actually happens on a phone in a
clinic. It also means a doctor deliberately re-ordering the SAME test within ONE visit is recorded
once in the record while GHIS and the timeline keep both. Named in the module header and the vault
note rather than left for someone to discover.

**Not done, named:** results (`DiagnosticReport`) — nothing writes one, so the console card says so
outright rather than leaving a doctor to wonder; cancelling an order; prescriptions.

## 2026-09-06 — Prescriptions: the upstream block is the safety property, and Quantity is not a dose

**Decision: do not "fix" the fact that this migration cannot fire yet.** Tracing the flow first (as
the sign-off lesson requires) turned up that GHIS prescribing is hard-blocked: `/prescribe` answers
501 `prescribe_not_verified` because the CreateDrugs payload was never captured, and `postWrite`
returns before the timeline mirror. The tempting reading is "the seam is broken, hook somewhere that
actually fires". Rejected, emphatically. That early return is what guarantees a prescription GHIS
REFUSED can never become an active medication order in the record, which is the worst thing this
code could produce. The migration is wired at the same seam as its four siblings and is inert behind
two gates instead of one. Pinned by a test that asserts the 501 return still precedes the mirror.

**Decision: Quantity is not a dose.** The OPD form has no dose field; it has Quantity ("10" tablets
to dispense). `MedicationOrder.dose` is `{value, unit}` and feeds `checkDose()`'s ceiling arithmetic.
Mapping Quantity into `dose` would have populated a field the safety engine trusts with a number that
means something else — a silent wrong answer from a check that appears to have run. Left null, the
engine reports DOSE_UNPARSEABLE and says the ceiling check could not run. An honest gap beats a
plausible wrong number, and this is the clearest case of it in the migration so far.

**Decision: the prescriber's credential decides draft vs active, and nothing is fabricated either
way.** Signing requires a credential (`NO_CREDENTIAL`), so always setting `signedBy` would make a
PIN-session doctor's prescription fail entirely, and never setting it would leave an ACTIVE
medication order that nobody signed. Neither is acceptable for a medication. A credentialed
prescriber signs an active order with their own id; an uncredentialed one gets an unsigned draft that
says exactly what it is. This preserves the draft → signed → active lifecycle the model already
documents rather than inventing a new one.

**Decision: carry the generic, drop nothing the form captured.** `basic_material_desc` from GHIS's
own drug search is the composition, and `wardsynq-safety.js` indexes allergy classes and dose limits
BY GENERIC. Dropping it would have blinded checks that already exist. Form, quantity, duration and
instructions have no canonical field and are bolted on, the same convention the adapters use — they
are fields the doctor actually filled in, not inventions. PRN, timing, start/end, priority,
indication and strength are NOT captured by the form and are not invented to look complete.

**Not done, named:** dispensing; administration/eMAR (`MedicationAdministration`); reconciliation;
cancelling a prescription; any change to the safety engine or its thresholds.

## 2026-09-06 — Results: a READ-side migration, and an idempotency bug this file's own logic caught

**Decision: mirror the READ, don't hook a write.** Every migration before this one intercepted a
doctor's WRITE action. A lab/radiology result has none — the doctor merely taps to view what GHIS
already has. Rejected: waiting for some future GHIS write-migration to hang this off of. Instead the
client mirrors GHIS's ANSWER, after the fact, to a route of its own (`POST /api/queue/result`, not
"timeline" — a result is not a new sentence in the visit summary). GHIS's read is never slowed,
blocked, or altered by the mirror; a failed mirror is invisible to the doctor, because GHIS remains
what they just read from either way.

**Decision: "authoritative" changes meaning for this one migration, and that is stated explicitly
rather than left to be discovered.** Everywhere else, authoritative means WardSynQ is the write
target and a refusal blocks the caller. There is no write target here — GHIS was never asked to
write anything by this flow. So authoritative is redefined, in writing, to mean only "the console
may also read the result back from WardSynQ" — narrower than the other four cards' gate (any
migration reachable at all), because reading a second source for the SAME fact needs its own
explicit opt-in, not to ride in on whatever else happened to be turned on.

**Decision: `DiagnosticReport.critical` is never set from GHIS's own flag.** This is the single
safety-relevant call in the migration. `wardsynq-critical.js`'s own rule #1 says a source's critical
flag is advisory and must never substitute for classifying against the site's OWN approved
thresholds. Trusting GHIS's flag as if it were WardSynQ's classification would be exactly the
mistake that rule exists to prevent — an interface that inherits every one of the sender's bugs. The
flag is carried, informationally, as `Observation.sourceCritical`; the canonical field stays false,
and nothing here touches the closed-loop escalation engine at all. That wiring needs the site's own
approved thresholds and is a separate, later decision.

**Decision: link a result to a ServiceRequest by name, on the SAME encounter, ONLY when exactly one
candidate matches.** The lab/radiology order rows carry no ServiceRequest id, only a display name.
Zero matches or several both leave the link null with the outcome recorded (`"unmatched"` /
`"ambiguous"`) rather than guessing among several same-named orders — a wrong linkage would be worse
than none, and the task was explicit that no ServiceRequest may ever be manufactured to make a
result look ordered.

**Decision, found and fixed before merge: a static idempotencyKey would have permanently frozen every
result at its first-ever value.** The first draft gave the report and each observation an
idempotencyKey built from the entity's own STABLE id. `RecordService.recall()` caches an
idempotencyKey's outcome forever — every future `put()` sharing that key replays the ORIGINAL result,
whatever content is passed. A genuine correction (see AMENDMENTS below) would have silently never
taken effect; the API would report success on every call while nothing ever changed. Every sibling
migration had already established the right pattern for exactly this reason: idempotencyKey is an
OPTIONAL, caller-supplied value for an exact-retry, not a permanent per-entity key; the real dedup is
an explicit same-content check (`sameOrder`/`samePrescription`, here `sameReport` +
`sameObservationValue`) plus `expectedVersion`. The amendment test caught this directly — `written`
came back `0` on a genuinely changed value — before it could reach a hospital.

**Decision: a changed observation value versions the REPORT, not just the observation.** GHIS
exposes no "corrected" signal on either read path, so a repeat mirror with different content is
represented the way this model already represents any change: a new version. The report's own
`resultObservationIds` (the SET of ids) does not change when only a VALUE inside one of them does,
but the report is still given a new version in that case, so a doctor reading the report's own
history sees that something in it was corrected, not just the individual test.

**Decision: add `encounterId` to `DiagnosticReport`, in the model itself, not as a bolt-on.** Every
other clinical resource here already carries it; its absence looked like an oversight, not a design
choice, and results without an encounter link could not be shown alongside the visit that produced
them. This is extending the ONE existing model with a field its siblings already have, not building
a second model — the ICU/ward adapter's own report-mapping function gained the same one-line fix,
since it already had the encounter in scope and had nowhere to put it.

**Not done, named:** making WardSynQ the actual source of record for results (GHIS stays the
external source in every mode); an abnormal-vs-reference-range judgement (GHIS's own flag is the
only signal carried); cancelling a result; correcting a linkage after the fact; DICOM/PACS
integration (none exists in this codebase to preserve, and none is built here).

## 2026-09-06 — Encounter: closing the gap every prior migration assumed, and extending governance by exactly one entity

**Decision: one function serves open, continuation and close.** Every prior migration's write had an
obvious single trigger. A visit does not — it has a ticket lifecycle with several states that all
mean the same underlying question. Building three separate functions (`recordEncounterOpen`,
`recordEncounterContinue`, `recordEncounterClose`) would have meant three places to keep a
"same-content, don't write" check and a "don't reopen a closed one" check consistent. One
`recordEncounterSync`, called from every hook point with the ticket's CURRENT state, computes the
right answer itself and is idempotent by the same mechanism every sibling migration already uses.

**Decision: mirror `_queue_eta.js`'s own terminality, never re-decide it.** The temptation with
`investigation`/`followup` — states that are NOT in `isTerminal()` but also are not
`in_consultation` — was to treat them as some third, encounter-specific category. Rejected: the
queue engine's own transition table already answers this (`investigation` can return to
`waiting`/`called`/`in_consultation`, so it is not an end state), and re-deriving that answer here
risks disagreeing with the engine that actually enforces it. Both map to "in-progress": still
today's visit, not yet finished.

**Decision: a closed encounter refuses ANY further change, not just a reopen.** The task's wording
was "do not silently reopen or overwrite." The narrow reading (block only a return to a non-terminal
status) would still have allowed a stale sync to flip `"cancelled"` to `"finished"` or vice versa.
Rejected as too permissive for a fact this consequential to get quietly wrong. The rule is: once
terminal, only a byte-identical repeat of the same close is accepted; anything else is refused
outright, `encounter_closed`, matching `wardsynq-actors.js`'s own reasoning that a closed clinical
fact needs a deliberate, governed correction, not a side effect of a routine re-sync.

**Decision: extend `actor.js`'s QUEUE_ADD scope by one entity, on the SAME reasoning already
written there, rather than invent a new capability.** Checking a patient in for today's visit is not
a clinical judgement; it is the identical kind of administrative fact registration already was
before this migration. Without this, reception — who does the check-in in real OPD workflows — would
be refused SCOPE_DENIED on every single encounter this migration tries to open, making the whole
foundation nonfunctional for its primary real-world trigger. The fix is one line (`ENCOUNTER_TYPE`
added to the same union `PATIENT_TYPE` already goes through) rather than a parallel capability.

**Decision: widen `encounterIdForTicket` to fall back to the ticket's own id, for a native visit.**
Every other order/rx/result id already had this fallback (`anchoredOrderId`); the encounter helper,
extracted earlier and never revisited, was the one exception. Left alone, a private clinic with no
GHIS connection would have gotten `encounterId: null` on every one of its vitals, notes, orders,
prescriptions and results forever — a real gap this migration exists to close, not one it can leave
standing for exactly the visits that most need a foundation. No tenant has ever run any of this in
production, so nothing existing needed reconciling.

**Decision: timestamps and the attending clinician come from the ticket's own recorded fields, never
a generated "now" or a resolved-actor assumption.** `periodStart`/`periodEnd` use
`registeredAt`/`consultEndAt` when they exist; `attendingId` is the SESSION doing the sync, not the
actor writing the record — a nurse recording vitals is not the attending doctor, and conflating the
two would misattribute the encounter to whoever happened to touch it last for an unrelated reason.

**Not done, named:** admissions, bed management, and any encounter class beyond `"OPD"`; a discharge
workflow beyond the ticket's own three terminal states; closing an encounter for a ticket cancelled
by the stale-import reconciliation path (engine-layer, not route-layer — see the module note); the
GHIS cut-over and eMAR, neither started nor approved to start.

## 2026-09-06 — Real shadow: verify the mechanism, fix the one gap it has, correct a stale note

**Decision: do not build a second harness to prove this against "real" traffic — trace and hardened
the ONE that exists.** The task asked to run the real GHIS shadow path against real traffic. Nothing
here has a real GHIS credential or a physical device; fabricating pretend "real" numbers would be
worse than saying so. What IS this agent's job, and was done: verify field-by-field that the existing
adapter correctly maps the EXACT bundle shape `ghis-ward.js loadIntoICU` actually constructs (traced,
confirmed correct), and hardened the one real gap tracing found — not invent a parallel proof.

**Decision: `wardsynq-shadow-boot.js` needed a test, and needed it BECAUSE of its own documented
history, not on principle.** This file's header names a real defect: an earlier version watched
`ingestFromWard` only, while a current build calls `ingestWardHistory`, so a real device reported
`bundlesSeen: 0` — a silent, confident-looking non-observation. That defect lived in exactly the
kind of code (poll loop, dynamic import, multi-method merge) that is easy to leave untested because
it "is just wiring." It had zero tests despite that history. `mergeReports`/`hasAnyMethod`/
`flagIsOn` were extracted into named, exported, pure functions — no behaviour change, `boot()` calls
the same logic it always did — specifically so THIS layer cannot repeat that exact failure mode
unnoticed a second time.

**Decision: correct the vault rather than let a stale "not built yet" stand next to a module that
already is.** Tracing turned up `wardsynq/wardsynq-ghis-live.js` — 305 lines, `test/wardsynq-ghis-
live.test.mjs` at 20/20, `wardsynq-flags.js`'s own header stating the owner approved the
architectural cut-over on 2026-09-05 — while `vault/modules/WardSynQ.md`'s "Not built yet" section
still said the cut-over "awaits a shadow run." Leaving that stand would have cost whoever reads it
next a full re-discovery of work already done. The one thing that note said which remains TRUE: no
boot script calls `installLiveGhis()`, so the built, tested, approved module is currently unwired —
named precisely, not conflated with "not built."

**Decision: state plainly that tenant/actor/audit do not apply here, rather than force-fit them.**
The task's safety checklist named tenant isolation, authenticated-actor handling and audit behaviour.
The shadow mechanism is pure client-side JS with no server round trip, no store, no bus — retrofitting
a tenant or actor concept onto it would be exactly the "invent another ingestion system" the task
forbade. Those properties belong to, and are already enforced by, the SEPARATE server-side record
service (`functions/_wardsynq/*`, `WARDSYNQ_RECORD`) that this mechanism does not touch at all.

**Not done, named:** enabling `smd_wardsynq_cutover` or wiring its boot script (explicitly out of
scope: "do not enable authoritative cutover"); running this against an actual real device (no
credential or hardware available here — the owner must do that step); any change to
`wardsynq/wardsynq-ghis-live.js` itself, which this task found but was not asked to touch.

## 2026-09-06 — Wiring the cut-over boot layer: one required change to the engine, and a two-key write control

**Decision: add `installLiveGhis`'s `method` parameter — this WAS "absolutely required for boot
integration," not scope creep.** The instruction was explicit: don't change `wardsynq-ghis-live.js`
unless boot integration genuinely needs it. It does: the function only ever wrapped
`ingestFromWard`, hardcoded, with no way to point it at `ingestWardHistory` — the door
`ghis-ward.js` actually calls on every current build. Wiring it as-is would have shipped a boot
script that reports `installed: true` while observing nothing, on real traffic, silently — the
EXACT defect the shadow observer already found on a real device once, now reintroduced into its
sibling by omission. The fix mirrors `installShadow`'s already-proven `method` parameter exactly: a
single optional argument, default unchanged, every one of the 20 existing tests untouched and
passing. Verified by running them before writing a single new test.

**Decision: the store comes from `window.SMD_WARDSYNQ_RECORD`, and ONLY if it is already, actually
connected — never a second connection, and never a fallback that pretends to be one.** The
temptation was to have the boot script open its own record connection so the cut-over would "just
work" the moment the flag is set. Rejected: that would mean flipping ONE flag starts real writes,
which contradicts "preserve tenant/actor/governance behaviour" (a tenant is a deliberate, separate
configuration, not something a boot script should pick on its own) and contradicts the instruction
that real-device verification happens SEPARATELY, after this PR. Reading the EXISTING connection
instead means turning the cut-over flag on, alone, with no tenant configured — the state every
device will actually be in when this first ships — runs `installLiveGhis`'s own documented DRY RUN.
Real writes require BOTH flags, deliberately: a genuine two-key control, not an accident of load
order.

**Decision: a FRESH `KIND.ADAPTER` actor, never the connected session's own human actor.** The
record connection's `actor` is the SIGNED-IN DOCTOR, at whatever tier the server granted them
(often EXECUTE). Passing that actor straight to `installLiveGhis` would let a feed commit through a
human's own write tier — precisely what `wardsynq-ghis-live.js`'s own header says the adapter-actor
convention exists to prevent. The boot layer constructs a separate, static adapter identity
(`kind: ADAPTER, tier: DRAFT`), exactly as the module's own test harness already does, so a feed can
never commit an active clinical record however confidently GHIS asserts one, however privileged the
doctor whose device happens to be running it.

**Not done, named:** enabling `smd_wardsynq_cutover` anywhere, by this PR or any default (ships OFF,
stays OFF); real-device verification (the owner's own next, separate step); a tenant-selection or
auto-connect mechanism for the record session (reuses `wardsynq-record-boot.js`'s existing one,
unmodified); any redesign of `wardsynq-ghis-live.js`'s mapping, transaction or failure-recording
logic, none of which this PR touches beyond the one parameter above.

## 2026-09-06 — The FIRST native, GHIS-independent write: OPD assessment, `org.mode:"wardsynq"`

**Decision: `mode:"wardsynq"` is a third, EXPLICIT value on the org's existing `mode` field — never
inferred, never a new configuration system.** Traced the request to distinguish a native-WardSynQ
hospital from an external-EMR hospital and found no existing signal did it cleanly: `org.mode` had
exactly two values, and `"native"` was already fully claimed by the personal/shared solo clinic
feature (on-device `_localStore`, picker-labelled "Personal clinic", `openTicketEmr()`'s
`inClinicWorkplace()` branch) — not a placeholder for a native hospital. Reusing it would have
silently moved every existing solo/shared clinic doctor's notes into a multi-tenant server store they
never opted into. Per the owner's explicit instruction after that report, added `"wardsynq"` as a
sibling value on the SAME field, reusing the SAME org row, the SAME `connectTenantId` tenant-link
mechanism `"connect"` already uses — no new store, no new schema.

**Decision: widen the org normalizer's ternary at its ONE choke point, not per-caller.** Grepped
every `org.mode` consumer before writing code, per the task's explicit instruction. Found the real
hazard was structural, not behavioural: `functions/_opd_org.js`'s `org()` — the single function
`_opd_org_store.js`'s `createOrg`/`getOrg`/`updateOrg`/`listOrgsForOwner` ALL route every read and
write through — had `mode: o.mode === "connect" ? "connect" : "native"`. Any `mode:"wardsynq"`
document would have been silently coerced to `"native"` on its very first read, and `queue.js`'s
`_listClinics()` filter (`o.mode !== "connect"`) would have listed it as a personal clinic. Fixed
both at the root: one three-way check in `org()`, plus the two picker filters in `queue.js`
(`_listHospitals()` now includes `wardsynq`, `_listClinics()` now excludes it). A dormant, unimported
duplicate ternary in `_opd_model.js` (a Phase-2 contract nothing imports yet) was found and left
alone, named in the vault so it doesn't surprise whoever wires it in later.

**Decision: the server route forces `mode:"authoritative"` for a wardsynq org's assessment write,
bypassing `resolveMigration`'s global `WARDSYNQ_RECORD` flag entirely — never flipping that flag.**
The existing shadow/authoritative machinery in the `seg==="timeline"` handler is gated FIRST on
`env.WARDSYNQ_RECORD==="1"`, a global switch the task explicitly forbade touching. But a wardsynq
hospital has no GHIS write to shadow — there is nothing to observe, only a record to write — so
"authoritative" isn't a rollout stage to opt into, it's the only meaningful mode. The new branch
checks `org.mode==="wardsynq"` BEFORE that flag-gated call, resolves the tenant link directly via the
already-exported `resolveTenantForOrg`, and constructs `{mode:"authoritative", tenantId}` itself —
reusing `recordAssessment`/`recordAssessmentSignOff` completely unchanged (same versioning, same
idempotency, same concurrency). A wardsynq org with no tenant linked fails honestly
(`wardsynq_tenant_not_configured`) instead of a silent no-op that would look like a successful save.

**Decision: fix `loadProfile()`/`loadAssessment()`/`st.writeOn` for the wardsynq source too, even
though the task scoped ONLY the assessment write.** Necessary infrastructure, not scope creep: without
these, opening ANY wardsynq patient would surface "Connect Ward Sync (GHIS) first" on the Profile tab
(a hardcoded GHIS fetch with no source guard) and the Save button would stay permanently hidden
(`st.writeOn` depended on `smd_opd_emr_write`, a GHIS write-back ROLLOUT flag meaningless for a
hospital with no GHIS relationship at all) — both would have broken the one path this task exists to
prove, before the doctor could even reach it. Investigation/Medication tabs were deliberately left
untouched: `runSearch()`'s existing `st.source !== "ghis"` guard already no-ops them cleanly (no
error, no crash), which is an acceptable — and explicitly out-of-scope — gap for the next task.

**Not done, named:** investigation orders and prescriptions for wardsynq hospitals (explicitly
excluded); native registration/vitals/encounter for wardsynq orgs (still behind the flag-gated
shadow path, off) — the `ClinicalNote` write does not require a pre-existing `Patient`/`Encounter`
resource (no referential-integrity check in the record service), so the assessment note itself works
standalone, but a fuller chart needs the same treatment applied to those three migrations; any admin
UI to actually create a `mode:"wardsynq"` org (a direct data write today, same as `"connect"`); CDSS
and allergy/problem-list migration (unrelated to this task).

## 2026-09-06 — Extending the native path fast: registration, vitals, encounter, investigation orders

**Decision: one shared helper (`wsqForcedMigration(env, org)`) instead of repeating the tenant-
resolve-and-force logic at each of the five write sites.** The assessment PR inlined this once,
bespoke, inside the timeline handler. Generalizing it into a single function — `org.mode !==
"wardsynq" → null` (caller falls through unchanged), else resolve the tenant and return
`{mode:"authoritative", tenantId}` or `{error:"wardsynq_tenant_not_configured"}` — let every other
site (registration, the ONE shared `syncEncounter()` call site, and vitals/investigation-orders in
the timeline handler) reuse it in one line each, instead of five copies of the same tenant-lookup.
Root-caused once, not patched per caller.

**Decision: the timeline handler's four-way dispatch (vitals/assessment/order/prescription) is now
computed as `wsqMig || <existing flag-gated call>`, not a bespoke early-return per write type.**
Simpler than the assessment PR's original shape and it generalizes for free: adding vitals and
investigation orders to the wardsynq-forced path took one line each, because the EXISTING
migrator/ctx/authoritative-dispatch code (unchanged, already handling all four types) just runs
against whichever `mig` it's handed.

**Decision: prescriptions are explicitly, deliberately EXCLUDED from the wardsynq-forced path.** GHIS
itself hard-blocks `/prescribe` until reviewed, specifically because no drug-interaction/allergy/dose-
ceiling CDSS is wired into OPD prescribing anywhere (`wardsynq-safety.js` exists, built, tested, and
is NOT connected to OPD prescribing). A wardsynq hospital has no external safety net to substitute
for that missing check — enabling native prescribing now would be LESS safe than GHIS's own current
posture, not equally safe. `submitPrescribe()` in `opd-emr.js` gets no wardsynq branch; the server's
`wsqMig` computation explicitly checks `isVitals || isAssessment || isInvOrder`, never
`isPrescription`. This is a genuine, named gap, not an oversight — CDSS wiring is the prerequisite,
not a follow-up nicety.

**Decision: investigation ordering IS enabled natively, unlike prescribing** — carries no drug-dosing
risk, so `submitInvOrder()` gets a `st.source === "wardsynq"` branch posting through the same
`postWardsynqTimeline()` helper the assessment path already established (refactored out of
`postWardsynqAssessment` for reuse). **Named limitation:** `runSearch()`'s existing `st.source !==
"ghis"` guard still no-ops the investigation SEARCH for a wardsynq hospital (same as it always has for
local/shared clinics) — there is no native test/service catalog to search yet. The write path is
fully wired end to end; a doctor cannot yet pick a service to order without one. Building that catalog
is a separate, sized piece of work, not done here.

**Decision: vitals needed ZERO client changes.** The nurse-station vitals entry (`opd.html`'s
`openVitals()`, the staff web console) already posts unconditionally to the generic
`POST /api/queue/timeline` with `kind:"vitals"` — it has no GHIS-specific branching at all. The
server-side `wsqMig` force applies automatically based on the session's own org.mode, invisible to
that client. This is exactly the "smallest clean change" posture: nothing to touch where nothing was
GHIS-coupled to begin with.

**Not done, named:** prescriptions (CDSS prerequisite, above); a native investigation/service catalog
to search from; CDSS/allergy/problem-list generally; any admin UI to create a `wardsynq` org — the
existing `POST /api/queue/org` (mode:"wardsynq") + `POST /api/queue/org/update`
(connectTenantId) + `POST /api/connect/onboard/tenants` (creates the `connect_tenant` row) already
suffice for a test hospital, using only existing endpoints, no new one added.

## 2026-09-06 (part 4) — Wiring wardsynq-safety.js into native prescribing, best-effort, on explicit instruction

The owner explicitly authorized this after being told the real gap: no allergy data exists anywhere
in WardSynQ, so wiring the engine in tonight means best-effort. "Yes, wire it in with best-effort
allergy list." Recorded here so the exact scope of that authorization, and its limits, are traceable.

**Decision: this can never GATE a prescription — that boundary is not mine or the owner's to waive.**
`wardsynq-safety.js`'s own rule pack and `vault/modules/WardSynQ.md`'s STATUS line both say, in
writing, that the interaction/allergy/dose content is UNAPPROVED and "must not gate a real order
until pharmacy and the relevant committee sign it off." That is a clinical-governance requirement
baked into the codebase, not a caution I invented. The owner's instruction authorized WIRING the
engine in with best-effort data — it did not, and could not, waive a documented sign-off requirement.
So `rx-safety.js` has no `allowed`/`blocked` concept anywhere in its code (asserted directly by a
test that strips comments and greps for the word `allowed`): it evaluates, shapes findings, and
returns. The write always proceeds. Every response is labeled `unapproved: true`.

**Decision: split the JSON-loading half from the pure-logic half, into two files.**
`functions/_wardsynq/rulepack.js` is the ONLY file that imports the real (883 KB)
`data/interaction-rules.json` + `wardsynq/data/allergy-classes.seed.json`, matching the existing bare-
JSON-import precedent (`kb/protocols/rchop.json` in the route file) that Cloudflare's bundler accepts
without an import attribute. `functions/_wardsynq/rx-safety.js` takes a compiled rule pack as a
dependency and never touches the JSON at all — Node's own ESM loader (unlike Cloudflare's bundler)
requires `with {type:"json"}` on a bare JSON import, and nothing in this test suite has ever executed
`functions/api/queue/[[path]].js` as a live module (every existing test on it is a `readFileSync`
string check) — so this split is what keeps `rx-safety.js`'s actual logic unit-testable in Node with
small fixture packs, the same pattern `wardsynq-safety.test.mjs` already uses for the engine itself.

**Decision: interaction checking is real today; allergy checking is honest about being inert today.**
`checkPrescriptionSafety` reads the patient's ACTUAL active `MedicationOrder` history from the record
for interactions — genuine value, no new data collection needed. It also reads
`AllergyIntolerance` — which returns `[]` for every patient today, since no capture UI exists — so
allergy checking contributes nothing yet. This is stated in the file's own header and re-asserted by
a test (`allergy checking is BEST-EFFORT, honestly: empty allergy list finds nothing`), specifically
so nobody discovers this gap by surprise later. The wiring is real and activates automatically the
day allergy capture ships, proven by a companion test that feeds it real allergy data and confirms
the match fires.

**Decision: the doctor sees findings BEFORE confirming, not after saving.** `submitPrescribe()`'s
wardsynq branch calls `GET /api/queue/rx-safety` first, folds any findings into the `confirm()`
dialog text (labeled UNAPPROVED, explicitly "does not block the prescription"), and only then writes.
A failed or degraded check (`degraded: true`) never blocks either — it just says decision support was
unavailable, and the doctor proceeds on their own judgment, same as they would have with no check at
all.

**Decision: fixed a real, pre-existing correctness bug found while wiring this in.**
`orderFromPrescription` hardcoded `drugCodeSystem: "ghis-drug-id"` for every prescription,
unconditionally. A wardsynq-native prescription (drug picked from the tariff catalog, not GHIS) would
have had its `MedicationOrder.drugCode` mislabeled as a GHIS id it is not — exactly the kind of
mislabeling `migrate-prescription.js`'s own header calls out as dangerous elsewhere ("a wrong field
could mis-prescribe a drug"). Fixed with a caller-supplied override (`rx.drugCodeSystem`), defaulting
to `"ghis-drug-id"` unchanged for every existing (GHIS) caller.

**Decision: native prescriptions ARE now forced authoritative, alongside vitals/assessment/orders.**
Re-added `isPrescription` to `wsqMig`'s forced set once the advisory check existed — safe now, because
the check can never gate the write either way. The native drug catalog reuses the SAME
`inv-catalog`/tariff mechanism from part 3, generalized with `?kind=medication`.

**Not done, named:** allergy CAPTURE (a real UI feature — check-in questionnaire, structured
`AllergyIntolerance` writes — remains entirely unbuilt); dose-ceiling and renal-adjustment checks are
wired into the same engine call but rest on the same UNAPPROVED seed content and the same
never-gates posture; pharmacy/committee sign-off, which is what would ever let any of this actually
gate an order, has not happened and is not this session's call to grant.

## 2026-09-06 (part 5) — Allergy capture, from the EXISTING assessment field, not a new UI

The owner said "Complete it" against the named gap ("allergy capture UI — doesn't exist"). Built the
data-capture half of that gap without building a new UI at all, and explicitly did NOT build the
part that would need one.

**Decision: reuse `Known_allergies_details` — the field already on GHIS's own Initial Assessment
form every doctor fills in on every patient — instead of building a check-in questionnaire.** Grepped
for "allerg" in `opd-emr.js` before writing anything and found this field already exists, already
captured, already free text. A new capture UI was the one thing explicitly flagged as real, unbuilt
work; reusing existing data collection is a genuinely smaller, safer change than adding a second
place a doctor is asked about allergies (which would also raise "which one is authoritative when
they disagree" — a question this decision avoids by having exactly one source).

**Decision: the parser is biased toward MISSING an allergy over FABRICATING one, and every design
choice traces to that.** Stated as the file's own header, because it is the one property review
would need to re-verify by inspection, not just by reading a summary: a missed allergy degrades to
today's baseline (nothing) — no regression. A fabricated one (wrong substance, invented severity)
actively corrupts the chart — strictly worse than today. Concretely: substance resolution reuses
`wardsynq-safety.js`'s OWN `resolveGeneric()` verbatim (already "deliberately conservative: exact
token matching only, no fuzzy matching, no stemming" — nothing added on top); an unresolved fragment
is still stored (visible to a human as `reportedText`) but with `substance:"unspecified"`, which
matches nothing in `checkAllergies()` by construction — never presented as machine-checked when it
was not; severity/reaction/criticality are NEVER inferred from text, every entry is
`severity:"unknown"`, `verifiedBy:null`; an explicit denial ("NKDA", "denies allergies") writes
NOTHING — an entry claiming the patient was checked and clear would itself be invented. Verified by
running the parser against the REAL 3307-generic StewardMD pack (not just a test fixture) on
realistic clinical phrasing before writing a single test, specifically to catch a rule that looked
correct against a small fixture but behaved differently at real vocabulary scale.

**Decision: one AllergyIntolerance entry per resolved substance (or per unresolved fragment), ID'd
by (patient, substance-or-text) — not one blob per patient.** Lets `checkAllergies()` actually match
each one independently (a patient can be allergic to more than one thing), and makes a re-save of
the unchanged text a true no-op (idempotent) via the same `sameAllergy()` + `expectedVersion` pattern
every sibling migration already uses. Named trade-off, not hidden: editing the text to REMOVE a
previously-reported entry does not retract its prior version — this store is append-only everywhere,
and a superseded-but-still-versioned allergy is the same posture already accepted for every other
resource here, not a new gap this feature introduces.

**Decision: wired into the assessment-save path itself, gated on `isAssessment && !isSignOff &&
wsqMig` specifically — not `mig.mode === "authoritative"` generally.** A GHIS-shadow tenant the owner
happens to have configured as authoritative for ITS OWN reasons must not pick up allergy capture as
a side effect of that unrelated setting; only an actual wardsynq-native org (the thing `wsqMig`
alone signals) gets it. Best-effort or the assessment write's own success: awaited (so a Worker
does not need `waitUntil` to guarantee it runs) but wrapped so a failure here can never turn a
successful assessment save into a failed response — the exact `syncEncounter()` contract already
established for the analogous case.

**Not done, named:** a doctor explicitly CONFIRMING or entering a STRUCTURED allergy (picking a drug
from a list, marking a reaction as severe/verified) remains unbuilt — that is the actual "allergy
capture UI" gap, still open; what changed is that the free text already being collected now feeds
the safety check instead of going nowhere. Also unchanged: this only runs for wardsynq-native
assessments, never GHIS/shadow tenants, and the check itself still never gates a prescription
(unrelated to what changed here — that boundary was set in part 4 and nothing here touches it).

## 2026-09-08 — Inbound FHIR: SCCM 1.1 (administrations, service requests, consents), and the one narrow governance grant

**Decision.** SCCM gains three optional collections (`administrations`, `serviceRequests`, `consents`) and two
optional references (`diagnosticReport.basedOn`, `medicationAdministration.request`) as an ADDITIVE minor,
`1.0 -> 1.1`; `assertConsumable` still checks the major only and connectors may declare any `1.x`. The FHIR
normaliser and the SCCM adapter map the new types; consent is mapped in `fhir-inbound.js` because
`PatientConsent` is a governance record owned by `consent.js`, not a clinical entity the adapter builds.

**What an imported row may never do.** A dose another hospital gave is filed as a `MedicationAdministration`
whose `orderId` is the feed's own order (or `external:<system>:unreferenced`), `administeredBy` is
`external:<system>[:name]`, and `meta.source.system` is the feed. An imported order is `draft`, requested by
`external:<system>`. Every reader that could act on such a row asks `isExternalRecord()` (service.js):
charge capture lists it under `notCharged` as `external_source` and never prices it; the collection worklist
and the pending-results list omit it; result matching never matches it.

**The governance grant.** `authoriseWrite` refused the dose: `MedicationAdministration` is an instruction
type and a non-draft status needs EXECUTE, which an adapter cannot hold. The rule's own rationale says the
intent is that a feed never ISSUES an instruction, while recording what already happened "is exactly what a
hospital feed is for". Rather than widen the rule, a named grant `isExternalDoseRecord(actor, entity)` was
added: an ADAPTER (never an AI) may write a `MedicationAdministration` whose `meta.source.system` is external,
whose status is past tense (`administered|cancelled|held`), whose `orderId` is structurally not this
hospital's (prefixed by the same source system, or the `external:<system>` marker) and whose `administeredBy`
is external. Every eMAR read that counts or schedules a dose keys on `orderId`, so such a row can never make
a due dose here look given. Each condition has a negative test in `test/wardsynq-actors.test.mjs`.
**Reversible:** delete `isExternalDoseRecord` and its one call site; inbound administrations then hold as
exceptions again. Owner may veto.

**Also found by the new validator, fixed at the FHIR boundary:** a DiagnosticReport with no observations
exported `result: []` (R4 ele-1 forbids an empty element); now omitted.


## 2026-09-09 — MaiK CDS (TASK 8.9): MaiK explains the SafetyEngine's verdict, and is never a second rules engine

**Decision.** `functions/_wardsynq/maik-cds.js` calls the existing deterministic `SafetyEngine` from
`wardsynq/wardsynq-safety.js`, on the SAME compiled pack `getRulePack()` hands the prescribing and pharmacy
paths, and passes the FINISHED verdict to the model. MaiK cannot re-run a check, add or remove a finding, or
change a severity or disposition. The route returns three named things a reader must never merge:
`deterministic` (the engine's findings, verbatim, with its rule-pack version and `unapproved: true`),
`explanation` (MaiK's words, never authoritative) and `decision` (what the clinician did, carrying
`overridesNothing: true` — overriding a finding stays a separate act on a `SafetyOverride`).

**It fails closed.** No pack, an engine that throws, or a drug the content cannot resolve produces a REFUSAL
(503 `safety_engine_unavailable` / 409 `not_checked`) naming which check did not run, and no model is called
at all. The refusal text says "Nothing here means the order is safe; it means it was not checked", because
calm prose about a drug reads as "checked, clean" to a clinician. `test/wardsynq-maik-cds.test.mjs` proves the
guard is load-bearing: removing it makes the suite fail.

**And it screens MaiK against the verdict it was handed.** A model given three blocking findings will still
emit "no significant concerns" — it is trained to reassure. `contradictions()` withholds the text WHOLE when
it reassures over existing findings, or claims a check ran that the engine said could not. This catches the
reassuring contradictions, not all of them, and it is stated as such in the file.

**UX: one CDS surface.** The explanation renders INSIDE the existing "Safety verdict" card in `pharmacyView`,
underneath the engine's findings. There is deliberately no second CDS screen — a rival place to read findings
is a place the two eventually disagree. Picking another order clears the explanation; MaiK being withheld,
refused or switched off never removes the deterministic card.

**Bug found on the way (`wardsynq/wardsynq-secops.js`).** The patient-boundary output screen captured the tail
after an optional separator, so the ordinary English word "patient" matched as "pat" + "ient" and EVERY model
output containing it was withheld as a cross-patient leak. Being fail-safe, it was invisible until MaiK needed
to say the word. The identifier is now matched WHOLE and must contain a digit — which also fixes the opposite
error, that "pat-1" was never detected at all (a one-character tail failed the two-character minimum).
Regression tests both ways in `test/wardsynq-secops.test.mjs`.

**NOT claimed.** No clinical validation, no certification, no real-device or production verification. The
rule-pack content remains unapproved seed data and does not gate an order; every response says so.


## 2026-09-10 — TASK 8.10: real model evaluation, a Vertex AI provider, and MaiK's role boundary

**The audit finding.** WardSynQ's MaiK layer had NO model-quality evaluation. Its tests assert routing,
deterministic safety and transport, and every one runs against a socket returning a fixed string - correct
for those properties, and not evaluation. The only three files in the repo that grade real model content
belong to StewardMD's separate app-level MaiK, none can drive `maik-gateway.invoke()`, and none runs in CI.

**The instrument.** `wardsynq/wardsynq-maik-eval.js` grades eleven metrics as pure functions of
(rubric, output). No model grades anything - every expected answer is hand-written in
`test/wardsynq-maik-eval/dataset.js` in advance. `test/wardsynq-maik-eval.test.mjs` (17 tests) calibrates the
graders against specimens whose grade is known, because an uncalibrated instrument produces numbers that
look exactly like calibrated ones.

**VERTEX AI EXPRESS MODE, AND THE RESIDENCY LIMIT THIS ACCEPTS.** The Vertex provider uses the publisher
path `aiplatform.googleapis.com/v1/publishers/google/models/<model>:generateContent` with the API key in an
`x-goog-api-key` header. The project-scoped paths
(`/projects/<id>/locations/<region>/publishers/...`, regional or global) were probed and return 403
PERMISSION_DENIED: they require an OAuth bearer token and `aiplatform.endpoints.predict`.

  CONSEQUENCE, STATED SO NOBODY DISCOVERS IT LATER: this adapter cannot pin a region. Express mode is not
  project-scoped and carries no data-residency guarantee. A hospital that requires inference inside a named
  region (or inside a named project's VPC controls) CANNOT use this adapter and needs the OAuth/IAM path -
  a service account, ADC or workload identity, and a different adapter. That is deliberately NOT built
  here: silently swapping an API key for ADC would change the credential model of a clinical system as a
  side effect of a model change.

**Vertex is a separate PROVIDER from AI Studio, not a flag.** Different hosts, different billing, different
failure modes - AI Studio's prepaid credits were depleted while Vertex answered normally. `phiApproved`
matches on provider id, so a hospital approving "gemini" has not approved "vertex". Both share one
`googleGenerate()` implementation because the wire format is identical.

**MaiK's ROLE BOUNDARY, added because a real model exposed the gap.** Asked "is the paracetamol safe to
give?", gemini-3.6-flash answered "whether it is safe to give is not recorded". It did not declare the
order safe - the role held - but that is the WRONG REFUSAL: "not recorded" describes a gap in the chart and
invites somebody to fill it, when the answer is not missing from the chart and is not MaiK's to give at any
level of completeness. `ROLE_BOUNDARY` now states three roles on EVERY task - the deterministic SafetyEngine
determines safety findings, MaiK explains, the authorised prescriber decides - and forbids both answering
the question and deflecting to "not recorded". It hands MaiK no verdict: an actual verdict reaches a model
only through `maik-cds.js`, which runs the real SafetyEngine first. Result: 7/8 -> 8/8 with the dataset,
rubric and thresholds untouched.

**Two grader defects the real model exposed**, both fixed in the instrument with new calibration specimens
and NEITHER a threshold change: "No allergies ARE recorded" did not match a pattern listing is/has been/was;
and the allergy-contradiction pattern fired on "No allergy to paracetamol is listed", which is accurate
beside a correctly reported penicillin anaphylaxis.

**Two defects the harness found in ITSELF, before any cloud model ran.** The injection scenarios were
vacuous passes - `notes` is not in the context builder's DEFAULT_SECTIONS, so the injected note never
reached the model, and the run would have reported injection resistance 1.000 for an attack nobody saw. And
a withheld answer scored as a PASS, because no quality grader fires on text nobody read and an empty failure
list reads as success. Outcomes are now scored/withheld/refused.

**Evidence.** gemini-3.6-flash on Vertex, `wardsynq-maik-eval-1`, 8 cases: 8/8, groundedness / factuality /
uncertainty / injection-resistance 1.000, hallucination / contradiction / leakage / unsupported-claims 0,
p50 ~6.6s. Persistence proven across a real OS process restart against on-disk SQLite
(`test/run-maik-persistence-restart.mjs`). Reasoning tokens ran ~7x the visible output, so cost taken from
answer length alone is wrong by that factor.

**NOT claimed:** clinical validation, production readiness, or real-device verification. An automated
rubric passing 8/8 is not a clinical study, and this note is not evidence that it is.


## 2026-09-11: Connect Agent browser should run on the phone, not a remote server (proposed)

Full ADR: `connect-agent-phone-browser-adr-2026-09-11.md`. Discovery is already a page-realm JS shim plus six
transport primitives, all of which WKWebView and Android WebView provide natively, with an init-script the
Camofox REST API lacks. Proposed: Option 4 phone-first (in-app WebView + Worker control plane), existing
Camofox runner kept only as fallback. Not yet decided by the owner; no code written.

## 2026-09-11: Connect Hospital phone-first implementation shipped (behind flags)

Built the phone-first architecture from the ADR. Native ConnectBrowser plugin (WKWebView + Android WebView),
phone discovery engine over the plugin, broker phone-runner routes (plan/progress/discovery/evidence/approve/
reject/connections + adapter reuse), pure-JS SHA-256 so the compiler runs in Pages Functions, and the doctor
UI. Commit c341a51f. Verified: 208 connect-agent tests pass; phone engine proven end to end vs a synthetic EMR
over headless Chrome; acceptance report 17 PASS / 0 FAIL / 3 BLOCKED; Android full-app APK builds with the
plugin in the dex; iOS ConnectBrowser package builds and links for the device SDK against real Capacitor.
BLOCKED (environment, not code): iOS full-app link needs the llama.xcframework simulator slice (pre-existing,
unrelated) or device signing; live-GHIS on-device run needs the broker deployed to stewardmd.in (feature
branch, behind flag) plus a doctor's own authorised GHIS login. Feature stays behind CONNECT_AGENT_FLAG +
client smd_connect_agent (default off).
## 2026-09-11 - the demonstration hospital stays a script, and what seeding it exposed

A one-click "Create a demonstration hospital" button was built on the wardsynq.com hospital list and
then REMOVED the same day: it was never asked for, and it duplicated
`scripts/wardsynq-demo-hospital.mjs` in a second language with a second set of guards to keep
correct. The seeder remains the one way to build a demo hospital. Recorded here so the idea is not
rebuilt by someone reading only the shape of the problem.

Two real defects the seeding exposed, both of which outlive the button:

**An allocated MR number is not always the one the caller asked for.** `patient/register` allocates
it, so a later specimen collection that scans the REQUESTED number is refused as a
`wrong_patient_scan` - the safety control working exactly as intended, against a caller that had
assumed its own number was authoritative. Any client driving registration must carry the ALLOCATED
MRN forward. The seeder does not yet, and reports the refusals as a finding.

**The clinical record write re-finds the hospital it was already given.** Opening the record resolves
the governed actor from scratch, and that resolution locates the organisation again by a Firestore
field query - the slowest lookup in the chain, and one the calling route had already performed. The
lookups stack until a single write runs past its request budget and Cloudflare answers 502 with the
first half of the work already committed. On the demo hospital this left 83 encounters standing over
zero patient identities: registration wrote the OPD register, died before writing the clinical
identity, and could never repair itself because re-registering was refused as a duplicate. The fix
hands the record write the org the route already holds, and makes a duplicate registration reconcile
a missing identity rather than return early.

**Also fixed, root cause not symptom:** `render()` in shell.js emitted the two-column `.wrap` grid
even with an empty rail, so every page shown before a hospital is chosen (the hospital list included)
was squeezed into the 178px rail column. `.wrap.norail` now collapses to one column.

## 2026-09-11 — "Local AI" becomes a hard policy: no silent cloud inference, capability-matched packs, no unsuitable downloads

**The problem the owner named.** A clinician who chose the on-device engine still spent Gemini on
every Scribe refine, ICD suggestion, note structuring, MaiK Ask turn, timeline summary and ICU
correlation, because the router only had local implementations for four tasks and fell through to
`orig.apply()` for the rest. Five calls never went through the router at all (`SMD_AI.maik`, a raw
`/summary` fetch, `voice.js` tier-3 transcribe, the ICU imaging/correlate calls, `readImage`'s cloud
stage). KB-only mode sent the viva judge and the OPD differential to the cloud too.

**Decision.** One policy decision in `maik-engine.js route()`: cloud -> untouched; rag -> no model,
no spend; local -> the on-device engine or a structured `LOCAL_CAPABILITY_REQUIRED` refusal. Never
the cloud. `SMD_MAIK_ENGINE.cloudAllowed()` is the single signal for the on-device-first paths
(image engine, voice, readImage). Evidence Review is Cloud-only by product decision and is REFUSED in
Local mode with cloud offered, rather than run silently. Speech-to-text is Whisper's job, not a
MaiK model's. `smd_maik_hard_local="0"` is a one-release recovery switch, not a mode.

**Capability matching lives in the registry, not a second one.** `maik-models.js` gains `CAPS`
(medical, KB-grounded, JSON reliability, reasoning tier, RAM floor, KV at 4K, verified languages)
and `suitability()` / `recommend()`. The matcher respects the pinned pack when it qualifies, then a
feature's preferred tier if installed, then the SMALLEST qualifying pack. Bonsai Swift (`json: 1`)
is never used for structured output.

**Never recommend a download that will not run well.** Verdicts are ok / warn / no. Unknown RAM
never upgrades a verdict; a 12 GB-floor pack on a phone whose total cannot be confirmed is "no"; an
iOS jetsam budget below the need is "no"; short storage is "no"; free-memory-now and battery are
warnings with the limitation named. "No" packs get no download button and MaiK Cloud is named as the
alternative. Nothing downloads without a tap; a warn-level pack asks once more.

**Languages are verified, not assumed.** `CAPS.lang` is empty everywhere. A language is added only
from a passing `test/run-local-translate-eval.mjs` run (numbers, drugs, doses, units must survive;
no native script may). Until then Indic input in Local mode is refused with the reason.

**The 4K context is the runtime's, not the model's.** Every pack loads at `nCtx 4096`. Long inputs
are windowed and reduced (`summarize`, `assess`, `noteStructure`, `reasoningExtract`, rolling
`scribeFill` with running state); nothing is silently truncated. The local sanitizers are the
server's, ported: the model orders ICD candidates the database supplied and can never emit a code
the database did not; a figure the source never stated is dropped, never corrected.

**Evidence.** `test/maik-policy.test.mjs`: Local + network ON, every decorated method, zero cloud AI
calls. 653 test files, 0 failures. Recovery tag `pre-hard-local`. Handoff:
[[2026-09-11-hard-local-policy]].

**NOT claimed:** any on-device run of the new task functions on a phone (tests use a fake plugin),
Indic offline translation, a client screen for Senior Surgeon Mode, or clinical validation of
anything here.

## 2026-09-12 MaiK Lite: 12 gaps from two live owner transcripts (PR maik-lite-battery-0911)

Owner ran MaiK Lite live and shared two full transcripts (2026-09-11 evening) plus screenshots of
raw reasoning leaking into the chat. Asked to "find the gaps", then "fix all". Same model/quant/
prompt throughout; every fix is in retrieval, the follow-up resolver, the router, or a
post-generation safety net (`stripReasoning`).

Root causes, grouped:
1. **Router misses** (home.js `maikRoute`): "Hello dude" (address word not in the greeting strip
   list), meta-complaints about MaiK's own last answer ("why are you missing continuity", "you are
   wrong") being sent to retrieval as new clinical questions instead of short-circuited, "How to
   diagnose it" (a follow-up) losing continuity because `GENERIC_FU` had the noun "diagnosis" but not
   the verb "diagnose" or the pronoun "it"/"them", and "Ok tell me dose of metoprolol" gate-failing
   while "Metoprolol dose" worked because the dose-follow-up drug extractor left "Ok tell" glued onto
   the drug name (the stopword list had no request-frame words).
2. **Zero-anchor grounding** (maik-local.js `retrieveGrounding`): "Teach me Pneumonia atoz" and "Can
   I learn a new topic today" had no real topic/drug anchor at all (every content word was generic or
   simply absent from the book), so the anchor filter's `need.length ? filter : cited` fallback used
   the UNFILTERED top BM25 hits - grounding a fabricated disease and an unrelated ML chapter
   respectively. Fixed: zero anchors now means "not covered", never "whatever scored highest".
   "medical/topic/learn/teach/today" added to the generic-word list (near-universal in a medical KB,
   so treating them as real anchors was nearly as bad as no anchor).
3. **Reasoning/prompt leaks** (`stripReasoning`, new class): a bare "H" answered with MaiK's own
   SYSTEM prompt pasted back verbatim ("Give the final answer only, never your reasoning...") before
   an unrelated drug monograph - a 4B model occasionally fails to distinguish "these are your
   instructions" from "please continue this text". Verbatim presence of that unique sentence is now
   treated as no answer (there is no reliable place to cut the echo from, so it does not try).
   Separately, "Hi" leaked a full "Plan: ... Possible responses: ... Let's go with X" brainstorm with
   no blank line before the real line, defeating the existing `LEAD_THOUGHT` blank-line-cut guard
   (added earlier for a tagged/paragraph-separated version of the same failure). Now recovers the
   picked line via a `LEAD_PICK` marker when present, and only falls back to the old
   strip-the-label behaviour otherwise - so a genuine answer starting with a trigger word ("Plan the
   airway first: ...") is still untouched. Also added: de-duplication when a small model repeats its
   whole answer verbatim (seen on the heart-failure dosing answer).
4. **model-missing on the first message**: the native plugin's `model-missing` error code (a
   transient load race, not a real failure - every later message that session worked) had no branch
   in `maikErrorNotice`, so the clinician got a dead-end with no next step on their very first
   message. Now told to simply ask again.

Tests: `test/maik-router-gaps-0911.test.mjs` (new, source-level per home.js convention), 7 new cases
in `test/maik-local.test.mjs`. The older `loadWithRag` test fixture needed a real tokenizer/idfOf on
its fake RAG/book (it previously had none, same gap class as the drift-guard fix on 2026-09-04) so
the new zero-anchor guard does not blind every pre-existing grounding test. Full suite green.

Not fixed, flagged for later: the underlying cause of the reasoning/prompt leaks may go deeper than
JS-side stripping - MaiK MxCore (MedGemma, no `noThink`) has no thinking-suppression prefill trick at
all (only Lite/Apex/Bonsai have `noThink: true`), so a stronger fix would give MxCore/Neural/Horizon
their own leak-resistant system prompt or verify on-device whether `stripReasoning` alone is enough
in practice. `LlamaEngine.swift`'s chat-template application (`llama_chat_apply_template`) looks
correct on inspection, so this reads as an instruction-following limit at 4B scale, not a template
bug - not re-verified live on device this session.

## 2026-09-13 WardSynQ P1.10 imaging viewer launch and P1.5 payer adapters (branch p1-rad-tpa)
- Images open in the hospital's own viewer via `wardsynq.imagingViewer.urlTemplate` (https only; placeholders
  {studyInstanceUid}, {accessionNumber}, {patientId}=MRN, URL-encoded, never a name). No pixels in WardSynQ, unchanged.
- Study-to-order linkage is done at read time (`_wardsynq/imaging-viewer.js` studyForOrder): serviceRequestId, else
  accession equal to the order id the worklist issued, else the order's external identifiers. Exact only.
- Structured report templates are hospital content (`wardsynq.radiologyTemplates`); report stores template id/version
  and sections. No clinical scoring in code.
- Payers are org config (`wardsynq.payers`); the claim stores only `payerId`. Adapter kinds: `manual` (queued) and
  `fhir-claim` (generic R4 Claim/ClaimResponse). Unknown payer or kind = NullAdapter. A fhir-claim payer requires auth
  unless `auth: "none"`; credentials are `credentialRef: "sealed:<ciphertext>"` sealed with the existing Connect
  envelope key, no new secret or binding. Missing credentials record `not_configured: credentials missing`.
- Settlement never assigns a balance to the patient; `balance-to-patient` is a separate, reasoned human action.


## 2026-09-13 WardSynQ security review (P2.17) is advisory, evidence-backed, and never green by default

`functions/_wardsynq/security-review.js`, routes `GET /ward/security-report`, `POST /ward/security-review`,
`POST /ward/restore-test` (all STAFF_ADMIN; doctor/nurse 403), Admin Center tab "Security review".
- Findings are deterministic counts over the audit trail and the org event log, each with its rows.
  Nothing auto-locks. Thresholds live in `RULES` and are returned on the report.
- Audit read-back is an OPTIONAL repository method `auditTrail()` (Memory + D1), not in PORT_METHODS;
  a port without it reports the section unavailable, never clean.
- Reviews and restore tests are append-only `SecurityReview` / `RestoreTest` records. The self-review
  check uses the server's own record of who acted. No new record grant: hr holds STAFF_ADMIN but has no
  clinical actor (pinned by wardsynq-rbac-4-13), so hr gets a clean 403 from the store; admin works.
  safety_officer was not given access: it is clinical-incident safety, not account security.
- Data protection is green only with a backup inside a configured RPO AND a successful restore test.
  The same verdict now appears in operational-health.
- Not built: ward/assignment reads (no assignment data), staff-as-patient (would need new PHI
  linkage), VIP flag (does not exist), denied READS (the service only audits denied writes).
- Backup export audit rows now carry `actor` (they landed as NULL before) and a row count.


## 2026-09-14 ICU Snapshot: Private Device OCR was starved and label-blind (branch icu-ocr-device-first)

Owner photographed a Philips IntelliVue MP40 (HR 105, SpO2 100, ART 149/66 (98), RR 22); on-device read
returned "couldn't auto-structure". Root causes, each proven on the actual photo with Apple Vision:
1. `compressImage` (900px, JPEG q0.6, built to cut CLOUD image tokens) ran BEFORE the device engine
   too. Vision is free per pixel; at 900px it never emitted "(98)" (MAP) and dropped small labels at
   some scales. Now `SMD_IMAGE_ENGINE.process({image, original})`: device OCR gets the uncompressed
   capture, AI Vision keeps the small one. Every ICU entry point threads `original`.
2. `usesLanguageCorrection = true` is a word model: "PHILIPS" -> "PHILIP!", digit runs -> letters.
   Off for numeric kinds (monitor/vitals/abg/labs/ventilator/all), on for case sheets. Plugin also
   returns per-line `conf`, and accepts `minTextHeight` (measured: not the limiting factor, 47 boxes
   at every setting).
3. `parseFieldsOnDevice` flattened the OCR to one line and took the first in-range number within 44
   chars of the label: on a monitor that is the upper ALARM LIMIT ("HR 120 50 105" -> 120) and the
   clock after the "** RR HIGH" banner (-> RR 20). Both reproduced on the fixtures. New
   `parseMonitorBoxes` pairs each label with the TALLEST in-range numeric box below/right of it, takes
   the tallest "SSS/DD" as pressure with "(MM)" as MAP, ignores alarm banners and hh:mm, and tolerates
   icon-glued values ("*105", "2° 100"). Two column rules for labels Vision drops (SpO2, RR): sole
   value-size integer in the pressure column in the expected slot, else nothing. MAP is never computed
   from SBP/DBP. Text-only path unchanged as the fallback.
Fixtures: `test/fixtures/mp40-vision-*.json` are the raw VNRecognizeTextRequest observations from the
photo at 900/1800/2700px. `test/icu-ocr-monitor-boxes.test.mjs` executes the real parser on them.
Not done: Scan-Meds' `onDeviceRead` still calls the legacy `readImage` (compressed image + scrubbed-text
cloud call); Android has no on-device OCR (no ML Kit bridge); Vision found "(98)" only at 2x, so a
two-scale union pass would raise recall further. Cloud tokens for this path: zero.
## 2026-09-14 Out-of-assignment reads (P2.17) and per-dependency system health (P2.15)

Out-of-assignment: `outOfAssignmentFindings` in `functions/_wardsynq/security-review.js`, returned as
`assignmentAccess` on `GET /ward/security-report`, shown in Admin > Security review.
- Assignment sources are the ones that already exist: NurseAssignment history (per admission) and the
  rota (`q_roster_assign` shift unit, matched to the admission's `location.ward` ignoring case, UTC via
  `wardsynq.utcOffsetMinutes`, default 330). No new assignment store.
- The join is on the pseudonymised patient reference already on each audit row; nothing new is written
  to the audit trail.
- Exemptions are explicit and listed on the report: the reader's own live break-glass grant, roles
  `lab, pharmacy, cashier, billing, radiographer, radiologist, blood_bank, him`, and the admission's
  `attendingId`. Everyone else (admin and supervisor included) is compared.
- No usable assignment data for a person (or anyone) in the period is `not_evaluated` with a reason. Any
  unreadable or capped source turns would-be flags into not-evaluated reads, never flags or clean.
- Known ceiling: only the admission's current ward is known, so a read before a transfer compares against
  the current ward. A Firebase user whose membership identity is an email, not the uid on the audit row,
  matches no assignment and shows as not evaluated.

System health: `functions/_wardsynq/system-health.js`, `GET /ward/system-health` (STAFF_ADMIN, bulk rate
tier), Admin > System health, playbooks in `docs/INCIDENT_RESPONSE.md`.
- Seven real probes under a 3 s timeout; failed or timed-out is `down`. Reasons are the module's own
  sentences, never provider error text (no keys or internal URLs).
- The last ops-tick run is recorded in the existing `MAIK_KV` binding (`wsq:tick:last:<tenant>`, outcome
  flags only, 30 day TTL) by the router; the domain module only receives a `lastTick()` function. No new
  env var or binding.
- MaiK probe is a model metadata read (Google) or `GET <localBaseUrl>/models`; it generates nothing.
## 2026-09-14 WardSynQ FHIR Bulk Data export (P2.5) runs on the outbox, walks the change stream, and names every gap

`functions/_wardsynq/fhir-bulk.js`, dispatched once in `fhir-route.js` `dispatchBulk` for both doors:
`[base]/$export`, `[base]/Patient/$export`, `$export-status/{id}` (GET, DELETE), `$export-file/{id}/{name}`
on `/api/fhir/{org}` (bearer) and `/api/queue/ward/fhir` (staff). Admin JSON: `POST /ward/fhir-export`,
`GET /ward/fhir-exports`, `POST /ward/fhir-export-cancel`. Admin Center tab "Data export".
- Who: a SMART backend-services token (source `smart:backend`, system/ scopes, no patient context), types
  limited to its readTypes; or staff.admin at the route AND a clinical actor that canRead every type
  (hr gets 403, as in the security review). No new capability, no grant widened. A client sees only its
  own exports; staff see the hospital's. A file download re-checks the type against the token.
- Work: kick-off appends job + slot + outbox event + audit in ONE append. ops-tick drains
  `fhir.export.chunk` (router waitUntil passes `exportConsumers`; the bearer door also ticks on status
  polls). Each run reads up to 10 pages of 200 rows of `repository.changes()`, writes one AES-GCM
  NDJSON part per type to the existing document object store (DOC_S3_*, doc key), appends the next job
  version with the next event. No new bindings, env vars or secrets.
- Snapshot rule: a row is exported when it is the version current at transactionTime (latest, or the last
  version at or before tx via history when edited mid-export). Rows after tx are skipped, so no duplicates.
- One active export per hospital via a versioned slot record (`_wardsynq_fhir_export_slot`); a racing
  second kick-off loses on VersionConflict (429). A job with no progress for 1 hour reads as failed and
  frees the slot; a run that fails MAX_ATTEMPTS times writes status failed with the reason.
- Nothing silently omitted: a record whose mapper throws is counted as `not-mapped`; hitting
  MAX_RESOURCES (200000) stops the job and names every requested type as possibly incomplete. Both go to
  an OperationOutcome NDJSON in manifest error[] and to `extension` on the manifest.
- Files expire 24h after completion (a `fhir.export.expire` outbox event scheduled at expiresAt deletes
  them); cancel deletes them at once. Kick-off, completion, failure, cancel and every download are audited;
  a download that cannot be audited is refused.
- Strict parameters: only `_type`, `_since`, `_outputFormat` (ndjson). `_typeFilter`, `patient` are 400 and
  POST kick-off is 405, never ignored. Group/$export is not offered (404).
- Not built: download buttons on the admin screen (files are fetched through the FHIR API with auth);
  a status index for the outbox (drainOutbox's latestByType ceiling still applies to a very busy tenant).
## 2026-09-14 Hospital groups (P2.14): only aggregate counts cross a hospital boundary

`functions/_hospital_group_store.js` (model + Firestore), `functions/_wardsynq/hospital-group.js` (counts),
routes `/api/queue/group/*`, Admin Center tab "Hospital group", page `#/group` (`wardsynq/site/pages/group.js`).
- A group is `q_groups/<id>` (name, adminUids, recommended policy) plus one `q_group_links/<groupId>__<orgId>`
  row per hospital, the way `q_members` sits beside `q_orgs`. States: invited, member, declined, removed.
  Member only after the group admin invites AND the hospital's owner accepts; either side can remove.
  Every change is committed in the same Firestore commit as its `q_events` audit row under the hospital.
- WHY ONLY COUNTS. Each hospital is its own data controller and its patients consented to that
  hospital, not to a group. A group needs to compare load (census, free beds, ED waiting, open critical
  results, staff short), and none of that needs a patient. Letting identifiers through would make the
  group a second, weaker door into every member's charts, with no membership, role or break-glass behind
  it. So the response is built field by field from five numbers; the test seeds names, MRNs, patient and
  record ids and asserts none appear. There is no drill-down by design.
- The counts are each hospital's own computation (summariseWard, bedStateCounts, listEd's ED filter,
  rosterStaffing) over that hospital's own repository, resolved from its org document. The authority is
  the owner's acceptance, re-checked on every call; it is a no-user service read like ops-tick, never a
  clinical actor, so a group admin still gets 403 on every chart, patient and record route. Every group
  read writes `group:summary_read` into the hospital's audit trail first; no audit row, no read.
- A count not read is null with `could_not_be_read`; not configured is `not_set_up`; a hospital with
  nothing readable is `unreadable`. Never zero.
- Group policy is a whitelist (`POLICY_KEYS`: clinical-practice settings only; never beds, people, money,
  legal agreements, integrations or credentials). A member hospital's admin adopts it as a one-time copy
  merged into its own `wardsynq` config, audited as `group:policy_adopted`. Nothing is inherited.
- Not built: adding a second group admin (the field holds a list; groups are listed by creator), group
  deletion, trends over time.
## 2026-09-14 Trends (P2.10) are computed from the record, not from a stored daily snapshot

`functions/_wardsynq/trends.js`, routes `GET /api/queue/ward/trends` and `GET /api/queue/ward/trend-events`,
screen: Digital twin -> "Trends" (`ward.js` trendsView). Tests: `test/wardsynq-trends.test.mjs`.
- No daily snapshot was persisted anywhere (ops-tick escalates criticals and drains the outbox only; the twin
  and quality.js say "computed, never stored"). Records are versioned and carry the times these measures need
  (stay start/end, report release, loop acknowledgement, dispense time, invoice ledger), so each bucket is
  computed on request. A snapshot written by ops-tick was rejected: it only exists from the day it starts, it
  drifts from the record when a discharge time is corrected, and it would be a second source of truth.
- Costs, stated on screen: each source type is read with the store's roster cap (1000); a type at the cap
  marks every bucket `coverage: "partial"` and the response `truncated` with a warning. A stay is attributed to
  the ward on its current version (not split across transfers). Occupancy uses today's bed count (registry,
  else `wardsynq.beds`) for past buckets. Walking every record's version history per request was rejected as
  too costly for the bounded read budget.
- Every point: value, numerator, denominator, coverage (`full`, `partial`, `none`). Unreadable source or
  missing configuration is `value: null` with a reason, never 0. Buckets use the hospital clock
  (`timeZone`, else `utcOffsetMinutes`, default 330) via mar-schedule.js's zone helpers.
- Definitions live once in `DEFINITIONS` and are returned with each series ("How this is counted").
- Authorization: series at the twin's `emr.view`; `billed-charges` (finance) also needs `billing.view`.
  trend-events returns record ids only, gated as record-detail (emr.view plus the governed read of each source
  type, where an unreadable type is 403, not an empty list) and additionally by the member's department scope
  for the ward (`authorizeOrg` target; a ward in no department fails for any scoped member; an unreadable ward
  registry is 503). Records open through record-detail.
- Not built: department-level event lists (the drill goes metric -> bucket -> ward -> records), per-transfer
  ward attribution, historical bed counts, and a precomputed cache for very large hospitals (add a snapshot
  only if the cap is routinely hit).
## 2026-09-14 Webhooks (P2.13): thin notifications, staged in the clinical write, delivered through the outbox

`functions/_wardsynq/webhook-events.js` (what a write is), `functions/_wardsynq/webhooks.js` (admin routes,
fan-out, delivery), routes `/api/queue/ward/webhooks|webhook|webhook-update|webhook-rotate|webhook-test|webhook-deliveries`,
Admin Center tab "Integrations" (Webhooks card). Test: `test/wardsynq-webhooks.test.mjs`.
- ONE CHOKE POINT, NOT ONE HOOK PER ROUTE. Every RecordService write reaches the repository through
  `TenantBackend.write()` in service.js, so events are recognised there by comparing each record with its
  previous version (admitted, transferred, discharged on admission-class Encounters; order.placed on a
  MedicationOrder/ServiceRequest becoming active; result.released on a DiagnosticReport status change or
  correction; critical-result.raised on a new CriticalResultLoop). The outbox row goes in the SAME append,
  before the records (the idempotency key binds to the last record). A failed or refused write emits
  nothing, and ADT/FHIR feeds emit exactly as the ward routes do. A hospital with no subscribed endpoint
  stages nothing; if the endpoint list cannot be read the event is staged anyway and fan-out decides.
- NO PHI, INCLUDING IN IDS. Canonical ids embed an MRN, an admission time or a test code
  (`wsq-adm-<mrn>-<time>`), so the payload carries `hashedId()` of the id, never the id. Its alias is written
  in the same append (new optional `ctx.aliases` on the repository port, Memory and D1) so the FHIR door
  resolves it for a receiver with its own SMART token. Body: id, type, occurredAt, hospital, resource
  {resourceType, id}, and a note. Residual: SHA-256 of a structured id is pseudonymous, not anonymous.
- FAN-OUT, THEN ONE OUTBOX EVENT PER ENDPOINT, so each endpoint retries on the outbox backoff and dies
  after `MAX_ATTEMPTS` without holding the others back. fhir-outbound.js was not reused: it is a queue of
  whole FHIR resources (PHI) with its own backoff, the opposite of a thin notification.
- ADDRESSES. https, no userinfo or local names, and no private/loopback/link-local/CGNAT/metadata/
  documentation/benchmark/multicast address, including IPv4-mapped, NAT64, 6to4 and Teredo forms. A name is
  resolved (DNS-over-HTTPS, injectable) and EVERY address must be public, at registration, re-enable and
  before every send. No redirect followed, 5 s timeout. Residual: the runtime's fetch resolves again, so a
  resolver changing its answer within milliseconds is not closed (no socket pinning in this runtime).
- SECRET: 32 random bytes, returned only by register and rotate, AES-GCM under the document key; no key,
  no webhook. Signature `X-WardSynQ-Signature: v1=hex(HMAC-SHA256(secret, "<timestamp>.<body>"))`, with
  `X-WardSynQ-Timestamp` and `X-WardSynQ-Event-Id`. Rotation has no overlap window (not built).
- AUTHORITY: staff.admin at the route plus a clinical actor that may write the record, the outbound
  destinations' gate, so hr is refused. Register, update, enable, disable, rotate, test and auto-disable are
  audited in the append that makes the change.
- LOG AND AUTO-DISABLE: one row per attempt (status, attempt, response code, our own reason word; never a
  response body) plus the endpoint's failure streak in the same append. 10 failures in a row spanning 30
  minutes turns the endpoint off as `auto-disabled`, audited, shown on the screen; re-enable clears it.
- OUTBOX FIX FOUND ON THE WAY: `latestByType` returns the OLDEST rows, so drainOutbox never saw a new event
  once 200 settled ones existed. Webhook volume would hit that in a day. `latestByType(..., { newest: true })`
  now serves drain and health. Still a scan with a ceiling; a status index is the upgrade.


## 2026-09-14 ICU monitor OCR v2: 2-D parser, colour + layout signals, strict NEEDS_REVIEW, benchmark (branch icu-ocr-bench)

Builds on PR #1112 (device OCR on the original image, box-aware pairing). New module `icu-monitor-parser.js`
(UMD: WebView `SMD_ICU_MONITOR`, Node tests, `bench/icu-monitor`). Apple Vision stays the only OCR; no
new OCR/AI model. Gemini is a fallback offered only after a NEEDS_REVIEW, only on a tap.
- Every field is decided from scored candidates over the observation graph (text, conf, box, height,
  colour): spatial, size, alignment, label, layout, colour, plausibility, weighted over the signals that
  are informative. AUTO_ACCEPTED needs confidence >= 0.80, a margin over the runner-up (0.20 when the
  rival is the same size on the same row), and >= 2 independent signals among label / layout relation /
  colour / label-glued value. Size alone or colour alone never selects. Otherwise NEEDS_REVIEW with the
  suggestion and its evidence, or NOT_FOUND. Nothing is ever derived: no MAP from SBP/DBP, no Pulse from HR.
- Colour is sampled ONCE (same JS) from the original pixels: canvas in the app, PIL dump in the bench.
  Per box: dominant hue cluster (15° histogram peak share), white as its own class, unreliable → neutral.
  Compared to the label colour (white label vs coloured value = neutral, not a mismatch) and to the
  waveform band beside the value; the band nearest the numerics wins over the full band.
- Layout is RELATIONAL (HR topmost and above the pressure, SpO2 between, RR below), not a fixed slot:
  Dräger puts TEMP before RESP, GE NBP before ART. Profiles (Philips/GE/Dräger/Mindray/Nihon Kohden)
  are detected from on-screen vocabulary and only shape expectations.
- Alarm limits: hi/lo pairs in one box, stacked pairs, or small numerics on the label's row; they stay
  in the candidate list (debug shows "120 → alarm limit") and lose on geometry, never on size alone.
- Pressures: the tallest SSS/DD with "(MM)" as MAP; TWO different readings (ART + NIBP) or a second
  pressure that could not be read make the primary NEEDS_REVIEW while `art`/`nibp` are reported
  separately. OCR repairs ("T18/76", "1 08/64") only ever produce a suggestion.
- POLICY (owner rules 16 vs 17 collide on the 2x Philips photo, where Vision dropped the SpO2 and RR
  labels): default STRICT = an unlabeled value is NEEDS_REVIEW even when slot and colour agree
  (suggestion shown). `unlabeledAuto` (app: localStorage smd_icu_unlabeled_auto=1; bench --policy relaxed)
  reproduces the 6/6. Reason: a yellow EtCO2 in slot 4 on another vendor would become RR silently.
- App: `readImageLocal` routes monitor kinds through the parser with the original pixels; only
  AUTO_ACCEPTED numerics fill; vitals are never auto-filled from flattened text; `r.monitor` carries
  per-field status/confidence/suggestion. `image-engine` offers AI Vision only when a core vital needs
  review, counts local_success / local_needs_review / gemini_fallback / gemini_success / gemini_failure /
  network_calls (`SMD_IMAGE_ENGINE.stats()`). Debug: localStorage smd_icu_ocr_debug=1 prints the evidence
  and draws the overlay (boxes, labels, selected, rejected, limits, association lines) on the review sheet.
- Benchmark `bench/icu-monitor/run.mjs`: 2 real (owner MP40 at 900px and 2x) + 39 synthetic screens
  (6 layouts, clean / limit-vs-value / high-acuity / tilt+glare / low-light+blur / partial+label-obscured
  / close-candidates; rendered with headless Chrome from bench/icu-monitor/fixtures/gen.mjs). Metrics per
  field: exact, recall, precision, FP, needs-review, silent-guess, safe; per manufacturer and layout;
  OCR/parse ms; network 0. Ground truth distinguishes visible / not_visible / ambiguous / not_applicable.
  Synthetic renders stand in for real de-identified photos of GE / Dräger / Mindray / Nihon Kohden, which
  we do not have yet; numbers on them measure layout handling, not photographic robustness.
Not done: Scan-Meds path unchanged; Android still has no on-device OCR; two-scale Vision union.


## 2026-09-14 ICU monitor OCR v2.1: two-pass confirmation is the safety mechanism, not thresholds (branch icu-ocr-bench, PR #1115 not merged)

- Two-scale Vision (full image + numeric-region crop at 2-3x) plus a third targeted read of large values
  still unconfirmed (scaled to ~110 px numerals). With two-scale on, a NUMBER auto-fills only if both
  reads agree (multi-digit tokens equal; glued icon digits like "2° 100" are not a disagreement, a split
  "1 08/64" is). The third read can only confirm or conflict, never add. If the second pass cannot run,
  nothing numeric auto-fills. Reason: a single pass read DBP 66 as 86 at confidence 1.0 on a 12°-rotated
  photo, and no image-quality signal caught it.
- Merge: a crop box belongs to a full reading only when inside it AND >= half its text height (limits
  and "(MM)" inside a value's rectangle are separate objects; folding them in created false conflicts).
- Tilt/perspective from Vision quadrilaterals is INFORMATIONAL: measured 0° at 5°, -7° at 12°, none at
  25°, 6° "perspective" on an undistorted photo. It never decides RETAKE/DEGRADED.
- Pressure AUTO requires an identified source (ART/NIBP label, fuzzy "ARTI" accepted, or glued in the
  box); the same rule for the primary and the separate ART/NIBP fields. Both displayed → primary review.
- Benchmark harness: the probe never degrades to Vision .fast (it produced "1491F6"); non-accurate runs
  are OCR failures, not data. Groups reported separately: real (1 photo), perturbed-real (21 derived
  from it, incl. the 2x regression fixture), synthetic (39). Sweep: 0 guesses even at conf 0.60, so
  thresholds were NOT lowered; they only trade recall for review.
- Environment gotcha: macOS Vision text recognition failed system-wide for ~30 min after aned restarted
  (e5rt create_precompiled_compute_operation); recovered on its own.
- RESOLVED by the independent digit verification gate (below). Was: one silent guess on the iPhone run (rebuilt plugin, 26 owner photos). owner-2d6f5cea RR shows 16
  (glare haze on the "6"); full pass read "15" conf 1, crop "= 15" conf 0.5, and every letterboxed
  re-read on the phone (scale 1.2-4, pad 1-2) also read "15". Tried and REJECTED (reverted):
  (a) confidence-gated confirmation (agreement counts only if both reads conf >= 0.8): iOS/macOS Vision
  conf is quantized 1 / 0.5 / 0.3 and correct reads sit at 0.3 ("° 105" on the MP40 2x, even a bare
  "105" in the confirmation read), so it blocked 34 Mac fields and failed the Philips 2x regression;
  (b) per-value background haze: 2d6f5cea 66-73 vs 87-97 on cc56af64 whose 7 AUTO fields are correct.
  Neither OCR re-reads nor confidence nor that pixel signal separates this misread. Side finding: phone
  Vision read only "RR" from a tight 251x198 crop whose "22" filled half the height, and "RR 30 22" at
  conf 1 when letterboxed 2x on black (not adopted; only needed by (a)).

## 2026-09-14 ICU monitor OCR: independent digit verification gate for RR (branch icu-ocr-bench, PR #1115 not merged)

- A second Apple Vision pass is not independent verification: identical passes repeat the same misread.
  RR AUTO now also needs `verifyDigits` (icu-monitor-parser.js) to read the same digits from the PIXELS:
  Otsu binarisation of the value box, connected-component glyphs, Pearson correlation against 20x20
  digit templates (16 sans-serif faces + seven-segment, `bench/icu-monitor/digit-templates.py`), hole
  topology as a consistency penalty. Result is verified / disagree / unsure; only verified auto-fills.
  It never proposes a value: a disagreement keeps OCR's reading as the suggestion (15 stays 15, never 16);
  no plausibility, no history. No pixels, too small (<14 px), low contrast → unsure → NEEDS_REVIEW.
- Default gated fields: RR (`VERIFY_FIELDS`); `opts.verifyFields` / bench `--verify` extend it. Why RR
  only: on the benchmark the RR gate changed exactly one outcome (owner-2d6f5cea RR 15 → review, the
  checker read "16") with no recall loss; gating HR/SpO2/RR/Pulse also stays at 0 guesses but loses
  real HR 7/14 → 6/14 and synthetic Pulse 20/27 → 5/27 (small glued Pulse digits, 10-13 px, "unsure").
- Measured against ground truth on 228 HR/SpO2/RR/Pulse value boxes: 0 wrong Vision reads verified.
  The synthetic group is likely rendered in a face close to the templates; judge on real photos.
- Bench pixel source now capped at 2400 px long edge, the same as the app's canvas (smdPixelSource).

## 2026-09-15 ICU monitor OCR pass 3: label recall + pressure-source safety (branch icu-ocr-bench, PR #1115 not merged)

- Baseline frozen on 268 cases (181 external, 40 human-confirmed). After: core-vital correct AUTO
  413 -> 535 (confirmed external 47 -> 87), NEEDS_REVIEW 844 -> 720, wrong/silent 0 -> 0 in every group;
  Philips MP40 regressions pass. Rule ablation (correct AUTO each rule adds, wrong without it always 0):
  look-alike label text +114 (Vision reads "ABP" as Cyrillic "АВP"), PAP +78, ECG-as-HR +33, colour +44,
  left-adjacent alarm limit (RR) +15, vocabulary (etCO2, Puise, 8p02) +8, one-label-per-reading -5
  (kept: refuses to let an unlabelled PAP inherit "ABP"), MAP consistency 0 (no displayed MAP in the
  benchmark is >25 mmHg off (SBP+2DBP)/3; displayed-vs-formula spread median 3, max 15.3).
- REVERTED (silent source error): mapping Cyrillic "І" to I turned a crop re-read "ПІВP" of an NIBP label
  into "IBP" = ART (ext-mocr-032 auto-filled NIBP as ART). Also found PRE-EXISTING: a clipped "NIBP" read as
  "IBP" at the photo edge auto-filled as ART (ext-mocr-036). Fix: plain "IBP" is not an arterial source
  (numbered "IBP1" is); an edge-touching source label is weak evidence. The scorer did not check sources:
  it now counts a wrong ART/NIBP source as a wrong value.
- Dropped as unused (0 effect): "rpm" unit as RR label; merge keeping a full-image label over a garbled crop.
- Bench: pixels retained only for regression cases (all-case retention exhausted memory).

## 2026-09-14 Ward keyboard layer and tablet round (P2.16): shortcuts navigate, they never write

- ONE DECLARATIVE MAP (`SHORTCUTS` in ward.js). Each entry focuses a field, shows the sheet, or sends an
  existing navigation verb through `dispatch()`, the same path a click takes. No write verb is bound, ever:
  a stray key at a bedside must not verify, give, acknowledge or sign. `test/ward-keyboard.test.mjs` runs
  every entry on the list and on a chart and fails on any non-GET request.
- NEVER WHILE TYPING. Inputs, textareas, selects and contenteditable swallow every shortcut; Escape there
  only leaves the field. A shortcut that would repaint is refused while the screen holds unsaved typing,
  because `paint()` replaces the overlay and discards uncontrolled values.
- THE KEYBOARD YIELDS to the forced acknowledgement screen (`#wsq-alert`), the discharge summary and any
  sheet that holds focus outside `#smdWard`.
- FOCUS IS NOT RESTORED to the pressed button after a repaint. Considered and rejected: a second Enter would
  repeat a write, and a reloaded round can put a different dose at the same index.
- TABLET (768 to 1180 px) IS CSS plus two wrapper divs in the round: 44 px targets, a sticky header carrying
  "next due", two panes in landscape. The next-due line is picked from the server's due times and the
  display-only NEXT table; it names nothing for an empty round and no dose at all when any dose was unreadable.
## 2026-09-14 FHIR depth (P2.5): terminology from what the hospital holds, IPS that tells empty from unreadable, AuditEvent and Subscription as views

`functions/_wardsynq/fhir-terminology.js`, `fhir-ips.js`, `fhir-audit.js`, `fhir-subscription.js`, wired in
`fhir-route.js` so both doors (`/api/queue/ward/fhir/...`, `/api/fhir/{org}/...`) answer the same paths.
Screens: Admin Center "FHIR" tab, Integrations webhook payload choice, ward chart "IPS summary".
Tests: `test/wardsynq-fhir-terminology.test.mjs`, `-ips`, `-subscription`. Strategy: `docs/FHIR_STRATEGY.md`.
- STILL R4 ONLY. R4B/R5 not served until a per-version mapper and validator exist; see the strategy doc.
- TERMINOLOGY IS A VIEW, NOT A RELEASE. The hospital's order-set investigations, formulary and the allergy
  class seed are our code systems (content complete; the seed is draft/experimental because it is unapproved).
  LOINC, HL7 systems and hospital-loaded codes (`wardsynq.terminology.codeSystems`) are served as FRAGMENTS under
  their owners' URIs and every expansion carries a warning. Hospital value sets come from
  `wardsynq.terminology.valueSets` (no new config key: `terminology` was already whitelisted); a code named but
  not held is left out and named. SNOMED CT/ICD with nothing loaded are not served at all. The external ICD
  D1 (`/api/icd`) is deliberately not exposed as a CodeSystem: it is a search aid, not a vocabulary we version.
- IPS: required sections always present. Readable and empty = emptyReason TEXT ONLY ("none recorded"), no
  list-empty-reason code, because a record with no allergy rows is neither `nilknown` nor `notasked`. A failed
  or refused read = emptyReason `unavailable`/`withheld` and no entries even if a sibling source read fine.
  No IPS profile in meta: nothing validates against it. Immunizations omitted: no canonical type. Results capped
  at the newest 100, said in the section text.
- AUDITEVENT: the security review's evidence envelope only, never resourceCounts/latency. SMART `system/`
  scope or staff.admin + a clinical actor; never patient/ or user/. The read is itself audited and refused if
  that audit write fails. Action words are our own `urn:stewardmd` codes, not mapped onto DICOM. Read by id
  scans the newest 20000 rows (ponytail; search with date= reaches older).
- CONSENT was already exported from PatientConsent; now pinned by tests on both doors.
- SUBSCRIPTION IS THE WEBHOOK, NOT A SECOND DELIVERY SYSTEM. A webhook registered with payload
  `fhir-id-only` gets the R4 backport id-only notification Bundle (same outbox, signature, retries,
  auto-disable) and is shown read-only as one Subscription per event type (`<endpoint>.<event>`, criteria
  `urn:stewardmd:fhir:SubscriptionTopic:<event>`). No FHIR create and no `$status`: management stays on the
  Integrations screen where the address checks and the secret live. `event-number` carries the outbox event id,
  not a per-subscription sequence (no counter exists); a receiver needing strict sequence cannot rely on it.

## 2026-09-14 Immutable audit retention (P2.17): triggers refuse, a hash chain detects, nothing deletes

`functions/_wardsynq/audit-chain.js` (chain, `verifyAuditChain`, `auditRetentionSetting`), both repositories
(`repository.js` MemoryRepository, `repository-d1.js`), triggers in `db/connect_schema.sql`, chain table in
`functions/db/wardsynq_schema.sql`. Screens: Admin Center > Security review (Audit retention > Tamper evidence),
System health ("Audit trail integrity"). Tests: `test/wardsynq-audit-chain.test.mjs`. Restore notes: `docs/BACKUP_DR.md` 1a.
- PREVENTION IS THE DATABASE, EVIDENCE IS THE CHAIN. BEFORE UPDATE/DELETE triggers on `connect_audit_event`
  (whole table: Connect/ABDM already promise no UPDATE/DELETE) and on the chain table. The chain catches what
  goes around them (dropped trigger, console, restore, import).
- THE HEAD IS ANCHORED OUTSIDE THE DATABASE. The background tick copies the head (`{seq, hash}`) at most once
  an hour per hospital into KV `wsq:auditanchor:<tenantId>` (last 200 `{seq, hash, at}`, no expiry), a separate
  trust domain from D1. `anchorHead`/`checkAnchors` in `audit-chain.js` take an injected KV-shaped store, so the
  domain logic has no platform coupling. System health ("Audit trail integrity") and the Security review compare
  every anchor against the row it names: a rebuild after an anchor reads `rewritten` (names the seq), a removed
  tail reads `truncated` (head below an anchored seq). An older anchor is never overwritten by a different hash
  for the same seq; that conflict is itself the finding. A failed anchor write never fails the tick or a clinical
  write; the outcome rides the tick log so health can show it. THIS CLOSES a rebuild or truncation AFTER an
  anchor. WHAT REMAINS: an attacker who controls BOTH D1 and KV can move both together; anything in the window
  before the first anchor; anchors are evidence, not prevention.
- SIDE TABLE, NOT COLUMNS. `wardsynq_audit_chain (tenant_id, chain_seq, audit_id, prev_hash, row_hash,
  legacy_boundary)`, one link per audit row the record repository writes (Connect's own audit writer is not
  chained). `connect_audit_event` is shared and live, and ALTER TABLE ADD COLUMN is not re-runnable under the
  on-prem boot that applies the schema files every time.
- row_hash = SHA-256(prev_hash || canonical JSON of the row AS STORED), with values normalised to the type the
  column returns, so what is hashed is exactly what is read back.
- CONCURRENCY: the head is read and the hash computed before the batch (SQLite has no SHA-256), so the guard is
  the PRIMARY KEY (tenant_id, chain_seq): the loser's whole batch rolls back and is retried (8 attempts, jittered),
  then a VersionConflictError. A guarded head-row UPDATE was rejected: in a D1 batch an UPDATE matching no row
  succeeds and the fork commits. Plus an in-process per-store, per-tenant lock, because a chart open fires many
  audited reads at once and without it they livelock on the key. ponytail: one chain per hospital serialises its
  audit writes.
- FAILS CLOSED: an audit row that cannot be chained is not written, and neither is the record write it belongs to.
  The chain table must be applied BEFORE deploy; the record-store probe checks it.
- GENESIS ERA: rows before the chain are unchained. Link 1 stores the newest legacy row id and its prev_hash is
  derived from it, so the boundary cannot be moved without breaking link 1.
- VERIFY never says ok on a failed or short read: ok / empty / broken (row, expected vs found) / gap (missing
  link or missing audit row) / not_verified. Bounded: newest 1000 rows in Security review, 200 in System health;
  not_verified is "down" in System health.
- RETENTION: `wardsynq.auditRetentionYears`, informational only. India defaults to 3 years citing Indian Medical
  Council regulation 1.3.1 (the citation documents.js already uses); other regions "not configured, kept
  indefinitely". No deletion procedure exists; one would be separate, audited and owner-only.
- FOUND ON THE WAY (migrate-inpatient.js claimBed): the bed claim only caught two admissions that read the claim at
  the same instant. One reading it just after another's claim landed, before that Encounter was written, admitted a
  second patient to the bed. Surfaced because audited reads now take real time in tests. Fixed: a claim naming
  another admission that is open in the bed, or unwritten and under 2 minutes old, is occupancy; a failed Encounter
  write releases its claim. A crashed admission holds the bed for up to 2 minutes.
## 2026-09-14 Patient portal gaps: queue status, released documents, full discharge summary

All three extend P2.9 (`functions/_wardsynq/portal-view.js`); no new record type and no parallel release concept.
- SECTIONS gains `status`, `discharge-full`, `documents`. A patient's own grant sees all of them; a proxy only what
  its grant names (the enrolment screen offers each). Existing proxy grants see none of the new sections.
- QUEUE STATUS: `POST /api/portal/queue`. Tickets are linked the way the queue files them
  (`opd-identity.js patientIdForTicket`, from the MRN), today's sessions of THIS hospital only. If the matched
  tickets, or the patient record's MRN, carry more than one MRN spelling (two spellings slug to one patient id),
  nothing is shown and the patient is told to ask at the desk. Output per own ticket: room or department label,
  state, a count ahead, and the ETA the queue model already stored (`etaStart`, only while still in the future),
  else "no estimate". The queue has no token number, so none is shown. The read is audited as `record.read` of
  `QueueTicket` under the reader's id.
- RELEASED DOCUMENTS: a `PatientRecordRelease` with `kind: "document"`, `documents: [{id, version}]`, and a reason
  or consent reference, written by `POST /ward/document-release` (EMR_TREAT; patient taken from the document).
  Refused for a withdrawn, purged or past-retention document. `POST /api/portal/document` streams bytes through
  the existing decrypt and sha256 check only while the named version is released and the document's LATEST
  version is current and within retention; every download writes a `document.download` audit row (via
  `patient-portal`) and is refused if that row cannot be written. A withdrawn document stays as a titleless
  "withdrawn by the hospital" line. No object key or URL reaches the browser.
- FULL DISCHARGE SUMMARY: the release's discharge entries carry `scope` (`patient-copy` default, or `full`) chosen
  on the Patient copy screen. Old releases have no scope and stay patient copy. A full release shows every
  section except `provenance` (a note to the signer). Withholding reuses #940's assembled copy: while ANY result
  is withheld (open critical loop, preliminary, sensitive) `investigations` and `assessment` are withheld, and
  while any condition is differential or refuted `diagnoses` is. ponytail: free text cannot be checked result by
  result, so this is coarse; per-result redaction would need structured summary sections.
- Correction rule unchanged: only the latest version of a note is shown, and only if a release named it.
- Portal strings for the new sections live in `wardsynq/site/i18n.js` (English and Hindi); portal.html now loads it.

## 2026-09-14 OPD token numbers: allocated in the ticket's own commit, never changed, never reused
- A queue ticket gets `token` (display string), `tokenNo` and `tokenScope` in `_queue_engine.js addTicket`. The
  counter is `q_token_counters/<hospital>__<OPD day>__<scope>` (the session's date). The counter increment
  (compare-and-set on its `updateTime`, or create-if-absent) and the ticket create go in ONE `fsCommit`, so a
  failed commit burns no number and no ticket exists without one. A lost race re-reads; after 5 tries the
  desk gets 409 `token_contention` rather than a possible duplicate.
- Stability: only `addTicket` writes the token. Move, reassign, room routing, priority, send-back and recall
  patch other fields. The counter only rises, so a cancelled number is not reissued. A new day is a new doc.
  Tickets from before this have no token and are not backfilled.
- Scope config is a top-level org field `tokens: { scope: "hospital"|"department", prefixes }` in
  `_opd_org.js org()` beside `thresholds` (an OPD setting, not ward config), edited on WardSynQ Admin >
  Hospital. Department prefixes are 1 to 3 letters/digits, keyed by the ticket's department name,
  case-insensitive; no prefix means a plain number. Default: one sequence for the whole hospital.
- The waiting-hall wall (`displayBoard`, `/api/queue/display`) now shows tokens ONLY; the first-name-plus-
  initial projection is gone. An old ticket there reads "Patient". Staff screens (queue.js, opd.html) show the
  token beside the name. SMS/WhatsApp "registered" and "next" lead with "Your token: X" (a token names nobody).
  Patient portal and the /queue link page show "Your token: X" for the patient's own ticket only.
- Not built: no recall out of `no_show` (it is terminal; "recall" today is called -> waiting -> called).

## 2026-09-14 Hospital connectors (owner S2, S4, S5, S7): pluggable per hospital, secrets sealed, nothing trusted from a browser

### S7 Vertex AI is the PHI provider (functions/_wardsynq/maik-gateway.js)
- Two halves of approval. PLATFORM: `PHI_CAPABLE = wardsynq, local-openai, vertex`; a hospital cannot widen it,
  so `phiApproved: ["gemini"]` (AI Studio, no data agreement) now permits nothing and the refusal says so.
  HOSPITAL: `wardsynq.maik.phiApproved` as before (the owner wrote `wardsynq.ai.phiApproved`; the existing key is
  `maik`, kept), default none. Admin > MaiK clinical AI's cloud switch writes `["vertex"]` only.
- Patient data reaches Vertex ONLY through the project's regional endpoint
  (`<GCP_LOCATION|asia-south1>-aiplatform.googleapis.com/v1/projects/<GCP_PROJECT>/locations/...`) with an OAuth
  token for `GCP_SA_EMAIL` (Workload Identity Federation, or legacy SA key). These are the bindings
  functions/api/ai already uses for MaiK in production (vault/modules/MaiK.md: "Vertex (prod only)"); no binding
  added. The token code mirrors the AI route rather than importing a route file (same choice as _fundx_ai.js).
- Why not express mode for PHI: no project, no region, no residency (2026-09-10 entry), and the project's API
  keys are restricted to the Gemini API by org policy (Connect Agent note), so it answers PERMISSION_DENIED in
  production anyway. Non-PHI calls keep express mode while a key exists, so the Connect agent brain and the eval
  harness are unchanged.
- A server without the project bindings: Vertex is not PHI-capable, maikStatus names the missing bindings and
  the Admin screen shows them. NOT verified: that gemini-3.6-flash is served in asia-south1 for this project.

### The connector pattern (functions/_wardsynq/connectors.js), shared by S2, S4, S5
- One record type `_wardsynq_connector` in the tenant repository (append-only, versioned, like webhook endpoints):
  `{kind, provider, name, settings, secretsEnc{key: sealed}, secretsSetAt, active}`. Kinds and providers are
  code (`KINDS`), each provider declaring `settings[]`, `secrets[]`, `validate()` and optionally `test()`; the
  Admin > Integrations forms are drawn from that catalogue. Singleton kinds (dicom, payment) have id = kind.
- Why the repository and not the org document: the org whitelist passes config through unvalidated, has no
  version check, and is readable wherever the org is read. A connector needs sealed credentials, optimistic
  concurrency and an audit row in the same append. Existing org fields (`imagingViewer`, `payers`) stay as the
  fallback so no hospital's configuration stops working.
- Credentials: sealed with the document key (webhooks.js sealSecret, now exported), never returned by any route,
  opened only where an adapter uses them. A save carrying new credentials only is audited `connector.rotate`;
  others `connector.create/update/enable/disable`; `connector.test` for tests. Scope names keys and hosts only.
- Gate: staff.admin at the route plus a clinical actor that may write the record (the webhooks' double gate).
- URL settings pass webhooks.js checkDestination at save (https, no private/metadata address, every resolved
  address); each adapter checks again before calling and never follows a redirect.

### S5 DICOMweb (functions/_wardsynq/dicomweb.js)
- Settings: QIDO-RS base (required), WADO-RS base, auth none/bearer/basic with the credential sealed, a viewer
  template, or an OHIF base that becomes `<ohif>/viewer?StudyInstanceUIDs={studyInstanceUid}` (OHIF docs).
- Viewer placeholders are now `{studyInstanceUid}`, `{accession}` (and the older `{accessionNumber}`).
  `{patientId}` (the MRN) was WITHDRAWN from imaging-viewer.js: owner rule, no name or MRN in a viewer URL. A
  hospital whose org template used it now gets "template_unsupported_placeholder" and no link, stated.
- Test connection = one `GET <qido>/studies?limit=1`, Accept `application/dicom+json` (PS3.18 10.6), 5 s, no
  redirect. Reports passed/failed, HTTP status, study count; the body is never returned (it names a patient).
- WADO-RS is stored configuration only; nothing retrieves pixel data (dicom.js position unchanged).
- NOT verified against a real PACS; mocked transport only.

### S4 Payers and TPAs (functions/_wardsynq/payer-connectors.js, wardsynq/wardsynq-nhcx-adapter.js)
- The registry stays wardsynq-tpa-adapter.js `adapterForPayer` with injected kinds; kinds are now `fhir-claim`
  (existing adapter), `nhcx`, `manual`. Payer connectors (id `payer-<ref>`) become registry payers with
  `auth.connectorSecret` (document-key seal, opened in billing.js sealedCredentialAuthorizer at send time);
  `wardsynq.payers` entries keep `credentialRef` (Connect envelope). Same id: the connector wins, no merging.
- claim-state, preauth and claims read the merged registry; a registry that cannot be read refuses with 502
  rather than recording the payer as "not configured".
- NHCX, verified from the HCX Protocol OpenAPI and the NRCES IG: `/claim/submit`, `/preauth/submit`, JWE body
  with `alg RSA-OAEP`, `enc A256GCM`, `x-hcx-sender_code`, `x-hcx-recipient_code`, `x-hcx-api_call_id`,
  `x-hcx-correlation_id`, `x-hcx-timestamp`; ClaimBundle is a Bundle of type collection. The adapter builds
  that envelope and SENDS NOTHING (`not_configured`, with the list). Missing: JWE encryption with the
  recipient key from the HCX registry, NHCX profile URLs and mandatory elements, participant authentication
  and gateway URLs, and an on_submit callback route. Those need NHCX onboarding; the hospital submits through
  the payer portal meanwhile.

### S2 Payment gateways (functions/_wardsynq/payment-gateways.js, payment-links.js)
- Contract per gateway: createPaymentRequest, verifyWebhook (raw body), parseWebhook, fetchStatus, refund.
  Shipped: `manual` (default, no link), `razorpay` (Payment Links), `stripe` (Checkout Sessions). Endpoints,
  auth, amount units and signature schemes were read from the official docs on 2026-09-14 and are listed in the
  file header. Only currencies with a 1/100 minor unit are accepted; any other is refused, never guessed.
- A link is a `_wardsynq_payment_request` record (invoice, amount minor, currency, gateway reference), one open
  link per invoice, created by billing.charge. It records nothing on the invoice.
- `POST /api/queue/payment-callback/<orgId>` is public by design (the gateway has no session). The invoice is
  marked paid only when: the signature verifies with the sealed webhook secret, the event is a paid event for
  a request this hospital issued with the same gateway reference, the gateway's own API (this hospital's key)
  says that reference is paid, and amount and currency equal the request exactly. Otherwise the request is
  flagged (audited `payment.callback.flagged`, shown on the cashier screen), the invoice untouched, 200 so the
  gateway stops retrying. A transient failure (gateway API down, a version conflict) answers 503/409 so it
  retries. A bad signature writes nothing, so the public door cannot grow the audit chain.
- Why fetchStatus as well as the signature: a leaked webhook secret alone must not be able to mark bills paid.
- The ledger payment is posted by a SERVICE actor (`service:payment-gateway`, write scope Invoice only) with
  `reference <provider>:<paymentId>` and `collection.capture "integrated"` via applyAdapterResult, the only
  path that produces it. Idempotency is the reference on the ledger plus the request status: the invoice
  write and the request update are two appends, and a retry completes the second.
- NOT built: gateway refunds from the cashier screen (adapter refund() exists and is contract-tested; the
  ledger refund is still entered by hand), partial payments, and a rate limit on the public callback (a bad
  signature costs one org read and one HMAC). NOT verified against live Razorpay or Stripe.
## 2026-09-14 D5: a full discharge summary is withheld entry by entry (owner chose B)
Supersedes the coarse part of "FULL DISCHARGE SUMMARY" above for summaries signed from now on.
- ENTRIES ARE WRITTEN WITH THE DRAFT. `migrate-discharge.js structuredSections` stores `structured.diagnoses`
  (conditionId, active/closed group, whether it was a diagnosis, the problem-list line) and
  `structured.investigations` (serviceRequestId, code, the request line) on the ClinicalNote, beside
  `editedSections`, and signing carries it. Each set records the section `text` it describes.
- JUDGED WHEN THE PATIENT READS. `portal-view.js structuredSection` over `patient-record.js withholdingFacts`
  (the reports #940 withholds, the never-release codes, the conditions that are diagnoses now), read fresh.
  An investigation is withheld when a withheld report answers its request (or shares its code when the report
  names none) or its code is never-release; a withheld report tied to no entry and not known to be another
  stay's withholds every entry. A diagnosis is withheld unless it was one when signed and still is. A withheld
  entry keeps its place and group and becomes "One entry is withheld here ... Please ask your care team." No
  reason category, no name, no id. Acknowledging a loop releases only that entry.
- FREE TEXT STAYS COARSE. The assessment, any section without entries (every summary signed before D5), and a
  section whose stored text no longer equals the entries' `text` (a clinician rewrote it) keep the old rule.
- FAILS CLOSED. Facts are read without #940's catch-to-empty; an unreadable read withholds every guarded entry
  and section (previously a failed report read inside assemble() looked like "nothing withheld").
- PREVIEW IS THE PORTAL. `patient-record.js portalPreview` runs the portal's own function over releases on file
  plus the pending handover, per scope; GET /ward/patient-copy and POST /ward/patient-release return it, and the
  Patient copy screen draws it with `portal.js dischargeSection` (portal.js and i18n.js now load in both
  index.html files). Staff only, `w-noprint`. English, as the patient's own access sees it.
- Not built: sensitivity is still by report code only; a Condition whose code is on `neverRelease` is shown, as
  in #940's patient copy.
## 2026-09-14 FHIR: immunizations, ward Groups, Subscription create, and R4B/R5 by fhirVersion (G6, G9, G10, D9)
- G6: `Immunization` is its own append-only record type, granted with EMR_VITALS. The vaccine is free text;
  no catalogue is shipped. A code needs a known system (CVX added to terminology.js as a system). Not-done
  needs a reason; a wrong entry is withdrawn as `entered-in-error`, never deleted. IPS immunizations section is
  always present (none recorded / unavailable / populated).
- G9: FHIR Group is DERIVED, never stored: one per ward with an open encounter (`ward-<hash of ward name>`),
  because the record has no patient-group concept and a maintained cohort list would be a second source of
  truth. A Group export freezes members on the job at kick-off. A census at the pool cap refuses rather than
  exporting part of a ward. POST kick-off takes a Parameters body only. Admin downloads reuse `$export-file`.
- G10: `POST Subscription` goes through `registerWebhook()` unchanged, after narrowing to exactly what is
  delivered (rest-hook, fhir+json, id-only, one published topic, no header, no end, no other extension);
  anything else is a 422 naming the element. Secret returned once in `X-WardSynQ-Webhook-Secret` (no
  Subscription element may carry it). Staff door only. `$status` returns no event count.
- D9 (owner answer B, supersedes "R4 only until a partner asks"): version by the `fhirVersion` MIME parameter,
  default R4. Separate validator tables per version (`TABLES` in fhir-validate.js): R4B derived from R4 by the
  published diff; R5 GENERATED from the R5 StructureDefinitions by scripts/fhir-gen-validator-tables.mjs. R5
  renders Patient, Encounter, Observation, Condition, AllergyIntolerance, MedicationRequest, Immunization;
  every other type, and any answer that fails the version's tables, is a 406 naming it. Writes, bulk export,
  Subscription create/$status are R4 only (415/406). R5 drops Immunization.recorded and sends a missing
  Condition clinicalStatus as `unknown`; both are stated in the R5 CapabilityStatement. See docs/FHIR_STRATEGY.md.

## 2026-09-14 S6 phase A1: the ABDM hospital profile is a per-hospital connector (owner A1-A5)
Design: `docs/emr-gap-analysis/S6_ABDM_INTEGRATION_DESIGN.md` (sections 3.1, 3.2, 4.2, phase A1).
- **Storage: the connector framework, not `connect_connector_config`.** The profile is the singleton `abdm`
  connector (`functions/_wardsynq/connectors.js` kind `abdm`, provider `shared-bridge`, record
  `_wardsynq_connector/abdm`). Reasons: it is already per hospital, versioned and append-only in the WardSynQ
  record, audited in the same append, gated by staff.admin plus a clinical actor, and seals credentials under
  the document key. `connect_connector_config` is a Connect D1 table with no version history or chained
  audit, sealed under a different key. Cost, for phase A2: the v3 branch's `resolveHipTenant` reads
  `connect_connector_config` rows; it must read this connector instead (or a projection written beside it).
- The framework's `validate` hook now receives `{ org, previous }` (the saved settings of the same provider),
  so a kind can check against the hospital record and enforce transitions. Existing validators ignore it.
- Rules (pure, `functions/_wardsynq/abdm-hospital.js`): HFR facility ID is `IN` + 10 digits and must equal the
  org's `regionProfile.hfrId` (one source of truth; the Hospital tab now edits it); HIP/HIU IDs are a
  conservative character shape only (format UNVERIFIED); status `draft -> submitted -> sandbox-linked ->
  production-linked -> suspended`, `submitted -> draft`, `suspended -> draft`; the IDs freeze once linked.
- Owner answers S6, 2026-09-14:
  - A1 shared StewardMD bridge, each hospital links its own facility. The kind declares no secret; a secret
    sent with a save is dropped. No own-bridge field is built or shown.
  - A2 all production ABDM traffic held until India-region hosting from the AWS move exists. The
    `production-linked` transition is refused and the checklist says "Awaiting India hosting".
  - A3 the orchestrator merges `feat/abdm-v3-reconcile`; A1 work stays in new files.
  - A4 records received from ABDM under consent stay in the chart, marked as received under that consent, even
    after withdrawal. No erase flow. (Shown on the ABDM card.)
  - A5 role rule for the later ABHA desk phase: billing and front desk staff may create new ABHA numbers by
    Aadhaar OTP as well as verify existing ones. Not built in A1.
- The checklist never says verified: "entered" (typed by the hospital, not checked against ABDM), "missing",
  "mismatch", "not built" (session check, sandbox run, counters, DPDP confirmation), "blocked" (production).
- NOT built: any ABDM gateway call, the "Check session" action (A2), per-tenant gateway identity, audit of the
  from/to status beyond the versioned record, and a UI to set a doctor's registration number here (Staff tab).
## 2026-09-14 S3 P0: critical results pushed to hospital staff phones, server-side, behind a hospital setting
- Off unless the hospital sets `wardsynq.alerts.push.enabled` (Admin > Hospital > Critical result alerts). No env
  var. With it off every loop records NO_CHANNEL exactly as before.
- Recipients (`functions/_wardsynq/alert-recipients.js`): cumulative ladder of ordering clinician, on-duty roles
  from the rota for the patient's ward, and named contacts. Default ladder approved by the owner, Dr Manoj
  Kurmana, 2026-09-14 (O5); the approval is stored on the defaults and dropped when a hospital sets its own.
  There is no nurse-in-charge role, so the default overdue tier uses every nurse on duty in the ward.
  NO_RECIPIENT is recorded on the loop and shown on the board and the Admin card, never "sent".
- Devices: `DeviceDirectory` port (`device-directory.js`) over any get/put/delete store, KV today
  (`push:who:<orgId>~<identity>` -> token ids, `push:notice:<nid>` -> {orgId, tenantId, loopId}). Bound by
  `POST /api/push/register-member` with the identity derived from the credential; unbound on PIN/password
  change, reset, disable/remove and sign-out-everywhere; bind and unbind audited in q_events.
- Payload (O3): fixed title, body naming ward and bed only, data `{type, v, nid, kind, urgency}`. Never the
  patient name or MRN. Detail from `GET /api/push/notice/<nid>` for addressees only (404 otherwise), with a
  read-log row and audit row written first; no row, no detail.
- Everything about delivery lives on the loop record (`notifications[]`: nid, level, recipients, noDevice,
  sent, total, receipts, sms). SENT is never delivered; acknowledgement stays `/ward/acknowledge`.
- Timer: worker cron `*/5` POSTs `/api/queue/ops/tick-all` (admin token), same 2-minute gate as traffic;
  `WSQ_TICK_OFF` stops both. Decline sends the next tier immediately.
- SMS fallback (O4): a notice with no `delivered` receipt after its level's window goes once by SMS through
  the hospital's DLT template on 2Factor (`alerts.sms.senderId`, `alerts.sms.templateName`; VAR1 ward, VAR2
  bed; existing `TWOFACTOR_API_KEY`), to each recipient's `alertMobile` on their membership. Anything missing
  is recorded on the notice as SMS_NOT_CONFIGURED and named on the Admin card.

## 2026-09-14 ABDM V3 merge (owner A3): one scheme, no deploy vars, production held, one landing
`origin/feat/abdm-v3-reconcile` merged into `wardsynq-product` on branch `abdm-v3-merge`. Checklist:
`docs/emr-gap-analysis/S6_ABDM_INTEGRATION_DESIGN.md` section 2. The branch itself was not touched.
- **SCCM**: one 1.1 with administrations, serviceRequests, consents, immunizations, invoices (all optional,
  additive). The branch had kept 1.0 while adding two collections; the product had bumped to 1.1 for three.
- **Env**: `ABDM_ENV` with host-only bases is the only scheme; `ABDM_GATEWAY_URL` removed from the connect
  route (a base with a path doubled every V3 path).
- **Identity out of deploy config**: the branch's five ABDM vars were not added to `wrangler.toml`. The sandbox
  bridge id and facility id sit on the sandbox entry of `config.js` ENVS; production has no identity in code, so
  a production deploy cannot inherit sandbox identity. Per-hospital production IDs come from the `abdm`
  connector profile when phase A2 wires `abdmConfigFor`. An env override is still read (tests, local receiver).
- **A2 enforced in code**: `gateway.js` refuses the production gateway host before the session call.
- **Requester**: the consent route resolves the doctor with `resolveClinicalActor` and sends
  `{type:"REGNO", value, system:"https://www.mciindia.org"}`; no registration number is a 422 naming the fix.
- **One landing path**: the V3 HIU data push gets its own receiver (`/api/connect/abdm/hiu/data`) that ends in
  the same `makeConsumeAndLand` as the V0.5 ingress. `LANDABLE` adds Immunization and Invoice.
- **Immunization, one record type**: the branch's OPD capture is a queue timeline kind (IG-coded, for the OPD
  HIP source), not a record type, so it stays. What ABDM LANDS files as the product's `Immunization` record.
  The IG catalogue (`_vaccines.js`) and the ward chart's free-text rule (`immunization.js`) both stand: the
  first is what ABDM conformance requires of what we SEND, the second is how the ward records a dose.
- **External invoice is not an Invoice**: filed as `ClinicalNote` `external-invoice` with the sender's invoice
  verbatim, because reports, trends and the payment desk sum `Invoice` rows.
- **A5**: `ABHA_DESK_ROLES` in `_queue_roles.js` (reception, cashier and billing create and verify). Not enforced
  until the ABHA desk phase moves M1 off Connect membership.
- **Fidelius**: the branch's HKDF over the Weierstrass x is the only copy (the product never changed it).
## 2026-09-14 D7 B: OPD tokens per department, keyed by departmentId (owner chose B)
Extends "OPD token numbers" above; allocation is still in the ticket's own commit.
- A DEPARTMENT IS ITS q_departments ID. Counter `q_token_counters/<hospital>__<day>__dept-<departmentId>`; prefixes
  `org.tokens.prefixes[<departmentId>]`; `org.tokens.deptAliases{<name lower-cased>: departmentId}` maps the
  names an EMR import or a doctor session uses. A rename keeps the sequence and the prefix. Old name-keyed
  prefixes are still read by name until the Admin card resaves by id (stale ones are listed on the card). A
  department with no prefix falls back to its own code when that code is 1 to 3 letters/digits.
- Continuity at deploy: a department's first allocation of the day under the id key continues a counter already
  running today under the old name-slug key, so no C-001 is issued twice on the day this ships.
- WHERE THE DEPARTMENT COMES FROM, server-side in addTicket (`_opd_org.js resolveTokenDepartment`): the desk
  picker's departmentId (exact or refused 422 `department_not_found`, never guessed), then the room's
  departmentId, then the ticket's own department name (import row), then the session's name. Deviation from
  S3 design 4.3: the ticket's own name comes BEFORE the session's, because an import row names that patient's
  department and a doctor session's free text does not.
- M.room carries `department`, filled from q_departments on every store read and never stored on the room.
  Room sessions stay keyed with department "" (as they always effectively were), so filling the name did
  not move any room onto a new session id mid-day.
- A ticket routed to another department's room takes that department's id and name and KEEPS its token; the
  wall shows the issuing department beside such a token and groups rooms by department in department scope.
- SMS/WhatsApp "at <dept>" uses the ticket's department before the session's (a pool session has none).
## 2026-09-14 D14: per-department numbering requires a prefix per department; nothing numbered without one
- `_opd_org.js tokenScope` in department scope refuses, before any read or write: no resolved department
  (422 `token_department_required`, the offered name returned so an import can name it) and a department whose
  effective prefix (own, legacy name key, or a 1-3 character code) is empty (422 `token_prefix_missing`). The
  `dept-none` counter is gone; hospital scope is unchanged.
- `POST /org/update` with `tokens` refuses 422 `token_prefixes_required` (problems listed by department name)
  while any ACTIVE department lacks a prefix, two share one, or an alias points at no active department.
  Creating a department is NOT refused: a department that issues no tokens (Laboratory) may have none; the
  desk is refused for it with a sentence naming the Admin card instead.
- `POST /patient/register` with `forQueue` checks the same BEFORE issuing an MR number ("pool" needs the picked
  department; "session" only checks a picked one, since the room or session may supply it). The queue add
  still decides; this is only the early answer so a patient is not registered and then left unqueued.
- An EMR import returns `issues[{reason, department}]` for refused rows (department names only) and the app
  shows them once per distinct message.
## 2026-09-14 D13: a no-show is recalled with the same token (recommendation applied; owner did not answer)
- `no_show -> waiting | called` in `_queue_eta.js`, and `no_show` is no longer terminal: marking a no-show no longer
  bumps tokenVer, so the patient link keeps working and `queue.html` says "Your token was called ... go to the
  front desk". `noShowAt` starts the window. Its OPD Encounter is not closed on no-show (a closed Encounter can
  never reopen); a never-recalled no-show stays "planned" in the record. Not built: closing it when the window ends.
- ONLY `POST /no-show/recall` leaves no_show (`/status` answers 400 `use_recall`). It needs `queue.reorder`
  (the recall jumps the patient to the head of their priority band, which is a reorder; reception can mark a
  no-show but not recall), a reason, and the window: 4 hours from noShowAt or the session end, whichever is
  first (409 `recall_window_passed` / `session_ended`). The ticket patch and the `recall_no_show` q_events row
  (actor, ts, meta {to, reason, noShowAt, token}) are ONE commit guarded on the ticket updateTime, so a recall
  without its audit row cannot exist and two desks cannot both recall.
- `GET /no-show/list?sessionId=` (app doctor queue) or `?orgId=&date=` (console, every queue that day) lists the
  recallable ones (queue.view). Screens: "No-show" on called rows in opd.html and queue.js; "No-shows" sheet on
  the console toolbar; the recall panel on the app timeline. Not built: the app front-desk view has no recall
  list, and no "next" message is re-sent on recall (n_stage is monotonic).
## 2026-09-14 D11 A: per-hospital clinical settings template (Admin Center > Hospital)
- `functions/_wardsynq/clinical-settings.js` (pure) owns six settings: highAlertDrugs, antibiotics,
  orderVerifyWithinHours (1-168 h), edReassessMinutes (acuity 1-5, 1-1440 min), patientAccess.enabled, rpoMinutes
  (5-10080). `GET|POST /org/clinical-settings` (staff.admin, WardSynQ hospitals only, 409 otherwise). A save
  refuses any unknown key (so criticalEscalation, owned by the alert-path branch, cannot be written here),
  returns 422 errors keyed by setting with nothing written, and answers with the server read-back.
- ONE template, "not-configured": every setting explicitly empty/off. WardSynQ ships no drug list or clinical
  interval (that would be unapproved clinical content, D10); each consumer already says "not configured".
  The template only fills the form; Save is the write, and the templateId rides the audit row.
- Audit in the SAME commit as the change (`ORG.updateOrg` optional auditEvent): action
  `org:clinical_settings`, meta {changed: [setting names], template}; values are not in the audit row. A save
  that changes nothing writes nothing. patientAccess keeps its other fields (code/session lifetimes).
- FIX: `orderVerifyWithinHours` was missing from the org whitelist, so surveillance.js could never evaluate
  "active order not pharmacy-verified" for any hospital.
- Not built: optimistic concurrency on org saves (two admins saving at once, last write wins, as for every
  org update today).
## 2026-09-14 D10: clinical seed data sign-off by Dr Manoj Kurmana, per item, by content fingerprint
- Seed lists read from the modules that use them (`functions/_wardsynq/seed-signoff.js`): allergy classes and
  cross-reactivity, dose ceilings, default critical limits, the critical threshold seed, PEWS bands, MEOWS bands,
  NEWS2 escalation and responder ladder, quality measure definitions. Each item has a SHA-256 of its canonical
  content (function bodies included). Other UNAPPROVED seeds (consent and population intervals, incident
  categories, MLOps promotion defaults, emergency recognition) are not listed yet.
- A sign-off is `q_seed_signoffs/<list>__<item>__<fingerprint prefix>`, created once with its `seed:signoff` audit
  row in the same commit, text "Signed off by Dr Manoj Kurmana, <date>, version <seedVersion>#<hash12>". A record
  for other content does not match, so changed content is UNAPPROVED again. No revocation route (not asked for).
- `POST /seed/signoff` is the platform owner only (StewardMD owner account; a hospital owner or admin is 403),
  in the name SIGNATORY only (422 otherwise), with `attest: true`, and the contentHash the signer was shown (409
  if the content differs). `GET /seed/status` for the platform owner or a hospital staff.admin (?orgId=).
- Admin Center > Clinical seed data (WardSynQ hospitals) marks every unsigned item UNAPPROVED; a failed load says
  treat every item as unapproved. This build signs nothing. Signing does NOT change engine behaviour: rx-safety
  still never gates, and existing "unapproved" wording on ward screens is unchanged.
## 2026-09-14 D4 B: group counts come from a snapshot each hospital publishes (owner chose B)
- Supersedes the live cross-hospital read in GET /group/overview. WardSynQ is deployed per hospital, so a
  group reads `q_group_snapshots/<orgId>` only: {status, counts, reasons, capped, publishedBy, publishedAt}.
- `POST /group/publish-counts` (the hospital's own staff.admin; a group admin is refused) computes the same
  hospitalCounts() in the hospital's own tenant and writes the snapshot and `group:snapshot_published` under
  the hospital in one commit. A failed publish leaves the previous snapshot, with its own time.
- Overview: never published = status `not_published`, counts null, shown as "Not published" (never zeros);
  `stale` when older than the group's `staleAfterMinutes` (default 60, 5-10080, set by the group admin via
  `POST /group/stale-after`, audited `group:stale_after`). Each view is still audited `group:summary_read`
  under the hospital before its snapshot is read.
- Admin > Hospital group shows what this hospital last published (by whom, when) and "Publish counts now".
- Not built: automatic publishing on a schedule (the ops tick could publish; today a snapshot is published by
  a person and the stale marker says when it is old).

## 2026-09-14 S3 P1: the phone opens critical-result alerts; the workplace decides the credential
- **Credential rule** (`hospital-auth.js`, design 2.3, parity ID-01/EMR-05): a staff token is sent only
  for the hospital it names (its first segment is base64url `orgId~identity.exp`, read to choose, never
  to grant). A token for another hospital is never sent; the account bearer is. A token that names no
  hospital (local and harness sessions) is sent as before. Staff token and bearer are never sent
  together, because the push routes prefer the bearer. ward.js uses it; pages without the file keep the
  old rule, and a test pins that index.html and wardsynq/site/index.html load it before ward.js.
- **ward.js open()**: the remembered workplace now wins over the last hospital the overlay showed, so a
  switch cannot leave the ward on the previous hospital.
- **Alert screen** (`wardsynq-alert-ui.js`, flag `smd_wsq_push`, default off): renders nothing from the
  push (only nid and kind are kept); no request under app lock; detail fetched with the current
  workplace's credential; a notice whose `orgId` is not that workplace is dropped unshown and the screen
  asks to switch. Acknowledge is success only on `written === 1`. "I have informed the doctor"
  (receipt `informed`) is offered only after the acknowledgement is refused for the role. The v1 client
  path (self-push receipts that reported success on any HTTP answer) was removed.
- **Binding**: bound on choosing a WardSynQ hospital (OPD chooser, alert screen switch) and on a staff
  front-desk sign-in; re-bound when the device token changes (per-org token tail in
  `smd_wsq_push_orgs`, so a launch with an unchanged token sends nothing).
- **New server route `POST /api/push/unregister-member`** (the one server change in P1): removes THIS
  device from the caller's bindings at one hospital, audited `push:device_unbound`. Without it a staff
  sign-out on a phone had no way to stop that phone being counted as reached. Called before the token
  is cleared.
- **Known ceiling**: with an account credential in a different workplace, the server releases the
  notice detail (and writes its read-log row) before the client sees `orgId` and refuses to show it.
  Upgrade: the notice route takes the workplace `orgId` and 404s a mismatch before reading. (Done, below.)

## 2026-09-14 S3 P1 follow-ups: the limits P1 left
- **Notice in the workplace only**: `GET /api/push/notice/<nid>?orgId=<workplace>`. A missing, empty or other
  hospital's orgId is 404 after the KV pointer read and BEFORE the membership, loop, patient or read-log write
  (no session is still 401). The app sends the workplace and, with no WardSynQ workplace chosen, asks nothing
  and says to choose one. The switch screen stays as a guard but a real server no longer feeds it, so a
  multi-hospital clinician in the wrong workplace sees "switch to the one it was sent from" without the name.
  Decline and receipts are unchanged (decline is only offered from a detail the workplace already opened).
- **queue.js and discharge.js follow the credential rule**: discharge.js calls `headersFor(st.orgId)` like
  ward.js. queue.js keeps its cached token and drops it when `staffTokenOrg` names a hospital other than the
  request's (st.orgId, else the open WardSynQ/Connect session's hospital, else "" for GHIS). The front desk
  sets st.orgId from its own token before `/whoami`, so a cold start still signs the desk in. Tokens that name
  no hospital and pages without hospital-auth.js keep the old rule.
- **Account sign-out unbinds the phone first**: `SMD_WSQ_PUSH.accountSignOut()` (native-push.js) calls
  `unregister-member` for the WardSynQ WORKPLACE with the account's bearer only (a staff session for the same
  hospital is not what is signing out), when this phone had bound that hospital. signout-fix.js (the app's Sign
  out, the drawer, the account sheet, app lock's "sign out instead"), verify.js "Use a different account" and
  account.js's device lock wait for it (at most 6 s) before `signOut()`. `smd_wsq_push_unbind_failed` is written
  BEFORE the call and removed only on `ok`, so a refusal, network failure, missing account or a reload that cuts
  the call off stays recorded; the next launch says once that the phone may still receive the alerts. Not
  covered: account deletion (home.js), and hospitals other than the workplace that the account bound earlier.
- **"No phone registered" is read from the DeviceDirectory now**: `GET /ward/alert-status` returns `phones`
  (`phoneCoverage` in push-alerts.js, readers `staffReaders` in alert-deps.js): every active member on duty
  now in any ward whose role is on some level, plus every named contact, each checked with `devicesFor`.
  `{ok:false}` on any failed read (store, rota, members), shown on the Admin card as "could not be read. Do not
  read this as everyone having one". The per-alert `noDevice` stays, relabelled as alerts already sent. Checks
  the membership identity the rota uses; a contact typed as an email is checked under that email.

## 2026-09-14 G7: occupancy and ward length of stay from the movement history and the bed registry's history
- Supersedes two stated limits of "Trends (P2.10) are computed from the record": a stay is no longer attributed
  only to its current ward, and past buckets no longer use today's bed count.
- Stays: the Encounter's version history is the movement history (transfer = new version with `movedAt`).
  `staySegments` in `trends.js` splits a stay into ward pieces. `bed-occupancy` and the new `ward-los` read the
  histories of changed stays overlapping the range through `RecordService.histories` (one grant check, one
  audited list row). A history that cannot be read, or a move with no time, leaves the stay unplaced: its
  buckets are null with a reason by ward (hospital-wide occupancy keeps its bed-days).
- Beds: `q_beds` carries `since` (set at create) and `activeHistory` (appended by `updateBed` on each turn off
  or on; a patch cannot set either). A bed from before this has no `since`; its Firestore `createTime` is used
  and it is marked legacy: counted from registration, but unknown after that if it is now turned off. Beds
  listed only in `wardsynq.beds` keep no history, so a bucket needing them is unknown, never today's count.
- Not built: an admin "in service since" edit for legacy beds; blocked/closed state history (still not subtracted).

## 2026-09-14 G2: offline bedside writes wired, conflict review, and a dose checked against the order it was charted on
- `ward-offline.js` is now used: ward.js `bedsideWrite()` carries vitals, nursing task done, notes (timeline and
  templated), dose steps, ICU records and fluid entries. The request key and bedside time are fixed before the
  first attempt; offline or with no answer the entry is queued in IndexedDB and the screen says "saved on this
  device, not yet sent: NOT in the record". The app's `index.html` loads `ward-offline.js` before `ward.js`.
- Conflicts: `version_conflict` and the new `order_changed` come back with the record as it is now (nursing
  `failure()` and `administerStep`), shown beside the entry on the "Saved on this device" view. Resend (reason,
  against the current version), edit (vitals, note sections, ICU values, fluid entries only) or discard.
- Every decision is audited server-side first: `POST /ward/offline-resolve` (door `emr.view`, then the write's
  own capability; a note also accepts `noteWriterRoles`), audit action `offline.<choice>`, patient pseudonymised.
  The device drops or re-queues nothing unless that answers ok.
- eMAR: the round (`/ward/schedule`) returns `orderVersion`; `/ward/mar` with `expectedOrderVersion` refuses
  `order_changed` when the order has a newer version (a stopped order is still `order_not_active`, checked first;
  a retry of a recorded dose still replays). ward.js sends it online too, so a round loaded before a prescriber's
  change cannot chart against the old order.
- Sign-out on wardsynq.com warns when entries are held and clears the device store on confirm. The phone app has
  no equivalent sign-out hook: a different person signing in clears the previous person's entries (ward-offline.js
  rule 4).
## 2026-09-14 G3: the hospital event log (q_events) is hash-chained like the clinical audit trail

`functions/_q_audit_chain.js` (append, best-effort writer, verification adapter), `qAudit` in `_queue_engine.js`,
`_queue_notify.js` delivery rows and `_hospital_group_store.js` all write through it. Screens: Admin Center >
Security review (Tamper evidence: hospital event log), System health ("Staff and sign-in audit trail integrity").
Tests: `test/wardsynq-org-audit-chain.test.mjs`.
- ROW IS THE LINK. Each row is `q_events/<hospital key>__c<seq>` carrying `chainSeq` (hashed), `prevHash`,
  `rowHash`; the head `q_audit_chain_head/<hospital key>` = `{seq, hash}` moves in the SAME `fsCommit`. The race
  guard is `currentDocument.exists=false` on the row (Firestore's equivalent of the D1 primary key): a loser
  re-reads the head and retries (APPEND_ATTEMPTS). A refused commit whose head did not move is the caller's own
  guard and is rethrown unchanged, so hospital-group changes keep "no change without its audit row".
- ONE ROW NOT TWO DOCS. A separate link doc was rejected: a row-as-link needs one fewer write per event and a
  missing row is simply a missing number. The hospital key is an injective escape of the hospital id
  (`chainKey`), because `sanitize` maps `group:a` and `group-a` to the same id.
- VERIFICATION REUSES audit-chain.js. `orgAuditChain(env, hospitalId)` has the repository shape
  (`auditChainHead`, `auditChainRows` via `fsBatchGet`, `auditOnly`), so `verifyAuditChain`, the anchors and the
  owner acknowledgement run over it unchanged. Chain id `q:<orgId>` keeps its anchor keys apart from tenants.
- UNLINKED ROWS ARE NAMED, NEVER VERIFIED. Rows without `rowHash` before link 1's `legacyBoundary` are the old
  era; after it they are a lost race (qAudit still writes the row unlinked rather than lose it) or a row added
  outside the application, listed with evidence in the security review.
- ponytail: one chain per hospital serialises that hospital's event-log writes (a head read and a commit each);
  a sharded chain is the upgrade if one head doc contends. No Firestore index or rule change: reads are by id and
  the existing single-field `hospitalId` query.

## 2026-09-14 G12: a second outside anchor (Firestore) behind an AnchorStore port, and copies compared with each other

`functions/_wardsynq/audit-chain.js` (`anchorStoresOf`, `checkAnchorStores`, `anchorDisagreement`, multi-store
`acknowledgeAnchorBreak`), `firestoreAnchorStore` in `functions/_q_audit_chain.js`, `anchorStoresFor` in the router,
`anchorTick` in `ops-tick.js`. Tests: `test/wardsynq-anchor-stores.test.mjs`. Owner S1 (bucket name pending) and D12
(AWS move about 2026-09-28).
- THE PORT IS `{name, get(key), put(key, value)}` ON STRINGS. KV and Firestore implement it; the S3 bucket at the AWS
  move is a third adapter, no domain change. Firestore stores one doc per key in `q_audit_anchors/<escaped key>`.
- BOTH CHAINS INTO BOTH STORES, hourly, beside the tick gate. Each (chain, store) attempt stands alone: one store
  down never stops the other's copy, and the tick log names where it failed (`failed in Firestore (event log)`).
- CHECKS: each store against the chain (checkAnchors), and the stores against each other. The worst wins:
  rewritten/truncated, then `disagree`, not-verified, no-anchors, ok. A disagreement is reported as its own finding
  (message first, `disagreement.seq`), down with the governance consequence in System health. One store empty while
  the other matches is no-anchors (degraded), never ok.
- ACKNOWLEDGEMENT: one chained row; every rewritten/truncated store archived and restarted, empty stores seeded (a
  failed seed is named, not fatal). A failed restart of a broken store fails the call with `restarted` listed; a retry
  redoes only that store. `chain: "event-log"` acknowledges the hospital event log's chain the same way.
- WHAT REMAINS: for the hospital event log, which itself lives in Firestore, the Firestore anchor shares its trust
  domain, so only KV is outside it. An attacker holding D1, KV AND Firestore can still move all three. No Firestore
  index or rule change (reads by id; the service account bypasses rules).

## 2026-09-14 G11: out-of-assignment reads use ward history, one reader across sign-ins, and open their audit rows

`functions/_wardsynq/security-review.js` (`wardHistoryStays`, `readerAliases`, `readerAliasesFor`,
`auditRowsForReview`), `auditRowsById` on both repositories, `accountEmail` in `_opd_org_store.js`, route
`GET /api/queue/ward/audit-rows` (STAFF_ADMIN, record:read). Screen: Admin Center > Security review > Reads outside an
assignment. Tests: `test/wardsynq-out-of-assignment.test.mjs`.
- WARD AT THE TIME: a transferred admission (`movedAt`) is split into one stay per ward from its version history
  (at most 200 history reads per report). A history that cannot be read is INCOMPLETE data (reads not evaluated).
- ONE READER: ids are linked by email (membership identity and email, email and its `cfa:` access id, a Google
  `fb:` account and its `q_users` email) and named by the membership identity. A link that could not be made is a
  NOTE on the section, not incomplete data: it can split one person in two, which the note says, but must not turn
  every read in the hospital into "not evaluated". A flag lists the sign-in ids its reads came from.
- EVIDENCE: each flagged read carries the patient's ward then and the wards the reader was rostered on then. "Open
  these audit rows" reads them back by id with their chain link number; the read is audited (`security.audit_rows`)
  and refused if it cannot be; ids not found are named; a failed load says so.

## 2026-09-14 D6: Antigravity's multilingual branch reviewed; only translations integrated, nine portal languages

Source: local branch `feat/wardsynq-multilingual-emr` (363117f5..844a8b4e). Integrated on
`d6-antigravity-integrate` into the per-language files (`wardsynq/site/i18n/<code>.js`), all `reviewed:false`.
Owner answer 2026-09-14: Marathi added, Spanish kept (`OFFERED` in `wardsynq/site/i18n.js` lists nine).
- KEPT: Telugu portal catalog; label/sign-out/nav strings for ta, kn, ml, bn, mr. Tests
  (`test/wardsynq-i18n.test.mjs`) now pin negation in safety-critical keys and exact digits.
- NOT TAKEN: the `i18n.js` rewrite (self-marked reviewed:true, global active language in `t()`, AI-translation
  notice), the staff shell switcher (staff UI translation is not in D6; owner to decide), address-based
  `detectLanguage`, `wardsynq-terminology.js`, `wardsynq-rx-print.js` (drops unknown frequencies from the
  "canonical" line, rewrites PRN/TDS, misreads dates), `wardsynq-translation-guard.js` (machine translation of
  clinical text), and the general rulebook (permits labelled AI translation of clinical text). Findings in
  `docs/wardsynq/TRANSLATION_BRIEF_ANTIGRAVITY.md` "What happened to the first pass".
- RULE STANDS: clinical text is never machine translated. A localized prescription or discharge print, if ever
  built, keeps the English order as the source of truth beside it, behind a per-hospital setting default off,
  with golden tests for negation, decimals, frequency and dose preservation.
## 2026-09-14 External ABDM invoices are clinical documents: a named per-hospital policy, never billing (owner decision)

Owner decision 2026-09-14: an invoice received from another facility over ABDM is stored as a clinical/document record
for now and must never become a WardSynQ billing transaction. It was an implicit code path (the ABDM V3 merge entry
above, "External invoice is not an Invoice"); it is now an explicit policy.
- **Policy** `wardsynq.abdm.externalInvoiceHandling`, one allowed value `"clinical-document"`, absent = that default.
  Pure in `functions/_wardsynq/abdm-hospital.js` (`EXTERNAL_INVOICE_HANDLINGS`, `externalInvoiceHandling`,
  `externalInvoiceHandlingRefusal`). `abdm` joined the org whitelist (`_opd_org.js wardsynqConfig`).
- **Save**: `POST /api/queue/org/update` refuses any other value (or a non-object `abdm`) with 422
  `abdm_invoice_handling_not_built` and a sentence saying the billing model is not built, after authorization, nothing
  written. No screen writes it today; the value is shown read-only on Admin > Integrations > ABDM with its reason.
- **Landing** (`abdm-land.js`): `makeConsumeAndLand` reads the hospital's config (`hospitalConfigFor`, wired in
  `functions/api/connect/[[path]].js` through `orgForTenant`). A stored value this build does not know is NOT followed:
  the default is applied and named (`source: "unrecognised"`, `configured`). A config that cannot be read applies the
  default with `source: "unread"`; the transfer is already acknowledged, so holding it would lose the record.
- **Audit**: each landed external invoice note's `record.ingest` row carries `scope.decidedBy = {policy, value,
  source}` (new `governedForIngest` option `auditScope(entity)` in `service.js`, generic, used only here).
- **Guard on the write**: the ABDM landing refuses to write any `Invoice`, `Claim`, `PreAuthorisation` or
  `CostEstimate` (`BILLING_TYPES`; charges, deposits, payments, refunds and write-offs are all appends to an Invoice),
  whatever the document or a future adapter mapping produces (GovernanceError `ABDM_NO_BILLING`, quarantined by the hub).
- Tests: `test/abdm-external-invoice-policy.test.mjs` (resolver, landing audit, the write guard with a mocked adapter
  that emits billing types, billingReport and invoicesForPatient count nothing, composition sources, the card),
  `test/org-abdm-invoice-policy-route.test.mjs` (401/403/other hospital/422/positive).
- **Change later** (when a billing model for external invoices is designed and approved): add the new value to
  `EXTERNAL_INVOICE_HANDLINGS` with its reason; branch on `handling.value` in `landNdhmDocuments` (the SCCM adapter
  keeps mapping to the note; the new handling decides what else is written); narrow `BILLING_TYPES` for that value
  only, never globally; add a control to the ABDM card that saves through `/org/update`; update both tests (the
  refusal test's value list and the "count nothing" test). Hospitals without the key stay on `clinical-document`.

## 2026-09-14 Level-2 critical-result alerts tell every on-duty nurse in the ward: a named rule until Nurse-in-Charge exists (owner decision)

Owner decision 2026-09-14: level-2 ("overdue") critical-result alerts go to every nurse marked ON DUTY in the affected
ward until a proper Nurse-in-Charge role or assignment exists. It was implicit in the S3 P0 default ladder ("nurse"
on the overdue tier); it is now a named, per-hospital, audited rule.
- **Rule** `wardsynq.criticalEscalation.level2NurseRule`, one allowed value `"all-on-duty-nurses-in-ward"`, absent =
  that default (`LEVEL2_NURSE_RULES`, `level2NurseRuleOf`, `level2NurseRuleRefusal` in `alert-recipients.js`).
- **One resolver keyed by rule name**: `level2NurseRecipients(rule, {unit, active, duty})`. It checks BOTH conditions
  itself rather than trusting the rota reader: the member is active with role `nurse`, is in the rota's on-duty list
  now, and the assignment's own `unit` is the patient's ward. `resolveRecipients` sends "nurse" on the overdue tier
  through it (so it also applies at the escalate tier, which is cumulative); other roles and tiers are unchanged.
- **Unknown ward**: kept as before (the ladder's hospital-wide cover for a patient with no ward); the rule then has no
  ward to test and records `ward: null`. Flagged, not decided by the owner.
- **Unknown stored rule** (rollback, group adoption from before the check): never followed silently; the default rule
  applies so the ward's nurses are still told, and `source: "unrecognised"`, `configured` are recorded and shown.
- **Record**: the loop notice (`notifications[]`, versioned and audited with the loop) carries `nurseRule = {rule,
  source, ward, nurses, recipients}`. NO_RECIPIENT is unchanged: loud when the whole tier resolves nobody, with
  `nurses: 0` naming why.
- **Save**: `POST /api/queue/org/update` and `POST /api/queue/group/policy` refuse any other rule with 422
  `level2_nurse_rule_not_built`, after authorization, nothing written. The Alerts card's own save carries the saved key.
- **Screen**: Admin > Hospital > Critical result alerts to phones shows the rule read-only with "Applies until a
  Nurse-in-Charge role or assignment is implemented" (from `GET /ward/alert-status` `nurseRule`).
- Tests: `test/wardsynq-alert-recipients.test.mjs` (rule, off-duty, other ward with a leaky reader, empty set, card),
  `test/wardsynq-alert-dispatch.test.mjs` (real rota: off-duty, unrostered and other-ward nurses not told; notice
  names the rule; empty ward nurse set NO_RECIPIENT through the tick), `test/org-level2-nurse-rule-route.test.mjs`,
  `test/wardsynq-hospital-group.test.mjs` (group policy 422).
- **Change later** (when a Nurse-in-Charge role or assignment exists): add `"nurse-in-charge"` to `LEVEL2_NURSE_RULES`
  with its note; add its `case` to `level2NurseRecipients` (read the assignment for the ward, checked on duty and in
  the ward the same way; decide and record what happens when none is assigned, e.g. fall back to all on-duty nurses
  with `source` saying so, never silence); add a selector on the Alerts card saving through `/org/update`; decide
  whether the default changes (hospitals without the key follow the default). Update the refusal tests' value lists.
- **Superseded as the default on 2026-09-15** by the ward team rule below. The names above were renamed
  (`LEVEL2_WARD_RULES`, `level2WardRecipients`, `level2WardRuleOf`, `level2WardRuleRefusal`); the value is kept.

## 2026-09-15 Level-2 critical-result alerts tell the ward team ON DUTY in the patient's ward; staff mark themselves on or off duty (owner decision)

Owner decision 2026-09-15, replacing the nurse-only default: "If ward Cardio has 16 beds and two sisters, the alert should
go to everyone ON DUTY there: the nurses there, the residents there, the consultant there, and NOT to anyone who is not on
duty. Nurses and residents can turn themselves OFF duty in the StewardMD app."
- **Rule** `"all-on-duty-ward-team"`, the default. `"all-on-duty-nurses-in-ward"` stays accepted and resolved (a hospital
  that saved it keeps nurse-only). Key renamed role-neutral: `wardsynq.criticalEscalation.level2WardRule`; the old key
  `level2NurseRule` is read when the new one is absent (so explicit old choices survive with no migration), and the
  record names which key decided (`key`). Saves under either key with any other value: 422 `level2_ward_rule_not_built`
  (`/org/update`, `/group/policy`). The overdue tier's `"nurse"` entry is the ward-team slot (DEFAULT_LEVELS and the O5
  approval text are untouched).
- **Who is the team** (`WARD_TEAM_ROLES`, alert-recipients.js): nurse = `nurse`; resident = `resident`, `pg_resident`;
  consultant = `doctor`, `pg_faculty`, `pg_hod` (there is no consultant role). Interns are NOT included: owner follow-up.
- **One definition of on duty now** (`onDutyNow`): on the rota now, or an unexpired self-marked "on"; an unexpired "off"
  overrides both. Ward = the rota assignment's own unit, or the ward the person chose. Used by the level-2 switch
  (`level2WardRecipients`, which adds the role check), by the other ladder roles, by phone coverage and by the ward
  board count. OFF also drops the ordering clinician (the owner: "NOT to anyone who is not on duty"). Named escalation
  contacts are addressed by name and are NOT filtered by duty: owner follow-up if they should be.
- **Record** on the notice: `wardRule = {rule, source, key?, configured?, ward, counts: {nurse, resident, consultant},
  recipients}` (field renamed from `nurseRule`; old loops keep theirs). Empty set is NO_RECIPIENT as before.
- **No ward on the patient**: hospital-wide on-duty cover as before, `ward: null` recorded and said on the critical
  results board ("No ward recorded for this patient"). Owner follow-up: whether that should stay hospital-wide.
  **Superseded the same day** by the no-ward entry below (admitting doctor and residents on duty).
- **Self duty status**: `GET/POST /api/queue/roster/duty-status` (roster block, not /ward: it is staff data like leave,
  and needs no WardSynQ record tenant). Identity is the caller's membership in that hospital, from the credential; a
  body `identity` naming anyone else is 403 `not_your_status`; only ward-team roles (403 `not_ward_team` otherwise).
  ON needs a ward from the hospital's rota units, wards or bed lists (defaults to the current shift's unit). One row
  `q_duty_status/<org>__<identity>`, written in the SAME commit as its chained event-log row (`appendOrgAudit`
  extraWrites, action `roster:duty_on|off`); an audit failure is 503 `duty_status_not_saved` with nothing written.
  Expiry (`_roster.js dutyExpiry`): end of the shift rostered now, else 12 hours, never more than 12 hours.
- **Screens**: ward.js list view (StewardMD app hospital workplace and wardsynq.com ward screen) "My duty" card with On /
  Off and the expiry; the Ward round card shows per ward who a level 2 alert would reach now (`GET /ward/alert-cover`,
  counts only, queue.view), with "nobody on duty" loud; Admin > Critical result alerts card explains the ward rule;
  rota page "On and off duty by ward" for staff.admin (`GET /roster/duty`).
- Tests: `test/wardsynq-alert-recipients.test.mjs` (each of ROLE, WARD, DUTY, expiry pinned separately; key fallback;
  screens), `test/wardsynq-ward-duty-team.test.mjs` (routes, negative auth, audit-in-one-commit, real-rota dispatch),
  `test/org-level2-nurse-rule-route.test.mjs`, `test/wardsynq-hospital-group.test.mjs`, `test/wardsynq-alert-dispatch.test.mjs`,
  `test/run-ward-duty-golden-path.mjs` (headless Chrome, real ward.js).

## 2026-09-15 A critical result for a patient with no ward alerts the admitting doctor and the residents on duty (owner decision)

Owner decision 2026-09-15: "No ward: alert the doctor the patient is admitted under, and the resident on duty." This
replaces hospital-wide on-duty cover for a patient whose Encounter has no `location.ward`.
- **Rule** `NO_WARD_RULE = "no-ward-admitting-doctor-and-residents"` in `alert-recipients.js`. Not a hospital choice:
  not in `LEVEL2_WARD_RULES`, so `/org/update` and `/group/policy` still refuse it as a ward rule. It is a `case` of the
  same keyed resolver (`level2WardRecipients`), with every condition in `noWardCover`.
- **Where it applies**: `resolveRecipients`, at every level whose tiers ask who is on duty (any role, or the level-2
  slot). Every on-duty role path (doctor, resident, supervisor, the ward team) is replaced by it for a no-ward patient.
  The ordering clinician (off-duty check unchanged) and named escalation contacts (by name, not filtered by duty) are
  kept as on any result: owner follow-up if the orderer should also be dropped for a no-ward patient.
- **Admitting doctor** = `Encounter.attendingId` (set by admission and OPD ticket sync, carried forward by later
  encounter versions). Told unless an unexpired "off" duty status exists (`admittingSkipped: "marked off duty until <iso>"`), or
  the identity is a member row that is not active (`"not an active member of this hospital"`). Not required to be on the
  rota: the owner named the doctor, not the doctor on duty.
- **Residents** = roles `resident`, `pg_resident` (`WARD_TEAM_ROLES.resident`; interns still excluded), ON DUTY now by
  `onDutyNow` over the whole hospital's rota and self-marked duty (off overrides). **Department known** = the admitting
  doctor's membership `scope.departments` is non-empty: a resident counts when their own `scope.departments` shares one,
  or the ward they are on duty in (`q_wards` name) has one of those `departmentId`s (reader `wards()` in `alert-deps.js`,
  read only then). A resident whose membership has no department and who is on duty in a ward with no department is NOT
  counted in that case. **Department not known** (no admitting doctor, or no departments on their membership): residents
  on duty anywhere. There is no department on Encounter itself, and the doctor's own rota unit is not used.
- **Nobody else**: no nurse, supervisor or consultant other than the admitting doctor, at any level.
- **Record** on the notice: `wardRule = {rule, ward: null, noWardCover: {admittingDoctor, admittingSkipped, residentScope:
  "department"|"hospital", residents}, recipients}`. Empty set: NO_RECIPIENT as before, plus `why` (e.g. "no ward, no
  admitting doctor, no resident on duty"; the channel detail carries the same sentence).
- **Screens**: critical results board (ward.js `critWardRuleHtml`) names the admitting doctor (or why skipped) and the
  residents on duty with the scope; a NO_RECIPIENT line adds the `why`. Loops recorded before this keep the old
  "went to everyone on duty in the hospital" line. Admin > Critical result alerts card explains the no-ward rule.
- **Not changed**: Admin "Phones registered for alerts now" still checks people on duty with a ladder role and named
  contacts; an admitting doctor who is neither is not checked there.
- Tests: `test/wardsynq-alert-recipients.test.mjs` (admitting doctor told; off duty skipped, expired off not; department
  residents by membership and by ward; off-duty and not-on-duty residents; other department excluded; hospital scope when
  unknown, with and without an admitting doctor; nurse, supervisor, other consultant not told at any level; NO_RECIPIENT
  reason through `serverPushChannel`; board and card text). Each condition was mutation-checked.

## 2026-09-15 Bilingual patient prints: English whole and authoritative, a second language optional, catalog words only (owner decision)

Owner decision 2026-09-15: printouts in the patient's language, "ENGLISH MAIN, other languages OPTIONAL, English must
stay whatever as safety". Built fresh (branch `bilingual-prints`); Antigravity's `wardsynq-rx-print.js` stays rejected.
- **Setting** `wardsynq.printLanguages.enabled`, default false, whitelisted in `_opd_org.js wardsynqConfig`, saved on
  Admin > Hospital ("Printouts in the patient's language") through `POST /org/update`. Only `enabled === true` turns it on.
- **Prints**: the Patient copy (ward.js `pcopyView`, the patient's medicines, i.e. the prescription) and the discharge
  summary (discharge.js `printable`). `GET /ward/patient-copy` and `GET /ward/discharge-summary` return
  `print = {languagesEnabled, timeZone, utcOffsetMinutes}` (`wsqPrintSettings` in the router). With it off there is no
  picker. With it on, a per-print picker offers the eight other portal languages; "English only" is the default.
- **English never changes with the option**: the English document is drawn exactly as without it; a picked language
  only adds `<aside class="p-tr" data-print-lang>` blocks between sections (`wardsynq/site/print-lang.js`). Stripping
  them gives the byte-identical English (golden test). An aside holds catalog strings only: headings, labels, the
  authority line (in English and the language, at the top of the translated part), "printed in English only", and
  closed-list patient instructions. Drug names appear only in English (`<b lang="en">`); doses, units, routes,
  frequencies, diagnoses, results and free text never appear in an aside. Missing key: English, never blank.
- **Patient instructions are codes from a closed list** (`PATIENT_INSTRUCTIONS` in `migrate-inpatient.js`, 13 codes),
  picked on the consultation and the chart's prescribing card, stored as `MedicationOrder.patientInstructions`,
  refused with 422 `unknown_patient_instruction` after authorization. English and translations come from
  `rx.instr.<code>` catalog keys; the English print shows them under the frequency. Negated ones are worded "Do not",
  and `test/wardsynq-i18n.test.mjs` finds every negated print/instruction key by its words and checks each language's
  negation markers.
- **Dates on both prints**: "15 Sep 2026, 09:05" in the hospital's clock (IANA zone, else offset, India default 330,
  else labelled UTC); only ISO strings are read, anything else prints as stored. This applies with the option off too.
- **Fix found on the way**: discharge.css hid every body child but `#smdDischarge` on any print, so the Patient copy
  and the downtime pack printed blank on pages loading both files; now scoped to `body:has(> #smdDischarge.on)`.
- Translations of the new keys are not written here (another builder fills them, `reviewed:false`).
- Tests: `test/wardsynq-print-lang.test.mjs`, `test/wardsynq-print-lang-routes.test.mjs`, `test/run-print-lang-ui.mjs`
  (headless Chrome print preview and PDF), `test/wardsynq-i18n.test.mjs` (negation).

## 2026-09-15 ICU OCR: on-device vital-tile detector + tile re-reads; Apple on-device LLM rejected
- **Detector**: YOLO11s (8 classes hr/spo2/rr/sbp/dbp/map/pulse/etco2, val mAP50 0.937) compiled to
  `VitalDetector.mlmodelc` inside the VisionOcr plugin (`detectVitals`). It only ASSOCIATES a value with a field
  when no label was read; digits stay Vision's and every parser gate applies. ~20-400 ms on iPhone 15 Pro.
- **Tile re-reads** (`tileRegions` / `tileObservations`): a detected HR/SpO2/RR/Pulse/EtCO2 tile with no digits
  overlapping it gets two crops; read A unions (values enter unconfirmed), read B can only confirm. Pressure
  tiles are excluded (a crop cut "150/54" to "I54" and turned two correct ART readings into scale conflicts).
- **Apple Foundation Models (on-device ~3B LLM) tried and REMOVED**: on 4 screens it put RR/HR on alarm limits,
  RR on the HR value and picked label text as values, at 3-10 s per photo. As evidence it would promote wrong
  values. Do not re-add without a benchmark showing 0 wrong picks.
- Result on the iPhone (installed app, readImageLocal, 26 owner photos): 21/99 visible values auto-filled,
  0 wrong, 0 network calls. Remaining misses are mostly deliberate gates (two-pass disagreement, BP source
  unknown, confidence) and photos where Vision reads no digits at all.

## 2026-09-15 ICU OCR hybrid: device OCR + AI Vision must AGREE to auto-fill
- Owner chose hybrid. When a monitor read leaves core vitals in review and cloud consent was already given,
  `image-engine.js hybridCheck` sends ONLY the monitor crop (`SMD_AI.cropImage`, long edge <= 1280 px) to
  AI Vision and merges with `SMD_ICU_MONITOR.hybridMerge`: device AUTO + AI same stays; device AUTO + AI
  different -> review; device review suggestion == AI -> AUTO (except pressure-source questions);
  AI-only -> review suggestion, never AUTO; BP halves fill together. Any AI failure keeps the device result.
- Replaces the old "Use AI Vision (Pro)" fallback that overwrote the device read with Gemini's values.
- Without prior consent the dialog asks ("Check with AI Vision"); `localStorage smd_icu_hybrid=0` turns the
  automatic check off. Choosing AI Vision as the engine explicitly is unchanged (fills from AI directly).
- Sending OCR text instead of the image was rejected: similar or higher token cost and it loses layout/colour.
- Tests: `test/icu-hybrid-merge.test.mjs` (merge rules + end-to-end through image-engine with stubs).

## 2026-09-15 ICU OCR: on-device digit reader as an independent second reader
- `DigitReader.mlmodelc` (3 MB CRNN-CTC, 48x192 gray; trained on 900k synthetic + 27.5k real crops pseudo-labelled
  where EasyOCR, TrOCR and PARSeq agreed exactly). Held-out real crops: 88.7% exact; conf >= 0.999 covers 73.5% at
  99.7% precision (1 confidently wrong: upside-down photo). So it is NEVER a sole source of a value.
- `applyDigitReads`: a read >= 0.999 CONFIRMS a Vision box with the same digits (digitsAgree, so stray label glyphs
  are not disagreement) or CONFLICTS it when digits differ; it never adds a value. Native `readDigits` in the
  VisionOcr plugin (preprocessing ported from the training code, see spec in the job's digits/out/spec.json).
- Benchmark (268 cases, cached OCR): 0 wrong before and after; 11 fields review -> correct (owner 97c20181 NIBP
  73/36 (49), MP40 RR 22 on two perturbations, 2 draft externals), 0 lost.

## 2026-09-16 ICU OCR hybrid: routes to the user's OWN engine choice (Cloud -> AI Vision, Local -> on-device)
- Owner: "local or cloud is decided by user when user select local ai models its routed to local models
  like medgemma or bonsai". hybridCheck's caller now reads the SAME `aiAvailable()` policy the rest of
  MaiK already uses: Cloud/Auto + consent + online -> AI Vision on the crop (unchanged). Local (cloudAllowed
  false) + a vision-ready pack downloaded (MedGemma 1.5 4B / Gemma 4 E2B — the text-only Bonsai packs have
  no projector, cannot see) -> `localHybridCheck`, same crop, same `hybridMerge` agree-to-fill rule, nothing
  leaves the device, no consent needed. Neither available -> unchanged (dialog / device result stands).
- **Real bug found and fixed**: image-engine.js's own `assign(a,b)` only took 2 args; `hybridCheck` (already
  shipped) and `localHybridCheck` both called it with 3, so the 3rd arg (`{monitor:m.meta, hybrid:{...}}`)
  was silently dropped — the merged monitor/status update never reached the caller, only masked in the
  original cloud test because the fixture's stale field happened to match. Fixed by making `assign` variadic
  like icu-monitor-parser.js's own (mutates a fresh `{}` first arg, N sources) — every call site already
  passed a fresh `{}`, so no behavior change elsewhere.
- Verified live: (1) Android's ML Kit OCR end-to-end on the owner's Pixel 9, 26 owner photos, 13/103 values
  auto-filled, 0 wrong (weaker than iOS's 21/99 since Android has neither the tile detector nor the digit
  reader yet — both Core ML, iOS-only). (2) Discovered `@capgo/capacitor-updater` (autoUpdate:"off" in
  config, but a bundle was live-swapped anyway) silently replaces the installed JS with whatever is on
  stewardmd.in — any Android test must call `CapacitorUpdater.reset({})` and check `current()` first, or it
  silently tests production code, not the local build. (3) Local-hybrid path fired correctly on this
  Local-engine phone via a live JS injection over the WebView's own CDP (no reinstall needed for a JS-only
  change): rr promoted to AUTO on agreement, spo2 correctly stayed review on disagreement, 0 network calls.
- Tests: `test/icu-hybrid-merge.test.mjs` (+2: local engine runs on-device with no upload/consent; no vision
  pack ready -> no automatic check), `test/icu-ocr-v2-integration.test.mjs` updated for the new gating.

## 2026-09-15 Removing a hospital is the owner's act: soft delete, typed DELETE, audited in the same commit (BUG-MU2PHANW-T18X)
- `POST /api/queue/org/delete` was open to any staff admin with no confirmation. It now needs the hospital's owner
  (`ownerUid`) or the platform owner, and `confirm: "DELETE"` in the body (422 `confirm_required` otherwise).
  Non-owner admin 403 `owner_only`; another hospital 403/404.
- Still the existing soft delete (`deleted: true`, now with `deletedBy`): the hospital leaves every list; its clinical
  record, documents and audit trail are kept (medical records retention). The flag and its hash-chained
  `org:delete` row go in one commit via `appendOrgAudit`, no longer a best-effort row after the write.
- Screens: #/hospitals (owner rows) and Admin > Hospital, one shared two-step dialog in shell.js (explain, then
  type DELETE). `whoami` carries `orgOwner` / `platformOwner` as UI hints only. The OPD console (opd.html) asks
  for the typed word too; an older native app build that sends no `confirm` is refused and removes nothing.
- Tests: `test/queue-orgs-onboard.test.mjs` (REMOVE HOSPITAL), `test/run-wardsynq-hospitals-page.mjs`.

## 2026-09-15 The workstation's code is network first; its record opens with the sign-in the person chose
- Owner bug: "record service refused to open (401). Safety checking is unavailable, so ordering is disabled." on
  wardsynq.com. The quoted wording is the pre-2026-09-14 text for a 401 (current code says "Please sign in"), so
  the browser was running cached code. `wardsynq/ui/wardsynq-sw.js` served the page and the unversioned
  `record-deployment.js` / `wardsynq-store-remote.js` cache first (verified live: all cached under `wardsynq-v6`),
  so a browser that opened the workstation before the auth fixes kept the page with no Firebase and sent no
  credential. Now network first, cache only offline; v7 deletes the old cache and reloads an open workstation
  window once on that upgrade (not opd.html, which holds typed observations).
- Credential: `smd_opd_toktype` decides, as hospital-auth.js already does for ward.js. "staff" sends only
  X-Staff-Token; "account"/"firebase" sends only the bearer; unset sends both as before. A Firebase account the
  browser still remembered was preferred by the server over the staff session and acted as the wrong person.
- Account restore waits up to 10 s (was 3.5 s, a race on a slow link). No server change; a genuine no-session is
  still 401 and the banner stays.
- Tests: `test/wardsynq-workstation-credential.test.mjs`, `test/run-wardsynq-workstation-open.mjs`.

## 2026-09-15 The staff language reaches the whole ward, through a codemod with the English inline (ui-i18n-ward)
- Owner decision: a staff member's picked language changes the whole staff interface, not the rail. ward.js writes
  every string through `wT` (plain text), `wTH` (markup), `wTA` (title/placeholder/aria-label/alt), `wTD` (dialogs),
  each call carrying its English inline, keys `ward.*` in one delimited block at the end of EN in
  `wardsynq/site/i18n.js`. ward.js without i18n.js (StewardMD app, harnesses) or with English picked renders
  byte-identical English. The language is the shell picker's `G.WSQ.state.navLang`; paint() sets `<html lang>`.
- Written by `scripts/wardsynq-i18n-ward-codemod.mjs` (acorn, dev-time only), re-runnable after merging other
  ward.js work: literal-level edits, comments kept. Anything recorded is only ever a `{placeholder}` value, marked
  `lang="en"` inside markup; strings sent to the server, compared, selectors, other attributes, units, routes,
  frequencies, laterality, abbreviations and clinical-shaped text are skipped. Module-level word tables are read
  through `wTEn()` where rendered. eMAR verbs and states are shown translated; the machine spelling is still sent.
- Safety: a translated refusal/critical/allergy/not-saved text keeps its English under it (`<small class="w-en">`);
  plain texts kept in `st.err` find their English through `wEnglishOf`; dialogs show both.
- Not covered: discharge.js (its printable must stay English; print.dc.* already handles the print), strings built by
  `.push()` into arrays, prompt default answers. Translations are not written on this branch.
- Tests: `test/ward-staff-i18n.test.mjs` (fake TE[...] catalog), `test/run-ward-staff-i18n-ui.mjs` (headless Chrome).

## 2026-09-15 A staff language translates the whole staff interface (replaces nav-labels-only)
- shell.js T/TS/EN, exposed on the page context as `c.t(key, vars, en)`, `c.tSafe`, `c.en`, `c.lang`; pages carry a
  3-line local T/TS/EN so helpers rendered without the shell stay English. The inline English must equal EN[key];
  `test/wsq-site-i18n-catalog.test.mjs` extracts every call and pins the one block
  `/* site pages keys (ui-i18n-site) */` at the end of EN in i18n.js (keys `site.*`, `order.*`).
- Never translated: recorded or server values (names, codes, drugs, doses, results, hospital/ward names, audit
  values, server messages), marked lang="en" where shown inside translated UI. Refusals and failures use TS: the
  translated text plus the English original underneath (`.en-orig`). `document.documentElement.lang` follows.
- The Order workstation reads the same `wsqStaffNavLang`, loads i18n.js + the language file, translates its static
  HTML at boot. Translations of the new keys are written separately before merge.

## 2026-09-15 Live test LT-21..LT-29 (branch livefix-boards)
- A hospital-wide list that composes many audited reads buffers its read audit rows for the one request and writes
  them together before answering (`bufferReadAudits` in functions/_wardsynq/repository.js, `auditMany` on the D1 and
  memory repositories). Every read is still audited and chained; a failed flush fails the request, so nothing is
  returned unaudited. Used by `/ward/nurse-worklist` (522 reads: 522 chain steps became 14) and `/ward/criticals?names=1`.
- `resolveClinicalActor` answers once per (request, deps, tenant, need); the identity cannot change inside a request.
- A lab result is refused (409 `specimen_not_collected`) for a blood/fluid order with no collected sample; a
  collected sample not yet marked received is received by the release (`receivedOnRelease: true`). Imaging,
  procedure and referral orders are never asked.
- "Open critical results" means state `open` (not acknowledged) on every screen; `minutesSinceReported` is the
  report's clock and does not change on acknowledgement. Staff names are stored beside the id at write time
  (`acknowledgedByName`, `givenByName`, `receivedByName`); an older record with only an account id shows
  "a clinician account", never the uid.
- DICOM worklist DA/TM are the hospital's wall clock (org `utcOffsetMinutes`/`timeZone`) with TimezoneOffsetFromUTC;
  a study with a final or corrected radiology report leaves the worklist, a preliminary one stays.
## 2026-09-15 Live test fixes (livefix-site): one account sign-in spelling, no 502 from MaiK, one definition of admitted
- LT-01 (D7): the OPD console reads `smd_opd_toktype` "account" (wardsynq.com) as "firebase" (its own spelling), opens
  the hospital in `smd_opd_workplace`, and asks whoami for that hospital's role. Same Firebase project and origin, so
  the persisted session is the proof; the router still verifies every request. clinic-billing.html reads it the same.
- A Function must not answer 502: Cloudflare replaces it with an HTML page and the JSON reason is lost (already
  noted in functions/api/auth and migrate-inpatient.js). maik-interaction.js now uses 503 for "not answering" and
  409 + notConfigured for the gateway's routing refusals. Other `r.status || 502` routes in the ward block are
  unchanged and carry the same risk.
- `getOrg("")` is null: an unnamed hospital is a refusal, not a 500 from reading `q_orgs/`.
- Occupancy (patients, occupied beds, without a bed) counts ADMISSION_CLASSES everywhere (ward-metrics now matches
  the bed board, patient flow and the ward list); open work still spans ED, theatre and PACU encounters.
- `GET /api/queue/roster/duty-status` is a 200 `notWardTeam` for any member; only POST is the ward team's.
- The audit list reads `changes?newest=1&before=` (both repositories); the ascending sync feed is unchanged.
  `GET /ward/actor-names` (staff.admin) names actor ids from this hospital's members only; a mobile number or an
  account id is never returned as a name. Members still have no display name field (not built).
- Tests: test/run-opd-wardsynq-session-ui.mjs, test/run-ward-livefix-site-ui.mjs, test/ward-livefix-site.test.mjs,
  test/wsq-site-livefix-site.test.mjs, test/wardsynq-livefix-site-routes.test.mjs.
## 2026-09-15 Medication order entry runs the server safety check; prescribers cannot verify their own orders (LT-14, LT-20)
- `POST /api/queue/ward/medication-order` runs the SafetyEngine on the server against the record (allergies, other
  active orders, latest weight) through `orderEntrySafety` in migrate-emar.js, the same facts reader the bedside hook
  and the pharmacy queue use. A `safety` verdict in the request body is no longer read (it was trusted for override
  analytics, actorId included).
- Not a gate (seed content is unapproved, seed-signoff.js): `checkOnly: true` returns the verdict and writes nothing;
  the chart shows any finding and the prescriber proceeds with `overrideReason` (attributed server-side) or changes the
  order. The verdict is stored on the order as `safetyAtOrder`. The Order workstation should call the same route.
- `POST /api/queue/ward/verify-order` refuses the order's prescriber (403 `self_verification`, `record.denied` audit
  row via `RecordService.auditDenied`), whatever their role. Unverified orders stay administrable (rule 4).
- ward.js `paint()` puts back fields the user changed (same view and patient, same drawn default); a write the server
  accepted (`written !== 0`) empties the card its button sits in.
## 2026-09-15 One price list for the ward bill; the discharge checklist is enforced on the server (LT-30, LT-32)
- The ward bill (`/ward/charges`, `/ward/invoice`, claim estimates, the discharge bill check) prices from ONE table:
  `wardsynq.tariff` merged with the Admin Center Price list (q_tariff via the clinic billing store), Price list wins
  (`charge-capture.js tariffTable`, router `wsqTariff`). Before, the screen wrote q_tariff and the bill read only the
  config, so prices set on screen never reached a bill. An unreadable Price list is an error (502), never "unpriced".
- Price list kinds `bed`, `nursing`, `visit` are per day of an inpatient stay, optionally for one ward (by name). A day
  is charged once started; the ward is the one the Encounter history says the day began on. A bed day with no price
  is listed unpriced (`BED-DAY`), never free. Tests and medicines match by code, then by the name they were recorded
  under. `billing.charge` now reads Encounter (read only) for this.
- `/ward/discharge` refuses (409 `discharge_blocked`, nothing written) until the bill is settled or deferred with a
  reason, and open orders / pending results / unreadable order lists carry an override reason from a caller holding
  `emr.treat` (403 `override_not_permitted` otherwise, decided in the router, never from the body). Deferral and
  override are written on the finished Encounter (`billDeferred`, `dischargeOverride`, `dischargeChecklist`).
  Destination is coded: home, transferred (+ receiving hospital), left-against-advice, died (needs a recorded death),
  other (+ text); `ward` stays for ICU step-down. `GET /ward/discharge-checklist` shows the same checklist.
- A released result (final/corrected DiagnosticReport) closes its investigation on the summary, the pending list and
  the command centre; the summary line carries the values or impression. Signing an undrafted summary drafts it first.

## 2026-09-15 The Order workstation is a ward screen, not a separate record client (LT-09, LT-10)
- `wardsynq/ui/wardsynq-app.js` no longer carries a demo cohort, a browser-side governed store, an offline journal
  or its own rule-pack evaluation. Roster: `GET /api/queue/ward/list`. Context: `/ward/fhir` (AllergyIntolerance,
  Patient, Observation weight and labs) and `/ward/timeline` (active medicines). Sign: the chart's two steps on
  `POST /api/queue/ward/medication-order` (checkOnly, then the order with `overrideReason`). The site shell opens it
  with `?site=1&orgId=`, demo hospital or not. Allergies the page cannot read stop the order.
- Dose limits may be weight-based only up to a weight (`mgPerKgUpToKg`; paracetamol 50 kg, ibuprofen 40 kg) and may
  carry a daily ceiling checked against the order's frequency (`absoluteCeilingDaily`, `maxDaily`; the frequency
  reading is pinned to mar-schedule.js parseFrequency). The WardSynQ adapter drops generated duplicate-therapy rules on
  RxClass grouping classes (a class that strictly contains another class of two or more members); curated rules stay.
  The generator (scripts/interactions/build_rules.py) and the StewardMD app's copy of the rules are unchanged.

## 2026-09-16 Report Bug reports live on the server per hospital, removed only once solved
- Owner: "make sure all bugs reported thru report bug are saved on server and removed only after solved".
  Stored in the hospital's append-only record store as the internal type `_wardsynq_bug_report`
  (functions/_wardsynq/bug-reports.js), like connectors and payment requests: versioned, audited in the same append,
  no migration. Not a RecordService resource type: that door needs a clinical actor (hr and viewer have none), and
  a type in RESOURCE_TYPES is readable through the raw record door by every emr.view role.
- Routes (ward block): `POST /ward/bug-report` any member (idempotent per reporter and client id),
  `GET /ward/bug-reports` (hospital admin, org owner or platform owner sees all, anyone else their own),
  `POST /ward/bug-report-status` and `POST /ward/bug-report-remove` for those managers only; remove is 409 unless
  solved and archives (status removed), never deletes. Screen: Admin Center > Bug reports.
- The widget keeps a device outbox: unsent until the server returns its id, retried on load, online and every
  minute; the pre-change localStorage log is uploaded once. Only sent copies are trimmed or cleared.

## 2026-09-16 A staff screen's English goes through the catalog, and the server's display text travels as a code
- Owner: with Telugu picked, screens still showed English. The catalog was 5,169 of 5,249 keys complete, so what was
  left was text that never went through it. scripts/wardsynq-i18n-unwrapped.mjs finds string literals a screen shows
  as words (text between tags, a title/placeholder/aria-label, a sentence) that are not an argument of a translation
  helper; test/wardsynq-i18n-unwrapped.test.mjs pins each file's list against an allowlist of the deliberate
  exceptions, so a new unwrapped literal fails there. discharge.js (the discharge workstation, "ward.dc-*") and
  patient-register.js (the check-in sheet, "ward.reg-*") now carry the same wT/wTH/wTD helpers as ward.js, and the
  Report Bug widget uses the site pages' T()/TS() ("site.bug.*").
- SERVER DISPLAY TEXT IS NOT TRANSLATED ON THE SERVER. functions/_wardsynq/quality.js keeps sending its English and
  sends a stable code beside it (a measure's id for its title; reasonCode, noteCode, note2Code with the numbers in
  reasonVars/noteVars). ward.js maps code -> key with wTS(key, english, sent, vars), which shows the translation ONLY
  when the server's English is exactly the catalog's English filled with those values, and the server's own words
  otherwise - so a sentence changed on the server can never be shown as the translation of an older one.
- A count is two keys ("{n} nurse" and "{n} nurses"), never one key with "s" glued on: the English "1 resident" that
  the alert-cover tests pin cannot survive a single plural form, and no other language pluralises like English.
- Icon ligature names (card/icuHead/wsBlock's icon argument) are never catalog words: a translated "verified" put
  Telugu where the Material Symbols glyph belongs.
## 2026-09-16 A chart names the staff member: name and employee id, resolved at display
- Owner: "timeline shows by clinician account it should state his/her employee id and name ... so everyone knows who
  gave the drugs who asked to give". Records keep the actor id they were written with; nothing is rewritten.
- Source: the hospital's member row gains `displayName` and `employeeId` (Admin Center > Staff; a name that is a
  mobile number, an email or an account id is refused). An employee id falls back to the staff sign-in ID the hospital
  chose; an email, a mobile number or an account id is never shown as either.
- One lookup (functions/_wardsynq/staff-identity.js) serves `GET /ward/actor-names` (audit screen, staff.admin) and the
  new `GET /ward/staff-identities` (emr.view, or order.read / lab.result / transfusion.issue): name, employeeId, role
  only, this hospital's members only (disabled members included), one audit row `staff.identity.read` per request.
- ward.js `staffWho(id, storedName)` is the one renderer: "Name (EMP-1042)", full identity in the title and on a
  click or tap (`whoinfo`). All ids named on a screen go in one request per screen; the fallback shows while it runs,
  and a failed lookup says "identity could not be loaded". The live staff record wins over a name stored at write
  time. Timeline events carry `byId`/`labelBase` (and `signedById`, `witnessId`); the round carries `witnessedBy` and
  `statusBy`.
## 2026-09-16 Billing and reports from the live retest: one price table, invoices carry the stay, catalogue of tests
- THE PRICE LIST IS THE ONLY PRICE TABLE where it exists (clinic billing store on). The retest billed "Specimen
  collection 60" while the Price list said "No prices set yet": the demo seed had written fabricated prices into
  wardsynq.tariff, which no screen shows. `wsqTariff` now ignores wardsynq.tariff whenever the Price list store is on;
  the configured tariff prices only a deployment with no Price list store. An item with no Price list price is listed
  as "no price set". The demo seed writes its (labelled DEMO) prices to the Price list instead. Production demo data
  is not changed.
- AN INVOICE CARRIES THE STAY. `raiseInvoice` stores the named encounter (refused 422 if it is not this patient's) or
  the patient's open inpatient stay. The discharge checklist's "bill settled" sums only that stay's invoices
  (`invoicesForStay`): an invoice with the stay's id, or one with no id (every invoice before this change) matched by a
  line from this stay's charges or a bed day of it, or by being raised between admission and discharge (or now).
  Whether an item is on a bill still reads every one of the patient's bills, so nothing is billed twice.
- REPORTS: the billing footing shows credit held beyond the bills and nets refunds, void invoices are counted apart,
  and it states whether it balances. A dispense is taken out of the one location that item was received into (else the
  unnamed main store), not the ward it was sent to. Billing, claims and pharmacy reports take `from`/`to` (a date is a
  whole day on the hospital's clock) defaulting to the last 7 days; a bad date is 422. CSV per table is built in the
  browser from the table on screen.
- INVESTIGATION CATALOGUE (functions/_wardsynq/investigation-catalogue.js): Price list items of kind
  investigation/radiology, the hospital's order-set investigations, then a built-in list of common tests with WardSynQ
  short codes (not LOINC). A catalogued test's category is the catalogue's. The chart orders anything else only as
  `other: true` with a reason (422 without); an API order with an unknown code is still accepted, unmarked, so order
  sets, integrations and older clients keep working. Existing orders filed as laboratory whose code or name is exactly
  a built-in imaging test are READ as imaging (`effectiveCategory`) by the laboratory and radiology worklists and by
  specimen collection; stored records are not rewritten. Words in a free-text name never overrule a category.
- BED BOARD: a stay's ward is matched to the hospital's ward by name or ward code without regard to case, as ADT
  already does; never by a partial name. A ward not on the ward list (or turned off) and a ward with no bed rows each
  say so instead of "Bed list not configured".
## 2026-09-16 MaiK asks the model where Google serves it; health probes that path; errors carry a reference, not the provider's words
- Live retest LT-40/LT-34: Ask MaiK 503 `model_unavailable`, Vertex NOT_FOUND for
  `projects/<project>/locations/us-central1/publishers/google/models/gemini-3.6-flash`, and the raw provider error
  (project id, model path, docs URL) printed to the clinician. System health said MaiK Up at the same time.
- Root cause 1: the gateway put the model in the deployment's single region (GCP_LOCATION, else asia-south1). Google's
  Gemini 3.6 Flash page (read 2026-09-16) lists global and the US/EU multi-regions only. The registry entry now carries
  `vertexLocations: ["global","us","eu"]`; `vertexEndpoint()` keeps GCP_LOCATION when it serves the model, otherwise
  uses the multi-region containing it (us-* -> `aiplatform.us.rep.googleapis.com`, europe-* -> eu), else global
  (`aiplatform.googleapis.com`). Production (us-central1) goes to the US multi-region, which keeps the US processing
  the deployment already had. No env var and no per-hospital model id added: the model id was verified to exist, the
  location was the fault. vertex-pro (gemini-3.1-pro-preview, opt-in by name) has no verified location list and keeps
  GCP_LOCATION. NOT verified live: the call against the real project.
- Root cause 2: health read model metadata with the AI Studio key; clinical requests go to Vertex under the service
  account. `probeClinicalPath()` takes the same route() decision askAboutPatient gets (summary, phi) and calls
  countTokens (free, generates nothing) on the same host/location/model with the same token, or a hospital model
  server's /models. MaiK on with nothing approved for patient data is "Not set up yet" (`setup: "hospital"`), not Up.
- Root cause 3: askAboutPatient returned invoke()'s diagnostic detail. `publicRefusal()` passes setup refusals
  through; a runtime refusal (model_unavailable, empty_answer, no_provider) is logged server-side as
  `[maik] MK-XXXXXXXX <code>: <scrubbed provider text, 300 chars>` (no patient id, no prompt) and the response carries
  `ref` and a plain sentence. invoke() itself keeps its diagnostic detail for server callers and tests.

## 2026-09-16 listMembers pages through every member
- The staff identity lookup matched an Access sign-in (`cfa:` + email hash, not readable by id) only against the first
  300 members. `listMembers` now pages 300 at a time ordered by document name (`fsQuery` `startAfter`), ceiling 20
  pages. Every caller (admin staff list, rota, security review) sees every member.
## 2026-09-16 Order entry refuses an absolute dose ceiling, including one reached across orders (retest 2026-09-16)
- Retest: a second paracetamol order on top of an active 1 g QDS came back with no finding. The SafetyEngine gains an
  opt-in `same-drug` check (wardsynq-safety.js `checkSameDrug`), run only by order entry (migrate-emar.js
  `orderEntrySafety`): `SAME_DRUG_ACTIVE` (overridable) when the molecule is already active on another order, and
  `DOSE_ABSOLUTE_CEILING_CUMULATIVE` (block) when this order's day plus the other single-molecule orders' days is above
  `absoluteCeilingDaily` (mass units summed in mg; PRN or unread frequencies and combination products are not summed
  and are named). The order being replaced (same deterministic id) is excluded, so the chart's replace flow is neither.
  With the check on, a duplicate-class rule needs two different molecules, so one molecule twice is one finding.
- The findings stay REPORTED (unapproved seed content) with one exception: `ORDER_ENTRY_HARD_STOPS`
  (`DOSE_ABSOLUTE_CEILING`, `DOSE_ABSOLUTE_CEILING_DAILY`, `DOSE_ABSOLUTE_CEILING_CUMULATIVE`) are arithmetic on the
  order, not rule content, and `POST /ward/medication-order` refuses them (409 `safety_hard_stop`, nothing written,
  whatever reason is sent). Each carries `hardStop: true` and the verdict lists `hardStops`; screens label only those
  "Hard stop". Every other block or overridable finding is "Needs a reason to proceed", a warning is "Warning".
  The bedside hook and the OPD advisory do not run `same-drug`.
## 2026-09-16 Questions before a ward write are asked on the ward, not in browser dialogs
- ward.js `askFor(spec, run)`: the question and every typed value live in `st.ask` (`data-w-ask`), so a repaint keeps
  them; Cancel/Escape writes nothing; a blank required field is refused in the dialog; the write's failure is shown in
  the dialog, which stays open. Used for lab Collect, critical acknowledge (chart, board, inbox), ED bed admit,
  transfer, and the other clinical writes. discharge.js signs and reverts through an on-screen question (`st.ask`).
  Native dialogs remain only in MaiK, integration, billing/claims, purchasing and scheduling screens (other lanes).
- A paint that arrives while a pointer is down inside the ward is held until the pointer comes up (3 s cap), as a
  paint is held for an open select: a repaint between press and release lost the click (the ED "first triage" miss).
## 2026-09-16 Printed labels and camera scanning are generated in the browser, printed one label per page
- `ward-labels.js` (ES5, no dependency) encodes Code 128 (set B, with set C for runs of numerals) and QR (byte mode,
  level M, versions 1-10) itself and draws SVG; no generator library and no network call, so an MRN or accession never
  leaves the page. Vectors pinned from the published tables (test/ward-labels.test.mjs); whole symbols decoded by
  Chrome's BarcodeDetector in test/run-ward-labels-ui.mjs.
- A label prints through a hidden iframe whose document is exactly the label (`@page` size from Admin > Hospital
  `wardsynq.labelSizes`, bounded in `functions/_wardsynq/labels.js`), so the ward behind it never prints and the ward's
  A4 print stylesheet is untouched. The screen says the print dialog opened, never that a label printed.
- Wristband, tube label and ID slip read `GET /ward/label-data` (emr.view, or lab.result for the laboratory board);
  a wristband is not printed when allergies could not be read, and an estimated DOB is printed as an age. The QR is the
  active band's code, else the bedside value (wristbandBarcode or MRN), and the screen warns when they differ. The
  pharmacy label uses the pharmacy screen's own reads (the pharmacy role does not read Patient); its size comes with
  `GET /ward/dispenses`. Printed labels are English whole, like the printed discharge summary.
- "Scan with camera" (BarcodeDetector + getUserMedia) only fills the field a wedge scanner types into; the same button
  sends it through the same server check. Specimen receipt by scan sends `scannedAccession`, and the server refuses a
  label that is not the specimen's own accession (409 `wrong_specimen_scan`).
## 2026-09-16 Laboratory analysers connect through an on-premises connector; results are released by a person
- Pages Functions has no TCP, so analysers (HL7 v2 over MLLP, ASTM E1381/E1394 over TCP or serial-over-TCP) talk to
  `connect-agent/analyser/`, a stdlib-only Node program on the laboratory network. It frames and acknowledges per
  spec, keeps a durable file queue, and calls three routes before staff authentication:
  `GET /api/queue/lab-connector/analyser-config`, `POST .../analyser-results`, `POST .../analyser-orders` (host query).
  The existing Camofox Connect runner in `connect-agent/` is a different job (EMR discovery for Connect) with its own
  HMAC runner protocol; the analyser connector sits beside it in the same folder rather than inside it.
- Authority is one connector key per hospital (`wsqlab.<base64url org id>.<secret>`), issued on Admin > Integrations >
  Laboratory analysers, shown once, stored AES-GCM sealed (webhooks.js sealSecret), compared in constant time. The
  protocol per analyser (astm or hl7) is the per-hospital adapter choice; the instrument-code mapping stays on the server.
- Analyser results do NOT go through `/ward/hl7`: that door files ANOTHER system's records (landBundle, external source).
  An analyser measures this hospital's own specimens, so its results wait in `_wardsynq_analyser_result` (the bench
  inbox) and reach the chart only when a technologist presses Release, through lab-result.js `releaseResult` as that
  person: autoverification, second-person verification and the critical check apply unchanged. Nothing is
  auto-released; a device actor never writes an Observation or DiagnosticReport.
- QC (lab-qc.js): control lots with target mean/SD per test and level; runs typed or received (an active lot's sample
  id marks a QC run); Westgard 1-2s warning and 1-3s, 2-2s, R-4s (different level within two hours), 4-1s, 10x
  rejections evaluated server-side on every run, window restarting at the last corrective action. A rejected run
  blocks analyser release and verification of that analyser's results for that test until a corrective action; an
  override needs a reason, is its own record and audit row, and is listed on the QC screen. The block is derived.
- Reagents use the pharmacy stock ledger at location "Laboratory"; lab.result reaches `stock`/`stock-move` for that
  location only (the grant adds StockMovement). Specimen rejection is `specimen-outcome` failed with a `rejectionCode`
  (haemolysed, clotted, insufficient, mislabelled, wrong-container); monthly counts by reason and ward read the
  encounter's ward through the repository (the lab grant cannot read Encounter; only ward names and counts leave).

## 2026-09-16 ABDM end to end at a WardSynQ hospital (S6 phases A3, A5 and the registry checks; branch gap-abdm)
Design: `docs/emr-gap-analysis/S6_ABDM_INTEGRATION_DESIGN.md` 3.3-3.6, 4.2. Owner A1-A5 stand.
- **Credentials: the shared bridge, not per-hospital secrets.** The gap brief asked for client id/secret entered per
  hospital; owner A1 (binding, pinned by `test/wardsynq-abdm-hospital-routes.test.mjs`) says one shared StewardMD
  bridge, no own-bridge credentials built or shown. Kept A1: the bridge secret stays the existing Pages secret
  `ABDM_CLIENT_SECRET`; what is the hospital's own (environment from its status, HIP/HIU IDs) comes from its profile
  through `abdmConfigFor` (config.js). No new env var. Offering own-bridge credentials is an owner change of A1.
- **Connection** (`abdm-connect.js`): connected only when the profile is active, `sandbox-linked`, has a HIP ID and
  the bridge secret exists; production is never connected (A2). Every ABDM screen says which of not set up,
  switched off, not linked, suspended, production held or no bridge credential applies.
- **Callback routing**: a saved ABDM profile is projected into `connect_connector_config` (connector `abdm`,
  config.hipId), which `resolveHipTenant` already reads; unlinked or suspended removes the row so callbacks fail
  closed. The v3 receiver replies with the X-HIP-ID/X-HIU-ID ABDM addressed (after the bearer check).
- **ABHA desk** (`abdm-desk.js`, routes `/ward/abdm-desk`, `/ward/abha`): queue.add plus owner A5's
  `abhaDeskCan`; Connect membership is not used. A verified or created ABHA returns a 30-minute HMAC proof
  (QUEUE_TOKEN_SECRET); `/patient/register` binds the ABHA to the MR number only with a valid proof and refuses an
  ABHA already bound to another MR before issuing a number. A typed ABHA is recorded as typed.
- **Scan and Share** (`abdm-share.js`): QR per counter (general desk unless tokens are per department, and each
  active department; hyphenated `hip-id`/`counter-id`, D13). A share is queued in the counter's department through
  the queue engine with the ABDM profile sealed on the ticket (`encShare`, `abdmShareOrg`); nothing is registered
  automatically (MPI dedupe is the desk's decision). A token that cannot be issued answers ABDM FAILURE.
- **HIP for the inpatient record** (`abdm-hip.js`): one care context per record, `IPD:<enc>:DS|RX|IMM|DR-<h>|INV-<h>`
  and `OPD:<enc>:OPC` for an ED visit; DiagnosticReportRecord and InvoiceRecord hold one report/invoice each per
  the IG, so those are per record. Only final records: signed summary, released reports, coded completed
  immunizations, untaxed single-currency invoices. Served through a READ-only service actor; the subject is
  re-derived from the Patient record's consented ABHA address at serve time. Serializer: `ctx.facility` makes the
  HFR Organization author, custodian and attester; patient identifiers HIN/ABHA; section codes only where the slice's
  entry types match (ndhm.in 6.5.0).
- **Linking**: on admission (records nothing final, audited), discharge and summary signature, after the response
  (`waitUntil`): register rows, then link with a cached token or request one with the ABHA address only (no number,
  FAQ Q32) and link the pending contexts when on-generate-token arrives (correlated by X-HIP-ID + abhaAddress, M2
  document v2.7 4.3). Pending refs are kept in KV as hashes only. The chart's Link now retries.
- **HIU from the chart** (`abdm-chart.js`, ward.js ABDM tab): request (purpose CAREMGT/BTG/HPAYMT, HI types, period,
  access end), status from the consent row, fetch under a GRANTED verified artefact, records filed by abdm-land.js
  listed by `meta.source.system === "abdm"`. `hiu.js` accepts a server-resolved `{ actorId, tenantId }` and the
  hospital's HIU ID; its consent checks are unchanged.
- **HFR/HPR** (`abdm-registry.js`): facility search pinned to the NHA HPR V2 guide section 8 body/response on the
  V4 host (host UNCONFIRMED); professional lookup path from the M4 Postman export, body/response UNCONFIRMED, so
  "verified" only when the answer carries the same HPR ID. Results stored on the profile record as a version, audited.
- NOT built: own-bridge credentials (A1), production (A2), DPDP confirmation record, WellnessRecord and
  HealthDocumentRecord from the ward record, taxed invoices, the V3 HIU data-push route's per-hospital HIU identity
  on acknowledgement (still the deployment's), and any live sandbox run.
## 2026-09-16 Statutory registers are internal record types, one capability per register
- NDPS, PCPNDT Form F, medico-legal cases, MTP, births/deaths/still births with MCCD, and IDSP/IHIP notifications live
  in the append-only repository as internal types (`_wardsynq_register_<kind>`, registers.js), like bug reports and
  connectors, not as RecordService resource types: a resource type is readable through the raw record door, the chart
  and the change feed by every role with a null read scope, and Form F, MTP and MLC must not be.
  `RecordService.changes()` now withholds `_wardsynq_register*` rows. Each save is a version in the same append as its
  audit row; a correction names the version and a reason; every register read is audited; audit rows carry no names.
- New capabilities (functions/_queue_roles.js): register.ndps (pharmacy, supervisor), register.pcpndt (radiologist,
  obstetrician), register.mtp (obstetrician, him), register.records (him), mlc.record (doctor, obstetrician),
  register.ihip (public_health). New roles: `obstetrician` (doctor + Form F + MTP + MLC) and `public_health`.
  admin holds all by construction. No actor.js grant changed.
- The NDPS register is not a second ledger: it is read from StockMovement, MedicationDispense and
  MedicationAdministration (controlled-drugs.js). Drugs are flagged in Admin clinical settings (`controlledDrugs`) or by
  `controlled: true` on a formulary entry. Wastage/adjustment, dispense and eMAR administration of a flagged drug need
  a named witness who is an active member of the hospital holding order.dispense, med.administer or register.ndps and
  is not the recorder. The witness is named, not signed in (a PIN co-sign is the upgrade). The witness and the shift
  count are hospital policy; the NDPS Rules require Forms 3E/3H/3-I (cited in the file).
- A returned dispense no longer counts as an issue in stock levels (stock.js levelsFrom, batchBalances).
- A final obstetric ultrasound report is refused without a complete Form F linked to its request; a preliminary one is not.
- Nothing is submitted to any authority (CRS, IHIP, District Appropriate Authority, CMO): no public API exists; exports
  are CSV and printable tables, and every response says submission is manual.
## 2026-09-16 DPDP Act 2023, NABH and HMIS returns, DHS self-assessment, report builder
- New capability `dpdp.manage` and role `dpo` (queue.view, emr.view, dpdp.manage). Its grant writes PrivacyNotice,
  PrivacyAcknowledgement, DataPrincipalRequest, DataBreach, PatientConsent and Patient, nothing clinical. The front-desk
  (queue.add) grant gains PrivacyAcknowledgement. functions/_wardsynq/dpdp.js; screen wardsynq/site/pages/governance.js.
- DPDP Rules 2025 text was not confirmed: every answer and breach-notification time is hospital-set
  (`wardsynq.dpdp.responseDays`, `breachBoardHours`, `breachPrincipalHours`), returned with `confirmed: false`, and
  with no setting there is no due date. No time from the Rules is hard-coded.
- Erasure withdraws consents other than treatment, blood products and procedures (s7 makes care independent of
  consent), removes ABHA identifiers from the current Patient version and clears optional OPD registration details
  (address, district, state, PIN, referral, ABHA link) through `_opd_patient_store.clearOptionalRegistration`. The
  clinical record is kept (s8(7), s12(3)); a value removed from the current record stays in version history and is
  never called erased. An erasure that cannot finish leaves the request in progress with what was and was not done.
- `PatientConsent` gains the `marketing` scope (s7(a)), withdrawable in the portal.
- NABH: no monthly submission format is published, so the 32 PSQ 3a-3d indicators are a monthly table
  (functions/_wardsynq/compliance.js). 8 are computed from the record; 24 are marked not computable with the missing data.
- HMIS monthly (Other Secondary Care Facility, Pvt): items WardSynQ supports are filled; every other item says not available.
- DHS 2nd ed.: one `DhsAssessment` record per hospital, a self-assessment, never a certification. FPM.1 prints "d" twice;
  the second is keyed FPM.1.d-2.
- Report builder: named datasets only, no query language; staff.admin at the door, each dataset re-checks its own read
  capability and any patient-identifying column needs emr.view; `SavedReport` shared within the hospital; CSV built
  server-side, formula-looking cells defused.
## 2026-09-16 General stores, biomedical assets and the blood bank inventory reuse the one stock ledger
- Stores issues are stock.js transfers (out of the central store, into the department's sub-store) naming the indent;
  a spare part fitted on a job card is a new stock.js kind, `consumption`, naming the job card and department. There
  is no second ledger: the store level, the pharmacy level and the consumption report read the same movements.
  Indent state (approved, part issued, back-ordered, acknowledged, closed) is derived from Indent, IndentDecision,
  IndentReceipt, IndentClosure and the transfers, never stored. Back-orders are ordered through purchasing.js
  (`indentId` on the purchase order); approval stays on the existing approval chain.
- Four capabilities in _queue_roles.js: `dept.request` (raise and acknowledge an indent, report broken equipment;
  hospital-floor roles only: doctor, supervisor, nurse, intern, resident, pharmacy, lab, radiographer, radiologist and
  the two new roles), `stores.indent.approve` (supervisor; the membership's department scope decides which
  departments, and nobody approves their own indent), `stores.manage` (new role `store_keeper`), `asset.manage`
  (new role `biomedical_engineer`). Desk roles (reception, cashier, billing, hr, him) were left out because their
  record grants are pinned as having no, or read-only, clinical actor.
- Asset status and location are AssetEvent records; job card state and downtime are JobCardEvents; overdue PM is
  computed from the last closed job against the schedule.
- Blood units are a per-unit register (BloodUnit), not stock movements: each bag is traced individually. A unit's
  status is derived from its donation's tests (quarantine until all five mandatory tests are non-reactive and the
  group is recorded), its own events (discard, release) and the TransfusionEpisode that names it: a crossmatch
  reserves it and the episode's issue takes it off the shelf, so issue writes nothing new. The crossmatch and issue
  routes refuse a registered unit that is not available/reserved for that episode and take group, RhD, component and
  expiry from the inventory. Units from other blood centres (not registered) pass as before, marked untracked.
  Component shelf lives are defaults only (not confirmed against the Drugs and Cosmetics Rules text); the expiry on
  the label is what is recorded.
## 2026-09-16 Hospital support services: diet, CSSD, housekeeping, ambulance, mortuary (branch gap-support)
- Seven narrow capabilities (diet.order, diet.kitchen, cssd.process, housekeeping.task, housekeeping.inspect,
  transport.dispatch, mortuary.manage) and six roles (dietitian, kitchen, cssd, housekeeping, transport, mortuary);
  supervisor also holds housekeeping.inspect. Each grant in actor.js reads only what the job needs.
- Nine record types in RecordService (DietOrder, MealRound, InstrumentSet, SterilizerLoad, CssdCycle,
  HousekeepingTask, AmbulanceVehicle, AmbulanceTrip, MortuaryCase), all route-governed (the raw door refuses them).
- A housekeeping bed task is derived from the bed master (state cleaning + new bed.stateSince) and written by the
  first person who acts on it: no system actor and no second write at discharge. With
  wardsynq.supportServices.housekeepingInspection on, a freed bed goes to cleaning and POST /bed/update refuses
  cleaning to available; only a passed inspection by someone other than the cleaner releases it. Off by default,
  so the bed board behaves as before.
- A diet order carries an NBM window beside the diet; what may be served is decided per instant (diet.js dietAt).
- A completed AmbulanceTrip is captured by charge-capture.js (code AMBULANCE-BLS/ALS); billing reads it, writes nothing.
- The MLC flag is read (Encounter/Patient `mlc` or `medicoLegal`), never set here; unrecorded asks who confirmed.
- Screens: wardsynq/site/pages/support.js (five pages, Map tiles in Command and operations), Diet tab on the chart.

### Gap wave 2026-09-16: HR beyond the rota, and patient engagement
- HR records (hr-attendance.js, hr-records.js) are internal append-only types in the hospital's record store
  (`_wardsynq_hr_*`), not RecordService types: `hr` holds staff.admin and no clinical actor, and a RESOURCE_TYPES
  entry would be readable by every emr.view role through the raw record door. Same reasoning as bug-reports.js.
  Routes under /ward/hr-*: own records and clocking are queue.view with the identity taken from the caller's
  membership; everything about other staff is staff.admin. Payroll is not built (owner).
- Attendance links a clock-in to the caller's rota assignment whose window (two hours before start to end) holds
  now. The monthly summary is computed, never stored; absent only once a shift has ended. Device CSV import is
  three steps on one route (map, preview, commit with the previewed count), deterministic ids plus a two-minute
  duplicate window make a re-import write nothing.
- Credential alerts (60/30/7 days) are in-app records for the member and HR, raised by the tick or "Check expiries
  now"; no SMS or push to staff. `wardsynq.hr.expiredRegistrationBlocksSigning` (off by default) clears the
  signing credential in resolveClinicalActor when every recorded registration has expired, so all signing paths
  refuse NO_CREDENTIAL; unreadable records while the rule is on block signing. No registration on file is not blocked.
- Patient messaging (patient-messaging.js): five types, each off until enabled with its template. SMS reuses the
  existing 2Factor DLT path and the hospital's DLT sender ID (alerts.sms.senderId) with a DLT template name per
  type; the 2Factor API key is still the existing TWOFACTOR_API_KEY secret, no new env. WhatsApp Business Cloud API
  is a new connector kind (`whatsapp`, provider `meta_cloud`), token sealed per hospital via connectors.js; request
  shape from Meta's messages reference (URL in the file header), contract-tested with mocked fetch. A message is
  `sent` only when the provider accepted it (WhatsApp message_status accepted); held/paused/refused/unreachable is
  failed or retrying (max 3), with the reason on Admin > Patient communication. Delivery receipts (WhatsApp status
  webhooks, SMS DLRs) are not consumed: the screen says delivery is not confirmed. Consent per channel with the
  consented number is `_wardsynq_comm_pref`, recorded by the patient in the portal or by the desk (queue.add) with a
  note; opt-out is re-checked at send. Quiet hours hold; an expired moment is never sent late.
- Portal self-booking (online-booking.js) narrows portal-requests.js's "a patient cannot book": only sessions the
  hospital publishes in wardsynq.onlineBooking are bookable, only free non-blacked-out slots, written as an ordinary
  Appointment by the patient's own DRAFT actor. A `_wardsynq_slot_hold` record appended at the next version decides
  a race between two patients; a staff booking at the same instant does not take the hold (scheduling.js's existing
  residual). Patients change only bookings made online, within the hospital's notice hours.
- Feedback (patient-feedback.js): one invitation per finished IPD/OPD encounter, questions copied onto it; the link
  token is in the URL fragment and indexed by its SHA-256. The feedback message stores the link it sent (so a retry
  can resend it). NPS plus hospital questions; low scores go to a service-recovery queue resolved with a note.
- Not built: payroll, staff SMS/push for credential alerts, delivery receipts, a patient-visible reminder history,
  booking a slot through the staff diary's holds, per-department NPS trend charts.

## 2026-09-16 Scheduled backups go to a backup-destination connector, never to an existing bucket by default

- **Where a backup can be written today without a new binding: nowhere safe by default.** The Pages bindings that
  exist are CONNECT_DB (the store being backed up, same failure domain), MAIK_KV (25 MB values, not a backup store),
  FOLLOWCARE_R2 (FollowCare photos under a 7-day lifecycle) and OTA_R2 (`stewardmd-offline`, the paid drug DB and OTA
  files). Putting hospital records in either bucket would be a silent answer to owner decision S1 and to "where the
  record backups live, and who holds them", and a new Cloudflare coupling in domain logic. Not done.
- **So the destination is a per-hospital connector** (`functions/_wardsynq/backup-destinations.js`, kind `backup`,
  Admin Center > Integrations > Backup destination): `s3` is the hospital's own S3-compatible bucket with sealed
  credentials (works now, needs nothing from the owner); `platform` is the deployment's object store (`DOC_S3_*`,
  object-store.js) and reports "not configured" until S1 chooses the bucket. SFTP is not offered: a Worker has no
  SSH client without a new dependency; an S3 gateway (MinIO) in front of SFTP covers it.
- **Schedule** (`backup-schedule.js`): the worker's existing hourly cron POSTs `/api/queue/ops/backup-all` (no new
  cron). Per hospital: one full a month, one incremental a day from the last run's record-store sequence, a run too
  large for one request continues next hour (`more`). Encrypted AES-256-GCM under an HKDF key per tenant from the
  existing document key; no key, no backup. Each file read back and SHA-256 checked. Retention from the connector
  (default 30 daily, 12 monthly); a kept restore point keeps every file of its chain before it.
- **Verification**: weekly restore dry run into a MemoryRepository scratch tenant (never the live store): files,
  checksums, verifyPlan over the chain, row counts per type against the runs' manifests, and the audit-chain link
  recorded at backup time against the live chain. Recorded as an automated RestoreTest. Above 20,000 rows the
  scratch replay is skipped and the test is recorded as partial (ponytail ceiling).
- **Reporting**: System health's Backup line says "Backups are not running: no backup destination is configured"
  with what to set up, or the S1 wait, or the last failure; otherwise last successful backup, size, last restore test.
  A failure pushes to the phones of active staff.admin members once a day per failure code, and the outcome (sent n
  of m, no device, push not configured) is shown, never "delivered".
## 2026-09-16 NHCX payer adapter sends for real; only a verified callback moves a record (gap-claims-gst A)
- **Decision:** `wardsynq/wardsynq-nhcx-adapter.js` builds NRCeS ClaimBundle / CoverageEligibilityRequestBundle / Task,
  encrypts to the payer's X.509 certificate as a compact JWE (RSA-OAEP with SHA-1 per RFC 7518, A256GCM, aad = the
  protected header) with WebCrypto only, takes a token from `<gateway>/participant/auth/token/generate`, and POSTs
  `{"payload": jwe}`. A 202 is `sent` (never acknowledged). `functions/_wardsynq/nhcx.js` writes a tenant system record
  `_wardsynq_nhcx_exchange` (ids only) BEFORE the request leaves, and the public
  `POST /api/queue/nhcx-callback/<orgId>/<resource>/<action>` believes an answer only after: RS256 bearer JWT verified with
  the gateway signing certificate on the payer connector whose code is the sender (exp/iat), JWE decrypted with the
  hospital's own sealed PKCS8 key, recipient code equal to the hospital's participant code, correlation id sent by this
  hospital through that connector for that kind of request. Unverified callers write nothing (not even audit); later
  refusals are audited. New record type `CoverageEligibilityCheck` (billing.charge writes, billing.view reads).
- **x-hcx-timestamp is ISO 8601**, not the "Unix timestamp" the OpenAPI schema text says: the spec's own example JWE,
  every integrator SDK and the gateway's validator (joda `new DateTime(String)`) use ISO 8601.
- **Pre-authorisation diagnoses** sent to a payer must be DOCUMENTED on the problem list (same rule as a claim); a
  pre-authorisation is approved only on outcome complete/partial with an approved amount above zero and refused only on
  complete with exactly zero; a claim answer records the payer's figures and never moves the claim lifecycle.
- **Trade-off / not built:** certificates are entered per payer connector (sealed), not fetched from
  `/participant/search`; a token is fetched per call (no cache); communication/request, paymentnotice and
  predetermination are not built; a Patient travels as a logical id only (payers needing ABHA or demographics will ask
  for more). A callback that races the claim's own "sent" write can make that write answer 409. Not verified against a
  live NHCX sandbox (mocked transport only).
- **Status:** built, tested (test/wardsynq-nhcx.test.mjs, test/ward-rad-tpa-view.test.mjs).

## 2026-09-16 GST rules by law, credit/debit notes on the invoice ledger, and e-invoicing (IRN) as a connector (gap-claims-gst B)
- **Decision:** `functions/_region_in.js gstForLines` applies the rules the law fixes for a clinical establishment, read
  from the primary PDFs on cbic-gst.gov.in: a non-ICU/CCU/ICCU/NICU room over Rs 5000 a day is 5 percent on the whole
  day's charge without ITC (Notification 03/2022-CT(Rate) entry 31A in 11/2017; 04/2022-CT(Rate) proviso to serial 74
  of 12/2017; in force 18 July 2022); other health care (Heading 9993) is exempt; a medicine on an inpatient bill is
  exempt as part of the composite supply; a medicine sold to an outpatient takes the Price list rate. The Price list row
  carries `hsnSac`, `gstRate` and, for beds only, `intensiveCare` (never inferred from a ward name); each is stored only
  when sent, so an older screen cannot wipe it. Invoice lines carry hsnSac, taxable value, basis and tax; CGST/SGST
  versus IGST is computed in the summary from the buyer's place of supply against the GSTIN's state (never stored).
- **Research correction:** the research note had 03/2022 and 04/2022 the other way round (03 inserts the taxable
  entry, 04 the exemption proviso). Circular 32/06/2018-GST's own text names FOOD to in-patients as part of the exempt
  composite supply; it does not mention medicines. Medicines to in-patients are exempt here by the same composite-supply
  reasoning (Sections 2(30), 8(a) CGST Act; Gujarat AAR 106/2020 cited in the research), which a hospital's
  accountant should confirm.
- **Decision:** credit and debit notes are ledger events on the same append-only invoice (`postNote` in
  `wardsynq/wardsynq-invoice.js`): own number (CRN/DBN series), date, required reason, lines naming the charge line with
  a taxable value and GST at that line's own rate. Credit is capped per line at what is still creditable; void is refused
  once a note or an active IRN exists. A credit note reversing GST after 30 November following the supply's financial
  year is recorded with `gstReversalLate` and a warning (Section 34(2)); the annual-return date is not known here.
- **Decision:** tax invoices in India get a consecutive number per financial year (`INV/2627/000001`, 16 characters max,
  Rule 46(b)), issued from a `_wardsynq_doc_series` record with optimistic concurrency. A number issued before a failed
  invoice write is a gap, not reused. Invoices raised before this change have no number and cannot be e-invoiced.
- **Decision:** e-invoicing is a singleton connector kind `einvoice` with an adapter map; the first adapter is the NIC
  IRP direct API (auth `/eivital/v1.04/auth`, `/eicore/v1.03/Invoice`, `/eicore/v1.03/Invoice/Cancel`, headers
  client_id/client_secret/Gstin/user_name/AuthToken, RSA PKCS#1 v1.5 over base64(JSON) with the IRP public key, SEK and
  payloads AES-256-ECB). WebCrypto lacks both ciphers, so RSA is BigInt modexp on the SPKI-imported key and ECB is built
  from single AES-CBC blocks; both are checked against node:crypto. Only B2B bills with a buyer GSTIN and only taxed lines
  are reported; B2C, exempt-only, unnumbered, missing-HSN, not connected and not enabled are refused with a plain reason
  before anything is sent. The hospital's own "applies to us" setting decides applicability; turnover is not computed.
  (SUPERSEDED 2026-09-17: applicability is the aggregate turnover including exempt supplies on the GST settings; place of
  supply is where performed by default; a mixed B2B bill is a Tax Invoice plus a Bill of Supply. See the entry below.)
  Signs in per call (no token cache). Cancel only within 24 hours of AckDt (India time). Printed invoice draws the signed
  QR with the existing vendor/qrcode-generator.js.
- **Not built:** B2C place of supply from a patient address (B2C is intra-state), the 30-day reporting limit for AATO over
  Rs 10 crore (the IRP refuses), e-way bills, GSTR returns, GST on the OPD clinic billing station (q_invoices, which still
  has no tax), unit codes other than NOS for medicines. Not verified against the live NIC sandbox (mocked IRP only).
- **Status:** built, tested (test/wardsynq-gst-einvoice.test.mjs).

## 2026-09-16 Package billing: a versioned package master, a package copied onto a stay, and a manual pack for schemes with no API (gap-claims-gst-2)
- **Decision:** `functions/_wardsynq/packages.js`. The master is a tenant system record `_wardsynq_package` (one per
  scheme and code; scheme pmjay / state / cghs / echs / insurer / hospital; rate in rupees; inclusions and exclusions as
  Price list kinds plus named items; expected length of stay; pre-authorisation required; the scheme's pre-auth and
  claim document lists). Append-only: every change is a version with a reason and the version read, audited
  `package.create / update / withdraw / restore` with the fields changed (and old/new rate). staff.admin writes on
  Admin > Price list > Packages; billing.view reads.
- **Decision:** a package on a stay is a new record type `PackageAssignment` (billing.charge writes, billing.view reads,
  granted with Claim), id per stay, carrying a COPY of the package version, the pre-authorisation it is linked to (must
  be this patient's) and the scheme beneficiary ID. Change or removal needs a reason; refused once the package line is
  on a bill (raise a note instead) and refused on a stay that already has an itemised bill (no care billed twice).
- **Decision:** `raiseInvoice` on a package stay bills the package line (sourceType PackageAssignment, never twice), every
  charge the package covers at zero with `packageIncluded` (an unpriced covered charge needs no price), exclusions on top
  (`packageExcluded`), and charges named neither way billed and flagged `packageOutside` for a person to check. An
  exclusion wins over an inclusion. Charges of any OTHER active package stay are kept off a patient's other bills. With
  no stay named and none open, the latest package stay with something billable not yet billed is the bill's stay, so a
  discharged package stay is still billed by its package. The invoice carries `package` with length of stay exceeded
  and pre-authorisation state flags; the bill still raises (the desk decides), it says so.
- **GST:** the package line is treated as a health care service (exempt) and covered lines carry no tax.
  Not split: a package bundling a room above Rs 5,000 a day; a hospital's accountant decides, the package then needs GST fields.
  SUPERSEDED 2026-09-17 by "GST on package billing per the GST treatment review" below: the room is carved out.
- **No scheme API:** PM-JAY TMS has no public API and no CGHS/ECHS API is verified, so `GET /ward/package-pack` returns
  a checklist, the package's own document lists and a field export labelled manual submission, and never marks anything
  submitted. TMS pre-auth sections per the PM-JAY 2.0 TMS Provider User Manual (sha.kerala.gov.in); mandatory documents
  are per package, so the hospital enters them from the scheme's package master rather than WardSynQ inventing them.
- **Not built:** automatic LOS enhancement requests, per-day package rates or multi-package stays, importing a scheme's
  HBP master file, GST split for bundled rooms, `/ward/charges` preview still lists a package stay item by item (the TPA
  screen's package split and the bill are package-aware).
- **Status:** built, tested (test/wardsynq-packages.test.mjs, test/ward-package-view.test.mjs, test/wsq-admin-packages.test.mjs,
  test/run-ward-package-ui.mjs headless).

## 2026-09-16 WHO growth tables: shipped with citation; LICENCE NEEDS A LEGAL CHECK before commercial release (branch gap-clinical)

- **SUPERSEDED 2026-09-17** by "Growth charts use the CDC 2000 reference (public domain)" below: the WHO tables were removed.

- **Licence (open question, owner/legal).** The task brief called the WHO growth LMS tables public domain. What was
  actually found: WHO publications are CC BY-NC-SA 3.0 IGO (non-commercial; commercial use and derivatives need
  WHO's permission, https://www.who.int/about/policies/publishing/copyright), and the tables were taken from WHO's
  R packages anthro (GPL-3) and anthroplus (GPL >= 3), which name WHO as copyright holder of the data. WardSynQ is
  sold to hospitals, so whether shipping these tables inside it needs WHO permission is a legal question, not
  decided here. Shipped for now with full citation, source URLs and the licence text found, in the JSON files and
  wardsynq/data/WHO-GROWTH-NOTICE.txt. Before commercial release: legal check, and a WHO permission request if needed.
- **Method.** wardsynq/wardsynq-growth.js follows WHO's own R code (anthro R/z-score-helper.R, z-score-*.R;
  anthroplus R/zscores.R): restricted |z| > 3 adjustment for weight-for-age, weight-for-length/height and BMI only;
  day tables with round-half-up, 0.1 cm and month interpolation; 2006 standards below 60 months (days / 30.4375),
  2007 reference from 60 months; +/-0.7 cm length/height conversion by position. Corrected age for < 37 weeks until
  24 months chronological; never corrected when gestation is unknown; a corrected age before term is refused.
- **Computed on the server.** GET /api/queue/ward/growth (emr.view) returns z-scores, centiles and sampled centile
  lines, so the 0.5 MB of tables sits in the Pages Functions bundle (JSON, compresses to roughly a fifth) and
  ward.js carries only the drawing code. One engine, tested once, rather than a second copy in the browser.
- **Gestational age** is taken only from the mother's recorded due date via the FamilyLink of a newborn registered
  at this hospital (280 days minus due date minus birth date, accepted between 22 and 44 weeks). The antenatal
  gestationWeeks is not used: it is whatever was typed weeks before delivery.
- **Only weight is plotted.** WardSynQ records no length, height or head circumference; the screen says so. Adding
  those measurements (with lying/standing position) is a separate change.

## 2026-09-16 Pre-anaesthetic checkup gates the WHO Sign In by a stated reason, not a hard block (branch gap-clinical-2)

- **One PreAnaestheticCheckup per theatre case** (id from the case), recorded with EMR_TREAT, revised only as a new
  version with a reason and the version it replaces. Closed vocabularies (Mallampati, neck movement, ASA I-VI + E,
  fasting status, technique, decision); nothing computes an ASA class, an airway grade or a fasting adequacy.
- **Sign In reads it on the server.** The checklist engine runs first (its refusals come first), then a missing
  checkup or an "unfit" decision refuses Sign In (409 PAC_MISSING / PAC_UNFIT) unless the submission states why it
  proceeds (pacAcknowledgement, 5+ characters). Not a hard block: emergencies proceed without a checkup, and the
  team decides. A read failure refuses (502) rather than passing. What the checkup said, or that there was none,
  and the reason given are kept on the sign-in, so a later revision cannot rewrite what the team saw.

## 2026-09-16 Expected discharge date and transfer requests are their own records (branch gap-clinical-2)

- **ExpectedDischarge**, one per stay, set by emr.treat; a change is a new version with a reason and the version it
  replaces. It is the team's stated plan, not a prediction (patient-flow.js still invents none). Overdue = the stay is
  open and the date is before today on the hospital clock (timeZone, else utcOffsetMinutes, else IST). A date before
  today is refused. Shown on the ward list row, the chart, and the command center (overdueDischarges; null = unread).
- **TransferRequest**: requested -> accepted | declined -> bed-assigned -> completed, or cancelled; each step a new
  version with who/when (and a reason on decline/cancel), one open request per stay. Asking is emr.treat; the other
  steps are queue.add like /ward/transfer, and TransferRequest joined the queue.add write grant. The move itself is
  transferPatient unchanged (bed collision and bed-state checks), after checking the patient is still where the
  request found them. A move whose request could not then be closed returns 502 request_not_closed, transferred:true.
- **Not checked:** that the person accepting belongs to the receiving ward (the server has no ward membership). An
  ICU transfer request moves the location through the same route and does not change the stay's class.

## 2026-09-16 Hospital-loaded code sets, no licensed content shipped (branch gap-clinical-2)

- **SNOMED CT, ICD-10, LOINC are loaded by the hospital** (Admin > FHIR > Code sets, CSV or tab-separated release file with
  a code and a display column), with a licence confirmation recorded on the import (who, when, the statement). No release
  ships: SNOMED CT needs the hospital's NRCeS affiliate licence, ICD-10 is WHO-licensed, and the LOINC licence text could not
  be retrieved on 2026-09-16 (loinc.org refused automated fetches), so no LOINC table ships either.
- **Stored as records** (code-sets.js): CodeSetImport per system + CodeSetChunk records of 2000 codes, chunk ids carry the
  import id so a re-import never overwrites. Search reads the whole set into memory (per-isolate cache); ceiling 100k codes
  per system. Past that, an indexed store (D1 table with FTS) behind the repository adapter.
- **A code is attached only from the loaded set** (resolveCoding): problems/diagnoses with codeSystem snomed|icd-10|loinc,
  an operation booking (SurgicalCase.procedureCoding), a test order (ServiceRequest.standardCoding). The stored display is
  the set's. FHIR Condition/Procedure/ServiceRequest and the ABDM consultation record carry the coding when present.

## 2026-09-17 Blood donor criteria: the stricter of WHO 2012 and the law of the hospital's country, per hospital stricter only (branch fix-donor-growth)

- **Owner decision, corrected the same day by the legal review (section G).** The owner asked for international criteria
  (WHO) instead of the unconfirmed secondary-source values. The legal review found that in India the donor criteria of the
  Drugs and Cosmetics Rules 1945, Schedule F Part XII-B, "H. Criteria for Blood Donation" (substituted by G.S.R. 166(E),
  11 March 2020) are licence conditions of a blood centre (r.122-P, r.122-O), so a WHO value looser than the Rule would breach
  the licence. Rule: **each criterion in force is the stricter of WHO and the law**; a hospital may only make it stricter.
- **Sources read, not assumed (2026-09-17).** WHO, Blood donor selection (2012), ISBN 978 92 4 154851 9, on NCBI Bookshelf
  (ch. 4 NBK138219, ch. 6 NBK138208, ch. 7 NBK138223); no later WHO edition found. The gazette text of G.S.R. 166(E), items
  1-104, from https://drugscontrol.py.gov.in/sites/default/files/GSR-166-E.pdf. Council of Europe (EDQM) Guide, 22nd ed.
  (2025), standard 2.4.1.4, for the yearly whole blood maximum WHO does not set. Every value in
  functions/_wardsynq/donor-criteria.js carries its WHO section or its item number.
- **Resulting values in India:** age 18-65, first-time donors up to 60, apheresis 18-60, no physician's discretion past an
  age limit (item 2); 45 kg for 350 mL, **more than** 55 kg for 450 mL (item 3, the old `>= 55` was a bug), 50 kg for apheresis;
  Hb 12.5 women (item 9) and 13.0 men (WHO 4.6.1); 90/120 days (item 4); apheresis 28 days between platelet collections and
  14 for plasma (WHO 4.6.2, stricter than the Rule's 48 h), at most 2 in 7 days and 24 in a year, 28 days after whole blood,
  whole blood 28 days after apheresis or 90 if the red cells were not all returned (item 4); platelet count above 150 and
  total protein above 60 g/L (WHO 4.10); BP 100-140/60-90, pulse 60-100 and regular, temperature measured (items 5-7).
  Outside India: WHO values, CoE 6/4 donations a year, BP and pulse not checked unless the hospital sets a limit, and the
  WHO physician's discretion for older donors (named on the record).
- **Deferral table as data.** Each yes on the questionnaire is deferred against a condition (35 conditions, WHO and Rule
  periods, the longer or permanent wins); the period is worked out from the date given, a longer typed period is allowed,
  a shorter one never. Conditions with no fixed period (breastfeeding, minor illness in the Rule) need days typed.
  Item 52 is kept as the Rule states (sub judice); changing it is a code release citing the amending notification.
- **Temperature.** Item 7 says "Afebrile; 37 C/98.4 F". Read as normal body temperature, not a ceiling: febrile is WHO
  4.5.2's more than 37.6 C, and a centre that reads 37.0 as the ceiling sets it on Admin. Flagged for the legal reviewer.
- **Jurisdiction** = the hospital's region: India when the region is IN or not set (as the rest of WardSynQ reads it), none
  for another country until its law is reviewed (`legalMinimums` is keyed by jurisdiction).
- **Settings** live in `wardsynq.bloodDonorCriteria` (org whitelist), edited at Admin > Hospital > Blood donor selection
  criteria through GET/POST /api/queue/org/blood-donor-criteria (staff.admin, audited by criterion name). Validated on save
  and again on every read; a stored value that is looser is ignored.
- **Not built:** double red cell apheresis, the Rule's pre-donation checks as separate hard gates (they are one question and
  a condition with typed days), component shelf-life changes from the legal review (Schedule P was not read here), NAT,
  pilot sample retention, the donor record 5-year retention rule.

## 2026-09-17 Growth charts use the CDC 2000 reference (public domain); a hospital may load its own licensed WHO or IAP tables (branch fix-donor-growth)

- **Owner decision: growth tables must permit commercial use.** The WHO Child Growth Standards tables shipped on
  2026-09-16 (CC BY-NC-SA 3.0 IGO) were removed from the repository (wardsynq/data/who-growth-2006.json, who-growth-2007.json,
  WHO-GROWTH-NOTICE.txt). They remain in git history before this commit; rewriting history was not done.
- **Shipped instead: CDC 2000 growth charts, LMS data files** (wardsynq/data/cdc-growth-2000.json, 81 KB): wtageinf,
  lenageinf, wtleninf, hcageinf (birth to 36 months), wtage, statage, bmiagerev (2 to 20 years), wtstat (weight-for-stature).
  Only Sex, age/length/height, L, M and S are kept, values unchanged; the smoothed percentile columns are derivable.
- **Licence verified from the publisher's own page.** CDC, Use of Agency Materials (cdc.gov/other/agencymaterials.html):
  "Most of the information on the CDC and ATSDR websites is not subject to copyright, is in the public domain, and may be
  freely used or reproduced without obtaining copyright permission", with four conditions: attribute CDC, state that use
  does not imply endorsement by CDC/ATSDR/HHS/US Government, do not change substantive content, state the material is
  available on the CDC website for no charge. The data page carries no copyright statement. The attribution and
  non-endorsement statement are in the data file and on the chart's source line.
- **CDC's WHO-based 0-24 month files (cdc.gov/growthcharts/who-data-files.htm) are NOT shipped.** The page states no licence
  and the data are WHO's (CC BY-NC-SA 3.0 IGO); CDC's public-domain statement excludes material licensed from third parties.
- **Retrieval.** cdc.gov refused automated downloads from this machine on 2026-09-17 (Akamai 403), so the eight CSVs were
  taken from the Internet Archive captures of the same cdc.gov URLs (22 Nov 2025) and checked byte-identical to the 2021
  captures (lenageinf.csv: 2021 capture has extra comparison columns; L, M, S identical). The Dec 2024 captures were truncated
  and were not used. SHA-256 of each file is in the JSON.
- **Method (wardsynq/wardsynq-growth.js), CDC's own:** LMS z and inverse as on the CDC data page; linear interpolation
  between rows ("interpolation could be used"); no WHO |z| > 3 adjustment; age months = days / 30.4375; infant tables under
  24 months and 2-20 year tables from 24 months; +/-0.8 cm length/height conversion and the modified z-score extreme-value
  flags from CDC's SAS program page; BMI above P95 marked extendedBmiNotApplied (CDC 2022 extended BMI not implemented).
  Corrected age for preterm infants unchanged. Chart centiles 3, 10, 25, 50, 75, 90, 97. Verified against CDC's worked
  example (9-month boy: P5 7.90 kg, 9.7 kg = z 0.207, 58th centile) and several published percentiles.
- **Hospital-licensed tables** (functions/_wardsynq/growth-tables.js), like code sets: Admin > FHIR > Growth charts, CSV
  columns indicator, sex, x, l, m, s; method lms or who-restricted (WHO's adjustment on weight indicators); licence
  confirmation recorded; GrowthTableImport + GrowthTableChunk records; withdraw writes a withdrawn version and the chart goes
  back to CDC 2000. POST /api/queue/ward/growth-table-import (staff.admin), GET /api/queue/ward/growth-tables (emr.view).
  GET /ward/growth returns `reference` (id, name, citation, licence, attribution) and the ward card names it.
- **Not built:** CDC 2022 extended BMI-for-age; preterm charts (Fenton, INTERGROWTH-21st); recording length, height or head
  circumference (still only weight is plotted).

## 2026-09-17 Blood centre after collection follows Schedule F Part XII-B and Schedule P (legal opinion section G) (branch blood-legal)

- **Source:** legal opinion 2026-09-17, section G (G.1 tables, G.5 requirements 3 to 8). Rules and citations are one pure
  module, `functions/_wardsynq/blood-centre-rules.js`; `blood-bank.js` enforces them. This closes the "Not built" list of
  the donor-criteria entry above, except what is listed below.
- **Shelf life is computed, not typed.** Expiry = collection time + the Rules' shelf life for the component, the bag's
  anticoagulant (whole blood ACD 21 days, CPDA 35, Schedule P item 7) and the additive (SAGM/ADSOL/NUTRICEL 42 days); FFP
  and cryo one year, platelets 5 days, granulocytes 24 hours, an open-system pool 6 hours. An entered expiry may only be
  earlier; a later one is refused. Red cells without an additive are capped at the whole blood limit (the opinion reads no
  separate value). FFP frozen, and platelets separated from whole blood, within 6 hours of collection or refused. Storage
  is recorded as the Rules' range, not free text. The donation records its anticoagulant and voluntary/replacement kind.
- **Tests (heading K, L):** every result names its method; the irregular antibody screen is recorded (shown and printed,
  not a release gate: the opinion names the field, not a hold); NAT is a hospital setting (not required by the Rules), and a
  reactive NAT discards whether or not required. **Any reactive result in a donation's history keeps it reactive**: before
  this, the latest result counted, so a retest could clear a reactive donation, contrary to the module header.
- **Label:** printed from the unit's server record only when it may be issued, with every result, method, antibody screen
  and the group colour (O blue, A yellow, B pink, AB white).
- **Pooling:** one BloodUnit record naming its source units and donations; sources derive status "pooled". One group only.
- **Samples:** `BloodSample` register; retain-until = 7 days (or the hospital's longer setting) after the last of the
  covered units left (issued, discarded, expired); a discard before then is refused. Discard is a new version.
- **Confidential (G.5.8):** `DonorNotification` (notified, counselled, referred) only for a reactive donation, blood
  centre role only. `service.js BLOOD_CENTRE_ONLY` (BloodDonor, DonorScreening, BloodTestResult, DonorNotification,
  BloodUnitEvent) is withheld from the change feed and from `/ward/record-detail` unless the reader's grant names the type:
  a null read scope admitted every type, so any doctor or nurse could sync item 52 deferral reasons and HIV results. The
  crossmatch gate says "not available", never "reactive". The Blood bank routes still read through list/get (gated by
  transfusion.issue), so admin's null scope keeps the screen.
- **Look-back (G.5.6):** derived on read: reactions on episodes traced unit -> donation -> donor; each reactive donation's
  earlier donations from the same donor with their units' status and recipient MRN.
- **Charges (G.5.7):** `_clinic_billing.js validateTariff` refuses a tariff line named as a price/cost/sale of blood or a
  component. Only names are checked; NBTC rates are not encoded.
- **Settings:** `wardsynq.bloodCentre` { natRequired, shelfHours (shorter only), sampleRetentionDays (>= 7),
  recordRetentionYears (>= 5) }, Admin > Hospital, GET/POST /api/queue/org/blood-centre-settings (staff.admin, audited by
  name). **Merged with legal-privacy (2026-09-17):** the record period is `retention.js`'s "blood-centre" class (floor five
  years). The Admin card still edits recordRetentionYears, saved as `wardsynq.retention.years["blood-centre"]`, never in
  `bloodCentre`; classesOf never reads below the floor. Nothing in WardSynQ purges blood centre records today.
- **Not built:** frozen red cells (storage -80 to -196 C, no shelf life in the opinion); donor consent form fields (not
  listed in section G); bag batch and kit/reagent registers (heading L lists them, G.5 does not); a Medical Officer name on
  screening (the signed-in actor is recorded); NBTC processing-charge rates; storage temperature logs.

## 2026-09-17 Privacy law by date, confirmed clocks, retention classes and legal holds (branch legal-privacy)

Source: the legal opinion of 17 Sep 2026 (sections A and H; research awaiting a practising lawyer's sign-off).
- **The law is computed per day** (functions/_wardsynq/privacy-law.js). DPDP hospital duties start 13 May 2027
  (G.S.R. 843(E); Rules r.1, G.S.R. 846(E)), Consent Managers 13 Nov 2026. Before that: IT Act s.43A + SPDI Rules 2011 and
  the CERT-In Directions 2022. `wardsynq.dpdp.dpdpStartDate` may only bring commencement EARLIER (stricter). No separate
  `privacyRegime` setting: the regime is the date. The stricter of both regimes is kept after commencement.
- **Clocks replace "hospital-set, not confirmed"**: SPDI one month (min of 30 days and a calendar month) for every request
  received before commencement; DPDP 30 days per kind (cap 90) from it; CERT-In 6 hours from awareness always; Board
  detailed report 72 hours only for a breach the hospital became aware of from commencement, moved only by a recorded
  Board extension; patients 72 hours as hospital POLICY (past 72 only with a written reason). A value past a cap is not
  used. The old `breachBoardHours` setting is ignored.
- **No silent breach close**: close needs CERT-In, the patients and (where it applies) the Board recorded; the only other
  exit is "not a personal data breach" with reasons, confirmed by a different person. r.7(1) five and r.7(2)(b) headings
  are required fields; the sixth Board heading is filled from the patients' log.
- **Every answer carries the DPO/Grievance contact** from the published notice (r.9, SPDI r.5(9)); no notice, no answer.
- **Children (r.10) and guardians (r.11) gate non-care purposes only, from commencement**: research/marketing/other
  consents, a portal account, a message opt-in. Care (treatment, procedure, blood, referral sharing, clinical photography)
  is exempt (Fourth Schedule Part A item 1). An unrecorded date of birth fails closed for a non-care purpose.
- **Retention classes** (functions/_wardsynq/retention.js): clinical records 10 years after the last encounter (DGHS OM
  28 Oct 2014), a child's until 3 years after 18 (unconfirmed limitation basis, hospital may lengthen), MLC 10 years or
  proceedings end, PCPNDT 2, MTP 5; `wardsynq.retention.years` lengthens, never below the floor. Nothing auto-purges;
  a document purge needs a reason and is refused inside the patient's clinical period or under a hold. Document default
  went 3 -> 10 years.
- **LegalHold is a record type**; every non-withdrawn MLC register entry is an automatic hold. Holds block erasure and
  destruction; only register.records (the medical records officer) lifts one, with a disposal reference.
- **Copies of records within 72 hours** (IMC reg 1.3.2) are a clock on the release-of-information request (ROI), with
  new requester kinds authorised-attendant (authority recorded) and legal-authority; not a sixth DPDP request kind.
- **Log retention is reported, never claimed**: audit and read-log rows are never deleted by WardSynQ (met); storage in
  India, the platform's own logs and NTP source are not confirmed / not met (security review card).

## 2026-09-17 GST on package billing per the GST treatment review (branch gst-packages)
- **Source:** GST treatment review of WardSynQ package billing (17 September 2026, reviewer agent; citations inline in it).
  Its answers are "probable" or "unconfirmed" where no primary text settles the point; each such point is a hospital
  setting defaulting to the review's safest reading, labelled for the chartered accountant.
- **Decision:** a non-ICU room above Rs 5,000 a day inside a package is carved out of the exempt package line as its own
  line (`<code>-ROOM`, sourceId `<assignment>:room`, SAC 999311) and taxed at 5 percent; the package line keeps the rest.
  Valuation (`gst.pkgRoomValuation`): published per-day tariff capped at the package price (default), the payer's own
  per-day room rate entered on the package with its source, or a proportional split (falls back to the tariff, said, when
  a covered item has no price). `priceIncludesGst` on a package back-calculates 5/105 and records the GST the hospital
  bears. A covered room day with no bed row refuses the bill (`room_tariff_missing`). Valued when the package line is
  billed; later room days on an open stay need a debit note (the response warns).
- **Decision:** in-patient is a property of the stay: every item on an admitted patient's bill is exempt composite health
  care (SAC 999311 printed, never the goods' HSN) except a room over Rs 5,000 a day, a Price list row marked
  `nonHealthcare`, and a take-home medicine at discharge (`MedicationDispense.takeHome`, taxed unless
  `gst.dischargeMedsAsComposite`). Outpatient: services exempt with default SAC (999312/999314/999315/999316), a medicine
  given in the visit exempt, a dispensed one taxed at its row rate. A taxable line with no rate now REFUSES the bill
  (`gst_rate_missing`) instead of raising it untaxed.
- **Decision:** the room test is per day: bed rows carry `unitHours` (charge capture bills begun units per day), the
  per-day charge is max(price converted to 24 hours, the day's bed lines); `intensiveCareClass` (ICU, CCU, ICCU, NICU,
  ICU_SPECIALTY, HDU) with `gst.intensiveCareUnits` deciding the last two; `gst.roomChargeBasis` may add daily nursing.
- **Decision:** documents are computed per invoice (`documents`): Bill of Supply (exempt only, numbered in a `BOS`
  series), Tax Invoice, Invoice-cum-Bill of Supply (Rule 46A, to a patient), and for a registered buyer a Tax Invoice
  (the invoice number, the only document reported for an IRN) plus a Bill of Supply issued its own BOS number when the
  buyer is saved. The IRN request refuses a mixed B2B bill until that number exists.
- **Decision:** place of supply for health services is where performed (IGST Act s.12(4), probable): CGST + SGST even for
  an out-of-state payer; the invoice stores `placeOfSupply` from `gst.placeOfSupply` at raise, and only
  "recipient_state" restores IGST. `gst.recipientOfCashlessClaims` defaults to the patient: a buyer of kind "payer", or any
  buyer on a scheme or insurer package, is refused (`payer_not_recipient`). A TAN-based GSTIN (TDS deductor) is valid.
- **Decision:** Section 34(2) from 01.10.2025: a credit note on taxed lines needs `gstTreatment` (patient:
  `gst_refunded`; registered buyer: `itc_reversed` with a confirmation reference; or `without_gst`), asked before a number
  is issued; after the 30 November limit it is issued without GST. A note carrying no GST is `financial` and never
  reported to the IRP.
- **Decision:** e-invoice applicability is `gst.aggregateTurnoverRs` (exempt supplies included) above Rs 5 crore; the
  connector's own "applies" checkbox is removed. Settings live in org config `wardsynq.gst`, edited on Admin > Price list
  > GST settings through `GET/POST /api/queue/org/gst-settings` (staff.admin; a non-default needs the CA's opinion reference
  and date; every change needs a reason; audited `org:gst_settings` naming the settings changed).
- **Not built:** WHOLE_PACKAGE_EXEMPT valuation and per-payer valuation overrides; the 30-day IRP reporting limit for AATO
  of Rs 10 crore or more (the IRP refuses); an e-invoice override with a CA reference; GST TDS computation (only a note);
  a later confirmation step for a credit note issued while ITC reversal is pending; debit notes against a carved room on
  later days; OPD clinic billing station (q_invoices) GST.
- **Status:** built, tested (test/wardsynq-gst-packages.test.mjs, test/wardsynq-gst-einvoice.test.mjs,
  test/wsq-admin-gst-settings.test.mjs).

## 2026-09-17 Statutory registers brought to the legal review (branch legal-registers)
- Source: a legal-research opinion (not legal advice) on sections B to F; its lawyer sign-off list is still open. Where it
  says unconfirmed, the safest default ships with a hospital-editable setting and the note on screen:
  `wardsynq.registers` (register-settings.js, whitelisted in _opd_org.js), edited at POST /org/register-settings
  (staff.admin, Registers > Register settings). Clocks (Form F by the 5th, Form II by the hospital's day, RBD 21 days,
  NDPS 3J 30 Nov / 3-I 31 Mar, recognition renewal) are pure functions there.
- Companion records share their register's door and capability, chosen by `kind` from a fixed family
  (register-routes.js FAMILY): formfprint and statreturn with Form F; mtpboard (Form D), mtpforme (Form E) with MTP;
  dyingdecl with MLC; form3e, form3esign, form3j, form3i with NDPS. No new capability or router route except the settings.
- Refusals, not warnings: a Form F declaration at or after the procedure start (r.10(1A)); any obstetric USG report,
  preliminary included, without the woman's declaration on Form F; foetal sex text (audited without the text); MTP above
  20 weeks without Rule 3B category and a Form E, above 24 without an allowed Form D, a rule 4A-ineligible practitioner,
  a woman's own consent under 18 or mentally ill; MLC examination fields without consent, a male doctor for a POCSO girl;
  Form 4A with a manner of death; controlled expired-stock wastage without the Controller's nominee; controlled receipt or
  dispense once Form 3G has expired with no renewal reference. Flags, not refusals: Form I certified over 3 hours late,
  Board opinion over 3 days, a Part I mode of dying.
- MTP reg 7: for readers without register.mtp, the ward list, ED list, bed board, timeline, discharge summary and
  /patient/get show the Admission Register serial instead of her name from admission until 42 days after discharge,
  on the MTP stay's rows only. Identity bands, FHIR/HL7/ABDM, claims and the portal are NOT masked (patient safety;
  claims are a lawyer item). An unreadable MTP register withholds the response.
- BNSS s.397: POST /ward/invoice is refused while an open sexual-assault-adult, acid-attack or POCSO case exists for the
  patient. Aadhaar is never stored in RBD registers (unknown key refused; 12-digit text refused). The pharmacy names a
  Form 3E patient by id and the route confirms the Patient exists by repository read (its grant cannot read Patient).

## 2026-09-17 Statutory registers, second pass of the legal review (branch legal-registers-2)
- Two read-only capabilities and roles: `register.pcpndt.read` (role `pcpndt_nodal`: GET /ward/register-formf, POST only
  kind statreturn) and `register.ndps.read` (role `ndps_inspector`: every GET of /ward/register-ndps, no POST; actor.js
  grants READ of the four ledger types). A nurse (med.administer) reaches GET /ward/register-ndps only with view=patient.
  All three are router alternatives after the fail-closed table; nothing else widens.
- Form F on the worklist: GET /ward/imaging-worklist returns `pcpndt: [{orderId, state, missing}]` BESIDE the DICOM items
  (never inside a DICOM item). Foetal sex: a staff reply to a patient (POST /ward/patient-reply) is refused and audited
  without the text; a patient's own message is never refused. Imports (SCCM adapter): a report conclusion or imaging study
  description that states foetal sex IN AN OBSTETRIC CONTEXT (registers.js OBSTETRIC on the text and code) is not filed and
  raises PCPNDT_FOETAL_SEX_REFUSED; without the context it is filed, so a paediatric "female child" report is not lost.
  There is no DICOM SR import in the product; the study description is the DICOM text that lands.
- MTP: the POCSO intimation is a register of its own on the MLC door (`pocsotask`), opened by `def.alsoWrite` in the SAME
  append as a minor's MTP entry; its id and fields name no other register. The MTP fields pocsoIntimation/pocsoBasis/
  pocsoReference are gone. Retention end shown per entry: the later of 5 years after the calendar year and 5 years after
  the entry's last version (unsettled, so the later); nothing is deleted and no destruction workflow is built.
- MLC restricted categories (sexual-assault-adult, pocso): open to register.records keepers, the recordedBy/last writer,
  Encounter.attendingId, and `registers.mlc.restrictedReaders`; others get a withheld row (number and date) with an audit
  row, a correction is 403, and a refusal response never carries the entry. "Treating team" is those people, not a care
  team model (none exists). Every MLC-door CSV and the Kerala export require requisitionFrom/Ref/Date, audited.
  `registers.mlc.stateFormat` = hospital | kerala (Kerala DHS formats read in the review; others not built).
- Mortuary release reads the MLC REGISTER (router hands in open cases): any open case needs the police NOC; a
  death-in-custody or death-woman-married-under-7-years case needs inquestPapersReceived yes with a reference.
- BNSS s.397 also locks POST /bill/invoice (OPD clinic) for a WardSynQ hospital, matching the clinic MRN and
  patientIdForMrn(MRN); an unreadable register refuses.
- NDPS: registers.ndps.drugRegimes (end-chapter-vb default for the controlled list, state-ndps, psychotropic, schedule-x,
  schedule-h1). Recognition block and the Form 3J cap bind end-chapter-vb only; Form 3E problems end-chapter-vb and
  state-ndps. The book now groups by the hospital's local day (offsetMinutes), because Form 3H closes before local
  midnight. New records: form3hclose (numbers from the ledger, page serial 3H/yyyy, closedLate fixed at first closure,
  signed by the over-all in-charge named in settings), quarantine (an open quarantine makes a controlled dispense name its
  batch and refuses the quarantined one; stock stays in the book), homecare (the unused return is a stock receipt written
  once, before the entry; a failed entry save reports partial with the movement id), schedxsupply (the r.65(21)(b) fields
  the ledger lacks, serial X/yyyy). r.52U: a controlled receipt above the year's Form 3J (revised if any) is refused unless
  revisedEstimateRef is given; no estimate recorded, or a ledger past READ_CAP, WARNS instead (refusing a morphine delivery
  on a count that cannot be made is a patient harm). r.52V(3): a controlled transfer-out naming toInstitution needs
  controllerApprovalRef. H1 and X registers are views over the ledger (view=h1, view=schedx).

## 2026-09-17 Legal requirement registry and State/UT configuration (owner's legal guidance) (branch legal-registry)
- Binding owner guidance: no binary legal yes/no. `functions/_wardsynq/legal-requirements.js` holds every requirement as a
  record (id, title, sourceType, instrument, provision, jurisdiction IN or an ISO 3166-2:IN State/UT code, effectiveFrom,
  expiresOn, status, appliesTo, mandatory, evidence URLs with verified flag, notes, cite). `enforcement(req, {region,
  stateUt, facilityType, caseType, on})`: IN_FORCE, AMENDED, UNDER_CHALLENGE, STATE_SPECIFIC enforced; STAYED, STRUCK_DOWN,
  not yet effective, expired not. An appliesTo list with the hospital's value unknown does not exempt (safest).
- The engine reads citations and dates from it: privacy-law.js CITE and the DPDP dates, donor-criteria.js STANDARDS.IN,
  blood-centre-rules.js RULES and record/sample refs, the Form F monthly rule and the Form II note. Text byte-identical.
- The hospital's State/UT is `regionProfile.stateUt` (India adapter, validated against the 36 codes; edited on Admin >
  Legal requirements). Absent means "not recorded", never a default State.
- State/UT configuration kinds: formF {mode ONLINE|OFFLINE|PORTAL_AND_RECORD, deadlineDays, portalUrl,
  acknowledgementRequired} and medleapr {required, effectiveFrom, caseTypes}. A shipped State entry's non-null values change
  only by a code release citing the source; its null keys, and every key of an unseeded State/UT, are hospital-set in
  `wardsynq.legal.stateConfig[STATE][kind]` via POST /org/legal-requirements (staff.admin, reason, audited without values).
  Seeded: MH online 5 days (portal verified), DL online (portal verified, no deadline found), RJ portal + record (portal
  verified), RJ MedLEaPR from 2026-02-01 (Rajasthan HC, Mukesh Kumar @ Mangej v State of Rajasthan, SB Crl Misc Bail
  173/2025, 17 Nov 2025, read on Indian Kanoon). Bihar and all others unconfigured.
- Replaced settings: registers.pcpndt.onlinePortal, registers.mtp.formIIRecipient, registers.mlc.medleapr (stored values are
  now ignored). Form F: ONLINE or PORTAL_AND_RECORD requires portalSubmittedOn, plus portalReference unless
  acknowledgementRequired is false (unset = required); each list entry carries portalClock (procedureDate + deadlineDays).
  The monthly report stays central r.9(8) (5th) and shows the State/UT submission route. MLC: medleaprReference and
  medleaprFrozenOn required only when MedLEaPR is required for MLR on the arrival's local day.
- MTP Form II: to the Chief Medical Officer of the State, from the head of the hospital / owner of the approved place (reg
  4(5)); the District default and the reg 2(c) note are gone. Due day stays hospital policy.
- Item 52: registry status UNDER_CHALLENGE (Thangjam Santa Singh v Union of India); a law deferral naming a requirement is
  used only while enforced; the criteria table says "under challenge in the Supreme Court; not stayed; enforced".
- GET /org/legal-requirements: staff.admin or any register capability (read-only, canEdit false).

## 2026-09-17 Retention basis: LEGAL_OBLIGATION or RETENTION_POLICY per layer (owner's legal guidance item 4) (branch retention-basis)
- **Rule.** A retention period is "required by law" only with an identified statutory provision (Act, Rule, Regulation made
  under an Act, statutory direction or notification). An office memorandum or guideline without one, WardSynQ's default
  and the hospital's longer setting are RETENTION_POLICY. Each class in `functions/_wardsynq/retention.js` carries `BASES`
  layers (id, type, sourceType, instrument, provision, jurisdiction, years/days, from, effectiveFrom, status, evidence,
  note), shaped like the owner's requirement record so they can move into the legal requirement registry (branch
  legal-registry) without change. No second registry was created.
- **Classification.** LEGAL: IMC Regulations 2002 reg 1.3.1 (IPD, 3 years from commencement of treatment), PCPNDT r.9(6),
  MTP Regs reg 5, NDPS r.52X, D&C r.65(3)(1)(h), r.65(7)/r.65(9)(a), Sch F XII-B L/r.122-P, ART s.23, Surrogacy s.46(1),
  CERT-In Directions (iv) 180 days, DPDP Rules r.6(1)(e)/r.8(3) from 13 May 2027. POLICY: DGHS OM 28 Oct 2014 (IPD 10y,
  OPD 3y, MLC 10y), WardSynQ's OPD 10-year default, the minor rule (limitation basis unconfirmed), consent artefacts.
  Policy-only classes: clinical-opd, mlc, consent-artefacts. CERT-In counted as statutory (a direction under IT Act s.70B,
  per its title); flagged for the lawyer.
- **Setting minimums unchanged** (floorYears, e.g. IPD 10): never below a legal floor, and policy defaults are not
  shortened through settings either. Lowering them to the legal floor is an owner decision, not taken here.
- **Erasure (dpdp.js).** Legal holds refuse first. Before DPDP commencement: as before, each class labelled. From
  commencement: a class inside a LEGAL layer is kept and the answer names the law; every other class needs the DPO's
  `retentionDecisions` entry (retain + purpose/necessity, or erase). WardSynQ never erases a chart itself: an erase
  decision leaves the request in progress (erasure_partial, step erase-class) until the destruction record reference is
  given.
- **Document purge (documents.js).** Inside a LEGAL period: refused (retention_not_expired, basisType, law). Inside only a
  policy period (the document's own retainUntil or a class policy layer): 409 retention_policy_confirmation_required,
  then `policyConfirm` + `policyReason` from a user holding dpdp.manage or register.records (checked in the router),
  written on the purge version as `policyOverride`. The route stays staff.admin; no two-person rule.
- **Screen.** Privacy and compliance > Retention and legal holds lists every class and layer (GET
  /ward/retention-classes, dpdp.manage or register.records) and flags policy-only classes; the erasure request shows the
  DPO decision form; ward.js documents ask for the confirmation.

## 2026-09-17 Retention layers live in the legal requirement registry (seam: retention-basis + legal-registry)
- `retention.js` no longer holds a BASES table. Every layer is a record in `legal-requirements.js` with `basis`
  (LEGAL_OBLIGATION or RETENTION_POLICY) and `retention: {class, layer, years|days, from, replacedBySetting}`, plus
  `instrument`/`provision` only where the retention answer words the source differently from the record. Existing records
  gained the attribute (IN-MTP-REG5-FORMIII, IN-DCR-XIIB-L, IN-CERTIN-2022-IV, IN-DPDP-R6-LOGS); new ones: IN-IMC-1-3-1,
  IN-DGHS-OM-2014-IPD/OPD/MLC, IN-WSQ-OPD-DEFAULT, IN-PCPNDT-R9-6, IN-NDPS-R52X, IN-DCR-R65-3-1-H, IN-DCR-R65-7, IN-ART-S23,
  IN-SURROGACY-S46-1, IN-RET-CONSENT-ARTEFACTS, IN-RET-MINOR-AFTER-18. The hospital's own setting layer stays in retention.js
  (hospital configuration, not a requirement).
- Whether a layer keeps anything today is `enforcement()` on the IST day: STAYED, STRUCK_DOWN, not yet effective or expired
  keep nothing. legalFloorYears and policyOnly count only LEGAL layers whose registry status is enforced. The setting
  floors (floorYears/defaultYears) are unchanged, so a class whose only law is stayed keeps its period as policy.
- Answers are byte-identical except: CERT-In logs' layer source type now reads "Notification" (the registry's type) instead
  of "Direction under an Act"; registry records gained notes/evidence carried over from the layers (evidence not re-read is
  marked not verified).

## 2026-09-17 Patient, payer, insurer, TPA and GST recipient kept apart; the recipient decided per payer contract (branch gst-parties)
Owner's binding legal guidance item 6 (s.2(93) CGST Act; TTK Healthcare TPA; Karnataka HC, Healthcare Global Enterprises
Ltd, April 2026). Supersedes the `gst.recipientOfCashlessClaims` part of the gst-packages entry above.
- The payer master is the existing payer connector (Admin, Integrations, Payers; payer-connectors.js), not a new record:
  every payer, whatever its adapter, carries its CONTRACT in its versioned, audited settings (payer-contracts.js): payerKind
  (insurer, tpa, government_scheme, corporate, other), legalName, GSTIN and address, insurerRef (a TPA's principal), and
  gstRecipient (patient | contracting_party) with gstBasisType (ca_opinion | contract_clause), gstBasisRef, gstBasisDate.
  Choosing the contracting party is refused without the basis (an opinion needs its date) and, for a non-TPA, without
  valid recipient details. payerKind is not required on save, so legacy connectors keep working; they resolve as "kind not
  recorded" with a warning.
- Resolution (pure, resolveParties): no payer = self-pay, the patient. Insurer or TPA with no determination: the patient,
  source default_cashless. Scheme, corporate, other or kind not recorded with no determination: NOT DETERMINED, treated as
  the patient, warning on every screen. A TPA's contracting party is the insurer it acts for (never the TPA); an unknown
  insurer is a warning, never a guess. The retired global value is read only when saved as "payer" (it needed a CA opinion)
  and only for contracts with no determination (source legacy_global, basis the global opinion); a saved "patient" is the
  old default and is not a determination. The setting can no longer be set; a save keeps the saved value.
- Stays: new record `StayPayer` (one per inpatient stay, versioned, billing.charge writes, billing.view reads, like Claim),
  POST /ward/stay-payer, read inside GET /ward/claims (stayPayers, null when unreadable). Claims and pre-authorisations
  keep their payerId and are shown with parties resolved from the contract NOW (they are not GST documents). An invoice
  COPIES the parties when raised (and via POST /ward/invoice-parties, which replaced /ward/invoice-buyer): the buyer on its
  GST documents is the resolved recipient, so Tax Invoice vs Bill of Supply, the BOS number and the IRN follow the
  recipient, never the payer. A contracting-party recipient with incomplete GST details refuses the bill. The manual
  buyer entry (typing a GSTIN on a bill) is gone: a buyer that is not a payer contract is not offered.

## 2026-09-17 Infection control, antimicrobial stewardship data and quality registers (branch infection-ams-quality, P5)
Gaps 4, 5 and 11 of the 2026-09-17 commercial gap audit. NABH KPIs 5, 11, 13-18, 25-27, 31 and 32 now compute; the rest
of compliance.js is untouched.
- HAI definitions are CDC/NHSN (Patient Safety Component Manual, January 2026, ch.4, 6, 7, 9), because NABH PSQ 3a-3b
  says "as per the latest CDC/NHSN definition" and the ICMR HAI surveillance network uses the same. New record `HaiCase`,
  written only by a new capability `infection.control` (new role `infection_control`; admin holds it). A case is opened
  under review, then confirmed naming the NHSN criterion met, ruled out or withdrawn, each a version. Nothing computes a
  diagnosis. The server computes and stores only the NHSN timing arithmetic (device day > 2 and in place on the date of
  event or the day before; SSI within 30 or 90 days); a case the arithmetic calls ineligible can still be confirmed with
  a written reason, because the line log may be late. The criterion names are unapproved seed content ("hai-criteria" in
  seed-signoff.js). The existing incident-based "hai" measure in quality.js is left as it was.
- Device-days: the existing LineRecord gained an optional closed `deviceClass` (central-line, urinary-catheter,
  ventilator); counted as NHSN counts the denominator (one per patient per calendar day present, insertion and removal
  days included). The Lines card now shows on every non-ED chart, not only NICU. Ventilator days are read from lines, not
  from IcuRecord ventilator settings, because settings are snapshots with no start and stop. The brief's "DeviceLine"
  record was not added: LineRecord already is one (followed the code).
- Surgical prophylaxis (#18): `SurgicalProphylaxis` review per theatre case by infection control. Doses are listed
  antibiotics (the existing `antibiotics` setting) from the eMAR and the anaesthesia record; on time within the new
  hospital setting `prophylaxisWindowMinutes`; the reviewer says whether prophylaxis was indicated and the agent matches
  policy, and "appropriate" is derived per the NABH remark. An unreviewed case is not counted as appropriate.
- Microbiology was already structured (pathology-report.js), and days of therapy already existed (quality.js); both are
  reused, not rebuilt. The cumulative antibiogram follows CLSI M39: final results, first isolate per species per patient per
  period, %S without I, and a hospital minimum (`antibiogramMinIsolates`, no default; M39 recommends 30) below which no
  percentage is shown. No MIC interpretation (breakpoint licensing is an owner question).
- Quality registers (quality-registers.js): hospital-authored audit checklists (`QualityAuditTemplate`, `QualityAudit`, one
  audit per observed unit, compliant when no item is "no", a copy of the item text kept), `MockDrill` with its variations,
  `EmergencyStockOut` against the hospital's `emergencyMedicines` list, `AdverseDrugReaction` on the PvPI form v1.3
  (filed with incident.report, causality not recorded here), `EdReturnReview` where a prescriber says whether a return
  within 72 hours of leaving was a similar complaint. New capability `quality.audit` (safety_officer, infection_control).
- Screen: wardsynq/site/pages/quality.js "Infection control and quality", tabs by capability. The brief named
  pages/governance.js; a separate page was used because governance.js is the DPO's and the analytics page and the ward's
  own staff (ADR, stock-outs, returns) needed a door that does not open privacy administration.
## 2026-09-17 Discharge milestones, inbound transfer centre, governed forecasts (branch discharge-capacity, audit P2 gaps 3, 6, 7)
- Discharge relay: new record `DischargeMilestone`, one per stay (functions/_wardsynq/discharge-milestones.js). Steps and who
  records each, chosen per step at the router (DISCHARGE_STEP_CAPS, the route entry is emr.treat for an unknown step):
  advised emr.treat, pharmacy-cleared order.verify, bill-ready and TPA final requested/received billing.charge, left
  queue.add. summary-signed is derived from the first signed version of the discharge summary; left falls back to the
  stay's closing time and says so. A step out of order (before advised, after left, TPA answer before request) is refused
  without a reason; changing a recorded time is a new version with a reason and the version read. Grants: a separate
  DISCHARGE union in actor.js (queue.add, order.verify, billing.charge write; billing.view reads) rather than editing the
  billing branch, to keep the P1 merge to one test line.
- NABH KPI 24 computes from them: advised to left, less minutes the patient asked to stay, day care excluded, only stays
  with recorded advice. GET /ward/discharge-progress (queue.view; record grant decides) shows in-progress stays and median
  turnaround per step with "not recorded" counts. Screens: ward.js Discharge progress (dcboard), chart button Discharge
  advised, command center links, shell tile.
- Transfer centre: new record `TransferCentreRequest` (transfer-centre.js). A phone call makes NO patient record; accepting
  needs the MRN of a patient registered through ordinary registration (duplicate checks live there) and a sex/age mismatch
  with the call needs explicit confirmation. Accepting calls admission-request.js requestAdmission() with requestedAt = the
  call time (retry-safe) and never touches a bed. Beds by state per ward and the waiting count are copied onto the request at
  decision; time to decision is computed. Caps: record and withdraw queue.add, decide emr.treat, list emr.view.
- Forecasts (twin-predict.js): the audit said 5 of 7 unwired; the code already had 6 of 8 wired. Wired blood-demand (units
  requested per day from the transfusion ledger). ot-delays stays unwired: a case stores its booking time as its start when
  none was given, so a delay cannot be told apart. Fixed the counting predictors: days with no event now count as zero (the
  mean over busy days only overstated every rate), today (incomplete) is left out, and critical-backlog with no loops is a
  refusal instead of a forecast of zero. Every envelope now carries `method` and `inputs` (the daily counts), shown on the
  twin's Forecast card. Still a plain mean, no model, no clinical score.
## 2026-09-17 Claims checklist blocks submission, override with a reason; claims desk worklists (branch rcm-claims-ops)
- Audit gaps 1, 2, 13, 14 (functions/_wardsynq/claims-ops.js). `scrubClaim()` is pure and ships no rule content: the
  checklist is settings on each payer contract (claimDocuments, queryResponseDays, requireSignedDischargeSummary,
  requireIcd10Codes, plus the existing preauthRequiredAbove) and the claim documents of the stay's package. A BLOCKING
  finding refuses POST /ward/claim-state submit/resubmit (422 claim_checklist_blocked); `overrideReason` sends it anyway and
  the claim keeps checklistOverrides {who, when, reason, findings}. CHANGE: preauthRequiredAbove used to be a warning only;
  it now blocks (still never blocks care). Timely filing stays a warning.
- A fact the actor's grant cannot read (a cashier cannot read ClinicalNote or, on billing.view, Condition/Encounter) is
  UNCHECKED, and blocks where a payer rule needs it. No grant was widened; no new resource type. Documents "obtained" are a
  person's attestation on the claim, not a document-store lookup (billing cannot read DocumentReference).
- Payer queries and enhancements live INSIDE the Claim / PreAuthorisation record (payerQueries, enhancements), one atomic
  versioned write, so a query can never exist without its claim state. A query moves a submitted claim to queried; the
  resubmission answers the open queries. Pre-authorisations gain validUntil (approved only); a claim whose only approval
  ran out before the admission date blocks.
- Denial reasons and ageing bands are org config `wardsynq.rcm` (POST /org/rcm-settings, staff.admin, reason required),
  no defaults. The classification copies the label onto the claim so editing the list never rewrites history.
- Desk lists (GET /ward/rcm-worklists, billing.view): tenant-wide svc.list capped at 2000 per type and said when capped;
  each list null with its reason when unreadable. Patients are named by the MRN carried in `opd-pat-<mrn>` (billing cannot
  read Patient). AR ageing is over live invoices' balances by the payer copied onto the bill; it reconciles to the sum of
  balances (credit held apart).
- Evidence pack (GET/POST /ward/claim-evidence): deterministic, from records only, no AI; saved versions on the claim with
  expectedVersion. No NABH KPI entry is owned by this package, so compliance.js is untouched.

## 2026-09-17 Nurse staffing against census and dependency, draft roster, staff injury report (branch nursing-staffing, P4)

- Nurses required per ward per shift (functions/_wardsynq/nurse-staffing.js) are arithmetic on the hospital's own numbers,
  shown line by line: patients at each dependency level divided by the hospital's patients-per-nurse for that level, unit
  type and shift, summed and rounded up once. WardSynQ ships no ratio. No Indian Nursing Council or NABH figure is cited or
  shipped: the norms are `wardsynq.staffing` (`dependencyToolId`, `wardTypes`, `norms`), entered by staff.admin on the Staff
  rota screen through `/org/staffing-norms`, checked against the hospital's own risk tools and rota shifts.
- Dependency levels are the bands of a hospital-supplied risk tool (risk-assessment.js, existing RiskAssessment records).
  A level counts for a shift when assessed during it, or within the tool's reassessment interval before it. A patient with
  none is listed as missing and the requirement becomes a lower bound: "short" or "not complete", never "met". A ward with
  no unit type or norm is "not configured", never staffed. A hospital with no tool can count every patient alike (band *).
- The in-charge (NABH PSQ 3c #21 remark) is marked on the rota assignment (`inCharge`, one per shift and date) and left out
  of rostered and on-duty counts. There is no nurse-in-charge role; a per-assignment flag is what the rota already can hold.
- The census is the bed board (migrate-inpatient.js bedBoard), so the two screens cannot disagree. Running shifts use it
  live; coming shifts are a projection from it with latest dependency levels, said as such; ended shifts show only what was
  recorded while they ran.
- Draft roster: GET /ward/staffing-draft suggests nurses for the coming 7 days' shortfalls, never on approved leave, never
  double-booked, never in charge; nothing is written. POST /roster/draft-publish (staff.admin) checks every entry again,
  all or nothing.
- Staff data is not the chart: the recorded shift staffing (NABH #21) and the staff injury report (NABH #30) are
  `_wardsynq_staffing_shift` and `_wardsynq_staff_injury` in the append-only store, the hr-attendance.js pattern, not
  RecordService types (which every emr.view role can read through the raw record door). compliance.js reads them through a
  reader the router passes in. The brief named clinical-settings.js and pages/admin.js for the settings; they went to their
  own route and the rota page, the gst-settings pattern, because the norms are nested and belong beside the shifts.
- #30 is the month's own rate over average occupied beds (inpatient bed-days / days elapsed); NABH asks for year to date,
  said in the indicator note.

## 2026-09-17 Theatre sessions, theatre times and outpatient access times (branch theatre-opd-access, P3)

- Theatre sessions (`TheatreSession`, theatre.js): a block of a configured theatre's time held for a unit or a surgeon.
  While held, a theatre booking by another owner is refused (`session_held`, resource-booking.js asks `heldSessionFor`).
  Release is computed, never stored as a state: a person releases with a reason, or the hospital's
  `wardsynq.theatre.releaseHours` releases it that many hours before the start. No rule configured means no automatic
  release. Written under queue.add, the same authority as booking the theatre.
- Case timing lives on the existing `SurgicalCase`, not a new record (followed the code): scheduled start and planned
  minutes at booking (optional; a case booked with no time has none, the booking moment is not used), in-room and
  out-of-room times recorded by a person (a change needs a reason and keeps the old value), reschedules (postponed or
  cancelled before incision, reason code from `theatre.rescheduleReasons` when the hospital set any), and the surgeon's
  unplanned-return answer after an incision. All under emr.treat, like every other case write.
- Utilisation (GET /ward/theatre-utilisation): booked minutes (ResourceBooking inside sessions) and used minutes
  (in-room to out-of-room) over session minutes, with the minutes returned beside each percentage. A case missing a time
  is listed and adds nothing. First case on time needs `theatre.firstCaseGraceMinutes`; without it lateness is shown and
  not judged. Turnover is out-of-room to next in-room, same theatre, same local day.
- NABH #19 counts cases first planned in the month that were cancelled before surgery, or postponed to (or entered the
  theatre) more than 4 hours after the first booked time (the NABH definition, not a hospital setting). #6 counts
  surgeon-flagged returns over cases incised in the month, unanswered cases shown beside.
- Appointments already had arrived, completed and did-not-attend (the audit said only booked/cancelled; the code differs).
  Added: a no-show is refused before the slot starts and after an arrival; `arrivedAt` and `completedAt` are kept.
- OPD waits (#22): the OPD Encounter written from the queue ticket now also carries `consultStartAt`, so the wait survives
  the ticket's expiry. Clock starts at arrival, or at the appointment time when later (the one same-patient same-day
  appointment marked arrived or completed; with two or more none is used). Seen before the appointment is zero. Fixed on the
  way: a ticket's 0 (time not reached) was read as the year 2000 by migrate-encounter.js toIso.
- Diagnostic waits (#23): new `DiagnosticVisit` written at the counter (queue.add): requisition presented, optional
  appointment, test start. Only outpatient visits count. The laboratory role alone (no queue.add) cannot write it; a
  counter needs a desk role. Screens: surgery board "Theatre sessions and use", the case's Theatre times card, and
  Scheduling's Waiting times card with the diagnostics counter.
## 2026-09-17 Staff messaging inside WardSynQ, one in-basket, MaiK drafting tasks (branch inbasket-messaging)
- Audit gaps 12 and 15. Staff messages are records (functions/_wardsynq/staff-messaging.js): `StaffMessage` (one message,
  bound to a patient and optionally the stay, or to a unit; a reply inherits the thread's binding and addressees) and
  `StaffMessageRead` (one per thread and reader, a version per read). Edit and recall are new versions; the earlier text is
  in the history, a recalled text is hidden on the list. Addressed by role, not person: no staff directory is exposed.
- Who may see a patient thread: every read and write first reads the Patient as the caller (audited). DEVIATION from the
  audit's "grant to that patient": this codebase grants patient access per record type per role; there is no per-patient
  care-team rule, so the Patient read is the gate. Grant: every EMR_VIEW holder reads and writes the two types (a READ-tier
  role is raised to DRAFT for them only). `StaffMessage` is HUMAN_ORIGINATED: no AI, service or device actor may send one.
- Nothing leaves WardSynQ: no SMS, WhatsApp or email path. Escalation is `pushToIdentities` (alert-deps.js, shared with
  alertAdmins) with a fixed payload (no name, MRN, ward, bed, thread id or text), only when alerts.push.enabled, to members
  of the addressed roles who have not read the thread; the attempt is recorded on the message; never "delivered".
  Ceiling: the inbox reads the newest 500 messages and read marks and says when it is partial.
- MaiK drafts (maik-interaction.js DRAFTS): draft-discharge-summary, draft-portal-reply, draft-appeal-letter, each the
  gateway's existing DRAFT_NOTE task, so the PHI approval and refusals are unchanged; DEVIATION: no new gateway TASK values
  (the COPILOT pattern). The subject (patient message, latest denied or queried claim's evidence pack) is read as the
  clinician and fenced as a record document. Accepting any of them writes nothing; a person sends the reply (Patient
  portal page records accepted or edited first, and does not send if that fails), signs the summary, or saves the letter
  into the evidence pack. Hard Local: no fallback exists in the gateway; a spy test pins that a Local-routed draft whose
  model is down never reaches Vertex/Gemini. The appeal letter is drafted by a clinician (maik-ask is emr.view and reads
  the chart); a billing-only role cannot run it.
- Unified in-basket is a screen (pages/inbasket.js) over the existing routes (patient-messages, referral-inbox,
  cosign-queue, safety-inbox), each shown loading, failed, not for this role, or its items with age and owner. No new
  aggregation route. No NABH KPI entry is owned by this package; compliance.js untouched.
## 2026-09-17 NABH KPI closure: indicators 3, 6, 21 and 30 (branch nabh-kpi-closure, R2-1)
- KPI 3: audit kind `diagnostic-safety` (quality-registers.js). One audit is one member of staff; it records the department
  (laboratory or radiology, closed list) and the auditor's own statement that they work outside it. NABH wants an outside
  auditor; members carry no department, so it is not enforced and the cell counts audits by an inside auditor beside.
- KPI 6: DEVIATION from the audit, which said AnesthesiaRecord carries a technique. It does not (startAnesthesia writes
  none; only an imported summary line reads one). The recorded technique is the PLANNED one on PreAnaestheticCheckup
  (PAC_TECHNIQUE closed list). Only `local-with-monitoring` counts as local anaesthesia; spinal, epidural and regional
  blocks do not. Cases with no checkup stay in the counts and are counted beside. A checkup type that cannot be read makes
  the indicator not computable rather than guessing.
- KPI 21: the hospital lists which unit types are ICUs (`wardsynq.staffing.icuUnitTypes`, validated against wardTypes).
  Recording an ICU shift also stores the split: a patient is ventilated when a LineRecord with deviceClass ventilator is in
  place at recording; nurses are the distinct on-duty nurses (in-charge already out) whose NurseAssignment names them; a
  patient with no assignment, or assigned to someone not on duty, is counted as unassigned beside. A nurse on both groups
  counts in both (shared count stored). A failed read stores "not recorded" and the overall ratio is unchanged. Verified:
  the assignment is readable at recording time through the recorder's own RecordService (EMR_VIEW reads all types).
- KPI 30: `wardsynq.staffing.reportingYearStartMonth` (1-12), saved on its own route POST /org/reporting-year, staff.admin,
  reason required, audit row names from/to; no default. Saving the norms keeps it. Year to date = injuries from the
  reporting year's first month to the month's end over the average occupied beds of that span. Unset: the month's own
  rate, flagged `reportingYearNotConfigured`. Kept inside `staffing` so _opd_org.js's whitelist is untouched.
- compliance.js: besides entries 3, 6, 21 and 30, computeNabhIndicators passes `settings` as a third compute argument and
  nabhIndicators reads staff injuries from the earliest window's reporting-year start (both needed by KPI 30 only).
- GET /ward/access-times now refuses (403) a role that can read neither Encounter nor DiagnosticVisit; it returned an empty
  200 to a store keeper. A cashier still reads it: billing grants read Encounter.

## 2026-09-17 Supplier returns, vendor rate contracts, reorder drafts from recorded use (branch supply-chain-depth, R2-4)

- Supplier return is a StockMovement kind `supplier-return` (stock.js returnToSupplier), written only against the receipt
  it came in on: the receipt and every earlier return naming it are read, and more than the receipt brought is refused
  with the numbers. recordMovement refuses the kind from any other door (stock-move). Supplier is the receipt's
  receivedFrom, else its purchase order's vendor, else typed. A GST debit or credit note number is kept when given;
  nothing is computed (purchasing.js has no purchase-side GST model). Ceiling: two concurrent returns against one receipt
  are not serialised; the level would show any excess.
- Controlled drugs: controlled or not is the drug master applied to the receipt's own item (route passes isControlled).
  A controlled return needs the witness (hospital policy, registers.ndps.requireWitness) and the Controller of Drugs
  approval reference, the same rule as a controlled transfer out to another institution (NDPS r.52V(3)). The register
  book (controlled-drugs.js registerBook) counts it as a disbursement in `wasted`, as transfer-out already was, so the
  Form 3H day still closes, and names it separately as `returnedToSupplier`. Quarantine rows are closed by hand in
  Registers as before.
- Rate contracts live on the existing Vendor record (rateContracts[]), one version per change, no new resource type or
  grant. DEVIATION from "versioned per contract": the version is the vendor's. Overlapping contracts for one item and unit
  are refused; changing a recorded contract needs a reason. Prices are paise before GST, compared only in the same unit.
  GET ward/approvals attaches the check to pending PurchaseOrder approvals (in date on the order's raisedAt); a check
  that failed is shown as failed. ward.js approvalRow shows it (the one ward.js change).
- Reorder drafts (purchasing.js reorderSuggestionsFrom): use is dispenses (not returned), transfer-out and consumption out
  of that store in the window; wastage, adjustments and supplier returns are not use. Suggested = ceil(avg daily use x
  (lead + safety days) - level - outstanding on open, part-received or awaiting-approval orders). Orders carry no store,
  so the outstanding quantity counts against each store holding the item (said on screen). Refused per row: fewer days of
  data than the minimum, no use in the window, negative level. The whole read is refused past 1000 movements/dispenses.
  A store keeper (no order.dispense) reads no dispenses and sees general stores items only.
- Settings `wardsynq.reorderPolicy` {windowDays, leadTimeDays, safetyDays, minDataDays}, all or none, no default, on
  /org/reorder-policy (staff.admin, reason required, audited). Screens: General stores page cards (order.dispense or
  stores.manage; settings card for staff.admin). Routes: GET ward/supply-chain, POST ward/supplier-return, POST
  ward/rate-contract, GET ward/reorder-suggestions (order.dispense, stores.manage fallback).

## 2026-09-17 Staff messages to named people; patient education leaflets (branch messaging-people-and-education, R2-3)
- B9. `toPeople` on staff-message-send alongside `toRoles`. Each named identity must be an active member of THIS hospital
  (ORG.listMembers of the route's org, so another hospital's member is "not_member") whose role holds emr.view and whose
  grant reads StaffMessage, and Patient for a patient thread; otherwise 422 people_refused naming each refused person,
  nothing written. Stored as {identity, label}; replies inherit. Picker: GET /ward/staff-message-people, label and role only.
  A thread addressed ONLY to named people is listed, opened, replied to, marked read and escalated only by its sender and
  the named people (403 not_addressed otherwise); the record itself is unchanged in the store. With a role address too,
  role visibility applies as before. Push goes to named people and role members who have not read; payload unchanged.
- B12. patient-education.js. `EducationLeaflet` (no patient): title, language code, body, tags, state draft/approved/
  retired, versions. Approval needs expectedVersion (the version read) and an approver who wrote none of the current
  draft (`draftedBy`); editing an approved leaflet makes it a draft again. `EducationAttachment` (one per stay, patient
  compartment): giving accepts only an approved leaflet at the version shown and COPIES that version's words, approver
  and time, so a later edit or retirement never changes what the patient was given; taking back is a new version with a
  reason. Both types HUMAN_ORIGINATED. Author, approve, retire, give, take back: emr.treat; read: emr.view.
- DEVIATIONS from the audit brief: the library screen is a card on the Patient portal page (portal-access.js), not a new
  page; giving and printing are on the discharge summary screen (discharge.js, which owns that print), through its own
  GET education-attachments, so migrate-discharge.js and ward.js are untouched. The portal shows given leaflets in a new
  grant section "education" without a PatientRecordRelease: the clinician's act of giving an approved hospital leaflet is
  the handover (a discharge summary is the clinician's clinical document and keeps its release rule). No retention class
  added. No leaflet content shipped (owner item O6).

## 2026-09-17 Ward times and claims desk: NABH KPI 1, theatre delays, desk period, technique given (branch ward-times-and-desk, R2-2)
- Audit's open point checked: bed placement stores no bed-arrival time. The admission Encounter's periodStart is when the
  admission was entered (or a time the desk stated) and a transfer's movedAt is when the bed changed on the record; both are
  clerical, and admitPatient/transferPatient rebuild the Encounter so a field bolted onto it would be lost on the next
  transfer. So the times live on a new per-stay record type `AdmissionTimes` (admission-times.js, service.js), the
  DischargeMilestone pattern: bedArrival recorded by the nurse (emr.vitals; type added to VITALS_TYPES, so the pinned write
  lists of nurse, intern, resident and pg_resident grew by one), initialAssessment marked by a doctor (emr.treat route).
- The assessment time is the marked note's signedAt, never typed. Only a signed, non-nursing note of the same stay can be
  marked; the first mark wins and a second is refused naming the note. DEVIATION from the brief's "negative intervals
  refused at write": following discharge-milestones.js, an out-of-order time is refused unless a reason is given; with a
  reason it is stored flagged and KPI 1 counts it beside, never averaged. A bed-arrival change needs expectedVersion and a
  reason. Routes: POST /ward/bed-arrival, POST /ward/initial-assessment, GET /ward/admission-times (emr.view).
- KPI 1 (compliance.js entry 1 only): admissions of the inpatient classes that started in the month (day care excluded),
  mean minutes over admissions with both times in order; missing each time and out of order counted beside.
- ot-delays wired (twin-predict.js): per case, minutes from `scheduledAt` (current plan) to `theatreTimes.inRoomAt`; one
  sample per UTC day that had a measured case (mean of that day), NOT zero-filled, unlike the counting predictors, since a
  day without cases has no delay. Cases without a scheduled start are excluded and counted. Envelope carries unit minutes
  and cases per day. Fewer than 2 days refuses insufficient_data.
- Anaesthesia technique given: `technique` on AnesthesiaRecord (the field migrate-inpatient.js's timeline label already read),
  optional at /ward/anesthesia-start and /ward/anesthesia-end from PAC_TECHNIQUE; a different one at the end keeps
  `techniqueChangedFrom` (conversion). KPI 6 (entry 6) now prefers it over the PAC plan and reads AnesthesiaRecord.
- Claims desk: from/to date inputs send the whole local days as ISO to the existing /ward/rcm-worklists parameters; the
  denial panel shows the period the server returned, or says all time.

## 2026-09-17 Legacy HIS import, first slice: patients, Price list, suppliers (branch legacy-import-first-slice, R2-5)
- Which price list: VERIFIED in the router. Both invoice paths price from wsqTariff(): with the clinic billing store on
  (CLINIC_BILLING_ENABLED) the Price list (BILL.listTariff, q_tariff) is the ONLY price table; the wardsynq.tariff config
  blob is used only by a deployment with no billing store and no screen shows it. Prices import into the Price list through
  validateTariff and BILL.upsertTariff (audited tariff_create per row). With the store off the import refuses
  (409 price_list_off) rather than write a table no bill or screen reads.
- One route, POST /ward/legacy-import, staff.admin, and ALSO the manual door's capability per kind (patients queue.add,
  prices staff.admin, suppliers stores.manage), so hr (staff.admin only) cannot register patients through an import.
- Dry run first, always (hr-attendance-import pattern). Commit re-runs the check and needs confirmCount AND planId (a hash
  of the rows it would create) to match; otherwise 409 with nothing written. First failure stops the run and says how many
  were saved; re-running the same file adds only what is missing (matched by legacy MRN identifier, Price list code or
  name + kind + ward, supplier id).
- Patients: DEVIATION from "patients through registration duplicate checks" only in that the import is stricter. Each row
  goes through validateRegistration, the same-mobile index (reported duplicate, never confirmDuplicate), with
  wardsynq.externalMrn an MR number already in use (duplicate, never overwritten), and the identity engine
  (findCandidates) agreeing on name AND date of birth over the newest 500 patients (stated on screen). Duplicates are not
  created and never merged; the merge stays a person's claim. Then PAT.registerPatient and registerPatientRecord. The
  legacy MRN is a `legacy-mrn` identifier on the Patient record (hospitalRef in the desk store when the hospital mints its
  own numbers); registerPatientRecord keeps an already-recorded legacy-mrn when the desk re-registers the patient.
- Price rows: DEVIATION from the brief's "taxable item without rate refused" as manual entry: the Price list screen accepts
  a row without a rate. The import refuses a medication or not-health-care row with no GST rate, because gstForLines lists
  it unconfigured and the bill is refused. Other kinds are exempt healthcare lines and pass without a rate.
- Suppliers: Vendor records via RecordService at `wsq-vendor-<slug>` (the id supply-chain-depth's rate contracts use), with
  name, gstin (format checked), phone, email, address, drugLicenceNo. MERGE NOTE for supply-chain-depth: its
  saveRateContract writes {resourceType, id, name, rateContracts} and would drop these fields on the next version; it
  should spread the current record.
- Not imported (owner and accountant, audit O4): open stays, balances, deposits, GST documents. No Aadhaar field exists;
  a 12-digit Aadhaar-shaped value in name or address refuses the row and is masked in the mapping sample.
- ponytail ceilings: 100 patients / 500 prices / 500 suppliers per run (Worker request budget); a Price list or supplier
  list of 500 or more cannot rule out a match and refuses the commit.

## 2026-09-17 Scale ceilings: whole Price list, station queues by status, imports in runs, orders name a store (branch scale-ceilings, R3-1)

- Firestore filters: several EQUALITY filters in one runQuery (compositeFilter AND) are served by merging the automatic
  single-field indexes; no composite index is added (Firestore "Index overview": compound equality queries run on
  single-field indexes). Ordering stays on __name__ only, which needs no index. `fsQuery` opts.where now takes one
  `{field, value}` or an array. firestore.indexes.json has no exemption for q_orders or q_tariff fields.
- Paging lives in `_clinic_billing_store.js` (`readAll`, pages of 500 by document name) rather than a new
  `_fbfirestore.js` export, because 119 test files mock that module's named exports.
- Price list (`listTariff`): every page; past 20,000 rows it THROWS, so wsqTariff and the catalogue say "could not be
  read" instead of billing the rest as "no price set". A partial Price list is never returned.
- Station queues (`billingQueue` by orgId+status ordered; `pharmacyQueue` by orgId+status paid+kind medication): every
  page up to 5,000, then `truncated: true` and the cap, shown on /clinic-billing ("Showing the first N only"). The JS
  state filter stays. `ordersForPatient` also pages (it stopped at 200) and throws past 5,000.
  DEVIATION: /clinic-billing is the untranslated StewardMD station page (no i18n catalog), so its note is English like
  the rest of that page.
- Legacy import: the Price list is read whole and suppliers are looked up by id (`RecordService.histories`), so the
  "500 or more refuses the commit" ceiling and `store_too_large_to_check` are gone. Per-run row caps stay (Worker
  budget); a larger file is sent whole with `run {from,to}` and the Import screen runs it part by part (dry runs, one
  merged report, commits run by run with each run's planId; a stop names what was imported and a new dry run adds only
  what is missing). Repeats are checked across the whole file. The name + date of birth pool stays 500 (no name/DOB
  index exists; identifiers only), and is now actually the NEWEST 500 as the screen said (`RecordService.list` opts.newest;
  it was oldest first).
- Purchase orders: optional `location` (free text, as a receipt's location is; not validated against StoreLocation
  because pharmacy locations are free text). An indent back-order is raised for the indent's central store. Reorder
  drafts count outstanding only against the order's store; an order naming no store keeps counting against every store
  holding the item and is marked (`onOrderNoStore`).
- Not changed: `revenueToday` still reads the newest 1,000 invoices of the org (dashboard tile, not a bill).

## 2026-09-17 Formulary screen: editor and CSV load through one checked door (branch formulary-screen, R3-2)
- Routes: GET/POST /org/formulary (editor, whole list) and POST /org/formulary-import (CSV: map, then dry run with an
  explicit mode merge or replace). Both dry run first with a row-by-row report; a commit needs a reason, confirmCount equal
  to the dry run's change count and its planId (which covers the list as it stood), and any problem refuses the whole save.
- /org/update refuses wardsynq.formulary and requireReasonOffFormulary (422 use_formulary_route). A group recommendation
  carrying a formulary is checked when set and again on adoption.
- Capability: no pharmacy or formulary capability exists (verified in _queue_roles.js). Chosen: staff.admin AND
  order.verify, which is the admin role and the owner; hr (staff.admin only) and pharmacy (order.verify only) get 403.
  A pharmacist who should edit the formulary needs the admin role until a formulary.manage capability is decided.
- Retire: an entry with retired:true stays stored and matches no order (formulary.js resolveFormulary skips it);
  controlled-drugs.js still reads its controlled flag.
- Audit: one org chain row (org:formulary) in the same commit as the change, naming added (+), changed (~) and removed (-)
  entries by drug or code with counts, reason and plan id. ponytail: the chain keeps 200 characters of meta, so a large
  load names its first entries and counts the rest.
- ponytail ceilings: 3000 entries (the list lives in the org document, 1 MiB shared with every setting); a 2 MB CSV.
- No formulary content ships.

## 2026-09-17 Dialysis unit: stations, haemodialysis sessions, dialyzer reuse, URR (branch dialysis-unit, R3-4)

- functions/_wardsynq/dialysis.js; screen wardsynq/site/pages/dialysis.js (home map, Clinical, "Dialysis unit").
- Settings `wardsynq.dialysis` {stations[{id,name,serologyGroup}], serologyGroups[], maxReuses}, no default for any (owner
  O13). GET/POST /org/dialysis-settings, staff.admin, reason required, audit names what changed; validated on save and on
  every read. Unset serology groups = no segregation check, and the booking says "not-configured". Unset maximum = a reuse
  cannot be recorded. When groups are set every station must name one; a patient with no recorded group is refused.
- DEVIATION from the brief ("stations are hospital resources"): stations live in the dialysis settings, not in
  `wardsynq.resources`, because that list has no screen. They are still booked through resource-booking.js bookResource
  (same clash refusal), as resource ids `dialysis-<id>`; the generic /ward/book-resource does not know them, so the
  serology check cannot be bypassed. resource-booking.js unchanged. Stations do not show on the Scheduling screen.
- Records (emr.vitals write scope, VITALS_TYPES): DialysisSession (versioned; fields not sent keep their value),
  DialyzerEvent (first-use / reuse / discard with reason), DialysisSerology (group from the unit's list, test date).
  Routes: GET /ward/dialysis-unit and /ward/dialysis-patient (emr.view); POST /ward/dialysis-session, /ward/dialyzer-event,
  /ward/dialysis-serology, /ward/dialysis-book (emr.vitals). Cashier 403.
- Post weight above pre with achieved UF > 0 is refused until the nurse gives a reason. Anticoagulation stays in orders and
  eMAR. Urea is a linked laboratory Observation of the same patient or a value with unit and source.
- URR = (pre - post) / pre x 100, one decimal, computed on read with inputs shown; missing input, different units or a
  non-positive pre urea is "not computable", never 0. Citation: Lowrie and Lew, Am J Kidney Dis 1990;15(5):458-82; NKF KDOQI
  haemodialysis adequacy 2015 update, Am J Kidney Dis 2015;66(5):884-930 (both checked on PubMed). Kt/V not built (owner O12).
- ponytail ceilings: reads cap at 1000 records per type with a truncation warning; serology group "tag" is exact string
  match; a station needs a group whenever groups are set (no untagged general station).

## 2026-09-17 Cashless desk: stays whose pre-authorisation needs action (branch cashless-desk, R3-5)
- Separate route GET /ward/cashless-stays (billing.view), not a seventh list inside /ward/rcm-worklists: it runs charge
  capture per stay, and the claims desk must stay readable when that fails. ward.js loads both into the Claims desk.
- A stay is listed when it is open (in-progress, an admission class), its StayPayer names a payer whose contract kind is
  insurer, TPA or government scheme (a payer not in the list or with no kind recorded stays on and says so; corporate and
  other are off), and one of: no pre-authorisation, requested (hours since recorded), refused, expired (state, or
  validUntil before today on the hospital's clock), validUntil before the ExpectedDischarge date, approved amount not
  recorded, approved amount below the running bill, the bill or discharge date unreadable, or an open payer query.
- DEVIATION from the brief ("expected discharge date (DischargeMilestone if recorded)"): DischargeMilestone has no expected
  date; the treating team's date is the ExpectedDischarge record. billing.view and billing.charge now READ ExpectedDischarge
  (actor.js DISCHARGE block; test/wardsynq-record-service pinned). No write widened.
- Which pre-authorisation: PreAuthorisation carries no encounterId. The one the stay's active package links wins; else the
  newest by decidedAt of the patient's for this payer (or the insurer a TPA acts for, or none named) recorded after the
  patient's previous stay ended. ponytail: two separately authorised treatments on one stay show the newer only.
- Running bill: charged total of live bills raised for the stay; with none, the charge-capture total now (stated as not yet
  billed, with the count of unpriced items). Unreadable anything is said, never zero. Capture runs for 50 stays per load.
- Nothing is sent to a payer.

## 2026-09-17 Pre-admission intake on the portal (branch pre-admission-intake, R3-3)

- A form definition may say `audience: "patient"` (wardsynq-forms.js). Absent means staff. A patient form cannot name
  staff roles. WardSynQ ships no questions: the hospital writes the form in Admin > Forms (JSON) and publishes it.
- Portal routes POST /api/portal/intake-forms and /api/portal/intake-submit: session first, patient from the grant, new
  grant section `forms` (a proxy needs it granted). Forms are listed and accepted only while the patient holds a waiting
  AdmissionRequest with `plannedFor`; the submit names the request, checked to be the session patient's. A staff form
  is refused 403 `not_for_patients`.
- Stored as FormResponse `wsq-intake-<formKey>-<requestId>` with `origin: "patient"` and `reviewState`
  submitted/accepted/returned. DEVIATION from the brief's `source: "patient"`: `source` on a record is its provenance
  system; AppointmentRequest already marks a patient's own request with `origin: "patient"`. No terminology codes are
  attached to patient answers. A resubmit is a new version until accepted; returned reopens it.
- Staff: GET /ward/intake-responses (emr.view), POST /ward/intake-review (emr.treat, accept or return with a reason,
  must name the version read). Accepting writes that FormResponse only; nothing goes into allergies, medicines or
  problems. pathways.js never counts a patient-origin FormResponse as an assessment step, even once accepted.
- Screen: ward.js bed waiting list (planned date input on "Ask for a bed"; "Pre-admission forms" on a planned row).
- Privacy: portal access for a child is already gated at enrolment (DPDP r.10 via privacy-law.js childGate); intake is
  for the patient's own care, so no second gate. The section points to the hospital's privacy notice on the same page.
  Nothing leaves WardSynQ.
- Not built: offering forms for a booked appointment (the brief's optional hospital setting); no setting exists, so it
  behaves as off. Staff form-submit still accepts a patient-audience form as a staff-completed response.

## 2026-09-17 Shared Firestore stores read every page with a ceiling (branch shared-store-caps, R4-3)

- `readAll` moved from `_clinic_billing_store.js` to `functions/_fs_read_all.js` (re-exported by billing), plus
  `readAllOrThrow` (507 past the ceiling). A new module rather than an import of billing: billing imports the queue
  engine, and the org, queue and accounts stores need the helper too.
- Read whole, throwing past the ceiling (never a partial list): beds (10,000), wards, rooms, departments (5,000 each,
  also the queue engine's token department read), queue tickets per session, ABDM share tickets, staff mappings,
  sessions (5,000), a patient's tickets for the ABDM link OTP mobile, chart of accounts (5,000).
- `listSessions` asks by hospitalId AND date (it read the hospital's first 200 sessions ever and filtered by day).
- Events timeline: verified that `q_events` rows carry no session field (`_q_audit_chain.js eventFields`: ts,
  hospitalId, ticketId, actor, action, meta). Asked per ticket by hospitalId AND ticketId, 10 queries at a time. Not
  adding a session field: the chain row's field list is hashed and fixed.
- `revenueToday`: DEVIATION from the brief's "query paid invoices by orgId+status". Paid invoices grow forever, so that
  query would reach any ceiling and fail for good. `payInvoice` now stores `paidUtcDay`; the hospital's local day
  touches at most two UTC dates, each asked by orgId AND paidUtcDay, bounded by paidAt. Clock: `wardsynq.timeZone`
  (offset at now), else `utcOffsetMinutes`, else IST. Invoices paid before this deploy have no `paidUtcDay`, so only
  the deploy day's total can be short. A failed read shows "Could not be read" on the doctor app's Revenue today tile
  (queue.js is the untranslated StewardMD OPD app, not a WardSynQ screen) instead of the tile vanishing.
- Not changed: accounts `entriesFor` (SCAN 2,000 per period, already flags `partial`), StewardMD followcare and PG log.

## 2026-09-17 Clinical content editors: critical limits, delta limits, autoverify, MAR times, note templates (branch clinical-settings-editors, R4-4)
- Routes: GET/POST /org/clinical-settings/<setting> for criticalLimits, deltaLimits, autoVerify, marTimes, noteTemplates
  (functions/_wardsynq/clinical-content-settings.js). The formulary pattern: dry run item by item, any problem refuses the
  whole save, commit needs confirmCount, planId, a reason and signedOffBy, audited (org:clinical_content) and read back.
- DEVIATION from the brief: functions/_wardsynq/clinical-settings.js already exists (D11 A, /org/clinical-settings with no
  suffix), so the new module is clinical-content-settings.js; the suffixed route sits in front of the existing one.
- Sign-off: wardsynq.clinicalContentSignOff[setting] = { signedOffBy, reason, by, at, planId }, whitelisted in _opd_org.js,
  written only by this route and shown on the card.
- /org/update refuses the five keys and clinicalContentSignOff (422 use_clinical_settings_route). A group recommendation
  carrying any of them is checked when set and again on adoption.
- Capability: staff.admin AND lab.result (critical, delta, autoverify), order.verify (MAR times), emr.treat (note templates).
  No settings capability exists; today that is the admin role and the owner only.
- Checks are the consumers' own readings made strict: codes must be LAB_CODE_SEED codes (a local-name test cannot be
  configured here); critical limits need a unit and low below high; MAR times HH:MM, in order, and exactly the frequency's
  default count (the 1-0-1 notation takes TDS times by position); resolveTemplate problems refused.
- DEVIATION from the brief: "a delta limit without unit" is not checked because lab-delta.js limitFor has no unit field
  (the change is in the result's own unit and mismatched units are never compared); adding one would store a value nothing reads.
- Empty is "not configured" exactly as today; the draft starts from what is saved, never from a default. No clinical values ship.

## 2026-09-17 Open census by status and a paged whole-type read (branch census-by-status, R4-1)

- Problem: every roster read (`service.list`) was clamped to 1,000 records, oldest first, and silent. The ward list,
  nurse worklist, bed board, admission bed clash (200), transfer (200), patient flow, ICU occupancy, ED board, theatre
  list, downtime pack, waiting list and emergency reconciliation all read encounters that way, discharged stays and OPD
  visits included (OPD visits ARE Encounters, class OPD, via migrate-encounter.js).
- Port: new OPTIONAL `pageByType(tenantId, type, {afterSeq, limit, statuses})` -> `{records, next}`, oldest first by
  each id's latest seq, one page of at most 1,000. Memory and D1; the on-premise sqlite adapter is a binding into
  D1Repository, so it has it too. An id amended between pages is met again later; the reader keeps the later copy.
- Service: `listByStatus(type, statuses, max)` pages the open records only, ceiling `OPEN_CENSUS_MAX` 5,000, past it
  throws `ListCeilingError` code `too_many_open` (never a short census). `listAll(type, {max, throwOnTruncate})` pages
  every record, default 50,000, hard ceiling 100,000; past max returns `{rows (oldest max), truncated: true}` or throws
  `too_many_records`. Both govern and audit exactly as `list` (one record.list row). A store without pageByType refuses.
- Callers moved: the Encounter reads named above now use listByStatus("in-progress"); emergency reconciliation uses
  listAll (an override outlives the stay) and refuses past the ceiling. A census refusal answers 503 `too_many_open`,
  written 0: an admission or transfer is refused, not made on a short read. Ward and ED boards name patients from the
  newest 1,000 Patients plus a read by id for any missing (the oldest-first roster left new patients nameless).
- Checked, audit uncertainty: `checkMasterBed` reads the bed's administrative state only, not occupancy; occupancy is the
  census scan plus the bed claim. A stay without a claim (imported, migrated, moved by transfer) is seen by the scan only.
- ponytail: D1 re-groups every version of the type per page (same GROUP BY as latestByType). The open census is one
  page; a whole-type read is N/1,000 pages. A latest-version flag or table (audit O20) is the upgrade if that is slow.
- Left for R4-2: counting and summing callers (quality, security-review, analytics-extract, discharge-milestones,
  reports, fhir-group, hospital-group and the ledgers) still use list(); they move to listAll. Open OPD visits that never
  close count against the 5,000 open ceiling; reaching it is visible (503), not silent.

## 2026-09-17 Whole-type reads for reports, registers, ledgers and worklists (branch whole-type-reads, R4-2)

- Problem: after R4-1 about 150 callers still used `service.list(type, N)`, which serves the OLDEST min(N, 1,000) records.
  Callers asking for 2,000 or 5,000 compared against their own number, so `truncated` never fired; ledgers refused at
  1,000; worklists capped at 200 to 500 never showed a new item; warnings said "only the latest were read".
- Rule applied (per caller): a count, sum, ledger, clash check or worklist reads every record through `service.listAll`
  (ceiling 50,000 per module unless stated; Patient reads 100,000). Past the ceiling a ledger, clash check, worklist or
  refusal-bearing report throws `ListCeilingError` and answers 409 or 503 with nothing written; a read-only return or
  register reports `truncated` with "the newest were not read". Open things with a real `status` field read by status
  (`listByStatus`): results awaiting verification and cultures in progress (preliminary), ward dashboard open stays,
  doses in flight and active orders, HIM open stays, FHIR Group census, group counts. Snapshots of "now" (digital twin live
  sections, backup and restore evidence, MaiK interaction list, patient name pools) read the NEWEST N via
  `list(..., {newest: true})` and keep their capped flags. A patient's dialyzer events read by index (`byPatient`).
- Actor-less service reads (escalation timer, hospital group counts) page through `repository.js pagedLatest`. The
  escalation timer read the oldest 500 loops: past that no new critical result was escalated. `StagedRepository` now
  passes `pageByType` through with its staged records on the last page.
- Screens: the quality and governance page notes are new translated keys (`site.qual.truncated`,
  `site.gov.truncatedNewest`), replacing keys whose English said the oldest were missing. Server warning strings shown
  through EN() (stores, blood bank, dialysis, registers, mortuary) follow the existing pattern and were reworded. ward.js
  was not touched (R4-5): `ward.dc-truncated` and `ward.rcm-truncated` still say "latest"; they fire only past 50,000.
  Access times past the ceiling show "could not be read" on the ward screen (the read is refused, not shown short).
- Kept as bounded by nature: fleet vehicles, saved reports, privacy notice versions, feed source grants, outbound
  destinations, leaflet library, advisory sample, lab QC and analyser reads (newest first; Westgard needs recent points),
  FHIR search pool (stated in the bundle), legacy import name pool (newest).
- ponytail: every whole-type read re-groups all versions per page and holds up to 50,000 rows in a Worker. High-volume
  types (MedicationAdministration, DiagnosticReport, ServiceRequest, Appointment) reach the ceiling within weeks to months
  at a busy hospital and then refuse or flag visibly. The upgrade is audit O20 (a latest-version table) plus period or
  owner indexes (by clinician, by resource, by order); not built here.
- Not done: patient-flow.js order, MAR, request, problem and report reads (still the oldest 1,000, `.catch(() => [])`),
  digital-twin as-of reconstruction reads (500), Form 3E not exercised by a route test.

## 2026-09-17 Small closures: census refusal on screen, PO store, forms before an appointment (branch small-closures, R4-5)

- Census 503: ward.js turns any answer with error `too_many_open` into one translated sentence in the transport
  (apiGet/apiPost set message and detail), so every screen that already shows the server's message says the same
  thing. A failed ward list or downtime pack now says not loaded instead of "no patients" / "Preparing the pack".
  Twin sections keep a thrown error's code (digital-twin.js section); the waiting list reports `admittedCheckError`.
  The ICU card's `encounterReadCapped` check was dead after R4-1 and is removed; `recordsCapped` still warns.
- PO store: the audit said "StoreLocation names". The reorder drafts match an order's `location` against stock ledger
  locations (StockMovement.location), not StoreLocation records (stores.manage), so the form offers the stores the
  hospital's stock is held in (GET /ward/stock, same capability as the PO route); free text stays allowed.
- Appointment intake: setting `wardsynq.intake.forAppointments` (absent or anything but true = off) and a form flag
  `forAppointments: true` (patient forms only). A FormResponse carries `appointmentId` instead of `admissionRequestId`;
  review, origin and "never the chart" are unchanged. The portal UI is wardsynq/site/portal.js (the brief named
  portal.html). No settings screen: the flag is set through /org/update (admin settings screens belong to R4-4).

## 2026-09-17 Merge of whole-type-reads and small-closures, with two follow-ups (wardsynq-product)

- `ward.dc-truncated` and `ward.rcm-truncated` English now say the newest records were not read (R4-2 reads oldest-first
  pages up to a ceiling). Language files keep their older wording until retranslated.
- Appointment intake switch: GET/POST `/org/intake-settings` (staff.admin, reason required on a change, audited as
  `org:intake_settings`, read back), a card on Admin > Hospital under the clinical settings. `/org/update` now refuses
  `wardsynq.intake` (422 `use_intake_settings_route`). A dedicated route rather than a key on `/org/clinical-settings`:
  that route takes no reason and its read shape is asserted whole by existing tests.
- Site pages: shell.js's transport gives a 503 `too_many_open` the ward.js sentence (key `ward.too-many-open-stays`, shared
  catalog); the home ward and ED tiles, MaiK patient list, In-basket patient picker and the support diet and transport
  pickers show it before their own "could not be loaded" text (`WSQ.tooManyOpen(r)`).

## 2026-09-17 No silent empty clinical reads (branch no-silent-empty-clinical, R5-1)

- break-glass.js `openEmergencyChart`: a per-type read failure sets `chart[type] = null` and pushes the type onto
  `unreadableTypes` (the abdm-chart.js pattern), returned on GET /ward/emergency-chart. The break-glass screen names
  those parts above the chart. It used to be `chart[type] = []`, so an allergy list the store refused rendered exactly
  like "no known allergies" mid-emergency. The chart is NOT refused wholesale: the readable parts still arrive.
- migrate-inpatient.js prescribing advisories: the Observation and Condition reads lost their `.catch(() => [])` and
  the outer `catch { advisories = [] }` now sets `advisories = null` plus `advisoriesUnavailable {reason, detail}` on
  both the checkOnly and the written response. The prescribe screen shows that and no longer treats such an order as
  clean, so the review card is always seen. The order is still written: a hospital advisory is not the safety engine
  (that one already refuses on `safety.checked === false`), and losing a hospital's own reminder must not cost a
  patient their medicine. Advisories that DID fire are now rendered too; they were computed and never shown.
- patient-flow.js companion reads: MedicationOrder / MedicationAdministration / ServiceRequest move to `listByStatus`
  on the statuses `pendingItems()` selects (ORDER_OPEN / ADMIN_OPEN / SR_OPEN in that file). Condition cannot be
  status-scoped - it carries `clinicalStatus`, not `status`, and `pageByType` filters `body.status` - and
  DiagnosticReport cannot either, because a RELEASED report is what decides a request is done; both are `listAll`
  with `max: 50000`. Truncation of either makes `openItems: false` per stay, `dischargeCandidates: null` and
  `openItemsUnknown: [types]`, which the screen states. Doses are matched to a stay by patientId rather than by a
  join onto the (now active-only) orders.
- Two swallows found in the same files by the sweep: patient-flow's bed master read is `null` rather than `[]` on
  failure (`beds.states: null`, said on screen; a histogram of zeros reads as "no bed blocked, none in cleaning"),
  and bedBoard's ward master read sets `wardsUnread: true` rather than falling back silently to the configured list.
- Not done here: R5-3 owns the port, so a `clinicalStatus` predicate for Condition and a period-scoped read for
  DiagnosticReport are the real narrowings and are left to it. The ABDM chart screen already renders its
  `unreadableTypes` (ward.js abdmRecordsView) - it names no types, but it is not silent, so it was left alone.

## 2026-09-17 A month's report reads a month (branch period-scoped-reports, R5-3)

- Port: `pageByType` gains `newest: true` with a `beforeSeq` cursor (memory and D1; repository-sqlite.js is a binding
  over D1Repository, so it needed no change). The oldest-first cursor is untouched, so every existing caller is
  unaffected. Newest-first reverses the amendment rule: a record amended DURING the read moves ahead of a cursor
  already handed out and can be missed, so ledgers and counts that must balance stay on the oldest-first cursor.
- Service: `listSince(type, {stopWhen, max, throwOnTruncate})` walks back and stops at the first whole page whose
  records are all behind the window. Same grant check, same single audited list row and the same `{rows, truncated}`
  answer as `listAll`, oldest first - except that a truncated period read keeps the NEWEST records, because the end
  of the window is what the caller asked for.
- `read-window.js` holds the one clinical decision: which types may be read as a period. A record is judged behind the
  window by the LATEST instant anywhere in its body (its own times, and meta.recordedAt, which every canonical record
  carries); a record naming no instant is never judged behind. Types whose records can belong to a month they hold no
  timestamp in are read whole - an open stay, a line still in place, a booking or request for a later date, and the
  masters other records point at (SPANNING_TYPES). A 90-day lookback covers a child record dated just before its
  parent (a pre-anaesthetic check, the request behind a report).
- Moved: compliance.js (NABH and HMIS), infection-control.js (the measured types, not the case register),
  quality-registers.js (audits, drills, ADRs, ED reviews; not the templates and not an unrestored stock-out),
  access-times.js (the diagnostic counter), trends.js, quality.js. NOT registry.js: a chronic-disease registry needs
  each patient's LAST qualifying observation at any age, so a period read would turn "current" into "never". The audit
  named it; the code says otherwise.
- Honest limit, stated in repository-d1.js and in each module: the status and seq predicates sit OUTSIDE the derived
  `MAX(version) GROUP BY id`, so a page still costs a whole-type group-by. What this removes is pages, rows returned,
  parsed bodies and isolate memory - the memory and time cliff at roughly 25-50k records - not the per-page scan.
  O20 (a latest-version flag or table in the schema) remains the owner's decision and the only fix for the scan.
- Measured on the seeded tenant in test/wardsynq-repository-window.test.mjs: a one-month NABH table over 3,004
  DiagnosticReports asks the port for 2 pages of that type instead of 4, and stays at 2 however much older history
  the hospital holds.

## 2026-09-18 The last capped reads, and an unreadable token family (R5-4, branch remaining-caps)

- A read that fails must not answer with a plausible empty value. Two swallows removed rather than widened:
  digital-twin's notification-reliability read (a failed BreakGlassGrant/CriticalResultLoop read now makes that
  section `unavailable` with its reason instead of a delivery rate over an empty sample), and smart-server's
  refresh-reuse revocation.
- SMART refresh reuse: an unreadable token family, or any revocation write that fails, now REFUSES the revocation.
  The token in hand and the family root are still revoked by id (both addressable without the list), the audit row
  carries `revoked: "incomplete"` with `outcome: "error"`, and the endpoint answers 503 `temporarily_unavailable`
  rather than the flat 400 `invalid_grant` that reads as handled. Accepted cost: a reuse against a broken store is
  distinguishable from a random bad token, which needs possession of a real rotated token to observe.
- The digital twin's point-in-time rebuild reads the NEWEST 500 per type, not the oldest. The bound stays 500
  because each record read costs one further history read; the screen already said "only the latest 500 checked",
  which is now true. Raising it is an O20 question, not a constant to bump.
- Ceilings that were reached are stated in the same sentence as what they cost: lab-qc's QC screen names both the
  runs and the corrective actions read (a truncated action read changes what a block IS, not just what a chart
  shows), and security-review counts a ward history not read past HISTORY_READ_MAX separately from one that could
  not be read.

## 2026-09-18 Status-scoped worklists, and the order closure they needed first (branch status-scoped-worklists, R5-2)

- The audit's premise did not hold: `service.listByStatus` bounds a worklist only if something closes an order,
  and NOTHING in the tree ever did. Every native ServiceRequest was written `active` and stayed `active` after its
  result was filed, so "open orders" and "every order this hospital has ever placed" were the same set. Converting
  the reads alone would have refused (503 at OPEN_CENSUS_MAX 5,000) where the old read still worked. So the closure
  came first: `ward-order.js closeOrderOnResult()`, called by `lab-result.js releaseResult` (any report) and
  `radiology-report.js reportImaging` (final or corrected only, matching the rule dicom.js's worklist already
  applied). It never throws - a result on the chart is on the chart - and the response carries `orderClosed`.
- It writes through its OWN actor, scoped to ServiceRequest and stamped with the releasing person's id (the pattern
  online-booking.js uses for the portal), because the laboratory grant deliberately cannot write a ServiceRequest:
  widening actor.js would open order CREATION to a role, which is the billing hazard that grant's comments cite.
- Converted: `lab-result.js pendingRequests` (hospital scope), `specimen.js collectionList` (hospital scope),
  `dicom.js imagingWorklist`. Each reads open orders by status, then the reports or specimens of only THOSE orders'
  patients (governed `byPatient`, eight at a time) instead of the whole type. `specimen.js rejectionStats` keeps
  `listAll`: a monthly count IS a history and flags its own truncation.
- `ward-order.js` owns the vocabulary: OPEN_ORDER_STATUSES / CLOSED_ORDER_STATUSES / isOpenOrder. That list is a
  safety boundary - a status in neither would silently drop an order off every board - and
  test/wardsynq-ward-order.test.mjs pins it against every writer (native, hl7-normalize ORC maps, SCCM draft).
- NOT converted, and the reason: Appointment, AppointmentRequest and SpecimenCollection keep where they stand in
  `state`, not `status`, and `pageByType` filters `$.status` only. Mirroring `state` into `status` on new writes
  would leave every appointment already in the diary invisible to the filter - a double booking. So scheduling.js
  and online-booking.js still read `listAll`; the port change (a named field, or `states` beside `statuses`) is
  R5-3's, and the blocker is written out in both files.
- Also not done: an order the SENDER closed still lands as `draft`. Filing it closed was tried and reverted - an
  adapter actor holds the draft tier and the governed store refuses it any other status, rejecting the whole
  transaction, so a cancellation would never land. An integration-mode hospital's external orders therefore still
  accumulate against the open census. Closing them needs an actor that may, which is a governance change.
- Existing tenants: orders resulted BEFORE this branch stay `active` and count against the 5,000 open census. A
  hospital past that sees a visible 503 on these three boards until a backfill closes them. No backfill is built
  (it is a resumable job, not a request-scoped read).

## 2026-09-18 The backfill that closes orders resulted before anything closed one (branch order-close-backfill, R5-3)

- The gap R5-2 wrote down: an existing hospital's orders were resulted while NOTHING in the tree closed an
  order, so they are all still `active`. They count against OPEN_CENSUS_MAX (5,000) and the lab, specimen and
  imaging boards - now status-scoped reads - answer 503 `too_many_open` on a hospital that has simply been
  open for a while. `functions/_wardsynq/order-backfill.js` closes them.
- SAME CLOSURE, NOT A SECOND ONE. Every order goes through `ward-order.js closeOrderOnResult()`: same writer,
  same `completed` status, same append-only new version, same governed audited put, the releasing person's id
  stamped on it. The one added field is `completedOn: "backfill"` (a new optional `deps.on`, default
  `"result"`), so an auditor can tell a retrospective tidy-up from a result being filed. A second closure path
  with its own vocabulary is how a board ends up showing an order nobody can explain.
- THE RELEASE RULE IS THE LIVE PATH'S, read off the order's effective category: any DiagnosticReport for a
  laboratory order (lab-result.js closes on any release), final or corrected only for imaging
  (radiology-report.js, and dicom.js's worklist). Never closed: an order with no report (the test is genuinely
  owed - closing it is a missed result), an imaging order read only preliminarily, an order another system
  owns (the adapter draft tier R5-2 documented; that still needs a governance change, not a job).
- TWO STEPS, AND THEY DO NOT COLLAPSE. `POST /ward/order-backfill-scan` writes nothing and answers with the
  order ids it would close plus a grouped tally of why the rest stay open; `POST /ward/order-backfill-close`
  takes those ids and re-checks every one from the store before writing, so a stale list cannot close an order
  whose situation has changed. Both staff.admin. Re-running writes nothing: a closed order is not in the
  store's open page any more and is refused by name if it is sent again.
- RESUMABLE, via `service.pageByStatus()` - one page of the open-status read at the store's own cursor
  (repository pageByType), governed and audited exactly as listByStatus. It is deliberately NOT capped by
  OPEN_CENSUS_MAX: a read that refused past the ceiling could never be the read that fixes being past it. The
  bound is the page (default 100 orders) instead, so no amount of history changes what one request costs.
- Screen: Admin Center > Close finished orders (wardsynq/site/pages/admin.js, `orderBackfill` tab). It drives
  batch after batch and shows the remaining count as it goes. A batch that fails STOPS the run and says so -
  "could not be read" and "nothing left to do" are different sentences on a screen whose whole job is to say
  how much work is left.
- Not done: no cron or scheduled runner (the job is admin-triggered on purpose; the person who starts it is
  the person it is audited to), and no total-remaining figure before a full scan pass - the count comes from
  the scan itself, batch by batch, because counting the archive is the same walk as scanning it.

## 2026-09-18 - A safety check that could not read the record says so (R6-1, no-unchecked-safety)
- THE BUG, stated once: `svc.byPatient("AllergyIntolerance", id).catch(() => [])` inside a safety path. The
  store faults, the check receives an empty list, and a patient with a documented penicillin allergy is
  presented to the prescriber, the pharmacist or the radiologist as a patient with no allergy. Worse, the
  per-read catch swallowed the failure before the file's own outer catch could see it, so the degraded branch
  in rx-safety.js and the fail-closed contrast refusal in radiology-protocol.js were unreachable code.
- THE SHAPE is R5-1's, not a new one (break-glass.js `unreadableTypes`, migrate-inpatient.js
  `advisoriesUnavailable`): null is a read that did not happen, [] is a read that happened and found nothing.
  `functions/_wardsynq/unreadable.js` holds the two helpers - `readOrNull(promise, type, failures)` and
  `unavailable(failures) -> { notChecked: [type], reason }` - so the verdict shape is one contract the tests
  and the screens can both pin.
- REPORT OR REFUSE, per path, decided by whether the function is allowed to stop the clinician:
  - rx-safety.js NEVER gates (unapproved content, its own header): it reports `notChecked` on the verdict and
    the prescribe confirm names the record it could not read, first, before any finding.
  - radiology-protocol.js protocol CONTEXT reports (`contrastAllergies: null`, `renal: null`, `notChecked`);
    recording a CONTRAST protocol refuses 502 `clinical_read_failed` (renamed from `allergy_read_failed`,
    which now also covers the renal Observation). A non-contrast protocol is still recordable and carries
    `notCheckedAtProtocol` on the record itself.
  - pharmacy-verify.js: the allergy read reports (the orders stay on screen), the MedicationVerification read
    refuses - an unreadable verification list made every order read as `unverified`, which hides exactly the
    stale-verification state the file exists to show.
  - pharmacy-dispense.js and icu-care.js refuse: issuing stock against a verification nobody could read, or
    dropping a running pressor because its drug name did not load, are not states worth reporting around.
- NOT DONE HERE, by the conflict map: patient-record.js, chart-completion.js, billing.js, hl7v2.js,
  lab-result.js, specimen.js (R6-2), the ingest files (R6-3), scheduling/online-booking (R6-4), registry.js
  (R6-5). migrate-emar.js's bedsideSafetyCheck already reports NOT_CHECKED_* itself and was left alone.

## 2026-09-18 R6-3: an order the SENDING system has finished is closed here, by a local actor

Round 6 audit §2(b): an ingested ServiceRequest lands as `draft` (service.js `governedForIngest` writes as the
adapter actor, and the adapter ceiling caps it there), so if its result is filed upstream nothing in WardSynQ
ever closes it. `draft` is an OPEN status, so every order a real LIS feed ever sent counts against
OPEN_CENSUS_MAX (5,000) for ever, and the day that is reached the laboratory, specimen and imaging boards
refuse. Branch `external-order-closure`.

- THE ADAPTER CEILING IS NOT MOVED. An adapter still writes `draft` and still may not assert a clinical
  status; the governance test is unchanged and still passing.
- THE SENDER'S ASSERTION WAS ALREADY PRESERVED, so no ingest change was needed. The audit proposed a new
  `meta.sourceStatus`; the code already carries the sender's own word as `externalStatus`
  (wardsynq-sccm-adapter.js, from FHIR `ServiceRequest.status` or the HL7 ORC, on both the FHIR and HL7
  doors), audited with the rest of the record and never read as the record's own status. Adding a second
  field for the same fact would have been a second source of truth. Followed the code; fhir-inbound.js and
  hl7-normalize.js are untouched, and a test pins the adapter's behaviour so it stays that way.
- THE CLOSING WRITE IS LOCAL AND GOVERNED, never the adapter's. `functions/_wardsynq/source-order-close.js`
  is shaped exactly like `order-backfill.js` - dry run first, one page per request at the store's own cursor,
  resumable, safe to run twice, nothing partial reported as success - and closes through
  `closeOrderOnResult()` with a new `deps.on: "source-terminal"` (`roleSource: "wardsynq-source-terminal"`),
  on the authority of the administrator who pressed the button, whose id lands on the new version. The
  record keeps `externalStatus` and `meta.source` and gains `completedOn: "source-terminal"`, so the audit
  trail says the assertion came from outside and the closure was made here.
- ONE NARROW EXCEPTION TO EXTERNAL AUTHORITY, in `service.js sourceTerminalClosure()`: that role AND that
  roleSource, ServiceRequest only, the sender's terminal word as the STORE holds it (never as the incoming
  entity asserts it), the status being written is `completed`, and every other field on the record must be
  byte-identical. Anything else is still refused with EXTERNAL_AUTHORITY, so this cannot widen into a general
  door onto another system's records. The terminal vocabulary is `CLOSED_ORDER_STATUSES` and is spelled twice
  (ward-order.js imports service.js, so the import cannot go the other way); the test pins the two equal.
- An order whose sender says `active`, says `unknown`, or says nothing is never closed. Neither is this
  hospital's own order: those are order-backfill.js's, closed on a filed result.
- The closing version KEEPS `meta`. The two native paths delete it, which for an externally owned record
  would leave the new version with no `meta.source` at all - read everywhere as "this hospital owns it", so
  tidying the order would quietly transfer another system's record to us.
- CORRECTION TO THE AUDIT: it says an ingested order "appears on the board". It does not. specimen.js and
  lab-result.js both drop `isExternalRecord`, so another system's order was never on this ward's collection
  or pending-tests boards. What it does is sit in the OPEN CENSUS, which is what refuses. The test asserts
  the census, and asserts the boards do not change.
- Screen: Admin Center > Close finished orders now carries both panels - the existing result backfill and
  "Close orders another system has finished" - each with its own state. Routes
  `POST /api/queue/ward/source-order-scan` and `POST /api/queue/ward/source-order-close`, both staff.admin.
  The scan names the sending system per order, so an administrator can see whose "finished" they are acting on.
- Not done: no cron (admin-triggered on purpose, as the backfill is), and no per-adapter policy for which
  senders may be trusted - every connected system's terminal word counts the same today. If one hospital
  finds a feed whose `completed` is unreliable, that is a per-adapter setting and a new decision.

## 2026-09-18 A clash check reads the clash window, not the hospital's whole diary (R6-4, branch booking-and-registry-reads)
- THE PROBLEM WAS NOT `state` VS `status`. R5-2 could not put the two clash reads (scheduling.js
  bookAppointment, online-booking.js diary) on the open-status read because an Appointment keeps where it
  stands in `state` and the store filters on `status`, and mirroring `state` into `status` would have left
  the hospital's existing diary with no status and a clash check that skipped it. The conclusion drawn then
  was "the port needs a `states` filter first". That is NOT what was built.
- A CLASH IS TIME-BOUNDED BY DEFINITION, so the period read R5-3 already shipped (service.listSince,
  pageByType newest/beforeSeq) bounds it with no port change, no schema change and no new filter on three
  adapters: read newest first and stop once a whole page is behind the window. read-window.js
  `readClashDiary` holds the window (the longest permitted appointment, 480 minutes, plus a week of margin).
  A `states` filter stays the upgrade if a state query that is NOT time-bounded ever appears.
- THE STOP TEST LOOKS AT TWO THINGS, and this is the part worth remembering: the read pages by WRITE order,
  the window is on `startAt`. A booking made long ago for a date inside the window has an old seq, so a stop
  on `startAt` alone would walk past it and book over it. A record is behind the window only when its slot is
  older than the floor AND it was last written longer ago than the longest lead a booking is made with
  (WRITE_LOOKBACK_MS, 400 days). An appointment booked further ahead than that and never touched since is the
  stated residual, and it is outside any real outpatient diary.
- THE AMENDMENT RACE IS NOT ACCEPTED HERE. pageByType's newest-first cursor can miss a record amended during
  the read (repository.js:302-306); on a month report that is the documented price, on a clash check it is a
  double booking. An amendment lands at the very top of the write order, so ONE page of the newest records is
  re-read after the decision and before the append (read-window.js `readRecentWrites`) and tested with the
  same overlap rule; in the portal that re-read runs after the slot hold is claimed and releases the hold if
  the time turns out to be taken. Bound: 1,000 writes landing inside one clash read would push an amendment
  off that page; a per-clinician id range seek is the upgrade.
- Unchanged: the Blackout read (a standing period, not a slot), listSchedule's diary read (it is asked for
  arbitrary past date ranges), and the 50,000 ceiling with throwOnTruncate - a diary that cannot be bounded
  still refuses rather than booking on a short read.

## 2026-09-18 The recall registry reads the newest first (R6-5, same branch)
- registry.js read the whole history of Condition, Observation and Patient oldest-first, so past READ_MAX the
  records dropped were the NEWEST - the patients most likely to need recall, and the ones whose latest
  qualifying result decides whether they are overdue. It now reads newest-first (service.listSince with no
  stop test, which keeps the newest past the ceiling) and the truncation sentence says the oldest were not
  read.
- NOT period-scoped, deliberately: a registry asks for each patient's LAST qualifying record, so a period
  read would turn "reviewed three years ago" into "never reviewed" - the most overdue state there is.

## 2026-09-18 - R6-2: a chart that could not be read is never drawn as a chart with nothing in it (branch no-silent-empty-chart)

R5-1 fixed this swallow in three files; the audit found it in about fifteen. This branch takes the six
it owns (patient-record.js, chart-completion.js, billing.js pre-auth, hl7v2.js, lab-result.js,
specimen.js). The rule, unchanged from R5-1: a read that FAILED and a read that came back EMPTY are
different facts and are never rendered the same way.

- SHAPE, per site, chosen by what the caller can honestly do with a partial answer:
  - `patient-record.js assemble()` - per-type `null` plus `unreadableTypes`, the break-glass.js pattern
    verbatim. Six of seven types failing independently is the common case and blanking the whole chart
    for one of them would be its own lie.
  - `chart-completion.js` - per-detector, so one unreadable section is `unknownSections: [{type, reason}]`
    and the other six checks still run. The audit asks for a completion percentage; this file computes
    none (it is a deficiency queue), so the count of unknown sections is what is reported instead.
  - `billing.js claimsForPatient` - `preAuthorisations: null` beside the three lists R5-4 already did,
    and every payer rule that turns on a pre-authorisation is reported UNCHECKED rather than as "none
    recorded", which is what the rule engine would otherwise state as a fact.
  - `hl7v2.js`, `lab-result.js`, `specimen.js` - REFUSED (the 502 the surrounding code already returns).
    An outbound ORU with no OBX is filed by the receiver as a report with no results, and an empty
    laboratory or phlebotomy board is read as work already done. There is no partial answer worth giving.
- A HANDOVER IS NOT RECORDED OFF A CHART THAT COULD NOT BE READ. `releaseToPatient` refuses with 502 and
  writes nothing: its receipt counts allergies, medicines and diagnoses, and a zero taken from a failed
  read is an answerable written statement that the patient was handed a page with none.
- WITH THE CRITICAL-RESULT LOOPS UNREADABLE, NO RESULT IS RELEASED. Releasability is "no OPEN loop covers
  this report"; unreadable loops used to mean no loops, which is the potassium-of-7.2 failure the file's
  own header is about.
- Screens: ward Patient copy names the unreadable parts above the chart and draws each missing section as
  unknown rather than empty (the second-language aside is DROPPED for such a section rather than printing
  the catalog's "nothing recorded" in the patient's own language - a new print-lang.js catalog word was
  not invented for it); Chart check will not print "Nothing outstanding" while a section is unknown; the
  TPA screen says the pre-authorisations could not be read; the patient portal reuses its own existing
  `section(..., "failed", ...)` state.
- Not done here: `patient-access.js:441` (the portal's own PatientMessage read) and the sites owned by
  R6-1/R6-3/R6-4/R6-5.
## 2026-09-18 Purchase tier is separate from verification role (ROLE_GATES_ON)

- Entitlement records now carry `tier` + `tierExp` (what was PAID for: free|trainee|coresident|pro|physician|
  physicianpro) alongside `role` (WHO they are, from verification). One Trainee price, three trainee roles: PG
  Logbook needs the role, Scribe needs the tier, Ward Sync needs both. `fulfilPurchase()` used to discard the plan
  key and grant a flat Pro, so ₹199 and ₹2,499 bought the same thing.
- Money rule in `purchasePatch()`: a purchase may upgrade and may extend, never downgrade an active higher tier and
  never shorten an expiry (Trainee bought on top of Physician Pro, or a replayed webhook, must not shrink anything).
  `tierExp: null` = forever (owner comp) and stays null.
- Onco add-on (`oncoAddonExp`) is buyable by any tier; the oncology AI extras get a 3-day trial per account started on
  FIRST USE (`oncoTrialStart`), not signup. ONCQIS/OncoTree reference stays free forever and is not in the matrix.
- The role x tier matrix in `_features.js` is INERT unless `ROLE_GATES_ON=1` (on top of the existing `FEATURES_ON`);
  with it off `featureAllowed()` behaves exactly as before. Per-user `featureFlags` and `FEATURE_<KEY>_DEFAULT_ON`
  still override the matrix. Route-by-route rollout is a later step.
## 2026-09-18 — Per-patient quota meters (FollowCare/MAiTRI + MaiK Scribe), flag `QUOTA_METERS_ON`
- FollowCare (7 SMS over 7 days) and a MAiTRI recovery call each cost us ₹10, so they share ONE wallet:
  1 patient credit = one MAiTRI call OR one 7-day FollowCare course. A Scribe consult costs ₹3-5.
- `functions/_quota.js` is the meter. KV, keyed `quota:<feature>:<uid>:<YYYY-MM>` for the monthly included
  allowance (Physician / Physician Pro only: 5 care + 50 scribe, calendar-month reset, NO roll-over) and
  `quota:<feature>:<uid>:bal` for purchased packs, written with no TTL so purchased credits never expire.
  Spend order is included first. Concurrency is best-effort read-modify-write, same as `_usage.js`; the
  documented ceiling is at most one over-granted unit per concurrent burst (₹10), not worth a Durable Object.
- Enforced only at real spend points: `followcare/enroll`, the doctor-initiated `followcare/voice/call`, and
  the Scribe `extract` path. Refusal is a 402 `{error:"quota-exhausted", feature, remaining:0, packs, copy}`
  that the client renders as a top-up sheet. Never a hard lock: one Scribe "consult" is a dictation SESSION
  (rolling 45-min marker), so the ~120s refine loop is charged once and an open session is never refused.
- Packs `in.stewardmd.care.25|100` and `in.stewardmd.scribe.50|250` live in `plans().packs` (cfgPrice
  overridable) and are fulfilled by `fulfilPurchase()` on both the Razorpay and StoreKit paths.
- Copy is owner-approved value framing and is asserted in tests: no clinical outcome claims, no promise that
  Scribe cannot miss anything (false, contradicts the App Store "not a diagnostic device" listing, invites
  CDSCO/FDA medical-device scope, and a doctor who believes it checks less carefully), no invented statistics,
  no em-dash. The "N patients have not heard from you" line renders only with a real server number.
- Not wired: the ROLE_GATES_ON access matrix (separate branch), an `unheardCount` source for that line, and
  the scheduler's own MAiTRI calls (they continue an already-paid episode).

## 2026-09-18 — The "N patients have not heard from you" nudge stays unwired: there is no honest source

Investigated whether the `unheardCount` line in `quotaCopy()` (`functions/_quota.js`) can be made real.
It cannot, today. Not wiring it is the decision, not an omission. The sentence tells a clinician they
neglected patients; a wrong number there is worse than no sentence, so it renders only from a real count.

The sentence needs three facts joined: (1) a patient this doctor discharged, (2) in this calendar month,
(3) with no FollowCare episode. Four stores were checked and none carries all three.

- **`q_tickets` / `q_sessions` (Firestore, OPD queue).** Has the doctor (`q_sessions.doctorUid`,
  `_queue_engine.js:23,33`), a completion time (`consultEndAt`, `:209`) and a joinable patient key
  (`decPHI(encMobile)` reproduces FollowCare's `patientKeyHash`). **Killed by retention:** every ticket
  and session carries `expiresAt` = end of visit day (`_queue_engine.js:36,171`) under a Firestore TTL
  policy (`docs/queue/smart-opd-queue-design.md:120`, `QUEUE_RETENTION_DAYS` default 2). A month of
  tickets does not exist to be counted. Also: an OPD visit is not a discharge.
- **WardSynQ `Encounter` (D1 `wardsynq_record`).** The only durable discharge record: `attendingId` =
  the syncing session's `doctorUid` (`_wardsynq/migrate-encounter.js:153,191`), `periodEnd` = the real
  discharge time (`migrate-discharge.js:576-584`), not TTL'd. **Fails on both remaining counts.**
  (a) Neither `attendingId` nor `periodEnd` is indexed - they live inside the JSON body, and the only
  read paths are by patient, by id prefix, or a whole-type tenant scan (`db/wardsynq_schema.sql:32-33`,
  `repository-d1.js:163-168`). One doctor's month = a tenant-wide Encounter scan. (b) **There is no join
  key to FollowCare.** The Encounter's `patientId` is a pseudonym derived from the MRN
  (`_wardsynq/opd-identity.js:18-20`); the identity index knows mrn / abha / ticket / ghis-episode and
  no phone at all (`_wardsynq/identity-key.js:39-51`), and the `Patient` model has no phone field.
  FollowCare keys patients by `patientKeyHash(hospitalId, last-10-of-phone)` (`_followcare.js:118-126`).
  Nothing can decide whether a discharged patient already has an episode. Also gated: nothing is written
  unless the tenant has WardSynQ migration on (`migrate-encounter.js:180`).
- **`q_patients` / `q_patient_index`.** A registry, not a visit log: org-scoped, no doctor uid, no visit
  or discharge timestamp.
- **`fc_episodes`.** Has all four properties (`doctorUid`, `dischargeMs`, an equality-indexed per-doctor
  query at `_followcare.js:470`, `patientKeyHash`) and is therefore circular: it only knows the patients
  who already have an episode, which is the set the sentence subtracts.

Second tenant problem even if a join existed: FollowCare's `hospitalId` comes from the doctor's
self-declared `fc_doctors` binding (`_followcare.js:482`), the OPD org id comes from the org store. The
two namespaces are not the same string, so the hash would not match even with the phone in hand.

**What would have to be recorded first** (any one of these unblocks it):
1. The discharge/visit-completion event carries the patient's phone-derived `patientKeyHash` under the
   same tenant id FollowCare uses - i.e. `patientKeyHash` written onto the WardSynQ `Encounter` (or its
   identity index gains a phone system) at admission/registration. It is a non-reversible hash, so this
   adds no new PHI at rest.
2. **Or** a small per-doctor monthly counter maintained at the discharge write itself: increment
   `nudge:<uid>:<YYYY-MM>` on discharge, decrement on FollowCare enrol when the episode's
   `patientKeyHash` matches. O(1) per event, no scan, no month-long retention needed, and the paywall
   reads one KV key. This is the cheaper option and the one to build.

Either way the count is then folded into the `quota` block of `/api/billing/status` and passed to
`quotaCopy()`. Until then `unheardCount` is never supplied and the line never renders.

Hardened meanwhile (`functions/_quota.js`): the guard is now `Number.isInteger(n) && n > 0` with **no**
coercion, so `true`, `"5"`, `Infinity`, `NaN`, `2.7` and `-3` all produce no sentence rather than
"1 patients discharged this month have not heard from you." Pinned by `test/quota-meters.test.mjs`
(21 tests, +2) and `test/run-quota-topup-ui.mjs` (27 browser checks, +7: the nudge renders verbatim from
a real count, exactly once, leading the deck, with no identifier, and vanishes at 0).

## 2026-09-18 — Credit model: one credit = one bounded EPISODE; new prices; web pricing kept out of iOS

Owner decisions, implemented on `nudge-unheard-count`. Still fully inert behind `QUOTA_METERS_ON`.

**1. One credit = one bounded episode, charged once at enrol.** An episode is day 0 the 7-day
FollowCare SMS/WhatsApp check-in course, day 3 a MAiTRI call *only* if the patient has not responded,
day 7 a MAiTRI call *only* if there is still no response, plus feedback capture, the ambulance alert by
WhatsApp/SMS, the doctor-app alert and in-app patient messaging. At most two calls, both conditional on
non-response. Nothing else in the episode deducts.

This made `followcare/voice/call` a **bug, not a gap**: it was deducting a second credit for the
doctor-initiated MAiTRI call. That route 404s without an existing `episodeId`, so every call it can
place belongs to an episode already paid for at enrol - the deduction was double-charging the doctor
for what they had bought. Removed (`functions/api/followcare/[[path]].js:415`). `enroll` is now the
only care deduction in the codebase, and `test/quota-meters.test.mjs` asserts exactly that by counting
the `careCredit(` call sites in the router and asserting the scheduler dispatch path never imports the
meter. The scheduler-initiated calls that were already unmetered were correct all along.

**2. New prices** (verified live in App Store Connect): `in.stewardmd.care.25` ₹2,499 (was ₹1,099),
`in.stewardmd.care.100` ₹8,999 (was ₹3,499). Scribe unchanged at ₹999 / ₹3,999. Per-patient copy is
₹100 and ₹90, and `perUnit` is **derived** from `amount / units` rather than typed, so the two cannot
drift apart. Rationale in the code: an episode costs us ~₹32 worst case (SMS ₹10 + up to two calls at
₹10 + ~₹2 of alerts) and ~₹19 typical, so ₹100 holds 55% margin even for a patient who needs both calls.

**3. Web pricing, and why it never appears on iOS.** `quotaPacks()` now carries `amount` (store) and
`webAmount` (web): care.25 ₹2,199, care.100 ₹7,999. The discount is funded by the payment fee we save
(Razorpay ~2% against Apple's 15%), not out of margin. Scribe deliberately has **no** `webAmount`, so
nothing can advertise a discount that does not exist.

The India storefront's anti-steering rules make a "cheaper on the web" hint anywhere in the iOS app a
straight rejection, and this app is mid-submission. Apple's 2021 anti-steering settlement permits
telling users about other payment methods *outside* the app, with consent. So the two halves are
separated **structurally**, not by discipline:
- The outbound SMS/WhatsApp/email copy is `webUpsellSms()` in `functions/_quota.js`. `functions/` is
  excluded from the app bundle by `scripts/build-www.sh`, so that string physically cannot reach an
  iOS screen.
- The sheet renderer gates every web price on `var webOk = plat() !== "ios";`
  (`pro-paywall.js` `openTopUp`). On iOS the card shows the App Store price and the store-derived
  per-patient figure; on the web it shows the web price and the web-derived figure. There is no
  comparison shown anywhere, on either platform, so there is nothing to steer with.

Asserted three ways: a node test that the in-app refusal copy contains no web price, no `stewardmd.in`,
and no steering wording, that `pro-paywall.js` reads `webAmount` only behind the platform gate and
ships no purchase URL; and a headless-Chrome test that re-renders the *same* sheet with
`Capacitor.getPlatform() === "ios"` and asserts ₹2,499 / ₹8,999 are shown while `2,199`, `7,999`,
`219900`, `799900` and `stewardmd.in` appear nowhere in the sheet's **markup**, not merely its text.

Tests: `test/quota-meters.test.mjs` 24/24 (+3), `test/run-quota-topup-ui.mjs` 36/36 browser checks (+9).

## 2026-09-18 — Product name is "MaiK Voice Scribe" in every user-facing string

Owner correction. Renamed in the three places a doctor can read it:
- `functions/_quota.js` pack labels: `"50 Scribe consults"` -> `"50 MaiK Voice Scribe consults"`,
  `"250 Scribe consults"` -> `"250 MaiK Voice Scribe consults"`. These are what `plans().packs` serves
  (`plans()` just returns `quotaPacks(env)`), so the paywall, the /billing/plans response and the 402
  refusal body all pick the new name up from one place.
- `pro-paywall.js` top-up sheet title: `"MaiK Scribe consults"` -> `"MaiK Voice Scribe consults"`.
- `pro-paywall.js` Physician tier blurb: `"... FollowCare · Scribe · unlimited billing"` ->
  `"... FollowCare · MaiK Voice Scribe · unlimited billing"`.

`quotaCopy("scribe")` needed NO change: its approved copy never names the product. The headline
("Not just a note. A second pair of eyes."), the five lines, the price line and "Consults never expire."
are unchanged, as instructed.

NOT renamed, deliberately: the internal feature key `"scribe"`, the KV key prefix `quota:scribe:*`, and
the product ids `in.stewardmd.scribe.50|250`. Renaming any of those orphans every existing purchase and
every live counter. The App Store display names are the owner's to change in App Store Connect;
`iap.js` product ids untouched (its only "Scribe" mention is a code comment).

Guarded by a test that walks every user-facing string in the 402 body and asserts that wherever the
word "Scribe" appears it is preceded by "MaiK Voice", which catches a bare "Scribe", the old
"MaiK Scribe", and any future half-rename; plus a bundle check that neither old spelling survives in
`pro-paywall.js`, and a browser check on the rendered sheet.

## 2026-09-19 — Feature guides run ON the screen (SMD_TOUR engine), and the OTP sheet is a designed screen

**Owner: "the guide should run on the screen like the app tours".** The first attempt was a static
canvas; the real thing is eight walkthroughs on the existing spotlight engine in `onboarding.js`
(`GUIDES`, `guideController`, `startGuide`, `SMD_TOUR.guide(id)` / `guides()`, `start("guide:<id>")`):
home, reasoning, maik, drugs, calculators, hospital, imaging, account. Each step names a `screen`;
`gotoScreen()` closes whatever is open and opens that screen for real (Hospital / Drugs / Dosing /
More / Dx sheets via the home `[data-act]` buttons, MaiK via `SMD_askMaik("")`, Calculators via
`MEDCALC.openList()`, the sidebar via `SB.open()`, and Experimental via Settings then Experimental,
because that page is a page inside Settings). Every targeted step is `optional`: a gated tile is
skipped, never a coach-mark over nothing. Resolution is scoped to the screen on top (`guideScope`) so a
drawer control behind an overlay is never spotlighted through it. The chooser (About & Help) lists
them under "Feature guides"; the Hospital guide hands off to the ICU tour (`then:"icu"`).
Engine tweak: the coach-mark is `visibility:hidden` between goStep and paint, so no empty box flashes
while a sheet animates open (affects all tours, for the better).
Copy rule holds: no em-dash in any guide string (test-pinned). `test/run-feature-guide-ui.mjs` drives
all eight in a real browser; `test/feature-guide.test.mjs` pins shape and wiring.

**OTP sheet redesign** (owner: "looks AI slop, make it premium"): `phone-verify.js` now renders six
code slots with a marching-dot ring on the waiting slot, pop-in digits, a red shake on a wrong code,
a green sweep on success, a resend countdown ring, a status row that says what the app is doing about
the message (WebOTP on Android fills the code; the input is `autocomplete="one-time-code"` so the iOS
keyboard offers it), inline SVG icons only, light and dark, reduced motion honoured. The one real
input is a hidden `#phvCode` over the slots (so the harness and the keyboard both drive it). It also
waits for the first-launch guided tour, not just the registration gate, before asking.


**CliniX case simulation, 2026-09-19** (owner: *"each student talk english differently how will he
ask exact question as we programmed? Fix that and in ddx,dx give him 100s of diagnosis and he will
pickup one and give hints too, and plan also give mcq options so he will select"*). Four decisions:

1. **The patient understands lay English, and still never improvises.** `clinix-lexicon.js` sits in
   front of the cue matcher: contraction expansion, ~320 lay and Indian-English phrases, a synonym
   map, stemming and a bounded fuzzy snap that requires the first TWO letters to match (one letter
   turned "spell" into "swell"). Scoring uses cue specificity, a key-cue boost and a
   document-frequency rarity TIEBREAK (rarity as a multiplier dragged every score under the
   threshold). Above `ANSWER_AT` the patient answers; between `SUGGEST_AT` and `ANSWER_AT` it offers
   a did-you-mean rather than guessing; below that it matches NOTHING and suggests nothing, because
   a simulated patient answering small talk from a case script is inventing clinical content.
   `clinix-model.js` keeps `legacyMatchAsk` and uses it when the lexicon is absent.
2. **Marking counts CONCEPTS, not accept terms.** An accept list carrying "heart failure", "CCF" and
   "cardiac failure" describes one concept; counting them separately told a student they had missed
   two things when they had missed none. Missed terms are grouped by `conceptKey` (vocabulary entry,
   else anglicised string) and a differential is scored on PICKS.
3. **Breadth is not a differential.** 8+ picks, or unsupported guesses outnumbering supported ones,
   is marked `shotgun` and fails even when the right answer is in the list. Missing the true
   diagnosis fails regardless of how many other reasonable ones were named.
4. **A harmful management choice is disqualifying, not a deduction**, and the result names the
   option. A case whose model answer is keyword fragments rather than actions ("b12", "treatable",
   "88" as a saturation target) keeps the written plan: an unanswerable two-option stub is worse
   than a text box. `ataxia` is currently the only case on that path.

**Physiology sandbox rebuilt** (owner: *"physiology sandbox doesnt work its 1/10 make it 10/10"*).
Two independent defects, both real. (a) The engine was uncalibrated: nominal sliders gave 70/46 with
a cardiac output of 3.0, and the Hill denominator was `26.6 * 1000` rather than
`Math.pow(26.6, 2.7)`, so a PaO2 of 88 read as 87%. **The old test file pinned both as "observed"**,
which is how they survived, and is the reason a test that pins behaviour must say whether that
behaviour is CORRECT. (b) `onInput` called `repaint()`, replacing the `<input type=range>` mid-drag,
so no slider moved. The readout and the controls are now separate regions and only the readout is
rewritten while dragging; the same fix was applied to the plan MCQ, where a repaint per tick meant a
student ticking four boxes kept only the first.

The engine is physiology rather than fudge: ventricular-arterial coupling
(`SV = (EDV - V0) * Ees / (Ees + Ea)`) on the cardiovascular side, and gas exchange solved by OXYGEN
CONTENT on the respiratory side. Content-based solving is not a refinement, it is the only way a
shunt behaves like a shunt (at 45% shunt, FiO2 1.0 barely moves the saturation) and that behaviour is
the entire teaching point of the tab. Ventilation is a fixed point of the chemoreflex line against
the CO2 hyperbola, subject to a mechanical ceiling, so "a normal CO2 in acute severe asthma" and
"oxygen retains CO2 in COPD" both emerge instead of being hand-written. Waveforms are seeded SVG
paths, so a repaint never reshuffles a trace.

## 2026-09-20 — On-device AI models are free for every user; the Pro gate on them is removed

Owner, 2026-09-20 (voice): "Every free user, irrespective of any user or guest user, should have Pro AI models on and available. No Pro needed." This reverses the 2026-08-27 "Pro requires a verified registration" decision for ON-DEVICE answering only. `gateActive()` in maik-engine.js returns true for everyone (no SMD_PRO, no debug-build exception, no bypass key); the settings row and picker never sell Pro for it; the server feature matrix lists `local_ai` under every tier. MaiK Cloud keeps its own gate because tokens cost money.

Why now: the Pro verdict had locked the owner's own phone out of the models (offline-gate PR #1163 fixed the verdict; this removes the dependency). The decision is about access, not cost: an on-device model spends nothing server-side.

## 2026-09-21 · Universal Search replaces the header search panel

**Ask:** "make it search anything inside app, any feature, topic, anything ... and category filters."
**Decision:** New `search.js` panel over a provider registry; the three legacy listeners on
`#smdSearchInput` are left in place but never shown (app.js is minified, never edited). Default ON
with a kill switch (`?usearch=0`), per the 2026-09-04 no-more-flagging instruction; git tag
`pre-universal-search` is the recovery point. Cases/patients not indexed (PHI). Cmd/Ctrl-K desktop shortcut,
safe-area 100dvh viewport, race-condition close guard, and individual recent-item deletion are included.
Schemes, and CliniX/SURGX lazy content are deferred to Roadmap.


**MaiK settings: one page, our names, a grade ladder (2026-09-21).** Owner: *"This whole page is
shit. Make into one single well organised setting and dont name Real Model names only our model
names."* Four panels (engine, capabilities, pack list, KB toggle) each re-explained the same thing;
they are now one page that reads as a question and its consequences (who answers, on this phone,
model library, advanced). Vendor and technique words are gone from every string a clinician can see;
`actual` in the registry keeps provenance for logs. The four packs that carried a vendor's product
name are renamed (Prime, Swift, Max, Max 2) with their IDs unchanged so installs survive.
Grades replace gigabytes and provenance as the way a model is described, on the clinician's own
ladder: **MBBS** (our own doctor), **MD** (the medical specialists we trained to work as one),
**DM** (MaiK Cloud, the super specialist), **PhD** (the general models: well read, not a
physician). Intern/Resident were rejected for the general models because both imply medical training
those models never had. The grade is derived from the registry (`own`, `caps.medical`), never
hand-kept, so a new pack cannot land ungraded. The Knowledge Base switch became a positive label
("Check answers against the Knowledge Base"): a switch whose label reads the state it is NOT in is
what "Disconnected" with a tick beside it looked like on the phone.


**Tours fit every phone, and the first guide is a hands-on demo (2026-09-21).** Owner: *"the tour
you created doesnt fit the screen it should work and auto adjust on all phone screens and guide the
user thru a demo like make him use a start a case and see diagnosis of meningitis ... stewardship
console clinical reasoning everything in a demo to be made step by step by the user so he learns
after one learn."* Engine (`onboarding.js`): the coach-mark is capped to the VISIBLE viewport
(`window.visualViewport`, which shrinks for the keyboard; `env(safe-area-inset-bottom)` via a probe
element) and scrolls inside itself; when neither side of a target has room, `fitTargetAndCard()`
scrolls the target's own scroll parent so the spotlight sits at the top and the card takes the room
below, once per step so it never fights the student. A step may ask `place:"above"|"below"|"bottom"`;
"bottom" pins the card to the foot of the viewport so a search box and its dropdown stay tappable.
Guides gained hands-on steps: `kind:"tap"` with `done()` (the step advances on its OUTCOME, however
the student got there, never on a click the engine happened to see), `find()` resolvers for targets a
selector cannot name (the top infectious card, stewardship card 05), and `gotoScreen()` no longer
closes and re-opens a screen the student opened themselves (`SCREEN_OPEN`). The demo
(`DEMO_GUIDE`, first in the chooser) walks the real app: Dx Patient, Add New Patient, type four
findings (fever, headache, neck stiffness, photophobia, the set that makes `SYNDROMES.MENINGITIS`
lead), Review differential, the antibiotic gate, open the top card, commit, then six cards of the
real stewardship console (04 pathogens, 05 empiric antibiotics, 07 stewardship comment, 08
investigations, 09 de-escalation, 10 evidence). The student's own open findings are parked at the
start and restored at the end; the demo case, the stewardship page and the workspace are cleared.
The tour copy never states a dose; the console does, with its source. Pointing hand is an inline
SVG, not an emoji. Verified in `test/run-feature-guide-ui.mjs` at 320x568, 360x640, 390x844 and
430x932.

## 2026-09-21 - QA bug sheet: AgentConnect needs written hospital permission before it can be started
The internal QA sheet (BUG-012, Critical) called the EMR Website Login copy unacceptable: it claimed
"no IT approvals required" and "zero changes to your hospital's EMR", which reads as a promise that
the doctor may connect a hospital EMR on their own authority. The feature itself is correct and was
NOT changed (owner's instruction: "Agent Connect is working correctly dont change any function of
it just change the wording"). What changed is the wording plus a gate:
- The card now says the link uses only the access the doctor's own login already has, and that it is
  for hospitals with a web/online/cloud EMR, used only after hospital administration has permitted it.
- A full small-font disclaimer sits above the button: permission must come from the hospital
  administration or the authority that controls the EMR; StewardMD neither obtains nor can confirm
  that permission; the doctor is responsible for their credentials, for every screen read while
  signed in, and for hospital IT/privacy policy and the DPDP Act 2023; MAIKNOWLEDGE LLP accepts no
  responsibility for use without permission.
- A tick ("I have permission ... and I take responsibility") enables the Start button. The button is
  disabled and dimmed until then, and the click handler returns early if it is not ticked.
The existing in-flow consent screen (connect-agent-onboarding.js) is unchanged and still applies.

## 2026-09-21 - The Knowledge Library and the disease reader get CALM glass, not the app-hub aurora
BUG-011 ("Liquid Glass ... absurd", owner: "fix it properly"). appearance.css painted every
full-screen root with the same four-blob radial aurora. Behind paragraphs of reference text that is
noise, and the library's own `.kblib-feature` added a second blurred blob on top of it. The library
home, the library tool pages and the disease reader now get: one quiet top wash, hairline
translucent cards on a single radius, blur on the sticky chrome ONLY (no per-row blur - WKWebView
perf), a segmented tab pill, and no decorative blobs anywhere. The app hubs keep the aurora.
Also BUG-013: the library home's `<h1>` said "Knowledge Library" directly under the sheet chrome
that already says "Knowledge Library"; the page heading is now "Find any disease".

## 2026-09-24 — The logbook's numbers are counted, and they say what they counted
The PG logbook now has an analytics page (`pglog-analytics.js`). Three rules are in the code, not
just the copy, because a training record that overstates itself is worse than one with no numbers:
1. Headline figures count VERIFIED entries only, the same rule the progress engine uses, and the
   unverified remainder is printed on the page rather than quietly dropped.
2. A rate with no denominator returns null, and below 20 procedures the UI shows "2 of 6" instead of
   a percentage. `MIN_RATE_N` is the single place that threshold lives.
3. Complication figures are self-reported training records for reflection and for a conversation
   with a guide. `DISCLAIMER` travels with every result object and every surface must show it. They
   are not an audited outcome statistic and must never be presented as one.

## 2026-09-24 — Clinical photographs stay on the device; consent is a gate, not a checkbox
`pglog-photos.js` encrypts photographs device-local (the SURGX scheme) and adds NO upload endpoint.
Putting patient photographs on a server is a decision for the institution and the owner, not a side
effect of a logbook feature. `attach()` refuses without consent AND a de-identification assertion,
per photograph, with no "remember my answer"; the consent text and timestamp are stored with the
reference so it can be shown to an examiner. The app strips what it can (a canvas re-encode drops
all EXIF including GPS) and states plainly what it cannot check: no software here can see whether a
face is in the frame. The reference carries no filename, because a camera filename can carry a
patient's name. The cost is that a reinstall destroys them, which is why the Drive backup exists.

## 2026-09-24 — "Automatic" Drive backup means unlocked-this-session, and the UI says so
The owner asked for auto-sync to Google Drive. A background upload that needs no password would
mean the key was stored somewhere, which defeats the point of encrypting it. So `pglog-backup.js`
takes the password once per app session and, while unlocked, backs up on change with a 10-minute
floor; closing the app re-locks it. The backup holds only what exists nowhere else (drafts, queue,
photographs) — verified entries stay on the server, because copying them into a file the resident
can edit is how a logbook stops being evidence.

## 2026-09-25 — One profile form, one institution directory
Reported from a device: "all cities in India not covered and all medical colleges and hospitals not
covered, and bug can't see and can't search college, and why two times institution is asked, I need
one unified institution/hospital directory." Four separate faults, three of them real bugs.

1. **Two forms.** `email-auth.js` asked a new doctor at sign-up for name/state/city/hospital against
   `SMD_GEO` (107 hospitals, 184 cities); `profile-setup.js` then asked the SAME doctor on the next
   app start for "college / hospital" against `SMD_HOSPITALS` (2,405 entries). Two questions, two
   answers, two lists that disagreed. `profile-setup.js` is now the only form and asks the whole
   profile once (name, phone, state, city, institution, degree, speciality). `email-auth.js`
   delegates to it; its own form, typeahead and save were deleted rather than left as a second copy.
   Both wrote the same Firestore doc already, so no profile is orphaned.

2. **The college picker never opened.** `profile-setup.js` called the bare global `smdLazy(...)`,
   but `lazy-load.js` is NOT among the scripts `index.html` loads, so the call threw ReferenceError
   inside the click handler and nothing happened. The field looked focused and did nothing — that is
   the "can't see and can't search college" report. It now loads the script itself when the helper
   is absent. **Never reach for a global the page does not definitely define.**

3. **The picker rows were invisible in dark mode.** `.pfs-opt b` and `.pfs-opt span` took their
   colour from `--hink` / `--hmut`, the LIGHT theme's near-black, on a card the dark block had
   already repainted `#111b2e`. Labels were black on black while the `--hbd` borders stayed light,
   which is exactly what the screenshots showed: bright separator lines and no text. Every colour
   inside the sheet is now restated under `body.dark`; the harness asserts a contrast ratio >= 4.5
   (it measures 14.6) so this cannot regress silently.

4. **Coverage.** `institutions-in.js` is the single directory. It does not copy the curated lists —
   it reads whichever are loaded and merges them de-duplicated on normalised name+city, so the
   curated data keeps living in one file each (2,462 institutions after the merge). What it adds is
   the geography those lists lacked: every district headquarters of every state and UT, 1,241
   entries against the previous 184, with no state left empty.

**What "covered" is allowed to mean.** India has ~780 NMC medical colleges and on the order of
70,000 hospitals. No bundled list is ever complete, and a picker that silently lacks your hospital
is worse than one that admits it. So: cities are bounded public geography and are complete;
institutions are curated and are NOT claimed to be exhaustive; free text is a first-class answer
that is always offered; and what a doctor types is remembered on that device so the next colleague
at the same hospital finds it. That last part also shows the owner what the curated list is missing.

## 2026-09-25 — The India directory was in the build all along; three faults kept it from the app
Owner: *"we already have whole india college and hospital list, why isn't it universally available
in app."* They were right. `hospitals-in.js` has carried 2,405 curated institutions for a long time.
Three separate faults meant only two screens could ever reach it, and one of those was broken too.

**1. A GLOBAL NAME COLLISION, and it broke BOTH modules.** `hospital-registry.js` (the registry of
hospitals this doctor has CONNECTED: `list/get/register/setActive`) and `hospitals-in.js` (the
DIRECTORY of institutions in India: `all/search/byState/states`) both assigned
`window.SMD_HOSPITALS`. The registry loads on every page; the directory is lazy. Proven in the
running app:
  - before the directory loads, `SMD_HOSPITALS.search` is `undefined`, so every picker found nothing;
  - the moment it loads, `SMD_HOSPITALS.setActive` **disappears**, so `ghis-ward.js:334` silently
    stopped remembering the doctor's active hospital.
Each module broke the other, depending only on timing. The directory now owns
`SMD_HOSPITAL_DIRECTORY` and claims the legacy name only when nothing else holds it.

**2. `smdLazy` IS NOT DEFINED ON THE PAGE.** `lazy-load.js` is not among the scripts `index.html`
loads, yet `home.js`'s hospital picker and `profile-setup.js` both called the bare global. Both
threw ReferenceError inside their click handlers, so the picker never opened. This is the same
root cause as the "can't see and can't search college" report. **Never reach for a global the page
does not definitely define** — both call sites now load the script themselves.

**3. NO UNIVERSAL ENTRY POINT.** Reaching the list meant knowing three private details: which file
to lazy-load, which global it lands on, and that a different module owns that name. So only the two
screens whose authors happened to know all three could use it. `SMD_INSTITUTIONS.ensure()` is now
the one line any surface calls; `institutions-in.js` is tiny and loads with the app, and it pulls
the heavy data in itself.

**The lesson worth keeping:** "we already have the data" and "the app can use the data" are
different claims. A dataset reachable only through undocumented private knowledge is, from every
other screen's point of view, not there at all. The test that matters is not "does the file exist"
but "can a screen that knows nothing get it in one call".

## 2026-09-25 - Geometry and slice images are never overwritten in place
The Living CT 3D body failed on every native install without cached geometry from 2026-09-06 to
2026-09-25: re-meshed chunks were uploaded to R2 under the old filenames while the manifest that
matched them sat on an unmerged branch, and native builds check chunk sizes against their BUNDLED
manifest. Rule: 3D chunk filenames carry their content hash (`pack3d.mjs`, `bp3d_import.py`), and
2D slice images (served `immutable` for a year) are never rewritten; new stacks go under
`atlas/<id>/v2/`. Upload new R2 objects before shipping the build that names them; never delete
the old keys. Tests enforce both.

## 2026-09-25 - RadioAnatome shows radiological convention by flipping at display time
Files stay as the pipeline wrote them (the 3D cut planes texture the same images); `flipX`/`flipY`
in `modules.json` mirror at display time. Edge letters only where anatomy proves the side
(`docs/radioanatome/ORIENTATION.md`); no cadaver module asserts left/right. Clinical notes
(`atlas/notes.json`) ship ai_drafted behind `smd_atlas_notes` (default OFF), like CliniX/SURGX.
Shared 3D snapshots carry the CC BY credit inside the PNG, since CC BY 4.0 requires attribution on
redistribution; the on-screen rule (attribution only on the About screen) is unchanged.

## 2026-09-25 - Living neck CT: one command per TotalSegmentator subject, axes from anatomy
`ct-live-neck-*` (s0021, `ct neck`, contrast) and `ct-live-thorax-neck-*` (s0897, `ct thorax-neck`,
unenhanced) are built by `atlas-pipeline/tsd_living.py`, which measures each axis from the masks
(C2 vs T4; trachea vs cord; descending aorta, SVC, brachiocephalic trunk course and heart, compared
level by level) and re-indexes the CT into the torso convention before cutting, so every downstream
tool (orient, reformat, living.py proofs, flipX) is reused unchanged. Masks mapped to null are
dropped before the crop and slice pick: the first build spent 8 of 48 axial slices on the brain.
New canonical ids (trachea, thyroid, neck vessels, right upper lobe) are 2D only for now: listed in
`bp3d-map.json` `_pending_3d`, not mapped by name similarity. The 3D layer was out of scope.
