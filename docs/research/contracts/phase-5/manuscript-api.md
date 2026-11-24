# ResearchMD Phase 5A Manuscript Contract (Package 5A.3)

Frozen contract for manuscript editor, versioning, approvals, locking, and DOCX export.
Frontend screens (`research-screen-manuscript.js`) and backend services (`backend/research/manuscript/**`)
interact via these routes. Auth, roles, error envelopes, and 409 stale-version handling
follow `../phase-1/errors.md` and `../phase-2/errors.md`. Every section edit carries `version`.

## Integrity rules enforced here (Plan sections 3, 5A, 12)

1. Numbers in manuscript: 100% of statistical outputs in Abstract and Results (effects, CIs, p-values, sample sizes, heterogeneity) are `{{run:<id>.<field>}}` tokens. LLMs never calculate or insert bare numbers.
2. Verified citations: 100% of citations must resolve to a valid reference with DOI or PMID.
3. Linked claims: every analytical claim must link to a saved run or verified source extraction.
4. Mandatory human approval: a clinician must sign off on the manuscript before it can be locked.
5. Deterministic version locking: the lock record generates a SHA-256 hash over canonical JSON and sorted run IDs (`version_lock.py`). Once locked, a version is immutable and read-only.
6. Fail-closed export: DOCX export triggers strict gate validation (`render_tokens.py`, `docx_export.py`). Any unresolved token, unresolved citation, or unlinked claim halts export and writes nothing.

## Resource Endpoints

### 1. List Manuscript Versions
`GET /v1/projects/{projectId}/manuscript/versions`

Returns the version history for the project manuscript.

**Response 200 OK:**
```json
{
  "versions": [
    {
      "id": "man_v1",
      "version": 1,
      "title": "BCG vaccination against tuberculosis: systematic review and meta-analysis",
      "status": "locked",
      "sectionCount": 5,
      "referenceCount": 2,
      "versionHash": "9b1c7849e8a5b28d051e948f21915f02bc34220fa1689255a01bc89fb13632ef",
      "createdAt": "2026-11-20T10:00:00Z",
      "createdBy": "researcher",
      "lockedAt": "2026-11-20T10:30:00Z",
      "lockedBy": "clinician"
    },
    {
      "id": "man_v2",
      "version": 2,
      "title": "BCG vaccination against tuberculosis: systematic review and meta-analysis",
      "status": "draft",
      "sectionCount": 5,
      "referenceCount": 2,
      "createdAt": "2026-11-21T09:00:00Z",
      "createdBy": "researcher"
    }
  ]
}
```

---

### 2. Get Manuscript Version
`GET /v1/projects/{projectId}/manuscript?version={version}`

Retrieves full manuscript details for the specified version (or active draft if omitted).

