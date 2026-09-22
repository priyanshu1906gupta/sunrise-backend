import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import routes from "./routes";
import { errorHandler } from "./middleware/errorHandler";
import { corsOptions } from "./lib/cors";
import { ensureUploadRoot, runWithPublicUrl, UPLOAD_PUBLIC_PATH, UPLOAD_ROOT } from "./lib/files";
import { resolveFrontendDist, frontendSearchPaths } from "./lib/frontend";

const app = express();
const frontendDist = resolveFrontendDist();

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(cors(corsOptions()));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => {
  const host = req.get("host");
  const publicUrl = host ? `${req.protocol}://${host}` : undefined;
  if (!publicUrl) {
    next();
    return;
  }
  runWithPublicUrl(publicUrl, next);
});

ensureUploadRoot();
app.use(
  UPLOAD_PUBLIC_PATH,
  express.static(UPLOAD_ROOT, {
    setHeaders(res) {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  }),
);

app.use("/api", routes);

if (frontendDist) {
  console.log(`Serving site from ${frontendDist}`);
  const spaIndex = path.join(frontendDist, "app", "index.html");
  const landing404 = path.join(frontendDist, "404.html");
  const landingIndex = path.join(frontendDist, "index.html");
  const bundledLandingDir = path.join(__dirname, "../landing");
  const bundledLanding = path.join(bundledLandingDir, "index.html");
  const hasSpa = fs.existsSync(spaIndex);
  const hasMarketingLanding =
    fs.existsSync(path.join(frontendDist, "features.html")) ||
    fs.existsSync(path.join(frontendDist, "robots.txt")) ||
    fs.existsSync(path.join(frontendDist, "about.html")) ||
    fs.existsSync(path.join(frontendDist, "download.html")) ||
    fs.existsSync(path.join(frontendDist, "contact.html"));
  const indexLooksLikeRedirect = (file: string) => {
    try {
      const html = fs.readFileSync(file, "utf8");
      return html.includes('location.replace("/app/")') || html.includes('content="0;url=/app/"');
    } catch {
      return true;
    }
  };
  if (fs.existsSync(landingIndex) && fs.existsSync(bundledLanding) && indexLooksLikeRedirect(landingIndex)) {
    try {
      fs.copyFileSync(bundledLanding, landingIndex);
      console.log("Restored marketing index.html over /app/ redirect stub");
    } catch {
      /* ignore */
    }
  }
  app.use(express.static(frontendDist, { index: false }));
  if (fs.existsSync(bundledLandingDir)) {
    app.use(express.static(bundledLandingDir, { index: false }));
  }
  const realLandingIndex = () => {
    if (fs.existsSync(landingIndex) && !indexLooksLikeRedirect(landingIndex)) return landingIndex;
    if (fs.existsSync(bundledLanding) && !indexLooksLikeRedirect(bundledLanding)) return bundledLanding;
    return null;
  };
  const sendHome = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const home = realLandingIndex();
    if (home) {
      res.sendFile(home, (err) => {
        if (err) next(err);
      });
      return;
    }
    if (hasSpa && !hasMarketingLanding) {
      res.redirect(302, "/app/");
      return;
    }
    next();
  };
  app.get("/", sendHome);
  app.get("/index.html", sendHome);
  app.get(/^\/app(?:\/.*)?$/, (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (!fs.existsSync(spaIndex)) {
      next();
      return;
    }
    res.sendFile(spaIndex, (err) => {
      if (err) next(err);
    });
  });
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    if (fs.existsSync(landing404)) {
      res.status(404).sendFile(landing404, (err) => {
        if (err) next(err);
      });
      return;
    }
    next();
  });
} else {
  console.error("Frontend build not found. Searched:", frontendSearchPaths());
  app.get("/", (_req, res) => {
    res.json({
      success: true,
      message: "Sunrise Coaching Khargone API (frontend build not found)",
      version: "1.0.0",
      endpoints: {
        health: "/api/health",
        testserver: "/api/testserver",
        auth: "/api/auth",
      },
    });
  });
}

app.use(errorHandler);

export default app;
