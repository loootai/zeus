// Motion on the city page, private and shared (looot.page): the city builds in district by district,
// callouts slide in and their numbers count up, light pulses run along the roads, a hovered building
// glows and lifts its callout, the "Your next plays" cards stagger in on scroll, the share header
// shimmers once. CSS and vanilla JS only, inline (looot-pages hashes each script into its CSP).
//
// Rules: nothing is hidden at rest. Every hidden start state needs a class a script set: `zm` on <html>
// (HEAD_JS, only when the viewer does not ask for reduced motion) or `zio` (MOTION_JS, once its observer
// runs). With no script, a failing script or reduced motion the page is complete and still. Only
// opacity, transform and stroke-dashoffset move, so nothing shifts the layout. The road pulses draw in
// their own small overlay SVG so the big city SVG is not repainted every frame.

/** Starts the city script: from here the view router owns which view shows. Without it every view is on the page. */
export const ROUTER_ON_JS = `document.documentElement.classList.add('zj');`;

/** Runs in <head>: marks the page for motion unless the viewer asks for reduced motion. */
export const HEAD_JS = `try{if(!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches))document.documentElement.classList.add('zm')}catch(e){}`;

export const MOTION_CSS = `
html:not(.zj) .view{display:block}html:not(.zj) .vbar i{transform:scaleX(var(--w))}
html:not(.zm) .iso .isd{opacity:1!important;transform:none!important}
@keyframes zshow{to{opacity:1;transform:none}}
.zm .iso .isd:not(.gnd):not(.lbl){transform:translateY(38px) scaleY(.55);transform-origin:50% 100%;transform-box:fill-box}
.zm .iso .isd.lbl{transform:translateY(12px)}
.zm .iso.in .isd:not(.gnd):not(.lbl),.zm .iso.in .isd.lbl{transform:none}
.zm .iso:not(.in) .isd{animation:zshow 0s 3.5s forwards}
.zrpl{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;will-change:transform}
.zrp{fill:none;stroke:#8BD6F7;stroke-width:3.5;stroke-linecap:round;stroke-dasharray:5 95;stroke-dashoffset:100;opacity:.95;animation:zroad 3.2s linear infinite}
.zrp.h{stroke:#55C2F2;stroke-width:10;opacity:.28}
@keyframes zroad{to{stroke-dashoffset:0}}
.isa .isb{transition:transform .25s,filter .25s}
.isa:hover .isb,.isa.zhot .isb{filter:brightness(1.22) drop-shadow(0 0 9px rgba(85,194,242,.75))}
.isl{transition:transform .25s cubic-bezier(.2,.8,.2,1);transform-box:fill-box}
.isl.zlift{transform:translateY(-8px)}
.isl.zlift rect{stroke:#55C2F2}
.zio .zrv{transition:opacity .5s ease-out,transform .6s cubic-bezier(.2,.8,.2,1)}
.zio .zrv:not(.zin){opacity:0;transform:translateY(18px)}
.zm .zsh{position:relative;overflow:hidden;isolation:isolate}
.zm .zsh::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(105deg,transparent 30%,rgba(215,255,58,.55) 50%,transparent 70%);transform:translateX(-110%);animation:zshim 1.4s .6s cubic-bezier(.3,.6,.3,1) 1 forwards;pointer-events:none}
@keyframes zshim{to{transform:translateX(110%)}}
@media (prefers-reduced-motion:reduce){.zrpl{display:none}.zrp{animation:none}.isl,.isa .isb,.zio .zrv{transition:none}.isl.zlift{transform:none}.zio .zrv:not(.zin){opacity:1;transform:none}.zsh::after{display:none}}
`;

