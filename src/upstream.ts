import { UPSTREAM_BASE } from "./scaffold";
import type { EndpointSpec, ResponseFormat } from "./types";

export type Args = Record<string, unknown>;

/**
 * Probe helper: args -> upstream query in the documented case, enum labels -> codes.
 * (The LLM-facing smart layer lives in tools.ts / normalize.ts.)
 */
function findParam(ep: EndpointSpec, k: string) {
  return (
    ep.params.find((x) => x.key === k) ??
    ep.params.find((x) => x.name === k) ??
    ep.params.find((x) => x.name.toLowerCase() === k.toLowerCase())
  );
}

export function buildQuery(ep: EndpointSpec, args: Args): URLSearchParams {
  const qs = new URLSearchParams();
  const fills: [string, string][] = [];
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    const p = findParam(ep, k);
    let value = p?.fills ? String(v).trim().toUpperCase() : String(v);
    if (p?.type === "boolean" && (v === true || v === false || value === "true" || value === "false")) {
      value = v === true || value === "true" ? "1" : "0";
    } else if (p?.enum) {
      const hit = p.enum.find((o) => o.label === value) ?? p.enum.find((o) => o.code === value);
      if (hit) value = hit.code;
    }
    if (p?.fills) fills.push([p.fills, value]);
    else qs.set(p?.name ?? k, value);
  }
  for (const [target, value] of fills) if (!qs.has(target)) qs.set(target, value);
  for (const [k, v] of Object.entries(ep.inject ?? {})) if (!qs.has(k)) qs.set(k, v);
  return qs;
}

/** Pass-through: the caller's query string, untouched. */
export function rawUpstreamUrl(ep: EndpointSpec, search: string): string {
  return UPSTREAM_BASE + ep.file + search;
}

export function upstreamUrl(ep: EndpointSpec, args: Args): string {
  const qs = buildQuery(ep, args).toString();
  return UPSTREAM_BASE + ep.file + (qs ? `?${qs}` : "");
}

export function sniffFormat(text: string, contentType = ""): ResponseFormat {
  const t = text.replace(/^﻿/, "").trimStart();
  if (/json/i.test(contentType) || t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      /* fall through */
    }
  }
  if (t.startsWith("<?xml") || /^<result[\s>]/i.test(t)) return "xml";
  if (/^[^<\n]*,[^<\n]*\n/.test(t) && !/<html/i.test(t)) return "csv";
  return "text";
}

/** Minimal XML -> object for the flat `<result><record>..</record></result>` shape the docs describe. */
export function xmlToJson(xml: string): Record<string, unknown> {
  const body = xml.replace(/<\?xml[^>]*\?>/, "").match(/<result[^>]*>([\s\S]*)<\/result>/i)?.[1] ?? xml;
  const leaf = (s: string) => {
    const o: Record<string, string> = {};
    for (const m of s.matchAll(/<(\w+)[^>]*>([\s\S]*?)<\/\1>/g)) o[m[1]] = m[2].trim();
    return o;
  };
  const record = [...body.matchAll(/<record(?:\s[^>]*)?>([\s\S]*?)<\/record>/gi)].map((m) => leaf(m[1]));
  const top = leaf(body.replace(/<record(?:\s[^>]*)?>[\s\S]*?<\/record>/gi, ""));
  return { ...top, record };
}

export function csvToJson(text: string, columns?: string[]): Record<string, unknown> {
  const rows = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(",").map((c) => c.trim()));
  const record = columns ? rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ""]))) : rows;
  return { record_count: rows.length, record };
}

export interface UpstreamResult {
  url: string;
  status: number;
  contentType: string;
  format: ResponseFormat;
  /** Object for json/csv/xml, string for text. */
  data: unknown;
  raw: string;
}

export function convert(ep: EndpointSpec, raw: string, contentType: string): { format: ResponseFormat; data: unknown } {
  const format = sniffFormat(raw, contentType);
  const t = raw.replace(/^﻿/, "");
  if (format === "json") return { format, data: JSON.parse(t) };
  if (format === "xml") return { format, data: xmlToJson(t) };
  if (format === "csv" || ep.responseFormat === "csv") return { format: "csv", data: csvToJson(t, ep.csvColumns) };
  return { format, data: t };
}

export async function callUpstream(
  ep: EndpointSpec,
  args: Args,
  init: RequestInit & { cf?: Record<string, unknown> } = {},
): Promise<UpstreamResult> {
  const url = upstreamUrl(ep, args);
  const res = await fetch(url, { headers: { accept: "application/json, text/*;q=0.8" }, ...init });
  const raw = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  const { format, data } = convert(ep, raw, contentType);
  return { url, status: res.status, contentType, format, data, raw };
}
