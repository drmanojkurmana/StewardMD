import pathlib
p = pathlib.Path("functions/api/queue/[[path]].js")
s = p.read_text()

old = 'import { requestVerification, recordVerification, listVerifications } from "../../_wardsynq/verification.js";'
new = old + '\nimport { raisePurchaseOrder, receiveGoods, listPurchaseOrders } from "../../_wardsynq/purchasing.js";'
assert s.count(old) == 1
s = s.replace(old, new)

old2 = '        "approval-request": CAPS.EMR_VITALS, approvals: CAPS.EMR_VIEW,'
new2 = '''        /* Purchasing. Ordering stock and booking it in is the pharmacy's own work, so it sits on
         * the capability the pharmacy already holds for dispensing rather than on any clinical one -
         * a doctor has no business raising a purchase order, and a storekeeper has none prescribing.
         * WHO APPROVES the order is a separate question answered by the approval chain, which will
         * not let whoever raised it also grant it. */
        "purchase-orders": CAPS.ORDER_DISPENSE, "purchase-order": CAPS.ORDER_DISPENSE,
        "goods-receive": CAPS.ORDER_DISPENSE,
''' + old2
assert s.count(old2) == 1
s = s.replace(old2, new2)

anchor = '      if (sub === "approval-request" && method === "POST") {'
routes = '''      if (sub === "purchase-order" && method === "POST") {
        const r = await raisePurchaseOrder(request, env, { ...deps, vendor: body.vendor, lines: body.lines, note: body.note, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "goods-receive" && method === "POST") {
        const r = await receiveGoods(request, env, { ...deps, purchaseOrderId: body.purchaseOrderId, item: body.item, quantity: body.quantity, unit: body.unit, line: body.line, batch: body.batch, expiry: body.expiry, location: body.location, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "purchase-orders" && method === "GET") {
        const r = await listPurchaseOrders(request, env, { ...deps });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
'''
assert s.count(anchor) == 1
s = s.replace(anchor, routes + anchor)

p.write_text(s)
print("routes added")
