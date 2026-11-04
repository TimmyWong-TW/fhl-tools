import type { ApiSpec, EndpointSpec, ParamSpec } from "./types";
import { BID_BOUNDS } from "./usfm";

const FHL = "https://bible.fhl.net";

/**
 * OpenAPI 3.1 for FHL's PHP API *exactly as it is* (we neither host nor proxy it): documented
 * parameter names and casing, numeric codes, raw responses, plus every caveat found by probing,
 * CUV book names for bid and working request samples. The smart layer lives in MCP/UTCP only.
 */

/** Response field types we are sure about; everything else is left untyped. */
const FIELD_TYPES: Record<string, string> = {
  status: "string",
  record_count: "integer",
  bid: "integer",
  chap: "integer",
  sec: "integer",
  id: "integer",
  engs: "string",
  chineses: "string",
  chinesef: "string",
  bible_text: "string",
};

type Schema = Record<string, unknown>;
const ref = (kind: "schemas" | "parameters", name: string) => ({ $ref: `#/components/${kind}/${name}` });

/** Shared response schemas, composed with allOf. */
const SCHEMAS: Record<string, Schema> = {
  Envelope: {
    type: "object",
    description: "所有 JSON 回應的共同外框。錯誤時 HTTP 仍為 200，status 為 Fail:…，通常只有 status 欄位。",
    properties: {
      status: { type: "string", description: "success 或 Fail:<原因>" },
      record_count: { type: "integer", description: "資料筆數" },
    },
    required: ["status"],
  },
  Nav: {
    type: "object",
    description: "經節位置（prev/next 也使用此結構）",
    properties: {
      bid: { type: "integer", description: "經卷編號" },
      engs: { type: "string", description: "經卷英文縮寫" },
      chineses: { type: "string", description: "經卷中文縮寫" },
      chap: { type: "integer", description: "章" },
      sec: { type: "integer", description: "節" },
    },
  },
  Verse: {
    allOf: [ref("schemas", "Nav"), { type: "object", properties: { bible_text: { type: "string", description: "經文" } } }],
  },
  VerseList: {
    allOf: [
      ref("schemas", "Envelope"),
      {
        type: "object",
        properties: {
          version: { type: "string", description: "經文版本英文簡寫" },
          v_name: { type: "string", description: "經文版本中文名" },
          proc: { type: "integer", description: "經文特殊字型需求: 0:不需要 1:希臘文 2:希伯來文 3:羅馬拼音 4:Open Han 字形" },
          record: { type: "array", items: ref("schemas", "Verse") },
          prev: ref("schemas", "Nav"),
          next: ref("schemas", "Nav"),
        },
      },
    ],
  },
  SearchHit: {
    allOf: [ref("schemas", "Verse"), { type: "object", properties: { id: { type: "integer", description: "經節絕對編號" } } }],
  },
  SearchResult: {
    allOf: [
      ref("schemas", "Envelope"),
      {
        type: "object",
        properties: {
          orig: { type: "string", description: "查詢形式" },
          key: { type: "string", description: "輸入的查詢字串" },
          record: { type: "array", items: ref("schemas", "SearchHit") },
        },
      },
    ],
  },
};

/** `name: desc` lines from the documented 輸出 text. */
function fieldDocs(output: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of output.split("\n")) {
    const hit = line.match(/^([A-Za-z_]\w*)\s*[:：]\s*(.+)$/);
    if (hit && !m.has(hit[1])) m.set(hit[1], hit[2].trim());
  }
  return m;
}

function fieldSchemas(keys: string[], docs: Map<string, string>): Record<string, Schema> {
  return Object.fromEntries(
    keys.map((k) => [k, { ...(FIELD_TYPES[k] ? { type: FIELD_TYPES[k] } : {}), ...(docs.get(k) ? { description: docs.get(k) } : {}) }]),
  );
}

const pascal = (file: string) => file.replace(/\.[a-z]+$/, "").replace(/(^|_)(\w)/g, (_, __, c: string) => c.toUpperCase());

/** Per-endpoint response: a shared family, or Envelope extended with the probe-observed keys. */
function responseSchema(ep: EndpointSpec, schemas: Record<string, Schema>): Schema {
  if (ep.responseSchema) return ref("schemas", ep.responseSchema);
  if (!ep.observed) return { type: "object" };
  const docs = fieldDocs(ep.output);
  const top = ep.observed.keys.filter((k) => !["status", "record_count", "record"].includes(k));
  const props: Record<string, Schema> = fieldSchemas(top, docs);
  if (ep.observed.recordKeys)
    props.record = { type: "array", items: { type: "object", properties: fieldSchemas(ep.observed.recordKeys, docs) } };
  const name = `${pascal(ep.file)}Response`;
  schemas[name] = { allOf: [ref("schemas", "Envelope"), { type: "object", properties: props }] };
  return ref("schemas", name);
}