**Response 200 OK:**
```json
{
  "manuscript": {
    "id": "man_v2",
    "projectId": "prj_bcg_1994",
    "version": 2,
    "title": "BCG vaccination against tuberculosis: systematic review and meta-analysis",
    "authors": ["A. Clinician", "B. Statistician"],
    "affiliations": "StewardMD Clinical Research Collaborative",
    "status": "draft",
    "sections": [
      {
        "id": "abstract",
        "heading": "Abstract",
        "level": 1,
        "text": "Objective: Evaluate BCG efficacy against tuberculosis.\nMethods: Systematic review of randomized trials.\nResults: BCG reduced tuberculosis risk (RR {{run:run_1.estimate}}, 95% CI {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, p {{run:run_1.p}}). Heterogeneity was moderate (I2 {{run:run_1.i2}}).\nConclusion: BCG vaccination demonstrates significant protective efficacy.",
        "updatedAt": "2026-11-21T09:15:00Z",
        "updatedBy": "researcher"
      },
      {
        "id": "introduction",
        "heading": "Introduction",
        "level": 1,
        "text": "Tuberculosis remains a major public health challenge worldwide [@who2023]. The Bacillus Calmette-Guerin vaccine has been evaluated across multiple distinct populations [@colditz1994].",
        "updatedAt": "2026-11-21T09:10:00Z",
        "updatedBy": "researcher"
      },
      {
        "id": "methods",
        "heading": "Methods",
        "level": 1,
        "text": "We conducted a systematic review following PRISMA 2020 guidelines. Eligible studies included randomized controlled trials reporting tuberculosis incidence in vaccinated and control cohorts.",
        "updatedAt": "2026-11-21T09:12:00Z",
        "updatedBy": "researcher"
      },
      {
        "id": "results",
        "heading": "Results",
        "level": 1,
        "text": "A total of {{run:run_1.k}} trials were included. The pooled relative risk was {{run:run_1.estimate}} (95% CI {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, p {{run:run_1.p}}). Between-study heterogeneity was observed (I2 {{run:run_1.i2}}, tau2 {{run:run_1.tau2}}).",
        "updatedAt": "2026-11-21T09:20:00Z",
        "updatedBy": "researcher"
      },
      {
        "id": "discussion",
        "heading": "Discussion",
        "level": 1,
        "text": "Our findings confirm substantial protective efficacy of BCG vaccination against clinical tuberculosis. These results support current WHO recommendations for infant vaccination in high-incidence settings [@who2023].",
        "updatedAt": "2026-11-21T09:25:00Z",
        "updatedBy": "researcher"
      }
    ],
    "tokens": {
      "run_1:estimate": { "value": 0.49, "formatted": "0.49" },
      "run_1:ciLower": { "value": 0.34, "formatted": "0.34" },
      "run_1:ciUpper": { "value": 0.70, "formatted": "0.70" },
      "run_1:p": { "value": 0.0001, "formatted": "< .001" },
      "run_1:k": { "value": 13, "formatted": "13" },
      "run_1:i2": { "value": 72.8, "formatted": "72.8%" },
      "run_1:tau2": { "value": 0.36, "formatted": "0.36" }
    },
    "references": [
      {
        "key": "colditz1994",
        "title": "Efficacy of BCG vaccine in the prevention of tuberculosis",
        "authors": ["Colditz GA", "Brewer TF", "Berkey CS", "Wilson ME", "Burdick E", "Fineberg HV", "Mosteller F"],
        "venue": "JAMA",
        "year": 1994,
        "volume": "271",
        "pages": "698-702",
        "doi": "10.1001/jama.1994.03510370074034",
        "pmid": "8309034"
      },
      {
        "key": "who2023",
        "title": "Global Tuberculosis Report 2023",
        "authors": ["World Health Organization"],
        "venue": "World Health Organization",
        "year": 2023,
        "doi": "10.1016/S0140-6736(23)02145-X"
      }
    ],
    "approval": {
      "status": "pending",
      "requestedBy": "researcher",
      "requestedAt": "2026-11-21T09:30:00Z"
    },
    "lock": null
  }
}
```

---

### 3. Save Draft Section
`PUT /v1/projects/{projectId}/manuscript/sections/{sectionId}`

Updates section heading or content. Rejects edits if manuscript is locked (HTTP 403) or if version is stale (HTTP 409).

**Request Body:**
```json
{
  "version": 2,
  "heading": "Results",
  "text": "A total of {{run:run_1.k}} trials were included. The pooled relative risk was {{run:run_1.estimate}} (95% CI {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, p {{run:run_1.p}})."
}
```

**Response 200 OK:**
```json
{
  "section": {
    "id": "results",
    "heading": "Results",
    "level": 1,
    "text": "A total of {{run:run_1.k}} trials were included. The pooled relative risk was {{run:run_1.estimate}} (95% CI {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, p {{run:run_1.p}}).",
    "updatedAt": "2026-11-21T09:35:00Z",
    "updatedBy": "researcher"
  },
  "version": 2,
  "tokens": {
    "run_1:estimate": { "value": 0.49, "formatted": "0.49" },
    "run_1:ciLower": { "value": 0.34, "formatted": "0.34" },
    "run_1:ciUpper": { "value": 0.70, "formatted": "0.70" },
    "run_1:p": { "value": 0.0001, "formatted": "< .001" },
    "run_1:k": { "value": 13, "formatted": "13" }
  }
}
```

