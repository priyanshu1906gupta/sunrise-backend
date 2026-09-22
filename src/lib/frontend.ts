import fs from "fs";
import path from "path";

const INDEX = "index.html";

function parents(start: string, max = 6): string[] {
  const dirs: string[] = [];
  let current = path.resolve(start);
  for (let i = 0; i < max; i++) {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

function extraFolders(root: string): string[] {
  return [
    root,
    path.join(root, "public"),
    path.join(root, "dist", "public"),
    path.join(root, "browser"),
    path.join(root, "dist", "coreui-free-angular-admin-template", "browser"),
    path.join(root, "sunrise-frontend", "dist", "coreui-free-angular-admin-template", "browser"),
  ];
}

export function frontendSearchPaths(): string[] {
  const fromEnv = process.env.FRONTEND_DIST?.trim();
  const roots = [...parents(process.cwd()), ...parents(__dirname)];
  const paths = [
    fromEnv,
    path.join(__dirname, "../../public"),
    path.join(__dirname, "../public"),
    path.join(process.cwd(), "public"),
  ].filter((dir): dir is string => Boolean(dir));
  for (const root of roots) {
    paths.push(...extraFolders(root));
  }
  return [...new Set(paths)];
}

function isSiteRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, INDEX));
}

function isLandingRoot(dir: string): boolean {
  if (!isSiteRoot(dir)) return false;
  return (
    fs.existsSync(path.join(dir, "features.html")) ||
    fs.existsSync(path.join(dir, "robots.txt")) ||
    fs.existsSync(path.join(dir, "about.html")) ||
    fs.existsSync(path.join(dir, "download.html")) ||
    fs.existsSync(path.join(dir, "contact.html"))
  );
}

function isHostedSite(dir: string): boolean {
  return fs.existsSync(path.join(dir, "app", INDEX));
}

export function resolveFrontendDist(): string | null {
  const candidates: string[] = [];
  for (const dir of frontendSearchPaths()) {
    try {
      if (dir && isSiteRoot(dir)) candidates.push(dir);
    } catch {
      /* ignore */
    }
  }
  return (
    candidates.find((dir) => isLandingRoot(dir) && isHostedSite(dir)) ||
    candidates.find(isLandingRoot) ||
    candidates.find(isHostedSite) ||
    candidates[0] ||
    null
  );
}
