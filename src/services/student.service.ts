import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { TokenPayload } from "../lib/jwt";
import { assertBranchAccess, managerBranchId } from "../middleware/auth";
import { parsePagination, paginated } from "../lib/pagination";
import { addMonths, startOfDay, toNumber } from "../lib/files";
import { derivedPaidAmount, money, settleFromLedger, settleFromPaid, subscriptionDue } from "../lib/student-billing";
import { fileService } from "./file.service";
import { PaymentMode, Prisma, Student } from "@prisma/client";
import { ALIVE } from "../lib/soft-delete";
import {
  formatYmd,
  normalizePhone,
  normalizeStudentEmail,
  parseGender,
  parseJoiningDate,
  studentsToExcelBuffer,
} from "../lib/student-excel";
import { upsertStudentUser } from "../lib/student-login";
import { revokeAllRefreshTokens } from "../lib/refresh-token";

type StudentRow = Student & {
  branch?: { id: string; name: string };
  schoolClass?: { id: string; name: string } | null;
  board?: { id: string; name: string } | null;
  courses?: Array<{ course: { id: string; name: string; durationMonths: number; price: Prisma.Decimal } }>;
  batches?: Array<{ batch: { id: string; name: string; endDate: Date } }>;
};

function emptyToNull(v?: string | null) {
  if (v == null || v === "") return null;
  return v;
}

function wrapPaid(paymentAmount: number, paidAmount: number) {
  try {
    return settleFromPaid(paymentAmount, paidAmount);
  } catch (error) {
    throw new AppError(400, error instanceof Error ? error.message : "Invalid paid amount");
  }
}

const studentInclude = {
  branch: { select: { id: true, name: true } },
  schoolClass: { select: { id: true, name: true } },
  board: { select: { id: true, name: true } },
  courses: { include: { course: { select: { id: true, name: true, durationMonths: true, price: true } } } },
  batches: { include: { batch: { select: { id: true, name: true, endDate: true } } } },
} as const;

export class StudentService {
  async list(
    user: TokenPayload,
    query: {
      page?: string;
      pageSize?: string;
      search?: string;
      branchId?: string;
      courseId?: string;
      listStatus?: string;
    },
  ) {
    if (user.role === "STUDENT") {
      throw new AppError(403, "You do not have access to this resource");
    }
    const { page, pageSize, skip, take } = parsePagination(query);
    const branchId = managerBranchId(user, query.branchId);
    const where: Record<string, unknown> = {
      branch: { companyId: user.companyId },
    };
    if (query.listStatus === "deactive") {
      where.OR = [{ deletedAt: { not: null } }, { status: "INACTIVE" }];
    } else {
      Object.assign(where, ALIVE);
      where.status = "ACTIVE";
    }
    if (branchId) where.branchId = branchId;
    if (query.courseId) where.courses = { some: { courseId: query.courseId } };
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [{ fullName: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }];
    }

