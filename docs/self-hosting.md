# Hosting NZOSA online yourself

NZOSA runs happily on your own computer with no server at all. This guide is for
the other way: books kept online, reachable from any browser, shared with your
bookkeeper or accountant — on **your own** Supabase project and **your own**
web hosting, so nobody else holds your books.

It is written to be worked through by a person, or by a person together with
their own AI assistant (Claude, ChatGPT, Gemini, or similar). The steps say who
does what: some things only you should do — creating accounts, typing
passwords, pasting secret keys — and the AI should hand those back to you.
There is a short section at the end for the AI itself.

**Time:** an hour or two the first time. **Cost:** Supabase's free tier and
most web hosting are enough for one business's books.

---

## 1. What you end up with

| Piece | What it does | Where it lives |
|---|---|---|
| The web app | The NZOSA pages: plain files, no server of their own | Your web host (any static hosting) |
| Supabase: database | Your books, members and roles, locked down by row-level security | Your Supabase project |
| Supabase: auth | Sign-in with email and password, and the confirmation email | Your Supabase project |
| Supabase: Vault | Bank feed tokens, the Wise token, AI keys — encrypted, never readable by a browser | Your Supabase project |
| Supabase: Edge Functions | `akahu` (bank feed), `wise` (Wise), `gemini` (AI suggestions), `gemini-demo` (an optional shared AI allowance) | Your Supabase project |
| Email (optional) | Sends sign-up confirmations from your own address | Your email provider's SMTP |

The only keys that ever reach a browser are the Supabase **project URL** and
**publishable key**. Both are public by design: they identify the project and
carry no rights of their own. Everything else — the service role key, bank
tokens, API keys — stays inside Supabase.

---

## 2. Before you start

You need:

