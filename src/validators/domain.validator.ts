import { z } from "zod";
import { PASSWORD_REGEX, PASSWORD_MESSAGE } from "../lib/password";

/** Accept yyyy-mm-dd / ISO strings (JSON) or Date. Avoid Zod 4 `z.date()`, which expects an ISO *string*. */
export const dateInput = z.union([z.string().min(1), z.number(), z.instanceof(Date)]).transform((value, ctx) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    ctx.addIssue({ code: "custom", message: "Invalid date" });
    return z.NEVER;
  }
  return parsed;
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const updateCompanySchema = z.object({
  name: z.string().min(1).max(150).optional(),
  ownerName: z.string().min(1).max(150).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(8).max(20).optional(),
  bio: z.string().max(2000).optional().nullable(),
  logoFileId: z.string().uuid().optional().nullable(),
  imageFileIds: z.array(z.string().uuid()).max(3).optional(),
});

export const createBranchSchema = z.object({
  name: z.string().min(1).max(150),
  ownerName: z.string().min(1).max(150),
  address: z.string().max(500).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  details: z.string().max(2000).optional().nullable(),
  logoFileId: z.string().uuid().optional().nullable(),
  photoFileIds: z.array(z.string().uuid()).max(3).optional(),
  manager: z
    .object({
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      email: z.string().email(),
      phone: z.string().min(8).max(20),
      password: z.string().min(8).regex(PASSWORD_REGEX, PASSWORD_MESSAGE),
    })
    .optional(),
});

export const updateBranchSchema = createBranchSchema.partial();

export const studentSchema = z.object({
  photoFileId: z.string().uuid().optional().nullable(),
  fullName: z.string().min(1).max(150),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  dateOfBirth: dateInput.optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  schoolClassId: z.string().uuid().optional().nullable(),
  boardId: z.string().uuid().optional().nullable(),
  courseIds: z.array(z.string().uuid()).optional(),
  batchIds: z.array(z.string().uuid()).optional(),
  paymentDate: dateInput,
  paidAmount: z.coerce.number().min(0).optional(),
  joiningDate: dateInput,
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: z.string().max(20).optional().nullable(),
  emergencyContact: z.string().max(20).optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  branchId: z.string().uuid().optional(),
  registrationCharge: z.coerce.number().min(0).optional(),
  subscriptionMonths: z.coerce.number().int().positive().optional(),
});

export const addPaymentSchema = z.object({
  paidAmount: z.coerce.number().positive("Paid amount is required"),
  paymentDate: dateInput,
  paymentMode: z.enum(["CASH", "ONLINE"]).default("CASH"),
});

export const helpQuerySchema = z.object({
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().min(1).max(4000),
});

export const studentImportSchema = z.object({
  branchId: z.string().uuid().optional(),
  rows: z
    .array(
      z.object({
        fullName: z.string().min(1).max(150),
        gender: z.string().min(1),
        joiningDate: z.string().min(1),
        phone: z.string().max(20).optional().nullable(),
        email: z.string().optional().nullable(),
        course: z.string().optional().nullable(),
        batch: z.string().optional().nullable(),
        className: z.string().optional().nullable(),
      }),
    )
    .min(1)
    .max(500),
});

export const employeeSchema = z.object({
  photoFileId: z.string().uuid().optional().nullable(),
  fullName: z.string().min(1).max(150),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  role: z.enum(["MANAGER", "TEACHER", "STAFF"]),
  subjectId: z.string().uuid().optional().nullable(),
  salary: z.coerce.number().positive(),
  salaryDate: dateInput,
  joiningDate: dateInput,
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: z.string().min(8).max(20),
  emergencyContact: z.string().max(20).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  aadhaarFileId: z.string().uuid().optional().nullable(),
  branchId: z.string().uuid().optional(),
});

