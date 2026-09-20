import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { TokenPayload } from "../lib/jwt";
import { utcFromYmd, ymdFromDateOnly } from "../lib/attendance";

function eachYmd(from: Date, to: Date): string[] {
  const start = ymdFromDateOnly(from);
  const end = ymdFromDateOnly(to);
  const days: string[] = [];
  let cursor = utcFromYmd(start);
  const last = utcFromYmd(end);
  while (cursor.getTime() <= last.getTime()) {
    days.push(ymdFromDateOnly(cursor));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return days;
}

export class LeaveService {
  async list(user: TokenPayload) {
    if (user.role !== "TEACHER") {
      throw new AppError(403, "Only teachers can view leave requests here");
    }
    const employee = await prisma.employee.findFirst({
      where: { userId: user.id, deletedAt: null },
    });
    if (!employee) throw new AppError(404, "Teacher profile not found");
    return prisma.leaveRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: "desc" },
    });
  }

  async apply(user: TokenPayload, data: { fromDate: Date; toDate: Date; reason: string }) {
    if (user.role !== "TEACHER") {
      throw new AppError(403, "Only teachers can apply for leave");
    }
    if (data.toDate < data.fromDate) {
      throw new AppError(400, "Leave end date cannot be before start date");
    }
    const employee = await prisma.employee.findFirst({
      where: { userId: user.id, deletedAt: null },
    });
    if (!employee) throw new AppError(404, "Teacher profile not found");
    const leave = await prisma.$transaction(async (tx) => {
      const created = await tx.leaveRequest.create({
        data: {
          employeeId: employee.id,
          fromDate: data.fromDate,
          toDate: data.toDate,
          reason: data.reason.trim(),
        },
      });
      for (const ymd of eachYmd(data.fromDate, data.toDate)) {
        await tx.employeeAttendance.upsert({
          where: { employeeId_date: { employeeId: employee.id, date: utcFromYmd(ymd) } },
          update: { status: "LEAVE" },
          create: { employeeId: employee.id, date: utcFromYmd(ymd), status: "LEAVE" },
        });
      }
      return created;
    });
    return leave;
  }
}

export const leaveService = new LeaveService();