- [ ] **Node.js** (the LTS version) on your computer — [nodejs.org](https://nodejs.org).
- [ ] **A copy of NZOSA**. The licence (GNU AGPL, with the terms in NOTICE)
      lets you host it for yourself or others; if you change it, offer your
      users its source and keep the "NZOSA, by hidicker" credit.
- [ ] **A Supabase account** — [supabase.com](https://supabase.com). *You* sign up; an AI should not.
- [ ] **Somewhere to put the web app** — any static host: GitHub Pages, Netlify,
      Cloudflare Pages, or ordinary shared hosting with FTP or WebDAV.
- [ ] *Optional:* an email account whose SMTP details you know, to send the
      sign-up emails from your own address. Supabase's built-in email works for
      trying it out, but is limited to a few emails an hour.

Keep secrets out of chat and out of files you might share. If you work with an
AI, keep secrets in environment variables on your computer and let the AI refer
to them by name (section 10).

---

## 3. Create the Supabase project

*You do this, in the Supabase dashboard.*

1. **New project.** Choose a region near you — **Sydney (ap-southeast-2)** for
   New Zealand — and a strong database password (keep it in your password
   manager; NZOSA never needs it).
2. From **Project Settings → API**, note:
   - the **Project URL** (`https://<your-ref>.supabase.co`) and **project ref**
     (`<your-ref>`);
   - the **publishable key** (`sb_publishable_…`) — public;
   - the **service role / secret key** — *secret*. You will not paste this
     anywhere in NZOSA; the Edge Functions get it from Supabase automatically.
3. From **Account → Access Tokens**, create a **personal access token** if you
   want to run the steps below from the command line (or let an AI run them).
   Store it as an environment variable, e.g. `SUPABASE_ACCESS_TOKEN`.

---

## 4. Set up the database

The database is built by the files in `supabase/migrations/`, **run in the order
of their names** (they start with a date). Each one is plain SQL.

**Option A — the dashboard (no tools needed).** Open **SQL Editor**, and for
each file in `supabase/migrations/`, oldest first, paste its contents and run it.

**Option B — the Supabase CLI.**

```bash
npx supabase link --project-ref <your-ref>
```

```bash
npx supabase db push
```

**Check it worked.** Run this in the SQL Editor. Every line should say what the
comment beside it says:

```sql
select
  (select count(*) from information_schema.tables
     where table_schema = 'public'
       and table_name in ('books','book_members','book_parts','bank_feeds','wise_feeds','ai_secrets'))
    as tables_expected_6,
  (select bool_and(relrowsecurity) from pg_class
     where relname in ('books','book_parts','bank_feeds','wise_feeds'))
    as row_security_on_expected_true,
  has_function_privilege('authenticated', 'public.feed_secrets(uuid)', 'execute')
    as users_can_read_bank_tokens_expected_false,
  has_function_privilege('authenticated', 'public.wise_secret(uuid)', 'execute')
    as users_can_read_wise_token_expected_false;
```

If the last two say **true**, stop: something went wrong and tokens would be
readable by signed-in users. Re-run the migrations in order.

---

## 5. Deploy the Edge Functions

Four functions, in `supabase/functions/`. With the CLI (Docker is not needed
with `--use-api`):

```bash
npx supabase functions deploy akahu --use-api --project-ref <your-ref>
```

```bash
npx supabase functions deploy wise --use-api --project-ref <your-ref>
```

```bash
npx supabase functions deploy gemini --use-api --project-ref <your-ref>
```

```bash
npx supabase functions deploy gemini-demo --use-api --project-ref <your-ref>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are given to every function by
Supabase itself — you set nothing for them.

**Optional: a shared AI allowance.** If you want people using your copy to try
AI suggestions before they add a key of their own, set a Gemini API key as a
function secret (**Edge Functions → Secrets**, or the CLI):

```bash
npx supabase secrets set GEMINI_API_KEY=<your key> --project-ref <your-ref>
```

`GEMINI_MODEL` is optional (a current Flash model is the default). The
allowance is one pool shared by everybody without a key, capped at 1,000 lines
by default; change the cap in the `ai_demo_pool` table. Leave the key unset and
there is simply no shared allowance — everybody uses their own key or copies
prompts to an AI they already have.

**Check it worked.** A request with no sign-in should be refused, which proves
the function is there and checking:

```bash
curl -s -X POST https://<your-ref>.supabase.co/functions/v1/wise -H "apikey: <publishable key>" -H "content-type: application/json" -d "{\"action\":\"status\",\"book\":\"x\"}"
```

It should answer `not signed in` (or a 401).

---

## 6. Sign-in settings

*In the dashboard, **Authentication**.*

1. **URL Configuration.** Set **Site URL** to where the app will live, e.g.
   `https://books.example.co.nz/`, and add the same under **Redirect URLs**.
   The confirmation email links back here.
2. **Email.** Keep **Confirm email** on: an account should belong to somebody
   who can read that inbox.
3. **SMTP (optional, recommended).** Under **SMTP Settings**, enter your email
   provider's host, port (465 or 587), username and password, and the sender
   address. Two traps: the host name must match the server's certificate (your
   provider's own server name, which is not always `mail.yourdomain`), and if
   you set these through the Management API, send all the SMTP fields together
   and the port as text.

---

## 7. Point the web app at your project

Edit **`apps/web/src/cloud-config.ts`** and put in your two public values:

```ts
export const CLOUD: CloudProject = {
  url: "https://<your-ref>.supabase.co",
  publishableKey: "sb_publishable_<yours>",
};
```

Then build:

```bash
npm install
```

```bash
npm run build --workspace @nzosa/web
```

The finished app is in **`apps/web/dist/`**.

Leaving both values empty builds an app with no online option at all — books on
the computer or in the browser only.

---

## 8. Put the app on your web host

Upload **everything in `apps/web/dist/`**, including the hidden `.htaccess` file,
to the folder your site serves — for example `public_html/books/`.

- **Shared hosting (Apache):** FTP, SFTP or WebDAV into the folder. The
  `.htaccess` sets sensible security headers and stops old copies being cached.
- **Netlify / Cloudflare Pages / GitHub Pages:** publish the `apps/web/dist`
  folder as the site.

**Check it worked.** Open the address. Books online should offer **Sign in**.
Create your account, confirm it from the email, and sign in.

---

## 9. Your first books online

1. **Books → New set of books online.** You are its owner.
2. **Start here** walks you through the rest, the same as on the desktop:
   start date, entities, chart of accounts, opening balances.
3. **Invite** your bookkeeper or accountant from the Books page. Roles:
   *owner* (everything), *bookkeeper* (codes and imports), *accountant*
   (reads, and can check the year).
4. **Bank feed:** connect with your own Akahu personal app tokens
   ([my.akahu.nz](https://my.akahu.nz) → Developers). They go into your Vault.
5. **Wise:** a read-only API token from Wise (Settings → API tokens), on the
   Bank import page. It goes into your Vault.
6. **AI:** your own key on the AI suggestions page, or the shared allowance if
   you set one up. It goes into your Vault.

Each set of books has its own tokens. Deleting a set of books deletes its
tokens from the Vault too.

---

## 10. Working through this with your AI assistant

Give the assistant this guide and the repository, and let it do the parts that
are typing commands and checking results. Keep these for yourself:

- **creating accounts** (Supabase, email, hosting) and **signing in**;
- **pasting any secret** — store secrets as environment variables and tell the
  assistant their *names*, never their values;
- **approving anything that deletes data**.

A good way to start the conversation:

> I want to host NZOSA online on my own Supabase project and web host, using
> docs/self-hosting.md in the repository. My project ref is `<ref>`. My
> Supabase personal access token is in the environment variable
> `SUPABASE_ACCESS_TOKEN`; don't print it. Walk me through the guide one
> section at a time, run the commands you can, run each "Check it worked"
> step and show me the result, and stop and ask me whenever a step needs an
> account, a password, or a secret.

### Notes for the AI assistant

- Work section by section and **run every "Check it worked"** before moving on.
  Report the actual output.
- **Never ask for secrets in chat** and never echo them. Read them from the
  environment variables the person names.
- **Migrations run in filename order.** Do not edit an old migration to fix
  something; add a new one.
- The **Management API** runs SQL as the database owner:
  `POST https://api.supabase.com/v1/projects/<ref>/database/query` with
  `{"query": "…"}` and the personal access token as a bearer token. Send the
  body as UTF-8.
- Supabase **refuses secret API keys from requests that look like a browser**;
  when calling with one from a script, set a plain user agent such as
  `nzosa-admin/1.0`.
- The direct database host may be **IPv6-only**; if it cannot be reached, use
  the Management API instead of `psql`.
- Edge Function **CORS must allow the `apikey` header**, or browsers never send
  the request (the functions in the repository already do).
- A refusal the app reports on purpose uses **`PT4xx` error codes** (passed
  through as that HTTP status). Never raise SQLSTATE `40001` for one:
  PostgREST retries it until the gateway times out.
- **Inserting into `books` directly is refused** by design; the app uses the
  `create_book` function.
- **Do not create test users** on the person's live project unless they ask
  you to. Prove database behaviour inside a transaction that is rolled back —
  for example a `do $$ … raise exception 'RESULT …' $$` block that reports
  what it found and undoes itself.
- After any change, re-run the security check in section 4: signed-in users
  must not be able to execute `feed_secrets` or `wise_secret`.

---

## 11. Keeping it up to date

When NZOSA changes:

1. Get the new code.
2. Run any **new** files in `supabase/migrations/` (by date, after the last one
   you ran).
3. Re-deploy any Edge Function whose folder changed.
4. Rebuild the app (section 7) and upload `apps/web/dist/` again (section 8).

Your books are in your database and are not touched by an update.

---

## 12. Security, in short

- **Row-level security** decides every row a signed-in person can reach, by
  their membership and role in each set of books.
- **Tokens and keys live in Vault**, encrypted. Only the Edge Functions, using
  the service role, can read them — and only after checking the person asking
  has a role in those books.
- **The service role key** never leaves Supabase. If it ever appears in a
  browser, a file, or a chat, rotate it in the dashboard.
- **Revoking** is always yours: disconnect in NZOSA, and also revoke the token
  at Akahu, Wise or the AI provider if you want to be certain.
- **Backups:** Supabase's free tier keeps daily backups for a short time; the
  app's **Download a backup** on the Books page gives you a copy you hold.
