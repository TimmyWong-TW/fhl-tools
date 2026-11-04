import {
  ToolError,
  bookName,
  coerce,
  corpusOf,
  decodeCursor,
  encodeCursor,
  inCorpus,
  nfkc,
  resolveBook,
  runs,
  toBool,
  toChoice,
  toInt,
  toList,
  toVerses,
  toVersion,
} from "./normalize";
import {
  APOCRYPHA_LICENSE,
  DEFAULT_COMMENTARY,
  OPEN_COMMENTARIES,
  OPEN_RECORDINGS,
  OPEN_VERSIONS,
  OT_PARSING_LICENSE,
  PLACES_LICENSE,
  STRONGS_LICENSE,
  TOPICS_LICENSE,
  rareBookLicense,
  source,
  type License,
} from "./licenses";
import { UPSTREAM_BASE } from "./scaffold";
import type { ApiSpec, Book } from "./types";
import { convert } from "./upstream";
import { usfmOf } from "./usfm";

/**
 * Smart, task-oriented tools for LLMs (MCP /mcp and UTCP /utcp). Hand-written on top of the
 * scaffolded spec: each may call several PHP endpoints, validates and converts input, and
 * returns clean, unambiguous output. The PHP API itself is documented (not proxied) by /openapi.
 */

export interface Upstream {
  /** GET a PHP endpoint with an exact query (documented names/casing); returns parsed body. */
  get(file: string, query: Record<string, string | number>): Promise<{ url: string; data: any }>;
}

export interface Ctx {
  spec: ApiSpec;
  upstream: Upstream;
  /** Local stdio server (default; FHL_RESTRICTED=1 turns it off): everything is served. Hosted: false. */
  unrestricted?: boolean;
}

/** Content we may not serve from the hosted service (licensed only to FHL, or licence unclear). */
export class Unauthorized extends Error {}

function gate(ctx: Ctx, allowed: boolean, what: string): void {
  if (!allowed && !ctx.unrestricted)
    throw new Unauthorized(`${what} 僅授權給信望愛站使用或授權不明，託管服務不提供（在自己電腦上執行本機版即可供個人使用，見說明頁）。`);
}

const UNLICENSED: License = { status: "open-license", notice: "依信望愛站授權（僅供使用者本人於本機使用；見著作權宣告）" };
const versionLicense = (code: string) => OPEN_VERSIONS[code] ?? UNLICENSED;

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, any>; required?: string[]; additionalProperties?: boolean };
  /** Example arguments, shown in the docs page. */
  example: Record<string, unknown>;
  /** Whole tool not servable by the hosted service: unlisted there, calls answer 401. */
  restricted?: boolean;
  run(args: Record<string, any>, ctx: Ctx): Promise<unknown>;
}

const SCRIPT = { simplified: { type: "boolean", default: false, description: "true＝簡體輸出（輸入也要用簡體）" } };
const BOOK = {
  type: ["string", "integer"],
  description: "書卷：USFM（JHN、1MA）、和合本書名（約、約翰福音）、英文（John）或 FHL 編號（43；次經 101-115；使徒教父 201-217）",
};
const CANON_BOOK = { ...BOOK, description: "書卷（正典）：USFM（JHN）、和合本書名（約、約翰福音）、英文（John）或編號 1-66" };

const gb = (a: Record<string, any>) => (toBool(a.simplified, "simplified") ? 1 : 0);
const fail = (data: any) => typeof data?.status === "string" && data.status !== "success";
const usfm = (bid: number) => usfmOf(bid) ?? String(bid);

function ok<T>(data: any, what: string): T {
  if (fail(data)) throw new ToolError(`${what}失敗：${data.status}`);
  return data as T;
}

function verseOut(r: any, books: Book[]) {
  const b = books.find((x) => x.bid === r.bid || x.engs === r.engs);
  return {
    book: b ? usfm(b.bid) : r.engs,
    book_name: b ? bookName(b) : r.chineses,
    chapter: r.chap,
    verse: r.sec,
    text: r.bible_text,
  };
}

function navOut(n: any, books: Book[]) {
  if (!n || typeof n !== "object" || n.chap === undefined) return undefined;
  const b = books.find((x) => x.bid === n.bid || x.engs === n.engs);
  return { book: b ? usfm(b.bid) : n.engs, book_name: b ? bookName(b) : n.chineses, chapter: n.chap, verse: n.sec };
}

// ---------------------------------------------------------------- passages

