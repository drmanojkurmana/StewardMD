/* StewardMD - ResearchMD consent for publication (SMD_RESEARCH.screens.pubconsent).
 * ES5 only. Plan v2 item 2: a ready template with every required element
 * (Do it myself) or MaiK task publication_consent (English plus one Indian
 * language). Saved as RMDStore kind "draftmeta", id "pubconsent".
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var LANGS = ["English", "Hindi", "Telugu", "Tamil", "Kannada", "Malayalam", "Marathi", "Bengali", "Gujarati"];
  var KEYS = [
    ["title", "Title"],
    ["whatWillBePublished", "What will be published"],
    ["readWorldwide", "Who may read it"],
    ["mayBeRecognised", "Your name"],
    ["canWithdraw", "Changing your mind"],
    ["careNotAffected", "Your care"],
    ["images", "Images to be published"],
    ["signatureBlock", "Signatures"]
  ];
  var SIGN_LINE = "Get the patient or next of kin to sign this before you submit. Some journals insist on their own form; check the journal's instructions.";

  /* Do it myself: every required element, in plain English. */
  function template(images) {
    return {
      title: "Consent for publication of a case report",
      whatWillBePublished: "Your doctor wants to publish a description of your illness, the tests and the treatment in a medical journal, together with the images listed below.",
      readWorldwide: "Medical journals are read by doctors and others all over the world, including online, where anyone may see them.",
      mayBeRecognised: "Your name will not be used. Even so, someone who knows you, or who treated you, may still recognise your case.",
      canWithdraw: "You can withdraw this consent at any time before the report is published.",
      careNotAffected: "Saying no, or withdrawing later, will not change your care in any way.",
      images: images || "No images",
      statements: [
        "I have read this form, or it has been read to me in a language I understand.",
        "I have had the chance to ask questions.",
        "I agree to the publication described above."
      ],
      signatureBlock: "Signature or thumb impression of the patient: ____________  Date: ________\n" +
        "Or, if the patient cannot consent: name of next of kin or legally acceptable representative: ____________  Relationship: ________  Signature or thumb impression: ____________  Date: ________\n" +
        "Witness name: ____________  Signature: ____________  Date: ________"
    };
  }

  function asText(v) {
    var lines = [], i;
    for (i = 0; i < KEYS.length; i++) {
      if (KEYS[i][0] === "signatureBlock") continue;
      lines.push(KEYS[i][1] + ": " + (v[KEYS[i][0]] || ""));
    }
    for (i = 0; i < (v.statements || []).length; i++) lines.push("[ ] " + v.statements[i]);
    lines.push("", v.signatureBlock || "");
    return lines.join("\n");
  }

  var st = { value: null, lang: "English", ai: null, notice: "", images: "" };

  function render(container) {
    var K = SMD.kit, proj = K.project();
    if (!proj) { K.noProject(container); return; }
    st.ai = SMD.ai ? SMD.ai.state() : { busy: false, error: null, drafted: {} };
    st.notice = "";
    container.innerHTML = K.header("Consent for publication", "Loading...");
    Promise.all([K.load(proj.id, "draftmeta", "pubconsent"), G.RMDStore ? G.RMDStore.list(proj.id, "image") : []]).then(function (r) {
      var names = [], i;
      for (i = 0; i < (r[1] || []).length; i++) names.push((r[1][i].value && r[1][i].value.label) || ("Image " + r[1][i].id));
      st.images = names.join(", ");
      st.value = r[0];
      draw(container, proj);
    });
  }

  function draw(container, proj) {
    var K = SMD.kit, v = st.value, h = [], i, j, versions;
    h.push(K.header("Consent for publication", "The patient's written permission to publish"));
    h.push(K.banner(SIGN_LINE));
    h.push('<div class="rmd-card rmd-form" data-rmd-pc="lang">' + K.field({ name: "lang", label: "Second language", type: "select", value: st.lang, options: LANGS.map(function (l) { return [l, l === "English" ? "English only" : l]; }) }) + '</div>');
    h.push(SMD.ai ? SMD.ai.barHtml(st.ai, { label: "consent form", cost: 2 }) : "");
    if (v) {
      versions = [v.englishVersion || v];
      if (v.translatedVersion) versions.push(v.translatedVersion);
      for (j = 0; j < versions.length; j++) {
        h.push('<div class="rmd-card"><h3 class="rmd-card-heading">' + K.esc(versions[j].language || "English") + '</h3>');
        if (v.byMaiK) h.push(SMD.ai ? '<span class="rmd-ai-note">Drafted by MaiK, check it</span>' : "");
        for (i = 0; i < KEYS.length; i++) h.push('<p class="rmd-p"><strong>' + K.esc(KEYS[i][1]) + ':</strong> ' + K.esc(versions[j][KEYS[i][0]] || "") + '</p>');
        for (i = 0; i < (versions[j].statements || []).length; i++) h.push('<p class="rmd-p">[ ] ' + K.esc(versions[j].statements[i]) + '</p>');
        h.push('</div>');
      }
      h.push('<button type="button" class="rmd-btn" data-rmd-pc="docx">Save DOCX</button>');
    }
    if (st.notice) h.push('<p class="rmd-mut" role="status">' + K.esc(st.notice) + '</p>');
    container.innerHTML = '<div class="rmd-pc-screen">' + h.join("") + '</div>';
    var sel = container.querySelector('[data-k="lang"]');
    if (sel) sel.onchange = function () { st.lang = sel.value; };
    var manual = container.querySelector('[data-rmd-ai="manual"]');
    if (SMD.ai) {
      SMD.ai.bind(container, st.ai, {
        pid: K.apiPid(proj), task: "publication_consent",
        input: function () { return { language: st.lang, images: imagesList() }; },
        apply: function (draft) {
          var d = draft || {};
          d.byMaiK = true;
          st.value = d;
          K.save(proj.id, "draftmeta", "pubconsent", d);
          return [];
        },
        render: function () { draw(container, proj); }
      });
    }
    if (manual) manual.onclick = function () {
      var t = template(imagesList());
      t.language = "English";
      st.value = { englishVersion: t, language: "English" };
      K.save(proj.id, "draftmeta", "pubconsent", st.value).then(function () { st.notice = "Template saved. Fill in the blanks by hand."; draw(container, proj); });
    };
    var dx = container.querySelector('[data-rmd-pc="docx"]');
    if (dx) dx.onclick = function () {
      var secs = [], vs = [st.value.englishVersion || st.value], k;
      if (st.value.translatedVersion) vs.push(st.value.translatedVersion);
      for (k = 0; k < vs.length; k++) secs.push({ id: "v" + k, heading: vs[k].title || "Consent for publication", level: 1, text: asText(vs[k]) });
      if (SMD.docxFromSections && SMD.p2 && SMD.p2.downloadBytes) {
        SMD.p2.downloadBytes("publication-consent.docx", SMD.docxFromSections("Consent for publication", secs),
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Consent for publication");
      } else {
        K.download("publication-consent.txt", secs.map(function (s) { return s.text; }).join("\n\n"), "text/plain");
      }
    };
  }

  function imagesList() { return st.images || "No images"; }

  SMD.screens.pubconsent = { render: render, template: template, KEYS: KEYS, SIGN_LINE: SIGN_LINE, asText: asText };

})(typeof window !== "undefined" ? window : globalThis);
