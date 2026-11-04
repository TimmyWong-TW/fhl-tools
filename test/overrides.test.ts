import { describe, expect, it } from "vitest";
import findingsJson from "./fixtures/findings.json";
import { OVERRIDES, applyOverrides } from "../src/overrides";
import { parseApiPage } from "../src/scaffold";
import { SNAPSHOT } from "../src/snapshot";
import { buildQuery } from "../src/upstream";

const page = await parseApiPage(SNAPSHOT.html);
const findings: any = (findingsJson as any).results;

describe("overrides vs snapshot and probe findings", () => {
  it("every override is pinned to the current snapshot section", () => {
    const { stale } = applyOverrides(page.endpoints);
    expect(stale).toEqual([]);
    for (const [file, o] of Object.entries(OVERRIDES)) expect(findings[file]?.sectionHash, file).toBe(o.sectionHash);
  });

  it("required params were observed as required (or are documented-only requirements)", () => {
    for (const [file, o] of Object.entries(OVERRIDES))
      for (const r of o.required ?? [])
        expect(page.endpoints.find((e) => e.file === file)!.params.map((p) => p.name), `${file}.${r}`).toContain(r);
  });

  it("probe confirms the case sensitivity that the proxy corrects", () => {
    expect(findings["se.php"].caseSensitive).toEqual({ VERSION: true, RANGE: true });
    expect(findings["sd.php"].caseSensitive.N).toBe(true);
  });

  it("probe confirms qb.php fails without a usable version, and inject fixes it", () => {
    const qb = findings["qb.php"].observations;
    expect(qb.every((o: any) => String(o.status).startsWith("Fail:version"))).toBe(true);
    const ep = applyOverrides(page.endpoints).endpoints.find((e) => e.file === "qb.php")!;
    expect(buildQuery(ep, { bid: 43 }).get("version")).toBe("unv");
    expect(buildQuery(ep, { bid: 43, version: "kjv" }).get("version")).toBe("kjv");
  });

  it("probe saw the format oddities the converters handle", () => {
    expect(findings["listall.html"].formats.join()).toMatch(/csv/);
    expect(findings["sesub.php"].formats.join()).toMatch(/xml/);
    expect(findings["st.php"].formats.join()).toMatch(/text/);
  });
});
