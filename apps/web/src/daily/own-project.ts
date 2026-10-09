import { CLOUD, OWN_PROJECT_KEY, cleanProjectUrl, ownProject, usingOwnProject } from "../cloud-config.js";
import { download, note } from "../ui.js";

/**
 * Keeping books in your own Supabase project.
 *
 * For anybody who would rather their books were in their own account than on
 * this site's: a free Supabase project, one script pasted into its SQL editor,
 * and its address and publishable key given here. Then sign-in, saving, backups
 * and sharing all work against it, and nothing about the books is held by
 * anybody else. The bank feed, the AI, the morning run and invitation emails
 * are functions that would have to be deployed to the project as well, so they
 * are not offered there yet.
 */

const SESSION_KEY = "nzosa:cloud-session";

export interface ProjectCheck {
  ok: boolean;
  /** What is wrong, or what was found, in words. */
  said: string;
  /** True when the project asks people to confirm their email before signing in. */
  confirmsEmail: boolean;
}

/** Whether an address and key reach a Supabase project that has the tables. */
export async function checkProject(urlText: string, key: string): Promise<ProjectCheck> {
  const url = cleanProjectUrl(urlText);
  if (url === null) {
    return { ok: false, confirmsEmail: false, said: "That is not a project address. It looks like https://abcdefgh.supabase.co." };
  }
  if (key.trim() === "") return { ok: false, confirmsEmail: false, said: "Paste the project's publishable key as well." };
  const headers = { apikey: key.trim() };
  let settings = null as { mailer_autoconfirm?: boolean; disable_signup?: boolean } | null;
  try {
    const response = await fetch(`${url}/auth/v1/settings`, { headers });
    if (!response.ok) {
      return { ok: false, confirmsEmail: false, said: "Supabase did not accept that address and key together. Check both against Project Settings, API Keys." };
    }
    settings = (await response.json()) as typeof settings;
  } catch {
    return { ok: false, confirmsEmail: false, said: "Could not reach that address. Check it, and your connection." };
  }
  try {
    const tables = await fetch(`${url}/rest/v1/books?select=id&limit=1`, { headers });
    if (tables.status === 404) {
      return { ok: false, confirmsEmail: false, said: "The project is reachable, but the tables are not in it yet. Run the script in its SQL editor first." };
    }
  } catch {
    return { ok: false, confirmsEmail: false, said: "Could not read the project's tables." };
  }
  const confirmsEmail = settings?.mailer_autoconfirm === false;
  return {
    ok: true,
    confirmsEmail,
    said:
      "Connected: the project is there and has the tables." +
      (settings?.disable_signup === true ? " New sign-ups are switched off in it, so create your account in Supabase first." : "") +
      (confirmsEmail
        ? " It asks new accounts to confirm their email; Supabase's own email sender allows only a few a day and only to the project's owner, so switch \"Confirm email\" off under Authentication, Sign In, Email while you set up."
        : ""),
  };
}

/** Remember the project and start again from it, signed out. */
export function useProject(url: string, key: string): void {
  const clean = cleanProjectUrl(url);
  if (clean === null) return;
  try {
    localStorage.setItem(OWN_PROJECT_KEY, JSON.stringify({ url: clean, publishableKey: key.trim() }));
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Refused storage: nothing was saved, and the page says so by not changing.
  }
  location.reload();
}

