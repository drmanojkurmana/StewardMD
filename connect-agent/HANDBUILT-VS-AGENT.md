# The hand-built GHIS adapter vs the Connect Agent

**Written 2026-09-18.** The reference is `functions/api/ghis/[[path]].js` (1,100+ lines, hand-written
by the owner) against `connect-agent/phone/*` (5,830 lines, the agent). Every claim below was read out
of those two files, not remembered.

---

## 1. The target

> *"Make the agent autonomously build the EMR adapter of any hospital in 5 minutes, 100% similar to my
> handmade one."* — owner

Broken into what that actually demands:

1. **Any hospital.** The doctor types their EMR address. Nobody has seen it before.
2. **3 to 6 taps.** A tired doctor, no technical words, no CSS selectors, no JSON.
3. **100% similar to the hand-built one.** Not just the same *data* — the same *kind of thing*: runs on
   the server, the doctor signs in with their own hospital id and password, a cookie jar lives about
   fifteen minutes, the same routes answer in the same shapes.
4. **Read-only.** It can never order, prescribe, discharge, sign or bill.
5. **Learn once, replay forever.** The second doctor at that hospital rediscovers nothing.

### Where we actually are

| | State |
|---|---|
| Data parity on the approved adapter | **Proven.** Medicines 158/158, 19/19, 325/325; ward list, labs, lab report, scans, scan report all "same" |
| Agent finds the calls by itself | **Mostly.** 6 of 9 calls, worklist found with no prompting at all |
| An agent-built adapter passing the approval gate | **Never.** Blocked on one resource: `labs-detail` |
| Runs on the server like the hand-built one | **No.** Phone only. Transport + session now written (2026-09-18), not yet wired |
| A second hospital | **Never tried.** This is the whole product claim and it is untested |

---

## 2. How the owner built the GHIS adapter

The method is written into the file as dated comments. It was **live-capture archaeology**:

1. **Open the real EMR, watch the network.** Every call was taken off a live GHIS session and the date
   recorded. `// Verified against a live GHIS session (2026-07): the Doctor-module "Medications" view
   (left-menu loadView('4')) fires GET /Doctor/Home/GetMedicines/?id={MR}` — including which id it
   wants (`the same id the Lab endpoints use — NOT the IPMR episode id`) and the exact column order of
   the 12 `<td>` cells that come back.
2. **Write the request down by hand**, byte for byte: method, path, form fields, headers.
3. **Discover the traps by being burned in production.** The three that shaped the file:
   - **The SSO handoff.** Hitting `/Doctor/Home` directly gives a session that renders page shells and
     returns **empty worklists**. Only following the `/apps` Doctor tile through
     `route?id=` → `/Login/?id=` → `/Doctor/Home` yields a data-capable session. The comment calls this
     *"THE fix for empty worklists"*.
   - **Numeric HTML entities.** GHIS returns newlines as `&#xA;`. A value read back never string-matched
     what had just been written, so a dedupe guard never fired and **a surgical note was appended twice
     to a live chart** (2026-08-26, two copies, 1,372 chars).
   - **`HTTP 200 PROVES NOTHING.`** Measured against the live server: a 200 can still mean the write did
     not land.
4. **Keep the evidence.** `docs/ghis/captured-initial-assessment-write.md` is a captured real request,
   and a comment marks where an earlier assumption was corrected by it.
5. **Fix forward.** Field names carry the date they were verified (`2026-08-07`, `2026-08-26`).

**The essential property: a human looked at the traffic and decided what each call meant.** Discovery
happened once, in a person's head, and the answer was typed in. Nothing at runtime can fail to "find"
anything, because at runtime there is nothing left to find.

---

## 3. How the agent does it

1. **The doctor types the hospital address** and taps through consent.
2. **A browser opens inside the app.** The doctor signs in themselves. *The agent never sees the
   password, and there is nowhere it could put one.*
3. **A page-realm observer records every request** — URL, method, form field names, headers,
   `X-Requested-With`, response kind — into a never-drained replay buffer (`prove.mjs`).
