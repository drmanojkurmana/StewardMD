/* wardsynq/site/pages/stores.js - "General stores": a department's indents (raise, approve, issue, acknowledge,
 * back-order), store stock, the item master, store locations and consumption by department. Buildless ES5.
 *
 * One read (GET /ward/stores) feeds the page. null is loading and a failed read says so: an indent list that did
 * not load must never read as "no indents", and a stock table that did not load must never read as "no stock".
 * The server decides who may do what (functions/_wardsynq/stores.js); this page only offers the actions a role
 * could use, by capability.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  function when(iso) { return String(iso || "").slice(0, 16).replace("T", " "); }

  function stateWord(c, s) {
    var w = { "awaiting-approval": T(c, "site.stores.state.awaiting", "Waiting for approval"), rejected: T(c, "site.stores.state.rejected", "Rejected"),
      approved: T(c, "site.stores.state.approved", "Approved, not issued"), "part-issued": T(c, "site.stores.state.partIssued", "Part issued, rest back-ordered"),
      issued: T(c, "site.stores.state.issued", "Issued"), closed: T(c, "site.stores.state.closed", "Closed with items not issued") };
    return Object.prototype.hasOwnProperty.call(w, s) ? c.esc(w[s]) : EN(c, c.esc(s));
  }
  function categoryWord(c, s) {
    var w = { consumables: T(c, "site.stores.cat.consumables", "Consumables"), linen: T(c, "site.stores.cat.linen", "Linen"), stationery: T(c, "site.stores.cat.stationery", "Stationery"),
      housekeeping: T(c, "site.stores.cat.housekeeping", "Housekeeping"), "surgical-supplies": T(c, "site.stores.cat.surgical", "Surgical supplies"), other: T(c, "site.stores.cat.other", "Other") };
    return Object.prototype.hasOwnProperty.call(w, s) ? c.esc(w[s]) : EN(c, c.esc(s));
  }
  function failed(c, what) { return '<div class="msg err">' + TS(c, "site.stores.failedWhat", "Could not load {what}. Do not read this as none.", { what: what }) + "</div>"; }
  function loading(c) { return '<p><span class="spin"></span> ' + c.esc(T(c, "site.stores.loading", "Loading...")) + "</p>"; }

  /* Pack sizes, typed as compact text: "strip:10, box:10:strip" - unit:of[:packUnit], one per pack. Parsed
   * client-side; the server (stores.js saveStoreItem, stock.js validatePacks) is the one that actually checks it. */
  function parsePacksInput(s) {
    return String(s || "").split(",").map(function (part) {
      var bits = part.split(":").map(function (x) { return x.replace(/^\s+|\s+$/g, ""); });
      if (!bits[0]) return null;
      var p = { unit: bits[0], of: Number(bits[1]) };
      if (bits[2]) p.packUnit = bits[2];
      return p;
    }).filter(function (p) { return p; });
  }
  function formatPacksInput(packs) {
    return (packs || []).map(function (p) { return p.unit + ":" + p.of + (p.packUnit ? ":" + p.packUnit : ""); }).join(", ");
  }
  /* Every unit an item can be counted in for a picker: its own base unit first, then each declared pack. */
  function unitOptions(c, item, selected) {
    if (!item) return "";
    var units = [item.unit].concat((item.packs || []).map(function (p) { return p.unit; }));
    return units.map(function (u) { return '<option value="' + c.esc(u) + '"' + (u === selected ? " selected" : "") + ">" + EN(c, c.esc(u)) + "</option>"; }).join("");
  }
  function packsSummary(c, item) {
    if (!item.packs || !item.packs.length) return "";
    return EN(c, c.esc(item.packs.map(function (p) { return "1 " + p.unit + " = " + p.of + " " + (p.packUnit || item.unit); }).join("; ")));
  }

  /* The indents, with the actions each capability may take on each. */
  function indentsHtml(c, d, can) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, T(c, "site.stores.indentsPhrase", "indents"));
    var esc = c.esc;
    if (!d.indents.length) return "<p>" + esc(T(c, "site.stores.noIndents", "No indents yet.")) + "</p>";
    return d.indents.map(function (i) {
      var id = esc(i.indentId);
      var rows = i.lines.map(function (l) {
        var cell = "";
        if (can.approve && i.state === "awaiting-approval") cell = '<input type="number" min="0" max="' + esc(l.requested) + '" value="' + esc(l.requested) + '" data-line="approve" data-indent="' + id + '" data-code="' + esc(l.code) + '" aria-label="' + esc(T(c, "site.stores.approvedQty", "Approved quantity")) + '">';
        else if (can.manage && (i.state === "approved" || i.state === "part-issued") && l.backOrder > 0) cell = '<input type="number" min="0" max="' + esc(l.backOrder) + '" value="' + esc(l.backOrder) + '" data-line="issue" data-indent="' + id + '" data-code="' + esc(l.code) + '" aria-label="' + esc(T(c, "site.stores.issueQty", "Quantity to issue")) + '">';
        else if (can.request && l.issued > l.acknowledged) cell = '<input type="number" min="0" max="' + esc(l.issued - l.acknowledged) + '" value="' + esc(l.issued - l.acknowledged) + '" data-line="ack" data-indent="' + id + '" data-code="' + esc(l.code) + '" aria-label="' + esc(T(c, "site.stores.receivedQty", "Quantity received")) + '">';
        return "<tr><td>" + EN(c, esc(l.display)) + "</td><td>" + EN(c, esc(l.requested + " " + l.unit)) + "</td><td>" + esc(l.approved) + "</td><td>" + esc(l.issued) + "</td><td>" + (l.backOrder ? "<b>" + esc(l.backOrder) + "</b>" : "0") + "</td><td>" + esc(l.acknowledged) + (l.discrepancy ? " " + esc(T(c, "site.stores.shortBy", "(short by {n})", { n: l.discrepancy })) : "") + "</td><td>" + cell + "</td></tr>";
      }).join("");
      var acts = "";
      if (can.approve && i.state === "awaiting-approval") acts += '<label class="f"><span>' + esc(T(c, "site.stores.reasonIfRejecting", "Reason (needed to reject)")) + '</span><input id="stRej-' + id + '"></label>' +
        '<button class="btn" type="button" data-st="approve" data-id="' + id + '">' + esc(T(c, "site.stores.approve", "Approve")) + '</button> <button class="btn quiet" type="button" data-st="reject" data-id="' + id + '">' + esc(T(c, "site.stores.reject", "Reject")) + "</button>";
      if (can.manage && (i.state === "approved" || i.state === "part-issued")) acts += '<button class="btn" type="button" data-st="issue" data-id="' + id + '">' + esc(T(c, "site.stores.issue", "Issue")) + "</button>" +
        '<label class="f"><span>' + esc(T(c, "site.stores.supplier", "Supplier")) + '</span><input id="stVendor-' + id + '"></label><button class="btn quiet" type="button" data-st="order" data-id="' + id + '">' + esc(T(c, "site.stores.orderBackOrder", "Order what is still owed")) + "</button>" +
        '<label class="f"><span>' + esc(T(c, "site.stores.closeReason", "Reason for not issuing the rest")) + '</span><input id="stClose-' + id + '"></label><button class="btn quiet" type="button" data-st="close" data-id="' + id + '">' + esc(T(c, "site.stores.closeBackOrder", "Close back-order")) + "</button>";
      if (can.request && i.lines.some(function (l) { return l.issued > l.acknowledged; })) acts += '<button class="btn" type="button" data-st="ack" data-id="' + id + '">' + esc(T(c, "site.stores.acknowledge", "Confirm what arrived")) + "</button>";
      return '<div class="card"><h3>' + EN(c, esc(i.departmentName || i.departmentId)) + " · " + stateWord(c, i.state) + "</h3>" +
        "<p>" + esc(T(c, "site.stores.indentMeta", "From {from} to {to}, raised {at}", { from: i.fromLocation, to: i.toLocation, at: when(i.raisedAt) })) + (i.note ? " · " + EN(c, esc(i.note)) : "") +
        (i.decision && i.decision.reason ? " · " + EN(c, esc(i.decision.reason)) : "") + (i.closure ? " · " + EN(c, esc(i.closure.reason)) : "") + "</p>" +
        '<div class="tbl"><table><tr><th>' + esc(T(c, "site.stores.colItem", "Item")) + "</th><th>" + esc(T(c, "site.stores.colRequested", "Asked for")) + "</th><th>" + esc(T(c, "site.stores.colApproved", "Approved")) + "</th><th>" + esc(T(c, "site.stores.colIssued", "Issued")) + "</th><th>" + esc(T(c, "site.stores.colBackOrder", "Back-ordered")) + "</th><th>" + esc(T(c, "site.stores.colReceived", "Received")) + "</th><th></th></tr>" + rows + "</table></div>" +
        (acts ? '<div class="row">' + acts + "</div>" : "") + "</div>";
    }).join("");
  }

  function stockHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, T(c, "site.stores.stockPhrase", "stock"));
    var esc = c.esc;
    var warn = (d.truncatedWarning ? '<div class="msg note">' + EN(c, esc(d.truncatedWarning)) + "</div>" : "") +
      (d.negative && d.negative.length ? '<div class="msg err">' + esc(T(c, "site.stores.negativeLevels", "{n} level(s) are negative, which cannot be true: stock left that was never recorded as received.", { n: d.negative.length })) + "</div>" : "");
    var levels = d.levels.length ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.stores.colItem", "Item")) + "</th><th>" + esc(T(c, "site.stores.colStore", "Store")) + "</th><th>" + esc(T(c, "site.stores.colLevel", "Level")) + "</th><th></th></tr>" + d.levels.map(function (l) {
      return "<tr" + (l.belowReorder || l.impossible ? ' class="warn"' : "") + "><td>" + EN(c, esc(l.display)) + "</td><td>" + EN(c, esc(l.location || "")) + "</td><td>" + EN(c, esc(l.packDisplay || (l.level + " " + l.unit))) + "</td><td>" + (l.belowReorder ? esc(T(c, "site.stores.reorderNow", "At or below reorder level")) : "") + "</td></tr>";
    }).join("") + "</table></div>" : "<p>" + esc(T(c, "site.stores.noStock", "No stores movements recorded yet.")) + "</p>";
    var exp = d.expiring && d.expiring.length ? "<h3>" + esc(T(c, "site.stores.nearExpiry", "Near expiry")) + "</h3><ul>" + d.expiring.map(function (x) {
      return "<li>" + EN(c, esc(x.display + " · " + (x.location || "") + " · " + (x.batch || ""))) + " · " + (x.expired ? esc(T(c, "site.stores.expired", "expired")) : esc(T(c, "site.stores.daysLeft", "{n} days left", { n: x.daysRemaining }))) + "</li>";
    }).join("") + "</ul>" : "";
    return warn + levels + exp;
  }

  function masterHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, T(c, "site.stores.itemsPhrase", "the item master"));
    var esc = c.esc;
    return (d.items.length ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.stores.colCode", "Code")) + "</th><th>" + esc(T(c, "site.stores.colItem", "Item")) + "</th><th>" + esc(T(c, "site.stores.colCategory", "Category")) + "</th><th>" + esc(T(c, "site.stores.colUnit", "Unit")) + "</th><th>" + esc(T(c, "site.stores.colReorder", "Reorder at")) + "</th><th>" + esc(T(c, "site.stores.packsCol", "Packs")) + "</th></tr>" + d.items.map(function (i) {
      return "<tr><td>" + EN(c, esc(i.code)) + "</td><td>" + EN(c, esc(i.name)) + "</td><td>" + categoryWord(c, i.category) + "</td><td>" + EN(c, esc(i.unit)) + "</td><td>" + esc(i.reorderLevel == null ? "" : i.reorderLevel) + "</td><td>" + packsSummary(c, i) + "</td></tr>";
    }).join("") + "</table></div>" : "<p>" + esc(T(c, "site.stores.noItems", "No items in the stores item master yet.")) + "</p>") +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.stores.colCode", "Code")) + '</span><input id="stItCode"></label><label class="f"><span>' + esc(T(c, "site.stores.colItem", "Item")) + '</span><input id="stItName"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.colCategory", "Category")) + '</span><select id="stItCat">' + d.categories.map(function (k) { return '<option value="' + esc(k) + '">' + categoryWord(c, k) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.stores.colUnit", "Unit")) + '</span><input id="stItUnit"></label><label class="f"><span>' + esc(T(c, "site.stores.colReorder", "Reorder at")) + '</span><input id="stItReorder" type="number" min="0"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.packs", "Pack sizes (optional)")) + '</span><input id="stItPacks" placeholder="' + esc(T(c, "site.stores.packsPlaceholder", "strip:10, box:10:strip")) + '"></label>' +
      "<p class=\"note\">" + esc(T(c, "site.stores.packsHelp", "One pack per unit:count, or unit:count:packUnit for a pack of a pack. Example: strip:10, box:10:strip.")) + "</p>" +
      '<button class="btn" type="button" data-st="item">' + esc(T(c, "site.stores.saveItem", "Save item")) + "</button></div>";
  }

  function locationsHtml(c, d, depts) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, T(c, "site.stores.locationsPhrase", "store locations"));
    var esc = c.esc;
    return (d.locations.length ? "<ul>" + d.locations.map(function (l) {
      return "<li>" + EN(c, esc(l.code + " · " + l.name)) + " · " + (l.kind === "central" ? esc(T(c, "site.stores.central", "Central store")) : esc(T(c, "site.stores.subStoreOf", "Sub-store of")) + " " + EN(c, esc(l.departmentName || l.departmentId || ""))) + "</li>";
    }).join("") + "</ul>" : "<p>" + esc(T(c, "site.stores.noLocations", "No store locations yet. Add the central store first.")) + "</p>") +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.stores.colCode", "Code")) + '</span><input id="stLoCode"></label><label class="f"><span>' + esc(T(c, "site.stores.name", "Name")) + '</span><input id="stLoName"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.kind", "Kind")) + '</span><select id="stLoKind"><option value="central">' + esc(T(c, "site.stores.central", "Central store")) + '</option><option value="sub-store">' + esc(T(c, "site.stores.subStore", "Department sub-store")) + "</option></select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.stores.department", "Department")) + '</span><select id="stLoDept"><option value=""></option>' + (depts || []).filter(function (x) { return x.active !== false; }).map(function (x) { return '<option value="' + esc(x.id) + '">' + EN(c, esc(x.name)) + "</option>"; }).join("") + "</select></label>" +
      '<button class="btn" type="button" data-st="location">' + esc(T(c, "site.stores.saveLocation", "Save location")) + "</button></div>" +
      "<h3>" + esc(T(c, "site.stores.receiveHeading", "Receive, adjust or write off stock")) + '</h3><div class="row">' +
      '<label class="f"><span>' + esc(T(c, "site.stores.kind", "Kind")) + '</span><select id="stMvKind"><option value="receipt">' + esc(T(c, "site.stores.receipt", "Receipt")) + '</option><option value="adjustment">' + esc(T(c, "site.stores.adjustment", "Adjustment (+/-)")) + '</option><option value="wastage">' + esc(T(c, "site.stores.wastage", "Wastage")) + "</option></select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.stores.colItem", "Item")) + '</span><select id="stMvItem">' + d.items.map(function (i) { return '<option value="' + esc(i.code) + '">' + EN(c, esc(i.name + " (" + i.unit + ")")) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.stores.colStore", "Store")) + '</span><select id="stMvLoc">' + d.locations.map(function (l) { return '<option value="' + esc(l.code) + '">' + EN(c, esc(l.name)) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.stores.quantity", "Quantity")) + '</span><input id="stMvQty" type="number"></label>' +
      '<label class="f" id="stMvUnitWrap"><span>' + esc(T(c, "site.stores.colUnit", "Unit")) + '</span><select id="stMvUnit">' + unitOptions(c, d.items[0], d.items[0] && d.items[0].unit) + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.stores.batch", "Batch")) + '</span><input id="stMvBatch"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.expiry", "Expiry")) + '</span><input id="stMvExpiry" type="date"></label><label class="f"><span>' + esc(T(c, "site.stores.reason", "Reason (needed for adjustment or wastage)")) + '</span><input id="stMvReason"></label></div>' +
      '<div id="stMvTerms"><p class="note">' + esc(T(c, "site.stores.gst.receiptNote", "For a receipt: what it cost, from the supplier's invoice. A return to the supplier later reverses the GST from these.")) + '</p><div class="row">' +
      termsFieldsHtml(c, "stMvT", T(c, "site.stores.gst.unitPrice", "Price per unit before GST (Rs)")) + "</div></div>" +
      '<div class="row"><button class="btn" type="button" data-st="move">' + esc(T(c, "site.stores.record", "Record")) + "</button></div>";
  }

  function raiseHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, T(c, "site.stores.itemsPhrase", "the item master"));
    var esc = c.esc;
    var central = d.locations.filter(function (l) { return l.kind === "central" && l.active; });
    var subs = d.locations.filter(function (l) { return l.kind === "sub-store" && l.active; });
    if (!central.length || !subs.length || !d.items.length) return '<div class="msg note">' + esc(T(c, "site.stores.notSetUp", "Stores are not set up yet: the store keeper adds items, a central store and your department's sub-store first.")) + "</div>";
    var line = function (n) {
      return '<div class="row"><label class="f"><span>' + esc(T(c, "site.stores.colItem", "Item")) + '</span><select id="stRqItem' + n + '"><option value=""></option>' + d.items.filter(function (i) { return i.active; }).map(function (i) { return '<option value="' + esc(i.code) + '">' + EN(c, esc(i.name + " (" + i.unit + ")")) + "</option>"; }).join("") + "</select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.stores.quantity", "Quantity")) + '</span><input id="stRqQty' + n + '" type="number" min="1"></label></div>';
    };
    return '<div class="row"><label class="f"><span>' + esc(T(c, "site.stores.forStore", "For (department store)")) + '</span><select id="stRqTo">' + subs.map(function (l) { return '<option value="' + esc(l.code) + '" data-dept="' + esc(l.departmentId) + '">' + EN(c, esc(l.name + " (" + (l.departmentName || "") + ")")) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.stores.fromStore", "From")) + '</span><select id="stRqFrom">' + central.map(function (l) { return '<option value="' + esc(l.code) + '">' + EN(c, esc(l.name)) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.stores.note", "Note")) + '</span><input id="stRqNote"></label></div>' +
      line(0) + line(1) + line(2) + line(3) + line(4) +
      '<button class="btn" type="button" data-st="raise">' + esc(T(c, "site.stores.raise", "Raise indent")) + "</button>";
  }

  function consumptionHtml(c, r) {
    if (r == null) return "<p>" + c.esc(T(c, "site.stores.pickDates", "Choose dates and press Show. The last 30 days are shown when no dates are given.")) + "</p>";
    if (!r.ok) return failed(c, T(c, "site.stores.consumptionPhrase", "consumption"));
    var esc = c.esc;
    if (!r.rows.length) return "<p>" + esc(T(c, "site.stores.noConsumption", "Nothing was issued to a department in this period.")) + "</p>";
    return (r.truncatedWarning ? '<div class="msg note">' + EN(c, esc(r.truncatedWarning)) + "</div>" : "") +
      '<div class="tbl"><table><tr><th>' + esc(T(c, "site.stores.department", "Department")) + "</th><th>" + esc(T(c, "site.stores.colItem", "Item")) + "</th><th>" + esc(T(c, "site.stores.quantity", "Quantity")) + "</th></tr>" + r.rows.map(function (x) {
        return "<tr><td>" + EN(c, esc(x.departmentName)) + "</td><td>" + EN(c, esc(x.display)) + "</td><td>" + EN(c, esc(x.quantity + " " + x.unit)) + "</td></tr>";
      }).join("") + "</table></div>";
  }

  /* Purchase orders raised from indents, booked in at a store location through the purchasing route. Approval stays
   * on the Purchasing screen; an order that is not approved cannot be booked in and the server says so. */
  function ordersHtml(c, r, d) {
    if (r == null) return loading(c);
    if (!r.ok) return failed(c, T(c, "site.stores.ordersPhrase", "purchase orders"));
    var esc = c.esc;
    var mine = r.orders.filter(function (o) { return o.indentId; });
    if (!mine.length) return "<p>" + esc(T(c, "site.stores.noOrders", "No purchase orders raised from indents.")) + "</p>";
    var stateWords = { "awaiting-approval": T(c, "site.stores.po.awaiting", "Waiting for approval on the Purchasing screen"), rejected: T(c, "site.stores.po.rejected", "Rejected"),
      open: T(c, "site.stores.po.open", "Ordered, nothing in yet"), "part-received": T(c, "site.stores.po.part", "Part delivered"), received: T(c, "site.stores.po.received", "All in"), cancelled: T(c, "site.stores.po.cancelled", "Cancelled") };
    var all = d && d.ok ? d.locations : [];
    return mine.map(function (o) {
      var id = esc(o.purchaseOrderId);
      /* The store the order was raised for is offered first (R3-1); another can still be chosen if it arrives elsewhere. */
      var locs = all.map(function (l) { return '<option value="' + esc(l.code) + '"' + (o.location && l.code === o.location ? " selected" : "") + ">" + EN(c, esc(l.name)) + "</option>"; }).join("");
      var canBook = o.state === "open" || o.state === "part-received";
      return '<div class="card"><h3>' + EN(c, esc(o.vendor)) + " · " + (Object.prototype.hasOwnProperty.call(stateWords, o.state) ? esc(stateWords[o.state]) : EN(c, esc(o.state))) + "</h3>" +
        '<p class="note">' + (o.location ? esc(T(c, "site.stores.po.forStore", "For store {store}", { store: o.location })) : esc(T(c, "site.stores.po.noStore", "Names no store"))) + "</p>" +
        '<div class="tbl"><table><tr><th>' + esc(T(c, "site.stores.colItem", "Item")) + "</th><th>" + esc(T(c, "site.stores.colOrdered", "Ordered")) + "</th><th>" + esc(T(c, "site.stores.colReceived", "Received")) + "</th><th></th></tr>" + o.lines.map(function (l) {
          var matchItem = d && d.ok && d.items ? d.items.filter(function (i) { return i.code === l.item; })[0] : null;
          var unitSel = '<select id="stPoUnit-' + id + "-" + l.index + '" aria-label="' + esc(T(c, "site.stores.colUnit", "Unit")) + '">' + (matchItem ? unitOptions(c, matchItem, l.unit) : '<option value="' + esc(l.unit) + '">' + EN(c, esc(l.unit)) + "</option>") + "</select>";
          var book = canBook && l.outstanding > 0 ? '<input type="number" min="1" id="stPoQty-' + id + "-" + l.index + '" aria-label="' + esc(T(c, "site.stores.quantity", "Quantity")) + '"> ' + unitSel + ' <select id="stPoLoc-' + id + "-" + l.index + '" aria-label="' + esc(T(c, "site.stores.colStore", "Store")) + '">' + locs + "</select> " +
            /* The GST on the supplier's invoice; the price is the order line's. */
            '<input id="stPoGst-' + id + "-" + l.index + '" inputmode="decimal" size="4" aria-label="' + esc(T(c, "site.stores.gst.rate", "GST rate on the supplier's invoice (%)")) + '" placeholder="' + esc(T(c, "site.stores.gst.ratePh", "GST %")) + '"> ' +
            '<select id="stPoInter-' + id + "-" + l.index + '" aria-label="' + esc(T(c, "site.stores.gst.split", "GST charged as")) + '"><option value="false">' + esc(T(c, "site.stores.gst.intraShort", "CGST + SGST")) + '</option><option value="true">' + esc(T(c, "site.stores.gst.interShort", "IGST")) + "</option></select> " +
            '<button class="btn quiet" type="button" data-st="bookin" data-id="' + id + '" data-po-line="' + esc(l.index) + '" data-item="' + esc(l.item) + '">' + esc(T(c, "site.stores.bookIn", "Book in")) + "</button>" : "";
          return "<tr><td>" + EN(c, esc(l.item)) + "</td><td>" + EN(c, esc(l.ordered + " " + l.unit)) + "</td><td>" + esc(l.received) + "</td><td>" + book + "</td></tr>";
        }).join("") + "</table></div></div>";
    }).join("");
  }

  function rupees(paise) { return (Math.round(Number(paise) || 0) / 100).toFixed(2); }
  function day(iso) { return String(iso || "").slice(0, 10); }

  /* WHAT A RECEIPT COST (owner 2026-10-04, functions/_wardsynq/supplier-debit-note.js): the price before GST, the GST
   * rate on the supplier's invoice and whether it charged CGST + SGST or IGST. A return to the supplier reverses the input
   * tax credit from these. prefix names the inputs; pricePlaceholder says what a blank price means on this form. */
  function termsFieldsHtml(c, prefix, priceLabel) {
    var esc = c.esc;
    return '<label class="f"><span>' + esc(priceLabel) + '</span><input id="' + prefix + '-price" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.gst.rate", "GST rate on the supplier's invoice (%)")) + '</span><input id="' + prefix + '-gst" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.gst.split", "GST charged as")) + '</span><select id="' + prefix + '-split"><option value="false">' + esc(T(c, "site.stores.gst.intra", "CGST + SGST (same state)")) + '</option><option value="true">' + esc(T(c, "site.stores.gst.inter", "IGST (another state)")) + "</option></select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.stores.gst.invoiceNo", "Supplier's invoice number")) + '</span><input id="' + prefix + '-inv" autocomplete="off"></label>';
  }
  /* The purchase terms to send, or undefined when no GST rate was typed (a receipt still lands without them). Rupees on
   * screen, whole paise to the server; anything that is not a plain amount is sent as typed and refused there. */
  function termsFrom(prefix) {
    var rate = val(prefix + "-gst"); if (!rate) return undefined;
    var rs = val(prefix + "-price"), out = { gstRate: rate, interState: val(prefix + "-split") === "true", invoiceNo: val(prefix + "-inv") };
    if (rs) out.unitPricePaise = /^\d+(\.\d{1,2})?$/.test(rs) ? Math.round(Number(rs) * 100) : rs;
    return out;
  }
  /* "Rs 99.90 + CGST 5.99 + SGST 5.99 = Rs 111.88" for a debit note. */
  function noteAmounts(c, n) {
    var tax = n.interState ? T(c, "site.stores.dn.igst", "IGST {v}", { v: rupees(n.igstPaise) }) : T(c, "site.stores.dn.cgstSgst", "CGST {c} + SGST {s}", { c: rupees(n.cgstPaise), s: rupees(n.sgstPaise) });
    return c.esc(T(c, "site.stores.dn.amounts", "Rs {value} + {tax} = Rs {total}", { value: rupees(n.taxablePaise), tax: tax, total: rupees(n.totalPaise) }));
  }

  /* The supplier debit note register (GET /ward/supplier-debit-notes): every note in the dates chosen, with the totals the
   * accountant reverses input tax credit by. null: not asked yet. */
  function registerHtml(c, r) {
    var esc = c.esc;
    if (r == null) return "<p>" + esc(T(c, "site.stores.dn.pressShow", "Choose the dates and press Show.")) + "</p>";
    if (r === "loading") return loading(c);
    if (!r.ok) return '<div class="msg err">' + TS(c, "site.stores.dn.failed", "The register could not be read. Do not read this as no debit notes.") + (r.detail ? " " + EN(c, esc(r.detail)) : "") + "</div>";
    if (!r.rows.length) return "<p>" + esc(T(c, "site.stores.dn.none", "No debit notes in these dates.")) + "</p>";
    var t = r.totals, num = function (p) { return '<td class="num">' + esc(rupees(p)) + "</td>"; };
    return '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.stores.sc.date", "Date")) + "</th><th>" + esc(T(c, "site.stores.dn.number", "Debit note")) + "</th><th>" + esc(T(c, "site.stores.supplier", "Supplier")) + "</th><th>" +
      esc(T(c, "site.stores.colItem", "Item")) + "</th><th>" + esc(T(c, "site.stores.dn.original", "Original invoice")) + '</th><th class="num">' + esc(T(c, "site.stores.dn.value", "Value (Rs)")) + '</th><th class="num">CGST</th><th class="num">SGST</th><th class="num">IGST</th><th class="num">' +
      esc(T(c, "site.stores.dn.total", "Total (Rs)")) + "</th></tr></thead><tbody>" + r.rows.map(function (x) {
        return "<tr><td>" + esc(x.date) + '</td><td class="mono">' + esc(x.number) + "</td><td>" + EN(c, esc(x.supplier)) + (x.supplierGstin ? ' <span class="mono">' + esc(x.supplierGstin) + "</span>" : "") + "</td><td>" + EN(c, esc(x.display + " · " + x.quantity + " " + x.unit)) + "</td><td>" +
          EN(c, esc(x.originalInvoiceNo || "")) + "</td>" + num(x.taxablePaise) + num(x.cgstPaise) + num(x.sgstPaise) + num(x.igstPaise) + num(x.totalPaise) + "</tr>";
      }).join("") + '</tbody><tfoot><tr><th colspan="5">' + esc(T(c, "site.stores.dn.totals", "{n} notes: input tax credit to reverse", { n: t.count })) + "</th>" + num(t.taxablePaise) + num(t.cgstPaise) + num(t.sgstPaise) + num(t.igstPaise) + num(t.totalPaise) + "</tr></tfoot></table></div>";
  }

  /* Returns to suppliers (GET /ward/supply-chain): a return is always against the receipt the stock came in on, so the
   * server can refuse more than arrived. A controlled drug also needs a witness and the Controller of Drugs approval. */
  function returnsHtml(c, sc) {
    if (sc == null) return loading(c);
    if (!sc.ok) return failed(c, T(c, "site.stores.sc.receiptsPhrase", "receipts and returns"));
    var esc = c.esc;
    var form = sc.receipts.length ? '<div class="row"><label class="f"><span>' + esc(T(c, "site.stores.sc.receipt", "Receipt")) + '</span><select id="stRtReceipt">' + sc.receipts.map(function (r) {
      return '<option value="' + esc(r.receiptId) + '" data-priced="' + (r.priced ? "1" : "0") + '">' + EN(c, esc(r.display + " · " + day(r.at) + " · " + (r.supplier || ""))) + " · " + esc(T(c, "site.stores.sc.left", "{n} {unit} can go back", { n: r.remaining, unit: r.unit })) +
        (r.priced ? "" : " · " + esc(T(c, "site.stores.sc.unpriced", "no price on record"))) + "</option>";
    }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.stores.quantity", "Quantity")) + '</span><input id="stRtQty" type="number" min="0"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.sc.returnReason", "Why it is going back")) + '</span><input id="stRtReason"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.sc.creditNote", "Supplier's credit note number (optional)")) + '</span><input id="stRtNote"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.sc.supplierIfMissing", "Supplier, if the receipt names none")) + '</span><input id="stRtSupplier"></label></div>' +
      /* Shown only for a receipt with no price on record: the debit note cannot be worked out without them. */
      '<div id="stRtTerms"' + (sc.receipts[0].priced ? " hidden" : "") + '><p class="note">' + esc(T(c, "site.stores.sc.termsNeeded", "This receipt has no price on record. A debit note goes with every return, so give the price and GST from the supplier's invoice.")) + '</p><div class="row">' +
      termsFieldsHtml(c, "stRtT", T(c, "site.stores.sc.termsPrice", "Price per unit as received, before GST (Rs)")) + "</div></div>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.stores.sc.witness", "Witness staff ID (controlled drugs only)")) + '</span><input id="stRtWitness" autocomplete="off"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.sc.controllerRef", "Controller of Drugs approval reference (controlled drugs only)")) + '</span><input id="stRtCdRef"></label>' +
      '<button class="btn" type="button" data-st="return">' + esc(T(c, "site.stores.sc.returnBtn", "Return to supplier")) + "</button></div>"
      : "<p>" + esc(T(c, "site.stores.sc.noReceipts", "No receipt has stock left that could go back to a supplier.")) + "</p>";
    var list = sc.returns.length ? "<h3>" + esc(T(c, "site.stores.sc.recentReturns", "Recent returns")) + '</h3><div class="tbl"><table><tr><th>' + esc(T(c, "site.stores.colItem", "Item")) + "</th><th>" + esc(T(c, "site.stores.quantity", "Quantity")) + "</th><th>" + esc(T(c, "site.stores.supplier", "Supplier")) + "</th><th>" + esc(T(c, "site.stores.sc.returnReason", "Why it is going back")) + "</th><th>" + esc(T(c, "site.stores.dn.number", "Debit note")) + "</th><th>" + esc(T(c, "site.stores.sc.date", "Date")) + "</th></tr>" + sc.returns.map(function (r) {
      var dn = r.debitNote ? '<span class="mono">' + esc(r.debitNote.number) + "</span><br>" + noteAmounts(c, r.debitNote) : esc(T(c, "site.stores.dn.beforeNotes", "Returned before debit notes"));
      return "<tr><td>" + EN(c, esc(r.display)) + "</td><td>" + EN(c, esc(r.quantity + " " + r.unit)) + "</td><td>" + EN(c, esc(r.supplier)) + "</td><td>" + EN(c, esc(r.reason)) + (r.debitNoteNo ? " · " + EN(c, esc(r.debitNoteNo)) : "") + "</td><td>" + dn + "</td><td>" + esc(day(r.at)) + "</td></tr>";
    }).join("") + "</table></div>" : "";
    var reg = "<h3>" + esc(T(c, "site.stores.dn.registerHeading", "Debit note register")) + '</h3><div class="row"><label class="f"><span>' + esc(T(c, "site.stores.from", "From date")) + '</span><input id="stDnFrom" type="date"></label><label class="f"><span>' +
      esc(T(c, "site.stores.to", "To date")) + '</span><input id="stDnTo" type="date"></label><button class="btn quiet" type="button" data-st="dnRegister">' + esc(T(c, "site.stores.show", "Show")) + '</button></div><div id="stDnReg" aria-live="polite">' + registerHtml(c, null) + "</div>";
    return (sc.truncatedWarning ? '<div class="msg note">' + EN(c, esc(sc.truncatedWarning)) + "</div>" : "") + form + list + reg;
  }

  /* Rate contracts per supplier. A price above an in-date contract is shown to the approver; it never changes an order. */
  function contractsHtml(c, sc) {
    if (sc == null) return loading(c);
    if (!sc.ok) return failed(c, T(c, "site.stores.sc.contractsPhrase", "rate contracts"));
    var esc = c.esc, rows = [];
    sc.vendors.forEach(function (v) { v.contracts.forEach(function (k) { rows.push({ v: v, k: k }); }); });
    var table = rows.length ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.stores.supplier", "Supplier")) + "</th><th>" + esc(T(c, "site.stores.colItem", "Item")) + "</th><th>" + esc(T(c, "site.stores.colUnit", "Unit")) + "</th><th>" + esc(T(c, "site.stores.sc.priceRs", "Price per unit before GST (Rs)")) + "</th><th>" + esc(T(c, "site.stores.sc.valid", "Valid")) + "</th></tr>" + rows.map(function (x) {
      return "<tr" + (x.k.inDate ? "" : ' class="warn"') + "><td>" + EN(c, esc(x.v.name)) + "</td><td>" + EN(c, esc(x.k.item)) + "</td><td>" + EN(c, esc(x.k.unit)) + "</td><td>" + esc(rupees(x.k.pricePaise)) + "</td><td>" +
        esc(T(c, "site.stores.sc.validRange", "{from} to {to}", { from: x.k.validFrom, to: x.k.validTo })) + (x.k.inDate ? "" : " · " + esc(T(c, "site.stores.sc.notInDate", "not in date"))) + "</td></tr>";
    }).join("") + "</table></div>" : "<p>" + esc(T(c, "site.stores.sc.noContracts", "No rate contracts recorded.")) + "</p>";
    return table + '<div class="row"><label class="f"><span>' + esc(T(c, "site.stores.supplier", "Supplier")) + '</span><input id="stRcVendor"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.colItem", "Item")) + '</span><input id="stRcItem"></label><label class="f"><span>' + esc(T(c, "site.stores.colUnit", "Unit")) + '</span><input id="stRcUnit"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.sc.priceRs", "Price per unit before GST (Rs)")) + '</span><input id="stRcPrice" inputmode="decimal"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.sc.validFrom", "Valid from")) + '</span><input id="stRcFrom" type="date"></label><label class="f"><span>' + esc(T(c, "site.stores.sc.validTo", "Valid to")) + '</span><input id="stRcTo" type="date"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.sc.changeReason", "Reason (needed to change a contract)")) + '</span><input id="stRcReason"></label>' +
      '<button class="btn" type="button" data-st="contract">' + esc(T(c, "site.stores.sc.saveContract", "Save contract")) + "</button></div>";
  }

  /* Reorder drafts (GET /ward/reorder-suggestions): the arithmetic is on screen, a refusal is named, and nothing is ordered. */
  function reorderHtml(c, r) {
    var esc = c.esc;
    if (r == null) return "<p>" + esc(T(c, "site.stores.sc.pressShow", "Press Show to work out drafts from recorded use.")) + "</p>";
    if (r === "loading") return loading(c);
    if (!r.ok) return '<div class="msg err">' + TS(c, "site.stores.sc.reorderFailed", "Reorder drafts could not be worked out. Do not read this as nothing to order.") + (r.detail ? " " + EN(c, esc(r.detail)) : "") + "</div>";
    if (!r.configured) return '<div class="msg note">' + esc(T(c, "site.stores.sc.notConfigured", "Reorder suggestions are not configured. An administrator sets the window, lead time, safety days and minimum days of data first.")) + "</div>";
    var p = r.policy;
    var head = '<p class="note">' + esc(T(c, "site.stores.sc.methodStores", "Average daily use (dispensed, issued out or consumed) over the last {window} days, or the days of data if fewer, times {lead} lead days plus {safety} safety days, minus the level and what is on order, rounded up. An order that names a store counts only against that store; one that names no store counts against each store holding the item, and is marked. A draft: nothing is ordered until somebody raises a purchase order.", { window: p.windowDays, lead: p.leadTimeDays, safety: p.safetyDays })) + "</p>";
    if (!r.suggestions.length) return head + "<p>" + esc(T(c, "site.stores.sc.noItemsToSuggest", "No stock is recorded to work from.")) + "</p>";
    return head + '<div class="tbl"><table><tr><th>' + esc(T(c, "site.stores.colItem", "Item")) + "</th><th>" + esc(T(c, "site.stores.colStore", "Store")) + "</th><th>" + esc(T(c, "site.stores.colLevel", "Level")) + "</th><th>" + esc(T(c, "site.stores.sc.onOrder", "On order")) + "</th><th>" + esc(T(c, "site.stores.sc.used", "Used")) + "</th><th>" + esc(T(c, "site.stores.sc.perDay", "Per day")) + "</th><th>" + esc(T(c, "site.stores.sc.draft", "Draft to order")) + "</th></tr>" + r.suggestions.map(function (s) {
      var out = s.refused === "insufficient_data" ? esc(T(c, "site.stores.sc.refusedData", "No draft: {days} days of data, {min} needed", { days: s.daysOfData, min: s.minDataDays }))
        : s.refused === "no_usage" ? esc(T(c, "site.stores.sc.refusedUsage", "No draft: no use recorded in the last {n} days", { n: s.windowDays }))
        : s.refused === "negative_level" ? esc(T(c, "site.stores.sc.refusedNegative", "No draft: the level is negative, which cannot be true"))
        : s.refused ? esc(T(c, "site.stores.sc.refusedOther", "No draft"))
        : "<b>" + EN(c, esc(s.suggestedQuantity + " " + s.unit)) + "</b>";
      return "<tr><td>" + EN(c, esc(s.display)) + "</td><td>" + EN(c, esc(s.location || "")) + "</td><td>" + EN(c, esc(s.level + " " + s.unit)) + "</td><td>" + esc(s.onOrder) + (s.onOrderNoStore ? " " + esc(T(c, "site.stores.sc.onOrderNoStore", "({n} on orders naming no store)", { n: s.onOrderNoStore })) : "") + "</td><td>" +
        esc(T(c, "site.stores.sc.usedIn", "{used} in {days} days", { used: s.used, days: s.daysUsed || s.windowDays })) + "</td><td>" + (s.refused ? "" : esc(s.avgDaily)) + "</td><td>" + out + "</td></tr>";
    }).join("") + "</table></div>";
  }

  /* The hospital's reorder numbers (GET/POST /org/reorder-policy), for an administrator. No default: blank is not configured. */
  function policyHtml(c, r) {
    if (r == null) return loading(c);
    if (!r.ok) return failed(c, T(c, "site.stores.sc.policyPhrase", "the reorder settings"));
    var esc = c.esc, p = r.policy || {};
    var field = function (id, label, v) { return '<label class="f"><span>' + esc(label) + '</span><input id="' + id + '" type="number" min="0" value="' + esc(v == null ? "" : v) + '"></label>'; };
    return (r.policy ? "" : '<div class="msg note">' + esc(T(c, "site.stores.sc.policyUnset", "Not configured: no reorder drafts are made until all four numbers are saved.")) + "</div>") +
      '<div class="row">' + field("stRpWindow", T(c, "site.stores.sc.windowDays", "Window (days of use to average)"), p.windowDays) + field("stRpLead", T(c, "site.stores.sc.leadDays", "Lead time (days)"), p.leadTimeDays) +
      field("stRpSafety", T(c, "site.stores.sc.safetyDays", "Safety stock (days)"), p.safetyDays) + field("stRpMin", T(c, "site.stores.sc.minDays", "Minimum days of data"), p.minDataDays) +
      '<label class="f"><span>' + esc(T(c, "site.stores.sc.policyReason", "Reason for the change")) + '</span><input id="stRpReason"></label>' +
      '<button class="btn" type="button" data-st="policy">' + esc(T(c, "site.stores.sc.savePolicy", "Save reorder settings")) + "</button></div>";
  }

  WSQ.page("stores", { render: function (c) {
    var el = c.el, org = c.state.orgId, esc = c.esc;
    var can = { request: c.can("dept.request"), approve: c.can("stores.indent.approve"), manage: c.can("stores.manage") };
    can.buy = can.manage || c.can("order.dispense");
    can.admin = c.can("staff.admin");
    var q = "?orgId=" + encodeURIComponent(org);
    el.innerHTML = '<div class="title"><h1>' + esc(T(c, "site.stores.heading", "General stores")) + "</h1></div><div id=\"stMsg\"></div>" +
      '<div class="card"><h2>' + esc(T(c, "site.stores.indentsCard", "Indents")) + '</h2><div id="stIndents"></div></div>' +
      (can.request ? '<div class="card"><h2>' + esc(T(c, "site.stores.raiseCard", "Raise an indent")) + '</h2><div id="stRaise"></div></div>' : "") +
      (can.manage || can.approve ? '<div class="card"><h2>' + esc(T(c, "site.stores.stockCard", "Store stock")) + '</h2><div id="stStock"></div></div>' +
        '<div class="card"><h2>' + esc(T(c, "site.stores.consumptionCard", "Consumption by department")) + '</h2><div class="row"><label class="f"><span>' + esc(T(c, "site.stores.from", "From date")) + '</span><input id="stCnFrom" type="date"></label><label class="f"><span>' + esc(T(c, "site.stores.to", "To date")) + '</span><input id="stCnTo" type="date"></label><button class="btn quiet" type="button" data-st="consumption">' + esc(T(c, "site.stores.show", "Show")) + '</button></div><div id="stCons">' + consumptionHtml(c, null) + "</div></div>" : "") +
      (can.manage ? '<div class="card"><h2>' + esc(T(c, "site.stores.ordersCard", "Orders for back-ordered items")) + '</h2><div id="stOrders"></div></div>' : "") +
      (can.manage ? '<div class="card"><h2>' + esc(T(c, "site.stores.itemsCard", "Item master")) + '</h2><div id="stItems"></div></div><div class="card"><h2>' + esc(T(c, "site.stores.locationsCard", "Store locations and movements")) + '</h2><div id="stLocs"></div></div>' : "") +
      (can.buy ? '<div class="card"><h2>' + esc(T(c, "site.stores.sc.returnsCard", "Returns to suppliers")) + '</h2><div id="stReturns"></div></div>' +
        '<div class="card"><h2>' + esc(T(c, "site.stores.sc.contractsCard", "Rate contracts")) + '</h2><div id="stContracts"></div></div>' +
        '<div class="card"><h2>' + esc(T(c, "site.stores.sc.reorderCard", "Reorder drafts from recorded use")) + '</h2><button class="btn quiet" type="button" data-st="reorder">' + esc(T(c, "site.stores.show", "Show")) + '</button><div id="stReorder">' + reorderHtml(c, null) + "</div></div>" : "") +
      (can.admin ? '<div class="card"><h2>' + esc(T(c, "site.stores.sc.policyCard", "Reorder settings")) + '</h2><div id="stPolicy"></div></div>' : "");
    var set = function (id, html) { var e = document.getElementById(id); if (e) e.innerHTML = html; };
    var data = null, depts = [], orders = null, sc = null, policy = null;
    var refreshMvUnit = function () {
      var sel = document.getElementById("stMvItem"), u = document.getElementById("stMvUnit");
      if (!sel || !u || !data || !data.ok) return;
      var item = data.items.filter(function (i) { return i.code === sel.value; })[0];
      u.innerHTML = unitOptions(c, item, item && item.unit);
    };
    var paint = function () {
      set("stIndents", indentsHtml(c, data, can)); set("stRaise", raiseHtml(c, data)); set("stStock", stockHtml(c, data));
      set("stItems", masterHtml(c, data)); set("stLocs", locationsHtml(c, data, depts)); set("stOrders", ordersHtml(c, orders, data));
      set("stReturns", returnsHtml(c, sc)); set("stContracts", contractsHtml(c, sc)); set("stPolicy", policyHtml(c, policy));
      refreshMvUnit();
    };
    var load = function () {
      data = null; orders = null; sc = null; policy = null; paint();
      c.api("/ward/stores" + q).then(function (r) { data = r && r.ok ? r : { ok: false }; paint(); }, function () { data = { ok: false }; paint(); });
      if (can.manage) c.api("/ward/purchase-orders" + q).then(function (r) { orders = r && r.ok ? r : { ok: false }; paint(); }, function () { orders = { ok: false }; paint(); });
      if (can.buy) c.api("/ward/supply-chain" + q).then(function (r) { sc = r && r.ok ? r : { ok: false }; paint(); }, function () { sc = { ok: false }; paint(); });
      if (can.admin) c.api("/org/reorder-policy" + q).then(function (r) { policy = r && r.ok ? r : { ok: false }; paint(); }, function () { policy = { ok: false }; paint(); });
    };
    if (can.manage) c.api("/org" + q).then(function (r) { depts = (r && r.ok && r.departments) || []; paint(); });
    load();
    var msg = function (r) {
      set("stMsg", '<div class="msg err">' + TS(c, "site.stores.notSaved", "Not saved.") + " " + EN(c, esc((r && (r.detail || r.message || r.error)) || T(c, "site.stores.noResponse", "No response from the server."))) + "</div>");
    };
    var after = function (okText) { return function (r) { if (!r || !r.ok) { msg(r); return; } set("stMsg", ""); c.toast(okText); load(); }; };
    /* ONE KEY PER SUBMISSION (BILL-03). A write whose answer was lost is sent again with the same idempotencyKey, so the
     * server replays it instead of issuing or receiving twice; the key is dropped only once the server says ok. A press
     * while the same form is still in flight sends nothing. */
    var keys = {}, busy = {};
    var send = function (slot, path, body, okText) {
      if (busy[slot]) return;
      busy[slot] = true;
      body.idempotencyKey = keys[slot] || (keys[slot] = "st-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));
      return c.api(path, body).then(function (r) { busy[slot] = false; if (r && r.ok) delete keys[slot]; after(okText)(r); }, function () { busy[slot] = false; msg(null); });
    };
    var lines = function (kind, id, field) {
      var out = [], inputs = el.querySelectorAll ? el.querySelectorAll('[data-line="' + kind + '"]') : [];
      for (var i = 0; i < inputs.length; i++) if (inputs[i].getAttribute("data-indent") === id) { var o = { code: inputs[i].getAttribute("data-code") }; o[field] = String(inputs[i].value || "").trim(); out.push(o); }
      return out;
    };
    var termsVisible = function (id) { var e = document.getElementById(id); return !!e && !e.hidden; };
    el.onchange = function (ev) {
      if (ev.target && ev.target.id === "stMvItem") refreshMvUnit();
      /* The cost fields belong to a receipt only; a priced receipt needs none to go back. */
      if (ev.target && ev.target.id === "stMvKind") { var mt = document.getElementById("stMvTerms"); if (mt) mt.hidden = ev.target.value !== "receipt"; }
      if (ev.target && ev.target.id === "stRtReceipt") { var o = ev.target.options[ev.target.selectedIndex], rt = document.getElementById("stRtTerms"); if (rt) rt.hidden = !o || o.getAttribute("data-priced") === "1"; }
    };
    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-st]"); if (!b) return;
      var act = b.getAttribute("data-st"), id = b.getAttribute("data-id");
      if (act === "approve") return send("decide:" + id, "/ward/indent-decide", { orgId: org, indentId: id, decision: "approved", lines: lines("approve", id, "approvedQuantity") }, T(c, "site.stores.approved", "Approved."));
      if (act === "reject") return send("decide:" + id, "/ward/indent-decide", { orgId: org, indentId: id, decision: "rejected", reason: val("stRej-" + id) }, T(c, "site.stores.rejected", "Rejected."));
      if (act === "issue") return send("issue:" + id, "/ward/indent-issue", { orgId: org, indentId: id, lines: lines("issue", id, "quantity") }, T(c, "site.stores.issued", "Issued."));
      if (act === "ack") return send("ack:" + id, "/ward/indent-acknowledge", { orgId: org, indentId: id, lines: lines("ack", id, "received") }, T(c, "site.stores.acknowledged", "Receipt confirmed."));
      if (act === "order") return send("order:" + id, "/ward/store-purchase-order", { orgId: org, indentId: id, vendor: val("stVendor-" + id) }, T(c, "site.stores.ordered", "Purchase order raised. It still needs approval on the Purchasing screen."));
      if (act === "close") return send("close:" + id, "/ward/indent-close", { orgId: org, indentId: id, reason: val("stClose-" + id) }, T(c, "site.stores.closed", "Back-order closed."));
      if (act === "item") return send("item", "/ward/store-item", { orgId: org, code: val("stItCode"), name: val("stItName"), category: val("stItCat"), unit: val("stItUnit"), reorderLevel: val("stItReorder"), packs: parsePacksInput(val("stItPacks")) }, T(c, "site.stores.itemSaved", "Item saved."));
      if (act === "location") return send("location", "/ward/store-location", { orgId: org, code: val("stLoCode"), name: val("stLoName"), kind: val("stLoKind"), departmentId: val("stLoDept") }, T(c, "site.stores.locationSaved", "Location saved."));
      if (act === "move") return send("move", "/ward/store-move", { orgId: org, kind: val("stMvKind"), code: val("stMvItem"), location: val("stMvLoc"), quantity: val("stMvQty"), unit: val("stMvUnit"), batch: val("stMvBatch"), expiry: val("stMvExpiry"), reason: val("stMvReason"), purchase: val("stMvKind") === "receipt" ? termsFrom("stMvT") : undefined }, T(c, "site.stores.recorded", "Recorded."));
      if (act === "raise") {
        var to = document.getElementById("stRqTo"), opt = to && to.options ? to.options[to.selectedIndex] : null, rl = [];
        for (var n = 0; n < 5; n++) { if (val("stRqItem" + n)) rl.push({ code: val("stRqItem" + n), quantity: val("stRqQty" + n) }); }
        return send("raise", "/ward/indent", { orgId: org, departmentId: opt ? opt.getAttribute("data-dept") : "", toLocation: val("stRqTo"), fromLocation: val("stRqFrom"), note: val("stRqNote"), lines: rl }, T(c, "site.stores.raised", "Indent raised. It waits for your department's in-charge to approve it."));
      }
      if (act === "bookin") {
        var ln = b.getAttribute("data-po-line");
        return send("bookin:" + id + ":" + ln, "/ward/goods-receive", { orgId: org, purchaseOrderId: id, line: ln, item: b.getAttribute("data-item"), unit: val("stPoUnit-" + id + "-" + ln), quantity: val("stPoQty-" + id + "-" + ln), location: val("stPoLoc-" + id + "-" + ln),
          purchase: val("stPoGst-" + id + "-" + ln) ? { gstRate: val("stPoGst-" + id + "-" + ln), interState: val("stPoInter-" + id + "-" + ln) === "true" } : undefined }, T(c, "site.stores.bookedIn", "Booked in."));
      }
      if (act === "return") return send("return", "/ward/supplier-return", { orgId: org, receiptId: val("stRtReceipt"), quantity: val("stRtQty"), reason: val("stRtReason"), debitNoteNo: val("stRtNote"), supplier: val("stRtSupplier"), witnessId: val("stRtWitness"), controllerApprovalRef: val("stRtCdRef"),
        purchase: termsVisible("stRtTerms") ? termsFrom("stRtT") : undefined }, T(c, "site.stores.sc.returned", "Returned to the supplier."));
      if (act === "dnRegister") {
        set("stDnReg", registerHtml(c, "loading"));
        return c.api("/ward/supplier-debit-notes" + q + "&from=" + encodeURIComponent(val("stDnFrom")) + "&to=" + encodeURIComponent(val("stDnTo"))).then(function (r) { set("stDnReg", registerHtml(c, r || { ok: false })); }, function () { set("stDnReg", registerHtml(c, { ok: false })); });
      }
      if (act === "contract") {
        /* Rupees on screen, whole paise to the server; anything that is not a plain amount is sent as typed and refused there. */
        var rs = val("stRcPrice"), paise = /^\d+(\.\d{1,2})?$/.test(rs) ? Math.round(Number(rs) * 100) : rs;
        return send("contract", "/ward/rate-contract", { orgId: org, vendor: val("stRcVendor"), item: val("stRcItem"), unit: val("stRcUnit"), pricePaise: paise, validFrom: val("stRcFrom"), validTo: val("stRcTo"), reason: val("stRcReason") }, T(c, "site.stores.sc.contractSaved", "Contract saved."));
      }
      if (act === "policy") return send("policy", "/org/reorder-policy", { orgId: org, policy: { windowDays: val("stRpWindow"), leadTimeDays: val("stRpLead"), safetyDays: val("stRpSafety"), minDataDays: val("stRpMin") }, reason: val("stRpReason") }, T(c, "site.stores.sc.policySaved", "Reorder settings saved."));
      if (act === "reorder") {
        set("stReorder", reorderHtml(c, "loading"));
        return c.api("/ward/reorder-suggestions" + q).then(function (r) { set("stReorder", reorderHtml(c, r || { ok: false })); }, function () { set("stReorder", reorderHtml(c, { ok: false })); });
      }
      if (act === "consumption") {
        set("stCons", loading(c));
        return c.api("/ward/store-consumption" + q + "&from=" + encodeURIComponent(val("stCnFrom")) + "&to=" + encodeURIComponent(val("stCnTo"))).then(function (r) { set("stCons", consumptionHtml(c, r || { ok: false })); }, function () { set("stCons", consumptionHtml(c, { ok: false })); });
      }
    };
  } });

  WSQ._stores = { indentsHtml: indentsHtml, stockHtml: stockHtml, masterHtml: masterHtml, locationsHtml: locationsHtml, raiseHtml: raiseHtml, consumptionHtml: consumptionHtml, ordersHtml: ordersHtml,
    returnsHtml: returnsHtml, registerHtml: registerHtml, contractsHtml: contractsHtml, reorderHtml: reorderHtml, policyHtml: policyHtml };
})();
