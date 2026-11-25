/* Test suite for CONSORT arithmetic checks (research-screen-consort.js).
 * No em or en dashes.
 * node --test test/research-consort.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import ConsortEngine from "../research-screen-consort.js";

describe("CONSORT arithmetic checks", () => {
  const balancedData = {
    assessed: 200,
    excluded: 50,
    randomised: 150,
    groups: [
      {
        name: "Group A",
        allocated: 75,
        received: 70,
        didNotReceive: 5,
        analysed: 70,
        excludedAnalysis: 5
      },
      {
        name: "Group B",
        allocated: 75,
        received: 75,
        didNotReceive: 0,
        analysed: 75,
        excludedAnalysis: 0
      }
    ]
  };

  test("balanced numbers pass all four checks", () => {
    const res = ConsortEngine.checkArithmetic(balancedData);
    assert.equal(res.ok, true, "all four checks pass on balanced numbers");
    assert.equal(res.warnings.length, 0, "zero warnings on balanced numbers");
    assert.equal(res.checks.length, 4, "four checks reported");
    assert.ok(res.checks.every((c) => c.pass === true), "every check passed");
  });

  test("Check 1 fires when assessed differs from excluded plus randomised, and clears when fixed", () => {
    // Fire Check 1
    const badAssessed = { ...balancedData, assessed: 190 };
    const res1 = ConsortEngine.checkArithmetic(badAssessed);
    assert.equal(res1.ok, false);
    const c1 = res1.checks.find((c) => c.id === 1);
    assert.equal(c1.pass, false, "Check 1 fails");
    assert.ok(c1.message.includes("Assessed (190) does not equal excluded (50) plus randomised (150)"));

    // Clear Check 1
    const fixed = { ...badAssessed, assessed: 200 };
    const resFixed = ConsortEngine.checkArithmetic(fixed);
    assert.equal(resFixed.checks.find((c) => c.id === 1).pass, true, "Check 1 clears");
  });

  test("Check 2 fires when randomised differs from sum of allocated, and clears when fixed", () => {
    // Fire Check 2
    const badRandomised = { ...balancedData, randomised: 140 };
    const res2 = ConsortEngine.checkArithmetic(badRandomised);
    assert.equal(res2.ok, false);
    const c2 = res2.checks.find((c) => c.id === 2);
    assert.equal(c2.pass, false, "Check 2 fails");
    assert.ok(c2.message.includes("Randomised (140) does not equal sum of allocated (150)"));

    // Clear Check 2
    const fixed = { ...badRandomised, randomised: 150 };
    const resFixed = ConsortEngine.checkArithmetic(fixed);
    assert.equal(resFixed.checks.find((c) => c.id === 2).pass, true, "Check 2 clears");
  });

  test("Check 3 fires when allocated differs from received plus did not receive, and clears when fixed", () => {
    // Fire Check 3 on Group A
    const badRec = {
      ...balancedData,
      groups: [
        { ...balancedData.groups[0], received: 65, didNotReceive: 5 }, // 65+5 = 70 != 75
        balancedData.groups[1]
      ]
    };
    const res3 = ConsortEngine.checkArithmetic(badRec);
    assert.equal(res3.ok, false);
    const c3 = res3.checks.find((c) => c.id === 3);
    assert.equal(c3.pass, false, "Check 3 fails");
    assert.ok(c3.message.includes("allocated (75) does not equal received (65) plus did not receive (5)"));

    // Clear Check 3
    const fixed = {
      ...badRec,
      groups: [
        { ...badRec.groups[0], received: 70 }, // 70+5 = 75
        badRec.groups[1]
      ]
    };
    const resFixed = ConsortEngine.checkArithmetic(fixed);
    assert.equal(resFixed.checks.find((c) => c.id === 3).pass, true, "Check 3 clears");
  });

  test("Check 4 fires when allocated differs from analysed plus excluded, and clears when fixed", () => {
    // Fire Check 4 on Group A
    const badAna = {
      ...balancedData,
      groups: [
        { ...balancedData.groups[0], analysed: 60, excludedAnalysis: 5 }, // 60+5 = 65 != 75
        balancedData.groups[1]
      ]
    };
    const res4 = ConsortEngine.checkArithmetic(badAna);
    assert.equal(res4.ok, false);
    const c4 = res4.checks.find((c) => c.id === 4);
    assert.equal(c4.pass, false, "Check 4 fails");
    assert.ok(c4.message.includes("allocated (75) does not equal analysed (60) plus excluded from analysis (5)"));

    // Clear Check 4
    const fixed = {
      ...badAna,
      groups: [
        { ...badAna.groups[0], analysed: 70 }, // 70+5 = 75
        badAna.groups[1]
      ]
    };
    const resFixed = ConsortEngine.checkArithmetic(fixed);
    assert.equal(resFixed.checks.find((c) => c.id === 4).pass, true, "Check 4 clears");
  });
});
