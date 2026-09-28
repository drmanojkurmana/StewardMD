# StewardMD Clinical Bulletins & Updates Ingestion Spec (Phase 1)
## Verified Bedside Intelligence, D1 Updates Extension, and Admin Sign-Off

**Module:** Medical Updates (`updates`)  
**Feature Flag:** `smd_kb_bulletins` (default: `0`, query override: `?bulletins=1`, stored in `localStorage`)  
**Decision Record:** `vault/decisions/Decisions.md` (`2026-09-29 · Clinical Bulletins: verified-only display behind smd_kb_bulletins`)  
**Target:** Safe, human-attested practice-changing trial and regulatory alerts attached to Harrison disease pages without altering canonical knowledge base text.

---

## 1. Architectural Principles & Scope Boundaries

### 1.1 Scope of Updates vs. Bedside Display
1. **The Bell Feed (`/api/updates`):** Remains what it is today: a chronological public stream of new guidelines, FDA alerts, MedWatch notices, and clinical news shown in the notification bell for broad clinical awareness.
2. **The Bedside Disease Reader (`reasoning.js`):** Strictly **VERIFIED-ONLY**. An update appears on a disease page if and only if:
   * It is linked to that disease via `disease_id`.
   * It has been attested by an authenticated physician or platform owner (`verified = 1`).
   * The feature flag `smd_kb_bulletins` is active.
   Unverified AI summaries are never rendered on bedside clinical disease screens.

### 1.2 Signer Identity & Non-Repudiation
Client request bodies are never trusted for clinical credentials. The attesting physician's identity and registration number are derived server-side:
* For Firebase ID token holders: extracted from the verified clinician record in KV (`icu:doctor:<uid>`) written by `verify-doctor.js`.
* For Platform Owners: derived from verified email claims (`_fbauth.js` / `_adminauth.js`).
* Requests lacking verified clinician or owner credentials return `403 Forbidden`.

---

## 2. Database Schema & Migration

### 2.1 Full Schema (`functions/db/updates_schema.sql`)
The `updates` table includes the 5 tracking columns without fake defaults:
```sql
CREATE TABLE IF NOT EXISTS updates (
  id              TEXT PRIMARY KEY,
  doc_key         TEXT NOT NULL,
  source_id       TEXT DEFAULT '',
  type            TEXT NOT NULL DEFAULT 'guideline',
  organization    TEXT DEFAULT '',
  workspace       TEXT NOT NULL DEFAULT 'internal_medicine',
  branch          TEXT DEFAULT '',
  title           TEXT NOT NULL,
  body            TEXT DEFAULT '',
  category        TEXT DEFAULT 'general',
  published_ts    INTEGER NOT NULL DEFAULT 0,
  importance      TEXT NOT NULL DEFAULT 'normal',
  est_read_min    INTEGER DEFAULT 0,
  summary         TEXT DEFAULT '',
  summary_json    TEXT DEFAULT '',
  official_url    TEXT DEFAULT '',
  official_pdf_url TEXT DEFAULT '',
  doi             TEXT DEFAULT '',
  pmid            TEXT DEFAULT '',
  keywords        TEXT DEFAULT '',
  version         TEXT DEFAULT '',
  content_hash    TEXT DEFAULT '',
  auto            INTEGER NOT NULL DEFAULT 1,
  pinned          INTEGER NOT NULL DEFAULT 0,
  verified        INTEGER NOT NULL DEFAULT 0,
  verified_by     TEXT DEFAULT '',
  verified_reg    TEXT DEFAULT '',
  verified_ts     INTEGER DEFAULT 0,
  disease_id      TEXT DEFAULT '',
  created_ts      INTEGER NOT NULL DEFAULT 0,
  updated_ts      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_updates_dockey ON updates(doc_key);
CREATE INDEX IF NOT EXISTS idx_updates_feed  ON updates(published_ts DESC);
CREATE INDEX IF NOT EXISTS idx_updates_type  ON updates(type, published_ts DESC);
CREATE INDEX IF NOT EXISTS idx_updates_ws    ON updates(workspace, published_ts DESC);
CREATE INDEX IF NOT EXISTS idx_updates_branch ON updates(branch, published_ts DESC);
CREATE INDEX IF NOT EXISTS idx_updates_disease ON updates(disease_id, verified);
```

### 2.2 Checked-In Migration (`functions/db/0002_updates_signoff.sql`)
For migrating existing D1 production instances:
```sql
ALTER TABLE updates ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE updates ADD COLUMN verified_by TEXT DEFAULT '';
ALTER TABLE updates ADD COLUMN verified_reg TEXT DEFAULT '';
ALTER TABLE updates ADD COLUMN verified_ts INTEGER DEFAULT 0;
ALTER TABLE updates ADD COLUMN disease_id TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_updates_disease ON updates(disease_id, verified);
```

