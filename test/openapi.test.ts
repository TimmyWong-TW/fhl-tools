import { describe, expect, it } from "vitest";
import generated from "../src/spec.generated.json";
import { openApi } from "../src/openapi";
import type { ApiSpec } from "../src/types";

const full = generated as unknown as ApiSpec;
const spec = { ...full, endpoints: full.endpoints.filter((e) => !e.restricted) };
const doc: any = openApi(spec, "https://w.example");
const resolve = (p: any) => (p.$ref ? doc.components.parameters[p.$ref.split("/").pop()] : p);
const params = (file: string) => doc.paths[`/${file}`].get.parameters.map(resolve);

describe("OpenAPI mirrors the PHP API exactly", () => {
  it("keeps documented names and casing, no smart params", () => {
    expect(params("se.php").map((p: any) => p.name)).toContain("VERSION");
    expect(params("se.php").map((p: any) => p.name)).toContain("RANGE");
    expect(params("qb.php").map((p: any) => p.name)).not.toContain("usfm");
    expect(JSON.stringify(doc)).not.toMatch(/"usfm"/);
  });
  it("uses numeric codes, not labels or booleans", () => {
    const gb = params("qb.php").find((p: any) => p.name === "gb");
    expect(gb.schema).toMatchObject({ type: "integer", enum: [0, 1], "x-enumDescriptions": { "0": "繁體", "1": "簡體" } });
    const ch = params("qaf.php").find((p: any) => p.name === "chineses");
    expect(ch.schema.enum).toHaveLength(17);
    expect(ch.schema.default).toBe("革利免一書");
  });
  it("marks qb version required with no (broken) default", () => {
    const v = params("qb.php").find((p: any) => p.name === "version");
    expect(v.required).toBe(true);
    expect(v.schema.default).toBeUndefined();
  });
  it("reuses shared parameters and response schemas", () => {
    expect(doc.paths["/qb.php"].get.parameters.some((p: any) => p.$ref)).toBe(true);
    expect(doc.components.parameters.gb).toBeDefined();
    const qb = doc.paths["/qb.php"].get.responses["200"].content["application/json"].schema;
    expect(qb).toEqual({ $ref: "#/components/schemas/VerseList" });
    expect(doc.components.schemas.VerseList.allOf[0]).toEqual({ $ref: "#/components/schemas/Envelope" });
    expect(doc.components.schemas.SobjResponse.allOf[1].properties.record.items.properties).toHaveProperty("hsnum");
  });
  it("leaves out restricted endpoints", () => {
    expect(doc.paths["/sbdag.php"]).toBeUndefined();
  });
});
