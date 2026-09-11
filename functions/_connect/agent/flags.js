// functions/_connect/agent/flags.js — Connect Hospital agent-broker flag gates.
// Reconciled with the EXISTING connect flag convention (functions/_connect/onboard/flags.js,
// consent-flags.js, admin-flags.js, connectors/*/flags.js): every sub-surface flag is a narrow
// CONNECT_*_FLAG env var read as the string "1", ANDed on top of the broader gate. Default OFF, so an
// unset env is a 404 with no existence leak.
//
//   master              smd_connect              CONNECT_FLAG                      (testkit.flagOn)
//   onboarding surface  smd_connect_onboard      CONNECT_ONBOARD_FLAG              (onboardFlagOn)
//   agent broker        smd_connect_agent        CONNECT_AGENT_FLAG                (agentFlagOn)
//   browser session     smd_connect_browser_session  CONNECT_BROWSER_SESSION_FLAG  (browserSessionFlagOn)
//   auto activation     smd_connect_agent_auto_activate  CONNECT_AGENT_AUTO_ACTIVATE_FLAG
//
// agentFlagOn already includes the master + onboard gates, exactly as the brief requires ("combined with
// the existing master/onboard gates"). Nothing here lifts the engine sandbox restriction in
// functions/_connect/tenant.js assertSandboxAllowed — that gate is untouched and still applies.
import { onboardFlagOn } from "../onboard/flags.js";

export function agentFlagOn(env) {
  return onboardFlagOn(env) && String(env && env.CONNECT_AGENT_FLAG) === "1";
}

// Provisioning an actual browser session needs its own gate on top: the agent surface can be readable
// (status, hospital resolution) while live browser provisioning stays off during a staged rollout.
export function browserSessionFlagOn(env) {
  return agentFlagOn(env) && String(env && env.CONNECT_BROWSER_SESSION_FLAG) === "1";
}

// Automatic activation of a previously-approved adapter version. OFF means EVERY activation needs a
// designated reviewer. The activation track owns what happens when this is on; this module only answers
// whether the owner has configured a tested automated policy.
export function autoActivateFlagOn(env) {
  return agentFlagOn(env) && String(env && env.CONNECT_AGENT_AUTO_ACTIVATE_FLAG) === "1";
}