const readPassage: ToolDef = {
  name: "read_passage",
  title: "讀經文",
  description:
    "讀取一段經文（正典、次經或使徒教父，依書卷自動選擇）。例：約翰福音 3:16 → {book:\"JHN\", chapter:3, verses:\"16\"}。不給 verses 則讀整章。跨章或多段請用 lookup_reference（如 \"約3:35-4:2\"、\"約3-4\"）。",
  inputSchema: {
    type: "object",
    properties: {
      book: BOOK,
      chapter: { type: "integer", minimum: 1, description: "章" },
      verses: { type: "string", description: "節：16、1-5、1,5,6、1-2,5；省略＝整章" },
      version: { type: "string", default: "unv", description: "譯本代碼或名稱（unv＝和合本、kjv、rcuv＝和合本2010…，見 list_versions）。僅正典適用" },
      strong: { type: "boolean", default: false, description: "附 Strong 編號（需譯本支援）" },
      ...SCRIPT,
    },
    required: ["book", "chapter"],
    additionalProperties: false,
  },
  example: { book: "JHN", chapter: 3, verses: "16" },
  async run(a, ctx) {
    const { spec, upstream } = ctx;
    const b = resolveBook(a.book, spec.books);
    const chap = toInt(a.chapter, "chapter", 1, 200);
    const q: Record<string, string | number> = { bid: b.bid, chap, gb: gb(a) };
    if (a.verses !== undefined) q.sec = toVerses(a.verses);
    const set = corpusOf(b.bid);
    let file = "qb.php";
    let version: { code: string; name: string } | undefined;
    if (set === "canon") {
      version = toVersion(a.version, spec.versions);
      gate(ctx, !!OPEN_VERSIONS[version.code], `譯本 ${version.name}（${version.code}）`);
      q.version = version.code;
      if (toBool(a.strong, "strong")) q.strong = 1;
    } else {
      if (a.version !== undefined) throw new ToolError(`${bookName(b)} 只有一個版本，不需指定 version`);
      gate(ctx, set === "apocrypha", "使徒教父經文");
      file = set === "apocrypha" ? "qsub.php" : "qaf.php";
    }
    const { data } = await upstream.get(file, q);
    const d: any = ok(data, "讀取經文");
    const verses = (d.record ?? []).map((r: any) => ({ verse: r.sec, text: r.bible_text }));
    if (!verses.length) throw new ToolError(`找不到經文：${bookName(b)} ${chap}${q.sec ? `:${q.sec}` : ""}（章節可能超出範圍）`);
    return {
      reference: `${bookName(b)} ${chap}${q.sec ? `:${q.sec}` : ""}`,
      book: usfm(b.bid),
      book_name: bookName(b),
      chapter: chap,
      version: version ? { code: version.code, name: version.name } : { code: d.version, name: d.v_name },
      verses,
      prev: navOut(d.prev, spec.books),
      next: navOut(d.next, spec.books),
      source: source(version ? versionLicense(version.code) : set === "apocrypha" ? APOCRYPHA_LICENSE : UNLICENSED),
    };
  },
};

/** FHL reads "約3-4" as chapter 3 only; rewrite whole-chapter ranges as "約3;4" (which it does honour). */
export function expandChapterRanges(qstr: string): string {
  return qstr
    .split(";")
    .map((seg) => {
      const m = seg.match(/^(\s*\D*?\s*)(\d+)\s*[-–~]\s*(\d+)\s*$/);
      if (!m) return seg;
      const [lo, hi] = [Number(m[2]), Number(m[3])];
      if (hi <= lo) return seg;
      if (hi - lo > 49) throw new ToolError(`章數範圍太大：${seg.trim()}（最多 50 章）`);
      return `${m[1]}${Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).join(";")}`;
    })
    .join(";");
}

