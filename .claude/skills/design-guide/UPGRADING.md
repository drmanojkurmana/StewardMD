# Upgrading design-guide

## Git Clone Installations

Update the source without rewriting local history:

```bash
git pull --ff-only
```

Then synchronize and verify all supported AIDE mirrors:

```bash
bash scripts/sync-aide.sh
python3 scripts/design-guide-doctor.py --strict
```

## Non-Git Installations

Replace the public source folder with the new release, then run its `sync-aide.sh`. Do not copy `.codex/`, `.design-guide/profile.md`, caches, or repository metadata into the source package.

## Compatibility

- Public preferences remain separate in `.design-guide/profile.md` and `~/.design-guide/preferences.md`.
- `design-guide.json` is the machine-readable release manifest.
- The `schemaVersion` field governs manifest compatibility; the design contract schema has its own version.
- Restart or reload the AIDE when it caches skill discovery.

## Troubleshooting

Run:

```bash
python3 scripts/design-guide-doctor.py --json
```

`MISSING` means the target has no installed `SKILL.md`. `STALE` means its public digest or required files differ from the source. Re-run `sync-aide.sh` from the intended source checkout.
