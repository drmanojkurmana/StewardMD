/* functions/_wardsynq/doc-series.js - consecutive document numbers per series and financial year.
 *
 * Moved out of invoice.js (2026-10-04) so stock.js can number a supplier debit note (SDN, supplier-debit-note.js)
 * without loading the whole invoice path. invoice.js re-exports it unchanged.
 */
import { VersionConflictError } from "./repository.js";
import { financialYearOf } from "../_region_in.js";

const SERIES_TYPE = "_wardsynq_doc_series";

/** The next number in a document series ("INV", "CRN", "DBN", "BOS", "SDN") for the financial year of `at`: INV/2627/000001.
 *  Optimistic: two cashiers racing for the same number cannot both land (append refuses a version that exists). */
async function nextDocumentNumber(repo, tenantId, typ, at, actorId) {
  const fy = financialYearOf(at);
  if (!fy) throw new Error("no financial year for that time");
  const id = `${typ.toLowerCase()}-${fy}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await repo.latest(tenantId, SERIES_TYPE, id);
    const n = (cur ? Number(cur.last) || 0 : 0) + 1;
    const now = new Date().toISOString();
    const rec = { resourceType: SERIES_TYPE, id, version: cur ? cur.version + 1 : 1, series: typ, financialYear: fy, last: n, writtenBy: { id: actorId, kind: "human", at: now } };
    try {
      await repo.append(tenantId, [rec], { audit: { ts: now, actor: actorId, connectorId: "wardsynq-invoices", action: "document.number.issue", outcome: "ok", scope: { series: id, number: n } } });
      return `${typ}/${fy}/${String(n).padStart(6, "0")}`;
    } catch (e) { if (!(e instanceof VersionConflictError)) throw e; }
  }
  throw new Error("the document number series is busy");
}

export { SERIES_TYPE, nextDocumentNumber };
