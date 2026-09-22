import { NextFunction, Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { AppError } from "./errorHandler";
import { verifyToken, TokenPayload, isStaffWriter, isBranchScoped } from "../lib/jwt";
import { prisma } from "../lib/prisma";
import { assertCompanyCanAccess } from "../lib/subscription";
import { assertSessionActive } from "../lib/refresh-token";

function countsAsSessionActivity(req: Request): boolean {
  return !(req.method === "GET" && req.path === "/notifications");
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError(401, "Authentication required");
    }
    req.user = verifyToken(header.slice(7));
    await assertCompanyCanAccess(req.user.companyId);
    if (req.user.role === "STUDENT") {
      const row = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { sessionEpoch: true },
      });
      if (!row || (req.user.sessionEpoch ?? 0) !== row.sessionEpoch) {
        throw new AppError(401, "Session expired. Please log in again.", "SESSION_EXPIRED");
      }
    }
    await assertSessionActive(req.user.id, { touch: countsAsSessionActivity(req) });
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    next(new AppError(401, "Invalid or expired token"));
  }
}

export function authorize(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, "Authentication required"));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError(403, "You do not have access to this resource"));
      return;
    }
    next();
  };
}

export function authorizeWrite(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError(401, "Authentication required"));
    return;
  }
  if (!isStaffWriter(req.user.role)) {
    next(new AppError(403, "You do not have access to this resource"));
    return;
  }
  next();
}

export function requireUser(req: Request): TokenPayload {
  if (!req.user) {
    throw new AppError(401, "Authentication required");
  }
  return req.user;
}

export async function assertBranchAccess(user: TokenPayload, branchId: string): Promise<void> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch || branch.companyId !== user.companyId) {
    throw new AppError(404, "Branch not found");
  }
  if (isBranchScoped(user.role) && user.branchId !== branchId) {
    throw new AppError(403, "You can only access your assigned branch");
  }
}

export function managerBranchId(user: TokenPayload, requested?: string): string | undefined {
  if (isBranchScoped(user.role)) {
    return user.branchId ?? undefined;
  }
  return requested;
}
