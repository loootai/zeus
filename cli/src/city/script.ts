/** The city page's script, inline in the page. Hash routing, copy buttons. No network. */
export const CITY_JS = `
(function(){
var views=[].slice.call(document.querySelectorAll('.view'));
var toast=document.createElement('div');toast.className='ztoast';toast.setAttribute('role','status');document.body.appendChild(toast);var tt=null;
function say(m){toast.textContent=m;toast.classList.add('on');clearTimeout(tt);tt=setTimeout(function(){toast.classList.remove('on')},1800)}
function show(){var k=(location.hash||'#overview').slice(1);var v=null;views.forEach(function(x){if(x.getAttribute('data-view')===k)v=x});if(!v){k='overview';v=views[0]}
views.forEach(function(x){x.classList.toggle('on',x===v)});
[].forEach.call(document.querySelectorAll('.nav a'),function(a){a.classList.toggle('on',a.getAttribute('href')==='#'+k)});
document.getElementById('side').classList.remove('open');window.scrollTo(0,0)}
window.addEventListener('hashchange',show);show();
document.addEventListener('click',function(e){var t=e.target;if(!t.closest)return;
var m=t.closest('.menu');if(m){document.getElementById('side').classList.toggle('open');return}
var c=t.closest('button.cp');if(c){var txt=c.getAttribute('data-copy')||'';var done=function(){var o=c.textContent;c.textContent='Copied';setTimeout(function(){c.textContent=o},1400)};
if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(txt).then(done,done);else{var a=document.createElement('textarea');a.value=txt;document.body.appendChild(a);a.select();try{document.execCommand('copy')}catch(x){}a.remove();done()}}});
})();
`;
