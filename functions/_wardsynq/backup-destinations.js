/* functions/_wardsynq/backup-destinations.js - where a scheduled backup is written, as a connector.
 *
 * A BACKUP DESTINATION IS A CONNECTOR (connectors.js), kind "backup", one per hospital. The hospital picks
 * the adapter on Admin > Integrations, and its credentials are sealed exactly like every other connector's.
 * Nothing here is a Cloudflare binding: both adapters speak the S3 API through object-store.js.
 *
 *   s3        The hospital's OWN S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, Wasabi). Needs nothing
 *             from the platform owner: the hospital enters endpoint, bucket and keys, and backups start on
 *             the next hourly run.
 *   platform  The deployment's own object store (the DOC_S3_* settings object-store.js reads). Those are
 *             unset until the platform owner chooses the storage bucket (owner decision S1), and until then
 *             this adapter reports "not configured" rather than pretending to store anything.
 *
 * SFTP IS NOT OFFERED. A Worker has no SSH client, and adding one is a new dependency; a hospital with only
 * an SFTP server can put an S3-compatible gateway (MinIO) in front of it.
 *
 * Request shape: S3 PutObject / GetObject / DeleteObject, path-style, AWS Signature Version 4 with a signed
 * payload hash (https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html,
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html). The signer is pinned to
 * AWS's published example in test/wardsynq-object-store.test.mjs.
 */

import { s3Store, storeFromEnv } from "./object-store.js";
import { checkDestination } from "./webhooks.js";

const str = (v) => (v == null ? "" : String(v).trim());
const DEFAULT_KEEP_DAILY = 30, DEFAULT_KEEP_MONTHLY = 12;
const PROBE_KEY = "wardsynq-backups/_connection-test";

const RETENTION_SETTINGS = [
  { key: "keepDaily", label: `Daily backups to keep (1 to 365, blank for ${DEFAULT_KEEP_DAILY})`, type: "text" },
  { key: "keepMonthly", label: `Monthly backups to keep (0 to 120, blank for ${DEFAULT_KEEP_MONTHLY})`, type: "text" },
];

/** PURE. The retention a connector's settings ask for, defaults filled. null fields mean invalid. */
function retentionOf(settings) {
  const s = settings || {};
  const whole = (v, lo, hi, dflt) => {
    if (str(v) === "") return dflt;
    const n = Number(v);
    return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
  };
  return { keepDaily: whole(s.keepDaily, 1, 365, DEFAULT_KEEP_DAILY), keepMonthly: whole(s.keepMonthly, 0, 120, DEFAULT_KEEP_MONTHLY) };
}

function retentionRefusal(settings) {
  const r = retentionOf(settings);
  if (r.keepDaily === null) return "Daily backups to keep must be a whole number from 1 to 365, or blank.";
  if (r.keepMonthly === null) return "Monthly backups to keep must be a whole number from 0 to 120, or blank.";
  return null;
}

function validateS3(settings, secrets) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(str(settings.bucket))) return "Bucket must be a valid bucket name (3 to 63 lower-case letters, digits, dots or hyphens).";
  if (!secrets.accessKeyId || !secrets.secretAccessKey) return "Enter the access key ID and the secret access key.";
  return retentionRefusal(settings);
}

/** PURE apart from the adapter it builds. { store } or { error, message }. */
async function s3Adapter(settings, secrets, deps) {
  if (!secrets.accessKeyId || !secrets.secretAccessKey) return { error: "credentials_unreadable", message: "The backup destination's credentials could not be opened on this server." };
  const dest = await checkDestination(str(settings.endpoint), deps || {});
  if (!dest.ok) return { error: "destination_refused", message: `The backup endpoint was not contacted: ${dest.detail}.` };
  return { store: s3Store({ endpoint: str(settings.endpoint), bucket: str(settings.bucket), region: str(settings.region) || "auto", accessKeyId: secrets.accessKeyId, secretAccessKey: secrets.secretAccessKey }, deps && deps.fetchImpl) };
}

