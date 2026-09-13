/* wardsynq/site/pages/accounts.js - "Accounts": the hospital's books. Trial balance and account ledger for
 * billing.view; posting a journal, reversing an entry and closing a month for the admin (the server decides).
 * Amounts are typed in rupees and sent as whole paise. A failed or partial read never looks balanced. */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  function rupees(p) { return (Number(p || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function toPaise(s) { var t = String(s || "").replace(/,/g, "").trim(); if (!/^\d+(\.\d{1,2})?$/.test(t)) return null; var parts = t.split("."); return Number(parts[0]) * 100 + Number(((parts[1] || "") + "00").slice(0, 2)); }

  function tbHtml(c, r) {
    if (r == null) return "<p>Choose a date and press Show.</p>";
    if (!r.ok) return '<div class="msg err">' + c.esc(r.message || r.error || "Could not load the trial balance.") + " Do not read this as balanced.</div>";
    var rows = r.accounts.filter(function (a) { return a.debit || a.credit; });
    return (r.partial ? '<div class="msg note">Some months have too many entries to read in full; these totals may be incomplete.</div>' : "") +
      '<div class="msg ' + (r.balanced ? "ok" : "err") + '">' + (r.balanced ? "Balanced" : "NOT balanced") + ": debits " + rupees(r.totalDebit) + ", credits " + rupees(r.totalCredit) + " (from " + c.esc(r.financialYearFrom) + ")</div>" +
      (rows.length ? '<div class="tbl"><table><tr><th>Code</th><th>Account</th><th>Debits</th><th>Credits</th><th>Balance</th></tr>' + rows.map(function (a) {
        return "<tr><td>" + c.esc(a.code) + "</td><td>" + c.esc(a.name) + "</td><td>" + rupees(a.debit) + "</td><td>" + rupees(a.credit) + "</td><td>" + rupees(a.balance) + "</td></tr>";
      }).join("") + "</table></div>" : "<p>No entries in this financial year yet.</p>");
  }
  function ledgerHtml(c, r) {
    if (r == null) return "";
    if (!r.ok) return '<div class="msg err">' + c.esc(r.message || r.error || "Could not load the ledger.") + " Do not read this as no movement.</div>";
    if (!r.lines.length) return "<p>No entries for this account in these dates.</p>";
    return '<div class="tbl"><table><tr><th>Date</th><th>Memo</th><th>Debit</th><th>Credit</th><th></th></tr>' + r.lines.map(function (l) {
      return "<tr><td>" + c.esc(l.date) + "</td><td>" + c.esc(l.memo) + (l.reverses ? " (reversal)" : "") + "</td><td>" + rupees(l.debit) + "</td><td>" + rupees(l.credit) +
        '</td><td>' + (l.reverses ? "" : '<button class="btn quiet" type="button" data-acc="reverse" data-id="' + c.esc(l.entryId) + '">Reverse</button>') + "</td></tr>";
    }).join("") + "</table></div>";
  }

  WSQ.page("accounts", { render: function (c) {
    var el = c.el, org = c.state.orgId, q = "?orgId=" + encodeURIComponent(org), admin = c.can("staff.admin");
    if (!c.can("billing.view") && !admin) { el.innerHTML = '<div class="title"><h1>Accounts</h1></div><div class="msg note">Your role cannot see the hospital accounts.</div>'; return; }
    el.innerHTML = '<div class="title"><h1>Accounts</h1></div>' +
      '<div class="card"><h2>Chart of accounts</h2><div id="accChart"><span class="spin"></span></div>' +
        (admin ? '<div class="row"><label class="f"><span>Code</span><input id="accNewCode"></label><label class="f"><span>Name</span><input id="accNewName"></label>' +
          '<label class="f"><span>Type</span><select id="accNewType"><option>asset</option><option>liability</option><option>equity</option><option>income</option><option>expense</option></select></label>' +
          '<button class="btn quiet" type="button" data-acc="account">Save account</button></div>' : "") + "</div>" +
      '<div class="card"><h2>Trial balance</h2><div class="row"><label class="f"><span>As at</span><input id="accTo" type="date"></label><button class="btn quiet" type="button" data-acc="tb">Show</button></div><div id="accTb">' + tbHtml(c, null) + "</div></div>" +
      '<div class="card"><h2>Account ledger</h2><div class="row"><label class="f"><span>Account code</span><input id="accCode" placeholder="1000"></label><label class="f"><span>From</span><input id="accFrom" type="date"></label><label class="f"><span>To</span><input id="accLTo" type="date"></label><button class="btn quiet" type="button" data-acc="ledger">Show</button></div><div id="accLedger"></div></div>' +
      (admin ? '<div class="card"><h2>Post a journal entry</h2><p class="quiet">Debits must equal credits. A posted entry is never edited; correct it with Reverse.</p>' +
        '<div class="row"><label class="f"><span>Date</span><input id="accDate" type="date"></label><label class="f"><span>Memo</span><input id="accMemo"></label></div>' +
        '<div class="row"><label class="f"><span>Debit account</span><input id="accDr"></label><label class="f"><span>Credit account</span><input id="accCr"></label><label class="f"><span>Amount (rupees)</span><input id="accAmt" inputmode="decimal"></label>' +
        '<button class="btn" type="button" data-acc="post">Post</button></div></div>' +
        '<div class="card"><h2>Close a month</h2><div class="row"><label class="f"><span>Month</span><input id="accPeriod" type="month"></label><button class="btn quiet" type="button" data-acc="close">Close month</button></div><div id="accClosed"></div></div>' : "") +
      '<div id="accMsg"></div>';
    var set = function (id, h) { var e = document.getElementById(id); if (e) e.innerHTML = h; };
    var msg = function (r, okText) { set("accMsg", '<div class="msg ' + (r && r.ok ? "ok" : "err") + '">' + c.esc(r && r.ok ? okText : ((r && (r.message || r.error)) || "Failed.")) + "</div>"); };
    c.api("/accounts/chart" + q).then(function (r) {
      if (!r || !r.ok) { set("accChart", '<div class="msg err">Could not load the chart of accounts.</div>'); return; }
      set("accChart", (r.defaulted ? '<p class="quiet">This is the starter chart; saving any account makes it the hospital own chart.</p>' : "") + "<ul>" + r.chart.map(function (a) {
        return "<li>" + c.esc(a.code + " " + a.name + " (" + a.type + ")") + (a.open ? "" : " - closed") +
          (admin && a.open ? ' <button class="btn quiet" type="button" data-acc="closeacct" data-code="' + c.esc(a.code) + '" data-name="' + c.esc(a.name) + '" data-type="' + c.esc(a.type) + '">Close</button>' : "") + "</li>";
      }).join("") + "</ul>");
    });
    if (admin) c.api("/accounts/periods" + q).then(function (r) { set("accClosed", r && r.ok ? "<p>Closed: " + c.esc(r.closed.join(", ") || "none") + "</p>" : '<div class="msg err">Could not load closed months.</div>'); });
    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-acc]"); if (!b) return;
      var a = b.getAttribute("data-acc");
      if (a === "account") return c.api("/accounts/account", { orgId: org, code: val("accNewCode"), name: val("accNewName"), type: val("accNewType") }).then(function (r) { msg(r, "Account saved."); if (r && r.ok) WSQ.render("accounts"); });
      if (a === "closeacct") { if (!confirm("Close account " + b.getAttribute("data-code") + "? Nothing more can be posted to it.")) return; return c.api("/accounts/account", { orgId: org, code: b.getAttribute("data-code"), name: b.getAttribute("data-name"), type: b.getAttribute("data-type"), open: false }).then(function (r) { msg(r, "Account closed."); if (r && r.ok) WSQ.render("accounts"); }); }
      if (a === "tb") { set("accTb", '<span class="spin"></span>'); return c.api("/accounts/trial-balance" + q + "&to=" + encodeURIComponent(val("accTo"))).then(function (r) { set("accTb", tbHtml(c, r || { ok: false })); }); }
      if (a === "ledger") { set("accLedger", '<span class="spin"></span>'); return c.api("/accounts/ledger" + q + "&account=" + encodeURIComponent(val("accCode")) + "&from=" + encodeURIComponent(val("accFrom")) + "&to=" + encodeURIComponent(val("accLTo"))).then(function (r) { set("accLedger", ledgerHtml(c, r || { ok: false })); }); }
      if (a === "post") {
        var p = toPaise(val("accAmt")); if (p == null || p <= 0) return msg({ ok: false, message: "Enter an amount in rupees, up to two decimals." });
        return c.api("/accounts/entry", { orgId: org, date: val("accDate"), memo: val("accMemo"), lines: [{ account: val("accDr"), debit: p }, { account: val("accCr"), credit: p }] }).then(function (r) { msg(r, "Entry posted."); });
      }
      if (a === "reverse") { var why = ""; try { why = prompt("Why is this entry being reversed?") || ""; } catch (e) {} if (!why.trim()) return; return c.api("/accounts/reverse", { orgId: org, entryId: b.getAttribute("data-id"), date: new Date().toISOString().slice(0, 10), reason: why.trim() }).then(function (r) { msg(r, "Reversal posted."); }); }
      if (a === "close") { if (!confirm("Close " + val("accPeriod") + "? Nothing can be posted into it afterwards.")) return; return c.api("/accounts/close-period", { orgId: org, period: val("accPeriod") }).then(function (r) { msg(r, "Month closed."); WSQ.render("accounts"); }); }
    };
  } });
  WSQ._accounts = { tbHtml: tbHtml, ledgerHtml: ledgerHtml, toPaise: toPaise };
})();
