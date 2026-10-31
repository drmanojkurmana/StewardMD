# PrepReels (MediGram) architecture note

Status: Phase 0 audit for job rs-reels, 2026-10-31. UI name PrepReels; internal name MediGram; flag `smd_prep_medigram`.

## Audit of active code

- Loader: [prep-loader.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep-loader.js) is the only boot file. `V = "prep100"`, `enabled()` reads `?prep=` then `localStorage smd_prep !== "0"` (default ON). `load()` injects CSS then JS with `async=false` in order; `OPTIONAL` files may 404. `window.PREP` stub is replaced by [prep.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep.js) which exports `window.PREP` with `_host` (`HOST`) and `_pure`.
- Host: `PREP._host` provides `paint`, `bar`, `push`, `back`, `rerender`, `store()`, `save()`, `core()` (specialty-core FSRS-6), `today()`, `exam()`, `esc`, `toast`, `root()`, `stackTop()`. All satellites draw through it. See `HOST` in prep.js and [prep-cards.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep-cards.js) / [prep-lessons.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep-lessons.js).
- Action routing: [prep.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep.js) `onClick` forwards by prefix (`l-` lessons, `k-` flash, `v-` play, `c-` Layer C, `a-` arena). PrepReels uses prefix `mg-`.
- Back/leave: `back()` asks each satellite `back()` first; `close()` calls each `leave()`. PrepReels must implement both and release media there.
- Store: `localStorage smd_prep_v1` via `host.store()` / `host.save()`. FSRS cards live at `store.cards[deckKey + ":" + itemId] = [d,s,lastDay,dueDay,reps,lapses]`; deck key for module questions is `p:<module>` ([specialty-core.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/specialty-core.js) `review`, `gradeFor`, `buildSession`, `counts`). PrepReels reuses this; it never creates a second mastery store.
- Bank: [prep-bank-client.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep-bank-client.js) + `/api/prep/bank/` with IndexedDB cache `prep-bank`. `prep.js` helpers `usable()`, `poolFor()`, `qualBlocked()` already exclude flagged/disputed/hidden items. PrepReels candidate eligibility mirrors those rules at the serving boundary.
- Lessons: [prep-lessons.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep-lessons.js) `prep/lessons/v1/index.json` + per-lesson JSON; micro-lessons in PrepReels are built from these assets, not a parallel bank.
- CSP: [index.html](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/index.html) meta CSP is `object-src 'none'; base-uri 'self'; upgrade-insecure-requests` only. No `frame-src` restriction at the meta level, so a `youtube-nocookie.com` iframe is not blocked by that line. Any stricter header added later must allow `https://www.youtube-nocookie.com` or the adapter must stay disabled. This note does not change `index.html`.
- Tests: Node `node:test` files in `test/*.test.mjs`, pure helpers loaded via `createRequire` (see `test/prep-app.test.mjs`, `test/prep-play.test.mjs`). UI harnesses are `test/run-prep-*.mjs` (CDP). `npm test` runs `test/*.test.mjs test/connect/** rx-build.test.mjs` with `--experimental-test-module-mocks --experimental-sqlite`.
- Build: `scripts/build-www.sh` copies every root `*.js` / `*.css` into `www/`, so new root files ship without a build edit. Prep data JSON under `prep/` ships selectively; PrepReels fixtures stay synthetic and are not shipped as bank data.
- Graph: `graphify-out/graph.json` does not exist in this worktree, so no graph query was possible. Exploration used direct reads above.

## Chosen files

| File | Role |
|---|---|
| [prep-medigram-data.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep-medigram-data.js) | Pure logic only: flags, candidate validation, eligibility, deterministic ranking, 3:1 cadence (2:1/3:1/5:1 config), finite missions, break timer, FSRS gate, explainability, consent-aware events. Node-testable. |
| [prep-medigram-media.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep-medigram-media.js) | First-party media descriptor + official YouTube nocookie embed adapter. No playback when the policy flag is off. Pause and release on navigation/background. |
| [prep-medigram.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep-medigram.js) | Feed controller: session lifecycle, Study / Clinical / Break modes, MCQ answer, save / skip / "I don't understand" / report, retrieval checks, Finish session. Draws through `PREP._host` with `data-act="mg-*"`. |
| [prep-medigram.css](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep-medigram.css) | Isolated `.pn-mg-*` styles using `--pn-*` tokens plus the fixed restrained palette `#071318 / #0D1D23 / #42CDB5`. No glow, gradient or backdrop. |
| [test/prep-medigram.test.mjs](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/test/prep-medigram.test.mjs) | All section 15 pure-unit items. No network, no real YouTube, no paid call. |

