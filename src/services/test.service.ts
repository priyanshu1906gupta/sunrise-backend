import { AttemptStatus, NegativeFraction, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { TokenPayload } from "../lib/jwt";
import { assertBranchAccess, managerBranchId } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { ALIVE } from "../lib/soft-delete";
import { toNumber } from "../lib/files";
import { testSampleExcelBuffer } from "../lib/test-excel";

export type QuestionOption = { en: string; hi: string };

export type QuestionInput = {
  subjectName: string;
  questionEn: string;
  questionHi: string;
  correctIndex: number;
  answerDescription: string;
  options: QuestionOption[];
};

export type AnswerPayload = {
  questionId: string;
  selectedIndex: number | null;
  markedForReview: boolean;
  secondsSpent: number;
};

function isTestAuthor(role: TokenPayload["role"]): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "TEACHER";
}

function requireAuthor(user: TokenPayload): void {
  if (!isTestAuthor(user.role)) {
    throw new AppError(403, "You do not have access to this resource");
  }
}

function requireStudent(user: TokenPayload): void {
  if (user.role !== "STUDENT") {
    throw new AppError(403, "You do not have access to this resource");
  }
}

function negativeValue(fraction: NegativeFraction | null | undefined): number {
  if (fraction === "HALF") return 0.5;
  if (fraction === "THIRD") return 1 / 3;
  if (fraction === "FOURTH") return 0.25;
  return 0;
}

function remainingFromStart(startedAt: Date, durationMinutes: number): number {
  const elapsed = Math.floor((Date.now() - startedAt.getTime()) / 1000);
  return Math.max(0, durationMinutes * 60 - elapsed);
}

function asOptions(value: Prisma.JsonValue): QuestionOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const row = item as Record<string, unknown>;
      return { en: String(row.en ?? ""), hi: String(row.hi ?? "") };
    })
    .filter((item): item is QuestionOption => Boolean(item));
}

function asAnswers(value: Prisma.JsonValue): AnswerPayload[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const row = item as Record<string, unknown>;
      const selected =
        row.selectedIndex == null || row.selectedIndex === ""
          ? null
          : Number(row.selectedIndex);
      return {
        questionId: String(row.questionId ?? ""),
        selectedIndex: Number.isFinite(selected) && selected ? selected : null,
        markedForReview: Boolean(row.markedForReview),
        secondsSpent: Math.max(0, Number(row.secondsSpent) || 0),
      };
    })
    .filter((item): item is AnswerPayload => Boolean(item?.questionId));
}

