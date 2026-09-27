/* test/wardsynq-wrangler-config.test.mjs - OPS-26/F26: wrangler.toml's top-level [vars] default for
 * MAIK_LIVE_STREAM must match the documented and intended OFF state (functions/api/ai/[[path]].js's
 * own detailed comment on why this defaults off; docs/MAIK_ARCHITECTURE_AUDIT.md states streaming is
 * effectively off). A bare [vars] block is what `wrangler pages dev` / a preview deploy inherits.
 *
 * node --test test/wardsynq-wrangler-config.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

test("OPS-26/F26: the top-level [vars] block defaults MAIK_LIVE_STREAM to OFF (\"0\"), not \"1\"", () => {
  const start = SRC.indexOf("\n[vars]");
  const next = SRC.indexOf("\n[", start + 1);
  const varsBlock = SRC.slice(start, next > -1 ? next : SRC.length);
  const m = /^MAIK_LIVE_STREAM\s*=\s*"([^"]*)"/m.exec(varsBlock);
  assert.ok(m, "MAIK_LIVE_STREAM is declared in the bare [vars] block");
  assert.equal(m[1], "0", "was \"1\" - re-enabling the documented SSE-hang regression in any deploy that inherits this block (preview, or wrangler pages dev locally)");
});