    const [rows, total] = await prisma.$transaction([
      prisma.student.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: studentInclude,
      }),
      prisma.student.count({ where }),
    ]);
    const urls = await fileService.getUrls(rows.map((r) => r.photoFileId));
    const paidByStudent = await this.ledgerPaidByStudent(rows.map((r) => r.id));
    const items = rows.map((r) => this.toListDto(r, urls.get(r.photoFileId ?? "") ?? null, paidByStudent.get(r.id)));
    await Promise.all(
      rows.map((r, i) => this.persistDueIfStale(r.id, toNumber(r.dueAmount), items[i].dueAmount)),
    );
    return paginated(items, total, page, pageSize);
  }

  async get(user: TokenPayload, id: string) {
    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        branch: true,
        schoolClass: { select: { id: true, name: true } },
        board: { select: { id: true, name: true } },
        courses: { include: { course: { select: { id: true, name: true, durationMonths: true, price: true } } } },
        batches: { include: { batch: { select: { id: true, name: true, endDate: true } } } },
        payments: { orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }] },
      },
    });
    if (!student || student.branch.companyId !== user.companyId) {
      throw new AppError(404, "Student not found");
    }
    if (user.role === "STUDENT" && student.userId !== user.id) {
      throw new AppError(403, "You can only view your own profile");
    }
    await assertBranchAccess(user, student.branchId);
    const photoUrl = await fileService.getUrl(student.photoFileId);
    const ledgerPaid = student.payments.reduce((sum, p) => sum + toNumber(p.amount), 0);
    const dto = this.toListDto(student, photoUrl, ledgerPaid);
    await this.persistDueIfStale(student.id, toNumber(student.dueAmount), dto.dueAmount);
    const detail = {
      ...dto,
      gender: student.gender,
      dateOfBirth: student.dateOfBirth,
      location: student.location,
      schoolClassId: student.schoolClassId,
      boardId: student.boardId,
      courseCharge: toNumber(student.courseCharge),
      registrationCharge: toNumber(student.registrationCharge),
      paymentAmount: toNumber(student.paymentAmount),
      paymentDate: student.paymentDate,
      joiningDate: student.joiningDate,
      email: student.email,
      emergencyContact: student.emergencyContact,
      lastPaymentDate: student.payments[0]?.paymentDate ?? student.paymentDate,
      payments: student.payments.map((p) => ({
        id: p.id,
        amount: toNumber(p.amount),
        paymentDate: p.paymentDate,
        dueAmountAfter: toNumber(p.dueAmountAfter),
        paymentMode: p.mode,
      })),
    };
    if (user.role === "TEACHER") {
      return {
        ...detail,
        courseCharge: null,
        registrationCharge: null,
        paymentAmount: null,
        paymentDate: null,
        lastPaymentDate: null,
        paidAmount: null,
        dueAmount: null,
        paymentStatus: null,
        nextPaymentDate: null,
        payments: [],
      };
    }
    return detail;
  }

  async mine(user: TokenPayload) {
    const student = await prisma.student.findFirst({ where: { userId: user.id } });
    if (!student) throw new AppError(404, "Student profile not found");
    return this.get(user, student.id);
  }

  async create(
    user: TokenPayload,
    data: {
      photoFileId?: string | null;
      fullName: string;
      gender: "MALE" | "FEMALE" | "OTHER";
      dateOfBirth?: Date | null;
      location?: string | null;
      schoolClassId?: string | null;
      boardId?: string | null;
      courseIds?: string[];
      batchIds?: string[];
      paymentDate: Date;
      joiningDate: Date;
      email?: string | null;
      phone?: string | null;
      emergencyContact?: string | null;
      status?: "ACTIVE" | "INACTIVE";
      branchId?: string;
      registrationCharge?: number;
      subscriptionMonths?: number;
      paidAmount?: number;
      password?: string;
    },
    opts?: { skipWriteCheck?: boolean },
  ) {
    if (!opts?.skipWriteCheck && user.role !== "ADMIN" && user.role !== "MANAGER") {
      throw new AppError(403, "You do not have access to this resource");
    }
    const branchId = this.requireBranchId(user, data.branchId);
    await assertBranchAccess(user, branchId);
    const courses = await this.loadCourses(user, branchId, data.courseIds ?? []);
    const batches = await this.loadBatches(user, branchId, data.batchIds ?? []);
    const courseCharge = money(courses.reduce((sum, c) => sum + toNumber(c.price), 0));
    const registration = Math.max(0, Number(data.registrationCharge ?? 0));
    const paymentAmount = money(courseCharge + registration);
    const months = this.subscriptionMonths(courses, data.subscriptionMonths);
    const paidRaw = data.paidAmount != null ? Number(data.paidAmount) : 0;
    const settled = wrapPaid(paymentAmount, paidRaw);
    const monthEndDate = addMonths(data.paymentDate, months);

    const student = await prisma.$transaction(async (tx) => {
      const login = await upsertStudentUser(tx, {
        companyId: user.companyId,
        branchId,
        fullName: data.fullName,
        email: emptyToNull(data.email),
        phone: emptyToNull(data.phone),
        dateOfBirth: data.dateOfBirth ?? null,
        password: data.password,
      });
      const created = await tx.student.create({
        data: {
          branchId,
          userId: login.userId,
          photoFileId: data.photoFileId,
          fullName: data.fullName,
          gender: data.gender,
          dateOfBirth: data.dateOfBirth ?? null,
          location: emptyToNull(data.location),
          schoolClassId: emptyToNull(data.schoolClassId),
          boardId: emptyToNull(data.boardId),
          courseCharge,
          registrationCharge: registration,
          paymentAmount,
          dueAmount: settled.dueAmount,
          paymentDate: data.paymentDate,
          monthEndDate,
          subscriptionStartAt: data.paymentDate,
          subscriptionEndAt: monthEndDate,
          paymentStatus: settled.paymentStatus,
          joiningDate: data.joiningDate,
          email: emptyToNull(data.email),
          phone: emptyToNull(data.phone),
          emergencyContact: emptyToNull(data.emergencyContact),
          status: data.status ?? "ACTIVE",
          subscriptionMonths: months,
          courses: { create: courses.map((c) => ({ courseId: c.id })) },
          batches: { create: batches.map((b) => ({ batchId: b.id })) },
        },
      });
      if (settled.paid > 0) {
        await tx.studentPayment.create({
          data: {
            studentId: created.id,
            amount: settled.paid,
            paymentDate: data.paymentDate,
            dueAmountAfter: settled.dueAmount,
            mode: "CASH",
          },
        });
      }
      return created;
    });
    return this.get({ ...user, role: user.role === "STUDENT" ? "ADMIN" : user.role }, student.id);
  }

  async update(user: TokenPayload, id: string, data: Record<string, unknown>) {
    if (user.role !== "ADMIN" && user.role !== "MANAGER") {
      throw new AppError(403, "You do not have access to this resource");
    }
    const existing = await prisma.student.findUnique({
      where: { id },
      include: { branch: true, payments: { select: { amount: true } }, courses: true, batches: true },
    });
    if (!existing || existing.branch.companyId !== user.companyId || existing.deletedAt) {
      throw new AppError(404, "Student not found");
    }
    await assertBranchAccess(user, existing.branchId);
    const courseIds = (data.courseIds as string[] | undefined) ?? existing.courses.map((c) => c.courseId);
    const batchIds = (data.batchIds as string[] | undefined) ?? existing.batches.map((b) => b.batchId);
    const courses = await this.loadCourses(user, existing.branchId, courseIds);
    const batches = await this.loadBatches(user, existing.branchId, batchIds);
    const courseCharge = money(courses.reduce((sum, c) => sum + toNumber(c.price), 0));
    const registration =
      data.registrationCharge != null
        ? Math.max(0, Number(data.registrationCharge))
        : toNumber(existing.registrationCharge);
    const paymentAmount = money(courseCharge + registration);
    const months = this.subscriptionMonths(
      courses,
      data.subscriptionMonths != null ? Number(data.subscriptionMonths) : existing.subscriptionMonths,
    );
    const paymentDate = data.paymentDate ? new Date(data.paymentDate as string) : existing.paymentDate;
    const monthEndDate = addMonths(paymentDate, months);
    const ledgerPaid = existing.payments.reduce((sum, p) => sum + toNumber(p.amount), 0);
    const settled = settleFromLedger(paymentAmount, ledgerPaid);

    await prisma.$transaction(async (tx) => {
      await upsertStudentUser(tx, {
        companyId: user.companyId,
        branchId: existing.branchId,
        fullName: (data.fullName as string | undefined) ?? existing.fullName,
        email: data.email !== undefined ? emptyToNull(data.email as string) : existing.email,
        phone: data.phone !== undefined ? emptyToNull(data.phone as string) : existing.phone,
        dateOfBirth:
          data.dateOfBirth !== undefined ? (data.dateOfBirth as Date | null) : existing.dateOfBirth,
        existingUserId: existing.userId,
      });
      await tx.studentCourse.deleteMany({ where: { studentId: id } });
      await tx.studentBatch.deleteMany({ where: { studentId: id } });
      await tx.student.update({
        where: { id },
        data: {
          photoFileId: data.photoFileId as string | null | undefined,
          fullName: data.fullName as string | undefined,
          gender: data.gender as never,
          dateOfBirth: data.dateOfBirth !== undefined ? (data.dateOfBirth as Date | null) : undefined,
          location: data.location !== undefined ? emptyToNull(data.location as string) : undefined,
          schoolClassId: data.schoolClassId !== undefined ? emptyToNull(data.schoolClassId as string) : undefined,
          boardId: data.boardId !== undefined ? emptyToNull(data.boardId as string) : undefined,
          courseCharge,
          registrationCharge: registration,
          paymentAmount,
          dueAmount: settled.dueAmount,
          paymentDate,
          monthEndDate,
          subscriptionStartAt: paymentDate,
          subscriptionEndAt: monthEndDate,
          paymentStatus: settled.paymentStatus,
          joiningDate: data.joiningDate ? new Date(data.joiningDate as string) : undefined,
          email: data.email !== undefined ? emptyToNull(data.email as string) : undefined,
          phone: data.phone !== undefined ? emptyToNull(data.phone as string) : undefined,
          emergencyContact:
            data.emergencyContact !== undefined ? emptyToNull(data.emergencyContact as string) : undefined,
          status: data.status as never,
          subscriptionMonths: months,
          courses: { create: courses.map((c) => ({ courseId: c.id })) },
          batches: { create: batches.map((b) => ({ batchId: b.id })) },
        },
      });
    });
    await fileService.replace(
      user,
      existing.photoFileId,
      data.photoFileId !== undefined ? (data.photoFileId as string | null) : existing.photoFileId,
    );
    return this.get(user, id);
  }

  async remove(user: TokenPayload, id: string) {
    if (user.role !== "ADMIN" && user.role !== "MANAGER") {
      throw new AppError(403, "You do not have access to this resource");
    }
    const existing = await prisma.student.findUnique({
      where: { id },
      include: { branch: true },
    });
    if (!existing || existing.branch.companyId !== user.companyId || existing.deletedAt) {
      throw new AppError(404, "Student not found");
    }
    await assertBranchAccess(user, existing.branchId);
    await prisma.student.update({ where: { id }, data: { deletedAt: new Date(), status: "INACTIVE" } });
    if (existing.userId) await revokeAllRefreshTokens(existing.userId);
    return null;
  }

  async setLoginStatus(user: TokenPayload, id: string, status: "ACTIVE" | "INACTIVE") {
    if (user.role !== "ADMIN" && user.role !== "MANAGER") {
      throw new AppError(403, "You do not have access to this resource");
    }
    const existing = await prisma.student.findUnique({
      where: { id },
      include: { branch: true },
    });
    if (!existing || existing.branch.companyId !== user.companyId) {
      throw new AppError(404, "Student not found");
    }
    if (existing.deletedAt) {
      throw new AppError(400, "Restore the deleted student before changing login status");
    }
    await assertBranchAccess(user, existing.branchId);
    await prisma.student.update({ where: { id }, data: { status } });
    if (status === "INACTIVE" && existing.userId) {
      await revokeAllRefreshTokens(existing.userId);
    }
    return this.get(user, id);
  }

  async restore(user: TokenPayload, id: string) {
    if (user.role !== "ADMIN" && user.role !== "MANAGER") {
      throw new AppError(403, "You do not have access to this resource");
    }
    const existing = await prisma.student.findUnique({
      where: { id },
      include: { branch: true },
    });
    if (!existing || existing.branch.companyId !== user.companyId) {
      throw new AppError(404, "Student not found");
    }
    if (!existing.deletedAt) {
      throw new AppError(400, "Student is already active");
    }
    await assertBranchAccess(user, existing.branchId);
    await prisma.student.update({
      where: { id },
      data: { deletedAt: null, status: "ACTIVE" },
    });
    return this.get(user, id);
  }

  async addPayment(
    user: TokenPayload,
    studentId: string,
    paidAmount: number,
    paymentDate: Date,
    paymentMode: PaymentMode = "CASH",
  ) {
    if (user.role !== "ADMIN" && user.role !== "MANAGER") {
      throw new AppError(403, "You do not have access to this resource");
    }
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { branch: true },
    });
    if (!student || student.branch.companyId !== user.companyId || student.deletedAt) {
      throw new AppError(404, "Student not found");
    }
    await assertBranchAccess(user, student.branchId);
    const due = subscriptionDue({
      paymentAmount: toNumber(student.paymentAmount),
      storedDue: toNumber(student.dueAmount),
      paymentStatus: student.paymentStatus,
    });
    if (money(paidAmount) > due) {
      throw new AppError(400, "Paid amount cannot be greater than the due amount");
    }
    const remaining = money(Math.max(0, due - money(paidAmount)));
    const paymentStatus = remaining <= 0 ? "PAID" : "UNPAID";
    const monthEndDate =
      remaining <= 0 ? addMonths(paymentDate, student.subscriptionMonths) : student.monthEndDate;

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.studentPayment.create({
        data: {
          studentId,
          amount: paidAmount,
          paymentDate,
          dueAmountAfter: remaining,
          mode: paymentMode,
        },
      });
      await tx.student.update({
        where: { id: studentId },
        data: {
          dueAmount: remaining,
          paymentStatus,
          paymentDate,
          monthEndDate,
          subscriptionStartAt: paymentDate,
          subscriptionEndAt: monthEndDate,
        },
      });
      return created;
    });

    return {
      receipt: {
        studentName: student.fullName,
        joiningDate: student.joiningDate,
        lastPaymentDate: paymentDate,
        paidAmount,
        dueAmount: remaining,
        paymentDate,
        paymentMode,
        branchName: student.branch.name,
        receiptId: payment.id,
      },
    };
  }

  async dueList(
    user: TokenPayload,
    query: { page?: string; pageSize?: string; search?: string; branchId?: string },
  ) {
    if (user.role === "STUDENT") {
      throw new AppError(403, "You do not have access to this resource");
    }
    const { page, pageSize, skip, take } = parsePagination(query);
    const branchId = managerBranchId(user, query.branchId);
    const unpaid = [{ paymentStatus: "UNPAID" }, { dueAmount: { gt: 0 } }];
    const where: Record<string, unknown> = {
      ...ALIVE,
      branch: { companyId: user.companyId },
      status: "ACTIVE",
    };
    if (branchId) where.branchId = branchId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.AND = [{ OR: unpaid }, { OR: [{ fullName: { contains: q } }, { phone: { contains: q } }] }];
    } else {
      where.OR = unpaid;
    }
    const [rows, total] = await prisma.$transaction([
      prisma.student.findMany({
        where,
        skip,
        take,
        orderBy: { monthEndDate: "asc" },
        include: studentInclude,
      }),
      prisma.student.count({ where }),
    ]);
    const urls = await fileService.getUrls(rows.map((r) => r.photoFileId));
    const today = startOfDay(new Date());
    const paidByStudent = await this.ledgerPaidByStudent(rows.map((r) => r.id));
    const items = rows.map((r) => {
      const days = Math.round((startOfDay(new Date(r.monthEndDate)).getTime() - today.getTime()) / 86_400_000);
      return {
        ...this.toListDto(r, urls.get(r.photoFileId ?? "") ?? null, paidByStudent.get(r.id)),
        daysLeft: days,
      };
    });
    await Promise.all(
      rows.map((r, i) => this.persistDueIfStale(r.id, toNumber(r.dueAmount), items[i].dueAmount)),
    );
    return paginated(items, total, page, pageSize);
  }

  async exportExcel(user: TokenPayload, branchId?: string) {
    if (user.role !== "ADMIN") {
      throw new AppError(403, "Only admin can download the student list");
    }
    const scoped = managerBranchId(user, branchId);
    const where: Record<string, unknown> = {
      branch: { companyId: user.companyId },
    };
    if (scoped) where.branchId = scoped;
    const rows = await prisma.student.findMany({
      where,
      orderBy: { fullName: "asc" },
      include: {
        schoolClass: true,
        courses: { include: { course: true } },
        batches: { include: { batch: true } },
      },
    });
    return studentsToExcelBuffer(
      rows.map((row) => ({
        fullName: row.fullName,
        gender: row.gender,
        course: row.courses.map((c) => c.course.name).join(", "),
        batch: row.batches.map((b) => b.batch.name).join(", "),
        className: row.schoolClass?.name ?? "",
        joiningDate: formatYmd(row.joiningDate),
        phone: row.phone ?? "",
        email: row.email ?? "",
        status: row.deletedAt || row.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      })),
    );
  }

  async importRows(
    user: TokenPayload,
    input: {
      branchId?: string;
      rows: Array<{
        fullName: string;
        gender: string;
        joiningDate: string;
        phone?: string | null;
        email?: string | null;
        course?: string | null;
        batch?: string | null;
        className?: string | null;
      }>;
    },
  ) {
    if (user.role !== "ADMIN" && user.role !== "MANAGER") {
      throw new AppError(403, "You do not have access to this resource");
    }
    const branchId = this.requireBranchId(user, input.branchId);
    await assertBranchAccess(user, branchId);
    const existing = await prisma.student.findMany({
      where: { branch: { companyId: user.companyId } },
    });
    const results: Array<{ index: number; action: "created" | "updated" | "error"; message?: string }> = [];

    for (let index = 0; index < input.rows.length; index += 1) {
      const row = input.rows[index];
      const fullName = row.fullName.trim();
      const gender = parseGender(row.gender);
      const joiningDate = parseJoiningDate(row.joiningDate);
      const phone = normalizePhone(row.phone);
      const email = normalizeStudentEmail(row.email);
      if (!fullName) {
        results.push({ index, action: "error", message: "Full name is required" });
        continue;
      }
      if (!gender) {
        results.push({ index, action: "error", message: "Invalid gender" });
        continue;
      }
      if (!joiningDate) {
        results.push({ index, action: "error", message: "Invalid date of joining" });
        continue;
      }
      const course = row.course?.trim()
        ? await prisma.course.findFirst({
            where: { branchId, name: row.course.trim(), deletedAt: null },
          })
        : null;
      const batch = row.batch?.trim()
        ? await prisma.batch.findFirst({
            where: { branchId, name: row.batch.trim(), deletedAt: null },
          })
        : null;
      const schoolClass = row.className?.trim()
        ? await prisma.schoolClass.findFirst({
            where: { companyId: user.companyId, name: row.className.trim() },
          })
        : null;
      const byPhone = phone ? existing.find((m) => normalizePhone(m.phone) === phone) : undefined;
      const byEmail = email ? existing.find((m) => normalizeStudentEmail(m.email) === email) : undefined;
      if (byPhone && byEmail && byPhone.id !== byEmail.id) {
        results.push({ index, action: "error", message: "Mobile and email match different students" });
        continue;
      }
      const match = byPhone || byEmail;
      try {
        if (match) {
          const updated = await prisma.student.update({
            where: { id: match.id },
            data: {
              fullName,
              gender,
              joiningDate,
              phone,
              email,
              schoolClassId: schoolClass?.id ?? match.schoolClassId,
              deletedAt: null,
            },
          });
          Object.assign(match, updated);
          results.push({ index, action: "updated" });
        } else {
          const created = await this.create(user, {
            fullName,
            gender,
            joiningDate,
            phone,
            email,
            branchId,
            courseIds: course ? [course.id] : [],
            batchIds: batch ? [batch.id] : [],
            schoolClassId: schoolClass?.id,
            paidAmount: 0,
            registrationCharge: 0,
            paymentDate: joiningDate,
            status: "ACTIVE",
          });
          existing.push({
            id: created.id,
            fullName,
            gender,
            joiningDate,
            phone,
            email,
            deletedAt: null,
          } as (typeof existing)[number]);
          results.push({ index, action: "created" });
        }
      } catch (error) {
        results.push({
          index,
          action: "error",
          message: error instanceof AppError ? error.message : "Could not save this row",
        });
      }
    }

    return {
      created: results.filter((r) => r.action === "created").length,
      updated: results.filter((r) => r.action === "updated").length,
      failed: results.filter((r) => r.action === "error").length,
      results,
    };
  }

  private requireBranchId(user: TokenPayload, branchId?: string) {
    if (user.role === "MANAGER" || user.role === "TEACHER" || user.role === "STUDENT") {
      if (!user.branchId) throw new AppError(400, "No branch assigned");
      return user.branchId;
    }
    if (!branchId) throw new AppError(400, "branchId is required");
    return branchId;
  }

  private subscriptionMonths(
    courses: Array<{ durationMonths: number }>,
    requested?: number,
  ): number {
    if (requested && courses.some((c) => c.durationMonths === requested)) return requested;
    if (courses.length) return Math.max(...courses.map((c) => c.durationMonths));
    return requested && requested > 0 ? requested : 1;
  }

  private async loadCourses(user: TokenPayload, branchId: string, ids: string[]) {
    if (!ids.length) return [];
    const rows = await prisma.course.findMany({
      where: { id: { in: ids }, branchId, deletedAt: null, branch: { companyId: user.companyId } },
    });
    if (rows.length !== ids.length) throw new AppError(400, "One or more courses were not found");
    return rows;
  }

  private async loadBatches(user: TokenPayload, branchId: string, ids: string[]) {
    if (!ids.length) return [];
    const rows = await prisma.batch.findMany({
      where: { id: { in: ids }, branchId, deletedAt: null, branch: { companyId: user.companyId } },
    });
    if (rows.length !== ids.length) throw new AppError(400, "One or more batches were not found");
    return rows;
  }

  private async ledgerPaidByStudent(studentIds: string[]) {
    const paidByStudent = new Map<string, number>();
    if (!studentIds.length) return paidByStudent;
    const sums = await prisma.studentPayment.groupBy({
      by: ["studentId"],
      where: { studentId: { in: studentIds } },
      _sum: { amount: true },
    });
    for (const row of sums) {
      paidByStudent.set(row.studentId, toNumber(row._sum.amount));
    }
    return paidByStudent;
  }

  private async persistDueIfStale(studentId: string, storedDue: number, dueAmount: number) {
    if (money(storedDue) === money(dueAmount)) return;
    await prisma.student.update({ where: { id: studentId }, data: { dueAmount } });
  }

  private toListDto(student: StudentRow, photoUrl: string | null, ledgerPaid?: number) {
    const end = startOfDay(new Date(student.monthEndDate));
    const today = startOfDay(new Date());
    const paymentAmount = toNumber(student.paymentAmount);
    const dueAmount = subscriptionDue({
      paymentAmount,
      storedDue: toNumber(student.dueAmount),
      paymentStatus: student.paymentStatus,
      ledgerPaid,
    });
    return {
      id: student.id,
      branchId: student.branchId,
      branchName: student.branch?.name,
      photoFileId: student.photoFileId,
      photoUrl,
      fullName: student.fullName,
      phone: student.phone,
      monthEndDate: student.monthEndDate,
      paymentStatus: student.paymentStatus,
      status: student.status,
      courseCharge: toNumber(student.courseCharge),
      registrationCharge: toNumber(student.registrationCharge),
      paymentAmount,
      dueAmount,
      paidAmount: derivedPaidAmount(paymentAmount, dueAmount, student.paymentStatus),
      subscriptionMonths: student.subscriptionMonths,
      subscriptionStartAt: student.subscriptionStartAt,
      subscriptionEndAt: student.subscriptionEndAt,
      paymentDate: student.paymentDate,
      nextPaymentDate: student.monthEndDate,
      subscriptionStatus: end.getTime() >= today.getTime() ? "ACTIVE" : "EXPIRED",
      deactivated: Boolean(student.deletedAt),
      userId: student.userId,
      className: student.schoolClass?.name ?? null,
      boardName: student.board?.name ?? null,
      courses: (student.courses ?? []).map((c) => ({
        id: c.course.id,
        name: c.course.name,
        durationMonths: c.course.durationMonths,
        price: toNumber(c.course.price),
      })),
      batches: (student.batches ?? []).map((b) => ({
        id: b.batch.id,
        name: b.batch.name,
        endDate: b.batch.endDate,
      })),
    };
  }
}

export const studentService = new StudentService();
