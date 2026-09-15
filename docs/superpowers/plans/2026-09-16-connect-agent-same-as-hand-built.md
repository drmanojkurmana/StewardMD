# Connect Agent: Same As The Hand-Built GHIS Adapter - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Agent produces an executable, endpoint-driven adapter for every hospital: the hospital's own backend requests (session, tokens, GET/POST definitions, parameters, multi-request chains, JSON and HTML parsing, pagination, canonical mapping), discovered and proven during onboarding, then run directly through any doctor's authenticated session with no page opening, clicking or DOM scraping as the runtime path. GHIS is the acceptance case: the adapter must call the discovered equivalents of GetIPWL, GetSearchPatientId, GetPrintLabResultDetailsAuth, the radiology requests, GetMedicines and the history requests, exactly as the hand-built `functions/api/ghis/[[path]].js` does.

**The contract (owner, 2026-09-16).** A generated adapter is COMPLETE only when every routine clinical resource it offers is backed by a proven backend request. Acceptance: with the browser UI stopped (no visible page, no taps), the adapter retrieves a real patient's data through the discovered requests alone. If it must open, click or scrape a hospital page to read routine clinical data, it is not complete. The adapter is reusable by another doctor on their own authenticated session with no rediscovery.

**"Browser UI stopped" on the phone.** The hand-built adapter replays requests server-side with the GHIS cookies in KV. A prior owner decision (`vault/decisions/Decisions.md` 2026-09-11) forbids taking cookies off the device, so the phone equivalent is a HIDDEN WebView that issues only the discovered `fetch`/XHR requests in the page realm (`adapter-runtime.mjs executeProven` -> `fetchInPage`), carrying the doctor's session cookies. That is endpoint-driven, not scraping: no page is shown, navigated for its DOM, or clicked. "Stopped" therefore means no visible UI and no DOM interaction, not the WebView process gone.

**Architecture:** The execution half already meets the contract: `executeProven` runs the prerequisite POSTs then the data GET, fills every field from its proven source, follows list->detail chains, parses JSON and HTML, widens pagination, and `ghis-shim.mjs` maps to canonical. The discovery half does not: proof only sees `fetch`/XHR (the page replay buffer `__SMD_REPLAY__`), so a report GHIS opens by navigation or popup (lab result, radiology report, history) is invisible and comes back `no-requests`, and the runtime then falls back to opening pages. This plan closes that: (1) keep the per-screen proof trace so every run explains itself, (2) prove the request that returns only the list, judged by Gemini, (2b) **capture navigation and popup requests so a report opened by page load becomes a proven backend request**, (2c) **save a list request in its widest proven form, so a doctor-filtered ward list can never be mistaken for the ward, and make a subset a named audit failure**, (3) the patient read runs only proven endpoints, never a page, and records per-resource `how`, (4) bound every request and read in time, (5) read only when the native browser confirms it is hidden, (6) **refuse approval unless every required resource is endpoint-backed (endpoint-complete), storing `how` per resource**, (7) delete the GIMSR ward-list injection, (7b) **self-repair re-proves a backend request instead of saving a DOM-scraping view; the DOM path survives only as a labeled last resort for an EMR with no discoverable endpoint, never for an endpoint-complete adapter**, (8) prove GHIS parity and the acceptance test on the iPhone.

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
- Owner, 2026-09-16: "Every adapter created by Connect Agent must be an executable endpoint-driven adapter... Do NOT make webpage/DOM scraping the normal runtime path... If it needs to open/click/scrape hospital pages to retrieve routine clinical data, the adapter is NOT complete."
- Endpoint-complete = every resource in `REQUIRED_RESOURCES` (worklist, patient, medications, labs, labs-detail, radiology, radiology-detail) has a proven backend request whose `how` is `endpoint`. History is offered when present but does not gate completeness (the hand-built adapter reads it OPD-side). A resource genuinely absent in an EMR is `how: 'absent'`, not a failure; a resource readable only by DOM is `how: 'dom'` and makes the adapter DOM-degraded, never complete.
- Pagination: `replayPlan` widens a page-size/offset/number key to one large page (GHIS style). Multi-page looping is out of scope for the GHIS acceptance and noted as a bounded limitation with an upgrade path, not built here.
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
| `connect-agent/phone/index.mjs` | sends the proof trace with discovery (Task 1); injects nav requests before proving a guided screen (Task 2b) |
| `functions/api/connect/agent/[[path]].js` | cleans and stores the trace (Task 1), endpoint-completeness gate and per-resource `how` (Task 6), repair needs a data endpoint (Task 7b) |
| `connect-agent/phone/prove.mjs` | picks the most specific proven call, checks the ward list (Task 2); turns native navigation and popup GETs into proof candidates (Task 2b) |
| `connect-agent/phone/deep-crawl.mjs` | drains and injects navigation requests around the detail-row tap (Task 2b) |
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

### Task 2b: Capture navigation and popup requests so a report opened by a page load becomes a proven backend request

**Why:** Proof reads only the page `fetch`/XHR replay buffer (`__SMD_REPLAY__`, `discovery.mjs keep()`). GHIS opens a lab result, a radiology report and a visit note by main-frame navigation or a popup that the plugin loads in the same view (`ConnectBrowserPlugin.swift:545`), and the native `decidePolicyFor` logs those as GET in `requestLog` (drained by `drainRequests`), but they never enter the replay buffer, so proof sees `no-requests` (adapter ver_b16da370: labs-detail, radiology-detail, history all `no-requests`). This task drains those native GETs and injects them into the replay buffer as candidates, so a navigation report is re-issued as `fetch(url,{credentials:'include'})`, proven against the screen, and saved as a keyed backend request the runtime replays, exactly the endpoint the hand-built adapter calls (`GetPrintLabResultDetailsAuth`, `GetRadiologyResultPrint`).

**Files:**
- Modify: `connect-agent/phone/prove.mjs` (new exports `navToReplayEntries`, `INJECT_REPLAY_SRC`; fold the patient-keyed-page rule into the accept check)
- Modify: `connect-agent/phone/deep-crawl.mjs` (drain + inject around the detail-row click, ~line 1421)
- Modify: `connect-agent/phone/index.mjs` (drain + inject in `askOne` before `book.prove`, ~line 194)
- Test: `test/connect-agent/prove.test.mjs`

**Interfaces:**
- Consumes: `client.drainRequests() -> { requests: [{ method, url }] }` (native main-frame navigations + fetch/XHR), `chained`, `paramsOf` (prove.mjs).
- Produces: `export function navToReplayEntries(drained, { pageOrigin, allowedOrigins = [] }) -> [{ method: 'GET', url }]` (GET, https, page or allowed origin, not asset/session/write, deduped, max 8). `export const INJECT_REPLAY_SRC` (page function string; pushes given `{method,url}` entries into `window.__SMD_REPLAY__` with the real incrementing `seq`, `shape:{kind:'unknown',page:true}`). A patient-keyed full-page GET is now provable (the `role:'shell' && page && !xhr` skip yields when `chained(paramsOf(e, parents))`).

- [ ] **Step 1: Write the failing tests** (append to `test/connect-agent/prove.test.mjs`; add `navToReplayEntries`, `INJECT_REPLAY_SRC` to the import from `../../connect-agent/phone/prove.mjs`)

```js
test('navToReplayEntries keeps only main-frame GET reports on the hospital origin', () => {
  const out = navToReplayEntries({ requests: [
    { method: 'GET', url: 'https://ghis.gitam.edu/Radiology/Home/GetRadiologyResultPrint?resultid=RS44001' },
    { method: 'GET', url: 'https://ghis.gitam.edu/Doctor/Home/GetopcardReport?id=OP77&patid=MR9' },
    { method: 'POST', url: 'https://ghis.gitam.edu/Doctor/Home/CreateDrugs' },
    { method: 'GET', url: 'https://ghis.gitam.edu/Content/site.css' },
    { method: 'GET', url: 'https://analytics.example/collect?x=1' },
    { method: 'GET', url: 'https://ghis.gitam.edu/Radiology/Home/GetRadiologyResultPrint?resultid=RS44001' },
  ] }, { pageOrigin: 'https://ghis.gitam.edu' });
  assert.deepEqual(out, [
    { method: 'GET', url: 'https://ghis.gitam.edu/Radiology/Home/GetRadiologyResultPrint?resultid=RS44001' },
    { method: 'GET', url: 'https://ghis.gitam.edu/Doctor/Home/GetopcardReport?id=OP77&patid=MR9' },
  ], 'writes, assets, beacons and a foreign origin are dropped; a repeat is deduped');
});

test('INJECT_REPLAY_SRC pushes nav entries into the replay buffer with monotonic seq', () => {
  const win = { __SMD_REPLAY__: { seq: 5, list: [{ seq: 5, url: 'x' }] } };
  new Function('window', 'entries', 'return (' + INJECT_REPLAY_SRC + ')(entries)')(win, [{ method: 'GET', url: 'https://h/GetReport?resultid=RS1' }]);
  assert.equal(win.__SMD_REPLAY__.list.length, 2);
  const added = win.__SMD_REPLAY__.list[1];
  assert.equal(added.seq, 6);
  assert.equal(added.method, 'GET');
  assert.equal(added.url, 'https://h/GetReport?resultid=RS1');
  assert.equal(added.xhr, false);
});

test('a radiology report opened by navigation is proven and keyed to its list row', async () => {
  const REPORT = '<html><body><h3>CT BRAIN PLAIN</h3><p>No acute intracranial abnormality. Ventricles normal.</p></body></html>';
  // The report GET was injected from the native nav log: it is in the buffer as a page-shaped entry.
  const entries = [{ seq: 51, method: 'GET', url: HOST + '/Radiology/Home/GetRadiologyResultPrint?resultid=RS44001', body: null, reqCt: '', xhr: false, status: 200, shape: { kind: 'unknown', page: true } }];
  const view = { resourceHint: 'radiology-detail', detailOf: 'radiology', pathTemplate: HOST + '/Radio/Home', rowsSelector: 'body', headers: ['Impression'] };
  const radRow = { description: 'CT BRAIN PLAIN', _args: ['RS44001'], resultid: 'RS44001' };
  await proveView({
    client: fakePage({ entries, screen: [['No acute intracranial abnormality. Ventricles normal.']], answers: { 51: { status: 200, contentType: 'text/html', text: REPORT } } }),
    view, parents: [{ label: 'radiology', rows: [radRow] }],
  });
  assert.equal(view.proof.status, 'proven', JSON.stringify(view.proof));
  const data = view.endpoints.find((e) => e.role === 'data');
  assert.equal(data.path.split('?')[0], '/Radiology/Home/GetRadiologyResultPrint');
  assert.deepEqual(data.params.resultid, { from: 'radiology', field: 'resultid' });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/prove.test.mjs`
