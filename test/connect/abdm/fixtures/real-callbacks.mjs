// test/connect/abdm/fixtures/real-callbacks.mjs — ABDM callbacks AS ACTUALLY RECEIVED.
//
// Captured by scripts/abdm-capture.py from the registered bridge URL. These are not inferred
// shapes: every field below arrived from dev.abdm.gov.in. Identifiers are masked; the STRUCTURE
// is the evidence, and the structure is untouched.
//
// Regenerate: ./scripts/abdm-capture.py <token> --out test/connect/abdm/fixtures/real-callbacks.mjs

export const REAL_CALLBACKS = Object.freeze([
 {
  "at": "2026-08-19 19:41:58",
  "method": "POST",
  "path": "/api/v3/hiu/consent/request/on-init",
  "headers": {
   "REQUEST-ID": "820f33ba-0a48-4ce4-b368-e1f64a052206",
   "TIMESTAMP": "2026-08-19T19:41:58.645Z",
   "X-HIU-ID": "IN2810006668",
   "CONTENT-TYPE": "application/json"
  },
  "hasBearer": true,
  "body": {
   "consentRequest": {
    "id": "939bc5eb-2059-47a9-a9a1-d4041b6cbfa0"
   },
   "error": null,
   "response": {
    "requestId": "35373889-d7ec-4c95-8e25-5745cb45efc2"
   }
  }
 },
 {
  "at": "2026-08-19 19:41:59",
  "method": "POST",
  "path": "/api/v3/hiu/consent/request/notify",
  "headers": {
   "REQUEST-ID": "d2ac01ea-a732-4812-8381-5eac9cc3f950",
   "TIMESTAMP": "2026-08-19T19:41:58.702Z",
   "X-HIU-ID": "IN2810006668",
   "CONTENT-TYPE": "application/json"
  },
  "hasBearer": true,
  "body": {
   "notification": {
    "consentRequestId": "939bc5eb-2059-47a9-a9a1-d4041b6cbfa0"
   },
   "error": {
    "code": "ABDM-1120: ",
    "message": "No care context available"
   }
  }
 },
 {
  "at": "2026-08-19 19:41:59",
  "method": "POST",
  "path": "/api/v3/hip/token/on-generate-token",
  "headers": {
   "REQUEST-ID": "096661eb-7603-4ebe-8ad1-f2e2a40f586c",
   "TIMESTAMP": "2026-08-19T19:41:59.432Z",
   "X-HIP-ID": "IN2810006668",
   "CONTENT-TYPE": "application/json"
  },
  "hasBearer": true,
  "body": {
   "error": {
    "code": "ABDM-1207: ",
    "message": "The information you provided does not match the details on record with Aadhaar. Please verify and provide accurate information."
   },
   "response": {
    "requestId": "11af9733-5cb0-4d81-8105-cb9d19f62bf0"
   }
  }
 }
]);

/** Every callback path we have actually observed, in arrival order. */
export const OBSERVED_PATHS = Object.freeze([
 "/api/v3/hiu/consent/request/on-init",
 "/api/v3/hiu/consent/request/notify",
 "/api/v3/hip/token/on-generate-token"
]);
