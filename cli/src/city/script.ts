// The city page's script, inline in the page. David's router, tooltips and city animation
// (shell/zeus.js, extracted by build/extract_city_shell.py), then copy and share buttons. No network.
import { readFileSync } from "node:fs";

const DAVID_JS = readFileSync(new URL("./shell/zeus.js", import.meta.url), "utf8");

const ZG_JS = `
(function(){var ps=document.querySelectorAll('.zpow');for(var i=0;i<ps.length;i++){if(i===0)document.body.appendChild(ps[i]);else ps[i].remove()}})();
(function(){var bd=document.createElement('div');bd.className='zcm';bd.hidden=true;bd.innerHTML='<div class="zcmc" role="status" aria-live="polite"><svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#0A7A4B"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="zcmt">Prompt copied</div><div class="zcml"></div></div>';document.body.appendChild(bd);var tm=null;
function hide(){bd.classList.remove('on');clearTimeout(tm);setTimeout(function(){if(!bd.classList.contains('on'))bd.hidden=true},220)}
window.zCopied=function(line){bd.querySelector('.zcml').textContent=line||'Paste it into your agent (Claude Code, Cursor, ChatGPT) to keep going.';bd.hidden=false;void bd.offsetWidth;bd.classList.add('on');clearTimeout(tm);tm=setTimeout(hide,3500)};
bd.addEventListener('click',hide);document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!bd.hidden)hide()});})();
(function(){
var toast=document.createElement('div');toast.className='ztoast';toast.setAttribute('role','status');document.body.appendChild(toast);var tt=null;
function say(m){toast.textContent=m;toast.classList.add('on');clearTimeout(tt);tt=setTimeout(function(){toast.classList.remove('on')},1800)}
document.addEventListener('click',function(e){var t=e.target;if(!t.closest)return;
var sh=t.closest('.zshare');if(sh){var u=location.protocol==='https:'||location.protocol==='http:'?location.href.split('#')[0]:'';if(!u){say('Share works on the hosted page');return}
if(navigator.share){navigator.share({title:document.title,url:u}).catch(function(){})}else if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(u).then(function(){say('Link copied')},function(){say(u)})}else say(u);return}
var c=t.closest('.cp');if(c){var txt=c.getAttribute('data-copy')||'';var lbl=c.querySelector('.mt')||c;var done=function(){var o=lbl.textContent;lbl.textContent='Copied';zCopied();setTimeout(function(){lbl.textContent=o},1400)};
if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(txt).then(done,done);else{var a=document.createElement('textarea');a.value=txt;document.body.appendChild(a);a.select();try{document.execCommand('copy')}catch(x){}a.remove();done()}}});
})();
`;

/** David's page script plus copy and share. */
export const CITY_JS = DAVID_JS + ZG_JS;
