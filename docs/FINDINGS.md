# FHL Bible API: findings, problems, and hidden caveats

These are probe results for https://bible.fhl.net/api/, compared against what its documentation page says.

- **Probed:** 2026-11-04, with `pnpm probe` (about 250 throttled requests).
- **Docs page version:** `Last-Modified: Sat, 24 Oct 2026 13:05:45 GMT`, `ETag: W/"6adcad29-6371"`.
- **Raw observations:** [test/fixtures/findings.json](../test/fixtures/findings.json).
- **What the Worker does with these findings:** the facts below are encoded in [src/overrides.ts](../src/overrides.ts). Each override is pinned to a section hash, and `pnpm build:spec` fails if that section of the docs changes.

## 1. The docs page as a machine-readable spec

| Aspect | Consistency | Notes |
| --- | --- | --- |
| Section boundaries | Good | Every endpoint starts with `<section>` + `名稱：`. `qsb.php` and `seaf.php` are never closed. An empty `<section></section>` follows `qsb.php`. |
| Parameter list | Mostly good | It is the first `<table>` after `接受參數`. Exceptions: `ab.php` and `listall.html` say `無`, and `abv.php` gives its parameter inline with no table. `ab.php` has no `輸出：` label. |
| Defaults | Fair | Written as `default:X`, `default:名稱(code)`, `default:unlimited`, or `（內定）` after an enum label. `qsb.bid` says `default 書卷編號`, which isn't a value. |
| Enums | Fair | Written as `n:label`, `n：label` (full-width colon), or `n.label`. The `au.php` list skips 16. |
| Types / required / exclusivity | **Absent** | Never stated. Everything in the table below was inferred by probing. |
| Response format | **Wrong in places** | See section 3. |
| Parameter casing | **Undocumented and significant** | See section 2. |

## 2. Critical caveats

1. **Parameter names are case-sensitive, and wrong casing is silently ignored.** `se.php` and `sesub.php` need `VERSION` and `RANGE`; `sd.php` and `st.php` need `N`. A lowercase name returns a success response with the default behaviour, not an error. The proxy maps names to the documented case.
2. **`qb.php` has a broken default.** The docs say `version` defaults to `nstrunv`. In practice, both omitting `version` and passing `version=nstrunv` return `{"status":"Fail:version Error!"}`. `unv` works. The proxy injects `version=unv` when it's missing.
3. **Errors are reported as HTTP 200 with `status: "Fail:…"`**, never as an HTTP error. MCP results are marked `isError` whenever `status !== "success"`.
4. **Search endpoints have a hard 500-record cap.** `se`, `sesub`, `seaf` and `ssc` fail with `Fail:record count > 500` when there are too many matches, even though `limit` is documented as "unlimited". The proxy injects `limit=100` for `se`, `sesub` and `seaf`. `ssc` has no `limit` parameter; the only option is a more specific keyword.
5. **`gb` also changes how input text is interpreted**, not just the output script. With `gb=1` (簡體), a Traditional-script query (`q=愛`, `qstr=約 3:16`) matches nothing.

## 3. Response formats (verified)

| Endpoint | Content-Type | Actual body | Converted to |
| --- | --- | --- | --- |
| Most `*.php` | `application/json` | JSON with `\u` escapes | passed through |
| `listall.html` | `text/html`, **no charset** (UTF-8 bytes, so browsers show mojibake) | **CSV with 6 columns** (the docs list 5; 中文全名 is undocumented) | `{record_count, record:[{id,engs,engf,chineses,chinesef,engs_short}]}` |
| `rt.php` | `application/json` | **JSON**, although the docs describe `<result>` XML | passed through |
| `sesub.php` with an unknown `VERSION` | `application/json` | **XML**: `<result><status>Fail:kjv not found!</status></result>` | JSON |
| `sbdag.php`, `stwcbhdic.php` | **`text/html`** | JSON | parsed by sniffing the body |
| `stwcbhdic.php` without `k` | **HTTP 500** | truncated JSON | returned as text, `isError` |
| `qp.php` without `chap`/`sec` | `application/json` | **invalid JSON** | returned as text |
| `st.php` without `k`/`keyword` | `application/json` | **invalid JSON** (`"book":,`), 40–415 KB | returned as text |

## 4. Per-endpoint findings

