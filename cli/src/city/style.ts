/** The city page's CSS, inline in the page. Light, system fonts, an isometric overview map. */
export const CITY_CSS = `
:root{--ink:#17181B;--ink2:#383E47;--muted:#6B7280;--line:#E4E7EC;--bg:#F6F7F9;--card:#fff;--acc:#1E6FD9;--warm:#F2A65A;--green:#1E8E5A;--red:#C0392B;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
.side{position:fixed;inset:0 auto 0 0;width:248px;background:var(--card);border-right:1px solid var(--line);overflow:auto;padding:16px 0}
.brand{font-weight:700;font-size:17px;padding:4px 16px 12px}
.brand small{display:block;font-weight:500;font-size:12.5px;color:var(--muted)}
.nav a{display:flex;align-items:center;gap:8px;padding:8px 16px;color:var(--ink2);text-decoration:none;font-size:14.5px}
.nav a:hover{background:#F1F2F4}.nav a.on{background:#EAF2FD;color:var(--acc);font-weight:600}
.zgh{font-size:12px;font-weight:600;color:var(--muted);padding:12px 16px 2px;text-transform:none}
main{margin-left:248px;padding:32px;max-width:1180px}
.view{display:none}.view.on{display:block}
.kicker{font-size:12.5px;font-weight:600;color:var(--muted)}
h1{font-size:28px;margin:2px 0 16px}h3{font-size:17px;margin:24px 0 8px}
.sec{margin-bottom:28px}
.src{font-size:12.5px;color:var(--muted);margin:0 0 8px}
.chip{display:inline-block;font-size:12.5px;padding:2px 10px;border-radius:99px;border:1px solid var(--line);background:#fff;color:var(--ink2);margin-right:6px}
.chip.go{background:#E8F5EE;color:var(--green);border-color:#BFE3D0}.chip.warm{background:#FFF3E6;color:#B5651D;border-color:#F6D5AF}.chip.cold{background:#FBEAE8;color:var(--red);border-color:#F2C6C1}
.note{border-left:3px solid var(--warm);background:#FFF9F2;padding:8px 12px;border-radius:6px;margin:8px 0}
.empty{border:1px dashed var(--line);border-radius:12px;padding:20px;color:var(--muted);background:var(--card)}
.empty b{display:block;color:var(--ink);margin-bottom:2px}
table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:14px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12.5px;color:var(--muted);font-weight:600;background:#FAFBFC}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.cap-h{font-weight:600;margin:16px 0 6px}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin:8px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}.stat b{display:block;font-size:22px}.stat span{font-size:12.5px;color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:6px}
.card h4{margin:0;font-size:15.5px}.card p{margin:0;color:var(--ink2);font-size:14px}.card .sub{font-size:12.5px;color:var(--muted)}
.card dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:13.5px}.card dt{color:var(--muted)}.card dd{margin:0}
.tile{width:36px;height:36px;border-radius:9px;background:var(--acc);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex:none}
.card-h{display:flex;gap:10px;align-items:center}
.meter{height:8px;border-radius:99px;background:#EDEFF3;overflow:hidden;display:block}.meter i{display:block;height:100%;background:var(--green)}.meter i.warm{background:var(--warm)}.meter i.cold{background:var(--red)}
.brow{display:grid;grid-template-columns:minmax(120px,220px) 1fr 70px;gap:12px;align-items:center;margin:6px 0;font-size:14px}.bv{text-align:right;font-variant-numeric:tabular-nums}
.ccs{display:flex;flex-direction:column;gap:14px}
.cc{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.cc-h{display:flex;gap:12px;align-items:center;justify-content:space-between}.cc-h h4{margin:0}
.mems{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-direction:column;gap:8px}
.mem{border-top:1px solid var(--line);padding-top:8px;font-size:14px}.mem .t{color:var(--muted)}
.mem .acts{display:flex;gap:12px;flex-wrap:wrap;color:var(--ink2);font-size:13.5px}
code,.cmd{font-family:var(--mono);background:#17181B;color:#fff;padding:4px 8px;border-radius:6px;font-size:13.5px}
button.cp{font:inherit;font-size:12.5px;border:1px solid var(--line);background:#fff;border-radius:6px;padding:2px 8px;cursor:pointer}
.zacts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0 16px}.zacts .za{font:inherit;font-size:14px;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;text-decoration:none}.zacts .za:hover{border-color:var(--ink)}.zpow{font-size:13px;color:var(--ink2);margin-left:auto;text-decoration:none}.zpow:hover{text-decoration:underline}
.ztoast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1C1D1F;color:#F3F4F6;font-size:14px;padding:10px 16px;border-radius:8px;opacity:0;transition:opacity .2s;pointer-events:none}.ztoast.on{opacity:1}
.menu{display:none}
.isowrap{height:420px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:linear-gradient(#EEF3FA,#F6F7F9);border:1px solid var(--line);border-radius:16px;margin-bottom:16px}
.iso{display:grid;grid-template-columns:repeat(4,110px);gap:18px;transform:rotateX(58deg) rotateZ(-45deg);transform-style:preserve-3d}
.isa{display:block;position:relative;height:110px;text-decoration:none;color:#fff;transform-style:preserve-3d;transition:transform .18s}
.isa:hover,.isa:focus-visible{transform:translateZ(14px)}
.isb{position:absolute;inset:0;border-radius:10px;background:var(--c,#1E6FD9);box-shadow:6px 6px 0 rgba(23,24,27,.22)}
.isl{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;transform:rotateZ(45deg) rotateX(-58deg) scale(1.1);font-size:12px;font-weight:600;line-height:1.2}
.isl b{font-size:22px}
.legend{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.legend a{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;text-decoration:none;color:var(--ink)}
.legend a:hover{border-color:var(--ink)}.legend small{display:block;color:var(--muted)}
.run{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:8px 0 16px;color:var(--muted)}
@media (max-width:860px){.side{transform:translateX(-100%);z-index:20;transition:transform .2s}.side.open{transform:none}main{margin-left:0;padding:16px}.menu{display:inline-block;margin-bottom:12px}.iso{grid-template-columns:repeat(4,70px)}.isa{height:70px}.isl{font-size:9px}.isl b{font-size:15px}}
@media print{.side,.menu{display:none}main{margin:0}.view{display:block}}
@media (prefers-reduced-motion:reduce){.isa{transition:none}}
`;
