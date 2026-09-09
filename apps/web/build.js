import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { startServer, watch } from "./server.js";

/**
 * Builds the web app to a folder of plain static files.
 *
 * The output is deliberately boring: one HTML file, one CSS file, one JS
 * bundle, no server and no runtime configuration. That is what makes it
 * deployable to GitHub Pages, Netlify, Cloudflare Pages, a free shared host,
 * or a USB stick, which is the point -- the tool has to be usable by someone
 * who has nowhere to run a backend.
 */
const root = dirname(fileURLToPath(import.meta.url));
const outdir = join(root, "dist");
const serve = process.argv.includes("--serve");

// A port option is not a convenience. Browser storage is per origin, so serving
// on another port gives a completely separate database — which is how a full
// test runs from an empty app without touching real work.
const portArg = process.argv.indexOf("--port");
const wanted = portArg >= 0 ? Number(process.argv[portArg + 1]) : 3210;
if (!Number.isInteger(wanted) || wanted < 1 || wanted > 65535) {
  process.stderr.write(`Not a port: ${process.argv[portArg + 1]}\n`);
  process.exit(2);
}

/**
 * Opens the app in whatever the machine calls a browser.
 *
 * The difference between "run this command, then find the URL" and
 * "double-click this". Failing to open is not worth an error: the URL is
 * always printed as well.
 */
function openBrowser(url) {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // No browser, or no shell to open one with. The URL is above.
  }
}

/** Is NZOSA already answering on this port, or is it something else? */
async function nzosaIsOn(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return (await response.text()).includes("<title>NZOSA</title>");
  } catch {
    return false;
  }
}

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
// Everything in public/, which is now only the page, its styles and the
// invented demo. Real books used to sit in public/data and be seeded from
// there, and the filter below existed to keep them out of a build. They have
// been moved out of the web folder entirely -- a directory called "public" is
// the wrong place to keep somebody's ledger, however carefully the build is
// filtered -- so the guard stays as a guard rather than as a workaround.
const publicData = join(root, "public", "data");
cpSync(join(root, "public"), outdir, {
  recursive: true,
  filter: (from) => !from.startsWith(publicData),
});

const options = {
  entryPoints: [join(root, "src/main.ts")],
  bundle: true,
  format: "esm",
  target: ["es2022"],
  outfile: join(outdir, "app.js"),
  sourcemap: true,
  minify: !serve,
  logLevel: "info",
};

if (serve) {
  // esbuild only rebuilds now; serving is ours, because the ledger folder needs
  // an API in front of it and esbuild's server has no room for one.
  const ctx = await watch(options);

  // Where the books live. A folder per ledger, so switching to the demo and
  // back is a different folder rather than a different browser.
  const folderArg = process.argv.indexOf("--ledgers");
  const ledgerRoot = folderArg >= 0 ? resolve(process.argv[folderArg + 1]) : join(root, "..", "..", "ledgers");
  const nameArg = process.argv.indexOf("--ledger");
  const ledgerId = nameArg >= 0 ? process.argv[nameArg + 1] : "my-books";

  // A port already in use is the likeliest thing to go wrong for someone who
  // just double-clicked a launcher, usually because they did it twice.
  // Deliberately no falling back to the next free port: a different port is a
  // different address, and the app would look like a stranger's.
  let running;
  try {
    running = await startServer({ port: wanted, ledgerRoot, ledgerId });
  } catch (error) {
    // Books already open elsewhere is its own answer, and not a port clash.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already open in another NZOSA")) {
      process.stderr.write(`
${message}

`);
      await ctx.dispose();
      process.exit(1);
    }

    const url = `http://127.0.0.1:${wanted}`;
    if (await nzosaIsOn(url)) {
      process.stdout.write(`\nNZOSA is already running at ${url}\n`);
      process.stdout.write("Opening that one. You can close this window.\n");
      if (process.argv.includes("--open")) openBrowser(url);
      await ctx.dispose();
      process.exit(0);
    }
    process.stderr.write(
      [
        ``,
        `Something else on this computer is already using port ${wanted},`,
        `so NZOSA cannot start there.`,
        ``,
        `Close that other program and try again, or start NZOSA on a`,
        `different port with:  npm run dev -w @nzosa/web -- --port ${wanted + 1}`,
        ``,
        `(${error instanceof Error ? error.message : String(error)})`,
        ``,
      ].join("\n"),
    );
    await ctx.dispose();
    process.exit(1);
  }

  const url = `http://127.0.0.1:${wanted}`;
  process.stdout.write(`\nNZOSA: ${url}\n`);
  process.stdout.write(`Books: ${join(ledgerRoot, ledgerId)}\n`);
  if (process.argv.includes("--open")) openBrowser(url);
  void running;
} else {
  await build(options);
}
