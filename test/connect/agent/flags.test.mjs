// test/connect/agent/flags.test.mjs - Connect Hospital agent broker flag gates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentFlagOn, browserSessionFlagOn, autoActivateFlagOn } from "../../../functions/_connect/agent/flags.js";

test("flags default OFF when env is missing or empty", () => {
  assert.equal(agentFlagOn(undefined), false);
  assert.equal(agentFlagOn(null), false);
  assert.equal(agentFlagOn({}), false);

  assert.equal(browserSessionFlagOn(undefined), false);
  assert.equal(browserSessionFlagOn(null), false);
  assert.equal(browserSessionFlagOn({}), false);

  assert.equal(autoActivateFlagOn(undefined), false);
  assert.equal(autoActivateFlagOn(null), false);
  assert.equal(autoActivateFlagOn({}), false);
});

test("agentFlagOn requires CONNECT_FLAG, CONNECT_ONBOARD_FLAG, and CONNECT_AGENT_FLAG", () => {
  // Only agent flag on -> false (master and onboard are off)
  assert.equal(agentFlagOn({ CONNECT_AGENT_FLAG: "1" }), false);

  // Master on, agent on, onboard off -> false
  assert.equal(agentFlagOn({ CONNECT_FLAG: "1", CONNECT_AGENT_FLAG: "1" }), false);

  // Onboard on, agent on, master off -> false
  assert.equal(agentFlagOn({ CONNECT_ONBOARD_FLAG: "1", CONNECT_AGENT_FLAG: "1" }), false);

  // Master on, onboard on, agent off -> false
  assert.equal(agentFlagOn({ CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1" }), false);
  assert.equal(agentFlagOn({ CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1", CONNECT_AGENT_FLAG: "0" }), false);
  assert.equal(agentFlagOn({ CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1", CONNECT_AGENT_FLAG: "true" }), false);

  // All three on as string "1" -> true
  assert.equal(agentFlagOn({ CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1", CONNECT_AGENT_FLAG: "1" }), true);
});

test("browserSessionFlagOn cascades from agentFlagOn and requires CONNECT_BROWSER_SESSION_FLAG", () => {
  const agentEnv = { CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1", CONNECT_AGENT_FLAG: "1" };

  // Only browser session flag on -> false
  assert.equal(browserSessionFlagOn({ CONNECT_BROWSER_SESSION_FLAG: "1" }), false);

  // Agent flags on, but browser session flag missing or off -> false
  assert.equal(browserSessionFlagOn(agentEnv), false);
  assert.equal(browserSessionFlagOn(Object.assign({}, agentEnv, { CONNECT_BROWSER_SESSION_FLAG: "0" })), false);
  assert.equal(browserSessionFlagOn(Object.assign({}, agentEnv, { CONNECT_BROWSER_SESSION_FLAG: "true" })), false);

  // All 4 on -> true
  assert.equal(browserSessionFlagOn(Object.assign({}, agentEnv, { CONNECT_BROWSER_SESSION_FLAG: "1" })), true);
});

test("autoActivateFlagOn cascades from agentFlagOn and requires CONNECT_AGENT_AUTO_ACTIVATE_FLAG", () => {
  const agentEnv = { CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1", CONNECT_AGENT_FLAG: "1" };

  // Only auto-activate flag on -> false
  assert.equal(autoActivateFlagOn({ CONNECT_AGENT_AUTO_ACTIVATE_FLAG: "1" }), false);

  // Agent flags on, but auto-activate flag missing or off -> false
  assert.equal(autoActivateFlagOn(agentEnv), false);
  assert.equal(autoActivateFlagOn(Object.assign({}, agentEnv, { CONNECT_AGENT_AUTO_ACTIVATE_FLAG: "0" })), false);
  assert.equal(autoActivateFlagOn(Object.assign({}, agentEnv, { CONNECT_AGENT_AUTO_ACTIVATE_FLAG: "true" })), false);

  // All 4 on -> true
  assert.equal(autoActivateFlagOn(Object.assign({}, agentEnv, { CONNECT_AGENT_AUTO_ACTIVATE_FLAG: "1" })), true);
});
