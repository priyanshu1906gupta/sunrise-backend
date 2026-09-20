const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { copySite, hasAngularBuild, ANGULAR_SRC, REPO_ROOT, BACKEND_ROOT } = require("./copy-site.js");

const backendRoot = BACKEND_ROOT;
const repoRoot = REPO_ROOT;
const frontendRoot = path.join(repoRoot, "sunrise-frontend");

const dests = [
  path.join(backendRoot, "public"),
  path.join(backendRoot, "dist", "public"),
  path.join(repoRoot, "public"),
];

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
  console.warn("Frontend folder not found next to the API. Copying landing only.");
  try {
    copyAll(false);
  } catch (error) {
    console.warn(error);
  }
  process.exit(0);
}

try {
  console.log("Building Angular frontend from", frontendRoot);
  execSync("npm install --include=dev", { cwd: frontendRoot, stdio: "inherit" });
  execSync("npm run build", { cwd: frontendRoot, stdio: "inherit" });
} catch (error) {
  console.error("Angular build failed. Use Node 20+ or 22 on the host, or build the frontend locally.");
  console.error(error);
  try {
    copyAll(false);
  } catch (copyError) {
    console.warn(copyError);
  }
  process.exit(0);
}

if (!hasAngularBuild(ANGULAR_SRC)) {
  console.error("Angular build ran but index.html was not found at", ANGULAR_SRC);
  try {
    copyAll(false);
  } catch (copyError) {
    console.warn(copyError);
  }
  process.exit(0);
}

copyAll(true);
