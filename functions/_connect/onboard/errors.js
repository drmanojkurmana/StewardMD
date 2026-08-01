// functions/_connect/onboard/errors.js — typed onboard error carrying a CLIENT-SAFE error class.
// The `klass` is the ONLY thing that reaches the client (never a stack, URL, token, or upstream message).
export class OnboardError extends Error {
  constructor(klass, message) { super(message || klass); this.name = "OnboardError"; this.klass = klass; }
}
// Probe/validation classes (spec §Backend test endpoint). `invalid`/`not-found` are onboard-CRUD classes.
export const PROBE_KLASSES = Object.freeze(["bad-url", "tls", "unauthorized", "not-fhir", "unreachable"]);