4. **It crawls one patient record read-only** (`deep-crawl.mjs`, 1,746 lines): every menu, tab,
   accordion, disclosure and frame, refusing anything matching delete / order / prescribe / discharge /
   sign / save.
5. **It proves each screen** (`prove.mjs`): candidates are the requests fired since the mark for that
   screen; each is re-issued from inside the page; **the first whose answer carries ≥50% (and ≥3) of the
   values visible on screen is the data call.** Everything else is discarded. An unproven view keeps
   **no** endpoints.
6. **It works out where each field comes from** — the patient id from the worklist row, the CSRF token
   off the page, a detail id from the parent list row (`{from:'labs', field:'ServiceRenderId'}`).
7. **It asks the doctor only for what it could not find** — plain words, tap the screen so it turns
   green, tap Done.
8. **It checks its own work** (`verify.mjs`): reads the ward list through the adapter, picks real
   patients, replays every view for them, counts rows, and withdraws proof from anything that answers
   nothing.
9. **It files a candidate.** Nothing is live until the owner approves in the admin console.
10. **Ward Sync replays the approved views** and `ghis-shim.mjs` answers in the hand-built proxy's own
    JSON shapes, so the drawers and medication review work unchanged.

**The essential property: the machine has to earn every call by matching what was on the screen.** That
is why the calls it does find are right — and why a call it cannot reach is simply absent.

---

## 4. Every difference

### 4.1 Where it runs
| Yours | Agent |
|---|---|
| Cloudflare Pages Function | Inside the phone app only |
| Works with the phone in your pocket | Only while the app is open |
| Lab Watch can poll at 3am | No background anything |

### 4.2 Signing in
| Yours | Agent |
|---|---|
| Server GETs the SSO page, scrapes `__RequestVerificationToken` | Doctor signs in on the hospital's own page |
| Server POSTs `/Index` with `USER_ID`+`PASSWORD`, checks JSON `param1 == 200` | Agent never handles the password |
| GETs `/apps`, parses the Doctor tile's `route?id=`, follows the redirect chain across two hosts by hand | The browser does this naturally |
| Requires `AspNetCore.Session` present, else `session_not_established` | No such check |
| Scrapes CSRF off `/Doctor/Home/Nurseipwlnew/?id=` | Reads the token off whatever page it is on |
| Parses the doctor's display name out of the home page | Does not |

### 4.3 Session
| Yours | Agent |
|---|---|
| Cookie jar in KV under `sess:<token>` | Nothing stored |
| 30 min KV TTL, sliding, throttled to one write per 5 min | Dies with the app |
| 15-minute refresh window; a `/refresh` route | No refresh |
| Stored **encrypted** credentials for Lab Watch opt-ins only | Never, for anyone |
| 302 on a read ⇒ `unauth`, doctor signs in again | Same rule, in the browser |

### 4.4 Routes
**Yours — 23:** `login, staff-login, logout, refresh, status, patients, opd-patients, profile,
demographics, history, lab, lab-detail, inv-search, inv-order, radiology, radiology-report,
medications, drug-search, prescribe, assessment, assessment-save, assessment-authorize, surgx-note`

**Agent — 9:** `patients, profile, lab, lab-detail, radiology, radiology-report, medications, history,
status`

**Missing from the agent — 14:** `login, staff-login, logout, refresh, opd-patients, demographics,
inv-search, inv-order, drug-search, prescribe, assessment, assessment-save, assessment-authorize,
surgx-note`

### 4.5 The calls themselves
| Resource | Yours | Agent |
|---|---|---|
| Patient list | `GET /Doctor/Home/GetIPWL?...Type=IPWorkList` + CSRF | **same** — found unprompted |
| Medicines | `GET /Doctor/Home/GetMedicines/?id=<MR>` | **same** |
| Lab tests | `POST /Lab/Home/GetSearchPatientId` (`patient_id, DeptID, FDate, EDate`) | **same** |
| **Lab report** | `POST /Lab/Home/GetPrintLabResultDetailsAuth` (`Render_ID`, `Episode_Id`, `Result_Type=a`) — **the two ids read straight out of the lab-list reply** | **tries to click the report open. Never captured live.** |
| Scans | `GET /Radio/Home?recordNo=<MR>`, rows filtered on `Radiologyprint` | **same** |
| Scan report | `GetRadiologyResultPrint` | **same** |
| Patient details | `Searchnew` — **used in 17 places** | picks `GetInitialAssessmentnew` — a different screen |
| Visit history | `Getopcard` | returns 1 stray row |
| OPD list | `opd-patients` (captured 2026-08-07) | absent |

