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
      return "<tr" + (l.belowReorder || l.impossible ? ' class="warn"' : "") + "><td>" + EN(c, esc(l.display)) + "</td><td>" + EN(c, esc(l.location || "")) + "</td><td>" + EN(c, esc(l.level + " " + l.unit)) + "</td><td>" + (l.belowReorder ? esc(T(c, "site.stores.reorderNow", "At or below reorder level")) : "") + "</td></tr>";
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
    return (d.items.length ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.stores.colCode", "Code")) + "</th><th>" + esc(T(c, "site.stores.colItem", "Item")) + "</th><th>" + esc(T(c, "site.stores.colCategory", "Category")) + "</th><th>" + esc(T(c, "site.stores.colUnit", "Unit")) + "</th><th>" + esc(T(c, "site.stores.colReorder", "Reorder at")) + "</th></tr>" + d.items.map(function (i) {
      return "<tr><td>" + EN(c, esc(i.code)) + "</td><td>" + EN(c, esc(i.name)) + "</td><td>" + categoryWord(c, i.category) + "</td><td>" + EN(c, esc(i.unit)) + "</td><td>" + esc(i.reorderLevel == null ? "" : i.reorderLevel) + "</td></tr>";
    }).join("") + "</table></div>" : "<p>" + esc(T(c, "site.stores.noItems", "No items in the stores item master yet.")) + "</p>") +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.stores.colCode", "Code")) + '</span><input id="stItCode"></label><label class="f"><span>' + esc(T(c, "site.stores.colItem", "Item")) + '</span><input id="stItName"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.colCategory", "Category")) + '</span><select id="stItCat">' + d.categories.map(function (k) { return '<option value="' + esc(k) + '">' + categoryWord(c, k) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.stores.colUnit", "Unit")) + '</span><input id="stItUnit"></label><label class="f"><span>' + esc(T(c, "site.stores.colReorder", "Reorder at")) + '</span><input id="stItReorder" type="number" min="0"></label>' +
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
      '<label class="f"><span>' + esc(T(c, "site.stores.quantity", "Quantity")) + '</span><input id="stMvQty" type="number"></label><label class="f"><span>' + esc(T(c, "site.stores.batch", "Batch")) + '</span><input id="stMvBatch"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.stores.expiry", "Expiry")) + '</span><input id="stMvExpiry" type="date"></label><label class="f"><span>' + esc(T(c, "site.stores.reason", "Reason (needed for adjustment or wastage)")) + '</span><input id="stMvReason"></label>' +
      '<button class="btn" type="button" data-st="move">' + esc(T(c, "site.stores.record", "Record")) + "</button></div>";
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
    var locs = (d && d.ok ? d.locations : []).map(function (l) { return '<option value="' + esc(l.code) + '">' + EN(c, esc(l.name)) + "</option>"; }).join("");
    return mine.map(function (o) {
      var id = esc(o.purchaseOrderId);
      var canBook = o.state === "open" || o.state === "part-received";
      return '<div class="card"><h3>' + EN(c, esc(o.vendor)) + " · " + (Object.prototype.hasOwnProperty.call(stateWords, o.state) ? esc(stateWords[o.state]) : EN(c, esc(o.state))) + "</h3>" +
        '<div class="tbl"><table><tr><th>' + esc(T(c, "site.stores.colItem", "Item")) + "</th><th>" + esc(T(c, "site.stores.colOrdered", "Ordered")) + "</th><th>" + esc(T(c, "site.stores.colReceived", "Received")) + "</th><th></th></tr>" + o.lines.map(function (l) {
          var book = canBook && l.outstanding > 0 ? '<input type="number" min="1" id="stPoQty-' + id + "-" + l.index + '" aria-label="' + esc(T(c, "site.stores.quantity", "Quantity")) + '"> <select id="stPoLoc-' + id + "-" + l.index + '" aria-label="' + esc(T(c, "site.stores.colStore", "Store")) + '">' + locs + "</select> " +
            '<button class="btn quiet" type="button" data-st="bookin" data-id="' + id + '" data-po-line="' + esc(l.index) + '" data-item="' + esc(l.item) + '" data-unit="' + esc(l.unit) + '">' + esc(T(c, "site.stores.bookIn", "Book in")) + "</button>" : "";
          return "<tr><td>" + EN(c, esc(l.item)) + "</td><td>" + EN(c, esc(l.ordered + " " + l.unit)) + "</td><td>" + esc(l.received) + "</td><td>" + book + "</td></tr>";
        }).join("") + "</table></div></div>";
    }).join("");
  }

  WSQ.page("stores", { render: function (c) {
    var el = c.el, org = c.state.orgId, esc = c.esc;
    var can = { request: c.can("dept.request"), approve: c.can("stores.indent.approve"), manage: c.can("stores.manage") };
    var q = "?orgId=" + encodeURIComponent(org);
    el.innerHTML = '<div class="title"><h1>' + esc(T(c, "site.stores.heading", "General stores")) + "</h1></div><div id=\"stMsg\"></div>" +
      '<div class="card"><h2>' + esc(T(c, "site.stores.indentsCard", "Indents")) + '</h2><div id="stIndents"></div></div>' +
      (can.request ? '<div class="card"><h2>' + esc(T(c, "site.stores.raiseCard", "Raise an indent")) + '</h2><div id="stRaise"></div></div>' : "") +
      (can.manage || can.approve ? '<div class="card"><h2>' + esc(T(c, "site.stores.stockCard", "Store stock")) + '</h2><div id="stStock"></div></div>' +
        '<div class="card"><h2>' + esc(T(c, "site.stores.consumptionCard", "Consumption by department")) + '</h2><div class="row"><label class="f"><span>' + esc(T(c, "site.stores.from", "From date")) + '</span><input id="stCnFrom" type="date"></label><label class="f"><span>' + esc(T(c, "site.stores.to", "To date")) + '</span><input id="stCnTo" type="date"></label><button class="btn quiet" type="button" data-st="consumption">' + esc(T(c, "site.stores.show", "Show")) + '</button></div><div id="stCons">' + consumptionHtml(c, null) + "</div></div>" : "") +
      (can.manage ? '<div class="card"><h2>' + esc(T(c, "site.stores.ordersCard", "Orders for back-ordered items")) + '</h2><div id="stOrders"></div></div>' : "") +
      (can.manage ? '<div class="card"><h2>' + esc(T(c, "site.stores.itemsCard", "Item master")) + '</h2><div id="stItems"></div></div><div class="card"><h2>' + esc(T(c, "site.stores.locationsCard", "Store locations and movements")) + '</h2><div id="stLocs"></div></div>' : "");
    var set = function (id, html) { var e = document.getElementById(id); if (e) e.innerHTML = html; };
    var data = null, depts = [], orders = null;
    var paint = function () {
      set("stIndents", indentsHtml(c, data, can)); set("stRaise", raiseHtml(c, data)); set("stStock", stockHtml(c, data));
      set("stItems", masterHtml(c, data)); set("stLocs", locationsHtml(c, data, depts)); set("stOrders", ordersHtml(c, orders, data));
    };
    var load = function () {
      data = null; orders = null; paint();
      c.api("/ward/stores" + q).then(function (r) { data = r && r.ok ? r : { ok: false }; paint(); }, function () { data = { ok: false }; paint(); });
      if (can.manage) c.api("/ward/purchase-orders" + q).then(function (r) { orders = r && r.ok ? r : { ok: false }; paint(); }, function () { orders = { ok: false }; paint(); });
    };
    if (can.manage) c.api("/org" + q).then(function (r) { depts = (r && r.ok && r.departments) || []; paint(); });
    load();
    var msg = function (r) {
      set("stMsg", '<div class="msg err">' + TS(c, "site.stores.notSaved", "Not saved.") + " " + EN(c, esc((r && (r.detail || r.message || r.error)) || T(c, "site.stores.noResponse", "No response from the server."))) + "</div>");
    };
    var after = function (okText) { return function (r) { if (!r || !r.ok) { msg(r); return; } set("stMsg", ""); c.toast(okText); load(); }; };
    var lines = function (kind, id, field) {
      var out = [], inputs = el.querySelectorAll ? el.querySelectorAll('[data-line="' + kind + '"]') : [];
      for (var i = 0; i < inputs.length; i++) if (inputs[i].getAttribute("data-indent") === id) { var o = { code: inputs[i].getAttribute("data-code") }; o[field] = String(inputs[i].value || "").trim(); out.push(o); }
      return out;
    };
    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-st]"); if (!b) return;
      var act = b.getAttribute("data-st"), id = b.getAttribute("data-id");
      if (act === "approve") return c.api("/ward/indent-decide", { orgId: org, indentId: id, decision: "approved", lines: lines("approve", id, "approvedQuantity") }).then(after(T(c, "site.stores.approved", "Approved.")));
      if (act === "reject") return c.api("/ward/indent-decide", { orgId: org, indentId: id, decision: "rejected", reason: val("stRej-" + id) }).then(after(T(c, "site.stores.rejected", "Rejected.")));
      if (act === "issue") return c.api("/ward/indent-issue", { orgId: org, indentId: id, lines: lines("issue", id, "quantity") }).then(after(T(c, "site.stores.issued", "Issued.")));
      if (act === "ack") return c.api("/ward/indent-acknowledge", { orgId: org, indentId: id, lines: lines("ack", id, "received") }).then(after(T(c, "site.stores.acknowledged", "Receipt confirmed.")));
      if (act === "order") return c.api("/ward/store-purchase-order", { orgId: org, indentId: id, vendor: val("stVendor-" + id) }).then(after(T(c, "site.stores.ordered", "Purchase order raised. It still needs approval on the Purchasing screen.")));
      if (act === "close") return c.api("/ward/indent-close", { orgId: org, indentId: id, reason: val("stClose-" + id) }).then(after(T(c, "site.stores.closed", "Back-order closed.")));
      if (act === "item") return c.api("/ward/store-item", { orgId: org, code: val("stItCode"), name: val("stItName"), category: val("stItCat"), unit: val("stItUnit"), reorderLevel: val("stItReorder") }).then(after(T(c, "site.stores.itemSaved", "Item saved.")));
      if (act === "location") return c.api("/ward/store-location", { orgId: org, code: val("stLoCode"), name: val("stLoName"), kind: val("stLoKind"), departmentId: val("stLoDept") }).then(after(T(c, "site.stores.locationSaved", "Location saved.")));
      if (act === "move") return c.api("/ward/store-move", { orgId: org, kind: val("stMvKind"), code: val("stMvItem"), location: val("stMvLoc"), quantity: val("stMvQty"), batch: val("stMvBatch"), expiry: val("stMvExpiry"), reason: val("stMvReason") }).then(after(T(c, "site.stores.recorded", "Recorded.")));
      if (act === "raise") {
        var to = document.getElementById("stRqTo"), opt = to && to.options ? to.options[to.selectedIndex] : null, rl = [];
        for (var n = 0; n < 5; n++) { if (val("stRqItem" + n)) rl.push({ code: val("stRqItem" + n), quantity: val("stRqQty" + n) }); }
        return c.api("/ward/indent", { orgId: org, departmentId: opt ? opt.getAttribute("data-dept") : "", toLocation: val("stRqTo"), fromLocation: val("stRqFrom"), note: val("stRqNote"), lines: rl }).then(after(T(c, "site.stores.raised", "Indent raised. It waits for your department's in-charge to approve it.")));
      }
      if (act === "bookin") {
        var ln = b.getAttribute("data-po-line");
        return c.api("/ward/goods-receive", { orgId: org, purchaseOrderId: id, line: ln, item: b.getAttribute("data-item"), unit: b.getAttribute("data-unit"), quantity: val("stPoQty-" + id + "-" + ln), location: val("stPoLoc-" + id + "-" + ln) }).then(after(T(c, "site.stores.bookedIn", "Booked in.")));
      }
      if (act === "consumption") {
        set("stCons", loading(c));
        return c.api("/ward/store-consumption" + q + "&from=" + encodeURIComponent(val("stCnFrom")) + "&to=" + encodeURIComponent(val("stCnTo"))).then(function (r) { set("stCons", consumptionHtml(c, r || { ok: false })); }, function () { set("stCons", consumptionHtml(c, { ok: false })); });
      }
    };
  } });

  WSQ._stores = { indentsHtml: indentsHtml, stockHtml: stockHtml, masterHtml: masterHtml, locationsHtml: locationsHtml, raiseHtml: raiseHtml, consumptionHtml: consumptionHtml, ordersHtml: ordersHtml };
})();
