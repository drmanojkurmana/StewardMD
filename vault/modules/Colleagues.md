---
tags: [module, opd, sharing, server]
status: ON since 2026-09-25 (owner: "turn on wave 2"). Client flag and server route both default ON.
flag: smd_kits_share (client, def:true; "0" on a device or ?share=0 turns it off) + env KITS_SHARE_ON (server; "0" = kill switch)
---
# Colleagues (kits sharing, wave 2)

The server half of the owner's "every branch" list (B1, B2, B3 sync, B7, E3, E4, F1 sync). One client
module (`kits-share.js`, `window.SMD_SHARE`, sheet `#smdShare` z 12045) and one route family
(`functions/api/kits/[[path]].js` over `functions/_kits_share.js`).

| Item | What the doctor does | Where |
|---|---|---|
| B1 referral | Documents > Referral letter > "Send to a colleague in StewardMD" (StewardMD ID, patient consent tick). The kit summary rides along. Recipient accepts or declines with a reply. | `kx_msgs` kind referral, 31 days |
| B3 handover | Documents > Shift handover > "Send to the receiving doctor". Receiver must type a read-back (I-PASS synthesis) to acknowledge. | `kx_msgs` kind handover, 3 days |
| B2 case room | Kit > "Ask colleagues about this case" (summary prefilled from the kit, patient name replaced). Invite by StewardMD ID; members reply; owner invites more or closes. | `kx_cases`, `kx_case_mem`, `kx_case_posts`, 90 days after last post |
| B7 hospital version | Inside any kit: "Colleagues and your hospital" shows each hospital's version (notes, contacts, local test names, order sets that queue). The hospital owner, an `admin` or `pg_hod` member (and verified) edits and publishes. Versions are immutable. | `kx_unit`, `kx_unit_ver` |
| E3/E4 history | OPD kit: "Save this visit to the patient's kit history", "Previous visits" (O&G: "Antenatal card"): a table by visit. | `kx_hist`, per doctor, 40 visits, 400 days |
| F1 sync | Review Desk: "Send to StewardMD". Owner downloads `GET /api/kits/reviews/all` and runs `scripts/apply-reviews.mjs` on it as is. | `kx_reviews` |

Home tile "Colleagues" (`act:"kxinbox"`, defOn false) appears only when the flag is on. Push taps with
`data.type === "kits"` open the item (`native-push.js`).

**Addressing a colleague:** by StewardMD ID (`SMD-XXXXXX`) or by the email they sign in with. Most doctors
have no StewardMD ID until something mints one (ICU groups, ID onboarding), so the Colleagues sheet calls
`SMD_STEWARD_ID.ensure()` and shows "Your StewardMD ID" with a Copy button; email works meanwhile.

## Rules (enforced on the server)
- Identity is the verified Firebase ID token only (`verifiedClaimsFor`); a bare Cf-Access email header
  is NOT accepted here (the older `identify()` still trusts it; see the Explore finding in [[Decisions]]).
- Patient data moves **only between registration-verified doctors**: sender `claims.verified`, and the
  recipient's claims are read with the service account. No messages to self.
- **Encrypted at rest**: payloads, replies, case text, history are AES-256-GCM sealed (`kx1:` prefix)
  with `FOLLOWCARE_PHI_KEY` (the app's PHI key, as the OPD queue uses). Plain fields are only what a
  list needs: kind, status, dates, kit id, urgency, names of the two doctors.
- **No PHI in URLs, pushes or logs**: patient ids go in POST bodies; pushes are fixed text ("A colleague
  sent you a referral. Open StewardMD to read it."); history docs are keyed by HMAC(uid, record number)
  under an HKDF-derived key, so the record number is never stored.
- Case-room text goes through `stripIdentifiers` (`functions/_deid.js`) before it is stored.
- Status machines: referral sent, seen, accepted or declined (recipient) or withdrawn (sender); handover
  sent, seen, acknowledged (needs a read-back) or withdrawn. Final states are final (409).
- Rate limits per doctor (`_ratelimit.js`, KV): 30 sends, 10 case rooms, 30 invites, 60 posts, 120
  history saves, 20 publishes an hour. Sends and invites are counted BEFORE the recipient lookup, so a
  doctor cannot probe which IDs or emails belong to verified doctors without spending the limit. Payloads capped (24 KB message, field caps); router refuses bodies over 64 KB.
- Expired items drop out of lists and are deleted on the next list.

## On, and how to switch it off
The owner turned it on on 2026-09-25. Both defaults are in code:
- **Server** `functions/api/kits/[[path]].js`: on unless `KITS_SHARE_ON` is `"0"`. Not a wrangler.toml
  var because production sits at Cloudflare's 128 text-binding cap ([[Infra]]); one more binding fails
  every deployment. To switch off: set `KITS_SHARE_ON=0` (free a binding first) or revert the default.
- **Client** `kits-share.js` `flagOn()` and the Home tile `eligible` (tile `defOn: true`): on unless the
  device has `smd_kits_share = "0"` or the URL has `?share=0`. Native users get it with the next build.
- Needs no new secret: `FOLLOWCARE_PHI_KEY` and `FIREBASE_SERVICE_ACCOUNT` were already set.
- In a kit, the card sits after the order sets, before investigations, so the kit's clinical content
  stays at the top.
Optional: deploy `firestore.rules` (the kx_* lines only document the catch-all deny).

## Tests
`test/kits-share.test.mjs` (server logic over an in-memory Firestore with the real commit guards:
verified-only, sealing, fixed pushes, status machine, expiry, rate limit, de-identification, publish
roles, immutable versions, per-doctor history, review export shape, router gate) and
`test/run-kits-share-ui.mjs` (full app in Chrome at 390px against a local server running the REAL
handlers; two doctors: hospital version, order set, history, referral, accept, handover read-back, case
room, publish v2, review sync, flag off). Shared fixture: `test/helpers/kits-share-world.mjs`.

## Not built / known limits
- No in-app badge count; pushes and the Colleagues list are the signal.
- `sendNativeToAll({uid})` scans all native tokens per send (as FollowCare does); fine at beta volume.
- The ICU `referrals.js` (client-side Firestore, flag off) is separate and unchanged.
- B4 audit dashboard and B5 case library were not ticked by the owner.

Deps: [[Specialty Kits]] · [[Clinical Documents]] · [[Review Desk]] · [[OPD Queue]] · [[Infra]].
