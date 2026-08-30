/* functions/verify/index.js — https://stewardmd.in/verify
 * ===========================================================================
 * The address a person is given when the QR will not scan: a torn sheet, a bad camera, a photocopy.
 * With no code it shows a form; with ?code=… it shows the same answer /verify/<code> would, through
 * the same renderer, so the two can never disagree.
 *
 * The form is a plain GET form, deliberately: this page runs NO JavaScript (see _rx_page.js), and a
 * submit that depends on script is a submit that fails on the device most likely to be used here.
 */
import { renderForm, renderPage } from "../_rx_page.js";

export async function onRequestGet(context) {
  const code = new URL(context.request.url).searchParams.get("code") || "";
  if (!code.trim()) return renderForm();
  return renderPage(context.env, context.request, code);
}

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405, headers: { "content-type": "text/plain", allow: "GET", "cache-control": "no-store" },
    });
  }
  return onRequestGet(context);
}
