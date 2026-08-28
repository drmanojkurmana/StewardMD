# GHIS Initial Assessment — captured live requests (2026-08-26)

> **PHI NOTE.** Every MR / IPMR identifier below is a SYNTHETIC stand-in (MR00000001,
> IPMR000000001, …). The real values came from live GITAM patients and were redacted; this file is
> git-tracked and public to anyone with repo access, and CLAUDE.md forbids committing PHI. What
> matters here is the SHAPE of the requests, never the person — so the stand-ins cost nothing.
> Keep it that way: if you capture a fresh request, redact the identifiers before committing it.

Captured from the real GHIS UI in Chrome by the owner. These are the ground truth for the
assessment read/write path; anything in our code that contradicts them is wrong.

## 1. READ the form

```
GET /Doctor/Home/GetInitialAssessmentnew/?id=MR00000002
x-requested-with: XMLHttpRequest
referer: https://ghis.gitam.edu/Doctor/home
(session cookies only)
```

- Keyed by the **MR number**, not the visit/episode. `saveAssessment` already tries the MR first.
- Response ~357 kB = a fully rendered form.
- No `Searchnew` accompanied it: the active visit was already set in the server-side session by
  clicking the patient. **The session cookie IS the patient/visit context.**

## 2. WRITE the form

```
POST /Doctor/Home/CreateinitialAssessmentnew
content-type: application/x-www-form-urlencoded; charset=UTF-8
x-requested-with: XMLHttpRequest
origin + referer: https://ghis.gitam.edu
```

Body (abridged — the whole ~113-field model is posted at once):

```
__RequestVerificationToken=CfDJ8...
assessment.Initial_Assessment_doc_id=0
assessment.episode_id=
assessment.patient_id=
assessment.Chief_complaints_duration=Oliguria \r\nAbdominal DIstension\r\n
assessment.History_present_illness=acute on CLD
assessment.History_past_illness=Chronic Alcoholic
... every other field, blanks included ...
assessment.management_plan=
X-Requested-With=XMLHttpRequest
```

Result: **HTTP 200** (~0.1 kB response).

### THE FINDING THAT MATTERS

The real UI creates an assessment with:

| field | real UI value |
|---|---|
| `assessment.Initial_Assessment_doc_id` | `0` |
| `assessment.episode_id` | **empty** |
| `assessment.patient_id` | **empty** |

GHIS resolves the target patient and visit **entirely from the session's active visit**, not from
the posted ids.

This contradicts a comment in `functions/api/ghis/[[path]].js` which asserted that "posting the
full model with patient_id + episode_id set is exactly how GHIS's own form creates the first
assessment for a visit". It is not. The capture shows both posted empty.

### RESOLVED 2026-08-26: our payload now matches the capture

Owner's call after the activation capture (section 3) confirmed the rest of the chain. We now send
`assessment.patient_id` and `assessment.episode_id` exactly as the form gave them — empty for a new
assessment — instead of filling them in. An UPDATE is unaffected: the form supplies the real ids and
they pass through untouched.

Because the ids no longer act as a backstop, `canCreate` now additionally requires a CONFIRMED
activation (a `Searchnew` that actually returned 2xx), not merely an episode we could name. That
requirement is load-bearing: with empty ids, the session's active visit is the only thing deciding
which chart a create lands in, so an activation that quietly did not take would mean writing into
whichever visit happened to be active from a previous request.

Original notes, kept for the reasoning:

- Our code fills `assessment.patient_id` / `assessment.episode_id` when the form omits them, which
  is precisely the case here. So every create we send deviates from the verified payload.
- It may be harmless (GHIS ignores them and uses the session) or it may be the reason a write
  misfiles or is rejected. We have no evidence either way: the one live attempt never reached GHIS,
  it was stopped by our own `doc_id 0` guard.
- Because the session is the context, **activation is the whole game**. Getting `Searchnew` to
  select the right visit matters more than anything in the body.

### `assessment.hernial_orifices=Y`

Note the real payload posts `Y` for this while every other yes/no defaults to `N`. Not investigated;
recorded so it is not mistaken for our own bug later.

## 3. ACTIVATION — how an ADMITTED patient is selected  ← the one that closed this

Captured 2026-08-26 by clicking a patient in the IP worklist:

```
POST /Doctor/Home/Searchnew
content-type: application/x-www-form-urlencoded; charset=UTF-8
x-requested-with: XMLHttpRequest
origin + referer: https://ghis.gitam.edu

__RequestVerificationToken=CfDJ8...&recordNo=MR00000003-IPMR000000003
```

Then, immediately after:

```
GET /Doctor/Home/GetInitialAssessmentnew/?id=MR00000003
```

**An in-patient activates with exactly the same `<MR>-<visit>` recordNo as an out-patient.** The
only difference is the visit itself: `IPMR000000003`, the "Visit ID" column of the IP worklist,
where an out-patient carries an OP/episode number.

This confirms the shape our code already builds (`mr + '-' + epi`). Nothing about the activation
request needed changing. What was missing was only ever the VALUE: `saveAssessment` and
`resolveEpisode` looked the episode up in the OPD list alone, so for an admitted patient there was
no `epi` to activate with and the whole chain collapsed into "form doc_id is 0". Fixed by also
searching the ward roster (GetIPWL).

The full working sequence, all three steps now verified against the live server:

1. `POST /Doctor/Home/Searchnew` with `recordNo=<MR>-<visit>` — sets the active visit in the
   server-side session, and returns it as a Set-Cookie that MUST be carried into step 2.
2. `GET /Doctor/Home/GetInitialAssessmentnew/?id=<MR>` — the form for whatever visit is active.
3. `POST /Doctor/Home/CreateinitialAssessmentnew` — the whole model, ids empty, resolved from the
   session.

## 4. Session check

```
GET /Doctor/Home/CheckSession
accept: application/json, text/javascript, */*; q=0.01
```

Used by the UI to keep the session alive (the header shows a visible "Session timeout" countdown).

---

## 5. MEASURED against the live server — 2026-08-26, an ADMITTED patient (ids redacted)

Run directly against GHIS with the owner's own session, read-only. The first attempt was **invalid
and produced a confident wrong answer**, which is worth recording as loudly as the result:

> `curl -b '<cookie string>'` passes a raw header. Those cookies never enter curl's cookie engine,
> so a companion `-c jar` writes a jar WITHOUT the session, and every later `-b jar` call runs
> signed-out. `CheckSession` answered 200 with a null-filled body and `Searchnew` answered 200 with
> nothing behind it. Both looked like clean negative results. They were an unauthenticated session.
> Build the jar properly (Netscape format) before believing anything a probe tells you.

With a correctly built cookie jar, for `MR00000001-IPMR000000001`:

| step | result |
|---|---|
| `CheckSession` before | `patient_id: null` |
| `POST Searchnew  recordNo=<MR>-<IPMR>` | **200, 82,509 bytes, MR echoed 13x** |
| `CheckSession` after | `patient_id: null` |
| `GET GetInitialAssessmentnew/?id=<MR>` | **200, 174,948 bytes, 208 assessment fields** |
| - `assessment.Initial_Assessment_doc_id` | **`0`** |
| - references to the patient MR inside the form | **0** |

### What this establishes

1. **The `IPMR...` activation works.** `Searchnew` returns that patient's own page and echoes their
   MR 13 times. An admitted patient activates exactly like an out-patient, confirming the
   ward-roster fix resolves the right value.
2. **`CheckSession` does NOT report the active patient.** It returns a patient-shaped JSON skeleton,
   null-filled before AND after a successful activation. It was briefly believed to be the
   activation-confirmation endpoint. It is not. Do not build a guard on it.
3. **The form carries no patient reference** - no `patient_id`, and the MR appears nowhere in
   174,948 bytes. It is a blank template bound to the session, which is why the write posts both ids
   EMPTY (section 2) and why the FORM cannot verify who is active either.
4. **`doc_id 0` here is correct.** This patient had no assessment yet, so this is a genuine create -
   exactly the case the pre-2026-08-26 code refused outright.

### The activation signal, settled

HTTP status is worthless: an unauthenticated session and a working one **both answered 200**. The
only thing separating them was the body naming the patient. So `epiActivated` now requires the
`Searchnew` response to reference the MR being activated, not merely a 2xx. The body is never
logged - only whether it echoed the MR - and the attempt trail records `:mr-ok` / `:mr-absent`.

### NOT done

No write has been attempted against a live chart. Sections 1-5 are all reads.