export const MOTION_JS = `
(function(){
var H=document.documentElement;if(!H.classList.contains('zm'))return;
var NS='http://www.w3.org/2000/svg';
function ease(t){return 1-Math.pow(1-t,3)}
var NUM=/^(\\D*?)(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?(\\D*)$/;
function countUp(els,ms){[].forEach.call(els,function(el){
  if(el.getAttribute('data-zc'))return;var txt=el.textContent,m=txt.match(NUM);if(!m)return;
  var dec=m[3]?m[3].length-1:0,to=parseFloat((m[2].replace(/,/g,''))+(m[3]||''));if(!(to>1))return;
  el.setAttribute('data-zc','1');var comma=m[2].indexOf(',')>=0,t0=performance.now();
  function f(v){var s=v.toFixed(dec);if(comma)s=s.replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');return m[1]+s+m[4]}
  (function tick(t){var u=Math.min(1,(t-t0)/ms);el.textContent=u<1?f(to*ease(u)):txt;if(u<1)requestAnimationFrame(tick)})(t0);
})}
var iso=document.querySelector('[data-iso]');
if(iso){
  var svg=iso.querySelector('svg'),roads=[];try{roads=JSON.parse(iso.getAttribute('data-roads'))||[]}catch(e){}
  var ov=null;
  function pulses(){if(ov||!svg)return;ov=document.createElementNS(NS,'svg');ov.setAttribute('class','zrpl');ov.setAttribute('aria-hidden','true');
    ov.setAttribute('viewBox',svg.getAttribute('viewBox'));ov.setAttribute('preserveAspectRatio',svg.getAttribute('preserveAspectRatio')||'xMidYMid meet');
    roads.forEach(function(r,k){['zrp h','zrp'].forEach(function(c){var l=document.createElementNS(NS,'line');l.setAttribute('x1',r[0]);l.setAttribute('y1',r[1]);l.setAttribute('x2',r[2]);l.setAttribute('y2',r[3]);l.setAttribute('pathLength','100');l.setAttribute('class',c);l.style.animationDelay=(-k*0.53)+'s';ov.appendChild(l)})});
    iso.insertBefore(ov,iso.querySelector('.iso-tip'));
    new MutationObserver(function(){ov.setAttribute('viewBox',svg.getAttribute('viewBox'))}).observe(svg,{attributes:true,attributeFilter:['viewBox']});
  }
  function built(){setTimeout(function(){countUp(iso.querySelectorAll('.isd.lbl text,.isl text'),1100);var ov2=iso.closest('.view');if(ov2)countUp(ov2.querySelectorAll('.kval'),1100)},1500);setTimeout(pulses,1300)}
  new MutationObserver(function(){if(iso.classList.contains('in'))built()}).observe(iso,{attributes:true,attributeFilter:['class']});
  if(iso.classList.contains('in'))built();
  var lifted=null;
  function lift(a){if(lifted){lifted.classList.remove('zlift');lifted=null}if(!a)return;var h=a.getAttribute('href');if(!h)return;
    var c=iso.querySelector('.isl[href="'+h.replace(/["\\\\]/g,'')+'"]');if(c){c.classList.add('zlift');lifted=c}}
  iso.addEventListener('mouseover',function(e){lift(e.target.closest&&e.target.closest('.isa'))});
  iso.addEventListener('mouseleave',function(){lift(null)});
  iso.addEventListener('focusin',function(e){var a=e.target.closest&&e.target.closest('.isa');if(a)lift(a)});
}
if('IntersectionObserver' in window){
  var cards=document.querySelectorAll('.view[data-view="plays"] .zg-card');if(cards.length){[].forEach.call(cards,function(c){c.classList.add('zrv')});H.classList.add('zio');var q=0,qt=null;
  var io=new IntersectionObserver(function(es){es.forEach(function(x){if(!x.isIntersecting)return;io.unobserve(x.target);x.target.style.transitionDelay=(q++*80)+'ms';x.target.classList.add('zin')});clearTimeout(qt);qt=setTimeout(function(){q=0},120)},{rootMargin:'0px 0px -8% 0px'});
  [].forEach.call(cards,function(c){io.observe(c)});}
}
})();
`;
