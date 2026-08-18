// functions/_connect/abdm/config.js — ABDM environment configuration (M0).
// ONE place that knows every ABDM base URL, the CM id, and where our callbacks live. Base URLs are the
// definitive set from the ABDM integrator FAQ Q3; see docs/connect/abdm/V3-SPEC-RECONCILIATION.md §1.
//
// INDIA HOSTING: ABDM requires the callback host to be India-based and addressed by domain (FAQ Q29).
// `ABDM_CALLBACK_BASE` is that domain. The receiver routes are plain Pages Functions, so the same code
// serves either a Cloudflare India-region custom domain or an India-hosted forwarder proxying to us -
// switching between them is a variable change, not a code change.

export class AbdmConfigError extends Error {}

const ENVS = {
  sandbox: {
    cmId: "sbx",
    gateway: "https://dev.abdm.gov.in",              // M2 + M3 + sessions (paths carry /api)
    abha: "https://abhasbx.abdm.gov.in",             // M1, base path /abha/api/v3
    abhaAddress: "https://abhasbx.abdm.gov.in",      // ABHA-address verification lives under /abha/api/v3/phr/web
    abhaAddressPrefix: "/abha/api/v3/phr/web",
    abhaPrefix: "/abha/api/v3",
  },
  production: {
    cmId: "abdm",
    gateway: "https://apis.abdm.gov.in",
    abha: "https://abha.abdm.gov.in",
    abhaPrefix: "/api/abha/v3",                      // prod ABHA base is https://abha.abdm.gov.in/api/abha
    abhaAddress: "https://phr.abdm.gov.in",
    abhaAddressPrefix: "/api/phr/web/v3",
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
    abhaBase: base.abha,
    abhaPrefix: base.abhaPrefix,
    abhaAddressBase: base.abhaAddress,
    abhaAddressPrefix: base.abhaAddressPrefix,
    callbackBase,
    hipId: (env && env.ABDM_HIP_ID) || "",            // HFR facility id; empty until Software Linkage is done
    hiuId: (env && env.ABDM_HIU_ID) || "",            // may be the same facility id as the HIP (FAQ Q22)
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
