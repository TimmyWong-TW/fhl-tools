export interface EnumOption {
  code: string;
  label: string;
}

export interface Book {
  bid: number;
  engs: string;
  chineses: string;
  engf?: string;
  chinesef?: string;
  aliases: string[];
  usfm?: string;
}

export interface Version {
  code: string;
  name: string;
  strong: boolean;
  ntonly: boolean;
  otonly: boolean;
}

export interface ParamSpec {
  /** Name exactly as documented (case matters upstream, e.g. `VERSION`). */
  name: string;
  /** Name exposed to MCP/UTCP/OpenAPI clients (lowercase unless it would collide). */
  key: string;
  description: string;
  type: "string" | "integer" | "boolean";
  /** Inclusive numeric range (e.g. bid 1-66); enforced by the smart layer. */
  minimum?: number;
  maximum?: number;
  /** Synthetic param (not sent upstream): fills this upstream param, via its enum code, when the caller omits it. */
  fills?: string;
  default?: string;
  enum?: EnumOption[];
  required?: boolean;
}

export type ResponseFormat = "json" | "csv" | "xml" | "text";

export interface EndpointSpec {
  /** Upstream file, e.g. `qb.php`. */
  file: string;
  /** Tool name, e.g. `fhl_qb`. */
  tool: string;
  /** 用途 line. */
  purpose: string;
  /** Rendered 輸出 text (plain). */
  output: string;
  params: ParamSpec[];
  /** SHA-256 of the normalised section text; overrides are pinned to it. */
  sectionHash: string;
  responseFormat: ResponseFormat;
  csvColumns?: string[];
  /** Mutually exclusive / precedence notes confirmed by probing. */
  notes?: string[];
  example?: Record<string, string | number>;
  /** Upstream params the proxy fills in when the caller omits them (documented default broken). */
  inject?: Record<string, string>;
  /** Response keys seen by the probe for the sample call (only kept while the docs section is unchanged). */
  observed?: { keys: string[]; recordKeys?: string[] };
  /** Shared OpenAPI response family. */
  responseSchema?: "VerseList" | "SearchResult";
  /** Groups of client keys of which at most one may be given (e.g. [["bid","usfm"]]). */
  exclusive?: string[][];
  /** Validate `version` against the Bible text versions from ab.php. */
  bibleVersions?: boolean;
  /** Which book numbering bid/range_* use. */
  bookSet?: "canon" | "apocrypha" | "fathers";
  /** Licensed only to FHL (僅授權給信望愛站使用); unlisted; calls need special auth (401 for now). */
  restricted?: boolean;
  /** True when a hash-matched override was applied. */
  confirmed: boolean;
}

export interface ApiSpec {
  source: string;
  title: string;
  notice: string;
  etag?: string;
  lastModified?: string;
  /** Hash of the generated endpoints; used as ETag and cache-key component. */
  hash: string;
  /** When the docs snapshot was fetched. */
  fetchedAt: string;
  endpoints: EndpointSpec[];
  books: Book[];
  versions: Version[];
}

export interface Snapshot {
  html: string;
  etag?: string;
  lastModified?: string;
  fetchedAt: string;
  books: Book[];
  versions: Version[];
}
