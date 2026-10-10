
## Complete your profile saves through the server (2026-10-10)
Owner screenshot (iPhone, full signal): "Couldn't reach your account". `profile-setup.js` wrote the profile with the
Firebase web SDK, which does not run in the iOS WebView (same cause as the my-profile read, 2026-09-27). Save now falls
back to `POST /api/auth/save-profile` (verified token, uid from the token only; writes just role, name, phone, state,
city, hospital, degree, speciality, profileComplete, updatedAt; never regNo, smdId or phone-verification fields; refuses
an incomplete form). It is used when no SDK ref exists AND when the SDK write fails. "Couldn't reach your account" now
means the server was unreachable too. Tests: `test/auth-save-profile.test.mjs`, `test/run-profile-setup-ui.mjs` (case 4).
