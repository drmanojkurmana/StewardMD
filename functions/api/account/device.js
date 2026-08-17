/* /api/account/device — anti-sharing device lock.
 *   POST { deviceId }   -> register/refresh this device; returns { devices, evicted, limit, enforced }
 *   POST { remove:<id> } -> sign a device out of the account
 *   GET                 -> { devices, limit, enforced }
 * The current device is always kept (newest wins); evicted (older) devices detect they're gone on their
 * next call and sign out. INERT unless DEVICE_LOCK_ON="1" (off => a large limit, nothing is evicted).
 */
import { identify } from "../../_fbauth.js";
import { getEntitlement, deviceLimit } from "../../_entitlements.js";
import { registerDevice, listDevices, removeDevice, deviceLockOn } from "../../_devices.js";
import { usageKv } from "../../_usage.js";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const rawUid = (id) => (typeof id === "string" && id.indexOf("fb:") === 0 ? id.slice(3) : id);

export async function onRequest(context) {
  const { request, env } = context;
  const uid = rawUid(await identify(request, env));
  if (!uid) return json({ error: "signin-required" }, 401);
  const store = usageKv(env);
  let role = null;
  try { const e = await getEntitlement(env, uid); role = e && e.role; } catch (e) {}
  const enforced = deviceLockOn(env);

  if (request.method === "GET") {
    return json({ enforced, limit: deviceLimit(env, role), devices: await listDevices(store, uid) });
  }
  let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
  if (body.remove) return json(Object.assign({ enforced }, await removeDevice(store, uid, String(body.remove))));
  const deviceId = String(body.deviceId || "").trim();
  if (!deviceId) return json({ error: "deviceId-required" }, 400);
  // Off => pass a large limit so nothing is evicted (record-only); on => enforce the role limit.
  const r = await registerDevice(env, store, uid, deviceId, role, Date.now(), enforced ? undefined : 9999);
  return json({ ok: true, enforced, limit: r.limit, devices: r.devices, evicted: enforced ? r.evicted : [] });
}
