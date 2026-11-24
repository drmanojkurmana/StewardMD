/* ResearchMD engine wrapper for Pages Functions (ES module).
 * research-engine.js is the canonical UMD stats file (browser global
 * SMD_RESEARCH_ENGINE plus module.exports). Importing it here gives saved
 * runs on the API the exact code the phone runs for previews.
 */
import ENGINE from "../../../research-engine.js";

export const version = ENGINE.version;
export const effectFromRaw = ENGINE.effectFromRaw;
export const effectFromCI = ENGINE.effectFromCI;
export const effectFromGeneric = ENGINE.effectFromGeneric;
export const pool = ENGINE.pool;
export const run = ENGINE.run;
export const tQuantile = ENGINE.tQuantile;

export default ENGINE;
