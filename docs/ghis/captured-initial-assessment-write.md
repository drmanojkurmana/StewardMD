# GHIS Initial Assessment — captured live requests (2026-08-26)

Captured from the real GHIS UI in Chrome by the owner. These are the ground truth for the
assessment read/write path; anything in our code that contradicts them is wrong.

## 1. READ the form

```
GET /Doctor/Home/GetInitialAssessmentnew/?id=MR26159235
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

Consequences to weigh before changing the write payload (NOT changed on this evidence alone — it
writes into live patient charts):

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

## 3. Session check

```
GET /Doctor/Home/CheckSession
accept: application/json, text/javascript, */*; q=0.01
```

Used by the UI to keep the session alive (the header shows a visible "Session timeout" countdown).
