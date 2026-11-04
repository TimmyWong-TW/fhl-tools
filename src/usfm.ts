/**
 * USFM book codes for FHL book ids. Canon 1-66 in FHL (Protestant) order; FHL apocrypha 101-115.
 * The Apostolic Fathers (201-217) have no USFM codes and stay numeric.
 */
const CANON =
  "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL " +
  "MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV";

// 101 1Mc 馬一, 102 2Mc 馬二, 103 Tb 比, 104 Jth 滴, 105 Sir 便, 106 Ws 所, 107 1Es 拉上, 108 2Es 拉下,
// 109 Bar 巴, 110 EpJer 耶信, 111 PrM 禱, 112 STHC 童, 113 Sus 蘇, 114 Bel 勒, 115 Re 斯補 (Greek additions to Esther)
const APOCRYPHA = "1MA 2MA TOB JDT SIR WIS 1ES 2ES BAR LJE MAN S3Y SUS BEL ESG";

export type BookSet = "canon" | "apocrypha" | "fathers";

export const USFM: Record<Exclude<BookSet, "fathers">, { code: string; bid: number }[]> = {
  canon: CANON.split(" ").map((code, i) => ({ code, bid: i + 1 })),
  apocrypha: APOCRYPHA.split(" ").map((code, i) => ({ code, bid: 101 + i })),
};

export const BID_RANGE: Record<BookSet, string> = {
  canon: "1-66（1 創世記 … 43 約翰福音 … 66 啟示錄）",
  apocrypha: "101-115（101 馬加比一書 … 115 以斯帖補篇）",
  fathers: "201-217（201 革利免一書 … 217 衆長老的傳統）",
};

export const BID_BOUNDS: Record<BookSet, [number, number]> = { canon: [1, 66], apocrypha: [101, 115], fathers: [201, 217] };

export function usfmOf(bid: number): string | undefined {
  return [...USFM.canon, ...USFM.apocrypha].find((b) => b.bid === bid)?.code;
}
