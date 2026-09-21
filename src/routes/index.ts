import { Router } from "express";
import multer from "multer";
import { AuthController } from "../controllers/auth.controller";
import {
  FileController,
  CompanyController,
  BranchController,
  StudentController,
  EmployeeController,
  ExpenseController,
  DashboardController,
  HrmController,
  AcademicController,
  LeaveController,
  PushController,
  TestController,
  LiveController,
} from "../controllers/domain.controller";
import { authenticate, authorize, authorizeWrite } from "../middleware/auth";
import { healthCheck } from "../utils/response";
import { prisma } from "../lib/prisma";
import { prismaFailureMessage } from "../lib/prisma-errors";
import { SubscriptionController } from "../controllers/subscription.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = Router();
const auth = new AuthController();
const files = new FileController();
const company = new CompanyController();
const branches = new BranchController();
const students = new StudentController();
const employees = new EmployeeController();
const expenses = new ExpenseController();
const dashboard = new DashboardController();
const hrm = new HrmController();
const academic = new AcademicController();
const leaves = new LeaveController();
const push = new PushController();
const subscriptions = new SubscriptionController();
const tests = new TestController();
const live = new LiveController();

router.get("/health", healthCheck);
router.get("/health/db", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, message: "Database connection is healthy", data: { database: "connected" } });
  } catch (error) {
    const message = prismaFailureMessage(error) || "Cannot connect to the database";
    res.status(503).json({ success: false, message, code: "DB_UNAVAILABLE" });
  }
});
router.get("/testserver", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const rows = await prisma.$queryRaw<{ db: string | null }[]>`SELECT DATABASE() AS db`;
    res.json({
      success: true,
      message: "Server and database are working",
      data: {
        server: "ok",
        database: "connected",
        databaseName: rows[0]?.db ?? null,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const message = prismaFailureMessage(error) || "Cannot connect to the database";
    res.status(503).json({ success: false, message, code: "DB_UNAVAILABLE" });
  }
});

router.get("/auth/config", (req, res, next) => auth.config(req, res, next));
router.post("/auth/register", (req, res, next) => auth.register(req, res, next));
router.post("/auth/login", (req, res, next) => auth.login(req, res, next));
router.post("/auth/forgot-password", (req, res, next) => auth.forgotPassword(req, res, next));
router.post("/auth/verify-otp", (req, res, next) => auth.verifyOtp(req, res, next));
router.post("/auth/reset-password", (req, res, next) => auth.resetPassword(req, res, next));
router.post("/auth/refresh", (req, res, next) => auth.refresh(req, res, next));
router.post("/auth/logout", (req, res, next) => auth.logout(req, res, next));
router.get("/auth/me", authenticate, (req, res, next) => auth.me(req, res, next));
router.put("/auth/change-password", authenticate, (req, res, next) => auth.changePassword(req, res, next));

router.post("/files", authenticate, upload.single("file"), (req, res, next) => files.upload(req, res, next));
router.delete("/files/:id", authenticate, (req, res, next) => files.remove(req, res, next));

router.get("/company", authenticate, (req, res, next) => company.get(req, res, next));
router.put("/company", authenticate, authorize("ADMIN"), (req, res, next) => company.update(req, res, next));

router.get("/branches", authenticate, (req, res, next) => branches.list(req, res, next));
router.post("/branches", authenticate, authorize("ADMIN"), (req, res, next) => branches.create(req, res, next));
router.get("/branches/:id", authenticate, (req, res, next) => branches.get(req, res, next));
router.put("/branches/:id", authenticate, authorize("ADMIN"), (req, res, next) => branches.update(req, res, next));

router.get("/students", authenticate, (req, res, next) => students.list(req, res, next));
router.get("/students/due", authenticate, (req, res, next) => students.due(req, res, next));
router.get("/students/me", authenticate, authorize("STUDENT"), (req, res, next) => students.mine(req, res, next));
router.get("/students/export", authenticate, authorize("ADMIN"), (req, res, next) => students.exportExcel(req, res, next));
router.post("/students/import", authenticate, authorizeWrite, (req, res, next) => students.importRows(req, res, next));
router.post("/students", authenticate, authorizeWrite, (req, res, next) => students.create(req, res, next));
router.get("/students/:id", authenticate, (req, res, next) => students.get(req, res, next));
router.put("/students/:id", authenticate, authorizeWrite, (req, res, next) => students.update(req, res, next));
router.delete("/students/:id", authenticate, authorizeWrite, (req, res, next) => students.remove(req, res, next));
router.post("/students/:id/payments", authenticate, authorizeWrite, (req, res, next) => students.addPayment(req, res, next));
router.post("/students/:id/restore", authenticate, authorizeWrite, (req, res, next) => students.restore(req, res, next));

router.get("/employees", authenticate, (req, res, next) => employees.list(req, res, next));
router.post("/employees", authenticate, authorizeWrite, (req, res, next) => employees.create(req, res, next));
router.get("/employees/:id", authenticate, (req, res, next) => employees.get(req, res, next));
router.put("/employees/:id", authenticate, authorizeWrite, (req, res, next) => employees.update(req, res, next));
router.delete("/employees/:id", authenticate, authorizeWrite, (req, res, next) => employees.remove(req, res, next));
router.post("/employees/:id/reset-password", authenticate, authorize("ADMIN"), (req, res, next) =>
  employees.resetPassword(req, res, next),
);

router.get("/catalogs", authenticate, (req, res, next) => academic.catalogs(req, res, next));
router.post("/subjects", authenticate, authorizeWrite, (req, res, next) => academic.createSubject(req, res, next));
router.put("/subjects/:id", authenticate, authorizeWrite, (req, res, next) => academic.updateSubject(req, res, next));
router.delete("/subjects/:id", authenticate, authorizeWrite, (req, res, next) => academic.removeSubject(req, res, next));
router.get("/courses", authenticate, (req, res, next) => academic.listCourses(req, res, next));
router.post("/courses", authenticate, authorizeWrite, (req, res, next) => academic.createCourse(req, res, next));
router.put("/courses/:id", authenticate, authorizeWrite, (req, res, next) => academic.updateCourse(req, res, next));
router.delete("/courses/:id", authenticate, authorizeWrite, (req, res, next) => academic.removeCourse(req, res, next));
router.get("/batches", authenticate, (req, res, next) => academic.listBatches(req, res, next));
router.post("/batches", authenticate, authorizeWrite, (req, res, next) => academic.createBatch(req, res, next));
router.put("/batches/:id", authenticate, authorizeWrite, (req, res, next) => academic.updateBatch(req, res, next));
router.delete("/batches/:id", authenticate, authorizeWrite, (req, res, next) => academic.removeBatch(req, res, next));

router.get("/leaves", authenticate, authorize("TEACHER"), (req, res, next) => leaves.list(req, res, next));
router.post("/leaves", authenticate, authorize("TEACHER"), (req, res, next) => leaves.apply(req, res, next));

router.post("/devices", authenticate, (req, res, next) => push.register(req, res, next));
router.delete("/devices", authenticate, (req, res, next) => push.unregister(req, res, next));

router.get("/expenses", authenticate, (req, res, next) => expenses.list(req, res, next));
router.post("/expenses", authenticate, authorizeWrite, (req, res, next) => expenses.create(req, res, next));
router.put("/expenses/:id", authenticate, authorizeWrite, (req, res, next) => expenses.update(req, res, next));
router.delete("/expenses/:id", authenticate, authorizeWrite, (req, res, next) => expenses.remove(req, res, next));

router.get("/tests/sample.xlsx", authenticate, authorize("ADMIN", "MANAGER", "TEACHER"), (req, res, next) =>
  tests.sample(req, res, next),
);
router.get("/tests/available", authenticate, authorize("STUDENT"), (req, res, next) => tests.available(req, res, next));
router.get("/tests", authenticate, authorize("ADMIN", "MANAGER", "TEACHER"), (req, res, next) =>
  tests.list(req, res, next),
);
router.post("/tests", authenticate, authorize("ADMIN", "MANAGER", "TEACHER"), (req, res, next) =>
  tests.create(req, res, next),
);
router.get("/tests/:id/result", authenticate, authorize("STUDENT"), (req, res, next) => tests.result(req, res, next));
router.get("/tests/:id/review", authenticate, authorize("STUDENT"), (req, res, next) => tests.review(req, res, next));
router.post("/tests/:id/start", authenticate, authorize("STUDENT"), (req, res, next) => tests.start(req, res, next));
router.put("/tests/:id/heartbeat", authenticate, authorize("STUDENT"), (req, res, next) => tests.heartbeat(req, res, next));
router.post("/tests/:id/submit", authenticate, authorize("STUDENT"), (req, res, next) => tests.submit(req, res, next));
router.get("/tests/:id", authenticate, authorize("ADMIN", "MANAGER", "TEACHER"), (req, res, next) =>
  tests.get(req, res, next),
);
router.delete("/tests/:id", authenticate, authorize("ADMIN", "MANAGER", "TEACHER"), (req, res, next) =>
  tests.remove(req, res, next),
);

router.get("/live/catalog", authenticate, (req, res, next) => live.catalog(req, res, next));
router.post("/live/start", authenticate, authorize("ADMIN", "MANAGER", "TEACHER"), (req, res, next) =>
  live.start(req, res, next),
);
router.post("/live/:id/end", authenticate, authorize("ADMIN", "MANAGER", "TEACHER"), (req, res, next) =>
  live.end(req, res, next),
);
router.get("/live/:id", authenticate, (req, res, next) => live.join(req, res, next));

router.get("/dashboard", authenticate, (req, res, next) => dashboard.stats(req, res, next));
router.get("/calendar", authenticate, (req, res, next) => dashboard.calendar(req, res, next));
router.get("/notifications", authenticate, (req, res, next) => dashboard.notifications(req, res, next));
router.put("/notifications/:id/read", authenticate, (req, res, next) => dashboard.readNotification(req, res, next));
router.get("/content/terms", authenticate, (req, res, next) => dashboard.terms(req, res, next));
router.get("/content/help", authenticate, (req, res, next) => dashboard.help(req, res, next));
router.post("/content/help/query", authenticate, (req, res, next) => dashboard.sendHelpQuery(req, res, next));

router.get("/hrm", authenticate, (req, res, next) => hrm.list(req, res, next));
router.put("/hrm/attendance", authenticate, authorizeWrite, (req, res, next) => hrm.update(req, res, next));
router.put("/hrm/settings", authenticate, authorizeWrite, (req, res, next) => hrm.settings(req, res, next));

router.get("/subscription", authenticate, authorize("ADMIN"), (req, res, next) => subscriptions.mine(req, res, next));
router.get("/super/subscriptions", (req, res, next) => subscriptions.list(req, res, next));
router.put("/super/subscriptions/:id/extend", (req, res, next) => subscriptions.extend(req, res, next));
router.put("/super/subscriptions/:id/status", (req, res, next) => subscriptions.setStatus(req, res, next));
router.post("/super/subscriptions/:id/reset-password", (req, res, next) =>
  subscriptions.resetPassword(req, res, next),
);

export default router;
