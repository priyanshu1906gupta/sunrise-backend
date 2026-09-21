import { DevicePlatform } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { TokenPayload } from "../lib/jwt";

export class PushService {
  async register(user: TokenPayload, token: string, platform: DevicePlatform) {
    await prisma.deviceToken.upsert({
      where: { userId_token: { userId: user.id, token } },
      update: { platform },
      create: { userId: user.id, token, platform },
    });
    return { registered: true };
  }

  async unregister(user: TokenPayload, token: string) {
    await prisma.deviceToken.deleteMany({ where: { userId: user.id, token } });
    return { unregistered: true };
  }

  async notifyUser(userId: string, title: string, body: string, data?: Record<string, string>) {
    const tokens = await prisma.deviceToken.findMany({ where: { userId } });
    if (!tokens.length) return { sent: 0 };
    const key = process.env.FCM_SERVER_KEY;
    if (!key) return { sent: 0, skipped: "FCM_SERVER_KEY not set" };
    try {
      await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: { Authorization: `key=${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          registration_ids: tokens.map((row) => row.token),
          notification: { title, body },
          ...(data ? { data } : {}),
        }),
      });
      return { sent: tokens.length };
    } catch {
      return { sent: 0 };
    }
  }
}

export const pushService = new PushService();
