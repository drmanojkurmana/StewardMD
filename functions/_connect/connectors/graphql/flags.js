// functions/_connect/connectors/graphql/flags.js — flag gate for the generic GraphQL pull connector
// (mirrors rest-json/flags.js). graphqlFlagOn requires BOTH smd_connect AND smd_connect_graphql; either OFF
// => the graphql onboard save/test/pull surface is a 404 (no existence leak). Default OFF.
import { flagOn } from "../../testkit.js";
export function graphqlFlagOn(env) { return flagOn(env) && String(env && env.CONNECT_GRAPHQL_FLAG) === "1"; } // // VERIFY env name
