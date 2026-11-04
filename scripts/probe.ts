// Live sweep of every endpoint scaffolded from https://bible.fhl.net/api/.
// Writes test/fixtures/findings.json (raw observations + derived facts) for docs/FINDINGS.md
// and src/overrides.ts. Throttled; run sparingly: `pnpm probe`.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const here = (p: string) => fileURLToPath(import.meta.url + "/../" + p);
import { DOCS_URL, UPSTREAM_BASE, parseApiPage, sha256 } from "../src/scaffold";
import { sniffFormat, upstreamUrl } from "../src/upstream";
import type { EndpointSpec } from "../src/types";

const DELAY_MS = Number(process.env.PROBE_DELAY_MS ?? 500);
const ONLY = process.env.PROBE_ONLY?.split(",");

/** Known-good argument sets (by documented param name) that should return records. */
const SAMPLES: Record<string, Record<string, string | number>> = {
  "abv.php": {},
  "ab.php": {},
  "listall.html": {},
  "qb.php": { bid: 43, chap: 3, sec: "16" },
  "rt.php": { bid: 43, chap: 3, version: "tcv" },
  "qp.php": { bid: 43, chap: 3, sec: 16 },
  "sc.php": { book: 3, bid: 43, chap: 3, sec: 16 },
  "ssc.php": { book: 3, key: "尼哥底母" },
  "sd.php": { N: 0, k: "25" },
  "sbdag.php": { k: "25" },
  "stwcbhdic.php": { k: "1" },
  "qsb.php": { qstr: "約 3:16" },
  "se.php": { q: "愛", limit: 3 },
  // se.php VERSION case check needs an English query to show a difference with kjv.
  "ob.php": {},
  "sob.php": { book: "all", bid: 43, chap: 3, sec: 16 },
  "sobj.php": { engs: "John", chap: 2, sec: 1 },
  "st.php": { N: 4, keyword: "愛" },
  "au.php": { version: 0, bid: 43, chap: 3 },
  "aump4.php": { version: 17, bid: 43, chap: 3 },
  "qsub.php": { bid: 101, chap: 1 },
  "qaf.php": { bid: 201, chap: 1 },
  "sesub.php": { q: "主", limit: 3 },
  "seaf.php": { q: "主", limit: 3 },
};

/** Explicitly documented / suspected exclusive or precedence pairs. */
const EXTRA: Record<string, { label: string; args: Record<string, string | number> }[]> = {
  "sc.php": [
    { label: "validbook only", args: { validbook: 1 } },
    { label: "validbook + sample", args: { validbook: 1, book: 3, bid: 43, chap: 3, sec: 16 } },
    { label: "multi book 1,3", args: { book: "1,3", bid: 43, chap: 3, sec: 16 } },
  ],
  "st.php": [
    { label: "k only", args: { N: 4, k: 1 } },
    { label: "k + keyword", args: { N: 4, k: 1, keyword: "愛" } },
  ],
  "sob.php": [
    { label: "engs instead of bid", args: { book: "all", engs: "John", chap: 3, sec: 16 } },
    { label: "bid + conflicting engs", args: { book: "all", bid: 43, engs: "Gen", chap: 3, sec: 16 } },
    { label: "mode 0 book 1", args: { book: 1, bid: 43, chap: 3, sec: 16 } },
  ],
  "qb.php": [
    { label: "sec list 1-2,5", args: { bid: 43, chap: 3, sec: "1-2,5" } },
    { label: "whole chapter", args: { bid: 43, chap: 3 } },
  ],
  "qsub.php": [{ label: "sec range 1-3", args: { bid: 101, chap: 1, sec: "1-3" } }],
  "qaf.php": [
    { label: "sec range 1-3", args: { bid: 201, chap: 1, sec: "1-3" } },
    { label: "chineses default only", args: { chap: 1 } },
  ],
  "se.php": [
    { label: "range 3 John only", args: { q: "愛", RANGE: 3, range_bid: 43, range_eid: 43, limit: 3 } },
    { label: "greek number", args: { q: "25", orig: 1, limit: 3 } },
  ],
  "rt.php": [{ label: "with id 1", args: { bid: 43, chap: 3, version: "tcv", id: 1 } }],
};