const lookupReference: ToolDef = {
  name: "lookup_reference",
  title: "查經文出處",
  description: "用經文出處字串查經文，可一次多段、可跨章。例：\"約3:16;羅5:8\"、\"約3:35-4:2\"、\"約3-4\"（整章）、\"John 3:16\"。僅正典。",
  inputSchema: {
    type: "object",
    properties: {
      reference: { type: "string", description: "出處：約3:16、約 3:16-18;羅5:8、John 3:16（中英文書名皆可，多段以 ; 分隔；跨章 約3:35-4:2；整章範圍 約3-4）" },
      version: { type: "string", default: "unv", description: "譯本代碼或名稱（見 list_versions）" },
      strong: { type: "boolean", default: false, description: "附 Strong 編號" },
      ...SCRIPT,
    },
    required: ["reference"],
    additionalProperties: false,
  },
  example: { reference: "約3:16;羅5:8" },
  async run(a, ctx) {
    const { spec, upstream } = ctx;
    const version = toVersion(a.version, spec.versions);
    gate(ctx, !!OPEN_VERSIONS[version.code], `譯本 ${version.name}（${version.code}）`);
    const qstr = expandChapterRanges(nfkc(String(a.reference)).replace(/[#|]/g, "").replace(/；/g, ";"));
    const q: Record<string, string | number> = { qstr, version: version.code, gb: gb(a) };
    if (toBool(a.strong, "strong")) q.strong = 1;
    const { data } = await upstream.get("qsb.php", q);
    const d: any = ok(data, "查詢出處");
    const verses = (d.record ?? []).map((r: any) => verseOut(r, spec.books));
    if (!verses.length) throw new ToolError(`找不到「${qstr}」。格式例：約3:16、約 3:16-18;羅5:8、John 3:16`);
    return { reference: qstr, version: { code: version.code, name: version.name }, verses, source: source(versionLicense(version.code)) };
  },
};

// ---------------------------------------------------------------- search

type Corpus = "bible" | "apocrypha" | "fathers";
const CORPUS: Record<Corpus, { file: string; set: "canon" | "apocrypha" | "fathers" }> = {
  bible: { file: "se.php", set: "canon" },
  apocrypha: { file: "sesub.php", set: "apocrypha" },
  fathers: { file: "seaf.php", set: "fathers" },
};

interface Source {
  corpus: Corpus;
  query: Record<string, string | number>;
  label: string;
  count: number;
}
interface SearchState {
  v: 1;
  sources: Source[];
  size: number;
  /** current source index and offset within it */
  s: number;
  o: number;
}

const MAX_SOURCES = 8;

async function countOf(upstream: Upstream, file: string, query: Record<string, string | number>): Promise<number> {
  // Without `limit`, count_only reports the true total even above 500 (as a "Fail: record count > 500").
  const { data } = await upstream.get(file, { ...query, count_only: 1 });
  const n = Number((data as any)?.record_count);
  if (!Number.isFinite(n)) throw new ToolError(`搜尋計數失敗：${(data as any)?.status ?? "未知錯誤"}`);
  return n;
}

const searchText: ToolDef = {
  name: "search_text",
  title: "搜尋經文",
  description:
    "用關鍵字（或 Strong 編號）搜尋經文，可跨正典、次經、使徒教父，可限定書卷或新舊約。回傳總筆數與分頁；要下一頁時只傳 cursor。",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "關鍵字；mode=greek/hebrew 時為 Strong 編號（如 25）" },
      corpus: {
        type: "array",
        items: { type: "string", enum: ["bible", "apocrypha", "fathers"] },
        default: ["bible"],
        description: "搜尋範圍：bible＝正典、apocrypha＝次經、fathers＝使徒教父；有給 books 時自動推定",
      },
      books: { type: "array", items: { type: "string" }, description: "限定書卷（可不連續）：USFM 代碼或中英文書名，如 [\"MAT\",\"MRK\",\"LUK\",\"JHN\"]、[\"約\",\"羅\"]" },
      testament: { type: "string", enum: ["all", "OT", "NT"], default: "all", description: "all＝不限、OT＝舊約、NT＝新約（僅正典）" },
      mode: { type: "string", enum: ["text", "greek", "hebrew"], default: "text", description: "text＝經文關鍵字；greek／hebrew＝原文 Strong 編號（僅正典）" },
      version: { type: "string", default: "unv", description: "正典譯本（見 list_versions）" },
      page_size: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "每頁筆數" },
      cursor: { type: "string", description: "上一頁回傳的 next_cursor；給了就只看 cursor" },
      ...SCRIPT,
    },
    additionalProperties: false,
  },
  example: { query: "愛", books: ["MAT", "MRK", "LUK", "JHN"], page_size: 5 },
  async run(a, ctx) {
    const { spec, upstream } = ctx;
    let st: SearchState;
    if (a.cursor) {
      st = decodeCursor<SearchState>(String(a.cursor));
      if (st?.v !== 1 || !Array.isArray(st.sources)) throw new ToolError("cursor 無效；請重新搜尋");
    } else {
      if (!a.query) throw new ToolError("缺少 query");
      const mode = toChoice<"text" | "greek" | "hebrew">(a.mode, "mode", { text: ["keyword", "經文"], greek: ["g", "希臘文"], hebrew: ["h", "希伯來文"] }, "text");
      const size = a.page_size === undefined ? 20 : toInt(a.page_size, "page_size", 1, 100);
      const bookIds = toList(a.books).map((x) => resolveBook(x, spec.books).bid);
      const t = toChoice<"all" | "OT" | "NT">(a.testament, "testament", { all: ["全部", "both", "any"], OT: ["舊約", "old"], NT: ["新約", "new"] }, "all");
      const testament = t === "all" ? undefined : t;
      let corpora = toList(a.corpus).map((c) =>
        toChoice(c, "corpus", { bible: ["正典", "聖經", "canon"], apocrypha: ["次經"], fathers: ["使徒教父", "apostolic fathers"] }),
      );
      if (!corpora.length) corpora = bookIds.length ? [...new Set(bookIds.map((b) => (({ canon: "bible", apocrypha: "apocrypha", fathers: "fathers" }) as const)[corpusOf(b)]))] : ["bible"];
      if (mode !== "text" && corpora.some((c) => c !== "bible")) throw new ToolError("mode=greek/hebrew 只適用於正典（corpus=bible）");
      const version = toVersion(a.version, spec.versions);
      if (corpora.includes("bible")) gate(ctx, !!OPEN_VERSIONS[version.code], `譯本 ${version.name}（${version.code}）`);
      if (corpora.includes("fathers")) gate(ctx, false, "使徒教父經文");
      const q = nfkc(String(a.query));
      const sources: Omit<Source, "count">[] = [];
      for (const c of (["bible", "apocrypha", "fathers"] as Corpus[]).filter((x) => corpora.includes(x))) {
        const base: Record<string, string | number> = { q, gb: gb(a) };
        if (c === "bible") {
          base.VERSION = version.code;
          base.orig = { text: 0, greek: 1, hebrew: 2 }[mode];
        } else base.orig = 0;
        let ids = bookIds.filter((b) => inCorpus(b, CORPUS[c].set));
        if (c === "bible" && testament) {
          const [lo, hi] = testament === "OT" ? [1, 39] : [40, 66];
          ids = ids.length ? ids.filter((b) => b >= lo && b <= hi) : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
          if (!ids.length) continue;
        }
        if (bookIds.length && !ids.length && !(c === "bible" && testament)) continue;
        if (!ids.length) sources.push({ corpus: c, query: base, label: c });
        else
          for (const [lo, hi] of runs(ids))
            sources.push({
              corpus: c,
              query: { ...base, RANGE: 3, range_bid: lo, range_eid: hi },
              label: lo === hi ? usfm(lo) : `${usfm(lo)}-${usfm(hi)}`,
            });
      }
      if (!sources.length) throw new ToolError("沒有可搜尋的範圍（books／testament／corpus 互相矛盾）");
      if (sources.length > MAX_SOURCES) throw new ToolError(`書卷太分散（${sources.length} 段），最多 ${MAX_SOURCES} 段連續範圍`);
      const counts = await Promise.all(sources.map((s) => countOf(upstream, CORPUS[s.corpus].file, s.query)));
      st = { v: 1, sources: sources.map((s, i) => ({ ...s, count: counts[i] })), size, s: 0, o: 0 };
    }

    const results: any[] = [];
    let { s, o } = st;
    while (s < st.sources.length && results.length < st.size) {
      const src = st.sources[s];
      if (o >= src.count) {
        s++;
        o = 0;
        continue;
      }
      const limit = Math.min(st.size - results.length, src.count - o, 500);
      const { data } = await upstream.get(CORPUS[src.corpus].file, { ...src.query, limit, offset: o });
      const d: any = ok(data, "搜尋");
      const rows = d.record ?? [];
      for (const r of rows) results.push({ ...verseOut(r, spec.books), corpus: src.corpus });
      o += rows.length;
      if (!rows.length) o = src.count; // upstream returned fewer than counted: move on
    }
    while (s < st.sources.length && o >= st.sources[s].count) {
      s++;
      o = 0;
    }
    const total = st.sources.reduce((n, x) => n + x.count, 0);
    const lic = st.sources.map((x) => (x.corpus === "bible" ? versionLicense(String(x.query.VERSION)) : x.corpus === "apocrypha" ? APOCRYPHA_LICENSE : UNLICENSED));
    return {
      source: source(lic),
      total,
      by_source: st.sources.map((x) => ({ corpus: x.corpus, books: x.label, count: x.count })),
      returned: results.length,
      results,
      next_cursor: s < st.sources.length ? encodeCursor({ ...st, s, o }) : null,
    };
  },
};

