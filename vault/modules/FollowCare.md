---
tags: [module, clinical]
status: live
flag: smd_followcare (+ _actions) default ON, fails-closed
---
# FollowCare

Flagship **Hospital Recovery Intelligence** — post-discharge follow-up. Patients **never install the app**
(link-only: WhatsApp / portal). Multi-tenant. Phases 0–5 + Doctor Action Center all live on `main`.

## Key files
- `functions/_followcare_dispatch.js` + `functions/api/followcare` — pathways, portal, comms
- 26-pathway **deterministic DiagnosisMapper** (NO LLM) + auto multilingual detection
- Doctor Action Center: 10 actions, AI-approve drafts, encrypted `fc_comms` log + audit, portal inbox, R2 photos

## Hard rules (safety)
- NEVER change prescriptions, diagnose definitively, stop medicines, or replace the treating doctor.
- DiagnosisMapper is deterministic (no LLM). Generic pathway must NEVER block enrollment.
- No PHI in URLs / SMS / logs.
- Retention **7 days** post-recovery (DPDP §8(7)) — `FOLLOWCARE_RETENTION_DAYS`.

## Owner TODO
clinician sign-off on thresholds · reviewed non-en/hi/te translations · bind `FOLLOWCARE_R2` for photos · rotate exposed creds · BSP for WhatsApp scale.

## UI/UX floor (2026-08-27, ui-ux-pro-max pass)
Pinned by `test/followcare-ux.test.mjs` because each of these is invisible until the person it
affects hits it. Four real findings in the doctor-facing overlay (`followcare.js` `css()`):
- **`.fc-x` close button was 34x34**, under the 44x44 touch minimum, on the most-tapped control of a
  one-handed ward-round surface. Now 44x44.
- **Exactly ONE `:focus` rule existed** in 1033 lines, and these are restyled buttons/divs so the
  browser default does not survive. Added `:focus-visible` rings, inverted on the teal `.fc-hd`
  (a teal ring on a teal header is invisible) and re-coloured for dark.
- **Reduced motion never reached the CSS.** The `_RM` guard only covers the motion.dev helpers, while
  UI v2 adds transitions/`:active` transforms and the MAiTRI hero runs `.mai-aura` + `.mai-dot` as
  `infinite`. Unstoppable continuous motion on a clinical dashboard is a vestibular trigger.
- **`.fc-soon` had no dark rule** - a light amber pill (#ffe9c7) glowing as the brightest thing on a
  dark screen while marking the LEAST important item.
- `ESC.red.icon` now carries **U+FE0E** (text presentation): iOS renders a bare U+26A0 as the colour
  emoji, inside a red-styled clinical badge.

**Left alone deliberately:** the escalation glyphs (● ○ ✓) are not an accessibility bug - every level
ships a text `label` alongside colour, which is the rule the ui-ux-pro-max set flags hardest. The
generic dark-slate palette the tool proposed was NOT adopted; FollowCare keeps StewardMD's teal
tokens, because consistency with the rest of the app outranks a standalone-pretty module.

## Gotchas
- Fixed a live portal crash: Motion `spring()` in `pop()` escaped try/catch → "Connection problem" for unconfirmed non-English patients.
Deps: [[Infra]] (R2, WhatsApp) · [[Decisions]] (retention).
