/**
 * Turn the guides into HTML anybody can open.
 *
 * A markdown file is the right thing to write and edit and the wrong thing to
 * hand to an accountant: it renders on GitHub and nowhere else, and "open this
 * in a text editor" is not an answer. So the same text is built into a
 * standalone HTML page -- one file, styles inside it, no fonts or scripts to
 * fetch -- which opens by double-click, prints, and can be put on a website.
 *
 * Generated rather than written twice, because two copies of a document drift
 * exactly as fast as two copies of code, and this project has spent a week
 * finding out what that costs.
 *
 *   node tools/build-docs.mjs
 *
 * Only the markdown these guides actually use is supported: headings, bullet
 * and numbered lists, tables, fenced code, inline code, bold, italic, links,
 * and horizontal rules. Anything else passes through as text, which is the
 * right failure -- visible, and not silently dropped.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const PAGES = [
  { from: "docs/user-guide.md", to: "docs/user-guide.html" },
  { from: "docs/accountant-guide.md", to: "docs/accountant-guide.html" },
  { from: "docs/developer-guide.md", to: "docs/developer-guide.html" },
];

const escapeHtml = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The inline pieces: code first, so nothing inside backticks is touched.
 *
 * Code spans are lifted out before bold and italic run, and put back after.
 * Without that, an account name in backticks containing an underscore comes
 * out italic, and a regular expression comes out as anything at all.
 */
function inline(text) {
  const held = [];
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
    held.push(code);
    return `\u0000${held.length - 1}\u0000`;
  });

  out = out
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safe = /^(https?:|#|[\w./-]+$)/.test(href) ? href : "#";
      return `<a href="${safe}">${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:)]|$)/g, "$1<em>$2</em>");

  // A sentinel that cannot occur in prose. Spaces round a number would not do:
  // "3 of 10 set up" is not a code span and would have been eaten as one.
  return out.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${held[Number(index)]}</code>`);
}

