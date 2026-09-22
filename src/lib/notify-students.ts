import { NotificationType } from "@prisma/client";
import { prisma } from "./prisma";
import { startOfDay } from "./files";
import { ALIVE } from "./soft-delete";
import { pushService } from "../services/push.service";

export async function enrolledStudentUserIds(courseId: string): Promise<string[]> {
  const enrolled = await prisma.studentCourse.findMany({
    where: {
      courseId,
      student: { ...ALIVE, status: "ACTIVE", userId: { not: null } },
    },
    select: { student: { select: { userId: true } } },
  });
  return [...new Set(enrolled.map((row) => row.student.userId).filter((id): id is string => Boolean(id)))];
}

export async function branchTeacherUserIds(branchId: string, exceptUserId?: string): Promise<string[]> {
  const teachers = await prisma.employee.findMany({
    where: {
      branchId,
      role: "TEACHER",
      status: "ACTIVE",
      ...ALIVE,
      userId: { not: null },
    },
    select: { userId: true },
  });
  return [
    ...new Set(
      teachers
        .map((row) => row.userId)
        .filter((id): id is string => Boolean(id) && id !== exceptUserId),
    ),
  ];
}

export async function notifyUsers(opts: {
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  entityId: string;
  branchId: string;
  url: string;
  data?: Record<string, string>;
}): Promise<void> {
  const userIds = [...new Set(opts.userIds.filter(Boolean))];
  if (!userIds.length) return;

  const dueDate = startOfDay(new Date());
  dueDate.setHours(12, 0, 0, 0);

  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      entityId: opts.entityId,
      branchId: opts.branchId,
      dueDate,
    })),
    skipDuplicates: true,
  });

  await Promise.all(
    userIds.map((userId) =>
      pushService.notifyUser(userId, opts.title, opts.message, {
        type: opts.type,
        url: opts.url,
        ...(opts.data ?? {}),
      }),
    ),
  );
}
