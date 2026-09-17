/* functions/_wardsynq/dicomweb.js - owner S5: any hospital with a DICOMweb archive plugs in.
 *
 * The connector (connectors.js, Admin > Integrations > Imaging) holds the hospital's QIDO-RS and
 * WADO-RS base URLs, how to authenticate (none, bearer token, or basic user:password; the credential
 * sealed), and how to open a study in its viewer: a URL template with {studyInstanceUid} and
 * {accession}, or an OHIF base URL, which becomes `<ohif>/viewer?StudyInstanceUIDs={studyInstanceUid}`
 * (OHIF's documented URL). Study UIDs and accession numbers are identifiers, not names: no template
 * may carry a patient name or MRN (imaging-viewer.js refuses any other placeholder).
 *
 * dicom.js still holds: pixel data is never fetched, proxied or stored here. The WADO-RS URL is
 * configuration kept for the viewer and the archive's own tools; nothing in this build retrieves from it.
 *
 * TEST CONNECTION. One QIDO-RS Search for Studies (`GET <qido>/studies?limit=1`, Accept
 * application/dicom+json, PS3.18 10.6), made server-side after the webhooks' destination rules, no
 * redirect followed, 5 s. The answer says whether the archive answered, the HTTP status and how many
 * studies came back (0 or 1). The response body is never returned or logged: a study carries a patient
 * name. NOT verified against a real PACS; tested against a mocked transport.
 */

import { checkDestination } from "./webhooks.js";
import { viewerLaunch } from "./imaging-viewer.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TIMEOUT_MS = 5000;

/** PURE. The auth header for a DICOMweb call, or null. secrets: { credential } */
function authHeaders(settings, secrets) {
  const type = str(settings && settings.authType) || "none";
  const cred = str(secrets && secrets.credential);
  if (type === "bearer" && cred) return { Authorization: `Bearer ${cred}` };
  if (type === "basic" && cred) return { Authorization: `Basic ${btoa(cred)}` };
  return null;
}

/** PURE. The viewer config imaging-viewer.js reads, from a connector's settings. */
function viewerConfigOf(settings) {
  const s = settings || {};
  if (str(s.viewerUrlTemplate)) return { urlTemplate: str(s.viewerUrlTemplate) };
  if (str(s.ohifUrl)) return { urlTemplate: `${str(s.ohifUrl).replace(/\/+$/, "")}/viewer?StudyInstanceUIDs={studyInstanceUid}` };
  return null;
}

/** PURE. A connector that could not work is refused at save, in words. present: { credential?: true } */
function validate(settings, present) {
  const type = str(settings.authType) || "none";
  if (type !== "none" && !(present && present.credential)) return type === "basic" ? "Basic authentication needs the user:password credential." : "Bearer authentication needs the token.";
  if (type === "basic" && present && typeof present.credential === "string" && !present.credential.includes(":")) return "A basic credential is written user:password.";
  const viewer = viewerConfigOf(settings);
  if (viewer) {
    const probe = viewerLaunch(viewer, { studyInstanceUid: "1.2.3", accessionNumber: "A1" });
    if (!probe.available) return `Viewer: ${probe.detail}`;
  }
  return null;
}

/** One QIDO-RS search. deps: { settings, secrets, fetchImpl?, resolveHost?, timeoutMs? } -> { ok, reason, httpStatus, count, detail } */
async function qidoTest(deps) {
  const base = str(deps.settings && deps.settings.qidoUrl).replace(/\/+$/, "");
  const dest = await checkDestination(`${base}/studies?limit=1`, deps);
  if (!dest.ok) return { ok: false, reason: dest.reason, detail: `Not contacted: ${dest.detail}.` };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs || TIMEOUT_MS);
  let res;
  try {
    res = await (deps.fetchImpl || fetch)(dest.url, { method: "GET", redirect: "manual", signal: controller.signal,
      headers: { Accept: "application/dicom+json", "User-Agent": "WardSynQ-DICOMweb/1", ...(authHeaders(deps.settings, deps.secrets) || {}) } });
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "unreachable", detail: controller.signal.aborted ? "The archive did not answer within 5 seconds." : "The archive could not be reached." };
  } finally { clearTimeout(timer); }
  const code = Number(res.status) || 0;
  if (res.type === "opaqueredirect" || (code >= 300 && code < 400)) return { ok: false, reason: "redirect-not-followed", httpStatus: code, detail: `The archive answered with a redirect (${code}), which is not followed. Use the address it redirects to.` };
  if (code === 401 || code === 403) return { ok: false, reason: "auth-refused", httpStatus: code, detail: `The archive refused the credentials (${code}).` };
  if (code === 204) return { ok: true, reason: null, httpStatus: code, count: 0, detail: "The archive answered the study search with no content (204)." };
  if (code < 200 || code >= 300) return { ok: false, reason: "http-error", httpStatus: code, detail: `The archive answered the study search with ${code}.` };
  let body;
  try { body = await res.json(); } catch { body = undefined; }
  if (!Array.isArray(body)) return { ok: false, reason: "not-dicom-json", httpStatus: code, detail: "The archive answered, but not with a DICOM JSON array of studies. Check the QIDO-RS base URL." };
  return { ok: true, reason: null, httpStatus: code, count: body.length, detail: `The archive answered the study search (${code}) with ${body.length} ${body.length === 1 ? "study" : "studies"}.` };
}

const DICOM_KIND = Object.freeze({
  label: "Imaging archive (DICOMweb)", singleton: true,
  help: "Your PACS or VNA over DICOMweb. WardSynQ searches it and links to your viewer; it never stores images.",
  providers: {
    dicomweb: {
      label: "DICOMweb (QIDO-RS, WADO-RS)",
      settings: [
        { key: "qidoUrl", label: "QIDO-RS base URL", type: "url", required: true },
        { key: "wadoUrl", label: "WADO-RS base URL", type: "url" },
        { key: "authType", label: "Authentication", type: "select", required: true, options: [["none", "None"], ["bearer", "Bearer token"], ["basic", "Basic (user:password)"]] },
        { key: "viewerUrlTemplate", label: "Viewer URL template ({studyInstanceUid}, {accession})", type: "text" },
        { key: "ohifUrl", label: "OHIF viewer base URL (used when there is no template)", type: "url" },
      ],
      secrets: [{ key: "credential", label: "Token, or user:password for basic" }],
      validate, test: qidoTest,
    },
  },
});

export { DICOM_KIND, authHeaders, viewerConfigOf, validate, qidoTest };
