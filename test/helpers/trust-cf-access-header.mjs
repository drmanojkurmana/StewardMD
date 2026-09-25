/* Test-only: make _fbauth.js cfAccessEmail() take the Cf-Access-Authenticated-User-Email header at
 * face value, as the in-process route suites always have. Production verifies the Access JWT instead
 * (a bare email header is forgeable); test/cf-access-verify.test.mjs covers that path.
 * Import this ONLY from a suite that uses the email header as its stand-in identity. */
globalThis.__SMD_TEST_TRUST_CF_ACCESS_HEADER = true;
