/* Navigation only: shortcuts never execute a write action. No account data is persisted. */
(function(){
  'use strict';
  var $=function(id){return document.getElementById(id);};
  var nav=$('nav'), main=document.querySelector('main'), side=document.querySelector('.side');
  var links=Array.prototype.slice.call(nav.querySelectorAll('[data-p]')), records=[], pins=[];
  var defaults=['userctl','aictl','pro','ota'];
  try{pins=JSON.parse(localStorage.getItem('smd-admin-pins')||'null')||defaults;}catch(e){pins=defaults;}
  if(!Array.isArray(pins))pins=defaults;
  function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;}
  main.id='adminMain';main.tabIndex=-1;side.id='adminNavigation';nav.setAttribute('aria-label','Administration');
  var skip=el('a','dash-skip','Skip to content');skip.href='#adminMain';document.body.insertBefore(skip,document.body.firstChild);
  document.querySelector('.brand').innerHTML='Steward<span>MD</span>';
  links.forEach(function(a){
    var id=a.getAttribute('data-p'), pane=$('pane-'+id);
    if(a.firstChild&&a.firstChild.nodeType===3)a.firstChild.textContent=a.firstChild.textContent.replace(/^[^A-Za-z]+/,'');
    a.href='#'+id;
    var name=a.firstChild.textContent.trim();records.push({id:id,name:name,group:'Workspace',target:pane});
    Array.prototype.forEach.call(pane.querySelectorAll(':scope > .card'),function(card,i){
      var heading=card.querySelector('b');if(!heading)return;
      if(!card.id)card.id='admin-'+id+'-'+i;
      records.push({id:id,name:heading.textContent,group:name,target:card});
    });
  });
  var external=el('a','','EMR connections');external.href='/admin/connect-emr.html';nav.appendChild(el('div','grp','Connected care'));nav.appendChild(external);
  var toolbar=el('div','dash-toolbar'),menu=el('button','ghost dash-menu','Menu'),search=el('button','dash-search','Find a control or workspace');
  menu.id='adminMenu';menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-controls','adminNavigation');
  search.id='adminSearch';search.appendChild(el('span','dash-kbd','⌘ / Ctrl K'));toolbar.appendChild(menu);toolbar.appendChild(search);main.insertBefore(toolbar,main.firstChild);
  var scrim=el('button','dash-scrim');scrim.setAttribute('aria-label','Close navigation');document.body.appendChild(scrim);
  function menuOpen(on){document.body.classList.toggle('dash-open',on);menu.setAttribute('aria-expanded',String(on));syncSide();if(on)links[0].focus();else menu.focus();}
  function syncSide(){side.inert=window.innerWidth<=760&&!document.body.classList.contains('dash-open');}
  menu.onclick=function(){menuOpen(!document.body.classList.contains('dash-open'));};scrim.onclick=function(){menuOpen(false);};window.addEventListener('resize',syncSide);syncSide();
  var overview=$('pane-overview'),intro=el('div','dash-intro');intro.innerHTML='<div class="dash-eyebrow">StewardMD administration</div><h1>Your operations, in one place.</h1><p>Manage access, oversee AI, publish content, and keep your app running smoothly.</p>';overview.insertBefore(intro,overview.firstChild);
  var pinTitle=el('h2','dash-section','Pinned workspaces'),pinBox=el('div','dash-pins');pinBox.id='adminPins';overview.insertBefore(pinBox,intro.nextSibling);overview.insertBefore(pinTitle,pinBox);
  function renderPins(){pinBox.textContent='';pins.filter(function(id){return links.some(function(a){return a.dataset.p===id;});}).forEach(function(id){var r=records.filter(function(x){return x.id===id&&x.group==='Workspace';})[0];var a=el('a','',r.name);a.href='#'+id;a.onclick=function(e){e.preventDefault();navigate(r);};pinBox.appendChild(a);});if(!pinBox.children.length)pinBox.textContent='Use Find a control to pin your most-used workspaces.';}
  renderPins();
  var heading=el('h2','dash-section','Control center');heading.appendChild(el('small','','Choose a workspace to review settings and make changes.'));overview.appendChild(heading);
  var grid=el('div','dash-grid');overview.appendChild(grid);
  [['userctl','People & access','Manage individual accounts, restrictions, and entitlements.'],['aictl','AI governance','Models, daily budgets, module limits, and emergency controls.'],['pro','Billing & plans','Prices, subscriptions, coupons, and AI credits.'],['config','App configuration','Maintenance, minimum builds, and fleet-wide banners.'],['ota','Release management','Review staged builds, delivery status, and rollback history.'],['support','Support & quality','Review tickets and help doctors resolve issues.'],['notif','Content & notifications','Draft, preview, and publish medical updates.'],['analytics','Usage & reliability','Review feature adoption and usage trends.'],['tenants','Institutions','Manage medical colleges and institution access.']].forEach(function(x){var a=el('a','dash-link');a.href='#'+x[0];a.appendChild(el('strong','',x[1]));a.appendChild(el('span','',x[2]));a.onclick=function(e){e.preventDefault();navigate(records.filter(function(r){return r.id===x[0];})[0]);};grid.appendChild(a);});
  var emr=el('a','dash-link');emr.href='/admin/connect-emr.html';emr.innerHTML='<strong>EMR connections</strong><span>Onboard hospitals, configure integrations, and monitor connection health.</span>';grid.appendChild(emr);
  var dialog=el('dialog','dash-dialog');dialog.id='adminCommand';dialog.setAttribute('aria-labelledby','adminCommandTitle');dialog.innerHTML='<header><h2 id="adminCommandTitle">Find a control</h2><button class="ghost" id="adminCommandClose">Close</button></header><label for="adminCommandInput">Search workspaces and settings</label><input id="adminCommandInput" type="search" placeholder="Try budget, coupons, model, or release" autocomplete="off"><div id="adminSearchStatus" class="hint" role="status"></div><div id="adminResults" class="dash-results"></div>';document.body.appendChild(dialog);
  function results(){var q=$('adminCommandInput').value.toLowerCase().trim(),out=$('adminResults');out.textContent='';var matches=records.filter(function(r){return (r.name+' '+r.group).toLowerCase().indexOf(q)>=0;});$('adminSearchStatus').textContent=matches.length+' controls found';matches.forEach(function(r){var row=el('div','dash-result'),a=el('a','',r.name);a.href='#'+r.id;a.appendChild(el('small','',r.group));a.onclick=function(e){e.preventDefault();dialog.close();navigate(r);};row.appendChild(a);if(r.group==='Workspace'){var pin=el('button','ghost',pins.indexOf(r.id)>=0?'Unpin':'Pin');pin.setAttribute('aria-label',pin.textContent+' '+r.name);pin.onclick=function(){var at=pins.indexOf(r.id);if(at>=0)pins.splice(at,1);else pins.push(r.id);try{localStorage.setItem('smd-admin-pins',JSON.stringify(pins));}catch(e){}renderPins();var isPinned=pins.indexOf(r.id)>=0;pin.textContent=isPinned?'Unpin':'Pin';pin.setAttribute('aria-label',pin.textContent+' '+r.name);};row.appendChild(pin);}out.appendChild(row);});if(!matches.length)out.appendChild(el('p','dash-empty','No matching controls. Try a shorter search or a workspace name.'));}
  search.onclick=function(){dialog.showModal();$('adminCommandInput').value='';results();$('adminCommandInput').focus();};$('adminCommandClose').onclick=function(){dialog.close();};$('adminCommandInput').oninput=results;
  function navigate(r){var link=links.filter(function(a){return a.dataset.p===r.id;})[0];if(link)link.click();if(r.target&&r.target.closest('.pane').classList.contains('on')){r.target.tabIndex=-1;r.target.focus();r.target.scrollIntoView({block:'start'});r.target.classList.add('dash-flash');setTimeout(function(){r.target.classList.remove('dash-flash');},1400);}}
  function update(){links.forEach(function(a){if(a.classList.contains('on'))a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});var pane=document.querySelector('.pane.on');if(!pane)return;var old=main.querySelector('.dash-jump');if(old)old.remove();var choices=records.filter(function(r){return r.id===pane.id.replace('pane-','')&&r.group!=='Workspace';});if(choices.length>1){var select=el('select','dash-jump');select.setAttribute('aria-label','Jump to a control in this workspace');select.appendChild(new Option('Jump to a control…',''));choices.forEach(function(r){select.appendChild(new Option(r.name,r.target.id));});select.onchange=function(){var n=$(select.value);if(n){n.tabIndex=-1;n.focus();n.scrollIntoView({block:'start'});}};main.insertBefore(select,$('gate'));}}
  nav.addEventListener('click',function(e){var a=e.target.closest('[data-p]');if(!a)return;e.preventDefault();history.replaceState(null,'','#'+a.dataset.p);if(document.body.classList.contains('dash-open'))menuOpen(false);update();});
  new MutationObserver(update).observe($('hTitle'),{childList:true});update();
  document.addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!dialog.open)search.click();}if(e.key==='Escape'&&document.body.classList.contains('dash-open'))menuOpen(false);if(e.key==='Tab'&&document.body.classList.contains('dash-open')){var focusable=side.querySelectorAll('a[href]');var first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  Array.prototype.forEach.call(document.querySelectorAll('.msg'),function(n){n.setAttribute('role','status');n.setAttribute('aria-live','polite');});
  Array.prototype.forEach.call(document.querySelectorAll('label:not([for])'),function(n){var input=n.nextElementSibling;if(input&&/^(INPUT|SELECT|TEXTAREA)$/.test(input.tagName)&&input.id)n.htmlFor=input.id;});
  var budget=$('aicBudget');if(budget)budget.setAttribute('aria-label','Daily AI budget cap in rupees');
  var requested=location.hash.slice(1);if(links.some(function(a){return a.dataset.p===requested;}))links.filter(function(a){return a.dataset.p===requested;})[0].click();
})();
