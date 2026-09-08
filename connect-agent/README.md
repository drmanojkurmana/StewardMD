# StewardMD Connect Agent v1

Connect Agent is a local, consent-gated EMR discovery runner. It is designed for the first-doctor integration of a proprietary web EMR such as GHIS/KHIS.

## Design

1. Doctor explicitly confirms authorization in the terminal.
2. Doctor opens the hospital EMR in a browser session that they control.
3. The agent attaches to that browser through Chrome DevTools Protocol.
4. The doctor performs login and normal navigation themselves. The agent does **not** ask for, store, or transmit the password.
5. The agent observes only same-origin XHR/fetch requests and JSON response **schemas** needed to identify candidate interfaces.
6. Request cookies, Authorization headers, passwords, tokens, and response values are discarded.
7. The agent emits a local adapter draft (`adapter-spec.json`) containing endpoint shapes, operation candidates, and field/schema information.
8. A human StewardMD reviewer approves the adapter before it can become a production connector.

This first slice deliberately does not execute production EMR writes, replay captured requests, or upload PHI. It is a discovery and adapter-drafting tool.

## Run

Use a browser profile launched with remote debugging enabled, then run:

```bash
node connect-agent/agent.mjs --url https://example-hospital-emr.example
```

The browser must already be authenticated by the doctor. The agent refuses to inspect a different origin from the supplied URL.

## Output

The runner writes only a sanitized adapter specification. It never writes cookies, Authorization headers, passwords, or raw patient response bodies.

The next phase can turn the approved specification into a connector implementing StewardMD's existing Connect SDK contract.
