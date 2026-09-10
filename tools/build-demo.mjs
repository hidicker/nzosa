import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
demoHtml = demoHtml.replace('id="demo-banner" class="demo-banner" hidden', 'id="demo-banner" class="demo-banner"');
writeFileSync(join(demoDir, "index.html"), demoHtml, "utf-8");
cpSync(join(webDist, "styles.css"), join(demoDir, "styles.css"));
cpSync(join(webDist, "app.js"), join(demoDir, "app.js"));
if (existsSync(join(webDist, "app.js.map"))) {
  cpSync(join(webDist, "app.js.map"), join(demoDir, "app.js.map"));
}
if (existsSync(join(webDist, "demo"))) {
  cpSync(join(webDist, "demo"), join(demoDir, "demo"), { recursive: true });
}

// Add instructions for upload
const readmeContent = `# NZOSA Online Demo Build

This directory contains the production build for the online demo hosted at:
https://nbparagliding.nz/nzosa/

## How to Deploy / Upload
Upload the files in this directory (or \`online-demo.zip\`) to the \`nzosa/\` web directory on your hosting server (cPanel File Manager, SFTP, or FTP).

Ensure the following files and folders sit in \`/nzosa/\`:
- \`index.html\`
- \`styles.css\`
- \`app.js\`
- \`app.js.map\`
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
    const psCmd = `Compress-Archive -Path '${demoDir}\\*' -DestinationPath '${zipPath}' -Force`;
    spawnSync("powershell", ["-NoProfile", "-Command", psCmd], { stdio: "inherit" });
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
