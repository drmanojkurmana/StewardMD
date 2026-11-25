/* Test suite for CTRI registration validation and store status (research-screen-ctri.js).
 * No em or en dashes.
 * node --test test/research-ctri.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import RMDCtri from "../research-screen-ctri.js";

describe("CTRI registration validation", () => {
  test("CTRI/2026/05/012345 accepted", () => {
    const res = RMDCtri.validate("CTRI/2026/05/012345");
    assert.equal(res.ok, true);
    assert.equal(res.number, "CTRI/2026/05/012345");
  });

  test("lower case and spaces trimmed", () => {
    const res = RMDCtri.validate("  ctri/2026/05/012345  ");
    assert.equal(res.ok, true);
    assert.equal(res.number, "CTRI/2026/05/012345");
  });

  test("REF/2026/05/012345 blocked with the reference message", () => {
    const res = RMDCtri.validate("REF/2026/05/012345");
    assert.equal(res.ok, false);
    assert.equal(res.message, "That is a CTRI submission reference, not your final registration number.");
  });

  test("CTRI/2026/005/012345 and CTRI/2026/05/12345 rejected", () => {
    const res1 = RMDCtri.validate("CTRI/2026/005/012345");
    assert.equal(res1.ok, false);
    assert.equal(res1.message, "A CTRI number looks like CTRI/2026/05/012345.");

    const res2 = RMDCtri.validate("CTRI/2026/05/12345");
    assert.equal(res2.ok, false);
    assert.equal(res2.message, "A CTRI number looks like CTRI/2026/05/012345.");
  });

  test("RMDCtri.registered returns false initially and true when valid record is stored", async () => {
    const store = new Map();
    globalThis.RMDStore = {
      get: async (pid, kind, id) => store.get(pid + ":" + kind + ":" + id) || null,
      put: async (pid, kind, id, val) => { store.set(pid + ":" + kind + ":" + id, val); }
    };

    const pid = "proj-test-123";
    const initial = await RMDCtri.registered(pid);
    assert.equal(initial, false, "initially unregistered");

    // Put invalid status
    await globalThis.RMDStore.put(pid, "ctri", "registration", {
      status: "submitted",
      ctriNumber: "CTRI/2026/05/012345"
    });
    const submitted = await RMDCtri.registered(pid);
    assert.equal(submitted, false, "submitted is not yet registered");

    // Put registered with invalid number
    await globalThis.RMDStore.put(pid, "ctri", "registration", {
      status: "registered",
      ctriNumber: "REF/2026/05/012345"
    });
    const refNum = await RMDCtri.registered(pid);
    assert.equal(refNum, false, "REF number is not registered");

    // Put valid registered record
    await globalThis.RMDStore.put(pid, "ctri", "registration", {
      status: "registered",
      ctriNumber: "CTRI/2026/05/012345"
    });
    const final = await RMDCtri.registered(pid);
    assert.equal(final, true, "valid record is registered");
  });
});
