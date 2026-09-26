import { isPro, entitlementState, promoUntil, promoActive } from "./functions/_entitlement.js";
const OFF = { VERIFY_REQUIRED_FOR_PRO: "0" };
const promoOn = { ...OFF };
console.log(promoUntil(promoOn));
console.log(Date.now());
console.log(promoActive(promoOn, Date.now()));
