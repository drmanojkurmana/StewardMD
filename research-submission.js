/* StewardMD - ResearchMD submission pack (window.SMD_RESEARCH_SUBMISSION).
 * Phase 5B.4. Pure ES5 IIFE: no DOM, no clock, no random source, no I/O.
 * Dual export: browser global SMD_RESEARCH_SUBMISSION and CommonJS module.exports.
 *
 * coverLetter(input, template) drafts a letter from the fields the caller
 * passes. Missing fields are listed and left blank. The date is the caller's
 * string. This module never sends a manuscript anywhere.
 *
 * declarations(input) builds funding, competing interests, ethics, data
 * availability, and the generative-model statement. A missing AI field is
 * reported as not stated. It is not turned into a claim that a model was
 * or was not used.
 *
 * manifest(input) lists the manuscript file, the checklist, the PRISMA
 * diagram, and any figures. complete is true only when the first three
 * are named. The researcher uploads the pack on the journal site.
 *
 * Generated text uses commas and the word "to". No em-dash and no en-dash.
 */
(function (G) {
  "use strict";

  var VERSION = "rmd1";
  var NAME = "research-submission";
  var NOTE = "The researcher uploads these files on the journal site. ResearchMD prepares the pack and does not send it.";

  function isArr(v) { return Object.prototype.toString.call(v) === "[object Array]"; }

  function trim(s) { return s == null ? "" : String(s).replace(/^\s+|\s+$/g, ""); }

  function textOf(v) {
    var i, parts, piece;
    if (v == null || typeof v === "boolean") return "";
    if (typeof v === "number" && isFinite(v)) return String(v);
    if (isArr(v)) {
      parts = [];
      for (i = 0; i < v.length; i++) {
        piece = textOf(v[i]);
        if (piece) parts.push(piece);
      }
      return parts.join(", ");
    }
    if (typeof v === "object") return "";
    return trim(v);
  }

  function unique(list) {
    var out = [], seen = {}, i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && !seen[list[i]]) {
        seen[list[i]] = 1;
        out.push(list[i]);
      }
    }
    return out;
  }

  function block(status, text) { return { status: status, text: text || "" }; }

  function fundingBlock(v) {
    var source, role, text;
    if (v == null || v === "") return block("missing", "");
    if (typeof v === "string") return trim(v) ? block("stated", trim(v)) : block("missing", "");
    if (v.none === true) return block("stated", "The authors received no specific funding for this work.");
    source = textOf(v.source || v.funder);
    role = textOf(v.role);
    if (!source && !role) return block("missing", "");
    text = source ? ("Funding: " + source + ".") : "";
    if (role) text = text ? (text + " Role of the funder: " + role) : ("Role of the funder: " + role);
    return block("stated", text);
  }

  function conflictBlock(v) {
    var statement;
    if (v == null || v === "") return block("missing", "");
    if (typeof v === "string") return trim(v) ? block("stated", trim(v)) : block("missing", "");
    if (v.none === true) return block("stated", "The authors declare no competing interests.");
    statement = textOf(v.statement || v.text);
    if (!statement) return block("missing", "");
    return block("stated", statement);
  }

  function ethicsBlock(v) {
    var reason, board, number, consent, parts;
    if (v == null || v === "") return block("missing", "");
    if (typeof v === "string") return trim(v) ? block("stated", trim(v)) : block("missing", "");
    if (v.notRequired === true) {
      reason = textOf(v.reason);
      return block("stated", reason ? ("Ethics review was not required. " + reason) : "Ethics review was not required.");
    }
    board = textOf(v.board || v.committee);
    number = textOf(v.number || v.id);
    consent = textOf(v.consent);
    if (!board && !number && !consent) return block("missing", "");
    parts = [];
    if (board) parts.push("Reviewed by " + board + (number ? (" (" + number + ")") : "") + ".");
    else if (number) parts.push("Ethics reference " + number + ".");
    if (consent) parts.push("Consent: " + consent);
    return block("stated", parts.join(" "));
  }

  function dataBlock(v) {
    var statement, url, text;
    if (v == null || v === "") return block("missing", "");
    if (typeof v === "string") return trim(v) ? block("stated", trim(v)) : block("missing", "");
    if (v.none === true) return block("stated", "No additional data are available.");
    statement = textOf(v.statement || v.text);
    url = textOf(v.url);
    if (!statement && !url) return block("missing", "");
    text = statement || "";
    if (url) text = text ? (text + " " + url) : url;
    return block("stated", text);
  }

  function aiBlock(v) {
    var tools, role, text;
    if (v == null || v === "") return block("missing", "");
    if (typeof v === "string") return trim(v) ? block("stated", trim(v)) : block("missing", "");
    if (v.used === false) return block("stated", "No generative model was used to draft the manuscript or to calculate results.");
    if (v.used === true) {
      tools = textOf(v.tools);
      role = textOf(v.role);
      if (!tools && !role) return block("partial", "A generative model was used. The tool and the role were not recorded.");
      text = "A generative model was used.";
      if (tools) text += " Tools: " + tools + ".";
      if (role) text += " Role: " + role;
      return block("stated", text);
    }
    return block("missing", "");
  }

  function declarations(input) {
    var src = input || {};
    var blocks = {
      funding: fundingBlock(src.funding),
      conflicts: conflictBlock(src.conflicts != null ? src.conflicts : src.competingInterests),
      ethics: ethicsBlock(src.ethics),
      dataAvailability: dataBlock(src.dataAvailability != null ? src.dataAvailability : src.data),
      aiUse: aiBlock(src.aiUse != null ? src.aiUse : src.ai)
    };
    var order = [
      ["funding", "Funding"],
      ["conflicts", "Competing interests"],
      ["ethics", "Ethics"],
      ["dataAvailability", "Data availability"],
      ["aiUse", "Use of generative models"]
    ];
    var lines = [], missing = [], i, key, label, row;
    for (i = 0; i < order.length; i++) {
      key = order[i][0];
      label = order[i][1];
      row = blocks[key];
      if (row.status === "missing") missing.push(label);
      else lines.push(label + ": " + row.text);
    }
    if (missing.length) lines.push("Not stated: " + missing.join(", ") + ".");
    return {
      funding: blocks.funding,
      conflicts: blocks.conflicts,
      ethics: blocks.ethics,
      dataAvailability: blocks.dataAvailability,
      aiUse: blocks.aiUse,
      missing: missing,
      text: lines.join("\n")
    };
  }

  function fieldText(input, key) {
    if (!input || typeof input !== "object") return "";
    if (key === "declarations" && input.declarations && typeof input.declarations === "object") {
      return declarations(input.declarations).text;
    }
    return textOf(input[key]);
  }

  function coverLetter(input, template) {
    var src = input && typeof input === "object" ? input : {};
    var missing = [];
    var body, title, journal, date, editor, summary, studyType, registration, authors, corresponding, decl, lines, subject;
    function take(key) {
      var v = fieldText(src, key);
      if (!v) missing.push(key);
      return v;
    }
    if (template) {
      body = String(template).replace(/\{\{([A-Za-z0-9_]+)\}\}/g, function (_all, key) {
        var v = fieldText(src, key);
        if (!v) missing.push(key);
        return v;
      });
      title = textOf(src.title);
      subject = title ? ("Cover letter draft: " + title) : "Cover letter draft";
      return { draft: true, sent: false, subject: subject, body: body, missing: unique(missing) };
    }
    title = take("title");
    journal = take("journal");
    date = take("date");
    editor = take("editor");
    summary = take("summary");
    studyType = take("studyType");
    registration = take("registration");
    authors = take("authors");
    corresponding = take("corresponding");
    decl = take("declarations");
    lines = [];
    if (date) { lines.push(date); lines.push(""); }
    if (editor) lines.push(editor);
    if (journal) lines.push(journal);
    if (editor || journal) lines.push("");
    lines.push(editor ? ("Dear " + editor + ",") : "Dear Editor,");
    lines.push("");
    if (title && journal) lines.push("Please consider the enclosed manuscript, \"" + title + "\", for " + journal + ".");
    else if (title) lines.push("Please consider the enclosed manuscript, \"" + title + "\".");
    else lines.push("Please consider the enclosed manuscript.");
    lines.push("");
    if (summary) { lines.push(summary); lines.push(""); }
    if (studyType) lines.push("Study type: " + studyType + ".");
    if (registration) lines.push("Registration: " + registration + ".");
    if (studyType || registration) lines.push("");
    lines.push("All authors have approved this manuscript. It is not under consideration at another journal.");
    lines.push("");
    if (decl) { lines.push(decl); lines.push(""); }
    lines.push("Yours sincerely,");
    if (authors) lines.push(authors);
    if (corresponding) lines.push(corresponding);
    subject = title ? ("Cover letter draft: " + title) : "Cover letter draft";
    return { draft: true, sent: false, subject: subject, body: lines.join("\n"), missing: unique(missing) };
  }

  function fileEntry(role, file) {
    var name = "";
    if (typeof file === "string") name = trim(file);
    else if (file && typeof file === "object") name = trim(file.filename || file.name || "");
    return {
      role: role,
      filename: name,
      present: !!name,
      bytes: (file && typeof file === "object" && typeof file.bytes === "number" && isFinite(file.bytes)) ? file.bytes : null,
      sha256: (file && typeof file === "object" && file.sha256) ? String(file.sha256) : null,
      caption: (file && typeof file === "object" && file.caption) ? String(file.caption) : null
    };
  }

  function manifest(input) {
    var src = input && typeof input === "object" ? input : {};
    var figures = isArr(src.figures) ? src.figures : [];
    var files = [];
    var gaps = [];
    var i;
    files.push(fileEntry("manuscript", src.manuscriptDocx != null ? src.manuscriptDocx : src.manuscript));
    files.push(fileEntry("checklist", src.checklist));
    files.push(fileEntry("prisma-diagram", src.prismaDiagram != null ? src.prismaDiagram : src.diagram));
    for (i = 0; i < figures.length; i++) files.push(fileEntry("figure", figures[i]));
    if (!files[0].present) gaps.push("manuscript");
    if (!files[1].present) gaps.push("checklist");
    if (!files[2].present) gaps.push("prisma-diagram");
    return {
      kind: "submission-pack",
      version: VERSION,
      files: files,
      gaps: gaps,
      complete: gaps.length === 0,
      figureCount: figures.length,
      researcherUploads: true,
      sendsToJournal: false,
      note: NOTE
    };
  }

  var API = {
    name: NAME,
    version: VERSION,
    coverLetter: coverLetter,
    declarations: declarations,
    manifest: manifest
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = API; }
  if (G) { G.SMD_RESEARCH_SUBMISSION = API; }

})(typeof window !== "undefined" ? window : undefined);