function roundMarks(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function publicQuestion(q: {
  id: string;
  sortOrder: number;
  subjectName: string;
  questionEn: string;
  questionHi: string;
  options: Prisma.JsonValue;
}) {
  return {
    id: q.id,
    sortOrder: q.sortOrder,
    subjectName: q.subjectName,
    questionEn: q.questionEn,
    questionHi: q.questionHi,
    options: asOptions(q.options),
  };
}

export class TestService {
  async sampleExcel(): Promise<Buffer> {
    return testSampleExcelBuffer();
  }

  private async branchIds(user: TokenPayload, requested?: string): Promise<string[]> {
    const scoped = managerBranchId(user, requested);
    const where = scoped ? { id: scoped, companyId: user.companyId } : { companyId: user.companyId };
    const branches = await prisma.branch.findMany({ where, select: { id: true } });
    if (!branches.length) throw new AppError(404, "No branch found");
    if (scoped) await assertBranchAccess(user, scoped);
    return branches.map((b) => b.id);
  }

  private async requireStudentRow(user: TokenPayload) {
    requireStudent(user);
    const student = await prisma.student.findFirst({
      where: { userId: user.id, ...ALIVE },
      include: { courses: true },
    });
    if (!student) throw new AppError(404, "Student profile not found");
    return student;
  }

  private async staffTest(user: TokenPayload, id: string) {
    requireAuthor(user);
    const test = await prisma.test.findFirst({
      where: { id, ...ALIVE },
      include: {
        course: true,
        branch: true,
        questions: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!test || test.branch.companyId !== user.companyId) {
      throw new AppError(404, "Test not found");
    }
    await assertBranchAccess(user, test.branchId);
    return test;
  }

  async list(user: TokenPayload, query: { branchId?: string; courseId?: string }) {
    requireAuthor(user);
    const ids = await this.branchIds(user, query.branchId);
    const tests = await prisma.test.findMany({
      where: {
        branchId: { in: ids },
        ...(query.courseId ? { courseId: query.courseId } : {}),
        ...ALIVE,
      },
      include: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        _count: { select: { questions: true, attempts: true } },
      },
      orderBy: [{ course: { name: "asc" } }, { createdAt: "desc" }],
    });
    return tests.map((t) => ({
      id: t.id,
      name: t.name,
      courseId: t.courseId,
      courseName: t.course.name,
      branchId: t.branchId,
      branchName: t.branch.name,
      durationMinutes: t.durationMinutes,
      questionCount: t.questionCount,
      totalMarks: t.totalMarks,
      negativeEnabled: t.negativeEnabled,
      negativeFraction: t.negativeFraction,
      attemptCount: t._count.attempts,
      createdAt: t.createdAt,
    }));
  }

  async create(
    user: TokenPayload,
    input: {
      name: string;
      courseId: string;
      durationMinutes: number;
      questionCount?: number;
      negativeEnabled: boolean;
      negativeFraction?: NegativeFraction | null;
      branchId?: string;
      questions: QuestionInput[];
    },
  ) {
    requireAuthor(user);
    const questions = input.questions ?? [];
    if (!questions.length) throw new AppError(400, "Upload at least one question");
    const course = await prisma.course.findFirst({
      where: { id: input.courseId, ...ALIVE },
      include: { branch: true },
    });
    if (!course || course.branch.companyId !== user.companyId) {
      throw new AppError(404, "Course not found");
    }
    await assertBranchAccess(user, course.branchId);
    if (input.branchId && input.branchId !== course.branchId) {
      throw new AppError(400, "Course does not belong to this branch");
    }
    if (input.questionCount && input.questionCount !== questions.length) {
      throw new AppError(400, `Expected ${input.questionCount} questions, found ${questions.length}`);
    }
    for (const [i, q] of questions.entries()) {
      const opts = (q.options ?? []).filter((o) => o.en.trim() || o.hi.trim());
      if (opts.length < 2) {
        throw new AppError(400, `Question ${i + 1} needs at least two options`);
      }
      if (!q.questionEn.trim() && !q.questionHi.trim()) {
        throw new AppError(400, `Question ${i + 1} text is required`);
      }
      if (q.correctIndex < 1 || q.correctIndex > opts.length) {
        throw new AppError(400, `Question ${i + 1} has an invalid answer number`);
      }
    }
    const created = await prisma.test.create({
      data: {
        name: input.name.trim(),
        courseId: course.id,
        branchId: course.branchId,
        durationMinutes: input.durationMinutes,
        questionCount: questions.length,
        totalMarks: questions.length,
        negativeEnabled: input.negativeEnabled,
        negativeFraction: input.negativeEnabled ? (input.negativeFraction ?? "HALF") : null,
        createdById: user.id,
        questions: {
          create: questions.map((q, i) => {
            const options = (q.options ?? []).filter((o) => o.en.trim() || o.hi.trim());
            return {
              sortOrder: i + 1,
              subjectName: q.subjectName.trim() || "General",
              questionEn: q.questionEn.trim(),
              questionHi: q.questionHi.trim(),
              options: options as unknown as Prisma.InputJsonValue,
              correctIndex: q.correctIndex,
              answerDescription: q.answerDescription?.trim() || "",
            };
          }),
        },
      },
      include: { course: { select: { id: true, name: true } } },
    });
    const { enrolledStudentUserIds, notifyUsers } = await import("../lib/notify-students");
    const studentIds = await enrolledStudentUserIds(course.id);
    await notifyUsers({
      userIds: studentIds,
      type: "TEST",
      title: "New test uploaded",
      message: `${created.name} · ${created.course.name}`,
      entityId: created.id,
      branchId: course.branchId,
      url: "/tests",
      data: { testId: created.id },
    });
    return {
      id: created.id,
      name: created.name,
      courseId: created.courseId,
      courseName: created.course.name,
      durationMinutes: created.durationMinutes,
      questionCount: created.questionCount,
      totalMarks: created.totalMarks,
    };
  }

  async get(user: TokenPayload, id: string) {
    const test = await this.staffTest(user, id);
    const attempts = await prisma.testAttempt.findMany({
      where: { testId: id, status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] } },
      include: { student: { select: { id: true, fullName: true } } },
    });
    const ranked = this.rankAttempts(attempts, test.durationMinutes);
    const subjects = [...new Set(test.questions.map((q) => q.subjectName))];
    return {
      id: test.id,
      name: test.name,
      courseId: test.courseId,
      courseName: test.course.name,
      branchId: test.branchId,
      durationMinutes: test.durationMinutes,
      questionCount: test.questionCount,
      totalMarks: test.totalMarks,
      negativeEnabled: test.negativeEnabled,
      negativeFraction: test.negativeFraction,
      subjects,
      questions: test.questions.map((q) => ({
        ...publicQuestion(q),
        correctIndex: q.correctIndex,
        answerDescription: q.answerDescription,
      })),
      attempts: ranked,
    };
  }

  async remove(user: TokenPayload, id: string) {
    await this.staffTest(user, id);
    await prisma.test.update({ where: { id }, data: { deletedAt: new Date() } });
    return null;
  }

  async available(user: TokenPayload) {
    const student = await this.requireStudentRow(user);
    const courseIds = student.courses.map((c) => c.courseId);
    if (!courseIds.length) return [];
    const tests = await prisma.test.findMany({
      where: { courseId: { in: courseIds }, branchId: student.branchId, ...ALIVE },
      include: {
        course: { select: { id: true, name: true } },
        questions: { select: { subjectName: true } },
        attempts: { where: { studentId: student.id } },
      },
      orderBy: { createdAt: "desc" },
    });
    return tests.map((t) => {
      const attempt = t.attempts[0];
      return {
        id: t.id,
        name: t.name,
        courseId: t.courseId,
        courseName: t.course.name,
        durationMinutes: t.durationMinutes,
        questionCount: t.questionCount,
        totalMarks: t.totalMarks,
        negativeEnabled: t.negativeEnabled,
        negativeFraction: t.negativeFraction,
        subjects: [...new Set(t.questions.map((q) => q.subjectName))],
        attemptStatus: attempt?.status ?? null,
        marksObtained: attempt?.marksObtained != null ? toNumber(attempt.marksObtained) : null,
      };
    });
  }

  async start(user: TokenPayload, testId: string) {
    const student = await this.requireStudentRow(user);
    const test = await this.enrolledTest(student.branchId, student.courses.map((c) => c.courseId), testId);
    let attempt = await prisma.testAttempt.findUnique({
      where: { studentId_testId: { studentId: student.id, testId } },
    });
    if (attempt && (attempt.status === "SUBMITTED" || attempt.status === "AUTO_SUBMITTED")) {
      throw new AppError(409, "You have already submitted this test");
    }
    if (!attempt) {
      attempt = await prisma.testAttempt.create({
        data: {
          studentId: student.id,
          testId,
          startedAt: new Date(),
          remainingSeconds: test.durationMinutes * 60,
          answers: [],
          warningCount: 0,
        },
      });
    }
    const remainingSeconds = remainingFromStart(attempt.startedAt, test.durationMinutes);
    if (remainingSeconds <= 0) {
      return this.finalize(attempt.id, asAnswers(attempt.answers), true);
    }
    await prisma.testAttempt.update({
      where: { id: attempt.id },
      data: { remainingSeconds },
    });
    return {
      attemptId: attempt.id,
      testId: test.id,
      name: test.name,
      courseName: test.course.name,
      durationMinutes: test.durationMinutes,
      remainingSeconds,
      totalMarks: test.totalMarks,
      questionCount: test.questionCount,
      negativeEnabled: test.negativeEnabled,
      negativeFraction: test.negativeFraction,
      warningCount: attempt.warningCount,
      startedAt: attempt.startedAt,
      questions: test.questions.map(publicQuestion),
    };
  }

  async heartbeat(
    user: TokenPayload,
    testId: string,
    body: { remainingSeconds?: number; answers?: AnswerPayload[]; warningCount?: number },
  ) {
    const { attempt, test } = await this.inProgressAttempt(user, testId);
    const remainingSeconds = remainingFromStart(attempt.startedAt, test.durationMinutes);
    if (remainingSeconds <= 0) {
      return this.finalize(attempt.id, body.answers ?? asAnswers(attempt.answers), true);
    }
    const data: Prisma.TestAttemptUpdateInput = { remainingSeconds };
    if (body.answers) data.answers = body.answers as unknown as Prisma.InputJsonValue;
    if (typeof body.warningCount === "number") data.warningCount = Math.max(0, body.warningCount);
    await prisma.testAttempt.update({ where: { id: attempt.id }, data });
    return { remainingSeconds, warningCount: body.warningCount ?? attempt.warningCount };
  }

  async submit(user: TokenPayload, testId: string, body: { answers?: AnswerPayload[]; auto?: boolean }) {
    const { attempt } = await this.inProgressAttempt(user, testId);
    return this.finalize(attempt.id, body.answers ?? asAnswers(attempt.answers), Boolean(body.auto));
  }

  async result(user: TokenPayload, testId: string) {
    const student = await this.requireStudentRow(user);
    const attempt = await prisma.testAttempt.findUnique({
      where: { studentId_testId: { studentId: student.id, testId } },
      include: {
        test: { include: { questions: true, course: true } },
        student: { select: { fullName: true } },
      },
    });
    if (!attempt || (attempt.status !== "SUBMITTED" && attempt.status !== "AUTO_SUBMITTED")) {
      throw new AppError(404, "Result not found");
    }
    return this.buildResult(attempt);
  }

  async review(user: TokenPayload, testId: string) {
    const student = await this.requireStudentRow(user);
    const attempt = await prisma.testAttempt.findUnique({
      where: { studentId_testId: { studentId: student.id, testId } },
      include: { test: { include: { questions: { orderBy: { sortOrder: "asc" } }, course: true } } },
    });
    if (!attempt || (attempt.status !== "SUBMITTED" && attempt.status !== "AUTO_SUBMITTED")) {
      throw new AppError(404, "Result not found");
    }
    const answers = asAnswers(attempt.answers);
    const byId = new Map(answers.map((a) => [a.questionId, a]));
    return {
      id: attempt.test.id,
      name: attempt.test.name,
      courseName: attempt.test.course.name,
      durationMinutes: attempt.test.durationMinutes,
      questions: attempt.test.questions.map((q) => {
        const ans = byId.get(q.id);
        return {
          ...publicQuestion(q),
          correctIndex: q.correctIndex,
          selectedIndex: ans?.selectedIndex ?? null,
          answerDescription: q.answerDescription,
          secondsSpent: ans?.secondsSpent ?? 0,
          markedForReview: Boolean(ans?.markedForReview),
        };
      }),
    };
  }

  private async enrolledTest(branchId: string, courseIds: string[], testId: string) {
    const test = await prisma.test.findFirst({
      where: { id: testId, branchId, courseId: { in: courseIds }, ...ALIVE },
      include: {
        course: { select: { id: true, name: true } },
        questions: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!test) throw new AppError(404, "Test not found");
    return test;
  }

  private async inProgressAttempt(user: TokenPayload, testId: string) {
    const student = await this.requireStudentRow(user);
    const attempt = await prisma.testAttempt.findUnique({
      where: { studentId_testId: { studentId: student.id, testId } },
    });
    if (!attempt) throw new AppError(404, "Attempt not found");
    const test = await this.enrolledTest(student.branchId, student.courses.map((c) => c.courseId), testId);
    if (attempt.status !== "IN_PROGRESS") {
      throw new AppError(409, "This test is already submitted");
    }
    return { student, attempt, test };
  }

  private score(questions: Array<{ id: string; correctIndex: number }>, answers: AnswerPayload[], negativeEnabled: boolean, fraction: NegativeFraction | null) {
    const penalty = negativeEnabled ? negativeValue(fraction) : 0;
    const byId = new Map(answers.map((a) => [a.questionId, a]));
    let marks = 0;
    for (const q of questions) {
      const selected = byId.get(q.id)?.selectedIndex ?? null;
      if (selected == null) continue;
      if (selected === q.correctIndex) marks += 1;
      else marks -= penalty;
    }
    return roundMarks(marks);
  }

  private rankAttempts(
    attempts: Array<{
      id: string;
      startedAt: Date;
      submittedAt: Date | null;
      remainingSeconds: number;
      marksObtained: Prisma.Decimal | null;
      status: AttemptStatus;
      student: { id: string; fullName: string };
    }>,
    durationMinutes: number,
  ) {
    const rows = attempts.map((a) => {
      const timeSpentSeconds =
        a.submittedAt != null
          ? Math.max(0, Math.round((a.submittedAt.getTime() - a.startedAt.getTime()) / 1000))
          : Math.max(0, durationMinutes * 60 - a.remainingSeconds);
      return {
        id: a.id,
        studentId: a.student.id,
        studentName: a.student.fullName,
        marksObtained: a.marksObtained != null ? toNumber(a.marksObtained) : 0,
        timeSpentSeconds,
        status: a.status,
      };
    });
    rows.sort((a, b) => b.marksObtained - a.marksObtained || a.timeSpentSeconds - b.timeSpentSeconds);
    return rows.map((row, i) => ({ ...row, rank: i + 1 }));
  }

  private async finalize(attemptId: string, answers: AnswerPayload[], auto: boolean) {
    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: { test: { include: { questions: true, course: true } }, student: { select: { fullName: true } } },
    });
    if (!attempt) throw new AppError(404, "Attempt not found");
    if (attempt.status !== "IN_PROGRESS") {
      return this.buildResult(attempt);
    }
    const submittedAt = new Date();
    const remainingSeconds = remainingFromStart(attempt.startedAt, attempt.test.durationMinutes);
    const marks = this.score(
      attempt.test.questions,
      answers,
      attempt.test.negativeEnabled,
      attempt.test.negativeFraction,
    );
    const updated = await prisma.testAttempt.update({
      where: { id: attemptId },
      data: {
        submittedAt,
        remainingSeconds,
        answers: answers as unknown as Prisma.InputJsonValue,
        marksObtained: marks,
        status: auto ? "AUTO_SUBMITTED" : "SUBMITTED",
      },
      include: { test: { include: { questions: true, course: true } }, student: { select: { fullName: true } } },
    });
    return this.buildResult(updated);
  }

  private async buildResult(attempt: {
    id: string;
    studentId: string;
    startedAt: Date;
    submittedAt: Date | null;
    remainingSeconds: number;
    answers: Prisma.JsonValue;
    marksObtained: Prisma.Decimal | null;
    status: AttemptStatus;
    student: { fullName: string };
    test: {
      id: string;
      name: string;
      durationMinutes: number;
      totalMarks: number;
      negativeEnabled: boolean;
      negativeFraction: NegativeFraction | null;
      questions: Array<{
        id: string;
        subjectName: string;
        correctIndex: number;
      }>;
      course: { name: string };
    };
  }) {
    const others = await prisma.testAttempt.findMany({
      where: { testId: attempt.test.id, status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] } },
      include: { student: { select: { id: true, fullName: true } } },
    });
    const ranked = this.rankAttempts(others, attempt.test.durationMinutes);
    const mine = ranked.find((r) => r.studentId === attempt.studentId);
    const answers = asAnswers(attempt.answers);
    const byId = new Map(answers.map((a) => [a.questionId, a]));
    const subjectMap = new Map<
      string,
      { subjectName: string; total: number; attempted: number; wrong: number; marks: number }
    >();
    const penalty = attempt.test.negativeEnabled ? negativeValue(attempt.test.negativeFraction) : 0;
    for (const q of attempt.test.questions) {
      const row = subjectMap.get(q.subjectName) ?? {
        subjectName: q.subjectName,
        total: 0,
        attempted: 0,
        wrong: 0,
        marks: 0,
      };
      row.total += 1;
      const selected = byId.get(q.id)?.selectedIndex ?? null;
      if (selected != null) {
        row.attempted += 1;
        if (selected === q.correctIndex) row.marks += 1;
        else {
          row.wrong += 1;
          row.marks -= penalty;
        }
      }
      subjectMap.set(q.subjectName, row);
    }
    const timeSpentSeconds =
      attempt.submittedAt != null
        ? Math.max(0, Math.round((attempt.submittedAt.getTime() - attempt.startedAt.getTime()) / 1000))
        : Math.max(0, attempt.test.durationMinutes * 60 - attempt.remainingSeconds);
    return {
      testId: attempt.test.id,
      name: attempt.test.name,
      courseName: attempt.test.course.name,
      status: attempt.status,
      marksObtained: attempt.marksObtained != null ? toNumber(attempt.marksObtained) : 0,
      totalMarks: attempt.test.totalMarks,
      rank: mine?.rank ?? ranked.length,
      totalAttempts: ranked.length,
      timeSpentSeconds,
      subjects: [...subjectMap.values()].map((s) => ({ ...s, marks: roundMarks(s.marks) })),
      top10: ranked.slice(0, 10),
    };
  }
}

export const testService = new TestService();
