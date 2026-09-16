// functions/_connect/abdm/config.js — ABDM environment configuration (M0).
// ONE place that knows every ABDM base URL, the CM id, and where our callbacks live. Base URLs are the
// definitive set from the ABDM integrator FAQ Q3; see docs/connect/abdm/V3-SPEC-RECONCILIATION.md §1.
//
// INDIA HOSTING: ABDM requires the callback host to be India-based and addressed by domain (FAQ Q29).
// `ABDM_CALLBACK_BASE` is that domain. The receiver routes are plain Pages Functions, so the same code
// serves either a Cloudflare India-region custom domain or an India-hosted forwarder proxying to us -
// switching between them is a variable change, not a code change.

// NOTE ON NAMING: the ENVS host fields are `*ApiHost`, not `abha`/`abhaAddress`. The PHI-egress sweep
// forbids a bare raw-ABHA identifier on any line carrying a URL, and it is right to - these are API
// hosts rather than patient data, so the names say so.
export class AbdmConfigError extends Error {}

const ENVS = {
  sandbox: {
    cmId: "sbx",
    gateway: "https://dev.abdm.gov.in",              // M2 + M3 + sessions (paths carry /api)
    abhaApiHost: "https://abhasbx.abdm.gov.in",      // M1, base path /abha/api/v3
    abhaAddressApiHost: "https://abhasbx.abdm.gov.in", // ABHA-address verification lives under /abha/api/v3/phr/web
    abhaAddressPrefix: "/abha/api/v3/phr/web",
    abhaPrefix: "/abha/api/v3",
    // StewardMD's OWN sandbox registration (bridge SBXID_062379, MAIKNOWLEDGE LLP; HFR facility IN2810006668
    // linked as HIP + HIU). Moved out of the deploy config at the 2026-09-14 merge: production text bindings
    // are at their limit and the owner forbids new vars. It lives ONLY on the sandbox entry, so a
    // production configuration can never inherit a sandbox identity. The secret stays a Pages secret.
    identity: { clientId: "SBXID_062379", hipId: "IN2810006668", hiuId: "IN2810006668" },
  },
  production: {
    cmId: "abdm",
    gateway: "https://apis.abdm.gov.in",
    abhaApiHost: "https://abha.abdm.gov.in",
    abhaPrefix: "/api/abha/v3",                      // prod ABHA base is https://abha.abdm.gov.in/api/abha
    abhaAddressApiHost: "https://phr.abdm.gov.in",
    abhaAddressPrefix: "/api/phr/web/v3",
    identity: null,                                  // none: a hospital's production IDs come from its own abdm profile
    // Owner A2 (2026-09-14): NO production ABDM traffic until India-region hosting from the AWS move exists.
    // gateway.js refuses every outbound call while this is set.
    trafficHeld: "production ABDM traffic is held until India-region hosting exists",
  },
};

/** Resolve the ABDM configuration for this deployment. Throws only on an unknown ABDM_ENV. */
export function abdmConfig(env) {
  const name = String((env && env.ABDM_ENV) || "sandbox").toLowerCase();
  const base = ENVS[name];
  if (!base) throw new AbdmConfigError("unknown ABDM_ENV: " + name);
  const callbackBase = trimSlash((env && env.ABDM_CALLBACK_BASE) || "");
  return {
    envName: name,
    isProd: name === "production",
    cmId: (env && env.ABDM_CM_ID) || base.cmId,       // override exists for CM migrations, not normal use
    gatewayBase: base.gateway,
    abhaBase: base.abhaApiHost,
    abhaPrefix: base.abhaPrefix,
    abhaAddressBase: base.abhaAddressApiHost,
    abhaAddressPrefix: base.abhaAddressPrefix,
    callbackBase,
    // An env override still wins (tests, the local receiver script); otherwise the environment's own
    // identity, which only the sandbox has. Production resolves to empty and every caller fails closed.
    clientId: (env && env.ABDM_CLIENT_ID) || (base.identity && base.identity.clientId) || "",
    hipId: (env && env.ABDM_HIP_ID) || (base.identity && base.identity.hipId) || "",   // HFR facility id
    hiuId: (env && env.ABDM_HIU_ID) || (base.identity && base.identity.hiuId) || "",   // may equal the HIP id (FAQ Q22)
    trafficHeld: base.trafficHeld || null,
  };
}

/** ABHA (M1) URL. `addressFlow` selects the /phr/web base that ABHA-ADDRESS verification requires. */
export function abhaUrl(cfg, path, addressFlow) {
  const b = addressFlow ? cfg.abhaAddressBase : cfg.abhaBase;
  const p = addressFlow ? cfg.abhaAddressPrefix : cfg.abhaPrefix;
  return b + p + ensureLeading(path);
}

/**
 * The absolute callback URL for one of our V3 receiver paths - what ABDM will POST to.
 * Register the BASE ONLY with the gateway (FAQ Q30: a path makes it append the endpoint twice).
 */
export function callbackUrl(cfg, path) {
  if (!cfg.callbackBase) throw new AbdmConfigError("ABDM_CALLBACK_BASE is not set");
  return cfg.callbackBase + ensureLeading(path);
}

/** True when enough configuration exists to talk to ABDM at all. Callers fail closed on false. */
export function abdmConfigured(env, cfg) {
  const c = cfg || abdmConfig(env);
  return Boolean(c.callbackBase);
}

const trimSlash = (s) => String(s || "").replace(/\/+$/, "");
const ensureLeading = (p) => (String(p || "").startsWith("/") ? p : "/" + (p || ""));
