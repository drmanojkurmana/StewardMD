# StewardMD Connect Agent + Controller

## Discovery

```bash
node connect-agent/agent.mjs --url https://example-hospital-emr.example
```

The doctor controls the browser and performs login/navigation. Discovery is origin-restricted and emits only sanitized endpoint/schema metadata.

## Human approval controller

After discovery:

```bash
node connect-agent/controller.mjs adapter-spec.json adapter-approval.json
```

The controller displays the discovered origin, candidate count, capabilities, write status, credential-storage status, raw-response status and SHA-256 digest of the exact specification.

Type `APPROVE` to approve the adapter **for conformance testing only**. Any other response creates a rejection record.

The resulting `adapter-approval.json` is deliberately not a production activation token. It records the immutable spec digest and the approval state while keeping `productionEnabled: false`.

## Approval gates

1. **Discovery consent** — doctor confirms they are authorized to inspect the EMR.
2. **Adapter review** — operator reviews the sanitized specification.
3. **Conformance** — generated adapter must pass StewardMD Connect SDK conformance tests.
4. **Production enablement** — separate explicit operational gate; never implied by adapter approval.
5. **Writes** — remain disabled by default and are not enabled by discovery/approval.

This separation prevents an observed EMR interface from becoming executable production integration merely because it was discovered or approved for testing.
