# capacitor-kardia-ble

Kardia SyncProbe BLE transport. Display is the GATT peripheral, Probe is the central.

Service `A91E0001-9D3C-4F5A-B2C4-1A2B3C4D5E6F` with characteristics:

- info `A91E0002-...` read: byte 0 protocol version (1), byte 1 displayPub length, then displayPub raw bytes, then the 16 sessionId bytes.
- down `A91E0003-...` notify and write without response: display to probe frames.
- up `A91E0004-...` notify and write without response: probe to display frames.

The JS adapter is `kardia-sync-ble.js` at the repository root. It registers a `ble` transport with `KARDIA_SYNC` when both exist. See `docs/kardia/syncprobe-ble.md` for the supported combinations and limits.