Expected: FAIL. `navToReplayEntries`/`INJECT_REPLAY_SRC` are undefined; the radiology test is `unproven` (the page GET is skipped by the `shell && page && !xhr` guard).

- [ ] **Step 3: Add the pure helper and the inject source** (`prove.mjs`, above `/* ---- the loop ---`)

```js
const NAV_NOISE = /checksession|keepalive|heartbeat|signalr|analytics|\/collect$|\.(js|css|png|jpe?g|gif|svg|woff2?|ico|map|pdf)$/i;
/* Main-frame reports the hospital opens by navigation or popup (GHIS radiology/lab/visit reports) are
 * logged natively (decidePolicyFor) but never enter the page fetch/XHR buffer, so proof could not see
 * them (adapter ver_b16da370: labs-detail, radiology-detail, history no-requests). Drained native GETs
 * on the hospital origin become proof candidates, re-issued as fetch() with the doctor's cookies. */
export function navToReplayEntries(drained, { pageOrigin, allowedOrigins = [] } = {}) {
  const reqs = drained && Array.isArray(drained.requests) ? drained.requests : (Array.isArray(drained) ? drained : []);
  const out = [];
  const seen = new Set();
  for (const r of reqs) {
    if (!r || String(r.method || 'GET').toUpperCase() !== 'GET' || typeof r.url !== 'string') continue;
    let u; try { u = new URL(r.url); } catch { continue; }
    if (u.protocol !== 'https:') continue;
    if (pageOrigin && u.origin !== pageOrigin && allowedOrigins.indexOf(u.origin) < 0) continue;
    if (NAV_NOISE.test(u.pathname) || WRITE_PATH.test(u.pathname)) continue;
    const sig = 'GET ' + u.href;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ method: 'GET', url: u.href });
    if (out.length >= 8) break;
  }
  return out;
}

/* Push nav GETs into the page's replay buffer using the real seq, so PROVE_LIST offers them and
 * PROVE_EXEC re-issues them by seq like any observed request. shape.page marks them shell-ranked; a
 * report is usually the only candidate, so it is still executed and accepted on overlap. */
export const INJECT_REPLAY_SRC = "(function(entries){try{var R=window.__SMD_REPLAY__=window.__SMD_REPLAY__||{seq:0,list:[]};for(var i=0;i<entries.length;i++){var e=entries[i];R.seq+=1;R.list.push({seq:R.seq,sig:'GET '+e.url,method:'GET',url:e.url,body:null,reqCt:'',xhr:false,status:200,shape:{kind:'unknown',page:true}});}if(R.list.length>60)R.list.splice(0,R.list.length-60);return R.seq;}catch(x){return 0;}})";
```

- [ ] **Step 4: Let a patient-keyed page GET be data** (`prove.mjs`, the accept guard added in Task 2 Step 4)

Change

```js
    if (!accepted(o) || (r.role === 'shell' && (e.shape || {}).page && !e.xhr)) continue;
```

to

```js
    // A whole page is layout, unless it is keyed on this patient (a report opened by navigation).
    if (!accepted(o) || (r.role === 'shell' && (e.shape || {}).page && !e.xhr && !chained(paramsOf(e, parents)))) continue;
```

(`chained` and `paramsOf` are already defined in `prove.mjs`.)

- [ ] **Step 5: Drain and inject at the detail-row click** (`deep-crawl.mjs`, in the `if (caps.exploreDetails === true ...)` block)

Directly before `await client.evaluate({ expression: \`(${ARM_OBSERVER_SRC})()\` }).catch(() => {});` add:

```js
      if (typeof client.drainRequests === 'function') { try { await client.drainRequests(); } catch {} }
```

Directly after `await client.wait({ ms: waitMs });` (the one right after `CLICK_FIRST_ROW_SRC`) add:

```js
        if (typeof client.drainRequests === 'function') {
          try {
            const drained = await client.drainRequests();
            const pageOrigin = (() => { try { return new URL(await whereAmI()).origin; } catch { return null; } })();
            const nav = navToReplayEntries(drained, { pageOrigin, allowedOrigins: (caps && caps.origins) || [] });
            if (nav.length) await client.evaluate({ expression: '(' + INJECT_REPLAY_SRC + ')(' + JSON.stringify(nav) + ')' }).catch(() => {});
          } catch { /* nav capture is best effort */ }
        }
```

Add `navToReplayEntries, INJECT_REPLAY_SRC` to the existing `import { ... } from './prove.mjs'` in `deep-crawl.mjs` (if deep-crawl imports prove; if not, add `import { navToReplayEntries, INJECT_REPLAY_SRC } from './prove.mjs';` near the top). Verify with `grep -n "from './prove.mjs'" connect-agent/phone/deep-crawl.mjs`.

- [ ] **Step 6: Drain and inject in the guided ask** (`connect-agent/phone/index.mjs askOne`)

Directly before `await book.prove({ client: plugin, view, label: 'the doctor showed the ' + gap + ' screen' });` (line ~194) add:

```js
      if (typeof plugin.drainRequests === 'function') {
        try {
          const drained = await plugin.drainRequests();
          let pageOrigin = null; try { const cur = await plugin.currentUrl(); pageOrigin = new URL(typeof cur === 'string' ? cur : cur && cur.url).origin; } catch { pageOrigin = null; }
          const nav = navToReplayEntries(drained, { pageOrigin, allowedOrigins: origins });
          if (nav.length) await plugin.evaluate({ expression: '(' + INJECT_REPLAY_SRC + ')(' + JSON.stringify(nav) + ')' }).catch(() => {});
        } catch { /* best effort */ }
      }
```

Add `navToReplayEntries, INJECT_REPLAY_SRC` to `index.mjs`'s import from `./prove.mjs` (or add the import). Confirm `origins` is in scope in `askOne` (it is: `runPhoneDiscovery` closes over `origins`). Verify with `grep -n "const origins\|origins =" connect-agent/phone/index.mjs | head`.

- [ ] **Step 7: Run the tests**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/prove.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/deep-crawl.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/phone-index.test.mjs`
Expected: PASS. If `deep-crawl.test.mjs` or `phone-index.test.mjs` build a fake `client`/`plugin` without `drainRequests`, the new blocks are skipped by the `typeof ... === 'function'` guard and those tests are unaffected.

- [ ] **Step 8: Commit**

```bash
git add connect-agent/phone/prove.mjs connect-agent/phone/deep-crawl.mjs connect-agent/phone/index.mjs test/connect-agent/prove.test.mjs
git commit -m "Connect Agent: capture navigation and popup reports as proven backend requests"
```

---

### Task 2c: A list request is saved in its widest proven form, and a subset fails the audit

**Why (owner, 2026-09-16):** "Do not mark GetIPWL as learned just because the URL is discovered. Prove the exact request with Type=IPWorkList and the required empty filters, replay it using the authenticated doctor's session, verify that it returns the complete inpatient population, save that exact request/body/parameters in the adapter, and make the gold audit fail if the adapter returns only a subset."

A discovered URL is never "learned": it is a candidate that must be executed in the doctor's session and verified (Tasks 2 and 2b). This task closes the remaining hole: proof verifies a candidate against **the values on the screen**, and the screen can itself be filtered. GHIS's own page may send `GetIPWL` with `Emp_ID` or `Dept_ID` filled, which answers with the signed-in doctor's patients only. That passes proof on a screen showing exactly those patients, is saved as recorded, and then returns a subset for every doctor forever: commit `67c8a74d8` (2026-09-14, "ensure GetIPWL worklist endpoint loads all 661 hospital in-patients") is the hard-coded workaround that was papering over precisely this. After this task, the request is saved with its filters empty and `Type=IPWorkList` intact, because that form was proven to return more patients.

**THE SAFETY RULE (corrected 2026-09-16 after review of commit `c532e3358`):** widening applies to the **worklist and nothing else**, and even there a patient-keyed or visit-keyed parameter is never emptied.

The first version of this rule keyed off `unmapped` alone, and that was wrong in a way that would have leaked PHI. `unmapped` is `paramsOf`'s FAILURE state, not evidence that a parameter is a filter: when tracing has no parent rows to work from, an identifier is indistinguishable from a doctor filter. `parents` is empty for every resource whenever the worklist proof failed, which is precisely the GHIS situation this plan exists to fix. So `patient_id=MR900001` on a labs call came back `unmapped`, widening emptied it, and the keep-gate did not stop it: every patient's labs is the same response kind, has more rows, and still carries this patient's values, so `accepted()` passed on a superset. It would have been saved as `patient_id: {"empty": true}` and every patient's drawer would then have shown the whole hospital's labs, in the wrong chart. Reported by the reviewer with a live reproduction against the committed code.

Three guards, all required:
1. Widen **only** when `view.resourceHint === 'worklist'`. The whole population is the goal for the ward list alone. For a patient's labs, medications or radiology, MORE rows is a red flag, never a win.
2. Never empty a parameter whose KEY is patient-shaped or visit-shaped (`PATIENT_KEY` / `VISIT_KEY` from `adapter-runtime.mjs`), even on the worklist. This protects against a patient-scoped screen that was mis-hinted as the worklist.
3. Keep the original rule as well: only a parameter `paramsOf` could not trace (`unmapped`) is a candidate. A parameter traced to the worklist or a parent row is identity-bearing and is never emptied.

If a guard costs a wider result (a ward list whose `PatientId` filter was filled stays narrow), that is the correct trade: the gold audit reports it as a `subset` and a human decides. Silently reading another patient's chart is not recoverable.

**Files:**
- Modify: `connect-agent/phone/prove.mjs` (new `PROVE_EXEC_REQ` source + `PROVE_SOURCES.execRequest`, new `widenRequest`, a widening pass in `proveView` after the hit is chosen)
- Modify: `connect-agent/phone/gold-audit.mjs` (`compareRows`: an explicit `subset` verdict and a `missing` count)
- Test: `test/connect-agent/prove.test.mjs`, `test/connect-agent/gold-audit.test.mjs`

**Interfaces:**
- Produces: `export function widenRequest(entry, params) -> { url, body } | null` (same request with every `unmapped` filter emptied; constants, tokens, page keys and row-traced values untouched; null when nothing would change). `PROVE_SOURCES.execRequest({ method, url, body, reqCt, xhr })` executes an arbitrary request in the page. A proven list view records `view.proof.population` (rows the saved request returned). `compareRows` returns `verdict: 'subset'` with `missing: <count>` when the adapter returns fewer rows than the hand-built adapter and every row it did return matched.

- [ ] **Step 1: Write the failing tests** (append to `test/connect-agent/prove.test.mjs`; add `widenRequest` to the import)

```js
test('widenRequest empties only the filters nothing could be traced to', () => {
  const entry = { method: 'GET', url: HOST + '/Doctor/Home/GetIPWL?NursingStationId=&PatientId=&FloorId=&Emp_ID=4471&Dept_ID=12&Type=IPWorkList&__RequestVerificationToken=abc', body: null, reqCt: '' };
  const params = { Emp_ID: { unmapped: true }, Dept_ID: { unmapped: true }, Type: { constant: 'IPWorkList' }, __RequestVerificationToken: { token: true } };
  const wide = widenRequest(entry, params);
  assert.ok(wide);
  const q = new URL(wide.url).searchParams;
  assert.equal(q.get('Emp_ID'), '', 'an untraceable filter is emptied');
  assert.equal(q.get('Dept_ID'), '');
  assert.equal(q.get('Type'), 'IPWorkList', 'a mode constant is kept');
  assert.equal(q.get('__RequestVerificationToken'), 'abc', 'the token is kept');

  // A patient-scoped request is NEVER widened: that would read every patient's labs.
  const labs = { method: 'POST', url: HOST + '/Lab/Home/GetSearchPatientId', body: '__RequestVerificationToken=abc&patient_id=MR900001&DeptID=', reqCt: 'application/x-www-form-urlencoded' };
  assert.equal(widenRequest(labs, { patient_id: { from: 'worklist', field: 'MRNo' }, __RequestVerificationToken: { token: true }, DeptID: { empty: true } }), null, 'nothing untraceable and filled: no widening');
  const scoped = { method: 'GET', url: HOST + '/Lab/Home/Get?patient_id=MR900001', body: null, reqCt: '' };
  assert.equal(widenRequest(scoped, { patient_id: { from: 'worklist', field: 'MRNo' } }), null, 'a row-traced id is never emptied');
});

