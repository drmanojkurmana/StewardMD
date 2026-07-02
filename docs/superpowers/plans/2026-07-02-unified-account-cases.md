# Unified Account-Linked My Cases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "My Cases" one account-linked list that includes ICU patients + Dx/clinical cases, auto-synced per Google account across devices, with a guest→account migration prompt on sign-in.

**Architecture:** Aggregate the two existing per-uid stores (ICU `/api/cases` KV via `ICU.cloudList()`; Dx Firestore `users/{uid}/cases` via `SMD_CASES`). No new backend. The My Cases renderer merges both; `SMD_CASES` switches to cloud automatically when signed in; sign-in offers to upload guest cases.

**Tech Stack:** Vanilla JS (minified `app.js`, readable `icu.js`), Firebase Auth/Firestore, Cloudflare Pages Functions (KV), Claude Preview MCP for verification.

## Global Constraints

- **Worktree:** all work happens in `/Users/diwakarkumar/Documents/StewardMD/.worktrees/unified-cases` on branch `feat/unified-account-cases`. Never touch the main checkout.
- **Formatter hook** rewrites `app.js`/`icu.js`/`index.html` on save → surgical edits only; after each edit run `git diff <file>` and confirm only intended hunks; revert any hook churn. `git add` specific files; **never `git commit -a`**. Commit **and push** immediately after each task (shared-repo lesson — don't linger with staged changes).
- **No backend/Functions changes** — both stores are already per-uid.
- **Auto-sync rule:** cloud is used when the user is a signed-in Google account (`isGoogle` true); Guest → local only. No manual Local/Cloud toggle.
- **ICU entry summary shape** (produced by `ICU.listCasesForMyCases()`): `{id, kind:"icu", label, name, age, sex, savedAt, savedAtStr, subtitle}`.
- **Migration guard flag:** `localStorage["stewardmd_cases_migrated:"+uid]`.
- **Cache-bust:** `app.js`/`icu.js` `?v=gold134` in `index.html`; `sw.js` `var CACHE="stewardmd-gold134"` (current is gold133).
- **Verification:** no unit-test harness. Serve the **worktree** for live checks: `node /Users/diwakarkumar/Documents/StewardMD/.worktrees/unified-cases/test/serve.mjs /Users/diwakarkumar/Documents/StewardMD/.worktrees/unified-cases 8905` then drive it with Claude Preview MCP (add a launch.json entry `unified-cases-verify` → port 8905 if using preview_start). Clear SW+caches before each check.

---

### Task 1: ICU read/migrate methods (`icu.js`)

**Files:** Modify `icu.js` (add three functions in the ICU module + expose them in the `ICU = {…}` public API return block near `savePatient: savePatient, loadPatient: loadPatient, listPatients: loadRoster, …`).

**Interfaces:**
- Consumes (existing, in module scope): `cloudList()` → `{enabled, cases:[entry…]}`; `loadRoster()` → local `[{id,name,dx,bed,savedAt,state}]`; `rosterKey(owner)`, `ROSTER_BASE`, `ownerNow()`, `fmtWhen(ts)`, `cloudSave(entry)`, `capTen(r)`.
- Produces: `ICU.listCasesForMyCases()` → `Promise<[{id,kind,label,name,age,sex,savedAt,savedAtStr,subtitle}]>`; `ICU.countAnonCases()` → `number`; `ICU.migrateAnonCases()` → `Promise<number>` (count uploaded).

- [ ] **Step 1: Add the three functions** just above the `var ICU = {` / return-object assignment. Use this exact code (icu.js is readable — transcribe verbatim):

```js
  // ---- My Cases integration (read-only summaries + guest migration) ----
  function _summaryFrom(e) {
    var st = e.state || {}, pt = st.pt || (st.patient) || {};
    return { id: e.id, kind: "icu",
      label: e.name || (st.patient && st.patient.name) || "ICU patient",
      name: e.name || (st.patient && st.patient.name) || "",
      age: pt.age != null ? pt.age : (st.patient && st.patient.age) || "",
      sex: pt.sex || (st.patient && st.patient.sex) || "",
      savedAt: e.savedAt || 0, savedAtStr: fmtWhen(e.savedAt || 0),
      subtitle: e.dx || (st.patient && st.patient.diagnosis) || (e.bed ? "Bed " + e.bed : "") };
  }
  function listCasesForMyCases() {
    // Cloud when signed in (cross-device); always fall back to the local roster.
    return cloudList().then(function (j) {
      if (j && j.enabled && Array.isArray(j.cases) && j.cases.length) return j.cases.map(_summaryFrom);
      return loadRoster().map(_summaryFrom);
    }).catch(function () { return loadRoster().map(_summaryFrom); });
  }
  function anonRoster() { try { var r = JSON.parse(localStorage.getItem(ROSTER_BASE + ":anon")); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
  function countAnonCases() { return anonRoster().length; }
  function migrateAnonCases() {
    var list = anonRoster(); if (!list.length) return Promise.resolve(0);
    // Re-home anon entries under the current (signed-in) owner: local roster + cloud.
    var mine = loadRoster();
    list.forEach(function (e) { if (!mine.some(function (m) { return m.id === e.id; })) mine.push(e); });
    saveRoster(capTen(mine));
    return Promise.all(list.map(function (e) { return cloudSave(e).catch(function () { return null; }); }))
      .then(function () { try { localStorage.removeItem(ROSTER_BASE + ":anon"); } catch (e) {} return list.length; });
  }
```

- [ ] **Step 2: Expose the methods.** In the `ICU = { … }` return block, add to the roster line:

```js
    savePatient: savePatient, loadPatient: loadPatient, listPatients: loadRoster, deletePatient: deletePatient, newPatient: newPatient,
    listCasesForMyCases: listCasesForMyCases, countAnonCases: countAnonCases, migrateAnonCases: migrateAnonCases,
```

- [ ] **Step 3: Verify live** (serve worktree on 8905, clear SW+caches, reload). `preview_eval`:
  `JSON.stringify({list: typeof ICU.listCasesForMyCases, count: typeof ICU.countAnonCases, mig: typeof ICU.migrateAnonCases})` → all `"function"`.
  Then save an ICU patient (open ICU, enter a name, `ICU.savePatient()`), and `ICU.listCasesForMyCases().then(r=>JSON.stringify(r))` → array containing that patient with `kind:"icu"` and a `savedAtStr`.

- [ ] **Step 4: Commit + push.**
```bash
git add icu.js && git commit -m "feat(cases): ICU read summaries + anon migration for unified My Cases" && git push
```

---

### Task 2: Auto-cloud for Dx cases (`app.js` `SMD_CASES`)

**Files:** Modify `app.js` — the `SMD_CASES` object's `save`, `getAll`, `delete`, `clear` methods (search `var SMD_CASES=function(){`). They currently gate cloud on `"firebase"===n()` where `n()` = `getPref`.

**Interfaces:**
- Consumes: `SMD_CASES` internals `n()` (getPref), `a(e)` (local key), `s(e)` (Firestore collection), the `i` param (isGoogle boolean) passed by callers.
- Produces: same method signatures; cloud path now taken whenever `isGoogle` is truthy (the `i` argument), independent of `getPref()`.

- [ ] **Step 1: Change the cloud gate.** In each of `save`/`getAll`/`delete`/`clear`, replace the condition `i&&"firebase"===n()` with just `i` (i.e. cloud when signed-in Google; local mirror still written/read as today). Do this as a surgical replace of each `i&&"firebase"===n()` occurrence → `i`. Verify with `grep -c 'i&&"firebase"===n()' app.js` → `0` after.

- [ ] **Step 2: Verify live** (worktree, SW cleared). With a simulated signed-in Google account (set `window.SMD_AUTH={currentUser:{uid:"U1",email:"a@b.com",getIdToken:function(){return Promise.resolve("t")}}}` and `stewardmd_account` google), `preview_eval` that `SMD_CASES.getAll` takes the cloud branch — assert no throw and that saving a case then `getAll` returns it. (Firestore may be unreachable in preview; the acceptance is that the code takes the `i` branch and degrades to local without error — confirm no console error and the case round-trips via local mirror.)

- [ ] **Step 3: Commit + push.**
```bash
git add app.js && git commit -m "feat(cases): Dx cases auto-sync to cloud when signed in (drop pref gate)" && git push
```

---

### Task 3: Remove Local/Cloud toggle, add status line (`app.js` + `index.html`)

**Files:** Modify `app.js` (the My Cases header + save-prompt storage UI: `#mcpLocalBtn`, `#mcpFirebaseBtn` handlers ~offset 352261; `#storageChoiceModal` logic ~351907) and `index.html` (status-line CSS).

**Interfaces:**
- Consumes: account state via `i()`/`O()` (reads `stewardmd_account`); `#mcpStorageLabel` element already exists in the My Cases header.
- Produces: a non-interactive status line; no functional toggle remains.

- [ ] **Step 1: Neutralize the toggle.** Replace the storage-chooser behavior so that `save` no longer opens `#storageChoiceModal` (it always uses the auto rule from Task 2). In the save-prompt flow, remove the branch that shows `storageChoiceModal` and just call the save directly. Leave the modal element in the DOM harmless, or hide it; do not leave a half-wired chooser.

- [ ] **Step 2: Repoint the status label.** Set `#mcpStorageLabel` (and the save-prompt storage text) from account state: signed-in Google → `"☁ Synced to " + email`; guest → `"📱 On this device — sign in to sync across your devices"`. Update it wherever the My Cases header/save prompt renders (the function that today sets `mcpStorageLabel.textContent`).

- [ ] **Step 3: CSS.** Append to `index.html` `<style>`: `.mcp-syncline{font:600 12px var(--sans);color:var(--slate-soft);padding:4px 2px}` (used by the status line if a new element is added; reuse existing label styling if simpler).

- [ ] **Step 4: Verify live** (worktree, SW cleared). Signed in (simulated) → open My Cases → header shows "☁ Synced to a@b.com", no Local/Cloud buttons act as a chooser; saving does not open a storage modal. Signed out → shows the "on this device" line. Screenshot both.

- [ ] **Step 5: Commit + push.**
```bash
git add app.js index.html && git commit -m "feat(cases): replace Local/Cloud toggle with auto-sync status line" && git push
```

---

### Task 4: Unified My Cases aggregator (`app.js` + `index.html`)

**Files:** Modify `app.js` — the My Cases list renderer `c()` (~offset 352633, currently `SMD_CASES.getAll(n,a(e),function(list){…})`), the open handler `viewCaseOutput` (~354220), and the delete handler `deleteCaseById` (~353883). Modify `index.html` — badge CSS.

**Interfaces:**
- Consumes: `SMD_CASES.getAll(userKey, isGoogle, cb)` (Dx), `ICU.listCasesForMyCases()` (Task 1), `ICU.loadPatient(id)`, `ICU.deletePatient(id)`, existing `viewCaseOutput`/`deleteCaseById` for Dx, and the ICU open path (`ICU.open()` / the dashboard opener).
- Produces: a merged, badge-tagged list; kind-dispatched open/delete.

- [ ] **Step 1: Merge sources in `c()`.** Change the renderer to fetch both: keep the `SMD_CASES.getAll(...)` call, and also `ICU.listCasesForMyCases()`. When both resolve, tag Dx entries `kind:"dx"`, concat with the ICU summaries, sort by `savedAt` desc, store on `window._smdLoadedCases`, and render. Each row shows a **badge**: `kind==="icu"` → `🫀 ICU`, else `🩺 Case`. Row markup keeps the existing card structure; add `data-kind` to each card so open/delete can dispatch.

- [ ] **Step 2: Dispatch open by kind.** In `viewCaseOutput(id)` (or the row click handler), look up the entry in `window._smdLoadedCases`; if `entry.kind==="icu"` → `ICU.loadPatient(id)` then open the ICU dashboard (`ICU.open()`) and close the My Cases sheet; else run the existing Dx viewer path unchanged.

- [ ] **Step 3: Dispatch delete by kind.** In `deleteCaseById(id)`, if the entry is `kind:"icu"` → `ICU.deletePatient(id)` then re-render `c()`; else the existing `SMD_CASES.delete(...)` path.

- [ ] **Step 4: Badge CSS.** Append to `index.html` `<style>`: `.mcp-kind{display:inline-block;font:700 10px var(--sans);border-radius:6px;padding:2px 6px;margin-right:6px;vertical-align:middle}.mcp-kind-icu{background:var(--red-bg);color:var(--red)}.mcp-kind-dx{background:var(--teal-soft);color:var(--teal)}`.

- [ ] **Step 5: Verify live** (worktree, SW cleared). Save one ICU patient and one Dx case; open My Cases → both appear, ICU with 🫀 badge and Dx with 🩺 badge, newest first; tapping the ICU row opens the ICU dashboard on that patient; tapping the Dx row opens the clinical viewer; deleting the ICU row removes it via `ICU.deletePatient`. Screenshot the merged list.

- [ ] **Step 6: Commit + push.**
```bash
git add app.js index.html && git commit -m "feat(cases): unified My Cases list (ICU + Dx) with type badges and kind dispatch" && git push
```

---

### Task 5: Guest → account migration on sign-in (`app.js`)

**Files:** Modify `app.js` — add `window.SMD_migrateGuestCasesOnSignIn(user)` in the same closure as `window.SMD_applyGoogleUser` (the accountGate IIFE), and call it from the existing `onAuthStateChanged` capture (`SMD_bootFirebase`, right after `window.SMD_applyGoogleUser(e)`).

**Interfaces:**
- Consumes: `O()`/`B()` account helpers, `SMD_CASES.save(userKey,isGoogle,entry,cb)`, `ICU.countAnonCases()`, `ICU.migrateAnonCases()`, the local Dx guest key `stewardmd_cases_guest`.
- Produces: `window.SMD_migrateGuestCasesOnSignIn(user)` — idempotent per uid.

- [ ] **Step 1: Add the migration function** in the accountGate closure (after `SMD_applyGoogleUser`):

```js
window.SMD_migrateGuestCasesOnSignIn=function(u){
  if(!u||!u.uid)return;
  var flag="stewardmd_cases_migrated:"+u.uid;
  try{if(localStorage.getItem(flag))return;}catch(e){}
  var dx=[];try{dx=JSON.parse(localStorage.getItem("stewardmd_cases_guest")||"[]");}catch(e){}
  var icuN=0;try{icuN=(window.ICU&&ICU.countAnonCases)?ICU.countAnonCases():0;}catch(e){}
  var total=(dx?dx.length:0)+icuN;
  if(total<=0){try{localStorage.setItem(flag,"1");}catch(e){}return;}
  var msg="Move your "+total+" saved case"+(total>1?"s":"")+" to your account?";
  var go=window.confirm(msg);        // replace with app modal if available
  if(go){
    try{var uk="u_"+((u.email||"").replace(/[^a-z0-9]/gi,"_"));
      dx.forEach(function(c){try{SMD_CASES.save(uk,true,c,function(){});}catch(e){}});
      localStorage.removeItem("stewardmd_cases_guest");}catch(e){}
    try{if(window.ICU&&ICU.migrateAnonCases)ICU.migrateAnonCases();}catch(e){}
  }
  try{localStorage.setItem(flag,"1");}catch(e){}
};
```

- [ ] **Step 2: Wire into onAuthStateChanged.** In `SMD_bootFirebase`, the capture added in gold133 is `onAuthStateChanged(function(e){if(e){…window.SMD_applyGoogleUser&&window.SMD_applyGoogleUser(e);…}})`. Add, right after the `SMD_applyGoogleUser(e)` call: `try{window.SMD_migrateGuestCasesOnSignIn&&window.SMD_migrateGuestCasesOnSignIn(e);}catch(x){}`.

- [ ] **Step 3: Verify live** (worktree, SW cleared). As guest, save a Dx case + an ICU patient (they land in `stewardmd_cases_guest` / ICU anon roster). Then simulate sign-in by calling `window.SMD_applyGoogleUser({uid:"U9",email:"m@x.com",displayName:"M"})` and `window.SMD_migrateGuestCasesOnSignIn({uid:"U9",email:"m@x.com"})` → confirm the prompt path runs, the guard flag `stewardmd_cases_migrated:U9` is set, and a second call is a no-op (idempotent). Confirm `stewardmd_cases_guest` is cleared after Move.

- [ ] **Step 4: Commit + push.**
```bash
git add app.js && git commit -m "feat(cases): offer to migrate guest cases to account on sign-in" && git push
```

---

### Task 6: Cache-bust + full e2e + finalize

**Files:** Modify `index.html` (`/app.js?v=`, `/icu.js?v=` → gold134), `sw.js` (`var CACHE` → gold134).

- [ ] **Step 1: Bump versions.** `index.html`: `/app.js?v=gold133`→`gold134`, `/icu.js?v=gold126`→`gold134`. `sw.js`: `var CACHE="stewardmd-gold133"`→`"stewardmd-gold134"`. Surgical scripted edits; `git diff` to confirm only these.

- [ ] **Step 2: Full e2e** (worktree on 8905, SW cleared). Signed in (simulated Google account): save an ICU patient + a Dx case → both appear in one My Cases list with correct badges, open to the right viewers, header shows "☁ Synced to <email>". Signed out: guest save works locally, header shows the device line. Guest→sign-in shows the migration prompt with the right count. Screenshot the unified list.

- [ ] **Step 3: Default-safety check.** Signed out with no cases → My Cases shows the existing empty state; no console errors; ICU dashboard's own roster still works.

- [ ] **Step 4: Commit + push.**
```bash
git add index.html sw.js && git commit -m "chore(cases): cache-bust gold134" && git push
```

- [ ] **Step 5: Ship (after final review + approval).** Do NOT self-merge. The controller runs the final whole-branch review, then `finishing-a-development-branch` opens the PR to `main` (git-connected Pages auto-deploys). Verify prod serves gold134 and the unified list.

---

## Self-Review

**Spec coverage:** Unit A unified list → Task 1 (ICU reads) + Task 4 (aggregator). Unit B auto-sync → Task 2 (gate) + Task 3 (toggle removal/status). Unit C migration → Task 1 (anon methods) + Task 5. Cross-device (per-uid stores) → inherent + Task 2. Cache-bust/ship → Task 6. All spec sections covered.

**Placeholder scan:** icu.js code is verbatim; app.js minified edits are described as anchored transformations with exact conditions/strings (`i&&"firebase"===n()`→`i`, `#mcpStorageLabel`, `_smdLoadedCases`, kind dispatch) and the migration function is verbatim — no "TBD"/"add error handling" placeholders. The one deliberate flexibility (`window.confirm` → "replace with app modal if available") is an explicit, acceptable choice, not a gap.

**Type consistency:** `ICU.listCasesForMyCases()`→`[{id,kind,label,name,age,sex,savedAt,savedAtStr,subtitle}]`, `ICU.countAnonCases()`→number, `ICU.migrateAnonCases()`→Promise<number>, `window._smdLoadedCases` entries carry `kind`, guard flag `stewardmd_cases_migrated:<uid>` — all used consistently across Tasks 1/4/5. `SMD_CASES.save(userKey,isGoogle,entry,cb)` matches its existing signature.
