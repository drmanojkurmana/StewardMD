# design-guide v0.1.4

`v0.1.4` polishes the rebrand — fixing the last remaining old-named identifier and aligning metadata.

## What Changed

- **HTTP header**: `X-F-Design-Token` → `X-Design-Guide-Token` in preview server.
- **Release date**: `design-guide.json` metadata updated.

## Upgrade

```bash
git pull --ff-only
bash scripts/sync-aide.sh
python3 scripts/design-guide-doctor.py --strict
```


# design-guide v0.1.3

`v0.1.3` completes the full rebrand from `f-design` to `design-guide` — code, config, repositories, and all.

## What Changed

- **Environment variables**: `F_DESIGN_*` → `DESIGN_GUIDE_*` everywhere.
- **Internal identifiers**: module names, markers, test fixtures all updated.
- **GitHub repo**: `GrubbyLee/f-design` → `GrubbyLee/design-guide`.
- **Gitee mirror**: `synovation/f-design` → `synovation/design-guide`.
- **ClawHub skill**: `f-design` → `design-guide` (old slug redirects).

## Upgrade

```bash
git pull --ff-only
bash scripts/sync-aide.sh
python3 scripts/design-guide-doctor.py --strict
```


# design-guide v0.1.2

`v0.1.2` is a naming-consistency patch release that aligns the display name, configuration directory, and all documentation with the `design-guide` rebrand.

## What Changed

- **Display name**: "F Design" → "Design Guide" in SKILL.md title (fixes ClawHub skill card name).
- **Config directory**: `.design-guide/` is now the only project preference path across all references.
- **Manifest**: `design-guide.json` version bumped to `0.1.2`.

## Upgrade

```bash
git pull --ff-only
bash scripts/sync-aide.sh
python3 scripts/design-guide-doctor.py --strict
```


# design-guide v0.1.1

`v0.1.1` is a patch release for the frontend design and production engineering orchestrator.

## Release Outcome

The `v0.1.0` workflow remains intact, with release-integrity fixes:

```text
project context -> design depth -> review artifact -> user approval
-> executable contract -> implementation -> production QA
```

It also adds a diagnostic workflow for existing product/page designs and closes a serious context-isolation gap: a review may no longer silently inherit mobile, publishing, implementation, or other side goals from earlier conversation turns.

## Highlights

- Review artifacts must be opened, attached, or exposed through an immediately usable link before confirmation.
- Approved Level 2 designs become machine-validated contracts.
- Existing designs receive mode-aware, evidence-backed findings and actionable acceptance criteria.
- Strict browser QA covers flows, states, breakpoints, console errors, overflow, axe, visual diffs, metrics, and optional Lighthouse budgets.
- Codex, Claude Code, Cursor, and Qwen Code mirrors are synchronized by public-file digest and diagnosed with a single command.
- Specialized review templates cover operational UI where generic landing-page heuristics are insufficient.
- Tag synchronization cannot move the Gitee `main` branch.
- Secret scanning covers non-Git source directories and does not exempt entire files.
- Version sources are checked for consistency before synchronization or provider smoke tests.

## Upgrade

```bash
git pull --ff-only
bash scripts/sync-aide.sh
python3 scripts/design-guide-doctor.py --strict
```

Reload each AIDE after synchronization if it caches discovered skills.

## Verification

```bash
python3 -m unittest discover -s tests -v
python3 scripts/verify-product-journeys.py
python3 scripts/check-secrets.py .
```

The GitHub `Validate` workflow additionally runs the strict Playwright browser-quality fixture.
