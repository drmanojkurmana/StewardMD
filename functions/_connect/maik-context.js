// functions/_connect/maik-context.js — SCCM → MaiK context + gated LLM egress (spec §7, C7)
export class EgressBlocked extends Error {}

// R7 egress guard. HONEST MECHANISM (do not repeat the old "egressBaaOk=false => zero bytes" framing):
//   The real zero-real-PHI-egress property is enforced UPSTREAM by the engine, NOT by egressBaaOk here. The
//   engine (tenant.js assertSandboxAllowed) REFUSES any non-sandbox tenant (throws for mode!=="sandbox") and
//   CONFINES base_url to the synthetic SANDBOX_ALLOWLIST. So in practice only synthetic sandbox bundles ever
//   exist to be split, and this guard's sandbox branch passes them. egressBaaOk is a SECONDARY, presently
//   UN-WIRED switch: no route sets baa_ok=1 and no real hospital host is allow-listed, so egressBaaOk===false
//   is NOT what stops live PHI today — the sandbox allow-list + live-mode refusal is. Before any live-PHI
//   egress, wire BOTH a real host AND egressBaaOk behind an app-owner gate (see rbac.js egress:baa guardrail).
//   Fail-closed: egress opens only for sandbox OR egressBaaOk===true; everything else blocks.
export function assertEgressAllowed(bundle, tenant) {
  if (!tenant || (tenant.mode !== "sandbox" && !tenant.egressBaaOk)) throw new EgressBlocked("MaiK LLM egress blocked: not a sandbox tenant and egressBaaOk!==true. Real confinement is the engine's sandbox allow-list + live-mode refusal; egressBaaOk is a secondary, presently-un-wired gate.");
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
