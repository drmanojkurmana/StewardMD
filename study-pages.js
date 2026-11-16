/* Study Studio Phase 3: pages and navigation (study-pages.js). ES5, Old Android WebViews.
   Enhances study.js without rewriting pen code. New file loaded AFTER study.js via prep-loader.js.
   Implements top bar, Add Page popover, templates, More menu, Settings, navigator, thumbnails, favourites, outlines, zoom window.
*/
(function (G) {
  "use strict";
  var PURE = {};
  /* pure helpers */
  function tplIsDark(t){ return /-dark$/.test(t||""); }
  function tplBase(t){ return String(t||"blank").replace(/-dark$/,""); }
  function tplLabel(t){
    var b=tplBase(t), d=tplIsDark(t), base="";
    if(b==="blank") base="Blank";
    else if(b==="ruled") base="Ruled (narrow)";
    else if(b==="ruled-wide") base="Ruled (wide)";
    else if(b==="grid") base="Grid";
    else if(b==="dotgrid") base="Dotted";
    else if(b==="cornell") base="Cornell";
    else if(b==="mcq") base="MCQ sheet";
    else base=b;
    return base+(d?" (dark)":"");
  }
  var TPLS = ["blank","blank-dark","ruled","ruled-dark","ruled-wide","ruled-wide-dark","grid","grid-dark","dotgrid","dotgrid-dark","cornell","cornell-dark","mcq","mcq-dark"];
  function tplList(){ return TPLS.slice(); }
  function addIndex(cur,total,where){
    var i;
    if(where==="before") i=cur-1;
    else if(where==="after") i=cur;
    else i=total; /* last */
    if(i<0) i=0; if(i>total) i=total;
    return i;
  }
  function insertAt(arr,idx,val){ var b=arr.slice(); b.splice(idx,0,val); return b; }
  function removeAt(arr,idx){ var b=arr.slice(); if(idx>=0&&idx<b.length) b.splice(idx,1); return b; }
  function rotateStep(rot,dir){ var d=dir||1; return ((rot||0)+d+4)%4; }
  function clampZoom(z){ z=Number(z)||1; if(z<0.5) z=0.5; if(z>4) z=4; return z; }
  function pinchZoom(z0,d0,d1){ if(!d0) return z0; return clampZoom(z0*d1/d0); }
  function favKeyFor(docIsNb, page){
    /* for nb page is id, for pdf page is number */
    return String(page);
  }
  function isFav(doc, key){ var m=doc&&doc.favPages; if(!m) return false; return !!m[key]; }
  function toggleFav(map,key){ var n={}; var k; for(k in map) if(Object.prototype.hasOwnProperty.call(map,k)) n[k]=map[k]; var v=n[key]?false:true; if(v) n[key]=true; else delete n[key]; return n; }
  function flattenOutline(node, out, level){
    var i;
    out=out||[]; level=level||0;
    if(!node) return out;
    /* node can be array or single object */
    var arr=Array.isArray(node)?node:[node];
    for(i=0;i<arr.length;i++){
      var n=arr[i];
      var title=n.title||n.label||"";
      var page=n.dest? n.dest[0] : (n.page||1);
      if(typeof page==="string" && /^\/\d/.test(page)) page=parseInt(page.slice(1),10);
      out.push({title:String(title), page: typeof page==="number"?page:1, level: level});
      if(n.items && n.items.length) flattenOutline(n.items, out, level+1);
    }
    return out;
  }
  function filterOutline(list,q){
    q=String(q||"").trim().toLowerCase();
    if(!q) return list.slice();
    return list.filter(function(e){ return (e.title||"").toLowerCase().indexOf(q)!==-1; });
  }
  function visibleRange(scrollTop, clientH, heights, marginFrac){
    var n=heights.length, i, top=scrollTop - clientH*(marginFrac||1.5), bot=scrollTop+clientH*(1+(marginFrac||1.5)), off=0, lo=n, hi=-1;
    for(i=0;i<n;i++){ var h=heights[i]; if(off+h>=top&&off<=bot){ if(i<lo)lo=i; if(i>hi)hi=i; } off+=h+16; if(off>bot&&hi!==-1) break; }
    if(hi===-1) return [0,-1];
    return [lo,hi];
  }
  function fitWidth(baseW, containerW){ if(!baseW) return 1; return containerW/baseW; }
  PURE = { tplIsDark: tplIsDark, tplBase: tplBase, tplLabel: tplLabel, TPLS: TPLS, tplList: tplList, addIndex: addIndex, insertAt: insertAt, removeAt: removeAt, rotateStep: rotateStep, clampZoom: clampZoom, pinchZoom: pinchZoom, isFav: isFav, toggleFav: toggleFav, flattenOutline: flattenOutline, filterOutline: filterOutline, visibleRange: visibleRange, fitWidth: fitWidth };
  if(typeof module!=="undefined" && module.exports && !(G&&G.document)){ module.exports=PURE; return; }

  /* ================= browser ================= */
  var D = G.document;
  var enhancedFor = null;
  var pending = false;

  function host(){ try{ return G.STUDY && G.STUDY._host ? G.STUDY._host(): null; }catch(e){return null;} }
  function V(){ try{ return G.STUDY && G.STUDY._v ? G.STUDY._v(): null; }catch(e){return null;} }
  function esc(s){ var h=host(); if(h&&h.esc) return h.esc(s); return String(s==null?"":s).replace(/[&<>"]/g,function(c){return c==="&"?"&amp;":c==="<"?"&lt;":c===">"?"&gt;":"&quot;";}); }
  function uid(){ try{ if(G.STUDY&&G.STUDY._uid) return G.STUDY._uid(); }catch(e){} return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
  function put(s,v){ return G.STUDY._put(s,v); }
  function get(s,k){ return G.STUDY._get(s,k); }
  function del(s,k){ return G.STUDY._del(s,k); }
  function toast(m){ var h=host(); if(h&&h.toast) h.toast(m); else if(G.toast) G.toast(m); }

  var ICO = {
    back: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    grid: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>',
    mic: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
    chevD: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    undo: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>',
    redo: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    starFill: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    scan: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    gotoIco: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M9 7h6M9 11h4"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="2"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="15" cy="17" r="2"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    tpl: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>'
  };

  function ensureDocMeta(doc){
    if(!doc.tplMap){ doc.tplMap={}; var def=doc.style||"ruled"; if(doc.ord) doc.ord.forEach(function(id){ if(!doc.tplMap[id]) doc.tplMap[id]=def; }); }
    if(!doc.favPages) doc.favPages={};
    if(!doc.outlines) doc.outlines=[];
    if(!doc.rotMap) doc.rotMap={};
    if(!doc.settings) doc.settings={scrollDir:"vertical", palm:true, lock:false};
    return doc;
  }
  function tplForPage(doc, pageKey){
    ensureDocMeta(doc);
    var m=doc.tplMap||{};
    var v=m[pageKey];
    if(v) return v;
    /* fallback */
    var def=doc.style||"ruled";
    /* for pdf numbers map to docs? */
    return m[String(pageKey)]||def;
  }
  function setTplForPage(doc, pageKey, tpl){
    ensureDocMeta(doc);
    doc.tplMap[pageKey]=tpl;
    return doc;
  }
  function drawPageBg(ctx, tpl, ratio, W){
    var H = W*ratio;
    var dark = tplIsDark(tpl), base = tplBase(tpl);
    var bg = dark ? "#0D1D23" : "#ffffff";
    var line = dark ? "rgba(66,205,181,0.28)" : "#b8c4d6";
    var dot = dark ? "rgba(66,205,181,0.5)" : "#7a8aa0";
    ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = line; ctx.lineWidth = Math.max(1, W/500);
    ctx.beginPath();
    var i, s;
    if(base==="ruled"){
      s = 0.06*W; /* ~16-23 lines at A4 */
      for(var y=s*1.8; y<H-4; y+=s){ ctx.moveTo(8, y); ctx.lineTo(W-8, y); }
    } else if(base==="ruled-wide"){
      s = 0.10*W;
      for(var y2=s*1.8; y2<H-4; y2+=s){ ctx.moveTo(8, y2); ctx.lineTo(W-8, y2); }
    } else if(base==="grid"){
      var g = 0.06*W;
      for(var gy=g; gy<H; gy+=g){ ctx.moveTo(0,gy); ctx.lineTo(W,gy); }
      for(var gx=g; gx<W; gx+=g){ ctx.moveTo(gx,0); ctx.lineTo(gx,H); }
    } else if(base==="dotgrid"){
      /* draw dots as small segments for bgLines compat */
      var dg = 0.06*W;
      ctx.fillStyle = dot;
      for(var dy=dg*1.5; dy<H; dy+=dg) for(var dx=dg; dx<W; dx+=dg){
        ctx.fillRect(dx, dy, Math.max(1, W/400), Math.max(1, W/400));
      }
      ctx.fillStyle = bg;
    } else if(base==="cornell"){
      var cs = 0.06*W;
      for(var cy=cs*2; cy<H*0.78; cy+=cs){ ctx.moveTo(0,cy); ctx.lineTo(W,cy); }
      /* margin */
      ctx.moveTo(W*0.32, cs*2); ctx.lineTo(W*0.32, H*0.78);
      ctx.moveTo(0, H*0.78); ctx.lineTo(W, H*0.78);
    } else if(base==="mcq"){
      /* header + rows of 5 bubbles */
      var top = 8, rowH = 18, colW = W/6;
      ctx.strokeRect(6,6,W-12,28);
      for(var r=0;r<20;r++){
        var y0 = 44 + r*rowH;
        if(y0+14>H-6) break;
        ctx.strokeRect(6, y0, 20, 14);
        for(var c=0;c<5;c++){
          var cx = 34 + c*colW;
          ctx.beginPath(); ctx.arc(cx+6, y0+7, 6, 0, Math.PI*2); ctx.stroke();
        }
      }
    } else if(base==="blank"){
      /* nothing */
    } else {
      /* fallback ruled */
      var ss = 0.06*W;
      for(var fy=ss*1.8; fy<H-4; fy+=ss){ ctx.moveTo(8,fy); ctx.lineTo(W-8,fy); }
    }
    ctx.stroke();
  }
  function drawPageTemplateOnCanvas(canvas, tpl, ratio){
    var W = canvas.width, ctx = canvas.getContext("2d");
    drawPageBg(ctx, tpl, ratio, W);
  }

  /* ---- toast helpers ---- */
  function closeSheets(id){
    var h=host(); if(!h||!h.root) return;
    var root=h.root(); if(!root) return;
    var el = id ? root.querySelector("#"+id) : root.querySelector("[id^='stP3']");
    /* close single */
    if(id){ var n=root.querySelector("#"+id); if(n&&n.parentNode) n.parentNode.removeChild(n); }
    else {
      var all=root.querySelectorAll("[id^='stP3']");
      for(var i=0;i<all.length;i++){ var nd=all[i]; if(nd.parentNode) nd.parentNode.removeChild(nd); }
    }
  }
  function removeSheet(id){ closeSheets(id); }
  function sheetEl(id, html){
    var h=host(); if(!h||!h.root()) return null;
    removeSheet(id);
    var el=D.createElement("div");
    el.id=id; el.className="st-sheet"; el.setAttribute("role","dialog"); el.setAttribute("aria-modal","true"); el.setAttribute("aria-label", id);
    el.innerHTML = '<div class="st-sh st-p3-sh smd-books-keep smd-emo-keep">'+html+'</div>';
    el.addEventListener("click", function(e){ if(e.target===el) removeSheet(id); });
    h.root().appendChild(el);
    return el;
  }

  /* ---- top bar ---- */
  function injectTopBar(){
    var h=host(); if(!h||!h.root) return;
    var root=h.root(); if(!root) return;
    var v=V(); if(!v||!v.doc) {
      var old=root.querySelector("#stP3Top"); if(old&&old.parentNode) old.parentNode.removeChild(old);
      var pg=root.querySelector(".st-p3-pager"); if(pg&&pg.parentNode) pg.parentNode.removeChild(pg);
      return;
    }
    var tb=root.querySelector(".st-tb");
    var vId = v.doc.id;
    if(root.querySelector("#stP3Top") && enhancedFor===vId){
      refreshTopBar(); return;
    }
    enhancedFor=vId;
    /* remove old if re-injected */
    var oldTop=root.querySelector("#stP3Top"); if(oldTop) oldTop.parentNode.removeChild(oldTop);
    var body=root.querySelector(".pn-body.st-body") || root.querySelector("#stSc");
    var top=D.createElement("div");
    top.id="stP3Top";
    top.className="st-p3-topbar";
    var title=esc(v.doc.title||"Untitled");
    top.innerHTML =
      '<div class="st-p3-top-inner">' +
        '<div class="st-p3-top-group st-p3-left">' +
          '<button type="button" class="st-p3-btn" data-act="st-p3-back" aria-label="Back to library">'+ICO.back+'</button>' +
          '<button type="button" class="st-p3-btn" data-act="st-p3-grid" aria-label="Open navigation">'+ICO.grid+'</button>' +
          '<button type="button" class="st-p3-btn st-p3-collapse" data-act="st-p3-search" aria-label="Search">'+ICO.search+'</button>' +
          '<button type="button" class="st-p3-btn st-p3-collapse" data-act="st-p3-share" aria-label="Share">'+ICO.share+'</button>' +
          '<button type="button" class="st-p3-btn st-p3-collapse" data-act="st-p3-mic" aria-label="Microphone">'+ICO.mic+'</button>' +
        '</div>' +
        '<button type="button" class="st-p3-title" data-act="st-p3-title" aria-haspopup="menu" aria-label="Notebook options"><span class="st-p3-title-txt">'+title+'</span>'+ICO.chevD+'</button>' +
        '<div class="st-p3-top-group st-p3-right">' +
          '<button type="button" class="st-p3-btn" data-act="st-undo" id="stP3Undo" aria-label="Undo">'+ICO.undo+'</button>' +
          '<button type="button" class="st-p3-btn" data-act="st-redo" id="stP3Redo" aria-label="Redo">'+ICO.redo+'</button>' +
          '<button type="button" class="st-p3-btn st-p3-collapse" data-act="st-p3-fav" id="stP3Fav" aria-label="Star this page" aria-pressed="false">'+ICO.star+'</button>' +
          '<button type="button" class="st-p3-btn" data-act="st-p3-add" aria-label="Add page">'+ICO.plus+'</button>' +
          '<button type="button" class="st-p3-btn st-p3-collapse" data-act="st-p3-close" aria-label="Close">'+ICO.x+'</button>' +
          '<button type="button" class="st-p3-btn" data-act="st-p3-more" aria-label="More options">'+ICO.more+'</button>' +
        '</div>' +
      '</div>';
    /* insert before .st-tb if exists else at top of body */
    var insertBefore = tb || root.querySelector(".st-sc");
    if(insertBefore && insertBefore.parentNode) insertBefore.parentNode.insertBefore(top, insertBefore);
    else if(root) root.insertBefore(top, root.firstChild);
    /* bottom pager */
    var pager=D.createElement("button"); pager.type="button"; pager.id="stP3Pager"; pager.className="st-p3-pager";
    pager.setAttribute("data-act","st-p3-goto"); pager.innerHTML='<span id="stP3Cur">1</span><span class="st-p3-slash"> of </span><span id="stP3Tot">1</span>';
    /* place bottom-left fixed */
    root.appendChild(pager);
    /* zoom window */
    var zw=D.createElement("div"); zw.id="stP3ZoomWindow"; zw.className="st-p3-zoomwin"; zw.hidden=true;
    zw.innerHTML='<canvas id="stP3ZoomCv" width="640" height="120"></canvas><span class="st-p3-zoom-tag">Zoom</span>';
    root.appendChild(zw);
    refreshTopBar();
    applySettings();
    bindPaging();
  }
  function refreshTopBar(){
    var h=host(); if(!h||!h.root) return;
    var root=h.root(); if(!root) return;
    var v=V(); if(!v) return;
    var cur=v.cur||1, n=v.n||1;
    var curEl=root.querySelector("#stP3Cur"); if(curEl) curEl.textContent=cur;
    var totEl=root.querySelector("#stP3Tot"); if(totEl) totEl.textContent=n;
    var titleEl=root.querySelector(".st-p3-title-txt"); if(titleEl) titleEl.textContent=v.doc.title||"";
    /* also update existing toolbar #stCurP if present */
    var oldCur=root.querySelector("#stCurP"); if(oldCur) oldCur.textContent=cur;
    var oldTot=root.querySelector("#stTotP"); if(oldTot) oldTot.textContent=n;
    /* fav state */
    var favBtn=root.querySelector("#stP3Fav");
    if(favBtn){
      var pageKey = v.nb ? v.nb.ord[cur-1] : cur;
      ensureDocMeta(v.doc);
      var star = isFav(v.doc, pageKey);
      favBtn.innerHTML = star? ICO.starFill: ICO.star;
      favBtn.classList.toggle("on", !!star);
      favBtn.setAttribute("aria-pressed", star?"true":"false");
    }
    /* undo/redo */
    var u=root.querySelector("#stP3Undo"); if(u) u.disabled = !(v.stack && v.stack.u && v.stack.u.length);
    var r=root.querySelector("#stP3Redo"); if(r) r.disabled = !(v.stack && v.stack.r && v.stack.r.length);
  }
  function applySettings(){
    var v=V(); if(!v||!v.doc) return;
    ensureDocMeta(v.doc);
    var s=v.doc.settings||{};
    var box = host() && host().root() ? host().root().querySelector("#stPages") : null;
    if(box){
      if(s.scrollDir==="horizontal") box.style.flexDirection="row"; else box.style.flexDirection="column";
      box.style.overflowX = s.scrollDir==="horizontal" ? "auto" : "visible";
    }
    var sc = host() && host().root() ? host().root().querySelector("#stSc") : null;
    if(sc) sc.style.overflowY = s.scrollDir==="horizontal" ? "hidden" : "auto";
    /* lock */
    var locked = !!s.lock;
    var ink = host() && host().root() ? host().root().querySelector(".st-ink") : null;
    if(locked && v.tool){ /* tool stays but overlay pointer events off */
      var col = host().root().querySelector("#stPages");
      if(col) col.classList.remove("st-ink");
    }
    /* palm rejection stored but Phase1 owns behaviour: we expose flag */
    v.palm = s.palm !== false;
  }
  var origSc = null;
  function bindPaging(){
    var v=V(); if(!v||v._p3bound) return; v._p3bound=true;
    var sc = host() && host().root() ? host().root().querySelector("#stSc") : null;
    if(!sc) return;
    /* double-tap to fit width (double click fallback) */
    sc.addEventListener("dblclick", function(e){
      var vv=V(); if(!vv) return;
      /* fit to width => zoom 1 */
      if(G.STUDY && G.STUDY._setZoom) G.STUDY._setZoom(1);
      refreshTopBar();
    });
    /* pinch already in study.js; we just ensure clamp */
    /* zoom window on pen touch: show magnified strip at touch Y */
    var zoomWin = host().root() ? host().root().querySelector("#stP3ZoomWindow") : null;
    if(zoomWin && !zoomWin._bound){
      zoomWin._bound=true;
    }
  }

  /* ---- page ops (one undo step each) ---- */
  function curPageKey(){ var v=V(); if(!v) return null; return v.nb? v.nb.ord[(v.cur||1)-1] : (v.cur||1); }
  function pageNumOfKey(k){ var v=V(); if(!v) return 1; if(v.nb) return v.nb.ord.indexOf(k)+1>0? v.nb.ord.indexOf(k)+1:1; return Number(k)||1; }
  function persistDoc(){ var v=V(); if(!v||!v.doc) return Promise.resolve(); v.doc.pageCount = v.nb? v.nb.ord.length : v.n; return put("docs", v.doc); }
  function reloadViewer(goto){
    var v=V(); if(!v) return;
    if(v.nb && G.STUDY && G.STUDY._reloadNb){ G.STUDY._reloadNb(goto); }
    else if(G.STUDY && G.STUDY._v){ var h=host(); if(h && h.root) { /* force re-render via lib->viewer not ideal */ } }
    /* also refresh top bar after reload (observer will reinject) */
  }
  function pushPageUndo(op){ if(G.STUDY&&G.STUDY._pushUndo) G.STUDY._pushUndo(op); refreshTopBar(); }
  /* Add page */
  function addPage(place, tpl){
    var v=V(); if(!v||!v.nb) { toast("Add page works for notebooks."); return; }
    ensureDocMeta(v.doc);
    var cur=v.cur||1, total=v.n;
    var idx=addIndex(cur, total, place);
    var newId = uid();
    /* next not used if ord with ids, but keep */
    v.doc.ord = insertAt(v.doc.ord, idx, newId);
    if(!v.doc.tplMap) v.doc.tplMap={};
    v.doc.tplMap[newId]= tpl || "ruled";
    if(!v.doc.rotMap) v.doc.rotMap={};
    v.doc.rotMap[newId]=0;
    var newCur = idx+1; /* 1-based */
    var op={ t:"p_add", page:newId, tpl: v.doc.tplMap[newId], idx: idx, kind:"addPage", place: place };
    /* keep undo info as ordBefore/After for redo? we store single insert */
    v.doc.pageCount = v.doc.ord.length;
    put("docs", v.doc).then(function(){
      pushPageUndo(op);
      /* reload viewer at new page */
      if(G.STUDY._reloadNb) G.STUDY._reloadNb(newCur);
      else refreshTopBar();
    });
    /* V.n will be updated after reload */
  }
  function copyPage(){
    var v=V(); if(!v||!v.nb){ toast("Copy page works for notebooks."); return; }
    ensureDocMeta(v.doc);
    var cur=v.cur||1, pageId=v.nb.ord[cur-1];
    var newId=uid();
    var tpl=tplForPage(v.doc, pageId);
    var rot = (v.doc.rotMap && v.doc.rotMap[pageId])||0;
    /* insert after */
    v.doc.ord = insertAt(v.doc.ord, cur, newId);
    v.doc.tplMap[newId]=tpl;
    v.doc.rotMap[newId]=rot;
    v.doc.pageCount=v.doc.ord.length;
    /* clone strokes */
    var src = v.strokes.filter(function(s){ return s.page===pageId && !s.gone; });
    var clones=[], i;
    for(i=0;i<src.length;i++){
      var s=src[i];
      var c={ id: uid(), doc: v.id, page:newId, tool:s.tool, color:s.color, w:s.w, pts: s.pts.map(function(p){ return [p[0],p[1],p[2]]; }), gone:false, t:Date.now() };
      v.strokes.push(c);
      clones.push(c);
      put("strokes", c);
    }
    var op={ t:"p_copy", page:newId, from:pageId, tpl:tpl, idx:cur };
    put("docs", v.doc).then(function(){
      pushPageUndo(op);
      if(G.STUDY._reloadNb) G.STUDY._reloadNb(cur+1); else refreshTopBar();
      toast("Page copied.");
    });
  }
  function rotatePage(){
    var v=V(); if(!v||!v.nb){ toast("Rotate works for notebooks."); return; }
    ensureDocMeta(v.doc);
    var pageId=curPageKey();
    var oldRot=(v.doc.rotMap[pageId]||0)%4;
    var newRot=rotateStep(oldRot,1);
    v.doc.rotMap[pageId]=newRot;
    var op={ t:"p_rot", page:pageId, oldRot:oldRot, newRot:newRot };
    put("docs", v.doc).then(function(){
      pushPageUndo(op);
      var page = v.pg && v.pg[v.cur||1];
      if(page && page.el) page.el.style.transform = newRot ? "rotate("+(newRot*90)+"deg)" : "";
      if(G.STUDY._redraw) G.STUDY._redraw(v.cur||1);
      refreshTopBar();
      if(page && page.cv){
        drawPageBg(page.cv.getContext("2d"), tplForPage(v.doc, pageId), v.ratio||1.414, page.cv.width);
        if(G.STUDY._redraw) G.STUDY._redraw(v.cur||1);
      }
    });
  }
  function clearPage(){
    var v=V(); if(!v||!v.nb){ toast("Clear works for notebooks."); return; }
    if(!G.confirm || !G.confirm("Clear this page and all ink on it?")) return;
    var pageId=curPageKey();
    var ids = v.strokes.filter(function(s){ return s.page===pageId && !s.gone; }).map(function(s){ return s.id; });
    if(!ids.length){ toast("This page is already empty."); return; }
    v.strokes.forEach(function(s){ if(ids.indexOf(s.id)!==-1){ s.gone=true; put("strokes", s); } });
    var op={ t:"del", ids: ids };
    pushPageUndo(op);
    if(G.STUDY._redraw) G.STUDY._redraw(v.cur||1);
    refreshTopBar();
    toast("Page cleared.");
  }
  function changeTemplate(scope){
    /* handled via sheet */
    openChangeTemplate(scope||"page");
  }
  function applyTemplate(target, tpl){
    var v=V(); if(!v||!v.nb) return;
    ensureDocMeta(v.doc);
    var oldMap=JSON.parse(JSON.stringify(v.doc.tplMap||{}));
    var oldTpl, oldMapCopy;
    if(target==="all"){
      v.doc.ord.forEach(function(id){ v.doc.tplMap[id]=tpl; });
      oldTpl = oldMap;
      var opAll={ t:"p_tpl_all", oldMap: oldMap, newMap: JSON.parse(JSON.stringify(v.doc.tplMap)), tpl: tpl };
      put("docs", v.doc).then(function(){
        pushPageUndo(opAll);
        if(G.STUDY._redraw) for(var i=1;i<=v.n;i++) G.STUDY._redraw(i);
        if(G.STUDY._reloadNb) G.STUDY._reloadNb(v.cur||1); else refreshTopBar();
      });
    } else {
      var pid=curPageKey();
      oldTpl = tplForPage(v.doc, pid);
      v.doc.tplMap[pid]=tpl;
      var op={ t:"p_tpl", page:pid, oldTpl:oldTpl, newTpl:tpl };
      put("docs", v.doc).then(function(){
        pushPageUndo(op);
        var page=v.pg && v.pg[v.cur||1];
        if(page&&page.cv) drawPageBg(page.cv.getContext("2d"), tpl, v.ratio||1.414, page.cv.width);
        if(G.STUDY._redraw) G.STUDY._redraw(v.cur||1);
        refreshTopBar();
      });
    }
  }

  /* ---- undo operator for page types (intercept) ---- */
  function doPageUndo(isUndo){
    var v=V(); if(!v) return false;
    var st=v.stack;
    if(!st) return false;
    var op = isUndo ? st.u[st.u.length-1] : st.r[st.r.length-1];
    if(!op || !(op.t && op.t.indexOf("p_")===0)) return false;
    ensureDocMeta(v.doc);
    if(isUndo){
      if(op.t==="p_add"){
        var ix=v.doc.ord.indexOf(op.page); if(ix!==-1){ v.doc.ord=removeAt(v.doc.ord, ix); delete v.doc.tplMap[op.page]; delete v.doc.rotMap[op.page]; }
      } else if(op.t==="p_copy"){
        var ix2=v.doc.ord.indexOf(op.page); if(ix2!==-1){ v.doc.ord=removeAt(v.doc.ord, ix2); delete v.doc.tplMap[op.page]; delete v.doc.rotMap[op.page]; }
        v.strokes.forEach(function(s){ if(s.page===op.page && !s.gone){ s.gone=true; put("strokes", s); } });
      } else if(op.t==="p_rot"){
        v.doc.rotMap[op.page]=op.oldRot;
      } else if(op.t==="p_tpl"){
        v.doc.tplMap[op.page]=op.oldTpl;
      } else if(op.t==="p_tpl_all"){
        v.doc.tplMap=JSON.parse(JSON.stringify(op.oldMap));
      } else if(op.t==="p_fav"){
        v.doc.favPages=JSON.parse(JSON.stringify(op.oldMap));
      } else if(op.t==="p_outline_add"){
        v.doc.outlines=v.doc.outlines.filter(function(e){return e.id!==op.entry.id;});
      } else if(op.t==="p_outline_rename"){
        v.doc.outlines.forEach(function(e){ if(e.id===op.oid) e.title=op.oldTitle; });
      } else if(op.t==="p_reorder"){
        v.doc.ord=op.oldOrd.slice();
      }
      v.doc.pageCount=v.doc.ord.length;
      var popped = st.u.pop(); st.r.push(popped);
      put("docs", v.doc).then(function(){
        if(G.STUDY._saveStack) G.STUDY._saveStack();
        if(G.STUDY._reloadNb) G.STUDY._reloadNb(v.cur||1);
        refreshTopBar();
      });
      return true;
    } else {
      if(op.t==="p_add"){
        if(v.doc.ord.indexOf(op.page)===-1){ v.doc.ord=insertAt(v.doc.ord, op.idx, op.page); v.doc.tplMap[op.page]=op.tpl||"ruled"; }
      } else if(op.t==="p_copy"){
        if(v.doc.ord.indexOf(op.page)===-1){ v.doc.ord=insertAt(v.doc.ord, op.idx, op.page); v.doc.tplMap[op.page]=op.tpl; }
        v.strokes.forEach(function(s){ if(s.page===op.page && s.gone){ s.gone=false; put("strokes", s); } });
      } else if(op.t==="p_rot"){
        v.doc.rotMap[op.page]=op.newRot;
      } else if(op.t==="p_tpl"){
        v.doc.tplMap[op.page]=op.newTpl;
      } else if(op.t==="p_tpl_all"){
        v.doc.tplMap=JSON.parse(JSON.stringify(op.newMap));
      } else if(op.t==="p_fav"){
        v.doc.favPages=JSON.parse(JSON.stringify(op.newMap));
      } else if(op.t==="p_outline_add"){
        v.doc.outlines.push(op.entry);
      } else if(op.t==="p_outline_rename"){
        v.doc.outlines.forEach(function(e){ if(e.id===op.oid) e.title=op.newTitle; });
      } else if(op.t==="p_reorder"){
        v.doc.ord=op.newOrd.slice();
      }
      v.doc.pageCount=v.doc.ord.length;
      var popped2 = st.r.pop(); st.u.push(popped2);
      put("docs", v.doc).then(function(){
        if(G.STUDY._saveStack) G.STUDY._saveStack();
        if(G.STUDY._reloadNb) G.STUDY._reloadNb(v.cur||1);
        refreshTopBar();
      });
      return true;
    }
  }

  /* ---- Sheets ---- */
  function openAddPageSheet(){
    var v=V(); if(!v) return;
    var curTpl = tplForPage(v.doc, curPageKey()||"");
    var html = '<div class="st-p3-sh-head"><h3>Add page</h3><button type="button" class="pn-btn sm" data-act="st-p3-close-sheet">Done</button></div>' +
      '<div class="st-p3-seg" role="tablist" aria-label="Position"><button type="button" class="st-p3-seg-btn" data-act="st-p3-place" data-v="before">Before</button><button type="button" class="st-p3-seg-btn on" data-act="st-p3-place" data-v="after">After</button><button type="button" class="st-p3-seg-btn" data-act="st-p3-place" data-v="last">Last</button></div>' +
      '<div class="st-p3-tpl-title">Template</div>' +
      '<div class="st-p3-tpl-grid" id="stP3TplGrid"></div>' +
      '<button type="button" class="pn-btn sm" data-act="st-p3-more-tpls" id="stP3MoreTpls">More templates</button>' +
      '<div class="st-p3-actions">' +
        '<button type="button" class="st-p3-act" data-act="st-p3-add-image">'+ICO.image+'<span>Image</span></button>' +
        '<button type="button" class="st-p3-act" data-act="st-p3-add-scan">'+ICO.scan+'<span>Scan Documents</span></button>' +
        '<button type="button" class="st-p3-act" data-act="st-p3-add-photo">'+ICO.image+'<span>Take Photo</span></button>' +
        '<button type="button" class="st-p3-act" data-act="st-p3-add-pdf">'+ICO.pdf+'<span>Import PDF or image</span></button>' +
      '</div>' +
      '<button type="button" class="pn-btn pri st-p3-add-confirm" data-act="st-p3-confirm-add">Add page</button>';
    var el=sheetEl("stP3AddSheet", html);
    if(!el) return;
    el._place="after"; el._tpl=curTpl;
    /* segment control */
    el.querySelectorAll("[data-act='st-p3-place']").forEach(function(b){
      b.addEventListener("click", function(){ el.querySelectorAll("[data-act='st-p3-place']").forEach(function(x){ x.classList.remove("on"); }); b.classList.add("on"); el._place=b.getAttribute("data-v"); });
    });
    /* template grid */
    var grid = el.querySelector("#stP3TplGrid");
    function fillGrid(list){
      grid.innerHTML = list.map(function(t){
        var sel = t===el._tpl;
        return '<button type="button" class="st-p3-tpl'+(sel?" on":"")+'" data-tpl="'+t+'" aria-pressed="'+!!sel+'"><span class="st-p3-tpl-cv" data-cv="'+t+'"></span><span class="st-p3-tpl-lab">'+esc(tplLabel(t))+'</span></button>';
      }).join("");
      grid.querySelectorAll("[data-tpl]").forEach(function(btn){
        btn.addEventListener("click", function(){ el._tpl=btn.getAttribute("data-tpl"); grid.querySelectorAll("[data-tpl]").forEach(function(x){ x.classList.remove("on"); x.setAttribute("aria-pressed","false"); }); btn.classList.add("on"); btn.setAttribute("aria-pressed","true"); });
        var cvEl = btn.querySelector("[data-cv]");
        var t=btn.getAttribute("data-tpl");
        drawPreview(cvEl, t);
      });
    }
    function drawPreview(spanEl, tpl){
      var c=D.createElement("canvas"); c.width=40; c.height=56; c.className="st-p3-prev";
      drawPageBg(c.getContext("2d"), tpl, 1.414, 40);
      spanEl.replaceChildren(c);
    }
    /* default 6 */
    fillGrid(["blank","ruled","grid","dotgrid","cornell","mcq"]);
    el.querySelector("#stP3MoreTpls").addEventListener("click", function(){
      fillGrid(tplList());
      el.querySelector("#stP3MoreTpls").textContent = el.querySelector("#stP3MoreTpls").textContent==="More templates" ? "Show fewer" : "More templates";
    });
    el.querySelector("[data-act='st-p3-confirm-add']").addEventListener("click", function(){
      var place=el._place, tpl=el._tpl;
      removeSheet("stP3AddSheet");
      addPage(place, tpl);
    });
  }
  function openChangeTemplate(scope){
    var v=V(); if(!v||!v.nb) return;
    var curTpl = tplForPage(v.doc, curPageKey()||"");
    var html = '<div class="st-p3-sh-head"><h3>Change template</h3><button type="button" class="pn-btn sm" data-act="st-p3-close-sheet">Done</button></div>' +
      '<div class="st-p3-seg"><button type="button" class="st-p3-seg-btn'+(scope!=="all"?" on":"")+'" data-act="st-p3-tpl-scope" data-v="page">This page</button><button type="button" class="st-p3-seg-btn'+(scope==="all"?" on":"")+'" data-act="st-p3-tpl-scope" data-v="all">All pages</button></div>' +
      '<div class="st-p3-tpl-grid" id="stP3CtGrid"></div>';
    var el=sheetEl("stP3TplSheet", html);
    if(!el) return;
    el._scope=scope||"page";
    var grid=el.querySelector("#stP3CtGrid");
    function fill(list){
      grid.innerHTML=list.map(function(t){ return '<button type="button" class="st-p3-tpl'+(t===curTpl?" on":"")+'" data-tpl="'+t+'"><span data-cv="'+t+'"></span><span>'+esc(tplLabel(t))+'</span></button>'; }).join("");
      grid.querySelectorAll("[data-tpl]").forEach(function(btn){
        var t=btn.getAttribute("data-tpl");
        var span=btn.querySelector("[data-cv]");
        var c=D.createElement("canvas"); c.width=40; c.height=56; drawPageBg(c.getContext("2d"), t, 1.414, 40); span.replaceChildren(c);
        btn.addEventListener("click", function(){
          removeSheet("stP3TplSheet");
          applyTemplate(el._scope, t);
        });
      });
    }
    fill(tplList());
    el.querySelectorAll("[data-act='st-p3-tpl-scope']").forEach(function(b){
      b.addEventListener("click", function(){
        el._scope=b.getAttribute("data-v");
        el.querySelectorAll("[data-act='st-p3-tpl-scope']").forEach(function(x){ x.classList.remove("on"); }); b.classList.add("on");
      });
    });
  }
  function openMoreSheet(){
    var v=V(); if(!v) return;
    var pageKey=curPageKey(), cur=v.cur||1, n=v.n||1;
    var thumbHtml='<canvas id="stP3MoreThumb" width="90" height="127" class="st-p3-more-thumb"></canvas>';
    var html = '<div class="st-p3-sh-head"><h3>Page '+cur+' of '+n+'</h3><button type="button" class="pn-btn sm" data-act="st-p3-close-sheet">Done</button></div>' +
      '<div class="st-p3-more-head">'+thumbHtml+'<div><div class="st-p3-more-title">Page '+cur+'</div><small>'+esc(tplLabel(tplForPage(v.doc, pageKey||"")))+' • '+(v.nb?"Notebook":"PDF")+'</small></div></div>' +
      '<div class="st-p3-menu">' +
        '<button type="button" class="st-p3-menu-item" data-act="st-p3-copy">'+ICO.copy+'<div class="st-p3-menu-txt"><strong>Copy Page</strong><small>Duplicates page + strokes</small></div></button>' +
        '<button type="button" class="st-p3-menu-item" data-act="st-p3-rotate">'+ICO.rotate+'<div class="st-p3-menu-txt"><strong>Rotate Page</strong><small>90° steps</small></div></button>' +
        '<button type="button" class="st-p3-menu-item" data-act="st-p3-outline">'+ICO.bookmark+'<div class="st-p3-menu-txt"><strong>Add Page to Outline</strong><small>Bookmark this page</small></div></button>' +
        '<button type="button" class="st-p3-menu-item" data-act="st-p3-change-tpl">'+ICO.tpl+'<div class="st-p3-menu-txt"><strong>Change Template</strong><small>This page or all pages</small></div></button>' +
        '<button type="button" class="st-p3-menu-item" data-act="st-p3-go">'+ICO.gotoIco+'<div class="st-p3-menu-txt"><strong>Go to Page</strong><small>1–'+n+'</small></div></button>' +
        '<button type="button" class="st-p3-menu-item" data-act="st-p3-settings">'+ICO.gear+'<div class="st-p3-menu-txt"><strong>Settings</strong><small>Scroll, palm rejection, lock</small></div></button>' +
        '<button type="button" class="st-p3-menu-item st-p3-phone-only" data-act="st-p3-search">'+ICO.search+'<div class="st-p3-menu-txt"><strong>Search</strong><small>Find in this notebook</small></div></button>' +
        '<button type="button" class="st-p3-menu-item st-p3-phone-only" data-act="st-p3-share">'+ICO.share+'<div class="st-p3-menu-txt"><strong>Share</strong><small>Share this notebook</small></div></button>' +
        '<button type="button" class="st-p3-menu-item st-p3-phone-only" data-act="st-p3-mic">'+ICO.mic+'<div class="st-p3-menu-txt"><strong>Voice note</strong><small>Microphone</small></div></button>' +
        '<button type="button" class="st-p3-menu-item st-p3-phone-only" data-act="st-p3-fav">'+ICO.star+'<div class="st-p3-menu-txt"><strong>Star page</strong><small>Bookmark this page</small></div></button>' +
        '<button type="button" class="st-p3-menu-item" data-act="st-more">'+ICO.gear+'<div class="st-p3-menu-txt"><strong>Notebook options</strong><small>Study AI, share, zoom and settings</small></div></button>' +
        '<button type="button" class="st-p3-menu-item bad" data-act="st-p3-clear">'+ICO.trash+'<div class="st-p3-menu-txt"><strong>Clear Page</strong><small>Removes ink on this page</small></div></button>' +
      '</div>';
    var el=sheetEl("stP3MoreSheet", html);
    if(!el) return;
    /* thumb */
    var cv=el.querySelector("#stP3MoreThumb");
    if(cv) renderThumbInto(cv, cur);
  }
  function openSettingsSheet(){
    var v=V(); if(!v||!v.doc) return;
    ensureDocMeta(v.doc);
    var s=v.doc.settings||{scrollDir:"vertical", palm:true, lock:false};
    var html = '<div class="st-p3-sh-head"><h3>Settings</h3><button type="button" class="pn-btn sm" data-act="st-p3-close-sheet">Done</button></div>' +
      '<div class="st-p3-setting"><div><strong>Scrolling direction</strong><small>Vertical for reading, horizontal for boards</small></div><div class="st-p3-seg"><button type="button" class="st-p3-seg-btn'+(s.scrollDir!=="horizontal"?" on":"")+'" data-act="st-p3-scroll" data-v="vertical">Vertical</button><button type="button" class="st-p3-seg-btn'+(s.scrollDir==="horizontal"?" on":"")+'" data-act="st-p3-scroll" data-v="horizontal">Horizontal</button></div></div>' +
      '<div class="st-p3-setting"><div><strong>Stylus &amp; palm rejection</strong><small>Phase 1 owns behaviour</small></div><button type="button" class="pn-btn sm" data-act="st-p3-palm" aria-pressed="'+!!s.palm+'">'+(s.palm?"ON":"OFF")+'</button></div>' +
      '<div class="st-p3-setting"><div><strong>Document editing lock</strong><small>Read-only</small></div><button type="button" class="pn-btn sm" data-act="st-p3-lock" aria-pressed="'+!!s.lock+'">'+(s.lock?"LOCKED":"EDIT")+'</button></div>';
    var el=sheetEl("stP3SettingsSheet", html);
    if(!el) return;
    el.querySelectorAll("[data-act='st-p3-scroll']").forEach(function(b){
      b.addEventListener("click", function(){
        v.doc.settings.scrollDir=b.getAttribute("data-v");
        put("docs", v.doc).then(function(){ applySettings(); refreshTopBar(); });
        el.querySelectorAll("[data-act='st-p3-scroll']").forEach(function(x){ x.classList.remove("on"); }); b.classList.add("on");
      });
    });
    el.querySelector("[data-act='st-p3-palm']").addEventListener("click", function(){
      var btn=el.querySelector("[data-act='st-p3-palm']");
      var curOn = btn.getAttribute("aria-pressed")==="true";
      var next=!curOn;
      v.doc.settings.palm=next;
      put("docs", v.doc).then(function(){ applySettings(); });
      btn.textContent=next?"ON":"OFF"; btn.setAttribute("aria-pressed", next?"true":"false");
    });
    el.querySelector("[data-act='st-p3-lock']").addEventListener("click", function(){
      var btn=el.querySelector("[data-act='st-p3-lock']");
      var curLock = btn.getAttribute("aria-pressed")==="true";
      var next=!curLock;
      v.doc.settings.lock=next;
      put("docs", v.doc).then(function(){ applySettings(); });
      btn.textContent=next?"LOCKED":"EDIT"; btn.setAttribute("aria-pressed", next?"true":"false");
      toast(next?"Document locked (read-only).":"Document unlocked.");
    });
  }
  function openGoToSheet(){
    var v=V(); if(!v) return;
    var cur=v.cur||1, n=v.n||1;
    var html='<div class="st-p3-sh-head"><h3>Go to Page</h3><button type="button" class="pn-btn sm" data-act="st-p3-close-sheet">Done</button></div>' +
      '<div class="st-p3-goto-row"><label>Page <input id="stP3GotoInp" type="number" min="1" max="'+n+'" value="'+cur+'" aria-label="Page number"></label><button type="button" class="pn-btn pri" data-act="st-p3-do-goto">Go</button></div>';
    var el=sheetEl("stP3GoSheet", html);
    if(!el) return;
    el.querySelector("[data-act='st-p3-do-goto']").addEventListener("click", function(){
      var inp=el.querySelector("#stP3GotoInp");
      var num=Math.max(1, Math.min(n, parseInt(inp.value,10)||1));
      removeSheet("stP3GoSheet");
      var vv=V(); if(vv&&vv.pg&&vv.pg[num]&&vv.pg[num].el){
        var horiz=vv.doc&&vv.doc.settings&&vv.doc.settings.scrollDir==="horizontal";
        if(horiz) vv.sc.scrollLeft = vv.pg[num].el.offsetLeft; else vv.sc.scrollTop = vv.pg[num].el.offsetTop;
        vv.cur=num; refreshTopBar();
      } else {
        /* fallback reload */
        if(G.STUDY._reloadNb) G.STUDY._reloadNb(num);
      }
    });
  }
  function openComingSoon(title, msg){
    var html='<div class="st-p3-sh-head"><h3>'+esc(title)+'</h3><button type="button" class="pn-btn sm" data-act="st-p3-close-sheet">Done</button></div><p class="st-p3-note">'+esc(msg)+'</p>';
    sheetEl("stP3SoonSheet", html);
  }

  /* ---- Navigator (thumbnails / favourites / outlines) ---- */
  var navState = { tab:"thumbs", select:false, selected:{}, filter:"" };
  function openNavigator(tab){
    navState.tab=tab||"thumbs"; navState.select=false; navState.selected={};
    renderNavigator();
  }
  function renderNavigator(){
    var v=V(); if(!v) return;
    var tab=navState.tab;
    var tabs = '<div class="st-p3-nav-tabs" role="tablist"><button type="button" class="st-p3-tab'+(tab==="thumbs"?" on":"")+'" data-act="st-p3-tab" data-v="thumbs">Thumbnails</button><button type="button" class="st-p3-tab'+(tab==="favs"?" on":"")+'" data-act="st-p3-tab" data-v="favs">Favorites</button><button type="button" class="st-p3-tab'+(tab==="outlines"?" on":"")+'" data-act="st-p3-tab" data-v="outlines">Outlines</button></div>';
    var body="";
    if(tab==="thumbs") body='<div class="st-p3-nav-grid" id="stP3NavGrid"></div>';
    else if(tab==="favs") body='<div id="stP3FavBody"></div>';
    else body='<div class="st-p3-outline-wrap"><div class="st-p3-filter"><input id="stP3OutlineFilter" placeholder="Filter outlines" aria-label="Filter outlines"></div><div id="stP3OutlineBody"></div></div>';
    var html='<div class="st-p3-nav-head"><h3>Pages</h3><div class="st-p3-nav-acts"><button type="button" class="pn-btn sm" data-act="st-p3-select-toggle">'+(navState.select?"Done":"Select")+'</button><button type="button" class="pn-btn sm" data-act="st-p3-close-sheet">Close</button></div></div>'+tabs+body;
    var el=sheetEl("stP3NavSheet", html);
    if(!el) return;
    /* bind tabs */
    el.querySelectorAll("[data-act='st-p3-tab']").forEach(function(b){
      b.addEventListener("click", function(){ navState.tab=b.getAttribute("data-v"); navState.select=false; renderNavigator(); });
    });
    el.querySelector("[data-act='st-p3-select-toggle']").addEventListener("click", function(){
      navState.select=!navState.select;
      renderNavigator();
    });
    if(tab==="thumbs") fillThumbsNav(el);
    else if(tab==="favs") fillFavsNav(el);
    else fillOutlinesNav(el);
  }
  function renderThumbInto(canvas, pageNum){
    var v=V(); if(!v||!canvas) return;
    var W=canvas.width, ctx=canvas.getContext("2d");
    ctx.clearRect(0,0,canvas.width, canvas.height);
    if(v.nb){
      var pageId = v.nb.ord[pageNum-1];
      if(!pageId) return;
      var tpl=tplForPage(v.doc, pageId);
      drawPageBg(ctx, tpl, v.ratio||1.414, W);
      var CH = canvas.height;
      if(G.STUDY && G.STUDY._drawStroke){
        v.strokes.forEach(function(s){ if(s.page===pageId && !s.gone) G.STUDY._drawStroke(ctx, s, W, CH, 1); });
      }
    } else if(v.pdf){
      /* try cached page canvas */
      var pg = v.pg && v.pg[pageNum];
      ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,canvas.width, canvas.height);
      if(pg && pg.cv){ ctx.drawImage(pg.cv, 0,0, canvas.width, canvas.height); }
      else {
        /* async render */
        v.pdf.getPage(pageNum).then(function(page){
          var v0=page.getViewport({scale:1}), sc=canvas.width/v0.width, vp=page.getViewport({scale:sc});
          var c2=D.createElement("canvas"); c2.width=Math.ceil(vp.width); c2.height=Math.ceil(vp.height);
          var ctx2=c2.getContext("2d"); ctx2.fillStyle="#ffffff"; ctx2.fillRect(0,0,c2.width,c2.height);
          page.render({canvasContext:ctx2, viewport:vp}).promise.then(function(){
            var ctx3=canvas.getContext("2d"); ctx3.clearRect(0,0,canvas.width,canvas.height); ctx3.drawImage(c2,0,0,canvas.width,canvas.height);
            if(G.STUDY && G.STUDY._drawStroke) v.strokes.forEach(function(s){ if(s.page===pageNum && !s.gone) G.STUDY._drawStroke(canvas.getContext("2d"), s, canvas.width, canvas.height, 1); });
            page.cleanup();
          });
        }).catch(function(){});
        return;
      }
      if(G.STUDY && G.STUDY._drawStroke) v.strokes.forEach(function(s){ if(s.page===pageNum && !s.gone) G.STUDY._drawStroke(ctx, s, canvas.width, canvas.height, 1); });
    }
  }
  function fillThumbsNav(root){
    var v=V(); if(!v) return;
    var grid=root.querySelector("#stP3NavGrid");
    var n=v.n||1, cur=v.cur||1;
    var html='<button type="button" class="st-p3-nav-add" data-act="st-p3-nav-add"><span class="st-p3-nav-add-ico">+</span><span>Add page</span></button>';
    var cards="";
    for(var i=1;i<=n;i++){
      var pageId = v.nb ? v.nb.ord[i-1] : i;
      var sel = navState.select && navState.selected[pageId];
      cards += '<div class="st-p3-nav-card'+(i===cur?" cur":"")+(sel?" sel":"")+'" data-page="'+i+'" draggable="true" data-key="'+pageId+'" tabindex="0" role="button" aria-label="Page '+i+'">' +
        '<canvas class="st-p3-nav-cv" width="90" height="127"></canvas>' +
        '<span class="st-p3-nav-label">Page '+i+'</span>' +
        (navState.select? '<span class="st-p3-nav-check">'+(sel?"✓":"")+'</span>' : '') +
      '</div>';
    }
    grid.innerHTML = html + cards;
    grid.querySelector("[data-act='st-p3-nav-add']").addEventListener("click", function(){ removeSheet("stP3NavSheet"); openAddPageSheet(); });
    /* render thumbnails */
    Array.prototype.forEach.call(grid.querySelectorAll(".st-p3-nav-card"), function(card){
      var pn=parseInt(card.getAttribute("data-page"),10);
      var cv=card.querySelector("canvas");
      renderThumbInto(cv, pn);
      card.addEventListener("click", function(){
        if(navState.select){
          var key=card.getAttribute("data-key");
          if(navState.selected[key]) delete navState.selected[key]; else navState.selected[key]=true;
          navState.select = Object.keys(navState.selected).length>0; /* stay in select */
          renderNavigator();
        } else {
          removeSheet("stP3NavSheet");
          var vv=V(); if(vv&&vv.pg&&vv.pg[pn]&&vv.pg[pn].el){ vv.sc.scrollTop=vv.pg[pn].el.offsetTop; vv.cur=pn; }
        }
      });
      /* drag to reorder (notebook only) */
      card.addEventListener("dragstart", function(e){
        card.dataset.drag = "1";
        if(e.dataTransfer) e.dataTransfer.setData("text/plain", card.getAttribute("data-page"));
      });
      card.addEventListener("dragover", function(e){ e.preventDefault(); });
      card.addEventListener("drop", function(e){
        e.preventDefault();
        if(!v.nb) return;
        var src = parseInt(e.dataTransfer && e.dataTransfer.getData("text/plain"),10);
        var dst = pn;
        if(!src||!dst||src===dst) return;
        reorderPages(src,dst);
      });
    });
    if(navState.select){
      var bar=D.createElement("div"); bar.className="st-p3-selbar";
      var selCount=Object.keys(navState.selected).length;
      bar.innerHTML='<span>'+selCount+' selected</span><button type="button" class="pn-btn sm bad" data-act="st-p3-sel-del" '+(selCount?"":"disabled")+'>Delete</button><button type="button" class="pn-btn sm" data-act="st-p3-sel-copy" '+(selCount?"":"disabled")+'>Copy</button><button type="button" class="pn-btn sm" data-act="st-p3-sel-move" '+(selCount?"":"disabled")+'>Move</button>';
      root.querySelector(".st-sh").appendChild(bar);
      bar.querySelector("[data-act='st-p3-sel-del']").addEventListener("click", function(){ selectDelete(); });
      bar.querySelector("[data-act='st-p3-sel-copy']").addEventListener("click", function(){ selectCopy(); });
      bar.querySelector("[data-act='st-p3-sel-move']").addEventListener("click", function(){ selectMovePrompt(); });
    }
  }
  function reorderPages(src, dst){
    var v=V(); if(!v||!v.nb) return;
    ensureDocMeta(v.doc);
    var oldOrd=v.doc.ord.slice();
    var si=src-1, di=dst-1;
    var moved=oldOrd[si];
    var nw=oldOrd.slice();
    nw.splice(si,1); nw.splice(di,0,moved);
    v.doc.ord=nw;
    var op={ t:"p_reorder", oldOrd:oldOrd, newOrd:nw.slice() };
    put("docs", v.doc).then(function(){
      pushPageUndo(op);
      if(G.STUDY._reloadNb) G.STUDY._reloadNb(dst);
    });
  }
  function selectDelete(){
    var v=V(); if(!v||!v.nb) return;
    var keys=Object.keys(navState.selected);
    if(!keys.length) return;
    if(!G.confirm("Delete "+keys.length+" pages?")) return;
    var oldOrd=v.doc.ord.slice();
    keys.forEach(function(k){
      var ix=v.doc.ord.indexOf(Number(k)||k);
      if(ix!==-1) v.doc.ord.splice(ix,1);
      delete v.doc.tplMap[k];
      delete v.doc.rotMap[k];
      /* hide strokes */
      v.strokes.forEach(function(s){ if(String(s.page)===String(k) && !s.gone){ s.gone=true; put("strokes", s); } });
    });
    var op={ t:"p_reorder", oldOrd:oldOrd, newOrd:v.doc.ord.slice() };
    v.doc.pageCount=v.doc.ord.length;
    put("docs", v.doc).then(function(){
      pushPageUndo(op);
      if(G.STUDY._reloadNb) G.STUDY._reloadNb(1);
      removeSheet("stP3NavSheet");
    });
  }
  function selectCopy(){
    var v=V(); if(!v||!v.nb) return;
    var keys=Object.keys(navState.selected);
    keys.forEach(function(k){ /* clone each */ });
    /* simple: for each key create copy after it */
    ensureDocMeta(v.doc);
    var oldOrd=v.doc.ord.slice();
    var clones=[];
    var curOrd=v.doc.ord.slice();
    /* need to insert clones sequentially */
    keys.sort(function(a,b){ return curOrd.indexOf(Number(a)) - curOrd.indexOf(Number(b)); });
    keys.forEach(function(k){
      var nid=uid();
      var srcIdx=curOrd.indexOf(Number(k)||k);
      if(srcIdx!==-1){
        curOrd.splice(srcIdx+1,0,nid);
        v.doc.tplMap[nid]=tplForPage(v.doc,k);
        v.doc.rotMap[nid]=(v.doc.rotMap[k]||0);
        /* clone strokes */
        v.strokes.filter(function(s){ return String(s.page)===String(k); }).forEach(function(s){
          var c={ id: uid(), doc:v.id, page:nid, tool:s.tool, color:s.color, w:s.w, pts: s.pts.slice(), gone:false, t:Date.now() };
          v.strokes.push(c); clones.push(c); put("strokes", c);
        });
      }
    });
    v.doc.ord=curOrd;
    put("docs", v.doc).then(function(){
      var op={ t:"p_reorder", oldOrd:oldOrd, newOrd:curOrd.slice() };
      pushPageUndo(op);
      if(G.STUDY._reloadNb) G.STUDY._reloadNb(1);
      removeSheet("stP3NavSheet");
    });
  }
  function selectMovePrompt(){
    var dest = G.prompt("Move to position (1-"+V().n+")", "1");
    var di = Math.max(1, Math.min(V().n, parseInt(dest,10)||1));
    var keys=Object.keys(navState.selected);
    var v=V(); if(!v) return;
    var ord=v.doc.ord.slice();
    var oldOrd=ord.slice();
    /* remove selected in reverse */
    keys.forEach(function(k){ var ix=ord.indexOf(Number(k)||k); if(ix!==-1) ord.splice(ix,1); });
    var insertAtIdx = Math.min(di-1, ord.length);
    keys.forEach(function(k, i){ ord.splice(insertAtIdx+i,0, Number(k)||k); });
    v.doc.ord=ord;
    put("docs", v.doc).then(function(){
      var op={ t:"p_reorder", oldOrd:oldOrd, newOrd:ord.slice() };
      pushPageUndo(op);
      if(G.STUDY._reloadNb) G.STUDY._reloadNb(1);
      removeSheet("stP3NavSheet");
    });
  }
  function fillFavsNav(root){
    var v=V(); if(!v) return;
    var body=root.querySelector("#stP3FavBody");
    var keys = Object.keys(v.doc.favPages||{});
    if(!keys.length){
      body.innerHTML='<div class="st-p3-empty"><h4>Star pages to find them here</h4><p>Tap the star on a page to pin it.</p></div>';
      return;
    }
    /* sort by page number */
    keys.sort(function(a,b){
      var na = v.nb ? v.doc.ord.indexOf(Number(a)||a) : Number(a);
      var nb = v.nb ? v.doc.ord.indexOf(Number(b)||b) : Number(b);
      return na-nb;
    });
    var html="";
    keys.forEach(function(k){
      var pn = v.nb ? v.doc.ord.indexOf(Number(k)||k)+1 : Number(k);
      html+='<button type="button" class="st-p3-fav-row" data-page="'+pn+'"><span class="st-p3-fav-star">'+(ICO.starFill)+'</span><span>Page '+pn+'</span><small>'+esc(tplLabel(tplForPage(v.doc,k)))+'</small></button>';
    });
    body.innerHTML=html;
    body.querySelectorAll("[data-page]").forEach(function(b){
      b.addEventListener("click", function(){
        var pn=parseInt(b.getAttribute("data-page"),10);
        removeSheet("stP3NavSheet");
        var vv=V(); if(vv&&vv.pg&&vv.pg[pn]&&vv.pg[pn].el){ vv.sc.scrollTop=vv.pg[pn].el.offsetTop; vv.cur=pn; }
      });
    });
  }
  function pdfOutlineEntries(){
    var v=V(); if(!v||!v.pdf) return Promise.resolve([]);
    return v.pdf.getOutline().then(function(out){
      if(!out || !out.length) return [];
      var flat=flatOutlineFromPdf(out);
      /* out is array of {title, items} or getOutline shape */
      return flat;
    }).catch(function(){ return []; });
  }
  function flatOutlineFromPdf(out){
    var res=[];
    function walk(nodes, level){
      (nodes||[]).forEach(function(n){
        var title=n.title||"";
        /* n.dest is array, first element is page index (may be 0-based ref) */
        var dest = n.dest;
        var page = 1;
        if(dest && dest.length){
          var p0=dest[0];
          /* p0 may be object with num or number */
          if(p0 && typeof p0==="object" && p0.num!=null) page = p0.num;
          else if(typeof p0==="number") page = p0;
          else if(typeof p0==="string" && /^\d/.test(p0)) page = parseInt(p0,10);
        }
        /* n.page fallback */
        if(n.page) page=n.page;
        /* for pdfjs getOutline returns tree with items? handle */
        res.push({title:title, page: page, level: level||0});
        if(n.items && n.items.length) walk(n.items, (level||0)+1);
        if(n.children && n.children.length) walk(n.children, (level||0)+1);
      });
    }
    walk(out,0);
    return res;
  }
  function fillOutlinesNav(root){
    var v=V(); if(!v) return;
    var body=root.querySelector("#stP3OutlineBody");
    var filterInput=root.querySelector("#stP3OutlineFilter");
    ensureDocMeta(v.doc);
    var user = (v.doc.outlines||[]).slice();
    /* load pdf outline async if pdf */
    pdfOutlineEntries().then(function(pdfEntries){
      function render(){
        var q = filterInput ? filterInput.value : "";
        var pdfList = filterOutline(pdfEntries, q);
        var userList = filterOutline(user, q);
        var html="";
        if(userList.length||pdfList.length){
          if(pdfList.length){
            html+='<div class="st-p3-out-head">PDF chapters</div>'+ pdfList.map(function(e){ return '<button type="button" class="st-p3-out-row" data-page="'+e.page+'" style="padding-left:'+(8+e.level*12)+'px"><span>'+esc(e.title||"Chapter")+'</span><small>p.'+e.page+'</small></button>'; }).join("");
          }
          if(userList.length){
            html+='<div class="st-p3-out-head">Your outlines</div>'+ userList.map(function(e){ return '<div class="st-p3-out-row-wrap"><button type="button" class="st-p3-out-row" data-page="'+e.page+'"><span>'+esc(e.title)+'</span><small>p.'+e.page+'</small></button><button type="button" class="pn-btn sm" data-act="st-p3-rename" data-oid="'+e.id+'" style="min-height:36px">Rename</button></div>'; }).join("");
          }
        } else {
          html='<p class="pn-empty">No outlines yet. Add a page to outline.</p>';
        }
        body.innerHTML=html;
        body.querySelectorAll("[data-page]").forEach(function(b){
          b.addEventListener("click", function(){
            var pn=parseInt(b.getAttribute("data-page"),10)||1;
            var vv=V(); if(vv&&vv.pg&&vv.pg[pn]&&vv.pg[pn].el){ vv.sc.scrollTop=vv.pg[pn].el.offsetTop; vv.cur=pn; }
            removeSheet("stP3NavSheet");
          });
        });
        body.querySelectorAll("[data-act='st-p3-rename']").forEach(function(b){
          b.addEventListener("click", function(){
            var oid=b.getAttribute("data-oid");
            var entry=user.filter(function(e){ return e.id===oid; })[0] || (v.doc.outlines||[]).filter(function(e){ return e.id===oid; })[0];
            if(!entry) return;
            var newT=G.prompt("Rename", entry.title);
            if(!newT||!newT.trim()) return;
            var oldT=entry.title;
            entry.title=newT.trim().slice(0,120);
            var op={ t:"p_outline_rename", oid:oid, oldTitle:oldT, newTitle:entry.title };
            put("docs", v.doc).then(function(){ pushPageUndo(op); render(); });
          });
        });
      }
      render();
      if(filterInput){
        filterInput.addEventListener("input", render);
      }
    });
  }

  /* ---- toggle fav ---- */
  function toggleFavCurrent(){
    removeSheet("stP3MoreSheet");
    var v=V(); if(!v) return;
    ensureDocMeta(v.doc);
    var key=curPageKey()||String(v.cur||1);
    var oldMap=JSON.parse(JSON.stringify(v.doc.favPages||{}));
    var newMap=PURE.toggleFav(v.doc.favPages, key);
    /* toggleFav already returns new map with true/false logic */
    /* our PURE.toggleFav does toggle: if exists remove else add */
    v.doc.favPages=newMap;
    var op={ t:"p_fav", page:key, oldMap:oldMap, newMap:JSON.parse(JSON.stringify(newMap)) };
    put("docs", v.doc).then(function(){ pushPageUndo(op); refreshTopBar(); });
  }

  /* ---- Add page to outline ---- */
  function addToOutline(){
    var v=V(); if(!v||!v.doc) return;
    ensureDocMeta(v.doc);
    var cur=v.cur||1;
    var title=G.prompt("Outline title", "Chapter "+cur);
    if(!title||!title.trim()) return;
    var entry={ id: uid(), page: cur, title: title.trim().slice(0,120) };
    v.doc.outlines.push(entry);
    var op={ t:"p_outline_add", entry: entry };
    put("docs", v.doc).then(function(){ pushPageUndo(op); toast("Added to outline."); });
  }

  /* ---- top-level dispatch ---- */
  var PHASE3_ACTS = ["st-p3-back","st-p3-grid","st-p3-search","st-p3-share","st-p3-mic","st-p3-title","st-p3-fav","st-p3-add","st-p3-close","st-p3-more","st-p3-goto","st-p3-close-sheet","st-p3-place","st-p3-more-tpls","st-p3-confirm-add","st-p3-add-image","st-p3-add-scan","st-p3-add-photo","st-p3-add-pdf","st-p3-tab","st-p3-select-toggle","st-p3-nav-add","st-p3-change-tpl","st-p3-tpl-scope","st-p3-copy","st-p3-rotate","st-p3-outline","st-p3-clear","st-p3-settings","st-p3-scroll","st-p3-palm","st-p3-lock","st-p3-do-goto","st-p3-rename"];
  function isPhase3(a){ return PHASE3_ACTS.indexOf(a)!==-1; }

  function handlePhase3(a, el, h){
    var v=V();
    if(a==="st-p3-back"||a==="st-p3-close"){
      /* back to library */
      try{ if(G.STUDY&&G.STUDY.leave) G.STUDY.leave(); }catch(e){}
      var host2=h||host();
      if(host2&&host2.root){
        /* navigate back to library via host's pop? fallback to STUDY lib render */
        if(G.STUDY&&G.STUDY.lib) G.STUDY.lib(host2);
        else if(h&&h.back) h.back();
      } else if(G.STUDY&&G.STUDY.lib&&host()) G.STUDY.lib(host());
      return;
    }
    if(a==="st-p3-grid"){
      openNavigator("thumbs");
      return;
    }
    if(a==="st-p3-search"){ openComingSoon("Search","Search is coming soon in Phase 5."); return; }
    if(a==="st-p3-share"){ openComingSoon("Share","Share is coming soon in Phase 5."); return; }
    if(a==="st-p3-mic"){ openComingSoon("Microphone","Voice notes are coming soon in Phase 5."); return; }
    if(a==="st-p3-title"){
      /* notebook title menu: rename, duplicate, export */
      var html='<div class="st-p3-sh-head"><h3>'+esc(v?v.doc.title:"")+'</h3><button type="button" class="pn-btn sm" data-act="st-p3-close-sheet">Done</button></div>' +
        '<div class="st-p3-menu"><button type="button" class="st-p3-menu-item" data-act="st-p3-title-rename">'+ICO.copy+'<div class="st-p3-menu-txt"><strong>Rename</strong></div></button>' +
        '<button type="button" class="st-p3-menu-item" data-act="st-p3-title-dup">'+ICO.copy+'<div class="st-p3-menu-txt"><strong>Duplicate</strong></div></button>' +
        '<button type="button" class="st-p3-menu-item" data-act="st-p3-title-export">'+ICO.pdf+'<div class="st-p3-menu-txt"><strong>Export</strong></div></button></div>';
      var s=sheetEl("stP3TitleSheet", html);
      if(!s) return;
      s.querySelector("[data-act='st-p3-title-rename']").addEventListener("click", function(){
        var nv=V(); if(!nv) return;
        var t=G.prompt("Rename notebook", nv.doc.title);
        if(t&&t.trim()){ nv.doc.title=t.trim().slice(0,120); put("docs", nv.doc).then(function(){ refreshTopBar(); }); }
        removeSheet("stP3TitleSheet");
      });
      s.querySelector("[data-act='st-p3-title-dup']").addEventListener("click", function(){
        var nv=V(); if(!nv) return;
        var copy = JSON.parse(JSON.stringify(nv.doc));
        copy.id=uid(); copy.title=(nv.doc.title||"Notebook")+" copy"; copy.created=Date.now(); copy.lastOpened=0;
        /* new ids for ord pages */
        copy.ord = (copy.ord||[]).map(function(){ return uid(); });
        copy.tplMap={}; copy.rotMap={}; copy.ord.forEach(function(pid){ copy.tplMap[pid]=copy.style||"ruled"; copy.rotMap[pid]=0; });
        /* clone strokes mapping */
        var map={}; (nv.doc.ord||[]).forEach(function(oldId,i){ map[oldId]=copy.ord[i]; });
        var strokesCopy = nv.strokes.map(function(s){
          var c={ id: uid(), doc: copy.id, page: map[s.page]||s.page, tool:s.tool, color:s.color, w:s.w, pts: s.pts.slice(), gone:false, t:Date.now() };
          put("strokes", c); return c;
        });
        put("docs", copy).then(function(){ toast("Notebook duplicated."); removeSheet("stP3TitleSheet"); });
      });
      s.querySelector("[data-act='st-p3-title-export']").addEventListener("click", function(){
        removeSheet("stP3TitleSheet");
        /* delegate to existing flatten export via more sheet? just call study.js act */
        if(G.STUDY&&G.STUDY.act) G.STUDY.act("st-flat", null, host());
      });
      return;
    }
    if(a==="st-p3-fav"){ toggleFavCurrent(); return; }
    if(a==="st-p3-add"){ openAddPageSheet(); return; }
    if(a==="st-p3-more"){ openMoreSheet(); return; }
    if(a==="st-p3-goto"){ openGoToSheet(); return; }
    if(a==="st-p3-close-sheet"){
      ["stP3AddSheet","stP3TplSheet","stP3MoreSheet","stP3SettingsSheet","stP3GoSheet","stP3NavSheet","stP3SoonSheet","stP3TitleSheet"].forEach(removeSheet);
      return;
    }
    if(a==="st-p3-add-image"){
      /* Image -> pick photo that creates new page doc? Use pickPhotos */
      if(G.STUDY&&G.STUDY._pickPhotos) G.STUDY._pickPhotos();
      removeSheet("stP3AddSheet"); return;
    }
    if(a==="st-p3-add-scan"){
      if(G.STUDY&&G.STUDY._doScan) G.STUDY._doScan();
      removeSheet("stP3AddSheet"); return;
    }
    if(a==="st-p3-add-photo"){
      if(G.STUDY&&G.STUDY._pickPhotos) G.STUDY._pickPhotos();
      removeSheet("stP3AddSheet"); return;
    }
    if(a==="st-p3-add-pdf"){
      if(G.STUDY&&G.STUDY._pickPdf) G.STUDY._pickPdf();
      removeSheet("stP3AddSheet"); return;
    }
    if(a==="st-p3-copy"){ copyPage(); removeSheet("stP3MoreSheet"); return; }
    if(a==="st-p3-rotate"){ rotatePage(); removeSheet("stP3MoreSheet"); return; }
    if(a==="st-p3-outline"){ addToOutline(); removeSheet("stP3MoreSheet"); return; }
    if(a==="st-p3-change-tpl"){ removeSheet("stP3MoreSheet"); openChangeTemplate("page"); return; }
    if(a==="st-p3-clear"){ clearPage(); removeSheet("stP3MoreSheet"); return; }
    if(a==="st-p3-settings"){ removeSheet("stP3MoreSheet"); openSettingsSheet(); return; }
  }

  /* ---- wrap STUDY.act ---- */
  function wrap(){
    if(!G.STUDY||!G.STUDY.act) { setTimeout(wrap, 100); return; }
    if(G.STUDY.act._p3wrapped) return;
    var orig=G.STUDY.act;
    var wrapped=function(a, el, h){
      /* intercept undo/redo if top is page op */
      if(a==="st-undo"||a==="st-redo"){
        var isU = a==="st-undo";
        if(doPageUndo(isU)) return;
      }
      if(isPhase3(a)){
        handlePhase3(a, el, h);
        return;
      }
      /* also close sheets on back? orig handles */
      return orig(a, el, h);
    };
    wrapped._p3wrapped=true;
    G.STUDY.act=wrapped;
    G.STUDY._p3orig=orig;
  }
  wrap();

  /* ---- observer to inject top bar & refresh ---- */
  function observe(){
    var h=host(); var root=h&&h.root? h.root(): null;
    if(root){
      var vv=V();
      /* inject or update */
      if(vv&&vv.doc){
        if(!root.querySelector("#stP3Top") || enhancedFor!==vv.doc.id){
          injectTopBar();
        } else refreshTopBar();
        /* fix old toolbar page indicator */
        var cur=root.querySelector("#stCurP"); if(cur) cur.textContent=vv.cur||1;
        var tot=root.querySelector("#stTotP"); if(tot) tot.textContent=vv.n||1;
        var tbPage=root.querySelector("#stTbPage"); if(tbPage) tbPage.value=vv.cur||1;
      } else {
        /* no viewer => remove top bar */
        var old=root.querySelector("#stP3Top"); if(old) old.remove();
        var pg=root.querySelector("#stP3Pager"); if(pg) pg.remove();
        var zw=root.querySelector("#stP3ZoomWindow"); if(zw) zw.remove();
        enhancedFor=null;
      }
    }
  }
  if(D && D.body){
    if(D.MutationObserver){
      var mo=new G.MutationObserver(function(){ observe(); });
      mo.observe(D.body, {childList:true, subtree:true});
    }
  }
  setInterval(observe, 300);

  /* zoom window interaction: magnified writing strip at bottom that auto-advances with pen Y */
  function bindZoomWindow(){
    var h=host(); if(!h||!h.root) return;
    var sc=h.root().querySelector("#stSc");
    if(!sc||sc._p3zw) return; sc._p3zw=true;
    function drawZoom(e){
      var v=V(); if(!v||!v.tool) return;
      var zw=h.root().querySelector("#stP3ZoomWindow");
      if(!zw) return;
      zw.hidden=false;
      var ovWrap = e.target && e.target.closest && e.target.closest(".st-pg");
      var cv = zw.querySelector("#stP3ZoomCv");
      if(!cv) return;
      var ctx=cv.getContext("2d");
      ctx.fillStyle="#fff"; ctx.fillRect(0,0,cv.width,cv.height);
      ctx.strokeStyle="#071318"; ctx.strokeRect(0,0,cv.width,cv.height);
      try {
        var pageCv = null;
        var pgEl = ovWrap;
        if(pgEl){ var baseCv=pgEl.querySelector("canvas.st-cv"); if(baseCv) pageCv=baseCv; }
        if(pageCv && e.offsetX!=null){
          var fracX = e.offsetX / pageCv.width, fracY = e.offsetY / pageCv.height;
          if(!(fracX>=0 && fracX<=1)) { var r=pageCv.getBoundingClientRect(); fracX=(e.clientX-r.left)/r.width; fracY=(e.clientY-r.top)/r.height; }
          var sw=pageCv.width*0.35, sh=60;
          var sx=Math.max(0, pageCv.width*fracX - sw/2), sy=Math.max(0, pageCv.height*fracY - sh/2);
          ctx.drawImage(pageCv, sx, sy, sw, sh, 0,0, cv.width, cv.height);
        }
      }catch(e2){}
    }
    sc.addEventListener("pointerdown", drawZoom);
    sc.addEventListener("pointermove", function(e){ if(e.pointerType==="pen"||e.pointerType==="touch") drawZoom(e); });
    sc.addEventListener("pointerup", function(){
      var zw=h.root().querySelector("#stP3ZoomWindow"); if(zw) zw.hidden=true;
    });
    sc.addEventListener("pointercancel", function(){
      var zw=h.root().querySelector("#stP3ZoomWindow"); if(zw) zw.hidden=true;
    });
  }
  setInterval(bindZoomWindow, 600);

  /* expose for tests */
  G.STUDY_PAGES = { _pure: PURE, _openNavigator: openNavigator, _openAdd: openAddPageSheet, _refresh: refreshTopBar, _addPage: addPage, _rotate: rotatePage, _clear: clearPage, _copy: copyPage, _changeTplSheet: openChangeTemplate };

})(typeof window!=="undefined"?window:this);
