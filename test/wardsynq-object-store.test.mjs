/* The S3-compatible object store: the signature matches AWS's own published example, and the adapter
 * sends correctly signed PUT/GET/DELETE requests. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signV4, s3Store, memoryStore, storeFromEnv, EMPTY_SHA256 } from "../functions/_wardsynq/object-store.js";

test("Signature V4 reproduces AWS's published S3 GET example exactly", async () => {
  // docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html - "Example: GET Object"
  const h = await signV4({
    method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt",
    headers: { range: "bytes=0-9" }, payloadHash: EMPTY_SHA256, amzDate: "20130524T000000Z",
    region: "us-east-1", service: "s3",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  });
  assert.equal(h.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
});

test("the adapter PUTs, GETs and DELETEs path-style with a signed payload hash", async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "GET") return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "application/pdf" } });
    return new Response("", { status: 200 });
  };
  const s = s3Store({ endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "wsq-docs", accessKeyId: "AK", secretAccessKey: "SK" }, fake);
  await s.put("t/ten1/docs/d1/v1-abc", new Uint8Array([9, 9]), "application/pdf");
  const got = await s.get("t/ten1/docs/d1/v1-abc");
  await s.delete("t/ten1/docs/d1/v1-abc");
  assert.equal(calls[0].url, "https://acct.r2.cloudflarestorage.com/wsq-docs/t/ten1/docs/d1/v1-abc");
  assert.equal(calls[0].init.method, "PUT");
  assert.match(calls[0].init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.notEqual(calls[0].init.headers["x-amz-content-sha256"], EMPTY_SHA256, "the body is hashed into the signature");
  assert.equal(calls[1].init.headers["x-amz-content-sha256"], EMPTY_SHA256);
  assert.deepEqual([...got.bytes], [1, 2, 3]);
  assert.equal(calls[2].init.method, "DELETE");
});

test("a provider error is an error, a missing object is null, and no settings means no store", async () => {
  const s = s3Store({ endpoint: "https://x.example", bucket: "b", accessKeyId: "a", secretAccessKey: "s" }, async (url, init) =>
    init.method === "GET" && url.endsWith("/missing") ? new Response("", { status: 404 }) : new Response("denied", { status: 403 }));
  assert.equal(await s.get("missing"), null);
  await assert.rejects(() => s.put("k", new Uint8Array([1]), "text/plain"), /object store put failed \(403\)/);
  assert.equal(storeFromEnv({}), null, "never a silent in-memory stand-in");
  assert.equal(storeFromEnv({ DOC_S3_ENDPOINT: "https://x", DOC_S3_BUCKET: "b", DOC_S3_ACCESS_KEY_ID: "a" }), null, "all four settings are required");
  assert.equal(storeFromEnv({ DOC_S3_ENDPOINT: "https://x", DOC_S3_BUCKET: "b", DOC_S3_ACCESS_KEY_ID: "a", DOC_S3_SECRET_ACCESS_KEY: "s" }).kind, "s3");
  const m = memoryStore();
  await m.put("k", new Uint8Array([4]), "text/plain");
  assert.deepEqual([...(await m.get("k")).bytes], [4]);
});
