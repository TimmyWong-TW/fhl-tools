import { expandChapterRanges } from "../src/tools";
import { describe, expect, it } from "vitest";
import { handleRpc } from "../src/mcp";
import generated from "../src/spec.generated.json";
import { TOOLS, Unauthorized, runTool, toolsFor, type Ctx, type Upstream } from "../src/tools";
import type { ApiSpec } from "../src/types";

const spec = generated as unknown as ApiSpec;

/** Fake upstream: records calls; `reply(file, query)` decides the body. */
function fake(reply: (file: string, q: Record<string, string | number>) => any) {
  const calls: { file: string; q: Record<string, string | number> }[] = [];
  const upstream: Upstream = {
    async get(file, q) {
      calls.push({ file, q });
      return { url: `fake://${file}`, data: reply(file, q) };
    },
  };
  return { calls, upstream };
}

const verse = (bid: number, engs: string, chap: number, sec: number, text = "t") => ({ bid, engs, chineses: "x", chap, sec, bible_text: text });
const ctxOf = (upstream: Upstream, unrestricted = false): Ctx => ({ spec, upstream, unrestricted });

describe("read_passage", () => {
  it("maps USFM/Chinese/English/number to bid and returns clean output with attribution", async () => {
    for (const book of ["JHN", "jhn", "約", "約翰福音", "John", 43, "43"]) {
      const f = fake(() => ({ status: "success", record_count: 1, version: "unv", v_name: "FHL和合本", record: [verse(43, "John", 3, 16, "神愛世人")] }));
      const out: any = await runTool("read_passage", { book, chapter: "3", verses: "16" }, ctxOf(f.upstream));
      expect(f.calls[0]).toEqual({ file: "qb.php", q: { bid: 43, chap: 3, gb: 0, sec: "16", version: "unv" } });
      expect(out).toMatchObject({ book: "JHN", book_name: "約翰福音", chapter: 3, verses: [{ verse: 16, text: "神愛世人" }] });
      expect(out.source.licenses[0]).toMatch(/GNU Free Documentation License/);
    }
  });

  it("normalises verse ranges and full-width input", async () => {
    const f = fake(() => ({ status: "success", record: [verse(43, "John", 3, 1)] }));
    await runTool("read_passage", { book: "JHN", chapter: "３", verses: "1–3、5" }, ctxOf(f.upstream));
    expect(f.calls[0].q).toMatchObject({ chap: 3, sec: "1-3,5" });
  });

  it("routes apocrypha to qsub and gates the Apostolic Fathers and FHL-only versions", async () => {
    const f = fake(() => ({ status: "success", record: [verse(101, "1Mc", 1, 1)] }));
    await runTool("read_passage", { book: "1MA", chapter: 1 }, ctxOf(f.upstream));
    expect(f.calls[0].file).toBe("qsub.php");
    await expect(runTool("read_passage", { book: 201, chapter: 1 }, ctxOf(f.upstream))).rejects.toBeInstanceOf(Unauthorized);
    await expect(runTool("read_passage", { book: "JHN", chapter: 3, version: "rcuv" }, ctxOf(f.upstream))).rejects.toBeInstanceOf(Unauthorized);
    await expect(runTool("read_passage", { book: "JHN", chapter: 3, version: "和合本2010" }, ctxOf(f.upstream))).rejects.toThrow(/rcuv/);
    // Local opt-in serves everything.
    await runTool("read_passage", { book: "JHN", chapter: 3, version: "rcuv" }, ctxOf(f.upstream, true));
    expect(f.calls.at(-1)!.q.version).toBe("rcuv");
  });

  it("rejects bad input with helpful messages instead of silent upstream fallbacks", async () => {
    const f = fake(() => ({ status: "success", record: [] }));
    await expect(runTool("read_passage", { book: "XYZ", chapter: 3 }, ctxOf(f.upstream))).rejects.toThrow(/找不到書卷：XYZ.*list_books/);
    await expect(runTool("read_passage", { book: "JHN", chapter: 3, verses: "x" }, ctxOf(f.upstream))).rejects.toThrow(/verses 格式無效/);
    await expect(runTool("read_passage", { book: "JHN", chapter: 3, bogus: 1 }, ctxOf(f.upstream))).rejects.toThrow(/未知參數 bogus/);
    await expect(runTool("read_passage", { book: "JHN", chapter: 99 }, ctxOf(f.upstream))).rejects.toThrow(/找不到經文/);
    expect(f.calls).toHaveLength(1); // only the last one reached upstream
  });
});

