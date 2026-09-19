/* wardsynq/ui/flowsheet-render.js — drawing the grid, and recording that somebody read it.
 *
 * The last named reason HAZ-FLUID-01 was partial: the correction-to-reader chain was proven end to
 * end and populated nowhere, because the flowsheet had no renderer and so a fluid balance was never
 * recorded as READ. This is that renderer.
 *
 * It holds no arithmetic. Every number it draws comes from wardsynq-flowsheet.js, and the reason is
 * the same one as the bedside view: a calculation duplicated in a view drifts from the engine and
 * the drift is invisible. What this file decides is only how honesty is DISPLAYED, which turns out
 * to be most of the work:
 *
 *   1. AN EMPTY CELL LOOKS EMPTY. Not zero, not a dash that could be a zero at a glance, not a
 *      shaded box that reads as "nil". Blank, with the count of charted hours beside the row, so a
 *      row that is half unrecorded cannot look complete.
 *   2. AN INCOMPLETE TOTAL CARRIES ITS INCOMPLETENESS IN THE SAME PLACE AS THE NUMBER. Not in a
 *      tooltip, not in a footnote, not in a colour. A consultant reads the figure; whatever
 *      qualifies it has to be in the sentence they read, or it is not a qualifier.
 *   3. OPENING A TOTAL RECORDS A READ. This is the point. It is what lets a later correction find
 *      the person who prescribed on the old figure, and it is recorded on OPENING rather than on
 *      painting, because logging every cell rendered produces a list nobody can act on.
 *   4. A BACKFILLED CELL SAYS SO. An entry written six hours after it was observed is not the same
 *      evidence as one written at the bedside, and a grid that renders them identically is a grid
 *      that quietly launders the difference.
 *
 * NOT DONE HERE: no framework and no build step, for the same reason as the bedside surface. A
 * dependency in a clinical view is a dependency that has to be offline-cached and audited.
 *
 * node --test test/wardsynq-flowsheet-render.test.mjs
 */

import { buildGrid, fluidBalance, currentEntries } from "../wardsynq-flowsheet.js";
import { READ_KIND } from "../wardsynq-readlog.js";

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const hhmm = (iso) => String(iso).slice(11, 16);

/**
 * Renders the hourly grid.
 *
 * @param {{entries: object[], from: string, to: string, codes?: string[]}} input
 * @returns {string} HTML
 */
function renderGrid({ entries, from, to, codes } = {}) {
  const grid = buildGrid(entries, { from, to, codes });

  const head = `<tr><th scope="col" class="fs-rowhead">Observation</th>${
    grid.hours.map((h) => `<th scope="col">${esc(hhmm(h))}</th>`).join("")
  }<th scope="col" class="fs-charted">Charted</th></tr>`;

  const body = grid.rows.map((row) => {
    const cells = row.cells.map((c) => {
      if (c.empty) {
        // Blank. Not a zero, not a dash: at a glance a dash and a zero are the same mark, and this
        // is the display half of the missing-hour problem the engine refuses at the other end.
        return `<td class="fs-cell fs-empty" aria-label="not charted"></td>`;
      }
      const marks = [
        c.backfilled ? `<abbr class="fs-mark" title="charted well after it was observed">late</abbr>` : "",
        c.amended ? `<abbr class="fs-mark" title="this value was corrected">amended</abbr>` : "",
      ].join("");
      return `<td class="fs-cell"><span class="fs-value">${esc(c.value)}</span>${marks}</td>`;
    }).join("");

    // The completeness of the row, beside the row, so a half-empty row cannot read as a full one.
    return `<tr><th scope="row" class="fs-rowhead">${esc(row.label)}</th>${cells}` +
      `<td class="fs-charted ${row.completeness < 100 ? "fs-incomplete" : ""}">${row.chartedHours} of ${grid.hours.length}</td></tr>`;
  }).join("");

  const backfillLine = grid.backfillReading
    ? `<p class="fs-note fs-backfill">${esc(grid.backfillReading)}</p>`
    : "";

  return `<table class="fs-grid"><caption class="fs-caption">Hourly chart, ${esc(hhmm(from))} to ${esc(hhmm(to))}</caption>` +
    `<thead>${head}</thead><tbody>${body}</tbody></table>${backfillLine}`;
}