const CAVEATS = `
## 使用前必讀（實測發現的注意事項）

1. **錯誤也回傳 HTTP 200**：失敗時 \`status\` 為 \`Fail:<原因>\`（例如 \`Fail:version Error!\`、\`Fail:record count > 500\`）。
2. **參數名稱大小寫有別，打錯會被靜默忽略**：\`se.php\`／\`sesub.php\` 要用 \`VERSION\`、\`RANGE\`；\`sd.php\`、\`st.php\` 要用 \`N\`。小寫不會報錯，只會套用預設值。
3. **書卷編號錯誤時靜默改回預設書卷**（例如 \`qsub.php\` 超出 101-115 時回傳 101）；正典為 1-66，次經 101-115，使徒教父 201-217。
4. **\`qb.php\` 的 version 文件寫預設 nstrunv，但實際上必須給有效版本**（例如 unv），否則 \`Fail:version Error!\`。
5. **搜尋上限 500 筆**：\`se\`／\`sesub\`／\`seaf\`／\`ssc\` 符合超過 500 筆即失敗；請帶 \`limit\`（≤ 500）並以 \`offset\` 分頁。\`record_count\` 是本頁筆數，不是總數；總數請用 \`count_only=1\` 且不帶 \`limit\`（超過 500 時雖回 Fail，\`record_count\` 仍是總數）。
6. **範圍搜尋需 \`RANGE=3\`**：只給 \`range_bid\`／\`range_eid\` 會被忽略（\`sesub\`／\`seaf\` 甚至回 0 筆）。
7. **\`gb=1\` 也改變輸入的解讀**：查詢字串與書卷名要用簡體。
8. **回應格式不一定是 JSON**：\`listall.html\` 是 CSV（Content-Type 為 text/html 且無 charset，實為 UTF-8）；\`sesub.php\` 版本不存在時回 XML；\`qp.php\` 缺 chap/sec、\`st.php\` 缺 k/keyword 時回不合法的 JSON。
9. **欄位與參數名稱的 \`s\`／\`f\` 字尾是「簡稱／全名」，不是複數**：\`chineses\`＝中文簡稱（約）、\`chinesef\`＝中文全名（約翰福音）、\`engs\`＝英文簡稱（John）、\`engf\`＝英文全名。\`qaf.php\` 的 \`chineses\` 參數一次只指定一卷。
10. 部分譯本與浸宣字典僅授權給信望愛站使用，請查閱 https://www.fhl.net/main/fhl/fhl8.html 。
`;

/** The parameter exactly as the PHP endpoint takes it, with CUV book names / version names. */
function rawParam(spec: ApiSpec, ep: EndpointSpec, p: ParamSpec): Schema {
  const injected = ep.inject?.[p.name];
  const schema: Schema = {};
  const lower = p.name.toLowerCase();
  if (["bid", "range_bid", "range_eid"].includes(lower)) {
    const [lo, hi] = BID_BOUNDS[ep.bookSet ?? "canon"];
    const books = spec.books.filter((b) => b.bid >= lo && b.bid <= hi);
    schema.type = "integer";
    schema.enum = books.map((b) => b.bid);
    schema["x-enumDescriptions"] = Object.fromEntries(books.map((b) => [String(b.bid), b.chinesef ?? b.chineses]));
  } else if (lower === "chineses") {
    // FHL's naming: chineses/chinesef = Chinese short/full name (not a plural); one book per call.
    const [lo, hi] = BID_BOUNDS[ep.bookSet ?? "canon"];
    const books = spec.books.filter((b) => b.bid >= lo && b.bid <= hi);
    schema.type = "string";
    schema.enum = books.map((b) => b.chineses);
    schema["x-enumDescriptions"] = Object.fromEntries(books.map((b) => [b.chineses, `${b.bid} ${b.engs}`]));
  } else if (lower === "gb") {
    schema.type = "integer";
    schema.enum = [0, 1];
    schema["x-enumDescriptions"] = { "0": "繁體", "1": "簡體" };
  } else if (lower === "version" && ep.bibleVersions && spec.versions.length) {
    schema.type = "string";
    schema.enum = spec.versions.map((v) => v.code);
    schema["x-enumDescriptions"] = Object.fromEntries(spec.versions.map((v) => [v.code, v.name || v.code]));
  } else if (p.enum) {
    const numeric = p.enum.every((o) => /^\d+$/.test(o.code));
    schema.type = numeric ? "integer" : "string";
    schema.enum = p.enum.map((o) => (numeric ? Number(o.code) : o.code));
    schema["x-enumDescriptions"] = Object.fromEntries(p.enum.map((o) => [o.code, o.label]));
  } else {
    schema.type = p.type === "boolean" ? "integer" : p.type;
  }
  // Only advertise a default the server really applies; an injected value means "none works".
  if (p.default !== undefined && !injected) schema.default = schema.type === "integer" && /^\d+$/.test(p.default) ? Number(p.default) : p.default;
  return {
    name: p.name,
    in: "query",
    required: !!p.required || !!injected,
    description: p.description,
    schema,
    ...(injected ? { example: injected } : {}),
  };
}

