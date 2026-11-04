import type { EndpointSpec, ParamSpec, ResponseFormat } from "./types";
import type { ParsedPage } from "./scaffold";

/**
 * Facts confirmed by `pnpm probe` (see docs/FINDINGS.md). Each entry is pinned to the
 * sectionHash of the docs section it was confirmed against and is ignored as soon as that
 * section changes upstream, falling back to pure scaffolding until re-probed.
 */
export interface Override {
  sectionHash: string;
  responseFormat?: ResponseFormat;
  csvColumns?: string[];
  required?: string[];
  notes?: string[];
  example?: Record<string, string | number>;
  inject?: Record<string, string>;
  /** Content licensed only to FHL: unlisted, and calls return 401 until special auth (src/auth.ts) exists. */
  restricted?: boolean;
  responseSchema?: "VerseList" | "SearchResult";
  /** `version` takes the Bible text versions listed by ab.php. */
  bibleVersions?: boolean;
  /** Book numbering for bid / range_bid / range_eid (default canon 1-66). */
  bookSet?: "canon" | "apocrypha" | "fathers";
  params?: Record<string, Partial<Pick<ParamSpec, "type" | "description" | "default">> & { labels?: Record<string, string> }>;
}

const LIMIT_NOTE = "符合筆數超過 500 時上游回傳 Fail:record count > 500；未指定 limit 時本服務自動帶 limit=100。";

/** Confirmed 2026-11-04 against https://bible.fhl.net/api/ (Last-Modified 2026-10-24). */
export const OVERRIDES: Record<string, Override> = {
  "listall.html": {
    sectionHash: "0cbb7940a6503ddbdcebd3cd63af48c6aa6aff63ed333e6e772d5c214b21ee76",
    responseFormat: "csv",
    // UTF-8 bytes but served as `text/html` without charset; decoded as UTF-8 here.
    // Docs list 5 columns; the file actually has 6 (中文全名 is undocumented).
    csvColumns: ["id", "engs", "engf", "chineses", "chinesef", "engs_short"],
    notes: ["實際為 6 欄 CSV（多了中文全名），以 text/html 傳回；本服務轉為 JSON。"],
  },
  "qb.php": {
    sectionHash: "637672e50f2827a92ed87af60adaa7b46278df3a1e568019900731fe73dc5ab3",
    bibleVersions: true,
    responseSchema: "VerseList",
    inject: { version: "unv" },
    params: { version: { default: "unv" } },
    notes: ["文件寫 version 預設 nstrunv，但未給 version 或給 nstrunv 都回傳 Fail:version Error!；本服務預設帶 version=unv。", "版本代碼可由 fhl_ab 取得。"],
    example: { bid: 43, chap: 3, sec: "16", version: "unv" },
  },
  "rt.php": {
    sectionHash: "a79335ff7f5046a847a7c54dd520e9f6e69af9c0b84061cff191d3d8de5c3008",
    required: ["bid", "id"],
    notes: ["必須給註腳編號 id，否則永遠 record_count=0；chap 不影響結果。"],
    example: { bid: 1, id: 1, version: "tcv" },
  },
  "qp.php": {
    sectionHash: "5b8d5c962b3b18829ec511cab66b04cb278b710e90f7951dfde5ae6b7bc884fb",
    required: ["bid", "chap", "sec"],
    notes: ["缺 bid 回傳 Fail:engs error!；缺 chap 或 sec 時上游輸出不合法的 JSON。"],
    example: { bid: 43, chap: 3, sec: 16 },
  },
  "sc.php": {
    sectionHash: "86831fb6c59a60391b30d6b8cf0c424b174d108fdc8de670d93376dccf40f8d0",
    notes: ["validbook=1 時忽略其他所有參數，只列出註釋書（id/name）。", "查註釋需 bid+chap+sec；未給 book 時使用預設註釋書。"],
    example: { book: 3, bid: 43, chap: 3, sec: 16 },
  },
  "ssc.php": {
    sectionHash: "02e1399fd8e2bd8df8ab4b48d5b203d8381ad2e13ab839e23e9533d07838e6ab",
    required: ["key"],
    notes: ["結果超過 500 筆時回傳 Fail:record count > 500，請用較精確的關鍵字（本端點沒有 limit）。"],
    example: { book: 3, key: "尼哥底母" },
  },
  "sd.php": {
    sectionHash: "03c71558217370e2b3dc3928822e99762eef647ef0f4877a01e5ded1fa71009a",
    required: ["k"],
    notes: ["參數名 N 大小寫有別（n 會被忽略），本服務會自動轉換。"],
    example: { N: 0, k: "25" },
  },
  "sbdag.php": {
    sectionHash: "5152e7067ac448a4d2920f78c2f556f57b723bb5fcad222764576af3e93bd57d",
    restricted: true, // 僅授權給信望愛站使用
    required: ["k"],
    example: { k: "25" },
  },
  "stwcbhdic.php": {
    sectionHash: "36085d3645458c3a88548a4e336302963bc87a12c428e21e3aca99bc50ef9c47",
    restricted: true, // 僅授權給信望愛站使用
    required: ["k"],
    notes: ["缺 k 時上游 HTTP 500 並回傳截斷的 JSON。"],
    example: { k: "1" },
  },
  "qsb.php": {
    sectionHash: "2ee99ae55c8de38d057c2455a56cf262a8c238b444665ed3ad89f77be146e477",
    bibleVersions: true,
    responseSchema: "VerseList",
    required: ["qstr"],
    notes: ["bid 是 qstr 未寫書卷時的預設書卷（如 qstr=3:16、bid=43 → 約 3:16）；qstr 有書卷名時 bid 無效。", "qstr 可用中文或英文縮寫、多段以 ; 分隔（如 約3:16;羅5:8 或 John 3:16）。", "gb 也會影響 qstr 的解讀：gb=簡體 時要用簡體書卷名。"],
    example: { qstr: "約 3:16" },
  },
  "se.php": {
    sectionHash: "d3f57c0900bb9a318b31844da69648064990c7a4b2f3d11745525d2bc228fe5f",
    bibleVersions: true,
    responseSchema: "SearchResult",
    required: ["q"],
    inject: { limit: "100" },
    notes: [LIMIT_NOTE, "VERSION/RANGE 大小寫有別（小寫會被上游靜默忽略），本服務自動轉換。", "gb 也影響查詢字串解讀；RANGE=範圍 時才使用 range_bid/range_eid。"],
    example: { q: "愛", limit: 3 },
  },
  "sob.php": {
    sectionHash: "c7fc10a601cff6364769f8fed05ac0098a4c22cc21f5b687f1c6f874bb5d8639",
    notes: ["bid 與 engs 需擇一；同時給時 bid 優先。回傳沒有 record_count。"],
    example: { book: "all", bid: 43, chap: 3, sec: 16 },
  },
  "sobj.php": {
    sectionHash: "51e181e2ccdb457aab053b8e6da566ba2f62a75997ff875b851519a66bc8c016",
    required: ["engs", "chap"],
    notes: ["未給 sec 時回傳整章。實際欄位名為 hsnum/gsnum（文件寫 hsname/gsname）。"],
    example: { engs: "John", chap: 2, sec: 1 },
  },
  "st.php": {
    sectionHash: "35f9060bc1e3febb1bf32ecfae3f7aea7442ede295b12c2881e8f40a916a4d17",
    notes: ["需給 k 或 keyword（k 優先）；兩者都沒有時上游回傳數百 KB 不合法的 JSON。", "N 未給時為 0（torrey英文），中文關鍵字請用 N=全部查詢 或中譯。N 大小寫有別。"],
    example: { N: 4, keyword: "愛" },
  },
  "qsub.php": {
    sectionHash: "e4649a67ad50a78311b3865b99fecdf54993f306ae7b0ebba633cf9c7b705ca2",
    responseSchema: "VerseList",
    bookSet: "apocrypha",
    notes: ["bid 為次經書卷 101-115（101 馬一 … 115 斯補），超出範圍時改回傳 101；version 實際預設 c1933，文件寫的 nstrunv 會得到 0 筆。"],
    params: { version: { default: "c1933" } },
  },
  "qaf.php": {
    sectionHash: "15019640ca09a5e393d7afda393bf2941d5108d4c8315868e1e0e6a8e70357ca",
    responseSchema: "VerseList",
    bookSet: "fathers",
    notes: ["bid 為使徒教父書卷 201-217（201 革利免一書 … 217 衆長老的傳統），超出範圍時改回傳 201；也可用 chineses 指定。"],
  },
  "sesub.php": {
    sectionHash: "2938c431f157916105d8eadd6f24e9f281643fe136d72e94e7ccc9e5c36374cd",
    responseSchema: "SearchResult",
    bookSet: "apocrypha",
    required: ["q"],
    inject: { limit: "100" },
    notes: [LIMIT_NOTE, "VERSION 不存在時上游改回傳 XML（<result><status>Fail:… not found!</status></result>），本服務轉為 JSON。"],
    example: { q: "主", limit: 3 },
  },
  "seaf.php": {
    sectionHash: "40e5134109515e69cfdfb15b0eebdb8eeb7b8e544afb20d90b5b9638936d9c05",
    responseSchema: "SearchResult",
    bookSet: "fathers",
    required: ["q"],
    inject: { limit: "100" },
    notes: [LIMIT_NOTE],
    example: { q: "主", limit: 3 },
  },
};