/** A heading's anchor, so a section can be linked to. */
function slug(text) {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function render(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const contents = [];
  let i = 0;

  const paragraph = (buffer) => {
    if (buffer.length > 0) out.push(`<p>${inline(buffer.join(" "))}</p>`);
    buffer.length = 0;
  };
  const buffer = [];

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code, taken verbatim.
    if (line.startsWith("```")) {
      paragraph(buffer);
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      paragraph(buffer);
      const level = heading[1].length;
      const text = heading[2];
      const id = slug(text);
      if (level === 2) contents.push({ id, text });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      paragraph(buffer);
      out.push("<hr>");
      i += 1;
      continue;
    }

    // A table: a header row, a divider, then rows.
    if (line.trim().startsWith("|") && (lines[i + 1] ?? "").trim().startsWith("|-")) {
      paragraph(buffer);
      const cells = (row) =>
        row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        body.push(cells(lines[i]));
        i += 1;
      }
      out.push(
        "<div class=\"scroll\"><table><thead><tr>" +
          head.map((cell) => `<th>${inline(cell)}</th>`).join("") +
          "</tr></thead><tbody>" +
          body
            .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
            .join("") +
          "</tbody></table></div>",
      );
      continue;
    }

    // Lists, with continuation lines folded into the item they belong to.
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const number = /^\d+\.\s+(.*)$/.exec(line);
    if (bullet || number) {
      paragraph(buffer);
      const tag = bullet ? "ul" : "ol";
      const items = [];
      while (i < lines.length) {
        const item = /^(?:[-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (item) {
          items.push([item[1]]);
          i += 1;
          continue;
        }
        // An indented line belongs to the item above it.
        if (/^\s+\S/.test(lines[i]) && items.length > 0) {
          items[items.length - 1].push(lines[i].trim());
          i += 1;
          continue;
        }
        break;
      }
      out.push(
        `<${tag}>` +
          items.map((item) => `<li>${inline(item.join(" "))}</li>`).join("") +
          `</${tag}>`,
      );
      continue;
    }

    if (line.trim() === "") {
      paragraph(buffer);
      i += 1;
      continue;
    }

    buffer.push(line.trim());
    i += 1;
  }
  paragraph(buffer);

  return { body: out.join("\n"), contents };
}

const STYLE = `
:root { --ink: #14171a; --quiet: #5b6570; --line: #e3e6ea; --page: #fff;
  --soft: #f6f8fa; --link: #1a5fb4; }
@media (prefers-color-scheme: dark) {
  :root { --ink: #e6e9ec; --quiet: #9aa4af; --line: #2c3238; --page: #14171a;
    --soft: #1c2126; --link: #7fb3ff; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink);
  font: 16px/1.65 -apple-system, "Segoe UI", system-ui, sans-serif; }
.wrap { display: grid; grid-template-columns: 16rem minmax(0, 1fr);
  gap: 3rem; max-width: 68rem; margin: 0 auto; padding: 2.5rem 1.5rem 6rem; }
nav { position: sticky; top: 2.5rem; align-self: start; font-size: 0.87rem;
  max-height: calc(100vh - 5rem); overflow-y: auto; }
nav strong { display: block; margin-bottom: 0.6rem; font-size: 0.75rem;
  text-transform: uppercase; letter-spacing: 0.08em; color: var(--quiet); }
nav a { display: block; padding: 0.2rem 0; color: var(--quiet);
  text-decoration: none; border-left: 2px solid transparent; padding-left: 0.7rem; }
nav a:hover { color: var(--link); border-left-color: var(--link); }
main { min-width: 0; }
h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 0.5rem; }
h2 { font-size: 1.35rem; margin: 2.75rem 0 0.75rem; padding-top: 1.25rem;
  border-top: 1px solid var(--line); }
h3 { font-size: 1.05rem; margin: 1.75rem 0 0.5rem; }
h4 { font-size: 0.95rem; margin: 1.25rem 0 0.4rem; color: var(--quiet); }
p, li { margin: 0 0 0.85rem; }
li { margin-bottom: 0.4rem; }
ul, ol { padding-left: 1.35rem; margin: 0 0 1rem; }
a { color: var(--link); }
code { background: var(--soft); border: 1px solid var(--line); border-radius: 3px;
  padding: 0.05em 0.35em; font-size: 0.88em;
  font-family: ui-monospace, "Cascadia Code", Menlo, Consolas, monospace; }
pre { background: var(--soft); border: 1px solid var(--line); border-radius: 6px;
  padding: 0.9rem 1.1rem; overflow-x: auto; }
pre code { background: none; border: 0; padding: 0; font-size: 0.85em; }
.scroll { overflow-x: auto; margin: 0 0 1.25rem; }
table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
th { text-align: left; font-size: 0.75rem; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--quiet); border-bottom: 1px solid var(--quiet);
  padding: 0 0.8rem 0.4rem 0; }
td { padding: 0.5rem 0.8rem 0.5rem 0; border-bottom: 1px solid var(--line);
  vertical-align: top; }
hr { border: 0; border-top: 1px solid var(--line); margin: 2rem 0; }
strong { font-weight: 650; }
.foot { margin-top: 4rem; padding-top: 1.25rem; border-top: 1px solid var(--line);
  font-size: 0.85rem; color: var(--quiet); }
@media (max-width: 60rem) {
  .wrap { grid-template-columns: 1fr; gap: 1.5rem; }
  nav { position: static; max-height: none; border-bottom: 1px solid var(--line);
    padding-bottom: 1rem; }
}
@media print {
  .wrap { display: block; max-width: none; padding: 0; }
  nav { display: none; }
  h2 { break-before: auto; }
  pre, table { break-inside: avoid; }
}
`;

function page(title, rendered, source) {
  const nav = rendered.contents
    .map((entry) => `<a href="#${entry.id}">${escapeHtml(entry.text)}</a>`)
    .join("\n      ");

  return `<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="wrap">
    <nav>
      <strong>Contents</strong>
      ${nav}
    </nav>
    <main>
${rendered.body}
      <p class="foot">
        NZOSA &mdash; New Zealand open-source accounting. Free software under an
        MIT licence, provided as is and without warranty of any kind.
        Built from <code>${escapeHtml(source)}</code>.
      </p>
    </main>
  </div>
</body>
</html>
`;
}

let built = 0;
for (const { from, to } of PAGES) {
  const markdown = readFileSync(from, "utf8");
  const rendered = render(markdown);
  const title = (/^#\s+(.*)$/m.exec(markdown) ?? [, basename(from)])[1];
  writeFileSync(to, page(title, rendered, basename(from)));
  console.log(`${to}  ${rendered.contents.length} sections`);
  built += 1;
}
console.log(`${built} page(s) built.`);
