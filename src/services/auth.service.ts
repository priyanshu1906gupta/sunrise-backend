import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { AppError } from "../middleware/errorHandler";
import { hashPassword, comparePassword } from "../lib/password";
import { signToken, TokenPayload } from "../lib/jwt";
import { sendMail, otpEmailTemplate } from "../lib/mailer";
import { randomOtp } from "../lib/files";
import { LoginInput, RegisterInput } from "../validators/auth.validator";
import { User } from "@prisma/client";
import { fileService } from "./file.service";
import { studentService } from "./student.service";
import { studentMayLogin } from "../lib/student-login";
import {
  findValidRefreshToken,
  issueRefreshToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
} from "../lib/refresh-token";
import { assertCompanyAccess } from "../lib/subscription";

function toAuthUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role,
    companyId: user.companyId,
    branchId: user.branchId,
  };
}

function normalizeLogin(value: string): string {
  return value.trim().toLowerCase();
}

function tokenFor(user: User): string {
  const payload: TokenPayload = {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    companyId: user.companyId,
    branchId: user.branchId,
    sessionEpoch: user.sessionEpoch,
  };
  return signToken(payload);
}

async function sessionFor(user: User) {
  return {
    token: tokenFor(user),
    refreshToken: await issueRefreshToken(user.id),
    user: toAuthUser(user),
  };
}

export class AuthService {
  async register(input: RegisterInput) {
    const email = input.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError(409, "An account with this email already exists");
    }

