/**
 * The local server: static files, and the ledger folder behind an API.
 *
 * The app in the browser is a working copy; this is what makes the folder on
 * disk the thing that is actually true. Every change the page makes is sent
 * here and written before the page considers it saved.
 *
 * It exists rather than esbuild's own server because the things that make a
 * file safe to call the truth all live outside the page: writing to a temp
 * file and renaming it into place, archiving rather than deleting, and holding
 * a lock so the command line refuses to write to a ledger that is open. A page
 * cannot do any of those.
 *
 * The API is deliberately shaped like something remote, not like a filesystem.
 * A part is fetched and written by name, carrying the version it was read at,
 * and a stale version is refused. Nothing needs that today -- one writer, one
 * folder -- but it is the same shape a hosted version would need, and adding
 * concurrency control after two people already share a ledger is a much worse
 * job than having it there unused.
 */
import { context } from "esbuild";
import { createServer } from "node:http";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PARTS,
  archiveLedger,
  heldBy,
  listArchives,
  listLedgers,
  readLedger,
  readMeta,
  readPart,
  restoreArchive,
  tidy,
  writeMeta,
  writePart,
} from "./ledger-folder.js";

const root = dirname(fileURLToPath(import.meta.url));
const outdir = join(root, "dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * The lock that keeps two writers apart.
 *
 * Written while the server runs and removed when it stops. The command line
 * checks for it and refuses, which is the whole of the concurrency story for
 * now: one writer at a time, enforced rather than hoped for.
 *
 * A stale lock after a crash is worse than no lock, so it carries a process id
 * and the reader is expected to ignore one whose process is gone.
 */
function lockFile(folder) {
  return join(folder, ".open-by");
}

function takeLock(folder) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    lockFile(folder),
    JSON.stringify({ pid: process.pid, since: new Date().toISOString() }, null, 1),
  );
}

function releaseLock(folder) {
  rmSync(lockFile(folder), { force: true });
}

