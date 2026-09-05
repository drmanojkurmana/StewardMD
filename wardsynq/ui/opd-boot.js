/* wardsynq/ui/opd-boot.js — the thing that mounts the bedside surface, without deciding who may act.
 *
 * opd-render.js has been written and tested, and opd.html has deliberately not booted it. The
 * reason is in that page's own markup and it is a good one: booting needs a store, an authenticated
 * actor and a real eMAR, and a page that constructed its own actor would be a page that decided who
 * was allowed to give a drug. This file does not overturn that. It REQUIRES those things to be
 * handed to it, and refuses, loudly and visibly, when they are not.
 *
 * SO WHAT DOES IT ADD. Two things that were genuinely missing:
 *
 *   1. A DEPLOYMENT SEAM. A site supplies `window.WARDSYNQ_OPD_DEPLOYMENT` - its own store, its own
 *      authenticated actor, its own eMAR - and the surface mounts against it. The page still names
 *      nobody. Configuration is the site's, which is where the authority actually lives.
 *   2. AN HONEST EMPTY STATE. Before this, an unconfigured page rendered a plausible-looking
 *      bedside screen with a wristband field and three buttons and no system behind it. That is the
 *      worst of the available failures: it looks like a working drug round. It now says, on the
 *      screen, that it is not connected to a patient record, and the actions stay disabled.
 *
 * DEMONSTRATION MODE, and why it is loud. With `?opd_demo=1` the surface mounts against an
 * in-memory store and an actor named as fake, so the interaction can actually be reviewed by a
 * clinician or a designer. It paints a permanent banner that cannot be dismissed and does not
 * scroll away, because a demonstration screen that is indistinguishable from a real one is a
 * hazard, not a convenience. Demo mode writes to memory, never to a real store, and is off unless
 * that parameter is present.
 *
 * WHAT IT STILL DOES NOT DO. It does not authenticate anybody, does not choose a patient, and holds
 * no clinical rule of its own. Every refusal still comes from the engine underneath.
 *
 * STATUS: IMPLEMENTED. NOT clinically validated and NOT clinically approved. Demonstration mode
 * contains invented data and is not a patient record.
 */

import { BedsideSession } from "./opd-emr.js";
import { attach } from "./opd-render.js";
import { ReadLog } from "../wardsynq-readlog.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq-store.js";
import { GovernedStore, makeActor, KIND, TIER } from "../wardsynq-actors.js";
import { ClinicalEventBus } from "../wardsynq-events.js";
import { Patient } from "../wardsynq-model.js";

/** Paints a state that is unmistakably not a working drug round. */
function renderUnconfigured(doc, reason) {
  const name = doc.getElementById("patient-name");
  const ids = doc.getElementById("patient-ids");
  if (name) name.textContent = "Not connected to a patient record";
  if (ids) ids.textContent = reason;
  for (const id of ["administer", "observations", "hold"]) {
    const b = doc.getElementById(id);
    if (b) b.disabled = true;
  }
  const input = doc.getElementById("wristband");
  if (input) { input.disabled = true; input.placeholder = "unavailable"; }
  const state = doc.getElementById("identity-state");
  if (state) {
    state.setAttribute("data-ok", "false");
    state.textContent = "This surface has no store, actor or eMAR configured, so nothing here can be acted on.";
  }
}

/** A banner that states what this screen is. Not dismissible, and it does not scroll away. */
function demoBanner(doc) {
  const bar = doc.createElement("div");
  bar.id = "opd-demo-banner";
  bar.setAttribute("role", "note");
  bar.textContent = "DEMONSTRATION — invented data, not a patient record. Nothing here is a real order.";
  bar.style.cssText = [
    "position:sticky", "top:0", "z-index:9999", "padding:8px 12px",
    "font:600 13px/1.35 system-ui,-apple-system,sans-serif", "text-align:center",
    "background:#7a1020", "color:#fff", "letter-spacing:.01em",
  ].join(";");
  doc.body.insertBefore(bar, doc.body.firstChild);
}

/**
 * Mounts the bedside surface.
 *
 * @param {{doc?: Document, deployment?: object, demo?: boolean}} opts
 *   deployment  { store, actor, emar?, journal?, readLog? } supplied BY THE SITE. Required unless
 *               demo is set. No default actor is invented here, ever.
 * @returns {{mounted: boolean, reason?: string, session?: object, detach?: Function}}
 */
function bootOpd({ doc = typeof document !== "undefined" ? document : null, deployment, demo = false } = {}) {
  if (!doc) return { mounted: false, reason: "no document" };

  let config = deployment;
  if (!config && demo) config = demoDeployment(doc);

  if (!config || !config.store || !config.actor) {
    renderUnconfigured(doc, config ? "incomplete configuration" : "no deployment configuration");
    return { mounted: false, reason: "no store or actor supplied; the site configures those, not this page" };
  }

  const session = new BedsideSession({
    store: config.store,
    actor: config.actor,
    emar: config.emar || null,
    journal: config.journal || undefined,
    online: config.online || undefined,
  });

  if (config.patient) session.open(config.patient);

  const detach = attach({
    session,
    doc,
    readLog: config.readLog || new ReadLog({}),
    rows: config.rows || [],
  });

  return { mounted: true, session, detach };
}

/**
 * The demonstration wiring. Everything here is invented, in memory, and named as such: the actor is
 * literally called a demonstration actor, so an audit trail of a demo can never be mistaken for one
 * of a drug round.
 */
function demoDeployment(doc) {
  demoBanner(doc);
  const store = new ClinicalStore({ backend: new MemoryBackend() });
  const governed = new GovernedStore({ store, bus: new ClinicalEventBus() });
  const actor = makeActor({
    id: "demo-clinician",
    name: "DEMONSTRATION actor (not a person)",
    kind: KIND.HUMAN,
    tier: TIER.EXECUTE,
  });
  const patient = Patient({
    id: "demo-patient-1",
    mrn: "DEMO-0001",
    name: "DEMONSTRATION PATIENT (invented)",
    dob: "1970-01-01",
    sex: "unknown",
    // The wristband the demo expects to be "scanned". Typing this into the field confirms identity,
    // which is what makes the interaction reviewable end to end rather than only paintable.
    wristbandBarcode: "DEMO-0001",
  });
  return { store: governed, actor, patient, rows: [] };
}

/* Auto-boot when loaded from a page, which is the only way markup can stay declarative. Demo mode
 * requires the query parameter to be present: the default remains an unconfigured, visibly inert
 * surface rather than a plausible one. */
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const demo = new URLSearchParams(window.location.search).has("opd_demo");
  const result = bootOpd({ doc: document, deployment: window.WARDSYNQ_OPD_DEPLOYMENT, demo });
  window.WARDSYNQ_OPD = result;
  if (!result.mounted) console.info("[wardsynq opd]", result.reason);
}

export { bootOpd, renderUnconfigured };
