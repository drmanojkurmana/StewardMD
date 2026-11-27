"""Make test PDFs that exercise the text-layer features the Rust reader copies.

Usage: python make_test_pdfs.py OUT_DIR
Needs reportlab and fpdf2 (both only in the test venv, not the worker).
LibreOffice is used too when `soffice` is on PATH.
"""
import os
import random
import shutil
import subprocess
import sys
import zlib

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table,
                                TableStyle)

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
rng = random.Random(7)
WORDS = ("patients cohort hazard ratio confidence interval mortality treatment randomised baseline "
         "outcome analysis adjusted months follow-up survival trial primary secondary endpoint events "
         "median efficacy fluid office first affinity").split()
DEJAVU = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def sentence(n=40):
    return " ".join(rng.choice(WORDS) for _ in range(n))


def two_column(path, pages_hint=6):
    st = getSampleStyleSheet()["BodyText"]
    st.fontSize, st.leading = 9, 11
    doc = BaseDocTemplate(path, pagesize=A4)
    w, h = A4
    doc.addPageTemplates([PageTemplate(frames=[Frame(40, 40, (w - 100) / 2, h - 80, id="a"),
                                               Frame(60 + (w - 100) / 2, 40, (w - 100) / 2, h - 80, id="b")])])
    story = []
    for sec in range(pages_hint * 4):
        story.append(Paragraph(sentence(90) + f" (HR {rng.uniform(.5, 1.5):.2f}; 95% CI 0.61-1.20).", st))
        if sec % 5 == 0:
            data = [["Group", "n", "HR", "p"]] + [[f"Arm {i}", str(rng.randint(50, 500)),
                                                  f"{rng.uniform(.5, 1.5):.2f}", f"{rng.random():.3f}"] for i in range(6)]
            t = Table(data)
            t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black), ("FONTSIZE", (0, 0), (-1, -1), 7)]))
            story += [Spacer(1, 6), t, Spacer(1, 6)]
    doc.build(story)


