(function(){
  var views=[].slice.call(document.querySelectorAll('.view'));
  var links=[].slice.call(document.querySelectorAll('.nav a'));
  var crumb=document.getElementById('vtitle'),grp=document.getElementById('vgroup');
  function show(k){
    var v=document.querySelector('.view[data-view="'+k+'"]'),anc=null;
    if(!v){anc=document.getElementById(k);if(anc){v=anc.closest('.view');}}
    if(!v){k='overview';v=document.querySelector('.view[data-view="overview"]');}
    views.forEach(function(x){x.classList.toggle('act',x===v)});
    links.forEach(function(a){
      var on=a.getAttribute('href')==='#'+k||(anc&&a.getAttribute('href')==='#'+anc.id);
      a.classList.toggle('on',on);
      if(on)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
    });
    var ag=document.querySelector('.nav a.on');if(ag){var gg=ag.closest('.ngroup.dd');if(gg)setG(gg,true,false);}
    if(crumb)crumb.textContent=v.getAttribute('data-title');
    if(grp)grp.textContent=v.getAttribute('data-group')||'';
    hideTip();
    document.body.classList.remove('navopen');
    if(anc){setTimeout(function(){anc.scrollIntoView({block:'start'});window.scrollBy(0,-80);},0);}else window.scrollTo(0,0);
  }
  var GK='zeusNavOpen',gst={};try{gst=JSON.parse(localStorage.getItem(GK)||'{}')||{}}catch(e){gst={}}
  function setG(g,open,save){g.classList.toggle('open',open);var b=g.querySelector('.ngt');if(b)b.setAttribute('aria-expanded',String(open));if(save){gst[g.dataset.g]=open;try{localStorage.setItem(GK,JSON.stringify(gst))}catch(e){}}}
  [].slice.call(document.querySelectorAll('.ngroup.dd')).forEach(function(g){if(gst[g.dataset.g]===true)setG(g,true,false);var b=g.querySelector('.ngt');if(b)b.addEventListener('click',function(){setG(g,!g.classList.contains('open'),true)});});
  var tip=document.createElement('div');tip.className='xtip';tip.id='xtip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.appendChild(tip);
  var tipFor=null;
  document.querySelectorAll('[data-tip]').forEach(function(el){
    if(!el.matches('a[href],button,summary,input,select,textarea')&&!el.hasAttribute('tabindex'))el.setAttribute('tabindex','0');
  });
  function showTip(el){
    var t=el.getAttribute('data-tip');if(!t)return;
    tipFor=el;tip.textContent=t;tip.hidden=false;el.setAttribute('aria-describedby','xtip');
    var r=el.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight,vw=document.documentElement.clientWidth,vh=window.innerHeight;
    var x=Math.min(Math.max(8,r.left+Math.min(24,r.width/2)-12),vw-w-8),y=r.bottom+8;
    if(y+h>vh-8)y=Math.max(8,r.top-h-8);
    tip.style.left=x+'px';tip.style.top=y+'px';
  }
  function hideTip(){if(tipFor)tipFor.removeAttribute('aria-describedby');tipFor=null;tip.hidden=true;}
  document.addEventListener('mouseover',function(e){var el=e.target.closest&&e.target.closest('[data-tip]');if(el&&el!==tipFor)showTip(el);else if(!el&&tipFor)hideTip();});
  document.addEventListener('focusin',function(e){var el=e.target.closest&&e.target.closest('[data-tip]');if(el)showTip(el);else hideTip();});
  document.addEventListener('focusout',function(){hideTip();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')hideTip();});
  window.addEventListener('scroll',function(){if(tipFor)showTip(tipFor);},{passive:true});
  function fromHash(){show((location.hash||'#overview').slice(1))}
  window.addEventListener('hashchange',fromHash);
  fromHash();
  var menu=document.querySelector('.top .menu'),scrim=document.querySelector('.scrim');
  if(menu)menu.addEventListener('click',function(){document.body.classList.toggle('navopen')});
  if(scrim)scrim.addEventListener('click',function(){document.body.classList.remove('navopen')});
  document.querySelectorAll('.seg').forEach(function(sg){
    var btns=sg.querySelectorAll('button');
    btns.forEach(function(b){b.addEventListener('click',function(){
      btns.forEach(function(x){
        var on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-selected',String(on));
        var p=document.getElementById(x.dataset.tab);if(p)p.classList.toggle('on',on);
      });
    })});
  });
  var pl='all',rv='all';
  function filt(){
    var n=0;
    document.querySelectorAll('#wall .ad').forEach(function(a){
      a.hidden=!((pl==='all'||a.dataset.plat===pl)&&(rv==='all'||a.dataset.rival===rv));
      if(!a.hidden)n++;
    });
    var em=document.getElementById('wallempty');if(em)em.hidden=n>0;
  }
  function group(sel,cb){
    document.querySelectorAll(sel).forEach(function(b){b.addEventListener('click',function(){
      document.querySelectorAll(sel).forEach(function(x){x.classList.toggle('on',x===b)});cb(b);
    })});
  }
  var pc=document.getElementById('pcopy'),praw=document.getElementById('praw'),ptext=document.getElementById('ptext');
  if(pc&&praw){
    var plbl=pc.querySelector('span'),pt=null;
    function pdone(t,ok){plbl.textContent=t;pc.classList.toggle('ok',!!ok);clearTimeout(pt);pt=setTimeout(function(){plbl.textContent='Copy prompt';pc.classList.remove('ok')},1800)}
    function pselect(){
      try{var r=document.createRange();r.selectNodeContents(ptext);var s=window.getSelection();s.removeAllRanges();s.addRange(r);pdone('Selected, press Cmd C')}catch(e){pdone('Select the text to copy')}
    }
    function plegacy(txt){
      var ta=document.createElement('textarea');ta.value=txt;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.top='-1000px';ta.style.opacity='0';
      document.body.appendChild(ta);ta.select();var ok=false;try{ok=document.execCommand('copy')}catch(e){ok=false}
      document.body.removeChild(ta);if(ok)pdone('Copied',true);else pselect();
    }
    pc.addEventListener('click',function(){
      var txt=praw.value;
      if(navigator.clipboard&&window.isSecureContext!==false){
        navigator.clipboard.writeText(txt).then(function(){pdone('Copied',true)},function(){plegacy(txt)});
      }else plegacy(txt);
    });
  }
  group('[data-ncat]',function(b){
    var c=b.dataset.ncat;
    document.querySelectorAll('#nwall .ncard').forEach(function(a){a.hidden=!(c==='all'||a.dataset.cat===c)});
  });
  group('[data-pl]',function(b){pl=b.dataset.pl;filt()});
  group('[data-rv]',function(b){rv=b.dataset.rv;filt()});
  group('[data-acc]',function(b){
    var s=b.dataset.acc;
    document.querySelectorAll('.card.acc').forEach(function(a){a.hidden=!(s==='all'||a.dataset.seg===s)});
  });
})();

(function(){
  var RM=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  [].slice.call(document.querySelectorAll('.rrun')).forEach(function(r){
    var steps=[].slice.call(r.querySelectorAll('.rstep')),meter=r.querySelector('.rmeter b'),go=r.querySelector('.rgo'),rp=r.querySelector('.rreplay'),i=0;
    function paint(){steps.forEach(function(s,k){s.classList.toggle('on',k<i)});r.setAttribute('data-step',String(i));
      var m=i>0?steps[i-1].getAttribute('data-meter'):r.getAttribute('data-meter0');
      if(meter)meter.textContent=m!==null?m:'USD '+(i>0?steps[i-1].getAttribute('data-cost'):'0.000');
      if(go)go.textContent=i===0?go.getAttribute('data-l'):(i===1?(r.getAttribute('data-l1')||'Give the go'):(i<steps.length?'Next step':(r.getAttribute('data-done')||'Run complete')));}
    function reset(){if(RM){i=steps.length;r.classList.remove('armed');paint();return;}i=0;r.classList.add('armed');paint();}
    function next(){if(i<steps.length){i++;paint();var s=steps[i-1];if(s&&i>1)s.scrollIntoView({block:'nearest',behavior:RM?'auto':'smooth'});}}
    if(go)go.setAttribute('data-l',go.textContent);
    if(go)go.addEventListener('click',function(e){e.stopPropagation();next()});
    if(rp)rp.addEventListener('click',function(e){e.stopPropagation();reset()});
    r.addEventListener('click',function(e){if(e.target.closest('a,button'))return;if(r.classList.contains('armed'))next()});
    r.addEventListener('keydown',function(e){if(e.key===' '&&!e.target.closest('a,button')){e.preventDefault();next()}});
    reset();
  });
})();
(function(){
var iso=document.querySelector('[data-iso]');if(!iso)return;
var RM=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var svg=iso.querySelector('svg'),tip=iso.querySelector('.iso-tip'),ti={hidden:true,src:'',classList:{toggle:function(){}}},tb=tip.querySelector('b'),ts=tip.querySelector('span');
function show(a,x,y){
  tb.textContent=a.getAttribute('data-t')||'';ts.textContent=a.getAttribute('data-s')||'';
  var im=a.getAttribute('data-img');if(im){ti.src=im;ti.hidden=false;ti.classList.toggle('big',/\/ads\//.test(im));}else{ti.hidden=true;}
  tip.hidden=false;var r=iso.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;
  var px=Math.min(Math.max(8,x-r.left+16),r.width-w-8),py=y-r.top-h-16;if(py<8)py=y-r.top+20;
  tip.style.transform='translate('+px+'px,'+py+'px)';tip.classList.add('on');
}
function hide(){tip.classList.remove('on');}
iso.addEventListener('mousemove',function(e){var a=e.target.closest('.isa');if(a)show(a,e.clientX,e.clientY);else hide();});
iso.addEventListener('mouseleave',hide);
iso.addEventListener('focusin',function(e){var a=e.target.closest('.isa');if(!a)return;var b=a.getBoundingClientRect();show(a,b.left+b.width/2,b.top);});
iso.addEventListener('focusout',hide);
var VB0=svg.getAttribute('viewBox'),mq=window.matchMedia('(max-width: 760px)');function fit(){svg.setAttribute('viewBox',mq.matches?'40 196 1020 560':VB0);}if(mq.addEventListener)mq.addEventListener('change',fit);fit();
var roads=[];try{roads=JSON.parse(iso.getAttribute('data-roads'))||[];}catch(e){}
var pk=svg.querySelector('.ispk'),NS='http://www.w3.org/2000/svg',ps=[];
function packets(){
  if(RM||ps.length)return;
  roads.forEach(function(r,k){for(var n=0;n<2;n++){var g=document.createElementNS(NS,'polygon');g.setAttribute('points','0,-4 7,0 0,4 -7,0');g.setAttribute('class','pk');pk.appendChild(g);ps.push({g:g,r:r,o:(k*.17+n*.5)%1,out:n===0});}});
  var t0=performance.now();
  (function tick(t){
    var s=(t-t0)/4200;
    ps.forEach(function(p){var u=(s+p.o)%1;if(!p.out)u=1-u;var x=p.r[0]+(p.r[2]-p.r[0])*u,y=p.r[1]+(p.r[3]-p.r[1])*u;p.g.setAttribute('transform','translate('+x.toFixed(1)+' '+y.toFixed(1)+')');p.g.style.opacity=Math.min(1,Math.min(u,1-u)*6);});
    if(document.body.contains(iso))requestAnimationFrame(tick);
  })(t0);
}
function play(){
  if(RM){iso.classList.add('in');return;}
  iso.classList.remove('in');void iso.offsetWidth;
  requestAnimationFrame(function(){iso.classList.add('in');});
  setTimeout(packets,1400);
}
function onView(){var v=iso.closest('.view');if(v&&v.classList.contains('act'))setTimeout(play,40);}
window.addEventListener('hashchange',onView);setTimeout(onView,120);
})();