// ---------------------------------------------------------------- original languages

const wordAnalysis: ToolDef = {
  name: "word_analysis",
  title: "原文字彙分析",
  description: "一節經文的原文逐字分析（希臘文／希伯來文）：原文、Strong 編號、詞性、字形、原型、中文解釋。可再用 strongs_lookup 查字典。",
  inputSchema: {
    type: "object",
    properties: { book: CANON_BOOK, chapter: { type: "integer", minimum: 1, description: "章" }, verse: { type: "integer", minimum: 1, description: "節" }, ...SCRIPT },
    required: ["book", "chapter", "verse"],
    additionalProperties: false,
  },
  example: { book: "GEN", chapter: 1, verse: 1 },
  async run(a, ctx) {
    const { spec, upstream } = ctx;
    const b = resolveBook(a.book, spec.books, ["canon"]);
    gate(ctx, b.bid <= 39, "新約原文（NA/UBS 經文）字彙分析");
    const chap = toInt(a.chapter, "chapter", 1, 200);
    const sec = toInt(a.verse, "verse", 1, 200);
    const { data } = await upstream.get("qp.php", { bid: b.bid, chap, sec, gb: gb(a) });
    const d: any = ok(data, "字彙分析");
    const rows: any[] = d.record ?? [];
    if (!rows.length) throw new ToolError(`找不到 ${bookName(b)} ${chap}:${sec} 的字彙分析`);
    const prefix = d.N === 1 ? "H" : "G";
    const head = rows.find((r) => r.wid === 0);
    return {
      reference: `${bookName(b)} ${chap}:${sec}`,
      language: d.N === 1 ? "hebrew" : "greek",
      source_text: d.ubs ?? undefined,
      original: head?.word,
      literal_translation: head?.exp,
      words: rows
        .filter((r) => r.wid !== 0)
        .map((r) => ({
          position: r.wid,
          word: r.word,
          strongs: r.sn ? `${prefix}${Number(r.sn)}` : undefined,
          part_of_speech: r.pro,
          parsing: r.wform,
          lemma: r.orig,
          meaning: r.exp,
          note: r.remark || undefined,
        })),
      source: source(b.bid <= 39 ? OT_PARSING_LICENSE : UNLICENSED),
    };
  },
};

const strongsLookup: ToolDef = {
  name: "strongs_lookup",
  title: "原文字典（Strong 編號）",
  description: "依 Strong 編號查原文字典（中英文釋義、同源字）。G＝希臘文（新約）、H＝希伯來文（舊約）。例：G25（ἀγαπάω）、H430（אֱלֹהִים）。",
  inputSchema: {
    type: "object",
    properties: {
      number: { type: "string", description: "Strong 編號，須帶 G／H 前綴：G25、H430" },
      ...SCRIPT,
    },
    required: ["number"],
    additionalProperties: false,
  },
  example: { number: "G25" },
  async run(a, { upstream }) {
    const m = nfkc(String(a.number)).toUpperCase().match(/^([GH])?0*(\d+)$/);
    if (!m) throw new ToolError(`Strong 編號格式無效：${a.number}（例：G25、H430）`);
    if (!m[1]) throw new ToolError(`請加 G／H 前綴：希臘文 G${m[2]}、希伯來文 H${m[2]}`);
    const t = m[1] === "G" ? "NT" : "OT";
    const { data } = await upstream.get("sd.php", { N: t === "NT" ? 0 : 1, k: m[2], gb: gb(a) });
    const r = (ok<any>(data, "查字典").record ?? [])[0];
    if (!r) throw new ToolError(`找不到 ${m[1] ?? ""}${m[2]}`);
    return {
      strongs: `${t === "NT" ? "G" : "H"}${Number(m[2])}`,
      original: r.orig,
      definition_zh: r.dic_text,
      definition_en: r.edic_text,
      source: source(STRONGS_LICENSE),
      related_words: (r.same ?? []).map((x: any) => ({ word: x.word, strongs: `${t === "NT" ? "G" : "H"}${Number(x.csn)}`, count: x.ccnt, meaning: x.cexp })),
    };
  },
};