def fonts_and_state(path):
    """Std14 fonts, TTF subset, ligature glyphs, char/word space, rise,
    horizontal scale, a Form XObject, and rotated text matrices."""
    pdfmetrics.registerFont(TTFont("DejaVu", DEJAVU))
    c = canvas.Canvas(path, pagesize=letter)
    y = 740
    for f in ["Helvetica", "Helvetica-Bold", "Times-Roman", "Times-Italic", "Courier", "Courier-Bold", "Symbol",
              "DejaVu"]:
        c.setFont(f, 11)
        c.drawString(50, y, f"{f}: " + sentence(8) if f != "Symbol" else "abgdp 123")
        y -= 18
    c.setFont("DejaVu", 12)
    c.drawString(50, y, "Ligatures: ﬁnal oﬃce ﬂuid eﬀect aﬄuent ﬆar été naïve – “q”")
    y -= 24
    t = c.beginText(50, y)
    t.setFont("Helvetica", 10)
    t.setCharSpace(1.5)
    t.textLine("Spaced out letters " + sentence(5))
    t.setCharSpace(0)
    t.setWordSpace(6)
    t.textLine("Wide word spacing " + sentence(6))
    t.setWordSpace(0)
    t.setHorizScale(70)
    t.textLine("Condensed horizontal scale " + sentence(6))
    t.setHorizScale(100)
    t.textOut("Base ")
    t.setRise(4)
    t.textOut("super")
    t.setRise(-3)
    t.textOut("sub")
    t.setRise(0)
    t.textLine(" back")
    t.setLeading(14)
    for _ in range(3):
        t.textLine(sentence(10))
    c.drawText(t)
    c.beginForm("hdr")
    c.setFont("Times-Bold", 14)
    c.drawString(0, 0, "Form XObject header text")
    c.endForm()
    c.saveState()
    c.translate(300, 300)
    c.scale(0.8, 0.8)
    c.doForm("hdr")
    c.restoreState()
    c.doForm("hdr")
    c.saveState()
    c.translate(450, 200)
    c.rotate(90)
    c.setFont("Helvetica", 10)
    c.drawString(0, 0, "Vertical up text " + sentence(4))
    c.restoreState()
    c.saveState()
    c.translate(100, 150)
    c.rotate(30)
    c.drawString(0, 0, "Slanted text " + sentence(4))
    c.restoreState()
    c.setFont("Helvetica", 8)
    for i in range(12):
        c.drawString(50 + 40 * (i % 6), 100 - 10 * (i // 6), f"{rng.random():.3f}")
    c.showPage()
    c.save()


def rotated(path):
    c = canvas.Canvas(path, pagesize=A4)
    for rot in (0, 90, 180, 270):
        c.setPageRotation(rot)
        c.setFont("Helvetica", 11)
        c.drawString(60, 780, f"Page rotated {rot} degrees")
        y = 750
        for _ in range(25):
            c.drawString(60, y, sentence(9))
            y -= 14
        c.setFont("Times-Roman", 9)
        c.drawString(320, 100, "Second block " + sentence(5))
        c.showPage()
    c.save()


def fpdf_type0(path):
    from fpdf import FPDF
    pdf = FPDF()
    pdf.add_font("DejaVu", "", DEJAVU)
    pdf.add_page()
    pdf.set_font("DejaVu", size=11)
    pdf.multi_cell(0, 6, "Unicode Type0 font: été, naïve, ß, Αβγ, жук, ﬁnal.\n" + sentence(200), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", size=10)
    pdf.multi_cell(0, 5, sentence(120), new_x="LMARGIN", new_y="NEXT")
    pdf.add_page()
    pdf.set_font("DejaVu", size=9)
    for _ in range(4):
        pdf.multi_cell(0, 5, sentence(90), new_x="LMARGIN", new_y="NEXT")
    pdf.output(path)


def raw_pdf(path):
    """Hand-written content: TJ kerning, ', ", T*, TL, Tz, Ts, Tc, Tw, a
    two-stream Contents array split mid-text, an inline image, cm, and a
    page with no text (needs OCR)."""
    def stream(data):
        comp = zlib.compress(data)
        return b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(comp) + comp + b"\nendstream"
    c1 = (b"BT /F1 12 Tf 14 TL 72 720 Td [(T) 80 (o) 15 (w) -250 (er) 120 (s)] TJ T* "
          b"(Second line) Tj (Quote line) ' 3 1 (Double quote) \" "
          b"/F2 10 Tf 0 -20 Td 1 Tc (Char spaced) Tj 0 Tc 4 Tw (Word spaced text) Tj 0 Tw ET\n"
          b"q 1 0 0 1 0 0 cm BI /W 2 /H 2 /BPC 8 /CS /G ID \x00\xff\xff\x00 EI Q\n"
          b"BT /F1 9 Tf 72 600 Td 50 Tz (Squeezed) Tj 100 Tz 3 Ts ( raised) Tj 0 Ts")
    c2 = (b" ( continues) Tj ET\n"
          b"BT /F3 11 Tf 2 0 0 2 300 500 Tm (Matrix scaled) Tj ET\n"
          b"BT /F1 10 Tf 72 400 Td [(Kerned)-3000(far)500(close)] TJ ET\n")
    c3 = b"0 0 1 rg 100 100 200 200 re f"
    # A Form XObject leaves pdfminer's device CTM at the form's last CTM, so
    # the text and lines after it are placed with that matrix.
    c4 = (b"/Fm Do BT /F1 10 Tf 72 300 Td (After form) Tj ET 72 280 m 300 280 l S "
          b"72 250 200 20 re S 72 200 m 172 200 l 172 230 l 72 230 l h S "
          b"q 2 0 0 2 0 0 cm /Fm Do Q BT /F1 10 Tf 72 150 Td (After Q) Tj ET")
    form = (b"1 0 0 1 10 10 cm BT /F1 10 Tf 0 0 Td (In form) Tj ET 0 0 m 100 0 l S 0 0 m 0 50 l 50 50 l S")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 9 0 R 11 0 R] /Count 3 /MediaBox [0 0 612 792] >>",
        b"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> "
        b"/Contents [7 0 R 8 0 R] >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding << /Differences [65 /B /C] >> >>",
        stream(c1),
        stream(c2),
        b"<< /Type /Page /Parent 2 0 R /Resources << >> /Contents 10 0 R /CropBox [10 10 600 780] >>",
        stream(c3),
        b"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> /XObject << /Fm 12 0 R >> >> "
        b"/Contents 13 0 R >>",
        stream(form)[:2] + b" /Type /XObject /Subtype /Form /BBox [0 0 200 200] /Matrix [1 0 0 1 100 400]"
        + stream(form)[2:],
        stream(c4),
    ]
    out = bytearray(b"%PDF-1.4\n")
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    x = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for o in offs:
        out += b"%010d 00000 n \n" % o
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
    open(path, "wb").write(out)


def libreoffice(out_dir):
    if not shutil.which("soffice"):
        return
    html = os.path.join(out_dir, "lo.html")
    with open(html, "w") as f:
        f.write("<html><body><h1>LibreOffice document</h1>")
        for _ in range(12):
            f.write(f"<p>{sentence(70)} été office affinity fluid.</p>")
        f.write("<table border=1>" + "".join(
            f"<tr><td>Arm {i}</td><td>{rng.randint(10, 99)}</td><td>{rng.random():.2f}</td></tr>" for i in range(6))
                + "</table></body></html>")
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf:writer_web_pdf_Export", "--outdir", out_dir, html],
                   check=False, capture_output=True, timeout=180)
    os.remove(html)


two_column(os.path.join(OUT, "two_column.pdf"))
fonts_and_state(os.path.join(OUT, "fonts_state.pdf"))
rotated(os.path.join(OUT, "rotated.pdf"))
fpdf_type0(os.path.join(OUT, "fpdf_type0.pdf"))
raw_pdf(os.path.join(OUT, "raw_ops.pdf"))
libreoffice(OUT)
print("\n".join(sorted(os.listdir(OUT))))
