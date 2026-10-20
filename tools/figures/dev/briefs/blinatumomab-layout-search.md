# Blinatumomab scene and user-reported UI fixes

Work in `/Users/mkk/Developer/StewardMD`, on the current task branch. Do not commit, push, merge, or publish. Preserve all unrelated working-tree content, especially existing untracked organ artwork.

## 1. Build a dedicated blinatumomab mechanism scene

First inspect the current scene generator, registry, drug lookup, OncQis, and tests. There is no existing blinatumomab scene in `prep/figures/figures.json` or the figure specs. Build and register `blinatumomab-mechanism-adverse-effects` using the established `tools/figures/scenes/` pattern, generated dark/light pages, `prep/figures/figures.json`, and mechanism mastery data.

Make the figure easy for a first-year medical student to understand at a glance:
- Draw a malignant B-cell with CD19 and a T-cell with CD3. Show the two binding ends of blinatumomab bridging them, bringing them together into an immune synapse; then show T-cell granzyme/perforin killing the B-cell.
- Include normal CD19-positive B cells as the on-target collateral, and show how their depletion can reduce antibody production and raise infection risk.
- Show cytokine release syndrome as activated T cells releasing inflammatory cytokines into blood, producing systemic inflammation. Show neurotoxicity/ICANS as a serious associated toxicity, while explicitly stating that its mechanism is not fully understood; do not invent a direct causal brain pathway.
- Provide a small number of clear states: no drug, blinatumomab engaged, and management state. The management state can communicate that severe CRS/neurologic toxicity requires clinical treatment and possible interruption; do not suggest that tocilizumab prevents ICANS or that rescue preserves efficacy in every patient.
- Animate the binding, synapse, cytotoxic granules and changing tumour/B-cell/toxicity readouts. Add short tap/hover explanations to labelled parts. Keep labels sparse, legible, responsive, and the drawing within the viewport.
- Add the registry drug key `blinatumomab` so the existing drug database and OncQis integration expose it automatically. Include generic/brand aliases, accurate key terms, concise Trigger/Target/Mechanism/Manifestation/Intervention plus adverse-effect mastery.
- Use citations in the sources footer. FDA BLINCYTO prescribing information (2024): `https://www.accessdata.fda.gov/drugsatfda_docs/label/2024/125557Orig1s028Correctedlbl.pdf`. Its mechanism section says it binds CD19 on B-lineage cells and CD3 on T cells, forms an immune synapse, promotes cytolytic proteins and cytokines, and redirects lysis of CD19-positive cells. The label carries boxed warnings for CRS and neurological toxicities including ICANS. Keep AI-assisted review markings consistent with neighboring scenes.

## 2. Fix figure viewer clipping shown in photos 1 and 2

The figure's right-hand controls/readout panel is clipped off-screen in landscape iPad screenshots. Inspect `fig-viewer.js` `LAY_CSS`, iframe sizing and the ALL/CML scenes. Fix the underlying sizing/layout issue for landscape tablets and desktop. At minimum, grid columns and all grid items must fit the iframe viewport; set robust `min-width:0`, use a bounded responsive dock width, and preserve readable controls/readouts. Keep a usable one-screen layout on mobile portrait too, with intentional vertical scrolling only when content genuinely exceeds available height. Verify at 1024x768, 1180x820, 1280x960, and 390x844 if the available browser tooling allows. Do not hide the treatment controls or explanation panel.

## 3. Fix the empty question-search skeleton shown in photo 3

In `prep.js` `runFind()` and the per-subject `paintQ()` completion path, the `pn-load` class is left on the status node after its text changes. The CSS renders skeleton bars via `.pn-load::before/after`, so users see grey skeletons even after the status says questions need a connection. On completion remove loading styling/decoration and show a clear, accessible final state. If all subjects failed, offer an explicit retry action that reruns the current query; if some failed, show hits plus a clear partial-availability message and retry option. Retrying must invalidate prior async work to prevent stale results from overwriting the new query. Retain a normal no-matches state when subjects were searched successfully.

## Verification

- Run the focused figure registry, mastery, and font tests plus the directly relevant PrepNucleus/search UI tests discovered in the repository. Add focused regression tests for finished question search not retaining skeleton styling, partial/all failure retry state, the new registry key, and the responsive CSS constraints where the existing test conventions support them.
- Run the scene verifier for blinatumomab and report any warning.
- Ensure registry and mastery changes are valid and complete. Leave all changes uncommitted for review and summarize exactly which files changed and what tests passed.

## Follow-up accuracy correction

After the first implementation, review the third treatment state in `blina.mjs`/`blina.page.js`. Do not portray tumour killing as guaranteed to continue while the infusion is paused for toxicity. Rename that state to an explicit pause/clinical toxicity management state, stop new CD19-CD3 bridging and ongoing killing in that state, and keep only a qualitative, persistent tumour-burden readout while cytokine/neurotoxicity readouts ease. Update captions, compare labels, mastery and tests so they do not imply that rescue preserves antileukaemic efficacy. Keep uncertainty about ICANS mechanism explicit.
