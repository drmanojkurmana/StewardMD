"""Cut the owner-supplied Apple Watch frame images out of their baked checkerboard / white backgrounds.

Flood-fills neutral light pixels from the border (outside) and from the centre (the screen hole),
working at 2x. Writes <name>-frame.png; copy the results into img/frames/.
"""
import sys
from collections import deque
from PIL import Image, ImageFilter
U=(sys.argv[1].rstrip('/') + '/') if len(sys.argv) > 1 else './'
def bgpix(p, lo, tol=5):
    return max(p)-min(p) <= tol and min(p) >= lo
TOL=5
def flood(im, seeds, lo):
    w,h=im.size; px=im.load(); seen=bytearray(w*h); q=deque()
    for s in seeds:
        if bgpix(px[s], lo, TOL): q.append(s); seen[s[1]*w+s[0]]=1
    while q:
        x,y=q.popleft()
        for nx,ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
            if 0<=nx<w and 0<=ny<h and not seen[ny*w+nx] and bgpix(px[nx,ny], lo, TOL):
                seen[ny*w+nx]=1; q.append((nx,ny))
    return seen
def run(src, name, lo):
    im=Image.open(U+src).convert('RGB'); im=im.resize((im.width*2,im.height*2),Image.LANCZOS); w,h=im.size
    border=[(x,0) for x in range(w)]+[(x,h-1) for x in range(w)]+[(0,y) for y in range(h)]+[(w-1,y) for y in range(h)]
    out=flood(im,border,lo); scr=flood(im,[(w//2,h//2)],lo)
    a=Image.new('L',(w,h),255); ap=a.load(); sm=Image.new('L',(w,h),0); sp=sm.load()
    for y in range(h):
        for x in range(w):
            i=y*w+x
            if out[i] or scr[i]: ap[x,y]=0
            if scr[i]: sp[x,y]=255
    a=a.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1.1))
    fr=im.convert('RGBA'); fr.putalpha(a)
    # drop detached text below the watch: keep rows up to the first long empty gap after the body
    rows=[any(a.getpixel((x,y))>0 for x in range(0,w,2)) for y in range(h)]
    top=rows.index(True); y=top
    while y<h and rows[y]: y+=1
    fr=fr.crop((0,top,w,y)); sm=sm.crop((0,top,w,y))
    bb=fr.getbbox(); fr=fr.crop(bb); sm=sm.crop(bb)
    fr.save(name+'-frame.png'); print(name, fr.size, 'screen bbox', sm.getbbox())
run('a6aae41b-image.webp','ocean',226)
TOL=12
run('32d3a632-image.jpg','alpine',224)
