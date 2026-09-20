import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { TokenPayload } from "../lib/jwt";
import { assertBranchAccess, managerBranchId } from "../middleware/auth";
import { parsePagination, paginated } from "../lib/pagination";
import { toNumber } from "../lib/files";

export async function seedDefaultExpenses(branchId: string): Promise<void> {
  const names = ["Rent", "Cleaning", "Electricity", "Maintenance", "Water"];
  const due = new Date();
  due.setDate(5);
  const existing = await prisma.expense.count({ where: { branchId } });
  if (existing > 0) return;
  await prisma.expense.createMany({
    data: names.map((name) => ({
      branchId,
      name,
      dueDate: due,
      amount: 0,
      comment: "Default expense",
    })),
  });
}

function monthBounds(year: number, month: number) {
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 1),
  };
}

function parseMonthYear(query: { month?: string; year?: string }) {
  const now = new Date();
  const year = Number(query.year);
  const month = Number(query.month);
  return {
    year: Number.isFinite(year) && year >= 2000 && year <= 2100 ? Math.trunc(year) : now.getFullYear(),
    month: Number.isFinite(month) && month >= 1 && month <= 12 ? Math.trunc(month) : now.getMonth() + 1,
  };
}

function isCurrentCalendarMonth(year: number, month: number) {
  const now = new Date();
  return year === now.getFullYear() && month === now.getMonth() + 1;
}

function shiftDueDate(source: Date, year: number, month: number): Date {
  const day = source.getUTCDate();
  const last = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, Math.min(day, last));
}

/** Copy last month's expenses into the current month when it is still empty. */
export async function copyExpensesIntoMonth(
  branchId: string,
  year: number,
  month: number,
): Promise<void> {
  const { start, end } = monthBounds(year, month);
  const existing = await prisma.expense.count({
    where: { branchId, dueDate: { gte: start, lt: end } },
  });
  if (existing > 0) return;

  const latest = await prisma.expense.findFirst({
    where: { branchId, dueDate: { lt: start } },
    orderBy: { dueDate: "desc" },
    select: { dueDate: true },
  });
  if (!latest) return;

  const src = monthBounds(latest.dueDate.getFullYear(), latest.dueDate.getMonth() + 1);
  const rows = await prisma.expense.findMany({
    where: { branchId, dueDate: { gte: src.start, lt: src.end } },
  });
  if (!rows.length) return;

  await prisma.$transaction(async (tx) => {
    const again = await tx.expense.count({
      where: { branchId, dueDate: { gte: start, lt: end } },
    });
    if (again > 0) return;
    await tx.expense.createMany({
      data: rows.map((row) => ({
        branchId,
        name: row.name,
        amount: row.amount,
        comment: row.comment,
        dueDate: shiftDueDate(row.dueDate, year, month),
      })),
    });
  });
}

function requireBranchId(user: TokenPayload, branchId?: string) {
  if (user.role === "MANAGER") {
    if (!user.branchId) throw new AppError(400, "Manager has no branch assigned");
    return user.branchId;
  }
  if (!branchId) throw new AppError(400, "branchId is required");
  return branchId;
}

export class ExpenseService {
  async list(
    user: TokenPayload,
    query: { page?: string; pageSize?: string; branchId?: string; month?: string; year?: string },
  ) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const branchId = managerBranchId(user, query.branchId);
    if (!branchId) throw new AppError(400, "branchId is required");
    await assertBranchAccess(user, branchId);
    const { year, month } = parseMonthYear(query);
    if (isCurrentCalendarMonth(year, month)) {
      await copyExpensesIntoMonth(branchId, year, month);
    }
    const { start, end } = monthBounds(year, month);
    const where = { branchId, dueDate: { gte: start, lt: end } };
    const [rows, total] = await prisma.$transaction([
      prisma.expense.findMany({ where, skip, take, orderBy: { dueDate: "asc" } }),
      prisma.expense.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({ ...r, amount: toNumber(r.amount) })),
      total,
      page,
      pageSize,
    );
  }

  async create(
    user: TokenPayload,
    data: { name: string; dueDate: Date; amount: number; comment?: string | null; branchId?: string },
  ) {
    const branchId = requireBranchId(user, data.branchId);
    await assertBranchAccess(user, branchId);
    const item = await prisma.expense.create({
      data: {
        branchId,
        name: data.name,
        dueDate: data.dueDate,
        amount: data.amount,
        comment: data.comment,
      },
    });
    return { ...item, amount: toNumber(item.amount) };
  }

  async update(
    user: TokenPayload,
    id: string,
    data: { name?: string; dueDate?: Date; amount?: number; comment?: string | null },
  ) {
    const item = await prisma.expense.findUnique({ where: { id }, include: { branch: true } });
    if (!item || item.branch.companyId !== user.companyId) {
      throw new AppError(404, "Expense not found");
    }
    await assertBranchAccess(user, item.branchId);
    const updated = await prisma.expense.update({ where: { id }, data });
    return { ...updated, amount: toNumber(updated.amount) };
  }

  async remove(user: TokenPayload, id: string) {
    const item = await prisma.expense.findUnique({ where: { id }, include: { branch: true } });
    if (!item || item.branch.companyId !== user.companyId) {
      throw new AppError(404, "Expense not found");
    }
    await assertBranchAccess(user, item.branchId);
    await prisma.expense.delete({ where: { id } });
    return null;
  }
}

export const expenseService = new ExpenseService();