/**
 * Renders a fluid balance.
 *
 * The whole design decision is in one line: the incompleteness is inside the same sentence as the
 * number. A qualifier in a tooltip is a qualifier nobody reads at 08:00 on a ward round.
 */
function renderBalance({ entries, from, to, requireBothDirections } = {}) {
  const b = fluidBalance(entries, { from, to, requireBothDirections });
  const sign = b.balanceMl >= 0 ? "+" : "";

  return `<figure class="fs-balance ${b.complete ? "" : "fs-balance-incomplete"}" data-complete="${b.complete}">
    <figcaption class="fs-balance-label">Fluid balance</figcaption>
    <p class="fs-balance-figure"><span class="fs-balance-value">${sign}${b.balanceMl}</span> <span class="fs-unit">mL</span></p>
    <p class="fs-balance-reading">${esc(b.reading)}</p>
    ${b.caution ? `<p class="fs-note fs-caution">${esc(b.caution)}</p>` : ""}
    ${b.missingHours.length ? `<ul class="fs-missing">${
      b.missingHours.map((m) => `<li>${esc(hhmm(m.hour))}: ${esc(m.missing.join(" and "))} not charted</li>`).join("")
    }</ul>` : ""}
  </figure>`;
}

/**
 * Draws both, into a container.
 *
 * @param {{doc: Document, container: object, entries: object[], from: string, to: string,
 *   codes?: string[], balanceId?: string}} input
 */
function render({ doc, container, entries, from, to, codes, balanceId } = {}) {
  if (!doc || !container) throw new TypeError("render needs a document and a container");
  const rows = currentEntries(entries);
  container.innerHTML =
    `<div class="fs-balance-wrap" data-value-id="${esc(balanceId || `balance-${from}-${to}`)}" data-action="open-balance">` +
      renderBalance({ entries: rows, from, to }) +
    `</div>` +
    renderGrid({ entries: rows, from, to, codes });
  return container;
}

/**
 * Wires the read recording.
 *
 * This is what closes HAZ-FLUID-01's last gap. Opening a balance records that a NAMED person was
 * shown a SPECIFIC VERSION of it, so when the underlying value is corrected the correction has
 * somebody to tell.
 *
 * @returns {Function} detach
 */
function attach({ doc, container, readLog, actor, patientId, entries, from, to, version = 1, balanceId } = {}) {
  if (!doc || !container) throw new TypeError("attach needs a document and a container");
  if (!actor || !actor.id) throw new TypeError("attach needs the actor whose reads are being recorded");

  const onClick = (event) => {
    const target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
    if (!target || target.getAttribute("data-action") !== "open-balance") return;
    if (!readLog) return;

    const b = fluidBalance(currentEntries(entries), { from, to });
    readLog.record({
      valueId: target.getAttribute("data-value-id") || balanceId || `balance-${from}-${to}`,
      version,
      value: b.balanceMl,
      by: actor.id,
      kind: READ_KIND.OPENED,
      patientId: patientId || null,
      // Kept, because "they read a balance of -320" is far less useful to somebody reviewing a
      // decision than "they read a balance of -320 that was missing three hours of output".
      context: b.complete ? "complete balance" : `incomplete: ${b.missingHours.length} hours not charted`,
    });
  };

  doc.addEventListener("click", onClick);
  return () => doc.removeEventListener("click", onClick);
}

/**
 * Records that a clinician carried a balance into a decision.
 *
 * Separate from opening it, and a stronger signal: this is the person a correction must reach
 * first, because they did not merely see the number, they prescribed on it.
 */
function recordActedOn({ readLog, actor, patientId, entries, from, to, version = 1, balanceId, decision } = {}) {
  if (!readLog) throw new TypeError("recordActedOn needs the read log");
  if (!actor || !actor.id) throw new TypeError("recordActedOn needs the clinician who acted");
  if (!decision) throw new TypeError("recording that somebody acted needs what they did, or the notice cannot say what to review");

  const b = fluidBalance(currentEntries(entries), { from, to });
  return readLog.record({
    valueId: balanceId || `balance-${from}-${to}`,
    version,
    value: b.balanceMl,
    by: actor.id,
    kind: READ_KIND.ACTED_ON,
    patientId: patientId || null,
    context: decision,
  });
}

export { render, renderGrid, renderBalance, attach, recordActedOn, esc };
