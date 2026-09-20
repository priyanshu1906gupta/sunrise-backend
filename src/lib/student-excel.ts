import ExcelJS from "exceljs";
import { Gender } from "@prisma/client";

export function normalizePhone(value?: string | null): string | null {
  if (value == null) return null;
  const s = String(value).replace(/[\s\-()]/g, "").trim();
  return s || null;
}

export function normalizeStudentEmail(value?: string | null): string | null {
  if (value == null) return null;
  const s = String(value).trim().toLowerCase();
  return s || null;
}

export function parseGender(value: string): Gender | null {
  const s = value.trim().toUpperCase();
  if (s === "MALE" || s === "M" || s === "MAN") return "MALE";
  if (s === "FEMALE" || s === "F" || s === "WOMAN") return "FEMALE";
  if (s === "OTHER" || s === "O") return "OTHER";
  return null;
}

export function parseJoiningDate(value: string): Date | null {
  const raw = value.trim();
  if (!raw) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (ymd) return new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(raw);
  if (dmy) return new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
  const n = Number(raw);
  if (Number.isFinite(n) && n > 20_000 && n < 80_000) {
    const epoch = Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000;
    return new Date(epoch);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function studentsToExcelBuffer(
  rows: Array<{
    fullName: string;
    gender: string;
    course: string;
    batch: string;
    className: string;
    joiningDate: string;
    phone: string;
    email: string;
    status: string;
  }>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Students");
  sheet.columns = [
    { header: "Full name", key: "fullName", width: 28 },
    { header: "Gender", key: "gender", width: 12 },
    { header: "Course", key: "course", width: 24 },
    { header: "Batch", key: "batch", width: 24 },
    { header: "Class", key: "className", width: 14 },
    { header: "Date of joining", key: "joiningDate", width: 18 },
    { header: "Mobile", key: "phone", width: 16 },
    { header: "Email", key: "email", width: 32 },
    { header: "Status", key: "status", width: 12 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(row);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
