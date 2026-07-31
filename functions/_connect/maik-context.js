// functions/_connect/maik-context.js — SCCM → MaiK context + gated LLM egress (spec §7, C7)
export class EgressBlocked extends Error {}

// Phase-0 guard: real-patient bundles must NEVER reach MaiK's LLM egress until consent + BAA/DPA exist.
export function assertEgressAllowed(bundle, tenant) {
  if (!tenant || tenant.mode !== "sandbox") throw new EgressBlocked("MaiK LLM egress is sandbox-only until consent + provider BAA/DPA (Phase 1)");
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
