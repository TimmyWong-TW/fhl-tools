/**
 * What the hosted smart tools may serve, per https://www.fhl.net/main/fhl/fhl8.html (2026-10-25).
 * Policy: serve only public-domain / expired-copyright content, plus content under an explicit
 * open licence (GFDL, CC); everything uncertain answers 401. The local stdio server (the user's own
 * machine fetching live, like browsing the site) serves everything by default.
 * Every allowed item carries the attribution the page asks for.
 */

export const PROVIDER = "信望愛站 https://bible.fhl.net";
export const TERMS = "https://www.fhl.net/main/fhl/fhl8.html";

export interface License {
  status: "public-domain" | "expired" | "open-license";
  notice: string;
}

const PD = (notice: string): License => ({ status: "public-domain", notice });
const EXP = (notice: string): License => ({ status: "expired", notice });

/** Bible text versions (ab.php codes) that may be served. Anything not listed -> 401. */
export const OPEN_VERSIONS: Record<string, License> = {
  unv: { status: "open-license", notice: "FHL和合本 · GNU Free Documentation License 1.1+（含 Strong's numbers，標記請勿移除）" },
  kjv: EXP("King James Version, 1611"),
  asv: EXP("American Standard Version, 1901"),
  darby: EXP("Darby, 1890"),
  erv: EXP("English Revised Version, 1885"),
  bbe: PD("Bible in Basic English, 1949 · 作者宣告為 public domain"),
  web: PD("World English Bible · public domain"),
  bhs: EXP("Biblia Hebraica Stuttgartensia 內文（不含校勘欄等資料）"),
  wlunv: EXP("深文理和合本, 1919"),
  wdv: EXP("委辦譯本, 1908"),
  mormil: EXP("神天聖書（馬禮遜米憐譯本）, 1823"),
  nt1864: EXP("新遺詔聖經, 1864"),
  lcc: EXP("呂振中譯本"),
  ofm: EXP("思高聖經譯釋本"),
  hakka: EXP("汕頭客語聖經, 1924"),
  bklcl: EXP("巴克禮全羅, 1933"),
  bklhl: PD("巴克禮漢羅 · 林俊育宣告為 public domain"),
  prebklcl: EXP("馬雅各全羅, 1898"),
  vietnamese: EXP("越南聖經, 1934"),
  russian: EXP("Russian Synodal Bible, 1876"),
  jp: EXP("日文聖經口語訳, 1955"),
};

export const APOCRYPHA_LICENSE = EXP("次經全書, 1933 中華聖公會書籍委員會");
export const STRONGS_LICENSE: License = { status: "open-license", notice: "FHL字典 · GNU Free Documentation License" };
export const OT_PARSING_LICENSE: License = {
  status: "open-license",
  notice: "舊約字彙分析 © 梁望惠 · CC BY-NC-SA 4.0（非商業使用、需署名、相同方式分享）；經文 BHS",
};
export const TOPICS_LICENSE = EXP("Torrey's Topical Textbook (1897) / Nave's Topical Bible (1896)");

/** au.php recordings that may be served (FHL-owned FDL readings of open texts, or explicit notice). */
export const OPEN_RECORDINGS: Record<string, License> = {
  和合本: { status: "open-license", notice: "和合本朗讀 © 信望愛 · GNU FDL（可商業使用）" },
  希伯來文: { status: "open-license", notice: "希伯來文朗讀 © 信望愛（金京來）· GNU FDL" },
  希臘文: {
    status: "open-license",
    notice: "Wescott-Hort Greek New Testament, 1881, read by Marilyn Phemister. Copyright 2001 by Marilyn Phemister. No other restrictions are placed on the use of these files if this copyright notice is maintained.",
  },
};

export function source(license: License | License[]) {
  const list = Array.isArray(license) ? license : [license];
  return { provider: PROVIDER, terms: TERMS, licenses: [...new Set(list.map((l) => l.notice))] };
}

/** sc.php commentary books that may be served (FHL's own commentary is GFDL per the copyright page). */
export const OPEN_COMMENTARIES: Record<number, License> = {
  3: { status: "open-license", notice: "信望愛站註釋（FHL註釋）· GNU Free Documentation License" },
};
export const DEFAULT_COMMENTARY = 3;

export const PLACES_LICENSE: License = { status: "public-domain", notice: "地名、座標與原文編號（事實資料）· 信望愛站聖經地理" };

/**
 * Rare books carry their own copyright line (ob.php `copyright`). Serve page images only for
 * books whose line grants free use: GNU FDL, or the National Library of Australia's
 * "註明出處為NLA後可以自由刊載" (credit NLA).
 */
export function rareBookLicense(copyright: string | undefined): License | undefined {
  const c = copyright ?? "";
  if (/GNU Free Documentation/i.test(c)) return { status: "open-license", notice: `珍本影像 · ${c}` };
  if (/NLA.*自由刊載/.test(c)) return { status: "open-license", notice: `珍本影像 · ${c}（來源：National Library of Australia）` };
  return undefined;
}
