// functions/_connect/connectors/fhir-r4/paginate.js — bounded, SAME-ORIGIN FHIR search pagination.
// next links are followed only if same-origin as base (an upstream can't redirect our authenticated,
// PHI-bearing request to an exfil host); pages/subrequests/wall-time are budget-capped; a 401 is surfaced
// distinctly so the connector can re-auth once; patientRef is URL-encoded and never logged.
import { UpstreamError } from "../../permission.js";
export class ReauthNeeded extends Error { constructor(m) { super(m); this.name = "ReauthNeeded"; } }

export async function searchPaged(deps, { base, resourceType, patientRef, count, extraParams }) {
  const { fetch, authHeader, budget, now, logger } = deps;
  const clock = () => (typeof now === "function" ? now() : Date.now());
  let baseOrigin = null; try { baseOrigin = new URL(base).origin; } catch { baseOrigin = null; }   // absolute base -> same-origin enforced; relative (conformance harness) -> no next-follow
  const maxPages = (budget && budget.maxPagesPerResource) || 50;
  const maxSub = (budget && budget.maxSubrequests) || 20;
  const deadline = clock() + ((budget && budget.deadlineMs) || 8000);
  let url = base.replace(/\/$/, "") + "/" + resourceType + "?patient=" + encodeURIComponent(patientRef) + "&_count=" + (count || 50) + (extraParams ? "&" + extraParams : "");
  const out = [];
  let pages = 0, subreq = 0;
  while (url) {
    if (pages >= maxPages || subreq >= maxSub || clock() > deadline) break;   // over-budget => partial, not a crash
    // redirect:"manual" — never auto-follow a 3xx from the (trusted) FHIR host to another origin with our
    // authenticated, PHI-bearing request; the same-origin `next` check below is the only sanctioned hop.
    let res; try { res = await fetch(url, { headers: authHeader, redirect: "manual" }); } catch { throw new UpstreamError("FHIR search failed"); }
    subreq++;
    if (res.status === 401) throw new ReauthNeeded(resourceType);              // re-auth signal (Task 6)
    if (!res.ok) throw new UpstreamError("FHIR search HTTP " + res.status);
    let b; try { b = await res.json(); } catch { throw new UpstreamError("bad FHIR bundle"); }
    (b.entry || []).forEach((e) => e.resource && out.push(e.resource));
    pages++;
    const next = (b.link || []).find((l) => l.relation === "next");
    if (next && next.url) {
      try { url = (baseOrigin && new URL(next.url).origin === baseOrigin) ? next.url : (logger && logger.warn && logger.warn("cross-origin next link stopped for " + resourceType), null); }
      catch { url = null; }
    } else url = null;
  }
  return out;
}
