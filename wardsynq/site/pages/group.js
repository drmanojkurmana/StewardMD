/* wardsynq/site/pages/group.js - wardsynq.com Group overview (P2.14): the member hospitals of a
 * hospital group side by side, counts only. Buildless ES5, registers onto the global WSQ (set by
 * shell.js). Reads GET /api/queue/group/my-groups and GET /api/queue/group/overview?groupId=.
 *
 * A count the server could not read arrives as null and is shown in words, never as 0, and a
 * hospital with nothing readable says "Could not be read" across its row. There is nothing to click
 * through to: the group has no access to any patient, by design (vault/decisions/Decisions.md).
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;

  var COLUMNS = [["census", "Census"], ["bedsFree", "Beds free"], ["edWaiting", "ED waiting"], ["criticalOpen", "Critical results open"], ["staffShort", "Staff short now"]];
  var REASON = { could_not_be_read: "could not be read", not_set_up: "not set up" };

  function refusal(r) { return (r && (r.message || r.error)) || "No response from the server."; }

  function cell(esc, h, key) {
    var v = h.counts ? h.counts[key] : null;
    if (typeof v === "number") return '<td class="num">' + esc(v) + "</td>";
    return '<td class="num"><span class="quiet">' + esc(REASON[(h.reasons || {})[key]] || "could not be read") + "</span></td>";
  }

  /** r: null = loading; { failed, message }; or the /group/overview response. */
  function overviewHtml(c, r) {
    var esc = c.esc;
    if (r == null) return '<div class="card"><span class="spin"></span> Loading the group overview...</div>';
    if (r.failed) return '<div class="card"><div class="msg err">The group overview could not be loaded: ' + esc(r.message || "failed") + ". This is not the same as the hospitals having nothing to report.</div></div>";
    var hs = r.hospitals || [];
    var h = '<div class="card"><h2>' + esc((r.group && r.group.name) || "Hospital group") + "</h2>" +
      '<p class="quiet">Counts only, read from each hospital\'s own record when this page loaded' + (r.generatedAt ? " (" + esc(r.generatedAt) + ")" : "") + ". No patient is shown to a group. Each read is recorded in that hospital's audit trail.</p>";
    if (!hs.length) return h + '<p class="quiet">No hospital has accepted this group yet. An invitation alone does not add a hospital.</p></div>';
    return h + '<div class="tbl"><table><thead><tr><th>Hospital</th>' + COLUMNS.map(function (col) { return '<th class="num">' + esc(col[1]) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      hs.map(function (x) {
        var name = "<td>" + esc(x.name || x.orgId) + (x.capped ? '<br><span class="quiet">very large record: counts may be incomplete</span>' : "") + "</td>";
        if (x.status === "unreadable") return "<tr>" + name + '<td colspan="' + COLUMNS.length + '"><span class="pill stop">Could not be read</span></td></tr>';
        return "<tr>" + name + COLUMNS.map(function (col) { return cell(esc, x, col[0]); }).join("") + "</tr>";
      }).join("") + "</tbody></table></div></div>";
  }
  WSQ._groupOverviewHtml = overviewHtml;

  WSQ.page("group", { render: function (c) {
    var el = c.el, gid = c.state.arg || "";
    el.innerHTML = '<div class="title"><h1>Group overview</h1></div><div id="grpBody">' + overviewHtml(c, null) + "</div>";
    var body = document.getElementById("grpBody");
    if (gid) {
      return c.api("/group/overview?groupId=" + encodeURIComponent(gid)).then(function (r) {
        body.innerHTML = overviewHtml(c, r && r.ok ? r : { failed: true, message: refusal(r) });
      });
    }
    return c.api("/group/my-groups").then(function (r) {
      if (!r || !r.ok) { body.innerHTML = '<div class="card"><div class="msg err">Your hospital groups could not be loaded: ' + c.esc(refusal(r)) + ".</div></div>"; return; }
      if (!r.groups.length) { body.innerHTML = '<div class="card"><p class="quiet">You do not run a hospital group. A hospital admin can create one under Admin Center, Hospital group.</p></div>'; return; }
      if (r.groups.length === 1) { c.go("group", r.groups[0].id); return; }
      body.innerHTML = '<div class="card"><h2>Choose a group</h2><ul>' + r.groups.map(function (g) {
        return '<li><a href="#/group/' + encodeURIComponent(g.id) + '">' + c.esc(g.name) + "</a></li>";
      }).join("") + "</ul></div>";
    });
  } });
})();
