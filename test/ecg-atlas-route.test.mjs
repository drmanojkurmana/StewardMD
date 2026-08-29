/* test/ecg-atlas-route.test.mjs — the authenticated Learn-ECG atlas route.
 *
 * Reported: "ecg learn cases not displaying ecgs". The root cause was not in KardioX at all -
 * functions/_middleware.js hard-404s every static asset on stewardmd.in (deliberately, so the web
 * bundle cannot be scraped), while scripts/build-www.sh deliberately does NOT bundle the 182 MB
 * atlas into the app. So kardiox-screens.js asked the one origin that refuses to serve it.
 *
 * /api/ecg-atlas/<name> is the seam: the same image, but only for a signed-in doctor, so the atlas
 * is not handed to anonymous scrapers. These tests pin the two things that would be dangerous to
 * get wrong - the path guard and the auth requirement - by driving the real onRequest against a
 * stubbed env, so no network, no Firebase and no real token are involved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/ecg-atlas/[name].js";

const IMG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);   // JPEG magic, enough to be real

// env.ASSETS records what was asked for, so a traversal attempt is visible even if it would 200.
function makeEnv({ ok = true } = {}) {
  const seen = [];
  return {
    seen,
    ASSETS: {
      fetch: async (req) => {
        seen.push(new URL(req.url).pathname);
        return ok
          ? new Response(IMG, { status: 200, headers: { "content-type": "image/jpeg" } })
          : new Response("nope", { status: 404 });
      },
    },
  };
}
const call = (name, { auth = "Bearer good", env = makeEnv(), method = "GET" } = {}) =>
  onRequest({
    request: new Request("https://stewardmd.in/api/ecg-atlas/" + encodeURIComponent(name), {
      method, headers: auth ? { Authorization: auth } : {},
    }),
    env,
    params: { name },
  });

/* ---- auth ---- */

test("an anonymous request is refused", async () => {
  const r = await call("5f1cb0c76aa9.jpg", { auth: "" });
  assert.equal(r.status, 401, "no token must not get an image");
});

test("a token that does not verify is refused", async () => {
  // verifyFirebaseToken cannot succeed here (no Firebase env is stubbed). The route must treat a
  // failed verification as unauthorised, never fall through to serving the file.
  const r = await call("5f1cb0c76aa9.jpg", { auth: "Bearer not-a-real-token" });
  assert.equal(r.status, 401);
});

test("the asset is never read before the caller is authorised", async () => {
  const env = makeEnv();
  await call("5f1cb0c76aa9.jpg", { auth: "", env });
  assert.deepEqual(env.seen, [], "an unauthenticated request must not reach the asset store at all");
});

/* ---- path guard (runs before auth, so it is testable without a token) ---- */

test("directory traversal is rejected", async () => {
  for (const bad of ["../_middleware.js", "a/../../etc/passwd", "..", "../../index.html"]) {
    const env = makeEnv();
    const r = await call(bad, { env });
    assert.equal(r.status, 400, `traversal not rejected: ${bad}`);
    assert.deepEqual(env.seen, [], `traversal reached the asset store: ${bad}`);
  }
});

test("non-image and script names are rejected", async () => {
  for (const bad of ["index.html", "app.js", "kb.json", "sw.js", "5f1cb0c76aa9", "5f1cb0c76aa9.js"]) {
    const r = await call(bad);
    assert.equal(r.status, 400, `should not be servable: ${bad}`);
  }
});

test("a valid atlas filename passes the guard", async () => {
  // It still stops at auth in this harness; what matters is it is not rejected as malformed.
  const r = await call("5f1cb0c76aa9.jpg");
  assert.notEqual(r.status, 400, "a legitimate atlas name must not be rejected as malformed");
});

/* ---- method ---- */

test("only GET is allowed", async () => {
  for (const m of ["POST", "PUT", "DELETE"]) {
    const r = await call("5f1cb0c76aa9.jpg", { method: m });
    assert.equal(r.status, 405, `${m} should not be accepted`);
  }
});

/* ---- the client contract ---- */

test("the client retries atlas images through this route, once, with a bearer token", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../kardiox-screens.js", import.meta.url), "utf8");
  assert.match(src, /\/api\/ecg-atlas\//, "kardiox-screens must call the authenticated route");
  assert.match(src, /"Authorization": "Bearer " \+ tok/, "and must send the ID token");
  assert.match(src, /addEventListener\("error"[\s\S]{0,600}?true\)/,
    "the retry must listen in the CAPTURE phase - an <img> error does not bubble");
  assert.match(src, /data-kx-retried/, "one retry per element, so a failing image cannot loop");
  assert.match(src, /arrayBuffer\(\)/,
    "arrayBuffer, not blob: that is the primitive proven on the native fetch bridge");
});
