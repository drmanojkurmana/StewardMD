// functions/_connect/connectors/rest-json/flags.js — flag gate for the generic REST/JSON pull connector
// (mirrors smart/flags.js / sdk/flags.js). restFlagOn requires BOTH smd_connect AND smd_connect_rest;
// either OFF => the rest-json onboard save/test/pull surface is a 404 (no existence leak). Default OFF.
import { flagOn } from "../../testkit.js";
export function restFlagOn(env) { return flagOn(env) && String(env && env.CONNECT_REST_FLAG) === "1"; } // // VERIFY env name
