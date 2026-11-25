import type { ReactNode } from "react";

export const metadata = { title: "Zeus GTM OS", robots: { index: false, follow: false } };

const css = `
:root{--bg:#0b0d12;--card:#141821;--line:#262c3a;--fg:#e8ebf2;--mute:#9aa3b5;--acc:#7cf29a}
@media (prefers-color-scheme: light){:root{--bg:#f6f7fb;--card:#fff;--line:#e2e5ee;--fg:#141821;--mute:#5b6476;--acc:#0f8a3a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}a{color:var(--acc)}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 10px}.mute{color:var(--mute)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.kpi b{display:block;font-size:26px}.wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mute);font-weight:500}input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid var(--line)}
input{background:var(--bg);color:var(--fg);width:100%;max-width:340px}button{background:var(--acc);color:#000;border:0;cursor:pointer}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <main>{children}</main>
      </body>
    </html>
  );
}