describe("search_text", () => {
  // Gospels = one run (MAT-JHN); ROM separate -> two sources with counts 3 and 4.
  const counts: Record<string, number> = { "40-43": 3, "45-45": 4 };
  const reply = (file: string, q: Record<string, string | number>) => {
    const key = `${q.range_bid}-${q.range_eid}`;
    if (q.count_only) return { status: "success", record_count: counts[key] };
    const n = Math.min(Number(q.limit), counts[key] - Number(q.offset));
    const bid = Number(q.range_bid);
    return { status: "success", record_count: n, record: Array.from({ length: n }, (_, i) => verse(bid, "B", 1, Number(q.offset) + i + 1)) };
  };

  it("counts every source up front, then pages across sources with an opaque cursor", async () => {
    const f = fake(reply);
    const p1: any = await runTool("search_text", { query: "愛", books: "MAT,MRK,LUK,JHN,ROM", page_size: 5 }, ctxOf(f.upstream));
    expect(p1.total).toBe(7);
    expect(p1.by_source).toEqual([
      { corpus: "bible", books: "MAT-JHN", count: 3 },
      { corpus: "bible", books: "ROM", count: 4 },
    ]);
    expect(p1.results.map((r: any) => `${r.book}:${r.verse}`)).toEqual(["MAT:1", "MAT:2", "MAT:3", "ROM:1", "ROM:2"]);
    expect(f.calls.filter((c) => c.q.count_only)).toHaveLength(2);
    expect(f.calls.find((c) => c.q.count_only)!.q).toMatchObject({ RANGE: 3, VERSION: "unv", orig: 0 });

    const before = f.calls.length;
    const p2: any = await runTool("search_text", { cursor: p1.next_cursor }, ctxOf(f.upstream));
    expect(p2.results.map((r: any) => `${r.book}:${r.verse}`)).toEqual(["ROM:3", "ROM:4"]);
    expect(p2.next_cursor).toBeNull();
    expect(f.calls.slice(before).some((c) => c.q.count_only)).toBe(false); // counts travel in the cursor
  });

  it("rejects contradictions, too many sources and gated corpora", async () => {
    const f = fake(reply);
    await expect(runTool("search_text", { query: "x", testament: "OT", books: ["JHN"] }, ctxOf(f.upstream))).rejects.toThrow(/沒有可搜尋的範圍/);
    await expect(runTool("search_text", { query: "x", books: ["GEN", "LEV", "DEU", "JDG", "1SA", "1KI", "1CH", "NEH", "JOB"] }, ctxOf(f.upstream))).rejects.toThrow(/最多 8 段/);
    await expect(runTool("search_text", { query: "x", corpus: ["fathers"] }, ctxOf(f.upstream))).rejects.toBeInstanceOf(Unauthorized);
    await expect(runTool("search_text", { query: "x", mode: "greek", corpus: "apocrypha" }, ctxOf(f.upstream))).rejects.toThrow(/只適用於正典/);
    await expect(runTool("search_text", { cursor: "garbage!" }, ctxOf(f.upstream))).rejects.toThrow(/cursor 無效/);
  });
});

describe("other tools", () => {
  it("strongs_lookup parses G/H prefixes", async () => {
    const f = fake(() => ({ status: "success", record: [{ sn: "00025", orig: "ἀγαπάω", dic_text: "愛", edic_text: "love", same: [] }] }));
    const out: any = await runTool("strongs_lookup", { number: "g025" }, ctxOf(f.upstream));
    expect(f.calls[0].q).toMatchObject({ N: 0, k: "25" });
    expect(out).toMatchObject({ strongs: "G25", original: "ἀγαπάω" });
    await expect(runTool("strongs_lookup", { number: "25" }, ctxOf(f.upstream))).rejects.toThrow(/G／H/);
  });

  it("word_analysis serves the OT (CC BY-NC-SA) but gates the NA/UBS New Testament", async () => {
    const f = fake(() => ({ status: "success", N: 1, record: [{ wid: 0, word: "בְּרֵאשִׁית", exp: "起初" }, { wid: 1, word: "בְּ", sn: "07225", exp: "起初" }] }));
    const out: any = await runTool("word_analysis", { book: "GEN", chapter: 1, verse: 1 }, ctxOf(f.upstream));
    expect(out.words[0]).toMatchObject({ position: 1, strongs: "H7225" });
    expect(out.source.licenses[0]).toMatch(/CC BY-NC-SA/);
    await expect(runTool("word_analysis", { book: "JHN", chapter: 3, verse: 16 }, ctxOf(f.upstream))).rejects.toBeInstanceOf(Unauthorized);
  });

  it("topics: hosted 'all' queries only the public-domain English books", async () => {
    const f = fake(() => ({ status: "success", record: [] }));
    await runTool("topics", { keyword: "love" }, ctxOf(f.upstream));
    expect(f.calls.map((c) => c.q.N)).toEqual([0, 1]);
    await expect(runTool("topics", { keyword: "愛", source: "torrey_zh" }, ctxOf(f.upstream))).rejects.toBeInstanceOf(Unauthorized);
  });

  it("list_versions only shows servable versions when hosted", async () => {
    const hosted: any = await runTool("list_versions", {}, ctxOf(fake(() => ({})).upstream));
    expect(hosted.versions.map((v: any) => v.code)).toContain("unv");
    expect(hosted.versions.map((v: any) => v.code)).not.toContain("rcuv");
    const local: any = await runTool("list_versions", {}, ctxOf(fake(() => ({})).upstream, true));
    expect(local.versions.length).toBeGreaterThan(hosted.versions.length);
  });
});

