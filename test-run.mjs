import { isPro, entitlementState } from "./functions/_entitlement.js";
const OFF = { VERIFY_REQUIRED_FOR_PRO: "0" };
const promoOn = { ...OFF };
console.log(isPro(promoOn, null, Date.now()));
console.log(entitlementState(promoOn, {}, Date.now()).source);
