/* wardsynq/ui/opd-render.js — the view that calls the tested logic.
 *
 * opd-emr.js has held the bedside logic, fully tested, with nothing calling it. This is the part
 * that draws it. It is deliberately thin: it reads state, writes DOM, and forwards events, and it
 * contains no clinical rule whatsoever. A rule duplicated in a view drifts from the engine and the
 * drift is invisible, which is why every decision here is a question asked of another module.
 *
 *   1. IT RENDERS STATE, IT DOES NOT HOLD IT. `render(session)` is a pure function of the session's
 *      own `state()`, so the screen cannot disagree with the system about which patient is open.
 *   2. IT RECORDS READS. Opening a value calls the read log, which is what closes HAZ-FLUID-01's
 *      last gap: a correction can now find the person who saw the wrong figure. Only DECISIVE
 *      interactions are logged, never everything painted.
 *   3. IT NEVER DISABLES ITS WAY TO SAFETY. Buttons reflect state, and the underlying action refuses
 *      independently. The disabled attribute is a courtesy to the person, not a control.
 *   4. A REFUSAL IS RENDERED WHOLE. Every reason, not the first, and it stays until acknowledged.
 *
 * NOT DONE HERE: no framework, no virtual DOM, no build step. The surface is small enough that
 * innerHTML on three regions is legible, and a dependency at a bedside is a dependency that has to
 * be offline-cached and audited.
 *
 * node --test test/wardsynq-opd-render.test.mjs   (headless, via a minimal DOM stub)
 */

import { MODE, toRow } from "./opd-emr.js";
import { READ_KIND } from "../wardsynq-readlog.js";

/** Escapes text for interpolation. A patient name is untrusted input like any other. */
function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Draws the whole surface from the session's state.
 *
 * @param {{session: object, doc: Document, readLog?: object, rows?: object[]}} deps
 */
function render({ session, doc, readLog, rows = [] } = {}) {
  if (!session || !doc) throw new TypeError("render needs a session and a document");
  const state = session.state();

  const el = (id) => doc.getElementById(id);
  const header = el("header");
  const name = el("patient-name");
  const ids = el("patient-ids");
  const band = el("patient-band");
  const offline = el("offline");
  const held = el("held-count");
  const refusals = el("refusals");
  const due = el("due");

  /* --- the patient, and whether we are sure it is them ------------------------------------- */
  if (header) header.setAttribute("data-identity", state.identityConfirmed ? "confirmed" : "unconfirmed");
  if (name) name.textContent = state.patient ? state.patient.name : "No patient open";
  // The identifiers are set as text, never as markup, and they are never truncated: a shortened
  // name is inconvenient and a shortened MRN is a wrong-patient error.
  if (ids) ids.textContent = state.patient ? `${state.patient.mrn}` : "";
  if (band) band.textContent = state.identityConfirmed ? "Identity confirmed" : "";

  /* --- offline, stated plainly rather than as an error -------------------------------------- */
  if (offline) offline.hidden = state.online;
  if (held) held.textContent = String(state.heldOnDevice);

  /* --- refusals, in full, until acknowledged ------------------------------------------------ */
  if (refusals) {
    refusals.innerHTML = state.refusals.map((r, i) => `
      <div class="opd-refusal" data-refusal="${i}">
        <h2>${esc(r.code === "IDENTITY_NOT_CONFIRMED" ? "Confirm the patient first" : "Blocked")}</h2>
        <p>${esc(r.message)}</p>
        ${(r.reasons || []).length ? `<ul>${r.reasons.map((x) => `<li>${esc(x.message || x.code)}</li>`).join("")}</ul>` : ""}
        <button type="button" class="opd-btn" data-action="ack-refusal" data-index="${i}">I have read this</button>
      </div>`).join("");
  }

  /* --- the rows ---------------------------------------------------------------------------- */
  if (due) {
    due.innerHTML = rows.map((raw, i) => {
      const row = toRow(raw);
      return `
      <li>
        <button type="button" class="opd-row" data-signal="${esc(row.signal || "")}" data-row="${i}"
                data-action="open-row" ${row.signal ? `aria-label="${esc(row.signalWord)}: ${esc(row.label)}"` : ""}>
          ${row.signalWord ? `<span class="signal-word">${esc(row.signalWord)}</span> ` : ""}
          <span class="label">${esc(row.label)}</span>
          ${row.value !== null ? `<span class="value">${esc(row.value)}</span>` : ""}
          ${row.unit ? `<span class="unit">${esc(row.unit)}</span>` : ""}
          ${row.detail ? `<span class="detail">${esc(row.detail)}</span>` : ""}
        </button>
      </li>`;
    }).join("");
  }

  /* --- actions reflect state; the ACTIONS refuse independently ------------------------------ */
  for (const id of ["administer", "observations", "hold"]) {
    const b = el(id);
    if (b) b.disabled = !state.actionsEnabled;
  }

  return state;
}

/**
 * Wires events once. Returns a detach function, because a surface that cannot be torn down leaks
 * handlers across patient switches.
 */
function attach({ session, doc, readLog, rows = [], onRender } = {}) {
  if (!session || !doc) throw new TypeError("attach needs a session and a document");

  const redraw = () => {
    const state = render({ session, doc, readLog, rows });
    if (onRender) onRender(state);
    return state;
  };

  const onClick = (event) => {
    const target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
    if (!target) return;
    const action = target.getAttribute("data-action");

    if (action === "ack-refusal") {
      session.acknowledgeRefusal(Number(target.getAttribute("data-index")));
      redraw();
      return;
    }

    if (action === "open-row") {
      const row = rows[Number(target.getAttribute("data-row"))];
      // The read log, populated. This is what makes a later correction able to find the person who
      // saw the wrong figure, and it is recorded on OPENING a value rather than on painting one.
      if (readLog && row && row.valueId) {
        readLog.record({
          valueId: row.valueId,
          version: row.version === undefined ? 1 : row.version,
          value: row.value,
          by: session.actor.id,
          kind: READ_KIND.OPENED,
          patientId: session.patient ? session.patient.id : null,
        });
      }
    }
  };

  const onSubmitScan = (event) => {
    const input = doc.getElementById("wristband");
    if (!input) return;
    if (event && event.key && event.key !== "Enter") return;
    const result = session.confirmIdentity(input.value);
    const stateEl = doc.getElementById("identity-state");
    if (stateEl) {
      stateEl.setAttribute("data-ok", String(result.ok));
      stateEl.textContent = result.ok ? "Identity confirmed." : result.reason;
    }
    if (result.ok) input.value = "";
    redraw();
  };

  doc.addEventListener("click", onClick);
  const input = doc.getElementById("wristband");
  if (input) input.addEventListener("keydown", onSubmitScan);

  redraw();

  return () => {
    doc.removeEventListener("click", onClick);
    if (input) input.removeEventListener("keydown", onSubmitScan);
  };
}

export { render, attach, esc };
