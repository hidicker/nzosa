/**
 * What every document this package writes shares: the escaping, the dates and
 * the one stylesheet. Invoices, statements, letters and payslips all come out
 * of here, so they look alike and escape alike; a second copy would drift.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Free text as HTML, with the writer's own line breaks kept. */
export function asLines(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(escapeHtml)
    .join("<br>");
}

/** A date as the reader writes it: a New Zealander's day first unless said. */
export function written(iso: string, style: "dmy" | "mdy" | "ymd" = "dmy"): string {
  const [year, month, day] = iso.split("-");
  if (!(year && month && day)) return iso;
  if (style === "mdy") return `${month}/${day}/${year}`;
  if (style === "ymd") return `${year}/${month}/${day}`;
  return `${day}/${month}/${year}`;
}

export const DOCUMENT_STYLE = `
  :root { --accent: #1f4e79; --ink: #1b1f24; --muted: #5d6670; --line: #dde1e6; }
  * { box-sizing: border-box; }
  body { font: 13.5px/1.55 -apple-system, "Segoe UI", system-ui, sans-serif; color: var(--ink);
    max-width: 46em; margin: 2.5em auto; padding: 0 1.5em; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 2em;
    padding-bottom: 1.4em; margin-bottom: 1.6em; border-bottom: 3px solid var(--accent); }
  .logo { display: block; max-height: 4.5em; max-width: 14em; margin-bottom: 0.8em; }
  .who strong { display: block; font-size: 1.15em; margin-bottom: 0.25em; }
  .who { color: var(--muted); }
  .who strong { color: var(--ink); }
  .meta { text-align: right; white-space: nowrap; }
  h1 { font-size: 1.9em; margin: 0 0 0.5em; color: var(--accent); font-weight: 700;
    letter-spacing: 0.04em; text-transform: uppercase; line-height: 1.1; }
  /* The block is right-aligned, so the label needs its own left alignment and
     a gap: without them "Number" sat flush against "INV-1042". */
  .meta .k { display: inline-block; min-width: 5em; margin-right: 0.8em;
    text-align: left; color: var(--muted); }
  .to { margin-bottom: 1.8em; font-size: 1.05em; }
  .k-block { display: block; color: var(--accent); font-size: 0.75em; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.3em; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1.6em; }
  thead th { text-align: left; font-size: 0.75em; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--accent); background: #f1f5f9;
    border-bottom: 1px solid var(--accent); padding: 0.55em 0.6em; }
  td { padding: 0.6em; border-bottom: 1px solid var(--line); vertical-align: top; }
  th.n, td.n { text-align: right; white-space: nowrap; }
  tfoot td { border: 0; padding-top: 0.35em; padding-bottom: 0.35em; color: var(--muted); }
  tfoot .due td { font-weight: 700; font-size: 1.15em; color: var(--ink);
    border-top: 2px solid var(--accent); padding-top: 0.6em; }
  .pay { background: #f1f5f9; border-left: 4px solid var(--accent);
    padding: 0.9em 1.1em; margin-top: 0.5em; }
  .note { margin-top: 1.5em; font-size: 0.92em; color: var(--muted); }
  .check { margin-top: 1.5em; font-size: 0.85em; color: #a33; }
  @media print { body { margin: 0; max-width: none; }
    thead th, .pay { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;
