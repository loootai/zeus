(function(){var W=document.querySelectorAll('.zmas-wrap');if(!W.length)return;
var RM=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
[].forEach.call(W,function(w){var box=w.parentNode,iso=box.querySelector('.iso')||box,fx=w.querySelector('.zmas-fx'),st=w.querySelectorAll('.zmas-st'),hit=w.querySelector('.zmas-hit'),z=w.querySelector('.zmas'),fig=w.querySelector('.zmas-fig'),t=null,busy=false;
function aim(){var b=w.getBoundingClientRect(),r=iso.getBoundingClientRect(),q=z.getBoundingClientRect();if(!r.width||!q.width)return false;
var x0=q.left-b.left+q.width*.85,y0=q.top-b.top+q.height*.24,x1=r.left-b.left+r.width*(.42+Math.random()*.16),y1=r.top-b.top+Math.min(r.height*.42,innerHeight*.5),dx=x1-x0,dy=y1-y0,L=Math.sqrt(dx*dx+dy*dy)||1,nx=-dy/L,ny=dx/L,n=6,d='M'+x0.toFixed(1)+' '+y0.toFixed(1);
for(var i=1;i<n;i++){var k=i/n,o=(i%2?1:-1)*L*(.03+Math.random()*.03);d+=' L'+(x0+dx*k+nx*o).toFixed(1)+' '+(y0+dy*k+ny*o).toFixed(1)}
d+=' L'+x1.toFixed(1)+' '+y1.toFixed(1);fx.setAttribute('viewBox','0 0 '+b.width.toFixed(0)+' '+b.height.toFixed(0));
for(var j=0;j<st.length;j++)st[j].setAttribute('d',d);hit.setAttribute('cx',x1.toFixed(1));hit.setAttribute('cy',y1.toFixed(1));return true}
function go(){if(busy||RM||document.hidden||!aim())return;busy=true;w.classList.remove('go');void w.offsetWidth;w.classList.add('go');setTimeout(function(){w.classList.remove('go');busy=false},1250)}
function plan(){clearTimeout(t);if(RM||document.hidden)return;t=setTimeout(function(){go();plan()},4000+Math.random()*2000)}
fig.addEventListener('mouseenter',go);
document.addEventListener('visibilitychange',function(){w.classList.toggle('zmas-off',document.hidden);if(document.hidden)clearTimeout(t);else plan()});
plan()})})();