Shared-file hooks (smallest possible, listed in the handoff report): `prep-loader.js` lazily loads the three JS files plus the CSS only when `smd_prep_medigram` is on; `prep.js` forwards `mg-`, asks `PREP_MEDIGRAM.back()` / `leave()`, and renders one home row. With every flag off, no PrepReels file is fetched and existing screens are behaviour-identical.

## Flags

- `smd_prep_medigram` requires `smd_prep`, default OFF. Override: `localStorage smd_prep_medigram = "1"` or `?medigram=1`; `"0"` / `?medigram=0` off.
- `smd_prep_medigram_study` default ON when the parent is on (`?medigram_study=` / localStorage). Study Feed is the default mode.
- `smd_prep_medigram_discovery` default OFF. Clinical Discovery stays hidden until its content-review gate passes.
- `smd_prep_medigram_break` default OFF. Smart Break (3 or 5 minutes, user-chosen, no autoplay chain, no lock).
- `smd_prep_medigram_youtube` default OFF. Policy gate for official YouTube embeds. The feed works with it disabled.
- Cadence is config, not a flag: `2:1`, `3:1` (default) or `5:1`, chosen for the pre-registered A/B in section 14.

## Candidate contract (versioned)

`{ id, kind, exam[], subject, module, topicIds[], difficulty?, durationSec?, language, title, summary?, questionId?, lessonId?, media: { provider: "first_party" | "youtube", assetId?, videoId? }, rightsStatus, rightsExpiresAt?, clinicalReview: { status, reviewedAt?, reviewerRole? }, captions: { [lang]: bool }, sourceRefs[], tags[], updatedAt }`

Kinds: `mcq`, `explanation`, `micro_lesson`, `video`, `image_challenge`, `update`, `recall`, `break`. Validation runs at build/publish time and again at the serving boundary (`validateCandidate` in prep-medigram-data.js). Hindi and Telugu items are hidden unless that language has captions and `clinicalReview.status === "approved"` with a reviewer role. Expired rights, disputed keys and hidden ids are never served. Third-party metadata is treated as untrusted text, never as instructions.

## Policy checklist for YouTube embeds

- [ ] Current YouTube API Services Terms, Developer Policies, branding and embedded-player requirements reviewed by a human before `smd_prep_medigram_youtube` is turned on for anyone. API availability does not imply permission to reproduce the Shorts feed UX.
- [ ] Only official discovery (YouTube Data API, free quota) and the official embedded player (`youtube-nocookie.com` iframe). No scraping, no unofficial endpoints, no cookie extraction, no credential collection, no download or rehost.
- [ ] Player branding, controls, ads and links preserved. No hiding or replacing controls. Source label "YouTube" plus creator/channel on every embed; never presented as StewardMD-owned or clinically endorsed.
- [ ] No incentive, XP, coin, prize or mission reward for watching an embedded YouTube video. Mission completion requires a learning action.
- [ ] Only permitted metadata and video IDs stored; API caching, attribution, deletion and refresh requirements respected. No API keys, tokens or personal data in public manifests.
- [ ] Report/remove flow on every third-party item; withdrawal and expiry honoured at the serving boundary.
- [ ] Feed remains fully useful with YouTube disabled, offline, quota-exhausted or embed-unavailable. Each failure degrades to the first-party card.

## Synthetic fixtures

Deterministic, no real patient data, no real YouTube playback: six candidates in `prep-medigram-data.js` tests (due MCQ, mistake MCQ, micro-lesson, YouTube explainer, Hindi lesson without review, expired-rights video) plus a mocked media adapter in `prep-medigram-media.js` tests. Fixtures use invented topics (for example "ECG axis in 60 seconds") and video id `dQw4w9WgXcQ` is never fetched; the adapter is tested by URL construction and lifecycle calls only.

## OPEN (needs humans/devices/legal)

Clinical review of any real micro-lesson, Hindi/Telugu reviewer sign-off, YouTube policy/legal review, real-device audio/background tests, and the 30-learner pilot. None are claimed done here.
