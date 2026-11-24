# PaperOrchestra upstream vendoring (Phase 3.7)

- Repository: https://github.com/google-research/paper-orchestra
- Commit: `d9bae997e793a015ed38bb1605be9eb58c00284f`
  (commit date 2026-11-15, "Merge pull request #4 from obrienciaran/fix/invalid-escape-sequences")
- Vendored: 2026-11-23, `git clone --depth 1`, copied byte-identical (verified with `diff -r`).
- Licence: Apache License 2.0, confirmed from the upstream `LICENSE` file
  ("Apache License, Version 2.0, January 2004"). Every source file carries the
  Google LLC Apache 2.0 header. There is NO `NOTICE` file in the upstream repo
  at this commit; `LICENSE` is vendored unchanged.
- Location: `backend/research/paperorchestra/upstream/`. Our code lives only in
  `backend/research/paperorchestra/adapter/` (package `po_adapter`).

## What was copied

All 53 source, prompt, template, doc and licence files, unchanged:
`autoraters/`, `methods/` (agents + prompts), `utils/`, `templates/cvpr2025/`,
`templates/iclr2025/`, `frontend/` (code only), `paper_writing_cli.py`,
`paper_writing_cli.sh`, `requirements.txt`, `README.md`, `LICENSE`,
`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `.gitignore`.

## What was skipped (and why)

- `.git/` (clone metadata).
- `assets/overview.png` (1.79 MB binary, README illustration).
- `frontend/examples/cvpr_example.json` and `frontend/examples/cvpr_example_figure.png`
  (example output manuscript and its figure; example outputs are excluded by the 3.7 brief).

No source file was edited, renamed or reformatted. The LaTeX templates are
vendored for clean merges but are NOT used by the adapter (plan section 8:
plots stay deterministic, output is IMRAD/Vancouver, DOCX in Phase 5A).

## Runtime dependencies

Upstream's `requirements.txt` is vendored for reference. The worker installs
only the subset needed to import the modules the adapter uses (see SEAMS.md):
`google-genai`, `requests`, `thefuzz`, `openai`, `opencv-python-headless`
(provides `cv2`; headless variant for the container), `PyMuPDF`, `pymupdf4llm`,
`numpy`, `rich`, plus `pydantic`, `pypdf`, `python-dotenv`, `httpx` already in
`backend/research/requirements*.txt`. Not installed (not imported by the
adapter): `streamlit`, `matplotlib`, `joblib`, `json_repair`, `pyOpenSSL`,
`tqdm` (needed only by `frontend/`, the plotting agent, `citation_f1.py`,
`lit_review_quality.py` and `paper_writer.py`; add them when 5A.4 enables
those autoraters).

## Merge procedure for upstream updates

1. `git clone --depth 1 https://github.com/google-research/paper-orchestra /tmp/po-update`
   (or `git fetch` in an existing clone); record the new commit SHA.
2. Diff against the vendored tree:
   `diff -r --exclude .git --exclude assets --exclude examples /tmp/po-update backend/research/paperorchestra/upstream`.
3. Re-copy with the same exclusions as the original vendoring:
   `rsync -a --delete --exclude '.git' --exclude 'assets/' --exclude 'frontend/examples/' /tmp/po-update/ backend/research/paperorchestra/upstream/`.
   `--delete` is safe because nothing of ours lives in `upstream/`.
4. Confirm the licence is still Apache 2.0 (`head LICENSE`); if it changed, STOP.
5. Update this file (SHA, date, skips) and re-read SEAMS.md: every seam lists
   exact upstream line numbers; a moved line means the seam patch table in
   `po_adapter/seams.py` must be re-verified.
6. Run `.venv/bin/python -m pytest -q` in `backend/research` (the `test_po_*`
   suite proves the seams still work without editing upstream).
7. Never patch files inside `upstream/`. All replacement happens at runtime in
   `po_adapter/seams.py` (module-attribute patching of the names each agent
   imported). If an update makes a seam impossible without editing upstream,
   record it in SEAMS.md and re-open decision D-5.
