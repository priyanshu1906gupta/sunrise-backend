import { UserRole } from "@prisma/client";
import jwt, { SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export interface TokenPayload {
  id: string;
  email: string | null;
  username: string | null;
  role: UserRole;
  companyId: string;
  branchId: string | null;
  sessionEpoch?: number;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}

export function isStaffWriter(role: UserRole): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

export function isBranchScoped(role: UserRole): boolean {
  return role === "MANAGER" || role === "TEACHER" || role === "STUDENT";
}
