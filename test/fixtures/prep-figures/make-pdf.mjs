/* Synthetic PDFs for the figure filter (prep-source.js: pickImages, scanPages, classifyPixels, figureRegions), unit and
 * headless. Owner bug 2026-10-09: a scanned page of notes ("Lymphoma", a table, a boxed tip) became a question image.
 * Everything here is drawn from code, no real document:
 *   xrayPage   a digital page: a heading, body text and an embedded 400 x 480 chest-film picture  -> crop = the film only
 *   textPage   a digital page of text and a ruled table, no pictures                               -> no image question
 *   scanText   a scanned page (one 992 x 1403 picture filling the page) of text lines, a table and a dark boxed tip
 *              -> no image question
 *   scanXray   a scanned page of text with a chest film printed in the middle                       -> one region, the film
 *   textImg    a digital page with an embedded picture OF A TABLE (half the page)                   -> no image question
 *   ocrXray    the chest film again, but with an OCR text layer (invisible text, 300 characters) over it -> out
 * makeFigurePdf(names?) -> a latin1 string (one page per name, in order). PIX.<name>() -> { w, h, g } for unit tests. */
import { deflateSync } from "node:zlib";

// A tiny deterministic random (mulberry32) so the pictures are the same every run.
function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvas(w, h, v) { return { w, h, g: new Uint8Array(w * h).fill(v) }; }
function rect(c, x0, y0, x1, y1, v) { for (let y = Math.max(0, y0); y < Math.min(c.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(c.w, x1); x++) c.g[y * c.w + x] = v; }
// A line of "text": words of glyphs, each glyph one or two thin vertical strokes with a top or bottom bar, the way
// letters ink a row (about a quarter of the row's pixels).
function textLine(c, x0, y0, x1, size, r, ink) {
  let x = x0;
  while (x < x1 - size * 3) {
    const n = 2 + Math.floor(r() * 7);
    for (let k = 0; k < n && x < x1 - size; k++) {
      const gw = Math.max(3, Math.round(size * 0.55)), sw = Math.max(1, Math.round(size / 9));
      rect(c, x, y0, x + sw, y0 + size, ink);
      if (r() > 0.4) rect(c, x + gw - sw, y0 + Math.round(size * 0.3), x + gw, y0 + size, ink);
      if (r() > 0.5) rect(c, x, y0 + Math.round(size * 0.3), x + gw, y0 + Math.round(size * 0.3) + sw, ink);
      else rect(c, x, y0 + size - sw, x + gw, y0 + size, ink);
      x += gw + Math.max(2, Math.round(size * 0.22));
    }
    x += Math.round(size * 0.7);
  }
}
function paragraph(c, x0, y0, x1, lines, size, r, ink = 30) { for (let i = 0; i < lines; i++) textLine(c, x0, y0 + i * Math.round(size * 1.7), x1 - (i === lines - 1 ? (x1 - x0) / 3 : 0), size, r, ink); return y0 + lines * Math.round(size * 1.7); }
function table(c, x0, y0, x1, rows, cols, rowH, size, r) {
  for (let i = 0; i <= rows; i++) rect(c, x0, y0 + i * rowH, x1, y0 + i * rowH + 2, 40);
  for (let j = 0; j <= cols; j++) { const x = Math.round(x0 + (x1 - x0) * j / cols); rect(c, x, y0, x + 2, y0 + rows * rowH, 40); }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const cx = Math.round(x0 + (x1 - x0) * j / cols); textLine(c, cx + 8, y0 + i * rowH + Math.round((rowH - size) / 2), Math.round(x0 + (x1 - x0) * (j + 1) / cols) - 8, size, r, 30); }
  return y0 + rows * rowH;
}
// A chest film: soft dark lungs, a bright spine and heart, ribs, film grain. No flat shade covers much of it.
function film(w, h, seed) {
  const c = canvas(w, h, 0), r = rnd(seed);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h, spine = Math.max(0, 1 - Math.abs(u - 0.5) / 0.09), lungL = Math.hypot((u - 0.3) / 0.17, (v - 0.48) / 0.33), lungR = Math.hypot((u - 0.7) / 0.17, (v - 0.48) / 0.33);
    let val = 150 + 40 * Math.sin(u * 7) * Math.cos(v * 5);
    if (lungL < 1 || lungR < 1) val = 55 + 50 * Math.min(lungL, lungR);
    if ((lungL < 1.05 || lungR < 1.05) && Math.sin(v * 46 + Math.abs(u - 0.5) * 9) > 0.86) val += 70;
    val += 120 * spine; if (Math.hypot((u - 0.56) / 0.16, (v - 0.66) / 0.14) < 1) val += 60;
    val += (r() - 0.5) * 26;
    c.g[y * w + x] = Math.max(0, Math.min(255, Math.round(val)));
  }
  return c;
}
function paste(c, s, x0, y0) { for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (x0 + x < c.w && y0 + y < c.h) c.g[(y0 + y) * c.w + x0 + x] = s.g[y * s.w + x]; }

