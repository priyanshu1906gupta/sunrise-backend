const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { copySite, hasAngularBuild, hasHostedApp, ANGULAR_SRC, REPO_ROOT, BACKEND_ROOT } = require("./copy-site.js");

const frontendRoot = path.join(REPO_ROOT, "sunrise-frontend");
const dests = [path.join(BACKEND_ROOT, "public"), path.join(BACKEND_ROOT, "dist", "public")];

function copyAll(requireAngular) {
  for (const dest of dests) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    copySite(dest, { requireAngular });
  }
}

if (hasAngularBuild(ANGULAR_SRC)) {
  copyAll(true);
  process.exit(0);
}

if (!fs.existsSync(path.join(frontendRoot, "package.json"))) {
  if (hasHostedApp()) {
    console.log("Using committed public/app for GoDaddy (Angular source not on this host).");
    copyAll(false);
    process.exit(0);
  }
  console.warn("Frontend folder not found and public/app is missing.");
  process.exit(0);
}

try {
  console.log("Building Angular frontend from", frontendRoot);
  execSync("npm install --include=dev", { cwd: frontendRoot, stdio: "inherit" });
  execSync("npm run build", { cwd: frontendRoot, stdio: "inherit" });
} catch (error) {
  console.error("Angular build failed. Use Node 20+ locally, then commit public/app for GoDaddy.");
  console.error(error);
  if (hasHostedApp()) {
    copyAll(false);
    process.exit(0);
  }
  process.exit(1);
}

if (!hasAngularBuild(ANGULAR_SRC)) {
  console.error("Angular build ran but index.html was not found at", ANGULAR_SRC);
  process.exit(1);
}

copyAll(true);