function send(response, status, body, type = "application/json; charset=utf-8") {
  response.writeHead(status, {
    "content-type": type,
    // The page and the API are the same origin, so nothing here is a cross
    // origin request. Said explicitly so it stays that way.
    "cache-control": "no-store",
  });
  response.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Whether a string may name a ledger folder.
 *
 * The character test alone was not enough: "." and ".." are made entirely of
 * permitted characters, and ".." resolved to the folder above the ledger root
 * -- the project itself. Archiving there would have moved package.json and the
 * tsconfigs into an archive folder, which is a strange way to lose a
 * repository. So the name must also be one ordinary segment.
 */
function isLedgerName(id) {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return false;
  return id !== "." && id !== "..";
}

/** Serve a built file, refusing anything that tries to climb out of dist. */
function sendFile(response, urlPath) {
  const wanted = urlPath === "/" ? "/index.html" : urlPath;
  const file = resolve(join(outdir, decodeURIComponent(wanted)));
  // The separator matters: without it a sibling folder called "dist-backup"
  // starts with "dist" and would be served from.
  const served = resolve(outdir);
  if (file !== served && !file.startsWith(served + sep)) {
    send(response, 403, { error: "outside the served folder" });
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    send(response, 404, { error: "not found" });
    return;
  }
  response.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(response);
}

/**
 * Where the bank feed's credentials live.
 *
 * Beside the ledgers rather than inside one. A ledger folder is the books:
 * it gets copied, archived whenever anything is cleared, and handed to an
 * accountant. A token that reaches somebody's bank data has no business
 * travelling with it, and must survive switching between sets of books.
 */
function feedFile(root) {
  return join(root, ".akahu.json");
}

/**
 * One file, but a connection per set of books.
 *
 * It was a single connection shared by every ledger, which read correctly --
 * one person, one bank -- and was wrong. The account mapping points at
 * account ids that only exist in the books it was made in, and the demo
 * ledger, the one meant to be handed to somebody, would fetch real bank
 * transactions the moment it was opened. Keyed by ledger, opening another
 * set of books finds no connection, which is the truth.
 */
function readStore(root) {
  try {
    return JSON.parse(readFileSync(feedFile(root), "utf8"));
  } catch {
    return {};
  }
}

function readFeed(root, ledger) {
  return readStore(root)[ledger] ?? null;
}

function writeStore(root, store) {
  mkdirSync(root, { recursive: true });
  const file = feedFile(root);
  const temporary = `${file}.writing`;
  writeFileSync(temporary, JSON.stringify(store, null, 1));
  renameSync(temporary, file);
}

function writeFeed(root, ledger, feed) {
  writeStore(root, { ...readStore(root), [ledger]: feed });
}

function forgetFeed(root, ledger) {
  const store = readStore(root);
  delete store[ledger];
  writeStore(root, store);
}

/**
 * Ask Akahu something, as this installation.
 *
 * Both tokens go on every request: the app token says which app is asking and
 * the user token says whose data it may see. The user token is the one that
 * matters, and it never leaves this process -- the page holds neither.
 */
async function akahu(feed, path, search = "") {
  const response = await fetch(`https://api.akahu.io/v1${path}${search}`, {
    headers: {
      Authorization: `Bearer ${feed.userToken}`,
      "X-Akahu-Id": feed.appToken,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body === null || body.success === false) {
    const said = body && typeof body.message === "string" ? body.message : `HTTP ${response.status}`;
    throw new Error(said);
  }
  return body;
}

export function startServer({ port, ledgerRoot, ledgerId }) {
  const folderOf = (id) => join(ledgerRoot, id);
  let current = ledgerId;

  // Refuse rather than join. Two servers on one folder each hold their own copy
  // of the books and write it over the other's, which loses work silently and
  // is the one failure this whole design exists to prevent.
  const already = heldBy(folderOf(current));
  if (already !== null) {
    throw new Error(
      `These books are already open in another NZOSA (process ${already.pid}` +
        `${already.since ? `, since ${already.since}` : ""}).\n` +
        `Close that one first, or start this with --ledger <another name>.`,
    );
  }

  tidy(folderOf(current));
  takeLock(folderOf(current));

  const server = createServer(async (request, response) => {
    const host = request.headers.host;
    if (!host || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      send(response, 403, { error: "that request did not come from this app" });
      return;
    }

    const url = new URL(request.url ?? "/", `http://${host}`);
    const path = url.pathname;

    try {
      // Anything that changes something is checked here rather than route by
      // route, so a route added later inherits the guard instead of having to
      // remember it. Three of them had it and four did not, including the one
      // that archives a whole set of books.
      //
      // Two checks, because they fail in different places. A browser attaches
      // an Origin to any cross-site request, so one that arrives from anywhere
      // but this app is refused outright. And a form post carries a content
      // type a fetch cannot fake without asking permission first -- which this
      // server never grants -- so requiring JSON closes the one method that
      // crosses origins without being asked.
      if (path.startsWith("/api/") && request.method !== "GET" && request.method !== "HEAD") {
        const origin = request.headers.origin;
        if (origin !== undefined && origin !== `http://${request.headers.host}`) {
          send(response, 403, { error: "that request did not come from this app" });
          return;
        }
        if (
          request.method === "POST" &&
          !/^application\/json/.test(request.headers["content-type"] ?? "")
        ) {
          send(response, 415, { error: "expected application/json" });
          return;
        }
      }

      if (!path.startsWith("/api/")) {
        sendFile(response, path);
        return;
      }

      // What the page asks first: is there a folder behind this at all? A no
      // is a real answer -- the hosted copy has no server, and the app falls
      // back to keeping everything in the browser.
      if (path === "/api/status" && request.method === "GET") {
        send(response, 200, {
          writable: true,
          ledger: current,
          name: readMeta(folderOf(current)).name || current,
          folder: folderOf(current),
          ledgers: listLedgers(ledgerRoot),
          parts: PARTS,
        });
        return;
      }

      if (path === "/api/ledger" && request.method === "GET") {
        send(response, 200, readLedger(folderOf(current)));
        return;
      }

      const partMatch = /^\/api\/ledger\/parts\/([a-z]+)$/.exec(path);
      if (partMatch && request.method === "PUT") {
        const part = partMatch[1];
        if (!PARTS.includes(part)) {
          send(response, 404, { error: `no such part: ${part}` });
          return;
        }
        const body = JSON.parse(await readBody(request));
        const result = writePart(
          folderOf(current),
          part,
          body.data,
          body.version,
          body.allowEmpty === true,
        );
        if (!result.ok) {
          if (result.refusedEmpty) {
            send(response, 409, {
              error: `refused to empty ${part}: it holds something and the write did not`,
              current: result.current,
            });
            return;
          }
          // Somebody else moved it. Hand back what is actually there rather
          // than an error the page can only guess at.
          send(response, 409, { error: "version conflict", current: result.conflict });
          return;
        }
        // One line per write, so what the app did to the folder can be read
        // back afterwards. A silent writer is very hard to argue with when a
        // file turns out to hold less than it did.
        const held = body.data;
        const size = Array.isArray(held)
          ? `${held.length} items`
          : held && typeof held === "object"
            ? `${Object.keys(held).length} keys`
            : String(held);
        process.stdout.write(`wrote ${part} v${result.version} (${size})
`);
        send(response, 200, { version: result.version });
        return;
      }

      if (path === "/api/ledger/archive" && request.method === "POST") {
        // Any set of books, not only the open one, so they can be cleared from
        // the Books page without opening each in turn. Named books are checked
        // and refused if another NZOSA has them: clearing a folder somebody
        // else is writing to is how two processes disagree about what the
        // books are.
        const body = JSON.parse((await readBody(request)) || "{}");
        const named = String(body.ledger ?? "").trim();
        const target = named === "" ? current : named;
        if (!isLedgerName(target)) {
          send(response, 400, { error: "not a ledger name" });
          return;
        }
        if (target !== current) {
          const busy = heldBy(folderOf(target));
          if (busy !== null) {
            send(response, 409, {
              error: `Those books are open in another NZOSA (process ${busy.pid}).`,
            });
            return;
          }
        }
        const result = archiveLedger(folderOf(target));
        send(response, 200, { ...result, ledger: target });
        return;
      }

      // --- the bank feed ------------------------------------------------
      //
      // The tokens stay on this side. The page is told whether a connection
      // exists and nothing more, so a token cannot be read back out of the
      // screen, out of browser storage, or out of a page somebody else opened.
      if (path === "/api/feed" && request.method === "GET") {
        const feed = readFeed(ledgerRoot, current);
        send(response, 200, {
          configured: feed !== null,
          appToken: feed ? `${feed.appToken.slice(0, 14)}…` : "",
          accounts: feed?.accounts ?? {},
          balances: feed?.balances ?? [],
          // Defaults to on: somebody who connected a feed wants what it holds,
          // and having to ask for it every time is the step the feed removed.
          autoFetch: feed?.autoFetch !== false,
          lastFetch: feed?.lastFetch ?? "",
        });
        return;
      }

      if (path === "/api/feed" && request.method === "PUT") {
        // A cross-origin form cannot set this content type without a preflight
        // this server never answers, so requiring it keeps a page you happen to
        // be visiting from storing tokens here.
        if (!/^application\/json/.test(request.headers["content-type"] ?? "")) {
          send(response, 415, { error: "expected application/json" });
          return;
        }
        const body = JSON.parse(await readBody(request));
        const appToken = String(body.appToken ?? "").trim();
        const userToken = String(body.userToken ?? "").trim();
        if (!appToken.startsWith("app_token_") || !userToken.startsWith("user_token_")) {
          send(response, 400, {
            error: "an app token starts with app_token_ and a user token with user_token_",
          });
          return;
        }
        const existing = readFeed(ledgerRoot, current);
        writeFeed(ledgerRoot, current, { appToken, userToken, accounts: existing?.accounts ?? {} });
        send(response, 200, { configured: true });
        return;
      }

      if (path === "/api/feed" && request.method === "DELETE") {
        // Only this ledger's connection: another set of books may have its
        // own, and disconnecting here is not disconnecting there.
        forgetFeed(ledgerRoot, current);
        send(response, 200, { configured: false });
        return;
      }

      if (path === "/api/feed/accounts" && request.method === "GET") {
        const feed = readFeed(ledgerRoot, current);
        if (feed === null) {
          send(response, 400, { error: "no bank feed is connected" });
          return;
        }
        try {
          const body = await akahu(feed, "/accounts");
          send(response, 200, { accounts: body.items ?? [] });
        } catch (error) {
          send(response, 502, { error: `Akahu said: ${error.message}` });
        }
        return;
      }

      // Which of their accounts is which of ours. Kept beside the tokens so it
      // survives clearing a set of books, and so it is not mistaken for part of
      // them.
      if (path === "/api/feed/accounts" && request.method === "PUT") {
        if (!/^application\/json/.test(request.headers["content-type"] ?? "")) {
          send(response, 415, { error: "expected application/json" });
          return;
        }
        const feed = readFeed(ledgerRoot, current);
        if (feed === null) {
          send(response, 400, { error: "no bank feed is connected" });
          return;
        }
        const body = JSON.parse(await readBody(request));
        writeFeed(ledgerRoot, current, { ...feed, accounts: body.accounts ?? {} });
        send(response, 200, { accounts: body.accounts ?? {} });
        return;
      }

      if (path === "/api/feed/settings" && request.method === "PUT") {
        if (!/^application\/json/.test(request.headers["content-type"] ?? "")) {
          send(response, 415, { error: "expected application/json" });
          return;
        }
        const feed = readFeed(ledgerRoot, current);
        if (feed === null) {
          send(response, 400, { error: "no bank feed is connected" });
          return;
        }
        const body = JSON.parse(await readBody(request));
        writeFeed(ledgerRoot, current, { ...feed, autoFetch: body.autoFetch !== false });
        send(response, 200, { autoFetch: body.autoFetch !== false });
        return;
      }

      if (path === "/api/feed/transactions" && request.method === "GET") {
        const feed = readFeed(ledgerRoot, current);
        if (feed === null) {
          send(response, 400, { error: "no bank feed is connected" });
          return;
        }
        const start = url.searchParams.get("start") ?? "";
        const end = url.searchParams.get("end") ?? "";
        try {
          // Paged through here rather than in the page, so a fetch is one
          // answer rather than a conversation the browser has to manage.
          const items = [];
          let cursor = "";
          for (let page = 0; page < 200; page += 1) {
            const search = new URLSearchParams();
            if (start !== "") search.set("start", start);
            if (end !== "") search.set("end", end);
            if (cursor !== "") search.set("cursor", cursor);
            const body = await akahu(feed, "/transactions", `?${search.toString()}`);
            items.push(...(body.items ?? []));
            cursor = body.cursor?.next ?? "";
            if (cursor === "") break;
          }
          // The balances as they stand, kept with the date.
          //
          // Akahu gives the balance now and no history, and a single figure
          // proves nothing: a ledger holds the change since it began while a
          // balance is the whole account, so the difference between them is
          // just however much came before. Two of them are worth something.
          // How far the balance moved between one fetch and the next has to
          // equal what the transactions in that window come to, and where it
          // does not, the window says where to look.
          //
          // So the app builds the history the bank will not give it, a fetch
          // at a time, and it costs one extra call.
          let balances = feed.balances ?? [];
          try {
            const now = await akahu(feed, "/accounts");
            const taken = {};
            for (const account of now.items ?? []) {
              if (account.balance?.current !== undefined) {
                taken[account._id] = Math.round(account.balance.current * 100);
              }
            }
            balances = [...balances, { at: new Date().toISOString(), balances: taken }].slice(-60);
          } catch {
            // A fetch that worked should not fail because the balances did.
          }

          writeFeed(ledgerRoot, current, {
            ...feed,
            lastFetch: new Date().toISOString(),
            balances,
          });
          send(response, 200, { items });
        } catch (error) {
          send(response, 502, { error: `Akahu said: ${error.message}` });
        }
        return;
      }

      if (path === "/api/ledger/archives" && request.method === "GET") {
        const named = (url.searchParams.get("ledger") ?? "").trim();
        const target = named === "" ? current : named;
        if (!isLedgerName(target)) {
          send(response, 400, { error: "not a ledger name" });
          return;
        }
        send(response, 200, { archives: listArchives(folderOf(target)), ledger: target });
        return;
      }

      if (path === "/api/ledger/restore" && request.method === "POST") {
        const body = JSON.parse(await readBody(request));
        const named = String(body.ledger ?? "").trim();
        const target = named === "" ? current : named;
        if (!isLedgerName(target)) {
          send(response, 400, { error: "not a ledger name" });
          return;
        }
        if (target !== current) {
          const busy = heldBy(folderOf(target));
          if (busy !== null) {
            send(response, 409, {
              error: `Those books are open in another NZOSA (process ${busy.pid}).`,
            });
            return;
          }
        }
        const result = restoreArchive(folderOf(target), String(body.stamp ?? ""));
        send(response, result.ok ? 200 : 400, result);
        return;
      }

      if (path === "/api/ledger/switch" && request.method === "POST") {
        const body = JSON.parse(await readBody(request));
        const id = String(body.ledger ?? "").trim();
        if (!isLedgerName(id)) {
          send(response, 400, { error: "a ledger name may hold letters, digits, dot, dash and underscore" });
          return;
        }
        const busy = heldBy(folderOf(id));
        if (busy !== null) {
          send(response, 409, {
            error: `Those books are open in another NZOSA (process ${busy.pid}).`,
          });
          return;
        }
        releaseLock(folderOf(current));
        current = id;
        mkdirSync(folderOf(current), { recursive: true });
        if (!readMeta(folderOf(current)).created) {
          const label = typeof body.name === "string" && body.name.trim() !== "" ? body.name.trim() : id;
          writeMeta(folderOf(current), { name: label, created: new Date().toISOString() });
        }
        tidy(folderOf(current));
        takeLock(folderOf(current));
        send(response, 200, { ledger: current, folder: folderOf(current) });
        return;
      }

      send(response, 404, { error: "no such endpoint" });
    } catch (error) {
      send(response, 500, { error: error.message });
    }
  });

  const stop = () => {
    releaseLock(folderOf(current));
    server.close();
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stop(); process.exit(0); });
  process.on("exit", () => releaseLock(folderOf(current)));

  return new Promise((resolvePromise, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePromise({ server, stop }));
  });
}

/** Rebuild on change, so editing a source file is enough. */
export async function watch(options) {
  const ctx = await context(options);
  await ctx.watch();
  return ctx;
}

export { readPart };