const baptistLexicon: ToolDef = {
  name: "baptist_lexicon",
  title: "浸宣中文原文字典",
  description: "浸宣中文希臘文／希伯來文字典（僅授權給信望愛站使用，需特別授權）。",
  restricted: true,
  inputSchema: {
    type: "object",
    properties: { number: { type: "string", description: "G25、H430" }, ...SCRIPT },
    required: ["number"],
    additionalProperties: false,
  },
  example: { number: "G25" },
  async run(a, { upstream }) {
    const m = nfkc(String(a.number)).toUpperCase().match(/^([GH])0*(\d+)$/);
    if (!m) throw new ToolError("請用 G25 或 H430 格式");
    const { data } = await upstream.get(m[1] === "G" ? "sbdag.php" : "stwcbhdic.php", { k: m[2], gb: gb(a) });
    return ok(data, "查字典");
  },
};

// ---------------------------------------------------------------- commentaries & topics

const listCommentaries: ToolDef = {
  name: "list_commentaries",
  title: "註釋書清單",
  description: "列出註釋書（id、名稱、是否可用），供 commentary／search_commentary 使用。",
  inputSchema: { type: "object", properties: { ...SCRIPT }, additionalProperties: false },
  example: {},
  async run(a, ctx) {
    const { data } = await ctx.upstream.get("sc.php", { validbook: 1, gb: gb(a) });
    return {
      commentaries: (ok<any>(data, "列出註釋書").record ?? []).map((r: any) => ({
        id: Number(r.id),
        name: r.name,
        available: ctx.unrestricted || !!OPEN_COMMENTARIES[Number(r.id)],
        license: OPEN_COMMENTARIES[Number(r.id)]?.notice,
      })),
    };
  },
};

const commentary: ToolDef = {
  name: "commentary",
  title: "經文註釋",
  description: "讀某節經文的註釋。預設為信望愛站註釋（GFDL）；可用 list_commentaries 取得的 id 指定一本或多本。",
  inputSchema: {
    type: "object",
    properties: {
      book: CANON_BOOK,
      chapter: { type: "integer", minimum: 1, description: "章" },
      verse: { type: "integer", minimum: 1, description: "節" },
      commentary_ids: { type: "array", items: { type: "integer" }, description: "註釋書 id（見 list_commentaries）；省略＝信望愛站註釋（3）" },
      ...SCRIPT,
    },
    required: ["book", "chapter", "verse"],
    additionalProperties: false,
  },
  example: { book: "JHN", chapter: 3, verse: 16 },
  async run(a, ctx) {
    const { spec, upstream } = ctx;
    const b = resolveBook(a.book, spec.books, ["canon"]);
    const q: Record<string, string | number> = { bid: b.bid, chap: toInt(a.chapter, "chapter", 1, 200), sec: toInt(a.verse, "verse", 1, 200), gb: gb(a) };
    let ids = toList(a.commentary_ids).map((x) => toInt(x, "commentary_ids", 0, 999));
    if (!ids.length) ids = [DEFAULT_COMMENTARY];
    for (const id of ids) gate(ctx, !!OPEN_COMMENTARIES[id], `註釋書 ${id}`);
    q.book = ids.join(",");
    const { data } = await upstream.get("sc.php", q);
    const d: any = ok(data, "讀註釋");
    return {
      reference: `${bookName(b)} ${q.chap}:${q.sec}`,
      entries: (d.record ?? []).map((r: any) => ({ commentary: r.book_name, title: r.title, text: r.com_text })),
      source: source(ids.map((id) => OPEN_COMMENTARIES[id] ?? UNLICENSED)),
    };
  },
};

const searchCommentary: ToolDef = {
  name: "search_commentary",
  title: "搜尋註釋",
  description: "在註釋書中搜尋關鍵字，回傳命中的段落與經文範圍（預設信望愛站註釋；超過 500 筆時請用更精確的關鍵字）。",
  inputSchema: {
    type: "object",
    properties: {
      keyword: { type: "string", description: "要在註釋中搜尋的關鍵字" },
      commentary_ids: { type: "array", items: { type: "integer" }, description: "註釋書 id（見 list_commentaries）；省略＝託管版為信望愛站註釋、本機版為全部" },
      ...SCRIPT,
    },
    required: ["keyword"],
    additionalProperties: false,
  },
  example: { keyword: "尼哥底母" },
  async run(a, ctx) {
    const { spec, upstream } = ctx;
    const q: Record<string, string | number> = { key: nfkc(String(a.keyword)), gb: gb(a) };
    let ids = toList(a.commentary_ids).map((x) => toInt(x, "commentary_ids", 0, 999));
    if (!ids.length && !ctx.unrestricted) ids = Object.keys(OPEN_COMMENTARIES).map(Number);
    for (const id of ids) gate(ctx, !!OPEN_COMMENTARIES[id], `註釋書 ${id}`);
    if (ids.length) q.book = ids.join(",");
    const { data } = await upstream.get("ssc.php", q);
    if (/record count > 500/.test(String((data as any)?.status))) throw new ToolError("符合超過 500 筆，請用更精確的關鍵字或限定 commentary_ids");
    const d: any = ok(data, "搜尋註釋");
    return {
      total: d.record_count,
      results: (d.record ?? []).map((r: any) => ({
        commentary: r.book_name,
        commentary_id: Number(r.tag),
        title: r.title,
        book: usfm(r.bid ?? spec.books.find((x) => x.engs === r.engs)?.bid),
        book_name: r.chinesef,
        from: { chapter: r.bchap, verse: r.bsec },
        to: { chapter: r.echap, verse: r.esec },
      })),
      source: source(ids.length ? ids.map((id) => OPEN_COMMENTARIES[id] ?? UNLICENSED) : UNLICENSED),
    };
  },
};