---

## 3. Data Access Layer (`functions/_updates_repo.js`)

### 3.1 Update `rowToItem`
Include the new columns in the public projection:
```javascript
export function rowToItem(r) {
  if (!r) return null;
  return {
    id: r.id,
    type: r.type,
    category: r.category || typeCategory(r.type),
    title: r.title,
    body: r.body || (r.summary ? String(r.summary).slice(0, 240) : ""),
    summary: r.summary || "",
    organization: r.organization || r.source_id || "",
    source: r.organization || r.source_id || "StewardMD",
    workspace: r.workspace || "internal_medicine",
    branch: r.branch || "",
    importance: r.importance || "normal",
    est_read_min: r.est_read_min || 0,
    url: r.official_url || "",
    version: r.version || "",
    doi: r.doi || "",
    pmid: r.pmid || "",
    pinned: !!r.pinned,
    auto: !!r.auto,
    verified: !!r.verified,
    verified_by: r.verified_by || "",
    verified_reg: r.verified_reg || "",
    verified_ts: r.verified_ts || 0,
    disease_id: r.disease_id || "",
    ts: r.published_ts || r.created_ts || 0,
  };
}
```

### 3.2 Add Sign-Off & Verified Listing Helpers
```javascript
// Attest an update with verified clinician credentials and bind to disease_id
export async function signoffUpdate(env, id, { verifiedBy, verifiedReg, diseaseId }) {
  if (!hasDb(env)) throw new Error("no-db");
  const now = Date.now();
  const res = await db(env).prepare(
    "UPDATE updates SET verified = 1, verified_by = ?, verified_reg = ?, verified_ts = ?, disease_id = ?, updated_ts = ? WHERE id = ?"
  ).bind(verifiedBy, verifiedReg, now, diseaseId, now, id).run();
  return (res.meta && res.meta.changes > 0);
}

// Fetch all verified bulletins that carry a linked disease_id (used for client offline sync)
export async function listVerifiedBulletins(env) {
  if (!hasDb(env)) return [];
  const rs = await db(env).prepare(
    "SELECT * FROM updates WHERE verified = 1 AND disease_id != '' ORDER BY published_ts DESC LIMIT 100"
  ).all();
  return (rs.results || []).map(rowToItem);
}
```

---

## 4. API Router Integration (`functions/api/updates/[[path]].js`)

All changes fit natively into the existing `[[path]].js` router using `parts` and `head`.

### 4.1 Public Bedside Cache Endpoint (Above Admin Gate, Line ~226)
```javascript
  // GET /api/updates/verified -> returns all verified, disease-linked bulletins for bedside offline sync
  if (method === "GET" && head === "verified") {
    if (!repo.hasDb(env)) return json({ ok: true, items: [] });
    const items = await repo.listVerifiedBulletins(env);
    return json({ ok: true, items }, 200, PUB_CACHE);
  }
```

### 4.2 Gated Sign-Off Endpoint (Below Admin Gate, Line ~240)
```javascript
  // POST /api/updates/:id/signoff -> Attest an update and bind disease_id
  if (method === "POST" && parts.length === 2 && parts[1] === "signoff") {
    const id = decodeURIComponent(head);
    if (!repo.hasDb(env)) return json({ error: "no-db" }, 501);

    // Derive signer identity server-side
    const uid = await identify(request, env);
    let verifiedBy = "", verifiedReg = "";

    if (uid) {
      const kv = env.CASES_KV || env.GHIS_KV;
      if (kv) {
        const docRec = await kv.get("icu:doctor:" + uid, "json");
        if (docRec && (docRec.status === "verified" || docRec.verified)) {
          verifiedBy = docRec.name || docRec.doctorName || "";
          verifiedReg = docRec.regNo || docRec.extractedRegNo || "";
        }
      }
    }

    // Fallback: If caller is platform owner via Google Auth or Admin Token
    const isOwner = await ownerOK(request, env);
    if (!verifiedBy && isOwner) {
      verifiedBy = "Platform Owner";
      verifiedReg = "OWNER";
    }

    if (!verifiedBy) {
      return json({ error: "verified-clinician-or-owner-required" }, 403);
    }

    // Validate disease_id payload
    let body = {}; try { body = await request.json(); } catch (e) {}
    const diseaseId = String(body.disease_id || "").trim();
    if (!diseaseId) {
      return json({ error: "disease_id-required" }, 400);
    }
    if (!/^[A-Za-z0-9_.-]{2,80}$/.test(diseaseId)) {
      return json({ error: "invalid-disease-id-format" }, 400);
    }

    const ok = await repo.signoffUpdate(env, id, { verifiedBy, verifiedReg, diseaseId });
    if (!ok) return json({ error: "update-not-found" }, 404);

    return json({ ok: true, id, verified: true, verified_by: verifiedBy, verified_reg: verifiedReg, disease_id: diseaseId });
  }
```

