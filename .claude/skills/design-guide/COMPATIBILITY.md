# AIDE Compatibility

Compatibility claims are reported at three separate levels:

| AIDE | Installed | Synchronized to v0.1.1 | Provider-backed invocation | Evidence date |
|---|:---:|:---:|---|---|
| Codex 0.137.0 | Yes | Yes | Passed: returned `DESIGN_GUIDE_SMOKE version=0.1.0` | 2026-08-07 |
| Claude Code 2.1.212 | Yes | Yes | Passed: returned `DESIGN_GUIDE_SMOKE version=0.1.0` | 2026-08-07 |
| Qwen Code 0.15.3 | Yes | Yes | Blocked by provider: HTTP 403 model access denied | 2026-08-07 |
| Cursor 3.2.21 | Yes | Yes | Blocked locally: Cursor Agent authentication required | 2026-08-07 |

“Blocked” is not treated as an `design-guide` failure because the installed public digest is identical and the provider request did not reach skill execution. Re-run the explicit smoke test after fixing provider access:

```bash
python3 scripts/smoke-aides.py \
  --aide qwen \
  --aide cursor \
  --yes-consume-provider-quota
```

The opt-in flag is required because real invocation can consume external model quota. The command is read-only by construction, but provider authentication and billing remain the operator's responsibility.
