/**
 * The invitation email, as HTML and as plain text for mail apps that show only
 * that.
 *
 * Its own file, importing nothing, so it can be rendered and looked at on a
 * computer without sending anything: an email is judged by how it looks, and
 * that is hard to see from the code.
 *
 * Inline styles and a table, because that is all most mail apps honour.
 */

const ROLES: Record<string, { name: string; can: string }> = {
  owner: { name: "an owner", can: "do everything, including choosing who else can see the books" },
  bookkeeper: {
    name: "a bookkeeper",
    can: "code and reconcile the bank, and enter invoices and bills. Lock dates and who else can see the books stay with the owners",
  },
  accountant: {
    name: "their accountant",
    can: "do everything in the books, lock dates and year end included. Who else can see the books stays with the owners",
  },
  readonly: { name: "a reader", can: "look through everything (reports, transactions and history) without changing anything" },
};

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function letter(
  books: string,
  role: string,
  from: string,
  appUrl: string,
): { subject: string; text: string; html: string } {
  const who = from !== "" ? from : "Someone";
  const as = ROLES[role] ?? { name: "a member", can: "work on the books" };
  const subject = `You're invited to ${books} in NZOSA`;

  const text = [
    "Kia ora,",
    "",
    `${who} has invited you to their books "${books}" in NZOSA, as ${as.name}. You'll be able to ${as.can}.`,
    "",
    "To accept:",
    `1. Go to ${appUrl} and sign in, or sign up, with this email address.`,
    "2. Open Books. The invitation is waiting there for you to accept or decline.",
    "",
    "Nothing is shared with you until you accept. If you weren't expecting this, you can ignore this email.",
    "",
    "NZOSA, open-source accounting for New Zealand",
  ].join("\n");

  const e = { who: escape(who), books: escape(books), url: escape(appUrl) };
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef1f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d2733;">
<tr><td style="background:#0f2440;padding:18px 28px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.08em;">NZOSA</td></tr>
<tr><td style="padding:28px 28px 8px;">
<p style="margin:0 0 6px;font-size:14px;color:#5d6b7f;">Kia ora,</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">You're invited to ${e.books}</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.55;"><strong>${e.who}</strong> has invited you to their books in NZOSA as <strong>${escape(as.name)}</strong>.</p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.55;padding:12px 14px;background:#f4f6f9;border-radius:6px;">You'll be able to ${escape(as.can)}.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-radius:6px;background:#1f6feb;">
<a href="${e.url}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Open NZOSA</a>
</td></tr></table>
<p style="margin:0 0 6px;font-size:14px;font-weight:600;">To accept</p>
<ol style="margin:0 0 22px;padding-left:20px;font-size:14px;line-height:1.6;">
<li>Sign in, or sign up, with <em>this</em> email address.</li>
<li>Open <strong>Books</strong>. The invitation is waiting there for you to accept or decline.</li>
</ol>
</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid #e3e7ed;font-size:12px;line-height:1.5;color:#5d6b7f;">
Nothing is shared with you until you accept. If you weren't expecting this, you can ignore this email.<br>
NZOSA, open-source accounting for New Zealand &middot; <a href="${e.url}" style="color:#5d6b7f;">${e.url}</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