const TOPIC_SOURCES = { all: ["全部"], torrey_en: ["torrey", "torrey英文"], naves_en: ["naves", "naves英文"], torrey_zh: ["torrey中譯"], naves_zh: ["naves中譯"] };

const topics: ToolDef = {
  name: "topics",
  title: "主題查經",
  description: "主題查經（Torrey、Nave's，英文與中譯）。用關鍵字找主題，或用 topic_id 讀某主題。",
  inputSchema: {
    type: "object",
    properties: {
      keyword: { type: "string", description: "主題關鍵字（英文書籍請用英文關鍵字，如 love）" },
      topic_id: { type: "integer", description: "主題編號（優先於 keyword）" },
      source: { type: "string", enum: Object.keys(TOPIC_SOURCES), default: "all", description: "主題書：all＝全部（託管版為兩本英文）、torrey_en、naves_en、torrey_zh、naves_zh（中譯僅本機版）" },
      ...SCRIPT,
    },
    additionalProperties: false,
  },
  example: { keyword: "love" },
  async run(a, ctx) {
    const { upstream } = ctx;
    if (a.topic_id === undefined && !a.keyword) throw new ToolError("請給 keyword 或 topic_id（兩者都沒有時上游會回傳損壞的資料）");
    const src = toChoice(a.source, "source", TOPIC_SOURCES, "all");
    gate(ctx, !src.endsWith("_zh"), "主題查經中譯");
    // Hosted "all" = the two English (public-domain) books only.
    const codes = { torrey_en: 0, naves_en: 1, torrey_zh: 2, naves_zh: 3 } as const;
    const Ns = src === "all" ? (ctx.unrestricted ? [4] : [0, 1]) : [codes[src as keyof typeof codes]];
    const names = ["torrey_en", "naves_en", "torrey_zh", "naves_zh"];
    const out: any[] = [];
    for (const N of Ns) {
      const q: Record<string, string | number> = { N, gb: gb(a) };
      if (a.topic_id !== undefined) q.k = toInt(a.topic_id, "topic_id");
      else q.keyword = nfkc(String(a.keyword));
      const { data } = await upstream.get("st.php", q);
      for (const r of ok<any>(data, "主題查經").record ?? []) out.push({ source: names[r.book] ?? r.book, topic_id: r.id, topic: r.topic, text: r.text });
    }
    return { topics: out, source: source(src.endsWith("_zh") || ctx.unrestricted ? [TOPICS_LICENSE, UNLICENSED] : TOPICS_LICENSE) };
  },
};

// ---------------------------------------------------------------- places, audio, footnotes, rare books

const places: ToolDef = {
  name: "places",
  title: "聖經地點",
  description: "某章（或某節）提到的地點：名稱（英、現代、和合本…）、座標、原文編號、是否有照片。說明文字僅本機版提供。",
  inputSchema: {
    type: "object",
    properties: { book: CANON_BOOK, chapter: { type: "integer", minimum: 1, description: "章" }, verse: { type: "integer", minimum: 1, description: "省略＝整章" }, ...SCRIPT },
    required: ["book", "chapter"],
    additionalProperties: false,
  },
  example: { book: "JHN", chapter: 2, verse: 1 },
  async run(a, ctx) {
    const { spec, upstream } = ctx;
    const b = resolveBook(a.book, spec.books, ["canon"]);
    const q: Record<string, string | number> = { engs: b.engs, chap: toInt(a.chapter, "chapter", 1, 200), gb: gb(a) };
    if (a.verse !== undefined) q.sec = toInt(a.verse, "verse", 1, 200);
    const { data } = await upstream.get("sobj.php", q);
    return {
      places: (ok<any>(data, "查地點").record ?? []).map((r: any) => ({
        id: r.id,
        name_en: r.ename,
        name_modern: r.mname,
        name_cuv: r.cname,
        other_names: r.other || undefined,
        geometry: ["point", "polyline", "polygon"][r.otype] ?? r.otype,
        coordinates: r.objpath,
        strongs: [r.hsnum && Number(r.hsnum) ? `H${Number(r.hsnum)}` : undefined, r.gsnum && Number(r.gsnum) ? `G${Number(r.gsnum)}` : undefined].filter(Boolean),
        // Descriptions are prose of unclear licence: local server only.
        description: ctx.unrestricted ? r.exp5 || undefined : undefined,
        is_site: r.is_site !== 0,
        has_media: r.has_collect === 1,
      })),
      source: source(ctx.unrestricted ? [PLACES_LICENSE, UNLICENSED] : PLACES_LICENSE),
    };
  },
};

const RECORDINGS: Record<string, [number, string[]]> = {
  和合本: [0, ["cuv", "unv", "mandarin"]],
  台語: [1, ["taiwanese"]],
  客家話: [2, ["hakka"]],
  廣東話: [3, ["cantonese"]],
  現代中文譯本: [4, ["tcv"]],
  台語新約: [5, []],
  紅皮聖經: [6, []],
  希伯來文: [7, ["hebrew"]],
  福州話: [8, ["fuzhou"]],
  希臘文: [9, ["greek"]],
  spring台語: [10, []],
  spring和合本: [11, []],
  NetBible中文版: [12, ["netbible"]],
  全民台語聖經: [13, []],
  鄒語: [14, ["tsou"]],
  台語南部腔: [15, []],
  現代台語譯本: [17, []],
  現代客語譯本: [18, []],
  達悟語: [19, ["tao", "yami"]],
};

