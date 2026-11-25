// Single-file HTML dossier. One page with a view per topic, routed by the URL hash. Inline CSS and a
// small inline script, system fonts, no network. Without the script every view shows in a row,
// which is also what print gets.
import { formatPhone } from "../modules/phone.js";
import { escapeHtml as e, safeUrl } from "../util.js";
import type { Bar, Block, Card, CommitteeCard, Member, Section, StatItem, Tone } from "./blocks.js";
import type { Dossier, Weekly } from "./index.js";
import { maskValue } from "./mask.js";
import { logoData, logoHtml } from "../assets.js";

// ---------- views ----------

interface View {
  id: string;
  label: string;
  head: string;
  icon: string;
  /** Module section ids shown in this view, in order. */
  ids: string[];
  /** A small heading in the nav above this view. */
  group?: string;
}

const I = (d: string) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const ICON = {
  overview: I('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  plays: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>'),
  buyers: I('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>'),
  signals: I('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  rivals: I('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
  ads: I('<path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1Z"/><path d="M17 8.5a5 5 0 0 1 0 7"/>'),
  seo: I('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  reviews: I('<path d="M4 5h16v11H9l-5 4Z"/><path d="M8 9.5h8M8 12.5h5"/>'),
  market: I('<path d="M3 20h18"/><path d="m4 15 5-5 4 3 7-7"/><path d="M15 6h5v5"/>'),
  brief: I('<path d="M6 3h9l4 4v14H6Z"/><path d="M14 3v5h5M9 12h7M9 16h7"/>'),
  receipt: I('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/>'),
  social: I('<path d="M4 6h16v9H10l-4 3v-3H4Z"/><path d="M8 10h8"/>'),
  repeat: I('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'),
  link: I('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  mail: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  phone: I('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  close: I('<path d="M6 6l12 12M18 6 6 18"/>'),
  more: I('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'),
  arrowL: I('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  arrowR: I('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  copy: I('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  empty: I('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'),
};

const VIEWS: View[] = [
  { id: "overview", label: "Overview", head: "", icon: ICON.overview, ids: [], group: "Analysis" },
  { id: "buyers", label: "Accounts and buyers", head: "Accounts, their buying committees and the people to reach", icon: ICON.buyers, ids: ["committee", "accounts", "enrich", "people"] },
  { id: "rivals", label: "Rivals", head: "What your rivals say and charge", icon: ICON.rivals, ids: ["competitors"] },
  { id: "ads", label: "Ads", head: "The ads your rivals run and the angles you miss", icon: ICON.ads, ids: ["ads"] },
  { id: "social", label: "Social", head: "What you and your rivals post on LinkedIn and X", icon: ICON.social, ids: ["social"] },
  { id: "seo", label: "SEO and AI answers", head: "Searches you miss and AI answers that name you", icon: ICON.seo, ids: ["seo"] },
  { id: "reviews", label: "Reviews and mentions", head: "What reviewers and posts say", icon: ICON.reviews, ids: ["reviews", "mentions"] },
  { id: "signals", label: "Signals", head: "Who shows buying intent now", icon: ICON.signals, ids: ["signals"] },
  { id: "market", label: "Market", head: "Traffic, funding and hiring side by side", icon: ICON.market, ids: ["market", "local", "commerce", "domains"] },
  { id: "readiness", label: "Agent readiness", head: "How ready you and your rivals are for AI agents", icon: ICON.market, ids: ["readiness"] },
  { id: "plays", label: "Plays", head: "What to do next, with the evidence", icon: ICON.plays, ids: [], group: "Next steps" },
  { id: "brief", label: "Brief", head: "The brief and the buyer profile this run used", icon: ICON.brief, ids: ["summary", "icp"] },
  { id: "receipt", label: "How much this cost", head: "What each call cost", icon: ICON.receipt, ids: ["receipt"] },
];

// ---------- style ----------

const CSS = `
:root{--paper:#f4f2ec;--card:#fff;--ink:#14201a;--ink2:#26332c;--muted:#55625b;--faint:#68736c;--line:#e3dfd5;--line2:#ece9e1;
--green:#009362;--green-ink:#00704b;--mint:#00c767;--tint:#e3f5ea;
--warm-ink:#7d4c00;--warm:#f0a32b;--warm-bg:#fbf1df;--cold-ink:#9e2a20;--cold:#d9594f;--cold-bg:#f9e9e7;--plain-ink:#47504b;--plain:#a3ada7;--plain-bg:#ecebe5;
--side:#101b15;--side2:#0a110d;--side-ink:#c6d1ca;--side-mute:#8d9a92;
--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
--mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
--r:16px;--r-sm:8px;--shadow:0 1px 2px rgba(20,32,26,.04),0 8px 24px -16px rgba(20,32,26,.18)}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;scroll-padding-top:96px}
body{background:var(--paper);color:var(--ink);font:16px/1.6 var(--sans);-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
a{color:var(--green-ink)}
svg{display:block;flex:none}
[hidden]{display:none!important}
:focus-visible{outline:2px solid var(--green);outline-offset:2px}
.skip{position:absolute;left:16px;top:-64px;background:var(--ink);color:#fff;padding:8px 16px;border-radius:8px;z-index:99}
.skip:focus{top:16px}
.app{display:grid;grid-template-columns:272px minmax(0,1fr);min-height:100vh}
main{min-width:0;padding-bottom:96px}

.side{background:linear-gradient(180deg,var(--side),var(--side2));color:var(--side-ink);position:sticky;top:0;height:100vh;overflow-y:auto;display:flex;flex-direction:column;scrollbar-width:none;z-index:20}
.side::-webkit-scrollbar{display:none}
.brand{display:flex;gap:16px;align-items:center;padding:24px 24px 24px;border-bottom:1px solid rgba(255,255,255,.07)}
.mark{width:40px;height:40px;border-radius:8px;display:grid;place-items:center;background:linear-gradient(135deg,var(--mint),var(--green) 60%,#00563a);color:#fff;font:700 18px/1 var(--sans);box-shadow:0 0 24px rgba(0,199,103,.25)}
.brand b{display:block;color:#fff;font-size:16px;line-height:1.3;word-break:break-word}
.brand small{display:block;font:600 11px/1.4 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--side-mute);margin-top:4px}
.nav{display:flex;flex-direction:column;gap:2px;padding:16px 16px}
.nav h6{font:600 11px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--side-mute);padding:8px 8px 8px}
.nav a{display:flex;align-items:center;gap:16px;min-height:44px;padding:8px 8px 8px 16px;border-radius:8px;color:var(--side-ink);text-decoration:none;font-size:15px;font-weight:500;line-height:1.25;transition:background-color .15s,color .15s}
.nav a svg{opacity:.7}
.nav a:hover{background:rgba(255,255,255,.06);color:#fff}
.nav a.on{background:rgba(255,255,255,.1);color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)}
.nav a.on svg{opacity:1;color:var(--mint)}
.nav .n{margin-left:auto;font:700 12px/1 var(--mono);padding:4px 8px;border-radius:999px;background:#1f2e26;color:var(--side-ink)}
.nav .n.z{background:transparent;color:var(--side-mute)}
.nav a.on .n{background:var(--mint);color:#04210f}
.side-foot{margin-top:auto;padding:16px 24px 24px;font:12px/1.6 var(--mono);color:var(--side-mute);border-top:1px solid rgba(255,255,255,.07)}
.side-foot kbd{display:inline-block;min-width:24px;text-align:center;border:1px solid rgba(255,255,255,.18);border-radius:4px;padding:0 4px;margin-right:4px;color:var(--side-ink);font:inherit}

.topbar{position:sticky;top:0;z-index:10;display:flex;gap:16px;align-items:center;justify-content:space-between;padding:16px 40px;background:rgba(244,242,236,.88);backdrop-filter:saturate(1.4) blur(10px);-webkit-backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line)}
.crumb{font:600 12px/1.4 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--green-ink)}
.ttl{font-weight:600;font-size:16px;line-height:1.4;color:var(--ink2);overflow-wrap:anywhere}
.ttl span{color:var(--muted);font-weight:500}
.tb-r{display:flex;gap:8px;align-items:center;flex:none}
.pill{font:12px/1 var(--mono);color:var(--muted);border:1px solid var(--line);background:var(--card);border-radius:999px;padding:8px 16px;white-space:nowrap}
.pill.pub{color:var(--warm-ink);background:var(--warm-bg);border-color:transparent}
.step{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);text-decoration:none;transition:background-color .15s}
.step:hover{background:var(--tint)}
.step.off{opacity:.35;pointer-events:none}

.banner{margin:24px 40px 0;background:var(--warm-bg);color:var(--warm-ink);border-radius:var(--r-sm);padding:16px 24px;font-weight:500}
.wrap{max-width:1200px;margin:0 auto;padding:0 40px}
.view{padding-top:40px}
.js .view{opacity:0;transform:translateY(8px)}
.js .view.in{opacity:1;transform:none;transition:opacity .35s ease,transform .35s cubic-bezier(.2,.8,.2,1)}
.vhead{margin-bottom:32px;max-width:820px}
.kicker{font:600 12px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--green-ink);margin-bottom:8px}
h1{font-size:40px;line-height:1.1;letter-spacing:-.025em;font-weight:750}
.lede{color:var(--muted);font-size:17px;margin-top:16px}
.runline{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}

.sec{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:32px;margin-bottom:24px;box-shadow:var(--shadow)}
.sec>header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;margin-bottom:8px}
h2{font-size:24px;line-height:1.25;letter-spacing:-.015em;font-weight:700}
h2 .num{font:600 15px var(--mono);color:var(--green-ink);margin-right:8px}
h3{font-size:17px;line-height:1.35;font-weight:650;letter-spacing:-.01em}
.source{font-size:14px;color:var(--faint);margin-bottom:24px}
.sec p,.view>p{margin-bottom:16px}
.sec ul{margin:0 0 24px;padding-left:24px}
.sec li{margin-bottom:8px}
.sec li::marker{color:var(--green)}
.sec.quiet{padding:24px 32px;box-shadow:none;background:transparent;border-style:dashed}
.sec.quiet .source{margin-bottom:0}

.chip{display:inline-flex;align-items:center;gap:8px;font:600 12px/1 var(--mono);padding:4px 8px;min-height:24px;border-radius:999px;background:var(--plain-bg);color:var(--plain-ink);white-space:nowrap}
.chip::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.8}
.chip.go,.chip.done,.chip.fact{background:var(--tint);color:var(--green-ink)}
.chip.warm,.chip.capped,.chip.inferred{background:var(--warm-bg);color:var(--warm-ink)}
.chip.cold{background:var(--cold-bg);color:var(--cold-ink)}
.chip.bare::before{display:none}

dl.kv{display:grid;grid-template-columns:minmax(120px,200px) 1fr;gap:8px 24px;margin:0 0 24px;padding:16px 24px;background:var(--paper);border-radius:12px}
dl.kv dt{color:var(--muted);font-size:14px;padding-top:2px}
dl.kv dd{margin:0}

.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(176px,1fr));gap:16px;margin:0 0 24px}
.stat{position:relative;display:flex;flex-direction:column;gap:8px;background:var(--paper);border-radius:12px;padding:16px;color:inherit;text-decoration:none}
.stat b{font:700 28px/1.15 var(--sans);letter-spacing:-.02em}
.stat .sl{font-size:14px;color:var(--muted)}
.hero .stats{grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.hero .stat{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:24px;box-shadow:var(--shadow);transition:transform .2s ease,box-shadow .2s ease}
.hero a.stat:hover{transform:translateY(-2px);box-shadow:0 1px 2px rgba(20,32,26,.05),0 16px 32px -20px rgba(20,32,26,.3)}
.hero .stat .sl{order:-1;font:600 12px/1.4 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.hero .stat b{font-size:44px;line-height:1}
.hero .stat .sh{font-size:14px;color:var(--muted)}
.hero .stat .go-to{position:absolute;top:24px;right:24px;color:var(--faint);transition:transform .2s ease}
.hero a.stat:hover .go-to{transform:translateX(4px);color:var(--green-ink)}
.stat .sh{font-size:14px;color:var(--muted)}

.meter{display:block;height:8px;border-radius:999px;background:var(--line2);overflow:hidden}
.meter i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--mint),var(--green));transform-origin:left center;transform:scaleX(var(--v,0));transition:transform 1s cubic-bezier(.2,.8,.2,1)}
.meter i.warm{background:var(--warm)}
.meter i.cold{background:var(--cold)}
.meter i.plain{background:var(--plain)}
.js .view:not(.in) .meter i{transform:scaleX(0);transition:none}

.bargrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:16px;margin:0 0 24px}
.bars{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:24px;box-shadow:var(--shadow);margin:0 0 24px}
.bargrid .bars{margin:0}
.bars figcaption{font-weight:650;margin-bottom:16px}
.brow{display:grid;grid-template-columns:minmax(80px,32%) 1fr minmax(56px,auto);gap:16px;align-items:center;min-height:32px;font-size:14px}
.brow .bl{color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.brow .bv{font:600 13px var(--mono);text-align:right;color:var(--ink2)}

.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr));gap:16px;margin:0 0 24px}
.cap-h{font-weight:650;margin:8px 0 16px}
.lg{width:var(--s,28px);height:var(--s,28px);flex:none;display:inline-grid;place-items:center;border-radius:8px;background:#fff;border:1px solid var(--line);overflow:hidden;vertical-align:middle;font:700 13px/1 var(--sans);color:var(--green-ink)}
.lg.tile{background:var(--tint);border-color:transparent}
.lg img{width:100%;height:100%;object-fit:contain;display:block}
.lgc{display:inline-flex;align-items:center;gap:8px}
.pc-lg{display:flex;align-items:center;gap:8px;font:600 13px var(--mono);color:var(--ink2)}
.mark img{width:100%;height:100%;object-fit:contain;border-radius:8px;background:#fff}
.pc{min-width:0;display:flex;flex-direction:column;gap:16px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:24px;box-shadow:var(--shadow);transition:transform .2s ease,box-shadow .2s ease}
.pc:hover{transform:translateY(-2px);box-shadow:0 1px 2px rgba(20,32,26,.05),0 16px 32px -20px rgba(20,32,26,.3)}
.pc-h{display:flex;align-items:center;justify-content:space-between;gap:8px}
.pc .tag{font:600 13px var(--mono);color:var(--green-ink)}
.pc .sub{font:13px var(--mono);color:var(--faint);margin-top:-8px}
.pc dl{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--line2);padding-top:16px}
.pc dt{font:600 11px/1.4 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
.pc dd{margin:0 0 8px;font-size:15px;color:var(--ink2)}
.cmd{display:flex;align-items:center;gap:8px;margin-top:auto;background:var(--side);color:#dbe7e0;border-radius:var(--r-sm);padding:4px 4px 4px 16px}
.cmd code{flex:1;min-width:0;font:13px/1.5 var(--mono);overflow-x:auto;white-space:nowrap;padding:8px 0;scrollbar-width:thin}
.cmd button{display:inline-grid;place-items:center;width:44px;height:44px;border:0;border-radius:6px;background:transparent;color:#aebcb4;cursor:pointer;transition:background-color .15s,color .15s}
.cmd button:hover{background:rgba(255,255,255,.08);color:#fff}
.cmd button.ok{color:var(--mint)}
.cards.compact .pc dl dd{font-size:14px}
.empty{display:flex;gap:16px;align-items:flex-start;background:var(--card);border:1px dashed var(--line);border-radius:var(--r);padding:32px;color:var(--muted);margin:0 0 24px;max-width:820px}
.empty svg{width:24px;height:24px;color:var(--green);margin-top:2px}
.empty b{display:block;color:var(--ink);margin-bottom:8px;font-size:17px}

.tbl{overflow-x:auto;margin:0 0 24px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
.tbl .cap{font-weight:650;padding:16px 16px 8px;position:sticky;left:0}
table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.5}
th,td{text-align:left;padding:8px 16px;border-top:1px solid var(--line2);vertical-align:top}
th{font:600 11px/1.4 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);background:#faf9f6;white-space:nowrap;padding-top:12px;padding-bottom:12px}
tbody tr{transition:background-color .15s}
tbody tr:hover{background:#fbfaf7}
td.n,th.n{text-align:right;font-family:var(--mono);white-space:nowrap}
td .chip{vertical-align:middle}
.nw{white-space:nowrap}
.sc{display:inline-flex;align-items:center;gap:8px;justify-content:flex-end}
.sc .meter{width:48px;height:6px}
.note{background:var(--paper);border-radius:12px;padding:16px 24px;color:var(--muted);margin:0 0 16px;font-size:15px}
.foot{display:flex;flex-wrap:wrap;gap:8px 24px;font-size:14px;margin-top:8px;padding-top:16px;border-top:1px solid var(--line2)}
.foot code{font:13px var(--mono);background:var(--paper);padding:2px 8px;border-radius:6px;word-break:break-all}
.foot b{color:var(--green-ink)}
.pager{display:flex;justify-content:space-between;gap:16px;margin-top:40px}
.pager a{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:8px 16px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);text-decoration:none;font-weight:500;font-size:15px;transition:background-color .15s}
.pager a:hover{background:var(--tint)}
.pager a.next{margin-left:auto}

.chips{display:flex;flex-wrap:wrap;gap:8px}
.links{display:flex;flex-wrap:wrap;gap:8px}
.lnk{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:8px 16px;border-radius:999px;background:var(--paper);color:var(--green-ink);text-decoration:none;font-size:14px;font-weight:550;transition:background-color .15s}
.lnk:hover{background:var(--tint)}
.pc.ad{padding-top:16px}
.crea{position:relative;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;min-height:176px;border-radius:12px;padding:16px;overflow:hidden;color:#fff;background:linear-gradient(140deg,#14201a,#0b3d2a)}
.crea.meta{background:linear-gradient(140deg,#1d2b53,#3b5bdb)}
.crea.li{background:linear-gradient(140deg,#0a3a5c,#0a66c2)}
.crea.gg{background:linear-gradient(140deg,#20262b,#4a5560)}
.crea img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .4s ease}
.crea img.on{opacity:1}
.crea img.on~b,.crea img.on~.crea-p{display:none}
.crea b{position:relative;font-size:19px;line-height:1.3;letter-spacing:-.01em;font-weight:700}
.crea-p{position:relative;align-self:flex-start;font:600 11px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;background:rgba(255,255,255,.16);padding:8px;border-radius:6px}
.legend{display:flex;flex-wrap:wrap;gap:16px;margin:-8px 0 16px;font-size:13px;color:var(--muted)}
.lg{display:inline-flex;align-items:center;gap:8px}
.lg i{width:12px;height:12px;border-radius:3px;background:var(--green)}
.lg i.warm{background:var(--warm)}.lg i.plain{background:var(--plain)}.lg i.cold{background:var(--cold)}
.meter.stack{position:relative}
.meter.stack i{position:absolute;top:0;bottom:0;border-radius:0;transform:scaleX(1);transform-origin:left center;transition:transform 1s cubic-bezier(.2,.8,.2,1)}
.js .view:not(.in) .meter.stack i{transform:scaleX(0)}
.ccs{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(440px,100%),1fr));gap:16px;margin:0 0 24px}
.cc{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:24px;box-shadow:var(--shadow);min-width:0}
.cc-h{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
.cc-h .sub{font:13px var(--mono);color:var(--faint);margin:0}
.cc-r{display:flex;gap:8px;align-items:center;flex:none}
.cov{font-size:14px;color:var(--muted);margin:8px 0 16px}
.mems{list-style:none;padding:0!important;margin:0!important;display:flex;flex-direction:column;gap:8px}
.mem{background:var(--paper);border-radius:12px;padding:16px;margin:0!important}
.mem-h{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;margin-bottom:8px}
.mem-h b{font-size:16px}
.mt{color:var(--muted);font-size:14px}
.ag{display:inline-flex;gap:8px;align-items:center;flex-wrap:nowrap;max-width:100%}
.acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.act{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:8px 16px;border-radius:999px;background:var(--card);border:1px solid var(--line);color:var(--ink2);text-decoration:none;font-size:14px;overflow-wrap:anywhere}
a.act:hover{background:var(--tint)}
.act.off{color:var(--faint);border-style:dashed;background:transparent}
.cp{display:inline-grid;place-items:center;width:44px;height:44px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--muted);cursor:pointer}
.cp:hover{background:var(--tint)}.cp.ok{color:var(--green)}
.more{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;background:var(--tint);border-radius:var(--r);padding:16px 16px 16px 24px;margin:0 0 24px}
.more-t{display:flex;gap:16px;align-items:center;min-width:0}
.more-t b{display:block;font-size:16px}
.more-t span{font-size:14px;color:var(--muted)}
.more-t .more-i{display:grid;place-items:center;width:40px;height:40px;border-radius:999px;background:var(--green);color:#fff;flex:none;font-size:0}
.more .cmd{margin:0;flex:1 1 360px;max-width:560px}
.wk-b{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:8px 16px;border-radius:999px;border:0;background:var(--green);color:#fff;font:600 14px var(--sans);cursor:pointer;transition:background-color .15s}
.wk-b:hover{background:var(--green-ink)}
.wk-card{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:24px;margin:0 0 24px;box-shadow:var(--shadow)}
.wk-card b{display:block;font-size:17px}
.wk-card span{color:var(--muted);font-size:15px}
dialog.wk{margin:auto;border:0;border-radius:var(--r);padding:0;width:min(760px,calc(100vw - 32px));max-height:calc(100vh - 32px);background:var(--card);color:var(--ink);box-shadow:0 24px 64px -16px rgba(0,0,0,.4)}
dialog.wk::backdrop{background:rgba(10,17,13,.5)}
.wk-in{padding:32px;display:flex;flex-direction:column;gap:16px}
.wk-top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
.wk-x{display:grid;place-items:center;width:44px;height:44px;border:1px solid var(--line);border-radius:999px;background:var(--card);cursor:pointer;color:var(--ink)}
.wk h2{font-size:22px}
.wk .price{display:inline-flex;font:600 13px var(--mono);background:var(--tint);color:var(--green-ink);border-radius:999px;padding:8px 16px}
.wk h3{font-size:15px;margin-top:8px}
.wk p{color:var(--muted);font-size:15px}
.wk pre{background:var(--side);color:#dbe7e0;border-radius:var(--r-sm);padding:16px;font:13px/1.55 var(--mono);overflow:auto;max-height:240px;white-space:pre}
.wk pre.wrap{white-space:pre-wrap}
.wk-row{display:flex;gap:8px;align-items:flex-start}
.wk-row pre{flex:1;min-width:0}
.wk-row .cp{flex:none}

@media (max-width:1100px){.hero .stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:900px){
.app{display:block}
.side{position:sticky;top:0;height:auto;flex-direction:row;align-items:center;overflow:visible;box-shadow:0 8px 24px -16px rgba(0,0,0,.5)}
.brand{padding:8px 8px 8px 16px;border:0;flex:none}
.brand div{display:none}
.mark{width:32px;height:32px;font-size:15px}
.nav{flex-direction:row;gap:4px;padding:8px 16px 8px 8px;overflow-x:auto;scrollbar-width:none;flex:1;min-width:0}
.nav::-webkit-scrollbar{display:none}
.nav h6,.side-foot{display:none}
.nav a{flex:none;padding:8px 16px;gap:8px;white-space:nowrap}
.topbar{position:static;padding:16px}
.tb-r .step,.tb-r .pill:not(.pub){display:none}
.tb-r .wk-b span{display:none}
.more{padding:16px}
.wk-in{padding:24px 16px}
.banner{margin:16px 16px 0}
.wrap{padding:0 16px}
.view{padding-top:24px}
h1{font-size:30px}
.sec{padding:24px 16px}
.sec.quiet{padding:16px}
dl.kv{grid-template-columns:1fr;gap:0;padding:16px}
dl.kv dd{margin-bottom:8px}
.cards{grid-template-columns:minmax(0,1fr)}
.crumb{display:none}
.bargrid{grid-template-columns:minmax(0,1fr)}
.hero .stat b{font-size:36px}
}
@media (max-width:560px){.hero .stats{grid-template-columns:1fr}.brow{grid-template-columns:minmax(72px,36%) 1fr auto;gap:8px}.empty{padding:24px 16px}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}.js .view{opacity:1;transform:none}.js .view:not(.in) .meter i{transform:scaleX(var(--v,0))}.js .view:not(.in) .meter.stack i{transform:none}}
@media print{
@page{margin:16mm}
body{background:#fff;font-size:12pt}
.app{display:block}
.side,.topbar .tb-r,.pager,.skip,.cmd button,.cp,.wk-b,.wk-card,dialog.wk{display:none!important}
.topbar{position:static;background:none;border:0;padding:0 0 16px}
.view,.view[hidden]{display:block!important;opacity:1!important;transform:none!important;padding-top:0;break-before:page}
.view:first-of-type{break-before:auto}
.wrap{padding:0;max-width:none}
.banner{margin:0 0 16px}
.sec,.pc,.bars,.hero .stat{box-shadow:none;break-inside:avoid-page}
.sec{border-color:#ccc}
.meter i{transform:scaleX(var(--v,0))!important}
.meter.stack i{transform:none!important}
.tbl{overflow:visible}
a{color:inherit;text-decoration:none}
}
`;

// ---------- script ----------

const JS = `(function(){
var d=document,root=d.documentElement;root.classList.add('js');
var views=[].slice.call(d.querySelectorAll('.view'));
var ids=views.map(function(v){return v.getAttribute('data-view');});
var links=[].slice.call(d.querySelectorAll('[data-v]'));
var crumb=d.getElementById('crumb');
var prev=d.getElementById('prev'),next=d.getElementById('next');
function target(h){
  h=decodeURIComponent((h||'').replace(/^#/,''));
  if(ids.indexOf(h)>-1)return{v:h};
  if(h.indexOf('v-')===0&&ids.indexOf(h.slice(2))>-1)return{v:h.slice(2)};
  var el=h?d.getElementById(h):null;
  var p=el&&el.closest?el.closest('.view'):null;
  if(p)return{v:p.getAttribute('data-view'),el:el};
  return{v:ids[0]};
}
function show(h){
  var t=target(h),i=ids.indexOf(t.v),cur=null;
  views.forEach(function(v){var on=v.getAttribute('data-view')===t.v;v.hidden=!on;v.classList.remove('in');if(on)cur=v;});
  links.forEach(function(a){var on=a.getAttribute('data-v')===t.v;a.classList.toggle('on',on);if(on){a.setAttribute('aria-current','page');if(a.scrollIntoView&&a.closest('.nav'))try{a.scrollIntoView({block:'nearest',inline:'center'});}catch(x){}}else a.removeAttribute('aria-current');});
  if(crumb&&cur)crumb.textContent=cur.getAttribute('data-label');
  if(prev){prev.classList.toggle('off',i<1);prev.setAttribute('href','#'+(ids[i-1]||ids[0]));}
  if(next){next.classList.toggle('off',i>=ids.length-1);next.setAttribute('href','#'+(ids[i+1]||ids[ids.length-1]));}
  if(t.el)t.el.scrollIntoView();else window.scrollTo(0,0);
  if(cur)requestAnimationFrame(function(){requestAnimationFrame(function(){cur.classList.add('in');});});
  if(cur)[].forEach.call(cur.querySelectorAll('img[data-src]'),function(im){im.onload=function(){im.classList.add('on');};im.onerror=function(){im.remove();};im.src=im.getAttribute('data-src');im.removeAttribute('data-src');});
}
window.addEventListener('hashchange',function(){show(location.hash);});
d.addEventListener('keydown',function(ev){
  if(ev.altKey||ev.ctrlKey||ev.metaKey||ev.shiftKey)return;
  var tg=ev.target;if(tg&&(/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)||tg.isContentEditable))return;
  var i=ids.indexOf(target(location.hash).v);
  if(ev.key==='ArrowRight'&&i<ids.length-1){location.hash=ids[i+1];ev.preventDefault();}
  else if(ev.key==='ArrowLeft'&&i>0){location.hash=ids[i-1];ev.preventDefault();}
});
d.addEventListener('click',function(ev){
  var b=ev.target.closest?ev.target.closest('[data-copy]'):null;if(!b)return;
  var val=b.getAttribute('data-copy'),c=null;
  if(val&&val.charAt(0)==='#'){c=d.getElementById(val.slice(1));val='';}
  if(!val&&!c)c=b.parentNode.querySelector('code');
  if(!val&&!c)return;
  var text=val||c.textContent,label=b.getAttribute('aria-label');
  var done=function(){b.classList.add('ok');b.setAttribute('aria-label','Copied');setTimeout(function(){b.classList.remove('ok');b.setAttribute('aria-label',label);},1600);};
  var pick=function(){var t=c;if(!t){t=d.createElement('textarea');t.value=text;d.body.appendChild(t);t.select();try{if(d.execCommand('copy'))done();}catch(x){}d.body.removeChild(t);return;}var r=d.createRange();r.selectNodeContents(t);var s=window.getSelection();s.removeAllRanges();s.addRange(r);try{if(d.execCommand('copy'))done();}catch(x){}};
  if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(text).then(done,pick);else pick();
});
var wk=d.getElementById('weekly');
[].forEach.call(d.querySelectorAll('[data-weekly]'),function(b){b.addEventListener('click',function(){if(!wk)return;if(wk.showModal)wk.showModal();else wk.setAttribute('open','');});});
if(wk)wk.addEventListener('click',function(ev){if(ev.target===wk||ev.target.closest('[data-close]'))wk.close?wk.close():wk.removeAttribute('open');});
show(location.hash);
if(wk&&location.hash==='#weekly'&&wk.showModal)wk.showModal();
})();`;

// ---------- blocks ----------

type Mask = (x: unknown, pii?: Parameters<typeof maskValue>[1]) => string;

const TONE_OF: Record<string, Tone> = {
  hot: "go", verified: "go", valid: "go", done: "go", yes: "go", positive: "go", hit: "go",
  warm: "warm", "catch-all": "warm", catch_all: "warm", unverified: "warm", unknown: "warm", risky: "warm", mixed: "warm", fallback: "warm", capped: "warm", partial: "warm",
  cold: "cold", miss: "cold", invalid: "cold", fail: "cold", failed: "cold", negative: "cold", no: "cold",
  skipped: "plain", neutral: "plain",
};
const GRADE_TONE: Record<string, Tone> = { A: "go", B: "warm", C: "plain", D: "cold" };

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const meter = (v: number, tone: Tone = "go") => `<span class="meter" aria-hidden="true"><i class="${tone}" style="--v:${clamp(v).toFixed(3)}"></i></span>`;

function cellHtml(raw: unknown, key: string, num: boolean | undefined, masked: string): string {
  if (num && key === "score" && typeof raw === "number" && raw >= 0 && raw <= 100) return `<span class="sc">${masked}${meter(raw / 100, raw >= 75 ? "go" : raw >= 50 ? "warm" : "cold")}</span>`;
  if (num) return typeof raw === "number" && Number.isInteger(raw) && Math.abs(raw) >= 10000 ? raw.toLocaleString("en-US") : masked;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (/^(read )?\d{4}-\d{2}-\d{2}$/.test(s)) return `<span class="nw">${masked}</span>`;
  if (key === "grade" && /^[A-D]$/.test(s)) return `<span class="chip bare ${GRADE_TONE[s]}">${masked}</span>`;
  const tone = TONE_OF[s.toLowerCase()];
  if (tone && s.length <= 12) return `<span class="chip ${tone}">${masked}</span>`;
  return masked;
}

function statHtml(i: StatItem): string {
  const inner = `<span class="sl">${e(i.label)}</span><b>${e(i.value)}</b>${i.hint ? `<span class="sh">${e(i.hint)}</span>` : ""}${typeof i.meter === "number" ? meter(i.meter, i.tone ?? "go") : ""}`;
  return i.view ? `<a class="stat" href="#${e(i.view)}">${inner}<span class="go-to">${ICON.arrowR}</span></a>` : `<div class="stat">${inner}</div>`;
}

const PLATFORM_TONE: Record<string, string> = { Meta: "meta", LinkedIn: "li", Google: "gg", X: "xx" };

function cardHtml(c: Card, v: Mask, pub = false): string {
  const head = c.tag || c.basis ? `<div class="pc-h"><span class="tag">${c.tag ? e(c.tag) : ""}</span>${c.basis ? `<span class="chip ${c.basis}">${c.basis}</span>` : ""}</div>` : "";
  const rows = c.rows?.length ? `<dl>${c.rows.map((r) => `<div><dt>${e(r.label)}</dt><dd>${v(r.value, r.pii)}</dd></div>`).join("")}</dl>` : "";
  const m = c.meter ? `<div><div class="sl">${e(c.meter.label)} ${c.meter.value} of ${c.meter.max}</div>${meter(c.meter.max > 0 ? c.meter.value / c.meter.max : 0, c.tone ?? "go")}</div>` : "";
  const cmd = c.command ? `<div class="cmd"><code>${e(c.command)}</code><button type="button" data-copy aria-label="Copy the command">${ICON.copy}</button></div>` : "";
  const chips = c.chips?.length ? `<div class="chips">${c.chips.map((x) => `<span class="chip bare plain">${e(x)}</span>`).join("")}</div>` : "";
  const links = c.links?.length && !pub ? `<div class="links">${c.links.map((l) => { const u = safeUrl(l.href); return u ? `<a class="lnk" href="${e(u)}" target="_blank" rel="noopener noreferrer">${ICON.link}${e(l.label)}</a>` : `<span class="lnk">${ICON.link}${e(l.label)}</span>`; }).join("")}</div>` : "";
  // An ad card gets a creative tile: the real image when the library returned one, else the headline set as the ad.
  const isAd = /^first seen/.test(c.sub ?? "");
  const creative = isAd
    ? `<div class="crea ${PLATFORM_TONE[c.tag ?? ""] ?? "gg"}">${imageSrc(c.image) && !pub ? `<img data-src="${e(imageSrc(c.image)!)}" alt="Ad creative" width="640" height="360" referrerpolicy="no-referrer">` : ""}<span class="crea-p">${e(c.tag ?? "")}</span><b>${v(c.title)}</b></div>`
    : "";
  const title = creative ? "" : `<h3>${v(c.title, c.titlePii)}</h3>`;
  const lg = c.logo ? `<div class="pc-lg">${logoHtml(c.logo, c.logo, pub)}<span>${v(c.logo)}</span></div>` : "";
  return `<article class="pc${creative ? " ad" : ""}">${creative}${creative ? "" : head}${lg}${title}${c.sub ? `<p class="sub">${v(c.sub)}</p>` : ""}${c.text ? `<p>${v(c.text)}</p>` : ""}${chips}${m}${rows}${links}${cmd}</article>`;
}

/** An ad creative source: an http(s) URL or a saved file under assets/, else null. */
function imageSrc(x: string | undefined): string | null {
  if (!x) return null;
  return safeUrl(x) ?? (/^assets\/[\w./-]+$/.test(x) && !x.includes("..") ? x : null);
}

const ROLE_TONE: Record<string, string> = { "Economic buyer": "go", Champion: "warm", "Technical or ops lead": "plain", "User lead": "plain", Influencer: "plain" };

function memberHtml(m: Member, v: Mask, pub: boolean): string {
  const act: string[] = [];
  if (m.email) {
    act.push(pub
      ? `<span class="act">${ICON.mail}${v(m.email, "email")}</span>`
      : `<span class="ag"><a class="act" href="mailto:${e(m.email)}">${ICON.mail}${e(m.email)}</a><button type="button" class="cp" data-copy="${e(m.email)}" aria-label="Copy the email">${ICON.copy}</button><span class="chip ${m.emailStatus === "verified" ? "go" : "warm"}">${e(m.emailStatus)}</span></span>`);
  } else act.push(`<span class="act off">${ICON.mail}email ${e(m.emailStatus)}</span>`);
  if (m.linkedin) act.push(pub ? `<span class="act">${ICON.link}LinkedIn hidden in the public copy</span>` : safeUrl(m.linkedin) ? `<a class="act" href="${e(safeUrl(m.linkedin)!)}" target="_blank" rel="noopener noreferrer">${ICON.link}LinkedIn</a>` : `<span class="act">${ICON.link}LinkedIn</span>`);
  else act.push(`<span class="act off">${ICON.link}no LinkedIn found</span>`);
  if (m.phone) {
    const kind = m.phoneType ? `<span class="chip ${m.phoneType === "Mobile" ? "warm" : "plain"}">${e(m.phoneType)}</span>` : "";
    act.push(pub
      ? `<span class="act">${ICON.phone}${v(m.phone, "phone")}</span>`
      : `<span class="ag"><a class="act" href="tel:${e(m.phone)}">${ICON.phone}${e(formatPhone(m.phone))}</a><button type="button" class="cp" data-copy="${e(m.phone)}" aria-label="Copy the phone number">${ICON.copy}</button>${kind}</span>`);
  } else act.push(`<span class="act off">${ICON.phone}phone ${e(m.phoneStatus)}</span>`);
  return `<li class="mem"><div class="mem-h"><span class="chip ${ROLE_TONE[m.role] ?? "plain"}">${e(m.role)}</span><b>${v(m.name, "name")}</b><span class="mt">${v(m.title)}</span></div><div class="acts">${act.join("")}</div></li>`;
}

function committeeHtml(c: CommitteeCard, v: Mask, pub: boolean): string {
  const found = c.members.filter((m) => m.email).length;
  const ph = c.members.filter((m) => m.phone).length;
  return `<article class="cc"><header class="cc-h"><div class="lgc">${logoHtml(c.domain, c.account, pub, 32)}<div><h3>${v(c.account)}</h3><p class="sub">${v(c.domain)}</p></div></div><div class="cc-r"><span class="chip bare ${{ A: "go", B: "warm", C: "plain", D: "cold" }[c.grade] ?? "plain"}">grade ${e(c.grade)}</span>${typeof c.score === "number" ? `<span class="sc">${c.score}${meter(c.score / 100, c.score >= 75 ? "go" : "warm")}</span>` : ""}</div></header><p class="cov">${c.members.length} ${c.members.length === 1 ? "person" : "people"}, ${found} ${found === 1 ? "email" : "emails"}, ${ph} ${ph === 1 ? "phone" : "phones"}</p>${c.companyPhone ? `<p class="cov"><span class="ag"><a class="act" href="tel:${e(c.companyPhone)}">${ICON.phone}${e(formatPhone(c.companyPhone))}</a><button type="button" class="cp" data-copy="${e(c.companyPhone)}" aria-label="Copy the company line">${ICON.copy}</button><span class="chip plain">Company line</span></span></p>` : ""}<ul class="mems">${c.members.map((m) => memberHtml(m, v, pub)).join("")}</ul></article>`;
}

function stackHtml(i: Bar, max: number): string {
  let at = 0;
  const segs = (i.parts ?? []).filter((p) => p.value > 0).map((p) => {
    const w = max > 0 ? (p.value / max) * 100 : 0;
    const seg = `<i class="${p.tone ?? "go"}" style="left:${at.toFixed(2)}%;width:${w.toFixed(2)}%" title="${e(p.label)} ${p.value}"></i>`;
    at += w;
    return seg;
  });
  return `<span class="meter stack" aria-hidden="true">${segs.join("")}</span>`;
}

function barsHtml(b: Extract<Block, { kind: "bars" }>, v: Mask): string {
  const max = b.max ?? Math.max(0, ...b.items.map((i) => i.value));
  const row = (i: Bar) => `<div class="brow"><span class="bl">${v(i.label)}</span>${i.parts ? stackHtml(i, max) : meter(max > 0 ? i.value / max : 0, i.tone ?? "go")}<span class="bv">${e(i.display ?? String(i.value))}</span></div>`;
  const legend = b.items.find((i) => i.parts)?.parts?.map((p) => `<span class="lg"><i class="${p.tone ?? "go"}"></i>${e(p.label)}</span>`).join("") ?? "";
  return `<figure class="bars">${b.caption ? `<figcaption>${e(b.caption)}</figcaption>` : ""}${legend ? `<div class="legend">${legend}</div>` : ""}\n${b.items.map(row).join("\n")}\n</figure>`;
}

function block(b: Block, pub: boolean, compact = false): string {
  const v: Mask = (x, pii) => e(maskValue(x, pii, pub));
  switch (b.kind) {
    case "text":
      return `<p>${v(b.text)}</p>`;
    case "note":
      return `<div class="note">${v(b.text)}</div>`;
    case "list":
      return `<ul>${b.items.map((i) => `<li>${v(i)}</li>`).join("")}</ul>`;
    case "kv":
      return `<dl class="kv">${b.items.map((i) => `<dt>${e(i.label)}</dt><dd>${v(i.value, i.pii)}</dd>`).join("")}</dl>`;
    case "stat":
      return `<div class="stats">${b.items.map(statHtml).join("")}</div>`;
    case "cards":
      if (b.items.length === 0) return `${b.caption ? `<p class="cap-h">${e(b.caption)}</p>` : ""}<div class="empty">${ICON.empty}<div><b>Nothing here yet</b>${v(b.empty ?? "Nothing to show.")}</div></div>`;
      // One card per line, so a public copy masks each card on its own.
      return `${b.caption ? `<p class="cap-h">${e(b.caption)}</p>` : ""}<div class="cards${compact ? " compact" : ""}">\n${b.items.map((c) => cardHtml(c, v, pub)).join("\n")}\n</div>`;
    case "committee":
      // One account per line, so a public copy masks each committee on its own.
      return `${b.caption ? `<p class="cap-h">${e(b.caption)}</p>` : ""}<div class="ccs">\n${b.items.map((c) => committeeHtml(c, v, pub)).join("\n")}\n</div>`;
    case "more":
      return `<div class="more"><div class="more-t"><span class="more-i">${ICON.plus}</span><div><b>${e(b.label)}</b><span>${e(b.price)}${b.text ? `. ${e(b.text)}` : ""}</span></div></div><div class="cmd"><code>${e(b.command)}</code><button type="button" data-copy aria-label="Copy the command">${ICON.copy}</button></div></div>`;
    case "bars":
      return barsHtml(b, v);
    case "table":
      return `<div class="tbl">${b.caption ? `<div class="cap">${e(b.caption)}</div>` : ""}<table><thead><tr>${b.columns.map((c) => `<th${c.num ? ' class="n"' : ""}>${e(c.label)}</th>`).join("")}</tr></thead><tbody>\n${b.rows
        .map((r) => `<tr>${b.columns.map((c) => {
          const inner = c.pii ? v(r[c.key], c.pii) : cellHtml(r[c.key], c.key, c.num, v(r[c.key]));
          const d = c.logoKey ? String(r[c.logoKey] ?? "") : "";
          return `<td${c.num ? ' class="n"' : ""}>${d ? `<span class="lgc">${logoHtml(d, String(r[c.key] ?? d), pub, 24)}${inner}</span>` : inner}</td>`;
        }).join("")}</tr>`)
        .join("\n")}\n</tbody></table></div>`;
  }
}

/** Blocks with neighbouring bars side by side. */
function blocks(list: Block[], pub: boolean, compact = false): string {
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.kind === "bars" && list[i + 1]?.kind === "bars") {
      const run: Block[] = [];
      while (list[i]?.kind === "bars") run.push(list[i++]);
      i--;
      out.push(`<div class="bargrid">${run.map((x) => block(x, pub)).join("")}</div>`);
    } else out.push(block(b, pub, compact));
  }
  return out.join("\n");
}

function sectionHtml(s: Section, pub: boolean): string {
  const foot = [s.deeper ? `<div><b>Go deeper</b> <code>${e(s.deeper)}</code></div>` : "", s.activate ? `<div><b>Activate</b> ${e(s.activate)}</div>` : ""].filter(Boolean).join("");
  const quiet = s.status === "skipped" && s.blocks.length === 0;
  return `<section class="sec${quiet ? " quiet" : ""}" id="s-${e(s.id)}"><header><h2>${s.num ? `<span class="num">${e(s.num)}</span>` : ""}${e(s.title)}</h2><span class="chip ${e(s.status)}">${e(s.status)}</span></header>${s.source ? `<p class="source">${e(s.source)}</p>` : ""}\n${blocks(s.blocks, pub)}\n${foot ? `<div class="foot">${foot}</div>` : ""}</section>`;
}

// ---------- counts ----------

function rowsIn(b: Block | undefined): number {
  if (!b) return 0;
  if (b.kind === "table") return b.rows.length;
  if (b.kind === "cards") return b.items.length;
  return 0;
}

function countFor(view: View, secs: Section[], d: Dossier): number | null {
  if (view.id === "overview" || view.id === "brief" || view.id === "receipt") return null;
  if (view.id === "plays") return rowsIn(d.plays?.blocks.find((b) => b.kind === "cards"));
  const live = secs.filter((s) => s.status !== "skipped" || s.blocks.length > 0);
  if (live.length === 0) return 0;
  const s = live[0];
  if (view.id === "rivals") return s.blocks.filter((b) => b.kind === "kv").length || rowsIn(s.blocks.find((b) => b.kind === "table"));
  if (view.id === "ads" || view.id === "social") {
    // The ads or posts pulled, counted from the gallery.
    const n = s.blocks.filter((b) => b.kind === "cards").reduce((x, b) => x + rowsIn(b), 0);
    if (n > 0) return n;
  }
  if (view.id === "buyers") {
    const acc = secs.find((x) => x.id === "accounts");
    const t = acc?.blocks.find((b) => b.kind === "table");
    if (t) return rowsIn(t);
  }
  if (view.id === "seo") {
    const gap = s.blocks.find((b) => b.kind === "table" && /gap/i.test(b.caption ?? ""));
    if (gap) return rowsIn(gap);
  }
  return rowsIn(s.blocks.find((b) => b.kind === "table" || b.kind === "cards"));
}

// ---------- weekly ----------

function weeklyHtml(w: Weekly): string {
  const row = (id: string, text: string, label: string, wrap = false) => `<div class="wk-row"><pre id="${id}"${wrap ? ' class="wrap"' : ""}>${e(text)}</pre><button type="button" class="cp" data-copy="#${id}" aria-label="${e(label)}">${ICON.copy}</button></div>`;
  return `<dialog class="wk" id="weekly" aria-labelledby="wk-t"><div class="wk-in">
<div class="wk-top"><div><h2 id="wk-t">Run this sweep every week</h2><p>Same brief, same cap, every Monday. Each run writes gtm/changes.md with what moved since last week.</p></div><button type="button" class="wk-x" data-close aria-label="Close">${ICON.close}</button></div>
<span class="price">${e(w.price)}</span>
<h3>1. Ask your agent to set it up</h3><p>Paste this into your coding agent, opened in the folder that holds gtm/.</p>${row("wk-prompt", w.prompt, "Copy the prompt", true)}
<h3>2. Or run it yourself in the terminal</h3><p>Run it from the same folder each week. It shows the price and asks before it spends.</p>${row("wk-cmd", w.command, "Copy the command")}
<h3>3. Or schedule it</h3><p>A cron line for your own machine.</p>${row("wk-cron", w.cron, "Copy the cron line", true)}
<p>A GitHub Actions file. Save it as .github/workflows/gtm-watch.yml and add LOOOT_TOKEN as a repository secret.</p>${row("wk-yml", w.yml, "Copy the workflow file")}
</div></dialog>`;
}

// ---------- page ----------

export function renderHtml(d: Dossier): string {
  const byId = new Map(d.sections.map((s) => [s.id, s]));
  const used = new Set(VIEWS.flatMap((v) => v.ids));
  const extra = d.sections.filter((s) => !used.has(s.id));
  const views: { view: View; secs: Section[] }[] = [];
  for (const v of VIEWS) {
    const secs = v.ids.map((id) => byId.get(id)).filter((s): s is Section => !!s);
    if (v.id === "overview" && !d.overview) continue;
    if (v.id === "plays" && !d.plays) continue;
    if (v.ids.length > 0 && secs.length === 0) continue;
    views.push({ view: v, secs });
  }
  if (extra.length > 0) {
    const at = views.findIndex((x) => x.view.id === "receipt");
    const more = { view: { id: "more", label: "More", head: "Other sections from this run", icon: ICON.more, ids: [] }, secs: extra };
    if (at < 0) views.push(more);
    else views.splice(at, 0, more);
  }

  const built = `${d.generatedAt.slice(0, 16).replace("T", " ")} UTC`;
  const doneCount = d.sections.filter((s) => s.status === "done").length;

  const nav = views
    .map(({ view, secs }) => {
      const n = countFor(view, secs, d);
      return `${view.group ? `<h6>${e(view.group)}</h6>` : ""}<a href="#${view.id}" data-v="${view.id}">${view.icon}<span>${e(view.label)}</span>${n === null ? "" : `<span class="n${n === 0 ? " z" : ""}">${n}</span>`}</a>`;
    })
    .join("\n");

  const body = views
    .map(({ view, secs }, i) => {
      const prev = views[i - 1];
      const next = views[i + 1];
      const pager = `<nav class="pager" aria-label="Next and previous view">${prev ? `<a class="prev" href="#${prev.view.id}">${ICON.arrowL}${e(prev.view.label)}</a>` : ""}${next ? `<a class="next" href="#${next.view.id}">${e(next.view.label)}${ICON.arrowR}</a>` : ""}</nav>`;
      let inner: string;
      if (view.id === "overview" && d.overview) {
        inner = `<div class="vhead"><p class="kicker">Overview</p><h1>${e(d.brand)} at a glance</h1><p class="lede">${e(d.overview.source)}</p><div class="runline"><span class="pill">${e(d.domain)}</span><span class="pill">${e(built)}</span><span class="pill">${doneCount} of ${d.sections.length} sections done</span></div></div><div class="hero">\n${blocks(d.overview.blocks, d.public, true)}\n</div>${d.weekly && !d.public ? `<div class="wk-card"><div><b>Run this sweep every week</b><span>${e(d.weekly.price)}. You get a changes file each Monday.</span></div><button type="button" class="wk-b" data-weekly>${ICON.repeat}Run this every week</button></div>` : ""}`;
      } else if (view.id === "plays" && d.plays) {
        inner = `<div class="vhead"><p class="kicker">Plays</p><h1>${e(view.head)}</h1><p class="lede">${e(d.plays.source)}</p></div>\n${blocks(d.plays.blocks, d.public)}`;
      } else {
        inner = `<div class="vhead"><p class="kicker">${e(view.label)}</p><h1>${e(view.head)}</h1></div>\n${secs.map((s) => sectionHtml(s, d.public)).join("\n")}`;
      }
      return `<section class="view" id="v-${view.id}" data-view="${view.id}" data-label="${e(view.label)}" aria-label="${e(view.label)}">\n${inner}\n${pager}\n</section>`;
    })
    .join("\n");

  const initial = (d.brand.trim()[0] ?? "G").toUpperCase();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GTM dossier ${e(d.brand)}</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to the dossier</a>
<div class="app">
<aside class="side">
<div class="brand"><span class="mark" aria-hidden="true">${!d.public && logoData(d.domain) ? `<img src="${logoData(d.domain)}" alt="" width="40" height="40">` : e(initial)}</span><div><b>${e(d.brand)}</b><small>GTM dossier</small></div></div>
<nav class="nav" aria-label="Views">
${nav}
</nav>
<div class="side-foot"><div>${e(d.domain)}</div><div>${e(built)}</div><div><kbd>&larr;</kbd><kbd>&rarr;</kbd>move between views</div></div>
</aside>
<main id="main">
<header class="topbar"><div><p class="crumb" id="crumb">${e(views[0]?.view.label ?? "")}</p><p class="ttl">GTM dossier, ${e(d.brand)} <span>${e(d.domain)}</span></p></div><div class="tb-r">${d.public ? '<span class="pill pub">public copy, people masked</span>' : ""}<span class="pill">${e(built)}</span>${d.weekly && !d.public ? `<button type="button" class="wk-b" data-weekly aria-label="Run this every week">${ICON.repeat}<span>Run this every week</span></button>` : ""}<a class="step" id="prev" href="#" aria-label="Previous view">${ICON.arrowL}</a><a class="step" id="next" href="#" aria-label="Next view">${ICON.arrowR}</a></div></header>
${d.placeholder ? `<div class="banner">${e(d.placeholder)}</div>` : ""}
<div class="wrap">
${body}
</div>
</main>
</div>
${d.weekly && !d.public ? weeklyHtml(d.weekly) : ""}
<script>${JS}</script>
</body>
</html>
`;
}
