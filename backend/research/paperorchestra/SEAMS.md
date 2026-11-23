# PaperOrchestra adapter seams (Phase 3.7 spike, decision D-5)

Upstream commit `d9bae997e793a015ed38bb1605be9eb58c00284f` (see UPSTREAM.md).
All line numbers below refer to that commit. **Upstream lines that need
changing: ZERO.** Every seam is replaced at runtime by `po_adapter/seams.py`
(`install()` patches the names each upstream module imported; `uninstall()`
restores them). The end-to-end tests hash every upstream `.py` file before and
after a run and assert nothing changed.

Why patching works: upstream agents import their LLM/search functions BY NAME
(`from utils.gemini_utils import call_gemini_with_contents`), so each agent
module holds its own binding. Patching `utils.gemini_utils` alone would not
reach them; `seams.install` patches every binding site (24 patches, table
below). No file in `upstream/` is edited, and none needs to be.

## Seam 1: LLM client

| Upstream | Location | What it does |
|---|---|---|
| `utils.gemini_utils.get_genai_client` | gemini_utils.py:36-68 | builds a Gemini client from `GEMINI_API_KEY` / Vertex env |
| `utils.gemini_utils.call_gemini_with_contents` | gemini_utils.py:158-224 | the core call; returns `{"raw_response", "parsed_response"}`; 5 retries |
| `utils.gemini_utils.call_gemini_with_text_prompt` | gemini_utils.py:227-245 | wraps contents |
| `utils.gemini_utils.call_gemini_with_images` | gemini_utils.py:248-277 | raster images to vision |
| `utils.openai_utils.get_openai_client` | openai_utils.py:34-48 | OpenAI client from `OPENAI_API_KEY` |
| `utils.llm_backend_utils.call_llm_with_text_prompt` | llm_backend_utils.py:53-102 | routes GPT/O1/O3 names to OpenAI, else Gemini |
| `utils.llm_backend_utils.call_llm_with_images` | llm_backend_utils.py:105-161 | same, with images |
| `utils.llm_backend_utils.call_llm_with_pdf` | llm_backend_utils.py:164-222 | raw PDF bytes to Gemini |
| Bound copies | outline_agent.py:16, literature_review_agent.py:28, section_writing_agent.py:37, content_refinement_agent.py:22-26, agent_review.py:19, content_parsing_utils.py:15, pdf_utils.py:133 (function-local import) | each importer's own name |

Adapter: `po_adapter/llm.py` `GatewayLLMClient`. Same signatures, same
`{"raw_response", "parsed_response"}` return shape, same default JSON parser
(reuses upstream `parse_gemini_json_results`, gemini_utils.py:71-114). Every
call goes to `RESEARCH_GATEWAY_URL` with a per-job bearer token
(`RESEARCH_JOB_TOKEN`); no provider key is read or held. `get_genai_client`
and `get_openai_client` are patched to raise, so a missed binding fails loud
instead of reaching a provider. Before every request: `phi.scan` on the exact
assembled text (system instruction included), then the ceilings (below).
`google_search` tools in `generation_configs` are stripped (the gateway has
no such tool); temperature is owned by the gateway per tier. Binary content
parts are refused except the `application/pdf` text stand-in (seam 6).
Image inputs raise `gateway_text_only` (figures are deterministic, plan 8).

Ceilings enforced (contracts/phase-3/ceilings.md, frozen defaults in
`llm.TIER_CEILINGS`): T1 8000/2000 tokens, 2 retries, 1 refinement round;
T2 16000/4000, 2/2; T3 24000/4000, 1/1. Input cap checked pre-call on a
deterministic chars/4 estimate; output cap checked on the gateway's actual
usage; retries capped per tier; refinement rounds counted per call with
`purpose="refinement"`. Plus an adapter-local `max_calls` guard (default 64
per job): ceilings.md has no per-job call-count row, so this is a new adapter
guard, NOT a contract number; propose adding it to ceilings.md in 3.5.
Token usage recorded per call (`client.usage`: jobId, projectId, userId,
tier, model requested/used, purpose, input/output tokens, ts) for the
callback and credit settlement.