---

### 4. Request Approval
`POST /v1/projects/{projectId}/manuscript/approval/request`

Submits the draft manuscript for clinician review and approval.

**Request Body:**
```json
{
  "version": 2,
  "note": "Ready for primary author review."
}
```

**Response 200 OK:**
```json
{
  "status": "review",
  "approval": {
    "status": "requested",
    "requestedBy": "researcher",
    "requestedAt": "2026-11-21T09:40:00Z",
    "note": "Ready for primary author review."
  }
}
```

---

### 5. Approve Manuscript
`POST /v1/projects/{projectId}/manuscript/approval/approve`

Human clinician approves the manuscript draft.

**Request Body:**
```json
{
  "version": 2,
  "decision": "approved",
  "note": "All statistical claims and citations verified."
}
```

**Response 200 OK:**
```json
{
  "status": "approved",
  "approval": {
    "status": "approved",
    "approvedBy": "clinician",
    "approvedAt": "2026-11-21T09:45:00Z",
    "note": "All statistical claims and citations verified."
  }
}
```

---

### 6. Lock Manuscript Version
`POST /v1/projects/{projectId}/manuscript/lock`

Freezes the approved manuscript into an immutable locked version using `version_lock.py`.
Returns the signed LockRecord with SHA-256 version hash.

**Request Body:**
```json
{
  "version": 2
}
```

**Response 200 OK:**
```json
{
  "status": "locked",
  "lock": {
    "version_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "locked_at": "2026-11-21T09:50:00Z",
    "locked_by": "clinician",
    "run_ids": ["run_1"],
    "manuscript_title": "BCG vaccination against tuberculosis: systematic review and meta-analysis",
    "section_count": 5,
    "reference_count": 2,
    "status": "locked",
    "metadata": {}
  }
}
```

---

### 7. Export DOCX Job
`POST /v1/projects/{projectId}/manuscript/export`

Starts an asynchronous export job to generate the IMRAD DOCX document (`docx_export.py`).
Pre-export verification checks all release gates. If any gate fails, HTTP 422 is returned with failure details.

**Request Body:**
```json
{
  "version": 2,
  "format": "docx"
}
```

**Response 202 Accepted (Gates passed):**
```json
{
  "jobId": "job_docx_456",
  "status": "pending",
  "format": "docx",
  "gatesPassed": true
}
```

**Response 422 Unprocessable Entity (Gate failures):**
```json
{
  "error": {
    "code": "gate_failed",
    "message": "Export blocked: manuscript contains unresolved tokens or citations."
  },
  "gatesPassed": false,
  "gateFailures": [
    {
      "type": "unresolved_token",
      "message": "Token {{run:run_missing.estimate}} cannot be resolved from saved runs.",
      "token": "{{run:run_missing.estimate}}",
      "sectionId": "results",
      "location": "Results section"
    },
    {
      "type": "unresolved_citation",
      "message": "Citation key smith2020 has neither DOI nor PMID in references.",
      "key": "smith2020",
      "sectionId": "introduction",
      "location": "Introduction section"
    },
    {
      "type": "unlinked_claim",
      "message": "Claim of statistical significance in Results has no linked run token.",
      "sectionId": "results",
      "location": "Results section"
    }
  ]
}
```

---

### 8. Release Gate Results
`GET /v1/projects/{projectId}/manuscript/gates?version={version}`

Inspects the current readiness gates without initiating export.

**Response 200 OK:**
```json
{
  "gatesPassed": true,
  "gateFailures": [],
  "checks": {
    "tokens": { "total": 7, "resolved": 7, "unresolved": 0 },
    "citations": { "total": 2, "resolved": 2, "unresolved": 0 },
    "claims": { "total": 4, "linked": 4, "unlinked": 0 }
  }
}
```