test('widenRequest refuses a patient-keyed parameter even when tracing failed', () => {
  const entry = { method: 'GET', url: HOST + '/Doctor/Home/GetIPWL?PatientId=MR900001&Emp_ID=4471&Type=IPWorkList', body: null, reqCt: '' };
  const params = { PatientId: { unmapped: true }, Emp_ID: { unmapped: true }, Type: { constant: 'IPWorkList' } };
  const q = new URL(widenRequest(entry, params).url).searchParams;
  assert.equal(q.get('PatientId'), 'MR900001', 'a patient-keyed filter is never emptied, even unmapped');
  assert.equal(q.get('Emp_ID'), '', 'a doctor filter still widens');
});

test('widening never touches a patient-scoped call, even when tracing failed completely', async () => {
  // parents: [] is the real GHIS case: the worklist proof failed, so nothing can be traced, and every
  // parameter including patient_id comes back `unmapped`. Widening must still refuse.
  const MINE = JSON.stringify([{ test: 'Haemoglobin', value: '11.2' }]);
  const ALL = JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ test: 'Haemoglobin', value: '11.' + i })));
  const entries = [{ seq: 71, method: 'GET', url: HOST + '/Lab/Home/GetSearchPatientId?patient_id=MR900001&DeptID=', body: null, reqCt: '', xhr: true, status: 200, shape: { kind: 'json', keys: ['test'], rows: 1 } }];
  let widened = null;
  const page = {
    async currentUrl() { return { url: HOST + '/Lab/Home' }; },
    async evaluate({ expression }) {
      if (expression.includes('PROVE_LIST')) return { result: JSON.stringify(entries) };
      if (expression.includes('PROVE_SCREEN')) return { result: JSON.stringify([['Haemoglobin', '11.2']]) };
      if (expression.includes('PROVE_EXEC_REQ')) { widened = expression; return { result: JSON.stringify({ status: 200, contentType: 'application/json', text: ALL }) }; }
      if (expression.includes('PROVE_EXEC')) return { result: JSON.stringify({ status: 200, contentType: 'application/json', text: MINE }) };
      return { result: null };
    },
  };
  const view = { resourceHint: 'labs', pathTemplate: HOST + '/Lab/Home', rowsSelector: 'tr', headers: ['Test', 'Value'] };
  await proveView({ client: page, view, parents: [] });
  assert.equal(widened, null, 'a patient-scoped resource is never widened: the whole hospital is never fetched');
  const p = (view.endpoints.find((e) => e.role === 'data') || {}).params || {};
  assert.notDeepEqual(p.patient_id, { empty: true }, 'the patient id is never saved as empty');
});

