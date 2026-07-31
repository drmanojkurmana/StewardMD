// functions/_connect/abdm/hip-flags.js — the SECOND flag gate for the HIP (provider) surface (Stage-5 Task-7).
//
// The HIP serve direction requires BOTH the base `smd_connect` flag AND the separate `smd_connect_hip` flag
// (default OFF): a deployment can run the HIU consume path with the HIP surface still dark. This is the SAME
// predicate hip.js keeps inline (self-contained module) — extracted here so ingress.js + api/connect/[[path]].js
// share ONE definition rather than re-deriving it. Any HIP surface must gate on `hipFlagOn` so the second flag
// structurally covers every entry point.
// // VERIFY: the real env-var name for `smd_connect_hip` (defaulted here to CONNECT_HIP_FLAG, matching hip.js).
import { flagOn } from "../testkit.js";

export const hipFlagOn = (env) => flagOn(env) && String(env && env.CONNECT_HIP_FLAG) === "1";
