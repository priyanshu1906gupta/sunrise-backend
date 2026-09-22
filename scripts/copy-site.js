const fs = require("fs");
const path = require("path");

function findMonorepoRoot() {
  const starts = [path.join(__dirname, "..", ".."), path.join(__dirname, ".."), process.cwd()];
  for (const start of starts) {
    let current = path.resolve(start);
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(current, "sunrise-frontend", "package.json"))) {
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

function isMarketingDir(dir) {
  if (!dir || !fs.existsSync(path.join(dir, "index.html"))) return false;
  return (
    fs.existsSync(path.join(dir, "robots.txt")) ||
    fs.existsSync(path.join(dir, "about.html")) ||
    fs.existsSync(path.join(dir, "download.html")) ||
    fs.existsSync(path.join(dir, "features.html")) ||
    fs.existsSync(path.join(dir, "contact.html"))
  );
}

function isAppRedirectHtml(file) {
  try {
    const html = fs.readFileSync(file, "utf8");
    return html.includes('location.replace("/app/")') || html.includes('content="0;url=/app/"');
  } catch {
    return false;
  }
}

function resolveLandingSrc(repoRoot) {
  const candidates = [
    path.join(BACKEND_ROOT, "landing"),
    path.join(repoRoot, "sunrise-landing"),
    path.join(repoRoot, "sunrise-landing page"),
    path.join(BACKEND_ROOT, "public"),
  ];
  for (const dir of candidates) {
    if (isMarketingDir(dir)) return dir;
  }
  return null;
}

const LANDING_SRC = resolveLandingSrc(REPO_ROOT);
const ANGULAR_SRC = path.join(
  REPO_ROOT,
  "sunrise-frontend",
  "dist",
  "coreui-free-angular-admin-template",
  "browser",
);

const PRESERVE_IN_PUBLIC = new Set(["assets", "app", "downloads"]);
const SKIP_LANDING_NAMES = new Set([".git", "node_modules", ".gitignore"]);

function restoreLandingIndex(destPublic) {
  const index = path.join(destPublic, "index.html");
  const srcIndex = LANDING_SRC && path.join(LANDING_SRC, "index.html");
  if (!srcIndex || !fs.existsSync(srcIndex)) return;
  if (!fs.existsSync(index) || isAppRedirectHtml(index)) {
    fs.mkdirSync(destPublic, { recursive: true });
    fs.copyFileSync(srcIndex, index);
  }
}

function copyLanding(destPublic) {
  const src = LANDING_SRC && fs.existsSync(path.join(LANDING_SRC, "index.html")) ? LANDING_SRC : null;
  if (!src) {
    restoreLandingIndex(destPublic);
    return isMarketingDir(destPublic);
  }
  if (path.resolve(src) === path.resolve(destPublic)) {
    restoreLandingIndex(destPublic);
    return true;
  }
  fs.mkdirSync(destPublic, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (PRESERVE_IN_PUBLIC.has(entry.name) || SKIP_LANDING_NAMES.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(destPublic, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(from, to, { recursive: true });
    } else {
      fs.copyFileSync(from, to);
    }
  }
  const landingNames = new Set(fs.readdirSync(src));
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

function hasHostedApp(destPublic = path.join(BACKEND_ROOT, "public")) {
  return fs.existsSync(path.join(destPublic, "app", "index.html"));
}

function copySite(destPublic, { angularSrc = ANGULAR_SRC, requireAngular = true } = {}) {
  fs.mkdirSync(destPublic, { recursive: true });
  const copiedLanding = copyLanding(destPublic);
  const built = hasAngularBuild(angularSrc);
  if (built) {
    copyAngular(destPublic, angularSrc);
  } else if (requireAngular && !hasHostedApp(destPublic)) {
    throw new Error("Frontend build not found at " + angularSrc);
  }
  const hasApp = hasHostedApp(destPublic);
  console.log(
    (copiedLanding ? "Copied landing" : "No marketing landing source found") +
      (hasApp ? " + /app" : "") +
      " to " +
      destPublic,
  );
  return hasApp;
}

module.exports = {
  copySite,
  hasAngularBuild,
  hasHostedApp,
  ANGULAR_SRC,
  LANDING_SRC,
  REPO_ROOT,
  BACKEND_ROOT,
};
