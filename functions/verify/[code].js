/* functions/verify/[code].js — https://stewardmd.in/verify/<code>
 * ===========================================================================
 * The exact URL encoded in the QR printed on a prescription. Everything it renders lives in
 * _rx_page.js, shared with /verify, so a scanned QR and a typed code can never show different
 * answers for the same prescription.
 *
 * This path MUST stay listed in functions/_middleware.js — the site gate rewrites anonymous page
 * views to the marketing page by default, which is where every scanned QR would otherwise land.
 */
import { renderPage } from "../_rx_page.js";

export async function onRequestGet(context) {
  return renderPage(context.env, context.request, (context.params && context.params.code) || "");
}

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405, headers: { "content-type": "text/plain", allow: "GET", "cache-control": "no-store" },
    });
  }
  return onRequestGet(context);
}
