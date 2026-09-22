import { prisma } from "../lib/prisma";
import { TokenPayload } from "../lib/jwt";
import { managerBranchId } from "../middleware/auth";
import { toNumber, daysUntil, startOfDay } from "../lib/files";
import { subscriptionDue } from "../lib/student-billing";
import { AppError } from "../middleware/errorHandler";
import { parsePagination, paginated } from "../lib/pagination";
import { copyExpensesIntoMonth } from "./expense.service";
import { env } from "../config/env";
import { sendMail, helpQueryEmailTemplate } from "../lib/mailer";
import { ALIVE } from "../lib/soft-delete";
import { pushService } from "./push.service";

function branchFilter(user: TokenPayload, branchId?: string) {
  const scoped = managerBranchId(user, branchId);
  return {
    companyId: user.companyId,
    ...(scoped ? { id: scoped } : {}),
  };
}

export class DashboardService {
  async stats(user: TokenPayload, query: { branchId?: string; month?: string; year?: string }) {
    if (user.role === "STUDENT") return this.studentStats(user);
    if (user.role === "TEACHER") return this.teacherStats(user, query);
    return this.staffStats(user, query);
  }

  private async studentStats(user: TokenPayload) {
    const student = await prisma.student.findFirst({
      where: { userId: user.id, ...ALIVE },
      include: {
        courses: { include: { course: { include: { subjects: { include: { subject: true } } } } } },
        batches: { include: { batch: true } },
      },
    });
    if (!student) throw new AppError(404, "Student profile not found");
    const courseIds = student.courses.map((c) => c.courseId);
    const subjects = [
      ...new Map(
        student.courses.flatMap((c) => c.course.subjects.map((s) => [s.subject.id, s.subject] as const)),
      ).values(),
    ];
    const [testsAvailable, testsGiven, latest, liveNow] = await Promise.all([
      courseIds.length
        ? prisma.test.count({ where: { courseId: { in: courseIds }, ...ALIVE } })
        : 0,
      prisma.testAttempt.count({
        where: { studentId: student.id, status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] } },
      }),
      prisma.testAttempt.findFirst({
        where: { studentId: student.id, status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] } },
        orderBy: { submittedAt: "desc" },
        include: { test: { select: { name: true, totalMarks: true } } },
      }),
      courseIds.length
        ? prisma.liveSession.count({ where: { courseId: { in: courseIds }, status: "LIVE" } })
        : 0,
    ]);
    return {
      role: "STUDENT" as const,
      courses: student.courses.map((c) => ({ id: c.course.id, name: c.course.name })),
      batches: student.batches
        .filter((b) => !b.batch.deletedAt)
        .map((b) => ({ id: b.batch.id, name: b.batch.name, courseId: b.batch.courseId })),
      subjects: subjects.map((s) => ({ id: s.id, name: s.name })),
      testsAvailable,
      testsGiven,
      liveNow,
      latestResult: latest
        ? {
            testName: latest.test.name,
            marks: toNumber(latest.marksObtained),
            total: latest.test.totalMarks,
          }
        : null,
    };
  }

  private async teacherStats(user: TokenPayload, query: { branchId?: string; month?: string; year?: string }) {
    const branches = await prisma.branch.findMany({ where: branchFilter(user, query.branchId) });
    const ids = branches.map((b) => b.id);
    if (!ids.length) throw new AppError(404, "No branch found");
    const now = new Date();
    const year = Number(query.year) || now.getFullYear();
    const month = query.month ? Number(query.month) - 1 : now.getMonth();
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 1);
    const employee = await prisma.employee.findFirst({
      where: { userId: user.id, deletedAt: null },
      include: { subject: { select: { id: true, name: true } } },
    });
    const [
      courseCount,
      batchCount,
      studentCount,
      testsAdded,
      liveNow,
      liveThisMonth,
      leaveCount,
    ] = await Promise.all([
      prisma.course.count({ where: { branchId: { in: ids }, ...ALIVE } }),
      prisma.batch.count({ where: { branchId: { in: ids }, ...ALIVE } }),
      prisma.student.count({ where: { branchId: { in: ids }, status: "ACTIVE", ...ALIVE } }),
      prisma.test.count({ where: { branchId: { in: ids }, createdById: user.id, ...ALIVE } }),
      prisma.liveSession.count({ where: { branchId: { in: ids }, status: "LIVE" } }),
      prisma.liveSession.count({ where: { branchId: { in: ids }, startedAt: { gte: start, lt: end } } }),
      employee ? prisma.leaveRequest.count({ where: { employeeId: employee.id } }) : 0,
    ]);
    const subjectCount = await prisma.courseSubject.groupBy({
      by: ["subjectId"],
      where: { course: { branchId: { in: ids }, ...ALIVE } },
    });
    return {
      role: "TEACHER" as const,
      year,
      month: month + 1,
      courseCount,
      subjectCount: subjectCount.length,
      batchCount,
      studentCount,
      testsAdded,
      liveNow,
      liveThisMonth,
      leaveCount,
      salary: employee ? toNumber(employee.salary) : 0,
      salaryDate: employee?.salaryDate ?? null,
      subjectName: employee?.subject?.name ?? null,
    };
  }

  private async staffStats(user: TokenPayload, query: { branchId?: string; month?: string; year?: string }) {
    const branches = await prisma.branch.findMany({ where: branchFilter(user, query.branchId) });
    const ids = branches.map((b) => b.id);
    if (!ids.length) {
      throw new AppError(404, "No branch found");
    }

    const now = new Date();
    const year = Number(query.year) || now.getFullYear();
    const month = query.month ? Number(query.month) - 1 : now.getMonth();
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 1);

    if (year === now.getFullYear() && month === now.getMonth()) {
      await Promise.all(ids.map((id) => copyExpensesIntoMonth(id, year, month + 1)));
    }

    const [activeStudents, staff, payments, expenses, pending] = await Promise.all([
      prisma.student.count({ where: { branchId: { in: ids }, status: "ACTIVE", ...ALIVE } }),
      prisma.employee.count({
        where: { branchId: { in: ids }, role: { in: ["TEACHER", "STAFF", "MANAGER"] }, ...ALIVE },
      }),
      prisma.studentPayment.findMany({
        where: {
          student: { branchId: { in: ids } },
          paymentDate: { gte: start, lt: end },
        },
      }),
      prisma.expense.findMany({
        where: { branchId: { in: ids }, dueDate: { gte: start, lt: end } },
      }),
      prisma.student.count({
        where: { branchId: { in: ids }, status: "ACTIVE", paymentStatus: "UNPAID", ...ALIVE },
      }),
    ]);

    const income = payments.reduce((s, p) => s + toNumber(p.amount), 0);
    const expenseTotal = expenses.reduce((s, e) => s + toNumber(e.amount), 0);

    const studentRow =
      user.role === "STUDENT"
        ? await prisma.student.findFirst({ where: { userId: user.id, ...ALIVE }, select: { id: true } })
        : null;
    const [paidStudents, unpaidStudents, testsAdded, testsGiven] = await Promise.all([
      prisma.student.count({ where: { branchId: { in: ids }, status: "ACTIVE", paymentStatus: "PAID", ...ALIVE } }),
      prisma.student.count({ where: { branchId: { in: ids }, status: "ACTIVE", paymentStatus: "UNPAID", ...ALIVE } }),
      prisma.test.count({ where: { branchId: { in: ids }, ...ALIVE } }),
      studentRow
        ? prisma.testAttempt.count({
            where: { studentId: studentRow.id, status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] } },
          })
        : prisma.testAttempt.count({
            where: { test: { branchId: { in: ids } }, status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] } },
          }),
    ]);

    const branchBreakdown = await Promise.all(
      branches.map(async (b) => {
        const [bPayments, bExpenses, bStudents, bPending] = await Promise.all([
          prisma.studentPayment.findMany({
            where: { student: { branchId: b.id }, paymentDate: { gte: start, lt: end } },
          }),
          prisma.expense.findMany({ where: { branchId: b.id, dueDate: { gte: start, lt: end } } }),
          prisma.student.count({ where: { branchId: b.id, status: "ACTIVE", ...ALIVE } }),
          prisma.student.count({ where: { branchId: b.id, status: "ACTIVE", paymentStatus: "UNPAID", ...ALIVE } }),
        ]);
        return {
          id: b.id,
          name: b.name,
          income: bPayments.reduce((s, p) => s + toNumber(p.amount), 0),
          expenses: bExpenses.reduce((s, x) => s + toNumber(x.amount), 0),
          students: bStudents,
          pending: bPending,
        };
      }),
    );

    const revenueByMonth = [];
    for (let m = 0; m < 12; m++) {
      const s = new Date(year, m, 1);
      const e = new Date(year, m + 1, 1);
      const monthPayments = await prisma.studentPayment.findMany({
        where: { student: { branchId: { in: ids } }, paymentDate: { gte: s, lt: e } },
      });
      const monthExpenses = await prisma.expense.findMany({
        where: { branchId: { in: ids }, dueDate: { gte: s, lt: e } },
      });
      revenueByMonth.push({
        month: m + 1,
        income: monthPayments.reduce((sum, p) => sum + toNumber(p.amount), 0),
        expenses: monthExpenses.reduce((sum, x) => sum + toNumber(x.amount), 0),
      });
    }

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const joined = await prisma.student.findMany({
      where: { branchId: { in: ids }, joiningDate: { gte: yearStart, lt: yearEnd } },
      select: { joiningDate: true },
    });
    const joinCounts = Array.from({ length: 12 }, () => 0);
    for (const row of joined) {
      joinCounts[row.joiningDate.getMonth()] += 1;
    }
    const studentsJoinedByMonth = joinCounts.map((count, index) => ({ month: index + 1, count }));

    return {
      activeStudents,
      teachersAndStaff: staff,
      incomeThisMonth: income,
      expensesThisMonth: expenseTotal,
      pendingPayments: pending,
      year,
      month: month + 1,
      revenueByMonth,
      studentsJoinedByMonth,
      branchCount: branches.length,
      paidStudents,
      unpaidStudents,
      testsAdded,
      testsGiven,
      branchBreakdown,
      role: user.role,
    };
  }
}

