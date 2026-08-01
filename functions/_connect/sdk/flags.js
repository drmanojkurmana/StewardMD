// functions/_connect/sdk/flags.js — the flag gate for the Connector SDK registry (Track C).
// The SDK swaps the hardcoded /context connector literal for the conformance-gated registry. It requires
// BOTH the base smd_connect flag AND the separate smd_connect_sdk flag (default OFF): with either off the
// /context dispatch is byte-identical to the pre-SDK literal map, so the router behaves exactly as before.
import { flagOn } from "../testkit.js";
export const sdkFlagOn = (env) => flagOn(env) && String(env && env.CONNECT_SDK_FLAG) === "1"; // // VERIFY env name
