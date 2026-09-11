# EMR Connect

## 2026-09-10 UI and connection reliability

- `admin/connect-emr.html` is the self-service administration page. `scripts/build-www.sh` copies it
  to `www/connect-emr.html`; `home.js` opens that bundled page inside the app.
- The page now uses system typography, grouped navigation, contextual connection-type help, a primary
  Save and test action, and labeled connection cards on narrow screens. Light/dark themes are supported.
- Embedded use shares the parent app's Firebase session and sign-in entry. Sign-in failures stay visible.
  The parent auth subscription is removed when the iframe unloads.
- Requests time out after 30 seconds, including transports that ignore abort. Connectivity failures and
  authentication failures have separate messages. A timed-out write is never automatically retried.
- The dashboard discards late results for a previously selected organization. Closing the in-app console
  restores keyboard focus and scrolling; Escape works from the iframe, and duplicate windows are prevented.
- Server authorization, connector configuration, clinical mappings, consent and secret handling are unchanged.
- Validation: `node --test test/connect-emr-request.test.mjs test/connect/onboard/*.test.mjs`;
  `npm run build:www` then `node test/run-connect-emr-ui.mjs`; `node test/run-connect-emr-live.mjs`.
- Live sandbox verification passed against HAPI FHIR R4 with synthetic records: encrypted credential save,
  connection probe and normalized pull (6 encounters, 97 observations). This is not verification of a
  hospital's credentials, private network, production tenant flags or native device installation.
