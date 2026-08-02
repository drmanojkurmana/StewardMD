// functions/_connect/onboard/admin-flags.js — Enterprise Administration Portal flag gate (additive, default
// OFF). adminFlagOn requires the BASE onboard gate (smd_connect AND smd_connect_onboard, via onboardFlagOn)
// AND smd_connect_admin (CONNECT_ADMIN_FLAG); any of the three OFF => the /members* surface 404s (no existence
// leak). Mirrors the aiMapFlagOn/consentFlagOn per-track idiom. The RBAC (member:read/role/remove), last-owner
// protection, and PHI-free audit for the operations this gates live UNCHANGED in
// functions/_connect/enterprise/members.js — this flag only decides whether the HTTP surface exists. Default OFF.
import { onboardFlagOn } from "./flags.js";
export function adminFlagOn(env) { return onboardFlagOn(env) && String(env && env.CONNECT_ADMIN_FLAG) === "1"; } // // VERIFY env name
