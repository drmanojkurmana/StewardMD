// functions/_connect/secrets.js — envelope encryption for per-tenant connector credentials (spec §7, C10)
export class SecretsUnavailable extends Error {}
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesToB64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));

export function makeSecrets(env) {
  async function key() {
    const raw = env && env.CONNECT_MASTER_KEY;
    if (!raw) throw new SecretsUnavailable("CONNECT_MASTER_KEY missing");
    let bytes; try { bytes = b64ToBytes(raw); } catch { throw new SecretsUnavailable("master key not base64"); }
    if (bytes.length !== 32) throw new SecretsUnavailable("master key must be 32 bytes");
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  return {
    get: async (name) => (env && env[name] != null ? String(env[name]) : null),
    seal: async (plaintext) => {
      const k = await key(); const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(plaintext));
      const out = new Uint8Array(iv.length + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), iv.length);
      return bytesToB64(out);
    },
    open: async (ciphertext) => {
      const k = await key(); const all = b64ToBytes(ciphertext);
      const iv = all.slice(0, 12), ct = all.slice(12);
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, ct);
      return new TextDecoder().decode(pt);
    },
  };
}
