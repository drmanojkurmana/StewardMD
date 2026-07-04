# Firestore rules — emulator test

Validates the `sharedCases` security guarantees against the repo's `../../firestore.rules`.

## Guarantees checked
1. Unauthenticated users **cannot list/enumerate** all shared cases (`allow list: if false`).
2. A public link opens **only the exact case** by code (`get`), and only while unexpired.
3. A user **cannot edit/delete/overwrite** another doctor's share; ownership is immutable.
4. Expiry is enforced on read + capped at ~32 days on create; owners can **revoke** (delete).
5. Private cases (`users/{uid}/cases`) are isolated per user.

## Run (needs a real JDK + the Firebase CLI)
```bash
cd test/firestore-rules
npm init -y >/dev/null && npm i @firebase/rules-unit-testing@^3 firebase@^10
printf '{ "emulators": { "firestore": { "port": 8080 }, "ui": { "enabled": false } } }' > firebase.json
firebase emulators:exec --only firestore --project demo-stewardmd "node rules.test.mjs"
```
Exit code **0** = every guarantee holds. The printed table shows, per operation, the desired
behaviour (`want`) vs what the rules actually allow (`got`).

> Not run in this repo's CI: the environment where these rules were written had **no Java
> Runtime**, so the emulator could not start. Run locally (e.g. `brew install temurin`).

## Deploy (separate, manual — a PR to `firestore.rules` does NOT deploy)
```bash
firebase deploy --only firestore:rules
```
