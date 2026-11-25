// The city page's CSS: David's Higgsfield city styles (shell/zeus.css, extracted by
// build/extract_city_shell.py) plus the few classes the generated blocks add (zg-*). No fonts are
// loaded: the page works from disk, so David's fonts fall back to the system stack.
import { readFileSync } from "node:fs";

const DAVID_CSS = readFileSync(new URL("./shell/zeus.css", import.meta.url), "utf8");

const ZG_CSS = `
.view{display:none}.view.act{display:block}
.logo .lgt{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#D7FF3A;color:#111;font-weight:800;font-size:15px;font-family:var(--disp,inherit)}
.zg-cap{font-size:13px;font-weight:600;color:var(--ink2);margin:16px 0 8px}
.zg-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.zg-card{display:flex;flex-direction:column;gap:6px}.zg-card h4{margin:0;font-size:14.5px}.zg-card p{margin:0;color:var(--ink2);font-size:13.5px}
.zg-card-h{display:flex;align-items:flex-start;gap:10px}.zg-tag{margin-left:auto}
.zg-tile{display:grid;place-items:center;flex:none;width:30px;height:30px;border-radius:8px;background:#EDEFF3;font-weight:700;color:var(--ink2)}
.zg-sub{font-size:12.5px;color:var(--muted)}
.zg-card dl,.zg-kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:4px 0;font-size:13px}.zg-card dt,.zg-kv dt{color:var(--muted)}.zg-card dd,.zg-kv dd{margin:0}
.zg-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin:8px 0 16px}
.zg-stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:12.5px;color:var(--muted)}.zg-stat b{display:block;font-size:22px;color:var(--ink)}
.zg-meter{display:block;height:6px;border-radius:99px;background:#EDEFF3;overflow:hidden;min-width:60px}.zg-meter i{display:block;height:100%;background:#1E8E5A}.zg-meter i.zg-warm{background:#F2A65A}.zg-meter i.zg-cold{background:#C0392B}
.zg-brow{display:grid;grid-template-columns:minmax(120px,240px) 1fr 80px;align-items:center;gap:12px;font-size:13.5px;margin:6px 0}.zg-bv{text-align:right;font-family:var(--mono)}
.chip.zg-go{background:#E8F5EE;color:#1E8E5A}.chip.zg-warm{background:#FFF3E6;color:#B5651D}.chip.zg-cold{background:#FBEAE8;color:#C0392B}
.zg-ccs{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.zg-cc{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}.zg-cc-h{display:flex;justify-content:space-between;gap:8px}.zg-cc-h h4{margin:0}
.zg-mems{list-style:none;padding:0;margin:8px 0 0}.mem{padding:8px 0;border-top:1px solid var(--line2,#EDEFF3);font-size:13.5px}.zg-t{color:var(--muted)}
.zg-acts{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px;font-size:12.5px}
.zg-empty{display:block}
.isa.zoff{opacity:.5;filter:url(#zgrey)}.isa.zoff:hover .isb{transform:none;filter:none}a.isl.zoff{opacity:.42;filter:grayscale(1)}
.zpin{fill:#141418;font-weight:800;font-family:var(--disp,inherit);pointer-events:none}
.zacts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0 4px}
.za{display:inline-flex;align-items:center;min-height:34px;padding:6px 14px;border:1px solid var(--line);border-radius:99px;background:#fff;color:var(--ink);font:inherit;font-size:13.5px;font-weight:600;text-decoration:none;cursor:pointer}
.za:hover{background:var(--hov,#F7F8FA)}.zpow{position:fixed;right:16px;bottom:16px;z-index:300;display:flex;align-items:center;gap:8px;margin:0;padding:4px 6px 4px 8px;background:#FFFFFF;border:1px solid #E4E7EC;border-radius:99px;box-shadow:0 8px 24px rgba(16,24,40,.12);font-family:Geist,system-ui,sans-serif;font-size:13px}.zpow a{display:inline-flex;align-items:center;min-height:36px;color:#1C1D1F;text-decoration:none;font-weight:500}.zpow .zpb{padding:0 12px;border-radius:99px;background:#17181B;color:#fff;font-weight:600}.zpow .zpb:hover{background:#2C2C33}.zpow{white-space:nowrap;width:max-content;max-width:calc(100vw - 16px)}.zpow>*,.zpow .zplk>*{flex:none}.zpow .zplk{gap:6px;padding-left:6px}.zlp{font-weight:400;color:#6F7988;letter-spacing:-.01em}.zlm{display:block;flex:none}.zlw{font-weight:600;color:#1C1D1F;letter-spacing:-.02em;font-size:14px}@media (max-width:600px){body{padding-bottom:64px}.zpow{right:8px;bottom:8px;font-size:12px;gap:6px}.zpow a{min-height:44px}.zpow .zpb{padding:0 10px}}
.zacts-c{display:inline-flex;flex-wrap:nowrap;margin:0 0 0 auto;gap:6px}.zacts-c .za{min-height:30px;padding:4px 12px;font-size:12.5px}
.note.zslim{padding:4px 10px;margin-bottom:8px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand .logo img{display:block;width:28px;height:28px;border-radius:8px;object-fit:contain}
.zpaid ul{margin:8px 0 0;padding-left:18px}.zpaid li{margin:8px 0}
.zun.cp{cursor:pointer}
.zdev{font-size:12px;margin:6px 0 0;color:var(--mute,#6b7280)}.zdev code{font-size:11px}
.ztoast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;opacity:0;pointer-events:none;transition:opacity .2s;z-index:99}.ztoast.on{opacity:1}.zcm{position:fixed;inset:0;z-index:400;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(16,24,40,.28);opacity:0;transition:opacity .2s;cursor:pointer}.zcm[hidden]{display:none}.zcm.on{opacity:1}.zcmc{font-family:Geist,system-ui,sans-serif;background:#FFFFFF;color:#1C1D1F;border:1px solid #E4E7EC;border-radius:16px;box-shadow:0 24px 64px rgba(16,24,40,.24);padding:32px 32px 28px;max-width:440px;width:100%;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px;transform:scale(.96) translateY(8px);transition:transform .2s}.zcm.on .zcmc{transform:none}.zcmc svg{margin-bottom:8px}.zcmt{font-size:22px;font-weight:600;letter-spacing:-.01em}.zcml{font-size:18px;line-height:1.45;color:#4B5563}@media (prefers-reduced-motion:reduce){.zcm,.zcmc{transition:none}.zcmc{transform:none}}
`;

/** David's city styles plus the generated-block styles. */
export const CITY_CSS = DAVID_CSS + ZG_CSS;
