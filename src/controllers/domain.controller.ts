import { Request, Response, NextFunction } from "express";
import { sendCreated, sendSuccess } from "../utils/response";
import { requireUser } from "../middleware/auth";
import { fileService } from "../services/file.service";
import { companyService, branchService } from "../services/company.service";
import { studentService } from "../services/student.service";
import { employeeService } from "../services/employee.service";
import { expenseService } from "../services/expense.service";
import { academicService } from "../services/academic.service";
import { leaveService } from "../services/leave.service";
import { pushService } from "../services/push.service";
import {
  dashboardService,
  calendarService,
  notificationService,
  contentService,
} from "../services/dashboard.service";
import {
  updateCompanySchema,
  createBranchSchema,
  updateBranchSchema,
  idParamSchema,
  studentSchema,
  addPaymentSchema,
  employeeSchema,
  expenseSchema,
  helpQuerySchema,
  studentImportSchema,
  hrmAttendanceSchema,
  hrmSettingsSchema,
  courseSchema,
  batchSchema,
  subjectSchema,
  leaveSchema,
  pushTokenSchema,
  createTestSchema,
  testHeartbeatSchema,
  testSubmitSchema,
  startLiveSchema,
  createStudyMaterialSchema,
  loginStatusSchema,
} from "../validators/domain.validator";
import { AppError } from "../middleware/errorHandler";
import { hrmService } from "../services/hrm.service";
import { testService } from "../services/test.service";
import { liveService } from "../services/live.service";
import { studyMaterialService } from "../services/study-material.service";

export class FileController {
  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) throw new AppError(400, "Photo is required");
      const host = req.get("host");
      const publicBase = host ? `${req.protocol}://${host}` : undefined;
      sendCreated(res, await fileService.upload(requireUser(req), req.file, publicBase), "Photo uploaded");
    } catch (error) {
      next(error);
    }
  }

  async uploadPdf(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) throw new AppError(400, "PDF file is required");
      sendCreated(res, await fileService.uploadPdf(requireUser(req), req.file), "PDF uploaded");
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await fileService.remove(requireUser(req), id), "Photo deleted");
    } catch (error) {
      next(error);
    }
  }
}

export class CompanyController {
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await companyService.getProfile(requireUser(req)), "Company fetched");
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateCompanySchema.parse(req.body);
      sendSuccess(res, await companyService.updateProfile(requireUser(req), data), "Company updated");
    } catch (error) {
      next(error);
    }
  }
}

export class BranchController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await branchService.list(requireUser(req)), "Branches fetched");
    } catch (error) {
      next(error);
    }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await branchService.get(requireUser(req), id), "Branch fetched");
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createBranchSchema.parse(req.body);
      sendCreated(res, await branchService.create(requireUser(req), data), "Branch created");
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const data = updateBranchSchema.parse(req.body);
      sendSuccess(res, await branchService.update(requireUser(req), id, data), "Branch updated");
    } catch (error) {
      next(error);
    }
  }
}

export class StudentController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await studentService.list(requireUser(req), req.query as never), "Students fetched");
    } catch (error) {
      next(error);
    }
  }

  async due(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await studentService.dueList(requireUser(req), req.query as never), "Due payments fetched");
    } catch (error) {
      next(error);
    }
  }

  async mine(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await studentService.mine(requireUser(req)), "Student fetched");
    } catch (error) {
      next(error);
    }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await studentService.get(requireUser(req), id), "Student fetched");
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = studentSchema.parse(req.body);
      sendCreated(res, await studentService.create(requireUser(req), data), "Student created");
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const data = studentSchema.partial().omit({ paidAmount: true }).parse(req.body);
      sendSuccess(res, await studentService.update(requireUser(req), id, data), "Student updated");
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await studentService.remove(requireUser(req), id), "Student deleted");
    } catch (error) {
      next(error);
    }
  }

  async addPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { paidAmount, paymentDate, paymentMode } = addPaymentSchema.parse(req.body);
      sendCreated(
        res,
        await studentService.addPayment(requireUser(req), id, paidAmount, paymentDate, paymentMode),
        "Payment recorded",
      );
    } catch (error) {
      next(error);
    }
  }

  async restore(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await studentService.restore(requireUser(req), id), "Student restored");
    } catch (error) {
      next(error);
    }
  }

  async setLoginStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { status } = loginStatusSchema.parse(req.body);
      sendSuccess(res, await studentService.setLoginStatus(requireUser(req), id, status), "Login status updated");
    } catch (error) {
      next(error);
    }
  }

  async exportExcel(req: Request, res: Response, next: NextFunction) {
    try {
      const branchId = typeof req.query.branchId === "string" ? req.query.branchId : undefined;
      const buffer = await studentService.exportExcel(requireUser(req), branchId);
      const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      res.status(200);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="students.xlsx"');
      res.setHeader("Content-Length", String(bytes.length));
      res.end(bytes);
    } catch (error) {
      next(error);
    }
  }

  async importRows(req: Request, res: Response, next: NextFunction) {
    try {
      const data = studentImportSchema.parse(req.body);
      sendSuccess(res, await studentService.importRows(requireUser(req), data), "Students imported");
    } catch (error) {
      next(error);
    }
  }
}

