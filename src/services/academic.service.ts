import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { TokenPayload } from "../lib/jwt";
import { assertBranchAccess, managerBranchId } from "../middleware/auth";
import { addMonths, toNumber } from "../lib/files";
import { ALIVE } from "../lib/soft-delete";

function requireWrite(user: TokenPayload) {
  if (user.role !== "ADMIN" && user.role !== "MANAGER") {
    throw new AppError(403, "You do not have access to this resource");
  }
}

function requireBranch(user: TokenPayload, branchId?: string) {
  const id = managerBranchId(user, branchId) ?? branchId;
  if (!id) throw new AppError(400, "branchId is required");
  return id;
}

export class AcademicService {
  async catalogs(user: TokenPayload) {
    const [subjects, classes, boards, higherEd] = await Promise.all([
      prisma.subject.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" } }),
      prisma.schoolClass.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" } }),
      prisma.board.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" } }),
      prisma.higherEdTrack.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" } }),
    ]);
    return { subjects, classes, boards, higherEd };
  }

  async createSubject(user: TokenPayload, name: string) {
    requireWrite(user);
    return prisma.subject.create({ data: { companyId: user.companyId, name: name.trim() } });
  }

  async updateSubject(user: TokenPayload, id: string, name: string) {
    requireWrite(user);
    const row = await prisma.subject.findFirst({ where: { id, companyId: user.companyId } });
    if (!row) throw new AppError(404, "Subject not found");
    return prisma.subject.update({ where: { id }, data: { name: name.trim() } });
  }

  async removeSubject(user: TokenPayload, id: string) {
    requireWrite(user);
    const row = await prisma.subject.findFirst({ where: { id, companyId: user.companyId } });
    if (!row) throw new AppError(404, "Subject not found");
    await prisma.subject.delete({ where: { id } });
    return null;
  }

  async listCourses(user: TokenPayload, branchId?: string) {
    const scoped = requireBranch(user, branchId);
    await assertBranchAccess(user, scoped);
    const rows = await prisma.course.findMany({
      where: { branchId: scoped, ...ALIVE },
      orderBy: { name: "asc" },
      include: { subjects: { include: { subject: true } } },
    });
    return rows.map((c) => ({
      ...c,
      price: toNumber(c.price),
      subjects: c.subjects.map((s) => s.subject),
    }));
  }

  async createCourse(
    user: TokenPayload,
    data: {
      branchId?: string;
      name: string;
      details?: string | null;
      durationMonths: number;
      price: number;
      subjectIds?: string[];
    },
  ) {
    requireWrite(user);
    const branchId = requireBranch(user, data.branchId);
    await assertBranchAccess(user, branchId);
    const course = await prisma.course.create({
      data: {
        branchId,
        name: data.name.trim(),
        details: data.details,
        durationMonths: data.durationMonths,
        price: data.price,
        subjects: {
          create: (data.subjectIds ?? []).map((subjectId) => ({ subjectId })),
        },
      },
      include: { subjects: { include: { subject: true } } },
    });
    return { ...course, price: toNumber(course.price), subjects: course.subjects.map((s) => s.subject) };
  }

  async updateCourse(
    user: TokenPayload,
    id: string,
    data: {
      name?: string;
      details?: string | null;
      durationMonths?: number;
      price?: number;
      subjectIds?: string[];
    },
  ) {
    requireWrite(user);
    const existing = await prisma.course.findUnique({ where: { id }, include: { branch: true } });
    if (!existing || existing.branch.companyId !== user.companyId || existing.deletedAt) {
      throw new AppError(404, "Course not found");
    }
    await assertBranchAccess(user, existing.branchId);
    const course = await prisma.$transaction(async (tx) => {
      if (data.subjectIds) {
        await tx.courseSubject.deleteMany({ where: { courseId: id } });
        await tx.courseSubject.createMany({
          data: data.subjectIds.map((subjectId) => ({ courseId: id, subjectId })),
        });
      }
      return tx.course.update({
        where: { id },
        data: {
          name: data.name?.trim(),
          details: data.details,
          durationMonths: data.durationMonths,
          price: data.price,
        },
        include: { subjects: { include: { subject: true } } },
      });
    });
    return { ...course, price: toNumber(course.price), subjects: course.subjects.map((s) => s.subject) };
  }

