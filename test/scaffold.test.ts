import { describe, expect, it } from "vitest";
import { parseApiPage, parseEnum, parseDefault } from "../src/scaffold";
import { SNAPSHOT } from "../src/snapshot";
import { applyOverrides } from "../src/overrides";
import { buildQuery, csvToJson, sniffFormat, xmlToJson } from "../src/upstream";
import { buildSpec } from "../src/spec";
import generated from "../src/spec.generated.json";
import findingsJson from "./fixtures/findings.json";

const page = await parseApiPage(SNAPSHOT.html);
const byFile = (f: string) => page.endpoints.find((e) => e.file === f)!;
const names = (f: string) => byFile(f).params.map((p) => p.name);

describe("parseApiPage (snapshot)", () => {
  it("finds every section, despite unclosed <section> on qsb.php / seaf.php", () => {
    expect(page.endpoints).toHaveLength(23);
    expect(page.endpoints.map((e) => e.file)).toContain("seaf.php");
    expect(new Set(page.endpoints.map((e) => e.tool)).size).toBe(23);
  });

  it("keeps qsb.php and se.php apart", () => {
    expect(names("qsb.php")).toEqual(["version", "bid", "qstr", "strong", "gb"]);
    expect(names("se.php")[0]).toBe("VERSION");
  });

  it("handles 無 and inline parameter forms", () => {
    expect(byFile("ab.php").params).toEqual([]);
    expect(byFile("listall.html").params).toEqual([]);
    expect(names("abv.php")).toEqual(["gb"]);
    expect(byFile("ab.php").output).toContain("record_count");
  });

  it("parses qb.php params, defaults and enums", () => {
    const qb = byFile("qb.php");
    expect(names("qb.php")).toEqual(["bid", "chap", "sec", "version", "strong", "gb"]);
    expect(qb.params.find((p) => p.name === "version")!.default).toBe("nstrunv");
    expect(qb.params.find((p) => p.name === "gb")!.type).toBe("boolean");
    expect(qb.params.find((p) => p.name === "bid")!.type).toBe("integer");
    expect(qb.params.find((p) => p.name === "gb")!.enum).toEqual([
      { code: "1", label: "簡體" },
      { code: "0", label: "正體" },
    ]);
  });

  it("exposes lowercase keys but keeps documented names", () => {
    const v = byFile("se.php").params.find((p) => p.name === "VERSION")!;
    expect(v.key).toBe("version");
    expect(v.default).toBe("unv");
  });

  it("captures the copyright notice", () => {
    expect(page.notice).toContain("版權");
  });

  it("snapshot has the full book table", () => {
    expect(SNAPSHOT.books).toHaveLength(98);
    expect(SNAPSHOT.books.find((b) => b.bid === 43)).toMatchObject({ engs: "John", chineses: "約" });
    expect(SNAPSHOT.books.find((b) => b.bid === 217)?.chineses).toBe("衆長老的傳統");
  });
});

describe("enum/default parsing", () => {
  it("handles full-width colons, dots and 內定", () => {
    expect(parseEnum("查詢模式 0：全部 1：新約 2:舊約 3:範圍 default:0").options.map((o) => o.label)).toEqual([
      "全部",
      "新約",
      "舊約",
      "範圍",
    ]);
    expect(parseEnum("1:不顯示 0:顯示（內定）")).toEqual({
      options: [
        { code: "1", label: "不顯示" },
        { code: "0", label: "顯示" },
      ],
      defaultCode: "0",
    });
    expect(parseEnum("有聲聖經選擇 0.和合本 5.台語新約(台灣長老教會傳播中心授權) 6.紅皮聖經").options[1]).toEqual({
      code: "5",
      label: "台語新約",
    });
  });
  it("ignores verse references and non-numeric choices", () => {
    expect(parseEnum("如 qstr=太 10:1-3").options).toEqual([]);
    expect(parseEnum("經卷編號：1 創世記 2出埃及記").options).toEqual([]);
  });
  it("reads defaults", () => {
    expect(parseDefault("聖經版本 default:和合本(unv)")).toBe("unv");
    expect(parseDefault("最多顯示幾筆 default:unlimited")).toBeUndefined();
  });
});

describe("probe argument mapping (documented case, labels -> codes)", () => {
  const { endpoints } = applyOverrides(page.endpoints, {});
  const se = endpoints.find((e) => e.file === "se.php")!;
  it("restores documented case and maps labels to codes", () => {
    const q = buildQuery(se, { version: "kjv", range: "新約", gb: "簡體", q: "love" });
    expect(q.get("VERSION")).toBe("kjv");
    expect(q.get("RANGE")).toBe("1");
    expect(q.get("gb")).toBe("1");
    expect(q.has("version")).toBe(false);
  });
  it("accepts raw codes", () => {
    expect(buildQuery(se, { gb: "0" }).get("gb")).toBe("0");
  });
  it("maps booleans to 1/0", () => {
    const q = buildQuery(se, { gb: true, count_only: false, index_only: "true" });
    expect([q.get("gb"), q.get("count_only"), q.get("index_only")]).toEqual(["1", "0", "1"]);
  });
});

describe("format conversion", () => {
  it("sniffs json/xml/csv/text", () => {
    expect(sniffFormat('{"a":1}', "application/json")).toBe("json");
    expect(sniffFormat("<result><record_count>1</record_count></result>")).toBe("xml");
    expect(sniffFormat("1,Gen,Genesis,創,Ge\n2,Ex,Exodus,出,Ex\n")).toBe("csv");
    expect(sniffFormat("<html>oops</html>")).toBe("text");
  });
  it("converts xml and csv", () => {
    expect(xmlToJson("<result><record_count>1</record_count><record><id>1</id><text>t</text></record></result>")).toEqual({
      record_count: "1",
      record: [{ id: "1", text: "t" }],
    });
    expect(csvToJson("1,Gen\n2,Ex", ["id", "engs"]).record).toEqual([
      { id: "1", engs: "Gen" },
      { id: "2", engs: "Ex" },
    ]);
  });
});

describe("overrides are pinned to section hashes", () => {
  it("drops an override whose hash no longer matches", () => {
    const { endpoints, stale } = applyOverrides(page.endpoints, {
      "qb.php": { sectionHash: "stale", required: ["bid"] },
      "se.php": { sectionHash: byFile("se.php").sectionHash, required: ["q"] },
    });
    expect(stale).toEqual(["qb.php"]);
    expect(endpoints.find((e) => e.file === "qb.php")!.params.some((p) => p.required)).toBe(false);
    expect(endpoints.find((e) => e.file === "se.php")!.params.find((p) => p.name === "q")!.required).toBe(true);
  });
});

describe("generated spec", () => {
  it("marks endpoints licensed only to FHL as restricted", () => {
    const restricted = (generated as any).endpoints.filter((e: any) => e.restricted).map((e: any) => e.file);
    expect(restricted).toEqual(["sbdag.php", "stwcbhdic.php"]);
    expect((generated as any).endpoints).toHaveLength(23);
  });
  it("is up to date with snapshot + overrides (run pnpm build:spec)", async () => {
    const { spec, stale } = await buildSpec(SNAPSHOT.html, SNAPSHOT, undefined, (findingsJson as any).results);
    expect(stale).toEqual([]);
    expect(generated).toEqual(JSON.parse(JSON.stringify(spec)));
  });
});
