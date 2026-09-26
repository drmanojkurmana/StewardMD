import { isPro, entitlementState } from "./functions/_entitlement.js";
const OFF = { VERIFY_REQUIRED_FOR_PRO: "0" };
const promoOn = { ...OFF };
const now = Date.parse("2026-08-01T10:00:00Z"); // date before the promo ends
console.log(isPro(promoOn, null, now));
console.log(entitlementState(promoOn, {}, now).source);
