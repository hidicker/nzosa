#!/usr/bin/env node
import { BookShelf } from "./load.js";
import { serve } from "./protocol.js";
import { Sandbox } from "./sandbox.js";

/**
 *   nzosa-mcp --books <folder> [--entities a,b] [--max-rows 200]
 *
 * Started by the client (Claude Desktop, Claude Code) as a child process. It
 * can see the one folder it is given, and nothing else.
 */
function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const folder = option("books");
if (folder === undefined) {
  process.stderr.write("Give the books folder: nzosa-mcp --books <folder>\n");
  process.exit(2);
}

try {
  const shelf = new BookShelf(new Sandbox(folder));
  const entities = option("entities");
  const rows = Number(option("max-rows") ?? 200);
  await serve(process.stdin, process.stdout, {
    shelf,
    allowed: entities === undefined ? undefined : new Set(entities.split(",").map((e) => e.trim())),
    maxRows: Number.isInteger(rows) && rows > 0 ? rows : 200,
  });
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
}