export function applyOverrides(
  parsed: ParsedPage["endpoints"],
  overrides: Record<string, Override> = OVERRIDES,
): { endpoints: EndpointSpec[]; stale: string[] } {
  const stale: string[] = [];
  const endpoints = parsed.map((p): EndpointSpec => {
    const ep: EndpointSpec = { ...p, params: p.params.map((x) => ({ ...x, enum: x.enum?.map((o) => ({ ...o })) })), responseFormat: "json", confirmed: false };
    const o = overrides[p.file];
    if (!o) return ep;
    // Restriction applies even if the section changed (fail closed).
    if (o.restricted) ep.restricted = true;
    if (o.bookSet) ep.bookSet = o.bookSet;
    if (o.responseSchema) ep.responseSchema = o.responseSchema;
    if (o.bibleVersions) ep.bibleVersions = true;
    if (o.sectionHash !== p.sectionHash) {
      stale.push(p.file);
      return ep;
    }
    ep.confirmed = true;
    if (o.responseFormat) ep.responseFormat = o.responseFormat;
    if (o.csvColumns) ep.csvColumns = o.csvColumns;
    if (o.notes) ep.notes = o.notes;
    if (o.example) ep.example = o.example;
    if (o.inject) ep.inject = o.inject;
    for (const prm of ep.params) {
      if (o.required?.includes(prm.name)) prm.required = true;
      const po = o.params?.[prm.name];
      if (!po) continue;
      if (po.type) prm.type = po.type;
      if (po.description) prm.description = po.description;
      if (po.default !== undefined) prm.default = po.default;
      if (po.labels && prm.enum) for (const opt of prm.enum) opt.label = po.labels[opt.code] ?? opt.label;
    }
    return ep;
  });
  return { endpoints, stale };
}
