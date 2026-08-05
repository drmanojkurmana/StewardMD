// test/sknx-secure-egress.test.mjs — security H1: the smd_sknx_secure_egress flag routes the cloud
// classifier through the authenticated Worker proxy (/api/sknx) instead of raw Cloud Run. Default OFF
// keeps the validation path unchanged; an explicit endpoint override always wins.
import { test } from "node:test";
import assert from "node:assert";
import CV from "../sknx-cloudvision.js";

const RAW = "https://sknx-derm-yislqrddsq-el.a.run.app";
const PROXY = "https://stewardmd.in/api/sknx";
const flags = (on) => ({ bool: (k) => k === "smd_sknx_secure_egress" && !!on });

test("default (flag OFF): endpoint stays the raw Cloud Run URL — validation path unchanged", () => {
  globalThis.window = { SMD_SKNX_FLAGS: flags(false) };
  assert.equal(CV.endpoint(), RAW);
});

test("flag ON: endpoint routes through the authenticated Worker proxy (/api/sknx)", () => {
  globalThis.window = { SMD_SKNX_FLAGS: flags(true) };
  assert.equal(CV.endpoint(), PROXY);
  // classify() appends /classify -> POST /api/sknx/classify (the auth-enforced route)
});

test("explicit endpoint override always wins, even with the flag ON", () => {
  globalThis.window = { SMD_SKNX_CLOUD_ENDPOINT: "https://pinned.example.run.app", SMD_SKNX_FLAGS: flags(true) };
  assert.equal(CV.endpoint(), "https://pinned.example.run.app");
});

test("no flags present: falls back to the raw default (never throws)", () => {
  globalThis.window = {};
  assert.equal(CV.endpoint(), RAW);
});