/** A write, a read-back and a delete of a small object. Never returns a provider's body. */
async function roundTrip(store) {
  const bytes = new TextEncoder().encode(`wardsynq backup destination test ${new Date().toISOString()}`);
  try {
    await store.put(PROBE_KEY, bytes, "text/plain");
    const back = await store.get(PROBE_KEY);
    if (!back || back.bytes.length !== bytes.length) return { ok: false, reason: "read-back-mismatch", detail: "A test file was written but did not read back the same." };
    await store.delete(PROBE_KEY);
  } catch (e) {
    const status = Number(e && e.status) || null;
    return { ok: false, reason: status === 401 || status === 403 ? "auth-refused" : "http-error", httpStatus: status, detail: `The bucket refused the ${str(e && e.op) || "test"} step${status ? ` (${status})` : ""}.` };
  }
  return { ok: true, reason: null, detail: "A test file was written, read back and deleted." };
}

const BACKUP_KIND = Object.freeze({
  label: "Backup destination", singleton: true,
  help: "Where the scheduled daily backup of this hospital's record is written. Backups are encrypted before they leave the server; the key stays with WardSynQ, so the bucket holder cannot read them and a restore goes through WardSynQ support.",
  providers: {
    s3: {
      label: "Your own S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, Wasabi)",
      settings: [
        { key: "endpoint", label: "Endpoint URL (https://s3.<region>.amazonaws.com or https://<account>.r2.cloudflarestorage.com)", type: "url", required: true },
        { key: "bucket", label: "Bucket", type: "text", required: true },
        { key: "region", label: "Region (blank for auto)", type: "text" },
        ...RETENTION_SETTINGS,
      ],
      secrets: [{ key: "accessKeyId", label: "Access key ID" }, { key: "secretAccessKey", label: "Secret access key" }],
      validate: validateS3,
      async test(deps) {
        const a = await s3Adapter(deps.settings || {}, deps.secrets || {}, deps);
        return a.error ? { ok: false, reason: a.error, detail: a.message } : roundTrip(a.store);
      },
    },
    platform: {
      label: "WardSynQ platform storage (set up by the platform owner)",
      settings: [...RETENTION_SETTINGS],
      secrets: [],
      validate: (settings) => retentionRefusal(settings),
    },
  },
});

/**
 * The adapter behind a hospital's backup connector.
 * connector: the connector record or null; secrets: its opened secrets; deps: { env, fetchImpl?, resolveHost? }
 * -> { store, provider, retention } | { error, message, setup }   setup: "hospital" | "platform"
 */
async function destinationFor(connector, secrets, deps) {
  if (!connector) return { error: "no_destination", setup: "hospital", message: "Backups are not running: no backup destination is configured. A hospital administrator adds one under Admin Center, Integrations, Backup destination." };
  const retention = retentionOf(connector.settings);
  if (retention.keepDaily === null || retention.keepMonthly === null) return { error: "bad_retention", setup: "hospital", message: `Backups are not running: ${retentionRefusal(connector.settings)}` };
  if (connector.provider === "s3") {
    const a = await s3Adapter(connector.settings || {}, secrets || {}, deps);
    return a.error ? { ...a, setup: "hospital" } : { store: a.store, provider: "s3", retention };
  }
  if (connector.provider === "platform") {
    const store = storeFromEnv(deps && deps.env);
    if (!store) return { error: "platform_not_configured", setup: "platform", message: "Backups are not running: this hospital chose WardSynQ platform storage, and the platform owner has not yet chosen the storage bucket (owner decision S1). Choose your own S3-compatible bucket under Admin Center, Integrations, Backup destination to start now." };
    return { store, provider: "platform", retention };
  }
  return { error: "unknown_provider", setup: "hospital", message: "Backups are not running: the backup destination names an adapter this server does not have." };
}

export { BACKUP_KIND, DEFAULT_KEEP_DAILY, DEFAULT_KEEP_MONTHLY, retentionOf, destinationFor, roundTrip };
