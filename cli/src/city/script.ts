// The city page's script, inline in the page. David's router, tooltips and city animation
// (shell/zeus.js, extracted by build/extract_city_shell.py), then copy and share buttons. No network.
import { readFileSync } from "node:fs";
import { MOTION_JS, ROUTER_ON_JS } from "./motion.js";

const DAVID_JS = readFileSync(new URL("./shell/zeus.js", import.meta.url), "utf8");
// The centered "Prompt copied" card with the agent and CRM logos, shared with build/make_hf.py.
const TOAST_JS = readFileSync(new URL("./shell/toast.js", import.meta.url), "utf8");
// The Zeus mascot's throw loop, shared with build/mascot.py.
const MASCOT_JS = readFileSync(new URL("./shell/mascot.js", import.meta.url), "utf8");

const ZG_JS = `
(function(){var ps=document.querySelectorAll('.zpow');for(var i=0;i<ps.length;i++){if(i===0)document.body.appendChild(ps[i]);else ps[i].remove()}})();
(function(){
var toast=document.createElement('div');toast.className='ztoast';toast.setAttribute('role','status');document.body.appendChild(toast);var tt=null;
function say(m){toast.textContent=m;toast.classList.add('on');clearTimeout(tt);tt=setTimeout(function(){toast.classList.remove('on')},1800)}
document.addEventListener('click',function(e){var t=e.target;if(!t.closest)return;
var sh=t.closest('.zshare');if(sh){var u=location.protocol==='https:'||location.protocol==='http:'?location.href.split('#')[0]:'';if(!u){say('Share works on the hosted page');return}
if(navigator.share){navigator.share({title:document.title,url:u}).catch(function(){})}else if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(u).then(function(){say('Link copied')},function(){say(u)})}else say(u);return}
var c=t.closest('.cp');if(c){var txt=c.getAttribute('data-copy')||'';var lbl=c.querySelector('.mt')||c;var done=function(){var o=lbl.textContent;lbl.textContent='Copied';zCopied(null,c.getAttribute('data-key'));setTimeout(function(){lbl.textContent=o},1400)};
if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(txt).then(done,done);else{var a=document.createElement('textarea');a.value=txt;document.body.appendChild(a);a.select();try{document.execCommand('copy')}catch(x){}a.remove();done()}}});
})();
`;

/** David's page script plus copy and share. */
export const CITY_JS = ROUTER_ON_JS + TOAST_JS + DAVID_JS + ZG_JS + MASCOT_JS + MOTION_JS;
export { HEAD_JS } from "./motion.js";
