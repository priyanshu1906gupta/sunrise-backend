import fs from "fs";
import { prisma } from "../lib/prisma";
import { TokenPayload } from "../lib/jwt";
import { assertBranchAccess, managerBranchId } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { ALIVE } from "../lib/soft-delete";
import { absoluteUploadPath } from "../lib/files";
import { fileService } from "./file.service";
import { branchTeacherUserIds, enrolledStudentUserIds, notifyUsers } from "../lib/notify-students";

function isStaff(role: TokenPayload["role"]): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "TEACHER";
}

function requireStaff(user: TokenPayload): void {
  if (!isStaff(user.role)) {
    throw new AppError(403, "You do not have access to this resource");
  }
}

export function youtubeIdFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      if (url.searchParams.get("v")) return url.searchParams.get("v");
      const parts = url.pathname.split("/").filter(Boolean);
      if ((parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") && parts[1]) {
        return parts[1];
      }
    }
  } catch {
    return null;
  }
  return null;
}

function youtubeEmbedUrl(raw: string): string | null {
  const id = youtubeIdFromUrl(raw);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

export class StudyMaterialService {
  private async studentRow(user: TokenPayload) {
    const student = await prisma.student.findFirst({
      where: { userId: user.id, ...ALIVE },
      include: { courses: true },
    });
    if (!student) throw new AppError(404, "Student profile not found");
    return student;
  }

  async list(user: TokenPayload, query: { branchId?: string; courseId?: string; subjectId?: string }) {
    const where: Record<string, unknown> = { ...ALIVE };
    if (query.courseId) where.courseId = query.courseId;
    if (query.subjectId) where.subjectId = query.subjectId;

    if (user.role === "STUDENT") {
      const student = await this.studentRow(user);
      const enrolled = student.courses.map((c) => c.courseId);
      if (!enrolled.length) return [];
      where.branchId = student.branchId;
      where.courseId = query.courseId ? query.courseId : { in: enrolled };
      if (query.courseId && !enrolled.includes(query.courseId)) return [];
    } else {
      requireStaff(user);
      const scoped = managerBranchId(user, query.branchId);
      if (scoped) {
        await assertBranchAccess(user, scoped);
        where.branchId = scoped;
      } else {
        where.branch = { companyId: user.companyId };
      }
    }

    const rows = await prisma.studyMaterial.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        course: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      youtubeUrl: row.youtubeUrl,
      courseId: row.courseId,
      courseName: row.course.name,
      subjectId: row.subjectId,
      subjectName: row.subject.name,
      branchId: row.branchId,
      createdAt: row.createdAt,
    }));
  }

  async get(user: TokenPayload, id: string) {
    const row = await prisma.studyMaterial.findFirst({
      where: { id, ...ALIVE },
      include: {
        course: { include: { branch: true } },
        subject: { select: { id: true, name: true } },
      },
    });
    if (!row || row.course.branch.companyId !== user.companyId) {
      throw new AppError(404, "Study material not found");
    }
    await assertBranchAccess(user, row.branchId);
    if (user.role === "STUDENT") {
      const student = await this.studentRow(user);
      if (!student.courses.some((c) => c.courseId === row.courseId)) {
        throw new AppError(403, "You are not enrolled in this course");
      }
    } else {
      requireStaff(user);
    }
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      youtubeUrl: row.youtubeUrl,
      youtubeEmbedUrl: row.youtubeUrl ? youtubeEmbedUrl(row.youtubeUrl) : null,
      courseId: row.courseId,
      courseName: row.course.name,
      subjectId: row.subjectId,
      subjectName: row.subject.name,
      branchId: row.branchId,
      createdAt: row.createdAt,
    };
  }

  async create(
    user: TokenPayload,
    data: {
      branchId?: string;
      courseId: string;
      subjectId: string;
      name: string;
      kind?: "PDF" | "YOUTUBE";
      fileId?: string;
      youtubeUrl?: string;
    },
  ) {
    requireStaff(user);
    const course = await prisma.course.findFirst({
      where: { id: data.courseId, ...ALIVE },
      include: { branch: true, subjects: true },
    });
    if (!course || course.branch.companyId !== user.companyId) {
      throw new AppError(404, "Course not found");
    }
    await assertBranchAccess(user, course.branchId);
    if (data.branchId && data.branchId !== course.branchId) {
      throw new AppError(400, "Course does not belong to this branch");
    }
    if (!course.subjects.some((s) => s.subjectId === data.subjectId)) {
      throw new AppError(400, "Subject is not part of this course");
    }
    const subject = await prisma.subject.findFirst({
      where: { id: data.subjectId, companyId: user.companyId },
    });
    if (!subject) throw new AppError(404, "Subject not found");

    const kind = data.kind === "YOUTUBE" ? "YOUTUBE" : "PDF";
    let fileId: string | null = null;
    let youtubeUrl: string | null = null;
    if (kind === "YOUTUBE") {
      if (!data.youtubeUrl || !youtubeIdFromUrl(data.youtubeUrl)) {
        throw new AppError(400, "Enter a valid YouTube link");
      }
      youtubeUrl = data.youtubeUrl.trim();
    } else {
      if (!data.fileId) throw new AppError(400, "Upload a PDF file first");
      const file = await prisma.file.findUnique({ where: { id: data.fileId } });
      if (!file || file.companyId !== user.companyId || file.mimeType !== "application/pdf") {
        throw new AppError(400, "Upload a PDF file first");
      }
      fileId = file.id;
    }

    const created = await prisma.studyMaterial.create({
      data: {
        branchId: course.branchId,
        courseId: course.id,
        subjectId: subject.id,
        name: data.name.trim(),
        kind,
        fileId,
        youtubeUrl,
        createdById: user.id,
      },
      include: {
        course: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
      },
    });

    const studentIds = await enrolledStudentUserIds(course.id);
    const teacherIds = await branchTeacherUserIds(course.branchId, user.id);
    await notifyUsers({
      userIds: [...studentIds, ...teacherIds],
      type: "STUDY_MATERIAL",
      title: "Study material uploaded",
      message: `${created.name} · ${created.course.name} / ${created.subject.name}`,
      entityId: created.id,
      branchId: course.branchId,
      url: `/study-materials/${created.id}/view`,
      data: { studyMaterialId: created.id },
    });

    return {
      id: created.id,
      name: created.name,
      kind: created.kind,
      youtubeUrl: created.youtubeUrl,
      courseId: created.courseId,
      courseName: created.course.name,
      subjectId: created.subjectId,
      subjectName: created.subject.name,
      branchId: created.branchId,
      createdAt: created.createdAt,
    };
  }

  async remove(user: TokenPayload, id: string) {
    requireStaff(user);
    const row = await prisma.studyMaterial.findFirst({
      where: { id, ...ALIVE },
      include: { course: { include: { branch: true } } },
    });
    if (!row || row.course.branch.companyId !== user.companyId) {
      throw new AppError(404, "Study material not found");
    }
    await assertBranchAccess(user, row.branchId);
    await prisma.studyMaterial.update({ where: { id }, data: { deletedAt: new Date() } });
    if (row.fileId) await fileService.removeIfUnused(user, row.fileId);
    return null;
  }

  async filePath(user: TokenPayload, id: string): Promise<{ abs: string; name: string }> {
    const row = await prisma.studyMaterial.findFirst({
      where: { id, ...ALIVE },
      include: { course: { include: { branch: true } } },
    });
    if (!row || row.course.branch.companyId !== user.companyId) {
      throw new AppError(404, "Study material not found");
    }
    await assertBranchAccess(user, row.branchId);
    if (user.role === "STUDENT") {
      const student = await this.studentRow(user);
      if (!student.courses.some((c) => c.courseId === row.courseId)) {
        throw new AppError(403, "You are not enrolled in this course");
      }
    } else {
      requireStaff(user);
    }
    if (row.kind === "YOUTUBE" || !row.fileId) {
      throw new AppError(400, "This material is a YouTube link");
    }
    const file = await prisma.file.findUnique({ where: { id: row.fileId } });
    if (!file) throw new AppError(404, "File not found");
    const abs = absoluteUploadPath(file.relativePath);
    if (!fs.existsSync(abs)) throw new AppError(404, "File not found");
    const safeName = `${row.name.replace(/[^\w.\- ]+/g, "").trim() || "material"}.pdf`;
    return { abs, name: safeName };
  }
}

export const studyMaterialService = new StudyMaterialService();
