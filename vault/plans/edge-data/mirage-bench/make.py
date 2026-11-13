import random, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
out=sys.argv[1]; random.seed(7)
F=lambda n,s: ImageFont.truetype(f"/usr/share/fonts/truetype/{n}",s)
def card(lines,font,size=(900,520),bg="white",fg="black",rot=0,blur=0,noise=0):
    im=Image.new("RGB",size,bg); d=ImageDraw.Draw(im); y=30
    for l in lines: d.text((40,y),l,fill=fg,font=font); y+=font.size+22
    if noise:
        px=im.load()
        for _ in range(noise): x,yy=random.randrange(size[0]),random.randrange(size[1]); px[x,yy]=(90,90,90)
    if rot: im=im.rotate(rot,expand=True,fillcolor=bg)
    if blur: im=im.filter(ImageFilter.GaussianBlur(blur))
    return im
rx=["Rx","Tab. Amoxicillin 500 mg  1-0-1  x 5 days","Tab. Paracetamol 650 mg  SOS","Cap. Omeprazole 20 mg  OD before food","Syp. Cetirizine 5 ml  HS"]
card(rx,F("liberation/LiberationSans-Regular.ttf",34)).save(f"{out}/01_rx_printed.png")
card(rx,F("liberation/LiberationSerif-Italic.ttf",34),rot=3,blur=0.8,noise=4000,bg=(245,240,225)).save(f"{out}/02_rx_italic_skew.png")
card(["PANTOPRAZOLE GASTRO-RESISTANT","TABLETS IP 40 mg","Each tablet contains Pantoprazole Sodium IP","Batch No. PX2291   Exp. 08/2027"],F("dejavu/DejaVuSans-Bold.ttf",30),bg=(200,205,210),fg=(20,40,120),rot=-4,blur=1.0).save(f"{out}/03_strip_label.png")
card(["Tab. Metformin 500 mg  BD after food"],F("liberation/LiberationSans-Regular.ttf",40),size=(900,140)).save(f"{out}/04_single_bd.png")
card(["Tab. Amlodipine 5 mg  OD"],F("liberation/LiberationSans-Regular.ttf",40),size=(900,140)).save(f"{out}/05_single_od.png")
card(["Inj. Ceftriaxone 1 g IV  TDS"],F("liberation/LiberationSans-Regular.ttf",40),size=(900,140)).save(f"{out}/06_single_tds.png")
card(["Serum Creatinine   1.2 mg/dL   (0.7 - 1.3)","Potassium   5.8 mmol/L   H","Haemoglobin   9.1 g/dL   L"],F("dejavu/DejaVuSansMono.ttf",30),size=(900,260)).save(f"{out}/07_lab.png")
