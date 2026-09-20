const fs = require("fs");
const path = require("path");

function findMonorepoRoot() {
  const starts = [path.join(__dirname, "..", ".."), path.join(__dirname, ".."), process.cwd()];
  for (const start of starts) {
    let current = path.resolve(start);
    for (let i = 0; i < 6; i++) {
      if (
        fs.existsSync(path.join(current, "sunrise-frontend", "package.json"))
      ) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return null;
}

const BACKEND_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = findMonorepoRoot() || BACKEND_ROOT;
const LANDING_SRC = path.join(REPO_ROOT, "sunrise-landing");
const ANGULAR_SRC = path.join(
  REPO_ROOT,
  "sunrise-frontend",
  "dist",
  "coreui-free-angular-admin-template",
  "browser",
);

const PRESERVE_IN_PUBLIC = new Set(["assets", "app"]);

function copyLanding(destPublic) {
  if (!fs.existsSync(path.join(LANDING_SRC, "index.html"))) {
    if (fs.existsSync(path.join(destPublic, "index.html"))) {
      console.warn("Landing source not next to this API; keeping existing files in", destPublic);
      return false;
    }
    console.warn("Landing site not found at " + LANDING_SRC + " (skipped)");
    return false;
  }
  fs.mkdirSync(destPublic, { recursive: true });
  for (const entry of fs.readdirSync(LANDING_SRC, { withFileTypes: true })) {
    if (PRESERVE_IN_PUBLIC.has(entry.name)) continue;
    const from = path.join(LANDING_SRC, entry.name);
    const to = path.join(destPublic, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(from, to, { recursive: true });
    } else {
      fs.copyFileSync(from, to);
    }
  }
  const landingNames = new Set(fs.readdirSync(LANDING_SRC));
  for (const name of fs.readdirSync(destPublic)) {
    if (PRESERVE_IN_PUBLIC.has(name) || landingNames.has(name)) continue;
    fs.rmSync(path.join(destPublic, name), { recursive: true, force: true });
  }
  return true;
}

function copyAngular(destPublic, angularSrc) {
  const dest = path.join(destPublic, "app");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(angularSrc, dest, { recursive: true });
}

function hasAngularBuild(angularSrc = ANGULAR_SRC) {
  return fs.existsSync(path.join(angularSrc, "index.html"));
}

function copySite(destPublic, { angularSrc = ANGULAR_SRC, requireAngular = true } = {}) {
  fs.mkdirSync(destPublic, { recursive: true });
  const copiedLanding = copyLanding(destPublic);
  const built = hasAngularBuild(angularSrc);
  if (built) {
    copyAngular(destPublic, angularSrc);
  } else if (requireAngular) {
    throw new Error("Frontend build not found at " + angularSrc);
  }
  console.log(
    (copiedLanding ? "Copied landing" : "Kept existing landing") +
      (built ? " + /app" : "") +
      " to " +
      destPublic,
  );
  return built;
}

module.exports = {
  copySite,
  hasAngularBuild,
  ANGULAR_SRC,
  LANDING_SRC,
  REPO_ROOT,
  BACKEND_ROOT,
};
