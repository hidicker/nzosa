import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { ownProjectSql, MIGRATIONS } = await import(pathToFileURL(join(root, "tools", "own-project-sql.mjs")).href);

test("the script a person pastes is what the migrations make, so it cannot be left behind", () => {
  const written = readFileSync(join(root, "apps", "web", "public", "own-project.sql"), "utf8");
  assert.equal(written, ownProjectSql(), "run: node tools/own-project-sql.mjs");
});

test("it makes the books, the members, the saving and the sharing, and nothing that needs a function", () => {
  const sql = ownProjectSql();
  for (const name of ["public.books", "public.book_parts", "public.book_members", "public.book_part_history", "public.book_invitations"]) {
    assert.ok(sql.includes(`create table ${name}`) || sql.includes(`create table if not exists ${name}`), name);
  }
  for (const fn of ["save_part", "create_book", "invite_to_book", "accept_invitation", "delete_book", "restore_book", "has_role"]) {
    assert.ok(sql.includes(`function public.${fn}`), fn);
  }
  for (const needs of ["pg_cron", "cron.schedule", "pg_net", "ai_secrets", "invitation_emails", "wise_feeds"]) {
    assert.ok(!sql.includes(needs), `${needs} belongs to a function that is not deployed`);
  }
  assert.ok(MIGRATIONS.length >= 7);
  assert.match(sql, /add value if not exists 'payroll'/);
});
