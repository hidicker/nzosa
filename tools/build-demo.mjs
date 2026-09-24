import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDist = join(root, "apps", "web", "dist");
const demoDir = join(root, "online-demo");

console.log("Building web app for production...");
execSync("node apps/web/build.js", { cwd: root, stdio: "inherit" });

if (!existsSync(webDist)) {
  console.error("Build failed: apps/web/dist does not exist.");
  process.exit(1);
}

console.log(`Preparing online demo folder at ${demoDir}...`);
rmSync(demoDir, { recursive: true, force: true });
mkdirSync(demoDir, { recursive: true });

// Copy static web assets and demo dataset
let demoHtml = readFileSync(join(webDist, "index.html"), "utf-8");
// The page says it is the demo, so the app can ask the page rather than the
// books a returning visitor saved under an older demo. See ai-consent.ts.
demoHtml = demoHtml.replace(/<html(\s|>)/, '<html data-demo="yes"$1');
if (!demoHtml.includes('data-demo="yes"')) {
  console.error("Could not mark index.html as the demo.");
  process.exit(1);
}
demoHtml = demoHtml.replace('id="demo-banner" class="demo-banner" hidden', 'id="demo-banner" class="demo-banner"');
demoHtml = demoHtml.replace('id="demo-import-privacy-notice" class="demo-privacy-notice" hidden', 'id="demo-import-privacy-notice" class="demo-privacy-notice"');
writeFileSync(join(demoDir, "index.html"), demoHtml, "utf-8");
cpSync(join(webDist, "styles.css"), join(demoDir, "styles.css"));
cpSync(join(webDist, "app.js"), join(demoDir, "app.js"));
// Images the page shows, such as the OpenAccountants logo on the AI check.
for (const file of readdirSync(webDist)) {
  if (/\.(png|svg|jpg)$/i.test(file)) cpSync(join(webDist, file), join(demoDir, file));
}
if (existsSync(join(webDist, "app.js.map"))) {
  cpSync(join(webDist, "app.js.map"), join(demoDir, "app.js.map"));
}
if (existsSync(join(webDist, "demo"))) {
  cpSync(join(webDist, "demo"), join(demoDir, "demo"), { recursive: true });
}

// Add .htaccess for cPanel / Apache security
const htaccessContent = `# NZOSA Online Demo Security Configuration
# Prevent directory listing
Options -Indexes

# Defensive HTTP headers
<IfModule mod_headers.c>
  Header set X-Frame-Options "SAMEORIGIN"
  Header set X-Content-Type-Options "nosniff"
  Header set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>

# Revalidate on every visit. The page, the app and the demo data are replaced
# together when the demo is uploaded; a browser holding an old copy of any one
# of them shows a mix of two versions.
<IfModule mod_headers.c>
  <FilesMatch "\\.(html|js|css|json|csv)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
`;
writeFileSync(join(demoDir, ".htaccess"), htaccessContent, "utf-8");

// Add instructions for upload
const readmeContent = `# NZOSA Online Demo Build

This directory contains the production build for the online demo hosted at:
https://nbparagliding.nz/nzosa_demo/

That is **not** the same place as the app itself, which lives at
https://nbparagliding.nz/nzosa/ and is deployed separately. Unpacking this
over \`nzosa/\` would replace the app with the demo, banner and seed data and
all.

## How to Deploy / Upload
Upload the files in this directory (or \`online-demo.zip\`) to the \`nzosa_demo/\` web directory on your hosting server (cPanel File Manager, SFTP, or FTP).

Ensure the following files and folders sit in \`/nzosa_demo/\`:
- \`index.html\`
- \`styles.css\`
- \`app.js\`
- \`app.js.map\`
- \`.htaccess\` (prevents directory browsing & adds security headers)
- \`demo/\` (contains demo CSV and JSON seeds)

## Rebuilding
Whenever you want to refresh the online demo build, run:
\`\`\`bash
npm run build:demo
\`\`\`
`;
writeFileSync(join(demoDir, "README.md"), readmeContent, "utf-8");

// Create online-demo.zip for easy cPanel upload
const zipPath = join(demoDir, "online-demo.zip");
console.log("Creating online-demo.zip...");
try {
  if (process.platform === "win32") {
    // Windows' own tar, not PowerShell's Compress-Archive: that stores paths
    // with backslashes, and a Linux host unpacks `demo\ledger.json` as a file
    // of that name beside index.html -- so the upload looked complete and the
    // site went on serving the demo data from the upload before.
    const entries = readdirSync(demoDir).filter((name) => name !== "online-demo.zip");
    // Named by its full path: run from Git Bash, "tar.exe" is Git's GNU tar,
    // which cannot write a zip and made a plain tar file with a .zip name.
    const windowsTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    const made = spawnSync(
      windowsTar,
      ["-a", "-c", "-f", "online-demo.zip", "--options", "compression=deflate", ...entries],
      { cwd: demoDir, stdio: "inherit" },
    );
    // spawnSync reports a failure rather than throwing it, so a missing tar or
    // a refused option would otherwise leave no zip and say nothing.
    if (made.error || made.status !== 0) {
      console.warn(`tar did not make the zip: ${made.error?.message ?? `exit ${made.status}`}`);
    }
  } else {
    spawnSync("zip", ["-r", "online-demo.zip", "."], { cwd: demoDir, stdio: "inherit" });
  }
  if (existsSync(zipPath)) {
    console.log(`Successfully created ${zipPath}`);
  }
} catch (err) {
  console.warn("Could not create zip archive automatically:", err.message);
}

console.log(`\nOnline demo package ready in: ${demoDir}\n`);