Gateway wire shape (proposal for the 3.5 gateway adapter, which does not
exist yet): POST `{jobId, projectId, userId, tier, model, system, prompt,
maxOutputTokens, purpose}` -> `{text, model, usage:{inputTokens,
outputTokens}}`. The mock in `tests/test_po_common.py` implements exactly
this.

## Seam 2: literature search

| Upstream | Location | What it does |
|---|---|---|
| `utils.scholar_utils.s2_title_search` | scholar_utils.py:34-100 | Semantic Scholar title search, fuzzy match > 70 (+10 year hint), cutoff filter |
| module import side effects | scholar_utils.py:25-28 | loads `.env`, reads `SEMANTIC_SCHOLAR_API_KEY`, PRINTS it |
| bound copy | literature_review_agent.py:29, used at :338 | enrichment of LLM-discovered candidates |
| discovery call | literature_review_agent.py:464-471 | Gemini with `google_search` tool, hardcoded `gemini-3-flash-preview` |

Adapter: `po_adapter/search.py` `ConnectorSearch`. `s2_title_search(title_query,
year_hint, cutoff_date)` keeps upstream's signature, fuzzy thresholds and
cutoff semantics, but calls OUR API (`RESEARCH_API_URL`), which runs the
Phase 2.3 connectors (PubMed, Europe PMC, Crossref; S2 only if terms allow).
Signed exactly like the callback contract: `X-Research-Timestamp` +
`X-Research-Signature` = HMAC-SHA256(`RESEARCH_CALLBACK_SECRET`, timestamp +
"." + rawBody), reusing `research_worker.jobs.sign_callback` (the callback
test vector reproduces in CI). Returns upstream's expected S2 record shape
PLUS `externalIds`/`doi`/`pmid`. Upstream `PaperData` drops unknown keys, so
identifiers are also kept in `search.identifiers` (normalised title -> ids)
and injected into `citation_map.json` by a wrapper on
`HybridLiteratureAgent._generate_citation_map` (literature_review_agent.py:570-582),
which is what the citation gate resolves against.

