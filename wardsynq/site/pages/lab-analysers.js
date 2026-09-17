/* wardsynq/site/pages/lab-analysers.js - Admin Center > Integrations > Laboratory analysers. Buildless ES5.
 *
 * The hospital's analysers (name, whether it speaks ASTM or HL7 v2, whether the on-premises connector listens
 * for it or connects to it, the port, host query on or off) and the mapping of each instrument's own test
 * codes to this hospital's test names. The connector (connect-agent/analyser/) fetches all of it with the
 * hospital's connector key, which is issued here, shown once and never again.
 *
 * GET /ward/lab-analysers draws it; POST /ward/lab-analyser-save saves one analyser; POST /ward/lab-connector-key
 * issues, rotates or revokes the key. null = loading, {failed} = not loaded, never the same as "none".
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;

  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }
  function refusal(c, r) {
    if (!r) return T(c, "site.labAn.noResponse", "No response from the server.");
    return r.message || r.error || T(c, "site.labAn.failed", "failed");
  }

  var ST = { editing: null, shownKey: null };

  /* One mapping line: instrument code | hospital test name | unit | ordered as. */
  function mapText(rows) {
    return (rows || []).map(function (r) { return [r.instrumentCode, r.testName, r.unit || "", r.orderedAs || ""].join(" | ").replace(/(\s\|\s)+$/, ""); }).join("\n");
  }
  function parseMap(text) {
    return String(text || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var p = l.split("|").map(function (x) { return x.trim(); });
      return { instrumentCode: p[0] || "", testName: p[1] || "", unit: p[2] || "", orderedAs: p[3] || "" };
    });
  }

  function formHtml(c, a) {
    var esc = c.esc, cur = a || { protocol: "astm", transport: "tcp-server", hostQuery: false, active: true, testMap: [] };
    var opt = function (v, label, sel) { return '<option value="' + esc(v) + '"' + (v === sel ? " selected" : "") + ">" + esc(label) + "</option>"; };
    return '<div id="labAnForm"><h3>' + esc(a ? T(c, "site.labAn.change", "Change {name}", { name: a.name }) : T(c, "site.labAn.add", "Add an analyser")) + "</h3>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.labAn.name", "Name *")) + '</span><input id="labAnName" maxlength="120" value="' + esc(cur.name || "") + '"' + (a ? " readonly" : "") + "></label>" +
      '<label class="f"><span>' + esc(T(c, "site.labAn.protocol", "Speaks")) + '</span><select id="labAnProtocol">' + opt("astm", T(c, "site.labAn.astm", "ASTM E1381/E1394 (LIS2-A2)"), cur.protocol) + opt("hl7", T(c, "site.labAn.hl7", "HL7 v2 over MLLP"), cur.protocol) + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.labAn.transport", "Connection")) + '</span><select id="labAnTransport">' + opt("tcp-server", T(c, "site.labAn.tcpServer", "Analyser connects to the connector"), cur.transport) + opt("tcp-client", T(c, "site.labAn.tcpClient", "Connector connects to the analyser (or its serial-to-network box)"), cur.transport) + "</select></label></div>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.labAn.host", "Address (for the connector to connect to, or to listen on)")) + '</span><input id="labAnHost" class="mono" maxlength="253" value="' + esc(cur.host || "") + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.labAn.port", "Port *")) + '</span><input id="labAnPort" class="mono" inputmode="numeric" maxlength="5" value="' + esc(cur.port == null ? "" : cur.port) + '"></label>' +
      '<label class="f"><span><input type="checkbox" id="labAnHostQuery"' + (cur.hostQuery ? " checked" : "") + "> " + esc(T(c, "site.labAn.hostQuery", "Answers the analyser's order query (ASTM host query)")) + "</span></label>" +
      '<label class="f"><span><input type="checkbox" id="labAnActive"' + (cur.active !== false ? " checked" : "") + "> " + esc(T(c, "site.labAn.active", "In use")) + "</span></label></div>" +
      '<label class="f"><span>' + esc(T(c, "site.labAn.mapping", "Test codes, one per line: instrument code | hospital test name | unit | ordered as")) + '</span>' +
      '<textarea id="labAnMap" rows="8" class="mono" style="width:100%" placeholder="K | Potassium | mmol/L | Renal profile">' + esc(mapText(cur.testMap)) + "</textarea></label>" +
      '<p class="quiet">' + esc(T(c, "site.labAn.mappingHelp", "A result whose code is not listed here is shown to the laboratory as not mapped and is never released. The ordered-as name is the test or panel ordered on the ward; it is how the analyser's order query learns what to run.")) + "</p>" +
      '<button type="button" class="btn" id="labAnSave">' + esc(T(c, "site.labAn.save", "Save analyser")) + "</button>" +
      (a ? ' <button type="button" class="btn ghost" id="labAnCancel">' + esc(T(c, "site.labAn.cancel", "Cancel")) + "</button>" : "") + "</div>";
  }

  function labAnalysersHtml(c, r) {
    var esc = c.esc;
    var head = '<div class="card"><h2>' + esc(T(c, "site.labAn.title", "Laboratory analysers")) + "</h2>";
    if (r == null) return head + '<span class="spin"></span> ' + esc(T(c, "site.labAn.loading", "Loading the analysers...")) + "</div>";
    if (r.failed) return head + '<div class="msg err">' + esc(T(c, "site.labAn.loadFailed", "The analysers could not be loaded:")) + " " + EN(c, esc(r.message || "")) + " " + esc(T(c, "site.labAn.notSameAsNone", "This is not the same as there being none.")) + "</div></div>";
    var h = head + '<p class="quiet">' + esc(T(c, "site.labAn.intro", "Analysers connect through the StewardMD analyser connector, a small program run on a computer on the laboratory's network (connect-agent/analyser). Their results arrive on the Laboratory board for a technologist to release; nothing is released automatically.")) + "</p>";

    var k = r.connector || {};
    h += "<h3>" + esc(T(c, "site.labAn.keyTitle", "Connector key")) + "</h3>";
    if (!r.keyConfigured) h += '<div class="msg err">' + esc(T(c, "site.labAn.keyNotConfigured", "Keys cannot be stored encrypted on this server, so no connector key can be issued.")) + "</div>";
    if (k.issued) h += '<p><b>' + esc(T(c, "site.labAn.keyIssued", "Issued")) + "</b> " + esc(T(c, "site.labAn.keyIssuedAt", "on {at}. It is not shown again.", { at: k.keySetAt || "" })) + "</p>";
    else h += '<div class="msg err">' + esc(T(c, "site.labAn.notConnected", "Not connected: no connector key has been issued, so no analyser can send results to this hospital.")) + "</div>";
    if (ST.shownKey) h += '<div class="msg ok">' + esc(T(c, "site.labAn.copyKey", "Copy this key into the connector's key file now. It is not shown again.")) + '<br><code style="user-select:all;word-break:break-all">' + esc(ST.shownKey) + "</code></div>";
    h += '<button type="button" class="btn" id="labAnKey"' + (r.keyConfigured ? "" : " disabled") + ">" + esc(k.issued ? T(c, "site.labAn.rotate", "Issue a new key (the old one stops working)") : T(c, "site.labAn.issue", "Issue the connector key")) + "</button>" +
      (k.issued ? ' <button type="button" class="btn ghost" id="labAnRevoke">' + esc(T(c, "site.labAn.revoke", "Revoke the key")) + "</button>" : "");

    h += "<h3>" + esc(T(c, "site.labAn.listTitle", "Analysers")) + "</h3>";
    if (!r.analysers.length) h += '<p class="quiet">' + esc(T(c, "site.labAn.none", "No analyser is registered for this hospital.")) + "</p>";
    else h += '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.labAn.colName", "Analyser")) + "</th><th>" + esc(T(c, "site.labAn.colProtocol", "Speaks")) + "</th><th>" + esc(T(c, "site.labAn.colPort", "Address and port")) + "</th><th>" + esc(T(c, "site.labAn.colCodes", "Codes mapped")) + "</th><th>" + esc(T(c, "site.labAn.colStatus", "Status")) + "</th><th></th></tr></thead><tbody>" +
      r.analysers.map(function (a) {
        return '<tr class="' + (a.active === false ? "warn" : "") + '"><td>' + EN(c, esc(a.name)) + "</td><td>" + esc(a.protocol === "hl7" ? T(c, "site.labAn.hl7Short", "HL7 v2") : T(c, "site.labAn.astmShort", "ASTM")) + "</td><td class=\"mono\">" + EN(c, esc((a.host || "") + ":" + a.port)) + "</td><td>" + esc(String((a.testMap || []).length)) + "</td><td><b>" +
          esc(a.active === false ? T(c, "site.labAn.off", "Off") : T(c, "site.labAn.on", "On")) + '</b></td><td><button type="button" class="btn ghost" data-lab-an-edit="' + esc(a.id) + '">' + esc(T(c, "site.labAn.changeButton", "Change")) + "</button></td></tr>";
      }).join("") + "</tbody></table></div>";
    var editing = r.analysers.filter(function (a) { return a.id === ST.editing; })[0] || null;
    return h + formHtml(c, editing) + '<div id="labAnMsg"></div></div>';
  }
  WSQ._labAnalysersHtml = labAnalysersHtml;

  function load(c) {
    var card = document.getElementById("labAnCard");
    if (!card) return;
    card.innerHTML = labAnalysersHtml(c, null);
    c.api("/ward/lab-analysers?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      var ok = r && r.ok && r.analysers;
      card.innerHTML = labAnalysersHtml(c, ok ? r : { failed: true, message: refusal(c, r) });
      if (ok) bind(c, card, r);
    }, function () { card.innerHTML = labAnalysersHtml(c, { failed: true, message: T(c, "site.labAn.noResponse", "No response from the server.") }); });
  }
  WSQ._labAnalysersLoad = load;

  function bind(c, card, r) {
    var say = function (t, ok) { var m = document.getElementById("labAnMsg"); if (m) m.innerHTML = '<div class="msg ' + (ok ? "ok" : "err") + '">' + c.esc(t) + "</div>"; };
    var val = function (id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; };
    var checked = function (id) { var e = document.getElementById(id); return !!(e && e.checked); };
    var redraw = function () { card.innerHTML = labAnalysersHtml(c, r); bind(c, card, r); };
    var key = document.getElementById("labAnKey");
    if (key) key.onclick = function () {
      if (r.connector && r.connector.issued && !window.confirm(T(c, "site.labAn.rotateConfirm", "Issue a new key? The connector stops sending results until its key file is updated."))) return;
      key.disabled = true;
      c.api("/ward/lab-connector-key", { orgId: c.state.orgId }).then(function (x) {
        if (!x || !x.ok || !x.key) { key.disabled = false; say(refusal(c, x)); return; }
        ST.shownKey = x.key; r.connector = x.connector; redraw();
      }, function () { key.disabled = false; say(T(c, "site.labAn.keyNoResponse", "No response from the server. A key may or may not have been issued; issue a new one to be sure.")); });
    };
    var revoke = document.getElementById("labAnRevoke");
    if (revoke) revoke.onclick = function () {
      if (!window.confirm(T(c, "site.labAn.revokeConfirm", "Revoke the connector key? No analyser can send results until a new key is issued."))) return;
      revoke.disabled = true;
      c.api("/ward/lab-connector-key", { orgId: c.state.orgId, revoke: true }).then(function (x) {
        if (!x || !x.ok) { revoke.disabled = false; say(refusal(c, x)); return; }
        ST.shownKey = null; r.connector = x.connector; redraw();
      }, function () { revoke.disabled = false; say(T(c, "site.labAn.revokeNoResponse", "No response from the server. The key may not have been revoked; reload to check.")); });
    };
    card.querySelectorAll("[data-lab-an-edit]").forEach(function (b) { b.onclick = function () { ST.editing = b.getAttribute("data-lab-an-edit"); redraw(); }; });
    var cancel = document.getElementById("labAnCancel");
    if (cancel) cancel.onclick = function () { ST.editing = null; redraw(); };
    var save = document.getElementById("labAnSave");
    if (save) save.onclick = function () {
      var cur = r.analysers.filter(function (a) { return a.id === ST.editing; })[0];
      save.disabled = true;
      c.api("/ward/lab-analyser-save", { orgId: c.state.orgId, expectedVersion: cur ? cur.version : undefined, analyser: {
        name: val("labAnName"), ref: cur ? cur.ref : undefined, protocol: val("labAnProtocol"), transport: val("labAnTransport"), host: val("labAnHost"),
        port: Number(val("labAnPort")), hostQuery: checked("labAnHostQuery"), active: checked("labAnActive"), testMap: parseMap(val("labAnMap")),
      } }).then(function (x) {
        if (!x || !x.ok) { save.disabled = false; say(refusal(c, x)); return; }
        ST.editing = null; c.toast(T(c, "site.labAn.saved", "Analyser saved.")); load(c);
      }, function () { save.disabled = false; say(T(c, "site.labAn.saveNoResponse", "No response from the server. The analyser may not have been saved; reload to check.")); });
    };
  }
})();