function parseYmdUtc(value?: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export class CalendarService {
  async events(user: TokenPayload, query: { branchId?: string; from?: string; to?: string }) {
    const branches = await prisma.branch.findMany({ where: branchFilter(user, query.branchId) });
    const ids = branches.map((b) => b.id);
    if (!ids.length) return [];

    const now = new Date();
    const from =
      parseYmdUtc(query.from) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to =
      parseYmdUtc(query.to) ?? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));

    const [students, previousPayments, employees, previousSalaries, expenses] = await Promise.all([
      prisma.student.findMany({
        where: { branchId: { in: ids }, monthEndDate: { gte: from, lt: to }, ...ALIVE },
        include: { branch: { select: { name: true } } },
      }),
      prisma.studentPayment.findMany({
        where: {
          student: { branchId: { in: ids }, ...ALIVE },
          paymentDate: { gte: from, lt: to },
        },
        include: { student: { include: { branch: { select: { name: true } } } } },
      }),
      prisma.employee.findMany({
        where: { branchId: { in: ids }, salaryDate: { gte: from, lt: to }, ...ALIVE },
        include: { branch: { select: { name: true } } },
      }),
      prisma.employeeSalary.findMany({
        where: {
          employee: { branchId: { in: ids }, ...ALIVE },
          paymentDate: { gte: from, lt: to },
        },
        include: { employee: { include: { branch: { select: { name: true } } } } },
      }),
      prisma.expense.findMany({
        where: { branchId: { in: ids }, dueDate: { gte: from, lt: to } },
        include: { branch: { select: { name: true } } },
      }),
    ]);

    return [
      ...students.map((m) => ({
        id: `student-due-${m.id}`,
        type: "STUDENT_PAYMENT",
        title: m.fullName,
        date: m.monthEndDate,
        entityId: m.id,
        branchId: m.branchId,
        branchName: m.branch.name,
        amount: subscriptionDue({
          paymentAmount: toNumber(m.paymentAmount),
          storedDue: toNumber(m.dueAmount),
          paymentStatus: m.paymentStatus,
        }),
      })),
      ...previousPayments.map((p) => ({
        id: `student-paid-${p.id}`,
        type: "STUDENT_PAYMENT_PREV",
        title: p.student.fullName,
        date: p.paymentDate,
        entityId: p.studentId,
        branchId: p.student.branchId,
        branchName: p.student.branch.name,
        amount: toNumber(p.amount),
      })),
      ...employees.map((e) => ({
        id: `salary-due-${e.id}`,
        type: "EMPLOYEE_SALARY",
        title: e.fullName,
        date: e.salaryDate,
        entityId: e.id,
        branchId: e.branchId,
        branchName: e.branch.name,
        amount: toNumber(e.salary),
      })),
      ...previousSalaries.map((s) => ({
        id: `salary-paid-${s.id}`,
        type: "EMPLOYEE_SALARY_PAID",
        title: s.employee.fullName,
        date: s.paymentDate,
        entityId: s.employeeId,
        branchId: s.employee.branchId,
        branchName: s.employee.branch.name,
        amount: toNumber(s.amount),
      })),
      ...expenses.map((x) => ({
        id: `expense-${x.id}`,
        type: "EXPENSE",
        title: x.name,
        date: x.dueDate,
        entityId: x.id,
        branchId: x.branchId,
        branchName: x.branch.name,
        amount: toNumber(x.amount),
      })),
    ];
  }
}

