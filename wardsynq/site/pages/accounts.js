/* wardsynq/site/pages/accounts.js - "Accounts": the hospital's books. Trial balance and account ledger for
 * billing.view; posting a journal, reversing an entry and closing a month for the admin (the server decides).
 * Amounts are typed in rupees and sent as whole paise. A failed or partial read never looks balanced. */
(function () {
  "use strict";
  var WSQ = window.WSQ;

  /* Staff language (ui-i18n-site). The inline English is the fallback when the shell context has no t
   * (helpers rendered on their own), and must equal the key's English in i18n.js byte for byte. */
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }

  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  function rupees(p) { return (Number(p || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function toPaise(s) { var t = String(s || "").replace(/,/g, "").trim(); if (!/^\d+(\.\d{1,2})?$/.test(t)) return null; var parts = t.split("."); return Number(parts[0]) * 100 + Number(((parts[1] || "") + "00").slice(0, 2)); }

  function tbHtml(c, r) {
    if (r == null) return "<p>" + c.esc(T(c, "site.accounts.tbPrompt", "Choose a date and press Show.")) + "</p>";
    if (!r.ok) return '<div class="msg err">' + (r.message || r.error ? EN(c, c.esc(r.message || r.error)) : c.esc(T(c, "site.accounts.tbLoadFailedDefault", "Could not load the trial balance."))) + " " + TS(c, "site.accounts.doNotReadBalanced", "Do not read this as balanced.") + "</div>";
    var rows = r.accounts.filter(function (a) { return a.debit || a.credit; });
    return (r.partial ? '<div class="msg note">' + TS(c, "site.accounts.tbPartial", "Some months have too many entries to read in full; these totals may be incomplete.") + "</div>" : "") +
      '<div class="msg ' + (r.balanced ? "ok" : "err") + '">' + (r.balanced ? c.esc(T(c, "site.accounts.balanced", "Balanced")) : c.esc(T(c, "site.accounts.notBalanced", "NOT balanced"))) + ": " + c.esc(T(c, "site.accounts.debitsLabel", "debits")) + " " + rupees(r.totalDebit) + ", " + c.esc(T(c, "site.accounts.creditsLabel", "credits")) + " " + rupees(r.totalCredit) + " (" + c.esc(T(c, "site.accounts.fromLabel", "from")) + " " + EN(c, c.esc(r.financialYearFrom)) + ")</div>" +
      (rows.length ? '<div class="tbl"><table><tr><th>' + c.esc(T(c, "site.accounts.colCode", "Code")) + '</th><th>' + c.esc(T(c, "site.accounts.colAccount", "Account")) + '</th><th>' + c.esc(T(c, "site.accounts.colDebits", "Debits")) + '</th><th>' + c.esc(T(c, "site.accounts.colCredits", "Credits")) + '</th><th>' + c.esc(T(c, "site.accounts.colBalance", "Balance")) + '</th></tr>' + rows.map(function (a) {
        return "<tr><td>" + c.esc(a.code) + "</td><td>" + c.esc(a.name) + "</td><td>" + rupees(a.debit) + "</td><td>" + rupees(a.credit) + "</td><td>" + rupees(a.balance) + "</td></tr>";
      }).join("") + "</table></div>" : "<p>" + c.esc(T(c, "site.accounts.tbNoEntries", "No entries in this financial year yet.")) + "</p>");
  }
  function ledgerHtml(c, r) {
    if (r == null) return "";
    if (!r.ok) return '<div class="msg err">' + (r.message || r.error ? EN(c, c.esc(r.message || r.error)) : c.esc(T(c, "site.accounts.ledgerLoadFailedDefault", "Could not load the ledger."))) + " " + TS(c, "site.accounts.doNotReadNoMovement", "Do not read this as no movement.") + "</div>";
    if (!r.lines.length) return "<p>" + c.esc(T(c, "site.accounts.ledgerNoEntries", "No entries for this account in these dates.")) + "</p>";
    return '<div class="tbl"><table><tr><th>' + c.esc(T(c, "site.accounts.colDate", "Date")) + '</th><th>' + c.esc(T(c, "site.accounts.colMemo", "Memo")) + '</th><th>' + c.esc(T(c, "site.accounts.colDebit", "Debit")) + '</th><th>' + c.esc(T(c, "site.accounts.colCredit", "Credit")) + '</th><th></th></tr>' + r.lines.map(function (l) {
      return "<tr><td>" + EN(c, c.esc(l.date)) + "</td><td>" + EN(c, c.esc(l.memo)) + (l.reverses ? c.esc(T(c, "site.accounts.reversalSuffix", " (reversal)")) : "") + "</td><td>" + rupees(l.debit) + "</td><td>" + rupees(l.credit) +
        '</td><td>' + (l.reverses ? "" : '<button class="btn quiet" type="button" data-acc="reverse" data-id="' + c.esc(l.entryId) + '">' + c.esc(T(c, "site.accounts.reverseButton", "Reverse")) + '</button>') + "</td></tr>";
    }).join("") + "</table></div>";
  }

  WSQ.page("accounts", { render: function (c) {
    var el = c.el, org = c.state.orgId, q = "?orgId=" + encodeURIComponent(org), admin = c.can("staff.admin");
    if (!c.can("billing.view") && !admin) { el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.accounts.title", "Accounts")) + '</h1></div><div class="msg note">' + TS(c, "site.accounts.noAccess", "Your role cannot see the hospital accounts.") + "</div>"; return; }
    el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.accounts.title", "Accounts")) + '</h1></div>' +
      '<div class="card"><h2>' + c.esc(T(c, "site.accounts.chartTitle", "Chart of accounts")) + '</h2><div id="accChart"><span class="spin"></span></div>' +
        (admin ? '<div class="row"><label class="f"><span>' + c.esc(T(c, "site.accounts.codeLabel", "Code")) + '</span><input id="accNewCode"></label><label class="f"><span>' + c.esc(T(c, "site.accounts.nameLabel", "Name")) + '</span><input id="accNewName"></label>' +
          '<label class="f"><span>' + c.esc(T(c, "site.accounts.typeLabel", "Type")) + '</span><select id="accNewType"><option value="asset">' + c.esc(T(c, "site.accounts.typeAsset", "asset")) + '</option><option value="liability">' + c.esc(T(c, "site.accounts.typeLiability", "liability")) + '</option><option value="equity">' + c.esc(T(c, "site.accounts.typeEquity", "equity")) + '</option><option value="income">' + c.esc(T(c, "site.accounts.typeIncome", "income")) + '</option><option value="expense">' + c.esc(T(c, "site.accounts.typeExpense", "expense")) + '</option></select></label>' +
          '<button class="btn quiet" type="button" data-acc="account">' + c.esc(T(c, "site.accounts.saveAccountButton", "Save account")) + '</button></div>' : "") + "</div>" +
      '<div class="card"><h2>' + c.esc(T(c, "site.accounts.tbTitle", "Trial balance")) + '</h2><div class="row"><label class="f"><span>' + c.esc(T(c, "site.accounts.asAtLabel", "As at")) + '</span><input id="accTo" type="date"></label><button class="btn quiet" type="button" data-acc="tb">' + c.esc(T(c, "site.accounts.showButton", "Show")) + '</button></div><div id="accTb">' + tbHtml(c, null) + "</div></div>" +
      '<div class="card"><h2>' + c.esc(T(c, "site.accounts.ledgerTitle", "Account ledger")) + '</h2><div class="row"><label class="f"><span>' + c.esc(T(c, "site.accounts.accountCodeLabel", "Account code")) + '</span><input id="accCode" placeholder="1000"></label><label class="f"><span>' + c.esc(T(c, "site.accounts.fromDateLabel", "From")) + '</span><input id="accFrom" type="date"></label><label class="f"><span>' + c.esc(T(c, "site.accounts.toDateLabel", "To")) + '</span><input id="accLTo" type="date"></label><button class="btn quiet" type="button" data-acc="ledger">' + c.esc(T(c, "site.accounts.showButton", "Show")) + '</button></div><div id="accLedger"></div></div>' +
      (admin ? '<div class="card"><h2>' + c.esc(T(c, "site.accounts.postTitle", "Post a journal entry")) + '</h2><p class="quiet">' + c.esc(T(c, "site.accounts.postHelp", "Debits must equal credits. A posted entry is never edited; correct it with Reverse.")) + '</p>' +
        '<div class="row"><label class="f"><span>' + c.esc(T(c, "site.accounts.dateLabel", "Date")) + '</span><input id="accDate" type="date"></label><label class="f"><span>' + c.esc(T(c, "site.accounts.memoLabel", "Memo")) + '</span><input id="accMemo"></label></div>' +
        '<div class="row"><label class="f"><span>' + c.esc(T(c, "site.accounts.drAccountLabel", "Debit account")) + '</span><input id="accDr"></label><label class="f"><span>' + c.esc(T(c, "site.accounts.crAccountLabel", "Credit account")) + '</span><input id="accCr"></label><label class="f"><span>' + c.esc(T(c, "site.accounts.amountLabel", "Amount (rupees)")) + '</span><input id="accAmt" inputmode="decimal"></label>' +
        '<button class="btn" type="button" data-acc="post">' + c.esc(T(c, "site.accounts.postButton", "Post")) + '</button></div></div>' +
        '<div class="card"><h2>' + c.esc(T(c, "site.accounts.closeMonthTitle", "Close a month")) + '</h2><div class="row"><label class="f"><span>' + c.esc(T(c, "site.accounts.monthLabel", "Month")) + '</span><input id="accPeriod" type="month"></label><button class="btn quiet" type="button" data-acc="close">' + c.esc(T(c, "site.accounts.closeMonthButton", "Close month")) + '</button></div><div id="accClosed"></div></div>' : "") +
      '<div id="accMsg"></div>';
    var set = function (id, h) { var e = document.getElementById(id); if (e) e.innerHTML = h; };
    var msg = function (r, okText) { set("accMsg", '<div class="msg ' + (r && r.ok ? "ok" : "err") + '">' + (r && r.ok ? c.esc(okText) : (r && (r.message || r.error) ? EN(c, c.esc(r.message || r.error)) : c.esc(T(c, "site.accounts.failedGeneric", "Failed.")))) + "</div>"); };
    c.api("/accounts/chart" + q).then(function (r) {
      if (!r || !r.ok) { set("accChart", '<div class="msg err">' + TS(c, "site.accounts.chartLoadFailed", "Could not load the chart of accounts.") + "</div>"); return; }
      set("accChart", (r.defaulted ? '<p class="quiet">' + c.esc(T(c, "site.accounts.starterChartNote", "This is the starter chart; saving any account makes it the hospital own chart.")) + '</p>' : "") + "<ul>" + r.chart.map(function (a) {
        return "<li>" + EN(c, c.esc(a.code + " " + a.name + " (" + a.type + ")")) + (a.open ? "" : c.esc(T(c, "site.accounts.closedSuffix", " - closed"))) +
          (admin && a.open ? ' <button class="btn quiet" type="button" data-acc="closeacct" data-code="' + c.esc(a.code) + '" data-name="' + c.esc(a.name) + '" data-type="' + c.esc(a.type) + '">' + c.esc(T(c, "site.accounts.closeButton", "Close")) + '</button>' : "") + "</li>";
      }).join("") + "</ul>");
    });
    if (admin) c.api("/accounts/periods" + q).then(function (r) { set("accClosed", r && r.ok ? "<p>" + c.esc(T(c, "site.accounts.closedLabel", "Closed:")) + " " + (r.closed.length ? EN(c, c.esc(r.closed.join(", "))) : c.esc(T(c, "site.accounts.noneWord", "none"))) + "</p>" : '<div class="msg err">' + TS(c, "site.accounts.closedMonthsLoadFailed", "Could not load closed months.") + "</div>"); });
    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-acc]"); if (!b) return;
      var a = b.getAttribute("data-acc");
      if (a === "account") return c.api("/accounts/account", { orgId: org, code: val("accNewCode"), name: val("accNewName"), type: val("accNewType") }).then(function (r) { msg(r, T(c, "site.accounts.accountSaved", "Account saved.")); if (r && r.ok) WSQ.render("accounts"); });
      if (a === "closeacct") { if (!confirm(T(c, "site.accounts.confirmCloseAccount", "Close account {code}? Nothing more can be posted to it.", { code: b.getAttribute("data-code") }))) return; return c.api("/accounts/account", { orgId: org, code: b.getAttribute("data-code"), name: b.getAttribute("data-name"), type: b.getAttribute("data-type"), open: false }).then(function (r) { msg(r, T(c, "site.accounts.accountClosed", "Account closed.")); if (r && r.ok) WSQ.render("accounts"); }); }
      if (a === "tb") { set("accTb", '<span class="spin"></span>'); return c.api("/accounts/trial-balance" + q + "&to=" + encodeURIComponent(val("accTo"))).then(function (r) { set("accTb", tbHtml(c, r || { ok: false })); }); }
      if (a === "ledger") { set("accLedger", '<span class="spin"></span>'); return c.api("/accounts/ledger" + q + "&account=" + encodeURIComponent(val("accCode")) + "&from=" + encodeURIComponent(val("accFrom")) + "&to=" + encodeURIComponent(val("accLTo"))).then(function (r) { set("accLedger", ledgerHtml(c, r || { ok: false })); }); }
      if (a === "post") {
        var p = toPaise(val("accAmt")); if (p == null || p <= 0) return msg({ ok: false, message: T(c, "site.accounts.amountValidation", "Enter an amount in rupees, up to two decimals.") });
        return c.api("/accounts/entry", { orgId: org, date: val("accDate"), memo: val("accMemo"), lines: [{ account: val("accDr"), debit: p }, { account: val("accCr"), credit: p }] }).then(function (r) { msg(r, T(c, "site.accounts.entryPosted", "Entry posted.")); });
      }
      if (a === "reverse") { var why = ""; try { why = prompt(T(c, "site.accounts.reversePrompt", "Why is this entry being reversed?")) || ""; } catch (e) {} if (!why.trim()) return; return c.api("/accounts/reverse", { orgId: org, entryId: b.getAttribute("data-id"), date: new Date().toISOString().slice(0, 10), reason: why.trim() }).then(function (r) { msg(r, T(c, "site.accounts.reversalPosted", "Reversal posted.")); }); }
      if (a === "close") { if (!confirm(T(c, "site.accounts.confirmCloseMonth", "Close {period}? Nothing can be posted into it afterwards.", { period: val("accPeriod") }))) return; return c.api("/accounts/close-period", { orgId: org, period: val("accPeriod") }).then(function (r) { msg(r, T(c, "site.accounts.monthClosed", "Month closed.")); WSQ.render("accounts"); }); }
    };
  } });
  WSQ._accounts = { tbHtml: tbHtml, ledgerHtml: ledgerHtml, toPaise: toPaise };
})();
