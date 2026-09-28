# StewardMD Clinical Updates & Verification Pipeline (Phase 1 Engineering Spec)
## Native Integration: Pipeline Crawler, Review Desk, and Verified Bedside Delivery

**Module:** Medical Updates (`updates`)  
**Feature Flag:** `smd_kb_bulletins` (default: `false`, query: `?bulletins=1`)  
**Decision Record:** `vault/decisions/Decisions.md` (ADR-2026-09-29: Bedside Clinical Bulletins)  
**Standard Compliance:** IEC 62304 Class B, ISO 13485, SaMD Non-Device CDS, GRADE Framework  

---

## 1. Architectural Baseline & Codebase Alignment

This specification aligns the clinical update ingestion pipeline with the existing StewardMD architecture:

1. **Schema Migration:** Checked-in migration file `functions/db/0002_updates_signoff.sql` extending the `updates` table in D1.
2. **API Routing:** Implemented directly inside the Cloudflare Pages catch-all router `functions/api/updates/[[path]].js` and data access layer `functions/_updates_repo.js`.
3. **Pipeline Ingestion:** Native integration into `functions/_updates_pipeline.js` by adding OpenFDA and PubMed as source types in the `sources` table, preserving canonical deduplication (`doc_key`, `content_hash`).
4. **Clinical Verification:** Extends the existing `review-desk.js` and `SMD_RX.verifiedInfo()` rather than building a detached secondary attestation system.
5. **Bedside Rendering & Offline Caching:** Client-side cache in `localStorage` (`smd_kb_bulletins_cache`) populated on app launch, enabling instant offline display in `reasoning.js` behind the flag `smd_kb_bulletins`.
6. **Regulatory Posture:** **Verified-only updates display at the bedside by default.** Unverified updates remain restricted to the Review Desk queue. Unverified live display with an asterisk (`*`) is an optional, owner-gated setting.

---

## 2. Database Migration (`functions/db/0002_updates_signoff.sql`)

```sql
-- StewardMD — Medical Updates Verification & Disease Grounding (Migration 0002)
-- Apply: wrangler d1 execute stewardmd-updates --remote --file functions/db/0002_updates_signoff.sql

ALTER TABLE updates ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE updates ADD COLUMN verified_by TEXT DEFAULT '';
ALTER TABLE updates ADD COLUMN verified_reg TEXT DEFAULT '';
ALTER TABLE updates ADD COLUMN verified_ts INTEGER DEFAULT 0;
ALTER TABLE updates ADD COLUMN disease_id TEXT DEFAULT '';
ALTER TABLE updates ADD COLUMN evidence_grade TEXT DEFAULT 'GRADE 1B';
ALTER TABLE updates ADD COLUMN trial_phase TEXT DEFAULT 'Phase III RCT';

CREATE INDEX IF NOT EXISTS idx_updates_disease ON updates(disease_id, verified);
CREATE INDEX IF NOT EXISTS idx_updates_signoff ON updates(verified, published_ts DESC);
```

---

## 3. Data Access Layer (`functions/_updates_repo.js`)

Add the sign-off mutation and verified-only query methods:

```javascript
/**
 * Attest an update with attending physician credentials.
 */
export async function signoffUpdate(db, id, verifiedBy, verifiedReg) {
  const now = Date.now();
  const res = await db.prepare(`
    UPDATE updates
    SET verified = 1,
        verified_by = ?,
        verified_reg = ?,
        verified_ts = ?,
        updated_ts = ?
    WHERE id = ?
  `).bind(verifiedBy, verifiedReg, now, now, id).run();
  
  return (res.meta && res.meta.changes > 0);
}

/**
 * Fetch verified updates for a specific disease ID (with client-side caching header).
 */
export async function listVerifiedByDisease(db, diseaseId) {
  const rows = await db.prepare(`
    SELECT id, title, body, summary, official_url, published_ts,
           evidence_grade, trial_phase, verified_by, verified_reg, verified_ts
    FROM updates
    WHERE disease_id = ? AND verified = 1
    ORDER BY published_ts DESC
    LIMIT 3
  `).bind(diseaseId).all();
  
  return rows.results || [];
}
```

---

## 4. API Router Integration (`functions/api/updates/[[path]].js`)

Add the `/api/updates/:id/signoff` and `/api/updates/by-disease/:diseaseId` routes into the existing `[[path]].js` router:

```javascript
// Inside functions/api/updates/[[path]].js

// Route: POST /api/updates/:id/signoff
if (method === "POST" && path.length === 2 && path[1] === "signoff") {
  if (!ownerOK(context)) return json({ ok: false, error: "Unauthorized" }, 401);
  
  const id = decodeURIComponent(path[0]);
  const body = await context.request.json().catch(() => ({}));
  const { verified_by, verified_reg } = body;

  if (!verified_by || !verified_reg) {
    return json({ ok: false, error: "Missing physician signature or registration" }, 400);
  }

  const ok = await repo.signoffUpdate(context.env.UPDATES_DB, id, verified_by, verified_reg);
  if (!ok) return json({ ok: false, error: "Update not found" }, 404);

  return json({ ok: true, id, verified: true, verified_by, verified_reg });
}

// Route: GET /api/updates/by-disease/:diseaseId (Public bedside endpoint)
if (method === "GET" && path.length === 2 && path[0] === "by-disease") {
  const diseaseId = decodeURIComponent(path[1]);
  const items = await repo.listVerifiedByDisease(context.env.UPDATES_DB, diseaseId);
  return json({ ok: true, items }, 200, PUB_CACHE);
}
```

