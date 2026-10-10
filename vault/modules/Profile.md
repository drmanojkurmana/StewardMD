
## Complete your profile saves through the server (2026-10-10)
Owner screenshot (iPhone, full signal): "Couldn't reach your account". `profile-setup.js` wrote the profile with the
Firebase web SDK, which does not run in the iOS WebView (same cause as the my-profile read, 2026-09-27). Save now falls
back to `POST /api/auth/save-profile` (verified token, uid from the token only; writes just role, name, phone, state,
city, hospital, degree, speciality, profileComplete, updatedAt; never regNo, smdId or phone-verification fields; refuses
an incomplete form). It is used when no SDK ref exists AND when the SDK write fails. "Couldn't reach your account" now
means the server was unreachable too. Tests: `test/auth-save-profile.test.mjs`, `test/run-profile-setup-ui.mjs` (case 4).

## Editing the profile from the Profile page saves through the server too (2026-10-10)
Owner screenshot: saving the college from Profile gave "Couldn't save, check your connection" with full signal. `home.js`
`save()` (hospital, degree, speciality, city, phone, role, reg. number rows) used only the Firebase SDK, which is missing in
the iPhone app. It now gives the SDK 6 s, and if it is missing, rejects or hangs, POSTs `{patch:true, ...fields}` to
`/api/auth/save-profile` (verified token, uid from the token only; nothing required but whatever is sent must be valid;
a reg. number is stored as `verified:false, regNoPendingCert:true`; never smdId or phone-verification fields; does not
set `profileComplete`). The first-run form's SDK write also gets an 8 s bound (a pending write used to leave "Saving…" forever).
Tests: `test/auth-save-profile.test.mjs`, `test/run-profile-details-ui.mjs` case 3d (8 older checks in that file already fail on main).
