// functions/_connect/onboard/ai-map-flags.js — AI-assisted field mapping flag gate (mirrors the rest-json /
// dicomweb per-track idiom). aiMapFlagOn requires the BASE onboard gate (smd_connect AND smd_connect_onboard,
// via onboardFlagOn) AND smd_connect_ai_map (CONNECT_AI_MAP_FLAG); any of the three OFF => the suggest-mapping
// surface 404s (no existence leak) and the wizard falls back to the existing deterministic mapping. Default OFF.
import { onboardFlagOn } from "./flags.js";
export function aiMapFlagOn(env) { return onboardFlagOn(env) && String(env && env.CONNECT_AI_MAP_FLAG) === "1"; } // // VERIFY env name
