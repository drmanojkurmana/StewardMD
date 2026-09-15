# Connect Agent: Same As The Hand-Built GHIS Adapter - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent-built hospital adapter reads GHIS through the same data requests the owner's hand-built adapter (`functions/api/ghis/[[path]].js`) calls, never shows or waits on a hospital page, and cannot be approved until its ward list is proven.

**Architecture:** The phone engine already proves data calls (`connect-agent/phone/prove.mjs`) and replays proven calls inside the hidden hospital page (`connect-agent/phone/adapter-runtime.mjs` `executeProven`). This plan: (1) keeps the per-screen proof trace so every run explains itself, (2) makes proof choose the request that returns only the list instead of the first page that contains it, and checks the ward list with Gemini, (3) removes the page-opening fallback from the patient read, (4) bounds every read in time, (5) refuses to read unless the native browser confirms it is hidden, (6) refuses approval without a proven ward list, (7) deletes the GIMSR ward-list injection that hid the gap, (8) proves parity on the iPhone with the existing gold audit.

**Tech Stack:** ES modules (`connect-agent/**`), ES5 IIFE (`ghis-ward.js`), Cloudflare Pages Functions (`functions/**`), Swift WKWebView plugin, Java Android WebView plugin, `node --test`, headless Chrome CDP harness (`test/run-ward-adapter-ui.mjs`).

**Spec:** Owner requirements quoted in Global Constraints; `.claude/rules/emr-integration-agent.md` (LAW III, Rule 4.1, Rule 5.2); `vault/modules/Connect Agent.md` sections "Proven endpoints only" and "Gold audit"; the evidence table below.

## Evidence this plan argues from

Active adapter `ver_b16da370-e873-4de8-ac05-555d24ecc52d` (job `job_b2a7c1e3-4911-4975-9e6f-d2d4510bf475`), read from D1 `stewardmd-connect` by the owner on 2026-09-15:

| Screen | Hand-built adapter calls | Agent proved | Verdict |
|---|---|---|---|
| Ward list | `GET /Doctor/Home/GetIPWL` | `GET /Doctor/Home/DashboardUnit` (out-patient list), 41/41 | wrong list |
| Patient | `POST /Doctor/Home/Searchnew` | `POST Searchnew` + `GET GetInitialAssessmentnew/` | close |
| Labs list | `POST /Lab/Home/GetSearchPatientId` | `POST /Doctor/Home/Searchnew` (whole visit page), 8/8 | wrong call |
| Lab result | `POST /Lab/Home/GetPrintLabResultDetailsAuth` | `no-requests` | missing |
| Radiology list | `GET /Radio/Home?recordNo=` | `GET /Doctor/Home/PatientprofileVisits/`, 26/26 | wrong call |
| Radiology report | `GET /Radiology/Home/GetRadiologyResultPrint` | not captured | missing |
| Medications | `GET /Doctor/Home/GetMedicines/?id=` | `GET /Doctor/Home/GetMedicines/`, 67/75 | same |
| History | `GET Getopcard` + `Getconsultant` | `no-requests` | missing |

`observedEvents` on the same job holds only 21 x `GET /Doctor/Home/DashboardUnit`: it is the explore phase only (`index.mjs` collects the spec before the deep crawl), so the requests seen while proving each screen were never stored. That is why Task 1 exists.

Read-path facts (code, 2026-09-15): an unproven screen falls back to `readView` page loads (`connect-agent/phone/runtime.mjs:445-462`, up to ~34 page reads per resource, each `evaluate` capped at 30 s, no overall deadline); `readWorklist` injects `GetIPWL` for GIMSR origins (`runtime.mjs:315-331`); approval checks no proof (`functions/api/connect/agent/[[path]].js:1195-1219`); iOS `open`/`setMode` never report whether hidden took effect, and the owner's iPhone showed the hospital page full screen during a patient read.

## Global Constraints

- Owner, 2026-09-13: "I want SAME-TO-SAME reproduction of my hand-built GHIS adapter, not an approximate adapter."
- Owner, 2026-09-15: "it should be 100% similar or better than the manual ghis adapter i created"
- LAW III: during clinical use the hospital EMR never visibly pops up; background reads run hidden.
- Credentials never leave the phone. Never log, persist or send cookies, passwords, form values or PHI values. Only method, redacted path (digit runs of 3+ replaced by `#`), key names and counts may leave the phone.
- Read-only: never call a write path (`WRITE_PATH` in `prove.mjs`).
- No hospital-specific endpoint in discovery or runtime (owner 2026-09-13: "GHIS is the test, not the target"). `connect-agent/phone/gold-audit.mjs` is the only file that may name GHIS endpoints, and discovery never imports it.
- No em-dash in app-facing text.
- `ghis-ward.js` stays ES5: `var`, `function`, no arrow functions, no template literals.
- Test runner, one file at a time: `node --experimental-test-module-mocks --experimental-sqlite <file>`. Browser harness: `node test/run-ward-adapter-ui.mjs`.
- Reversible: the feature stays behind `smd_connect_agent` (default off). Recovery tag before Task 1.
- Commit after every task. Stage files by name (other sessions share this repository).
- Done means Task 8's gold audit verdicts, not green unit tests.

## File Structure

| File | Responsibility in this plan |
|---|---|
| `connect-agent/phone/index.mjs` | sends the proof trace with discovery (Task 1) |
| `functions/api/connect/agent/[[path]].js` | cleans and stores the trace (Task 1), approval gate (Task 6) |
| `connect-agent/phone/prove.mjs` | picks the most specific proven call, checks the ward list (Task 2) |
| `functions/_connect/agent/brain.js` | ward list means admitted in-patients (Task 2) |
| `connect-agent/phone/runtime.mjs` | patient read never opens a page (Task 3), no GetIPWL injection (Task 7) |
| `connect-agent/phone/ghis-shim.mjs` | says "not read" instead of "none" (Task 3) |
| `connect-agent/phone/adapter-runtime.mjs` | per-request timeout (Task 4) |
| `ghis-ward.js` | not-read messages (Task 3), whole-read deadline (Task 4), hidden confirmation (Task 5) |
| `local-plugins/capacitor-connect-browser/ios/Sources/ConnectBrowserPlugin/ConnectBrowserPlugin.swift` | reports hidden (Task 5) |
| `android/app/src/main/java/in/stewardmd/app/ConnectBrowserPlugin.java` | reports hidden (Task 5) |
| `test/connect/agent/phone-router.test.mjs` | trace stored, approval gate |
| `test/connect-agent/prove.test.mjs`, `test/connect/agent/brain.test.mjs` | proof choice, ward list check |
| `test/connect-agent/phone-runtime.test.mjs`, `test/connect-agent/ghis-shim.test.mjs`, `test/connect-agent/adapter-runtime.test.mjs` | read path, not-read, timeout |
| `test/run-ward-adapter-ui.mjs` | drawer messages, deadline, hidden refusal |
| `vault/modules/Connect Agent.md`, `vault/decisions/Decisions.md` | record the change (Task 8) |

---

### Task 0: Recovery point

- [ ] **Step 1: Tag the current state**

```bash
git tag connect-agent-pre-parity-2026-09-16
git tag --list 'connect-agent-pre-parity*'
```
Expected: `connect-agent-pre-parity-2026-09-16`

---

### Task 1: Keep the per-screen proof trace so every run explains itself

**Files:**
- Modify: `functions/api/connect/agent/[[path]].js` (new `cleanProofTrace` after `cleanObservedViews`; discovery route near line 920 and the `phoneState` object near line 1038; `GET /versions/:id` response near line 1180)
- Modify: `connect-agent/phone/index.mjs:361`
- Test: `test/connect/agent/phone-router.test.mjs`

**Interfaces:**
- Consumes: `book.trace` from `createProofBook` (`prove.mjs:527-552`): `[{ resource, status, tried, attempts: [{ method, path, role, kind, hits, ratio, gemini? }], ...countsFromViewProof }]`.
- Produces: `phone_state.proofTrace: [{ resource, status, tried, attempts: [{ method, path, role, kind, hits, ratio }] }]` (max 60 screens, 12 attempts each) and the same array as `proofTrace` on `GET /versions/:id`.

- [ ] **Step 1: Write the failing test** (append to `test/connect/agent/phone-router.test.mjs`)

