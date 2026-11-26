/*zwf-prompt*/function zwfPrompt(w,cat,ctx){var d=String(ctx.domain||'').trim(),c=String(ctx.company||'').trim();var who=d&&c&&c.toLowerCase()!==d.toLowerCase()?c+' ('+d+')':(d||c||'my company');return ['Run this GTM workflow with looot for '+who+'. It is workflow '+w.id+' in '+cat+'.','Task. '+w.task,'Check first. '+w.check,'Then. '+w.output,'Use looot for every data call. Before anything runs, show me the looot jobs you plan to use with the price and the most it can cost, then wait for my yes. Send nothing, post nothing and change nothing in my CRM or outreach tools without my yes.'].join('\n')}/*/zwf-prompt*/
(function(){
var V=document.querySelector('[data-view="workflows"]');if(!V)return;
var DT=document.getElementById('zwf-data');
if(DT){var D0=null;try{D0=JSON.parse(DT.textContent)}catch(e){D0=null}if(D0)boot(D0);return}
// City pages: the catalog loads only when the view opens, from data-src (zeus/workflows.js beside the page, or a same-origin URL).
var src=V.getAttribute('data-src'),asked=false,hm=V.querySelector('.zwf-home');if(!src)return;
window.zwfData=function(D){window.zwfData=function(){};try{boot(D)}catch(e){fail()}};
function fail(){if(hm)hm.innerHTML='<p class="zwf-load">The workflows did not load. Reload the page to try again.</p>'}
function want(){if(asked||location.hash!=='#workflows')return;asked=true;if(hm)hm.innerHTML='<p class="zwf-load">Loading the workflows</p>';
if(/\.json(\?|$)/.test(src)){fetch(src).then(function(r){if(!r.ok)throw 0;return r.json()}).then(window.zwfData,fail)}
else{var sc=document.createElement('script');sc.src=src;sc.async=true;sc.addEventListener('error',fail);document.head.appendChild(sc)}}
addEventListener('hashchange',want);document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href="#workflows"]');if(a)setTimeout(want,0)});want();
function boot(D){
var CATS=D.c,PV=D.pv||[],ALL=D.w.map(function(r){return {id:r[0],cat:r[1],task:r[2],check:r[3],output:r[4],f:r[5]===1,p:r[6]||[]}});
CATS.forEach(function(c,i){var n={};ALL.forEach(function(w){if(w.cat===i)w.p.forEach(function(x,k){n[x]=(n[x]||0)+10-Math.min(k,9)})});c.pu=Object.keys(n).map(Number).sort(function(a,b){return n[b]-n[a]||a-b})});
var CTX={domain:V.getAttribute('data-domain')||'',company:V.getAttribute('data-company')||''};
var RM=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var home=V.querySelector('.zwf-home'),body=V.querySelector('.zwf-body'),rail=V.querySelector('.zwf-rail'),panel=V.querySelector('.zwf-panel'),q=V.querySelector('.zwf-search input'),x=V.querySelector('.zwf-x'),cnt=V.querySelector('.zwf-count'),fb=V.querySelector('.zwf-fold-b');
function sv(p){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+p+'</svg>'}
var IC={run:'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.2-6.4a.8.8 0 0 0 0-1.4L9.2 4.9A.8.8 0 0 0 8 5.6z"/></svg>',
ok:sv('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),chev:sv('<path d="M9 6l6 6-6 6"/>'),back:sv('<path d="M15 6l-6 6 6 6"/>'),arrow:sv('<path d="M5 12h14M13 6l6 6-6 6"/>'),
check:sv('<path d="M12 3l7.5 3v5.5c0 4.3-3.2 7.9-7.5 9.5-4.3-1.6-7.5-5.2-7.5-9.5V6z"/><path d="M9 12l2 2 4-4"/>'),
then:sv('<path d="M4 7h11a4 4 0 0 1 0 8H8"/><path d="M11 12l-3 3 3 3"/>')};
function ci(i){return '<span class="zwf-vx"><svg viewBox="4 3 40 40" aria-hidden="true">'+CATS[i].ic+'</svg></span>'}
function on(i){return CATS[i].o||CATS[i].name}
function stack(ids,max,deco){if(!PV.length||!ids.length)return '';var vis=ids.length>max+1?ids.slice(0,max):ids,more=ids.length-vis.length,names=ids.map(function(x){return PV[x][0]}).join(', ');
return '<div class="zwf-pv"'+(deco?' aria-hidden="true"':' role="group" tabindex="0" aria-label="Runs on looot data from '+esc(names)+'" data-names="'+esc(names)+'"')+'>'+vis.map(function(x,j){return '<span class="zwf-lg" style="--j:'+j+'" data-n="'+esc(PV[x][0])+'"><'+'img src="'+PV[x][1]+'" alt="" width="32" height="32" decoding="async"></span>'}).join('')+(more?'<span class="zwf-lgm">+'+more+'</span>':'')+'</div>'}
function uses(w){var h=stack(w.p,7,false);return h?'<div class="zwf-pvr"><span class="zwf-pvl">Data from</span>'+h+'</div>':''}
var st={cat:-1,q:'',shown:40,scope:-1,rest:10};
function esc(t){return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmt(n){return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,',')}
function terms(){return st.q.toLowerCase().split(/\s+/).filter(Boolean)}
function hi(t,ts){if(!ts.length)return esc(t);var low=t.toLowerCase(),marks=[];ts.forEach(function(w){var i=0;while((i=low.indexOf(w,i))>-1){marks.push([i,i+w.length]);i+=w.length}});
if(!marks.length)return esc(t);marks.sort(function(a,b){return a[0]-b[0]});var out='',p=0;marks.forEach(function(m){if(m[0]<p)m[0]=p;if(m[1]<=p)return;out+=esc(t.slice(p,m[0]))+'<mark>'+esc(t.slice(m[0],m[1]))+'</mark>';p=m[1]});return out+esc(t.slice(p))}
function match(w,ts){var s=(w.task+' '+w.check+' '+w.output+' '+CATS[w.cat].name).toLowerCase();for(var i=0;i<ts.length;i++)if(s.indexOf(ts[i])<0)return false;return true}
function stg(i){return RM?'':' zwf-st" style="--i:'+Math.min(i,14)}
function btn(w,ghost){return '<button type="button" class="zwf-run'+(ghost?' zwf-ghost':'')+'" data-wf="'+w.id+'" aria-label="Run this workflow, '+esc(w.task)+'">'+IC.run+'<span>Run this workflow</span></button>'}
function bl(w,ts){return '<div class="zwf-bl"><div class="zwf-b"><i>'+IC.check+'</i><div><b>Check first</b><p>'+hi(w.check,ts)+'</p></div></div><div class="zwf-b"><i>'+IC.then+'</i><div><b>Then</b><p>'+hi(w.output,ts)+'</p></div></div></div>'}
function tag(i){return '<span class="zwf-tag zwf-t'+CATS[i].t+'">'+ci(i)+esc(on(i))+'</span>'}
function card(w,i){return '<article class="zwf-card zwf-in'+stg(i)+'"><h4 class="zwf-task">'+esc(w.task)+'</h4>'+bl(w,[])+uses(w)+'<div class="zwf-go">'+btn(w,false)+'<span class="zwf-id">#'+w.id+'</span></div></article>'}
function row(w,ts,showCat,op){return '<div class="zwf-row"><details'+(op?' open':'')+'><summary><i>'+IC.chev+'</i><span>'+hi(w.task,ts)+(showCat?'<span class="zwf-meta zwf-sm">'+tag(w.cat)+'<span class="zwf-id">#'+w.id+'</span></span>':'')+'</span></summary>'+bl(w,ts)+'<div class="zwf-in">'+uses(w)+'</div></details><div class="zwf-go">'+btn(w,true)+'</div></div>'}
function trig(rs){for(var i=0;i<rs.length;i++){var m=rs[i].task.match(/\(([^()]+)\)\.?$/);if(m)return m[1].charAt(0).toUpperCase()+m[1].slice(1)}return rs[0].check}
function paintRail(counts){if(!rail.querySelector('.zwf-cat')){var h='';CATS.forEach(function(c,i){h+='<button type="button" class="zwf-cat zwf-t'+c.t+'" data-cat="'+i+'" aria-pressed="false" title="'+esc(on(i))+'"><span class="zwf-ci">'+ci(i)+'</span><span class="zwf-cl">'+esc(on(i))+'</span><span class="zwf-n"></span></button>'});rail.insertAdjacentHTML('beforeend',h)}
[].forEach.call(rail.querySelectorAll('.zwf-cat'),function(b,i){var n=counts?counts[i]:CATS[i].count,on=counts?st.scope===i:st.cat===i;b.setAttribute('aria-pressed',String(on));b.classList.toggle('zwf-none',!!counts&&!n);b.disabled=!!counts&&!n;b.querySelector('.zwf-n').textContent=n})}
function paintHome(){var h='<div class="zwf-sec"><h2>Browse by category</h2><span>'+CATS.length+' categories, '+fmt(ALL.length)+' workflows</span></div><div class="zwf-cats">';
CATS.forEach(function(c,i){h+='<button type="button" class="zwf-cc zwf-in zwf-t'+c.t+stg(i)+'" data-cat="'+i+'"><span class="zwf-cc-top">'+ci(i)+'<span class="zwf-cc-n zwf-pill">'+c.count+' workflows</span></span><span class="zwf-cc-h">'+esc(on(i))+'</span>'+(c.lead?'<span class="zwf-cc-p">'+esc(c.lead)+'</span>':'')+stack(c.pu,6,true)+'<span class="zwf-cc-go">See the workflows'+IC.arrow+'</span></button>'});
home.innerHTML=h+'</div>'}
function paintCat(){var c=CATS[st.cat],ws=ALL.filter(function(w){return w.cat===st.cat}),fe=ws.filter(function(w){return w.f}),rest=ws.filter(function(w){return !w.f});
var h='<button type="button" class="zwf-back">'+IC.back+'All categories</button><div class="zwf-ch'+stg(0)+'">'+ci(st.cat)+'<div><h2>'+esc(on(st.cat))+'</h2><small><span class="zwf-pill">'+c.count+' workflows</span>'+(c.o?'<span class="zwf-old">'+esc(c.name)+'</span>':'')+'</small></div></div>';
if(c.lead)h+='<p class="zwf-lead'+stg(1)+'">'+esc(c.lead)+'</p>';
h+='<div class="zwf-sh"><h3>Start with these</h3><span>'+fe.length+' workflows, one for each trigger</span></div><div class="zwf-grid">'+fe.map(function(w,i){return card(w,i+2)}).join('')+'</div>';
var groups=[],g=null;rest.forEach(function(w){if(!g||g.k!==w.check){g={k:w.check,rs:[]};groups.push(g)}g.rs.push(w)});
var left=st.rest,gh='';groups.forEach(function(gr){if(left<=0)return;var vis=gr.rs.slice(0,left);left-=vis.length;gh+='<div class="zwf-grp"><h4 class="zwf-gh"><span>Trigger</span>'+esc(trig(gr.rs))+'</h4><div class="zwf-list">'+vis.map(function(w){return row(w,[],false,false)}).join('')+'</div></div>'});
h+='<div class="zwf-sh"><h3>'+rest.length+' more workflows</h3><span>Grouped by trigger. Open one to see the check.</span></div><div class="zwf-groups">'+gh+'</div>';
if(rest.length>st.rest)h+='<div class="zwf-more"><button type="button" class="zwf-run zwf-ghost zwf-more-b">Show '+Math.min(30,rest.length-st.rest)+' more</button></div>';
panel.innerHTML=h;cnt.innerHTML='';paintRail(null)}
function paintSearch(){var ts=terms(),hits=ALL.filter(function(w){return match(w,ts)}),counts=CATS.map(function(){return 0});hits.forEach(function(w){counts[w.cat]++});
if(st.scope>-1&&!counts[st.scope])st.scope=-1;var list=st.scope>-1?hits.filter(function(w){return w.cat===st.scope}):hits;
list=list.slice().sort(function(a,b){return (b.f?1:0)-(a.f?1:0)||a.cat-b.cat});
paintRail(counts);
var where=st.scope>-1?' in <b>'+esc(on(st.scope))+'</b>':'';
cnt.innerHTML=hits.length?'<b>'+fmt(list.length)+'</b> '+(list.length===1?'workflow matches':'workflows match')+' <b>'+esc(st.q)+'</b>'+where+(st.scope>-1?'':' across <b>'+counts.filter(Boolean).length+'</b> categories'):'';
if(!hits.length){panel.innerHTML='<div class="zwf-empty"><b>No workflow matches '+esc(st.q)+'</b>Try one word, like hiring, renewal or pricing.</div>';return}
var h='<div class="zwf-list">'+list.slice(0,st.shown).map(function(w,i){return row(w,ts,true,i<3)}).join('')+'</div>';
if(list.length>st.shown)h+='<div class="zwf-more"><button type="button" class="zwf-run zwf-ghost zwf-more-b">Show '+Math.min(40,list.length-st.shown)+' more of '+fmt(list.length-st.shown)+'</button></div>';
panel.innerHTML=h}
function paint(){var srch=!!st.q,inCat=!srch&&st.cat>-1;V.classList.toggle('zwf-compact',inCat);home.hidden=srch||inCat;body.hidden=!(srch||inCat);if(srch)paintSearch();else if(inCat)paintCat();else{cnt.innerHTML='';paintHome()}}
function setQ(v){q.value=v;st.q=v.trim();st.shown=40;st.scope=-1;x.hidden=!st.q;paint()}
var tq=null;
q.addEventListener('input',function(){clearTimeout(tq);tq=setTimeout(function(){var nv=q.value.trim();if(nv!==st.q)setQ(q.value)},120)});
q.addEventListener('keydown',function(e){if(e.key==='Escape'&&q.value)setQ('')});
x.addEventListener('click',function(){setQ('');q.focus()});
[].forEach.call(V.querySelectorAll('.zwf-hint button'),function(b){b.addEventListener('click',function(){setQ(b.textContent);q.focus()})});
function openCat(i){st.cat=i;st.rest=10;paint();if(V.getBoundingClientRect().top<0)V.scrollIntoView({block:'start',behavior:'auto'})}
home.addEventListener('click',function(e){var b=e.target.closest('.zwf-cc');if(b)openCat(+b.getAttribute('data-cat'))});
rail.addEventListener('click',function(e){var b=e.target.closest('.zwf-cat');if(!b)return;var i=+b.getAttribute('data-cat');
if(st.q){st.scope=st.scope===i?-1:i;st.shown=40;paintSearch();return}
if(i===st.cat)return;openCat(i);
if(window.innerWidth<=920){var nb=rail.querySelector('[data-cat="'+i+'"]');if(nb&&nb.scrollIntoView)nb.scrollIntoView({block:'nearest',inline:'center',behavior:RM?'auto':'smooth'})}});
var FK='zeus.wfRailFolded';function fold(on,save){body.classList.toggle('zwf-fold',on);fb.setAttribute('aria-expanded',String(!on));fb.setAttribute('aria-label',on?'Show category names':'Fold the category list');if(save){try{localStorage.setItem(FK,on?'1':'0')}catch(e){}}}
var f0=false;try{f0=localStorage.getItem(FK)==='1'}catch(e){}fold(f0,false);
fb.addEventListener('click',function(){fold(!body.classList.contains('zwf-fold'),true)});
var ZM=document.querySelector('meta[name="looot-zeus-token"]'),ZTOK=ZM?ZM.getAttribute('content'):'';
function done(b,label){var sp=b.querySelector('span');if(!sp)return;var o=sp.textContent,oi=b.querySelector('svg').outerHTML;b.classList.add('zwf-done');b.querySelector('svg').outerHTML=IC.ok;sp.textContent=label;
setTimeout(function(){b.classList.remove('zwf-done');var s=b.querySelector('svg');if(s)s.outerHTML=oi;sp.textContent=o},2200)}
function copyIt(w,b){var p=zwfPrompt(w,CATS[w.cat].name,CTX);var fin=function(){done(b,'Prompt copied');if(window.zCopied)zCopied('Paste it into your agent to run this workflow. It shows the price first.');else if(window.zSay)zSay('Prompt copied')};
if(window.zCopy)zCopy(p,fin);else{try{navigator.clipboard.writeText(p).then(fin,function(){})}catch(e){}}}
function run(w,b){if(!ZTOK){copyIt(w,b);return}
var ac=window.AbortController?new AbortController():null,to=setTimeout(function(){if(ac)ac.abort()},800);
try{fetch('/zeus/next',{method:'POST',headers:{'Content-Type':'application/json','X-Looot-Zeus-Token':ZTOK},body:JSON.stringify({section:'workflows',workflow:w.id}),signal:ac?ac.signal:undefined}).then(function(r){clearTimeout(to);
if(r.status===200){done(b,'Sent to your agent');if(window.zSay)zSay('Request added. Your agent will ask you to approve it (Claude Code, Cursor, Codex or any agent reading AGENTS.md).')}else copyIt(w,b)},function(){clearTimeout(to);copyIt(w,b)})}catch(e){clearTimeout(to);copyIt(w,b)}}
var BY={};ALL.forEach(function(w){BY[w.id]=w});
panel.addEventListener('click',function(e){if(e.target.closest('.zwf-back')){st.cat=-1;paint();if(V.getBoundingClientRect().top<0)V.scrollIntoView({block:'start',behavior:'auto'});return}
var m=e.target.closest('.zwf-more-b');if(m){if(st.q){st.shown+=40;paintSearch()}else{st.rest+=30;paintCat()}return}
var b=e.target.closest('.zwf-run[data-wf]');if(!b)return;e.preventDefault();var w=BY[b.getAttribute('data-wf')];if(w)run(w,b)});
paint();
}
})();
