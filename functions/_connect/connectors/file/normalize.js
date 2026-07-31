// functions/_connect/connectors/file/normalize.js — CSV lab -> SCCM via ctx.config.config.columnMap.
// Group by patientId (one Patient) + orderId (a DiagnosticReport grouping Observations). Warn-don't-drop.
import { coding, codeable, quantity } from "../../canonical/coding.js";
import { bundle, patient, observation, diagnosticReport } from "../../canonical/model.js";

const LOINC = "http://loinc.org";
function hashId(s) { let h = 5381; const str = String(s || ""); for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return "h" + h.toString(16); }
const sex = (v) => ({ M: "male", F: "female", m: "male", f: "female", male: "male", female: "female" }[String(v || "").trim()] || "unknown");
const date = (v) => { const s = String(v || "").trim(); const m = s.match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})/); return m ? m[1] + "-" + m[2] + "-" + m[3] : (s || null); };

export function normalizeCsvLab(ctx, parsed) {
  const warnings = (parsed.warnings || []).slice();
  const map = (ctx.config && ctx.config.config && (typeof ctx.config.config === "string" ? safeParse(ctx.config.config) : ctx.config.config).columnMap) || {};
  const get = (row, key) => (map[key] && row[map[key]] != null ? String(row[map[key]]) : null);
  // Warn for mapped-but-absent columns (structural only, never a value).
  const header = parsed.header || [];
  for (const k of Object.keys(map)) if (map[k] && !header.includes(map[k])) warnings.push("mapped column '" + k + "'->'" + map[k] + "' absent from feed");
  for (const col of header) if (!Object.values(map).includes(col)) warnings.push("unmapped column '" + col + "' ignored");

  const out = bundle({ tenantId: ctx.tenant.id, sourceConnector: "file", generatedAt: ctx.now().toISOString(), warnings, provenance: [{ resource: "file", sourceConnector: "file", sourceId: "file/" + hashId(header.join(",")) }] });
  const reports = {};
  let patientSet = false;
  for (let i = 0; i < (parsed.rows || []).length; i++) {
    const row = parsed.rows[i];
    try {
      if (!patientSet) {
        const pidv = get(row, "patientId");
        out.patient = patient({ id: pidv ? hashId(pidv) : "unknown", gender: sex(get(row, "sex")), birthDate: date(get(row, "dob")), name: get(row, "name") ? { text: get(row, "name") } : null });
        patientSet = true;
      }
      const testName = get(row, "testName"), testCode = get(row, "testCode"), sysRaw = get(row, "testCodeSystem");
      const system = sysRaw === "LN" || sysRaw === "LOINC" ? LOINC : (sysRaw || null);
      const code = codeable({ coding: testCode ? [coding({ system, code: testCode, display: testName, kind: system === LOINC ? "standard" : "local" })] : [], text: testName || testCode || "lab" });
      const valRaw = get(row, "value");
      const value = valRaw != null && valRaw !== "" && !isNaN(Number(valRaw)) ? quantity({ value: Number(valRaw), unit: get(row, "unit") }) : (valRaw ? { text: valRaw } : null);
      const orderId = get(row, "orderId");
      const obsId = (orderId ? hashId(orderId) : "row") + "-" + i;
      out.observations.push(observation({ id: obsId, category: "laboratory", code, value,
        referenceRange: (get(row, "refLow") || get(row, "refHigh")) ? { low: get(row, "refLow") ? quantity({ value: Number(get(row, "refLow")) }) : null, high: get(row, "refHigh") ? quantity({ value: Number(get(row, "refHigh")) }) : null } : null,
        interpretation: get(row, "abnormalFlag") ? codeable({ text: get(row, "abnormalFlag") }) : null, status: get(row, "resultStatus") || "unknown", effectiveDateTime: date(get(row, "collectedAt")) }));
      if (orderId) {
        if (!reports[orderId]) { reports[orderId] = { id: hashId(orderId), results: [] }; out.diagnosticReports.push(diagnosticReport({ id: reports[orderId].id, code: codeable({ text: "lab panel" }), status: "final", results: reports[orderId].results })); }
        reports[orderId].results.push({ type: "Observation", id: obsId });
      }
    } catch (e) { warnings.push("row " + i + " skipped (malformed)"); }
  }
  if (!patientSet) out.patient = patient({ id: "unknown" });
  return out;
}
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