```js
test("discovery keeps the phone's proof trace (method, redacted path, counts) and refuses one that carries an identifier", async () => {
  const { env, doc1 } = await setupTestEnv();
  const sRes = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t1", emrUrl: DEP_ORIGIN, runner: "phone", consent: { agreed: true } }, env, doc1.headers));
  const sessionId = (await sRes.json()).sessionId;
  await onRequest(post(`/api/connect/agent/sessions/${sessionId}/handoff`, { tenantId: "t1" }, env, doc1.headers));
  await onRequest(post(`/api/connect/agent/sessions/${sessionId}/progress`, { tenantId: "t1", stage: "DISCOVERING" }, env, doc1.headers));
  const proofs = [
    { resource: "labs", status: "proven", tried: 2, brain: true, overlap: 1, attempts: [
      { method: "POST", path: "/Doctor/Home/Searchnew", role: "data", kind: "html", hits: 8, ratio: 1 },
      { method: "POST", path: "/Lab/Home/GetSearchPatientId", role: "data", kind: "json", hits: 8, ratio: 1, gemini: "ok" },
    ] },
    { resource: "labs-detail", status: "no-requests", tried: 0, attempts: [] },
    { resource: "radiology", status: "proven", tried: 1, attempts: [{ method: "GET", path: "/Lab/Result/2012130687", role: "data", kind: "html", hits: 3, ratio: 1 }] },
  ];
  const res = await onRequest(post(`/api/connect/agent/sessions/${sessionId}/discovery`, { tenantId: "t1", spec: minimalSpec(), steps: [], observedViews: observedViews(), proofs }, env, doc1.headers));
  assert.equal(res.status, 200, await res.clone().text());
  const phoneState = JSON.parse((await findJobForSession(env.CONNECT_DB, "t1", sessionId)).phone_state);
  assert.deepEqual(phoneState.proofTrace, [
    { resource: "labs", status: "proven", tried: 2, attempts: [
      { method: "POST", path: "/Doctor/Home/Searchnew", role: "data", kind: "html", hits: 8, ratio: 1 },
      { method: "POST", path: "/Lab/Home/GetSearchPatientId", role: "data", kind: "json", hits: 8, ratio: 1 },
    ] },
    { resource: "labs-detail", status: "no-requests", tried: 0, attempts: [] },
    // An attempt whose path still carries an identifier is dropped, never stored.
    { resource: "radiology", status: "proven", tried: 1, attempts: [] },
  ]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/phone-router.test.mjs`
Expected: FAIL, `phoneState.proofTrace` is `undefined`.

- [ ] **Step 3: Implement the cleaner** (insert after the closing `}` of `function cleanObservedViews` in `functions/api/connect/agent/[[path]].js`)

```js
/* The phone's proof trace (connect-agent/phone/prove.mjs createProofBook): per screen, which requests
 * were replayed and how many on-screen values each carried. Without it a failed screen is a bare
 * "no-requests" and the next run is a guess (adapter ver_b16da370, 2026-09-15). Method, redacted path,
 * role, kind and counts only; an attempt whose path still carries an identifier is dropped. */
function cleanProofTrace(raw) {
  if (!Array.isArray(raw)) return [];
  const num = (x) => (Number.isFinite(Number(x)) ? Math.max(0, Math.min(100000, Math.round(Number(x)))) : 0);
  const word = (x) => (typeof x === "string" && /^[A-Za-z-]{1,32}$/.test(x) ? x : "");
  return raw.slice(0, 60).filter((t) => t && typeof t === "object" && !Array.isArray(t)).map((t) => ({
    resource: word(t.resource),
    status: word(t.status),
    tried: num(t.tried),
    attempts: (Array.isArray(t.attempts) ? t.attempts : []).slice(0, 12)
      .filter((a) => a && typeof a.path === "string" && a.path.length <= 256 && !/\d{3,}/.test(a.path) && a.path.indexOf("@") < 0)
      .map((a) => ({
        method: a.method === "POST" ? "POST" : "GET",
        path: a.path,
        role: word(a.role),
        kind: word(a.kind),
        hits: num(a.hits),
        ratio: Math.max(0, Math.min(1, Number(a.ratio) || 0)),
      })),
  }));
}
```

- [ ] **Step 4: Store it** (discovery route)

Change `const observedViews = cleanObservedViews(body.observedViews);` (line ~920) to:

```js
      const observedViews = cleanObservedViews(body.observedViews);
      const proofTrace = cleanProofTrace(body.proofs);
```

Change the `phoneState` object (line ~1038) to:

```js
      const phoneState = {
        manifest, probes,
        offlineValidation,
        requestedBy,
        requestedAt: nowIso(),
        observedEvents: (Array.isArray(spec.events) ? spec.events : []).slice(0, 200),
        observedViews,
        proofTrace,
      };
```

In the `GET /versions/:id` response (line ~1187), after `views,` add:

```js
        proofTrace: phoneState && Array.isArray(phoneState.proofTrace) ? phoneState.proofTrace : [],
```

- [ ] **Step 5: Send it from the phone** (`connect-agent/phone/index.mjs:361`)

```js
  const discoveryResult = await api.discovery({ spec, steps: explored.steps, nativeRequests, observedViews, proofs: book.trace });
```

- [ ] **Step 6: Run the tests**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/phone-router.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/phone-index.test.mjs`
Expected: PASS (all tests in both files).

- [ ] **Step 7: Commit**

```bash
git add functions/api/connect/agent/\[\[path\]\].js connect-agent/phone/index.mjs test/connect/agent/phone-router.test.mjs
git commit -m "Connect Agent: keep the per-screen proof trace so a run explains itself"
```

---

### Task 2: Proof picks the call that returns only the list, and checks the ward list

**Files:**
- Modify: `connect-agent/phone/prove.mjs:457-491` (the EXECUTE + VERIFY loop), new export `specificity`
- Modify: `functions/_connect/agent/brain.js:196` (export `promptFor`), `:231` (worklist wording)
- Test: `test/connect-agent/prove.test.mjs`, `test/connect/agent/brain.test.mjs`

**Interfaces:**
- Consumes: `accepted`, `overlapOf`, `responseKind`, `rowsForChain`, `candidateStructure`, `narrativeExcerpt`, `identityValues` (all in `prove.mjs`).
- Produces: `export function specificity(hit, screenRowCount) -> number` where `hit = { resp: { text }, o: { ratio }, rows: [] }`. `proveView` contract unchanged except: every candidate up to `MAX_EXEC` is executed, and `worklist` is judged by `brain.verify`. `export function promptFor(clean) -> string` in `brain.js`.

- [ ] **Step 1: Write the failing tests** (append to `test/connect-agent/prove.test.mjs`; `HOST`, `WL_JSON`, `fakePage`, `rowsForChain`, `proveView` already exist in that file)

```js
test('proveView takes the lab search list, not the whole visit page that also shows the lab names (ver_b16da370)', async () => {
  const VISIT_PAGE = '<html><body><table><tr><th>Test</th></tr><tr><td>Complete blood count</td></tr><tr><td>Serum creatinine</td></tr></table><table>' +
    '<tr><td>Pulse</td><td>Blood pressure</td></tr>'.repeat(40) + '</table></body></html>';
  const LABS_JSON = JSON.stringify([
    { parameter_long_desc: 'Complete blood count', ServiceRenderId: 'R77001' },
    { parameter_long_desc: 'Serum creatinine', ServiceRenderId: 'R77002' },
  ]);
  const entries = [
    { seq: 21, method: 'POST', url: HOST + '/Doctor/Home/Searchnew', body: '__RequestVerificationToken=abc&recordNo=MR900001-IP5550001', reqCt: 'application/x-www-form-urlencoded', xhr: true, status: 200, shape: { kind: 'html', keys: ['Test'], rows: 42, tables: 2 } },
    { seq: 22, method: 'POST', url: HOST + '/Lab/Home/GetSearchPatientId', body: '__RequestVerificationToken=abc&patient_id=MR900001&DeptID=', reqCt: 'application/x-www-form-urlencoded', xhr: true, status: 200, shape: { kind: 'json', keys: ['parameter_long_desc'], rows: 2 } },
  ];
  const page = fakePage({
    entries,
    screen: [['Complete blood count'], ['Serum creatinine']],
    answers: { 21: { status: 200, contentType: 'text/html', text: VISIT_PAGE }, 22: { status: 200, contentType: 'application/json', text: LABS_JSON } },
  });
  // Gemini ranks the visit page first, as it did on the live run.
  const brain = { async pickEndpoint() { return { ranked: [{ index: 0, role: 'data' }, { index: 1, role: 'data' }] }; } };
  const view = { resourceHint: 'labs', pathTemplate: HOST + '/Doctor/Home', rowsSelector: 'tr', headers: ['Test'] };
  await proveView({ client: page, view, brain, parents: [{ label: 'worklist', rows: rowsForChain(WL_JSON, 'application/json') }] });
  assert.deepEqual(page.executed, [21, 22], 'every candidate is replayed, not only the first that carries the screen');
  assert.equal(view.proof.status, 'proven');
  assert.equal(view.endpoints.find((e) => e.role === 'data').path.split('?')[0], '/Lab/Home/GetSearchPatientId');
});

