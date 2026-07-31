// functions/_connect/permission.js — fail-closed scope + shared error types (spec §6, C11)
export class AuthError extends Error {}
export class PermissionError extends Error {}
export class SandboxViolation extends Error {}
export class UpstreamError extends Error {}

export function enforceScope(granted, requested) {
  try {
    if (!Array.isArray(granted) || !Array.isArray(requested)) throw new Error("scope inputs must be arrays");
    const set = new Set(granted);
    const out = requested.filter((s) => set.has(s));       // intersect; never widen
    if (out.length === 0) throw new Error("no authorized scope after intersection");
    return out;
  } catch (e) { throw new PermissionError(e.message); }     // any failure => deny
}