/** Go back to the shared service, signed out. */
export function useSharedService(): void {
  try {
    localStorage.removeItem(OWN_PROJECT_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // As above.
  }
  location.reload();
}

async function script(): Promise<string | null> {
  try {
    const response = await fetch("own-project.sql");
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

function step(text: string): HTMLElement {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
}

/** The panel for the Books page: set up, or say which project is in use. */
export function ownProjectPanel(): HTMLElement {
  const fold = document.createElement("details");
  fold.className = "own-project";
  const summary = document.createElement("summary");
  fold.append(summary);

  const own = ownProject();
  if (own !== null) {
    summary.textContent = "Your own Supabase project is in use";
    fold.open = true;
    fold.append(
      step(`These books are kept in your project at ${own.url}. Nobody else holds them. Sign-in, saving, backups and sharing work as usual.`),
      note(
        "The bank feed, AI suggestions, the morning run and invitation emails are not available in your own project yet: they need extra functions deployed to it. " +
          "To invite someone, they make an account in your project, and the invitation waits for them when they sign in.",
      ),
    );
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = "Go back to the shared service";
    back.addEventListener("click", () => {
      if (confirm("Go back to the shared service? You will be signed out here. Your own project and its books are not touched.")) useSharedService();
    });
    fold.append(back);
    return fold;
  }

  summary.textContent = "Keep your books in your own Supabase account instead";
  fold.append(
    note(
      "The shared service holds your books on this site's account, where its owner can technically read them. In your own free Supabase project, only you can. It takes about ten minutes.",
    ),
  );

  const one = step("1. Make a free project at supabase.com (a region near you is best), and wait for it to finish starting.");
  const link = document.createElement("a");
  link.href = "https://supabase.com/dashboard/new";
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = " Open Supabase";
  one.append(link);

  const two = step("2. In the project, open SQL Editor, paste this script and press Run. It adds the tables NZOSA keeps books in, and nothing else.");
  const said = document.createElement("p");
  said.className = "cloud-said";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy the script";
  copy.addEventListener("click", () => {
    void script().then(async (text) => {
      if (text === null) {
        said.textContent = "Could not load the script from this page.";
        said.className = "cloud-said bad";
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        said.textContent = "Copied. Paste it into the SQL editor.";
        said.className = "cloud-said";
      } catch {
        said.textContent = "This browser would not copy it: use Download instead.";
        said.className = "cloud-said bad";
      }
    });
  });
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Download the script";
  save.addEventListener("click", () => {
    void script().then((text) => {
      if (text !== null) download(text, "nzosa-own-project.sql", "text/plain");
    });
  });
  two.append(" ", copy, " ", save);

  const three = step(
    "3. Under Authentication, Sign In / Providers, Email: switch \"Confirm email\" off while you set up. (Supabase's own email sender allows only a few a day, and only to you.)",
  );
  const four = step("4. Under Project Settings, API Keys, copy the Project URL and the publishable key into these boxes.");

  const url = document.createElement("input");
  url.type = "text";
  url.placeholder = "https://abcdefgh.supabase.co";
  url.autocomplete = "off";
  const key = document.createElement("input");
  key.type = "text";
  key.placeholder = "sb_publishable_…";
  key.autocomplete = "off";
  const urlLabel = document.createElement("label");
  urlLabel.append("Project URL", url);
  const keyLabel = document.createElement("label");
  keyLabel.append("Publishable key", key);
  keyLabel.title = "The publishable key is meant to be public. Never paste a secret or service_role key here.";

  const test = document.createElement("button");
  test.type = "button";
  test.textContent = "Test the connection";
  const use = document.createElement("button");
  use.type = "button";
  use.className = "primary";
  use.textContent = "Use this project";
  use.disabled = true;

  const run = async (): Promise<ProjectCheck> => {
    if (/service_role|sb_secret_/i.test(key.value)) {
      const refused = { ok: false, confirmsEmail: false, said: "That looks like a secret key. Use the publishable key, which is safe to put in a web page; a secret key must never go here." };
      said.textContent = refused.said;
      said.className = "cloud-said bad";
      use.disabled = true;
      return refused;
    }
    said.textContent = "Checking…";
    said.className = "cloud-said";
    const result = await checkProject(url.value, key.value);
    said.textContent = result.said;
    said.className = result.ok ? "cloud-said" : "cloud-said bad";
    use.disabled = !result.ok;
    return result;
  };
  test.addEventListener("click", () => void run());
  use.addEventListener("click", () => {
    void run().then((result) => {
      if (result.ok) useProject(url.value, key.value);
    });
  });
  url.addEventListener("input", () => (use.disabled = true));
  key.addEventListener("input", () => (use.disabled = true));

  fold.append(one, two, three, four, urlLabel, keyLabel, test, " ", use, said);
  fold.append(
    note(
      `Until you use it, nothing changes here (this page is currently using ${CLOUD.url.replace(/^https:\/\//, "")}). ` +
        "The bank feed, AI suggestions, morning run and invitation emails are not available in your own project yet.",
    ),
  );
  return fold;
}

export { usingOwnProject };
