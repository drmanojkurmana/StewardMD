const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, Header, Footer,
  convertMillimetersToTwip, ImageRun, VerticalAlign, PageNumber,
} = require('docx');
const fs = require('fs');

const FONT = "IBM Plex Sans";
const INK = "111C26", SLATE = "2F4356", SOFT = "6A8093";

const CONTENT = 10206;   // A4 minus 15mm side margins, DXA
const NONE = { style: BorderStyle.NONE, size: 0, color: "auto" };
const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const thin = (color = INK, size = 12) => ({ style: BorderStyle.SINGLE, size, color });

const LOGO = fs.readFileSync('/home/user/StewardMD/maik-logo.png');   // 498x200

const t = (text, o = {}) => new TextRun({ text, font: FONT, ...o });
const p = (children, o = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], ...o });

function cell(children, o = {}) {
  return new TableCell({
    width: { size: o.w, type: WidthType.DXA },
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    borders: o.borders,
    verticalAlign: o.valign,
    children: Array.isArray(children) ? children : [children],
  });
}

// ── the letterhead itself: logo | name | registered-office block, then a rule ──
const logoImg = new ImageRun({ data: LOGO, type: "png", transformation: { width: 110, height: 44 } });
const letterheadTable = new Table({
  width: { size: CONTENT, type: WidthType.DXA },
  columnWidths: [1500, 4113, 4593],
  borders: noBorders,
  rows: [new TableRow({ children: [
    cell([ p(logoImg, { alignment: AlignmentType.LEFT }) ], { w: 1500, borders: noBorders, valign: VerticalAlign.CENTER }),
    cell([
      p(t("MAIKNOWLEDGE LLP", { size: 33, bold: true, color: INK }), { spacing: { after: 40 } }),
      p(t("PRINCIPAL ENTITY  ·  HEALTH TECHNOLOGY", { size: 15, color: SOFT, characterSpacing: 26 })),
    ], { w: 4113, borders: noBorders }),
    cell([
      p(t("REGISTERED OFFICE", { size: 14, color: SOFT, characterSpacing: 22 }), { alignment: AlignmentType.RIGHT, spacing: { after: 30 } }),
      p(t("C/O Kurmana Nageswara Rao, Eden Gardens,", { size: 16, color: SLATE }), { alignment: AlignmentType.RIGHT }),
      p(t("Sector 5, MVP Colony, Visakhapatnam,", { size: 16, color: SLATE }), { alignment: AlignmentType.RIGHT }),
      p(t("Andhra Pradesh 530017, India", { size: 16, color: SLATE }), { alignment: AlignmentType.RIGHT }),
      p(t("support@stewardmd.in  ·  stewardmd.in", { size: 16, color: SLATE }), { alignment: AlignmentType.RIGHT }),
    ], { w: 4593, borders: noBorders }),
  ] })],
});
const rule = p(t(""), { border: { bottom: thin(INK, 12) }, spacing: { before: 60, after: 20 } });

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 21, color: INK } } } },
  sections: [{
    properties: {
      page: { margin: {
        top: convertMillimetersToTwip(10), right: convertMillimetersToTwip(15),
        bottom: convertMillimetersToTwip(10), left: convertMillimetersToTwip(15),
        header: convertMillimetersToTwip(8), footer: convertMillimetersToTwip(8),
      } },
    },
    headers: { default: new Header({ children: [letterheadTable, rule] }) },
    footers: { default: new Footer({ children: [
      p([
        t("MAIKNOWLEDGE LLP  ·  LLPIN ADA-6560  ·  PAN ACIFM2328K  ·  Visakhapatnam, Andhra Pradesh, India", { size: 15, color: SOFT }),
      ], { alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 4, color: "D6DEE4" } }, spacing: { before: 100, after: 40 } }),
      p([
        t("Page ", { size: 14, color: SOFT }),
        new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 14, color: SOFT }),
        t(" of ", { size: 14, color: SOFT }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 14, color: SOFT }),
      ], { alignment: AlignmentType.CENTER }),
    ] }) },
    // Body left intentionally blank — this is the reusable letterhead, not a specific letter.
    children: [
      p(t("Date: ", { size: 19, color: SLATE }), { spacing: { before: 300, after: 60 } }),
      p(t(""), { spacing: { after: 60 } }),
      p(t(""), { spacing: { after: 60 } }),
    ],
  }],
});

Packer.toBuffer(doc).then((b) => {
  fs.writeFileSync(__dirname + "/MaiKnowledge-LLP-Letterhead.docx", b);
  console.log("written", b.length, "bytes");
});