export class EmployeeController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await employeeService.list(requireUser(req), req.query as never), "Employees fetched");
    } catch (error) {
      next(error);
    }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await employeeService.get(requireUser(req), id), "Employee fetched");
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = employeeSchema.parse(req.body);
      sendCreated(res, await employeeService.create(requireUser(req), data), "Employee created");
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const data = employeeSchema.partial().parse(req.body);
      sendSuccess(res, await employeeService.update(requireUser(req), id, data), "Employee updated");
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await employeeService.remove(requireUser(req), id), "Employee deleted");
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await employeeService.resetManagerPassword(requireUser(req), id), "Password reset");
    } catch (error) {
      next(error);
    }
  }

  async setLoginStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { status } = loginStatusSchema.parse(req.body);
      sendSuccess(res, await employeeService.setLoginStatus(requireUser(req), id, status), "Login status updated");
    } catch (error) {
      next(error);
    }
  }
}

export class AcademicController {
  async catalogs(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await academicService.catalogs(requireUser(req)), "Catalogs fetched");
    } catch (error) {
      next(error);
    }
  }

  async createSubject(req: Request, res: Response, next: NextFunction) {
    try {
      const { name } = subjectSchema.parse(req.body);
      sendCreated(res, await academicService.createSubject(requireUser(req), name), "Subject created");
    } catch (error) {
      next(error);
    }
  }

  async updateSubject(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { name } = subjectSchema.parse(req.body);
      sendSuccess(res, await academicService.updateSubject(requireUser(req), id, name), "Subject updated");
    } catch (error) {
      next(error);
    }
  }

  async removeSubject(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await academicService.removeSubject(requireUser(req), id), "Subject deleted");
    } catch (error) {
      next(error);
    }
  }

  async listCourses(req: Request, res: Response, next: NextFunction) {
    try {
      const branchId = typeof req.query.branchId === "string" ? req.query.branchId : undefined;
      sendSuccess(res, await academicService.listCourses(requireUser(req), branchId), "Courses fetched");
    } catch (error) {
      next(error);
    }
  }

  async createCourse(req: Request, res: Response, next: NextFunction) {
    try {
      const data = courseSchema.parse(req.body);
      sendCreated(res, await academicService.createCourse(requireUser(req), data), "Course created");
    } catch (error) {
      next(error);
    }
  }

  async updateCourse(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const data = courseSchema.partial().parse(req.body);
      sendSuccess(res, await academicService.updateCourse(requireUser(req), id, data), "Course updated");
    } catch (error) {
      next(error);
    }
  }

  async removeCourse(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await academicService.removeCourse(requireUser(req), id), "Course deleted");
    } catch (error) {
      next(error);
    }
  }

  async listBatches(req: Request, res: Response, next: NextFunction) {
    try {
      const branchId = typeof req.query.branchId === "string" ? req.query.branchId : undefined;
      sendSuccess(res, await academicService.listBatches(requireUser(req), branchId), "Batches fetched");
    } catch (error) {
      next(error);
    }
  }

  async createBatch(req: Request, res: Response, next: NextFunction) {
    try {
      const data = batchSchema.parse(req.body);
      sendCreated(res, await academicService.createBatch(requireUser(req), data), "Batch created");
    } catch (error) {
      next(error);
    }
  }

  async updateBatch(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const data = batchSchema.partial().parse(req.body);
      sendSuccess(res, await academicService.updateBatch(requireUser(req), id, data), "Batch updated");
    } catch (error) {
      next(error);
    }
  }

  async removeBatch(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await academicService.removeBatch(requireUser(req), id), "Batch deleted");
    } catch (error) {
      next(error);
    }
  }
}

