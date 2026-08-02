// functions/_connect/connectors/dicomweb/flags.js — flag gate for the DICOMweb QIDO-RS pull connector
// (mirrors rest-json/flags.js). dicomFlagOn requires BOTH smd_connect AND smd_connect_dicom; either OFF =>
// the dicomweb onboard save/test/pull surface is a 404 (no existence leak). Default OFF.
import { flagOn } from "../../testkit.js";
export function dicomFlagOn(env) { return flagOn(env) && String(env && env.CONNECT_DICOM_FLAG) === "1"; } // // VERIFY env name
