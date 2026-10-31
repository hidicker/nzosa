/**
 * Bundle the MCP tools for the connector edge function.
 *
 *   node tools/build-mcp-function.mjs
 *
 * The connector answers with the same tools and checks as the server on a
 * person's own computer (packages/mcp). Supabase deploys what is in the
 * function's folder, so this writes supabase/functions/mcp/tools.js, which is
 * built output and not kept in git. Run it before deploying the function:
 *
 *   npx supabase functions deploy mcp --no-verify-jwt --use-api --project-ref <ref>
 */
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(root, "packages", "mcp", "src", "hosted.ts")],
  bundle: true,
  platform: "neutral",
  mainFields: ["module", "main"],
  format: "esm",
  target: ["es2022"],
  // The local server's standard input reader comes along with the protocol
  // and is never called here; Deno has it anyway.
  external: ["node:*"],
  outfile: join(root, "supabase", "functions", "mcp", "tools.js"),
  banner: { js: "// Built by tools/build-mcp-function.mjs from packages/mcp/src/hosted.ts. Do not edit.\n// @ts-nocheck" },
  logLevel: "warning",
});
console.log("Built supabase/functions/mcp/tools.js");