  async removeCourse(user: TokenPayload, id: string) {
    requireWrite(user);
    const existing = await prisma.course.findUnique({ where: { id }, include: { branch: true } });
    if (!existing || existing.branch.companyId !== user.companyId || existing.deletedAt) {
      throw new AppError(404, "Course not found");
    }
    await assertBranchAccess(user, existing.branchId);
    await prisma.course.update({ where: { id }, data: { deletedAt: new Date() } });
    return null;
  }

  async listBatches(user: TokenPayload, branchId?: string) {
    const scoped = requireBranch(user, branchId);
    await assertBranchAccess(user, scoped);
    const rows = await prisma.batch.findMany({
      where: { branchId: scoped, ...ALIVE },
      orderBy: { name: "asc" },
      include: { course: { include: { subjects: { include: { subject: true } } } } },
    });
    return rows.map((b) => ({
      ...b,
      price: toNumber(b.price),
      courseName: b.course.name,
      subjects: b.course.subjects.map((s) => s.subject),
    }));
  }

  async createBatch(
    user: TokenPayload,
    data: {
      branchId?: string;
      courseId: string;
      name: string;
      time?: string | null;
      price?: number;
      startDate: Date;
    },
  ) {
    requireWrite(user);
    const branchId = requireBranch(user, data.branchId);
    await assertBranchAccess(user, branchId);
    const course = await prisma.course.findFirst({
      where: { id: data.courseId, branchId, deletedAt: null },
    });
    if (!course) throw new AppError(400, "Course not found on this branch");
    const startDate = data.startDate;
    const endDate = addMonths(startDate, course.durationMonths);
    const batch = await prisma.batch.create({
      data: {
        branchId,
        courseId: course.id,
        name: data.name.trim(),
        time: data.time,
        durationMonths: course.durationMonths,
        price: data.price ?? toNumber(course.price),
        startDate,
        endDate,
      },
      include: { course: { include: { subjects: { include: { subject: true } } } } },
    });
    return {
      ...batch,
      price: toNumber(batch.price),
      courseName: batch.course.name,
      subjects: batch.course.subjects.map((s) => s.subject),
    };
  }

  async updateBatch(
    user: TokenPayload,
    id: string,
    data: { courseId?: string; name?: string; time?: string | null; price?: number; startDate?: Date },
  ) {
    requireWrite(user);
    const existing = await prisma.batch.findUnique({ where: { id }, include: { branch: true, course: true } });
    if (!existing || existing.branch.companyId !== user.companyId || existing.deletedAt) {
      throw new AppError(404, "Batch not found");
    }
    await assertBranchAccess(user, existing.branchId);
    const courseId = data.courseId ?? existing.courseId;
    const course = await prisma.course.findFirst({
      where: { id: courseId, branchId: existing.branchId, deletedAt: null },
    });
    if (!course) throw new AppError(400, "Course not found on this branch");
    const startDate = data.startDate ?? existing.startDate;
    const batch = await prisma.batch.update({
      where: { id },
      data: {
        courseId: course.id,
        name: data.name?.trim(),
        time: data.time,
        durationMonths: course.durationMonths,
        price: data.price,
        startDate,
        endDate: addMonths(startDate, course.durationMonths),
      },
      include: { course: { include: { subjects: { include: { subject: true } } } } },
    });
    return {
      ...batch,
      price: toNumber(batch.price),
      courseName: batch.course.name,
      subjects: batch.course.subjects.map((s) => s.subject),
    };
  }

  async removeBatch(user: TokenPayload, id: string) {
    requireWrite(user);
    const existing = await prisma.batch.findUnique({ where: { id }, include: { branch: true } });
    if (!existing || existing.branch.companyId !== user.companyId || existing.deletedAt) {
      throw new AppError(404, "Batch not found");
    }
    await assertBranchAccess(user, existing.branchId);
    await prisma.batch.update({ where: { id }, data: { deletedAt: new Date() } });
    return null;
  }
}

export const academicService = new AcademicService();
