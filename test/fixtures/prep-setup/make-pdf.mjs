/* A small synthetic PDF for the image-question tests (unit and headless): two pages of text, two real pictures (a
 * 240 x 240 "X-ray" on page 1 and a 260 x 200 "smear" on page 2, grey levels drawn as shapes), a logo drawn small at
 * the top of both pages (repeated: must be left out) and a 60 x 60 icon drawn large (too few pixels: left out).
 * Images are DeviceGray, FlateDecode (node zlib). makeImagePdf() -> a latin1 string, write it with "latin1". */
import { deflateSync } from "node:zlib";

function gray(w, h, f) {
  const b = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b[y * w + x] = Math.max(0, Math.min(255, Math.round(f(x / w, y / h))));
  return deflateSync(b);
}
// A chest-film look: dark lung fields, a bright mediastinum and ribs; and a smear: pale field with dark round cells.
const XRAY = (x, y) => { const d = Math.abs(x - 0.5); let v = 40 + 180 * Math.max(0, 0.12 - d) / 0.12; if (Math.sin(y * 40) > 0.85) v += 60; if (x < 0.18 || x > 0.82) v += 90; return v; };
const SMEAR = (x, y) => { let v = 225; for (const [cx, cy] of [[0.3, 0.3], [0.7, 0.4], [0.45, 0.72], [0.8, 0.8]]) { const r = Math.hypot(x - cx, (y - cy) * 1.3); if (r < 0.1) v = 70 + r * 600; } return v; };
const LOGO = (x, y) => (Math.hypot(x - 0.5, y - 0.5) < 0.4 ? 30 : 255);
const ICON = (x, y) => (x > 0.3 && x < 0.7 ? 0 : 255);

export function makeImagePdf() {
  const imgs = {
    Ia: { w: 240, h: 240, data: gray(240, 240, XRAY) },
    Ib: { w: 260, h: 200, data: gray(260, 200, SMEAR) },
    Lg: { w: 220, h: 220, data: gray(220, 220, LOGO) },
    Ic: { w: 60, h: 60, data: gray(60, 60, ICON) },
  };
  const pages = [
    { text: [[20, 780, "Chest radiology"], [11, 300, "Figure 1 is a chest X-ray of tension pneumothorax with mediastinal shift to the opposite side."],
      [11, 285, "The trachea deviates away from the affected side and the hemithorax is hyperlucent."], [11, 270, "Needle decompression in the second intercostal space comes before the film."]],
      draw: "q 300 0 0 300 150 330 cm /Ia Do Q q 40 0 0 40 500 790 cm /Lg Do Q q 200 0 0 200 60 60 cm /Ic Do Q", xo: ["Ia", "Lg", "Ic"] },
    { text: [[20, 780, "Blood smear"], [11, 300, "Figure 2 is a peripheral smear showing target cells in thalassaemia."],
      [11, 285, "Target cells have a central dark spot of haemoglobin within a pale ring."], [11, 270, "Iron overload follows repeated transfusion in thalassaemia major."]],
      draw: "q 260 0 0 200 160 360 cm /Ib Do Q q 40 0 0 40 500 790 cm /Lg Do Q", xo: ["Ib", "Lg"] },
  ];
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(null), pagesObj = add(null), font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const imgObj = {};
  for (const k of Object.keys(imgs)) {
    const im = imgs[k];
    imgObj[k] = add({ head: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${im.data.length} >>`, bin: im.data });
  }
  const kids = [];
  for (const pg of pages) {
    const stream = pg.draw + "\n" + pg.text.map(([size, y, t]) => `BT /F1 ${size} Tf 50 ${y} Td (${t}) Tj ET`).join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const xo = pg.xo.map((k) => `/${k} ${imgObj[k]} 0 R`).join(" ");
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> /XObject << ${xo} >> >> /Contents ${content} 0 R >>`));
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
