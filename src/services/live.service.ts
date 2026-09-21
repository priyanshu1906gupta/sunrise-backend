import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { TokenPayload } from "../lib/jwt";
import { assertBranchAccess, managerBranchId } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { ALIVE } from "../lib/soft-delete";
import { startOfDay } from "../lib/files";
import { env } from "../config/env";
import { pushService } from "./push.service";
import { emitLiveEnded, emitLiveStarted, wipeChat, wipeMedia } from "../lib/live-events";

function isStaff(role: TokenPayload["role"]): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "TEACHER";
}

function requireStaff(user: TokenPayload): void {
  if (!isStaff(user.role)) {
    throw new AppError(403, "You do not have access to this resource");
  }
}

function displayName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

function jitsiDomain(): string {
  return env.JITSI_DOMAIN.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "meet.jit.si";
}

export class LiveService {
  private async branchIds(user: TokenPayload, requested?: string): Promise<string[]> {
    const scoped = managerBranchId(user, requested);
    const where = scoped ? { id: scoped, companyId: user.companyId } : { companyId: user.companyId };
    const branches = await prisma.branch.findMany({ where, select: { id: true } });
    if (!branches.length) throw new AppError(404, "No branch found");
    if (scoped) await assertBranchAccess(user, scoped);
    return branches.map((b) => b.id);
  }

  private async studentRow(user: TokenPayload) {
    const student = await prisma.student.findFirst({
      where: { userId: user.id, ...ALIVE },
      include: { courses: true },
    });
    if (!student) throw new AppError(404, "Student profile not found");
    return student;
  }

  async catalog(user: TokenPayload, branchId?: string) {
    if (user.role === "STUDENT") {
      const student = await this.studentRow(user);
      const enrolled = student.courses.map((c) => c.courseId);
      if (!enrolled.length) return { courses: [] };
      const rows = await prisma.course.findMany({
        where: { branchId: student.branchId, id: { in: enrolled }, ...ALIVE },
        orderBy: { name: "asc" },
        include: { subjects: { include: { subject: true } } },
      });
      return this.withLiveFlags(rows);
    }

    const ids = await this.branchIds(user, branchId);
    const rows = await prisma.course.findMany({
      where: { branchId: { in: ids }, ...ALIVE },
      orderBy: { name: "asc" },
      include: { subjects: { include: { subject: true } } },
    });
    return this.withLiveFlags(rows);
  }

  private async withLiveFlags(
    rows: Array<{
      id: string;
      name: string;
      branchId: string;
      subjects: Array<{ subject: { id: string; name: string } }>;
    }>,
  ) {
    const courseIds = rows.map((c) => c.id);
    const live = courseIds.length
      ? await prisma.liveSession.findMany({
          where: { courseId: { in: courseIds }, status: "LIVE" },
          select: { id: true, courseId: true, subjectId: true },
        })
      : [];
    const liveMap = new Map(live.map((s) => [`${s.courseId}:${s.subjectId}`, s.id]));
    return {
      courses: rows.map((c) => ({
        id: c.id,
        name: c.name,
        branchId: c.branchId,
        subjects: c.subjects.map((s) => ({
          id: s.subject.id,
          name: s.subject.name,
          liveSessionId: liveMap.get(`${c.id}:${s.subject.id}`) ?? null,
        })),
      })),
    };
  }

  async start(user: TokenPayload, data: { branchId?: string; courseId: string; subjectId: string }) {
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

    const existing = await prisma.liveSession.findFirst({
      where: { courseId: course.id, subjectId: subject.id, status: "LIVE" },
    });
    if (existing) {
      return this.joinPayload(user, existing.id);
    }

    const session = await prisma.liveSession.create({
      data: {
        branchId: course.branchId,
        courseId: course.id,
        subjectId: subject.id,
        startedById: user.id,
        status: "LIVE",
        jitsiRoom: `sunrise-${randomUUID()}`,
      },
    });

    await this.notifyEnrolled(session.id, course.branchId, course.id, course.name, subject.name);
    emitLiveStarted(course.branchId, {
      sessionId: session.id,
      courseId: course.id,
      subjectId: subject.id,
      courseName: course.name,
      subjectName: subject.name,
    });

    return this.joinPayload(user, session.id);
  }

