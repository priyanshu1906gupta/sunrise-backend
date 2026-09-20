import bcrypt from "bcryptjs";

const ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;
export const PASSWORD_MESSAGE =
  "Password must include uppercase, lowercase, number, and special character";

export const DEFAULT_MANAGER_PASSWORD = "Manager@123";
export const DEFAULT_ADMIN_PASSWORD = "Admin@123";
export const DEFAULT_TEACHER_PASSWORD = "Sunriseteacher@123";
export const DEFAULT_STUDENT_PASSWORD = "student@123";
