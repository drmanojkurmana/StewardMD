# ECC Adoption Plan — Selective Inheritance for StewardMD
_Date: 2026-07-25 · Reference repo: `affaan-m/ECC` ("Everything Claude Code"), cloned read-only to `~/Developer/ECC`. **Nothing from ECC is installed, sourced, or activated.** This document adapts *concepts* only._

## 1. Executive Summary

ECC is a large, general-purpose agent-tooling collection (reviewer agents, review slash-commands, orchestration workflows, prompt-defense patterns, release/security scripts) plus a great deal of install machinery (12+ per-harness config trees, MCP servers, hooks, npm packages, a GitHub App). **~90% of ECC is irrelevant or inappropriate for StewardMD**; a thin, high-value slice is worth *re-implementing natively*: the **reviewer-agent pattern**, a **multi-reviewer PR workflow**, a **prompt-defense baseline**, and **release/security checklists**.

The single best fit is ECC's *specialized reviewer agent* format — a role with a tight scope, severity-tiered checklist, "when invoked" commands, and a confidence-gated output. StewardMD is a clinical iOS app (Capacitor hybrid + native Watch + AI/ML backend), so we recreate that pattern as **10 StewardMD-specific reviewer roles** tailored to *our* stack and clinical-safety obligations — self-contained in this repo, no external dependencies. ECC's healthcare-reviewer and swift-reviewer were the most instructive references.

**Deliverables produced now:** this plan, a `docs/dev-framework/` (PR-review workflow + release checklist + CI notes), and 10 project-scoped reviewer agents in `.claude/agents/`. Nothing global, no MCP, no hooks, no npm, no scripts executed.

## 2. High-Value Components to Inherit (adapt, don't copy)

| # | ECC concept | StewardMD adaptation |
|---|---|---|
| H1 | Specialized **reviewer agents** (scope + severity tiers + checklist + when-invoked cmds) | 10 StewardMD reviewer roles (§ Additional Requirement) in `.claude/agents/` |
| H2 | `healthcare-reviewer` (CDSS accuracy, PHI, no-false-negatives, non-dismissable alerts) | **StewardMD Clinical Workflow Reviewer** — the crown jewel; tied to our engines/golden outputs |
| H3 | `swift-reviewer` (force-unwrap, concurrency, ARC, Keychain) | **StewardMD iOS Reviewer** + **SwiftUI Reviewer** for native shell/plugins/Watch app |
| H4 | `/review-pr` multi-agent orchestration + confidence≥80, severity-grouped output | `docs/dev-framework/pr-review.md` workflow (uses our reviewers; no new tooling) |
| H5 | **Prompt Defense Baseline** (resist role-override, injection, untrusted content) | A short shared baseline block prepended to each StewardMD reviewer (relevant for MaiK/LLM features) |
| H6 | `security-scan` / OWASP-style pattern table | **StewardMD Security Reviewer** — mobile+clinical (Keychain/ATS/DPDP/Firestore rules/gate tokens) |
| H7 | **Release checklist / approval-gate** concept | `docs/dev-framework/release-checklist.md` — App Store + our deploy gotchas (25 MiB file, native rebuild, flags, golden regression) |
| H8 | Docs-generation / doc-review role | **StewardMD Documentation Reviewer** (docs currency, citations, no-em-dash rule) |

## 3. Components NOT Useful for StewardMD (ignore)

- Language reviewers for stacks we don't use (Rust, Go, PHP, Django, FastAPI, Vue, C#, F#, Java, C++, Flutter, React server-side, etc.).
- ECC's TypeScript/Python/npm-centric tooling (`npm audit`, eslint-security) — StewardMD's native layer is Swift; web layer is a bundled `www/` (no heavy npm build in the medical logic path).
- `lead-intelligence`, `competitive-report`, `investor-materials`, `continuous-learning-v2` skills — business/marketing, not clinical dev.
- ECC's `research/`, `ecc2/`, `examples/`, `scaffolds/`, multi-language `docs/*/` mirrors — noise.
- The 12+ per-harness config trees (`.codex`, `.cursor`, `.gemini`, `.kiro`, `.qwen`, `.trae`, `.opencode`, `.hermes`, `.kimi`, …) — StewardMD standardizes on Claude Code; other-harness configs add clutter with no benefit.

## 4. NEVER Adopt (security / maintenance / complexity)

- **`.mcp.json` / any ECC MCP servers** — external MCP = new attack surface + supply-chain risk on a medical app. Never.
- **`hooks/`** — auto-executing hooks from an external repo can run arbitrary code on every action. Never source.
- **npm packages `ecc-universal` / `ecc-agentshield`** and the **GitHub App** — third-party runtime deps + repo-write access; unacceptable for PHI-adjacent code. Never install.
- **`scripts/*.sh` / `*.js`** (release-video, approval-gate, smoke) — never execute third-party scripts.
- **Global Claude/agent config injection** — ECC is designed to drop configs into `~/.claude` etc. We keep everything project-scoped in StewardMD; global config untouched.
- **The "install ECC wholesale" path** generally — the README's own malware warning + an implausible star count are reasons for maximum caution.

## 5–7. Recommendation Register (effort · benefit · when)

| ID | Recommendation | Effort | Benefit | When |
|---|---|---|---|---|
| R1 | 10 StewardMD reviewer agents (`.claude/agents/`) | M (bulk of this task) | **High** | **Now** |
| R2 | Clinical Workflow Reviewer wired to engine golden outputs/no-regression | S (role); M (wiring to goldens) | **High** | **Now** (role) / Later (deep wiring) |
| R3 | `docs/dev-framework/pr-review.md` multi-reviewer workflow | S | **High** | **Now** |
| R4 | Prompt-defense baseline block (shared, prepended to reviewers) | XS | Medium | **Now** |
| R5 | `docs/dev-framework/release-checklist.md` (App Store + deploy gotchas) | S | **High** | **Now** |
| R6 | Security Reviewer (mobile+clinical) | S | High | **Now** |
| R7 | Accessibility Reviewer (web UI + Watch, VoiceOver/Dynamic Type) | S | Medium-High | **Now** |
| R8 | Performance Reviewer (WKWebView/bundle-size/cold-start/watch-battery) | S | Medium | **Now** |
| R9 | Documentation Reviewer | S | Medium | **Now** |
| R10 | A local, native `/review-pr`-style slash command in `.claude/commands/` | S | Medium | **Later** (validate the agents first) |
| R11 | CI: a GitHub Action that runs `xcodebuild`/`swiftlint` + a review checklist gate | M | Medium-High | **Later** |
| R12 | Automated release-approval-gate script | M | Low-Medium | **Later** |
| R13 | Any MCP/hooks/npm/global-config adoption | — | — | **Never** (§4) |

**Implement-Now set:** R1, R3, R4, R5, R6, R7, R8, R9, and the role definitions for R2 — all as self-contained StewardMD artifacts (below). R10–R12 deferred; R13 rejected.

## Guardrails honored
No ECC file copied verbatim (except this doc's structure is original); no scripts executed; no npm/MCP/hooks/global config touched; all outputs live under `StewardMD/docs/dev-framework/` and `StewardMD/.claude/agents/` (project-scoped). Reviewer roles are documentation-grade agent definitions — they *guide* review, they do not auto-run anything.
