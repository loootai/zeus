(function(){var W=document.querySelectorAll('.zmas-wrap');if(!W.length)return;
var RM=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
function alphaOk(){var ua=navigator.userAgent||'',v=document.createElement('video');if(!v.canPlayType||!v.canPlayType('video/webm; codecs="vp9"'))return false;
if(/iP(hone|ad|od)/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1))return false;
if(/Safari\//.test(ua)&&!/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Firefox)\//.test(ua))return false;return true}
var VID=!RM&&alphaOk(),REL=1850;
[].forEach.call(W,function(w){var box=w.parentNode,iso=box.querySelector('.iso')||box,fx=w.querySelector('.zmas-fx'),st=w.querySelectorAll('.zmas-st'),hit=w.querySelector('.zmas-hit'),z=w.querySelector('.zmas'),fig=w.querySelector('.zmas-fig'),
idle=w.querySelector('.zmas-idle'),thr=w.querySelector('.zmas-throw'),t=null,busy=false,vid=false,tz=null;
if(RM)return;
function css(){if(w.classList.contains('zmas-css'))return;vid=false;w.classList.remove('zmas-vid','zmas-thr');w.classList.add('zmas-css');[idle,thr].forEach(function(v){if(v){try{v.pause()}catch(x){}v.removeAttribute('src');v.load&&v.load()}})}
function aim(){var b=w.getBoundingClientRect(),r=iso.getBoundingClientRect(),q=z.getBoundingClientRect();if(!r.width||!q.width)return false;
var x0=q.left-b.left+q.width*.2,y0=q.top-b.top+q.height*.8,x1=r.left-b.left+r.width*(.42+Math.random()*.16),y1=r.top-b.top+Math.min(r.height*.42,innerHeight*.5),dx=x1-x0,dy=y1-y0,L=Math.sqrt(dx*dx+dy*dy)||1,nx=-dy/L,ny=dx/L,n=6,d='M'+x0.toFixed(1)+' '+y0.toFixed(1);
for(var i=1;i<n;i++){var k=i/n,o=(i%2?1:-1)*L*(.03+Math.random()*.03);d+=' L'+(x0+dx*k+nx*o).toFixed(1)+' '+(y0+dy*k+ny*o).toFixed(1)}
d+=' L'+x1.toFixed(1)+' '+y1.toFixed(1);fx.setAttribute('viewBox','0 0 '+b.width.toFixed(0)+' '+b.height.toFixed(0));
for(var j=0;j<st.length;j++)st[j].setAttribute('d',d);hit.setAttribute('cx',x1.toFixed(1));hit.setAttribute('cy',y1.toFixed(1));return true}
function zap(){if(document.hidden||!aim())return;w.classList.remove('zap');void w.offsetWidth;w.classList.add('zap');setTimeout(function(){w.classList.remove('zap')},950)}
function done(){busy=false;w.classList.remove('zmas-thr','go');plan()}
function go(){if(busy||document.hidden)return;busy=true;clearTimeout(t);
if(vid){thr.currentTime=0;var p=thr.play();if(p&&p.catch)p.catch(function(){css();done()});return}
w.classList.remove('go');void w.offsetWidth;w.classList.add('go');tz=setTimeout(zap,380);setTimeout(done,950)}
function plan(){clearTimeout(t);if(document.hidden)return;t=setTimeout(go,4000+Math.random()*2000)}
if(VID&&idle&&thr){idle.addEventListener('playing',function(){if(!w.classList.contains('zmas-css')){vid=true;w.classList.add('zmas-vid')}});
thr.addEventListener('playing',function(){if(!vid)return;w.classList.add('zmas-thr');clearTimeout(tz);tz=setTimeout(zap,Math.max(0,REL-thr.currentTime*1000))});
thr.addEventListener('ended',done);
idle.addEventListener('error',css);thr.addEventListener('error',css);
idle.src=idle.getAttribute('data-src');thr.preload='auto';thr.src=thr.getAttribute('data-src');var p=idle.play();if(p&&p.catch)p.catch(css)}else css();
fig.addEventListener('mouseenter',go);
document.addEventListener('visibilitychange',function(){var h=document.hidden;w.classList.toggle('zmas-off',h);if(h){clearTimeout(t);clearTimeout(tz);if(vid){idle.pause();thr.pause();if(busy)done()}}else{if(vid)idle.play().catch(function(){});plan()}});
plan()})})();
