import { backendKind, folderPaths, openCloudBookId } from "../store.js";
import { connectorUrl } from "../cloud.js";
import { note } from "../ui.js";

/**
 * Use your own AI app: Claude, Cursor, VS Code, LM Studio and the rest.
 *
 * NZOSA's MCP server lets the AI app somebody already uses read these books
 * and suggest codes, splits and journals, which wait here until they are
 * saved. This panel is how they connect it: the Claude Desktop extension to
 * download, or the settings for any other app, with this computer's paths
 * already in.
 */

/** The extension, built with each release of the site. */
export const EXTENSION_URL = "https://nbparagliding.nz/nzosa/nzosa.mcpb";

function copyButton(label: string, text: () => string, said: HTMLElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "small";
  button.textContent = label;
  button.addEventListener("click", () => {
    void navigator.clipboard
      .writeText(text())
      .then(() => (said.textContent = "Copied."))
      .catch(() => (said.textContent = "Could not copy: select the text and copy it."));
  });
  return button;
}

function steps(lines: readonly (string | Node)[][]): HTMLOListElement {
  const list = document.createElement("ol");
  list.className = "own-ai-steps";
  for (const parts of lines) {
    const li = document.createElement("li");
    li.append(...parts);
    list.append(li);
  }
  return list;
}

function code(text: string): HTMLElement {
  const c = document.createElement("code");
  c.textContent = text;
  return c;
}

function heading(text: string): HTMLElement {
  const h = document.createElement("h4");
  h.textContent = text;
  return h;
}

/** What happens to what the AI suggests, said the same way for every route. */
function whereItLands(): HTMLElement {
  return note(
    "What it suggests waits here until you decide: codes show on Reconcile as suggestions to tick, and " +
      "splits and journals under Actions required, to open, check and save, or decline. " +
      "Nothing goes into the books until you do. Your AI app sends what it reads to the company that runs it.",
  );
}

/** For books in a folder on this computer: the extension, or another app's settings. */
function forFolder(inner: HTMLElement): void {
  const said = document.createElement("p");
  said.className = "own-ai-said";
  const where = document.createElement("p");
  where.textContent = "Finding where these books are…";
  inner.append(
    heading("Claude Desktop"),
    steps([
      ["Download the ", Object.assign(document.createElement("a"), { href: EXTENSION_URL, textContent: "NZOSA books extension", download: "nzosa.mcpb" }), "."],
      ["In Claude Desktop, open Settings, Extensions, and open the file you downloaded."],
      ["When it asks for the books folder, choose this one: ", where],
      ["Turn on Let Claude suggest for codes, splits and journals. Left off, Claude only reads."],
      ["In a new chat, ask: “Suggest codes for this month's uncoded lines.”"],
    ]),
    heading("Other AI apps"),
    note(
      "Cursor, VS Code, Gemini CLI, LM Studio and other apps that take MCP servers can use the same one. " +
        "Copy the settings below into the app's MCP settings (often a file called mcp.json). " +
        "LM Studio can run the model on this computer, so nothing leaves it.",
    ),
  );
  const settings = document.createElement("pre");
  settings.className = "own-ai-settings";
  const copy = copyButton("Copy settings", () => settings.textContent ?? "", said);
  copy.disabled = true;
  inner.append(settings, copy, said, whereItLands());

  void folderPaths().then((paths) => {
    if (paths === null) {
      where.textContent = "the folder NZOSA keeps these books in.";
      settings.hidden = true;
      copy.hidden = true;
      return;
    }
    where.textContent = "";
    where.append(code(paths.books), " ", copyButton("Copy", () => paths.books, said));
    if (paths.mcpServer === null) {
      settings.textContent = "This copy of NZOSA has no MCP server built. Start NZOSA with NZOSA.cmd (or NZOSA.command) to build it.";
      return;
    }
    settings.textContent = JSON.stringify(
      { mcpServers: { "nzosa-books": { command: "node", args: [paths.mcpServer, "--books", paths.books, "--suggest"] } } },
      null,
      2,
    );
    copy.disabled = false;
  });
}

/** For books kept online: the connector address, for Claude, ChatGPT and others. */
function forOnline(inner: HTMLElement, book: string): void {
  const said = document.createElement("p");
  said.className = "own-ai-said";
  const address = connectorUrl(book);
  const shown = document.createElement("p");
  shown.append(code(address), " ", copyButton("Copy", () => address, said));
  inner.append(
    heading("The connector address for these books"),
    shown,
    said,
    heading("Claude (on the web, the desktop app or a phone)"),
    steps([
      ["Open Settings, Connectors, and choose Add custom connector."],
      ["Name it NZOSA, paste the address above, and add it."],
      ["Choose Connect. Sign in to NZOSA when asked, and allow it."],
      ["In a chat, turn the NZOSA connector on and ask: “Suggest codes for this month's uncoded lines.”"],
    ]),
    heading("ChatGPT and other apps"),
    note(
      "Any app that takes a remote MCP connector with sign-in can use the same address. In ChatGPT, adding your own " +
        "connector needs developer mode, in its settings under connectors. The app asks you to sign in to NZOSA and allow it, as above.",
    ),
    note(
      "Each set of books has its own address, and only people who are members of these books can connect to them. " +
        "Somebody who may only read them gets an app that only reads.",
    ),
    whereItLands(),
  );
}

export function ownAiPanel(): HTMLElement {
  const box = document.createElement("div");
  box.className = "ai-panel own-ai";
  const inner = document.createElement("div");
  box.append(inner);
  inner.append(
    note(
      "The AI app you already use — Claude, or one of the others below — can read these books and suggest codes, " +
        "splits and journals for you to check here. It uses your own subscription, not a key in NZOSA.",
    ),
  );
  const kind = backendKind();
  if (kind === "folder") {
    forFolder(inner);
  } else if (kind === "cloud" && openCloudBookId() !== "") {
    forOnline(inner, openCloudBookId());
  } else {
    inner.append(
      note("This needs NZOSA running on your own computer, with the books in a folder there, or books kept online."),
    );
  }
  return box;
}
