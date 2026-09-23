import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { TokenPayload } from "../lib/jwt";
import { assertBranchAccess, managerBranchId } from "../middleware/auth";
import { parsePagination, paginated } from "../lib/pagination";
import { toNumber } from "../lib/files";
import { fileService } from "./file.service";
import { DEFAULT_MANAGER_PASSWORD, DEFAULT_TEACHER_PASSWORD, hashPassword } from "../lib/password";
import { revokeAllRefreshTokens } from "../lib/refresh-token";
import { Employee, Prisma } from "@prisma/client";
import { ALIVE } from "../lib/soft-delete";

function emptyToNull(v?: string | null) {
  if (v == null || v === "") return null;
  return v;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "Manager";
  const lastName = parts.slice(1).join(" ") || firstName;
  return { firstName, lastName };
}

export class EmployeeService {
  async list(
    user: TokenPayload,
    query: { page?: string; pageSize?: string; search?: string; branchId?: string; role?: string },
  ) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const branchId = managerBranchId(user, query.branchId);
    const where: Record<string, unknown> = {
      ...ALIVE,
      branch: { companyId: user.companyId },
    };
    if (branchId) where.branchId = branchId;
    if (query.role === "MANAGER" || query.role === "TEACHER" || query.role === "STAFF") {
      where.role = query.role;
    }
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [{ fullName: { contains: q } }, { phone: { contains: q } }];
    }
    const [rows, total] = await prisma.$transaction([
      prisma.employee.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: { branch: { select: { id: true, name: true } }, subject: { select: { id: true, name: true } } },
      }),
      prisma.employee.count({ where }),
    ]);
    const urls = await fileService.getUrls(rows.map((r) => r.photoFileId));
    return paginated(
      rows.map((r) => this.toListDto(r, urls.get(r.photoFileId ?? "") ?? null)),
      total,
      page,
      pageSize,
    );
  }

  async get(user: TokenPayload, id: string) {
    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        branch: true,
        subject: true,
        salaries: { orderBy: { paymentDate: "desc" } },
      },
    });
    if (!employee || employee.branch.companyId !== user.companyId || employee.deletedAt) {
      throw new AppError(404, "Employee not found");
    }
    await assertBranchAccess(user, employee.branchId);
    const urls = await fileService.getUrls([employee.photoFileId, employee.aadhaarFileId]);
    const dto = {
      ...this.toListDto(employee, urls.get(employee.photoFileId ?? "") ?? null),
      gender: employee.gender,
      salary: toNumber(employee.salary),
      salaryDate: employee.salaryDate,
      joiningDate: employee.joiningDate,
      email: employee.email,
      emergencyContact: employee.emergencyContact,
      address: employee.address,
      aadhaarFileId: employee.aadhaarFileId,
      aadhaarUrl: urls.get(employee.aadhaarFileId ?? "") ?? null,
      salaries: employee.salaries.map((s) => ({
        id: s.id,
        amount: toNumber(s.amount),
        paymentDate: s.paymentDate,
      })),
    };
    if (user.role === "TEACHER") {
      const { salary: _salary, salaryDate: _salaryDate, salaries: _salaries, ...safe } = dto;
      return { ...safe, salaries: [] };
    }
    return dto;
  }

  async create(
    user: TokenPayload,
    data: {
      photoFileId?: string | null;
      fullName: string;
      gender: "MALE" | "FEMALE" | "OTHER";
      role: "MANAGER" | "TEACHER" | "STAFF";
      salary: number;
      salaryDate: Date;
      joiningDate: Date;
      email?: string | null;
      phone: string;
      emergencyContact?: string | null;
      address?: string | null;
      aadhaarFileId?: string | null;
      subjectId?: string | null;
      branchId?: string;
    },
  ) {
    const branchId = user.role === "MANAGER" ? user.branchId : data.branchId;
    if (!branchId) throw new AppError(400, "branchId is required");
    await assertBranchAccess(user, branchId);
    const email = emptyToNull(data.email);
    if ((data.role === "MANAGER" || data.role === "TEACHER") && !email) {
      throw new AppError(400, "Email is required for a manager or teacher");
    }

    const employee = await prisma.$transaction(async (tx) => {
      const userId =
        data.role === "MANAGER" || data.role === "TEACHER"
          ? await this.assignLoginUser(tx, {
              companyId: user.companyId,
              branchId,
              email: email!,
              fullName: data.fullName,
              phone: data.phone,
              role: data.role,
            })
          : null;
      return tx.employee.create({
        data: {
          branchId,
          userId,
          photoFileId: data.photoFileId,
          fullName: data.fullName,
          gender: data.gender,
          role: data.role,
          salary: data.salary,
          salaryDate: data.salaryDate,
          joiningDate: data.joiningDate,
          email,
          phone: data.phone,
          emergencyContact: emptyToNull(data.emergencyContact),
          address: emptyToNull(data.address),
          aadhaarFileId: data.aadhaarFileId,
          subjectId: emptyToNull(data.subjectId),
        },
      });
    });
    return this.get(user, employee.id);
  }

  async update(user: TokenPayload, id: string, data: Record<string, unknown>) {
    const existing = await prisma.employee.findUnique({
      where: { id },
      include: { branch: true },
    });
    if (!existing || existing.branch.companyId !== user.companyId || existing.deletedAt) {
      throw new AppError(404, "Employee not found");
    }
    await assertBranchAccess(user, existing.branchId);
    const nextRole = (data.role as "MANAGER" | "TEACHER" | "STAFF" | undefined) ?? existing.role;
    const nextEmail = data.email !== undefined ? emptyToNull(data.email as string) : existing.email;
    const nextName = (data.fullName as string | undefined) ?? existing.fullName;
    const nextPhone = (data.phone as string | undefined) ?? existing.phone;
    if ((nextRole === "MANAGER" || nextRole === "TEACHER") && !nextEmail) {
      throw new AppError(400, "Email is required for a manager or teacher");
    }

    await prisma.$transaction(async (tx) => {
      let userId: string | null | undefined = existing.userId;
      const hadLogin = existing.role === "MANAGER" || existing.role === "TEACHER";
      const needsLogin = nextRole === "MANAGER" || nextRole === "TEACHER";
      if (hadLogin && !needsLogin) {
        await this.unassignLogin(tx, existing);
        userId = null;
      } else if (needsLogin) {
        userId = await this.assignLoginUser(tx, {
          companyId: user.companyId,
          branchId: existing.branchId,
          email: nextEmail!,
          fullName: nextName,
          phone: nextPhone,
          role: nextRole,
          existingUserId: existing.userId,
        });
      }
      await tx.employee.update({
        where: { id },
        data: {
          photoFileId: data.photoFileId as string | null | undefined,
          fullName: data.fullName as string | undefined,
          gender: data.gender as never,
          role: nextRole,
          userId,
          salary: data.salary != null ? Number(data.salary) : undefined,
          salaryDate: data.salaryDate ? new Date(data.salaryDate as string) : undefined,
          joiningDate: data.joiningDate ? new Date(data.joiningDate as string) : undefined,
          email: data.email !== undefined ? nextEmail : undefined,
          phone: data.phone as string | undefined,
          emergencyContact:
            data.emergencyContact !== undefined ? emptyToNull(data.emergencyContact as string) : undefined,
          address: data.address !== undefined ? emptyToNull(data.address as string) : undefined,
          aadhaarFileId: data.aadhaarFileId as string | null | undefined,
          subjectId: data.subjectId !== undefined ? emptyToNull(data.subjectId as string) : undefined,
        },
      });
    });
    await fileService.replace(
      user,
      existing.photoFileId,
      data.photoFileId !== undefined ? (data.photoFileId as string | null) : existing.photoFileId,
    );
    await fileService.replace(
      user,
      existing.aadhaarFileId,
      data.aadhaarFileId !== undefined ? (data.aadhaarFileId as string | null) : existing.aadhaarFileId,
    );
    return this.get(user, id);
  }

  async remove(user: TokenPayload, id: string) {
    const existing = await prisma.employee.findUnique({
      where: { id },
      include: { branch: true },
    });
    if (!existing || existing.branch.companyId !== user.companyId || existing.deletedAt) {
      throw new AppError(404, "Employee not found");
    }
    await assertBranchAccess(user, existing.branchId);
    await prisma.$transaction(async (tx) => {
      if (existing.role === "MANAGER" || existing.role === "TEACHER") {
        await this.unassignLogin(tx, existing);
      }
      await tx.employee.update({ where: { id }, data: { deletedAt: new Date(), userId: null } });
    });
    await fileService.removeIfUnused(user, existing.photoFileId);
    await fileService.removeIfUnused(user, existing.aadhaarFileId);
    return null;
  }

  async setLoginStatus(user: TokenPayload, id: string, status: "ACTIVE" | "INACTIVE") {
    if (user.role !== "ADMIN" && user.role !== "MANAGER") {
      throw new AppError(403, "You do not have access to this resource");
    }
    const existing = await prisma.employee.findUnique({
      where: { id },
      include: { branch: true },
    });
    if (!existing || existing.branch.companyId !== user.companyId || existing.deletedAt) {
      throw new AppError(404, "Employee not found");
    }
    if (existing.role !== "TEACHER") {
      throw new AppError(400, "Login status can only be changed for teachers");
    }
    await assertBranchAccess(user, existing.branchId);
    await prisma.employee.update({ where: { id }, data: { status } });
    if (status === "INACTIVE" && existing.userId) {
      await revokeAllRefreshTokens(existing.userId);
    }
    return this.get(user, id);
  }

  async resetManagerPassword(user: TokenPayload, id: string) {
    if (user.role !== "ADMIN") {
      throw new AppError(403, "Only admin can reset a password");
    }
    const employee = await prisma.employee.findUnique({
      where: { id },
      include: { branch: true },
    });
    if (!employee || employee.branch.companyId !== user.companyId || employee.deletedAt) {
      throw new AppError(404, "Employee not found");
    }
    if (employee.role !== "MANAGER" && employee.role !== "TEACHER") {
      throw new AppError(400, "Password reset is only available for managers and teachers");
    }
    if (!employee.userId) {
      throw new AppError(400, "This person has no login account");
    }
    const password = employee.role === "TEACHER" ? DEFAULT_TEACHER_PASSWORD : DEFAULT_MANAGER_PASSWORD;
    await prisma.user.update({
      where: { id: employee.userId },
      data: { passwordHash: await hashPassword(password) },
    });
    await revokeAllRefreshTokens(employee.userId);
    return { reset: true };
  }

  private async assignLoginUser(
    tx: Prisma.TransactionClient,
    opts: {
      companyId: string;
      branchId: string;
      email: string;
      fullName: string;
      phone: string;
      role: "MANAGER" | "TEACHER";
      existingUserId?: string | null;
    },
  ): Promise<string> {
    const email = opts.email.trim().toLowerCase();
    const { firstName, lastName } = splitName(opts.fullName);
    const password = opts.role === "TEACHER" ? DEFAULT_TEACHER_PASSWORD : DEFAULT_MANAGER_PASSWORD;

    if (opts.existingUserId) {
      const current = await tx.user.findUnique({ where: { id: opts.existingUserId } });
      if (current) {
        if ((current.email || "").toLowerCase() !== email) {
          const taken = await tx.user.findUnique({ where: { email } });
          if (taken && taken.id !== current.id) {
            throw new AppError(409, "This email is already in use");
          }
        }
        await tx.user.update({
          where: { id: current.id },
          data: {
            email,
            firstName,
            lastName,
            phone: opts.phone,
            role: opts.role,
            branchId: opts.branchId,
          },
        });
        if (opts.role === "MANAGER") {
          await tx.branch.update({ where: { id: opts.branchId }, data: { managerId: current.id } });
        }
        return current.id;
      }
    }

    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.companyId !== opts.companyId) {
        throw new AppError(409, "This email is already in use");
      }
      if (existing.role === "ADMIN") {
        throw new AppError(400, "This email belongs to the company admin");
      }
      const other = await tx.employee.findFirst({
        where: {
          userId: existing.id,
          deletedAt: null,
          ...(opts.existingUserId ? { id: { not: opts.existingUserId } } : {}),
        },
      });
      if (other) {
        throw new AppError(409, "This email is already linked to another employee");
      }
      await tx.user.update({
        where: { id: existing.id },
        data: {
          role: opts.role,
          branchId: opts.branchId,
          firstName,
          lastName,
          phone: opts.phone,
        },
      });
      if (opts.role === "MANAGER") {
        await tx.branch.update({ where: { id: opts.branchId }, data: { managerId: existing.id } });
      }
      return existing.id;
    }

    const created = await tx.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        firstName,
        lastName,
        phone: opts.phone,
        role: opts.role,
        companyId: opts.companyId,
        branchId: opts.branchId,
      },
    });
    if (opts.role === "MANAGER") {
      await tx.branch.update({ where: { id: opts.branchId }, data: { managerId: created.id } });
    }
    return created.id;
  }

  private async unassignLogin(
    tx: Prisma.TransactionClient,
    employee: Employee & { branch: { id: string; managerId: string | null } },
  ) {
    if (employee.role === "MANAGER") {
      const remaining = await tx.employee.count({
        where: { branchId: employee.branchId, role: "MANAGER", id: { not: employee.id }, deletedAt: null },
      });
      if (remaining === 0) {
        throw new AppError(400, "Each branch must have at least one manager");
      }
    }
    if (employee.userId && employee.branch.managerId === employee.userId) {
      const next = await tx.employee.findFirst({
        where: {
          branchId: employee.branchId,
          role: "MANAGER",
          id: { not: employee.id },
          userId: { not: null },
          deletedAt: null,
        },
      });
      await tx.branch.update({
        where: { id: employee.branchId },
        data: { managerId: next?.userId ?? null },
      });
    }
    if (employee.userId) {
      await tx.employee.update({ where: { id: employee.id }, data: { userId: null } });
      const login = await tx.user.findUnique({ where: { id: employee.userId } });
      if (login?.role === "MANAGER" || login?.role === "TEACHER") {
        await tx.user.delete({ where: { id: employee.userId } });
      }
    }
  }

  private toListDto(
    employee: Employee & {
      branch?: { id: string; name: string };
      subject?: { id: string; name: string } | null;
    },
    photoUrl: string | null,
  ) {
    return {
      id: employee.id,
      branchId: employee.branchId,
      branchName: employee.branch?.name,
      photoFileId: employee.photoFileId,
      photoUrl,
      fullName: employee.fullName,
      role: employee.role,
      phone: employee.phone,
      subjectId: employee.subjectId,
      subjectName: employee.subject?.name ?? null,
      status: employee.status,
    };
  }
}

export const employeeService = new EmployeeService();
