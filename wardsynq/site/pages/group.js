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

  /* Staff language (ui-i18n-site). The inline English is the fallback when the shell context has no t
   * (helpers rendered on their own), and must equal the key's English in i18n.js byte for byte. */
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }

  var COLUMNS = [["census", "Census"], ["bedsFree", "Beds free"], ["edWaiting", "ED waiting"], ["criticalOpen", "Critical results open"], ["staffShort", "Staff short now"]];

  function columnLabel(c, key) {
    if (key === "census") return T(c, "site.group.colCensus", "Census");
    if (key === "bedsFree") return T(c, "site.group.colBedsFree", "Beds free");
    if (key === "edWaiting") return T(c, "site.group.colEdWaiting", "ED waiting");
    if (key === "criticalOpen") return T(c, "site.group.colCriticalOpen", "Critical results open");
    if (key === "staffShort") return T(c, "site.group.colStaffShort", "Staff short now");
    return key;
  }
  function reasonWord(c, key) {
    if (key === "could_not_be_read") return T(c, "site.group.reasonCouldNotBeRead", "could not be read");
    if (key === "not_set_up") return T(c, "site.group.reasonNotSetUp", "not set up");
    return null;
  }

  function refusal(c, r) { return (r && (r.message || r.error)) || T(c, "site.group.noResponse", "No response from the server."); }

  function cell(c, esc, h, key) {
    var v = h.counts ? h.counts[key] : null;
    if (typeof v === "number") return '<td class="num">' + esc(v) + "</td>";
    return '<td class="num"><span class="quiet">' + esc(reasonWord(c, (h.reasons || {})[key]) || T(c, "site.group.reasonCouldNotBeRead", "could not be read")) + "</span></td>";
  }

  /** r: null = loading; { failed, message }; or the /group/overview response. */
  function overviewHtml(c, r) {
    var esc = c.esc;
    if (r == null) return '<div class="card"><span class="spin"></span> ' + esc(T(c, "site.group.loading", "Loading the group overview...")) + '</div>';
    if (r.failed) return '<div class="card"><div class="msg err">' + TS(c, "site.group.loadFailedLead", "The group overview could not be loaded:") + " " + (r.message ? EN(c, esc(r.message)) : esc(T(c, "site.group.loadFailedDefault", "failed"))) + TS(c, "site.group.loadFailedTrail", ". This is not the same as the hospitals having nothing to report.") + "</div></div>";
    var hs = r.hospitals || [];
    /* D4 B: each hospital's counts are the snapshot IT published, with who published it and when. A hospital
     * that never published says "Not published" (never zeros); an old snapshot carries a Stale pill after the
     * group's own age setting. */
    var stale = (r.group && r.group.staleAfterMinutes) || 60;
    var h = '<div class="card"><h2>' + ((r.group && r.group.name) ? EN(c, esc(r.group.name)) : esc(T(c, "site.group.defaultTitle", "Hospital group"))) + "</h2>" +
      '<p class="quiet">' + TS(c, "site.group.introText", "Counts only, as each hospital last published them. A snapshot older than {stale} minutes is marked stale. No patient is shown to a group. Each view is recorded in that hospital's audit trail.", { stale: stale }) + "</p>";
    if (!hs.length) return h + '<p class="quiet">' + esc(T(c, "site.group.noneAccepted", "No hospital has accepted this group yet. An invitation alone does not add a hospital.")) + '</p></div>';
    return h + '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.group.colHospital", "Hospital")) + '</th>' + COLUMNS.map(function (col) { return '<th class="num">' + esc(columnLabel(c, col[0])) + "</th>"; }).join("") + "<th>" + esc(T(c, "site.group.colPublished", "Published")) + "</th></tr></thead><tbody>" +
      hs.map(function (x) {
        var name = "<td>" + EN(c, esc(x.name || x.orgId)) + (x.capped ? '<br><span class="quiet">' + TS(c, "site.group.cappedNote", "very large record: counts may be incomplete") + "</span>" : "") + "</td>";
        if (x.status === "not_published") return "<tr>" + name + '<td colspan="' + (COLUMNS.length + 1) + '"><span class="pill warn">' + esc(T(c, "site.group.notPublishedPill", "Not published")) + '</span> <span class="quiet">' + esc(T(c, "site.group.notPublishedNote", "This hospital has not published its counts.")) + '</span></td></tr>';
        var pubCell = x.publishedAt ? "<td>" + EN(c, esc(new Date(x.publishedAt).toLocaleString())) + '<br><span class="quiet">' + esc(T(c, "site.group.byPrefix", "by")) + " " + (x.publishedBy ? EN(c, esc(x.publishedBy)) : esc(T(c, "site.group.unknownWord", "unknown"))) + "</span>" + (x.stale ? ' <span class="pill warn">' + esc(T(c, "site.group.stalePill", "Stale")) + '</span>' : "") + "</td>" : "<td></td>";
        if (x.status === "unreadable") return "<tr>" + name + '<td colspan="' + COLUMNS.length + '"><span class="pill stop">' + esc(T(c, "site.group.couldNotBeReadPill", "Could not be read")) + '</span>' + pubCell + "</tr>";
        return "<tr>" + name + COLUMNS.map(function (col) { return cell(c, esc, x, col[0]); }).join("") + pubCell + "</tr>";
      }).join("") + "</tbody></table></div></div>";
  }
  WSQ._groupOverviewHtml = overviewHtml;

  WSQ.page("group", { render: function (c) {
    var el = c.el, gid = c.state.arg || "";
    el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.group.title", "Group overview")) + '</h1></div><div id="grpBody">' + overviewHtml(c, null) + "</div>";
    var body = document.getElementById("grpBody");
    if (gid) {
      return c.api("/group/overview?groupId=" + encodeURIComponent(gid)).then(function (r) {
        body.innerHTML = overviewHtml(c, r && r.ok ? r : { failed: true, message: refusal(c, r) });
      });
    }
    return c.api("/group/my-groups").then(function (r) {
      if (!r || !r.ok) { body.innerHTML = '<div class="card"><div class="msg err">' + TS(c, "site.group.myGroupsLoadFailedPrefix", "Your hospital groups could not be loaded:") + " " + EN(c, c.esc(refusal(c, r))) + ".</div></div>"; return; }
      if (!r.groups.length) { body.innerHTML = '<div class="card"><p class="quiet">' + c.esc(T(c, "site.group.noGroupRun", "You do not run a hospital group. A hospital admin can create one under Admin Center, Hospital group.")) + '</p></div>'; return; }
      if (r.groups.length === 1) { c.go("group", r.groups[0].id); return; }
      body.innerHTML = '<div class="card"><h2>' + c.esc(T(c, "site.group.chooseGroupTitle", "Choose a group")) + '</h2><ul>' + r.groups.map(function (g) {
        return '<li><a href="#/group/' + encodeURIComponent(g.id) + '">' + EN(c, c.esc(g.name)) + "</a></li>";
      }).join("") + "</ul></div>";
    });
  } });
})();