export class LeaveController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await leaveService.list(requireUser(req)), "Leave requests fetched");
    } catch (error) {
      next(error);
    }
  }

  async apply(req: Request, res: Response, next: NextFunction) {
    try {
      const data = leaveSchema.parse(req.body);
      sendCreated(res, await leaveService.apply(requireUser(req), data), "Leave applied");
    } catch (error) {
      next(error);
    }
  }
}

export class PushController {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const { token, platform } = pushTokenSchema.parse(req.body);
      sendSuccess(res, await pushService.register(requireUser(req), token, platform), "Device registered");
    } catch (error) {
      next(error);
    }
  }

  async unregister(req: Request, res: Response, next: NextFunction) {
    try {
      const { token } = pushTokenSchema.pick({ token: true }).parse(req.body);
      sendSuccess(res, await pushService.unregister(requireUser(req), token), "Device removed");
    } catch (error) {
      next(error);
    }
  }
}

export class ExpenseController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await expenseService.list(requireUser(req), req.query as never), "Expenses fetched");
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = expenseSchema.parse(req.body);
      sendCreated(res, await expenseService.create(requireUser(req), data), "Expense added");
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const data = expenseSchema.partial().parse(req.body);
      sendSuccess(res, await expenseService.update(requireUser(req), id, data), "Expense updated");
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await expenseService.remove(requireUser(req), id), "Expense deleted");
    } catch (error) {
      next(error);
    }
  }
}

export class DashboardController {
  async stats(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(
        res,
        await dashboardService.stats(requireUser(req), req.query as never),
        "Dashboard fetched",
      );
    } catch (error) {
      next(error);
    }
  }

  async calendar(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(
        res,
        await calendarService.events(requireUser(req), req.query as never),
        "Calendar fetched",
      );
    } catch (error) {
      next(error);
    }
  }

  async notifications(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await notificationService.list(requireUser(req), req.query), "Notifications fetched");
    } catch (error) {
      next(error);
    }
  }

  async readNotification(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await notificationService.markRead(requireUser(req), id), "Notification read");
    } catch (error) {
      next(error);
    }
  }

  async clearNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await notificationService.clearAll(requireUser(req)), "Notifications cleared");
    } catch (error) {
      next(error);
    }
  }

  async terms(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await contentService.terms(requireUser(req)), "Terms fetched");
    } catch (error) {
      next(error);
    }
  }

  async help(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await contentService.help(), "Help fetched");
    } catch (error) {
      next(error);
    }
  }

  async sendHelpQuery(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, description } = helpQuerySchema.parse(req.body);
      sendSuccess(res, await contentService.sendQuery(requireUser(req), title, description), "Query sent");
    } catch (error) {
      next(error);
    }
  }
}

export class HrmController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await hrmService.list(requireUser(req), req.query as never), "Attendance fetched");
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = hrmAttendanceSchema.parse(req.body);
      sendSuccess(res, await hrmService.updateAttendance(requireUser(req), data), "Attendance updated");
    } catch (error) {
      next(error);
    }
  }

  async settings(req: Request, res: Response, next: NextFunction) {
    try {
      const data = hrmSettingsSchema.parse(req.body);
      sendSuccess(res, await hrmService.setSundayWeekend(requireUser(req), data.sundayWeekend), "HRM settings saved");
    } catch (error) {
      next(error);
    }
  }
}