const UNMARK_TTL_MS = 15 * 60 * 1000;

function unmarkCutoff(): Date {
  return new Date(Date.now() - UNMARK_TTL_MS);
}

export class NotificationService {
  async list(user: TokenPayload, query: { page?: string; pageSize?: string } = {}) {
    await this.sync(user);
    await this.purge(user.id);
    const { page, pageSize, skip, take } = parsePagination(query, 10);
    const cutoff = unmarkCutoff();
    const where = {
      userId: user.id,
      OR: [{ read: false }, { read: true, readAt: { gt: cutoff } }],
    };
    const [items, total, unreadCount] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: [{ read: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: user.id, read: false } }),
    ]);
    return { ...paginated(items, total, page, pageSize), unreadCount, count: unreadCount };
  }

  async markRead(user: TokenPayload, id: string) {
    const n = await prisma.notification.findFirst({ where: { id, userId: user.id } });
    if (!n) throw new AppError(404, "Notification not found");
    if (n.read) return n;
    return prisma.notification.update({
      where: { id },
      data: { read: true, readAt: new Date() },
    });
  }

  /** Drop past-due rows. Keep unmarked rows that are still in the due window so sync does not recreate them as unread. */
  private async purge(userId: string) {
    await prisma.notification.deleteMany({
      where: {
        userId,
        dueDate: { lt: startOfDay(new Date()) },
        type: { notIn: ["LIVE_CLASS", "STUDY_MATERIAL", "TEST"] },
      },
    });
  }

  private async sync(user: TokenPayload) {
    if (user.role !== "ADMIN" && user.role !== "MANAGER") return;
    const branches = await prisma.branch.findMany({ where: branchFilter(user) });
    const ids = branches.map((b) => b.id);
    if (!ids.length) return;

    const students = await prisma.student.findMany({
      where: { branchId: { in: ids }, status: "ACTIVE", ...ALIVE },
    });
    const employees = await prisma.employee.findMany({ where: { branchId: { in: ids }, ...ALIVE } });
    const expenses = await prisma.expense.findMany({ where: { branchId: { in: ids } } });

    for (const m of students) {
      const d = daysUntil(m.monthEndDate);
      if (d >= 0 && d <= 5) {
        await this.createDueNotification(user.id, {
          type: "STUDENT_PAYMENT",
          entityId: m.id,
          dueDate: m.monthEndDate,
          title: "Student payment due",
          message: `${m.fullName} payment is due in ${d} day(s)`,
          branchId: m.branchId,
        });
      }
    }

    for (const e of employees) {
      const d = daysUntil(e.salaryDate);
      if (d >= 0 && d <= 2) {
        await this.createDueNotification(user.id, {
          type: "EMPLOYEE_SALARY",
          entityId: e.id,
          dueDate: e.salaryDate,
          title: "Teacher salary due",
          message: `${e.fullName} salary is due in ${d} day(s)`,
          branchId: e.branchId,
        });
      }
    }

    for (const x of expenses) {
      const d = daysUntil(x.dueDate);
      if (d >= 0 && d <= 5) {
        await this.createDueNotification(user.id, {
          type: "EXPENSE",
          entityId: x.id,
          dueDate: x.dueDate,
          title: "Expense due",
          message: `${x.name} is due in ${d} day(s)`,
          branchId: x.branchId,
        });
      }
    }
  }

  private async createDueNotification(
    userId: string,
    data: {
      type: "STUDENT_PAYMENT" | "EMPLOYEE_SALARY" | "EXPENSE";
      entityId: string;
      dueDate: Date;
      title: string;
      message: string;
      branchId: string;
    },
  ) {
    const existing = await prisma.notification.findUnique({
      where: {
        userId_type_entityId_dueDate: {
          userId,
          type: data.type,
          entityId: data.entityId,
          dueDate: data.dueDate,
        },
      },
    });
    if (existing) return;
    await prisma.notification.create({
      data: {
        userId,
        type: data.type,
        title: data.title,
        message: data.message,
        entityId: data.entityId,
        branchId: data.branchId,
        dueDate: data.dueDate,
      },
    });
    void pushService.notifyUser(userId, data.title, data.message);
  }
}

