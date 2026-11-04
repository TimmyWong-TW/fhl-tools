// Local MCP server over stdio (newline-delimited JSON-RPC), run on the user's own machine.
// Fetches bible.fhl.net live from the user's machine with no cache, like the user browsing the site,
// so by default everything is served for personal use. FHL_RESTRICTED=1 applies the hosted policy.
import { createInterface } from "node:readline";
import { handleRpc } from "./mcp";
import generated from "./spec.generated.json";
import { liveUpstream, type Ctx } from "./tools";
import type { ApiSpec } from "./types";

const ctx: Ctx = {
  spec: generated as unknown as ApiSpec,
  upstream: liveUpstream(),
  unrestricted: process.env.FHL_RESTRICTED !== "1",
};

process.stderr.write(`fhl-tools stdio MCP server (${ctx.unrestricted ? "all content, personal use only; FHL_RESTRICTED=1 for the hosted policy" : "hosted policy (FHL_RESTRICTED=1)"})\n`);

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
    return;
  }
  const msgs = Array.isArray(msg) ? msg : [msg];
  const out = (await Promise.all(msgs.map((m) => handleRpc(m, ctx)))).filter(Boolean);
  if (out.length) process.stdout.write(JSON.stringify(Array.isArray(msg) ? out : out[0]) + "\n");
});
