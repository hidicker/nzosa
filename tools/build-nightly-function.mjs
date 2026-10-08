/**
 * Bundle the morning run for the nightly edge function.
 *
 *   node tools/build-nightly-function.mjs
 *
 * The run is the page's own code (apps/web/src/nightly-run.ts), so the morning
 * and the page agree about every line. Supabase deploys what is in the
 * function's folder, so this writes supabase/functions/nightly/run.js, which is
 * built output and not kept in git. Run it before deploying the function:
 *
 *   npx supabase functions deploy nightly --no-verify-jwt --use-api --project-ref <ref>
 */
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [join(root, "apps", "web", "src", "nightly-run.ts")],
  bundle: true,
  platform: "neutral",
  mainFields: ["module", "main"],
  format: "esm",
  target: ["es2022"],
  define: { __NZOSA_EDITION__: JSON.stringify(process.env.NZOSA_EDITION ?? "nz") },
  outfile: join(root, "supabase", "functions", "nightly", "run.js"),
  banner: { js: "// Built by tools/build-nightly-function.mjs from apps/web/src/nightly-run.ts. Do not edit.\n// @ts-nocheck" },
  logLevel: "warning",
});
