import { z } from "zod";
import { PASSWORD_REGEX, PASSWORD_MESSAGE } from "../lib/password";

export const registerSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().min(1, "Last name is required").max(100),
  email: z.string().email(),
  phone: z.string().min(8, "Mobile is required").max(20),
  location: z.string().max(200).optional().nullable(),
  courseId: z.string().uuid().optional(),
  password: z.string().min(8, "Password must be at least 8 characters").regex(PASSWORD_REGEX, PASSWORD_MESSAGE),
});

export const loginSchema = z.object({
  email: z.string().min(1, "Email or username is required"),
  password: z.string().min(1, "Password is required"),
});

const emailField = z.string().trim().toLowerCase();

export const forgotPasswordSchema = z.object({
  email: emailField.min(1),
});

export const verifyOtpSchema = z.object({
  email: emailField.min(1),
  otp: z.string().trim().length(6, "OTP must be 6 digits"),
});

export const resetPasswordSchema = z.object({
  email: emailField.min(1),
  otp: z.string().trim().length(6),
  password: z.string().min(8).regex(PASSWORD_REGEX, PASSWORD_MESSAGE),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8).regex(PASSWORD_REGEX, PASSWORD_MESSAGE),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const superListQuerySchema = z.object({
  key: z.string().min(1),
  search: z.string().optional(),
  ending: z.enum(["15d", "1m", "2m"]).optional(),
  sort: z.enum(["endingSoon", "newest"]).optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});

export const extendSubscriptionSchema = z.object({
  months: z.coerce.number().refine((m) => [1, 2, 3, 6, 12].includes(m), { message: "Invalid extension period" }),
  key: z.string().min(1).optional(),
});

export const subscriptionStatusSchema = z.object({
  active: z.union([z.boolean(), z.literal("true"), z.literal("false")]).transform((v) => v === true || v === "true"),
  key: z.string().min(1).optional(),
});