const audio: ToolDef = {
  name: "audio",
  title: "有聲聖經",
  description: "某章的有聲聖經 mp3／ogg 連結（多種語言與方言）。",
  inputSchema: {
    type: "object",
    properties: {
      book: CANON_BOOK,
      chapter: { type: "integer", minimum: 1, description: "章" },
      recording: { type: "string", enum: Object.keys(RECORDINGS), default: "和合本", description: "錄音版本" },
    },
    required: ["book", "chapter"],
    additionalProperties: false,
  },
  example: { book: "JHN", chapter: 3 },
  async run(a, ctx) {
    const { spec, upstream } = ctx;
    const b = resolveBook(a.book, spec.books, ["canon"]);
    const rec = toChoice<string>(a.recording, "recording", Object.fromEntries(Object.entries(RECORDINGS).map(([k, [, s]]) => [k, s])), "和合本");
    gate(ctx, !!OPEN_RECORDINGS[rec], `錄音 ${rec}`);
    const { data } = await upstream.get("au.php", { version: RECORDINGS[rec][0], bid: b.bid, chap: toInt(a.chapter, "chapter", 1, 200) });
    const d: any = ok(data, "有聲聖經");
    if (!d.mp3 && !d.ogg) throw new ToolError(`${rec} 沒有 ${bookName(b)} ${a.chapter} 章的錄音`);
    return { recording: d.name, book: usfm(b.bid), book_name: d.chinesef, chapter: d.chap, mp3: d.mp3, ogg: d.ogg, source: source(OPEN_RECORDINGS[rec] ?? UNLICENSED) };
  },
};

const footnotes: ToolDef = {
  name: "footnotes",
  restricted: true,
  title: "譯本註腳",
  description: "讀譯本經文中的註腳（例如現代中文譯本的「或譯」）。需註腳編號 id。",
  inputSchema: {
    type: "object",
    properties: {
      book: CANON_BOOK,
      footnote_id: { type: "integer", minimum: 1, description: "註腳編號" },
      version: { type: "string", default: "tcv", description: "有註腳的譯本代碼（預設 tcv＝現代中文譯本）" },
      ...SCRIPT,
    },
    required: ["book", "footnote_id"],
    additionalProperties: false,
  },
  example: { book: "GEN", footnote_id: 1 },
  async run(a, { spec, upstream }) {
    const b = resolveBook(a.book, spec.books, ["canon"]);
    const version = nfkc(String(a.version ?? "tcv")).toLowerCase();
    const { data } = await upstream.get("rt.php", { bid: b.bid, id: toInt(a.footnote_id, "footnote_id", 1), version, gb: gb(a) });
    const rows = ok<any>(data, "讀註腳").record ?? [];
    if (!rows.length) throw new ToolError(`找不到 ${bookName(b)} 的註腳 ${a.footnote_id}（version=${version}）`);
    return { book: usfm(b.bid), version, footnotes: rows.map((r: any) => ({ id: r.id, text: r.text })) };
  },
};

const rareBooks: ToolDef = {
  name: "rare_books",
  title: "珍本聖經",
  description:
    "珍本聖經：不給參數＝列出全部書目；給 id＝該書書目資料；給 book+chapter（可加 verse、id）＝找出有該經文的珍本頁面與影像連結。影像只提供授權允許自由使用者（GNU FDL、澳洲國家圖書館 NLA）。",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "integer", description: "珍本書籍編號" },
      book: CANON_BOOK,
      chapter: { type: "integer", minimum: 1, description: "章" },
      verse: { type: "integer", minimum: 1, description: "節" },
      ...SCRIPT,
    },
    additionalProperties: false,
  },
  example: { book: "JHN", chapter: 3, verse: 16 },
  async run(a, ctx) {
    const { spec, upstream } = ctx;
    // Catalogue (facts: title, author, year, language, copyright line); edge-cached, needed for licences.
    const { data: cat } = await upstream.get("ob.php", { gb: gb(a) });
    const catalogue: any[] = ok<any>(cat, "列出珍本").record ?? [];
    const byId = new Map(catalogue.map((r) => [Number(r.id), r]));
    const entry = (r: any) => ({
      id: Number(r.id),
      title: r.title,
      author: r.author || undefined,
      year: r.age || undefined,
      language: r.lang || undefined,
      category: r.div || undefined,
      copyright: r.copyright || undefined,
      provider: r.provider || undefined,
      images_available: ctx.unrestricted || !!rareBookLicense(r.copyright),
      ...(ctx.unrestricted ? { intro: r.intro || undefined } : {}),
    });

    if (a.book !== undefined) {
      const b = resolveBook(a.book, spec.books, ["canon"]);
      if (a.chapter === undefined) throw new ToolError("給 book 時也要給 chapter");
      const only = a.id !== undefined ? toInt(a.id, "id") : undefined;
      if (only !== undefined) gate(ctx, !!rareBookLicense(byId.get(only)?.copyright), `珍本 ${only} 的影像`);
      const q: Record<string, string | number> = { book: only ?? "all", bid: b.bid, chap: toInt(a.chapter, "chapter", 1, 200), gb: gb(a) };
      if (a.verse !== undefined) q.sec = toInt(a.verse, "verse", 1, 200);
      const { data } = await upstream.get("sob.php", q);
      const rows: any[] = ok<any>(data, "查珍本").record ?? [];
      const lic = (r: any) => rareBookLicense(byId.get(Number(r.book))?.copyright);
      const served = rows.filter((r) => ctx.unrestricted || lic(r));
      return {
        pages: served.map((r) => ({
          rare_book_id: Number(r.book),
          title: r.name,
          book: usfm(r.vid ?? b.bid),
          chapter: r.chap ?? r.bchap,
          verse: r.sec ?? r.bsec,
          ...(r.page !== undefined
            ? { page: r.page, total_pages: r.total, prev_page: r.prev, next_page: r.next, to: { chapter: r.echap, verse: r.esec }, image: r.orig, thumbnail: r.small }
            : {}),
          license: (lic(r) ?? UNLICENSED).notice,
        })),
        ...(rows.length > served.length ? { withheld: rows.length - served.length, withheld_reason: "影像授權僅限信望愛站或私人所有，託管服務不提供（本機版可用）" } : {}),
        source: source(served.map((r) => lic(r) ?? UNLICENSED).concat(served.length ? [] : [UNLICENSED]).slice(0, 20)),
      };
    }
    if (a.id !== undefined) {
      const r = byId.get(toInt(a.id, "id"));
      if (!r) throw new ToolError(`找不到珍本 ${a.id}`);
      return { book: entry(r), source: source({ status: "public-domain", notice: "珍本書目資料（事實資料）· 信望愛站" }) };
    }
    return {
      total: catalogue.length,
      books: catalogue.map((r) => {
        const e = entry(r);
        return { id: e.id, title: e.title, author: e.author, year: e.year, language: e.language, images_available: e.images_available };
      }),
      source: source({ status: "public-domain", notice: "珍本書目資料（事實資料）· 信望愛站" }),
    };
  },
};

