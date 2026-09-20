import { Prisma } from "@prisma/client";
import { hashPassword, DEFAULT_STUDENT_PASSWORD } from "./password";
import { AppError } from "../middleware/errorHandler";
import { formatYmd } from "./student-excel";

export function studentUsername(fullName: string, dob: Date): string {
  const name = fullName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${name || "student"}.${formatYmd(dob)}`;
}

export function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "Student";
  const lastName = parts.slice(1).join(" ") || firstName;
  return { firstName, lastName };
}

export async function upsertStudentUser(
  tx: Prisma.TransactionClient,
  opts: {
    companyId: string;
    branchId: string;
    fullName: string;
    email?: string | null;
    phone?: string | null;
    dateOfBirth?: Date | null;
    existingUserId?: string | null;
    password?: string;
  },
): Promise<{ userId: string; username: string | null; email: string | null }> {
  const email = opts.email?.trim().toLowerCase() || null;
  if (!email && !opts.dateOfBirth) {
    throw new AppError(400, "Email or date of birth is required so the student can log in");
  }
  const username = email ? null : studentUsername(opts.fullName, opts.dateOfBirth!);
  const { firstName, lastName } = splitName(opts.fullName);

  if (email) {
    const taken = await tx.user.findUnique({ where: { email } });
    if (taken && taken.id !== opts.existingUserId) {
      throw new AppError(409, "This email is already in use");
    }
  }
  if (username) {
    const taken = await tx.user.findUnique({ where: { username } });
    if (taken && taken.id !== opts.existingUserId) {
      throw new AppError(409, "This login id is already in use");
    }
  }

  if (opts.existingUserId) {
    await tx.user.update({
      where: { id: opts.existingUserId },
      data: {
        email,
        username,
        firstName,
        lastName,
        phone: opts.phone,
        role: "STUDENT",
        branchId: opts.branchId,
      },
    });
    return { userId: opts.existingUserId, username, email };
  }

  const created = await tx.user.create({
    data: {
      email,
      username,
      passwordHash: await hashPassword(opts.password || DEFAULT_STUDENT_PASSWORD),
      firstName,
      lastName,
      phone: opts.phone,
      role: "STUDENT",
      companyId: opts.companyId,
      branchId: opts.branchId,
    },
  });
  return { userId: created.id, username, email };
}

export async function studentMayLogin(tx: Prisma.TransactionClient, studentId: string): Promise<void> {
  const student = await tx.student.findUnique({
    where: { id: studentId },
    include: { batches: { include: { batch: true } } },
  });
  if (!student || student.deletedAt) {
    throw new AppError(403, "Your account is deactivated. Kindly contact the administrator.");
  }
  if (student.status !== "ACTIVE") {
    throw new AppError(403, "Your account is deactivated. Kindly contact the administrator.");
  }
  const batches = student.batches.map((row) => row.batch).filter((b) => !b.deletedAt);
  if (!batches.length) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const anyActive = batches.some((b) => new Date(b.endDate) >= today);
  if (!anyActive) {
    throw new AppError(403, "Your batch duration is over. Kindly contact the administrator.");
  }
}
