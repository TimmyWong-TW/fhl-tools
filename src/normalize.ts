import type { Book, Version } from "./types";
import { BID_BOUNDS, type BookSet } from "./usfm";

/** Thrown for bad input; becomes an MCP `isError` result / HTTP 400 with this message. */
export class ToolError extends Error {}

export const nfkc = (s: string) => s.normalize("NFKC").trim();
const squash = (s: string) => nfkc(s).toLowerCase().replace(/[\s_\-.·・]/g, "");

export function corpusOf(bid: number): BookSet {
  return bid >= 201 ? "fathers" : bid >= 101 ? "apocrypha" : "canon";
}

/**
 * Any book identifier -> Book: USFM (JHN, 1MA), CUV short/full name (約, 約翰福音), FHL/English
 * name (John, Jn, 1 Clem.), or FHL number (43, 101, 201). Canon wins on ambiguous aliases (e.g. "Re").
 */
export function resolveBook(raw: unknown, books: Book[], only?: BookSet[]): Book {
  const pool = only ? books.filter((b) => only.includes(corpusOf(b.bid))) : books;
  const v = nfkc(String(raw ?? ""));
  if (!v) throw new ToolError("缺少書卷（book）");
  const n = /^\d+$/.test(v) ? Number(v) : undefined;
  const s = squash(v);
  const hit =
    pool.find((b) => n !== undefined && b.bid === n) ??
    pool.find((b) => b.usfm && b.usfm === v.toUpperCase()) ??
    pool.find((b) => [b.chineses, b.chinesef, b.engs, b.engf, ...b.aliases].some((x) => x && squash(x) === s));
  if (hit) return hit;
  const where = only?.length === 1 && only[0] === "fathers" ? "201-217" : "USFM（如 JHN、1MA）、和合本書名（約、約翰福音）、英文（John）或編號";
  throw new ToolError(`找不到書卷：${v}。請用 ${where}；完整清單見 list_books`);
}

export const bookName = (b: Book) => b.chinesef ?? b.chineses;

export function toInt(raw: unknown, what: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const s = nfkc(String(raw ?? "")).replace(/^第/, "").replace(/[章節节卷頁页筆笔]$/, "");
  const n = /^\d+$/.test(s) ? Number(s) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) throw new ToolError(`${what} 必須是 ${min}-${max === Number.MAX_SAFE_INTEGER ? "∞" : max} 的整數（收到 ${raw}）`);
  return n;
}

/** "16", "1-5", "1,5,6", "1-2,5", also "1–5", "１~５", "1至5", "1、3" (the qb.php grammar). */
export function toVerses(raw: unknown): string {
  const s = nfkc(String(raw))
    .replace(/[~〜～–—―至到]/g, "-")
    .replace(/[、;；]/g, ",")
    .replace(/[節节\s]/g, "");
  if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(s)) throw new ToolError(`verses 格式無效：${raw}（例：16、1-5、1,5,6、1-2,5）`);
  return s;
}

const TRUE = ["true", "1", "yes", "y", "on", "是", "要", "有"];
const FALSE = ["false", "0", "no", "n", "off", "否", "不要", "無", ""];
export function toBool(raw: unknown, what: string): boolean {
  if (raw === undefined || raw === null) return false;
  if (typeof raw === "boolean") return raw;
  const s = nfkc(String(raw)).toLowerCase();
  if (TRUE.includes(s)) return true;
  if (FALSE.includes(s)) return false;
  throw new ToolError(`${what} 必須是 true 或 false（收到 ${raw}）`);
}

/** Bible text version: code (case-insensitive) or name (和合本2010, KJV, FHL和合本 / 和合本). */
export function toVersion(raw: unknown, versions: Version[], fallback = "unv"): Version {
  const v = nfkc(String(raw ?? fallback));
  const strip = (n: string) => squash(n.replace(/^FHL/i, ""));
  const hit = versions.find((x) => x.code === v.toLowerCase()) ?? versions.find((x) => x.name && strip(x.name) === strip(v));
  if (!hit) throw new ToolError(`找不到譯本：${v}。請用代碼（unv、kjv、rcuv、ncv、cumv…）或名稱（和合本2010…）；完整清單見 list_versions`);
  return hit;
}

/** Case/space-insensitive match against a list of choices (with optional synonyms). */
export function toChoice<T extends string>(raw: unknown, what: string, choices: Record<T, string[]>, fallback?: T): T {
  if ((raw === undefined || raw === null || raw === "") && fallback) return fallback;
  const s = squash(String(raw));
  for (const [key, syn] of Object.entries(choices) as [T, string[]][])
    if (squash(key) === s || syn.some((x) => squash(x) === s)) return key;
  throw new ToolError(`${what} 無效：${raw}。可用值：${Object.keys(choices).join("、")}`);
}

export function toList(raw: unknown): string[] {
  if (raw === undefined || raw === null || raw === "") return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(/[,，、;；]/);
  return arr.map((x) => nfkc(String(x))).filter(Boolean);
}

/** Contiguous runs of FHL book ids, e.g. [40,41,42,43,45] -> [[40,43],[45,45]]. */
export function runs(bids: number[]): [number, number][] {
  const sorted = [...new Set(bids)].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b === last[1] + 1 && corpusOf(b) === corpusOf(last[1])) last[1] = b;
    else out.push([b, b]);
  }
  return out;
}

export function inCorpus(bid: number, set: BookSet): boolean {
  const [lo, hi] = BID_BOUNDS[set];
  return bid >= lo && bid <= hi;
}

/** Opaque, stateless pagination cursor (base64url JSON). Tampering only changes what is queried. */
export function encodeCursor(state: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor<T>(cursor: string): T {
  try {
    const bin = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as T;
  } catch {
    throw new ToolError("cursor 無效；請重新搜尋（不要修改 cursor）");
  }
}

type Prop = { type?: string | string[]; items?: { type?: string } };

/**
 * Coerces loosely typed input (query strings from /tool, or sloppy LLM JSON) to the input schema:
 * keys case-/underscore-insensitive, "3" -> 3, "true" -> true, "GEN,JHN" -> ["GEN","JHN"].
 * Unknown keys are rejected with the list of valid ones.
 */
export function coerce(args: Record<string, unknown>, schema: { properties: Record<string, Prop>; required?: string[] }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = Object.keys(schema.properties);
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    const key = keys.find((x) => x === k) ?? keys.find((x) => squash(x) === squash(k));
    if (!key) throw new ToolError(`未知參數 ${k}。可用參數：${keys.join("、")}`);
    const p = schema.properties[key];
    const types = ([] as string[]).concat(p.type ?? []);
    if (types.includes("array")) out[key] = toList(v);
    else if (types.includes("boolean") && !types.includes("string")) out[key] = toBool(v, key);
    else if (types.includes("integer") && !types.includes("string") && typeof v === "string") out[key] = toInt(v, key);
    else out[key] = v;
  }
  for (const r of schema.required ?? []) if (out[r] === undefined) throw new ToolError(`缺少必要參數 ${r}`);
  return out;
}
