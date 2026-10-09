/**
 * The one script a person pastes into their own Supabase project's SQL editor
 * to give it the tables NZOSA keeps books in: the migrations that need only the
 * database, in order. The bank feed, the AI, the morning run and email
 * invitations are functions that have to be deployed as well, so what they
 * need is left out.
 *
 *   node tools/own-project-sql.mjs        writes apps/web/public/own-project.sql
 *
 * A test checks that the written file is what this makes, so a migration added
 * to the list or changed cannot leave the file behind.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** In the order they were made; each needs the ones before it. */
export const MIGRATIONS = [
  "20260916000000_books",
  "20260916120000_members",
  "20260916170000_create_book",
  "20260916190000_conflict_code",
  "20260919090000_lock_tables_and_invitations",
  "20261008090000_roles",
  "20261010090000_delete_books",
];

/** Parts a function adds later; a value added to a type is used by the app, not by this script. */
const PARTS = ["payroll", "nightly"];

export function ownProjectSql() {
  const out = [
    "-- NZOSA: the tables for books kept in your own Supabase project.",
    "-- Paste all of this into your project's SQL editor and run it once.",
    "-- Made by tools/own-project-sql.mjs from the migrations in supabase/migrations.",
    "",
  ];
  for (const name of MIGRATIONS) {
    out.push(`-- ============================================================ ${name}`);
    out.push(readFileSync(join(root, "supabase", "migrations", `${name}.sql`), "utf8").replace(/\r\n/g, "\n").trimEnd());
    out.push("");
  }
  out.push("-- ============================================================ parts added later");
  for (const part of PARTS) out.push(`alter type public.book_part add value if not exists '${part}';`);
  out.push("");
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = join(root, "apps", "web", "public", "own-project.sql");
  writeFileSync(file, ownProjectSql());
  process.stdout.write(`wrote ${file}\n`);
}
