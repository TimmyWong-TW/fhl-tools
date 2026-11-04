import type { EndpointSpec, EnumOption, ParamSpec } from "./types";

export const DOCS_URL = "https://bible.fhl.net/api/";
export const UPSTREAM_BASE = "https://bible.fhl.net/api/";

const INT_NAMES = new Set(["bid", "chap", "limit", "offset", "range_bid", "range_eid", "page", "id"]);

export interface ParsedPage {
  title: string;
  notice: string;
  endpoints: Omit<EndpointSpec, "responseFormat" | "confirmed">[];
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** HTML fragment -> plain text; tables become `a: b` lines. */
export function toText(html: string): string {
  return decode(
    html
      .replace(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi, "\n$1: $2")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

function tableRows(tableHtml: string): [string, string][] {
  const rows: [string, string][] = [];
  const re = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  for (const m of tableHtml.matchAll(re)) rows.push([toText(m[1]), toText(m[2])]);
  return rows;
}

function cleanLabel(raw: string): { label: string; isDefault: boolean } {
  const isDefault = /內定|預設/.test(raw);
  const label = raw
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[，,。;；]+$/, "")
    .trim();
  return { label, isDefault };
}

/** Extracts `0:正體 1:簡體`, `0：全部`, `0.和合本` style enums from a description. */
export function parseEnum(desc: string): { options: EnumOption[]; defaultCode?: string } {
  const options: EnumOption[] = [];
  let defaultCode: string | undefined;
  const re = /(?:^|[\s，,])(\d+)\s*[:：.]\s*([^\s:：]+?)(?=\s|$|[，,]\s*\d+\s*[:：.])/g;
  for (const m of desc.matchAll(re)) {
    const { label, isDefault } = cleanLabel(m[2]);
    if (!label || /^default$/i.test(label) || /^[\d\-]/.test(label)) continue;
    if (options.some((o) => o.code === m[1])) continue;
    options.push({ code: m[1], label });
    if (isDefault) defaultCode = m[1];
  }
  const seen = new Map<string, number>();
  for (const o of options) seen.set(o.label, (seen.get(o.label) ?? 0) + 1);
  for (const o of options) if ((seen.get(o.label) ?? 0) > 1) o.label = `${o.label}(${o.code})`;
  return { options, defaultCode };
}

export function parseDefault(desc: string): string | undefined {
  const m = desc.match(/default\s*[:：]\s*([^\s，,]+)/i);
  if (!m) return undefined;
  const v = m[1];
  if (/^unlimited$/i.test(v)) return undefined;
  const paren = v.match(/[（(]([^）)]+)[）)]/);
  return paren ? paren[1] : v;
}

/** A 0/1 enum (gb, strong, count_only, ...) is exposed as a boolean: true -> "1", false -> "0". */
export function isBinary(options: EnumOption[]): boolean {
  return options.length === 2 && options.some((o) => o.code === "0") && options.some((o) => o.code === "1");
}

function buildParam(name: string, description: string): Omit<ParamSpec, "key"> {
  const { options, defaultCode } = parseEnum(description);
  const lower = name.toLowerCase();
  const p: Omit<ParamSpec, "key"> = {
    name,
    description,
    type: options.length ? (isBinary(options) ? "boolean" : "string") : INT_NAMES.has(lower) ? "integer" : "string",
  };
  const def = parseDefault(description) ?? defaultCode;
  if (def !== undefined) p.default = def;
  if (options.length) p.enum = options;
  return p;
}

function assignKeys(params: Omit<ParamSpec, "key">[]): ParamSpec[] {
  const lowerCount = new Map<string, number>();
  for (const p of params) lowerCount.set(p.name.toLowerCase(), (lowerCount.get(p.name.toLowerCase()) ?? 0) + 1);
  return params.map((p) => ({ ...p, key: (lowerCount.get(p.name.toLowerCase()) ?? 0) > 1 ? p.name : p.name.toLowerCase() }));
}

export function toolName(file: string): string {
  return "fhl_" + file.replace(/\.[a-z]+$/i, "").replace(/[^A-Za-z0-9_]/g, "_");
}

function parseParams(chunk: string): Omit<ParamSpec, "key">[] {
  const idx = chunk.indexOf("接受參數");
  if (idx < 0) return [];
  const after = chunk.slice(idx).replace(/^接受參數\s*[:：]?/, "");
  // Inline text up to the first <br>, <table> or 輸出 decides the shape.
  const inline = toText(after.split(/<br\s*\/?>|<table|輸出/i)[0] ?? "").trim();
  if (inline === "無") return [];
  if (inline) {
    const m = inline.match(/^([A-Za-z_]\w*)\s*[:：]\s*([\s\S]*)$/);
    return m ? [buildParam(m[1], m[2].trim())] : [];
  }
  const tableStart = after.search(/<table/i);
  const outIdx = after.indexOf("輸出");
  if (tableStart < 0 || (outIdx >= 0 && outIdx < tableStart)) return [];
  const tableEnd = after.indexOf("</table>", tableStart);
  return tableRows(after.slice(tableStart, tableEnd)).map(([n, d]) => buildParam(n.trim(), d));
}

export async function parseApiPage(html: string): Promise<ParsedPage> {
  const title = toText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "信望愛站聖經 JSON API");
  const chunks = html.split(/<section[^>]*>/i);
  let notice = "";
  const endpoints: ParsedPage["endpoints"] = [];
  for (const raw of chunks.slice(1)) {
    // Sections are not always closed; cut at the next structural close tag.
    const chunk = raw.split(/<\/section>|<\/article>/i)[0];
    const nameMatch = chunk.match(/名稱\s*[:：]\s*([A-Za-z0-9_.\-]+)/);
    if (!nameMatch) {
      const t = toText(chunk);
      if (t && !notice) notice = t;
      continue;
    }
    const file = nameMatch[1];
    const purpose = toText(chunk.match(/用途\s*[:：]([\s\S]*?)(?:<br\s*\/?>|接受參數)/)?.[1] ?? "").replace(/\n/g, " ");
    const outIdx = chunk.search(/輸出\s*[:：]/);
    // ab.php has no 輸出 label: fall back to everything after the 接受參數 line.
    const output =
      outIdx >= 0
        ? toText(chunk.slice(outIdx).replace(/^輸出\s*[:：]/, ""))
        : toText(chunk.slice(chunk.indexOf("接受參數")).replace(/^[^<]*<br\s*\/?>/i, ""));
    const normalized = toText(chunk).replace(/\s+/g, "");
    endpoints.push({
      file,
      tool: toolName(file),
      purpose,
      output,
      params: assignKeys(parseParams(chunk)),
      sectionHash: await sha256(normalized),
    });
  }
  return { title, notice, endpoints };
}
