// functions/_connect/smart/flags.js — Track A flag gate. fhirFlagOn requires BOTH smd_connect AND
// smd_connect_fhir; either OFF => the FHIR surface is a 404 (no existence leak). Default OFF.
import { flagOn } from "../testkit.js";
export function fhirFlagOn(env) { return flagOn(env) && String(env && env.CONNECT_FHIR_FLAG) === "1"; } // // VERIFY env name