interface Obs {
  label: string;
  url: string;
  http: number;
  contentType: string;
  format: string;
  bytes: number;
  bodyHash: string;
  status?: unknown;
  record_count?: unknown;
  keys?: string[];
  recordKeys?: string[];
  error?: string;
  snippet?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function hit(label: string, url: string): Promise<Obs> {
  await sleep(DELAY_MS);
  try {
    const res = await fetch(url);
    const raw = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    const format = sniffFormat(raw, contentType);
    const o: Obs = {
      label,
      url,
      http: res.status,
      contentType,
      format,
      bytes: raw.length,
      bodyHash: (await sha256(raw)).slice(0, 12),
    };
    if (format === "json") {
      const j = JSON.parse(raw.replace(/^﻿/, ""));
      if (j && typeof j === "object" && !Array.isArray(j)) {
        o.status = j.status;
        o.record_count = j.record_count;
        o.keys = Object.keys(j);
        const r = Array.isArray(j.record) ? j.record[0] : undefined;
        if (r && typeof r === "object") o.recordKeys = Object.keys(r);
      }
    } else o.snippet = raw.slice(0, 160);
    return o;
  } catch (e) {
    return { label, url, http: 0, contentType: "", format: "error", bytes: 0, bodyHash: "", error: String(e) };
  }
}

function rawUrl(file: string, args: Record<string, string | number>): string {
  const qs = new URLSearchParams(Object.entries(args).map(([k, v]) => [k, String(v)])).toString();
  return UPSTREAM_BASE + file + (qs ? `?${qs}` : "");
}

const good = (o: Obs) =>
  o.http === 200 && o.format !== "error" && (o.format !== "json" || (o.status === "success" && Number(o.record_count ?? 1) > 0));

const page = await parseApiPage(await (await fetch(DOCS_URL)).text());
const results: Record<string, unknown> = {};

for (const p of page.endpoints) {
  if (ONLY && !ONLY.includes(p.file)) continue;
  const ep: EndpointSpec = { ...p, responseFormat: "json", confirmed: false };
  const sample = SAMPLES[ep.file] ?? {};
  const obs: Obs[] = [];
  const u = (a: Record<string, string | number>) => upstreamUrl(ep, a);

  obs.push(await hit("no args", u({})));
  const base = await hit("sample", u(sample));
  obs.push(base);

  const required: string[] = [];
  for (const k of Object.keys(sample)) {
    const { [k]: _, ...rest } = sample;
    const o = await hit(`drop ${k}`, u(rest));
    obs.push(o);
    if (good(base) && !good(o)) required.push(k);
  }

  const enumEffect: Record<string, { label: string; code: string; ok: boolean; bodyHash: string }[]> = {};
  for (const prm of ep.params.filter((x) => x.enum)) {
    enumEffect[prm.name] = [];
    for (const opt of prm.enum!) {
      const o = await hit(`${prm.name}=${opt.label}`, u({ ...sample, [prm.key]: opt.label }));
      obs.push(o);
      enumEffect[prm.name].push({ label: opt.label, code: opt.code, ok: good(o), bodyHash: o.bodyHash });
    }
  }

  const caseSensitive: Record<string, boolean> = {};
  for (const prm of ep.params.filter((x) => x.name !== x.name.toLowerCase())) {
    // Use a value that differs from the default, otherwise both spellings look identical.
    const value = /version/i.test(prm.name)
      ? "kjv"
      : (prm.enum?.find((o) => o.code !== prm.default && String(sample[prm.name] ?? "") !== o.code)?.code ?? "1");
    const withDoc = await hit(`case ${prm.name}`, rawUrl(ep.file, { ...sample, [prm.name]: value }));
    const withLower = await hit(`case ${prm.name.toLowerCase()}`, rawUrl(ep.file, { ...sample, [prm.name.toLowerCase()]: value }));
    obs.push(withDoc, withLower);
    caseSensitive[prm.name] = withDoc.bodyHash !== withLower.bodyHash;
  }

  const changesResult: string[] = [];
  for (const prm of ep.params.filter((x) => !x.enum && !(x.name in sample))) {
    const value = prm.default ?? (prm.type === "integer" ? 1 : "1");
    const o = await hit(`add ${prm.name}=${value}`, u({ ...sample, [prm.name]: value }));
    obs.push(o);
    if (o.bodyHash !== base.bodyHash) changesResult.push(prm.name);
  }

  for (const x of EXTRA[ep.file] ?? []) obs.push(await hit(x.label, u(x.args)));

  results[ep.file] = {
    sectionHash: ep.sectionHash,
    sample,
    formats: [...new Set(obs.map((o) => `${o.format} (${o.contentType})`))],
    requiredCandidates: required,
    enumEffect,
    caseSensitive,
    addingChangesResult: changesResult,
    observations: obs,
  };
  console.log(`${ep.file}: ${obs.length} probes, formats ${(results[ep.file] as any).formats.join(" | ")}, required? ${required.join(",") || "-"}`);
}

writeFileSync(
  here("../test/fixtures/findings.json"),
  JSON.stringify({ probedAt: new Date().toISOString(), docs: DOCS_URL, results }, null, 2),
);
console.log("wrote test/fixtures/findings.json");