export const courseSchema = z.object({
  branchId: z.string().uuid().optional(),
  name: z.string().min(1).max(150),
  details: z.string().max(2000).optional().nullable(),
  durationMonths: z.coerce.number().int().positive(),
  price: z.coerce.number().min(0),
  subjectIds: z.array(z.string().uuid()).optional(),
});

export const batchSchema = z.object({
  branchId: z.string().uuid().optional(),
  courseId: z.string().uuid(),
  name: z.string().min(1).max(150),
  time: z.string().max(80).optional().nullable(),
  price: z.coerce.number().min(0).optional(),
  startDate: dateInput,
});

export const subjectSchema = z.object({
  name: z.string().min(1).max(120),
});

export const leaveSchema = z.object({
  fromDate: dateInput,
  toDate: dateInput,
  reason: z.string().trim().min(1).max(2000),
});

export const pushTokenSchema = z.object({
  token: z.string().min(1).max(512),
  platform: z.enum(["WEB", "ANDROID", "IOS", "DESKTOP"]),
});

export const expenseSchema = z.object({
  name: z.string().min(1).max(150),
  dueDate: dateInput,
  amount: z.coerce.number().min(0),
  comment: z.string().max(2000).optional().nullable(),
  branchId: z.string().uuid().optional(),
});

const manualAttendance = z.enum(["AVAILABLE", "LEAVE", "HALF_LEAVE", "HOLIDAY_CLOSE"]);

export const hrmAttendanceSchema = z.object({
  employeeId: z.string().uuid(),
  date: dateInput,
  status: z
    .union([manualAttendance, z.literal(""), z.null()])
    .transform((value) => (value === "" || value == null ? null : value)),
});

export const hrmSettingsSchema = z.object({
  sundayWeekend: z.boolean(),
});

const questionOptionSchema = z.object({
  en: z.string().max(2000).default(""),
  hi: z.string().max(2000).default(""),
});

export const createTestSchema = z.object({
  name: z.string().min(1).max(200),
  courseId: z.string().uuid(),
  durationMinutes: z.coerce.number().int().min(1).max(600),
  questionCount: z.coerce.number().int().min(1).max(500).optional(),
  negativeEnabled: z.boolean().default(false),
  negativeFraction: z.enum(["HALF", "THIRD", "FOURTH"]).optional().nullable(),
  branchId: z.string().uuid().optional(),
  questions: z
    .array(
      z.object({
        subjectName: z.string().min(1).max(120),
        questionEn: z.string().max(8000).default(""),
        questionHi: z.string().max(8000).default(""),
        correctIndex: z.coerce.number().int().min(1).max(6),
        answerDescription: z.string().max(8000).default(""),
        options: z.array(questionOptionSchema).min(2).max(6),
      }),
    )
    .min(1)
    .max(500),
});

export const testAnswerSchema = z.object({
  questionId: z.string().uuid(),
  selectedIndex: z
    .union([z.null(), z.literal(""), z.coerce.number().int().min(1).max(6)])
    .optional()
    .transform((value) => (value === "" || value == null ? null : value)),
  markedForReview: z.boolean().optional().default(false),
  secondsSpent: z.coerce.number().min(0).optional().default(0),
});

export const testHeartbeatSchema = z.object({
  remainingSeconds: z.coerce.number().int().min(0).optional(),
  warningCount: z.coerce.number().int().min(0).max(10).optional(),
  answers: z.array(testAnswerSchema).optional(),
});

export const testSubmitSchema = z.object({
  auto: z.boolean().optional().default(false),
  answers: z.array(testAnswerSchema).optional(),
});

export const startLiveSchema = z.object({
  branchId: z.string().uuid().optional(),
  courseId: z.string().uuid(),
  subjectId: z.string().uuid(),
});

export const createStudyMaterialSchema = z.object({
  branchId: z.string().uuid().optional(),
  courseId: z.string().uuid(),
  subjectId: z.string().uuid(),
  name: z.string().min(1).max(200),
  fileId: z.string().uuid(),
});

export const loginStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
});
