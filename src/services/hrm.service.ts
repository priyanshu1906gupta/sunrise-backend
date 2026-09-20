import { AttendanceStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { TokenPayload } from "../lib/jwt";
import { assertBranchAccess, managerBranchId } from "../middleware/auth";
import { parsePagination, paginated } from "../lib/pagination";
import { toNumber } from "../lib/files";
import { ALIVE } from "../lib/soft-delete";
import {
  addCalendarMonth,
  clampMonth,
  compareMonth,
  daysInMonth,
  monthEndUtc,
  monthStartUtc,
  payableFromStatuses,
  resolveCell,
  todayYmdLocal,
  utcFromYmd,
  ymdFromDateOnly,
  ymdFromUtc,
  type ManualAttendance,
} from "../lib/attendance";

function canEditEmployee(user: TokenPayload, employeeUserId: string | null): boolean {
  if (user.role === "ADMIN") return true;
  return employeeUserId !== user.id;
}

export class HrmService {
  async settings(user: TokenPayload) {
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { sundayWeekend: true },
    });
    if (!company) throw new AppError(404, "Company not found");
    return { sundayWeekend: company.sundayWeekend };
  }

  async setSundayWeekend(user: TokenPayload, sundayWeekend: boolean) {
    await prisma.company.update({
      where: { id: user.companyId },
      data: { sundayWeekend },
    });
    return { sundayWeekend };
  }

  async list(
    user: TokenPayload,
    query: { year?: string; month?: string; search?: string; branchId?: string; page?: string; pageSize?: string },
  ) {
    const todayYmd = todayYmdLocal();
    const today = utcFromYmd(todayYmd);
    const maxMonth = addCalendarMonth(today.getUTCFullYear(), today.getUTCMonth() + 1, 1);
    const branchId = managerBranchId(user, query.branchId);
    const employeeWhere: Prisma.EmployeeWhereInput = {
      ...ALIVE,
      branch: { companyId: user.companyId },
      ...(branchId ? { branchId } : {}),
    };
    if (query.search?.trim()) {
      employeeWhere.fullName = { contains: query.search.trim() };
    }

    const earliest = await prisma.employee.findFirst({
      where: employeeWhere,
      orderBy: { joiningDate: "asc" },
      select: { joiningDate: true },
    });
    const minMonth = earliest
      ? (() => {
          const ymd = ymdFromDateOnly(earliest.joiningDate);
          const [y, m] = ymd.split("-").map(Number);
          return { year: y, month: m };
        })()
      : { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };

    const yearNum = Number(query.year);
    const monthNum = Number(query.month);
    const requested = {
      year: Number.isInteger(yearNum) && yearNum > 0 ? yearNum : today.getUTCFullYear(),
      month: Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12 ? monthNum : today.getUTCMonth() + 1,
    };
    if (!Number.isInteger(requested.year) || !Number.isInteger(requested.month) || requested.month < 1 || requested.month > 12) {
      throw new AppError(400, "Invalid month");
    }
    const { year, month } = clampMonth(requested, minMonth, maxMonth);

    const start = monthStartUtc(year, month);
    const end = monthEndUtc(year, month);
    const { page, pageSize, skip, take } = parsePagination(query, 50);
    const where: Prisma.EmployeeWhereInput = {
      ...employeeWhere,
      joiningDate: { lte: end },
    };

    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { sundayWeekend: true },
    });
    const sundayWeekend = company?.sundayWeekend ?? false;

    const [rows, total] = await prisma.$transaction([
      prisma.employee.findMany({
        where,
        skip,
        take,
        orderBy: { fullName: "asc" },
        include: { branch: { select: { id: true, name: true } } },
      }),
      prisma.employee.count({ where }),
    ]);

    const ids = rows.map((r) => r.id);
    const marks = ids.length
      ? await prisma.employeeAttendance.findMany({
          where: { employeeId: { in: ids }, date: { gte: start, lte: end } },
        })
      : [];
    const byKey = new Map(marks.map((m) => [`${m.employeeId}:${ymdFromDateOnly(m.date)}`, m.status]));

    const dayCount = daysInMonth(year, month);
    const days = Array.from({ length: dayCount }, (_, i) => {
      const date = new Date(Date.UTC(year, month - 1, i + 1));
      const dateYmd = ymdFromUtc(date);
      return {
        date: dateYmd,
        day: i + 1,
        weekday: date.getUTCDay(),
        isSunday: date.getUTCDay() === 0,
        isToday: dateYmd === todayYmd,
        isFuture: dateYmd > todayYmd,
      };
    });

    const items = rows.map((row) => {
      const joiningYmd = ymdFromDateOnly(row.joiningDate);
      const canEdit = canEditEmployee(user, row.userId);
      const cells = days.map((day) => {
        const resolved = resolveCell({
          dateYmd: day.date,
          joiningYmd,
          todayYmd,
          sundayWeekend,
          stored: byKey.get(`${row.id}:${day.date}`),
          canEdit,
        });
        return {
          date: day.date,
          status: resolved.status,
          locked: resolved.locked,
          lockReason: resolved.lockReason,
          isFuture: resolved.isFuture,
        };
      });
      const salary = toNumber(row.salary);
      return {
        id: row.id,
        fullName: row.fullName,
        role: row.role,
        branchId: row.branchId,
        branchName: row.branch.name,
        joiningDate: joiningYmd,
        userId: row.userId,
        canEdit,
        salary,
        payable: payableFromStatuses(
          salary,
          cells.map((c) => c.status),
        ),
        cells,
      };
    });

    return {
      year,
      month,
      sundayWeekend,
      minYearMonth: minMonth,
      maxYearMonth: maxMonth,
      days,
      ...paginated(items, total, page, pageSize),
    };
  }

  async updateAttendance(
    user: TokenPayload,
    input: { employeeId: string; date: Date; status: ManualAttendance | null },
  ) {
    const employee = await prisma.employee.findUnique({
      where: { id: input.employeeId },
      include: { branch: { select: { companyId: true, name: true } } },
    });
    if (!employee || employee.branch.companyId !== user.companyId || employee.deletedAt) {
      throw new AppError(404, "Employee not found");
    }
    await assertBranchAccess(user, employee.branchId);
    if (!canEditEmployee(user, employee.userId)) {
      throw new AppError(403, "You cannot mark your own attendance");
    }

    const dateYmd = ymdFromDateOnly(input.date);
    const dateUtc = utcFromYmd(dateYmd);
    const todayYmd = todayYmdLocal();
    const today = utcFromYmd(todayYmd);
    const maxMonth = addCalendarMonth(today.getUTCFullYear(), today.getUTCMonth() + 1, 1);
    const cellMonth = { year: dateUtc.getUTCFullYear(), month: dateUtc.getUTCMonth() + 1 };
    if (compareMonth(cellMonth, maxMonth) > 0) {
      throw new AppError(400, "Future months are not available");
    }
    const joiningYmd = ymdFromDateOnly(employee.joiningDate);
    if (dateYmd < joiningYmd) {
      throw new AppError(400, "Cannot mark attendance before joining date");
    }

    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { sundayWeekend: true },
    });
    const sundayWeekend = company?.sundayWeekend ?? false;
    if (sundayWeekend && dateUtc.getUTCDay() === 0) {
      throw new AppError(400, "Sunday is marked as weekend");
    }

    const isFuture = dateYmd > todayYmd;
    if (isFuture && input.status === "AVAILABLE") {
      throw new AppError(400, "Cannot mark available on a future date");
    }
    if (!isFuture && input.status == null) {
      throw new AppError(400, "Attendance is required through today");
    }

    if (input.status == null) {
      await prisma.employeeAttendance.deleteMany({
        where: { employeeId: employee.id, date: dateUtc },
      });
    } else {
      await prisma.employeeAttendance.upsert({
        where: { employeeId_date: { employeeId: employee.id, date: dateUtc } },
        create: { employeeId: employee.id, date: dateUtc, status: input.status },
        update: { status: input.status },
      });
    }

    const start = monthStartUtc(cellMonth.year, cellMonth.month);
    const end = monthEndUtc(cellMonth.year, cellMonth.month);
    const marks = await prisma.employeeAttendance.findMany({
      where: { employeeId: employee.id, date: { gte: start, lte: end } },
    });
    const byDate = new Map(marks.map((m) => [ymdFromDateOnly(m.date), m.status]));
    const dayCount = daysInMonth(cellMonth.year, cellMonth.month);
    const statuses: Array<AttendanceStatus | null> = [];
    let cellStatus: AttendanceStatus | null = input.status;
    let locked = false;
    let lockReason: "beforeJoin" | "weekend" | "readonly" | null = null;
    for (let day = 1; day <= dayCount; day += 1) {
      const ymd = ymdFromUtc(new Date(Date.UTC(cellMonth.year, cellMonth.month - 1, day)));
      const resolved = resolveCell({
        dateYmd: ymd,
        joiningYmd,
        todayYmd,
        sundayWeekend,
        stored: byDate.get(ymd),
        canEdit: true,
      });
      statuses.push(resolved.status);
      if (ymd === dateYmd) {
        cellStatus = resolved.status;
        locked = resolved.locked;
        lockReason = resolved.lockReason;
      }
    }

    const salary = toNumber(employee.salary);
    return {
      employeeId: employee.id,
      salary,
      payable: payableFromStatuses(salary, statuses),
      cell: {
        date: dateYmd,
        status: cellStatus,
        locked,
        lockReason,
        isFuture,
      },
    };
  }
}

export const hrmService = new HrmService();
