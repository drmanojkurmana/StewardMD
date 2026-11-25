/* StewardMD - ResearchMD backup and restore (SMD_RESEARCH.screens.backup).
 * ES5 only. Plan v2 item 8, over RMDBackup: encrypted file to the share sheet
 * or a download, restore with a preview, merge (newer wins) or replace.
 * bannerHtml() is the weekly prompt for the ResearchMD home.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var FORGET_LINE = "If you forget this passphrase, nobody can open the backup, including us.";
  var BANNER = "Back up your research data";

  var st = { busy: false, notice: "", error: "", preview: null, file: null, pass: "" };

  function msg(e) { return String((e && e.message) || e || "").replace(/^research: /, ""); }

  function render(container) {
    st.busy = false; st.notice = ""; st.error = ""; st.preview = null; st.file = null; st.pass = "";
    draw(container);
  }

  function draw(container) {
    var K = SMD.kit, h = [], last = G.RMDStore && G.RMDStore.lsGet ? G.RMDStore.lsGet("lastBackupAt") : null;
    h.push(K.header("Backup", "Keep a copy of your research data off this phone"));
    if (G.RMDStore && G.RMDStore.available && !G.RMDStore.available()) {
      h.push(K.banner("This phone is not keeping research data between visits. Make a backup before you close the app."));
    }
    h.push('<div class="rmd-card rmd-form" data-rmd-bk="make"><h3 class="rmd-card-heading">Make a backup</h3>');
    h.push('<p class="rmd-mut">' + (last ? "Last backup: " + K.esc(String(last).slice(0, 10)) : "No backup yet.") + '</p>');
    h.push(K.field({ name: "p1", label: "Passphrase (at least 8 characters)", type: "password" }));
    h.push(K.field({ name: "p2", label: "Type it again", type: "password" }));
    h.push(K.field({ name: "images", type: "check", label: "Include images (makes the file larger)" }));
    h.push('<p class="rmd-p">' + K.esc(FORGET_LINE) + '</p>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-bk="go"' + (st.busy ? " disabled" : "") + '>Make the backup</button></div>');
    h.push('<div class="rmd-card rmd-form" data-rmd-bk="restore"><h3 class="rmd-card-heading">Restore</h3>');
    h.push('<input type="file" accept=".rmdbackup,application/octet-stream,application/json" class="rmd-mc-fileinput" data-rmd-bk="file">');
    h.push(K.field({ name: "rp", label: "Backup passphrase", type: "password" }));
    h.push('<button type="button" class="rmd-btn" data-rmd-bk="check"' + (st.busy ? " disabled" : "") + '>Open the backup</button>');
    if (st.preview) {
      var c = st.preview.counts, i, k, parts;
      h.push('<p class="rmd-p">' + c.records + ' item' + (c.records === 1 ? "" : "s") + ' in ' + c.projects.length + ' project' + (c.projects.length === 1 ? "" : "s") + ':</p>');
      for (i = 0; i < c.projects.length; i++) {
        parts = [];
        for (k in c.projects[i].kinds) if (c.projects[i].kinds.hasOwnProperty(k)) parts.push(k + " " + c.projects[i].kinds[k]);
        h.push('<p class="rmd-mut">' + K.esc(projectName(c.projects[i].projectId)) + ': ' + K.esc(parts.join(", ")) + '</p>');
      }
      h.push('<div class="rmd-mc-actions"><button type="button" class="rmd-btn rmd-btn-primary" data-rmd-bk="merge">Merge (newer wins)</button> ' +
        '<button type="button" class="rmd-btn" data-rmd-bk="replace">Replace everything on this phone</button></div>');
    }
    h.push('</div>');
    if (st.error) h.push(K.banner(st.error, "warn"));
    if (st.notice) h.push('<p class="rmd-mut" role="status">' + K.esc(st.notice) + '</p>');
    container.innerHTML = '<div class="rmd-bk-screen">' + h.join("") + '</div>';
    bind(container);
  }

  function projectName(pid) {
    var list = SMD.store && SMD.store.getProjects ? SMD.store.getProjects() : [], i;
    for (i = 0; i < (list || []).length; i++) if (list[i].id === pid) return list[i].title || pid;
    return pid;
  }

  function bind(container) {
    var B = G.RMDBackup, K = SMD.kit;
    function on(sel, fn) { var el = container.querySelector(sel); if (el) el.onclick = fn; }
    on('[data-rmd-bk="go"]', function () {
      var o = K.read(container.querySelector('[data-rmd-bk="make"]'), {});
      st.error = ""; st.notice = "";
      if (o.p1 !== o.p2) { st.error = "The two passphrases are different."; draw(container); return; }
      var bad = B.checkPassphrase(o.p1);
      if (bad) { st.error = bad; draw(container); return; }
      st.busy = true; st.notice = "Encrypting..."; draw(container);
      B.makeBackup(o.p1, { includeImages: !!o.images }).then(function (bk) {
        return B.deliver(bk.fileName, bk.text).then(function () {
          B.markBackedUp();
          st.busy = false; st.notice = "Backup ready: " + bk.fileName + " (" + bk.counts.records + " items). Keep it somewhere safe.";
          draw(container);
        });
      }).catch(function (e) { st.busy = false; st.notice = ""; st.error = msg(e) || "The backup was not made."; draw(container); });
    });
    var fileIn = container.querySelector('[data-rmd-bk="file"]');
    if (fileIn) fileIn.onchange = function () {
      var f = fileIn.files && fileIn.files[0];
      if (!f) return;
      var rd = new G.FileReader();
      rd.onload = function () { st.file = String(rd.result || ""); st.preview = null; };
      rd.readAsText(f);
    };
    on('[data-rmd-bk="check"]', function () {
      var o = K.read(container.querySelector('[data-rmd-bk="restore"]'), {});
      st.error = ""; st.notice = "";
      if (!st.file) { st.error = "Choose the backup file first."; draw(container); return; }
      st.pass = o.rp; st.busy = true; draw(container);
      B.preview(st.file, o.rp).then(function (p) { st.busy = false; st.preview = p; draw(container); })
        .catch(function (e) { st.busy = false; st.error = msg(e); draw(container); });
    });
    function doRestore(mode) {
      st.busy = true; draw(container);
      B.restore(st.file, st.pass, mode).then(function (r) {
        st.busy = false; st.preview = null; st.file = null; st.pass = "";
        st.notice = "Restored: " + r.added + " added, " + r.updated + " updated, " + r.skipped + " kept because this phone had a newer copy.";
        draw(container);
      }).catch(function (e) { st.busy = false; st.error = msg(e); draw(container); });
    }
    on('[data-rmd-bk="merge"]', function () { doRestore("merge"); });
    on('[data-rmd-bk="replace"]', function () { doRestore("replace"); });
  }

  /* Weekly prompt for the ResearchMD home: "" when not due. */
  function bannerHtml() {
    if (!G.RMDBackup || !G.RMDBackup.needsPrompt()) return "";
    return '<div class="rmd-banner" role="status">' + BANNER +
      ' <button type="button" class="rmd-btn rmd-btn-sm" data-rmd-bk-open="1">Back up now</button></div>';
  }

  SMD.screens.backup = { render: render, bannerHtml: bannerHtml, FORGET_LINE: FORGET_LINE, BANNER: BANNER };

})(typeof window !== "undefined" ? window : globalThis);