export function openApi(spec: ApiSpec, origin: string) {
  const schemas: Record<string, Schema> = { ...SCHEMAS };
  // Dedupe identical parameters into components/parameters (first occurrence names it).
  const params: Record<string, Schema> = {};
  const byJson = new Map<string, string>();
  const counts = new Map<string, number>();
  const raw = spec.endpoints.map((ep) => ep.params.filter((p) => !p.fills).map((p) => rawParam(spec, ep, p)));
  for (const list of raw) for (const p of list) counts.set(JSON.stringify(p), (counts.get(JSON.stringify(p)) ?? 0) + 1);
  const useParam = (p: Schema) => {
    const json = JSON.stringify(p);
    if ((counts.get(json) ?? 0) < 2) return p;
    let name = byJson.get(json);
    if (!name) {
      name = String(p.name);
      for (let i = 2; params[name]; i++) name = `${p.name}_${i}`;
      params[name] = p;
      byJson.set(json, name);
    }
    return ref("parameters", name);
  };

  const paths: Record<string, unknown> = {};
  spec.endpoints.forEach((ep, i) => {
    const csv = ep.responseFormat === "csv";
    const qs = ep.example ? new URLSearchParams(Object.entries(ep.example).map(([k, v]) => [k, String(v)])).toString() : "";
    const sample = `${FHL}/api/${ep.file}${qs ? `?${qs}` : ""}`;
    paths[`/${ep.file}`] = {
      get: {
        operationId: ep.file.replace(/\W/g, "_"),
        summary: ep.purpose,
        description: [
          ep.notes?.length ? `**注意事項**\n\n${ep.notes.map((n) => `- ${n}`).join("\n")}` : "",
          `**正確用法範例**\n\n\`${sample}\``,
          ep.output ? `**輸出（原始說明）**\n\n\`\`\`\n${ep.output}\n\`\`\`` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        "x-codeSamples": [
          {
            lang: "JavaScript",
            label: "fetch",
            source: `const res = await fetch(${JSON.stringify(sample)});\nconst data = await res.json(); // 錯誤時 HTTP 仍為 200：請檢查 data.status`,
          },
          { lang: "Shell", label: "curl", source: `curl '${sample}'` },
        ],
        tags: [ep.bookSet === "apocrypha" ? "次經" : ep.bookSet === "fathers" ? "使徒教父" : "聖經"],
        parameters: raw[i].map(useParam),
        responses: {
          "200": csv
            ? { description: "CSV（Content-Type 為 text/html、未標示 charset，實為 UTF-8）", content: { "text/html": { schema: { type: "string" } } } }
            : { description: "JSON（錯誤時仍為 200，status 為 Fail:…）", content: { "application/json": { schema: responseSchema(ep, schemas) } } },
        },
      },
    };
  });

  return {
    openapi: "3.1.0",
    info: {
      title: spec.title,
      version: `1.0.0+${spec.hash}`,
      description:
        `本文件忠實描述信望愛站原始 PHP API（參數名稱大小寫、數字代碼），並補上實測發現的注意事項。` +
        `本服務**不代管也不轉送**這些 API；「Try it」直接呼叫 bible.fhl.net（原站支援 CORS）。\n\n` +
        `原始說明：https://bible.fhl.net/api/ （最後修改 ${spec.lastModified ?? "未知"}）。` +
        `給 LLM 用的智慧版工具（MCP／UTCP）說明請見 ${origin}/ 。\n${CAVEATS}`,
    },
    servers: [{ url: `${FHL}/api`, description: "信望愛站原站 PHP API" }],
    tags: [{ name: "聖經" }, { name: "次經" }, { name: "使徒教父" }],
    paths,
    components: { parameters: params, schemas },
  };
}
