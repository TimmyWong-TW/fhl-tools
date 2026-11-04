import { PROVIDER, TERMS } from "./licenses";
import { ToolError } from "./normalize";
import { Unauthorized, runTool, toolsFor, type Ctx } from "./tools";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
}

export function instructions(ctx: Ctx): string {
  return [
    `信望愛站聖經工具（資料來源：${PROVIDER}，說明頁最後修改 ${ctx.spec.lastModified ?? "未知"}）。`,
    "書卷可用 USFM（JHN、1MA）、和合本書名（約、約翰福音）、英文（John）或 FHL 編號。搜尋結果很多時，用回傳的 next_cursor 取下一頁。",
    ctx.unrestricted
      ? `本機模式：直接從你的電腦連線信望愛站（如同瀏覽網站）。部分譯本與資料僅授權給信望愛站使用，請僅供個人使用，引用時註明出處並遵守 ${TERMS} 。`
      : `託管模式只提供公有領域、著作權已過期或開放授權（GFDL、CC）的內容；其他內容會回報無法提供。每筆結果附 source 授權說明，引用時請一併註明。著作權宣告：${TERMS}`,
  ].join("\n");
}

export function toolList(ctx: Ctx) {
  return toolsFor(ctx.unrestricted).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  }));
}

/** Runs a tool and wraps the outcome as an MCP CallToolResult (errors are results, not RPC errors). */
export async function callTool(name: string, args: Record<string, unknown>, ctx: Ctx) {
  try {
    const data = await runTool(name, args ?? {}, ctx);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      ...(data && typeof data === "object" && !Array.isArray(data) ? { structuredContent: data } : {}),
    };
  } catch (e) {
    if (e instanceof ToolError || e instanceof Unauthorized) return { content: [{ type: "text", text: e.message }], isError: true };
    return { content: [{ type: "text", text: `上游錯誤：${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
}

/** One JSON-RPC message -> response (undefined for notifications). Transport-independent. */
export async function handleRpc(msg: RpcRequest, ctx: Ctx): Promise<object | undefined> {
  if (!msg || typeof msg !== "object" || msg.id === undefined) return undefined;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "fhl-bible-tools", title: "FHL Bible Tools", version: `1.0.0+${ctx.spec.hash}` },
        instructions: instructions(ctx),
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: toolList(ctx) });
    case "tools/call":
      return ok(await callTool(String(msg.params?.name ?? ""), msg.params?.arguments ?? {}, ctx));
    case "resources/list":
      return ok({ resources: [] });
    case "prompts/list":
      return ok({ prompts: [] });
    default:
      return err(-32601, `Method not found: ${msg.method}`);
  }
}

/** Stateless Streamable HTTP transport: JSON responses only, no SSE, no sessions. */
export async function handleMcpHttp(req: Request, ctx: Ctx): Promise<Response> {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const batch = Array.isArray(body);
  const out = (await Promise.all(((batch ? body : [body]) as RpcRequest[]).map((m) => handleRpc(m, ctx)))).filter(Boolean);
  if (!out.length) return new Response(null, { status: 202 });
  return Response.json(batch ? out : out[0]);
}
