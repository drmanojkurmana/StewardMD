// test/fetch-timeout.test.mjs — a hung upstream must abort, not hang the caller.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchWithTimeout } from "../functions/_fetch.js";

test("fetchWithTimeout aborts a slow upstream instead of hanging", async () => {
  // a server that never responds (holds the socket open)
  const server = createServer(() => { /* deliberately never reply */ });
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const started = Date.now();
  await assert.rejects(
    fetchWithTimeout(`http://127.0.0.1:${port}/`, {}, 100),
    (e) => e.name === "TimeoutError" || e.name === "AbortError"
  );
  assert.ok(Date.now() - started < 2000, "should fast-fail near the timeout, not hang");
  server.close();
});

test("fetchWithTimeout returns normally when the upstream answers in time", async () => {
  const server = createServer((_req, res) => { res.writeHead(200); res.end("ok"); });
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const r = await fetchWithTimeout(`http://127.0.0.1:${port}/`, {}, 2000);
  assert.equal(await r.text(), "ok");
  server.close();
});