PENDING (another builder owns functions/**): the API endpoint
`POST /api/research/v1/internal/literature-search` does not exist yet. Shape
is documented in search.py; it must verify the HMAC before parsing and return
records in the Phase 2 normalised shape plus `abstract`, `publicationDate`,
`venue` when the database has them. Note: PubMed esummary carries NO abstract,
and upstream drops papers without one (literature_review_agent.py:344-345),
so the endpoint must fetch abstracts (efetch / Europe PMC core) or the
suggester will enrich very little.

Import side effect to know: scholar_utils.py:28 prints the S2 key env value at
import. The worker never sets that env, so it prints `None`; never set a
provider key in the worker. Discovery candidates from the LLM are unverified
suggestions (plan 3.7: suggester into screening); only connector-enriched
records with DOI/PMID enter the citation library.

## Seam 3: input loader

| Upstream | Location | What it does |
|---|---|---|
| `utils.common_utils.load_md_file` | common_utils.py:44-54 | reads idea.md / experimental_log.md / template.tex / guidelines.md |
| consumed by | outline_agent.py:42-49, literature_review_agent.py:596-604, section_writing_agent.py:132-136, content_refinement_agent.py:213-217 | file-based inputs |

Adapter: `po_adapter/loader.py` `build_inputs(manifest, workdir)`. No upstream
patch needed: the loader writes the files upstream reads. Builds idea.md
(protocol + PICO + verified evidence with locator and quote per value, plus
human-verified RoB judgments and GRADE certainty rows), experimental_log.md
(analysis runs as `{{run:<runId>.<fieldPath>}}` tokens with engine name/version),
an adapter-authored IMRAD template.tex and guidelines.md (NOT the vendored
CVPR/ICLR templates), figures/info.json = [] (plots deterministic). REFUSES:
unverified extraction values (`unverified_value`), unverified RoB judgments
(`unverified_rob`), missing locator/quote (`missing_provenance`), unlocked
protocol (`protocol_unlocked`), invalid GRADE certainty (`invalid_grade`),
malformed runs/manifest. Token table written to workdir/token_table.json for
gates and writer.

Token format drift RESOLVED (Phase 5A): the canonical format is the plan's dot
form `{{run:<id>.<field>}}`, written down in
`docs/research/contracts/phase-5/tokens.md`. The 3.7 colon form
`{{run:<runId>:<path>}}` is retired; gates flag it `malformed_token` and strict
rendering raises `UnresolvedTokenError`. Loader, gates, writer, the manuscript
renderer and version lock all use dot keys.

## Seam 4: output writer

| Upstream | Location | What it does |
|---|---|---|
| `SectionWritingAgent.run` write | section_writing_agent.py:214-215 | writes full LaTeX draft |
| `HybridLiteratureAgent._save_outputs` | literature_review_agent.py:584-594 | updated_template.tex, references.bib, citation_map.json, outline_v1.json |
| `methods.paper_writer.write_single_paper` | paper_writer.py:33-200 | orchestrator: copies LaTeX templates, compiles final PDF |

Adapter: `po_adapter/writer.py`. Upstream agents still run and write their
files (unchanged); the adapter then parses the draft LaTeX deterministically
(`parse_latex_sections`) into a JSON manuscript model: IMRAD sections,
Vancouver references numbered by first citation, tokens kept canonical,
provenance (protocol hash, run ids, engine versions, upstream commit).
`render_tokens` is the deterministic preview renderer. `write_single_paper`
is NOT used (it is the LaTeX/PDF orchestrator); `po_adapter/pipeline.py`
drives the agents directly. DOCX export is Phase 5A, deliberately absent.
The LaTeX comment character is NOT stripped before gating: deleting text
could hide numbers from the integrity gates.

## Seam 5: autoraters

| Upstream | Location | What it does |
|---|---|---|
| `autoraters.agent_review.perform_review_agentreview` | agent_review.py:112-181 | 3-reviewer ensemble + meta-review, score averaging |
| `get_meta_review` | agent_review.py:190-211 | area-chair aggregation |
| LLM binding | agent_review.py:19 | `call_gemini_with_text_prompt` |
| not imported by adapter | citation_f1.py, lit_review_quality.py, sxs_*.py | need tqdm/joblib; enable in 5A.4 |

Adapter: the LLM binding is patched to the gateway client (purpose
`review`), and `content_refinement_agent.perform_review_agentreview` (bound
at content_refinement_agent.py:28) is wrapped: **hard gates run on the draft
BEFORE any reviewer call** (`gates.check_paper`). On violation the wrapper
raises `GateError`; upstream's `_get_peer_review` catches it and scores 0,
so the loop keeps refining, and the violations are recorded in
`gate_context["gate_hits"]`. The pipeline additionally runs `gates.enforce`
on the FINAL draft: any violation fails the job (`gate_failed`), partial
work is never returned. Cost note: one review = 4 gateway calls (3 ensemble
+ 1 meta); measure in 5A.4.

## Seam 6: refinement loop

| Upstream | Location | What it does |
|---|---|---|
| `ContentRefinementAgent.run` | content_refinement_agent.py:201-593 | compile -> review -> refine loop, score-gain acceptance, formatting loop |
| `compile_latex` calls | content_refinement_agent.py:228, 320, 546, 588 | pdflatex + bibtex subprocesses (pdf_utils.py:169-232) |
| `load_paper` | content_refinement_agent.py:88 (pdf_utils.py:31-50) | PDF text extraction for the reviewer |
| `pdf_to_grid_images` | content_refinement_agent.py:239, 332, 455 (pdf_utils.py:235-293) | page screenshots for vision |
| refinement LLM call | content_refinement_agent.py:293-303 | sends compiled PDF bytes + prompt, expects json worklog + latex |
| formatting review/fix | content_refinement_agent.py:165-169, 520-527 | vision review, latex fix |
| `max_reflections` | constructor :42, loop :249 | upstream default 3 |

Adapter: three text stand-ins replace the LaTeX/PDF machinery, all patched
bindings, zero upstream edits:
- `compile_latex(cwd, pdf_file, texfile_name)` writes the `.tex` TEXT to the
  `.pdf` path (no pdflatex binary needed in the container).
- `load_paper` reads that text back for the reviewer.
- `pdf_to_grid_images` returns `[]` (formatting vision is skipped; the
  formatting review call then sees no images and reports no issues).
The refinement LLM call's PDF part is decoded as UTF-8 text by the gateway
client (it is our stand-in, never a real PDF). Round counting: the wrapper
marks calls `purpose="refinement"` only when `result_parsing_func` is
upstream's `parse_gemini_json_latex_response` (the content loop); the
formatting loop's lambda is `purpose="format"` and does not consume rounds.
The pipeline ALSO clamps `max_reflections` to the tier ceiling at
construction, so a runaway loop is stopped twice over (test:
`test_runaway_upstream_refinement_loop_is_clamped`, max_reflections=99 -> 2).

## Hard gates (plan sections 8, 12)

`po_adapter/gates.py`, run before any autorater score and on the final draft:
1. numbers: every number in Abstract/Results is a `{{run:...}}` token;
   allowed bare numbers: years, reviewer counts, stated thresholds (incl.
   90/95/99% CI labels, heterogeneity cutoffs). Unknown tokens fail anywhere.
2. citations: every `\cite{key}`/`[@key]` resolves to a DOI or PMID present
   in the manifest (references or evidence sources).
3. claim links: every claim sentence in Abstract/Results/Discussion carries
   a run token or a citation.
4. direction/significance: "reduced" needs estimate < null, "increased" >
   null (null 1 for OR/RR/HR, 0 for MD/RD); "significant" needs a CI
   excluding the null; "not significant" needs it crossing.

## D-5 recommendation: ADAPTER (keep PaperOrchestra), with conditions

Evidence the seams work without editing upstream (all in tests/test_po_*):
- `test_outline_step_end_to_end_with_mocked_llm`: upstream OutlineAgent runs
  end to end on ResearchMD inputs, writes its own outline.json, one
  authenticated gateway call, upstream file hashes unchanged.
- `test_full_manuscript_chain_with_mocked_llm`: outline -> section writing ->
  gated refinement -> JSON manuscript, all upstream agents unedited.
- `test_literature_suggester_uses_our_connectors`: discovery -> connector
  enrichment (signed API call, no Semantic Scholar) -> citation map with
  DOI/PMID -> manuscript.
- `test_runaway_upstream_refinement_loop_is_clamped` and the ceiling tests:
  token/retry/round/call caps stop runaway loops.
- `test_gate_violation_blocks_autorater_score`: gates block scoring.

Conditions / costs to accept with the adapter route:
1. Import-time deps are heavy: google-genai, openai, cv2, PyMuPDF,
   pymupdf4llm, numpy, rich, requests, thefuzz must be installed even though
   the provider paths are disabled (upstream imports them at module load).
   Container image grows accordingly; opencv-python-headless avoids GUI libs.
2. Upstream prompts are AI-conference shaped (CVPR/ICLR skeletons,
   double-blind anonymity, "no prior knowledge" in prompt_utils.py). The
   adapter feeds its own IMRAD guidelines.md, but the system prompts stay
   upstream's. Clinical quality is a 5A measurement (plan 8); if the
   anonymity/no-leakage clauses fight medical authorship, the fallback is
   prompts-only (D-5) for the writing steps while keeping the agent loop.
3. The literature-search API endpoint and the gateway wire shape are
   proposals pending the 3.5/API builders (functions/** is another package).
4. scholar_utils.py:28 prints the S2 key env at import (None in the worker).
5. Token format drift (dot vs colon) RESOLVED in Phase 5A: canonical dot form,
   `docs/research/contracts/phase-5/tokens.md`; colon form rejected.

If any of these proves blocking in 5A, the prompts-only fallback is cheap:
the prompts live in `methods/prompts/*` and `autoraters/prompts/*` and the
adapter already owns the loop, gates, loader and writer.

## Uncertainties (flagged, not resolved here)

- PHI stub implements the literal contract rules; the patient-name rule
  (capitalized bigram within 40 chars of a patient label) can false-positive
  on place names next to clinical verbs. The <2% clean-set gate is measured
  on the 25-PDF set in 3.9, not here. Synthetic set in test_po_phi.py is 18
  cases, not the full 200 (3.9 benchmark owns those).
- `max_calls=64` is an adapter guard, not a ceilings.md row.
- Token estimate chars/4 is deterministic but approximate; the gateway's
  actual usage is authoritative and is what gets recorded.
- The internal search endpoint must supply abstracts (PubMed esummary has
  none) or upstream's enrichment drops most candidates.
- Upstream `time.sleep(1.0)` per enrichment query (literature_review_agent.py:206)
  is real wall time in the worker; tests monkeypatch it.
