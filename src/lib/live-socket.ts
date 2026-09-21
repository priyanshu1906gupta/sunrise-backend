import type { Server as HttpServer } from "http";
import { randomUUID } from "crypto";
import { Server, type Socket } from "socket.io";
import { verifyToken, type TokenPayload } from "./jwt";
import { isOriginAllowed } from "./cors";
import { assertCompanyCanAccess } from "./subscription";
import { liveService } from "../services/live.service";
import { AppError } from "../middleware/errorHandler";
import {
  addViewer,
  appendLiveChat,
  branchLiveRoom,
  emitChatToTeachers,
  liveChatHistory,
  removeMediaSocket,
  sessionLiveRoom,
  setLiveIo,
  setPublisher,
  teacherLiveRoom,
  type LiveChatMessage,
} from "./live-events";

type SocketUser = TokenPayload & { liveRole?: "moderator" | "viewer"; displayName?: string };

const MAX_CHAT = 400;

export function attachLiveSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: "/socket.io",
    transports: ["polling", "websocket"],
    cors: {
      origin(origin, callback) {
        callback(null, isOriginAllowed(origin));
      },
      credentials: true,
    },
  });
  setLiveIo(io);

  io.use(async (socket, next) => {
    try {
      const raw =
        (typeof socket.handshake.auth?.token === "string" && socket.handshake.auth.token) ||
        (typeof socket.handshake.headers.authorization === "string"
          ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, "")
          : "");
      if (!raw) {
        next(new Error("Authentication required"));
        return;
      }
      const user = verifyToken(raw);
      await assertCompanyCanAccess(user.companyId);
      (socket.data as { user?: SocketUser }).user = user;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    socket.on("join:branch", (branchId: unknown) => {
      if (typeof branchId !== "string" || !branchId) return;
      void socket.join(branchLiveRoom(branchId));
    });

    socket.on("leave:branch", (branchId: unknown) => {
      if (typeof branchId !== "string" || !branchId) return;
      void socket.leave(branchLiveRoom(branchId));
    });

    socket.on("join:session", async (sessionId: unknown, ack?: (err?: string) => void) => {
      const user = (socket.data as { user?: SocketUser }).user;
      if (typeof sessionId !== "string" || !user) {
        ack?.("Invalid session");
        return;
      }
      try {
        const joined = await liveService.assertCanJoin(user, sessionId);
        user.liveRole = joined.role;
        user.displayName = joined.displayName;
        await socket.join(sessionLiveRoom(sessionId));
        if (joined.role === "moderator") {
          await socket.join(teacherLiveRoom(sessionId));
          socket.emit("chat:history", liveChatHistory(sessionId));
        }
        ack?.();
      } catch (error) {
        ack?.(error instanceof AppError ? error.message : "Cannot join live class");
      }
    });

    socket.on("chat:send", async (payload: unknown, ack?: (err?: string) => void) => {
      const user = (socket.data as { user?: SocketUser }).user;
      if (!user) {
        ack?.("Authentication required");
        return;
      }
      if (user.role !== "STUDENT") {
        ack?.("Only students can send messages");
        return;
      }
      const body = payload as { sessionId?: string; text?: string };
      const sessionId = body?.sessionId;
      const text = String(body?.text ?? "").trim().slice(0, MAX_CHAT);
      if (!sessionId || !text) {
        ack?.("Message is required");
        return;
      }
      if (user.liveRole !== "viewer" || !socket.rooms.has(sessionLiveRoom(sessionId))) {
        try {
          const joined = await liveService.assertCanJoin(user, sessionId);
          user.liveRole = joined.role;
          user.displayName = joined.displayName;
          await socket.join(sessionLiveRoom(sessionId));
        } catch (error) {
          ack?.(error instanceof AppError ? error.message : "Join the live class first");
          return;
        }
      }
      const message: LiveChatMessage = {
        id: randomUUID(),
        sessionId,
        senderId: user.id,
        studentName: user.displayName || "Student",
        text,
        sentAt: new Date().toISOString(),
      };
      appendLiveChat(sessionId, message);
      emitChatToTeachers(sessionId, message);
      socket.emit("chat:message", message);
      ack?.();
    });

    socket.on("webrtc:publisher-ready", async (sessionId: unknown, ack?: (err?: string, viewers?: string[]) => void) => {
      const user = (socket.data as { user?: SocketUser }).user;
      if (typeof sessionId !== "string" || !user) {
        ack?.("Invalid session");
        return;
      }
      try {
        const joined = await liveService.assertCanJoin(user, sessionId);
        if (joined.role !== "moderator") {
          ack?.("Only the teacher can publish video");
          return;
        }
        user.liveRole = joined.role;
        await socket.join(sessionLiveRoom(sessionId));
        socket.data.liveSessionId = sessionId;
        const viewers = setPublisher(sessionId, socket.id);
        socket.to(sessionLiveRoom(sessionId)).emit("webrtc:teacher-online", { sessionId });
        ack?.(undefined, viewers);
        for (const viewerId of viewers) {
          socket.emit("webrtc:viewer", { socketId: viewerId, sessionId });
        }
      } catch (error) {
        ack?.(error instanceof AppError ? error.message : "Cannot publish");
      }
    });

    socket.on("webrtc:viewer-ready", async (sessionId: unknown, ack?: (err?: string, teacherId?: string | null) => void) => {
      const user = (socket.data as { user?: SocketUser }).user;
      if (typeof sessionId !== "string" || !user) {
        ack?.("Invalid session");
        return;
      }
      try {
        const joined = await liveService.assertCanJoin(user, sessionId);
        user.liveRole = joined.role;
        user.displayName = joined.displayName;
        await socket.join(sessionLiveRoom(sessionId));
        socket.data.liveSessionId = sessionId;
        const teacherId = addViewer(sessionId, socket.id);
        ack?.(undefined, teacherId);
        if (teacherId) {
          io.to(teacherId).emit("webrtc:viewer", { socketId: socket.id, sessionId });
        }
      } catch (error) {
        ack?.(error instanceof AppError ? error.message : "Cannot join video");
      }
    });

    socket.on("webrtc:signal", (payload: unknown) => {
      const body = payload as { to?: string; data?: unknown };
      if (typeof body?.to !== "string" || body.data == null) return;
      io.to(body.to).emit("webrtc:signal", { from: socket.id, data: body.data });
    });

    socket.on("disconnect", () => {
      const changes = removeMediaSocket(socket.id);
      for (const change of changes) {
        if (change.wasPublisher) {
          io.to(sessionLiveRoom(change.sessionId)).emit("webrtc:teacher-offline", { sessionId: change.sessionId });
        } else if (change.publisherId) {
          io.to(change.publisherId).emit("webrtc:viewer-left", { socketId: socket.id, sessionId: change.sessionId });
        }
      }
    });
  });

  return io;
}
