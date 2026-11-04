import { OVERRIDES, applyOverrides, type Override } from "./overrides";
import { DOCS_URL, parseApiPage, sha256 } from "./scaffold";
import type { ApiSpec, Book, EndpointSpec, Version } from "./types";
import { BID_BOUNDS, BID_RANGE, usfmOf } from "./usfm";

/** Shape of test/fixtures/findings.json `results` (written by scripts/probe.ts). */
export type Findings = Record<string, { sectionHash: string; observations: { label: string; keys?: string[]; recordKeys?: string[] }[] }>;

/**
 * Build-time only: docs HTML + confirmed overrides -> ApiSpec.
 * Run via `pnpm build:spec`; the Worker imports the generated JSON and never parses at runtime.
 */
export async function buildSpec(
  html: string,
  meta: { etag?: string; lastModified?: string; fetchedAt: string; books?: Book[]; versions?: Version[] },
  overrides: Record<string, Override> = OVERRIDES,
  findings: Findings = {},
): Promise<{ spec: ApiSpec; stale: string[] }> {
  const page = await parseApiPage(html);
  const { endpoints, stale } = applyOverrides(page.endpoints, overrides);
  for (const ep of endpoints) {
    addBookParams(ep);
    const f = findings[ep.file];
    const sample = f?.sectionHash === ep.sectionHash ? f.observations.find((o) => o.label === "sample" && o.keys) : undefined;
    if (sample) ep.observed = { keys: sample.keys!, ...(sample.recordKeys ? { recordKeys: sample.recordKeys } : {}) };
  }
  const spec: ApiSpec = {
    source: DOCS_URL,
    title: page.title,
    notice: page.notice,
    etag: meta.etag,
    lastModified: meta.lastModified,
    fetchedAt: meta.fetchedAt,
    hash: (await sha256(JSON.stringify(endpoints))).slice(0, 16),
    endpoints,
    versions: (meta.versions ?? []).map((v) => ({ ...v })),
    books: (meta.books ?? []).map((b) => ({ ...b, aliases: [...b.aliases], ...(usfmOf(b.bid) ? { usfm: usfmOf(b.bid) } : {}) })),
  };
  return { spec, stale };
}

/** Documents the bid numbering (range per book set) on bid / range_bid / range_eid. */
export function addBookParams(ep: EndpointSpec): void {
  const set = ep.bookSet ?? "canon";
  for (const p of ep.params)
    if (["bid", "range_bid", "range_eid"].includes(p.name.toLowerCase())) {
      p.description += `（書卷編號 ${BID_RANGE[set]}）`;
      [p.minimum, p.maximum] = BID_BOUNDS[set];
    }
}