test('the ward list is saved in the form that returns every in-patient, not the doctor filtered one', async () => {
  const MINE = JSON.stringify([{ patientId: 'MR1', patientFirstName: 'ALPHA', bedName: 'B1' }, { patientId: 'MR2', patientFirstName: 'BRAVO', bedName: 'B2' }]);
  const ALL = JSON.stringify([
    { patientId: 'MR1', patientFirstName: 'ALPHA', bedName: 'B1' }, { patientId: 'MR2', patientFirstName: 'BRAVO', bedName: 'B2' },
    { patientId: 'MR3', patientFirstName: 'CHARLIE', bedName: 'B3' }, { patientId: 'MR4', patientFirstName: 'DELTA', bedName: 'B4' },
  ]);
  const filtered = HOST + '/Doctor/Home/GetIPWL?Emp_ID=4471&Type=IPWorkList';
  const entries = [{ seq: 61, method: 'GET', url: filtered, body: null, reqCt: '', xhr: true, status: 200, shape: { kind: 'json', keys: ['patientId'], rows: 2 } }];
  const answers = { 61: { status: 200, contentType: 'application/json', text: MINE } };
  const page = {
    executed: [],
    async currentUrl() { return { url: HOST + '/Doctor/Home' }; },
    async evaluate({ expression }) {
      if (expression.includes('PROVE_LIST')) return { result: JSON.stringify(entries) };
      if (expression.includes('PROVE_SCREEN')) return { result: JSON.stringify([['MR1', 'ALPHA', 'B1'], ['MR2', 'BRAVO', 'B2']]) };
      if (expression.includes('PROVE_EXEC_REQ')) {
        // the widened replay: filters emptied, Type kept
        const m = /"url":"([^"]+)"/.exec(expression);
        page.executed.push(m && m[1]);
        return { result: JSON.stringify({ status: 200, contentType: 'application/json', text: /Emp_ID=&/.test(m[1]) || /Emp_ID=$/.test(m[1]) ? ALL : MINE }) };
      }
      if (expression.includes('PROVE_EXEC')) return { result: JSON.stringify(answers[61]) };
      return { result: null };
    },
  };
  const view = { resourceHint: 'worklist', pathTemplate: HOST + '/Doctor/Home', rowsSelector: '#wl tbody tr', headers: ['UHID', 'Name', 'Bed'] };
  await proveView({ client: page, view });
  assert.equal(view.proof.status, 'proven');
  const data = view.endpoints.find((e) => e.role === 'data');
  assert.match(data.path, /Type=IPWorkList/, 'the mode constant is saved');
  assert.deepEqual(data.params.Emp_ID, { empty: true }, 'the doctor filter is saved EMPTY, so every in-patient comes back');
  assert.equal(view.proof.population, 4, 'the saved request was verified to return the whole in-patient list');
});
```

Append to `test/connect-agent/gold-audit.test.mjs` (add `compareRows`, `GOLD_ENDPOINTS` to its import if absent):

```js
test('an adapter that returns only some of the ward FAILS the audit as a subset', () => {
  const spec = GOLD_ENDPOINTS[0]; // patients
  const gold = [{ patientId: 'MR1' }, { patientId: 'MR2' }, { patientId: 'MR3' }];
  const mine = [{ patientId: 'MR1' }, { patientId: 'MR2' }];
  const out = compareRows(spec, gold, mine);
  assert.equal(out.verdict, 'subset', 'fewer patients than the hand-built adapter is a named failure, not a pass');
  assert.equal(out.missing, 1);
  assert.equal(compareRows(spec, gold, gold).verdict, 'same');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/prove.test.mjs; node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/gold-audit.test.mjs`
Expected: FAIL. `widenRequest` is undefined, the ward list saves `Emp_ID` as recorded, and `compareRows` calls a short list `partial`.

- [ ] **Step 3: Add the arbitrary-request executor** (`prove.mjs`, next to `PROVE_EXEC`)

```js
/* Execute a request the page did not make as recorded: the widened form of a list call. Same session,
 * same cookies, same realm as PROVE_EXEC; only the url and body differ. */
function PROVE_EXEC_REQ(req) {
  var headers = { Accept: 'application/json, text/html, */*' };
  if (req.xhr) headers['X-Requested-With'] = 'XMLHttpRequest';
  var init = { method: req.method, credentials: 'include', headers: headers, redirect: 'follow' };
  if (req.body != null && req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    headers['Content-Type'] = req.reqCt || 'application/x-www-form-urlencoded; charset=UTF-8';
  }
  return fetch(req.url, init).then(function (r) {
    return r.text().then(function (t) {
      return JSON.stringify({ status: r.status, contentType: r.headers.get('content-type') || '', url: r.url, text: t.length > 2097152 ? t.slice(0, 2097152) : t });
    });
  }).catch(function (x) { return JSON.stringify({ status: 0, error: String(x && x.message || x) }); });
}
```

and add to `PROVE_SOURCES`:

```js
  execRequest: (req) => `(${String(PROVE_EXEC_REQ)})(${JSON.stringify(req)})`,
```

- [ ] **Step 4: Add `widenRequest`** (`prove.mjs`, above the loop)

```js
/* THE WIDEST FORM THAT STILL SHOWS THIS DOCTOR'S PATIENTS (owner, 2026-09-16). A ward list request can
 * carry filters the hospital's own page filled in (the signed-in doctor, their unit): replayed as
 * recorded it returns a subset forever and patients silently vanish. Only a parameter nothing could be
 * traced to (`unmapped`) is emptied. A value traced to the worklist or a parent row is the patient's
 * own identity and is never touched: emptying it would turn this patient's labs into everyone's. */
export function widenRequest(entry, params) {
  const src = params || {};
  /* `unmapped` alone is NOT enough: it is the tracing FAILURE state, and an identifier tracing failed on
   * looks exactly like a doctor filter. A patient-keyed or visit-keyed name is never emptied whatever
   * tracing said (reviewer reproduction against commit c532e3358, 2026-09-16). */
  const loose = (k, v) => !!v && !!src[k] && src[k].unmapped === true && !PATIENT_KEY.test(k) && !VISIT_KEY.test(k);
  let u;
  try { u = new URL(entry.url); } catch { return null; }
  let changed = false;
  const q = [];
  u.searchParams.forEach((v, k) => { q.push([k, loose(k, v) ? '' : v]); if (loose(k, v)) changed = true; });
  let body = entry.body == null ? null : String(entry.body);
  if (body && /urlencoded|^$/i.test(String(entry.reqCt || '')) && body.indexOf('=') >= 0) {
    const parts = body.split('&').map((p) => {
      const i = p.indexOf('=');
      const k = i >= 0 ? p.slice(0, i) : p;
      const v = i >= 0 ? decodeURIComponent(p.slice(i + 1).replace(/\+/g, ' ')) : '';
      if (loose(k, v)) { changed = true; return k + '='; }
      return p;
    });
    body = parts.join('&');
  }
  if (!changed) return null;
  const search = q.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  return { url: u.origin + u.pathname + (search ? '?' + search : ''), body };
}
```

- [ ] **Step 5: Widen the chosen list call, and record the population** (`prove.mjs`, in `proveView` directly after `if (!hit) return done('unproven');`)

```js
  /* VERIFY THE POPULATION, NOT JUST THE SCREEN. The screen can be a filtered view of the ward, so the
   * request that matches it can still be a subset. The same call with its untraceable filters emptied
   * is replayed in the doctor's session; when it answers with MORE rows, the same kind, and still
   * carries the screen, THAT is the request saved (owner, 2026-09-16). */
  /* THE WARD LIST, AND NOTHING ELSE. The whole population is the goal for the ward list alone. For a
   * patient's labs, medications or radiology, MORE rows is a red flag, not a win: it means the request
   * stopped being about this patient. Widening every list resource would have emptied `patient_id` on a
   * labs call whenever the worklist proof failed, putting the whole hospital's labs in one chart. */
  if (String(view.resourceHint || '') === 'worklist') {
    const wide = widenRequest(hit.e, paramsOf(hit.e, parents));
    if (wide) {
      const resp2 = await evalJson(client, PROVE_SOURCES.execRequest({ method: hit.e.method, url: wide.url, body: wide.body, reqCt: hit.e.reqCt, xhr: hit.e.xhr }), null);
      const kind2 = responseKind(resp2);
      if (kind2 === kind2 && resp2 && kind2 !== 'login' && kind2 !== 'empty') {
        const rows2 = rowsForChain(resp2.text, resp2.contentType);
        const o2 = overlapOf(cells, resp2.text, resp2.contentType);
        trace.tried.push({ method: hit.e.method, path: candidateStructure(hit.e).path.replace(/\d{3,}/g, '#'), role: 'data', kind: kind2, hits: o2.hits, ratio: o2.ratio, widened: true });
        if (kind2 === hit.kind && rows2.length > hit.rows.length && accepted(o2)) {
          hit.e = Object.assign({}, hit.e, { url: wide.url, body: wide.body });
          hit.resp = resp2;
          hit.rows = rows2;
          hit.o = o2;
        }
      }
    }
  }
```

Then, where `view.proof` is assigned at the end of `proveView`, add the population count by changing

```js
  view.proof = Object.assign({ status: 'proven', tried: trace.tried.length, brain: trace.brain, overlap: hit.o.ratio, hits: hit.o.hits, cells: hit.o.cells, kind: hit.kind }, trace.model ? { model: trace.model } : {});
```

to

```js
  view.proof = Object.assign({ status: 'proven', tried: trace.tried.length, brain: trace.brain, overlap: hit.o.ratio, hits: hit.o.hits, cells: hit.o.cells, kind: hit.kind, population: dataRows.length }, trace.model ? { model: trace.model } : {});
```

(`cleanProofCounts` on the server must allow `population`; if it rejects unknown keys, add it there alongside `rows`.)

- [ ] **Step 6: A subset is a named audit failure** (`gold-audit.mjs compareRows`)

Replace

```js
  let verdict;
  if (!gold.length && !mine.length) verdict = 'both-empty';
  else if (!mine.length) verdict = 'missing';
  else if (matched === gold.length && mine.length === gold.length && fieldsSame) verdict = 'same';
  else verdict = 'partial';
  return { endpoint: spec.endpoint, gold: gold.length, adapter: mine.length, matched, fields, verdict };
```

with

```js
  /* A SUBSET IS A FAILURE WITH ITS OWN NAME (owner, 2026-09-16). An adapter that returns some of the
   * ward is more dangerous than one that returns none: the missing patients look like patients who do
   * not exist. It is never folded into "partial". */
  let verdict;
  if (!gold.length && !mine.length) verdict = 'both-empty';
  else if (!mine.length) verdict = 'missing';
  else if (matched === gold.length && mine.length === gold.length && fieldsSame) verdict = 'same';
  else if (mine.length < gold.length && matched === mine.length && fieldsSame) verdict = 'subset';
  else verdict = 'partial';
  return { endpoint: spec.endpoint, gold: gold.length, adapter: mine.length, matched, missing: Math.max(0, gold.length - matched), fields, verdict };
```

- [ ] **Step 6b: Prove the round trip: what proof saved is what replay sends** (owner, 2026-09-16: "ensure replay works")

Saving the widened request is only half of it. This asserts the SAVED endpoint, run through the real replay path, actually sends the whole-ward form in the doctor's session. Append to `test/connect-agent/prove.test.mjs` (import `executeView`, `PAGE_TOKENS`, `parseFetchExpression` from `../../connect-agent/phone/adapter-runtime.mjs` if not already imported), using the same `view` the widening test proved:

```js
test('the widened ward list round-trips: what proof saved is what replay sends', async () => {
  const view = { resourceHint: 'worklist', pathTemplate: HOST + '/Doctor/Home', rowsSelector: '#wl tbody tr', headers: ['UHID', 'Name', 'Bed'],
    proof: { status: 'proven', kind: 'json', population: 4 },
    endpoints: [{ method: 'GET', path: '/Doctor/Home/GetIPWL?Emp_ID&Type=IPWorkList&__RequestVerificationToken', role: 'data',
      params: { Emp_ID: { empty: true }, Type: { constant: 'IPWorkList' }, __RequestVerificationToken: { token: true } } }] };
  const sent = [];
  const plugin = {
    async currentUrl() { return { url: HOST + '/Doctor/Home' }; },
    async evaluate({ expression }) {
      if (expression === PAGE_TOKENS) return { result: '{"__RequestVerificationToken":"tok9"}' };
      const req = parseFetchExpression(expression);
      if (!req) return { result: '[]' };
      sent.push(req.url);
      return { result: JSON.stringify({ status: 200, contentType: 'application/json', url: req.url, text: '[{"patientId":"MR1"},{"patientId":"MR2"},{"patientId":"MR3"},{"patientId":"MR4"}]' }) };
    },
  };
  const out = await executeView({ plugin, origin: HOST, view, patient: {} });
  assert.equal(out.rows.length, 4, 'replay returns the whole in-patient population');
  const url = sent.find((u) => /GetIPWL/.test(u));
  assert.match(url, /Type=IPWorkList/, 'the mode constant is replayed');
  assert.match(url, /__RequestVerificationToken=tok9/, 'the live page token is replayed');
  assert.match(url, /Emp_ID=(&|$)/, 'the doctor filter is replayed EMPTY, so the whole ward comes back');
});
```

**What this task cannot prove.** There is no phone, no doctor session and no live GHIS here, so the real in-patient count is NOT verified by this task. It is verified in Task 8 on the owner's iPhone, where the gold audit compares the adapter's ward against the hand-built adapter's ward patient by patient and a `subset` verdict fails. Never report Task 2c as having verified real hospital data.

- [ ] **Step 7: Run the tests**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/prove.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/gold-audit.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/live-ghis-regressions.test.mjs`
Expected: PASS. `live-ghis-regressions.test.mjs` already asserts the GetIPWL replay sends `Type=IPWorkList` with empty filters and the page token; it must still pass.

- [ ] **Step 8: Commit**

```bash
git add connect-agent/phone/prove.mjs connect-agent/phone/gold-audit.mjs test/connect-agent/prove.test.mjs test/connect-agent/gold-audit.test.mjs
git commit -m "Connect Agent: save a list request in its widest proven form; a subset fails the gold audit"
```

---

### Task 3: A patient read never opens a page, and records how each resource is read

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

### Task 3b: A request that lost the patient is refused, never sent unscoped

**Why:** `provenValue` (`adapter-runtime.mjs:412`) is `if (!src || src.empty || src.unmapped) return '';`, so a patient-keyed parameter whose source is `{unmapped:true}` replays EMPTY. `paramsOf` writes `{unmapped:true}` whenever tracing fails, and tracing fails for every resource when the ward-list proof failed, which is the exact GHIS case this plan exists to fix, and which Task 2 makes MORE likely by rejecting the out-patient list as the ward list. Reproduced against the current tree: a labs endpoint with `params.patient_id = {unmapped:true}` sends `GET /Lab/Home/GetSearchPatientId?patient_id=&DeptID=`, and whatever the hospital returns for an unscoped lab search lands in that one patient's chart. This predates every task in this plan and is not closed by Task 2c: 2c stops discovery from CHOOSING the wide form, while this is the RUNTIME sending a saved one. It is the worst defect in the system: other people's results in a patient's record.

**Files:**
- Modify: `connect-agent/phone/adapter-runtime.mjs` (`provenValue` fallback; new `UnscopedRequest`, `unscopedField`; guard in `executeProven`)
- Modify: `connect-agent/phone/runtime.mjs` (`readPatientDetails` maps the refusal to `unreadable`)
- Modify: `connect-agent/phone/ghis-shim.mjs` (`notRead` reason for a refused scope)
- Modify: `functions/api/connect/agent/[[path]].js` (`adapterCompleteness`: an unscoped patient key is not endpoint-backed)
- Test: `test/connect-agent/adapter-runtime.test.mjs`, `test/connect-agent/phone-runtime.test.mjs`, `test/connect/agent/phone-router.test.mjs`

**Interfaces:**
- Produces: `provenValue` fills an `unmapped` PATIENT_KEY/VISIT_KEY field from `idCandidates(key, patient)[0]` instead of `''`. `export class UnscopedRequest extends Error` (`name: 'UnscopedRequest'`). `export function unscopedField(req, patient) -> key | null`. `executeProven` throws `UnscopedRequest` rather than issue a request that lost the patient. `readPatientDetails` turns that into `{ resource, unreadable: 'not-scoped' }`. `adapterCompleteness` marks such a resource `how: 'unscoped'` and it fails the gate.

- [ ] **Step 1: Write the failing tests** (append to `test/connect-agent/adapter-runtime.test.mjs`; import `provenValue`, `unscopedField`, `executeProven`, `UnscopedRequest`, `parseFetchExpression`)

```js
test('an untraceable patient key is filled from the patient, never sent empty', () => {
  const patient = { patientId: 'MR900001', episodeId: 'IP5550001' };
  assert.equal(provenValue('patient_id', { unmapped: true }, { patient }), 'MR900001', 'a patient key falls back to this patient');
  assert.equal(provenValue('Episode_Id', { unmapped: true }, { patient }), 'IP5550001', 'a visit key falls back to this visit');
  assert.equal(provenValue('DeptID', { unmapped: true }, { patient }), '', 'an ordinary filter is still sent empty');
  assert.equal(provenValue('DeptID', { empty: true }, { patient }), '', 'a proven-empty filter stays empty');
});

test('a request that would go out without the patient is refused, not sent', async () => {
  const patient = { patientId: 'MR900001' };
  assert.equal(unscopedField({ url: '/Lab/Home/Get?patient_id=&DeptID=', body: null }, patient), 'patient_id');
  assert.equal(unscopedField({ url: '/Lab/Home/Get?patient_id=MR900001&DeptID=', body: null }, patient), null);
  assert.equal(unscopedField({ url: '/Lab/Home/Get', body: 'Render_ID=&patient_id=' }, patient), 'patient_id');
  assert.equal(unscopedField({ url: '/Doctor/Home/GetIPWL?PatientId=', body: null }, {}), null, 'the ward list has no patient and is not scoped');

  // executeProven refuses rather than reading whatever the hospital returns for everyone.
  let sent = 0;
  const plugin = { async currentUrl() { return { url: 'https://h/Lab' }; }, async evaluate() { sent += 1; return { result: '{}' }; } };
  const view = { resourceHint: 'labs', pathTemplate: 'https://h/Lab', rowsSelector: 'tr', headers: ['Test'], proof: { status: 'proven' },
    endpoints: [{ method: 'GET', path: '/Lab/Home/Get?patient_id', role: 'data', params: { patient_id: { empty: true } } }] };
  await assert.rejects(executeProven({ plugin, origin: 'https://h', view, patient }), (e) => e.name === 'UnscopedRequest');
  assert.equal(sent, 0, 'the unscoped request was never issued to the hospital');
});
```

Append to `test/connect-agent/phone-runtime.test.mjs`:

```js
test('a refused unscoped request is reported unreadable, not as an empty result', async () => {
  const plugin = {
    async navigate() { throw new Error('the patient read must never navigate'); },
    async currentUrl() { return { url: 'https://h/home' }; },
    async evaluate() { return { result: '{}' }; },
  };
  const replay = [{ resourceHint: 'labs', pathTemplate: 'https://h/home', rowsSelector: 'tr', headers: ['Test'], proof: { status: 'proven' },
    endpoints: [{ method: 'GET', path: '/Lab/Get?patient_id', role: 'data', params: { patient_id: { empty: true } } }] }];
  const secs = await readPatientDetails({ plugin, origin: 'https://h', replay, patient: { patientId: 'K1' }, settleMs: 0 });
  assert.deepEqual(secs.find((s) => s.resource === 'labs'), { resource: 'labs', unreadable: 'not-scoped' });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/adapter-runtime.test.mjs; node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/phone-runtime.test.mjs`
Expected: FAIL. `provenValue` returns `''` for the patient key, `unscopedField`/`UnscopedRequest` are undefined, and the labs section comes back as empty rows rather than `not-scoped`.

- [ ] **Step 3: Fill an untraceable patient key from the patient** (`adapter-runtime.mjs provenValue`)

Replace `if (!src || src.empty || src.unmapped) return '';` with:

```js
  /* AN UNTRACEABLE PATIENT KEY IS NOT AN EMPTY ONE. `unmapped` means tracing failed, and tracing fails
   * for every resource whenever the ward-list proof failed. Sending a patient-keyed field empty turns
   * this patient's request into an unscoped one, and whatever the hospital answers lands in this
   * patient's chart. Fall back to the id this patient carries, exactly as the worklist branch does. */
  if (!src) return '';
  if (src.unmapped) return (PATIENT_KEY.test(key) || VISIT_KEY.test(key)) ? (idCandidates(key, patient)[0] || '') : '';
  if (src.empty) return '';
```

- [ ] **Step 4: Refuse a request that lost the patient** (`adapter-runtime.mjs`, next to `NotSignedIn`)

```js
export class UnscopedRequest extends Error { constructor(m) { super(m); this.name = 'UnscopedRequest'; } }

/** The patient-keyed or visit-keyed field that would go out EMPTY while this patient has an id, or null. */
export function unscopedField(req, patient) {
  if (!patient || !(patient.patientId || patient.episodeId)) return null;   // the ward list is not patient-scoped
  const bad = (k, v) => (PATIENT_KEY.test(k) || VISIT_KEY.test(k)) && !String(v || '');
  try {
    const u = new URL(String(req.url || ''), 'https://x.invalid');
    for (const [k, v] of u.searchParams) if (bad(k, v)) return k;
  } catch { /* relative or malformed: fall through to the body */ }
  if (typeof req.body === 'string' && req.body.indexOf('=') >= 0) {
    for (const part of req.body.split('&')) {
      const i = part.indexOf('=');
      if (bad(i >= 0 ? part.slice(0, i) : part, i >= 0 ? part.slice(i + 1) : '')) return i >= 0 ? part.slice(0, i) : part;
    }
  }
  return null;
}
```

In `executeProven`, directly after `const call = { method: req.method, url: base + req.url, body: req.body, headers: req.headers };` add:

```js
    const lost = unscopedField({ url: req.url, body: req.body }, patient);
    if (lost) throw new UnscopedRequest('refusing ' + req.path + ': "' + lost + '" has no learned source, so the request would not be limited to this patient');
```

- [ ] **Step 5: Report it as unreadable** (`runtime.mjs readPatientDetails`, the `catch` around `replayFirst` added in Task 3)

```js
    try { replayed = await replayFirst({ plugin, origin: vo, view: v, patient, onRead }); } catch (e) {
      if (e && e.name === 'NotSignedIn') throw e;
      if (e && e.name === 'UnscopedRequest') { sections.push({ resource: r, unreadable: 'not-scoped' }); continue; }
      sections.push({ resource: r, error: String((e && e.message) || e) });
      continue;
    }
```

And in `ghis-shim.mjs notRead`, replace the `why` line with:

```js
  const why = own.some((s) => s.unreadable === 'not-scoped')
    ? 'the agent never learned which field carries the patient, so the request could not be limited to this patient.'
    : own.some((s) => s.error) ? 'the hospital did not answer.' : 'the agent never learned this screen for this hospital. Run Connect Hospital again to teach it.';
```

- [ ] **Step 6: An unscoped endpoint is not endpoint-backed** (`functions/api/connect/agent/[[path]].js adapterCompleteness`, Task 6)

Inside `adapterCompleteness`, replace the `provenEndpoint` helper with:

```js
  const PATIENT_ISH = /record|mrn|uhid|patient|reg(no|istration)|hosp(ital)?(no|id)|umr|^id$|visit|episode|encounter|admission|ip(no|number)/i;
  const scoped = (v) => (v.endpoints || []).every((e) => {
    if (!e || e.role !== "data") return true;
    const p = e.params || {};
    return !Object.keys(p).some((k) => PATIENT_ISH.test(k) && p[k] && (p[k].unmapped === true || p[k].empty === true));
  });
  const provenEndpoint = (res) => views.some((v) => v && v.resourceHint === res && v.proof && v.proof.status === "proven" && Array.isArray(v.endpoints) && v.endpoints.some((e) => e && e.role === "data") && scoped(v));
```

and add an `unscoped` label so the owner sees why: in the loop, `else { how[res] = views.some((v) => v && v.resourceHint === res && !scoped(v)) ? "unscoped" : "absent"; missing.push(res); }`. The worklist is exempt: it is not patient-scoped, so `PATIENT_ISH` params there are expected to be empty. Guard with `if (res !== "worklist" && ...)` inside `scoped` usage, or skip the `scoped` check when `res === "worklist"`.

- [ ] **Step 7: Run the tests**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/adapter-runtime.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/phone-runtime.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/ghis-shim.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/prove.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/live-ghis-regressions.test.mjs && node test/run-ward-adapter-ui.mjs`
Expected: PASS, `ALL GREEN`.

- [ ] **Step 8: Commit**

```bash
git add connect-agent/phone/adapter-runtime.mjs connect-agent/phone/runtime.mjs connect-agent/phone/ghis-shim.mjs functions/api/connect/agent/\[\[path\]\].js test/connect-agent/adapter-runtime.test.mjs test/connect-agent/phone-runtime.test.mjs
git commit -m "Connect Agent: a request that lost the patient is refused, never sent unscoped"
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

### Task 6: No approval unless the adapter is endpoint-complete, and store how each resource is read

**Files:**
- Modify: `functions/api/connect/agent/[[path]].js` (new `REQUIRED_RESOURCES` + `adapterCompleteness` helper near `cleanProofTrace`; approve route ~1195; `GET /versions/:id` response ~1180)
- Test: `test/connect/agent/phone-router.test.mjs`

**Interfaces:**
- Consumes: `findJobByCandidateVersion`, `safeJsonParse`, `OnboardError` (already in the router).
- Produces: `adapterCompleteness(observedViews) -> { how: { <resource>: "endpoint" | "absent" }, endpointComplete: boolean, missing: [resource] }` over `REQUIRED_RESOURCES = ["worklist","medications","labs","labs-detail","radiology","radiology-detail"]` (history is offered when present but never gates). `POST /versions/:id/approve` answers 409 for a phone adapter (has observedViews) that is not endpoint-complete, naming the missing resources. `GET /versions/:id` carries `completeness`. JSON-probe adapters (no observed views) are unaffected.

- [ ] **Step 1: Write the failing test** (append to `test/connect/agent/phone-router.test.mjs`)

```js
function provenViewOf(resourceHint, path, extra) {
  return Object.assign({
    resourceHint, pathTemplate: "/Doctor/Home", rowsSelector: "#t tbody tr", headers: ["A", "B"],
    proof: { status: "proven", tried: 1, brain: true, overlap: 1, hits: 4, cells: 4, kind: "json" },
    endpoints: [{ method: "GET", path, xhr: true, role: "data", params: { id: { from: "worklist", field: "MRNo" } }, proof: { kind: "json", hits: 4, cells: 4, overlap: 1, rows: 2 } }],
  }, extra || {});
}
function completeSet() {
  return [
    provenViewOf("worklist", "/Doctor/Home/GetIPWL?Type=IPWorkList&__RequestVerificationToken", { endpoints: [{ method: "GET", path: "/Doctor/Home/GetIPWL?Type=IPWorkList&__RequestVerificationToken", xhr: true, role: "data", params: { Type: { constant: "IPWorkList" }, __RequestVerificationToken: { token: true } }, proof: { kind: "json", hits: 4, cells: 4, overlap: 1, rows: 2 } }] }),
    provenViewOf("medications", "/Doctor/Home/GetMedicines/?id"),
    provenViewOf("labs", "/Lab/Home/GetSearchPatientId?patient_id"),
    Object.assign(provenViewOf("labs-detail", "/Lab/Home/GetPrintLabResultDetailsAuth?Render_ID"), { detailOf: "labs" }),
    provenViewOf("radiology", "/Radio/Home?recordNo"),
    Object.assign(provenViewOf("radiology-detail", "/Radiology/Home/GetRadiologyResultPrint?resultid"), { detailOf: "radiology" }),
  ];
}

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
  return Object.assign(t, { sessionId, versionId: (await evRes.json()).candidateVersionId });
}

test("approval needs every required resource endpoint-backed; GET /versions/:id reports completeness", async () => {
  // A resource missing its proven endpoint: refused, and the missing one is named.
  const partial = await phoneCandidate(completeSet().filter((v) => v.resourceHint !== "radiology-detail"));
  const refused = await onRequest(post(`/api/connect/agent/versions/${partial.versionId}/approve`, { tenantId: "t1" }, partial.env, partial.owner1.headers));
  assert.equal(refused.status, 409);
  assert.match(JSON.stringify(await refused.json()), /radiology-detail/);
  const verGet = await (await onRequest(get(`/api/connect/agent/versions/${partial.versionId}?tenant=t1`, partial.env, partial.doc1.headers))).json();
  assert.equal(verGet.completeness.endpointComplete, false);
  assert.equal(verGet.completeness.how["medications"], "endpoint");
  assert.deepEqual(verGet.completeness.missing, ["radiology-detail"]);

  // The ward list unproven: also refused, naming the ward list.
  const noWard = completeSet();
  delete noWard[0].proof; delete noWard[0].endpoints;
  const wardRefused = await onRequest(post(`/api/connect/agent/versions/${(await phoneCandidate(noWard)).versionId}/approve`, { tenantId: "t1" }, partial.env, partial.owner1.headers));
  assert.equal(wardRefused.status, 409);
  assert.match(JSON.stringify(await wardRefused.json()), /worklist/);

  // Every required resource proven: approved.
  const full = await phoneCandidate(completeSet());
  const ok = await onRequest(post(`/api/connect/agent/versions/${full.versionId}/approve`, { tenantId: "t1" }, full.env, full.owner1.headers));
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal((await ok.json()).state, "ACTIVE");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/phone-router.test.mjs`
Expected: FAIL, the partial candidate is approved with 200 and `completeness` is undefined.

- [ ] **Step 3: Add the completeness helper** (`functions/api/connect/agent/[[path]].js`, directly after `cleanProofTrace`)

```js
/* ENDPOINT-COMPLETE OR NOT COMPLETE (owner, 2026-09-16). Every routine clinical resource must be a
 * proven backend request; a resource read only by scraping a page, or not read at all, means the
 * adapter is not done. History rides OPD-side and never gates (the hand-built adapter reads it there). */
const REQUIRED_RESOURCES = ["worklist", "medications", "labs", "labs-detail", "radiology", "radiology-detail"];
function adapterCompleteness(observedViews) {
  const views = Array.isArray(observedViews) ? observedViews : [];
  const provenEndpoint = (res) => views.some((v) => v && v.resourceHint === res && v.proof && v.proof.status === "proven" && Array.isArray(v.endpoints) && v.endpoints.some((e) => e && e.role === "data"));
  const how = {};
  const missing = [];
  for (const res of REQUIRED_RESOURCES) {
    if (provenEndpoint(res)) how[res] = "endpoint";
    else { how[res] = "absent"; missing.push(res); }
  }
  return { how, endpointComplete: missing.length === 0, missing };
}
```

- [ ] **Step 4: Gate approval** (approve route)

Replace

```js
      const version = await getVersion(deps.db, tid, versionId);
      if (!version) throw new OnboardError("not-found", "adapter version not found");
```

with

```js
      const version = await getVersion(deps.db, tid, versionId);
      if (!version) throw new OnboardError("not-found", "adapter version not found");
      /* ENDPOINT-COMPLETE, OR NOT APPROVED. Every required clinical resource must be a proven backend
       * request; approving a partial adapter put a 30-minute page hang in front of the owner
       * (ver_b16da370, 2026-09-15). JSON-probe adapters (no observed views) keep their own evidence. */
      const job = await findJobByCandidateVersion(deps.db, tid, versionId);
      const candidateViews = ((job && safeJsonParse(job.phone_state)) || {}).observedViews;
      if (Array.isArray(candidateViews) && candidateViews.length) {
        const completeness = adapterCompleteness(candidateViews);
        if (!completeness.endpointComplete) {
          throw new OnboardError("conflict", "this adapter is not endpoint-complete: no proven backend request for " + completeness.missing.join(", ") + ". Run Connect Hospital again and show the missing screens");
        }
      }
```

and delete the later duplicate `const job = await findJobByCandidateVersion(deps.db, tid, versionId);` (after `activateVersion`), since `job` is now declared above.

- [ ] **Step 5: Report completeness on the version** (`GET /versions/:id` response, ~1180)

After the `proofTrace:` line added in Task 1, add:

```js
        completeness: adapterCompleteness(phoneState && phoneState.observedViews),
```

- [ ] **Step 6: Run the tests**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/phone-router.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/activation.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/candidate-limit.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/repair.test.mjs`
Expected: PASS. If `repair.test.mjs` or the existing full-flow test approves a candidate that is now not endpoint-complete, give that fixture the `completeSet()` views (a repair is a new candidate and meets the same bar), or assert the 409 if the fixture is deliberately partial.

- [ ] **Step 7: Commit**

```bash
git add functions/api/connect/agent/\[\[path\]\].js test/connect/agent/phone-router.test.mjs
git commit -m "Connect Agent: approve only an endpoint-complete adapter; report per-resource how"
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

### Task 7b: The runtime never scrapes when an endpoint was proven; repair re-proves a backend request

**Why:** The contract forbids DOM scraping as the runtime path. Two paths still scrape: `readWorklist` falls back to `readView` (page scrape) when endpoint replay returns nothing (`runtime.mjs:337-340`), and self-repair captures a DOM view and saves it as the runtime pattern (`ghis-ward.js ghisSelfRepair`, `runtime.mjs captureWorklist`, the `/repair` route). For an endpoint-complete adapter neither may happen: a proven worklist that returns nothing goes to repair, and repair re-proves a backend request, never saves a scraper. The DOM read survives only for an EMR with no discoverable endpoint, explicitly, never for GHIS.

**Files:**
- Modify: `connect-agent/phone/runtime.mjs` (`readWorklist` fallback guard; new `reproveWorklist`)
- Modify: `ghis-ward.js` (`ghisSelfRepair`)
- Modify: `functions/api/connect/agent/[[path]].js` (`/repair` route: a repaired worklist must carry a data endpoint)
- Test: `test/connect-agent/phone-runtime.test.mjs`, `test/run-ward-adapter-ui.mjs`, `test/connect/agent/repair.test.mjs`

**Interfaces:**
- Consumes: `provenView` (Task 3), `navToReplayEntries`, `INJECT_REPLAY_SRC`, `createProofBook` (Task 2b, prove.mjs).
- Produces: `export async function reproveWorklist({ plugin, origin, view, parents }) -> view | null` (proves a backend request on the shown screen; returns the view with `endpoints` if proven, else null). `readWorklist` scrapes only when the worklist view has no endpoints and is not proven (a DOM-only adapter); a proven worklist that returns nothing throws `no patient rows found`. `/repair` answers 409 unless the repaired view carries a `role:'data'` endpoint.

- [ ] **Step 1: Write the failing tests** (append to `test/connect-agent/phone-runtime.test.mjs`; `reproveWorklist` added to the import)

```js
test('a proven worklist that returns nothing does not scrape: it throws for repair', async () => {
  let navigated = 0;
  const plugin = {
    async navigate() { navigated += 1; },
    async currentUrl() { return { url: 'https://ghis.gitam.edu/Doctor/Home' }; },
    async evaluate({ expression }) {
      const req = parseFetchExpression(expression);
      if (req) return { result: JSON.stringify({ status: 200, contentType: 'application/json', url: req.url, text: '[]' }) };
      return { result: '[]' };
    },
  };
  const replay = [{ resourceHint: 'worklist', pathTemplate: 'https://ghis.gitam.edu/Doctor/Home', rowsSelector: 'tr', headers: ['Patient ID'], proof: { status: 'proven' },
    endpoints: [{ method: 'GET', path: '/Doctor/Home/GetIPWL?Type=IPWorkList', role: 'data', params: { Type: { constant: 'IPWorkList' } } }] }];
  await assert.rejects(readWorklist({ plugin, origin: 'https://gimsrlogin.gitam.edu', replay, settleMs: 0, maxWaitMs: 5 }), /no patient rows found/);
  assert.equal(navigated, 0, 'a proven adapter never navigates a page to scrape');
});

test('reproveWorklist proves a backend request on the screen the doctor showed', async () => {
  const IPWL = JSON.stringify([{ patientId: 'MR1', patientFirstName: 'A', bedName: 'B1' }, { patientId: 'MR2', patientFirstName: 'C', bedName: 'B2' }]);
  const plugin = {
    async currentUrl() { return { url: 'https://ghis.gitam.edu/Doctor/Home/Nurseipwlnew' }; },
    async drainRequests() { return { requests: [] }; },
    async evaluate({ expression }) {
      if (expression.indexOf('__SMD_REPLAY__') >= 0 && expression.indexOf('PROVE') < 0) return { result: '0' };
      if (expression.indexOf('PROVE_LIST') >= 0) return { result: JSON.stringify([{ seq: 1, method: 'GET', url: 'https://ghis.gitam.edu/Doctor/Home/GetIPWL?Type=IPWorkList', body: null, xhr: true, status: 200, shape: { kind: 'json', keys: ['patientId'], rows: 2 } }]) };
      if (expression.indexOf('PROVE_SCREEN') >= 0) return { result: JSON.stringify([['MR1', 'A', 'B1'], ['MR2', 'C', 'B2']]) };
      if (expression.indexOf('PROVE_EXEC') >= 0) return { result: JSON.stringify({ status: 200, contentType: 'application/json', url: 'x', text: IPWL }) };
      return { result: '[]' };
    },
  };
  const view = { resourceHint: 'worklist', pathTemplate: 'https://ghis.gitam.edu/Doctor/Home', rowsSelector: '#wl tbody tr', headers: ['UHID', 'Name', 'Bed'] };
  const out = await reproveWorklist({ plugin, origin: 'https://ghis.gitam.edu', view });
  assert.ok(out, 'a backend request was proven');
  assert.equal(out.endpoints.find((e) => e.role === 'data').path.split('?')[0], '/Doctor/Home/GetIPWL');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/phone-runtime.test.mjs`
Expected: FAIL. The first test scrapes (navigated > 0); `reproveWorklist` is undefined.

- [ ] **Step 3: Guard the worklist fallback** (`runtime.mjs readWorklist`, the `if (!rows)` block)

Replace

```js
  if (!rows) {
    rows = await readView({ plugin, origin, view, settleMs, toggleAll: true, maxWaitMs: maxWaitMs || 20000 });
    if (onRead) onRead({ resource: 'worklist', via: 'page' });
  }
```

with

```js
  if (!rows) {
    /* NO SCRAPE FOR AN ENDPOINT ADAPTER (owner, 2026-09-16). A proven worklist, or one that recorded
     * any endpoint, that returns nothing is a drift, not a licence to read the page: it goes to repair,
     * which re-proves a backend request. Only a worklist with no endpoint at all (a DOM-only EMR) is
     * read from its page, the one labeled last resort. */
    if (provenView(view) || (Array.isArray(view.endpoints) && view.endpoints.length)) {
      throw new Error('no patient rows found at ' + (view.pathTemplate || view.path || origin) + ' through the proven request; the hospital layout may have changed');
    }
    rows = await readView({ plugin, origin, view, settleMs, toggleAll: true, maxWaitMs: maxWaitMs || 20000 });
    if (onRead) onRead({ resource: 'worklist', via: 'page' });
  }
```

- [ ] **Step 4: Add `reproveWorklist`** (`runtime.mjs`, after `captureWorklist`)

```js
/* REPAIR RE-PROVES, IT DOES NOT SCRAPE (owner, 2026-09-16). The doctor showed the patient list; the
 * requests their taps fired (fetch/XHR in the page buffer, and navigations injected from the native
 * log) are proven against the screen, exactly as discovery does. A proven view carries a backend
 * request the runtime replays; an unproven one is not saved. */
export async function reproveWorklist({ plugin, origin, view, parents = [] }) {
  const prove = await import('./prove.mjs');
  const client = { currentUrl: () => plugin.currentUrl(), evaluate: (a) => plugin.evaluate(a) };
  if (typeof plugin.drainRequests === 'function') {
    try {
      const drained = await plugin.drainRequests();
      let pageOrigin = null;
      try { const cur = await plugin.currentUrl(); pageOrigin = new URL(typeof cur === 'string' ? cur : cur && cur.url).origin; } catch { pageOrigin = null; }
      const nav = prove.navToReplayEntries(drained, { pageOrigin, allowedOrigins: [origin] });
      if (nav.length) await plugin.evaluate({ expression: '(' + prove.INJECT_REPLAY_SRC + ')(' + JSON.stringify(nav) + ')' }).catch(() => {});
    } catch { /* best effort */ }
  }
  const book = prove.createProofBook({ brain: null });
  await book.prove({ client, view, label: 'the doctor showed the patient list', since: -1 });
  return provenView(view) ? view : null;
}
```

- [ ] **Step 5: Self-repair re-proves, and never posts a scraper** (`ghis-ward.js ghisSelfRepair`)

Replace the `.then(function (view) { return rt.readView(...) ... })` tail (from `return rt.captureWorklist({ plugin: plugin });` onward) with:

```js
          return rt.captureWorklist({ plugin: plugin });
        }).then(function (view) {
          return rt.reproveWorklist({ plugin: plugin, origin: ctx.origin, view: view }).then(function (proven) {
            if (!proven) {
              throw new Error('I could not find a data request behind your patient list on ' + ctx.host + '. This hospital needs a fresh Connect Hospital run so the agent can learn it. ' + err.message);
            }
            return rt.readWorklist({ plugin: plugin, origin: ctx.origin, replay: [proven] }).then(function (patients) {
              if (!patients.length) throw new Error('The request I learned from that screen returned no patients. ' + err.message);
              agentApi('/versions/' + encodeURIComponent(ctx.versionId) + '/repair', ctx.tid, { method: 'POST', body: JSON.stringify({ sessionId: ctx.sessionId, view: proven }) }).then(function (r) {
                if (r.s === 200 && r.d && r.d.ok !== false) { try { if (window.toast) window.toast('Thanks. A corrected adapter was sent for approval.'); } catch (e) {} }
              });
              return patients;
            });
          });
        });
```

- [ ] **Step 6: The repair route requires a data endpoint** (`functions/api/connect/agent/[[path]].js`, `/repair` route, after `if (!view.rowsSelector) throw ...`)

```js
      if (!Array.isArray(view.endpoints) || !view.endpoints.some((e) => e && e.role === "data")) {
        throw new OnboardError("conflict", "a repaired ward list must carry a proven backend request, not a page selector");
      }
```

- [ ] **Step 7: Update the harness repair scenario** (`test/run-ward-adapter-ui.mjs`, the self-repair block at lines ~200-222)

The empty read now goes to repair, which re-proves. Give the shown "all patients" screen a data call and assert the repair posts a proven endpoint, not a selector:
- In the `/versions/ver-1` MOCK, give the KIMS worklist view `proof: { status: "proven" }` and an `endpoints: [{ method: "GET", path: "/api/ward/patients?unit&start&length", role: "data", params: {} }]` so the first read replays it; drive the empty read by making that route return `{ data: [] }` for this scenario, then after the doctor shows the list, register a route that returns two patients and add it to the page's replay buffer via the fake plugin's `drainRequests` returning that GET url. Assert:

```js
  ok(await waitFor(`var c=window.__calls.filter(function(x){return x.path==="/versions/ver-1/repair"&&x.method==="POST";}); return c.length===1 && Array.isArray(c[0].body.view.endpoints) && c[0].body.view.endpoints.some(function(e){return e.role==="data";});`, 8000), "repair posts a proven backend request, not a page selector");
  ok(await ev(`var c=window.__calls.filter(function(x){return x.path==="/versions/ver-1/repair";})[0]; return JSON.stringify(c.body).indexOf("Ravi")<0 && JSON.stringify(c.body).indexOf("K001")<0;`) === true, "no patient cell text leaves the phone in the repair");
```

Add a `drainRequests: function(){ return Promise.resolve({ requests: window.__navLog || [] }); }` to `FAKE_PLUGIN`'s `ConnectBrowser`, and in the repair scenario set `window.__navLog = [{ method: "GET", url: "https://hims.kims.example/api/ward/patients?unit=&start=0&length=1000" }]` before firing the `loggedIn` that shows the list. Remove the old assertions that expected `body.view.rowsSelector` and a DOM `__rawTables` capture.

- [ ] **Step 8: Fix the server repair test** (`test/connect/agent/repair.test.mjs`)

Give the repaired view in that test a `role:'data'` endpoint (it now must carry one). If the test asserts a selector-only repair succeeds, change it to assert 409 for a selector-only view and 200 for one with a proven endpoint.

- [ ] **Step 9: Run the tests and the full suite**

Run: `node --experimental-test-module-mocks --experimental-sqlite test/connect-agent/phone-runtime.test.mjs && node --experimental-test-module-mocks --experimental-sqlite test/connect/agent/repair.test.mjs && node test/run-ward-adapter-ui.mjs && npm test`
Expected: PASS, `ALL GREEN`, `npm test` exits 0 with no `FAILED:` line.

- [ ] **Step 10: Commit**

```bash
git add connect-agent/phone/runtime.mjs ghis-ward.js functions/api/connect/agent/\[\[path\]\].js test/connect-agent/phone-runtime.test.mjs test/run-ward-adapter-ui.mjs test/connect/agent/repair.test.mjs
git commit -m "Connect Agent: the runtime never scrapes when proven; repair re-proves a backend request"
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
| The hand-built path is in `attempts` with `ratio >= 0.5` but another path was kept | scoring chose wrong | Add a `prove.test.mjs` case with both answers shaped like the trace (counts and kinds) and adjust `specificity` until it picks the hand-built one; rerun the Task 2 tests, rebuild per Step 2 and repeat from Step 4 |
| The hand-built path is in `attempts` but was never accepted (`hits` low, `ratio < 0.5`) | the screen the agent compared against was not that resource's screen | The guided ask for that resource is wrong. Fix the ask wording in `connect-agent/phone/onboard.mjs` for that gap, rebuild, repeat from Step 4 |
| The hand-built path is still absent from `attempts` (status `no-requests`) after Task 2b | neither a fetch/XHR nor a main-frame navigation was captured for that screen | Stop. Capture how that screen actually loads (frame, `<img>`/`<object>` source, WebSocket, or a POST navigation, none of which Task 2b covers) and write a follow-up plan citing this trace. Do not patch without it |

Task 2b already makes a patient-keyed full-page GET (the radiology list page, a report opened by navigation) provable, so that is not a failure mode to fix here.

- [ ] **Step 8: Approve, then run the gold audit**

Owner approves. Owner signs in to the hand-built GIMSR connection in the app too (the audit needs both), then opens the GIMSR (adapter) ward list. Through `test/ios-webkit-cdp.mjs`:

```js
window.__gold = null; GHIS.goldAudit().then(function (r) { window.__gold = r; }, function (e) { window.__gold = { error: String(e && e.message || e) }; }); 1
```

then poll `JSON.stringify(window.__gold)` until it is not `null`. Save the report (counts and names only) to `docs/connect/ghis-parity-2026-09-16.md`.

Pass criteria, all required:
- `endpoints[]`: `same === true` for `worklist`, `labs`, `labs-detail`, `radiology`, `radiology-detail`, `medications`.
- `worklist.verdict === "same"`, and `worklist.adapter === worklist.gold`: the adapter returns the WHOLE in-patient population, not the signed-in doctor's share. A `verdict` of `subset` here is an outright failure, however well the rows that did come back matched.
- No grade anywhere in the report has `verdict: "subset"`.
- Every patient grade for `medications`, `lab`, `lab-detail`, `radiology`, `radiology-report` has `verdict` `same` or `both-empty`.
- The saved ward-list request carries `Type=IPWorkList` with its filters empty: check the approved version's worklist endpoint (`GET /versions/:id` -> `replay`) shows `params` with `{ "empty": true }` for the doctor and unit filters, and that `proof.population` equals the gold ward size.

- [ ] **Step 9: The owner's acceptance test (endpoint-driven, browser UI stopped)**

The contract: with the browser UI stopped, the adapter must retrieve a real patient's data through the discovered requests alone, with no page opened, clicked or scraped.

Through `test/ios-webkit-cdp.mjs`, with the GIMSR (adapter) ward list loaded, for a patient id from that list:

```js
var _pid = '<a patientId from the ward list>';
window.__acc = null;
window.__calls = [];
var _p = window.Capacitor.Plugins.ConnectBrowser;
['open','navigate','setMode','close'].forEach(function (m) { var f = _p[m].bind(_p); _p[m] = function (a) { window.__calls.push({ m: m, hidden: a && a.hidden, url: a && a.url }); return f(a); }; });
var s = performance.now();
fetch(GHIS.getProxyBase() + '/profile?patientId=' + encodeURIComponent(_pid)).then(function (r) { return r.json(); }).then(function (j) {
  window.__acc = { ms: Math.round(performance.now() - s), labs: (j.labs || []).length, meds: (j.medications || []).length, rad: (j.radiology || []).length, unreadable: j.unreadable || null, calls: window.__calls };
}); 1
```

While it runs, take `pymobiledevice3 developer dvt screenshot $CLAUDE_JOB_DIR/tmp/parity-read.png` and look at it. Then read `JSON.stringify(window.__acc)`.

Pass criteria, all required:
- `__acc.calls` contains **no `navigate`** call: the read never loaded a hospital page.
- Every `open`/`setMode` in `__acc.calls` has `hidden: true`.
- `__acc.labs`, `__acc.meds` and `__acc.rad` are the real counts for that patient (match the hand-built proxy's own `/profile` for the same patient), and `__acc.unreadable` is null.
- `__acc.ms <= 5000`.
- The screenshot shows StewardMD, not the hospital page and not the orange banner.

- [ ] **Step 9a: Reuse by a second doctor without rediscovery**

A second doctor in the same tenant (or the owner after `window.ghisDisconnect()` and a fresh sign-in) opens the same GIMSR (adapter) hospital and taps a patient. Pass criteria: the ward list and the patient drawer fill from the same approved version with no discovery run (no `POST /sessions/:id/discovery` in the network log, `reuse: true` on `POST /sessions`), and Step 9's call assertions hold again on their session.

- [ ] **Step 10: Record it**

Append to `vault/decisions/Decisions.md`:

```markdown
## 2026-09-16 Connect Agent reads GHIS through the hand-built adapter's own requests

**Decision:** Every Connect Agent adapter is endpoint-driven: the hospital's own backend requests, discovered and proven at onboarding, replayed in the doctor's session; DOM scraping is never the runtime path. Navigation and popup requests are captured from the native log and proven like any fetch (this is what lab results, radiology reports and history needed). A proven call is the most specific answer that carries the screen, not the first; the ward list is judged as admitted in-patients; a patient read runs only proven endpoints; every request (12 s) and every read (30 s) has a deadline; the app reads nothing unless the native browser confirms hidden; approval requires endpoint-completeness across worklist, medications, labs, labs-detail, radiology and radiology-detail; repair re-proves a request instead of saving a scraper; the GIMSR GetIPWL injection is gone. Parity is graded by `GHIS.goldAudit` and the owner's acceptance test (report in `docs/connect/ghis-parity-2026-09-16.md`).

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

---

# GOLD-STANDARD CORRECTIONS — MUST BE PART OF THE IMPLEMENTATION

The following rules are mandatory. They tighten the plan so the generated adapter is truly equivalent to the hand-built GHIS adapter at runtime, not merely similar by URL or screen.

## 1. Define adapter parity at the REQUEST-BEHAVIOR level

The generated adapter is considered equivalent only when it can reproduce the required clinical operation with the same backend behavior.

For every proven operation, store enough information to execute it later:

- HTTP method
- exact URL/path
- query parameters
- POST body/form fields/JSON body
- required headers
- content type
- cookies/session binding
- CSRF/anti-forgery/request-verification tokens and how they are obtained/refreshed
- redirect behavior where relevant
- response type: JSON, HTML, text, etc.
- parser/extractor
- pagination rules
- identifiers required by later requests
- prerequisite requests
- request dependencies
- multi-request chains
- canonical StewardMD mapping

Do not declare an endpoint learned merely because its URL, name, columns, or visible text looks correct.

## 2. Prove the COMPLETE request chain

A clinical resource is not proven until the complete chain needed to obtain the usable clinical data has been proven.

Examples for GHIS:

### Labs

Prove the equivalent of:

`GetSearchPatientId`
→ obtain the required identifiers such as `ServiceRenderId` and `episode_id`
→ `GetPrintLabResultDetailsAuth`
→ parse the actual laboratory result.

Proving only the lab list/search request is insufficient.

### Radiology

Prove the equivalent of:

radiology list request
→ obtain `resultid`
→ `GetRadiologyResultPrint`
→ parse the actual radiology report.

Proving only the radiology list is insufficient.

### Other resources

Apply the same rule to every resource that requires a list → detail, search → detail, token → data, or prerequisite → data chain.

## 3. Resource-specific verification; do not trust text overlap

Do not use generic keyword overlap as sufficient proof.

A whole patient/visit page may contain words such as "lab", "radiology", "medicine", etc. without being the backend operation that supplies that resource.

Verification must establish:

1. The candidate request is associated with the intended user action.
2. Its response contains the expected resource-specific structure/data.
3. Required identifiers are produced or consumed correctly.
4. The candidate can be replayed with the authenticated session.
5. The resulting data maps to the intended canonical resource.

Gemini may propose or explain candidates, but deterministic verification must decide whether the evidence proves the operation.

## 4. Capture navigation requests completely

Navigation/popup discovery must not capture only GET requests.

Observe relevant:

- main-frame GET navigation
- main-frame POST navigation
- popup/new-window navigation
- redirects
- request method
- URL
- query
- body/form data
- content type
- relevant headers

A report/detail workflow can be a navigation request rather than a fetch/XHR call. It must still become observable evidence when authorized and technically available.

## 5. Correct absence state

Do not confuse these states:

- `PROVEN` = backend operation was executed and verified.
- `PROVEN_ABSENT` = the resource was explicitly checked and the hospital's EMR genuinely does not provide it.
- `DOM_ONLY` = the resource appears only through a page/UI and no backend operation has been proven.
- `UNKNOWN` = insufficient evidence.

For required resources:

- `PROVEN` → complete
- `PROVEN_ABSENT` → complete for that hospital/resource
- `DOM_ONLY` → NOT complete
- `UNKNOWN` → NOT complete

Therefore an agent cannot finish discovery simply by declaring a resource "absent" without evidence.

## 6. Gold audit must compare clinical DATA, not only endpoints

The final GHIS gold audit must compare the generated adapter against the hand-built GHIS adapter at two levels.

### Level A — Request/chain parity

Compare:

- methods
- endpoint paths
- required parameters
- request bodies
- prerequisite requests
- identifiers
- token/session handling
- response formats
- parsers
- pagination
- chain dependencies

Exact URL equality is preferred where the hospital uses the same endpoint. If an implementation uses an equivalent endpoint, document why the behavior is equivalent.

### Level B — Normalized clinical-data parity

For the same authorized test patient/visit, compare normalized output for every supported resource:

- patient identity/basic details
- medications
- labs
- lab details/results
- radiology
- radiology report/details
- history/encounters where offered

Ignore irrelevant formatting differences such as HTML whitespace, ordering where clinically non-semantic, or presentation markup.

The generated adapter passes only when the supported clinical data is materially equivalent to the hand-built adapter's output.

## 7. No page-scraping fallback after endpoint proof

Runtime must use the proven backend operation whenever one exists.

Do NOT silently fall back to:

- opening the patient page
- clicking the hospital UI
- reading rendered tables
- DOM scraping
- screenshot/OCR extraction

If a required backend operation is unproven, the system must report that the adapter is incomplete or needs repair rather than pretending the resource works through page scraping.

A browser may still be used during authorized discovery to cause and observe requests. It is not the normal clinical data path after the adapter is proven.

## 8. Adapter = executable connector, not a map

The final adapter is both:

1. discovery knowledge about how the hospital EMR works, and
2. executable runtime logic for obtaining canonical StewardMD data.

It must be reusable by future doctors at the same hospital.

The adapter is shared at hospital level.

Authentication is NOT shared:

- Doctor A uses Doctor A's authenticated session/cookies/tokens.
- Doctor B uses Doctor B's authenticated session/cookies/tokens.
- Never reuse Doctor A's session for Doctor B.

The runtime must bind each execution to the currently authenticated doctor's authorized hospital session.

## 9. Gemini 3.8 is the reasoning brain, not the truth gate

Use Gemini 3.8 to:

- interpret observed actions and network evidence
- suggest candidate requests
- identify likely request chains
- explain parameters/identifiers
- propose canonical mappings
- decide what evidence should be tested next

But Gemini must not by itself mark an operation as proven.

Deterministic verification must execute the request and validate the returned data/structure/chain.

Use the model as the explorer's brain; use deterministic checks as the truth gate.

## 10. Completion and approval gate

An adapter must NOT reach `AWAITING_APPROVAL` merely because discovery produced a plausible configuration.

Before approval, verify:

- every required clinical resource is `PROVEN` or `PROVEN_ABSENT`
- every required multi-request chain is complete
- no required resource is `DOM_ONLY` or `UNKNOWN`
- request replay succeeds using the authenticated session
- canonical mapping succeeds
- pagination works for the acceptance case
- session/token handling works
- no required runtime path opens hospital pages or scrapes DOM
- GHIS gold audit passes for the GHIS acceptance case

Approval and activation remain separate states.

## 11. GHIS acceptance targets

For the GHIS acceptance case, the generated adapter must reproduce the behavior of the hand-built adapter for the documented operations, including equivalents of:

- worklist: `GetIPWL`
- patient search/selection: `GetSearchPatientId` / relevant patient-search operation
- labs list: `GetSearchPatientId`
- lab details: `GetPrintLabResultDetailsAuth`
- radiology list: `GetRadiologyResultPrint` workflow and its list/detail prerequisites as documented by the hand-built adapter
- medications: `GetMedicines`
- history: `Getopcard` + `Getconsultant` where offered

The exact endpoint evidence from the active adapter must be checked rather than assumed.

## 12. Final definition of "DONE"

Do not report "100%", "complete", "ready", or equivalent until the actual acceptance tests have passed.

The final proof must show:

`doctor login`
→ `authorized authenticated session`
→ `autonomous discovery`
→ `request observation`
→ `Gemini reasoning`
→ `candidate execution`
→ `deterministic verification`
→ `complete request chains`
→ `adapter compilation`
→ `adapter validation`
→ `gold audit`
→ `human approval`
→ `WardSync automatic hospital registration`
→ `second doctor login`
→ `same approved adapter reused`
→ `real clinical data retrieved through the second doctor's own session`

The test must demonstrate endpoint-driven runtime retrieval, not merely that pages can be opened.

