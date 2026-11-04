import { TERMS } from "./licenses";
import { instructions } from "./mcp";
import { TOOLS, toolsFor, type Ctx, type ToolDef } from "./tools";
import type { ApiSpec } from "./types";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** UTCP 1.0 manual; each tool is a cacheable GET to /tool/<name> (arrays as comma-separated values). */
export function utcpManual(ctx: Ctx, origin: string) {
  return {
    utcp_version: "1.0.1",
    manual_version: `1.0.0+${ctx.spec.hash}`,
    info: { title: "FHL Bible Tools", description: instructions(ctx) },
    tools: toolsFor(ctx.unrestricted).map((t) => ({
      name: t.name,
      description: t.description,
      inputs: t.inputSchema,
      outputs: { type: "object" },
      tags: ["bible", "fhl"],
      tool_call_template: {
        name: "fhl_bible_tools",
        call_template_type: "http",
        http_method: "GET",
        url: `${origin}/tool/${t.name}`,
        content_type: "application/json",
      },
    })),
  };
}

/** /tool/<name> query string for an example (arrays comma-joined). */
function exampleQuery(t: ToolDef): string {
  return new URLSearchParams(Object.entries(t.example).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v)])).toString();
}

function typeOf(p: any): string {
  if (p.enum) return p.enum.map((x: string) => `"${x}"`).join(" | ");
  if (p.type === "array") return `${p.items?.enum ? `(${p.items.enum.join(" | ")})` : ([] as string[]).concat(p.items?.type ?? "any").join(" | ").replace(/^(.* \| .*)$/, "($1)")}[]`;
  return ([] as string[]).concat(p.type ?? "any").join(" | ");
}

function toolSection(t: ToolDef, origin: string): string {
  const props = Object.entries(t.inputSchema.properties);
  const req = new Set(t.inputSchema.required ?? []);
  const rows = props
    .map(
      ([k, p]: [string, any]) =>
        `<tr><td><code>${esc(k)}</code>${req.has(k) ? ' <span class="req">必填</span>' : ""}</td><td><code>${esc(typeOf(p))}</code>${p.default !== undefined ? `<br><small>預設 <code>${esc(JSON.stringify(p.default))}</code></small>` : ""}</td><td>${esc(p.description)}</td></tr>`,
    )
    .join("");
  const q = exampleQuery(t);
  return `<section class="tool" id="${t.name}">
  <h3><code>${t.name}</code> <span class="t">${esc(t.title)}</span>${t.restricted ? ' <span class="badge">僅本機版</span>' : ""}</h3>
  <p>${esc(t.description)}</p>
  ${rows ? `<div class="scroll"><table><thead><tr><th>參數</th><th>型別</th><th>說明</th></tr></thead><tbody>${rows}</tbody></table></div>` : "<p><small>無參數</small></p>"}
  <details><summary>範例</summary>
  <p>MCP <code>tools/call</code> arguments：</p><pre>${esc(JSON.stringify(t.example, null, 2))}</pre>
  ${t.restricted ? "" : `<p>UTCP／HTTP：<a href="/tool/${t.name}${q ? `?${esc(q)}` : ""}"><code>GET ${esc(origin)}/tool/${t.name}${q ? `?${esc(q)}` : ""}</code></a></p>`}
  </details>
</section>`;
}