    const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
    const branch = company
      ? await prisma.branch.findFirst({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } })
      : null;
    if (!company || !branch) {
      throw new AppError(500, "Institute is not set up. Ask the administrator to seed the database.");
    }

    const admin: TokenPayload = {
      id: "register",
      email: company.email,
      username: null,
      role: "ADMIN",
      companyId: company.id,
      branchId: branch.id,
    };

    await studentService.create(
      admin,
      {
        fullName: `${input.firstName} ${input.lastName}`.trim(),
        gender: "OTHER",
        location: input.location,
        email,
        phone: input.phone,
        courseIds: input.courseId ? [input.courseId] : [],
        paymentDate: new Date(),
        joiningDate: new Date(),
        branchId: branch.id,
        registrationCharge: 0,
        paidAmount: 0,
        password: input.password,
        status: "INACTIVE",
      },
      { skipWriteCheck: true },
    );

    return { pendingActivation: true };
  }

  async login(input: LoginInput) {
    const login = normalizeLogin(input.email);
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: login }, { username: login }] },
      include: { company: true, student: true },
    });
    if (!user?.passwordHash) {
      throw new AppError(401, "Invalid email or password");
    }
    const ok = await comparePassword(input.password, user.passwordHash);
    if (!ok) {
      throw new AppError(401, "Invalid email or password");
    }
    assertCompanyAccess(user.company);
    if (user.role === "STUDENT") {
      if (!user.student) {
        throw new AppError(403, "Student profile not found");
      }
      await prisma.$transaction((tx) => studentMayLogin(tx, user.student!.id));
      await revokeAllRefreshTokens(user.id);
      const bumped = await prisma.user.update({
        where: { id: user.id },
        data: { sessionEpoch: { increment: 1 } },
      });
      return sessionFor(bumped);
    }
    if (user.role === "TEACHER") {
      const employee = await prisma.employee.findFirst({
        where: { userId: user.id, deletedAt: null },
      });
      if (!employee || employee.status !== "ACTIVE") {
        throw new AppError(403, "Your account is deactivated. Kindly contact the administrator.", "ACCOUNT_DEACTIVATED");
      }
    }
    return sessionFor(user);
  }

  async me(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        company: {
          include: { branches: { orderBy: { createdAt: "asc" } } },
        },
        student: true,
        employee: true,
      },
    });
    if (!user) {
      throw new AppError(404, "User not found");
    }
    const trialEndsAt = user.company.subscriptionEndAt;
    const logoUrl = await fileService.getUrl(user.company.logoFileId);
    const branches =
      user.role === "ADMIN"
        ? user.company.branches
        : user.company.branches.filter((b) => b.id === user.branchId);

    return {
      ...toAuthUser(user),
      studentId: user.student?.id ?? null,
      employeeId: user.employee?.id ?? null,
      company: {
        id: user.company.id,
        name: user.company.name,
        ownerName: user.company.ownerName,
        logoUrl,
        maxBranches: user.company.maxBranches,
        branchCount: user.company.branches.length,
        trialEndsAt,
        subscriptionStartAt: user.company.subscriptionStartAt,
        subscriptionEndAt: user.company.subscriptionEndAt,
        createdAt: user.company.createdAt,
      },
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
      })),
    };
  }

  async forgotPassword(rawEmail: string) {
    const email = normalizeLogin(rawEmail);
    const user = await prisma.user.findFirst({ where: { OR: [{ email }, { username: email }] } });
    if (!user?.email) {
      return { sent: true };
    }
    await prisma.otp.updateMany({ where: { email: user.email, used: false }, data: { used: true } });
    const code = randomOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.otp.create({ data: { email: user.email, code, expiresAt } });
    try {
      const mail = otpEmailTemplate(code);
      await sendMail(user.email, mail.subject, mail.html, { required: true, text: mail.text });
    } catch (error) {
      if (env.NODE_ENV !== "production") {
        console.log(`[otp] ${user.email} => ${code}`);
      }
      throw new AppError(503, error instanceof Error ? error.message : "Could not send email");
    }
    if (env.NODE_ENV !== "production") {
      console.log(`[otp] ${user.email} => ${code}`);
    }
    return { sent: true, expiresInSeconds: 300 };
  }

  async verifyOtp(rawEmail: string, otp: string) {
    const user = await this.findByLogin(rawEmail);
    await this.requireValidOtp(user.email ?? normalizeLogin(rawEmail), otp);
    return { valid: true };
  }

  async resetPassword(rawEmail: string, otp: string, password: string) {
    const user = await this.findByLogin(rawEmail);
    if (!user.email) throw new AppError(400, "This account has no email for password reset");
    const record = await this.requireValidOtp(user.email, otp);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password) },
      }),
      prisma.otp.update({ where: { id: record.id }, data: { used: true } }),
    ]);
    return { reset: true };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError(404, "User not found");
    }
    if (!user.passwordHash) {
      throw new AppError(400, "This account has no password. Use forgot password to set one.");
    }
    const ok = await comparePassword(oldPassword, user.passwordHash);
    if (!ok) {
      throw new AppError(400, "Current password is incorrect");
    }
    if (oldPassword === newPassword) {
      throw new AppError(400, "New password must be different from the current password");
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    await revokeAllRefreshTokens(userId);
    return { updated: true };
  }

  async refresh(refreshToken: string) {
    const row = await findValidRefreshToken(refreshToken);
    if (!row) {
      throw new AppError(401, "Session expired. Please log in again.", "SESSION_EXPIRED");
    }
    const company = await prisma.company.findUnique({ where: { id: row.user.companyId } });
    assertCompanyAccess(company);
    const next = await rotateRefreshToken(row.userId, refreshToken);
    return {
      token: tokenFor(row.user),
      refreshToken: next,
      user: toAuthUser(row.user),
    };
  }

  async logout(refreshToken?: string) {
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    return { loggedOut: true };
  }

  async publicCourses() {
    const branch = await prisma.branch.findFirst({ orderBy: { createdAt: "asc" } });
    if (!branch) return [];
    const courses = await prisma.course.findMany({
      where: { branchId: branch.id, deletedAt: null },
      orderBy: { name: "asc" },
    });
    return courses.map((c) => ({ id: c.id, name: c.name, durationMonths: c.durationMonths, price: Number(c.price) }));
  }

  async publicBranding() {
    const company = await prisma.company.findFirst({
      orderBy: { createdAt: "asc" },
      include: { images: { orderBy: { sortOrder: "asc" } } },
    });
    if (!company) {
      return { logoUrl: null as string | null, loginImages: [] as string[] };
    }
    const urls = await fileService.getUrls([company.logoFileId, ...company.images.map((i) => i.fileId)]);
    return {
      logoUrl: urls.get(company.logoFileId ?? "") ?? null,
      loginImages: company.images.map((i) => urls.get(i.fileId)).filter((url): url is string => Boolean(url)),
    };
  }

  private async findByLogin(raw: string) {
    const login = normalizeLogin(raw);
    const user = await prisma.user.findFirst({ where: { OR: [{ email: login }, { username: login }] } });
    if (!user) throw new AppError(404, "User not found");
    return user;
  }

  private async requireValidOtp(email: string, otp: string) {
    const record = await prisma.otp.findFirst({
      where: { email, code: otp, used: false },
      orderBy: { createdAt: "desc" },
    });
    if (!record || record.expiresAt < new Date()) {
      throw new AppError(400, "Invalid or expired OTP");
    }
    return record;
  }
}