---

## 5. Pipeline Crawler Enhancement (`functions/_updates_pipeline.js`)

Rather than creating a standalone script, extend the existing `sources` crawler. Add source entries with `parser_type = 'litapi'` (Europe PMC) or new parsers for OpenFDA:

```javascript
// Inside functions/_updates_pipeline.js: Integrate with existing runPipeline()
// 1. OpenFDA parser handler
async function crawlOpenFDA(source) {
  const url = source.rss_url || "https://api.fda.gov/drug/label.json?search=effective_time:[20260101+TO+20261231]&limit=10";
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = await r.json();
  
  return (data.results || []).map(entry => {
    const brand = entry.openfda?.brand_name?.[0] || "Drug Label Update";
    const generic = entry.openfda?.generic_name?.[0] || "";
    const docKey = `fda:${entry.id || entry.set_id}`;
    
    return {
      doc_key: docKey,
      source_id: source.id,
      type: "drug_approval",
      title: `FDA Approval: ${brand} (${generic})`,
      body: (entry.indications_and_usage?.[0] || "").slice(0, 500),
      official_url: "https://www.fda.gov/drugs",
      published_ts: Date.now(),
      auto: 1,
      verified: 0 // Ingested as unverified by default
    };
  });
}
```

Deduplication via `doc_key` and `content_hash` continues to be enforced by `_updates_pipeline.js`.

---

## 6. Review Desk Integration (`review-desk.js`)

Extend the existing Review Desk (`review-desk.js`) by adding `updates` as a 4th review category alongside `protocols`, `kits`, and `consents`:

```javascript
// Inside review-desk.js
var KINDS = [
  ["protocol", "Protocols"],
  ["kit", "Specialty kits"],
  ["consent", "Consent templates"],
  ["update", "Clinical updates"] // Added
];

// Reuses existing clinician credentials via SMD_RX.verifiedInfo()
function applySignoff(updateId) {
  var creds = (G.SMD_RX && G.SMD_RX.verifiedInfo) ? G.SMD_RX.verifiedInfo() : null;
  var name = creds ? creds.name : "";
  var reg = creds ? creds.regNo : "";

  return fetch("/api/updates/" + encodeURIComponent(updateId) + "/signoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verified_by: name, verified_reg: reg })
  }).then(function(r) { return r.json(); });
}
```

---

## 7. Bedside UI & Offline Cache (`reasoning.js`)

### 7.1 Offline Local Cache
On app initialization, `home.js` or `reasoning.js` caches recent verified bulletins:
```javascript
function syncBedsideBulletinsCache() {
  if (!navigator.onLine) return;
  fetch("/api/updates?limit=50&type=drug_approval,trial,guideline")
    .then(r => r.json())
    .then(d => {
      if (d && d.items) {
        localStorage.setItem("smd_kb_bulletins_cache", JSON.stringify(d.items));
      }
    }).catch(function() {});
}
```

### 7.2 Bedside Disease View Rendering
When rendering a disease in the Harrison Knowledge Library:
```javascript
function renderBedsideBulletins(diseaseId) {
  // Feature flag check
  var flag = (window.SMD_FLAGS && window.SMD_FLAGS.smd_kb_bulletins) || 
             (location.search.indexOf("bulletins=1") >= 0);
  if (!flag) return "";

  var cache = JSON.parse(localStorage.getItem("smd_kb_bulletins_cache") || "[]");
  var matched = cache.filter(function(it) {
    return it.disease_id === diseaseId && it.verified === 1; // Verified-only for safety
  });

  if (!matched.length) return "";

  return matched.map(function(b) {
    return '<div class="smd-kb-bulletin bulletin-verified">' +
      '<div class="bulletin-header">' +
        '<span class="bulletin-pill">✓ Verified Clinical Bulletin</span>' +
        '<span class="bulletin-date">' + new Date(b.published_ts).toLocaleDateString() + '</span>' +
      '</div>' +
      '<div class="bulletin-headline"><strong>' + esc(b.title) + '</strong></div>' +
      '<p class="bulletin-body">' + esc(b.body || b.summary) + '</p>' +
      '<div class="bulletin-footer">' +
        (b.official_url ? '<a href="' + esc(b.official_url) + '" target="_blank" rel="noopener">Primary Evidence ↗</a>' : '') +
        '<div class="bulletin-signed">Verified by ' + esc(b.verified_by) + ' (' + esc(b.verified_reg) + ')</div>' +
      '</div>' +
    '</div>';
  }).join("");
}
```

---

## 8. Rollout Plan & Milestones

* **Phase 1 (Safe Attestation & Grounding):**
  1. Commit `functions/db/0002_updates_signoff.sql`.
  2. Implement `/signoff` and `/by-disease/:id` in `functions/api/updates/[[path]].js` and `functions/_updates_repo.js`.
  3. Extend `review-desk.js` to show pending unverified updates.
  4. Bedside display of verified-only updates behind flag `smd_kb_bulletins` with offline cache.
* **Phase 2 (Automated Ingestion):**
  1. Add OpenFDA source entries to `sources` table.
  2. Map PubMed/Europe PMC queries to `parser_type = 'litapi'`.
* **Phase 3 (Owner Policy Call on Unverified Tier):**
  1. Review whether unverified updates with `*` should ever be displayed on bedside screens.
