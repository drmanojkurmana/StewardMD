# Deploy the FollowCare voice bot to Oracle Cloud Always Free

Runs the Pipecat voice bot 24/7 for **$0** (Oracle Always Free VM + Cloudflare Tunnel on your existing
`stewardmd.in`). Same code/latency as local - this just keeps it always on.

## Owner steps (one-time)

1. **Create the VM** (Oracle Cloud console → Compute → Instances → Create):
   - Shape: **VM.Standard.A1.Flex** (Ampere ARM, Always Free) - 2 OCPU / 12 GB is plenty.
   - Image: **Ubuntu 22.04 or 24.04**. Region: **Mumbai or Hyderabad** (low latency to patients).
   - Add your SSH public key. Note the public IP.

2. **Get the code onto the VM** (SSH in, then):
   ```
   git clone -b feat/followcare-voice <your-repo-url> stewardmd
   cd stewardmd/voice-service
   bash pcbot/deploy/setup.sh
   ```
   `setup.sh` installs Python 3.12, the deps, cloudflared, and a `stewardmd-voice` systemd service.

3. **Secrets:** `nano pcbot/deploy/voice.env` (fill Sarvam/Plivo/FollowCare token), then
   `sudo systemctl restart stewardmd-voice`.

4. **Stable HTTPS URL** (Cloudflare Tunnel - no open ports, auto-TLS):
   ```
   cloudflared tunnel login                 # pick stewardmd.in
   cloudflared tunnel create stewardmd-voice
   cloudflared tunnel route dns stewardmd-voice voice.stewardmd.in
   sudo nano /etc/cloudflared/config.yml     # see setup.sh output for the exact 6 lines
   sudo cloudflared service install && sudo systemctl restart cloudflared
   ```
   Then set `VOICE_PUBLIC_BASE=https://voice.stewardmd.in` in `voice.env` and restart the service.

5. **Verify:** `curl https://voice.stewardmd.in/health` → `{"ok":true,...}`.
   Point FollowCare's originate at `https://voice.stewardmd.in` and place a test call.

## Operate
- Logs: `sudo journalctl -u stewardmd-voice -f`
- Restart: `sudo systemctl restart stewardmd-voice`
- Update code: `git pull` then `sudo systemctl restart stewardmd-voice`
- Finished call transcripts: `pcbot/calls/<callId>.json` on the VM.

## Cost
VM is Always Free (forever). Cloudflare Tunnel is free. You still pay only per-call Plivo minutes + Sarvam
usage - no fixed monthly cost, no GPU.
