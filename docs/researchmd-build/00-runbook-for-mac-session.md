# ResearchMD on-device build: runbook for the Mac session

These files are on branch `rmd-build-briefs` in `docs/researchmd-build/`. Read them without switching your current worktree: `git fetch origin rmd-build-briefs`, then `git show origin/rmd-build-briefs:docs/researchmd-build/<file>` (this runbook, then 01-ocr.md to 05-background.md). Phase branches start from origin/main as below, so these docs never land in the feature branches. When a step says "the phase brief", give agy that file's full text.

**Run all five phases back to back, without stopping to ask anyone.** Manoj is asleep for about 5 hours (from 08:20 UTC, 27 Nov) and wants all five done and pushed by then, one branch per phase. Do not wait for replies between phases.

Manoj's instructions (27 Nov 2026): build the ResearchMD on-device plan with Gemini Hydrogen writing the code, Claude as orchestrator, Gemini Hydrogen through the agy CLI on all four agy accounts, and Claude Opus 5.5 on agy account 4 as reviewer. A cloud Claude thread wrote these briefs and will do the final review and open the pull requests from the branches you push.

## Your job (the Mac Claude session)
You run agy. You do not write the feature code yourself. For each phase, in order 01, 02, 03, 04, 05:

1. **Worktree and branch.** Leave your current worktree (prep-intro-clips) untouched. Phases are stacked, each on the one before:
   - 01: `git fetch origin main && git worktree add -b rmd-od-1-ocr ../StewardMD-rmd-od origin/main`
   - 02 to 05: in `../StewardMD-rmd-od`, `git checkout -b rmd-od-2-stats` (then `rmd-od-3-drafts`, `rmd-od-4-fallback`, `rmd-od-5-background`) from the previous phase's committed branch.
2. **Write step (Gemini Hydrogen).** Run agy in that worktree with the Gemini Hydrogen model and the phase brief as the prompt, effort high. Check `agy --help` for the flags that pick the account and the model; do not guess them. Accounts: phase 01 on account 1, 02 on account 2, 03 on account 3, 04 on account 1, 05 on account 2. If an account hits its Gemini Hydrogen limit, rerun on the next account (1, 2, 3, 4, then back to 1). Never fall back to a different model for writing.
3. **Review step (Claude Opus 5.5, agy account 4).** Run agy on account 4 with model Claude Opus 5.5 and this prompt: "You are reviewing a change in this worktree (git diff against the phase's base branch). Read the brief at <paste brief>. Check: it does what the brief asks and nothing else; ES5 only in app files; no em or en dashes in app-facing text; no secrets or patient data in code, logs or URLs; every new behaviour ON by default with its flag only as a kill switch; error paths fall back exactly as the brief says; tests cover the brief's list and actually assert. Write findings to REVIEW.md in the worktree root as a numbered list, each with file:line, severity (blocker, should-fix, nit) and the fix. Do not edit any other file."
4. **Fix step.** If REVIEW.md has blockers or should-fix items, rerun the write step (same account as step 2) with: "Fix every blocker and should-fix item in REVIEW.md. Edit only files the brief lists." Then review again. At most 2 review rounds. Delete REVIEW.md before committing, but paste its last version into the commit message body.
5. **Tests (you run them, not agy).** Run the phase's test commands from its brief, plus the full suite once: `npm test`. Paste the outputs at the end of your report. A failing test from the brief blocks the commit: send it back to the write step once with the failure output; if it still fails, commit anyway with "TESTS FAILING" at the top of the commit message and say so in your report.
6. **Commit and push.** Stage only the files the brief lists (explicit `git add <file>`, never `git add -A`). Commit message: `rmd-od phase N: <title>` with the agy model strings and account numbers used for writing and review. Push: `git push -u origin <branch>`.
7. **Do not** open a pull request, merge, push to main, deploy (no wrangler deploy, no cap sync to devices), or touch the research container. The cloud thread opens the PRs after its own review.

## Blockers (Manoj is asleep: write them in your report, don't work around them)
If a blocker below hits one phase, record it, push what is committed, and carry on with the next phase on top of the last pushed branch where that still makes sense. Stop entirely only when agy itself can't run. Cases:
- agy can't be spawned or is refused by the permission system (a past note in vault/decisions/Decisions.md says auto mode once refused agy from a background session; the fix is Manoj adding a Bash permission rule, which is his call).
- All four accounts are out of Gemini Hydrogen usage.
- A brief asks for something that conflicts with what you see in the code (report the conflict, don't improvise).

## Report after each phase (in your own chat, to Manoj)
Branch, commit SHA, agy model string and account for write and review, number of review rounds, last REVIEW.md items left open, test outputs. The cloud thread fetches the branch from GitHub.

## Shared rules for every phase (agy reads these in each brief too)
- Read CLAUDE.md and vault/modules/ResearchMD.md first. StewardMD is a mobile app only (iPhone, iPad, Mac, Android); never call it a web app.
- App files are ES5 IIFEs (no let, const, arrow functions, classes, template strings). Server files under functions/ are ES modules as they already are.
- No em or en dashes in app-facing text. No secrets, no patient data in code, tests, logs or URLs.
- Every new behaviour is ON by default. Its flag is only a kill switch, read as on unless localStorage holds "0".
- New app scripts get a `<script ... defer>` tag in index.html with a `?v=` token and must be copied by scripts/build-www.sh.
- Edit only the files the brief lists; if another file truly must change, say so in a NOTE at the end of your output instead of changing it.
