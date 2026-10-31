// Builds the Claude Desktop extension for the MCP server: one file, opened in
// Claude Desktop, which asks for the books folder and installs the server.
//
//   npm run build && node tools/build-mcpb.mjs
//
// The extension is a zip holding the compiled server, the compiled core it
// imports (core has no dependencies, so there is nothing else to bundle), a
// manifest, and the licence files. Output: packages/mcp/nzosa.mcpb
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mcp = join(root, "packages", "mcp");
const core = join(root, "packages", "core");
const stage = join(mcp, "mcpb-stage");
const out = join(mcp, "nzosa.mcpb");

for (const needed of [join(mcp, "dist", "server.js"), join(core, "dist", "index.js")]) {
  if (!existsSync(needed)) {
    console.error(`${needed} is missing. Run "npm run build" first.`);
    process.exit(1);
  }
}

const version = JSON.parse(readFileSync(join(mcp, "package.json"), "utf8")).version;
const readOnly = (await import(pathToUrl(join(mcp, "dist", "tools.js")))).TOOLS;
const { LIST_ACCOUNTS, SUGGEST_TOOLS } = await import(pathToUrl(join(mcp, "dist", "suggest-tools.js")));
const tools = [...readOnly, LIST_ACCOUNTS, ...SUGGEST_TOOLS];

function pathToUrl(path) {
  return new URL(`file:///${path.replace(/\\/g, "/")}`).href;
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "server"), { recursive: true });

// Compiled JavaScript only: no type declarations or source maps.
const onlyJs = (src) => !/\.(d\.ts|map)$/.test(src) && !/mcpb-stage|nzosa\.mcpb/.test(src);
cpSync(join(mcp, "dist"), join(stage, "server"), { recursive: true, filter: onlyJs });
const heldCore = join(stage, "node_modules", "@nzosa", "core");
cpSync(join(core, "dist"), join(heldCore, "dist"), { recursive: true, filter: onlyJs });
writeFileSync(
  join(heldCore, "package.json"),
  JSON.stringify(
    { name: "@nzosa/core", version: "0.1.0", type: "module", main: "./dist/index.js", exports: { ".": "./dist/index.js" } },
    null,
    2,
  ),
);
// The compiled files are ES modules.
writeFileSync(join(stage, "package.json"), JSON.stringify({ name: "nzosa-mcp", version, type: "module" }, null, 2));
for (const file of ["LICENSE", "NOTICE"]) cpSync(join(root, file), join(stage, file));
cpSync(join(root, "brand", "nzosa-mark-1024.png"), join(stage, "icon.png"));

const manifest = {
  manifest_version: "0.3",
  name: "nzosa",
  display_name: "NZOSA books",
  version,
  description: "Ask Claude about your NZOSA books, and let it suggest codes, splits and journals for you to check in NZOSA.",
  long_description:
    "A view of a folder of NZOSA books, on your own computer. Claude can list your entities, search bank transactions, " +
    "list what is not yet coded, report coding progress and compare the bank's daily balances with your transactions. " +
    "It cannot change the books. With suggestions turned on it can also suggest codes, a split or a journal, and bring up a page in NZOSA: " +
    "each waits in NZOSA, beside the books, until you use or decline it there. " +
    "What Claude asks for is sent to Anthropic as part of your chat, including payee names, so choose the folder with that in mind.",
  author: { name: "hidicker", url: "https://nbparagliding.nz/nzosa/home/" },
  homepage: "https://nbparagliding.nz/nzosa/home/",
  license: "AGPL-3.0-or-later",
  icon: "icon.png",
  server: {
    type: "node",
    entry_point: "server/server.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/server.js", "--books", "${user_config.books_folder}", "--suggest", "${user_config.allow_suggestions}"],
    },
  },
  tools: tools.map((t) => ({ name: t.name, description: t.description.split(". ")[0].replace(/\.$/, "") + "." })),
  user_config: {
    books_folder: {
      type: "directory",
      title: "NZOSA books folder",
      description: "The folder NZOSA keeps your books in (it holds transactions.json). Claude can read this folder and nothing else.",
      required: true,
    },
    allow_suggestions: {
      type: "boolean",
      title: "Let Claude suggest",
      description:
        "Claude may suggest codes, splits and journals, kept in a file beside the books until you use or decline each in NZOSA. " +
        "Off, it only reads.",
      default: false,
      required: false,
    },
  },
  compatibility: { platforms: ["darwin", "win32", "linux"], runtimes: { node: ">=20.0.0" } },
};
writeFileSync(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const count = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) => n + (e.isDirectory() ? count(join(dir, e.name)) : 1),
    0,
  );
console.log(`Staged ${count(stage)} files in ${stage}`);

rmSync(out, { force: true });
const packed = spawnSync("npx", ["--yes", "@anthropic-ai/mcpb", "pack", stage, out], {
  stdio: "inherit",
  shell: true,
});
if (packed.status !== 0 || !existsSync(out)) {
  console.error("Packing failed. The staged folder is complete; zip its contents as nzosa.mcpb.");
  process.exit(1);
}
console.log(`Built ${out}`);

// Beside the app, so the AI page can offer it for download.
const appDist = join(root, "apps", "web", "dist");
if (existsSync(appDist)) {
  cpSync(out, join(appDist, "nzosa.mcpb"));
  console.log(`Copied to ${join(appDist, "nzosa.mcpb")}`);
}
