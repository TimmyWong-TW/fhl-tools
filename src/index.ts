import { docsHtml, scalarHtml, utcpManual } from "./manuals";
import { handleMcpHttp } from "./mcp";
import { ToolError } from "./normalize";
import { openApi } from "./openapi";
import generated from "./spec.generated.json";
import { TOOLS, Unauthorized, edgeUpstream, runTool, type Ctx } from "./tools";
import type { ApiSpec } from "./types";

const full = generated as unknown as ApiSpec;
/** The raw PHP API documentation never lists endpoints licensed only to FHL. */
const publicSpec: ApiSpec = { ...full, endpoints: full.endpoints.filter((e) => !e.restricted) };
const upstream = edgeUpstream();
/** Anonymous hosted service: only public-domain / expired / openly licensed content. */
const ctx: Ctx = { spec: full, upstream, unrestricted: false };
/** FHL's own pages get everything, as with the local server. */
const fullCtx: Ctx = { spec: full, upstream, unrestricted: true };

/** Pages on FHL's own site (browsers set Origin; page scripts cannot forge it) are unrestricted; others are anonymous. */
function contextFor(req: Request, env: Env): Ctx {
  const origin = req.headers.get("origin");
  const trusted = (env.UNRESTRICTED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return origin && trusted.includes(origin) ? fullCtx : ctx;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id, etag",
  vary: "Origin",
};

function withCors(res: Response): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
}

/** 32-bit FNV-1a, hex: a cheap content hash for ETags. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

/**
 * Generated documents. Rendering is cheap, so there is no server-side cache: the ETag is a hash
 * of the rendered body, so a code change (docs, tools) is never masked by a stale cached copy.
 */
function derived(req: Request, contentType: string, build: () => string): Response {
  const body = build();
  const etag = `"${fnv(body)}"`;
  const headers = { "content-type": contentType, "cache-control": "public, max-age=300, stale-while-revalidate=3600", etag };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}

const json = (v: unknown) => JSON.stringify(v, null, 2);
const JSON_CT = "application/json; charset=utf-8";

/** Smart tool over HTTP GET (what UTCP calls): query params -> tool args; cacheable. */
async function toolGet(name: string, url: URL, ctx: Ctx): Promise<Response> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return Response.json({ error: "unknown_tool", message: `未知工具：${name}` }, { status: 404 });
  const args: Record<string, unknown> = {};
  for (const k of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(k);
    args[k] = all.length > 1 ? all : all[0];
  }
  try {
    const data = await runTool(name, args, ctx);
    return Response.json(data, { headers: { "cache-control": ctx.unrestricted ? "private, no-store" : "public, max-age=3600" } });
  } catch (e) {
    if (e instanceof Unauthorized)
      return Response.json(
        { error: "unauthorized", message: e.message },
        { status: 401, headers: { "www-authenticate": 'Bearer realm="fhl-tools", error="invalid_token"' } },
      );
    if (e instanceof ToolError) return Response.json({ error: "bad_request", message: e.message }, { status: 400 });
    return Response.json({ error: "upstream_error", message: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

interface Env {
  /** Where users can get this deployment's source (AGPL-3.0 §13). */
  SOURCE_URL?: string;
  /** Comma-separated browser origins (FHL's own pages) that get unrestricted content without a token. */
  UNRESTRICTED_ORIGINS?: string;
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  const origin = url.origin;

  if (url.pathname === "/mcp" || url.pathname.startsWith("/tool/")) {
    const who = contextFor(req, env);
    if (url.pathname === "/mcp") return handleMcpHttp(req, who);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    return toolGet(decodeURIComponent(url.pathname.slice(6)), url, who);
  }
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD, POST, OPTIONS" } });

  switch (url.pathname) {
    case "/":
      return derived(req, "text/html; charset=utf-8", () => docsHtml(ctx, origin, env.SOURCE_URL));
    case "/utcp":
      return derived(req, JSON_CT, () => json(utcpManual(ctx, origin)));
    case "/openapi":
    case "/openapi/":
      return derived(req, "text/html; charset=utf-8", () => scalarHtml(publicSpec));
    case "/openapi.json":
      return derived(req, JSON_CT, () => json(openApi(publicSpec, origin)));
    case "/spec.json":
      return derived(req, JSON_CT, () => json(publicSpec));
    case "/index.json":
      return Response.json({
        name: "FHL Bible Tools",
        docs: `${origin}/`,
        mcp: `${origin}/mcp`,
        utcp: `${origin}/utcp`,
        tool: `${origin}/tool/<name>`,
        openapi: `${origin}/openapi`,
        openapi_json: `${origin}/openapi.json`,
        source_code: env.SOURCE_URL || undefined,
        license: "AGPL-3.0-or-later",
        docsLastModified: full.lastModified,
        specHash: full.hash,
      });
  }
  return new Response("Not Found", { status: 404 });
}

export default {
  async fetch(req, env) {
    const res = withCors(await route(req, env));
    return req.method === "HEAD" ? new Response(null, res) : res;
  },
} satisfies ExportedHandler<Env>;