// ---------------------------------------------------------------- reference lists (no upstream call)

const listVersions: ToolDef = {
  name: "list_versions",
  title: "譯本清單",
  description: "可用的聖經譯本（代碼、名稱、是否有 Strong 編號、是否只有新約／舊約）。",
  inputSchema: { type: "object", properties: { search: { type: "string", description: "篩選名稱或代碼" } }, additionalProperties: false },
  example: { search: "和合" },
  async run(a, ctx) {
    const { spec } = ctx;
    const s = a.search ? nfkc(String(a.search)).toLowerCase() : "";
    return {
      versions: spec.versions
        .filter((v) => !s || v.code.includes(s) || v.name.toLowerCase().includes(s))
        .filter((v) => ctx.unrestricted || OPEN_VERSIONS[v.code])
        .map((v) => ({ ...v, license: OPEN_VERSIONS[v.code]?.notice ?? "依信望愛站授權（僅本機自行啟用時可用）" })),
    };
  },
};

const listBooks: ToolDef = {
  name: "list_books",
  title: "書卷清單",
  description: "書卷代碼對照：USFM、和合本書名、英文、FHL 編號（正典、次經、使徒教父）。",
  inputSchema: { type: "object", properties: { corpus: { type: "string", enum: ["bible", "apocrypha", "fathers"], description: "只列某一部分：bible＝正典、apocrypha＝次經、fathers＝使徒教父；省略＝全部" } }, additionalProperties: false },
  example: { corpus: "apocrypha" },
  async run(a, { spec }) {
    const set = a.corpus ? ({ bible: "canon", apocrypha: "apocrypha", fathers: "fathers" } as const)[toChoice(a.corpus, "corpus", { bible: [], apocrypha: [], fathers: [] })] : undefined;
    return {
      books: spec.books
        .filter((b) => !set || corpusOf(b.bid) === set)
        .map((b) => ({ usfm: b.usfm ?? null, id: b.bid, name: bookName(b), short: b.chineses, english: b.engf ?? b.engs })),
    };
  },
};

export const TOOLS: ToolDef[] = [
  readPassage,
  lookupReference,
  searchText,
  wordAnalysis,
  strongsLookup,
  commentary,
  listCommentaries,
  searchCommentary,
  topics,
  places,
  audio,
  footnotes,
  rareBooks,
  listVersions,
  listBooks,
  baptistLexicon,
];

/** Tools offered under a policy: hosted hides whole-restricted tools; local lists all. */
export const toolsFor = (unrestricted = false) => TOOLS.filter((t) => unrestricted || !t.restricted);

/** Validates/coerces args against the tool's schema, then runs it. */
export async function runTool(name: string, args: Record<string, unknown>, ctx: Ctx): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolError(`未知工具：${name}。可用工具：${toolsFor(ctx.unrestricted).map((t) => t.name).join("、")}`);
  gate(ctx, !tool.restricted, `工具 ${name} 的內容`);
  return tool.run(coerce(args, tool.inputSchema), ctx);
}

async function parse(file: string, url: string, res: Response) {
  const raw = await res.text();
  const { data } = convert({ file, responseFormat: "json" } as any, raw, res.headers.get("content-type") ?? "");
  if (typeof data === "string") throw new ToolError(`上游回傳無法解析的資料（${file}，HTTP ${res.status}）`);
  return { url, data };
}

const urlOf = (file: string, query: Record<string, string | number>) =>
  `${UPSTREAM_BASE}${file}?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`;

/** Hosted: every call is a GET with cf.cacheTtl (shared edge cache for MCP and /tool). */
export function edgeUpstream(cacheTtl = 86400): Upstream {
  return {
    async get(file, query) {
      const url = urlOf(file, query);
      const res = await fetch(url, { headers: { accept: "application/json, text/*;q=0.8" }, cf: { cacheTtl, cacheEverything: true } } as RequestInit);
      return parse(file, url, res);
    },
  };
}

/** Local: plain live fetch from the user's machine, no cache. */
export function liveUpstream(): Upstream {
  return {
    async get(file, query) {
      const url = urlOf(file, query);
      return parse(file, url, await fetch(url, { headers: { accept: "application/json, text/*;q=0.8" } }));
    },
  };
}