export const PIX = {
  film: () => film(400, 480, 7),
  // A page of notes as one scanned picture: a heading, paragraphs, a ruled table, a dark boxed tip with light text.
  scanText: () => {
    const c = canvas(992, 1403, 246), r = rnd(11);
    let y = 90;
    textLine(c, 80, y, 520, 44, r, 20); y += 110;                 // "Lymphoma"
    y = paragraph(c, 80, y, 910, 6, 18, r) + 30;
    y = table(c, 80, y, 910, 7, 3, 46, 16, r) + 40;
    rect(c, 80, y, 910, y + 210, 70);                              // the boxed tip, a dark fill
    for (let i = 0; i < 5; i++) textLine(c, 110, y + 24 + i * 36, 880, 18, r, 235);
    y += 250;
    paragraph(c, 80, y, 910, 8, 18, r);
    return c;
  },
  // The same kind of page with a chest film printed in it.
  scanXray: () => {
    const c = canvas(992, 1403, 246), r = rnd(12);
    let y = 90;
    textLine(c, 80, y, 560, 40, r, 20); y += 100;
    y = paragraph(c, 80, y, 910, 5, 18, r) + 40;
    paste(c, film(460, 552, 9), 266, y); y += 552 + 40;
    paragraph(c, 80, y, 910, 7, 18, r);
    return c;
  },
  // A picture of a table (a screenshot pasted into slides): rows of text in a grid.
  textImg: () => { const c = canvas(700, 520, 252), r = rnd(13); textLine(c, 30, 24, 400, 30, r, 25); table(c, 30, 90, 670, 9, 3, 44, 15, r); return c; },
};

function flate(c) { return deflateSync(Buffer.from(c.g)); }
const PAGES = {
  xrayPage: { imgs: { Fx: "film" }, draw: "q 240 0 0 288 178 300 cm /Fx Do Q",
    text: [[20, 780, "Chest radiology"], [11, 740, "Tension pneumothorax shifts the mediastinum away from the affected side."], [11, 725, "The trachea deviates and the hemithorax is hyperlucent on the film."],
      [11, 270, "Figure 1 is a chest X-ray of tension pneumothorax with mediastinal shift."], [11, 255, "Needle decompression in the second intercostal space comes before the film."]] },
  textPage: { imgs: {}, draw: "0.2 G 1 w 50 400 495 160 re S 50 440 m 545 440 l S 50 480 m 545 480 l S 50 520 m 545 520 l S 215 400 m 215 560 l S 380 400 m 380 560 l S",
    text: [[20, 780, "Lymphoma"], [11, 740, "Hodgkin lymphoma shows Reed Sternberg cells in a background of reactive cells."], [11, 725, "Nodular sclerosis is the commonest subtype in young adults."],
      [11, 540, "Subtype"], [11, 500, "Nodular sclerosis"], [11, 460, "Mixed cellularity"], [11, 420, "Lymphocyte depleted"]] },
  scanText: { imgs: { Sc: "scanText" }, draw: "q 595 0 0 842 0 0 cm /Sc Do Q", text: [] },
  scanXray: { imgs: { Sx: "scanXray" }, draw: "q 595 0 0 842 0 0 cm /Sx Do Q", text: [] },
  textImg: { imgs: { Ti: "textImg" }, draw: "q 420 0 0 312 88 380 cm /Ti Do Q", text: [[20, 780, "Staging"], [11, 740, "The table below gives the Ann Arbor stages."]] },
  ocrXray: { imgs: { Fx: "film" }, draw: "q 250 0 0 300 170 290 cm /Fx Do Q",
    text: [[11, 270, "Figure 1 is a chest X-ray."]],
    hidden: Array.from({ length: 12 }, (_, i) => [9, 560 - i * 20, "ocr layer words over the film page text that a scanner added line " + i]) },
};

export function makeFigurePdf(names) {
  names = names || ["xrayPage", "textPage", "scanText", "scanXray", "textImg", "ocrXray"];
  const objs = [], add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(null), pagesObj = add(null), font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [], made = {};
  for (const name of names) {
    const pg = PAGES[name], xo = [];
    for (const [k, pix] of Object.entries(pg.imgs)) {
      const key = name + ":" + k;
      if (!made[key]) { const c = PIX[pix](), d = flate(c); made[key] = add({ head: `<< /Type /XObject /Subtype /Image /Width ${c.w} /Height ${c.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${d.length} >>`, bin: d }); }
      xo.push(`/${k} ${made[key]} 0 R`);
    }
    const stream = pg.draw + "\n" + pg.text.map(([size, y, t]) => `BT /F1 ${size} Tf 50 ${y} Td (${t}) Tj ET`).join("\n") + "\n" +
      (pg.hidden || []).map(([size, y, t]) => `BT 3 Tr /F1 ${size} Tf 180 ${y} Td (${t}) Tj ET`).join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> /XObject << ${xo.join(" ")} >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    if (o && o.bin) out += `${i + 1} 0 obj\n${o.head}\nstream\n` + o.bin.toString("latin1") + "\nendstream\nendobj\n";
    else out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
