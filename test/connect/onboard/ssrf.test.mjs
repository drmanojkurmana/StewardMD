// test/connect/onboard/ssrf.test.mjs — the SSRF guard (assertPublicHttpsUrl). Accept a public https FHIR
// host; reject non-https, userinfo, every private/loopback/link-local/ULA literal, the cloud-metadata IP,
// localhost / *.local / *.internal, and IPv4-mapped-IPv6 private addresses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPublicHttpsUrl } from "../../../functions/_connect/onboard/ssrf.js";
import { OnboardError } from "../../../functions/_connect/onboard/errors.js";

test("accepts a public https FHIR host (hostname and public IP literal)", () => {
  assert.equal(assertPublicHttpsUrl("https://fhir.example.org/r4").host, "fhir.example.org");
  assert.equal(assertPublicHttpsUrl("https://r4.smarthealthit.org/").host, "r4.smarthealthit.org");
  assert.doesNotThrow(() => assertPublicHttpsUrl("https://203.0.113.10/fhir"));   // public IP literal is allowed
});

test("rejects non-https", () => {
  for (const u of ["http://fhir.example.org/", "ftp://fhir.example.org/", "ws://fhir.example.org/"]) {
    assert.throws(() => assertPublicHttpsUrl(u), (e) => e instanceof OnboardError && e.klass === "bad-url", u);
  }
});

test("rejects a non-URL and a URL with userinfo", () => {
  assert.throws(() => assertPublicHttpsUrl("not a url"), (e) => e.klass === "bad-url");
  assert.throws(() => assertPublicHttpsUrl("https://user:pass@fhir.example.org/"), (e) => e.klass === "bad-url");
});

test("rejects private / loopback / link-local / CGNAT IPv4 literals (incl. cloud metadata)", () => {
  for (const ip of ["10.0.0.5", "10.255.1.1", "172.16.0.1", "172.31.255.1", "192.168.1.1",
    "127.0.0.1", "0.0.0.0", "169.254.0.1", "169.254.169.254", "100.64.0.1"]) {
    assert.throws(() => assertPublicHttpsUrl("https://" + ip + "/metadata"),
      (e) => e instanceof OnboardError && e.klass === "bad-url", ip);
  }
});

test("allows a public IPv4 outside private ranges", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "203.0.113.1", "172.32.0.1", "172.15.0.1"]) {
    assert.doesNotThrow(() => assertPublicHttpsUrl("https://" + ip + "/"), ip);
  }
});

test("rejects IPv6 loopback / unique-local / link-local / mapped-private literals", () => {
  for (const ip of ["[::1]", "[::]", "[fc00::1]", "[fd12:3456::1]", "[fe80::1]", "[::ffff:169.254.169.254]", "[::ffff:10.0.0.1]"]) {
    assert.throws(() => assertPublicHttpsUrl("https://" + ip + "/"),
      (e) => e instanceof OnboardError && e.klass === "bad-url", ip);
  }
});

test("rejects localhost / *.local / *.internal names", () => {
  for (const h of ["localhost", "foo.localhost", "emr.local", "gateway.internal", "svc.cluster.internal"]) {
    assert.throws(() => assertPublicHttpsUrl("https://" + h + "/fhir"),
      (e) => e instanceof OnboardError && e.klass === "bad-url", h);
  }
});

test("rejects TRAILING-DOT name bypasses (localhost. / metadata.google.internal. / *.local.)", () => {
  for (const h of ["localhost.", "metadata.google.internal.", "svc.cluster.internal.", "emr.local."]) {
    assert.throws(() => assertPublicHttpsUrl("https://" + h + "/fhir"),
      (e) => e instanceof OnboardError && e.klass === "bad-url", h);
  }
});

test("rejects ALT-ENCODED loopback hosts (decimal int / hex octets normalize to 127.0.0.1)", () => {
  // The WHATWG URL parser normalizes these to the dotted 127.0.0.1 literal, which the IPv4 guard rejects.
  // Asserting them explicitly pins that the normalization + guard actually close the bypass.
  for (const h of ["2130706433", "0x7f.0.0.1", "0x7f000001", "017700000001"]) {
    assert.throws(() => assertPublicHttpsUrl("https://" + h + "/"),
      (e) => e instanceof OnboardError && e.klass === "bad-url", h);
  }
});