describe("per-item licence gates", () => {
  it("commentary defaults to the GFDL FHL commentary and gates the others", async () => {
    const f = fake(() => ({ status: "success", record: [{ book_name: "信望愛站註釋", title: "t", com_text: "c" }] }));
    const out: any = await runTool("commentary", { book: "JHN", chapter: 3, verse: 16 }, ctxOf(f.upstream));
    expect(f.calls[0].q.book).toBe("3");
    expect(out.source.licenses[0]).toMatch(/GNU Free Documentation/);
    await expect(runTool("commentary", { book: "JHN", chapter: 3, verse: 16, commentary_ids: [8] }, ctxOf(f.upstream))).rejects.toBeInstanceOf(Unauthorized);
    await runTool("commentary", { book: "JHN", chapter: 3, verse: 16, commentary_ids: "3,8" }, ctxOf(f.upstream, true));
    expect(f.calls.at(-1)!.q.book).toBe("3,8");
  });

  it("places omit the descriptive prose when hosted", async () => {
    const f = fake(() => ({ status: "success", record: [{ id: "35", ename: "Sea of Galilee", cname: "加利利海", gsnum: "01056", hsnum: "00000", otype: 2, objpath: "1,2", exp5: "說明", is_site: 1, has_collect: 1 }] }));
    const hosted: any = await runTool("places", { book: "JHN", chapter: 2 }, ctxOf(f.upstream));
    expect(hosted.places[0]).toMatchObject({ name_cuv: "加利利海", strongs: ["G1056"], geometry: "polygon" });
    expect(hosted.places[0].description).toBeUndefined();
    const local: any = await runTool("places", { book: "JHN", chapter: 2 }, ctxOf(f.upstream, true));
    expect(local.places[0].description).toBe("說明");
  });

  it("rare_books serves only freely licensed page images when hosted", async () => {
    const f = fake((file) =>
      file === "ob.php"
        ? { status: "success", record: [
            { id: 1, title: "A", copyright: "紙本聖經由勞如麟牧師提供提供，影像為GNU Free Documentation" },
            { id: 2, title: "B", copyright: "翻拍影像著作權是澳洲國立圖書館所有，註明出處為NLA後可以自由刊載" },
            { id: 3, title: "C", copyright: "影像為台灣聖經公會擁有，授權信望愛永久網路刊載權。" },
          ] }
        : { status: "success", record: [1, 2, 3].map((b) => ({ book: String(b), name: "n", vid: 43, chap: 3, sec: 16 })) },
    );
    const out: any = await runTool("rare_books", { book: "JHN", chapter: 3, verse: 16 }, ctxOf(f.upstream));
    expect(out.pages.map((p: any) => p.rare_book_id)).toEqual([1, 2]);
    expect(out.withheld).toBe(1);
    await expect(runTool("rare_books", { book: "JHN", chapter: 3, id: 3 }, ctxOf(f.upstream))).rejects.toBeInstanceOf(Unauthorized);
    const cat: any = await runTool("rare_books", {}, ctxOf(f.upstream));
    expect(cat.books.map((b: any) => b.images_available)).toEqual([true, true, false]);
  });
});

describe("MCP over the smart tools", () => {
  it("lists only hosted-servable tools and reports restricted calls as tool errors (not HTTP 401)", async () => {
    const ctx = ctxOf(fake(() => ({ status: "success", record: [] })).upstream);
    const list: any = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, ctx);
    const names = list.result.tools.map((t: any) => t.name);
    expect(names).toContain("read_passage");
    expect(names).toContain("commentary");
    expect(names).not.toContain("footnotes");
    expect(names).toHaveLength(toolsFor(false).length);
    const call: any = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "footnotes", arguments: { book: "GEN", footnote_id: 1 } } }, ctx);
    expect(call.result.isError).toBe(true);
    expect(call.result.content[0].text).toMatch(/本機版/);
    const local: any = await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, ctxOf(ctx.upstream, true));
    expect(local.result.tools).toHaveLength(TOOLS.length);
  });

  it("initialize describes the licence policy", async () => {
    const init: any = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctxOf(fake(() => ({})).upstream));
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.instructions).toMatch(/公有領域/);
  });
});

describe("reference helpers", () => {
  it("expands whole-chapter ranges that FHL would truncate", () => {
    expect(expandChapterRanges("約3-4")).toBe("約3;4");
    expect(expandChapterRanges("約3:35-4:2;羅5")).toBe("約3:35-4:2;羅5");
    expect(expandChapterRanges("John 1-3")).toBe("John 1;2;3");
  });
});
