// functions/_connect/onboard/flags.js — Self-service EMR onboarding flag gate (mirrors smart/flags.js).
// onboardFlagOn requires BOTH smd_connect (CONNECT_FLAG) AND smd_connect_onboard (CONNECT_ONBOARD_FLAG);
// either OFF => the onboard surface is a 404 (no existence leak). Default OFF.
import { flagOn } from "../testkit.js";
export function onboardFlagOn(env) { return flagOn(env) && String(env && env.CONNECT_ONBOARD_FLAG) === "1"; } // // VERIFY env name