**This table holds the single most important line in the document.** You never open a lab report. You
take `ServiceRenderId` and `episode_id` out of the lab list answer and POST them back. The agent tries
to *click* the report open, and on GHIS the only way in is a print icon. That click is where it dies.
The agent already records exactly your shape (`Render_ID from labs.ServiceRenderId`) in its replica
test — it just refuses to get there unless a click succeeds first.

**The fix is not "make clicking work". It is: when a proven list's reply contains row ids, try the
detail call directly, the way the hand-built one does.**

### 4.6 Parsing
| Yours | Agent |
|---|---|
| `parseGhis` — double `JSON.parse` for GHIS's string-wrapped JSON | Generic JSON/table reader |
| `decodeEntities` for `&#xA;`, `&#xB7;`, named entities | No entity handling |
| `htmlToText` collapsing `<br>`, `</p>`, `</tr>` | Generic text cleaner |
| Hand-picked keys: `parameter_long_desc`, `ValueType`, `AntiOrgansData`, `DynamicLoadOrganstList` | Learns which response key feeds which on-screen column |
| Regex row scraping tuned to GHIS markup | Structure capture with unstable-id refusal (`/\d{3,}/` never a selector) |

### 4.7 Writing
| Yours | Agent |
|---|---|
| Has write routes, inert behind `QUEUE_EMR_WRITE=1` + client flag + explicit confirm | **501 for every write, permanently** |
| Captured write payloads from real requests | Refuses to click anything that could mutate |

### 4.8 Safety and privacy
| Yours | Agent |
|---|---|
| Password never stored (except encrypted Lab Watch opt-ins) | Password never seen at all |
| — | Denylist blocks delete/order/prescribe/discharge/sign during the crawl |
| — | Patient identifiers scrubbed before anything leaves the phone; the model sees column names, row counts and response kind only |
| — | Nothing goes live without owner approval; rollback ledger |
| — | Refuses to keep any call it could not prove |

### 4.9 Reuse and reach
| Yours | Agent |
|---|---|
| GHIS only, forever | Any hospital — the entire point, untested outside GHIS |
| Every doctor logs in with their own id | Same, and the second doctor rediscovers nothing |
| Changes when you edit the file | Self-repairs on drift, files a child candidate, three-draft rule |

---

## 5. What closes the gap

1. **Derive the detail call from the parent row** instead of requiring a click. This is your method, the
   agent already has the machinery, and the replica already proves the exact shape. *No phone needed.*
2. **Server-side runtime** so the adapter is the same kind of thing as yours. Started 2026-09-18:
   `functions/_connect/agent/http.js` (cookie jar, headers, manual redirects, 302 ⇒ unauth) and
   `functions/_connect/agent/session.js` (recipe login, KV jar, 15-minute sliding). 8/8 tests pass
   against a GHIS-shaped fake hospital. **Not yet wired to routes.**
3. **Record the sign-in as a recipe** during onboarding — your steps 1 to 6 as data rather than code —
   so the server can open a session for a hospital nobody coded.
4. **Fix `patient` and `history`** to the calls you actually use (`Searchnew`, `Getopcard`).
5. **The remaining 14 routes**, most of which are OPD and write paths.
6. **A second hospital.** Until this happens "any EMR" is a claim, not a fact.

---

## 6. The honest summary

The agent finds most of the right calls by itself, proves them against what is on the screen, checks
its work on real patients, and produces data that matched the hand-built adapter row for row. That part
is real.

It is not yet the same kind of thing as the hand-built adapter: it runs on the phone rather than the
server, serves 9 routes rather than 23, gets two views wrong, and has never once captured the lab
report without help — which is the one thing standing between it and an approved, agent-built adapter.