/** Human-friendly documentation of the smart tools (homepage). */
export function docsHtml(ctx: Ctx, origin: string, sourceUrl?: string): string {
  const hosted = toolsFor(false);
  const localOnly = TOOLS.filter((t) => t.restricted);
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FHL Bible Tools</title>
<meta name="description" content="信望愛站聖經資料的 MCP 與 UTCP 工具，給 AI 代理使用。">
<style>
:root { --bg:#fbfaf7; --fg:#1f2328; --muted:#5b6470; --line:#e3e0d8; --card:#ffffff; --accent:#7a4b12; --code:#f2efe8; --badge:#8a5a00; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#14161a; --fg:#e8e6e1; --muted:#a3a9b3; --line:#2c3037; --card:#1b1e23; --accent:#e0a85a; --code:#23272e; --badge:#e0a85a; } }
:root[data-theme="dark"] { --bg:#14161a; --fg:#e8e6e1; --muted:#a3a9b3; --line:#2c3037; --card:#1b1e23; --accent:#e0a85a; --code:#23272e; --badge:#e0a85a; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.65 system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "PingFang TC", sans-serif; }
main { max-width: 920px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 2rem; margin: 0 0 4px; } h2 { margin-top: 2.4em; border-bottom:1px solid var(--line); padding-bottom:.3em; }
h3 { margin: 0 0 .4em; font-size: 1.1rem; } h3 .t { color: var(--muted); font-weight: 500; }
a { color: var(--accent); } .lead { color: var(--muted); margin-top: 0; }
code, pre { font-family: ui-monospace, "Cascadia Code", Menlo, monospace; font-size: .9em; }
code { background: var(--code); padding: .1em .35em; border-radius: 4px; }
pre { background: var(--code); padding: 12px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; }
.tool, .card { background: var(--card); border:1px solid var(--line); border-radius: 10px; padding: 16px 18px; margin: 14px 0; }
.scroll { overflow-x: auto; } table { border-collapse: collapse; width: 100%; font-size: .92rem; }
th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-top: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; } td:first-child { white-space: nowrap; }
.req { color: var(--accent); font-size: .8em; } .badge { font-size: .75rem; color: var(--badge); border:1px solid var(--badge); border-radius: 999px; padding: 0 8px; vertical-align: middle; }
nav.toc { columns: 2 220px; } nav.toc a { display:block; }
small { color: var(--muted); } details summary { cursor: pointer; color: var(--accent); margin-top: 6px; }
</style>
</head>
<body>
<main>
<h1>FHL Bible Tools</h1>
<p class="lead">信望愛站聖經資料的 MCP 與 UTCP 工具：給 AI 代理用的智慧版介面，會驗證與轉換參數、跨多個 API 查詢、提供分頁。</p>

<div class="card">
<p><strong>MCP（託管）</strong>：<code>${esc(origin)}/mcp</code>（Streamable HTTP，不需驗證）</p>
<ul>
<li><strong>Claude Code</strong>：<code>claude mcp add --transport http fhl ${esc(origin)}/mcp</code></li>
<li><strong>Claude（claude.ai／Desktop）</strong>：設定 → 連接器 → 新增自訂連接器，貼上上面的網址。</li>
<li><strong>ChatGPT</strong>：Plugins → Add → Add custom MCP server，貼上網址，不需驗證（較舊版本：設定 → Apps &amp; Connectors，開啟開發者模式）。</li>
<li><strong>VS Code</strong>：<code>.vscode/mcp.json</code> 加入 <code>{"servers":{"fhl":{"type":"http","url":"${esc(origin)}/mcp"}}}</code></li>
<li><strong>Cursor</strong>：<code>~/.cursor/mcp.json</code> 加入 <code>{"mcpServers":{"fhl":{"url":"${esc(origin)}/mcp"}}}</code></li>
</ul>
<p><small>各用戶端選單名稱常會改變，以上路徑僅供參考。</small></p>
<p><strong>UTCP</strong>：manual 在 <a href="/utcp"><code>${esc(origin)}/utcp</code></a>，每個工具都是可快取的 <code>GET /tool/&lt;name&gt;</code>。</p>
<p><strong>原始 PHP API</strong>（不經本服務）：<a href="/openapi">OpenAPI 文件與 Scalar 互動說明</a>。</p>
</div>

<h2>授權與內容範圍</h2>
<p>託管服務只提供公有領域、著作權已過期，或採開放授權（GFDL、CC BY-NC-SA）的內容，例如 FHL和合本、KJV、ASV、深文理和合本、呂振中、思高、巴克禮、1933 次經、FHL 原文字典、舊約字彙分析。註釋提供信望愛站註釋（GFDL）；地點提供名稱與座標；珍本提供書目及允許自由使用的影像（GNU FDL、澳洲國家圖書館）。僅授權給信望愛站使用或授權不明的內容（多數現代譯本、新約 NA/UBS 原文、其他註釋與講道、地點說明、多數珍本影像與錄音、使徒教父、註腳、浸宣字典）不提供。每筆結果都附 <code>source</code> 授權說明，引用時請一併註明。詳見<a href="${TERMS}">信望愛站著作權宣告</a>。</p>
<div class="card">
<p><strong>本機版（全部內容）</strong>：在自己的電腦執行 stdio MCP 伺服器，直接連線信望愛站、不快取，如同自己瀏覽網站，因此預設提供全部工具與譯本。部分內容僅授權給信望愛站使用，請只供個人使用並註明出處。想套用與託管服務相同的限制，設定 <code>FHL_RESTRICTED=1</code>。</p>
<p>需要 <a href="https://nodejs.org/">Node.js</a> 26（LTS；最低 20）。</p>
<pre><code>git clone https://github.com/TimmyWong-TW/fhl-tools.git &amp;&amp; cd fhl-tools
npm install -g pnpm
pnpm install &amp;&amp; pnpm build:stdio
claude mcp add fhl -- node "$PWD/dist/stdio.mjs"</code></pre>
</div>

<h2>工具</h2>
<nav class="toc">${hosted.map((t) => `<a href="#${t.name}"><code>${t.name}</code> ${esc(t.title)}</a>`).join("")}</nav>
${hosted.map((t) => toolSection(t, origin)).join("\n")}

<h2>僅本機版提供的工具</h2>
<p>這些工具的內容僅授權給信望愛站使用或授權不明；託管服務不列出也不提供，本機版預設可用。</p>
${localOnly.map((t) => toolSection(t, origin)).join("\n")}

<p><small>資料：信望愛站 https://bible.fhl.net ・ 說明頁最後修改 ${esc(ctx.spec.lastModified ?? "未知")} ・ spec ${esc(ctx.spec.hash)}<br>
程式碼採 GNU AGPL-3.0 或更新版本${sourceUrl ? ` ・ <a href="${esc(sourceUrl)}">原始碼</a>` : ""} ・ © 2026 添美網事業（Timmy Wong Co.）・ 需要其他授權請透過 <a href="https://github.com/TimmyWong-TW">GitHub</a> 聯絡</small></p>
</main>
</body>
</html>`;
}

const SCALAR = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.75.0";

/** Scalar reference for the raw PHP API (calls go straight to bible.fhl.net). */
export function scalarHtml(spec: ApiSpec): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FHL PHP API</title>
<meta name="description" content="信望愛站聖經 PHP API 的 OpenAPI 文件與實測注意事項">
</head>
<body>
<div id="app"></div>
<script src="${SCALAR}"></script>
<script>Scalar.createApiReference('#app', { url: '/openapi.json?v=${spec.hash}', showDeveloperTools: 'never', agent: { disabled: true }, mcp: { disabled: true }, defaultHttpClient: { targetKey: 'js', clientKey: 'fetch' } })</script>
</body>
</html>`;
}