  async end(user: TokenPayload, id: string) {
    requireStaff(user);
    const session = await prisma.liveSession.findUnique({
      where: { id },
      include: { course: { include: { branch: true } } },
    });
    if (!session || session.course.branch.companyId !== user.companyId) {
      throw new AppError(404, "Live class not found");
    }
    await assertBranchAccess(user, session.branchId);
    if (session.status !== "LIVE") {
      wipeChat(session.id);
      wipeMedia(session.id);
      return { ended: true, id: session.id };
    }
    const canEnd = session.startedById === user.id || user.role === "ADMIN" || user.role === "MANAGER";
    if (!canEnd) {
      throw new AppError(403, "Only the host or an admin can end this live class");
    }
    await prisma.liveSession.update({
      where: { id: session.id },
      data: { status: "ENDED", endedAt: new Date() },
    });
    wipeChat(session.id);
    wipeMedia(session.id);
    emitLiveEnded(session.branchId, session.id);
    return { ended: true, id: session.id };
  }

  async join(user: TokenPayload, id: string) {
    return this.joinPayload(user, id);
  }

  async assertCanJoin(user: TokenPayload, id: string) {
    const session = await prisma.liveSession.findUnique({
      where: { id },
      include: {
        course: { include: { branch: true } },
        subject: true,
        startedBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!session || session.course.branch.companyId !== user.companyId) {
      throw new AppError(404, "Live class not found");
    }
    if (session.status !== "LIVE") {
      throw new AppError(410, "Live class has ended");
    }
    await assertBranchAccess(user, session.branchId);

    if (user.role === "STUDENT") {
      const student = await this.studentRow(user);
      if (!student.courses.some((c) => c.courseId === session.courseId)) {
        throw new AppError(403, "You are not enrolled in this course");
      }
      return { session, role: "viewer" as const, displayName: student.fullName };
    }

    requireStaff(user);
    const staff = await prisma.user.findUnique({
      where: { id: user.id },
      select: { firstName: true, lastName: true },
    });
    return {
      session,
      role: "moderator" as const,
      displayName: staff ? displayName(staff) : user.email || user.username || "Teacher",
    };
  }

  private async joinPayload(user: TokenPayload, id: string) {
    const { session, role, displayName: name } = await this.assertCanJoin(user, id);
    return {
      id: session.id,
      branchId: session.branchId,
      courseId: session.courseId,
      subjectId: session.subjectId,
      courseName: session.course.name,
      subjectName: session.subject.name,
      status: session.status,
      jitsiRoom: session.jitsiRoom,
      jitsiDomain: jitsiDomain(),
      role,
      startedById: session.startedById,
      hostName: displayName(session.startedBy),
      displayName: name,
      startedAt: session.startedAt,
    };
  }

  private async notifyEnrolled(
    sessionId: string,
    branchId: string,
    courseId: string,
    courseName: string,
    subjectName: string,
  ) {
    const enrolled = await prisma.studentCourse.findMany({
      where: {
        courseId,
        student: { ...ALIVE, status: "ACTIVE", userId: { not: null } },
      },
      select: { student: { select: { userId: true } } },
    });
    const userIds = [
      ...new Set(enrolled.map((row) => row.student.userId).filter((id): id is string => Boolean(id))),
    ];
    if (!userIds.length) return;

    const title = "Live class started";
    const message = `${courseName} / ${subjectName}`;
    const dueDate = startOfDay(new Date());
    dueDate.setHours(12, 0, 0, 0);

    await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: "LIVE_CLASS" as const,
        title,
        message,
        entityId: sessionId,
        branchId,
        dueDate,
      })),
      skipDuplicates: true,
    });

    const hash = `/live-classes/${sessionId}`;
    await Promise.all(
      userIds.map((userId) =>
        pushService.notifyUser(userId, title, message, {
          type: "LIVE_CLASS",
          liveSessionId: sessionId,
          url: hash,
        }),
      ),
    );
  }
}

export const liveService = new LiveService();
