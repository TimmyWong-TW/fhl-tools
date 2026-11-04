// Scaffolds src/spec.generated.json from the docs snapshot (src/snapshot.ts) + src/overrides.ts.
// Fails if any override no longer matches its docs section: re-probe and update overrides first.
// Refresh the snapshot itself with `pnpm snapshot`.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { buildSpec, type Findings } from "../src/spec";
import { OVERRIDES } from "../src/overrides";
import { SNAPSHOT } from "../src/snapshot";

const out = fileURLToPath(import.meta.url + "/../../src/spec.generated.json");
const findings: Findings = JSON.parse(readFileSync(fileURLToPath(import.meta.url + "/../../test/fixtures/findings.json"), "utf8")).results;
const { spec, stale } = await buildSpec(SNAPSHOT.html, SNAPSHOT, OVERRIDES, findings);
if (stale.length) {
  console.error(`Stale overrides (docs section changed): ${stale.join(", ")}\nRun pnpm probe, review, update src/overrides.ts.`);
  process.exit(1);
}
writeFileSync(out, JSON.stringify(spec, null, 2) + "\n");
const confirmed = spec.endpoints.filter((e) => e.confirmed).length;
console.log(`spec ${spec.hash}: ${spec.endpoints.length} endpoints (${confirmed} confirmed), docs Last-Modified ${spec.lastModified}`);
