// functions/_connect/connectors/sql/flags.js — flag gate for the generic SQL/DB pull connector
// (mirrors rest-json/flags.js / graphql/flags.js). sqlFlagOn requires BOTH smd_connect AND smd_connect_sql;
// either OFF => the sql onboard save/test/pull surface is a 404 (no existence leak). Default OFF.
import { flagOn } from "../../testkit.js";
export function sqlFlagOn(env) { return flagOn(env) && String(env && env.CONNECT_SQL_FLAG) === "1"; } // // VERIFY env name
