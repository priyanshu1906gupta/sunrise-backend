import type { Server } from "socket.io";

export type LiveChatMessage = {
  id: string;
  sessionId: string;
  senderId: string;
  studentName: string;
  text: string;
  sentAt: string;
};

const chats = new Map<string, LiveChatMessage[]>();
let io: Server | null = null;

export function setLiveIo(server: Server): void {
  io = server;
}

export function liveChatHistory(sessionId: string): LiveChatMessage[] {
  return chats.get(sessionId) ?? [];
}

export function appendLiveChat(sessionId: string, message: LiveChatMessage): void {
  const list = chats.get(sessionId) ?? [];
  list.push(message);
  chats.set(sessionId, list);
}

export function wipeChat(sessionId: string): void {
  chats.delete(sessionId);
}

export function branchLiveRoom(branchId: string): string {
  return `branch:${branchId}:live`;
}

export function sessionLiveRoom(sessionId: string): string {
  return `session:${sessionId}`;
}

export function teacherLiveRoom(sessionId: string): string {
  return `session:${sessionId}:teachers`;
}

export function emitLiveStarted(
  branchId: string,
  payload: {
    sessionId: string;
    courseId: string;
    subjectId: string;
    courseName: string;
    subjectName: string;
  },
): void {
  io?.to(branchLiveRoom(branchId)).emit("live:started", payload);
}

export function emitLiveEnded(branchId: string, sessionId: string): void {
  io?.to(branchLiveRoom(branchId)).emit("live:ended", { sessionId });
  io?.to(sessionLiveRoom(sessionId)).emit("live:ended", { sessionId });
}

export function emitChatToTeachers(sessionId: string, message: LiveChatMessage): void {
  io?.to(teacherLiveRoom(sessionId)).emit("chat:message", message);
}

export type LiveAttendees = {
  count: number;
  names: string[];
};

type MediaRoom = {
  publisherId: string | null;
  viewers: Map<string, string>;
};

const mediaRooms = new Map<string, MediaRoom>();

function mediaRoom(sessionId: string): MediaRoom {
  let room = mediaRooms.get(sessionId);
  if (!room) {
    room = { publisherId: null, viewers: new Map() };
    mediaRooms.set(sessionId, room);
  }
  return room;
}

export function attendeesOf(sessionId: string): LiveAttendees {
  const room = mediaRooms.get(sessionId);
  if (!room) return { count: 0, names: [] };
  const names = [...room.viewers.values()];
  return { count: names.length, names };
}

export function emitAttendees(sessionId: string): void {
  io?.to(sessionLiveRoom(sessionId)).emit("live:attendees", attendeesOf(sessionId));
}

export function setPublisher(sessionId: string, socketId: string): string[] {
  const room = mediaRoom(sessionId);
  room.publisherId = socketId;
  room.viewers.delete(socketId);
  return [...room.viewers.keys()];
}

export function addViewer(sessionId: string, socketId: string, name?: string): string | null {
  const room = mediaRoom(sessionId);
  if (room.publisherId === socketId) return room.publisherId;
  room.viewers.set(socketId, (name || "Student").trim() || "Student");
  return room.publisherId;
}

export function removeMediaSocket(socketId: string): Array<{ sessionId: string; wasPublisher: boolean; publisherId: string | null }> {
  const changes: Array<{ sessionId: string; wasPublisher: boolean; publisherId: string | null }> = [];
  for (const [sessionId, room] of mediaRooms) {
    const wasPublisher = room.publisherId === socketId;
    if (wasPublisher) room.publisherId = null;
    const wasViewer = room.viewers.delete(socketId);
    if (wasPublisher || wasViewer) {
      changes.push({ sessionId, wasPublisher, publisherId: room.publisherId });
    }
    if (!room.publisherId && room.viewers.size === 0) mediaRooms.delete(sessionId);
  }
  return changes;
}

export function wipeMedia(sessionId: string): void {
  mediaRooms.delete(sessionId);
  emitAttendees(sessionId);
}

export function getIo(): Server | null {
  return io;
}
