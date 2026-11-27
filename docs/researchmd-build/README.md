# ResearchMD on-device build: briefs (27 Nov 2026)

What this is: everything your Mac Claude Code session ("Gemini app prompt task") needs to build the ResearchMD on-device plan with Gemini Hydrogen writing the code (agy accounts 1 to 4) and Claude Opus 5.5 on agy account 4 reviewing. A cloud Claude thread does the final review and opens the pull requests from the pushed branches.

Order (each phase is stacked on the one before):
1. 00-runbook-for-mac-session.md: how to run every phase (worktree, accounts, write, review, fix, tests, commit, push, when to stop).
2. 01-ocr.md: PDF reading and OCR on the device; device results uploaded without the PDF. Branch rmd-od-1-ocr.
3. 02-stats.md: linear regression with HC3, Schoenfeld PH test and Reitsma ported to the app; Web Worker; checked against R in CI. Branch rmd-od-2-stats.
4. 03-drafts.md: manuscript drafts run by the app step by step, saved after each step; AI calls still through the gateway, with step IDs so a retry never pays twice. Branch rmd-od-3-drafts.
5. 04-fallback-limits.md: two automatic retries on the device, then cloud only after the privacy notice; monthly cloud allowance per plan (Free 0, Trainee 15, Co-Resident 15 per seat, Resident Pro 25, Clinician 30, Clinician Pro 100) with daily caps on top; container idle cut to 1 minute. Branch rmd-od-4-fallback.
6. 05-background.md: long OCR jobs keep going when the app is put away (iOS 26 continued processing, Android WorkManager). Compile only. Branch rmd-od-5-background.

Every new behaviour is ON by default (Manoj, 27 Nov). Each has a flag only as a kill switch (localStorage "0" turns it off). Nothing is merged, deployed or installed on a phone by these steps.
Needs your real-device testing before the branches are merged, because merging ships these behaviours on: OCR speed and accuracy (plan phase 1), worker speed on a low-end Android, background behaviour.