export class TestController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const branchId = typeof req.query.branchId === "string" ? req.query.branchId : undefined;
      const courseId = typeof req.query.courseId === "string" ? req.query.courseId : undefined;
      sendSuccess(res, await testService.list(requireUser(req), { branchId, courseId }), "Tests fetched");
    } catch (error) {
      next(error);
    }
  }

  async available(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await testService.available(requireUser(req)), "Tests fetched");
    } catch (error) {
      next(error);
    }
  }

  async sample(req: Request, res: Response, next: NextFunction) {
    try {
      const buffer = await testService.sampleExcel();
      const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      res.status(200);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="test-questions-sample.xlsx"');
      res.setHeader("Content-Length", String(bytes.length));
      res.end(bytes);
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createTestSchema.parse(req.body);
      sendCreated(res, await testService.create(requireUser(req), data), "Test created");
    } catch (error) {
      next(error);
    }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await testService.get(requireUser(req), id), "Test fetched");
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await testService.remove(requireUser(req), id), "Test deleted");
    } catch (error) {
      next(error);
    }
  }

  async start(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await testService.start(requireUser(req), id), "Test started");
    } catch (error) {
      next(error);
    }
  }

  async heartbeat(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const data = testHeartbeatSchema.parse(req.body);
      sendSuccess(
        res,
        await testService.heartbeat(requireUser(req), id, {
          remainingSeconds: data.remainingSeconds,
          warningCount: data.warningCount,
          answers: data.answers?.map((a) => ({
            questionId: a.questionId,
            selectedIndex: a.selectedIndex ?? null,
            markedForReview: a.markedForReview,
            secondsSpent: a.secondsSpent,
          })),
        }),
        "Saved",
      );
    } catch (error) {
      next(error);
    }
  }

  async submit(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const data = testSubmitSchema.parse(req.body);
      sendSuccess(
        res,
        await testService.submit(requireUser(req), id, {
          auto: data.auto,
          answers: data.answers?.map((a) => ({
            questionId: a.questionId,
            selectedIndex: a.selectedIndex ?? null,
            markedForReview: a.markedForReview,
            secondsSpent: a.secondsSpent,
          })),
        }),
        "Test submitted",
      );
    } catch (error) {
      next(error);
    }
  }

  async result(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await testService.result(requireUser(req), id), "Result fetched");
    } catch (error) {
      next(error);
    }
  }

  async review(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await testService.review(requireUser(req), id), "Review fetched");
    } catch (error) {
      next(error);
    }
  }
}

export class LiveController {
  async catalog(req: Request, res: Response, next: NextFunction) {
    try {
      const branchId = typeof req.query.branchId === "string" ? req.query.branchId : undefined;
      sendSuccess(res, await liveService.catalog(requireUser(req), branchId), "Live catalog fetched");
    } catch (error) {
      next(error);
    }
  }

  async start(req: Request, res: Response, next: NextFunction) {
    try {
      const data = startLiveSchema.parse(req.body);
      sendCreated(res, await liveService.start(requireUser(req), data), "Live class started");
    } catch (error) {
      next(error);
    }
  }

  async end(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await liveService.end(requireUser(req), id), "Live class ended");
    } catch (error) {
      next(error);
    }
  }

  async join(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await liveService.join(requireUser(req), id), "Live class fetched");
    } catch (error) {
      next(error);
    }
  }
}

export class StudyMaterialController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const branchId = typeof req.query.branchId === "string" ? req.query.branchId : undefined;
      const courseId = typeof req.query.courseId === "string" ? req.query.courseId : undefined;
      const subjectId = typeof req.query.subjectId === "string" ? req.query.subjectId : undefined;
      sendSuccess(res, await studyMaterialService.list(requireUser(req), { branchId, courseId, subjectId }), "Study materials fetched");
    } catch (error) {
      next(error);
    }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await studyMaterialService.get(requireUser(req), id), "Study material fetched");
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createStudyMaterialSchema.parse(req.body);
      sendCreated(res, await studyMaterialService.create(requireUser(req), data), "Study material saved");
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await studyMaterialService.remove(requireUser(req), id), "Study material deleted");
    } catch (error) {
      next(error);
    }
  }

  async file(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { abs, name } = await studyMaterialService.filePath(requireUser(req), id);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${name.replace(/"/g, "")}"`);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.sendFile(abs);
    } catch (error) {
      next(error);
    }
  }
}
