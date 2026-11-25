/* ResearchMD Phase 2.3 Semantic Scholar (S2AG) connector: REFUSING STUB.
 *
 * The 2.0b terms report (docs/research/research-2.0b-database-terms.md s5)
 * confirms the standard S2AG API licence is NON-COMMERCIAL only: embedding the
 * API or its data in a paid product (StewardMD) is prohibited without an
 * Expanded Commercial License executed with AI2. No such agreement exists, so
 * this connector refuses every search with a clear error instead of shipping
 * a licence breach. This is the conservative reading the plan requires for
 * UNCONFIRMED items.
 *
 * Path to unblock (terms rule 9): sign the AI2 commercial agreement, then
 * implement search/normalise behind ENABLE_SEMANTIC_SCHOLAR with the x-api-key
 * header (lowercase), a 1 req/s bucket, explicit fields= selection, and
 * "Semantic Scholar" attribution plus the Kinney et al. 2023 citation on
 * exports. Until then the flag stays false and this stub stays in place.
 */
import { ConnectorError } from "./_http.js";

const REFUSAL =
  "Semantic Scholar search is disabled: the standard S2AG API licence prohibits commercial use " +
  "inside a paid app. An Expanded Commercial License with AI2 must be signed before this " +
  "connector can be enabled (see docs/research/research-2.0b-database-terms.md section 5). " +
  "Use PubMed, Europe PMC or Crossref instead.";

export const enabled = false;

export async function search() {
  throw new ConnectorError("invalid_search", REFUSAL);
}

export async function fetchRecords() {
  throw new ConnectorError("invalid_search", REFUSAL);
}

/* normalise is kept so a future licensed implementation has the contract
 * shape pinned; it is never reached while search refuses. */
export function normalise(raw) {
  const ids = (raw && raw.externalIds) || {};
  const externalId = String(ids.DOI || ids.PubMed || (raw && raw.paperId) || "").trim();
  if (!externalId) throw new ConnectorError("invalid_search", "Semantic Scholar record has no external id");
  const year = parseInt(raw && raw.year, 10);
  return {
    source: "semantic_scholar",
    externalId,
    title: String((raw && raw.title) || ""),
    authors: (Array.isArray(raw && raw.authors) ? raw.authors : []).map((a) => String((a && a.name) || "")).filter(Boolean),
    year: Number.isFinite(year) ? year : null,
    doi: String(ids.DOI || ""),
    extra: raw,
  };
}