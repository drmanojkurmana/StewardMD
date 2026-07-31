// functions/_connect/maik-context.js — SCCM → MaiK context + gated LLM egress (spec §7, C7)
export class EgressBlocked extends Error {}

// R7 egress guard: MaiK LLM egress requires a no-retention-provider BAA/DPA (tenant.egressBaaOk). A live
// consented bundle NEVER silently opens Vertex/Gemini egress on mode alone — it feeds only the deterministic
// MaiK context. Sandbox (synthetic-only) stays open for Phase-0 dev; everything else is fail-closed.
export function assertEgressAllowed(bundle, tenant) {
  if (!tenant || (tenant.mode !== "sandbox" && !tenant.egressBaaOk)) throw new EgressBlocked("MaiK LLM egress requires a no-retention-provider BAA/DPA (tenant.egressBaaOk); live bundles feed the deterministic MaiK context only");
}

// Flatten the canonical bundle into a compact MaiK-facing context. SCCM ONLY — no vendor fields, no provenance.
export function buildMaikContext(bundle) {
  const txt = (cc) => (cc && cc.text) || null;
  return {
    patient: bundle.patient ? { gender: bundle.patient.gender, birthDate: bundle.patient.birthDate } : null,
    problems: (bundle.conditions || []).map((c) => ({ label: txt(c.code), status: c.clinicalStatus })),
    medications: (bundle.medications || []).map((m) => ({ label: txt(m.medication), status: m.status, origin: m.origin })),
    allergies: (bundle.allergies || []).map((a) => ({ label: txt(a.code), criticality: a.criticality })),
    labs: (bundle.observations || []).filter((o) => o.category === "laboratory").map((o) => ({ label: txt(o.code), value: o.value, interpretation: o.interpretation })),
    vitals: (bundle.observations || []).filter((o) => o.category === "vital-signs").map((o) => ({ label: txt(o.code), value: o.value })),
    reports: (bundle.diagnosticReports || []).map((d) => ({ label: txt(d.code), conclusion: d.conclusion })),
    documents: (bundle.documents || []).map((d) => ({ label: txt(d.type), text: d.text })),
  };
}
