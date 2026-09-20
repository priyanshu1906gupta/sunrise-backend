import { Request, Response } from "express";
import { databaseUrlLooksUsable } from "../lib/prisma-errors";

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = "Success",
  statusCode = 200,
): Response {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

export function sendCreated<T>(res: Response, data: T, message = "Created"): Response {
  return sendSuccess(res, data, message, 201);
}

export async function healthCheck(_req: Request, res: Response): Promise<Response> {
  return sendSuccess(res, {
    status: "ok",
    timestamp: new Date().toISOString(),
    databaseConfigured: databaseUrlLooksUsable(),
  });
}