---

## 5. Admin Console Sign-Off Section (`admin/updates.html`)

Inside `admin/updates.html`, add a clinical attestation section for unverified items:

```html
<div class="card" id="signoffDesk" style="border: 2px solid var(--tl);">
  <div style="display:flex; justify-content:space-between; align-items:center;">
    <h2 style="margin:0; font:800 16px var(--f); color:var(--tl);">🩺 Clinical Sign-Off Desk</h2>
    <button class="ghost" id="reloadSignoff" style="padding:6px 12px; font-size:12px;">↻ Reload</button>
  </div>
  <p class="hint" style="margin:4px 0 12px;">
    Updates must be signed off by a verified clinician with a linked disease ID before appearing on bedside disease pages.
  </p>
  <div id="signoffQueue"></div>
</div>
```

```javascript
// Controller inside admin/updates.html
function signoffItem(id) {
  var diseaseInput = document.getElementById("disease_" + id);
  var diseaseId = (diseaseInput ? diseaseInput.value : "").trim();
  if (!diseaseId) {
    alert("Please enter or select a target disease ID (e.g. PANCREATIC_CANCER).");
    return;
  }

  fetch("/api/updates/" + encodeURIComponent(id) + "/signoff", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": token() },
    body: JSON.stringify({ disease_id: diseaseId })
  }).then(function(r) { return r.json(); }).then(function(res) {
    if (res.ok) {
      alert("✓ Update verified and bound to " + res.disease_id);
      loadSignoffQueue();
    } else {
      alert("Error: " + (res.error || "Failed"));
    }
  });
}
```

---

## 6. Bedside UI & Offline Cache (`reasoning.js`)

### 6.1 Flag Convention
Adheres to the standard StewardMD flag pattern (no `window.SMD_FLAGS`):
```javascript
function bulletinsFlagOn() {
  try {
    var q = (location.search.match(/[?&]bulletins=([^&]+)/) || [])[1];
    if (q === "1" || q === "true") return true;
    if (q === "0" || q === "false") return false;
    return localStorage.getItem("smd_kb_bulletins") === "1";
  } catch (e) { return false; }
}
```

### 6.2 Offline Sync
On app startup (when online), sync verified bulletins to `localStorage`:
```javascript
function syncBedsideBulletins() {
  if (!navigator.onLine) return;
  fetch("/api/updates/verified")
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d && d.ok && Array.isArray(d.items)) {
        localStorage.setItem("smd_kb_bulletins_cache", JSON.stringify(d.items));
      }
    }).catch(function() {});
}
```

### 6.3 Bedside Disease Page Rendering
When displaying a disease page in `reasoning.js`:
```javascript
function renderBedsideBulletins(diseaseId) {
  if (!bulletinsFlagOn() || !diseaseId) return "";
  
  var cache = [];
  try { cache = JSON.parse(localStorage.getItem("smd_kb_bulletins_cache") || "[]"); } catch (e) {}
  var matched = cache.filter(function(it) {
    return it.disease_id === diseaseId && it.verified;
  });
  if (!matched.length) return "";

  return matched.map(function(b) {
    return '<div class="smd-bulletin bulletin-verified" role="status">' +
      '<div class="bulletin-header">' +
        '<span class="bulletin-pill">✓ Verified Practice-Changing Update</span>' +
        '<span class="bulletin-date">' + new Date(b.ts || b.published_ts).toLocaleDateString() + '</span>' +
      '</div>' +
      '<div class="bulletin-headline"><strong>' + esc(b.title) + '</strong></div>' +
      '<p class="bulletin-body">' + esc(b.summary || b.body) + '</p>' +
      '<div class="bulletin-footer">' +
        (b.url ? '<a href="' + esc(b.url) + '" target="_blank" rel="noopener">Source Evidence ↗</a>' : '') +
        '<span class="bulletin-signed">Attested by ' + esc(b.verified_by) + ' (' + esc(b.verified_reg) + ')</span>' +
      '</div>' +
    '</div>';
  }).join("");
}
```

---

## 7. Phase 1 Implementation Plan

1. **Database:** Verify `functions/db/updates_schema.sql` and run `functions/db/0002_updates_signoff.sql`.
2. **Repository:** Update `rowToItem`, add `signoffUpdate` and `listVerifiedBulletins` to `functions/_updates_repo.js`.
3. **Routing:** Add `/api/updates/verified` (public) and `/api/updates/:id/signoff` (gated) into `functions/api/updates/[[path]].js`.
4. **Admin UI:** Add sign-off section with disease selector to `admin/updates.html`.
5. **Bedside UI:** Add `syncBedsideBulletins` and `renderBedsideBulletins` behind flag `smd_kb_bulletins` in `reasoning.js`.
6. **Tests:** Ensure test suite passes via `npm test`.