test('proveView asks Gemini about the ward list too: an out-patient queue is not the admitted list', async () => {
  const OPD_HTML = '<table><tr><th>Patient ID</th><th>Name</th><th>Visit type</th></tr><tr><td>MR900001</td><td>TEST ALPHA</td><td>OPD</td></tr><tr><td>MR900002</td><td>TEST BRAVO</td><td>OPD</td></tr></table>';
  const entries = [{ seq: 31, method: 'GET', url: HOST + '/Doctor/Home/DashboardUnit?type=docopdlist', body: null, xhr: true, status: 200, shape: { kind: 'html', keys: ['Patient ID', 'Name', 'Visit type'], rows: 2, tables: 1 } }];
  const judged = [];
  const brain = { async verify(p) { judged.push(p); return { ok: false, resource: 'none', confidence: 0.9, reason: 'out-patient queue' }; } };
  const view = { resourceHint: 'worklist', pathTemplate: HOST + '/Doctor/Home', rowsSelector: 'tr', headers: ['Patient ID', 'Name', 'Visit type'] };
  await proveView({
    client: fakePage({ entries, screen: [['MR900001', 'TEST ALPHA', 'OPD'], ['MR900002', 'TEST BRAVO', 'OPD']], answers: { 31: { status: 200, contentType: 'text/html', text: OPD_HTML } } }),
    view, brain,
  });
  assert.equal(judged.length, 1, 'the ward list reply was judged');
  assert.equal(judged[0].resource, 'worklist');
  assert.ok(!/MR900001|ALPHA/.test(JSON.stringify(judged[0])), 'only structure reached the model');
  assert.equal(view.proof.status, 'unproven');
  assert.equal(view.endpoints, undefined);
});
```

Append to `test/connect/agent/brain.test.mjs` (add `promptFor` to that file's existing import from `../../../functions/_connect/agent/brain.js`):

```js
test("verify tells the model a ward list is admitted in-patients, not an out-patient queue", () => {
  const p = promptFor({ op: "verify", resource: "worklist", rowCount: 2, headers: ["Patient ID", "Visit type"], kind: "html" });
  assert.match(p, /ADMITTED in-patients/);
  assert.match(p, /not an out-patient or OPD queue/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/prove.test.mjs; node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/brain.test.mjs`
Expected: FAIL. The labs test proves `/Doctor/Home/Searchnew` (executed `[21]`), the worklist test has `judged.length === 0` and status `proven`, and `promptFor` is not exported.

- [ ] **Step 3: Add `specificity`** (in `prove.mjs`, directly above `/* ---- the loop ---`)

```js
/* THE LIST, NOT THE PAGE THAT CONTAINS IT. A whole patient page carries every lab name and every
 * radiology line the screen shows, so "carries the screen's values" accepted GHIS's visit page
 * (POST Searchnew) as the labs call and the visits page as radiology (adapter ver_b16da370,
 * 2026-09-15), where the hand-built adapter calls the lab search and the radiology list. Every answer
 * that carries the screen is scored: rows that fit the screen win, a whole HTML document and a large
 * answer lose. */
export function specificity(hit, screenRowCount) {
  const text = String((hit && hit.resp && hit.resp.text) || '');
  const rows = Array.isArray(hit && hit.rows) ? hit.rows.length : 0;
  const fit = screenRowCount > 0 && rows > 0 ? Math.min(rows, screenRowCount) / Math.max(rows, screenRowCount) : 0;
  const wholePage = /<html[\s>]/i.test(text.slice(0, 2000)) ? 1 : 0;
  const size = Math.min(1, text.length / 200000);
  return ((hit && hit.o && hit.o.ratio) || 0) + fit - wholePage - size;
}
```

- [ ] **Step 4: Replace the EXECUTE + VERIFY loop** (`prove.mjs`, from `// EXECUTE + VERIFY, in that order, until one answers with what the screen shows.` through `if (!hit) return done('unproven');`)

```js
  // EXECUTE + VERIFY every candidate (up to MAX_EXEC): keep each answer that carries the screen and that
  // Gemini did not confidently reject, then take the most specific of them.
  const hits = [];
  for (const r of tryFirst.slice(0, MAX_EXEC)) {
    const e = entries[r.index];
    const resp = await evalJson(client, PROVE_SOURCES.exec(e.seq), null);
    const kind = responseKind(resp);
    const o = kind === 'login' || kind === 'empty' ? { hits: 0, cells: cells.length, ratio: 0 } : overlapOf(cells, resp.text, resp.contentType);
    trace.tried.push({ method: e.method, path: candidateStructure(e).path.replace(/\d{3,}/g, '#'), role: r.role, kind, hits: o.hits, ratio: o.ratio });
    if (kind === 'login') return done('signed-out');
    // A whole page that happens to carry the table is where the view lives, not a data call.
    if (!accepted(o) || (r.role === 'shell' && (e.shape || {}).page && !e.xhr)) continue;
    const rows = rowsForChain(resp.text, resp.contentType);
    /* GEMINI JUDGES THE REPLY, the ward list included: an out-patient queue carries patients too, and
     * was proven as the ward list on the live run (DashboardUnit, 2026-09-15). Only column names, a row
     * count and the redacted path go to the model. A confident "no" rejects it. */
    const resource = String(view.resourceHint || '').replace(/-detail$/, '');
    if (brain && typeof brain.verify === 'function' && BRAIN_RESOURCES.includes(resource)) {
      const cols = [];
      for (const row of rows.slice(0, 5)) for (const k of Object.keys(row)) if (k.charAt(0) !== '_' && !cols.includes(k)) cols.push(k);
      const payload = scrubForBrain({ resource, headers: cols.slice(0, 24), rowCount: rows.length, kind: kind === 'json' ? 'json' : 'html', path: candidateStructure(e).path });
      if (NARRATIVE.includes(resource)) {
        const ex = narrativeExcerpt(rows, identityValues(parents));
        if (ex) payload.excerpt = ex;
      }
      let v = null;
      try { v = await brain.verify(payload); } catch { v = null; }
      const last = trace.tried[trace.tried.length - 1];
      if (v && typeof v.ok === 'boolean') { trace.brain = true; trace.model = trace.model || v.model || null; last.gemini = v.ok ? 'ok' : 'rejected'; }
      if (v && v.ok === false && Number(v.confidence) >= 0.7) continue;
    }
    hits.push({ e, resp, kind, o, rows, role: r.role === 'shell' ? 'data' : r.role });
  }
  const hit = hits.slice().sort((a, b) => specificity(b, shown.length) - specificity(a, shown.length))[0] || null;
  if (!hit) return done('unproven');
```

- [ ] **Step 5: Brain wording and export** (`functions/_connect/agent/brain.js`)

Line 196: `function promptFor(clean) {` becomes `export function promptFor(clean) {`.

In the verify prompt (line ~231) replace
`worklist = many patients of a ward, not a list of doctors, departments or menu items;`
with
`worklist = ADMITTED in-patients of a ward (a bed, ward or admission column), not an out-patient or OPD queue and not a list of doctors, departments or menu items;`

- [ ] **Step 6: Run the tests**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/prove.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/brain.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/verify.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/deep-crawl.test.mjs`
Expected: PASS. The existing test "Gemini ranks the wrong call first" still passes: all three candidates execute and only GetMedicines is accepted.

- [ ] **Step 7: Commit**

```bash
git add connect-agent/phone/prove.mjs functions/_connect/agent/brain.js test/connect-agent/prove.test.mjs test/connect/agent/brain.test.mjs
git commit -m "Connect Agent: prove the call that returns the list, not the page that contains it; judge the ward list"
```

---

### Task 3: A patient read never opens a page, and says what it could not read

**Files:**
- Modify: `connect-agent/phone/runtime.mjs` (new `provenView`; `readPatientDetails` lines 390-465; delete `fallbackView` lines 382-388)
- Modify: `connect-agent/phone/ghis-shim.mjs` (new `notRead`; `serveGhisProxy` cases `lab`, `radiology`, `medications`)
- Modify: `ghis-ward.js` (new `notReadHtml` after `adapterServe`; `loadMedications`, `loadLabs`, `loadRadiology`)
- Test: `test/connect-agent/phone-runtime.test.mjs`, `test/connect-agent/ghis-shim.test.mjs`, `test/run-ward-adapter-ui.mjs`

**Interfaces:**
- Produces: `export function provenView(v) -> boolean` (runtime.mjs). `readPatientDetails` sections are now one of `{ resource, rows, via: 'endpoint', roles? }`, `{ resource, unreadable: 'not-proven' }`, `{ resource, error }`. `export function notRead(sections, resource, label) -> {} | { unreadable: string }` (ghis-shim.mjs). Proxy bodies for `/lab`, `/radiology`, `/medications` may carry `unreadable`.

- [ ] **Step 1: Write the failing runtime test** (in `test/connect-agent/phone-runtime.test.mjs` replace the whole test `'readPatientDetails reads each detail view for the patient and keeps per-view errors'` with the test below, and add `import { parseFetchExpression } from '../../connect-agent/phone/adapter-runtime.mjs';` under the existing imports)

```js
test('readPatientDetails never opens a page: an unproven screen is unreadable, a proven one replays its call', async () => {
  const navigated = [];
  const plugin = {
    async navigate(a) { navigated.push(a.url); },
    async currentUrl() { return { url: 'https://h/home' }; },
    async evaluate({ expression }) {
      const req = parseFetchExpression(expression);
      if (!req) return { result: '{}' };
      const text = /GetMeds/.test(req.url) ? '[{"Drug":"Amox"}]' : '[]';
      return { result: JSON.stringify({ status: 200, contentType: 'application/json', url: req.url, text }) };
    },
  };
  const proven = (resourceHint, path) => ({ resourceHint, pathTemplate: 'https://h/home', rowsSelector: 'tr', headers: ['Drug'], proof: { status: 'proven' }, endpoints: [{ method: 'GET', path, role: 'data', params: { id: { from: 'worklist', field: 'patientId' } } }] });
  const replay = [
    { resourceHint: 'labs', pathTemplate: 'https://h/labs/{id}', rowsSelector: 'tr', headers: ['Test'], proof: { status: 'unproven' } },
    proven('medications', '/GetMeds?id'),
    proven('radiology', '/GetRad?id'),
  ];
  const secs = await readPatientDetails({ plugin, origin: 'https://h', replay, patient: { patientId: 'K1' }, settleMs: 0 });
  assert.deepEqual(navigated, [], 'no page was loaded');
  assert.deepEqual(secs.find((s) => s.resource === 'labs'), { resource: 'labs', unreadable: 'not-proven' });
  assert.deepEqual(secs.find((s) => s.resource === 'medications').rows, [{ Drug: 'Amox' }]);
  assert.deepEqual(secs.find((s) => s.resource === 'radiology').rows, [], 'proven and empty is an empty answer, not a missing one');
});
```

- [ ] **Step 2: Write the failing shim test** (append to `test/connect-agent/ghis-shim.test.mjs`; add `notRead` to that file's existing import from `../../connect-agent/phone/ghis-shim.mjs`)

```js
test('absent is not negative: a section the adapter could not read says so, an empty one does not', () => {
  const sections = [
    { resource: 'labs', unreadable: 'not-proven' },
    { resource: 'radiology', error: 'request failed in the page: aborted' },
    { resource: 'medications', rows: [], via: 'endpoint' },
  ];
  assert.match(notRead(sections, 'labs', 'Lab results').unreadable, /^Lab results were not read: the agent never learned this screen for this hospital\./);
  assert.match(notRead(sections, 'radiology', 'Radiology reports').unreadable, /^Radiology reports were not read: the hospital did not answer\./);
  assert.deepEqual(notRead(sections, 'medications', 'Medications'), {}, 'proven and empty is "none"');
  assert.match(notRead([], 'medications', 'Medications').unreadable, /never learned/, 'no screen at all is not read either');
  const body = serveGhisProxy({ path: '/lab?patientId=K1', sections, patient: { patientId: 'K1' } }).body;
  assert.deepEqual(body.orders, []);
  assert.match(body.unreadable, /^Lab results were not read/);
  assert.equal(/—/.test(body.unreadable), false, 'no em-dash');
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/phone-runtime.test.mjs; node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/ghis-shim.test.mjs`
Expected: FAIL. The runtime test navigates to `https://h/labs/K1`, and `notRead` is not exported.

- [ ] **Step 4: Implement `provenView`** (`runtime.mjs`, directly under `viewsByResource`)

```js
/** A view discovery proved: its data call is known and was replayed against the screen. */
export function provenView(v) {
  return !!(v && v.proof && v.proof.status === 'proven' && Array.isArray(v.endpoints) && v.endpoints.some((e) => e && e.role === 'data'));
}
```

- [ ] **Step 5: Rewrite the per-resource head of `readPatientDetails`** (`runtime.mjs`)

Replace from `/* Where to look, in order: the view's own page with the patient filled in` through `try { replayed = await replayFirst({ plugin, origin: vo, view: v, patient, onRead }); } catch (e) { if (e && e.name === 'NotSignedIn') throw e; replayed = null; }` with:

```js
    /* NEVER A PAGE. A screen discovery could not prove is reported unreadable, never loaded and scraped:
     * reading GHIS pages for one patient sat on a two-link menu for 30 minutes on the owner's iPhone
     * (2026-09-15). The hand-built adapter never loads a page either. */
    if (!provenView(v)) { sections.push({ resource: r, unreadable: 'not-proven' }); continue; }
    let replayed = null;
    const vo = viewOrigin(v, origin);
    try { replayed = await replayFirst({ plugin, origin: vo, view: v, patient, onRead }); } catch (e) {
      if (e && e.name === 'NotSignedIn') throw e;
      sections.push({ resource: r, error: String((e && e.message) || e) });
      continue;
    }
```

- [ ] **Step 6: Replace the page fallback at the end of the loop** (`runtime.mjs`)

Replace everything from `const own = fillPath(v.pathTemplate || v.path, patient);` through `sections.push(withRoles({ resource: r, rows, via: 'page' }, v));` with:

```js
    // Proven, and this patient has none (no medicines charted): an empty answer, not a missing one.
    sections.push(withRoles({ resource: r, rows: [], via: 'endpoint' }, v));
```

Delete `function fallbackView(view) { ... }` and its comment block (lines 382-388): nothing calls it any more. Verify with `grep -n fallbackView connect-agent/phone/*.mjs`, expected no output.

- [ ] **Step 7: Implement `notRead` and wire it** (`ghis-shim.mjs`, directly above `serveGhisProxy`)

```js
/* ABSENT IS NOT NEGATIVE (rulebook 5.2). A resource the adapter could not read says so, so "no
 * medicines" on screen always means the hospital has none. */
export function notRead(sections, resource, label) {
  const own = (Array.isArray(sections) ? sections : []).filter((s) => s && s.resource === resource);
  if (own.some((s) => Array.isArray(s.rows))) return {};
  const why = own.some((s) => s.error) ? 'the hospital did not answer.' : 'the agent never learned this screen for this hospital. Run Connect Hospital again to teach it.';
  return { unreadable: label + ' were not read: ' + why };
}
```

In `serveGhisProxy` replace the three cases:

```js
    case 'lab': return { status: 200, body: Object.assign({ orders: labOrders(sections, patient).orders }, notRead(sections, 'labs', 'Lab results')) };
```
```js
    case 'radiology': return { status: 200, body: Object.assign({ orders: radiologyOrders(sections, patient).orders }, notRead(sections, 'radiology', 'Radiology reports')) };
```
```js
    case 'medications': return { status: 200, body: Object.assign(medicationRows(sections), notRead(sections, 'medications', 'Medications')) };
```

- [ ] **Step 8: Show it in the drawer** (`ghis-ward.js`)

Insert directly after the closing `}` of `function adapterServe(path, init) { ... }`:

```js
      /* ABSENT IS NOT NEGATIVE: a section the adapter could not read says why, never "none found". */
      function notReadHtml(j) {
        var why = j && (j.unreadable || (j.error === 'adapter_read_failed' ? (j.detail || 'The hospital could not be read.') : ''));
        return why ? '<div class="ghis-lab-empty">' + esc(why) + '</div>' : '';
      }
```

In `loadMedications`, change `var rows = (j && j.rows) || [];` to:

```js
              var nr = notReadHtml(j);
              if (nr) { sec.innerHTML = nr; return; }
              var rows = (j && j.rows) || [];
```

In `loadLabs`, directly before `var orders = (j && j.orders) || [];` insert:

```js
              var nr = notReadHtml(j);
              if (nr) { body.innerHTML = nr; return; }
```

In `loadRadiology`, change `var orders = (j && j.orders) || [];` to:

```js
              var nr = notReadHtml(j);
              if (nr) { sec.innerHTML = nr; return; }
              var orders = (j && j.orders) || [];
```

- [ ] **Step 9: Update the browser harness** (`test/run-ward-adapter-ui.mjs`)

The KIMS medications view is an unproven page view, so it is now unreadable. Replace the assertions at lines 165, 166 and 174-177:

```js
  ok(await ev(`return fetch(window.GHIS.getProxyBase()+"/medications?patientId=K001").then(function(r){return r.json();}).then(function(j){ return j.rows && j.rows.length===0 && /^Medications were not read/.test(j.unreadable); });`) === true, "GET /medications for a screen the agent never proved says it was not read");
  ok(await ev(`return fetch(window.GHIS.getProxyBase()+"/profile?patientId=K001").then(function(r){return r.json();}).then(function(j){ return j.medications.length===0 && Array.isArray(j.labs) && Array.isArray(j.radiology); });`) === true, "GET /profile merges the cached patient views without a second browser read");
```
```js
  await ev(`document.querySelector("#ghisPatientList .ghis-pt-card").click(); return 1;`);
  ok(await waitFor(`return document.getElementById("ghisLabBody").innerText.indexOf("Medications were not read")>=0;`, 8000), "the drawer says medications were not read instead of showing nothing");
  ok(await ev(`return document.getElementById("ghisLabTitle").textContent==="Ravi Kumar (K001)";`) === true, "drawer titled with the patient");
  ok(await ev(`return !window.__pluginCalls.some(function(c){return c.m==="navigate"&&/\\/ip\\/meds\\//.test(c.a.url);}) && window.__open===false;`) === true, "the patient read never loaded a page and closed the browser");
```

The Apollo medications view must be proven to keep replaying. In `MOCK`, replace the `resourceHint: "medications"` entry of `/versions/ver-r` with:

```js
    { resourceHint: "medications", pathTemplate: "https://his.apollo.example/ward/list", method: "GET", rowsSelector: "#rx tbody tr", headers: ["Drug", "Dose", "Route"], singleRecord: false,
      proof: { status: "proven", kind: "html" },
      endpoints: [
        { method: "POST", path: "/api/visit/activate", bodyKeys: ["__RequestVerificationToken", "recordNo"], requestKind: "form", role: "prerequisite", params: { __RequestVerificationToken: { token: true }, recordNo: { from: "worklist", field: "MRN" } } },
        { method: "GET", path: "/api/ward/medications?mrn", role: "data", params: { mrn: { from: "worklist", field: "MRN" } } } ] } ] } });
```

- [ ] **Step 10: Run the tests**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/phone-runtime.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/ghis-shim.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/phone-runtime-endpoints.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/live-ghis-regressions.test.mjs && node test/run-ward-adapter-ui.mjs`
Expected: PASS, harness ends with `ALL GREEN - ward adapter UI test passed`.

- [ ] **Step 11: Commit**

```bash
git add connect-agent/phone/runtime.mjs connect-agent/phone/ghis-shim.mjs ghis-ward.js test/connect-agent/phone-runtime.test.mjs test/connect-agent/ghis-shim.test.mjs test/run-ward-adapter-ui.mjs
git commit -m "Connect Agent: a patient read never opens a page, and says what it could not read"
```

---

### Task 4: Every read ends

**Files:**
- Modify: `connect-agent/phone/adapter-runtime.mjs:24-42` (`FETCH_TIMEOUT_MS`, `fetchExpression`)
- Modify: `ghis-ward.js` (`withDeadline` above `adapterSections`; `adapterSections`)
- Test: `test/connect-agent/adapter-runtime.test.mjs`, `test/run-ward-adapter-ui.mjs`

**Interfaces:**
- Produces: `export const FETCH_TIMEOUT_MS = 12000`; `fetchExpression(req)` accepts `req.timeoutMs`; the parsed request carries `timeoutMs`. `window.__SMD_ADAPTER_DEADLINE_MS__` (test seam) overrides the 30000 ms whole-read deadline. Timeout message: `The hospital did not answer in time, so the reading was stopped. Try again.`

- [ ] **Step 1: Write the failing unit test** (append to `test/connect-agent/adapter-runtime.test.mjs`; add `FETCH_TIMEOUT_MS` to that file's existing import from `../../connect-agent/phone/adapter-runtime.mjs`, and `fetchExpression`, `parseFetchExpression` if not already imported)

```js
test('every in-page request has its own deadline: a hospital that never answers is aborted', async () => {
  assert.equal(parseFetchExpression(fetchExpression({ method: 'GET', url: 'https://h/x' })).timeoutMs, FETCH_TIMEOUT_MS);
  const expr = fetchExpression({ method: 'GET', url: 'https://h/x', timeoutMs: 30 });
  assert.equal(parseFetchExpression(expr).timeoutMs, 30);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  try {
    const t0 = Date.now();
    const out = JSON.parse(await new Function('return ' + expr)());
    assert.equal(out.status, 0);
    assert.match(out.error, /aborted/);
    assert.ok(Date.now() - t0 < 2000, 'aborted at its deadline');
  } finally { globalThis.fetch = realFetch; }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/adapter-runtime.test.mjs`
Expected: FAIL, `FETCH_TIMEOUT_MS` is undefined.

- [ ] **Step 3: Implement the per-request deadline** (`adapter-runtime.mjs`)

Under `const MAX_TEXT = 2 * 1024 * 1024;` add:

```js
/* EVERY REQUEST ENDS. A hospital page that never answers held a patient read for 30 minutes
 * (owner's iPhone, 2026-09-15): each in-page request is aborted at this deadline. */
export const FETCH_TIMEOUT_MS = 12000;
```

Replace `fetchExpression` with:

```js
export function fetchExpression(req) {
  const safe = {
    method: req.method === 'POST' ? 'POST' : 'GET',
    url: String(req.url || ''),
    headers: Object.assign({ 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/html, */*' }, req.headers || {}),
    body: req.body == null ? null : String(req.body),
    max: MAX_TEXT,
    timeoutMs: Number(req.timeoutMs) > 0 ? Number(req.timeoutMs) : FETCH_TIMEOUT_MS,
  };
  return '(function(){var req=' + JSON.stringify(safe) + ';' +
    'var init={method:req.method,credentials:"include",headers:req.headers,redirect:"follow"};' +
    'if(req.body!=null){init.body=req.body;if(!init.headers["Content-Type"])init.headers["Content-Type"]="application/x-www-form-urlencoded; charset=UTF-8";}' +
    'if(typeof AbortController==="function"){var ac=new AbortController();init.signal=ac.signal;setTimeout(function(){ac.abort();},req.timeoutMs);}' +
    'return fetch(req.url,init).then(function(r){return r.text().then(function(t){return JSON.stringify({status:r.status,contentType:r.headers.get("content-type")||"",url:r.url,text:t.length>req.max?t.slice(0,req.max):t,truncated:t.length>req.max});});})' +
    '.catch(function(e){return JSON.stringify({status:0,contentType:"",url:req.url,text:"",error:String(e&&e.message||e)});});})()';
}
```

- [ ] **Step 4: Implement the whole-read deadline** (`ghis-ward.js`)

Directly above `function adapterSections(patientId) {` insert:

```js
      /* EVERY READ ENDS. Each hospital request is bounded (adapter-runtime FETCH_TIMEOUT_MS); this bounds
       * the whole patient read, so a hospital that stops answering can never hold the drawer open for
       * 30 minutes again (owner's iPhone, 2026-09-15). */
      var ADAPTER_READ_DEADLINE_MS = 30000;
      var READ_TIMED_OUT = 'The hospital did not answer in time, so the reading was stopped. Try again.';
      function withDeadline(promise, ms) {
        return new Promise(function (resolve, reject) {
          var t = setTimeout(function () { reject(new Error(READ_TIMED_OUT)); }, ms);
          promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
      }
```

In `adapterSections`, change `ctx.sections[patientId] = loadWardRuntime().then(function (rt) {` to `ctx.sections[patientId] = withDeadline(loadWardRuntime().then(function (rt) {`, and change the line `}).then(function (sections) {` that follows the inner `return plugin.open(...)` block to:

```js
        }), window.__SMD_ADAPTER_DEADLINE_MS__ || ADAPTER_READ_DEADLINE_MS).then(function (sections) {
```

- [ ] **Step 5: Add the harness scenario** (`test/run-ward-adapter-ui.mjs`)

In `FAKE_PLUGIN`, first line inside the `if (e.indexOf("var req={") === 0 || ...)` branch, before `var m = ...`, add:

```js
      if (window.__hang) return new Promise(function () {});
```

After the assertion `"the activation POST carried the page token and the record number, before the data call"` and before `await ev(\`window.ghisDisconnect(); window.__replayHospital = false; return 1;\`);` add:

```js
  // EVERY READ ENDS: a hospital that never answers is stopped at the deadline with a reason.
  await ev(`window.__SMD_ADAPTER_DEADLINE_MS__ = 600; window.__hang = true; return 1;`);
  const t0 = Date.now();
  ok(await ev(`return fetch(window.GHIS.getProxyBase()+"/medications?patientId=A101").then(function(r){return r.json();}).then(function(j){ return j.error==="adapter_read_failed" && /did not answer in time/.test(j.detail); });`) === true, "a read that never answers is stopped with a reason");
  ok(Date.now() - t0 < 5000, "stopped at the deadline, not after minutes");
  ok(await ev(`return window.__open===false;`) === true, "the browser is closed after a timed-out read");
  await ev(`window.__hang = false; window.__SMD_ADAPTER_DEADLINE_MS__ = 0; return 1;`);
```

- [ ] **Step 6: Run the tests**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/adapter-runtime.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/prove.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/live-ghis-regressions.test.mjs && node test/run-ward-adapter-ui.mjs`
Expected: PASS, `ALL GREEN`.

- [ ] **Step 7: Commit**

```bash
git add connect-agent/phone/adapter-runtime.mjs ghis-ward.js test/connect-agent/adapter-runtime.test.mjs test/run-ward-adapter-ui.mjs
git commit -m "Connect Agent: every hospital request and every patient read has a deadline"
```

---

### Task 5: Read only when the native browser confirms it is hidden

**Files:**
- Modify: `local-plugins/capacitor-connect-browser/ios/Sources/ConnectBrowserPlugin/ConnectBrowserPlugin.swift:194` (`open` resolve), `:265` (`setMode` resolve)
- Modify: `android/app/src/main/java/in/stewardmd/app/ConnectBrowserPlugin.java` (`open` resolve ~line 199, `setMode` resolve ~line 403)
- Modify: `ghis-ward.js` (`HIDDEN_REFUSED`; `adapterSections`; ward list `setMode` at line ~594)
- Test: `test/run-ward-adapter-ui.mjs`

**Interfaces:**
- Produces: plugin `open` resolves `{ ok: true, hidden: boolean, contract: "hidden-v2" }`; `setMode` resolves `{ ok: true, hidden: boolean }`. JS reads nothing unless `hidden === true` is reported by both. Refusal message: `This app version cannot read the hospital out of sight, so nothing was read. Update the app and try again.`

- [ ] **Step 1: Make the harness plugin honest and add the failing scenario** (`test/run-ward-adapter-ui.mjs`)

In `FAKE_PLUGIN` replace the `open:` and `setMode:` lines with:

```js
  open: function (a) { window.__pluginCalls.push({ m: "open", a: a }); window.__url = a.url; window.__open = true; return Promise.resolve(window.__staleHidden ? { ok: true } : { ok: true, hidden: a.hidden === true, contract: "hidden-v2" }); },
```
```js
  setMode: function (a) { window.__pluginCalls.push({ m: "setMode", a: a }); return Promise.resolve(window.__staleHidden ? { ok: true } : { ok: true, hidden: a.hidden === true && a.mode !== "login" }); },
```

Directly after the Task 4 deadline scenario add:

```js
  // LAW III: a native browser that does not confirm it is hidden is never read through.
  await ev(`window.__staleHidden = true; window.__fetchMark = window.__fetches.length; return 1;`);
  ok(await ev(`return fetch(window.GHIS.getProxyBase()+"/medications?patientId=A101").then(function(r){return r.json();}).then(function(j){ return j.error==="adapter_read_failed" && /out of sight/.test(j.detail); });`) === true, "a browser that does not confirm hidden reads nothing and says why");
  ok(await ev(`return window.__fetches.length===window.__fetchMark && window.__open===false;`) === true, "no hospital request was issued and the browser was closed");
  await ev(`window.__staleHidden = false; return 1;`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/run-ward-adapter-ui.mjs`
Expected: `FAIL a browser that does not confirm hidden reads nothing and says why`.

- [ ] **Step 3: Refuse in JS** (`ghis-ward.js`)

Next to `var READ_TIMED_OUT = ...` add:

```js
      var HIDDEN_REFUSED = 'This app version cannot read the hospital out of sight, so nothing was read. Update the app and try again.';
```

In `adapterSections` replace

```js
          return plugin.open({ url: targetOrigin, origins: ctx.origins, storeId: ctx.conn.deploymentId, title: ctx.host, initScript: '', hidden: true }).then(function () {
            try { plugin.setMode({ mode: 'agent', banner: 'Reading ' + ctx.host + ' for this patient', origins: ctx.origins, hidden: true }); } catch (e) {}
            return rt.readPatientDetails({ plugin: plugin, origin: targetOrigin, replay: ctx.replay, patient: p || { patientId: patientId } });
          });
```

with

```js
          /* LAW III, ENFORCED HERE. The iPhone showed the hospital page over the whole screen during a
           * patient read although hidden was asked for (2026-09-15): a build can carry a plugin that
           * ignores the flag. The native side must confirm hidden, or nothing is read. */
          return plugin.open({ url: targetOrigin, origins: ctx.origins, storeId: ctx.conn.deploymentId, title: ctx.host, initScript: '', hidden: true }).then(function (opened) {
            if (!opened || opened.hidden !== true) throw new Error(HIDDEN_REFUSED);
            return plugin.setMode({ mode: 'agent', banner: 'Reading ' + ctx.host + ' for this patient', origins: ctx.origins, hidden: true });
          }).then(function (moded) {
            if (!moded || moded.hidden !== true) throw new Error(HIDDEN_REFUSED);
            return rt.readPatientDetails({ plugin: plugin, origin: targetOrigin, replay: ctx.replay, patient: p || { patientId: patientId } });
          });
```

In `ghisOpenAdapterHospital` replace

```js
          try { plugin.setMode({ mode: 'agent', banner: 'Reading ' + host + ' for your ward list', origins: ctx.origins, hidden: true }); } catch (e) {}
          return agentApi('/sessions/' + encodeURIComponent(ctx.sessionId) + '/handoff', it.tid, { method: 'POST', body: JSON.stringify({ visitedOrigins: [origin] }) });
```

with

```js
          return Promise.resolve(plugin.setMode({ mode: 'agent', banner: 'Reading ' + host + ' for your ward list', origins: ctx.origins, hidden: true })).then(function (moded) {
            if (!moded || moded.hidden !== true) { ctx.browserOpen = false; try { plugin.close(); } catch (x) {} throw new Error(HIDDEN_REFUSED); }
            return agentApi('/sessions/' + encodeURIComponent(ctx.sessionId) + '/handoff', it.tid, { method: 'POST', body: JSON.stringify({ visitedOrigins: [origin] }) });
          });
```

- [ ] **Step 4: Report hidden from iOS** (`ConnectBrowserPlugin.swift`)

In `open`, replace `call.resolve(["ok": true])` (line ~194) with:

```swift
            call.resolve(["ok": true, "hidden": self.hiddenRead, "contract": "hidden-v2"])
```

In `setMode`, replace `call.resolve(["ok": true])` (line ~265) with:

```swift
            call.resolve(["ok": true, "hidden": self.hiddenRead])
```

- [ ] **Step 5: Report hidden from Android** (`ConnectBrowserPlugin.java`)

In `open`'s `run()` replace

```java
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
```

(the one directly after `notifyListeners("opened", opened);`) with

```java
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("hidden", hidden);
                ret.put("contract", "hidden-v2");
                call.resolve(ret);
```

In `setMode`'s `run()` replace the same three lines (directly after `applyModeUi(banner);`) with

```java
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("hidden", hidden);
                call.resolve(ret);
```

- [ ] **Step 6: Compile both plugins**

```bash
export DEVELOPER_DIR="/Applications/Xcode-beta 2.app/Contents/Developer"
(cd local-plugins/capacitor-connect-browser && xcodebuild -scheme StewardmdCapacitorConnectBrowser -destination 'generic/platform=iOS' build 2>&1 | grep -E "BUILD SUCCEEDED|BUILD FAILED|error:" | head -5)
(cd android && ./gradlew :app:compileDebugJavaWithJavac 2>&1 | grep -E "BUILD SUCCESSFUL|BUILD FAILED|error:" | head -5)
```
Expected: `BUILD SUCCEEDED` and `BUILD SUCCESSFUL`. If `xcodebuild -scheme` reports no such scheme, run `xcodebuild -list` in that directory and use the listed library scheme.

- [ ] **Step 7: Run the harness**

Run: `node test/run-ward-adapter-ui.mjs`
Expected: `ALL GREEN - ward adapter UI test passed`.

- [ ] **Step 8: Commit**

```bash
git add ghis-ward.js local-plugins/capacitor-connect-browser/ios/Sources/ConnectBrowserPlugin/ConnectBrowserPlugin.swift android/app/src/main/java/in/stewardmd/app/ConnectBrowserPlugin.java test/run-ward-adapter-ui.mjs
git commit -m "Connect Browser: report hidden; the app reads nothing unless hidden is confirmed"
```

---

### Task 6: No approval without a proven ward list

**Files:**
- Modify: `functions/api/connect/agent/[[path]].js:1195-1219` (approve route)
- Test: `test/connect/agent/phone-router.test.mjs`

**Interfaces:**
- Consumes: `findJobByCandidateVersion`, `safeJsonParse`, `OnboardError` (already in the router).
- Produces: `POST /versions/:id/approve` answers 409 when the candidate job's `phone_state.observedViews` is non-empty and holds no proven `worklist` view with a `data` endpoint. JSON-probe adapters (no observed views) are unaffected.

- [ ] **Step 1: Write the failing test** (append to `test/connect/agent/phone-router.test.mjs`)

```js
async function phoneCandidate(views) {
  const t = await setupTestEnv();
  const sRes = await onRequest(post("/api/connect/agent/sessions", { tenantId: "t1", emrUrl: DEP_ORIGIN, runner: "phone", consent: { agreed: true } }, t.env, t.doc1.headers));
  const sessionId = (await sRes.json()).sessionId;
  await onRequest(post(`/api/connect/agent/sessions/${sessionId}/handoff`, { tenantId: "t1" }, t.env, t.doc1.headers));
  await onRequest(post(`/api/connect/agent/sessions/${sessionId}/progress`, { tenantId: "t1", stage: "DISCOVERING" }, t.env, t.doc1.headers));
  const dis = await (await onRequest(post(`/api/connect/agent/sessions/${sessionId}/discovery`, { tenantId: "t1", spec: minimalSpec(), steps: [], observedViews: views }, t.env, t.doc1.headers))).json();
  const evRes = await onRequest(post(`/api/connect/agent/sessions/${sessionId}/evidence`, {
    tenantId: "t1", probes: (dis.probes || []).map((p) => ({ opId: p.opId, status: 200, contentType: "text/html", responseShape: null, itemCount: null })),
  }, t.env, t.doc1.headers));
  assert.equal(evRes.status, 200, await evRes.clone().text());
  return Object.assign(t, { versionId: (await evRes.json()).candidateVersionId });
}

test("approval refuses an adapter whose ward list was never proven, and accepts one whose ward list is", async () => {
  const unproven = await phoneCandidate(observedViews());
  const refused = await onRequest(post(`/api/connect/agent/versions/${unproven.versionId}/approve`, { tenantId: "t1" }, unproven.env, unproven.owner1.headers));
  assert.equal(refused.status, 409);
  assert.match(JSON.stringify(await refused.json()), /ward list/);

  const provenWorklist = Object.assign({}, observedViews()[0], {
    proof: { status: "proven", tried: 1, brain: true, overlap: 1, hits: 8, cells: 8, kind: "json" },
    endpoints: [{ method: "GET", path: "/Doctor/Home/GetIPWL?Type=IPWorkList&__RequestVerificationToken", xhr: true, role: "data", params: { Type: { constant: "IPWorkList" }, __RequestVerificationToken: { token: true } }, proof: { kind: "json", hits: 8, cells: 8, overlap: 1, rows: 2 } }],
  });
  const proven = await phoneCandidate([provenWorklist, observedViews()[1]]);
  const ok = await onRequest(post(`/api/connect/agent/versions/${proven.versionId}/approve`, { tenantId: "t1" }, proven.env, proven.owner1.headers));
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal((await ok.json()).state, "ACTIVE");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/phone-router.test.mjs`
Expected: FAIL, the unproven candidate is approved with 200.

- [ ] **Step 3: Implement the gate** (approve route)

Replace

```js
      const version = await getVersion(deps.db, tid, versionId);
      if (!version) throw new OnboardError("not-found", "adapter version not found");
```

with

```js
      const version = await getVersion(deps.db, tid, versionId);
      if (!version) throw new OnboardError("not-found", "adapter version not found");
      /* NOTHING PROVEN, NOTHING APPROVED. A crawled adapter whose ward list was never proven reads
       * through guesses or not at all; approving one put a 30-minute hang in front of the owner
       * (ver_b16da370, 2026-09-15). JSON-probe adapters (no observed views) keep their own evidence. */
      const job = await findJobByCandidateVersion(deps.db, tid, versionId);
      const candidateViews = ((job && safeJsonParse(job.phone_state)) || {}).observedViews;
      if (Array.isArray(candidateViews) && candidateViews.length) {
        const provenWard = candidateViews.some((v) => v && v.resourceHint === "worklist" && v.proof && v.proof.status === "proven" && Array.isArray(v.endpoints) && v.endpoints.some((e) => e && e.role === "data"));
        if (!provenWard) throw new OnboardError("conflict", "this adapter cannot read a ward list: the agent never proved the admitted patient list. Run Connect Hospital again");
      }
```

and delete the later line `const job = await findJobByCandidateVersion(deps.db, tid, versionId);` (after `activateVersion`), since `job` is now declared above.

- [ ] **Step 4: Run the tests**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/phone-router.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/activation.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/candidate-limit.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/repair.test.mjs`
Expected: PASS. If `repair.test.mjs` approves a repair candidate without a proven worklist, give that fixture's worklist view the `proof` and `endpoints` shown in Step 1 (a repair is a new candidate and meets the same bar).

- [ ] **Step 5: Commit**

```bash
git add functions/api/connect/agent/\[\[path\]\].js test/connect/agent/phone-router.test.mjs
git commit -m "Connect Agent: no approval without a proven ward list"
```

---

### Task 7: Delete the GIMSR ward list injection that hid the gap

**Files:**
- Modify: `connect-agent/phone/runtime.mjs:315-331`
- Test: `test/connect-agent/phone-runtime.test.mjs`

**Interfaces:**
- Produces: `readWorklist` sends only calls the adapter recorded. `isGimsrOrigin` stays (used for labels and data-host routing, not endpoint invention).

- [ ] **Step 1: Write the failing test** (append to `test/connect-agent/phone-runtime.test.mjs`)

```js
test('the GIMSR sign-in host gets no built-in ward list call: only what discovery recorded is sent', async () => {
  const sent = [];
  const plugin = {
    async navigate() {},
    async currentUrl() { return { url: 'https://ghis.gitam.edu/Doctor/Home' }; },
    async evaluate({ expression }) {
      const req = parseFetchExpression(expression);
      if (req) { sent.push(req.url); return { result: JSON.stringify({ status: 200, contentType: 'application/json', url: req.url, text: '[]' }) }; }
      return { result: '[]' };
    },
  };
  const replay = [{ resourceHint: 'worklist', pathTemplate: 'https://ghis.gitam.edu/Doctor/Home', rowsSelector: 'tr', headers: ['Patient ID'], proof: { status: 'proven' },
    endpoints: [{ method: 'GET', path: '/Doctor/Home/DashboardUnit?type', role: 'data', params: { type: { constant: 'docopdlist' } } }] }];
  await assert.rejects(readWorklist({ plugin, origin: 'https://gimsrlogin.gitam.edu', replay, settleMs: 0, maxWaitMs: 5 }), /no patient rows found/);
  assert.ok(sent.length > 0, 'the recorded call was sent');
  assert.ok(!sent.some((u) => /GetIPWL/.test(u)), 'no call the adapter never recorded: ' + JSON.stringify(sent));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/phone-runtime.test.mjs`
Expected: FAIL, `sent` contains a `GetIPWL` url.

- [ ] **Step 3: Delete the injection** (`runtime.mjs`)

Delete the whole block:

```js
  if (isGimsrOrigin(origin) && !candidates.some((c) => (c.endpoints || []).some((e) => /GetIPWL/i.test(e.path)))) {
    candidates.unshift({
      ...
    });
  }
```

(from `if (isGimsrOrigin(origin) && !candidates.some(` through its closing `}`, lines 315-331).

- [ ] **Step 4: Run the tests**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/phone-runtime.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/live-ghis-regressions.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/phone-runtime-wait.test.mjs && node test/run-ward-adapter-ui.mjs`
Expected: PASS, `ALL GREEN`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: exit 0, no `FAILED:` line.

- [ ] **Step 6: Commit**

```bash
git add connect-agent/phone/runtime.mjs test/connect-agent/phone-runtime.test.mjs
git commit -m "Connect Agent: the ward list reads only calls the adapter recorded (no GIMSR injection)"
```

---

### Task 8: On the iPhone, rediscover GHIS and reach parity with the hand-built adapter

**Files:**
- Modify (only if Step 7 says so): `connect-agent/phone/prove.mjs`, `test/connect-agent/prove.test.mjs`
- Modify: `vault/modules/Connect Agent.md`, `vault/decisions/Decisions.md`

**Interfaces:**
- Consumes: `GHIS.goldAudit()` (`ghis-ward.js:437`, report shape from `connect-agent/phone/gold-audit.mjs runGoldAudit`), `phone_state.proofTrace` (Task 1), `test/ios-webkit-cdp.mjs`.

- [ ] **Step 1: Deploy the server side**

Push the branch and open the preview, or merge per the owner's deploy rule (`CLAUDE.md` "Deploy": push to `main` deploys Pages). Ask the owner before pushing to `main`. The phone app calls `stewardmd.in/api/*`, so Tasks 1 and 6 only take effect on the phone after this deploy.

- [ ] **Step 2: Build the iOS app and prove the bundle carries this plan**

```bash
bash scripts/build-www.sh
npx cap sync ios
git diff --stat ios/App/CapApp-SPM/Package.swift
```
Expected: no diff. If `cap sync` rewrote the ConnectBrowser package path, run `git checkout -- ios/App/CapApp-SPM/Package.swift` before building (a rewritten path is one way a build ships a plugin without the hidden fix).

```bash
export DEVELOPER_DIR="/Applications/Xcode-beta 2.app/Contents/Developer"
rm -rf ios/DerivedData/Build/Intermediates.noindex/StewardmdCapacitorConnectBrowser.build
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'id=00008130-001A79E13A31401C' -derivedDataPath ios/DerivedData -allowProvisioningUpdates build 2>&1 | grep -E "BUILD SUCCEEDED|BUILD FAILED|error:" | head -5
APP=$(find ios/DerivedData -name App.app -path "*iphoneos*" | head -1)
strings "$APP/App.debug.dylib" | grep -c "hidden-v2"
grep -c "HIDDEN_REFUSED" "$APP/public/ghis-ward.js"
grep -c "FETCH_TIMEOUT_MS" "$APP/public/connect-agent/phone/adapter-runtime.mjs"
```
Expected: `BUILD SUCCEEDED`, and each count >= 1.

- [ ] **Step 3: Install (owner confirms first)**

Installing creates a new app container and wipes device-local data, including SURGX notes (no server copy) and the GHIS and Firebase sign-ins. Ask the owner to confirm, then:

```bash
xcrun devicectl device uninstall app --device 00008130-001A79E13A31401C in.stewardmd.app
xcrun devicectl device install app --device 00008130-001A79E13A31401C "$APP"
```

Verify the running bundle, not the install message: phone unlocked, app in front, then `ios_webkit_debug_proxy -c null:9221,:9222-9250` and read `typeof GHIS` and the `?v=` token of the loaded `ghis-ward.js` through `test/ios-webkit-cdp.mjs`. It must match `grep -o 'ghis-ward.js?v=[^"]*' "$APP/public/index.html"`.

- [ ] **Step 4: Owner runs Connect Hospital on GHIS**

Owner: Menu, Connect Hospital, GIMSR, sign in, Auto mode. Do not approve yet. Note the candidate version id shown on the approval screen.

- [ ] **Step 5: Read the proof trace (owner runs, read-only)**

```bash
npx wrangler d1 execute stewardmd-connect --remote --json --command "SELECT phone_state FROM connect_agent_job WHERE candidate_version_id='<the candidate version id from Step 4>'" | jq -r '.[0].results[0].phone_state | fromjson | .proofTrace[] | .resource + "\t" + .status + "\t" + ([.attempts[] | .method + " " + .path + " hits=" + (.hits|tostring) + " ratio=" + (.ratio|tostring)] | join(" | "))'
```

Record the table (resource, status, attempts) in `docs/connect/ghis-parity-2026-09-16.md`. Paths and counts only.

- [ ] **Step 6: Compare every screen with the hand-built request**

| Resource | Must be proven as |
|---|---|
| worklist | `GET /Doctor/Home/GetIPWL` |
| labs | `POST /Lab/Home/GetSearchPatientId` |
| labs-detail | `POST /Lab/Home/GetPrintLabResultDetailsAuth` |
| radiology | `GET /Radio/Home` |
| radiology-detail | `GET /Radiology/Home/GetRadiologyResultPrint` |
| medications | `GET /Doctor/Home/GetMedicines/` |

All six proven as listed: go to Step 8. Otherwise, per failing screen, apply exactly one row of Step 7.

- [ ] **Step 7: Per failing screen, decide from the trace**

| Trace shows | Meaning | Action |
|---|---|---|
| The hand-built path is in `attempts` with `ratio >= 0.5` but another path was kept | scoring chose wrong | Add a `prove.test.mjs` case with both answers shaped like the trace (counts and kinds) and adjust `specificity` until it picks the hand-built one; rerun Tasks 2 tests and Step 4 |
| `GET /Radio/Home` is in `attempts` with `role: shell` and `ratio >= 0.5` | a patient-bound full page GET was skipped as layout | Apply Step 7a |
| The hand-built path is absent from `attempts` (or status `no-requests`) | the request was never captured | Stop. Write a follow-up plan for capturing that screen, citing this trace. Do not patch without it |

- [ ] **Step 7a (only per the table above): accept a patient-bound full page GET**

Test (append to `test/connect-agent/prove.test.mjs`):

```js
test('a full page GET keyed on the patient (the radiology list page) can be the data call', async () => {
  const RAD_PAGE = '<html><body><table><tr><th>Date</th><th>Description</th></tr><tr><td>12-Sep-2026</td><td>CT BRAIN PLAIN</td></tr><tr><td>13-Sep-2026</td><td>X-RAY CHEST PA</td></tr></table></body></html>';
  const entries = [{ seq: 41, method: 'GET', url: HOST + '/Radio/Home?recordNo=MR900001', body: null, xhr: false, status: 200, shape: { kind: 'html', keys: ['Date', 'Description'], rows: 2, tables: 1, page: true } }];
  const view = { resourceHint: 'radiology', pathTemplate: HOST + '/Radio/Home', rowsSelector: 'tr', headers: ['Date', 'Description'] };
  await proveView({ client: fakePage({ entries, screen: [['12-Sep-2026', 'CT BRAIN PLAIN'], ['13-Sep-2026', 'X-RAY CHEST PA']], answers: { 41: { status: 200, contentType: 'text/html', text: RAD_PAGE } } }), view, parents: [{ label: 'worklist', rows: rowsForChain(WL_JSON, 'application/json') }] });
  assert.equal(view.proof.status, 'proven');
  assert.deepEqual(view.endpoints.find((e) => e.role === 'data').params.recordNo, { from: 'worklist', field: 'MRNo' });
});
```

Implementation (`prove.mjs`, in the Task 2 loop) replace

```js
    if (!accepted(o) || (r.role === 'shell' && (e.shape || {}).page && !e.xhr)) continue;
```

with

```js
    // A whole page is layout, unless it is keyed on this patient (a radiology list page by record number).
    if (!accepted(o) || (r.role === 'shell' && (e.shape || {}).page && !e.xhr && !chained(paramsOf(e, parents)))) continue;
```

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/prove.test.mjs`, expected PASS; commit `git add connect-agent/phone/prove.mjs test/connect-agent/prove.test.mjs && git commit -m "Connect Agent: a patient-keyed full page GET can be the data call"`; rebuild per Step 2 and repeat from Step 4.

- [ ] **Step 8: Approve, then run the gold audit**

Owner approves. Owner signs in to the hand-built GIMSR connection in the app too (the audit needs both), then opens the GIMSR (adapter) ward list. Through `test/ios-webkit-cdp.mjs`:

```js
window.__gold = null; GHIS.goldAudit().then(function (r) { window.__gold = r; }, function (e) { window.__gold = { error: String(e && e.message || e) }; }); 1
```

then poll `JSON.stringify(window.__gold)` until it is not `null`. Save the report (counts and names only) to `docs/connect/ghis-parity-2026-09-16.md`.

Pass criteria, all required:
- `endpoints[]`: `same === true` for `worklist`, `labs`, `labs-detail`, `radiology`, `radiology-detail`, `medications`.
- `worklist.verdict === "same"`.
- Every patient grade for `medications`, `lab`, `lab-detail`, `radiology`, `radiology-report` has `verdict` `same` or `both-empty`.

- [ ] **Step 9: Speed and invisibility on the phone**

Through `test/ios-webkit-cdp.mjs`, for a patient id from the ward list:

```js
window.__t = null; var s = performance.now(); fetch(GHIS.getProxyBase() + '/profile?patientId=' + encodeURIComponent(_pid)).then(function (r) { return r.json(); }).then(function () { window.__t = Math.round(performance.now() - s); }); 1
```

(set `_pid` first with `var _pid = '<a patientId from the list>'`), and while it runs take `pymobiledevice3 developer dvt screenshot $CLAUDE_JOB_DIR/tmp/parity-read.png` and look at it.

Pass criteria: `window.__t <= 5000`, and the screenshot shows StewardMD, not the hospital page or the orange banner.

- [ ] **Step 10: Record it**

Append to `vault/decisions/Decisions.md`:

```markdown
## 2026-09-16 Connect Agent reads GHIS through the hand-built adapter's own requests

**Decision:** A proven call is the most specific answer that carries the screen, not the first; the ward list is judged as admitted in-patients; a patient read never loads a page (unproven screens say "not read"); every hospital request (12 s) and every patient read (30 s) has a deadline; the app reads nothing unless the native browser confirms hidden; no approval without a proven ward list; the GIMSR GetIPWL injection is gone. Parity is graded by `GHIS.goldAudit` (report in `docs/connect/ghis-parity-2026-09-16.md`).

**Why:** Adapter ver_b16da370 proved the out-patient list as the ward list, the visit page as labs and the visits page as radiology, missed lab results, radiology reports and history, and its patient read sat on a GHIS menu page for 30 minutes in full view on the owner's iPhone (2026-09-15).

**Status:** Built and tested; gold audit result recorded in the parity report.
```

In `vault/modules/Connect Agent.md` under "Known gotchas", replace the bullet starting `- **Endpoint replay** (2026-09-13)` with:

```markdown
- **Endpoint replay, never a page** (2026-09-16): `runtime.readPatientDetails` replays only proven views
  (`provenView`); an unproven screen comes back `{ unreadable: 'not-proven' }` and `ghis-shim notRead`
  tells the drawer it was not read. Proof keeps the most specific answer (`prove.mjs specificity`), the
  ward list is judged by Gemini, each in-page request aborts at `FETCH_TIMEOUT_MS`, a patient read at 30 s,
  and `open`/`setMode` must report `hidden: true` (`contract: "hidden-v2"`) or nothing is read. Approval
  needs a proven worklist. The proof trace is on `phone_state.proofTrace` and `GET /versions/:id`.
```

- [ ] **Step 11: Commit and push**

```bash
git add docs/connect/ghis-parity-2026-09-16.md vault/decisions/Decisions.md "vault/modules/Connect Agent.md"
git commit -m "Connect Agent: GHIS parity report and decision"
git push -u origin HEAD
```
