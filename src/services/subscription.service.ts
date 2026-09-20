import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { TokenPayload } from "../lib/jwt";
import { parsePagination, paginated } from "../lib/pagination";
import { addMonths, startOfDay } from "../lib/files";
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_MANAGER_PASSWORD,
  DEFAULT_STUDENT_PASSWORD,
  DEFAULT_TEACHER_PASSWORD,
  hashPassword,
} from "../lib/password";
import { revokeAllRefreshTokens } from "../lib/refresh-token";
import {
  addDays,
  extendFrom,
  EXTEND_MONTHS,
  ExtendMonths,
  revokeCompanySessions,
  toSubscriptionDto,
} from "../lib/subscription";

const ROLE_ORDER: Record<string, number> = { ADMIN: 0, TEACHER: 1, STUDENT: 2, MANAGER: 3 };

export class SubscriptionService {
  async mine(user: TokenPayload) {
    const company = await prisma.company.findUnique({ where: { id: user.companyId } });
    if (!company) throw new AppError(404, "Company not found");
    return { items: [toSubscriptionDto(company)] };
  }

  async listAdmins(query: {
    page?: string;
    pageSize?: string;
    search?: string;
    ending?: "15d" | "1m" | "2m";
    sort?: "endingSoon" | "newest";
  }) {
    const { page, pageSize, skip, take } = parsePagination(query, 50);
    const q = query.search?.trim();
    const now = startOfDay(new Date());
    const endingUntil =
      query.ending === "15d"
        ? addDays(now, 15)
        : query.ending === "1m"
          ? addMonths(now, 1)
          : query.ending === "2m"
            ? addMonths(now, 2)
            : undefined;

    const where = {
      ...(q
        ? {
            OR: [
              { firstName: { contains: q } },
              { lastName: { contains: q } },
              { email: { contains: q } },
              { username: { contains: q } },
              { company: { name: { contains: q } } },
              { company: { ownerName: { contains: q } } },
            ],
          }
        : {}),
      ...(endingUntil
        ? {
            company: {
              subscriptionEndAt: { gte: now, lte: endingUntil },
            },
          }
        : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        include: { company: true },
        skip,
        take: 500,
      }),
      prisma.user.count({ where }),
    ]);

    const ordered = rows.sort((a, b) => {
      const roleDiff = (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9);
      if (roleDiff !== 0) return roleDiff;
      if (query.sort === "newest") return b.createdAt.getTime() - a.createdAt.getTime();
      return a.company.subscriptionEndAt.getTime() - b.company.subscriptionEndAt.getTime();
    });
    const pageRows = ordered.slice(skip, skip + take);

    return paginated(
      pageRows.map((row) => ({
        userId: row.id,
        role: row.role,
        email: row.email,
        username: row.username,
        ...toSubscriptionDto(row.company),
        ownerName: `${row.firstName} ${row.lastName}`.trim() || row.company.ownerName,
        phone: row.phone || row.company.phone,
        canExtend: row.role === "ADMIN",
      })),
      total,
      page,
      pageSize,
    );
  }

  async extend(companyId: string, months: number) {
    if (!EXTEND_MONTHS.includes(months as ExtendMonths)) {
      throw new AppError(400, "Invalid extension period");
    }
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new AppError(404, "Company not found");
    const now = new Date();
    const updated = await prisma.company.update({
      where: { id: companyId },
      data: {
        subscriptionStartAt: now,
        subscriptionEndAt: extendFrom(company.subscriptionEndAt, months, now),
      },
    });
    return toSubscriptionDto(updated);
  }

  async setActive(companyId: string, active: boolean) {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new AppError(404, "Company not found");
    const updated = await prisma.company.update({
      where: { id: companyId },
      data: { active },
    });
    if (!active) {
      await revokeCompanySessions(companyId);
    }
    return toSubscriptionDto(updated);
  }

  async resetAdminPassword(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError(404, "User not found");
    }
    const password =
      user.role === "TEACHER"
        ? DEFAULT_TEACHER_PASSWORD
        : user.role === "STUDENT"
          ? DEFAULT_STUDENT_PASSWORD
          : user.role === "MANAGER"
            ? DEFAULT_MANAGER_PASSWORD
            : DEFAULT_ADMIN_PASSWORD;
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password) },
    });
    await revokeAllRefreshTokens(userId);
    return { reset: true };
  }
}

export const subscriptionService = new SubscriptionService();