| Endpoint | Required in practice | Exclusivity / precedence | Doc discrepancies and quirks |
| --- | --- | --- | --- |
| abv | – | – | 89 records (ab returns 87) |
| ab | – | – | no `輸出：` label in the docs |
| qb | (`version`, injected) | – | broken `version` default (see 2.3); `sec` accepts `1-2,5` |
| rt | `bid`, `id` | – | without `id`, always returns 0 records; `chap` has no effect |
| qp | `bid`, `chap`, `sec` | – | a missing `bid` gives `Fail:engs error!`; a missing `chap`/`sec` gives invalid JSON |
| sc | `bid`, `chap`, `sec` | **`validbook=1` overrides all other parameters**; `book` accepts `1,3` | without `book`, a default commentary is used |
| ssc | `key` | – | 500-record cap, and no `limit` parameter |
| sd | `k` | – | `N` is case-sensitive; without `k`, returns a default entry |
| sbdag / stwcbhdic | `k` | – | served as `text/html`; stwcbhdic returns HTTP 500 without `k` |
| qsb | `qstr` | **`bid` is the default book for a `qstr` without one** (`qstr=3:16&bid=43` → 約 3:16); a book in `qstr` wins | `qstr` accepts Chinese or English names and `;`-separated lists; `gb` affects how `qstr` is parsed |
| se | `q` (+ `limit`, injected) | `range_bid`/`range_eid` only apply when `RANGE=範圍` | case sensitivity; 500 cap; `orig=希臘文編號` needs a Strong's number in `q` |
| ob | – | `id` filters to one book | without `id`: 463 records, about 360 KB |
| sob | `bid` **or** `engs` | **`bid` wins over `engs`**; `book=all` gives mode 1, a number gives mode 0 | no `record_count` in the response; mode 0 without a matching page returns empty |
| sobj | `engs`, `chap` | without `sec`, returns the whole chapter | real field names are `hsnum`/`gsnum`, not the documented `hsname`/`gsname` |
| st | `k` **or** `keyword` | **`k` wins over `keyword`** | `N` defaults to 0 (torrey英文), so Chinese keywords need `N=全部查詢`/中譯; invalid JSON when neither `k` nor `keyword` is given |
| au / aump4 | – | – | every listed `version` returns a different recording |
| qsub | – | – | `bid` is 101–115, and an out-of-range value silently falls back to 101; the real `version` default is `c1933`, and the documented `nstrunv` returns 0 records |
| qaf | – | – | `bid` is 201–217, and an out-of-range value silently falls back to 201; `chineses` also selects the book |
| sesub / seaf | `q` (+ `limit`, injected) | **providing `range_bid`/`range_eid` alone (with `RANGE` 0) returns 0 records** | a bad `VERSION` returns XML |

## 5. Book ids (`bid`, `range_bid`, `range_eid`)

- **1–66:** the canon in Protestant order. This matches the first column of `listall.html` (1 創 … 43 約 … 66 啟). `qb.php` with `bid=67` returns 0 records.
- **101–115:** the apocrypha (`qsub`, and `sesub` ranges): 101 馬一 … 115 斯補.
- **201–217:** the apostolic fathers (`qaf`, and `seaf` ranges): 201 革利免一書 … 217 衆長老的傳統.

The docs say only "經卷編號". `pnpm snapshot` builds the full table from `listall.html` plus `qsub`/`qaf` responses. The Worker uses it to accept book names (約, 約翰福音, John, Jn) as well as numbers.

**Probe limitation (fixed by hand):** the first sweep reported "`bid`/`chap` have no effect" on `qsub`/`qaf`. That was because the sample values matched the defaults (101/201, chapter 1), so dropping them changed nothing. Hand-testing other values showed they work.

## 6. Other observations

- **Transient inconsistency:** one `se.php?RANGE=1` call returned Old Testament results once, then returned New Testament results on every repeat. Upstream may have intermittent caching or replication lag.
- **Naming:** the `s`/`f` suffix means short/full, not plural: `chineses` (約), `chinesef` (約翰福音), `engs` (John), `engf`. `qaf.php`'s `chineses` parameter takes exactly one book.
- **Size:** `ob.php` without arguments returns about 360 KB, and an unfiltered `st.php` up to 415 KB. Agents should narrow these queries.
- **Licensing:** per FHL's copyright page (2026-10-25), most modern translations, the NA/UBS Greek text, the 浸宣 dictionaries and many recordings are licensed only to FHL ("授權本會於網頁使用"). The hosted tools serve only public-domain, expired or openly licensed (GFDL, CC) content, always with a `source` attribution. Everything else is a 401 or a tool error, and is served only by the local stdio server, which fetches FHL live from the user's own machine and serves everything by default (`FHL_RESTRICTED=1` applies the hosted policy). See [src/licenses.ts](../src/licenses.ts).

## 7. Re-validating

1. Run `pnpm snapshot && pnpm probe`.
2. Compare the new `test/fixtures/findings.json`.
3. Update `src/overrides.ts`, including its section hashes, and this file.
4. Run `pnpm test`. `test/overrides.test.ts` fails if an override's hash or a recorded fact no longer matches.

---

<sub>Afternote: `https://bible.fhl.net/json/*.php` (undocumented, found by accident) serves the same filenames with legacy semantics: it ignores `bid`, and one of its error messages exposes raw SQL. Not used here.</sub>
