# Brief 6 server report (research-server)

Server only. No commit. Client files, `home.js` and `scripts/security-scan.mjs` were not edited.

Contract: `docs/research/contracts/phase-5/polish-format-import.md`.

- Ask MaiK task `polish` on `POST /v1/projects/{pid}/ai-draft`. One call, temperature 0, draft stays `unverified`. Tokens must keep the same count. A new number, a new citation, or text longer than 1.2 times the section is `422 invalid_draft` and is not stored. Empty wallet is `402` with message `You need more MaiK tokens`.
- `GET /v1/projects/{pid}/format-check?journal=<id>` returns `{ journalId, journalName, checks }` (11 checks). No model call. A null numeric limit is `warn`.
- Import accepts CSL-JSON, EndNote XML and NBIB, plus the existing RIS, BibTeX and CSV parsers. A paper already in the project (DOI, PMID, or title + year + first author) is not inserted. A duplicate inside the same new file is still inserted and flagged.

Research UI tests were not run on this branch. They belong to the client worker.

## node scripts/security-scan.mjs

Exit code 0.

```
dependency audit: RAN, 0 high/critical advisories (not blocking; owner review)
security-scan summary: 0 finding(s), 17 public-by-design
  public-by-design: 17
  rules run: secrets, dangerous-patterns, cors-auth, dependency-audit
  rules not run: none
```

## npm test

Exit code 0. 46065 lines of stdout. No `FAILED:` line. No test file reported `fail` greater than 0.

The command ends with:

```
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 128737.236834
→ rx-build.test.mjs
ALL 12 PASS
EXIT:0
```
