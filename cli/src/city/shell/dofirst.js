(function(){var D=document.querySelector('.zdf');if(!D)return;var K='zeus.doFirstDone';
try{if(localStorage.getItem(K)==='1'){D.remove();return}}catch(e){}
var bar=document.querySelector('.obar'),pill=bar&&bar.querySelector('.tryl'),cp=bar&&bar.querySelector('[data-copy]'),fig=document.querySelector('.zmas');
if(!bar||!pill){D.remove();return}
var RM=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches),svg=D.querySelector('.zdf-a'),p=D.querySelector('.zdf-p'),h=D.querySelector('.zdf-h'),b=D.querySelector('.zdf-b'),ring=D.querySelector('.zdf-r'),last=Date.now(),timer=null,stopped=false;
function f(n){return n.toFixed(1)}
function place(){if(stopped)return false;var small=innerWidth<720||!fig;
if(small){if(!D.classList.contains('zdf-m')){D.classList.add('zdf-m');var at=cp||pill;at.parentNode.insertBefore(D,at.nextSibling)}return true}
if(D.classList.contains('zdf-m')){D.classList.remove('zdf-m')}
var o=D.offsetParent;if(!o)return false;var R=o.getBoundingClientRect(),z=fig.getBoundingClientRect(),q=pill.getBoundingClientRect(),c=(cp||pill).getBoundingClientRect();
if(!z.width||!q.width)return false;
var bw=b.offsetWidth,bh=b.offsetHeight,bx=z.left-R.left-bw-12,by=z.top-R.top+z.height*.16;
b.style.left=f(bx)+'px';b.style.top=f(by)+'px';
var sx=bx-6,sy=by+bh*.55,tx=c.right-R.left+12,ty=c.top-R.top+c.height*.62;
var dx=sx-tx,c1x=sx-dx*.35,c1y=sy+Math.min(70,Math.abs(sy-ty)+40),c2x=tx+dx*.22,c2y=ty+46;
p.setAttribute('d','M'+f(sx)+' '+f(sy)+' C'+f(c1x)+' '+f(c1y)+' '+f(c2x)+' '+f(c2y)+' '+f(tx)+' '+f(ty));
var ang=Math.atan2(ty-c2y,tx-c2x),L=12,a1=ang+2.6,a2=ang-2.6;
h.setAttribute('d','M'+f(tx+L*Math.cos(a1))+' '+f(ty+L*Math.sin(a1))+' L'+f(tx)+' '+f(ty)+' L'+f(tx+L*Math.cos(a2))+' '+f(ty+L*Math.sin(a2)));
ring.style.left=f(q.left-R.left)+'px';ring.style.top=f(q.top-R.top)+'px';ring.style.width=f(q.width)+'px';ring.style.height=f(q.height)+'px';
svg.setAttribute('width','1');svg.setAttribute('height','1');return true}
function play(){if(stopped||document.hidden||!place())return;D.classList.add('on');if(RM)return;D.classList.remove('go');void D.offsetWidth;D.classList.add('go')}
function stop(){stopped=true;clearInterval(timer);try{localStorage.setItem(K,'1')}catch(e){}D.classList.remove('on','go');setTimeout(function(){D.remove()},400)}
if(cp)cp.addEventListener('click',stop);
['pointermove','keydown','scroll','touchstart'].forEach(function(t){addEventListener(t,function(){last=Date.now()},{passive:true})});
addEventListener('resize',function(){if(D.classList.contains('on'))place()});
addEventListener('hashchange',function(){setTimeout(function(){if(D.classList.contains('on'))place()},0)});
setTimeout(play,1000);
if(!RM)timer=setInterval(function(){if(Date.now()-last>5000)play()},12000);
})();