export class ContentService {
  async terms(user: TokenPayload) {
    const content = await prisma.appContent.findUnique({ where: { key: "TERMS" } });
    const company = await prisma.company.findUnique({ where: { id: user.companyId } });
    const trialEndsAt = company?.subscriptionEndAt ?? new Date();
    return {
      title: content?.title ?? "Terms & Conditions",
      body: content?.body ?? "",
      trialStartsAt: company?.createdAt,
      trialEndsAt,
      trialActive: trialEndsAt > new Date(),
    };
  }

  async help() {
    const content = await prisma.appContent.findUnique({ where: { key: "HELP" } });
    return {
      title: content?.title ?? "Help & Support",
      body: content?.body ?? "For account, billing or technical help, contact Sunrise Coaching Khargone using the details below.",
      email: env.SUPPORT_EMAIL || content?.email || "admin@online-business-erp.com",
      phone: env.SUPPORT_PHONE || content?.phone || "7898356505",
    };
  }

  async sendQuery(user: TokenPayload, title: string, description: string) {
    const help = await this.help();
    const sender = await prisma.user.findUnique({
      where: { id: user.id },
      include: { company: { select: { name: true } } },
    });
    if (!sender) {
      throw new AppError(404, "User not found");
    }
    const senderName = `${sender.firstName} ${sender.lastName}`.trim();
    const html = helpQueryEmailTemplate({
      title,
      description,
      senderName,
      senderEmail: sender.email || sender.username || "",
      companyName: sender.company.name,
    });
    const text = `Help query: ${title}\nFrom: ${senderName} <${sender.email || sender.username || ""}>\nCompany: ${sender.company.name}\n\n${description}`;
    try {
      await sendMail(help.email, `Help query: ${title}`, html, {
        required: true,
        replyTo: sender.email || undefined,
        text,
      });
    } catch (error) {
      throw new AppError(503, error instanceof Error ? error.message : "Could not send email");
    }
    return { sent: true };
  }
}

export const dashboardService = new DashboardService();
export const calendarService = new CalendarService();
export const notificationService = new NotificationService();
export const contentService = new ContentService();
